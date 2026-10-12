import { describe, it, expect } from 'vitest'
import { fmt, daysInMonth, addMonths, categoryBaselines, categoryVerdict, categoryStates, coachAdvice, alertFor, coachDate, kstToday, type CoachTx } from './coach'

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

describe('coachAdvice', () => {
  const card = (date: string, amount: number, payment: string) => tx(date, amount, { payment, memo: '마트', category: '생활', fixedType: 'fixed' })
  const ids = (a: { id: string }[]) => a.map((x) => x.id)

  it('실적 첫 구간 미달이면 D-배지와 함께 실적 부족', () => {
    const a = coachAdvice([card('2026-10-10', 210000, '하나카드')], [], '2026-10-26').find((x) => x.id === 'tier:하나카드')!
    expect(a).toMatchObject({ kind: 'tier', title: '하나카드 실적 9만 더 필요', badge: 'D-5', due: '2026-10-31', target: 'insights' })
    expect(a.detail).toContain('11월 할인한도 1.5만')
  })
  it('다음 구간까지 5만 이하면 다음 구간 근접', () => {
    const a = coachAdvice([card('2026-10-10', 560000, '하나카드')], [], '2026-10-20').find((x) => x.id === 'nextTier:하나카드')!
    expect(a.title).toBe('하나카드 4만 더 쓰면 한도 올라가요')
    expect(a.detail).toBe('다음 달 할인한도 1.5만 → 3만')
  })
  it('가족 합산 카드(국민)는 실적 조언이 없다', () => {
    expect(ids(coachAdvice([], [], '2026-10-26')).filter((i) => i.endsWith('국민카드') && /tier/i.test(i))).toEqual([])
  })
  it('전월 실적을 채운 카드는 이번 달 남은 혜택을 카드별 한 줄로', () => {
    const a = coachAdvice([card('2026-09-10', 300000, 'NH카드')], [], '2026-10-20').find((x) => x.id === 'unused:NH카드')!
    expect(a.title).toBe('NH카드 혜택 4.5만 남음')
    expect(a.detail).toContain('커피 50% 1만')
  })
  it('다른 보유 카드였으면 3천원 이상 더 받았을 때 놓친 혜택', () => {
    const a = coachAdvice([tx('2026-10-12', 50000, { memo: '쿠팡', category: '생활' })], [], '2026-10-20').find((x) => x.kind === 'missed')!
    expect(a).toMatchObject({ id: 'missed:온라인쇼핑:국민카드', title: '온라인쇼핑엔 국민카드', amount: 5000 })
  })
  it('안 받은 지 30일 넘은 분담금만', () => {
    const old = tx('2026-09-02', 60000, { memo: '여친 저녁', split: 30000 })
    const fresh = tx('2026-10-01', 60000, { memo: '여친 점심', split: 20000 })
    const a = coachAdvice([old, fresh], [], '2026-10-11').filter((x) => x.kind === 'split')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id: 'split:여친', title: '여친 분담금 3만 받을 돈', detail: '1건, 가장 오래된 건 9/2' })
  })
  it('미분류와 끝난 달 부수입 0건', () => {
    const a = coachAdvice([tx('2026-10-05', 8000, { category: '미분류' })], [], '2026-10-11')
    expect(a.find((x) => x.id === 'record:uncategorized')).toMatchObject({ title: '미분류 1건', target: 'uncategorized' })
    expect(a.find((x) => x.id === 'record:side')?.title).toBe('9월 부수입 0건')
    const paid = coachAdvice([tx('2026-09-30', 120000, { type: 'income', category: '수입', subCategory: '부수입' })], [], '2026-10-11')
    expect(ids(paid)).not.toContain('record:side')
  })
  it('카테고리: 많이 씀·여유 문장', () => {
    const hist = [tx('2026-07-10', 340000), tx('2026-08-10', 340000), tx('2026-09-10', 340000)]
    const heavy = coachAdvice([...hist, tx('2026-10-08', 220000)], [], '2026-10-12').find((x) => x.id === 'cat:외식비')!
    expect(heavy.title).toBe('외식비 많이 썼어요')
    expect(heavy.detail).toContain('남은 19일은 하루')
    const room = coachAdvice([...hist, tx('2026-10-08', 60000)], [], '2026-10-17').find((x) => x.id === 'cat:외식비')!
    expect(room.title).toBe('외식비 여유 있어요')
    expect(room.detail).toBe('남은 14일 동안 28만까지 괜찮아요. 맛있는 거 드세요')
  })
  it('정렬: 마감 가까운 것 먼저, 같으면 금액 큰 것', () => {
    const a = coachAdvice([], [], '2026-10-26')
    const key = (x: { due?: string }) => x.due ?? '9999-99-99'
    for (let i = 1; i < a.length; i++) {
      expect(key(a[i - 1]) <= key(a[i])).toBe(true)
      if (key(a[i - 1]) === key(a[i])) expect(a[i - 1].amount).toBeGreaterThanOrEqual(a[i].amount)
    }
    expect(a.findIndex((x) => x.id === 'tier:NH카드')).toBeLessThan(a.findIndex((x) => x.id === 'tier:하나카드'))   // 4.5만 > 1.5만
  })
})

