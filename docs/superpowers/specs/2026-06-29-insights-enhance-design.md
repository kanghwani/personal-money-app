# 인사이트 강화: 장소별 지출 + 카테고리 전월대비

작성일: 2026-06-29

## 목적
인사이트 탭을 "사실 나열"에서 "변화·비교"로 강화. 두 축:
1. **장소별 지출 (어디서)** — 장소/물건 입력모델 활용. "이번 달 어디서 많이 썼나" 한눈에.
2. **카테고리 전월대비 (추세)** — 늘었나 줄었나, 어디가 변했나.

시각화는 모바일 세로 화면 기준. recharts(설치됨)·기존 차트 패턴 재사용.

## 핵심 결정 (브레인스토밍 승인)
- 전월대비 = **증감 리스트** 형태(그룹/다이버징 바 아님). 모바일 세로에 제일 맞음.
- 장소 TOP = 기존 "지출 비중"과 **동일한 가로 막대** 패턴.
- 기존(월별 흐름 Area, 지출 비중 Bar, 텍스트 카드 7개)은 **그대로 유지**.
- 큰 일회성(예: 5월 종합소득세 5.2M)은 변동지출이라 TOP에 그대로 노출 — 별도 제외 안 함(YAGNI).
- buildInsights 텍스트 카드는 추가 안 함 — 증감 리스트가 추세를 커버.

## 컴포넌트 설계

### 1. 순수함수 (TDD) — `src/dashboardLogic.ts`
- `placeTotals(transactions, yearMonth, n): NV[]`
  - 해당 월 **변동지출만**(`type==='expense' && fixedType!=='fixed'`) 필터.
  - 각 거래 `splitPlaceItem(memo).place`로 장소 추출(빈 장소는 '기타'), 실지출(`amount - split`) 합산.
  - 합계 내림차순 → `topNWithOther(rows, n)`로 TOP n + 기타. (기존 함수 재사용)
- `categoryDeltas(transactions, curMonth, prevMonth): Array<{ name; cur; prev; delta; rate }>`
  - 두 달 각각 **변동지출만** 카테고리별 실지출 합산.
  - 두 달 합집합 카테고리에 대해 `delta = cur - prev`, `rate = changeRate(cur, prev)`(기존 함수, prev=0이면 null).
  - `Math.abs(delta)` 내림차순 정렬. 호출부가 상위 N개만 사용.
- Vitest 단위테스트: 장소 합산·빈장소→기타·TOP+기타, 전월대비 증가/감소/신규(prev 0)/사라짐(cur 0)/정렬.

### 2. 장소 TOP 차트 — `src/App.tsx` `InsightsView`
- 새 `<section className="wide-section">` + SectionHeader "장소 TOP".
- 기존 "지출 비중" BarChart를 그대로 복제, `data = placeTotals(transactions, summary.monthKey, 7)`, YAxis dataKey="name"(장소).
- 데이터 0건이면 섹션 숨김(빈 차트 방지).

### 3. 카테고리 전월대비 증감 리스트 — `src/App.tsx`
- 새 `<section>` + SectionHeader "전월대비".
- `categoryDeltas(transactions, summary.monthKey, summary.previousMonth?.monthKey)` 상위 5개.
- 각 행: 카테고리명 · 변화율(`↑18%`/`↓12%`, rate null이면 'NEW') · 변화량(`+₩58,000`/`-₩12,000`) · **미니바**(|delta| / 최대 |delta| 비율 폭).
  - 증가=빨강(주의), 감소=초록(절약). 색은 CSS 변수/인라인.
- 전월 데이터 없음(`previousMonth` 없거나 상위 0개)이면 "비교할 전월 데이터가 쌓이는 중이에요" 안내.

### 4. 표시 위치(순서)
월별 흐름(기존) → **전월대비(신규)** → 텍스트 카드(기존) → 지출 비중(기존) → **장소 TOP(신규)**. (추세를 위로, 장소를 비중 옆에)

## 데이터 흐름
1. `InsightsView`가 `transactions`(merged) + `summary` 받음(현재 시그니처 그대로).
2. `placeTotals`/`categoryDeltas`를 렌더 시 계산(메모이즈 불필요, 수백 건 수준 — YAGNI).
3. 차트/리스트 렌더. 리포트·시트·GAS 변경 없음(읽기 전용 집계).

## 에러/엣지
- 첫 달(전월 없음) → 전월대비 안내 문구.
- 변동지출 0건 → 장소 TOP 섹션 숨김.
- 메모 빈 거래(드묾, 변동지출엔 거의 없음) → 장소 '기타'로 합산.
- `summary.previousMonth`에 monthKey 필드 존재 확인 필요(없으면 직전 달 문자열 계산). 구현 시 Summary 타입 확인.

## 테스트 전략
- `placeTotals`/`categoryDeltas` Vitest 단위테스트(위 케이스).
- 배포 후 Chrome 실측: 인사이트 탭에서 장소 TOP·전월대비 표시, 전월대비 증감 색/부호 확인.

## 범위 밖
- 예산·번레이트(이번 달 착지 예측), 분담금/둘이 관점.
- 장소/물건 전용 시트 컬럼, GAS 변경.
- 그룹/다이버징 바 차트.
