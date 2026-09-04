/**
 * 9년치 이력 분석. 가민·애플이 못 주는 것 세 가지를 담당한다.
 *   1) 훈련 부하 (세션 시간 x 평균심박 → TRIMP, 급성/만성 비율)
 *   2) 체력 장기 추세 (VO2max, 안정심박)
 *   3) 상관 발견 (표본·효과크기 문턱을 넘긴 것만)
 *
 * 정직성 규칙: 표본 30 미만이면 버린다. |d| < 0.3 이거나 |r| < 0.2 면 버린다.
 * 문구는 "관련이 있다"이고 "때문이다"라고 쓰지 않는다. 근거에 표본 수와 효과크기를 반드시 넣는다.
 * 실제로 검증했다가 버린 것: 취침 시각과 안정심박(문헌과 반대 방향, r=-0.19), 총수면과 다음날 HRV(r=-0.09).
 */
import { dailySeries, minutes as toMinutes, type HealthRow, type Tabs } from './_health.js'

// ── 작은 통계 도구 ─────────────────────────────────────────
const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN
const pstdev = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((v) => (v - m) ** 2))) }
/** Cohen's d. 두 집단 평균 차이를 합동 표준편차로 나눈 값. 0.3 이상이면 볼 만하다. */
const cohensD = (a: number[], b: number[]) => {
  const s = Math.sqrt((pstdev(a) ** 2 + pstdev(b) ** 2) / 2)
  return s ? (mean(a) - mean(b)) / s : 0
}
const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const nextDay = (d: string) => shift(d, 1)
const round = (v: number, n = 1) => Math.round(v * 10 ** n) / 10 ** n

// ── 밤 단위 수면 (예전 '침대에 있음'만 있던 밤도 살린다) ────
export type NightRow = {
  key: string; totalMin: number; hasStages: boolean
  core: number; deep: number; rem: number; awake: number
  bed: string; wake: string; awakenings: number
}
const STAGE: Record<string, 'core' | 'deep' | 'rem' | 'awake'> = {
  '코어 수면': 'core', '깊은 수면': 'deep', 'REM 수면': 'rem', '깨어 있는 시간': 'awake',
  Core: 'core', Deep: 'deep', REM: 'rem', Awake: 'awake',
}
const IN_BED = new Set(['침대에 있음', '수면', 'InBed', 'Asleep'])
const toMin = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(s)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000 : NaN
}
const dayOf = (min: number) => new Date(min * 60000).toISOString().slice(0, 10)
const hhmm = (min: number) => new Date(min * 60000).toISOString().slice(11, 16)

/** 정오~정오를 한 밤으로 묶고 기상일을 키로 쓴다. 단계가 없는 밤은 '침대에 있음' 길이를 총수면으로 본다. */
export function nightRows(sleep: HealthRow[] = []): NightRow[] {
  const by = new Map<string, NightRow & { bedMin: number; wakeMin: number; inBed: number }>()
  for (const r of sleep) {
    const s = toMin(r.start), e = toMin(r.end)
    if (isNaN(s) || isNaN(e) || e <= s) continue
    const stage = STAGE[r.value]
    const inBed = !stage && IN_BED.has(r.value)
    if (!stage && !inBed) continue
    const key = dayOf(s + 12 * 60)
    const n = by.get(key) ?? { key, totalMin: 0, hasStages: false, core: 0, deep: 0, rem: 0, awake: 0, bed: '', wake: '', awakenings: 0, bedMin: s, wakeMin: e, inBed: 0 }
    if (stage) { n[stage] += e - s; n.hasStages = true; if (stage === 'awake') n.awakenings++ }
    else n.inBed += e - s
    n.bedMin = Math.min(n.bedMin, s); n.wakeMin = Math.max(n.wakeMin, e)
    by.set(key, n)
  }
  return [...by.values()].map((n) => ({
    key: n.key, hasStages: n.hasStages,
    totalMin: n.hasStages ? n.core + n.deep + n.rem : n.inBed,
    core: n.core, deep: n.deep, rem: n.rem, awake: n.awake, awakenings: n.awakenings,
    bed: hhmm(n.bedMin), wake: hhmm(n.wakeMin),
  })).filter((n) => n.totalMin > 0).sort((a, b) => (a.key < b.key ? -1 : 1))
}

