import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasGet } from './_gas.js'
import { readiness, formatReadiness } from './_readiness.js'
import type { Tabs } from './_health.js'

/**
 * 오늘 준비도 텍스트 — iOS 단축어가 업로드 직후 GET 해서 알림으로 띄운다(워치에도 뜸).
 * 인증: ?t=<SYNC_TOKEN> (단축어가 이미 갖고 있는 GAS 토큰과 동일).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  try {
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=75')).tabs ?? {}
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const r = readiness(t, today)
    // 알림용: 첫 줄 점수, 그 뒤 사유 최대 3줄 (구성 점수는 생략)
    const text = isNaN(r.score) ? formatReadiness(r, today) : `준비도 ${r.score} · ${r.band}\n${r.reasons.slice(0, 3).join('\n')}`
    return res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send(text)
  } catch (e) {
    return res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`준비도 계산 실패: ${e instanceof Error ? e.message : e}`)
  }
}
