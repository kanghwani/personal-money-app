import type { VercelRequest, VercelResponse } from '@vercel/node'
import { COOKIE, MAX_AGE, issue } from './_auth.js'

/**
 * 링크 1회 인증. `/api/login?k=<APP_SECRET>` 로 접속하면 쿠키를 심고 앱으로 보낸다.
 * 이후에는 홈 화면 아이콘으로 그냥 열면 된다(쿠키 1년).
 * 키가 새면 APP_SECRET만 바꾸면 전원 로그아웃된다.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  const secret = process.env.APP_SECRET
  if (!secret) return res.status(500).send('APP_SECRET 미설정')

  const given = (req.query.k as string) || ''
  if (given !== secret) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(401).send(
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<div style="font-family:-apple-system,sans-serif;padding:40px;text-align:center;color:#2e2a26">' +
      '<h2>인증이 필요합니다</h2><p>받은 인증 링크로 접속해 주세요.</p></div>'
    )
  }

  res.setHeader('Set-Cookie',
    `${COOKIE}=${issue(secret)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`)
  res.setHeader('Location', '/')
  return res.status(302).end()
}
