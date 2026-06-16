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
import { deriveQuickChips, dailyTotals, changeRate, categoryIcon, topNWithOther, distinctCategoryOptions, fixedRemaining, splitFromText, type QuickChip, type FixedDef } from './dashboardLogic'
import { loadLearnedRules, saveLearnedRule, classifyByLearned } from './learnedRules'
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

const categoryRules = [
  { words: ['점심', '저녁', '밥', '식당', '라멘', '피자', '버거', '김밥'], category: '식비', sub: '외식' },
  { words: ['커피', '카페', '아메리카노', '라떼'], category: '식비', sub: '카페' },
  { words: ['마트', '장보기', '식자재', '쿠팡', '컬리'], category: '식비', sub: '장보기' },
  { words: ['월세', '관리비', '전기', '가스', '인터넷', '통신'], category: '주거/통신', sub: '고정비' },
  { words: ['주차', '택시', '버스', '지하철', '자동차', '기름'], category: '교통/차량', sub: '이동' },
  { words: ['병원', '약', '수영', '헬스', '운동'], category: '건강', sub: '관리' },
  { words: ['넷플릭스', '구독', '애플', '네이버', '스포티파이'], category: '문화/구독', sub: '구독' },
  { words: ['게임', '스팀', '플레이', '취미'], category: '취미', sub: '게임' },
  { words: ['책', '강의', '학원', '공부'], category: '자기계발', sub: '교육' },
  { words: ['월급', '급여', '입금', '보너스'], category: '수입', sub: '급여' },
]

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

