# 원장 과거 데이터 병합 설계 — 월별 흐름/전체 화면에 시트 이력 반영

작성일: 2026-06-08

## 목적 / 문제

앱의 월별 흐름 차트와 모든 집계는 동기화 store(`store.transactions`)만으로 계산된다.
이 store에는 앱에서 입력한 최근/seed 데이터만 있어 과거 여러 달이 비어 보인다.
반면 구글 시트 `v2_거래원장`에는 모바일 자연어 빠른입력으로 쌓인 **과거 전체 거래**가 있다.
이 과거 거래를 앱으로 가져와 월별 흐름·카테고리·원장 등 모든 화면이 과거를 반영하게 한다.

## 확정 사항

| 항목 | 결정 |
|---|---|
| 범위 | 과거 거래 전체를 앱에 반영 (모든 화면) |
| 월별 흐름 표시 | 최근 **6개월** 유지 (`slice(-6)`) |
| 저장 방식 | 과거 원장은 **읽기전용**으로 매 로드 시 fetch (동기화 blob에 저장 안 함) |
| 이유 | blob은 시트 한 셀(~5만자)에 저장 → 과거 전체(100KB+)는 한도 초과. 읽기전용 병합으로 회피 |

## 아키텍처

```
[앱 로드]
  ├ loadFromServer()  → 동기화 store (assets/investments/loans/budget + 앱 입력 거래)  ← 저장 대상
  └ loadLedger()      → 과거 거래 전체 (읽기전용 historyTransactions)                  ← 저장 안 함

표시/집계 = buildSummary({ ...store, transactions: merged })
  merged = dedupById([...historyTransactions, ...store.transactions])  (id 충돌 시 store 우선)

새 입력 → setStore (store.transactions만 변경) → 기존 동기화로 저장 (blob 작게 유지)
```

- **동기화 store** = 쓰기 가능한 정답지(앱 입력 + 자산 등), 작게 유지.
- **historyTransactions** = 시트 원장에서 읽어오는 과거 거래, 읽기전용, 저장 안 함.
- 둘을 표시 시점에만 병합.

## 컴포넌트 설계

### 1. 백엔드 (`manage_money_apps_script.gs`, clasp로 반영)
- `doGet`에 `action === 'ledger'` 분기 추가:
  - 토큰 검증(`checkToken_`).
  - `v2_거래원장` 시트 전 행을 읽어 앱 `Transaction` 형태 객체 배열로 매핑해 `{ ok:true, transactions:[...] }` 반환.
  - 헤더 행 1개 스킵, 빈 행 스킵.
- 매핑 (원장 컬럼 → Transaction):
  | 원장 컬럼 | Transaction 필드 | 변환 |
  |---|---|---|
  | 거래ID | id | 문자열 (없으면 생략/생성) |
  | 날짜 | date | `yyyy-MM-dd` 정규화 |
  | 구분 | type | 지출→`expense`, 수입→`income` |
  | 금액 | amount | Number |
  | 내역 | memo | 문자열 |
  | 대분류 | category | 문자열 |
  | 소분류 | subCategory | 문자열 |
  | 결제수단 | payment | 문자열 |
  | 고정/변동 | fixedType | 고정→`fixed`, 변동→`variable` |
  | 분담금 | split | Number (기본 0) |
  | (원본/내역) | raw | 표시는 안 쓰이면 빈 문자열 |
- 응답 크기: 수백~천 건 JSON(수십~수백 KB). 시트 셀이 아닌 HTTP 응답이라 한도 무관.

### 2. 앱 (`src/`)
- `src/sync/syncClient.ts`에 `loadLedger()` 추가:
  - `GET ${url}?action=ledger&token=...`, `redirect:'follow'`.
  - 반환: `Transaction[]`. 동기화 비활성(env 없음/cfg null)이면 `[]` 반환. 네트워크/파싱 오류는 throw(syncClient 계약과 일관) → 마운트 핸들러가 catch해서 `historyTransactions=[]` 처리.
- `src/sync/merge.ts`(또는 신규 `dedupById`)에 순수함수 `dedupTransactions(history, store)` 추가:
  - Map<id, Transaction>에 history 먼저, store 나중에 넣어(store 우선) values 반환. id 없으면 합성 키.
- `usePersistentStore` 또는 App:
  - 마운트 시 동기화 pull과 **병렬로** `loadLedger()` 호출 → `historyTransactions` state에 저장.
  - 실패 시 `historyTransactions = []` (오프라인 안전), 동기화 store만으로 동작.
  - `historyTransactions`는 저장 로직(blob push)에 **포함하지 않음**.
- `summary` 계산: `useMemo(() => buildSummary({ ...store, transactions: dedupTransactions(historyTransactions, store.transactions) }), [store, historyTransactions])`.
  - `buildSummary` 자체는 변경 최소 (병합된 transactions를 받기만).
  - 월별 흐름 `slice(-6)` 유지 → 과거 들어오면 최근 6개월 표시.
- 원장(ledger) 뷰: 동일 merged 사용. 과거(읽기전용) 항목 삭제 버튼은 비활성/숨김(선택, YAGNI면 생략).

### 3. 데이터 흐름
1. 로드: store pull + ledger fetch(병렬) → 둘 다 도착하면 merged로 표시.
2. 입력: 앱 입력 → store.transactions 추가 → blob 저장. (history는 불변)
3. 표시: 항상 merged 기준.

## 에러 처리 / 오프라인
- ledger fetch 실패(네트워크/토큰): `historyTransactions=[]`, 콘솔 경고, 앱은 store만으로 정상 동작.
- 동기화 비활성(env 없음): ledger도 비활성, 기존 동작 유지.

## 테스트 전략
- **백엔드**: `?action=ledger&token=` curl → transactions 배열 반환 확인. 잘못된 토큰 → unauthorized. 기존 빠른입력/동기화 회귀 없음.
- **dedupTransactions**: 단위 테스트(중복 id store 우선, history-only, store-only, 빈 입력).
- **loadLedger**: fetch 모킹 단위 테스트(URL/파싱).
- **통합 수동**: 배포 후 앱에서 월별 흐름이 과거 6개월 표시되는지, 카테고리/원장도 과거 반영되는지.

## 범위 밖 (YAGNI / 별도 작업)
- 입력 방식 혁신(똑똑한 자연어, 원탭 버튼) — 별도 작업 B.
- UI/대시보드/테마/입력영역 개편 — 별도 작업 C.
- 앱 입력을 시트 원장으로 일원화(단일 소스) — 향후, blob이 한도 근접 시.
- 과거 거래 편집/삭제 동기화.

## 기존 코드 영향
- `manage_money_apps_script.gs`: `doGet`에 ledger 분기 + 매핑 헬퍼 추가(기존 기능 보존). clasp push.
- `src/sync/syncClient.ts`: `loadLedger()` 추가.
- `src/sync/merge.ts`(또는 신규 파일): `dedupTransactions()` 추가.
- `src/App.tsx`: history state + 병렬 fetch + summary를 merged로 계산.
