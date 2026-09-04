/**
 * 툴 스키마 잠금 파일을 갱신한다.
 *
 *   npx tsx scripts/tools-lock.mts          확인만
 *   npx tsx scripts/tools-lock.mts --write  갱신 (npm run tools:lock)
 *
 * 이 파일이 "커넥터가 마지막으로 맞춰본 스키마"다. 배포 경로나 기기가 달라져도 기준이 흔들리지 않는다.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { TOOLS } from '../api/mcp.ts'

const LOCK = new URL('../api/tools.lock.json', import.meta.url)
const current: Record<string, string[]> = Object.fromEntries(
  [...TOOLS].sort((a, b) => a.name.localeCompare(b.name)).map((t) => [
    t.name, Object.keys((t.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).sort(),
  ]),
)

let previous: Record<string, string[]> = {}
try { previous = JSON.parse(readFileSync(LOCK, 'utf8')).tools } catch { /* 첫 실행 */ }

const added = Object.keys(current).filter((n) => !(n in previous))
const removed = Object.keys(previous).filter((n) => !(n in current))
const changed = Object.keys(current).filter((n) => n in previous && previous[n].join(',') !== current[n].join(','))

if (!added.length && !removed.length && !changed.length) {
  console.log(`툴 ${Object.keys(current).length}개, 잠금 파일과 같습니다.`)
} else {
  if (added.length) console.log(`새 툴: ${added.join(', ')}`)
  if (removed.length) console.log(`사라진 툴: ${removed.join(', ')}`)
  changed.forEach((n) => console.log(`인자 변경: ${n} [${previous[n]}] -> [${current[n]}]`))
  if (changed.length || removed.length) {
    console.log('\n' + '='.repeat(58))
    console.log('기존 툴의 인자가 바뀌었습니다. 배포한 뒤 클로드 앱에서')
    console.log('설정 > 커넥터 > 가계부원격 을 삭제하고 같은 URL 로 다시 추가하세요.')
    console.log('(앱은 기존 툴의 인자 변경을 목록 새로고침으로 잡지 못합니다.')
    console.log(' URL 은 삭제 전에 복사하세요. 키가 들어 있어 다시 만들 수 없습니다.)')
    console.log('='.repeat(58))
  }
}

if (process.argv.includes('--write')) {
  writeFileSync(LOCK, JSON.stringify({ note: '툴 스키마 잠금. npm run tools:lock 로 갱신한다.', tools: current }, null, 2) + '\n')
  console.log('\n잠금 파일을 갱신했습니다.')
}
