import { describe, it, expect } from 'vitest'
import { deriveQuickChips, changeRate, categoryIcon, topNWithOther, dailyTotals, distinctCategoryOptions, fixedRemaining, splitFromText, type TxLike, type FixedDef } from './dashboardLogic'

const tx = (date: string, amount: number, category: string, subCategory: string, payment: string): TxLike =>
  ({ date, type: 'expense', amount, category, subCategory, payment, fixedType: 'variable' })

describe('changeRate', () => {
  it('이전이 0/없으면 null', () => {
    expect(changeRate(100, 0)).toBeNull()
  })
  it('증가율 계산', () => {
    expect(changeRate(112, 100)).toBeCloseTo(0.12)
  })
  it('감소율 계산', () => {
    expect(changeRate(80, 100)).toBeCloseTo(-0.2)
  })
})

describe('deriveQuickChips', () => {
  it('지출 없으면 빈 배열', () => {
    expect(deriveQuickChips([], 4)).toEqual([])
  })

  it('소분류별로 묶고 빈도순 상위 N', () => {
    const txns = [
      tx('2026-06-01', 5000, '식비', '카페', '카드'),
      tx('2026-06-02', 4000, '식비', '카페', '카드'),
      tx('2026-06-03', 9000, '식비', '외식', '카드'),
      tx('2026-06-04', 3000, '교통/차량', '이동', '카드'),
    ]
    const chips = deriveQuickChips(txns, 2)
    expect(chips.length).toBe(2)
    expect(chips[0].label).toBe('카페')
  })

  it('기본 금액·결제수단은 그룹의 최신 거래에서', () => {
    const txns = [
      tx('2026-06-01', 5000, '식비', '카페', '카드'),
      tx('2026-06-05', 4500, '식비', '카페', '토스'),
    ]
    const [chip] = deriveQuickChips(txns, 4)
    expect(chip.amount).toBe(4500)
    expect(chip.payment).toBe('토스')
    expect(chip.category).toBe('식비')
    expect(chip.subCategory).toBe('카페')
  })

  it('알려진 키워드는 이모지 매핑', () => {
    const [chip] = deriveQuickChips([tx('2026-06-01', 5000, '식비', '카페', '카드')], 4)
    expect(chip.emoji).toBe('☕')
  })

  it('수입은 제외', () => {
    const income: TxLike = { date: '2026-06-01', type: 'income', amount: 3000000, category: '수입', subCategory: '급여', payment: '계좌', fixedType: 'fixed' }
    expect(deriveQuickChips([income], 4)).toEqual([])
  })
})

describe('categoryIcon', () => {
  it('알려진 카테고리는 매핑 이모지', () => {
    expect(categoryIcon('식비')).toBe('🍚')
    expect(categoryIcon('주거/통신')).toBe('🏠')
  })
  it('미매핑/빈값은 기본 아이콘', () => {
    expect(categoryIcon('알수없음')).toBe('💸')
    expect(categoryIcon('')).toBe('💸')
  })
})

describe('topNWithOther', () => {
  const d = (name: string, value: number) => ({ name, value })
  it('n 이하면 그대로', () => {
    const data = [d('a', 3), d('b', 2)]
    expect(topNWithOther(data, 7)).toEqual(data)
  })
  it('n 초과면 상위 n + 기타(나머지 합)', () => {
    const data = [d('a', 5), d('b', 4), d('c', 3), d('d', 2), d('e', 1)]
    const res = topNWithOther(data, 3)
    expect(res.length).toBe(4)
    expect(res[3]).toEqual({ name: '기타', value: 3 })
  })
  it('나머지 합이 0이면 기타 없음', () => {
    const data = [d('a', 5), d('b', 0), d('c', 0)]
    expect(topNWithOther(data, 1)).toEqual([d('a', 5)])
  })
})

describe('dailyTotals', () => {
  const dt = (date: string, amount: number, split = 0, type = 'expense') => ({ date, amount, split, type })
  it('같은 달 같은 날 실지출(amount-split) 합산', () => {
    const txns = [dt('2026-06-03', 5000), dt('2026-06-03', 3000, 500)]
    expect(dailyTotals(txns, '2026-06')).toEqual({ 3: 7500 })
  })
  it('수입 제외', () => {
    const txns = [dt('2026-06-03', 5000), dt('2026-06-03', 1000000, 0, 'income')]
    expect(dailyTotals(txns, '2026-06')).toEqual({ 3: 5000 })
  })
  it('다른 달 제외', () => {
    const txns = [dt('2026-06-03', 5000), dt('2026-05-03', 9000)]
    expect(dailyTotals(txns, '2026-06')).toEqual({ 3: 5000 })
  })
  it('빈 입력 → {}', () => {
    expect(dailyTotals([], '2026-06')).toEqual({})
  })
})

describe('distinctCategoryOptions', () => {
  const tx = (category: string, subCategory: string, type = 'expense') =>
    ({ date: '2026-06-01', type, amount: 1000, category, subCategory, payment: '카드', fixedType: 'variable' })
  it('고유 (대분류,소분류) 조합, 빈도 내림차순, 미분류 제외', () => {
    const txns = [tx('식비','외식'), tx('식비','외식'), tx('생활','잡화'), tx('미분류','')]
    const res = distinctCategoryOptions(txns)
    expect(res).toEqual([
      { category: '식비', subCategory: '외식' },
      { category: '생활', subCategory: '잡화' },
    ])
  })
  it('수입 제외, 빈 입력 → []', () => {
    expect(distinctCategoryOptions([])).toEqual([])
    expect(distinctCategoryOptions([tx('수입','급여','income')])).toEqual([])
  })
})

describe('fixedRemaining', () => {
  const base: FixedDef = { id: '1', active: true, name: '맥북 할부', amount: 179354, category: '생활', subCategory: '전자기기', payment: '카드', payDay: 1, startMonth: '2026-03', installmentTotal: 14, variable: false, split: 0 }
  it('진행중 할부: 경과/남은 회차·금액', () => {
    expect(fixedRemaining(base, '2026-05')).toEqual({ count: 3, total: 14, remainingCount: 11, remainingAmount: 11 * 179354, done: false })
  })
  it('완료된 할부: 남은 0, done', () => {
    expect(fixedRemaining(base, '2027-05')).toEqual({ count: 14, total: 14, remainingCount: 0, remainingAmount: 0, done: true })
  })
  it('무기한(할부총회차 null) → null', () => {
    expect(fixedRemaining({ ...base, installmentTotal: null }, '2026-05')).toBeNull()
  })
})

describe('splitFromText', () => {
  it('"반반" → 금액 절반', () => {
    expect(splitFromText('코스트코 반반', 100000)).toEqual({ split: 50000, remaining: '코스트코' })
  })
  it('"/2" → 금액 절반', () => {
    expect(splitFromText('코스트코 /2', 100000)).toEqual({ split: 50000, remaining: '코스트코' })
  })
  it('"분담 N" → N (콤마 허용)', () => {
    expect(splitFromText('코스트코 분담 30,000', 100000)).toEqual({ split: 30000, remaining: '코스트코' })
  })
  it('분담 없으면 0, 텍스트 유지', () => {
    expect(splitFromText('점심 김밥', 5000)).toEqual({ split: 0, remaining: '점심 김밥' })
  })
})
