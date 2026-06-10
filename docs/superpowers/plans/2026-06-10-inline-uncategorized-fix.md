# 칩 제거 + 미분류 인라인 교정 + 로컬 규칙 학습 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈의 직전금액 고정 칩을 제거하고, 입력 결과가 미분류일 때만 그 자리에서 카테고리를 교정하며, 교정 내용을 로컬 규칙으로 학습해 다음 입력부터 앱 파서가 자동분류하게 한다.

**Architecture:** 순수 모듈 `learnedRules.ts`(localStorage 기반 학습 규칙: upsert·substring 매칭)를 신설하고, `App.tsx`의 `parseTransactionEntry`가 하드코딩 규칙보다 먼저 학습 규칙을 참조한다. 홈 UI에서 빠른칩을 제거하고, 미분류 지출 입력 직후 인라인 교정 칩을 노출해 탭 시 거래 갱신 + 로컬 학습 + 서버 동기화(`assignCategory`, 기존)를 수행한다.

**Tech Stack:** React + TypeScript, Vite, Vitest(node env), localStorage.

---

## File Structure

- **Create** `src/learnedRules.ts` — 학습 규칙 순수 로직(`upsertRule`, `classifyByLearned`) + 얇은 localStorage 래퍼(`loadLearnedRules`, `saveLearnedRule`). 책임: 메모→카테고리 학습 규칙의 저장·매칭.
- **Create** `src/learnedRules.test.ts` — `upsertRule`/`classifyByLearned` 단위테스트(node env에서 순수함수만 검증).
- **Modify** `src/App.tsx` — (a) `parseTransactionEntry`가 학습 규칙 우선 적용, (b) 홈 빠른칩 제거 + `logQuickChip` 제거, (c) `pendingUncat` 상태 + `assignAndLearn` + 인라인 교정 칩 렌더, (d) `DEFAULT_FIX_OPTIONS` 상수, import 추가.
- **Modify** `src/App.css` — `.fix-uncat`, `.fix-uncat-label`, `.fix-chips`, `.fix-chip` 스타일(quick-chip 스타일 재활용).

**범위 메모:** 달력 상세 시트(`DayDetailSheet`)의 칩은 특정 과거날짜 입력용 별도 기능이라 **유지**한다. `deriveQuickChips`/`logQuickChipForDate`도 거기서 쓰이므로 유지. 홈 칩과 `logQuickChip`(무날짜)만 제거.

---

## Task 1: 학습 규칙 순수 로직 + 테스트

**Files:**
- Create: `src/learnedRules.ts`
- Test: `src/learnedRules.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/learnedRules.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { upsertRule, classifyByLearned, type LearnedRule } from './learnedRules'

describe('upsertRule', () => {
  it('새 규칙을 앞에 추가', () => {
    const out = upsertRule([], { keyword: '서브웨이', category: '식비', subCategory: '외식' })
    expect(out).toEqual([{ keyword: '서브웨이', category: '식비', subCategory: '외식' }])
  })
  it('같은 keyword(대소문자/공백 무시)는 갱신하고 앞으로', () => {
    const base: LearnedRule[] = [
      { keyword: 'A', category: '취미', subCategory: '게임' },
      { keyword: '서브웨이', category: '식비', subCategory: '외식' },
    ]
    const out = upsertRule(base, { keyword: ' 서브웨이 ', category: '식비', subCategory: '배달' })
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ keyword: '서브웨이', category: '식비', subCategory: '배달' })
  })
  it('빈 keyword/category는 무시', () => {
    expect(upsertRule([], { keyword: '  ', category: '식비', subCategory: '' })).toEqual([])
    expect(upsertRule([], { keyword: '카페', category: '', subCategory: '' })).toEqual([])
  })
})

describe('classifyByLearned', () => {
  const rules: LearnedRule[] = [
    { keyword: '서브웨이', category: '식비', subCategory: '외식' },
    { keyword: '서브웨이 강남', category: '식비', subCategory: '배달' },
  ]
  it('포함되면 매칭', () => {
    expect(classifyByLearned('서브웨이 8000', rules)).toEqual({ category: '식비', subCategory: '외식' })
  })
  it('긴 keyword 우선', () => {
    expect(classifyByLearned('서브웨이 강남점 9000', rules)).toEqual({ category: '식비', subCategory: '배달' })
  })
  it('미매칭은 null', () => {
    expect(classifyByLearned('스타벅스', rules)).toBeNull()
  })
  it('빈 메모는 null', () => {
    expect(classifyByLearned('', rules)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- learnedRules`
