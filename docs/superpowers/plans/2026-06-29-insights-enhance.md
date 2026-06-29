# 인사이트 강화 (장소 TOP + 전월대비) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 인사이트 탭에 "장소별 지출 TOP" 가로막대와 "카테고리 전월대비" 증감 리스트를 추가한다.

**Architecture:** 집계는 `dashboardLogic.ts`에 순수함수 2개(`placeTotals`, `categoryDeltas`)로 추가하고 vitest로 검증. 표시는 `App.tsx`의 `InsightsView`에 recharts 가로막대(기존 "지출 비중" 패턴 복제)와 인라인 증감 리스트로 렌더. GAS/시트/리포트 변경 없음(읽기 전용 집계).

**Tech Stack:** React + TypeScript + Vite, recharts(설치됨), vitest(설치됨).

## Global Constraints

- 변동지출 = `type === 'expense' && fixedType !== 'fixed'`. 실지출 = `amount - split`.
- 월 키 포맷 'YYYY-MM'. 이번달 = `summary.monthKey`, 전월 = `summary.previousMonth?.month`.
- 기존 함수 재사용: `topNWithOther(data, n)`, `changeRate(cur, prev)`, `splitPlaceItem(memo)`.
- 테스트 명령: `npm test` (= `vitest run`), cwd = `personal-money-app`.
- 기존 차트/카드(월별 흐름 Area, 지출 비중 Bar, 텍스트 카드 7개)는 변경 금지.

---

### Task 1: 순수 집계함수 placeTotals + categoryDeltas

**Files:**
- Modify: `personal-money-app/src/dashboardLogic.ts` (NV 타입·기존 함수 아래에 추가)
- Test: `personal-money-app/src/dashboardLogic.test.ts` (기존 파일에 describe 추가)

**Interfaces:**
- Consumes: `NV` 타입, `topNWithOther(data: NV[], n: number): NV[]`, `changeRate(current: number, previous: number): number | null`, `splitPlaceItem(memo: string): { place: string; item: string }` — 모두 같은 파일에 존재.
- Produces:
  - `placeTotals(transactions: PlaceTxLike[], yearMonth: string, n: number): NV[]`
  - `categoryDeltas(transactions: CatTxLike[], curMonth: string, prevMonth: string | undefined): CategoryDelta[]`
  - `type CategoryDelta = { name: string; cur: number; prev: number; delta: number; rate: number | null }`

- [ ] **Step 1: 실패 테스트 작성**

`dashboardLogic.test.ts` 끝에 추가:

```typescript
import { placeTotals, categoryDeltas } from './dashboardLogic'

describe('placeTotals', () => {
  const txs = [
    { date: '2026-06-01', type: 'expense', amount: 10000, split: 0, fixedType: 'variable', memo: '코스트코 우유' },
    { date: '2026-06-02', type: 'expense', amount: 5000, split: 0, fixedType: 'variable', memo: '코스트코 빵' },
    { date: '2026-06-03', type: 'expense', amount: 3000, split: 0, fixedType: 'variable', memo: '다이소 수세미' },
    { date: '2026-06-04', type: 'expense', amount: 99000, split: 0, fixedType: 'fixed', memo: '월세' },     // 고정 제외
    { date: '2026-06-05', type: 'income', amount: 200000, split: 0, fixedType: 'variable', memo: '용돈' },  // 수입 제외
    { date: '2026-05-09', type: 'expense', amount: 7000, split: 0, fixedType: 'variable', memo: '코스트코 과자' }, // 타월 제외
  ]

  it('변동지출만 장소별 합산, 실지출 기준', () => {
    const r = placeTotals(txs, '2026-06', 7)
    expect(r).toEqual([
      { name: '코스트코', value: 15000 },
      { name: '다이소', value: 3000 },
    ])
  })

  it('split을 뺀 실지출로 합산', () => {
    const r = placeTotals(
      [{ date: '2026-06-01', type: 'expense', amount: 10000, split: 6000, fixedType: 'variable', memo: '코스트코 우유' }],
      '2026-06', 7,
    )
    expect(r).toEqual([{ name: '코스트코', value: 4000 }])
  })

  it('빈 메모는 기타로 합산', () => {
    const r = placeTotals(
      [{ date: '2026-06-01', type: 'expense', amount: 1000, split: 0, fixedType: 'variable', memo: '' }],
      '2026-06', 7,
    )
    expect(r).toEqual([{ name: '기타', value: 1000 }])
  })

  it('n 초과 시 나머지는 기타로', () => {
    const many = ['가', '나', '다'].map((p, i) => ({
      date: '2026-06-01', type: 'expense', amount: (3 - i) * 1000, split: 0, fixedType: 'variable', memo: `${p} 물건`,
    }))
    const r = placeTotals(many, '2026-06', 2)
    expect(r).toEqual([
      { name: '가', value: 3000 },
      { name: '나', value: 2000 },
      { name: '기타', value: 1000 },
    ])
  })
})

describe('categoryDeltas', () => {
  const txs = [
    { date: '2026-06-01', type: 'expense', amount: 12000, split: 0, category: '식비', fixedType: 'variable' },
    { date: '2026-06-02', type: 'expense', amount: 3000, split: 0, category: '생활', fixedType: 'variable' },
    { date: '2026-06-03', type: 'expense', amount: 50000, split: 0, category: '주거', fixedType: 'fixed' }, // 고정 제외
    { date: '2026-05-01', type: 'expense', amount: 10000, split: 0, category: '식비', fixedType: 'variable' },
    { date: '2026-05-02', type: 'expense', amount: 8000, split: 0, category: '교통', fixedType: 'variable' },
  ]

  it('두 달 합집합 카테고리, 변화량 절대값 내림차순', () => {
    const r = categoryDeltas(txs, '2026-06', '2026-05')
    expect(r).toEqual([
      { name: '교통', cur: 0, prev: 8000, delta: -8000, rate: -1 },
      { name: '식비', cur: 12000, prev: 10000, delta: 2000, rate: 0.2 },
      { name: '생활', cur: 3000, prev: 0, delta: 3000, rate: null },
    ])
  })

  it('전월 없으면(undefined) 이번달만, prev 0 rate null', () => {
    const r = categoryDeltas(txs, '2026-06', undefined)
    expect(r).toEqual([
      { name: '식비', cur: 12000, prev: 0, delta: 12000, rate: null },
      { name: '생활', cur: 3000, prev: 0, delta: 3000, rate: null },
    ])
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd personal-money-app && npx vitest run src/dashboardLogic.test.ts`
Expected: FAIL — `placeTotals`/`categoryDeltas` is not a function (또는 import 에러).

