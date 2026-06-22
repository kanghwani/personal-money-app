# 장소/물건 입력 모델 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 거래를 "장소(첫 단어) + 물건(나머지)"로 입력·표시·수정하게 하고, 카테고리는 장소로부터 자동 유추(기존 분류 유지)한다.

**Architecture:** 저장 구조(memo·카테고리 컬럼)는 불변. memo가 곧 "장소 물건"이므로, 순수함수 `splitPlaceItem`/`joinPlaceItem`로 표시·수정 레이어만 추가한다. 수정 시트는 장소/물건 칸 + 카테고리 접기, 목록은 장소 강조 표시, 입력 안내문 변경, 장소 분류규칙 보강. GAS·시트·리포트 변경 없음(앱/Vercel만 배포).

**Tech Stack:** React + TypeScript + Vite, Vitest, Google Apps Script(읽기만), Vercel.

## Global Constraints
- 저장 스키마 변경 금지(거래원장 컬럼·월간리포트 수식 그대로). 장소/물건은 memo 파생.
- GAS 재배포 불필요. 앱은 `npm run build` 통과 후 `npx vercel --prod --yes`로 배포.
- tsconfig `noUnusedLocals`/`noUnusedParameters` 활성 — 미사용 심볼은 빌드 실패.
- 마이그레이션 금지(기존 memo 그대로 해석).

---

## File Structure
- **Modify** `src/dashboardLogic.ts` — 순수함수 `splitPlaceItem`, `joinPlaceItem` 추가.
- **Modify** `src/dashboardLogic.test.ts` — 두 함수 단위테스트.
- **Modify** `src/App.tsx` — import 추가; `TransactionEditSheet`(장소/물건 칸+카테고리 접기); `Ledger`/`CategoryDetailSheet` 행 제목 장소/물건 표시; `QuickEntry` placeholder.
- **Modify** `src/App.css` — `.cat-toggle`(분류 접기 버튼), `.row-place`/`.row-item`(제목 표시) 스타일.
- **데이터(앱 무관)** — 장소 분류규칙은 `assignCategory` API로 시트에 추가(Task 5).

---

## Task 1: splitPlaceItem / joinPlaceItem 순수함수 + 테스트

**Files:**
- Modify: `src/dashboardLogic.ts`
- Test: `src/dashboardLogic.test.ts`

**Interfaces:**
- Produces: `splitPlaceItem(memo: string): { place: string; item: string }`, `joinPlaceItem(place: string, item: string): string`

- [ ] **Step 1: 실패 테스트 작성**

`src/dashboardLogic.test.ts` 맨 아래에 추가:

```ts
describe('splitPlaceItem', () => {
  it('두 단어: 첫 단어=장소, 나머지=물건', () => {
    expect(splitPlaceItem('다이소 청소용품')).toEqual({ place: '다이소', item: '청소용품' })
  })
  it('물건에 공백 여러 단어', () => {
    expect(splitPlaceItem('투썸플레이스 딸기 라떼')).toEqual({ place: '투썸플레이스', item: '딸기 라떼' })
  })
  it('한 단어면 장소만', () => {
    expect(splitPlaceItem('스타벅스')).toEqual({ place: '스타벅스', item: '' })
  })
  it('빈 문자열', () => {
    expect(splitPlaceItem('')).toEqual({ place: '', item: '' })
  })
  it('앞뒤/중복 공백 정리', () => {
    expect(splitPlaceItem('  다이소   청소용품  ')).toEqual({ place: '다이소', item: '청소용품' })
  })
})

describe('joinPlaceItem', () => {
  it('장소+물건 결합', () => {
    expect(joinPlaceItem('다이소', '청소용품')).toBe('다이소 청소용품')
  })
  it('물건 비면 장소만', () => {
    expect(joinPlaceItem('스타벅스', '')).toBe('스타벅스')
  })
  it('둘 다 비면 빈 문자열', () => {
    expect(joinPlaceItem('', '')).toBe('')
  })
  it('앞뒤 공백 정리', () => {
    expect(joinPlaceItem(' 다이소 ', ' 청소용품 ')).toBe('다이소 청소용품')
  })
})
```

`import` 줄(2행)에 `splitPlaceItem, joinPlaceItem`를 추가:

