import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasGet } from './_gas.js'
import { alertFor, coachAdvice, coachDate, type CoachTx } from '../src/coach.js'
import type { FixedDef } from '../src/dashboardLogic.js'

/**
 * 가계부 코치 — 맥 eventsync 가 07:27·09:00 에 GET 해서 alert 가 있으면 미리알림 "가계부" 에 하나 만든다.
 * 판단은 앱 홈과 같은 src/coach.ts. 상태를 저장하지 않아 몇 번 불러도 같은 답이다.
 * 인증: ?t=<SYNC_TOKEN>. &date=YYYY-MM-DD 로 특정 날의 알림을 실데이터로 미리 본다(읽기 전용).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  const date = coachDate(req.query.date, Date.now())
  try {
    // 고정비가 빠지면 할부가 실적에서 빠져 틀린 "실적 부족" 이 나온다 → 둘 다 읽혀야 조언한다.
    const [ledger, fixed] = await Promise.all([
      gasGet<{ transactions?: CoachTx[] }>('ledger'),
      gasGet<{ defs?: FixedDef[] }>('fixedList'),
    ])
    if (!ledger.transactions || !fixed.defs) throw new Error('원장 또는 고정비 응답이 비었다')
    return res.status(200).json({
      date,
      alert: alertFor(ledger.transactions, fixed.defs, date),
      advice: coachAdvice(ledger.transactions, fixed.defs, date),
    })
  } catch (e) {
    return res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`코치 실패: ${e instanceof Error ? e.message : e}`)
  }
}
