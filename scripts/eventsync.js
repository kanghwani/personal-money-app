// 맥 미리알림 생성 (JXA). eventsync.sh 가 /api/events 응답 JSON 파일 경로를 넘긴다. 직접 실행하지 않는다.
ObjC.import('Foundation')
function run(argv) {
  const raw = $.NSString.stringWithContentsOfFileEncodingError(argv[0], $.NSUTF8StringEncoding, null).js
  const data = JSON.parse(raw)
  const R = Application('Reminders')
  const list = R.lists.byName('이벤트')
  const have = new Set(list.reminders.name())   // 같은 제목은 다시 만들지 않는다(ALL=1 재실행 안전)
  let made = 0
  const mk = (name, body, at) => {
    if (have.has(name)) return
    list.reminders.push(R.Reminder({ name, body, dueDate: new Date(at), remindMeDate: new Date(at) }))
    have.add(name); made++
  }
  for (const e of data.events) {
    const head = `${e.channel} · ${e.title}`
    mk(`[지원] ${head}`, `${e.url}\n마감 ${e.deadline}${e.guessed ? '?' : ''} · 발표 ${e.announce}${e.stats ? ' · ' + e.stats : ''}\n${e.excerpt}`, e.remindAt)
    mk(`[결과] ${head}`, `${e.url}\n당첨자 발표는 커뮤니티 게시글·고정 댓글에서 확인`, e.announceAt)
  }
  for (const h of data.hints ?? []) {
    mk(`[당첨확인] ${h.channel} · ${h.title}`, `${h.url}\n${h.hint}\n확인 후 클로드에 "당첨 ${h.channel}" 또는 "탈락 ${h.channel}"`, new Date(Date.now() + 5 * 60000).toISOString())
  }
  if ((data.hints ?? []).length) {
    const app = Application.currentApplication(); app.includeStandardAdditions = true
    app.displayNotification(data.hints.map((h) => `${h.channel}: ${h.hint}`).join('\n'), { withTitle: `🎉 당첨 후보 ${data.hints.length}건` })
  }
  if (made) {
    const app = Application.currentApplication(); app.includeStandardAdditions = true
    app.displayNotification(data.events.slice(0, 3).map((e) => `${e.channel} · ${e.title}`).join('\n'), { withTitle: `새 구독자 이벤트 ${data.events.length}건` })
  }
  return `${new Date().toISOString().slice(0, 19)} 이벤트 ${data.events.length}건 · 당첨 후보 ${(data.hints ?? []).length}건 · 미리알림 ${made}개 생성 · 스캔 ${data.scanned}채널 +${data.added}` + (data.errors.length ? ` · 실패 ${data.errors.join(', ')}` : '')
}
