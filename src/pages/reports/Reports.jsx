import { useState, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  Beer, LogOut, ArrowLeft, Download, FileText,
  TrendingUp, ShoppingBag, Users, Banknote, CreditCard,
  BarChart2, Home, AlertTriangle, RefreshCw, Printer
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell
} from 'recharts'

const MONTHS = ['January','February','March','April','May','June',
  'July','August','September','October','November','December']

const COLORS = ['#f59e0b','#3b82f6','#10b981','#8b5cf6','#ef4444','#06b6d4','#f97316','#84cc16']

export default function Reports() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const printRef = useRef()

  const now = new Date()
  const [reportType, setReportType] = useState('daily')
  const [selectedDay, setSelectedDay] = useState(now.getDate())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState(null)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const getDaysInMonth = (month, year) => new Date(year, month + 1, 0).getDate()

  const getDateBounds = () => {
    if (reportType === 'daily') {
      const start = new Date(selectedYear, selectedMonth, selectedDay, 0, 0, 0, 0)
      const end = new Date(selectedYear, selectedMonth, selectedDay, 23, 59, 59, 999)
      return { start: start.toISOString(), end: end.toISOString() }
    } else if (reportType === 'month') {
      const start = new Date(selectedYear, selectedMonth, 1)
      const end = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999)
      return { start: start.toISOString(), end: end.toISOString() }
    } else {
      const start = new Date(selectedYear, 0, 1)
      const end = new Date(selectedYear, 11, 31, 23, 59, 59, 999)
      return { start: start.toISOString(), end: end.toISOString() }
    }
  }

  const getPeriodLabel = () => {
    if (reportType === 'daily') return `${selectedDay} ${MONTHS[selectedMonth]} ${selectedYear}`
    if (reportType === 'month') return `${MONTHS[selectedMonth]} ${selectedYear}`
    return `Year ${selectedYear}`
  }

  const generateReport = async () => {
    setLoading(true)
    const { start, end } = getDateBounds()

    const [ordersRes, orderItemsRes, payoutsRes, tillRes, debtorsRes, roomStaysRes] = await Promise.all([
      supabase.from('orders').select('*, profiles(full_name), tables(name, table_categories(name))').gte('created_at', start).lte('created_at', end),
      supabase.from('order_items').select('*, menu_items(name, price, menu_categories(name, destination)), orders(created_at, status)').gte('created_at', start).lte('created_at', end),
      supabase.from('payouts').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('till_sessions').select('*, profiles(full_name)').gte('created_at', start).lte('created_at', end),
      supabase.from('debtors').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('room_stays').select('*').gte('created_at', start).lte('created_at', end),
    ])

    const orders = ordersRes.data || []
    const paidOrders = orders.filter(o => o.status === 'paid')
    const cancelledOrders = orders.filter(o => o.status === 'cancelled')
    const allItems = orderItemsRes.data || []
    const payouts = payoutsRes.data || []
    const tillSessions = tillRes.data || []
    const debtors = debtorsRes.data || []
    const roomStays = roomStaysRes.data || []

    const grossRevenue = paidOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
    const totalExpenses = payouts.reduce((s, p) => s + (p.amount || 0), 0)
    const netRevenue = grossRevenue - totalExpenses
    const roomRevenue = roomStays.filter(r => r.status === 'checked_out').reduce((s, r) => s + (r.total_amount || 0), 0)
    const totalRevenue = grossRevenue + roomRevenue

    const byPayment = {
      cash: paidOrders.filter(o => o.payment_method === 'cash').reduce((s, o) => s + (o.total_amount || 0), 0),
      bank_pos: paidOrders.filter(o => ['card','bank_pos'].includes(o.payment_method)).reduce((s, o) => s + (o.total_amount || 0), 0),
      transfer: paidOrders.filter(o => ['transfer','bank_transfer'].includes(o.payment_method)).reduce((s, o) => s + (o.total_amount || 0), 0),
    }

    const categoryMap = {}
    allItems.filter(i => i.orders?.status === 'paid').forEach(item => {
      const cat = item.menu_items?.menu_categories?.name || 'Unknown'
      if (!categoryMap[cat]) categoryMap[cat] = { name: cat, revenue: 0, quantity: 0 }
      categoryMap[cat].revenue += item.total_price || (item.unit_price * item.quantity) || 0
      categoryMap[cat].quantity += item.quantity || 0
    })
    const byCategory = Object.values(categoryMap).sort((a, b) => b.revenue - a.revenue)

    const itemMap = {}
    allItems.filter(i => i.orders?.status === 'paid').forEach(item => {
      const name = item.menu_items?.name || 'Unknown'
      if (!itemMap[name]) itemMap[name] = { name, quantity: 0, revenue: 0 }
      itemMap[name].quantity += item.quantity || 0
      itemMap[name].revenue += item.total_price || 0
    })
    const topItems = Object.values(itemMap).sort((a, b) => b.quantity - a.quantity).slice(0, 10)

    const staffMap = {}
    paidOrders.forEach(o => {
      const name = o.profiles?.full_name || 'Unknown'
      if (!staffMap[name]) staffMap[name] = { name, orders: 0, revenue: 0 }
      staffMap[name].orders++
      staffMap[name].revenue += o.total_amount || 0
    })
    const staffPerformance = Object.values(staffMap).sort((a, b) => b.revenue - a.revenue)

    // Hourly for daily, day-by-day for month/year
    const hourMap = {}
    for (let i = 0; i < 24; i++) hourMap[i] = { label: `${i}:00`, orders: 0, revenue: 0 }
    paidOrders.forEach(o => {
      const h = new Date(o.created_at).getHours()
      hourMap[h].orders++
      hourMap[h].revenue += o.total_amount || 0
    })
    const hourlyData = Object.values(hourMap).filter(h => h.orders > 0)

    const dayMap = {}
    paidOrders.forEach(o => {
      const day = new Date(o.created_at).toLocaleDateString('en-NG', { month: 'short', day: 'numeric' })
      if (!dayMap[day]) dayMap[day] = { label: day, revenue: 0, orders: 0 }
      dayMap[day].revenue += o.total_amount || 0
      dayMap[day].orders++
    })
    const dailyBreakdown = Object.values(dayMap)

    const tableMap = {}
    paidOrders.filter(o => o.tables?.name).forEach(o => {
      const t = o.tables.name
      if (!tableMap[t]) tableMap[t] = { table: t, orders: 0, revenue: 0 }
      tableMap[t].orders++
      tableMap[t].revenue += o.total_amount || 0
    })
    const tableStats = Object.values(tableMap).sort((a, b) => b.revenue - a.revenue).slice(0, 10)

    setReport({
      period: getPeriodLabel(),
      reportType,
      generatedAt: new Date().toLocaleString('en-NG'),
      grossRevenue, netRevenue, totalExpenses, roomRevenue, totalRevenue,
      totalOrders: orders.length,
      paidOrders: paidOrders.length,
      cancelledOrders: cancelledOrders.length,
      avgOrderValue: paidOrders.length ? Math.round(grossRevenue / paidOrders.length) : 0,
      byPayment, byCategory, topItems, staffPerformance,
      hourlyData, dailyBreakdown, tableStats,
      totalDebt: debtors.reduce((s, d) => s + (d.current_balance || 0), 0),
      totalDebtCreated: debtors.reduce((s, d) => s + (d.credit_limit || 0), 0),
      debtorCount: debtors.length,
      roomStayCount: roomStays.length,
      totalOpeningFloat: tillSessions.reduce((s, t) => s + (t.opening_float || 0), 0),
      totalClosingFloat: tillSessions.filter(t => t.status === 'closed').reduce((s, t) => s + (t.closing_float || 0), 0),
      byOrderType: {
        table: paidOrders.filter(o => o.order_type === 'table').length,
        cash_sale: paidOrders.filter(o => o.order_type === 'cash_sale').length,
        takeaway: paidOrders.filter(o => o.order_type === 'takeaway').length,
      },
      payouts, tillSessions,
    })

    setLoading(false)
  }

  const exportCSV = () => {
    if (!report) return
    const rows = [
      ['BEESHOPS PLACE - ' + report.period.toUpperCase() + ' REPORT'],
      ['Generated:', report.generatedAt],
      [],
      ['REVENUE SUMMARY'],
      ['Gross Revenue (F&B)', 'NGN ' + report.grossRevenue.toLocaleString()],
      ['Room Revenue', 'NGN ' + report.roomRevenue.toLocaleString()],
      ['Total Revenue', 'NGN ' + report.totalRevenue.toLocaleString()],
      ['Total Expenses', 'NGN ' + report.totalExpenses.toLocaleString()],
      ['Net Revenue', 'NGN ' + report.netRevenue.toLocaleString()],
      [],
      ['ORDERS'],
      ['Total Orders', report.totalOrders],
      ['Paid Orders', report.paidOrders],
      ['Cancelled Orders', report.cancelledOrders],
      ['Avg Order Value', 'NGN ' + report.avgOrderValue.toLocaleString()],
      [],
      ['PAYMENT METHODS'],
      ['Cash', 'NGN ' + report.byPayment.cash.toLocaleString()],
      ['Bank POS', 'NGN ' + report.byPayment.bank_pos.toLocaleString()],
      ['Bank Transfer', 'NGN ' + report.byPayment.transfer.toLocaleString()],
      [],
      ['TOP SELLING ITEMS'],
      ['Item', 'Qty Sold', 'Revenue'],
      ...report.topItems.map(i => [i.name, i.quantity, 'NGN ' + i.revenue.toLocaleString()]),
      [],
      ['STAFF PERFORMANCE'],
      ['Staff', 'Orders', 'Revenue'],
      ...report.staffPerformance.map(s => [s.name, s.orders, 'NGN ' + s.revenue.toLocaleString()]),
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'beeshops-' + report.period.toLowerCase().replace(/ /g, '-') + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const chartData = report?.reportType === 'daily' ? report?.hourlyData : report?.dailyBreakdown

  return (
    <div className="min-h-screen bg-gray-950">

      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 print:hidden">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
              <Beer size={18} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm">Beeshop's Place</h1>
              <p className="text-gray-400 text-xs">Reports</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {report && (
              <>
                <button onClick={exportCSV}
                  className="flex items-center gap-1.5 text-gray-400 hover:text-amber-400 text-xs border border-gray-700 hover:border-amber-500/50 rounded-lg px-3 py-1.5 transition-colors">
                  <Download size={13} /> CSV
                </button>
                <button onClick={() => window.print()}
                  className="flex items-center gap-1.5 text-gray-400 hover:text-amber-400 text-xs border border-gray-700 hover:border-amber-500/50 rounded-lg px-3 py-1.5 transition-colors">
                  <Printer size={13} /> Print / PDF
                </button>
              </>
            )}
            <button onClick={() => navigate(profile?.role === 'owner' ? '/executive' : '/management')}
              className="flex items-center gap-1.5 text-gray-400 hover:text-white text-xs transition-colors">
              <ArrowLeft size={14} /> Dashboard
            </button>
            <div className="text-right">
              <p className="text-white text-sm">{profile?.full_name}</p>
              <p className="text-amber-500 text-xs capitalize">{profile?.role}</p>
            </div>
            <button onClick={signOut} className="text-gray-400 hover:text-white">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <div className="p-4 md:p-6 max-w-6xl mx-auto">

        {/* Generator */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6 print:hidden">
          <h2 className="text-white font-bold mb-4 flex items-center gap-2">
            <FileText size={18} className="text-amber-400" /> Generate Report
          </h2>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Report Type</label>
              <div className="flex gap-2">
                {[['daily','Daily'], ['month','Monthly'], ['year','Annual']].map(([t, label]) => (
                  <button key={t} onClick={() => setReportType(t)}
                    className={'px-4 py-2 rounded-xl text-sm font-medium transition-colors ' + (reportType === t ? 'bg-amber-500 text-black' : 'bg-gray-800 border border-gray-700 text-gray-400')}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {(reportType === 'daily' || reportType === 'month') && (
              <div>
                <label className="text-gray-400 text-xs block mb-1">Month</label>
                <select value={selectedMonth} onChange={e => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500">
                  {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
                </select>
              </div>
            )}

            {reportType === 'daily' && (
              <div>
                <label className="text-gray-400 text-xs block mb-1">Day</label>
                <select value={selectedDay} onChange={e => setSelectedDay(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500">
                  {Array.from({ length: getDaysInMonth(selectedMonth, selectedYear) }, (_, i) => i + 1).map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="text-gray-400 text-xs block mb-1">Year</label>
              <select value={selectedYear} onChange={e => setSelectedYear(parseInt(e.target.value))}
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>

            <button onClick={generateReport} disabled={loading}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold px-6 py-2 rounded-xl text-sm transition-colors">
              {loading ? <RefreshCw size={15} className="animate-spin" /> : <BarChart2 size={15} />}
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>

        {!report && !loading && (
          <div className="text-center py-20 text-gray-500">
            <FileText size={48} className="mx-auto mb-4 opacity-20" />
            <p>Select a period and click Generate Report</p>
          </div>
        )}

        {report && (
          <div ref={printRef} className="space-y-6">

            {/* Header */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-white font-bold text-2xl">
                    {report.reportType === 'daily' ? 'Daily' : report.reportType === 'month' ? 'Monthly' : 'Annual'} Report
                  </h1>
                  <p className="text-amber-400 text-lg font-semibold">{report.period}</p>
                  <p className="text-gray-500 text-xs mt-1">Generated: {report.generatedAt}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-3xl">NGN {report.totalRevenue.toLocaleString()}</p>
                  <p className="text-gray-400 text-sm">Total Revenue</p>
                </div>
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Gross F&B Revenue', value: 'NGN ' + report.grossRevenue.toLocaleString(), color: 'text-amber-400', icon: TrendingUp },
                { label: 'Room Revenue', value: 'NGN ' + report.roomRevenue.toLocaleString(), color: 'text-blue-400', icon: Home },
                { label: 'Total Expenses', value: 'NGN ' + report.totalExpenses.toLocaleString(), color: 'text-red-400', icon: Banknote },
                { label: 'Net Revenue', value: 'NGN ' + report.netRevenue.toLocaleString(), color: 'text-green-400', icon: TrendingUp },
                { label: 'Total Orders', value: report.totalOrders, color: 'text-white', icon: ShoppingBag },
                { label: 'Paid Orders', value: report.paidOrders, color: 'text-green-400', icon: ShoppingBag },
                { label: 'Cancelled Orders', value: report.cancelledOrders, color: 'text-red-400', icon: ShoppingBag },
                { label: 'Avg Order Value', value: 'NGN ' + report.avgOrderValue.toLocaleString(), color: 'text-purple-400', icon: BarChart2 },
              ].map((m, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <m.icon size={15} className={'mb-2 ' + m.color} />
                  <p className="text-gray-400 text-xs">{m.label}</p>
                  <p className={'font-bold text-lg ' + m.color}>{m.value}</p>
                </div>
              ))}
            </div>

            {/* Payment Methods + Order Types */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <CreditCard size={16} className="text-amber-400" /> Payment Methods
                </h3>
                <div className="space-y-3">
                  {[
                    { label: 'Cash', value: report.byPayment.cash, color: 'bg-emerald-500' },
                    { label: 'Bank POS', value: report.byPayment.bank_pos, color: 'bg-blue-500' },
                    { label: 'Bank Transfer', value: report.byPayment.transfer, color: 'bg-purple-500' },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">{item.label}</span>
                        <span className="text-white font-medium">
                          NGN {item.value.toLocaleString()} ({report.grossRevenue ? Math.round(item.value / report.grossRevenue * 100) : 0}%)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className={'h-full ' + item.color + ' rounded-full'}
                          style={{ width: (report.grossRevenue ? item.value / report.grossRevenue * 100 : 0) + '%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <ShoppingBag size={16} className="text-amber-400" /> Order Types
                </h3>
                <div className="space-y-3">
                  {[
                    { label: 'Table Orders', value: report.byOrderType.table, color: 'bg-amber-500' },
                    { label: 'Cash Sales', value: report.byOrderType.cash_sale, color: 'bg-blue-500' },
                    { label: 'Takeaway', value: report.byOrderType.takeaway, color: 'bg-green-500' },
                  ].map(item => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">{item.label}</span>
                        <span className="text-white font-medium">{item.value} orders</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className={'h-full ' + item.color + ' rounded-full'}
                          style={{ width: (report.paidOrders ? item.value / report.paidOrders * 100 : 0) + '%' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Revenue Chart */}
            {chartData && chartData.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={16} className="text-amber-400" />
                  {report.reportType === 'daily' ? 'Hourly Revenue Breakdown' : 'Daily Revenue Breakdown'}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#6b7280', fontSize: 10 }} tickFormatter={v => 'NGN' + (v / 1000).toFixed(0) + 'k'} />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px' }}
                      formatter={v => ['NGN ' + v.toLocaleString(), 'Revenue']} />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Category */}
            {report.byCategory.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold mb-4">Revenue by Category</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={report.byCategory} dataKey="revenue" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                        label={({ name, percent }) => name + ' ' + (percent * 100).toFixed(0) + '%'}>
                        {report.byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={v => ['NGN ' + v.toLocaleString(), 'Revenue']}
                        contentStyle={{ background: '#111827', border: '1px solid #374151', borderRadius: '8px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold mb-3">Category Breakdown</h3>
                  <div className="space-y-2">
                    {report.byCategory.map((cat, i) => (
                      <div key={cat.name} className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ background: COLORS[i % COLORS.length] }} />
                          <span className="text-gray-300 text-sm">{cat.name}</span>
                          <span className="text-gray-600 text-xs">{cat.quantity} sold</span>
                        </div>
                        <span className="text-white font-medium text-sm">NGN {cat.revenue.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Top Items */}
            {report.topItems.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Top Selling Items</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">#</th>
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Item</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Qty</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItems.map((item, i) => (
                      <tr key={item.name} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-gray-500 text-sm">{i + 1}</td>
                        <td className="px-3 py-2.5 text-white text-sm font-medium">{item.name}</td>
                        <td className="px-3 py-2.5 text-right text-amber-400 font-bold">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right text-white text-sm">NGN {item.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Staff */}
            {report.staffPerformance.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Users size={16} className="text-amber-400" /> Staff Performance
                </h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Staff</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Orders</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Revenue</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Avg/Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.staffPerformance.map((s, i) => (
                      <tr key={s.name} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-white text-sm font-medium">
                          <span className="text-amber-400 mr-2">#{i + 1}</span>{s.name}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-sm">{s.orders}</td>
                        <td className="px-3 py-2.5 text-right text-white font-bold text-sm">NGN {s.revenue.toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-sm">NGN {Math.round(s.revenue / s.orders).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Top Tables */}
            {report.tableStats.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Top Tables by Revenue</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Table</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Orders</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.tableStats.map(t => (
                      <tr key={t.table} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-white text-sm">{t.table}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-sm">{t.orders}</td>
                        <td className="px-3 py-2.5 text-right text-amber-400 font-bold text-sm">NGN {t.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Room + Debtors */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Home size={16} className="text-amber-400" /> Room Revenue
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs">Room Stays</p>
                    <p className="text-white font-bold text-2xl">{report.roomStayCount}</p>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs">Revenue</p>
                    <p className="text-amber-400 font-bold text-xl">NGN {report.roomRevenue.toLocaleString()}</p>
                  </div>
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <AlertTriangle size={16} className="text-amber-400" /> Debtor Summary
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs">New Debts</p>
                    <p className="text-white font-bold text-2xl">{report.debtorCount}</p>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs">Outstanding</p>
                    <p className="text-red-400 font-bold text-xl">NGN {report.totalDebt.toLocaleString()}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Expenses */}
            {report.payouts.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Expenses & Payouts</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Date</th>
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Reason</th>
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Category</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payouts.map(p => (
                      <tr key={p.id} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-gray-500 text-xs">{new Date(p.created_at).toLocaleDateString('en-NG')}</td>
                        <td className="px-3 py-2.5 text-white text-sm">{p.reason}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded-lg bg-red-500/20 text-red-400 capitalize">{p.category}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-400 font-bold text-sm">NGN {p.amount?.toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-700">
                      <td colSpan={3} className="px-3 py-2.5 text-white font-bold">Total Expenses</td>
                      <td className="px-3 py-2.5 text-right text-red-400 font-bold">NGN {report.totalExpenses.toLocaleString()}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Till */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4">Till Reconciliation</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Sessions</p>
                  <p className="text-white font-bold text-2xl">{report.tillSessions.length}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Opening Float</p>
                  <p className="text-blue-400 font-bold text-xl">NGN {report.totalOpeningFloat.toLocaleString()}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Closing Float</p>
                  <p className="text-green-400 font-bold text-xl">NGN {report.totalClosingFloat.toLocaleString()}</p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-center">
              <p className="text-gray-500 text-xs">Beeshop's Place · {report.period} Report · Generated {report.generatedAt}</p>
              <p className="text-gray-600 text-xs mt-1">Powered by RestaurantOS</p>
            </div>

          </div>
        )}
      </div>
    </div>
  )
}
