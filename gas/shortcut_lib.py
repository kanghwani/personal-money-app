"""iOS 단축어(.shortcut plist) 생성 공용 헬퍼 — build_health_shortcut.py · build_event_shortcut.py 가 같이 쓴다."""
import pathlib, plistlib, uuid

OBJ = '￼'
U = lambda: str(uuid.uuid4()).upper()

def read_env():
    """저장소 .env 의 VITE_SYNC_URL / VITE_SYNC_TOKEN → (GAS_URL, TOKEN)"""
    env = dict(l.split('=', 1) for l in pathlib.Path(__file__).with_name('..').joinpath('.env').resolve().read_text().splitlines() if '=' in l)
    return env['VITE_SYNC_URL'].strip(), env['VITE_SYNC_TOKEN'].strip()

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

def item_key(key):
    """반복 항목이 사전일 때 그 키의 값 (Repeat Item → 사전 값)."""
    return {'Type': 'Variable', 'VariableName': 'Repeat Item', 'Aggrandizements': [{'Type': 'WFDictionaryValueVariableAggrandizement', 'DictionaryKey': key}]}

def act(ident, **params):
    return {'WFWorkflowActionIdentifier': f'is.workflow.actions.{ident}', 'WFWorkflowActionParameters': params}

comment = lambda t: act('comment', WFCommentActionText=t)

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

def write(out_dir, name, acts, glyph, color):
    out_dir = pathlib.Path(out_dir)
    (out_dir / f'{name}.xml').write_bytes(plistlib.dumps(document(name, acts, glyph, color), fmt=plistlib.FMT_XML))
    print(out_dir / f'{name}.xml', len(acts), 'actions')
