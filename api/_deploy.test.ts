import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOOLS } from './mcp.js'

/**
 * 배포 확인. 소스 기반 검사는 "코드가 맞는가"만 본다. 배포가 아직 안 왔거나 옛 번들이 살아 있으면
 * 테스트는 전부 통과하는데 클라이언트는 옛 스키마를 받는다. 그 구간을 여기서 닫는다.
 *
 * 네트워크를 타므로 평소 `npm test` 에서는 건너뛴다. `npm run verify:deploy` 로만 돌린다.
 */
const enabled = process.env.VERIFY_DEPLOY === '1'
const base = process.env.DEPLOY_URL || 'https://personal-money-app-seven.vercel.app'
const token = process.env.SYNC_TOKEN || (() => {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('VITE_SYNC_TOKEN='))
    return line ? line.slice('VITE_SYNC_TOKEN='.length).trim() : ''
  } catch { return '' }
})()

const props = (t: (typeof TOOLS)[number]) =>
  Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).sort()

describe.skipIf(!enabled)('배포된 서버의 툴 스키마', () => {
  it('소스와 실서버가 같은 툴 목록과 인자를 갖는다', async () => {
    expect(token, 'SYNC_TOKEN 이 필요합니다').toBeTruthy()
    const res = await fetch(`${base}/api/toolcheck?t=${encodeURIComponent(token)}`)
    expect(res.status, `${base} 응답`).toBe(200)
    const live = await res.json() as { ok: boolean; tools: { name: string; properties: string[] }[] }
    expect(live.ok).toBe(true)

    const expected = Object.fromEntries(TOOLS.map((t) => [t.name, props(t)]))
    const actual = Object.fromEntries(live.tools.map((t) => [t.name, t.properties]))
    expect(Object.keys(actual).sort(), '툴 목록').toEqual(Object.keys(expected).sort())
    for (const name of Object.keys(expected)) {
      expect(actual[name], `${name} 의 인자`).toEqual(expected[name])
    }
  }, 30_000)
})
