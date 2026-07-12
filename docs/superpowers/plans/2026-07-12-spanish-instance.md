# 브리 전용 스페인어 인스턴스 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 백엔드에 `profile=es` 전용 탭을 쓰는, 스페인어 UI·스페인어 자동분류 가계부 인스턴스를 브리타니용으로 만든다.

**Architecture:** 백엔드 GAS는 `SHEETS`를 접두어 기반으로 바꿔 요청 `profile`에 따라 `v2_`(너)/`es_`(브리) 탭 세트를 고른다. 프론트는 같은 코드에 빌드 env(`VITE_PROFILE`, `VITE_LANG`)로 분기: syncClient가 profile을 실어 보내고, 분류 규칙·UI 문자열을 언어별로 선택한다. 브리 데이터는 처음부터 스페인어로 저장(번역 맵 불필요).

**Tech Stack:** React + TypeScript + Vite, Google Apps Script, vitest, Vercel.

## Global Constraints

- 브리도 한국 거주·원화(₩) → 기존 `formatMoney` 그대로, 통화 분기 없음.
- `profile` 미전달 시 백엔드는 `v2_` 기본 → **기존 네 앱 무영향(하위호환 필수)**.
- 브리 데이터 카테고리는 스페인어로 저장(예: `Cafetería`), 미분류 = `Sin categoría`.
- 언어 토글 없음: 빌드 시 `VITE_LANG`으로 고정(ko 기본).
- 같은 토큰 재사용(암호적 격리 아님, 수용).
- 테스트: `npm test`(= `vitest run`), cwd = `personal-money-app`.
- 커밋 분리: GAS는 `/Users/hwan` repo(홈), 앱은 `personal-money-app` repo(main).

---

### Task 1: 백엔드 프로필 파라미터 (GAS)

**Files:**
- Modify: `manage_money_apps_script.gs:4-14` (SHEETS 상수), `:751-752`(doGet 상단), `:777-778`(doPost 상단)

**Interfaces:**
- Produces: 요청 `profile` 파라미터(`'es'` 또는 없음). `applyProfile_(profile)`가 전역 `SHEETS`를 접두어에 맞게 재구성. 55곳의 `SHEETS.*` 참조는 그대로 동작.

- [ ] **Step 1: SHEETS를 접두어 기반으로 교체**

`manage_money_apps_script.gs`의 `const SHEETS = {...}` 블록(4-14행)을 아래로 교체:

```javascript
var SHEET_PREFIX = 'v2_';   // 요청별로 applyProfile_에서 재설정(var: 재할당 허용)
function buildSheets_(p) {
  return {
    fast: p + '빠른입력',
    ledger: p + '거래원장',
    rules: p + '분류규칙',
    assets: p + '자산',
    loans: p + '대출',
    investments: p + '투자',
    report: p + '월간리포트',
    insights: p + '인사이트',
    fixedDefs: p + '고정비',
  };
}
var SHEETS = buildSheets_(SHEET_PREFIX);
// 프로필별 탭 세트 선택. 'es'면 브리 전용 es_ 탭, 그 외(빈값 포함)는 기존 v2_.
function applyProfile_(profile) {
  SHEET_PREFIX = (String(profile || '') === 'es') ? 'es_' : 'v2_';
  SHEETS = buildSheets_(SHEET_PREFIX);
}
```

- [ ] **Step 2: doGet/doPost 최상단에서 applyProfile_ 호출**

`function doGet(e) {` 다음 줄, `const params = (e && e.parameter) || {};` 바로 뒤에 추가:

```javascript
  applyProfile_(params.profile);
```

`function doPost(e) {` 본문에서 body를 파싱한 직후(첫 `if (body && body.action ...)` 이전)에 추가:

```javascript
  applyProfile_(body && body.profile);
```

(doPost는 `const body = parseBody_(e)` 형태로 body를 먼저 얻는다. 그 직후에 넣는다.)

- [ ] **Step 3: 문법 확인**

Run: `cp manage_money_apps_script.gs /tmp/c.js && node --check /tmp/c.js && echo OK && rm /tmp/c.js`
Expected: `OK`

- [ ] **Step 4: 커밋**

```bash
cd /Users/hwan && git commit -q -m "feat(gas): profile 파라미터로 es_ 전용 탭 세트 선택" -- Documents/ManageMoney/manage_money_apps_script.gs
```

