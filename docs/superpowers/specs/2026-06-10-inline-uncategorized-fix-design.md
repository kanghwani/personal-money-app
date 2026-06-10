# 칩 제거 + 미분류 인라인 교정 + 로컬 규칙 학습 설계

작성일: 2026-06-10

## 목적
홈의 "빠른 입력 칩"(직전 금액 고정 즉시기록)은 금액이 매번 같아 실용성이 낮다. 이를 없애고, 대신 **자동분류는 유지하되 결과가 미분류일 때만 그 자리에서 카테고리를 교정**할 수 있게 한다. 교정한 내용은 **로컬 규칙으로 즉시 학습**되어 다음에 같은 가게를 입력하면 앱 자체 파서(`parseQuickEntry`)가 자동분류한다. 시간이 갈수록 미분류가 0에 수렴하는 게 목표.

## 배경 (현재 동작)
- 홈 상단: `deriveQuickChips`로 만든 칩 → 탭 시 직전 금액으로 즉시 기록. (제거 대상)
- 텍스트 입력 `오늘 5000 점심밥` → `parseQuickEntry` → `classify(memo)`가 **하드코딩 `categoryRules` 배열**만 보고 자동분류. 매칭 없으면 미분류.
- 교정 경로는 이미 있음: `assignCategoryFor`(App) → `assignCategory`(syncClient) → GAS `assignCategory_` → `v2_분류규칙` 학습 + 같은 내역 일괄.
- **단절점:** 앱 텍스트 입력은 로컬 `classify`만 쓰므로, 서버 시트에 학습된 규칙이 **앱의 다음 자동분류에 반영되지 않는다.** (사용자 체감 "자동화 잘 안 됨"의 원인)

## 확정 결정 (브레인스토밍 승인)
- **칩 제거** — 홈의 빠른 입력 칩 UI 삭제.
- **미분류일 때만** 입력 직후 인라인 카테고리 교정 칩 노출.
- **로컬 학습 규칙** — 교정 시 `메모 키워드 → {category, subCategory}`를 localStorage에 저장하고, `parseQuickEntry`가 하드코딩 규칙보다 **먼저** 참조 → 즉시·오프라인 자동분류.
- **키워드 추출** — 교정 대상 거래의 **memo(이미 금액·결제수단·날짜가 제거된 상태)**를 그대로 키워드로 저장. 매칭은 새 입력 memo가 학습 키워드를 **포함(substring)**하면 적용.
- 서버 동기화(`assignCategory`)도 그대로 호출 → 시트 규칙·원장에도 반영(기존 동작 유지).

## 컴포넌트 설계

### 1. 로컬 학습 규칙 — 순수 모듈 (TDD)
`src/learnedRules.ts` (신규):
- 타입 `LearnedRule = { keyword: string; category: string; subCategory: string }`.
- `loadLearnedRules(): LearnedRule[]` — localStorage `shiba-learned-rules:v1` 읽기(파싱 실패 시 `[]`).
- `saveLearnedRule(rule)` — 같은 `keyword`(trim, 소문자 비교) 있으면 갱신, 없으면 앞에 추가. 빈 keyword/category는 무시.
- `classifyByLearned(memo, rules): {category, subCategory} | null` — `rules` 중 keyword가 memo에 포함(소문자 substring)되는 첫 항목 반환, 없으면 null. **긴 keyword 우선**(더 구체적인 규칙이 먼저 매칭되도록 길이 내림차순).
- 모두 순수함수(저장/로드는 localStorage 주입 or try/catch 래핑). Vitest 단위테스트:
  - 저장→로드 왕복, 중복 keyword 갱신, 포함 매칭, 긴 keyword 우선, 미매칭 null, 빈 입력 무시.

### 2. 앱 파서 연결 — `classify` 보강
- `parseTransactionEntry`에서 `classify(text)` 호출 전, **학습 규칙을 먼저** 확인:
  - `classifyByLearned(text, loadLearnedRules())`가 결과 있으면 그걸 사용.
  - 없으면 기존 `classify(text)`(하드코딩) 폴백.
- `classify` 자체는 유지(폴백). 우선순위: 학습 규칙 → 하드코딩 규칙 → 미분류.

