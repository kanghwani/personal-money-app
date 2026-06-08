# 고정비 자동 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매달 반복되는 고정비를 Apps Script 시간 트리거가 자동으로 원장에 기록하고, 앱의 "고정비" 탭에서 항목을 관리(추가/수정/토글)하며 할부는 남은 금액을 표시한다.

**Architecture:** 정의는 `v2_고정비` 시트. 매일 트리거 `autoPostFixed_`가 납부일 도래분을 원장에 멱등 삽입. 앱은 CRUD API로 정의를 관리하고 `fixedRemaining`(순수함수)로 할부 잔액을 계산해 표시.

**Tech Stack:** React 19 + TS + Vite, Vitest, Google Apps Script(clasp), gh-pages.

**환경 메모:**
- 앱 `/Users/hwan/Documents/ManageMoney/personal-money-app`, 현재 `main`. feature 브랜치 권장.
- Apps Script: `/tmp/clasp_gakebu/Code.js` 수정 → `clasp push -f` + `clasp deploy --deploymentId AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA`. EXEC `https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec`. TOKEN `/tmp/sync_token.txt`. 수정 후 repo `/Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs`에 복사. clasp/curl/cp/git은 sandbox off.
- 기존 GAS 사실: `SHEETS.ledger='v2_거래원장'` 컬럼 `[거래ID,입력시각,날짜,월,구분,고정/변동,대분류,소분류,내역,금액,결제수단,태그,분담금,실지출,입력원,원본탭,원본행,메모]`. helpers `ensureSheet_`, `setupSheet_(ss,name,headers)`, `makeIndex_`, `readObjects_`, `json_`, `checkToken_`, `formatDate_(date)→yyyy-MM-dd`, `SPREADSHEET_ID`. doGet 분기: load/ledger + health. doPost: save 분기, assignCategory 분기, 그 후 자연어 로직. 원장 append 예: `appendRow([uuid, now, date, month, '지출', fixedType, 대,소, 내역, 금액, 결제,태그, 분담, 실지출, 입력원,'','', 원본])`.
- 앱: `type Tab = 'dashboard'|'ledger'|'assets'|'insights'`, `activeTab` state, `tab-bar`에 `<TabButton tab=... icon label onClick={setActiveTab} />` 4개. lucide 아이콘 import됨(Home/ReceiptText/Wallet/Sparkles 등). syncClient 패턴: text/plain POST redirect follow; `getSyncConfig`,`loadLedger`. dashboardLogic `type TxLike`.

---

## File Structure
| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/dashboardLogic.ts` (+test) | `fixedRemaining` + `type FixedDef` | 수정 |
| `src/sync/syncClient.ts` (+test) | `loadFixedDefs`/`saveFixedDef`/`deleteFixedDef` | 수정 |
| `/tmp/clasp_gakebu/Code.js` + repo `.gs` | 시트·자동입력·트리거·CRUD | 수정 |
| `src/App.tsx` | `fixed` 탭 + `FixedView` | 수정 |
| `src/App.css` | 고정비 목록·배지·폼 | 수정 |

---

## Task G1: fixedRemaining 순수함수 + FixedDef 타입 (TDD)

**Files:** `src/dashboardLogic.ts`, `src/dashboardLogic.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/dashboardLogic.test.ts` import에 `fixedRemaining, type FixedDef` 추가, 끝에:
```ts
describe('fixedRemaining', () => {
  const base: FixedDef = { id: '1', active: true, name: '맥북 할부', amount: 179354, category: '생활', subCategory: '전자기기', payment: '카드', payDay: 1, startMonth: '2026-03', installmentTotal: 14 }
  it('진행중 할부: 경과/남은 회차·금액', () => {
    expect(fixedRemaining(base, '2026-05')).toEqual({ count: 3, total: 14, remainingCount: 11, remainingAmount: 11 * 179354, done: false })
  })
  it('완료된 할부: 남은 0, done', () => {
    expect(fixedRemaining(base, '2027-05')).toEqual({ count: 14, total: 14, remainingCount: 0, remainingAmount: 0, done: true })
  })
  it('무기한(할부총회차 null) → null', () => {
    expect(fixedRemaining({ ...base, installmentTotal: null }, '2026-05')).toBeNull()
  })
})
```

- [ ] **Step 2: 실패 확인** — Run: `cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/dashboardLogic.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/dashboardLogic.ts` 끝에:
```ts
export type FixedDef = {
  id: string
  active: boolean
  name: string
  amount: number
  category: string
  subCategory: string
  payment: string
  payDay: number
  startMonth: string
  installmentTotal: number | null
}

