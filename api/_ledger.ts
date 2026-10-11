/**
 * 분담금 규칙 상수. 앱(src/dashboardLogic.ts)이 가져다 쓰고, skills/ledger/ledger.py 에 손으로 옮긴 사본이 있다.
 * 규칙을 바꾸면 양쪽을 같이 고친다. (월 요약·정산 계산은 ledger.py 가 원본이다.)
 */
export const PEOPLE: Record<string, string[]> = { 여친: ['브리', '여친', '여자친구'], 형: ['형'], 엄마: ['엄마'] }
export const REFUND_WORDS = ['환급', '리워드', '피클']
// ponytail: 이 날짜 전의 분담금은 '받음' 표시가 없어도 정산된 것으로 본다(옛 기록 40여 건에 표시가 없다).
export const SETTLE_SINCE = '2026-09-01'
export const SETTLED = '받음'
