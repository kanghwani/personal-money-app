import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
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
  ShieldCheck,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react'
import { pickNewer, dedupById } from './sync/merge'
import { getSyncConfig, loadFromServer, saveToServer, loadLedger, assignCategory, loadFixedDefs, saveFixedDef, deleteFixedDef, deleteLedger, updateLedger, appendLedger } from './sync/syncClient'
import { deriveQuickChips, dailyTotals, changeRate, categoryIcon, topNWithOther, distinctCategoryOptions, fixedRemaining, splitFromText, splitPlaceItem, joinPlaceItem, placeTotals, categoryDeltas, type QuickChip, type FixedDef } from './dashboardLogic'
import { loadLearnedRules, saveLearnedRule, classifyByLearned } from './learnedRules'
import { RULES, LANG, classifyMemo } from './classifyRules'
import { t } from './i18n'
import './App.css'

type Tab = 'dashboard' | 'ledger' | 'assets' | 'insights' | 'fixed'
type TransactionType = 'expense' | 'income'
type FixedType = 'fixed' | 'variable'

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

const R = RULES[LANG]

// 거래 이력이 없을 때 미분류 교정 칩에 보여줄 기본 카테고리 목록(언어별 RuleSet.defaultOptions — F2)
const DEFAULT_FIX_OPTIONS = R.defaultOptions


const seedData: FinanceStore = {
  transactions: [
    tx('2026-06-01', 'expense', 171680, '국민연금', '주거/통신', '세금/공과금', '국민카드', 'fixed'),
    tx('2026-06-01', 'expense', 95000, '주차비', '교통/차량', '차량', '계좌이체', 'fixed'),
    tx('2026-06-02', 'expense', 3300, 'Apple 구독', '문화/구독', '구독', '카드', 'fixed'),
    tx('2026-06-03', 'expense', 18200, '점심 비빔밥', '식비', '외식', '카드', 'variable'),
    tx('2026-06-04', 'expense', 35920, '스팀 게임', '취미', '게임', '카드', 'variable'),
    tx('2026-06-05', 'expense', 5000, '다이소 생활잡화', '생활', '생활잡화', '카드', 'variable'),
    tx('2026-06-06', 'expense', 12500, '카페', '식비', '카페', '카드', 'variable'),
    tx('2026-05-24', 'expense', 28000, '점심 돈까스', '식비', '외식', '카드', 'variable'),
    tx('2026-05-25', 'expense', 7100, '오뎅바', '식비', '외식', '카드', 'variable'),
    tx('2026-05-26', 'income', 3200000, '급여', '수입', '급여', '계좌', 'fixed'),
  ],
  assets: [
    asset('2026-06-07', '현금', '생활비', '토스', 950625),
    asset('2026-06-07', '예금', '비상금', '카카오뱅크', 2500000),
  ],
  investments: [
    investment('2026-06-07', '일반', '크래프톤', '259960', 4562694, 0.0008),
    investment('2026-06-07', '일반', '시프트업', '462870', 1722635, -0.308),
    investment('2026-06-07', 'ISA', '삼성전자', '005930', 21797000, 0.3119),
    investment('2026-06-07', '연금저축', 'TIGER 미국배당 다우존스', '458730', 2230800, 0.0749),
  ],
  loans: [
    loan('2026-06-07', '햇살론', '토스뱅크', 6100000, 225779, 0, '매월 1일'),
    loan('2026-06-07', '자동차 할부', '국민카드', 3500000, 515690, 0, '매월 14일'),
  ],
  budget: 1000000,
}

// 프로필 인스턴스(예: 브리 es)는 데모 시드 없이 빈 상태로 시작한다.
// 빈 백엔드에 처음 접속할 때 seedData(한국어 데모)가 업로드되어 오염되는 것을 막는다.
const emptyStore: FinanceStore = { transactions: [], assets: [], investments: [], loans: [], budget: seedData.budget }
const initialStore: FinanceStore = import.meta.env.VITE_PROFILE ? emptyStore : seedData

