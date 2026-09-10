import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasGet } from './_gas.js'
import { readiness, formatReadiness, formatFriendly } from './_readiness.js'
import { todayCommitments } from './_log.js'
import type { Tabs } from './_health.js'

/**
 * 오늘 준비도 텍스트 — iOS 단축어가 업로드 직후 GET 해서 알림으로 띄운다(워치에도 뜸).
 * 인증: ?t=<SYNC_TOKEN> (단축어가 이미 갖고 있는 GAS 토큰과 동일).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  try {
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=400')).tabs ?? {}
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const r = readiness(t, today)
    const todos = todayCommitments(t.manual ?? [], today)
    const text = isNaN(r.score) ? formatReadiness(r, today, todos) : formatFriendly(r, todos)   // 알림용 쉬운 말
    return res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send(text)
  } catch (e) {
    return res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`준비도 계산 실패: ${e instanceof Error ? e.message : e}`)
  }
}
