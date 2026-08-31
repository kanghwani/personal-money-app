import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verify } from './_auth.js'

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

  // 링크 1회 인증으로 심은 쿠키가 있어야 통과 (없으면 원장에 접근 불가)
  if (!verify(req.headers.cookie, process.env.APP_SECRET || '')) {
    return res.status(401).json({ ok: false, error: 'unauthorized', hint: '인증 링크로 다시 접속하세요' })
  }

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