Expected: FAIL — `src/learnedRules.ts` 모듈 없음(import 에러).

- [ ] **Step 3: Write minimal implementation**

Create `src/learnedRules.ts`:

```ts
export type LearnedRule = { keyword: string; category: string; subCategory: string }

const LEARNED_RULES_KEY = 'shiba-learned-rules:v1'

/** keyword(trim, 대소문자 무시)로 upsert. 일치하면 갱신, 없으면 맨 앞에 추가. 빈 keyword/category는 무시. */
export function upsertRule(rules: LearnedRule[], rule: LearnedRule): LearnedRule[] {
  const keyword = (rule.keyword || '').trim()
  if (!keyword || !rule.category) return rules
  const norm = keyword.toLowerCase()
  const rest = rules.filter((r) => r.keyword.trim().toLowerCase() !== norm)
  return [{ keyword, category: rule.category, subCategory: rule.subCategory || '' }, ...rest]
}

/** 메모가 학습 keyword를 포함하면 그 카테고리 반환. 더 긴(구체적) keyword를 우선. 없으면 null. */
export function classifyByLearned(
  memo: string,
  rules: LearnedRule[],
): { category: string; subCategory: string } | null {
  const text = (memo || '').toLowerCase()
  if (!text) return null
  const sorted = [...rules].sort((a, b) => b.keyword.length - a.keyword.length)
  for (const r of sorted) {
    const kw = r.keyword.trim().toLowerCase()
    if (kw && text.includes(kw)) return { category: r.category, subCategory: r.subCategory || '' }
  }
  return null
}

/** localStorage에서 학습 규칙 읽기(실패 시 빈 배열). */
export function loadLearnedRules(): LearnedRule[] {
  try {
    const raw = window.localStorage.getItem(LEARNED_RULES_KEY)
    return raw ? (JSON.parse(raw) as LearnedRule[]) : []
  } catch {
    return []
  }
}

/** 규칙 1건 학습(load → upsert → 저장). 실패는 무시. */
export function saveLearnedRule(rule: LearnedRule): void {
  try {
    const next = upsertRule(loadLearnedRules(), rule)
    window.localStorage.setItem(LEARNED_RULES_KEY, JSON.stringify(next))
  } catch {
    /* 용량 초과 등 무시 */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- learnedRules`
Expected: PASS (7개 케이스).

- [ ] **Step 5: Commit**

```bash
git add src/learnedRules.ts src/learnedRules.test.ts
git commit -m "feat(rules): 로컬 학습 규칙 모듈(upsert+substring 매칭) + 테스트"
```

---

## Task 2: 앱 파서가 학습 규칙을 먼저 적용

**Files:**
- Modify: `src/App.tsx` (import 추가, `parseTransactionEntry`의 `classify` 호출부)

- [ ] **Step 1: import 추가**

`src/App.tsx`의 dashboardLogic import 줄(현재 38행 근처) **아래에** 추가. (이 태스크에서 쓰는 2개만 — `saveLearnedRule`은 Task 3에서 추가하여 `noUnusedLocals` 빌드 실패를 피한다.)

```ts
import { loadLearnedRules, classifyByLearned } from './learnedRules'
```

- [ ] **Step 2: parseTransactionEntry에서 학습 규칙 우선 적용**

`parseTransactionEntry` 내부의 다음 한 줄을 교체:

```ts
  const category = classify(text)
```

다음으로:

```ts
  const learned = classifyByLearned(text, loadLearnedRules())
  const category = learned ? { category: learned.category, sub: learned.subCategory } : classify(text)
```

(`classify`는 하드코딩 폴백으로 그대로 둔다.)

- [ ] **Step 3: 빌드로 타입 확인**