- [ ] **Step 5: Monaco 재배포 (Chrome)**

Chrome Apps Script 편집기에서 위 3개 편집을 Monaco에 반영(base64 targeted-replace, `code.replace(old, () => new)` 패턴) → 저장 → 배포 > 배포 관리 > 연필 > 새 버전 > 배포. 새 버전 번호 확인.

- [ ] **Step 6: 배포 후 검증 (무금액 파서 재현 + es 조회)**

Run:
```bash
URL="https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec"
TOKEN="e281628c253994a8e3e011219133a2d04955d224134e8a2d"
python3 -c "
import urllib.request,urllib.parse,json
# es 프로필 무금액 입력(파서만 확인, 원장 미기록)
u='$URL?action=add&profile=es&token=$TOKEN&raw='+urllib.parse.quote('café tarjeta')
print('es add:', json.load(urllib.request.urlopen(u)).get('ok'))
# es 원장 조회(빈 배열이어도 ok:true면 탭 접근 성공)
u2='$URL?action=ledger&profile=es&token=$TOKEN'
print('es ledger ok:', json.load(urllib.request.urlopen(u2)).get('ok'))
# v2(기존) 무영향 확인
u3='$URL?action=ledger&token=$TOKEN'
d=json.load(urllib.request.urlopen(u3))
print('v2 ledger 건수:', len(d.get('transactions',[])))
"
```
Expected: `es add: True`, `es ledger ok: True`, `v2 ledger 건수: 5xx`(기존 유지). es 무금액 입력은 원장 미기록이라 정리 불필요.

---

### Task 2: syncClient 프로필 전달

**Files:**
- Modify: `personal-money-app/src/sync/syncClient.ts` (SyncConfig, getSyncConfig, 모든 요청 함수)

**Interfaces:**
- Consumes: `import.meta.env.VITE_PROFILE`.
- Produces: 모든 GET URL에 `&profile=<p>`(p 비면 생략), 모든 POST 본문에 `profile: p`.

- [ ] **Step 1: SyncConfig에 profile 추가 + getSyncConfig 갱신**

`src/sync/syncClient.ts`에서:

```typescript
export type SyncConfig = { url: string; token: string; profile: string }
```

`getSyncConfig()`의 return을 교체:

```typescript
  const profile = import.meta.env.VITE_PROFILE || ''
  return { url, token, profile }
```

- [ ] **Step 2: GET 요청 3곳에 profile 쿼리 추가**

`loadFromServer`, `loadLedger`, `loadFixedDefs`의 URL에 profile을 붙인다. 헬퍼를 파일 상단(함수들 위)에 추가:

```typescript
/** profile이 있으면 &profile=... 반환, 없으면 빈 문자열. */
function profileQuery(cfg: SyncConfig): string {
  return cfg.profile ? `&profile=${encodeURIComponent(cfg.profile)}` : ''
}
```

그리고 각 GET URL 끝에 `${profileQuery(cfg)}`를 추가:
- `loadFromServer`: `` `${cfg.url}?action=load&token=${encodeURIComponent(cfg.token)}${profileQuery(cfg)}` ``
- `loadLedger`: `` `${cfg.url}?action=ledger&token=${encodeURIComponent(cfg.token)}${profileQuery(cfg)}` ``
- `loadFixedDefs`: `` `${cfg.url}?action=fixedList&token=${encodeURIComponent(cfg.token)}${profileQuery(cfg)}` ``

- [ ] **Step 3: POST 본문 7곳에 profile 추가**

`saveToServer`, `assignCategory`, `saveFixedDef`, `deleteFixedDef`, `deleteLedger`, `updateLedger`, `appendLedger`의 `JSON.stringify({ ... })` 객체에 `profile: cfg.profile`를 추가한다. 예(`appendLedger`):

```typescript
    body: JSON.stringify({ action: 'appendLedger', token: cfg.token, tx, profile: cfg.profile }),
```

나머지 6개도 동일하게 각 body 객체에 `profile: cfg.profile` 한 필드씩 추가.

- [ ] **Step 4: 타입/빌드 확인**

Run: `cd personal-money-app && npx tsc --noEmit`
Expected: 에러 0. (기존 네 앱은 `VITE_PROFILE` 미설정 → profile `''` → 쿼리/필드 빈값 → 백엔드 v2_ 기본. 무영향.)

- [ ] **Step 5: 커밋**

