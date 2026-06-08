# 상세 카테고리 보기 설계 (도넛 + 아이콘 리스트 + 탭 상세)

작성일: 2026-06-08

## 목적
홈의 카테고리 영역을 더 상세하게: 전체 카테고리를 아이콘과 함께 보고, 카테고리를 탭하면 그 카테고리의 거래 내역을 본다. (레퍼런스: 아이콘이 붙은 카테고리 도넛 — 단 폰에 맞게 도넛 + 아이콘 리스트 형태로.)

## 확정 결정 (브레인스토밍 승인)
- **형태**: 홈 도넛은 유지하고, 그 아래 **아이콘 리스트**로 전체 카테고리 표시. (B 달력 입력은 별도 작업.)
- **아이콘**: 대분류별 이모지 매핑. 색은 도넛 색(RING_COLORS)과 같은 인덱스(순위 순).
- **도넛**: 상위 7개 + "기타"로 묶어 표시(폰에서 슬라이버 난립 방지). **리스트는 전체 카테고리**.
- **탭 상세**: 카테고리 행 탭 → 하단 시트로 그 카테고리 거래(merged, 최신순) + 소분류별 소계.

## 컴포넌트 설계

### 1. `categoryIcon` (신규 순수함수 + 테스트)
- `src/dashboardLogic.ts`에 추가(또는 동일 모듈): `categoryIcon(category: string): string`.
- 대분류 키워드 → 이모지 맵. 예:
  - 식비 🍚, 주거/통신 🏠, 교통/차량 🚗, 취미 🎮, 생활 🧴, 문화/구독 📺, 건강 💊, 자기계발 📘, 수입 💰, 미분류 ❓
  - 부분 일치(키워드 포함) 허용: 카테고리명에 '식'→식비 아이콘 등은 과하므로 **정확 키 우선, 없으면 기본 '💸'**. (단순·예측가능)
- 테스트: 알려진 카테고리 매핑, 미매핑은 기본 아이콘, 빈 문자열 처리.

### 2. 홈 카테고리 리스트 확장 (`src/App.tsx` Dashboard)
- 현재 `summary.categoryTotals.slice(0, 5)` → **전체** `summary.categoryTotals` 표시(컨테이너 스크롤 가능).
- 각 행(`cat-rank-row`): 기존 색점 자리를 **색 원 + 아이콘**으로 교체. 구조:
  `[색 원(배경=RING_COLORS[i], 안에 categoryIcon)] 카테고리명 …… 금액  %`.
  - 인덱스 i가 RING_COLORS 길이를 넘으면 색 순환(`i % RING_COLORS.length`).
- 도넛(`CategoryRing`) 입력은 **상위 7 + 기타 합산**으로 변경: 7개 초과 시 나머지를 `{ name: '기타', value: 합 }` 한 항목으로 묶어 8조각 이하.
- 행은 클릭 가능: 탭 시 선택 카테고리 state 설정 → 상세 시트 오픈.

### 3. `CategoryDetailSheet` (신규 컴포넌트)
- props: `category: string`, `transactions: Transaction[]`(해당 카테고리 필터된 merged), `onClose`.
- 표시: 헤더(아이콘+카테고리명+합계), **소분류별 소계**(subCategory로 group, 금액 내림차순), 그 아래 **거래 목록**(최신순, memo·날짜·금액).
- 하단에서 올라오는 시트(fixed, backdrop). 닫기 버튼/백드롭 탭으로 닫힘.
- 데이터: `mergedTransactions.filter(t => t.category === category)` (지출 기준; 이번 달 또는 전체 — **전체 기간**으로 하되 헤더에 건수 표기).

## 데이터 흐름
- 아이콘/리스트/도넛: `summary.categoryTotals`(이미 전체) + `categoryIcon`.
- 상세 시트: App에서 `selectedCategory` state. 행 탭 → set. `CategoryDetailSheet`에 `mergedTransactions.filter(category===selected)` 전달.
- 동기화·원장병합·summary 계산 로직 변경 없음(표시 계층만).

## 에러/엣지
- 카테고리 0개(데이터 없음): 리스트 비어있을 때 안내 문구.
- 미매핑 카테고리: 기본 아이콘 '💸'.
- '기타' 묶음 행 탭: 상세 시트는 '기타'에 속한(상위 7 외) 카테고리들의 거래를 합쳐 보여줄지 — **'기타'는 탭 비활성**(혹은 리스트에서 개별 카테고리로 보게 안내). 단순화: 도넛만 기타로 묶고 **리스트는 전체 개별** → 리스트에서 각 카테고리 탭 상세 가능. '기타'라는 행은 리스트에 없음(리스트는 개별 전체).

## 테스트 전략
- `categoryIcon` 단위테스트(Vitest).
- 도넛 상위7+기타 묶기 로직이 순수함수면 테스트(예: `topNWithOther(data, 7)`); 컴포넌트 인라인이면 빌드+시각검증.
- 빌드(tsc) + 기존 테스트 회귀 없음.
- 통합 수동: 배포 후 Chrome으로 리스트 전체 표시·아이콘·탭 상세 시트 확인.

## 범위 밖 (별도 작업)
- **B. 달력형 입력** (원장 탭 목록/달력 토글) — 다음 작업.
- 아이콘을 라인아트 SVG로 (이번엔 이모지).
- 카테고리 편집/재분류 UI.

## 기존 코드 영향
- `src/dashboardLogic.ts`: `categoryIcon`(+필요시 `topNWithOther`) 추가.
- `src/App.tsx`: Dashboard 카테고리 리스트 확장 + 아이콘, CategoryRing 입력 묶기, `selectedCategory` state, `CategoryDetailSheet` 신설.
- `src/App.css`: 아이콘 원·상세 시트 스타일.
