import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * 가계부 원격 MCP 서버 (Streamable HTTP).
 * 폰의 Claude 앱 등 어느 대화에서든 커스텀 커넥터로 붙여 쓴다.
 *
 * 환경변수(모두 서버 전용 — VITE_ 접두어 금지):
 *   SYNC_URL    Google Apps Script 웹앱 URL
 *   SYNC_TOKEN  GAS 토큰
 *   MCP_SECRET  이 엔드포인트 접근 키 (?k=... 또는 Authorization: Bearer ...)
 */

type Tx = {
  id: string; date: string; type: string; amount: number; memo: string
  category: string; subCategory: string; payment: string; fixedType: string; split: number
}
type FixedDef = {
  id: string; active: boolean; name: string; amount: number; category: string
  subCategory: string; payment: string; payDay: number; startMonth: string
  installmentTotal: number | null; variable: boolean; split: number; kind: string
}

const env = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`${k} 환경변수가 없습니다`)
  return v
}

/** GAS는 가끔 302/404를 뱉어서 재시도한다. */
async function gasGet<T = unknown>(action: string, extra = ''): Promise<T> {
  const url = `${env('SYNC_URL')}?action=${action}&token=${encodeURIComponent(env('SYNC_TOKEN'))}${extra}`
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { redirect: 'follow' })
      if (r.ok) return await r.json() as T
    } catch { /* 재시도 */ }
    await new Promise((s) => setTimeout(s, 1500))
  }
  throw new Error('가계부 서버 응답 실패 (잠시 후 다시)')
}

async function gasPost(body: Record<string, unknown>): Promise<unknown> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(env('SYNC_URL'), {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, token: env('SYNC_TOKEN') }),
      })
      if (r.ok) return await r.json()
    } catch { /* 재시도 */ }
    await new Promise((s) => setTimeout(s, 1500))
  }
  throw new Error('가계부 저장 실패 (잠시 후 다시)')
}

const rows = async (): Promise<Tx[]> => (await gasGet<{ transactions?: Tx[] }>('ledger')).transactions ?? []
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const thisMonth = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7)  // KST
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const line = (t: Tx) =>
  `${t.id.slice(0, 8)} ${t.date} ${t.memo} ${won(t.amount)} [${t.payment || '-'}] ${t.category}/${t.subCategory}` +
  (t.split ? ` (분담 ${won(t.split)})` : '')

async function findOne(id8: string): Promise<Tx> {
  const hit = (await rows()).filter((t) => t.id.startsWith(id8))
  if (!hit.length) throw new Error(`${id8} 로 시작하는 거래가 없습니다`)
  if (hit.length > 1) throw new Error(`${id8} 가 ${hit.length}건과 겹칩니다 — 더 길게 지정하세요`)
  return hit[0]
}