```bash
cd personal-money-app && git add src/sync/syncClient.ts && git commit -m "feat(sync): 요청에 profile 파라미터 전달(브리 es 인스턴스용)"
```

---

### Task 3: 언어별 분류 규칙 (ko/es) + 파서 배선

**Files:**
- Create: `personal-money-app/src/classifyRules.ts`
- Create: `personal-money-app/src/classifyRules.test.ts`
- Modify: `personal-money-app/src/App.tsx` (categoryRules 제거, classify/extractPayment/extractDate/extractFixedType/isFixed/parseTransactionEntry가 규칙셋 참조)

**Interfaces:**
- Produces:
  - `type Lang = 'ko' | 'es'`
  - `LANG: Lang` (env `VITE_LANG`)
  - `type CatRule = { words: string[]; category: string; sub: string }`
  - `type RuleSet = { categoryRules: CatRule[]; payments: string[]; paymentAlias: Record<string,string>; yesterday: string; today: string; incomeRe: RegExp; uncategorized: string }`
  - `RULES: Record<Lang, RuleSet>`
  - `classifyMemo(memo: string, rules: RuleSet): { category: string; sub: string }`

- [ ] **Step 1: 실패 테스트 작성**

`src/classifyRules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { RULES, classifyMemo } from './classifyRules'

describe('classifyMemo es', () => {
  const es = RULES.es
  it('café → Cafetería', () => {
    expect(classifyMemo('café con leche', es)).toEqual({ category: 'Comida', sub: 'Cafetería' })
  })
  it('supermercado → Comida/Supermercado', () => {
    expect(classifyMemo('supermercado Mercadona', es)).toEqual({ category: 'Comida', sub: 'Supermercado' })
  })
  it('미매칭 → Sin categoría', () => {
    expect(classifyMemo('xyzabc', es)).toEqual({ category: 'Sin categoría', sub: '' })
  })
})

describe('classifyMemo ko (기존 유지)', () => {
  const ko = RULES.ko
  it('커피 → 식비/카페', () => {
    expect(classifyMemo('커피 한잔', ko)).toEqual({ category: '식비', sub: '카페' })
  })
  it('미매칭 → 미분류', () => {
    expect(classifyMemo('zzz', ko)).toEqual({ category: '미분류', sub: '' })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd personal-money-app && npx vitest run src/classifyRules.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: classifyRules.ts 구현**

`src/classifyRules.ts`:

```typescript
export type Lang = 'ko' | 'es'
export const LANG: Lang = import.meta.env.VITE_LANG === 'es' ? 'es' : 'ko'

export type CatRule = { words: string[]; category: string; sub: string }
export type RuleSet = {
  categoryRules: CatRule[]
  payments: string[]              // extractPayment 후보(긴 것 먼저)
  paymentAlias: Record<string, string>  // normalizePayment 별칭
  yesterday: string
  today: string
  incomeRe: RegExp                // 수입 키워드
  uncategorized: string           // 미분류 라벨
}

const ko: RuleSet = {
  categoryRules: [
    { words: ['점심', '저녁', '밥', '식당', '라멘', '피자', '버거', '김밥', '마라탕'], category: '식비', sub: '외식' },
    { words: ['커피', '카페', '아메리카노', '라떼', '스타벅스', '투썸', '이디야', '빽다방', '컴포즈', '메가커피'], category: '식비', sub: '카페' },
    { words: ['마트', '장보기', '식자재', '쿠팡', '컬리', '코스트코', '홈플러스', '롯데마트', '이마트', '노브랜드', '와마트'], category: '식비', sub: '장보기' },
    { words: ['편의점', 'CU', 'GS25', '세븐일레븐'], category: '식비', sub: '간편식' },
    { words: ['다이소'], category: '생활', sub: '생활잡화' },
    { words: ['올리브영'], category: '생활', sub: '뷰티/미용' },
    { words: ['월세', '관리비', '전기', '가스', '인터넷', '통신'], category: '주거/통신', sub: '고정비' },
    { words: ['주차', '택시', '버스', '지하철', '자동차', '기름'], category: '교통/차량', sub: '이동' },
    { words: ['병원', '약', '수영', '헬스', '운동'], category: '건강', sub: '관리' },
    { words: ['넷플릭스', '구독', '애플', '네이버', '스포티파이'], category: '문화/구독', sub: '구독' },
    { words: ['게임', '스팀', '플레이', '취미'], category: '취미', sub: '게임' },
    { words: ['유니클로'], category: '쇼핑', sub: '의류' },
    { words: ['책', '강의', '학원', '공부', '교보문고'], category: '자기계발', sub: '교육' },
    { words: ['월급', '급여', '입금', '보너스'], category: '수입', sub: '급여' },
  ],
  payments: ['국민카드','삼성카드','현대카드','신한카드','하나카드','이음카드','우리카드','롯데카드','카카오뱅크','토스뱅크','네이버페이','카카오페이','계좌이체','체크카드','토스','국민','삼성','현대','신한','카카오','네이버','현금','계좌','이음','카드'],
  paymentAlias: { 토스: '토스뱅크', 국민: '국민카드', 삼성: '삼성카드', 현대: '현대카드', 신한: '신한카드', 카카오: '카카오페이', 네이버: '네이버페이', 계좌: '계좌이체', 이음: '이음카드' },
  yesterday: '어제',
  today: '오늘',
  incomeRe: /수입|월급|급여|입금|보너스/,
  uncategorized: '미분류',
}

