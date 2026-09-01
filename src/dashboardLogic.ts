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

export type SplitBreakdown = { total: number; refund: number; settle: number; byPerson: NV[] }
type SplitTxLike = { date: string; type: string; amount: number; split: number; memo: string }

// 분담금 메모에서 상대를 추정하는 기본 사전. 메모에 '환급'이 있으면 자동 환급으로 보고 정산 대상에서 뺀다.
// ponytail: 별도 컬럼(상대/태그) 없이 기존 메모만으로 구분한다. 구분이 자주 틀리면 그때 필드를 추가.
const SPLIT_PEOPLE: Record<string, string[]> = { 여친: ['브리', '여친', '여자친구'], 형: ['형'] }
const REFUND_WORDS = ['환급', '리워드']

/** 해당 월 분담금을 '정산해서 받을 돈'과 '자동 환급'으로 나누고, 정산분을 상대별로 합산. */
export function splitBreakdown(
  transactions: SplitTxLike[],
  yearMonth: string,
  people: Record<string, string[]> = SPLIT_PEOPLE,
): SplitBreakdown {
  let total = 0, refund = 0
  const byPerson = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.split) continue
    if (t.date.slice(0, 7) !== yearMonth) continue
    const memo = t.memo || ''
    total += t.split
    if (REFUND_WORDS.some((w) => memo.includes(w))) { refund += t.split; continue }
    const who = Object.keys(people).find((name) => people[name].some((w) => memo.includes(w))) || '기타'
    byPerson.set(who, (byPerson.get(who) || 0) + t.split)
  }
  return {
    total,
    refund,
    settle: total - refund,
    byPerson: [...byPerson.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
  }
}

export type CardRow = { date: string; memo: string; amount: number }
// 카드앱 화면에서 복사한 텍스트에서 무시할 줄(시간·카드번호·할부구분 등)
const CARD_NOISE = /^(\d{1,2}:\d{2}|본인\s*\d+|가족\s*\d+|일시불|\d+개월|메모쓰기|카드\s*이용내역|이용안내|.*카드\s*\d{4}$)/

/**
 * 카드 이용내역 텍스트를 거래 목록으로 파싱한다.
 * 날짜 줄(2026.08.16 / 26. 8. 12 / 2026-08-16)을 만나면 이후 줄들의 기준 날짜가 된다.
 * 금액(1,234 원)이 있는 줄에서 금액을 빼고 남은 글자가 가맹점명, 비면 바로 윗줄을 쓴다.
 * ponytail: OCR은 iOS 텍스트 인식(Live Text)에 맡기고 여기선 텍스트만 다룬다.
 */
