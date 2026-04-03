import { useState, useEffect, useCallback } from 'react'
import { Clock, ChevronLeft, ChevronRight, Printer } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '../../lib/supabase'
import type { WaitronStat, TimesheetEntry } from './types'

interface Props {
  waitronStats: WaitronStat[]
  timesheet: TimesheetEntry[]
}

function fmtDuration(minutes: number | null): string {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

function fmtTime(d: string) {
  return new Date(d).toLocaleTimeString('en-NG', {
    timeZone: 'Africa/Lagos',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

function getWeekDates(refDate: string): string[] {
  const d = new Date(refDate)
  const day = d.getDay()
  const mon = new Date(d)
  mon.setDate(d.getDate() - ((day + 6) % 7)) // Monday
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const dd = new Date(mon)
    dd.setDate(mon.getDate() + i)
    days.push(dd.toISOString().slice(0, 10))
  }
  return days
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function StaffTab({ waitronStats, timesheet }: Props) {
  const [weekRef, setWeekRef] = useState(new Date().toISOString().slice(0, 10))
  const [weekAttendance, setWeekAttendance] = useState<Record<string, Set<string>>>({})
  const [staffList, setStaffList] = useState<Array<{ id: string; name: string; role: string }>>([])
  const [loadingWeek, setLoadingWeek] = useState(false)

  const weekDates = getWeekDates(weekRef)

  const fetchWeekAttendance = useCallback(async () => {
    setLoadingWeek(true)
    const startDate = weekDates[0]
    const endDate = weekDates[6]

    const [attRes, staffRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('staff_id, staff_name, role, date, duration_minutes')
        .gte('date', startDate)
        .lte('date', endDate),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('is_active', true)
        .order('full_name'),
    ])

    if (staffRes.data) {
      setStaffList(
        staffRes.data.map((s: { id: string; full_name: string; role: string }) => ({
          id: s.id,
          name: s.full_name,
          role: s.role,
        }))
      )
    }

    const map: Record<string, Set<string>> = {}
    if (attRes.data) {
      for (const row of attRes.data as Array<{
        staff_id: string
        date: string
        duration_minutes?: number
      }>) {
        if (!map[row.staff_id]) map[row.staff_id] = new Set()
        map[row.staff_id].add(row.date)
      }
    }
    setWeekAttendance(map)
    setLoadingWeek(false)
  }, [weekDates[0], weekDates[6]])

  useEffect(() => {
    fetchWeekAttendance()
  }, [fetchWeekAttendance])

  const prevWeek = () => {
    const d = new Date(weekRef)
    d.setDate(d.getDate() - 7)
    setWeekRef(d.toISOString().slice(0, 10))
  }
  const nextWeek = () => {
    const d = new Date(weekRef)
    d.setDate(d.getDate() + 7)
    if (d <= new Date()) setWeekRef(d.toISOString().slice(0, 10))
  }
  const thisWeek = () => setWeekRef(new Date().toISOString().slice(0, 10))

  const totalMinutes = timesheet.reduce((s, e) => s + (e.duration_minutes || 0), 0)
  const activeStaff = timesheet.filter((e) => !e.clock_out)

  return (
    <div className="space-y-4">
      {/* Staff sales — compact table */}
      {waitronStats.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800">
            <h3 className="text-white font-semibold text-sm">Staff Sales</h3>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">#</th>
                <th className="text-left px-2 py-2">Staff</th>
                <th className="text-right px-2 py-2">Orders</th>
                <th className="text-right px-2 py-2">Revenue</th>
                <th className="text-right px-2 py-2">Avg</th>
                <th className="text-right px-3 py-2">%</th>
              </tr>
            </thead>
            <tbody>
              {waitronStats.map((w, i) => {
                const totalRev = waitronStats.reduce((s, ws) => s + ws.revenue, 0)
                return (
                  <tr key={w.name} className="border-t border-gray-800 hover:bg-gray-800/50">
                    <td className="px-3 py-2 text-gray-600">{i + 1}</td>
                    <td className="px-2 py-2 text-white font-medium">{w.name}</td>
                    <td className="px-2 py-2 text-gray-300 text-right">{w.orders}</td>
                    <td className="px-2 py-2 text-amber-400 text-right font-bold">
                      ₦{w.revenue.toLocaleString()}
                    </td>
                    <td className="px-2 py-2 text-gray-400 text-right">
                      ₦{Math.round(w.revenue / w.orders).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-gray-500 text-right">
                      {totalRev ? Math.round((w.revenue / totalRev) * 100) : 0}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-gray-700 bg-gray-800/50 font-bold text-sm">
                <td className="px-3 py-2" colSpan={2}>
                  TOTAL
                </td>
                <td className="px-2 py-2 text-right text-white">
                  {waitronStats.reduce((s, w) => s + w.orders, 0)}
                </td>
                <td className="px-2 py-2 text-right text-amber-400">
                  ₦{waitronStats.reduce((s, w) => s + w.revenue, 0).toLocaleString()}
                </td>
                <td className="px-2 py-2" colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {waitronStats.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
          No staff sales data for this period
        </div>
      )}

      {/* Revenue chart */}
      {waitronStats.length > 1 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={waitronStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 10 }} />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 9 }}
                tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '8px',
                }}
                formatter={(v: number) => [`₦${v.toLocaleString()}`, 'Revenue']}
              />
              <Bar dataKey="revenue" fill="#f59e0b" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 7-Day Attendance Grid */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm flex items-center gap-2">
            <Clock size={14} className="text-amber-400" /> Weekly Attendance
          </h3>
          <div className="flex items-center gap-2">
            <button onClick={prevWeek} className="text-gray-400 hover:text-white p-1">
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={thisWeek}
              className="text-gray-400 hover:text-white text-xs px-2 py-1 bg-gray-800 rounded-lg"
            >
              This Week
            </button>
            <button onClick={nextWeek} className="text-gray-400 hover:text-white p-1">
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
        {loadingWeek ? (
          <div className="text-center py-6 text-amber-500 text-sm">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-800">
                  <th className="text-left px-3 py-2 text-gray-400 min-w-[140px]">Staff</th>
                  <th className="text-left px-1 py-2 text-gray-500 text-[10px]">Role</th>
                  {weekDates.map((d, i) => (
                    <th key={d} className="text-center px-1 py-2 text-gray-400 min-w-[40px]">
                      <div className="text-[9px]">{DAY_LABELS[i]}</div>
                      <div className="text-[10px] text-gray-500">{new Date(d).getDate()}</div>
                    </th>
                  ))}
                  <th className="text-center px-2 py-2 text-gray-400">Days</th>
                </tr>
              </thead>
              <tbody>
                {staffList
                  .filter((s) => !['owner', 'executive', 'auditor'].includes(s.role))
                  .map((staff) => {
                    const attended = weekAttendance[staff.id] || new Set()
                    const daysWorked = weekDates.filter((d) => attended.has(d)).length
                    return (
                      <tr
                        key={staff.id}
                        className="border-t border-gray-800/50 hover:bg-gray-800/30"
                      >
                        <td className="px-3 py-1.5 text-white font-medium truncate max-w-[160px]">
                          {staff.name}
                        </td>
                        <td className="px-1 py-1.5 text-gray-500 capitalize text-[10px]">
                          {staff.role.replace('_', ' ')}
                        </td>
                        {weekDates.map((d) => {
                          const present = attended.has(d)
                          const isToday = d === new Date().toISOString().slice(0, 10)
                          const isFuture = d > new Date().toISOString().slice(0, 10)
                          return (
                            <td key={d} className="text-center px-1 py-1.5">
                              {isFuture ? (
                                <span className="text-gray-700">·</span>
                              ) : (
                                <span
                                  className={`inline-block w-5 h-5 rounded-md text-[10px] font-bold leading-5 ${
                                    present
                                      ? 'bg-green-500/20 text-green-400'
                                      : isToday
                                        ? 'bg-gray-800 text-gray-600'
                                        : 'bg-red-500/10 text-red-400/50'
                                  }`}
                                >
                                  {present ? '✓' : '✗'}
                                </span>
                              )}
                            </td>
                          )
                        })}
                        <td className="text-center px-2 py-1.5">
                          <span
                            className={`text-xs font-bold ${daysWorked >= 5 ? 'text-green-400' : daysWorked >= 3 ? 'text-amber-400' : 'text-red-400'}`}
                          >
                            {daysWorked}/7
                          </span>
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Timesheet — current period */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <h3 className="text-white font-semibold text-sm">Timesheet</h3>
          <div className="flex items-center gap-3">
            {activeStaff.length > 0 && (
              <span className="flex items-center gap-1 text-green-400 text-xs">
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                {activeStaff.length} active
              </span>
            )}
            <span className="text-gray-500 text-xs">
              {timesheet.length} records · {fmtDuration(totalMinutes)} total
            </span>
          </div>
        </div>
        {timesheet.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            No attendance records for this period
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="text-left px-3 py-2">Staff</th>
                <th className="text-left px-2 py-2">Role</th>
                <th className="text-left px-2 py-2">Date</th>
                <th className="text-left px-2 py-2">In</th>
                <th className="text-left px-2 py-2">Out</th>
                <th className="text-right px-3 py-2">Hours</th>
              </tr>
            </thead>
            <tbody>
              {timesheet.map((entry) => {
                const isActive = !entry.clock_out
                const hours = entry.duration_minutes
                  ? (entry.duration_minutes / 60).toFixed(1)
                  : isActive
                    ? '—'
                    : '0'
                return (
                  <tr
                    key={entry.id}
                    className={`border-t border-gray-800/50 ${isActive ? 'bg-green-500/5' : ''}`}
                  >
                    <td className="px-3 py-2 text-white font-medium">{entry.staff_name}</td>
                    <td className="px-2 py-2 text-gray-500 capitalize">{entry.role}</td>
                    <td className="px-2 py-2 text-gray-400">{entry.date}</td>
                    <td className="px-2 py-2 text-gray-300">{fmtTime(entry.clock_in)}</td>
                    <td className="px-2 py-2 text-gray-300">
                      {entry.clock_out ? (
                        fmtTime(entry.clock_out)
                      ) : (
                        <span className="text-green-400 text-[10px]">Active</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-amber-400 font-medium">{hours}h</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