```ts
import { deriveQuickChips, changeRate, categoryIcon, topNWithOther, dailyTotals, distinctCategoryOptions, fixedRemaining, splitFromText, splitPlaceItem, joinPlaceItem, type TxLike, type FixedDef } from './dashboardLogic'
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- dashboardLogic`
Expected: FAIL — `splitPlaceItem`/`joinPlaceItem` is not exported (또는 not a function).

- [ ] **Step 3: 구현**

`src/dashboardLogic.ts` 맨 아래에 추가:

```ts
/** memo를 장소(첫 단어)+물건(나머지)로 분리. 공백 정리 후 첫 공백 기준. */
export function splitPlaceItem(memo: string): { place: string; item: string } {
  const text = (memo || '').trim().replace(/\s+/g, ' ')
  if (!text) return { place: '', item: '' }
  const sp = text.indexOf(' ')
  if (sp < 0) return { place: text, item: '' }
  return { place: text.slice(0, sp), item: text.slice(sp + 1) }
}

/** 장소+물건을 공백으로 합쳐 memo 생성. 빈 값 안전 처리. */
export function joinPlaceItem(place: string, item: string): string {
  return `${(place || '').trim()} ${(item || '').trim()}`.trim()
}
```

- [ ] **Step 4: 통과 확인**

Run: `npm test -- dashboardLogic`
Expected: PASS (splitPlaceItem 5건 + joinPlaceItem 4건 포함 전체 통과).

- [ ] **Step 5: 커밋**

```bash
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "feat(logic): 장소/물건 분리·결합 순수함수 + 테스트"
```

---

## Task 2: 거래 수정 시트 — 장소/물건 칸 + 카테고리 접기

**Files:**
- Modify: `src/App.tsx` (import, `TransactionEditSheet` ~1146-1200, `QuickEntry` placeholder ~464)
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `splitPlaceItem`, `joinPlaceItem` (Task 1)

- [ ] **Step 1: import에 splitPlaceItem/joinPlaceItem 추가**

`src/App.tsx`의 dashboardLogic import 줄(38행 근처)에 두 함수 추가. 현재:

```ts
import { deriveQuickChips, dailyTotals, changeRate, categoryIcon, topNWithOther, distinctCategoryOptions, fixedRemaining, splitFromText, type QuickChip, type FixedDef } from './dashboardLogic'
```

다음으로 교체:

```ts
import { deriveQuickChips, dailyTotals, changeRate, categoryIcon, topNWithOther, distinctCategoryOptions, fixedRemaining, splitFromText, splitPlaceItem, joinPlaceItem, type QuickChip, type FixedDef } from './dashboardLogic'
```

- [ ] **Step 2: TransactionEditSheet에 place/item/showCat 상태 추가**

`const [draft, setDraft] = useState<Transaction>(tx)` 줄(1152) 아래에 추가:

```ts
  const [place, setPlace] = useState(() => splitPlaceItem(tx.memo).place)
  const [item, setItem] = useState(() => splitPlaceItem(tx.memo).item)
  const [showCat, setShowCat] = useState(false)
```

- [ ] **Step 3: 내역 칸 → 장소/물건 칸 교체**

다음 줄(1173)을:

```tsx
          <label>내역<input value={draft.memo} onChange={(e) => set({ memo: e.target.value })} /></label>
```

다음으로 교체:

```tsx
          <label>장소<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="예: 다이소" /></label>
          <label>물건<input value={item} onChange={(e) => setItem(e.target.value)} placeholder="예: 청소용품" /></label>
```

- [ ] **Step 4: 대분류/소분류를 접기(기본 숨김)로 감싸기**

다음 블록(1182-1189)을:

```tsx
          <label>대분류
            <input list="edit-cat-list" value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="선택 또는 직접 입력" />
            <datalist id="edit-cat-list">{categoryList.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>소분류
            <input list="edit-sub-list" value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} placeholder="선택 또는 직접 입력" />
            <datalist id="edit-sub-list">{subCategoryList.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
```

다음으로 교체:

