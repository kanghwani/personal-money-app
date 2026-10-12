/**
 * 가계부 코치: 무엇을 언제 말할지 정하는 순수 함수.
 * 앱 홈 코치 카드와 서버 /api/coach(맥 미리알림)가 같이 쓴다 — 둘이 다른 말을 하지 않게.
 * 계산은 dashboardLogic 의 기존 함수를 부르기만 한다. 설계: docs/superpowers/specs/2026-10-11-money-coach-design.md
 */
import {
  CARD_SPECS, benefitBalances, cardGlance, isNonSpend, isOpenSplit, missedBenefits, splitPerson, tierStatus, withInstallmentCharges,
  type CardSpec, type FixedDef, type SplitTxLike,
} from './dashboardLogic.js'

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

export type AdviceKind = 'tier' | 'nextTier' | 'unused' | 'missed' | 'split' | 'category' | 'record'
export type Advice = {
  id: string; kind: AdviceKind; title: string; detail: string
  badge?: string; due?: string; amount: number; target?: 'insights' | 'uncategorized'
}

const pct = (r: number) => `${Math.round(r * 100)}%`
const monthLabel = (m: string) => `${Number(m.slice(5))}월`
const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const FOOD = ['외식비', '식비']
const SIDE_INCOME = '부수입'

/** 첫 구간을 채우면 다음 달 받는 할인 크기: 통합 한도면 구간 한도, 영역별이면 영역 한도 합. 우선순위에 쓴다. */
function stakeOf(spec: CardSpec): number {
  const tierCap = tierStatus(Math.min(...spec.tiers.map((t) => t.min)), spec.tiers).cap
  return spec.sharedCap ? tierCap : spec.benefits.reduce((s, b) => s + (b.cap > 0 ? b.cap : tierCap), 0)
}

/** 실적 부족·다음 구간·남은 혜택·놓친 혜택. 할부 보정(withInstallmentCharges)을 거친 행으로 혜택 보드와 같은 숫자를 낸다. */
function cardAdvice(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): Advice[] {
  const month = ym(today), days = daysInMonth(month), left = days - dayOf(today)
  const due = `${month}-${String(days).padStart(2, '0')}`
  const rows = withInstallmentCharges(transactions, fixedDefs)
  const balances = benefitBalances(rows, month)
  const out: Advice[] = []
  for (const g of cardGlance(rows, month, balances)) {
    if (g.unknown) continue   // 가족 합산(국민카드): 매달 첫 구간 충족으로 간주한다
    const spec = CARD_SPECS.find((s) => s.card === g.card)
    if (!spec) continue
    const min = Math.min(...spec.tiers.map((t) => t.min))
    if (!g.met) {
      const cap = tierStatus(min, spec.tiers).cap
      out.push({ id: `tier:${g.card}`, kind: 'tier', title: `${g.card} 실적 ${fmt(min - g.qualified)} 더 필요`,
        detail: `지금 ${fmt(g.qualified)} / ${fmt(min)}. 이달 안에 채우면 ${monthLabel(addMonths(month, 1))} ${cap > 0 ? `할인한도 ${fmt(cap)}` : '혜택이 열려요'}`,
        badge: `D-${left}`, due, amount: stakeOf(spec), target: 'insights' })
    } else if (g.nextGap > 0 && g.nextGap <= 50000) {
      const st = tierStatus(g.qualified, spec.tiers)
      if (st.next) out.push({ id: `nextTier:${g.card}`, kind: 'nextTier', title: `${g.card} ${fmt(g.nextGap)} 더 쓰면 한도 올라가요`,
        detail: `다음 달 할인한도 ${fmt(st.cap)} → ${fmt(st.next.cap)}`, amount: st.next.cap - st.cap, target: 'insights' })
    }
  }
  const byCard = new Map<string, typeof balances>()
  for (const b of balances) if (!b.locked && b.remaining > 0) byCard.set(b.card, [...(byCard.get(b.card) || []), b])
  for (const [card, items] of byCard) {
    const sum = items.reduce((s, b) => s + b.remaining, 0)
    const top = [...items].sort((a, b) => b.remaining - a.remaining).slice(0, 2)
    out.push({ id: `unused:${card}`, kind: 'unused', title: `${card} 혜택 ${fmt(sum)} 남음`,
      detail: top.map((b) => `${b.area} ${pct(b.rate)} ${fmt(b.remaining)}`).join(' · '),
      badge: `${fmt(sum)} 남음`, due, amount: sum, target: 'insights' })
  }
  const missed = new Map<string, { area: string; card: string; sum: number; count: number }>()
  for (const h of missedBenefits(rows, month)) {
    const k = `${h.area}:${h.bestCard}`
    const m = missed.get(k) ?? { area: h.area, card: h.bestCard, sum: 0, count: 0 }
    missed.set(k, { ...m, sum: m.sum + h.discount, count: m.count + 1 })
  }
  for (const [k, m] of missed) if (m.sum >= 3000)
    out.push({ id: `missed:${k}`, kind: 'missed', title: `${m.area}엔 ${m.card}`,
      detail: `이번 달 ${fmt(m.sum)} 놓쳤어요 (${m.count}건)`, amount: m.sum, target: 'insights' })
  return out
}

