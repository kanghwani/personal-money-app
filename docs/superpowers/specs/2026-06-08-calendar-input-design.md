# 달력형 입력 설계 (원장 탭 목록↔달력 + 날짜별 입력)

작성일: 2026-06-08

## 목적
원장 탭에 달력 보기를 추가해 월 단위로 날짜별 지출을 한눈에 보고, 날짜를 탭해 **그 날짜로** 거래를 추가한다. (오늘이 아닌 과거 날짜 입력 가능.)

## 확정 결정 (브레인스토밍 승인)
- **위치**: 원장 탭 상단에 `목록 ↔ 달력` 세그먼트 토글. 목록은 현행 유지.
- **달력 칸**: 날짜 숫자 + 그날 **실지출 금액**(작게). 지출 많은 날 배경 진하게(테라코타 농도 히트맵).
- **달력 헤더**: `yyyy.M` + 이전/다음 달 화살표, 오늘 강조.
- **날짜 탭 → 하단 시트**: 그날 거래 목록 + 입력(빠른칩 + 자연어). 입력은 **선택 날짜로** 기록.
- **데이터**: `mergedTransactions`(과거 원장 포함)에서 일별 합. 입력은 setStore(동기화 저장). 과거 원장은 읽기전용(추가만 store).

## 컴포넌트 설계

### 1. `dailyTotals` 순수함수 (TDD)
- `src/dashboardLogic.ts`에 추가: `dailyTotals(transactions: TxLike[], yearMonth: string): Record<number, number>`.
- 해당 월(`yearMonth`='yyyy-MM')의 **지출** 거래만, 날짜(일)별로 **실지출(amount - split)** 합산. 키=일(1..31), 값=합.
- 수입 제외. 다른 달 제외.
- 테스트: 같은 날 합산, 분담금 차감, 수입/타월 제외, 빈 입력.

### 2. `CalendarView` 컴포넌트
- props: `year`(예 2026), `month`(1~12), `totals: Record<number, number>`, `onPrev`, `onNext`, `onSelectDay(dateIso: string)`, `today: string`('yyyy-MM-dd').
- 월 그리드: 1일의 요일만큼 선행 빈칸 + 1..말일. 7열. 일요일 시작.
- 각 칸: 날짜 숫자 + `totals[day]`(>0이면 `compactMoney`). 배경 농도 = `totals[day] / max(totals)` 기반 `--accent-tan` alpha. 오늘 테두리 강조.
- 칸 탭 → `onSelectDay('yyyy-MM-dd')`.
- 헤더: `‹  yyyy.M  ›`.

### 3. `DayDetailSheet` 컴포넌트
- props: `date: string`('yyyy-MM-dd'), `transactions: Transaction[]`(그날 필터된 merged), `quickChips: QuickChip[]`, `onClose`, `onQuickAdd(raw: string)`, `onChipAdd(chip: QuickChip)`.
- 헤더: 날짜 라벨(`formatDateLabel`) + 그날 합계·건수.
- 거래 목록(최신순; 그날은 같은 날이므로 입력순/금액순 — 표시는 목록).
- 입력 영역: 빠른칩 행(탭 → `onChipAdd`) + 자연어 입력 필드(제출 → `onQuickAdd(raw)`).
- 시트는 카테고리 상세 시트와 같은 하단 시트 패턴(backdrop, stopPropagation).

### 4. 원장 탭 토글 + 날짜 인지 입력 핸들러 (App + Ledger)
- `Ledger` 컴포넌트(원장)에 `view: 'list' | 'calendar'` state. 상단 세그먼트로 전환.
- `Ledger`는 달력에 필요한 props를 App에서 받는다: `transactions`(merged), `quickChips`, 그리고 **날짜 인지 add 핸들러**:
  - `onQuickAddForDate(raw: string, date: string)`: App에서 `parseQuickEntry(raw)` → 결과의 거래 `date`를 인자 `date`로 강제 후 setStore 추가.
  - `onChipAddForDate(chip: QuickChip, date: string)`: 기존 `logQuickChip` 로직을 date 인자 받게 일반화(오늘 대신 선택일).
- 월 네비 state(year/month)와 선택일 state는 `Ledger`(또는 CalendarView 래퍼) 내부.

## 데이터 흐름
- 달력: `dailyTotals(mergedTransactions, 'yyyy-MM')` → 그리드.
- 날짜 탭: `selectedDate` → DayDetailSheet에 `mergedTransactions.filter(t => t.date === selectedDate)` + `quickChips`.
- 입력: `onQuickAddForDate`/`onChipAddForDate` → setStore(store.transactions에 추가, date=선택일) → 동기화.
- 추가 직후 달력/시트는 merged 재계산으로 갱신(상태 변경에 반응).

## 에러/엣지
- 거래 없는 날: 칸 금액 빈칸; 시트 거래 목록 "거래 없음" + 입력만.
- 미래 날짜: 허용(입력 가능). 막지 않음.
- `parseQuickEntry`가 transaction 외(자산/투자/대출)인 경우: 날짜 강제는 transaction에만 적용. 그 외는 기존 처리(또는 그날 입력에선 transaction만 권장 — 파싱 결과가 transaction이 아니면 기존 동작 유지).

## 테스트 전략
- `dailyTotals` 단위테스트(Vitest).
- 빌드(tsc) + 기존 테스트 회귀 없음.
- 통합 수동: 배포 후 Chrome으로 ① 원장 목록/달력 토글 ② 달력 일별 금액·히트맵·월 이동 ③ 날짜 탭→시트 그날 거래 ④ 시트에서 빠른칩/자연어로 과거 날짜 입력 → 달력·원장 반영.

## 범위 밖
- 과거 거래 편집/삭제(읽기전용 유지).
- 주/연 단위 뷰.
- 달력에서 드래그·다중선택.

## 기존 코드 영향
- `src/dashboardLogic.ts`: `dailyTotals` 추가(+테스트).
- `src/App.tsx`: `Ledger`에 목록/달력 토글 + CalendarView/DayDetailSheet 신설, App에서 날짜 인지 add 핸들러 제공(기존 `logQuickChip` 일반화), `Ledger` 렌더에 props 추가(quickChips, merged transactions, 핸들러).
- `src/App.css`: 달력 그리드·칸·히트맵·세그먼트·DayDetailSheet 스타일.