const es: RuleSet = {
  categoryRules: [
    { words: ['café', 'cafetería', 'cafe', 'starbucks'], category: 'Comida', sub: 'Cafetería' },
    { words: ['supermercado', 'mercado', 'mercadona', 'carrefour', 'costco'], category: 'Comida', sub: 'Supermercado' },
    { words: ['restaurante', 'comida', 'almuerzo', 'cena', 'pizza', 'hamburguesa'], category: 'Comida', sub: 'Restaurante' },
    { words: ['tienda', 'conveniencia'], category: 'Vida', sub: 'Varios' },
    { words: ['alquiler', 'renta', 'luz', 'gas', 'internet', 'teléfono'], category: 'Vivienda', sub: 'Fijos' },
    { words: ['taxi', 'bus', 'metro', 'gasolina', 'coche', 'transporte'], category: 'Transporte', sub: 'Movilidad' },
    { words: ['farmacia', 'médico', 'hospital', 'gimnasio'], category: 'Salud', sub: 'Cuidado' },
    { words: ['netflix', 'suscripción', 'spotify', 'apple'], category: 'Ocio', sub: 'Suscripción' },
    { words: ['juego', 'steam', 'videojuego'], category: 'Ocio', sub: 'Juegos' },
    { words: ['ropa', 'zapatos', 'zara', 'uniqlo'], category: 'Compras', sub: 'Ropa' },
    { words: ['libro', 'curso', 'academia'], category: 'Desarrollo', sub: 'Educación' },
    { words: ['salario', 'nómina', 'sueldo', 'ingreso'], category: 'Ingreso', sub: 'Salario' },
  ],
  payments: ['tarjeta', 'efectivo', 'transferencia', 'débito', 'crédito'],
  paymentAlias: { débito: 'Tarjeta', crédito: 'Tarjeta', tarjeta: 'Tarjeta', efectivo: 'Efectivo', transferencia: 'Transferencia' },
  yesterday: 'ayer',
  today: 'hoy',
  incomeRe: /salario|nómina|sueldo|ingreso/i,
  uncategorized: 'Sin categoría',
}

export const RULES: Record<Lang, RuleSet> = { ko, es }