describe('alertFor — 보내는 날', () => {
  const hist = [tx('2026-07-10', 340000), tx('2026-08-10', 340000), tx('2026-09-10', 340000)]
  it('말일 5일 전·2일 전에 실적 부족, 그 사이엔 없음 (31일 달)', () => {
    const a = alertFor([], [], '2026-10-26')!
    expect(a.title.startsWith('[가계부] 10/26 ')).toBe(true)
    expect(a.title).toContain('실적'); expect(a.title).toContain('외 1건')
    expect(alertFor([], [], '2026-10-29')).not.toBeNull()
    expect(alertFor([], [], '2026-10-27')).toBeNull()
  })
  it('30일 달·평년 2월·윤년 2월', () => {
    expect(alertFor([], [], '2026-11-25')).not.toBeNull(); expect(alertFor([], [], '2026-11-24')).toBeNull()
    expect(alertFor([], [], '2027-02-23')).not.toBeNull()
    expect(alertFor([], [], '2028-02-24')).not.toBeNull(); expect(alertFor([], [], '2028-02-23')).toBeNull()
  })
  it('1일에 분담금, 제목 날짜는 0을 채운다', () => {
    const a = alertFor([tx('2026-10-01', 60000, { memo: '여친 저녁', split: 30000 })], [], '2026-11-01')!
    expect(a.title).toBe('[가계부] 11/01 여친 분담금 3만 받을 돈')
    expect(a.body).toBe('• 여친 분담금 3만 받을 돈\n  1건, 가장 오래된 건 10/1')
  })
  it('3일에 끝난 달 부수입 0건, 넣었으면 없음', () => {
    expect(alertFor([], [], '2026-11-03')?.title).toBe('[가계부] 11/03 10월 부수입 0건')
    expect(alertFor([tx('2026-10-31', 90000, { type: 'income', category: '수입', subCategory: '부수입' })], [], '2026-11-03')).toBeNull()
  })
  it('말일 3일 전, 남은 혜택 합 1만 이상', () => {
    const a = alertFor([tx('2026-09-10', 300000, { payment: 'NH카드', memo: '마트', category: '생활', fixedType: 'fixed' })], [], '2026-10-28')!
    expect(a.body).toContain('NH카드 혜택')
  })
  it('15일 중간 점검: 많이 쓴 카테고리', () => {
    expect(alertFor([...hist, tx('2026-10-10', 250000)], [], '2026-10-15')?.body).toContain('외식비 많이 썼어요')
  })
  it('한 달치를 처음 넘은 날만, 7일 이전이어도', () => {
    const ts = [...hist, tx('2026-10-05', 330000), tx('2026-10-06', 20000)]
    expect(alertFor(ts, [], '2026-10-06')?.body).toContain('외식비 평소 한 달치를 넘었어요')
    expect(alertFor(ts, [], '2026-10-07')).toBeNull()
  })
})

describe('coachDate', () => {
  it('KST 로 날짜를 잡는다 (UTC 15:30 = KST 다음 날 00:30)', () => {
    expect(kstToday(Date.parse('2026-10-11T15:30:00Z'))).toBe('2026-10-12')
  })
  it('date 인자는 YYYY-MM-DD 만 받고 나머지는 오늘', () => {
    const now = Date.parse('2026-10-11T03:00:00Z')
    expect(coachDate('2026-10-26', now)).toBe('2026-10-26')
    expect(coachDate('2026-1-5', now)).toBe('2026-10-11')
    expect(coachDate('abc', now)).toBe('2026-10-11')
    expect(coachDate(undefined, now)).toBe('2026-10-11')
  })
})
