/** 한 줄 수동 기록(폰에서 클로드에게 말하는 한 줄) → manual 탭 행. 파서와 요약은 순수 함수. */
import type { HealthRow } from './_health.js'

export type LogEntry = { kind: string; extra: string; echo: string }
const WELL = ['수면질', '피로', '스트레스', '근육통']   // 컨디션 4항목 순서 고정(Hooper 최소형)
const DAYS = ['일', '월', '화', '수', '목', '금', '토']
/** 계획 종목(한글) ↔ 워치 워크아웃 타입 */
export const SPORT: Record<string, string> = { 수영: 'Swimming', 러닝: 'Running', 달리기: 'Running', 걷뛰: 'Running', 요가: 'Yoga', 걷기: 'Walking', 자전거: 'Cycling', 등산: 'Hiking', 근력: 'FunctionalStrengthTraining', 코어: 'CoreTraining' }

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
  if (h === '계획') {
    // 계획 월 수영 턱걸이 / 계획 토 휴식 — 요일별 마지막 것이 유효
    const [d, ...items] = rest
    if (!DAYS.includes(d) || !items.length) throw new Error('계획은 "계획 요일 종목..." (예: 계획 월 수영 턱걸이, 계획 토 휴식)')
    return { kind: '계획', extra: [d, items.join(',')].join('|'), echo: `${d}요일: ${items.join(', ')}` }
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

  // 계획 대비 실행: 요일별 최신 계획 × since~today 날짜에 워치 워크아웃/턱걸이/sRPE 기록이 있는지
  const plan = new Map<string, string[]>()
  rows.filter((r) => r.value === '계획').forEach((r) => { const [d, items] = (r.extra || '').split('|'); plan.set(d, items.split(',').filter(Boolean)) })
  if (plan.size) {
    const end = today || (recent.length ? day(recent[recent.length - 1]) : since)
    const lines: string[] = []; let planned = 0, done = 0
    for (let d = since; d <= end; d = shift(d, 1)) {
      const wd = DAYS[new Date(d + 'T00:00:00Z').getUTCDay()]; const items = plan.get(wd); if (!items) continue
      const marks = items.map((it) => {
        if (it === '휴식') return '휴식'
        planned++
        const type = SPORT[it]
        const hit = (type && workouts.some((w) => day(w) === d && w.value.toLowerCase() === type.toLowerCase()))
          || (it === '턱걸이' && rows.some((r) => day(r) === d && r.value === '턱걸이'))
          || rows.some((r) => day(r) === d && r.value === 'sRPE' && (r.extra || '').split('|')[0] === it)
        if (hit) done++
        return `${it}${hit ? '✓' : '✗'}`
      })
      lines.push(`${d.slice(5)}(${wd}) ${marks.join(' ')}`)
    }
    if (lines.length) out.push(`[계획 대비 실행 ${done}/${planned}]\n${lines.join('\n')}`)
  }

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
