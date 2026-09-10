/** 한 줄 수동 기록(폰에서 클로드에게 말하는 한 줄) → manual 탭 행. 파서와 요약은 순수 함수. */
import type { HealthRow } from './_health.js'

export type LogEntry = { kind: string; extra: string; echo: string }
const WELL = ['수면질', '피로', '스트레스', '근육통']   // 컨디션 4항목 순서 고정(Hooper 최소형)
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const SLOTS = ['아침', '점심', '저녁', '밤']
/**
 * 약속 트리거. 날짜형 'MM-DD' 또는 요일형 '화'/'화아침'. 그 외는 null.
 * "언젠가 할 일"을 받는 순간 핀보드가 되므로 여기서 막는다.
 */
export function parseTrigger(t: string): { mmdd: string } | { wd: string; slot: string } | null {
  const d = /^(\d{2})-(\d{2})$/.exec(t)
  if (d) return +d[1] >= 1 && +d[1] <= 12 && +d[2] >= 1 && +d[2] <= 31 ? { mmdd: t } : null
  const w = new RegExp(`^([${DAYS.join('')}])(${SLOTS.join('|')})?$`).exec(t)
  return w ? { wd: w[1], slot: w[2] || '' } : null
}
/** 계획 종목(한글) ↔ 워치 워크아웃 타입 */
export const SPORT: Record<string, string> = { 수영: 'Swimming', 러닝: 'Running', 달리기: 'Running', 걷뛰: 'Running', 요가: 'Yoga', 걷기: 'Walking', 자전거: 'Cycling', 등산: 'Hiking', 근력: 'FunctionalStrengthTraining', 코어: 'CoreTraining' }
/**
 * 계획 종목 하나가 인정하는 다른 이름들. 걷뛰는 러닝만 인정했더니, 계획서가 스스로
 * "가볍게: 달리기 구간을 빼고 걷기"라고 시킨 날에 워치가 Walking 을 올려서 미이행으로 찍혔다.
 * 판정은 계획·코치·주간 화면이 모두 아래 두 함수를 거치게 해서 한 곳에서만 고친다.
 */
const ALIAS: Record<string, string[]> = { 걷뛰: ['걷뛰', '걷기', '러닝', '달리기'] }
const namesOf = (plan: string) => ALIAS[plan] ?? [plan]
/** 계획 종목이 인정하는 워치 워크아웃 타입들 */
export const sportTypes = (plan: string) => [...new Set(namesOf(plan).map((n) => SPORT[n]).filter(Boolean))]
/** 그날 워치 워크아웃이 이 계획 종목을 채웠는가 */
export const matchesWorkout = (plan: string, type: string) => sportTypes(plan).some((t) => t.toLowerCase() === type.toLowerCase())
/** 한 줄 기록(sRPE)의 종목명이 이 계획 종목을 채웠는가 */
export const matchesLog = (plan: string, sport: string) => namesOf(plan).includes(sport)