Run: `npm run build`
Expected: 성공(에러 없음). `loadLearnedRules`·`classifyByLearned` 둘 다 이 태스크에서 사용되므로 미사용 경고 없음.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(parse): 빠른입력 자동분류에 로컬 학습 규칙 우선 적용"
```

---

## Task 3: 홈 빠른칩 제거 + 미분류 인라인 교정 UI

**Files:**
- Modify: `src/App.tsx` (상태/함수/렌더)

- [ ] **Step 0: saveLearnedRule import 추가**

Task 2에서 만든 import 줄을 다음으로 교체(`saveLearnedRule` 추가):

```ts
import { loadLearnedRules, saveLearnedRule, classifyByLearned } from './learnedRules'
```

- [ ] **Step 1: DEFAULT_FIX_OPTIONS 상수 추가**

`src/App.tsx`의 `categoryRules` 배열 정의 바로 아래(122행 근처)에 추가:

```ts
// 거래 이력이 없을 때 미분류 교정 칩에 보여줄 기본 카테고리 목록
const DEFAULT_FIX_OPTIONS: { category: string; subCategory: string }[] = [
  { category: '식비', subCategory: '외식' },
  { category: '식비', subCategory: '카페/간식' },
  { category: '식비', subCategory: '장보기' },
  { category: '생활', subCategory: '생활잡화' },
  { category: '교통/차량', subCategory: '' },
  { category: '주거/통신', subCategory: '' },
  { category: '건강', subCategory: '' },
  { category: '문화/구독', subCategory: '구독' },
  { category: '취미', subCategory: '게임' },
]
```

- [ ] **Step 2: pendingUncat 상태 + fixOptions 메모 추가**

`const [undoTx, setUndoTx] = useState<Transaction | null>(null)` 줄(197행 근처) **아래에** 추가:

```ts
  const [pendingUncat, setPendingUncat] = useState<Transaction | null>(null)
  const fixOptions = useMemo(() => {
    const opts = distinctCategoryOptions(mergedTransactions)
    return opts.length ? opts.slice(0, 8) : DEFAULT_FIX_OPTIONS
  }, [mergedTransactions])
```

- [ ] **Step 3: applyQuickInput에서 미분류 지출이면 pendingUncat set**

`applyQuickInput` 함수의 마지막 줄 `setLastMessage(resultLabel(parsed))` **아래에** 추가:

```ts
    if (parsed.kind === 'transaction' && parsed.transaction.type === 'expense' && parsed.transaction.category === '미분류') {
      setPendingUncat(parsed.transaction)
    } else {
      setPendingUncat(null)
    }
```

- [ ] **Step 4: assignAndLearn 함수 추가**

`deleteTransaction` 함수 정의 **위에**(263행 근처) 추가:

```ts
  function assignAndLearn(tx: Transaction, category: string, subCategory: string) {
    editTransaction({ ...tx, category, subCategory })   // store/캐시 갱신 + (카테고리 변경 시) 서버 assignCategory 호출
    saveLearnedRule({ keyword: tx.memo, category, subCategory })
    setPendingUncat(null)
    setLastMessage(`${category}${subCategory ? '·' + subCategory : ''}로 분류됨 · 다음부터 자동`)
  }
```

(`editTransaction`은 기존 함수 — 카테고리가 바뀌면 내부에서 `assignCategory`를 호출함.)

- [ ] **Step 5: logQuickChip 함수 제거**

다음 함수 정의(243행 근처)를 **삭제**:

```ts
  function logQuickChip(chip: QuickChip) {
    logQuickChipForDate(chip, todayIso())
  }
```

(`logQuickChipForDate`는 Ledger에서 쓰이므로 유지.)

- [ ] **Step 6: 홈 빠른칩 블록 제거 + 교정 칩 렌더 추가**

홈(dashboard) `.home-input` 안의 다음 블록을 **삭제**:

```tsx
            {quickChips.length > 0 && (
              <div className="quick-chips">
                {quickChips.map((c) => (
                  <button key={c.key} type="button" className="quick-chip" onClick={() => logQuickChip(c)}>
                    <span>{c.emoji}</span>{c.label}
                  </button>
                ))}
              </div>
            )}
