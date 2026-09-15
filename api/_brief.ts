/**
 * 아침 알림 한 통에 그날의 전부를 담는다.
 *
 * 창구가 여섯이던 게 문제였다 — 폰 알림·예약작업·노션·웹앱·클로드 앱·디스코드.
 * 어디서 뭐가 오는지 사람이 기억해야 했고, 무엇보다 **하나가 조용히 끊겨도 알 수가 없었다**
 * (주간 코치가 2주 연속 실패했는데 화면을 열어보고서야 알았다).
 * 하나로 모으면 "알림이 안 온 것" 자체가 파이프라인이 끊겼다는 신호가 된다.
 *
 * 여기서는 새 데이터를 만들지 않는다. 이미 있는 조각을 모으기만 한다.
 */
import type { HealthRow, Tabs } from './_health.js'
import { PLAN_LIBRARY, detailKey } from './_plan.js'
import { todayCommitments } from './_log.js'

const DAYS = ['일', '월', '화', '수', '목', '금', '토']
const day = (r: HealthRow) => r.start.slice(0, 10)

export type Brief = {
  /** 오늘 할 것 — 계획된 운동 + 트리거가 걸린 약속 */
  todos: string[]
  /** 이번 주 코치가 고른 변경 하나. 매일 다시 보여줘야 이행이 오른다(if-then 연구: 계획은 한 번은 되뇌어야 효과가 난다) */
  weekly: string | null
  /** 실제로 이상할 때만. 평소엔 비어 있다 */
  alerts: string[]
}

/** 계획 행(요일별 최신이 유효)에서 오늘 걸린 종목을 꺼낸다. */
function todayPlan(manual: HealthRow[], today: string): string[] {
  const wd = DAYS[new Date(today + 'T00:00:00Z').getUTCDay()]
  const plan = new Map<string, string[]>()
  for (const r of manual) {
    if (r.value !== '계획') continue
    const [d, items] = (r.extra || '').split('|')
    plan.set(d, (items || '').split(',').filter(Boolean))
  }
  return (plan.get(wd) ?? []).filter((n) => n !== '휴식')
}

/**
 * 종목 이름 뒤에 "어떻게 하면 되는지" 한 조각을 붙인다.
 * 이름만 보여주면 "오늘 뭘 몇 개 하지"를 그 자리에서 정해야 하고, 그게 근력이 0회였던 이유다.
 */
const howHint = (name: string): string => {
  const d = PLAN_LIBRARY[detailKey(name)]
  const min = d.how.find((h) => h.startsWith('최소판'))
  if (!min) return name
  // 알림 한 줄에 들어가야 하므로 **동작만** 남긴다. 트리거 설명은 카드에 있고,
  // 알림을 볼 시점엔 이미 상기된 뒤라 여기서 또 길게 말할 이유가 없다.
  //   '최소판(5분) — 산책 나가기 전, 신발 신기 전에: 푸시업 10개 · ... 한 세트씩만'
  //   → '푸시업 10개 · 스플릿 스쿼트 좌우 8개씩 · 플랭크 30초'
  const afterColon = min.includes(': ') ? min.slice(min.lastIndexOf(': ') + 2) : min
  const firstSentence = afterColon.split('. ')[0]
  return `${name} — ${firstSentence}`
}

export function morningBrief(tabs: Tabs, today: string): Brief {
  const manual = tabs.manual ?? []
  const workouts = tabs.workout ?? []

  const todos = [...todayPlan(manual, today).map(howHint), ...todayCommitments(manual, today)]

  // 이번 주 저장된 제안(코치 행). 가장 최근 것 하나만.
  const coach = manual.filter((m) => m.value === '코치').sort((a, b) => (a.start < b.start ? -1 : 1)).pop()
  const weekly = coach ? (coach.extra || '').split('|').slice(4).join('|') || null : null

  // 이상 징후 — 파이프라인이 끊겼는지. 없으면 아무 말도 하지 않는다.
  const alerts: string[] = []
  const hasSleepLastNight = (tabs.sleep ?? []).some((r) => day(r) === today)
  if (!hasSleepLastNight) alerts.push('어젯밤 수면이 아직 안 올라왔어요')
  // 파이프라인이 살아있는지는 **워치가 올리는 탭**으로 본다. manual 에는 계획·코치 같은
  // 설정 행이 섞여 있어서, 계획만 고쳐놓고 업로드가 죽어도 "최근 기록 있음"으로 보인다.
  const uploaded = [...workouts, ...(tabs.sleep ?? []), ...(tabs.hrv ?? []), ...(tabs.resting_hr ?? [])]
  const lastUpload = uploaded.map(day).sort().pop()
  if (lastUpload && lastUpload < shift(today, -2)) alerts.push(`워치 데이터가 ${lastUpload} 이후로 안 올라와요`)

  return { todos, weekly, alerts }
}

const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10)

/** 알림용 꼬리말. 담을 게 없으면 빈 문자열이라 기존 출력이 그대로 유지된다. */
export function briefTail(b: Brief, bullet = '□'): string {
  const out: string[] = []
  if (b.todos.length) out.push('', '오늘', ...b.todos.map((t) => `${bullet} ${t}`))
  if (b.weekly) out.push('', `이번 주 하나 — ${b.weekly}`)
  if (b.alerts.length) out.push('', ...b.alerts.map((a) => `⚠ ${a}`))
  return out.join('\n')
}
