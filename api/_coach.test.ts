import { describe, expect, it } from 'vitest'
import { weekFacts, nextChange, evaluate, promotions, weekReview, formatWeek, tagImpact, mondayOf, adviceToExtra, adviceFromRow, adviceHistory, formatHistory, monthReview, formatMonth, gates, lifeChange } from './_coach'
import { parseLog } from './_log'
import type { HealthRow, Tabs } from './_health'

const row = (start: string, value: string, extra = '', end = start): HealthRow => ({ start, end, value, extra })
const PLAN = ['월|수영,턱걸이', '화|걷뛰,요가', '수|수영', '목|걷뛰,요가', '금|수영,턱걸이', '토|휴식', '일|휴식']
  .map((p, i) => row(`2026-06-01 08:0${i}`, '계획', p))
/** 2026-08-24(월) ~ 08-30(일) 이 "지난주", 08-31(월) 이 이번 주 */
const TODAY = '2026-09-02'

const base = (): Tabs => ({ manual: [...PLAN], workout: [], sleep: [], hrv: [], resting_hr: [], respiratory_rate: [], vo2max: [] } as unknown as Tabs)
const night = (d: string, mins: number, bedH = 1) =>
  row(`${d} 0${bedH}:00`, '코어 수면', '', `${d} ${String(bedH + Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`)
/** 지난 6주 동안 주 3회 수영. 만성 부하 기준선을 만들어 급성/만성 비율이 튀지 않게 한다. */
function seedHistory(tabs: Tabs) {
  for (let w = 1; w <= 6; w++) for (const off of [0, 2, 4]) {
    const d = new Date(Date.UTC(2026, 7, 24) - w * 7 * 86400_000 + off * 86400_000).toISOString().slice(0, 10)
    tabs.workout.push(row(`${d} 09:00`, 'Swimming', '55|210|900|115'))
  }
}
/** 08-24(월)~08-28(금) 계획 9개를 모두 이행시킨다 */
function completeWeek(tabs: Tabs) {
  for (const d of ['2026-08-24', '2026-08-26', '2026-08-28']) tabs.workout.push(row(`${d} 09:00`, 'Swimming', '55|210|900|115'))
  for (const d of ['2026-08-24', '2026-08-28']) tabs.manual.push(row(`${d} 12:00`, '턱걸이', '밴드|3|5'))
  for (const d of ['2026-08-25', '2026-08-27']) {
    tabs.workout.push(row(`${d} 07:00`, 'Running', '20|150|2.5|135'), row(`${d} 20:00`, 'Yoga', '35|90||95'))
  }
}

describe('mondayOf / 제안 직렬화', () => {
  it('그 주 월요일을 찾고 코치 행을 왕복시킨다', () => {
    expect(mondayOf('2026-09-02')).toBe('2026-08-31')
    expect(mondayOf('2026-08-31')).toBe('2026-08-31')
    const a = { key: 'bedtime' as const, text: '취침 30분 당기기', metric: 'bedtime' as const, target: -30, why: '' }
    const back = adviceFromRow(row('2026-08-31 09:00', '코치', adviceToExtra('주간', a)))
    expect(back).toMatchObject({ horizon: '주간', key: 'bedtime', metric: 'bedtime', target: -30, text: '취침 30분 당기기' })
    expect(parseLog('코치 주간 취침 30분 당기기').extra).toBe('주간|hold|none|0|취침 30분 당기기')
    expect(() => parseLog('코치 아무거나')).toThrow()
  })
})

describe('weekFacts', () => {
  it('한 주의 계획 이행·세션·수면·통증을 모은다', () => {
    const tabs = base()
    tabs.workout.push(row('2026-08-24 09:00', 'Swimming', '55|210|900|115'), row('2026-08-26 09:00', 'Swimming', '55|210|900|115'))
    tabs.sleep.push(night('2026-08-25', 360), night('2026-08-26', 400))
    tabs.manual.push(row('2026-08-25 08:00', '컨디션', '4|3|2|3'), row('2026-08-27 20:00', '통증', '무릎|4|'), row('2026-08-24 11:00', 'sRPE', '수영|55|6|'))
    const f = weekFacts(tabs, '2026-08-24')
    expect(f.sessions).toBe(2)
    expect(f.planned).toBe(9)          // 월2 화2 수1 목2 금2
    expect(f.done).toBe(2)             // 월 수영, 수 수영
    expect(f.srpe).toBe(330)
    expect(f.nights).toBe(2)
    expect(f.pain).toEqual([{ site: '무릎', level: 4 }])
    expect(f.wellnessMean).toEqual([4, 3, 2, 3])
    expect(f.missed).toContain('월 턱걸이')
  })
})