```

그리고 같은 `.home-input` 안의 `<QuickEntry onSubmit={applyQuickInput} lastMessage={lastMessage} />` **아래에** 추가:

```tsx
            {pendingUncat && (
              <div className="fix-uncat">
                <p className="fix-uncat-label">미분류 — 카테고리를 골라주세요</p>
                <div className="fix-chips">
                  {fixOptions.map((o) => (
                    <button
                      key={o.category + '/' + o.subCategory}
                      type="button"
                      className="fix-chip"
                      onClick={() => assignAndLearn(pendingUncat, o.category, o.subCategory)}
                    >
                      {categoryIcon(o.category)} {o.category}{o.subCategory ? '·' + o.subCategory : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
```

- [ ] **Step 7: 빌드로 타입/미사용 확인**

Run: `npm run build`
Expected: PASS. (만약 `quickChips`가 홈에서만 쓰였다면 미사용 경고가 날 수 있으나, Ledger/DayDetailSheet prop으로 전달되므로 사용 중 → 통과. `QuickChip` import도 `logQuickChipForDate` 시그니처에서 사용 → 통과.)

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(home): 빠른칩 제거 + 미분류 입력 인라인 교정 칩(교정 시 로컬 학습)"
```

---

## Task 4: 교정 칩 스타일

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: 스타일 추가**

`src/App.css`의 `.quick-chip { ... }` 블록(857행 근처) **아래에** 추가:

```css
.fix-uncat {
  max-width: 1180px;
  margin: 0 auto 8px;
}

.fix-uncat-label {
  margin: 2px 4px 6px;
  color: var(--danger);
  font-size: 12px;
  font-weight: 700;
}

.fix-chips {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding-bottom: 6px;
  scrollbar-width: none;
}

.fix-chips::-webkit-scrollbar {
  display: none;
}

.fix-chip {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--accent-tan-soft);
  color: var(--accent-tan);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 6px 11px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
```

- [ ] **Step 2: 빌드 확인**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/App.css
git commit -m "style(home): 미분류 교정 칩 스타일"
```

---

## Task 5: 통합 검증 (배포 + Chrome 실측)

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `npm test && npm run build`
Expected: 모든 테스트 PASS, 빌드 성공.

- [ ] **Step 2: 배포**

Run: `npx vercel --prod --yes`
Expected: `▲ Production ... ready.` 출력, 배포 URL 확인.

- [ ] **Step 3: Chrome 실측 — 미분류 입력 → 교정 → 자동분류**

1. 배포본 접속, SW/캐시 정리 후 새로고침.
2. 홈에서 자동분류 안 되는 메모 입력(예: `오늘 5000 듣보잡가게`) → **미분류 교정 칩 노출** 확인.
3. "식비·외식" 칩 탭 → 거래가 식비/외식으로 갱신 + 칩 사라짐 + 상태메시지 확인.
4. 같은 메모 재입력(`듣보잡가게 8000`) → **미분류 칩 안 뜸**(자동 식비/외식) 확인.
5. 홈 상단에 기존 빠른칩이 **더 이상 없음** 확인.

Expected: 위 5개 모두 통과.

- [ ] **Step 4: 검증 결과 기록(코드 변경 없으면 커밋 불필요)**

검증 통과 시 완료. 실패 항목 있으면 해당 Task로 돌아가 수정.

---

## Self-Review 결과

- **Spec coverage:** 칩 제거(Task 3) / 미분류일 때만 인라인 교정(Task 3 Step 3·6) / 로컬 학습(Task 1·3 Step 4) / 파서 우선 적용(Task 2) / 키워드=memo·substring·긴 것 우선(Task 1) / 서버 동기화 유지(assignAndLearn→editTransaction→assignCategory) / 수입 제외(Task 3 Step 3 조건) / 기본 카테고리 폴백(Task 3 Step 1·2) — 모두 매핑됨.
- **Placeholder scan:** 없음. 모든 코드 블록 실제 내용 포함.
- **Type consistency:** `LearnedRule`, `upsertRule`, `classifyByLearned`, `loadLearnedRules`, `saveLearnedRule` 시그니처가 Task 1 정의와 Task 2·3 사용처에서 일치. `assignAndLearn(tx, category, subCategory)` 일관.
