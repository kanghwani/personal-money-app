# 백엔드 동기화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가계부 앱 데이터를 Google Sheets에 JSON으로 자동 동기화해 PC·폰 등 여러 기기에서 같은 데이터를 보고 입력할 수 있게 한다.

**Architecture:** 기존 Google Apps Script Web App에 토큰 인증 기반 load/save 분기를 추가하고, `AppState` 시트 한 셀에 FinanceStore 전체를 JSON으로 저장한다. React 앱은 localStorage를 오프라인 캐시로 유지하면서, 마운트 시 서버에서 pull하고 변경 시 2초 debounce로 push한다(last-write-wins by `updatedAt`).

**Tech Stack:** React 19 + TypeScript + Vite, Vitest(신규), Google Apps Script + Google Sheets.

**참고 경로:** Apps Script 파일은 앱 저장소 밖에 있음 → `/Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs`. 나머지는 `personal-money-app/` 기준.

---

## File Structure

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `src/sync/merge.ts` | `pickNewer()` — updatedAt 비교로 최신 스냅샷 선택 (순수함수) | 신규 |
| `src/sync/merge.test.ts` | merge 단위 테스트 | 신규 |
| `src/sync/syncClient.ts` | 서버 load/save + 환경변수 config (CORS preflight 회피) | 신규 |
| `src/sync/syncClient.test.ts` | syncClient 단위 테스트(fetch 모킹) | 신규 |
| `src/App.tsx` | `usePersistentStore` 동기화 확장 + 헤더 상태 표시 | 수정 |
| `src/vite-env.d.ts` | `VITE_SYNC_URL`/`VITE_SYNC_TOKEN` 타입 | 신규/수정 |
| `.env` | 토큰·URL (gitignore됨) | 신규 |
| `vite.config.ts` | vitest 설정 추가 | 수정 |
| `package.json` | vitest devDep + test 스크립트 | 수정 |
| `manage_money_apps_script.gs` | doGet/doPost 동기화 분기 + 헬퍼 | 수정 |

---

## Task 1: Vitest + 환경변수 스캐폴딩

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create/Modify: `src/vite-env.d.ts`
- Create: `.env`
- Verify: `.gitignore` (이미 `*.local`/`node_modules` 포함 — `.env` 라인 추가 필요)

- [ ] **Step 1: vitest 설치**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm i -D vitest
```
Expected: `added` 메시지, `package.json` devDependencies에 `vitest` 추가.

- [ ] **Step 2: test 스크립트 추가**

`package.json`의 `"scripts"` 블록에 다음 줄 추가(기존 줄 유지):
```json
    "test": "vitest run",
```
(예: `"lint": "eslint ."` 아래에 추가)

- [ ] **Step 3: vite.config.ts에 vitest 설정 추가**

`vite.config.ts` 전체를 아래로 교체:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: 환경변수 타입 선언**

`src/vite-env.d.ts`를 아래 내용으로 생성(이미 있으면 `ImportMetaEnv` 블록을 덧붙임):
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string
  readonly VITE_SYNC_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

- [ ] **Step 5: .env 생성 (값은 나중에 Task 4에서 채움)**

`.env` 파일 생성:
```
VITE_SYNC_URL=
VITE_SYNC_TOKEN=
```

- [ ] **Step 6: .gitignore에 .env 추가**

`.gitignore`에 `*.local` 근처에 다음 줄 추가:
```
.env
```
확인 Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && git check-ignore .env
```
Expected: `.env` 출력(무시됨).

- [ ] **Step 7: 빈 vitest 동작 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run
```
Expected: "No test files found" (에러 없이 종료). 테스트 러너가 정상 동작함을 확인.

- [ ] **Step 8: Commit**

```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
git add package.json package-lock.json vite.config.ts src/vite-env.d.ts .gitignore
git commit -m "chore: vitest 설정 및 동기화 환경변수 스캐폴딩"
```

---

## Task 2: merge.ts — pickNewer 순수함수 (TDD)

**Files:**
- Create: `src/sync/merge.ts`
- Test: `src/sync/merge.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/sync/merge.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { pickNewer, type Snapshot } from './merge'

