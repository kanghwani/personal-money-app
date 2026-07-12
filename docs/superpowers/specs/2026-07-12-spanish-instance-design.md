# 브리 전용 스페인어 가계부 인스턴스 (같은 백엔드, 전용 탭)

작성일: 2026-07-12

## 목적
여자친구 브리타니가 **혼자 쓰는 스페인어 가계부**를 만든다. 네 데이터와 분리(전용 시트 탭), 스페인어 UI, 스페인어로 입력하면 카테고리 자동 분류·표시. 동기화·공유 불필요.

## 핵심 결정 (브레인스토밍 승인)
- **같은 백엔드 재사용**: 새 Apps Script/스프레드시트/토큰 없이, 기존 스프레드시트에 `es_*` 탭 세트를 추가. 요청의 `profile` 파라미터로 탭 세트를 고른다.
- **그녀 데이터는 처음부터 스페인어**: 카테고리를 스페인어로 저장(예: `Cafetería`). KO↔ES 번역 맵 불필요. i18n은 UI 크롬(버튼·라벨·헤더)만.
- **언어 토글 없음**: 그녀 빌드는 `VITE_LANG=es` 고정. 네 빌드는 기존대로 한국어(`v2_` 프로필).
- **별도 Vercel 배포**: 그녀 전용 URL. 같은 프론트 코드, 빌드 env로만 구분(`VITE_PROFILE=es`, `VITE_LANG=es`).
- **입력**: 기존 빠른입력 UX 유지하되 파서가 스페인어 키워드 인식. `+` 프리픽스 수입은 언어무관(그대로).
- **트레이드오프(수용)**: 같은 토큰 → 프로필 파라미터로만 분리(암호적 격리 아님). 개인용이라 수용.

## 아키텍처

### 1. 백엔드 — `manage_money_apps_script.gs` (작음)
현재 `const SHEETS = { fast:'v2_빠른입력', ledger:'v2_거래원장', ... }` (9개 탭, 55곳 참조).

- `SHEETS`를 **접두어 기반**으로 리팩터:
  - `var SHEET_PREFIX = 'v2_'` (기본, 재할당 가능하도록 `var`).
  - `var SHEETS = buildSheets_(SHEET_PREFIX)` — base 이름(`빠른입력`,`거래원장`,`분류규칙`,`자산`,`대출`,`투자`,`월간리포트`,`인사이트`,`고정비`)에 접두어를 붙여 생성.
  - `function applyProfile_(profile){ SHEET_PREFIX = (profile === 'es') ? 'es_' : 'v2_'; SHEETS = buildSheets_(SHEET_PREFIX); }`
- `doGet` 최상단: `applyProfile_(params.profile)`.
- `doPost` 최상단: `applyProfile_(body.profile)`.
- 55곳의 `SHEETS.ledger` 등은 그대로 — 요청 시작 시 SHEETS가 프로필에 맞게 재구성되므로 자동 반영.
- `es_*` 탭은 기존 `ensureSheet_`/`setupSheet_`가 첫 사용 시 자동 생성.
- `AUTO_REFRESH_SOURCE_SHEETS`(onEdit 트리거용)는 기본 `v2_`만 커버 — es 인사이트 자동갱신은 범위 밖(그녀는 앱으로만 편집, 필요 시 후속).
- **재배포 1회**(Monaco, 새 버전).

### 2. 프론트 — 프로필 파라미터
- `src/sync/syncClient.ts`: 모든 요청 URL/본문에 `profile` 추가. `getSyncConfig()`에 `profile = import.meta.env.VITE_PROFILE || ''` 포함.
  - GET: `?action=...&token=...&profile=es`
  - POST 본문: `{ ..., profile }`
- 빈 문자열이면 백엔드가 `v2_`로 처리 → 기존 네 앱 무영향.

### 3. 프론트 — i18n (UI 크롬만)
- `src/i18n.ts`: `type Lang = 'ko' | 'es'`, `const LANG: Lang = (import.meta.env.VITE_LANG === 'es') ? 'es' : 'ko'`, `t(key)` 룩업.
- `src/i18n/ko.ts`, `src/i18n/es.ts`: 키→문자열 사전. 고유 UI 문자열(~150개: 탭·버튼·헤더·플레이스홀더·시트 제목·빈상태·인사이트 카드 제목 등)을 키로 추출.
- `App.tsx`의 하드코딩 한글 문자열을 `t('key')`로 치환. 동적 문장(템플릿)은 파라미터화한 t 함수(`t('savingsRate', {pct})`) 또는 조합.
- 숫자·통화: **브리도 한국 거주·원화(₩)** → 기존 `formatMoney`(₩, 콤마 구분) 그대로. 통화 일반화·`VITE_CURRENCY` 불필요(범위 제거).

