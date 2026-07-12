import { describe, it, expect } from 'vitest'
import appSource from './App.tsx?raw'
import { ko, es, makeT } from './i18n'

describe('i18n', () => {
  it('ko/es 키 집합이 동일', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(es).sort())
  })
  it('App.tsx의 모든 t(키)가 사전에 정의됨(고아 키 없음)', () => {
    // 정확히 t('key') 호출만(앞이 식별자 문자가 아니어야 함 → asset( 등 오탐 방지)
    const used = [...appSource.matchAll(/(?<![A-Za-z0-9_])t\('([^']+)'/g)].map((m) => m[1])
    const missing = [...new Set(used)].filter((k) => !(k in ko)).sort()
    expect(missing).toEqual([])
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
