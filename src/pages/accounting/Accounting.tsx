import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useAuth } from '../../context/AuthContext'
import {
  ShoppingBag,
  AlertTriangle,
  Users,
  DollarSign,
  BarChart2,
  Clock,
  BookOpen,
  Shield,
  TrendingUp,
  Monitor,
  Heart,
  RotateCcw,
  Beer,
  ChefHat,
  ClipboardList,
  CalendarDays,
} from 'lucide-react'

import WaitronOrdersTab from './WaitronOrdersTab'
import StockSummaryTab from './StockSummaryTab'
import AttendanceTab from './AttendanceTab'
import TimesheetTab from './TimesheetTab'
import Debtors from './Debtors'
import OverviewTab from './OverviewTab'
import OrdersTab from './OrdersTab'
import StaffTab from './StaffTab'
import TillTab from './TillTab'
import PayoutsTab from './PayoutsTab'
import TrendsTab from './TrendsTab'
import LedgerTab from './LedgerTab'
import AuditTab from './AuditTab'
import POSReconciliationTab from './POSReconciliationTab'
import TipsTab from './TipsTab'
import ReturnsTab from './ReturnsTab'

import type {
  AccountingSummary,
  WaitronStat,
  TrendPoint,
  LedgerEntry,
  PayoutRow,
  TillSession,
  TimesheetEntry,
  AuditEntry,
} from './types'
import type { Order } from '../../types'

const DATE_RANGES = ['Today', 'Prev Day', 'This Week', 'This Month', 'Custom'] as const
type DateRange = (typeof DATE_RANGES)[number]

const TABS = [
  { id: 'overview', label: 'Overview', icon: BarChart2 },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'staff', label: 'Staff Sales', icon: Users },
  { id: 'attendance', label: 'Attendance', icon: CalendarDays },
  { id: 'timesheet', label: 'Timesheet', icon: Clock },
  { id: 'till', label: 'Till', icon: Clock },
  { id: 'payouts', label: 'Payouts', icon: DollarSign },
  { id: 'tips', label: 'Tips', icon: Heart },
  { id: 'returns', label: 'Returns', icon: RotateCcw },
  { id: 'trends', label: 'Trends', icon: TrendingUp },
  { id: 'debtors', label: 'Outstanding', icon: AlertTriangle },
  { id: 'ledger', label: 'Ledger', icon: BookOpen },
  { id: 'audit', label: 'Audit', icon: Shield },
  { id: 'pos', label: 'POS Recon', icon: Monitor },
  { id: 'waitron_orders', label: 'Waitron Orders', icon: ClipboardList },
  { id: 'bar_stock', label: 'Bar Stock', icon: Beer },
  { id: 'kitchen_stock', label: 'Kitchen Stock', icon: ChefHat },
] as const

