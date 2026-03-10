import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  Beer, LogOut, ArrowLeft, BedDouble, Plus, X, Save,
  Search, User, Phone, Mail, CreditCard, Banknote,
  Smartphone, Clock, CheckCircle, AlertTriangle,
  Wrench, Sparkles, ChevronRight, Calendar, Hash,
  Users, DollarSign, FileText, RefreshCw, Eye
} from 'lucide-react'

const ID_TYPES = ['NIN', 'Passport', 'Drivers License', 'Voters Card', 'Staff ID', 'Other']
const ROOM_TYPES = ['standard', 'deluxe', 'suite', 'vip']
const ROOM_STATUSES = ['available', 'occupied', 'cleaning', 'maintenance']

const statusConfig = {
  available: { label: 'Available', color: 'bg-green-500/20 text-green-400 border-green-500/30', dot: 'bg-green-400' },
  occupied: { label: 'Occupied', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30', dot: 'bg-amber-400' },
  cleaning: { label: 'Cleaning', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30', dot: 'bg-blue-400' },
  maintenance: { label: 'Maintenance', color: 'bg-red-500/20 text-red-400 border-red-500/30', dot: 'bg-red-400' },
}

export default function RoomManagement() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [rooms, setRooms] = useState([])
  const [stays, setStays] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('board') // board | stays | settings
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')

  // Modals
  const [showCheckin, setShowCheckin] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showRoomEdit, setShowRoomEdit] = useState(false)
  const [showStayDetail, setShowStayDetail] = useState(false)
  const [selectedRoom, setSelectedRoom] = useState(null)
  const [selectedStay, setSelectedStay] = useState(null)
  const [saving, setSaving] = useState(false)

  const [checkinForm, setCheckinForm] = useState({
    guest_name: '', guest_phone: '', guest_email: '',
    id_type: 'NIN', id_number: '',
    num_guests: '1',
    check_in_at: new Date().toISOString().slice(0, 16),
    nights: '1',
    payment_method: 'cash',
    payment_reference: '',
    notes: ''
  })

  const [roomEditForm, setRoomEditForm] = useState({
    name: '', room_type: 'standard', floor: '1',
    capacity: '2', rate_per_night: '', amenities: '', notes: ''
  })

  useEffect(() => {
    fetchAll()
    const channel = supabase
      .channel('rooms-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  // Auto-check overstays every minute
  useEffect(() => {
    const interval = setInterval(checkOverstays, 60000)
    return () => clearInterval(interval)
  }, [stays])

  const fetchAll = async () => {
    const [roomsRes, staysRes] = await Promise.all([
      supabase.from('rooms').select('*').order('name'),
      supabase.from('room_stays').select('*').eq('status', 'active').order('check_in_at', { ascending: false })
    ])
    if (roomsRes.data) setRooms(roomsRes.data)
    if (staysRes.data) setStays(staysRes.data)
    setLoading(false)
  }

  const checkOverstays = async () => {
    const now = new Date().toISOString()
    const overstays = stays.filter(s => s.check_out_at < now && s.status === 'active')
    for (const stay of overstays) {
      await supabase.from('room_stays').update({ status: 'overstay' }).eq('id', stay.id)
    }
    if (overstays.length > 0) fetchAll()
  }

  const getStayForRoom = (roomId) => stays.find(s => s.room_id === roomId)

  const checkoutTime = () => {
    const d = new Date(checkinForm.check_in_at)
    d.setDate(d.getDate() + parseInt(checkinForm.nights || 1))
    return d.toISOString().slice(0, 16)
  }

  const totalAmount = () => {
    if (!selectedRoom) return 0
    return (selectedRoom.rate_per_night || 0) * parseInt(checkinForm.nights || 1)
  }

  const openCheckin = (room) => {
    setSelectedRoom(room)
    setCheckinForm({
      guest_name: '', guest_phone: '', guest_email: '',
      id_type: 'NIN', id_number: '',
      num_guests: '1',
      check_in_at: new Date().toISOString().slice(0, 16),
      nights: '1',
      payment_method: 'cash',
      payment_reference: '',
      notes: ''
    })
    setShowCheckin(true)
  }

  const processCheckin = async () => {
    if (!checkinForm.guest_name) return alert('Guest name is required')
    if (!checkinForm.guest_phone) return alert('Guest phone is required')
    if (!checkinForm.id_number) return alert('ID number is required')
    setSaving(true)

    const checkOutAt = new Date(checkinForm.check_in_at)
    checkOutAt.setDate(checkOutAt.getDate() + parseInt(checkinForm.nights))

    const { error: stayError } = await supabase.from('room_stays').insert({
      room_id: selectedRoom.id,
      room_name: selectedRoom.name,
      guest_name: checkinForm.guest_name,
      guest_phone: checkinForm.guest_phone,
      guest_email: checkinForm.guest_email,
      id_type: checkinForm.id_type,
      id_number: checkinForm.id_number,
      num_guests: parseInt(checkinForm.num_guests),
      check_in_at: new Date(checkinForm.check_in_at).toISOString(),
      check_out_at: checkOutAt.toISOString(),
      nights: parseInt(checkinForm.nights),
      rate_per_night: selectedRoom.rate_per_night,
      total_amount: totalAmount(),
      payment_method: checkinForm.payment_method,
      payment_reference: checkinForm.payment_reference,
      notes: checkinForm.notes,
      checked_in_by: profile.id,
      checked_in_by_name: profile.full_name,
      status: 'active'
    })

    if (stayError) { alert('Error: ' + stayError.message); setSaving(false); return }

    await supabase.from('rooms').update({ status: 'occupied' }).eq('id', selectedRoom.id)
    await fetchAll()
    setSaving(false)
    setShowCheckin(false)
  }

  const processCheckout = async (room) => {
    const stay = getStayForRoom(room.id)
    if (!stay) return
    setSaving(true)

    await supabase.from('room_stays').update({
      status: 'checked_out',
      actual_checkout_at: new Date().toISOString()
    }).eq('id', stay.id)

    await supabase.from('rooms').update({ status: 'cleaning' }).eq('id', room.id)
    await fetchAll()
    setSaving(false)
    setShowCheckout(false)
  }

  const updateRoomStatus = async (room, status) => {
    await supabase.from('rooms').update({ status }).eq('id', room.id)
    fetchAll()
  }

  const openRoomEdit = (room) => {
    setSelectedRoom(room)
    setRoomEditForm({
      name: room.name || '',
      room_type: room.room_type || 'standard',
      floor: room.floor?.toString() || '1',
      capacity: room.capacity?.toString() || '2',
      rate_per_night: room.rate_per_night?.toString() || '',
      amenities: room.amenities || '',
      notes: room.notes || ''
    })
    setShowRoomEdit(true)
  }

  const saveRoomEdit = async () => {
    setSaving(true)
    await supabase.from('rooms').update({
      name: roomEditForm.name,
      room_type: roomEditForm.room_type,
      floor: parseInt(roomEditForm.floor),
      capacity: parseInt(roomEditForm.capacity),
      rate_per_night: parseFloat(roomEditForm.rate_per_night) || 0,
      amenities: roomEditForm.amenities,
      notes: roomEditForm.notes
    }).eq('id', selectedRoom.id)
    await fetchAll()
    setSaving(false)
    setShowRoomEdit(false)
  }

  const filteredRooms = rooms.filter(r => {
    const matchSearch = r.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = filterStatus === 'all' || r.status === filterStatus
    return matchSearch && matchStatus
  })

  const stats = {
    total: rooms.length,
    available: rooms.filter(r => r.status === 'available').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    cleaning: rooms.filter(r => r.status === 'cleaning').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length,
    overstay: stays.filter(s => s.status === 'overstay').length,
  }

  const nightRevenue = stays.reduce((sum, s) => sum + (s.total_amount || 0), 0)

  const tabs = [
    { id: 'board', label: 'Room Board', icon: BedDouble },
    { id: 'stays', label: 'Active Stays', icon: Users },
    { id: 'history', label: 'History', icon: Clock },
    { id: 'settings', label: 'Room Settings', icon: Wrench },
  ]

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Header */}
      

      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <tab.icon size={15} />{tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-6">

        {/* ROOM BOARD */}
        {activeTab === 'board' && (
          <div className="space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {[
                { label: 'Total', value: stats.total, color: 'text-white' },
                { label: 'Available', value: stats.available, color: 'text-green-400' },
                { label: 'Occupied', value: stats.occupied, color: 'text-amber-400' },
                { label: 'Cleaning', value: stats.cleaning, color: 'text-blue-400' },
                { label: 'Maintenance', value: stats.maintenance, color: 'text-red-400' },
                { label: 'Revenue Active', value: `₦${(nightRevenue/1000).toFixed(0)}k`, color: 'text-purple-400' },
              ].map((s, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-3 text-center">
                  <p className="text-gray-500 text-xs">{s.label}</p>
                  <p className={`font-bold text-xl ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-40">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search rooms..."
                  className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2 focus:outline-none focus:border-amber-500 text-sm" />
              </div>
              <div className="flex gap-2">
                {['all', ...ROOM_STATUSES].map(s => (
                  <button key={s} onClick={() => setFilterStatus(s)}
                    className={`px-3 py-2 rounded-xl text-xs font-medium capitalize transition-colors ${filterStatus === s ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Room Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {filteredRooms.map(room => {
                const stay = getStayForRoom(room.id)
                const cfg = statusConfig[room.status] || statusConfig.available
                const isOverstay = stay && new Date(stay.check_out_at) < new Date()
                const hoursLeft = stay ? Math.round((new Date(stay.check_out_at) - new Date()) / (1000 * 60 * 60)) : null

                return (
                  <div key={room.id} className={`bg-gray-900 border rounded-xl p-4 transition-all ${isOverstay ? 'border-red-500/50' : 'border-gray-800'}`}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <p className="text-white font-bold">{room.name}</p>
                        <p className="text-gray-500 text-xs capitalize">{room.room_type || 'standard'}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-lg border ${cfg.color} capitalize`}>
                        <span className={`inline-block w-1.5 h-1.5 rounded-full ${cfg.dot} mr-1`} />
                        {isOverstay ? '⚠️ Overstay' : cfg.label}
                      </span>
                    </div>

                    <p className="text-amber-400 text-sm font-bold mb-1">₦{room.rate_per_night?.toLocaleString()}/night</p>

                    {stay && (
                      <div className="mb-3 text-xs space-y-1">
                        <p className="text-white font-medium truncate">{stay.guest_name}</p>
                        <p className="text-gray-500">{stay.num_guests} guest{stay.num_guests > 1 ? 's' : ''}</p>
                        {hoursLeft !== null && (
                          <p className={`font-medium ${hoursLeft < 2 ? 'text-red-400' : hoursLeft < 6 ? 'text-amber-400' : 'text-gray-400'}`}>
                            {hoursLeft > 0 ? `${hoursLeft}h remaining` : `${Math.abs(hoursLeft)}h overdue`}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      {room.status === 'available' && (
                        <button onClick={() => openCheckin(room)}
                          className="w-full bg-green-600 hover:bg-green-500 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                          Check In
                        </button>
                      )}
                      {room.status === 'occupied' && (
                        <>
                          <button onClick={() => { setSelectedRoom(room); setSelectedStay(stay); setShowCheckout(true) }}
                            className="w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold py-2 rounded-lg transition-colors">
                            Check Out
                          </button>
                          <button onClick={() => { setSelectedStay(stay); setShowStayDetail(true) }}
                            className="w-full bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs py-1.5 rounded-lg transition-colors flex items-center justify-center gap-1">
                            <Eye size={11} /> View Guest
                          </button>
                        </>
                      )}
                      {room.status === 'cleaning' && (
                        <button onClick={() => updateRoomStatus(room, 'available')}
                          className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                          ✅ Mark Clean
                        </button>
                      )}
                      {room.status === 'maintenance' && (
                        <button onClick={() => updateRoomStatus(room, 'available')}
                          className="w-full bg-gray-700 hover:bg-gray-600 text-white text-xs font-bold py-2 rounded-lg transition-colors">
                          Mark Available
                        </button>
                      )}
                      <div className="flex gap-1">
                        <button onClick={() => openRoomEdit(room)}
                          className="flex-1 text-gray-500 hover:text-white text-xs py-1 transition-colors">
                          Edit
                        </button>
                        {room.status !== 'maintenance' && room.status !== 'occupied' && (
                          <button onClick={() => updateRoomStatus(room, 'maintenance')}
                            className="flex-1 text-red-500 hover:text-red-400 text-xs py-1 transition-colors">
                            Maintenance
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ACTIVE STAYS */}
        {activeTab === 'stays' && (
          <div className="space-y-3">
            {stays.length === 0 ? (
              <div className="text-center py-12 text-gray-500">No active stays right now</div>
            ) : stays.map(stay => {
              const hoursLeft = Math.round((new Date(stay.check_out_at) - new Date()) / (1000 * 60 * 60))
              const isOverstay = hoursLeft < 0
              return (
                <div key={stay.id} className={`bg-gray-900 border rounded-xl p-5 ${isOverstay ? 'border-red-500/30' : 'border-gray-800'}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-white font-bold text-lg">{stay.room_name}</p>
                        {isOverstay && <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded-lg">⚠️ Overstay</span>}
                      </div>
                      <p className="text-amber-400 font-semibold">{stay.guest_name}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-white font-bold text-xl">₦{stay.total_amount?.toLocaleString()}</p>
                      <p className="text-gray-500 text-xs capitalize">{stay.payment_method}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
                    {[
                      { label: 'Phone', value: stay.guest_phone },
                      { label: 'Guests', value: `${stay.num_guests} person${stay.num_guests > 1 ? 's' : ''}` },
                      { label: 'Check-in', value: new Date(stay.check_in_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
                      { label: 'Check-out Due', value: new Date(stay.check_out_at).toLocaleString('en-NG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
                      { label: 'Nights', value: stay.nights },
                      { label: 'Rate/Night', value: `₦${stay.rate_per_night?.toLocaleString()}` },
                      { label: 'ID Type', value: stay.id_type },
                      { label: 'ID Number', value: stay.id_number },
                    ].map(f => (
                      <div key={f.label} className="bg-gray-800 rounded-lg px-3 py-2">
                        <p className="text-gray-500">{f.label}</p>
                        <p className="text-white font-medium">{f.value || '—'}</p>
                      </div>
                    ))}
                  </div>
                  <div className={`text-sm font-medium ${isOverstay ? 'text-red-400' : hoursLeft < 6 ? 'text-amber-400' : 'text-green-400'}`}>
                    {isOverstay ? `⚠️ ${Math.abs(hoursLeft)} hours overdue` : `✅ ${hoursLeft} hours remaining`}
                  </div>
                  {stay.notes && <p className="text-gray-500 text-xs mt-2">📝 {stay.notes}</p>}
                </div>
              )
            })}
          </div>
        )}

        {/* HISTORY */}
        {activeTab === 'history' && <RoomHistory />}

        {/* ROOM SETTINGS */}
        {activeTab === 'settings' && (
          <div className="space-y-3 max-w-3xl">
            <p className="text-gray-400 text-sm mb-4">Click a room to edit its rate, type and details.</p>
            {rooms.map(room => (
              <div key={room.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-white font-semibold">{room.name}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-gray-400 text-xs capitalize">{room.room_type || 'standard'}</span>
                    <span className="text-gray-600 text-xs">Floor {room.floor || 1}</span>
                    <span className="text-gray-600 text-xs">{room.capacity || 2} guests max</span>
                  </div>
                  {room.amenities && <p className="text-gray-600 text-xs mt-1">{room.amenities}</p>}
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-amber-400 font-bold">₦{room.rate_per_night?.toLocaleString() || 0}</p>
                    <p className="text-gray-600 text-xs">per night</p>
                  </div>
                  <button onClick={() => openRoomEdit(room)} className="text-gray-400 hover:text-white p-2">
                    <Wrench size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Check-in Modal */}
      {showCheckin && selectedRoom && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-800 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
              <div>
                <h3 className="text-white font-bold">Check In — {selectedRoom.name}</h3>
                <p className="text-amber-400 text-sm">₦{selectedRoom.rate_per_night?.toLocaleString()}/night</p>
              </div>
              <button onClick={() => setShowCheckin(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">

              {/* Guest Info */}
              <p className="text-gray-400 text-xs uppercase tracking-wide font-medium">Guest Information</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-gray-500 text-xs block mb-1">Full Name *</label>
                  <div className="relative">
                    <User size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input value={checkinForm.guest_name} onChange={e => setCheckinForm({...checkinForm, guest_name: e.target.value})}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                      placeholder="Guest full name" />
                  </div>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Phone *</label>
                  <div className="relative">
                    <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input value={checkinForm.guest_phone} onChange={e => setCheckinForm({...checkinForm, guest_phone: e.target.value})}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                      placeholder="08012345678" />
                  </div>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Email</label>
                  <div className="relative">
                    <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input value={checkinForm.guest_email} onChange={e => setCheckinForm({...checkinForm, guest_email: e.target.value})}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                      placeholder="guest@email.com" />
                  </div>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">ID Type *</label>
                  <select value={checkinForm.id_type} onChange={e => setCheckinForm({...checkinForm, id_type: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm">
                    {ID_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">ID Number *</label>
                  <div className="relative">
                    <Hash size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input value={checkinForm.id_number} onChange={e => setCheckinForm({...checkinForm, id_number: e.target.value})}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                      placeholder="ID number" />
                  </div>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Number of Guests</label>
                  <div className="relative">
                    <Users size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input type="number" min="1" value={checkinForm.num_guests} onChange={e => setCheckinForm({...checkinForm, num_guests: e.target.value})}
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                  </div>
                </div>
              </div>

              {/* Stay Duration */}
              <p className="text-gray-400 text-xs uppercase tracking-wide font-medium pt-2">Stay Duration</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Check-in Date & Time</label>
                  <input type="datetime-local" value={checkinForm.check_in_at} onChange={e => setCheckinForm({...checkinForm, check_in_at: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Number of Nights</label>
                  <input type="number" min="1" value={checkinForm.nights} onChange={e => setCheckinForm({...checkinForm, nights: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
              </div>

              {/* Checkout preview */}
              <div className="bg-gray-800 rounded-xl p-3 flex items-center justify-between text-sm">
                <span className="text-gray-400">Expected Check-out</span>
                <span className="text-white font-medium">{new Date(checkoutTime()).toLocaleString('en-NG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>

              {/* Payment */}
              <p className="text-gray-400 text-xs uppercase tracking-wide font-medium pt-2">Payment</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'cash', label: 'Cash', icon: Banknote },
                  { id: 'card', label: 'Bank POS', icon: CreditCard },
                  { id: 'transfer', label: 'Transfer', icon: Smartphone },
                ].map(m => (
                  <button key={m.id} onClick={() => setCheckinForm({...checkinForm, payment_method: m.id})}
                    className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border-2 text-xs font-medium transition-all ${checkinForm.payment_method === m.id ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-gray-700 bg-gray-800 text-gray-500'}`}>
                    <m.icon size={16} />{m.label}
                  </button>
                ))}
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Payment Reference / Receipt No.</label>
                <input value={checkinForm.payment_reference} onChange={e => setCheckinForm({...checkinForm, payment_reference: e.target.value})}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="Transaction ref, POS receipt no, etc." />
              </div>

              {/* Total */}
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-gray-400 text-xs">{checkinForm.nights} night{checkinForm.nights > 1 ? 's' : ''} × ₦{selectedRoom.rate_per_night?.toLocaleString()}</p>
                  <p className="text-white font-bold text-2xl mt-0.5">₦{totalAmount().toLocaleString()}</p>
                </div>
                <CheckCircle size={28} className="text-amber-500" />
              </div>

              {/* Notes */}
              <div>
                <label className="text-gray-500 text-xs block mb-1">Notes</label>
                <textarea value={checkinForm.notes} onChange={e => setCheckinForm({...checkinForm, notes: e.target.value})}
                  rows={2} placeholder="Special requests, observations..."
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none" />
              </div>

              <button onClick={processCheckin} disabled={saving}
                className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors">
                <CheckCircle size={16} /> {saving ? 'Processing...' : `Confirm Check-in — ₦${totalAmount().toLocaleString()}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Confirmation Modal */}
      {showCheckout && selectedRoom && selectedStay && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Check Out — {selectedRoom.name}</h3>
              <button onClick={() => setShowCheckout(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-gray-800 rounded-xl p-4 space-y-2 text-sm">
                {[
                  ['Guest', selectedStay.guest_name],
                  ['Phone', selectedStay.guest_phone],
                  ['Checked In', new Date(selectedStay.check_in_at).toLocaleString('en-NG')],
                  ['Due Out', new Date(selectedStay.check_out_at).toLocaleString('en-NG')],
                  ['Nights', selectedStay.nights],
                  ['Total Paid', `₦${selectedStay.total_amount?.toLocaleString()}`],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between">
                    <span className="text-gray-500">{label}</span>
                    <span className="text-white font-medium">{value}</span>
                  </div>
                ))}
              </div>

              <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-300">
                Room will move to <span className="font-bold">Cleaning</span> status after checkout. Mark it clean when ready.
              </div>

              <button onClick={() => processCheckout(selectedRoom)} disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 transition-colors">
                {saving ? 'Processing...' : 'Confirm Check Out'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stay Detail Modal */}
      {showStayDetail && selectedStay && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-sm border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Guest Details</h3>
              <button onClick={() => setShowStayDetail(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              {[
                ['Room', selectedStay.room_name],
                ['Guest', selectedStay.guest_name],
                ['Phone', selectedStay.guest_phone],
                ['Email', selectedStay.guest_email || '—'],
                ['ID Type', selectedStay.id_type],
                ['ID Number', selectedStay.id_number],
                ['Guests', selectedStay.num_guests],
                ['Check-in', new Date(selectedStay.check_in_at).toLocaleString('en-NG')],
                ['Check-out', new Date(selectedStay.check_out_at).toLocaleString('en-NG')],
                ['Nights', selectedStay.nights],
                ['Rate/Night', `₦${selectedStay.rate_per_night?.toLocaleString()}`],
                ['Total Paid', `₦${selectedStay.total_amount?.toLocaleString()}`],
                ['Payment', selectedStay.payment_method],
                ['Reference', selectedStay.payment_reference || '—'],
                ['Checked in by', selectedStay.checked_in_by_name],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-1 border-b border-gray-800 last:border-0">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-white font-medium text-right">{value}</span>
                </div>
              ))}
              {selectedStay.notes && (
                <div className="bg-gray-800 rounded-xl p-3 text-xs text-gray-400">📝 {selectedStay.notes}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Room Edit Modal */}
      {showRoomEdit && selectedRoom && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-md border border-gray-800">
            <div className="flex items-center justify-between p-5 border-b border-gray-800">
              <h3 className="text-white font-bold">Edit Room — {selectedRoom.name}</h3>
              <button onClick={() => setShowRoomEdit(false)} className="text-gray-400 hover:text-white"><X size={20} /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Room Name</label>
                  <input value={roomEditForm.name} onChange={e => setRoomEditForm({...roomEditForm, name: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Room Type</label>
                  <select value={roomEditForm.room_type} onChange={e => setRoomEditForm({...roomEditForm, room_type: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm capitalize">
                    {ROOM_TYPES.map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Floor</label>
                  <input type="number" value={roomEditForm.floor} onChange={e => setRoomEditForm({...roomEditForm, floor: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
                <div>
                  <label className="text-gray-500 text-xs block mb-1">Max Guests</label>
                  <input type="number" value={roomEditForm.capacity} onChange={e => setRoomEditForm({...roomEditForm, capacity: e.target.value})}
                    className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Rate Per Night (₦)</label>
                <input type="number" value={roomEditForm.rate_per_night} onChange={e => setRoomEditForm({...roomEditForm, rate_per_night: e.target.value})}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-lg font-bold"
                  placeholder="0" />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Amenities</label>
                <input value={roomEditForm.amenities} onChange={e => setRoomEditForm({...roomEditForm, amenities: e.target.value})}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                  placeholder="AC, TV, WiFi, Hot Water..." />
              </div>
              <div>
                <label className="text-gray-500 text-xs block mb-1">Notes</label>
                <textarea value={roomEditForm.notes} onChange={e => setRoomEditForm({...roomEditForm, notes: e.target.value})}
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none" />
              </div>
              <button onClick={saveRoomEdit} disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors">
                <Save size={16} /> {saving ? 'Saving...' : 'Save Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function RoomHistory() {
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('room_stays')
      .select('*')
      .in('status', ['checked_out', 'overstay'])
      .order('actual_checkout_at', { ascending: false })
      .limit(50)
      .then(({ data }) => { setHistory(data || []); setLoading(false) })
  }, [])

  if (loading) return <div className="text-amber-500 text-center py-12">Loading...</div>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-gray-400 text-sm">{history.length} past stays</p>
        <p className="text-gray-500 text-xs">Total: ₦{history.reduce((s, h) => s + (h.total_amount || 0), 0).toLocaleString()}</p>
      </div>
      {history.length === 0 ? (
        <div className="text-center py-12 text-gray-500">No checkout history yet</div>
      ) : history.map(stay => (
        <div key={stay.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold">{stay.guest_name}</p>
            <p className="text-gray-500 text-xs">{stay.room_name} · {stay.nights} night{stay.nights > 1 ? 's' : ''} · {stay.id_type}: {stay.id_number}</p>
            <p className="text-gray-600 text-xs mt-0.5">
              {new Date(stay.check_in_at).toLocaleDateString('en-NG')} → {new Date(stay.check_out_at).toLocaleDateString('en-NG')}
            </p>
          </div>
          <div className="text-right">
            <p className="text-amber-400 font-bold">₦{stay.total_amount?.toLocaleString()}</p>
            <span className={`text-xs px-2 py-0.5 rounded-lg ${stay.status === 'overstay' ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}`}>
              {stay.status === 'overstay' ? 'Overstay' : 'Checked Out'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}