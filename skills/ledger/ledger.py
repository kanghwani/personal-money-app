#!/usr/bin/env python3
"""가계부(Google Sheets 원장) 조회·점검 CLI. 폰에서 짧게 치라고 만든 도구.

사용:
  ledger.py check            # 이상 항목 점검 + 이번 달 요약
  ledger.py month [YYYY-MM]  # 월 상세(카테고리·결제수단별)
  ledger.py find <키워드>     # 내역 검색
  ledger.py cat <대분류>      # 카테고리별 최근 내역
  ledger.py card <결제수단>   # 카드별 최근 내역
  ledger.py split [YYYY-MM]  # 분담금(받을 돈) 정산
  ledger.py fixed            # 고정비 목록

쓰기(수정):
  ledger.py add "5000 스타벅스 하나카드"   # 서버 파서로 추가(자동분류·중복방지)
  ledger.py edit <id8> amount=15100 payment=하나카드 memo=... cat=식비 sub=외식 date=2026-08-27 split=1000
  ledger.py half <id8>       # 분담금 50%(반반)
  ledger.py rm <id8>         # 삭제
"""
import json, os, re, sys, time, urllib.request, urllib.parse, collections
from datetime import date

ENV = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'personal-money-app', '.env')

def cfg():
    url = tok = None
    with open(os.path.abspath(ENV), encoding='utf-8') as f:
        for line in f:
            k, _, v = line.strip().partition('=')
            v = v.strip().strip('"').strip("'")
            if k == 'VITE_SYNC_URL': url = v
            elif k == 'VITE_SYNC_TOKEN': tok = v
    if not url or not tok: sys.exit('.env에서 VITE_SYNC_URL/TOKEN을 못 찾음')
    return url, tok

def get(action):
    url, tok = cfg()
    for _ in range(4):                      # GAS가 가끔 302/404를 뱉어서 재시도
        try:
            with urllib.request.urlopen(f'{url}?action={action}&token={tok}', timeout=60) as r:
                return json.load(r)
        except Exception:
            time.sleep(3)
    sys.exit('서버 응답 실패 (잠시 후 다시)')

def post(payload):
    url, tok = cfg()
    payload = {**payload, 'token': tok}
    body = json.dumps(payload, ensure_ascii=False).encode()
    for _ in range(3):
        try:
            req = urllib.request.Request(url, data=body,
                headers={'Content-Type': 'text/plain;charset=utf-8'}, method='POST')
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(3)
    sys.exit('서버 응답 실패 (잠시 후 다시)')

def find_one(id8):
    """앞 8자리로 거래 1건을 찾는다. 없거나 여러 건이면 중단."""
    hit = [t for t in rows() if t['id'].startswith(id8)]
    if not hit: sys.exit(f'{id8} 로 시작하는 거래 없음')
    if len(hit) > 1: sys.exit(f'{id8} 가 {len(hit)}건과 겹침 — 더 길게 지정')
    return hit[0]

def rows():   return get('ledger')['transactions']
def defs():   return get('fixedList').get('defs', [])
def won(n):   return f'{n:,}원'
def ym(s=None): return s or date.today().strftime('%Y-%m')

# 카드 전월실적에서 흔히 빠지는 항목(관리비·4대보험·할부·보험·세금)
EXCL = ['국민연금', '건강보험', '관리비', '할부', '보험', '세금', '국세', '주민세', '자동차세', '월세']
def excluded(memo): return any(k in (memo or '') for k in EXCL)

def show(ts, limit=25):
    for t in sorted(ts, key=lambda x: x.get('date') or '', reverse=True)[:limit]:
        sp = t.get('split', 0)
        tag = f" (분담 {sp:,})" if sp else ''
        print(f"  {t['id'][:8]} {t.get('date')} {(t.get('memo') or '')[:22]:24} {t.get('amount', 0):>9,} [{t.get('payment') or '-'}] {t.get('category')}/{t.get('subCategory')}{tag}")

