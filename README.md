# personal-money-app

가계부와 건강 시스템. React 앱(가계부) + 정적 페이지(건강) + Vercel 서버리스 API + Google Apps Script 백엔드.

| 구성 | 위치 |
|---|---|
| 가계부 앱 | `src/` (React, Vite) |
| 건강 앱 | `public/health.html` + `health.css` + `health.js` (빌드 없음, 정적) |
| 서버 API | `api/` (Vercel 서버리스). `_` 로 시작하는 파일은 함수가 아니라 모듈·테스트 |
| MCP 서버 | `api/mcp.ts` (클로드 앱 커스텀 커넥터가 붙는 곳) |
| 시트 백엔드 | `gas/Code.gs` (clasp 로 배포) |

## 명령

```bash
npm test                 # vitest (네트워크 안 탐). 툴 스키마가 잠금 파일과 다르면 여기서 막힌다
npm run tools:lock       # 툴 스키마 잠금 갱신. 기존 툴 인자가 바뀌었으면 커넥터 재추가 안내가 나온다
npm run deploy:prod      # 배포 + 실서버 스키마 확인 + 커넥터 재추가 필요 여부 알림
npm run verify:deploy    # 실서버가 서빙하는 MCP 툴 스키마를 소스와 대조
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
막는 방법이 둘이다.
1. `api/tools.lock.json` — 커넥터가 마지막으로 맞춰본 스키마. 어긋나면 `npm test` 가 실패한다.
   의도한 변경이면 `npm run tools:lock` 으로 갱신하고, 그때 커넥터 재추가 안내가 출력된다.
   **잠금은 배포 경로와 무관하다.** 자동배포를 켜거나 기기가 둘이 돼도 기준이 흔들리지 않는다.
2. `npm run deploy:prod` — 배포 전후 실서버 스키마를 비교해 같은 안내를 한 번 더 한다.
   (이쪽만으로는 부족하다. 다른 경로로 이미 배포됐다면 "배포 전"이 이미 바뀐 상태라 조용해진다.)

자동배포를 켜게 되면 GitHub Actions 의 `deployment_status: success` 에서
`/api/toolcheck` 를 잠금 파일과 대조하는 단계를 추가하면 된다. 지금은 git 연결이 없어 필요 없다.

**핸들러가 읽는 인자는 `inputSchema.properties` 에도 올려야 한다.**
`args.week` 를 읽어도 스키마에 없으면 클라이언트가 조용히 버린다. `api/_mcp-tools.test.ts` 가
핸들러의 `args` 사용·`required`·설명 언급을 스키마와 대조한다.

**`api/` 의 `.ts` 는 전부 서버리스 함수로 잡힌다.** 테스트와 모듈은 `_` 접두어를 붙여야 한다.
(`api/health.test.ts` 를 두었더니 함수로 취급돼 빌드가 깨졌다.)

**`Array.prototype.at` 을 쓰지 말 것.** Vercel 의 기본 lib 타깃이 낮아 빌드가 깨진다.
배포 전 확인: `npx tsc --noEmit --ignoreConfig --strict --skipLibCheck --module nodenext --moduleResolution nodenext --target es2021 api/*.ts`

**`APP_SECRET`·`MCP_SECRET` 은 Vercel Secret 이라 `vercel env pull` 로 못 꺼낸다.**
쿠키·MCP 인증이 필요한 검증은 앱에서 하거나, `SYNC_TOKEN` 을 쓰는 통로(`/api/today`, `/api/toolcheck`)로 한다.

**GAS 호출은 창 크기와 무관하게 10초 넘게 걸린다.** 시작 오버헤드가 병목이라 9년치를 통째로 받는 편이
75일치를 받는 것과 비용이 같다. `api/health.ts` 는 전체를 받아 5분간 캐시하고, 저장 시 캐시를 버린다.

## 유튜브 구독자 이벤트

설계: `docs/superpowers/specs/2026-09-21-youtube-events-design.md`. 가계부와 데이터를 섞지 않고 인프라만 빌린다.

| 조각 | 위치 |
|---|---|
| 판정·날짜·상태·한 줄 문법 | `api/_events.ts` (순수 함수, `api/_events.test.ts`) |
| 스캔 + 미리알림 큐 | `api/events.ts` — 단축어 `eventsync` 가 매일 09:00 GET. cron 없음 |
| 폰 입력·조회 | MCP `event_list`, `event_log` |
| 저장 | 건강 데이터 스프레드시트 탭 `events`·`event_channels` (GAS 수정 없음, 추가만) |
| 단축어 생성 | `python3 gas/build_event_shortcut.py <out_dir>` → `shortcuts sign` |

**채널 RSS 는 못 쓴다.** 십만양품·디에디트·기즈모가 404, ITSub 이 500 을 돌려준다(채널마다 다르고 채널 페이지는 RSS 링크를 광고한다).
그래서 `YOUTUBE_API_KEY`(Vercel 환경변수, 키만·OAuth 없음)로 `playlistItems` 를 읽는다. 채널당 하루 1단위, 한도 1만.
키가 없으면 스캔만 건너뛰고 큐·기록은 동작한다.

확인: `/api/events?t=<SYNC_TOKEN>&peek=1&format=text` (peek 는 reminded 를 안 찍는다).

## 작업 로그

`docs/devlog/` 에 날짜별로 남긴다. 무엇을 만들었는지보다 **왜 그렇게 정했는지와 어디서 헛디뎠는지**를 적는다.
git log 가 이미 무엇을 바꿨는지 알려주므로, 여기에는 코드에서 읽을 수 없는 것만 남긴다.

**앱이 URL 스킴으로 부르는 단축어는 이름을 영문으로 둔다.**
`shortcuts://run-shortcut?name=` 에 한글 이름을 넘기면 매칭이 깨진다(단축어 안에서 한글 이름으로 부르는 것은 정상).
업로드 단축어 이름은 `healthsync` 다. 바꾸면 `public/health.js` 의 `SHORTCUT_NAME`,
`gas/build_health_shortcut.py` 의 `UPLOAD_NAME`, 컨디션 단축어의 Run Shortcut 참조를 함께 고쳐야 한다.

## 인증

- 가계부·건강 화면: `/api/login?k=<APP_SECRET>` 로 한 번 접속하면 1년짜리 쿠키가 심긴다
- MCP: `?k=<MCP_SECRET>` 또는 `Authorization: Bearer`
- 단축어·검증용 통로: `?t=<SYNC_TOKEN>` (`/api/today`, `/api/log`, `/api/toolcheck`)
