import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { AlertTriangle, UserPlus, Clock } from 'lucide-react'

export default function UnassignedCustomerOrders() {
  const [orders, setOrders]     = useState([])
  const [waitrons, setWaitrons] = useState([])
  const [assigning, setAssigning] = useState({})

  const fetchData = async () => {
    try {
      const today = new Date(); today.setHours(0,0,0,0)

      const { data: pending, error: pendingError } = await supabase
        .from('customer_orders')
        .select('*, tables(id, name, assigned_staff, table_categories(name))')
        .eq('status', 'pending')
        .gte('created_at', today.toISOString())
        .order('created_at', { ascending: true })

      if (pendingError) console.error('customer_orders error:', pendingError)
      const unassigned = (pending || []).filter(o => !o.tables?.assigned_staff)
      setOrders(unassigned)

      const { data: att, error: attError } = await supabase
        .from('attendance')
        .select('staff_id, profiles!attendance_staff_id_fkey(id, full_name, role)')
        .eq('date', new Date().toISOString().split('T')[0])
        .is('clock_out', null)

      if (attError) console.error('attendance error:', attError)
      const waitronList = (att || [])
        .filter(a => a.profiles?.role === 'waitron')
        .map(a => a.profiles)
      setWaitrons(waitronList)
    } catch (err) {
      console.error('UnassignedCustomerOrders fetch error:', err)
    }
  }

  useEffect(() => {
    fetchData()
    const channel = supabase.channel('unassigned-customer-orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'customer_orders' }, fetchData)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  const assignWaitron = async (order, waitronId) => {
    const waitron = waitrons.find(w => w.id === waitronId)
    if (!waitron) return
    setAssigning(prev => ({ ...prev, [order.id]: true }))
    await supabase.from('tables').update({ assigned_staff: waitronId }).eq('id', order.tables.id)
    await fetchData()
    setAssigning(prev => ({ ...prev, [order.id]: false }))
  }

  if (!orders.length) return null

  return (
    <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={15} className="text-red-400" />
        <span className="text-red-400 text-sm font-bold">
          {orders.length} unattended customer order{orders.length !== 1 ? 's' : ''} — no waitron assigned
        </span>
      </div>
      {orders.map(order => (
        <div key={order.id} className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-white font-bold text-sm">{order.table_name}</span>
            <span className="text-gray-500 text-xs flex items-center gap-1">
              <Clock size={10} />
              {Math.floor((Date.now() - new Date(order.created_at)) / 60000)}m ago
            </span>
          </div>
          <p className="text-gray-500 text-xs mb-2">
            {order.items?.length} item{order.items?.length !== 1 ? 's' : ''} · ₦{order.total_amount?.toLocaleString()}
          </p>
          <div className="flex items-center gap-2">
            <UserPlus size={13} className="text-gray-500 shrink-0" />
            <select
              onChange={e => e.target.value && assignWaitron(order, e.target.value)}
              disabled={assigning[order.id]}
              defaultValue=""
              className="flex-1 bg-gray-800 border border-gray-700 text-white rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-amber-500">
              <option value="">Assign waitron...</option>
              {waitrons.map(w => (
                <option key={w.id} value={w.id}>{w.full_name}</option>
              ))}
            </select>
          </div>
        </div>
      ))}
    </div>
  )
}
