/**
 * 코칭 루프. 대시보드와 코치의 차이는 "제안을 기억하고 결과를 되짚는가"다.
 *
 *   제안 저장(코치 행) → 다음 주 이행·결과를 서버가 계산 → 다음 제안 조정
 *
 * 제안 문장은 AI가 다듬지만 **판정은 전부 여기서 결정론적으로 한다**. 선택지를 좁혀두면
 * 그럴듯한 인과를 지어낼 여지가 없다.
 */
import { dailySeries, type HealthRow, type Tabs } from './_health.js'
import { nightRows, dailyLoad, loadSummary } from './_analysis.js'
import { planWeek, commitmentWeek, activeCommitments, CAP } from './_log.js'

const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN
const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)
const round = (v: number, n = 1) => Math.round(v * 10 ** n) / 10 ** n
const day = (r: HealthRow) => r.start.slice(0, 10)
/** 그 주의 월요일 */
export const mondayOf = (d: string) => shift(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7))

// ── 제안 ───────────────────────────────────────────────────
/** 서버가 고를 수 있는 변경은 이 여섯 가지뿐이다. 매주 하나만 고른다. */
export type ChangeKey = 'hold' | 'adherence' | 'deload' | 'lower_intensity' | 'bedtime' | 'add_session' | 'promote'
  | 'deadline' | 'backlog' | 'overflow' | 'stale' | 'life_hold'
export type Advice = { key: ChangeKey; text: string; metric: MetricKey; target: number; why: string }
/** 이행을 서버가 잴 수 있는 지표만 쓴다. */
export type MetricKey = 'bedtime' | 'sleep' | 'sessions' | 'load' | 'pullups' | 'adherence' | 'none'

/** manual 탭의 코치 행: extra = 주기|변경키|지표|목표|제안문 */
export const adviceToExtra = (horizon: string, a: Advice) => [horizon, a.key, a.metric, String(a.target), a.text].join('|')
export function adviceFromRow(r: HealthRow) {
  const [horizon = '', key = '', metric = '', target = '', ...rest] = (r.extra || '').split('|')
  return { date: day(r), horizon, key: key as ChangeKey, metric: metric as MetricKey, target: Number(target), text: rest.join('|') }
}

// ── 한 주의 실측값 ─────────────────────────────────────────
export type WeekFacts = ReturnType<typeof weekFacts>

export function weekFacts(tabs: Tabs, monday: string) {
  const to = shift(monday, 6)
  const inWeek = (d: string) => d >= monday && d <= to
  const nights = nightRows(tabs.sleep).filter((n) => inWeek(n.key))
  const manual = tabs.manual ?? []
  const workouts = (tabs.workout ?? []).filter((w) => inWeek(day(w)))

  // 취침 시각을 정오 기준 분으로 (자정 넘김 처리)
  const bedMins = nights.map((n) => { const [h, m] = n.bed.split(':').map(Number); return h < 12 ? h * 60 + m + 1440 : h * 60 + m })
  const srpe = manual.filter((m) => m.value === 'sRPE' && inWeek(day(m)))
    .reduce((s, m) => { const [, min, rpe] = (m.extra || '').split('|'); return s + (Number(min) || 0) * (Number(rpe) || 0) }, 0)
  const pull = manual.filter((m) => m.value === '턱걸이' && inWeek(day(m)))
  const pullTotal = pull.reduce((s, m) => {
    const [, sets, reps] = (m.extra || '').split('|')
    const list = String(reps || '').replace(/초/g, '').split(',').map(Number).filter((v) => v > 0)
    return s + (list.length > 1 ? list.reduce((a, b) => a + b, 0) : (Number(sets) || 1) * (list[0] || 0))
  }, 0)
  const wellness = manual.filter((m) => m.value === '컨디션' && inWeek(day(m))).map((m) => (m.extra || '').split('|').map(Number))
  const pain = manual.filter((m) => m.value === '통증' && inWeek(day(m))).map((m) => { const [site, lv] = (m.extra || '').split('|'); return { site, level: Number(lv) || 0 } })
  const plan = planWeek(manual, tabs.workout ?? [], monday, to)

  return {
    monday, to,
    nights: nights.length,
    sleepMean: nights.length ? Math.round(mean(nights.map((n) => n.totalMin))) : null,
    bedtimeMean: bedMins.length ? Math.round(mean(bedMins)) : null,   // 정오 기준 분
    sessions: workouts.length,
    srpe: Math.round(srpe),
    pullups: pullTotal,
    wellnessMean: wellness.length ? wellness[0].map((_, i) => round(mean(wellness.map((w) => w[i])), 1)) : null,
    wellnessDays: wellness.length,
    pain: pain.filter((p) => p.level >= 3),
    planned: plan.planned, done: plan.done,
    adherence: plan.planned ? round(plan.done / plan.planned, 2) : null,
    missed: plan.days.flatMap((d) => d.items.filter((i) => !i.rest && !i.done).map((i) => `${d.wd} ${i.name}`)),
  }
}

