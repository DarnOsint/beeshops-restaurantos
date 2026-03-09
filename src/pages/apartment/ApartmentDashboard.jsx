import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  LogOut, BedDouble, ShoppingBag, Users, TrendingUp,
  Plus, X, CheckCircle, Clock, ArrowLeft, RefreshCw,
  Phone, Mail, Calendar, DollarSign, Loader2, AlertTriangle,
  ChevronDown, ChevronUp, Eye
} from 'lucide-react'

const TABS = [
  { id: 'rooms', label: 'Rooms', icon: BedDouble },
  { id: 'roomservice', label: 'Room Service', icon: ShoppingBag },
  { id: 'staff', label: 'Staff', icon: Users },
  { id: 'revenue', label: 'Revenue', icon: TrendingUp },
]

const STATUS_COLORS = {
  available: 'bg-green-500/20 text-green-400 border-green-500/30',
  occupied: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  maintenance: 'bg-red-500/20 text-red-400 border-red-500/30',
  reserved: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
}

const fmt = (n) => '₦' + (n || 0).toLocaleString()

export default function ApartmentDashboard() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('rooms')
  const [rooms, setRooms] = useState([])
  const [stays, setStays] = useState([])
  const [serviceOrders, setServiceOrders] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCheckIn, setShowCheckIn] = useState(null) // room object
  const [showStayDetails, setShowStayDetails] = useState(null)
  const [saving, setSaving] = useState(false)
  const [checkInForm, setCheckInForm] = useState({
    guest_name: '', guest_phone: '', guest_email: '',
    check_in_date: new Date().toISOString().split('T')[0],
    check_out_date: '', adults: 1, children: 0,
    payment_method: 'cash', amount_paid: '', notes: ''
  })

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [roomsRes, staysRes, serviceRes, staffRes] = await Promise.all([
      supabase.from('rooms').select('*').order('room_number'),
      supabase.from('room_stays').select('*, rooms(room_number, room_type, rate_per_night)').order('created_at', { ascending: false }),
      supabase.from('room_service_orders').select('*, rooms(room_number)').order('created_at', { ascending: false }).limit(50),
      supabase.from('profiles').select('id, full_name, role, phone, is_active, hire_date').eq('is_active', true),
    ])
    setRooms(roomsRes.data || [])
    setStays(staysRes.data || [])
    setServiceOrders(serviceRes.data || [])
    setStaff((staffRes.data || []).filter(s => ['apartment_manager', 'manager', 'owner'].includes(s.role) === false))
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Realtime room updates
  useEffect(() => {
    const ch = supabase.channel('apt-rooms')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_service_orders' }, fetchAll)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [fetchAll])

  async function handleCheckIn() {
    if (!showCheckIn || !checkInForm.guest_name || !checkInForm.check_out_date) return
    setSaving(true)
    const nights = Math.ceil(
      (new Date(checkInForm.check_out_date) - new Date(checkInForm.check_in_date)) / (1000 * 60 * 60 * 24)
    )
    const totalAmount = nights * showCheckIn.rate_per_night

    await supabase.from('room_stays').insert({
      room_id: showCheckIn.id,
      guest_name: checkInForm.guest_name,
      guest_phone: checkInForm.guest_phone,
      guest_email: checkInForm.guest_email,
      check_in_date: checkInForm.check_in_date,
      check_out_date: checkInForm.check_out_date,
      adults: checkInForm.adults,
      children: checkInForm.children,
      total_amount: totalAmount,
      amount_paid: parseFloat(checkInForm.amount_paid) || totalAmount,
      payment_method: checkInForm.payment_method,
      notes: checkInForm.notes,
      status: 'active',
      checked_in_by: profile?.id,
    })

    await supabase.from('rooms').update({ status: 'occupied' }).eq('id', showCheckIn.id)
    setShowCheckIn(null)
    setCheckInForm({ guest_name:'', guest_phone:'', guest_email:'', check_in_date: new Date().toISOString().split('T')[0], check_out_date:'', adults:1, children:0, payment_method:'cash', amount_paid:'', notes:'' })
    setSaving(false)
    fetchAll()
  }

  async function handleCheckOut(stay) {
    if (!window.confirm(`Check out ${stay.guest_name}?`)) return
    setSaving(true)
    await supabase.from('room_stays').update({ status: 'checked_out', actual_check_out: new Date().toISOString() }).eq('id', stay.id)
    await supabase.from('rooms').update({ status: 'available' }).eq('id', stay.room_id)
    setSaving(false)
    fetchAll()
  }

  async function updateRoomStatus(roomId, status) {
    await supabase.from('rooms').update({ status }).eq('id', roomId)
    fetchAll()
  }

  // ── STATS ─────────────────────────────────────────────────
  const available = rooms.filter(r => r.status === 'available').length
  const occupied = rooms.filter(r => r.status === 'occupied').length
  const maintenance = rooms.filter(r => r.status === 'maintenance').length
  const occupancyRate = rooms.length ? ((occupied / rooms.length) * 100).toFixed(0) : 0

  const thisMonthStays = stays.filter(s => {
    const d = new Date(s.created_at)
    const now = new Date()
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const monthRevenue = thisMonthStays.reduce((s, st) => s + (st.amount_paid || 0), 0)
  const pendingServiceOrders = serviceOrders.filter(o => o.status === 'pending').length

  const activeStays = stays.filter(s => s.status === 'active')

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
            <BedDouble size={16} className="text-black" />
          </div>
          <div>
            <h1 className="text-white font-bold">Apartments</h1>
            <p className="text-gray-500 text-xs">{profile?.full_name} · Apartment Manager</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchAll} className="text-gray-400 hover:text-white"><RefreshCw size={15} /></button>
          <button onClick={signOut} className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 text-xs border border-gray-700 rounded-lg px-3 py-1.5 transition-colors">
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-4 border-b border-gray-800">
        {[
          { label: 'Available', value: available, color: 'text-green-400' },
          { label: 'Occupied', value: occupied, color: 'text-amber-400' },
          { label: 'Occupancy', value: `${occupancyRate}%`, color: 'text-blue-400' },
          { label: 'Month Revenue', value: fmt(monthRevenue), color: 'text-amber-400' },
        ].map(k => (
          <div key={k.label} className="px-6 py-4 border-r border-gray-800 last:border-r-0">
            <p className="text-gray-500 text-xs uppercase tracking-wide">{k.label}</p>
            <p className={`text-xl font-bold mt-1 ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${tab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-500 hover:text-white'}`}>
            <t.icon size={14} /> {t.label}
            {t.id === 'roomservice' && pendingServiceOrders > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[18px] text-center">{pendingServiceOrders}</span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64"><Loader2 size={32} className="animate-spin text-amber-500" /></div>
      ) : (
        <div className="p-6">

          {/* ── ROOMS TAB ── */}
          {tab === 'rooms' && (
            <div className="space-y-6">
              {/* Active stays */}
              {activeStays.length > 0 && (
                <div>
                  <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><CheckCircle size={16} className="text-amber-400" /> Active Stays ({activeStays.length})</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeStays.map(stay => {
                      const checkOut = new Date(stay.check_out_date)
                      const today = new Date()
                      const daysLeft = Math.ceil((checkOut - today) / (1000 * 60 * 60 * 24))
                      return (
                        <div key={stay.id} className="bg-gray-900 border border-amber-500/30 rounded-2xl p-4">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <p className="text-white font-semibold">{stay.guest_name}</p>
                              <p className="text-gray-500 text-xs">Room {stay.rooms?.room_number} · {stay.rooms?.room_type}</p>
                            </div>
                            <span className={`text-xs px-2 py-1 rounded-lg font-medium ${daysLeft <= 1 ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                              {daysLeft <= 0 ? 'Due today' : `${daysLeft}d left`}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                            <div><p className="text-gray-500">Check-in</p><p className="text-white">{new Date(stay.check_in_date).toLocaleDateString('en-GB')}</p></div>
                            <div><p className="text-gray-500">Check-out</p><p className="text-white">{new Date(stay.check_out_date).toLocaleDateString('en-GB')}</p></div>
                            <div><p className="text-gray-500">Paid</p><p className="text-amber-400 font-medium">{fmt(stay.amount_paid)}</p></div>
                            <div><p className="text-gray-500">Guests</p><p className="text-white">{stay.adults} adults{stay.children > 0 ? `, ${stay.children} children` : ''}</p></div>
                          </div>
                          {stay.guest_phone && (
                            <p className="text-gray-500 text-xs mb-3 flex items-center gap-1"><Phone size={10} /> {stay.guest_phone}</p>
                          )}
                          <button onClick={() => handleCheckOut(stay)} disabled={saving}
                            className="w-full bg-gray-800 hover:bg-red-500/20 hover:text-red-400 text-gray-300 text-xs font-medium rounded-xl py-2 transition-colors">
                            Check Out
                          </button>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* All rooms grid */}
              <div>
                <h2 className="text-white font-semibold mb-3 flex items-center gap-2"><BedDouble size={16} className="text-amber-400" /> All Rooms ({rooms.length})</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {rooms.map(room => (
                    <div key={room.id} className={`bg-gray-900 border rounded-2xl p-4 ${STATUS_COLORS[room.status] || 'border-gray-700'}`}>
                      <div className="flex justify-between items-start mb-2">
                        <p className="text-white font-bold text-lg">#{room.room_number}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${STATUS_COLORS[room.status]}`}>{room.status}</span>
                      </div>
                      <p className="text-gray-400 text-xs capitalize mb-1">{room.room_type}</p>
                      <p className="text-amber-400 text-xs font-medium mb-3">{fmt(room.rate_per_night)}/night</p>
                      {room.status === 'available' && (
                        <button onClick={() => setShowCheckIn(room)}
                          className="w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl py-1.5 transition-colors">
                          Check In
                        </button>
                      )}
                      {room.status === 'occupied' && (
                        <button onClick={() => {
                          const stay = activeStays.find(s => s.room_id === room.id)
                          if (stay) setShowStayDetails(stay)
                        }} className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded-xl py-1.5 transition-colors flex items-center justify-center gap-1">
                          <Eye size={11} /> View
                        </button>
                      )}
                      {room.status === 'available' && (
                        <button onClick={() => updateRoomStatus(room.id, 'maintenance')}
                          className="w-full mt-1 text-gray-600 hover:text-red-400 text-xs py-1 transition-colors">
                          Set Maintenance
                        </button>
                      )}
                      {room.status === 'maintenance' && (
                        <button onClick={() => updateRoomStatus(room.id, 'available')}
                          className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs rounded-xl py-1.5 transition-colors">
                          Mark Available
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ── ROOM SERVICE TAB ── */}
          {tab === 'roomservice' && (
            <div>
              <h2 className="text-white font-semibold mb-4">Room Service Orders</h2>
              {serviceOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-500">No room service orders yet</div>
              ) : (
                <div className="space-y-3">
                  {serviceOrders.map(order => (
                    <div key={order.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-white font-medium">Room {order.rooms?.room_number}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${order.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : order.status === 'delivered' ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                            {order.status}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs">{new Date(order.created_at).toLocaleString('en-GB')}</p>
                        {order.notes && <p className="text-gray-500 text-xs mt-1 italic">{order.notes}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-amber-400 font-bold">{fmt(order.total_amount)}</p>
                        {order.status === 'pending' && (
                          <button onClick={async () => {
                            await supabase.from('room_service_orders').update({ status: 'delivered' }).eq('id', order.id)
                            fetchAll()
                          }} className="mt-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs px-3 py-1 rounded-lg transition-colors">
                            Mark Delivered
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── STAFF TAB ── */}
          {tab === 'staff' && (
            <div>
              <h2 className="text-white font-semibold mb-4">Apartment Staff</h2>
              {staff.length === 0 ? (
                <div className="text-center py-16 text-gray-500">No staff records. Add staff via Back Office.</div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {staff.map(s => (
                    <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
                          <span className="text-amber-400 font-bold text-sm">{s.full_name?.charAt(0) || '?'}</span>
                        </div>
                        <div>
                          <p className="text-white font-medium">{s.full_name}</p>
                          <p className="text-gray-500 text-xs capitalize">{s.role}</p>
                        </div>
                      </div>
                      {s.phone && <p className="text-gray-400 text-xs flex items-center gap-1"><Phone size={10} /> {s.phone}</p>}
                      {s.hire_date && <p className="text-gray-500 text-xs mt-1">Hired {new Date(s.hire_date).toLocaleDateString('en-GB')}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── REVENUE TAB ── */}
          {tab === 'revenue' && (
            <div className="space-y-6">
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'This Month', value: fmt(monthRevenue), sub: `${thisMonthStays.length} stays` },
                  { label: 'Total Stays', value: stays.filter(s => s.status === 'checked_out').length, sub: 'all time' },
                  { label: 'Avg Stay Value', value: stays.length ? fmt(Math.round(stays.reduce((s,st)=>s+(st.amount_paid||0),0)/stays.length)) : '₦0', sub: 'per booking' },
                  { label: 'Room Service', value: fmt(serviceOrders.reduce((s,o)=>s+(o.total_amount||0),0)), sub: 'total' },
                ].map(card => (
                  <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                    <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">{card.label}</p>
                    <p className="text-amber-400 text-2xl font-bold">{card.value}</p>
                    <p className="text-gray-600 text-xs mt-1">{card.sub}</p>
                  </div>
                ))}
              </div>

              {/* Recent stays table */}
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-800">
                  <h3 className="text-white font-semibold">Recent Stays</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left text-gray-500 text-xs uppercase px-6 py-3">Guest</th>
                        <th className="text-left text-gray-500 text-xs uppercase px-4 py-3">Room</th>
                        <th className="text-left text-gray-500 text-xs uppercase px-4 py-3">Check-in</th>
                        <th className="text-left text-gray-500 text-xs uppercase px-4 py-3">Check-out</th>
                        <th className="text-right text-gray-500 text-xs uppercase px-6 py-3">Amount</th>
                        <th className="text-left text-gray-500 text-xs uppercase px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stays.slice(0, 20).map(stay => (
                        <tr key={stay.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-6 py-3">
                            <p className="text-white">{stay.guest_name}</p>
                            {stay.guest_phone && <p className="text-gray-500 text-xs">{stay.guest_phone}</p>}
                          </td>
                          <td className="px-4 py-3 text-gray-300">#{stay.rooms?.room_number}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{new Date(stay.check_in_date).toLocaleDateString('en-GB')}</td>
                          <td className="px-4 py-3 text-gray-400 text-xs">{new Date(stay.check_out_date).toLocaleDateString('en-GB')}</td>
                          <td className="px-6 py-3 text-right text-amber-400 font-medium">{fmt(stay.amount_paid)}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2 py-0.5 rounded-full ${stay.status === 'active' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                              {stay.status === 'active' ? 'Active' : 'Checked Out'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── CHECK-IN MODAL ── */}
      {showCheckIn && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
              <h2 className="text-white font-bold">Check In — Room #{showCheckIn.room_number}</h2>
              <button onClick={() => setShowCheckIn(null)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-xs text-amber-400">
                {showCheckIn.room_type} · {fmt(showCheckIn.rate_per_night)}/night
              </div>

              {[
                { label: 'Guest Name *', key: 'guest_name', type: 'text', placeholder: 'Full name' },
                { label: 'Phone', key: 'guest_phone', type: 'tel', placeholder: '080xxxxxxxx' },
                { label: 'Email', key: 'guest_email', type: 'email', placeholder: 'optional' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">{f.label}</label>
                  <input type={f.type} value={checkInForm[f.key]}
                    onChange={e => setCheckInForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
              ))}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Check-in Date *</label>
                  <input type="date" value={checkInForm.check_in_date}
                    onChange={e => setCheckInForm(p => ({ ...p, check_in_date: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Check-out Date *</label>
                  <input type="date" value={checkInForm.check_out_date}
                    onChange={e => setCheckInForm(p => ({ ...p, check_out_date: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Adults</label>
                  <input type="number" min="1" value={checkInForm.adults}
                    onChange={e => setCheckInForm(p => ({ ...p, adults: parseInt(e.target.value) }))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Children</label>
                  <input type="number" min="0" value={checkInForm.children}
                    onChange={e => setCheckInForm(p => ({ ...p, children: parseInt(e.target.value) }))}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
              </div>

              {checkInForm.check_out_date && checkInForm.check_in_date && (
                <div className="bg-gray-800 rounded-xl p-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-400">Nights</span>
                    <span className="text-white font-medium">
                      {Math.max(0, Math.ceil((new Date(checkInForm.check_out_date) - new Date(checkInForm.check_in_date)) / (1000 * 60 * 60 * 24)))}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">Total</span>
                    <span className="text-amber-400 font-bold">
                      {fmt(Math.max(0, Math.ceil((new Date(checkInForm.check_out_date) - new Date(checkInForm.check_in_date)) / (1000 * 60 * 60 * 24))) * showCheckIn.rate_per_night)}
                    </span>
                  </div>
                </div>
              )}

              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Payment Method</label>
                <select value={checkInForm.payment_method}
                  onChange={e => setCheckInForm(p => ({ ...p, payment_method: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm">
                  <option value="cash">Cash</option>
                  <option value="card">Bank POS</option>
                  <option value="transfer">Bank Transfer</option>
                </select>
              </div>

              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Amount Paid (leave blank for full payment)</label>
                <input type="number" value={checkInForm.amount_paid}
                  onChange={e => setCheckInForm(p => ({ ...p, amount_paid: e.target.value }))}
                  placeholder="Auto-fills total"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
              </div>

              <div>
                <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">Notes</label>
                <textarea value={checkInForm.notes}
                  onChange={e => setCheckInForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Special requests, etc."
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none" />
              </div>

              <button onClick={handleCheckIn} disabled={saving || !checkInForm.guest_name || !checkInForm.check_out_date}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                {saving ? 'Checking in...' : 'Confirm Check In'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
