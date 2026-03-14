import { useAuth } from '../../context/AuthContext'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { RefreshCw, Camera } from 'lucide-react'

import StatCards from './exec/StatCards'
import RevenueChart from './exec/RevenueChart'
import QuickActions from './exec/QuickActions'
import RecentOrders from './exec/RecentOrders'
import CctvPanel from './exec/CctvPanel'
import GeofenceControls from './exec/GeofenceControls'

import type { Stats, TrendDay, CvData } from './exec/types'

/* eslint-disable react-hooks/set-state-in-effect */

function getGreeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : 'Evening'
}

const HELP_TIPS = [
  {
    id: 'exec-kpis',
    title: 'Live KPI Cards',
    description:
      "Six real-time metrics — today's revenue, open orders, occupied tables (out of 60), occupied rooms (out of 20), staff on duty, and low stock item count. Cards auto-refresh every 30 seconds and on any database change.",
  },
  {
    id: 'exec-geofence',
    title: 'Geofence Control',
    description:
      "Toggle location enforcement for all floor staff and waitrons. When ON, staff can only log in and use the POS from within the restaurant's GPS boundary. Owners and managers are exempt. Use the Radius button to adjust the boundary size for the Main venue and Apartments separately.",
  },
  {
    id: 'exec-bank',
    title: 'Bank Transfer Details',
    description:
      "Set the venue's bank name, account number, and account name. These details are shown to waitrons at payment time when a customer selects Bank Transfer as their payment method.",
  },
  {
    id: 'exec-cctv',
    title: 'CCTV Intelligence',
    description:
      'Toggle the CCTV panel to see live occupancy, unresolved camera alerts by severity, zone activity heatmaps, till anomalies, and bar shelf stock warnings — all fed from the CV module running on your server.',
  },
  {
    id: 'exec-lowstock',
    title: 'Low Stock Alert',
    description:
      'A red button appears in the controls bar when any inventory item is at or below its minimum stock threshold. Tap it to go directly to the Back Office inventory screen to restock.',
  },
  {
    id: 'exec-trend',
    title: '7-Day Revenue Chart',
    description:
      'A daily revenue bar chart for the last 7 days showing the ₦ value and peak hour above the chart. Tap Full Report to go to the detailed Reports page.',
  },
  {
    id: 'exec-recentorders',
    title: 'Recent Orders Feed',
    description:
      'The 8 most recent orders across all tables and rooms — table name, assigned waitron, time, amount, and status. Status badges show open (amber) or paid (green).',
  },
  {
    id: 'exec-quickactions',
    title: 'Quick Actions',
    description:
      'Shortcut buttons to Accounting, Reports, Back Office, Management, and Rooms. Use these to navigate quickly without going through the app menu.',
  },
]

