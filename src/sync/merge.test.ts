import { describe, it, expect } from 'vitest'
import { pickNewer, dedupById, keepPending, type Snapshot } from './merge'

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

  it('local updatedAt가 무효이고 remote가 유효하면 remote 반환', () => {
    const local = snap('garbage', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(remote)
  })
})

describe('dedupById', () => {
  const t = (id: string, n: number) => ({ id, n })

  it('history만 있으면 그대로', () => {
    expect(dedupById([t('a', 1), t('b', 2)], [])).toEqual([t('a', 1), t('b', 2)])
  })

  it('store만 있으면 그대로', () => {
    expect(dedupById([], [t('a', 1)])).toEqual([t('a', 1)])
  })

  it('같은 id는 store가 우선', () => {
    const res = dedupById([t('a', 1)], [t('a', 99)])
    expect(res).toEqual([t('a', 99)])
  })

  it('history+store 병합(중복 없음)', () => {
    const res = dedupById([t('a', 1)], [t('b', 2)])
    expect(res.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })
})

describe('keepPending', () => {
  // 다른 기기가 더 최신이면 store 가 통째로 교체된다. 그때 방금 입력해서
  // 아직 원장에 못 올린 거래가 조용히 사라졌다. (2,700원 한 건을 그렇게 잃었다)
  const tx = (id: string, memo = id) => ({ id, date: '2026-06-01', amount: 2700, memo })
  const key = (t: { date: string; amount: number; memo?: string }) => `${t.date}|${t.amount}|${(t.memo || '').trim()}`

  it('원격에도 원장에도 없는 로컬 거래를 살린다', () => {
    expect(keepPending([tx('new')], [tx('old')], new Set(), key)).toEqual([tx('new'), tx('old')])
  })

  it('원장에 이미 들어간 거래는 다시 넣지 않는다', () => {
    expect(keepPending([tx('done')], [], new Set([key(tx('done'))]), key)).toEqual([])
  })

  // id 만 보면 원장에서 고쳐 저장해 id 가 바뀐 거래를 '못 보낸 것'으로 오해해 되살린다.
  // 실제로 5~6월 거래 10건이 그렇게 원장에 두 번 들어갔다.
  it('id가 달라도 내용이 같으면 이미 원장에 있는 것으로 본다', () => {
    const local = { id: 'old-id', date: '2026-06-01', amount: 2700, memo: '카페' }
    const inLedger = { id: 'new-id', date: '2026-06-01', amount: 2700, memo: '카페' }
    expect(keepPending([local], [], new Set([key(inLedger)]), key)).toEqual([])
  })

  it('원격에 같은 id가 있으면 원격을 쓴다', () => {
    expect(keepPending([tx('a')], [tx('a')], new Set(), key)).toEqual([tx('a')])
  })
})
