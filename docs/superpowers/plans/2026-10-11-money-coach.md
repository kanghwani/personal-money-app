# 가계부 코치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가계부 웹앱이 카드 실적·혜택·분담금·카테고리 지출·기록 빠짐을 먼저 조언한다. 앱 홈 맨 위 코치 카드와, 정해진 날 하루 1개 맥 미리알림으로.

**Architecture:** 판단은 새 순수 모듈 `src/coach.ts` 하나(`coachAdvice`·`alertFor`)가 하고, 기존 `dashboardLogic.ts` 함수를 부르기만 한다. 앱 홈(`CoachCard`)과 서버(`api/coach.ts`)가 같은 모듈을 쓴다. 맥 launchd 작업(eventsync)이 07:27·09:00 에 `/api/coach` 를 불러 미리알림 "가계부" 목록에 하루 1개 만든다.

**Tech Stack:** React 19 + Vite 8 + TypeScript 6, Vitest 4, Vercel 서버리스(@vercel/node, Node ESM), Google Apps Script(원장), Python 3 + JXA(맥 미리알림), launchd.

**Spec:** `docs/superpowers/specs/2026-10-11-money-coach-design.md`

## Global Constraints

- 모든 날짜는 KST `YYYY-MM-DD` 문자열. 서버는 UTC 로 돈다(`now + 9h`).
- 미리알림은 정해진 날에만, 하루 최대 1개. 같은 날 여러 개면 한 알림으로 묶는다. 제목 접두어 `[가계부] MM/DD `(0 채움).
- 가족 합산 카드(`familyPooled`, 국민카드)는 매달 첫 구간(30만, 월 1만) 충족으로 간주. 실적 부족·다음 구간 조언 없음.
- 카테고리 기준선 = 끝난 최근 3개월(기록 있는 달만) 변동 실지출 중앙값, 5만 미만 카테고리 제외, 저장하지 않음.
- 변동지출 = `type === 'expense' && fixedType !== 'fixed' && !isNonSpend(t)`, 미분류 제외. 실지출 = `amount - split`.
- 판정: 7일 전 `ok`. `over` 쓴 돈 ≥ 기준선. `heavy` 쓴 돈 ≥ 날짜 기준×1.2 그리고 차이 ≥ 30,000. `room` 15일 이후 쓴 돈 ≤ 날짜 기준×0.7. 날짜 기준 = 기준선×오늘/말일.
- 서버에서 원장·고정비 중 하나라도 실패하면 조언 없이 500. 앱은 오류면 "원장을 못 읽어 조언을 못 냄".
- 새 패키지 추가 금지. `Array.prototype.at` 금지(Vercel lib 타깃).
- `api/` 아래 `.ts` 는 전부 서버리스 함수로 잡힌다 — 모듈·테스트는 `_` 접두어.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **월 1일** — 어제가 지난달이다. `spentYesterday` 는 0, 날짜 판정은 `ok`, 1일 알림(분담금)만 걸려야 한다. → Task 4 "11/01 분담금" 테스트.
2. **제목 접두어 충돌** — `11/1` 과 `11/15` 처럼 0 없이 쓰면 맥의 "같은 날짜로 시작" 검사가 다른 날을 같은 날로 본다. → Task 4 "0 채운 MM/DD" 테스트, Task 7 JXA 는 접두어 뒤 공백까지 비교.
3. **기록이 짧은 카테고리** — 기준 달이 1~2개뿐이거나 이번 달에만 처음 생긴 카테고리. 터지지 않고 있는 달만으로(또는 조언 없이) 처리. → Task 2 기준선 테스트 "기록 2개월" "이번 달만".
4. **6일 이전에 한 달치를 넘김** — 판정은 `ok` 지만 "처음 넘은 날" 알림은 가야 한다. → Task 4 "10/06 넘음" 테스트.
5. **서버 `date` 인자 오입력** — `date=2026-1-5`·`date=abc` 는 무시하고 KST 오늘. → Task 4 `coachDate` 테스트.

---

## File Structure

| 파일 | 책임 |
|---|---|
| `src/dashboardLogic.ts` (수정) | `.js` 확장자 import, 분담금 판정 `isOpenSplit`·`splitPerson` 꺼내기, `missedBenefits` 가족 합산 카드 처리 |
| `src/coach.ts` (새) | 코치 판단: 기준선·판정·조언 목록·오늘의 알림·날짜 |
| `src/coach.test.ts` (새) | 위 순수 함수 테스트 |
| `api/coach.ts` (새) | `GET /api/coach` — 원장·고정비 읽고 `{ date, alert, advice }` |
| `vercel.json` (수정) | `api/coach.ts` maxDuration 60 |
| `src/App.tsx`·`src/App.css`·`src/i18n.ts` (수정) | 홈 `CoachCard`, 카테고리 줄 "평소 N만", 혜택 보드의 놓친 혜택 줄 제거 |
| `scripts/coachalert.js` (새) | JXA: "가계부" 목록에 날짜 접두어 기준 하루 1개 미리알림 |
| `scripts/eventsync.py`·`scripts/com.hwan.eventsync.plist` (수정) | 코치 단계 추가, 07:27·09:00 실행 |
| `README.md` (수정) | 코치 구성 한 단락 |

---

### Task 1: 공유 준비 — `dashboardLogic.ts`

**Files:**
- Modify: `src/dashboardLogic.ts:1` (import), `src/dashboardLogic.ts:251-290` (`splitBreakdown`), `src/dashboardLogic.ts:612-640` (`missedBenefits` 의 `capOf`)
- Test: `src/dashboardLogic.test.ts`

**Interfaces:**
- Produces:
  - `export const isOpenSplit: (t: SplitTxLike) => boolean` — 분담금이 있고 환급 아님, `SETTLE_SINCE` 이후, 메모에 `받음` 없음
  - `export const splitPerson: (memo: string, people?: Record<string, string[]>) => string` — `'여친' | '형' | '엄마' | '기타'`
  - `missedBenefits` 는 `familyPooled` 카드를 첫 구간 충족으로 계산

- [ ] **Step 1: 실패하는 테스트 추가** — `src/dashboardLogic.test.ts` 맨 아래에 붙이고, 맨 위 import 목록에 `isOpenSplit, splitPerson` 을 추가한다.

```ts
describe('분담금 판정 공유 (코치용)', () => {
  const s = (date: string, memo: string, split = 10000) => ({ date, type: 'expense', amount: 20000, split, memo })
  it('안 받은 분담금만 open', () => {
    expect(isOpenSplit(s('2026-10-02', '여친 저녁'))).toBe(true)
    expect(isOpenSplit(s('2026-10-02', '여친 저녁 · 받음 10-05'))).toBe(false)
    expect(isOpenSplit(s('2026-10-02', '피클 환급'))).toBe(false)
    expect(isOpenSplit(s('2026-08-20', '여친 저녁'))).toBe(false)   // SETTLE_SINCE(2026-09-01) 이전
    expect(isOpenSplit(s('2026-10-02', '여친 저녁', 0))).toBe(false)
  })
  it('메모로 상대를 찾는다', () => {
    expect(splitPerson('브리 코스트코')).toBe('여친')
    expect(splitPerson('형 가게 물품')).toBe('형')
    expect(splitPerson('모임 회비')).toBe('기타')
  })
})

describe('missedBenefits — 가족 합산 카드', () => {
  it('국민카드는 원장 실적이 0이어도 첫 구간 충족으로 보고 놓친 혜택을 낸다', () => {
    const hits = missedBenefits([
      { date: '2026-10-12', type: 'expense', amount: 50000, split: 0, memo: '쿠팡', payment: '현금' },
    ], '2026-10')
    expect(hits.some((h) => h.bestCard === '국민카드' && h.area === '온라인쇼핑' && h.discount === 5000)).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/dashboardLogic.test.ts`
Expected: FAIL — `isOpenSplit is not a function` 등, 그리고 국민카드 테스트 `expected false to be true`.

- [ ] **Step 3: 구현**

1행 import 를 서버(Node ESM)도 읽을 수 있게 확장자를 붙인다:

```ts
import { PEOPLE, REFUND_WORDS, SETTLE_SINCE, SETTLED } from '../api/_ledger.js'
```

`const SPLIT_PEOPLE = PEOPLE` 바로 아래에 추가하고, `splitBreakdown` 안의 같은 판정을 이 함수로 바꾼다:

