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

## 인증

- 가계부·건강 화면: `/api/login?k=<APP_SECRET>` 로 한 번 접속하면 1년짜리 쿠키가 심긴다
- MCP: `?k=<MCP_SECRET>` 또는 `Authorization: Bearer`
- 단축어·검증용 통로: `?t=<SYNC_TOKEN>` (`/api/today`, `/api/log`, `/api/toolcheck`)