/** 안 받은 지 30일 넘은 분담금을 상대별로. */
function splitAdvice(transactions: CoachTx[], today: string): Advice[] {
  const cutoff = Date.parse(today) - 30 * 86400000
  const by = new Map<string, CoachTx[]>()
  for (const t of transactions) {
    if (!isOpenSplit(t) || Date.parse(t.date) > cutoff) continue
    const who = splitPerson(t.memo)
    by.set(who, [...(by.get(who) || []), t])
  }
  return [...by].map(([who, ts]) => {
    const sum = ts.reduce((s, t) => s + t.split, 0)
    return { id: `split:${who}`, kind: 'split' as const, title: `${who} 분담금 ${fmt(sum)} 받을 돈`,
      detail: `${ts.length}건, 가장 오래된 건 ${mmdd(ts.map((t) => t.date).sort()[0])}`, amount: sum }
  })
}

/** 한 달치를 넘었다는 조언. 판정(7일 이전엔 ok)과 무관하게 alertFor 의 "처음 넘은 날"에도 쓴다. */
export const overAdvice = (s: CategoryState): Advice => ({ id: `cat:${s.category}`, kind: 'category',
  title: `${s.category} 평소 한 달치를 넘었어요`, detail: `${fmt(s.spent)} / 평소 ${fmt(s.baseline)}`, amount: s.spent - s.baseline })

function categoryAdvice(transactions: CoachTx[], today: string): Advice[] {
  const days = daysInMonth(ym(today)), day = dayOf(today), left = days - day
  return categoryStates(transactions, today).flatMap((s): Advice[] => {
    if (s.verdict === 'over') return [overAdvice(s)]
    if (s.verdict === 'heavy') {
      const proj = Math.round(s.spent / day * days)
      const tail = left > 0 ? `. 남은 ${left}일은 하루 ${fmt(Math.max(0, s.baseline - s.spent) / left)}면 평소대로` : ''
      return [{ id: `cat:${s.category}`, kind: 'category', title: `${s.category} 많이 썼어요`,
        detail: `지금 ${fmt(s.spent)}, 이 속도면 월말 ${fmt(proj)}(평소 ${fmt(s.baseline)})${tail}`, amount: proj - s.baseline }]
    }
    if (s.verdict === 'room') {
      const room = s.baseline - s.spent
      return [{ id: `cat:${s.category}`, kind: 'category', title: `${s.category} 여유 있어요`,
        detail: `남은 ${left}일 동안 ${fmt(room)}까지 괜찮아요${FOOD.includes(s.category) ? '. 맛있는 거 드세요' : ''}`, amount: room }]
    }
    return []
  })
}

/** 미분류 거래, 끝난 달 부수입 0건(플랫폼 정산은 월말에 몰아 넣는다 — 2026-09 를 통째로 빠뜨린 적 있음). */
function recordAdvice(transactions: CoachTx[], today: string): Advice[] {
  const month = ym(today), prev = addMonths(month, -1)
  const out: Advice[] = []
  const uncat = transactions.filter((t) => t.type === 'expense' && ym(t.date) === month && (t.category || UNCATEGORIZED) === UNCATEGORIZED)
  if (uncat.length) out.push({ id: 'record:uncategorized', kind: 'record', title: `미분류 ${uncat.length}건`,
    detail: '눌러서 카테고리를 정해 주세요', amount: 0, target: 'uncategorized' })
  if (!transactions.some((t) => t.type === 'income' && ym(t.date) === prev && t.subCategory === SIDE_INCOME))
    out.push({ id: 'record:side', kind: 'record', title: `${monthLabel(prev)} 부수입 0건`,
      detail: '배민·쿠팡이츠·펫택시·퀵 정산 넣었어요?', amount: 0 })
  return out
}

/** 오늘의 조언 전체. 마감 가까운 것 → 금액 큰 것. */
export function coachAdvice(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): Advice[] {
  return [...cardAdvice(transactions, fixedDefs, today), ...splitAdvice(transactions, today),
    ...categoryAdvice(transactions, today), ...recordAdvice(transactions, today)]
    .sort((a, b) => (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') || b.amount - a.amount)
}