const METRIC_OF: Record<MetricKey, (f: WeekFacts) => number | null> = {
  bedtime: (f) => f.bedtimeMean, sleep: (f) => f.sleepMean, sessions: (f) => f.sessions,
  load: (f) => f.srpe, pullups: (f) => f.pullups, adherence: (f) => f.adherence, none: () => null,
}

/** 지난주 제안의 이행과 결과. 목표는 "지지난주 대비 변화량"으로 해석한다. */
export function evaluate(prev: ReturnType<typeof adviceFromRow>, last: WeekFacts, before: WeekFacts) {
  const get = METRIC_OF[prev.metric] ?? (() => null)
  const now = get(last), then = get(before)
  if (prev.metric === 'none' || now == null) return { text: `지난주 제안: ${prev.text} (측정할 기록이 없었어요)`, met: null as boolean | null }
  if (then == null) return { text: `지난주 제안: ${prev.text} → 이번 주 ${round(now, 1)} (비교할 지지난주 기록이 없어요)`, met: null }
  const delta = now - then
  // 목표가 음수면 줄이는 게 성공, 양수면 늘리는 게 성공
  const met = prev.target === 0 ? Math.abs(delta) < Math.abs(then * 0.1) : prev.target < 0 ? delta <= prev.target * 0.5 : delta >= prev.target * 0.5
  const unit = prev.metric === 'bedtime' || prev.metric === 'sleep' ? '분' : ''
  return { text: `지난주 제안: ${prev.text} → ${met ? '지켰어요' : '못 지켰어요'} (${round(then, 1)}에서 ${round(now, 1)}${unit}, ${delta >= 0 ? '+' : ''}${round(delta, 1)}${unit})`, met }
}

// ── 진급 게이트 ────────────────────────────────────────────
export type Promotion = { area: string; from: string; to: string; why: string }

/** 진급까지 얼마나 왔는지. 조건을 못 넘겨도 진행도를 돌려주므로 "몇 번 더 남았는지"를 말할 수 있다. */
export type Gate = { area: string; stage: string; next: string; done: number; need: number; detail: string; ready: boolean; blocked?: string }

const painNear = (tabs: Tabs, today: string, days: number, sitePattern: RegExp) =>
  (tabs.manual ?? []).find((m) => m.value === '통증' && day(m) >= shift(today, -days)
    && Number((m.extra || '').split('|')[1]) >= 3 && sitePattern.test((m.extra || '').split('|')[0]))

/** 턱걸이 세션 한 줄을 숫자로. extra = 변형|세트|횟수(초 포함 가능) */
const pullRow = (m: HealthRow) => {
  const [variant = '', sets = '', reps = ''] = (m.extra || '').split('|')
  const nums = String(reps).replace(/초/g, '').split(',').map(Number).filter((v) => v > 0)
  return { variant, sets: Number(sets) || nums.length, best: nums.length ? Math.max(...nums) : 0, reps: nums.length > 1 ? nums.length : Number(sets) || 0 }
}

