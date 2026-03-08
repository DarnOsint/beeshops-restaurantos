import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { UserCheck, UserX, Clock, X } from 'lucide-react'

export default function ShiftManager({ onClose }) {
  const [staff, setStaff] = useState([])
  const [activeSessions, setActiveSessions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStaff()
    fetchActiveSessions()
  }, [])

  const fetchStaff = async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('is_active', true)
      .in('role', ['waitron', 'manager'])
      .order('full_name')
    if (!error) setStaff(data)
    setLoading(false)
  }

  const fetchActiveSessions = async () => {
    const { data, error } = await supabase
      .from('till_sessions')
      .select('*, profiles(full_name, role)')
      .eq('status', 'open')
    if (!error) setActiveSessions(data)
  }

  const clockIn = async (staffMember) => {
    const already = activeSessions.find(s => s.staff_id === staffMember.id)
    if (already) {
      alert(`${staffMember.full_name} is already clocked in!`)
      return
    }

    const { error } = await supabase
      .from('till_sessions')
      .insert({
        staff_id: staffMember.id,
        opening_float: 0,
        status: 'open'
      })

    if (!error) {
      fetchActiveSessions()
      alert(`${staffMember.full_name} clocked in successfully!`)
    }
  }

  const clockOut = async (session) => {
    const confirm = window.confirm(
      `Clock out ${session.profiles?.full_name}? This will close their shift.`
    )
    if (!confirm) return

    const { error } = await supabase
      .from('till_sessions')
      .update({
        status: 'closed',
        closed_at: new Date().toISOString()
      })
      .eq('id', session.id)

    if (!error) {
      fetchActiveSessions()
      alert(`${session.profiles?.full_name} clocked out successfully!`)
    }
  }

  const isActive = (staffId) => activeSessions.some(s => s.staff_id === staffId)

  if (loading) return (
    <div className="flex items-center justify-center p-8">
      <div className="text-amber-500">Loading...</div>
    </div>
  )

  return (
    <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-white font-bold text-lg">Shift Manager</h3>
        {onClose && (
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        )}
      </div>

      {/* Active Staff */}
      {activeSessions.length > 0 && (
        <div className="mb-5">
          <p className="text-green-400 text-sm font-medium mb-3 flex items-center gap-2">
            <Clock size={14} />
            Currently On Shift ({activeSessions.length})
          </p>
          <div className="space-y-2">
            {activeSessions.map(session => (
              <div key={session.id} className="flex items-center justify-between bg-green-500/10 border border-green-500/20 rounded-xl p-3">
                <div>
                  <p className="text-white font-medium">{session.profiles?.full_name}</p>
                  <p className="text-gray-400 text-xs capitalize">{session.profiles?.role}</p>
                  <p className="text-green-400 text-xs mt-0.5">
                    Since {new Date(session.opened_at).toLocaleTimeString()}
                  </p>
                </div>
                <button
                  onClick={() => clockOut(session)}
                  className="flex items-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg px-3 py-1.5 text-sm transition-colors"
                >
                  <UserX size={14} />
                  Clock Out
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Staff */}
      <div>
        <p className="text-gray-400 text-sm font-medium mb-3">All Staff</p>
        <div className="space-y-2">
          {staff.map(member => {
            const active = isActive(member.id)
            return (
              <div key={member.id} className="flex items-center justify-between bg-gray-800 rounded-xl p-3">
                <div>
                  <p className="text-white font-medium">{member.full_name}</p>
                  <p className="text-gray-400 text-xs capitalize">{member.role}</p>
                </div>
                {active ? (
                  <span className="flex items-center gap-1 text-green-400 text-xs bg-green-500/10 px-2 py-1 rounded-lg">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    On Shift
                  </span>
                ) : (
                  <button
                    onClick={() => clockIn(member)}
                    className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-lg px-3 py-1.5 text-sm transition-colors"
                  >
                    <UserCheck size={14} />
                    Clock In
                  </button>
                )}
              </div>
            )
          })}
          {staff.length === 0 && (
            <div className="text-center py-6 text-gray-500">
              <p>No staff found</p>
              <p className="text-xs mt-1">Add staff in the Back Office</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}