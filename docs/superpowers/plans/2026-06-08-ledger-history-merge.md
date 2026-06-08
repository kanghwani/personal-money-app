# 원장 과거 데이터 병합 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구글시트 `v2_거래원장`의 과거 거래 전체를 앱이 읽기전용으로 불러와 동기화 store와 병합해, 월별 흐름(최근 6개월)·카테고리·원장 등 모든 화면이 과거를 반영하게 한다.

**Architecture:** 백엔드 `doGet?action=ledger`가 원장을 `Transaction[]`로 반환. 앱은 마운트 시 동기화 pull과 병렬로 원장을 fetch해 읽기전용 `history` state에 담고, `dedupById(history, store.transactions)`로 병합한 결과로 집계·표시한다. 과거 데이터는 blob에 저장하지 않아 5만자 한도 문제를 피한다.

**Tech Stack:** React 19 + TS + Vite, Vitest, Google Apps Script(clasp), gh-pages.

**환경 메모:**
- Apps Script 코드는 clasp 작업 디렉토리 `/tmp/clasp_gakebu/Code.js`에서 수정 후 `clasp push`/`clasp deploy`. 같은 내용을 repo `/Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs`에도 복사.
- clasp는 로그인됨(kanggokim91), 배포 deploymentId: `AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA` (가계부용, /exec URL 유지).
- EXEC URL: `https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec`
- TOKEN: `/tmp/sync_token.txt` 에 저장됨 (`e281628c253994a8e3e011219133a2d04955d224134e8a2d`).
- clasp/curl/배포 명령은 `dangerouslyDisableSandbox: true`로 실행(네트워크/클립보드 세션 필요).
- 앱 저장소는 `/Users/hwan/Documents/ManageMoney/personal-money-app`, 현재 `main` 브랜치.

---

## File Structure

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `/tmp/clasp_gakebu/Code.js` + repo `manage_money_apps_script.gs` | `doGet` ledger 분기 + `readLedgerTransactions_` | 수정 |
| `src/sync/merge.ts` | `dedupById` 순수함수 추가 | 수정 |
| `src/sync/merge.test.ts` | dedupById 테스트 | 수정 |
| `src/sync/syncClient.ts` | `loadLedger` 추가 | 수정 |
| `src/sync/syncClient.test.ts` | loadLedger 테스트 | 수정 |
| `src/App.tsx` | `useLedgerHistory` 훅 + merged 거래로 summary/원장 계산 | 수정 |

---

## Task 1: 백엔드 — doGet ledger 분기 + 원장 매핑

**Files:** `/tmp/clasp_gakebu/Code.js` (clasp push), repo `/Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs` (동기화 복사)

GAS는 로컬 단위테스트 불가 → 코드 추가 후 clasp push + curl 검증.

- [ ] **Step 1: doGet에 ledger 분기 추가** — `/tmp/clasp_gakebu/Code.js`에서 기존 `if (params.action === 'load') { ... }` 블록 **바로 다음**에 추가:
```js
  if (params.action === 'ledger') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return json_({ ok: true, transactions: readLedgerTransactions_(ss) });
  }
```

- [ ] **Step 2: 매핑 헬퍼 추가** — 파일 끝(예: `writeAppState_` 또는 `setSyncToken` 다음)에 추가:
```js
function readLedgerTransactions_(ss) {
  const sheet = ss.getSheetByName(SHEETS.ledger);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const values = sheet.getDataRange().getValues();
  const idx = makeIndex_(values[0]);
  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const amount = Number(row[idx['금액']]) || 0;
    const memo = String(row[idx['내역']] || '');
    if (!amount && !memo) continue;
    const rawDate = row[idx['날짜']];
    const date = rawDate instanceof Date ? formatDate_(rawDate) : String(rawDate || '');
    out.push({
      id: String(row[idx['거래ID']] || ('led-' + r)),
      date: date,
      type: String(row[idx['구분']]) === '수입' ? 'income' : 'expense',
      amount: amount,
      memo: memo,
      category: String(row[idx['대분류']] || ''),
      subCategory: String(row[idx['소분류']] || ''),
      payment: String(row[idx['결제수단']] || ''),
      fixedType: String(row[idx['고정/변동']]) === '고정' ? 'fixed' : 'variable',
      split: Number(row[idx['분담금']]) || 0,
      raw: ''
    });
  }
  return out;
}
```

- [ ] **Step 3: 문법 검사** — Run: `cd /tmp/clasp_gakebu && node --check Code.js` → 출력 없음(통과).

- [ ] **Step 4: clasp push** — Run (sandbox off): `cd /tmp/clasp_gakebu && clasp push -f` → `Pushed 2 files.`

- [ ] **Step 5: 새 버전 배포** — Run (sandbox off):
```bash
cd /tmp/clasp_gakebu && clasp deploy --deploymentId AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA --description "원장 ledger 엔드포인트"
```
Expected: `Deployed ... @N`