describe('nextChange 우선순위', () => {
  it('통증이 있으면 강도부터 낮춘다', () => {
    const tabs = base()
    tabs.manual.push(row('2026-08-27 20:00', '통증', '무릎|4|'))
    const c = nextChange(tabs, weekFacts(tabs, '2026-08-24'), TODAY)
    expect(c.key).toBe('lower_intensity')
    expect(c.text).toContain('무릎')
  })
  it('이행률이 낮으면 새 목표 대신 빠진 것부터', () => {
    const tabs = base()
    tabs.workout.push(row('2026-08-24 09:00', 'Swimming', '55|210|900|115'))
    const c = nextChange(tabs, weekFacts(tabs, '2026-08-24'), TODAY)
    expect(c.key).toBe('adherence')
  })
  it('수면이 평소보다 짧으면 취침 목표를 준다', () => {
    const tabs = base()
    for (let i = 0; i < 40; i++) {                       // 평소 7시간
      const d = new Date(Date.UTC(2026, 6, 1) + i * 86400_000).toISOString().slice(0, 10)
      tabs.sleep.push(night(d, 420))
    }
    for (const d of ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']) tabs.sleep.push(night(d, 330))
    seedHistory(tabs); completeWeek(tabs)                // 계획은 잘 지킴, 부하도 안정
    const c = nextChange(tabs, weekFacts(tabs, '2026-08-24'), TODAY)
    expect(c.key).toBe('bedtime')
    expect(c.target).toBe(-30)
  })
  it('아무 문제가 없으면 유지 또는 세션 추가', () => {
    const tabs = base()
    seedHistory(tabs); completeWeek(tabs)
    const c = nextChange(tabs, weekFacts(tabs, '2026-08-24'), TODAY)
    expect(['hold', 'add_session', 'promote']).toContain(c.key)
  })
})

describe('진급 게이트', () => {
  it('데드행 30초 3세트를 세 번 채우면 네거티브로 올린다', () => {
    const tabs = base()
    for (const d of ['2026-08-20', '2026-08-25', '2026-08-30']) tabs.manual.push(row(`${d} 12:00`, '턱걸이', '데드행|3|30초'))
    const p = promotions(tabs, TODAY)
    expect(p[0]).toMatchObject({ area: '턱걸이', to: '네거티브 8초' })
  })
  it('조건을 못 넘기면 아무 판정도 안 한다', () => {
    const tabs = base()
    tabs.manual.push(row('2026-08-20 12:00', '턱걸이', '데드행|2|15초'))
    expect(promotions(tabs, TODAY)).toEqual([])
  })
})

describe('제안 되짚기', () => {
  it('목표가 음수면 줄었을 때 지킨 것으로 본다', () => {
    const prev = adviceFromRow(row('2026-08-24 09:00', '코치', '주간|bedtime|bedtime|-30|취침 30분 당기기'))
    const last = { bedtimeMean: 1500 } as never, before = { bedtimeMean: 1560 } as never
    const r = evaluate(prev, last, before)
    expect(r.met).toBe(true)
    expect(r.text).toContain('지켰어요')
  })
  it('기록이 없으면 판단하지 않는다', () => {
    const prev = adviceFromRow(row('2026-08-24 09:00', '코치', '주간|bedtime|bedtime|-30|취침 30분 당기기'))
    expect(evaluate(prev, { bedtimeMean: null } as never, { bedtimeMean: 1560 } as never).met).toBeNull()
  })
})

describe('weekReview / tagImpact', () => {
  it('리뷰 문장에 계획·자가평가·다음 변경이 들어간다', () => {
    const tabs = base()
    tabs.workout.push(row('2026-08-24 09:00', 'Swimming', '55|210|900|115'))
    const text = formatWeek(weekReview(tabs, TODAY))
    expect(text).toContain('[주간 리뷰 2026-08-24 ~ 2026-08-30]')
    expect(text).toContain('자가평가 기록 없음')
    expect(text).toContain('[다음 주 변경 하나]')
  })
  it('태그는 표본이 적으면 판단하지 않는다', () => {
    const tabs = base()
    tabs.manual.push(row('2026-08-24 22:00', '태그', '술|늦은식사'))
    tabs.hrv.push(row('2026-08-25 00:00', '40'))
    const t = tagImpact(tabs, TODAY)
    expect(t.find((x) => x.tag === '술')!.verdict).toContain('아직 판단하기 이름')
  })
})

describe('과거 주 다시 보기 · 코치 기록', () => {
  it('week 를 주면 그 주를 계산한다', () => {
    const tabs = base()
    tabs.workout.push(row('2026-08-12 09:00', 'Swimming', '55|210|900|115'))
    const r = weekReview(tabs, TODAY, '2026-08-13')     // 08-10(월) 주
    expect(r.week).toBe('2026-08-10 ~ 2026-08-16')
    expect(r.facts.sessions).toBe(1)
  })
  it('제안 기록에 지킴/놓침 판정이 붙는다', () => {
    const tabs = base()
    // 08-24 주에 "취침 30분 당기기" 제안 → 다음 주(08-31)에 실제로 당겼는지 본다
    tabs.manual.push(row('2026-08-24 09:00', '코치', '주간|bedtime|bedtime|-30|취침 30분 당기기'))
    tabs.sleep.push(night('2026-08-25', 360, 2), night('2026-09-01', 360, 1))   // 02:00 → 01:00
    const h = adviceHistory(tabs, '2026-09-14')
    expect(h[0]).toMatchObject({ text: '취침 30분 당기기', horizon: '주간' })
    expect(h[0].result.met).toBe(true)
    expect(formatHistory(h)).toContain('지킴')
  })
  it('기록이 없으면 안내만 한다', () => {
    expect(formatHistory(adviceHistory(base(), TODAY))).toContain('아직 저장된 제안이 없어요')
  })
})

describe('월간 결정', () => {
  it('진급 조건을 넘기면 결정이 진급, 아니면 유지', () => {
    const tabs = base()
    for (const d of ['2026-08-20', '2026-08-25', '2026-08-30']) tabs.manual.push(row(`${d} 12:00`, '턱걸이', '데드행|3|30초'))
    const r = monthReview(tabs, TODAY)
    expect(r.decision.key).toBe('promote')
    expect(r.decision.text).toContain('네거티브')
    expect(monthReview(base(), TODAY).decision.key).toBe('hold')
  })
  it('month 를 주면 그 달만 계산하고 지난달 결정을 되짚는다', () => {
    const tabs = base()
    tabs.workout.push(row('2026-07-10 09:00', 'Swimming', '55|210|900|115'), row('2026-08-10 09:00', 'Swimming', '55|210|900|115'))
    tabs.manual.push(row('2026-07-02 09:00', '코치', '월간|hold|sessions|0|다음 달도 지금 단계 유지'))
    const r = monthReview(tabs, TODAY, '2026-08-15')
    expect(r.from).toBe('2026-08-01')
    expect(r.sessions).toBe(1)
    expect(r.prevDecision?.text).toBe('다음 달도 지금 단계 유지')
    expect(formatMonth(r)).toContain('[이번 달 결정]')
  })
})

describe('진급 게이트 (수정 후)', () => {
  const g = (tabs: Tabs, area: string, today = TODAY) => gates(tabs, today).find((x) => x.area === area)!

  it('계획이 시키는 대로 하면 실제로 진급한다 (예전에는 게이트가 더 빡세서 영원히 못 넘었다)', () => {
    const tabs = base()
    // 계획: 네거티브 8초 3~4회. 게이트도 같은 숫자여야 한다.
    for (const d of ['2026-08-20', '2026-08-25', '2026-08-30']) tabs.manual.push(row(`${d} 12:00`, '턱걸이', '네거티브|3|8초,8초,8초'))
    expect(g(tabs, '턱걸이')).toMatchObject({ stage: '네거티브', ready: true, done: 3, need: 3 })
  })
  it('아직 못 채웠으면 몇 번 남았는지 알려준다', () => {
    const tabs = base()
    tabs.manual.push(row('2026-08-25 12:00', '턱걸이', '데드행|3|30초'))
    expect(g(tabs, '턱걸이')).toMatchObject({ stage: '데드행', ready: false, done: 1, need: 3 })
    expect(g(tabs, '턱걸이').detail).toContain('지금 1회')
  })
  it('어깨 통증이 있으면 조건을 채워도 미룬다', () => {
    const tabs = base()
    for (const d of ['2026-08-20', '2026-08-25', '2026-08-30']) tabs.manual.push(row(`${d} 12:00`, '턱걸이', '데드행|3|30초'))
    tabs.manual.push(row('2026-08-31 20:00', '통증', '어깨|4|'))
    expect(g(tabs, '턱걸이').ready).toBe(false)
    expect(g(tabs, '턱걸이').blocked).toContain('어깨')
  })
  it('러닝은 거리가 정체했을 때만 늘린다', () => {
    const plateau = base(), rising = base()
    for (let i = 0; i < 6; i++) {                                   // 최근 21일 6회, 3km 유지
      const d = new Date(Date.UTC(2026, 7, 18) + i * 3 * 86400_000).toISOString().slice(0, 10)
      plateau.workout.push(row(`${d} 07:00`, 'Running', '20|150|3.0|135'))
      rising.workout.push(row(`${d} 07:00`, 'Running', `20|150|${3.0 + i * 0.4}|135`))
    }
    for (let i = 0; i < 4; i++) {                                   // 그 이전 21일에도 3km
      const d = new Date(Date.UTC(2026, 6, 25) + i * 4 * 86400_000).toISOString().slice(0, 10)
      plateau.workout.push(row(`${d} 07:00`, 'Running', '20|150|3.0|135'))
      rising.workout.push(row(`${d} 07:00`, 'Running', '20|150|3.0|135'))
    }
    expect(g(plateau, '러닝').ready).toBe(true)
    expect(g(plateau, '러닝').next).toBe('3.3km')
    expect(g(rising, '러닝').ready).toBe(false)                      // 방금 늘렸으면 또 늘리지 않는다
    expect(g(rising, '러닝').detail).toContain('최근에 거리를 늘렸어요')
  })
  it('다리 통증이 있으면 늘리지 않는다', () => {
    const tabs = base()
    for (let i = 0; i < 6; i++) {
      const d = new Date(Date.UTC(2026, 7, 18) + i * 3 * 86400_000).toISOString().slice(0, 10)
      tabs.workout.push(row(`${d} 07:00`, 'Running', '20|150|3.0|135'))
    }
    tabs.manual.push(row('2026-08-30 20:00', '통증', '무릎|3|'))
    expect(g(tabs, '러닝').ready).toBe(false)
  })
  it('기록이 없으면 시작점을 안내한다', () => {
    const tabs = base()
    expect(g(tabs, '턱걸이')).toMatchObject({ stage: '데드행', done: 0, ready: false })
    expect(g(tabs, '러닝')).toMatchObject({ stage: '아직 기록 없음', ready: false })
  })
})

describe('lifeChange', () => {
  const r = (start: string, value: string, extra = ''): HealthRow => ({ start, end: start, value, extra })
  const tabs = (manual: HealthRow[]): Tabs => ({ manual } as unknown as Tabs)

  it('3일 안 마감이 최우선이다', () => {
    const a = lifeChange(tabs([r('2026-09-01 10:00', '약속', '09-13|카제나 QA 제출')]), '2026-09-11', '2026-09-07')
    expect(a.key).toBe('deadline')
    expect(a.text).toContain('카제나')
  })

  it('마감이 없고 이행률이 낮으면 backlog', () => {
    const manual = [
      r('2026-08-01 10:00', '약속', '화|지원서'),
      r('2026-08-01 10:01', '약속', '수|이력서'),
    ]
    expect(lifeChange(tabs(manual), '2026-09-11', '2026-09-07').key).toBe('backlog')
  })

  it('활성이 상한이면 overflow', () => {
    const manual = ['가', '나', '다', '라', '마'].map((t, i) => r(`2026-08-01 10:0${i}`, '약속', `화|${t}`))
    // 이행 행은 판정 창(2026-08-31~09-06) **안**에 둔다. 창 밖에 두면 done=0/5 라
    // backlog 가 먼저 발동해 overflow 에 영원히 도달하지 못한다.
    const done = manual.map((m, i) => r(`2026-09-01 09:0${i}`, '이행', (m.extra || '').split('|')[1]))
    expect(lifeChange(tabs([...manual, ...done]), '2026-09-11', '2026-09-07').key).toBe('overflow')
  })

  it('약속이 없으면 life_hold', () => {
    expect(lifeChange(tabs([]), '2026-09-11', '2026-09-07').key).toBe('life_hold')
  })

  it('주간 리뷰가 건강 제안과 삶 제안을 따로 낸다', () => {
    const t = base()
    t.manual.push(r('2026-08-20 10:00', '약속', '09-13|카제나 QA 제출'))
    const w = weekReview(t, '2026-09-11')
    expect(w.life.key).toBe('deadline')
    expect(w.advice.key).not.toBe('deadline')          // 건강 제안은 건강 후보에서만 나온다
    // 이 테스트의 마감(09-13)은 리뷰 주(08-31~09-06) 밖이라 commitments.planned=0 이고
    // 약속 줄은 가드에 막힌다. 항상 출력되는 삶 제안 줄로 단언한다.
    expect(formatWeek(w)).toContain('삶 쪽')
  })
})
