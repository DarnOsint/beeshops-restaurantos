import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { BedDouble, Users, Clock, Wrench } from 'lucide-react'

import RoomBoardTab from './RoomBoardTab'
import ActiveStaysTab from './ActiveStaysTab'
import RoomSettingsTab from './RoomSettingsTab'
import RoomHistory from './RoomHistory'
import CheckInModal from './CheckInModal'
import CheckOutModal from './CheckOutModal'
import StayDetailModal from './StayDetailModal'
import RoomEditModal from './RoomEditModal'

import type { RoomRow, StayRow, CheckinForm, RoomEditForm, RoomStatus } from './types'
import { BLANK_CHECKIN } from './types'

const TABS = [
  { id: 'board', label: 'Room Board', icon: BedDouble },
  { id: 'stays', label: 'Active Stays', icon: Users },
  { id: 'history', label: 'History', icon: Clock },
  { id: 'settings', label: 'Room Settings', icon: Wrench },
] as const

export default function RoomManagement() {
  const { profile } = useAuth()

  const [rooms, setRooms] = useState<RoomRow[]>([])
  const [stays, setStays] = useState<StayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('board')
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [saving, setSaving] = useState(false)

  // Modal visibility
  const [showCheckin, setShowCheckin] = useState(false)
  const [showCheckout, setShowCheckout] = useState(false)
  const [showRoomEdit, setShowRoomEdit] = useState(false)
  const [showStayDetail, setShowStayDetail] = useState(false)

  // Selected items
  const [selectedRoom, setSelectedRoom] = useState<RoomRow | null>(null)
  const [selectedStay, setSelectedStay] = useState<StayRow | null>(null)

  // Forms
  const [checkinForm, setCheckinForm] = useState<CheckinForm>(BLANK_CHECKIN)
  const [roomEditForm, setRoomEditForm] = useState<RoomEditForm>({
    name: '',
    room_type: 'standard',
    floor: '1',
    capacity: '2',
    rate_per_night: '',
    amenities: '',
    notes: '',
  })

  // ── Data ──────────────────────────────────────────────────────────────────
  const fetchAll = useCallback(async () => {
    const [roomsRes, staysRes] = await Promise.all([
      supabase.from('rooms').select('*').order('name'),
      supabase
        .from('room_stays')
        .select('*')
        .eq('status', 'active')
        .order('check_in_at', { ascending: false }),
    ])
    if (roomsRes.data) setRooms(roomsRes.data as RoomRow[])
    if (staysRes.data) setStays(staysRes.data as StayRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll()
    const channel = supabase
      .channel('rooms-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_stays' }, fetchAll)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchAll])

  // Scroll to top on tab change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeTab])

  // Auto-check overstays
  const checkOverstays = useCallback(async () => {
    const now = new Date().toISOString()
    const overstays = stays.filter((s) => s.check_out_at < now && s.status === 'active')
    for (const stay of overstays) {
      await supabase.from('room_stays').update({ status: 'overstay' }).eq('id', stay.id)
    }
    if (overstays.length > 0) fetchAll()
  }, [stays, fetchAll])

  useEffect(() => {
    const interval = setInterval(checkOverstays, 60_000)
    return () => clearInterval(interval)
  }, [checkOverstays])

  // ── Actions ───────────────────────────────────────────────────────────────
  const openCheckin = (room: RoomRow) => {
    setSelectedRoom(room)
    setCheckinForm({ ...BLANK_CHECKIN, check_in_at: new Date().toISOString().slice(0, 16) })
    setShowCheckin(true)
  }

  const processCheckin = async () => {
    if (!checkinForm.guest_name) return alert('Guest name is required')
    if (!checkinForm.guest_phone) return alert('Guest phone is required')
    if (!checkinForm.id_number) return alert('ID number is required')
    if (!selectedRoom || !profile) return
    setSaving(true)

    const checkOutAt = new Date(checkinForm.check_in_at)
    checkOutAt.setDate(checkOutAt.getDate() + parseInt(checkinForm.nights))

    const { error } = await supabase.from('room_stays').insert({
      room_id: selectedRoom.id,
      room_name: selectedRoom.name,
      guest_name: checkinForm.guest_name,
      guest_phone: checkinForm.guest_phone,
      guest_email: checkinForm.guest_email || null,
      id_type: checkinForm.id_type,
      id_number: checkinForm.id_number,
      num_guests: parseInt(checkinForm.num_guests),
      check_in_at: new Date(checkinForm.check_in_at).toISOString(),
      check_out_at: checkOutAt.toISOString(),
      nights: parseInt(checkinForm.nights),
      rate_per_night: selectedRoom.rate_per_night,
      total_amount: (selectedRoom.rate_per_night || 0) * parseInt(checkinForm.nights),
      payment_method: checkinForm.payment_method,
      payment_reference: checkinForm.payment_reference || null,
      notes: checkinForm.notes || null,
      checked_in_by: profile.id,
      checked_in_by_name: profile.full_name,
      status: 'active',
    })

    if (error) {
      alert('Error: ' + error.message)
      setSaving(false)
      return
    }
    await supabase.from('rooms').update({ status: 'occupied' }).eq('id', selectedRoom.id)
    await fetchAll()
    setSaving(false)
    setShowCheckin(false)
  }

  const processCheckout = async () => {
    if (!selectedRoom || !selectedStay) return
    setSaving(true)
    await supabase
      .from('room_stays')
      .update({ status: 'checked_out', actual_checkout_at: new Date().toISOString() })
      .eq('id', selectedStay.id)
    await supabase.from('rooms').update({ status: 'cleaning' }).eq('id', selectedRoom.id)
    await fetchAll()
    setSaving(false)
    setShowCheckout(false)
  }

  const updateRoomStatus = async (room: RoomRow, status: RoomStatus) => {
    await supabase.from('rooms').update({ status }).eq('id', room.id)
    fetchAll()
  }

  const openRoomEdit = (room: RoomRow) => {
    setSelectedRoom(room)
    setRoomEditForm({
      name: room.name || '',
      room_type: room.room_type || 'standard',
      floor: room.floor?.toString() || '1',
      capacity: room.capacity?.toString() || '2',
      rate_per_night: room.rate_per_night?.toString() || '',
      amenities: room.amenities || '',
      notes: room.notes || '',
    })
    setShowRoomEdit(true)
  }

  const saveRoomEdit = async () => {
    if (!selectedRoom) return
    setSaving(true)
    await supabase
      .from('rooms')
      .update({
        name: roomEditForm.name,
        room_type: roomEditForm.room_type,
        floor: parseInt(roomEditForm.floor),
        capacity: parseInt(roomEditForm.capacity),
        rate_per_night: parseFloat(roomEditForm.rate_per_night) || 0,
        amenities: roomEditForm.amenities || null,
        notes: roomEditForm.notes || null,
      })
      .eq('id', selectedRoom.id)
    await fetchAll()
    setSaving(false)
    setShowRoomEdit(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const stats = {
    total: rooms.length,
    available: rooms.filter((r) => r.status === 'available').length,
    occupied: rooms.filter((r) => r.status === 'occupied').length,
    cleaning: rooms.filter((r) => r.status === 'cleaning').length,
    maintenance: rooms.filter((r) => r.status === 'maintenance').length,
  }
  const nightRevenue = stays.reduce((s, r) => s + (r.total_amount || 0), 0)

  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center text-amber-500">
        Loading rooms...
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950">
      {/* Tabs */}
      <div className="flex border-b border-gray-800 bg-gray-900 px-4 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === tab.id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
          >
            <tab.icon size={15} />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 md:p-6">
        {activeTab === 'board' && (
          <RoomBoardTab
            rooms={rooms}
            stays={stays}
            search={search}
            filterStatus={filterStatus}
            nightRevenue={nightRevenue}
            stats={stats}
            onSearchChange={setSearch}
            onFilterChange={setFilterStatus}
            onCheckin={openCheckin}
            onCheckout={(room, stay) => {
              setSelectedRoom(room)
              setSelectedStay(stay)
              setShowCheckout(true)
            }}
            onViewGuest={(stay) => {
              setSelectedStay(stay)
              setShowStayDetail(true)
            }}
            onEditRoom={openRoomEdit}
            onStatusChange={updateRoomStatus}
          />
        )}
        {activeTab === 'stays' && <ActiveStaysTab stays={stays} />}
        {activeTab === 'history' && <RoomHistory />}
        {activeTab === 'settings' && <RoomSettingsTab rooms={rooms} onEditRoom={openRoomEdit} />}
      </div>

      {/* Modals */}
      {showCheckin && selectedRoom && (
        <CheckInModal
          room={selectedRoom}
          form={checkinForm}
          saving={saving}
          onFormChange={setCheckinForm}
          onConfirm={processCheckin}
          onClose={() => setShowCheckin(false)}
        />
      )}
      {showCheckout && selectedRoom && selectedStay && (
        <CheckOutModal
          room={selectedRoom}
          stay={selectedStay}
          saving={saving}
          onConfirm={processCheckout}
          onClose={() => setShowCheckout(false)}
        />
      )}
      {showStayDetail && selectedStay && (
        <StayDetailModal stay={selectedStay} onClose={() => setShowStayDetail(false)} />
      )}
      {showRoomEdit && selectedRoom && (
        <RoomEditModal
          room={selectedRoom}
          form={roomEditForm}
          saving={saving}
          onFormChange={setRoomEditForm}
          onSave={saveRoomEdit}
          onClose={() => setShowRoomEdit(false)}
        />
      )}
    </div>
  )
}
