import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasGet, gasPost } from './_gas.js'
import { weekReview, mondayOf, adviceToExtra } from './_coach.js'
import type { Tabs } from './_health.js'

/**
 * 주간 코치 제안을 서버가 직접 저장한다 (매주 일요일, vercel.json 의 crons).
 *
 * 왜 서버가 하나: 제안을 저장하는 데는 LLM 이 필요 없다. weekReview() 가 전부 계산하고
 * 여기서는 그 결과를 시트에 쓸 뿐이다. 클로드 앱 예약작업에 맡겼더니 커넥터가 실행 환경에
 * 안 실려 **2주 연속 조용히 실패**했고(9/6·9/13), 그 사이 이행 평가 사슬이 끊겼다.
 * 저장은 서버가 맡고, 앱 예약작업은 읽기 좋은 요약(노션)만 담당하게 역할을 나눈다.
 *
 * 중복 걱정 없음: 같은 주에 이미 코치 행이 있으면 저장하지 않는다. 앱 작업이 살아나서
 * 둘 다 돌아도 먼저 도는 쪽이 저장하고 나중은 조용히 넘어간다.
 *
 * 인증: Vercel 크론은 CRON_SECRET 을 Bearer 로 실어 보낸다. 손으로 돌릴 때는
 * ?t=<SYNC_TOKEN> (/api/today 와 같은 통로).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store').setHeader('Content-Type', 'text/plain; charset=utf-8')

  const cronSecret = process.env.CRON_SECRET
  const byCron = !!cronSecret && req.headers.authorization === `Bearer ${cronSecret}`
  const byToken = !!process.env.SYNC_TOKEN && (req.query.t as string) === process.env.SYNC_TOKEN
  if (!byCron && !byToken) return res.status(401).send('unauthorized')

  try {
    const tabs = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const thisMonday = mondayOf(today)

    // 이번 주에 이미 저장됐으면 아무것도 하지 않는다(앱 예약작업이 먼저 돌았을 수 있다).
    const already = (tabs.manual ?? []).some((m) => m.value === '코치' && m.start.slice(0, 10) >= thisMonday)
    if (already) return res.status(200).send(`이미 저장됨 (${thisMonday} 주)`)

    const r = weekReview(tabs, today)
    const stamp = `${today} 09:00:00`
    await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, '코치', adviceToExtra('주간', r.advice)].join('|') })
    return res.status(200).send(`저장됨 (${r.week}): ${r.advice.text}`)
  } catch (e) {
    // 크론 실패는 조용히 지나가면 안 된다. 500 으로 내야 Vercel 대시보드에 실패로 남는다.
    return res.status(500).send(`주간 제안 저장 실패: ${e instanceof Error ? e.message : e}`)
  }
}