```ts
/** 메모로 분담 상대를 찾는다. 못 찾으면 '기타'. */
export const splitPerson = (memo: string, people: Record<string, string[]> = SPLIT_PEOPLE) =>
  Object.keys(people).find((name) => people[name].some((w) => (memo || '').includes(w))) || '기타'

/** 아직 안 받은 정산분인지. 환급(피클 등)과 '받음' 표시, SETTLE_SINCE 이전 기록은 받은 것으로 본다. */
export const isOpenSplit = (t: SplitTxLike) => {
  const memo = t.memo || ''
  return t.type === 'expense' && Boolean(t.split)
    && !REFUND_WORDS.some((w) => memo.includes(w))
    && !(t.date < SETTLE_SINCE || memo.includes(SETTLED))
}
```

`splitBreakdown` 본문에서 `whoOfMemo` 정의를 지우고 `whoOfMemo(memo)` 를 `splitPerson(memo, people)` 로 바꾼다. `if (!isRef && !settled) {` 블록 조건을 `if (isOpenSplit(t)) {` 로 바꾼다(`isRef`·`settled` 는 아래 월별 합산에서 계속 쓰므로 남긴다).

`missedBenefits` 의 `capOf` 안 `const qualified = perf.get(spec.card) ?? 0` 를 다음으로 바꾼다:

```ts
    // 가족 합산 카드는 가족 지출이 원장에 없다 — 매달 첫 구간 충족으로 본다(benefitBalances 와 같은 가정, 2026-10-11 사용자 확인).
    const qualified = spec.familyPooled ? Math.min(...spec.tiers.map((t) => t.min)) : (perf.get(spec.card) ?? 0)
```

- [ ] **Step 4: 통과 확인 + 기존 회귀 + 빌드**

Run: `npx vitest run src/dashboardLogic.test.ts && npm run build`
Expected: 전부 PASS, `✓ built in` — `vite build` 가 `../api/_ledger.js` 를 `.ts` 로 풀어야 한다. 실패하면 멈추고 보고(서버 공유 전제가 깨진 것).

- [ ] **Step 5: 커밋**

```bash
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "refactor(logic): 코치용으로 분담금 판정을 꺼내고, 가족 합산 카드의 놓친 혜택을 첫 구간 기준으로 계산

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 카테고리 기준선과 판정 — `src/coach.ts` 뼈대

**Files:**
- Create: `src/coach.ts`
- Create: `src/coach.test.ts`

**Interfaces:**
- Consumes: `isNonSpend`, `type SplitTxLike` (dashboardLogic)
- Produces:
  - `export type CoachTx = SplitTxLike & { payment?: string; category?: string; subCategory?: string; fixedType?: string }`
  - `export type Verdict = 'over' | 'heavy' | 'room' | 'ok'`
  - `export type CategoryState = { category: string; spent: number; spentYesterday: number; baseline: number; lastMonth: number; verdict: Verdict }`
  - `export const fmt: (n: number) => string` — `90000→'9만'`, `15000→'1.5만'`, `4200→'4,200원'`
  - `export const daysInMonth: (yearMonth: string) => number`
  - `export const addMonths: (yearMonth: string, n: number) => string`
  - `export function categoryBaselines(transactions: CoachTx[], yearMonth: string): Map<string, { baseline: number; lastMonth: number }>`
  - `export function categoryVerdict(spent: number, baseline: number, day: number, days: number): Verdict` — **사용자 작성**
  - `export function categoryStates(transactions: CoachTx[], today: string): CategoryState[]`

- [ ] **Step 1: 테스트 작성** — `src/coach.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { fmt, daysInMonth, addMonths, categoryBaselines, categoryVerdict, categoryStates, type CoachTx } from './coach'

const tx = (date: string, amount: number, o: Partial<CoachTx> = {}): CoachTx =>
  ({ date, type: 'expense', amount, split: 0, memo: '', payment: '현금', category: '외식비', subCategory: '', fixedType: 'variable', ...o })

describe('날짜·금액 헬퍼', () => {
  it('fmt', () => {
    expect(fmt(90000)).toBe('9만'); expect(fmt(15000)).toBe('1.5만'); expect(fmt(340000)).toBe('34만')
    expect(fmt(4200)).toBe('4,200원'); expect(fmt(6129.4)).toBe('6,129원')
  })
  it('daysInMonth / addMonths', () => {
    expect(daysInMonth('2026-10')).toBe(31); expect(daysInMonth('2026-11')).toBe(30)
    expect(daysInMonth('2027-02')).toBe(28); expect(daysInMonth('2028-02')).toBe(29)
    expect(addMonths('2026-01', -1)).toBe('2025-12'); expect(addMonths('2026-12', 1)).toBe('2027-01')
  })
})

describe('categoryBaselines', () => {
  const hist = [
    tx('2026-07-10', 300000), tx('2026-08-10', 340000), tx('2026-09-10', 390000),
    tx('2026-10-05', 999999),                                            // 이번 달은 기준에서 빠진다
    tx('2026-09-11', 100000, { split: 40000, category: '식비' }),         // 실지출 60000
    tx('2026-08-11', 70000, { category: '식비' }), tx('2026-07-11', 50000, { category: '식비' }),
    tx('2026-09-12', 500000, { category: '생활', fixedType: 'fixed' }),   // 고정비 제외
    tx('2026-09-13', 500000, { category: '저축/투자' }),                  // 비지출 제외
    tx('2026-09-14', 30000, { category: '문화/구독' }),                   // 5만 미만 제외
  ]
  it('끝난 3개월 중앙값, 분담금·고정비·저축 제외, 5만 미만 제외', () => {
    const b = categoryBaselines(hist, '2026-10')
    expect(b.get('외식비')).toEqual({ baseline: 340000, lastMonth: 390000 })
    expect(b.get('식비')).toEqual({ baseline: 60000, lastMonth: 60000 })
    expect(b.has('생활')).toBe(false); expect(b.has('저축/투자')).toBe(false); expect(b.has('문화/구독')).toBe(false)
  })
  it('기록 2개월이면 그 둘의 중앙값(평균)', () => {
    const b = categoryBaselines([tx('2026-08-10', 200000), tx('2026-09-10', 300000)], '2026-10')
    expect(b.get('외식비')?.baseline).toBe(250000)
  })
  it('기록 있는 달에 그 카테고리가 없으면 0으로 센다', () => {
    const b = categoryBaselines([tx('2026-07-10', 300000), tx('2026-08-10', 300000), tx('2026-09-10', 9000, { category: '식비' })], '2026-10')
    expect(b.get('외식비')?.baseline).toBe(300000)   // [300000, 300000, 0] 의 중앙값
  })
  it('이번 달에만 있는 카테고리는 기준선이 없다', () => {
    expect(categoryBaselines([tx('2026-10-01', 500000, { category: '여행' })], '2026-10').size).toBe(0)
  })
})

describe('categoryVerdict (기준선 340,000, 31일 달)', () => {
  it('7일 전에는 판정하지 않는다', () => {
    expect(categoryVerdict(500000, 340000, 6, 31)).toBe('ok')
  })
  it('기준선 이상이면 over', () => {
    expect(categoryVerdict(340000, 340000, 20, 31)).toBe('over')
  })
  it('날짜 기준의 1.2배 이상이고 차이 3만 이상이면 heavy', () => {
    // 10일 날짜 기준 = 340000*10/31 ≈ 109,677 → 1.2배 ≈ 131,613
    expect(categoryVerdict(140000, 340000, 10, 31)).toBe('heavy')
    expect(categoryVerdict(131000, 340000, 10, 31)).toBe('ok')
  })
  it('1.2배를 넘어도 차이가 3만 미만이면 ok', () => {
    // 기준선 60,000, 10/30일 → 날짜 기준 20,000, 26,000 은 1.3배지만 차이 6,000
    expect(categoryVerdict(26000, 60000, 10, 30)).toBe('ok')
  })
  it('15일부터, 날짜 기준의 0.7배 이하면 room', () => {
    // 15/30일 → 날짜 기준 170,000 → 0.7배 = 119,000
    expect(categoryVerdict(119000, 340000, 15, 30)).toBe('room')
    expect(categoryVerdict(119001, 340000, 15, 30)).toBe('ok')
    expect(categoryVerdict(60000, 340000, 14, 30)).toBe('ok')
  })
})

