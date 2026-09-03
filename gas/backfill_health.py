#!/usr/bin/env python3
"""애플 건강 내보내기(zip) → 건강 시트 탭별 백필.

    python3 gas/backfill_health.py ~/Downloads/내보내기.zip            # 미리보기(전송 안 함)
    python3 gas/backfill_health.py ~/Downloads/내보내기.zip --send     # GAS로 POST 전송

행 형식은 단축어와 동일: 시작|종료|값[|추가]. 일 단위 항목은 시작=그날 00:00, 종료=다음날 00:00.
"""
import zipfile, sys, json, pathlib, urllib.request, time
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta

SLEEP_KO = {'AsleepCore': '코어 수면', 'AsleepDeep': '깊은 수면', 'AsleepREM': 'REM 수면', 'Awake': '깨어 있는 시간',
            'InBed': '침대에 있음', 'AsleepUnspecified': '수면'}
DAILY_VALUE = {   # 하루 한 값(마지막/평균)으로 쓰는 지표 → 탭
    'RestingHeartRate': 'resting_hr', 'HeartRateVariabilitySDNN': 'hrv', 'RespiratoryRate': 'respiratory_rate',
    'OxygenSaturation': 'spo2', 'AppleSleepingWristTemperature': 'wrist_temp', 'AppleSleepingBreathingDisturbances': 'breathing_disturb',
}
RAW = {'VO2Max': 'vo2max'}
WATCH = 'Apple\xa0Watch'

def local(s):  # '2026-09-03 06:33:12 +0900' → '2026-09-03 06:33' (기기 로컬 시각 그대로)
    return s[:16]
def day_of(s):  # 값 측정 시각의 날짜
    return s[:10]
def dayrow(day, value, extra=''):
    nxt = (datetime.strptime(day, '%Y-%m-%d') + timedelta(days=1)).strftime('%Y-%m-%d')
    return [f'{day} 00:00', f'{nxt} 00:00', value, extra]

def extract(zip_path):
    z = zipfile.ZipFile(zip_path)
    name = [i.filename for i in z.infolist() if i.filename.endswith('.xml') and 'cda' not in i.filename][0]
    tabs = defaultdict(list)
    daily = defaultdict(lambda: defaultdict(list))   # tab → day → [values]
    steps = defaultdict(lambda: defaultdict(float))  # day → source → sum (출처별 합 중 최대 = 애플 중복제거 근사)
    for _, el in ET.iterparse(z.open(name), events=('end',)):
        tag = el.tag
        if tag == 'Record':
            t = el.get('type', '').replace('HKQuantityTypeIdentifier', '').replace('HKCategoryTypeIdentifier', '')
            st, en, v, src = el.get('startDate', ''), el.get('endDate', ''), el.get('value', ''), el.get('sourceName', '')
            if t == 'SleepAnalysis':
                ko = SLEEP_KO.get(v.replace('HKCategoryValueSleepAnalysis', ''))
                if ko and (WATCH in src or ko == '침대에 있음'):   # 단계는 워치만, 침대는 어느 출처든
                    tabs['sleep'].append([local(st), local(en), ko, ''])
            elif t in DAILY_VALUE:
                daily[DAILY_VALUE[t]][day_of(st)].append(float(v) * (100 if t == 'OxygenSaturation' else 1))   # 혈중산소는 0.97 → 97
            elif t in RAW:
                tabs[RAW[t]].append([local(st), local(en), v, ''])
            elif t == 'StepCount':
                steps[day_of(st)][src] += float(v)
            el.clear()
        elif tag == 'ActivitySummary':   # 애플 공식 일합계: 활동 칼로리·운동 분·서기 시간
            d = el.get('dateComponents', '')
            if d >= '2017':   # 1969-12-30 같은 깨진 날짜 제외
                tabs['active_kcal'].append(dayrow(d, el.get('activeEnergyBurned', '')))
                tabs['exercise_min'].append(dayrow(d, el.get('appleExerciseTime', '')))
                tabs['stand_hours'].append(dayrow(d, el.get('appleStandHours', '')))
            el.clear()
        elif tag == 'Workout':
            typ = el.get('workoutActivityType', '').replace('HKWorkoutActivityType', '')
            kcal = dist = hr = ''
            for c in el:
                if c.tag == 'WorkoutStatistics':
                    ct = c.get('type', '')
                    if ct.endswith('ActiveEnergyBurned'): kcal = c.get('sum', '')
                    elif ct.endswith('DistanceWalkingRunning') or ct.endswith('DistanceSwimming') or ct.endswith('DistanceCycling'): dist = c.get('sum', '')
                    elif ct.endswith('HeartRate'): hr = c.get('average', '')
            dur = round(float(el.get('duration', '0')), 1)
            tabs['workout'].append([local(el.get('startDate', '')), local(el.get('endDate', '')), typ, f'{dur}|{kcal}|{dist}|{hr}'])
            el.clear()
    for tab, days in daily.items():
        for d, vals in sorted(days.items()):
            tabs[tab].append(dayrow(d, f'{sum(vals) / len(vals):.1f}'))
    for d, by in sorted(steps.items()):
        tabs['steps'].append(dayrow(d, str(int(max(by.values())))))
    return tabs

def send(tabs, url, token, batch=800):
    for tab, rows in tabs.items():
        for i in range(0, len(rows), batch):
            body = json.dumps({'action': 'health', 'token': token, 'type': tab,
                               'rows': '\n'.join('|'.join(r) for r in rows[i:i + batch])}).encode()
            for attempt in range(4):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers={'Content-Type': 'text/plain;charset=utf-8'}), timeout=120) as r:
                        res = json.loads(r.read())
                    print(tab, i, res.get('added'), 'added', res.get('skipped'), 'skipped'); break
                except Exception as e:
                    print(tab, i, 'retry', attempt, e); time.sleep(3)

if __name__ == '__main__':
    tabs = extract(sys.argv[1])
    for tab, rows in sorted(tabs.items()):
        print(f'{tab:18} {len(rows):6}  {rows[0][0]} ~ {rows[-1][0]}   e.g. {"|".join(rows[-1])}')
    if '--send' in sys.argv:
        env = dict(l.split('=', 1) for l in (pathlib.Path(__file__).parent.parent / '.env').read_text().splitlines() if '=' in l)
        send(tabs, env['VITE_SYNC_URL'].strip(), env['VITE_SYNC_TOKEN'].strip())