/** 어젯밤 수면 단계 구간(hypnogram). 단계 기록이 없는 밤이면 빈 배열. */
export function nightSegments(sleep: HealthRow[] = [], key: string) {
  return sleep
    .filter((r) => STAGE[r.value] && dayOf(toMin(r.start) + 12 * 60) === key)
    .map((r) => ({ start: hhmm(toMin(r.start)), end: hhmm(toMin(r.end)), stage: STAGE[r.value], min: Math.round(toMin(r.end) - toMin(r.start)) }))
    .filter((s) => s.min > 0)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
}

/** 단계 기록이 자리잡은 첫 달의 1일. 초기의 산발적 몇 건은 무시한다(그 이전 밤은 총수면만 있다). */
export function stagesFrom(sleep: HealthRow[] = []): string | null {
  const byMonth = new Map<string, Set<string>>()
  for (const r of sleep) {
    if (!STAGE[r.value]) continue
    const m = r.start.slice(0, 7)
    if (!byMonth.has(m)) byMonth.set(m, new Set())
    byMonth.get(m)!.add(r.start.slice(0, 10))
  }
  const settled = [...byMonth.entries()].filter(([, days]) => days.size >= 10).map(([m]) => m).sort()[0]
  return settled ? settled + '-01' : null
}

// ── 훈련 부하 (TRIMP) ──────────────────────────────────────
/** 평균심박이 없는 세션(9년 중 절반)을 위한 종목별 기본 강도. */
const SPORT_FRAC: Record<string, number> = {
  Swimming: .72, Running: .78, Cycling: .68, Hiking: .60, Walking: .45, Yoga: .40,
  CoreTraining: .55, FunctionalStrengthTraining: .55, CrossTraining: .70, HighIntensityIntervalTraining: .85,
}
const num = (s: string) => { const v = parseFloat(String(s).replace(/[^0-9.\-]/g, '')); return isNaN(v) ? 0 : v }

/**
 * 하루 부하. Banister TRIMP: 분 x 심박예비율 x 0.64 x e^(1.92 x 심박예비율).
 * 절대값에 의미는 없다. 같은 사람의 이력끼리만 비교한다.
 */
export function dailyLoad(workouts: HealthRow[] = [], restingHr = 60): Map<string, { load: number; sessions: number }> {
  const avgHrs = workouts.map((w) => num((w.extra || '').split('|')[3])).filter((v) => v > 0)
  // 개인 상한: 관측된 최고 평균심박 + 15 (170~200으로 제한). 개인 척도라 이 근사로 충분하다.
  const hrMax = Math.min(200, Math.max(170, (avgHrs.length ? Math.max(...avgHrs) : 170) + 15))
  const out = new Map<string, { load: number; sessions: number }>()
  for (const w of workouts) {
    const [durS = '', , , hrS = ''] = (w.extra || '').split('|')
    const minutes = toMinutes(durS) || 0
    if (minutes <= 0) continue
    const hr = num(hrS)
    const frac = Math.min(1, Math.max(.2, hr > 0 ? (hr - restingHr) / (hrMax - restingHr) : (SPORT_FRAC[w.value] ?? .6)))
    const d = w.start.slice(0, 10)
    const cur = out.get(d) ?? { load: 0, sessions: 0 }
    cur.load += minutes * frac * 0.64 * Math.exp(1.92 * frac)
    cur.sessions++
    out.set(d, cur)
  }
  return out
}

export type LoadStatus = '증가' | '유지' | '감소' | '과부하' | '회복중' | '데이터부족'

