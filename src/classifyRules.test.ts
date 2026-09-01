import { describe, it, expect } from 'vitest'
import { RULES, classifyMemo, PROFILE, LANG } from './classifyRules'

describe('PROFILE/LANG 단일 출처(F5)', () => {
  it('LANG은 오직 PROFILE에서만 파생된다(VITE_LANG을 독립적으로 보지 않음)', () => {
    expect(LANG).toBe(PROFILE === 'es' ? 'es' : 'ko')
  })
  it('기본(테스트 환경, VITE_PROFILE 미설정)에서는 안전하게 ko로 fail-closed', () => {
    expect(PROFILE).toBe('')
    expect(LANG).toBe('ko')
  })
})

describe('classifyMemo es', () => {
  const es = RULES.es
  it('café → Cafetería', () => {
    expect(classifyMemo('café con leche', es)).toEqual({ category: 'Comida', sub: 'Cafetería' })
  })
  it('supermercado → Comida/Supermercado', () => {
    expect(classifyMemo('supermercado Mercadona', es)).toEqual({ category: 'Comida', sub: 'Supermercado' })
  })
  it('미매칭 → Sin categoría', () => {
    expect(classifyMemo('xyzabc', es)).toEqual({ category: 'Sin categoría', sub: '' })
  })
})

describe('classifyMemo ko (기존 유지)', () => {
  const ko = RULES.ko
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

describe('RULES.es.defaultOptions (F2)', () => {
  it('한국어 카테고리가 섞여 있지 않다', () => {
    const koCats = new Set(RULES.ko.defaultOptions.map((o) => o.category))
    for (const o of RULES.es.defaultOptions) {
      expect(koCats.has(o.category)).toBe(false)
    }
  })
  it('es.categoryRules에 실제로 존재하는 카테고리만 사용한다', () => {
    const validCats = new Set(RULES.es.categoryRules.map((r) => r.category))
    for (const o of RULES.es.defaultOptions) {
      expect(validCats.has(o.category)).toBe(true)
    }
  })
  it('10개 항목(스펙과 동일)', () => {
    expect(RULES.es.defaultOptions.length).toBe(10)
  })
})

describe('RULES.ko.defaultOptions (회귀 방지)', () => {
  it('빠른 분류 후보 (식비/외식비 분리 반영)', () => {
    expect(RULES.ko.defaultOptions).toEqual([
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
    expect(RULES.ko.fixedKeywordsRe.test('월세')).toBe(true)
    expect(RULES.ko.fixedKeywordsRe.test('건강보험')).toBe(true)
    expect(RULES.ko.fixedKeywordsRe.test('점심')).toBe(false)
    expect(RULES.ko.fixedToken).toBe('고정')
    expect(RULES.ko.variableToken).toBe('변동')
  })
  it('es: 대소문자 무관하게 매칭', () => {
    expect(RULES.es.fixedKeywordsRe.test('alquiler')).toBe(true)
    expect(RULES.es.fixedKeywordsRe.test('Alquiler')).toBe(true)
    expect(RULES.es.fixedKeywordsRe.test('SUSCRIPCIÓN')).toBe(true)
    expect(RULES.es.fixedKeywordsRe.test('café')).toBe(false)
    expect(RULES.es.fixedToken).toBe('fijo')
    expect(RULES.es.variableToken).toBe('variable')
  })
})

describe('농협/NH 결제수단 (2026-08 추가)', () => {
  const ko = RULES.ko
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