### 4. 프론트 — 스페인어 분류기
- 현재 `App.tsx`의 `categoryRules`, `paymentPatterns`, 날짜(`어제/오늘`), 수입 키워드(`수입|월급|급여|입금|보너스`)가 한글 하드코딩.
- 언어별 분리: `src/classify/ko.ts`, `src/classify/es.ts` (또는 기존 위치에 LANG 분기).
  - **es categoryRules**: café/cafetería→Cafetería, supermercado/mercado→Comida, restaurante→Restaurante, farmacia→Salud, gasolina→Transporte, alquiler→Vivienda, ropa→Ropa 등(대표 세트).
  - **es paymentPatterns**: tarjeta→Tarjeta, efectivo→Efectivo, transferencia→Transferencia.
  - **es 날짜어**: ayer(어제), hoy(오늘).
  - **es 수입 키워드**: ingreso/salario/nómina + `+` 프리픽스(공통).
  - 카테고리 기본값·`미분류`→`Sin categoría`.
- 학습 규칙(localStorage `learnedRules`)은 언어무관(문자열 매칭) → 그대로 동작.

### 5. 배포
- 두 번째 Vercel 프로젝트(또는 동일 프로젝트의 별도 도메인). 빌드 env: `VITE_PROFILE=es`, `VITE_LANG=es`, `VITE_SYNC_URL`(동일), `VITE_SYNC_TOKEN`(동일).
- 그녀 전용 URL 발급.

### 6. 스페인어 사용 가이드
- `docs/` 또는 앱 내 도움말: 스페인어로 "입력법(`5000 café tarjeta`, `+600000 salario`), 카테고리 자동분류, 고정비 등록, 내보내기 백업" 설명. 1장 분량(마크다운 또는 간단 HTML).

## 데이터 흐름
1. 브리가 그녀 URL 접속(스페인어 UI, EUR).
2. 입력 `5000 café tarjeta` → es 분류기 → 카테고리 `Cafetería`, 결제 `Tarjeta`, 메모 `café`.
3. `appendLedger`가 `profile=es` 포함 → 백엔드가 `es_거래원장`에 기록.
4. 원장/인사이트가 `es_*` 탭에서 로드 → 스페인어 데이터 표시.
5. 네 앱은 `profile` 없음 → `v2_*` 그대로. 완전 분리.

## 에러/엣지
- `profile` 미전달(네 기존 앱) → 백엔드 `v2_` 기본. 하위호환 유지.
- es 탭 최초 접근 → `ensureSheet_`가 헤더 포함 생성.
- 통화: 브리도 원화(₩) → 기존 formatMoney 그대로, 통화 분기 없음.
- 분류기 미매칭 → `Sin categoría`(미분류) + 기존 인라인 교정/학습으로 커버.
- 같은 토큰 노출: 그녀 빌드 env에 토큰 포함(기존 네 빌드도 동일 구조). 공개 저장소 아님(.env gitignore).

## 테스트 전략
- 백엔드: `applyProfile_('es')` 후 `SHEETS.ledger === 'es_거래원장'` 확인(GAS 재현: `?action=add&profile=es&raw=...` → es 탭 기록, `?action=ledger&profile=es` 조회). 테스트 후 정리.
- 분류기: es 분류 순수함수 단위테스트(café→Cafetería 등) — 기존 dashboardLogic 테스트 패턴.
- i18n: `t()` 키 누락 시 키 자체 반환(안전) — ko/es 키 집합 일치 검증 스크립트.
- 통합: 그녀 빌드 Vercel 배포 → Chrome 실측(스페인어 UI, 입력→카테고리, es 탭 기록 확인).

## 범위 밖
- 언어 토글(그녀는 es 고정).
- KO↔ES 데이터 번역(그녀 데이터는 네이티브 es).
- es 인사이트 onEdit 자동갱신(앱 내 계산으로 충분).
- 시리 단축어 스페인어 버전(원하면 후속).
- 프로필별 토큰 격리(후속 옵션).

## 구현 순서(플랜용 요약)
1. 백엔드 프로필 파라미터(+재배포) — 독립적, 먼저.
2. syncClient profile 전달.
3. i18n 스캐폴드 + ko/es 사전 + App.tsx 치환.
4. es 분류기 + 통화.
5. 두 번째 Vercel 배포 + 스페인어 가이드 + 실측.
