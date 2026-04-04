import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import KitchenStock from '../backoffice/KitchenStock'
import ErrorBoundary from '../../components/ErrorBoundary'
import {
  ChefHat,
  Clock,
  LogOut,
  RefreshCw,
  CheckCircle,
  BarChart2,
  Printer,
  RotateCcw,
  X,
  History,
} from 'lucide-react'
import type { KdsOrder } from './types'
import { useToast } from '../../context/ToastContext'
import DailySummaryTab from './DailySummaryTab'

const HELP_TIPS = [
  {
    id: 'kds-tabs',
    title: 'Orders & Stock Register',
    description:
      'The Kitchen Display has two tabs: Orders (incoming tickets) and Stock Register (daily food accountability). Switch between them using the tab buttons in the header.',
  },
  {
    id: 'kds-incoming',
    title: 'Incoming Orders',
    description:
      'Kitchen-destined items from any table order appear here automatically the moment a waitron confirms on the POS. Orders are sorted oldest first — always work from the top down.',
  },
  {
    id: 'kds-status',
    title: 'Item Status',
    description:
      'Each item starts as Pending. Tap to move to Preparing (amber), tap again when plated to mark Ready (green). Items move in one direction only — you cannot revert a Ready item.',
  },
  {
    id: 'kds-allready',
    title: 'All Ready Button',
    description:
      'Marks every kitchen item on the ticket ready at once. Hidden when all items are already ready. When tapped, the waitron is notified automatically to come and collect.',
  },
  {
    id: 'kds-urgency',
    title: 'Urgency Colours',
    description:
      'Grey = normal (under 10 min). Amber = getting late (10–20 min). Red = urgent (20+ min). Based on when the order was placed, not when items were added.',
  },
  {
    id: 'kds-notify',
    title: 'Waitron Notification',
    description:
      'Marking any item or the full order ready sends an automatic push notification to the assigned waitron. No need to call out across the kitchen.',
  },
  {
    id: 'kds-stockregister',
    title: 'Stock Register Tab',
    description:
      'Record what raw ingredients were received at the start of service. The system auto-syncs what was sold from POS and calculates what should remain. Entries are locked once submitted — contact a manager to make corrections. Benchmarks show expected yield so you know immediately if something is off.',
  },
]

function getElapsed(createdAt: string): string {
  const total = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (total < 60) return `${total}s`
  return `${Math.floor(total / 60)}m ${total % 60}s`
}
function getUrgencyColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 20) return 'border-red-500 bg-red-500/10 shadow-red-500/20 shadow-lg'
  if (mins >= 10) return 'border-amber-500 bg-amber-500/5'
  return 'border-gray-700 bg-gray-900'
}
function getTimerColor(createdAt: string): string {
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000)
  if (mins >= 20) return 'text-red-400 font-bold'
  if (mins >= 10) return 'text-amber-400 font-bold'
  return 'text-gray-400'
}
function getStatusColor(status: string): string {
  if (status === 'ready') return 'bg-green-500/20 text-green-400 cursor-default'
  if (status === 'preparing') return 'bg-amber-500/20 text-amber-400'
  return 'bg-gray-700 text-gray-400'
}
function getNextStatus(status: string): string | null {
  if (status === 'pending') return 'preparing'
  if (status === 'preparing') return 'ready'
  return null // ready items cannot be cycled back
}

