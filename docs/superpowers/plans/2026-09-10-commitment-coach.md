# 약속 코치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운동이 아닌 약속을 트리거와 함께 기록하고, 지켰는지 서버가 재고, 일간·주간 코치에 붙인다.

**Architecture:** 새 저장소도 새 툴도 만들지 않는다. 기존 `manual` 탭에 종류 두 개(`약속`·`이행`)를 추가하고, `parseLog` 에 분기를 얹고, `_coach.ts` 의 제안 저장·이행 평가 기계를 그대로 재사용해 삶 제안 하나를 건강 제안 옆에 세운다.

**Tech Stack:** TypeScript (Vercel 서버리스), Vitest, Google Apps Script + 시트 백엔드

**Spec:** `docs/superpowers/specs/2026-09-10-commitment-coach-design.md`

## Global Constraints

- `api/` 의 `.ts` 는 전부 서버리스 함수로 잡힌다. 테스트·모듈은 `_` 접두어 필수.
- `Array.prototype.at` 금지 (Vercel 기본 lib 타깃이 낮다).
- 테스트는 네트워크를 타지 않는다. 고정 데이터만 쓴다.
- `health_log` 의 `inputSchema` 는 **바꾸지 않는다.** 새 문법은 `description` 에만 추가한다. properties 가 그대로여야 `tools.lock.json` 이 안 깨지고 커넥터 재추가가 불필요하다.
- 요일 표는 `_log.ts` 의 기존 `DAYS = ['일','월','화','수','목','금','토']` 를 재사용한다. 새 표를 만들지 않는다.
- 활성 약속 상한은 **5개**. 6개째는 저장하지 않고 현재 목록을 돌려준다.
- 트리거는 두 형태만: `MM-DD`(날짜형), `요일[시간대]`(요일형). 시간대는 아침·점심·저녁·밤.
- 커밋 메시지는 한국어로, 무엇을 바꿨는지보다 **왜 그렇게 정했는지**를 적는다.

---

### Task 1: 트리거 파서와 `약속`·`했다` 문법

**Files:**
- Modify: `api/_log.ts`
- Test: `api/_log.test.ts`

**Interfaces:**
- Consumes: 기존 `DAYS`, `LogEntry` 타입
- Produces:
  - `parseTrigger(t: string): { mmdd: string } | { wd: string; slot: string } | null`
  - `parseLog` 가 `kind: '약속'` (`extra = 트리거|할 것`), `kind: '이행'` (`extra = 키워드`) 를 낸다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`api/_log.test.ts` 의 `describe('parseLog', ...)` 블록 안에 추가:

```ts
  it('약속 — 날짜형·요일형만 받는다', () => {
    expect(parseLog('약속 09-13 카제나 QA 제출')).toMatchObject({ kind: '약속', extra: '09-13|카제나 QA 제출' })
    expect(parseLog('약속 화아침 지원서 3곳').extra).toBe('화아침|지원서 3곳')
    expect(parseLog('약속 화 지원서').extra).toBe('화|지원서')
    // 트리거가 없으면 거부한다 — 이게 이 시스템의 유일한 규율이다
    expect(() => parseLog('약속 이력서 정리')).toThrow()
    expect(() => parseLog('약속 언젠가 이력서 정리')).toThrow()
    expect(() => parseLog('약속 09-13')).toThrow()      // 할 것이 없다
    expect(() => parseLog('약속 13-99 치과')).toThrow() // 날짜가 아니다
  })
  it('했다 — 키워드만 남긴다', () => {
    expect(parseLog('했다 카제나')).toMatchObject({ kind: '이행', extra: '카제나' })
    expect(() => parseLog('했다')).toThrow()
  })
```

- [ ] **Step 2: 실패하는지 확인**

Run: `npx vitest run api/_log.test.ts -t '약속'`
Expected: FAIL — `약속 09-13 카제나 QA 제출` 이 `kind: '메모'` 로 떨어진다

- [ ] **Step 3: 최소 구현**

`api/_log.ts` 의 `DAYS` 선언 아래에 추가:

```ts
const SLOTS = ['아침', '점심', '저녁', '밤']
/**
 * 약속 트리거. 날짜형 'MM-DD' 또는 요일형 '화'/'화아침'. 그 외는 null.
 * "언젠가 할 일"을 받는 순간 핀보드가 되므로 여기서 막는다.
 */
export function parseTrigger(t: string): { mmdd: string } | { wd: string; slot: string } | null {
  const d = /^(\d{2})-(\d{2})$/.exec(t)
  if (d) return +d[1] >= 1 && +d[1] <= 12 && +d[2] >= 1 && +d[2] <= 31 ? { mmdd: t } : null
  const w = new RegExp(`^([${DAYS.join('')}])(${SLOTS.join('|')})?$`).exec(t)
  return w ? { wd: w[1], slot: w[2] || '' } : null
}
```

