#!/usr/bin/env python3
"""iOS 단축어 '건강 업로드' 생성기 — 애플워치 수면 샘플을 GAS ?action=health 로 GET 전송.

    python3 gas/build_health_shortcut.py <out_dir>   # 건강 업로드.xml, 컨디션.xml 생성 (.env의 VITE_SYNC_URL/TOKEN 사용)
    for n in "건강 업로드" "컨디션"; do cp "<out_dir>/$n.xml" "/tmp/$n.shortcut"; shortcuts sign --mode anyone --input "/tmp/$n.shortcut" --output ~/Downloads/"$n.shortcut"; done

단축어 POST는 GAS 302에서 깨지므로 GET. 같은 행은 서버가 버리므로 여러 번 돌아도 무해.
"""
import plistlib, sys, uuid, pathlib

env = dict(l.split('=', 1) for l in pathlib.Path(__file__).with_name('..').joinpath('.env').resolve().read_text().splitlines() if '=' in l)
GAS_URL, TOKEN = env['VITE_SYNC_URL'].strip(), env['VITE_SYNC_TOKEN'].strip()
OBJ = '￼'
# 업로드 단축어 이름은 영문이어야 한다. 앱의 "워치에서 가져오기" 가 shortcuts:// 로 부르는데
# URL 경로에서 한글 이름은 매칭이 깨진다(단축어 안에서 한글 이름으로 부르는 것은 정상).
UPLOAD_NAME = 'healthsync'
U = lambda: str(uuid.uuid4()).upper()

def token_string(parts):
    """parts: 문자열 또는 attachment dict 의 리스트 → WFTextTokenString."""
    s, att = '', {}
    for p in parts:
        if isinstance(p, str): s += p
        else: att[f'{{{len(s)}, 1}}'] = p; s += OBJ
    return {'Value': {'string': s, 'attachmentsByRange': att}, 'WFSerializationType': 'WFTextTokenString'}

def out_ref(uid, name):
    return {'Value': {'OutputUUID': uid, 'OutputName': name, 'Type': 'ActionOutput'}, 'WFSerializationType': 'WFTextTokenAttachment'}

def out_text(uid, name):
    """텍스트형(Text) 파라미터용 — 첨부 형식이면 실행 시 빈 값이 되므로 문자열 토큰으로 감싼다."""
    return token_string([{'OutputUUID': uid, 'OutputName': name, 'Type': 'ActionOutput'}])

def item_prop(prop, date_fmt=None):
    ag = [{'PropertyName': prop, 'Type': 'WFPropertyVariableAggrandizement'}]
    if date_fmt:
        ag.append({'Type': 'WFDateFormatVariableAggrandizement', 'WFDateFormatStyle': 'Custom', 'WFDateFormat': date_fmt, 'WFISO8601IncludeTime': False})
    return {'Type': 'Variable', 'VariableName': 'Repeat Item', 'Aggrandizements': ag}

def act(ident, **params):
    return {'WFWorkflowActionIdentifier': f'is.workflow.actions.{ident}', 'WFWorkflowActionParameters': params}

def upload_block(health_type, sheet_type, days, group_by=None, props=('Start Date', 'End Date', 'Value')):
    """Find Health Samples → 반복(시작|종료|값) → 결합 → URL인코딩 → GET. 마지막 액션 UUID 반환."""
    find, loop, end, comb, enc, get, cnt = U(), U(), U(), U(), U(), U(), U()
    row = lambda op, prop, values, removable: {'Bounded': True, 'Operator': op, 'Property': prop, 'Removable': removable, 'Values': values}
    return [
        act('filter.health.quantity', UUID=find, WFContentItemFilter={
            'Value': {'WFActionParameterFilterPrefix': 1, 'WFContentPredicateBoundedDate': False, 'WFActionParameterFilterTemplates': [
                row(4, 'Type', {'Enumeration': {'Value': health_type, 'WFSerializationType': 'WFStringSubstitutableState'}}, False),
                row(1001, 'Start Date', {'Number': str(days), 'Unit': 16}, True),   # 최근 N일 (NSCalendarUnitDay=16)
            ]}, 'WFSerializationType': 'WFContentPredicateTableTemplate'},
            WFContentItemSortProperty='Start Date', WFContentItemSortOrder='Latest First',
            # 제한은 그룹화 전(샘플 단위)에 걸려서, 하루 수백 샘플인 칼로리 같은 건 합계가 잘린다 → 일 그룹화 블록은 제한 없음
            **({'WFHKSampleFilteringGroupBy': group_by, 'WFHKSampleFilteringFillMissing': False} if group_by
               else {'WFContentItemLimitEnabled': True, 'WFContentItemLimitNumber': 200})),
        act('count', UUID=cnt, WFCountType='Items', Input=out_ref(find, 'Health Samples'), WFInput=out_ref(find, 'Health Samples')),
        act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=0, WFInput=out_ref(find, 'Health Samples')),
        act('gettext', UUID=U(), WFTextActionText=token_string(sum(
            [[item_prop(p, 'yyyy-MM-dd HH:mm' if 'Date' in p else None), '|'] for p in props], [])[:-1])),
        act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=2, UUID=end),
        act('text.combine', UUID=comb, WFTextSeparator='New Lines', text=out_text(end, 'Repeat Results')),
        act('urlencode', UUID=enc, WFEncodeMode='Encode', WFInput=out_text(comb, 'Combined Text')),
        act('downloadurl', UUID=get, WFHTTPMethod='GET', WFURL=token_string([
            f'{GAS_URL}?action=health&type={sheet_type}&token={TOKEN}&rows=', {'OutputUUID': enc, 'OutputName': 'URL Encoded Text', 'Type': 'ActionOutput'}])),
    ], {'get': get, 'cnt': cnt}

