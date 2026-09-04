import type { VercelRequest, VercelResponse } from '@vercel/node'
import { verify } from './_auth.js'
import { gasGet, gasPost } from './_gas.js'
import { readiness, formatFriendly } from './_readiness.js'
import { parseLog, logStamp, planWeek, SPORT } from './_log.js'
import type { Tabs, HealthRow } from './_health.js'

/**
 * 건강 화면(/health.html)용 API. 가계부와 같은 링크 1회 인증 쿠키.
 *   GET  → 오늘 준비도·오늘/어제 운동·오늘 수동기록·이번 주 계획 대비
 *   POST {text} → health_log 와 같은 한 줄 파서로 manual 탭 저장
 */
const kst = (offsetDays = 0) => new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000).toISOString().slice(0, 10)
const KO = Object.fromEntries(Object.entries(SPORT).map(([k, v]) => [v.toLowerCase(), k]))

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if (!verify(req.headers.cookie, process.env.APP_SECRET || '')) return res.status(401).json({ ok: false, error: 'unauthorized' })
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body ?? {})
      const { stamp, text } = logStamp(String(body.text || ''))
      const e = parseLog(text)
      const r = await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, e.kind, e.extra].join('|') }) as { added?: number }
      return res.status(200).json({ ok: true, added: !!r.added, kind: e.kind, echo: e.echo })
    }
    const today = kst(), yesterday = kst(-1)
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=75')).tabs ?? {}
    const r = readiness(t, today)
    const day = (x: HealthRow) => x.start.slice(0, 10)
    const workouts = (t.workout ?? []).filter((w) => day(w) >= yesterday).map((w) => {
      const [dur = '', kcal = '', dist = '', hr = ''] = (w.extra || '').split('|')
      return { date: day(w), start: w.start.slice(11, 16), type: w.value, ko: KO[w.value.toLowerCase()] || w.value, minutes: Math.round(parseFloat(dur) || 0), kcal: Math.round(parseFloat(kcal) || 0), dist, hr: Math.round(parseFloat(hr) || 0) }
    })
    const manual = (t.manual ?? []).filter((m) => day(m) >= yesterday).map((m) => ({ date: day(m), time: m.start.slice(11, 16), kind: m.value, extra: m.extra || '' }))
    // 이번 주(월요일부터)
    const dow = new Date(today + 'T00:00:00Z').getUTCDay(); const monday = kst(-((dow + 6) % 7))
    const week = planWeek(t.manual ?? [], t.workout ?? [], monday, today)
    const sleep = (t.sleep ?? []).filter((s) => s.start >= yesterday)
    return res.status(200).json({ ok: true, today, readiness: { score: r.score, band: r.band, text: formatFriendly(r), reasons: r.reasons }, workouts, manual, week, hasSleep: sleep.length > 0 })
  } catch (err) {
    return res.status(200).json({ ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
