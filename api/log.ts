import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasPost } from './_gas.js'
import { parseLog, logStamp } from './_log.js'

/** 단축어용 한 줄 기록: GET /api/log?t=<SYNC_TOKEN>&text=컨디션 4 3 2 3 → manual 탭. 응답은 알림에 그대로 쓰는 한 줄. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store').setHeader('Content-Type', 'text/plain; charset=utf-8')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  try {
    const { stamp, text } = logStamp(String(req.query.text || ''))
    const e = parseLog(text)
    const r = await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, e.kind, e.extra].join('|') }) as { added?: number }
    return res.status(200).send(`${r.added ? '기록됨' : '이미 있음'}: ${e.kind} — ${e.echo}`)
  } catch (err) {
    return res.status(200).send(`기록 실패: ${err instanceof Error ? err.message : err}`)
  }
}
