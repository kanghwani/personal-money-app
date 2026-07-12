import { describe, it, expect } from 'vitest'
import { RULES, classifyMemo } from './classifyRules'

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
  it('커피 → 식비/카페', () => {
    expect(classifyMemo('커피 한잔', ko)).toEqual({ category: '식비', sub: '카페' })
  })
  it('미매칭 → 미분류', () => {
    expect(classifyMemo('zzz', ko)).toEqual({ category: '미분류', sub: '' })
  })
})
