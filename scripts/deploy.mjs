/**
 * 배포 + 검증 + 알림.
 *
 * 소스와 실서버는 테스트로 대조할 수 있지만, 실서버와 클로드 앱 커넥터 사이는 테스트로 닫을 수 없다.
 * 앱이 툴 스키마를 캐시하기 때문이다. 새 툴은 목록 갱신에 잡히지만 **기존 툴의 인자 변경은 안 잡힌다.**
 * 그래서 여기서 배포 전후의 실서버 스키마를 비교해, 기존 툴의 인자가 바뀌었을 때만 크게 알린다.
 *
 *   node scripts/deploy.mjs          (npm run deploy:prod)
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.DEPLOY_URL || 'https://personal-money-app-seven.vercel.app'
const token = process.env.SYNC_TOKEN || (() => {
  const line = readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').find((l) => l.startsWith('VITE_SYNC_TOKEN='))
  return line ? line.slice('VITE_SYNC_TOKEN='.length).trim() : ''
})()

async function liveTools() {
  if (!token) return null
  try {
    const res = await fetch(`${BASE}/api/toolcheck?t=${encodeURIComponent(token)}`)
    if (!res.ok) return null
    const d = await res.json()
    return d.ok ? new Map(d.tools.map((t) => [t.name, t.properties.join(',')])) : null
  } catch { return null }
}

const before = await liveTools()
console.log(before ? `배포 전 툴 ${before.size}개` : '배포 전 스키마를 못 읽었습니다(첫 배포이거나 토큰 없음)')

console.log('\n배포 중...')
execFileSync('npx', ['-y', 'vercel', '--prod', '--yes'], { stdio: 'inherit' })

// 전파를 잠시 기다린다
let after = null
for (let i = 0; i < 10; i++) {
  await new Promise((r) => setTimeout(r, 3000))
  after = await liveTools()
  if (after && (!before || [...after].some(([k, v]) => before.get(k) !== v) || after.size !== before.size)) break
}
if (!after) { console.log('\n실서버 스키마를 확인하지 못했습니다. npm run verify:deploy 로 다시 시도하세요.'); process.exit(0) }

const added = [...after.keys()].filter((n) => !before?.has(n))
const removed = before ? [...before.keys()].filter((n) => !after.has(n)) : []
const changed = before ? [...after].filter(([n, v]) => before.has(n) && before.get(n) !== v).map(([n, v]) => `${n}: [${before.get(n)}] → [${v}]`) : []

console.log(`\n배포 후 툴 ${after.size}개`)
if (added.length) console.log(`  새 툴: ${added.join(', ')}`)
if (removed.length) console.log(`  사라진 툴: ${removed.join(', ')}`)
if (changed.length) {
  console.log('\n' + '='.repeat(60))
  console.log('기존 툴의 인자가 바뀌었습니다:')
  changed.forEach((c) => console.log('  ' + c))
  console.log('\n클로드 앱은 기존 툴의 인자 변경을 목록 새로고침으로 못 잡습니다.')
  console.log('설정 > 커넥터 > 가계부원격 을 삭제하고 같은 URL 로 다시 추가하세요.')
  console.log('(URL 은 삭제 전에 복사해 두세요. 키가 들어 있어 다시 만들 수 없습니다.)')
  console.log('='.repeat(60))
} else if (added.length) {
  console.log('\n새 툴만 늘었습니다. 커넥터 목록 새로고침이면 잡힙니다.')
} else {
  console.log('\n툴 스키마 변화 없음. 커넥터는 그대로 두면 됩니다.')
}
