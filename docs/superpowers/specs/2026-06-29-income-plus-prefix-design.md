# 수입 빠른입력: + 프리픽스

작성일: 2026-06-29

## 목적
일회성 수입(용돈·환급·정산)을 빠른입력으로 쉽게. 맨 앞 `+`면 수입으로 처리.

## 결정 (브레인스토밍 승인)
- `+600000 월세 여친` → 수입. 맨 앞 `+`면 `type=income`, `+` 제거 후 `금액 출처 [입금수단]` 파싱.
- 기존 키워드(`수입/월급/급여/입금/보너스`)도 유지 — 하위호환 + 시리 음성용("플러스"는 어색).
- 수입이면 대분류 강제 `수입` (지출용 classify가 "월세"→주거/통신로 오분류하는 것 방지). 소분류는 classify 결과가 '수입'이면 유지, 아니면 빈값.
- 입금수단 안 적으면 비움.
- 앱 파서 + GAS 파서 양쪽 적용. placeholder에 힌트 추가.

## 구현 단계

### 1. 앱 파서 `parseTransactionEntry` (App.tsx ~1781)
- `text` 생성 직후: `const forcedIncome = /^\+/.test(text); text = text.replace(/^\+\s*/, '')`.
- `type` 판정: `forcedIncome || /수입|월급|급여|입금|보너스/.test(raw) ? 'income' : 'expense'`.
- 분류: income이면 `category = { category: '수입', sub: guessed.category === '수입' ? guessed.sub : '' }`, 아니면 기존 `guessed`.

### 2. GAS 파서 `parseQuickText_` (manage_money_apps_script.gs ~1016)
- 함수 시작 `let text = ...` 다음: `var forcedIncome = /^\+/.test(text); text = text.replace(/^\+\s*/, '');`.
- `type: body.type || ((forcedIncome || /수입|입금|월급|급여/.test(raw)) ? '수입' : '지출')`.
- GAS 재배포 1회.

### 3. placeholder (App.tsx ~468)
- `금액 장소 물건 결제수단` → `금액 장소 물건 · +면 수입`.

## 엣지
- `+600000` 만: 출처 없으면 memo 기본 '수입'.
- 금액 정규식은 `+`를 숫자에 포함 안 함 → `+` 명시 제거로 memo 잔재 방지.
- 시리 음성 "플러스"는 인식 안 함(기존 키워드로 커버).

## 테스트
- GAS: `?action=add&raw=%2B600000%20용돈`(무금액 아님 주의 — 금액 있으면 원장 기록되니 테스트 후 삭제) 또는 파서 결과만 확인.
- 앱: Chrome 실측 `+50000 용돈` → 수입(+표시), 대분류 수입.

## 범위 밖
- 정기수입 등록 폼 간소화(고정비 탭) — 후속.
