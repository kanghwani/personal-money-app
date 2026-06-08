# 미분류 자동학습 분류 설계 (규칙 보강 + 교정 시 학습 + 앱 재분류 UI)

작성일: 2026-06-08

## 목적
미분류가 쌓이는 걸 예방한다. (1) 알려진 가맹점 규칙을 보강하고, (2) 앱에서 거래를 재분류하면 그 키워드를 분류규칙에 자동 학습시켜, 같은 가맹점이 다시 와도 자동 분류되게 한다. 미분류가 시간이 갈수록 0에 수렴.

## 배경 (현재 분류 방식)
- `v2_분류규칙` 시트: `[키워드(콤마구분), 대분류, 소분류, 고정/변동, 태그, 우선순위]`.
- `classify_(memo)`: 내역을 소문자화 → 규칙을 **시트 행 순서대로** 보며 키워드가 내역에 포함되면 그 카테고리 반환. 매칭 없으면 `{}` → 미분류. (우선순위 컬럼은 현재 정렬에 안 쓰임 — 행 순서가 우선.)

## 확정 결정 (브레인스토밍 승인)
- **학습 키워드**: 분류 시 그 거래의 **내역 전체**를 키워드로 등록(정확·안전, substring 매칭).
- **재분류 UI**: 카테고리 상세 시트의 각 거래에 **"분류" 버튼** → 카테고리 피커(데이터의 기존 대분류/소분류 조합) 선택 → 적용.
- **①+②**: ① 오늘 나온 미분류 가맹점 규칙 1차 보강 + ② 교정 시 자동 학습.

## 컴포넌트 설계

### 1. 백엔드 (`Code.gs`, clasp)
- **`upsertRule_(ss, keyword, category, subCategory)`**: `v2_분류규칙`에서 키워드 셀이 정확히 `keyword`인 행을 찾으면 대분류/소분류 갱신, 없으면 **맨 위(행2)에 삽입**([keyword, category, subCategory, '변동', '', 5]). (맨 위 삽입 → 가맹점 규칙이 넓은 키워드보다 먼저 매칭.)
- **`assignCategory_(ss, id, category, subCategory)`**: 원장에서 `거래ID==id` 행을 찾아 대분류/소분류 갱신 → 그 행의 내역으로 `upsertRule_` 호출 → 같은 내역(정확 일치)인 **기존 미분류 행들도** 같은 카테고리로 갱신. 반환 `{ ok, updated }`.
- **doPost `action==='assignCategory'`**(토큰 보호): body `{ id, category, subCategory }` → `assignCategory_`.
- **`seedKnownRules_()`** (1회): 오늘 정리한 가맹점들의 키워드 규칙을 `upsertRule_`로 추가(굽네치킨→식비/배달, 유니클로→의류/옷, 올리브영→생활/뷰티미용, 노브랜드→식비/장보기, 뚜레쥬르빵→식비/카페간식, 알리익스프레스→생활/전자기기, 락앤락→생활/생활잡화, 종합소득세→세금/공과금/세금, 앤트로픽맥스플랜·차지티→문화/구독/구독, 스피커받침쿠팡→생활/생활잡화, 한강3종→건강/운동 등). doGet `action==='seedrules'`(토큰)로 1회 실행 후 분기 제거.

### 2. 앱 — 카테고리 옵션 순수함수 (TDD)
- `src/dashboardLogic.ts`에 `distinctCategoryOptions(transactions): {category, subCategory}[]` 추가: 지출 거래에서 (대분류,소분류) 고유 조합을 빈도 내림차순으로. 미분류 제외.
- 테스트: 중복 제거, 빈도 정렬, 미분류 제외.

### 3. 앱 — assignCategory 클라이언트 + 새로고침
- `src/sync/syncClient.ts`에 `assignCategory(id, category, subCategory, cfg?)`: POST `text/plain` `{action:'assignCategory', token, id, category, subCategory}` → `data.ok` 반환.
- `useLedgerHistory`를 `[history, refreshHistory]` 반환하도록 확장(수동 재fetch). 분류 성공 후 `refreshHistory()` 호출로 원장 갱신.

### 4. 앱 — CategoryDetailSheet 분류 버튼 + 피커
- `CategoryDetailSheet`의 각 거래 행에 **"분류" 버튼**. 누르면 인라인 카테고리 피커(또는 작은 시트) 표시: `categoryOptions`(distinctCategoryOptions 결과) 목록 + 각 항목 탭.
- 선택 → `onAssign(transaction.id, category, subCategory)` 호출(App 제공) → App이 `assignCategory` 백엔드 호출 → 성공 시 `refreshHistory()` → 카테고리 상세/홈 갱신.
- 동작 중 로딩/완료 표시(간단). 실패 시 메시지.

## 데이터 흐름
1. 앱 카테고리 상세 시트에서 거래 "분류" → 카테고리 선택.
2. App `onAssign` → `assignCategory(id, cat, sub)` (백엔드 POST).
3. 백엔드: 원장 행 갱신 + `v2_분류규칙` 학습 + 같은 내역 미분류 일괄 갱신.
4. App: `refreshHistory()` → ledger 재fetch → merged/summary 갱신 → 화면 반영.
5. 이후 입력은 보강·학습된 규칙으로 `classify_`가 자동 분류.

## 에러/엣지
- 거래ID 미발견: `{ ok:false }`, 앱은 메시지.
- 같은 내역이 여러 건: 모두 갱신(의도).
- 키워드 충돌(이미 다른 카테고리 규칙): `upsertRule_`가 갱신(최근 학습 우선).
- 분류규칙 맨위 삽입으로 가맹점(구체) 규칙이 넓은 키워드보다 먼저 매칭.
- 앱은 현재 미분류 0건 — 기능 가치는 **향후 예방** + 잘못 분류 교정. 동작 검증은 잘못 분류된 건/임시 건으로.

## 테스트 전략
- `distinctCategoryOptions` 단위테스트(Vitest).
- `assignCategory` 클라이언트 fetch 모킹 테스트(URL/본문/ok).
- 백엔드: curl로 assignCategory 호출 → 원장 행·분류규칙 갱신 확인. 기존 ledger/load/save 회귀 없음.
- 통합 수동: 앱에서 거래 분류 → 즉시 반영 + 분류규칙 추가 확인(curl).

## 범위 밖
- 분류규칙 관리 화면(시트에서 직접 편집).
- AI 분류 fallback.
- 키워드 직접 편집 UI(이번엔 내역 전체 자동).

## 기존 코드 영향
- `Code.gs`(+repo .gs): `assignCategory_`, `upsertRule_`, doPost assignCategory 분기, 1회 `seedKnownRules_`/seedrules 분기(실행 후 제거).
- `src/dashboardLogic.ts`: `distinctCategoryOptions`(+테스트).
- `src/sync/syncClient.ts`: `assignCategory`(+테스트).
- `src/App.tsx`: `useLedgerHistory` 새로고침 반환, `onAssign` 핸들러, CategoryDetailSheet 분류버튼+피커, categoryOptions 전달.
- `src/App.css`: 분류 버튼·피커 스타일.