def cmd_check():
    d = rows(); today = date.today().isoformat()
    mis  = [t for t in d if (t.get('category') or '미분류') == '미분류']
    won_ = [t for t in d if re.search(r'(^|\s)원(\s|$)', t.get('memo') or '')]
    zero = [t for t in d if not t.get('amount')]
    fut  = [t for t in d if (t.get('date') or '') > today]
    nopay= [t for t in d if t.get('type') == 'expense' and not t.get('payment')]
    vague= [t for t in d if t.get('payment') == '카드']
    key  = collections.Counter((t.get('date'), t.get('amount'), (t.get('memo') or '').strip()) for t in d)
    dup  = [k for k, v in key.items() if v > 1]
    print(f'=== 원장 {len(d)}건 · {today} ===')
    print(f'  미분류 {len(mis)} · 원잔재 {len(won_)} · 금액0 {len(zero)} · 중복 {len(dup)} · 미래 {len(fut)} · 결제수단없음 {len(nopay)} · 모호(카드) {len(vague)}')
    for label, ts in [('미분류', mis), ('원잔재', won_), ('금액0', zero), ('미래', fut), ('결제수단없음', nopay), ('모호', vague)]:
        if ts: print(f'\n[{label}]'); show(ts, 10)
    if dup:
        print('\n[중복]')
        for k in dup[:10]: print(f'  {k} x{key[k]}')
    cmd_month(None, brief=True)

def cmd_month(m=None, brief=False):
    m = ym(m); d = rows()
    exp = [t for t in d if (t.get('date') or '').startswith(m) and t.get('type') == 'expense']
    inc = [t for t in d if (t.get('date') or '').startswith(m) and t.get('type') == 'income']
    tot = sum(t['amount'] for t in exp); sp = sum(t.get('split', 0) for t in exp)
    fix = sum(t['amount'] - t.get('split', 0) for t in exp if t.get('fixedType') == 'fixed')
    print(f'\n=== {m} · {len(exp)}건 ===')
    print(f'  결제 {won(tot)} · 분담/환급 {won(sp)} · 내 실지출 {won(tot - sp)}')
    print(f'  고정 {won(fix)} · 변동 {won(tot - sp - fix)} · 수입 {won(sum(t["amount"] for t in inc))}')
    if brief: return
    for label, keyf in [('카테고리', 'category'), ('결제수단', 'payment')]:
        c = collections.Counter()
        for t in exp: c[t.get(keyf) or '-'] += t['amount'] - t.get('split', 0)
        print(f'\n  [{label}별]')
        for k, v in c.most_common(8): print(f'    {k:12} {v:>10,} {v/max(1,tot-sp)*100:5.1f}%')

def cmd_find(kw):
    d = rows(); hit = [t for t in d if kw.lower() in (t.get('memo') or '').lower()]
    print(f"=== '{kw}' {len(hit)}건 · 합계 {won(sum(t['amount'] for t in hit))} ===")
    show(hit)

def cmd_by(field, val):
    d = rows(); hit = [t for t in d if val.lower() in (t.get(field) or '').lower()]
    m = ym(); this = [t for t in hit if (t.get('date') or '').startswith(m)]
    print(f"=== {field}='{val}' 전체 {len(hit)}건 / 이번달 {len(this)}건 {won(sum(t['amount'] for t in this))} ===")
    show(hit)

def cmd_split(m=None):
    m = ym(m); d = rows()
    ts = [t for t in d if (t.get('date') or '').startswith(m) and t.get('split', 0) > 0]
    refund = [t for t in ts if any(w in (t.get('memo') or '') for w in ('환급', '리워드'))]
    settle = [t for t in ts if t not in refund]
    people = {'여친': ['브리', '여친', '여자친구'], '형': ['형']}
    by = collections.Counter()
    for t in settle:
        who = next((n for n, ws in people.items() if any(w in (t.get('memo') or '') for w in ws)), '기타')
        by[who] += t['split']
    print(f'=== {m} 분담금 ===')
    print(f"  정산해서 받을 돈 {won(sum(t['split'] for t in settle))}")
    for k, v in by.most_common(): print(f'    {k:6} {v:>10,}')
    print(f"  자동 환급 {won(sum(t['split'] for t in refund))}")
    show(ts, 20)

