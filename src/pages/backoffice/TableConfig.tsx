import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ArrowLeft, Edit2, X, Save } from 'lucide-react'

interface Zone {
  id: string
  name: string
}

interface Table {
  id: string
  name: string
  capacity: number
  category_id: string
  table_categories?: { id: string; name: string }
}

interface TableForm {
  name: string
  capacity: string
  category_id: string
}

interface Props {
  onBack: () => void
}

const zoneColorMap: Record<string, string> = {
  Outdoor: 'bg-green-500/20 text-green-400',
  Indoor: 'bg-blue-500/20 text-blue-400',
  'VIP Lounge': 'bg-purple-500/20 text-purple-400',
  'The Nook': 'bg-amber-500/20 text-amber-400',
}

export default function TableConfig({ onBack }: Props) {
  const [tables, setTables] = useState<Table[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Table | null>(null)
  const [form, setForm] = useState<TableForm>({ name: '', capacity: '', category_id: '' })
  const [saving, setSaving] = useState(false)
  const [filterZone, setFilterZone] = useState('All')

  const fetchAll = async () => {
    const [tablesRes, zonesRes] = await Promise.all([
      supabase.from('tables').select('*, table_categories(id, name)').order('name'),
      supabase.from('table_categories').select('*').order('name'),
    ])
    if (tablesRes.data) setTables(tablesRes.data as Table[])
    if (zonesRes.data) setZones(zonesRes.data as Zone[])
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    fetchAll()
  }, [])

  const openEdit = (table: Table) => {
    setEditing(table)
    setForm({
      name: table.name,
      capacity: table.capacity.toString(),
      category_id: table.category_id,
    })
  }

  const save = async () => {
    if (!form.name || !form.capacity || !editing) return
    setSaving(true)
    await supabase
      .from('tables')
      .update({
        name: form.name,
        capacity: parseInt(form.capacity),
        category_id: form.category_id,
      })
      .eq('id', editing.id)
    await fetchAll()
    setSaving(false)
    setEditing(null)
  }

  const filtered =
    filterZone === 'All' ? tables : tables.filter((t) => t.table_categories?.name === filterZone)

  const zoneColor = (name?: string) =>
    name ? (zoneColorMap[name] ?? 'bg-gray-700 text-gray-400') : 'bg-gray-700 text-gray-400'

  return (
    <div className="min-h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-3">
        <button onClick={onBack} className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-white font-bold">Table Configuration</h1>
          <p className="text-gray-400 text-xs">
            {tables.length} tables across {zones.length} zones
          </p>
        </div>
      </div>

      <div className="p-6">
        <div className="flex gap-2 mb-6 overflow-x-auto">
          {['All', ...zones.map((z) => z.name)].map((zone) => (
            <button
              key={zone}
              onClick={() => setFilterZone(zone)}
              className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${
                filterZone === zone
                  ? 'bg-amber-500 text-black'
                  : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {zone}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-amber-500 text-center py-12">Loading...</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {filtered.map((table) => (
              <div
                key={table.id}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 flex flex-col gap-2"
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-lg ${zoneColor(table.table_categories?.name)}`}
                  >
                    {table.table_categories?.name}
                  </span>
                  <button
                    onClick={() => openEdit(table)}
                    className="text-gray-400 hover:text-white"
                  >
                    <Edit2 size={13} />
                  </button>
                </div>
                <p className="text-white font-semibold text-sm">{table.name}</p>
                <p className="text-gray-500 text-xs">👥 {table.capacity} seats</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Edit Table</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Table Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Capacity
                </label>
                <input
                  type="number"
                  value={form.capacity}
                  onChange={(e) => setForm({ ...form, capacity: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                  Zone
                </label>
                <select
                  value={form.category_id}
                  onChange={(e) => setForm({ ...form, category_id: e.target.value })}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={save}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2"
              >
                <Save size={16} /> {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
