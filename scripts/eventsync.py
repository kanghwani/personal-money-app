#!/usr/bin/env python3
"""맥용 eventsync — 매일 07:27·09:00 + 로그인 시 launchd 가 돌린다 (~/Library/LaunchAgents/com.hwan.eventsync.plist).
맥은 pmset repeat wake 07:25 로 깬다. 07:27(09시 전)에는 코치만, 09시 이후에는 코치 → 이벤트.

  0. 가계부 코치: /api/coach 의 오늘 알림이 있으면 미리알림 "가계부" 에 하루 1개(scripts/coachalert.js). 서버가 상태 없이
     날짜로 계산하므로 잠긴 07:27 에 실패해도 09:00 이 같은 알림을 다시 만든다.
  1. /api/events 호출 (서버가 스캔·당첨 검사까지 하고 새 이벤트를 준다)
  2. 미채점 이벤트를 claude CLI(-p, haiku)로 채점: 경품·가치·당첨자 수·응모가치 1~5 → 시트에 grade 행 저장
     규칙으로는 못 한다 — 경품이 "압축 파우치"처럼 이름뿐이라 금액 정규식은 91건 중 14건, 그마저 영상 내용의 가격을 집었다.
  3. 미리알림 "이벤트" 목록에 [지원]은 응모가치 >= WORTH_MIN 만, [결과]는 응모한 것만, [당첨확인]은 후보가 나오면.
  ALL=1 → 서버에 남은 이벤트 전부 다시(미리알림을 지웠을 때). 같은 제목은 다시 만들지 않는다.
"""
import json, os, pathlib, re, subprocess, sys, tempfile, time, urllib.parse, urllib.request
from datetime import datetime, timedelta

DIR = pathlib.Path(__file__).resolve().parent
ENV = dict(l.split('=', 1) for l in (DIR / '../.env').read_text().splitlines() if '=' in l)
TOKEN, GAS = ENV['VITE_SYNC_TOKEN'].strip(), ENV['VITE_SYNC_URL'].strip()
BASE = 'https://personal-money-app-seven.vercel.app'
WORTH_MIN = int(os.environ.get('WORTH_MIN', '4'))
CLAUDE = next((p for p in [os.path.expanduser('~/.local/bin/claude'), os.path.expanduser('~/.local/node-current/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'] if os.path.exists(p)), 'claude')
log = lambda *a: print(datetime.now().strftime('%Y-%m-%dT%H:%M:%S'), *a, flush=True)

PROMPT = """아래는 유튜브 구독자 이벤트 목록이다. 각각 응모할 가치를 채점해 JSON 배열만 출력해라(설명·코드펜스 없이).
항목: {"id":"…","prize":"경품 한 줄(모르면 '불명')","value":경품 1인분 추정 가치(원, 정수),"winners":당첨자 수(모르면 1),"worth":1~5}
worth 기준 = 기대값 EV = value × winners ÷ max(comments, 20).
  5: EV ≥ 50,000  4: EV ≥ 10,000  3: EV ≥ 2,000  2: EV ≥ 300  1: 그 미만
  강제 1: 경품이 상품권·기프티콘·커피 5천원 이하 / 구매·인증·카페 가입·앱 설치가 조건 / 공동구매·할인·라이브·결과 발표 영상 등 실제 추첨이 아님
  가치가 불명이면 채널 성격으로 추정하되(리뷰 채널의 제품 증정 ≈ 5~20만, 개인 채널의 소소한 선물 ≈ 1~3만) 과대평가하지 마라.
  신뢰가 낮으면 value 0, worth 1: 채널 규모에 비해 경품이 과하게 크고("전부 나눔"·고가 전기자전거 등) 응모 방법이 영상 밖(다른 영상 링크·라이브 참여·외부 채널)으로 넘어가는 경우. (2026-10 모빌란트)
  사용자에게 필요 없는 경품이면 value 0, worth 1 (큰 이벤트 예외도 막기 위해 value 를 0으로): 다이어트·곤약 식품, 당뇨·환자용 식품·건강기능식품, 신발. (2026-10 응모해 보니 쓸모없었음, 당뇨 없음)
"""

def get(url):
    with urllib.request.urlopen(url, timeout=120) as r: return json.loads(r.read())

def gas_post(body):
    req = urllib.request.Request(GAS, data=json.dumps({**body, 'token': TOKEN}).encode(), headers={'Content-Type': 'text/plain;charset=utf-8'})
    with urllib.request.urlopen(req, timeout=60) as r: return r.read().decode()

def grade(events):
    """claude -p 로 채점. 실패하면 빈 dict — 서버가 grade 행이 없는 이벤트를 다음 실행에도 다시 주므로(toHandOff) 잃지 않는다."""
    if not events: return {}
    items = [{'id': e['id'], 'channel': e['channel'], 'title': e['title'][:80], 'excerpt': e['excerpt'][:200], 'comments': int(re.search(r'댓글 (\d+)', e['stats'] or '댓글 0').group(1)) if re.search(r'댓글 (\d+)', e['stats'] or '') else 0, 'subs': e['stats']} for e in events]
    try:
        out = subprocess.run([CLAUDE, '-p', PROMPT + json.dumps(items, ensure_ascii=False), '--output-format', 'json', '--model', 'haiku'],
                             capture_output=True, text=True, timeout=900, env={**os.environ, 'PATH': os.environ.get('PATH', '') + ':' + os.path.dirname(CLAUDE)})
        d = json.loads(out.stdout)
        if d.get('is_error'): raise RuntimeError(d.get('result'))   # 로그인 만료 등. 안 하면 에러 문장을 JSON 으로 읽다 'Expecting value' 만 남는다
        text = d['result']
        text = re.sub(r'^```\w*\s*|\s*```$', '', text.strip())
        graded = {g['id']: g for g in json.loads(text) if g.get('id')}
    except Exception as ex:
        log('채점 실패:', ex, (out.stdout if 'out' in dir() else '')[:300]); return {}
    rows = [f"{stamp()}|{i}|grade|{int(g.get('value') or 0)}|{int(g.get('winners') or 1)}|{int(g.get('worth') or 0)}|{str(g.get('prize', '')).replace('|', '/')}" for i, g in graded.items()]
    if rows: gas_post({'action': 'health', 'type': 'events', 'rows': '\n'.join(rows)})
    return graded

# 당첨 경험이 있는 채널은 응모가치와 무관하게 경품이 이 금액 이상이면 알린다 (이마트24: 3천원권 당첨, 1만원↑만 원함)
VIP = {'이마트24': 10000}
vip = lambda e: any(k in e['channel'] and int(e['grade'].get('value') or 0) >= v for k, v in VIP.items())

# 큰 회사의 큰 이벤트는 댓글이 많아 응모가치(기대값)가 낮게 나오지만 놓치기 싫다 → 구독 10만↑ 채널이고
# 1인 경품 10만원↑ 또는 총 경품 50만원↑ 이면 알린다. 구독 수는 서버가 stats 에 "구독 38만" 꼴로 준다.
def subs(e):
    m = re.search(r'구독 ([\d.]+)(만)?', e.get('stats') or '')
    return int(float(m.group(1)) * (10000 if m.group(2) else 1)) if m else 0
big = lambda e: subs(e) >= 100000 and (int(e['grade'].get('value') or 0) >= 100000 or int(e['grade'].get('value') or 0) * int(e['grade'].get('winners') or 1) >= 500000)

stamp = lambda: datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def coach():
    """오늘 보낼 가계부 코치 알림이 있으면 미리알림 하나. 실패해도 이벤트 단계는 막지 않는다."""
    try:
        d = get(f"{BASE}/api/coach?t={urllib.parse.quote(TOKEN)}")
        a = d.get('alert')
        if not a: log('코치: 오늘 알림 없음'); return
        now = datetime.now().astimezone()
        at = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if at <= now: at = now + timedelta(minutes=1)   # 09:00 이 지났으면 바로. 울리는 건 iCloud 로 받은 폰이 한다
        r = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(DIR / 'coachalert.js'), a['title'], a['body'], at.isoformat()],
                           capture_output=True, text=True, timeout=120)
        if r.returncode: raise RuntimeError(r.stderr.strip()[:200])
        log('코치:', a['title'], '·', r.stdout.strip())
    except Exception as ex:
        log('코치 실패:', ex)

