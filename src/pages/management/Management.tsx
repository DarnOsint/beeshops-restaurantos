import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  Users,
  LayoutDashboard,
  Camera,
  ShoppingBag,
  Clock,
  DollarSign,
  Settings,
  AlertTriangle,
  Trash2,
  RefreshCw,
  UtensilsCrossed,
  Shield,
} from 'lucide-react'
import ShiftManager from './ShiftManager'
import TableAssignment from './TableAssignment'
import TillManagement from './TillManagement'
import WaiterCalls from './WaiterCalls'
import KitchenStock from '../backoffice/KitchenStock'
import { useLateOrders } from '../../hooks/useLateOrders'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { getPendingQueue } from '../../lib/db'
import { HelpTooltip } from '../../components/HelpTooltip'

import OverviewTab from './mgmt/OverviewTab'
import OpenOrdersTab from './mgmt/OpenOrdersTab'
import CctvTab from './mgmt/CctvTab'
import VoidsTab from './mgmt/VoidsTab'
import SyncTab from './mgmt/SyncTab'
import SettingsTab from './mgmt/SettingsTab'

/* eslint-disable react-hooks/set-state-in-effect */

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'shifts', label: 'Shifts', icon: Clock },
  { id: 'tables', label: 'Tables', icon: Users },
  { id: 'orders', label: 'Orders', icon: ShoppingBag },
  { id: 'till', label: 'Till', icon: DollarSign },
  { id: 'kitchen', label: 'Kitchen', icon: UtensilsCrossed },
  { id: 'service', label: 'Service', icon: Clock },
  { id: 'voids', label: 'Voids', icon: Trash2 },
  { id: 'settings', label: 'Settings', icon: Settings },
  { id: 'cctv', label: 'CCTV', icon: Camera },
  { id: 'sync', label: 'Sync', icon: RefreshCw },
  { id: 'activity', label: 'Activity', icon: Shield },
] as const

type TabId = (typeof TABS)[number]['id']

interface Stats {
  openOrders: number
  occupiedTables: number
  occupiedRooms: number
  staffOnShift: number
  todayRevenue: number
}
interface CvData {
  alerts: Record<string, unknown>[]
  shelfAlerts: Record<string, unknown>[]
  occupancy: number
}

