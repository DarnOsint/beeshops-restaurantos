import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { createPDF, addTable, savePDF } from '../../lib/pdfExport'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import Debtors from './Debtors'
import {
  Beer, LogOut, ArrowLeft, TrendingUp, ShoppingBag, AlertTriangle, HelpCircle,
  Users, Banknote, CreditCard, Smartphone, Download, Trash2,
  Plus, X, Save, Calendar, Filter, ChevronDown,
  DollarSign, Receipt, BarChart2, Clock, BookOpen, Shield
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Legend
} from 'recharts'

const DATE_RANGES = ['Today', 'This Week', 'This Month', 'Custom']

export default function Accounting() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const [voidLog, setVoidLog] = useState([])
  const [voidLoading, setVoidLoading] = useState(false)
  const [voidDateFilter, setVoidDateFilter] = useState(new Date().toISOString().split('T')[0])
  const [dateRange, setDateRange] = useState('Today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)

  // Data states
  const [summary, setSummary] = useState({ total: 0, cash: 0, card: 0, transfer: 0, orders: 0, avgOrder: 0 })
  const [orders, setOrders] = useState([])
  const [waitronStats, setWaitronStats] = useState([])
  const [trendData, setTrendData] = useState([])
  const [tillSessions, setTillSessions] = useState([])
  const [timesheet, setTimesheet] = useState([])
  const [auditLog, setAuditLog] = useState([])
  const [selectedLedger, setSelectedLedger] = useState(null)
  const [selectedAudit, setSelectedAudit] = useState(null)
  const [payouts, setPayouts] = useState([])
  const [showPayoutModal, setShowPayoutModal] = useState(false)
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [orderFilter, setOrderFilter] = useState({ status: 'all', type: 'all' })

  const [payoutForm, setPayoutForm] = useState({ amount: '', reason: '', category: 'expense', paid_to: '' })
  const [savingPayout, setSavingPayout] = useState(false)

  useEffect(() => {
    fetchAll()
  }, [dateRange, customStart, customEnd])

  useEffect(() => {
    if (activeTab !== 'voids') return
    setVoidLoading(true)
    const start = new Date(voidDateFilter); start.setHours(0,0,0,0)
    const end = new Date(voidDateFilter); end.setHours(23,59,59,999)
    supabase.from('void_log')
      .select('*')
      .gte('created_at', start.toISOString())
      .lte('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .then(({ data }) => { setVoidLog(data || []); setVoidLoading(false) })
  }, [activeTab, voidDateFilter])

  const getDateBounds = () => {
    const now = new Date()
    let start, end

    if (dateRange === 'Today') {
      start = new Date(now); start.setHours(0, 0, 0, 0)
      end = new Date(now); end.setHours(23, 59, 59, 999)
    } else if (dateRange === 'This Week') {
      const day = now.getDay()
      start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0, 0, 0, 0)
      end = new Date(now); end.setHours(23, 59, 59, 999)
    } else if (dateRange === 'This Month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      end = new Date(now); end.setHours(23, 59, 59, 999)
    } else if (dateRange === 'Custom' && customStart && customEnd) {
      start = new Date(customStart); start.setHours(0, 0, 0, 0)
      end = new Date(customEnd); end.setHours(23, 59, 59, 999)
    } else {
      start = new Date(now); start.setHours(0, 0, 0, 0)
      end = new Date(now); end.setHours(23, 59, 59, 999)
    }

    return { start: start.toISOString(), end: end.toISOString() }
  }

  const fetchAll = async () => {
    setLoading(true)
    const { start, end } = getDateBounds()

    const [ordersRes, tillRes, payoutsRes, trendRes, timesheetRes, auditRes] = await Promise.all([
      supabase.from('orders')
        .select('*, profiles(full_name), tables(name), order_items(*, menu_items(name))')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false }),
      supabase.from('till_sessions')
        .select('*, profiles(full_name)')
        .gte('opened_at', start)
        .lte('opened_at', end)
        .order('opened_at', { ascending: false }),
      supabase.from('payouts')
        .select('*, profiles(full_name)')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false }),
      // Last 30 days trend — always
      supabase.from('orders')
        .select('created_at, total_amount')
        .eq('status', 'paid')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true }),
      supabase.from('attendance')
        .select('*')
        .gte('clock_in', start)
        .lte('clock_in', end)
        .order('clock_in', { ascending: false }),
      supabase.from('audit_log')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .limit(200)
    ])

    const allOrders = ordersRes.data || []
    const paidOrders = allOrders.filter(o => o.status === 'paid')

    // Summary
    const total = paidOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
    const cash = paidOrders.filter(o => o.payment_method === 'cash').reduce((s, o) => s + (o.total_amount || 0), 0)
    const card = paidOrders.filter(o => o.payment_method === 'card').reduce((s, o) => s + (o.total_amount || 0), 0)
    const transfer = paidOrders.filter(o => o.payment_method === 'transfer').reduce((s, o) => s + (o.total_amount || 0), 0)

    setSummary({
      total, cash, card, transfer,
      orders: paidOrders.length,
      avgOrder: paidOrders.length ? Math.round(total / paidOrders.length) : 0
    })

    setOrders(allOrders)

    // Waitron stats
    const waitronMap = {}
    paidOrders.forEach(o => {
      const name = o.profiles?.full_name || 'Unknown'
      if (!waitronMap[name]) waitronMap[name] = { name, orders: 0, revenue: 0 }
      waitronMap[name].orders++
      waitronMap[name].revenue += o.total_amount || 0
    })
    setWaitronStats(Object.values(waitronMap).sort((a, b) => b.revenue - a.revenue))

    // Trend — group by day
    const dayMap = {}
    ;(trendRes.data || []).forEach(o => {
      const day = new Date(o.created_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
      if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
      dayMap[day].revenue += o.total_amount || 0
      dayMap[day].orders++
    })
    setTrendData(Object.values(dayMap))

    setTillSessions(tillRes.data || [])
    setTimesheet(timesheetRes.data || [])
    setAuditLog(auditRes.data || [])
    setPayouts(payoutsRes.data || [])

    // Build ledger: combine orders + payouts + credit orders, sorted by time
    const ledgerPaidOrders = (ordersRes.data || []).filter(o => o.status === 'paid')
    const ledger = []
    ledgerPaidOrders.forEach(o => {
      ledger.push({
        id: o.id, date: o.created_at,
        type: 'credit',
        description: (o.payment_method === 'credit' ? '[Pay Later] ' : '') + (o.tables?.name || o.order_type || 'Sale'),
        ref: o.id.slice(0, 8).toUpperCase(),
        debit: 0, credit: o.total_amount || 0,
        method: o.payment_method, staff: o.profiles?.full_name,
      })
    })
    ;(payoutsRes.data || []).forEach(p => {
      ledger.push({
        id: p.id, date: p.created_at,
        type: 'debit',
        description: p.reason || 'Expense',
        ref: p.id.slice(0, 8).toUpperCase(),
        debit: p.amount || 0, credit: 0,
        method: p.category, staff: p.profiles?.full_name,
      })
    })
    ledger.sort((a, b) => new Date(a.date) - new Date(b.date))
    // Running balance
    let balance = 0
    ledger.forEach(e => { balance += e.credit - e.debit; e.balance = balance })
    setLedgerEntries(ledger.reverse())
    setLoading(false)
  }

  const savePayout = async () => {
    if (!payoutForm.amount || !payoutForm.reason) return alert('Amount and reason are required')
    setSavingPayout(true)
    const { error } = await supabase.from('payouts').insert({
      amount: parseFloat(payoutForm.amount),
      reason: payoutForm.reason,
      category: payoutForm.category,
      paid_to: payoutForm.paid_to,
      recorded_by: profile.id
    })
    if (error) { alert('Error: ' + error.message); setSavingPayout(false); return }
    setPayoutForm({ amount: '', reason: '', category: 'expense', paid_to: '' })
    setSavingPayout(false)
    setShowPayoutModal(false)
    fetchAll()
  }

  const exportCSV = () => {
    const paidOrders = orders.filter(o => o.status === 'paid')
    const rows = [
      ['Order ID', 'Date', 'Time', 'Table/Type', 'Staff', 'Payment Method', 'Total (₦)'],
      ...paidOrders.map(o => [
        o.id.slice(0, 8).toUpperCase(),
        new Date(o.created_at).toLocaleDateString('en-NG'),
        new Date(o.created_at).toLocaleTimeString('en-NG'),
        o.tables?.name || o.order_type,
        o.profiles?.full_name || 'N/A',
        o.payment_method,
        o.total_amount
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `beeshops-sales-${dateRange.toLowerCase().replace(' ', '-')}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredOrders = orders.filter(o => {
    const matchStatus = orderFilter.status === 'all' || o.status === orderFilter.status
    const matchType = orderFilter.type === 'all' || o.order_type === orderFilter.type
    return matchStatus && matchType
  })

  const totalPayouts = payouts.reduce((s, p) => s + (p.amount || 0), 0)
  const netRevenue = summary.total - totalPayouts

  const tabs = [
    { id: 'overview', label: 'Overview', icon: BarChart2 },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'staff', label: 'Staff', icon: Users },
    { id: 'till', label: 'Till', icon: Clock },
    { id: 'payouts', label: 'Payouts', icon: DollarSign },
    { id: 'trends', label: 'Trends', icon: TrendingUp },
    { id: 'debtors', label: 'Debtors', icon: AlertTriangle },
    { id: 'voids', label: 'Voids', icon: Trash2 },
    { id: 'ledger', label: 'Ledger', icon: BookOpen },
    { id: 'audit', label: 'Audit', icon: Shield },
  ]

  return (
    <div className="min-h-full bg-gray-950">

      {/* Header */}
      

      {/* Date Range Picker */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {DATE_RANGES.map(r => (
            <button key={r} onClick={() => setDateRange(r)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${dateRange === r ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
              {r}
            </button>
          ))}
        </div>
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2">
            <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500" />
            <span className="text-gray-500 text-xs">to</span>
            <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500" />
          </div>
        )}
        <span className="text-gray-600 text-xs ml-auto">
          {loading ? 'Loading...' : `${orders.filter(o => o.status === 'paid').length} paid orders`}
        </span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <tab.icon size={15} />{tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-6">

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Gross Revenue', value: `₦${summary.total.toLocaleString()}`, icon: TrendingUp, color: 'text-amber-400', bg: 'bg-amber-400/10' },
                { label: 'Net Revenue', value: `₦${netRevenue.toLocaleString()}`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-400/10' },
                { label: 'Cash', value: `₦${summary.cash.toLocaleString()}`, icon: Banknote, color: 'text-emerald-400', bg: 'bg-emerald-400/10' },
                { label: 'Bank POS', value: `₦${summary.card.toLocaleString()}`, icon: CreditCard, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                { label: 'Transfer', value: `₦${summary.transfer.toLocaleString()}`, icon: Smartphone, color: 'text-purple-400', bg: 'bg-purple-400/10' },
                { label: 'Avg Order', value: `₦${summary.avgOrder.toLocaleString()}`, icon: Receipt, color: 'text-pink-400', bg: 'bg-pink-400/10' },
              ].map((card, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <div className={`inline-flex p-2 rounded-lg ${card.bg} mb-2`}>
                    <card.icon size={16} className={card.color} />
                  </div>
                  <p className="text-gray-400 text-xs">{card.label}</p>
                  <p className="text-white font-bold text-lg mt-0.5 leading-tight">{card.value}</p>
                </div>
              ))}
            </div>

            {/* Payment method breakdown */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Payment Method Breakdown</h3>
              <div className="space-y-3">
                {[
                  { label: 'Cash', value: summary.cash, color: 'bg-emerald-500', total: summary.total },
                  { label: 'Bank POS', value: summary.card, color: 'bg-blue-500', total: summary.total },
                  { label: 'Bank Transfer', value: summary.transfer, color: 'bg-purple-500', total: summary.total },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-400">{item.label}</span>
                      <span className="text-white font-medium">₦{item.value.toLocaleString()} ({item.total ? Math.round(item.value / item.total * 100) : 0}%)</span>
                    </div>
                    <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div className={`h-full ${item.color} rounded-full transition-all`}
                        style={{ width: `${item.total ? (item.value / item.total * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mini trend chart on overview */}
            {trendData.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Revenue — Last 30 Days</h3>
                <ResponsiveContainer width="100%" height={180}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `₦${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      labelStyle={{ color: '#fff' }}
                      formatter={v => [`₦${v.toLocaleString()}`, 'Revenue']}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Payouts summary */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Expenses & Payouts</h3>
                <button onClick={() => setShowPayoutModal(true)}
                  className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-lg transition-colors">
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
        )}

        {/* ORDERS TAB */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <select value={orderFilter.status} onChange={e => setOrderFilter({...orderFilter, status: e.target.value})}
                className="bg-gray-900 border border-gray-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500">
                <option value="all">All Status</option>
                <option value="paid">Paid</option>
                <option value="open">Open</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <select value={orderFilter.type} onChange={e => setOrderFilter({...orderFilter, type: e.target.value})}
                className="bg-gray-900 border border-gray-800 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500">
                <option value="all">All Types</option>
                <option value="table">Table</option>
                <option value="cash_sale">Cash Sale</option>
                <option value="takeaway">Takeaway</option>
              </select>
              <span className="text-gray-500 text-sm self-center">{filteredOrders.length} orders</span>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Ref', 'Time', 'Table/Type', 'Staff', 'Items', 'Payment', 'Status', 'Total'].map(h => (
                        <th key={h} className="text-left text-gray-500 text-xs uppercase tracking-wide px-4 py-3 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrders.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-8 text-gray-600">No orders found</td></tr>
                    ) : filteredOrders.map((order, i) => (
                      <tr key={order.id} className={`border-b border-gray-800 last:border-0 ${i % 2 === 0 ? '' : 'bg-gray-800/20'}`}>
                        <td className="px-4 py-3 text-gray-400 text-xs font-mono">{order.id.slice(0, 8).toUpperCase()}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs whitespace-nowrap">{new Date(order.created_at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}</td>
                        <td className="px-4 py-3 text-white text-sm whitespace-nowrap">{order.tables?.name || order.order_type}</td>
                        <td className="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">{order.profiles?.full_name || '—'}</td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{order.order_items?.length || 0} items</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-lg capitalize ${
                            order.payment_method === 'cash' ? 'bg-emerald-500/20 text-emerald-400' :
                            order.payment_method === 'card' ? 'bg-blue-500/20 text-blue-400' :
                            order.payment_method === 'transfer' ? 'bg-purple-500/20 text-purple-400' :
                            'bg-gray-700 text-gray-400'
                          }`}>{order.payment_method || '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-lg capitalize ${
                            order.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                            order.status === 'open' ? 'bg-amber-500/20 text-amber-400' :
                            'bg-red-500/20 text-red-400'
                          }`}>{order.status}</span>
                        </td>
                        <td className="px-4 py-3 text-amber-400 font-bold text-sm whitespace-nowrap">₦{order.total_amount?.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* STAFF TAB */}
        {activeTab === 'staff' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {waitronStats.length === 0 ? (
                <div className="col-span-3 text-center py-12 text-gray-500">No staff sales data for this period</div>
              ) : waitronStats.map((w, i) => (
                <div key={w.name} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{w.name}</p>
                      <p className="text-gray-500 text-xs">{w.orders} orders</p>
                    </div>
                  </div>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-gray-400 text-xs">Revenue</p>
                      <p className="text-amber-400 font-bold text-xl">₦{w.revenue.toLocaleString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400 text-xs">Avg/Order</p>
                      <p className="text-white font-medium">₦{Math.round(w.revenue / w.orders).toLocaleString()}</p>
                    </div>
                  </div>
                  {/* Revenue bar relative to top performer */}
                  <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-500 rounded-full"
                      style={{ width: `${(w.revenue / waitronStats[0].revenue) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Staff bar chart */}
            {waitronStats.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
                <h3 className="text-white font-semibold mb-4">Staff Revenue Comparison</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={waitronStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `₦${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={v => [`₦${v.toLocaleString()}`, 'Revenue']}
                    />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* TIMESHEET */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                <Clock size={16} className="text-amber-400" />
                Timesheet
              </h3>
              {timesheet.length === 0 ? (
                <div className="text-center py-6 text-gray-500 text-sm">No attendance records for this period</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-400 text-xs uppercase py-2 pr-4">Staff</th>
                        <th className="text-left text-gray-400 text-xs uppercase py-2 pr-4">Role</th>
                        <th className="text-left text-gray-400 text-xs uppercase py-2 pr-4">Date</th>
                        <th className="text-left text-gray-400 text-xs uppercase py-2 pr-4">Clock In</th>
                        <th className="text-left text-gray-400 text-xs uppercase py-2 pr-4">Clock Out</th>
                        <th className="text-right text-gray-400 text-xs uppercase py-2">Duration</th>
                      </tr>
                    </thead>
                    <tbody>
                      {timesheet.map(entry => {
                        const h = entry.duration_minutes ? Math.floor(entry.duration_minutes / 60) : 0
                        const m = entry.duration_minutes ? entry.duration_minutes % 60 : 0
                        const duration = entry.duration_minutes
                          ? (h > 0 ? h + 'h ' + m + 'm' : m + 'm')
                          : '—'
                        return (
                          <tr key={entry.id} className="border-b border-gray-800/50">
                            <td className="py-3 pr-4 text-white font-medium">{entry.staff_name}</td>
                            <td className="py-3 pr-4 text-gray-400 capitalize">{entry.role}</td>
                            <td className="py-3 pr-4 text-gray-400">{entry.date}</td>
                            <td className="py-3 pr-4 text-gray-300">
                              {new Date(entry.clock_in).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                            <td className="py-3 pr-4 text-gray-300">
                              {entry.clock_out
                                ? new Date(entry.clock_out).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                                : <span className="text-green-400 text-xs">Still on shift</span>}
                            </td>
                            <td className="py-3 text-right text-amber-400 font-medium">{duration}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-700">
                        <td colSpan={5} className="py-3 text-gray-400 text-xs">Total hours</td>
                        <td className="py-3 text-right text-white font-bold">
                          {(() => {
                            const total = timesheet.reduce((s, e) => s + (e.duration_minutes || 0), 0)
                            const h = Math.floor(total / 60)
                            const m = total % 60
                            return h > 0 ? h + 'h ' + m + 'm' : m + 'm'
                          })()}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TILL TAB */}
        {activeTab === 'till' && (
          <div className="space-y-3">
            {tillSessions.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">No till sessions for this period</div>
            ) : tillSessions.map(session => (
              <div key={session.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <p className="text-white font-semibold">{session.profiles?.full_name || 'Unknown'}</p>
                    <p className="text-gray-500 text-xs">{new Date(session.opened_at).toLocaleString('en-NG')}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-lg ${session.status === 'open' ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                    {session.status}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3 mt-3">
                  {[
                    { label: 'Opening Float', value: session.opening_float },
                    { label: 'Closing Float', value: session.closing_float },
                    { label: 'Expected Cash', value: session.expected_cash },
                  ].map(item => (
                    <div key={item.label} className="bg-gray-800 rounded-lg p-3">
                      <p className="text-gray-500 text-xs">{item.label}</p>
                      <p className="text-white font-bold">₦{(item.value || 0).toLocaleString()}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* PAYOUTS TAB */}
        {activeTab === 'payouts' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total expenses this period</p>
                <p className="text-red-400 font-bold text-2xl">₦{totalPayouts.toLocaleString()}</p>
              </div>
              <button onClick={() => setShowPayoutModal(true)}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors">
                <Plus size={16} /> Record Expense
              </button>
            </div>

            <div className="space-y-3">
              {payouts.length === 0 ? (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">No expenses recorded for this period</div>
              ) : payouts.map(payout => (
                <div key={payout.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">{payout.reason}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-lg capitalize ${
                        payout.category === 'expense' ? 'bg-red-500/20 text-red-400' :
                        payout.category === 'payout' ? 'bg-orange-500/20 text-orange-400' :
                        'bg-blue-500/20 text-blue-400'
                      }`}>{payout.category}</span>
                      {payout.paid_to && <span className="text-gray-500 text-xs">→ {payout.paid_to}</span>}
                      <span className="text-gray-600 text-xs">{new Date(payout.created_at).toLocaleString('en-NG')}</span>
                    </div>
                  </div>
                  <p className="text-red-400 font-bold text-lg">₦{payout.amount?.toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TRENDS TAB */}
        {activeTab === 'trends' && (
          <div className="space-y-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Revenue Trend — Last 30 Days</h3>
              {trendData.length === 0 ? (
                <div className="text-center py-12 text-gray-500">No trend data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => `₦${(v/1000).toFixed(0)}k`} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      labelStyle={{ color: '#fff' }}
                      formatter={v => [`₦${v.toLocaleString()}`, 'Revenue']}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#f59e0b" strokeWidth={2.5} dot={{ fill: '#f59e0b', r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">Orders per Day — Last 30 Days</h3>
              {trendData.length === 0 ? (
                <div className="text-center py-12 text-gray-500">No trend data available</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={v => [v, 'Orders']}
                    />
                    <Bar dataKey="orders" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}
      </div>

      {/* LEDGER TAB */}
      {activeTab === 'voids' && (
        <div className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white font-bold">Void Log</p>
            <input type="date" value={voidDateFilter} onChange={e => setVoidDateFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500" />
          </div>

          {voidLoading && <p className="text-gray-500 text-sm text-center py-8">Loading...</p>}

          {!voidLoading && voidLog.length === 0 && (
            <div className="text-center py-12">
              <Trash2 size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No voids recorded for this date</p>
            </div>
          )}

          {!voidLoading && voidLog.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden mb-3">
              <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
                <span className="text-gray-400 text-sm">{voidLog.length} void{voidLog.length !== 1 ? 's' : ''}</span>
                <span className="text-red-400 font-bold">
                  -₦{voidLog.reduce((s, v) => s + (v.total_value || 0), 0).toLocaleString()} total
                </span>
              </div>
            </div>
          )}

          {voidLog.map(v => (
            <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-white font-bold text-sm">{v.menu_item_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {v.void_type === 'order' ? 'Full order void' : `Qty: ${v.quantity} · ₦${v.unit_price?.toLocaleString()} each`}
                  </p>
                </div>
                <p className="text-red-400 font-bold shrink-0">-₦{v.total_value?.toLocaleString()}</p>
              </div>
              <div className="border-t border-gray-800 pt-2 mt-2 space-y-0.5">
                {v.reason && <p className="text-gray-400 text-xs">Reason: {v.reason}</p>}
                <p className="text-gray-500 text-xs">Approved by: {v.approved_by_name || 'N/A'}</p>
                {v.voided_by_name && <p className="text-gray-500 text-xs">Voided by: {v.voided_by_name}</p>}
                <p className="text-gray-600 text-xs">
                  {new Date(v.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'ledger' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-xs">General Ledger — {dateRange}</p>
              <p className="text-white font-bold text-lg">{ledgerEntries.length} entries</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-gray-400 text-xs">Closing Balance</p>
                <p className={`font-bold text-lg ${ledgerEntries[0]?.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ₦{(ledgerEntries[0]?.balance || 0).toLocaleString()}
                </p>
              </div>
              <button onClick={() => {
                const rows = [['Date','Time','Ref','Description','Staff','Method','Credit','Debit','Balance']]
                ledgerEntries.forEach(e => rows.push([
                  new Date(e.date).toLocaleDateString('en-NG'),
                  new Date(e.date).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }),
                  e.ref, e.description, e.staff || '', e.method || '',
                  e.credit || 0, e.debit || 0, e.balance
                ]))
                const doc = createPDF('General Ledger', dateRange)
                const body = ledgerEntries.map(e => [
                  new Date(e.date).toLocaleDateString('en-NG'),
                  e.ref || '',
                  e.description || '',
                  e.staff || '',
                  e.method || '',
                  e.credit ? '₦' + Number(e.credit).toLocaleString() : '',
                  e.debit ? '₦' + Number(e.debit).toLocaleString() : '',
                  '₦' + Number(e.balance).toLocaleString()
                ])
                addTable(doc, ['Date','Ref','Description','Staff','Method','Credit','Debit','Balance'], body)
                savePDF(doc, 'ledger-' + dateRange + '-' + new Date().toISOString().split('T')[0] + '.pdf')
              }} className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2 rounded-xl transition-colors">
                <Download size={12} /> Export PDF
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {ledgerEntries.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-600">No entries for this period</div>
            ) : ledgerEntries.map((entry, i) => (
              <button key={entry.id + i} onClick={() => setSelectedLedger(entry)}
                className={`w-full bg-gray-900 border rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:border-gray-600 transition-colors text-left ${entry.type === 'debit' ? 'border-red-500/20' : 'border-gray-800'}`}>
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${entry.type === 'debit' ? 'bg-red-400' : 'bg-green-400'}`} />
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{entry.description}</p>
                    <p className="text-gray-500 text-xs">{new Date(entry.date).toLocaleDateString('en-NG')} · {entry.staff || 'System'} · <span className="capitalize">{entry.method || '—'}</span></p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {entry.credit > 0 && <p className="text-green-400 font-bold text-sm">+₦{entry.credit.toLocaleString()}</p>}
                  {entry.debit > 0 && <p className="text-red-400 font-bold text-sm">-₦{entry.debit.toLocaleString()}</p>}
                  <p className={`text-xs ${entry.balance >= 0 ? 'text-gray-400' : 'text-red-400'}`}>Bal: ₦{entry.balance.toLocaleString()}</p>
                </div>
              </button>
            ))}
          </div>
          {selectedLedger && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm">
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                  <h3 className="text-white font-bold">Entry Details</h3>
                  <button onClick={() => setSelectedLedger(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { label: 'Reference', value: selectedLedger.ref },
                    { label: 'Description', value: selectedLedger.description },
                    { label: 'Date', value: new Date(selectedLedger.date).toLocaleDateString('en-NG') },
                    { label: 'Time', value: new Date(selectedLedger.date).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }) },
                    { label: 'Staff', value: selectedLedger.staff || 'System' },
                    { label: 'Method', value: selectedLedger.method || '—' },
                    { label: 'Credit', value: selectedLedger.credit > 0 ? '₦' + selectedLedger.credit.toLocaleString() : '—', color: 'text-green-400' },
                    { label: 'Debit', value: selectedLedger.debit > 0 ? '₦' + selectedLedger.debit.toLocaleString() : '—', color: 'text-red-400' },
                    { label: 'Balance', value: '₦' + selectedLedger.balance.toLocaleString(), color: selectedLedger.balance >= 0 ? 'text-white' : 'text-red-400' },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-start gap-4">
                      <span className="text-gray-500 text-xs">{row.label}</span>
                      <span className={`text-sm font-medium text-right ${row.color || 'text-white'}`}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* AUDIT TAB */}
      {activeTab === 'audit' && (
        <div className="space-y-3">
          <button onClick={() => {
            const rows = [['Date','Time','Action','Entity','Staff','Role','Details']]
            auditLog.forEach(e => rows.push([
              new Date(e.created_at).toLocaleDateString('en-NG'),
              new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              e.action, e.entity_name || e.entity,
              e.performed_by_name || 'System', e.performed_by_role || '',
              JSON.stringify(e.new_value || {}).replace(/,/g, ';')
            ]))
            const doc = createPDF('Audit Log', dateRange)
            const body = auditLog.map(e => [
              new Date(e.created_at).toLocaleDateString('en-NG'),
              new Date(e.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              (e.action || '').replace(/_/g, ' '),
              e.entity_name || e.entity || '',
              e.performed_by_name || 'System',
              e.performed_by_role || ''
            ])
            addTable(doc, ['Date','Time','Action','Entity','Performed By','Role'], body)
            savePDF(doc, 'audit-log-' + dateRange + '-' + new Date().toISOString().split('T')[0] + '.pdf')
          }} className="w-full flex items-center justify-center gap-2 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-2.5 rounded-xl transition-colors">
            <Download size={12} /> Export Audit PDF
          </button>

          {auditLog.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
              No audit records for this period
            </div>
          ) : auditLog.map(entry => {
            const actionColors = {
              ORDER_CREATED: 'text-green-400 bg-green-500/10 border-green-500/20',
              ORDER_PAID: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
              ORDER_CANCELLED: 'text-red-400 bg-red-500/10 border-red-500/20',
              STAFF_CREATED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
              STAFF_UPDATED: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
              ITEM_VOIDED: 'text-red-400 bg-red-500/10 border-red-500/20',
            }
            const colorClass = actionColors[entry.action] || 'text-gray-400 bg-gray-500/10 border-gray-500/20'
            return (
              <button key={entry.id} onClick={() => setSelectedAudit(entry)} className="w-full bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-start justify-between gap-4 hover:border-gray-600 transition-colors text-left">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className={`text-xs px-2 py-1 rounded-lg border font-medium whitespace-nowrap ${colorClass}`}>
                    {entry.action.replace(/_/g, ' ')}
                  </span>
                  <div className="min-w-0">
                    <p className="text-white text-sm font-medium truncate">{entry.entity_name || entry.entity}</p>
                    <p className="text-gray-500 text-xs mt-0.5">
                      by {entry.performed_by_name || 'System'} 
                      {entry.performed_by_role && <span className="capitalize"> · {entry.performed_by_role}</span>}
                    </p>
                    {entry.new_value && (
                      <p className="text-gray-600 text-xs mt-1 truncate">
                        {Object.entries(entry.new_value).map(([k,v]) => k + ': ' + v).join(' · ')}
                      </p>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-gray-400 text-xs">
                    {new Date(entry.created_at).toLocaleDateString('en-NG')}
                  </p>
                  <p className="text-gray-500 text-xs">
                    {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </button>
            )
          })}

          {selectedAudit && (
            <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm">
                <div className="flex items-center justify-between p-4 border-b border-gray-800">
                  <h3 className="text-white font-bold">Audit Entry</h3>
                  <button onClick={() => setSelectedAudit(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
                </div>
                <div className="p-4 space-y-3">
                  {[
                    { label: 'Action', value: selectedAudit.action.replace(/_/g, ' ') },
                    { label: 'Entity', value: selectedAudit.entity_name || selectedAudit.entity },
                    { label: 'Performed by', value: selectedAudit.performed_by_name || 'System' },
                    { label: 'Role', value: selectedAudit.performed_by_role || '—' },
                    { label: 'Date', value: new Date(selectedAudit.created_at).toLocaleDateString('en-NG') },
                    { label: 'Time', value: new Date(selectedAudit.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) },
                  ].map(row => (
                    <div key={row.label} className="flex justify-between items-start gap-4">
                      <span className="text-gray-500 text-xs">{row.label}</span>
                      <span className="text-white text-sm font-medium text-right capitalize">{row.value}</span>
                    </div>
                  ))}
                  {selectedAudit.new_value && Object.entries(selectedAudit.new_value).map(([k, v]) => (
                    <div key={k} className="flex justify-between items-start gap-4">
                      <span className="text-gray-500 text-xs capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="text-white text-sm font-medium text-right">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* DEBTORS TAB */}
      {activeTab === 'debtors' && (
        <Debtors onBack={() => setActiveTab('overview')} embedded={true} />
      )}

      {/* Payout Modal */}
      {showPayoutModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Record Expense / Payout</h3>
              <button onClick={() => setShowPayoutModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Category</label>
                <div className="grid grid-cols-3 gap-2">
                  {['expense', 'payout', 'refund'].map(cat => (
                    <button key={cat} onClick={() => setPayoutForm({...payoutForm, category: cat})}
                      className={`py-2 rounded-xl text-xs font-medium border-2 capitalize transition-all ${payoutForm.category === cat ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-400'}`}>
                      {cat}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Amount (₦) *</label>
                <input type="number" value={payoutForm.amount} onChange={e => setPayoutForm({...payoutForm, amount: e.target.value})}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-lg font-bold"
                  placeholder="0" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Reason *</label>
                <input value={payoutForm.reason} onChange={e => setPayoutForm({...payoutForm, reason: e.target.value})}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="e.g. Generator fuel, Ice supply" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Paid To</label>
                <input value={payoutForm.paid_to} onChange={e => setPayoutForm({...payoutForm, paid_to: e.target.value})}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="Person or vendor name" />
              </div>
              <button onClick={savePayout} disabled={savingPayout}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors">
                <Save size={16} /> {savingPayout ? 'Saving...' : 'Record Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}