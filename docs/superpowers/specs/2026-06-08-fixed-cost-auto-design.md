# 고정비 자동 반영 설계 (정의 시트 + 서버 자동입력 + 앱 관리화면)

작성일: 2026-06-08

## 목적
월세·통신·구독·보험·할부 등 매달 반복되는 고정비를 매번 입력하지 않아도 **서버가 자동으로** 원장에 기록한다. 앱에서 고정비 목록을 관리하고, 할부는 남은 금액을 보여준다.

## 확정 결정 (브레인스토밍 승인)
- **자동 입력**: 완전 자동 — Apps Script 시간 트리거(매일 1회)가 납부일에 원장에 기록. 앱 안 열어도 됨. 중복 자동 방지.
- **금액**: 저장 금액으로 자동 입력(변동 항목도). 실청구 다르면 앱에서 그 거래 수정.
- **할부**: 총회차 지정 → `남은 회차·남은 금액` 앱에 표시, 회차 끝나면 자동 중단(차 할부·맥북 할부).
- **관리 위치**: 앱 하단 탭바에 **"고정비" 탭** 추가(목록 + 추가/수정/켜고끄기).

## 컴포넌트 설계

### 1. 정의 시트 `v2_고정비`
컬럼: `[id, 활성, 이름, 금액, 대분류, 소분류, 결제수단, 납부일, 시작월, 할부총회차]`
- `활성`: TRUE/FALSE. `납부일`: 1~31. `시작월`: yyyy-MM. `할부총회차`: 비우면 무기한 정기, 숫자면 할부 N회.
- 시드(현재 데이터 기준 12개): 월세 950,000(주거/통신·주거비), 국민연금 171,682(주거/통신·세금/공과금), 아파트 관리비 282,850(주거/통신·관리비), SKT 통신비 45,750, SK브로드밴드 23,100, 메리츠화재 보험 52,480(건강·보험), 건강보험료 64,028, 넷플릭스 9,500·Apple 3,300·네이버플러스 4,900·Claude API 28,000(문화/구독·구독), 자동차 할부 515,690(교통/차량·할부, 총회차 비움→앱에서 설정), 맥북프로 할부 179,354(생활·전자기기, 총회차 14·시작월 2026-03). 납부일 기본 1.

### 2. 서버 자동 입력 (Apps Script)
- **`autoPostFixed_()`** (트리거 대상): 오늘 날짜·이번달 기준으로 각 활성 정의에 대해
  1. 이번달이 `[시작월, 시작월+할부총회차)` 범위인지(무기한이면 시작월 이후 항상).
  2. 오늘 `일 >= 납부일`(지나갔으면 catch-up).
  3. 원장에 **이번달 + 같은 이름** 거래가 이미 있으면 skip(중복 방지).
  4. 없으면 원장에 append: 날짜=`이번달-납부일`, 구분=지출, 고정/변동=고정, 대/소분류·금액·결제수단=정의값, 입력원='auto'.
- **`installFixedTrigger_()`**(1회): 기존 `autoPostFixed_` 트리거 없으면 `ScriptApp.newTrigger('autoPostFixed_').timeBased().everyDays(1).atHour(4).create()`.
- **`fixedRemaining_(def, yearMonth)`**: 할부면 `남은회차 = max(0, 총회차 - (yearMonth - 시작월 + 1))`, `남은금액 = 남은회차 × 금액`, `회차 = 경과/총`. 무기한이면 null.
- doGet/doPost(토큰): `fixedList`(정의 + 계산된 남은정보), `fixedSave`(id 있으면 갱신 없으면 추가), `fixedDelete`(id 삭제). 1회 setup 액션으로 시드 + 트리거 설치 후 제거.

### 3. 앱 — 남은금액 순수함수 (TDD)
- `src/dashboardLogic.ts`에 `fixedRemaining(def, yearMonth): { count: number; total: number; remainingCount: number; remainingAmount: number; done: boolean } | null` — 할부총회차 없으면 null. (백엔드 계산과 동일 규칙; 표시는 이 결과 사용.)
- 테스트: 진행중 할부, 완료된 할부(남은 0·done), 무기한(null).

### 4. 앱 — syncClient + 고정비 탭
- `src/sync/syncClient.ts`: `loadFixedDefs()`, `saveFixedDef(def)`, `deleteFixedDef(id)` (text/plain POST/ GET, 토큰).
- 탭바에 `'fixed'` 탭 추가(아이콘·라벨 "고정비").
- `FixedView` 화면:
  - 헤더: 월 고정비 합계.
  - 목록: 각 항목 `이름 · 금액 · 매월 N일`, 할부면 `X/N회 · 남은 NN원` 배지, 활성 토글.
  - 항목 탭 → 편집 폼(이름·금액·대/소분류 피커·결제수단·납부일·할부총회차·활성), 저장/삭제.
  - "+ 고정비 추가" 버튼 → 새 항목 폼.
  - 저장/삭제 후 `loadFixedDefs` 재조회.

## 데이터 흐름
1. 앱 고정비 탭에서 정의 추가/수정/토글 → `fixedSave`/`fixedDelete` → `v2_고정비`.
2. 매일 트리거 `autoPostFixed_` → 정의 읽어 납부일 도래분 원장에 자동 기록(중복 skip).
3. 앱은 원장(ledger) 읽어 거래 반영, 고정비 정의는 `fixedList`로 읽어 목록·남은금액 표시.

## 에러/엣지
- 중복 방지: 같은 달·같은 이름 거래 존재 시 자동 입력 skip. (수동 입력과도 충돌 방지.)
- 할부 회차 종료: 범위 벗어나면 자동 입력 안 함, 목록에 `완료` 표시.
- 자동차 할부 총회차 모름 → 시드는 무기한으로 두고 앱에서 사용자가 회차 설정.
- 트리거 중복 설치 방지: 기존 트리거 있으면 새로 안 만듦.
- 변동 항목(관리비 등): 저장 금액으로 자동, 실청구 다르면 앱에서 거래 수정(정의 금액도 수정 가능).
- 금액 0 또는 비활성 항목: 자동 입력 제외.

## 테스트 전략
- `fixedRemaining` 단위테스트(Vitest).
- syncClient fixed* fetch 모킹 테스트.
- 백엔드: curl `fixedList`/`fixedSave`/`fixedDelete` 동작, `autoPostFixed_` 1회 수동 실행 → 이번달 자동 기록·중복 skip 확인. 기존 ledger/load/save/assignCategory 회귀 없음.
- 통합 수동: 앱 고정비 탭에서 추가/수정/토글, 할부 남은금액 표시, 자동입력된 거래 원장 반영 확인.

## 범위 밖
- 변동 항목 실청구액 자동 동기화(은행/카드 연동).
- 고정비 알림/푸시.
- 주/연 단위 반복(월 단위만).

## 기존 코드 영향
- `Code.gs`(+repo .gs): `v2_고정비` 시트, `readFixedDefs_`, `autoPostFixed_`, `installFixedTrigger_`, `fixedRemaining_`, doGet/doPost `fixedList`/`fixedSave`/`fixedDelete`, 1회 setup(시드+트리거).
- `src/dashboardLogic.ts`: `fixedRemaining`(+테스트).
- `src/sync/syncClient.ts`: `loadFixedDefs`/`saveFixedDef`/`deleteFixedDef`(+테스트).
- `src/App.tsx`: `'fixed'` 탭 + `FixedView`(목록·편집폼).
- `src/App.css`: 고정비 목록·배지·폼 스타일.
