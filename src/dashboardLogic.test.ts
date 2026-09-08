import { describe, it, expect } from 'vitest'
import { deriveQuickChips, changeRate, categoryIcon, topNWithOther, dailyTotals, distinctCategoryOptions, fixedRemaining, splitFromText, splitPlaceItem, joinPlaceItem, placeTotals, categoryDeltas, splitBreakdown, parseCardStatement, cardPerformance, tierStatus, dailyCheer, type TxLike, type FixedDef, missedBenefits, CARD_SPECS, installmentCharges, benefitBalances, unusedBenefits, paymentPlaybook, previousMonthKey, isSaving, isLoanRepay, isNonSpend, isCardPayment, parseBankDeposits } from './dashboardLogic'

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
  it('es 카테고리도 매핑 이모지(F-minor-b)', () => {
    expect(categoryIcon('Comida')).toBe('🍚')
    expect(categoryIcon('Vivienda')).toBe('🏠')
    expect(categoryIcon('Sin categoría')).toBe('❓')
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
  it('otherLabel을 넘기면 그 라벨로 합산(F-minor-b, es 호출부용)', () => {
    const data = [d('a', 5), d('b', 4), d('c', 3), d('d', 2), d('e', 1)]
    const res = topNWithOther(data, 3, 'Otro')
    expect(res[3]).toEqual({ name: 'Otro', value: 3 })
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
  it('es의 Sin categoría도 기본으로 제외(F-minor-b)', () => {
    const txns = [tx('Comida','Cafetería'), tx('Sin categoría','')]
    expect(distinctCategoryOptions(txns)).toEqual([{ category: 'Comida', subCategory: 'Cafetería' }])
  })
})

describe('fixedRemaining', () => {
  const base: FixedDef = { id: '1', active: true, name: '맥북 할부', amount: 179354, category: '생활', subCategory: '전자기기', payment: '카드', payDay: 1, startMonth: '2026-03', installmentTotal: 14, variable: false, split: 0, kind: 'expense' }
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

describe('splitPlaceItem', () => {
  it('두 단어: 첫 단어=장소, 나머지=물건', () => {
    expect(splitPlaceItem('다이소 청소용품')).toEqual({ place: '다이소', item: '청소용품' })
  })
  it('물건에 공백 여러 단어', () => {
    expect(splitPlaceItem('투썸플레이스 딸기 라떼')).toEqual({ place: '투썸플레이스', item: '딸기 라떼' })
  })
  it('한 단어면 장소만', () => {
    expect(splitPlaceItem('스타벅스')).toEqual({ place: '스타벅스', item: '' })
  })
  it('빈 문자열', () => {
    expect(splitPlaceItem('')).toEqual({ place: '', item: '' })
  })
  it('앞뒤/중복 공백 정리', () => {
    expect(splitPlaceItem('  다이소   청소용품  ')).toEqual({ place: '다이소', item: '청소용품' })
  })
})

describe('joinPlaceItem', () => {
  it('장소+물건 결합', () => {
    expect(joinPlaceItem('다이소', '청소용품')).toBe('다이소 청소용품')
  })
  it('물건 비면 장소만', () => {
    expect(joinPlaceItem('스타벅스', '')).toBe('스타벅스')
  })
  it('둘 다 비면 빈 문자열', () => {
    expect(joinPlaceItem('', '')).toBe('')
  })
  it('앞뒤 공백 정리', () => {
    expect(joinPlaceItem(' 다이소 ', ' 청소용품 ')).toBe('다이소 청소용품')
  })
})

describe('placeTotals', () => {
  const txs = [
    { date: '2026-06-01', type: 'expense', amount: 10000, split: 0, fixedType: 'variable', memo: '코스트코 우유' },
    { date: '2026-06-02', type: 'expense', amount: 5000, split: 0, fixedType: 'variable', memo: '코스트코 빵' },
    { date: '2026-06-03', type: 'expense', amount: 3000, split: 0, fixedType: 'variable', memo: '다이소 수세미' },
    { date: '2026-06-04', type: 'expense', amount: 99000, split: 0, fixedType: 'fixed', memo: '월세' },     // 고정 제외
    { date: '2026-06-05', type: 'income', amount: 200000, split: 0, fixedType: 'variable', memo: '용돈' },  // 수입 제외
    { date: '2026-05-09', type: 'expense', amount: 7000, split: 0, fixedType: 'variable', memo: '코스트코 과자' }, // 타월 제외
  ]

  it('변동지출만 장소별 합산, 실지출 기준', () => {
    expect(placeTotals(txs, '2026-06', 7)).toEqual([
      { name: '코스트코', value: 15000 },
      { name: '다이소', value: 3000 },
    ])
  })

  it('split을 뺀 실지출로 합산', () => {
    expect(placeTotals(
      [{ date: '2026-06-01', type: 'expense', amount: 10000, split: 6000, fixedType: 'variable', memo: '코스트코 우유' }],
      '2026-06', 7,
    )).toEqual([{ name: '코스트코', value: 4000 }])
  })

  it('빈 메모는 기타로 합산', () => {
    expect(placeTotals(
      [{ date: '2026-06-01', type: 'expense', amount: 1000, split: 0, fixedType: 'variable', memo: '' }],
      '2026-06', 7,
    )).toEqual([{ name: '기타', value: 1000 }])
  })

  it('n 초과 시 나머지는 기타로', () => {
    const many = ['가', '나', '다'].map((p, i) => ({
      date: '2026-06-01', type: 'expense', amount: (3 - i) * 1000, split: 0, fixedType: 'variable', memo: `${p} 물건`,
    }))
    expect(placeTotals(many, '2026-06', 2)).toEqual([
      { name: '가', value: 3000 },
      { name: '나', value: 2000 },
      { name: '기타', value: 1000 },
    ])
  })
})

describe('categoryDeltas', () => {
  const txs = [
    { date: '2026-06-01', type: 'expense', amount: 12000, split: 0, category: '식비', fixedType: 'variable' },
    { date: '2026-06-02', type: 'expense', amount: 3000, split: 0, category: '생활', fixedType: 'variable' },
    { date: '2026-06-03', type: 'expense', amount: 50000, split: 0, category: '주거', fixedType: 'fixed' }, // 고정 제외
    { date: '2026-05-01', type: 'expense', amount: 10000, split: 0, category: '식비', fixedType: 'variable' },
    { date: '2026-05-02', type: 'expense', amount: 8000, split: 0, category: '교통', fixedType: 'variable' },
  ]

  it('두 달 합집합 카테고리, 변화량 절대값 내림차순', () => {
    expect(categoryDeltas(txs, '2026-06', '2026-05')).toEqual([
      { name: '교통', cur: 0, prev: 8000, delta: -8000, rate: -1 },
      { name: '생활', cur: 3000, prev: 0, delta: 3000, rate: null },
      { name: '식비', cur: 12000, prev: 10000, delta: 2000, rate: 0.2 },
    ])
  })

  it('전월 없으면(undefined) 이번달만, prev 0 rate null', () => {
    expect(categoryDeltas(txs, '2026-06', undefined)).toEqual([
      { name: '식비', cur: 12000, prev: 0, delta: 12000, rate: null },
      { name: '생활', cur: 3000, prev: 0, delta: 3000, rate: null },
    ])
  })
})

describe('splitBreakdown', () => {
  const tx = (memo: string, split: number, date = '2026-08-10') =>
    ({ date, type: 'expense', amount: split * 2, split, memo })
  it('환급은 정산 대상에서 분리', () => {
    const r = splitBreakdown([tx('넷플릭스(피클플러스 환급 후 5,000)', 22000)], '2026-08')
    expect(r.refund).toBe(22000)
    expect(r.settle).toBe(0)
  })
  it('상대별로 묶어 정산액 집계', () => {
    const r = splitBreakdown([tx('코스트코(브리 반반)', 112750), tx('쿠팡 와우멤버십(형 부담)', 7890)], '2026-08')
    expect(r.settle).toBe(120640)
    expect(r.byPerson).toEqual([
      { name: '여친', value: 112750 },
      { name: '형', value: 7890 },
    ])
  })
  it('상대 못 찾으면 기타', () => {
    const r = splitBreakdown([tx('월세', 600000)], '2026-08')
    expect(r.byPerson).toEqual([{ name: '기타', value: 600000 }])
  })
  it('분담 0·타월 제외', () => {
    const r = splitBreakdown([tx('커피', 0), tx('밥(브리 반반)', 5000, '2026-07')], '2026-08')
    expect(r.total).toBe(0)
  })
})

describe('parseCardStatement', () => {
  it('날짜 헤더 + 가맹점/금액 한 줄', () => {
    expect(parseCardStatement('2026.08.16\nChatGPT 26,364 원\n11:46 | 본인6633 | 일시불')).toEqual([
      { date: '2026-08-16', memo: 'ChatGPT', amount: 26364 },
    ])
  })
  it('가맹점과 금액이 다른 줄이면 윗줄을 가맹점으로', () => {
    expect(parseCardStatement('2026.08.12\n송도만두 만수점\n5,500 원')).toEqual([
      { date: '2026-08-12', memo: '송도만두 만수점', amount: 5500 },
    ])
  })
  it('날짜가 바뀌면 이후 거래에 반영, 잡음 줄 무시', () => {
    const r = parseCardStatement('카드이용내역\n2026.08.10\nLG U+ 통신요금 자동 14,990 원\n19:10 | 본인6633 | 일시불\n2026.08.09\n(주)아성다이소 36,000 원')
    expect(r).toEqual([
      { date: '2026-08-10', memo: 'LG U+ 통신요금 자동', amount: 14990 },
      { date: '2026-08-09', memo: '(주)아성다이소', amount: 36000 },
    ])
  })
  it('26. 8. 12 형식과 원 없는 줄 처리', () => {
    expect(parseCardStatement('26. 8. 12.\n코스트코코리아\n225,500원')).toEqual([
      { date: '2026-08-12', memo: '코스트코코리아', amount: 225500 },
    ])
  })
})

describe('cardPerformance', () => {
  const tx = (payment: string, amount: number, memo = '식당', date = '2026-08-10') =>
    ({ date, type: 'expense', amount, split: 0, memo, payment })
  it('약관상 제외 항목(관리비 등)만 실적에서 뺀다', () => {
    const r = cardPerformance([
      tx('하나카드', 500000, '식당'),
      tx('하나카드', 282850, '아파트 관리비'),   // 약관상 실적 제외
      tx('NH카드', 100000, '주유'),
    ], '2026-08')
    expect(r).toEqual([
      { name: '하나카드', charged: 782850, excluded: 282850, qualified: 500000 },
      { name: 'NH카드', charged: 100000, excluded: 0, qualified: 100000 },
    ])
  })
  it('할부·민간보험료는 실적에 포함(약관: 일시불/할부 이용금액)', () => {
    const r = cardPerformance([tx('하나카드', 515690, '자동차 할부'), tx('하나카드', 60190, '메리츠화재 보험')], '2026-08')
    expect(r[0].qualified).toBe(575880)
    expect(r[0].excluded).toBe(0)
  })
  it('4대보험·국세는 제외', () => {
    const r = cardPerformance([tx('하나카드', 171682, '국민연금'), tx('하나카드', 64028, '건강보험료'), tx('하나카드', 3151, '국세 네이버페이')], '2026-08')
    expect(r[0].qualified).toBe(0)
    expect(r[0].excluded).toBe(238861)
  })
  it('규칙 없는 카드는 결제액 전액이 실적', () => {
    const r = cardPerformance([tx('NH카드', 436000, '청소기 할부')], '2026-08')
    expect(r[0]).toEqual({ name: 'NH카드', charged: 436000, excluded: 0, qualified: 436000 })
  })
  it('분담금을 뺀 실부담이 아니라 결제액 기준(카드 실적은 결제액으로 잡힘)', () => {
    const t = { ...tx('하나카드', 100000), split: 50000 }
    expect(cardPerformance([t], '2026-08')[0].charged).toBe(100000)
  })
  it('타월·수입·현금은 제외', () => {
    const r = cardPerformance([
      tx('하나카드', 10000, '식당', '2026-07'),
      { date: '2026-08-01', type: 'income', amount: 999, split: 0, memo: '월급', payment: '하나카드' },
    ], '2026-08')
    expect(r).toEqual([])
  })
})

describe('tierStatus', () => {
  const tiers = [{ min: 300000, cap: 15000 }, { min: 600000, cap: 30000 }, { min: 1000000, cap: 60000 }]
  it('현재 구간과 다음 구간까지 부족액', () => {
    expect(tierStatus(654632, tiers)).toEqual({ cap: 30000, next: { min: 1000000, cap: 60000, gap: 345368 } })
  })
  it('최상위 구간이면 next 없음', () => {
    expect(tierStatus(1200000, tiers)).toEqual({ cap: 60000 })
  })
  it('최소 구간 미달이면 cap 0', () => {
    expect(tierStatus(100000, tiers)).toEqual({ cap: 0, next: { min: 300000, cap: 15000, gap: 200000 } })
  })
})

describe('dailyCheer', () => {
  const pool = ['A', 'B', 'C']
  it('같은 날은 항상 같은 문구', () => {
    expect(dailyCheer('2026-08-31', pool)).toBe(dailyCheer('2026-08-31', pool))
  })
  it('날짜가 바뀌면 문구도 돈다', () => {
    const got = ['2026-08-31', '2026-09-01', '2026-09-02'].map((d) => dailyCheer(d, pool))
    expect(new Set(got).size).toBeGreaterThan(1)
  })
  it('빈 목록이면 빈 문자열', () => {
    expect(dailyCheer('2026-08-31', [])).toBe('')
  })
})

describe('missedBenefits', () => {
  const tx = (date: string, memo: string, amount: number, payment: string) =>
    ({ id: date + memo, date, memo, amount, payment, type: 'expense' as const, split: 0 })
  // 할인한도는 전월 실적으로 결정된다 - 두 카드 모두 최고 구간을 채워둔 전월 이력.
  const prev = [tx('2026-07-10', '전월 일반결제', 1200000, '하나카드'), tx('2026-07-10', '전월 일반결제', 400000, 'NH카드')]
  const withPrev = (...rows: ReturnType<typeof tx>[]) => [...prev, ...rows]

  it('넷플릭스를 NH로 긁으면 하나카드 50%가 더 크다고 알려준다', () => {
    const rows = missedBenefits(withPrev(tx('2026-08-15', '넷플릭스', 27000, 'NH카드')), '2026-08')
    expect(rows).toHaveLength(1)
    expect(rows[0].bestCard).toBe('하나카드')
    expect(rows[0].discount).toBe(13500)
  })

  it('이미 제일 좋은 카드로 긁었으면 놓친 혜택이 아니다', () => {
    expect(missedBenefits(withPrev(tx('2026-08-15', '넷플릭스', 27000, '하나카드')), '2026-08')).toHaveLength(0)
  })

  it('건당 최소금액에 못 미치면 그 영역은 안 걸린다 (NH 영화 1만원↑)', () => {
    // 9,000원 CGV는 NH 영화할인 대상이 아니다 → 다른 카드 혜택도 없으니 결과 없음
    expect(missedBenefits(withPrev(tx('2026-08-24', 'CGV', 9000, '하나카드')), '2026-08')).toHaveLength(0)
    expect(missedBenefits(withPrev(tx('2026-08-24', 'CGV', 30000, '하나카드')), '2026-08')[0].bestCard).toBe('NH카드')
  })

  it('영역 월 한도를 넘으면 그만큼만 인정하고 소진되면 더는 안 센다', () => {
    const rows = missedBenefits(withPrev(
      tx('2026-08-01', 'CGV 1', 30000, '하나카드'),   // 30% = 9,000 → 한도 5,000
      tx('2026-08-02', 'CGV 2', 30000, '하나카드'),   // 한도 소진 → 없음
    ), '2026-08')
    expect(rows).toHaveLength(1)
    expect(rows[0].discount).toBe(5000)
  })

  it('통합 한도 카드는 서로 다른 혜택 영역도 한도를 나눠 쓴다', () => {
    const rows = missedBenefits(withPrev(
      tx('2026-08-01', '넷플릭스', 80000, '현금'),
      tx('2026-08-02', '쿠팡 와우', 80000, '현금'),
    ), '2026-08')
    expect(rows.reduce((sum, row) => sum + row.discount, 0)).toBe(60000)
  })

  it('한 건이 여러 영역에 걸리면 할인율이 큰 쪽만 적용된다', () => {
    // 스타벅스는 NH 커피 50%, 국민 커피/편의점 10% → NH가 이긴다
    const rows = missedBenefits(withPrev(tx('2026-08-20', '스타벅스', 6000, '하나카드')), '2026-08')
    expect(rows[0].bestCard).toBe('NH카드')
    expect(rows[0].rate).toBe(0.5)
  })

  it('미보유 카드는 기본 계산에서 빠지고, 후보로 넣으면 비교가 된다', () => {
    const woori = CARD_SPECS.filter((s) => s.card === '우리카드(ROUTINE)')
    const mgmt = tx('2026-08-01', '아파트 관리비', 282850, '계좌이체')
    const rows = missedBenefits([mgmt], '2026-08', woori)
    expect(rows[0].bestCard).toBe('우리카드(ROUTINE)')
    expect(rows[0].area).toBe('생활')
    expect(rows[0].discount).toBe(10000)          // 15% = 42,427 → 최고 구간 영역한도 10,000
    // 보유 카드만 볼 때는 관리비에 걸리는 혜택이 없다
    expect(missedBenefits([mgmt], '2026-08')).toHaveLength(0)
  })
})

describe('installmentCharges', () => {
  const def = (over: Partial<FixedDef>): FixedDef => ({
    id: 'x', active: true, name: '닌텐도 할부', amount: 147200, category: '취미', subCategory: '게임',
    payment: '하나카드', payDay: 1, startMonth: '2026-09', installmentTotal: 5,
    variable: false, split: 0, kind: 'expense', ...over,
  })

  it('첫 납입 한 달 전에 총액이 잡힌다', () => {
    const [c] = installmentCharges([def({})])
    expect(c.date).toBe('2026-08-01')
    expect(c.amount).toBe(736000)
    expect(c.payment).toBe('하나카드')
  })

  it('1월 시작이면 전년 12월로 넘어간다', () => {
    expect(installmentCharges([def({ startMonth: '2026-01' })])[0].date).toBe('2025-12-01')
  })

  it('할부가 아닌 고정비는 무시한다', () => {
    expect(installmentCharges([def({ installmentTotal: null })])).toHaveLength(0)
  })

  it('같은 할부의 비활성 이전 정의가 남아 있어도 한 번만 더한다', () => {
    expect(installmentCharges([
      def({ id: 'old', active: false, name: '무선청소기 할부' }),
      def({ id: 'new', active: true, name: '청소기 할부' }),
    ])).toHaveLength(1)
  })

  it('실적에 더하면 카드사 숫자에 가까워진다', () => {
    const tx = [{ id: 'a', date: '2026-08-05', memo: '일반결제', amount: 900000, payment: '하나카드', type: 'expense' as const, split: 0 }]
    const before = cardPerformance(tx, '2026-08')[0].qualified
    const after = cardPerformance([...tx, ...installmentCharges([def({})])], '2026-08')[0].qualified
    expect(before).toBe(900000)
    expect(after).toBe(1636000)
  })
})

describe('missedBenefits assumeQualified', () => {
  const tx = (date: string, memo: string, amount: number, payment: string) =>
    ({ id: date + memo, date, memo, amount, payment, type: 'expense' as const, split: 0 })

  it('전월 실적이 없으면 혜택이 아예 안 열린다', () => {
    expect(missedBenefits([tx('2026-08-24', 'CGV', 30000, '하나카드')], '2026-08')).toHaveLength(0)
  })

  it('assumeQualified면 실적을 채운 셈 치고 받을 수 있었던 금액을 낸다', () => {
    const rows = missedBenefits([tx('2026-08-24', 'CGV', 30000, '하나카드')], '2026-08', undefined, true)
    expect(rows[0].bestCard).toBe('NH카드')
    expect(rows[0].discount).toBe(5000)
  })
})

describe('unusedBenefits', () => {
  const tx = (date: string, memo: string, amount: number, payment: string) =>
    ({ id: date + memo + amount, date, memo, amount, payment, type: 'expense' as const, split: 0 })
  const nh = CARD_SPECS.filter((s) => s.card === 'NH카드')
  const prev = [tx('2026-07-10', '전월 일반결제', 400000, 'NH카드')]

  it('전월 실적을 채웠으면 안 쓴 한도가 그대로 남는다', () => {
    const rows = unusedBenefits(prev, '2026-08', nh)
    const coffee = rows.find((r) => r.area === '커피')!
    expect(coffee.locked).toBe(false)
    expect(coffee.cap).toBe(10000)
    expect(coffee.remaining).toBe(10000)
  })

  it('그 카드로 쓴 만큼 한도가 깎인다', () => {
    const rows = unusedBenefits([...prev, tx('2026-08-05', '스타벅스', 12000, 'NH카드')], '2026-08', nh)
    const coffee = rows.find((r) => r.area === '커피')!
    expect(coffee.used).toBe(6000)          // 12,000 × 50%
    expect(coffee.remaining).toBe(4000)
    expect(coffee.uses).toEqual([expect.objectContaining({ date: '2026-08-05', memo: '스타벅스', amount: 12000, discount: 6000 })])
  })

  it('다른 카드로 쓴 건 그 카드 한도를 깎지 않는다', () => {
    const rows = unusedBenefits([...prev, tx('2026-08-05', '스타벅스', 12000, '하나카드')], '2026-08', nh)
    expect(rows.find((r) => r.area === '커피')!.remaining).toBe(10000)
  })

  it('한도를 다 쓴 영역은 안내에서 빠진다', () => {
    const rows = unusedBenefits([...prev, tx('2026-08-05', '스타벅스', 40000, 'NH카드')], '2026-08', nh)
    expect(rows.find((r) => r.area === '커피')).toBeUndefined()
  })

  it('전체 잔액 조회에는 한도를 다 쓴 영역도 사용 100%로 남는다', () => {
    const rows = benefitBalances([...prev, tx('2026-08-05', '스타벅스', 40000, 'NH카드')], '2026-08', nh)
    const coffee = rows.find((r) => r.area === '커피')!
    expect(coffee.used).toBe(10000)
    expect(coffee.remaining).toBe(0)
  })

  it('스타벅스 선불카드 충전은 커피 혜택 사용으로 잡지 않는다', () => {
    const rows = benefitBalances([...prev, tx('2026-08-05', '스타벅스 카드충전', 10000, 'NH카드')], '2026-08', nh)
    const coffee = rows.find((r) => r.area === '커피')!
    expect(coffee.used).toBe(0)
    expect(coffee.remaining).toBe(10000)
  })

  it('전월 실적 미달이면 잠기고, 이번 달 부족액을 알려준다', () => {
    const rows = unusedBenefits([tx('2026-08-01', '결제', 120000, 'NH카드')], '2026-08', nh)
    const coffee = rows.find((r) => r.area === '커피')!
    expect(coffee.locked).toBe(true)
    expect(coffee.lockGap).toBe(180000)     // 30만 − 이번 달 12만
    expect(coffee.used).toBe(0)
  })
})

describe('previousMonthKey', () => {
  it('이번 달 혜택 기준월을 전월로 돌린다', () => {
    expect(previousMonthKey('2026-09')).toBe('2026-08')
    expect(previousMonthKey('2026-01')).toBe('2025-12')
  })
})

describe('unusedBenefits 한도 종류', () => {
  const tx = (date: string, memo: string, amount: number, payment: string) =>
    ({ id: date + memo + amount, date, memo, amount, payment, type: 'expense' as const, split: 0 })

  it('통합 한도 카드(하나)는 영역을 합쳐 한 줄로 낸다 - 한도가 부풀지 않게', () => {
    const hana = CARD_SPECS.filter((s) => s.card === '하나카드')
    const rows = unusedBenefits([tx('2026-07-10', '전월', 1200000, '하나카드'),
      tx('2026-08-15', '넷플릭스', 27000, '하나카드')], '2026-08', hana)
    expect(rows).toHaveLength(1)
    expect(rows[0].cap).toBe(60000)
    expect(rows[0].used).toBe(13500)
    expect(rows[0].remaining).toBe(46500)
    expect(rows[0].uses).toEqual([expect.objectContaining({ memo: '넷플릭스', discount: 13500, area: '영상 스트리밍' })])
  })

  it('하나 간편결제는 건당 1만원 이상만 통합 한도를 쓴다', () => {
    const hana = CARD_SPECS.filter((s) => s.card === '하나카드')
    const rows = benefitBalances([
      tx('2026-07-10', '전월', 1200000, '하나카드'),
      tx('2026-08-05', '네이버페이 온라인결제', 20000, '하나카드'),
      tx('2026-08-06', '카카오페이 소액결제', 9000, '하나카드'),
    ], '2026-08', hana)
    expect(rows[0].used).toBe(2000)
    expect(rows[0].remaining).toBe(58000)
    expect(rows[0].uses).toEqual([expect.objectContaining({ area: '간편결제', discount: 2000 })])
  })

  it('통합 한도 카드가 잠겨도 최저 구간 한도와 실적 부족액을 보여준다', () => {
    const hana = CARD_SPECS.filter((s) => s.card === '하나카드')
    const rows = benefitBalances([], '2026-08', hana)
    expect(rows).toHaveLength(1)
    expect(rows[0].locked).toBe(true)
    expect(rows[0].cap).toBe(15000)
    expect(rows[0].lockGap).toBe(300000)
  })

  it('가족카드 합산 카드(국민)는 원장에 결제가 없어도 잠기지 않는다', () => {
    const kb = CARD_SPECS.filter((s) => s.card === '국민카드')
    const rows = unusedBenefits([], '2026-08', kb)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => !r.locked)).toBe(true)
    expect(rows.find((r) => r.area === '온라인쇼핑')!.cap).toBe(10000)  // 최저 구간(30만) 기준으로 보수적으로
  })
})

describe('paymentPlaybook', () => {
  const tx = (date: string, memo: string, amount: number, payment: string) =>
    ({ id: date + memo + amount, date, memo, amount, payment, type: 'expense' as const, split: 0 })
  // 세 카드 모두 전월 실적을 채워 둔 상태
  const prev = [tx('2026-07-05', '전월', 1200000, '하나카드'), tx('2026-07-05', '전월', 500000, 'NH카드')]
  const rows = paymentPlaybook(prev, '2026-08')
  const find = (kw: string) => rows.find((r) => r.keywords.includes(kw))

  it('같은 가맹점을 여러 카드가 커버하면 할인이 큰 쪽이 이긴다', () => {
    // 스타벅스: NH 커피 50% vs 국민 커피/편의점 10%
    const sb = find('스타벅스')!
    expect(sb.card).toBe('NH카드')
    expect(sb.rate).toBe(0.5)
    expect(sb.runnerUp?.card).toBe('국민카드')
  })

  it('넷플릭스는 하나 50%가 NH 20%를 이긴다', () => {
    const nf = find('넷플릭스')!
    expect(nf.card).toBe('하나카드')
    expect(nf.rate).toBe(0.5)
  })

  it('승자가 같은 가맹점은 한 줄로 묶인다', () => {
    const sb = find('스타벅스')!
    expect(sb.keywords.length).toBeGreaterThanOrEqual(1)
    // 같은 (카드/영역) 조합이 두 줄로 쪼개지지 않는다
    const keys = rows.map((r) => `${r.card}/${r.area}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('할인율이 큰 순으로 정렬된다', () => {
    const rates = rows.map((r) => r.rate)
    expect([...rates].sort((a, b) => b - a)).toEqual(rates)
  })

  it('건당 최소금액 같은 조건이 같이 딸려온다', () => {
    expect(find('CGV')!.minAmount).toBe(10000)
  })
})

describe('paymentPlaybook 통합 한도 카드', () => {
  const tx = (date: string, memo: string, amount: number, payment: string) =>
    ({ id: date + memo + amount, date, memo, amount, payment, type: 'expense' as const, split: 0 })

  it('하나카드처럼 통합 한도를 쓰는 카드도 남은 한도가 잡힌다', () => {
    const rows = paymentPlaybook([tx('2026-07-05', '전월', 1200000, '하나카드')], '2026-08')
    const nf = rows.find((r) => r.keywords.includes('넷플릭스'))!
    expect(nf.card).toBe('하나카드')
    expect(nf.cap).toBe(60000)
    expect(nf.remaining).toBe(60000)   // 예전엔 영역명이 안 맞아 0으로 나왔다
  })
})

describe('isSaving', () => {
  it('저축/투자로 나가는 돈은 지출로 안 센다', () => {
    expect(isSaving({ type: 'expense', category: '저축/투자' })).toBe(true)
    expect(isSaving({ type: 'expense', category: '식비' })).toBe(false)
  })
  it('수입은 저축 판정 대상이 아니다', () => {
    expect(isSaving({ type: 'income', category: '저축/투자' })).toBe(false)
  })
  it('대출 상환은 저축이 아니다 - 현금이 실제로 나간다', () => {
    expect(isSaving({ type: 'expense', category: '금융/대출' })).toBe(false)
  })
})

describe('isNonSpend', () => {
  it('저축과 대출상환은 소비가 아니다', () => {
    expect(isNonSpend({ type: 'expense', category: '저축/투자' })).toBe(true)
    expect(isNonSpend({ type: 'expense', category: '금융/대출' })).toBe(true)
  })
  it('보통 지출은 그대로 소비다', () => {
    expect(isNonSpend({ type: 'expense', category: '외식비' })).toBe(false)
  })
  it('저축과 대출상환은 서로 다른 줄로 센다', () => {
    expect(isSaving({ type: 'expense', category: '금융/대출' })).toBe(false)
    expect(isLoanRepay({ type: 'expense', category: '저축/투자' })).toBe(false)
  })
})

describe('isCardPayment', () => {
  it('카드는 실적에 들어간다', () => {
    for (const n of ['하나카드', 'NH카드', '국민카드', '삼성카드']) expect(isCardPayment(n)).toBe(true)
  })
  it('계좌·현금·페이·뱅크는 실적이 안 쌓인다', () => {
    for (const n of ['현금', '계좌이체', '미상', '국민계좌', '네이버페이', '토스뱅크'])
      expect(isCardPayment(n)).toBe(false)
  })
  it('국민계좌가 국민카드로 섞이지 않는다', () => {
    const tx = (payment: string) => ({ id: payment, date: '2026-09-03', memo: 'x', amount: 84801, payment, type: 'expense' as const, split: 0 })
    const perf = cardPerformance([tx('국민계좌'), tx('국민카드')], '2026-09')
    expect(perf.map((c) => c.name)).toEqual(['국민카드'])
  })
})

describe('parseBankDeposits', () => {
  const sample = [
    '2026-08-31 15:25:53    출금      -133,670    4,342,778   김기환',
    '2026-08-31 15:22:57    입금     2,078,761    4,476,448   김강환',
    '2026-08-29 12:35:10    입금        10,000    1,899,000   뭉개구름(소켓)',
    '2026-08-28 13:26:19    입금        98,703    2,148,321   쿠팡이츠정산',
    '2026-08-26 19:00:47    펌뱅킹출금  -278,394   2,052,118   NH카드대금',
    '2026-08-26 10:18:24    입금        17,510    2,125,715   넷플릭스',
    '2026-08-14 16:42:42    입금       360,000    5,726,876   고용서울서초',
    '',
    '거래내역서',
  ].join('\n')
  const rows = parseBankDeposits(sample)

  it('입금만 뽑고 출금은 버린다', () => {
    expect(rows).toHaveLength(5)
    expect(rows.every((r) => r.amount > 0)).toBe(true)
    expect(rows.find((r) => r.name === 'NH카드대금')).toBeUndefined()
  })

  it('출처별로 분류한다', () => {
    expect(rows.find((r) => r.name === '쿠팡이츠정산')!.subCategory).toBe('배달')
    expect(rows.find((r) => r.name === '고용서울서초')!.subCategory).toBe('실업급여')
    expect(rows.find((r) => r.name === '넷플릭스')!.subCategory).toBe('구독환급')
  })

  it('모르는 곳은 기타로 두고 버리지 않는다', () => {
    expect(rows.find((r) => r.name === '뭉개구름(소켓)')!.subCategory).toBe('기타')
  })

  it('본인 이체도 일단 다 가져온다 - 지우는 건 화면에서 고르게 한다', () => {
    expect(rows.find((r) => r.name === '김강환')).toBeTruthy()
  })

  it('날짜를 ISO로 맞춘다', () => {
    expect(rows[0].date).toBe('2026-08-31')
  })
})

describe('지난달 실적 스냅샷', () => {
  // 끝난 달의 실적은 확정값이다. 원장을 못 읽었다고 0으로 보고 '잠김'이라 단정하면,
  // 실제로는 실적을 채운 카드의 혜택을 안 쓰게 된다. 실제로 그렇게 보였다.
  const spec = CARD_SPECS.filter((s) => s.card === 'NH카드')
  const thisMonth = [{ date: '2026-09-02', type: 'expense', amount: 5000, memo: '스타벅스', payment: 'NH카드', split: 0 }]

  it('원장에 전월이 없으면 저장된 실적으로 혜택을 연다', () => {
    const known = new Map([['NH카드', 832186]])
    const out = benefitBalances(thisMonth as never, '2026-09', spec, known)
    expect(out.every((b) => !b.locked)).toBe(true)
  })

  it('저장된 실적이 없으면 그대로 잠긴다', () => {
    const out = benefitBalances(thisMonth as never, '2026-09', spec)
    expect(out.every((b) => b.locked)).toBe(true)
  })

  it('원장에 전월이 있으면 저장값이 아니라 원장이 이긴다', () => {
    const rows = [...thisMonth, { date: '2026-08-10', type: 'expense', amount: 10000, memo: '점심', payment: 'NH카드', split: 0 }]
    const out = benefitBalances(rows as never, '2026-09', spec, new Map([['NH카드', 832186]]))
    expect(out.every((b) => b.locked)).toBe(true)   // 원장 기준 1만원 → 30만 미달
  })
})

describe('isCardPayment', () => {
  // 제외 목록 방식일 때는 원장에 새 표기가 하나 들어올 때마다 유령 카드가 생겼다.
  // '온라인결제'·'알리'·'온누리상품권' 이 각각 카드 한 장으로 실적에 잡히고 있었다.
  it('카드처럼 보이는 것만 카드로 본다', () => {
    for (const n of ['하나카드', 'NH카드', '이음카드', '여친카드', '토스체크']) expect(isCardPayment(n)).toBe(true)
    for (const n of ['현금', '계좌이체', '미상', '카드/현금', '국민계좌', '네이버페이', '토스뱅크',
      '온라인결제', '알리', '온누리상품권', '토스', '카드/이체', '현금/이체', '페이']) expect(isCardPayment(n)).toBe(false)
  })
})
