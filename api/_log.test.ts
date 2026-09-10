import { describe, it, expect } from 'vitest'
import { parseLog, logStamp, summarizeManual, activeCommitments, commitmentWeek, dueDate, overCap, capRefusal, todayCommitments } from './_log'
import type { HealthRow } from './_health'

describe('parseLog', () => {
  it('컨디션 4항목', () => {
    expect(parseLog('컨디션 4 3 2 3')).toMatchObject({ kind: '컨디션', extra: '4|3|2|3' })
    expect(parseLog('컨디션 4323').extra).toBe('4|3|2|3')
    expect(parseLog('컨디션 4,3,2,3').extra).toBe('4|3|2|3')
    expect(() => parseLog('컨디션 4 3')).toThrow()
    expect(() => parseLog('컨디션 6 3 2 3')).toThrow()
  })
  it('sRPE', () => {
    const e = parseLog('sRPE 러닝 25 7 무릎 살짝')
    expect(e.extra).toBe('러닝|25|7|무릎 살짝'); expect(e.echo).toContain('부하 175')
  })
  it('턱걸이 두 문법', () => {
    expect(parseLog('턱걸이 밴드 3x5').extra).toBe('밴드|3|5')
    expect(parseLog('턱걸이 네거티브 4x8초').extra).toBe('네거티브|4|8초')
    expect(parseLog('턱걸이 5 5 4').extra).toBe('정자세|3|5,5,4')
  })
  it('태그·통증·메모', () => {
    expect(parseLog('태그 술 늦은식사').extra).toBe('술|늦은식사')
    expect(parseLog('통증 무릎 3').extra).toBe('무릎|3|')
    expect(parseLog('오늘 수영 물이 차가웠음').kind).toBe('메모')
    expect(parseLog('인바디 72.3 33.1 18.5').extra).toBe('72.3|33.1|18.5|')
  })
  it('어제 접두', () => {
    const { stamp, text } = logStamp('어제 태그 술', Date.UTC(2026, 8, 3, 3, 0))   // KST 09-03 12:00
    expect(stamp).toBe('2026-09-02 12:00:00'); expect(text).toBe('태그 술')
  })
  it('약속 — 날짜형·요일형만 받는다', () => {
    expect(parseLog('약속 09-13 카제나 QA 제출')).toMatchObject({ kind: '약속', extra: '09-13|카제나 QA 제출' })
    expect(parseLog('약속 화아침 지원서 3곳').extra).toBe('화아침|지원서 3곳')
    expect(parseLog('약속 화 지원서').extra).toBe('화|지원서')
    // 트리거가 없으면 거부한다 — 이게 이 시스템의 유일한 규율이다
    expect(() => parseLog('약속 이력서 정리')).toThrow()
    expect(() => parseLog('약속 언젠가 이력서 정리')).toThrow()
    expect(() => parseLog('약속 09-13')).toThrow()      // 할 것이 없다
    expect(() => parseLog('약속 13-99 치과')).toThrow() // 날짜가 아니다
  })
  it('했다 — 키워드만 남긴다', () => {
    expect(parseLog('했다 카제나')).toMatchObject({ kind: '이행', extra: '카제나' })
    expect(() => parseLog('했다')).toThrow()
  })
})

describe('summarizeManual', () => {
  const r = (start: string, value: string, extra: string) => ({ start, end: start, value, extra })
  it('컨디션 편차 플래그와 sRPE 합', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => r(`2026-08-${String(10 + i).padStart(2, '0')} 08:00:00`, '컨디션', '4|2|2|2')),
      r('2026-09-02 08:00:00', '컨디션', '4|5|2|2'),
      r('2026-09-02 10:30:00', 'sRPE', '수영|55|6|'),
      r('2026-09-02 12:00:00', '턱걸이', '밴드|3|5'),
    ]
    const s = summarizeManual(rows, '2026-08-30')
    expect(s).toContain('09-02 4/5/2/2 · 피로 5(평소↑)')
    expect(s).toContain('sRPE 합 330')
    expect(s).toContain('밴드 3×5')
  })
})

describe('계획 대비 실행', () => {
  const r = (start: string, value: string, extra: string) => ({ start, end: start, value, extra })
  it('요일 계획과 워크아웃·턱걸이 기록을 대조한다', () => {
    expect(parseLog('계획 월 수영 턱걸이').extra).toBe('월|수영,턱걸이')
    expect(() => parseLog('계획 화')).toThrow()
    const rows = [r('2026-08-01 08:00:00', '계획', '월|수영,턱걸이'), r('2026-08-01 08:01:00', '계획', '화|러닝,요가'), r('2026-08-31 12:00:00', '턱걸이', '밴드|3|5')]
    const workouts = [{ start: '2026-08-31 09:15', end: '2026-08-31 10:11', value: 'Swimming', extra: '55|218|850|112' }]   // 8/31 = 월
    const s = summarizeManual(rows, '2026-08-31', workouts, '2026-09-01')
    expect(s).toContain('[계획 대비 실행 2/4]')
    expect(s).toContain('08-31(월) 수영✓ 턱걸이✓')
    expect(s).toContain('09-01(화) 러닝✗ 요가✗')
  })
})

