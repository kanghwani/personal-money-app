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
  // es 카테고리(F-minor-b)
  Comida: '🍚',
  Vivienda: '🏠',
  Transporte: '🚗',
  Ocio: '🎮',
  Vida: '🧴',
  Salud: '💊',
  Compras: '🛍️',
  Desarrollo: '📘',
  Ingreso: '💰',
  'Sin categoría': '❓',
}

/** 대분류 → 이모지. 미매핑/빈값은 기본 '💸'. */
export function categoryIcon(category: string): string {
  return CATEGORY_ICON[(category || '').trim()] || '💸'
}

export type NV = { name: string; value: number }

/** 상위 n개 + 나머지를 otherLabel(기본 '기타')로 합산(합 0이면 생략). n 이하면 원본 그대로. */
export function topNWithOther(data: NV[], n: number, otherLabel: string = '기타'): NV[] {
  if (data.length <= n) return data
  const top = data.slice(0, n)
  const otherValue = data.slice(n).reduce((s, d) => s + d.value, 0)
  return otherValue > 0 ? [...top, { name: otherLabel, value: otherValue }] : top
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

export type FixedDef = {
  id: string
  active: boolean
  name: string
  amount: number
  category: string
  subCategory: string
  payment: string
  payDay: number
  startMonth: string
  installmentTotal: number | null
  variable: boolean
  split: number
  kind: 'expense' | 'income'
}

/** 입력 텍스트에서 분담금을 추출한다. "분담 N"/"분담금 N" → N, "반반"/"반띵"/"/2" → 금액의 절반. */
export function splitFromText(text: string, amount: number): { split: number; remaining: string } {
  const m = text.match(/분담(?:금)?\s*([\d,]+)/)
  if (m) {
    const n = Number(m[1].replace(/,/g, '')) || 0
    return { split: n, remaining: text.replace(m[0], '').replace(/\s+/g, ' ').trim() }
  }
  if (/반반|반띵|\/\s*2(?![\d])/.test(text)) {
    return { split: Math.floor(amount / 2), remaining: text.replace(/반반|반띵|\/\s*2(?![\d])/, '').replace(/\s+/g, ' ').trim() }
  }
  return { split: 0, remaining: text }
}

function monthIndex(ym: string): number {
  const [y, m] = String(ym).split('-').map(Number)
  return y * 12 + (m - 1)
}

/** 할부 항목의 경과/남은 회차와 금액. 무기한(installmentTotal 없음)이면 null. */
export function fixedRemaining(
  def: FixedDef,
  yearMonth: string,
): { count: number; total: number; remainingCount: number; remainingAmount: number; done: boolean } | null {
  if (!def.installmentTotal) return null
  const total = def.installmentTotal
  const elapsed = monthIndex(yearMonth) - monthIndex(def.startMonth) + 1
  const count = Math.max(0, Math.min(total, elapsed))
  const remainingCount = Math.max(0, total - elapsed)
  return { count, total, remainingCount, remainingAmount: remainingCount * def.amount, done: remainingCount === 0 }
}

// ko/es 미분류 라벨 둘 다 기본으로 걸러낸다(F-minor-b: es에서 'Sin categoría'가 선택 가능한
// 카테고리로 노출되던 문제). 필요하면 호출부에서 다른 라벨 목록을 넘길 수 있다.
const DEFAULT_UNCATEGORIZED_LABELS = ['미분류', 'Sin categoría']

/** 지출 거래에서 고유 (대분류,소분류) 조합을 빈도 내림차순으로. 미분류/수입 제외. */
export function distinctCategoryOptions(
  transactions: TxLike[],
  uncategorizedLabels: string[] = DEFAULT_UNCATEGORIZED_LABELS,
): { category: string; subCategory: string }[] {
  const counts = new Map<string, { category: string; subCategory: string; n: number }>()
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    if (!t.category || uncategorizedLabels.includes(t.category)) continue
    const key = t.category + ' ' + (t.subCategory || '')
    const e = counts.get(key)
    if (e) e.n++
    else counts.set(key, { category: t.category, subCategory: t.subCategory || '', n: 1 })
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).map(({ category, subCategory }) => ({ category, subCategory }))
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

/** memo를 장소(첫 단어)+물건(나머지)로 분리. 공백 정리 후 첫 공백 기준. */
export function splitPlaceItem(memo: string): { place: string; item: string } {
  const text = (memo || '').trim().replace(/\s+/g, ' ')
  if (!text) return { place: '', item: '' }
  const sp = text.indexOf(' ')
  if (sp < 0) return { place: text, item: '' }
  return { place: text.slice(0, sp), item: text.slice(sp + 1) }
}

/** 장소+물건을 공백으로 합쳐 memo 생성. 빈 값 안전 처리. */
export function joinPlaceItem(place: string, item: string): string {
  return `${(place || '').trim()} ${(item || '').trim()}`.trim()
}

type PlaceTxLike = { date: string; type: string; amount: number; split: number; fixedType: string; memo: string }

/** 해당 월 변동지출을 장소(memo 첫 단어)별 실지출 합산 → 내림차순 TOP n + 기타. 빈 장소는 '기타'. */
export function placeTotals(transactions: PlaceTxLike[], yearMonth: string, n: number): NV[] {
  const map = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'expense' || t.fixedType === 'fixed') continue
    if (t.date.slice(0, 7) !== yearMonth) continue
    const place = splitPlaceItem(t.memo).place || '기타'
    map.set(place, (map.get(place) || 0) + (t.amount - t.split))
  }
  const rows = [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  return topNWithOther(rows, n)
}

export type CategoryDelta = { name: string; cur: number; prev: number; delta: number; rate: number | null }
type CatTxLike = { date: string; type: string; amount: number; split: number; category: string; fixedType: string }

/** 두 달 변동지출을 카테고리별 실지출 합산 → {cur,prev,delta,rate}, |delta| 내림차순. prevMonth 없으면 prev=0. */
export function categoryDeltas(transactions: CatTxLike[], curMonth: string, prevMonth: string | undefined): CategoryDelta[] {
  const sum = (month: string | undefined) => {
    const m = new Map<string, number>()
    if (!month) return m
    for (const t of transactions) {
      if (t.type !== 'expense' || t.fixedType === 'fixed') continue
      if (t.date.slice(0, 7) !== month) continue
      const c = t.category || '미분류'
      m.set(c, (m.get(c) || 0) + (t.amount - t.split))
    }
    return m
  }
  const cur = sum(curMonth)
  const prev = sum(prevMonth)
  const names = new Set([...cur.keys(), ...prev.keys()])
  return [...names]
    .map((name) => {
      const c = cur.get(name) || 0
      const p = prev.get(name) || 0
      return { name, cur: c, prev: p, delta: c - p, rate: changeRate(c, p) }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}
