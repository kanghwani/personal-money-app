# UX 개편 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가계부 앱을 코지 베이지(라이트) 테마 + 카테고리-링 중심 홈 + 하단 고정 스마트 입력바(원탭 즉시기록·자동학습 칩)로 개편하고, 월별 흐름을 인사이트 탭으로 옮긴다.

**Architecture:** 테마는 `src/index.css`의 `:root` CSS 변수 교체가 핵심(차트·버튼·칩이 변수 참조). 빠른칩 산출·전월대비는 순수함수(TDD). 홈/입력/인사이트는 `App.tsx` 컴포넌트 재구성 후 빌드 + Chrome 시각검증.

**Tech Stack:** React 19 + TS + Vite, Vitest, recharts, gh-pages. Apps Script(clasp)는 이번 개편과 무관(건드리지 않음).

**환경 메모:**
- 앱 저장소 `/Users/hwan/Documents/ManageMoney/personal-money-app`. 큰 개편이므로 **feature 브랜치**에서 작업(실행 시 생성).
- 시각검증은 Claude in Chrome으로 `https://kanghwani.github.io/personal-money-app/`(배포 후) 또는 로컬 `npm run dev`. 배포 명령은 `dangerouslyDisableSandbox: true`.
- 동기화 store는 비워둠(서버). 테스트 브라우저가 seed 업로드하지 않도록 검증 후 필요 시 비움.
- `summary`는 이미 원장 병합 거래 기반. `mergedTransactions`(App 내)도 사용 가능.

---

## File Structure

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/index.css` | `:root` 팔레트 변수 → 코지 베이지(라이트) + 라이트 보정 | 수정 |
| `src/App.css` | 신규/변경 컴포넌트 스타일(링·순위·고정변동·하단바) | 수정 |
| `src/dashboardLogic.ts` | `deriveQuickChips`, `QuickChip`, `changeRate` 순수함수 | 신규 |
| `src/dashboardLogic.test.ts` | 위 단위테스트 | 신규 |
| `src/App.tsx` | Dashboard 재구성, 하단 입력바 신설, 월별흐름 인사이트 이동, 빠른칩 연결 | 수정 |
| `index.html`, `public/manifest.json` | 라이트 테마 메타(theme/background color, status-bar) | 수정 |

---

## Task R1: 코지 베이지 테마 (CSS 변수 교체 + 라이트 보정 + PWA 메타)

**Files:** `src/index.css`, `public/manifest.json`, `index.html`

UI 작업 → TDD 아님. 구현 후 `npm run build` + Chrome 시각검증.

- [ ] **Step 1: `:root` 팔레트 교체** — `src/index.css`의 `:root` 변수들을 아래 값으로 교체(변수명은 유지, 값만):
```css
  --bg: #f1e9db;                 /* 크림 배경 */
  --surface: rgba(251, 247, 239, 0.72);
  --surface-solid: #fbf7ef;      /* 카드 */
  --ink: #352b1f;                /* 진한 브라운 텍스트 */
  --muted: #8a7a64;              /* 보조 텍스트 */
  --line: rgba(120, 90, 50, 0.16);
  --accent-tan: #c9794f;         /* 주 액센트: 테라코타 */
  --accent-tan-soft: rgba(201, 121, 79, 0.12);
  --green: #7e9b6f;              /* 세이지(수입/긍정) */
  --green-soft: rgba(126, 155, 111, 0.14);
  --danger: #c0573f;             /* 따뜻한 레드(지출/경고) */
  --danger-soft: rgba(192, 87, 63, 0.12);
  --blue: #5a7d8f;               /* 차분한 블루 */
  --blue-soft: rgba(90, 125, 143, 0.12);
  --amber: #d6a85e;              /* 골드 */
  --amber-soft: rgba(214, 168, 94, 0.14);
  --soft-shadow: 0 10px 28px rgba(150, 120, 70, 0.14), 0 3px 10px rgba(150, 120, 70, 0.08);
```

- [ ] **Step 2: 라이트 보정 스캔** — `src/index.css`와 `src/App.css`에서 다크 전용 하드코딩을 찾아 변수/라이트값으로 교체. 점검 명령:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
grep -nE "#0a120e|#090e0c|#121f18|#13201a|rgba\(0, 0, 0|#fff\b|white" src/index.css src/App.css
```
찾은 항목 중 배경/텍스트/보더가 다크 전제인 곳을 `var(--bg/--surface-solid/--ink/--line)`으로 교체. 특히 recharts Tooltip의 하드코딩 `contentStyle={{ backgroundColor: '#121f18' ... }}`는 App.tsx에 있으니 R5/R4에서 함께 손봄(여기선 CSS만).

