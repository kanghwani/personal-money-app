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
npm test                 # vitest (네트워크 안 탐)
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
`npm run deploy:prod` 가 배포 전후 실서버 스키마를 비교해 이 경우에만 크게 알린다.

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

## 인증

- 가계부·건강 화면: `/api/login?k=<APP_SECRET>` 로 한 번 접속하면 1년짜리 쿠키가 심긴다
- MCP: `?k=<MCP_SECRET>` 또는 `Authorization: Bearer`
- 단축어·검증용 통로: `?t=<SYNC_TOKEN>` (`/api/today`, `/api/log`, `/api/toolcheck`)