const snap = (updatedAt: string, n: number): Snapshot<{ n: number }> => ({
  store: { n },
  updatedAt,
})

describe('pickNewer', () => {
  it('remote가 null이면 local 반환', () => {
    const local = snap('2026-06-07T10:00:00.000Z', 1)
    expect(pickNewer(local, null)).toBe(local)
  })

  it('remote가 더 최신이면 remote 반환', () => {
    const local = snap('2026-06-07T10:00:00.000Z', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(remote)
  })

  it('local이 더 최신이면 local 반환', () => {
    const local = snap('2026-06-07T12:00:00.000Z', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(local)
  })

  it('동률이면 local 우선', () => {
    const local = snap('2026-06-07T11:00:00.000Z', 1)
    const remote = snap('2026-06-07T11:00:00.000Z', 2)
    expect(pickNewer(local, remote)).toBe(local)
  })

  it('remote updatedAt가 유효하지 않으면 local 반환', () => {
    const local = snap('2026-06-07T10:00:00.000Z', 1)
    const remote = snap('garbage', 2)
    expect(pickNewer(local, remote)).toBe(local)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/sync/merge.test.ts
```
Expected: FAIL — `Failed to resolve import './merge'` (모듈 없음).

- [ ] **Step 3: 최소 구현**

`src/sync/merge.ts`:
```ts
export type Snapshot<T> = { store: T; updatedAt: string }

/** updatedAt(ISO) 비교로 더 최신 스냅샷을 반환한다. 동률·무효는 local 우선. */
export function pickNewer<T>(local: Snapshot<T>, remote: Snapshot<T> | null): Snapshot<T> {
  if (!remote) return local
  const l = Date.parse(local.updatedAt)
  const r = Date.parse(remote.updatedAt)
  if (Number.isNaN(r)) return local
  if (Number.isNaN(l)) return remote
  return r > l ? remote : local
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/sync/merge.test.ts
```
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
git add src/sync/merge.ts src/sync/merge.test.ts
git commit -m "feat: pickNewer 동기화 병합 순수함수 (TDD)"
```

---

## Task 3: syncClient.ts — 서버 load/save (TDD, fetch 모킹)

**Files:**
- Create: `src/sync/syncClient.ts`
- Test: `src/sync/syncClient.test.ts`

설계 메모: 쓰기는 `Content-Type: text/plain`로 보내 CORS preflight를 회피한다. store는 와이어 상에서 JSON 문자열로 주고받는다(서버 셀이 문자열을 저장하므로).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/sync/syncClient.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { loadFromServer, saveToServer, type SyncConfig } from './syncClient'

const cfg: SyncConfig = { url: 'https://script.example/exec', token: 'secret-tok' }

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loadFromServer', () => {
  it('cfg가 없으면 null', async () => {
    expect(await loadFromServer(null)).toBeNull()
  })

  it('action=load&token 쿼리로 GET하고 store를 파싱한다', async () => {
    const store = { n: 1 }
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, store: JSON.stringify(store), updatedAt: '2026-06-07T11:00:00.000Z' }),
    })
    const result = await loadFromServer<typeof store>(cfg)
    const calledUrl = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(calledUrl).toContain('action=load')
    expect(calledUrl).toContain('token=secret-tok')
    expect(result).toEqual({ store, updatedAt: '2026-06-07T11:00:00.000Z' })
  })

  it('서버가 빈 store면 null', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, store: '', updatedAt: '' }),
    })
    expect(await loadFromServer(cfg)).toBeNull()
  })
})

