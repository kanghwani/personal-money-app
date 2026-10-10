import { describe, it, expect } from 'vitest'
import { RULES, classifyMemo } from './classifyRules'

describe('classifyMemo', () => {
  const ko = RULES
  it('커피 → 외식비/카페', () => {
    expect(classifyMemo('커피 한잔', ko)).toEqual({ category: '외식비', sub: '카페' })
  })
  it('사먹는 것과 사와서 해먹는 것은 대분류가 갈린다', () => {
    expect(classifyMemo('점심 김밥', ko).category).toBe('외식비')
    expect(classifyMemo('배민 치킨', ko)).toEqual({ category: '외식비', sub: '배달' })
    expect(classifyMemo('이마트 장보기', ko)).toEqual({ category: '식비', sub: '장보기' })
    expect(classifyMemo('편의점 우유', ko)).toEqual({ category: '식비', sub: '간편식' })
  })
  it('미매칭 → 미분류', () => {
    expect(classifyMemo('zzz', ko)).toEqual({ category: '미분류', sub: '' })
  })
})

describe('RULES.defaultOptions (회귀 방지)', () => {
  it('빠른 분류 후보 (식비/외식비 분리 반영)', () => {
    expect(RULES.defaultOptions).toEqual([
      { category: '외식비', subCategory: '외식' },
      { category: '외식비', subCategory: '카페' },
      { category: '식비', subCategory: '장보기' },
      { category: '생활', subCategory: '생활잡화' },
      { category: '교통/차량', subCategory: '' },
      { category: '주거/통신', subCategory: '' },
      { category: '건강', subCategory: '' },
      { category: '문화/구독', subCategory: '구독' },
      { category: '취미', subCategory: '게임' },
    ])
  })
})

describe('RuleSet.fixedKeywordsRe / fixedToken / variableToken (F-minor-a)', () => {
  it('ko: 기존 키워드 회귀 방지', () => {
    expect(RULES.fixedKeywordsRe.test('월세')).toBe(true)
    expect(RULES.fixedKeywordsRe.test('건강보험')).toBe(true)
    expect(RULES.fixedKeywordsRe.test('점심')).toBe(false)
    expect(RULES.fixedToken).toBe('고정')
    expect(RULES.variableToken).toBe('변동')
  })
})

describe('농협/NH 결제수단 (2026-08 추가)', () => {
  const ko = RULES
  it('농협 표기가 결제수단 후보에 있다', () => {
    for (const w of ['농협카드', 'NH카드', '농협', 'NH']) expect(ko.payments).toContain(w)
  })
  it('농협 계열은 NH카드로 통일된다', () => {
    for (const w of ['농협', '농협카드', 'NH']) expect(ko.paymentAlias[w]).toBe('NH카드')
  })
  it('구체 카드명이 농협보다 앞에 있어 먼저 매칭된다', () => {
    expect(ko.payments.indexOf('하나카드')).toBeLessThan(ko.payments.indexOf('농협'))
    expect(ko.payments.indexOf('농협카드')).toBeLessThan(ko.payments.indexOf('농협'))
    expect(ko.payments.indexOf('농협')).toBeLessThan(ko.payments.indexOf('카드'))
  })
})
