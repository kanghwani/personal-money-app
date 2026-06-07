# 백엔드 동기화 설계 — 가계부 앱 (돈 정리)

작성일: 2026-06-07

## 목적 / 문제

현재 가계부 앱(`personal-money-app`)은 데이터를 브라우저 `localStorage`(`personal-money-app:v1`)에만
저장한다. 그 결과 PC에서 입력한 데이터가 폰에서 보이지 않는 등 **기기 간 데이터가 공유되지 않는다.**
외부 네트워크(폰)에서도 같은 가계부 데이터를 보고 입력할 수 있도록 백엔드 동기화를 추가한다.

## 확정된 결정 사항

| 항목 | 결정 |
|---|---|
| 사용 범위 | 단일 사용자, 여러 기기 (PC + 폰) |
| 백엔드 | 기존 Google Apps Script + Google Sheets 재사용 |
| 저장 형태 | FinanceStore 전체를 JSON 한 덩어리로 저장 (A안) |
| 인증 | 빌드 시 토큰 주입 (Vite 환경변수) |
| 동기화 타이밍 | 자동 동기화 (변경 후 2초 debounce) + 수동 버튼 |
| 충돌 처리 | last-write-wins + `updatedAt` 타임스탬프 (단일 사용자라 단순) |

## 전체 구조

```
[폰/PC 브라우저]                                  [Google]
 React 앱 (GitHub Pages)
   ├ localStorage   ← 오프라인 캐시 + 즉시 반응
   └ syncClient ──HTTP──> Apps Script Web App ──> Google Sheets
                                                   └ "AppState" 시트
                                                      A1: store(JSON)
                                                      B1: updatedAt(ISO)
```

- **Google Sheets가 정답지(source of truth)**, `localStorage`는 빠른 표시·오프라인 캐시.
- 단일 사용자이므로 충돌 해결은 `updatedAt` 비교 기반 last-write-wins로 충분.

## 컴포넌트 설계

### 1. Apps Script 백엔드 (`manage_money_apps_script.gs`)

기존 함수(빠른입력 doPost, 시트 빌더 등)는 **그대로 두고**, 앱 동기화용 분기만 추가한다.

- **상수/속성**: `APP_STATE_SHEET = 'AppState'`. 토큰은 `.gs` 파일이 git에 추적되므로
  코드 상수가 아니라 **Apps Script Script Properties**(`PropertiesService`)의 `SYNC_TOKEN`에서 읽는다.
- **`doGet(e)`** 확장:
  - `e.parameter.action === 'load'` 이고 토큰이 일치하면 → `AppState` 시트의 `store` JSON과
    `updatedAt`을 `{ ok:true, store, updatedAt }`로 반환.
  - 그 외(action 없음) → 기존 헬스체크 응답 유지.
- **`doPost(e)`** 확장:
  - 본문 JSON에 `action === 'save'`가 있으면 → 토큰 검증 후 `AppState` 시트에
    `store`(JSON 문자열)와 `updatedAt`을 덮어쓰고 `{ ok:true, updatedAt }` 반환.
  - `action`이 없으면 → **기존 자연어 빠른입력 로직으로 분기** (기존 기능 보존).
- **헬퍼**: `ensureAppStateSheet_(ss)`, `readAppState_(ss)`, `writeAppState_(ss, store, updatedAt)`,
  `checkToken_(token)`.
- **응답**: 기존 `json_()` 헬퍼 재사용.

### 2. React 동기화 레이어 (`personal-money-app/src/`)

- **`src/sync/syncClient.ts`** (신규):
  - `loadFromServer(): Promise<{ store, updatedAt } | null>` — `GET ?action=load&token=...`.
  - `saveToServer(store, updatedAt): Promise<{ updatedAt }>` —
    `POST` + `Content-Type: text/plain`(본문에 JSON 문자열). **CORS preflight 회피.**
  - 토큰/URL은 `import.meta.env.VITE_SYNC_URL`, `import.meta.env.VITE_SYNC_TOKEN`에서 읽음.
  - 환경변수가 없으면 동기화 비활성화(기존 localStorage 단독 동작).
- **`usePersistentStore` 확장 또는 `useSyncedStore` 신규**:
  - 마운트 시: `loadFromServer()` 호출 → 서버 `updatedAt`이 로컬보다 최신이면 store 교체.
  - store 변경 시: 2초 debounce 후 `saveToServer()` 자동 호출.
  - 수동 "동기화" 트리거 함수 제공.
  - 동기화 상태(`idle | syncing | offline | error`)를 노출 → 헤더 표시.
- **상태 표시 UI**: 헤더에 동기화 상태 인디케이터(동기화됨 / 동기화 중 / 오프라인) + 수동 버튼.

### 3. 인증 (빌드 시 토큰 주입)

- `personal-money-app/.env`(gitignore됨)에 `VITE_SYNC_URL`, `VITE_SYNC_TOKEN` 정의.
- `npm run build` 시 Vite가 번들에 주입.
- **보안 한계 (인지 필요)**: GitHub Pages는 공개이며 토큰이 빌드 산출물 JS에 **평문으로 포함**된다.
  공개 사이트의 JS에서 토큰을 추출하면 시트 접근이 가능하다. 개인 가계부라 위협 수준은 낮으나,
  토큰 유출 시 Apps Script에서 토큰을 교체하고 재배포하면 차단된다.

## 데이터 흐름

1. **앱 시작**: localStorage 로드(즉시 화면) → `loadFromServer()` →
   서버 `updatedAt` > 로컬이면 store 갱신 + localStorage 갱신.
2. **데이터 변경**: setStore → localStorage 즉시 저장 → 2초 debounce 후 `saveToServer()`.
3. **최초 연결(서버 빈 상태)**: 서버 store가 없으면 현재 localStorage 데이터를 업로드(기존 입력 보존).

## 에러 처리 / 오프라인

- 네트워크 실패: localStorage로 정상 동작 유지, 상태를 `offline`로 표시, 온라인 복귀 시 재시도.
- 토큰 불일치(401류 응답): 상태를 `error`로 표시, 콘솔 경고.
- 저장 실패: 다음 변경 또는 수동 버튼에서 재시도(미저장분은 localStorage에 남아 있음).
- 기존 PWA service worker(`public/sw.js`)는 정적 자산 캐시 용도로 유지(동기화 API는 캐시 대상 아님).

## 테스트 전략

- **Apps Script**: `?action=load` / `save` 분기를 토큰 유/무로 호출하여 응답 검증.
  기존 자연어 빠른입력이 여전히 동작하는지(회귀) 확인.
- **syncClient**: load/save를 모킹된 fetch로 단위 테스트(요청 형식·Content-Type·토큰 포함 여부).
- **통합 수동 점검**: PC에서 입력 → 폰(다른 네트워크)에서 동일 데이터 표시 확인.
  오프라인 전환 시 동작 + 복귀 후 동기화 확인.

## 범위 밖 (YAGNI)

- 다중 사용자 / 가족 공유 / 사용자 인증 로그인.
- 행 단위 구조화 동기화(B안), 거래별 충돌 병합.
- 주식 현재가 API(`/api/price`) 연동 — 본 작업과 독립.

## 기존 코드 영향

- `manage_money_apps_script.gs`: 분기 추가(기존 기능 보존).
- `personal-money-app/src/App.tsx`: store 훅을 동기화 버전으로 교체, 헤더에 상태 표시 추가.
- `personal-money-app/.env`(신규, gitignore), `src/sync/syncClient.ts`(신규).
- `vite.config.ts`: 환경변수 사용에 따른 변경 없음(`import.meta.env` 기본 지원).
