import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * 가계부 백엔드(GAS) 프록시.
 * 토큰을 서버에서만 붙여서, 클라이언트 번들에 토큰이 박히지 않게 한다.
 * (예전엔 VITE_SYNC_TOKEN이 공개 JS에 그대로 들어가 있었음)
 *
 * 환경변수: SYNC_URL, SYNC_TOKEN (둘 다 서버 전용 — VITE_ 접두어 금지)
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const gas = process.env.SYNC_URL
  const token = process.env.SYNC_TOKEN
  if (!gas || !token) return res.status(500).json({ ok: false, error: 'SYNC_URL/SYNC_TOKEN 미설정' })

  res.setHeader('Cache-Control', 'no-store')

  try {
    if (req.method === 'GET') {
      const p = new URLSearchParams()
      for (const [k, v] of Object.entries(req.query)) {
        if (k === 'token') continue                    // 클라이언트가 보낸 토큰은 무시
        p.set(k, Array.isArray(v) ? v[0] : String(v ?? ''))
      }
      p.set('token', token)                            // 서버 토큰만 사용
      const r = await fetch(`${gas}?${p.toString()}`, { redirect: 'follow' })
      return res.status(r.ok ? 200 : 502).send(await r.text())
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
      delete (body as Record<string, unknown>).token
      const r = await fetch(gas, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...body, token }),
      })
      return res.status(r.ok ? 200 : 502).send(await r.text())
    }

    return res.status(405).json({ ok: false, error: 'method not allowed' })
  } catch (err) {
    return res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