export function parseCardStatement(text: string, fallbackDate = ''): CardRow[] {
  const out: CardRow[] = []
  let cur = fallbackDate
  let prev = ''
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const d = line.match(/(20\d{2})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})|^(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?$/)
    if (d) {
      const [y, m, dd] = d[1] ? [d[1], d[2], d[3]] : [`20${d[4]}`, d[5], d[6]]
      cur = `${y}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
      continue
    }
    if (CARD_NOISE.test(line)) continue
    const a = line.match(/([\d,]{2,})\s*원/)
    if (!a) { prev = line; continue }
    const amount = Number(a[1].replace(/,/g, ''))
    if (!amount) continue
    const memo = (line.slice(0, a.index).trim() || prev).replace(/\s{2,}/g, ' ').trim()
    if (memo) out.push({ date: cur, memo, amount })
    prev = ''
  }
  return out
}

export type CardPerf = { name: string; charged: number; excluded: number; qualified: number }

/**
 * 카드별 '실적 제외' 키워드 — 카드사 공식 상품안내서 원문 기준(추측 금지).
 *
 * 하나카드 MG+ S (상품안내서 2025-06-16, qpay.hanacard.co.kr/leaflet/15/15417_20250616.pdf):
 *   [실적 제외] 국세, 지방세, 수도/전기요금, 그 외 공과금(우편요금·과태료·범칙금·벌금·부담금),
 *   도시가스 요금, 아파트관리비, 국민연금/고용보험료/산재보험료/건강보험료, 스쿨뱅킹,
 *   초·중·고 학교납입금, 대학(원)등록금, 상품권·기프트카드, 선불카드·선불전자지급수단 충전, 부동산임대료
 *   [실적 산정] "국내외 일시불/할부 이용금액" → 할부는 실적에 **포함**된다(민간 보험료도 포함).
 *   2026-08 실측 대조: 원장 2,182,456 − 위 제외분 = 약 166만 vs 카드사 1,668,076 (오차 0.4%)
 */
export const CARD_EXCLUDED: Record<string, string[]> = {
  // NH농협 올바른 FLEX (전월실적 단일 기준 30만원):
  //   [실적 제외] 할인 적용된 이용금액(전체), 대학(대학원)등록금, 교육비, 임대료, 각종 세금 및 공과금,
  //   상하수도요금, 과태료(범칙금), 우편요금, 사회보험(건강/국민연금/고용/산재), 아파트관리비,
  //   도시가스요금, 전기요금, 상품권·선불카드 구매(충전 포함), 현금서비스·카드론, 수수료·이자·연체료,
  //   연회비, 거래취소금액, 포인트 결제분
  //   ※ '할인 적용된 이용금액 전체'가 빠지는 게 하나카드와 다른 점 — 혜택 받은 건은 실적에 안 잡힌다.
  NH카드: [
    '대학등록금', '대학원등록금', '교육비', '임대료', '월세',
    '세금', '국세', '지방세', '주민세', '자동차세', '공과금',
    '상하수도', '수도요금', '과태료', '범칙금', '우편요금',
    '건강보험', '국민연금', '고용보험', '산재보험',
    '관리비', '도시가스', '전기요금',
    '상품권', '기프트카드', '선불', '카드충전', '현금서비스', '카드론', '수수료', '연체료', '연회비',
  ],
  하나카드: [
    '국세', '지방세', '주민세', '자동차세', '과태료', '범칙금', '벌금',
    '수도요금', '전기요금', '도시가스', '관리비',
    '국민연금', '고용보험', '산재보험', '건강보험',
    '스쿨뱅킹', '학교납입금', '대학등록금', '대학원등록금',
    '상품권', '기프트카드', '카드충전', '하나머니', '부동산임대료', '월세',
  ],
}
const isExcluded = (memo: string, card: string) =>
  (CARD_EXCLUDED[card] ?? []).some((k) => (memo || '').includes(k))

/**
 * 해당 월 카드별 결제액과 '실적 인정 추정액'을 낸다.
 * 실적은 분담금과 무관하게 **결제액 전액** 기준(카드사는 내가 얼마 냈는지 모름).
 */
export function cardPerformance(transactions: SplitTxLike[] & { payment?: string }[], yearMonth: string): CardPerf[] {
  const map = new Map<string, CardPerf>()
  for (const t of transactions as (SplitTxLike & { payment?: string })[]) {
    if (t.type !== 'expense') continue
    if (t.date.slice(0, 7) !== yearMonth) continue
    const name = (t.payment || '').trim()
    if (!name || name === '현금' || name === '계좌이체' || name === '미상') continue
    const cur = map.get(name) ?? { name, charged: 0, excluded: 0, qualified: 0 }
    cur.charged += t.amount
    if (isExcluded(t.memo, name)) cur.excluded += t.amount
    else cur.qualified += t.amount
    map.set(name, cur)
  }
  return [...map.values()].sort((a, b) => b.charged - a.charged)
}

export type Tier = { min: number; cap: number }

/** 실적 구간표에서 현재 할인한도와, 다음 구간까지 부족액을 낸다. */
export function tierStatus(qualified: number, tiers: Tier[]):
  { cap: number; next?: { min: number; cap: number; gap: number } } {
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  let cap = 0
  for (const t of sorted) if (qualified >= t.min) cap = t.cap
  const next = sorted.find((t) => qualified < t.min)
  return next ? { cap, next: { min: next.min, cap: next.cap, gap: next.min - qualified } } : { cap }
}

/** 날짜를 씨앗으로 응원 문구를 하나 고른다. 같은 날은 항상 같은 문구, 날이 바뀌면 다음 문구. */
export function dailyCheer(isoDate: string, pool: string[]): string {
  if (!pool.length) return ''
  const n = Number(isoDate.replace(/\D/g, '')) || 0
  return pool[n % pool.length]
}
