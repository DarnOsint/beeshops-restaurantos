import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  Beer,
  LogOut,
  Users,
  LayoutDashboard,
  Camera,
  Activity,
  ShoppingBag,
  TrendingUp,
  Clock,
  ChevronRight,
  DollarSign,
  Settings,
  BookOpen,
  BedDouble,
  AlertTriangle,
  Save,
  ClipboardCheck,
  Trash2,
  CheckCircle,
  RefreshCw,
} from 'lucide-react'
import ShiftManager from './ShiftManager'
import TableAssignment from './TableAssignment'
import TillManagement from './TillManagement'
import WaiterCalls from './WaiterCalls'
import { useLateOrders } from '../../hooks/useLateOrders'
import { useSyncStatus } from '../../hooks/useSyncStatus'
import { getPendingQueue } from '../../lib/db'
import { HelpTooltip } from '../../components/HelpTooltip'
import UnassignedCustomerOrders from '../../components/UnassignedCustomerOrders'

export default function Management() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const { lateOrders, threshold, setThreshold, markDelivered } = useLateOrders()
  const { status: syncStatus, pendingCount, lastSynced, manualSync } = useSyncStatus()
  const [syncQueue, setSyncQueue] = useState([])
  const [editThreshold, setEditThreshold] = useState('')
  const [savingThreshold, setSavingThreshold] = useState(false)
  const [serviceLog, setServiceLog] = useState([])
  const [voidLog, setVoidLog] = useState([])
  const [voidLoading, setVoidLoading] = useState(false)
  const [serviceLogLoading, setServiceLogLoading] = useState(false)
  const [stats, setStats] = useState({
    openOrders: 0,
    occupiedTables: 0,
    occupiedRooms: 0,
    staffOnShift: 0,
    todayRevenue: 0,
  })

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
      todayRevenue: revenueRes.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0,
    })
  }, [])

  useEffect(() => {
    fetchStats()
    const channel = supabase
      .channel('management-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, () =>
        fetchStats()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const fetchServiceLog = async () => {
    setServiceLogLoading(true)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('service_log')
      .select('*')
      .gte('served_at', today.toISOString())
      .order('served_at', { ascending: false })
      .limit(100)
    setServiceLog(data || [])
    setServiceLogLoading(false)
  }

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
    fetchServiceLog()
    const channel = supabase
      .channel('service-log-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'service_log' },
        (payload) => {
          setServiceLog((prev) => [payload.new, ...prev])
        }
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [activeTab])

  const saveThreshold = async () => {
    const val = parseInt(editThreshold)
    if (!val || val < 1) return
    setSavingThreshold(true)
    await supabase
      .from('settings')
      .upsert({
        id: 'order_alert_threshold',
        value: String(val),
        updated_at: new Date().toISOString(),
      })
    setThreshold(val)
    setEditThreshold('')
    setSavingThreshold(false)
  }

  const [cvData, setCvData] = useState({
    alerts: [],
    shelfAlerts: [],
    exitEvents: [],
    occupancy: 0,
  })

  // Fetch sync queue every 10 seconds
  useEffect(() => {
    const loadQueue = async () => {
      const q = await getPendingQueue()
      setSyncQueue(q || [])
    }
    loadQueue()
    const interval = setInterval(loadQueue, 10000)
    return () => clearInterval(interval)
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
      alerts: alertsRes.data || [],
      shelfAlerts: shelfRes.data || [],
      occupancy: occupancyRes.data?.[0]?.occupancy || 0,
    })
  }, [])

  useEffect(() => {
    fetchCvData()
    const cvCh = supabase
      .channel('mgmt-cv')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cv_alerts' }, () =>
        fetchCvData()
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'cv_shelf_events' }, () =>
        fetchCvData()
      )
      .subscribe()
    return () => supabase.removeChannel(cvCh)
  }, [])

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'shifts', label: 'Shifts', icon: Clock },
    { id: 'tables', label: 'Tables', icon: Users },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'till', label: 'Till', icon: DollarSign },
    { id: 'service', label: 'Service', icon: ClipboardCheck },
    { id: 'voids', label: 'Voids', icon: Trash2 },
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'cctv', label: 'CCTV', icon: Camera },
    { id: 'sync', label: 'Sync', icon: RefreshCw },
  ]

  const resolveAlert = async (alertId) => {
    await supabase.from('cv_alerts').update({ resolved: true }).eq('id', alertId)
    setCvData((prev) => ({ ...prev, alerts: prev.alerts.filter((a) => a.id !== alertId) }))
  }

  return (
    <div className="min-h-full bg-gray-950">
      {/* Waiter call alerts — floats top right */}
      <WaiterCalls />

      {/* Late Orders Alert Banner */}
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
              const pendingItems = order.order_items?.filter((i) => i.status === 'pending') || []
              const destinations = [
                ...new Set(pendingItems.map((i) => i.destination?.toUpperCase()).filter(Boolean)),
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
                        {destinations.join(', ')} · {mins} mins ago
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

      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto items-center">
        <div className="ml-auto pl-2 py-1 shrink-0">
          <HelpTooltip
            tips={[
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
            ]}
          />
        </div>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-amber-500 text-amber-500'
                : 'border-transparent text-gray-400 hover:text-white'
            }`}
          >
            <tab.icon size={16} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <UnassignedCustomerOrders />
            {pendingCount > 0 && (
              <button
                onClick={() => setActiveTab('sync')}
                className="w-full flex items-center justify-between bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <RefreshCw size={15} className="text-amber-400 animate-spin" />
                  <p className="text-amber-400 text-sm font-medium">
                    {pendingCount} offline change{pendingCount > 1 ? 's' : ''} pending sync
                  </p>
                </div>
                <span className="text-amber-400/60 text-xs">View →</span>
              </button>
            )}
            <div className="grid grid-cols-2 gap-4">
              {[
                {
                  label: 'Open Orders',
                  value: stats.openOrders,
                  icon: ShoppingBag,
                  color: 'text-amber-400',
                  bg: 'bg-amber-400/10',
                },
                {
                  label: 'Occupied Tables',
                  value: `${stats.occupiedTables}/60`,
                  icon: LayoutDashboard,
                  color: 'text-blue-400',
                  bg: 'bg-blue-400/10',
                },
                {
                  label: 'Occupied Rooms',
                  value: `${stats.occupiedRooms}/20`,
                  icon: BedDouble,
                  color: 'text-purple-400',
                  bg: 'bg-purple-400/10',
                },
                {
                  label: 'Staff On Shift',
                  value: stats.staffOnShift,
                  icon: Users,
                  color: 'text-green-400',
                  bg: 'bg-green-400/10',
                },
                {
                  label: 'Revenue Today',
                  value: `₦${stats.todayRevenue.toLocaleString()}`,
                  icon: TrendingUp,
                  color: 'text-pink-400',
                  bg: 'bg-pink-400/10',
                },
              ].map((stat, i) => (
                <div key={i} className="bg-gray-900 rounded-2xl p-4 border border-gray-800">
                  <div className={`inline-flex p-2 rounded-lg ${stat.bg} mb-2`}>
                    <stat.icon size={18} className={stat.color} />
                  </div>
                  <p className="text-gray-400 text-xs">{stat.label}</p>
                  <p className="text-white text-xl font-bold mt-0.5">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
              <h3 className="text-white font-semibold mb-3">Quick Actions</h3>
              <div className="space-y-2">
                {[
                  {
                    label: 'Manage Staff Shifts',
                    sub: 'Clock in/out staff members',
                    action: () => setActiveTab('shifts'),
                    icon: Clock,
                  },
                  {
                    label: 'Assign Tables',
                    sub: 'Assign tables to waitrons',
                    action: () => setActiveTab('tables'),
                    icon: Users,
                  },
                  {
                    label: 'View Open Orders',
                    sub: 'Monitor active orders',
                    action: () => setActiveTab('orders'),
                    icon: ShoppingBag,
                  },
                  {
                    label: 'Till Management',
                    sub: 'Cash control and payouts',
                    action: () => setActiveTab('till'),
                    icon: DollarSign,
                  },
                  {
                    label: 'Room Management',
                    sub: 'Check-in, check-out and room status',
                    action: () => navigate('/rooms'),
                    icon: BedDouble,
                  },
                  {
                    label: 'Accounting',
                    sub: 'Sales reports, trends and expenses',
                    action: () => navigate('/accounting'),
                    icon: BookOpen,
                  },
                  {
                    label: 'Back Office',
                    sub: 'Menu, staff and table config',
                    action: () => navigate('/backoffice'),
                    icon: Settings,
                  },
                ].map((action, i) => (
                  <button
                    key={i}
                    onClick={action.action}
                    className="w-full flex items-center justify-between bg-gray-800 hover:bg-gray-700 rounded-xl p-3 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-amber-500/10 rounded-lg flex items-center justify-center">
                        <action.icon size={16} className="text-amber-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-white text-sm font-medium">{action.label}</p>
                        <p className="text-gray-400 text-xs">{action.sub}</p>
                      </div>
                    </div>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'shifts' && <ShiftManager />}
        {activeTab === 'tables' && <TableAssignment />}
        {activeTab === 'orders' && <OpenOrders />}
        {activeTab === 'till' && <TillManagement />}
        {activeTab === 'cctv' && (
          <div className="space-y-4">
            {/* Occupancy */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div className="inline-flex p-2 rounded-lg bg-purple-400/10 mb-2">
                  <Activity size={16} className="text-purple-400" />
                </div>
                <p className="text-gray-400 text-xs">Live Occupancy</p>
                <p className="text-white text-2xl font-bold mt-0.5">{cvData.occupancy}</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <div
                  className={`inline-flex p-2 rounded-lg mb-2 ${cvData.alerts.length > 0 ? 'bg-red-400/10' : 'bg-gray-400/10'}`}
                >
                  <Camera
                    size={16}
                    className={cvData.alerts.length > 0 ? 'text-red-400' : 'text-gray-400'}
                  />
                </div>
                <p className="text-gray-400 text-xs">Unresolved Alerts</p>
                <p
                  className={`text-2xl font-bold mt-0.5 ${cvData.alerts.length > 0 ? 'text-red-400' : 'text-white'}`}
                >
                  {cvData.alerts.length}
                </p>
              </div>
            </div>

            {/* Active alerts */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <Camera size={14} className="text-purple-400" /> Active Alerts
              </p>
              {cvData.alerts.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-6">No active alerts</p>
              ) : (
                <div className="space-y-2">
                  {cvData.alerts.map((alert, i) => (
                    <div key={i} className="bg-gray-800 rounded-xl px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-xs font-medium">
                            {alert.camera_id} — {alert.alert_type?.replace(/_/g, ' ')}
                          </p>
                          <p className="text-gray-500 text-xs mt-0.5">{alert.description}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              alert.severity === 'critical'
                                ? 'bg-red-500/20 text-red-400'
                                : alert.severity === 'high'
                                  ? 'bg-orange-500/20 text-orange-400'
                                  : 'bg-yellow-500/20 text-yellow-400'
                            }`}
                          >
                            {alert.severity}
                          </span>
                          <p className="text-gray-600 text-xs">
                            {new Date(alert.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                          <button
                            onClick={() => resolveAlert(alert.id)}
                            className="flex items-center gap-1 text-xs text-green-400 hover:text-green-300 bg-green-500/10 hover:bg-green-500/20 px-2 py-0.5 rounded-full transition-colors"
                          >
                            <CheckCircle size={11} /> Resolve
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Shelf alerts */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <p className="text-white font-semibold text-sm mb-3">Bar Shelf Stock</p>
              {cvData.shelfAlerts.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-4">No shelf alerts today</p>
              ) : (
                <div className="space-y-2">
                  {cvData.shelfAlerts.map((e, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between bg-gray-800 rounded-xl px-3 py-2"
                    >
                      <div>
                        <p className="text-white text-xs capitalize">
                          {e.drink_name?.replace(/_/g, ' ')}
                        </p>
                        <p className="text-gray-500 text-xs">{e.detected_count} bottles detected</p>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          e.alert_level === 'missing'
                            ? 'bg-red-500/20 text-red-400'
                            : e.alert_level === 'critical'
                              ? 'bg-orange-500/20 text-orange-400'
                              : 'bg-yellow-500/20 text-yellow-400'
                        }`}
                      >
                        {e.alert_level}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {activeTab === 'voids' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-white font-bold">Void Log — Today</p>
            <span className="text-gray-500 text-xs">
              {voidLog.length} record{voidLog.length !== 1 ? 's' : ''}
            </span>
          </div>
          {voidLoading && <p className="text-gray-500 text-sm text-center py-8">Loading...</p>}
          {!voidLoading && voidLog.length === 0 && (
            <div className="text-center py-12">
              <Trash2 size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm">No voids recorded today</p>
            </div>
          )}
          {voidLog.map((v) => (
            <div
              key={v.id}
              className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2"
            >
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
                {v.voided_by_name && (
                  <p className="text-gray-600 text-xs">By: {v.voided_by_name}</p>
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
        </div>
      )}

      {activeTab === 'sync' && (
        <div className="p-4 space-y-4">
          {/* Sync status header */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <p className="text-white font-semibold text-sm">Offline Sync Queue</p>
              <p className="text-gray-500 text-xs mt-0.5">
                {pendingCount === 0
                  ? 'All changes synced'
                  : `${pendingCount} change${pendingCount > 1 ? 's' : ''} pending`}
                {lastSynced &&
                  ` · Last synced ${lastSynced.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs px-2 py-1 rounded-full font-medium ${
                  syncStatus === 'online'
                    ? 'bg-green-500/20 text-green-400'
                    : syncStatus === 'offline'
                      ? 'bg-red-500/20 text-red-400'
                      : syncStatus === 'syncing'
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-orange-500/20 text-orange-400'
                }`}
              >
                {syncStatus}
              </span>
              <button
                onClick={manualSync}
                disabled={syncStatus === 'offline' || pendingCount === 0}
                className="text-xs bg-amber-500 text-black px-3 py-1.5 rounded-xl font-medium disabled:opacity-40"
              >
                Sync Now
              </button>
            </div>
          </div>

          {/* Queue entries */}
          {syncQueue.length === 0 ? (
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-8 text-center">
              <p className="text-green-400 text-sm font-medium">✓ All clear</p>
              <p className="text-gray-500 text-xs mt-1">No pending writes in the offline queue</p>
            </div>
          ) : (
            <div className="space-y-2">
              {syncQueue.map((entry, i) => (
                <div
                  key={i}
                  className="bg-gray-900 border border-gray-800 rounded-2xl px-4 py-3 flex items-center justify-between"
                >
                  <div>
                    <p className="text-white text-xs font-medium capitalize">
                      {entry.operation?.toLowerCase()} · {entry.table_name?.replace(/_/g, ' ')}
                    </p>
                    <p className="text-gray-500 text-xs mt-0.5 font-mono">
                      {entry.record_id?.slice(0, 16)}…
                    </p>
                  </div>
                  <div className="text-right">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        entry.retries > 3
                          ? 'bg-red-500/20 text-red-400'
                          : entry.retries > 0
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-gray-700 text-gray-400'
                      }`}
                    >
                      {entry.retries > 0 ? `${entry.retries} retries` : 'pending'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'settings' && (
        <div className="p-4 space-y-4 max-w-md">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <h3 className="text-white font-bold mb-1 flex items-center gap-2">
              <Clock size={16} className="text-amber-400" /> Order Alert Threshold
            </h3>
            <p className="text-gray-400 text-xs mb-4">
              Alert management when an order item has been pending longer than this many minutes.
            </p>
            <div className="flex items-center gap-3">
              <div className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 flex items-center justify-between">
                <span className="text-gray-400 text-sm">Current threshold</span>
                <span className="text-amber-400 font-bold">{threshold} mins</span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <input
                type="number"
                min="1"
                max="120"
                value={editThreshold}
                onChange={(e) => setEditThreshold(e.target.value)}
                placeholder="New threshold (mins)"
                className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
              />
              <button
                onClick={saveThreshold}
                disabled={savingThreshold || !editThreshold}
                className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold px-4 py-2.5 rounded-xl text-sm transition-colors"
              >
                <Save size={14} /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function OpenOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(name), profiles(full_name), order_items(*, menu_items(name))')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    if (!error) setOrders(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchOrders()
    const channel = supabase
      .channel('orders-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () =>
        fetchOrders()
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  if (loading)
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="space-y-3">
      {orders.length === 0 ? (
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 text-center">
          <ShoppingBag size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No open orders right now</p>
        </div>
      ) : (
        orders.map((order) => (
          <div key={order.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-white font-bold">{order.tables?.name || 'Unknown Table'}</p>
                <p className="text-gray-400 text-xs">{order.profiles?.full_name}</p>
              </div>
              <div className="text-right">
                <p className="text-amber-400 font-bold">₦{order.total_amount?.toLocaleString()}</p>
                <p className="text-gray-500 text-xs">
                  {new Date(order.created_at).toLocaleTimeString()}
                </p>
              </div>
            </div>
            <div className="space-y-1">
              {order.order_items?.map((item) => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-300">
                    {item.quantity}x {item.menu_items?.name}
                  </span>
                  <span className="text-gray-400">₦{item.total_price?.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