- [ ] **Step 3: PWA 메타 라이트화** — `public/manifest.json`의 색 변경:
```json
  "background_color": "#f1e9db",
  "theme_color": "#f1e9db",
```
`index.html`의 status-bar 메타 변경(라이트 배경엔 어두운 글자):
```html
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
```

- [ ] **Step 4: 빌드 + 기존 테스트** — Run: `npm run build` (성공) 그리고 `npm test` (20 통과, 회귀 없음).

- [ ] **Step 5: 로컬 시각 점검** — `npm run dev` 후 Chrome으로 열어 전체 톤이 크림/테라코타로 바뀌고 글자가 읽히는지 확인(컨트롤러가 스크린샷). 깨지는 곳(흰 글자가 흰 배경 등) 있으면 보정.

- [ ] **Step 6: Commit** —
```bash
git add src/index.css src/App.css public/manifest.json index.html
git commit -m "feat: 코지 베이지 라이트 테마 적용 (CSS 변수 + PWA 메타)"
```

---

## Task R2: 빠른칩 산출 + 전월대비 순수함수 (TDD)

**Files:** `src/dashboardLogic.ts`, `src/dashboardLogic.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — `src/dashboardLogic.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { deriveQuickChips, changeRate, type TxLike } from './dashboardLogic'

const tx = (date: string, amount: number, category: string, subCategory: string, payment: string): TxLike =>
  ({ date, type: 'expense', amount, category, subCategory, payment, fixedType: 'variable' })

describe('changeRate', () => {
  it('이전이 0/없으면 null', () => {
    expect(changeRate(100, 0)).toBeNull()
  })
  it('증가율 계산', () => {
    expect(changeRate(112, 100)).toBeCloseTo(0.12)
  })
  it('감소율 계산', () => {
    expect(changeRate(80, 100)).toBeCloseTo(-0.2)
  })
})

