/**
 * 가계부 코치: 무엇을 언제 말할지 정하는 순수 함수.
 * 앱 홈 코치 카드와 서버 /api/coach(맥 미리알림)가 같이 쓴다 — 둘이 다른 말을 하지 않게.
 * 계산은 dashboardLogic 의 기존 함수를 부르기만 한다. 설계: docs/superpowers/specs/2026-10-11-money-coach-design.md
 */
import { isNonSpend, type SplitTxLike } from './dashboardLogic.js'

export type CoachTx = SplitTxLike & { payment?: string; category?: string; subCategory?: string; fixedType?: string }
export type Verdict = 'over' | 'heavy' | 'room' | 'ok'
export type CategoryState = { category: string; spent: number; spentYesterday: number; baseline: number; lastMonth: number; verdict: Verdict }

/** 조언 문장용 금액: 1만 이상은 "9만"·"1.5만", 그 미만은 "4,200원". */
export const fmt = (n: number) => {
  const v = Math.round(n)
  return Math.abs(v) >= 10000 ? `${Number((v / 10000).toFixed(1))}만` : `${v.toLocaleString('ko-KR')}원`
}
export const daysInMonth = (yearMonth: string) => {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const addMonths = (yearMonth: string, n: number) => {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
export const ym = (d: string) => d.slice(0, 7)
export const dayOf = (d: string) => Number(d.slice(8, 10))
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = Math.floor(s.length / 2)
  return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2)
}

const MIN_BASELINE = 50000
export const UNCATEGORIZED = '미분류'
const isVariableSpend = (t: CoachTx) =>
  t.type === 'expense' && t.fixedType !== 'fixed' && !isNonSpend(t) && (t.category || UNCATEGORIZED) !== UNCATEGORIZED
const net = (t: CoachTx) => t.amount - (t.split || 0)

/** 그 달 변동지출을 카테고리별 실지출로. until 을 주면 그 날짜(포함)까지만. */
function spendByCategory(transactions: CoachTx[], month: string, until?: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of transactions) {
    if (ym(t.date) !== month || !isVariableSpend(t) || (until && t.date > until)) continue
    const c = t.category as string
    m.set(c, (m.get(c) || 0) + net(t))
  }
  return m
}

/**
 * 카테고리 기준선: 이번 달을 뺀 끝난 최근 3개월(기록 있는 달만)의 실지출 중앙값.
 * 저장하지 않는다 — 끝난 달은 바뀌지 않으니 매번 계산해도 "매달 갱신한 값"과 같고, 지난 거래를 고쳐도 어긋나지 않는다.
 */
export function categoryBaselines(transactions: CoachTx[], yearMonth: string): Map<string, { baseline: number; lastMonth: number }> {
  const months = [1, 2, 3].map((n) => addMonths(yearMonth, -n))
  const recorded = months.filter((m) => transactions.some((t) => ym(t.date) === m))
  const sums = new Map(recorded.map((m) => [m, spendByCategory(transactions, m)]))
  const cats = new Set([...sums.values()].flatMap((s) => [...s.keys()]))
  const out = new Map<string, { baseline: number; lastMonth: number }>()
  for (const c of cats) {
    const baseline = median(recorded.map((m) => sums.get(m)?.get(c) || 0))
    if (baseline < MIN_BASELINE) continue
    out.set(c, { baseline, lastMonth: sums.get(months[0])?.get(c) || 0 })
  }
  return out
}

/**
 * 이번 달 이 카테고리를 많이 썼나, 여유 있나.
 * 날짜 기준 = baseline × day / days (오늘까지 평소대로 썼다면 쓴 돈).
 */
export function categoryVerdict(spent: number, baseline: number, day: number, days: number): Verdict {
  const expected = baseline * day / days                 // 날짜 기준: 오늘까지 평소대로 썼다면 쓴 돈
  if (day < 7) return 'ok'                               // 월초는 한두 건에 크게 흔들려 판정하지 않는다
  if (spent >= baseline) return 'over'                   // 평소 한 달치를 넘었다
  // 비율은 양변을 곱해 정수로 비교한다: 170000 × 0.7 이 118999.999… 가 되어 경계(119,000)를 놓쳤다.
  const atLeast = (tenths: number) => spent * days * 10 >= baseline * day * tenths   // spent ≥ expected × tenths/10
  const atMost = (tenths: number) => spent * days * 10 <= baseline * day * tenths
  if (atLeast(12) && spent - expected >= 30000) return 'heavy'   // 비율만 보면 작은 카테고리가 몇천 원에 울린다
  if (day >= 15 && atMost(7)) return 'room'
  return 'ok'
}

/** 기준선이 있는 카테고리마다 오늘·어제까지 쓴 돈과 판정. */
export function categoryStates(transactions: CoachTx[], today: string): CategoryState[] {
  const month = ym(today), day = dayOf(today), days = daysInMonth(month)
  const yesterday = day > 1 ? `${month}-${String(day - 1).padStart(2, '0')}` : ''
  const now = spendByCategory(transactions, month, today)
  const before = yesterday ? spendByCategory(transactions, month, yesterday) : new Map<string, number>()
  return [...categoryBaselines(transactions, month)].map(([category, b]) => {
    const spent = now.get(category) || 0
    return { category, spent, spentYesterday: before.get(category) || 0, ...b, verdict: categoryVerdict(spent, b.baseline, day, days) }
  })
}