/**
 * 진급 게이트. 조건은 계획 라이브러리의 진행 규칙과 **같은 숫자**를 쓴다.
 * (예전에는 계획이 "네거티브 5초 3~4회"를 시키는데 게이트는 "8초 5세트"를 요구해서
 *  계획대로 해도 영원히 진급하지 않았다.)
 */
export function gates(tabs: Tabs, today: string): Gate[] {
  const out: Gate[] = []
  const manual = tabs.manual ?? []
  const since = shift(today, -21)
  const pull = manual.filter((m) => m.value === '턱걸이' && day(m) >= since).map(pullRow)
  const shoulder = painNear(tabs, today, 14, /어깨|팔|손목/)

  const dead = pull.filter((p) => /데드행|매달/.test(p.variant))
  const neg = pull.filter((p) => /네거티브/.test(p.variant))
  const band = pull.filter((p) => /밴드/.test(p.variant))
  const strict = pull.filter((p) => /정자세|스트릭트/.test(p.variant))

  // 지금 어느 단계인지는 최근에 무엇을 기록했는지로 판단한다(따로 저장하지 않아 스스로 교정된다)
  if (strict.length) {
    out.push({ area: '턱걸이', stage: '정자세', next: '개수 늘리기', done: strict.length, need: strict.length, detail: '정자세 단계예요. 이제 개수를 늘려가요.', ready: false })
  } else if (band.length) {
    const ok = band.filter((p) => p.best >= 5 && p.sets >= 3).length
    out.push({ area: '턱걸이', stage: '밴드 보조', next: '정자세 1회 도전', done: ok, need: 3,
      detail: `밴드 5회 3세트를 21일 안에 3회 채우면 정자세에 도전해요 (지금 ${ok}회)`, ready: ok >= 3 && !shoulder, blocked: shoulder ? '어깨 통증이 가라앉은 뒤에' : undefined })
  } else if (neg.length) {
    const ok = neg.filter((p) => p.best >= 8 && p.reps >= 3).length
    out.push({ area: '턱걸이', stage: '네거티브', next: '밴드 보조 정자세 3~5회', done: ok, need: 3,
      detail: `네거티브 8초를 3회 이상 한 세션이 21일 안에 3번 있으면 밴드로 넘어가요 (지금 ${ok}회)`, ready: ok >= 3 && !shoulder, blocked: shoulder ? '어깨 통증이 가라앉은 뒤에' : undefined })
  } else {
    const ok = dead.filter((p) => p.best >= 30 && p.sets >= 3).length
    out.push({ area: '턱걸이', stage: '데드행', next: '네거티브 8초', done: ok, need: 3,
      detail: `데드행 30초 3세트를 21일 안에 3회 채우면 네거티브로 넘어가요 (지금 ${ok}회)`, ready: ok >= 3 && !shoulder, blocked: shoulder ? '어깨 통증이 가라앉은 뒤에' : undefined })
  }

  // 러닝: 세션 수 + **거리 정체** + 통증 없음. 정체 확인이 빠져 있어서 직전에 늘린 뒤에도 또 늘리라고 했었다.
  const km = (w: HealthRow) => { const d = (w.extra || '').split('|')[2] || ''; const v = parseFloat(d) || 0; return /km/i.test(d) || v < 50 ? v : v / 1000 }
  const runs = (tabs.workout ?? []).filter((w) => /running/i.test(w.value))
  const recent = runs.filter((w) => day(w) >= since)
  const prior = runs.filter((w) => day(w) >= shift(today, -42) && day(w) < since)
  const leg = painNear(tabs, today, 21, /무릎|발|정강이|아킬레스|고관절|허벅지|종아리/)
  const longNow = recent.length ? Math.max(...recent.map(km)) : 0
  const longPrev = prior.length ? Math.max(...prior.map(km)) : 0
  const plateau = longPrev === 0 ? recent.length >= 6 : longNow <= longPrev * 1.05
  const ready = recent.length >= 6 && longNow > 0 && plateau && !leg
  out.push({
    area: '러닝', stage: longNow ? `최장 ${round(longNow, 1)}km` : '아직 기록 없음',
    next: longNow ? `${round(longNow * 1.1, 1)}km` : '주 2회부터',
    done: recent.length, need: 6,
    detail: recent.length < 6 ? `21일 안에 6회를 채우면 거리 조정을 봐요 (지금 ${recent.length}회)`
      : !plateau ? '최근에 거리를 늘렸어요. 3~4주 유지한 뒤에 다시 봐요.'
      : leg ? '통증 기록이 있어 지금은 늘리지 않아요.'
      : '3주 동안 같은 거리를 유지했고 통증도 없어요. 10% 이내면 안전한 범위예요.',
    ready, blocked: leg ? `${(leg.extra || '').split('|')[0]} 통증이 가라앉은 뒤에` : undefined,
  })
  return out
}

