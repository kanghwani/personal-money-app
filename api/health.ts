import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verify } from './_auth.js'
import { gasGet, gasPost } from './_gas.js'
import { dailyLoad, fitnessPayload, insights, nightSegments, stagesFrom } from './_analysis.js'
import { weekReview, monthReview, adviceHistory, adviceFromRow, mondayOf as coachMonday } from './_coach.js'
import { dailySeries, groupNights, meters, minutes, type HealthRow, type Tabs } from './_health.js'
import { logStamp, matchesLog, matchesWorkout, parseLog, SPORT } from './_log.js'
import { PLAN_LIBRARY, detailKey } from './_plan.js'
import { readiness, structuredReadiness } from './_readiness.js'

const DAY_MS = 86_400_000
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const KO: Record<string, string> = { swimming: '수영', running: '걷뛰', walking: '걷기', cycling: '자전거', hiking: '등산', yoga: '요가', coretraining: '코어', functionalstrengthtraining: '근력' }
const METRICS = {
  hrv: { label: 'HRV', unit: 'ms', betterWhen: 'high' },
  resting_hr: { label: '안정심박', unit: '', betterWhen: 'low' },
  active_kcal: { label: '활동', unit: 'kcal', betterWhen: 'high' },
  steps: { label: '걸음', unit: '', betterWhen: 'high' },
  respiratory_rate: { label: '호흡', unit: '/분', betterWhen: 'low' },
  wrist_temp: { label: '손목온도', unit: '°', betterWhen: 'low' },
} as const

const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)
const day = (r: HealthRow) => r.start.slice(0, 10)
const hhmm = (stamp: string) => stamp.slice(11, 16)
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) }
const rounded = (v: number, digits = 0) => Number(v.toFixed(digits))
const mondayOf = (d: string) => shift(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7))
const generatedAt = (now: number) => new Date(now + 9 * 3600_000).toISOString().slice(0, 19) + '+09:00'
const clock = (epochMin: number) => new Date(epochMin * 60000).toISOString().slice(11, 16)
const numeric = (s = '') => parseFloat(s.replace(/[^0-9.\-]/g, ''))

function workoutFromRow(w: HealthRow) {
  const [dur = '', kcal = '', dist = '', hr = ''] = (w.extra || '').split('|')
  const distanceM = Math.round(meters(dist, w.value) || 0)
  return {
    id: `${w.start.slice(0, 16)}|${w.value}`, date: day(w), start: hhmm(w.start), type: w.value,
    ko: KO[w.value.toLowerCase()] || w.value, minutes: Math.round(minutes(dur) || 0), distanceM,
    distanceText: distanceM ? (/swim/i.test(w.value) ? `${distanceM}m` : `${rounded(distanceM / 1000, 1)}km`) : '',
    kcal: Math.round(numeric(kcal) || 0), hr: Math.round(numeric(hr) || 0), rpe: null as number | null,
    note: null as string | null, loggedAt: null as string | null,
  }
}
type Workout = ReturnType<typeof workoutFromRow>

