import { Trash2 } from 'lucide-react'
import type { VoidEntry } from './types'

interface Props {
  voidLog: VoidEntry[]
  voidLoading: boolean
  voidDateFilter: string
  onDateChange: (d: string) => void
}

export default function VoidsTab({ voidLog, voidLoading, voidDateFilter, onDateChange }: Props) {
  const totalValue = voidLog.reduce((s, v) => s + (v.total_value || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-white font-bold">Void Log</p>
        <input
          type="date"
          value={voidDateFilter}
          onChange={(e) => onDateChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500"
        />
      </div>

      {voidLoading && <p className="text-gray-500 text-sm text-center py-8">Loading...</p>}

      {!voidLoading && voidLog.length === 0 && (
        <div className="text-center py-12">
          <Trash2 size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No voids recorded for this date</p>
        </div>
      )}

      {!voidLoading && voidLog.length > 0 && (
        <>
          <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
              <span className="text-gray-400 text-sm">
                {voidLog.length} void{voidLog.length !== 1 ? 's' : ''}
              </span>
              <span className="text-red-400 font-bold">-₦{totalValue.toLocaleString()} total</span>
            </div>
          </div>

          {voidLog.map((v) => (
            <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <p className="text-white font-bold text-sm">{v.menu_item_name}</p>
                  <p className="text-gray-500 text-xs mt-0.5">
                    {v.void_type === 'order'
                      ? 'Full order void'
                      : `Qty: ${v.quantity} · ₦${v.unit_price?.toLocaleString()} each`}
                  </p>
                </div>
                <p className="text-red-400 font-bold shrink-0">
                  -₦{v.total_value?.toLocaleString()}
                </p>
              </div>
              <div className="border-t border-gray-800 pt-2 mt-2 space-y-0.5">
                {v.reason && <p className="text-gray-400 text-xs">Reason: {v.reason}</p>}
                <p className="text-gray-500 text-xs">Approved by: {v.approved_by_name || 'N/A'}</p>
                {v.voided_by_name && (
                  <p className="text-gray-500 text-xs">Voided by: {v.voided_by_name}</p>
                )}
                <p className="text-gray-600 text-xs">
                  {new Date(v.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
