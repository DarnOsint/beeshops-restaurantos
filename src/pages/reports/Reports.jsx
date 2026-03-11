import { useState, useRef } from 'react'
import { createPDF, addTable, addSummaryRow, savePDF } from '../../lib/pdfExport'
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
    if (reportType === 'daily' || reportType === 'zreport') {
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
    if (reportType === 'daily' || reportType === 'zreport') return `${selectedDay} ${MONTHS[selectedMonth]} ${selectedYear}`
    if (reportType === 'month') return `${MONTHS[selectedMonth]} ${selectedYear}`
    return `Year ${selectedYear}`
  }

  const generateReport = async () => {
    // Z-Report: enforce all staff clocked out
    if (reportType === 'zreport') {
      const { start, end } = getDateBounds()
      const { data: openShifts } = await supabase
        .from('attendance')
        .select('*, profiles(full_name)')
        .gte('clock_in', start)
        .lte('clock_in', end)
        .is('clock_out', null)
      if (openShifts && openShifts.length > 0) {
        const names = openShifts.map(s => s.profiles?.full_name || 'Unknown').join(', ')
        alert('Z-Report blocked. The following staff are still clocked in:\n\n' + names + '\n\nAll staff must be clocked out before running the Z-Report.')
        return
      }
    }
    setLoading(true)
    const { start, end } = getDateBounds()

    const [ordersRes, orderItemsRes, payoutsRes, tillRes, debtorsRes, roomStaysRes, voidsRes, attendanceRes] = await Promise.all([
      supabase.from('orders').select('*, profiles(full_name), tables(name, table_categories(name))').gte('created_at', start).lte('created_at', end),
      supabase.from('order_items').select('*, menu_items(name, price, menu_categories(name, destination)), orders(created_at, status)').gte('created_at', start).lte('created_at', end),
      supabase.from('payouts').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('till_sessions').select('*, profiles(full_name)').gte('opened_at', start).lte('opened_at', end),
      supabase.from('debtors').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('room_stays').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('void_log').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('attendance').select('*').gte('clock_in', start).lte('clock_in', end),
    ])

    const orders = ordersRes.data || []
    const paidOrders = orders.filter(o => o.status === 'paid')
    const cancelledOrders = orders.filter(o => o.status === 'cancelled')
    const allItems = orderItemsRes.data || []
    const payouts = payoutsRes.data || []
    const tillSessions = tillRes.data || []
    const debtors = debtorsRes.data || []
    const roomStays = roomStaysRes.data || []

    const voids = voidsRes.data || []
    const attendance = attendanceRes.data || []
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
      voids,
      attendance,
      generatedAt: new Date().toLocaleString('en-NG'),
      grossRevenue, netRevenue, totalExpenses, roomRevenue, totalRevenue,
      totalOrders: orders.length,
      paidOrders: paidOrders,
      paidOrdersCount: paidOrders.length,
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
      ['Paid Orders', report.paidOrdersCount],
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

  const exportReportPDF = (r) => {
    const doc = createPDF(
      (r.reportType === 'daily' ? 'Daily' : r.reportType === 'month' ? 'Monthly' : r.reportType === 'zreport' ? 'Z-Report' : 'Annual') + ' Report',
      r.period + ' — Generated by ' + (profile?.full_name || 'Staff')
    )
    let y = 35

    // KPI summary
    const kpiData = [
      ['Gross Revenue', '₦' + r.grossRevenue.toLocaleString()],
      ['Room Revenue', '₦' + r.roomRevenue.toLocaleString()],
      ['Total Expenses', '₦' + r.totalExpenses.toLocaleString()],
      ['Net Revenue', '₦' + r.netRevenue.toLocaleString()],
      ['Total Orders', String(r.totalOrders)],
      ['Paid Orders', String(r.paidOrdersCount)],
      ['Cancelled Orders', String(r.cancelledOrders)],
      ['Avg Order Value', '₦' + r.avgOrderValue.toLocaleString()],
    ]
    y = addTable(doc, ['Metric', 'Value'], kpiData, y + 2)

    // Payment breakdown
    if (r.byPayment) {
      y += 6
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0,0,0)
      doc.text('Payment Breakdown', 14, y)
      const payData = [
        ['Cash', '₦' + (r.byPayment.cash||0).toLocaleString()],
        ['Bank POS', '₦' + (r.byPayment.bank_pos||0).toLocaleString()],
        ['Transfer', '₦' + (r.byPayment.transfer||0).toLocaleString()],
      ]
      y = addTable(doc, ['Method', 'Amount'], payData, y + 2)
    }

    // Top sellers
    if (r.topItems?.length) {
      y += 6
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(0,0,0)
      doc.text('Top Selling Items', 14, y)
      const itemData = r.topItems.slice(0,10).map(i => [i.name, String(i.quantity), '₦' + i.revenue.toLocaleString()])
      y = addTable(doc, ['Item', 'Qty', 'Revenue'], itemData, y + 2)
    }

    savePDF(doc, 'report-' + r.period.replace(/ /g,'-') + '.pdf')
  }

  const chartData = report?.reportType === 'daily' ? report?.hourlyData : report?.dailyBreakdown

  return (
    <div className="min-h-screen bg-gray-950">

      

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
                {[['daily','Daily'], ['month','Monthly'], ['year','Annual'], ['zreport','Z-Report']].map(([t, label]) => (
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
                    {report.reportType === 'daily' ? 'Daily' : report.reportType === 'month' ? 'Monthly' : report.reportType === 'zreport' ? 'Z-Report (End of Day)' : 'Annual'} Report
                  </h1>
                  <p className="text-amber-400 text-lg font-semibold">{report.period}</p>
                  <p className="text-gray-500 text-xs mt-1">Generated: {report.generatedAt}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-3xl">NGN {report.totalRevenue.toLocaleString()}</p>
                  <p className="text-gray-400 text-sm">Total Revenue</p>
                  <button onClick={() => exportReportPDF(report)} className="mt-2 flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl ml-auto">
                    <Printer size={13} /> Export PDF
                  </button>
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
                { label: 'Paid Orders', value: report.paidOrdersCount, color: 'text-green-400', icon: ShoppingBag },
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
                          style={{ width: (report.paidOrdersCount ? item.value / report.paidOrdersCount * 100 : 0) + '%' }} />
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

            {/* Z-REPORT */}
        {report && report.reportType === 'zreport' && (() => {
          const vat = report.grossRevenue * 0.075
          const totalWithVat = report.grossRevenue + vat
          const totalVoids = (report.voids || []).reduce((s, v) => s + (v.total_value || 0), 0)
          const cashOrders = report.paidOrders?.filter(o => o.payment_method === 'cash') || []
          const cashTotal = cashOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
          const posTotal = report.byPayment?.bank_pos || 0
          const transferTotal = report.byPayment?.transfer || 0
          const creditTotal = report.paidOrders?.filter(o => o.payment_method === 'credit').reduce((s, o) => s + (o.total_amount || 0), 0) || 0
          const today = new Date().toLocaleString('en-NG')
          return (
            <div className="bg-white text-black rounded-2xl overflow-hidden border border-gray-200">
              {/* Print button */}
              <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                <span className="font-bold text-gray-800">Z-Report — End of Day</span>
                <button onClick={() => {
                  const w = window.open('', '_blank', 'width=400,height=700')
                  w.document.write('<html><head><style>body{font-family:monospace;font-size:12px;padding:16px;max-width:80mm}h2{text-align:center}.row{display:flex;justify-content:space-between;margin:3px 0}.divider{border-top:1px dashed #000;margin:8px 0}.bold{font-weight:bold}.center{text-align:center}</style></head><body>' + document.getElementById('zreport-content').innerHTML + '<script>window.onload=function(){window.print()}</script></body></html>')
                  w.document.close()
                }} className="flex items-center gap-1.5 bg-black text-white text-sm px-4 py-2 rounded-xl">
                  <Printer size={14} /> Print Z-Report
                </button>
              </div>

              <div id="zreport-content" className="p-6" style={{ fontFamily: 'monospace', fontSize: '13px' }}>
                {/* Header */}
                <div className="text-center mb-4">
                  <div className="text-xl font-bold tracking-widest">BEESHOP'S PLACE</div>
                  <div className="text-sm">Lounge & Restaurant</div>
                  <div className="text-xs text-gray-500 mt-1">Z-REPORT — END OF DAY</div>
                  <div className="text-xs text-gray-500">{getPeriodLabel()}</div>
                  <div className="text-xs text-gray-400">Printed: {today}</div>
                </div>

                <div className="border-t border-dashed border-gray-400 my-3" />

                {/* Sales Summary */}
                <div className="font-bold text-xs uppercase mb-2">Sales Summary</div>
                {[
                  ['Total Orders', report.paidOrders?.length || 0],
                  ['Cancelled Orders', report.cancelledOrders?.length || 0],
                  ['Gross Revenue', '₦' + report.grossRevenue.toLocaleString()],
                  ['VAT Collected (7.5%)', '₦' + vat.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})],
                  ['Total incl. VAT', '₦' + totalWithVat.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between my-1 text-sm">
                    <span>{label}</span><span className="font-bold">{value}</span>
                  </div>
                ))}

                <div className="border-t border-dashed border-gray-400 my-3" />

                {/* Payment Breakdown */}
                <div className="font-bold text-xs uppercase mb-2">Payment Breakdown</div>
                {[
                  ['Cash', '₦' + cashTotal.toLocaleString()],
                  ['Bank POS', '₦' + posTotal.toLocaleString()],
                  ['Bank Transfer', '₦' + transferTotal.toLocaleString()],
                  ['Credit (Pay Later)', '₦' + creditTotal.toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between my-1 text-sm">
                    <span>{label}</span><span>{value}</span>
                  </div>
                ))}

                <div className="border-t border-dashed border-gray-400 my-3" />

                {/* Voids */}
                <div className="font-bold text-xs uppercase mb-2">Voids & Cancellations</div>
                <div className="flex justify-between my-1 text-sm">
                  <span>Total Voids</span><span>{(report.voids || []).length}</span>
                </div>
                <div className="flex justify-between my-1 text-sm">
                  <span>Value Voided</span><span className="text-red-600 font-bold">₦{totalVoids.toLocaleString()}</span>
                </div>

                <div className="border-t border-dashed border-gray-400 my-3" />

                {/* Cash Reconciliation */}
                <div className="font-bold text-xs uppercase mb-2">Cash Reconciliation</div>
                <div className="flex justify-between my-1 text-sm">
                  <span>Expected in Drawer</span><span className="font-bold">₦{cashTotal.toLocaleString()}</span>
                </div>
                <div className="flex justify-between my-1 text-sm">
                  <span>Expenses/Payouts</span><span>₦{report.totalExpenses?.toLocaleString()}</span>
                </div>
                <div className="flex justify-between my-1 text-sm font-bold border-t border-gray-300 pt-1 mt-1">
                  <span>Net Cash</span><span>₦{(cashTotal - (report.totalExpenses || 0)).toLocaleString()}</span>
                </div>

                <div className="border-t border-dashed border-gray-400 my-3" />

                {/* Staff on shift */}
                <div className="font-bold text-xs uppercase mb-2">Staff on Shift</div>
                {(report.attendance || []).length === 0 ? (
                  <div className="text-xs text-gray-500">No attendance records</div>
                ) : (report.attendance || []).map((a, i) => (
                  <div key={i} className="flex justify-between my-1 text-xs">
                    <span>{a.staff_name} ({a.role})</span>
                    <span>{a.duration_minutes ? Math.floor(a.duration_minutes/60)+'h '+a.duration_minutes%60+'m' : 'Active'}</span>
                  </div>
                ))}

                <div className="border-t border-dashed border-gray-400 my-3" />

                {/* Signature */}
                <div className="mt-6 grid grid-cols-2 gap-8 text-xs text-center">
                  <div>
                    <div className="border-t border-black pt-1 mt-8">Manager Signature</div>
                  </div>
                  <div>
                    <div className="border-t border-black pt-1 mt-8">Cashier Signature</div>
                  </div>
                </div>

                <div className="text-center text-xs text-gray-400 mt-4">*** END OF Z-REPORT ***</div>
              </div>
            </div>
          )
        })()}

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