describe('categoryStates', () => {
  const hist = [tx('2026-07-10', 340000), tx('2026-08-10', 340000), tx('2026-09-10', 340000)]
  it('오늘·어제 누적과 판정을 낸다', () => {
    const [s] = categoryStates([...hist, tx('2026-10-05', 330000), tx('2026-10-06', 20000)], '2026-10-06')
    expect(s).toMatchObject({ category: '외식비', spent: 350000, spentYesterday: 330000, baseline: 340000, verdict: 'ok' })
  })
  it('1일에는 어제 누적이 0', () => {
    const [s] = categoryStates([...hist, tx('2026-10-01', 50000)], '2026-10-01')
    expect(s.spentYesterday).toBe(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/coach.test.ts`
Expected: FAIL — `Failed to resolve import "./coach"`.

- [ ] **Step 3: 뼈대 구현** — `src/coach.ts`

```ts
/**
 * 가계부 코치: 무엇을 언제 말할지 정하는 순수 함수.
 * 앱 홈 코치 카드와 서버 /api/coach(맥 미리알림)가 같이 쓴다 — 둘이 다른 말을 하지 않게.
 * 계산은 dashboardLogic 의 기존 함수를 부르기만 한다. 설계: docs/superpowers/specs/2026-10-11-money-coach-design.md
 */
import { isNonSpend, type SplitTxLike } from './dashboardLogic.js'

export type CoachTx = SplitTxLike & { payment?: string; category?: string; subCategory?: string; fixedType?: string }
export type Verdict = 'over' | 'heavy' | 'room' | 'ok'
export type CategoryState = { category: string; spent: number; spentYesterday: number; baseline: number; lastMonth: number; verdict: Verdict }

/** 조언 문장용 금액: 1만 이상은 "9만"·"1.5만", 그 미만은 "4,200원". */
export const fmt = (n: number) => {
  const v = Math.round(n)
  return Math.abs(v) >= 10000 ? `${Number((v / 10000).toFixed(1))}만` : `${v.toLocaleString('ko-KR')}원`
}
export const daysInMonth = (yearMonth: string) => {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export const addMonths = (yearMonth: string, n: number) => {
  const [y, m] = yearMonth.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
}
export const ym = (d: string) => d.slice(0, 7)
export const dayOf = (d: string) => Number(d.slice(8, 10))
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = Math.floor(s.length / 2)
  return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2)
}

const MIN_BASELINE = 50000
export const UNCATEGORIZED = '미분류'
const isVariableSpend = (t: CoachTx) =>
  t.type === 'expense' && t.fixedType !== 'fixed' && !isNonSpend(t) && (t.category || UNCATEGORIZED) !== UNCATEGORIZED
const net = (t: CoachTx) => t.amount - (t.split || 0)

/** 그 달 변동지출을 카테고리별 실지출로. until 을 주면 그 날짜(포함)까지만. */
function spendByCategory(transactions: CoachTx[], month: string, until?: string): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of transactions) {
    if (ym(t.date) !== month || !isVariableSpend(t) || (until && t.date > until)) continue
    const c = t.category as string
    m.set(c, (m.get(c) || 0) + net(t))
  }
  return m
}

/**
 * 카테고리 기준선: 이번 달을 뺀 끝난 최근 3개월(기록 있는 달만)의 실지출 중앙값.
 * 저장하지 않는다 — 끝난 달은 바뀌지 않으니 매번 계산해도 "매달 갱신한 값"과 같고, 지난 거래를 고쳐도 어긋나지 않는다.
 */
export function categoryBaselines(transactions: CoachTx[], yearMonth: string): Map<string, { baseline: number; lastMonth: number }> {
  const months = [1, 2, 3].map((n) => addMonths(yearMonth, -n))
  const recorded = months.filter((m) => transactions.some((t) => ym(t.date) === m))
  const sums = new Map(recorded.map((m) => [m, spendByCategory(transactions, m)]))
  const cats = new Set([...sums.values()].flatMap((s) => [...s.keys()]))
  const out = new Map<string, { baseline: number; lastMonth: number }>()
  for (const c of cats) {
    const baseline = median(recorded.map((m) => sums.get(m)?.get(c) || 0))
    if (baseline < MIN_BASELINE) continue
    out.set(c, { baseline, lastMonth: sums.get(months[0])?.get(c) || 0 })
  }
  return out
}

/**
 * 이번 달 이 카테고리를 많이 썼나, 여유 있나.
 * 날짜 기준 = baseline × day / days (오늘까지 평소대로 썼다면 쓴 돈).
 */
export function categoryVerdict(spent: number, baseline: number, day: number, days: number): Verdict {
  // TODO(human): Global Constraints 의 판정 규칙대로 'over' | 'heavy' | 'room' | 'ok' 를 돌려준다.
  throw new Error(`TODO(human): categoryVerdict(${spent}, ${baseline}, ${day}, ${days})`)
}

/** 기준선이 있는 카테고리마다 오늘·어제까지 쓴 돈과 판정. */
export function categoryStates(transactions: CoachTx[], today: string): CategoryState[] {
  const month = ym(today), day = dayOf(today), days = daysInMonth(month)
  const yesterday = day > 1 ? `${month}-${String(day - 1).padStart(2, '0')}` : ''
  const now = spendByCategory(transactions, month, today)
  const before = yesterday ? spendByCategory(transactions, month, yesterday) : new Map<string, number>()
  return [...categoryBaselines(transactions, month)].map(([category, b]) => {
    const spent = now.get(category) || 0
    return { category, spent, spentYesterday: before.get(category) || 0, ...b, verdict: categoryVerdict(spent, b.baseline, day, days) }
  })
}
```

- [ ] **Step 4: 판정 외 통과 확인**

Run: `npx vitest run src/coach.test.ts`
Expected: `날짜·금액 헬퍼`·`categoryBaselines` PASS, `categoryVerdict`·`categoryStates` FAIL(`TODO(human)`).

- [ ] **Step 5: Learn by Doing — 사용자가 `categoryVerdict` 본문을 쓴다**

집행자는 여기서 멈추고 Learn by Doing 요청을 낸다(`src/coach.ts` 의 `TODO(human)`). 규칙은 Global Constraints 의 "판정" 줄, 정답은 Step 1 테스트. 사용자가 끝났다고 하면 다음 단계.

- [ ] **Step 6: 통과 확인**

Run: `npx vitest run src/coach.test.ts`
Expected: 전부 PASS.

- [ ] **Step 7: 커밋**

```bash
git add src/coach.ts src/coach.test.ts
git commit -m "feat(coach): 카테고리 기준선(끝난 3개월 중앙값)과 많이 씀·여유 판정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 조언 목록 — `coachAdvice`

**Files:**
- Modify: `src/coach.ts` (import 확장 + 아래 코드 추가)
- Test: `src/coach.test.ts`

**Interfaces:**
- Consumes: Task 1 `isOpenSplit`·`splitPerson`, Task 2 전부, dashboardLogic `CARD_SPECS`·`benefitBalances`·`cardGlance`·`missedBenefits`·`withInstallmentCharges`·`tierStatus`·`type FixedDef`·`type CardSpec`
- Produces:
  - `export type AdviceKind = 'tier' | 'nextTier' | 'unused' | 'missed' | 'split' | 'category' | 'record'`
  - `export type Advice = { id: string; kind: AdviceKind; title: string; detail: string; badge?: string; due?: string; amount: number; target?: 'insights' | 'uncategorized' }`
  - `export function coachAdvice(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): Advice[]` — 마감 오름차순 → 금액 내림차순
  - `export const overAdvice: (s: CategoryState) => Advice` — Task 4 가 씀
  - id 규칙: `tier:<카드>` `nextTier:<카드>` `unused:<카드>` `missed:<영역>:<카드>` `split:<상대>` `cat:<카테고리>` `record:uncategorized` `record:side`

- [ ] **Step 1: 실패하는 테스트 추가** — `src/coach.test.ts` 아래에, import 에 `coachAdvice` 추가

```ts
describe('coachAdvice', () => {
  const card = (date: string, amount: number, payment: string) => tx(date, amount, { payment, memo: '마트', category: '생활', fixedType: 'fixed' })
  const ids = (a: { id: string }[]) => a.map((x) => x.id)

  it('실적 첫 구간 미달이면 D-배지와 함께 실적 부족', () => {
    const a = coachAdvice([card('2026-10-10', 210000, '하나카드')], [], '2026-10-26').find((x) => x.id === 'tier:하나카드')!
    expect(a).toMatchObject({ kind: 'tier', title: '하나카드 실적 9만 더 필요', badge: 'D-5', due: '2026-10-31', target: 'insights' })
    expect(a.detail).toContain('11월 할인한도 1.5만')
  })
  it('다음 구간까지 5만 이하면 다음 구간 근접', () => {
    const a = coachAdvice([card('2026-10-10', 560000, '하나카드')], [], '2026-10-20').find((x) => x.id === 'nextTier:하나카드')!
    expect(a.title).toBe('하나카드 4만 더 쓰면 한도 올라가요')
    expect(a.detail).toBe('다음 달 할인한도 1.5만 → 3만')
  })
  it('가족 합산 카드(국민)는 실적 조언이 없다', () => {
    expect(ids(coachAdvice([], [], '2026-10-26')).filter((i) => i.endsWith('국민카드') && /tier/i.test(i))).toEqual([])
  })
  it('전월 실적을 채운 카드는 이번 달 남은 혜택을 카드별 한 줄로', () => {
    const a = coachAdvice([card('2026-09-10', 300000, 'NH카드')], [], '2026-10-20').find((x) => x.id === 'unused:NH카드')!
    expect(a.title).toBe('NH카드 혜택 4.5만 남음')
    expect(a.detail).toContain('커피 50% 1만')
  })
  it('다른 보유 카드였으면 3천원 이상 더 받았을 때 놓친 혜택', () => {
    const a = coachAdvice([tx('2026-10-12', 50000, { memo: '쿠팡', category: '생활' })], [], '2026-10-20').find((x) => x.kind === 'missed')!
    expect(a).toMatchObject({ id: 'missed:온라인쇼핑:국민카드', title: '온라인쇼핑엔 국민카드', amount: 5000 })
  })
  it('안 받은 지 30일 넘은 분담금만', () => {
    const old = tx('2026-09-02', 60000, { memo: '여친 저녁', split: 30000 })
    const fresh = tx('2026-10-01', 60000, { memo: '여친 점심', split: 20000 })
    const a = coachAdvice([old, fresh], [], '2026-10-11').filter((x) => x.kind === 'split')
    expect(a).toHaveLength(1)
    expect(a[0]).toMatchObject({ id: 'split:여친', title: '여친 분담금 3만 받을 돈', detail: '1건, 가장 오래된 건 9/2' })
  })
  it('미분류와 끝난 달 부수입 0건', () => {
    const a = coachAdvice([tx('2026-10-05', 8000, { category: '미분류' })], [], '2026-10-11')
    expect(a.find((x) => x.id === 'record:uncategorized')).toMatchObject({ title: '미분류 1건', target: 'uncategorized' })
    expect(a.find((x) => x.id === 'record:side')?.title).toBe('9월 부수입 0건')
    const paid = coachAdvice([tx('2026-09-30', 120000, { type: 'income', category: '수입', subCategory: '부수입' })], [], '2026-10-11')
    expect(ids(paid)).not.toContain('record:side')
  })
  it('카테고리: 많이 씀·여유 문장', () => {
    const hist = [tx('2026-07-10', 340000), tx('2026-08-10', 340000), tx('2026-09-10', 340000)]
    const heavy = coachAdvice([...hist, tx('2026-10-08', 220000)], [], '2026-10-12').find((x) => x.id === 'cat:외식비')!
    expect(heavy.title).toBe('외식비 많이 썼어요')
    expect(heavy.detail).toContain('남은 19일은 하루')
    const room = coachAdvice([...hist, tx('2026-10-08', 60000)], [], '2026-10-17').find((x) => x.id === 'cat:외식비')!
    expect(room.title).toBe('외식비 여유 있어요')
    expect(room.detail).toBe('남은 14일 동안 28만까지 괜찮아요. 맛있는 거 드세요')
  })
  it('정렬: 마감 가까운 것 먼저, 같으면 금액 큰 것', () => {
    const a = coachAdvice([], [], '2026-10-26')
    const key = (x: { due?: string }) => x.due ?? '9999-99-99'
    for (let i = 1; i < a.length; i++) {
      expect(key(a[i - 1]) <= key(a[i])).toBe(true)
      if (key(a[i - 1]) === key(a[i])) expect(a[i - 1].amount).toBeGreaterThanOrEqual(a[i].amount)
    }
    expect(a.findIndex((x) => x.id === 'tier:NH카드')).toBeLessThan(a.findIndex((x) => x.id === 'tier:하나카드'))   // 4.5만 > 1.5만
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/coach.test.ts`
Expected: FAIL — `coachAdvice is not exported` 류.

- [ ] **Step 3: 구현** — `src/coach.ts` 맨 위 import 를 교체하고, 파일 끝에 추가

```ts
import {
  CARD_SPECS, benefitBalances, cardGlance, isNonSpend, isOpenSplit, missedBenefits, splitPerson, tierStatus, withInstallmentCharges,
  type CardSpec, type FixedDef, type SplitTxLike,
} from './dashboardLogic.js'
```

```ts
export type AdviceKind = 'tier' | 'nextTier' | 'unused' | 'missed' | 'split' | 'category' | 'record'
export type Advice = {
  id: string; kind: AdviceKind; title: string; detail: string
  badge?: string; due?: string; amount: number; target?: 'insights' | 'uncategorized'
}

const pct = (r: number) => `${Math.round(r * 100)}%`
const monthLabel = (m: string) => `${Number(m.slice(5))}월`
const mmdd = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
const FOOD = ['외식비', '식비']
const SIDE_INCOME = '부수입'

/** 첫 구간을 채우면 다음 달 받는 할인 크기: 통합 한도면 구간 한도, 영역별이면 영역 한도 합. 우선순위에 쓴다. */
function stakeOf(spec: CardSpec): number {
  const tierCap = tierStatus(Math.min(...spec.tiers.map((t) => t.min)), spec.tiers).cap
  return spec.sharedCap ? tierCap : spec.benefits.reduce((s, b) => s + (b.cap > 0 ? b.cap : tierCap), 0)
}

/** 실적 부족·다음 구간·남은 혜택·놓친 혜택. 할부 보정(withInstallmentCharges)을 거친 행으로 혜택 보드와 같은 숫자를 낸다. */
function cardAdvice(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): Advice[] {
  const month = ym(today), days = daysInMonth(month), left = days - dayOf(today)
  const due = `${month}-${String(days).padStart(2, '0')}`
  const rows = withInstallmentCharges(transactions, fixedDefs)
  const balances = benefitBalances(rows, month)
  const out: Advice[] = []
  for (const g of cardGlance(rows, month, balances)) {
    if (g.unknown) continue   // 가족 합산(국민카드): 매달 첫 구간 충족으로 간주한다
    const spec = CARD_SPECS.find((s) => s.card === g.card)
    if (!spec) continue
    const min = Math.min(...spec.tiers.map((t) => t.min))
    if (!g.met) {
      const cap = tierStatus(min, spec.tiers).cap
      out.push({ id: `tier:${g.card}`, kind: 'tier', title: `${g.card} 실적 ${fmt(min - g.qualified)} 더 필요`,
        detail: `지금 ${fmt(g.qualified)} / ${fmt(min)}. 이달 안에 채우면 ${monthLabel(addMonths(month, 1))} ${cap > 0 ? `할인한도 ${fmt(cap)}` : '혜택이 열려요'}`,
        badge: `D-${left}`, due, amount: stakeOf(spec), target: 'insights' })
    } else if (g.nextGap > 0 && g.nextGap <= 50000) {
      const st = tierStatus(g.qualified, spec.tiers)
      if (st.next) out.push({ id: `nextTier:${g.card}`, kind: 'nextTier', title: `${g.card} ${fmt(g.nextGap)} 더 쓰면 한도 올라가요`,
        detail: `다음 달 할인한도 ${fmt(st.cap)} → ${fmt(st.next.cap)}`, amount: st.next.cap - st.cap, target: 'insights' })
    }
  }
  const byCard = new Map<string, typeof balances>()
  for (const b of balances) if (!b.locked && b.remaining > 0) byCard.set(b.card, [...(byCard.get(b.card) || []), b])
  for (const [card, items] of byCard) {
    const sum = items.reduce((s, b) => s + b.remaining, 0)
    const top = [...items].sort((a, b) => b.remaining - a.remaining).slice(0, 2)
    out.push({ id: `unused:${card}`, kind: 'unused', title: `${card} 혜택 ${fmt(sum)} 남음`,
      detail: top.map((b) => `${b.area} ${pct(b.rate)} ${fmt(b.remaining)}`).join(' · '),
      badge: `${fmt(sum)} 남음`, due, amount: sum, target: 'insights' })
  }
  const missed = new Map<string, { area: string; card: string; sum: number; count: number }>()
  for (const h of missedBenefits(rows, month)) {
    const k = `${h.area}:${h.bestCard}`
    const m = missed.get(k) ?? { area: h.area, card: h.bestCard, sum: 0, count: 0 }
    missed.set(k, { ...m, sum: m.sum + h.discount, count: m.count + 1 })
  }
  for (const [k, m] of missed) if (m.sum >= 3000)
    out.push({ id: `missed:${k}`, kind: 'missed', title: `${m.area}엔 ${m.card}`,
      detail: `이번 달 ${fmt(m.sum)} 놓쳤어요 (${m.count}건)`, amount: m.sum, target: 'insights' })
  return out
}

/** 안 받은 지 30일 넘은 분담금을 상대별로. */
function splitAdvice(transactions: CoachTx[], today: string): Advice[] {
  const cutoff = Date.parse(today) - 30 * 86400000
  const by = new Map<string, CoachTx[]>()
  for (const t of transactions) {
    if (!isOpenSplit(t) || Date.parse(t.date) > cutoff) continue
    const who = splitPerson(t.memo)
    by.set(who, [...(by.get(who) || []), t])
  }
  return [...by].map(([who, ts]) => {
    const sum = ts.reduce((s, t) => s + t.split, 0)
    return { id: `split:${who}`, kind: 'split' as const, title: `${who} 분담금 ${fmt(sum)} 받을 돈`,
      detail: `${ts.length}건, 가장 오래된 건 ${mmdd(ts.map((t) => t.date).sort()[0])}`, amount: sum }
  })
}

/** 한 달치를 넘었다는 조언. 판정(7일 이전엔 ok)과 무관하게 alertFor 의 "처음 넘은 날"에도 쓴다. */
export const overAdvice = (s: CategoryState): Advice => ({ id: `cat:${s.category}`, kind: 'category',
  title: `${s.category} 평소 한 달치를 넘었어요`, detail: `${fmt(s.spent)} / 평소 ${fmt(s.baseline)}`, amount: s.spent - s.baseline })

function categoryAdvice(transactions: CoachTx[], today: string): Advice[] {
  const days = daysInMonth(ym(today)), day = dayOf(today), left = days - day
  return categoryStates(transactions, today).flatMap((s): Advice[] => {
    if (s.verdict === 'over') return [overAdvice(s)]
    if (s.verdict === 'heavy') {
      const proj = Math.round(s.spent / day * days)
      const tail = left > 0 ? `. 남은 ${left}일은 하루 ${fmt(Math.max(0, s.baseline - s.spent) / left)}면 평소대로` : ''
      return [{ id: `cat:${s.category}`, kind: 'category', title: `${s.category} 많이 썼어요`,
        detail: `지금 ${fmt(s.spent)}, 이 속도면 월말 ${fmt(proj)}(평소 ${fmt(s.baseline)})${tail}`, amount: proj - s.baseline }]
    }
    if (s.verdict === 'room') {
      const room = s.baseline - s.spent
      return [{ id: `cat:${s.category}`, kind: 'category', title: `${s.category} 여유 있어요`,
        detail: `남은 ${left}일 동안 ${fmt(room)}까지 괜찮아요${FOOD.includes(s.category) ? '. 맛있는 거 드세요' : ''}`, amount: room }]
    }
    return []
  })
}

/** 미분류 거래, 끝난 달 부수입 0건(플랫폼 정산은 월말에 몰아 넣는다 — 2026-09 를 통째로 빠뜨린 적 있음). */
function recordAdvice(transactions: CoachTx[], today: string): Advice[] {
  const month = ym(today), prev = addMonths(month, -1)
  const out: Advice[] = []
  const uncat = transactions.filter((t) => t.type === 'expense' && ym(t.date) === month && (t.category || UNCATEGORIZED) === UNCATEGORIZED)
  if (uncat.length) out.push({ id: 'record:uncategorized', kind: 'record', title: `미분류 ${uncat.length}건`,
    detail: '눌러서 카테고리를 정해 주세요', amount: 0, target: 'uncategorized' })
  if (!transactions.some((t) => t.type === 'income' && ym(t.date) === prev && t.subCategory === SIDE_INCOME))
    out.push({ id: 'record:side', kind: 'record', title: `${monthLabel(prev)} 부수입 0건`,
      detail: '배민·쿠팡이츠·펫택시·퀵 정산 넣었어요?', amount: 0 })
  return out
}

/** 오늘의 조언 전체. 마감 가까운 것 → 금액 큰 것. */
export function coachAdvice(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): Advice[] {
  return [...cardAdvice(transactions, fixedDefs, today), ...splitAdvice(transactions, today),
    ...categoryAdvice(transactions, today), ...recordAdvice(transactions, today)]
    .sort((a, b) => (a.due ?? '9999-99-99').localeCompare(b.due ?? '9999-99-99') || b.amount - a.amount)
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/coach.test.ts src/dashboardLogic.test.ts`
Expected: 전부 PASS. NH 남은 혜택 합이 4.5만이 아니면 `CARD_SPECS` NH 영역 한도 합을 다시 세고 테스트 기대값을 그 합으로 고친다(약관 데이터가 원본).

- [ ] **Step 5: 커밋**

```bash
git add src/coach.ts src/coach.test.ts
git commit -m "feat(coach): 오늘의 조언 목록 — 실적·남은/놓친 혜택·분담금·카테고리·기록 빠짐

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 오늘의 알림 — `alertFor`·`coachDate`

**Files:**
- Modify: `src/coach.ts`
- Test: `src/coach.test.ts`

**Interfaces:**
- Consumes: Task 3 `coachAdvice`·`overAdvice`·`Advice`, Task 2 `categoryStates`
- Produces:
  - `export function alertFor(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): { title: string; body: string } | null`
  - `export const kstToday: (now: number) => string`
  - `export const coachDate: (q: unknown, now: number) => string`

- [ ] **Step 1: 실패하는 테스트 추가** — import 에 `alertFor, coachDate, kstToday` 추가

```ts
describe('alertFor — 보내는 날', () => {
  const hist = [tx('2026-07-10', 340000), tx('2026-08-10', 340000), tx('2026-09-10', 340000)]
  it('말일 5일 전·2일 전에 실적 부족, 그 사이엔 없음 (31일 달)', () => {
    const a = alertFor([], [], '2026-10-26')!
    expect(a.title.startsWith('[가계부] 10/26 ')).toBe(true)
    expect(a.title).toContain('실적'); expect(a.title).toContain('외 1건')
    expect(alertFor([], [], '2026-10-29')).not.toBeNull()
    expect(alertFor([], [], '2026-10-27')).toBeNull()
  })
  it('30일 달·평년 2월·윤년 2월', () => {
    expect(alertFor([], [], '2026-11-25')).not.toBeNull(); expect(alertFor([], [], '2026-11-24')).toBeNull()
    expect(alertFor([], [], '2027-02-23')).not.toBeNull()
    expect(alertFor([], [], '2028-02-24')).not.toBeNull(); expect(alertFor([], [], '2028-02-23')).toBeNull()
  })
  it('1일에 분담금, 제목 날짜는 0을 채운다', () => {
    const a = alertFor([tx('2026-10-01', 60000, { memo: '여친 저녁', split: 30000 })], [], '2026-11-01')!
    expect(a.title).toBe('[가계부] 11/01 여친 분담금 3만 받을 돈')
    expect(a.body).toBe('• 여친 분담금 3만 받을 돈\n  1건, 가장 오래된 건 10/1')
  })
  it('3일에 끝난 달 부수입 0건, 넣었으면 없음', () => {
    expect(alertFor([], [], '2026-11-03')?.title).toBe('[가계부] 11/03 10월 부수입 0건')
    expect(alertFor([tx('2026-10-31', 90000, { type: 'income', category: '수입', subCategory: '부수입' })], [], '2026-11-03')).toBeNull()
  })
  it('말일 3일 전, 남은 혜택 합 1만 이상', () => {
    const a = alertFor([tx('2026-09-10', 300000, { payment: 'NH카드', memo: '마트', category: '생활', fixedType: 'fixed' })], [], '2026-10-28')!
    expect(a.body).toContain('NH카드 혜택')
  })
  it('15일 중간 점검: 많이 쓴 카테고리', () => {
    expect(alertFor([...hist, tx('2026-10-10', 250000)], [], '2026-10-15')?.body).toContain('외식비 많이 썼어요')
  })
  it('한 달치를 처음 넘은 날만, 7일 이전이어도', () => {
    const ts = [...hist, tx('2026-10-05', 330000), tx('2026-10-06', 20000)]
    expect(alertFor(ts, [], '2026-10-06')?.body).toContain('외식비 평소 한 달치를 넘었어요')
    expect(alertFor(ts, [], '2026-10-07')).toBeNull()
  })
})

describe('coachDate', () => {
  it('KST 로 날짜를 잡는다 (UTC 15:30 = KST 다음 날 00:30)', () => {
    expect(kstToday(Date.parse('2026-10-11T15:30:00Z'))).toBe('2026-10-12')
  })
  it('date 인자는 YYYY-MM-DD 만 받고 나머지는 오늘', () => {
    const now = Date.parse('2026-10-11T03:00:00Z')
    expect(coachDate('2026-10-26', now)).toBe('2026-10-26')
    expect(coachDate('2026-1-5', now)).toBe('2026-10-11')
    expect(coachDate('abc', now)).toBe('2026-10-11')
    expect(coachDate(undefined, now)).toBe('2026-10-11')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/coach.test.ts`
Expected: FAIL — `alertFor is not exported` 류.

- [ ] **Step 3: 구현** — `src/coach.ts` 끝에 추가

```ts
/**
 * 오늘 미리알림으로 보낼 것. 정해진 날에만, 여러 개면 하나로 묶는다(하루 최대 1개).
 * 상태를 저장하지 않는다 — 같은 날 몇 번 불러도 같은 답이라 맥이 실패 후 다시 불러도 안전하다.
 */
export function alertFor(transactions: CoachTx[], fixedDefs: FixedDef[], today: string): { title: string; body: string } | null {
  const day = dayOf(today), left = daysInMonth(ym(today)) - day
  const advice = coachAdvice(transactions, fixedDefs, today)
  const of = (kind: AdviceKind) => advice.filter((a) => a.kind === kind)
  const picked: Advice[] = []
  if (left === 5 || left === 2) picked.push(...of('tier'))
  if (left === 3) {
    const unused = of('unused')
    if (unused.reduce((s, a) => s + a.amount, 0) >= 10000) picked.push(...unused)
  }
  if (day === 1) picked.push(...of('split'))
  if (day === 3) picked.push(...advice.filter((a) => a.id === 'record:side'))
  const states = categoryStates(transactions, today)
  const crossed = states.filter((s) => s.spentYesterday < s.baseline && s.spent >= s.baseline)
  picked.push(...crossed.map(overAdvice))
  if (day === 15) {
    const done = new Set(crossed.map((s) => `cat:${s.category}`))
    picked.push(...of('category').filter((a) => !done.has(a.id) && /많이 썼어요|넘었어요/.test(a.title)))
  }
  if (!picked.length) return null
  const date = `${today.slice(5, 7)}/${today.slice(8, 10)}`   // 0 채움: 맥이 "[가계부] 11/1" 과 "11/15" 를 헷갈리지 않게
  return {
    title: `[가계부] ${date} ${picked[0].title}${picked.length > 1 ? ` 외 ${picked.length - 1}건` : ''}`,
    body: picked.map((a) => `• ${a.title}\n  ${a.detail}`).join('\n'),
  }
}

/** 서버는 UTC 로 돈다. */
export const kstToday = (now: number) => new Date(now + 9 * 3600_000).toISOString().slice(0, 10)
/** /api/coach 의 date 인자: YYYY-MM-DD 만 받고, 아니면 KST 오늘. */
export const coachDate = (q: unknown, now: number) =>
  typeof q === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : kstToday(now)
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/coach.ts src/coach.test.ts
git commit -m "feat(coach): 정해진 날에만 하루 1개로 묶는 미리알림 내용(alertFor)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 서버 `/api/coach`

**Files:**
- Create: `api/coach.ts`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `gasGet` (`api/_gas.ts`), Task 3·4 `coachAdvice`·`alertFor`·`coachDate`·`CoachTx`, `FixedDef`
- Produces: `GET /api/coach?t=<SYNC_TOKEN>[&date=YYYY-MM-DD]` → `200 { date, alert: {title, body} | null, advice: Advice[] }`, 토큰 틀리면 `401`, GAS 실패면 `500` 텍스트

- [ ] **Step 1: 구현** — `api/coach.ts`

```ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { gasGet } from './_gas.js'
import { alertFor, coachAdvice, coachDate, type CoachTx } from '../src/coach.js'
import type { FixedDef } from '../src/dashboardLogic.js'

/**
 * 가계부 코치 — 맥 eventsync 가 07:27·09:00 에 GET 해서 alert 가 있으면 미리알림 "가계부" 에 하나 만든다.
 * 판단은 앱 홈과 같은 src/coach.ts. 상태를 저장하지 않아 몇 번 불러도 같은 답이다.
 * 인증: ?t=<SYNC_TOKEN>. &date=YYYY-MM-DD 로 특정 날의 알림을 실데이터로 미리 본다(읽기 전용).
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')
  if ((req.query.t as string) !== process.env.SYNC_TOKEN) return res.status(401).send('unauthorized')
  const date = coachDate(req.query.date, Date.now())
  try {
    // 고정비가 빠지면 할부가 실적에서 빠져 틀린 "실적 부족" 이 나온다 → 둘 다 읽혀야 조언한다.
    const [ledger, fixed] = await Promise.all([
      gasGet<{ transactions?: CoachTx[] }>('ledger'),
      gasGet<{ defs?: FixedDef[] }>('fixedList'),
    ])
    if (!ledger.transactions || !fixed.defs) throw new Error('원장 또는 고정비 응답이 비었다')
    return res.status(200).json({
      date,
      alert: alertFor(ledger.transactions, fixed.defs, date),
      advice: coachAdvice(ledger.transactions, fixed.defs, date),
    })
  } catch (e) {
    return res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8').send(`코치 실패: ${e instanceof Error ? e.message : e}`)
  }
}
```

`vercel.json` 의 `functions` 에 추가:

```json
    "api/coach.ts": { "maxDuration": 60 }
```

- [ ] **Step 2: 타입체크·테스트·빌드**

Run: `npx tsc --noEmit --ignoreConfig --strict --skipLibCheck --module nodenext --moduleResolution nodenext --target es2021 --types node $(ls api/*.ts | grep -v test) && npm test && npm run build`
Expected: 에러 없음, 전부 PASS, `✓ built in`.

- [ ] **Step 3: 배포하고 상태 먼저 확인**

Run: `npm run deploy:prod 2>&1 | grep -oE '"status": *"[^"]*"'`
Expected: `"status": "ok"`. `ok` 가 아니면 다음 단계로 가지 말고 원인부터 본다.

- [ ] **Step 4: 실데이터 확인 (읽기 전용)**

```bash
T=$(grep '^VITE_SYNC_TOKEN=' .env | cut -d= -f2-); B=https://personal-money-app-seven.vercel.app/api/coach
for d in 2026-10-26 2026-10-28 2026-11-01 2026-11-03 2026-10-15; do curl -s "$B?t=$T&date=$d" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['date'], '|', (d['alert'] or {}).get('title'), '| 조언', len(d['advice']))"; done
curl -s -o /dev/null -w "%{http_code}\n" "$B?t=wrong"
```

Expected: 10/26 은 `[가계부] 10/26 … 실적 …` 제목, 각 줄 조언 개수 출력, 마지막 `401`. 500 이면 응답 본문의 원인 문장을 본다. 서버가 `../src/coach.js` 를 못 찾으면(`ERR_MODULE_NOT_FOUND`) 멈추고 보고.

- [ ] **Step 5: 커밋·푸시**

```bash
git add api/coach.ts vercel.json
git commit -m "feat(coach): /api/coach — 원장·고정비로 오늘의 조언과 알림을 낸다

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
```

---

### Task 6: 앱 홈 코치 카드

**Files:**
- Modify: `src/App.tsx` (import, `Dashboard` 836~932행, `CardBenefitOverview` 955·968·981~983행, 새 `CoachCard`)
- Modify: `src/App.css` (끝에 추가)
- Modify: `src/i18n.ts` (`ko` 에 키 추가, `home_benefit_missed` 삭제)

**Interfaces:**
- Consumes: Task 3 `coachAdvice`·`Advice`, Task 2 `categoryStates`, 기존 `todayIso()`·`compactMoney()`·`categoryIcon()`·`benefitDataStatus`·`fixedDefs`·`setSelectedCategory`·`onOpenInsights`
- Produces: 홈 맨 위 `CoachCard`, 카테고리 순위 줄의 `.cat-base`

- [ ] **Step 1: 문구** — `src/i18n.ts` 의 `ko` 에서 `home_benefit_missed` 줄을 지우고, `home_benefit_title` 근처에 추가

```ts
  coach_title: '오늘의 코치',
  coach_more: '더 보기 {n}건',
  coach_less: '접기',
  coach_empty: '지금 챙길 것 없음',
  coach_error: '원장을 못 읽어 조언을 못 냄',
  coach_baseline: '평소 {amt}',
```

- [ ] **Step 2: `CoachCard` 컴포넌트** — `src/App.tsx` 에서 `function CardBenefitOverview(` 바로 위에 추가하고, 상단 import 에 `import { coachAdvice, categoryStates, type Advice } from './coach'` 추가

```tsx
const COACH_ICON: Record<Advice['kind'], string> = {
  tier: '💳', nextTier: '📈', unused: '🎁', missed: '🔁', split: '🤝', category: '🍽️', record: '🧾',
}

/** 홈 맨 위 코치 카드. 판단은 src/coach.ts(서버 알림과 같은 함수), 여기는 보여주기만 한다. */
function CoachCard({ advice, status, onOpenInsights, onOpenUncategorized }: {
  advice: Advice[]
  status: LedgerLoadStatus
  onOpenInsights: () => void
  onOpenUncategorized: () => void
}) {
  const [open, setOpen] = useState(false)
  const shown = open ? advice : advice.slice(0, 3)
  const iconOf = (a: Advice) => a.kind === 'category' ? categoryIcon(a.id.slice(4)) : COACH_ICON[a.kind]
  const actionOf = (a: Advice) => a.target === 'insights' ? onOpenInsights : a.target === 'uncategorized' ? onOpenUncategorized : undefined
  return (
    <section className="coach-card" aria-labelledby="home-coach-title" aria-busy={status === 'loading'}>
      <h2 id="home-coach-title">{t('coach_title')}</h2>
      {status === 'loading' ? <div className="coach-skeleton" />
        : status === 'error' ? <p className="coach-quiet">{t('coach_error')}</p>
        : !advice.length ? <p className="coach-quiet">{t('coach_empty')}</p>
        : (
          <ul className="coach-list">
            {shown.map((a) => {
              const act = actionOf(a)
              const inner = (
                <>
                  <span className="coach-ic" aria-hidden>{iconOf(a)}</span>
                  <span className="coach-title">{a.title}</span>
                  {a.badge && <span className="coach-badge">{a.badge}</span>}
                  <span className="coach-detail">{a.detail}</span>
                </>
              )
              return (
                <li key={a.id}>
                  {act ? <button type="button" className="coach-row" onClick={act}>{inner}</button>
                    : <div className="coach-row">{inner}</div>}
                </li>
              )
            })}
          </ul>
        )}
      {status === 'ready' && advice.length > 3 && (
        <button type="button" className="coach-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('coach_less') : t('coach_more', { n: advice.length - 3 })}
        </button>
      )}
    </section>
  )
}
```

- [ ] **Step 3: `Dashboard` 연결** — `const ringSubtitle = …` 줄 아래에 추가

```tsx
  // 코치: 원장·고정비가 다 들어온 뒤에만 계산한다(로딩 중엔 실적이 낮게 잡혀 틀린 "실적 부족" 이 나온다).
  const coach = useMemo(
    () => benefitDataStatus === 'ready' ? coachAdvice(transactions, fixedDefs, todayIso()) : [],
    [benefitDataStatus, transactions, fixedDefs],
  )
  const catStates = useMemo(() => new Map(categoryStates(transactions, todayIso()).map((s) => [s.category, s])), [transactions])
```

`return (` 안 `<section className="view-stack home-motion">` 바로 다음, `<CardBenefitOverview` 앞에 넣는다:

```tsx
      <CoachCard
        advice={coach}
        status={benefitDataStatus}
        onOpenInsights={onOpenInsights}
        onOpenUncategorized={() => setSelectedCategory('미분류')}
      />
```

카테고리 순위 줄의 `<span className="cat-amt">{formatMoney(c.value)}</span>` 를 다음으로 바꾼다:

```tsx
              {(() => {
                const s = catStates.get(c.name)
                const tone = s?.verdict === 'over' || s?.verdict === 'heavy' ? ' heavy' : s?.verdict === 'room' ? ' room' : ''
                return (
                  <span className={`cat-amt${tone}`}>
                    {formatMoney(c.value)}
                    {s && <span className="cat-base"> · {t('coach_baseline', { amt: compactMoney(s.baseline) })}</span>}
                  </span>
                )
              })()}
```

(`compactMoney(340000)` 은 `'34만'` 을 돌려준다 — `src/App.tsx` 의 기존 함수.)

- [ ] **Step 4: 혜택 보드의 놓친 혜택 줄 제거** — `CardBenefitOverview` 에서 다음 세 곳을 지운다(코치 카드가 대신 말한다)

```tsx
  const missed = useMemo(() => missedBenefits(rows as never, monthKey), [rows, monthKey])
```
```tsx
  const missedTotal = missed.reduce((sum, item) => sum + item.discount, 0)
```
```tsx
      {missedTotal > 0 && (
        <p className="benefit-missed"><Sparkles size={14} aria-hidden />{t('home_benefit_missed', { amt: formatMoney(missedTotal) })}</p>
      )}
```

- [ ] **Step 5: 스타일** — `src/App.css` 끝에 추가

```css
/* 홈 코치 카드: 혜택 보드와 같은 슬립 한 장. 경고는 --danger, 좋은 신호는 --green(펜 파랑). */
.coach-card {
  border: 1px solid var(--line-strong); border-radius: var(--r-lg);
  background: var(--surface-solid); box-shadow: var(--soft-shadow); padding: 14px 18px 8px;
}
.coach-card h2 { margin: 0 0 6px; font-size: 20px; line-height: 1.2; letter-spacing: -.02em; }
.coach-list { list-style: none; margin: 0; padding: 0; }
.coach-row {
  display: grid; grid-template-columns: 22px 1fr auto; column-gap: 10px; row-gap: 2px; align-items: baseline;
  width: 100%; padding: 9px 0; border: 0; border-top: 1px solid var(--line);
  background: none; color: inherit; font: inherit; text-align: left;
}
.coach-list li:first-child .coach-row { border-top: 0; }
button.coach-row { cursor: pointer; }
.coach-ic { grid-row: span 2; font-size: 16px; line-height: 20px; }
.coach-title { font-size: 14px; font-weight: 800; min-width: 0; }
.coach-badge { color: var(--accent); font-size: 11px; font-weight: 800; white-space: nowrap; }
.coach-detail { grid-column: 2 / 4; color: var(--muted); font-size: 12px; line-height: 1.45; }
.coach-more {
  display: block; width: 100%; padding: 8px 0 6px; border: 0; border-top: 1px solid var(--line);
  background: none; color: var(--muted); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer;
}
.coach-quiet { margin: 0 0 8px; color: var(--muted); font-size: 13px; }
.coach-skeleton { height: 44px; margin-bottom: 8px; border-radius: var(--r-sm); background: var(--accent-soft); }
.cat-base { color: var(--muted); font-size: 11px; font-weight: 400; }
.cat-amt.heavy { color: var(--danger); }
.cat-amt.room { color: var(--green); }
```

- [ ] **Step 6: 테스트·린트·빌드**

Run: `npm test && npx tsc -b && npm run build`
Expected: 전부 PASS(`i18n.test.ts` 가 App 의 모든 `t()` 키가 사전에 있는지 본다), `✓ built in`. `npm run lint` 는 기존 오류 2개(`set-state-in-effect`)만 남아야 한다.

- [ ] **Step 7: 화면 확인** — 미리보기로 홈을 연다

`.claude/launch.json` 의 `money-app` 으로 `preview_start` → 홈에서 확인:
- 코치 카드가 카드 혜택 보드 위에 있다, 3개 + "더 보기 N건", 펼치기·접기 동작
- 실적 항목을 누르면 인사이트 탭, 미분류 항목을 누르면 미분류 시트
- 지출 도넛 아래 줄에 "평소 N만", 색(많이 씀 빨강·여유 파랑)
- 혜택 보드에 "아낄 수 있었던 돈" 줄이 없다
- `resize_window` 375px(모바일)에서 줄바꿈이 깨지지 않는다, 다크 모드에서 읽힌다
- 콘솔 오류 없음. 스크린샷을 남긴다.

(로컬 개발 서버는 `/api/sync` 를 못 불러 원장이 비어 오류 상태로 보일 수 있다. 그러면 배포 후 실서버에서 확인한다.)

- [ ] **Step 8: 커밋·배포**

```bash
git add src/App.tsx src/App.css src/i18n.ts
git commit -m "feat(home): 홈 맨 위 오늘의 코치 카드, 카테고리 줄에 평소 기준선, 놓친 혜택 줄은 코치로 옮김

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
npm run deploy:prod 2>&1 | grep -oE '"status": *"[^"]*"'
git push -q origin main
```

Expected: `"status": "ok"`.

---

### Task 7: 맥 미리알림 — 07:27·09:00

**Files:**
- Create: `scripts/coachalert.js`
- Modify: `scripts/eventsync.py` (docstring, import, `coach()` 추가, `__main__`)
- Modify: `scripts/com.hwan.eventsync.plist`

**Interfaces:**
- Consumes: Task 5 `GET /api/coach` → `{ alert: { title, body } | null }`
- Produces: 미리알림 "가계부" 목록에 하루 최대 1개(`[가계부] MM/DD ` 접두어)

- [ ] **Step 1: JXA** — `scripts/coachalert.js`

```js
// 가계부 코치 미리알림 (JXA). eventsync.py 가 제목·본문·알림시각(ISO)을 넘긴다. 직접 실행하지 않는다.
// 같은 "[가계부] MM/DD " 로 시작하는 미리알림이 이미 있으면 만들지 않는다 = 하루 1개(로그인 실행·09:00 재실행 포함).
function run(argv) {
  const [title, body, at] = argv
  const R = Application('Reminders')
  let list = R.lists.whose({ name: '가계부' })()[0]
  if (!list) { R.lists.push(R.List({ name: '가계부' })); list = R.lists.byName('가계부') }
  const prefix = title.split(' ').slice(0, 2).join(' ') + ' '   // "[가계부] 11/01 " — 날짜 뒤 공백까지 비교한다
  if (list.reminders.name().some((n) => n.startsWith(prefix))) return '이미 있음'
  list.reminders.push(R.Reminder({ name: title, body, dueDate: new Date(at), remindMeDate: new Date(at) }))
  return '생성'
}
```

- [ ] **Step 2: 스크립트** — `scripts/eventsync.py`

docstring 첫 줄들을 다음으로 바꾼다:

```python
"""맥용 eventsync — 매일 07:27·09:00 + 로그인 시 launchd 가 돌린다 (~/Library/LaunchAgents/com.hwan.eventsync.plist).
맥은 pmset repeat wake 07:25 로 깬다. 07:27(09시 전)에는 코치만, 09시 이후에는 코치 → 이벤트.

  0. 가계부 코치: /api/coach 의 오늘 알림이 있으면 미리알림 "가계부" 에 하루 1개(scripts/coachalert.js). 서버가 상태 없이
     날짜로 계산하므로 잠긴 07:27 에 실패해도 09:00 이 같은 알림을 다시 만든다.
```

(기존 1·2·3 단계 설명과 `ALL=1` 줄은 그대로 둔다.)

import 줄의 `from datetime import datetime` 을 `from datetime import datetime, timedelta` 로 바꾸고, `def main():` 바로 위에 추가:

```python
def coach():
    """오늘 보낼 가계부 코치 알림이 있으면 미리알림 하나. 실패해도 이벤트 단계는 막지 않는다."""
    try:
        d = get(f"{BASE}/api/coach?t={urllib.parse.quote(TOKEN)}")
        a = d.get('alert')
        if not a: log('코치: 오늘 알림 없음'); return
        now = datetime.now().astimezone()
        at = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if at <= now: at = now + timedelta(minutes=1)   # 09:00 이 지났으면 바로. 울리는 건 iCloud 로 받은 폰이 한다
        r = subprocess.run(['/usr/bin/osascript', '-l', 'JavaScript', str(DIR / 'coachalert.js'), a['title'], a['body'], at.isoformat()],
                           capture_output=True, text=True, timeout=120)
        if r.returncode: raise RuntimeError(r.stderr.strip()[:200])
        log('코치:', a['title'], '·', r.stdout.strip())
    except Exception as ex:
        log('코치 실패:', ex)
```

맨 끝 `if __name__ == '__main__': main()` 를 다음으로 바꾼다:

```python
if __name__ == '__main__':
    coach()   # 빠르고 상태가 없다 — 먼저. 이벤트의 1시간 재시도에 묶이지 않게
    if datetime.now().hour >= 9:   # 이벤트 서버는 넘길 때 상태를 바꾼다 → 잠긴 07:27 에는 돌리지 않는다
        try: main()
        except Exception as ex: log('이벤트 실패:', ex)
```

- [ ] **Step 3: plist** — `StartCalendarInterval` 의 `<dict>…</dict>` 를 배열로, 주석 첫 줄도 갱신

```xml
  <!-- 가계부 코치 + 유튜브 구독자 이벤트: 매일 07:27·09:00 + 로그인 시 scripts/eventsync.py 실행.
       맥은 pmset repeat wake 07:25 로 깬다. 07:27 은 코치만(스크립트가 시각으로 가른다). -->
```
```xml
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>27</integer></dict>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  </array>
```

(설치 방법·잠자기 설명 주석은 그대로 둔다.)

- [ ] **Step 4: 문법 확인**

Run: `python3 -I -m py_compile scripts/eventsync.py && plutil -lint scripts/com.hwan.eventsync.plist && osascript -l JavaScript -e 'ObjC.import("Foundation"); 1' >/dev/null && echo ok`
Expected: `scripts/com.hwan.eventsync.plist: OK`, `ok`.

- [ ] **Step 5: JXA 단독 확인 — 하루 1개**

```bash
osascript -l JavaScript scripts/coachalert.js "[가계부] 01/01 테스트 알림" "본문" "2099-01-01T09:00:00+09:00"
osascript -l JavaScript scripts/coachalert.js "[가계부] 01/01 다른 제목 외 1건" "본문" "2099-01-01T09:00:00+09:00"
osascript -l JavaScript -e 'Application("Reminders").lists.byName("가계부").reminders.whose({name: {_beginsWith: "[가계부] 01/01 "}})().length'
```

Expected: `생성`, `이미 있음`, `1`. 확인 후 테스트 미리알림을 지운다:

```bash
osascript -l JavaScript -e 'const r = Application("Reminders").lists.byName("가계부").reminders.whose({name: {_beginsWith: "[가계부] 01/01 "}})(); r.forEach((x) => x.delete()); r.length'
```

- [ ] **Step 6: launchd 재설치 + 실제 실행**

```bash
cp scripts/com.hwan.eventsync.plist ~/Library/LaunchAgents/com.hwan.eventsync.plist
launchctl bootout gui/$(id -u)/com.hwan.eventsync 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hwan.eventsync.plist
launchctl print gui/$(id -u)/com.hwan.eventsync | grep -A3 "event triggers" | head -8
```

bootstrap 이 `RunAtLoad` 로 한 번 돈다. 끝나면 `tail -3 ~/Library/Logs/eventsync.log` 에 `코치: …` 또는 `코치: 오늘 알림 없음` 이 있고 이벤트 줄이 이어져야 한다(09시 이후 기준). `코치 실패` 면 원인 문장을 본다.

- [ ] **Step 7: 커밋·푸시**

```bash
git add scripts/coachalert.js scripts/eventsync.py scripts/com.hwan.eventsync.plist
git commit -m "feat(coach): 맥이 07:27·09:00 에 가계부 코치 알림을 미리알림 '가계부' 에 하루 1개

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
```

---

### Task 8: 문서

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README** — 상단 구성 표의 `가계부` 줄 아래에 추가

```markdown
| 가계부 코치 | 유지 | 판단 `src/coach.ts`(앱·서버 공용), 홈 `CoachCard`, 서버 `api/coach.ts`, 맥 `scripts/eventsync.py` 의 `coach()` + `scripts/coachalert.js` |
```

`## 함정` 섹션 끝에 추가:

```markdown
**`src/` 파일을 서버가 import 하려면 상대 경로에 `.js` 확장자가 있어야 한다.** 서버는 Node ESM 이라 확장자 없는 import 가 런타임에 깨진다.
Vite·Vitest 는 `.js` 를 `.ts` 로 풀어 주므로 앱 쪽은 그대로 동작한다. (`src/dashboardLogic.ts`·`src/coach.ts`)

**코치 알림을 실데이터로 미리 보기:** `/api/coach?t=<SYNC_TOKEN>&date=2026-10-26` — 읽기 전용, 그날 보낼 알림과 조언 목록.
```

- [ ] **Step 2: 커밋·푸시**

```bash
git add README.md
git commit -m "docs: 가계부 코치 구성과 서버 공유 import 함정

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
```