export function loadSummary(daily: Map<string, { load: number; sessions: number }>, today: string, weeks = 12) {
  const sum = (from: string, days: number) => {
    let load = 0, sessions = 0
    for (let i = 0; i < days; i++) { const v = daily.get(shift(from, -i)); if (v) { load += v.load; sessions += v.sessions } }
    return { load, sessions }
  }
  const acuteRaw = sum(today, 7), chronicRaw = sum(today, 28)
  const acute = Math.round(acuteRaw.load), chronic = Math.round(chronicRaw.load / 4)
  const ratio = chronic > 0 ? round(acuteRaw.load / (chronicRaw.load / 4), 2) : null
  // 주 시작(월요일)로 묶은 최근 12주
  const dow = new Date(today + 'T00:00:00Z').getUTCDay()
  const thisMonday = shift(today, -((dow + 6) % 7))
  const weekRows = Array.from({ length: weeks }, (_, i) => {
    const start = shift(thisMonday, -(weeks - 1 - i) * 7)
    const w = sum(shift(start, 6), 7)
    return { week: start, load: Math.round(w.load), sessions: w.sessions }
  })
  let status: LoadStatus = '데이터부족'
  let text = `최근 4주 세션이 ${chronicRaw.sessions}회뿐이라 부하 흐름을 판단하기 일러요.`
  if (chronicRaw.sessions >= 4 && ratio != null) {
    if (ratio > 1.5) { status = '과부하'; text = `최근 7일 부하가 4주 평균의 ${ratio}배예요. 이번 주는 늘리지 않는 게 좋아요.` }
    else if (ratio > 1.3) { status = '증가'; text = `부하를 올리는 중이에요. 4주 평균의 ${ratio}배까지가 안전한 범위예요.` }
    else if (ratio >= 0.8) { status = '유지'; text = '지난 4주와 비슷한 부하를 지키고 있어요.' }
    else if (ratio >= 0.5) { status = '감소'; text = '부하가 줄었어요. 회복 주간이면 정상이에요.' }
    else { status = '회복중'; text = '최근 일주일 운동이 거의 없어요. 다시 시작할 때는 이전 수준부터.' }
  }
  return { weeks: weekRows, acute, chronic, ratio, status, text }
}

// ── 체력 (VO2max, 안정심박 장기) ───────────────────────────
const monthly = (s: Map<string, number>, months: number, today: string) => {
  const from = today.slice(0, 7) + '-01'
  const since = shift(from, -months * 31).slice(0, 7)
  const by = new Map<string, number[]>()
  for (const [d, v] of s) { const m = d.slice(0, 7); if (m >= since) by.set(m, [...(by.get(m) ?? []), v]) }
  return [...by.entries()].sort().map(([month, vs]) => ({ month, v: round(mean(vs), 1) }))
}

export function fitnessPayload(tabs: Tabs, today: string, daily: Map<string, { load: number; sessions: number }>) {
  const vo2 = dailySeries(tabs.vo2max)
  const rhr = dailySeries(tabs.resting_hr)
  const vSeries = monthly(vo2, 18, today), rSeries = monthly(rhr, 18, today)
  const yearAgo = shift(today, -365)
  const pick = (s: Map<string, number>, from: string, to: string) => [...s].filter(([d]) => d >= from && d <= to).map(([, v]) => v)
  const vNow = pick(vo2, shift(today, -90), today), vThen = pick(vo2, shift(yearAgo, -90), yearAgo)
  const rNow = pick(rhr, shift(today, -30), today), rThen = pick(rhr, shift(yearAgo, -30), yearAgo)
  const all = [...vo2.entries()].sort()
  let best = { v: -1, month: '' }
  for (const [m, v] of monthly(vo2, 400, today).map((x) => [x.month, x.v] as const)) if (v > best.v) best = { v, month: m }
  return {
    vo2max: {
      current: all.length ? round(all[all.length - 1][1], 1) : null,
      best: best.v > 0 ? best.v : null, bestMonth: best.month || null,
      change12mo: vNow.length && vThen.length ? round(mean(vNow) - mean(vThen), 1) : null,
      series: vSeries,
    },
    restingHr: {
      current: rNow.length ? Math.round(rNow[rNow.length - 1]) : null,
      change12mo: rNow.length && rThen.length ? round(mean(rNow) - mean(rThen), 1) : null,
      series: rSeries,
    },
    load: loadSummary(daily, today),
  }
}

