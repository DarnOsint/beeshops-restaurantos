import {
  TrendingUp,
  DollarSign,
  Banknote,
  CreditCard,
  Smartphone,
  Receipt,
  Plus,
} from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { AccountingSummary, TrendPoint } from './types'

interface Props {
  summary: AccountingSummary
  trendData: TrendPoint[]
  totalPayouts: number
  netRevenue: number
  onRecordPayout: () => void
}

export default function OverviewTab({
  summary,
  trendData,
  totalPayouts,
  netRevenue,
  onRecordPayout,
}: Props) {
  const cards = [
    {
      label: 'Gross Revenue',
      value: `₦${summary.total.toLocaleString()}`,
      icon: TrendingUp,
      color: 'text-amber-400',
      bg: 'bg-amber-400/10',
    },
    {
      label: 'Net Revenue',
      value: `₦${netRevenue.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-green-400',
      bg: 'bg-green-400/10',
    },
    {
      label: 'Cash',
      value: `₦${summary.cash.toLocaleString()}`,
      icon: Banknote,
      color: 'text-emerald-400',
      bg: 'bg-emerald-400/10',
    },
    {
      label: 'Bank POS',
      value: `₦${summary.card.toLocaleString()}`,
      icon: CreditCard,
      color: 'text-blue-400',
      bg: 'bg-blue-400/10',
    },
    {
      label: 'Transfer',
      value: `₦${summary.transfer.toLocaleString()}`,
      icon: Smartphone,
      color: 'text-purple-400',
      bg: 'bg-purple-400/10',
    },
    {
      label: 'Avg Order',
      value: `₦${summary.avgOrder.toLocaleString()}`,
      icon: Receipt,
      color: 'text-pink-400',
      bg: 'bg-pink-400/10',
    },
  ]

  const paymentBars = [
    { label: 'Cash', value: summary.cash, color: 'bg-emerald-500' },
    { label: 'Bank POS', value: summary.card, color: 'bg-blue-500' },
    { label: 'Bank Transfer', value: summary.transfer, color: 'bg-purple-500' },
  ]

  return (
    <div className="space-y-6">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {cards.map((card) => (
          <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-2`}>
              <card.icon size={16} className={card.color} />
            </div>
            <p className="text-gray-400 text-xs">{card.label}</p>
            <p className="text-white font-bold text-lg mt-0.5 leading-tight">{card.value}</p>
          </div>
        ))}
      </div>

      {/* Payment breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">Payment Method Breakdown</h3>
        <div className="space-y-3">
          {paymentBars.map((item) => (
            <div key={item.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">{item.label}</span>
                <span className="text-white font-medium">
                  ₦{item.value.toLocaleString()} (
                  {summary.total ? Math.round((item.value / summary.total) * 100) : 0}%)
                </span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className={`h-full ${item.color} rounded-full transition-all`}
                  style={{ width: `${summary.total ? (item.value / summary.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mini trend */}
      {trendData.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Revenue — Last 30 Days</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
                tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#fff' }}
                formatter={(v: number) => [`₦${v.toLocaleString()}`, 'Revenue']}
              />
              <Line
                type="monotone"
                dataKey="revenue"
                stroke="#f59e0b"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Payouts summary */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Expenses & Payouts</h3>
          <button
            onClick={onRecordPayout}
            className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={13} /> Record
          </button>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-gray-400">Total expenses this period</span>
          <span className="text-red-400 font-bold text-xl">₦{totalPayouts.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-gray-400">Net after expenses</span>
          <span className="text-green-400 font-bold text-xl">₦{netRevenue.toLocaleString()}</span>
        </div>
      </div>
    </div>
  )
}