function App() {
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
  const [history, refreshHistory] = useLedgerHistory()
  const mergedTransactions = useMemo(
    () =>
      dedupById(history, store.transactions).sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0,
      ),
    [history, store.transactions],
  )
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
    appendLedger(t).catch(() => {})
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
          <p className="eyebrow">{formatDateLabel(todayIso())}</p>
          <h1>{t('app_title')}</h1>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={syncNow}
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
          <Dashboard summary={summary} transactions={mergedTransactions} categoryOptions={categoryOptions} onAssign={assignCategoryFor} onEdit={editTransaction} />
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

const RING_COLORS = ['#c9794f', '#7e9b6f', '#d6a85e', '#9a7bb0', '#5a7d8f', '#cdbf9c', '#b8654a', '#6f8f9c', '#caa06a', '#a98aa0']

function CategoryRing({ total, subtitle, data }: { total: string; subtitle: string | null; data: NameValue[] }) {
  const sum = data.reduce((s, d) => s + d.value, 0) || 1
  let acc = 0
  const stops = data
    .map((d, i) => {
      const start = (acc / sum) * 100
      acc += d.value
      const end = (acc / sum) * 100
      return `${RING_COLORS[i % RING_COLORS.length]} ${start}% ${end}%`
    })
    .join(', ')
  return (
    <div className="cat-ring">
      <div className="cat-donut" style={{ background: `conic-gradient(${stops})` }} />
      <div className="cat-ring-center">
        <span className="cr-k">{t('this_month_real_spend')}</span>
        <strong>{total}</strong>
        {subtitle && <span className="cr-s">{subtitle}</span>}
      </div>
    </div>
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
                    <span className="row-place">🏪 {splitPlaceItem(tx.memo).place || t('not_entered')}</span>
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

function Dashboard({ summary, transactions, categoryOptions, onAssign, onEdit }: {
  summary: Summary
  transactions: Transaction[]
  categoryOptions: { category: string; subCategory: string }[]
  onAssign: (id: string, category: string, subCategory: string, memo: string) => void
  onEdit: (updated: Transaction) => void
}) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const prev = summary.previousMonth?.realSpend ?? 0
  const rate = changeRate(summary.thisMonth.realSpend, prev)
  const ringSubtitle = rate === null ? null : t('vs_prev_month', { sign: rate >= 0 ? '+' : '−', pct: Math.abs(Math.round(rate * 100)) })

  return (
    <section className="view-stack">
      <article className="ring-card">
        <CategoryRing
          total={formatMoney(summary.thisMonth.realSpend)}
          subtitle={ringSubtitle}
          data={topNWithOther(summary.categoryTotals, 7, t('sub_other'))}
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
  const filtered = transactions.filter((item) => filter === 'all' || item.type === filter)
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
                    <span className="row-place">🏪 {splitPlaceItem(transaction.memo).place || t('not_entered')}</span>
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

function InsightsView({ store, summary, transactions }: { store: FinanceStore; summary: Summary; transactions: Transaction[] }) {
  const insightRows = buildInsights(transactions, summary, store)
  const colors = ['#c9794f', '#7e9b6f', '#d6a85e', '#9a7bb0', '#5a7d8f', '#cdbf9c']
  const places = placeTotals(transactions, summary.monthKey, 7)
  const deltas = categoryDeltas(transactions, summary.monthKey, summary.previousMonth?.month).slice(0, 5)
  const maxDelta = Math.max(1, ...deltas.map((d) => Math.abs(d.delta)))

  return (
    <section className="view-stack">
      <section className="wide-section">
        <SectionHeader icon={<ChartNoAxesCombined size={18} />} title={t('sec_month_flow')} aside={summary.monthlyTrend.at(-1)?.month ?? ''} />
        <div className="chart-frame">
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={summary.monthlyTrend} margin={{ left: 0, right: 12, top: 14, bottom: 0 }}>
              <defs>
                <linearGradient id="spendFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-tan)" stopOpacity={0.24} />
                  <stop offset="95%" stopColor="var(--accent-tan)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis tickLine={false} axisLine={false} tickFormatter={compactMoney} width={50} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--surface-solid)', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }}
                formatter={(value) => [formatMoney(Number(value)), t('real_spend')]}
                labelFormatter={(label) => `${label}`}
              />
              <Area type="monotone" dataKey="realSpend" stroke="var(--accent-tan)" strokeWidth={3} fill="url(#spendFill)" />
            </AreaChart>
          </ResponsiveContainer>
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
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={summary.categoryTotals.slice(0, 7)} layout="vertical" margin={{ left: 0, right: 20, top: 12, bottom: 8 }}>
              <CartesianGrid stroke="var(--line)" horizontal={false} />
              <XAxis type="number" tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={76} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'var(--surface-solid)', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }}
                itemStyle={{ color: 'var(--ink)' }}
                labelStyle={{ color: 'var(--accent-tan)', fontWeight: 800 }}
                formatter={(value) => [formatMoney(Number(value)), t('spend_amount')]}
              />
              <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                {summary.categoryTotals.slice(0, 7).map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {places.length > 0 && (
        <section className="wide-section">
          <SectionHeader icon={<CircleDollarSign size={18} />} title={t('sec_place_top')} aside={summary.monthKey} />
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={places} layout="vertical" margin={{ left: 0, right: 20, top: 12, bottom: 8 }}>
                <CartesianGrid stroke="var(--line)" horizontal={false} />
                <XAxis type="number" tickFormatter={compactMoney} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={76} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: 'var(--surface-solid)', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }}
                  itemStyle={{ color: 'var(--ink)' }}
                  labelStyle={{ color: 'var(--accent-tan)', fontWeight: 800 }}
                  formatter={(value) => [formatMoney(Number(value)), t('spend_amount')]}
                />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {places.map((entry, index) => (
                    <Cell key={entry.name} fill={colors[index % colors.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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

function FixedView({ monthKey }: { monthKey: string }) {
  // 캐시된 값으로 즉시 렌더(stale) → 백그라운드에서 서버 갱신(revalidate)
  const [defs, setDefs] = useState<FixedDef[]>(() => readFixedDefsCache())
  const [editing, setEditing] = useState<FixedDef | null>(null)
  const [busy, setBusy] = useState(false)
  // 캐시가 없을 때(첫 방문)만 로딩 표시
  const [loading, setLoading] = useState(() => readFixedDefsCache().length === 0)

  const [view, setView] = useState<'expense' | 'income'>('expense')

  const applyDefs = (next: FixedDef[]) => {
    setDefs(next)
    try { window.localStorage.setItem(FIXED_DEFS_CACHE_KEY, JSON.stringify(next)) } catch { /* 용량 초과 등은 무시 */ }
  }
  const reload = () => {
    loadFixedDefs()
      .then(applyDefs)
      .catch(() => { /* 오프라인이면 캐시 유지 */ })
      .finally(() => setLoading(false))
  }
  useEffect(() => { reload() }, [])

  const shown = defs.filter((d) => (d.kind || 'expense') === view)
  const activeTotal = shown.filter((d) => d.active).reduce((s, d) => s + d.amount, 0)

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
        {shown.map((d) => {
          const rem = fixedRemaining(d, monthKey)
          return (
            <article className={`fixed-row${d.active ? '' : ' off'}`} key={d.id}>
              <button type="button" className="fixed-main" onClick={() => setEditing(d)}>
                <div>
                  <p className="row-title">{d.name}{d.variable && <span className="fixed-badge">{t('fixed_type_variable')}</span>}</p>
                  <p className="row-meta">
                    {formatMoney(d.amount)} · {t('monthly_day', { day: d.payDay })}
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
        })}
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
}

type Summary = {
  monthKey: string
  thisMonth: MonthMetric
  previousMonth?: MonthMetric
  monthlyTrend: MonthMetric[]
  categoryTotals: NameValue[]
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

const LEDGER_CACHE_KEY = 'shiba-ledger:v1'

function readLedgerCache(): Transaction[] {
  try {
    const raw = window.localStorage.getItem(LEDGER_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Transaction[]) : []
  } catch {
    return []
  }
}

function useLedgerHistory(): [Transaction[], () => void] {
  // 캐시된 원장으로 즉시 렌더(stale) → 백그라운드에서 서버 갱신(revalidate)
  const [history, setHistory] = useState<Transaction[]>(() => readLedgerCache())
  const [nonce, setNonce] = useState(0)
  useEffect(() => {
    if (!getSyncConfig()) return
    let cancelled = false
    loadLedger<Transaction>()
      .then((rows) => {
        if (cancelled) return
        setHistory(rows)
        try { window.localStorage.setItem(LEDGER_CACHE_KEY, JSON.stringify(rows)) } catch { /* 용량 초과 등은 무시 */ }
      })
      .catch(() => { /* 오프라인이면 캐시 유지 */ })
    return () => { cancelled = true }
  }, [nonce])
  return [history, () => setNonce((n) => n + 1)]
}

function usePersistentStore() {
  const [store, setStore] = useState<FinanceStore>(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (!saved) return initialStore
    try {
      const parsed = JSON.parse(saved) as FinanceStore
      if (typeof parsed.budget !== 'number') {
        parsed.budget = seedData.budget
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
        const local = { store: storeRef.current, updatedAt: updatedAtRef.current }
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

function buildSummary(store: FinanceStore): Summary {
  const months = Array.from(new Set(store.transactions.map((item) => item.date.slice(0, 7)))).sort()
  const monthKey = months.at(-1) ?? todayIso().slice(0, 7)
  const monthlyTrend = months.slice(-6).map((month) => buildMonthMetric(store.transactions, month))
  const thisMonth = buildMonthMetric(store.transactions, monthKey)
  const previousMonth = months.length > 1 ? buildMonthMetric(store.transactions, months.at(-2) as string) : undefined
  const categoryTotals = groupTransactions(thisMonthRows(store.transactions, monthKey), 'category')
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
  const expenseRows = rows.filter((item) => item.type === 'expense')
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
  }
}

function thisMonthRows(transactions: Transaction[], month: string) {
  return transactions.filter((item) => item.date.startsWith(month))
}

function groupTransactions(rows: Transaction[], key: 'category' | 'payment'): NameValue[] {
  const grouped = rows
    .filter((item) => item.type === 'expense')
    .reduce<Record<string, number>>((acc, item) => {
      const name = item[key] || t('unspecified')
      acc[name] = (acc[name] ?? 0) + item.amount
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

  // 7. 입력 성실도
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

// 대소문자 무시하고 keyword가 text에 포함되는지(모바일 자동 대문자화 대응 — F4).
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

function tx(date: string, type: TransactionType, amount: number, memo: string, category: string, subCategory: string, payment: string, fixedType: FixedType): Transaction {
  return { id: uid(), date, type, amount, memo, category, subCategory, payment, fixedType, split: 0, raw: memo }
}

function asset(date: string, kind: string, name: string, institution: string, amount: number): Asset {
  return { id: uid(), date, kind, name, institution, amount, note: '' }
}

function investment(date: string, account: string, name: string, ticker: string, value: number, returnRate: number): Investment {
  return { id: uid(), date, account, name, ticker, value, returnRate, note: '' }
}

function loan(date: string, name: string, institution: string, balance: number, monthlyPayment: number, rate: number, dueDay: string): Loan {
  return { id: uid(), date, name, institution, balance, monthlyPayment, rate, dueDay, status: 'active' }
}

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
