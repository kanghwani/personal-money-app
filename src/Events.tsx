import { useCallback, useEffect, useState, type ReactNode } from 'react'
import './Events.css'

// api/_events.ts 의 Event 중 화면에 쓰는 것만. api 폴더는 앱 tsconfig 밖이라 가져오지 않는다
type Ev = {
  id: string; channel: string; title: string
  deadline: string; announce: string; deadlineGuessed: boolean; announceGuessed: boolean
  excerpt: string; status: string; note: string; updated: string
  comments?: number; hint?: string
  grade?: { prize: string; value: number; winners: number; worth: number }
}
type Data = { today: string; pending: Ev[]; applied: Ev[]; results: Ev[]; missed: Ev[] }

const WORTH_MIN = 4   // 서버 WORTH_MIN·맥 알림 기준과 같게
const md = (ymd: string, guessed = false) => ymd.slice(5) + (guessed ? '?' : '')
const won = (n: number) => (n >= 10000 ? `${Math.round(n / 10000)}만` : n.toLocaleString()) + '원'

async function call(log?: string): Promise<Data | string> {
  const res = await fetch('/api/events', log
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ log }) }
    : { cache: 'no-store' })
  if (res.status === 401) throw new Error('인증 링크로 다시 접속하세요')
  const d = await res.json()
  if (!d.ok) throw new Error(d.error || '서버 오류')
  return log ? d.message : d
}

export default function Events() {
  const [data, setData] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const [all, setAll] = useState(false)

  const load = useCallback(() => call().then((d) => setData(d as Data), (e) => setErr(e.message)), [])
  useEffect(() => { load() }, [load])

  const act = async (word: string, e: Ev) => {
    let note = ''
    if (word === '당첨') note = window.prompt(`${e.channel} 당첨 — 경품 메모(선택)`, e.grade?.prize ?? '') ?? ''
    setBusy(e.id)
    try { setMsg(await call(`${word} ${e.id}${note ? ' ' + note : ''}`) as string); await load() }
    catch (x) { setMsg((x as Error).message) }
    finally { setBusy('') }
  }

  if (err) return <main className="ev"><p className="ev-err">{err}</p></main>
  if (!data) return <main className="ev"><p className="ev-muted">불러오는 중…</p></main>

  const t = data.today
  const hits = data.applied.filter((e) => e.hint)
  const due = data.applied.filter((e) => !e.hint && e.announce <= t)
  const waiting = data.applied.filter((e) => !e.hint && e.announce > t)
  const good = data.pending.filter((e) => (e.grade?.worth ?? 0) >= WORTH_MIN)
  const pending = all ? data.pending : good

  const row = (e: Ev, buttons: string[], sub: string) => (
    <li key={e.id} className="ev-row">
      <a href={`https://youtu.be/${e.id}`} target="_blank" rel="noreferrer">
        <span className="ev-ch">{e.channel}</span> {e.title}
      </a>
      <div className="ev-sub">{sub}</div>
      {e.hint && <div className="ev-hint">당첨 후보 · {e.hint}</div>}
      {buttons.length > 0 && (
        <div className="ev-btns">
          {buttons.map((b) => <button key={b} disabled={busy === e.id} onClick={() => act(b, e)}>{b}</button>)}
        </div>
      )}
    </li>
  )
  const gradeText = (e: Ev) => e.grade ? `${e.grade.prize}${e.grade.value ? ` ~${won(e.grade.value)}` : ''} ×${e.grade.winners} · ${e.grade.worth}/5` : '미채점'
  const section = (title: string, list: Ev[], render: (e: Ev) => ReactNode, extra?: ReactNode) =>
    list.length > 0 || extra ? <section><h2>{title} <span className="ev-n">{list.length}</span>{extra}</h2><ul>{list.map(render)}</ul></section> : null

  return (
    <main className="ev">
      <header><h1>구독자 이벤트</h1><span className="ev-muted">{t}</span></header>
      {msg && <p className="ev-msg" onClick={() => setMsg('')}>{msg}</p>}
      {section('당첨 후보', hits, (e) => row(e, ['당첨', '탈락'], `발표 ${md(e.announce, e.announceGuessed)}`))}
      {section('결과 확인', due, (e) => row(e, ['당첨', '탈락'], `발표 ${md(e.announce, e.announceGuessed)} 지남 · 커뮤니티·고정 댓글 확인`))}
      {section('발표 대기', waiting, (e) => row(e, ['당첨', '탈락'], `발표 ${md(e.announce, e.announceGuessed)}`))}
      {section('지원 대기', pending, (e) => row(e, ['지원', '패스'], `마감 ${md(e.deadline, e.deadlineGuessed)} · ${gradeText(e)}`),
        <button className="ev-toggle" onClick={() => setAll(!all)}>{all ? `응모가치 ${WORTH_MIN}↑만` : `전체 ${data.pending.length}건`}</button>)}
      {section('최근 결과', data.results, (e) => row(e, [], `${e.status === 'won' ? '당첨' : '탈락'} ${md(e.updated)}${e.note ? ' · ' + e.note : ''}`))}
      {data.missed.length > 0 && <p className="ev-muted">마감 지나 놓친 것 {data.missed.length}건</p>}
    </main>
  )
}
