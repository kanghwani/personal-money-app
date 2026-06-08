# 달력형 입력 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원장 탭에 목록↔달력 토글을 추가해, 월 그리드에서 날짜별 실지출(히트맵)을 보고 날짜를 탭하면 하단 시트에서 그날 거래를 보고 그 날짜로 입력(빠른칩+자연어)한다.

**Architecture:** `dailyTotals`는 순수함수(TDD). 달력/시트는 `App.tsx` 컴포넌트(CalendarView, DayDetailSheet) + `Ledger` 토글로 구현. 입력은 App이 제공하는 날짜 인지 핸들러로 setStore에 추가(동기화). 데이터는 `mergedTransactions`에서 파생.

**Tech Stack:** React 19 + TS + Vite, Vitest, gh-pages.

**환경 메모:**
- 앱 저장소 `/Users/hwan/Documents/ManageMoney/personal-money-app`, 현재 `main`. feature 브랜치 권장.
- 시각검증: 컨트롤러가 `npm run dev` 또는 배포본을 Chrome으로 확인.
- 기존 코드 사실: `Ledger({ transactions, onDelete })`(line ~491, 렌더 line ~326 `<Ledger transactions={mergedTransactions} onDelete={deleteTransaction} />`). App에 `applyQuickInput(raw)`, `logQuickChip(chip)`(todayIso 사용), `deriveQuickChips`로 만든 `quickChips`, `mergedTransactions`, `setStore`, `setLastMessage` 존재. helpers `parseQuickEntry`, `resultLabel`, `uid`, `todayIso`, `formatDateLabel`, `formatMoney`, `compactMoney`, `fixedTypeLabel`. 아이콘 `Send`, `X`, `Trash2` import됨. `Transaction` 타입(필드 포함 `split`). `QuickChip` 타입(dashboardLogic).
- 카테고리 상세 시트에서 쓴 `.sheet-backdrop`/`.cat-sheet`/`.cat-sheet-head`/`.cat-sheet-title`/`.cat-tx-list`/`.cat-tx-row`/`.cat-tx-amt`/`.cat-empty` 및 `.quick-chips`/`.quick-chip`/`.send-button` 스타일 재사용 가능.
- 앱 런타임(브라우저)에서 `new Date(...)`는 정상(워크플로 스크립트 제약과 무관).

---

