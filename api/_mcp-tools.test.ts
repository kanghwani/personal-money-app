import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TOOLS } from './mcp.js'

/**
 * 툴 정의와 핸들러가 어긋나는 것을 막는다.
 * 실제로 있었던 사고: coach_week 핸들러는 args.week 를 읽는데 inputSchema 에 week 를 안 올려서
 * 클라이언트가 넘길 방법이 없었다(설명에는 넘기라고 적혀 있었다).
 */
const source = readFileSync(new URL('./mcp.ts', import.meta.url), 'utf8')

/** `if (name === 'X') { ... }` 블록을 툴 이름별로 잘라낸다 */
function handlerBlocks(): Map<string, string> {
  const out = new Map<string, string>()
  const marks = [...source.matchAll(/if \(name === '([\w_]+)'\)/g)]
  marks.forEach((m, i) => {
    const start = m.index ?? 0
    const end = i + 1 < marks.length ? (marks[i + 1].index ?? source.length) : source.length
    out.set(m[1], source.slice(start, end))
  })
  return out
}

const blocks = handlerBlocks()
const propsOf = (t: (typeof TOOLS)[number]) => Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {})

describe('MCP 툴 정의', () => {
  it('coach_week 는 week 를, coach_month 는 month 를 받는다 (실제로 빠졌던 인자)', () => {
    expect(propsOf(TOOLS.find((t) => t.name === 'coach_week')!)).toContain('week')
    expect(propsOf(TOOLS.find((t) => t.name === 'coach_month')!)).toContain('month')
  })

  it('모든 툴에 핸들러가 있다', () => {
    const missing = TOOLS.map((t) => t.name).filter((n) => !blocks.has(n))
    expect(missing, `핸들러 없는 툴: ${missing.join(', ')}`).toEqual([])
  })

  it('핸들러가 읽는 인자는 전부 inputSchema 에 선언돼 있다', () => {
    const problems: string[] = []
    for (const tool of TOOLS) {
      const block = blocks.get(tool.name)
      if (!block) continue
      const used = new Set([...block.matchAll(/\bargs\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
      const declared = new Set(propsOf(tool))
      for (const key of used) if (!declared.has(key)) problems.push(`${tool.name} 이 args.${key} 를 읽는데 스키마에 없음`)
    }
    expect(problems, problems.join('\n')).toEqual([])
  })

  it('required 로 적은 인자는 properties 에도 있다', () => {
    const problems: string[] = []
    for (const tool of TOOLS) {
      const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] }
      for (const key of schema.required ?? []) if (!(key in (schema.properties ?? {}))) problems.push(`${tool.name}.${key}`)
    }
    expect(problems, `required 인데 properties 에 없음: ${problems.join(', ')}`).toEqual([])
  })

  it('설명에서 언급한 인자 이름은 실제로 선언돼 있다', () => {
    const problems: string[] = []
    const names = TOOLS.map((t) => t.name)
    for (const tool of TOOLS) {
      const declared = propsOf(tool)
      // 다른 툴의 인자를 안내하는 문장은 제외한다 (예: coach_history 가 "coach_week 에 week 를 넘긴다"고 안내)
      const own = tool.description.split(/(?<=[.。])\s*/)
        .filter((sentence) => !names.some((n) => n !== tool.name && sentence.includes(n)))
        .join(' ')
      // "week 에", "month 를" 처럼 자기 인자를 지목하는 안내가 있으면 그 인자가 있어야 한다
      for (const word of ['week', 'month', 'metric', 'days', 'months', 'limit']) {
        const mentioned = new RegExp(`\\b${word} (에|를|을|는|가)`).test(own)
        if (mentioned && !declared.includes(word)) problems.push(`${tool.name} 설명이 ${word} 를 안내하는데 스키마에 없음`)
      }
    }
    expect(problems, problems.join('\n')).toEqual([])
  })
})