`parseLog` 안, `if (h === '계획')` 분기 **앞**에 추가:

```ts
  if (h === '약속') {
    const [trig, ...task] = rest
    if (!trig || !parseTrigger(trig) || !task.length)
      throw new Error('약속은 "약속 09-13 치과" 또는 "약속 화아침 지원서" 형식이에요. 언제 할지가 없으면 등록되지 않습니다')
    return { kind: '약속', extra: [trig, task.join(' ')].join('|'), echo: `${trig} · ${task.join(' ')}` }
  }
  if (h === '했다') {
    if (!rest.length) throw new Error('했다 뒤에 무엇을 했는지 (예: 했다 카제나)')
    return { kind: '이행', extra: rest.join(' '), echo: rest.join(' ') }
  }
```

- [ ] **Step 4: 통과하는지 확인**

Run: `npx vitest run api/_log.test.ts`
Expected: PASS (기존 테스트 포함 전부)

- [ ] **Step 5: 커밋**

```bash
git add api/_log.ts api/_log.test.ts
git commit -m "feat(log): 약속·했다 문법과 트리거 파서

트리거 없는 항목을 받으면 핀보드가 된다. 이행이 갈린 지점이 정확히
'언제 어디서가 정해져 있느냐'였으므로(수영 4/4 vs 턱걸이 0/4),
날짜형과 요일형 둘만 받고 나머지는 등록을 거부한다."
```

---

### Task 2: 활성 목록과 주간 이행 집계

**Files:**
- Modify: `api/_log.ts`
- Test: `api/_log.test.ts`

**Interfaces:**
- Consumes: Task 1 의 `parseTrigger`, 기존 `shift`, `day`, `HealthRow`
- Produces:
  - `type Commitment = { trigger: string; task: string; due: string | null; wd: string | null }`
  - `dueDate(mmdd: string, today: string): string`
  - `activeCommitments(rows: HealthRow[], today: string): Commitment[]`
  - `commitmentWeek(rows: HealthRow[], from: string, to: string): { items: (Commitment & { done: boolean })[]; planned: number; done: number }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`api/_log.test.ts` 맨 끝에 새 describe 추가:

```ts
describe('약속 집계', () => {
  const row = (start: string, value: string, extra = ''): HealthRow => ({ start, end: start, value, extra })
  const rows = [
    row('2026-09-01 10:00', '약속', '09-13|카제나 QA 제출'),
    row('2026-09-01 10:01', '약속', '화아침|지원서 3곳'),
    row('2026-09-01 10:02', '약속', '09-05|치과'),
  ]

  it('지난 날짜형은 활성에서 빠지고 요일형은 남는다', () => {
    const a = activeCommitments(rows, '2026-09-10')
    expect(a.map((c) => c.task)).toEqual(['카제나 QA 제출', '지원서 3곳'])   // 09-05 치과는 만료
  })

  it('했다 키워드가 부분 문자열로 약속을 닫는다', () => {
    const w = commitmentWeek([...rows, row('2026-09-08 09:00', '이행', '지원서')], '2026-09-07', '2026-09-13')
    expect(w.planned).toBe(2)                       // 요일형 1 + 그 주가 마감인 09-13 카제나 1
    expect(w.done).toBe(1)
    expect(w.items.find((i) => i.task === '지원서 3곳')?.done).toBe(true)
    expect(w.items.find((i) => i.task === '카제나 QA 제출')?.done).toBe(false)
  })

  it('그 주에 마감이 아닌 날짜형은 planned 에 안 든다', () => {
    const w = commitmentWeek(rows, '2026-09-14', '2026-09-20')
    expect(w.planned).toBe(1)                       // 요일형만
  })

  it('MM-DD 는 6개월 넘게 과거면 다음 해로 읽는다', () => {
    expect(dueDate('09-13', '2026-09-10')).toBe('2026-09-13')
    expect(dueDate('01-05', '2026-12-28')).toBe('2027-01-05')
    expect(dueDate('09-05', '2026-09-10')).toBe('2026-09-05')   // 며칠 전은 올해가 맞다
  })
})
```

파일 상단 import 에 타입을 추가한다:

```ts
import { parseLog, logStamp, summarizeManual, activeCommitments, commitmentWeek, dueDate } from './_log'
import type { HealthRow } from './_health'
```

- [ ] **Step 2: 실패하는지 확인**

Run: `npx vitest run api/_log.test.ts -t '약속 집계'`
Expected: FAIL — `activeCommitments is not a function`

- [ ] **Step 3: 최소 구현**

`api/_log.ts` 맨 아래, `planWeek` 아래에 추가:

```ts
// ── 약속 (운동이 아닌 것) ───────────────────────────────────
// 운동은 '계획'이 담당하고 워치·sRPE 로 자동 판정된다. 여기는 그 밖의 것이라 이행이 수동이다.
export type Commitment = { trigger: string; task: string; due: string | null; wd: string | null }

