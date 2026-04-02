import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronUp,
  Beer,
  RefreshCw,
  Trash2,
  Edit3,
  Save,
  X,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const todayStr = () => new Date().toISOString().slice(0, 10)
const UNITS = ['bottles', 'crates', 'cans', 'litres', 'packs', 'cartons', 'pieces'] as const
const isManager = (role?: string) => ['owner', 'manager'].includes(role || '')

interface StockEntry {
  id: string
  date: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold_qty: number
  void_qty: number
  closing_qty: number
  note?: string
  recorded_by?: string
  updated_at?: string
}

interface EnrichedEntry extends StockEntry {
  auto_sold: number
  variance: number
  status: 'ok' | 'warn' | 'alarm' | 'commend'
}

interface Props {
  onBack: () => void
  embedded?: boolean
}

function computeStatus(e: EnrichedEntry): 'ok' | 'warn' | 'alarm' | 'commend' {
  const expected = e.opening_qty + e.received_qty - e.sold_qty - e.void_qty
  const diff = expected - e.closing_qty
  if (e.closing_qty === 0 && e.opening_qty === 0 && e.received_qty === 0) return 'ok'
  if (diff < -0.5) return 'commend' // surplus
  if (diff > 2) return 'alarm' // missing stock
  if (diff > 0.5) return 'warn'
  return 'ok'
}

const statusLabel: Record<string, { text: string; color: string; bg: string }> = {
  ok: { text: 'OK', color: 'text-green-400', bg: 'bg-green-500/20' },
  warn: { text: 'Warn', color: 'text-amber-400', bg: 'bg-amber-500/20' },
  alarm: { text: 'Alarm', color: 'text-red-400', bg: 'bg-red-500/20' },
  commend: { text: 'Surplus', color: 'text-blue-400', bg: 'bg-blue-500/20' },
}

const blankForm = {
  item_name: '',
  unit: 'bottles' as string,
  opening_qty: '',
  received_qty: '',
  void_qty: '0',
  closing_qty: '',
  note: '',
}