function monthIndex(ym: string): number {
  const [y, m] = String(ym).split('-').map(Number)
  return y * 12 + (m - 1)
}

/** 할부 항목의 경과/남은 회차와 금액. 무기한(installmentTotal 없음)이면 null. */
export function fixedRemaining(
  def: FixedDef,
  yearMonth: string,
): { count: number; total: number; remainingCount: number; remainingAmount: number; done: boolean } | null {
  if (!def.installmentTotal) return null
  const total = def.installmentTotal
  const elapsed = monthIndex(yearMonth) - monthIndex(def.startMonth) + 1
  const count = Math.max(0, Math.min(total, elapsed))
  const remainingCount = Math.max(0, total - elapsed)
  return { count, total, remainingCount, remainingAmount: remainingCount * def.amount, done: remainingCount === 0 }
}
```

- [ ] **Step 4: 통과** — `npx vitest run src/dashboardLogic.test.ts` → 통과. `npm test` 전체 통과.

- [ ] **Step 5: Commit** —
```bash
git add src/dashboardLogic.ts src/dashboardLogic.test.ts
git commit -m "feat: fixedRemaining 할부 잔액 순수함수 + FixedDef (TDD)"
```

---

## Task G2: 고정비 CRUD 클라이언트 (TDD)

**Files:** `src/sync/syncClient.ts`, `src/sync/syncClient.test.ts`

- [ ] **Step 1: 실패 테스트** — `src/sync/syncClient.test.ts` import에 `loadFixedDefs, saveFixedDef, deleteFixedDef` 추가, 끝에 (파일 스코프 `cfg`, `vi`, fetch 스텁 재사용):
```ts
describe('fixed CRUD client', () => {
  it('loadFixedDefs: defs 배열 반환, cfg 없으면 []', async () => {
    expect(await loadFixedDefs(null)).toEqual([])
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true, defs: [{ id: '1', name: '월세' }] }) })
    const defs = await loadFixedDefs(cfg)
    expect(defs).toEqual([{ id: '1', name: '월세' }])
  })
  it('saveFixedDef: fixedSave POST, ok 반환', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true }) })
    const ok = await saveFixedDef({ id: '', name: '월세' } as never, cfg)
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as string)
    expect(body.action).toBe('fixedSave')
    expect(body.def).toMatchObject({ name: '월세' })
    expect(body.token).toBe('secret-tok')
    expect(ok).toBe(true)
  })
  it('deleteFixedDef: fixedDelete POST, ok 반환', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ json: async () => ({ ok: true }) })
    const ok = await deleteFixedDef('1', cfg)
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1].body as string)
    expect(body.action).toBe('fixedDelete')
    expect(body.id).toBe('1')
    expect(ok).toBe(true)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npx vitest run src/sync/syncClient.test.ts` → FAIL.

- [ ] **Step 3: 구현** — `src/sync/syncClient.ts` 끝에 (import의 `FixedDef`는 타입만 필요 → `import type { FixedDef } from '../dashboardLogic'` 추가):
```ts
import type { FixedDef } from '../dashboardLogic'

export async function loadFixedDefs(cfg: SyncConfig | null = getSyncConfig()): Promise<FixedDef[]> {
  if (!cfg) return []
  const res = await fetch(`${cfg.url}?action=fixedList&token=${encodeURIComponent(cfg.token)}`, { redirect: 'follow' })
  const data = await res.json()
  return data && data.ok && Array.isArray(data.defs) ? data.defs : []
}

export async function saveFixedDef(def: FixedDef, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'fixedSave', token: cfg.token, def }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}

export async function deleteFixedDef(id: string, cfg: SyncConfig | null = getSyncConfig()): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, redirect: 'follow',
    body: JSON.stringify({ action: 'fixedDelete', token: cfg.token, id }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}
