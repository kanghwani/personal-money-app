// 맥 미리알림 생성 (JXA). eventsync.py 가 JSON 파일 경로를 넘긴다. 직접 실행하지 않는다.
//   digest: 하루 1개 요약 "[이벤트] MM/DD" (서버가 만든다, 없으면 안 만든다)   at: 알림 시각(ISO)   hints: 당첨 후보 배너
//   건별 [지원]·[결과] 미리알림은 2026-10-15 에 뺐다 — 캘린더가 이벤트로 덮여 일정이 헷갈렸다. 목록은 /events 페이지에서 본다.
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
  if (data.digest) mk(data.digest.title, data.digest.body, data.at)
  const app = Application.currentApplication(); app.includeStandardAdditions = true
  if ((data.hints ?? []).length) app.displayNotification(data.hints.map((h) => `${h.channel}: ${h.hint}`).join('\n'), { withTitle: `🎉 당첨 후보 ${data.hints.length}건` })
  return `미리알림 ${made}개 생성`
}
