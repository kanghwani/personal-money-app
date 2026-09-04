import { describe, expect, it } from 'vitest'
import { nightRows, nightSegments, stagesFrom, dailyLoad, loadSummary, insights } from './_analysis'
import type { HealthRow, Tabs } from './_health'

const row = (start: string, end: string, value: string, extra = ''): HealthRow => ({ start, end, value, extra })
const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86400_000).toISOString().slice(0, 10)

describe('nightRows', () => {
  it('단계가 있으면 단계 합, 없으면 침대에 있음 길이를 총수면으로 쓴다', () => {
    const rows = [
      row('2026-03-01 01:00', '2026-03-01 03:00', '코어 수면'),
      row('2026-03-01 03:00', '2026-03-01 04:00', '깊은 수면'),
      row('2026-03-01 04:00', '2026-03-01 04:10', '깨어 있는 시간'),
      row('2020-05-02 00:30', '2020-05-02 07:00', '침대에 있음'),   // 예전 밤: 단계 없음
    ]
    const n = nightRows(rows)
    expect(n.map((x) => x.key)).toEqual(['2020-05-02', '2026-03-01'])
    expect(n[0]).toMatchObject({ hasStages: false, totalMin: 390 })
    expect(n[1]).toMatchObject({ hasStages: true, totalMin: 180, deep: 60, awake: 10, awakenings: 1 })
    expect(n[1].bed).toBe('01:00')
  })
  it('단계 구간을 뽑고, 산발적 초기 기록은 단계 시작일로 치지 않는다', () => {
    const rows = [row('2026-03-01 01:00', '2026-03-01 01:30', '코어 수면'), row('2020-05-02 00:30', '2020-05-02 07:00', '침대에 있음')]
    expect(nightSegments(rows, '2026-03-01')).toEqual([{ start: '01:00', end: '01:30', stage: 'core', min: 30 }])
    expect(nightSegments(rows, '2020-05-02')).toEqual([])
    expect(stagesFrom(rows)).toBeNull()                       // 한 달에 10일 미만이면 아직 자리잡지 않은 것
    const settled = [...rows, ...Array.from({ length: 12 }, (_, i) =>
      row(`2026-05-${String(i + 1).padStart(2, '0')} 01:00`, `2026-05-${String(i + 1).padStart(2, '0')} 02:00`, '코어 수면'))]
    expect(stagesFrom(settled)).toBe('2026-05-01')
  })
})

describe('dailyLoad / loadSummary', () => {
  it('심박이 높을수록 같은 시간이라도 부하가 크다', () => {
    const easy = dailyLoad([row('2026-03-01 09:00', '', 'Swimming', '60|200|1000|100')], 60)
    const hard = dailyLoad([row('2026-03-01 09:00', '', 'Swimming', '60|200|1000|150')], 60)
    expect(hard.get('2026-03-01')!.load).toBeGreaterThan(easy.get('2026-03-01')!.load * 1.5)
  })
  it('심박이 없으면 종목 기본 강도를 쓴다', () => {
    expect(dailyLoad([row('2026-03-01 09:00', '', 'Swimming', '60|200|1000|')], 60).get('2026-03-01')!.load).toBeGreaterThan(0)
  })
  it('세션이 적으면 데이터부족, 꾸준하면 유지', () => {
    expect(loadSummary(new Map(), '2026-03-01').status).toBe('데이터부족')
    const daily = new Map(Array.from({ length: 28 }, (_, i) => [day(i), { load: 40, sessions: 1 }] as const))
    const s = loadSummary(daily, day(27))
    expect(s.status).toBe('유지')
    expect(s.ratio).toBeCloseTo(1, 1)
    expect(s.weeks).toHaveLength(12)
  })
  it('최근 일주일만 몰리면 과부하', () => {
    const daily = new Map<string, { load: number; sessions: number }>()
    for (let i = 0; i < 28; i++) daily.set(day(i), { load: i >= 21 ? 300 : 20, sessions: 1 })
    expect(loadSummary(daily, day(27)).status).toBe('과부하')
  })
})

describe('insights', () => {
  const build = (): Tabs => {
    const hrv: HealthRow[] = [], workout: HealthRow[] = []
    // 60일: 이틀에 한 번 운동, 운동 다음 날 HRV 를 확실히 높게 만든다
    for (let i = 0; i < 120; i++) {
      const d = day(i)
      const workedYesterday = i > 0 && (i - 1) % 2 === 0
      hrv.push(row(`${d} 00:00`, `${d} 00:00`, String(workedYesterday ? 48 + (i % 3) : 36 + (i % 3))))
      if (i % 2 === 0) workout.push(row(`${d} 09:00`, `${d} 10:00`, 'Swimming', '60|200|1000|120'))
    }
    return { hrv, workout } as Tabs
  }
  it('표본과 효과크기를 넘긴 발견만 낸다', () => {
    const tabs = build()
    const found = insights(tabs, day(119), dailyLoad(tabs.workout, 60))
    const w = found.find((f) => f.id === 'workout_recovery')
    expect(w).toBeTruthy()
    expect(w!.evidence).toMatch(/효과크기/)
    expect(w!.detail).toMatch(/HRV/)
    expect(found.length).toBeLessThanOrEqual(5)
    // 계약(public/health-fixture.json)의 발견 항목과 같은 키를 갖는다
    expect(Object.keys(w!).sort()).toEqual(['detail', 'evidence', 'id', 'n', 'strength', 'title', 'tone'])
    expect(['약함', '중간', '뚜렷함']).toContain(w!.strength)
    expect(['good', 'neutral', 'warn']).toContain(w!.tone)
  })
  it('표본이 적으면 아무것도 내지 않는다', () => {
    const tabs = { hrv: [row('2026-03-01 00:00', '', '40')], workout: [] } as unknown as Tabs
    expect(insights(tabs, '2026-03-01', new Map())).toEqual([])
  })
})