- [ ] **Step 3: 구현 추가**

`dashboardLogic.ts`에서 `splitPlaceItem`/`joinPlaceItem` 아래에 추가:

```typescript
type PlaceTxLike = { date: string; type: string; amount: number; split: number; fixedType: string; memo: string }

/** 해당 월 변동지출을 장소(memo 첫 단어)별 실지출 합산 → 내림차순 TOP n + 기타. 빈 장소는 '기타'. */
export function placeTotals(transactions: PlaceTxLike[], yearMonth: string, n: number): NV[] {
  const map = new Map<string, number>()
  for (const t of transactions) {
    if (t.type !== 'expense' || t.fixedType === 'fixed') continue
    if (t.date.slice(0, 7) !== yearMonth) continue
    const place = splitPlaceItem(t.memo).place || '기타'
    map.set(place, (map.get(place) || 0) + (t.amount - t.split))
  }
  const rows = [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  return topNWithOther(rows, n)
}

export type CategoryDelta = { name: string; cur: number; prev: number; delta: number; rate: number | null }
type CatTxLike = { date: string; type: string; amount: number; split: number; category: string; fixedType: string }

/** 두 달 변동지출을 카테고리별 실지출 합산 → {cur,prev,delta,rate}, |delta| 내림차순. prevMonth 없으면 prev=0. */
export function categoryDeltas(transactions: CatTxLike[], curMonth: string, prevMonth: string | undefined): CategoryDelta[] {
  const sum = (month: string | undefined) => {
    const m = new Map<string, number>()
    if (!month) return m
    for (const t of transactions) {
      if (t.type !== 'expense' || t.fixedType === 'fixed') continue
      if (t.date.slice(0, 7) !== month) continue
      const c = t.category || '미분류'
      m.set(c, (m.get(c) || 0) + (t.amount - t.split))
    }
    return m
  }
  const cur = sum(curMonth)
  const prev = sum(prevMonth)
  const names = new Set([...cur.keys(), ...prev.keys()])
  return [...names]
    .map((name) => {
      const c = cur.get(name) || 0
      const p = prev.get(name) || 0
      return { name, cur: c, prev: p, delta: c - p, rate: changeRate(c, p) }
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd personal-money-app && npx vitest run src/dashboardLogic.test.ts`
Expected: PASS (기존 테스트 포함 전부 green).

- [ ] **Step 5: 커밋**

```bash
cd personal-money-app
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "feat(insights): placeTotals/categoryDeltas 순수 집계함수 + 테스트"
```

---

### Task 2: InsightsView에 장소 TOP 차트 + 전월대비 증감 리스트

**Files:**
- Modify: `personal-money-app/src/App.tsx` `InsightsView` (926-994), import 라인(`placeTotals`, `categoryDeltas` 추가)
- Modify: `personal-money-app/src/App.css` (증감 리스트 스타일 추가)

**Interfaces:**
- Consumes: `placeTotals(transactions, summary.monthKey, 7)`, `categoryDeltas(transactions, summary.monthKey, summary.previousMonth?.month)` from Task 1. `formatMoney`, `formatPercent`, `compactMoney`, `SectionHeader`, recharts(`BarChart` 등) — App.tsx에 이미 import됨.
- Produces: 없음(최상위 뷰).

- [ ] **Step 1: import에 함수 추가**

