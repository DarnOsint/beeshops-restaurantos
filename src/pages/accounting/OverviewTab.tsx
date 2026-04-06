import { useState, useEffect, useCallback } from 'react'
import {
  TrendingUp,
  DollarSign,
  Banknote,
  CreditCard,
  Smartphone,
  Receipt,
  Plus,
  Save,
  Users,
  AlertTriangle,
  CheckCircle,
  Printer,
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
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import type { AccountingSummary, TrendPoint, WaitronStat } from './types'

interface Props {
  summary: AccountingSummary
  trendData: TrendPoint[]
  totalPayouts: number
  netRevenue: number
  waitronStats: WaitronStat[]
  dateLabel: string
  onRecordPayout: () => void
}

interface Reconciliation {
  cashCollected: Record<string, number> // waitron name → cash collected
  outstanding: Record<string, number> // waitron name → outstanding/shortage for the day
  bankEntries: Record<string, number> // bank name → amount received
  posEntries: Record<string, number> // POS machine → amount received
  debts: Array<{ name: string; amount: number; note: string }>
}

export default function OverviewTab({
  summary,
  trendData,
  totalPayouts,
  netRevenue,
  waitronStats,
  dateLabel,
  onRecordPayout,
}: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [recon, setRecon] = useState<Reconciliation>({
    cashCollected: {},
    outstanding: {},
    bankEntries: {},
    posEntries: {},
    debts: [],
  })
  const [bankAccounts, setBankAccounts] = useState<
    Array<{ id: string; bank_name: string; account_number: string }>
  >([])
  const [posMachines, setPosMachines] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [reconDate, setReconDate] = useState(() => new Date().toISOString().slice(0, 10))
  const activeWaitrons =
    waitronStats.filter((w) => (w.revenue || 0) > 0 || (w.orders || 0) > 0) || waitronStats

  // Load bank accounts and POS machines
  useEffect(() => {
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_number')
      .eq('is_active', true)
      .then(({ data }) => {
        if (data) setBankAccounts(data)
      })
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'pos_machines')
      .single()
      .then(({ data }) => {
        if (data?.value) {
          try {
            setPosMachines(JSON.parse(data.value))
          } catch {
            /* */
          }
        }
      })
  }, [])

  // Load saved reconciliation for the date
  const loadRecon = useCallback(async (d: string) => {
    const { data } = await supabase.from('settings').select('value').eq('id', `recon_${d}`).single()
    if (data?.value) {
      try {
        setRecon(JSON.parse(data.value))
      } catch {
        /* */
      }
    } else {
      setRecon({ cashCollected: {}, outstanding: {}, bankEntries: {}, posEntries: {}, debts: [] })
    }
  }, [])

  useEffect(() => {
    loadRecon(reconDate)
  }, [reconDate, loadRecon])

  const saveRecon = async () => {
    setSaving(true)
    await supabase.from('settings').upsert(
      {
        id: `recon_${reconDate}`,
        value: JSON.stringify(recon),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    audit({ action: 'RECONCILIATION_SAVED', entity: 'settings', entityName: `recon_${reconDate}`, newValue: { totalCash: totalCashCollected, totalBank: totalBankReceived, totalPOS: totalPOSReceived, shortfall }, performer: profile as any })
    setSaving(false)
    toast.success('Saved', 'Reconciliation data saved')
  }

  // Calculations
  const totalCashCollected = Object.values(recon.cashCollected).reduce((s, v) => s + (v || 0), 0)
  const totalBankReceived = Object.values(recon.bankEntries).reduce((s, v) => s + (v || 0), 0)
  const totalPOSReceived = Object.values(recon.posEntries).reduce((s, v) => s + (v || 0), 0)
  const totalDebts = recon.debts.reduce((s, d) => s + (d.amount || 0), 0)
  const totalOutstanding = Object.values(recon.outstanding).reduce((s, v) => s + (v || 0), 0)
  const totalReceived = totalCashCollected + totalBankReceived + totalPOSReceived
  const expectedRevenue = summary.total
  const shortfall = expectedRevenue - totalReceived - totalDebts - totalPayouts

  const printDailySummary = () => {
    const W = 40
    const div = '-'.repeat(W)
    const sol = '='.repeat(W)
    const row = (l: string, r: string) => {
      const left = l.substring(0, W - r.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtDate = new Date(reconDate).toLocaleDateString('en-NG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })
    const lines = [
      '',
      ctr("BEESHOP'S PLACE"),
      ctr('DAILY RECONCILIATION'),
      div,
      row('Date:', fmtDate),
      row('Printed:', new Date().toLocaleString('en-NG')),
      div,
      ctr('SALES SUMMARY'),
      div,
      row('Gross Revenue:', `N${summary.total.toLocaleString()}`),
      row('Net Revenue:', `N${netRevenue.toLocaleString()}`),
      row('Total Orders:', String(summary.orders)),
      row('Avg Order Value:', `N${summary.avgOrder.toLocaleString()}`),
      div,
      ctr('PAYMENT BREAKDOWN'),
      div,
      row('Cash:', `N${summary.cash.toLocaleString()}`),
      row('Bank POS:', `N${summary.card.toLocaleString()}`),
      row('Bank Transfer:', `N${summary.transfer.toLocaleString()}`),
      row('Credit:', `N${summary.credit.toLocaleString()}`),
      row('Split:', `N${summary.split.toLocaleString()}`),
      div,
      ctr('STAFF SALES'),
      div,
      ...waitronStats.map((w) => row(w.name, `N${w.revenue.toLocaleString()} (${w.orders})`)),
      div,
      ctr('CASH COLLECTED'),
      div,
      ...Object.entries(recon.cashCollected)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL CASH:', `N${totalCashCollected.toLocaleString()}`),
      div,
      ctr('OUTSTANDING PER WAITRON'),
      div,
      ...Object.entries(recon.outstanding)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL OUTSTANDING:', `N${totalOutstanding.toLocaleString()}`),
      div,
      ctr('BANK TRANSFERS RECEIVED'),
      div,
      ...Object.entries(recon.bankEntries)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL BANK:', `N${totalBankReceived.toLocaleString()}`),
      div,
      ctr('POS RECEIPTS'),
      div,
      ...Object.entries(recon.posEntries)
        .filter(([, v]) => v > 0)
        .map(([name, amt]) => row(name, `N${amt.toLocaleString()}`)),
      row('TOTAL POS:', `N${totalPOSReceived.toLocaleString()}`),
      div,
      ctr('EXPENSES & PAYOUTS'),
      div,
      row('Total Payouts:', `N${totalPayouts.toLocaleString()}`),
      div,
      ...(recon.debts.length > 0
        ? [
            ctr('OUTSTANDING DEBTS'),
            div,
            ...recon.debts
              .filter((d) => d.amount > 0)
              .map((d) => row(`${d.name}: ${d.note || ''}`, `N${d.amount.toLocaleString()}`)),
            row('TOTAL DEBTS:', `N${totalDebts.toLocaleString()}`),
            div,
          ]
        : []),
      sol,
      ctr('END OF DAY RECONCILIATION'),
      sol,
      row('Total Sales (POS):', `N${expectedRevenue.toLocaleString()}`),
      row('Total Received:', `N${totalReceived.toLocaleString()}`),
      row('Payouts:', `N${totalPayouts.toLocaleString()}`),
      row('Debts:', `N${totalDebts.toLocaleString()}`),
      row('Accounted For:', `N${(totalReceived + totalDebts + totalPayouts).toLocaleString()}`),
      sol,
      row(
        shortfall > 0 ? 'SHORTFALL:' : shortfall < 0 ? 'SURPLUS:' : 'BALANCED:',
        `N${Math.abs(shortfall).toLocaleString()}`
      ),
      sol,
      '',
      ctr('*** END OF REPORT ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Daily Recon — ${fmtDate}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:13px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=800')
    if (!w) return
    w.document.open('text/html', 'replace')
    w.document.write(html)
    w.document.close()
    w.onload = () =>
      setTimeout(() => {
        try {
          w.print()
        } catch {
          /* */
        }
      }, 200)
  }

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
    { label: 'Credit (Pay Later)', value: summary.credit, color: 'bg-amber-500' },
    { label: 'Split Payment', value: summary.split, color: 'bg-cyan-500' },
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

      {/* Staff Sales Summary */}
      {waitronStats.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
            <Users size={16} className="text-amber-400" /> Staff Sales — {dateLabel}
          </h3>
          <div className="space-y-2">
            {waitronStats.map((w) => (
              <div
                key={w.name}
                className="flex items-center justify-between py-1.5 border-b border-gray-800 last:border-0"
              >
                <div>
                  <span className="text-white text-sm font-medium">{w.name}</span>
                  <span className="text-gray-500 text-xs ml-2">{w.orders} orders</span>
                </div>
                <span className="text-amber-400 font-bold">₦{w.revenue.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {/* ═══════════════ DAILY RECONCILIATION ═══════════════ */}
      <div className="bg-gray-900 border border-amber-500/20 rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-amber-400 font-bold flex items-center gap-2">
            <DollarSign size={16} /> Daily Reconciliation
          </h3>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={reconDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setReconDate(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-amber-500"
            />
            <button
              onClick={() => {
                const d = new Date(reconDate)
                d.setDate(d.getDate() - 1)
                setReconDate(d.toISOString().slice(0, 10))
              }}
              className="text-xs px-2 py-1 rounded-lg border border-gray-700 text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700"
            >
              Prev Day
            </button>
            <button
              onClick={() => setReconDate(new Date().toISOString().slice(0, 10))}
              className={`text-xs px-2 py-1 rounded-lg border transition-colors ${reconDate === new Date().toISOString().slice(0, 10) ? 'bg-amber-500 text-black border-amber-500 font-bold' : 'border-gray-700 text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700'}`}
            >
              Today
            </button>
            <button
              onClick={saveRecon}
              disabled={saving}
              className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              <Save size={12} /> {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={printDailySummary}
              className="flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-lg transition-colors"
            >
              <Printer size={12} /> Print
            </button>
          </div>
        </div>

        {/* Cash Collected Per Waitron */}
        <div className="mb-5">
          <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Banknote size={13} className="text-emerald-400" /> Cash Collected from Waitrons
          </h4>
          <p className="text-gray-600 text-xs mb-2">
            Enter the actual cash each waitron handed over
          </p>
          <div className="space-y-1.5">
            {activeWaitrons.map((w) => (
              <div key={w.name} className="flex items-center gap-2">
                <span className="text-gray-400 text-sm w-32 truncate">{w.name}</span>
                <span className="text-gray-600 text-xs w-20">
                  sold ₦{w.revenue.toLocaleString()}
                </span>
                <input
                  type="number"
                  placeholder="₦ collected"
                  value={recon.cashCollected[w.name] || ''}
                  onChange={(e) =>
                    setRecon((prev) => ({
                      ...prev,
                      cashCollected: {
                        ...prev.cashCollected,
                        [w.name]: parseFloat(e.target.value) || 0,
                      },
                    }))
                  }
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            ))}
            <div className="flex justify-between pt-1 border-t border-gray-700">
              <span className="text-gray-400 text-sm font-medium">Total Cash Collected</span>
              <span className="text-emerald-400 font-bold">
                ₦{totalCashCollected.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Outstanding per Waitron */}
        <div className="mb-5">
          <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-red-400" /> Outstanding / Shortage per Waitron
          </h4>
          <p className="text-gray-600 text-xs mb-2">
            Enter shortages for today (8am–8am). Tracked separately; does not affect shortfall math.
          </p>
          <div className="space-y-1.5">
            {activeWaitrons.map((w) => (
              <div key={w.name} className="flex items-center gap-2">
                <span className="text-gray-400 text-sm w-32 truncate">{w.name}</span>
                <input
                  type="number"
                  placeholder="₦ outstanding"
                  value={recon.outstanding[w.name] ?? ''}
                  onChange={(e) =>
                    setRecon((prev) => ({
                      ...prev,
                      outstanding: { ...prev.outstanding, [w.name]: Number(e.target.value) || 0 },
                    }))
                  }
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            ))}
          </div>
          <div className="text-right text-sm text-gray-300 mt-2">
            Total Outstanding:{' '}
            <span className="text-red-400 font-semibold">₦{totalOutstanding.toLocaleString()}</span>
          </div>
        </div>

        {/* Bank Account Entries */}
        <div className="mb-5">
          <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Smartphone size={13} className="text-purple-400" /> Bank Transfer Receipts
          </h4>
          <p className="text-gray-600 text-xs mb-2">How much entered each bank account today</p>
          <div className="space-y-1.5">
            {bankAccounts.map((bank) => (
              <div key={bank.id} className="flex items-center gap-2">
                <span className="text-gray-400 text-sm w-40 truncate">
                  {bank.bank_name} ({bank.account_number.slice(-4)})
                </span>
                <input
                  type="number"
                  placeholder="₦ received"
                  value={recon.bankEntries[bank.bank_name] || ''}
                  onChange={(e) =>
                    setRecon((prev) => ({
                      ...prev,
                      bankEntries: {
                        ...prev.bankEntries,
                        [bank.bank_name]: parseFloat(e.target.value) || 0,
                      },
                    }))
                  }
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-purple-500"
                />
              </div>
            ))}
            {bankAccounts.length === 0 && (
              <p className="text-gray-600 text-xs">No bank accounts configured</p>
            )}
            <div className="flex justify-between pt-1 border-t border-gray-700">
              <span className="text-gray-400 text-sm font-medium">Total Bank Transfers</span>
              <span className="text-purple-400 font-bold">
                ₦{totalBankReceived.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* POS Machine Entries */}
        <div className="mb-5">
          <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
            <CreditCard size={13} className="text-blue-400" /> POS Machine Receipts
          </h4>
          <p className="text-gray-600 text-xs mb-2">How much each POS terminal collected today</p>
          <div className="space-y-1.5">
            {posMachines.map((pos) => (
              <div key={pos} className="flex items-center gap-2">
                <span className="text-gray-400 text-sm w-32 truncate">{pos}</span>
                <input
                  type="number"
                  placeholder="₦ received"
                  value={recon.posEntries[pos] || ''}
                  onChange={(e) =>
                    setRecon((prev) => ({
                      ...prev,
                      posEntries: { ...prev.posEntries, [pos]: parseFloat(e.target.value) || 0 },
                    }))
                  }
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            ))}
            {posMachines.length === 0 && (
              <p className="text-gray-600 text-xs">No POS machines configured</p>
            )}
            <div className="flex justify-between pt-1 border-t border-gray-700">
              <span className="text-gray-400 text-sm font-medium">Total POS</span>
              <span className="text-blue-400 font-bold">₦{totalPOSReceived.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Debts / IOUs */}
        <div className="mb-5">
          <h4 className="text-gray-300 text-sm font-semibold mb-2 flex items-center gap-1.5">
            <AlertTriangle size={13} className="text-red-400" /> Outstanding Debts / IOUs
          </h4>
          <p className="text-gray-600 text-xs mb-2">Record who owes the company and how much</p>
          <div className="space-y-1.5">
            {recon.debts.map((debt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Name"
                  value={debt.name}
                  onChange={(e) => {
                    const updated = [...recon.debts]
                    updated[idx] = { ...updated[idx], name: e.target.value }
                    setRecon((prev) => ({ ...prev, debts: updated }))
                  }}
                  className="w-28 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-red-500"
                />
                <input
                  type="number"
                  placeholder="₦ owed"
                  value={debt.amount || ''}
                  onChange={(e) => {
                    const updated = [...recon.debts]
                    updated[idx] = { ...updated[idx], amount: parseFloat(e.target.value) || 0 }
                    setRecon((prev) => ({ ...prev, debts: updated }))
                  }}
                  className="w-24 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-red-500"
                />
                <input
                  type="text"
                  placeholder="Note"
                  value={debt.note}
                  onChange={(e) => {
                    const updated = [...recon.debts]
                    updated[idx] = { ...updated[idx], note: e.target.value }
                    setRecon((prev) => ({ ...prev, debts: updated }))
                  }}
                  className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-red-500"
                />
                <button
                  onClick={() => {
                    const updated = recon.debts.filter((_, i) => i !== idx)
                    setRecon((prev) => ({ ...prev, debts: updated }))
                  }}
                  className="text-red-400 hover:text-red-300 text-xs px-1"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                setRecon((prev) => ({
                  ...prev,
                  debts: [...prev.debts, { name: '', amount: 0, note: '' }],
                }))
              }
              className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300"
            >
              <Plus size={12} /> Add Debt Entry
            </button>
            <div className="flex justify-between pt-1 border-t border-gray-700">
              <span className="text-gray-400 text-sm font-medium">Total Outstanding Debts</span>
              <span className="text-red-400 font-bold">₦{totalDebts.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* ═══ RECONCILIATION SUMMARY ═══ */}
        <div className="bg-gray-800 rounded-xl p-4 space-y-2">
          <h4 className="text-white font-bold text-sm mb-3">End of Day Summary</h4>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Total Sales (POS)</span>
            <span className="text-white font-bold">₦{expectedRevenue.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Cash Collected</span>
            <span className="text-emerald-400">₦{totalCashCollected.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Bank Transfers</span>
            <span className="text-purple-400">₦{totalBankReceived.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">POS Receipts</span>
            <span className="text-blue-400">₦{totalPOSReceived.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Expenses/Payouts</span>
            <span className="text-red-400">₦{totalPayouts.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Outstanding Debts</span>
            <span className="text-red-400">₦{totalDebts.toLocaleString()}</span>
          </div>
          <div className="border-t-2 border-gray-700 pt-2 mt-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Total Accounted For</span>
              <span className="text-white font-bold">
                ₦{(totalReceived + totalDebts + totalPayouts).toLocaleString()}
              </span>
            </div>
          </div>
          <div className="border-t-2 border-gray-600 pt-2">
            <div className="flex justify-between items-center">
              <span
                className={`font-bold ${shortfall > 0 ? 'text-red-400' : shortfall < 0 ? 'text-green-400' : 'text-green-400'}`}
              >
                {shortfall > 0 ? 'SHORTFALL' : shortfall < 0 ? 'SURPLUS' : 'BALANCED'}
              </span>
              <div className="flex items-center gap-2">
                {shortfall === 0 ? (
                  <CheckCircle size={16} className="text-green-400" />
                ) : (
                  <AlertTriangle
                    size={16}
                    className={shortfall > 0 ? 'text-red-400' : 'text-green-400'}
                  />
                )}
                <span
                  className={`text-xl font-bold ${shortfall > 0 ? 'text-red-400' : shortfall < 0 ? 'text-green-400' : 'text-green-400'}`}
                >
                  ₦{Math.abs(shortfall).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
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
