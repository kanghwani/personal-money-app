import { describe, expect, it } from 'vitest'
import { morningBrief, briefTail } from './_brief'
import type { HealthRow, Tabs } from './_health'

const row = (start: string, value: string, extra = ''): HealthRow => ({ start, end: start, value, extra })
const night = (start: string, end: string): HealthRow => ({ start, end, value: '코어 수면', extra: '' })
/** 2026-09-15 는 화요일 */
const TODAY = '2026-09-15'
const tabs = (manual: HealthRow[], sleep: HealthRow[] = []): Tabs =>
  ({ manual, workout: [], sleep } as unknown as Tabs)

const PLAN = [
  row('2026-06-01 08:00', '계획', '월|수영,턱걸이'),
  row('2026-06-01 08:01', '계획', '화|걷뛰,근력'),
  row('2026-06-01 08:02', '계획', '일|휴식'),
]

describe('morningBrief', () => {
  it('오늘 요일의 계획과 약속을 함께 낸다', () => {
    const b = morningBrief(tabs([...PLAN, row('2026-09-01 10:00', '약속', '09-15|카제나 QA 제출')]), TODAY)
    expect(b.todos).toHaveLength(3)                       // 걷뛰 + 근력 + 약속
    expect(b.todos.some((t) => t.startsWith('근력'))).toBe(true)
    expect(b.todos).toContain('카제나 QA 제출')
  })

  it('근력에는 최소판이 붙어서 "뭘 몇 개" 를 다시 정하지 않아도 된다', () => {
    const b = morningBrief(tabs(PLAN), TODAY)
    const 근력 = b.todos.find((t) => t.startsWith('근력'))!
    expect(근력).toContain('푸시업 10개')
    expect(근력).toContain('플랭크 30초')
    // 알림 한 줄이라 트리거 설명은 빠져야 한다(그건 카드에 있다)
    expect(근력).not.toContain('산책')
    expect(근력.length).toBeLessThan(45)
  })

  it('휴식일에는 할 것이 비고, 계획에 없는 요일도 비어 있다', () => {
    expect(morningBrief(tabs(PLAN), '2026-09-13').todos).toHaveLength(0)   // 일요일 = 휴식
    expect(morningBrief(tabs(PLAN), '2026-09-16').todos).toHaveLength(0)   // 수요일 계획 없음
  })

  it('이번 주 코치 제안을 실어 매일 다시 보여준다', () => {
    const b = morningBrief(tabs([...PLAN, row('2026-09-14 21:00', '코치', '주간|adherence|adherence|0.2|빠진 세션부터 채우기')]), TODAY)
    expect(b.weekly).toBe('빠진 세션부터 채우기')
  })

  it('수면이 안 올라왔으면 경고하고, 올라왔으면 조용하다', () => {
    expect(morningBrief(tabs(PLAN), TODAY).alerts).toContain('어젯밤 수면이 아직 안 올라왔어요')
    const slept = morningBrief(tabs(PLAN, [night('2026-09-15 02:00', '2026-09-15 07:00')]), TODAY)
    expect(slept.alerts).toHaveLength(0)
  })

  it('자정 전에 잠든 밤도 오늘 수면으로 본다 (가짜 경고 방지)', () => {
    // 09-14 23:10 에 잠들어 09-15 06:30 기상 — 행의 시작 날짜는 09-14 지만 기상일은 09-15 다
    const b = morningBrief(tabs(PLAN, [night('2026-09-14 23:10', '2026-09-15 06:30')]), TODAY)
    expect(b.alerts).toHaveLength(0)
  })
})

describe('briefTail', () => {
  it('담을 게 없으면 빈 문자열이라 기존 알림이 그대로다', () => {
    expect(briefTail({ todos: [], weekly: null, alerts: [] })).toBe('')
  })

  it('있는 것만 싣는다', () => {
    const t = briefTail({ todos: ['근력 — 산책 전'], weekly: '취침 30분 당기기', alerts: ['수면 미수신'] })
    expect(t).toContain('□ 근력 — 산책 전')
    expect(t).toContain('이번 주 하나 — 취침 30분 당기기')
    expect(t).toContain('⚠ 수면 미수신')
  })
})