App.tsx 상단 `dashboardLogic` import 구문에 `placeTotals`, `categoryDeltas`를 추가한다. (기존에 `splitPlaceItem` 등을 가져오는 `from './dashboardLogic'` 라인에 이름만 추가)

- [ ] **Step 2: InsightsView 본문 계산 추가**

`InsightsView` 함수 본문 시작부(`const insightRows = ...` 다음 줄)에 추가:

```typescript
  const places = placeTotals(transactions, summary.monthKey, 7)
  const deltas = categoryDeltas(transactions, summary.monthKey, summary.previousMonth?.month).slice(0, 5)
  const maxDelta = Math.max(1, ...deltas.map((d) => Math.abs(d.delta)))
```

- [ ] **Step 3: 전월대비 섹션 JSX 추가**

`<section className="insight-board">...</section>` (텍스트 카드) **바로 위**에 삽입:

```tsx
      <section className="wide-section">
        <SectionHeader icon={<ChartNoAxesCombined size={18} />} title="전월대비" aside={summary.previousMonth?.monthLabel ?? ''} />
        {deltas.length === 0 ? (
          <p className="row-meta" style={{ padding: '8px 2px' }}>비교할 전월 데이터가 쌓이는 중이에요.</p>
        ) : (
          <div className="delta-list">
            {deltas.map((d) => {
              const up = d.delta > 0
              return (
                <div className="delta-row" key={d.name}>
                  <span className="delta-name">{d.name}</span>
                  <div className="delta-bar-wrap">
                    <span className={`delta-bar ${up ? 'up' : 'down'}`} style={{ width: `${(Math.abs(d.delta) / maxDelta) * 100}%` }} />
                  </div>
                  <span className={`delta-val ${up ? 'up' : 'down'}`}>
                    {d.rate == null ? 'NEW' : `${up ? '↑' : '↓'}${formatPercent(Math.abs(d.rate))}`} ({formatSignedMoney(d.delta)})
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>
```

- [ ] **Step 4: 장소 TOP 차트 JSX 추가**

"지출 비중" `<section>`(969-991) **바로 아래**(InsightsView 닫는 `</section>` 직전)에 삽입:

```tsx
      {places.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<CircleDollarSign size={18} />} title="장소 TOP" aside={summary.monthKey} />
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={places} layout="vertical" margin={{ left: 0, right: 20, top: 12, bottom: 8 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={76} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--surface-solid)', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }}
                  itemStyle={{ color: 'var(--ink)' }}
                  labelStyle={{ color: 'var(--accent-tan)', fontWeight: 800 }}
                  formatter={(value) => [formatMoney(Number(value)), '지출액']}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {places.map((entry, index) => (
                    <Cell key={entry.name} fill={colors[index % colors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
```

- [ ] **Step 5: CSS 추가**

`App.css` 끝에 추가:

```css
.delta-list { display: flex; flex-direction: column; gap: 10px; }
.delta-row { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: 10px; }
.delta-name { font-weight: 700; font-size: 13px; color: var(--ink); }
.delta-bar-wrap { background: var(--line); border-radius: 6px; height: 8px; overflow: hidden; }
.delta-bar { display: block; height: 100%; border-radius: 6px; }
.delta-bar.up { background: #c9554f; }
.delta-bar.down { background: #7e9b6f; }
.delta-val { font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.delta-val.up { color: #c9554f; }
.delta-val.down { color: #7e9b6f; }
```

- [ ] **Step 6: 빌드/타입 확인**

Run: `cd personal-money-app && npx tsc --noEmit && npm run build`
Expected: 타입 에러 0, 빌드 성공. (`formatSignedMoney`가 App.tsx에 존재함을 확인 — buildInsights에서 사용 중)

- [ ] **Step 7: 커밋**

```bash
cd personal-money-app
git add src/App.tsx src/App.css
git commit -m "feat(insights): 장소 TOP 차트 + 카테고리 전월대비 증감 리스트"
```

---

## 통합 검증 (구현 후, 수동)

1. `cd personal-money-app && npx vercel --prod --yes`로 배포.
2. Chrome에서 앱 열고 인사이트 탭 진입.
3. 확인: "전월대비" 증감 리스트(카테고리·↑↓·%·금액·미니바, 증가 빨강/감소 초록), "장소 TOP" 가로막대. 기존 차트·카드 그대로.
4. 입력칸 placeholder가 "금액 장소 물건 결제수단"인지 확인(이전 커밋).

## Self-Review 결과
- 스펙 커버: 장소 TOP(Task 2 Step 4), 전월대비(Task 1 categoryDeltas + Task 2 Step 3), 순수함수 TDD(Task 1), 엣지(전월없음=Step 3 빈 안내, 변동0=Step 4 조건부 렌더, 빈메모=기타). 전부 매핑됨.
- placeholder 없음(모든 step에 실제 코드/명령).
- 타입 일관: `placeTotals`/`categoryDeltas`/`CategoryDelta` 명칭이 Task 1 정의 = Task 2 사용 일치.
