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
import ActivityLogTab from './mgmt/ActivityLogTab'

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
        .select('staff_id')
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
      staffOnShift: new Set((staffRes.data || []).map((r: { staff_id: string }) => r.staff_id))
        .size,
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, fetchStats)
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
        "Live dashboard: open orders, occupied tables and rooms, staff on shift, and today's revenue — all updating in real time. The late orders banner turns red when any order exceeds the configured alert threshold (set under Settings). Figures are deduplicated so one waitron always counts as one.",
    },
    {
      id: 'mgmt-shifts',
      title: 'Shifts Tab',
      description:
        'Clock staff in and out. When clocking in a waitron, assign them a POS machine from the dropdown if you have named terminals — this links every sale to a specific device for reconciliation. The system checks the database live before every clock-in to prevent duplicate entries. Clocking out a waitron with open orders triggers a warning — resolve those orders first.',
    },
    {
      id: 'mgmt-tables',
      title: 'Tables Tab',
      description:
        'Assign waitrons to zones (Outdoor, Indoor, VIP Lounge, The Nook) or to specific individual tables. A waitron only sees and serves tables in their assigned area. You can reassign mid-shift if needed.',
    },
    {
      id: 'mgmt-orders',
      title: 'Orders Tab',
      description:
        'Live view of all open orders — table, waitron, items, and total. Use Force Close on any order that is stuck as open after payment has already been collected. Force Close marks all items as delivered so the KDS clears, frees the table, and closes the order cleanly.',
    },
    {
      id: 'mgmt-till',
      title: 'Till Tab',
      description:
        'Open and close till sessions with opening float. Log cash payouts (expenses, petty cash, advances) during the session. At close, the system calculates expected cash vs actual and flags any shortfall or surplus.',
    },
    {
      id: 'mgmt-kitchen',
      title: 'Kitchen Stock Tab',
      description:
        'Daily food stock register — records what was received, auto-syncs what was sold from POS, and calculates what should remain. Managers can edit and delete entries; kitchen staff can only add new entries. Variance alarms flag possible theft or waste.',
    },
    {
      id: 'mgmt-service',
      title: 'Service Tab',
      description:
        'Real-time log of every item marked served by a waitron — item, table, waitron, and timestamp. Use this to resolve customer disputes about whether an item was delivered.',
    },
    {
      id: 'mgmt-voids',
      title: 'Voids Tab',
      description:
        'All voids performed today — item name, quantity, value, and which manager PIN authorised it. Every void also deletes the order_items row and reduces the order total in real time. Cannot be reversed.',
    },
    {
      id: 'mgmt-activity',
      title: 'Activity Log Tab',
      description:
        'Complete audit trail of everything that has happened: logins (email and PIN, with device type), clock-ins and outs, orders placed and paid, voids, supplier actions, and settings changes. Filter by group (Login, Sales, Voids, Shifts, BackOffice) or search by staff name or action. Exportable to CSV.',
    },
    {
      id: 'mgmt-cctv',
      title: 'CCTV Tab',
      description:
        'Live occupancy, camera alerts, and heatmaps from the CV module. Resolve alerts directly from this tab — they are also surfaced on the Executive Dashboard.',
    },
    {
      id: 'mgmt-settings',
      title: 'Settings Tab',
      description:
        'Configure the late order alert threshold — how many minutes before an unfulfilled order triggers a warning banner for management and the Supervisor.',
    },
    {
      id: 'mgmt-sync',
      title: 'Sync Tab',
      description:
        'Shows the offline sync queue — any writes that could not reach Supabase while offline are queued here and retried automatically when connectivity is restored. Tap Manual Sync to force an immediate retry.',
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
        {activeTab === 'shifts' && <ShiftManager onRefreshStats={fetchStats} />}
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