### 3. 홈 UI — 칩 제거 + 미분류 인라인 교정
`App.tsx` Dashboard 탭 영역:
- **제거:** `quick-chips` 블록 + `deriveQuickChips`/`logQuickChip`/`logQuickChipForDate` 사용처. (deriveQuickChips export는 남겨도 무방하나 미사용이면 정리.)
- **추가:** 마지막 입력 거래가 `category === '미분류'`이면 입력창(QuickEntry) 아래에 **교정 칩 줄** 표시.
  - 상태: `pendingUncategorized: Transaction | null`(App). `applyQuickInput`에서 결과 거래가 미분류면 set, 아니면 null.
  - 칩 옵션: `distinctCategoryOptions(mergedTransactions)`(기존) + 비었을 때를 위한 **기본 카테고리 폴백 목록**(식비/외식, 식비/카페간식, 식비/장보기, 생활/생활잡화, 교통/차량, 주거/통신, 건강, 문화/구독, 취미). 상위 N개(예: 8) 노출.
  - 칩 탭 → `assignAndLearn(tx, category, subCategory)`:
    1. 로컬 거래면 store에서 해당 tx의 category/subCategory 갱신(기존 `editTransaction` 재사용 가능).
    2. `saveLearnedRule({ keyword: tx.memo, category, subCategory })`.
    3. `assignCategory(tx.id, category, subCategory, tx.memo)` 서버 호출(기존).
    4. `pendingUncategorized = null`, 상태 메시지 "○○로 분류됨, 다음부터 자동".
- 기존 "되돌리기" 토스트는 유지(미분류 칩과 공존: 토스트 위/아래 배치).

### 4. CSS
- 기존 `.quick-chips`/`.quick-chip` 스타일 재활용 또는 `.fix-chips`/`.fix-chip` 신설(작은 칩, 가로 스크롤). 미분류 안내 라벨("미분류 — 카테고리를 골라주세요") 추가.

## 데이터 흐름
1. 사용자가 `오늘 5000 서브웨이` 입력 → `applyQuickInput` → `parseQuickEntry`.
2. 학습 규칙·하드코딩 모두 미스 → 거래 미분류로 store 추가 + `pendingUncategorized` set.
3. 홈에 교정 칩 노출. 사용자가 "식비/외식" 탭.
4. `assignAndLearn`: store 거래 갱신 + 로컬 규칙 `서브웨이→식비/외식` 저장 + 서버 `assignCategory`.
5. 다음에 `서브웨이 8000` 입력 → `classifyByLearned`가 "서브웨이" 포함 매칭 → **자동 식비/외식** (미분류 칩 안 뜸).

## 에러/엣지
- localStorage 파싱 실패/용량 초과: try/catch로 무시, 기능 degrade(학습만 안 됨).
- 같은 memo가 여러 키워드 매칭: 긴 keyword 우선 → 가장 구체적 규칙 적용.
- 미분류 거래를 교정 안 하고 다른 입력하면: `pendingUncategorized`는 **마지막 입력 기준**으로 갱신(직전 미분류는 칩에서 사라짐, 원장/카테고리 상세에서 나중에 교정 가능).
- 서버 오프라인: 로컬 학습·거래 갱신은 되고 서버 동기화만 실패(다음 동기화 때 반영). 사용자 차단 없음.
- 수입 거래는 미분류 교정 칩 대상에서 제외(지출만). 입력이 수입이면 칩 미노출.

## 테스트 전략
- `learnedRules.ts` Vitest 단위테스트(위 6 케이스).
- `parseTransactionEntry`가 학습 규칙 우선 적용하는지 테스트(localStorage 모킹 또는 규칙 주입 형태로).
- 수동(배포본, Chrome 실측): 미분류 입력 → 칩 노출 → 교정 → 같은 메모 재입력 시 자동분류 확인. 칩 제거 확인.

## 범위 밖
- 학습 규칙 관리/삭제 UI(필요 시 별도).
- 서버 시트 규칙을 앱으로 역동기화(이번엔 로컬 학습으로 충분; 추후 `action=rules`로 확장 가능).
- AI 분류 fallback.
