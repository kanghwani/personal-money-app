#!/usr/bin/env python3
"""iOS 단축어 '건강 업로드' 생성기 — 애플워치 수면 샘플을 GAS ?action=health 로 GET 전송.

    python3 gas/build_health_shortcut.py out.shortcut   # .env의 VITE_SYNC_URL/TOKEN 사용
    shortcuts sign --mode anyone --input out.shortcut --output "건강 업로드.shortcut"

단축어 POST는 GAS 302에서 깨지므로 GET. 같은 행은 서버가 버리므로 여러 번 돌아도 무해.
"""
import plistlib, sys, uuid, pathlib

env = dict(l.split('=', 1) for l in pathlib.Path(__file__).with_name('..').joinpath('.env').resolve().read_text().splitlines() if '=' in l)
GAS_URL, TOKEN = env['VITE_SYNC_URL'].strip(), env['VITE_SYNC_TOKEN'].strip()
OBJ = '￼'
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

def upload_block(health_type, sheet_type, days):
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
            WFContentItemLimitEnabled=True, WFContentItemLimitNumber=200),   # 필터가 깨져도 전체 기록을 돌지 않게
        act('count', UUID=cnt, WFCountType='Items', Input=out_ref(find, 'Health Samples'), WFInput=out_ref(find, 'Health Samples')),
        act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=0, WFInput=out_ref(find, 'Health Samples')),
        act('gettext', UUID=U(), WFTextActionText=token_string([
            item_prop('Start Date', 'yyyy-MM-dd HH:mm'), '|', item_prop('End Date', 'yyyy-MM-dd HH:mm'), '|', item_prop('Value')])),
        act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=2, UUID=end),
        act('text.combine', UUID=comb, WFTextSeparator='New Lines', text=out_text(end, 'Repeat Results')),
        act('urlencode', UUID=enc, WFEncodeMode='Encode', WFInput=out_text(comb, 'Combined Text')),
        act('downloadurl', UUID=get, WFHTTPMethod='GET', WFURL=token_string([
            f'{GAS_URL}?action=health&type={sheet_type}&token={TOKEN}&rows=', {'OutputUUID': enc, 'OutputName': 'URL Encoded Text', 'Type': 'ActionOutput'}])),
    ], {'get': get, 'cnt': cnt}

comment = lambda t: act('comment', WFCommentActionText=t)
sleep, ref = upload_block('Sleep', 'sleep', 2)
actions = [
    comment('건강 업로드: 애플워치 수면 샘플을 가계부 GAS 시트(sleep 탭)로 보낸다. 같은 행은 서버가 버리므로 여러 번 실행해도 됨.'),
    comment('생성: personal-money-app/gas/build_health_shortcut.py (직접 고치지 말고 스크립트를 수정해서 다시 서명)'),
] + sleep[:1] + [comment('샘플마다 "시작|종료|값" 한 줄 → 줄바꿈으로 합쳐 GET 전송')] + sleep[1:] + [
    act('notification', WFNotificationActionSound=False, WFNotificationActionTitle='건강 업로드',
        WFNotificationActionBody=token_string([
            '수면 샘플 ', {'OutputUUID': ref['cnt'], 'OutputName': 'Count', 'Type': 'ActionOutput'},
            '개 · 서버 ', {'OutputUUID': ref['get'], 'OutputName': 'Contents of URL', 'Type': 'ActionOutput'}])),
]

doc = {
    'WFWorkflowName': '건강 업로드',
    'WFWorkflowActions': actions,
    'WFWorkflowClientVersion': '2700.0.4', 'WFWorkflowClientRelease': '26A0000a',
    'WFWorkflowMinimumClientVersion': 900, 'WFWorkflowMinimumClientVersionString': '900',
    'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 61440, 'WFWorkflowIconStartColor': 4282601983},
    'WFWorkflowHasOutputFallback': False, 'WFWorkflowImportQuestions': [], 'WFWorkflowOutputContentItemClasses': [],
    'WFWorkflowTypes': [], 'WFWorkflowInputContentItemClasses': [],
}
out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'health.shortcut')
out.write_bytes(plistlib.dumps(doc, fmt=plistlib.FMT_XML))
print(out, len(actions), 'actions')