/** 'MM-DD' → 'yyyy-MM-dd'. 6개월 넘게 과거로 읽히면 다음 해다(연말연시 처리). */
export const dueDate = (mmdd: string, today: string) => {
  const y = +today.slice(0, 4)
  return `${y}-${mmdd}` < shift(today, -183) ? `${y + 1}-${mmdd}` : `${y}-${mmdd}`
}

const commitments = (rows: HealthRow[], today: string): Commitment[] =>
  rows.filter((r) => r.value === '약속').flatMap((r) => {
    const [trig = '', task = ''] = (r.extra || '').split('|')
    const p = parseTrigger(trig)
    if (!p || !task) return []
    return [{ trigger: trig, task, due: 'mmdd' in p ? dueDate(p.mmdd, today) : null, wd: 'wd' in p ? p.wd : null }]
  })

/** 아직 만료되지 않은 것. 날짜형은 지나면 사라지고, 요일형은 매주 다시 발생한다. */
export const activeCommitments = (rows: HealthRow[], today: string): Commitment[] =>
  commitments(rows, today).filter((c) => !c.due || c.due >= today)

/** from~to 한 주의 이행. 날짜형은 그 주가 마감일 때만, 요일형은 매주 센다. */
export function commitmentWeek(rows: HealthRow[], from: string, to: string) {
  const dones = rows.filter((r) => r.value === '이행' && day(r) >= from && day(r) <= to)
  const items = commitments(rows, from)
    .filter((c) => (c.due ? c.due >= from && c.due <= to : true))
    .map((c) => ({ ...c, done: dones.some((d) => c.task.includes(String(d.extra || ''))) }))
  return { items, planned: items.length, done: items.filter((i) => i.done).length }
}
```

- [ ] **Step 4: 통과하는지 확인**

Run: `npx vitest run api/_log.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add api/_log.ts api/_log.test.ts
git commit -m "feat(log): 약속 활성 목록과 주간 이행 집계

자동 이월을 막는 게 설계의 핵심이라 만료를 집계 쪽에 넣었다.
날짜가 지난 약속은 활성에서 빠지고 미이행으로 확정된다.
요일형이 매주 다시 잡히는 것은 이월이 아니라 반복 약속의 정의다."
```

---

### Task 3: 등록 시 5개 상한

**Files:**
- Modify: `api/mcp.ts` (`health_log` 핸들러, 206~211행 근처)
- Test: `api/_log.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `activeCommitments`
- Produces: `overCap(rows, today): Commitment[] | null` — 상한을 넘었으면 현재 목록, 아니면 null

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`describe('약속 집계', ...)` 안에 추가:

```ts
  it('활성 5개면 6개째를 막는다', () => {
    const five = ['가', '나', '다', '라', '마'].map((t, i) => row(`2026-09-01 10:0${i}`, '약속', `화|${t}`))
    expect(overCap(five, '2026-09-10')).toHaveLength(5)
    expect(overCap(five.slice(0, 4), '2026-09-10')).toBeNull()
  })
```

import 에 `overCap` 추가.

- [ ] **Step 2: 실패하는지 확인**

Run: `npx vitest run api/_log.test.ts -t '5개'`
Expected: FAIL — `overCap is not a function`

- [ ] **Step 3: 최소 구현**

`api/_log.ts` 의 `activeCommitments` 아래에 추가:

```ts
/** 활성 5개가 상한. 과부하가 시스템을 버리게 만드는 2위 원인이라 등록 자체를 막는다. */
export const CAP = 5
export const overCap = (rows: HealthRow[], today: string): Commitment[] | null => {
  const a = activeCommitments(rows, today)
  return a.length >= CAP ? a : null
}
```

