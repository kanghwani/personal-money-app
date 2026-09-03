/** 수면 샘플(시트 sleep 탭) → 밤 단위 요약. 순수 함수라 MCP 밖에서도 테스트 가능. */
export type HealthRow = { start: string; end: string; value: string }

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
