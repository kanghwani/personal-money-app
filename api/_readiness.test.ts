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
    // 분산 0이면 z 계산 불가 → 약간의 변동. 수면도 마찬가지다(예전에는 sd 0 을 1 로 때워서 살아남았다)
    tabs.hrv[3].value = '44'; tabs.resting_hr[3].value = '62'; tabs.wrist_temp[3].value = '35.8'; tabs.respiratory_rate[3].value = '13.5'; tabs.active_kcal[N - 10].value = '700'
    // 마지막 밤이 기준선 평균과 같아야 "평범한 날" 픽스처가 된다(주기가 저점에서 끝나면 잠 부족한 날이 된다)
    tabs.sleep = Array.from({ length: N }, (_, i) => night(i, 400 + ((i + 1) % 3) * 10))
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
  // 워치가 손목온도를 재는 밤이 관측 120일 중 39일뿐이었다.
  // 나머지 날에는 질병 판정이 성립할 수 없어서 아파도 '휴식'이 안 나왔다.
  it('손목온도가 없어도 심박·호흡이 함께 크게 튀면 질병으로 본다', () => {
    const rhr = Array(N).fill(60).map((v, i) => v + (i % 3)); rhr[N - 1] = 75
    const rr = Array(N).fill(13).map((v, i) => v + (i % 2) * 0.2); rr[N - 1] = 16
    const tabs = { hrv: rows(Array(N).fill(40).map((v, i) => v + (i % 5))), resting_hr: rows(rhr),
      sleep: Array.from({ length: N }, (_, i) => night(i, 400 + (i % 4) * 10)), respiratory_rate: rows(rr) }
    const r = readiness(tabs, today)
    expect(r.comps.some((c) => c.key === 'temp')).toBe(false)
    expect(r.band).toBe('휴식')
    expect(r.score).toBeLessThanOrEqual(40)
  })

  // 완전 휴식 권고는 한 번 틀리면 다음부터 안 믿는다. 하나만 튀는 날은 그냥 낮은 점수다.
  it('하나만 튀면 휴식이라고 하지 않는다', () => {
    const rhr = Array(N).fill(60).map((v, i) => v + (i % 3)); rhr[N - 1] = 75
    const tabs = { hrv: rows(Array(N).fill(40).map((v, i) => v + (i % 5))), resting_hr: rows(rhr),
      sleep: Array.from({ length: N }, (_, i) => night(i, 400 + (i % 4) * 10)),
      respiratory_rate: rows(Array(N).fill(13).map((v, i) => v + (i % 2) * 0.2)) }
    expect(readiness(tabs, today).band).not.toBe('휴식')
  })

  // 손목온도가 평소보다 낮다고 몸이 더 준비된 것은 아니다.
  // 양방향 채점이면 낮기만 해도 만점이 붙어 준비도가 부풀었다.
  it('손목온도가 기준선보다 낮아도 만점을 주지 않는다', () => {
    const base = { hrv: rows(Array(N).fill(40).map((v, i) => v + (i % 5))), resting_hr: rows(Array(N).fill(60).map((v, i) => v + (i % 3))),
      sleep: Array.from({ length: N }, (_, i) => night(i, 400 + (i % 4) * 10)) }
    const temp = Array(N).fill(35.6).map((v, i) => v + (i % 2) * 0.1); temp[N - 1] = 35.0
    const r = readiness({ ...base, wrist_temp: rows(temp) }, today)
    const t = r.comps.find((c) => c.key === 'temp')!
    expect(t.z).toBeGreaterThan(1)      // 기준선보다 확실히 낮다
    expect(t.sub).toBe(50)              // 그래도 중립. 가점 없음
  })

  it('손목온도가 높으면 여전히 감점한다', () => {
    const base = { hrv: rows(Array(N).fill(40).map((v, i) => v + (i % 5))), resting_hr: rows(Array(N).fill(60).map((v, i) => v + (i % 3))),
      sleep: Array.from({ length: N }, (_, i) => night(i, 400 + (i % 4) * 10)) }
    const temp = Array(N).fill(35.6).map((v, i) => v + (i % 2) * 0.1); temp[N - 1] = 36.4
    const t = readiness({ ...base, wrist_temp: rows(temp) }, today).comps.find((c) => c.key === 'temp')!
    expect(t.sub).toBeLessThan(50)
  })

  // 7일 평균을 하루치 SD로 재면 z가 늘 0 근처로 눌려 가중치 0.30 짜리 항목이 50점에 갇힌다.
  // 실제로 HRV 가 평소보다 11% 높은 주에도 준비도가 74에서 움직이지 않았다.
  it('HRV 7일 평균이 꾸준히 높으면 하루치 잡음에 묻히지 않고 점수가 오른다', () => {
    const noisy = Array.from({ length: N }, (_, i) => 40 + (i % 7) * 4 - 12)   // 하루치는 크게 흔들리고
    const up = [...noisy]; for (let i = N - 7; i < N; i++) up[i] = noisy[i] + 6  // 최근 7일만 통째로 위로
    const base = { resting_hr: rows(Array(N).fill(60).map((v, i) => v + (i % 3))), sleep: Array.from({ length: N }, (_, i) => night(i, 400 + (i % 4) * 10)) }
    const flat = readiness({ ...base, hrv: rows(noisy) }, today).comps.find((c) => c.key === 'hrv7')!
    const lifted = readiness({ ...base, hrv: rows(up) }, today).comps.find((c) => c.key === 'hrv7')!
    expect(lifted.sub).toBeGreaterThan(flat.sub + 20)
  })

  it('데이터가 적으면 축적 중', () => {
    expect(readiness({ hrv: rows([40, 41, 42]) }, today).band).toBe('기준선 축적 중')
    expect(formatReadiness(readiness({}, today), today)).toContain('축적 중')
  })
})

describe('formatFriendly', () => {
  it('구성 요소의 쉬운 말을 쓰고 잠을 먼저 보여준다', () => {
    const c = (key: string, label: string, z: number, sub: number, text: string, friendly: string) =>
      ({ key, label, w: 0.2, z, sub, text, friendly, bad: false })
    const r = {
      score: 59, band: '계획대로', reasons: [], caps: [] as string[], illness: false,
      comps: [
        c('hrv7', 'HRV 7일 평균', -0.1, 47, 'HRV 7일 평균 38ms', '회복 신호(심박 변이) 38ms — 평소 수준'),
        c('hrv1', 'HRV 어젯밤', -0.2, 45, 'HRV 37ms', '어젯밤 회복 신호 37ms — 평소 수준'),
        c('sleep', '어젯밤 수면', 1.4, 100, '수면 6h41m', '잠 6시간 41분 — 평소보다 1시간 02분 더 잠'),
      ],
    }
    const s = formatFriendly(r as never)
    expect(s).toContain('준비도 59. 무리 없이 계획대로')
    expect(s).toContain('잠 6시간 41분 — 평소보다 1시간 02분 더 잠')
    expect(s.indexOf('잠 6시간')).toBeLessThan(s.indexOf('회복 신호'))   // 걱정거리가 없으면 수면부터
    expect(s).not.toContain('어젯밤 회복 신호')                          // HRV 줄 중복 제거
  })
})
