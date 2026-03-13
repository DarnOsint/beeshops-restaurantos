import { Clock } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import type { WaitronStat, TimesheetEntry } from './types'

interface Props {
  waitronStats: WaitronStat[]
  timesheet: TimesheetEntry[]
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function StaffTab({ waitronStats, timesheet }: Props) {
  const totalMinutes = timesheet.reduce((s, e) => s + (e.duration_minutes || 0), 0)

  return (
    <div className="space-y-4">
      {/* Per-waitron cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {waitronStats.length === 0 ? (
          <div className="col-span-3 text-center py-12 text-gray-500">
            No staff sales data for this period
          </div>
        ) : (
          waitronStats.map((w, i) => (
            <div key={w.name} className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 font-bold">
                  {i + 1}
                </div>
                <div>
                  <p className="text-white font-semibold">{w.name}</p>
                  <p className="text-gray-500 text-xs">{w.orders} orders</p>
                </div>
              </div>
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-gray-400 text-xs">Revenue</p>
                  <p className="text-amber-400 font-bold text-xl">₦{w.revenue.toLocaleString()}</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-400 text-xs">Avg/Order</p>
                  <p className="text-white font-medium">
                    ₦{Math.round(w.revenue / w.orders).toLocaleString()}
                  </p>
                </div>
              </div>
              <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-amber-500 rounded-full"
                  style={{ width: `${(w.revenue / waitronStats[0].revenue) * 100}%` }}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bar chart */}
      {waitronStats.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Staff Revenue Comparison</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={waitronStats}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 10 }}
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

      {/* Timesheet */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
          <Clock size={16} className="text-amber-400" /> Timesheet
        </h3>
        {timesheet.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-sm">
            No attendance records for this period
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Staff', 'Role', 'Date', 'Clock In', 'Clock Out', 'Duration'].map((h, i) => (
                    <th
                      key={h}
                      className={`text-gray-400 text-xs uppercase py-2 ${i < 5 ? 'text-left pr-4' : 'text-right'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timesheet.map((entry) => (
                  <tr key={entry.id} className="border-b border-gray-800/50">
                    <td className="py-3 pr-4 text-white font-medium">{entry.staff_name}</td>
                    <td className="py-3 pr-4 text-gray-400 capitalize">{entry.role}</td>
                    <td className="py-3 pr-4 text-gray-400">{entry.date}</td>
                    <td className="py-3 pr-4 text-gray-300">
                      {new Date(entry.clock_in).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-3 pr-4 text-gray-300">
                      {entry.clock_out ? (
                        new Date(entry.clock_out).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      ) : (
                        <span className="text-green-400 text-xs">Still on shift</span>
                      )}
                    </td>
                    <td className="py-3 text-right text-amber-400 font-medium">
                      {formatDuration(entry.duration_minutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-700">
                  <td colSpan={5} className="py-3 text-gray-400 text-xs">
                    Total hours
                  </td>
                  <td className="py-3 text-right text-white font-bold">
                    {formatDuration(totalMinutes)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
