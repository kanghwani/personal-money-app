# personal-money-app

돈에 관한 것은 전부 여기서 처리한다. 가계부(React 앱 + MCP 툴)와 유튜브 구독자 이벤트(경품 → 돈), 둘 다 같은 Vercel 서버리스 API와 Google Apps Script 시트 백엔드를 쓴다.

| 시스템 | 상태 | 위치 |
|---|---|---|
| 가계부 | 유지 | `src/` (React, Vite), MCP `ledger_*` 11개, `gas/Code.gs` |
| 유튜브 구독자 이벤트 | 개발 중 | `api/_events.ts`·`api/events.ts`, MCP `event_list`·`event_log`, `scripts/eventsync.*` (맥 launchd) |
| 서버 API | 공용 | `api/` (Vercel 서버리스). `_` 로 시작하는 파일은 함수가 아니라 모듈·테스트 |
| MCP 서버 | 공용 | `api/mcp.ts` (클로드 앱 커스텀 커넥터가 붙는 곳) |
| 시트 백엔드 | 공용 | `gas/Code.gs` (clasp 로 배포). `health*` 함수는 이름만 남은 범용 탭 저장소로, 이벤트 탭이 쓴다 |
| 클로드 스킬 | 공용 | `skills/ledger`(시트 CLI), `skills/money-coach`(월 결산·노션). `~/.claude/skills` 가 여기로 심볼릭 링크 |

2026-10-10 에 건강 코치·약속 코치·스페인어 인스턴스를 제거했다(iOS 기본 기능으로 대체, 미사용). 필요하면 `git log` 의 그 이전 커밋에 있다.

## 명령

```bash
npm test                 # vitest (네트워크 안 탐)
npm run deploy:prod      # npx vercel --prod
```

Apps Script 배포는 따로:

```bash
cd gas && clasp push -f && clasp deploy --deploymentId AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA
```

## 함정 (여기서 시간을 잃은 것들)

**기존 MCP 툴의 인자를 바꾸면 커넥터를 지웠다 다시 추가해야 한다.**
클로드 앱은 툴 스키마를 캐시한다. 새 툴이 늘어난 것은 목록 새로고침으로 잡히지만,
이미 있던 툴의 `inputSchema` 변경은 잡히지 않는다. 소스도 맞고 실서버도 맞는데
앱만 옛 스키마로 호출하는 상태가 되고, 원인 찾기가 제일 오래 걸린다.
`inputSchema` 를 고쳤으면 배포 뒤 **설정 > 커넥터 > 가계부원격을 삭제하고 같은 URL 로 다시 추가**한다(URL 은 삭제 전에 복사).
한때 잠금 파일·실서버 대조 스크립트로 이걸 막았는데, 인자가 바뀌는 일이 한 달에 한 번도 안 돼서 2026-10 에 걷어냈다.

**핸들러가 읽는 인자는 `inputSchema.properties` 에도 올려야 한다.**
`args.week` 를 읽어도 스키마에 없으면 클라이언트가 조용히 버린다. `api/_mcp-tools.test.ts` 가
핸들러의 `args` 사용·`required`·설명 언급을 스키마와 대조한다.

**`api/` 의 `.ts` 는 전부 서버리스 함수로 잡힌다.** 테스트와 모듈은 `_` 접두어를 붙여야 한다.
(`api/health.test.ts` 를 두었더니 함수로 취급돼 빌드가 깨졌다.)

**`Array.prototype.at` 을 쓰지 말 것.** Vercel 의 기본 lib 타깃이 낮아 빌드가 깨진다.
배포 전 확인: `npx tsc --noEmit --ignoreConfig --strict --skipLibCheck --module nodenext --moduleResolution nodenext --target es2021 api/*.ts`

**`APP_SECRET`·`MCP_SECRET` 은 Vercel Secret 이라 `vercel env pull` 로 못 꺼낸다.**
쿠키·MCP 인증이 필요한 검증은 앱에서 하거나, `SYNC_TOKEN` 을 쓰는 통로(`/api/events`)로 한다.

**GAS 호출은 창 크기와 무관하게 10초 넘게 걸린다.** 시작 오버헤드가 병목이라 한 번에 많이 받는 편이 호출 수를 줄이는 것보다 낫다.