```
(`import type` 라인은 파일 상단 import 영역으로 옮겨도 됨.)

- [ ] **Step 4: 통과** — `npx vitest run src/sync/syncClient.test.ts` → 통과. `npm test` 전체 통과.

- [ ] **Step 5: Commit** —
```bash
git add src/sync/syncClient.ts src/sync/syncClient.test.ts
git commit -m "feat: 고정비 CRUD 클라이언트 (TDD)"
```

---

## Task G3: 백엔드 — 정의 시트 + 자동입력 + 트리거 + CRUD

**Files:** `/tmp/clasp_gakebu/Code.js`, repo `manage_money_apps_script.gs`. sandbox off. 로컬 단위테스트 불가 → curl 검증.

- [ ] **Step 1: SHEETS에 fixed 추가** — `/tmp/clasp_gakebu/Code.js`의 `SHEETS` 객체에 `fixedDefs: 'v2_고정비',` 항목 추가(다른 SHEETS 키 옆).

- [ ] **Step 2: doGet 분기** — doGet의 `ledger` 분기 다음에:
```js
  if (params.action === 'fixedList') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_({ ok: true, defs: readFixedDefs_(SpreadsheetApp.openById(SPREADSHEET_ID)) });
  }
  if (params.action === 'setupfixed') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    var ssS = SpreadsheetApp.openById(SPREADSHEET_ID);
    var s1 = seedFixedDefs_(ssS); var s2;
    try { s2 = installFixedTrigger_(); } catch (err) { s2 = { ok: false, error: String(err) }; }
    return json_({ ok: true, seed: s1, trigger: s2 });
  }
  if (params.action === 'runfixed') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(autoPostFixed_());
  }
```

- [ ] **Step 3: doPost 분기** — doPost의 `assignCategory` 분기 다음(자연어 로직 전)에:
```js
  if (body && body.action === 'fixedSave') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(saveFixedDef_(SpreadsheetApp.openById(SPREADSHEET_ID), body.def || {}));
  }
  if (body && body.action === 'fixedDelete') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    return json_(deleteFixedDef_(SpreadsheetApp.openById(SPREADSHEET_ID), String(body.id || '')));
  }
```

- [ ] **Step 4: 헬퍼 함수 추가(파일 끝)** —
```js
var FIXED_HEADERS = ['id', '활성', '이름', '금액', '대분류', '소분류', '결제수단', '납부일', '시작월', '할부총회차'];

function fixedSheet_(ss) {
  var sheet = ss.getSheetByName(SHEETS.fixedDefs);
  if (!sheet) { sheet = ss.insertSheet(SHEETS.fixedDefs); sheet.appendRow(FIXED_HEADERS); }
  return sheet;
}

function readFixedDefs_(ss) {
  var sheet = fixedSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var defs = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row[0] && !row[2]) continue;
    defs.push({
      id: String(row[0]), active: row[1] === true || String(row[1]).toUpperCase() === 'TRUE',
      name: String(row[2]), amount: Number(row[3]) || 0,
      category: String(row[4]), subCategory: String(row[5]), payment: String(row[6]),
      payDay: Number(row[7]) || 1, startMonth: String(row[8]),
      installmentTotal: row[9] === '' || row[9] === null ? null : Number(row[9]),
    });
  }
  return defs;
}

function saveFixedDef_(ss, def) {
  var sheet = fixedSheet_(ss);
  var values = sheet.getDataRange().getValues();
  var rowArr = [
    def.id || Utilities.getUuid(), def.active !== false, String(def.name || ''), Number(def.amount) || 0,
    String(def.category || ''), String(def.subCategory || ''), String(def.payment || ''),
    Number(def.payDay) || 1, String(def.startMonth || ''),
    (def.installmentTotal === null || def.installmentTotal === undefined || def.installmentTotal === '') ? '' : Number(def.installmentTotal),
  ];
  if (def.id) {
    for (var r = 1; r < values.length; r++) {
      if (String(values[r][0]) === String(def.id)) {
        sheet.getRange(r + 1, 1, 1, FIXED_HEADERS.length).setValues([rowArr]);
        return { ok: true, id: def.id };
      }
    }
  }
  sheet.appendRow(rowArr);
  return { ok: true, id: rowArr[0] };
}

function deleteFixedDef_(ss, id) {
  var sheet = fixedSheet_(ss);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(id)) { sheet.deleteRow(r + 1); return { ok: true }; }
  }
  return { ok: false, error: 'not found' };
}

function monthIndex_(ym) {
  var p = String(ym).split('-');
  return Number(p[0]) * 12 + (Number(p[1]) - 1);
}