- [ ] **Step 6: curl 검증** — Run (sandbox off):
```bash
EXEC="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"; TOKEN=$(cat /tmp/sync_token.txt)
curl -sL "$EXEC?action=ledger&token=$TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('transactions',[]); print('ok:', d.get('ok'), '| count:', len(t)); print('sample:', t[0] if t else None); import collections; print('months:', sorted(set(x['date'][:7] for x in t if x.get('date')))[-8:])"
curl -sL "$EXEC?action=ledger&token=wrong" | head -c 80; echo ""
```
Expected: `ok: True | count: <수백>`, 월 목록 여러 개, 샘플 거래 객체. wrong 토큰 → `{"ok":false,"error":"unauthorized"}`.
또한 기존 동기화 회귀 확인: `curl -sL "$EXEC?action=load&token=$TOKEN"` → 여전히 `{"ok":true,...}`.

- [ ] **Step 7: repo .gs 동기화 + 커밋** — Run (sandbox off):
```bash
cp /tmp/clasp_gakebu/Code.js /Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs
cd /Users/hwan/Documents/ManageMoney && git add manage_money_apps_script.gs && git commit -m "feat: Apps Script에 원장(ledger) 조회 엔드포인트 추가"
```

---

## Task 2: dedupById 순수함수 (TDD)

**Files:** `src/sync/merge.ts`, `src/sync/merge.test.ts` (둘 다 이미 존재 — 추가)
작업 디렉토리: `/Users/hwan/Documents/ManageMoney/personal-money-app`

- [ ] **Step 1: 실패 테스트 추가** — `src/sync/merge.test.ts` 상단 import에 `dedupById`를 추가(`import { pickNewer, dedupById, type Snapshot } from './merge'`), 그리고 파일 끝에 describe 블록 추가:
```ts
describe('dedupById', () => {
  const t = (id: string, n: number) => ({ id, n })

  it('history만 있으면 그대로', () => {
    expect(dedupById([t('a', 1), t('b', 2)], [])).toEqual([t('a', 1), t('b', 2)])
  })

  it('store만 있으면 그대로', () => {
    expect(dedupById([], [t('a', 1)])).toEqual([t('a', 1)])
  })

  it('같은 id는 store가 우선', () => {
    const res = dedupById([t('a', 1)], [t('a', 99)])
    expect(res).toEqual([t('a', 99)])
  })

  it('history+store 병합(중복 없음)', () => {
    const res = dedupById([t('a', 1)], [t('b', 2)])
    expect(res.map((x) => x.id).sort()).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/sync/merge.test.ts` → FAIL (`dedupById` 없음).

- [ ] **Step 3: 구현** — `src/sync/merge.ts` 파일 끝에 추가:
```ts
/** history와 store 거래를 id 기준으로 병합한다. 같은 id는 store가 우선(최신). */
export function dedupById<T extends { id: string }>(history: T[], store: T[]): T[] {
  const map = new Map<string, T>()
  for (const item of history) map.set(item.id, item)
  for (const item of store) map.set(item.id, item)
  return [...map.values()]
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/sync/merge.test.ts` → PASS.

- [ ] **Step 5: Commit** —
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
git add src/sync/merge.ts src/sync/merge.test.ts
git commit -m "feat: dedupById 거래 병합 순수함수 (TDD)"
```

---

## Task 3: loadLedger (TDD, fetch 모킹)

**Files:** `src/sync/syncClient.ts`, `src/sync/syncClient.test.ts` (추가)

- [ ] **Step 1: 실패 테스트 추가** — `src/sync/syncClient.test.ts` 상단 import에 `loadLedger`를 추가(`import { loadFromServer, saveToServer, loadLedger, type SyncConfig } from './syncClient'`), 그리고 파일 끝에 describe 블록 추가:
```ts
describe('loadLedger', () => {
  it('cfg가 없으면 빈 배열', async () => {
    expect(await loadLedger(null)).toEqual([])
  })

  it('action=ledger 쿼리로 GET하고 transactions를 반환', async () => {
    const txns = [{ id: 'a', amount: 1 }]
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, transactions: txns }),
    })
    const result = await loadLedger(cfg)
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(url).toContain('action=ledger')
    expect(url).toContain('token=secret-tok')
    expect(result).toEqual(txns)
  })

  it('ok가 아니면 빈 배열', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: false }),
    })
    expect(await loadLedger(cfg)).toEqual([])
  })
})
```
(주의: 이 테스트 파일 상단의 기존 `cfg`, `beforeEach`/`afterEach`(fetch stub)를 재사용한다. import에 `loadLedger`만 추가.)

- [ ] **Step 2: 실패 확인** — Run: `npx vitest run src/sync/syncClient.test.ts` → FAIL (`loadLedger` 없음).

- [ ] **Step 3: 구현** — `src/sync/syncClient.ts` 파일 끝에 추가:
```ts
/**
 * 시트 원장(과거 거래 전체)을 읽어온다.
 * - cfg 없으면(비활성) [] 반환
 * - ok가 아니거나 transactions 배열이 없으면 []
 * - 네트워크/파싱 오류는 throw (호출부가 catch해서 [] 처리)
 */
