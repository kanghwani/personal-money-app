import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildHealthResponse } from './health.js'
import type { HealthRow, Tabs } from './_health'

const fixture = JSON.parse(readFileSync(new URL('../public/health-fixture.json', import.meta.url), 'utf8')) as unknown
const date = (i: number) => new Date(Date.UTC(2026, 6, 6) + i * 86400_000).toISOString().slice(0, 10)
const row = (start: string, value: string, extra = '', end = start): HealthRow => ({ start, end, value, extra })

function fakeTabs(): Tabs {
  const tabs: Tabs = { hrv: [], resting_hr: [], active_kcal: [], steps: [], respiratory_rate: [], wrist_temp: [], sleep: [], workout: [], manual: [], vo2max: [] }
  for (let i = 0; i < 61; i++) {
    const d = date(i), variation = i % 5
    tabs.hrv.push(row(`${d} 00:00`, String(38 + variation)))
    tabs.resting_hr.push(row(`${d} 00:00`, String(62 + variation)))
    tabs.active_kcal.push(row(`${d} 00:00`, String(450 + variation * 20)))
    tabs.steps.push(row(`${d} 00:00`, String(8000 + variation * 500)))
    tabs.respiratory_rate.push(row(`${d} 00:00`, String(13 + variation / 10)))
    tabs.wrist_temp.push(row(`${d} 00:00`, String(35.4 + variation / 10)))
    tabs.sleep.push(row(`${d} 01:00`, '코어 수면', '', `${d} 07:${String(variation).padStart(2, '0')}`))
    if (i % 6 === 0) tabs.vo2max.push(row(`${d} 12:00`, String(42 + variation / 10)))
  }
  // 부하 주간 막대와 체력 추세가 비도록 두지 않게 12주치 세션을 채운다
  for (let w = 0; w < 12; w++) {
    const d = new Date(Date.UTC(2026, 5, 15) + w * 7 * 86400_000).toISOString().slice(0, 10)
    tabs.workout.push(row(`${d} 09:00`, 'Swimming', '55|210|900|115'))
  }
  tabs.workout.push(row('2026-08-20 07:00', 'Running', '18|130|2.0|132'), row('2026-09-02 09:15', 'Swimming', '56|218|850|113'), row('2026-09-03 07:00', 'Running', '20|150|2.5|135'))
  tabs.manual.push(
    row('2026-07-01 08:00', '계획', '월|수영,턱걸이'), row('2026-07-01 08:01', '계획', '화|걷뛰,요가'),
    row('2026-07-01 08:02', '계획', '수|수영'), row('2026-07-01 08:03', '계획', '목|걷뛰,요가'),
    row('2026-07-01 08:04', '계획', '금|수영,턱걸이'), row('2026-07-01 08:05', '계획', '토|휴식'), row('2026-07-01 08:06', '계획', '일|휴식'),
    ...Array.from({ length: 8 }, (_, i) => row(`${date(52 + i)} 08:00`, '컨디션', '4|3|2|3')),
    row('2026-08-03 10:30', 'sRPE', '수영|10|10|'), row('2026-08-10 10:30', 'sRPE', '수영|10|10|'),
    row('2026-08-17 10:30', 'sRPE', '수영|10|10|'), row('2026-08-24 10:30', 'sRPE', '수영|10|10|'),
    row('2026-09-02 10:30', 'sRPE', '수영|56|6|좋았음'), row('2026-09-03 21:00', '태그', '늦은식사|술'),
    row('2026-09-03 21:30', '메모', '어깨가 조금 뻐근'), row('2026-09-03 21:40', '통증', '무릎|3|'),
    row('2026-09-02 12:00', '턱걸이', '밴드|3|5'), row('2026-08-01 09:00', '인바디', '72.3|33.1|18.5|'),
  )
  return tabs
}

// 발견(insights)은 표본·효과크기 문턱을 넘겨야만 생기므로 합성 데이터로는 비어 있는 게 정상이다.
// 형태 검증은 _analysis.test.ts 가 맡는다.
const MAY_BE_EMPTY = new Set(['root.insights'])

function expectSameKeys(actual: unknown, expected: unknown, path = 'root'): void {
  if (expected === null || typeof expected !== 'object') return
  if (Array.isArray(expected)) {
    expect(Array.isArray(actual), path).toBe(true)
    if (expected.length && !MAY_BE_EMPTY.has(path)) {
      expect((actual as unknown[]).length, `${path} needs a sample item`).toBeGreaterThan(0)
      expectSameKeys((actual as unknown[])[0], expected[0], `${path}[0]`)
    }
    return
  }
  expect(actual && typeof actual === 'object' && !Array.isArray(actual), path).toBeTruthy()
  expect(Object.keys(actual as object).sort(), `${path} keys`).toEqual(Object.keys(expected as object).sort())
  for (const key of Object.keys(expected as object)) expectSameKeys((actual as Record<string, unknown>)[key], (expected as Record<string, unknown>)[key], `${path}.${key}`)
}

describe('health contract response', () => {
  it('가짜 tabs 응답의 키 구조가 public fixture와 일치한다', () => {
    const actual = buildHealthResponse(fakeTabs(), '2026-09-04', Date.parse('2026-09-04T04:20:00Z'))
    expectSameKeys(actual, fixture)
    expect(actual.alerts.map((a) => a.key)).toEqual(expect.arrayContaining(['load_spike', 'run_spike', 'pain']))
  })
})
