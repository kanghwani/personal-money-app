import { describe, it, expect } from 'vitest'
import { upsertRule, classifyByLearned, type LearnedRule } from './learnedRules'

describe('upsertRule', () => {
  it('새 규칙을 앞에 추가', () => {
    const out = upsertRule([], { keyword: '서브웨이', category: '식비', subCategory: '외식' })
    expect(out).toEqual([{ keyword: '서브웨이', category: '식비', subCategory: '외식' }])
  })
  it('같은 keyword(대소문자/공백 무시)는 갱신하고 앞으로', () => {
    const base: LearnedRule[] = [
      { keyword: 'A', category: '취미', subCategory: '게임' },
      { keyword: '서브웨이', category: '식비', subCategory: '외식' },
    ]
    const out = upsertRule(base, { keyword: ' 서브웨이 ', category: '식비', subCategory: '배달' })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ keyword: '서브웨이', category: '식비', subCategory: '배달' })
  })
  it('빈 keyword/category는 무시', () => {
    expect(upsertRule([], { keyword: '  ', category: '식비', subCategory: '' })).toEqual([])
    expect(upsertRule([], { keyword: '카페', category: '', subCategory: '' })).toEqual([])
  })
})

describe('classifyByLearned', () => {
  const rules: LearnedRule[] = [
    { keyword: '서브웨이', category: '식비', subCategory: '외식' },
    { keyword: '서브웨이 강남', category: '식비', subCategory: '배달' },
  ]
  it('포함되면 매칭', () => {
    expect(classifyByLearned('서브웨이 8000', rules)).toEqual({ category: '식비', subCategory: '외식' })
  })
  it('긴 keyword 우선', () => {
    expect(classifyByLearned('서브웨이 강남점 9000', rules)).toEqual({ category: '식비', subCategory: '배달' })
  })
  it('미매칭은 null', () => {
    expect(classifyByLearned('스타벅스', rules)).toBeNull()
  })
  it('빈 메모는 null', () => {
    expect(classifyByLearned('', rules)).toBeNull()
  })
})
