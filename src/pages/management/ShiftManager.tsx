import { useState, useEffect, useCallback } from 'react'
import { todayWAT } from '../../lib/wat'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { audit } from '../../lib/audit'
import { UserCheck, UserX, Clock, X, Calendar, Timer, FileText, Monitor } from 'lucide-react'
import ShiftSummary from './ShiftSummary'
import { useToast } from '../../context/ToastContext'

interface StaffMember {
  id: string
  full_name: string
  role: string
  is_active: boolean
}
interface Shift {
  id: string
  staff_id: string
  staff_name: string
  role: string
  clock_in: string
  clock_out?: string | null
  duration_minutes?: number | null
  date?: string
  pos_machine?: string | null
}

interface Props {
  onClose?: () => void
  onRefreshStats?: () => void
}

export default function ShiftManager({ onClose, onRefreshStats }: Props) {
  const { profile } = useAuth()
  const toast = useToast()
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [activeShifts, setActiveShifts] = useState<Shift[]>([])
  const [search, setSearch] = useState('')
  const [posMachines, setPosMachines] = useState<string[]>([])
  const [selectedPos, setSelectedPos] = useState<Record<string, string>>({}) // staffId → pos machine name
  const [todayLog, setTodayLog] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'active' | 'all' | 'log'>('active')
  const [summaryShift, setSummaryShift] = useState<Shift | null>(null)

  const fetchPosMachines = async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('id', 'pos_machines')
      .single()
    if (data?.value) {
      try {
        setPosMachines(JSON.parse(data.value) as string[])
      } catch {
        /* ignore */
      }
    }
  }

  const fetchStaff = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('is_active', true)
      .in('role', ['waitron', 'kitchen', 'bar', 'griller', 'manager', 'supervisor'])
      .order('full_name')
    if (data) setStaff(data)
  }
  const fetchActiveShifts = async () => {
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .is('clock_out', null)
      .order('clock_in', { ascending: true })
    if (data) {
      // Deduplicate by staff_id — keep the most recent row per staff
      // (guards against duplicate clock-ins that slipped through before the live-check fix)
      const seen = new Map<string, (typeof data)[0]>()
      for (const row of data) {
        const existing = seen.get(row.staff_id)
        if (!existing || new Date(row.clock_in) > new Date(existing.clock_in)) {
          seen.set(row.staff_id, row)
        }
      }
      setActiveShifts(Array.from(seen.values()))
    }
  }
  const fetchTodayLog = async () => {
    const today = todayWAT()
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('date', today)
      .order('clock_in', { ascending: false })
    if (data) setTodayLog(data)
  }

  const fetchAll = useCallback(async () => {
    setLoading(true)
    await Promise.all([fetchStaff(), fetchActiveShifts(), fetchTodayLog(), fetchPosMachines()])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchAll()
    onRefreshStats?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll])

  const clockIn = async (member: StaffMember) => {
    // Live DB check — avoids race on stale client state
    const { data: live } = await supabase
      .from('attendance')
      .select('id')
      .eq('staff_id', member.id)
      .is('clock_out', null)
      .limit(1)
    if (live && live.length > 0) {
      toast.warning('Already Clocked In', member.full_name + ' is already clocked in')
      return
    }
    const posMachine = selectedPos[member.id] || null
    const { error } = await supabase.from('attendance').insert({
      staff_id: member.id,
      staff_name: member.full_name,
      role: member.role,
      clock_in: new Date().toISOString(),
      date: todayWAT(),
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
      pos_machine: posMachine,
    })
    if (error) {
      toast.error('Error', (error as { message?: string })?.message || 'Unknown error')
      return
    }
    setSelectedPos((prev) => {
      const n = { ...prev }
      delete n[member.id]
      return n
    })
    void audit({
      action: 'CLOCK_IN',
      entity: 'attendance',
      entityName: member.full_name,
      newValue: { role: member.role, recorded_by: profile?.full_name },
      performer: profile as import('../../types').Profile,
    })
    fetchAll()
  }

  const clockOut = (shift: Shift) => {
    setSummaryShift(shift)
  }

  const confirmClockOut = async (shift: Shift) => {
    // Block clock-out if staff has open/unresolved orders
    const { data: openOrders } = await supabase
      .from('orders')
      .select('id, tables(name)')
      .eq('staff_id', shift.staff_id)
      .eq('status', 'open')
    if (openOrders && openOrders.length > 0) {
      const names = openOrders
        .map((o: Record<string, unknown>) => {
          const t = o.tables as { name?: string } | null
          return t?.name || 'Unknown table'
        })
        .join(', ')
      toast.error(
        'Cannot Clock Out',
        `${shift.staff_name} has ${openOrders.length} open order(s) on ${names}. All orders must be closed or reassigned before clocking out.`
      )
      setSummaryShift(null)
      return
    }
    const clockOutTime = new Date()
    const duration = Math.round(
      (clockOutTime.getTime() - new Date(shift.clock_in).getTime()) / 60000
    )
    const { error } = await supabase
      .from('attendance')
      .update({ clock_out: clockOutTime.toISOString(), duration_minutes: duration })
      .eq('id', shift.id)
    if (error) {
      toast.error('Error', (error as { message?: string })?.message || 'Unknown error')
      return
    }
    void audit({
      action: 'CLOCK_OUT',
      entity: 'attendance',
      entityName: shift.staff_name,
      newValue: { role: shift.role, duration_minutes: duration },
      performer: profile as import('../../types').Profile,
    })
    if (shift.role === 'waitron') {
      const { error: tErr } = await supabase
        .from('tables')
        .update({ assigned_staff: null })
        .eq('assigned_staff', shift.staff_id)
      if (tErr) console.error('Failed to unassign tables:', tErr.message)
      const { error: zErr } = await supabase
        .from('zone_assignments')
        .delete()
        .eq('staff_id', shift.staff_id)
      if (zErr) console.error('Failed to clear zone assignments:', zErr.message)
    }
    // Update the summary shift with the actual clock_out time
    // so the summary reloads with the correct session window
    setSummaryShift((prev) =>
      prev ? { ...prev, clock_out: clockOutTime.toISOString(), duration_minutes: duration } : null
    )
    fetchAll()
    onRefreshStats?.()
  }

  const isActive = (staffId: string) => activeShifts.some((s) => s.staff_id === staffId)

  const formatDuration = (minutes?: number | null) => {
    if (!minutes) return '—'
    const h = Math.floor(minutes / 60),
      m = minutes % 60
    return h > 0 ? `${h}h ${m}m` : `${m}m`
  }
  const formatTime = (ts?: string | null) =>
    ts
      ? new Date(ts).toLocaleTimeString('en-NG', {
          timeZone: 'Africa/Lagos',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      : '—'

  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white font-bold text-lg">Shift Manager</h3>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-800 rounded-lg p-1 gap-1">
            {(['active', 'all', 'log'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${tab === t ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
              >
                {t === 'active' ? 'On Shift' : t === 'all' ? 'All Staff' : "Today's Log"}
              </button>
            ))}
          </div>
          {onClose && (
            <button onClick={onClose} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          )}
        </div>
      </div>

      {tab === 'active' && (
        <div className="space-y-2">
          {activeShifts.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Clock size={24} className="mx-auto mb-2 opacity-50" />
              <p>No staff currently on shift</p>
            </div>
          ) : (
            activeShifts.map((shift) => (
              <div
                key={shift.id}
                className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-xl p-3"
              >
                <div>
                  <p className="text-white font-medium">{shift.staff_name}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-gray-400 text-xs capitalize">{shift.role}</p>
                    {shift.pos_machine && (
                      <span className="flex items-center gap-1 text-cyan-400 text-xs">
                        <Monitor size={10} />
                        {shift.pos_machine}
                      </span>
                    )}
                  </div>
                  <p className="text-green-400 text-xs mt-0.5 flex items-center gap-1">
                    <Timer size={10} /> Since {formatTime(shift.clock_in)}
                  </p>
                </div>
                <button
                  onClick={() => clockOut(shift)}
                  className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg px-3 py-1.5 text-sm transition-colors"
                >
                  <UserX size={14} /> Clock Out
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'all' && (
        <div className="space-y-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff…"
            className="w-full bg-gray-900 border border-gray-800 text-white text-sm rounded-xl px-4 py-2.5 focus:outline-none focus:border-amber-500"
          />
          {staff
            .filter(
              (m) =>
                !search ||
                m.full_name.toLowerCase().includes(search.toLowerCase()) ||
                (m.role || '').toLowerCase().includes(search.toLowerCase())
            )
            .map((member) => (
              <div
                key={member.id}
                className="flex items-center justify-between bg-gray-800 rounded-xl p-3"
              >
                <div>
                  <p className="text-white font-medium">{member.full_name}</p>
                  <p className="text-gray-400 text-xs capitalize">{member.role}</p>
                </div>
                {isActive(member.id) ? (
                  <span className="flex items-center gap-1 text-green-400 text-xs font-medium">
                    <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> On Shift
                  </span>
                ) : (
                  <div className="flex flex-col items-end gap-1.5">
                    {posMachines.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <Monitor size={11} className="text-cyan-400" />
                        <select
                          value={selectedPos[member.id] || ''}
                          onChange={(e) =>
                            setSelectedPos((prev) => ({ ...prev, [member.id]: e.target.value }))
                          }
                          className="bg-gray-700 border border-gray-600 text-white rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-cyan-500"
                        >
                          <option value="">No POS</option>
                          {posMachines.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <button
                      onClick={() => clockIn(member)}
                      className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg px-3 py-1.5 text-sm transition-colors"
                    >
                      <UserCheck size={14} /> Clock In
                    </button>
                  </div>
                )}
              </div>
            ))}
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-2">
          {todayLog.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Calendar size={24} className="mx-auto mb-2 opacity-50" />
              <p>No attendance records today</p>
            </div>
          ) : (
            todayLog.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between bg-gray-800 rounded-xl p-3"
              >
                <div>
                  <p className="text-white font-medium">{entry.staff_name}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-gray-400 text-xs capitalize">{entry.role}</p>
                    {entry.pos_machine && (
                      <span className="flex items-center gap-1 text-cyan-400 text-xs">
                        <Monitor size={10} />
                        {entry.pos_machine}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {formatTime(entry.clock_in)} →{' '}
                    {entry.clock_out ? formatTime(entry.clock_out) : 'Still on shift'}
                  </p>
                </div>
                <div className="text-right flex flex-col items-end gap-1.5">
                  {entry.clock_out ? (
                    <>
                      <span className="text-amber-400 text-sm font-medium">
                        {formatDuration(entry.duration_minutes)}
                      </span>
                      <button
                        onClick={() => setSummaryShift(entry)}
                        className="flex items-center gap-1 text-gray-500 hover:text-amber-400 text-xs transition-colors"
                      >
                        <FileText size={11} /> View
                      </button>
                    </>
                  ) : (
                    <span className="flex items-center gap-1 text-green-400 text-xs">
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> Active
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {summaryShift && (
        <ShiftSummary
          shift={summaryShift}
          onClose={() => setSummaryShift(null)}
          onConfirmClockOut={confirmClockOut}
        />
      )}
    </div>
  )
}