// ── 발견 (상관 분석) ───────────────────────────────────────
export type Insight = { id: string; title: string; detail: string; evidence: string; strength: '약함' | '중간' | '뚜렷함'; tone: 'good' | 'neutral' | 'warn'; n: number }
const MIN_N = 30, MIN_D = 0.3
const strengthOf = (d: number): Insight['strength'] => Math.abs(d) >= 0.5 ? '뚜렷함' : Math.abs(d) >= 0.4 ? '중간' : '약함'

/** 전날 조건이 참인 날 vs 아닌 날의 지표 비교. 문턱을 못 넘으면 null. */
function splitByPrevDay(metric: Map<string, number>, isTrue: (day: string) => boolean) {
  const on: number[] = [], off: number[] = []
  for (const [d, v] of metric) (isTrue(shift(d, -1)) ? on : off).push(v)
  if (on.length < MIN_N || off.length < MIN_N) return null
  const d = cohensD(on, off)
  return Math.abs(d) < MIN_D ? null : { on, off, d, diff: mean(on) - mean(off) }
}

export function insights(tabs: Tabs, today: string, daily: Map<string, { load: number; sessions: number }>): Insight[] {
  const out: Insight[] = []
  const hrv = dailySeries(tabs.hrv), rhr = dailySeries(tabs.resting_hr)
  const nights = nightRows(tabs.sleep)
  const worked = (d: string) => (daily.get(d)?.load ?? 0) > 0

  // 1) 운동한 다음 날 회복 지표
  const h = splitByPrevDay(hrv, worked), r = splitByPrevDay(rhr, worked)
  if (h && h.d > 0) {
    const rhrPart = r && r.d < 0 ? ` 안정심박은 ${round(Math.abs(r.diff), 1)} 낮았어요.` : ''
    out.push({
      id: 'workout_recovery', title: '운동한 다음 날 회복 지표가 더 좋아요',
      detail: `운동한 다음 날 HRV 평균 ${round(mean(h.on), 1)}ms, 안 한 날 ${round(mean(h.off), 1)}ms.${rhrPart}`,
      evidence: `${h.on.length + h.off.length}일 기준(운동 다음날 ${h.on.length}일 대 ${h.off.length}일), 효과크기 ${round(h.d, 2)}. 관련성이며 인과는 아니에요.`,
      strength: strengthOf(h.d), tone: 'good', n: h.on.length + h.off.length,
    })
  }

  // 2) 고부하 다음 날 심박
  const loads = [...daily.values()].map((v) => v.load).sort((a, b) => a - b)
  if (loads.length >= 40) {
    const p75 = loads[Math.floor(loads.length * 0.75)]
    const hard = splitByPrevDay(rhr, (d) => (daily.get(d)?.load ?? 0) >= p75)
    if (hard && hard.d > 0.3) out.push({
      id: 'hard_day_rhr', title: '강한 세션 다음 날은 심박이 올라가요',
      detail: `상위 25% 부하 다음 날 안정심박 ${round(mean(hard.on), 1)}, 그 외 ${round(mean(hard.off), 1)}.`,
      evidence: `${hard.on.length}일 대 ${hard.off.length}일 비교, 효과크기 ${round(hard.d, 2)}. 회복이 하루 더 필요하다는 신호예요.`,
      strength: strengthOf(hard.d), tone: 'warn', n: hard.on.length + hard.off.length,
    })
  }

  // 3) 요일별 수면 편차
  // 침대에 있던 시간만 아는 예전 밤과 단계까지 아는 최근 밤은 측정이 달라 섞지 않는다
  const staged = nights.filter((n) => n.hasStages)
  const byDow = new Map<number, number[]>()
  for (const n of staged) { const w = new Date(n.key + 'T00:00:00Z').getUTCDay(); byDow.set(w, [...(byDow.get(w) ?? []), n.totalMin]) }
  const dows = [...byDow.entries()].filter(([, v]) => v.length >= 10).map(([w, v]) => ({ w, m: mean(v), n: v.length }))
  if (dows.length >= 5) {
    const hi = dows.reduce((a, b) => (b.m > a.m ? b : a)), lo = dows.reduce((a, b) => (b.m < a.m ? b : a))
    const names = ['일', '월', '화', '수', '목', '금', '토']
    if (hi.m - lo.m >= 45) out.push({
      id: 'weekday_sleep', title: `${names[lo.w]}요일 밤에 가장 적게 자요`,
      detail: `${names[hi.w]}요일 평균 ${round(hi.m / 60, 1)}시간, ${names[lo.w]}요일 ${round(lo.m / 60, 1)}시간. ${Math.round(hi.m - lo.m)}분 차이예요.`,
      evidence: `단계 기록이 있는 ${staged.length}일 기준. 요일별 표본 ${lo.n}일과 ${hi.n}일.`,
      strength: hi.m - lo.m >= 75 ? '뚜렷함' : '중간', tone: 'warn', n: staged.length,
    })
  }

  // 4) 태그가 붙은 다음 날 HRV (기록이 쌓이면 자동으로 등장)
  const tagDays = new Map<string, Set<string>>()
  for (const m of tabs.manual ?? []) {
    if (m.value !== '태그') continue
    for (const t of (m.extra || '').split('|').filter(Boolean)) {
      if (!tagDays.has(t)) tagDays.set(t, new Set())
      tagDays.get(t)!.add(m.start.slice(0, 10))
    }
  }
  for (const [tag, days] of tagDays) {
    const cmp = splitByPrevDay(hrv, (d) => days.has(d))
    if (!cmp || cmp.d >= 0) continue
    out.push({
      id: `tag_${tag}`, title: `'${tag}' 다음 날 회복 신호가 낮아요`,
      detail: `${tag} 기록이 있는 다음 날 HRV ${round(mean(cmp.on), 1)}ms, 그 외 ${round(mean(cmp.off), 1)}ms.`,
      evidence: `${cmp.on.length}일 대 ${cmp.off.length}일 비교, 효과크기 ${round(cmp.d, 2)}.`,
      strength: strengthOf(cmp.d), tone: 'warn', n: cmp.on.length + cmp.off.length,
    })
  }

  // 5) VO2max 12개월 변화
  const vo2 = dailySeries(tabs.vo2max)
  const nowV = [...vo2].filter(([d]) => d >= shift(today, -90)).map(([, v]) => v)
  const thenV = [...vo2].filter(([d]) => d >= shift(today, -455) && d <= shift(today, -365)).map(([, v]) => v)
  if (nowV.length >= 5 && thenV.length >= 5) {
    const diff = mean(nowV) - mean(thenV)
    if (Math.abs(diff) >= 1) out.push({
      id: 'vo2_trend', title: diff > 0 ? '심폐 체력이 1년 전보다 올라왔어요' : '심폐 체력이 1년 전보다 내려왔어요',
      detail: `최근 3개월 VO2max 평균 ${round(mean(nowV), 1)}, 1년 전 같은 시기 ${round(mean(thenV), 1)}.`,
      evidence: `측정 ${nowV.length}회와 ${thenV.length}회 비교. 워치 추정값이라 절대 수치보다 방향을 보세요.`,
      strength: Math.abs(diff) >= 2 ? '뚜렷함' : '중간', tone: diff > 0 ? 'good' : 'warn', n: nowV.length + thenV.length,
    })
  }

  const rank = { 뚜렷함: 0, 중간: 1, 약함: 2 }
  return out.sort((a, b) => rank[a.strength] - rank[b.strength]).slice(0, 5)
}
