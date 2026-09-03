import { describe, it, expect } from 'vitest'
import { readiness, formatReadiness } from './_readiness'

const day = (i: number) => new Date(Date.UTC(2026, 7, 1) + i * 86400_000).toISOString().slice(0, 10)  // 08-01 + i
const rows = (vals: (number | null)[], unit = '') => vals.map((v, i) => v == null ? null : ({ start: `${day(i)} 00:00`, end: `${day(i + 1)} 00:00`, value: `${v}${unit}` })).filter(Boolean) as { start: string; end: string; value: string }[]
const night = (i: number, minutes: number) => ({ start: `${day(i)} 01:00`, end: `${day(i)} ${String(1 + Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`, value: '코어 수면' })
const N = 61; const today = day(N - 1)

describe('readiness', () => {
  it('정상 기준선이면 50~75 근처, 항목이 모두 채워진다', () => {
    const tabs = { hrv: rows(Array(N).fill(40)), resting_hr: rows(Array(N).fill(60)), sleep: Array.from({ length: N }, (_, i) => night(i, 400)),
      wrist_temp: rows(Array(N).fill(35.5)), respiratory_rate: rows(Array(N).fill(13)), active_kcal: rows(Array(N).fill(500)) }
    // 분산 0이면 z 계산 불가 → 약간의 변동
    tabs.hrv[3].value = '44'; tabs.resting_hr[3].value = '62'; tabs.wrist_temp[3].value = '35.8'; tabs.respiratory_rate[3].value = '13.5'; tabs.active_kcal[N - 10].value = '700'
    const r = readiness(tabs, today)
    expect(r.comps.map((c) => c.key)).toEqual(['hrv7', 'hrv1', 'rhr', 'sleep', 'debt', 'temp', 'rr', 'load'])
    expect(r.score).toBeGreaterThanOrEqual(50)
  })
  it('HRV 급락 + 심박 상승이면 점수가 내려가고 사유에 뜬다', () => {
    const hrv = Array(N).fill(40).map((v, i) => v + (i % 5)); hrv.splice(N - 7, 7, ...Array(7).fill(25))
    const rhr = Array(N).fill(60).map((v, i) => v + (i % 3)); rhr[N - 1] = 72
    const tabs = { hrv: rows(hrv), resting_hr: rows(rhr), sleep: Array.from({ length: N }, (_, i) => night(i, 380 + (i % 4) * 10)) }
    const r = readiness(tabs, today)
    expect(r.score).toBeLessThan(45)
    expect(r.reasons.join(' ')).toContain('HRV 7일 평균')
    expect(r.reasons.join(' ')).toContain('안정심박 72')
  })
  it('질병 패턴이면 40 상한', () => {
    const temp = Array(N).fill(35.5).map((v, i) => v + (i % 2) * 0.1); temp[N - 1] = 36.8
    const rr = Array(N).fill(13).map((v, i) => v + (i % 2) * 0.2); rr[N - 1] = 15.5
    const tabs = { hrv: rows(Array(N).fill(40).map((v, i) => v + (i % 5))), resting_hr: rows(Array(N).fill(60).map((v, i) => v + (i % 3))),
      sleep: Array.from({ length: N }, (_, i) => night(i, 400 + (i % 4) * 10)), wrist_temp: rows(temp), respiratory_rate: rows(rr) }
    const r = readiness(tabs, today)
    expect(r.score).toBeLessThanOrEqual(40); expect(r.reasons[0]).toContain('질병 가능성')
  })
  it('데이터가 적으면 축적 중', () => {
    expect(readiness({ hrv: rows([40, 41, 42]) }, today).band).toBe('기준선 축적 중')
    expect(formatReadiness(readiness({}, today), today)).toContain('축적 중')
  })
})
