import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  Plus,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  Package,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const today = () => new Date().toISOString().slice(0, 10)

const UNITS = ['portion', 'kg', 'g', 'litre', 'ml', 'piece', 'pack', 'tray', 'bowl', 'cup']

export default function KitchenStock({ onBack }) {
  const { profile } = useAuth()
  const [date, setDate] = useState(today())
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [menuItems, setMenuItems] = useState([])
  const [soldMap, setSoldMap] = useState({}) // item_name → qty sold from orders
  const [expandedId, setExpandedId] = useState(null)
  const [form, setForm] = useState({
    item_name: '',
    unit: 'portion',
    opening_qty: '',
    received_qty: '',
    void_qty: '',
    closing_qty: '',
    note: '',
  })
  const [formError, setFormError] = useState(null)

  // Load kitchen food items from menu for autocomplete
  useEffect(() => {
    supabase
      .from('menu_items')
      .select('name, menu_categories(name)')
      .eq('is_available', true)
      .then(({ data }) => setMenuItems((data || []).map((i) => i.name)))
  }, [])

  // Auto-calculate sold qty from paid orders for selected date
  const loadSoldQty = useCallback(async (d) => {
    const from = `${d}T00:00:00`
    const to = `${d}T23:59:59`
    const { data: orders } = await supabase
      .from('orders')
      .select('id')
      .eq('status', 'paid')
      .gte('created_at', from)
      .lte('created_at', to)

    if (!orders?.length) {
      setSoldMap({})
      return
    }

    const { data: items } = await supabase
      .from('order_items')
      .select('quantity, menu_items(name), destination')
      .in(
        'order_id',
        orders.map((o) => o.id)
      )
      .eq('destination', 'kitchen')

    const map = {}
    ;(items || []).forEach((i) => {
      const name = i.menu_items?.name
      if (name) map[name] = (map[name] || 0) + i.quantity
    })
    setSoldMap(map)
  }, [])

  // Load stock entries for selected date
  const loadEntries = useCallback(
    async (d) => {
      setLoading(true)
      await loadSoldQty(d)
      const { data } = await supabase
        .from('kitchen_stock')
        .select('*')
        .eq('date', d)
        .order('item_name')
      setEntries(data || [])
      setLoading(false)
    },
    [loadSoldQty]
  )

  useEffect(() => {
    loadEntries(date)
  }, [date, loadEntries])

  // Merge sold_qty from orders into entries view
  const enriched = entries
    .map((e) => ({
      ...e,
      auto_sold: soldMap[e.item_name] || 0,
      effective_sold: e.sold_qty > 0 ? e.sold_qty : soldMap[e.item_name] || 0,
    }))
    .map((e) => ({
      ...e,
      computed_variance:
        e.opening_qty + e.received_qty - (e.effective_sold + e.void_qty + e.closing_qty),
    }))

  const totalVariance = enriched.reduce((s, e) => s + (e.computed_variance || 0), 0)
  const hasIssues = enriched.some((e) => Math.abs(e.computed_variance) > 0.01)

  // Save a new entry
  const handleAdd = async () => {
    setFormError(null)
    if (!form.item_name.trim()) {
      setFormError('Item name is required.')
      return
    }
    const opening = parseFloat(form.opening_qty) || 0
    const received = parseFloat(form.received_qty) || 0
    const voids = parseFloat(form.void_qty) || 0
    const closing = parseFloat(form.closing_qty) || 0
    const sold = soldMap[form.item_name] || 0

    setSaving(true)
    const { error } = await supabase.from('kitchen_stock').insert({
      date,
      item_name: form.item_name.trim(),
      unit: form.unit,
      opening_qty: opening,
      received_qty: received,
      sold_qty: sold,
      void_qty: voids,
      closing_qty: closing,
      note: form.note.trim() || null,
      recorded_by: profile?.id,
    })
    setSaving(false)
    if (error) {
      setFormError(error.message)
      return
    }
    setForm({
      item_name: '',
      unit: 'portion',
      opening_qty: '',
      received_qty: '',
      void_qty: '',
      closing_qty: '',
      note: '',
    })
    setShowAdd(false)
    loadEntries(date)
  }

  // Update closing qty inline
  const updateClosing = async (id, val) => {
    await supabase
      .from('kitchen_stock')
      .update({
        closing_qty: parseFloat(val) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    loadEntries(date)
  }

  // Update void qty inline
  const updateVoid = async (id, val) => {
    await supabase
      .from('kitchen_stock')
      .update({
        void_qty: parseFloat(val) || 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    loadEntries(date)
  }

  // Sync sold qty from orders
  const syncSold = async (entry) => {
    const sold = soldMap[entry.item_name] || 0
    await supabase
      .from('kitchen_stock')
      .update({
        sold_qty: sold,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
    loadEntries(date)
  }

  // Delete entry
  const deleteEntry = async (id) => {
    if (!confirm('Delete this stock entry?')) return
    await supabase.from('kitchen_stock').delete().eq('id', id)
    loadEntries(date)
  }

  const varianceColor = (v) => {
    if (Math.abs(v) < 0.01) return 'text-green-400'
    if (v > 0) return 'text-amber-400' // surplus — unusual
    return 'text-red-400' // deficit — potential theft/waste
  }

  const varianceBg = (v) => {
    if (Math.abs(v) < 0.01) return 'border-gray-800'
    if (v > 0) return 'border-amber-500/40'
    return 'border-red-500/40'
  }

  return (
    <div className="min-h-screen bg-gray-950 pb-24">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-800 transition-colors">
            <ArrowLeft size={20} className="text-gray-400" />
          </button>
          <div className="flex-1">
            <h1 className="text-white font-bold text-base leading-tight">Kitchen Stock Register</h1>
            <p className="text-gray-500 text-xs">Received · Sold · Remaining · Variance</p>
          </div>
          <button onClick={() => loadEntries(date)} className="p-2 rounded-xl hover:bg-gray-800">
            <RefreshCw size={16} className="text-gray-400" />
          </button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Date picker + summary bar */}
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-3 py-2 flex-1 focus:outline-none focus:border-amber-500"
          />
          <div
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${hasIssues ? 'bg-red-500/10 border-red-500/30' : 'bg-green-500/10 border-green-500/30'}`}
          >
            {hasIssues ? (
              <AlertTriangle size={14} className="text-red-400" />
            ) : (
              <CheckCircle size={14} className="text-green-400" />
            )}
            <span
              className={`text-xs font-medium ${hasIssues ? 'text-red-400' : 'text-green-400'}`}
            >
              {hasIssues ? 'Variance detected' : 'All balanced'}
            </span>
          </div>
        </div>

        {/* Summary row */}
        {enriched.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Items tracked', value: enriched.length },
              {
                label: 'Total received',
                value: enriched.reduce((s, e) => s + e.received_qty, 0).toFixed(1),
              },
              {
                label: 'Total variance',
                value: totalVariance.toFixed(1),
                color:
                  Math.abs(totalVariance) < 0.01
                    ? 'text-green-400'
                    : totalVariance < 0
                      ? 'text-red-400'
                      : 'text-amber-400',
              },
            ].map(({ label, value, color }) => (
              <div
                key={label}
                className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center"
              >
                <p className={`text-lg font-bold ${color || 'text-white'}`}>{value}</p>
                <p className="text-gray-500 text-xs mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Entries */}
        {loading ? (
          <div className="text-center py-12 text-gray-500 text-sm">Loading…</div>
        ) : enriched.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
            <Package size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm font-medium">No stock entries for this date</p>
            <p className="text-gray-600 text-xs mt-1">Add items received in the kitchen today</p>
          </div>
        ) : (
          <div className="space-y-2">
            {enriched.map((entry) => {
              const expanded = expandedId === entry.id
              const v = entry.computed_variance
              return (
                <div
                  key={entry.id}
                  className={`bg-gray-900 border rounded-2xl overflow-hidden ${varianceBg(v)}`}
                >
                  {/* Row header */}
                  <button
                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                    onClick={() => setExpandedId(expanded ? null : entry.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{entry.item_name}</p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        In: {(entry.opening_qty + entry.received_qty).toFixed(1)} {entry.unit}
                        &nbsp;·&nbsp; Sold: {entry.effective_sold.toFixed(1)}
                        &nbsp;·&nbsp; Left: {entry.closing_qty.toFixed(1)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-bold ${varianceColor(v)}`}>
                        {v > 0 ? '+' : ''}
                        {v.toFixed(1)}
                      </p>
                      <p className="text-gray-600 text-xs">variance</p>
                    </div>
                    {expanded ? (
                      <ChevronUp size={16} className="text-gray-500 shrink-0" />
                    ) : (
                      <ChevronDown size={16} className="text-gray-500 shrink-0" />
                    )}
                  </button>

                  {/* Expanded detail */}
                  {expanded && (
                    <div className="border-t border-gray-800 px-4 py-4 space-y-3">
                      {/* Read-only row */}
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        {[
                          ['Opening Stock', `${entry.opening_qty} ${entry.unit}`],
                          ['Received Today', `${entry.received_qty} ${entry.unit}`],
                          ['Sold (from orders)', `${entry.auto_sold} ${entry.unit}`],
                          [
                            'Total Available',
                            `${(entry.opening_qty + entry.received_qty).toFixed(1)} ${entry.unit}`,
                          ],
                        ].map(([label, val]) => (
                          <div key={label} className="bg-gray-800 rounded-xl px-3 py-2">
                            <p className="text-gray-500 text-xs">{label}</p>
                            <p className="text-white font-semibold mt-0.5">{val}</p>
                          </div>
                        ))}
                      </div>

                      {/* Editable fields */}
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-gray-500 text-xs block mb-1">
                            Void / Wastage ({entry.unit})
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            defaultValue={entry.void_qty}
                            onBlur={(e) => updateVoid(entry.id, e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                          />
                        </div>
                        <div>
                          <label className="text-gray-500 text-xs block mb-1">
                            Physical Closing Count ({entry.unit})
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            defaultValue={entry.closing_qty}
                            onBlur={(e) => updateClosing(entry.id, e.target.value)}
                            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500"
                          />
                        </div>
                      </div>

                      {/* Variance explanation */}
                      <div
                        className={`rounded-xl px-3 py-2.5 text-xs ${Math.abs(v) < 0.01 ? 'bg-green-500/10 text-green-400' : v < 0 ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}
                      >
                        {Math.abs(v) < 0.01
                          ? '✓ Stock fully accounted for.'
                          : v < 0
                            ? `⚠ ${Math.abs(v).toFixed(1)} ${entry.unit} unaccounted for — investigate waste or theft.`
                            : `ℹ ${v.toFixed(1)} ${entry.unit} surplus — check if closing count or received qty is correct.`}
                      </div>

                      {/* Formula display */}
                      <div className="bg-gray-800 rounded-xl px-3 py-2 text-xs text-gray-500">
                        Formula: Opening ({entry.opening_qty}) + Received ({entry.received_qty}) −
                        Sold ({entry.effective_sold}) − Void ({entry.void_qty}) − Closing (
                        {entry.closing_qty}) ={' '}
                        <span className={varianceColor(v)}>{v.toFixed(1)}</span>
                      </div>

                      {entry.note && (
                        <p className="text-gray-500 text-xs italic">Note: {entry.note}</p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => syncSold(entry)}
                          className="flex-1 text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl py-2 font-medium"
                        >
                          Sync sold qty from orders
                        </button>
                        <button
                          onClick={() => deleteEntry(entry.id)}
                          className="p-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Add entry form */}
        {showAdd && (
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-3">
            <p className="text-white font-semibold text-sm">Add Stock Entry</p>

            {formError && (
              <p className="text-red-400 text-xs bg-red-500/10 rounded-xl px-3 py-2">{formError}</p>
            )}

            <div>
              <label className="text-gray-500 text-xs block mb-1">Item Name</label>
              <input
                list="kitchen-menu-items"
                value={form.item_name}
                onChange={(e) => setForm((f) => ({ ...f, item_name: e.target.value }))}
                placeholder="e.g. Jollof Rice, Chicken Suya"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
              <datalist id="kitchen-menu-items">
                {menuItems.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Unit</label>
                <select
                  value={form.unit}
                  onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Opening Stock</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.opening_qty}
                  onChange={(e) => setForm((f) => ({ ...f, opening_qty: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-gray-500 text-xs block mb-1">Received Today</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.received_qty}
                  onChange={(e) => setForm((f) => ({ ...f, received_qty: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Void / Wastage</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.void_qty}
                  onChange={(e) => setForm((f) => ({ ...f, void_qty: e.target.value }))}
                  placeholder="0"
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div>
              <label className="text-gray-500 text-xs block mb-1">Physical Closing Count</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.closing_qty}
                onChange={(e) => setForm((f) => ({ ...f, closing_qty: e.target.value }))}
                placeholder="0 — count what is physically left"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="text-gray-500 text-xs block mb-1">Note (optional)</label>
              <input
                type="text"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                placeholder="e.g. half bag spoiled, delivery came late"
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-amber-500"
              />
            </div>

            {/* Preview variance */}
            {form.item_name && (
              <div className="bg-gray-800 rounded-xl px-3 py-2 text-xs text-gray-400">
                Sold from orders today:{' '}
                <span className="text-white font-medium">
                  {soldMap[form.item_name] || 0} {form.unit}
                </span>
                {soldMap[form.item_name] > 0 && ' — auto-filled from POS data'}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  setShowAdd(false)
                  setFormError(null)
                }}
                className="flex-1 bg-gray-800 text-gray-300 rounded-2xl py-3 text-sm font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={saving}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-bold rounded-2xl py-3 text-sm transition-colors"
              >
                {saving ? 'Saving…' : 'Add Entry'}
              </button>
            </div>
          </div>
        )}

        {/* Add button */}
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-2xl py-4 text-sm transition-colors"
          >
            <Plus size={18} />
            Add Stock Entry
          </button>
        )}

        {/* Legend */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 space-y-1.5">
          <p className="text-gray-500 text-xs font-medium mb-2">Variance Legend</p>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <p className="text-gray-400 text-xs">Zero variance — fully accounted for</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <p className="text-gray-400 text-xs">
              Negative — missing stock, investigate waste or theft
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400" />
            <p className="text-gray-400 text-xs">
              Positive — surplus, verify received or closing counts
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
