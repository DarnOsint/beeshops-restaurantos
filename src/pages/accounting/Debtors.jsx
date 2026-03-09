import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  ArrowLeft, Plus, Search, AlertTriangle, CheckCircle,
  Clock, ChevronDown, ChevronUp, X, Save, CreditCard,
  Phone, Calendar, FileText, Banknote
} from 'lucide-react'

const statusConfig = {
  outstanding: { label: 'Outstanding', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  partial: { label: 'Partial', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  paid: { label: 'Paid', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20' },
}

const debtTypeLabels = {
  table_order: 'Table Order',
  room_stay: 'Room Stay',
  bar_tab: 'Bar Tab',
}

export default function Debtors({ onBack, embedded = false }) {
  const { profile } = useAuth()
  const [debtors, setDebtors] = useState([])
  const [payments, setPayments] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showPaymentModal, setShowPaymentModal] = useState(null)
  const [saving, setSaving] = useState(false)

  const canEdit = ['owner', 'manager'].includes(profile?.role)
  const canPay = ['owner', 'manager', 'accountant'].includes(profile?.role)

  const [form, setForm] = useState({
    name: '', phone: '', email: '',
    debt_type: 'table_order',
    credit_limit: '',
    due_date: '',
    notes: ''
  })

  const [payForm, setPayForm] = useState({
    amount: '', payment_method: 'cash', payment_reference: '', notes: ''
  })

  useEffect(() => { fetchAll() }, [])

  const fetchAll = async () => {
    let query = supabase
      .from('debtors')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false })

    if (profile?.role === 'waitron') {
      query = query.eq('recorded_by', profile.id)
    }

    const { data } = await query
    setDebtors(data || [])

    if (data?.length) {
      const { data: pmts } = await supabase
        .from('debt_payments')
        .select('*')
        .in('debtor_id', data.map(d => d.id))
        .order('created_at', { ascending: false })

      const map = {}
      pmts?.forEach(p => {
        if (!map[p.debtor_id]) map[p.debtor_id] = []
        map[p.debtor_id].push(p)
      })
      setPayments(map)
    }

    setLoading(false)
  }

  const saveDebtor = async () => {
    if (!form.name || !form.credit_limit) return alert('Name and amount are required')
    setSaving(true)
    await supabase.from('debtors').insert({
      name: form.name,
      phone: form.phone,
      email: form.email,
      debt_type: form.debt_type,
      credit_limit: parseFloat(form.credit_limit),
      current_balance: parseFloat(form.credit_limit),
      amount_paid: 0,
      due_date: form.due_date || null,
      notes: form.notes,
      status: 'outstanding',
      is_active: true,
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    })
    await fetchAll()
    setSaving(false)
    setShowAddModal(false)
    setForm({ name: '', phone: '', email: '', debt_type: 'table_order', credit_limit: '', due_date: '', notes: '' })
  }

  const recordPayment = async (debtor) => {
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) return alert('Enter a valid amount')
    const amount = parseFloat(payForm.amount)
    if (amount > debtor.current_balance) return alert('Amount exceeds balance of ' + debtor.current_balance.toLocaleString())
    setSaving(true)

    const newAmountPaid = (debtor.amount_paid || 0) + amount
    const newBalance = debtor.current_balance - amount
    const newStatus = newBalance <= 0 ? 'paid' : 'partial'

    await supabase.from('debt_payments').insert({
      debtor_id: debtor.id,
      amount,
      payment_method: payForm.payment_method,
      payment_reference: payForm.payment_reference,
      notes: payForm.notes,
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    })

    await supabase.from('debtors').update({
      amount_paid: newAmountPaid,
      current_balance: newBalance,
      status: newStatus,
      updated_at: new Date().toISOString()
    }).eq('id', debtor.id)

    await fetchAll()
    setSaving(false)
    setShowPaymentModal(null)
    setPayForm({ amount: '', payment_method: 'cash', payment_reference: '', notes: '' })
  }

  const markPaid = async (debtor) => {
    if (!confirm('Mark ' + debtor.name + ' as fully paid?')) return
    await supabase.from('debtors').update({
      amount_paid: debtor.credit_limit,
      current_balance: 0,
      status: 'paid',
      updated_at: new Date().toISOString()
    }).eq('id', debtor.id)
    fetchAll()
  }

  const isOverdue = (debtor) => {
    if (!debtor.due_date || debtor.status === 'paid') return false
    return new Date(debtor.due_date) < new Date()
  }

  const filtered = debtors.filter(d => {
    const matchSearch = d.name?.toLowerCase().includes(search.toLowerCase()) ||
      d.phone?.includes(search)
    const matchStatus = filterStatus === 'all' || d.status === filterStatus
    return matchSearch && matchStatus
  })

  const totalOutstanding = debtors
    .filter(d => d.status !== 'paid')
    .reduce((sum, d) => sum + (d.current_balance || 0), 0)

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <div className="text-amber-500 animate-pulse">Loading debtors...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950">

      {!embedded && (
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="text-gray-400 hover:text-white">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-white font-bold">Debtor Tracking</h1>
              <p className="text-gray-400 text-xs">
                {debtors.filter(d => d.status !== 'paid').length} active
              </p>
            </div>
          </div>
          {canEdit && (
            <button onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm">
              <Plus size={16} /> Add Debtor
            </button>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-red-400">{debtors.filter(d => d.status === 'outstanding').length}</p>
          <p className="text-gray-500 text-xs mt-0.5">Outstanding</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{debtors.filter(d => d.status === 'partial').length}</p>
          <p className="text-gray-500 text-xs mt-0.5">Partial</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-green-400">{debtors.filter(d => d.status === 'paid').length}</p>
          <p className="text-gray-500 text-xs mt-0.5">Paid</p>
        </div>
      </div>

      <div className="px-4 pb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-gray-400 text-sm">Total outstanding: <span className="text-red-400 font-bold">NGN {totalOutstanding.toLocaleString()}</span></p>
          {embedded && canEdit && (
            <button onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl text-sm">
              <Plus size={14} /> Add
            </button>
          )}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-amber-500" />
        </div>
        <div className="flex gap-2">
          {['all', 'outstanding', 'partial', 'paid'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={"px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition-colors " + (filterStatus === s ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400')}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pb-8 space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No debtors found</div>
        ) : filtered.map(debtor => {
          const cfg = statusConfig[debtor.status] || statusConfig.outstanding
          const overdue = isOverdue(debtor)
          const debtorPayments = payments[debtor.id] || []
          const isExpanded = expandedId === debtor.id
          const pct = debtor.credit_limit > 0 ? Math.round((debtor.amount_paid / debtor.credit_limit) * 100) : 0

          return (
            <div key={debtor.id} className={"bg-gray-900 border rounded-2xl overflow-hidden " + (overdue ? 'border-red-500/40' : 'border-gray-800')}>
              <div className="p-4 cursor-pointer" onClick={() => setExpandedId(isExpanded ? null : debtor.id)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-white font-semibold">{debtor.name}</h3>
                      <span className={"text-xs px-2 py-0.5 rounded-lg " + cfg.bg + " " + cfg.color}>{cfg.label}</span>
                      {overdue && (
                        <span className="text-xs px-2 py-0.5 rounded-lg bg-red-500/20 text-red-400 flex items-center gap-1">
                          <AlertTriangle size={10} /> Overdue
                        </span>
                      )}
                      {debtor.debt_type && (
                        <span className="text-xs px-2 py-0.5 rounded-lg bg-gray-800 text-gray-400">
                          {debtTypeLabels[debtor.debt_type] || debtor.debt_type}
                        </span>
                      )}
                    </div>
                    {debtor.phone && (
                      <p className="text-gray-500 text-xs mt-1 flex items-center gap-1">
                        <Phone size={10} /> {debtor.phone}
                      </p>
                    )}
                    {debtor.due_date && (
                      <p className={"text-xs mt-1 flex items-center gap-1 " + (overdue ? 'text-red-400' : 'text-gray-500')}>
                        <Calendar size={10} /> Due: {new Date(debtor.due_date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-red-400 font-bold">NGN {(debtor.current_balance || 0).toLocaleString()}</p>
                    <p className="text-gray-500 text-xs">of NGN {(debtor.credit_limit || 0).toLocaleString()}</p>
                  </div>
                </div>

                {debtor.credit_limit > 0 && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                      <span>Paid: NGN {(debtor.amount_paid || 0).toLocaleString()}</span>
                      <span>{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className={"h-full rounded-full transition-all " + (pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-500')}
                        style={{ width: pct + '%' }} />
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between mt-2">
                  <p className="text-gray-600 text-xs">Recorded by {debtor.recorded_by_name || 'system'}</p>
                  {isExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}
                </div>
              </div>

              {isExpanded && (
                <div className="border-t border-gray-800">
                  {debtor.status !== 'paid' && canPay && (
                    <div className="px-4 py-3 flex gap-2 border-b border-gray-800">
                      <button
                        onClick={() => { setShowPaymentModal(debtor); setPayForm({ amount: '', payment_method: 'cash', payment_reference: '', notes: '' }) }}
                        className="flex-1 bg-amber-500 hover:bg-amber-400 text-black font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-2">
                        <Banknote size={15} /> Record Payment
                      </button>
                      {canEdit && (
                        <button onClick={() => markPaid(debtor)}
                          className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded-xl text-sm flex items-center justify-center gap-2">
                          <CheckCircle size={15} /> Mark Fully Paid
                        </button>
                      )}
                    </div>
                  )}

                  {debtor.notes && (
                    <div className="px-4 py-3 border-b border-gray-800">
                      <p className="text-gray-500 text-xs flex items-start gap-2">
                        <FileText size={12} className="mt-0.5 shrink-0" />{debtor.notes}
                      </p>
                    </div>
                  )}

                  <div className="px-4 py-3">
                    <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-2">
                      Payment History ({debtorPayments.length})
                    </p>
                    {debtorPayments.length === 0 ? (
                      <p className="text-gray-600 text-xs">No payments yet</p>
                    ) : (
                      <div className="space-y-2">
                        {debtorPayments.map(pmt => (
                          <div key={pmt.id} className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2">
                            <div>
                              <p className="text-white text-sm font-medium">NGN {pmt.amount.toLocaleString()}</p>
                              <p className="text-gray-500 text-xs capitalize">{pmt.payment_method?.replace('_', ' ')} · {pmt.recorded_by_name}</p>
                            </div>
                            <p className="text-gray-500 text-xs">{new Date(pmt.created_at).toLocaleDateString()}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800 max-h-screen overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Add Debtor</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Customer Name *</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="Full name" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Phone</label>
                <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="08xxxxxxxxx" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Debt Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {Object.entries(debtTypeLabels).map(([val, label]) => (
                    <button key={val} onClick={() => setForm({ ...form, debt_type: val })}
                      className={"py-2.5 rounded-xl text-xs font-medium border-2 transition-all " + (form.debt_type === val ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-400')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Amount Owed (NGN) *</label>
                <input type="number" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="0" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Due Date</label>
                <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                  rows={2} className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 resize-none text-sm"
                  placeholder="Any additional notes..." />
              </div>
              <button onClick={saveDebtor} disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2">
                <Save size={16} />{saving ? 'Saving...' : 'Save Debtor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <div>
                <h3 className="text-white font-bold">Record Payment</h3>
                <p className="text-gray-400 text-xs mt-0.5">{showPaymentModal.name} · Balance: NGN {(showPaymentModal.current_balance || 0).toLocaleString()}</p>
              </div>
              <button onClick={() => setShowPaymentModal(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Amount (NGN) *</label>
                <input type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="0" />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Payment Method</label>
                <div className="grid grid-cols-3 gap-2">
                  {[['cash', 'Cash'], ['bank_pos', 'Bank POS'], ['bank_transfer', 'Transfer']].map(([val, label]) => (
                    <button key={val} onClick={() => setPayForm({ ...payForm, payment_method: val })}
                      className={"py-2.5 rounded-xl text-xs font-medium border-2 transition-all " + (payForm.payment_method === val ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-400')}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {payForm.payment_method !== 'cash' && (
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Reference</label>
                  <input value={payForm.payment_reference} onChange={e => setPayForm({ ...payForm, payment_reference: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                    placeholder="Transaction reference" />
                </div>
              )}
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Notes</label>
                <input value={payForm.notes} onChange={e => setPayForm({ ...payForm, notes: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                  placeholder="Optional" />
              </div>
              <button onClick={() => recordPayment(showPaymentModal)} disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2">
                <CreditCard size={16} />{saving ? 'Saving...' : 'Confirm Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