## 유튜브 구독자 이벤트

설계: `docs/superpowers/specs/2026-09-21-youtube-events-design.md`. 가계부와 데이터를 섞지 않고 인프라만 빌린다.

| 조각 | 위치 |
|---|---|
| 판정·날짜·상태·한 줄 문법 | `api/_events.ts` (순수 함수, `api/_events.test.ts`) |
| 스캔 + 미리알림 큐 | `api/events.ts` — 감시 채널 최근 10개 + 하루 한 번 검색("댓글 이벤트"·"구독자 이벤트", 7일). 단축어나 `event_list` 가 부른다. cron 없음 |
| 폰 입력·조회 | MCP `event_list`, `event_log` |
| 저장 | 건강 데이터 스프레드시트 탭 `events`·`event_channels` (GAS 수정 없음, 추가만) |
| 당첨 검사 | `checkResults` — 발표일 지난 지원 건마다 영상 설명·상단 댓글·채널의 내 댓글 답글·채널 새 영상에서 `YT_HANDLE` 을 찾아 `hint` 행. 확정은 사람이 "당첨/탈락". 커뮤니티 게시글은 못 본다 |
| 채점 | `scripts/eventsync.py` 가 미채점 이벤트를 `claude -p --model haiku` 로 채점(경품·1인분 가치·당첨자수·응모가치 1~5) → `grade` 행. 규칙으로는 못 한다 — 경품이 이름뿐이라 금액 정규식은 91건 중 14건만, 그마저 영상 속 가격을 집었다 |
| 맥 알림 | `scripts/eventsync.sh`(+`eventsync.js`) — launchd(`scripts/com.hwan.eventsync.plist`)가 매일 09:00·로그인 시 실행, 미리알림 "이벤트" 목록에 **응모가치 4 이상**만 [지원], **응모한 것만** [결과], 당첨 후보는 [당첨확인]. `ALL=1` 이면 남은 이벤트 전부 다시, `WORTH_MIN=3` 으로 기준 조정 |
| 폰 단축어(미검증) | `python3 gas/build_event_shortcut.py <out_dir>` → `shortcuts sign`. 미리알림 기한이 안 들어가는 문제 있음 |

**채널 RSS 는 못 쓴다.** 십만양품·디에디트·기즈모가 404, ITSub 이 500 을 돌려준다(채널마다 다르고 채널 페이지는 RSS 링크를 광고한다).
그래서 `YOUTUBE_API_KEY`(Vercel 환경변수, 키만·OAuth 없음)로 `playlistItems` 를 읽는다. 채널당 하루 1단위, 한도 1만.
키가 없으면 스캔만 건너뛰고 큐·기록은 동작한다. 검색은 1회 100단위라 시트의 `_search` 마커 행으로 하루 한 번만 돈다(하루 ≈ 210단위).
검색 결과는 잡음이 많아(첫 실검색 95건 중 77건) 경품 언급·라이브 제외·구독자 1천 이상만 남긴다. 감시 채널은 안 거른다.

확인: `/api/events?t=<SYNC_TOKEN>&peek=1&format=text` (peek 는 reminded 를 안 찍는다). `&all=1` 은 reminded 까지 전부(미리알림 재생성용).
감시 채널은 제목에 "이벤트"만 있어도 잡는다(정가거부 "이벤트 #14" 는 설명에 참여 방법이 없다). 검색 결과는 엄격하게.

## 작업 로그

`docs/devlog/` 에 날짜별로 남긴다. 무엇을 만들었는지보다 **왜 그렇게 정했는지와 어디서 헛디뎠는지**를 적는다.
git log 가 이미 무엇을 바꿨는지 알려주므로, 여기에는 코드에서 읽을 수 없는 것만 남긴다.

## 인증

- 가계부 화면: `/api/login?k=<APP_SECRET>` 로 한 번 접속하면 1년짜리 쿠키가 심긴다
- MCP: `?k=<MCP_SECRET>` 또는 `Authorization: Bearer`
- 단축어·검증용 통로: `?t=<SYNC_TOKEN>` (`/api/events`)