describe('약속 집계', () => {
  const row = (start: string, value: string, extra = ''): HealthRow => ({ start, end: start, value, extra })
  const rows = [
    row('2026-09-01 10:00', '약속', '09-13|카제나 QA 제출'),
    row('2026-09-01 10:01', '약속', '화아침|지원서 3곳'),
    row('2026-09-01 10:02', '약속', '09-05|치과'),
  ]

  it('지난 날짜형은 활성에서 빠지고 요일형은 남는다', () => {
    const a = activeCommitments(rows, '2026-09-10')
    expect(a.map((c) => c.task)).toEqual(['카제나 QA 제출', '지원서 3곳'])   // 09-05 치과는 만료
  })

  it('했다 키워드가 부분 문자열로 약속을 닫는다', () => {
    const w = commitmentWeek([...rows, row('2026-09-08 09:00', '이행', '지원서')], '2026-09-07', '2026-09-13')
    expect(w.planned).toBe(2)                       // 요일형 1 + 그 주가 마감인 09-13 카제나 1
    expect(w.done).toBe(1)
    expect(w.items.find((i) => i.task === '지원서 3곳')?.done).toBe(true)
    expect(w.items.find((i) => i.task === '카제나 QA 제출')?.done).toBe(false)
  })

  it('그 주에 마감이 아닌 날짜형은 planned 에 안 든다', () => {
    const w = commitmentWeek(rows, '2026-09-14', '2026-09-20')
    expect(w.planned).toBe(1)                       // 요일형만
  })

  it('extra 없는 이행 행이 모든 약속을 done 으로 닫지 않는다', () => {
    const w = commitmentWeek([...rows, row('2026-09-08 09:00', '이행', '')], '2026-09-07', '2026-09-13')
    expect(w.done).toBe(0)
    expect(w.items.every((i) => !i.done)).toBe(true)
  })

  it('만료된 날짜형은 해가 바뀌어도 되살아나지 않는다', () => {
    // MM-DD 를 평가하는 날 기준으로 풀면 새해 첫날에 지금까지의 모든 날짜형이 한꺼번에
    // 활성으로 돌아와 5개 상한을 유령으로 채운다. 해석 기준은 기록일이다.
    const one = [row('2026-09-01 10:00', '약속', '09-13|카제나 QA 제출')]
    expect(activeCommitments(one, '2026-09-12').map((c) => c.due)).toEqual(['2026-09-13'])
    expect(activeCommitments(one, '2026-09-20')).toEqual([])
    expect(activeCommitments(one, '2027-01-01')).toEqual([])
    expect(activeCommitments(one, '2027-06-01')).toEqual([])
  })

  it('MM-DD 는 6개월 넘게 과거면 다음 해로 읽는다', () => {
    expect(dueDate('09-13', '2026-09-10')).toBe('2026-09-13')
    expect(dueDate('01-05', '2026-12-28')).toBe('2027-01-05')
    expect(dueDate('09-05', '2026-09-10')).toBe('2026-09-05')   // 며칠 전은 올해가 맞다
  })

  it('했다 한 줄은 걸리는 것 중 가장 최근 약속 하나만 닫는다', () => {
    const two = [
      row('2026-09-01 10:00', '약속', '화|지원서 3곳'),
      row('2026-09-01 10:01', '약속', '수|지원서 초안'),   // 더 최근에 등록
      row('2026-09-02 09:00', '이행', '지원서'),
    ]
    const w = commitmentWeek(two, '2026-08-31', '2026-09-06')
    expect(w.planned).toBe(2)
    expect(w.done).toBe(1)
    expect(w.items.find((i) => i.task === '지원서 초안')?.done).toBe(true)
    expect(w.items.find((i) => i.task === '지원서 3곳')?.done).toBe(false)
    // 두 줄이면 둘 다 닫힌다 — 이미 닫은 것을 다시 소비하지 않는다
    const w2 = commitmentWeek([...two, row('2026-09-03 09:00', '이행', '지원서')], '2026-08-31', '2026-09-06')
    expect(w2.done).toBe(2)
  })

  it('활성 5개면 6개째를 막는다', () => {
    const five = ['가', '나', '다', '라', '마'].map((t, i) => row(`2026-09-01 10:0${i}`, '약속', `화|${t}`))
    expect(overCap(five, '2026-09-10')).toHaveLength(5)
    expect(overCap(five.slice(0, 4), '2026-09-10')).toBeNull()
  })

  it('capRefusal — 상한이면 문구, 아니면 null. 세 입력 통로가 이 함수 하나를 공유한다', () => {
    const five = ['가', '나', '다', '라', '마'].map((t, i) => row(`2026-09-01 10:0${i}`, '약속', `화|${t}`))
    const refusal = capRefusal(five, '2026-09-10')
    expect(refusal).toContain('약속은 한 번에 5개까지예요')
    expect(refusal).toContain('- 화 가')
    expect(refusal).toContain('- 화 마')
    expect(capRefusal(five.slice(0, 4), '2026-09-10')).toBeNull()
  })

  it('오늘 트리거가 걸린 것만 나온다', () => {
    const rs = [
      row('2026-09-01 10:00', '약속', '09-11|카제나 QA 제출'),
      row('2026-09-01 10:01', '약속', '금아침|지원서 3곳'),
      row('2026-09-01 10:02', '약속', '수|이력서'),
    ]
    expect(todayCommitments(rs, '2026-09-11')).toEqual(['카제나 QA 제출', '지원서 3곳 (아침)'])  // 2026-09-11 은 금요일
    expect(todayCommitments(rs, '2026-09-12')).toEqual([])
  })
})
