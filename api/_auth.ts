import crypto from 'node:crypto'

/** 링크 1회 인증용 쿠키 서명/검증. 비밀키는 서버 env(APP_SECRET)에만 둔다. */
export const COOKIE = 'ledger_auth'
export const MAX_AGE = 60 * 60 * 24 * 365   // 1년

const sign = (value: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(value).digest('base64url')

/** `<만료시각>.<서명>` 형태의 쿠키 값을 만든다. */
export function issue(secret: string): string {
  const exp = String(Date.now() + MAX_AGE * 1000)
  return `${exp}.${sign(exp, secret)}`
}

/** 쿠키 헤더에서 유효한 인증을 찾으면 true. 만료·위조·부재는 false. */
export function verify(cookieHeader: string | undefined, secret: string): boolean {
  if (!cookieHeader || !secret) return false
  const raw = cookieHeader.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)
  if (!raw) return false
  const [exp, sig] = decodeURIComponent(raw).split('.')
  if (!exp || !sig || Number(exp) < Date.now()) return false
  const expected = sign(exp, secret)
  // 길이가 다르면 timingSafeEqual이 던지므로 먼저 확인
  if (sig.length !== expected.length) return false
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}
