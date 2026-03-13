import { useState, useRef } from 'react'
import { createPDF, addTable, savePDF } from '../../lib/pdfExport'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useAuth } from '../../context/AuthContext'
import {
  Beer as _Beer,
  LogOut as _LogOut,
  ArrowLeft as _ArrowLeft,
  Download as _Download,
  FileText,
  TrendingUp,
  ShoppingBag,
  Users,
  Banknote,
  CreditCard,
  BarChart2,
  Home,
  AlertTriangle,
  RefreshCw,
  Printer,
} from 'lucide-react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const COLORS = [
  '#f59e0b',
  '#3b82f6',
  '#10b981',
  '#8b5cf6',
  '#ef4444',
  '#06b6d4',
  '#f97316',
  '#84cc16',
]

interface ChartPoint {
  label: string
  revenue: number
  orders: number
}
interface CategoryStat {
  name: string
  revenue: number
  quantity: number
}
interface ItemStat {
  name: string
  quantity: number
  revenue: number
}
interface StaffStat {
  name: string
  orders: number
  revenue: number
}
interface TableStat {
  table: string
  orders: number
  revenue: number
}
interface Payout {
  id: string
  created_at: string
  reason?: string
  category?: string
  amount?: number
}
interface TillSession {
  opened_at: string
  status?: string
  opening_float?: number
  closing_float?: number
}
interface VoidEntry {
  total_value?: number
}
interface AttendanceEntry {
  staff_name?: string
  role?: string
  duration_minutes?: number
}
interface PaidOrder {
  id: string
  total_amount?: number
  payment_method?: string
  order_type?: string
  created_at: string
  profiles?: { full_name?: string } | null
  tables?: { name?: string; table_categories?: { name?: string } | null } | null
}

interface Report {
  period: string
  reportType: string
  generatedAt: string
  grossRevenue: number
  netRevenue: number
  totalExpenses: number
  roomRevenue: number
  totalRevenue: number
  totalOrders: number
  paidOrders: PaidOrder[]
  paidOrdersCount: number
  cancelledOrders: number
  avgOrderValue: number
  byPayment: { cash: number; bank_pos: number; transfer: number }
  byCategory: CategoryStat[]
  topItems: ItemStat[]
  staffPerformance: StaffStat[]
  hourlyData: ChartPoint[]
  dailyBreakdown: ChartPoint[]
  tableStats: TableStat[]
  totalDebt: number
  totalDebtCreated: number
  debtorCount: number
  roomStayCount: number
  totalOpeningFloat: number
  totalClosingFloat: number
  byOrderType: { table: number; cash_sale: number; takeaway: number }
  payouts: Payout[]
  tillSessions: TillSession[]
  voids: VoidEntry[]
  attendance: AttendanceEntry[]
}