describe('saveToServer', () => {
  it('text/plain POST로 action=save 본문을 보낸다', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      json: async () => ({ ok: true, updatedAt: '2026-06-07T11:00:00.000Z' }),
    })
    const ok = await saveToServer({ n: 2 }, '2026-06-07T11:00:00.000Z', cfg)
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe(cfg.url)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('text/plain;charset=utf-8')
    const body = JSON.parse(init.body as string)
    expect(body.action).toBe('save')
    expect(body.token).toBe('secret-tok')
    expect(JSON.parse(body.store)).toEqual({ n: 2 })
    expect(ok).toBe(true)
  })

  it('cfg가 없으면 false', async () => {
    expect(await saveToServer({ n: 1 }, 'x', null)).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/sync/syncClient.test.ts
```
Expected: FAIL — `Failed to resolve import './syncClient'`.

- [ ] **Step 3: 최소 구현**

`src/sync/syncClient.ts`:
```ts
export type SyncConfig = { url: string; token: string }

export type RemoteSnapshot<T> = { store: T; updatedAt: string }

/** 환경변수에서 동기화 설정을 읽는다. 둘 중 하나라도 비면 null(동기화 비활성). */
export function getSyncConfig(): SyncConfig | null {
  const url = import.meta.env.VITE_SYNC_URL
  const token = import.meta.env.VITE_SYNC_TOKEN
  if (!url || !token) return null
  return { url, token }
}

export async function loadFromServer<T>(
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<RemoteSnapshot<T> | null> {
  if (!cfg) return null
  const url = `${cfg.url}?action=load&token=${encodeURIComponent(cfg.token)}`
  const res = await fetch(url, { method: 'GET', redirect: 'follow' })
  const data = await res.json()
  if (!data || !data.ok || !data.store) return null
  return { store: JSON.parse(data.store) as T, updatedAt: String(data.updatedAt || '') }
}

export async function saveToServer<T>(
  store: T,
  updatedAt: string,
  cfg: SyncConfig | null = getSyncConfig(),
): Promise<boolean> {
  if (!cfg) return false
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    redirect: 'follow',
    body: JSON.stringify({
      action: 'save',
      token: cfg.token,
      store: JSON.stringify(store),
      updatedAt,
    }),
  })
  const data = await res.json()
  return !!(data && data.ok)
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npx vitest run src/sync/syncClient.test.ts
```
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
git add src/sync/syncClient.ts src/sync/syncClient.test.ts
git commit -m "feat: syncClient load/save (text/plain로 CORS 회피, TDD)"
```

---

## Task 4: Apps Script 동기화 분기 (수동 배포·검증)

**Files:**
- Modify: `/Users/hwan/Documents/ManageMoney/manage_money_apps_script.gs`

로컬 단위 테스트가 불가능하므로(GAS 런타임 필요) 코드 추가 후 배포 + curl로 검증한다.

- [ ] **Step 1: 상수 추가**

`manage_money_apps_script.gs`에서 `SHEETS = { ... };` 블록(13행) 바로 아래에 추가:
```js
const APP_STATE_SHEET = 'AppState';
```

- [ ] **Step 2: doGet에 load 분기 추가**

기존 `doGet()`(503행)을 아래로 교체:
```js
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'load') {
    if (!checkToken_(params.token)) return json_({ ok: false, error: 'unauthorized' });
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const state = readAppState_(ss);
    return json_({ ok: true, store: state.store, updatedAt: state.updatedAt });
  }
  return json_({ ok: true, message: 'ManageMoney quick input is alive' });
}
```

- [ ] **Step 3: doPost에 save 분기 추가**

기존 `doPost(e)`의 시작부(507~510행):
```js
function doPost(e) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const body = parseBody_(e);
  const raw = String(body.raw || body.text || body.content || '').trim();
```
를 아래로 교체(앞에 save 분기 삽입, 기존 자연어 로직은 그대로 이어짐):
```js
function doPost(e) {
  const body = parseBody_(e);
  if (body && body.action === 'save') {
    if (!checkToken_(body.token)) return json_({ ok: false, error: 'unauthorized' });
    const ssSave = SpreadsheetApp.openById(SPREADSHEET_ID);
    const updatedAt = body.updatedAt || new Date().toISOString();
    writeAppState_(ssSave, String(body.store || ''), updatedAt);
    return json_({ ok: true, updatedAt });
  }

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const raw = String(body.raw || body.text || body.content || '').trim();
```
나머지 doPost 본문(자연어 파싱·appendRow 등)은 변경하지 않는다.

- [ ] **Step 4: 헬퍼 함수 추가**

파일 끝 `json_()` 함수(1402행) 아래에 추가:
```js
function checkToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('SYNC_TOKEN');
  return !!expected && String(token) === expected;
}

function readAppState_(ss) {
  const sheet = ss.getSheetByName(APP_STATE_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return { store: '', updatedAt: '' };
  const store = sheet.getRange('A1').getValue();
  const updatedAt = sheet.getRange('B1').getValue();
  return { store: String(store || ''), updatedAt: String(updatedAt || '') };
}

function writeAppState_(ss, storeJson, updatedAt) {
  const sheet = ensureSheet_(ss, APP_STATE_SHEET);
  sheet.getRange('A1').setValue(storeJson);
  sheet.getRange('B1').setValue(updatedAt);
  SpreadsheetApp.flush();
}

/** 최초 1회 실행: 동기화 토큰을 Script Properties에 저장. 실행 후 이 줄의 값은 비워둘 것. */
function setSyncToken() {
  PropertiesService.getScriptProperties().setProperty('SYNC_TOKEN', 'PUT-A-LONG-RANDOM-TOKEN-HERE');
}
```
> 참고: 시트 셀은 약 50,000자까지 저장 가능. 개인 가계부 규모에선 충분하나, 초과 시 분할 저장이 필요(현재 범위 밖).

- [ ] **Step 5: Apps Script 편집기에 반영 + 토큰 설정**

1. Apps Script 프로젝트 편집기에 위 변경을 붙여넣는다.
2. `setSyncToken` 함수의 `'PUT-A-LONG-RANDOM-TOKEN-HERE'`를 충분히 긴 랜덤 문자열로 바꾼다(예: `openssl rand -hex 24`로 생성).
3. 편집기에서 `setSyncToken`를 1회 실행(권한 승인). 실행 후 코드의 토큰 문자열은 다시 placeholder로 되돌려 저장(평문 노출 방지).
4. **배포 → 배포 관리 → 새 버전**으로 웹앱을 재배포. 액세스: "모든 사용자(익명 포함)". `/exec` URL을 복사.

토큰 생성 Run(참고):
```bash
openssl rand -hex 24
```

- [ ] **Step 6: load 검증 (curl)**

Run(`<EXEC_URL>`, `<TOKEN>` 치환):
```bash
curl -sL "<EXEC_URL>?action=load&token=<TOKEN>"
```
Expected: `{"ok":true,"store":"","updatedAt":""}` (아직 저장 전이라 빈 값).

토큰 틀렸을 때:
```bash
curl -sL "<EXEC_URL>?action=load&token=wrong"
```
Expected: `{"ok":false,"error":"unauthorized"}`.

- [ ] **Step 7: save 검증 (curl)**

Run:
```bash
curl -sL -X POST "<EXEC_URL>" \
  -H "Content-Type: text/plain;charset=utf-8" \
  --data '{"action":"save","token":"<TOKEN>","store":"{\"hello\":1}","updatedAt":"2026-06-07T11:00:00.000Z"}'
```
Expected: `{"ok":true,"updatedAt":"2026-06-07T11:00:00.000Z"}`.

이어서 load 재확인:
```bash
curl -sL "<EXEC_URL>?action=load&token=<TOKEN>"
```
Expected: `{"ok":true,"store":"{\"hello\":1}","updatedAt":"2026-06-07T11:00:00.000Z"}`.

- [ ] **Step 8: 기존 빠른입력 회귀 확인**

Run(자연어 입력이 여전히 동작하는지):
```bash
curl -sL -X POST "<EXEC_URL>" \
  -H "Content-Type: text/plain;charset=utf-8" \
  --data '{"raw":"오늘 5000 커피 토스 변동"}'
```
Expected: `{"ok":true,"status":...,"parsed":{...}}` (기존 형식 응답). 시트 `v2_빠른입력`에 행 추가 확인.

- [ ] **Step 9: .env 채우기**

`personal-money-app/.env`에 검증된 값 입력:
```
VITE_SYNC_URL=<EXEC_URL>
VITE_SYNC_TOKEN=<TOKEN>
```

- [ ] **Step 10: Commit (.gs는 상위 저장소 소속)**

```bash
cd /Users/hwan/Documents/ManageMoney
git add manage_money_apps_script.gs
git commit -m "feat: Apps Script 동기화 load/save 분기 + 토큰 인증"
```
> `.env`는 gitignore되어 커밋되지 않음(정상).

---

## Task 5: App.tsx 통합 — 동기화 훅 + 헤더 상태 표시

**Files:**
- Modify: `src/App.tsx` (import 추가, `usePersistentStore` 교체, `App` 호출부, 헤더 JSX)

- [ ] **Step 1: import 추가**

`src/App.tsx` 최상단 import 영역에 추가:
```ts
import { useRef } from 'react'
import { pickNewer } from './sync/merge'
import { getSyncConfig, loadFromServer, saveToServer } from './sync/syncClient'
```
> 이미 `import { useState, useEffect, useMemo } from 'react'` 형태가 있으면 `useRef`만 그 목록에 추가.

- [ ] **Step 2: 상수 추가**

`const STORAGE_KEY = 'personal-money-app:v1'`(108행) 아래에 추가:
```ts
const UPDATED_AT_KEY = 'personal-money-app:v1:updatedAt'
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'
```

- [ ] **Step 3: usePersistentStore 교체**

기존 `usePersistentStore`(870~890행) 전체를 아래로 교체:
```ts
function usePersistentStore() {
  const [store, setStore] = useState<FinanceStore>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return seedData
    try {
      const parsed = JSON.parse(saved) as FinanceStore
      if (typeof parsed.budget !== 'number') {
        parsed.budget = seedData.budget
      }
      return parsed
    } catch {
      return seedData
    }
  })
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const updatedAtRef = useRef<string>(
    window.localStorage.getItem(UPDATED_AT_KEY) || new Date(0).toISOString(),
  )
  const skipNextPush = useRef(true) // 최초 마운트 저장 + 서버 적용분은 push 생략
  const applyingRemote = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)

  async function pushNow(current: FinanceStore, stamp: string) {
    setSyncStatus('syncing')
    try {
      const ok = await saveToServer(current, stamp)
      setSyncStatus(ok ? 'idle' : 'error')
    } catch {
      setSyncStatus('offline')
    }
  }

  // 마운트 시 서버에서 pull
  useEffect(() => {
    if (!getSyncConfig()) return
    let cancelled = false
    setSyncStatus('syncing')
    loadFromServer<FinanceStore>()
      .then((remote) => {
        if (cancelled) return
        const local = { store, updatedAt: updatedAtRef.current }
        const winner = pickNewer(local, remote)
        if (winner !== local) {
          applyingRemote.current = true
          updatedAtRef.current = winner.updatedAt
          window.localStorage.setItem(UPDATED_AT_KEY, winner.updatedAt)
          setStore(winner.store)
          setSyncStatus('idle')
        } else if (remote === null) {
          // 서버가 비어 있으면 현재 로컬 데이터를 업로드(기존 입력 보존)
          const stamp = new Date().toISOString()
          updatedAtRef.current = stamp
          window.localStorage.setItem(UPDATED_AT_KEY, stamp)
          void pushNow(store, stamp)
        } else {
          setSyncStatus('idle')
        }
      })
      .catch(() => {
        if (!cancelled) setSyncStatus('offline')
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 변경 시 localStorage 저장 + debounce push
  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
    if (skipNextPush.current) {
      skipNextPush.current = false
      return
    }
    if (applyingRemote.current) {
      applyingRemote.current = false
      return
    }
    if (!getSyncConfig()) return
    const stamp = new Date().toISOString()
    updatedAtRef.current = stamp
    window.localStorage.setItem(UPDATED_AT_KEY, stamp)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      void pushNow(store, stamp)
    }, 2000)
    return () => window.clearTimeout(saveTimer.current)
  }, [store])

  const syncNow = () => {
    if (!getSyncConfig()) return
    const stamp = new Date().toISOString()
    updatedAtRef.current = stamp
    window.localStorage.setItem(UPDATED_AT_KEY, stamp)
    void pushNow(store, stamp)
  }

  return [store, setStore, syncStatus, syncNow] as const
}
```

- [ ] **Step 4: App 호출부 수정**

`const [store, setStore] = usePersistentStore()`(164행)를 교체:
```ts
  const [store, setStore, syncStatus, syncNow] = usePersistentStore()
```

- [ ] **Step 5: 헤더에 상태 표시 + 수동 동기화 버튼 추가**

헤더의 내보내기 버튼(242~244행) 바로 앞에 삽입:
```tsx
        <button
          className="icon-button"
          type="button"
          onClick={syncNow}
          aria-label="동기화"
          title={
            syncStatus === 'syncing' ? '동기화 중' :
            syncStatus === 'offline' ? '오프라인' :
            syncStatus === 'error' ? '동기화 오류' : '동기화됨'
          }
        >
          <RefreshCw size={18} className={syncStatus === 'syncing' ? 'spin' : undefined} />
        </button>
```
그리고 lucide 아이콘 import에 `RefreshCw` 추가(기존 `import { Download, X, ... } from 'lucide-react'` 목록에 추가).

- [ ] **Step 6: (선택) 회전 애니메이션 CSS**

`src/App.css` 끝에 추가:
```css
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 7: 타입체크 + 빌드 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm run build
```
Expected: `tsc -b` 통과 + `vite build` 성공(`dist/` 생성). 타입 에러 없음.

- [ ] **Step 8: 전체 테스트 재확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm test
```
Expected: merge + syncClient 테스트 모두 PASS.

- [ ] **Step 9: Commit**

```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
git add src/App.tsx src/App.css
git commit -m "feat: 앱에 Google Sheets 자동 동기화 연결 + 헤더 상태 표시"
```

---

## Task 6: 배포 + 엔드투엔드 검증

**Files:** 없음(배포·검증 단계)

- [ ] **Step 1: 로컬에서 dev 동기화 확인**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm run dev
```
브라우저에서 앱 열기 → 거래 1건 입력 → 헤더 동기화 아이콘이 잠깐 회전 후 멈춤. 약 2초 후.
검증 Run(다른 터미널):
```bash
curl -sL "<EXEC_URL>?action=load&token=<TOKEN>"
```
Expected: `store`에 방금 입력한 거래가 포함된 JSON 문자열.

- [ ] **Step 2: 빌드 base 경로 점검 (gh-pages용)**

> 현재 `vite.config.ts`의 `base`는 `'/'`지만 GitHub Pages는 `/personal-money-app/` 하위다. 배포 전 base를 맞춘다. `vite.config.ts`의 `base: '/'`를 `base: '/personal-money-app/'`로 변경.

변경 후 Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm run build && grep -o '/personal-money-app/assets/[^"]*' dist/index.html | head
```
Expected: 에셋 경로가 `/personal-money-app/assets/...`로 출력.

- [ ] **Step 3: 배포**

Run:
```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app && npm run deploy
```
Expected: gh-pages 브랜치에 `dist` 푸시 완료.

- [ ] **Step 4: 외부(폰) 엔드투엔드 검증**

1. PC 브라우저에서 https://kanghwani.github.io/personal-money-app/ 열기 → 거래 입력.
2. 폰(LTE/5G, 다른 네트워크)에서 같은 주소 열기 → PC에서 입력한 거래가 보이는지 확인.
3. 폰에서 거래 추가 → PC 새로고침 후 반영 확인.
4. 비행기모드 등으로 오프라인 시 입력 → 복귀 후 동기화 아이콘 수동 클릭 → 서버 반영 확인.

Expected: 양방향으로 데이터가 동기화됨.

- [ ] **Step 5: base 변경 커밋**

```bash
cd /Users/hwan/Documents/ManageMoney/personal-money-app
git add vite.config.ts
git commit -m "fix: gh-pages 서브경로에 맞춰 vite base 설정"
```

---

## 검증 기준 (전체)

- [ ] `npm test` — merge/syncClient 단위 테스트 통과
- [ ] `npm run build` — 타입체크·빌드 성공
- [ ] curl로 Apps Script load/save 동작 + 기존 빠른입력 회귀 없음
- [ ] PC↔폰(외부 네트워크) 양방향 데이터 동기화 확인
- [ ] 오프라인 시 앱 동작 유지 + 복귀 후 동기화
