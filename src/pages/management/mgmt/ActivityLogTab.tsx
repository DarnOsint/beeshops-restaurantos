import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { Search, Filter, Download, RefreshCw } from 'lucide-react'

interface LogEntry {
  id: string
  action: string
  entity: string | null
  entity_name: string | null
  new_value: Record<string, unknown> | null
  old_value: Record<string, unknown> | null
  performed_by_name: string | null
  performed_by_role: string | null
  created_at: string
  device?: string | null
}

const ACTION_GROUPS: Record<string, string[]> = {
  All: [],
  Login: ['LOGIN_EMAIL', 'LOGIN_PIN', 'LOGOUT', 'SESSION_TIMEOUT', 'MFA_VERIFIED'],
  Sales: ['ORDER_CREATED', 'ORDER_PAID', 'ORDER_UPDATED', 'CASH_SALE'],
  Voids: ['VOID_ITEM', 'VOID_ORDER'],
  Shifts: ['CLOCK_IN', 'CLOCK_OUT'],
  BackOffice: [
    'SUPPLIER_CREATED',
    'SUPPLIER_UPDATED',
    'PO_CREATED',
    'PO_RECEIVED',
    'MENU_ITEM_SAVED',
    'MENU_CAT_SAVED',
  ],
  System: ['DEBTOR_ADDED', 'PAYMENT_RECORDED'],
}

const ACTION_COLOR: Record<string, string> = {
  LOGIN_EMAIL: 'text-green-400 bg-green-500/10',
  LOGIN_PIN: 'text-green-400 bg-green-500/10',
  LOGOUT: 'text-gray-400 bg-gray-700',
  SESSION_TIMEOUT: 'text-gray-400 bg-gray-700',
  MFA_VERIFIED: 'text-blue-400 bg-blue-500/10',
  ORDER_CREATED: 'text-amber-400 bg-amber-500/10',
  ORDER_PAID: 'text-emerald-400 bg-emerald-500/10',
  ORDER_UPDATED: 'text-amber-300 bg-amber-500/10',
  CASH_SALE: 'text-emerald-400 bg-emerald-500/10',
  VOID_ITEM: 'text-red-400 bg-red-500/10',
  VOID_ORDER: 'text-red-400 bg-red-500/10',
  CLOCK_IN: 'text-purple-400 bg-purple-500/10',
  CLOCK_OUT: 'text-purple-300 bg-purple-500/10',
}

function fmtAction(action: string) {
  return action
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function EntryDetail({ entry }: { entry: LogEntry }) {
  const parts: string[] = []
  if (entry.entity_name) parts.push(entry.entity_name)
  if (entry.new_value) {
    const nv = entry.new_value
    if (typeof nv.total === 'number') parts.push(`₦${Number(nv.total).toLocaleString()}`)
    if (typeof nv.payment_method === 'string') parts.push(String(nv.payment_method).toUpperCase())
    if (typeof nv.addedItems === 'number') parts.push(`+${nv.addedItems} items`)
    if (typeof nv.amount === 'number') parts.push(`₦${Number(nv.amount).toLocaleString()}`)
    if (typeof nv.device === 'string') parts.push(`via ${nv.device}`)
  }
  if (!parts.length) return null
  return <span className="text-gray-500 text-xs ml-1">— {parts.join(' · ')}</span>
}

interface Props {
  dateRange: { start: string; end: string }
}

export default function ActivityLogTab({ dateRange }: Props) {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('All')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const fetchLog = useCallback(async () => {
    setLoading(true)
    const q = supabase
      .from('audit_log')
      .select(
        'id, action, entity, entity_name, new_value, old_value, performed_by_name, performed_by_role, created_at'
      )
      .gte('created_at', dateRange.start)
      .lte('created_at', dateRange.end)
      .order('created_at', { ascending: false })
      .limit(500)

    const actions = ACTION_GROUPS[group]
    if (actions && actions.length > 0) {
      void q.in('action', actions)
    }

    const { data } = await q
    setEntries((data || []) as LogEntry[])
    setPage(0)
    setLoading(false)
  }, [dateRange.start, dateRange.end, group])

  useEffect(() => {
    void fetchLog()
  }, [fetchLog])

  const filtered = entries.filter((e) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (e.performed_by_name || '').toLowerCase().includes(q) ||
      (e.action || '').toLowerCase().includes(q) ||
      (e.entity_name || '').toLowerCase().includes(q) ||
      (e.performed_by_role || '').toLowerCase().includes(q)
    )
  })

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const exportCSV = () => {
    const rows = [
      ['Time', 'Action', 'Entity', 'Staff', 'Role', 'Detail'],
      ...filtered.map((e) => [
        fmtTime(e.created_at),
        e.action,
        e.entity_name || '',
        e.performed_by_name || '',
        e.performed_by_role || '',
        e.new_value ? JSON.stringify(e.new_value) : '',
      ]),
    ]
    const csv = rows
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `activity-log-${dateRange.start.slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-3">
      {/* Controls */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] bg-gray-900 border border-gray-800 rounded-xl px-3 py-2 focus-within:border-amber-500 transition-colors">
          <Search size={14} className="text-gray-500 shrink-0" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            placeholder="Search by staff, action, entity…"
            className="flex-1 bg-transparent text-white text-sm placeholder-gray-500 focus:outline-none"
          />
        </div>
        <button
          onClick={fetchLog}
          className="p-2 bg-gray-900 border border-gray-800 rounded-xl text-gray-400 hover:text-white"
        >
          <RefreshCw size={15} />
        </button>
        <button
          onClick={exportCSV}
          className="p-2 bg-gray-900 border border-gray-800 rounded-xl text-gray-400 hover:text-white"
        >
          <Download size={15} />
        </button>
      </div>

      {/* Group filter */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        <Filter size={13} className="text-gray-600 shrink-0 mt-1" />
        {Object.keys(ACTION_GROUPS).map((g) => (
          <button
            key={g}
            onClick={() => {
              setGroup(g)
              setPage(0)
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${group === g ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Count */}
      <div className="flex items-center justify-between">
        <p className="text-gray-500 text-xs">
          {filtered.length} entries{search ? ' matching' : ''}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-30"
            >
              ← Prev
            </button>
            <span className="text-gray-600 text-xs">
              {page + 1}/{totalPages}
            </span>
            <button
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="text-xs text-gray-400 hover:text-white disabled:opacity-30"
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Log entries */}
      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">Loading activity log…</div>
      ) : paged.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          <p className="font-medium">No entries found</p>
          <p className="text-xs mt-1">Try adjusting the date range or filters</p>
        </div>
      ) : (
        <div className="space-y-1">
          {paged.map((entry) => {
            const colorClass = ACTION_COLOR[entry.action] || 'text-gray-300 bg-gray-800'
            return (
              <div
                key={entry.id}
                className="bg-gray-900 border border-gray-800 rounded-xl px-3 py-2.5 flex items-start gap-3"
              >
                <span
                  className={`text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap shrink-0 ${colorClass}`}
                >
                  {fmtAction(entry.action)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-white text-xs font-medium">
                      {entry.performed_by_name || 'System'}
                    </span>
                    {entry.performed_by_role && (
                      <span className="text-gray-600 text-[10px] capitalize">
                        ({entry.performed_by_role})
                      </span>
                    )}
                    <EntryDetail entry={entry} />
                  </div>
                  <p className="text-gray-600 text-[10px] mt-0.5">{fmtTime(entry.created_at)}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