`api/mcp.ts` 의 `health_log` 핸들러를 교체한다. `약속` 일 때만 기존 행을 읽어 상한을 검사한다 (GAS 호출이 10초라 다른 종류는 그대로 빠르게 둔다):

```ts
  if (name === 'health_log') {
    const { stamp, text } = logStamp(String(args.text || ''))
    const e = parseLog(text)
    if (e.kind === '약속') {
      const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=3400')).tabs ?? {}
      const full = overCap(t.manual ?? [], stamp.slice(0, 10))
      if (full) return `약속은 한 번에 5개까지예요. 하나를 지우고 다시 넣어주세요.\n` +
        full.map((c) => `- ${c.trigger} ${c.task}`).join('\n')
    }
    const r = await gasPost({ action: 'health', type: 'manual', rows: [stamp, stamp, e.kind, e.extra].join('|') }) as { added?: number; skipped?: number }
    return `${r.added ? '기록됨' : '이미 있음'}: ${stamp.slice(5, 16)} ${e.kind} — ${e.echo}`
  }
```

`api/mcp.ts` 상단 import 에 `overCap` 을 추가한다.

- [ ] **Step 4: 통과하는지 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add api/_log.ts api/_log.test.ts api/mcp.ts
git commit -m "feat(mcp): 약속 활성 5개 상한

과부하가 이런 시스템이 버려지는 2위 원인이고, 사용자 데이터도
9~11개는 너무 많다고 말한다(2주 6/19). 상한을 넘으면 저장 대신
현재 목록을 돌려주고 무엇을 뺄지 묻는다.
GAS 호출이 10초라 약속일 때만 기존 행을 읽는다."
```

---

### Task 4: 삶 제안 후보 다섯

**Files:**
- Modify: `api/_coach.ts`
- Test: `api/_coach.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `commitmentWeek`·`activeCommitments`, **Task 3 의 `CAP`**(`_log.ts` 에서 export), 기존 `Advice`·`mondayOf`·`shift`
- Produces: `lifeChange(tabs: Tabs, today: string, monday: string): Advice` — `key` 는 `deadline` | `backlog` | `overflow` | `stale` | `life_hold`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`api/_coach.test.ts` 맨 끝에 추가:

```ts
describe('lifeChange', () => {
  const r = (start: string, value: string, extra = ''): HealthRow => ({ start, end: start, value, extra })
  const tabs = (manual: HealthRow[]): Tabs => ({ manual } as unknown as Tabs)

  it('3일 안 마감이 최우선이다', () => {
    const a = lifeChange(tabs([r('2026-09-01 10:00', '약속', '09-13|카제나 QA 제출')]), '2026-09-11', '2026-09-07')
    expect(a.key).toBe('deadline')
    expect(a.text).toContain('카제나')
  })

  it('마감이 없고 이행률이 낮으면 backlog', () => {
    const manual = [
      r('2026-08-01 10:00', '약속', '화|지원서'),
      r('2026-08-01 10:01', '약속', '수|이력서'),
    ]
    expect(lifeChange(tabs(manual), '2026-09-11', '2026-09-07').key).toBe('backlog')
  })

  it('활성이 상한이면 overflow', () => {
    const manual = ['가', '나', '다', '라', '마'].map((t, i) => r(`2026-08-01 10:0${i}`, '약속', `화|${t}`))
    // 이행 행은 판정 창(2026-08-31~09-06) **안**에 둔다. 창 밖에 두면 done=0/5 라
    // backlog 가 먼저 발동해 overflow 에 영원히 도달하지 못한다.
    const done = manual.map((m, i) => r(`2026-09-01 09:0${i}`, '이행', (m.extra || '').split('|')[1]))
    expect(lifeChange(tabs([...manual, ...done]), '2026-09-11', '2026-09-07').key).toBe('overflow')
  })

  it('약속이 없으면 life_hold', () => {
    expect(lifeChange(tabs([]), '2026-09-11', '2026-09-07').key).toBe('life_hold')
  })
})
```

import 줄에 `lifeChange` 를 추가한다.

- [ ] **Step 2: 실패하는지 확인**

Run: `npx vitest run api/_coach.test.ts -t 'lifeChange'`
Expected: FAIL — `lifeChange is not a function`

- [ ] **Step 3: 최소 구현**

`api/_coach.ts` 상단 import 를 고친다:

