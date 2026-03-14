import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { X, Printer, User, CheckCircle, Loader2 } from 'lucide-react'

const fmt = (n: number | null | undefined) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`
const fmtTime = (ts?: string | null) =>
  ts
    ? new Date(ts).toLocaleTimeString('en-NG', {
        timeZone: 'Africa/Lagos',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : '—'
const fmtDate = (ts?: string | null) =>
  ts
    ? new Date(ts).toLocaleDateString('en-NG', {
        timeZone: 'Africa/Lagos',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '—'
const fmtDuration = (minutes?: number | null) => {
  if (minutes == null) return '—'
  const h = Math.floor(minutes / 60),
    m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

interface ShiftIn {
  staff_id: string
  staff_name: string
  role: string
  clock_in: string
  clock_out?: string | null
  pos_machine?: string | null
}
interface Props {
  shift: ShiftIn | null
  onClose: () => void
  onConfirmClockOut: (shift: ShiftIn) => Promise<void>
}

interface VoidEntry {
  id: string
  total_value?: number
  menu_item_name?: string
  void_type?: string
  approved_by_name?: string
  created_at: string
}
interface OrderItemEntry {
  id: string
  quantity?: number
  unit_price?: number
  total_price?: number
  menu_items?: { name?: string; destination?: string } | null
}
interface OrderEntry {
  id: string
  total_amount?: number
  payment_method?: string
  order_type?: string
  closed_at?: string
  created_at: string
  tables?: { name?: string; table_categories?: { name?: string } | null } | null
  order_items?: OrderItemEntry[]
}
interface SummaryData {
  clockIn: string
  clockOut: string
  durationMinutes: number
  staffName: string
  role: string
  totalOrders: number
  totalSales: number
  cashSales: number
  creditSales: number
  totalVoided: number
  voidCount: number
  paymentBreakdown: Record<string, number>
  typeBreakdown: Record<string, number>
  tablesServed: string[]
  topItems: [string, { qty: number; total: number }][]
  callsResolved: number
  orders: OrderEntry[]
  voids: VoidEntry[]
}

export default function ShiftSummary({ shift, onClose, onConfirmClockOut }: Props) {
  const [data, setData] = useState<SummaryData | null>(null)
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const printRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (shift) loadSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift])

  const loadSummary = async () => {
    if (!shift) return
    setLoading(true)
    const clockOutTime = new Date()
    const durationMinutes = Math.round(
      (clockOutTime.getTime() - new Date(shift.clock_in).getTime()) / 60000
    )

    const [ordersRes, voidsRes, callsRes] = await Promise.all([
      supabase
        .from('orders')
        .select(
          'id, total_amount, payment_method, order_type, closed_at, created_at, tables(name, table_categories(name)), order_items(id, quantity, unit_price, total_price, menu_items(name, destination))'
        )
        .eq('staff_id', shift.staff_id)
        .eq('status', 'paid')
        .gte('closed_at', shift.clock_in)
        .lte('closed_at', clockOutTime.toISOString())
        .order('closed_at', { ascending: true }),
      supabase
        .from('void_log')
        .select('id, total_value, menu_item_name, void_type, approved_by_name, created_at')
        .eq('approved_by', shift.staff_id)
        .gte('created_at', shift.clock_in)
        .lte('created_at', clockOutTime.toISOString()),
      supabase
        .from('waiter_calls')
        .select('id, resolved_at, table_name')
        .eq('waitron_id', shift.staff_id)
        .gte('created_at', shift.clock_in)
        .lte('created_at', clockOutTime.toISOString())
        .not('resolved_at', 'is', null),
    ])

    const ordersArr = (ordersRes.data || []) as OrderEntry[]
    const voidsArr = (voidsRes.data || []) as VoidEntry[]
    const callsArr = callsRes.data || []

    const totalSales = ordersArr.reduce((s, o) => s + (o.total_amount || 0), 0)
    const totalVoided = voidsArr.reduce((s, v) => s + (v.total_value || 0), 0)
    const paymentBreakdown: Record<string, number> = {}
    ordersArr.forEach((o) => {
      const m = o.payment_method || 'unknown'
      paymentBreakdown[m] = (paymentBreakdown[m] || 0) + (o.total_amount || 0)
    })
    const typeBreakdown: Record<string, number> = {}
    ordersArr.forEach((o) => {
      const t = o.order_type || 'table'
      typeBreakdown[t] = (typeBreakdown[t] || 0) + 1
    })
    const tablesServed = [
      ...new Set(ordersArr.map((o) => o.tables?.name).filter(Boolean)),
    ] as string[]
    const itemSales: Record<string, { qty: number; total: number }> = {}
    ordersArr.forEach((o) =>
      o.order_items?.forEach((item) => {
        const n = item.menu_items?.name || 'Unknown'
        if (!itemSales[n]) itemSales[n] = { qty: 0, total: 0 }
        itemSales[n].qty += item.quantity || 0
        itemSales[n].total += item.total_price || 0
      })
    )
    const topItems = Object.entries(itemSales)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 8)
    const cashSales = ordersArr
      .filter((o) => o.payment_method === 'cash')
      .reduce((s, o) => s + (o.total_amount || 0), 0)
    const creditSales = ordersArr
      .filter((o) => o.payment_method === 'credit')
      .reduce((s, o) => s + (o.total_amount || 0), 0)

    setData({
      clockIn: shift.clock_in,
      clockOut: clockOutTime.toISOString(),
      durationMinutes,
      staffName: shift.staff_name,
      role: shift.role,
      totalOrders: ordersArr.length,
      totalSales,
      cashSales,
      creditSales,
      totalVoided,
      voidCount: voidsArr.length,
      paymentBreakdown,
      typeBreakdown,
      tablesServed,
      topItems,
      callsResolved: callsArr.length,
      orders: ordersArr,
      voids: voidsArr,
    })
    setLoading(false)
  }

  const handlePrint = () => {
    const content = printRef.current
    if (!content) return
    const win = window.open('', '_blank', 'width=800,height=900')!
    win.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Shift Summary — ${data?.staffName}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;background:white;padding:20px}h1{font-size:18px;font-weight:800;margin-bottom:2px}h2{font-size:13px;font-weight:700;margin:14px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px;text-transform:uppercase;letter-spacing:.5px}.header{border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:14px}.header .sub{color:#555;font-size:11px;margin-top:2px}.stat{border:1px solid #ddd;border-radius:6px;padding:8px 10px}.stat .val{font-size:18px;font-weight:800}.stat .lbl{font-size:10px;color:#777;text-transform:uppercase}.stat.highlight{background:#0f172a;color:white;border-color:#0f172a}table{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:10px}th{background:#0f172a;color:white;text-align:left;padding:5px 8px;font-size:10px;text-transform:uppercase}td{padding:5px 8px;border-bottom:1px solid #eee}tr:nth-child(even) td{background:#f9f9f9}.footer{margin-top:20px;padding-top:10px;border-top:1px solid #ddd;font-size:10px;color:#888}@media print{body{padding:0}}</style></head><body>${content.innerHTML}</body></html>`
    )
    win.document.close()
    win.focus()
    setTimeout(() => {
      win.print()
      win.close()
    }, 400)
  }

  const handleConfirm = async () => {
    setConfirming(true)
    await onConfirmClockOut(shift!)
    setConfirming(false)
  }

  const paymentLabels: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    transfer: 'Transfer',
    credit: 'Credit Account',
    pos: 'POS Terminal',
    mobile_money: 'Mobile Money',
  }

  if (loading)
    return (
      <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
        <div className="bg-gray-900 rounded-2xl p-8 flex flex-col items-center gap-3">
          <Loader2 size={28} className="text-amber-500 animate-spin" />
          <p className="text-white font-medium">Building shift summary…</p>
          <p className="text-gray-400 text-sm">Counting orders, sales and voids</p>
        </div>
      </div>
    )
  if (!data) return null

  return (
    <div className="fixed inset-0 bg-black/80 z-50 overflow-y-auto">
      <div className="min-h-full flex items-start justify-center px-4 py-6">
        <div className="w-full max-w-2xl bg-gray-950 rounded-3xl overflow-hidden">
          <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
            <div>
              <h2 className="text-white font-bold text-lg">Shift Summary</h2>
              <p className="text-gray-400 text-xs">
                {data.staffName} · {fmtDate(data.clockIn)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl px-4 py-2 text-sm font-medium transition-colors"
              >
                <Printer size={15} /> Print
              </button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-gray-800 rounded-xl text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div ref={printRef} className="px-6 py-5 space-y-6">
            <div className="hidden print:block header">
              <h1>Beeshop's Place — Shift Summary</h1>
              <p className="sub">
                {data.staffName} · {data.role?.charAt(0).toUpperCase() + data.role?.slice(1)} ·{' '}
                {fmtDate(data.clockIn)}
              </p>
            </div>

            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
                  <User size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-bold">{data.staffName}</p>
                  <p className="text-gray-400 text-xs capitalize">{data.role}</p>
                  {shift.pos_machine && (
                    <p className="text-cyan-400 text-xs mt-0.5">🖥 POS: {shift.pos_machine}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Clock In', value: fmtTime(data.clockIn) },
                  { label: 'Clock Out', value: fmtTime(data.clockOut) },
                  { label: 'Duration', value: fmtDuration(data.durationMinutes) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-800 rounded-xl p-3 text-center">
                    <p className="text-white font-bold text-sm">{value}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                Sales Summary
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-amber-500 rounded-2xl p-4">
                  <p className="text-black font-black text-2xl">{fmt(data.totalSales)}</p>
                  <p className="text-black/70 text-xs font-semibold mt-1">Total Sales</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <p className="text-white font-black text-2xl">{data.totalOrders}</p>
                  <p className="text-gray-500 text-xs font-semibold mt-1">Orders Served</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                  <p className="text-green-400 font-bold text-lg">{fmt(data.cashSales)}</p>
                  <p className="text-gray-500 text-xs mt-0.5">Cash</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                  <p className="text-blue-400 font-bold text-lg">{fmt(data.creditSales)}</p>
                  <p className="text-gray-500 text-xs mt-0.5">Credit</p>
                </div>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center">
                  <p
                    className={`font-bold text-lg ${data.totalVoided > 0 ? 'text-red-400' : 'text-gray-500'}`}
                  >
                    {fmt(data.totalVoided)}
                  </p>
                  <p className="text-gray-500 text-xs mt-0.5">Voided</p>
                </div>
              </div>
            </div>

            {Object.keys(data.paymentBreakdown).length > 0 && (
              <div>
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  Payment Methods
                </p>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  {Object.entries(data.paymentBreakdown).map(([method, amount], i) => {
                    const pct =
                      data.totalSales > 0 ? ((amount / data.totalSales) * 100).toFixed(0) : 0
                    return (
                      <div
                        key={method}
                        className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-gray-800' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-2 h-2 rounded-full bg-amber-500" />
                          <p className="text-white text-sm">
                            {paymentLabels[method] || method.replace(/_/g, ' ')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-white font-bold text-sm">{fmt(amount)}</p>
                          <p className="text-gray-500 text-xs">{pct}%</p>
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 bg-gray-800">
                    <p className="text-white font-bold text-sm">Total</p>
                    <p className="text-amber-400 font-black text-sm">{fmt(data.totalSales)}</p>
                  </div>
                </div>
              </div>
            )}

            {data.tablesServed.length > 0 && (
              <div>
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  Tables Served ({data.tablesServed.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {data.tablesServed.map((t) => (
                    <span
                      key={t}
                      className="bg-gray-800 border border-gray-700 text-white text-xs font-medium px-3 py-1.5 rounded-xl"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {data.topItems.length > 0 && (
              <div>
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  Items Sold
                </p>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                  <div className="grid grid-cols-3 bg-gray-800 px-4 py-2">
                    <p className="text-gray-400 text-xs font-semibold">Item</p>
                    <p className="text-gray-400 text-xs font-semibold text-center">Qty</p>
                    <p className="text-gray-400 text-xs font-semibold text-right">Amount</p>
                  </div>
                  {data.topItems.map(([name, stats], i) => (
                    <div
                      key={name}
                      className={`grid grid-cols-3 px-4 py-2.5 ${i !== 0 ? 'border-t border-gray-800' : ''}`}
                    >
                      <p className="text-white text-xs truncate">{name}</p>
                      <p className="text-gray-300 text-xs text-center">{stats.qty}</p>
                      <p className="text-amber-400 text-xs text-right font-medium">
                        {fmt(stats.total)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.voids.length > 0 && (
              <div>
                <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  Voids / Cancellations ({data.voidCount})
                </p>
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl overflow-hidden">
                  {data.voids.map((v, i) => (
                    <div
                      key={v.id}
                      className={`px-4 py-3 ${i !== 0 ? 'border-t border-red-500/10' : ''}`}
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-white text-sm">{v.menu_item_name || 'Item'}</p>
                        <p className="text-red-400 font-bold text-sm">{fmt(v.total_value)}</p>
                      </div>
                      {v.approved_by_name && (
                        <p className="text-gray-500 text-xs mt-0.5">
                          Approved by: {v.approved_by_name}
                        </p>
                      )}
                      <p className="text-gray-600 text-xs mt-0.5">{fmtTime(v.created_at)}</p>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-4 py-2.5 border-t border-red-500/20 bg-red-500/10">
                    <p className="text-red-400 font-bold text-sm">Total Voided</p>
                    <p className="text-red-400 font-black text-sm">{fmt(data.totalVoided)}</p>
                  </div>
                </div>
              </div>
            )}

            <div>
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
                Reconciliation
              </p>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                {(
                  [
                    ['Gross Sales', fmt(data.totalSales), 'text-white', false],
                    [
                      `Voids (${data.voidCount})`,
                      `− ${fmt(data.totalVoided)}`,
                      'text-red-400',
                      false,
                    ],
                    ['Net Sales', fmt(data.totalSales - data.totalVoided), 'text-amber-400', true],
                    ['Cash to Till', fmt(data.cashSales), 'text-green-400', false],
                    ['Credit to Debtors', fmt(data.creditSales), 'text-blue-400', false],
                  ] as const
                ).map(([label, value, color, bold], i) => (
                  <div
                    key={label}
                    className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-gray-800' : ''} ${bold ? 'bg-gray-800' : ''}`}
                  >
                    <p className={`text-sm ${bold ? 'font-bold text-white' : 'text-gray-400'}`}>
                      {label}
                    </p>
                    <p className={`text-sm font-bold ${color}`}>{value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="hidden print:block"
              style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid #ccc' }}
            >
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                <div>
                  <p style={{ fontSize: 10, color: '#888', marginBottom: 28 }}>Waitron Signature</p>
                  <div style={{ borderBottom: '1px solid #111', paddingBottom: 2 }} />
                  <p style={{ fontSize: 10, color: '#888', marginTop: 4 }}>{data.staffName}</p>
                </div>
                <div>
                  <p style={{ fontSize: 10, color: '#888', marginBottom: 28 }}>Manager Sign-off</p>
                  <div style={{ borderBottom: '1px solid #111', paddingBottom: 2 }} />
                  <p style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Name &amp; Date</p>
                </div>
              </div>
            </div>
            <div className="hidden print:block footer">
              <p>Beeshop's Place Lounge · Generated {new Date().toLocaleString('en-NG')}</p>
            </div>
          </div>

          <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex gap-3">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white rounded-2xl px-5 py-3 text-sm font-medium transition-colors"
            >
              <Printer size={16} /> Print Summary
            </button>
            {!shift?.clock_out && (
              <button
                onClick={handleConfirm}
                disabled={confirming}
                className="flex-1 flex items-center justify-center gap-2 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-bold rounded-2xl py-3 text-sm transition-colors"
              >
                {confirming ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Clocking out…
                  </>
                ) : (
                  <>
                    <CheckCircle size={16} /> Confirm Clock Out
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