## File Structure
| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/dashboardLogic.ts` | `dailyTotals` 추가 | 수정 |
| `src/dashboardLogic.test.ts` | dailyTotals 테스트 | 수정 |
| `src/App.tsx` | 날짜 인지 핸들러, Ledger 토글, CalendarView/DayDetailSheet | 수정 |
| `src/App.css` | 달력 그리드·히트맵·세그먼트 스타일 | 수정 |

---

## Task D1: dailyTotals 순수함수 (TDD)

**Files:** `src/dashboardLogic.ts`, `src/dashboardLogic.test.ts`

- [ ] **Step 1: 실패 테스트 추가** — `src/dashboardLogic.test.ts` 상단 import에 `dailyTotals` 추가(`import { ..., categoryIcon, topNWithOther, dailyTotals, type TxLike } from './dashboardLogic'`), 파일 끝에:
```ts
describe('dailyTotals', () => {
  const dt = (date: string, amount: number, split = 0, type = 'expense') => ({ date, amount, split, type })
  it('같은 달 같은 날 실지출(amount-split) 합산', () => {
    const txns = [dt('2026-06-03', 5000), dt('2026-06-03', 3000, 500)]
    expect(dailyTotals(txns, '2026-06')).toEqual({ 3: 7500 })
  })
  it('수입 제외', () => {
    const txns = [dt('2026-06-03', 5000), dt('2026-06-03', 1000000, 0, 'income')]
    expect(dailyTotals(txns, '2026-06')).toEqual({ 3: 5000 })
  })
  it('다른 달 제외', () => {
    const txns = [dt('2026-06-03', 5000), dt('2026-05-03', 9000)]
    expect(dailyTotals(txns, '2026-06')).toEqual({ 3: 5000 })
  })
  it('빈 입력 → {}', () => {
    expect(dailyTotals([], '2026-06')).toEqual({})
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/dashboardLogic.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/dashboardLogic.ts` 파일 끝에:
```ts
type DayTxLike = { date: string; type: string; amount: number; split: number }

/** 해당 월(yyyy-MM)의 지출을 날짜(일)별 실지출(amount-split)로 합산. 수입/타월 제외. */
export function dailyTotals(transactions: DayTxLike[], yearMonth: string): Record<number, number> {
  const out: Record<number, number> = {}
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    if (t.date.slice(0, 7) !== yearMonth) continue
    const day = Number(t.date.slice(8, 10))
    if (!day) continue
    out[day] = (out[day] || 0) + (t.amount - (t.split || 0))
  }
  return out
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/dashboardLogic.test.ts` → 통과. 이어 `npm test` 전체 통과.

- [ ] **Step 5: Commit** —
```bash
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "feat: dailyTotals 일별 실지출 합산 순수함수 (TDD)"
```

---

## Task D2: 달력 입력 전체 (핸들러 + Ledger 토글 + CalendarView + DayDetailSheet + CSS)

**Files:** `src/App.tsx`, `src/App.css`
UI/상태 작업 → 빌드 + Chrome 시각검증. (상호의존이라 한 태스크.)

- [ ] **Step 1: import** — App.tsx의 `./dashboardLogic` import에 `dailyTotals` 추가.

- [ ] **Step 2: App에 날짜 인지 핸들러 추가 + logQuickChip 일반화** — `logQuickChip` 함수를 찾아 아래로 교체(날짜 인자화 + 오늘 기본):
```tsx
  function logQuickChipForDate(chip: QuickChip, date: string) {
    const t: Transaction = {
      id: uid(), date, type: 'expense', amount: chip.amount,
      memo: chip.label, category: chip.category, subCategory: chip.subCategory,
      payment: chip.payment, fixedType: chip.fixedType, split: 0, raw: `${chip.label} ${chip.amount}`,
    }
    setStore((cur) => ({ ...cur, transactions: [t, ...cur.transactions] }))
    setUndoTx(t)
    setLastMessage(`${chip.label} ${formatMoney(chip.amount)} 기록`)
  }
  function logQuickChip(chip: QuickChip) {
    logQuickChipForDate(chip, todayIso())
  }
  function quickAddForDate(raw: string, date: string) {
    const parsed = parseQuickEntry(raw)
    if (parsed.kind === 'error') { setLastMessage(parsed.message); return }
    if (parsed.kind === 'transaction') {
      const t = { ...parsed.transaction, date }
      setStore((cur) => ({ ...cur, transactions: [t, ...cur.transactions] }))
      setLastMessage(resultLabel(parsed))
      return
    }
    applyQuickInput(raw)
  }
```
(기존 하단 dock의 `onClick={() => logQuickChip(c)}`는 그대로 유지됨.)

- [ ] **Step 3: Ledger 렌더에 props 전달** — `<Ledger transactions={mergedTransactions} onDelete={deleteTransaction} />`를 다음으로:
```tsx
      {activeTab === 'ledger' && (
        <Ledger
          transactions={mergedTransactions}
          onDelete={deleteTransaction}
          quickChips={quickChips}
          onQuickAddForDate={quickAddForDate}
          onChipAddForDate={logQuickChipForDate}
        />
      )}
```

- [ ] **Step 4: Ledger 컴포넌트 교체** — 기존 `function Ledger({ transactions, onDelete }) { ... }` 전체를 아래로 교체:
```tsx
function Ledger({
  transactions,
  onDelete,
  quickChips,
  onQuickAddForDate,
  onChipAddForDate,
}: {
  transactions: Transaction[]
  onDelete: (id: string) => void
  quickChips: QuickChip[]
  onQuickAddForDate: (raw: string, date: string) => void
  onChipAddForDate: (chip: QuickChip, date: string) => void
}) {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [filter, setFilter] = useState<'all' | TransactionType>('all')
  const now = new Date()
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const filtered = transactions.filter((item) => filter === 'all' || item.type === filter)
  const yearMonth = `${ym.year}-${String(ym.month).padStart(2, '0')}`
  const totals = dailyTotals(transactions, yearMonth)
  const prevMonth = () => setYm((s) => (s.month === 1 ? { year: s.year - 1, month: 12 } : { ...s, month: s.month - 1 }))
  const nextMonth = () => setYm((s) => (s.month === 12 ? { year: s.year + 1, month: 1 } : { ...s, month: s.month + 1 }))

  return (
    <section className="view-stack">
      <div className="segmented">
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>목록</button>
        <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>달력</button>
      </div>

      {view === 'list' && (
        <>
          <div className="segmented">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button>
            <button type="button" className={filter === 'expense' ? 'active' : ''} onClick={() => setFilter('expense')}>지출</button>
            <button type="button" className={filter === 'income' ? 'active' : ''} onClick={() => setFilter('income')}>수입</button>
          </div>
          <section className="ledger-table">
            {filtered.map((transaction) => (
              <article className="ledger-row" key={transaction.id}>
                <div>
                  <p className="row-title">{transaction.memo}</p>
                  <p className="row-meta">
                    {formatDateLabel(transaction.date)} · {transaction.category} · {transaction.payment || '미지정'} · {fixedTypeLabel(transaction.fixedType)}
                  </p>
                </div>
                <div className="row-actions">
                  <strong className={transaction.type === 'income' ? 'income' : ''}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}</strong>
                  <button type="button" aria-label="삭제" onClick={() => onDelete(transaction.id)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </section>
        </>
      )}

      {view === 'calendar' && (
        <CalendarView
          year={ym.year}
          month={ym.month}
          totals={totals}
          onPrev={prevMonth}
          onNext={nextMonth}
          onSelectDay={setSelectedDate}
          today={todayIso()}
        />
      )}

      {selectedDate && (
        <DayDetailSheet
          date={selectedDate}
          transactions={transactions.filter((t) => t.date === selectedDate)}
          quickChips={quickChips}
          onClose={() => setSelectedDate(null)}
          onQuickAdd={(raw) => onQuickAddForDate(raw, selectedDate)}
          onChipAdd={(chip) => onChipAddForDate(chip, selectedDate)}
        />
      )}
    </section>
  )
}
```

- [ ] **Step 5: CalendarView 컴포넌트 추가** — Ledger 근처에:
```tsx
function CalendarView({ year, month, totals, onPrev, onNext, onSelectDay, today }: {
  year: number
  month: number
  totals: Record<number, number>
  onPrev: () => void
  onNext: () => void
  onSelectDay: (iso: string) => void
  today: string
}) {
  const firstDay = new Date(year, month - 1, 1).getDay()
  const daysInMonth = new Date(year, month, 0).getDate()
  const maxTotal = Math.max(1, ...Object.values(totals))
  const pad = (n: number) => String(n).padStart(2, '0')
  const cells: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" onClick={onPrev} aria-label="이전 달">‹</button>
        <span>{year}.{month}</span>
        <button type="button" onClick={onNext} aria-label="다음 달">›</button>
      </div>
      <div className="cal-weekdays">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="cal-grid">
        {cells.map((d, i) => {
          if (d === null) return <div className="cal-cell empty" key={`e${i}`} />
          const iso = `${year}-${pad(month)}-${pad(d)}`
          const amt = totals[d] || 0
          const alpha = amt > 0 ? 0.12 + 0.5 * (amt / maxTotal) : 0
          return (
            <button
              type="button"
              key={iso}
              className={`cal-cell${iso === today ? ' today' : ''}`}
              style={amt > 0 ? { background: `rgba(201,121,79,${alpha.toFixed(3)})` } : undefined}
              onClick={() => onSelectDay(iso)}
            >
              <span className="cal-day">{d}</span>
              {amt > 0 && <span className="cal-amt">{compactMoney(amt)}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: DayDetailSheet 컴포넌트 추가** — Ledger 근처에:
```tsx
function DayDetailSheet({ date, transactions, quickChips, onClose, onQuickAdd, onChipAdd }: {
  date: string
  transactions: Transaction[]
  quickChips: QuickChip[]
  onClose: () => void
  onQuickAdd: (raw: string) => void
  onChipAdd: (chip: QuickChip) => void
}) {
  const [draft, setDraft] = useState('')
  const total = transactions.reduce((s, t) => s + (t.type === 'expense' ? t.amount - t.split : 0), 0)
  const submit = () => {
    const v = draft.trim()
    if (!v) return
    onQuickAdd(v)
    setDraft('')
  }
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="cat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cat-sheet-head">
          <div className="cat-sheet-title">
            <h3>{formatDateLabel(date)}</h3>
            <p>{formatMoney(total)} · {transactions.length}건</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="day-input">
          {quickChips.length > 0 && (
            <div className="quick-chips">
              {quickChips.map((c) => (
                <button key={c.key} type="button" className="quick-chip" onClick={() => onChipAdd(c)}>
                  <span>{c.emoji}</span>{c.label}
                </button>
              ))}
            </div>
          )}
          <div className="day-field">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
              placeholder="점심 9000 카드"
            />
            <button type="button" className="send-button" onClick={submit} aria-label="입력"><Send size={18} /></button>
          </div>
        </div>
        <div className="cat-tx-list">
          {transactions.length === 0 && <p className="cat-empty">거래가 없습니다. 위에서 추가하세요.</p>}
          {transactions.map((t) => (
            <div className="cat-tx-row" key={t.id}>
              <div>
                <p className="row-title">{t.memo}</p>
                <p className="row-meta">{t.category} · {t.subCategory || '미지정'} · {t.payment || '미지정'}</p>
              </div>
              <span className="cat-tx-amt">{formatMoney(t.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: CSS** — `src/App.css`에 달력 스타일 추가:
```css
.cal-head { display: flex; align-items: center; justify-content: center; gap: 20px; margin: 4px 0 12px; }
.cal-head span { color: var(--ink); font-weight: 800; font-size: 15px; min-width: 80px; text-align: center; }
.cal-head button { background: none; border: none; color: var(--accent-tan); font-size: 22px; cursor: pointer; padding: 0 8px; }
.cal-weekdays { display: grid; grid-template-columns: repeat(7, 1fr); margin-bottom: 6px; }
.cal-weekdays span { text-align: center; color: var(--muted); font-size: 11px; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; }
.cal-cell { aspect-ratio: 1 / 1; border: 1px solid var(--line); border-radius: 10px; background: var(--surface-solid); display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 5px 2px; cursor: pointer; overflow: hidden; }
.cal-cell.empty { border: none; background: none; cursor: default; }
.cal-cell.today { border: 2px solid var(--accent-tan); }
.cal-day { color: var(--ink); font-size: 12px; font-weight: 600; }
.cal-amt { color: var(--ink); font-size: 9px; margin-top: auto; opacity: .85; }
.day-input { margin-bottom: 12px; }
.day-field { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.day-field input { flex: 1; background: var(--surface-solid); border: 1.5px solid var(--accent-tan); border-radius: 14px; padding: 10px 12px; color: var(--ink); font-size: 13px; }
```

- [ ] **Step 8: 빌드 + 테스트** — Run: `npm run build` (클린) 및 `npm test` (D1 포함 통과).

- [ ] **Step 9: Commit** —
```bash
git add src/App.tsx src/App.css
git commit -m "feat: 원장 달력 보기 + 날짜별 입력(빠른칩/자연어) 시트"
```

---

## Task D3: 배포 + 시각검증

**Files:** 없음

- [ ] **Step 1: 머지 + 배포** — feature 브랜치면 main 머지 후 `npm run deploy`(sandbox off) → `Published`.
- [ ] **Step 2: 전파 확인** — `curl -s https://kanghwani.github.io/personal-money-app/index.html | grep -oE 'assets/index-[^"]+\.js'`가 새 빌드 해시와 일치.
- [ ] **Step 3: Chrome 검증** — 배포본(SW 캐시 정리 후): ① 원장 탭 목록↔달력 토글 ② 달력 일별 금액·히트맵·이전/다음 달 ③ 오늘 강조 ④ 날짜 탭→시트 그날 거래 ⑤ 시트에서 빠른칩 탭/자연어 입력 → 그 날짜로 추가되고 달력·원장에 반영.
- [ ] **Step 4: 데이터 안전** — 검증 후 서버 store 비움(이전과 동일).

---

## 검증 기준
- [ ] `npm test` 통과(dailyTotals 포함), `npm run build` 클린
- [ ] 원장: 목록/달력 토글, 달력 일별 실지출 히트맵, 월 이동, 오늘 강조
- [ ] 날짜 탭 → 시트(그날 거래 + 빠른칩/자연어 입력), 입력이 그 날짜로 기록·반영
- [ ] 배포 후 실제 동작 확인