```ts
import { planWeek, commitmentWeek, activeCommitments, CAP } from './_log.js'
```

`ChangeKey` 에 삶 후보를 더한다:

```ts
export type ChangeKey = 'hold' | 'adherence' | 'deload' | 'lower_intensity' | 'bedtime' | 'add_session' | 'promote'
  | 'deadline' | 'backlog' | 'overflow' | 'stale' | 'life_hold'
```

`nextChange` 아래에 추가:

```ts
/**
 * 삶 제안 하나. 건강과 같은 방식으로 우선순위대로 검사해 처음 걸리는 것만 고른다.
 * 건강 제안과 나란히 서므로 주간 제안은 최대 둘이다. 여섯이 문제였지 둘은 지켜진다.
 */
export function lifeChange(tabs: Tabs, today: string, monday: string): Advice {
  const manual = tabs.manual ?? []
  const active = activeCommitments(manual, today)
  const last = commitmentWeek(manual, shift(monday, -7), shift(monday, -1))

  const soon = active.filter((c) => c.due && c.due >= today && c.due <= shift(today, 3))
    .sort((a, b) => (a.due! < b.due! ? -1 : 1))
  if (soon.length) return { key: 'deadline', text: `${soon[0].task} 부터 (${soon[0].due} 마감)`, metric: 'none', target: 0,
    why: `3일 안에 마감이에요. 다른 걸 새로 넣기 전에 이것부터.` }

  if (last.planned >= 2 && last.done / last.planned < 0.5)
    return { key: 'backlog', text: '새 약속 그만 넣고 밀린 것부터', metric: 'none', target: 0,
      why: `지난주 약속 ${last.planned}개 중 ${last.done}개만 했어요. 늘리는 것보다 지키던 것부터.` }

  if (active.length >= CAP)
    return { key: 'overflow', text: `약속이 ${active.length}개예요. 하나 지우고 시작하기`, metric: 'none', target: 0,
      why: '한 번에 5개가 상한이에요. 안 할 것을 지우는 것도 결정이에요.' }

  // 요일형이 2주 연속 미이행이면 그 약속 자체가 틀린 것이다 (날짜형은 지나면 만료돼 여기 안 걸린다)
  const before = commitmentWeek(manual, shift(monday, -14), shift(monday, -8))
  const stale = active.find((c) => !c.due
    && last.items.some((i) => i.task === c.task && !i.done)
    && before.items.some((i) => i.task === c.task && !i.done))
  if (stale) return { key: 'stale', text: `"${stale.task}" 를 버리거나 더 작게 쪼개기`, metric: 'none', target: 0,
    why: '2주 연속 못 했어요. 의지 문제가 아니라 덩어리가 큰 것일 수 있어요.' }

  return { key: 'life_hold', text: active.length ? '지금 약속 그대로 유지하기' : '아직 등록된 약속이 없어요', metric: 'none', target: 0,
    why: active.length ? '약속이 평소 범위 안이에요.' : '"약속 09-13 치과" 처럼 언제 할지를 붙여서 넣어보세요.' }
}
```

- [ ] **Step 4: 통과하는지 확인**

Run: `npx vitest run api/_coach.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add api/_coach.ts api/_coach.test.ts
git commit -m "feat(coach): 삶 제안 후보 다섯

건강의 nextChange 와 같은 방식이다 — 우선순위대로 검사해 하나만 고른다.
목표를 늘리면 goal dilution 이 생긴다는 연구와, 여섯 개를 주면
아무것도 안 지켜진다는 기존 판단을 그대로 따랐다.
stale 은 요일형에만 건다. 날짜형은 지나면 만료돼 걸릴 수가 없다."
```

---

### Task 5: 주간 리뷰에 삶 섹션 붙이기

**Files:**
- Modify: `api/_coach.ts` (`weekReview`, `formatWeek`)
- Test: `api/_coach.test.ts`

**Interfaces:**
- Consumes: Task 4 의 `lifeChange`, Task 2 의 `commitmentWeek`
- Produces: `weekReview` 반환값에 `life: Advice` 와 `commitments: ReturnType<typeof commitmentWeek>` 추가

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`api/_coach.test.ts` 의 `describe('lifeChange', ...)` 안에 추가:

