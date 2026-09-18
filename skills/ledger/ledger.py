#!/usr/bin/env python3
"""가계부(Google Sheets 원장) 조회·점검 CLI. 폰에서 짧게 치라고 만든 도구.

사용:
  ledger.py check            # 이상 항목 점검 + 이번 달 요약
  ledger.py month [YYYY-MM]  # 월 상세(카테고리·결제수단별)
  ledger.py find <키워드>     # 내역 검색
  ledger.py cat <대분류>      # 카테고리별 최근 내역
  ledger.py card <결제수단>   # 카드별 최근 내역
  ledger.py split [YYYY-MM]  # 분담금: 안 받은 것 전체 + 그 달 받을·받음·남음
  ledger.py settle <메모일부|id8> [all]  # 분담금 받음 표시
  ledger.py fixed            # 고정비 목록

쓰기(수정):
  ledger.py add "5000 스타벅스 하나카드"   # 서버 파서로 추가(자동분류·중복방지)
  ledger.py edit <id8> amount=15100 payment=하나카드 memo=... cat=식비 sub=외식 date=2026-08-27 split=1000
  ledger.py half <id8>       # 분담금 50%(반반)
  ledger.py rm <id8>         # 삭제
"""
import json, os, re, sys, time, urllib.request, urllib.parse, collections
from datetime import date

# .env 후보 경로. 심볼릭 링크로 실행돼도 실제 파일 위치(realpath) 기준으로 찾는다.
_HERE = os.path.dirname(os.path.realpath(__file__))
ENV_CANDIDATES = [
    os.path.join(_HERE, '..', '..', '.env'),                       # <repo>/skills/ledger → <repo>/.env
    os.path.expanduser('~/dev/paused/money-app/personal-money-app/.env'),
    os.path.expanduser('~/.config/ledger.env'),                    # 다른 기기/클라우드 세션용
]

def cfg():
    """URL·TOKEN을 환경변수 → .env 후보 순으로 찾는다."""
    url = os.environ.get('LEDGER_URL')
    tok = os.environ.get('LEDGER_TOKEN')
    if url and tok: return url, tok
    for path in ENV_CANDIDATES:
        try:
            with open(os.path.abspath(path), encoding='utf-8') as f:
                for line in f:
                    k, _, v = line.strip().partition('=')
                    v = v.strip().strip('"').strip("'")
                    if k in ('VITE_SYNC_URL', 'LEDGER_URL'): url = v
                    elif k in ('VITE_SYNC_TOKEN', 'LEDGER_TOKEN'): tok = v
            if url and tok: return url, tok
        except OSError:
            continue
    sys.exit('가계부 접속정보를 못 찾음 — LEDGER_URL/LEDGER_TOKEN 환경변수나 '
             '~/.config/ledger.env 를 설정하세요.')

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

# api/_ledger.ts 의 사본. 규칙을 바꾸면 양쪽을 같이 고친다.
PEOPLE = {'여친': ['브리', '여친', '여자친구'], '형': ['형'], '엄마': ['엄마']}
REFUND_WORDS = ['환급', '리워드', '피클']
SETTLE_SINCE = '2026-09-01'   # ponytail: 이 날짜 전의 분담금은 '받음' 표시가 없어도 정산된 것으로 본다
SETTLED = '받음'
def has(t, ws): return any(w in (t.get('memo') or '') for w in ws)
def net(t): return t['amount'] - t.get('split', 0)
def bucket(t):
    if ((t.get('category') or '').startswith('금융') and t.get('subCategory') != '수수료') or (t.get('fixedType') == 'fixed' and '할부' in (t.get('memo') or '')): return '부채상환'
    if (t.get('category') or '').startswith('저축'): return '저축'
    return '생활고정' if t.get('fixedType') == 'fixed' else '변동'

def prev_month(m):
    y, mo = int(m[:4]), int(m[5:]); return f'{y-1}-12' if mo == 1 else f'{y}-{mo-1:02d}'
def pct(cur, prev): return (f"{'+' if cur >= prev else ''}{round((cur-prev)/prev*100)}%") if prev > 0 else '비교 없음'
def month_insights(d, m):
    import calendar
    exp = [t for t in d if (t.get('date') or '').startswith(m) and t.get('type') == 'expense']
    inc = sum(t['amount'] for t in d if (t.get('date') or '').startswith(m) and t.get('type') == 'income')
    pm = prev_month(m); pexp = [t for t in d if (t.get('date') or '').startswith(pm) and t.get('type') == 'expense']
    var = lambda ts: [t for t in ts if bucket(t) == '변동']
    real = sum(net(t) for t in exp); v = sum(net(t) for t in var(exp)); vp = sum(net(t) for t in var(pexp))
    out = []
    if inc > 0: out.append(f"수지: 수입 {won(inc)} − 실지출 {won(real)} = {'+' if inc-real >= 0 else '-'}{won(abs(inc-real))}")
    out.append(f"변동 {won(v)} · 지난달 {won(vp)} 대비 {pct(v, vp)}{' ⚠' if vp > 0 and v > vp*1.1 else ''}")
    today = date.today().isoformat()
    if today.startswith(m):
        day = int(today[8:]); days = calendar.monthrange(int(m[:4]), int(m[5:]))[1]
        if 5 <= day < days: out.append(f'지금 페이스면 월말 변동 ≈ {won(round(v/day*days))} ({day}/{days}일)')
    top = max(var(exp), key=net, default=None)
    if top and net(top) >= 150000: out.append(f"가장 큰 변동: {top.get('memo')} {won(net(top))} ⚠")
    cat = lambda ts: collections.Counter({k: sum(net(t) for t in var(ts) if t.get('category') == k) for k in {t.get('category') for t in var(ts)}})
    cur, prv = cat(exp), cat(pexp)
    if cur:
        k, val = cur.most_common(1)[0]; out.append(f'변동 1위 {k} {won(val)} (지난달 {won(prv.get(k, 0))})')
    open_ = [t for t in d if is_split(t) and not is_refund(t) and not is_settled(t)]
    if open_: out.append(f'안 받은 분담금 {won(ssum(open_))}: ' + ' · '.join(f'{w} {won(ssum(ts))} {len(ts)}건' for w, ts in by_who(open_)))
    return out