/** "컨디션 4 3 2 3" / "sRPE 수영 55 6 무릎 살짝" / "턱걸이 밴드 3x5" / "태그 술 늦은식사" / "통증 무릎 3" / 그 외 → 메모 */
export function parseLog(text: string): LogEntry {
  const t = text.trim().replace(/\s+/g, ' ')
  const [head, ...rest] = t.split(' ')
  const h = head.toLowerCase()

  if (['컨디션', '웰니스'].includes(h)) {
    // "4 3 2 3" 외에 "4323", "4,3,2,3", "4/3/2/3" 도 허용 — 숫자만 뽑아 4자리면 한 자리씩
    const digits = rest.join('').replace(/[^0-9]/g, '')
    const n = digits.length === 4 ? [...digits].map(Number) : rest.slice(0, 4).map(Number)
    if (n.length !== 4 || n.some((v) => !(v >= 1 && v <= 5))) throw new Error('컨디션은 1~5 숫자 4개: 수면질 피로 스트레스 근육통 (예: 컨디션 4 3 2 3)')
    return { kind: '컨디션', extra: n.join('|'), echo: WELL.map((w, i) => `${w} ${n[i]}`).join(' · ') }
  }
  if (h === 'srpe' || h === 'rpe') {
    const [sport, min, rpe, ...memo] = rest
    if (!sport || !(+min > 0) || !(+rpe >= 1 && +rpe <= 10)) throw new Error('sRPE는 "sRPE 종목 분 RPE(1~10) [메모]" (예: sRPE 수영 55 6)')
    return { kind: 'sRPE', extra: [sport, +min, +rpe, memo.join(' ')].join('|'), echo: `${sport} ${+min}분 RPE ${+rpe} → 부하 ${+min * +rpe}${memo.length ? ' · ' + memo.join(' ') : ''}` }
  }
  if (h === '턱걸이' || h === '풀업') {
    // 변형(선택) + "3x5" | "4x8초" | "5 5 5"
    let variant = '정자세'; let body = rest
    if (rest.length && !/^\d/.test(rest[0])) { variant = rest[0]; body = rest.slice(1) }
    const m = body.join(' ').match(/^(\d+)\s*[x×]\s*(\d+)(초)?/)
    let sets: number, reps: string
    if (m) { sets = +m[1]; reps = m[2] + (m[3] || '') }
    else {
      const nums = body.map(Number).filter((v) => v > 0)
      if (!nums.length) throw new Error('턱걸이는 "턱걸이 [변형] 3x5" 또는 "턱걸이 5 5 5" (예: 턱걸이 밴드 3x5, 턱걸이 네거티브 4x8초)')
      sets = nums.length; reps = nums.join(',')
    }
    return { kind: '턱걸이', extra: [variant, sets, reps].join('|'), echo: `${variant} ${sets}세트 × ${reps}` }
  }
  if (h === '인바디') {
    // 인바디 체중 골격근량 체지방률 [메모] — 앱 수치 그대로(kg, kg, %)
    const [w, smm, fat, ...memo] = rest
    if (!(+w > 0) || !(+smm > 0) || !(+fat >= 0)) throw new Error('인바디는 "인바디 체중 골격근량 체지방률" (예: 인바디 72.3 33.1 18.5)')
    return { kind: '인바디', extra: [+w, +smm, +fat, memo.join(' ')].join('|'), echo: `체중 ${+w}kg · 골격근 ${+smm}kg · 체지방 ${+fat}%` }
  }
  if (h === '약속') {
    const [trig, ...task] = rest
    if (!trig || !parseTrigger(trig) || !task.length)
      throw new Error('약속은 "약속 09-13 치과" 또는 "약속 화아침 지원서" 형식이에요. 언제 할지가 없으면 등록되지 않습니다')
    return { kind: '약속', extra: [trig, task.join(' ')].join('|'), echo: `${trig} · ${task.join(' ')}` }
  }
  if (h === '했다') {
    if (!rest.length) throw new Error('했다 뒤에 무엇을 했는지 (예: 했다 카제나)')
    return { kind: '이행', extra: rest.join(' '), echo: rest.join(' ') }
  }
  if (h === '계획') {
    // 계획 월 수영 턱걸이 / 계획 토 휴식 — 요일별 마지막 것이 유효
    const [d, ...items] = rest
    if (!DAYS.includes(d) || !items.length) throw new Error('계획은 "계획 요일 종목..." (예: 계획 월 수영 턱걸이, 계획 토 휴식)')
    return { kind: '계획', extra: [d, items.join(',')].join('|'), echo: `${d}요일: ${items.join(', ')}` }
  }
  if (h === '코치') {
    // 사람이 손으로 남기는 형태: 코치 <주기> <제안문>. 측정 가능한 지표가 붙은 제안은 서버가 직접 쓴다.
    const [horizon, ...words] = rest
    if (!['일간', '주간', '월간'].includes(horizon) || !words.length) throw new Error('코치 기록은 "코치 주간 취침 30분 당기기" 형식이에요')
    return { kind: '코치', extra: [horizon, 'hold', 'none', '0', words.join(' ')].join('|'), echo: `${horizon} 제안: ${words.join(' ')}` }
  }
  if (h === '태그') {
    if (!rest.length) throw new Error('태그 뒤에 어휘를 (예: 태그 술 늦은식사 카페인 출장 아픔)')
    return { kind: '태그', extra: rest.join('|'), echo: rest.join(', ') }
  }
  if (h === '통증') {
    const [site, level, ...memo] = rest
    if (!site || !(+level >= 0 && +level <= 10)) throw new Error('통증은 "통증 부위 0~10 [메모]" (예: 통증 무릎 3)')
    return { kind: '통증', extra: [site, +level, memo.join(' ')].join('|'), echo: `${site} ${+level}/10${memo.length ? ' · ' + memo.join(' ') : ''}` }
  }
  if (!t) throw new Error('기록할 내용이 없습니다')
  return { kind: '메모', extra: t, echo: t }
}

