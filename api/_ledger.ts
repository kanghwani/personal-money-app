/**
 * 가계부 요약의 순수 로직. mcp.ts 와 skills/ledger/ledger.py 가 같은 규칙을 쓴다(파이썬은 손으로 옮긴 사본).
 * 규칙을 바꾸면 양쪽을 같이 고친다.
 */
export type Tx = {
  id: string; date: string; type: string; amount: number; memo: string
  category: string; subCategory: string; payment: string; fixedType: string; split: number
}

export const PEOPLE: Record<string, string[]> = { 여친: ['브리', '여친', '여자친구'], 형: ['형'], 엄마: ['엄마'] }
export const REFUND_WORDS = ['환급', '리워드', '피클']
// ponytail: 이 날짜 전의 분담금은 '받음' 표시가 없어도 정산된 것으로 본다(옛 기록 40여 건에 표시가 없다).
export const SETTLE_SINCE = '2026-09-01'
export const SETTLED = '받음'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const net = (t: Tx) => t.amount - (t.split || 0)
const has = (t: Tx, words: string[]) => words.some((w) => (t.memo || '').includes(w))

// ── 월 요약: 고정비를 성격대로 나눈다 ────────────────────────
export type Bucket = '생활고정' | '부채상환' | '저축' | '변동'
export function bucketOf(t: Tx): Bucket {
  if (t.fixedType !== 'fixed') return '변동'
  if (t.category === '금융/대출' || (t.memo || '').includes('할부')) return '부채상환'
  if (t.category === '저축/투자') return '저축'
  return '생활고정'
}

export function monthSummary(exp: Tx[], inc: Tx[], m: string): string {
  const tot = exp.reduce((s, t) => s + t.amount, 0)
  const sp = exp.reduce((s, t) => s + (t.split || 0), 0)
  const by = new Map<Bucket, number>()
  exp.forEach((t) => by.set(bucketOf(t), (by.get(bucketOf(t)) || 0) + net(t)))
  const b = (k: Bucket) => won(by.get(k) || 0)
  const loan = exp.filter((t) => bucketOf(t) === '부채상환' && t.category === '금융/대출').reduce((s, t) => s + net(t), 0)
  const inst = (by.get('부채상환') || 0) - loan
  const group = (key: 'category' | 'payment') => {
    const c = new Map<string, number>()
    exp.forEach((t) => c.set(t[key] || '-', (c.get(t[key] || '-') || 0) + net(t)))
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `  ${k} ${won(v)}`).join('\n')
  }
  return `${m} · ${exp.length}건\n결제 ${won(tot)} · 분담/환급 ${won(sp)} · 내 실지출 ${won(tot - sp)} · 수입 ${won(inc.reduce((s, t) => s + t.amount, 0))}\n` +
    `생활고정 ${b('생활고정')} · 변동 ${b('변동')}\n부채상환 ${b('부채상환')} (대출 ${won(loan)} · 할부 ${won(inst)}) · 저축 ${b('저축')}\n` +
    `\n[카테고리별]\n${group('category')}\n\n[결제수단별]\n${group('payment')}`
}

// ── 분담금: 누구한테 얼마 받아야 하고, 받았는지 ─────────────
export const isRefund = (t: Tx) => has(t, REFUND_WORDS)
export const isSettled = (t: Tx) => t.date < SETTLE_SINCE || has(t, [SETTLED])
export const whoOf = (t: Tx) => Object.keys(PEOPLE).find((n) => has(t, PEOPLE[n])) || '기타'
const isSplit = (t: Tx) => t.type === 'expense' && (t.split || 0) > 0

const line = (t: Tx) => `${t.id.slice(0, 8)} ${t.date.slice(5)} ${t.memo} ${won(t.split)}`
const sum = (ts: Tx[]) => ts.reduce((s, t) => s + t.split, 0)
const byWho = (ts: Tx[]) => {
  const m = new Map<string, Tx[]>()
  ts.forEach((t) => m.set(whoOf(t), [...(m.get(whoOf(t)) || []), t]))
  return [...m.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))
}

/** 안 받은 것 전체(월 무관) + 지정한 달의 정산 현황 */
export function splitReport(all: Tx[], m: string): string {
  const splits = all.filter(isSplit).filter((t) => !isRefund(t))
  const open = splits.filter((t) => !isSettled(t)).sort((a, b) => (a.date < b.date ? -1 : 1))
  const out: string[] = []
  out.push(open.length ? `[안 받은 분담금] ${won(sum(open))} · ${open.length}건` : '[안 받은 분담금] 없음')
  byWho(open).forEach(([who, ts]) => out.push(`  ${who} ${won(sum(ts))}\n` + ts.map((t) => '    ' + line(t)).join('\n')))
  const mon = splits.filter((t) => t.date.startsWith(m))
  out.push(`\n[${m} 정산] 받을 ${won(sum(mon))} · 받음 ${won(sum(mon.filter(isSettled)))} · 남음 ${won(sum(mon.filter((t) => !isSettled(t))))}`)
  byWho(mon).forEach(([who, ts]) => out.push(`  ${who} 받을 ${won(sum(ts))} · 받음 ${won(sum(ts.filter(isSettled)))}`))
  const refund = all.filter(isSplit).filter(isRefund).filter((t) => t.date.startsWith(m))
  if (refund.length) out.push(`\n[자동 환급] ${won(sum(refund))}\n` + refund.map((t) => '  ' + line(t)).join('\n'))
  return out.join('\n')
}

/** query 가 id 앞자리이거나 메모에 들어 있는, 아직 안 받은 분담 거래 */
export function settleTargets(all: Tx[], query: string): Tx[] {
  const q = query.trim().toLowerCase()
  return all.filter(isSplit).filter((t) => !isRefund(t) && !isSettled(t))
    .filter((t) => t.id.startsWith(q) || (t.memo || '').toLowerCase().includes(q))
}

export const settledMemo = (memo: string, date: string) => `${memo} · ${SETTLED} ${date.slice(5)}`