/** 메모를 규칙셋으로 분류. 대소문자 무시. 미매칭이면 uncategorized. */
export function classifyMemo(memo: string, rules: RuleSet): { category: string; sub: string } {
  const lower = memo.toLowerCase()
  const hit = rules.categoryRules.find((r) => r.words.some((w) => lower.includes(w.toLowerCase())))
  return hit ? { category: hit.category, sub: hit.sub } : { category: rules.uncategorized, sub: '' }
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd personal-money-app && npx vitest run src/classifyRules.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: App.tsx 배선 — 규칙셋 선택 + 함수 참조 교체**

`src/App.tsx` 상단 import에 추가:

```typescript
import { RULES, LANG, classifyMemo, type CatRule } from './classifyRules'
```

App.tsx의 모듈 상단(`const categoryRules = [...]` 113-128행)을 **삭제**하고 그 자리에:

```typescript
const R = RULES[LANG]
```

그리고 아래 함수들을 R 참조로 교체:

- `classify`(1928행) 전체를 교체:
```typescript
function classify(memo: string) {
  return classifyMemo(memo, R)
}
```

- `extractPayment`(1933행)의 `const paymentPatterns = [...]` 배열을 `const paymentPatterns = R.payments` 로 교체(나머지 로직 유지).

- `normalizePayment`(1970행) 내부의 별칭 매핑을 `R.paymentAlias`를 쓰도록 교체(기존 하드코딩 alias 객체를 `R.paymentAlias`로).

- `extractDate`(1904행)의 `'어제'`→`R.yesterday`, `'오늘'`→`R.today`로 교체(2곳씩).

- `parseTransactionEntry`의 수입 판정 `/수입|월급|급여|입금|보너스/.test(raw)` → `R.incomeRe.test(raw)`.

- `parseTransactionEntry`의 income 시 강제 카테고리 `'수입'` → income 대분류를 언어 무관하게: es는 'Ingreso', ko는 '수입'. `R.categoryRules`에서 수입 규칙의 category를 쓰거나, `RuleSet`에 `incomeCategory` 필드를 추가(ko:'수입', es:'Ingreso')하고 참조. **RuleSet에 `incomeCategory: string` 추가**하고 ko='수입', es='Ingreso'로 정의, 해당 분기에서 사용.

- `classify`가 반환하던 `'미분류'` 하드코딩이 남아있으면 `R.uncategorized`로. (classifyMemo가 이미 처리)

- [ ] **Step 6: RuleSet에 incomeCategory 추가 반영**

`classifyRules.ts`의 `RuleSet` 타입에 `incomeCategory: string` 추가, `ko`에 `incomeCategory: '수입'`, `es`에 `incomeCategory: 'Ingreso'` 추가.

- [ ] **Step 7: 전체 테스트 + 빌드**

Run: `cd personal-money-app && npm test && npx tsc --noEmit && npm run build`
Expected: 전체 PASS, 타입 0, 빌드 성공. (ko 기본 빌드에서 기존 동작 동일 — 기존 파서 테스트가 회귀 없음.)

- [ ] **Step 8: 커밋**

```bash
cd personal-money-app && git add src/classifyRules.ts src/classifyRules.test.ts src/App.tsx && git commit -m "feat(classify): 언어별 분류 규칙셋(ko/es) 분리 + 파서 배선"
```

---

### Task 4: UI i18n (ko/es 사전 + App.tsx 치환)

**Files:**
- Create: `personal-money-app/src/i18n.ts`
- Create: `personal-money-app/src/i18n.test.ts`
- Modify: `personal-money-app/src/App.tsx` (하드코딩 한글 UI 문자열 → `t('key')`)

**Interfaces:**
- Consumes: `LANG` from `classifyRules.ts`.
- Produces: `t(key: string, vars?: Record<string, string|number>): string`. 키 누락 시 키 자체 반환.

- [ ] **Step 1: i18n 스캐폴드 + 키 일치 테스트 작성**

`src/i18n.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { ko, es, makeT } from './i18n'

describe('i18n', () => {
  it('ko/es 키 집합이 동일', () => {
    expect(Object.keys(ko).sort()).toEqual(Object.keys(es).sort())
  })
  it('t가 변수 치환', () => {
    const t = makeT({ greet: 'Hola {name}' })
    expect(t('greet', { name: 'Bri' })).toBe('Hola Bri')
  })
  it('누락 키는 키 자체 반환', () => {
    const t = makeT({})
    expect(t('missing')).toBe('missing')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `cd personal-money-app && npx vitest run src/i18n.test.ts`
Expected: FAIL (모듈 없음).

- [ ] **Step 3: i18n.ts 구현 (스캐폴드 + 시드 사전)**

`src/i18n.ts` — `makeT`, `ko`, `es`, `t`를 정의. 아래는 **시드(대표 키)**. 실제 구현 시 App.tsx의 모든 가시 문자열을 키로 추가해 두 사전을 채운다(Step 5에서 확장).

```typescript
import { LANG } from './classifyRules'

export function makeT(dict: Record<string, string>) {
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = dict[key] ?? key
    if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, String(vars[k]))
    return s
  }
}

