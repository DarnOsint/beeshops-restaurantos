import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  LogOut,
  BedDouble,
  ShoppingBag,
  Users,
  TrendingUp,
  Calendar,
  AlertTriangle,
  Clock,
  RefreshCw,
  Loader2,
} from 'lucide-react'

import RoomsTab from './apt/RoomsTab'
import CalendarTab from './apt/CalendarTab'
import RoomServiceTab from './apt/RoomServiceTab'
import RevenueTab from './apt/RevenueTab'
import StaffTab from './apt/StaffTab'
import CheckInModal from './apt/CheckInModal'
import CheckOutModal from './apt/CheckOutModal'
import PaymentModal from './apt/PaymentModal'
import DetailsModal from './apt/DetailsModal'

import { fmtShort, todayStr } from './apt/types'
import type { Room, RoomStay, ServiceOrder, StaffMember, CheckInForm, PayForm } from './apt/types'

const TABS = [
  { id: 'rooms', label: 'Rooms', icon: BedDouble },
  { id: 'calendar', label: 'Calendar', icon: Calendar },
  { id: 'roomservice', label: 'Room Service', icon: ShoppingBag },
  { id: 'revenue', label: 'Revenue', icon: TrendingUp },
  { id: 'staff', label: 'Staff', icon: Users },
] as const

const DEFAULT_FORM: CheckInForm = {
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
}

export default function ApartmentDashboard() {
  const { profile, signOut } = useAuth()

  const [tab, setTab] = useState<string>('rooms')
  const [rooms, setRooms] = useState<Room[]>([])
  const [stays, setStays] = useState<RoomStay[]>([])
  const [serviceOrders, setServiceOrders] = useState<ServiceOrder[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)

  const [showCheckIn, setShowCheckIn] = useState<Room | null>(null)
  const [showCheckOut, setShowCheckOut] = useState<RoomStay | null>(null)
  const [showPayment, setShowPayment] = useState<RoomStay | null>(null)
  const [showDetails, setShowDetails] = useState<RoomStay | null>(null)
  const [saving, setSaving] = useState(false)

  const [checkInForm, setCheckInForm] = useState<CheckInForm>(DEFAULT_FORM)
  const [payForm, setPayForm] = useState<PayForm>({ amount: '', method: 'cash', reference: '' })

  const [calStart, setCalStart] = useState<Date>(() => {
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
    setRooms((roomsRes.data || []) as Room[])
    setStays((staysRes.data || []) as RoomStay[])
    setServiceOrders((serviceRes.data || []) as ServiceOrder[])
    setStaff(
      ((staffRes.data || []) as StaffMember[]).filter(
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
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchAll])

  // ── Derived ───────────────────────────────────────────────────────────────
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
  const totalOutstanding = activeStays.reduce(
    (s, st) => s + Math.max(0, (st.total_amount || 0) - (st.amount_paid || 0)),
    0
  )
  const pendingService = serviceOrders.filter((o) => o.status === 'pending').length

  // ── Actions ───────────────────────────────────────────────────────────────
  async function handleCheckIn() {
    if (!showCheckIn || !checkInForm.guest_name || !checkInForm.check_out_date) return
    setSaving(true)
    try {
      const nights = Math.max(
        0,
        Math.ceil(
          (new Date(checkInForm.check_out_date).getTime() -
            new Date(checkInForm.check_in_date).getTime()) /
            86400000
        )
      )
      const totalDue = nights * (showCheckIn.rate_per_night || 0)
      const { error: stayErr } = await supabase.from('room_stays').insert({
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
      if (stayErr) throw stayErr
      const { error: roomErr } = await supabase
        .from('rooms')
        .update({ status: 'occupied' })
        .eq('id', showCheckIn.id)
      if (roomErr) throw roomErr
      setShowCheckIn(null)
      setCheckInForm(DEFAULT_FORM)
      fetchAll()
    } catch (err) {
      alert('Check-in failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  async function confirmCheckOut() {
    if (!showCheckOut) return
    setSaving(true)
    try {
      const { error: stayErr } = await supabase
        .from('room_stays')
        .update({ status: 'checked_out', actual_check_out: new Date().toISOString() })
        .eq('id', showCheckOut.id)
      if (stayErr) throw stayErr
      const { error: roomErr } = await supabase
        .from('rooms')
        .update({ status: 'available' })
        .eq('id', showCheckOut.room_id)
      if (roomErr) throw roomErr
      setShowCheckOut(null)
      fetchAll()
    } catch (err) {
      alert('Check-out failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  async function recordPayment() {
    if (!showPayment || !payForm.amount) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('room_stays')
        .update({
          amount_paid: (showPayment.amount_paid || 0) + parseFloat(payForm.amount),
          updated_at: new Date().toISOString(),
        })
        .eq('id', showPayment.id)
      if (error) throw error
      setShowPayment(null)
      setPayForm({ amount: '', method: 'cash', reference: '' })
      fetchAll()
    } catch (err) {
      alert('Payment failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSaving(false)
    }
  }

  async function updateRoomStatus(roomId: string, status: Room['status']) {
    await supabase.from('rooms').update({ status }).eq('id', roomId)
    fetchAll()
  }

  const shiftCal = (days: number) => {
    const d = new Date(calStart)
    d.setDate(d.getDate() + days)
    setCalStart(d)
  }

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
          {tab === 'rooms' && (
            <RoomsTab
              rooms={rooms}
              activeStays={activeStays}
              onCheckIn={(room) => {
                setShowCheckIn(room)
                setCheckInForm(DEFAULT_FORM)
              }}
              onCheckOut={(stay) => setShowCheckOut(stay)}
              onPayment={(stay) => setShowPayment(stay)}
              onDetails={(stay) => setShowDetails(stay)}
              onSetMaintenance={(id) => updateRoomStatus(id, 'maintenance')}
              onSetAvailable={(id) => updateRoomStatus(id, 'available')}
            />
          )}
          {tab === 'calendar' && (
            <CalendarTab
              rooms={rooms}
              activeStays={activeStays}
              calStart={calStart}
              onPrev={() => shiftCal(-7)}
              onNext={() => shiftCal(7)}
              onToday={() => {
                const d = new Date()
                d.setHours(0, 0, 0, 0)
                setCalStart(d)
              }}
            />
          )}
          {tab === 'roomservice' && (
            <RoomServiceTab serviceOrders={serviceOrders} onRefresh={fetchAll} />
          )}
          {tab === 'revenue' && (
            <RevenueTab stays={stays} serviceOrders={serviceOrders} rooms={rooms} />
          )}
          {tab === 'staff' && <StaffTab staff={staff} />}
        </div>
      )}

      {/* Modals */}
      {showCheckIn && (
        <CheckInModal
          room={showCheckIn}
          form={checkInForm}
          saving={saving}
          onChange={setCheckInForm}
          onConfirm={handleCheckIn}
          onClose={() => setShowCheckIn(null)}
        />
      )}
      {showCheckOut && (
        <CheckOutModal
          stay={showCheckOut}
          saving={saving}
          onConfirm={confirmCheckOut}
          onClose={() => setShowCheckOut(null)}
        />
      )}
      {showPayment && (
        <PaymentModal
          stay={showPayment}
          form={payForm}
          saving={saving}
          onChange={setPayForm}
          onConfirm={recordPayment}
          onClose={() => setShowPayment(null)}
        />
      )}
      {showDetails && <DetailsModal stay={showDetails} onClose={() => setShowDetails(null)} />}
    </div>
  )
}