export default function Accounting() {
  useAuth()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('overview')
  const [dateRange, setDateRange] = useState<DateRange>('Today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [loading, setLoading] = useState(true)
  const [orderFilter, setOrderFilter] = useState({ status: 'all', type: 'all' })

  // ── Void sub-state (date-specific fetch) ─────────────────────────────────

  // ── Data state ────────────────────────────────────────────────────────────
  const [summary, setSummary] = useState<AccountingSummary>({
    total: 0,
    cash: 0,
    card: 0,
    transfer: 0,
    credit: 0,
    split: 0,
    orders: 0,
    avgOrder: 0,
  })
  const [orders, setOrders] = useState<Order[]>([])
  const [waitronStats, setWaitronStats] = useState<WaitronStat[]>([])
  const [creditByWaitron, setCreditByWaitron] = useState<Record<string, number>>({})
  const [trendData, setTrendData] = useState<TrendPoint[]>([])
  const [tillSessions, setTillSessions] = useState<TillSession[]>([])
  const [timesheet, setTimesheet] = useState<TimesheetEntry[]>([])
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([])
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([])

  // ── Helpers ───────────────────────────────────────────────────────────────
  const getDateBounds = useCallback(() => {
    const now = new Date()
    let start: Date, end: Date

    // Session window: 08:00 previous day → 08:00 today (WAT), resets daily at 8am
    const sessionStart = () => {
      const lagosNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
      const s = new Date(lagosNow)
      s.setHours(8, 0, 0, 0)
      if (lagosNow.getHours() < 8) s.setDate(s.getDate() - 1)
      return s
    }

    if (dateRange === 'Today') {
      start = sessionStart()
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    } else if (dateRange === 'Prev Day') {
      start = sessionStart()
      start.setDate(start.getDate() - 1)
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    } else if (dateRange === 'This Week') {
      start = sessionStart()
      start.setDate(start.getDate() - start.getDay())
      end = new Date(start)
      end.setDate(end.getDate() + 7)
    } else if (dateRange === 'This Month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1)
      start.setHours(8, 0, 0, 0)
      end = sessionStart()
    } else if (dateRange === 'Custom' && customStart && customEnd) {
      start = new Date(customStart)
      start.setHours(8, 0, 0, 0)
      end = new Date(customEnd)
      end.setHours(8, 0, 0, 0)
      end.setDate(end.getDate() + 1)
    } else {
      start = sessionStart()
      end = new Date(start)
      end.setDate(end.getDate() + 1)
    }
    return { start: start.toISOString(), end: end.toISOString() }
  }, [dateRange, customStart, customEnd])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const { start, end } = getDateBounds()

    const [ordersRes, tillRes, payoutsRes, trendRes, timesheetRes, auditRes] = await Promise.all([
      supabase
        .from('orders')
        .select('*, profiles(full_name), tables(name), order_items(*, menu_items(name))')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false }),
      supabase
        .from('till_sessions')
        .select('*, profiles(full_name)')
        .gte('opened_at', start)
        .lte('opened_at', end)
        .order('opened_at', { ascending: false }),
      supabase
        .from('payouts')
        .select('*, profiles(full_name)')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false }),
      supabase
        .from('orders')
        .select('created_at, total_amount')
        .eq('status', 'paid')
        .gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
        .order('created_at', { ascending: true }),
      supabase
        .from('attendance')
        .select('*')
        .gte('clock_in', start)
        .lte('clock_in', end)
        .order('clock_in', { ascending: false }),
      supabase
        .from('audit_log')
        .select('*')
        .gte('created_at', start)
        .lte('created_at', end)
        .order('created_at', { ascending: false })
        .limit(200),
    ])

    const allOrders = (ordersRes.data || []) as Order[]
    const paidOrders = allOrders.filter((o) => o.status === 'paid')

    const netOrderAmount = (o: Order) =>
      (o.order_items || [])
        .filter(
          (i) =>
            !i.return_requested &&
            !i.return_accepted &&
            (i.status || '').toLowerCase() !== 'cancelled'
        )
        .reduce((s, i) => s + (i.total_price || 0), 0)

    const total = paidOrders.reduce((s, o) => s + netOrderAmount(o), 0)
    const byMethod: Record<string, number> = {}
    paidOrders.forEach((o) => {
      const pm = (o.payment_method || '').toLowerCase()
      let key = 'Transfer'
      if (pm === 'cash') key = 'Cash'
      else if (pm === 'card' || pm === 'bank_pos') key = 'Bank POS'
      else if (pm.startsWith('transfer') || !pm) key = 'Transfer'
      else if (pm === 'credit') key = 'Credit'
      else if (pm === 'split') key = 'Split'
      else if (pm.startsWith('cash+transfer')) key = 'Cash + Transfer'
      else if (pm.startsWith('cash+card')) key = 'Cash + POS'
      else if (pm === 'complimentary') key = 'Complimentary'
      byMethod[key] = (byMethod[key] || 0) + netOrderAmount(o)
    })

    setSummary({
      total,
      byMethod,
      orders: paidOrders.length,
      avgOrder: paidOrders.length ? Math.round(total / paidOrders.length) : 0,
    })
    setOrders(allOrders)

    const wMap: Record<string, WaitronStat> = {}
    paidOrders.forEach((o) => {
      const name =
        (o as Order & { profiles?: { full_name: string } }).profiles?.full_name || 'Unknown'
      if (!wMap[name]) wMap[name] = { name, orders: 0, revenue: 0 }
      wMap[name].orders++
      wMap[name].revenue += netOrderAmount(o)
    })
    setWaitronStats(Object.values(wMap).sort((a, b) => b.revenue - a.revenue))

    // Compute credit (pay later) per waitron for auto-outstanding
    const creditMap: Record<string, number> = {}
    paidOrders
      .filter((o) => o.payment_method === 'credit')
      .forEach((o) => {
        const name = (o as Order & { profiles?: { full_name: string } }).profiles?.full_name || 'Unknown'
        creditMap[name] = (creditMap[name] || 0) + netOrderAmount(o)
      })
    setCreditByWaitron(creditMap)

    const dayMap: Record<string, TrendPoint> = {}
    ;(trendRes.data || []).forEach((o) => {
      const day = new Date(o.created_at).toLocaleDateString('en-NG', {
        month: 'short',
        day: 'numeric',
      })
      if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
      dayMap[day].revenue += o.total_amount || 0
      dayMap[day].orders++
    })
    setTrendData(Object.values(dayMap))

    setTillSessions((tillRes.data || []) as TillSession[])
    setTimesheet((timesheetRes.data || []) as TimesheetEntry[])
    setAuditLog((auditRes.data || []) as AuditEntry[])
    setPayouts((payoutsRes.data || []) as PayoutRow[])

    const ledger: LedgerEntry[] = []
    paidOrders.forEach((o) => {
      const ord = o as Order & { profiles?: { full_name: string } }
      ledger.push({
        id: o.id,
        date: o.created_at,
        type: 'credit',
        description:
          (o.payment_method === 'credit' ? '[Pay Later] ' : '') +
          (o.tables?.name || o.order_type || 'Sale'),
        ref: o.id.slice(0, 8).toUpperCase(),
        debit: 0,
        credit: o.total_amount || 0,
        method: o.payment_method ?? null,
        staff: ord.profiles?.full_name ?? null,
        balance: 0,
      })
    })
    ;(payoutsRes.data || []).forEach((p: PayoutRow & { profiles?: { full_name: string } }) => {
      ledger.push({
        id: p.id,
        date: p.created_at,
        type: 'debit',
        description: p.reason || 'Expense',
        ref: p.id.slice(0, 8).toUpperCase(),
        debit: p.amount || 0,
        credit: 0,
        method: p.category,
        staff: p.profiles?.full_name ?? null,
        balance: 0,
      })
    })
    ledger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    let bal = 0
    ledger.forEach((e) => {
      bal += e.credit - e.debit
      e.balance = bal
    })
    setLedgerEntries(ledger.reverse())
    setLoading(false)
  }, [getDateBounds])

  // ── Scroll to top on tab change ───────────────────────────────────────────
  useEffect(() => {
    const _ms = document.getElementById('main-scroll')
    if (_ms) _ms.scrollTop = 0
  }, [activeTab])

  // ── Main data fetch ───────────────────────────────────────────────────────
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
  }, [fetchAll])

  // ── Void log fetch (date-specific) ───────────────────────────────────────

  const totalPayouts = payouts.reduce((s, p) => s + (p.amount || 0), 0)
  const netRevenue = summary.total - totalPayouts
  const paidCount = orders.filter((o) => o.status === 'paid').length

  return (
    <div className="min-h-full bg-gray-950">
      {/* Date Range Picker */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3 flex-wrap">
        <div className="flex gap-1.5 flex-wrap">
          {DATE_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setDateRange(r)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${dateRange === r ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}
            >
              {r}
            </button>
          ))}
        </div>
        {dateRange === 'Custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            />
            <span className="text-gray-500 text-xs">to</span>
            <input
              type="date"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
            />
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-gray-600 text-xs">
            {loading ? 'Loading...' : `${paidCount} paid orders`}
          </span>
          <HelpTooltip
            storageKey="accounting"
            tips={[
              {
                id: 'acc-daterange',
                title: 'Date Range Filter',
                description:
                  'All tabs respect the date range at the top — Today, This Week, This Month, or Custom. Set the range before reading any figures. The Overview, Orders, Voids, Ledger, and Staff tabs all filter to that period.',
              },
              {
                id: 'acc-overview',
                title: 'Overview Tab',
                description:
                  'Gross revenue, net revenue (after payouts), breakdown by payment method (Cash, Bank POS, Transfer, Credit), order count, average order value, and a per-waitron performance table.',
              },
              {
                id: 'acc-orders',
                title: 'Orders Tab',
                description:
                  'Full order list for the period. Filter by status and type. Expand any order to see every item, the waitron, table, payment method, and exact timestamp. Search by table name or waitron.',
              },
              {
                id: 'acc-staff',
                title: 'Staff Tab',
                description:
                  "Per-waitron breakdown — total revenue, orders closed, average order value, and POS machine assigned. Use this at shift close to verify each waitron's sales against their POS terminal's expected total.",
              },
              {
                id: 'acc-till',
                title: 'Till Tab',
                description:
                  'Full log of all till sessions — opening float, total sales collected, payout deductions, expected vs actual closing cash, and any shortfall or surplus. Each session is tied to the manager who opened it.',
              },
              {
                id: 'acc-payouts',
                title: 'Payouts Tab',
                description:
                  'Record cash paid out of the till — expenses, petty cash, advances, or refunds. Each payout requires amount, reason, and category. Search by recipient, reason, or category. Refunds are also logged here.',
              },
              {
                id: 'acc-trends',
                title: 'Trends Tab',
                description:
                  'Revenue and order count charts over the selected period. Identifies peak days, slow periods, and week-on-week patterns.',
              },
              {
                id: 'acc-debtors',
                title: 'Outstanding',
                description:
                  'All outstanding credit sales. Shows who recorded each debt, payments received, and lets you send statements or mark paid.',
              },
              {
                id: 'acc-voids',
                title: 'Voids Tab',
                description:
                  'Date-filtered void log — item name, quantity, value, and which manager PIN authorised it. Each void also deletes the order_items DB row and reduces the order total automatically.',
              },
              {
                id: 'acc-ledger',
                title: 'Ledger Tab',
                description:
                  'Double-entry general ledger — every sale, payout, debtor payment, and room charge recorded as credit or debit with a running balance. Search by description, reference, or type. Exportable to PDF.',
              },
              {
                id: 'acc-audit',
                title: 'Audit Log Tab',
                description:
                  'Tamper-evident log of every system action — logins, order changes, voids, menu edits, staff changes, clock-ins, and settings updates. For the full activity log with filters and CSV export, see Management → Activity tab.',
              },
            ]}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto items-center">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs md:text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4 md:p-6">
        {activeTab === 'overview' && (
          <OverviewTab
            summary={summary}
            trendData={trendData}
            totalPayouts={totalPayouts}
            netRevenue={netRevenue}
            waitronStats={waitronStats}
            dateLabel={dateRange === 'Custom' ? `${customStart} – ${customEnd}` : dateRange}
            sessionDate={getDateBounds().start.slice(0, 10)}
            sessionEndDate={getDateBounds().end.slice(0, 10)}
            dateRangeType={dateRange}
            creditByWaitron={creditByWaitron}
            onRecordPayout={() => setActiveTab('payouts')}
          />
        )}
        {activeTab === 'orders' && (
          <OrdersTab orders={orders} orderFilter={orderFilter} onFilterChange={setOrderFilter} />
        )}
        {activeTab === 'staff' && <StaffTab waitronStats={waitronStats} />}
        {activeTab === 'attendance' && <AttendanceTab />}
        {activeTab === 'timesheet' && <TimesheetTab />}
        {activeTab === 'till' && <TillTab tillSessions={tillSessions} />}
        {activeTab === 'payouts' && (
          <PayoutsTab payouts={payouts} totalPayouts={totalPayouts} onRefresh={fetchAll} />
        )}
        {activeTab === 'trends' && <TrendsTab trendData={trendData} />}
        {activeTab === 'debtors' && (
          <Debtors onBack={() => setActiveTab('overview')} embedded={true} />
        )}

        {activeTab === 'ledger' && (
          <LedgerTab ledgerEntries={ledgerEntries} dateRange={dateRange} />
        )}
        {activeTab === 'audit' && <AuditTab auditLog={auditLog} dateRange={dateRange} />}
        {activeTab === 'pos' && (
          <POSReconciliationTab
            timesheet={timesheet}
            orders={orders}
            dateLabel={dateRange === 'Custom' ? `${customStart} – ${customEnd}` : dateRange}
          />
        )}
        {activeTab === 'tips' &&
          (() => {
            const { start, end } = getDateBounds()
            return (
              <TipsTab
                dateRange={{
                  from: start.slice(0, 10),
                  to: end.slice(0, 10),
                }}
              />
            )
          })()}
        {activeTab === 'returns' &&
          (() => {
            const { start, end } = getDateBounds()
            return (
              <ReturnsTab
                dateRange={{
                  start: start.slice(0, 10),
                  end: end.slice(0, 10),
                }}
              />
            )
          })()}
        {activeTab === 'waitron_orders' && <WaitronOrdersTab />}
        {activeTab === 'bar_stock' && <StockSummaryTab type="bar" />}
        {activeTab === 'kitchen_stock' && <StockSummaryTab type="kitchen" />}
      </div>
    </div>
  )
}
