import { PEOPLE, REFUND_WORDS, SETTLE_SINCE, SETTLED } from '../api/_ledger'
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

export type SplitBreakdown = {
  total: number; refund: number; settle: number; byPerson: NV[]
  received: number            // 그 달 정산분 중 '받음' 표시된 금액
  open: number                // 월 무관, 아직 안 받은 정산분 합
  openBy: (NV & { count: number })[]
}
export type SplitTxLike = { date: string; type: string; amount: number; split: number; memo: string }

// 상대·환급·받음 규칙은 api/_ledger.ts 가 원본이다(앱과 MCP 가 같은 답을 내야 한다).
// ponytail: 별도 컬럼(상대/정산일) 없이 메모만으로 구분한다. 구분이 자주 틀리면 그때 필드를 추가.
const SPLIT_PEOPLE = PEOPLE

/** 해당 월 분담금을 '정산해서 받을 돈'과 '자동 환급'으로 나누고, 정산분을 상대별로 합산. 전체 거래를 넘기면 월 무관 미수(open)도 낸다. */
export function splitBreakdown(
  transactions: SplitTxLike[],
  yearMonth: string,
  people: Record<string, string[]> = SPLIT_PEOPLE,
): SplitBreakdown {
  let total = 0, refund = 0, received = 0, open = 0
  const byPerson = new Map<string, number>()
  const openBy = new Map<string, { value: number; count: number }>()
  const whoOfMemo = (memo: string) => Object.keys(people).find((name) => people[name].some((w) => memo.includes(w))) || '기타'
  for (const t of transactions) {
    if (t.type !== 'expense' || !t.split) continue
    const memo = t.memo || ''
    const isRef = REFUND_WORDS.some((w) => memo.includes(w))
    const settled = t.date < SETTLE_SINCE || memo.includes(SETTLED)
    if (!isRef && !settled) {
      open += t.split
      const o = openBy.get(whoOfMemo(memo)) || { value: 0, count: 0 }
      openBy.set(whoOfMemo(memo), { value: o.value + t.split, count: o.count + 1 })
    }
    if (t.date.slice(0, 7) !== yearMonth) continue
    total += t.split
    if (isRef) { refund += t.split; continue }
    if (settled) received += t.split
    const who = whoOfMemo(memo)
    byPerson.set(who, (byPerson.get(who) || 0) + t.split)
  }
  return {
    total, refund, received, open,
    settle: total - refund,
    byPerson: [...byPerson.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    openBy: [...openBy.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.value - a.value),
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
 * 카드 실적에 넣을 결제수단인지.
 *
 * 예전에는 "현금·계좌·페이가 아니면 전부 카드"였다. 제외 목록 방식이라
 * 원장에 새 표기가 하나 들어올 때마다 유령 카드가 생겼다.
 * 실제로 '온라인결제'·'알리'·'온누리상품권'·'토스'·'카드/이체' 가 각각 카드 한 장으로
 * 세어지고 있었다. 실적 화면에 없는 카드가 뜨고, 합계도 그만큼 갈라진다.
 *
 * 이제 카드처럼 보이는 것만 카드로 본다. 모르는 표기는 카드가 아니다.
 * 새 카드를 쓰기 시작하면 이름을 '○○카드' 로 적거나 KNOWN_CARDS 에 넣으면 된다.
 */
const KNOWN_CARDS = ['토스체크', '아멕스']
export const isCardPayment = (name: string) => {
  const n = (name || '').trim()
  if (n === '카드/현금') return false     // 어느 쪽인지 모르는 기록
  if (n === '이음카드') return false       // 지역화폐(선불). 충전·결제 모두 신용카드 실적과 무관
  return n.endsWith('카드') || KNOWN_CARDS.includes(n)
}

/**
 * 카드별 '실적 제외' 키워드 - 카드사 공식 상품안내서 원문 기준(추측 금지).
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
  //   ※ '할인 적용된 이용금액 전체'가 빠지는 게 하나카드와 다른 점 - 혜택 받은 건은 실적에 안 잡힌다.
  NH카드: [
    '대학등록금', '대학원등록금', '교육비', '임대료', '월세',
    '세금', '세외수입', '국세', '지방세', '주민세', '자동차세', '공과금',
    '상하수도', '수도요금', '과태료', '범칙금', '우편요금',
    '건강보험', '국민연금', '고용보험', '산재보험',
    '관리비', '도시가스', '전기요금',
    '상품권', '기프트카드', '기프티콘', '선불', '카드충전', '현금서비스', '카드론', '수수료', '연체료', '연회비',
  ],
  // KB국민 American Express Rose Gold - 아파트관리비가 실적 제외라, 관리비를 이 카드로 내면 실적도 혜택도 0이다.
  국민카드: [
    '관리비', '학교납입금', '대학등록금', '대학원등록금', '정부지원금',
    '국세', '지방세', '주민세', '자동차세', '공과금', '전기요금', '수도요금', '도시가스',
    '건강보험', '국민연금', '고용보험', '산재보험',
    '상품권', '기프트카드', '기프티콘', '선불', '카드충전', '현금서비스', '카드론',
    '수수료', '연체료', '연회비',
  ],
  // 삼성카드 & MILEAGE PLATINUM - 실적 조건은 없지만 '마일 적립 제외'가 넓다.
  // 국세·지방세·공과금, 4대보험, 대학등록금, 대중교통·택시·고속버스·통행료,
  // 무이자할부, 할인 적용된 이용금액, 선불충전 등이 전부 0마일이다.
  삼성카드: [
    '국세', '지방세', '주민세', '자동차세', '종합소득세', '공과금', '전기요금', '수도요금', '도시가스', '관리비',
    '건강보험', '국민연금', '고용보험', '산재보험',
    '대학등록금', '대학원등록금',
    '지하철', '버스', '택시', '티머니', '교통카드', '통행료', '하이패스',
    '상품권', '기프트카드', '기프티콘', '선불', '카드충전',
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
    if (!name || !isCardPayment(name)) continue
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
// 카드별 혜택 규칙 - 전부 카드사 공식 상품안내서/약관 원문 기준. 추측으로 채우지 말 것.
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
  owned: boolean          // false면 '후보 카드' - 놓친 혜택 계산에서 빼고 비교용으로만 쓴다
  annualFee: number
  tiers: Tier[]
  sharedCap: boolean      // true면 tiers의 cap이 전 영역 통합한도(하나카드), false면 영역별
  benefits: BenefitArea[]
  notes: string[]         // 할인이 아니라 규칙으로만 존재하는 것(마일리지·결제수단 조건 등)
  /** 가족카드 사용분이 실적에 합산되는 카드. 그 지출은 이 원장에 없어서 실적을 판정할 수 없다. */
  familyPooled?: boolean
}

export const CARD_SPECS: CardSpec[] = [
  {
    // 하나카드 MG+ S - 상품안내서 2025-06-16 (qpay.hanacard.co.kr/leaflet/15/15417_20250616.pdf)
    card: '하나카드', owned: true, annualFee: 17000, sharedCap: true,
    tiers: [{ min: 300000, cap: 15000 }, { min: 600000, cap: 30000 }, { min: 1000000, cap: 60000 }],
    benefits: [
      { area: '간편결제', rate: 0.1, cap: 0,
        keywords: ['네이버페이', '카카오페이', '토스페이', 'SSG페이', '11pay', '스마일페이'], minAmount: 10000,
        note: '건당 1만원 이상. 원장 메모에 간편결제명이 남은 거래만 자동 확인할 수 있다.' },
      { area: '영상 스트리밍', rate: 0.5, cap: 0, keywords: ['유튜브', '디즈니', 'Wavve', '웨이브', '넷플릭스', '티빙'],
        note: '월 정기결제 건만. 간편결제·인앱결제로 내면 할인 없음 - 카드를 직접 등록해야 한다.' },
      { area: '디지털 멤버십', rate: 0.5, cap: 0, keywords: ['네이버플러스', '컬리멤버', '쿠팡 와우', '쿠팡와우'],
        note: '월 정기결제 건만. 연 정기결제는 1회만 제공.' },
    ],
    notes: [
      '간편결제 10%는 원장 메모에 네이버페이·카카오페이·토스페이·SSG페이·11pay·스마일페이가 남은 거래만 자동 계산한다.',
      '할인 대상이 겹치면 할인액이 큰 것 하나만 적용된다(매출 건당 1개).',
      '무이자·부분무이자 할부는 할인 대상에서 전액 제외(단, 실적에는 포함).',
    ],
  },
  {
    // NH농협 올바른 FLEX - 전월실적 30만원 단일 구간
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
    notes: ['할인받은 이용금액은 **전체가** 다음 달 실적에서 빠진다 - 혜택을 챙길수록 실적 기준선이 올라간다.'],
  },
  {
    // KB국민 American Express Rose Gold - 전 영역 KB Pay 결제 건만 할인
    card: '국민카드', owned: true, annualFee: 19000, sharedCap: false, familyPooled: true,
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
    // 삼성카드 & MILEAGE PLATINUM (스카이패스) - 전월실적 조건 없음
    card: '삼성카드', owned: true, annualFee: 47000, sharedCap: false,
    tiers: [], benefits: [],
    notes: [
      '전월실적 조건이 없다. 1,000원당 스카이패스 1마일이 한도 없이 쌓인다.',
      '국내형/해외형을 월 1회 바꿀 수 있고, 고른 쪽에서 1,000원당 1마일이 더 붙는다(월 2,000마일 = 사용액 100만원까지).',
      '국내형 대상: 백화점·주유소·커피전문점·편의점·택시. 해외형은 해외 가맹점 전체(USD 결제 포함).',
      'Claude·ChatGPT처럼 USD로 빠지는 구독은 해외형일 때만 2마일이 된다 - 국내형으로 두면 1마일이다.',
      '국세·지방세·공과금·4대보험·대중교통·택시·통행료·무이자할부는 마일이 아예 안 쌓인다. 2026-03 종합소득세 522만원도 0마일이었다.',
      '아멕스 PLATINUM 등급 서비스: 인천공항 마티나 라운지 본인 무료, 인천공항 발렛파킹 무료(제1·2터미널), 공항 커피, 국내 면세점 할인, 해외 렌터카·특급호텔 우대. 연 횟수 등 세부 조건은 모니모 앱 > 카드 > 부가서비스에서 확인.',
      '할인 카드가 아니라 적립 카드다 - 다른 카드의 할인 영역과 겹치면 할인 쪽이 대개 이득이 크다.',
    ],
  },
  {
    // 하나 MOVING카드 ONLINE모드 (2026-07-01 출시) - 미보유(후보).
    // 공식 상품페이지 hanacard.co.kr/OPI41000000D.web?CD_PD_SEQ=19150 원문 기준.
    card: '하나 MOVING(ONLINE)', owned: false, annualFee: 20000, sharedCap: false,
    tiers: [{ min: 500000, cap: 5000 }],
    benefits: [
      { area: 'AI 구독', rate: 0.5, cap: 10000, keywords: ['ChatGPT', 'Claude', '클로드', 'Perplexity', '퍼플렉시티', '엔트로픽'],
        note: '월 적립한도 1만 하나머니. AI만 따로 1만이라 다른 영역과 안 나눠 쓴다.' },
      { area: '디지털 구독', rate: 0.5, cap: 5000,
        keywords: ['넷플릭스', '디즈니', '유튜브', '웨이브', 'Wavve', '티빙', '멜론', '지니', 'FLO', '스포티파이', '쿠팡와우', '쿠팡 와우', '네이버플러스', '컬리멤버', '배민클럽'] },
      { area: '택시', rate: 0.5, cap: 5000, keywords: ['카카오T', 'UT', '택시'] },
      { area: '푸드', rate: 0.5, cap: 5000,
        keywords: ['맥도날드', '롯데리아', '버거킹', 'KFC', '쉐이크쉑', '써브웨이', '맘스터치', '파이브가이즈', '스타벅스'] },
    ],
    notes: [
      'ONLINE 적립 4개 영역은 전부 지난달 실적 50만원 이상이 조건. 영역별 한도가 따로라 합치면 월 25,000 하나머니까지 된다.',
      '온라인 간편결제 1.5%(3일 연속 이용 시 3.0%) 적립, 월 3만 하나머니 - 실적 조건 없음.',
      '국내외 가맹점 기본 0.5%(3일 연속 1.0%) - 실적 조건 없음.',
      '트래블로그 스위치 가입 시 해외이용수수료 면제 - Claude·ChatGPT의 USD 결제 수수료(약 1.2%)가 사라진다.',
      '5만원 이상 결제 시 2~3개월 무이자할부(실적 조건 없음).',
    ],
  },
  {
    // 우리 카드의정석2 ROUTINE - 미보유(후보). 정기결제 전용 할인카드.
    card: '우리카드(ROUTINE)', owned: false, annualFee: 22000, sharedCap: false,
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
      { area: '해외', rate: 0.015, cap: 10000, keywords: ['해외', 'USD', 'Claude', 'ChatGPT'], note: '해외 온/오프라인 1.5% 할인, 반기별 각 6만원 한도.' },
    ],
    notes: [
      '아파트관리비가 실적으로 인정되는 드문 카드 - 관리비만으로 실적의 상당 부분이 채워진다.',
      '연회비는 모바일카드 22,000원 / 실물카드 28,000원. 굳이 실물이 필요 없으면 모바일이 6,000원 싸다.',
      '실적 기준은 "전월 국내외 가맹점 이용금액" - 해외 결제도 실적에 들어간다(ChatGPT USD 결제 포함).',
      '전기·가스요금은 15% 할인은 되지만 전월실적에서는 제외된다(카드고릴라 2026-08-25 확인). 실적으로 인정되는 건 아파트관리비뿐이다.',
      '정기결제 통합 월 한도: 전월실적 50만 → 30,000원 / 100만 → 60,000원.',
      '생활 영역은 관리비·전기·가스가 한 한도를 나눠 쓴다 - 관리비 28만이면 15%가 이미 한도를 넘어 전기세를 더해도 할인은 안 늘어난다(실적에는 도움).',
      '디지털구독 대상에 Claude(Anthropic)는 없다. ChatGPT는 해외 USD 결제 건만 인정된다.',
    ],
  },
]

export type BenefitHit = {
  date: string; memo: string; amount: number
  usedCard: string; bestCard: string; area: string; rate: number; discount: number
}

/** 혜택 한도를 결정하는 전월(YYYY-MM). 1월이면 전년 12월로 넘긴다. */
export function previousMonthKey(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number)
  return `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
}

/** 결제 한 건이 이 카드의 어느 혜택 영역에 걸리는지. 안 걸리면 null. */
function matchArea(memo: string, amount: number, spec: CardSpec): BenefitArea | null {
  // 상품권·선불카드 충전처럼 실적/할인 공통 제외인 거래는 가맹점명이 혜택 키워드와 같아도 제외한다.
  if (isExcluded(memo, spec.card)) return null
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
  const prevMonth = previousMonthKey(yearMonth)
  const perf = new Map(cardPerformance(transactions, prevMonth).map((c) => [c.name, c.qualified]))
  const capOf = (spec: CardSpec, b: BenefitArea) => {
    // 미보유 후보 카드는 이력이 없다. "그 카드가 있고 실적을 채웠다면"을 보려는 것이라 최고 구간으로 본다.
    if (!spec.owned || assumeQualified) return b.cap > 0 ? b.cap : Math.max(0, ...spec.tiers.map((t) => t.cap))
    if (!spec.tiers.length) return 0
    // 최소 실적 구간에 못 미치면 그 카드는 이번 달 어떤 혜택도 못 받는다 - 영역별 한도가 있어도 마찬가지.
    const qualified = perf.get(spec.card) ?? 0
    if (qualified < Math.min(...spec.tiers.map((t) => t.min))) return 0
    return b.cap > 0 ? b.cap : tierStatus(qualified, spec.tiers).cap
  }
  const left = new Map<string, number>()   // `${card}/${area}` → 남은 한도
  const benefitKey = (spec: CardSpec, b: BenefitArea) => spec.sharedCap ? spec.card : `${spec.card}/${b.area}`
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
      const key = benefitKey(spec, b)
      const cap = capOf(spec, b)
      const remain = left.has(key) ? (left.get(key) as number) : cap
      if (remain <= 0) continue
      const discount = Math.min(Math.round(t.amount * b.rate), remain)
      if (discount > 0 && (!best || discount > best.discount)) best = { spec, b, discount }
    }
    if (!best) continue
    const key = benefitKey(best.spec, best.b)
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
  const seen = new Set<string>()
  for (const d of defs) {
    if (!d.installmentTotal || d.kind !== 'expense') continue
    // 수정하면서 이전 정의를 비활성화하고 새 정의를 저장한 경우가 있다.
    // 둘 다 과거 결제 기록으로는 필요하지만 같은 할부를 두 번 더하면 안 된다.
    // 이름만 고쳐 저장한 사본도 같은 결제다. 금액·카드·시작월·회차가 같으면 한 건으로 본다.
    const key = [d.amount, d.payment.trim(), d.startMonth, d.installmentTotal].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const [y, m] = d.startMonth.split('-').map(Number)
    if (!y || !m) continue
    const paidMonth = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
    out.push({ date: `${paidMonth}-01`, memo: d.name,
      amount: d.amount * d.installmentTotal, payment: d.payment, type: 'expense', split: 0 })
  }
  return out
}

/**
 * 카드 실적용 행: 원장 + 할부 총액. 총액을 결제한 달에 넣었으면 매달 자동입력되는
 * 회차 행("스위치2 할부 (1/5)")은 빼야 한다 - 안 빼면 같은 할부가 실적에 두 번 잡힌다.
 */
export function withInstallmentCharges<T extends { memo?: string; payment?: string }>(transactions: T[], defs: FixedDef[]) {
  const inst = installmentCharges(defs)
  const injected = defs.filter((d) => d.installmentTotal && d.kind === 'expense')
  const isMonthly = (t: T) => injected.some((d) => (t.memo || '').startsWith(d.name) && (t.payment || '').trim() === d.payment.trim())
  return [...transactions.filter((t) => !isMonthly(t)), ...inst]
}

export type BenefitUse = {
  date: string; memo: string; amount: number; discount: number; area: string
}

export type UnusedBenefit = {
  card: string; area: string; rate: number
  cap: number; used: number; remaining: number
  minAmount?: number; keywords: string[]; note?: string
  uses: BenefitUse[]
  locked: boolean          // 전월 실적 미달이라 이번 달엔 아예 못 받는 상태
  lockGap: number          // locked일 때 이번 달에 얼마를 더 써야 다음 달이 열리는지
}

/**
 * 이번 달 카드 혜택의 사용·잔여 한도를 모두 낸다. 한도를 전부 쓴 영역도 포함한다.
 * 한도는 그 카드로 실제 결제한 건만 소진한 것으로 본다(카드사와 같은 계산).
 */
export function benefitBalances(
  transactions: (SplitTxLike & { payment?: string })[],
  yearMonth: string,
  specs: CardSpec[] = CARD_SPECS.filter((s) => s.owned),
  // 지난달 실적은 달이 끝난 순간 확정된다. 원장을 못 읽었을 때 0으로 보고 '잠김'이라 단정하는 대신
  // 마지막으로 계산해둔 값을 쓴다. 원장에 그 달 거래가 있으면 언제나 원장이 이긴다.
  knownPrevPerf?: Map<string, number>,
): UnusedBenefit[] {
  const prevMonth = previousMonthKey(yearMonth)
  const live = new Map(cardPerformance(transactions, prevMonth).map((c) => [c.name, c.qualified]))
  const prevPerf = new Map(knownPrevPerf ?? [])
  for (const [k, v] of live) prevPerf.set(k, v)
  const thisPerf = new Map(cardPerformance(transactions, yearMonth).map((c) => [c.name, c.qualified]))
  const rows = transactions.filter((t) => t.type === 'expense' && t.date.slice(0, 7) === yearMonth)

  const out: UnusedBenefit[] = []
  for (const spec of specs) {
    const minTier = spec.tiers.length ? Math.min(...spec.tiers.map((t) => t.min)) : 0
    const prevQ = prevPerf.get(spec.card) ?? 0
    const locked = Boolean(spec.tiers.length && prevQ < minTier)
    // 잠겼으면 '이번 달' 실적으로 다음 달을 여는 게 목표라 이번 달 부족액을 낸다.
    const lockGap = locked ? Math.max(0, minTier - (thisPerf.get(spec.card) ?? 0)) : 0
    // 가족카드 합산 카드는 원장에 없는 지출로 실적이 채워진다 - 잠김으로 단정하면 틀린 안내가 된다.
    const unknown = Boolean(spec.familyPooled)
    const tierCap = spec.tiers.length
      ? (unknown || locked
          ? Math.min(...spec.tiers.map((t) => t.cap))
          : tierStatus(prevQ, spec.tiers).cap)
      : 0
    const isLocked = locked && !unknown
    const usageOf = (b: BenefitArea, cap: number) => {
      if (isLocked) return { used: 0, uses: [] as BenefitUse[] }
      let used = 0
      const uses: BenefitUse[] = []
      for (const t of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
        if ((t.payment || '').trim() !== spec.card) continue
        if (isExcluded(t.memo || '', spec.card)) continue
        if (b.minAmount && t.amount < b.minAmount) continue
        if (!b.keywords.some((k) => (t.memo || '').includes(k))) continue
        const discount = Math.min(Math.round(t.amount * b.rate), cap - used)
        if (discount <= 0) continue
        uses.push({ date: t.date, memo: t.memo || '', amount: t.amount, discount, area: b.area })
        used += discount
      }
      return { used, uses }
    }
    if (spec.sharedCap) {
      // 통합 한도 카드는 영역이 한 주머니를 나눠 쓴다. 영역별로 나눠 보여주면 한도가 몇 배로 부풀어 보인다.
      if (tierCap <= 0) continue
      let used = 0
      const uses: BenefitUse[] = []
      if (!isLocked) for (const t of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
        if ((t.payment || '').trim() !== spec.card) continue
        const b = matchArea(t.memo || '', t.amount, spec)
        if (!b) continue
        const discount = Math.min(Math.round(t.amount * b.rate), tierCap - used)
        if (discount <= 0) continue
        uses.push({ date: t.date, memo: t.memo || '', amount: t.amount, discount, area: b.area })
        used += discount
      }
      out.push({ card: spec.card, area: '통합 할인',
        rate: Math.max(...spec.benefits.map((b) => b.rate)), cap: tierCap, used, remaining: tierCap - used,
        keywords: spec.benefits.flatMap((b) => b.keywords), uses, locked: isLocked, lockGap })
      continue
    }
    for (const b of spec.benefits) {
      const cap = b.cap > 0 ? b.cap : tierCap
      if (cap <= 0) continue
      const { used, uses } = usageOf(b, cap)
      const remaining = cap - used
      out.push({ card: spec.card, area: b.area, rate: b.rate, cap, used, remaining,
        minAmount: b.minAmount, keywords: b.keywords, note: b.note, uses, locked: isLocked, lockGap })
    }
  }
  return out
}

export type CardGlance = {
  card: string
  qualified: number   // 이번 달 실적 인정 추정액 — 다음 달 혜택을 연다
  target: number      // 막대의 끝: 다음 구간 기준(이미 최고 구간이면 그 기준)
  met: boolean        // 최저 구간을 채웠나 = 다음 달 혜택이 열리나
  nextGap: number     // 다음 구간까지 남은 금액(최고 구간이면 0)
  usedAreas: number   // 이번 달 혜택을 한 번이라도 받은 영역 수
  totalAreas: number
  remaining: number   // 이번 달 남은 할인 한도 합
  locked: boolean     // 전월 미달로 이번 달 혜택이 닫힘
  unknown: boolean    // 가족카드 합산이라 원장으로 실적 판정 불가
}

/**
 * 홈 카드 보드 맨 위 한 줄 요약: "실적 찼나 + 혜택 썼나".
 * 2026-10: 카드를 하나씩 탭으로 열어야 했고, 이번 달 실적이 다음 달 기준에 얼마나 찼는지가 안 보였다.
 */
export function cardGlance(
  transactions: (SplitTxLike & { payment?: string })[],
  yearMonth: string,
  balances: UnusedBenefit[],
  specs: CardSpec[] = CARD_SPECS.filter((s) => s.owned && s.tiers.length),
): CardGlance[] {
  const perf = new Map(cardPerformance(transactions, yearMonth).map((c) => [c.name, c.qualified]))
  return specs.map((spec) => {
    const qualified = perf.get(spec.card) ?? 0
    const mins = spec.tiers.map((t) => t.min)
    const st = tierStatus(qualified, spec.tiers)
    const mine = balances.filter((b) => b.card === spec.card)
    return {
      card: spec.card, qualified,
      target: st.next?.min ?? Math.max(...mins),
      met: qualified >= Math.min(...mins),
      nextGap: st.next?.gap ?? 0,
      usedAreas: new Set(mine.flatMap((b) => b.uses.map((u) => u.area))).size,
      totalAreas: spec.benefits.length,
      remaining: mine.reduce((s, b) => s + b.remaining, 0),
      locked: mine.some((b) => b.locked),
      unknown: Boolean(spec.familyPooled),
    }
  })
}

/**
 * 이번 달 아직 안 쓴 혜택만 낸다.
 * "놓친 혜택"이 이미 지나간 결제를 되짚는 것이라면, 이건 앞으로 쓸 수 있는 여유분이다.
 */
export function unusedBenefits(
  transactions: (SplitTxLike & { payment?: string })[],
  yearMonth: string,
  specs: CardSpec[] = CARD_SPECS.filter((s) => s.owned),
): UnusedBenefit[] {
  const out = benefitBalances(transactions, yearMonth, specs).filter((item) => item.remaining > 0)
  return out.sort((a, b) => Number(a.locked) - Number(b.locked) || b.remaining - a.remaining)
}

export type PlaybookRow = {
  card: string; area: string; rate: number
  keywords: string[]              // 이 카드가 이겨서 담당하는 가맹점들
  cap: number; remaining: number; locked: boolean
  minAmount?: number; note?: string
  runnerUp?: { card: string; rate: number }   // 한도를 다 쓴 뒤의 차선책
}

/**
 * "이럴 땐 이 카드" 표. 카드별 혜택을 가맹점 기준으로 뒤집는다.
 * 카드 화면은 '내 카드가 뭘 해주나'에 답하지만, 계산대 앞에서 필요한 건 그 반대다.
 * 가맹점마다 할인이 가장 큰 카드를 고르고, 같은 곳을 커버하는 다른 카드는 차선책으로 남긴다.
 */
export function paymentPlaybook(
  transactions: (SplitTxLike & { payment?: string })[],
  yearMonth: string,
  specs: CardSpec[] = CARD_SPECS.filter((s) => s.owned),
): PlaybookRow[] {
  // 통합 한도 카드(하나)는 unusedBenefits가 영역을 합쳐 한 줄로 내므로 영역명으로는 못 찾는다.
  // 그런 카드는 카드 단위로, 영역별 한도 카드는 카드/영역 단위로 건다.
  const left = new Map<string, UnusedBenefit>()
  for (const u of unusedBenefits(transactions, yearMonth, specs)) {
    const spec = specs.find((s) => s.card === u.card)
    left.set(spec?.sharedCap ? u.card : `${u.card}/${u.area}`, u)
  }
  // 가맹점 키워드 하나하나에 대해 승자와 차선책을 가린다.
  type Cand = { spec: CardSpec; b: BenefitArea }
  const byKeyword = new Map<string, Cand[]>()
  for (const spec of specs) {
    for (const b of spec.benefits) {
      for (const k of b.keywords) {
        if (!byKeyword.has(k)) byKeyword.set(k, [])
        ;(byKeyword.get(k) as Cand[]).push({ spec, b })
      }
    }
  }
  // 승자가 같으면 한 줄로 묶는다. 키워드 60개를 그대로 늘어놓으면 읽을 수가 없다.
  const groups = new Map<string, { win: Cand; keys: string[]; runner?: Cand }>()
  for (const [k, cands] of byKeyword) {
    const sorted = [...cands].sort((a, b) => b.b.rate - a.b.rate)
    const win = sorted[0]
    const runner = sorted.find((c) => c.spec.card !== win.spec.card)
    const key = `${win.spec.card}/${win.b.area}`
    const g = groups.get(key)
    if (g) { g.keys.push(k); if (!g.runner && runner) g.runner = runner }
    else groups.set(key, { win, keys: [k], runner })
  }
  const out: PlaybookRow[] = []
  for (const [key, g] of groups) {
    const u = left.get(g.win.spec.sharedCap ? g.win.spec.card : key)
    out.push({
      card: g.win.spec.card, area: g.win.b.area, rate: g.win.b.rate, keywords: g.keys,
      cap: u?.cap ?? g.win.b.cap, remaining: u?.remaining ?? 0, locked: u?.locked ?? false,
      minAmount: g.win.b.minAmount, note: g.win.b.note,
      runnerUp: g.runner ? { card: g.runner.spec.card, rate: g.runner.b.rate } : undefined,
    })
  }
  return out.sort((a, b) => b.rate - a.rate || b.remaining - a.remaining)
}

/**
 * '쓴 돈'에서 빼야 하는 두 갈래.
 *  - 저축/투자: 내 이름으로 옮겨가는 돈. 지출에 섞으면 소비 규모가 부풀어 보인다.
 *  - 금융/대출: 빚을 줄이는 돈. 소비가 아니라서 이번 달 얼마 썼나를 볼 때 방해가 된다.
 * 둘 다 통장에서는 실제로 나가므로 합계에서 지우지 않고 각각 별도 줄로 보여준다.
 */
export const SAVING_CATEGORY = '저축/투자'
export const LOAN_CATEGORY = '금융/대출'

export const isSaving = (t: { type: string; category?: string }) =>
  t.type === 'expense' && (t.category || '') === SAVING_CATEGORY

export const isLoanRepay = (t: { type: string; category?: string }) =>
  t.type === 'expense' && (t.category || '') === LOAN_CATEGORY

/** 소비로 볼 수 없는 지출(저축·대출상환)인지. 지출 합계에서 뺄 때 쓴다. */
export const isNonSpend = (t: { type: string; category?: string }) => isSaving(t) || isLoanRepay(t)

export type DepositRow = { date: string; name: string; amount: number; category: string; subCategory: string }

/**
 * 통장 입금의 출처별 분류. 프리랜서라 매달 들어오는 곳은 정해져 있고 금액만 바뀐다.
 * 새 거래처가 생기면 여기 한 줄 추가하면 된다.
 */
const INCOME_RULES: { words: string[]; category: string; sub: string }[] = [
  { words: ['우아한청년들', '배민', '쿠팡이츠', '카카오모빌리티', '바로고', '생각대로'], category: '수입', sub: '배달' },
  { words: ['토스오더', '토스페이먼츠', '스마트로', 'KCP', '나이스페이'], category: '수입', sub: '가게매출' },
  { words: ['고용서울', '고용노동', '실업급여', '근로복지'], category: '수입', sub: '실업급여' },
  { words: ['넷플릭스', '챗GPT', 'ChatGPT', '밀리의서재', '웨이브', '티빙', '유튜브'], category: '수입', sub: '구독환급' },
  { words: ['토스할인', '캐시백', '코스트코현대', '리워드'], category: '수입', sub: '캐시백' },
  { words: ['이자'], category: '수입', sub: '이자' },
]

const classifyDeposit = (name: string) => {
  for (const r of INCOME_RULES) if (r.words.some((w) => name.includes(w))) return { category: r.category, subCategory: r.sub }
  return { category: '수입', subCategory: '기타' }
}

/**
 * 은행 거래내역서를 붙여넣어 '입금'만 뽑는다. 프리랜서라 수입이 여러 곳에서 들쭉날쭉 들어와
 * 매달 손으로 옮기기 어렵다. 월말에 한 번 붙여넣으면 되게.
 *
 * 본인 계좌 간 이체는 걸러내지 않는다 - 이름만으로는 판단이 안 되고(2026-08엔 그런
 * 이체가 1,076만원이나 됐다) 잘못 지우면 수입이 부풀거나 사라진다. 화면에서 고르게 한다.
 */
export function parseBankDeposits(text: string): DepositRow[] {
  const out: DepositRow[] = []
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+/g, ' ').trim()
    if (!line) continue
    // 날짜 [시각] 구분 금액 잔액 거래내용
    const m = line.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\s+(?:\d{1,2}:\d{2}(?::\d{2})?\s+)?(\S+)\s+(-?[\d,]+)\s+[\d,]+\s+(.+)$/)
    if (!m) continue
    const [, y, mo, d, kind, amt, name] = m
    const amount = Number(amt.replace(/,/g, ''))
    if (amount <= 0) continue                      // 출금은 이 화면에서 다루지 않는다
    if (/출금|이체출금/.test(kind) && !/입금/.test(kind)) continue
    const date = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    out.push({ date, name: name.trim(), amount, ...classifyDeposit(name) })
  }
  return out
}
