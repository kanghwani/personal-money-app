import type { VercelRequest, VercelResponse } from '@vercel/node'
import { summarizeSleep, summarizeDaily, summarizeWorkouts, summarizeTrend, type HealthRow, type Tabs } from './_health.js'
import { parseLog, logStamp, summarizeManual, overCap, todayCommitments } from './_log.js'
import { readiness, formatReadiness } from './_readiness.js'
import { dailyLoad, fitnessPayload, insights } from './_analysis.js'
import { weekReview, formatWeek, monthReview, formatMonth, adviceHistory, formatHistory, adviceToExtra, mondayOf, monthOf } from './_coach.js'
import { gasGet, gasPost } from './_gas.js'

/**
 * 가계부 + 건강 원격 MCP 서버 (Streamable HTTP).
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
  { name: 'health_week', description: '애플워치 건강 리포트(구글시트 자동 수집). 수면(밤별 취침→기상·총수면·깊은/REM/코어·각성), 일별 지표(안정심박·HRV·호흡수·손목온도·SpO2·걸음·활동kcal·운동분)와 이전 30일 대비, 운동 세션 목록. 수면·컨디션·피로·회복·운동량·"오늘 몸 상태" 질문은 이 툴로 답한다.',
    inputSchema: { type: 'object', properties: { days: { type: 'number', description: '최근 며칠 (기본 7, 최대 60)' } } } },
  { name: 'health_today', description: '오늘 준비도(0~100)와 사유. 60일 개인 기준선 대비 HRV 7일 평균·어젯밤 HRV·안정심박·어젯밤 수면·수면 부채·손목온도·호흡수·전날 부하로 계산, 질병 패턴이면 상한. 밴드: 75+ 강하게, 50~74 계획대로, 30~49 가볍게, 30 미만 휴식. "오늘 컨디션 어때", "오늘 운동해도 돼", "에너지 레벨" 질문에 사용. 숫자와 사유만 전달하고 원인을 지어내지 말 것.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'health_log', description: '건강·훈련 한 줄 기록(시트 manual 탭). 형식: "컨디션 4 3 2 3"(수면질 피로 스트레스 근육통 1~5, 아침), "sRPE 수영 55 6 [메모]"(종목 분 RPE1~10, 훈련 직후), "턱걸이 밴드 3x5" / "턱걸이 네거티브 4x8초" / "턱걸이 5 5 4", "태그 술 늦은식사 카페인 출장 아픔", "통증 무릎 3"(0~10), "인바디 72.3 33.1 18.5"(체중 골격근량 체지방률), "계획 월 수영 턱걸이"/"계획 토 휴식"(요일별 훈련 계획, 주간 리포트의 계획 대비 실행에 사용), "약속 09-13 카제나 QA 제출"(날짜형 MM-DD, 1회성), "약속 목 병원" 또는 "약속 화아침 지원서 3곳"(요일형, 매주 반복 — 시간대 아침·점심·저녁·밤은 생략 가능). 둘 다 운동이 아닌 할 일이고, 언제 할지가 없으면 등록되지 않으며, 한 번에 5개까지. "했다 카제나"(약속 이행, 부분 문자열로 매칭), 그 외는 메모. 앞에 "어제 "를 붙이면 어제로 기록. 사용자가 컨디션·훈련·통증·술 같은 걸 한 줄로 말하면 이 툴로 저장한다.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: '예: 컨디션 4 3 2 3' } }, required: ['text'] } },
  { name: 'coach_week', description: '주간 코치 리뷰. week 에 날짜(YYYY-MM-DD)를 주면 그 날짜가 속한 과거 주를 다시 계산해 보여준다(지난 리뷰는 저장하지 않고 원본에서 다시 만든다). 지난주 계획 이행·세션·수면·자가평가·통증, 회복 지표가 30일 평균에서 벗어난 것, 지난주 제안을 지켰는지, 그리고 **다음 주에 바꿀 것 하나**를 낸다. 변경 후보는 서버가 규칙으로 고르므로 다른 제안을 지어내지 말고 그대로 전하라. 호출하면 그 제안이 기록으로 저장돼 다음 주에 이행 여부를 평가한다. 주간 회고 예약 작업에서 쓴다.',
    inputSchema: { type: 'object', properties: { week: { type: 'string', description: '과거 주를 볼 때 그 주의 아무 날짜 (YYYY-MM-DD)' } } } },
  { name: 'coach_history', description: '지금까지 코치가 낸 제안과 각각을 지켰는지. "예전에 뭐라고 했었지", "내가 제안을 잘 지키고 있나" 같은 질문에. 리뷰 본문은 저장하지 않지만 원본 데이터에서 언제든 다시 계산되므로, 특정 주를 다시 보려면 coach_week 에 week 를 넘긴다.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: '최근 몇 개 (기본 8)' } } } },
  { name: 'coach_month', description: '월간 코치 리뷰. 세션·종목 분포·수면, VO2max와 안정심박의 1년 대비 변화, 태그가 다음 날에 남긴 흔적(표본이 적으면 판단하지 않음), 진급 판정, 지난달 결정 되짚기, 그리고 **이번 달 결정 하나**. "계획 자체를 바꿔야 하나"에 답한다. 호출하면 그 결정이 기록으로 저장돼 다음 달에 되짚는다. month 에 날짜를 주면 그 달을 다시 계산한다(과거 달은 저장하지 않음). 서버가 고른 결정을 바꾸지 말 것.',
    inputSchema: { type: 'object', properties: { month: { type: 'string', description: '과거 달을 볼 때 그 달의 아무 날짜 (YYYY-MM-DD)' } } } },
  { name: 'health_insight', description: '9년치 기록에서 찾은 관계와 훈련 부하·체력 장기 추세. 표본 30 이상·효과크기 0.3 이상만 통과시킨 발견만 나온다. "내 몸에서 발견된 패턴 있어?", "훈련 부하 어때?", "체력 늘고 있어?" 같은 질문에. 결과 문장을 인과처럼 바꿔 쓰지 말 것.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'health_trend', description: '한 지표의 월별 추세(장기). metric: sleep(총수면 h), resting_hr, hrv, vo2max, steps, active_kcal, exercise_min, respiratory_rate, wrist_temp, spo2, workout(전 종목), running/수영/swimming/yoga(종목별 횟수·시간·거리·러닝 페이스·평균심박), pullups/턱걸이(총 개수·최대 세트). "체력 늘고 있어?", "러닝 페이스 빨라졌어?", "턱걸이 늘었어?" 같은 질문에.',
    inputSchema: { type: 'object', properties: { metric: { type: 'string' }, months: { type: 'number', description: '최근 몇 달 (기본 12)' } }, required: ['metric'] } },
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

  if (name === 'health_week') {
    const days = Math.min(Math.max(Number(args.days) || 7, 1), 60)
    const r = await gasGet<{ tabs?: Tabs }>('healthAll', `&days=${days + 31}`)  // 이전 30일 기준선 + 전날 밤 취침분
    const t = r.tabs ?? {}
    const since = new Date(Date.now() + 9 * 3600_000 - days * 86400_000).toISOString().slice(0, 10)
    const recent = (rows: HealthRow[] = []) => rows.filter((x) => x.start >= since)
    return ['[수면]', summarizeSleep(recent(t.sleep)), '', summarizeDaily(t, days), '', summarizeWorkouts(recent(t.workout)), '', summarizeManual(t.manual, since, t.workout, today())].join('\n')
  }

  if (name === 'health_today') {
    // api/today.ts(폰 알림)와 같은 창이어야 한다 — 두 일간 표면이 다른 days 를 쓰면
    // 75일보다 오래 산 요일형 약속이 한쪽에만 뜨는 불일치가 재발한다. 줄이지 말 것.
    const r = await gasGet<{ tabs?: Tabs }>('healthAll', '&days=400')
    const todayKey = today()
    return formatReadiness(readiness(r.tabs ?? {}, todayKey), todayKey, todayCommitments(r.tabs?.manual ?? [], todayKey))
  }

  if (name === 'health_log') {
    const { stamp, text } = logStamp(String(args.text || ''))
    const e = parseLog(text)
    if (e.kind === '약속') {
      const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
      const full = overCap(t.manual ?? [], stamp.slice(0, 10))
      if (full) return `약속은 한 번에 5개까지예요. 하나를 지우고 다시 넣어주세요.\n` +
        full.map((c) => `- ${c.trigger} ${c.task}`).join('\n')
    }
    const r = await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, e.kind, e.extra].join('|') }) as { added?: number; skipped?: number }
    return `${r.added ? '기록됨' : '이미 있음'}: ${stamp.slice(5, 16)} ${e.kind} — ${e.echo}`
  }

  if (name === 'coach_week') {
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
    const todayKey = today()
    const weekOf = typeof args.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.week) ? args.week : undefined
    const r = weekReview(t, todayKey, weekOf)
    // 이번 주 제안이 아직 없으면 저장한다(다음 주에 이행 여부를 잰다). 같은 주에 두 번 부르면 덮어쓰지 않는다.
    const thisMonday = mondayOf(todayKey)
    const already = !!weekOf || (t.manual ?? []).some((m) => m.value === '코치' && m.start.slice(0, 10) >= thisMonday)
    if (!already) {
      const stamp = `${todayKey} 09:00:00`
      await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, '코치', adviceToExtra('주간', r.advice)].join('|') })
    }
    return formatWeek(r) + (already ? '' : '\n\n(이 제안을 기록했어요. 다음 주 리뷰에서 지켰는지 확인해요.)')
  }

  if (name === 'coach_history') {
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
    return formatHistory(adviceHistory(t, today(), Math.min(Math.max(Number(args.limit) || 8, 1), 30)))
  }

  if (name === 'coach_month') {
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
    const todayKey = today()
    const anchor = typeof args.month === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.month) ? args.month : undefined
    const r = monthReview(t, todayKey, anchor)
    // 이번 달 결정이 아직 없으면 저장한다. 과거 달을 다시 볼 때는 저장하지 않는다.
    const thisMonth = monthOf(todayKey)
    const already = !!anchor || (t.manual ?? []).some((m) => m.value === '코치' && (m.extra || '').startsWith('월간|') && m.start.slice(0, 10) >= thisMonth)
    if (!already) {
      const stamp = `${todayKey} 09:00:00`
      await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, '코치', adviceToExtra('월간', r.decision)].join('|') })
    }
    return formatMonth(r) + (already ? '' : '\n\n(이 결정을 기록했어요. 다음 달 리뷰에서 되짚어요.)')
  }

  if (name === 'health_insight') {
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
    const todayKey = today()
    const rhr = [...(t.resting_hr ?? [])].slice(-90).map((r) => parseFloat(r.value)).filter((v) => v > 0)
    const daily = dailyLoad(t.workout, rhr.length ? Math.round(rhr.reduce((a, b) => a + b, 0) / rhr.length) : 60)
    const f = fitnessPayload(t, todayKey, daily)
    const found = insights(t, todayKey, daily)
    const load = `[훈련 부하] ${f.load.status} · 급성 ${f.load.acute} / 만성 ${f.load.chronic}` +
      (f.load.ratio != null ? ` (비율 ${f.load.ratio})` : '') + `\n${f.load.text}\n최근 12주: ${f.load.weeks.map((w) => w.load).join(' ')}`
    const fit = `[체력] VO2max ${f.vo2max.current ?? '-'} (최고 ${f.vo2max.best ?? '-'} ${f.vo2max.bestMonth ?? ''}, 12개월 ${f.vo2max.change12mo ?? '-'})` +
      ` · 안정심박 ${f.restingHr.current ?? '-'} (12개월 ${f.restingHr.change12mo ?? '-'})`
    const ins = found.length
      ? found.map((i) => `- [${i.strength}] ${i.title}\n  ${i.detail}\n  근거: ${i.evidence}`).join('\n')
      : '- 아직 문턱(표본 30, 효과크기 0.3)을 넘긴 관계가 없어요.'
    return [load, '', fit, '', '[발견]', ins].join('\n')
  }

  if (name === 'health_trend') {
    const metric = String(args.metric || '').toLowerCase().replace(/[^a-z0-9_가-힣]/g, '')
    const months = Math.min(Math.max(Number(args.months) || 12, 1), 120)
    const tab = ['running', '러닝', '달리기', 'swimming', '수영', 'yoga', '요가', 'walking', '걷기', 'cycling', '자전거'].includes(metric) ? 'workout'
      : ['pullups', '턱걸이'].includes(metric) ? 'manual' : metric
    const r = await gasGet<{ rows?: HealthRow[] }>('healthRows', `&type=${tab}&days=${months * 31}`)
    return summarizeTrend(metric, r.rows ?? [])
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
          instructions: '이 서버는 사용자의 가계부(구글시트)와 애플워치 건강 데이터를 담당한다. ' +
            '수면·취침·기상·잘 잤는지·컨디션·훈련량 질문은 반드시 health_week 툴로 답한다(노션 일기장을 뒤지지 말 것). 컨디션 점수·sRPE·턱걸이·통증·술/늦은식사 태그 같은 한 줄 기록은 health_log로 저장하고, 주간 리뷰에서는 컨디션 자가평가를 반드시 인용한다. ' +
            '지출·수입·분담금·고정비 질문과 "5000 스타벅스 하나카드" 같은 한 줄 입력은 ledger_* 툴을 쓴다. ' +
            '운동이 아닌 할 일은 "약속 09-13 카제나 제출"(1회성) 또는 "약속 화아침 지원서 3곳"(요일형, 매주 반복, 시간대는 생략 가능)처럼 언제 할지를 붙여 health_log 로 저장하고, 끝내면 "했다 카제나"로 닫는다. 트리거 없는 할 일은 등록되지 않는다. ' +
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
