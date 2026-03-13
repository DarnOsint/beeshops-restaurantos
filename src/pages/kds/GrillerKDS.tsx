import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { sendPushToStaff } from '../../hooks/usePushNotifications'
import { HelpTooltip } from '../../components/HelpTooltip'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import { useAuth } from '../../context/AuthContext'
import ErrorBoundary from '../../components/ErrorBoundary'
import { LogOut, RefreshCw, Flame, CheckCircle, AlertTriangle } from 'lucide-react'
import type { GrillerTicket, GrillerItem } from './types'

const HELP_TIPS = [
  {
    id: 'grill-tickets',
    title: 'Grill Tickets',
    description:
      'Each card is a grill ticket grouping all grillable items from a single order. Tickets arrive automatically when a waitron confirms an order on the POS. They are sorted oldest first — work from the top.',
  },
  {
    id: 'grill-items',
    title: 'Marking Items Done',
    description:
      'Tap the Done button next to each individual item as it comes off the grill. Once all items on a ticket are marked done, the waitron is automatically notified to collect.',
  },
  {
    id: 'grill-allready',
    title: 'Ticket Complete Button',
    description:
      'Use the All Done — Ticket Complete button at the bottom of a ticket to mark every item ready at once. Use this when the full order is plated and ready to go together.',
  },
  {
    id: 'grill-urgency',
    title: 'Urgency Colours',
    description:
      'Ticket headers change colour based on wait time — grey is normal (under 10 minutes), amber means getting late (10–20 minutes), red with a pulsing icon means critically overdue (20+ minutes).',
  },
  {
    id: 'grill-notes',
    title: 'Item Notes',
    description:
      'Special instructions added by the waitron (e.g. well done, no pepper) appear in amber text under the item name. Always read notes before you start cooking.',
  },
  {
    id: 'grill-sound',
    title: 'New Order Alert',
    description:
      'The screen plays a sound when a new ticket arrives while you are on this page. If you do not hear sounds, check that your device volume is turned up.',
  },
]

type Urgency = 'normal' | 'warning' | 'critical'

