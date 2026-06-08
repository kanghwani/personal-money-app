import { describe, it, expect } from 'vitest'
import { deriveQuickChips, changeRate, type TxLike } from './dashboardLogic'

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
