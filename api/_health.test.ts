import { describe, it, expect } from 'vitest'
import { groupNights, summarizeSleep } from './_health'

const rows = [
  { start: '2026-09-02 23:10', end: '2026-09-02 23:40', value: 'Core' },        // 모르는 라벨 → 무시
  { start: '2026-09-03 01:27', end: '2026-09-03 01:40', value: '코어 수면' },   // 자정 넘긴 취침 → 09-03 밤
  { start: '2026-09-03 01:40', end: '2026-09-03 02:10', value: '깊은 수면' },
  { start: '2026-09-03 02:10', end: '2026-09-03 02:15', value: '깨어 있는 시간' },
  { start: '2026-09-03 02:15', end: '2026-09-03 03:00', value: 'REM 수면' },
  { start: '2026-09-01 23:30', end: '2026-09-02 00:30', value: '코어 수면' },   // 자정 전 취침 → 09-02 밤
  { start: '2026-09-02 00:30', end: '2026-09-02 07:00', value: '코어 수면' },
]

describe('groupNights', () => {
  it('정오~정오를 한 밤으로 묶고 기상일을 키로 쓴다', () => {
    const n = groupNights(rows)
    expect(n.map((x) => x.key)).toEqual(['2026-09-02', '2026-09-03'])
    expect(n[1]).toMatchObject({ core: 13, deep: 30, rem: 45, awake: 5, awakenings: 1 })
    expect(n[0].core).toBe(450)
  })
})

describe('summarizeSleep', () => {
  it('밤별 줄과 평균을 낸다', () => {
    const s = summarizeSleep(rows)
    expect(s).toContain('09-03 01:27→03:00 총 1h28m')
    expect(s).toContain('깊은 30m(34%)')
    expect(s).toContain('평균: 총수면')
    expect(summarizeSleep([])).toBe('수면 기록 없음')
  })
})

import { dailySeries, summarizeDaily, summarizeWorkouts, summarizeTrend } from './_health'

describe('daily/workout/trend', () => {
  it('dailySeries는 같은 날 뒤 행이 이기고 단위를 벗긴다', () => {
    const m = dailySeries([{ start: '2026-09-01 00:00', end: '', value: '57' }, { start: '2026-09-01 00:00', end: '', value: '59 count/min' }])
    expect(m.get('2026-09-01')).toBe(59)
  })
  it('summarizeDaily는 최근 표와 기준선을 낸다', () => {
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const s = summarizeDaily({ resting_hr: [{ start: `${today} 00:00`, end: '', value: '59' }] }, 7)
    expect(s).toContain('안정심박 59')
    expect(s).toContain('[최근 7일 평균 vs 이전 30일]')
  })
  it('summarizeWorkouts는 백필 extra를 풀어 쓴다', () => {
    const s = summarizeWorkouts([{ start: '2026-09-02 09:15', end: '2026-09-02 10:11', value: 'Swimming', extra: '55.9|218.3|850|112.5' }])
    expect(s).toContain('09-02 09:15 수영 56분 850m 평균심박 113 218kcal')
  })
  it('summarizeTrend는 월별 평균', () => {
    const s = summarizeTrend('resting_hr', [{ start: '2026-08-01 00:00', end: '', value: '58' }, { start: '2026-08-02 00:00', end: '', value: '60' }, { start: '2026-09-01 00:00', end: '', value: '55' }])
    expect(s).toContain('2026-08 59 (2일)')
    expect(s).toContain('2026-09 55 (1일)')
  })
})