function getElapsed(createdAt: string): string {
  const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000)
  if (diff < 60) return `${diff}s`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`
}

function getUrgency(createdAt: string): Urgency {
  const mins = (Date.now() - new Date(createdAt).getTime()) / 60000
  if (mins > 20) return 'critical'
  if (mins > 10) return 'warning'
  return 'normal'
}

const URGENCY_STYLES: Record<
  Urgency,
  { border: string; header: string; flame: string; time: string }
> = {
  normal: {
    border: 'border-gray-700',
    header: 'bg-gray-800',
    flame: 'text-orange-400',
    time: 'text-gray-400',
  },
  warning: {
    border: 'border-amber-500/50',
    header: 'bg-amber-500/10',
    flame: 'text-amber-400',
    time: 'text-amber-400',
  },
  critical: {
    border: 'border-red-500/50',
    header: 'bg-red-500/10',
    flame: 'text-red-400',
    time: 'text-red-400',
  },
}

function GrillerKDSInner() {
  const { profile, signOut } = useAuth()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')
  const [tickets, setTickets] = useState<GrillerTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [completing, setCompleting] = useState<Record<string, boolean>>({})
  const [, setTick] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const fetchTickets = async (isRealtime = false) => {
    const { data, error } = await supabase
      .from('order_items')
      .select(
        `*, menu_items(name, menu_categories(name, destination)),
        orders(id, order_type, customer_name, staff_id, tables(name))`
      )
      .in('status', ['pending', 'preparing'])
      .order('created_at', { ascending: true })

    if (error) {
      console.error(error)
      return
    }

    const grillerItems = ((data || []) as GrillerItem[]).filter(
      (i) => i.menu_items?.menu_categories?.destination === 'griller'
    )

    const orderMap: Record<string, GrillerTicket> = {}
    grillerItems.forEach((item) => {
      const oid = item.order_id
      if (!orderMap[oid]) {
        orderMap[oid] = {
          orderId: oid,
          orderType: item.orders?.order_type,
          tableName: item.orders?.tables?.name || item.orders?.customer_name || 'Counter',
          staffId: item.orders?.staff_id || null,
          createdAt: item.created_at as unknown as string,
          items: [],
        }
      }
      orderMap[oid].items.push(item)
    })

    const newTickets = Object.values(orderMap).sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )

    if (isRealtime && newTickets.length > tickets.length) audioRef.current?.play().catch(() => {})

    setTickets(newTickets)
    setLoading(false)
  }

  const markItemReady = async (item: GrillerItem, ticket: GrillerTicket) => {
    setCompleting((p) => ({ ...p, [item.id]: true }))
    await supabase.from('order_items').update({ status: 'ready' }).eq('id', item.id)
    setCompleting((p) => ({ ...p, [item.id]: false }))
    if (ticket.staffId)
      await sendPushToStaff(
        ticket.staffId,
        '✅ Item Ready',
        `${item.menu_items?.name || 'Item'} ready for ${ticket.tableName}`
      )
  }

  const markAllReady = async (ticket: GrillerTicket) => {
    const ids = ticket.items.map((i) => i.id)
    ids.forEach((id) => setCompleting((p) => ({ ...p, [id]: true })))
    await supabase.from('order_items').update({ status: 'ready' }).in('id', ids)
    ids.forEach((id) => setCompleting((p) => ({ ...p, [id]: false })))
    if (ticket.staffId)
      await sendPushToStaff(
        ticket.staffId,
        '✅ Order Ready',
        `Grill order for ${ticket.tableName} is ready to collect`
      )
  }

  useEffect(() => {
    fetchTickets()
    const timer = setInterval(() => setTick((t) => t + 1), 1000)
    const channel = supabase
      .channel('griller-kds')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () =>
        fetchTickets(true)
      )
      .subscribe()
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchTickets()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(timer)
      supabase.removeChannel(channel)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (geoStatus !== 'inside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />
  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-orange-400 animate-pulse">Loading Grill Station...</div>
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      <audio ref={audioRef} preload="auto" />

      <nav className="bg-gray-900 border-b border-orange-500/30 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center">
              <Flame size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm">Grill Station</h1>
              <p className="text-orange-400 text-xs">
                {tickets.length} {tickets.length === 1 ? 'ticket' : 'tickets'} active
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => fetchTickets()} className="text-gray-400 hover:text-white">
              <RefreshCw size={16} />
            </button>
            <div className="text-right">
              <p className="text-white text-sm">{profile?.full_name}</p>
              <p className="text-orange-400 text-xs capitalize">{profile?.role}</p>
            </div>
            <button onClick={signOut} className="text-gray-400 hover:text-white">
              <LogOut size={18} />
            </button>
            <HelpTooltip storageKey="griller-kds" tips={HELP_TIPS} />
          </div>
        </div>
      </nav>

      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2 flex items-center gap-4">
        {[
          { color: 'bg-gray-500', label: 'Normal (<10 min)' },
          { color: 'bg-amber-500', label: 'Getting late (10-20 min)' },
          { color: 'bg-red-500', label: 'Urgent (20+ min)' },
        ].map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${s.color}`} />
            <span className="text-gray-500 text-xs">{s.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 p-4 overflow-auto">
        {tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-20">
            <div className="w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center mb-4 border border-gray-800">
              <Flame size={36} className="text-gray-700" />
            </div>
            <p className="text-white font-bold text-lg">Grill is clear</p>
            <p className="text-gray-500 text-sm mt-1">No active grill tickets</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {tickets.map((ticket) => {
              const urgency = getUrgency(ticket.createdAt)
              const styles = URGENCY_STYLES[urgency]
              const elapsed = getElapsed(ticket.createdAt)
              return (
                <div
                  key={ticket.orderId}
                  className={`border rounded-xl overflow-hidden font-mono ${styles.border}`}
                >
                  <div className={`${styles.header} px-3 py-2 border-b ${styles.border}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Flame size={14} className={styles.flame} />
                        <span className="text-white font-bold text-sm">{ticket.tableName}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {urgency === 'critical' && (
                          <AlertTriangle size={13} className="text-red-400 animate-pulse" />
                        )}
                        <span className={`text-xs font-bold ${styles.time}`}>{elapsed}</span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-gray-500 text-xs capitalize">
                        {ticket.orderType?.replace('_', ' ') || 'table'}
                      </span>
                      <span className="text-gray-600 text-xs">
                        #{ticket.orderId.slice(-4).toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div className="px-3 py-1 border-b border-dashed border-gray-700">
                    <p className="text-gray-600 text-xs text-center tracking-widest">
                      — GRILL ORDER —
                    </p>
                  </div>

                  <div className="bg-gray-950 divide-y divide-gray-800/50">
                    {ticket.items.map((item) => (
                      <div
                        key={item.id}
                        className={`px-3 py-2.5 flex items-center justify-between gap-2 ${item.status === 'ready' ? 'opacity-40' : ''}`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-white font-bold text-sm">x{item.quantity}</span>
                            <span className="text-white text-sm">{item.menu_items?.name}</span>
                          </div>
                          {item.notes && (
                            <p className="text-amber-400 text-xs mt-0.5">⚠ {item.notes}</p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {item.status === 'ready' ? (
                            <span className="flex items-center gap-1 text-green-400 text-xs">
                              <CheckCircle size={13} /> Ready
                            </span>
                          ) : (
                            <button
                              onClick={() => markItemReady(item, ticket)}
                              disabled={completing[item.id]}
                              className="bg-orange-500 hover:bg-orange-400 disabled:bg-gray-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1"
                            >
                              {completing[item.id] ? (
                                <RefreshCw size={11} className="animate-spin" />
                              ) : (
                                <CheckCircle size={11} />
                              )}
                              Done
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="px-3 py-1 border-t border-dashed border-gray-700 bg-gray-950">
                    <p className="text-gray-600 text-xs text-center tracking-widest">
                      ————————————
                    </p>
                  </div>

                  {ticket.items.some((i) => i.status !== 'ready') && (
                    <div className="bg-gray-900 px-3 py-2">
                      <button
                        onClick={() => markAllReady(ticket)}
                        className="w-full bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors"
                      >
                        <CheckCircle size={13} /> All Done — Ticket Complete
                      </button>
                    </div>
                  )}

                  {ticket.items.every((i) => i.status === 'ready') && (
                    <div className="bg-green-500/10 px-3 py-2 text-center">
                      <p className="text-green-400 text-xs font-bold">
                        ✅ Ticket Complete — Waiter Notified
                      </p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default function GrillerKDS() {
  return (
    <ErrorBoundary title="Grill Station Error">
      <GrillerKDSInner />
    </ErrorBoundary>
  )
}
