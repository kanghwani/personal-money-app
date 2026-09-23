import type { VercelRequest, VercelResponse } from '@vercel/node'
import { loadState, scan, checkResults, group, formatEvents, reminderPayload, saveRows, statusRow, stampNow, kstDate, videoUrl } from './_events.js'

/**
 * 구독자 이벤트 스캔 + 미리알림 큐 — iOS 단축어(eventsync)가 매일 09:00 에 GET 한다.
 * 한 요청에서 스캔(채널 목록 → YouTube API → new 저장)과 큐(new → reminded, 마감 안 지난 것만 반환)를 다 한다.
 * cron 이 없는 이유: 트리거가 하나면 고장 지점도 하나다. 하루 빠져도 다음 날 최근 10개를 다시 본다.
 *
 * 인증: ?t=<SYNC_TOKEN> (/api/today 와 같은 통로)
 *   &peek=1       reminded 를 안 찍는다(테스트)
 *   &all=1        new 뿐 아니라 reminded 까지, 마감 안 지난 것 전부 (미리알림을 다시 만들 때). 저장 없음
 *   &format=text  사람이 읽는 목록
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  const all = req.query.all === '1'
  const peek = req.query.peek === '1' || all
  const text = req.query.format === 'text'
  try {
    const today = kstDate(Date.now())
    const { channels, events, lastSearch } = await loadState()
    const r = await scan(channels, events, lastSearch, today)
    const everything = [...events, ...r.added]
    const rc = await checkResults(everything, today)   // 발표일 지난 지원 건에서 내 핸들 찾기 → hint 행
    const fresh = everything.filter((e) => e.status === 'new' || (all && e.status === 'reminded'))
    if (!peek) {
      const stamp = stampNow()
      await saveRows('events', fresh.map((e) => statusRow(e.id, 'reminded', '', stamp)))
    }
    const errors = [...r.errors, ...rc.errors]
    const scanLine = `채널 ${r.scanned}개 스캔${r.searched ? ' + 검색' : ''} · 새 이벤트 ${r.added.length}건 · 당첨 후보 ${rc.hints.length}건` + (rc.checked.length ? ` · 결과 검사: ${rc.checked.join(', ')}` : '') + (errors.length ? ` · 실패: ${errors.join(', ')}` : '')
    if (text) {
      return res.status(200).setHeader('Content-Type', 'text/plain; charset=utf-8')
        .send(formatEvents(group(everything, today), today) + `\n\n${scanLine}` + (peek ? '' : `\n미리알림 큐 ${fresh.length}건 전달`))
    }
    return res.status(200).json({
      events: fresh.filter((e) => e.deadline >= today).map((e) => reminderPayload(e, today)),
      hints: rc.hints.map((h) => ({ id: h.e.id, channel: h.e.channel, title: h.e.title, url: videoUrl(h.e.id), hint: h.hint })),
      scanned: r.scanned, added: r.added.length, errors, peek,
    })
  } catch (e) {
    return res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`이벤트 처리 실패: ${e instanceof Error ? e.message : e}`)
  }
}
