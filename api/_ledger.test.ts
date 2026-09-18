import { describe, expect, it } from 'vitest'
import { bucketOf, monthSummary, splitReport, settleTargets, settledMemo, type Tx } from './_ledger.js'

const tx = (p: Partial<Tx>): Tx => ({
  id: 'aaaaaaaa-1', date: '2026-09-05', type: 'expense', amount: 1000, memo: '', category: '', subCategory: '',
  payment: '', fixedType: 'variable', split: 0, ...p,
})

describe('월 요약 묶음', () => {
  it('고정비를 성격대로 나눈다', () => {
    expect(bucketOf(tx({ fixedType: 'fixed', category: '금융/대출' }))).toBe('부채상환')
    expect(bucketOf(tx({ fixedType: 'fixed', memo: '자동차 할부 (18/48)', category: '교통/차량' }))).toBe('부채상환')
    expect(bucketOf(tx({ fixedType: 'fixed', category: '저축/투자' }))).toBe('저축')
    expect(bucketOf(tx({ fixedType: 'fixed', category: '주거/통신' }))).toBe('생활고정')
    expect(bucketOf(tx({ memo: '이케아 3개월할부' }))).toBe('변동')  // 변동은 할부여도 변동
  })
  it('분담금을 뺀 실지출로 합산한다', () => {
    const exp = [
      tx({ id: 'a', fixedType: 'fixed', category: '주거/통신', amount: 997500, split: 650000 }),
      tx({ id: 'b', fixedType: 'fixed', category: '금융/대출', amount: 430258 }),
      tx({ id: 'c', fixedType: 'fixed', memo: '맥북프로 할부 (7/14)', category: '생활', amount: 179354 }),
      tx({ id: 'd', fixedType: 'fixed', category: '저축/투자', amount: 22000 }),
      tx({ id: 'e', amount: 5000 }),
    ]
    const s = monthSummary(exp, [tx({ id: 'i', type: 'income', amount: 100 })], '2026-09')
    expect(s).toContain('생활고정 347,500원 · 변동 5,000원')
    expect(s).toContain('부채상환 609,612원 (대출 430,258원 · 할부 179,354원) · 저축 22,000원')
    expect(s).toContain('수입 100원')
  })
})

describe('분담금 정산', () => {
  const all = [
    tx({ id: 'a1', date: '2026-08-05', memo: '월세(여친 분담)', amount: 997500, split: 600000 }),  // 기준일 전 → 정산됨
    tx({ id: 'b1', date: '2026-09-05', memo: '월세(여친 분담) · 09-11 브리 650,000 받음', amount: 997500, split: 650000 }),
    tx({ id: 'c1', date: '2026-09-11', memo: '코스트코 장보기(브리 반반)', amount: 254820, split: 127410 }),
    tx({ id: 'd1', date: '2026-09-01', memo: '하얀기린동물병원 · 엄마 분담', amount: 80000, split: 40000 }),
    tx({ id: 'e1', date: '2026-09-15', memo: '넷플릭스(피클플러스 환급)', amount: 27000, split: 22000 }),
    tx({ id: 'f1', date: '2026-09-14', memo: '쿠팡 와우멤버십(형 부담)', amount: 7890, split: 7890 }),
  ]
  it('안 받은 것만 상대별로, 이번 달은 받을·받음·남음', () => {
    const r = splitReport(all, '2026-09')
    expect(r).toContain('[안 받은 분담금] 175,300원 · 3건')
    expect(r).toContain('여친 127,410원')
    expect(r).toContain('엄마 40,000원')
    expect(r).toContain('형 7,890원')
    expect(r).not.toContain('08-05')
    expect(r).toContain('[2026-09 정산] 받을 825,300원 · 받음 650,000원 · 남음 175,300원')
    expect(r).toContain('여친 받을 777,410원 · 받음 650,000원')
    expect(r).toContain('[자동 환급] 22,000원')
  })
  it('받았다 대상은 안 받은 것 중 메모나 id 로 찾는다', () => {
    expect(settleTargets(all, '코스트코').map((t) => t.id)).toEqual(['c1'])
    expect(settleTargets(all, '월세')).toEqual([])  // 이미 받음
    expect(settleTargets(all, 'd1').map((t) => t.id)).toEqual(['d1'])
    expect(settledMemo('코스트코', '2026-09-18')).toBe('코스트코 · 받음 09-18')
  })
})