comment = lambda t: act('comment', WFCommentActionText=t)
# Actions 앱(https://sindresorhus.com/actions, 무료, iOS 전용)의 "Find Workout". 애플 기본 액션엔 운동 세션 읽기가 없다.
# 식별자·속성명은 /Applications/Actions.app/Contents/Resources/Metadata.appintents/extract.actionsdata 에서 확인.
WORKOUT_PROPS = ('startDate', 'endDate', 'workoutType', 'duration', 'activeCalories', 'totalDistance', 'averageHeartRate')

def workout_block(limit=10):
    find, loop, end, comb, enc, get, cnt = U(), U(), U(), U(), U(), U(), U()
    return [
        {'WFWorkflowActionIdentifier': 'com.sindresorhus.Actions.WorkoutAppEntity', 'WFWorkflowActionParameters': {
            'UUID': find,
            'AppIntentDescriptor': {'BundleIdentifier': 'com.sindresorhus.Actions', 'Name': 'Workout', 'TeamIdentifier': 'YG56YK5RN5', 'AppIntentIdentifier': 'WorkoutAppEntity'},
            'WFContentItemInputParameter': 'Library', 'WFCompoundType': 1,
            'WFContentItemSortProperty': 'startDate', 'WFContentItemSortOrder': 'Latest First',
            'WFContentItemLimitEnabled': True, 'WFContentItemLimitNumber': limit}},
        act('count', UUID=cnt, WFCountType='Items', Input=out_ref(find, 'Workouts'), WFInput=out_ref(find, 'Workouts')),
        act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=0, WFInput=out_ref(find, 'Workouts')),
        act('gettext', UUID=U(), WFTextActionText=token_string(sum(
            [[item_prop(p, 'yyyy-MM-dd HH:mm' if 'Date' in p else None), '|'] for p in WORKOUT_PROPS], [])[:-1])),
        act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=2, UUID=end),
        act('text.combine', UUID=comb, WFTextSeparator='New Lines', text=out_text(end, 'Repeat Results')),
        act('urlencode', UUID=enc, WFEncodeMode='Encode', WFInput=out_text(comb, 'Combined Text')),
        act('downloadurl', UUID=get, WFHTTPMethod='GET', WFURL=token_string([
            f'{GAS_URL}?action=health&type=workout&token={TOKEN}&rows=', {'OutputUUID': enc, 'OutputName': 'URL Encoded Text', 'Type': 'ActionOutput'}])),
    ], {'get': get, 'cnt': cnt}

