import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
  ArrowDownUp,
  Banknote,
  CalendarDays,
  ChartNoAxesCombined,
  CircleDollarSign,
  CreditCard,
  Download,
  Home,
  Landmark,
  LineChart,
  Pencil,
  PiggyBank,
  Plus,
  ReceiptText,
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
import './App.css'

type Tab = 'dashboard' | 'ledger' | 'assets' | 'insights'
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

const quickTemplates = [
  '오늘 5000 점심밥 국민카드 변동',
  '오늘 2000 커피 토스 변동',
  '자산: 현금 950625 토스',
  '대출: 햇살론 6100000 225779 토스뱅크',
]

const paymentHints = ['국민카드', '토스', '현금', '계좌이체']
const fixedHints = ['고정', '변동']

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
    investment('2026-06-07', '일반', '크래프톤', 4562694, 0.0008),
    investment('2026-06-07', '일반', '시프트업', 1722635, -0.308),
    investment('2026-06-07', 'ISA', '삼성전자', 21797000, 0.3119),
    investment('2026-06-07', '연금저축', 'TIGER 미국배당 다우존스', 2230800, 0.0749),
  ],
  loans: [
    loan('2026-06-07', '햇살론', '토스뱅크', 6100000, 225779, 0, '매월 1일'),
    loan('2026-06-07', '자동차 할부', '국민카드', 3500000, 515690, 0, '매월 14일'),
  ],
  budget: 1000000,
}

function App() {
  const [store, setStore] = usePersistentStore()
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
  const summary = useMemo(() => buildSummary(store), [store])

  function dismissPwaBanner() {
    window.localStorage.setItem('shiba-pwa-dismissed', 'true')
    setShowPwaBanner(false)
  }

  function updateBudget(amount: number) {
    setStore((current) => ({ ...current, budget: amount }))
    setLastMessage(`예산 ${formatMoney(amount)}으로 변경됨`)
  }

  function applyQuickInput(raw: string) {
    const parsed = parseQuickEntry(raw)
    if (parsed.kind === 'error') {
      setLastMessage(parsed.message)
      return
    }

    setStore((current) => {
      if (parsed.kind === 'transaction') {
        return { ...current, transactions: [parsed.transaction, ...current.transactions] }
      }
      if (parsed.kind === 'asset') {
        return { ...current, assets: upsertByName(current.assets, parsed.asset) }
      }
      if (parsed.kind === 'investment') {
        return { ...current, investments: upsertManyInvestments(current.investments, parsed.investments) }
      }
      return { ...current, loans: upsertByName(current.loans, parsed.loan) }
    })

    setLastMessage(resultLabel(parsed))
  }

  function deleteTransaction(id: string) {
    setStore((current) => ({
      ...current,
      transactions: current.transactions.filter((item) => item.id !== id),
    }))
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

      <QuickEntry onSubmit={applyQuickInput} lastMessage={lastMessage} />

      <nav className="tab-bar" aria-label="화면">
        <TabButton tab="dashboard" activeTab={activeTab} icon={<Home size={18} />} label="홈" onClick={setActiveTab} />
        <TabButton tab="ledger" activeTab={activeTab} icon={<ReceiptText size={18} />} label="원장" onClick={setActiveTab} />
        <TabButton tab="assets" activeTab={activeTab} icon={<Wallet size={18} />} label="자산" onClick={setActiveTab} />
        <TabButton tab="insights" activeTab={activeTab} icon={<Sparkles size={18} />} label="인사이트" onClick={setActiveTab} />
      </nav>

      {activeTab === 'dashboard' && <Dashboard store={store} summary={summary} onUpdateBudget={updateBudget} />}
      {activeTab === 'ledger' && <Ledger transactions={store.transactions} onDelete={deleteTransaction} />}
      {activeTab === 'assets' && <AssetsView store={store} summary={summary} onSaveAsset={saveAsset} />}
      {activeTab === 'insights' && <InsightsView store={store} summary={summary} />}
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
      <div className="template-row">
        {quickTemplates.map((template) => (
          <button key={template} type="button" onClick={() => setDraft(template)}>
            {template}
          </button>
        ))}
      </div>
      <div className="hint-row" aria-label="빠른 옵션">
        {paymentHints.map((hint) => (
          <button key={hint} type="button" onClick={() => setDraft((current) => appendToken(current, hint))}>
            {hint}
          </button>
        ))}
        {fixedHints.map((hint) => (
          <button key={hint} type="button" className="fixed-hint" onClick={() => setDraft((current) => appendToken(current, hint))}>
            {hint}
          </button>
        ))}
      </div>
      <p className="status-line">{lastMessage}</p>
    </section>
  )
}

