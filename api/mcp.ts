import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasGet, gasPost } from './_gas.js'
import { loadState, scan, checkResults, group, formatEvents, parseEventLog, findEvents, resolveChannel, videoSnippet, detect, parseVideoInput, mmddToYmd, newRow, statusRow, saveRows, stampNow, videoUrl } from './_events.js'

/**
 * 가계부 + 유튜브 이벤트 원격 MCP 서버 (Streamable HTTP).
 * 폰의 Claude 앱 등 어느 대화에서든 커스텀 커넥터로 붙여 쓴다.
 *
 * 환경변수(모두 서버 전용 — VITE_ 접두어 금지):
 *   SYNC_URL    Google Apps Script 웹앱 URL
 *   SYNC_TOKEN  GAS 토큰
 *   MCP_SECRET  이 엔드포인트 접근 키 (?k=... 또는 Authorization: Bearer ...)
 */

import { monthSummary, splitReport, settleTargets, settledMemo, type Tx } from './_ledger.js'
type FixedDef = {
  id: string; active: boolean; name: string; amount: number; category: string
  subCategory: string; payment: string; payDay: number; startMonth: string
  installmentTotal: number | null; variable: boolean; split: number; kind: string
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
export const TOOLS = [
  { name: 'ledger_check', description: '가계부 이상 항목 점검(미분류·중복·금액0·미래날짜·결제수단 누락) + 이번 달 요약.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'ledger_month', description: '월 지출 요약: 생활고정·변동·부채상환·저축 묶음, 인사이트(수지·변동 비교·월말 페이스·최대 지출·미수 분담금), 카테고리별·결제수단별.',
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (생략 시 이번 달)' } } } },
  { name: 'ledger_find', description: '거래 내역을 키워드로 검색(가맹점·메모).',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'ledger_split', description: '분담금 정산 현황. 아직 안 받은 분담금 전체(월 무관, 상대별·건별)와 지정한 달의 받을·받음·남음, 자동 환급. "여친한테 얼마 받아야 해", "이번 달 분담금 다 받았어?" 같은 질문에. 받았다는 말이 나오면 ledger_settle 로 표시한다.',
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM (생략 시 이번 달)' } } } },
  { name: 'ledger_settle', description: '분담금을 받았다고 표시한다(메모 끝에 "· 받음 MM-DD"). query 는 메모 일부("월세", "코스트코") 또는 id 앞자리. 안 받은 것 중에서만 찾고, 여러 건이면 목록만 돌려주므로 all=true 로 전부 표시하거나 id 로 하나씩. "월세 받았어", "브리가 코스트코 정산했어" 같은 말에 사용.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, all: { type: 'boolean', description: '여러 건 매칭 시 전부 표시' } }, required: ['query'] } },
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
  { name: 'event_list', description: '유튜브 구독자 이벤트 현황(시트 events 탭). 등록된 채널의 최근 영상 스캔 + 하루 한 번 유튜브 검색("댓글 이벤트"·"구독자 이벤트", 최근 7일)으로 새 이벤트를 저장한 뒤, 지원 대기(댓글 적은 순 = 경쟁 낮은 순, 댓글 수·구독자 수·영상 링크·조건 발췌 포함)·지원함(발표 대기 — 발표일이 지나면 영상 설명·댓글·채널 새 영상에서 사용자 핸들을 찾아 "당첨 후보"로 표시하니 사용자에게 확인을 권한다)·결과(최근 30일)·놓침을 보여준다. "이벤트 뭐 있어", "지원할 거 있어", "이벤트 마감 언제야" 같은 질문에. 지원 대기 항목의 발췌를 보고 댓글 초안을 써 주면 좋다(댓글은 사용자가 직접 단다). 마감·발표 뒤의 ? 는 설명에서 날짜를 못 찾아 추정한 값이니 영상에서 확인하라고 알려줄 것.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'event_log', description: '유튜브 이벤트 한 줄 기록. "지원 십만양품"(댓글 달았음), "당첨 십만양품 에어프라이어 15만"(당첨, 뒤는 메모), "탈락 키보드", "패스 이어폰"(안 할 것). 키워드는 채널명이나 제목 일부. "채널 추가 https://www.youtube.com/@100k-smyp"(감시 채널 등록, @핸들만 줘도 됨), "채널 삭제 @핸들"(감시 목록에서 제외), "이벤트 추가 https://youtu.be/xxx 마감 10-05 발표 10-07"(목록 밖 채널에서 직접 본 이벤트, 날짜는 생략 가능). 당첨 경품을 가계부에 넣고 싶다고 하면 ledger_add 로 "+금액 이벤트 당첨 채널명" 을 따로 기록한다.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
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
    const m = typeof args.month === 'string' ? args.month : thisMonth()
    return monthSummary(await rows(), m, today())
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
    return splitReport(await rows(), m)
  }

  if (name === 'ledger_settle') {
    const hit = settleTargets(await rows(), String(args.query || ''))
    if (!hit.length) return `'${args.query}' 에 해당하는 안 받은 분담금이 없습니다`
    if (hit.length > 1 && args.all !== true) {
      return `${hit.length}건이 걸립니다. id 로 하나씩 하거나 all=true 로 전부 표시하세요.\n` + hit.map(line).join('\n')
    }
    const d = today()
    for (const t of hit) { t.memo = settledMemo(t.memo, d); await gasPost({ action: 'updateLedger', tx: t }) }
    return `받음 표시 ${hit.length}건 (${d.slice(5)})\n` + hit.map(line).join('\n')
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

  if (name === 'event_list') {
    const t0 = today()
    const { channels, events, lastSearch } = await loadState()
    const r = await scan(channels, events, lastSearch, t0)
    const all = [...events, ...r.added]
    const rc = await checkResults(all, t0)
    const errors = [...r.errors, ...rc.errors]
    const tail = `\n\n채널 ${r.scanned}개 스캔${r.searched ? ' + 오늘 첫 검색' : ''} · 새 이벤트 ${r.added.length}건` + (rc.hints.length ? ` · 당첨 후보 ${rc.hints.length}건!` : '') + (errors.length ? ` · 실패: ${errors.join(', ')}` : '')
    return formatEvents(group(all, t0), t0) + tail
  }

  if (name === 'event_log') {
    const cmd = parseEventLog(String(args.text || ''))
    const stamp = stampNow()
    if (cmd.kind === 'channel') {
      const { channels } = await loadState()
      if (cmd.remove) {
        // 등록된 것 중에서 핸들·이름·ID 로 찾는다. API 호출 없이 끝난다.
        const q = cmd.input.replace(/^.*@/, '@').toLowerCase()
        const hit = channels.filter((c) => c.handle.toLowerCase() === q || c.name.toLowerCase() === cmd.input.toLowerCase() || c.id === cmd.input)
        if (!hit.length) return `등록된 채널 중 '${cmd.input}' 이 없어요.\n` + channels.map((c) => `• ${c.name} (${c.handle})`).join('\n')
        await saveRows('event_channels', hit.map((c) => [stamp, c.id, '삭제', ''].join('|')))
        return `채널 삭제: ${hit.map((c) => c.name).join(', ')} — 남은 채널 ${channels.length - hit.length}개`
      }
      const ch = await resolveChannel(cmd.input)
      if (channels.some((c) => c.id === ch.id)) return `이미 등록된 채널: ${ch.name} (${ch.handle})`
      await saveRows('event_channels', [[stamp, ch.id, ch.name, ch.handle].join('|')])
      return `채널 등록: ${ch.name} (${ch.handle}) — 총 ${channels.length + 1}개. 다음 스캔부터 최근 영상을 봅니다.`
    }
    if (cmd.kind === 'video') {
      const id = parseVideoInput(cmd.url)
      if (!id) throw new Error('영상 URL 이 아니에요 (youtu.be/… 또는 watch?v=…)')
      const { events } = await loadState()
      if (events.some((e) => e.id === id)) return `이미 있는 이벤트: ${videoUrl(id)}`
      const e = detect(await videoSnippet(id), true)!
      const t0 = today()
      if (cmd.deadline) { e.deadline = mmddToYmd(cmd.deadline, t0); e.deadlineGuessed = false }
      if (cmd.announce) { e.announce = mmddToYmd(cmd.announce, t0); e.announceGuessed = false }
      await saveRows('events', [newRow(e, stamp)])
      return `이벤트 등록: ${e.channel} · ${e.title}\n마감 ${e.deadline}${e.deadlineGuessed ? '?' : ''} · 발표 ${e.announce}${e.announceGuessed ? '?' : ''}\n${e.excerpt}`
    }
    const { events } = await loadState()
    const hit = findEvents(events, cmd.query)
    if (!hit.length) return `'${cmd.query}' 에 해당하는 진행 중 이벤트가 없어요.\n` + formatEvents(group(events, today()), today())
    if (hit.length > 1) return `${hit.length}건이 걸려요. 제목 단어로 더 좁혀 주세요:\n` + hit.map((e) => `• ${e.channel} · ${e.title} (마감 ${e.deadline.slice(5)})`).join('\n')
    const e = hit[0]
    await saveRows('events', [statusRow(e.id, cmd.status, cmd.note, stamp)])
    const word = { applied: '지원함', won: '당첨', lost: '탈락', skipped: '패스', new: '', reminded: '' }[cmd.status]
    return `${word}: ${e.channel} · ${e.title}${cmd.note ? ' · ' + cmd.note : ''}` + (cmd.status === 'applied' ? `\n발표 ${e.announce.slice(5)}${e.announceGuessed ? '?' : ''} 에 결과를 확인하세요.` : '')
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
          serverInfo: { name: 'ledger', version: '1.1.0' },
          // 클라이언트가 시스템 컨텍스트로 싣는 안내문 — 앱 쪽에 스킬을 따로 저장하지 않아도 툴을 고르게 한다.
          instructions: '이 서버는 사용자의 가계부(구글시트)와 유튜브 구독자 이벤트를 담당한다. ' +
            '지출·수입·분담금·고정비 질문과 "5000 스타벅스 하나카드" 같은 한 줄 입력은 ledger_* 툴을 쓴다. ' +
            '유튜브 구독자 이벤트(지원할 거 있나·마감·당첨) 질문은 event_list, "지원 십만양품"·"당첨 …"·"채널 추가 @핸들" 같은 한 줄은 event_log 로 처리한다. ' +
            '결과는 폰에서 읽기 좋게 3~5줄로 요약한다.',
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