def main():
    url = f"{BASE}/api/events?t={urllib.parse.quote(TOKEN)}" + ('&all=1' if os.environ.get('ALL') else '')
    data = get(url)
    fresh = [e for e in data['events'] if not e.get('grade')]
    graded = grade(fresh)
    for e in data['events']:
        if e['id'] in graded: e['grade'] = graded[e['id']]
    keep = [e for e in data['events'] if e.get('grade') and (int(e['grade'].get('worth') or 0) >= WORTH_MIN or vip(e) or big(e))]
    payload = {'events': keep, 'applied': data.get('applied', []), 'hints': data.get('hints', [])}
    tmp = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8'); json.dump(payload, tmp, ensure_ascii=False); tmp.close()
    # 맥이 잠겨 있으면 미리알림이 AppleEvent 시간 초과(-1712)로 실패한다. 서버는 이벤트를 하루 한 번만 주니
    # 다음 날로 미루면 그날 알림이 사라진다 → 같은 payload 로 1시간 뒤 한 번 더.
    for attempt in (1, 2):
        r = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(DIR / 'eventsync.js'), tmp.name], capture_output=True, text=True)
        if r.returncode == 0 or attempt == 2: break
        log('미리알림 실패, 1시간 뒤 재시도:', r.stderr.strip()[:200])
        time.sleep(3600)
    os.unlink(tmp.name)
    log(f"이벤트 {len(data['events'])}건(채점 {len(graded)}) · 알림 대상 {len(keep)}건(가치≥{WORTH_MIN}) · 응모중 {len(payload['applied'])} · 당첨후보 {len(payload['hints'])} · 스캔 {data.get('scanned')}채널 +{data.get('added')}"
        + (f" · 실패 {', '.join(data['errors'])}" if data.get('errors') else '') + ' · ' + (r.stdout.strip() or r.stderr.strip()))

if __name__ == '__main__':
    coach()   # 빠르고 상태가 없다 — 먼저. 이벤트의 1시간 재시도에 묶이지 않게
    if datetime.now().hour >= 9:   # 이벤트 서버는 넘길 때 상태를 바꾼다 → 잠긴 07:27 에는 돌리지 않는다
        try: main()
        except Exception as ex: log('이벤트 실패:', ex)
