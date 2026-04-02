import { useState, useEffect, useCallback } from 'react'
import { ArrowLeft, Beer, RefreshCw, Save, Minus, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const todayStr = () => new Date().toISOString().slice(0, 10)

interface StockEntry {
  id?: string
  item_name: string
  unit: string
  opening_qty: number
  received_qty: number
  sold_qty: number
  void_qty: number
  closing_qty: number
  note: string
}

interface Props {
  onBack: () => void
  embedded?: boolean
}

// Stepper: +/- buttons + tappable number that opens a picker
function Stepper({
  value,
  onChange,
  label,
  color = 'text-white',
}: {
  value: number
  onChange: (v: number) => void
  label: string
  color?: string
}) {
  const [showPicker, setShowPicker] = useState(false)
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 active:scale-95 flex items-center justify-center text-white transition-all"
        >
          <Minus size={16} />
        </button>
        <button
          onClick={() => setShowPicker(!showPicker)}
          className={`w-12 h-9 rounded-lg bg-gray-800 border border-gray-700 flex items-center justify-center text-sm font-bold ${color} hover:border-amber-500 transition-colors`}
        >
          {value}
        </button>
        <button
          onClick={() => onChange(value + 1)}
          className="w-9 h-9 rounded-lg bg-gray-700 hover:bg-gray-600 active:scale-95 flex items-center justify-center text-white transition-all"
        >
          <Plus size={16} />
        </button>
      </div>
      {showPicker && (
        <select
          value={value}
          onChange={(e) => {
            onChange(parseInt(e.target.value))
            setShowPicker(false)
          }}
          onBlur={() => setShowPicker(false)}
          autoFocus
          className="w-20 bg-gray-800 border border-amber-500 text-white rounded-lg px-2 py-1 text-sm text-center focus:outline-none"
        >
          {Array.from({ length: 501 }, (_, i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}

// Notes with quick-select presets
const NOTE_PRESETS = ['Broken bottle', 'Expired', 'Given out free', 'Damaged label', 'Spillage']

export default function BarChillerStock({ onBack, embedded = false }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [date, setDate] = useState(todayStr())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [menuDrinks, setMenuDrinks] = useState<Array<{ name: string; unit: string }>>([])
  const [stockData, setStockData] = useState<Record<string, StockEntry>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [hasChanges, setHasChanges] = useState(false)

  // Load bar menu items
  useEffect(() => {
    supabase
      .from('menu_items')
      .select('name, menu_categories(destination)')
      .eq('is_available', true)
      .order('name')
      .then(({ data }) => {
        if (data) {
          const drinks = (
            data as unknown as Array<{
              name: string
              menu_categories: { destination: string } | null
            }>
          )
            .filter((i) => i.menu_categories?.destination === 'bar')
            .map((i) => ({ name: i.name, unit: 'bottles' }))
          setMenuDrinks(drinks)
        }
      })
  }, [])

  // Load sold quantities from POS
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

  // Load existing entries for the day
  const loadEntries = useCallback(
    async (d: string) => {
      setLoading(true)
      await loadSoldQty(d)

      // Load previous day's closing for opening stock
      const prevDate = new Date(d)
      prevDate.setDate(prevDate.getDate() - 1)
      const { data: prevData } = await supabase
        .from('bar_chiller_stock')
        .select('item_name, closing_qty')
        .eq('date', prevDate.toISOString().slice(0, 10))
      const prevClosing: Record<string, number> = {}
      if (prevData) {
        for (const row of prevData as Array<{ item_name: string; closing_qty: number }>) {
          prevClosing[row.item_name] = row.closing_qty
        }
      }

      // Load today's entries
      const { data: todayData } = await supabase
        .from('bar_chiller_stock')
        .select('*')
        .eq('date', d)
        .order('item_name')
      const existing: Record<string, StockEntry> = {}
      if (todayData) {
        for (const row of todayData as Array<StockEntry & { id: string }>) {
          existing[row.item_name] = row
        }
      }

      // Build stock data for all bar drinks
      const stock: Record<string, StockEntry> = {}
      for (const drink of menuDrinks) {
        if (existing[drink.name]) {
          stock[drink.name] = existing[drink.name]
        } else {
          stock[drink.name] = {
            item_name: drink.name,
            unit: drink.unit,
            opening_qty: prevClosing[drink.name] || 0,
            received_qty: 0,
            sold_qty: 0,
            void_qty: 0,
            closing_qty: 0,
            note: '',
          }
        }
      }
      setStockData(stock)
      setHasChanges(false)
      setLoading(false)
    },
    [loadSoldQty, menuDrinks]
  )

  useEffect(() => {
    if (menuDrinks.length > 0) loadEntries(date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, menuDrinks])

  const updateField = (itemName: string, field: keyof StockEntry, value: number | string) => {
    setStockData((prev) => ({
      ...prev,
      [itemName]: { ...prev[itemName], [field]: value },
    }))
    setHasChanges(true)
  }

  const handleSaveAll = async () => {
    setSaving(true)
    let saved = 0
    for (const [name, entry] of Object.entries(stockData)) {
      // Only save entries that have any activity
      if (
        entry.opening_qty === 0 &&
        entry.received_qty === 0 &&
        entry.closing_qty === 0 &&
        entry.void_qty === 0 &&
        !entry.id
      )
        continue

      const row = {
        date,
        item_name: name,
        unit: entry.unit || 'bottles',
        opening_qty: entry.opening_qty,
        received_qty: entry.received_qty,
        sold_qty: soldMap[name] || entry.sold_qty || 0,
        void_qty: entry.void_qty,
        closing_qty: entry.closing_qty,
        note: entry.note || null,
        recorded_by: profile?.id,
        updated_at: new Date().toISOString(),
      }

      if (entry.id) {
        await supabase.from('bar_chiller_stock').update(row).eq('id', entry.id)
      } else {
        await supabase.from('bar_chiller_stock').insert(row)
      }
      saved++
    }
    setSaving(false)
    setHasChanges(false)
    toast.success('Saved', `${saved} item${saved !== 1 ? 's' : ''} updated`)
    loadEntries(date)
  }

  const totalReceived = Object.values(stockData).reduce((s, e) => s + e.received_qty, 0)
  const totalSold = Object.values(stockData).reduce(
    (s, e) => s + (soldMap[e.item_name] || e.sold_qty || 0),
    0
  )
  const totalVoid = Object.values(stockData).reduce((s, e) => s + e.void_qty, 0)

  const drinks = menuDrinks.map((d) => ({
    ...d,
    ...(stockData[d.name] || {
      opening_qty: 0,
      received_qty: 0,
      sold_qty: 0,
      void_qty: 0,
      closing_qty: 0,
      note: '',
    }),
    autoSold: soldMap[d.name] || 0,
  }))

  return (
    <div className="min-h-full bg-gray-950">
      {/* Header */}
      {!embedded && (
        <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <h1 className="text-white font-bold">Bar Chiller Stock</h1>
            <p className="text-gray-400 text-xs">Tap +/- to enter stock counts</p>
          </div>
          <input
            type="date"
            value={date}
            max={todayStr()}
            onChange={(e) => setDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500"
          />
        </div>
      )}

      {embedded && (
        <div className="px-4 pt-3 pb-1 flex items-center gap-3">
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

      <div className="p-4 max-w-2xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {[
            { label: 'Received', value: totalReceived, color: 'text-green-400' },
            { label: 'Sold (POS)', value: totalSold, color: 'text-blue-400' },
            { label: 'Void', value: totalVoid, color: 'text-red-400' },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="bg-gray-900 border border-gray-800 rounded-xl p-2.5 text-center"
            >
              <p className={`text-lg font-bold ${color}`}>{value}</p>
              <p className="text-gray-500 text-[9px] uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>

        {/* Save button — sticky when changes exist */}
        {hasChanges && (
          <button
            onClick={handleSaveAll}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-3 text-sm mb-4 transition-colors sticky top-0 z-10"
          >
            <Save size={16} /> {saving ? 'Saving...' : 'Save All Changes'}
          </button>
        )}

        {/* Drink list */}
        {loading ? (
          <div className="text-center py-16 text-amber-500">Loading drinks...</div>
        ) : drinks.length === 0 ? (
          <div className="text-center py-16">
            <Beer size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No bar drinks found in menu</p>
          </div>
        ) : (
          <div className="space-y-2">
            {drinks.map((drink) => {
              const isExpanded = expanded === drink.name
              const sold = drink.autoSold || drink.sold_qty || 0
              const expected = drink.opening_qty + drink.received_qty - sold - drink.void_qty
              const variance = expected - drink.closing_qty
              const hasActivity =
                drink.opening_qty > 0 ||
                drink.received_qty > 0 ||
                drink.closing_qty > 0 ||
                drink.void_qty > 0

              return (
                <div
                  key={drink.name}
                  className={`bg-gray-900 border rounded-xl overflow-hidden ${
                    hasActivity && variance > 2
                      ? 'border-red-500/40'
                      : hasActivity && variance > 0.5
                        ? 'border-amber-500/30'
                        : 'border-gray-800'
                  }`}
                >
                  {/* Collapsed row — item name + key numbers + expand */}
                  <button
                    onClick={() => setExpanded(isExpanded ? null : drink.name)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-semibold truncate">{drink.name}</p>
                      {hasActivity && (
                        <p className="text-gray-500 text-xs">
                          Open: {drink.opening_qty} + Rcvd: {drink.received_qty} − Sold: {sold} =
                          Exp: {expected}
                          {drink.closing_qty > 0 && (
                            <span className="ml-1">| Count: {drink.closing_qty}</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {hasActivity && variance !== 0 && drink.closing_qty > 0 && (
                        <span
                          className={`text-xs font-bold ${variance > 0 ? 'text-red-400' : 'text-blue-400'}`}
                        >
                          {variance > 0 ? '−' : '+'}
                          {Math.abs(variance)}
                        </span>
                      )}
                      {isExpanded ? (
                        <ChevronUp size={14} className="text-gray-500" />
                      ) : (
                        <ChevronDown size={14} className="text-gray-500" />
                      )}
                    </div>
                  </button>

                  {/* Expanded — stepper controls */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-2 border-t border-gray-800 space-y-4">
                      {/* Steppers row */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 justify-items-center">
                        <Stepper
                          label="Opening"
                          value={drink.opening_qty}
                          onChange={(v) => updateField(drink.name, 'opening_qty', v)}
                          color="text-white"
                        />
                        <Stepper
                          label="Received"
                          value={drink.received_qty}
                          onChange={(v) => updateField(drink.name, 'received_qty', v)}
                          color="text-green-400"
                        />
                        <Stepper
                          label="Void/Broken"
                          value={drink.void_qty}
                          onChange={(v) => updateField(drink.name, 'void_qty', v)}
                          color="text-red-400"
                        />
                        <Stepper
                          label="Closing Count"
                          value={drink.closing_qty}
                          onChange={(v) => updateField(drink.name, 'closing_qty', v)}
                          color="text-cyan-400"
                        />
                      </div>

                      {/* Sold (auto) */}
                      <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                        <span className="text-gray-400 text-xs">Sold (from POS)</span>
                        <span className="text-blue-400 text-sm font-bold">{sold}</span>
                      </div>

                      {/* Expected vs actual */}
                      {drink.closing_qty > 0 && (
                        <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                          <span className="text-gray-400 text-xs">Expected remaining</span>
                          <span
                            className={`text-sm font-bold ${variance === 0 ? 'text-green-400' : variance > 0 ? 'text-red-400' : 'text-blue-400'}`}
                          >
                            {expected}{' '}
                            {variance !== 0 &&
                              `(${variance > 0 ? '−' : '+'}${Math.abs(variance)} variance)`}
                          </span>
                        </div>
                      )}

                      {/* Notes — quick-select presets */}
                      <div>
                        <p className="text-gray-500 text-[9px] uppercase tracking-wider mb-1.5">
                          Notes
                        </p>
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {NOTE_PRESETS.map((preset) => (
                            <button
                              key={preset}
                              onClick={() => {
                                const current = stockData[drink.name]?.note || ''
                                const newNote = current ? `${current}, ${preset}` : preset
                                updateField(drink.name, 'note', newNote)
                              }}
                              className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                                (stockData[drink.name]?.note || '').includes(preset)
                                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                  : 'bg-gray-800 text-gray-400 hover:text-white'
                              }`}
                            >
                              {preset}
                            </button>
                          ))}
                        </div>
                        {stockData[drink.name]?.note && (
                          <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                            <span className="text-amber-400 text-xs italic flex-1">
                              {stockData[drink.name].note}
                            </span>
                            <button
                              onClick={() => updateField(drink.name, 'note', '')}
                              className="text-gray-500 hover:text-red-400 text-xs ml-2"
                            >
                              Clear
                            </button>
                          </div>
                        )}
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