def cmd_month(m=None, brief=False):
    m = ym(m); d = rows()
    exp = [t for t in d if (t.get('date') or '').startswith(m) and t.get('type') == 'expense']
    inc = [t for t in d if (t.get('date') or '').startswith(m) and t.get('type') == 'income']
    tot = sum(t['amount'] for t in exp); sp = sum(t.get('split', 0) for t in exp)
    by = collections.Counter()
    for t in exp: by[bucket(t)] += net(t)
    loan = sum(net(t) for t in exp if bucket(t) == '부채상환' and (t.get('category') or '').startswith('금융'))
    print(f'\n=== {m} · {len(exp)}건 ===')
    print(f'  결제 {won(tot)} · 분담/환급 {won(sp)} · 내 실지출 {won(tot - sp)} · 수입 {won(sum(t["amount"] for t in inc))}')
    print(f'  생활고정 {won(by["생활고정"])} · 변동 {won(by["변동"])}')
    print(f'  부채상환 {won(by["부채상환"])} (대출 {won(loan)} · 할부 {won(by["부채상환"] - loan)}) · 저축 {won(by["저축"])}')
    if brief: return
    print('\n  [인사이트]')
    for l in month_insights(d, m): print('    ' + l)
    for label, keyf in [('카테고리', 'category'), ('결제수단', 'payment')]:
        c = collections.Counter()
        for t in exp: c[t.get(keyf) or '-'] += net(t)
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

def is_refund(t): return has(t, REFUND_WORDS)
def is_settled(t): return (t.get('date') or '') < SETTLE_SINCE or has(t, [SETTLED])
def who(t): return next((n for n, ws in PEOPLE.items() if has(t, ws)), '기타')
def is_split(t): return t.get('type') == 'expense' and t.get('split', 0) > 0
def sline(t): return f"{t['id'][:8]} {t['date'][5:]} {t.get('memo')} {won(t['split'])}"
def ssum(ts): return sum(t['split'] for t in ts)
def by_who(ts):
    g = collections.defaultdict(list)
    for t in ts: g[who(t)].append(t)
    return sorted(g.items(), key=lambda kv: -ssum(kv[1]))

def cmd_split(m=None):
    m = ym(m); d = rows()
    splits = [t for t in d if is_split(t) and not is_refund(t)]
    open_ = sorted([t for t in splits if not is_settled(t)], key=lambda t: t['date'])
    print(f"[안 받은 분담금] {won(ssum(open_))} · {len(open_)}건" if open_ else '[안 받은 분담금] 없음')
    for w, ts in by_who(open_):
        print(f'  {w} {won(ssum(ts))}')
        for t in ts: print('    ' + sline(t))
    mon = [t for t in splits if t['date'].startswith(m)]
    print(f"\n[{m} 정산] 받을 {won(ssum(mon))} · 받음 {won(ssum([t for t in mon if is_settled(t)]))} · 남음 {won(ssum([t for t in mon if not is_settled(t)]))}")
    for w, ts in by_who(mon): print(f"  {w} 받을 {won(ssum(ts))} · 받음 {won(ssum([t for t in ts if is_settled(t)]))}")
    refund = [t for t in d if is_split(t) and is_refund(t) and t['date'].startswith(m)]
    if refund:
        print(f'\n[자동 환급] {won(ssum(refund))}')
        for t in refund: print('  ' + sline(t))

def cmd_settle(q, all_=False):
    q = q.strip().lower()
    hit = [t for t in rows() if is_split(t) and not is_refund(t) and not is_settled(t)
           and (t['id'].startswith(q) or q in (t.get('memo') or '').lower())]
    if not hit: sys.exit(f"'{q}' 에 해당하는 안 받은 분담금이 없습니다")
    if len(hit) > 1 and not all_:
        print(f'{len(hit)}건이 걸립니다. id 로 하나씩 하거나 뒤에 all 을 붙이세요.')
        for t in hit: print('  ' + sline(t)); return
    d = date.today().isoformat()
    for t in hit:
        t['memo'] = f"{t.get('memo') or ''} · {SETTLED} {d[5:]}"
        post({'action': 'updateLedger', 'tx': t})
    print(f'받음 표시 {len(hit)}건 ({d[5:]})')
    for t in hit: print('  ' + sline(t))

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
    elif c == 'settle': cmd_settle(' '.join(x for x in a[1:] if x != 'all'), 'all' in a[1:])
    elif c == 'fixed': cmd_fixed()
    elif c == 'add':   cmd_add(' '.join(a[1:]))
    elif c == 'edit':  cmd_edit(a[1], a[2:])
    elif c == 'half':  cmd_half(a[1])
    elif c == 'rm':    cmd_rm(a[1])
    else: print(__doc__)

if __name__ == '__main__':
    main()
