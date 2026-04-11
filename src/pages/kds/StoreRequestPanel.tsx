import { useState, useEffect, useCallback } from 'react'
import { Package, Search, Plus, RefreshCw, Check, X, Clock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { audit } from '../../lib/audit'
import type { Profile } from '../../types'

interface InventoryItem {
  id: string
  item_name: string
  category: string | null
  unit: string
  current_stock: number
}

interface MyRequest {
  id: string
  item_name: string
  quantity: number
  unit: string
  status: string
  reject_reason: string | null
  approved_by_name: string | null
  created_at: string
  resolved_at: string | null
}

const elapsed = (iso: string) => {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function StoreRequestPanel() {
  const { profile } = useAuth()
  const toast = useToast()
  const [storeItems, setStoreItems] = useState<InventoryItem[]>([])
  const [myRequests, setMyRequests] = useState<MyRequest[]>([])
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reqDate, setReqDate] = useState(() => {
    const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
    if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
    return wat.toLocaleDateString('en-CA')
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    const dayStart = new Date(reqDate + 'T08:00:00+01:00')
    const dayEnd = new Date(dayStart)
    dayEnd.setDate(dayEnd.getDate() + 1)
    const [{ data: inv }, { data: reqs }] = await Promise.all([
      supabase
        .from('inventory')
        .select('id, item_name, category, unit, current_stock')
        .eq('is_active', true)
        .gt('current_stock', 0)
        .order('item_name'),
      supabase
        .from('store_requests')
        .select('*')
        .eq('requested_by', profile?.id)
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false }),
    ])
    setStoreItems((inv || []) as InventoryItem[])
    setMyRequests((reqs || []) as MyRequest[])
    setLoading(false)
  }, [profile?.id, reqDate])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('bar-store-requests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'store_requests' }, fetchData)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const submitRequest = async () => {
    if (!selectedItem || !qty || parseFloat(qty) <= 0) {
      toast.error('Invalid', 'Select an item and enter quantity')
      return
    }
    const quantity = parseFloat(qty)
    if (quantity > selectedItem.current_stock) {
      toast.error('Insufficient', `Only ${selectedItem.current_stock} available in store`)
      return
    }
    setSending(true)
    try {
      const dayStart = new Date(reqDate + 'T08:00:00+01:00')
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      const { data: existingPending, error: existingErr } = await supabase
        .from('store_requests')
        .select('id, quantity, reason')
        .eq('requested_by', profile?.id)
        .eq('inventory_id', selectedItem.id)
        .eq('status', 'pending')
        .gte('created_at', dayStart.toISOString())
        .lt('created_at', dayEnd.toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (existingErr) throw existingErr

      if (existingPending?.id) {
        const mergedReason =
          reason && reason !== existingPending.reason
            ? [existingPending.reason, reason].filter(Boolean).join(' | ')
            : existingPending.reason || reason || null
        const { error } = await supabase
          .from('store_requests')
          .update({
            quantity: Number(existingPending.quantity || 0) + quantity,
            reason: mergedReason,
          })
          .eq('id', existingPending.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('store_requests').insert({
          item_name: selectedItem.item_name,
          inventory_id: selectedItem.id,
          quantity,
          unit: selectedItem.unit,
          requested_by: profile?.id,
          requested_by_name: profile?.full_name,
          reason: reason || null,
          status: 'pending',
        })
        if (error) throw error
      }

      await audit({
        action: 'STORE_REQUEST_CREATED',
        entity: 'store_requests',
        entityName: selectedItem.item_name,
        newValue: { quantity, unit: selectedItem.unit, requested_by: profile?.full_name },
        performer: profile as Profile,
      })

      // Notify supervisors
      const { data: supervisors } = await supabase
        .from('profiles')
        .select('id')
        .in('role', ['supervisor', 'manager', 'owner'])
        .eq('is_active', true)
      for (const s of supervisors || []) {
        sendPushToStaff(
          s.id,
          '📦 Store Request',
          `${quantity}x ${selectedItem.item_name} requested by ${profile?.full_name}`
        ).catch(() => {})
      }
      toast.success(
        'Request Sent',
        `${quantity} ${selectedItem.unit} of ${selectedItem.item_name} requested`
      )
      setShowForm(false)
      setSelectedItem(null)
      setQty('')
      setReason('')
      fetchData()
    } catch (e: any) {
      toast.error('Error', e?.message || 'Failed to send request')
    }
    setSending(false)
  }

  const filtered = storeItems.filter(
    (i) =>
      i.item_name.toLowerCase().includes(search.toLowerCase()) ||
      (i.category || '').toLowerCase().includes(search.toLowerCase())
  )

  const pendingCount = myRequests.filter((r) => r.status === 'pending').length

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-white font-bold text-lg flex items-center gap-2">
          <Package size={18} className="text-amber-400" /> Store Requests
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="date"
            value={reqDate}
            onChange={(e) => setReqDate(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1 text-xs"
          />
          <button
            onClick={() => {
              const wat = new Date(new Date().toLocaleString('en-US', { timeZone: 'Africa/Lagos' }))
              if (wat.getHours() < 8) wat.setDate(wat.getDate() - 1)
              setReqDate(wat.toLocaleDateString('en-CA'))
            }}
            className="px-2 py-1 rounded-lg text-xs bg-amber-500 text-black font-medium"
          >
            Today
          </button>
          <button
            onClick={() => {
              const d = new Date(reqDate)
              d.setDate(d.getDate() - 1)
              setReqDate(d.toLocaleDateString('en-CA'))
            }}
            className="px-2 py-1 rounded-lg text-xs bg-gray-800 text-gray-400"
          >
            Prev
          </button>
          <button onClick={fetchData} className="text-gray-400 hover:text-white p-1">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1.5 bg-amber-500 text-black font-bold text-xs px-3 py-2 rounded-xl hover:bg-amber-400"
          >
            <Plus size={13} /> Request from Store
          </button>
        </div>
      </div>

      {/* Request form */}
      {showForm && (
        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-4 space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search store items..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setSelectedItem(null)
              }}
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              autoFocus
            />
          </div>

          {selectedItem ? (
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-xl px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-bold">{selectedItem.item_name}</p>
                  <p className="text-gray-500 text-xs">
                    Available: {selectedItem.current_stock} {selectedItem.unit}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="text-gray-500 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
              <input
                type="number"
                placeholder={`Quantity (${selectedItem.unit})`}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                autoFocus
              />
              <input
                type="text"
                placeholder="Reason (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowForm(false)
                    setSelectedItem(null)
                    setQty('')
                    setReason('')
                  }}
                  className="flex-1 py-2 bg-gray-800 text-gray-300 rounded-xl text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={submitRequest}
                  disabled={sending}
                  className="flex-1 py-2 bg-amber-500 text-black font-bold rounded-xl text-sm hover:bg-amber-400 disabled:opacity-50"
                >
                  {sending ? 'Sending...' : 'Send Request'}
                </button>
              </div>
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto space-y-1">
              {filtered.length === 0 ? (
                <p className="text-gray-500 text-xs text-center py-4">No items found</p>
              ) : (
                filtered.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setSelectedItem(item)
                      setSearch('')
                    }}
                    className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-xl px-3 py-2.5 flex items-center justify-between transition-colors"
                  >
                    <div>
                      <p className="text-white text-sm">{item.item_name}</p>
                      <p className="text-gray-500 text-xs">{item.category || 'General'}</p>
                    </div>
                    <span className="text-gray-400 text-xs">
                      {item.current_stock} {item.unit}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* My requests */}
      {loading ? (
        <div className="text-amber-500 text-center py-6">Loading...</div>
      ) : myRequests.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-500 text-sm">
            No requests yet. Tap "Request from Store" to start.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {pendingCount > 0 && (
            <p className="text-amber-400 text-xs font-bold mb-2">
              {pendingCount} pending request{pendingCount > 1 ? 's' : ''}
            </p>
          )}
          {myRequests.map((req) => (
            <div
              key={req.id}
              className={`bg-gray-900 border rounded-xl px-4 py-3 ${req.status === 'pending' ? 'border-amber-500/30' : req.status === 'approved' ? 'border-green-500/20' : 'border-red-500/20'}`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">
                    {req.quantity} {req.unit} — {req.item_name}
                  </p>
                  <p className="text-gray-500 text-xs">{elapsed(req.created_at)}</p>
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${req.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : req.status === 'approved' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
                >
                  {req.status === 'pending'
                    ? 'Pending'
                    : req.status === 'approved'
                      ? 'Approved'
                      : 'Rejected'}
                </span>
              </div>
              {req.status === 'approved' && req.approved_by_name && (
                <p className="text-green-400/70 text-xs mt-1">Approved by {req.approved_by_name}</p>
              )}
              {req.status === 'rejected' && req.reject_reason && (
                <p className="text-red-400/70 text-xs mt-1">Reason: {req.reject_reason}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