function sleepPayload(tabs: Tabs, today: string) {
  const all = groupNights(tabs.sleep ?? []).filter((n) => n.key <= today)
  const last = all[all.length - 1]
  const totals = (n: (typeof all)[number]) => n.core + n.rem + n.deep
  const baseRows = all.filter((n) => n.key < today && n.key >= shift(today, -60))
  const baseline = mean(baseRows.map(totals))
  const recentNights = all.filter((n) => n.key >= shift(today, -13)).slice(-14)
  const recent = recentNights.map((n) => ({ date: n.key, totalMin: Math.round(totals(n)), bed: clock(n.bed), wake: clock(n.wake), deepMin: Math.round(n.deep) }))
  const bedMinutes = recentNights.map((n) => { const [h, m] = clock(n.bed).split(':').map(Number); return h < 12 ? h * 60 + m + 1440 : h * 60 + m })
  const sorted = [...bedMinutes].sort((a, b) => a - b)
  const median = sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.ceil((sorted.length - 1) / 2)]) / 2 : NaN
  const last7 = all.filter((n) => n.key >= shift(today, -6)).map(totals)
  const medianClock = isNaN(median) ? null : (() => { const v = Math.round(median) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}` })()
  return {
    lastNight: last ? { date: last.key, bed: clock(last.bed), wake: clock(last.wake), totalMin: Math.round(totals(last)), deepMin: Math.round(last.deep), remMin: Math.round(last.rem), coreMin: Math.round(last.core), awakeMin: Math.round(last.awake), awakenings: last.awakenings, vsBaselineMin: isNaN(baseline) ? null : Math.round(totals(last) - baseline), baselineMin: isNaN(baseline) ? null : Math.round(baseline) } : null,
    recent, bedtimeMedian: medianClock, bedtimeSdMin: bedMinutes.length ? Math.round(sd(bedMinutes)) : null,
    debtMin: last7.length && !isNaN(baseline) ? Math.round(mean(last7) - baseline) : null,
  }
}

function metricsPayload(tabs: Tabs, today: string) {
  const out: Record<string, unknown> = {}
  for (const [key, meta] of Object.entries(METRICS)) {
    const points = [...dailySeries(tabs[key]).entries()].filter(([d]) => d >= shift(today, -29) && d <= today).sort().map(([date, v]) => ({ date, v }))
    if (!points.length) continue
    const vals = (n: number) => points.filter((p) => p.date >= shift(today, -(n - 1))).map((p) => p.v)
    const v7 = vals(7), v30 = vals(30), latest = points[points.length - 1]!
    const digits = key === 'wrist_temp' || key === 'respiratory_rate' ? 1 : 0
    out[key] = { ...meta, today: latest.date === today ? latest.v : null, avg7: v7.length ? rounded(mean(v7), digits) : null, avg30: rounded(mean(v30), digits), series: points }
  }
  return out
}

function attachLogs(workouts: Workout[], manual: HealthRow[]) {
  const logs = manual.filter((r) => r.value === 'sRPE').sort((a, b) => b.start.localeCompare(a.start))
  for (const w of workouts) {
    const log = logs.find((r) => { const [sport] = (r.extra || '').split('|'); const type = SPORT[sport]?.toLowerCase(); return day(r) === w.date && (type === w.type.toLowerCase() || sport === w.ko || (sport === '러닝' && w.ko === '걷뛰')) })
    if (log) { const [, , rpe, note = ''] = (log.extra || '').split('|'); w.rpe = +rpe || null; w.note = note || null; w.loggedAt = log.start.slice(0, 16) }
  }
  return workouts
}

function wellnessPayload(manual: HealthRow[], today: string) {
  const by = new Map<string, HealthRow>()
  manual.filter((r) => r.value === '컨디션' && day(r) >= shift(today, -29) && day(r) <= today).sort((a, b) => a.start.localeCompare(b.start)).forEach((r) => by.set(day(r), r))
  const parse = (r: HealthRow) => (r.extra || '').split('|').slice(0, 4).map(Number)
  const current = by.get(today)
  const recent = [...by.entries()].filter(([d]) => d !== today && d >= shift(today, -13)).sort().map(([date, r]) => ({ date, values: parse(r) }))
  const base = [...by.values()].map(parse).filter((v) => v.length === 4 && v.every(Number.isFinite))
  return { today: current ? { values: parse(current), at: hhmm(current.start) } : null, labels: ['수면질', '피로', '스트레스', '근육통'], recent, baseline: base.length >= 7 ? [0, 1, 2, 3].map((i) => ({ mean: rounded(mean(base.map((v) => v[i])), 1), sd: rounded(sd(base.map((v) => v[i])), 1) })) : null }
}

function manualPayload(manual: HealthRow[], today: string) {
  const recent = manual.filter((r) => day(r) >= shift(today, -13) && day(r) <= today)
  const tagBy = new Map<string, Set<string>>()
  for (const r of recent.filter((x) => x.value === '태그')) { const set = tagBy.get(day(r)) ?? new Set<string>(); (r.extra || '').split('|').filter(Boolean).forEach((x) => set.add(x)); tagBy.set(day(r), set) }
  const pullRows = manual.filter((r) => r.value === '턱걸이' && day(r) >= shift(today, -29) && day(r) <= today)
  const pulls = pullRows.map((r) => { const [variant = '', sets = '0', reps = ''] = (r.extra || '').split('|'); const list = reps.replace(/초/g, '').split(',').map(Number).filter((x) => x > 0); const total = list.length > 1 ? list.reduce((a, b) => a + b, 0) : (+sets || 0) * (list[0] || 0); return { date: day(r), variant, sets: +sets || 0, reps, total, max: list.length ? Math.max(...list) : 0 } }).sort((a, b) => b.date.localeCompare(a.date))
  const inbody = manual.filter((r) => r.value === '인바디').map((r) => { const [weight, smm, fat] = (r.extra || '').split('|').map(Number); return { date: day(r), weight, smm, fat } }).filter((x) => [x.weight, x.smm, x.fat].every(Number.isFinite)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)
  return {
    wellness: wellnessPayload(manual, today),
    tags: { today: [...(tagBy.get(today) ?? [])], recent: [...tagBy.entries()].filter(([d]) => d !== today).sort().map(([date, tags]) => ({ date, tags: [...tags] })) },
    notes: recent.filter((r) => r.value === '메모').map((r) => ({ date: day(r), time: hhmm(r.start), text: r.extra || '' })).sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)),
    pain: recent.filter((r) => r.value === '통증').map((r) => { const [site = '', level = '0', note = ''] = (r.extra || '').split('|'); return { date: day(r), site, level: +level, note } }).sort((a, b) => b.date.localeCompare(a.date)),
    pullups: { recent: pulls.map(({ max: _max, ...p }) => p), monthTotal: pulls.filter((p) => p.date.slice(0, 7) === today.slice(0, 7)).reduce((s, p) => s + p.total, 0), maxSet: pulls.reduce((m, p) => Math.max(m, p.max), 0) }, inbody,
  }
}

function planPayload(manual: HealthRow[], workoutRows: HealthRow[], today: string) {
  const config = new Map<string, string[]>(), planRows = manual.filter((r) => r.value === '계획').sort((a, b) => a.start.localeCompare(b.start))
  for (const r of planRows) { const [wd = '', csv = ''] = (r.extra || '').split('|'); config.set(wd, csv.split(',').filter(Boolean)) }
  const makeWeek = (monday: string, through = shift(monday, 6)) => {
    let planned = 0, done = 0
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = shift(monday, i), wd = DAYS[new Date(`${date}T00:00:00Z`).getUTCDay()]
      const items = (config.get(wd) ?? []).map((name) => {
        const rest = name === '휴식'; if (!rest) planned++
        const watch = !rest && workoutRows.some((w) => day(w) === date && matchesWorkout(name, w.value))
        const logged = !rest && ((name === '턱걸이' && manual.some((r) => day(r) === date && r.value === '턱걸이')) || manual.some((r) => day(r) === date && r.value === 'sRPE' && matchesLog(name, (r.extra || '').split('|')[0])))
        const hit = date <= through && (watch || logged); if (hit) done++
        return { name, rest, done: hit, doneBy: watch ? 'watch' as const : logged ? 'log' as const : null, detailKey: detailKey(name) }
      })
      return { date, wd, isToday: date === today, isPast: date < today, items }
    })
    return { week, planned, done }
  }
  const current = makeWeek(mondayOf(today), today), adherenceStart = shift(mondayOf(today), -28)
  let histPlanned = 0, histDone = 0
  for (let w = adherenceStart; w < mondayOf(today); w = shift(w, 7)) { const x = makeWeek(w); histPlanned += x.planned; histDone += x.done }
  const hasHistory = !!planRows.length && day(planRows[0]) <= adherenceStart
  return { ...current, adherence4w: hasHistory && histPlanned ? rounded(histDone / histPlanned, 2) : null, library: PLAN_LIBRARY }
}

function trendsPayload(workoutRows: HealthRow[], manual: HealthRow[], today: string) {
  const monthStart = shift(today, -183)
  const aggregate = (type: string) => {
    const by = new Map<string, { sessions: number; minutes: number; distanceM: number; hrs: number[] }>()
    for (const row of workoutRows.filter((r) => r.value.toLowerCase() === type.toLowerCase() && day(r) >= monthStart && day(r) <= today)) { const w = workoutFromRow(row), month = w.date.slice(0, 7), cur = by.get(month) ?? { sessions: 0, minutes: 0, distanceM: 0, hrs: [] }; cur.sessions++; cur.minutes += w.minutes; cur.distanceM += w.distanceM; if (w.hr) cur.hrs.push(w.hr); by.set(month, cur) }
    return [...by.entries()].sort().map(([month, v]) => ({ month, sessions: v.sessions, minutes: v.minutes, distanceM: v.distanceM, ...(type === 'Running' ? { paceSecPerKm: v.distanceM ? Math.round(v.minutes * 60 / (v.distanceM / 1000)) : null } : {}), hr: v.hrs.length ? Math.round(mean(v.hrs)) : null }))
  }
  const firstWeek = shift(mondayOf(today), -49)
  const load = Array.from({ length: 8 }, (_, i) => { const week = shift(firstWeek, i * 7), end = shift(week, 6); const rows = manual.filter((r) => r.value === 'sRPE' && day(r) >= week && day(r) <= end); return { week, srpe: rows.reduce((s, r) => { const [, min = '0', rpe = '0'] = (r.extra || '').split('|'); return s + (+min || 0) * (+rpe || 0) }, 0), sessions: rows.length } })
  return { swimming: aggregate('Swimming'), running: aggregate('Running'), load }
}

function alertsPayload(tabs: Tabs, ready: ReturnType<typeof readiness>, today: string) {
  const manual = tabs.manual ?? [], alerts: { level: 'warn' | 'bad'; text: string; key: string }[] = [], monday = mondayOf(today)
  const weekLoad = (start: string) => manual.filter((r) => r.value === 'sRPE' && day(r) >= start && day(r) <= shift(start, 6)).reduce((s, r) => { const [, min = '0', rpe = '0'] = (r.extra || '').split('|'); return s + (+min || 0) * (+rpe || 0) }, 0)
  const current = weekLoad(monday), previousAvg = mean([1, 2, 3, 4].map((n) => weekLoad(shift(monday, -7 * n))))
  if (previousAvg > 0 && current >= previousAvg * 1.3) alerts.push({ level: 'warn', text: `이번 주 훈련 부하가 이전 4주 평균보다 ${Math.round((current / previousAvg - 1) * 100)}% 높아요`, key: 'load_spike' })
  const runs = (tabs.workout ?? []).filter((r) => r.value.toLowerCase() === 'running' && day(r) <= today).sort((a, b) => b.start.localeCompare(a.start)), latest = runs[0]
  if (latest) { const latestM = workoutFromRow(latest).distanceM, prior = runs.slice(1).filter((r) => day(r) >= shift(day(latest), -30)).map((r) => workoutFromRow(r).distanceM).filter((v) => v > 0), longest = prior.length ? Math.max(...prior) : 0; if (longest > 0 && latestM >= longest * 1.1) alerts.push({ level: 'warn', text: `최근 러닝 ${rounded(latestM / 1000, 1)}km는 최근 30일 최장보다 ${Math.round((latestM / longest - 1) * 100)}% 길어요`, key: 'run_spike' }) }
  const pain = manual.filter((r) => r.value === '통증' && day(r) >= shift(today, -2) && day(r) <= today).map((r) => ({ r, level: +(r.extra || '').split('|')[1] || 0 })).filter((x) => x.level >= 3).sort((a, b) => b.r.start.localeCompare(a.r.start))[0]
  if (pain) { const [site] = (pain.r.extra || '').split('|'); alerts.push({ level: 'bad', text: `최근 3일 안에 ${site} 통증 ${pain.level}/10 기록이 있어요`, key: 'pain' }) }
  if (ready.illness) alerts.push({ level: 'bad', text: '체온과 심박 또는 호흡이 함께 올라 질병 가능성 신호가 있어요', key: 'illness' })
  return alerts
}

/** GAS tabs만으로 계약 응답을 만드는 순수 함수. */
/**
 * 화면용 주간 코치 요약. **여기서는 제안을 저장하지 않는다** — 화면을 여는 것만으로 기록이 생기면 안 된다.
 * 이번 주에 이미 저장된 제안이 있으면 그것을 보여주고(committed), 없으면 계산된 제안을 미리 보여준다.
 */
function coachPayload(tabs: Tabs, today: string) {
  const r = weekReview(tabs, today)
  const thisMonday = coachMonday(today)
  const saved = (tabs.manual ?? []).filter((m) => m.value === '코치' && m.start.slice(0, 10) >= thisMonday).pop()
  const committed = saved ? adviceFromRow(saved) : null
  const hist = adviceHistory(tabs, today, 5)
  const judged = hist.filter((h) => h.result.met !== null)
  const f = r.facts
  return {
    week: r.week,
    facts: {
      planned: f.planned, done: f.done, sessions: f.sessions, srpe: f.srpe,
      sleepMean: f.sleepMean, nights: f.nights, wellnessDays: f.wellnessDays,
      missed: f.missed.slice(0, 4), pain: f.pain,
    },
    load: { status: r.load.status, ratio: r.load.status === '데이터부족' ? null : r.load.ratio },
    drift: r.drift,
    advice: { key: committed?.key ?? r.advice.key, text: committed?.text ?? r.advice.text, why: r.advice.why, committed: !!committed },
    review: r.review ? { text: r.review.text, met: r.review.met } : null,
    history: {
      kept: judged.filter((h) => h.result.met === true).length, judged: judged.length,
      recent: hist.map((h) => ({ date: h.date, text: h.text, met: h.result.met })),
    },
    month: (() => {
      const m = monthReview(tabs, today)
      return { sessions: m.sessions, vo2Change: m.vo2Change, rhrChange: m.rhrChange, promotions: m.promotions.length, decision: m.decision.text }
    })(),
  }
}

export function buildHealthResponse(tabs: Tabs, today: string, now = Date.now()) {
  const manual = tabs.manual ?? [], workoutRows = tabs.workout ?? []
  const workouts = attachLogs(workoutRows.filter((w) => day(w) >= shift(today, -13) && day(w) <= today).map(workoutFromRow).sort((a, b) => `${b.date} ${b.start}`.localeCompare(`${a.date} ${a.start}`)), manual)
  const ready = readiness(tabs, today), manualParts = manualPayload(manual, today)
  const sleepBase = sleepPayload(tabs, today)
  const sleep = { ...sleepBase, segments: sleepBase.lastNight ? nightSegments(tabs.sleep, sleepBase.lastNight.date) : [], stagesFrom: stagesFrom(tabs.sleep) }
  // 부하는 개인 안정심박을 기준으로 계산한다(최근 90일 평균)
  const rhrRecent = [...dailySeries(tabs.resting_hr)].filter(([d]) => d >= shift(today, -90)).map(([, v]) => v)
  const restHr = rhrRecent.length ? Math.round(rhrRecent.reduce((a, b) => a + b, 0) / rhrRecent.length) : 60
  const daily = dailyLoad(workoutRows, restHr)
  const allRows = Object.values(tabs).flat()
  const newest = (xs: string[]) => { const s = xs.filter(Boolean).sort(); return s.length ? s[s.length - 1] : undefined }
  const lastUpload = newest(allRows.map((r) => r.start)), lastWorkout = newest(workoutRows.map((r) => r.start))
  const sleepToday = sleep.lastNight?.date === today, workedToday = workoutRows.some((r) => day(r) === today)
  return {
    ok: true as const, today, generatedAt: generatedAt(now),
    staleness: { lastUploadAt: lastUpload?.slice(0, 16) ?? null, sleepToday, workoutSince: lastWorkout?.slice(0, 16) ?? null, hint: !sleepToday ? '어젯밤 수면이 아직 안 올라왔어요' : !workedToday ? '오늘 운동이 아직 안 올라왔어요' : null },
    readiness: structuredReadiness(ready), sleep, metrics: metricsPayload(tabs, today), workouts, ...manualParts,
    plan: planPayload(manual, workoutRows, today), trends: trendsPayload(workoutRows, manual, today), alerts: alertsPayload(tabs, ready, today),
    fitness: fitnessPayload(tabs, today, daily), insights: insights(tabs, today, daily),
    coach: coachPayload(tabs, today),
  }
}

async function saveManual(stamp: string, entry: ReturnType<typeof parseLog>) {
  const result = await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, entry.kind, entry.extra].join('|') }) as { added?: number | boolean }
  // 캐시를 버리면 저장 직후의 화면 갱신이 9년치를 다시 받느라 10초 넘게 멈춘다.
  // GAS 도 시트 끝에 붙이므로, 방금 쓴 행 하나만 같은 자리에 붙이면 다시 받은 것과 결과가 같다.
  if (result.added && tabsCache) tabsCache.tabs.manual = [...(tabsCache.tabs.manual ?? []), { start: stamp, end: stamp, value: entry.kind, extra: entry.extra }]
  return !!result.added
}

/**
 * GAS 호출은 창 크기와 무관하게 10초 넘게 걸린다(시작 오버헤드가 병목).
 * 그래서 9년치를 한 번에 받고, 따뜻한 인스턴스에서는 5분간 재사용한다. 저장 뒤에는 버린다.
 */
let tabsCache: { at: number; tabs: Tabs } | null = null
async function loadTabs(): Promise<Tabs> {
  if (tabsCache && Date.now() - tabsCache.at < 5 * 60_000) return tabsCache.tabs
  const tabs = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
  tabsCache = { at: Date.now(), tabs }
  return tabs
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!verify(req.headers.cookie, process.env.APP_SECRET || '')) return res.status(401).json({ ok: false, error: 'unauthorized' })
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') as Record<string, unknown> : (req.body ?? {}) as Record<string, unknown>
      if (body.action === 'plan') {
        const dayName = String(body.day || ''), items = Array.isArray(body.items) ? body.items.map(String).map((x) => x.trim()).filter(Boolean) : []
        const { stamp } = logStamp(''), entry = parseLog(`계획 ${dayName} ${items.join(' ')}`); await saveManual(stamp, entry)
        return res.status(200).json({ ok: true, echo: entry.echo })
      }
      if (body.action === 'workout_log') {
        const id = String(body.id || ''), rpe = Number(body.rpe), note = String(body.note || '').trim()
        if (!id || !Number.isInteger(rpe) || rpe < 1 || rpe > 10) throw new Error('운동과 RPE 1~10을 확인해 주세요')
        const tabs = await loadTabs(), row = (tabs.workout ?? []).find((w) => `${w.start.slice(0, 16)}|${w.value}` === id)
        if (!row) throw new Error('해당 운동 세션을 찾지 못했어요. 워치에서 다시 가져와 주세요')
        const w = workoutFromRow(row), entry = parseLog(`sRPE ${w.ko} ${w.minutes} ${rpe}${note ? ` ${note}` : ''}`); await saveManual(row.start, entry)
        return res.status(200).json({ ok: true, echo: entry.echo })
      }
      if (body.action) throw new Error('지원하지 않는 저장 요청이에요')
      const { stamp, text } = logStamp(String(body.text || '')), entry = parseLog(text), added = await saveManual(stamp, entry)
      return res.status(200).json({ ok: true, added, kind: entry.kind, echo: entry.echo })
    }
    if (req.method !== 'GET') throw new Error('GET 또는 POST 요청만 지원해요')
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), tabs = await loadTabs()
    return res.status(200).json(buildHealthResponse(tabs, today))
  } catch (err) {
    return res.status(200).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