function autoPostFixed_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var defs = readFixedDefs_(ss);
  var today = new Date();
  var y = today.getFullYear(), m = today.getMonth() + 1, day = today.getDate();
  var thisMonth = y + '-' + ('0' + m).slice(-2);
  var thisIdx = y * 12 + (m - 1);
  var ledger = ensureSheet_(ss, SHEETS.ledger);
  var lvals = ledger.getDataRange().getValues();
  var li = makeIndex_(lvals[0]);
  var existing = {};
  for (var r = 1; r < lvals.length; r++) {
    var d = lvals[r][li['날짜']];
    var ds = (d instanceof Date) ? formatDate_(d) : String(d);
    existing[String(lvals[r][li['내역']]).trim() + '|' + ds.slice(0, 7)] = true;
  }
  var posted = 0;
  for (var i = 0; i < defs.length; i++) {
    var def = defs[i];
    if (!def.active || !def.amount) continue;
    if (day < def.payDay) continue;
    var startIdx = monthIndex_(def.startMonth);
    if (thisIdx < startIdx) continue;
    if (def.installmentTotal && thisIdx >= startIdx + def.installmentTotal) continue;
    if (existing[def.name.trim() + '|' + thisMonth]) continue;
    var date = thisMonth + '-' + ('0' + def.payDay).slice(-2);
    ledger.appendRow([
      Utilities.getUuid(), new Date(), date, thisMonth, '지출', '고정',
      def.category, def.subCategory, def.name, def.amount,
      def.payment, '', '', def.amount, 'auto', '', '', '고정비자동',
    ]);
    posted++;
  }
  SpreadsheetApp.flush();
  return { ok: true, posted: posted };
}

function installFixedTrigger_() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoPostFixed_') return { ok: true, existing: true };
  }
  ScriptApp.newTrigger('autoPostFixed_').timeBased().everyDays(1).atHour(4).create();
  return { ok: true, created: true };
}

