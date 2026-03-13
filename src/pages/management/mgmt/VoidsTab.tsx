import { Trash2 } from 'lucide-react'

interface VoidEntry {
  id: string
  menu_item_name: string
  total_value: number
  void_type: string
  quantity: number
  unit_price: number
  reason: string | null
  approved_by_name: string | null
  voided_by_name: string | null
  created_at: string
}

interface Props {
  voidLog: VoidEntry[]
  loading: boolean
}

export default function VoidsTab({ voidLog, loading }: Props) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-white font-bold">Void Log — Today</p>
        <span className="text-gray-500 text-xs">
          {voidLog.length} record{voidLog.length !== 1 ? 's' : ''}
        </span>
      </div>
      {loading && <p className="text-gray-500 text-sm text-center py-8">Loading...</p>}
      {!loading && voidLog.length === 0 && (
        <div className="text-center py-12">
          <Trash2 size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No voids recorded today</p>
        </div>
      )}
      {voidLog.map((v) => (
        <div key={v.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-white font-bold text-sm leading-tight flex-1 min-w-0 truncate">
              {v.menu_item_name}
            </p>
            <p className="text-red-400 font-bold text-sm shrink-0">
              -₦{v.total_value?.toLocaleString()}
            </p>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-gray-500 text-xs">
              {v.void_type === 'order' ? 'Full order void' : `Qty: ${v.quantity}`}
            </p>
            <p className="text-gray-600 text-xs">₦{v.unit_price?.toLocaleString()} each</p>
          </div>
          <div className="border-t border-gray-800 pt-2 space-y-0.5">
            {v.reason && <p className="text-gray-400 text-xs">Reason: {v.reason}</p>}
            <p className="text-gray-600 text-xs">Approved: {v.approved_by_name || 'N/A'}</p>
            {v.voided_by_name && <p className="text-gray-600 text-xs">By: {v.voided_by_name}</p>}
            <p className="text-gray-600 text-xs">
              {new Date(v.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}