/** KST 현재 시각 'yyyy-MM-dd HH:mm:ss'. 앞에 "어제 "가 붙으면 어제 12:00. */
export function logStamp(text: string, now = Date.now()): { stamp: string; text: string } {
  const kst = new Date(now + 9 * 3600_000)
  if (/^어제\s+/.test(text)) {
    kst.setUTCDate(kst.getUTCDate() - 1)
    return { stamp: kst.toISOString().slice(0, 10) + ' 12:00:00', text: text.replace(/^어제\s+/, '') }
  }
  return { stamp: kst.toISOString().replace('T', ' ').slice(0, 19), text }
}

// ── 요약 (health_week 에 붙는 수동 기록 섹션) ─────────────────
const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN
const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((v) => (v - m) ** 2))) }
const day = (r: HealthRow) => r.start.slice(0, 10)

/** rows: manual 탭 전체(기준선용 30일 포함), since: 최근 구간 시작일 'yyyy-MM-dd' */
export function summarizeManual(rows: HealthRow[] = [], since: string, workouts: HealthRow[] = [], today?: string): string {
  const out: string[] = []
  const recent = rows.filter((r) => day(r) >= since)
  const older = rows.filter((r) => day(r) < since)

  // 계획 대비 실행
  const week = planWeek(rows, workouts, since, today || (recent.length ? day(recent[recent.length - 1]) : since))
  if (week.days.length) out.push(`[계획 대비 실행 ${week.done}/${week.planned}]\n` + week.days.map((d) => `${d.date.slice(5)}(${d.wd}) ${d.items.map((i) => i.name + (i.rest ? '' : i.done ? '✓' : '✗')).join(' ')}`).join('\n'))

  // 컨디션: 최근 일별 + 개인 평균 대비 1 SD 밖만 표시
  const well = (rs: HealthRow[]) => { const m = new Map<string, number[]>(); rs.filter((r) => r.value === '컨디션').forEach((r) => m.set(day(r), (r.extra || '').split('|').map(Number))); return m }
  const wr = well(recent), wo = well(older)
  if (wr.size) {
    const base = WELL.map((_, i) => { const xs = [...wo.values()].map((v) => v[i]); return { m: mean(xs), s: sd(xs) } })
    const lines = [...wr.entries()].sort().map(([d, v]) => {
      const flags = WELL.map((w, i) => { const b = base[i]; if (isNaN(b.m)) return ''; const z = (v[i] - b.m) / Math.max(b.s, 0.5); /* 1~5 척도라 SD 바닥 0.5 */ return Math.abs(z) >= 1 ? `${w} ${v[i]}(${z > 0 ? '평소↑' : '평소↓'})` : '' }).filter(Boolean)
      return `${d.slice(5)} ${v.join('/')}${flags.length ? ' · ' + flags.join(' ') : ''}`
    })
    out.push(`[컨디션 수면질/피로/스트레스/근육통 1~5]\n${lines.join('\n')}${wo.size ? '' : '\n(기준선 축적 중: 30일 쌓이면 평소 대비 표시)'}`)
  }

  // sRPE 부하: 최근 합 vs 이전 4주 주평균
  const load = (rs: HealthRow[]) => rs.filter((r) => r.value === 'sRPE').reduce((s, r) => { const [, min, rpe] = (r.extra || '').split('|'); return s + (+min || 0) * (+rpe || 0) }, 0)
  const sr = recent.filter((r) => r.value === 'sRPE')
  if (sr.length) {
    const weeks = Math.max(1, Math.round(older.length ? 28 / 7 : 1))
    const prev = load(older.filter((r) => day(r) >= shift(since, -28))) / weeks
    const cur = load(recent)
    const chg = prev ? ` (이전 4주 주평균 ${Math.round(prev)}, ${cur >= prev ? '+' : ''}${Math.round((cur - prev) / prev * 100)}%${cur > prev * 1.3 ? ' ⚠ 30% 초과 증가' : ''})` : ''
    out.push(`[훈련 부하 sRPE 합 ${Math.round(cur)}${chg}]\n` + sr.map((r) => { const [sport, min, rpe, memo] = (r.extra || '').split('|'); return `${day(r).slice(5)} ${sport} ${min}분 RPE ${rpe}${memo ? ' · ' + memo : ''}` }).join('\n'))
  }

  const pull = recent.filter((r) => r.value === '턱걸이')
  if (pull.length) out.push(`[턱걸이]\n` + pull.map((r) => { const [v, sets, reps] = (r.extra || '').split('|'); return `${day(r).slice(5)} ${v} ${sets}×${reps}` }).join('\n'))

  const pain = recent.filter((r) => r.value === '통증')
  if (pain.length) out.push(`[통증]\n` + pain.map((r) => { const [site, lv, memo] = (r.extra || '').split('|'); return `${day(r).slice(5)} ${site} ${lv}/10${+lv >= 3 ? ' ⚠' : ''}${memo ? ' · ' + memo : ''}` }).join('\n'))

  const body = rows.filter((r) => r.value === '인바디').slice(-3)
  if (body.length) out.push(`[인바디 최근]\n` + body.map((r) => { const [w, smm, fat] = (r.extra || '').split('|'); return `${day(r)} 체중 ${w} · 골격근 ${smm} · 체지방 ${fat}%` }).join('\n'))

  const tags = recent.filter((r) => r.value === '태그' || r.value === '메모')
  if (tags.length) out.push(`[태그·메모]\n` + tags.map((r) => `${day(r).slice(5)} ${r.value === '태그' ? (r.extra || '').split('|').join(', ') : r.extra}`).join('\n'))

  return out.length ? out.join('\n\n') : '[수동 기록] 없음 — "컨디션 4 3 2 3", "sRPE 수영 55 6", "턱걸이 밴드 3x5", "태그 술", "통증 무릎 3" 형식으로 기록'
}
const shift = (d: string, days: number) => new Date(Date.parse(d + 'T00:00:00Z') + days * 86400_000).toISOString().slice(0, 10)

