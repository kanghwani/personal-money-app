// 가계부 코치 미리알림 (JXA). eventsync.py 가 제목·본문·알림시각(ISO)을 넘긴다. 직접 실행하지 않는다.
// 같은 "[가계부] MM/DD " 로 시작하는 미리알림이 이미 있으면 만들지 않는다 = 하루 1개(로그인 실행·09:00 재실행 포함).
function run(argv) {
  const [title, body, at] = argv
  const R = Application('Reminders')
  let list = R.lists.whose({ name: '가계부' })()[0]
  if (!list) { R.lists.push(R.List({ name: '가계부' })); list = R.lists.byName('가계부') }
  const prefix = title.split(' ').slice(0, 2).join(' ') + ' '   // "[가계부] 11/01 " — 날짜 뒤 공백까지 비교한다
  if (list.reminders.name().some((n) => n.startsWith(prefix))) return '이미 있음'
  list.reminders.push(R.Reminder({ name: title, body, dueDate: new Date(at), remindMeDate: new Date(at) }))
  return '생성'
}