function App() {
  const [store, setStore, syncStatus, syncNow] = usePersistentStore()
  const [activeTab, setActiveTab] = useState<Tab>('dashboard')
  const [lastMessage, setLastMessage] = useState('준비됨')
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
    setLastMessage('분류 반영 중…')
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
    if (ok || isLocal) { setLastMessage('분류 반영됨'); refreshHistory() }
    else setLastMessage('분류 실패')
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
    if (parsed.kind === 'transaction' && parsed.transaction.type === 'expense' && parsed.transaction.category === '미분류') {
      setPendingUncat(parsed.transaction)
    } else {
      setPendingUncat(null)
    }
  }

  function logQuickChipForDate(chip: QuickChip, date: string) {
    const t: Transaction = {
      id: uid(), date, type: 'expense', amount: chip.amount,
      memo: chip.label, category: chip.category, subCategory: chip.subCategory,
      payment: chip.payment, fixedType: chip.fixedType, split: 0, raw: `${chip.label} ${chip.amount}`,
    }
    recordTransaction(t)
    setUndoTx(t)
    setLastMessage(`${chip.label} ${formatMoney(chip.amount)} 기록`)
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
    setLastMessage(`${category}${subCategory ? '·' + subCategory : ''}로 분류됨 · 다음부터 자동`)
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
    setLastMessage(`${assetItem.name} 자산 저장`)
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
          <h1>돈 정리</h1>
        </div>
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
        <button className="icon-button" type="button" onClick={exportData} aria-label="내보내기">
          <Download size={19} />
        </button>
      </header>

      {showPwaBanner && (
        <section className="pwa-install-banner">
          <div className="pwa-install-content">
            <img src="/apple-touch-icon.png" alt="돈 정리" className="pwa-install-icon" />
            <div className="pwa-install-text">
              <h4>홈 화면에 '돈 정리' 추가하기</h4>
              <p>하단 <strong>공유 버튼</strong>을 누른 후, <strong>'홈 화면에 추가'</strong>를 탭하면 완전한 앱으로 사용할 수 있습니다.</p>
            </div>
          </div>
          <button className="pwa-install-close" onClick={dismissPwaBanner} aria-label="닫기">
            <X size={18} />
          </button>
        </section>
      )}

      <nav className="tab-bar" aria-label="화면">
        <TabButton tab="dashboard" activeTab={activeTab} icon={<Home size={18} />} label="홈" onClick={setActiveTab} />
        <TabButton tab="ledger" activeTab={activeTab} icon={<ReceiptText size={18} />} label="원장" onClick={setActiveTab} />
        <TabButton tab="assets" activeTab={activeTab} icon={<Wallet size={18} />} label="자산" onClick={setActiveTab} />
        <TabButton tab="insights" activeTab={activeTab} icon={<Sparkles size={18} />} label="인사이트" onClick={setActiveTab} />
        <TabButton tab="fixed" activeTab={activeTab} icon={<CalendarClock size={18} />} label="고정비" onClick={setActiveTab} />
      </nav>

      {activeTab === 'dashboard' && (
        <>
          <div className="home-input">
            {undoTx && (
              <div className="undo-toast">
                <span>{undoTx.memo} {formatMoney(undoTx.amount)} 기록됨</span>
                <button type="button" onClick={undoLastChip}>되돌리기</button>
              </div>
            )}
            <QuickEntry onSubmit={applyQuickInput} lastMessage={lastMessage} />
            {pendingUncat && (
              <div className="fix-uncat">
                <p className="fix-uncat-label">미분류 — 카테고리를 골라주세요</p>
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
        <button className="quick-leading" type="button" aria-label="빠른입력">
          <Plus size={20} />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit()
          }}
          placeholder="오늘 5000 점심밥"
        />
        <button className="send-button" type="button" onClick={submit} aria-label="입력">
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
        <span className="cr-k">이번 달 실지출</span>
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
  const total = transactions.reduce((s, t) => s + t.amount, 0)
  const subMap = new Map<string, number>()
  for (const t of transactions) {
    const k = t.subCategory || '기타'
    subMap.set(k, (subMap.get(k) || 0) + t.amount)
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
            <p>{formatMoney(total)} · {transactions.length}건</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        {subs.length > 0 && (
          <div className="cat-sub-list">
            {subs.map((s) => (
              <div className="cat-sub-row" key={s.name}><span>{s.name}</span><span>{formatMoney(s.value)}</span></div>
            ))}
          </div>
        )}
        <div className="cat-tx-list">
          {rows.length === 0 && <p className="cat-empty">거래가 없습니다.</p>}
          {rows.map((t) => (
            <div className="cat-tx-row" key={t.id}>
              <div className="cat-tx-main">
                <button type="button" className="cat-tx-edit" onClick={() => setEditingTx(t)}>
                  <p className="row-title">{t.memo}</p>
                  <p className="row-meta">{formatDateLabel(t.date)} · {t.subCategory || '미지정'} · {t.payment || '미지정'}</p>
                </button>
                <div className="cat-tx-right">
                  <span className="cat-tx-amt">{formatMoney(t.amount)}</span>
                  <button type="button" className="reassign-btn" onClick={() => setPickingId(pickingId === t.id ? null : t.id)}>분류</button>
                </div>
              </div>
              {pickingId === t.id && (
                <div className="reassign-picker">
                  {categoryOptions.map((o) => (
                    <button
                      key={o.category + '/' + o.subCategory}
                      type="button"
                      className="reassign-opt"
                      onClick={() => { onAssign(t.id, o.category, o.subCategory, t.memo); setPickingId(null) }}
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
  const ringSubtitle = rate === null ? null : `전월 대비 ${rate >= 0 ? '+' : '−'}${Math.abs(Math.round(rate * 100))}%`

  return (
    <section className="view-stack">
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

      <section className="wide-section">
        <SectionHeader icon={<ShieldCheck size={18} />} title="고정비 / 변동비" aside={formatPercent(summary.fixedShare)} />
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
        <button type="button" className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>목록</button>
        <button type="button" className={view === 'calendar' ? 'active' : ''} onClick={() => setView('calendar')}>달력</button>
      </div>

      {view === 'list' && (
        <>
          <div className="segmented">
            <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>전체</button>
            <button type="button" className={filter === 'expense' ? 'active' : ''} onClick={() => setFilter('expense')}>지출</button>
            <button type="button" className={filter === 'income' ? 'active' : ''} onClick={() => setFilter('income')}>수입</button>
          </div>
          <section className="ledger-table">
            {filtered.map((transaction) => (
              <article className="ledger-row" key={transaction.id}>
                <button type="button" className="ledger-row-main" onClick={() => setEditingTx(transaction)}>
                  <p className="row-title">{transaction.memo}</p>
                  <p className="row-meta">
                    {formatDateLabel(transaction.date)} · {transaction.category} · {transaction.payment || '미지정'} · {fixedTypeLabel(transaction.fixedType)}
                  </p>
                </button>
                <div className="row-actions">
                  <strong className={transaction.type === 'income' ? 'income' : ''}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}</strong>
                  <button type="button" className="edit-btn" aria-label="수정" onClick={() => setEditingTx(transaction)}>
                    <Pencil size={15} />
                  </button>
                  <button type="button" aria-label="삭제" onClick={() => onDelete(transaction.id)}>
                    <Trash2 size={17} />
                  </button>
                </div>
              </article>
            ))}
          </section>

          {editingTx && (
            <TransactionEditSheet
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
        <button type="button" onClick={onPrev} aria-label="이전 달">‹</button>
        <span>{year}.{month}</span>
        <button type="button" onClick={onNext} aria-label="다음 달">›</button>
      </div>
      <div className="cal-weekdays">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => <span key={w}>{w}</span>)}
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
            <p>{formatMoney(total)} · {transactions.length}건</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
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
              placeholder="점심 9000 카드"
            />
            <button type="button" className="send-button" onClick={submit} aria-label="입력"><Send size={18} /></button>
          </div>
        </div>
        <div className="cat-tx-list">
          {transactions.length === 0 && <p className="cat-empty">거래가 없습니다. 위에서 추가하세요.</p>}
          {transactions.map((t) => (
            <div className="cat-tx-row" key={t.id}>
              <div>
                <p className="row-title">{t.memo}</p>
                <p className="row-meta">{t.category} · {t.subCategory || '미지정'} · {t.payment || '미지정'}</p>
              </div>
              <span className="cat-tx-amt">{formatMoney(t.amount)}</span>
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
          <p className="eyebrow">순자산</p>
          <h2>{formatMoney(summary.netWorth)}</h2>
        </div>
        <div className="balance-pair">
          <span>자산 {formatMoney(summary.assetTotal + summary.investmentTotal)}</span>
          <span>부채 {formatMoney(summary.loanTotal)}</span>
        </div>
      </div>

      <AssetEditor key={editingAsset?.id ?? 'new'} asset={editingAsset} onSave={onSaveAsset} onDone={() => setEditingAsset(null)} />

      <section className="split-layout">
        <AssetColumn title="자산" icon={<Wallet size={18} />}>
          {store.assets.map((item) => (
            <ValueRow
              key={item.id}
              title={item.name}
              meta={`${item.kind} · ${item.institution}`}
              value={item.amount}
              actionLabel="수정"
              onAction={() => setEditingAsset(item)}
            />
          ))}
        </AssetColumn>

        <AssetColumn title="투자" icon={<TrendingUp size={18} />}>
          {store.investments.map((item) => (
            <ValueRow key={item.id} title={item.name} meta={item.account} value={item.value} badge={formatPercent(item.returnRate)} negative={item.returnRate < 0} />
          ))}
        </AssetColumn>
      </section>

      <section className="wide-section">
        <SectionHeader icon={<Landmark size={18} />} title="대출" aside={formatMoney(summary.loanTotal)} />
        <div className="recent-list">
          {store.loans.map((loanItem) => (
            <ValueRow
              key={loanItem.id}
              title={loanItem.name}
              meta={`${loanItem.institution} · ${loanItem.dueDay}`}
              value={loanItem.balance}
              badge={`월 ${formatMoney(loanItem.monthlyPayment)}`}
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

  return (
    <section className="view-stack">
      <section className="wide-section">
        <SectionHeader icon={<ChartNoAxesCombined size={18} />} title="월별 흐름" aside={summary.monthlyTrend.at(-1)?.month ?? ''} />
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
                formatter={(value) => [formatMoney(Number(value)), '실지출']}
                labelFormatter={(label) => `${label}`}
              />
              <Area type="monotone" dataKey="realSpend" stroke="var(--accent-tan)" strokeWidth={3} fill="url(#spendFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
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
        <SectionHeader icon={<CircleDollarSign size={18} />} title="지출 비중" aside={summary.monthKey} />
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
                formatter={(value) => [formatMoney(Number(value)), '지출액']} 
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
        <button type="button" className={view === 'expense' ? 'active' : ''} onClick={() => setView('expense')}>지출</button>
        <button type="button" className={view === 'income' ? 'active' : ''} onClick={() => setView('income')}>수입</button>
      </div>
      <div className="fixed-head">
        <div>
          <p className="eyebrow">{view === 'income' ? '월 정기수입' : '월 고정비'}</p>
          <h2>{formatMoney(activeTotal)}</h2>
        </div>
        <button type="button" className="fixed-add" onClick={() => setEditing(emptyFixedDef(monthKey, view))}>+ 추가</button>
      </div>

      <div className="fixed-list">
        {shown.map((d) => {
          const rem = fixedRemaining(d, monthKey)
          return (
            <article className={`fixed-row${d.active ? '' : ' off'}`} key={d.id}>
              <button type="button" className="fixed-main" onClick={() => setEditing(d)}>
                <div>
                  <p className="row-title">{d.name}{d.variable && <span className="fixed-badge">변동</span>}</p>
                  <p className="row-meta">
                    {formatMoney(d.amount)} · 매월 {d.payDay}일
                    {d.split > 0 && ` · 분담 ${formatMoney(d.split)} · 실지출 ${formatMoney(d.amount - d.split)}`}
                    {d.variable && ' · 확인필요'}
                    {rem && (rem.done ? ' · 완료' : ` · ${rem.count}/${rem.total}회 · ${d.kind === 'income' ? '받을' : '남은'} ${formatMoney(rem.remainingAmount)}`)}
                  </p>
                </div>
              </button>
              <button type="button" className={`fixed-toggle${d.active ? ' on' : ''}`} onClick={() => toggle(d)} aria-label="활성 토글">
                {d.active ? 'ON' : 'OFF'}
              </button>
            </article>
          )
        })}
        {shown.length === 0 && (
          <p className="cat-empty">
            {loading ? '불러오는 중…' : `${view === 'income' ? '정기수입이' : '고정비가'} 없습니다. + 추가로 등록하세요.`}
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
          <div className="cat-sheet-title"><h3>{(def.kind === 'income' ? '정기수입 ' : '고정비 ') + (def.id ? '수정' : '추가')}</h3></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="fixed-form">
          <label>이름<input value={draft.name} onChange={(e) => set({ name: e.target.value })} /></label>
          <label>금액<input type="number" value={draft.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} /></label>
          <label>대분류<input value={draft.category} onChange={(e) => set({ category: e.target.value })} /></label>
          <label>소분류<input value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} /></label>
          <label>{draft.kind === 'income' ? '입금수단' : '결제수단'}<input value={draft.payment} onChange={(e) => set({ payment: e.target.value })} /></label>
          {draft.kind !== 'income' && (
            <label>분담금(여친 부담분 등, 없으면 0)<input type="number" value={draft.split || ''} onChange={(e) => set({ split: Number(e.target.value) || 0 })} /></label>
          )}
          <label>납부일<input type="number" min={1} max={31} value={draft.payDay || ''} onChange={(e) => set({ payDay: Number(e.target.value) || 1 })} /></label>
          <label>시작월(yyyy-MM)<input value={draft.startMonth} onChange={(e) => set({ startMonth: e.target.value })} /></label>
          <label>할부 총회차(없으면 비움)<input type="number" value={draft.installmentTotal ?? ''} onChange={(e) => set({ installmentTotal: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          <label className="fixed-check">
            <input type="checkbox" checked={draft.variable} onChange={(e) => set({ variable: e.target.checked })} />
            <span>변동 항목 (금액이 매달 바뀜 — 자동입력 시 ‘확인필요’ 표시)</span>
          </label>
        </div>
        <div className="fixed-actions">
          {def.id && <button type="button" className="fixed-del" disabled={busy} onClick={() => onDelete(def.id)}>삭제</button>}
          <button type="button" className="fixed-save" disabled={busy || !draft.name} onClick={() => onSave(draft)}>{busy ? '저장 중…' : '저장'}</button>
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
          <div className="cat-sheet-title"><h3>거래 수정</h3></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="fixed-form">
          <label>내역<input value={draft.memo} onChange={(e) => set({ memo: e.target.value })} /></label>
          <label>금액<input type="number" value={draft.amount || ''} onChange={(e) => set({ amount: Number(e.target.value) || 0 })} /></label>
          <label>날짜<input type="date" value={draft.date} onChange={(e) => set({ date: e.target.value })} /></label>
          <label>구분
            <select value={draft.type} onChange={(e) => set({ type: e.target.value as TransactionType })}>
              <option value="expense">지출</option>
              <option value="income">수입</option>
            </select>
          </label>
          <label>대분류
            <input list="edit-cat-list" value={draft.category} onChange={(e) => set({ category: e.target.value })} placeholder="선택 또는 직접 입력" />
            <datalist id="edit-cat-list">{categoryList.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <label>소분류
            <input list="edit-sub-list" value={draft.subCategory} onChange={(e) => set({ subCategory: e.target.value })} placeholder="선택 또는 직접 입력" />
            <datalist id="edit-sub-list">{subCategoryList.map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <label>결제수단<input value={draft.payment} onChange={(e) => set({ payment: e.target.value })} /></label>
          <label>고정/변동
            <select value={draft.fixedType} onChange={(e) => set({ fixedType: e.target.value as FixedType })}>
              <option value="variable">변동</option>
              <option value="fixed">고정</option>
            </select>
          </label>
          <label>분담금<input type="number" value={draft.split || ''} onChange={(e) => set({ split: Number(e.target.value) || 0 })} /></label>
        </div>
        <div className="fixed-actions">
          <button type="button" className="fixed-save" onClick={() => onSave(draft)}>저장</button>
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
      <div className="fixed-track" aria-label="고정비 변동비 비중">
        <span className="fixed-part" style={{ width: `${fixedWidth}%` }} />
        <span className="variable-part" style={{ width: `${variableWidth}%` }} />
      </div>
      <div className="fixed-grid">
        <div>
          <p>고정비</p>
          <strong>{formatMoney(summary.thisMonth.fixed)}</strong>
          <span>{formatPercent(summary.fixedShare)}</span>
        </div>
        <div>
          <p>변동비</p>
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
      <SectionHeader icon={asset ? <Pencil size={18} /> : <Plus size={18} />} title={asset ? '자산 수정' : '자산 추가'} aside={asset ? asset.name : '직접 입력'} />
      <div className="asset-form">
        <input value={draft.kind} onChange={(event) => update('kind', event.target.value)} placeholder="구분" />
        <input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="이름" />
        <input value={draft.institution} onChange={(event) => update('institution', event.target.value)} placeholder="기관" />
        <input value={draft.amount} onChange={(event) => update('amount', event.target.value.replace(/[^\d,]/g, ''))} inputMode="numeric" placeholder="금액" />
        <button type="button" onClick={submit}>
          <Save size={17} />
          저장
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
      const name = item[key] || '미지정'
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
    title: '이번 달 수지',
    body: m.income > 0
      ? `수입 ${formatMoney(m.income)} − 지출 ${formatMoney(m.realSpend)} = ${formatSignedMoney(balance)}${balance >= 0 ? ` · 저축률 ${formatPercent(balance / m.income)}` : ' · 적자예요'}`
      : `이번 달 실지출 ${formatMoney(m.realSpend)}. 수입을 등록하면 저축률도 보여드려요.`,
  })

  // 2. 변동 지출 (내가 조절 가능한 돈)
  const prevVar = summary.previousMonth?.variable
  rows.push({
    level: prevVar != null && variableSum > prevVar * 1.1 ? 'warn' : 'good',
    icon: <Wallet size={18} />,
    title: '쓸 수 있는 돈 (변동 지출)',
    body: `고정비 빼고 ${formatMoney(variableSum)} 썼어요.${prevVar != null ? ` 전월 변동은 ${formatMoney(prevVar)}.` : ''} 여기가 줄일 수 있는 부분이에요.`,
  })

  // 3. 최대 변동 지출 (고정비 제외)
  const maxVar = [...variableExpense].sort((a, b) => (b.amount - b.split) - (a.amount - a.split))[0]
  if (maxVar) {
    const amt = maxVar.amount - maxVar.split
    rows.push({
      level: amt >= 150000 ? 'warn' : 'good',
      icon: <CircleDollarSign size={18} />,
      title: '이번 달 최대 변동 지출',
      body: `${maxVar.memo} · ${formatMoney(amt)} (${maxVar.category}). 고정비 빼고 가장 큰 한 건이에요.`,
    })
  }

  // 4. 변동 지출 1위 카테고리
  const catMap = new Map<string, number>()
  for (const t of variableExpense) catMap.set(t.category, (catMap.get(t.category) || 0) + (t.amount - t.split))
  const topVarCat = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0]
  if (topVarCat) {
    rows.push({
      level: 'good',
      icon: <ReceiptText size={18} />,
      title: '변동 지출 1위',
      body: `${topVarCat[0]} ${formatMoney(topVarCat[1])} — 변동 지출 중 가장 컸어요. 줄일 여지가 있는지 살펴보세요.`,
    })
  }

  // 5. 고정비 부담 (수입 대비)
  rows.push({
    level: m.income > 0 && m.fixed / m.income > 0.7 ? 'warn' : 'good',
    icon: <ShieldCheck size={18} />,
    title: '고정비 부담',
    body: m.income > 0
      ? `고정비 ${formatMoney(m.fixed)} · 수입의 ${formatPercent(m.fixed / m.income)}를 차지해요.`
      : `이번 달 고정비는 ${formatMoney(m.fixed)}예요.`,
  })

  // 6. 투자 현황
  const worstInvestment = [...store.investments].sort((a, b) => a.returnRate - b.returnRate)[0]
  if (worstInvestment) {
    rows.push({
      level: worstInvestment.returnRate < -0.15 ? 'danger' : 'good',
      icon: <LineChart size={18} />,
      title: '투자 현황',
      body: `${worstInvestment.name} ${formatPercent(worstInvestment.returnRate)}${worstInvestment.returnRate < 0 ? ' — 손실 구간이에요.' : ' — 수익 중이에요.'}`,
    })
  }

  // 7. 입력 성실도
  const missingPayment = monthTx.filter((t) => t.type === 'expense' && !t.payment).length
  rows.push({
    level: missingPayment > 0 ? 'warn' : 'good',
    icon: <Sparkles size={18} />,
    title: '입력 성실도',
    body: missingPayment > 0 ? `이번 달 결제수단 미입력 ${missingPayment}건. 채워두면 더 정확해져요.` : '이번 달 기록 깔끔해요 👍',
  })

  return rows
}

function parseQuickEntry(raw: string): ParseResult {
  const text = raw.trim()
  if (!text) return { kind: 'error', message: '입력값 없음' }

  if (/^\s*자산\s*[:：]?/.test(text)) return parseAssetEntry(text)
  if (/^\s*(투자|주식)\s*[:：]?/.test(text)) return parseInvestmentEntry(text)
  if (/^\s*대출\s*[:：]?/.test(text)) return parseLoanEntry(text)

  return parseTransactionEntry(text)
}

function parseTransactionEntry(raw: string): ParseResult {
  let text = raw.replace(/\s+/g, ' ').trim()
  const date = extractDate(text)
  text = date.remaining

  const amountMatch = text.match(/(\d{1,3}(?:,\d{3})+|\d+)/)
  if (!amountMatch) return { kind: 'error', message: '금액을 찾지 못함' }

  const amount = moneyNumber(amountMatch[1])
  text = text.replace(amountMatch[0], '').replace(/\s+/g, ' ').trim()
  const splitParse = splitFromText(text, amount)
  text = splitParse.remaining
  const type: TransactionType = /수입|월급|급여|입금|보너스/.test(raw) ? 'income' : 'expense'
  const paymentParse = extractPayment(text)
  text = paymentParse.remaining
  const fixedParse = extractFixedType(text)
  text = fixedParse.remaining
  const learned = classifyByLearned(text, loadLearnedRules())
  const category = learned ? { category: learned.category, sub: learned.subCategory } : classify(text)

  return {
    kind: 'transaction',
    transaction: {
      id: uid(),
      date: date.date,
      type,
      amount,
      memo: text || (type === 'income' ? '수입' : '지출'),
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
  if (!amountMatch) return { kind: 'error', message: '자산 금액을 찾지 못함' }

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

  if (!investments.length) return { kind: 'error', message: '투자 항목을 찾지 못함' }
  return { kind: 'investment', investments }
}

function parseLoanEntry(raw: string): ParseResult {
  const body = raw.replace(/^\s*대출\s*[:：]?\s*/, '').replace(/\s+/g, ' ').trim()
  const numbers = [...body.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)/g)]
  if (!numbers.length) return { kind: 'error', message: '대출 잔액을 찾지 못함' }

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

function extractDate(text: string) {
  let date = new Date()
  let remaining = text

  if (remaining.includes('어제')) {
    date.setDate(date.getDate() - 1)
    remaining = remaining.replace('어제', '')
  }
  if (remaining.includes('오늘')) remaining = remaining.replace('오늘', '')

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
  const hit = categoryRules.find((rule) => rule.words.some((word) => memo.toLowerCase().includes(word.toLowerCase())))
  return hit ? { category: hit.category, sub: hit.sub } : { category: '미분류', sub: '' }
}

function extractPayment(memo: string) {
  const paymentPatterns = [
    '국민카드',
    '삼성카드',
    '현대카드',
    '신한카드',
    '하나카드',
    '우리카드',
    '롯데카드',
    '카카오뱅크',
    '토스뱅크',
    '네이버페이',
    '카카오페이',
    '계좌이체',
    '체크카드',
    '토스',
    '국민',
    '삼성',
    '현대',
    '신한',
    '카카오',
    '네이버',
    '현금',
    '계좌',
    '카드',
  ]
  const match = paymentPatterns.find((item) => memo.includes(item))
  if (!match) return { payment: '', remaining: memo }

  return {
    payment: normalizePayment(match),
    remaining: memo.replace(match, '').replace(/\s+/g, ' ').trim(),
  }
}

function normalizePayment(value: string) {
  const aliases: Record<string, string> = {
    국민: '국민카드',
    삼성: '삼성카드',
    현대: '현대카드',
    신한: '신한카드',
    카카오: '카카오페이',
    네이버: '네이버페이',
    계좌: '계좌이체',
    카드: '카드',
  }
  return aliases[value] ?? value
}

function extractFixedType(memo: string) {
  if (/(^|\s)고정(\s|$)/.test(memo)) {
    return { fixedType: 'fixed' as FixedType, remaining: memo.replace(/(^|\s)고정(\s|$)/, ' ').replace(/\s+/g, ' ').trim() }
  }
  if (/(^|\s)변동(\s|$)/.test(memo)) {
    return { fixedType: 'variable' as FixedType, remaining: memo.replace(/(^|\s)변동(\s|$)/, ' ').replace(/\s+/g, ' ').trim() }
  }
  return { fixedType: undefined, remaining: memo }
}

function isFixed(memo: string) {
  return /월세|관리비|통신|인터넷|구독|보험|대출|할부|국민연금|건강보험/.test(memo)
}

function fixedTypeLabel(value: FixedType) {
  return value === 'fixed' ? '고정' : '변동'
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
  if (result.kind === 'asset') return `${result.asset.name} 자산 갱신`
  if (result.kind === 'investment') return `투자 ${result.investments.length}건 갱신`
  return `${result.loan.name} 대출 갱신`
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
  return `${Number(month)}월 ${Number(day)}일`
}

export default App