export async function loadLedger<T>(
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<T[]> {
  if (!cfg) return []
  const url = `${cfg.url}?action=ledger&token=${encodeURIComponent(cfg.token)}`
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  const data = await res.json()
  if (!data || !data.ok || !Array.isArray(data.transactions)) return []
  return data.transactions as T[]
}
```

- [ ] **Step 4: 통과 확인** — Run: `npx vitest run src/sync/syncClient.test.ts` → PASS. 이어서 `npm test` 전체 통과 확인.

- [ ] **Step 5: Commit** —
```bash
git add src/sync/syncClient.ts src/sync/syncClient.test.ts
git commit -m "feat: loadLedger 원장 조회 클라이언트 (TDD)"
```

---

## Task 4: App.tsx — 원장 병합 wiring

**Files:** `src/App.tsx`

- [ ] **Step 1: import 추가** — 상단 sync import 줄을 다음으로 교체(또는 추가):
```ts
import { pickNewer, dedupById } from './sync/merge'
import { getSyncConfig, loadFromServer, saveToServer, loadLedger } from './sync/syncClient'
```
(기존 `import { pickNewer } from './sync/merge'` → `pickNewer, dedupById`로, `syncClient` import에 `loadLedger` 추가.)

- [ ] **Step 2: useLedgerHistory 훅 추가** — `usePersistentStore` 함수 정의 바로 위(또는 아래)에 추가:
```ts
function useLedgerHistory() {
  const [history, setHistory] = useState<Transaction[]>([])
  useEffect(() => {
    if (!getSyncConfig()) return
    let cancelled = false
    loadLedger<Transaction>()
      .then((rows) => { if (!cancelled) setHistory(rows) })
      .catch(() => { if (!cancelled) setHistory([]) })
    return () => { cancelled = true }
  }, [])
  return history
}
```

- [ ] **Step 3: App에서 병합 거래 계산** — `App` 컴포넌트에서 기존
```ts
  const summary = useMemo(() => buildSummary(store), [store])
```
를 다음으로 교체:
```ts
  const history = useLedgerHistory()
  const mergedTransactions = useMemo(
    () => dedupById(history, store.transactions),
    [history, store.transactions],
  )
  const summary = useMemo(
    () => buildSummary({ ...store, transactions: mergedTransactions }),
    [store, mergedTransactions],
  )
```

- [ ] **Step 4: 원장 뷰에 병합 거래 전달** — 렌더의 ledger 분기
```ts
      {activeTab === 'ledger' && <Ledger transactions={store.transactions} onDelete={deleteTransaction} />}
```
를 다음으로 교체:
```ts
      {activeTab === 'ledger' && <Ledger transactions={mergedTransactions} onDelete={deleteTransaction} />}
```

- [ ] **Step 5: 타입체크 + 빌드** — Run: `npm run build` → tsc + vite build 성공, 타입 에러 없음.

- [ ] **Step 6: 전체 테스트** — Run: `npm test` → merge/syncClient 테스트 전부 통과.

- [ ] **Step 7: Commit** —
```bash
git add src/App.tsx
git commit -m "feat: 원장 과거 거래를 동기화 store와 병합해 모든 화면에 반영"
```

---

## Task 5: 배포 + 엔드투엔드 검증

**Files:** 없음 (배포·검증)

- [ ] **Step 1: 배포** — Run (sandbox off):
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm run deploy
```
Expected: `Published`.

- [ ] **Step 2: 배포 전파 확인** — Run (sandbox off): 잠시 후
```bash
curl -s "https://kanghwani.github.io/personal-money-app/index.html" | grep -oE 'assets/index-[^"]+\.js'
```
새 해시가 dist와 일치하는지 확인.

- [ ] **Step 3: 브라우저 검증** — `https://kanghwani.github.io/personal-money-app/` 열기(하드 새로고침). 월별 흐름 차트가 과거 포함 **최근 6개월**을 보여주는지, 원장 탭에 과거 거래가 보이는지 확인. (Claude in Chrome으로 스크린샷)

- [ ] **Step 4: 데이터 안전 확인** — 원장은 읽기전용 병합이라 동기화 blob에 저장되지 않음. `curl ...action=load` 의 store가 과거 거래로 비대해지지 않았는지 확인(여전히 앱 입력분만).

---

## 검증 기준 (전체)
- [ ] `npm test` — merge(dedupById)/syncClient(loadLedger) 테스트 통과
- [ ] `npm run build` — 타입체크·빌드 성공
- [ ] curl `?action=ledger` → 과거 거래 수백 건, 여러 월 반환; 잘못된 토큰 거부; 기존 load/save 회귀 없음
- [ ] 배포 후 월별 흐름이 과거 6개월 표시 + 원장에 과거 거래 표시
- [ ] 동기화 blob은 과거 거래로 커지지 않음(읽기전용 유지)