export default function BarChillerStock({ onBack, embedded = false }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayStr())
  const [entries, setEntries] = useState<EnrichedEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(blankForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState(blankForm)
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})

  // Load auto-sold quantities from POS (bar destination orders)
  const loadSoldQty = useCallback(async (d: string) => {
    const dayStart = new Date(d)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(d)
    dayEnd.setHours(23, 59, 59, 999)
    const { data } = await supabase
      .from('order_items')
      .select('quantity, menu_items(name)')
      .eq('destination', 'bar')
      .eq('status', 'delivered')
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', dayEnd.toISOString())
    if (!data) return
    const map: Record<string, number> = {}
    for (const item of data as unknown as Array<{
      quantity: number
      menu_items: { name: string } | null
    }>) {
      const name = item.menu_items?.name
      if (name) map[name] = (map[name] || 0) + item.quantity
    }
    setSoldMap(map)
  }, [])

  const loadEntries = useCallback(
    async (d: string) => {
      setLoading(true)
      await loadSoldQty(d)
      const { data } = await supabase
        .from('bar_chiller_stock')
        .select('*')
        .eq('date', d)
        .order('item_name')
      const raw = (data || []) as StockEntry[]
      const enriched: EnrichedEntry[] = raw.map((e) => {
        const auto_sold = soldMap[e.item_name] || 0
        const variance = e.opening_qty + e.received_qty - e.sold_qty - e.void_qty - e.closing_qty
        const enrichedEntry: EnrichedEntry = { ...e, auto_sold, variance, status: 'ok' as const }
        enrichedEntry.status = computeStatus(enrichedEntry) as EnrichedEntry['status']
        return enrichedEntry
      })
      setEntries(enriched)
      setLoading(false)
    },
    [loadSoldQty, soldMap]
  )

  useEffect(() => {
    loadEntries(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date])

  // Re-enrich when soldMap updates
  useEffect(() => {
    setEntries((prev) =>
      prev.map((e) => {
        const auto_sold = soldMap[e.item_name] || 0
        const variance = e.opening_qty + e.received_qty - e.sold_qty - e.void_qty - e.closing_qty
        const enriched: EnrichedEntry = { ...e, auto_sold, variance, status: 'ok' }
        enriched.status = computeStatus(enriched)
        return enriched
      })
    )
  }, [soldMap])

  // Get previous day's closing as today's opening
  const getPreviousClosing = async (itemName: string): Promise<number> => {
    const prevDate = new Date(date)
    prevDate.setDate(prevDate.getDate() - 1)
    const { data } = await supabase
      .from('bar_chiller_stock')
      .select('closing_qty')
      .eq('date', prevDate.toISOString().slice(0, 10))
      .eq('item_name', itemName)
      .limit(1)
      .maybeSingle()
    return (data as { closing_qty: number } | null)?.closing_qty || 0
  }

  // Get menu items for autocomplete
  const [menuNames, setMenuNames] = useState<string[]>([])
  useEffect(() => {
    supabase
      .from('menu_items')
      .select('name, menu_categories(destination)')
      .eq('is_available', true)
      .order('name')
      .then(({ data }) => {
        if (data) {
          const barItems = (
            data as unknown as Array<{
              name: string
              menu_categories: { destination: string } | null
            }>
          )
            .filter((i) => i.menu_categories?.destination === 'bar')
            .map((i) => i.name)
          setMenuNames(barItems)
        }
      })
  }, [])

  const handleAdd = async () => {
    setFormError(null)
    if (!form.item_name.trim()) {
      setFormError('Item name is required.')
      return
    }
    setSaving(true)
    const openingQty =
      parseFloat(form.opening_qty) || (await getPreviousClosing(form.item_name.trim()))
    const { error } = await supabase.from('bar_chiller_stock').insert({
      date,
      item_name: form.item_name.trim(),
      unit: form.unit,
      opening_qty: openingQty,
      received_qty: parseFloat(form.received_qty) || 0,
      sold_qty: soldMap[form.item_name] || 0,
      void_qty: parseFloat(form.void_qty) || 0,
      closing_qty: parseFloat(form.closing_qty) || 0,
      note: form.note.trim() || null,
      recorded_by: profile?.id,
    })
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setForm(blankForm)
    setShowAdd(false)
    loadEntries(date)
  }

  const handleEdit = async (entry: EnrichedEntry) => {
    setSaving(true)
    const { error } = await supabase
      .from('bar_chiller_stock')
      .update({
        opening_qty: parseFloat(editForm.opening_qty) || 0,
        received_qty: parseFloat(editForm.received_qty) || 0,
        void_qty: parseFloat(editForm.void_qty) || 0,
        closing_qty: parseFloat(editForm.closing_qty) || 0,
        note: editForm.note.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
    setSaving(false)
    if (error) {
      toast.error('Error', error.message)
      return
    }
    setEditingId(null)
    loadEntries(date)
  }

  const syncSold = async (entry: EnrichedEntry) => {
    const autoSold = soldMap[entry.item_name] || 0
    await supabase
      .from('bar_chiller_stock')
      .update({ sold_qty: autoSold, updated_at: new Date().toISOString() })
      .eq('id', entry.id)
    loadEntries(date)
    toast.success('Synced', `${entry.item_name} sold updated to ${autoSold}`)
  }

  const deleteEntry = async (id: string) => {
    if (!confirm('Delete this entry?')) return
    await supabase.from('bar_chiller_stock').delete().eq('id', id)
    loadEntries(date)
  }

  const totalReceived = entries.reduce((s, e) => s + e.received_qty, 0)
  const totalSold = entries.reduce((s, e) => s + e.sold_qty, 0)
  const totalVariance = entries.reduce((s, e) => s + e.variance, 0)
  const alarmCount = entries.filter((e) => e.status === 'alarm').length
  const warnCount = entries.filter((e) => e.status === 'warn').length

  const canEdit = isManager(profile?.role) || profile?.role === 'bar'
  const canDelete = isManager(profile?.role)

  const inp =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500'

  return (
    <div className="min-h-full bg-gray-950">
      {/* Header — hidden when embedded in BarKDS tabs */}
      {!embedded && (
        <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-white font-bold">Bar Chiller Stock</h1>
            <p className="text-gray-400 text-xs">
              Daily drink stock register — what came in, what went out
            </p>
          </div>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <button onClick={() => loadEntries(date)} className="text-gray-400 hover:text-white p-2">
            <RefreshCw size={16} />
          </button>
        </div>
      )}

      {/* Embedded date picker when inside KDS */}
      {embedded && (
        <div className="px-6 pt-4 flex items-center gap-3">
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
          <button onClick={() => loadEntries(date)} className="text-gray-400 hover:text-white p-2">
            <RefreshCw size={16} />
          </button>
        </div>
      )}

      <div className="p-6 max-w-3xl mx-auto">
        {/* Dashboard stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {(
            [
              { label: 'Items', value: entries.length, color: 'text-white' },
              { label: 'Received', value: totalReceived, color: 'text-green-400' },
              { label: 'Sold', value: totalSold, color: 'text-blue-400' },
              {
                label: 'Variance',
                value: totalVariance.toFixed(1),
                color: totalVariance > 0.5 ? 'text-red-400' : 'text-green-400',
              },
            ] as const
          ).map(({ label, value, color }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center"
            >
              <p className={`text-xl font-bold ${color}`}>{value}</p>
              <p className="text-gray-500 text-[10px] uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>

        {alarmCount > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-4 text-center">
            <p className="text-red-400 text-sm font-bold">
              {alarmCount} item{alarmCount > 1 ? 's' : ''} with stock alarm — check variance
            </p>
          </div>
        )}
        {warnCount > 0 && !alarmCount && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4 text-center">
            <p className="text-amber-400 text-sm">
              {warnCount} item{warnCount > 1 ? 's' : ''} with minor variance
            </p>
          </div>
        )}

        {/* Add button */}
        {canEdit && (
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-2 mb-4 text-amber-400 hover:text-amber-300 text-sm font-medium"
          >
            <Plus size={16} /> {showAdd ? 'Cancel' : 'Add Chiller Entry'}
          </button>
        )}

        {/* Add form */}
        {showAdd && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4 space-y-3">
            <div>
              <label className="text-gray-400 text-xs block mb-1">Drink Name</label>
              <input
                list="bar-menu-items"
                value={form.item_name}
                onChange={(e) => setForm((p) => ({ ...p, item_name: e.target.value }))}
                placeholder="e.g. Heineken"
                className={inp}
              />
              <datalist id="bar-menu-items">
                {menuNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
                  className={inp}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Opening Stock</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.opening_qty}
                  onChange={(e) => setForm((p) => ({ ...p, opening_qty: e.target.value }))}
                  placeholder="Auto from yesterday"
                  className={inp}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Received from Store</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.received_qty}
                  onChange={(e) => setForm((p) => ({ ...p, received_qty: e.target.value }))}
                  placeholder="0"
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Damaged/Void</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.void_qty}
                  onChange={(e) => setForm((p) => ({ ...p, void_qty: e.target.value }))}
                  placeholder="0"
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Closing Count</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.closing_qty}
                  onChange={(e) => setForm((p) => ({ ...p, closing_qty: e.target.value }))}
                  placeholder="Count now"
                  className={inp}
                />
              </div>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Note (optional)</label>
              <input
                value={form.note}
                onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
                placeholder="e.g. 2 bottles broken"
                className={inp}
              />
            </div>
            {formError && <p className="text-red-400 text-xs">{formError}</p>}
            <button
              onClick={handleAdd}
              disabled={saving}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-2.5 text-sm"
            >
              {saving ? 'Saving...' : 'Save Entry'}
            </button>
          </div>
        )}

        {/* Entries */}
        {loading ? (
          <div className="text-center py-16 text-amber-500">Loading...</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Beer size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No chiller entries for {date}</p>
            <p className="text-gray-600 text-xs mt-1">
              Add what was transferred to the chiller today
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => {
              const isExpanded = expanded === entry.id
              const isEditing = editingId === entry.id
              const st = statusLabel[entry.status]
              const expected =
                entry.opening_qty + entry.received_qty - entry.sold_qty - entry.void_qty

              return (
                <div
                  key={entry.id}
                  className={`bg-gray-900 border rounded-xl overflow-hidden ${
                    entry.status === 'alarm'
                      ? 'border-red-500/40'
                      : entry.status === 'warn'
                        ? 'border-amber-500/30'
                        : 'border-gray-800'
                  }`}
                >
                  <button
                    onClick={() => setExpanded(isExpanded ? null : entry.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.color}`}
                      >
                        {st.text}
                      </span>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-semibold truncate">
                          {entry.item_name}
                        </p>
                        <p className="text-gray-500 text-xs">
                          In: {entry.opening_qty + entry.received_qty} · Sold: {entry.sold_qty} ·
                          Left: {entry.closing_qty}
                          {entry.auto_sold > 0 && entry.auto_sold !== entry.sold_qty && (
                            <span className="text-amber-400 ml-1">(POS: {entry.auto_sold})</span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {entry.variance !== 0 && (
                        <span
                          className={`text-xs font-bold ${entry.variance > 0 ? 'text-red-400' : 'text-blue-400'}`}
                        >
                          {entry.variance > 0 ? '-' : '+'}
                          {Math.abs(entry.variance)}
                        </span>
                      )}
                      {isExpanded ? (
                        <ChevronUp size={14} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-500" />
                      )}
                    </div>
                  </button>

                  {isExpanded && !isEditing && (
                    <div className="px-4 pb-4 border-t border-gray-800 pt-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
                        {(
                          [
                            ['Opening', entry.opening_qty],
                            ['Received', entry.received_qty],
                            ['Sold', entry.sold_qty],
                            ['Void/Damage', entry.void_qty],
                            ['Expected Left', expected.toFixed(1)],
                            ['Actual Count', entry.closing_qty],
                            ['Variance', entry.variance.toFixed(1)],
                            ['Unit', entry.unit],
                          ] as const
                        ).map(([label, value]) => (
                          <div key={label}>
                            <p className="text-gray-600 text-[10px] uppercase">{label}</p>
                            <p className="text-white font-medium">{value}</p>
                          </div>
                        ))}
                      </div>
                      {entry.note && (
                        <p className="text-gray-500 text-xs italic mb-3">Note: {entry.note}</p>
                      )}
                      <div className="flex gap-2">
                        {entry.auto_sold > 0 && entry.auto_sold !== entry.sold_qty && (
                          <button
                            onClick={() => syncSold(entry)}
                            className="flex items-center gap-1 text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 px-2.5 py-1.5 rounded-lg hover:bg-blue-500/30"
                          >
                            <RefreshCw size={11} /> Sync Sold from POS ({entry.auto_sold})
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => {
                              setEditingId(entry.id)
                              setEditForm({
                                item_name: entry.item_name,
                                unit: entry.unit,
                                opening_qty: String(entry.opening_qty),
                                received_qty: String(entry.received_qty),
                                void_qty: String(entry.void_qty),
                                closing_qty: String(entry.closing_qty),
                                note: entry.note || '',
                              })
                            }}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white px-2.5 py-1.5 rounded-lg bg-gray-800"
                          >
                            <Edit3 size={11} /> Edit
                          </button>
                        )}
                        {canDelete && (
                          <button
                            onClick={() => deleteEntry(entry.id)}
                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg bg-red-500/10"
                          >
                            <Trash2 size={11} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {isExpanded && isEditing && (
                    <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {(
                          [
                            ['Opening', 'opening_qty'],
                            ['Received', 'received_qty'],
                            ['Void/Damage', 'void_qty'],
                            ['Closing Count', 'closing_qty'],
                          ] as const
                        ).map(([label, key]) => (
                          <div key={key}>
                            <label className="text-gray-500 text-[10px] uppercase block mb-1">
                              {label}
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              value={editForm[key]}
                              onChange={(e) =>
                                setEditForm((p) => ({ ...p, [key]: e.target.value }))
                              }
                              className={inp}
                            />
                          </div>
                        ))}
                      </div>
                      <input
                        value={editForm.note}
                        onChange={(e) => setEditForm((p) => ({ ...p, note: e.target.value }))}
                        placeholder="Note..."
                        className={inp}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(entry)}
                          disabled={saving}
                          className="flex items-center gap-1 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-xs"
                        >
                          <Save size={12} /> {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex items-center gap-1 bg-gray-800 text-gray-300 px-4 py-2 rounded-xl text-xs"
                        >
                          <X size={12} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