function KitchenKDSInner() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  const printOrderTicket = (order: KdsOrder) => {
    const W = 40
    const divider = '-'.repeat(W)
    const centre = (s: string) => ' '.repeat(Math.max(0, Math.floor((W - s.length) / 2))) + s
    const fmtRow = (l: string, r: string) => {
      const space = W - l.length - r.length
      return l + ' '.repeat(Math.max(1, space)) + r
    }
    const itemLines = order.order_items
      .filter((i) => i.menu_items?.menu_categories?.destination === 'kitchen')
      .map((i) => fmtRow(`${i.quantity}x ${(i.menu_items?.name ?? '').substring(0, 28)}`, ''))
      .join('\n')
    const lines = [
      '',
      centre('** KITCHEN ORDER **'),
      divider,
      fmtRow('Table:', order.tables?.name ?? 'N/A'),
      fmtRow(
        'Time:',
        new Date(order.created_at).toLocaleTimeString('en-NG', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true,
        })
      ),
      divider,
      itemLines,
      divider,
      '',
    ].join('\n')
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Kitchen Ticket</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Courier New',monospace;font-size:13px;width:80mm;padding:4mm;white-space:pre;}
@media print{body{width:80mm;}@page{margin:0;size:80mm auto;}}</style></head><body>${lines}</body></html>`
    const win = window.open('', '_blank', 'width=400,height:500,toolbar=no,menubar=no')
    if (!win) return
    win.document.open('text/html', 'replace')
    win.document.write(html)
    win.document.close()
    win.onload = () =>
      setTimeout(() => {
        win.print()
        win.close()
      }, 200)
  }
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [tab, setTab] = useState<'orders' | 'stock' | 'summary' | 'returns' | 'history'>('orders')
  const [orders, setOrders] = useState<KdsOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [, setTick] = useState(0)
  const [returnItems, setReturnItems] = useState<
    (KdsOrder['order_items'][0] & { tableName: string; orderId: string; staffId?: string | null })[]
  >([])
  const [historyDate, setHistoryDate] = useState(new Date().toISOString().slice(0, 10))
  const [returnHistory, setReturnHistory] = useState<
    Array<{
      id: string
      item_name: string
      quantity: number
      item_total: number
      table_name: string | null
      waitron_name: string | null
      return_reason: string | null
      status: string
      requested_at: string
      resolved_at: string | null
    }>
  >([])

  const fetchReturnHistory = useCallback(
    async (d?: string) => {
      if (!profile) return
      const targetDate = d || historyDate
      const dayStart = new Date(targetDate)
      dayStart.setHours(8, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setDate(dayEnd.getDate() + 1)
      // Kitchen returns — filter by checking if item was kitchen-destined
      const { data } = await supabase
        .from('returns_log')
        .select(
          'id, item_name, quantity, item_total, table_name, waitron_name, return_reason, status, requested_at, resolved_at, order_item_id'
        )
        .gte('requested_at', dayStart.toISOString())
        .lte('requested_at', dayEnd.toISOString())
        .order('requested_at', { ascending: false })
      if (data) {
        // Filter to kitchen items by checking the order_items destination
        const itemIds = data.map((r) => r.order_item_id)
        if (itemIds.length > 0) {
          const { data: items } = await supabase
            .from('order_items')
            .select('id, menu_items(menu_categories(destination))')
            .in('id', itemIds)
          const kitchenIds = new Set(
            (items || [])
              .filter((i: any) => i.menu_items?.menu_categories?.destination === 'kitchen')
              .map((i: any) => i.id)
          )
          setReturnHistory(data.filter((r) => kitchenIds.has(r.order_item_id)))
        } else {
          setReturnHistory([])
        }
      }
    },
    [profile, historyDate]
  )

  const acceptReturn = async (itemId: string, staffId?: string | null, tableName?: string) => {
    const { error } = await supabase
      .from('order_items')
      .update({ return_accepted: true, return_accepted_at: new Date().toISOString() })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to accept return')
      return
    }
    // Recalculate order total
    const { data: itemData } = await supabase
      .from('order_items')
      .select('order_id, total_price')
      .eq('id', itemId)
      .single()
    if (itemData) {
      const { data: remaining } = await supabase
        .from('order_items')
        .select('total_price, return_accepted')
        .eq('order_id', itemData.order_id)
      const newTotal = (remaining || [])
        .filter((r: { return_accepted?: boolean }) => !r.return_accepted)
        .reduce((s: number, r: { total_price: number }) => s + (r.total_price || 0), 0)
      await supabase
        .from('orders')
        .update({ total_amount: newTotal, updated_at: new Date().toISOString() })
        .eq('id', itemData.order_id)
    }
    await supabase
      .from('returns_log')
      .update({
        status: 'bar_accepted',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    toast.success('Return Accepted', 'Item tentatively removed — awaiting manager final approval')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '↩ Return Accepted by Kitchen',
        `Return accepted for ${tableName ?? 'table'} — pending manager approval`
      )
    fetchOrders()
  }

  const rejectReturn = async (itemId: string, staffId?: string | null, tableName?: string) => {
    const { error } = await supabase
      .from('order_items')
      .update({
        return_requested: false,
        return_accepted: false,
        return_reason: null,
        return_requested_at: null,
      })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to reject return')
      return
    }
    await supabase
      .from('returns_log')
      .update({
        status: 'rejected',
        barman_id: profile?.id ?? null,
        barman_name: profile?.full_name ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq('order_item_id', itemId)
      .eq('status', 'pending')
    toast.success('Return Rejected', 'Item stays on bill')
    if (staffId)
      await sendPushToStaff(
        staffId,
        '❌ Return Rejected',
        `Return rejected for ${tableName ?? 'table'} — item stays on bill`
      )
    fetchOrders()
  }

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(
        `id, created_at, notes, staff_id,
        tables(name),
        order_items(id, quantity, status, destination, notes, return_requested, return_accepted, return_reason,
          menu_items(name, menu_categories(name, destination)))`
      )
      .eq('status', 'open')
      .order('created_at', { ascending: true })

    if (!error && data) {
      const allOrders = data as unknown as KdsOrder[]

      // Active kitchen orders (not ready/delivered, not return_accepted)
      const kitchen = allOrders
        .map((o) => ({
          ...o,
          order_items: o.order_items.filter(
            (i) =>
              i.menu_items?.menu_categories?.destination === 'kitchen' &&
              i.status !== 'delivered' &&
              i.status !== 'ready' &&
              !i.return_accepted
          ),
        }))
        .filter((o) => o.order_items.length > 0)
      setOrders(kitchen)

      // Return requests (kitchen items with return_requested but not yet accepted/rejected)
      const returns: typeof returnItems = []
      allOrders.forEach((o) => {
        o.order_items.forEach((i) => {
          if (
            i.menu_items?.menu_categories?.destination === 'kitchen' &&
            i.return_requested &&
            !i.return_accepted
          ) {
            returns.push({
              ...i,
              tableName: (o.tables as { name: string } | null)?.name ?? 'Unknown',
              orderId: o.id,
              staffId: o.staff_id,
            })
          }
        })
      })
      setReturnItems(returns)
    }
    setLoading(false)
  }, [])

  const updateItemStatus = async (itemId: string, currentStatus: string, orderId: string) => {
    const nextStatus = getNextStatus(currentStatus)
    if (!nextStatus) return // already ready — do nothing
    const { error } = await supabase
      .from('order_items')
      .update({ status: nextStatus })
      .eq('id', itemId)
    if (error) {
      toast.error('Error', 'Failed to update item: ' + error.message)
      return
    }
    if (nextStatus === 'ready') {
      const order = orders.find((o) => o.id === orderId)
      if (order?.staff_id) {
        const item = order.order_items.find((i) => i.id === itemId)
        await sendPushToStaff(
          order.staff_id,
          '✅ Item Ready',
          `${item?.menu_items?.name || 'Item'} ready for ${order.tables?.name || 'a table'}`
        )
      }
    }
    fetchOrders()
  }

  const markAllReady = async (order: KdsOrder) => {
    // Only mark kitchen-destined items ready
    const kitchenItemIds = order.order_items
      .filter(
        (i) => i.menu_items?.menu_categories?.destination === 'kitchen' && i.status !== 'ready'
      )
      .map((i) => i.id)
    if (!kitchenItemIds.length) return
    const { error: kaErr } = await supabase
      .from('order_items')
      .update({ status: 'ready' })
      .in('id', kitchenItemIds)
    if (kaErr) {
      toast.error('Error', 'Failed to mark all ready: ' + kaErr.message)
      return
    }
    if (order.staff_id)
      await sendPushToStaff(
        order.staff_id,
        '✅ Order Ready',
        `Kitchen order for ${order.tables?.name || 'a table'} is ready to serve`
      )
    fetchOrders()
  }

  useEffect(() => {
    fetchOrders()
    fetchReturnHistory()
    const tickTimer = setInterval(() => setTick((t) => t + 1), 1000)
    const pollTimer = setInterval(() => {
      fetchOrders()
      fetchReturnHistory()
    }, 10000)
    const channel = supabase
      .channel('kitchen-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, fetchOrders)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
      .subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchOrders()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tickTimer)
      clearInterval(pollTimer)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fetchOrders, fetchReturnHistory])

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading Kitchen Display...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-500 flex items-center justify-center">
            <ChefHat size={18} className="text-white" />
          </div>
          <div>
            <h1 className="text-white font-bold">Kitchen Display</h1>
            <p className="text-gray-400 text-xs">
              {orders.length} active order{orders.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-800 rounded-xl p-0.5">
            <button
              onClick={() => setTab('orders')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === 'orders' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Orders
            </button>
            <button
              onClick={() => setTab('returns')}
              className={`relative px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === 'returns' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Returns
              {returnItems.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {returnItems.length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                setTab('history')
                fetchReturnHistory()
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === 'history' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              History
            </button>
            <button
              onClick={() => setTab('stock')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === 'stock' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Stock
            </button>
            <button
              onClick={() => setTab('summary')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${tab === 'summary' ? 'bg-red-500 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              Today
            </button>
          </div>
          {tab === 'orders' && (
            <button onClick={fetchOrders} className="text-gray-400 hover:text-white">
              <RefreshCw size={16} />
            </button>
          )}
          <p className="text-gray-400 text-sm">{profile?.full_name}</p>
          <HelpTooltip storageKey="kitchen-kds" tips={HELP_TIPS} />
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={16} />
          </button>
        </div>
      </nav>

      {/* Returns Tab */}
      {tab === 'returns' ? (
        <div className="flex-1 p-4 overflow-y-auto">
          {returnItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-16">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <RotateCcw size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 font-medium">No pending return requests</p>
              <p className="text-gray-600 text-sm mt-1">
                Return requests from waitrons will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-w-lg mx-auto">
              {returnItems.map((item) => (
                <div key={item.id} className="bg-gray-900 border border-red-500/30 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <p className="text-white font-bold text-sm">
                        {item.quantity}x {item.menu_items?.name || 'Item'}
                      </p>
                      <p className="text-gray-400 text-xs mt-0.5">Table: {item.tableName}</p>
                      {item.return_reason && (
                        <p className="text-amber-400 text-xs mt-1 italic">
                          Reason: &quot;{item.return_reason}&quot;
                        </p>
                      )}
                    </div>
                    <span className="text-red-400 text-xs font-semibold bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-lg whitespace-nowrap">
                      ↩ Return Request
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => acceptReturn(item.id, item.staffId, item.tableName)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-green-500/20 hover:bg-green-500/30 border border-green-500/30 text-green-400 font-semibold text-sm py-2.5 rounded-xl transition-colors"
                    >
                      <CheckCircle size={14} /> Accept Return
                    </button>
                    <button
                      onClick={() => rejectReturn(item.id, item.staffId, item.tableName)}
                      className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-400 font-semibold text-sm py-2.5 rounded-xl transition-colors"
                    >
                      <X size={14} /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'history' ? (
        <div className="flex-1 p-4 overflow-y-auto">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <input
                type="date"
                value={historyDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => {
                  setHistoryDate(e.target.value)
                  fetchReturnHistory(e.target.value)
                }}
                className="bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-red-500"
              />
              <button
                onClick={() => {
                  const d = new Date().toISOString().slice(0, 10)
                  setHistoryDate(d)
                  fetchReturnHistory(d)
                }}
                className={`px-3 py-2 rounded-xl text-xs font-medium transition-colors ${historyDate === new Date().toISOString().slice(0, 10) ? 'bg-red-500 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
              >
                Today
              </button>
              <button
                onClick={() => {
                  const d = new Date(historyDate)
                  d.setDate(d.getDate() - 1)
                  const ds = d.toISOString().slice(0, 10)
                  setHistoryDate(ds)
                  fetchReturnHistory(ds)
                }}
                className="px-3 py-2 rounded-xl text-xs bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                Prev Day
              </button>
            </div>
          </div>
          {returnHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-12">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <History size={28} className="text-gray-600" />
              </div>
              <p className="text-gray-400 font-medium">
                No kitchen returns for{' '}
                {historyDate === new Date().toISOString().slice(0, 10) ? 'today' : historyDate}
              </p>
            </div>
          ) : (
            <div className="max-w-lg mx-auto space-y-2">
              <div className="flex items-center justify-between mb-3">
                <p className="text-gray-500 text-xs uppercase tracking-wider">
                  Kitchen Returns — {returnHistory.length} total
                </p>
                <p className="text-gray-400 text-xs font-bold">
                  ₦
                  {returnHistory
                    .filter((r) => r.status === 'accepted' || r.status === 'bar_accepted')
                    .reduce((s, r) => s + (r.item_total || 0), 0)
                    .toLocaleString()}{' '}
                  accepted
                </p>
              </div>
              {returnHistory.map((r) => (
                <div
                  key={r.id}
                  className={`bg-gray-900 border rounded-xl p-3 ${
                    r.status === 'accepted' || r.status === 'bar_accepted'
                      ? 'border-green-500/20'
                      : r.status === 'rejected'
                        ? 'border-red-500/20'
                        : 'border-amber-500/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <p className="text-white text-sm font-semibold">
                        {r.quantity}x {r.item_name}
                      </p>
                      <p className="text-gray-500 text-xs">
                        {r.table_name || 'Unknown'} — by {r.waitron_name || 'Unknown'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                          r.status === 'accepted' || r.status === 'bar_accepted'
                            ? 'bg-green-500/20 text-green-400'
                            : r.status === 'rejected'
                              ? 'bg-red-500/20 text-red-400'
                              : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {r.status === 'bar_accepted' ? 'kitchen accepted' : r.status}
                      </span>
                      <p className="text-gray-400 text-xs mt-1">
                        ₦{(r.item_total || 0).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  {r.return_reason && (
                    <p className="text-gray-500 text-xs italic">Reason: {r.return_reason}</p>
                  )}
                  <p className="text-gray-600 text-[10px] mt-1">
                    {new Date(r.requested_at).toLocaleTimeString('en-NG', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                    {r.resolved_at && (
                      <>
                        {' '}
                        — resolved{' '}
                        {new Date(r.resolved_at).toLocaleTimeString('en-NG', {
                          hour: '2-digit',
                          minute: '2-digit',
                          hour12: true,
                        })}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'summary' ? (
        <DailySummaryTab
          destination="kitchen"
          icon={<ChefHat size={24} className="text-red-400" />}
          color="text-red-400"
        />
      ) : tab === 'stock' ? (
        <div className="flex-1 overflow-y-auto">
          <KitchenStock onBack={() => setTab('orders')} />
        </div>
      ) : (
        <div className="flex-1 p-4 overflow-y-auto">
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-20 h-20 bg-gray-800 rounded-full flex items-center justify-center mb-4">
                <ChefHat size={32} className="text-gray-600" />
              </div>
              <p className="text-gray-400 text-lg font-medium">No pending kitchen orders</p>
              <p className="text-gray-600 text-sm mt-1">
                New orders will appear here automatically
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {orders.map((order) => (
                <div
                  key={order.id}
                  className={`rounded-2xl border-2 p-4 flex flex-col gap-3 transition-colors ${getUrgencyColor(order.created_at)}`}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-white font-bold text-lg">{order.tables?.name}</h2>
                    <div className="flex items-center gap-1 text-gray-400 text-xs">
                      <Clock size={12} />
                      <span className={getTimerColor(order.created_at)}>
                        {getElapsed(order.created_at)}
                      </span>
                    </div>
                  </div>
                  {order.notes && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <p className="text-amber-400 text-xs">📝 {order.notes}</p>
                    </div>
                  )}
                  <div className="flex flex-col gap-2 flex-1">
                    {order.order_items.map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-bold text-lg w-6">
                            {item.quantity}x
                          </span>
                          <span className="text-white text-sm">{item.menu_items?.name}</span>
                        </div>
                        <button
                          onClick={() => updateItemStatus(item.id, item.status, order.id)}
                          disabled={item.status === 'ready'}
                          className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${getStatusColor(item.status)}`}
                        >
                          {item.status === 'pending'
                            ? 'Pending'
                            : item.status === 'preparing'
                              ? 'Preparing'
                              : '✓ Ready'}
                        </button>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => printOrderTicket(order)}
                    className="flex items-center gap-1 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1.5 rounded-lg transition-colors"
                  >
                    <Printer size={11} /> Print
                  </button>
                  {order.order_items.some((i) => i.status !== 'ready') && (
                    <button
                      onClick={() => markAllReady(order)}
                      className="w-full bg-green-500 hover:bg-green-400 text-white font-bold rounded-xl py-2.5 flex items-center justify-center gap-2 transition-colors"
                    >
                      <CheckCircle size={16} /> All Ready
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function KitchenKDS() {
  return (
    <ErrorBoundary title="Kitchen Display Error">
      <KitchenKDSInner />
    </ErrorBoundary>
  )
}