function seedFixedDefs_(ss) {
  var sheet = fixedSheet_(ss);
  if (sheet.getLastRow() > 1) return { ok: true, skipped: true };
  var SEED = [
    ['월세', 950000, '주거/통신', '주거비', '계좌이체', 1, '2026-01', ''],
    ['국민연금', 171682, '주거/통신', '세금/공과금', '계좌이체', 1, '2026-01', ''],
    ['아파트 관리비', 282850, '주거/통신', '관리비', '계좌이체', 1, '2026-01', ''],
    ['건강보험료', 64028, '주거/통신', '세금/공과금', '계좌이체', 1, '2026-05', ''],
    ['SKT 통신비', 45750, '주거/통신', '통신비', '카드', 1, '2026-01', ''],
    ['SK브로드밴드', 23100, '주거/통신', '통신비', '카드', 1, '2026-01', ''],
    ['메리츠화재 보험', 52480, '건강', '보험', '카드', 1, '2026-01', ''],
    ['넷플릭스', 9500, '문화/구독', '구독', '카드', 1, '2026-01', ''],
    ['Apple Services', 3300, '문화/구독', '구독', '카드', 1, '2026-01', ''],
    ['네이버플러스 멤버십', 4900, '문화/구독', '구독', '카드', 1, '2026-01', ''],
    ['Claude API', 28000, '문화/구독', '구독', '카드', 7, '2026-01', ''],
    ['자동차 할부', 515690, '교통/차량', '할부', '카드', 1, '2026-01', ''],
    ['맥북프로 할부', 179354, '생활', '전자기기', '카드', 1, '2026-03', 14],
  ];
  for (var i = 0; i < SEED.length; i++) {
    sheet.appendRow([Utilities.getUuid(), true, SEED[i][0], SEED[i][1], SEED[i][2], SEED[i][3], SEED[i][4], SEED[i][5], SEED[i][6], SEED[i][7]]);
  }
  return { ok: true, seeded: SEED.length };
}
```

- [ ] **Step 5: 문법검사 + push + 배포** — Run(sandbox off):
```bash
cd /tmp/clasp_gakebu && node --check Code.js && clasp push -f && clasp deploy --deploymentId AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA --description "고정비 자동입력 + CRUD"
```

- [ ] **Step 6: 시드 + 트리거 설치 + 검증** — Run(sandbox off). 트리거 설치는 `ScriptApp` 권한이 필요해 setupfixed 호출 시 인증 오류가 나면 보고(컨트롤러가 에디터에서 1회 실행/인증). 우선:
```bash
EXEC="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"; TOKEN=$(cat /tmp/sync_token.txt)
echo "setupfixed:"; curl -sL "$EXEC?action=setupfixed&token=$TOKEN"; echo ""
echo "fixedList:"; curl -sL "$EXEC?action=fixedList&token=$TOKEN" | python3 -c "import sys,json;d=json.load(sys.stdin);print('defs',len(d.get('defs',[])));[print(' ',x['name'],x['amount'],x.get('installmentTotal')) for x in d.get('defs',[])[:5]]"
```
Expected: seed seeded 13, fixedList defs 13. (트리거가 권한오류면 `trigger` 필드에 에러 — 보고.)

- [ ] **Step 7: CRUD + autoPost 멱등 검증** — Run(sandbox off):
```bash
EXEC="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"; TOKEN=$(cat /tmp/sync_token.txt)
echo "runfixed 1회차(이번달 고정비 자동기록):"; curl -sL "$EXEC?action=runfixed&token=$TOKEN"; echo ""
echo "runfixed 2회차(멱등 — posted 0 이어야):"; curl -sL "$EXEC?action=runfixed&token=$TOKEN"; echo ""
# CRUD:
NEWID=$(curl -sL -X POST "$EXEC" -H "Content-Type: text/plain;charset=utf-8" --data "{\"action\":\"fixedSave\",\"token\":\"$TOKEN\",\"def\":{\"id\":\"\",\"active\":true,\"name\":\"테스트구독\",\"amount\":1000,\"category\":\"문화/구독\",\"subCategory\":\"구독\",\"payment\":\"카드\",\"payDay\":1,\"startMonth\":\"2026-06\",\"installmentTotal\":null}}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('id',''))")
echo "추가된 id: $NEWID"
curl -sL "$EXEC?action=fixedList&token=$TOKEN" | python3 -c "import sys,json;print('테스트구독 존재:', any(x['name']=='테스트구독' for x in json.load(sys.stdin)['defs']))"
curl -sL -X POST "$EXEC" -H "Content-Type: text/plain;charset=utf-8" --data "{\"action\":\"fixedDelete\",\"token\":\"$TOKEN\",\"id\":\"$NEWID\"}" >/dev/null
curl -sL "$EXEC?action=fixedList&token=$TOKEN" | python3 -c "import sys,json;print('삭제 확인(테스트구독 없음):', not any(x['name']=='테스트구독' for x in json.load(sys.stdin)['defs']))"
```

- [ ] **Step 8: 임시 분기 제거 + 재배포 + repo 동기화** — `setupfixed`·`runfixed` doGet 분기와 `seedFixedDefs_` 함수 제거(시드/수동실행은 1회 끝). `autoPostFixed_`/`installFixedTrigger_`/CRUD/`readFixedDefs_`는 유지(트리거가 autoPostFixed_를 호출). Run:
```bash
cd /tmp/clasp_gakebu && node --check Code.js && grep -c "setupfixed\|runfixed\|seedFixedDefs_" Code.js && clasp push -f && clasp deploy --deploymentId AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA --description "고정비 시드분기 제거"
EXEC="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"; TOKEN=$(cat /tmp/sync_token.txt)
curl -sL "$EXEC?action=ledger&token=$TOKEN" | python3 -c "import sys,json;print('ledger ok', len(json.load(sys.stdin).get('transactions',[])))"
cp /tmp/clasp_gakebu/Code.js /Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs
cd /Users/hwan && git add Documents/ManageMoney/manage_money_apps_script.gs && git commit -m "feat: Apps Script 고정비 자동입력+트리거+CRUD (시드 후 분기 제거)" -- Documents/ManageMoney/manage_money_apps_script.gs 2>&1 | tail -1 || echo "(.gs 커밋 스킵 — 라이브가 정답)"
```
Expected grep 0, ledger ok.

**참고(컨트롤러):** `autoPostFixed_` 트리거의 첫 실행 멱등성/권한은 컨트롤러가 별도로 검증(에디터에서 1회 Run 또는 트리거 대기 후 ledger에 이번달 고정비 자동기록·중복 없음 확인). 시드 금액은 사용자가 앱에서 조정 가능.

---

## Task G4: 앱 — 고정비 탭 + FixedView

**Files:** `src/App.tsx`, `src/App.css`

- [ ] **Step 1: import** — App.tsx의 `./dashboardLogic` import에 `fixedRemaining, type FixedDef` 추가; `./sync/syncClient` import에 `loadFixedDefs, saveFixedDef, deleteFixedDef` 추가; lucide import에 `CalendarClock` 추가(고정비 탭 아이콘; 없으면 `Repeat` 사용).

- [ ] **Step 2: Tab 타입 + 탭버튼** — `type Tab = 'dashboard' | 'ledger' | 'assets' | 'insights'`를 `... | 'fixed'`로 확장. tab-bar의 `insights` TabButton 다음(또는 ledger 다음)에:
```tsx
        <TabButton tab="fixed" activeTab={activeTab} icon={<CalendarClock size={18} />} label="고정비" onClick={setActiveTab} />