# (알림 라벨, 건강 타입 라벨, 탭, 최근 N일, 그룹화, 속성). 하루 종일 쌓이는 값은 Day 그룹화로 하루 한 줄.
BLOCKS = [
    ('수면',   'Sleep',                  'sleep',        2, None,  ('Start Date', 'End Date', 'Value')),
    ('안정심박', 'Resting Heart Rate',   'resting_hr',   3, 'Day', ('Start Date', 'End Date', 'Value')),
    ('HRV',   'Heart Rate Variability',  'hrv',          3, 'Day', ('Start Date', 'End Date', 'Value')),
    # 걸음은 제외: 일 그룹화 합이 워치+폰을 이중 합산함(건강 앱 8,935 vs 단축어 17,399). 백필(backfill_health.py)로만 채운다.
    ('칼로리', 'Active Calories',        'active_kcal',  3, 'Day', ('Start Date', 'End Date', 'Value')),
    # 샘플 0개면 단축어가 멈추므로, 비어 있을 수 있는 블록은 맨 뒤에 둔다
    # 운동 세션은 제외: Find Health Samples 타입 라벨 'Workouts'/'Workout' 모두 미인식. 백필(backfill_health.py)로만 채운다.
    ('VO2',   'VO2 Max',                 'vo2max',      60, None,  ('Start Date', 'End Date', 'Value')),
    # 준비도가 쓰는 8개 성분 중 손목온도(0.10)·호흡수(0.05)가 매일 안 들어오고 있었다.
    # 백필로만 채워져서 항상 며칠 뒤처졌고, 그래서 준비도가 6개 성분으로만 계산됐다.
    # 특히 손목온도는 질병 신호의 핵심인데 그게 빠진 채 "질병 신호를 살피라"고 말하고 있었다.
    # 타입 라벨이 틀리면 그 블록에서 멈추므로 맨 뒤에 둔다(앞 블록은 이미 전송 완료).
    ('호흡수',  'Respiratory Rate',       'respiratory_rate', 3, 'Day', ('Start Date', 'End Date', 'Value')),
    # 'Sleep Wrist Temperature'. 'Wrist Temperature' 도 'Sleeping Wrist Temperature' 도 아니다.
    # 둘 다 0개가 나왔는데, 단축어는 모르는 열거값을 오류로 알리지 않고 원문을 그대로 보여주며
    # 조용히 0개를 돌려준다. 그래서 권한·데이터 문제로 착각하고 한참 헤맸다.
    # 결국 폰에서 목록으로 고른 뒤 iCloud 로 동기화된 ~/Library/Shortcuts/Shortcuts.sqlite 의
    # ZSHORTCUTACTIONS.ZDATA(바이너리 plist)를 열어 실제 값을 읽었다.
    #   sqlite3 ~/Library/Shortcuts/Shortcuts.sqlite \
    #     "select writefile('/tmp/hs.bin', ZDATA) from ZSHORTCUTACTIONS
    #      where ZSHORTCUT=(select Z_PK from ZSHORTCUT where ZNAME='healthsync')"
    # 새 타입을 추가할 때 라벨이 안 먹으면 추측하지 말고 이 방법으로 읽을 것.
    # 잠잘 때만 재는 값이라 밤을 걸러 비는 날이 많다(120일에 39일). 창은 30일.
    ('손목온도', 'Sleep Wrist Temperature', 'wrist_temp', 30, 'Day', ('Start Date', 'End Date', 'Value')),
]
# 하루 1회 가드: iCloud Drive/Shortcuts/health_run/<오늘>.txt 가 있으면 즉시 종료(앱 열 때 트리거로 여러 번 돌아도 한 번만).
# 조건문에 변수 비교를 넣으면 앱이 값을 못 읽어서, 파일 이름을 날짜로 하고 "값이 있음"만 검사한다.
today_txt, last_file, guard = U(), U(), U()
hour_txt, early, night, manual = U(), U(), U(), U()
# 가드 키 = 오늘 날짜 + 단축어 입력. 입력이 없으면 health_run/<오늘>.txt(자동화 = 하루 1회),
# 앱의 "워치에서 가져오기"(입력 force)는 가드 검사를 건너뛰어 항상 돈다.
# 두 토큰을 첫 텍스트 액션에 함께 넣는다 — 경로에 섞어 넣으면 화면에서 보이지 않아 확인이 어렵다.
guard_path = lambda: token_string(['health_run/', {'OutputUUID': today_txt, 'OutputName': 'Text', 'Type': 'ActionOutput'}, '.txt'])
# 새벽 0~4시에는 아무것도 하지 않는다.
# 알람 보려고 시계 앱을 열면 자동화가 돌고, 그 실행이 그날 마커를 써버려서
# 정작 아침에는 "이미 돌았다"고 종료했다. 그날 수면과 준비도가 통째로 빈다.
# 게다가 그 시각엔 잠이 진행 중이라 끊긴 수면 구간이 올라가 총수면이 부풀 수 있다.
#
# 시각 비교 대신 문자열 매칭을 쓴다. 'HH' 를 정규식으로 보는 것이라
# 혹시 Match Text 가 값을 안 돌려줘도 조건이 거짓이 되어 예전과 똑같이 동작한다.
# (날짜 빼기로 구현하면 실패했을 때 파일 이름이 비어 영영 안 도는 쪽으로 깨진다)
night_guard = [
    act('gettext', UUID=hour_txt, WFTextActionText=token_string([
        {'Type': 'CurrentDate', 'Aggrandizements': [
            {'Type': 'WFDateFormatVariableAggrandizement', 'WFDateFormatStyle': 'Custom', 'WFDateFormat': 'HH', 'WFISO8601IncludeTime': False}]}])),
    act('text.match', UUID=early, WFMatchTextPattern='^0[0-4]$', WFMatchTextCaseSensitive=False,
        text=out_text(hour_txt, 'Text')),
    act('conditional', GroupingIdentifier=night, WFControlFlowMode=0, WFCondition=100,
        WFInput={'Type': 'Variable', 'Variable': out_ref(early, 'Matches')}),
    act('exit'),
    act('conditional', GroupingIdentifier=night, WFControlFlowMode=2, UUID=U()),
]

