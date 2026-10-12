import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
// recharts 는 인사이트 탭에서만 쓴다 — 홈 첫 화면 번들에서 빼서 따로 받는다
const TrendChart = lazy(() => import('./Charts').then((m) => ({ default: m.TrendChart })))
const RankChart = lazy(() => import('./Charts').then((m) => ({ default: m.RankChart })))
import {
  CalendarClock,
  ChartNoAxesCombined,
  CircleDollarSign,
  Download,
  Home,
  Landmark,
  LineChart,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Save,
  Send,
  Check,
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  CreditCard,
  Store,
} from 'lucide-react'
import { pickNewer, dedupById, keepPending } from './sync/merge'
import { getSyncConfig, loadFromServer, saveToServer, loadLedger, assignCategory, loadFixedDefs, saveFixedDef, deleteFixedDef, deleteLedger, updateLedger, appendLedger } from './sync/syncClient'
import {
  deriveQuickChips,
  dailyTotals,
  changeRate,
  categoryIcon,
  topNWithOther,
  distinctCategoryOptions,
  fixedRemaining,
  splitFromText,
  splitPlaceItem,
  joinPlaceItem,
  placeTotals,
  categoryDeltas,
  splitBreakdown,
  parseCardStatement,
  cardPerformance,
  tierStatus,
  dailyCheer,
  type Tier,
  type QuickChip,
  type FixedDef,
  CARD_SPECS,
  missedBenefits,
  withInstallmentCharges,
  type CardSpec,
  unusedBenefits,
  benefitBalances,
  cardGlance,
  previousMonthKey,
  paymentPlaybook,
  isSaving,
  isLoanRepay,
  isNonSpend,
  LOAN_CATEGORY,
  SAVING_CATEGORY,
  parseBankDeposits,
  type DepositRow,
  type SplitTxLike,
} from './dashboardLogic'
import { loadLearnedRules, saveLearnedRule, classifyByLearned } from './learnedRules'
import { RULES, classifyMemo } from './classifyRules'
import { t } from './i18n'
import { coachAdvice, categoryStates, type Advice } from './coach'
import './App.css'

type Tab = 'dashboard' | 'ledger' | 'assets' | 'insights' | 'fixed'
type TransactionType = 'expense' | 'income'
type FixedType = 'fixed' | 'variable'
type LedgerLoadStatus = 'loading' | 'ready' | 'error'

type Transaction = {
  id: string
  date: string
  type: TransactionType
  amount: number
  memo: string
  category: string
  subCategory: string
  payment: string
  fixedType: FixedType
  split: number
  raw: string
  /** 시트에 기록된 시각. 원장 목록을 '적은 순'으로 세울 때 쓴다. 로컬 입력분에는 없다. */
  enteredAt?: string
}

type Asset = {
  id: string
  date: string
  kind: string
  name: string
  institution: string
  amount: number
  note: string
}

type Investment = {
  id: string
  date: string
  account: string
  name: string
  ticker?: string   // 종목코드 (예: 005930)
  shares?: number   // 보유 수량
  value: number
  returnRate: number
  note: string
}

type Loan = {
  id: string
  date: string
  name: string
  institution: string
  balance: number
  monthlyPayment: number
  rate: number
  dueDay: string
  status: 'active' | 'done'
}

type FinanceStore = {
  transactions: Transaction[]
  assets: Asset[]
  investments: Investment[]
  loans: Loan[]
  budget: number
}

type ParseResult =
  | { kind: 'transaction'; transaction: Transaction }
  | { kind: 'asset'; asset: Asset }
  | { kind: 'investment'; investments: Investment[] }
  | { kind: 'loan'; loan: Loan }
  | { kind: 'error'; message: string }

const STORAGE_KEY = 'personal-money-app:v1'
const UPDATED_AT_KEY = 'personal-money-app:v1:updatedAt'
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error'

const R = RULES

// 거래 이력이 없을 때 미분류 교정 칩에 보여줄 기본 카테고리 목록(언어별 RuleSet.defaultOptions - F2)
const DEFAULT_FIX_OPTIONS = R.defaultOptions


/**
 * 앱은 항상 빈 상태로 시작한다.
 *
 * 예전에는 한국어 빌드에만 데모 시드(급여 320만·점심 돈까스·크래프톤 주식 등)를 넣었다.
 * 새 기기에서 처음 열면 그 시드가 store 에 들어가고, 동기화가 그대로 시트 원장에 올려서
 * 실제 가계부에 가짜 거래 10건과 가짜 자산 8건이 섞였다. 5월 수입이 320만 부풀고
 * 순자산 2,400만이 통째로 허구였다.
 *
 * 데모는 한 사람이 쓰는 앱에 아무 값어치가 없고, 오염은 되돌리기 어렵다.
 * 예산 기본값만 남긴다.
 */
const DEFAULT_BUDGET = 1_000_000

const emptyStore: FinanceStore = { transactions: [], assets: [], investments: [], loans: [], budget: DEFAULT_BUDGET }
const initialStore: FinanceStore = emptyStore