/** 조건을 넘긴 것만. nextChange 와 월간 결정이 쓴다. */
export function promotions(tabs: Tabs, today: string): Promotion[] {
  return gates(tabs, today).filter((g) => g.ready)
    .map((g) => ({ area: g.area, from: g.stage, to: g.next, why: g.detail }))
}

// ── 다음 주 변경 하나 고르기 ───────────────────────────────
/** 우선순위대로 검사해서 처음 걸리는 것 하나만 고른다. 여러 개를 주면 아무것도 안 지켜진다. */
export function nextChange(tabs: Tabs, last: WeekFacts, today: string): Advice {
  const load = loadSummary(dailyLoad(tabs.workout ?? [], 60), today)
  const promo = promotions(tabs, today)

  if (last.pain.length) {
    const p = last.pain[0]
    return { key: 'lower_intensity', text: `${p.site} 통증이 가라앉을 때까지 강도만 낮추기`, metric: 'none', target: 0,
      why: `이번 주 ${p.site} 통증 ${p.level}/10 기록이 있었어요. 건너뛰기보다 강도를 먼저 낮춰요.` }
  }
  if (load.status === '과부하') {
    return { key: 'deload', text: '이번 주는 부하를 늘리지 않기', metric: 'load', target: 0,
      why: `최근 7일 부하가 4주 평균의 ${load.ratio}배예요.` }
  }
  if (last.adherence != null && last.adherence < 0.6) {
    return { key: 'adherence', text: `빠진 세션부터 채우기 (${last.missed.slice(0, 2).join(', ') || '계획대로'})`, metric: 'adherence', target: 0.2,
      why: `계획 ${last.planned}개 중 ${last.done}개만 했어요. 새 목표보다 지키던 것부터.` }
  }
  const nights = nightRows(tabs.sleep)
  const base = mean(nights.filter((n) => n.key >= shift(today, -60) && n.key < last.monday).map((n) => n.totalMin))
  if (last.sleepMean != null && !isNaN(base) && base - last.sleepMean >= 30) {
    return { key: 'bedtime', text: '취침을 30분 앞당기기', metric: 'bedtime', target: -30,
      why: `이번 주 평균 수면이 평소보다 ${Math.round(base - last.sleepMean)}분 짧았어요. 기상 시각은 그대로 두고 취침만 당겨요.` }
  }
  if (promo.length) {
    const p = promo[0]
    return { key: 'promote', text: `${p.area}: ${p.from}에서 ${p.to}로 올리기`, metric: p.area === '턱걸이' ? 'pullups' : 'none', target: p.area === '턱걸이' ? 5 : 0, why: p.why }
  }
  if (last.adherence != null && last.adherence >= 0.8 && load.ratio != null && load.ratio <= 1.3) {
    return { key: 'add_session', text: '다음 주에 세션 하나 더하기', metric: 'sessions', target: 1,
      why: `계획을 ${Math.round(last.adherence * 100)}% 지켰고 부하도 안정적이에요. 늘릴 여유가 있어요.` }
  }
  return { key: 'hold', text: '지금 계획 그대로 유지하기', metric: 'sessions', target: 0,
    why: '지표가 평소 범위 안이에요. 바꾸지 않는 것도 결정이에요.' }
}