export default function Management() {
  useAuth() // profile/signOut available via context when needed
  const [activeTab, setActiveTab] = useState<TabId>('overview')
  const { lateOrders, threshold, setThreshold, markDelivered } = useLateOrders()
  const { status: syncStatus, pendingCount, lastSynced, manualSync } = useSyncStatus()

  const [syncQueue, setSyncQueue] = useState<Record<string, unknown>[]>([])
  const [serviceLog, setServiceLog] = useState<Record<string, unknown>[]>([])
  const [voidLog, setVoidLog] = useState<Record<string, unknown>[]>([])
  const [voidLoading, setVoidLoading] = useState(false)
  const [serviceLogLoading, setServiceLogLoading] = useState(false)
  const [stats, setStats] = useState<Stats>({
    openOrders: 0,
    occupiedTables: 0,
    occupiedRooms: 0,
    staffOnShift: 0,
    todayRevenue: 0,
  })
  const [cvData, setCvData] = useState<CvData>({ alerts: [], shelfAlerts: [], occupancy: 0 })

  const fetchStats = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [ordersRes, tablesRes, roomsRes, staffRes, revenueRes] = await Promise.all([
      supabase.from('orders').select('id').eq('status', 'open'),
      supabase.from('tables').select('id').eq('status', 'occupied'),
      supabase.from('rooms').select('status'),
      supabase
        .from('attendance')
        .select('id')
        .eq('date', new Date().toISOString().split('T')[0])
        .is('clock_out', null),
      supabase
        .from('orders')
        .select('total_amount')
        .eq('status', 'paid')
        .gte('created_at', today.toISOString()),
    ])
    setStats({
      openOrders: ordersRes.data?.length || 0,
      occupiedTables: tablesRes.data?.length || 0,
      occupiedRooms: roomsRes.data?.filter((r) => r.status === 'occupied').length || 0,
      staffOnShift: staffRes.data?.length || 0,
      todayRevenue: revenueRes.data?.reduce((s, o) => s + (o.total_amount || 0), 0) || 0,
    })
  }, [])

  const fetchCvData = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [alertsRes, shelfRes, occupancyRes] = await Promise.all([
      supabase
        .from('cv_alerts')
        .select('*')
        .eq('resolved', false)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(15),
      supabase
        .from('cv_shelf_events')
        .select('*')
        .neq('alert_level', 'normal')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('cv_people_counts')
        .select('occupancy')
        .order('created_at', { ascending: false })
        .limit(1),
    ])
    setCvData({
      alerts: (alertsRes.data || []) as Record<string, unknown>[],
      shelfAlerts: (shelfRes.data || []) as Record<string, unknown>[],
      occupancy: occupancyRes.data?.[0]?.occupancy || 0,
    })
  }, [])

  useEffect(() => {
    const _ms = document.getElementById('main-scroll')
    if (_ms) _ms.scrollTop = 0
  }, [activeTab])

  useEffect(() => {
    fetchStats()
    const ch = supabase
      .channel('management-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchStats)
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchStats])

  useEffect(() => {
    fetchCvData()
    const ch = supabase
      .channel('mgmt-cv')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_alerts' },
        fetchCvData
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_shelf_events' },
        fetchCvData
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchCvData])

  useEffect(() => {
    if (activeTab !== 'voids') return
    setVoidLoading(true)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    supabase
      .from('void_log')
      .select('*')
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setVoidLog(data || [])
        setVoidLoading(false)
      })
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'service') return
    setServiceLogLoading(true)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    supabase
      .from('service_log')
      .select('*')
      .gte('served_at', today.toISOString())
      .order('served_at', { ascending: false })
      .limit(100)
      .then(({ data }) => {
        setServiceLog(data || [])
        setServiceLogLoading(false)
      })
    const ch = supabase
      .channel('service-log-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'service_log' },
        (payload) => setServiceLog((prev) => [payload.new, ...prev])
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [activeTab])

  useEffect(() => {
    const load = async () => {
      const q = await getPendingQueue()
      setSyncQueue(q || [])
    }
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [])

  const resolveAlert = async (id: string) => {
    await supabase.from('cv_alerts').update({ resolved: true }).eq('id', id)
    setCvData((prev) => ({ ...prev, alerts: prev.alerts.filter((a) => a.id !== id) }))
  }

  const helpTips = [
    {
      id: 'mgmt-overview',
      title: 'Overview',
      description:
        "Live dashboard showing open orders, occupied tables, occupied rooms, staff on shift, and today's revenue. All figures update in real time via Supabase subscriptions.",
    },
    {
      id: 'mgmt-lateorders',
      title: 'Late Order Banner',
      description:
        'A red alert banner appears at the top when any order has been pending longer than the configured threshold. It shows the table name, pending item count, which station (Kitchen/Bar/Grill) is holding it, and how long it has waited. Tap Delivered to dismiss.',
    },
    {
      id: 'mgmt-shifts',
      title: 'Shifts Tab',
      description:
        'Clock staff in and out for the current shift. A waitron who is not clocked in cannot access the POS — they will see a blocked screen. You can also view who is currently on shift and their clock-in time.',
    },
    {
      id: 'mgmt-tables',
      title: 'Tables Tab',
      description:
        'Assign waitrons to table zones (Outdoor, Indoor, VIP Lounge, The Nook). A waitron will only see and serve tables in their assigned zone. You can also assign individual tables directly to a specific waitron.',
    },
    {
      id: 'mgmt-orders',
      title: 'Orders Tab',
      description:
        'Live view of all currently open orders across the venue — table name, assigned waitron, items ordered, and total amount. Useful for monitoring floor activity without walking around.',
    },
    {
      id: 'mgmt-till',
      title: 'Till Tab',
      description:
        'Open and close till sessions, record the opening float, and log cash payouts. Each session is saved with expected vs actual cash for reconciliation.',
    },
    {
      id: 'mgmt-service',
      title: 'Service Tab',
      description:
        'Real-time log of every item marked as served by a waitron today — item name, table, waitron, and timestamp. Useful for verifying service delivery disputes.',
    },
    {
      id: 'mgmt-voids',
      title: 'Voids Tab',
      description:
        'Shows all void actions performed today — item name, quantity, value, reason given, and which manager PIN authorised it. Voids require manager approval and cannot be deleted.',
    },
    {
      id: 'mgmt-cctv',
      title: 'CCTV Tab',
      description:
        'Live occupancy count, unresolved camera alerts, bar shelf stock warnings, and zone activity heatmaps fed from the CV intelligence module. Alerts are colour-coded by severity.',
    },
    {
      id: 'mgmt-settings',
      title: 'Settings Tab',
      description:
        'Configure the late order alert threshold — the number of minutes an order must be pending before it triggers the red alert banner. Applies across all order types including takeaway.',
    },
  ]

  return (
    <div className="min-h-full bg-gray-950">
      <WaiterCalls />

      {/* Late Orders Banner */}
      {lateOrders.length > 0 && (
        <div className="bg-red-500/10 border-b border-red-500/30 px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-400 animate-pulse" />
            <span className="text-red-400 font-bold text-sm">
              {lateOrders.length} overdue table{lateOrders.length > 1 ? 's' : ''} — pending over{' '}
              {threshold} mins
            </span>
          </div>
          <div className="space-y-2">
            {lateOrders.map((order) => {
              const pendingItems = (order.order_items || []).filter(
                (i: Record<string, unknown>) => i.status === 'pending'
              )
              const destinations = [
                ...new Set(
                  pendingItems
                    .map((i: Record<string, unknown>) => (i.destination as string)?.toUpperCase())
                    .filter(Boolean)
                ),
              ]
              const mins = Math.floor(
                (new Date().getTime() - new Date(order.created_at).getTime()) / 60000
              )
              return (
                <div
                  key={order.id}
                  className="bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-white text-sm font-bold">
                        {order.order_type === 'takeaway'
                          ? `Takeaway — ${order.customer_name || 'Guest'}`
                          : order.tables?.name || 'Table ?'}
                      </p>
                      <p className="text-red-300 text-xs mt-0.5">
                        {pendingItems.length} pending item{pendingItems.length > 1 ? 's' : ''} ·{' '}
                        {(destinations as string[]).join(', ')} · {mins} mins ago
                      </p>
                    </div>
                    <button
                      onClick={() => markDelivered(order.id)}
                      className="shrink-0 bg-green-500 hover:bg-green-400 text-black text-xs font-bold px-3 py-1.5 rounded-xl transition-colors"
                    >
                      Delivered
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto items-center">
        <div className="ml-auto pl-2 py-1 shrink-0">
          <HelpTooltip tips={helpTips} />
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === t.id
                ? 'border-amber-500 text-amber-500'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <OverviewTab
            stats={stats}
            pendingCount={pendingCount}
            onTabChange={(id) => setActiveTab(id as TabId)}
          />
        )}
        {activeTab === 'shifts' && <ShiftManager />}
        {activeTab === 'tables' && <TableAssignment />}
        {activeTab === 'orders' && <OpenOrdersTab />}
        {activeTab === 'till' && <TillManagement />}
        {activeTab === 'kitchen' && <KitchenStock onBack={() => setActiveTab('overview')} />}
        {activeTab === 'cctv' && (
          <CctvTab
            occupancy={cvData.occupancy}
            alerts={cvData.alerts}
            shelfAlerts={cvData.shelfAlerts}
            onResolve={resolveAlert}
          />
        )}
        {activeTab === 'voids' && <VoidsTab voidLog={voidLog} loading={voidLoading} />}
        {activeTab === 'sync' && (
          <SyncTab
            syncStatus={syncStatus}
            pendingCount={pendingCount}
            lastSynced={lastSynced}
            syncQueue={syncQueue}
            onManualSync={manualSync}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityLogTab
            dateRange={{
              start: new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
              end: new Date().toISOString(),
            }}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab threshold={threshold} setThreshold={setThreshold} />
        )}
        {activeTab === 'service' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-white font-bold">Service Log — Today</p>
              <span className="text-gray-500 text-xs">{serviceLog.length} entries</span>
            </div>
            {serviceLogLoading && (
              <p className="text-gray-500 text-sm text-center py-8">Loading…</p>
            )}
            {!serviceLogLoading && serviceLog.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-12">
                No service events recorded today
              </p>
            )}
            {serviceLog.map((e: Record<string, unknown>) => (
              <div
                key={e.id}
                className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
              >
                <div>
                  <p className="text-white text-sm font-medium">{e.item_name}</p>
                  <p className="text-gray-500 text-xs">
                    {e.table_name} · {e.waitron_name}
                  </p>
                </div>
                <p className="text-gray-600 text-xs">
                  {new Date(e.served_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
