# 상세 카테고리 보기 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 카테고리 영역을 전체 카테고리 아이콘 리스트로 확장하고, 카테고리를 탭하면 그 카테고리의 거래 내역(소분류 소계 포함)을 하단 시트로 보여준다. 도넛은 상위 7 + 기타로 묶는다.

**Architecture:** 순수함수(`categoryIcon`, `topNWithOther`)는 TDD. 홈 리스트/도넛/상세 시트는 `App.tsx` 컴포넌트 수정 후 빌드 + Chrome 시각검증. 데이터는 기존 `summary.categoryTotals` + `mergedTransactions`에서 파생(동기화·원장병합 로직 변경 없음).

**Tech Stack:** React 19 + TS + Vite, Vitest, gh-pages.

**환경 메모:**
- 앱 저장소 `/Users/hwan/Documents/ManageMoney/personal-money-app`, 현재 `main`. 큰 변경은 아니지만 feature 브랜치 권장.
- 시각검증: 컨트롤러가 `npm run dev` 또는 배포본을 Chrome으로 확인.
- 현재 `Dashboard({ summary })`는 `summary`만 받음 → 상세 시트용으로 `transactions`(mergedTransactions) prop 추가 필요. App 렌더: `{activeTab === 'dashboard' && <Dashboard summary={summary} />}` (line ~325). App 안에 `mergedTransactions`(merged 거래) 존재.
- 기존: `RING_COLORS` const, `CategoryRing({total,subtitle,data})`(conic-gradient), `cat-rank`/`cat-rank-row`/`cat-dot` 클래스, `NameValue` 타입(={name,value}), helpers `formatMoney`/`formatPercent`/`formatDateLabel`, `X` 아이콘 import, `Transaction` 타입.

---

## File Structure
| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/dashboardLogic.ts` | `categoryIcon`, `topNWithOther` 추가 | 수정 |
| `src/dashboardLogic.test.ts` | 위 테스트 추가 | 수정 |
| `src/App.tsx` | 카테고리 리스트 확장+아이콘, 도넛 묶기, selectedCategory, CategoryDetailSheet | 수정 |
| `src/App.css` | 아이콘 원·상세 시트 스타일 | 수정 |

---

## Task C1: categoryIcon + topNWithOther 순수함수 (TDD)

**Files:** `src/dashboardLogic.ts`, `src/dashboardLogic.test.ts`

- [ ] **Step 1: 실패 테스트 추가** — `src/dashboardLogic.test.ts` 상단 import에 `categoryIcon, topNWithOther`를 추가(`import { deriveQuickChips, changeRate, categoryIcon, topNWithOther, type TxLike } from './dashboardLogic'`), 파일 끝에 추가:
```ts
describe('categoryIcon', () => {
  it('알려진 카테고리는 매핑 이모지', () => {
    expect(categoryIcon('식비')).toBe('🍚')
    expect(categoryIcon('주거/통신')).toBe('🏠')
  })
  it('미매핑/빈값은 기본 아이콘', () => {
    expect(categoryIcon('알수없음')).toBe('💸')
    expect(categoryIcon('')).toBe('💸')
  })
})