```tsx
          {!showCat ? (
            <button type="button" className="cat-toggle" onClick={() => setShowCat(true)}>
              자동 분류: {draft.category || '미분류'}{draft.subCategory ? ' · ' + draft.subCategory : ''} · 수정 ▾
            </button>
          ) : (
            <>
              <label>대분류
                <input list="edit-cat-list" value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="선택 또는 직접 입력" />
                <datalist id="edit-cat-list">{categoryList.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label>소분류
                <input list="edit-sub-list" value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} placeholder="선택 또는 직접 입력" />
                <datalist id="edit-sub-list">{subCategoryList.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
            </>
          )}
```

- [ ] **Step 5: 저장 시 memo를 장소/물건으로 합치기**

저장 버튼(1200) 줄을:

```tsx
          <button type="button" className="fixed-save" onClick={() => onSave(draft)}>저장</button>
```

다음으로 교체:

```tsx
          <button type="button" className="fixed-save" onClick={() => onSave({ ...draft, memo: joinPlaceItem(place, item) })}>저장</button>
```

- [ ] **Step 6: 홈 입력 placeholder 변경**

464행을:

```tsx
          placeholder="오늘 5000 점심밥"
```

다음으로 교체:

```tsx
          placeholder="5000 다이소 청소용품 하나카드"
```

- [ ] **Step 7: CSS 추가**

`src/App.css` 맨 아래에 추가:

```css
.cat-toggle {
  align-self: flex-start;
  background: var(--surface-solid);
  border: 1px dashed var(--line);
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--muted);
  cursor: pointer;
}
```

- [ ] **Step 8: 빌드 확인**

Run: `npm run build`
Expected: PASS. (place/item/showCat·joinPlaceItem·splitPlaceItem 모두 사용됨 → 미사용 경고 없음.)

- [ ] **Step 9: 커밋**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(edit): 거래수정 장소/물건 칸 + 카테고리 접기 + 입력 안내문"
```

---

## Task 3: 거래 목록/카테고리 시트 — 장소/물건 표시

**Files:**
- Modify: `src/App.tsx` (`Ledger` 행 ~688, `CategoryDetailSheet` 행 ~543)
- Modify: `src/App.css`

**Interfaces:**
- Consumes: `splitPlaceItem` (Task 1, 이미 import됨)

- [ ] **Step 1: Ledger 행 제목을 장소/물건으로**

688행:

```tsx
                  <p className="row-title">{transaction.memo}</p>
```

다음으로 교체:

```tsx
                  <p className="row-title">
                    <span className="row-place">🏪 {splitPlaceItem(transaction.memo).place || '미입력'}</span>
                    {splitPlaceItem(transaction.memo).item && <span className="row-item"> · {splitPlaceItem(transaction.memo).item}</span>}
                  </p>
```

- [ ] **Step 2: CategoryDetailSheet 행 제목을 장소/물건으로**

543행:

```tsx
                  <p className="row-title">{t.memo}</p>
```

다음으로 교체:

```tsx
                  <p className="row-title">
                    <span className="row-place">🏪 {splitPlaceItem(t.memo).place || '미입력'}</span>
                    {splitPlaceItem(t.memo).item && <span className="row-item"> · {splitPlaceItem(t.memo).item}</span>}
                  </p>
```

- [ ] **Step 3: CSS 추가**

`src/App.css` 맨 아래에 추가:

```css
.row-place { font-weight: 800; }
.row-item { font-weight: 600; color: var(--muted); }
```

- [ ] **Step 4: 빌드 확인**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ledger): 거래 목록을 장소/물건으로 표시"
```

---

## Task 4: 장소 분류규칙 보강 (데이터, 앱 무관)

**Files:** 없음(실행 스크립트만; 시트 `v2_분류규칙`에 API로 반영)

**Interfaces:** 기존 `assignCategory` doPost 액션 사용(이미 배포됨).

- [ ] **Step 1: 규칙 추가 스크립트 실행**

`/tmp/place_rules.py` 작성 후 실행:

