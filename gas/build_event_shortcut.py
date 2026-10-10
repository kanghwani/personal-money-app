#!/usr/bin/env python3
"""iOS 단축어 'eventsync' 생성기 (폰용, 미검증 — 맥은 scripts/eventsync.sh 를 쓴다) — /api/events 를 GET 해 새 구독자 이벤트마다 미리알림 2개(지원·결과)를 만든다.

    python3 gas/build_event_shortcut.py <out_dir>
    cp <out_dir>/eventsync.xml /tmp/eventsync.shortcut && shortcuts sign --mode anyone --input /tmp/eventsync.shortcut --output ~/Downloads/eventsync.shortcut

설치 후: 미리알림 앱에 목록 "이벤트" 를 만들고, 자동화 "매일 09:00 → eventsync 실행"(실행 전에 묻기 끄기).
서버가 스캔·큐 관리를 다 하므로(같은 이벤트는 두 번 안 나온다) 여러 번 돌아도 무해.
이벤트가 0건이면 반복이 안 돌아 알림도 없다 — 조건문 없이 조용하다.

알려진 문제(2026-09-22, 맥 단축어 앱에서 실행): 미리알림에 기한·알림이 안 들어가고 반복 중 일부가 조용히 빠졌다(80개 중 59개).
WFAlertCustomTime 키가 틀렸거나 텍스트→날짜 변환이 안 되는 것으로 보인다. 폰에서 쓰려면 이걸 먼저 고쳐야 한다.
"""
import sys
from shortcut_lib import U, token_string, out_ref, item_key, act, comment, read_env, write

_, TOKEN = read_env()
NAME = 'eventsync'
LIST = '이벤트'
URL = f'https://personal-money-app-seven.vercel.app/api/events?t={TOKEN}'
var = lambda v: {'Value': v, 'WFSerializationType': 'WFTextTokenAttachment'}
title = lambda prefix: token_string([prefix, item_key('channel'), ' · ', item_key('title')])

get, events, loop = U(), U(), U()
actions = [
    comment(f'{NAME}: /api/events 가 스캔한 새 구독자 이벤트마다 미리알림 "[지원]"(마감 전날 09:00)·"[결과]"(발표일 09:00) 를 목록 "{LIST}" 에 만든다.'),
    comment('생성: personal-money-app/gas/build_event_shortcut.py (직접 고치지 말고 스크립트를 수정해서 다시 서명)'),
    act('downloadurl', UUID=get, WFHTTPMethod='GET', WFURL=URL),
    act('getvalueforkey', UUID=events, WFGetDictionaryValueType='Value', WFDictionaryKey='events', WFInput=out_ref(get, 'Contents of URL')),
    act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=0, WFInput=out_ref(events, 'Dictionary Value')),
    act('addnewreminder', WFCalendarItemTitle=title('[지원] '), WFCalendarItemCalendar=LIST,
        WFAlertEnabled=True, WFAlertCustomTime=var(item_key('remindAt')),
        WFCalendarItemNotes=token_string([item_key('url'), '\n마감 ', item_key('deadline'), ' · 발표 ', item_key('announce'), '\n', item_key('excerpt')])),
    act('addnewreminder', WFCalendarItemTitle=title('[결과] '), WFCalendarItemCalendar=LIST,
        WFAlertEnabled=True, WFAlertCustomTime=var(item_key('announceAt')),
        WFCalendarItemNotes=token_string([item_key('url'), '\n당첨자 발표는 커뮤니티 게시글·고정 댓글에서 확인'])),
    act('notification', WFNotificationActionSound=False, WFNotificationActionTitle='새 구독자 이벤트',
        WFNotificationActionBody=token_string([item_key('channel'), ' · ', item_key('title'), '\n마감 ', item_key('deadline')])),
    act('repeat.each', GroupingIdentifier=loop, WFControlFlowMode=2, UUID=U()),
]

write(sys.argv[1] if len(sys.argv) > 1 else '.', NAME, actions, 59511, 4274264319)
