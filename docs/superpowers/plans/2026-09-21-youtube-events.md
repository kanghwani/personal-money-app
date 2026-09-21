# 유튜브 구독자 이벤트 Implementation Plan

**Goal:** 고정 채널 목록을 매일 스캔해 구독자 이벤트를 시트에 쌓고, 단축어가 미리알림을 만들고, 클로드 앱 한 줄로 지원·결과를 기록한다.

**Architecture:** GAS 수정 없음(건강 탭 저장 경로 재사용). 순수 함수 `api/_events.ts` + 엔드포인트 `api/events.ts` + MCP 툴 2개 + 단축어 생성기.

**Spec:** `docs/superpowers/specs/2026-09-21-youtube-events-design.md`

## Global Constraints

- `api/` 의 `.ts` 는 서버리스 함수. 모듈·테스트는 `_` 접두어.
- `Array.prototype.at` 금지. 테스트는 네트워크 안 탐.
- 기존 툴 `inputSchema` 는 건드리지 않는다(커넥터 재추가 불필요). 새 툴만 추가.
- 상태는 추가만. 수정·삭제 없음.

### Task 1: 파서 (`api/_events.ts` + `api/_events.test.ts`)
- [ ] `isEvent(title, desc)`, `extractDates(desc, publishedAt)`, `excerpt(desc)`, `detect(snippet) → EventNew | null`
- [ ] `fold(rows) → Map<videoId, Event>` (마지막 상태), `queue(events, today)`, `parseEventLog(text)`, `parseChannelInput(text)`
- [ ] 픽스처 3~4개로 단언

### Task 2: 엔드포인트 (`api/events.ts`)
- [ ] `scanAndLoad()` 공용 함수(_events.ts 에 fetch 포함, 키 없으면 스캔 생략) → `api/events.ts` 는 인증·peek·format 만
- [ ] 응답 JSON/text

### Task 3: MCP (`api/mcp.ts`)
- [ ] `event_list`, `event_log` 정의·핸들러·instructions 한 문장
- [ ] `npm run tools:lock`, `npm test`

### Task 4: 단축어 (`gas/shortcut_lib.py`, `gas/build_event_shortcut.py`)
- [ ] 헬퍼 분리 후 건강 생성기 출력이 이전과 동일한지 diff
- [ ] `eventsync.xml` 생성 → `shortcuts sign`

### Task 5: 검증·배포
- [ ] tsc(api), vitest, `npm run deploy:prod`, `/api/events?t=…&peek=1&format=text`
- [ ] README 한 단락, devlog