function App() {
  // 브라우저 탭 제목도 언어에 맞춘다(index.html은 ko 고정이라 es 빌드에서 어긋났음)
  useEffect(() => { document.title = t('app_title') }, [])
  const [store, setStore, syncStatus, syncNow] = usePersistentStore()
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [lastMessage, setLastMessage] = useState(t('status_ready'))
  const [showPwaBanner, setShowPwaBanner] = useState(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator && (navigator as unknown as { standalone: boolean }).standalone)
    const isDismissed = window.localStorage.getItem('shiba-pwa-dismissed') === 'true'
    return !!(isIos && !isStandalone && !isDismissed)
  })
  const [history, refreshHistory, ledgerStatus] = useLedgerHistory()
  const ledgerAppendInFlight = useRef(new Set<string>())
  const mergedTransactions = useMemo(
    () =>
      dedupById(history, store.transactions).sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      ),
    [history, store.transactions],
  )
  // 원장에 반영된 거래는 store에서 비운다.
  // store는 "아직 원장에 없는 최근 입력분"만 들고 있어야 하는데, 남아 있으면 병합에서 store가 이겨
  // 서버(원장)에서 고친 내용이 앱에 안 보인다. 실제로 지울 게 있을 때만 setStore → 루프 없음.
  useEffect(() => {
    if (!history.length) return
    const inLedger = new Set(history.map((h) => h.id))
    setStore((cur) => {
      const kept = cur.transactions.filter((t) => !inLedger.has(t.id))
      return kept.length === cur.transactions.length ? cur : { ...cur, transactions: kept }
    })
  }, [history, setStore])

  // 입력 당시 네트워크가 끊기면 거래는 로컬에는 남지만 원장 append가 실패할 수 있다.
  // store는 원장에 아직 없는 거래만 보관하므로, 원장을 읽을 수 있게 될 때마다 안전하게 재전송한다.
  // 서버는 같은 id를 중복 등록하지 않아 StrictMode나 재시도에도 안전하다.
  useEffect(() => {
    if (ledgerStatus !== 'ready' || !store.transactions.length) return
    const ledgerIds = new Set(history.map((item) => item.id))
    // 내용까지 본다. id 만 보면 같은 거래가 다른 id 로 다시 올라간다.
    // 서버의 appendLedger 는 id 로만 중복을 막는데, 원장에서 고쳐 저장하면 id 가 바뀐다.
    // 그 뒤 로컬에 남아 있던 옛 사본이 재전송돼 5~6월 거래 10건이 원장에 두 번 들어갔다.
    const ledgerKeys = new Set(history.map(contentKey))
    const pending = store.transactions.filter((item) =>
      !ledgerIds.has(item.id) && !ledgerKeys.has(contentKey(item)) && !ledgerAppendInFlight.current.has(item.id))
    if (!pending.length) return
    pending.forEach((item) => ledgerAppendInFlight.current.add(item.id))
    void Promise.all(pending.map((item) => appendLedger(item).catch(() => false)))
      .then((results) => {
        if (results.some(Boolean)) refreshHistory()
        if (results.some((ok) => !ok)) setLastMessage(t('status_ledger_pending'))
      })
      .finally(() => pending.forEach((item) => ledgerAppendInFlight.current.delete(item.id)))
  }, [history, ledgerStatus, refreshHistory, store.transactions])

  const categoryOptions = useMemo(() => distinctCategoryOptions(mergedTransactions), [mergedTransactions])
  async function assignCategoryFor(id: string, category: string, subCategory: string, memo: string) {
    setLastMessage(t('status_classifying'))
    // 로컬(store) 거래면 즉시 카테고리 변경 (원장에 없는 최근 입력분 포함)
    const isLocal = store.transactions.some((t) => t.id === id)
    if (isLocal) {
      setStore((cur) => ({
        ...cur,
        transactions: cur.transactions.map((t) => (t.id === id ? { ...t, category, subCategory } : t)),
      }))
    }
    // 백엔드: 원장 거래 갱신 + 같은 내역 일괄 + 분류규칙 학습 (memo 전달)
    const ok = await assignCategory(id, category, subCategory, memo).catch(() => false)
    if (ok || isLocal) { setLastMessage(t('status_classified')); refreshHistory() }
    else setLastMessage(t('status_classify_failed'))
  }
  const summary = useMemo(
    () => buildSummary({ ...store, transactions: mergedTransactions }),
    [store, mergedTransactions],
  )
  const quickChips = useMemo(() => deriveQuickChips(mergedTransactions, 4), [mergedTransactions])
  const [undoTx, setUndoTx] = useState<Transaction | null>(null)
  const [pendingUncat, setPendingUncat] = useState<Transaction | null>(null)
  const fixOptions = useMemo(
    () => (categoryOptions.length ? categoryOptions.slice(0, 8) : DEFAULT_FIX_OPTIONS),
    [categoryOptions],
  )

  useEffect(() => {
    if (!undoTx) return
    const id = window.setTimeout(() => setUndoTx(null), 5000)
    return () => window.clearTimeout(id)
  }, [undoTx])

  function dismissPwaBanner() {
    window.localStorage.setItem('shiba-pwa-dismissed', 'true')
    setShowPwaBanner(false)
  }

  function applyQuickInput(raw: string) {
    const parsed = parseQuickEntry(raw)
    if (parsed.kind === 'error') {
      setLastMessage(parsed.message)
      return
    }

    if (parsed.kind === 'transaction') {
      recordTransaction(parsed.transaction)   // 로컬 + 시트 원장
    } else {
      setStore((current) => {
        if (parsed.kind === 'asset') {
          return { ...current, assets: upsertByName(current.assets, parsed.asset) }
        }
        if (parsed.kind === 'investment') {
          return { ...current, investments: upsertManyInvestments(current.investments, parsed.investments) }
        }
        return { ...current, loans: upsertByName(current.loans, parsed.loan) }
      })
    }

    setLastMessage(resultLabel(parsed))
    if (parsed.kind === 'transaction' && parsed.transaction.type === 'expense' && parsed.transaction.category === R.uncategorized) {
      setPendingUncat(parsed.transaction)
    } else {
      setPendingUncat(null)
    }
  }

  function logQuickChipForDate(chip: QuickChip, date: string) {
    const tx: Transaction = {
      id: uid(), date, type: 'expense', amount: chip.amount,
      memo: chip.label, category: chip.category, subCategory: chip.subCategory,
      payment: chip.payment, fixedType: chip.fixedType, split: 0, raw: `${chip.label} ${chip.amount}`,
    }
    recordTransaction(tx)
    setUndoTx(tx)
    setLastMessage(t('toast_chip_recorded', { label: chip.label, amt: formatMoney(chip.amount) }))
  }
  function quickAddForDate(raw: string, date: string) {
    const parsed = parseQuickEntry(raw)
    if (parsed.kind === 'error') { setLastMessage(parsed.message); return }
    if (parsed.kind === 'transaction') {
      const t = { ...parsed.transaction, date }
      recordTransaction(t)
      setLastMessage(resultLabel(parsed))
      return
    }
    applyQuickInput(raw)
  }
  function undoLastChip() {
    if (!undoTx) return
    const id = undoTx.id
    setStore((cur) => ({ ...cur, transactions: cur.transactions.filter((x) => x.id !== id) }))
    deleteLedger(id).then((ok) => { if (ok) refreshHistory() }).catch(() => {})
    setUndoTx(null)
  }

  function assignAndLearn(tx: Transaction, category: string, subCategory: string) {
    editTransaction({ ...tx, category, subCategory })   // store/캐시 갱신 + (카테고리 변경 시) 서버 assignCategory 호출
    saveLearnedRule({ keyword: tx.memo, category, subCategory })
    setPendingUncat(null)
    setLastMessage(t('toast_classified_auto', { cat: `${category}${subCategory ? '·' + subCategory : ''}` }))
  }

  function deleteTransaction(id: string) {
    // 로컬 store에서 제거 + 시트 원장에서도 삭제(시리/원장 거래 포함). 성공 시 원장 새로고침.
    setStore((current) => ({
      ...current,
      transactions: current.transactions.filter((item) => item.id !== id),
    }))
    deleteLedger(id).then((ok) => { if (ok) refreshHistory() }).catch(() => {})
  }

  function editTransaction(updated: Transaction) {
    const prev = mergedTransactions.find((t) => t.id === updated.id)
    setStore((cur) => {
      const exists = cur.transactions.some((t) => t.id === updated.id)
      return {
        ...cur,
        transactions: exists
          ? cur.transactions.map((t) => (t.id === updated.id ? updated : t))
          : [updated, ...cur.transactions],
      }
    })
    // 전체 필드(금액/날짜/내역/분류/결제수단/고정변동/분담금)를 시트 원장에 반영
    updateLedger(updated).then((ok) => { if (ok) refreshHistory() }).catch(() => {})
    // 카테고리가 바뀌면 분류규칙도 학습(같은 내역 자동분류용)
    if (prev && (prev.category !== updated.category || prev.subCategory !== updated.subCategory)) {
      assignCategory(updated.id, updated.category, updated.subCategory, updated.memo).catch(() => {})
    }
  }

  // 인앱 거래를 로컬에 즉시 표시 + 시트 원장에 기록(단일 원천화, 리포트 집계 포함)
  function recordTransaction(t: Transaction) {
    setStore((cur) => ({ ...cur, transactions: [t, ...cur.transactions] }))
  }

  // 카드 명세 붙여넣기 → 파싱·자동분류 후 일괄 등록. 중복(같은 날짜+금액+가맹점)은 건너뛴다.
  function importCardRows(rows: { date: string; memo: string; amount: number }[], payment: string) {
    const seen = new Set(mergedTransactions.map((x) => `${x.date}|${x.amount}|${(x.memo || '').trim()}`))
    const fresh = rows.filter((r) => !seen.has(`${r.date}|${r.amount}|${r.memo.trim()}`))
    for (const r of fresh) {
      const learned = classifyByLearned(r.memo, loadLearnedRules())
      const c = learned ? { category: learned.category, sub: learned.subCategory } : classify(r.memo)
      recordTransaction({
        id: uid(), date: r.date, type: 'expense', amount: r.amount, memo: r.memo,
        category: c.category, subCategory: c.sub, payment,
        fixedType: isFixed(r.memo) ? 'fixed' : 'variable', split: 0, raw: `card:${r.memo}`,
      })
    }
    setLastMessage(t('import_done', { n: fresh.length, dup: rows.length - fresh.length }))
    return fresh.length
  }

  /** 월말 통장 정리. 붙여넣은 입금 중 고른 것만 수입으로 넣는다. 중복은 건너뛴다. */
  function importDeposits(rows: DepositRow[]) {
    const seen = new Set(mergedTransactions.map((x) => `${x.date}|${x.amount}|${(x.memo || '').trim()}`))
    const fresh = rows.filter((r) => !seen.has(`${r.date}|${r.amount}|${r.name.trim()}`))
    for (const r of fresh) {
      recordTransaction({
        id: uid(), date: r.date, type: 'income', amount: r.amount, memo: r.name,
        category: r.category, subCategory: r.subCategory, payment: '토스뱅크',
        fixedType: 'variable', split: 0, raw: `bank:${r.name}`,
      })
    }
    setLastMessage(t('import_done', { n: fresh.length, dup: rows.length - fresh.length }))
    return fresh.length
  }

  function saveAsset(assetItem: Asset) {
    setStore((current) => ({
      ...current,
      assets: upsertAssetList(current.assets, assetItem),
    }))
    setLastMessage(t('toast_asset_saved', { name: assetItem.name }))
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `money-book-${todayIso()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          {/* 날짜와 응원 문구를 강조색으로 각각 한 줄씩 쌓으면 제목보다 시끄러워진다. 한 줄로 접고 색을 뺐다. */}
          <p className="app-meta">{formatDateLabel(todayIso())} · {dailyCheer(todayIso(), CHEERS)}</p>
          <h1>{t('app_title')}</h1>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={() => { syncNow(); refreshHistory(); void refreshServiceWorker() }}
          aria-label={t('btn_sync')}
          title={
            syncStatus === 'syncing' ? t('sync_syncing') :
            syncStatus === 'offline' ? t('sync_offline') :
            syncStatus === 'error' ? t('sync_error') : t('sync_synced')
          }
        >
          <RefreshCw size={18} className={syncStatus === 'syncing' ? 'spin' : undefined} />
        </button>
        <button className="icon-button" type="button" onClick={exportData} aria-label={t('btn_export')}>
          <Download size={19} />
        </button>
      </header>

      {showPwaBanner && (
        <section className="pwa-install-banner">
          <div className="pwa-install-content">
            <img src="/apple-touch-icon.png" alt={t('app_title')} className="pwa-install-icon" />
            <div className="pwa-install-text">
              <h4>{t('pwa_add_title')}</h4>
              <p>{t('pwa_pre')}<strong>{t('pwa_share_button')}</strong>{t('pwa_mid')}<strong>{t('pwa_add_home')}</strong>{t('pwa_post')}</p>
            </div>
          </div>
          <button className="pwa-install-close" onClick={dismissPwaBanner} aria-label={t('btn_close')}>
            <X size={18} />
          </button>
        </section>
      )}

      <nav className="tab-bar" aria-label={t('nav_screens')}>
        <TabButton tab="dashboard" activeTab={activeTab} icon={<Home size={18} />} label={t('tab_home')} onClick={setActiveTab} />
        <TabButton tab="ledger" activeTab={activeTab} icon={<ReceiptText size={18} />} label={t('tab_ledger')} onClick={setActiveTab} />
        <TabButton tab="assets" activeTab={activeTab} icon={<Wallet size={18} />} label={t('tab_assets')} onClick={setActiveTab} />
        <TabButton tab="insights" activeTab={activeTab} icon={<Sparkles size={18} />} label={t('tab_insights')} onClick={setActiveTab} />
        <TabButton tab="fixed" activeTab={activeTab} icon={<CalendarClock size={18} />} label={t('tab_fixed')} onClick={setActiveTab} />
      </nav>

      {activeTab === 'dashboard' && (
        <>
          <div className="home-input">
            {undoTx && (
              <div className="undo-toast">
                <span>{t('toast_recorded_done', { memo: undoTx.memo, amt: formatMoney(undoTx.amount) })}</span>
                <button type="button" onClick={undoLastChip}>{t('btn_undo')}</button>
              </div>
            )}
            <QuickEntry onSubmit={applyQuickInput} lastMessage={lastMessage} />
            <CardImport onImport={importCardRows} />
            <BankImport onImport={importDeposits} />
            {pendingUncat && (
              <div className="fix-uncat">
                <p className="fix-uncat-label">{t('uncategorized_prompt')}</p>
                <div className="fix-chips">
                  {fixOptions.map((o) => (
                    <button
                      key={o.category + '/' + o.subCategory}
                      type="button"
                      className="fix-chip"
                      onClick={() => { if (pendingUncat) assignAndLearn(pendingUncat, o.category, o.subCategory) }}
                    >
                      {categoryIcon(o.category)} {o.category}{o.subCategory ? '·' + o.subCategory : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Dashboard
            summary={summary}
            transactions={mergedTransactions}
            categoryOptions={categoryOptions}
            onAssign={assignCategoryFor}
            onEdit={editTransaction}
            onOpenInsights={() => setActiveTab('insights')}
            ledgerStatus={ledgerStatus}
          />
        </>
      )}
      {activeTab === 'ledger' && (
        <Ledger
          transactions={mergedTransactions}
          onDelete={deleteTransaction}
          onEdit={editTransaction}
          quickChips={quickChips}
          onQuickAddForDate={quickAddForDate}
          onChipAddForDate={logQuickChipForDate}
        />
      )}
      {activeTab === 'assets' && <AssetsView store={store} summary={summary} onSaveAsset={saveAsset} />}
      {activeTab === 'insights' && <InsightsView store={store} summary={summary} transactions={mergedTransactions} />}
      {activeTab === 'fixed' && <FixedView monthKey={summary.monthKey} />}
    </main>
  )
}

// 카드앱 이용내역을 붙여넣어 한 번에 등록. iOS 텍스트 인식으로 스크린샷에서 복사하면 그대로 붙는다.
const BANK_SKIP_KEY = 'shiba-bank-skip:v1'

const readBankSkip = (): string[] => {
  try { return JSON.parse(window.localStorage.getItem(BANK_SKIP_KEY) || '[]') as string[] } catch { return [] }
}

/**
 * 월말 통장 입금 정리. 프리랜서라 수입처가 여러 곳이고 금액이 매달 달라서
 * 한 건씩 넣는 건 현실성이 없다. 거래내역서를 통째로 붙여넣고 거래처 단위로 고른다.
 *
 * 행 단위가 아니라 거래처 단위인 이유: 본인 계좌 간 이체가 한 달에 19건씩 찍힌다.
 * 그걸 한 줄씩 지우게 하면 아무도 안 쓴다.
 */
function BankImport({ onImport }: { onImport: (rows: DepositRow[]) => number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [skip, setSkip] = useState<string[]>(() => readBankSkip())
  const rows = useMemo(() => (text.trim() ? parseBankDeposits(text) : []), [text])

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; rows: DepositRow[]; total: number; sub: string }>()
    for (const r of rows) {
      const g = m.get(r.name) ?? { name: r.name, rows: [], total: 0, sub: r.subCategory }
      g.rows.push(r); g.total += r.amount
      m.set(r.name, g)
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [rows])

  const toggle = (name: string) => {
    const next = skip.includes(name) ? skip.filter((n) => n !== name) : [...skip, name]
    setSkip(next)
    try { window.localStorage.setItem(BANK_SKIP_KEY, JSON.stringify(next)) } catch { /* 사파리 시크릿 등 */ }
  }

  const picked = rows.filter((r) => !skip.includes(r.name))
  const total = picked.reduce((s, r) => s + r.amount, 0)

  if (!open) {
    return <button type="button" className="card-import-open" onClick={() => setOpen(true)}>{t('bank_import_open')}</button>
  }
  return (
    <div className="card-import">
      <div className="card-import-head">
        <strong>{t('bank_import_title')}</strong>
        <button type="button" className="icon-button" onClick={() => { setOpen(false); setText('') }} aria-label={t('btn_close')}><X size={16} /></button>
      </div>
      <p className="row-meta">{t('bank_import_help')}</p>
      <textarea className="card-import-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('bank_import_placeholder')} />
      {groups.length > 0 && (
        <>
          <ul className="bank-groups">
            {groups.map((g) => {
              const off = skip.includes(g.name)
              return (
                <li key={g.name}>
                  <button type="button" className={`bank-group${off ? ' off' : ''}`} onClick={() => toggle(g.name)}>
                    <span className="bank-check" aria-hidden>{off ? '' : <Check size={13} />}</span>
                    <span className="bank-name">{g.name}</span>
                    <span className="row-meta">{g.sub} · {g.rows.length}건</span>
                    <strong>{formatMoney(g.total)}</strong>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="guide-note">{t('bank_import_skip_hint')}</p>
          <button type="button" className="fixed-save" disabled={!picked.length}
            onClick={() => { onImport(picked); setText(''); setOpen(false) }}>
            {t('bank_import_submit', { n: picked.length, amt: formatMoney(total) })}
          </button>
        </>
      )}
    </div>
  )
}

function CardImport({ onImport }: { onImport: (rows: { date: string; memo: string; amount: number }[], payment: string) => number }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [payment, setPayment] = useState(R.defaultPayment)
  const rows = useMemo(() => (text.trim() ? parseCardStatement(text, todayIso()) : []), [text])
  const total = rows.reduce((s, r) => s + r.amount, 0)
  if (!open) {
    return <button type="button" className="card-import-open" onClick={() => setOpen(true)}>{t('import_open')}</button>
  }
  return (
    <div className="card-import">
      <div className="card-import-head">
        <strong>{t('import_title')}</strong>
        <button type="button" className="icon-button" onClick={() => { setOpen(false); setText('') }} aria-label={t('btn_close')}><X size={16} /></button>
      </div>
      <p className="row-meta">{t('import_help')}</p>
      <textarea className="card-import-text" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('import_placeholder')} />
      <label className="card-import-pay">{t('field_payment_method')}
        <input list="import-pay-list" value={payment} onChange={(e) => setPayment(e.target.value)} />
        <datalist id="import-pay-list">{R.payments.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      {rows.length > 0 && (
        <>
          <ul className="card-import-preview">
            {rows.map((r, i) => (
              <li key={i}><span>{r.date.slice(5)}</span><span className="ci-memo">{r.memo}</span><strong>{formatMoney(r.amount)}</strong></li>
            ))}
          </ul>
          <button type="button" className="fixed-save" onClick={() => { onImport(rows, payment); setText(''); setOpen(false) }}>
            {t('import_submit', { n: rows.length, amt: formatMoney(total) })}
          </button>
        </>
      )}
    </div>
  )
}

function QuickEntry({ onSubmit, lastMessage }: { onSubmit: (raw: string) => void; lastMessage: string }) {
  const [draft, setDraft] = useState('')

  function submit() {
    const value = draft.trim()
    if (!value) return
    onSubmit(value)
    setDraft('')
  }

  return (
    <section className="quick-panel">
      <div className="quick-input-row">
        <button className="quick-leading" type="button" aria-label={t('quick_input_aria')}>
          <Plus size={20} />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder={t('qe_placeholder')}
        />
        <button className="send-button" type="button" onClick={submit} aria-label={t('btn_input')}>
          <Send size={18} />
        </button>
      </div>
<p className="status-line">{lastMessage}</p>
    </section>
  )
}

// 카드별 전월실적 구간 → 월 할인한도. 약관이 바뀌면 여기만 고친다.
// ponytail: 구간을 아는 카드만 넣는다. 없는 카드는 결제액·인정실적만 보여준다.
// 홈에 항상 한 줄씩 띄울 주요 카드(순서대로). 다른 카드는 인사이트 탭에서만 본다.
// 홈에 항상 한 줄씩 띄울 카드. 약관을 등록해 둔 보유 카드는 결제가 없어도 보여준다
// (실적이 0원이라는 사실 자체가 정보다).
const PRIMARY_CARDS = CARD_SPECS.filter((s) => s.owned).map((s) => s.card)

// 실적 구간 → 월 할인한도. 카드사 공식 안내 기준.
// 하나카드 MG+ S: 30만 이상 15,000 / 60만 이상 30,000 / 100만 이상 60,000 (상품안내서 2025-06-16)
// NH 올바른FLEX: 전월실적 '30만원 이상' 단일 기준(카드사 앱 기준이용금액 300,000원과 일치).
//   구간이 하나뿐이라 더 써도 한도가 안 올라간다. 통합할인한도 금액은 공식 상품설명서를 못 구해
//   cap 0 → '기준 충족'만 표시(2차 출처엔 월 32,000원이라 하나 확정 못 함).
// 실적 구간표는 CARD_SPECS(약관 원문) 한 곳에만 둔다. 여기서 또 적으면 둘이 어긋난다.
const CARD_TIERS: Record<string, Tier[]> = Object.fromEntries(
  CARD_SPECS.filter((s) => s.owned && s.tiers.length).map((s) => [s.card, s.tiers]),
)

// 헤더에 매일 바뀌는 응원 문구. 마음에 안 드는 문장은 지우고 새로 넣으면 된다.
const CHEERS = [
  '오늘도 모으는 중', '티끌 모아 태산', '안 쓴 돈이 번 돈',
  '미래의 나에게 보내는 중', '천천히, 확실하게', '이번 달도 잘하고 있어요',
  '새는 돈 잡는 중', '덜 쓰고 더 모으기', '작은 절약이 쌓이면 큰돈',
  '기록하는 사람이 모은다', '오늘의 한 잔 = 내일의 여유',
]

// 무지개 대신 잉크 계조. 인쇄된 원그래프처럼 농도로만 나눈다.
// 1번(가장 큰 항목)만 도장 빨강이라, 색이 곧 "제일 많이 쓴 곳"을 가리킨다.
// 실제 값은 index.css 에 있어서 라이트·다크가 같이 따라온다.
const RING_COLORS = [
  'var(--ring-1)', 'var(--ring-2)', 'var(--ring-3)', 'var(--ring-4)', 'var(--ring-5)',
  'var(--ring-6)', 'var(--ring-7)', 'var(--ring-8)', 'var(--ring-3)', 'var(--ring-5)',
]

// 홈 도넛 가운데 금액을 이전 값에서 목표까지 올린다. 도넛 쓸기(.8s)와 같이 멈춘다. 동작 줄이기면 바로 최종값.
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
function useCountUp(target: number, ms = 800) {
  const [shown, setShown] = useState(() => (reducedMotion() ? target : 0))
  const from = useRef(shown)
  useEffect(() => {
    if (reducedMotion()) { from.current = target; setShown(target); return }
    const start = from.current, t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / ms)
      const v = Math.round(start + (target - start) * (1 - (1 - p) ** 3))
      from.current = v; setShown(v)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}

function CategoryRing({ total, subtitle, data }: { total: string; subtitle: string | null; data: NameValue[] }) {
  const sum = data.reduce((s, d) => s + d.value, 0) || 1
  const stops = data.reduce<{ total: number; values: string[] }>((state, d, i) => {
    const start = (state.total / sum) * 100
    const end = ((state.total + d.value) / sum) * 100
    return {
      total: state.total + d.value,
      values: [...state.values, `${RING_COLORS[i % RING_COLORS.length]} ${start}% ${end}%`],
    }
  }, { total: 0, values: [] }).values.join(', ')
  return (
    <>
      {/* 라벨은 도넛 구멍보다 넓어서 안에 넣으면 링에 물린다. 구멍에는 숫자만 둔다. */}
      <p className="cat-ring-label">{t('this_month_variable_spend')}</p>
      <div className="cat-ring">
        <div className="cat-donut" style={{ background: `conic-gradient(${stops})` }} />
        <div className="cat-ring-center">
          <strong>{total}</strong>
          {subtitle && <span className="cr-s">{subtitle}</span>}
        </div>
      </div>
    </>
  )
}

function CategoryDetailSheet({ category, transactions, categoryOptions, onAssign, onEdit, onClose }: {
  category: string
  transactions: Transaction[]
  categoryOptions: { category: string; subCategory: string }[]
  onAssign: (id: string, category: string, subCategory: string, memo: string) => void
  onEdit: (updated: Transaction) => void
  onClose: () => void
}) {
  const [pickingId, setPickingId] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const total = transactions.reduce((s, item) => s + item.amount, 0)
  const subMap = new Map<string, number>()
  for (const item of transactions) {
    const k = item.subCategory || t('sub_other')
    subMap.set(k, (subMap.get(k) || 0) + item.amount)
  }
  const subs = [...subMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const rows = [...transactions].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
  return (
    <>
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="cat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cat-sheet-head">
          <span className="cat-ic-lg">{categoryIcon(category)}</span>
          <div className="cat-sheet-title">
            <h3>{category}</h3>
            <p>{t('amount_count', { amt: formatMoney(total), n: transactions.length })}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('btn_close')}><X size={18} /></button>
        </div>
        {subs.length > 0 && (
          <div className="cat-sub-list">
            {subs.map((s) => (
              <div className="cat-sub-row" key={s.name}><span>{s.name}</span><span>{formatMoney(s.value)}</span></div>
            ))}
          </div>
        )}
        <div className="cat-tx-list">
          {rows.length === 0 && <p className="cat-empty">{t('no_transactions')}</p>}
          {rows.map((tx) => (
            <div className="cat-tx-row" key={tx.id}>
              <div className="cat-tx-main">
                <button type="button" className="cat-tx-edit" onClick={() => setEditingTx(tx)}>
                  <p className="row-title">
                    <span className="row-place"><Store size={13} aria-hidden />{splitPlaceItem(tx.memo).place || t('not_entered')}</span>
                    {splitPlaceItem(tx.memo).item && <span className="row-item"> · {splitPlaceItem(tx.memo).item}</span>}
                  </p>
                  <p className="row-meta">{formatDateLabel(tx.date)} · {tx.subCategory || t('unspecified')} · {tx.payment || t('unspecified')}</p>
                </button>
                <div className="cat-tx-right">
                  <span className="cat-tx-amt">{formatMoney(tx.amount)}</span>
                  <button type="button" className="reassign-btn" onClick={() => setPickingId(pickingId === tx.id ? null : tx.id)}>{t('btn_classify')}</button>
                </div>
              </div>
              {pickingId === tx.id && (
                <div className="reassign-picker">
                  {categoryOptions.map((o) => (
                    <button
                      key={o.category + '/' + o.subCategory}
                      type="button"
                      className="reassign-opt"
                      onClick={() => { onAssign(tx.id, o.category, o.subCategory, tx.memo); setPickingId(null) }}
                    >
                      {o.category}{o.subCategory ? ' · ' + o.subCategory : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
    {editingTx && (
      <TransactionEditSheet
        key={editingTx.id}
        tx={editingTx}
        categoryOptions={categoryOptions}
        onClose={() => setEditingTx(null)}
        onSave={(updated) => { onEdit(updated); setEditingTx(null) }}
      />
    )}
    </>
  )
}

function Dashboard({ summary, transactions, categoryOptions, onAssign, onEdit, onOpenInsights, ledgerStatus }: {
  summary: Summary
  transactions: Transaction[]
  categoryOptions: { category: string; subCategory: string }[]
  onAssign: (id: string, category: string, subCategory: string, memo: string) => void
  onEdit: (updated: Transaction) => void
  onOpenInsights: () => void
  ledgerStatus: LedgerLoadStatus
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const variableShown = useCountUp(summary.thisMonth.variable)
  const [fixedDefs, setFixedDefs] = useState<FixedDef[]>(() => readFixedDefsCache())
  const [fixedDefsStatus, setFixedDefsStatus] = useState<LedgerLoadStatus>(() => readFixedDefsCache().length ? 'ready' : 'loading')

  useEffect(() => {
    let cancelled = false
    loadFixedDefs()
      .then((next) => {
        if (cancelled) return
        setFixedDefs(next)
        cacheFixedDefs(next)
        setFixedDefsStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setFixedDefsStatus(readFixedDefsCache().length ? 'ready' : 'error')
      })
    return () => { cancelled = true }
  }, [])

  const cardRows = useMemo(() => {
    // 할부는 결제한 달에 총액이 실적으로 잡힌다 - 인사이트 탭과 같은 기준으로 맞춘다.
    return withInstallmentCharges(transactions, fixedDefs)
  }, [transactions, fixedDefs])
  const benefitDataStatus: LedgerLoadStatus = ledgerStatus === 'error' || fixedDefsStatus === 'error'
    ? 'error'
    : ledgerStatus === 'loading' || fixedDefsStatus === 'loading' ? 'loading' : 'ready'
  // 홈 대표 숫자는 '고정비 뺀 내가 쓴 돈'(변동지출). 총지출은 아래 고정/변동 패널에서 확인.
  const prev = summary.previousMonth?.variable ?? 0
  const rate = changeRate(summary.thisMonth.variable, prev)
  const ringSubtitle = rate === null ? null : t('vs_prev_month', { sign: rate >= 0 ? '+' : '−', pct: Math.abs(Math.round(rate * 100)) })
  // 코치: 원장·고정비가 다 들어온 뒤에만 계산한다(로딩 중엔 실적이 낮게 잡혀 틀린 "실적 부족" 이 나온다).
  const coach = useMemo(
    () => benefitDataStatus === 'ready' ? coachAdvice(transactions, fixedDefs, todayIso()) : [],
    [benefitDataStatus, transactions, fixedDefs],
  )
  const catStates = useMemo(() => new Map(categoryStates(transactions, todayIso()).map((s) => [s.category, s])), [transactions])

  return (
    <section className="view-stack home-motion">
      <CoachCard
        advice={coach}
        status={benefitDataStatus}
        onOpenInsights={onOpenInsights}
        onOpenUncategorized={() => setSelectedCategory('미분류')}
      />
      <CardBenefitOverview
        rows={cardRows}
        monthKey={summary.monthKey}
        onOpenInsights={onOpenInsights}
        ledgerStatus={benefitDataStatus}
      />

      <article className="ring-card">
        <CategoryRing
          total={formatMoney(variableShown)}
          subtitle={ringSubtitle}
          data={topNWithOther(summary.variableTotals, 7, t('sub_other'))}
        />
        <div className="cat-rank">
          {summary.variableTotals.map((c, i) => (
            <button
              type="button"
              className="cat-rank-row"
              key={c.name}
              style={{ '--i': i } as React.CSSProperties}
              onClick={() => setSelectedCategory(c.name)}
            >
              <span className="cat-ic" style={{ background: RING_COLORS[i % RING_COLORS.length] }}>
                {categoryIcon(c.name)}
              </span>
              <span className="cat-name">{c.name}</span>
              {(() => {
                const s = catStates.get(c.name)
                const tone = s?.verdict === 'over' || s?.verdict === 'heavy' ? ' heavy' : s?.verdict === 'room' ? ' room' : ''
                return (
                  <span className={`cat-amt${tone}`}>
                    {formatMoney(c.value)}
                    {s && <span className="cat-base"> · {t('coach_baseline', { amt: compactMoney(s.baseline) })}</span>}
                  </span>
                )
              })()}
              <span className="cat-pct">
                {formatPercent(summary.thisMonth.variable ? c.value / summary.thisMonth.variable : 0)}
              </span>
            </button>
          ))}
        </div>
      </article>

      <section className="wide-section">
        <SectionHeader icon={<ShieldCheck size={18} />} title={t('sec_fixed_variable')} aside={formatPercent(summary.fixedShare)} />
        <FixedVariablePanel summary={summary} />
      </section>

      {selectedCategory && (
        <CategoryDetailSheet
          category={selectedCategory}
          transactions={transactions.filter((t) => t.category === selectedCategory && t.date.slice(0, 7) === summary.monthKey)}
          categoryOptions={categoryOptions}
          onAssign={onAssign}
          onEdit={onEdit}
          onClose={() => setSelectedCategory(null)}
        />
      )}
    </section>
  )
}

const COACH_ICON: Record<Advice['kind'], string> = {
  tier: '💳', nextTier: '📈', unused: '🎁', missed: '🔁', split: '🤝', category: '🍽️', record: '🧾',
}

/** 홈 맨 위 코치 카드. 판단은 src/coach.ts(서버 알림과 같은 함수), 여기는 보여주기만 한다. */
function CoachCard({ advice, status, onOpenInsights, onOpenUncategorized }: {
  advice: Advice[]
  status: LedgerLoadStatus
  onOpenInsights: () => void
  onOpenUncategorized: () => void
}) {
  const [open, setOpen] = useState(false)
  const shown = open ? advice : advice.slice(0, 3)
  const iconOf = (a: Advice) => a.kind === 'category' ? categoryIcon(a.id.slice(4)) : COACH_ICON[a.kind]
  const actionOf = (a: Advice) => a.target === 'insights' ? onOpenInsights : a.target === 'uncategorized' ? onOpenUncategorized : undefined
  return (
    <section className="coach-card" aria-labelledby="home-coach-title" aria-busy={status === 'loading'}>
      <h2 id="home-coach-title">{t('coach_title')}</h2>
      {status === 'loading' ? <div className="coach-skeleton" />
        : status === 'error' ? <p className="coach-quiet">{t('coach_error')}</p>
        : !advice.length ? <p className="coach-quiet">{t('coach_empty')}</p>
        : (
          <ul className="coach-list">
            {shown.map((a) => {
              const act = actionOf(a)
              const inner = (
                <>
                  <span className="coach-ic" aria-hidden>{iconOf(a)}</span>
                  <span className="coach-title">{a.title}</span>
                  {a.badge && <span className="coach-badge">{a.badge}</span>}
                  <span className="coach-detail">{a.detail}</span>
                </>
              )
              return (
                <li key={a.id}>
                  {act ? <button type="button" className="coach-row" onClick={act}>{inner}</button>
                    : <div className="coach-row">{inner}</div>}
                </li>
              )
            })}
          </ul>
        )}
      {status === 'ready' && advice.length > 3 && (
        <button type="button" className="coach-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('coach_less') : t('coach_more', { n: advice.length - 3 })}
        </button>
      )}
    </section>
  )
}

function CardBenefitOverview({ rows, monthKey, onOpenInsights, ledgerStatus }: {
  rows: (SplitTxLike & { payment?: string })[]
  monthKey: string
  onOpenInsights: () => void
  ledgerStatus: LedgerLoadStatus
}) {
  const [selectedCard, setSelectedCard] = useState('')
  const basisMonth = previousMonthKey(monthKey)
  const basisPerf = useMemo(() => cardPerformance(rows as never, basisMonth), [rows, basisMonth])
  // 끝난 달의 실적은 다시 바뀌지 않는다. 한 번 계산되면 저장해두고, 원장을 못 읽는 날엔 그 값을 쓴다.
  // 원장이 다 들어온 뒤에만 저장한다. 로딩 중에는 할부·최근 입력분만 잡혀서
  // 실적이 실제보다 낮게 나오는데, 그걸 눌러버리면 틀린 값이 계속 남는다.
  const knownPerf = useMemo(() => {
    if (ledgerStatus === 'ready' && basisPerf.length) {
      cacheCardPerf(basisMonth, basisPerf)
      return new Map(basisPerf.map((c) => [c.name, c.qualified]))
    }
    const saved = readCardPerf(basisMonth)
    return saved.size ? saved : new Map(basisPerf.map((c) => [c.name, c.qualified]))
  }, [basisPerf, basisMonth, ledgerStatus])
  const balances = useMemo(() => benefitBalances(rows as never, monthKey, undefined, knownPerf), [rows, monthKey, knownPerf])
  const glance = useMemo(() => cardGlance(rows as never, monthKey, balances), [rows, monthKey, balances])
  const cardGroups = CARD_SPECS.filter((spec) => spec.owned && spec.benefits.length)
    .map((spec) => ({ spec, items: balances.filter((item) => item.card === spec.card) }))
    .filter((group) => group.items.length)
  const preferred = cardGroups.find((group) => group.items.some((item) => item.used > 0))?.spec.card
    ?? cardGroups[0]?.spec.card ?? ''
  const currentCard = cardGroups.some((group) => group.spec.card === selectedCard) ? selectedCard : preferred
  const current = cardGroups.find((group) => group.spec.card === currentCard)
  const currentLocked = current?.items.some((item) => item.locked) ?? false
  // 'error' 까지 '확인 중'으로 보여주면 영영 확인 중이다. 못 읽은 건 못 읽었다고 해야 한다.
  const currentChecking = !current?.spec.familyPooled && ledgerStatus === 'loading'
  const currentFailed = !current?.spec.familyPooled && ledgerStatus === 'error' && !knownPerf.size
  const currentBasisAmount = basisPerf.find((item) => item.name === currentCard)?.qualified ?? knownPerf.get(currentCard) ?? 0
  const pct = (rate: number) => `${Math.round(rate * 100)}%`

  return (
    <section className="benefit-board" aria-labelledby="home-card-benefit-title">
      <div className="benefit-board-head">
        <div>
          <p className="benefit-eyebrow">{t('home_benefit_eyebrow')}</p>
          <h2 id="home-card-benefit-title">{t('home_benefit_title')}</h2>
        </div>
        <button type="button" className="benefit-more" onClick={onOpenInsights}>{t('home_benefit_more')} <span aria-hidden>→</span></button>
      </div>


      {glance.length > 0 && (
        <div className="card-glance" aria-label={t('glance_aria')}>
          {glance.map((g) => {
            const fill = g.target && !g.unknown ? Math.min(1, g.qualified / g.target) : 0
            return (
              <button type="button" className={`card-glance-row${g.card === currentCard ? ' active' : ''}`} key={g.card} onClick={() => setSelectedCard(g.card)}>
                <span className="cg-name">{g.card.replace('카드', '')}</span>
                <span className={`cg-bar${g.met ? ' met' : ''}`}><span style={{ width: `${fill * 100}%` }} /></span>
                <span className="cg-perf">
                  {g.unknown ? t('glance_family') : g.met
                    ? (g.nextGap ? t('glance_met_next', { gap: formatMoney(g.nextGap) }) : t('glance_met'))
                    : t('glance_gap', { gap: formatMoney(g.target - g.qualified) })}
                </span>
                <span className="cg-use">
                  {g.locked ? t('glance_locked') : t('glance_used', { used: g.usedAreas, total: g.totalAreas, rem: formatMoney(g.remaining) })}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {current ? (
        <div className="benefit-wallet">
          <div className="benefit-card-tabs" role="tablist" aria-label={t('home_benefit_cards')}>
            {cardGroups.map((group) => {
              const isActive = group.spec.card === currentCard
              const exhausted = group.items.every((item) => item.remaining <= 0)
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  className={isActive ? 'active' : undefined}
                  key={group.spec.card}
                  onClick={() => setSelectedCard(group.spec.card)}
                >
                  {group.spec.card.replace('카드', '')}
                  {exhausted && <span aria-label={t('home_benefit_exhausted')}>✓</span>}
                </button>
              )
            })}
          </div>
          <div className="benefit-basis">
            <div>
              <strong>{t('home_benefit_basis', { month: monthKey, prev: basisMonth })}</strong>
              <span>{current.spec.familyPooled
                ? t('home_perf_family')
                : ledgerStatus === 'loading' ? t('home_benefit_loading')
                : ledgerStatus === 'error' ? t('home_benefit_load_error')
                : t('home_benefit_prev_perf', { month: basisMonth, amt: formatMoney(currentBasisAmount) })}</span>
            </div>
            <b className={currentChecking ? 'checking' : currentFailed ? 'locked' : currentLocked ? 'locked' : 'available'}>
              {currentChecking ? t('home_benefit_checking')
                : currentFailed ? t('home_benefit_unknown')
                : currentLocked ? t('home_benefit_unavailable', { month: monthKey }) : t('home_benefit_available', { month: monthKey })}
            </b>
          </div>
          <p className="benefit-estimate">{current.spec.sharedCap ? t('home_benefit_shared') : t('home_benefit_estimate')}</p>
          <div className="benefit-balance-list" role="tabpanel">
            {current.items.map((item) => {
              const progress = item.cap ? Math.min(100, (item.used / item.cap) * 100) : 0
              return (
                <article className={`benefit-balance${item.locked ? ' locked' : ''}`} key={`${item.card}/${item.area}`}>
                  <div className="benefit-balance-head">
                    <p><strong>{item.area}</strong><span>{current.spec.sharedCap ? t('home_benefit_shared_cap') : pct(item.rate)}</span></p>
                    <b>{item.locked ? t('playbook_locked') : t('home_benefit_remaining', { amt: formatMoney(item.remaining) })}</b>
                  </div>
                  <div className="benefit-progress" aria-label={t('home_benefit_progress', { used: formatMoney(item.used), cap: formatMoney(item.cap) })}>
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <div className="benefit-balance-meta">
                    <span>{item.locked ? t('unused_locked', { gap: formatMoney(item.lockGap) }) : t('home_benefit_used', { used: formatMoney(item.used), cap: formatMoney(item.cap) })}</span>
                    <span>{item.keywords.slice(0, 3).join(' · ')}</span>
                  </div>
                  {current.spec.sharedCap && (
                    <div className="benefit-shared-areas">
                      {current.spec.benefits.map((benefit) => (
                        <div key={benefit.area}>
                          <span><strong>{benefit.area}</strong> {pct(benefit.rate)}</span>
                          <small>{benefit.minAmount ? t('home_benefit_minimum', { amt: formatMoney(benefit.minAmount) }) : benefit.note}</small>
                        </div>
                      ))}
                    </div>
                  )}
                  {item.uses.length > 0 && (
                    <div className="benefit-use-list">
                      {item.uses.map((use, i) => (
                        <div key={`${use.date}/${use.memo}/${i}`}>
                          <span>{use.date.slice(5)} · {use.memo}{current.spec.sharedCap ? ` · ${use.area}` : ''}</span>
                          <b>{t('home_benefit_use_gain', { amt: formatMoney(use.discount) })}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        </div>
      ) : (
        <p className="benefit-empty">{t('home_benefit_empty')}</p>
      )}

    </section>
  )
}

function Ledger({
  transactions,
  onDelete,
  onEdit,
  quickChips,
  onQuickAddForDate,
  onChipAddForDate,
}: {
  transactions: Transaction[]
  onDelete: (id: string) => void
  onEdit: (updated: Transaction) => void
  quickChips: QuickChip[]
  onQuickAddForDate: (raw: string, date: string) => void
  onChipAddForDate: (chip: QuickChip, date: string) => void
}) {
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [filter, setFilter] = useState<'all' | TransactionType>('all')
  const now = new Date()
  const [ym, setYm] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [editingTx, setEditingTx] = useState<Transaction | null>(null)
  const categoryOptions = useMemo(() => distinctCategoryOptions(transactions), [transactions])
  // 원장은 '적은 순'으로 본다. 날짜순이면 매달 1~5일에 자동 등록되는 고정비가
  // 늘 맨 위를 차지해서, 방금 적은 것을 확인하려면 그걸 지나쳐 내려가야 했다.
  // 아직 시트에 못 올라간 로컬 입력분(enteredAt 없음)은 방금 적은 것이므로 맨 앞에 둔다.
  const recorded = (item: Transaction) => item.enteredAt || '9999-99-99'
  const filtered = transactions
    .filter((item) => filter === 'all' || item.type === filter)
    .slice()
    .sort((a, b) => recorded(b).localeCompare(recorded(a)) || b.date.localeCompare(a.date))
  const yearMonth = `${ym.year}-${String(ym.month).padStart(2, '0')}`
  const totals = dailyTotals(transactions, yearMonth)
  const prevMonth = () => setYm((s) => (s.month === 1 ? { year: s.year - 1, month: 12 } : { ...s, month: s.month - 1 }))
  const nextMonth = () => setYm((s) => (s.month === 12 ? { year: s.year + 1, month: 1 } : { ...s, month: s.month + 1 }))

  return (
    <section className="view-stack">
      <div className="segmented">
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>{t('view_list')}</button>
        <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>{t('view_calendar')}</button>
      </div>

      {view === 'list' && (
        <>
          <div className="segmented">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>{t('filter_all')}</button>
            <button type="button" className={filter === 'expense' ? 'active' : ''} onClick={() => setFilter('expense')}>{t('filter_expense')}</button>
            <button type="button" className={filter === 'income' ? 'active' : ''} onClick={() => setFilter('income')}>{t('filter_income')}</button>
          </div>
          <section className="ledger-table">
            {filtered.map((transaction) => (
              <article className="ledger-row" key={transaction.id}>
                <button type="button" className="ledger-row-main" onClick={() => setEditingTx(transaction)}>
                  <p className="row-title">
                    <span className="row-place"><Store size={13} aria-hidden />{splitPlaceItem(transaction.memo).place || t('not_entered')}</span>
                    {splitPlaceItem(transaction.memo).item && <span className="row-item"> · {splitPlaceItem(transaction.memo).item}</span>}
                  </p>
                  <p className="row-meta">
                    {formatDateLabel(transaction.date)} · {transaction.category} · {transaction.payment || t('unspecified')} · {fixedTypeLabel(transaction.fixedType)}
                  </p>
                </button>
                <div className="row-actions">
                  <strong className={transaction.type === 'income' ? 'income' : ''}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}</strong>
                  <button type="button" className="edit-btn" aria-label={t('btn_edit')} onClick={() => setEditingTx(transaction)}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" aria-label={t('btn_delete')} onClick={() => onDelete(transaction.id)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </section>

          {editingTx && (
            <TransactionEditSheet
              key={editingTx.id}
              tx={editingTx}
              categoryOptions={categoryOptions}
              onClose={() => setEditingTx(null)}
              onSave={(updated) => { onEdit(updated); setEditingTx(null) }}
            />
          )}
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
        <button type="button" onClick={onPrev} aria-label={t('prev_month')}>‹</button>
        <span>{year}.{month}</span>
        <button type="button" onClick={onNext} aria-label={t('next_month')}>›</button>
      </div>
      <div className="cal-weekdays">
        {[t('wd_sun'), t('wd_mon'), t('wd_tue'), t('wd_wed'), t('wd_thu'), t('wd_fri'), t('wd_sat')].map((w, i) => <span key={i}>{w}</span>)}
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
            <p>{t('amount_count', { amt: formatMoney(total), n: transactions.length })}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('btn_close')}><X size={18} /></button>
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
              placeholder={t('day_input_placeholder')}
            />
            <button type="button" className="send-button" onClick={submit} aria-label={t('btn_input')}><Send size={18} /></button>
          </div>
        </div>
        <div className="cat-tx-list">
          {transactions.length === 0 && <p className="cat-empty">{t('no_transactions_add_above')}</p>}
          {transactions.map((tx) => (
            <div className="cat-tx-row" key={tx.id}>
              <div>
                <p className="row-title">{tx.memo}</p>
                <p className="row-meta">{tx.category} · {tx.subCategory || t('unspecified')} · {tx.payment || t('unspecified')}</p>
              </div>
              <span className="cat-tx-amt">{formatMoney(tx.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AssetsView({ store, summary, onSaveAsset }: { store: FinanceStore; summary: Summary; onSaveAsset: (asset: Asset) => void }) {
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)

  return (
    <section className="view-stack">
      <div className="balance-band">
        <div>
          <p className="eyebrow">{t('net_worth')}</p>
          <h2>{formatMoney(summary.netWorth)}</h2>
        </div>
        <div className="balance-pair">
          <span>{t('assets_label_amt', { amt: formatMoney(summary.assetTotal + summary.investmentTotal) })}</span>
          <span>{t('liabilities_label_amt', { amt: formatMoney(summary.loanTotal) })}</span>
        </div>
      </div>

      <AssetEditor key={editingAsset?.id ?? 'new'} asset={editingAsset} onSave={onSaveAsset} onDone={() => setEditingAsset(null)} />

      <section className="split-layout">
        <AssetColumn title={t('tab_assets')} icon={<Wallet size={18} />}>
          {store.assets.map((item) => (
            <ValueRow
              key={item.id}
              title={item.name}
              meta={`${item.kind} · ${item.institution}`}
              value={item.amount}
              actionLabel={t('btn_edit')}
              onAction={() => setEditingAsset(item)}
            />
          ))}
        </AssetColumn>

        <AssetColumn title={t('investments_title')} icon={<TrendingUp size={18} />}>
          {store.investments.map((item) => (
            <ValueRow key={item.id} title={item.name} meta={item.account} value={item.value} badge={formatPercent(item.returnRate)} negative={item.returnRate < 0} />
          ))}
        </AssetColumn>
      </section>

      <section className="wide-section">
        <SectionHeader icon={<Landmark size={18} />} title={t('loans_title')} aside={formatMoney(summary.loanTotal)} />
        <div className="recent-list">
          {store.loans.map((loanItem) => (
            <ValueRow
              key={loanItem.id}
              title={loanItem.name}
              meta={`${loanItem.institution} · ${loanItem.dueDay}`}
              value={loanItem.balance}
              badge={t('monthly_amt', { amt: formatMoney(loanItem.monthlyPayment) })}
              negative
            />
          ))}
        </div>
      </section>
    </section>
  )
}

/**
 * 카드별 혜택 가이드. 약관은 dashboardLogic의 CARD_SPECS 한 곳에만 있고 여기선 그리기만 한다.
 * 실적/한도는 전월 기준이라, 이번 달에 실제로 열려 있는 혜택과 "실적을 채웠다면" 을 나눠 보여준다.
 */
function CardGuide({ transactions, monthKey }: { transactions: Transaction[]; monthKey: string }) {
  const rows = useMemo(() => {
    // 할부는 결제한 달에 총액이 실적으로 잡힌다 - 고정비의 월 납입액만으론 그게 안 보인다.
    const defs = readFixedDefsCache()
    return withInstallmentCharges(transactions, defs)
  }, [transactions])
  const perf = useMemo(() => cardPerformance(rows as never, monthKey), [rows, monthKey])
  const missed = useMemo(() => missedBenefits(rows as never, monthKey), [rows, monthKey])
  const potential = useMemo(() => missedBenefits(rows as never, monthKey, undefined, true), [rows, monthKey])
  const unused = useMemo(() => unusedBenefits(rows as never, monthKey), [rows, monthKey])
  const playbook = useMemo(() => paymentPlaybook(rows as never, monthKey), [rows, monthKey])

  // 이번 달 결제가 없어도 보유 카드는 다 보여준다. 국민 Rose Gold는 가족카드 실적이라
  // 애초에 내 원장에 결제가 안 잡히는데, 그 카드야말로 혜택 안내가 필요하다.
  const specs = CARD_SPECS
  if (!specs.length) return null

  const sum = (hits: typeof missed) => hits.reduce((a, h) => a + h.discount, 0)
  const pct = (r: number) => `${Math.round(r * 100)}%`
  const capLabel = (spec: CardSpec, cap: number) =>
    cap > 0 ? t(spec.sharedCap ? 'guide_cap_shared' : 'guide_cap_area', { amt: formatMoney(cap) }) : ''

  return (
    <>
      {(missed.length > 0 || potential.length > 0) && (
        <section className="wide-section">
          <SectionHeader icon={<Sparkles size={18} />} title={t(missed.length ? 'guide_missed' : 'guide_potential')} aside={monthKey} />
          <p className="row-meta perf-note">{t(missed.length ? 'guide_missed_note' : 'guide_potential_note')}</p>
          <div className="guide-hits">
            {(missed.length ? missed : potential).slice(0, 8).map((h, i) => (
              <div className="guide-hit" key={`${h.date}-${h.memo}-${i}`}>
                <div>
                  <p className="row-title">{h.memo}</p>
                  <p className="row-meta">{h.date.slice(5)} · {formatMoney(h.amount)} · {h.usedCard} → <b>{h.bestCard}</b> {h.area} {pct(h.rate)}</p>
                </div>
                <strong className="guide-gain">+{formatMoney(h.discount)}</strong>
              </div>
            ))}
          </div>
          <p className="guide-total">{t('guide_total', { amt: formatMoney(sum(missed.length ? missed : potential)) })}</p>
        </section>
      )}

      {playbook.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<CreditCard size={18} />} title={t('sec_playbook')} aside={monthKey} />
          <p className="row-meta perf-note">{t('playbook_note')}</p>
          <div className="pb-list">
            {playbook.map((p) => (
              <div className="pb-row" key={`${p.card}/${p.area}`}>
                <div className="pb-head">
                  <b className="pb-rate">{pct(p.rate)}</b>
                  <strong>{p.card}</strong>
                  <span className="row-meta">{p.area}</span>
                  <span className={`pb-left${p.locked || p.remaining <= 0 ? ' off' : ''}`}>
                    {p.locked ? t('playbook_locked')
                      : p.remaining > 0 ? t('playbook_left', { amt: formatMoney(p.remaining) })
                      : t('playbook_done')}
                  </span>
                </div>
                <p className="pb-where">{p.keywords.slice(0, 7).join(' · ')}</p>
                {(p.minAmount || p.runnerUp || p.note) && (
                  <p className="guide-note">
                    {p.minAmount ? t('guide_min', { amt: formatMoney(p.minAmount) }) : ''}
                    {p.minAmount && (p.runnerUp || p.note) ? ' · ' : ''}
                    {p.runnerUp ? t('playbook_alt', { card: p.runnerUp.card, pct: pct(p.runnerUp.rate) }) : ''}
                    {p.note ? (p.minAmount || p.runnerUp ? ' ' : '') + p.note : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {unused.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<Wallet size={18} />} title={t('sec_unused')} aside={monthKey} />
          <p className="row-meta perf-note">{t('unused_note')}</p>
          <div className="guide-hits">
            {unused.slice(0, 8).map((u) => (
              <div className="guide-hit" key={`${u.card}/${u.area}`}>
                <div>
                  <p className="row-title">{u.card} · {u.area} {pct(u.rate)}</p>
                  <p className="row-meta">
                    {u.locked
                      ? t('unused_locked', { gap: formatMoney(u.lockGap) })
                      : t('unused_left', { cap: formatMoney(u.cap), used: formatMoney(u.used) })}
                  </p>
                  <p className="guide-note">
                    {u.keywords.slice(0, 5).join(' · ')}
                    {u.minAmount ? ` · ${t('guide_min', { amt: formatMoney(u.minAmount) })}` : ''}
                  </p>
                </div>
                <strong className={u.locked ? 'guide-locked' : 'guide-gain'}>{formatMoney(u.remaining)}</strong>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="wide-section">
        <SectionHeader icon={<CreditCard size={18} />} title={t('sec_card_guide')} />
        <div className="guide-cards">
          {specs.map((spec) => {
            const q = perf.find((c) => c.name === spec.card)?.qualified ?? 0
            const st = spec.tiers.length ? tierStatus(q, spec.tiers) : null
            const locked = Boolean(spec.owned && spec.tiers.length && q < Math.min(...spec.tiers.map((x) => x.min)))
            return (
              <article className="guide-card" key={spec.card}>
                <div className="guide-card-head">
                  <strong>{spec.card}</strong>
                  <span className="row-meta">
                    {t('guide_fee', { amt: formatMoney(spec.annualFee) })}
                    {!spec.owned && ` · ${t('guide_candidate')}`}
                  </span>
                </div>
                <p className="row-meta">
                  {!spec.tiers.length ? t('guide_no_tier')
                    : locked ? t('guide_locked')
                    : st && st.cap > 0 ? capLabel(spec, st.cap)
                    : t('perf_met')}
                </p>
                {spec.benefits.map((b) => (
                  <div className="guide-area" key={b.area}>
                    <p className="guide-area-head">
                      <span>{b.area}</span>
                      <b>{pct(b.rate)}</b>
                      {b.cap > 0 && <span className="row-meta">{formatMoney(b.cap)}</span>}
                      {b.minAmount ? <span className="row-meta">{t('guide_min', { amt: formatMoney(b.minAmount) })}</span> : null}
                    </p>
                    <p className="row-meta">{b.keywords.slice(0, 6).join(' · ')}</p>
                    {b.note && <p className="guide-note">{b.note}</p>}
                  </div>
                ))}
                {spec.notes.map((n) => <p className="guide-note" key={n}>{n}</p>)}
              </article>
            )
          })}
        </div>
      </section>
    </>
  )
}

function InsightsView({ store, summary, transactions }: { store: FinanceStore; summary: Summary; transactions: Transaction[] }) {
  const insightRows = buildInsights(transactions, summary, store)
  const colors = RING_COLORS.slice(0, 6)
  const places = placeTotals(transactions, summary.monthKey, 7)
  // 소액(1만원 미만) 카드는 노이즈라 상세에서도 뺀다. 주요 카드는 금액과 무관하게 유지.
  const cardPerf = cardPerformance(withInstallmentCharges(transactions, readFixedDefsCache()) as never, summary.monthKey)
    .filter((c) => c.charged >= 10000 || PRIMARY_CARDS.includes(c.name))
  const deltas = categoryDeltas(transactions, summary.monthKey, summary.previousMonth?.month).slice(0, 5)
  const maxDelta = Math.max(1, ...deltas.map((d) => Math.abs(d.delta)))

  return (
    <section className="view-stack">
      <section className="wide-section">
        <SectionHeader icon={<ChartNoAxesCombined size={18} />} title={t('sec_month_flow')} aside={summary.monthlyTrend.at(-1)?.month ?? ''} />
        <div className="chart-frame">
          <Suspense fallback={null}><TrendChart data={summary.monthlyTrend} money={formatMoney} compact={compactMoney} label={t('real_spend')} /></Suspense>
        </div>
      </section>

      <section className="wide-section">
        <SectionHeader icon={<ChartNoAxesCombined size={18} />} title={t('sec_delta')} aside={summary.previousMonth?.monthLabel ?? ''} />
        {deltas.length === 0 ? (
          <p className="row-meta" style={{ padding: '8px 2px' }}>{t('delta_no_data')}</p>
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
                    {d.rate == null ? t('new_badge') : `${up ? '↑' : '↓'}${formatPercent(Math.abs(d.rate))}`} ({formatSignedMoney(d.delta)})
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="insight-board">
        {insightRows.map((item) => (
          <article className={`insight-card ${item.level}`} key={item.title}>
            <div className="insight-icon">{item.icon}</div>
            <div>
              <p className="row-title">{item.title}</p>
              <p className="row-meta">{item.body}</p>
            </div>
          </article>
        ))}
      </section>

      <section className="wide-section">
        <SectionHeader icon={<CircleDollarSign size={18} />} title={t('sec_spend_ratio')} aside={summary.monthKey} />
        <div className="chart-frame">
          <Suspense fallback={null}><RankChart data={summary.categoryTotals.slice(0, 7)} colors={colors} money={formatMoney} compact={compactMoney} label={t('spend_amount')} /></Suspense>
        </div>
      </section>

      {cardPerf.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<CreditCard size={18} />} title={t('sec_card_perf')} aside={summary.monthKey} />
          <p className="row-meta perf-note">{t('perf_note')}</p>
          <div className="perf-list">
            {cardPerf.map((c) => {
              const tiers = CARD_TIERS[c.name]
              const st = tiers ? tierStatus(c.qualified, tiers) : null
              const goal = st?.next?.min ?? c.qualified
              return (
                <div className="perf-row" key={c.name}>
                  <div className="perf-head">
                    <strong>{c.name}</strong>
                    {st && <span className="perf-cap">{st.cap > 0 ? t('perf_cap', { amt: formatMoney(st.cap) }) : (st.next ? '' : t('perf_met'))}</span>}
                  </div>
                  <div className="perf-bar">
                    <span className="perf-fill" style={{ width: `${Math.min(100, goal ? (c.qualified / goal) * 100 : 100)}%` }} />
                  </div>
                  <div className="perf-meta">
                    <span>{t('perf_qualified', { amt: formatMoney(c.qualified) })}</span>
                    {c.excluded > 0 && <span className="perf-excl">{t('perf_excluded', { amt: formatMoney(c.excluded) })}</span>}
                  </div>
                  {st?.next && (
                    <p className="perf-next">{t('perf_next', {
                      gap: formatMoney(st.next.gap), min: formatMoney(st.next.min), cap: formatMoney(st.next.cap),
                    })}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      <CardGuide transactions={transactions} monthKey={summary.monthKey} />

      {summary.paymentTotals.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<Wallet size={18} />} title={t('sec_by_payment')} aside={summary.monthKey} />
          <div className="delta-list">
            {topNWithOther(summary.paymentTotals, 6, t('sub_other')).map((p) => (
              <div className="delta-row" key={p.name}>
                <span className="delta-name">{p.name}</span>
                <div className="delta-bar-wrap">
                  <span className="delta-bar down" style={{ width: `${(p.value / summary.paymentTotals[0].value) * 100}%` }} />
                </div>
                <span className="delta-val">{formatMoney(p.value)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {places.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<CircleDollarSign size={18} />} title={t('sec_place_top')} aside={summary.monthKey} />
          <div className="chart-frame">
            <Suspense fallback={null}><RankChart data={places} colors={colors} money={formatMoney} compact={compactMoney} label={t('spend_amount')} /></Suspense>
          </div>
        </section>
      )}
    </section>
  )
}

function emptyFixedDef(monthKey: string, kind: 'expense' | 'income'): FixedDef {
  return { id: '', active: true, name: '', amount: 0, category: kind === 'income' ? '수입' : '', subCategory: '', payment: kind === 'income' ? '계좌이체' : '카드', payDay: 1, startMonth: monthKey, installmentTotal: null, variable: false, split: 0, kind }
}

const FIXED_DEFS_CACHE_KEY = 'shiba-fixed-defs:v1'

function readFixedDefsCache(): FixedDef[] {
  try {
    const raw = window.localStorage.getItem(FIXED_DEFS_CACHE_KEY)
    return raw ? (JSON.parse(raw) as FixedDef[]) : []
  } catch {
    return []
  }
}

function cacheFixedDefs(defs: FixedDef[]) {
  try { window.localStorage.setItem(FIXED_DEFS_CACHE_KEY, JSON.stringify(defs)) } catch { /* 용량 초과 등은 무시 */ }
}

function FixedView({ monthKey }: { monthKey: string }) {
  // 캐시된 값으로 즉시 렌더(stale) → 백그라운드에서 서버 갱신(revalidate)
  const [defs, setDefs] = useState<FixedDef[]>(() => readFixedDefsCache())
  const [editing, setEditing] = useState<FixedDef | null>(null)
  const [busy, setBusy] = useState(false)
  // 캐시가 없을 때(첫 방문)만 로딩 표시
  const [loading, setLoading] = useState(() => readFixedDefsCache().length === 0)

  const [view, setView] = useState<'expense' | 'income'>('expense')

  useEffect(() => {
    let active = true
    loadFixedDefs()
      .then((next) => {
        if (!active) return
        setDefs(next)
        cacheFixedDefs(next)
      })
      .catch(() => { /* 오프라인이면 캐시 유지 */ })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const applyDefs = (next: FixedDef[]) => {
    setDefs(next)
    cacheFixedDefs(next)
  }
  const reload = () => {
    loadFixedDefs()
      .then(applyDefs)
      .catch(() => { /* 오프라인이면 캐시 유지 */ })
      .finally(() => setLoading(false))
  }

  const shown = defs.filter((d) => (d.kind || 'expense') === view)
  const activeTotal = shown.filter((d) => d.active).reduce((s, d) => s + d.amount, 0)
  // 고정비는 성격이 둘로 나뉜다: 매달 계속 나가는 정기결제와, 회차가 끝나면 사라지는 할부.
  // installmentTotal이 이미 그 구분을 갖고 있어서 따로 필드를 만들지 않았다.
  const groups = view === 'income'
    ? [{ key: 'all', label: '', rows: shown }]
    : (() => {
        // 성격이 다른 돈은 섞으면 규모가 안 보인다. 카테고리가 먼저, 그다음이 할부 여부.
        const rest = shown.filter((d) => d.category !== LOAN_CATEGORY && d.category !== SAVING_CATEGORY)
        return [
          { key: 'sub', label: t('group_recurring'), rows: rest.filter((d) => !d.installmentTotal) },
          { key: 'inst', label: t('group_installment'), rows: rest.filter((d) => d.installmentTotal) },
          { key: 'loan', label: t('group_loan'), rows: shown.filter((d) => d.category === LOAN_CATEGORY) },
          { key: 'save', label: t('group_saving'), rows: shown.filter((d) => d.category === SAVING_CATEGORY) },
        ].filter((g) => g.rows.length > 0)
      })()

  async function save(def: FixedDef) {
    setBusy(true)
    // 낙관적 반영: 서버 응답 전에 화면/캐시 먼저 갱신
    const exists = defs.some((d) => d.id === def.id)
    applyDefs(exists ? defs.map((d) => (d.id === def.id ? def : d)) : [...defs, def])
    setEditing(null)
    const ok = await saveFixedDef(def).catch(() => false)
    setBusy(false)
    if (ok) reload()
  }
  async function remove(id: string) {
    setBusy(true)
    applyDefs(defs.filter((d) => d.id !== id))
    setEditing(null)
    const ok = await deleteFixedDef(id).catch(() => false)
    setBusy(false)
    if (ok) reload()
  }
  async function toggle(def: FixedDef) {
    // 낙관적 토글: 재요청 없이 즉시 반영
    applyDefs(defs.map((d) => (d.id === def.id ? { ...d, active: !d.active } : d)))
    saveFixedDef({ ...def, active: !def.active }).catch(() => {})
  }

  return (
    <section className="view-stack">
      <div className="segmented">
        <button type="button" className={view === 'expense' ? 'active' : ''} onClick={() => setView('expense')}>{t('filter_expense')}</button>
        <button type="button" className={view === 'income' ? 'active' : ''} onClick={() => setView('income')}>{t('filter_income')}</button>
      </div>
      <div className="fixed-head">
        <div>
          <p className="eyebrow">{t(view === 'income' ? 'fixed_income_title' : 'fixed_expense_title')}</p>
          <h2>{formatMoney(activeTotal)}</h2>
        </div>
        <button type="button" className="fixed-add" onClick={() => setEditing(emptyFixedDef(monthKey, view))}>{t('btn_add')}</button>
      </div>

      <div className="fixed-list">
        {groups.map((g) => [
          g.label ? (
            <p className="fixed-group" key={g.key}>
              {g.label} · {formatMoney(g.rows.filter((r) => r.active).reduce((sum, r) => sum + r.amount, 0))}
            </p>
          ) : null,
          ...g.rows.map((d) => {
          const rem = fixedRemaining(d, monthKey)
          return (
            <article className={`fixed-row${d.active ? '' : ' off'}`} key={d.id}>
              <button type="button" className="fixed-main" onClick={() => setEditing(d)}>
                <div>
                  <p className="row-title">{d.name}{d.variable && <span className="fixed-badge">{t('fixed_type_variable')}</span>}</p>
                  <p className="row-meta">
                    {formatMoney(d.amount)} · {t('monthly_day', { day: d.payDay })}
                    {d.payment && ` · ${d.payment}`}
                    {d.split > 0 && t('split_and_real', { split: formatMoney(d.split), real: formatMoney(d.amount - d.split) })}
                    {d.variable && t('need_check')}
                    {rem && (rem.done ? t('done_suffix') : t('remaining_progress', { count: rem.count, total: rem.total, label: t(d.kind === 'income' ? 'label_to_receive' : 'label_remaining'), amt: formatMoney(rem.remainingAmount) }))}
                  </p>
                </div>
              </button>
              <button type="button" className={`fixed-toggle${d.active ? ' on' : ''}`} onClick={() => toggle(d)} aria-label={t('toggle_active_aria')}>
                {d.active ? 'ON' : 'OFF'}
              </button>
            </article>
          )
          }),
        ])}
        {shown.length === 0 && (
          <p className="cat-empty">
            {loading ? t('loading') : t(view === 'income' ? 'empty_income' : 'empty_fixed')}
          </p>
        )}
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
          <div className="cat-sheet-title"><h3>{t('fixed_sheet_title', { kind: t(def.kind === 'income' ? 'fixed_kind_income' : 'fixed_kind_expense'), action: t(def.id ? 'btn_edit' : 'fixed_action_add') })}</h3></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('btn_close')}><X size={18} /></button>
        </div>
        <div className="fixed-form">
          <label>{t('field_name')}<input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>{t('field_amount')}<input type="number" value={draft.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} /></label>
          <label>{t('field_category')}<input value={draft.category} onChange={(e) => set({ category: e.target.value })} /></label>
          <label>{t('field_subcategory')}<input value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} /></label>
          <label>{t(draft.kind === 'income' ? 'field_deposit_method' : 'field_payment_method')}<input value={draft.payment} onChange={(e) => set({ payment: e.target.value })} /></label>
          {draft.kind !== 'income' && (
            <label>{t('field_split_amount')}<input type="number" value={draft.split || ''} onChange={(e) => set({ split: Number(e.target.value) || 0 })} /></label>
          )}
          <label>{t('field_pay_day')}<input type="number" min={1} max={31} value={draft.payDay || ''} onChange={(e) => set({ payDay: Number(e.target.value) || 1 })} /></label>
          <label>{t('field_start_month')}<input value={draft.startMonth} onChange={(e) => set({ startMonth: e.target.value })} /></label>
          <label>{t('field_installment_total')}<input type="number" value={draft.installmentTotal ?? ''} onChange={(e) => set({ installmentTotal: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="fixed-check">
            <input type="checkbox" checked={draft.variable} onChange={(e) => set({ variable: e.target.checked })} />
            <span>{t('field_variable_note')}</span>
          </label>
        </div>
        <div className="fixed-actions">
          {def.id && <button type="button" className="fixed-del" disabled={busy} onClick={() => onDelete(def.id)}>{t('btn_delete')}</button>}
          <button type="button" className="fixed-save" disabled={busy || !draft.name} onClick={() => onSave(draft)}>{busy ? t('saving') : t('btn_save')}</button>
        </div>
      </div>
    </div>
  )
}

function TransactionEditSheet({ tx, categoryOptions, onClose, onSave }: {
  tx: Transaction
  categoryOptions: { category: string; subCategory: string }[]
  onClose: () => void
  onSave: (updated: Transaction) => void
}) {
  const [draft, setDraft] = useState<Transaction>(tx)
  const set = (patch: Partial<Transaction>) => setDraft((d) => ({ ...d, ...patch }))
  const [place, setPlace] = useState(() => splitPlaceItem(tx.memo).place)
  const [item, setItem] = useState(() => splitPlaceItem(tx.memo).item)
  const [showCat, setShowCat] = useState(false)
  // 기존 데이터의 카테고리 + 기본 카테고리를 합쳐 자동완성 후보로 사용 (직접 입력도 가능)
  const allOptions = useMemo(() => [...categoryOptions, ...DEFAULT_FIX_OPTIONS], [categoryOptions])
  const categoryList = useMemo(
    () => [...new Set(allOptions.map((o) => o.category).filter(Boolean))],
    [allOptions],
  )
  const subCategoryList = useMemo(() => {
    const matched = allOptions.filter((o) => o.category === draft.category && o.subCategory)
    const pool = matched.length ? matched : allOptions
    return [...new Set(pool.map((o) => o.subCategory).filter(Boolean))]
  }, [allOptions, draft.category])
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="cat-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="cat-sheet-head">
          <div className="cat-sheet-title"><h3>{t('tx_edit_title')}</h3></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t('btn_close')}><X size={18} /></button>
        </div>
        <div className="fixed-form">
          <label>{t('field_place')}<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('placeholder_place_example')} /></label>
          <label>{t('field_item')}<input value={item} onChange={(e) => setItem(e.target.value)} placeholder={t('placeholder_item_example')} /></label>
          <label>{t('field_amount')}<input type="number" value={draft.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} /></label>
          <label>{t('field_date')}<input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} /></label>
          <label>{t('field_type')}
            <select value={draft.type} onChange={(e) => set({ type: e.target.value as TransactionType })}>
              <option value="expense">{t('filter_expense')}</option>
              <option value="income">{t('filter_income')}</option>
            </select>
          </label>
          {!showCat ? (
            <button type="button" className="cat-toggle" onClick={() => setShowCat(true)}>
              {t('auto_classify_prefix')}{draft.category || t('uncategorized')}{draft.subCategory ? ' · ' + draft.subCategory : ''}{t('edit_suffix')}
            </button>
          ) : (
            <>
              <label>{t('field_category')}
                <input list="edit-cat-list" value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder={t('placeholder_select_or_type')} />
                <datalist id="edit-cat-list">{categoryList.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label>{t('field_subcategory')}
                <input list="edit-sub-list" value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} placeholder={t('placeholder_select_or_type')} />
                <datalist id="edit-sub-list">{subCategoryList.map((s) => <option key={s} value={s} />)}</datalist>
              </label>
            </>
          )}
          <label>{t('field_payment_method')}<input value={draft.payment} onChange={(e) => set({ payment: e.target.value })} /></label>
          <label>{t('field_fixed_variable')}
            <select value={draft.fixedType} onChange={(e) => set({ fixedType: e.target.value as FixedType })}>
              <option value="variable">{t('opt_variable')}</option>
              <option value="fixed">{t('opt_fixed')}</option>
            </select>
          </label>
          <label>{t('field_split')}<input type="number" value={draft.split || ''} onChange={(e) => set({ split: Number(e.target.value) || 0 })} /></label>
        </div>
        <div className="fixed-actions">
          <button type="button" className="fixed-save" onClick={() => onSave({ ...draft, memo: joinPlaceItem(place, item) })}>{t('btn_save')}</button>
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, aside }: { icon: ReactNode; title: string; aside?: string }) {
  return (
    <div className="section-header">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      {aside && <span>{aside}</span>}
    </div>
  )
}

function FixedVariablePanel({ summary }: { summary: Summary }) {
  const fixedWidth = summary.thisMonth.totalSpend ? (summary.thisMonth.fixed / summary.thisMonth.totalSpend) * 100 : 0
  const variableWidth = summary.thisMonth.totalSpend ? (summary.thisMonth.variable / summary.thisMonth.totalSpend) * 100 : 0

  return (
    <div className="fixed-panel">
      <div className="fixed-track" aria-label={t('fixed_variable_ratio_aria')}>
        <span className="fixed-part" style={{ width: `${fixedWidth}%` }} />
        <span className="variable-part" style={{ width: `${variableWidth}%` }} />
      </div>
      <div className="fixed-grid">
        <div>
          <p>{t('label_fixed_cost')}</p>
          <strong>{formatMoney(summary.thisMonth.fixed)}</strong>
          <span>{formatPercent(summary.fixedShare)}</span>
        </div>
        <div>
          <p>{t('label_variable_cost')}</p>
          <strong>{formatMoney(summary.thisMonth.variable)}</strong>
          <span>{formatPercent(summary.thisMonth.totalSpend ? summary.thisMonth.variable / summary.thisMonth.totalSpend : 0)}</span>
        </div>
      </div>
      <div className="fixed-total">
        <span>{t('total_with_fixed')}</span>
        <strong>{formatMoney(summary.thisMonth.realSpend)}</strong>
      </div>
      {summary.thisMonth.loanRepaid > 0 && (
        <div className="fixed-total saved">
          <span>{t('total_loan_repaid')}</span>
          <strong>{formatMoney(summary.thisMonth.loanRepaid)}</strong>
        </div>
      )}
      {summary.thisMonth.saved > 0 && (
        /* 저축은 지출 합계 밖에 있다. 안 보여주면 통장에서 나간 돈과 안 맞아 헷갈린다. */
        <div className="fixed-total saved">
          <span>{t('total_saved')}</span>
          <strong>{formatMoney(summary.thisMonth.saved)}</strong>
        </div>
      )}
    </div>
  )
}

type AssetDraft = {
  id: string
  kind: string
  name: string
  institution: string
  amount: string
}

function AssetEditor({ asset, onSave, onDone }: { asset: Asset | null; onSave: (asset: Asset) => void; onDone: () => void }) {
  const [draft, setDraft] = useState<AssetDraft>(() => assetToDraft(asset))

  function update(field: keyof AssetDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  function submit() {
    const amount = moneyNumber(draft.amount || '0')
    if (!draft.name.trim() || !amount) return

    onSave({
      id: draft.id || uid(),
      date: todayIso(),
      kind: draft.kind.trim() || '현금',
      name: draft.name.trim(),
      institution: draft.institution.trim() || '미지정',
      amount,
      note: '앱에서 직접 수정',
    })
    setDraft(assetToDraft(null))
    onDone()
  }

  return (
    <section className="asset-editor">
      <SectionHeader icon={asset ? <Pencil size={18} /> : <Plus size={18} />} title={asset ? t('asset_edit_title') : t('asset_add_title')} aside={asset ? asset.name : t('manual_input')} />
      <div className="asset-form">
        <input value={draft.kind} onChange={(event) => update('kind', event.target.value)} placeholder={t('placeholder_kind')} />
        <input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder={t('field_name')} />
        <input value={draft.institution} onChange={(event) => update('institution', event.target.value)} placeholder={t('placeholder_institution')} />
        <input value={draft.amount} onChange={(event) => update('amount', event.target.value.replace(/[^\d,]/g, ''))} inputMode="numeric" placeholder={t('field_amount')} />
        <button type="button" onClick={submit}>
          <Save size={17} />
          {t('btn_save')}
        </button>
      </div>
    </section>
  )
}

function assetToDraft(asset: Asset | null): AssetDraft {
  return {
    id: asset?.id ?? '',
    kind: asset?.kind ?? '현금',
    name: asset?.name ?? '',
    institution: asset?.institution ?? '',
    amount: asset ? String(asset.amount) : '',
  }
}

function AssetColumn({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="wide-section">
      <SectionHeader icon={icon} title={title} />
      <div className="recent-list">{children}</div>
    </section>
  )
}

function ValueRow({
  title,
  meta,
  value,
  badge,
  negative,
  actionLabel,
  onAction,
}: {
  title: string
  meta: string
  value: number
  badge?: string
  negative?: boolean
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <article className="mini-row">
      <div className={`mini-icon ${negative ? 'danger' : ''}`}>
        {negative ? <TrendingDown size={17} /> : <Wallet size={17} />}
      </div>
      <div>
        <p className="row-title">{title}</p>
        <p className="row-meta">{meta}</p>
      </div>
      <div className="value-stack">
        <strong className={negative ? 'negative' : ''}>{formatMoney(value)}</strong>
        {badge && <span>{badge}</span>}
        {onAction && (
          <button type="button" onClick={onAction}>
            {actionLabel}
          </button>
        )}
      </div>
    </article>
  )
}

function TabButton({
  tab,
  activeTab,
  icon,
  label,
  onClick,
}: {
  tab: Tab
  activeTab: Tab
  icon: ReactNode
  label: string
  onClick: (tab: Tab) => void
}) {
  return (
    <button type="button" className={activeTab === tab ? 'active' : ''} onClick={() => onClick(tab)} aria-label={label}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

type NameValue = { name: string; value: number }
type MonthMetric = {
  month: string
  monthLabel: string
  totalSpend: number
  realSpend: number
  fixed: number
  variable: number
  income: number
  saved: number      // 저축·투자로 옮긴 돈. 지출 합계에는 안 들어간다
  loanRepaid: number // 대출로 갚은 돈. 같은 이유로 지출 합계 밖
}

type Summary = {
  monthKey: string
  thisMonth: MonthMetric
  previousMonth?: MonthMetric
  monthlyTrend: MonthMetric[]
  categoryTotals: NameValue[]
  variableTotals: NameValue[]   // 고정비 제외·분담금 차감(홈 대표 숫자와 합이 일치)
  paymentTotals: NameValue[]
  assetTotal: number
  investmentTotal: number
  loanTotal: number
  netWorth: number
  fixedShare: number
  investmentShare: number
  budget: number
  budgetUsageRate: number
}

const CARD_PERF_CACHE_KEY = 'shiba-card-perf:v1'

/** 끝난 달의 카드 실적 스냅샷. 달이 지나면 바뀌지 않으므로 월별로 그대로 눌러둔다. */
function readCardPerf(month: string): Map<string, number> {
  try {
    const all = JSON.parse(window.localStorage.getItem(CARD_PERF_CACHE_KEY) || '{}') as Record<string, Record<string, number>>
    return new Map(Object.entries(all[month] ?? {}))
  } catch {
    return new Map()
  }
}

function cacheCardPerf(month: string, perf: { name: string; qualified: number }[]) {
  try {
    const all = JSON.parse(window.localStorage.getItem(CARD_PERF_CACHE_KEY) || '{}') as Record<string, Record<string, number>>
    all[month] = Object.fromEntries(perf.map((c) => [c.name, c.qualified]))
    // 최근 6개월만 남긴다. 그보다 오래된 실적은 아무 화면도 쓰지 않는다.
    const kept = Object.keys(all).sort().slice(-6)
    window.localStorage.setItem(CARD_PERF_CACHE_KEY, JSON.stringify(Object.fromEntries(kept.map((k) => [k, all[k]]))))
  } catch { /* 용량 초과 등은 무시 */ }
}

/** 같은 거래인지 판단하는 키. id 는 원장에서 고치면 바뀌므로 내용으로 본다. */
const contentKey = (t: { date: string; amount: number; memo?: string }) =>
  `${t.date}|${t.amount}|${(t.memo || '').trim()}`

const LEDGER_CACHE_KEY = 'shiba-ledger:v1'

function readLedgerCache(): Transaction[] {
  try {
    const raw = window.localStorage.getItem(LEDGER_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Transaction[]) : []
  } catch {
    return []
  }
}

async function refreshServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.getRegistration().catch(() => undefined)
  await registration?.update().catch(() => undefined)
}

function useLedgerHistory(): [Transaction[], () => void, LedgerLoadStatus] {
  // 캐시된 원장으로 즉시 렌더(stale) → 백그라운드에서 서버 갱신(revalidate)
  const [history, setHistory] = useState<Transaction[]>(() => readLedgerCache())
  const [nonce, setNonce] = useState(0)
  const [status, setStatus] = useState<LedgerLoadStatus>(() => readLedgerCache().length ? 'ready' : 'loading')
  useEffect(() => {
    if (!getSyncConfig()) return
    let cancelled = false
    loadLedger<Transaction>()
      .then((rows) => {
        if (cancelled) return
        // 서버가 빈 원장을 줬는데 캐시에 거래가 있으면 캐시를 믿는다. 지우는 쪽이 훨씬 위험하다.
        if (!rows.length && readLedgerCache().length) { setStatus('error'); return }
        setHistory(rows)
        setStatus('ready')
        try { window.localStorage.setItem(LEDGER_CACHE_KEY, JSON.stringify(rows)) } catch { /* 용량 초과 등은 무시 */ }
      })
      .catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true }
  }, [nonce])
  const refresh = useCallback(() => { setStatus('loading'); setNonce((n) => n + 1) }, [])
  return [history, refresh, status]
}

function usePersistentStore() {
  const [store, setStore] = useState<FinanceStore>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialStore
    try {
      const parsed = JSON.parse(saved) as FinanceStore
      if (typeof parsed.budget !== 'number') {
        parsed.budget = DEFAULT_BUDGET
      }
      return parsed
    } catch {
      return initialStore
    }
  })
  const storeRef = useRef(store)
  useEffect(() => {
    storeRef.current = store
  })
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => getSyncConfig() ? 'syncing' : 'idle')
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
    loadFromServer<FinanceStore>()
      .then((remote) => {
        if (cancelled) return
        const local = { store: storeRef.current, updatedAt: updatedAtRef.current }
        const winner = pickNewer(local, remote)
        if (winner !== local) {
          applyingRemote.current = true
          updatedAtRef.current = winner.updatedAt
          window.localStorage.setItem(UPDATED_AT_KEY, winner.updatedAt)
          // 원격이 이겨도 아직 원장에 못 올린 로컬 입력은 버리지 않는다.
          const ledgerKeys = new Set(readLedgerCache().map(contentKey))
          setStore({
            ...winner.store,
            transactions: keepPending(storeRef.current.transactions ?? [], winner.store.transactions ?? [], ledgerKeys, contentKey),
          })
          setSyncStatus('idle')
        } else if (remote === null) {
          // 서버가 비어 있으면 현재 로컬 데이터를 업로드(기존 입력 보존)
          const stamp = new Date().toISOString()
          updatedAtRef.current = stamp
          window.localStorage.setItem(UPDATED_AT_KEY, stamp)
          void pushNow(storeRef.current, stamp)
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

function buildSummary(store: FinanceStore): Summary {
  const recorded = Array.from(new Set(store.transactions.map((item) => item.date.slice(0, 7)))).sort()
  // '이번 달'은 말 그대로 이번 달이다. 예전엔 데이터가 있는 마지막 달을 썼는데,
  // 달이 바뀐 직후(예: 9월 1일)에 지난달 숫자가 '이번 달 쓴 돈'으로 찍혔다.
  const monthKey = todayIso().slice(0, 7)
  const months = recorded.includes(monthKey) ? recorded : [...recorded, monthKey]
  const monthlyTrend = months.slice(-6).map((month) => buildMonthMetric(store.transactions, month))
  const thisMonth = buildMonthMetric(store.transactions, monthKey)
  const previousMonth = months.length > 1 ? buildMonthMetric(store.transactions, months.at(-2) as string) : undefined
  const categoryTotals = groupTransactions(thisMonthRows(store.transactions, monthKey), 'category')
  // 홈 대표 숫자용: 고정비 제외 + 분담금 차감 → 합이 thisMonth.variable과 정확히 일치
  const variableTotals = groupTransactions(
    thisMonthRows(store.transactions, monthKey).filter((item) => item.fixedType !== 'fixed'), 'category', true)
  const paymentTotals = groupTransactions(thisMonthRows(store.transactions, monthKey), 'payment')
  const assetTotal = store.assets.reduce((sum, item) => sum + item.amount, 0)
  const investmentTotal = store.investments.reduce((sum, item) => sum + item.value, 0)
  const loanTotal = store.loans.filter((item) => item.status === 'active').reduce((sum, item) => sum + item.balance, 0)
  const netWorth = assetTotal + investmentTotal - loanTotal
  const fixedShare = thisMonth.realSpend ? thisMonth.fixed / thisMonth.realSpend : 0
  const investmentShare = assetTotal + investmentTotal ? investmentTotal / (assetTotal + investmentTotal) : 0
  const budget = store.budget ?? 1000000
  const budgetUsageRate = budget ? thisMonth.realSpend / budget : 0

  return {
    monthKey,
    thisMonth,
    previousMonth,
    monthlyTrend,
    categoryTotals,
    variableTotals,
    paymentTotals,
    assetTotal,
    investmentTotal,
    loanTotal,
    netWorth,
    fixedShare,
    investmentShare,
    budget,
    budgetUsageRate,
  }
}

function buildMonthMetric(transactions: Transaction[], month: string): MonthMetric {
  const rows = thisMonthRows(transactions, month)
  // 저축·대출상환은 소비가 아니라 옮기거나 갚는 돈이라 지출 합계에서 뺀다.
  const expenseRows = rows.filter((item) => item.type === 'expense' && !isNonSpend(item))
  const saved = rows.filter(isSaving).reduce((sum, item) => sum + item.amount, 0)
  const loanRepaid = rows.filter(isLoanRepay).reduce((sum, item) => sum + item.amount, 0)
  const totalSpend = expenseRows.reduce((sum, item) => sum + item.amount, 0)
  const split = expenseRows.reduce((sum, item) => sum + item.split, 0)
  const fixed = expenseRows.filter((item) => item.fixedType === 'fixed').reduce((sum, item) => sum + (item.amount - item.split), 0)
  const variable = expenseRows.filter((item) => item.fixedType === 'variable').reduce((sum, item) => sum + (item.amount - item.split), 0)
  const income = rows.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amount, 0)

  return {
    month,
    monthLabel: month.slice(5),
    totalSpend,
    realSpend: totalSpend - split,
    fixed,
    variable,
    income,
    saved,
    loanRepaid,
  }
}

function thisMonthRows(transactions: Transaction[], month: string) {
  return transactions.filter((item) => item.date.startsWith(month))
}

// net=true면 분담금을 뺀 실지출로 합산한다(홈 변동지출 집계용).
function groupTransactions(rows: Transaction[], key: 'category' | 'payment', net = false): NameValue[] {
  const grouped = rows
    .filter((item) => item.type === 'expense')
    .reduce<Record<string, number>>((acc, item) => {
      const name = item[key] || t('unspecified')
      acc[name] = (acc[name] ?? 0) + (net ? item.amount - item.split : item.amount)
      return acc
    }, {})

  return Object.entries(grouped)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
}

function buildInsights(transactions: Transaction[], summary: Summary, store: FinanceStore) {
  const rows = []
  const m = summary.thisMonth
  const monthTx = transactions.filter((t) => t.date.startsWith(summary.monthKey))
  const variableExpense = monthTx.filter((t) => t.type === 'expense' && t.fixedType !== 'fixed')
  const variableSum = variableExpense.reduce((s, t) => s + (t.amount - t.split), 0)

  // 1. 이번 달 수지 (수입 − 실지출)
  const balance = m.income - m.realSpend
  rows.push({
    level: m.income > 0 ? (balance >= 0 ? 'good' : 'danger') : 'good',
    icon: balance >= 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />,
    title: t('insight_balance_title'),
    body: m.income > 0
      ? t(balance >= 0 ? 'insight_balance_body_pos' : 'insight_balance_body_neg', { income: formatMoney(m.income), spend: formatMoney(m.realSpend), net: formatSignedMoney(balance), rate: formatPercent(balance / m.income) })
      : t('insight_balance_body_noincome', { spend: formatMoney(m.realSpend) }),
  })

  // 2. 변동 지출 (내가 조절 가능한 돈)
  const prevVar = summary.previousMonth?.variable
  rows.push({
    level: prevVar != null && variableSum > prevVar * 1.1 ? 'warn' : 'good',
    icon: <Wallet size={18} />,
    title: t('insight_variable_title'),
    body: `${t('insight_variable_body_base', { amt: formatMoney(variableSum) })}${prevVar != null ? t('insight_variable_body_prev', { amt: formatMoney(prevVar) }) : ''}${t('insight_variable_body_tail')}`,
  })

  // 3. 최대 변동 지출 (고정비 제외)
  const maxVar = [...variableExpense].sort((a, b) => (b.amount - b.split) - (a.amount - a.split))[0]
  if (maxVar) {
    const amt = maxVar.amount - maxVar.split
    rows.push({
      level: amt >= 150000 ? 'warn' : 'good',
      icon: <CircleDollarSign size={18} />,
      title: t('insight_max_var_title'),
      body: t('insight_max_var_body', { memo: maxVar.memo, amt: formatMoney(amt), cat: maxVar.category }),
    })
  }

  // 4. 변동 지출 1위 카테고리
  const catMap = new Map<string, number>()
  for (const tx of variableExpense) catMap.set(tx.category, (catMap.get(tx.category) || 0) + (tx.amount - tx.split))
  const topVarCat = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topVarCat) {
    rows.push({
      level: 'good',
      icon: <ReceiptText size={18} />,
      title: t('insight_top_var_cat_title'),
      body: t('insight_top_var_cat_body', { cat: topVarCat[0], amt: formatMoney(topVarCat[1]) }),
    })
  }

  // 5. 고정비 부담 (수입 대비)
  rows.push({
    level: m.income > 0 && m.fixed / m.income > 0.7 ? 'warn' : 'good',
    icon: <ShieldCheck size={18} />,
    title: t('insight_fixed_burden_title'),
    body: m.income > 0
      ? t('insight_fixed_burden_body_income', { amt: formatMoney(m.fixed), pct: formatPercent(m.fixed / m.income) })
      : t('insight_fixed_burden_body_noincome', { amt: formatMoney(m.fixed) }),
  })

  // 6. 투자 현황
  const worstInvestment = [...store.investments].sort((a, b) => a.returnRate - b.returnRate)[0]
  if (worstInvestment) {
    rows.push({
      level: worstInvestment.returnRate < -0.15 ? 'danger' : 'good',
      icon: <LineChart size={18} />,
      title: t('insight_investment_title'),
      body: `${worstInvestment.name} ${formatPercent(worstInvestment.returnRate)}${worstInvestment.returnRate < 0 ? t('insight_investment_body_loss') : t('insight_investment_body_gain')}`,
    })
  }

  // 7. 분담금 - 못 받은 돈(월 무관)과 이번 달 받을·받음. 전체 거래를 넘겨야 지난달 미수가 보인다.
  const sb = splitBreakdown(transactions, summary.monthKey)
  if (sb.total > 0 || sb.open > 0) {
    const who = sb.openBy.map((p) => `${p.name} ${formatMoney(p.value)}`).join(' · ')
    rows.push({
      level: sb.open > 0 ? 'warn' : 'good',
      icon: <Wallet size={18} />,
      title: t('insight_split_title'),
      body: (sb.open > 0
        ? t('insight_split_open', { amt: formatMoney(sb.open), who, total: formatMoney(sb.settle), received: formatMoney(sb.received) })
        : sb.settle > 0 ? t('insight_split_done', { total: formatMoney(sb.settle) }) : t('insight_split_refund_only', { amt: formatMoney(sb.refund) })) +
        (sb.refund > 0 && (sb.open > 0 || sb.settle > 0) ? t('insight_split_refund', { amt: formatMoney(sb.refund) }) : ''),
    })
  }

  // 8. 입력 성실도
  const missingPayment = monthTx.filter((tx) => tx.type === 'expense' && !tx.payment).length
  rows.push({
    level: missingPayment > 0 ? 'warn' : 'good',
    icon: <Sparkles size={18} />,
    title: t('insight_diligence_title'),
    body: missingPayment > 0 ? t('insight_diligence_body_missing', { n: missingPayment }) : t('insight_diligence_body_clean'),
  })

  return rows
}

function parseQuickEntry(raw: string): ParseResult {
  const text = raw.trim()
  if (!text) return { kind: 'error', message: t('err_no_input') }

  if (/^\s*자산\s*[:：]?/.test(text)) return parseAssetEntry(text)
  if (/^\s*(투자|주식)\s*[:：]?/.test(text)) return parseInvestmentEntry(text)
  if (/^\s*대출\s*[:：]?/.test(text)) return parseLoanEntry(text)

  return parseTransactionEntry(text)
}

function parseTransactionEntry(raw: string): ParseResult {
  let text = raw.replace(/\s+/g, ' ').trim()
  const forcedIncome = /^\+/.test(text)   // 맨 앞 '+'면 수입
  text = text.replace(/^\+\s*/, '')
  const date = extractDate(text)
  text = date.remaining

  const amountMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d+)/)
  if (!amountMatch) return { kind: 'error', message: t('err_amount_not_found') }

  const amount = moneyNumber(amountMatch[1])
  text = text.replace(amountMatch[0], '').replace(/\s+/g, ' ').trim()
  const splitParse = splitFromText(text, amount)
  text = splitParse.remaining
  const type: TransactionType = forcedIncome || R.incomeRe.test(raw) ? 'income' : 'expense'
  const paymentParse = extractPayment(text)
  text = paymentParse.remaining
  const fixedParse = extractFixedType(text)
  text = fixedParse.remaining
  const learned = classifyByLearned(text, loadLearnedRules())
  const guessed = learned ? { category: learned.category, sub: learned.subCategory } : classify(text)
  // 수입은 지출용 분류가 오분류(예: '월세'→주거/통신)하므로 대분류를 '수입'으로 강제
  const category = type === 'income'
    ? { category: R.incomeCategory, sub: guessed.category === R.incomeCategory ? guessed.sub : '' }
    : guessed

  return {
    kind: 'transaction',
    transaction: {
      id: uid(),
      date: date.date,
      type,
      amount,
      memo: text || (type === 'income' ? t('filter_income') : t('filter_expense')),
      category: category.category,
      subCategory: category.sub,
      payment: paymentParse.payment,
      fixedType: fixedParse.fixedType ?? (isFixed(text) ? 'fixed' : 'variable'),
      split: type === 'expense' ? splitParse.split : 0,
      raw,
    },
  }
}

function parseAssetEntry(raw: string): ParseResult {
  const body = raw.replace(/^\s*자산\s*[:：]?\s*/, '').replace(/\s+/g, ' ').trim()
  const amountMatch = body.match(/(\d{1,3}(?:,\d{3})+|\d+)/)
  if (!amountMatch) return { kind: 'error', message: t('err_asset_amount_not_found') }

  const before = body.slice(0, amountMatch.index).trim()
  const after = body.slice((amountMatch.index ?? 0) + amountMatch[0].length).trim()
  const kind = before || '현금'
  const institution = after || kind

  return {
    kind: 'asset',
    asset: {
      id: uid(),
      date: todayIso(),
      kind,
      name: kind,
      institution,
      amount: moneyNumber(amountMatch[1]),
      note: raw,
    },
  }
}

function parseInvestmentEntry(raw: string): ParseResult {
  const body = raw.replace(/^\s*(투자|주식)\s*[:：]?\s*/, '')
  const lines = body.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const investments: Investment[] = []
  let account = '일반'

  lines.forEach((line) => {
    const amountMatch = line.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*([+-]?\d+(?:\.\d+)?)?\s*%?/)
    if (!amountMatch) {
      account = line.replace(/[:：]$/, '') || account
      return
    }

    const name = line.slice(0, amountMatch.index).replace(/[:：]$/, '').trim()
    if (!name) return

    investments.push({
      id: uid(),
      date: todayIso(),
      account,
      name,
      value: moneyNumber(amountMatch[1]),
      returnRate: amountMatch[2] ? Number(amountMatch[2]) / 100 : 0,
      note: raw,
    })
  })

  if (!investments.length) return { kind: 'error', message: t('err_investment_not_found') }
  return { kind: 'investment', investments }
}

function parseLoanEntry(raw: string): ParseResult {
  const body = raw.replace(/^\s*대출\s*[:：]?\s*/, '').replace(/\s+/g, ' ').trim()
  const numbers = [...body.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)]
  if (!numbers.length) return { kind: 'error', message: t('err_loan_balance_not_found') }

  const name = body.slice(0, numbers[0].index).trim() || '대출'
  const tail = body.slice((numbers[1]?.index ?? numbers[0].index ?? 0) + (numbers[1]?.[0].length ?? numbers[0][0].length)).trim()

  return {
    kind: 'loan',
    loan: {
      id: uid(),
      date: todayIso(),
      name,
      institution: tail || '미지정',
      balance: moneyNumber(numbers[0][1]),
      monthlyPayment: numbers[1] ? moneyNumber(numbers[1][1]) : 0,
      rate: 0,
      dueDay: '',
      status: 'active',
    },
  }
}

// 정규식 메타문자를 이스케이프해 키워드를 안전하게 정규식에 끼워 넣는다.
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 대소문자 무시하고 keyword가 text에 포함되는지(모바일 자동 대문자화 대응 - F4).
// 한글에는 대소문자 개념이 없어 ko 결과는 바뀌지 않는다.
function includesCI(text: string, keyword: string) {
  return new RegExp(escapeRegExp(keyword), 'i').test(text)
}

// 대소문자 무시하고 첫 매치를 제거.
function removeCI(text: string, keyword: string) {
  return text.replace(new RegExp(escapeRegExp(keyword), 'i'), '')
}

// 공백/문장 경계로 둘러싸인 토큰을 대소문자 무시하고 찾는 정규식(F-minor-a: 고정/변동 수동 태그).
function wordRegexCI(token: string) {
  return new RegExp(`(^|\\s)${escapeRegExp(token)}(\\s|$)`, 'i')
}

function extractDate(text: string) {
  let date = new Date()
  let remaining = text

  if (includesCI(remaining, R.yesterday)) {
    date.setDate(date.getDate() - 1)
    remaining = removeCI(remaining, R.yesterday)
  }
  if (includesCI(remaining, R.today)) remaining = removeCI(remaining, R.today)

  const ymd = remaining.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/)
  const md = remaining.match(/(^|\s)(\d{1,2})[./-](\d{1,2})(\s|$)/)

  if (ymd) {
    date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]))
    remaining = remaining.replace(ymd[0], '')
  } else if (md) {
    date = new Date(date.getFullYear(), Number(md[2]) - 1, Number(md[3]))
    remaining = remaining.replace(md[0], ' ')
  }

  return { date: toIsoDate(date), remaining: remaining.replace(/\s+/g, ' ').trim() }
}

function classify(memo: string) {
  return classifyMemo(memo, R)
}

function extractPayment(memo: string) {
  const paymentPatterns = R.payments
  const match = paymentPatterns.find((item) => includesCI(memo, item))
  if (!match) return { payment: '', remaining: memo }

  return {
    payment: normalizePayment(match),
    remaining: removeCI(memo, match).replace(/\s+/g, ' ').trim(),
  }
}

function normalizePayment(value: string) {
  return R.paymentAlias[value] ?? value
}

function extractFixedType(memo: string) {
  const fixedRe = wordRegexCI(R.fixedToken)
  if (fixedRe.test(memo)) {
    return { fixedType: 'fixed' as FixedType, remaining: memo.replace(fixedRe, ' ').replace(/\s+/g, ' ').trim() }
  }
  const variableRe = wordRegexCI(R.variableToken)
  if (variableRe.test(memo)) {
    return { fixedType: 'variable' as FixedType, remaining: memo.replace(variableRe, ' ').replace(/\s+/g, ' ').trim() }
  }
  return { fixedType: undefined, remaining: memo }
}

function isFixed(memo: string) {
  return R.fixedKeywordsRe.test(memo)
}

function fixedTypeLabel(value: FixedType) {
  return value === 'fixed' ? t('fixed_type_fixed') : t('fixed_type_variable')
}

function upsertByName<T extends { id: string; name: string }>(items: T[], item: T) {
  const next = items.filter((target) => target.name !== item.name)
  return [item, ...next]
}

function upsertAssetList(items: Asset[], item: Asset) {
  return [item, ...items.filter((target) => target.id !== item.id && target.name !== item.name)]
}

function upsertManyInvestments(items: Investment[], nextItems: Investment[]) {
  const keys = new Set(nextItems.map((item) => `${item.account}:${item.name}`))
  return [...nextItems, ...items.filter((item) => !keys.has(`${item.account}:${item.name}`))]
}

// (데모 시드용 tx/asset/investment/loan 헬퍼는 시드를 없애면서 함께 제거)

function resultLabel(result: Exclude<ParseResult, { kind: 'error' }>) {
  if (result.kind === 'transaction') return `${result.transaction.memo} ${formatMoney(result.transaction.amount)}`
  if (result.kind === 'asset') return t('toast_asset_updated', { name: result.asset.name })
  if (result.kind === 'investment') return t('toast_investment_updated', { n: result.investments.length })
  return t('toast_loan_updated', { name: result.loan.name })
}


function uid() {
  return crypto.randomUUID()
}

function todayIso() {
  return toIsoDate(new Date())
}

function toIsoDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function moneyNumber(value: string) {
  return Number(value.replace(/,/g, ''))
}

function formatMoney(value: number) {
  return `${Math.round(value).toLocaleString('ko-KR')}원`
}

function compactMoney(value: number) {
  if (value >= 100000000) return `${Math.round(value / 100000000)}억`
  if (value >= 10000) return `${Math.round(value / 10000)}만`
  return `${Math.round(value)}`
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function formatSignedMoney(value: number) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${formatMoney(Math.abs(value))}`
}

function formatDateLabel(value: string) {
  const [, , month, day] = value.match(/(\d{4})-(\d{2})-(\d{2})/) ?? []
  if (!month || !day) return value
  return t('date_label', { month: Number(month), day: Number(day) })
}

export default App
