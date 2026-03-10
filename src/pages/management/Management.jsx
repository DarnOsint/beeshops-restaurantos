import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { 
  Beer, LogOut, Users, LayoutDashboard, 
  ShoppingBag, TrendingUp, Clock, ChevronRight, DollarSign, Settings, BookOpen, BedDouble
} from 'lucide-react'
import ShiftManager from './ShiftManager'
import TableAssignment from './TableAssignment'
import TillManagement from './TillManagement'
import WaiterCalls from './WaiterCalls'

export default function Management() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('overview')
  const [stats, setStats] = useState({
    openOrders: 0,
    occupiedTables: 0,
    occupiedRooms: 0,
    staffOnShift: 0,
    todayRevenue: 0
  })

  useEffect(() => {
    fetchStats()
    const channel = supabase
      .channel('management-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, () => fetchStats())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, () => fetchStats())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const fetchStats = async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [ordersRes, tablesRes, roomsRes, staffRes, revenueRes] = await Promise.all([
      supabase.from('orders').select('id').eq('status', 'open'),
      supabase.from('tables').select('id').eq('status', 'occupied'),
      supabase.from('rooms').select('status'),
      supabase.from('attendance').select('id').eq('date', new Date().toISOString().split('T')[0]).is('clock_out', null),
      supabase.from('orders').select('total_amount').eq('status', 'paid').gte('created_at', today.toISOString())
    ])

    setStats({
      openOrders: ordersRes.data?.length || 0,
      occupiedTables: tablesRes.data?.length || 0,
      occupiedRooms: roomsRes.data?.filter(r => r.status === 'occupied').length || 0,
      staffOnShift: staffRes.data?.length || 0,
      todayRevenue: revenueRes.data?.reduce((sum, o) => sum + (o.total_amount || 0), 0) || 0
    })
  }

  const tabs = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'shifts', label: 'Shifts', icon: Clock },
    { id: 'tables', label: 'Tables', icon: Users },
    { id: 'orders', label: 'Orders', icon: ShoppingBag },
    { id: 'till', label: 'Till', icon: DollarSign },
  ]

  return (
    <div className="min-h-screen bg-gray-950">

      {/* Waiter call alerts — floats top right */}
      <WaiterCalls />



      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto">
        {tabs.map(tab => (
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
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'Open Orders', value: stats.openOrders, icon: ShoppingBag, color: 'text-amber-400', bg: 'bg-amber-400/10' },
                { label: 'Occupied Tables', value: `${stats.occupiedTables}/60`, icon: LayoutDashboard, color: 'text-blue-400', bg: 'bg-blue-400/10' },
                { label: 'Occupied Rooms', value: `${stats.occupiedRooms}/20`, icon: BedDouble, color: 'text-purple-400', bg: 'bg-purple-400/10' },
                { label: 'Staff On Shift', value: stats.staffOnShift, icon: Users, color: 'text-green-400', bg: 'bg-green-400/10' },
                { label: 'Revenue Today', value: `₦${stats.todayRevenue.toLocaleString()}`, icon: TrendingUp, color: 'text-pink-400', bg: 'bg-pink-400/10' },
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
                  { label: 'Manage Staff Shifts', sub: 'Clock in/out staff members', action: () => setActiveTab('shifts'), icon: Clock },
                  { label: 'Assign Tables', sub: 'Assign tables to waitrons', action: () => setActiveTab('tables'), icon: Users },
                  { label: 'View Open Orders', sub: 'Monitor active orders', action: () => setActiveTab('orders'), icon: ShoppingBag },
                  { label: 'Till Management', sub: 'Cash control and payouts', action: () => setActiveTab('till'), icon: DollarSign },
                  { label: 'Room Management', sub: 'Check-in, check-out and room status', action: () => navigate('/rooms'), icon: BedDouble },
                  { label: 'Accounting', sub: 'Sales reports, trends and expenses', action: () => navigate('/accounting'), icon: BookOpen },
                  { label: 'Back Office', sub: 'Menu, staff and table config', action: () => navigate('/backoffice'), icon: Settings },
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
      </div>
    </div>
  )
}

function OpenOrders() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchOrders()
    const channel = supabase
      .channel('orders-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => fetchOrders())
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const fetchOrders = async () => {
    const { data, error } = await supabase
      .from('orders')
      .select('*, tables(name), profiles(full_name), order_items(*, menu_items(name))')
      .eq('status', 'open')
      .order('created_at', { ascending: false })
    if (!error) setOrders(data)
    setLoading(false)
  }

  if (loading) return (
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
      ) : orders.map(order => (
        <div key={order.id} className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-white font-bold">{order.tables?.name || 'Unknown Table'}</p>
              <p className="text-gray-400 text-xs">{order.profiles?.full_name}</p>
            </div>
            <div className="text-right">
              <p className="text-amber-400 font-bold">₦{order.total_amount?.toLocaleString()}</p>
              <p className="text-gray-500 text-xs">{new Date(order.created_at).toLocaleTimeString()}</p>
            </div>
          </div>
          <div className="space-y-1">
            {order.order_items?.map(item => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-gray-300">{item.quantity}x {item.menu_items?.name}</span>
                <span className="text-gray-400">₦{item.total_price?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}