export type PlanDay = { date: string; wd: string; items: { name: string; done: boolean; rest: boolean }[] }
/** 요일별 최신 계획 × from~to 날짜에 워치 워크아웃/턱걸이/sRPE 기록이 있는지 (구조화, 웹 화면·텍스트 공용) */
export function planWeek(rows: HealthRow[], workouts: HealthRow[], from: string, to: string): { days: PlanDay[]; planned: number; done: number } {
  const plan = new Map<string, string[]>()
  rows.filter((r) => r.value === '계획').forEach((r) => { const [d, items] = (r.extra || '').split('|'); plan.set(d, items.split(',').filter(Boolean)) })
  const days: PlanDay[] = []; let planned = 0, done = 0
  if (!plan.size) return { days, planned, done }
  for (let d = from; d <= to; d = shift(d, 1)) {
    const wd = DAYS[new Date(d + 'T00:00:00Z').getUTCDay()]; const items = plan.get(wd); if (!items) continue
    days.push({ date: d, wd, items: items.map((name) => {
      if (name === '휴식') return { name, done: false, rest: true }
      planned++
      const hit = workouts.some((w) => day(w) === d && matchesWorkout(name, w.value))
        || (name === '턱걸이' && rows.some((r) => day(r) === d && r.value === '턱걸이'))
        || rows.some((r) => day(r) === d && r.value === 'sRPE' && matchesLog(name, (r.extra || '').split('|')[0]))
      if (hit) done++
      return { name, done: hit, rest: false }
    }) })
  }
  return { days, planned, done }
}

// ── 약속 (운동이 아닌 것) ───────────────────────────────────
// 운동은 '계획'이 담당하고 워치·sRPE 로 자동 판정된다. 여기는 그 밖의 것이라 이행이 수동이다.
export type Commitment = { trigger: string; task: string; due: string | null; wd: string | null; slot: string; at: string }

/**
 * 약속을 읽을 때 가져오는 시트 창(일). 오늘 표면(api/today.ts · health_today)과 상한 검사가
 * **같은 창**을 봐야 한다. 창이 다르면 오래 산 요일형 약속이 상한에는 잡히는데 화면에는
 * 안 뜨는 불일치가 생긴다(75 vs 400 으로 한 번 겪었다). 줄이지 말 것.
 */
export const COMMITMENT_DAYS = 400

