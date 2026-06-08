import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadFromServer, saveToServer, loadLedger, assignCategory, type SyncConfig } from './syncClient'

const cfg: SyncConfig = { url: 'https://script.example/exec', token: 'secret-tok' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFromServer', () => {
  it('cfg가 없으면 null', async () => {
    expect(await loadFromServer(null)).toBeNull()
  })

  it('action=load&token 쿼리로 GET하고 store를 파싱한다', async () => {
    const store = { n: 1 }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, store: JSON.stringify(store), updatedAt: '2026-06-07T11:00:00.000Z' }),
    })
    const result = await loadFromServer<typeof store>(cfg)
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('action=load')
    expect(calledUrl).toContain('token=secret-tok')
    expect(result).toEqual({ store, updatedAt: '2026-06-07T11:00:00.000Z' })
  })

  it('서버가 빈 store면 null', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, store: '', updatedAt: '' }),
    })
    expect(await loadFromServer(cfg)).toBeNull()
  })
})

describe('saveToServer', () => {
  it('text/plain POST로 action=save 본문을 보낸다', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, updatedAt: '2026-06-07T11:00:00.000Z' }),
    })
    const ok = await saveToServer({ n: 2 }, '2026-06-07T11:00:00.000Z', cfg)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(cfg.url)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('text/plain;charset=utf-8')
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe('save')
    expect(body.token).toBe('secret-tok')
    expect(JSON.parse(body.store)).toEqual({ n: 2 })
    expect(ok).toBe(true)
  })

  it('cfg가 없으면 false', async () => {
    expect(await saveToServer({ n: 1 }, 'x', null)).toBe(false)
  })
})

describe('네트워크 오류 계약', () => {
  it('loadFromServer는 fetch 거부 시 throw한다 (null로 삼키지 않음)', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))
    await expect(loadFromServer(cfg)).rejects.toThrow('network down')
  })

  it('saveToServer는 fetch 거부 시 throw한다', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network down'))
    await expect(saveToServer({ n: 1 }, 'x', cfg)).rejects.toThrow('network down')
  })
})

describe('loadLedger', () => {
  it('cfg가 없으면 빈 배열', async () => {
    expect(await loadLedger(null)).toEqual([])
  })

  it('action=ledger 쿼리로 GET하고 transactions를 반환', async () => {
    const txns = [{ id: 'a', amount: 1 }]
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, transactions: txns }),
    })
    const result = await loadLedger(cfg)
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('action=ledger')
    expect(url).toContain('token=secret-tok')
    expect(result).toEqual(txns)
  })

  it('ok가 아니면 빈 배열', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: false }),
    })
    expect(await loadLedger(cfg)).toEqual([])
  })
})

describe('assignCategory', () => {
  it('cfg 없으면 false', async () => {
    expect(await assignCategory('id1', '식비', '외식', null)).toBe(false)
  })
  it('text/plain POST로 assignCategory 본문 전송, ok 반환', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true, updated: 1 }) })
    const ok = await assignCategory('id1', '식비', '외식', cfg)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(cfg.url)
    expect(init.headers['Content-Type']).toBe('text/plain;charset=utf-8')
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe('assignCategory')
    expect(body).toMatchObject({ id: 'id1', category: '식비', subCategory: '외식', token: 'secret-tok' })
    expect(ok).toBe(true)
  })
})
