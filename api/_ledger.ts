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
// 대출·저축은 고정/변동 표시와 무관하게 카테고리로 잡는다(수동 입력한 상환은 변동으로 들어온다).
export function bucketOf(t: Tx): Bucket {
  if (((t.category || '').startsWith('금융') && t.subCategory !== '수수료') || (t.fixedType === 'fixed' && (t.memo || '').includes('할부'))) return '부채상환'
  if ((t.category || '').startsWith('저축')) return '저축'
  return t.fixedType === 'fixed' ? '생활고정' : '변동'
}

export function monthSummary(all: Tx[], m: string, todayStr: string): string {
  const inM = all.filter((t) => t.date.startsWith(m))
  const exp = inM.filter((t) => t.type === 'expense'), inc = inM.filter((t) => t.type === 'income')
  const tot = exp.reduce((s, t) => s + t.amount, 0)
  const sp = exp.reduce((s, t) => s + (t.split || 0), 0)
  const by = new Map<Bucket, number>()
  exp.forEach((t) => by.set(bucketOf(t), (by.get(bucketOf(t)) || 0) + net(t)))
  const b = (k: Bucket) => won(by.get(k) || 0)
  const loan = exp.filter((t) => bucketOf(t) === '부채상환' && (t.category || '').startsWith('금융')).reduce((s, t) => s + net(t), 0)
  const inst = (by.get('부채상환') || 0) - loan
  const group = (key: 'category' | 'payment') => {
    const c = new Map<string, number>()
    exp.forEach((t) => c.set(t[key] || '-', (c.get(t[key] || '-') || 0) + net(t)))
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `  ${k} ${won(v)}`).join('\n')
  }
  return `${m} · ${exp.length}건\n결제 ${won(tot)} · 분담/환급 ${won(sp)} · 내 실지출 ${won(tot - sp)} · 수입 ${won(inc.reduce((s, t) => s + t.amount, 0))}\n` +
    `생활비 ${won((by.get('생활고정') || 0) + (by.get('변동') || 0))} = 생활고정 ${b('생활고정')} · 변동 ${b('변동')}  (빚·할부·저축 제외)\n부채상환 ${b('부채상환')} (대출 ${won(loan)} · 할부 ${won(inst)}) · 저축 ${b('저축')}\n` +
    `\n[인사이트]\n${monthInsights(all, m, todayStr).map((l) => '  ' + l).join('\n')}` +
    `\n\n[카테고리별]\n${group('category')}\n\n[결제수단별]\n${group('payment')}`
}

const prevMonth = (m: string) => { const d = new Date(m + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) }
const pct = (cur: number, prev: number) => prev > 0 ? `${cur >= prev ? '+' : ''}${Math.round((cur - prev) / prev * 100)}%` : '비교 없음'

/** 월 요약 밑의 인사이트. 규칙은 앱 buildInsights 와 같은 취지(수지·변동·최대건·1위 카테고리·미수 분담금). */
export function monthInsights(all: Tx[], m: string, todayStr: string): string[] {
  const exp = all.filter((t) => t.date.startsWith(m) && t.type === 'expense')
  const inc = all.filter((t) => t.date.startsWith(m) && t.type === 'income').reduce((s, t) => s + t.amount, 0)
  const pm = prevMonth(m)
  const variable = (ts: Tx[]) => ts.filter((t) => bucketOf(t) === '변동')
  const real = exp.reduce((s, t) => s + net(t), 0)
  const v = variable(exp).reduce((s, t) => s + net(t), 0)
  const vPrev = variable(all.filter((t) => t.date.startsWith(pm) && t.type === 'expense')).reduce((s, t) => s + net(t), 0)
  const out: string[] = []
  if (inc > 0) out.push(`수지: 수입 ${won(inc)} − 실지출 ${won(real)} = ${inc - real >= 0 ? '+' : '-'}${won(Math.abs(inc - real))}`)
  out.push(`변동 ${won(v)} · 지난달 ${won(vPrev)} 대비 ${pct(v, vPrev)}${vPrev > 0 && v > vPrev * 1.1 ? ' ⚠' : ''}`)
  if (todayStr.startsWith(m)) {
    const day = Number(todayStr.slice(8)), days = new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate()
    if (day >= 5 && day < days) out.push(`지금 페이스면 월말 변동 ≈ ${won(Math.round(v / day * days))} (${day}/${days}일)`)
  }
  const top = [...variable(exp)].sort((a, b) => net(b) - net(a))[0]
  if (top && net(top) >= 150000) out.push(`가장 큰 변동: ${top.memo} ${won(net(top))} ⚠`)
  const cat = (ts: Tx[]) => { const c = new Map<string, number>(); variable(ts).forEach((t) => c.set(t.category, (c.get(t.category) || 0) + net(t))); return c }
  const cur = cat(exp), prv = cat(all.filter((t) => t.date.startsWith(pm) && t.type === 'expense'))
  const first = [...cur.entries()].sort((a, b) => b[1] - a[1])[0]
  if (first) out.push(`변동 1위 ${first[0]} ${won(first[1])} (지난달 ${won(prv.get(first[0]) || 0)})`)
  const open = all.filter(isSplit).filter((t) => !isRefund(t) && !isSettled(t))
  if (open.length) out.push(`안 받은 분담금 ${won(sum(open))}: ` + byWho(open).map(([w, ts]) => `${w} ${won(sum(ts))} ${ts.length}건`).join(' · '))
  return out
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