/** 'MM-DD' → 'yyyy-MM-dd'. 6개월 넘게 과거로 읽히면 다음 해다(연말연시 처리). */
export const dueDate = (mmdd: string, today: string) => {
  const y = +today.slice(0, 4)
  return `${y}-${mmdd}` < shift(today, -183) ? `${y + 1}-${mmdd}` : `${y}-${mmdd}`
}

/**
 * MM-DD 는 **그 행을 기록한 날** 기준으로 해석한다. 평가하는 날 기준으로 풀면 시간이 지나면서
 * 같은 행이 다른 해로 옮겨 붙어, 만료된 약속이 해가 바뀔 때 통째로 되살아난다(자동 이월 금지 위반).
 * 기록일 기준이면 한 번 정해진 마감이 영원히 그대로다.
 */
const commitments = (rows: HealthRow[]): Commitment[] =>
  rows.filter((r) => r.value === '약속').flatMap((r) => {
    const [trig = '', task = ''] = (r.extra || '').split('|')
    const p = parseTrigger(trig)
    if (!p || !task) return []
    return [{ trigger: trig, task, due: 'mmdd' in p ? dueDate(p.mmdd, day(r)) : null,
      wd: 'wd' in p ? p.wd : null, slot: 'wd' in p ? p.slot : '', at: r.start }]
  })

/** 아직 만료되지 않은 것. 날짜형은 지나면 사라지고, 요일형은 매주 다시 발생한다. */
export const activeCommitments = (rows: HealthRow[], today: string): Commitment[] =>
  commitments(rows).filter((c) => !c.due || c.due >= today)

/** 활성 5개가 상한. 과부하가 시스템을 버리게 만드는 2위 원인이라 등록 자체를 막는다. */
export const CAP = 5
export const overCap = (rows: HealthRow[], today: string): Commitment[] | null => {
  const a = activeCommitments(rows, today)
  return a.length >= CAP ? a : null
}

/**
 * 상한에 걸렸으면 거절 문구, 아니면 null. `약속`을 받는 입력 통로가 셋(MCP·단축어·웹앱)이라,
 * 문구를 한 곳에 둬야 셋이 같은 말을 한다. 약속 행을 지우는 문법은 아직 없어서(범위 밖),
 * 할 수 없는 행동을 시키지 않으려고 시트를 직접 가리킨다.
 */
export function capRefusal(rows: HealthRow[], today: string): string | null {
  const full = overCap(rows, today)
  if (!full) return null
  return '약속은 한 번에 5개까지예요. 시트 manual 탭에서 아래 중 하나의 약속 행을 지운 뒤에 다시 넣어주세요.\n' +
    full.map((c) => `- ${c.trigger} ${c.task}`).join('\n')
}

/** 오늘 트리거가 걸린 약속. 없으면 빈 배열이고, 일간 표면은 그때 아무 말도 하지 않는다. */
export function todayCommitments(rows: HealthRow[], today: string): string[] {
  const wd = DAYS[new Date(today + 'T00:00:00Z').getUTCDay()]
  return activeCommitments(rows, today).flatMap((c) => {
    if (c.due) return c.due === today ? [c.task] : []
    if (c.wd !== wd) return []
    return [c.task + (c.slot ? ` (${c.slot})` : '')]
  })
}

/** from~to 한 주의 이행. 날짜형은 그 주가 마감일 때만, 요일형은 매주 센다. */
export function commitmentWeek(rows: HealthRow[], from: string, to: string) {
  const dones = rows.filter((r) => r.value === '이행' && (r.extra || '').trim() && day(r) >= from && day(r) <= to)
    .sort((a, b) => (a.start < b.start ? -1 : 1))
  const items = commitments(rows)
    .filter((c) => (c.due ? c.due >= from && c.due <= to : true))
    .map((c) => ({ ...c, done: false as boolean }))
  // "여러 개가 걸리면 가장 최근 것 하나만 닫는다"(스펙). 부분 문자열 매칭이라 충돌이 드물지 않은데,
  // 한 줄이 여러 약속을 동시에 닫으면 이행률이 부풀고 그 숫자로 코치가 틀린 제안을 낸다.
  for (const d of dones) {
    const key = String(d.extra || '')
    const hit = items.filter((i) => !i.done && i.task.includes(key)).sort((a, b) => (a.at < b.at ? 1 : -1))[0]
    if (hit) hit.done = true
  }
  return { items, planned: items.length, done: items.filter((i) => i.done).length }
}