function Dashboard({
  store,
  summary,
  onUpdateBudget,
}: {
  store: FinanceStore
  summary: Summary
  onUpdateBudget: (amount: number) => void
}) {
  const [isEditingBudget, setIsEditingBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState(String(summary.budget))

  // 예산 소진율 상태별 Reality Check 멘트
  const getRealityCheck = (rate: number) => {
    if (rate === 0) return { emoji: '🎨', text: '텅장 방어전 시작! 지출 0원으로 완전 깨끗합니다.' }
    if (rate < 0.4) return { emoji: '🌱', text: '나름 절제하며 잘 버티고 있어요. 좋은 기세입니다!' }
    if (rate < 0.7) return { emoji: '⚠️', text: '슬슬 소비에 탄력이 붙기 시작했으니, 경계심을 가지세요.' }
    if (rate < 0.95) return { emoji: '🍜', text: '위험 경보! 진짜 돈 없어요. 이제 삼각김밥 코스입니다.' }
    return { emoji: '💸', text: '거덜 났습니다! 카드 다 압수하고, 당장 지갑 닫으세요.' }
  }

  const reality = getRealityCheck(summary.budgetUsageRate)

  function saveBudget() {
    const nextVal = Number(budgetInput.replace(/,/g, ''))
    if (!isNaN(nextVal) && nextVal > 0) {
      onUpdateBudget(nextVal)
    }
    setIsEditingBudget(false)
  }

  return (
    <section className="view-stack">
      {/* Notion-style Reality Budget Checker */}
      <article className="budget-progress-card">
        <div className="budget-progress-header">
          <div>
            <span className="reality-emoji">{reality.emoji}</span>
            <div>
              <h3>이번 달 예산 한도</h3>
              <p className="reality-comment">{reality.text}</p>
            </div>
          </div>
          <div className="budget-edit-box">
            {isEditingBudget ? (
              <div className="budget-inline-form">
                <input
                  value={budgetInput}
                  onChange={(e) => setBudgetInput(e.target.value.replace(/[^\d,]/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveBudget()
                    if (e.key === 'Escape') setIsEditingBudget(false)
                  }}
                  autoFocus
                />
                <button type="button" onClick={saveBudget}>저장</button>
              </div>
            ) : (
              <div className="budget-display">
                <strong>{formatMoney(summary.thisMonth.realSpend)}</strong>
                <span>/ {formatMoney(summary.budget)}</span>
                <button type="button" onClick={() => {
                  setBudgetInput(String(summary.budget))
                  setIsEditingBudget(true)
                }}>
                  수정
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="budget-progress-bar-track">
          <span 
            className={`budget-progress-bar-fill ${summary.budgetUsageRate >= 0.95 ? 'danger' : summary.budgetUsageRate >= 0.7 ? 'warn' : ''}`}
            style={{ width: `${Math.min(100, summary.budgetUsageRate * 100)}%` }}
          />
        </div>
        <div className="budget-progress-footer">
          <span>소진율 {formatPercent(summary.budgetUsageRate)}</span>
          <span>남은 금액: {formatMoney(Math.max(0, summary.budget - summary.thisMonth.realSpend))}</span>
        </div>
      </article>

      <div className="metric-grid">
        <MetricCard title="이번 달 실지출" value={formatMoney(summary.thisMonth.realSpend)} note={summary.monthKey} icon={<Banknote />} tone="green" />
        <MetricCard title="순자산" value={formatMoney(summary.netWorth)} note={`부채 ${formatMoney(summary.loanTotal)}`} icon={<PiggyBank />} tone="blue" />
        <MetricCard title="고정비 비중" value={formatPercent(summary.fixedShare)} note={formatMoney(summary.thisMonth.fixed)} icon={<ShieldCheck />} tone="amber" />
        <MetricCard title="투자 평가액" value={formatMoney(summary.investmentTotal)} note={formatPercent(summary.investmentShare)} icon={<LineChart />} tone="rose" />
      </div>

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
                contentStyle={{ backgroundColor: '#121f18', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }} 
                formatter={(value) => [formatMoney(Number(value)), '실지출']} 
                labelFormatter={(label) => `${label}`} 
              />
              <Area type="monotone" dataKey="realSpend" stroke="var(--accent-tan)" strokeWidth={3} fill="url(#spendFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="split-layout">
        <div className="wide-section">
          <SectionHeader icon={<ArrowDownUp size={18} />} title="카테고리" aside={formatMoney(summary.thisMonth.totalSpend)} />
          <CategoryBars data={summary.categoryTotals.slice(0, 6)} total={summary.thisMonth.totalSpend} />
        </div>

        <div className="wide-section">
          <SectionHeader icon={<CreditCard size={18} />} title="결제수단" aside={summary.paymentTotals[0]?.name ?? '미지정'} />
          <CategoryBars data={summary.paymentTotals.slice(0, 6)} total={summary.thisMonth.totalSpend} />
        </div>
      </section>

      <section className="split-layout">
        <div className="wide-section">
          <SectionHeader icon={<ShieldCheck size={18} />} title="고정비 / 변동비" aside={formatPercent(summary.fixedShare)} />
          <FixedVariablePanel summary={summary} />
        </div>

        <div className="wide-section">
          <SectionHeader icon={<CalendarDays size={18} />} title="최근 거래" aside={`${store.transactions.length}건`} />
          <div className="recent-list">
            {store.transactions.slice(0, 6).map((transaction) => (
              <TransactionRow key={transaction.id} transaction={transaction} />
            ))}
          </div>
        </div>
      </section>
    </section>
  )
}

function Ledger({ transactions, onDelete }: { transactions: Transaction[]; onDelete: (id: string) => void }) {
  const [filter, setFilter] = useState<'all' | TransactionType>('all')
  const filtered = transactions.filter((item) => filter === 'all' || item.type === filter)

  return (
    <section className="view-stack">
      <div className="segmented">
        <button type="button" className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          전체
        </button>
        <button type="button" className={filter === 'expense' ? 'active' : ''} onClick={() => setFilter('expense')}>
          지출
        </button>
        <button type="button" className={filter === 'income' ? 'active' : ''} onClick={() => setFilter('income')}>
          수입
        </button>
      </div>

      <section className="ledger-table">
        {filtered.map((transaction) => (
          <article className="ledger-row" key={transaction.id}>
            <div>
              <p className="row-title">{transaction.memo}</p>
              <p className="row-meta">
                {formatDateLabel(transaction.date)} · {transaction.category} · {transaction.payment || '미지정'} · {fixedTypeLabel(transaction.fixedType)}
              </p>
            </div>
            <div className="row-actions">
              <strong className={transaction.type === 'income' ? 'income' : ''}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}</strong>
              <button type="button" aria-label="삭제" onClick={() => onDelete(transaction.id)}>
                <Trash2 size={17} />
              </button>
            </div>
          </article>
        ))}
      </section>
    </section>
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

function InsightsView({ store, summary }: { store: FinanceStore; summary: Summary }) {
  const insightRows = buildInsights(store, summary)
  const colors = ['#e5c493', '#3db881', '#5aa4e1', '#e4983c', '#e26b73', '#9c82c9']

  return (
    <section className="view-stack">
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
                contentStyle={{ backgroundColor: '#121f18', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }} 
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

function MetricCard({ title, value, note, icon, tone }: { title: string; value: string; note: string; icon: ReactNode; tone: string }) {
  return (
    <article className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <p>{title}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
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

function CategoryBars({ data, total }: { data: NameValue[]; total: number }) {
  return (
    <div className="category-bars">
      {data.map((item) => (
        <div className="category-bar" key={item.name}>
          <div className="bar-label">
            <span>{item.name}</span>
            <strong>{formatMoney(item.value)}</strong>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max(5, total ? (item.value / total) * 100 : 0)}%` }} />
          </div>
        </div>
      ))}
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

function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <article className="mini-row">
      <div className="mini-icon">
        {transaction.type === 'income' ? <TrendingUp size={17} /> : <ReceiptText size={17} />}
      </div>
      <div>
        <p className="row-title">{transaction.memo}</p>
        <p className="row-meta">{transaction.category} · {transaction.payment || '미지정'} · {fixedTypeLabel(transaction.fixedType)} · {formatDateLabel(transaction.date)}</p>
      </div>
      <strong className={transaction.type === 'income' ? 'income' : ''}>{transaction.type === 'income' ? '+' : '-'}{formatMoney(transaction.amount)}</strong>
    </article>
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

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  }, [store])

  return [store, setStore] as const
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
  const fixedShare = thisMonth.totalSpend ? thisMonth.fixed / thisMonth.totalSpend : 0
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
  const fixed = expenseRows.filter((item) => item.fixedType === 'fixed').reduce((sum, item) => sum + item.amount, 0)
  const variable = expenseRows.filter((item) => item.fixedType === 'variable').reduce((sum, item) => sum + item.amount, 0)

  return {
    month,
    monthLabel: month.slice(5),
    totalSpend,
    realSpend: totalSpend - split,
    fixed,
    variable,
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

function buildInsights(store: FinanceStore, summary: Summary) {
  const rows = []
  const diff = summary.previousMonth ? summary.thisMonth.realSpend - summary.previousMonth.realSpend : 0
  const topCategory = summary.categoryTotals[0]
  const topPayment = summary.paymentTotals[0]
  const worstInvestment = [...store.investments].sort((a, b) => a.returnRate - b.returnRate)[0]
  const missingPayment = store.transactions.filter((item) => !item.payment).length

  // 당월 지출 중 단일 최대 지출 추출
  const currentMonthTx = store.transactions.filter((item) => item.date.startsWith(summary.monthKey) && item.type === 'expense')
  const maxTx = currentMonthTx.length > 0 ? [...currentMonthTx].sort((a, b) => b.amount - a.amount)[0] : undefined

  rows.push({
    level: diff > 0 ? 'warn' : 'good',
    icon: diff > 0 ? <TrendingUp size={18} /> : <TrendingDown size={18} />,
    title: diff > 0 ? '지출 증가 현황' : '지출 안정',
    body: summary.previousMonth ? `전월 대비 ${formatSignedMoney(diff)} 썼습니다. ${diff > 0 ? '지갑 끈 바짝 조이세요!' : '좋은 흐름입니다!'}` : '비교할 이전 달이 아직 없습니다.',
  })

  if (maxTx) {
    rows.push({
      level: maxTx.amount >= 150000 ? 'danger' : 'warn',
      icon: <CircleDollarSign size={18} />,
      title: '이번 달 최대 지출건',
      body: `💳 ${maxTx.memo}에 ${formatMoney(maxTx.amount)} 지출. 이거 진짜 평생 쓸 필수품 맞나요? 🤔`,
    })
  }

  if (topCategory) {
    rows.push({
      level: topCategory.value / Math.max(summary.thisMonth.totalSpend, 1) > 0.35 ? 'warn' : 'good',
      icon: <ReceiptText size={18} />,
      title: `${topCategory.name} 비중`,
      body: `${formatMoney(topCategory.value)} · ${formatPercent(topCategory.value / Math.max(summary.thisMonth.totalSpend, 1))} 차지. 이 카테고리만 줄여도 텅장은 면합니다.`,
    })
  }

  if (topPayment) {
    rows.push({
      level: topPayment.name.includes('카드') ? 'warn' : 'good',
      icon: <CreditCard size={18} />,
      title: '가장 많이 쓴 결제수단',
      body: `💳 이번 달은 ${topPayment.name}으로 가장 많이(${formatMoney(topPayment.value)}) 긁었습니다. 영수증 볼 때 가슴 아프지 않으시길 바랍니다. 💸`,
    })
  }

  rows.push({
    level: summary.fixedShare > 0.6 ? 'warn' : 'good',
    icon: <ShieldCheck size={18} />,
    title: '고정비 청구',
    body: `${formatPercent(summary.fixedShare)} · ${summary.fixedShare > 0.6 ? '숨쉬기만 해도 이만큼 나가요. 넷플릭스/구독부터 다 해지하세요.' : '안정적 고정 지출 수준입니다.'}`,
  })

  rows.push({
    level: summary.thisMonth.variable > summary.thisMonth.fixed ? 'warn' : 'good',
    icon: <ArrowDownUp size={18} />,
    title: '변동비 경보',
    body: `${formatMoney(summary.thisMonth.variable)} · ${topCategory ? `${topCategory.name}에서 안 써도 될 돈이 나갔는지 보세요.` : '데이터가 더 쌓이면 상세 분석해 드릴게요.'}`,
  })

  if (worstInvestment) {
    rows.push({
      level: worstInvestment.returnRate < -0.15 ? 'danger' : 'good',
      icon: <LineChart size={18} />,
      title: worstInvestment.returnRate < 0 ? '투자 현타 상태' : '투자 수익',
      body: `${worstInvestment.name} ${formatPercent(worstInvestment.returnRate)} ${worstInvestment.returnRate < -0.15 ? '파랗게 질렸습니다. 물타기 금지 🛑' : '수익 보는 중!'}`,
    })
  }

  rows.push({
    level: missingPayment > 0 ? 'warn' : 'good',
    icon: <Sparkles size={18} />,
    title: '입력 성실도',
    body: missingPayment > 0 ? `결제수단 미입력 ${missingPayment}건. 귀찮아도 꼬박꼬박 적어야 현실을 봅니다.` : '완벽한 기록 데이터! 칭찬합니다.',
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
  const type: TransactionType = /수입|월급|급여|입금|보너스/.test(raw) ? 'income' : 'expense'
  const paymentParse = extractPayment(text)
  text = paymentParse.remaining
  const fixedParse = extractFixedType(text)
  text = fixedParse.remaining
  const category = classify(text)

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
      split: 0,
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

function investment(date: string, account: string, name: string, value: number, returnRate: number): Investment {
  return { id: uid(), date, account, name, value, returnRate, note: '' }
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

function appendToken(current: string, token: string) {
  const trimmed = current.trim()
  if (!trimmed) return token
  if (trimmed.includes(token)) return trimmed
  return `${trimmed} ${token}`
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
  const [, month, day] = value.match(/(\d{4})-(\d{2})-(\d{2})/) ?? []
  if (!month || !day) return value
  return `${Number(month)}월 ${Number(day)}일`
}

export default App
