import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { audit } from '../../lib/audit'
import { useAuth } from '../../context/AuthContext'
import { LogOut, Beer, RefreshCw, ShoppingBag, Phone } from 'lucide-react'
import TableGrid from './TableGrid'
import OrderPanel from './OrderPanel'
import PaymentModal from './PaymentModal'
import CashSaleModal from './CashSaleModal'
import WaiterCalls from '../management/WaiterCalls'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'

export default function POS() {
  const { profile, signOut } = useAuth()
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence("main")
  const [tables, setTables] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [zonePrices, setZonePrices] = useState([])
  const [selectedTable, setSelectedTable] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState(null)
  const [assignedTableIds, setAssignedTableIds] = useState(null) // null = no restriction
  const [showPayment, setShowPayment] = useState(false)
  const [showCashSale, setShowCashSale] = useState(false)
  const [cashSaleType, setCashSaleType] = useState('cash_sale')

  useEffect(() => {
    fetchTables()
    fetchMenu()
    fetchZonePrices()
    fetchAssignedTables(profile?.role, profile?.id)

    const channel = supabase
      .channel('tables-channel')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        () => fetchTables()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  const fetchAssignedTables = async (role, staffId) => {
    // Owners and managers can access all tables
    if (['owner', 'manager', 'accountant'].includes(role)) {
      setAssignedTableIds(null)
      return
    }
    // Fetch zones assigned to this waitron
    const { data: zoneData } = await supabase
      .from('zone_assignments')
      .select('category_id')
      .eq('staff_id', staffId)
      .eq('is_active', true)
    if (!zoneData || zoneData.length === 0) {
      setAssignedTableIds(null) // no assignment yet — show all tables
      return
    }
    // Get all tables in those zones
    const categoryIds = zoneData.map(z => z.category_id)
    const { data: tableData } = await supabase
      .from('tables')
      .select('id')
      .in('category_id', categoryIds)
    if (tableData) setAssignedTableIds(tableData.map(t => t.id))
    else setAssignedTableIds([])
  }

  const fetchTables = async () => {
    const { data, error } = await supabase
      .from('tables')
      .select('*, table_categories(id, name)')
      .order('name')
    if (!error) setTables(data)
    setLoading(false)
  }

  const fetchMenu = async () => {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*, menu_categories(name, destination)')
      .eq('is_available', true)
      .order('name')
    if (!error) setMenuItems(data)
  }

  const fetchZonePrices = async () => {
    const { data, error } = await supabase
      .from('menu_item_zone_prices')
      .select('*')
    if (!error) setZonePrices(data)
  }

  const getMenuItemsWithZonePrices = (table) => {
    if (!table) return menuItems
    const categoryId = table.table_categories?.id
    return menuItems.map(item => {
      const zonePrice = zonePrices.find(
        zp => zp.menu_item_id === item.id && zp.category_id === categoryId
      )
      return {
        ...item,
        price: zonePrice ? zonePrice.price : item.price,
        hasZonePrice: !!zonePrice
      }
    })
  }

  const handleSelectTable = async (table) => {
    if (table.status === 'occupied') {
      const { data } = await supabase
        .from('orders')
        .select('*, order_items(*, menu_items(name))')
        .eq('table_id', table.id)
        .eq('status', 'open')
        .limit(1)

      if (data && data.length > 0) {
        setActiveOrder(data[0])
        setSelectedTable(table)
        setShowPayment(true)
        return
      }
    }
    setActiveOrder(null)
    setShowPayment(false)
    setSelectedTable(table)
  }

  const depleteInventory = async (items) => {
    for (const item of items) {
      if (!item.id) continue
      const { data: inv } = await supabase
        .from('inventory')
        .select('id, current_stock')
        .eq('menu_item_id', item.id)
        .maybeSingle()
      if (!inv) continue
      const newStock = Math.max(0, inv.current_stock - item.quantity)
      await supabase
        .from('inventory')
        .update({ current_stock: newStock, updated_at: new Date().toISOString() })
        .eq('id', inv.id)
      await supabase.from('restock_log').insert({
        inventory_id: inv.id,
        change_amount: -item.quantity,
        reason: 'sold',
        notes: 'Auto-deducted on order: ' + (item.name || item.id)
      })
    }
  }

  const handlePlaceOrder = async ({ table, items, notes, total }) => {
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
      console.error('Order error:', orderError)
      alert('Error creating order: ' + orderError.message)
      return
    }

    const orderItems = items.map(item => ({
      order_id: order.id,
      menu_item_id: item.id,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: item.total,
      status: 'pending',
      destination: item.menu_categories?.destination || 'bar',
      modifier_notes: item.modifier_notes || null,
      extra_charge: item.extra_charge || 0
    }))

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems)
    if (itemsError) {
      console.error('Order items error:', itemsError)
      alert('Error adding items: ' + itemsError.message)
      return
    }

    await depleteInventory(items)
    await audit({
      action: 'ORDER_CREATED',
      entity: 'order',
      entityId: order.id,
      entityName: 'Table ' + table.name,
      newValue: { total, items: items.length, table: table.name },
      performer: profile
    })
    await supabase.from('tables').update({ status: 'occupied' }).eq('id', table.id)
    await fetchTables()
    setSelectedTable(null)
  }

  const openCashSale = (type) => {
    setCashSaleType(type)
    setShowCashSale(true)
  }

  if (geoStatus !== "inside") return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* Waiter call alerts — only shows calls for this waitron's tables */}
      <WaiterCalls />

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

        <div className="flex items-center gap-2">
          <button
            onClick={() => openCashSale('cash_sale')}
            className="flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors"
          >
            <ShoppingBag size={14} />
            Cash Sale
          </button>
          <button
            onClick={() => openCashSale('takeaway')}
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors"
          >
            <Phone size={14} />
            Takeaway
          </button>

          <button onClick={fetchTables} className="text-gray-400 hover:text-white ml-1">
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

      <div className="flex-1 flex overflow-hidden">
        <div className={`${selectedTable && !showPayment ? 'hidden md:flex' : 'flex'} flex-1 flex-col overflow-hidden`}>
          <TableGrid
            tables={tables}
            onSelectTable={handleSelectTable}
            selectedTable={selectedTable}
            assignedTableIds={assignedTableIds}
          />
        </div>

        {selectedTable && !showPayment && (
          <div className="w-full md:w-96 border-l border-gray-800 flex flex-col overflow-hidden">
            <OrderPanel
              table={selectedTable}
              menuItems={getMenuItemsWithZonePrices(selectedTable)}
              onPlaceOrder={handlePlaceOrder}
              onClose={() => {
                setSelectedTable(null)
                setActiveOrder(null)
              }}
            />
          </div>
        )}
      </div>

      {showPayment && activeOrder && selectedTable && (
        <PaymentModal
          order={activeOrder}
          table={selectedTable}
          onSuccess={() => {
            setShowPayment(false)
            setActiveOrder(null)
            setSelectedTable(null)
            fetchTables()
          }}
          onClose={() => {
            setShowPayment(false)
            setActiveOrder(null)
            setSelectedTable(null)
          }}
        />
      )}

      {showCashSale && (
        <CashSaleModal
          type={cashSaleType}
          menuItems={menuItems}
          staffId={profile.id}
          assignedTableIds={assignedTableIds}
          onSuccess={() => setShowCashSale(false)}
          onClose={() => setShowCashSale(false)}
        />
      )}
    </div>
  )
}