import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { Tabs } from './_health.js'
import { gasGet, gasPost } from './_gas.js'
import { capRefusal, COMMITMENT_DAYS, parseLog, logStamp } from './_log.js'

/** 단축어용 한 줄 기록: GET /api/log?t=<SYNC_TOKEN>&text=컨디션 4 3 2 3 → manual 탭. 응답은 알림에 그대로 쓰는 한 줄. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store').setHeader('Content-Type', 'text/plain; charset=utf-8')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  try {
    const { stamp, text } = logStamp(String(req.query.text || ''))
    const e = parseLog(text)
    // 약속일 때만 시트를 읽어 상한을 본다 — 다른 종류는 지금처럼 조회 없이 바로 저장한다.
    if (e.kind === '약속') {
      const tabs = (await gasGet<{ tabs?: Tabs }>('healthAll', `&days=${COMMITMENT_DAYS}`)).tabs ?? {}
      const refusal = capRefusal(tabs.manual ?? [], stamp.slice(0, 10))
      if (refusal) return res.status(200).send(refusal)
    }
    const r = await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, e.kind, e.extra].join('|') }) as { added?: number }
    return res.status(200).send(`${r.added ? '기록됨' : '이미 있음'}: ${e.kind} — ${e.echo}`)
  } catch (err) {
    return res.status(200).send(`기록 실패: ${err instanceof Error ? err.message : err}`)
  }
}
