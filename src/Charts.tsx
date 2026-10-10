// 인사이트 탭 차트. recharts 가 번들의 큰 덩어리라 홈을 열 때는 안 받고, 인사이트 탭을 열 때 받는다(App 의 lazy).
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Fmt = { money: (n: number) => string; compact: (n: number) => string; label: string }
const tip = { backgroundColor: 'var(--surface-solid)', borderColor: 'var(--line)', borderRadius: '10px', color: 'var(--ink)' }
const tick = { fontSize: 11, fill: 'var(--muted)' }

export function TrendChart({ data, money, compact, label }: Fmt & { data: { monthLabel: string; realSpend: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <AreaChart data={data} margin={{ left: 0, right: 12, top: 14, bottom: 0 }}>
        <defs>
          <linearGradient id="spendFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.24} />
            <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--line)" vertical={false} />
        <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tick={tick} />
        <YAxis tickLine={false} axisLine={false} tickFormatter={compact} width={50} tick={tick} />
        <Tooltip contentStyle={tip} formatter={(value) => [money(Number(value)), label]} labelFormatter={(l) => `${l}`} />
        <Area type="monotone" dataKey="realSpend" stroke="var(--accent)" strokeWidth={3} fill="url(#spendFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function RankChart({ data, colors, money, compact, label }: Fmt & { data: { name: string; value: number }[]; colors: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 12, bottom: 8 }}>
        <CartesianGrid stroke="var(--line)" horizontal={false} />
        <XAxis type="number" tickFormatter={compact} axisLine={false} tickLine={false} tick={tick} />
        <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} width={76} tick={tick} />
        <Tooltip contentStyle={tip} itemStyle={{ color: 'var(--ink)' }} labelStyle={{ color: 'var(--accent)', fontWeight: 800 }}
          formatter={(value) => [money(Number(value)), label]} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]}>
          {data.map((entry, index) => <Cell key={entry.name} fill={colors[index % colors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