```ts
  it('주간 리뷰가 건강 제안과 삶 제안을 따로 낸다', () => {
    const t = base()
    t.manual.push(r('2026-08-20 10:00', '약속', '09-13|카제나 QA 제출'))
    const w = weekReview(t, '2026-09-11')
    expect(w.life.key).toBe('deadline')
    expect(w.advice.key).not.toBe('deadline')          // 건강 제안은 건강 후보에서만 나온다
    // 이 테스트의 마감(09-13)은 리뷰 주(08-31~09-06) 밖이라 commitments.planned=0 이고
    // 약속 줄은 가드에 막힌다. 항상 출력되는 삶 제안 줄로 단언한다.
    expect(formatWeek(w)).toContain('삶 쪽')
  })
```

- [ ] **Step 2: 실패하는지 확인**

Run: `npx vitest run api/_coach.test.ts -t '따로 낸다'`
Expected: FAIL — `w.life` 가 undefined

- [ ] **Step 3: 최소 구현**

`weekReview` 의 `return` 문을 고친다 (`advice` 계산 뒤에 두 줄 추가):

```ts
  const life = lifeChange(tabs, today, lastMonday)
  const commitments = commitmentWeek(tabs.manual ?? [], last.monday, last.to)
```

그리고 반환 객체에 `life, commitments` 를 더한다:

```ts
  return { week: `${last.monday} ~ ${last.to}`, facts: last, before, advice, review, drift, load,
    promotions: promotions(tabs, today), life, commitments }
```

`formatWeek` 에서 마지막 `lines.push` 앞에 약속 줄을 넣는다:

```ts
  if (r.commitments.planned) lines.push(`약속 ${r.commitments.done}/${r.commitments.planned}` +
    (r.commitments.items.filter((i) => !i.done).length
      ? ` (남음: ${r.commitments.items.filter((i) => !i.done).map((i) => i.task).join(', ')})` : ''))
```

그리고 마지막 줄을 제안 둘로 바꾼다:

```ts
  lines.push(`\n[다음 주 변경 하나] ${r.advice.text}\n  ${r.advice.why}`)
  lines.push(`[삶 쪽 하나] ${r.life.text}\n  ${r.life.why}`)
```

- [ ] **Step 4: 통과하는지 확인**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add api/_coach.ts api/_coach.test.ts
git commit -m "feat(coach): 주간 리뷰에 약속 이행과 삶 제안

건강 제안과 삶 제안을 나란히 둔다. 도메인 안에서는 하나만 고르고,
도메인 사이에서만 나눈다. 저장 형식은 기존 코치 행 그대로라
새 스키마를 만들지 않았다."
```

---

### Task 6: 오늘 걸린 약속을 일간 표면에

**Files:**
- Modify: `api/_log.ts`, `api/_readiness.ts`, `api/mcp.ts`, `api/today.ts`
- Test: `api/_log.test.ts`

**Interfaces:**
- Consumes: Task 2 의 `activeCommitments`, 기존 `DAYS`
- Produces:
  - `todayCommitments(rows: HealthRow[], today: string): string[]`
  - `formatReadiness(r, today, todos?: string[])`, `formatFriendly(r, todos?: string[])`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`describe('약속 집계', ...)` 안에 추가:

```ts
  it('오늘 트리거가 걸린 것만 나온다', () => {
    const rs = [
      row('2026-09-01 10:00', '약속', '09-11|카제나 QA 제출'),
      row('2026-09-01 10:01', '약속', '금아침|지원서 3곳'),
      row('2026-09-01 10:02', '약속', '수|이력서'),
    ]
    expect(todayCommitments(rs, '2026-09-11')).toEqual(['카제나 QA 제출', '지원서 3곳 (아침)'])  // 2026-09-11 은 금요일
    expect(todayCommitments(rs, '2026-09-12')).toEqual([])
  })
