import { describe, it, expect } from 'vitest'
import { parseLog, logStamp, summarizeManual } from './_log'

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