```

- [ ] **Step 3: 탭 렌더 + FixedView 마운트** — App 렌더의 탭 조건부들 옆에:
```tsx
      {activeTab === 'fixed' && <FixedView monthKey={summary.monthKey} />}
```
(`summary.monthKey`는 'yyyy-MM' 형식. App에 `summary` 존재.)

- [ ] **Step 4: FixedView 컴포넌트 추가** — App.tsx에 추가:
```tsx
function emptyFixedDef(monthKey: string): FixedDef {
  return { id: '', active: true, name: '', amount: 0, category: '', subCategory: '', payment: '카드', payDay: 1, startMonth: monthKey, installmentTotal: null }
}

function FixedView({ monthKey }: { monthKey: string }) {
  const [defs, setDefs] = useState<FixedDef[]>([])
  const [editing, setEditing] = useState<FixedDef | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = () => { loadFixedDefs().then(setDefs).catch(() => setDefs([])) }
  useEffect(() => { reload() }, [])

  const activeTotal = defs.filter((d) => d.active).reduce((s, d) => s + d.amount, 0)

  async function save(def: FixedDef) {
    setBusy(true)
    const ok = await saveFixedDef(def).catch(() => false)
    setBusy(false)
    if (ok) { setEditing(null); reload() }
  }
  async function remove(id: string) {
    setBusy(true)
    const ok = await deleteFixedDef(id).catch(() => false)
    setBusy(false)
    if (ok) { setEditing(null); reload() }
  }
  async function toggle(def: FixedDef) {
    await saveFixedDef({ ...def, active: !def.active }).catch(() => false)
    reload()
  }

  return (
    <section className="view-stack">
      <div className="fixed-head">
        <div>
          <p className="eyebrow">월 고정비</p>
          <h2>{formatMoney(activeTotal)}</h2>
        </div>
        <button type="button" className="fixed-add" onClick={() => setEditing(emptyFixedDef(monthKey))}>+ 추가</button>
      </div>

      <div className="fixed-list">
        {defs.map((d) => {
          const rem = fixedRemaining(d, monthKey)
          return (
            <article className={`fixed-row${d.active ? '' : ' off'}`} key={d.id}>
              <button type="button" className="fixed-main" onClick={() => setEditing(d)}>
                <div>
                  <p className="row-title">{d.name}</p>
                  <p className="row-meta">
                    {formatMoney(d.amount)} · 매월 {d.payDay}일
                    {rem && (rem.done ? ' · 완료' : ` · ${rem.count}/${rem.total}회 · 남은 ${formatMoney(rem.remainingAmount)}`)}
                  </p>
                </div>
              </button>
              <button type="button" className={`fixed-toggle${d.active ? ' on' : ''}`} onClick={() => toggle(d)} aria-label="활성 토글">
                {d.active ? 'ON' : 'OFF'}
              </button>
            </article>
          )
        })}
        {defs.length === 0 && <p className="cat-empty">고정비가 없습니다. + 추가로 등록하세요.</p>}
      </div>

      {editing && (
        <FixedEditSheet
          def={editing}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={remove}
        />
      )}
    </section>
  )
}