/**
 * 삶 제안 하나. 건강과 같은 방식으로 우선순위대로 검사해 처음 걸리는 것만 고른다.
 * 건강 제안과 나란히 서므로 주간 제안은 최대 둘이다. 여섯이 문제였지 둘은 지켜진다.
 */
export function lifeChange(tabs: Tabs, today: string, monday: string): Advice {
  const manual = tabs.manual ?? []
  const active = activeCommitments(manual, today)
  const last = commitmentWeek(manual, shift(monday, -7), shift(monday, -1))

  const soon = active.filter((c) => c.due && c.due >= today && c.due <= shift(today, 3))
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
  if (soon.length) return { key: 'deadline', text: `${soon[0].task} 부터 (${soon[0].due} 마감)`, metric: 'none', target: 0,
    why: `3일 안에 마감이에요. 다른 걸 새로 넣기 전에 이것부터.` }

  if (last.planned >= 2 && last.done / last.planned < 0.5)
    return { key: 'backlog', text: '새 약속 그만 넣고 밀린 것부터', metric: 'none', target: 0,
      why: `지난주 약속 ${last.planned}개 중 ${last.done}개만 했어요. 늘리는 것보다 지키던 것부터.` }

  if (active.length >= CAP)
    return { key: 'overflow', text: `약속이 ${active.length}개예요. 하나 지우고 시작하기`, metric: 'none', target: 0,
      why: '한 번에 5개가 상한이에요. 안 할 것을 지우는 것도 결정이에요.' }

  // 요일형이 2주 연속 미이행이면 그 약속 자체가 틀린 것이다 (날짜형은 지나면 만료돼 여기 안 걸린다)
  const before = commitmentWeek(manual, shift(monday, -14), shift(monday, -8))
  const stale = active.find((c) => !c.due
    && last.items.some((i) => i.task === c.task && !i.done)
    && before.items.some((i) => i.task === c.task && !i.done))
  if (stale) return { key: 'stale', text: `"${stale.task}" 를 버리거나 더 작게 쪼개기`, metric: 'none', target: 0,
    why: '2주 연속 못 했어요. 의지 문제가 아니라 덩어리가 큰 것일 수 있어요.' }

  return { key: 'life_hold', text: active.length ? '지금 약속 그대로 유지하기' : '아직 등록된 약속이 없어요', metric: 'none', target: 0,
    why: active.length ? '약속이 평소 범위 안이에요.' : '"약속 09-13 치과" 처럼 언제 할지를 붙여서 넣어보세요.' }
}

