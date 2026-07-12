import { describe, it, expect } from 'vitest'
import { ko, es, makeT } from './i18n'

describe('i18n', () => {
  it('ko/es 키 집합이 동일', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(es).sort())
  })
  it('t가 변수 치환', () => {
    const t = makeT({ greet: 'Hola {name}' })
    expect(t('greet', { name: 'Bri' })).toBe('Hola Bri')
  })
  it('누락 키는 키 자체 반환', () => {
    const t = makeT({})
    expect(t('missing')).toBe('missing')
  })
})
