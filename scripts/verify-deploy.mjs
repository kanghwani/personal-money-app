/**
 * 배포 확인. 소스의 툴 스키마와 실서버가 서빙하는 스키마를 대조한다.
 *   node scripts/verify-deploy.mjs [base-url]
 * 토큰은 환경변수 SYNC_TOKEN, 없으면 .env 의 VITE_SYNC_TOKEN 을 쓴다(CI 에서는 환경변수로).
 */
import { readFileSync } from 'node:fs'

const base = process.argv[2] || 'https://personal-money-app-seven.vercel.app'
function tokenFromEnvFile() {
  try {
    const line = readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n').find((l) => l.startsWith('VITE_SYNC_TOKEN='))
    return line ? line.slice('VITE_SYNC_TOKEN='.length).trim() : null
  } catch { return null }
}
const token = process.env.SYNC_TOKEN || tokenFromEnvFile()
if (!token) { console.error('SYNC_TOKEN 이 없습니다'); process.exit(2) }

const source = readFileSync(new URL('../api/mcp.ts', import.meta.url), 'utf8')
/** 소스에서 툴 이름과 properties 키를 뽑는다 */
const expected = new Map()
for (const m of source.matchAll(/\{ name: '([\w_]+)',[\s\S]*?inputSchema: \{ type: 'object', properties: \{([\s\S]*?)\}\s*\}(?:,)?\s*\},/g)) {
  expected.set(m[1], [...m[2].matchAll(/(\w+): \{ type:/g)].map((x) => x[1]).sort())
}

const res = await fetch(`${base}/api/toolcheck?t=${encodeURIComponent(token)}`)
if (!res.ok) { console.error(`실서버 응답 ${res.status}`); process.exit(1) }
const live = await res.json()
if (!live.ok) { console.error('실서버 오류:', live.error); process.exit(1) }

let bad = 0
for (const tool of live.tools) {
  const want = expected.get(tool.name)
  if (!want) { console.log(`  ? ${tool.name} 소스에서 못 찾음 (정규식 한계, 실서버: [${tool.properties}])`); continue }
  if (JSON.stringify(want) !== JSON.stringify(tool.properties)) {
    bad++
    console.log(`  X ${tool.name}\n      소스   [${want}]\n      실서버 [${tool.properties}]`)
  }
}
const missing = [...expected.keys()].filter((n) => !live.tools.some((t) => t.name === n))
if (missing.length) { bad++; console.log(`  X 실서버에 없는 툴: ${missing.join(', ')}`) }
console.log(bad ? `\n어긋남 ${bad}건. 배포가 아직 안 왔거나 옛 번들입니다.` : `\n소스와 실서버 스키마 일치 (툴 ${live.count}개).`)
process.exit(bad ? 1 : 0)