// ── 주간 리뷰 ──────────────────────────────────────────────
export function weekReview(tabs: Tabs, today: string, weekOf?: string) {
  // weekOf 가 있으면 그 날짜가 속한 주를 리뷰한다(과거 주 다시 보기). 없으면 막 끝난 주.
  const thisMonday = mondayOf(today)
  const lastMonday = weekOf ? mondayOf(weekOf) : shift(thisMonday, -7)
  const last = weekFacts(tabs, lastMonday)          // 막 끝난 주
  const before = weekFacts(tabs, shift(lastMonday, -7))
  const advice = nextChange(tabs, last, today)

  // 지난주에 저장된 제안 되짚기
  const prevRow = (tabs.manual ?? []).filter((m) => m.value === '코치' && day(m) >= shift(lastMonday, -7) && day(m) < shift(lastMonday, 7)).pop()
  const review = prevRow ? evaluate(adviceFromRow(prevRow), last, before) : null

  // 회복 지표: 지난주 평균이 30일 평균에서 벗어난 것만
  const drift: string[] = []
  for (const [key, label, unit, lowerBetter] of [['hrv', 'HRV', 'ms', false], ['resting_hr', '안정심박', '', true], ['respiratory_rate', '호흡', '/분', true]] as const) {
    const s = dailySeries(tabs[key])
    const w = [...s].filter(([d]) => d >= last.monday && d <= last.to).map(([, v]) => v)
    const m30 = [...s].filter(([d]) => d >= shift(last.monday, -30) && d < last.monday).map(([, v]) => v)
    if (w.length < 3 || m30.length < 10) continue
    const diff = mean(w) - mean(m30)
    const rel = Math.abs(diff) / (mean(m30) || 1)
    if (rel < 0.05) continue
    const good = lowerBetter ? diff < 0 : diff > 0
    drift.push(`${label} ${round(mean(w), 1)}${unit} (30일 평균 ${round(mean(m30), 1)}${unit}, ${diff >= 0 ? '+' : ''}${round(diff, 1)}) ${good ? '좋아짐' : '나빠짐'}`)
  }

  const load = loadSummary(dailyLoad(tabs.workout ?? [], 60), today)
  const life = lifeChange(tabs, today, lastMonday)
  const commitments = commitmentWeek(tabs.manual ?? [], last.monday, last.to)
  return { week: `${last.monday} ~ ${last.to}`, facts: last, before, advice, review, drift, load,
    promotions: promotions(tabs, today), life, commitments }
}

export function formatWeek(r: ReturnType<typeof weekReview>): string {
  const f = r.facts
  const lines = [`[주간 리뷰 ${r.week}]`]
  lines.push(`계획 ${f.done}/${f.planned} 이행${f.missed.length ? ` (빠짐: ${f.missed.join(', ')})` : ''}`)
  // 데이터부족일 때 비율을 같이 보여주면 판단한 것처럼 읽힌다
  const ratioText = r.load.status !== '데이터부족' && r.load.ratio != null ? ` (급성/만성 ${r.load.ratio})` : ''
  lines.push(`세션 ${f.sessions}회${f.srpe ? `, sRPE 합 ${f.srpe}` : ''} · 부하 ${r.load.status}${ratioText}`)
  if (f.sleepMean != null) lines.push(`수면 평균 ${Math.floor(f.sleepMean / 60)}시간 ${String(f.sleepMean % 60).padStart(2, '0')}분 (${f.nights}박)`)
  lines.push(f.wellnessMean ? `자가평가 ${f.wellnessDays}일: 수면질 ${f.wellnessMean[0]} 피로 ${f.wellnessMean[1]} 스트레스 ${f.wellnessMean[2]} 근육통 ${f.wellnessMean[3]}`
    : '자가평가 기록 없음 (센서보다 이게 더 잘 맞는다는 근거가 있어요)')
  if (f.pain.length) lines.push(`통증: ${f.pain.map((p) => `${p.site} ${p.level}/10`).join(', ')}`)
  lines.push(r.drift.length ? `회복 지표 변화\n  ${r.drift.join('\n  ')}` : '회복 지표는 평소 범위')
  if (r.review) lines.push(r.review.text)
  if (r.commitments.planned) lines.push(`약속 ${r.commitments.done}/${r.commitments.planned}` +
    (r.commitments.items.filter((i) => !i.done).length
      ? ` (남음: ${r.commitments.items.filter((i) => !i.done).map((i) => i.task).join(', ')})` : ''))
  lines.push(`\n[다음 주 변경 하나] ${r.advice.text}\n  ${r.advice.why}`)
  lines.push(`[삶 쪽 하나] ${r.life.text}\n  ${r.life.why}`)
  return lines.join('\n')
}