function FixedEditSheet({ def, busy, onClose, onSave, onDelete }: {
  def: FixedDef
  busy: boolean
  onClose: () => void
  onSave: (def: FixedDef) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState<FixedDef>(def)
  const set = (patch: Partial<FixedDef>) => setDraft((d) => ({ ...d, ...patch }))
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="cat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cat-sheet-head">
          <div className="cat-sheet-title"><h3>{def.id ? '고정비 수정' : '고정비 추가'}</h3></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="fixed-form">
          <label>이름<input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>금액<input type="number" value={draft.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} /></label>
          <label>대분류<input value={draft.category} onChange={(e) => set({ category: e.target.value })} /></label>
          <label>소분류<input value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} /></label>
          <label>결제수단<input value={draft.payment} onChange={(e) => set({ payment: e.target.value })} /></label>
          <label>납부일<input type="number" min={1} max={31} value={draft.payDay || ''} onChange={(e) => set({ payDay: Number(e.target.value) || 1 })} /></label>
          <label>시작월(yyyy-MM)<input value={draft.startMonth} onChange={(e) => set({ startMonth: e.target.value })} /></label>
          <label>할부 총회차(없으면 비움)<input type="number" value={draft.installmentTotal ?? ''} onChange={(e) => set({ installmentTotal: e.target.value === '' ? null : Number(e.target.value) })} /></label>
        </div>
        <div className="fixed-actions">
          {def.id && <button type="button" className="fixed-del" disabled={busy} onClick={() => onDelete(def.id)}>삭제</button>}
          <button type="button" className="fixed-save" disabled={busy || !draft.name} onClick={() => onSave(draft)}>{busy ? '저장 중…' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: CSS** — `src/App.css`에 추가:
```css
.fixed-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.fixed-add { background: var(--accent-tan); color: #fff; border: none; border-radius: 14px; padding: 9px 14px; font-size: 13px; font-weight: 700; cursor: pointer; }
.fixed-list { display: flex; flex-direction: column; gap: 10px; }
.fixed-row { display: flex; align-items: center; gap: 8px; background: var(--surface-solid); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
.fixed-row.off { opacity: .5; }
.fixed-main { flex: 1; background: none; border: none; text-align: left; cursor: pointer; padding: 0; }
.fixed-toggle { flex: 0 0 auto; border: 1px solid var(--line); background: var(--bg); color: var(--muted); border-radius: 10px; padding: 5px 10px; font-size: 11px; font-weight: 700; cursor: pointer; }
.fixed-toggle.on { background: var(--accent-tan); color: #fff; border-color: var(--accent-tan); }
.fixed-form { display: flex; flex-direction: column; gap: 10px; margin: 8px 0 14px; }
.fixed-form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.fixed-form input { background: var(--surface-solid); border: 1.5px solid var(--line); border-radius: 12px; padding: 9px 11px; color: var(--ink); font-size: 14px; }
.fixed-actions { display: flex; gap: 8px; }
.fixed-save { flex: 1; background: var(--accent-tan); color: #fff; border: none; border-radius: 14px; padding: 11px; font-size: 14px; font-weight: 700; cursor: pointer; }
.fixed-del { background: none; border: 1px solid var(--line); color: var(--danger, #b8654a); border-radius: 14px; padding: 11px 16px; font-size: 14px; cursor: pointer; }
```

- [ ] **Step 6: 빌드 + 테스트** — `npm run build` 클린, `npm test` 통과.

- [ ] **Step 7: Commit** —
```bash
git add src/App.tsx src/App.css
git commit -m "feat: 고정비 탭 + 목록/편집(할부 잔액 표시)"
```

---

## Task G5: 배포 + 시각검증

**Files:** 없음

- [ ] **Step 1: 머지 + 배포** — feature 브랜치면 main 머지 후 `npm run deploy`(sandbox off) → `Published`.
- [ ] **Step 2: 전파 확인** — `curl ... index.html | grep assets` 새 해시.
- [ ] **Step 3: Chrome 검증** — 배포본(SW 캐시 정리). 고정비 탭 → 목록(13개)·월 고정비 합계·맥북 할부 "X/14회 · 남은 NN원" 배지 확인. 항목 추가/수정/토글 동작 → fixedList 반영. (변경한 테스트 항목은 삭제 복원.)
- [ ] **Step 4: 자동입력 검증** — `autoPostFixed_` 트리거 1회 실행(에디터 Run 또는 트리거 대기) 후 ledger에 이번달 고정비 자동기록 + 재실행 시 중복 없음 확인(컨트롤러). 검증 후 서버 store 비움.

---

## 검증 기준
- [ ] `npm test` 통과(fixedRemaining/fixed CRUD 포함), `npm run build` 클린
- [ ] `v2_고정비` 시트 시드 13개, fixedList/fixedSave/fixedDelete 동작
- [ ] `autoPostFixed_` 멱등 자동입력(중복 skip, 할부 회차 종료 시 중단), 트리거 설치
- [ ] 앱 고정비 탭: 목록·합계·할부 잔액 배지·추가/수정/토글
- [ ] 배포 후 실제 동작 확인, setup 분기 제거