// ── 도구 정의 ───────────────────────────────────────────────
const TOOLS = [
  { name: 'ledger_check', description: '가계부 이상 항목 점검(미분류·중복·금액0·미래날짜·결제수단 누락) + 이번 달 요약.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ledger_month', description: '월 지출 요약. 카테고리별·결제수단별 내역 포함.',
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (생략 시 이번 달)' } } } },
  { name: 'ledger_find', description: '거래 내역을 키워드로 검색(가맹점·메모).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'ledger_split', description: '분담금 정산 — 정산해서 받을 돈(상대별)과 자동 환급을 나눠서 보여준다.',
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (생략 시 이번 달)' } } } },
  { name: 'ledger_fixed', description: '고정비·정기수입 목록과 월 합계.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ledger_add', description: '거래 추가. 자연어 한 줄을 그대로 넘기면 서버가 금액·결제수단·날짜·카테고리를 자동 인식한다. 예: "5000 스타벅스 하나카드", "+600000 월급", "어제 12000 김밥천국 현금". 수입은 앞에 +.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '예: 5000 스타벅스 하나카드' } }, required: ['text'] } },
  { name: 'ledger_edit', description: '거래 수정. id는 조회 결과 앞 8자리. 바꿀 항목만 넘긴다.',
    inputSchema: { type: 'object', properties: {
      id: { type: 'string' }, amount: { type: 'number' }, memo: { type: 'string' },
      payment: { type: 'string' }, date: { type: 'string' }, split: { type: 'number', description: '남이 부담하는 몫' },
      category: { type: 'string' }, subCategory: { type: 'string' } }, required: ['id'] } },
  { name: 'ledger_half', description: '분담금을 금액의 절반으로 설정(반반 정산).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'ledger_delete', description: '거래 삭제. 되돌릴 수 없으니 대상(날짜·금액·메모)을 확인하고 실행할 것.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
]

// ── 도구 실행 ───────────────────────────────────────────────
async function runTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (name === 'ledger_check') {
    const d = await rows(); const t0 = today()
    const mis = d.filter((t) => (t.category || '미분류') === '미분류')
    const zero = d.filter((t) => !t.amount)
    const fut = d.filter((t) => t.date > t0)
    const nopay = d.filter((t) => t.type === 'expense' && !t.payment)
    const seen = new Map<string, number>()
    d.forEach((t) => { const k = `${t.date}|${t.amount}|${(t.memo || '').trim()}`; seen.set(k, (seen.get(k) || 0) + 1) })
    const dup = [...seen.entries()].filter(([, v]) => v > 1)
    let out = `원장 ${d.length}건 (${t0})\n미분류 ${mis.length} · 금액0 ${zero.length} · 중복 ${dup.length} · 미래날짜 ${fut.length} · 결제수단없음 ${nopay.length}`
    for (const [label, ts] of [['미분류', mis], ['금액0', zero], ['미래날짜', fut], ['결제수단없음', nopay]] as [string, Tx[]][]) {
      if (ts.length) out += `\n\n[${label}]\n` + ts.slice(0, 10).map(line).join('\n')
    }
    if (dup.length) out += `\n\n[중복]\n` + dup.slice(0, 10).map(([k, v]) => `${k} x${v}`).join('\n')
    return out + '\n\n' + (await runTool('ledger_month', {}))
  }

  if (name === 'ledger_month') {
    const m = typeof args.month === 'string' ? args.month : thisMonth(); const d = await rows()
    const exp = d.filter((t) => t.date.startsWith(m) && t.type === 'expense')
    const inc = d.filter((t) => t.date.startsWith(m) && t.type === 'income')
    const tot = exp.reduce((s, t) => s + t.amount, 0)
    const sp = exp.reduce((s, t) => s + (t.split || 0), 0)
    const fix = exp.filter((t) => t.fixedType === 'fixed').reduce((s, t) => s + t.amount - (t.split || 0), 0)
    const group = (key: 'category' | 'payment') => {
      const c = new Map<string, number>()
      exp.forEach((t) => c.set(t[key] || '-', (c.get(t[key] || '-') || 0) + t.amount - (t.split || 0)))
      return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `  ${k} ${won(v)}`).join('\n')
    }
    return `${m} · ${exp.length}건\n결제 ${won(tot)} · 분담/환급 ${won(sp)} · 내 실지출 ${won(tot - sp)}\n` +
      `고정 ${won(fix)} · 변동 ${won(tot - sp - fix)} · 수입 ${won(inc.reduce((s, t) => s + t.amount, 0))}\n` +
      `\n[카테고리별]\n${group('category')}\n\n[결제수단별]\n${group('payment')}`
  }

  if (name === 'ledger_find') {
    const q = String(args.query || '').toLowerCase()
    const hit = (await rows()).filter((t) => (t.memo || '').toLowerCase().includes(q))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
    return `'${args.query}' ${hit.length}건 · 합계 ${won(hit.reduce((s, t) => s + t.amount, 0))}\n` +
      hit.slice(0, 25).map(line).join('\n')
  }

  if (name === 'ledger_split') {
    const m = typeof args.month === 'string' ? args.month : thisMonth()
    const ts = (await rows()).filter((t) => t.date.startsWith(m) && (t.split || 0) > 0)
    const isRefund = (t: Tx) => ['환급', '리워드'].some((w) => (t.memo || '').includes(w))
    const refund = ts.filter(isRefund), settle = ts.filter((t) => !isRefund(t))
    const people: Record<string, string[]> = { 여친: ['브리', '여친', '여자친구'], 형: ['형'] }
    const by = new Map<string, number>()
    settle.forEach((t) => {
      const who = Object.keys(people).find((n) => people[n].some((w) => (t.memo || '').includes(w))) || '기타'
      by.set(who, (by.get(who) || 0) + t.split)
    })
    return `${m} 분담금\n정산해서 받을 돈 ${won(settle.reduce((s, t) => s + t.split, 0))}\n` +
      [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k} ${won(v)}`).join('\n') +
      `\n자동 환급 ${won(refund.reduce((s, t) => s + t.split, 0))}\n\n` + ts.map(line).join('\n')
  }

  if (name === 'ledger_fixed') {
    const defs = ((await gasGet<{ defs?: FixedDef[] }>('fixedList')).defs ?? []).filter((f) => f.active)
    return (['expense', 'income'] as const).map((kind) => {
      const g = defs.filter((f) => f.kind === kind)
      const label = kind === 'expense' ? '고정비' : '정기수입'
      return `[${label}] ${g.length}건 · 월 ${won(g.reduce((s, f) => s + f.amount, 0))}\n` +
        g.sort((a, b) => b.amount - a.amount).map((f) =>
          `  ${f.name} ${won(f.amount)} (매월 ${f.payDay}일` +
          (f.installmentTotal ? ` · ${f.installmentTotal}회` : '') +
          (f.split ? ` · 분담 ${won(f.split)}` : '') + `) [${f.payment}]`).join('\n')
    }).join('\n\n')
  }

  if (name === 'ledger_add') {
    const r = await gasGet<{ parsed?: Record<string, unknown> }>('add', `&raw=${encodeURIComponent(String(args.text || ''))}`)
    const p = r.parsed || {}
    const amount = typeof p.amount === 'number' ? p.amount : Number(p.amount) || 0
    return `추가됨: ${p.date} ${p.memo} ${won(amount)} [${p.payment || '-'}] ${p.mainCategory}/${p.subCategory}`
  }

  if (name === 'ledger_edit') {
    const t = await findOne(String(args.id))
    const before = { ...t }
    for (const k of ['amount', 'memo', 'payment', 'date', 'split', 'category', 'subCategory'] as const) {
      if (args[k] !== undefined) Object.assign(t, { [k]: args[k] })
    }
    await gasPost({ action: 'updateLedger', tx: t })
    const chg = (Object.keys(t) as (keyof Tx)[]).filter((k) => before[k] !== t[k])
      .map((k) => `${k}: ${before[k]} → ${t[k]}`)
    return `수정됨 ${t.id.slice(0, 8)} ${t.memo}\n${chg.join('\n')}`
  }

  if (name === 'ledger_half') {
    const t = await findOne(String(args.id))
    t.split = Math.floor(t.amount / 2)
    await gasPost({ action: 'updateLedger', tx: t })
    return `반반 처리 ${t.memo} ${won(t.amount)} → 분담 ${won(t.split)} · 내 ${won(t.amount - t.split)}`
  }

  if (name === 'ledger_delete') {
    const t = await findOne(String(args.id))
    await gasPost({ action: 'deleteLedger', id: t.id })
    return `삭제됨 ${t.date} ${t.memo} ${won(t.amount)}`
  }

  throw new Error(`모르는 도구: ${name}`)
}

// ── MCP (JSON-RPC 2.0 over HTTP) ────────────────────────────
const PROTOCOL = '2024-11-05'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 접근키: ?k=... 또는 Authorization: Bearer ...
  const secret = process.env.MCP_SECRET
  const given = (req.query.k as string) || (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!secret || given !== secret) return res.status(401).json({ error: 'unauthorized' })

  if (req.method === 'GET') return res.status(200).json({ ok: true, server: 'ledger-mcp', protocol: PROTOCOL })
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' })

  const msg = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const reply = (result: unknown) => res.status(200).json({ jsonrpc: '2.0', id: msg?.id, result })
  const fail = (code: number, message: string) =>
    res.status(200).json({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code, message } })

  try {
    switch (msg?.method) {
      case 'initialize':
        return reply({
          protocolVersion: msg?.params?.protocolVersion ?? PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'ledger', version: '1.0.0' },
        })
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return res.status(202).end()
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const text = await runTool(msg.params?.name, msg.params?.arguments ?? {})
        return reply({ content: [{ type: 'text', text }], isError: false })
      }
      case 'resources/list': return reply({ resources: [] })
      case 'prompts/list':   return reply({ prompts: [] })
      default:
        return fail(-32601, `지원하지 않는 메서드: ${msg?.method}`)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (msg?.method === 'tools/call') {
      return reply({ content: [{ type: 'text', text: `오류: ${message}` }], isError: true })
    }
    return fail(-32603, message)
  }
}