```

import 에 `todayCommitments` 추가.

- [ ] **Step 2: 실패하는지 확인**

Run: `npx vitest run api/_log.test.ts -t '오늘 트리거'`
Expected: FAIL — `todayCommitments is not a function`

- [ ] **Step 3: 최소 구현**

`api/_log.ts` 의 `overCap` 아래에 추가:

```ts
/** 오늘 트리거가 걸린 약속. 없으면 빈 배열이고, 일간 표면은 그때 아무 말도 하지 않는다. */
export function todayCommitments(rows: HealthRow[], today: string): string[] {
  const wd = DAYS[new Date(today + 'T00:00:00Z').getUTCDay()]
  return activeCommitments(rows, today).flatMap((c) => {
    if (c.due) return c.due === today ? [c.task] : []
    if (c.wd !== wd) return []
    const slot = parseTrigger(c.trigger)
    return [c.task + (slot && 'slot' in slot && slot.slot ? ` (${slot.slot})` : '')]
  })
}
```

`api/_readiness.ts` 의 두 함수에 선택 인자를 더한다 (기본값이 있어 기존 호출부는 안 깨진다):

```ts
export function formatReadiness(r: ReturnType<typeof readiness>, today: string, todos: string[] = []): string {
  const tail = todos.length ? `\n\n[오늘 약속]\n` + todos.map((t) => '- ' + t).join('\n') : ''
  if (isNaN(r.score)) return `준비도 - ${r.band}\n${r.reasons.join('\n')}` + tail
  return `준비도 ${r.score} · ${r.band} (${today})\n` + r.reasons.map((x) => '- ' + x).join('\n') +
    `\n\n[구성] ` + r.comps.map((c) => `${c.label} ${Math.round(c.sub)}`).join(' · ') + tail
}
```

```ts
export function formatFriendly(r: ReturnType<typeof readiness>, todos: string[] = []): string {
  const tail = todos.map((t) => '□ ' + t)
  if (isNaN(r.score)) return [`준비도 계산 중. ${r.reasons[0]}`, ...tail].join('\n')
  const v = structuredReadiness(r)
  return [`준비도 ${r.score}. ${v.headline}`, ...r.caps.map((c) => '⚠ ' + c), ...v.lines.map((l) => l.text), ...tail].join('\n')
}
```

`api/mcp.ts` 의 `health_today` 핸들러 (203행) 를 고친다:

```ts
    return formatReadiness(readiness(r.tabs ?? {}, todayKey), todayKey, todayCommitments(r.tabs?.manual ?? [], todayKey))
```

`api/today.ts` 14~17행을 고친다. tabs 는 이미 `t` 에 있다:

```ts
    const t = (await gasGet<{ tabs?: Tabs }>('healthAll', '&days=400')).tabs ?? {}
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
    const r = readiness(t, today)
    const todos = todayCommitments(t.manual ?? [], today)
    const text = isNaN(r.score) ? formatReadiness(r, today, todos) : formatFriendly(r, todos)   // 알림용 쉬운 말
