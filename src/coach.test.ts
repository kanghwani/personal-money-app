import { describe, it, expect } from 'vitest'
import { fmt, daysInMonth, addMonths, categoryBaselines, categoryVerdict, categoryStates, type CoachTx } from './coach'

const tx = (date: string, amount: number, o: Partial<CoachTx> = {}): CoachTx =>
  ({ date, type: 'expense', amount, split: 0, memo: '', payment: '현금', category: '외식비', subCategory: '', fixedType: 'variable', ...o })

describe('날짜·금액 헬퍼', () => {
  it('fmt', () => {
    expect(fmt(90000)).toBe('9만'); expect(fmt(15000)).toBe('1.5만'); expect(fmt(340000)).toBe('34만')
    expect(fmt(4200)).toBe('4,200원'); expect(fmt(6129.4)).toBe('6,129원')
  })
  it('daysInMonth / addMonths', () => {
    expect(daysInMonth('2026-10')).toBe(31); expect(daysInMonth('2026-11')).toBe(30)
    expect(daysInMonth('2027-02')).toBe(28); expect(daysInMonth('2028-02')).toBe(29)
    expect(addMonths('2026-01', -1)).toBe('2025-12'); expect(addMonths('2026-12', 1)).toBe('2027-01')
  })
})

describe('categoryBaselines', () => {
  const hist = [
    tx('2026-07-10', 300000), tx('2026-08-10', 340000), tx('2026-09-10', 390000),
    tx('2026-10-05', 999999),                                            // 이번 달은 기준에서 빠진다
    tx('2026-09-11', 100000, { split: 40000, category: '식비' }),         // 실지출 60000
    tx('2026-08-11', 70000, { category: '식비' }), tx('2026-07-11', 50000, { category: '식비' }),
    tx('2026-09-12', 500000, { category: '생활', fixedType: 'fixed' }),   // 고정비 제외
    tx('2026-09-13', 500000, { category: '저축/투자' }),                  // 비지출 제외
    tx('2026-09-14', 30000, { category: '문화/구독' }),                   // 5만 미만 제외
  ]
  it('끝난 3개월 중앙값, 분담금·고정비·저축 제외, 5만 미만 제외', () => {
    const b = categoryBaselines(hist, '2026-10')
    expect(b.get('외식비')).toEqual({ baseline: 340000, lastMonth: 390000 })
    expect(b.get('식비')).toEqual({ baseline: 60000, lastMonth: 60000 })
    expect(b.has('생활')).toBe(false); expect(b.has('저축/투자')).toBe(false); expect(b.has('문화/구독')).toBe(false)
  })
  it('기록 2개월이면 그 둘의 중앙값(평균)', () => {
    const b = categoryBaselines([tx('2026-08-10', 200000), tx('2026-09-10', 300000)], '2026-10')
    expect(b.get('외식비')?.baseline).toBe(250000)
  })
  it('기록 있는 달에 그 카테고리가 없으면 0으로 센다', () => {
    const b = categoryBaselines([tx('2026-07-10', 300000), tx('2026-08-10', 300000), tx('2026-09-10', 9000, { category: '식비' })], '2026-10')
    expect(b.get('외식비')?.baseline).toBe(300000)   // [300000, 300000, 0] 의 중앙값
  })
  it('이번 달에만 있는 카테고리는 기준선이 없다', () => {
    expect(categoryBaselines([tx('2026-10-01', 500000, { category: '여행' })], '2026-10').size).toBe(0)
  })
})

describe('categoryVerdict (기준선 340,000, 31일 달)', () => {
  it('7일 전에는 판정하지 않는다', () => {
    expect(categoryVerdict(500000, 340000, 6, 31)).toBe('ok')
  })
  it('기준선 이상이면 over', () => {
    expect(categoryVerdict(340000, 340000, 20, 31)).toBe('over')
  })
  it('날짜 기준의 1.2배 이상이고 차이 3만 이상이면 heavy', () => {
    // 10일 날짜 기준 = 340000*10/31 ≈ 109,677 → 1.2배 ≈ 131,613
    expect(categoryVerdict(140000, 340000, 10, 31)).toBe('heavy')
    expect(categoryVerdict(131000, 340000, 10, 31)).toBe('ok')
  })
  it('1.2배를 넘어도 차이가 3만 미만이면 ok', () => {
    // 기준선 60,000, 10/30일 → 날짜 기준 20,000, 26,000 은 1.3배지만 차이 6,000
    expect(categoryVerdict(26000, 60000, 10, 30)).toBe('ok')
  })
  it('15일부터, 날짜 기준의 0.7배 이하면 room', () => {
    // 15/30일 → 날짜 기준 170,000 → 0.7배 = 119,000
    expect(categoryVerdict(119000, 340000, 15, 30)).toBe('room')
    expect(categoryVerdict(119001, 340000, 15, 30)).toBe('ok')
    expect(categoryVerdict(60000, 340000, 14, 30)).toBe('ok')
  })
})

describe('categoryStates', () => {
  const hist = [tx('2026-07-10', 340000), tx('2026-08-10', 340000), tx('2026-09-10', 340000)]
  it('오늘·어제 누적과 판정을 낸다', () => {
    const [s] = categoryStates([...hist, tx('2026-10-05', 330000), tx('2026-10-06', 20000)], '2026-10-06')
    expect(s).toMatchObject({ category: '외식비', spent: 350000, spentYesterday: 330000, baseline: 340000, verdict: 'ok' })
  })
  it('1일에는 어제 누적이 0', () => {
    const [s] = categoryStates([...hist, tx('2026-10-01', 50000)], '2026-10-01')
    expect(s.spentYesterday).toBe(0)
  })
})
