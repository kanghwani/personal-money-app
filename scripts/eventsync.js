// 맥 미리알림 생성 (JXA). eventsync.py 가 JSON 파일 경로를 넘긴다. 직접 실행하지 않는다.
//   events: [지원] 마감 전날 09:00 (이미 응모가치로 걸러진 것)   applied: [결과] 발표일 09:00 (응모한 것만)   hints: [당첨확인] 지금+5분
ObjC.import('Foundation')
function run(argv) {
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js
  const data = JSON.parse(raw)
  const R = Application('Reminders')
  const list = R.lists.byName('이벤트')
  const have = new Set(list.reminders.name())   // 같은 제목은 다시 만들지 않는다
  let made = 0
  const mk = (name, body, at) => {
    if (have.has(name)) return
    list.reminders.push(R.Reminder({ name, body, dueDate: new Date(at), remindMeDate: new Date(at) }))
    have.add(name); made++
  }
  const head = (e) => `${e.channel} · ${e.title}`
  const g = (e) => e.grade ? `경품 ${e.grade.prize} ×${e.grade.winners} · 응모가치 ${e.grade.worth}/5` : ''
  for (const e of data.events) mk(`[지원] ${head(e)}`, `${e.url}\n마감 ${e.deadline}${e.guessed ? '?' : ''} · 발표 ${e.announce}${e.stats ? ' · ' + e.stats : ''}\n${g(e)}\n${e.excerpt}`, e.remindAt)
  for (const e of data.applied ?? []) mk(`[결과] ${head(e)}`, `${e.url}\n당첨자 발표는 커뮤니티 게시글·고정 댓글에서 확인. 확인 후 클로드에 "당첨 ${e.channel}" 또는 "탈락 ${e.channel}"`, e.announceAt)
  for (const h of data.hints ?? []) mk(`[당첨확인] ${h.channel} · ${h.title}`, `${h.url}\n${h.hint}\n확인 후 클로드에 "당첨 ${h.channel}" 또는 "탈락 ${h.channel}"`, new Date(Date.now() + 5 * 60000).toISOString())
  const app = Application.currentApplication(); app.includeStandardAdditions = true
  if ((data.hints ?? []).length) app.displayNotification(data.hints.map((h) => `${h.channel}: ${h.hint}`).join('\n'), { withTitle: `🎉 당첨 후보 ${data.hints.length}건` })
  if (made && data.events.length) app.displayNotification(data.events.slice(0, 3).map((e) => `${head(e)} (${e.grade?.worth ?? '?'}/5)`).join('\n'), { withTitle: `응모할 만한 이벤트 ${data.events.length}건` })
  return `미리알림 ${made}개 생성`
}
