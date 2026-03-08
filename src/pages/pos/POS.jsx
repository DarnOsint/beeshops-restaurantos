import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { LogOut, Beer, RefreshCw } from 'lucide-react'
import TableGrid from './TableGrid'
import OrderPanel from './OrderPanel'

export default function POS() {
  const { profile, signOut } = useAuth()
  const [tables, setTables] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTables()
    fetchMenu()

    // Real-time updates
    const channel = supabase
      .channel('tables-channel')
      .on('postgres_changes', 
        { event: '*', schema: 'public', table: 'tables' },
        () => fetchTables()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const fetchTables = async () => {
    const { data, error } = await supabase
      .from('tables')
      .select('*, table_categories(name)')
      .order('name')

    if (!error) setTables(data)
    setLoading(false)
  }

  const fetchMenu = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*, menu_categories(name)')
      .eq('is_available', true)
      .order('name')

    if (!error) setMenuItems(data)
  }

  const handlePlaceOrder = async ({ table, items, notes, total }) => {
    // Create order
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        table_id: table.id,
        staff_id: profile.id,
        order_type: 'table',
        status: 'open',
        total_amount: total,
        notes
      })
      .select()
      .single()

    if (orderError) {
      alert('Error creating order')
      return
    }

    // Create order items
    const orderItems = items.map(item => ({
      order_id: order.id,
      menu_item_id: item.id,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: item.total,
      status: 'pending'
    }))

    await supabase.from('order_items').insert(orderItems)

    // Update table status
    await supabase
      .from('tables')
      .update({ status: 'occupied' })
      .eq('id', table.id)

    setSelectedTable(null)
    fetchTables()
    alert('Order sent to kitchen!')
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* Header */}
      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center">
            <Beer size={18} className="text-black" />
          </div>
          <div>
            <h1 className="text-white font-bold text-sm">Beeshops Place</h1>
            <p className="text-gray-400 text-xs">Point of Sale</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={fetchTables} className="text-gray-400 hover:text-white">
            <RefreshCw size={16} />
          </button>
          <div className="text-right">
            <p className="text-white text-sm">{profile?.full_name}</p>
            <p className="text-amber-500 text-xs capitalize">{profile?.role}</p>
          </div>
          <button onClick={signOut} className="text-gray-400 hover:text-white">
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">

        {/* Table Grid */}
        <div className={`${selectedTable ? 'hidden md:flex' : 'flex'} flex-1 flex-col overflow-hidden`}>
          <TableGrid
            tables={tables}
            onSelectTable={setSelectedTable}
            selectedTable={selectedTable}
          />
        </div>

        {/* Order Panel */}
        {selectedTable && (
          <div className="w-full md:w-96 border-l border-gray-800 flex flex-col overflow-hidden">
            <OrderPanel
              table={selectedTable}
              menuItems={menuItems}
              onPlaceOrder={handlePlaceOrder}
              onClose={() => setSelectedTable(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}