describe('topNWithOther', () => {
  const d = (name: string, value: number) => ({ name, value })
  it('n 이하면 그대로', () => {
    const data = [d('a', 3), d('b', 2)]
    expect(topNWithOther(data, 7)).toEqual(data)
  })
  it('n 초과면 상위 n + 기타(나머지 합)', () => {
    const data = [d('a', 5), d('b', 4), d('c', 3), d('d', 2), d('e', 1)]
    const res = topNWithOther(data, 3)
    expect(res.length).toBe(4)
    expect(res[3]).toEqual({ name: '기타', value: 3 })
  })
  it('나머지 합이 0이면 기타 없음', () => {
    const data = [d('a', 5), d('b', 0), d('c', 0)]
    expect(topNWithOther(data, 1)).toEqual([d('a', 5)])
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/dashboardLogic.test.ts` → FAIL (함수 없음).

- [ ] **Step 3: 구현** — `src/dashboardLogic.ts` 파일 끝에 추가:
```ts
const CATEGORY_ICON: Record<string, string> = {
  식비: '🍚',
  '주거/통신': '🏠',
  '교통/차량': '🚗',
  취미: '🎮',
  생활: '🧴',
  '문화/구독': '📺',
  건강: '💊',
  자기계발: '📘',
  수입: '💰',
  미분류: '❓',
}

/** 대분류 → 이모지. 미매핑/빈값은 기본 '💸'. */
export function categoryIcon(category: string): string {
  return CATEGORY_ICON[(category || '').trim()] || '💸'
}

export type NV = { name: string; value: number }

/** 상위 n개 + 나머지를 '기타'로 합산(합 0이면 생략). n 이하면 원본 그대로. */
export function topNWithOther(data: NV[], n: number): NV[] {
  if (data.length <= n) return data
  const top = data.slice(0, n)
  const otherValue = data.slice(n).reduce((s, d) => s + d.value, 0)
  return otherValue > 0 ? [...top, { name: '기타', value: otherValue }] : top
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/dashboardLogic.test.ts` → 통과. 이어 `npm test` 전체 통과.

- [ ] **Step 5: Commit** —
```bash
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "feat: categoryIcon + topNWithOther 순수함수 (TDD)"
```

---

## Task C2: 홈 카테고리 리스트 전체+아이콘 + 도넛 묶기 + transactions prop

**Files:** `src/App.tsx`, `src/App.css`

- [ ] **Step 1: import 추가** — App.tsx의 `./dashboardLogic` import에 `categoryIcon, topNWithOther` 추가(예: `import { deriveQuickChips, changeRate, categoryIcon, topNWithOther, type QuickChip } from './dashboardLogic'`).

- [ ] **Step 2: Dashboard에 transactions prop + selectedCategory state** — `function Dashboard({ summary }: { summary: Summary })`를 다음으로 교체(시그니처 + 상단):
```tsx
function Dashboard({ summary, transactions }: { summary: Summary; transactions: Transaction[] }) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const prev = summary.previousMonth?.realSpend ?? 0
  const rate = changeRate(summary.thisMonth.realSpend, prev)
  const ringSubtitle = rate === null ? null : `전월 대비 ${rate >= 0 ? '+' : '−'}${Math.abs(Math.round(rate * 100))}%`
```

- [ ] **Step 3: 도넛 묶기 + 전체 아이콘 리스트** — Dashboard 반환의 `ring-card` 내부를 교체:
```tsx
      <article className="ring-card">
        <CategoryRing
          total={formatMoney(summary.thisMonth.realSpend)}
          subtitle={ringSubtitle}
          data={topNWithOther(summary.categoryTotals, 7)}
        />
        <div className="cat-rank">
          {summary.categoryTotals.map((c, i) => (
            <button
              type="button"
              className="cat-rank-row"
              key={c.name}
              onClick={() => setSelectedCategory(c.name)}
            >
              <span className="cat-ic" style={{ background: RING_COLORS[i % RING_COLORS.length] }}>
                {categoryIcon(c.name)}
              </span>
              <span className="cat-name">{c.name}</span>
              <span className="cat-amt">{formatMoney(c.value)}</span>
              <span className="cat-pct">
                {formatPercent(summary.thisMonth.totalSpend ? c.value / summary.thisMonth.totalSpend : 0)}
              </span>
            </button>
          ))}
        </div>
      </article>
```
(리스트는 `summary.categoryTotals` 전체. 도넛만 topNWithOther(…,7).)

- [ ] **Step 4: 상세 시트 렌더(자리만, 컴포넌트는 C3에서)** — Dashboard 반환의 닫는 `</section>` 직전에 추가:
```tsx
      {selectedCategory && (
        <CategoryDetailSheet
          category={selectedCategory}
          transactions={transactions.filter((t) => t.category === selectedCategory)}
          onClose={() => setSelectedCategory(null)}
        />
      )}
```

- [ ] **Step 5: App 렌더에서 transactions 전달** — `{activeTab === 'dashboard' && <Dashboard summary={summary} />}`를 다음으로:
```tsx
      {activeTab === 'dashboard' && <Dashboard summary={summary} transactions={mergedTransactions} />}
```

- [ ] **Step 6: 아이콘 원 CSS** — `src/App.css`의 `.cat-rank-row`/`.cat-dot` 관련을 보완(버튼화 + 아이콘 원). 기존 `.cat-rank-row`가 div 기준이면 button 리셋 포함:
```css
.cat-rank-row { display: flex; align-items: center; gap: 10px; padding: 8px 2px; width: 100%; background: none; border: none; text-align: left; cursor: pointer; }
.cat-ic { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 14px; flex: 0 0 auto; }
.cat-name { flex: 1; color: var(--ink); font-size: 13px; font-weight: 600; }
.cat-amt { color: var(--muted); font-size: 12px; }
.cat-pct { color: var(--muted); font-size: 11px; width: 40px; text-align: right; }
```
(기존 `.cat-dot` 규칙은 더 이상 안 쓰면 제거.)

- [ ] **Step 7: 빌드** — Run: `npm run build` → C3의 `CategoryDetailSheet`가 아직 없으면 타입 에러가 난다. **C2와 C3는 한 커밋 흐름으로 진행**: 이 단계에서 빌드가 `CategoryDetailSheet` 미정의로 실패하면 정상 — 바로 C3로 이어가 정의한 뒤 함께 빌드/커밋한다. (또는 C3를 먼저 정의해도 됨.) 빌드가 그 외 이유로 실패하면 수정.

- [ ] **Step 8: (C3 완료 후) 커밋** — C3에서 함께.

---

## Task C3: CategoryDetailSheet 컴포넌트 + 탭 상세

**Files:** `src/App.tsx`, `src/App.css`

- [ ] **Step 1: CategoryDetailSheet 추가** — App.tsx에 (예: `Dashboard` 위/아래 적당한 곳) 컴포넌트 추가:
```tsx
function CategoryDetailSheet({ category, transactions, onClose }: { category: string; transactions: Transaction[]; onClose: () => void }) {
  const total = transactions.reduce((s, t) => s + t.amount, 0)
  const subMap = new Map<string, number>()
  for (const t of transactions) {
    const k = t.subCategory || '기타'
    subMap.set(k, (subMap.get(k) || 0) + t.amount)
  }
  const subs = [...subMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const rows = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="cat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cat-sheet-head">
          <span className="cat-ic-lg">{categoryIcon(category)}</span>
          <div className="cat-sheet-title">
            <h3>{category}</h3>
            <p>{formatMoney(total)} · {transactions.length}건</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        {subs.length > 0 && (
          <div className="cat-sub-list">
            {subs.map((s) => (
              <div className="cat-sub-row" key={s.name}>
                <span>{s.name}</span>
                <span>{formatMoney(s.value)}</span>
              </div>
            ))}
          </div>
        )}
        <div className="cat-tx-list">
          {rows.length === 0 && <p className="cat-empty">거래가 없습니다.</p>}
          {rows.map((t) => (
            <div className="cat-tx-row" key={t.id}>
              <div>
                <p className="row-title">{t.memo}</p>
                <p className="row-meta">{formatDateLabel(t.date)} · {t.subCategory || '미지정'} · {t.payment || '미지정'}</p>
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
(`X` 아이콘, `formatMoney`, `formatDateLabel`은 이미 import/정의됨. `Transaction` 타입 사용.)

- [ ] **Step 2: 상세 시트 CSS** — `src/App.css`에 추가:
```css
.sheet-backdrop { position: fixed; inset: 0; background: rgba(53, 43, 31, 0.38); z-index: 50; display: flex; align-items: flex-end; }
.cat-sheet { background: var(--bg); width: 100%; max-height: 78vh; border-radius: 20px 20px 0 0; padding: 16px 16px calc(20px + env(safe-area-inset-bottom)); overflow-y: auto; box-shadow: 0 -10px 30px rgba(120,90,50,.18); }
.cat-sheet-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.cat-ic-lg { width: 40px; height: 40px; border-radius: 50%; background: var(--accent-tan-soft); display: flex; align-items: center; justify-content: center; font-size: 20px; flex: 0 0 auto; }
.cat-sheet-title { flex: 1; }
.cat-sheet-title h3 { color: var(--ink); font-size: 16px; font-weight: 800; }
.cat-sheet-title p { color: var(--muted); font-size: 12px; }
.cat-sub-list { background: var(--surface-solid); border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; margin-bottom: 12px; }
.cat-sub-row { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink); padding: 4px 0; }
.cat-tx-list { display: flex; flex-direction: column; gap: 8px; }
.cat-tx-row { display: flex; justify-content: space-between; align-items: center; background: var(--surface-solid); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
.cat-tx-amt { color: var(--ink); font-weight: 700; font-size: 13px; }
.cat-empty { color: var(--muted); font-size: 13px; text-align: center; padding: 16px; }
```

- [ ] **Step 3: 빌드 + 테스트** — Run: `npm run build` (클린) 및 `npm test` (C1 추가분 포함 통과).

- [ ] **Step 4: Commit (C2 + C3 함께)** —
```bash
git add src/App.tsx src/App.css
git commit -m "feat: 홈 카테고리 전체 아이콘 리스트 + 탭하면 카테고리 상세 시트"
```

---

## Task C4: 배포 + 시각검증

**Files:** 없음

- [ ] **Step 1: 머지 + 배포** — feature 브랜치면 main 머지 후 `npm run deploy` (sandbox off) → `Published`.
- [ ] **Step 2: 전파 확인** — `curl -s https://kanghwani.github.io/personal-money-app/index.html | grep -oE 'assets/index-[^"]+\.js'`가 새 빌드 해시와 일치.
- [ ] **Step 3: Chrome 검증** — 배포본 열기(SW 캐시 정리 후). 확인: ① 홈에 전체 카테고리가 아이콘 원과 함께 나열 ② 도넛은 상위 7 + 기타 ③ 카테고리 탭 → 하단 시트에 소분류 소계 + 거래 목록 ④ 닫기/백드롭 동작 ⑤ 코지 테마 일관.
- [ ] **Step 4: 데이터 안전** — 검증 후 필요 시 서버 store 비움(이전과 동일).

---

## 검증 기준
- [ ] `npm test` 통과(categoryIcon/topNWithOther 포함), `npm run build` 클린
- [ ] 홈: 전체 카테고리 아이콘 리스트 + 도넛 상위7+기타
- [ ] 카테고리 탭 → 상세 시트(소분류 소계 + 거래 목록), 닫기 동작
- [ ] 배포 후 실제 동작 확인