```python
import json, urllib.request, time
URL="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"
TOKEN="e281628c253994a8e3e011219133a2d04955d224134e8a2d"
rules = [
  ("다이소","생활","생활잡화"), ("올리브영","생활","뷰티/미용"),
  ("코스트코","식비","식자재"), ("홈플러스","식비","식자재"), ("롯데마트","식비","식자재"),
  ("이마트","식비","식자재"), ("노브랜드","식비","식자재"), ("와마트","식비","식자재"), ("마켓컬리","식비","식자재"),
  ("CU","식비","간편식"), ("GS25","식비","간편식"), ("세븐일레븐","식비","간편식"),
  ("유니클로","쇼핑","의류"), ("교보문고","문화/여가","도서"),
]
def post(p):
    data=json.dumps(p,ensure_ascii=False).encode()
    req=urllib.request.Request(URL,data=data,headers={'Content-Type':'text/plain;charset=utf-8'},method='POST')
    with urllib.request.urlopen(req) as r: return json.loads(r.read())
for kw,cat,sub in rules:
    print(kw, post({"action":"assignCategory","token":TOKEN,"id":"__rule_"+kw,"category":cat,"subCategory":sub,"memo":kw}).get('ok'))
    time.sleep(0.4)
```

Run: `python3 /tmp/place_rules.py`
Expected: 각 줄 `True`.

- [ ] **Step 2: 규칙 적용 확인(무금액 입력으로 원장 미기록)**

```bash
URL="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"
TOKEN="e281628c253994a8e3e011219133a2d04955d224134e8a2d"
python3 -c "
import urllib.request,urllib.parse,json
u='$URL?action=add&token=$TOKEN&raw='+urllib.parse.quote('다이소 청소용품')
print(json.load(urllib.request.urlopen(u))['parsed'])
"
```
Expected: `mainCategory='생활'`, `subCategory='생활잡화'`, `memo='다이소 청소용품'`, `status='확인필요'`(금액 없어 원장 미기록).

- [ ] **Step 3: 커밋 불필요(데이터 변경)**

규칙은 시트에 반영됨. 코드 변경 없음.

---

## Task 5: 통합 검증 (배포 + Chrome 실측)

**Files:** 없음(검증 전용)

- [ ] **Step 1: 전체 테스트 + 빌드**

Run: `npm test && npm run build`
Expected: 전부 PASS, 빌드 성공.

- [ ] **Step 2: Vercel 배포**

Run: `npx vercel --prod --yes`
Expected: `▲ Production ... ready.`

- [ ] **Step 3: Chrome 실측**

1. 배포본 접속, SW/캐시 정리 후 새로고침.
2. 홈에서 `5000 다이소 청소용품 하나카드` 입력 → 원장(또는 목록)에 **🏪 다이소 · 청소용품** 표시, 자동 카테고리 생활/생활잡화, 결제 하나카드 확인.
3. 그 거래 탭 → 거래수정 시트에 **장소=다이소, 물건=청소용품** 분리 표시, "자동 분류: 생활 · 생활잡화 · 수정 ▾" 접힘 확인. 물건을 "걸레"로 바꿔 저장 → 목록 제목 "🏪 다이소 · 걸레"로 갱신 확인.
4. 한 단어 입력(`스타벅스 6000 하나카드`) → 목록에 "🏪 스타벅스"(물건 없음) 표시 확인.
5. 검증으로 만든 테스트 거래는 삭제(앱 🗑 → deleteLedger)로 정리.

Expected: 위 모두 통과.

- [ ] **Step 4: 검증 결과 보고(코드 변경 없으면 커밋 불필요)**

---

## Self-Review 결과
- **Spec coverage:** splitPlaceItem/joinPlaceItem(Task1) / 수정시트 장소·물건+카테고리 접기(Task2) / 목록 표시(Task3) / 홈 placeholder(Task2 Step6) / 장소 분류규칙 보강(Task4) / 저장 구조·GAS 불변(전 task 코드 변경이 memo·표시 한정) / 한단어·빈값 엣지(Task1 테스트, Task3 '미입력' 폴백) — 모두 매핑됨. 범위 밖(장소 TOP)은 제외 유지.
- **Placeholder scan:** 없음. 모든 단계 실제 코드/명령 포함.
- **Type consistency:** `splitPlaceItem(memo)→{place,item}`, `joinPlaceItem(place,item)→string` 시그니처가 Task1 정의와 Task2/3 사용처에서 일치. App.tsx 새 상태 `place/item/showCat` 일관.