// ── 월간 리뷰 ──────────────────────────────────────────────
/** 태그별 다음날 HRV. 표본이 적으면 숫자만 보여주고 판단하지 않는다. */
export function tagImpact(tabs: Tabs, today: string) {
  const hrv = dailySeries(tabs.hrv)
  const byTag = new Map<string, Set<string>>()
  for (const m of tabs.manual ?? []) {
    if (m.value !== '태그') continue
    for (const t of (m.extra || '').split('|').filter(Boolean)) {
      if (!byTag.has(t)) byTag.set(t, new Set())
      byTag.get(t)!.add(day(m))
    }
  }
  return [...byTag.entries()].map(([tag, days]) => {
    const on: number[] = [], off: number[] = []
    for (const [d, v] of hrv) (days.has(shift(d, -1)) ? on : off).push(v)
    const enough = on.length >= 30 && off.length >= 30
    return { tag, days: days.size, n: on.length,
      diff: on.length && off.length ? round(mean(on) - mean(off), 1) : null,
      verdict: enough ? '판단 가능' : `표본 ${on.length}일, 아직 판단하기 이름` }
  }).sort((a, b) => b.days - a.days)
}

/** 그 달의 1일 */
export const monthOf = (d: string) => d.slice(0, 7) + '-01'
const monthEnd = (m: string) => shift(shift(m, 32).slice(0, 7) + '-01', -1)

export function monthReview(tabs: Tabs, today: string, monthAnchor?: string) {
  // monthAnchor 가 있으면 그 달 전체를, 없으면 최근 30일을 본다
  const month = monthAnchor ? monthOf(monthAnchor) : null
  const from = month ?? shift(today, -30)
  const to = month ? (monthEnd(month) < today ? monthEnd(month) : today) : today
  const workouts = (tabs.workout ?? []).filter((w) => day(w) >= from && day(w) <= to)
  const bySport = new Map<string, number>()
  for (const w of workouts) bySport.set(w.value, (bySport.get(w.value) ?? 0) + 1)
  const nights = nightRows(tabs.sleep).filter((n) => n.key >= from && n.key <= to)
  const vo2 = dailySeries(tabs.vo2max)
  const vNow = [...vo2].filter(([d]) => d >= shift(today, -90)).map(([, v]) => v)
  const vThen = [...vo2].filter(([d]) => d >= shift(today, -455) && d <= shift(today, -365)).map(([, v]) => v)
  const rhr = dailySeries(tabs.resting_hr)
  const rNow = [...rhr].filter(([d]) => d >= from && d <= to).map(([, v]) => v)
  const rThen = [...rhr].filter(([d]) => d >= shift(today, -395) && d <= shift(today, -365)).map(([, v]) => v)
  // 지난달에 남긴 결정을 되짚는다
  const prevFrom = shift(from, -32).slice(0, 7) + '-01'
  const prevRow = (tabs.manual ?? []).filter((m) => m.value === '코치' && (m.extra || '').startsWith('월간|') && day(m) >= prevFrom && day(m) < from).pop()
  const promo = promotions(tabs, to)
  const decision: Advice = promo.length
    ? { key: 'promote', text: `${promo[0].area}: ${promo[0].from}에서 ${promo[0].to}로 올리기`,
        metric: promo[0].area === '턱걸이' ? 'pullups' : 'none', target: promo[0].area === '턱걸이' ? 5 : 0, why: promo[0].why }
    : { key: 'hold', text: '다음 달도 지금 단계 유지', metric: 'sessions', target: 0,
        why: '진급 조건을 넘긴 항목이 없어요. 같은 단계를 더 채우는 게 다음 단계로 가는 길이에요.' }
  return {
    from, to,
    prevDecision: prevRow ? adviceFromRow(prevRow) : null,
    decision,
    sessions: workouts.length, bySport: [...bySport.entries()].sort((a, b) => b[1] - a[1]),
    sleepMean: nights.length ? Math.round(mean(nights.map((n) => n.totalMin))) : null, nights: nights.length,
    vo2: vNow.length ? round(mean(vNow), 1) : null, vo2Change: vNow.length && vThen.length ? round(mean(vNow) - mean(vThen), 1) : null,
    rhr: rNow.length ? round(mean(rNow), 1) : null, rhrChange: rNow.length && rThen.length ? round(mean(rNow) - mean(rThen), 1) : null,
    tags: tagImpact(tabs, to), promotions: promo, gates: gates(tabs, to),
  }
}