export default function Reports() {
  const { profile } = useAuth()
  const printRef = useRef<HTMLDivElement>(null)
  const now = new Date()

  const [reportType, setReportType] = useState('daily')
  const [selectedDay, setSelectedDay] = useState(now.getDate())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth())
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - i)
  const getDaysInMonth = (month: number, year: number) => new Date(year, month + 1, 0).getDate()

  const getDateBounds = () => {
    if (reportType === 'daily' || reportType === 'zreport') {
      return {
        start: new Date(selectedYear, selectedMonth, selectedDay, 0, 0, 0, 0).toISOString(),
        end: new Date(selectedYear, selectedMonth, selectedDay, 23, 59, 59, 999).toISOString(),
      }
    } else if (reportType === 'month') {
      return {
        start: new Date(selectedYear, selectedMonth, 1).toISOString(),
        end: new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59, 999).toISOString(),
      }
    } else {
      return {
        start: new Date(selectedYear, 0, 1).toISOString(),
        end: new Date(selectedYear, 11, 31, 23, 59, 59, 999).toISOString(),
      }
    }
  }

  const getPeriodLabel = () => {
    if (reportType === 'daily' || reportType === 'zreport')
      return `${selectedDay} ${MONTHS[selectedMonth]} ${selectedYear}`
    if (reportType === 'month') return `${MONTHS[selectedMonth]} ${selectedYear}`
    return `Year ${selectedYear}`
  }

  const generateReport = async () => {
    if (reportType === 'zreport') {
      const { start, end } = getDateBounds()
      const { data: openShifts } = await supabase
        .from('attendance')
        .select('*, profiles(full_name)')
        .gte('clock_in', start)
        .lte('clock_in', end)
        .is('clock_out', null)
      if (openShifts && openShifts.length > 0) {
        const names = openShifts
          .map(
            (s: { profiles?: { full_name?: string } | null }) => s.profiles?.full_name || 'Unknown'
          )
          .join(', ')
        alert(
          'Z-Report blocked. The following staff are still clocked in:\n\n' +
            names +
            '\n\nAll staff must be clocked out before running the Z-Report.'
        )
        return
      }
    }
    setLoading(true)
    const { start, end } = getDateBounds()
    const [
      ordersRes,
      orderItemsRes,
      payoutsRes,
      tillRes,
      debtorsRes,
      roomStaysRes,
      voidsRes,
      attendanceRes,
    ] = await Promise.all([
      supabase
        .from('orders')
        .select('*, profiles(full_name), tables(name, table_categories(name))')
        .gte('created_at', start)
        .lte('created_at', end),
      supabase
        .from('order_items')
        .select(
          '*, menu_items(name, price, menu_categories(name, destination)), orders(created_at, status)'
        )
        .gte('created_at', start)
        .lte('created_at', end),
      supabase.from('payouts').select('*').gte('created_at', start).lte('created_at', end),
      supabase
        .from('till_sessions')
        .select('*, profiles(full_name)')
        .gte('opened_at', start)
        .lte('opened_at', end),
      supabase.from('debtors').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('room_stays').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('void_log').select('*').gte('created_at', start).lte('created_at', end),
      supabase.from('attendance').select('*').gte('clock_in', start).lte('clock_in', end),
    ])

    const orders = (ordersRes.data || []) as PaidOrder[]
    const paidOrders = orders
      .filter((o) => o as unknown as { status: string; status: string })
      .filter((o) => (o as unknown as { status: string }).status === 'paid') as PaidOrder[]
    const cancelledOrders = orders.filter(
      (o) => (o as unknown as { status: string }).status === 'cancelled'
    ).length
    const allItems = (orderItemsRes.data || []) as {
      quantity?: number
      total_price?: number
      unit_price?: number
      orders?: { status?: string } | null
      menu_items?: {
        name?: string
        price?: number
        menu_categories?: { name?: string; destination?: string } | null
      } | null
    }[]
    const payouts = (payoutsRes.data || []) as Payout[]
    const tillSessions = (tillRes.data || []) as TillSession[]
    const debtors = (debtorsRes.data || []) as { current_balance?: number; credit_limit?: number }[]
    const roomStays = (roomStaysRes.data || []) as { status?: string; total_amount?: number }[]
    const voids = (voidsRes.data || []) as VoidEntry[]
    const attendance = (attendanceRes.data || []) as AttendanceEntry[]

    const grossRevenue = paidOrders.reduce((s, o) => s + (o.total_amount || 0), 0)
    const totalExpenses = payouts.reduce((s, p) => s + (p.amount || 0), 0)
    const roomRevenue = roomStays
      .filter((r) => r.status === 'checked_out')
      .reduce((s, r) => s + (r.total_amount || 0), 0)
    const byPayment = {
      cash: paidOrders
        .filter((o) => o.payment_method === 'cash')
        .reduce((s, o) => s + (o.total_amount || 0), 0),
      bank_pos: paidOrders
        .filter((o) => ['card', 'bank_pos'].includes(o.payment_method || ''))
        .reduce((s, o) => s + (o.total_amount || 0), 0),
      transfer: paidOrders
        .filter((o) => ['transfer', 'bank_transfer'].includes(o.payment_method || ''))
        .reduce((s, o) => s + (o.total_amount || 0), 0),
    }

    const categoryMap: Record<string, CategoryStat> = {}
    allItems
      .filter((i) => i.orders?.status === 'paid')
      .forEach((item) => {
        const cat = item.menu_items?.menu_categories?.name || 'Unknown'
        if (!categoryMap[cat]) categoryMap[cat] = { name: cat, revenue: 0, quantity: 0 }
        categoryMap[cat].revenue +=
          item.total_price || (item.unit_price || 0) * (item.quantity || 0)
        categoryMap[cat].quantity += item.quantity || 0
      })

    const itemMap: Record<string, ItemStat> = {}
    allItems
      .filter((i) => i.orders?.status === 'paid')
      .forEach((item) => {
        const n = item.menu_items?.name || 'Unknown'
        if (!itemMap[n]) itemMap[n] = { name: n, quantity: 0, revenue: 0 }
        itemMap[n].quantity += item.quantity || 0
        itemMap[n].revenue += item.total_price || 0
      })

    const staffMap: Record<string, StaffStat> = {}
    paidOrders.forEach((o) => {
      const n = o.profiles?.full_name || 'Unknown'
      if (!staffMap[n]) staffMap[n] = { name: n, orders: 0, revenue: 0 }
      staffMap[n].orders++
      staffMap[n].revenue += o.total_amount || 0
    })

    const hourMap: Record<number, ChartPoint> = {}
    for (let i = 0; i < 24; i++) hourMap[i] = { label: `${i}:00`, orders: 0, revenue: 0 }
    paidOrders.forEach((o) => {
      const h = new Date(o.created_at).getHours()
      hourMap[h].orders++
      hourMap[h].revenue += o.total_amount || 0
    })

    const dayMap: Record<string, ChartPoint> = {}
    paidOrders.forEach((o) => {
      const d = new Date(o.created_at).toLocaleDateString('en-NG', {
        month: 'short',
        day: 'numeric',
      })
      if (!dayMap[d]) dayMap[d] = { label: d, revenue: 0, orders: 0 }
      dayMap[d].revenue += o.total_amount || 0
      dayMap[d].orders++
    })

    const tableMap: Record<string, TableStat> = {}
    paidOrders
      .filter((o) => o.tables?.name)
      .forEach((o) => {
        const t = o.tables!.name!
        if (!tableMap[t]) tableMap[t] = { table: t, orders: 0, revenue: 0 }
        tableMap[t].orders++
        tableMap[t].revenue += o.total_amount || 0
      })

    setReport({
      period: getPeriodLabel(),
      reportType,
      generatedAt: new Date().toLocaleString('en-NG'),
      grossRevenue,
      netRevenue: grossRevenue - totalExpenses,
      totalExpenses,
      roomRevenue,
      totalRevenue: grossRevenue + roomRevenue,
      totalOrders: orders.length,
      paidOrders,
      paidOrdersCount: paidOrders.length,
      cancelledOrders,
      avgOrderValue: paidOrders.length ? Math.round(grossRevenue / paidOrders.length) : 0,
      byPayment,
      byCategory: Object.values(categoryMap).sort((a, b) => b.revenue - a.revenue),
      topItems: Object.values(itemMap)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 10),
      staffPerformance: Object.values(staffMap).sort((a, b) => b.revenue - a.revenue),
      hourlyData: Object.values(hourMap).filter((h) => h.orders > 0),
      dailyBreakdown: Object.values(dayMap),
      tableStats: Object.values(tableMap)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
      totalDebt: debtors.reduce((s, d) => s + (d.current_balance || 0), 0),
      totalDebtCreated: debtors.reduce((s, d) => s + (d.credit_limit || 0), 0),
      debtorCount: debtors.length,
      roomStayCount: roomStays.length,
      totalOpeningFloat: tillSessions.reduce((s, t) => s + (t.opening_float || 0), 0),
      totalClosingFloat: tillSessions
        .filter((t) => t.status === 'closed')
        .reduce((s, t) => s + (t.closing_float || 0), 0),
      byOrderType: {
        table: paidOrders.filter(
          (o) => (o as unknown as { order_type?: string }).order_type === 'table'
        ).length,
        cash_sale: paidOrders.filter(
          (o) => (o as unknown as { order_type?: string }).order_type === 'cash_sale'
        ).length,
        takeaway: paidOrders.filter(
          (o) => (o as unknown as { order_type?: string }).order_type === 'takeaway'
        ).length,
      },
      payouts,
      tillSessions,
      voids,
      attendance,
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
      ...report.topItems.map((i) => [i.name, i.quantity, 'NGN ' + i.revenue.toLocaleString()]),
      [],
      ['STAFF PERFORMANCE'],
      ['Staff', 'Orders', 'Revenue'],
      ...report.staffPerformance.map((s) => [
        s.name,
        s.orders,
        'NGN ' + s.revenue.toLocaleString(),
      ]),
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'beeshops-' + report.period.toLowerCase().replace(/ /g, '-') + '.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportReportPDF = (r: Report) => {
    const doc = createPDF(
      (r.reportType === 'daily'
        ? 'Daily'
        : r.reportType === 'month'
          ? 'Monthly'
          : r.reportType === 'zreport'
            ? 'Z-Report'
            : 'Annual') + ' Report',
      r.period + ' — Generated by ' + (profile?.full_name || 'Staff')
    )
    let y = 35
    y = addTable(
      doc,
      ['Metric', 'Value'],
      [
        ['Gross Revenue', '₦' + r.grossRevenue.toLocaleString()],
        ['Room Revenue', '₦' + r.roomRevenue.toLocaleString()],
        ['Total Expenses', '₦' + r.totalExpenses.toLocaleString()],
        ['Net Revenue', '₦' + r.netRevenue.toLocaleString()],
        ['Total Orders', String(r.totalOrders)],
        ['Paid Orders', String(r.paidOrdersCount)],
        ['Avg Order Value', '₦' + r.avgOrderValue.toLocaleString()],
      ],
      y + 2
    )
    if (r.topItems?.length) {
      y += 6
      addTable(
        doc,
        ['Item', 'Qty', 'Revenue'],
        r.topItems
          .slice(0, 10)
          .map((i) => [i.name, String(i.quantity), '₦' + i.revenue.toLocaleString()]),
        y + 2
      )
    }
    savePDF(doc, 'report-' + r.period.replace(/ /g, '-') + '.pdf')
  }

  const chartData = report?.reportType === 'daily' ? report?.hourlyData : report?.dailyBreakdown

  return (
    <div className="min-h-full bg-gray-950">
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 mb-6 print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-bold flex items-center gap-2">
              <FileText size={18} className="text-amber-400" /> Generate Report
            </h2>
            <HelpTooltip
              storageKey="reports"
              tips={[
                {
                  id: 'rep-daily',
                  title: 'Daily Report',
                  description:
                    'Full trading summary for any selected day — total revenue, cash/POS/transfer breakdown, order count, top-selling menu items, per-waitron sales, void log, room stay revenue, and payout deductions.',
                },
                {
                  id: 'rep-monthly',
                  title: 'Monthly Report',
                  description:
                    'Aggregated figures for a full calendar month — total and net revenue, orders, average order value, payment method split, and top items.',
                },
                {
                  id: 'rep-annual',
                  title: 'Annual Report',
                  description:
                    'Year-level performance summary — total revenue, order volume, revenue by category, and monthly breakdown.',
                },
                {
                  id: 'rep-zreport',
                  title: 'Z-Report',
                  description:
                    'The end-of-day trading closure report. All staff must be clocked out before it will run.',
                },
                {
                  id: 'rep-period',
                  title: 'Selecting the Period',
                  description:
                    'For daily and Z-Reports, select the specific day, month, and year. For monthly reports, select month and year.',
                },
                {
                  id: 'rep-export',
                  title: 'Exporting to PDF',
                  description:
                    'After a report is generated, tap Export PDF to download a formatted, printable version.',
                },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Report Type</label>
              <div className="flex gap-2">
                {(
                  [
                    ['daily', 'Daily'],
                    ['month', 'Monthly'],
                    ['year', 'Annual'],
                    ['zreport', 'Z-Report'],
                  ] as const
                ).map(([t, label]) => (
                  <button
                    key={t}
                    onClick={() => setReportType(t)}
                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${reportType === t ? 'bg-amber-500 text-black' : 'bg-gray-800 border border-gray-700 text-gray-400'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {(reportType === 'daily' || reportType === 'month') && (
              <div>
                <label className="text-gray-400 text-xs block mb-1">Month</label>
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
                >
                  {MONTHS.map((m, i) => (
                    <option key={i} value={i}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {reportType === 'daily' && (
              <div>
                <label className="text-gray-400 text-xs block mb-1">Day</label>
                <select
                  value={selectedDay}
                  onChange={(e) => setSelectedDay(parseInt(e.target.value))}
                  className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
                >
                  {Array.from(
                    { length: getDaysInMonth(selectedMonth, selectedYear) },
                    (_, i) => i + 1
                  ).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="text-gray-400 text-xs block mb-1">Year</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-amber-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <button
              onClick={generateReport}
              disabled={loading}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold px-6 py-2 rounded-xl text-sm transition-colors"
            >
              {loading ? <RefreshCw size={15} className="animate-spin" /> : <BarChart2 size={15} />}
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
            {report && (
              <button
                onClick={exportCSV}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-bold px-4 py-2 rounded-xl text-sm border border-gray-700"
              >
                <FileText size={15} /> CSV
              </button>
            )}
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
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h1 className="text-white font-bold text-2xl">
                    {report.reportType === 'daily'
                      ? 'Daily'
                      : report.reportType === 'month'
                        ? 'Monthly'
                        : report.reportType === 'zreport'
                          ? 'Z-Report (End of Day)'
                          : 'Annual'}{' '}
                    Report
                  </h1>
                  <p className="text-amber-400 text-lg font-semibold">{report.period}</p>
                  <p className="text-gray-500 text-xs mt-1">Generated: {report.generatedAt}</p>
                </div>
                <div className="text-right">
                  <p className="text-white font-bold text-3xl">
                    NGN {report.totalRevenue.toLocaleString()}
                  </p>
                  <p className="text-gray-400 text-sm">Total Revenue</p>
                  <button
                    onClick={() => exportReportPDF(report)}
                    className="mt-2 flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl ml-auto"
                  >
                    <Printer size={13} /> Export PDF
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(
                [
                  {
                    label: 'Gross F&B Revenue',
                    value: 'NGN ' + report.grossRevenue.toLocaleString(),
                    color: 'text-amber-400',
                    icon: TrendingUp,
                  },
                  {
                    label: 'Room Revenue',
                    value: 'NGN ' + report.roomRevenue.toLocaleString(),
                    color: 'text-blue-400',
                    icon: Home,
                  },
                  {
                    label: 'Total Expenses',
                    value: 'NGN ' + report.totalExpenses.toLocaleString(),
                    color: 'text-red-400',
                    icon: Banknote,
                  },
                  {
                    label: 'Net Revenue',
                    value: 'NGN ' + report.netRevenue.toLocaleString(),
                    color: 'text-green-400',
                    icon: TrendingUp,
                  },
                  {
                    label: 'Total Orders',
                    value: String(report.totalOrders),
                    color: 'text-white',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Paid Orders',
                    value: String(report.paidOrdersCount),
                    color: 'text-green-400',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Cancelled Orders',
                    value: String(report.cancelledOrders),
                    color: 'text-red-400',
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Avg Order Value',
                    value: 'NGN ' + report.avgOrderValue.toLocaleString(),
                    color: 'text-purple-400',
                    icon: BarChart2,
                  },
                ] as const
              ).map((m, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <m.icon size={15} className={`mb-2 ${m.color}`} />
                  <p className="text-gray-400 text-xs">{m.label}</p>
                  <p className={`font-bold text-lg ${m.color}`}>{m.value}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <CreditCard size={16} className="text-amber-400" /> Payment Methods
                </h3>
                <div className="space-y-3">
                  {(
                    [
                      { label: 'Cash', value: report.byPayment.cash, color: 'bg-emerald-500' },
                      { label: 'Bank POS', value: report.byPayment.bank_pos, color: 'bg-blue-500' },
                      {
                        label: 'Bank Transfer',
                        value: report.byPayment.transfer,
                        color: 'bg-purple-500',
                      },
                    ] as const
                  ).map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">{item.label}</span>
                        <span className="text-white font-medium">
                          NGN {item.value.toLocaleString()} (
                          {report.grossRevenue
                            ? Math.round((item.value / report.grossRevenue) * 100)
                            : 0}
                          %)
                        </span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full`}
                          style={{
                            width:
                              (report.grossRevenue ? (item.value / report.grossRevenue) * 100 : 0) +
                              '%',
                          }}
                        />
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
                  {(
                    [
                      {
                        label: 'Table Orders',
                        value: report.byOrderType.table,
                        color: 'bg-amber-500',
                      },
                      {
                        label: 'Cash Sales',
                        value: report.byOrderType.cash_sale,
                        color: 'bg-blue-500',
                      },
                      {
                        label: 'Takeaway',
                        value: report.byOrderType.takeaway,
                        color: 'bg-green-500',
                      },
                    ] as const
                  ).map((item) => (
                    <div key={item.label}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-400">{item.label}</span>
                        <span className="text-white font-medium">{item.value} orders</span>
                      </div>
                      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full ${item.color} rounded-full`}
                          style={{
                            width:
                              (report.paidOrdersCount
                                ? (item.value / report.paidOrdersCount) * 100
                                : 0) + '%',
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {chartData && chartData.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <TrendingUp size={16} className="text-amber-400" />
                  {report.reportType === 'daily'
                    ? 'Hourly Revenue Breakdown'
                    : 'Daily Revenue Breakdown'}
                </h3>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      tickFormatter={(v: number) => 'NGN' + (v / 1000).toFixed(0) + 'k'}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#111827',
                        border: '1px solid #374151',
                        borderRadius: '8px',
                      }}
                      formatter={(v: number) => ['NGN ' + v.toLocaleString(), 'Revenue']}
                    />
                    <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {report.byCategory.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold mb-4">Revenue by Category</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={report.byCategory}
                        dataKey="revenue"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        label={({ name, percent }: { name: string; percent: number }) =>
                          name + ' ' + (percent * 100).toFixed(0) + '%'
                        }
                      >
                        {report.byCategory.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v: number) => ['NGN ' + v.toLocaleString(), 'Revenue']}
                        contentStyle={{
                          background: '#111827',
                          border: '1px solid #374151',
                          borderRadius: '8px',
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                  <h3 className="text-white font-semibold mb-3">Category Breakdown</h3>
                  <div className="space-y-2">
                    {report.byCategory.map((cat, i) => (
                      <div
                        key={cat.name}
                        className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ background: COLORS[i % COLORS.length] }}
                          />
                          <span className="text-gray-300 text-sm">{cat.name}</span>
                          <span className="text-gray-600 text-xs">{cat.quantity} sold</span>
                        </div>
                        <span className="text-white font-medium text-sm">
                          NGN {cat.revenue.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {report.topItems.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Top Selling Items</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">#</th>
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Item</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">Qty</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.topItems.map((item, i) => (
                      <tr key={item.name} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-gray-500 text-sm">{i + 1}</td>
                        <td className="px-3 py-2.5 text-white text-sm font-medium">{item.name}</td>
                        <td className="px-3 py-2.5 text-right text-amber-400 font-bold">
                          {item.quantity}
                        </td>
                        <td className="px-3 py-2.5 text-right text-white text-sm">
                          NGN {item.revenue.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.staffPerformance.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
                  <Users size={16} className="text-amber-400" /> Staff Performance
                </h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Staff</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Orders
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Revenue
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Avg/Order
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.staffPerformance.map((s, i) => (
                      <tr key={s.name} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-white text-sm font-medium">
                          <span className="text-amber-400 mr-2">#{i + 1}</span>
                          {s.name}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-sm">{s.orders}</td>
                        <td className="px-3 py-2.5 text-right text-white font-bold text-sm">
                          NGN {s.revenue.toLocaleString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-sm">
                          NGN {Math.round(s.revenue / s.orders).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {report.tableStats.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Top Tables by Revenue</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Table</th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Orders
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.tableStats.map((t) => (
                      <tr key={t.table} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-white text-sm">{t.table}</td>
                        <td className="px-3 py-2.5 text-right text-gray-400 text-sm">{t.orders}</td>
                        <td className="px-3 py-2.5 text-right text-amber-400 font-bold text-sm">
                          NGN {t.revenue.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

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
                    <p className="text-amber-400 font-bold text-xl">
                      NGN {report.roomRevenue.toLocaleString()}
                    </p>
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
                    <p className="text-red-400 font-bold text-xl">
                      NGN {report.totalDebt.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {report.payouts.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-white font-semibold mb-4">Expenses & Payouts</h3>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">Date</th>
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                        Reason
                      </th>
                      <th className="text-left text-gray-500 text-xs uppercase px-3 py-2">
                        Category
                      </th>
                      <th className="text-right text-gray-500 text-xs uppercase px-3 py-2">
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.payouts.map((p) => (
                      <tr key={p.id} className="border-b border-gray-800 last:border-0">
                        <td className="px-3 py-2.5 text-gray-500 text-xs">
                          {new Date(p.created_at).toLocaleDateString('en-NG')}
                        </td>
                        <td className="px-3 py-2.5 text-white text-sm">{p.reason}</td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs px-2 py-0.5 rounded-lg bg-red-500/20 text-red-400 capitalize">
                            {p.category}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right text-red-400 font-bold text-sm">
                          NGN {p.amount?.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-700">
                      <td colSpan={3} className="px-3 py-2.5 text-white font-bold">
                        Total Expenses
                      </td>
                      <td className="px-3 py-2.5 text-right text-red-400 font-bold">
                        NGN {report.totalExpenses.toLocaleString()}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-white font-semibold mb-4">Till Reconciliation</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Sessions</p>
                  <p className="text-white font-bold text-2xl">{report.tillSessions.length}</p>
                </div>
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Opening Float</p>
                  <p className="text-blue-400 font-bold text-xl">
                    NGN {report.totalOpeningFloat.toLocaleString()}
                  </p>
                </div>
                <div className="bg-gray-800 rounded-xl p-4">
                  <p className="text-gray-400 text-xs">Closing Float</p>
                  <p className="text-green-400 font-bold text-xl">
                    NGN {report.totalClosingFloat.toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {report.reportType === 'zreport' &&
              (() => {
                const vat = report.grossRevenue * 0.075
                const totalWithVat = report.grossRevenue + vat
                const totalVoids = (report.voids || []).reduce(
                  (s, v) => s + (v.total_value || 0),
                  0
                )
                const cashTotal = report.paidOrders
                  .filter((o) => o.payment_method === 'cash')
                  .reduce((s, o) => s + (o.total_amount || 0), 0)
                const creditTotal = report.paidOrders
                  .filter((o) => o.payment_method === 'credit')
                  .reduce((s, o) => s + (o.total_amount || 0), 0)
                return (
                  <div className="bg-white text-black rounded-2xl overflow-hidden border border-gray-200">
                    <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center justify-between">
                      <span className="font-bold text-gray-800">Z-Report — End of Day</span>
                      <button
                        onClick={() => {
                          const w = window.open('', '_blank', 'width=400,height=700')!
                          const el = document.getElementById('zreport-content')
                          w.document.write(
                            '<html><head><style>body{font-family:monospace;font-size:12px;padding:16px;max-width:80mm}.row{display:flex;justify-content:space-between;margin:3px 0}.divider{border-top:1px dashed #000;margin:8px 0}</style></head><body>' +
                              (el?.innerHTML || '') +
                              '<script>window.onload=function(){window.print()}<\/script></body></html>'
                          )
                          w.document.close()
                        }}
                        className="flex items-center gap-1.5 bg-black text-white text-sm px-4 py-2 rounded-xl"
                      >
                        <Printer size={14} /> Print Z-Report
                      </button>
                    </div>
                    <div
                      id="zreport-content"
                      className="p-6"
                      style={{ fontFamily: 'monospace', fontSize: '13px' }}
                    >
                      <div className="text-center mb-4">
                        <div className="text-xl font-bold tracking-widest">BEESHOP'S PLACE</div>
                        <div className="text-sm">Lounge & Restaurant</div>
                        <div className="text-xs text-gray-500 mt-1">Z-REPORT — END OF DAY</div>
                        <div className="text-xs text-gray-500">{getPeriodLabel()}</div>
                        <div className="text-xs text-gray-400">
                          Printed: {new Date().toLocaleString('en-NG')}
                        </div>
                      </div>
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Sales Summary</div>
                      {(
                        [
                          ['Total Orders', report.paidOrders.length],
                          ['Cancelled Orders', report.cancelledOrders],
                          ['Gross Revenue', '₦' + report.grossRevenue.toLocaleString()],
                          [
                            'VAT Collected (7.5%)',
                            '₦' + vat.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                          ],
                          [
                            'Total incl. VAT',
                            '₦' +
                              totalWithVat.toLocaleString(undefined, { minimumFractionDigits: 2 }),
                          ],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="flex justify-between my-1 text-sm">
                          <span>{label}</span>
                          <span className="font-bold">{value}</span>
                        </div>
                      ))}
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Payment Breakdown</div>
                      {(
                        [
                          ['Cash', '₦' + cashTotal.toLocaleString()],
                          ['Bank POS', '₦' + report.byPayment.bank_pos.toLocaleString()],
                          ['Bank Transfer', '₦' + report.byPayment.transfer.toLocaleString()],
                          ['Credit (Pay Later)', '₦' + creditTotal.toLocaleString()],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="flex justify-between my-1 text-sm">
                          <span>{label}</span>
                          <span>{value}</span>
                        </div>
                      ))}
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Voids & Cancellations</div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Total Voids</span>
                        <span>{(report.voids || []).length}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Value Voided</span>
                        <span className="text-red-600 font-bold">
                          ₦{totalVoids.toLocaleString()}
                        </span>
                      </div>
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Cash Reconciliation</div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Expected in Drawer</span>
                        <span className="font-bold">₦{cashTotal.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm">
                        <span>Expenses/Payouts</span>
                        <span>₦{report.totalExpenses.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between my-1 text-sm font-bold border-t border-gray-300 pt-1 mt-1">
                        <span>Net Cash</span>
                        <span>₦{(cashTotal - report.totalExpenses).toLocaleString()}</span>
                      </div>
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="font-bold text-xs uppercase mb-2">Staff on Shift</div>
                      {(report.attendance || []).length === 0 ? (
                        <div className="text-xs text-gray-500">No attendance records</div>
                      ) : (
                        (report.attendance || []).map((a, i) => (
                          <div key={i} className="flex justify-between my-1 text-xs">
                            <span>
                              {a.staff_name} ({a.role})
                            </span>
                            <span>
                              {a.duration_minutes
                                ? Math.floor(a.duration_minutes / 60) +
                                  'h ' +
                                  (a.duration_minutes % 60) +
                                  'm'
                                : 'Active'}
                            </span>
                          </div>
                        ))
                      )}
                      <div className="border-t border-dashed border-gray-400 my-3" />
                      <div className="mt-6 grid grid-cols-2 gap-8 text-xs text-center">
                        <div>
                          <div className="border-t border-black pt-1 mt-8">Manager Signature</div>
                        </div>
                        <div>
                          <div className="border-t border-black pt-1 mt-8">Cashier Signature</div>
                        </div>
                      </div>
                      <div className="text-center text-xs text-gray-400 mt-4">
                        *** END OF Z-REPORT ***
                      </div>
                    </div>
                  </div>
                )
              })()}

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 text-center">
              <p className="text-gray-500 text-xs">
                Beeshop's Place · {report.period} Report · Generated {report.generatedAt}
              </p>
              <p className="text-gray-600 text-xs mt-1">Powered by RestaurantOS</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