describe('deriveQuickChips', () => {
  it('지출 없으면 빈 배열', () => {
    expect(deriveQuickChips([], 4)).toEqual([])
  })

  it('소분류별로 묶고 빈도순 상위 N', () => {
    const txns = [
      tx('2026-06-01', 5000, '식비', '카페', '카드'),
      tx('2026-06-02', 4000, '식비', '카페', '카드'),
      tx('2026-06-03', 9000, '식비', '외식', '카드'),
      tx('2026-06-04', 3000, '교통/차량', '이동', '카드'),
    ]
    const chips = deriveQuickChips(txns, 2)
    expect(chips.length).toBe(2)
    expect(chips[0].label).toBe('카페') // 빈도 2로 1위
  })

  it('기본 금액·결제수단은 그룹의 최신 거래에서', () => {
    const txns = [
      tx('2026-06-01', 5000, '식비', '카페', '카드'),
      tx('2026-06-05', 4500, '식비', '카페', '토스'), // 최신
    ]
    const [chip] = deriveQuickChips(txns, 4)
    expect(chip.amount).toBe(4500)
    expect(chip.payment).toBe('토스')
    expect(chip.category).toBe('식비')
    expect(chip.subCategory).toBe('카페')
  })

  it('알려진 키워드는 이모지 매핑', () => {
    const [chip] = deriveQuickChips([tx('2026-06-01', 5000, '식비', '카페', '카드')], 4)
    expect(chip.emoji).toBe('☕')
  })

  it('수입은 제외', () => {
    const income: TxLike = { date: '2026-06-01', type: 'income', amount: 3000000, category: '수입', subCategory: '급여', payment: '계좌', fixedType: 'fixed' }
    expect(deriveQuickChips([income], 4)).toEqual([])
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/dashboardLogic.test.ts` → FAIL(모듈 없음).

- [ ] **Step 3: 구현** — `src/dashboardLogic.ts`:
```ts
export type TxLike = {
  date: string
  type: string
  amount: number
  category: string
  subCategory: string
  payment: string
  fixedType: string
}

export type QuickChip = {
  key: string
  emoji: string
  label: string
  amount: number
  category: string
  subCategory: string
  payment: string
  fixedType: 'fixed' | 'variable'
}

/** 전월 대비 증감률. 이전이 0/falsy면 null. */
export function changeRate(current: number, previous: number): number | null {
  if (!previous) return null
  return (current - previous) / previous
}

const EMOJI: Record<string, string> = {
  카페: '☕', 외식: '🍚', 장보기: '🛒', 이동: '🚕', 차량: '🚗',
  게임: '🎮', 구독: '📺', 관리: '💊', 교육: '📘', 생활잡화: '🧴',
}

/** 최근 지출에서 소분류(없으면 대분류)별 빈도 상위 N개를 빠른칩으로. 기본값은 그룹의 최신 거래. */
export function deriveQuickChips(transactions: TxLike[], limit: number): QuickChip[] {
  const groups = new Map<string, TxLike[]>()
  for (const t of transactions) {
    if (t.type !== 'expense') continue
    const key = (t.subCategory || t.category || '기타').trim()
    const arr = groups.get(key)
    if (arr) arr.push(t)
    else groups.set(key, [t])
  }
  return [...groups.entries()]
    .map(([key, arr]) => {
      const latest = arr.reduce((a, b) => (a.date >= b.date ? a : b))
      const chip: QuickChip = {
        key,
        emoji: EMOJI[key] || '💰',
        label: key,
        amount: latest.amount,
        category: latest.category,
        subCategory: latest.subCategory,
        payment: latest.payment,
        fixedType: latest.fixedType === 'fixed' ? 'fixed' : 'variable',
      }
      return { count: arr.length, chip }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((x) => x.chip)
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/dashboardLogic.test.ts` → 통과. 이어서 `npm test` 전체 통과.

- [ ] **Step 5: Commit** —
```bash
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "feat: deriveQuickChips + changeRate 순수함수 (TDD)"
```

---

## Task R3: 하단 고정 스마트 입력바 + 원탭 즉시기록/되돌리기

**Files:** `src/App.tsx`, `src/App.css`

UI/상태 작업 → 빌드 + Chrome 시각검증.

- [ ] **Step 1: import + 빠른칩 계산** — App.tsx 상단에 `import { deriveQuickChips, type QuickChip } from './dashboardLogic'` 추가. `App()` 안에서 `mergedTransactions` 다음에:
```ts
  const quickChips = useMemo(() => deriveQuickChips(mergedTransactions, 4), [mergedTransactions])
  const [undoTx, setUndoTx] = useState<Transaction | null>(null)
```

- [ ] **Step 2: 원탭 기록 + 되돌리기 핸들러** — `applyQuickInput` 근처에 추가:
```ts
  function logQuickChip(chip: QuickChip) {
    const t: Transaction = {
      id: uid(), date: todayIso(), type: 'expense', amount: chip.amount,
      memo: chip.label, category: chip.category, subCategory: chip.subCategory,
      payment: chip.payment, fixedType: chip.fixedType, split: 0, raw: `${chip.label} ${chip.amount}`,
    }
    setStore((cur) => ({ ...cur, transactions: [t, ...cur.transactions] }))
    setUndoTx(t)
    setLastMessage(`${chip.label} ${formatMoney(chip.amount)} 기록`)
  }
  function undoLastChip() {
    if (!undoTx) return
    setStore((cur) => ({ ...cur, transactions: cur.transactions.filter((x) => x.id !== undoTx.id) }))
    setUndoTx(null)
  }
```
(자동 5초 후 토스트 닫힘은 `useEffect`로: `undoTx` 변하면 `setTimeout(()=>setUndoTx(null),5000)` + cleanup.)

- [ ] **Step 3: 상단 QuickEntry 제거 → 하단 바로 이동** — render에서 `<QuickEntry .../>` 줄을 삭제하고, `<nav className="tab-bar">` **위**(탭바와 함께 화면 하단에 고정)에 새 입력바 마크업 삽입:
```tsx
      <div className="bottom-dock">
        {undoTx && (
          <div className="undo-toast">
            <span>{undoTx.memo} {formatMoney(undoTx.amount)} 기록됨</span>
            <button type="button" onClick={undoLastChip}>되돌리기</button>
          </div>
        )}
        <div className="quick-chips">
          {quickChips.map((c) => (
            <button key={c.key} type="button" className="quick-chip" onClick={() => logQuickChip(c)}>
              <span>{c.emoji}</span>{c.label}
            </button>
          ))}
        </div>
        <QuickEntry onSubmit={applyQuickInput} lastMessage={lastMessage} />
      </div>
```
`QuickEntry` 컴포넌트 자체는 재사용(자연어 입력 필드). 칩 행은 `bottom-dock`이 담당하므로 QuickEntry 내부의 기존 템플릿 칩(quickTemplates) UI는 중복이면 정리.

- [ ] **Step 4: 하단 고정 CSS** — `src/App.css`에 추가(탭바도 함께 하단에 오도록 `.app-shell` 하단 패딩 확보):
```css
.bottom-dock { position: fixed; left: 0; right: 0; bottom: 64px; padding: 8px 14px; background: linear-gradient(transparent, var(--bg) 24%); z-index: 30; }
.quick-chips { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 6px; }
.quick-chip { flex: 0 0 auto; display: flex; align-items: center; gap: 4px; background: var(--accent-tan-soft); color: var(--accent-tan); border: 1px solid var(--line); border-radius: 14px; padding: 6px 11px; font-size: 13px; font-weight: 600; }
.undo-toast { display: flex; justify-content: space-between; align-items: center; background: var(--surface-solid); border: 1px solid var(--line); border-radius: 12px; padding: 8px 12px; margin-bottom: 8px; box-shadow: var(--soft-shadow); font-size: 13px; }
.undo-toast button { color: var(--accent-tan); font-weight: 700; background: none; border: none; }
.tab-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 31; }
.app-shell { padding-bottom: 150px; }
```
(기존 `.tab-bar`/`.app-shell` 규칙이 있으면 충돌 없게 병합. 정확한 높이값은 시각검증에서 미세조정.)

- [ ] **Step 5: 빌드 + 시각검증** — `npm run build` 성공, `npm test` 통과. 로컬 dev에서 하단 바가 탭 위에 고정되고, 칩 탭 시 거래 추가 + 되돌리기 토스트가 뜨는지 Chrome으로 확인(컨트롤러).

- [ ] **Step 6: Commit** —
```bash
git add src/App.tsx src/App.css
git commit -m "feat: 하단 고정 스마트 입력바 + 원탭 즉시기록/되돌리기 + 자동학습 칩"
```

---

## Task R4: 홈 대시보드 재구성 (카테고리 링 + 순위 + 고정/변동)

**Files:** `src/App.tsx`, `src/App.css`

- [ ] **Step 1: 전월대비 + 카테고리 비중 준비** — Dashboard에서 사용할 값. `summary`에는 `thisMonth.realSpend`, `previousMonth?.realSpend`, `categoryTotals`(NameValue[] 내림차순), `thisMonth.fixed`, `thisMonth.variable`, `thisMonth.totalSpend`가 있음. import에 `changeRate` 추가: `import { deriveQuickChips, changeRate, type QuickChip } from './dashboardLogic'`.

- [ ] **Step 2: Dashboard 본문 교체** — `Dashboard` 컴포넌트의 반환 JSX에서 예산 카드·4 메트릭 카드·월별흐름 블록을 제거하고, 아래 세 블록으로 교체(카테고리/결제수단 바 섹션 중 카테고리 순위는 링 아래로 통합):
  - **CategoryRing**: 도넛(아래 Step 3 컴포넌트). 중앙 = `formatMoney(summary.thisMonth.realSpend)`, 보조 = `previousMonth` 있으면 `전월 대비 {부호}{abs(rate*100)}%` (rate=`changeRate(thisMonth.realSpend, previousMonth.realSpend)`, null이면 보조문구 생략).
  - **카테고리 순위**: `summary.categoryTotals.slice(0,5)` + 합계 대비 % (`item.value/summary.thisMonth.totalSpend`), 색점은 링과 동일 팔레트. 6번째부터는 "기타"로 합산 표기(선택).
  - **고정/변동**: 기존 `FixedVariablePanel`(있으면) 또는 split 막대 — `summary.thisMonth.fixed` vs `summary.thisMonth.variable`, 비율 막대 + 두 금액.

- [ ] **Step 3: CategoryRing 컴포넌트** — recharts `PieChart`로 카테고리 도넛(라벨 없는 도넛 + 중앙 텍스트 오버레이). App.tsx에 추가:
```tsx
const RING_COLORS = ['#c9794f', '#7e9b6f', '#d6a85e', '#9a7bb0', '#5a7d8f', '#cdbf9c']
function CategoryRing({ total, subtitle, data }: { total: string; subtitle: string | null; data: NameValue[] }) {
  return (
    <div className="cat-ring">
      <ResponsiveContainer width="100%" height={190}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={64} outerRadius={88} paddingAngle={2} stroke="none">
            {data.map((_, i) => <Cell key={i} fill={RING_COLORS[i % RING_COLORS.length]} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="cat-ring-center">
        <span className="cr-k">이번 달 실지출</span>
        <strong>{total}</strong>
        {subtitle && <span className="cr-s">{subtitle}</span>}
      </div>
    </div>
  )
}
```
(import에 recharts `PieChart, Pie, Cell` 추가 — `Cell`은 이미 import되어 있을 수 있음. data = `summary.categoryTotals.slice(0,6)`.)

- [ ] **Step 4: CSS** — `src/App.css`에 링 중앙 오버레이 등 추가:
```css
.cat-ring { position: relative; }
.cat-ring-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; pointer-events: none; }
.cat-ring-center .cr-k { color: var(--muted); font-size: 11px; }
.cat-ring-center strong { color: var(--ink); font-size: 22px; font-weight: 800; letter-spacing: -.5px; }
.cat-ring-center .cr-s { color: var(--accent-tan); font-size: 11px; font-weight: 700; }
```
(카테고리 순위·고정변동 막대 스타일은 기존 `.category-bars`/유사 클래스 재사용 또는 신규. 시각검증에서 다듬음.)

- [ ] **Step 5: 빌드 + 시각검증** — `npm run build`, `npm test` 통과. Chrome으로 홈이 링+순위+고정변동 구성인지, 숫자가 merged 거래(과거 포함) 기준인지 확인.

- [ ] **Step 6: Commit** —
```bash
git add src/App.tsx src/App.css
git commit -m "feat: 홈을 카테고리 링 + 순위 + 고정/변동 구성으로 재구성"
```

---

## Task R5: 월별 흐름을 인사이트 탭으로 이동

**Files:** `src/App.tsx`

- [ ] **Step 1: 차트 블록 이동** — Dashboard에서 제거했던(또는 아직 남은) 월별 흐름 AreaChart 섹션을 `InsightsView`로 옮긴다. `InsightsView({ store, summary })`는 이미 `summary` 받음. AreaChart는 `summary.monthlyTrend` 사용. recharts Tooltip `contentStyle`의 하드코딩 다크색을 라이트로 교체:
```tsx
contentStyle={{ backgroundColor: 'var(--surface-solid)', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }}
```
(축/그리드 색이 `var(--muted)`/`var(--line)`이면 그대로 라이트 적용됨.)

- [ ] **Step 2: 중복/누락 점검** — Dashboard에 월별흐름이 더 이상 없고 InsightsView에 정확히 한 번 있는지 확인.

- [ ] **Step 3: 빌드 + 시각검증** — `npm run build`, `npm test` 통과. Chrome으로 인사이트 탭에 월별 흐름(과거 6개월)이 보이고 홈엔 없는지 확인.

- [ ] **Step 4: Commit** —
```bash
git add src/App.tsx
git commit -m "feat: 월별 흐름 차트를 인사이트 탭으로 이동"
```

---

## Task R6: 배포 + 엔드투엔드 시각검증

**Files:** 없음

- [ ] **Step 1: 머지 + 배포** — feature 브랜치를 main에 머지 후:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm run deploy
```
(sandbox off) → `Published`.

- [ ] **Step 2: 전파 확인** — `curl -s https://kanghwani.github.io/personal-money-app/index.html | grep -oE 'assets/index-[^"]+\.js'` 가 방금 빌드 해시와 일치.

- [ ] **Step 3: 폰/PC 시각검증** — Chrome으로 배포본 열기(서비스워커 캐시 정리 후). 확인: ① 코지 베이지 라이트 테마 ② 홈 카테고리 링+순위+고정변동 ③ 하단 입력바 + 빠른칩 원탭 기록/되돌리기 ④ 인사이트 탭 월별 흐름 ⑤ 자연어 입력 동작.

- [ ] **Step 4: 데이터 안전** — 검증 중 테스트 브라우저가 store를 변경했으면, 필요 시 서버 store를 다시 비움(`action=save store=""`)해 회원님 실기기 우선되도록.

---

## 검증 기준 (전체)
- [ ] `npm test` 통과(dashboardLogic 포함), `npm run build` 클린
- [ ] 코지 베이지 라이트 테마가 전 화면 적용, 가독성 OK
- [ ] 홈: 카테고리 링(중앙 실지출+전월대비) + 카테고리 5 + 고정/변동
- [ ] 하단 고정 입력바: 자동학습 빠른칩 원탭=즉시기록+되돌리기, 자연어 파싱
- [ ] 월별 흐름은 인사이트 탭에만
- [ ] 배포 후 실제 동작 확인
