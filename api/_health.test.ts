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