def cmd_fixed():
    fs = [f for f in defs() if f.get('active')]
    for kind, label in [('expense', '고정비'), ('income', '정기수입')]:
        g = [f for f in fs if f.get('kind') == kind]
        print(f"\n=== {label} {len(g)}건 · 월 {won(sum(f['amount'] for f in g))} ===")
        for f in sorted(g, key=lambda x: -x['amount']):
            inst = f" · {f['installmentTotal']}회" if f.get('installmentTotal') else ''
            sp = f" · 분담 {f['split']:,}" if f.get('split') else ''
            print(f"  {f['name'][:20]:22} {f['amount']:>9,} (매월 {f['payDay']}일{inst}{sp}) [{f.get('payment')}]")

def cmd_add(text):
    """빠른입력 파서(서버)로 추가 — 금액·결제수단·날짜·카테고리를 서버가 알아서 처리."""
    url, tok = cfg()
    q = urllib.parse.quote(text)
    for _ in range(4):
        try:
            with urllib.request.urlopen(f'{url}?action=add&token={tok}&raw={q}', timeout=60) as r:
                res = json.load(r)
            p = res.get('parsed', {})
            print(f"추가: {p.get('date')} {p.get('memo')} {p.get('amount', 0):,}원 "
                  f"[{p.get('payment') or '-'}] {p.get('mainCategory')}/{p.get('subCategory')}")
            return
        except Exception:
            time.sleep(3)
    sys.exit('추가 실패 (잠시 후 다시)')

FIELDS = {'amount': int, 'memo': str, 'payment': str, 'date': str, 'split': int,
          'cat': str, 'sub': str, 'type': str, 'fixed': str}

def cmd_edit(id8, pairs):
    t = find_one(id8); before = dict(t)
    for p in pairs:
        k, _, v = p.partition('=')
        if k not in FIELDS: sys.exit(f'모르는 항목: {k} (가능: {", ".join(FIELDS)})')
        if k == 'cat': t['category'] = v
        elif k == 'sub': t['subCategory'] = v
        elif k == 'fixed': t['fixedType'] = 'fixed' if v in ('1', 'fixed', '고정') else 'variable'
        else: t[k] = FIELDS[k](v)
    post({'action': 'updateLedger', 'tx': t})
    chg = [f"{k}: {before.get(k)} → {t.get(k)}" for k in t if before.get(k) != t.get(k)]
    print(f"수정 {t['id'][:8]} {t.get('memo')}\n  " + '\n  '.join(chg))

def cmd_half(id8):
    t = find_one(id8); t['split'] = t['amount'] // 2
    post({'action': 'updateLedger', 'tx': t})
    print(f"반반 {t['id'][:8]} {t.get('memo')} {t['amount']:,} → 분담 {t['split']:,} · 내 {t['amount']-t['split']:,}")

def cmd_rm(id8):
    t = find_one(id8)
    post({'action': 'deleteLedger', 'id': t['id']})
    print(f"삭제 {t['id'][:8]} {t.get('date')} {t.get('memo')} {t.get('amount', 0):,}원")

def main():
    a = sys.argv[1:] or ['check']
    c = a[0]
    if   c == 'check': cmd_check()
    elif c == 'month': cmd_month(a[1] if len(a) > 1 else None)
    elif c == 'find':  cmd_find(' '.join(a[1:]))
    elif c == 'cat':   cmd_by('category', ' '.join(a[1:]))
    elif c == 'card':  cmd_by('payment', ' '.join(a[1:]))
    elif c == 'split': cmd_split(a[1] if len(a) > 1 else None)
    elif c == 'fixed': cmd_fixed()
    elif c == 'add':   cmd_add(' '.join(a[1:]))
    elif c == 'edit':  cmd_edit(a[1], a[2:])
    elif c == 'half':  cmd_half(a[1])
    elif c == 'rm':    cmd_rm(a[1])
    else: print(__doc__)

if __name__ == '__main__':
    main()