```

**`days=75` → `days=400` 이 이 태스크의 숨은 핵심이다.** 원래 75일이었는데,
75일보다 오래 살아남은 요일형 약속이 아침 알림에서는 조용히 사라지고
주간 리뷰(`days=3400`)에서는 계속 잡히는 불일치가 생긴다. 같은 약속을 두 표면이
다르게 보면 어느 쪽이 틀렸는지 찾는 데 제일 오래 걸린다.
창 크기를 늘리는 비용은 낮다 — GAS 는 시작 오버헤드가 병목이라 75일치와 9년치를
받는 시간이 같다(README 에 적혀 있다). 400일이면 1년 넘은 약속까지 덮는다.

두 파일의 import 에 `todayCommitments` 를 추가한다.

- [ ] **Step 4: 통과하는지 확인**

Run: `npm test`
Expected: PASS

타입도 확인한다:

Run: `npx tsc --noEmit --strict --skipLibCheck --module nodenext --moduleResolution nodenext --target es2021 api/*.ts`
Expected: 에러 없음

- [ ] **Step 5: 커밋**

```bash
git add api/_log.ts api/_readiness.ts api/mcp.ts api/today.ts api/_log.test.ts
git commit -m "feat(readiness): 오늘 걸린 약속을 아침 표면에

일간은 심판이라 오늘 걸린 것만 보여주고, 없으면 아무 말도 하지 않는다.
formatReadiness 의 세 번째 인자를 선택으로 둬서 기존 호출부와
health-app-contract 의 응답 형태를 건드리지 않았다."
```

---

### Task 7: MCP 툴 설명 갱신과 배포

**Files:**
- Modify: `api/mcp.ts` (`health_log` 의 `description`, `initialize` 의 `instructions`)
- Test: `api/_mcp-tools.test.ts` (기존 테스트가 자동으로 검사한다)

**Interfaces:**
- Consumes: Task 1~6 전부
- Produces: 없음 (문서·배포)

- [ ] **Step 1: 설명에 새 문법을 넣는다**

`health_log` 의 `description` 에서 `"계획 월 수영 턱걸이"...` 문장 뒤에 추가:

```
"약속 09-13 카제나 QA 제출" / "약속 화아침 지원서 3곳"(운동이 아닌 할 일. 날짜형 MM-DD 또는 요일형[아침·점심·저녁·밤]만 받고, 언제 할지가 없으면 등록되지 않는다. 한 번에 5개까지), "했다 카제나"(약속 이행, 부분 문자열로 매칭),
```

`initialize` 의 `instructions` 에 한 문장 추가:

```
'운동이 아닌 할 일은 "약속 09-13 카제나 제출"처럼 언제 할지를 붙여 health_log 로 저장하고, 끝내면 "했다 카제나"로 닫는다. 트리거 없는 할 일은 등록되지 않는다. '
```

- [ ] **Step 2: 스키마 테스트가 통과하는지 확인**

Run: `npm test`
Expected: PASS — `inputSchema` 는 안 바꿨으므로 `tools.lock.json` 이 어긋나지 않는다. 어긋난다고 나오면 실수로 properties 를 건드린 것이니 되돌린다.

- [ ] **Step 3: 커밋**

```bash
git add api/mcp.ts
git commit -m "docs(mcp): health_log 설명에 약속·했다 문법

inputSchema 는 건드리지 않았다. 새 문법은 설명 문자열에만 붙으므로
tools.lock.json 의 properties 가 그대로고 커넥터 재추가가 필요 없다."
```

- [ ] **Step 4: 배포**

Run: `npm run deploy:prod`
Expected: "툴 스키마 변화 없음. 커넥터는 그대로 두면 됩니다."

- [ ] **Step 5: 실제로 한 번 써본다**

클로드 앱에서:

```
약속 09-13 카제나 QA 제출
약속 화아침 지원서 3곳
약속 이력서 정리          ← 거부되어야 한다
했다 카제나
```

그다음 `health_today` 와 `coach_week` 를 불러 약속이 붙는지 확인한다.

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 담당 |
|---|---|
| 트리거 강제 (원칙 1) | Task 1 |
| 새 입력 통로 없음 (원칙 2) | Task 1, 7 — `health_log` 재사용 |
| 활성 5개 상한 (원칙 3) | Task 3 |
| 자동 이월 금지 (원칙 4) | Task 2 — `activeCommitments` 의 만료 |
| 제안 도메인당 하나 (원칙 5) | Task 4, 5 |
| 계획/약속 경계 | Task 1 — 트리거에 종목후 없음 |
| 데이터 모델 (`약속`·`이행`) | Task 1 |
| 문법 2형태 + `했다` 부분 매칭 | Task 1, 2 |
| 이행 판정과 만료 | Task 2 |
| 일간 표면 | Task 6 |
| 주간 표면 | Task 5 |
| 월간 | 범위 밖 (스펙대로 건드리지 않음) |
| 삶 제안 후보 5종 | Task 4 |
| 함정 (inputSchema 불변) | Task 7 |

빠진 항목 없음.

**타입 일관성**

- `Commitment` 는 Task 2 에서 정의하고 Task 4·6 이 쓴다. 필드 `trigger`·`task`·`due`·`wd` 로 일관.
- `commitmentWeek` 는 `{ items, planned, done }` 를 내고 Task 4·5 가 그 이름으로 읽는다.
- `CAP` 은 Task 3 에서 export 하고 Task 4 가 import 한다.
- `lifeChange(tabs, today, monday)` 인자 순서가 Task 4 정의와 Task 5 호출에서 같다.
- `ChangeKey` 에 삶 후보 5개를 더했으므로 `adviceFromRow` 의 캐스팅이 그대로 통한다.

**검토 중 발견해 계획에 반영한 것**

- `api/today.ts` 가 `days=75` 만 받아온다. 그대로 두면 75일보다 오래된 요일형 약속이
  아침 알림에서만 사라지고 주간 리뷰에는 남는 불일치가 생긴다. Task 6 에서 `days=400` 으로
  올리는 단계를 넣었다. GAS 는 창 크기와 무관하게 시작 오버헤드가 병목이라 비용이 거의 없다.
- `api/today.ts` 의 tabs 변수명은 `t` 다. Task 6 에 실제 코드로 못 박았다.

**남은 주의**

- Task 3 은 `약속` 등록에 GAS 조회를 한 번 더 태워 10초쯤 걸린다. 의도한 대가다
  (자주 하는 동작이 아니고, 상한을 지키려면 기존 행을 봐야 한다).
- Task 5 의 `formatWeek` 수정은 기존 마지막 `lines.push` 를 두 줄로 쪼개는 것이므로,
  붙여넣기 전에 그 줄이 현재 어떤 모양인지 확인한다.