export function formatMonth(r: ReturnType<typeof monthReview>): string {
  const lines = [`[월간 리뷰 ${r.from} ~ ${r.to}]`]
  lines.push(`세션 ${r.sessions}회${r.bySport.length ? ` (${r.bySport.map(([s, n]) => `${s} ${n}`).join(', ')})` : ''}`)
  if (r.sleepMean != null) lines.push(`수면 평균 ${Math.floor(r.sleepMean / 60)}시간 ${String(r.sleepMean % 60).padStart(2, '0')}분 (${r.nights}박)`)
  lines.push(`VO2max ${r.vo2 ?? '-'}${r.vo2Change != null ? ` (1년 전 대비 ${r.vo2Change >= 0 ? '+' : ''}${r.vo2Change})` : ''}` +
    ` · 안정심박 ${r.rhr ?? '-'}${r.rhrChange != null ? ` (1년 전 대비 ${r.rhrChange >= 0 ? '+' : ''}${r.rhrChange})` : ''}`)
  lines.push('\n[태그가 다음 날에 남긴 것]')
  lines.push(r.tags.length
    ? r.tags.map((t) => `  ${t.tag} ${t.days}일 기록${t.diff != null ? `, 다음 날 HRV 차이 ${t.diff >= 0 ? '+' : ''}${t.diff}ms` : ''} (${t.verdict})`).join('\n')
    : '  기록된 태그가 없어요.')
  lines.push('\n[진급 판정]')
  lines.push(r.gates.map((g) => `  ${g.area} [${g.stage}] ${g.ready ? `→ ${g.next} 준비됨` : `${g.done}/${g.need}`}\n    ${g.detail}${g.blocked ? ` (${g.blocked})` : ''}`).join('\n'))
  if (r.prevDecision) lines.push(`\n지난달 결정: ${r.prevDecision.text}`)
  lines.push(`\n[이번 달 결정] ${r.decision.text}\n  ${r.decision.why}`)
  return lines.join('\n')
}

/** 지금까지의 제안과 각각을 지켰는지. 코치의 기억을 눈으로 보는 화면. */
export function adviceHistory(tabs: Tabs, today: string, limit = 8) {
  const rows = (tabs.manual ?? []).filter((m) => m.value === '코치').sort((a, b) => (a.start < b.start ? -1 : 1)).slice(-limit)
  return rows.map((r) => {
    const a = adviceFromRow(r)
    const givenMonday = mondayOf(a.date)
    // 제안이 나온 주의 다음 주가 "지켰는지 재는 주"다
    const target = weekFacts(tabs, shift(givenMonday, 7))
    const base = weekFacts(tabs, givenMonday)
    const done = shift(givenMonday, 13) < today          // 그 주가 끝났는가
    return { date: a.date, horizon: a.horizon, text: a.text, key: a.key,
      result: done ? evaluate(a, target, base) : { text: '아직 진행 중인 주예요', met: null as boolean | null } }
  }).reverse()
}

export function formatHistory(rows: ReturnType<typeof adviceHistory>): string {
  if (!rows.length) return '[코치 기록] 아직 저장된 제안이 없어요. 주간 리뷰를 한 번 돌리면 여기부터 쌓여요.'
  const mark = (m: boolean | null) => m === true ? '지킴' : m === false ? '놓침' : '판단보류'
  const kept = rows.filter((r) => r.result.met === true).length, judged = rows.filter((r) => r.result.met !== null).length
  return [`[코치 기록] 최근 ${rows.length}개 제안${judged ? `, 그중 ${kept}/${judged} 지킴` : ''}`,
    ...rows.map((r) => `  ${r.date} [${mark(r.result.met)}] ${r.text}\n    ${r.result.text.replace(/^지난주 제안: .*? → /, '')}`)].join('\n')
}
