/** 수면 샘플(시트 sleep 탭) → 밤 단위 요약. 순수 함수라 MCP 밖에서도 테스트 가능. */
export type HealthRow = { start: string; end: string; value: string; extra?: string }

// 애플 건강(한국어) 단계 라벨. 모르는 값(테스트 행 등)은 무시한다.
const STAGE: Record<string, 'core' | 'rem' | 'deep' | 'awake'> = {
  '코어 수면': 'core', 'REM 수면': 'rem', '깊은 수면': 'deep', '깨어 있는 시간': 'awake',
}
type Night = { key: string; core: number; rem: number; deep: number; awake: number; awakenings: number; bed: number; wake: number }

/** 'yyyy-MM-dd HH:mm' → 분(UTC 기준 계산; 차이·날짜 키에만 쓰므로 시간대 무관) */
const toMin = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(s)
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) / 60000
}
const dateOf = (min: number) => new Date(min * 60000).toISOString().slice(0, 10)
const hhmm = (min: number) => new Date(min * 60000).toISOString().slice(11, 16)
export const dur = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h${String(Math.round(min % 60)).padStart(2, '0')}m` : `${Math.round(min)}m`

/** 밤 키 = 시작+12h 의 날짜 (정오~정오를 한 밤으로, 기상일 기준). 낮잠은 다음 날로 붙는 한계 있음. */
export function groupNights(rows: HealthRow[]): Night[] {
  const by = new Map<string, Night>()
  for (const r of rows) {
    const stage = STAGE[r.value]; const s = toMin(r.start); const e = toMin(r.end)
    if (!stage || isNaN(s) || isNaN(e) || e <= s) continue
    const key = dateOf(s + 12 * 60)
    const n = by.get(key) ?? { key, core: 0, rem: 0, deep: 0, awake: 0, awakenings: 0, bed: s, wake: e }
    n[stage] += e - s
    if (stage === 'awake') n.awakenings++
    n.bed = Math.min(n.bed, s); n.wake = Math.max(n.wake, e)
    by.set(key, n)
  }
  return [...by.values()].sort((a, b) => (a.key < b.key ? -1 : 1))
}

export function summarizeSleep(rows: HealthRow[]): string {
  const nights = groupNights(rows)
  if (!nights.length) return '수면 기록 없음'
  const asleep = (n: Night) => n.core + n.rem + n.deep
  const lines = nights.map((n) => {
    const a = asleep(n)
    return `${n.key.slice(5)} ${hhmm(n.bed)}→${hhmm(n.wake)} 총 ${dur(a)} · 깊은 ${dur(n.deep)}(${Math.round(n.deep / a * 100)}%) REM ${dur(n.rem)} 코어 ${dur(n.core)} · 각성 ${n.awakenings}회 ${dur(n.awake)}`
  })
  const avg = (f: (n: Night) => number) => nights.reduce((s, n) => s + f(n), 0) / nights.length
  // 취침 시각: 정오 기준 분(자정 넘김 처리) → 평균·표준편차
  const bedRel = nights.map((n) => (n.bed - toMin(n.key + ' 00:00') + 12 * 60 + 1440) % 1440)
  const bedMean = bedRel.reduce((s, v) => s + v, 0) / bedRel.length
  const bedSd = Math.sqrt(bedRel.reduce((s, v) => s + (v - bedMean) ** 2, 0) / bedRel.length)
  const bedClock = hhmm((bedMean - 12 * 60 + 1440) % 1440)
  return `최근 ${nights.length}박\n` + lines.join('\n') +
    `\n\n평균: 총수면 ${dur(avg(asleep))} · 깊은 ${Math.round(avg((n) => n.deep) / avg(asleep) * 100)}% · 각성 ${avg((n) => n.awakenings).toFixed(1)}회` +
    ` · 취침 ${bedClock} (편차 ±${Math.round(bedSd)}m)`
}

// ── 일별 지표·운동·추세 ──────────────────────────────────────
export type Tabs = Record<string, HealthRow[]>
const num = (s: string) => parseFloat(String(s).replace(/[^0-9.\-]/g, ''))   // "59 count/min" → 59

/** 일 단위 탭 → { 'yyyy-MM-dd': 값 }. 같은 날 여러 행이면 뒤(최근 수신)가 이긴다. */
export function dailySeries(rows: HealthRow[] = []): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows) { const v = num(r.value); if (!isNaN(v)) m.set(r.start.slice(0, 10), v) }
  return m
}
const mean = (xs: number[]) => xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : NaN
const fmt = (v: number, d = 0) => isNaN(v) ? '-' : v.toFixed(d)
const dayStr = (d: Date) => d.toISOString().slice(0, 10)
/** KST 기준 오늘 - n일 */
const kstDay = (n: number) => dayStr(new Date(Date.now() + 9 * 3600_000 - n * 86400_000))

// 리포트에 보여줄 일별 지표: [탭, 라벨, 소수자리, 단위]
const DAILY: [string, string, number, string][] = [
  ['resting_hr', '안정심박', 0, ''], ['hrv', 'HRV', 0, 'ms'], ['respiratory_rate', '호흡', 1, '/분'],
  ['wrist_temp', '손목온도', 1, '°'], ['spo2', 'SpO2', 0, '%'], ['breathing_disturb', '호흡장애', 1, ''],
  ['steps', '걸음', 0, ''], ['active_kcal', '활동', 0, 'kcal'], ['exercise_min', '운동', 0, '분'],
]

/** 최근 days일 일별 표 + 이전 30일 기준선 비교. */
export function summarizeDaily(tabs: Tabs, days: number): string {
  const series = DAILY.map(([tab]) => dailySeries(tabs[tab]))
  const recent = Array.from({ length: days }, (_, i) => kstDay(days - 1 - i))
  const base = Array.from({ length: 30 }, (_, i) => kstDay(days + 29 - i))
  const lines = recent.map((d) => d.slice(5) + ' ' + DAILY.map(([, label, dec, unit], i) => {
    const v = series[i].get(d); return v === undefined ? '' : `${label} ${fmt(v, dec)}${unit}`
  }).filter(Boolean).join(' · ')).filter((l) => l.length > 6)
  const baseline = DAILY.map(([, label, dec, unit], i) => {
    const r = mean(recent.map((d) => series[i].get(d)).filter((v): v is number => v !== undefined))
    const b = mean(base.map((d) => series[i].get(d)).filter((v): v is number => v !== undefined))
    if (isNaN(r)) return ''
    const diff = isNaN(b) ? '' : ` (30일 ${fmt(b, dec)}${unit}, ${r >= b ? '+' : ''}${fmt(r - b, dec)})`
    return `${label} ${fmt(r, dec)}${unit}${diff}`
  }).filter(Boolean)
  return `[일별]\n${lines.join('\n') || '기록 없음'}\n\n[최근 ${days}일 평균 vs 이전 30일]\n${baseline.join('\n')}`
}

/** 운동 세션 목록. extra = "분|kcal|거리|평균심박" (백필) 또는 단축어가 준 값 그대로. */
export function summarizeWorkouts(rows: HealthRow[] = []): string {
  if (!rows.length) return '[운동] 기록 없음'
  const KO: Record<string, string> = { Swimming: '수영', Running: '달리기', Walking: '걷기', Cycling: '자전거', Hiking: '등산', Yoga: '요가', CoreTraining: '코어', FunctionalStrengthTraining: '근력' }
  const lines = rows.map((r) => {
    // 백필: "분|kcal|거리|평균심박" 숫자만. 단축어(Actions 앱): "56 min|218|0.85 km|113" 처럼 단위가 붙을 수 있다.
    const [durS = '', kcalS = '', distS = '', hrS = ''] = (r.extra || '').split('|')
    const dur = num(durS) * (/\bh(our|r)?s?\b/.test(durS) ? 60 : 1)
    const dist = num(distS) * (/km/.test(distS) ? 1000 : 1)
    const parts = [durS && `${Math.round(dur)}분`, distS && !isNaN(dist) && (dist >= 1000 && !/\bm\b/.test(distS) && /km/.test(distS) ? `${(dist / 1000).toFixed(1)}km` : `${Math.round(dist)}m`),
      hrS && `평균심박 ${Math.round(num(hrS))}`, kcalS && `${Math.round(num(kcalS))}kcal`].filter(Boolean)
    return `${r.start.slice(5)} ${KO[r.value] || KO[r.value.charAt(0).toUpperCase() + r.value.slice(1)] || r.value} ${parts.join(' ')}`
  })
  return `[운동 ${rows.length}회]\n${lines.join('\n')}`
}

/** 한 지표의 월별 평균 추세. sleep은 밤별 총수면(분→시간). */
export function summarizeTrend(tab: string, rows: HealthRow[] = []): string {
  const by = new Map<string, number[]>()
  if (tab === 'sleep') {
    for (const n of groupNights(rows)) { const k = n.key.slice(0, 7); by.set(k, [...(by.get(k) || []), (n.core + n.rem + n.deep) / 60]) }
  } else if (tab === 'workout') {
    for (const r of rows) { const k = r.start.slice(0, 7); const dur = +(r.extra || '').split('|')[0] || 0; by.set(k, [...(by.get(k) || []), dur]) }
    return `[${tab} 월별 운동 횟수·총시간]\n` + [...by.entries()].sort().map(([k, v]) => `${k} ${v.length}회 ${Math.round(v.reduce((s, x) => s + x, 0) / 60)}h`).join('\n')
  } else {
    for (const [d, v] of dailySeries(rows)) { const k = d.slice(0, 7); by.set(k, [...(by.get(k) || []), v]) }
  }
  if (!by.size) return `${tab}: 기록 없음`
  const dec = tab === 'sleep' || tab === 'vo2max' || tab === 'wrist_temp' ? 1 : 0
  return `[${tab} 월별 평균]\n` + [...by.entries()].sort().map(([k, v]) => `${k} ${fmt(mean(v), dec)} (${v.length}일)`).join('\n')
}
