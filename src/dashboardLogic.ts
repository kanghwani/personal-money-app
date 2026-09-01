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
    '세금', '세외수입', '국세', '지방세', '주민세', '자동차세', '공과금',
    '상하수도', '수도요금', '과태료', '범칙금', '우편요금',
    '건강보험', '국민연금', '고용보험', '산재보험',
    '관리비', '도시가스', '전기요금',
    '상품권', '기프트카드', '기프티콘', '선불', '카드충전', '현금서비스', '카드론', '수수료', '연체료', '연회비',
  ],
  // KB국민 American Express Rose Gold — 아파트관리비가 실적 제외라, 관리비를 이 카드로 내면 실적도 혜택도 0이다.
  국민카드: [
    '관리비', '학교납입금', '대학등록금', '대학원등록금', '정부지원금',
    '국세', '지방세', '주민세', '자동차세', '공과금', '전기요금', '수도요금', '도시가스',
    '건강보험', '국민연금', '고용보험', '산재보험',
    '상품권', '기프트카드', '기프티콘', '선불', '카드충전', '현금서비스', '카드론',
    '수수료', '연체료', '연회비',
  ],
  하나카드: [
    '국세', '지방세', '주민세', '자동차세', '과태료', '범칙금', '벌금', '우편요금',
    '수도요금', '전기요금', '도시가스', '관리비',
    '국민연금', '고용보험', '산재보험', '건강보험',
    '스쿨뱅킹', '학교납입금', '대학등록금', '대학원등록금',
    '상품권', '기프트카드', '기프티콘', '카드충전', '하나머니', '부동산임대료', '월세', '지자체세입금',
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

// ─────────────────────────────────────────────────────────────
// 카드별 혜택 규칙 — 전부 카드사 공식 상품안내서/약관 원문 기준. 추측으로 채우지 말 것.
// 새 카드를 넣거나 혜택이 바뀌면 여기만 고치면 앱 전체(가이드·놓친혜택)가 따라온다.
// ─────────────────────────────────────────────────────────────

export type BenefitArea = {
  area: string
  rate: number            // 0.5 = 50% 청구할인
  cap: number             // 이 영역의 월 할인한도. 0이면 카드의 실적 구간 한도를 쓴다.
  keywords: string[]
  minAmount?: number      // 건당 최소 결제액
  note?: string           // 놓치기 쉬운 조건(정기결제만, 간편결제 불가 등)
}

export type CardSpec = {
  card: string
  owned: boolean          // false면 '후보 카드' — 놓친 혜택 계산에서 빼고 비교용으로만 쓴다
  annualFee: number
  tiers: Tier[]
  sharedCap: boolean      // true면 tiers의 cap이 전 영역 통합한도(하나카드), false면 영역별
  benefits: BenefitArea[]
  notes: string[]         // 할인이 아니라 규칙으로만 존재하는 것(마일리지·결제수단 조건 등)
}

export const CARD_SPECS: CardSpec[] = [
  {
    // 하나카드 MG+ S — 상품안내서 2025-06-16 (qpay.hanacard.co.kr/leaflet/15/15417_20250616.pdf)
    card: '하나카드', owned: true, annualFee: 17000, sharedCap: true,
    tiers: [{ min: 300000, cap: 15000 }, { min: 600000, cap: 30000 }, { min: 1000000, cap: 60000 }],
    benefits: [
      { area: '영상 스트리밍', rate: 0.5, cap: 0, keywords: ['유튜브', '디즈니', 'Wavve', '웨이브', '넷플릭스', '티빙'],
        note: '월 정기결제 건만. 간편결제·인앱결제로 내면 할인 없음 — 카드를 직접 등록해야 한다.' },
      { area: '디지털 멤버십', rate: 0.5, cap: 0, keywords: ['네이버플러스', '컬리멤버', '쿠팡 와우', '쿠팡와우'],
        note: '월 정기결제 건만. 연 정기결제는 1회만 제공.' },
    ],
    notes: [
      '간편결제 10%(네이버페이·카카오페이·토스페이·SSG페이·11pay·스마일페이, 건당 1만원↑) — 결제수단이라 내역만으로는 판별이 안 돼 놓친혜택 계산에서 뺐다.',
      '할인 대상이 겹치면 할인액이 큰 것 하나만 적용된다(매출 건당 1개).',
      '무이자·부분무이자 할부는 할인 대상에서 전액 제외(단, 실적에는 포함).',
    ],
  },
  {
    // NH농협 올바른 FLEX — 전월실적 30만원 단일 구간
    card: 'NH카드', owned: true, annualFee: 10000, sharedCap: false,
    tiers: [{ min: 300000, cap: 0 }],
    benefits: [
      { area: '커피', rate: 0.5, cap: 10000, keywords: ['스타벅스'], note: '일 1회·월 2회.' },
      { area: '영화', rate: 0.3, cap: 5000, minAmount: 10000, keywords: ['CGV', '롯데시네마'], note: '월 1회.' },
      { area: '스트리밍', rate: 0.2, cap: 5000, minAmount: 7000, keywords: ['유튜브', '넷플릭스', '멜론'], note: '가맹점별 월 1회.' },
      { area: '배달앱', rate: 0.1, cap: 5000, minAmount: 15000, keywords: ['배달의민족', '배민', '요기요'], note: '일 1회.' },
      { area: '대중교통', rate: 0.07, cap: 5000, keywords: ['지하철', '버스', '티머니', '교통카드'], note: '시외·고속버스 제외. 월 1회.' },
      { area: '통신', rate: 0.07, cap: 5000, keywords: ['SKT', 'KT', 'LG U+', 'LGU+', '통신요금'], note: '통신3사 자동납부만. 월 1회.' },
      { area: '온라인쇼핑', rate: 0.05, cap: 5000, minAmount: 50000, keywords: ['쿠팡', 'G마켓', '지마켓', '11번가', '농협몰'], note: '통합 일 1회.' },
      { area: '편의점', rate: 0.05, cap: 5000, minAmount: 5000, keywords: ['CU', 'GS25'], note: '통합 일 1회.' },
    ],
    notes: ['할인받은 이용금액은 **전체가** 다음 달 실적에서 빠진다 — 혜택을 챙길수록 실적 기준선이 올라간다.'],
  },
  {
    // KB국민 American Express Rose Gold — 전 영역 KB Pay 결제 건만 할인
    card: '국민카드', owned: true, annualFee: 19000, sharedCap: false,
    tiers: [{ min: 300000, cap: 10000 }, { min: 700000, cap: 15000 }, { min: 1200000, cap: 20000 }],
    benefits: [
      { area: '온라인쇼핑', rate: 0.1, cap: 0, keywords: ['쿠팡', 'G마켓', '지마켓', '11번가', '옥션', '오픈마켓', '온라인쇼핑'],
        note: 'KB Pay로 결제해야 한다. 한도가 실적 구간에 따라 1만/1.5만/2만으로 오르는 유일한 영역.' },
      { area: '커피/편의점', rate: 0.1, cap: 5000, keywords: ['스타벅스', '커피', '메가', '이디야', 'CU', 'GS25', '이마트24', '세븐일레븐'], note: 'KB Pay 결제 건만.' },
      { area: '오프라인쇼핑', rate: 0.05, cap: 5000, keywords: ['이마트', '롯데마트', '홈플러스', '백화점', '코스트코'], note: 'KB Pay 결제 건만.' },
      { area: '항공/면세', rate: 0.05, cap: 2000, keywords: ['대한항공', '아시아나', '면세점'], note: 'KB Pay 결제 건만. 연 60,000원 한도.' },
    ],
    notes: [
      'KB Pay 외 다른 결제수단으로 긁으면 할인이 아예 없다.',
      '가족카드 연회비는 없고 실적·한도는 본인카드와 합산된다.',
      '실적 제외: 할인받은 건 전체, 아파트관리비, 세금·공과금, 4대보험, 상품권·선불충전, 등록금, 무승인전표(자판기·터널), 취소금액.',
    ],
  },
  {
    // 삼성카드 & MILEAGE PLATINUM (스카이패스) — 전월실적 조건 없음
    card: '삼성카드', owned: true, annualFee: 47000, sharedCap: false,
    tiers: [], benefits: [],
    notes: [
      '전월실적 조건이 없다. 1,000원당 스카이패스 1마일이 한도 없이 쌓인다.',
      '국내형/해외형을 월 1회 바꿀 수 있고, 고른 쪽에서 1,000원당 1마일이 더 붙는다(월 2,000마일 = 사용액 100만원까지).',
      '국내형 대상: 백화점·주유소·커피전문점·편의점·택시. 해외형은 해외 가맹점 전체(USD 결제 포함).',
      'Claude·ChatGPT처럼 USD로 빠지는 구독은 해외형일 때만 2마일이 된다 — 국내형으로 두면 1마일이다.',
      '할인 카드가 아니라 적립 카드다 — 다른 카드의 할인 영역과 겹치면 할인 쪽이 대개 이득이 크다.',
    ],
  },
  {
    // 우리 카드의정석2 ROUTINE — 미보유(후보). 정기결제 전용 할인카드.
    card: '우리카드(ROUTINE)', owned: false, annualFee: 28000, sharedCap: false,
    tiers: [{ min: 500000, cap: 5000 }, { min: 1000000, cap: 10000 }],
    benefits: [
      { area: '생활', rate: 0.15, cap: 0, keywords: ['관리비', '전기요금', '도시가스'], note: '자동납부 건만.' },
      { area: '통신', rate: 0.15, cap: 0, keywords: ['SKT', 'KT', 'LG U+', 'LGU+', '우리WON모바일', 'KT M모바일', 'U+유모바일', 'SK세븐모바일'],
        note: '휴대전화 요금 자동납부만. 인터넷·집전화 등 결합상품은 제외. 통합 월 1회.' },
      { area: '렌탈', rate: 0.15, cap: 0, keywords: ['코웨이', 'SK매직', '인텔릭스', '가전구독'], note: '매월 청구되는 렌탈 자동납부만.' },
      { area: '교육/도서', rate: 0.15, cap: 0, keywords: ['결제선생', '학습지', '밀리의서재', '교보문고', 'YES24', '크레마'], note: '도서는 인앱결제 시 할인 불가.' },
      { area: '디지털구독', rate: 0.3, cap: 0, keywords: ['유튜브', '넷플릭스', '디즈니', '티빙', 'ChatGPT'],
        note: '공식 홈페이지·앱에 카드를 직접 등록한 정기결제만. 간편결제·인앱결제 불가. ChatGPT는 해외 USD 결제 건만.' },
      { area: '멤버십', rate: 0.3, cap: 0, keywords: ['쿠팡 와우', '쿠팡와우', '네이버플러스', '배민클럽', '컬리멤버', 'T우주패스'],
        note: '공식 홈페이지·앱에 카드를 직접 등록한 정기결제만. 간편결제·인앱결제 불가.' },
    ],
    notes: [
      '아파트관리비가 실적으로 인정되는 드문 카드 — 관리비만으로 실적의 상당 부분이 채워진다.',
      '[미확인] 전기·가스요금도 실적에 잡히는지는 공개 자료로 확인 못 했다. 카드의정석2 시리즈 공통 기준은 공과금 실적 제외라, 관리비만 예외일 가능성이 있다. 발급 전 콜센터 확인 필요.',
      '생활 영역은 관리비·전기·가스가 한 한도를 나눠 쓴다 — 관리비 28만이면 15%가 이미 한도를 넘어 전기세를 더해도 할인은 안 늘어난다(실적에는 도움).',
      '디지털구독 대상에 Claude(Anthropic)는 없다. ChatGPT는 해외 USD 결제 건만 인정된다.',
    ],
  },
]

export type BenefitHit = {
  date: string; memo: string; amount: number
  usedCard: string; bestCard: string; area: string; rate: number; discount: number
}

/** 결제 한 건이 이 카드의 어느 혜택 영역에 걸리는지. 안 걸리면 null. */
function matchArea(memo: string, amount: number, spec: CardSpec): BenefitArea | null {
  let best: BenefitArea | null = null
  for (const b of spec.benefits) {
    if (b.minAmount && amount < b.minAmount) continue
    if (!b.keywords.some((k) => memo.includes(k))) continue
    // 한 건에 여러 영역이 걸리면 할인율이 큰 쪽만 적용된다(카드사 공통 규칙).
    if (!best || b.rate > best.rate) best = b
  }
  return best
}

/**
 * 이번 달 결제 건마다 '가장 할인이 큰 카드'를 찾아, 실제 쓴 카드와 다르면 놓친 혜택으로 낸다.
 * 영역별 월 한도는 날짜 순서대로 소진시킨다(카드사도 이용 순서대로 한도를 깎는다).
 * candidates에 미보유 카드를 넣으면 "그 카드가 있었다면" 비교가 된다.
 */
export function missedBenefits(
  transactions: (SplitTxLike & { payment?: string })[],
  yearMonth: string,
  specs: CardSpec[] = CARD_SPECS.filter((s) => s.owned),
  assumeQualified = false,   // true면 모든 카드가 최고 구간을 채운 셈 치고 '받을 수 있었던 최대'를 낸다
): BenefitHit[] {
  // 할인한도는 '전월' 실적으로 정해진다(약관 공통). 이번 달 실적을 쓰면 월초엔 늘 0이 된다.
  const [y, m] = yearMonth.split('-').map(Number)
  const prevMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
  const perf = new Map(cardPerformance(transactions, prevMonth).map((c) => [c.name, c.qualified]))
  const capOf = (spec: CardSpec, b: BenefitArea) => {
    // 미보유 후보 카드는 이력이 없다. "그 카드가 있고 실적을 채웠다면"을 보려는 것이라 최고 구간으로 본다.
    if (!spec.owned || assumeQualified) return b.cap > 0 ? b.cap : Math.max(0, ...spec.tiers.map((t) => t.cap))
    if (!spec.tiers.length) return 0
    // 최소 실적 구간에 못 미치면 그 카드는 이번 달 어떤 혜택도 못 받는다 — 영역별 한도가 있어도 마찬가지.
    const qualified = perf.get(spec.card) ?? 0
    if (qualified < Math.min(...spec.tiers.map((t) => t.min))) return 0
    return b.cap > 0 ? b.cap : tierStatus(qualified, spec.tiers).cap
  }
  const left = new Map<string, number>()   // `${card}/${area}` → 남은 한도
  const rows = transactions
    .filter((t) => t.type === 'expense' && t.date.slice(0, 7) === yearMonth)
    .sort((a, b) => a.date.localeCompare(b.date))
  const out: BenefitHit[] = []
  for (const t of rows) {
    const used = (t.payment || '').trim()
    let best: { spec: CardSpec; b: BenefitArea; discount: number } | null = null
    for (const spec of specs) {
      const b = matchArea(t.memo || '', t.amount, spec)
      if (!b) continue
      const key = `${spec.card}/${b.area}`
      const cap = capOf(spec, b)
      const remain = left.has(key) ? (left.get(key) as number) : cap
      if (remain <= 0) continue
      const discount = Math.min(Math.round(t.amount * b.rate), remain)
      if (discount > 0 && (!best || discount > best.discount)) best = { spec, b, discount }
    }
    if (!best) continue
    const key = `${best.spec.card}/${best.b.area}`
    const cap = capOf(best.spec, best.b)
    left.set(key, (left.has(key) ? (left.get(key) as number) : cap) - best.discount)
    if (best.spec.card === used) continue          // 이미 제일 좋은 카드로 긁었다
    out.push({ date: t.date, memo: t.memo, amount: t.amount, usedCard: used || '미상',
      bestCard: best.spec.card, area: best.b.area, rate: best.b.rate, discount: best.discount })
  }
  return out.sort((a, b) => b.discount - a.discount)
}

/**
 * 할부는 '할부 이용 전체 금액을 할부 이용한 달의 이용금액으로 반영'된다(하나카드 상품안내서 원문).
 * 원장은 할부를 고정비의 월 납입액으로 쪼개 기록하므로, 그대로 두면 결제한 달 실적이 총액만큼 비어 보인다.
 * 결제월(= 첫 납입월의 한 달 전)에 총액이 찍힌 거래를 만들어 실적 계산에 더한다.
 */
export function installmentCharges(defs: FixedDef[]): (SplitTxLike & { payment?: string })[] {
  const out: (SplitTxLike & { payment?: string })[] = []
  for (const d of defs) {
    if (!d.installmentTotal || d.kind !== 'expense') continue
    const [y, m] = d.startMonth.split('-').map(Number)
    if (!y || !m) continue
    const paidMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
    out.push({ date: `${paidMonth}-01`, memo: d.name,
      amount: d.amount * d.installmentTotal, payment: d.payment, type: 'expense', split: 0 })
  }
  return out
}