ext_input = {'Type': 'Variable', 'Variable': {'Value': {'Type': 'ExtensionInput'}, 'WFSerializationType': 'WFTextTokenAttachment'}}
guard_actions = night_guard + [
    # 날짜는 항상 계산한다. 마지막의 마커 저장 경로에도 쓰인다.
    act('gettext', UUID=today_txt, WFTextActionText=token_string([
        {'Type': 'CurrentDate', 'Aggrandizements': [
            {'Type': 'WFDateFormatVariableAggrandizement', 'WFDateFormatStyle': 'Custom', 'WFDateFormat': 'yyyy-MM-dd', 'WFISO8601IncludeTime': False}]},
        {'Type': 'ExtensionInput'}])),
    # 입력이 있으면(앱의 "워치에서 가져오기") 가드를 아예 건너뛴다.
    # 예전엔 이름만 다른 마커(<날짜>force.txt)를 썼는데, 그걸 검사도 하고 쓰기도 해서
    # 앱 버튼도 결국 하루 1회가 됐다. 운동 끝나고 당겨오는 게 이 버튼의 존재 이유인데
    # 그날 이미 한 번 눌렀으면 조용히 아무 일도 일어나지 않았다.
    act('conditional', GroupingIdentifier=manual, WFControlFlowMode=0, WFCondition=100, WFInput=ext_input),
    act('conditional', GroupingIdentifier=manual, WFControlFlowMode=1),
    act('documentpicker.open', UUID=last_file, WFGetFilePath=guard_path(), WFShowFilePicker=False, WFFileErrorIfNotFound=False),
    act('conditional', GroupingIdentifier=guard, WFControlFlowMode=0, WFCondition=100,   # 100 = 값이 있음
        WFInput={'Type': 'Variable', 'Variable': out_ref(last_file, 'File')}),
    act('exit'),
    act('conditional', GroupingIdentifier=guard, WFControlFlowMode=2, UUID=U()),
    act('conditional', GroupingIdentifier=manual, WFControlFlowMode=2, UUID=U()),
]

actions = [
    comment(f'{UPLOAD_NAME}: 애플워치 데이터를 가계부 GAS 건강 시트로 보낸다(탭: sleep, resting_hr, hrv, active_kcal, vo2max, workout). 같은 행은 서버가 버리므로 여러 번 실행해도 됨.'),
    comment('생성: personal-money-app/gas/build_health_shortcut.py (직접 고치지 말고 스크립트를 수정해서 다시 서명)'),
    comment('새벽 0~4시 종료: 알람 보려고 시계 앱을 연 실행이 그날 몫을 태우지 않게. 그 시각엔 수면이 진행 중이라 올릴 것도 없다.'),
    comment('하루 1회 가드: 오늘 날짜 + 단축어 입력으로 파일 이름을 만들고, 그 파일이 있으면 종료. 앱에서 force 를 넘기면 이름이 달라져 항상 다시 돈다.'),
] + guard_actions
noti = []
for label, health_type, tab, days, group_by, props in BLOCKS:
    blk, ref = upload_block(health_type, tab, days, group_by, props)
    actions += blk[:1] + [comment(f'{label}: 샘플마다 "{"|".join(props)}" 한 줄 → 줄바꿈으로 합쳐 GET 전송')] + blk[1:]
    noti += [f'{label} ', {'OutputUUID': ref['cnt'], 'OutputName': 'Count', 'Type': 'ActionOutput'}, ' · ']
