import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { CheckCircle, Clock, XCircle, AlertTriangle, Printer } from 'lucide-react'

interface ReturnEntry {
  id: string
  order_id: string
  order_item_id: string
  item_name: string
  quantity: number
  item_total: number
  table_name: string | null
  waitron_name: string | null
  barman_name: string | null
  return_reason: string | null
  status: 'pending' | 'accepted' | 'rejected'
  requested_at: string
  resolved_at: string | null
  shift_date: string
  reviewed: boolean
  reviewed_by_name: string | null
  reviewed_at: string | null
  notes: string | null
}

interface Props {
  dateRange: { start: string; end: string }
}

export default function ReturnsTab({ dateRange }: Props) {
  const { profile } = useAuth()
  const [entries, setEntries] = useState<ReturnEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'pending' | 'accepted' | 'rejected' | 'unreviewed'>(
    'unreviewed'
  )

  const fetchReturns = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('returns_log')
      .select('*')
      .gte('shift_date', dateRange.start)
      .lte('shift_date', dateRange.end)
      .order('requested_at', { ascending: false })
    setEntries((data as ReturnEntry[]) || [])
    setLoading(false)
  }, [dateRange.start, dateRange.end])

  useEffect(() => {
    fetchReturns()
  }, [fetchReturns])

  const markReviewed = async (id: string) => {
    await supabase
      .from('returns_log')
      .update({
        reviewed: true,
        reviewed_by: profile?.id ?? null,
        reviewed_by_name: profile?.full_name ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
    fetchReturns()
  }

  const markAllReviewed = async () => {
    const unreviewedIds = filtered.filter((e) => !e.reviewed).map((e) => e.id)
    if (!unreviewedIds.length) return
    await supabase
      .from('returns_log')
      .update({
        reviewed: true,
        reviewed_by: profile?.id ?? null,
        reviewed_by_name: profile?.full_name ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .in('id', unreviewedIds)
    fetchReturns()
  }

  const filtered = entries.filter((e) => {
    if (filter === 'unreviewed') return !e.reviewed
    if (filter === 'all') return true
    return e.status === filter
  })

  const totalAccepted = entries
    .filter((e) => e.status === 'accepted')
    .reduce((s, e) => s + Number(e.item_total), 0)
  const totalPending = entries.filter((e) => e.status === 'pending').length
  const unreviewed = entries.filter((e) => !e.reviewed).length

  const printReport = () => {
    const W = 64
    const divider = '-'.repeat(W)
    const fmtRow = (l: string, r: string) => {
      const space = W - l.length - r.length
      return l + ' '.repeat(Math.max(1, space)) + r
    }
    const lines = [
      `BEESHOP'S PLACE — RETURNS REPORT`,
      `Date range: ${dateRange.start} to ${dateRange.end}`,
      divider,
      fmtRow(
        'Total Accepted Returns:',
        `N${totalAccepted.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      ),
      fmtRow('Pending Returns:', String(totalPending)),
      fmtRow('Unreviewed:', String(unreviewed)),
      divider,
      ...entries.map((e) =>
        [
          `[${e.status.toUpperCase()}] ${e.item_name} x${e.quantity} — N${Number(e.item_total).toLocaleString()}`,
          `  Table: ${e.table_name ?? 'N/A'} | Waitron: ${e.waitron_name ?? 'N/A'} | Bar: ${e.barman_name ?? 'Pending'}`,
          `  Reason: ${e.return_reason ?? 'None'} | Date: ${new Date(e.requested_at).toLocaleString('en-NG')}`,
          `  Reviewed: ${e.reviewed ? `Yes — ${e.reviewed_by_name}` : 'NO — NOT YET REVIEWED'}`,
          '',
        ].join('\n')
      ),
    ].join('\n')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Returns Report</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:12px;padding:10mm;white-space:pre;}
@media print{@page{margin:10mm;}}</style></head><body>${lines}</body></html>`
    const win = window.open('', '_blank', 'width=800,height=700')
    if (!win) return
    win.document.open('text/html', 'replace')
    win.document.write(html)
    win.document.close()
    win.onload = () =>
      setTimeout(() => {
        win.print()
        win.close()
      }, 300)
  }

  const statusIcon = (status: string) => {
    if (status === 'accepted') return <CheckCircle size={14} className="text-green-400" />
    if (status === 'rejected') return <XCircle size={14} className="text-red-400" />
    return <Clock size={14} className="text-amber-400" />
  }

  const statusColor = (status: string) => {
    if (status === 'accepted') return 'bg-green-500/10 border-green-500/30 text-green-400'
    if (status === 'rejected') return 'bg-red-500/10 border-red-500/30 text-red-400'
    return 'bg-amber-500/10 border-amber-500/30 text-amber-400'
  }

  return (
    <div className="p-4 space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
          <p className="text-red-400 text-2xl font-bold">N{totalAccepted.toLocaleString()}</p>
          <p className="text-gray-500 text-xs mt-1">Total Returns Accepted</p>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 text-center">
          <p className="text-amber-400 text-2xl font-bold">{totalPending}</p>
          <p className="text-gray-500 text-xs mt-1">Pending Bar Review</p>
        </div>
        <div
          className={`border rounded-2xl p-4 text-center ${unreviewed > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-gray-900 border-gray-800'}`}
        >
          <p className={`text-2xl font-bold ${unreviewed > 0 ? 'text-red-400' : 'text-gray-400'}`}>
            {unreviewed}
          </p>
          <p className="text-gray-500 text-xs mt-1">Awaiting Your Review</p>
        </div>
      </div>

      {/* Unreviewed alert */}
      {unreviewed > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-400 shrink-0" />
            <p className="text-red-400 text-sm font-semibold">
              {unreviewed} return{unreviewed !== 1 ? 's' : ''} not yet reviewed — flag for follow-up
            </p>
          </div>
          <button
            onClick={markAllReviewed}
            className="text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          >
            Mark All Reviewed
          </button>
        </div>
      )}

      {/* Filter + Print */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1.5 flex-wrap">
          {(['unreviewed', 'all', 'pending', 'accepted', 'rejected'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize ${filter === f ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              {f === 'unreviewed' ? `⚠ Unreviewed (${unreviewed})` : f}
            </button>
          ))}
        </div>
        <button
          onClick={printReport}
          className="flex items-center gap-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors shrink-0"
        >
          <Printer size={12} /> Print Report
        </button>
      </div>

      {/* Entries */}
      {loading ? (
        <div className="text-center py-8 text-gray-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <CheckCircle size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500">
            {filter === 'unreviewed'
              ? 'All returns reviewed — nothing flagged'
              : 'No returns in this period'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <div
              key={entry.id}
              className={`bg-gray-900 border rounded-xl p-4 ${!entry.reviewed ? 'border-red-500/20' : 'border-gray-800'}`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcon(entry.status)}
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${statusColor(entry.status)}`}
                    >
                      {entry.status.toUpperCase()}
                    </span>
                    {!entry.reviewed && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-500/20 border border-red-500/30 text-red-400">
                        NOT REVIEWED
                      </span>
                    )}
                  </div>
                  <p className="text-white font-semibold text-sm">
                    {entry.quantity}x {entry.item_name}
                    <span className="text-gray-500 font-normal ml-2">
                      — N{Number(entry.item_total).toLocaleString()}
                    </span>
                  </p>
                </div>
                <p className="text-amber-400 font-bold text-sm shrink-0">
                  {entry.status === 'accepted'
                    ? `-N${Number(entry.item_total).toLocaleString()}`
                    : ''}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-500 mb-2">
                <span>
                  Table: <span className="text-gray-300">{entry.table_name ?? 'N/A'}</span>
                </span>
                <span>
                  Waitron: <span className="text-gray-300">{entry.waitron_name ?? 'N/A'}</span>
                </span>
                <span>
                  Barman: <span className="text-gray-300">{entry.barman_name ?? 'Pending'}</span>
                </span>
                <span>
                  Time:{' '}
                  <span className="text-gray-300">
                    {new Date(entry.requested_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </span>
                </span>
              </div>
              {entry.return_reason && (
                <p className="text-xs text-amber-400 italic mb-2">
                  Reason: "{entry.return_reason}"
                </p>
              )}
              {entry.reviewed ? (
                <p className="text-xs text-green-500">
                  ✓ Reviewed by {entry.reviewed_by_name} at{' '}
                  {entry.reviewed_at
                    ? new Date(entry.reviewed_at).toLocaleTimeString('en-NG', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                      })
                    : ''}
                </p>
              ) : (
                <button
                  onClick={() => markReviewed(entry.id)}
                  className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Mark as Reviewed
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
