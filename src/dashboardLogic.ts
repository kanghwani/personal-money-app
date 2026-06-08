export type TxLike = {
  date: string
  type: string
  amount: number
  category: string
  subCategory: string
  payment: string
  fixedType: string
}

export type QuickChip = {
  key: string
  emoji: string
  label: string
  amount: number
  category: string
  subCategory: string
  payment: string
  fixedType: 'fixed' | 'variable'
}

/** 전월 대비 증감률. 이전이 0/falsy면 null. */
export function changeRate(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous
}

const EMOJI: Record<string, string> = {
  카페: '☕', 외식: '🍚', 장보기: '🛒', 이동: '🚕', 차량: '🚗',
  게임: '🎮', 구독: '📺', 관리: '💊', 교육: '📘', 생활잡화: '🧴',
}

const CATEGORY_ICON: Record<string, string> = {
  식비: '🍚',
  '주거/통신': '🏠',
  '교통/차량': '🚗',
  취미: '🎮',
  생활: '🧴',
  '문화/구독': '📺',
  건강: '💊',
  자기계발: '📘',
  수입: '💰',
  미분류: '❓',
}

/** 대분류 → 이모지. 미매핑/빈값은 기본 '💸'. */
export function categoryIcon(category: string): string {
  return CATEGORY_ICON[(category || '').trim()] || '💸'
}

export type NV = { name: string; value: number }

/** 상위 n개 + 나머지를 '기타'로 합산(합 0이면 생략). n 이하면 원본 그대로. */
export function topNWithOther(data: NV[], n: number): NV[] {
  if (data.length <= n) return data
  const top = data.slice(0, n)
  const otherValue = data.slice(n).reduce((s, d) => s + d.value, 0)
  return otherValue > 0 ? [...top, { name: '기타', value: otherValue }] : top
}

type DayTxLike = { date: string; type: string; amount: number; split: number }

/** 해당 월(yyyy-MM)의 지출을 날짜(일)별 실지출(amount-split)로 합산. 수입/타월 제외. */
export function dailyTotals(transactions: DayTxLike[], yearMonth: string): Record<number, number> {
  const out: Record<number, number> = {}
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    if (t.date.slice(0, 7) !== yearMonth) continue
    const day = Number(t.date.slice(8, 10))
    if (!day) continue
    out[day] = (out[day] || 0) + (t.amount - (t.split || 0))
  }
  return out
}

/** 최근 지출에서 소분류(없으면 대분류)별 빈도 상위 N개를 빠른칩으로. 기본값은 그룹의 최신 거래. */
export function deriveQuickChips(transactions: TxLike[], limit: number): QuickChip[] {
  const groups = new Map<string, TxLike[]>()
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const key = (t.subCategory || t.category || '기타').trim()
    const arr = groups.get(key)
    if (arr) arr.push(t)
    else groups.set(key, [t])
  }
  return [...groups.entries()]
    .map(([key, arr]) => {
      const latest = arr.reduce((a, b) => (a.date >= b.date ? a : b))
      const chip: QuickChip = {
        key,
        emoji: EMOJI[key] || '💰',
        label: key,
        amount: latest.amount,
        category: latest.category,
        subCategory: latest.subCategory,
        payment: latest.payment,
        fixedType: latest.fixedType === 'fixed' ? 'fixed' : 'variable',
      }
      return { count: arr.length, chip }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((x) => x.chip)
}