blk, ref = workout_block()
actions += [comment('운동: Actions 앱의 Find Workout(최신 10개) → "시작|종료|종류|시간|kcal|거리|평균심박" → workout 탭')] + blk
noti += ['운동 ', {'OutputUUID': ref['cnt'], 'OutputName': 'Count', 'Type': 'ActionOutput'}, ' · ']
actions.append(act('documentpicker.save', WFInput=out_text(today_txt, 'Text'), WFFileDestinationPath=guard_path(), WFAskWhereToSave=False, WFSaveFileOverwrite=True))
# 업로드 직후 서버에서 오늘 준비도 텍스트를 받아 알림으로(워치에도 뜸). /api/today 는 GAS 토큰으로 인증.
TODAY_URL = f"{GAS_URL.split('/macros/')[0] and 'https://personal-money-app-seven.vercel.app'}/api/today?t={TOKEN}"
today_get = U()
actions.append(act('downloadurl', UUID=today_get, WFHTTPMethod='GET', WFURL=TODAY_URL))
actions.append(act('notification', WFNotificationActionSound=False, WFNotificationActionTitle='오늘 준비도',
    WFNotificationActionBody=token_string([{'OutputUUID': today_get, 'OutputName': 'Contents of URL', 'Type': 'ActionOutput'}, '\n컨디션 기록 → 액션 버튼(컨디션 단축어)\n- 업로드 '] + noti[:-1])))

LOG_URL = f"https://personal-money-app-seven.vercel.app/api/log?t={TOKEN}&text="
ck_today, ask, cond_if, cond_txt, cond_enc, cond_get = U(), U(), U(), U(), U(), U()
checkin = [
    comment('아침 체크인: 업로드(오늘 안 됐으면) → 준비도 보여주며 컨디션 4개 입력 → 저장. 액션 버튼/위젯에 걸어 손으로 실행.'),
    act('runworkflow', WFWorkflowName=UPLOAD_NAME, WFShowWorkflow=False),
    act('downloadurl', UUID=ck_today, WFHTTPMethod='GET', WFURL=TODAY_URL),
    act('ask', UUID=ask, WFInputType='Text', WFAllowsMultilineText=False,
        WFAskActionPrompt=token_string([{'OutputUUID': ck_today, 'OutputName': 'Contents of URL', 'Type': 'ActionOutput'},
                                        '\n\n지금 컨디션은? 수면질 피로 스트레스 근육통 (각 1~5)\n예: 4 3 2 3'])),
    act('conditional', GroupingIdentifier=cond_if, WFControlFlowMode=0, WFCondition=100, WFInput={'Type': 'Variable', 'Variable': out_ref(ask, 'Provided Input')}),
    act('gettext', UUID=cond_txt, WFTextActionText=token_string(['컨디션 ', {'OutputUUID': ask, 'OutputName': 'Provided Input', 'Type': 'ActionOutput'}])),
    act('urlencode', UUID=cond_enc, WFEncodeMode='Encode', WFInput=out_text(cond_txt, 'Text')),
    act('downloadurl', UUID=cond_get, WFHTTPMethod='GET', WFURL=token_string([LOG_URL, {'OutputUUID': cond_enc, 'OutputName': 'URL Encoded Text', 'Type': 'ActionOutput'}])),
    act('notification', WFNotificationActionSound=False, WFNotificationActionTitle='컨디션',
        WFNotificationActionBody=token_string([{'OutputUUID': cond_get, 'OutputName': 'Contents of URL', 'Type': 'ActionOutput'}])),
    act('conditional', GroupingIdentifier=cond_if, WFControlFlowMode=2, UUID=U()),
]

def document(name, acts, glyph, color):
    return {
        'WFWorkflowName': name, 'WFWorkflowActions': acts,
        'WFWorkflowClientVersion': '2700.0.4', 'WFWorkflowClientRelease': '26A0000a',
        'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': glyph, 'WFWorkflowIconStartColor': color},
        'WFWorkflowHasOutputFallback': False, 'WFWorkflowImportQuestions': [], 'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': ['Watch'], 'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowInputContentItemClasses': ['WFStringContentItem'],
    }

out_dir = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
for name, acts, glyph, color in [(UPLOAD_NAME, actions, 61440, 4282601983), ('컨디션', checkin, 61440, 463140863)]:
    (out_dir / f'{name}.xml').write_bytes(plistlib.dumps(document(name, acts, glyph, color), fmt=plistlib.FMT_XML))
    print(out_dir / f'{name}.xml', len(acts), 'actions')