export default function Executive() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Settings state (lifted here so GeofenceControls can be stateless on the save actions)
  const [geofenceEnabled, setGeofenceEnabled] = useState(true)
  const [radiusMain, setRadiusMain] = useState(400)
  const [radiusApartment, setRadiusApartment] = useState(200)
  const [latMain, setLatMain] = useState('7.350834')
  const [lngMain, setLngMain] = useState('3.840780')
  const [latApartment, setLatApartment] = useState('7.349545')
  const [lngApartment, setLngApartment] = useState('3.839690')
  const [bankName, setBankName] = useState('')
  const [bankAccountNumber, setBankAccountNumber] = useState('')
  const [bankAccountName, setBankAccountName] = useState('')

  const [stats, setStats] = useState<Stats>({
    revenue: 0,
    openOrders: 0,
    occupiedTables: 0,
    occupiedRooms: 0,
    staffOnDuty: 0,
    lowStock: 0,
  })
  const [recentOrders, setRecentOrders] = useState<Record<string, unknown>[]>([])
  const [trendData, setTrendData] = useState<TrendDay[]>([])
  const [loading, setLoading] = useState(true)
  const [cvTab, setCvTab] = useState(false)
  const [cvData, setCvData] = useState<CvData>({
    occupancy: 0,
    todayAlerts: [],
    zoneHeatmaps: [],
    tillEvents: [],
    shelfAlerts: [],
  })

  const fetchStats = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [ordersRes, tablesRes, roomsRes, shiftsRes, stockRes, recentRes, revenueRes, trendRes] =
      await Promise.all([
        supabase.from('orders').select('id').eq('status', 'open'),
        supabase.from('tables').select('status'),
        supabase.from('rooms').select('status'),
        supabase
          .from('attendance')
          .select('id')
          .eq('date', new Date().toISOString().split('T')[0])
          .is('clock_out', null),
        supabase.from('inventory').select('id, current_stock, minimum_stock').eq('is_active', true),
        supabase
          .from('orders')
          .select('*, tables(name), profiles(full_name)')
          .gte('created_at', today.toISOString())
          .order('created_at', { ascending: false })
          .limit(10),
        supabase
          .from('orders')
          .select('total_amount')
          .eq('status', 'paid')
          .gte('created_at', today.toISOString()),
        supabase
          .from('orders')
          .select('created_at, total_amount')
          .eq('status', 'paid')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: true }),
      ])
    setStats({
      revenue: revenueRes.data?.reduce((s, o) => s + (o.total_amount || 0), 0) || 0,
      openOrders: ordersRes.data?.length || 0,
      occupiedTables: tablesRes.data?.filter((t) => t.status === 'occupied').length || 0,
      occupiedRooms: roomsRes.data?.filter((r) => r.status === 'occupied').length || 0,
      staffOnDuty: shiftsRes.data?.length || 0,
      lowStock: stockRes.data?.filter((i) => i.current_stock <= i.minimum_stock).length || 0,
    })
    setRecentOrders((recentRes.data || []) as Record<string, unknown>[])
    const dayMap: Record<string, TrendDay> = {}
    ;(trendRes.data || []).forEach((o) => {
      const day = new Date(o.created_at).toLocaleDateString('en-NG', {
        weekday: 'short',
        day: 'numeric',
      })
      if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
      dayMap[day].revenue += o.total_amount || 0
      dayMap[day].orders++
    })
    setTrendData(Object.values(dayMap))
    setLoading(false)
  }, [])

  const fetchCvData = useCallback(async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [occupancyRes, alertsRes, heatmapRes, tillRes, shelfRes] = await Promise.all([
      supabase
        .from('cv_people_counts')
        .select('occupancy')
        .order('created_at', { ascending: false })
        .limit(1),
      supabase
        .from('cv_alerts')
        .select('*')
        .eq('resolved', false)
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(20),
      supabase
        .from('cv_zone_heatmaps')
        .select('zone_label, person_count, avg_dwell_seconds')
        .gte('created_at', today.toISOString())
        .order('person_count', { ascending: false })
        .limit(10),
      supabase
        .from('cv_till_events')
        .select('*')
        .neq('alert_type', 'normal')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
      supabase
        .from('cv_shelf_events')
        .select('*')
        .neq('alert_level', 'normal')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: false })
        .limit(10),
    ])
    setCvData({
      occupancy: occupancyRes.data?.[0]?.occupancy || 0,
      todayAlerts: (alertsRes.data || []) as Record<string, unknown>[],
      zoneHeatmaps: (heatmapRes.data || []) as Record<string, unknown>[],
      tillEvents: (tillRes.data || []) as Record<string, unknown>[],
      shelfAlerts: (shelfRes.data || []) as Record<string, unknown>[],
    })
  }, [])

  useEffect(() => {
    fetchStats()
    supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'geofence_enabled',
        'geofence_radius_main',
        'geofence_radius_apartment',
        'geofence_lat_main',
        'geofence_lng_main',
        'geofence_lat_apartment',
        'geofence_lng_apartment',
        'bank_name',
        'bank_account_number',
        'bank_account_name',
      ])
      .then(({ data }) => {
        if (!data) return
        const map = Object.fromEntries(data.map((r) => [r.id, r.value]))
        if (map['geofence_enabled'] !== undefined)
          setGeofenceEnabled(map['geofence_enabled'] === 'true')
        if (map['geofence_radius_main']) setRadiusMain(parseInt(map['geofence_radius_main']))
        if (map['geofence_radius_apartment'])
          setRadiusApartment(parseInt(map['geofence_radius_apartment']))
        if (map['geofence_lat_main']) setLatMain(map['geofence_lat_main'])
        if (map['geofence_lng_main']) setLngMain(map['geofence_lng_main'])
        if (map['geofence_lat_apartment']) setLatApartment(map['geofence_lat_apartment'])
        if (map['geofence_lng_apartment']) setLngApartment(map['geofence_lng_apartment'])
        if (map['bank_name'] !== undefined) setBankName(map['bank_name'])
        if (map['bank_account_number'] !== undefined)
          setBankAccountNumber(map['bank_account_number'])
        if (map['bank_account_name'] !== undefined) setBankAccountName(map['bank_account_name'])
      })
    const iv = setInterval(fetchStats, 30000)
    const ch = supabase
      .channel('executive-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchStats)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchStats)
      .subscribe()
    fetchCvData()
    const cvCh = supabase
      .channel('cv-realtime')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_alerts' },
        fetchCvData
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_people_counts' },
        fetchCvData
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_till_events' },
        fetchCvData
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cv_shelf_events' },
        fetchCvData
      )
      .subscribe()
    return () => {
      clearInterval(iv)
      supabase.removeChannel(ch)
      supabase.removeChannel(cvCh)
    }
  }, [fetchStats, fetchCvData])

  const peakHour = (() => {
    const hourMap: Record<number, number> = {}
    recentOrders.forEach((o) => {
      const h = new Date(o.created_at as string).getHours()
      hourMap[h] = (hourMap[h] || 0) + 1
    })
    const peak = Object.entries(hourMap).sort((a, b) => Number(b[1]) - Number(a[1]))[0]
    if (!peak) return null
    const h = parseInt(peak[0])
    return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
  })()

  const resolveAlert = async (id: string) => {
    await supabase.from('cv_alerts').update({ resolved: true }).eq('id', id)
    setCvData((prev) => ({
      ...prev,
      todayAlerts: prev.todayAlerts.filter((a) => (a as Record<string, string>).id !== id),
    }))
  }

  return (
    <div className="min-h-full bg-gray-950">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 md:px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-sm md:text-base">Executive Dashboard</h1>
          <p className="text-gray-400 text-xs">
            Good {getGreeting()}, {profile?.full_name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <HelpTooltip storageKey="executive" tips={HELP_TIPS} />
          <button
            onClick={() => setCvTab((v) => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-colors ${cvTab ? 'bg-purple-500/20 border-purple-500/40 text-purple-400' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
          >
            <Camera size={13} /> CCTV
          </button>
          <button onClick={fetchStats} className="text-gray-400 hover:text-white">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6">
        <GeofenceControls
          stats={stats}
          geofenceEnabled={geofenceEnabled}
          setGeofenceEnabled={setGeofenceEnabled}
          radiusMain={radiusMain}
          setRadiusMain={setRadiusMain}
          radiusApartment={radiusApartment}
          setRadiusApartment={setRadiusApartment}
          latMain={latMain}
          setLatMain={setLatMain}
          lngMain={lngMain}
          setLngMain={setLngMain}
          latApartment={latApartment}
          setLatApartment={setLatApartment}
          lngApartment={lngApartment}
          setLngApartment={setLngApartment}
          bankName={bankName}
          setBankName={setBankName}
          bankAccountNumber={bankAccountNumber}
          setBankAccountNumber={setBankAccountNumber}
          bankAccountName={bankAccountName}
          setBankAccountName={setBankAccountName}
          peakHour={peakHour}
          onNavigateBackoffice={() => navigate('/backoffice')}
        />

        {cvTab && <CctvPanel cvData={cvData} onResolve={resolveAlert} />}

        <StatCards stats={stats} />
        <RevenueChart trendData={trendData} />
        <QuickActions />
        <RecentOrders orders={recentOrders as Parameters<typeof RecentOrders>[0]['orders']} />
      </div>
    </div>
  )
}