export const ko: Record<string, string> = {
  tab_home: '홈', tab_ledger: '원장', tab_assets: '자산', tab_insights: '인사이트', tab_fixed: '고정비',
  btn_input: '입력', btn_edit: '수정', btn_delete: '삭제', btn_close: '닫기', btn_sync: '동기화', btn_export: '내보내기',
  filter_income: '수입', prev_month: '이전 달', next_month: '다음 달',
  qe_placeholder: '금액 장소 물건 · +면 수입',
  sec_fixed_variable: '고정비 / 변동비', sec_place_top: '장소 TOP', sec_delta: '전월대비', sec_month_flow: '월별 흐름', sec_spend_ratio: '지출 비중',
  fixed_income_title: '월 정기수입', fixed_expense_title: '월 고정비',
  empty_fixed: '고정비가 없습니다. + 추가로 등록하세요.', empty_income: '정기수입이 없습니다. + 추가로 등록하세요.',
  loading: '불러오는 중…',
  // ... Step 5에서 나머지 전부 추가
}

export const es: Record<string, string> = {
  tab_home: 'Inicio', tab_ledger: 'Registro', tab_assets: 'Activos', tab_insights: 'Análisis', tab_fixed: 'Fijos',
  btn_input: 'Añadir', btn_edit: 'Editar', btn_delete: 'Borrar', btn_close: 'Cerrar', btn_sync: 'Sincronizar', btn_export: 'Exportar',
  filter_income: 'Ingresos', prev_month: 'Mes anterior', next_month: 'Mes siguiente',
  qe_placeholder: 'Monto lugar cosa · + para ingreso',
  sec_fixed_variable: 'Fijos / Variables', sec_place_top: 'Lugares TOP', sec_delta: 'vs. mes anterior', sec_month_flow: 'Flujo mensual', sec_spend_ratio: 'Distribución de gastos',
  fixed_income_title: 'Ingresos fijos', fixed_expense_title: 'Gastos fijos',
  empty_fixed: 'No hay gastos fijos. Añade con +.', empty_income: 'No hay ingresos fijos. Añade con +.',
  loading: 'Cargando…',
  // ... Step 5에서 나머지 전부 추가
}

export const t = makeT(LANG === 'es' ? es : ko)
```

- [ ] **Step 4: 통과 확인**

Run: `cd personal-money-app && npx vitest run src/i18n.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: App.tsx의 모든 가시 문자열을 t()로 치환 (전수)**

`src/App.tsx`를 훑어 **화면에 보이는 모든 한글 문자열**(JSX 텍스트, `label=`, `placeholder=`, 버튼/헤더/시트 제목/빈상태/인사이트 카드 title·body/토스트)을 `t('key')`로 바꾸고, 각 키를 `ko`/`es` 사전에 추가한다. 규칙:
- 정적 문자열 → 키 하나. 예: `label="원장"` → `label={t('tab_ledger')}`.
- 변수 포함 문장 → `{}` 플레이스홀더 + vars. 예: `` `${formatMoney(x)} 썼어요` `` → `t('spent', { amt: formatMoney(x) })`, es: `'Gastaste {amt}'`.
- 콘솔/주석/내부 식별자(카테고리 canonical, 결제수단 등 데이터값)는 **건드리지 않음**(Task 3의 분류기가 데이터 언어를 결정).
- buildInsights의 카드 title/body도 전부 키로.
- 키 네이밍: `구역_의미`(snake). ko/es 양쪽에 동일 키.

커버리지 확인(아래 Step 7)에서 남은 한글 JSX 리터럴이 0에 수렴해야 한다.

- [ ] **Step 6: 커버리지 검증 스크립트로 남은 한글 문자열 점검**

Run:
```bash
cd personal-money-app
grep -nE '>[^<>{}]*[가-힣][^<>{}]*<|(label|placeholder|title|aria-label)="[^"]*[가-힣]' src/App.tsx | grep -v 't(' | head -50
```
Expected: 빈 출력(또는 데이터/주석성 잔여만). 남으면 Step 5로 돌아가 키화.

- [ ] **Step 7: ko 빌드 회귀 + 전체 테스트 + 빌드**

Run: `cd personal-money-app && npm test && npx tsc --noEmit && npm run build`
Expected: 전체 PASS, 타입 0, 빌드 성공. (ko 기본 → 기존 화면 문자열 동일해야 함.)

- [ ] **Step 8: es 빌드 스모크(로컬)**

Run: `cd personal-money-app && VITE_LANG=es npm run build 2>&1 | grep -E "built|error"`
Expected: `built` 성공.

- [ ] **Step 9: 커밋**

```bash
cd personal-money-app && git add src/i18n.ts src/i18n.test.ts src/App.tsx && git commit -m "feat(i18n): UI 문자열 ko/es 사전화 + t() 치환"
```

