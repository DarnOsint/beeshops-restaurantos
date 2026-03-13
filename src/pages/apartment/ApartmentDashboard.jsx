import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  LogOut,
  BedDouble,
  ShoppingBag,
  Users,
  TrendingUp,
  X,
  CheckCircle,
  Clock,
  RefreshCw,
  Phone,
  Calendar,
  Loader2,
  AlertTriangle,
  Eye,
  Banknote,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

const fmt = (n) => '\u20a6' + Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2 })
const fmtShort = (n) => '\u20a6' + Number(n || 0).toLocaleString('en-NG')
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '\u2014'
const todayStr = () => new Date().toISOString().split('T')[0]

const STATUS_CONFIG = {
  available: {
    bg: 'bg-green-500/15',
    border: 'border-green-500/30',
    text: 'text-green-400',
    dot: 'bg-green-400',
  },
  occupied: {
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  maintenance: {
    bg: 'bg-red-500/15',
    border: 'border-red-500/30',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
  reserved: {
    bg: 'bg-blue-500/15',
    border: 'border-blue-500/30',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'card', label: 'Bank POS' },
  { value: 'transfer', label: 'Bank Transfer' },
  { value: 'credit', label: 'Credit Account' },
]

const TABS = [
  { id: 'rooms', label: 'Rooms', icon: BedDouble },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'roomservice', label: 'Room Service', icon: ShoppingBag },
  { id: 'revenue', label: 'Revenue', icon: TrendingUp },
  { id: 'staff', label: 'Staff', icon: Users },
]

const CAL_DAYS = 14

function BalanceBadge({ total, paid }) {
  const balance = (total || 0) - (paid || 0)
  if (balance <= 0) return <span className="text-xs text-green-400 font-medium">Fully paid</span>
  return <span className="text-xs text-red-400 font-semibold">{fmt(balance)} due</span>
}

export default function ApartmentDashboard() {
  const { profile, signOut } = useAuth()
  const [tab, setTab] = useState('rooms')
  const [rooms, setRooms] = useState([])
  const [stays, setStays] = useState([])
  const [serviceOrders, setServiceOrders] = useState([])
  const [staff, setStaff] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCheckIn, setShowCheckIn] = useState(null)
  const [showCheckOut, setShowCheckOut] = useState(null)
  const [showPayment, setShowPayment] = useState(null)
  const [showDetails, setShowDetails] = useState(null)
  const [saving, setSaving] = useState(false)
  const [checkInForm, setCheckInForm] = useState({
    guest_name: '',
    guest_phone: '',
    guest_email: '',
    guest_id_number: '',
    check_in_date: todayStr(),
    check_out_date: '',
    adults: 1,
    children: 0,
    payment_method: 'cash',
    amount_paid: '',
    notes: '',
  })
  const [payForm, setPayForm] = useState({ amount: '', method: 'cash', reference: '' })
  const [calStart, setCalStart] = useState(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const [roomsRes, staysRes, serviceRes, staffRes] = await Promise.all([
      supabase.from('rooms').select('*').order('room_number'),
      supabase
        .from('room_stays')
        .select('*, rooms(room_number, room_type, rate_per_night)')
        .order('created_at', { ascending: false }),
      supabase
        .from('room_service_orders')
        .select('*, rooms(room_number)')
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('profiles')
        .select('id, full_name, role, phone, is_active, hire_date')
        .eq('is_active', true),
    ])
    setRooms(roomsRes.data || [])
    setStays(staysRes.data || [])
    setServiceOrders(serviceRes.data || [])
    setStaff(
      (staffRes.data || []).filter(
        (s) => !['apartment_manager', 'manager', 'owner'].includes(s.role)
      )
    )
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  useEffect(() => {
    const ch = supabase
      .channel('apt-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchAll)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_service_orders' },
        fetchAll
      )
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [fetchAll])

  const activeStays = stays.filter((s) => s.status === 'active')
  const overstays = activeStays.filter((s) => new Date(s.check_out_date) < new Date())
  const dueToday = activeStays.filter((s) => {
    const d = new Date(s.check_out_date),
      t = new Date()
    t.setHours(0, 0, 0, 0)
    const tmr = new Date(t)
    tmr.setDate(tmr.getDate() + 1)
    return d >= t && d < tmr
  })
  const occupied = rooms.filter((r) => r.status === 'occupied').length
  const available = rooms.filter((r) => r.status === 'available').length
  const occupancyPct = rooms.length ? Math.round((occupied / rooms.length) * 100) : 0
  const now = new Date()
  const thisMonthStays = stays.filter((s) => {
    const d = new Date(s.created_at)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  })
  const monthRevenue = thisMonthStays.reduce((s, st) => s + (st.amount_paid || 0), 0)
  const totalOutstanding = activeStays.reduce(
    (s, st) => s + Math.max(0, (st.total_amount || 0) - (st.amount_paid || 0)),
    0
  )
  const pendingService = serviceOrders.filter((o) => o.status === 'pending').length

  const nights =
    checkInForm.check_out_date && checkInForm.check_in_date
      ? Math.max(
          0,
          Math.ceil(
            (new Date(checkInForm.check_out_date) - new Date(checkInForm.check_in_date)) / 86400000
          )
        )
      : 0
  const totalDue = nights * (showCheckIn?.rate_per_night || 0)

  async function handleCheckIn() {
    if (!showCheckIn || !checkInForm.guest_name || !checkInForm.check_out_date) return
    setSaving(true)
    await supabase.from('room_stays').insert({
      room_id: showCheckIn.id,
      guest_name: checkInForm.guest_name,
      guest_phone: checkInForm.guest_phone,
      guest_email: checkInForm.guest_email,
      guest_id_number: checkInForm.guest_id_number,
      check_in_date: checkInForm.check_in_date,
      check_out_date: checkInForm.check_out_date,
      adults: checkInForm.adults,
      children: checkInForm.children,
      total_amount: totalDue,
      amount_paid: parseFloat(checkInForm.amount_paid) || totalDue,
      payment_method: checkInForm.payment_method,
      notes: checkInForm.notes,
      status: 'active',
      checked_in_by: profile?.id,
    })
    await supabase.from('rooms').update({ status: 'occupied' }).eq('id', showCheckIn.id)
    setShowCheckIn(null)
    setCheckInForm({
      guest_name: '',
      guest_phone: '',
      guest_email: '',
      guest_id_number: '',
      check_in_date: todayStr(),
      check_out_date: '',
      adults: 1,
      children: 0,
      payment_method: 'cash',
      amount_paid: '',
      notes: '',
    })
    setSaving(false)
    fetchAll()
  }

  async function confirmCheckOut() {
    if (!showCheckOut) return
    setSaving(true)
    await supabase
      .from('room_stays')
      .update({ status: 'checked_out', actual_check_out: new Date().toISOString() })
      .eq('id', showCheckOut.id)
    await supabase.from('rooms').update({ status: 'available' }).eq('id', showCheckOut.room_id)
    setShowCheckOut(null)
    setSaving(false)
    fetchAll()
  }

  async function recordPayment() {
    if (!showPayment || !payForm.amount) return
    setSaving(true)
    await supabase
      .from('room_stays')
      .update({
        amount_paid: (showPayment.amount_paid || 0) + parseFloat(payForm.amount),
        updated_at: new Date().toISOString(),
      })
      .eq('id', showPayment.id)
    setShowPayment(null)
    setPayForm({ amount: '', method: 'cash', reference: '' })
    setSaving(false)
    fetchAll()
  }

  async function updateRoomStatus(roomId, status) {
    await supabase.from('rooms').update({ status }).eq('id', roomId)
    fetchAll()
  }

  const calDays = Array.from({ length: CAL_DAYS }, (_, i) => {
    const d = new Date(calStart)
    d.setDate(d.getDate() + i)
    return d
  })

  function getRoomCalStatus(room, day) {
    const ds = day.toISOString().split('T')[0]
    const st = activeStays.find(
      (s) => s.room_id === room.id && ds >= s.check_in_date && ds < s.check_out_date
    )
    if (st) return { type: 'occupied', stay: st }
    return { type: 'available' }
  }

  const checkedOut = stays.filter((s) => s.status === 'checked_out')
  const allRevenue = stays.reduce((s, st) => s + (st.amount_paid || 0), 0)
  const adr = checkedOut.length
    ? Math.round(
        checkedOut.reduce((s, st) => {
          const n =
            Math.ceil((new Date(st.check_out_date) - new Date(st.check_in_date)) / 86400000) || 1
          return s + (st.amount_paid || 0) / n
        }, 0) / checkedOut.length
      )
    : 0
  const revpar = rooms.length ? Math.round(monthRevenue / rooms.length) : 0
  const monthlyRevenue = Array.from({ length: 6 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - (5 - i))
    const label = d.toLocaleDateString('en-NG', { month: 'short' })
    const rev = stays
      .filter((s) => {
        const sd = new Date(s.created_at)
        return sd.getMonth() === d.getMonth() && sd.getFullYear() === d.getFullYear()
      })
      .reduce((s, st) => s + (st.amount_paid || 0), 0)
    return { label, rev }
  })
  const maxMonthRev = Math.max(...monthlyRevenue.map((m) => m.rev), 1)

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center shrink-0">
              <BedDouble size={17} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold text-sm">Apartment Manager</h1>
              <p className="text-gray-500 text-xs">{profile?.full_name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchAll} className="p-2 rounded-xl hover:bg-gray-800 text-gray-400">
              <RefreshCw size={15} />
            </button>
            <button
              onClick={signOut}
              className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 text-xs border border-gray-700 rounded-xl px-3 py-2 transition-colors"
            >
              <LogOut size={13} /> Out
            </button>
          </div>
        </div>
      </div>

      {/* Alert banners */}
      {overstays.length > 0 && (
        <div className="mx-4 mt-3 bg-purple-500/10 border border-purple-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={16} className="text-purple-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-purple-400 font-semibold text-sm">
              {overstays.length} overstay{overstays.length !== 1 ? 's' : ''} — checkout date passed
            </p>
            <p className="text-gray-400 text-xs mt-0.5">
              {overstays.map((s) => `${s.guest_name} (Room ${s.rooms?.room_number})`).join(' · ')}
            </p>
          </div>
        </div>
      )}
      {dueToday.length > 0 && (
        <div className="mx-4 mt-2 bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 flex items-start gap-3">
          <Clock size={16} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-400 font-semibold text-sm">
              {dueToday.length} guest{dueToday.length !== 1 ? 's' : ''} checking out today
            </p>
            <p className="text-gray-400 text-xs mt-0.5">
              {dueToday.map((s) => `${s.guest_name} (Room ${s.rooms?.room_number})`).join(' · ')}
            </p>
          </div>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-px bg-gray-800 mx-4 mt-3 rounded-2xl overflow-hidden">
        {[
          { label: 'Available', value: available, color: 'text-green-400' },
          { label: 'Occupied', value: `${occupied}/${rooms.length}`, color: 'text-amber-400' },
          { label: 'Occupancy', value: `${occupancyPct}%`, color: 'text-blue-400' },
          {
            label: 'Outstanding',
            value: fmtShort(totalOutstanding),
            color: totalOutstanding > 0 ? 'text-red-400' : 'text-gray-500',
          },
        ].map((k) => (
          <div key={k.label} className="bg-gray-900 px-2 py-3 text-center">
            <p className={`text-sm font-black ${k.color}`}>{k.value}</p>
            <p className="text-gray-600 text-[10px] mt-0.5">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 px-2 mt-3 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-3 py-3 text-xs font-semibold border-b-2 whitespace-nowrap transition-colors relative ${tab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-500 hover:text-white'}`}
          >
            <t.icon size={13} />
            {t.label}
            {t.id === 'roomservice' && pendingService > 0 && (
              <span className="absolute -top-0.5 right-0 bg-red-500 text-white text-[9px] rounded-full w-4 h-4 flex items-center justify-center font-bold">
                {pendingService}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 size={28} className="animate-spin text-amber-500" />
        </div>
      ) : (
        <div className="px-4 pt-4 space-y-4">
          {/* ROOMS */}
          {tab === 'rooms' && (
            <>
              {activeStays.length > 0 && (
                <div>
                  <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
                    Active Stays ({activeStays.length})
                  </p>
                  <div className="space-y-3">
                    {activeStays.map((stay) => {
                      const d = new Date(stay.check_out_date),
                        t = new Date()
                      t.setHours(0, 0, 0, 0)
                      const daysLeft = Math.ceil((d - t) / 86400000)
                      const isOS = daysLeft < 0
                      const balance = Math.max(
                        0,
                        (stay.total_amount || 0) - (stay.amount_paid || 0)
                      )
                      return (
                        <div
                          key={stay.id}
                          className={`bg-gray-900 border rounded-2xl overflow-hidden ${isOS ? 'border-purple-500/40' : 'border-gray-800'}`}
                        >
                          {isOS && (
                            <div className="bg-purple-500/20 px-4 py-1.5 flex items-center gap-2">
                              <AlertTriangle size={12} className="text-purple-400" />
                              <p className="text-purple-400 text-xs font-semibold">
                                Overstay — {Math.abs(daysLeft)}d past checkout
                              </p>
                            </div>
                          )}
                          <div className="px-4 py-3">
                            <div className="flex items-start justify-between mb-2">
                              <div>
                                <p className="text-white font-bold">{stay.guest_name}</p>
                                <p className="text-gray-500 text-xs">
                                  Room {stay.rooms?.room_number}
                                </p>
                              </div>
                              <div className="text-right">
                                <BalanceBadge total={stay.total_amount} paid={stay.amount_paid} />
                                <p
                                  className={`text-xs mt-0.5 ${isOS ? 'text-purple-400' : daysLeft === 0 ? 'text-amber-400' : 'text-gray-500'}`}
                                >
                                  {isOS
                                    ? 'Overdue'
                                    : daysLeft === 0
                                      ? 'Due today'
                                      : `${daysLeft}d left`}
                                </p>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-xs mb-3">
                              <div className="bg-gray-800 rounded-xl px-2 py-2">
                                <p className="text-gray-500">Check-in</p>
                                <p className="text-white font-medium mt-0.5">
                                  {new Date(stay.check_in_date).toLocaleDateString('en-GB', {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </p>
                              </div>
                              <div className="bg-gray-800 rounded-xl px-2 py-2">
                                <p className="text-gray-500">Check-out</p>
                                <p className="text-white font-medium mt-0.5">
                                  {new Date(stay.check_out_date).toLocaleDateString('en-GB', {
                                    day: 'numeric',
                                    month: 'short',
                                  })}
                                </p>
                              </div>
                              <div className="bg-gray-800 rounded-xl px-2 py-2">
                                <p className="text-gray-500">Total</p>
                                <p className="text-amber-400 font-bold mt-0.5">
                                  {fmtShort(stay.total_amount)}
                                </p>
                              </div>
                            </div>
                            {stay.guest_phone && (
                              <p className="text-gray-500 text-xs flex items-center gap-1 mb-3">
                                <Phone size={10} />
                                {stay.guest_phone}
                              </p>
                            )}
                            <div className="flex gap-2">
                              {balance > 0 && (
                                <button
                                  onClick={() => setShowPayment(stay)}
                                  className="flex items-center gap-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-400 border border-green-500/20 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
                                >
                                  <Banknote size={13} />
                                  Collect {fmt(balance)}
                                </button>
                              )}
                              <button
                                onClick={() => setShowDetails(stay)}
                                className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl px-3 py-2 text-xs transition-colors"
                              >
                                <Eye size={13} />
                                Details
                              </button>
                              <button
                                onClick={() => setShowCheckOut(stay)}
                                className="flex-1 flex items-center justify-center gap-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-xl px-3 py-2 text-xs font-semibold transition-colors"
                              >
                                <ArrowRight size={13} />
                                Check Out
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              <div>
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-3">
                  All Rooms ({rooms.length})
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {rooms.map((room) => {
                    const sc = STATUS_CONFIG[room.status] || STATUS_CONFIG.available
                    const activeStay = activeStays.find((s) => s.room_id === room.id)
                    return (
                      <div key={room.id} className={`rounded-2xl border p-3 ${sc.bg} ${sc.border}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${sc.dot}`} />
                            <p className="text-white font-black text-base">#{room.room_number}</p>
                          </div>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full border capitalize ${sc.bg} ${sc.border} ${sc.text}`}
                          >
                            {room.status}
                          </span>
                        </div>
                        <p className="text-gray-400 text-xs capitalize mb-0.5">{room.room_type}</p>
                        <p className={`text-xs font-semibold mb-3 ${sc.text}`}>
                          {fmtShort(room.rate_per_night)}/night
                        </p>
                        {room.status === 'available' && (
                          <>
                            <button
                              onClick={() => setShowCheckIn(room)}
                              className="w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold rounded-xl py-2 transition-colors mb-1"
                            >
                              Check In
                            </button>
                            <button
                              onClick={() => updateRoomStatus(room.id, 'maintenance')}
                              className="w-full text-gray-600 hover:text-red-400 text-xs py-1 transition-colors"
                            >
                              Set Maintenance
                            </button>
                          </>
                        )}
                        {room.status === 'occupied' && activeStay && (
                          <div>
                            <p className="text-gray-300 text-xs font-medium truncate mb-2">
                              {activeStay.guest_name}
                            </p>
                            <button
                              onClick={() => setShowDetails(activeStay)}
                              className="w-full bg-gray-800/50 hover:bg-gray-700 text-gray-300 text-xs rounded-xl py-2 flex items-center justify-center gap-1 transition-colors"
                            >
                              <Eye size={11} />
                              View Stay
                            </button>
                          </div>
                        )}
                        {room.status === 'maintenance' && (
                          <button
                            onClick={() => updateRoomStatus(room.id, 'available')}
                            className="w-full bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs rounded-xl py-2 transition-colors"
                          >
                            Mark Available
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}

          {/* CALENDAR */}
          {tab === 'calendar' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <p className="text-white font-bold">14-Day Availability</p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const d = new Date(calStart)
                      d.setDate(d.getDate() - 7)
                      setCalStart(d)
                    }}
                    className="p-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-gray-400"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <button
                    onClick={() => setCalStart(new Date())}
                    className="text-xs bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-xl px-3 py-2"
                  >
                    Today
                  </button>
                  <button
                    onClick={() => {
                      const d = new Date(calStart)
                      d.setDate(d.getDate() + 7)
                      setCalStart(d)
                    }}
                    className="p-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-gray-400"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-4 mb-3 text-xs">
                {[
                  { dot: 'bg-green-400', label: 'Available' },
                  { dot: 'bg-amber-400', label: 'Occupied' },
                ].map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${l.dot}`} />
                    <span className="text-gray-400">{l.label}</span>
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[600px]">
                  <div
                    className="grid gap-px mb-1"
                    style={{ gridTemplateColumns: `80px repeat(${CAL_DAYS},1fr)` }}
                  >
                    <div />
                    {calDays.map((d) => {
                      const isToday = d.toDateString() === new Date().toDateString()
                      return (
                        <div
                          key={d.toISOString()}
                          className={`text-center py-1 rounded-lg text-xs ${isToday ? 'bg-amber-500 text-black font-bold' : 'text-gray-500'}`}
                        >
                          <p className="font-semibold">{d.getDate()}</p>
                          <p className="text-[9px]">
                            {d.toLocaleDateString('en', { weekday: 'short' })}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                  {rooms.map((room) => (
                    <div
                      key={room.id}
                      className="grid gap-px mb-1"
                      style={{ gridTemplateColumns: `80px repeat(${CAL_DAYS},1fr)` }}
                    >
                      <div className="flex items-center pr-2">
                        <p className="text-white text-xs font-bold">#{room.room_number}</p>
                        <p className="text-gray-600 text-[10px] ml-1 truncate">
                          {room.room_type?.slice(0, 3)}
                        </p>
                      </div>
                      {calDays.map((d) => {
                        const { type, stay } = getRoomCalStatus(room, d)
                        return (
                          <div
                            key={d.toISOString()}
                            title={stay ? stay.guest_name : 'Available'}
                            className={`h-8 rounded border ${type === 'occupied' ? 'bg-amber-500/30 border-amber-500/40' : 'bg-green-500/20 border-green-500/20'} cursor-default`}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ROOM SERVICE */}
          {tab === 'roomservice' && (
            <div className="space-y-3">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
                Room Service Orders
              </p>
              {serviceOrders.length === 0 ? (
                <div className="text-center py-16 text-gray-500">No room service orders yet</div>
              ) : (
                serviceOrders.map((order) => (
                  <div
                    key={order.id}
                    className="bg-gray-900 border border-gray-800 rounded-2xl p-4"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-white font-semibold">
                            Room {order.rooms?.room_number}
                          </p>
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${order.status === 'pending' ? 'bg-amber-500/20 text-amber-400' : order.status === 'delivered' ? 'bg-green-500/20 text-green-400' : 'bg-gray-700 text-gray-400'}`}
                          >
                            {order.status}
                          </span>
                        </div>
                        <p className="text-gray-500 text-xs">
                          {new Date(order.created_at).toLocaleString('en-GB')}
                        </p>
                        {order.notes && (
                          <p className="text-gray-400 text-xs mt-1 italic">"{order.notes}"</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-amber-400 font-bold">{fmt(order.total_amount)}</p>
                        {order.status === 'pending' && (
                          <button
                            onClick={async () => {
                              await supabase
                                .from('room_service_orders')
                                .update({ status: 'delivered' })
                                .eq('id', order.id)
                              fetchAll()
                            }}
                            className="mt-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 text-xs px-3 py-1.5 rounded-xl transition-colors"
                          >
                            Mark Delivered
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* REVENUE */}
          {tab === 'revenue' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: 'This Month',
                    value: fmtShort(monthRevenue),
                    sub: `${thisMonthStays.length} bookings`,
                    color: 'text-amber-400',
                  },
                  {
                    label: 'All Time',
                    value: fmtShort(allRevenue),
                    sub: `${stays.length} stays`,
                    color: 'text-white',
                  },
                  {
                    label: 'ADR',
                    value: fmtShort(adr),
                    sub: 'Avg daily rate',
                    color: 'text-blue-400',
                  },
                  {
                    label: 'RevPAR',
                    value: fmtShort(revpar),
                    sub: 'Rev/available room',
                    color: 'text-purple-400',
                  },
                  {
                    label: 'Outstanding',
                    value: fmtShort(totalOutstanding),
                    sub: 'Unpaid balances',
                    color: totalOutstanding > 0 ? 'text-red-400' : 'text-green-400',
                  },
                  {
                    label: 'Room Service',
                    value: fmtShort(serviceOrders.reduce((s, o) => s + (o.total_amount || 0), 0)),
                    sub: 'Total',
                    color: 'text-white',
                  },
                ].map((c) => (
                  <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <p className="text-gray-500 text-xs uppercase tracking-wide mb-1">{c.label}</p>
                    <p className={`text-xl font-black ${c.color}`}>{c.value}</p>
                    <p className="text-gray-600 text-xs mt-0.5">{c.sub}</p>
                  </div>
                ))}
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider mb-4">
                  Monthly Revenue (6 months)
                </p>
                <div className="flex items-end gap-2 h-28">
                  {monthlyRevenue.map(({ label, rev }) => (
                    <div key={label} className="flex-1 flex flex-col items-center gap-1">
                      <p className="text-amber-400 text-[9px] font-bold">
                        {rev > 0 ? fmtShort(rev).replace('₦', '') : ''}
                      </p>
                      <div
                        className="w-full bg-gray-800 rounded-t-lg relative"
                        style={{ height: 72 }}
                      >
                        <div
                          className="absolute bottom-0 w-full bg-amber-500 rounded-t-lg transition-all duration-500"
                          style={{ height: `${Math.round((rev / maxMonthRev) * 100)}%` }}
                        />
                      </div>
                      <p className="text-gray-500 text-[10px]">{label}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
                <p className="text-white font-semibold text-sm px-4 py-3 border-b border-gray-800">
                  Recent Stays
                </p>
                {stays.slice(0, 15).map((stay, i) => (
                  <div
                    key={stay.id}
                    className={`flex items-center justify-between px-4 py-3 ${i !== 0 ? 'border-t border-gray-800/60' : ''}`}
                  >
                    <div>
                      <p className="text-white text-sm font-medium">{stay.guest_name}</p>
                      <p className="text-gray-500 text-xs">
                        Room {stay.rooms?.room_number} · {fmtDate(stay.check_in_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-400 font-bold text-sm">
                        {fmtShort(stay.amount_paid)}
                      </p>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${stay.status === 'active' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}
                      >
                        {stay.status === 'active' ? 'Active' : 'Checked Out'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STAFF */}
          {tab === 'staff' && (
            <div className="space-y-3">
              <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
                Staff ({staff.length})
              </p>
              {staff.length === 0 ? (
                <div className="text-center py-16 text-gray-500 text-sm">
                  No staff records. Add via Back Office.
                </div>
              ) : (
                staff.map((s) => (
                  <div
                    key={s.id}
                    className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center gap-3"
                  >
                    <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center shrink-0">
                      <span className="text-amber-400 font-bold">
                        {s.full_name?.charAt(0) || '?'}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white font-semibold">{s.full_name}</p>
                      <p className="text-gray-500 text-xs capitalize">{s.role}</p>
                      {s.phone && (
                        <p className="text-gray-500 text-xs flex items-center gap-1 mt-0.5">
                          <Phone size={9} />
                          {s.phone}
                        </p>
                      )}
                    </div>
                    {s.hire_date && (
                      <p className="text-gray-600 text-xs shrink-0">
                        Since{' '}
                        {new Date(s.hire_date).toLocaleDateString('en-GB', {
                          month: 'short',
                          year: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* CHECK-IN MODAL */}
      {showCheckIn && (
        <div className="fixed inset-0 bg-black/80 z-50 overflow-y-auto flex items-start justify-center px-4 py-8">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
              <div>
                <h2 className="text-white font-bold">Check In — Room #{showCheckIn.room_number}</h2>
                <p className="text-gray-500 text-xs mt-0.5">
                  {showCheckIn.room_type} · {fmtShort(showCheckIn.rate_per_night)}/night
                </p>
              </div>
              <button
                onClick={() => setShowCheckIn(null)}
                className="text-gray-400 hover:text-white p-1"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              {[
                { label: 'Guest Name *', key: 'guest_name', type: 'text', ph: 'Full name' },
                { label: 'Phone', key: 'guest_phone', type: 'tel', ph: '080xxxxxxxx' },
                { label: 'Email', key: 'guest_email', type: 'email', ph: 'optional' },
                {
                  label: 'ID / Passport No.',
                  key: 'guest_id_number',
                  type: 'text',
                  ph: 'NIN / Passport / Drivers licence',
                },
              ].map((f) => (
                <div key={f.key}>
                  <label className="text-gray-400 text-xs block mb-1">{f.label}</label>
                  <input
                    type={f.type}
                    value={checkInForm[f.key]}
                    onChange={(e) => setCheckInForm((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.ph}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                  />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                {['check_in_date', 'check_out_date'].map((k) => (
                  <div key={k}>
                    <label className="text-gray-400 text-xs block mb-1">
                      {k === 'check_in_date' ? 'Check-in *' : 'Check-out *'}
                    </label>
                    <input
                      type="date"
                      value={checkInForm[k]}
                      onChange={(e) => setCheckInForm((p) => ({ ...p, [k]: e.target.value }))}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Adults', 'adults', 1],
                  ['Children', 'children', 0],
                ].map(([l, k, min]) => (
                  <div key={k}>
                    <label className="text-gray-400 text-xs block mb-1">{l}</label>
                    <input
                      type="number"
                      min={min}
                      value={checkInForm[k]}
                      onChange={(e) =>
                        setCheckInForm((p) => ({ ...p, [k]: parseInt(e.target.value) || min }))
                      }
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                    />
                  </div>
                ))}
              </div>
              {nights > 0 && (
                <div className="bg-gray-800 rounded-2xl p-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-gray-500 text-xs">Nights</p>
                    <p className="text-white font-bold">{nights}</p>
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Total Due</p>
                    <p className="text-amber-400 font-black">{fmtShort(totalDue)}</p>
                  </div>
                </div>
              )}
              <div>
                <label className="text-gray-400 text-xs block mb-1">Payment Method</label>
                <select
                  value={checkInForm.payment_method}
                  onChange={(e) =>
                    setCheckInForm((p) => ({ ...p, payment_method: e.target.value }))
                  }
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Amount Paid Now</label>
                <input
                  type="number"
                  value={checkInForm.amount_paid}
                  onChange={(e) => setCheckInForm((p) => ({ ...p, amount_paid: e.target.value }))}
                  placeholder={`Leave blank to default to ${fmtShort(totalDue)}`}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500"
                />
                {checkInForm.amount_paid && parseFloat(checkInForm.amount_paid) < totalDue && (
                  <p className="text-amber-400 text-xs mt-1">
                    {fmtShort(totalDue - parseFloat(checkInForm.amount_paid))} balance will be
                    outstanding
                  </p>
                )}
              </div>
              <textarea
                value={checkInForm.notes}
                onChange={(e) => setCheckInForm((p) => ({ ...p, notes: e.target.value }))}
                placeholder="Special requests…"
                rows={2}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-amber-500 resize-none"
              />
              <button
                onClick={handleCheckIn}
                disabled={saving || !checkInForm.guest_name || !checkInForm.check_out_date}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-black rounded-2xl py-3 flex items-center justify-center gap-2 transition-colors"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <CheckCircle size={16} />
                )}
                {saving ? 'Checking in…' : 'Confirm Check In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHECK-OUT MODAL */}
      {showCheckOut && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-white font-bold">Confirm Check Out</h2>
              <button
                onClick={() => setShowCheckOut(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="bg-gray-800 rounded-2xl p-4 space-y-2 text-sm">
                {[
                  ['Guest', showCheckOut.guest_name],
                  ['Room', `#${showCheckOut.rooms?.room_number}`],
                  ['Check-in', fmtDate(showCheckOut.check_in_date)],
                  ['Check-out', fmtDate(showCheckOut.check_out_date)],
                  ['Total Charged', fmt(showCheckOut.total_amount)],
                  ['Amount Paid', fmt(showCheckOut.amount_paid)],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between">
                    <p className="text-gray-400">{l}</p>
                    <p className="text-white font-medium">{v}</p>
                  </div>
                ))}
                {Math.max(0, (showCheckOut.total_amount || 0) - (showCheckOut.amount_paid || 0)) >
                  0 && (
                  <div className="flex justify-between border-t border-gray-700 pt-2">
                    <p className="text-red-400 font-bold">Balance Due</p>
                    <p className="text-red-400 font-black">
                      {fmt(
                        Math.max(
                          0,
                          (showCheckOut.total_amount || 0) - (showCheckOut.amount_paid || 0)
                        )
                      )}
                    </p>
                  </div>
                )}
              </div>
              {Math.max(0, (showCheckOut.total_amount || 0) - (showCheckOut.amount_paid || 0)) >
                0 && (
                <p className="text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                  ⚠ Outstanding balance detected. Collect payment before proceeding.
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setShowCheckOut(null)}
                  className="flex-1 bg-gray-800 text-gray-300 rounded-2xl py-3 text-sm font-medium"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmCheckOut}
                  disabled={saving}
                  className="flex-1 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white font-bold rounded-2xl py-3 text-sm flex items-center justify-center gap-2 transition-colors"
                >
                  {saving ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                  Check Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PAYMENT MODAL */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-white font-bold">Record Payment</h2>
              <button
                onClick={() => setShowPayment(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-800 rounded-2xl px-4 py-3 text-sm">
                <p className="text-gray-400">
                  Guest: <span className="text-white font-semibold">{showPayment.guest_name}</span>
                </p>
                <p className="text-gray-400 mt-1">
                  Balance:{' '}
                  <span className="text-red-400 font-black">
                    {fmt(
                      Math.max(0, (showPayment.total_amount || 0) - (showPayment.amount_paid || 0))
                    )}
                  </span>
                </p>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Amount Received</label>
                <input
                  type="number"
                  value={payForm.amount}
                  onChange={(e) => setPayForm((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="0.00"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Method</label>
                <select
                  value={payForm.method}
                  onChange={(e) => setPayForm((p) => ({ ...p, method: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Reference</label>
                <input
                  type="text"
                  value={payForm.reference}
                  onChange={(e) => setPayForm((p) => ({ ...p, reference: e.target.value }))}
                  placeholder="Transfer ref, etc."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-amber-500"
                />
              </div>
              <button
                onClick={recordPayment}
                disabled={saving || !payForm.amount}
                className="w-full bg-green-500 hover:bg-green-400 disabled:opacity-40 text-white font-black rounded-2xl py-3 flex items-center justify-center gap-2 transition-colors"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />}
                {saving ? 'Saving…' : 'Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAILS MODAL */}
      {showDetails && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center px-4">
          <div className="bg-gray-900 border border-gray-700 rounded-3xl w-full max-w-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="text-white font-bold">Stay Details</h2>
              <button
                onClick={() => setShowDetails(null)}
                className="text-gray-400 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="space-y-2 text-sm">
                {[
                  ['Guest', showDetails.guest_name],
                  ['Phone', showDetails.guest_phone || '—'],
                  ['Email', showDetails.guest_email || '—'],
                  ['ID No.', showDetails.guest_id_number || '—'],
                  ['Room', `#${showDetails.rooms?.room_number} (${showDetails.rooms?.room_type})`],
                  ['Adults/Children', `${showDetails.adults} / ${showDetails.children}`],
                  ['Check-in', fmtDate(showDetails.check_in_date)],
                  ['Check-out', fmtDate(showDetails.check_out_date)],
                  ['Payment', showDetails.payment_method?.replace(/_/g, ' ')],
                  ['Total Charged', fmt(showDetails.total_amount)],
                  ['Amount Paid', fmt(showDetails.amount_paid)],
                ].map(([l, v]) => (
                  <div key={l} className="flex justify-between">
                    <p className="text-gray-400">{l}</p>
                    <p className="text-white font-medium text-right max-w-[180px] truncate">{v}</p>
                  </div>
                ))}
                {Math.max(0, (showDetails.total_amount || 0) - (showDetails.amount_paid || 0)) >
                  0 && (
                  <div className="flex justify-between border-t border-gray-700 pt-2">
                    <p className="text-red-400 font-bold">Outstanding</p>
                    <p className="text-red-400 font-black">
                      {fmt(
                        Math.max(
                          0,
                          (showDetails.total_amount || 0) - (showDetails.amount_paid || 0)
                        )
                      )}
                    </p>
                  </div>
                )}
              </div>
              {showDetails.notes && (
                <div className="bg-gray-800 rounded-xl px-3 py-2">
                  <p className="text-gray-500 text-xs font-medium mb-1">Notes</p>
                  <p className="text-gray-300 text-xs">{showDetails.notes}</p>
                </div>
              )}
              <button
                onClick={() => setShowDetails(null)}
                className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-2xl py-3 text-sm font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
