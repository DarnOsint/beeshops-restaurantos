import { useState, useEffect, useCallback } from 'react'
import { DollarSign, RefreshCw, Save, Plus, Printer, Download, X, UserPlus } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { audit } from '../../../lib/audit'
import type { Profile } from '../../../types'

interface PayrollRow {
  id?: string
  staff_id: string
  staff_name: string
  role: string
  bank_name: string
  account_number: string
  base_salary: number
  outstanding: number
  docking: number
  days_worked: number
  total_days: number
}

const getMonthStr = (offset = 0) => {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const monthLabel = (m: string) => {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo) - 1).toLocaleDateString('en-NG', {
    month: 'long',
    year: 'numeric',
  })
}

const daysInMonth = (m: string) => {
  const [y, mo] = m.split('-')
  return new Date(parseInt(y), parseInt(mo), 0).getDate()
}

export default function PayrollTab() {
  const { profile } = useAuth()
  const toast = useToast()
  const [month, setMonth] = useState(getMonthStr())
  const [rows, setRows] = useState<PayrollRow[]>([])
  const [edited, setEdited] = useState<Record<string, Partial<PayrollRow>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newStaff, setNewStaff] = useState({
    name: '',
    role: 'waitron',
    bank: '',
    account: '',
    salary: '',
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setEdited({})

    const totalDays = daysInMonth(month)
    const monthStart = month + '-01'
    const monthEnd = month + '-' + String(totalDays).padStart(2, '0')

    // Get all staff
    const { data: staff } = await supabase
      .from('profiles')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name')

    // Get attendance for the month
    const { data: attendance } = await supabase
      .from('attendance')
      .select('staff_id, date')
      .gte('date', monthStart)
      .lte('date', monthEnd)

    // Count unique days per staff
    const daysMap: Record<string, Set<string>> = {}
    for (const a of (attendance || []) as Array<{ staff_id: string; date: string }>) {
      if (!daysMap[a.staff_id]) daysMap[a.staff_id] = new Set()
      daysMap[a.staff_id].add(a.date)
    }

    // Get saved payroll for this month
    const { data: payroll } = await supabase.from('payroll').select('*').eq('month', month)

    const payMap: Record<string, any> = {}
    for (const p of (payroll || []) as any[]) {
      payMap[p.staff_id] = p
    }

    // Sum outstanding from daily reconciliation for the month
    const { data: reconEntries } = await supabase
      .from('settings')
      .select('id, value')
      .ilike('id', `recon_${month}-%`)
    const reconOutstanding: Record<string, number> = {}
    for (const entry of (reconEntries || []) as Array<{ id: string; value: string }>) {
      try {
        const recon = JSON.parse(entry.value)
        if (recon.outstanding) {
          for (const [name, amt] of Object.entries(recon.outstanding as Record<string, number>)) {
            if (amt > 0) reconOutstanding[name] = (reconOutstanding[name] || 0) + amt
          }
        }
      } catch {
        /* ignore */
      }
    }

    // Sum UNPAID credit debts per waitron for the month (from debtors table)
    // This respects paid/partial status — paid debts are excluded
    const monthStartISO = new Date(monthStart + 'T08:00:00+01:00').toISOString()
    const monthEndISO = new Date(monthEnd + 'T08:00:00+01:00')
    monthEndISO.setDate(monthEndISO.getDate() + 1)
    const { data: unpaidDebts } = await supabase
      .from('debtors')
      .select('name, current_balance, recorded_by_name')
      .in('status', ['outstanding', 'partial'])
      .in('debt_type', ['credit_order', 'table_order', 'fridge'])
      .gte('created_at', monthStartISO)
      .lt('created_at', monthEndISO.toISOString())
    const creditByStaff: Record<string, number> = {}
    for (const d of (unpaidDebts || []) as any[]) {
      // Use the debtor name (which is the waitron name for credit_order type)
      const name = d.name || 'Unknown'
      creditByStaff[name] = (creditByStaff[name] || 0) + (d.current_balance || 0)
    }

    // Build rows — auto-populate outstanding from reconciliation + credit orders
    const display: PayrollRow[] = (
      (staff || []) as Array<{ id: string; full_name: string; role: string }>
    ).map((s) => {
      const saved = payMap[s.id]
      const autoOutstanding =
        (reconOutstanding[s.full_name] || 0) + (creditByStaff[s.full_name] || 0)
      return {
        id: saved?.id,
        staff_id: s.id,
        staff_name: s.full_name,
        role: saved?.role || s.role || '',
        bank_name: saved?.bank_name || '',
        account_number: saved?.account_number || '',
        base_salary: saved?.base_salary || 0,
        outstanding: (saved?.outstanding || 0) + autoOutstanding,
        docking: saved?.docking || 0,
        days_worked: daysMap[s.id]?.size || 0,
        total_days: totalDays,
      }
    })

    // Include payroll entries for staff who may no longer be active
    for (const p of (payroll || []) as any[]) {
      if (!display.find((r) => r.staff_id === p.staff_id)) {
        display.push({
          id: p.id,
          staff_id: p.staff_id,
          staff_name: p.staff_name,
          role: p.role || '',
          bank_name: p.bank_name || '',
          account_number: p.account_number || '',
          base_salary: p.base_salary || 0,
          outstanding: p.outstanding || 0,
          docking: p.docking || 0,
          days_worked: daysMap[p.staff_id]?.size || 0,
          total_days: totalDays,
        })
      }
    }

    display.sort((a, b) => a.staff_name.localeCompare(b.staff_name))
    setRows(display)
    setLoading(false)
  }, [month])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const getRow = (staffId: string): PayrollRow => {
    const base = rows.find((r) => r.staff_id === staffId)!
    const edits = edited[staffId]
    return { ...base, ...edits }
  }

  const netPay = (r: PayrollRow) => Math.max(0, r.base_salary - r.outstanding - r.docking)

  const updateField = (staffId: string, field: string, value: string | number) => {
    setEdited((prev) => ({ ...prev, [staffId]: { ...(prev[staffId] || {}), [field]: value } }))
  }

  const hasEdits = Object.keys(edited).length > 0

  const saveAll = async () => {
    setSaving(true)
    try {
      let count = 0
      for (const staffId of Object.keys(edited)) {
        const row = getRow(staffId)
        const payload = {
          staff_id: staffId,
          staff_name: row.staff_name,
          role: row.role,
          bank_name: row.bank_name,
          account_number: row.account_number,
          base_salary: row.base_salary,
          outstanding: row.outstanding,
          docking: row.docking,
          month,
          updated_by: profile?.full_name,
          updated_at: new Date().toISOString(),
        }
        const { error } = await supabase
          .from('payroll')
          .upsert(payload, { onConflict: 'staff_id,month' })
        if (error) throw error
        count++
      }

      await audit({
        action: 'PAYROLL_UPDATED',
        entity: 'payroll',
        entityName: `${count} staff for ${monthLabel(month)}`,
        newValue: edited,
        performer: profile as Profile,
      })
      setEdited({})
      toast.success('Saved', `${count} payroll record${count !== 1 ? 's' : ''} updated`)
      await fetchData()
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const addStaff = async () => {
    if (!newStaff.name.trim()) {
      toast.warning('Required', 'Enter staff name')
      return
    }
    setSaving(true)
    try {
      // Create profile
      const { data: existing, error: existingError } = await supabase
        .from('profiles')
        .select('id')
        .eq('full_name', newStaff.name.trim())
        .limit(1)
      if (existingError) throw existingError

      let staffId = existing?.[0]?.id
      if (!staffId) {
        const { data: created, error: createError } = await supabase
          .from('profiles')
          .insert({
            id: crypto.randomUUID(),
            full_name: newStaff.name.trim(),
            role: newStaff.role,
            is_active: true,
          })
          .select('id')
          .single()
        if (createError) throw createError
        staffId = created?.id
      }

      if (!staffId) throw new Error('Unable to create or find staff profile')

      const { error: payrollError } = await supabase.from('payroll').upsert(
        {
          staff_id: staffId,
          staff_name: newStaff.name.trim(),
          role: newStaff.role,
          bank_name: newStaff.bank,
          account_number: newStaff.account,
          base_salary: parseFloat(newStaff.salary) || 0,
          outstanding: 0,
          docking: 0,
          month,
          updated_by: profile?.full_name,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'staff_id,month' }
      )
      if (payrollError) throw payrollError

      await audit({
        action: 'PAYROLL_STAFF_ADDED',
        entity: 'payroll',
        entityName: newStaff.name.trim(),
        newValue: { role: newStaff.role, salary: newStaff.salary },
        performer: profile as Profile,
      })

      setShowAdd(false)
      setNewStaff({ name: '', role: 'waitron', bank: '', account: '', salary: '' })
      toast.success('Added', `${newStaff.name.trim()} added to payroll`)
      await fetchData()
    } catch (err) {
      toast.error('Add failed', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const totalBase = rows.reduce((s, r) => s + getRow(r.staff_id).base_salary, 0)
  const totalOutstanding = rows.reduce((s, r) => s + getRow(r.staff_id).outstanding, 0)
  const totalDocking = rows.reduce((s, r) => s + getRow(r.staff_id).docking, 0)
  const totalNet = rows.reduce((s, r) => s + netPay(getRow(r.staff_id)), 0)

  const exportCsv = () => {
    const lines = [
      [
        'Name',
        'Role',
        'Days Worked',
        'Bank',
        'Account No',
        'Base Salary',
        'Outstanding',
        'Docking',
        'Net Pay',
      ],
      ...rows.map((r) => {
        const m = getRow(r.staff_id)
        return [
          m.staff_name,
          m.role,
          `${m.days_worked}/${m.total_days}`,
          m.bank_name,
          m.account_number,
          String(m.base_salary),
          String(m.outstanding),
          String(m.docking),
          String(netPay(m)),
        ]
      }),
    ]
    const csv = lines.map((r) => r.map((v) => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payroll_${month}.csv`
    a.click()
  }

  const printReport = () => {
    const W = 50
    const div = '-'.repeat(W)
    const r = (l: string, rv: string) => {
      const left = l.substring(0, W - rv.length - 1)
      return left + ' '.repeat(Math.max(1, W - left.length - rv.length)) + rv
    }
    const ctr = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmt = (n: number) => 'N' + n.toLocaleString()
    const lines = [
      '',
      ctr("BEESHOP'S PLACE"),
      ctr('MONTHLY PAYROLL'),
      div,
      r('Month:', monthLabel(month)),
      r('Staff Count:', String(rows.length)),
      div,
      r('Total Base Salary:', fmt(totalBase)),
      r('Total Outstanding:', fmt(totalOutstanding)),
      r('Total Docking:', fmt(totalDocking)),
      r('Total Net Pay:', fmt(totalNet)),
      div,
      '',
      ...rows.map((row) => {
        const m = getRow(row.staff_id)
        return [
          r(m.staff_name, `(${m.role})`),
          r(`  Days: ${m.days_worked}/${m.total_days}`, `Bank: ${m.bank_name || '—'}`),
          r(`  Acct: ${m.account_number || '—'}`, ''),
          r(`  Base: ${fmt(m.base_salary)}`, `Outst: ${fmt(m.outstanding)}`),
          r(`  Dock: ${fmt(m.docking)}`, `NET: ${fmt(netPay(m))}`),
          '',
        ].join('\n')
      }),
      div,
      '',
      ctr('*** END ***'),
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Payroll — ${monthLabel(month)}</title><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Courier New',monospace;font-size:12px;color:#000;background:#fff;width:80mm;padding:4mm;white-space:pre}@media print{body{width:80mm}@page{margin:0;size:80mm auto}}</style></head><body>${lines}</body></html>`
    const w = window.open('', '_blank', 'width=500,height=700,toolbar=no,menubar=no')
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

  const roles = [
    'waitron',
    'kitchen',
    'bar',
    'griller',
    'mixologist',
    'manager',
    'supervisor',
    'accountant',
    'floor_staff',
    'dj',
    'hypeman',
    'games_master',
    'shisha_attendant',
    'apartment_manager',
    'social_media_manager',
  ]

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-white font-bold text-lg flex items-center gap-2">
          <DollarSign size={18} className="text-amber-400" /> Payroll
        </h3>
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => setMonth(getMonthStr(-1))}
          className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white"
        >
          Prev Month
        </button>
        <button
          onClick={() => setMonth(getMonthStr())}
          className={`px-3 py-2 rounded-xl text-xs font-medium ${month === getMonthStr() ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400'}`}
        >
          This Month
        </button>
        <button onClick={fetchData} className="p-2 text-gray-400 hover:text-white">
          <RefreshCw size={14} />
        </button>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white font-bold text-xs px-3 py-2 rounded-xl"
        >
          <UserPlus size={13} /> Add Staff
        </button>
        {hasEdits && (
          <button
            onClick={saveAll}
            disabled={saving}
            className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold text-xs px-4 py-2 rounded-xl"
          >
            <Save size={13} /> {saving ? 'Saving...' : 'Save Changes'}
          </button>
        )}
        {rows.length > 0 && (
          <>
            <button
              onClick={printReport}
              className="flex items-center gap-1 px-3 py-2 bg-gray-800 text-gray-400 hover:text-white rounded-xl text-xs ml-auto"
            >
              <Printer size={12} /> Print
            </button>
            <button
              onClick={exportCsv}
              className="p-2 text-gray-400 hover:text-white bg-gray-800 border border-gray-800 rounded-xl"
            >
              <Download size={14} />
            </button>
          </>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Total Base', value: `₦${totalBase.toLocaleString()}`, color: 'text-white' },
          {
            label: 'Outstanding',
            value: `₦${totalOutstanding.toLocaleString()}`,
            color: totalOutstanding > 0 ? 'text-red-400' : 'text-gray-400',
          },
          {
            label: 'Docking',
            value: `₦${totalDocking.toLocaleString()}`,
            color: totalDocking > 0 ? 'text-amber-400' : 'text-gray-400',
          },
          { label: 'Net Payable', value: `₦${totalNet.toLocaleString()}`, color: 'text-green-400' },
        ].map((k) => (
          <div
            key={k.label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
          >
            <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
            <p className="text-gray-500 text-[9px] uppercase tracking-wider">{k.label}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="text-amber-500 text-center py-8">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12">
          <DollarSign size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">No staff for {monthLabel(month)}</p>
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs min-w-[700px]">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-2 py-2">Role</th>
                <th className="text-center px-2 py-2">Days</th>
                <th className="text-left px-2 py-2">Bank</th>
                <th className="text-left px-2 py-2">Account No</th>
                <th className="text-right px-2 py-2">Base Salary</th>
                <th className="text-right px-2 py-2">Outstanding</th>
                <th className="text-right px-2 py-2">Docking</th>
                <th className="text-right px-3 py-2">Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const m = getRow(row.staff_id)
                const isEdited = !!edited[row.staff_id]
                const net = netPay(m)
                return (
                  <tr
                    key={row.staff_id}
                    className={`border-t border-gray-800 ${isEdited ? 'bg-amber-500/5' : 'hover:bg-gray-800/50'}`}
                  >
                    <td className="text-white px-3 py-2 font-medium">{m.staff_name}</td>
                    <td className="px-1 py-1">
                      <select
                        value={m.role}
                        onChange={(e) => updateField(row.staff_id, 'role', e.target.value)}
                        className="bg-gray-800 border border-gray-700 text-gray-300 rounded px-1 py-1 text-xs w-24 focus:outline-none focus:border-amber-500"
                      >
                        {roles.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center px-2 py-2">
                      <span
                        className={
                          m.days_worked < m.total_days * 0.7 ? 'text-red-400' : 'text-green-400'
                        }
                      >
                        {m.days_worked}
                      </span>
                      <span className="text-gray-600">/{m.total_days}</span>
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={m.bank_name}
                        placeholder="Bank"
                        onChange={(e) => updateField(row.staff_id, 'bank_name', e.target.value)}
                        className="w-20 bg-gray-800 border border-gray-700 text-white rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="text"
                        value={m.account_number}
                        placeholder="Acct No"
                        onChange={(e) =>
                          updateField(row.staff_id, 'account_number', e.target.value)
                        }
                        className="w-24 bg-gray-800 border border-gray-700 text-white rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={m.base_salary || ''}
                        placeholder="0"
                        onChange={(e) =>
                          updateField(row.staff_id, 'base_salary', Number(e.target.value) || 0)
                        }
                        className="w-20 bg-gray-800 border border-gray-700 text-white text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={m.outstanding || ''}
                        placeholder="0"
                        onChange={(e) =>
                          updateField(row.staff_id, 'outstanding', Number(e.target.value) || 0)
                        }
                        className="w-20 bg-gray-800 border border-gray-700 text-red-400 text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-red-500"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        type="number"
                        value={m.docking || ''}
                        placeholder="0"
                        onChange={(e) =>
                          updateField(row.staff_id, 'docking', Number(e.target.value) || 0)
                        }
                        className="w-20 bg-gray-800 border border-gray-700 text-amber-400 text-right rounded px-1 py-1 text-xs focus:outline-none focus:border-amber-500"
                      />
                    </td>
                    <td
                      className={`text-right px-3 py-2 font-bold ${net > 0 ? 'text-green-400' : 'text-gray-500'}`}
                    >
                      ₦{net.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                <td className="text-white px-3 py-2" colSpan={5}>
                  TOTAL ({rows.length} staff)
                </td>
                <td className="text-white text-right px-2 py-2">₦{totalBase.toLocaleString()}</td>
                <td className="text-red-400 text-right px-2 py-2">
                  ₦{totalOutstanding.toLocaleString()}
                </td>
                <td className="text-amber-400 text-right px-2 py-2">
                  ₦{totalDocking.toLocaleString()}
                </td>
                <td className="text-green-400 text-right px-3 py-2">
                  ₦{totalNet.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Add Staff Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-gray-950 border border-gray-800 rounded-2xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-bold">Add Staff to Payroll</h3>
              <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <input
                type="text"
                placeholder="Full Name"
                value={newStaff.name}
                onChange={(e) => setNewStaff((p) => ({ ...p, name: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <select
                value={newStaff.role}
                onChange={(e) => setNewStaff((p) => ({ ...p, role: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              >
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Bank Name"
                value={newStaff.bank}
                onChange={(e) => setNewStaff((p) => ({ ...p, bank: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <input
                type="text"
                placeholder="Account Number"
                value={newStaff.account}
                onChange={(e) => setNewStaff((p) => ({ ...p, account: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <input
                type="number"
                placeholder="Monthly Salary (₦)"
                value={newStaff.salary}
                onChange={(e) => setNewStaff((p) => ({ ...p, salary: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-3 py-2 bg-gray-800 text-gray-300 rounded-xl text-sm"
              >
                Cancel
              </button>
              <button
                onClick={addStaff}
                disabled={saving}
                className="flex-1 px-3 py-2 bg-amber-500 text-black font-bold rounded-xl text-sm hover:bg-amber-400 disabled:opacity-50"
              >
                {saving ? 'Adding...' : 'Add to Payroll'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
