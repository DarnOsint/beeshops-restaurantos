import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { UserCheck, UserX, Clock, X, Calendar, Timer, FileText } from 'lucide-react'
import ShiftSummary from './ShiftSummary'

export default function ShiftManager({ onClose }) {
  const { profile } = useAuth()
  const [staff, setStaff] = useState([])
  const [activeShifts, setActiveShifts] = useState([])
  const [todayLog, setTodayLog] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('active')
  const [summaryShift, setSummaryShift] = useState(null)

  useEffect(() => {
    fetchAll()
  }, [])

  const fetchAll = async () => {
    setLoading(true)
    await Promise.all([fetchStaff(), fetchActiveShifts(), fetchTodayLog()])
    setLoading(false)
  }

  const fetchStaff = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('is_active', true)
      .in('role', ['waitron', 'kitchen', 'bar', 'griller', 'manager'])
      .order('full_name')
    if (data) setStaff(data)
  }

  const fetchActiveShifts = async () => {
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .is('clock_out', null)
      .order('clock_in', { ascending: true })
    if (data) setActiveShifts(data)
  }

  const fetchTodayLog = async () => {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase
      .from('attendance')
      .select('*')
      .eq('date', today)
      .order('clock_in', { ascending: false })
    if (data) setTodayLog(data)
  }

  const clockIn = async (member) => {
    const already = activeShifts.find((s) => s.staff_id === member.id)
    if (already) {
      alert(member.full_name + ' is already clocked in!')
      return
    }
    const { error } = await supabase.from('attendance').insert({
      staff_id: member.id,
      staff_name: member.full_name,
      role: member.role,
      clock_in: new Date().toISOString(),
      date: new Date().toISOString().split('T')[0],
      recorded_by: profile?.id,
      recorded_by_name: profile?.full_name,
    })
    if (error) {
      alert('Error: ' + error.message)
      return
    }
    fetchAll()
  }

  const clockOut = (shift) => {
    // Show shift summary first — confirm clock-out from there
    setSummaryShift(shift)
  }

  const confirmClockOut = async (shift) => {
    const clockOutTime = new Date()
    const clockInTime = new Date(shift.clock_in)
    const duration = Math.round((clockOutTime - clockInTime) / 60000)

    const { error } = await supabase
      .from('attendance')
      .update({
        clock_out: clockOutTime.toISOString(),
        duration_minutes: duration,
      })
      .eq('id', shift.id)

    if (error) {
      alert('Error: ' + error.message)
      return
    }

    // Deallocate waitron from tables if role is waitron
    if (shift.role === 'waitron') {
      await supabase
        .from('tables')
        .update({ assigned_staff: null })
        .eq('assigned_staff', shift.staff_id)
      await supabase.from('zone_assignments').delete().eq('staff_id', shift.staff_id)
    }

    setSummaryShift(null)
    fetchAll()
  }

  const isActive = (staffId) => activeShifts.some((s) => s.staff_id === staffId)

  const formatDuration = (minutes) => {
    if (!minutes) return '—'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm'
  }

  const formatTime = (ts) =>
    ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

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
            {['active', 'all', 'log'].map((t) => (
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

      {/* ON SHIFT TAB */}
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
                  <p className="text-gray-400 text-xs capitalize">{shift.role}</p>
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

      {/* ALL STAFF TAB */}
      {tab === 'all' && (
        <div className="space-y-2">
          {staff.map((member) => (
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
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  On Shift
                </span>
              ) : (
                <button
                  onClick={() => clockIn(member)}
                  className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg px-3 py-1.5 text-sm transition-colors"
                >
                  <UserCheck size={14} /> Clock In
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* TODAY'S LOG TAB */}
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
                  <p className="text-gray-400 text-xs capitalize">{entry.role}</p>
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
                      <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                      Active
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
