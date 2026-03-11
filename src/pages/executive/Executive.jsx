import { useAuth } from '../../context/AuthContext'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { HelpTooltip } from '../../components/HelpTooltip'
import { 
  LayoutDashboard, ShoppingBag, Users, BedDouble,
  TrendingUp, Package, LogOut, Beer, RefreshCw, Settings,
  BookOpen, BarChart2, MapPin
} from 'lucide-react'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  return 'Evening'
}

export default function Executive() {
  const { profile, signOut } = useAuth()
  const [geofenceEnabled, setGeofenceEnabled] = useState(true)
  const [geoToggling, setGeoToggling] = useState(false)
  const [radiusMain, setRadiusMain] = useState(400)
  const [radiusApartment, setRadiusApartment] = useState(200)
  const [radiusSaving, setRadiusSaving] = useState(false)
  const [showRadiusEdit, setShowRadiusEdit] = useState(false)
  const navigate = useNavigate()
  const [stats, setStats] = useState({
    revenue: 0, openOrders: 0, occupiedTables: 0,
    occupiedRooms: 0, staffOnDuty: 0, lowStock: 0,
  })
  const [recentOrders, setRecentOrders] = useState([])
  const [trendData, setTrendData] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
    supabase.from('settings').select('id, value')
      .in('id', ['geofence_enabled', 'geofence_radius_main', 'geofence_radius_apartment'])
      .then(({ data }) => {
        if (!data) return
        const map = Object.fromEntries(data.map(r => [r.id, r.value]))
        if (map['geofence_enabled'] !== undefined) setGeofenceEnabled(map['geofence_enabled'] === 'true')
        if (map['geofence_radius_main']) setRadiusMain(parseInt(map['geofence_radius_main']))
        if (map['geofence_radius_apartment']) setRadiusApartment(parseInt(map['geofence_radius_apartment']))
      })
    const interval = setInterval(fetchStats, 30000)
    const channel = supabase
      .channel('executive-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, () => fetchStats())
      .subscribe()
    return () => { clearInterval(interval); supabase.removeChannel(channel) }
  }, [])

  const toggleGeofence = async () => {
    setGeoToggling(true)
    const newVal = (!geofenceEnabled).toString()
    await supabase.from('settings').update({ value: newVal, updated_at: new Date().toISOString() }).eq('id', 'geofence_enabled')
    setGeofenceEnabled(!geofenceEnabled)
    setGeoToggling(false)
  }

  const saveRadius = async () => {
    setRadiusSaving(true)
    await Promise.all([
      supabase.from('settings').update({ value: String(radiusMain), updated_at: new Date().toISOString() }).eq('id', 'geofence_radius_main'),
      supabase.from('settings').update({ value: String(radiusApartment), updated_at: new Date().toISOString() }).eq('id', 'geofence_radius_apartment'),
    ])
    setRadiusSaving(false)
    setShowRadiusEdit(false)
  }

  const fetchStats = async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [ordersRes, tablesRes, roomsRes, shiftsRes, stockRes, recentRes, revenueRes, trendRes] = await Promise.all([
      supabase.from('orders').select('id').eq('status', 'open'),
      supabase.from('tables').select('status'),
      supabase.from('rooms').select('status'),
      supabase.from('attendance').select('id').eq('date', new Date().toISOString().split('T')[0]).is('clock_out', null),
      supabase.from('inventory').select('id, current_stock, minimum_stock').eq('is_active', true),
      supabase.from('orders').select('*, tables(name), profiles(full_name)').order('created_at', { ascending: false }).limit(8),
      supabase.from('orders').select('total_amount').eq('status', 'paid').gte('created_at', today.toISOString()),
      supabase.from('orders').select('created_at, total_amount').eq('status', 'paid')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: true })
    ])
    const lowStockCount = stockRes.data?.filter(i => i.current_stock <= i.minimum_stock).length || 0
    setStats({
      revenue: revenueRes.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0,
      openOrders: ordersRes.data?.length || 0,
      occupiedTables: tablesRes.data?.filter(t => t.status === 'occupied').length || 0,
      occupiedRooms: roomsRes.data?.filter(r => r.status === 'occupied').length || 0,
      staffOnDuty: shiftsRes.data?.length || 0,
      lowStock: lowStockCount,
    })
    setRecentOrders(recentRes.data || [])
    const dayMap = {}
    ;(trendRes.data || []).forEach(o => {
      const day = new Date(o.created_at).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric' })
      if (!dayMap[day]) dayMap[day] = { day, revenue: 0, orders: 0 }
      dayMap[day].revenue += o.total_amount || 0
      dayMap[day].orders++
    })
    setTrendData(Object.values(dayMap))
    setLoading(false)
  }

  const statCards = [
    { label: "Today's Revenue", value: `₦${stats.revenue.toLocaleString('en-NG', { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: "text-green-400", bg: "bg-green-400/10" },
    { label: "Open Orders", value: stats.openOrders.toString(), icon: ShoppingBag, color: "text-amber-400", bg: "bg-amber-400/10" },
    { label: "Occupied Tables", value: `${stats.occupiedTables}/60`, icon: LayoutDashboard, color: "text-blue-400", bg: "bg-blue-400/10" },
    { label: "Occupied Rooms", value: `${stats.occupiedRooms}/20`, icon: BedDouble, color: "text-purple-400", bg: "bg-purple-400/10" },
    { label: "Staff On Duty", value: stats.staffOnDuty.toString(), icon: Users, color: "text-pink-400", bg: "bg-pink-400/10" },
    { label: "Low Stock Items", value: stats.lowStock.toString(), icon: Package, color: stats.lowStock > 0 ? "text-red-400" : "text-gray-400", bg: stats.lowStock > 0 ? "bg-red-400/10" : "bg-gray-400/10" },
  ]

  const quickActions = [
    { label: 'Accounting', icon: BookOpen, color: 'bg-green-600', path: '/accounting' },
    { label: 'Reports', icon: BarChart2, color: 'bg-indigo-500', path: '/reports' },
    { label: 'Back Office', icon: Settings, color: 'bg-amber-500', path: '/backoffice' },
    { label: 'Management', icon: Users, color: 'bg-blue-500', path: '/management' },
    { label: 'View Rooms', icon: BedDouble, color: 'bg-purple-500', path: '/rooms' },
  ]

  const peakHour = (() => {
    const hourMap = {}
    recentOrders.forEach(o => { const h = new Date(o.created_at).getHours(); hourMap[h] = (hourMap[h] || 0) + 1 })
    const peak = Object.entries(hourMap).sort((a, b) => b[1] - a[1])[0]
    if (!peak) return null
    const h = parseInt(peak[0])
    return `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`
  })()

  const maxRevenue = Math.max(...trendData.map(d => d.revenue), 1)

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Sticky title bar */}
      <div className="sticky top-0 z-20 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 md:px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="text-white font-bold text-sm md:text-base">Executive Dashboard</h1>
          <p className="text-gray-400 text-xs">Good {getGreeting()}, {profile?.full_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <HelpTooltip tips={[
            { id: 'exec-kpis', title: 'Live KPIs', description: 'Real-time revenue, open orders, occupied tables, rooms, staff on duty, and low stock alerts. Updates every 30 seconds.' },
            { id: 'exec-geofence', title: 'Geofence', description: 'Toggle location restrictions. When ON, waitrons and floor staff can only access the app within the restaurant premises.' },
            { id: 'exec-nav', title: 'Quick Navigation', description: 'Jump directly to BackOffice, Analytics, Reports, Management, Accounting, and Rooms from the action buttons below.' },
            { id: 'exec-orders', title: 'Recent Orders', description: 'Live feed of the most recent orders across all tables and rooms.' },
            { id: 'exec-trend', title: 'Revenue Trend', description: '7-day revenue chart showing daily performance at a glance.' },
          ]} />
          <button onClick={fetchStats} className="text-gray-400 hover:text-white">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="p-4 md:p-6">

        {/* Geofence + status controls */}
        <div className="mb-6 flex flex-wrap items-center gap-2 relative">
          <button onClick={toggleGeofence} disabled={geoToggling}
            className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors ${
              geofenceEnabled
                ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20'
                : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
            }`}>
            <MapPin size={13} />
            {geoToggling ? 'Updating...' : geofenceEnabled ? 'Geofence ON' : 'Geofence OFF'}
            <span className={`w-2 h-2 rounded-full ${geofenceEnabled ? 'bg-green-400' : 'bg-red-400'}`} />
          </button>

          <button onClick={() => setShowRadiusEdit(!showRadiusEdit)}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border bg-gray-800 border-gray-700 text-gray-400 hover:text-white transition-colors">
            <MapPin size={13} /> Radius
          </button>

          {stats.lowStock > 0 && (
            <button onClick={() => navigate('/backoffice')}
              className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 hover:bg-red-500/20 transition-colors">
              <Package size={13} /> {stats.lowStock} Low Stock
            </button>
          )}

          {peakHour && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
              <p className="text-amber-400 text-xs">Peak Hour</p>
              <p className="text-white font-bold text-sm">{peakHour}</p>
            </div>
          )}

          {showRadiusEdit && (
            <div className="absolute top-12 left-0 z-50 bg-gray-900 border border-gray-700 rounded-2xl p-4 shadow-xl w-72">
              <p className="text-white font-semibold text-sm mb-3">Geofence Radius Settings</p>
              <div className="space-y-3">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Main Venue (metres)</label>
                  <input type="number" value={radiusMain}
                    onChange={e => setRadiusMain(parseInt(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Apartments (metres)</label>
                  <input type="number" value={radiusApartment}
                    onChange={e => setRadiusApartment(parseInt(e.target.value) || 0)}
                    className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500" />
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={saveRadius} disabled={radiusSaving}
                    className="flex-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold py-2 rounded-xl transition-colors">
                    {radiusSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button onClick={() => setShowRadiusEdit(false)}
                    className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs py-2 rounded-xl transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {statCards.map((stat, i) => (
            <div key={i} className="bg-gray-900 rounded-2xl p-4 md:p-5 border border-gray-800">
              <div className={`inline-flex p-2 rounded-lg ${stat.bg} mb-3`}>
                <stat.icon size={18} className={stat.color} />
              </div>
              <p className="text-gray-400 text-xs md:text-sm">{stat.label}</p>
              <p className="text-white text-xl md:text-2xl font-bold mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        {/* Revenue chart */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 md:p-5 mb-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm md:text-base">Revenue — Last 7 Days</h3>
            <button onClick={() => navigate('/reports')}
              className="text-amber-400 hover:text-amber-300 text-xs transition-colors">
              Full report →
            </button>
          </div>
          {trendData.length === 0 ? (
            <div className="text-center py-8 text-gray-600 text-sm">No revenue data yet</div>
          ) : (
            <div className="flex items-end gap-2 md:gap-3 h-32">
              {trendData.map((d, i) => {
                const height = Math.max((d.revenue / maxRevenue) * 100, 2)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <p className="text-gray-500 text-[10px]">₦{(d.revenue / 1000).toFixed(0)}k</p>
                    <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                      <div className="w-full bg-amber-500 rounded-t-md transition-all" style={{ height: `${height}%` }} />
                    </div>
                    <p className="text-gray-600 text-[10px] whitespace-nowrap">{d.day}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="mb-8">
          <h3 className="text-white font-semibold text-sm md:text-base mb-4">Quick Actions</h3>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {quickActions.map((action, i) => (
              <button key={i} onClick={() => navigate(action.path)}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 md:p-4 flex flex-col items-center gap-2 hover:border-gray-600 transition-colors">
                <div className={`w-9 h-9 md:w-10 md:h-10 ${action.color} rounded-lg flex items-center justify-center`}>
                  <action.icon size={16} className="text-white" />
                </div>
                <span className="text-gray-300 text-xs md:text-sm text-center">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent orders */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4 md:p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-sm md:text-base">Recent Orders</h3>
            <span className="text-gray-500 text-xs">{recentOrders.length} latest</span>
          </div>
          {recentOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-3">
                <ShoppingBag size={24} className="text-gray-600" />
              </div>
              <p className="text-gray-400">No activity yet today</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentOrders.map(order => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0">
                  <div className="min-w-0 flex-1 mr-3">
                    <p className="text-white text-sm font-medium truncate">{order.tables?.name || order.order_type || 'Unknown'}</p>
                    <p className="text-gray-500 text-xs truncate">{order.profiles?.full_name} · {new Date(order.created_at).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-white text-sm font-bold">₦{order.total_amount?.toLocaleString()}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      order.status === 'open' ? 'bg-amber-500/20 text-amber-400' :
                      order.status === 'paid' ? 'bg-green-500/20 text-green-400' :
                      'bg-gray-700 text-gray-400'
                    }`}>{order.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
