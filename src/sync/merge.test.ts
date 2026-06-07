import { describe, it, expect } from 'vitest'
import { pickNewer, type Snapshot } from './merge'

const snap = (updatedAt: string, n: number): Snapshot<{ n: number }> => ({
  store: { n },
  updatedAt,
})

describe('pickNewer', () => {
  it('remote가 null이면 local 반환', () => {
    const local = snap('2026-06-07T10:00:00.000Z', 1)
    expect(pickNewer(local, null)).toBe(local)
  })

  it('remote가 더 최신이면 remote 반환', () => {
    const local = snap('2026-06-07T10:00:00.000Z', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(remote)
  })

  it('local이 더 최신이면 local 반환', () => {
    const local = snap('2026-06-07T12:00:00.000Z', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(local)
  })

  it('동률이면 local 우선', () => {
    const local = snap('2026-06-07T11:00:00.000Z', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(local)
  })

  it('remote updatedAt가 유효하지 않으면 local 반환', () => {
    const local = snap('2026-06-07T10:00:00.000Z', 1)
    const remote = snap('garbage', 2)
    expect(pickNewer(local, remote)).toBe(local)
  })
})