---

### Task 5: 브리 배포 + 스페인어 가이드 + 실측

**Files:**
- Create: `personal-money-app/docs/guia-es.md` (스페인어 사용 가이드)

**Interfaces:**
- Consumes: Task 1~4 완료(백엔드 es 프로필, profile 전달, es 분류기, es i18n).

- [ ] **Step 1: 스페인어 사용 가이드 작성**

`docs/guia-es.md` — 브리용. 내용: 앱 URL 접속·홈화면 추가(PWA), 입력법(`5000 café tarjeta` → gasto; `+600000 salario` → ingreso), 카테고리 자동분류·미분류 교정, 고정비(Fijos) 등록, 원장/분석 보기, 내보내기(Exportar) 백업. 스페인어로 1장 분량.

- [ ] **Step 2: 브리 전용 Vercel 배포 (별도 프로젝트)**

`personal-money-app`에서 새 Vercel 프로젝트로 배포하며 빌드 env 설정:
```bash
cd personal-money-app
VITE_PROFILE=es VITE_LANG=es VITE_SYNC_URL="<동일 URL>" VITE_SYNC_TOKEN="<동일 토큰>" npx vercel --prod --yes
```
(또는 Vercel 대시보드에서 새 프로젝트 생성 후 Environment Variables에 `VITE_PROFILE=es`, `VITE_LANG=es`, 기존 `VITE_SYNC_URL`/`VITE_SYNC_TOKEN` 설정. 네 기존 배포는 건드리지 않는다.)
→ 브리 전용 URL 확보.

- [ ] **Step 3: Chrome 실측**

브리 URL을 Chrome으로 열어:
- UI가 스페인어인지(탭 Inicio/Registro/Activos/Análisis/Fijos 등).
- 입력 `5000 café tarjeta` → 원장에 `Comida/Cafetería · Tarjeta` 기록.
- 입력 `+600000 salario` → 수입(Ingreso).
- 백엔드 `es_거래원장` 탭에만 쌓이고 네 `v2_` 원장은 불변인지 확인:
```bash
python3 -c "
import urllib.request,json
URL='https://script.google.com/macros/s/AKfycby2so1RyMqyuEaKEfOtSIFPDGX-Ft_UyNjBE2WiNikXIc5G6Jv2vGlNMqiey6qlYSfAxA/exec'
TOKEN='e281628c253994a8e3e011219133a2d04955d224134e8a2d'
es=json.load(urllib.request.urlopen(f'{URL}?action=ledger&profile=es&token={TOKEN}'))['transactions']
v2=json.load(urllib.request.urlopen(f'{URL}?action=ledger&token={TOKEN}'))['transactions']
print('es 건수:', len(es), '| v2 건수:', len(v2))
"
```
Expected: es에 방금 입력분 존재, v2 건수 불변.

- [ ] **Step 4: 커밋**

```bash
cd personal-money-app && git add docs/guia-es.md && git commit -m "docs(es): 브리 스페인어 사용 가이드 + 배포"
```

---

## Self-Review 결과

**스펙 커버리지:**
- 백엔드 profile/es_ 탭(스펙 §1) → Task 1 ✓
- syncClient profile(§2) → Task 2 ✓
- i18n UI(§3) → Task 4 ✓
- es 분류기(§4) → Task 3 ✓
- 통화 미분기(§3) → Global Constraints에 명시, 코드 변경 없음 ✓
- 배포(§5) → Task 5 Step 2 ✓
- 가이드(§6) → Task 5 Step 1 ✓
- 데이터 흐름/엣지(하위호환, es 탭 자동생성, 미분류 교정) → Task 1 Step 6, Task 3 ✓

**Placeholder 스캔:** Task 4 Step 5는 "전수 치환"이라는 대량 기계작업이나, 실행 로직(makeT/t, 키 네이밍 규칙, 커버리지 grep 종료조건)이 구체적이므로 논리 공백 아님. 나머지 스텝은 실제 코드/명령 포함.

**타입 일관성:** `RuleSet`(Task 3 Step 3/6에 `incomeCategory` 포함 최종형), `classifyMemo`, `LANG`, `RULES` 명칭이 Task 3 정의 = Task 4 사용 일치. `t`/`makeT`/`ko`/`es`가 Task 4 정의 = 사용 일치. `SyncConfig.profile`(Task 2) = 백엔드 `profile`(Task 1) 일치.
