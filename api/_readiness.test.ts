import { describe, it, expect } from 'vitest'
import { readiness, formatReadiness, formatFriendly } from './_readiness'

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

describe('formatFriendly', () => {
  it('숫자 대신 말로, 잠은 항상 포함', () => {
    const r = { score: 59, band: '계획대로', reasons: ['수면 5h30m (평소 5h42m, -12m)'], comps: [
      { key: 'sleep', label: '어젯밤 수면', w: .2, z: -0.3, sub: 48, bad: false, text: '수면 5h30m (평소 5h42m, -12m)' },
      { key: 'hrv7', label: 'HRV 7일 평균', w: .3, z: -0.1, sub: 47, bad: false, text: 'HRV 7일 평균 38ms (평소 39, -2%)' },
      { key: 'load', label: '전날 부하', w: .05, z: -0.7, sub: 73, bad: false, text: '전날 활동 697kcal (28일 평균 499)' },
    ] }
    const s = formatFriendly(r as never)
    expect(s).toContain('준비도 59 — 무리 없이 계획대로')
    expect(s).toContain('잠 5시간 30분 — 평소보다 12분 부족')
    expect(s).toContain('회복 신호(심박 변이) — 평소 수준')
    expect(s).toContain('어제 활동량이 평소보다 많았음')
  })
})
