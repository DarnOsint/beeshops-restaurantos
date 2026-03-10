import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { offlineInsert, offlineUpdate } from '../../lib/offlineWrite'
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
  const [isClockedIn, setIsClockedIn] = useState(null) // null = checking
  const [showPayment, setShowPayment] = useState(false)
  const [showCashSale, setShowCashSale] = useState(false)
  const [cashSaleType, setCashSaleType] = useState('cash_sale')

  useEffect(() => {
    fetchTables()
    fetchMenu()
    fetchZonePrices()

    const channel = supabase
      .channel('tables-channel')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        () => fetchTables()
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  useEffect(() => {
    if (!profile) return
    fetchAssignedTables(profile.role, profile.id)
  }, [profile?.id])

  const fetchAssignedTables = async (role, staffId) => {
    // Owners and managers — no restrictions
    if (['owner', 'manager', 'accountant'].includes(role)) {
      setAssignedTableIds(null)
      setIsClockedIn(true)
      return
    }
    // Check if waitron is clocked in today
    const today = new Date().toISOString().split('T')[0]
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('staff_id', staffId)
      .eq('date', today)
      .is('clock_out', null)
      .limit(1)
    setIsClockedIn(attendance && attendance.length > 0)
    // Fetch zones assigned to this waitron
    const { data: zoneData } = await supabase
      .from('zone_assignments')
      .select('category_id')
      .eq('staff_id', staffId)
      .eq('is_active', true)
    if (!zoneData || zoneData.length === 0) {
      setAssignedTableIds([]) // no zones assigned — block all tables
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
    const [menuRes, invRes] = await Promise.all([
      supabase.from('menu_items').select('*, menu_categories(name, destination)').eq('is_available', true).order('name'),
      supabase.from('inventory').select('menu_item_id, current_stock').eq('is_active', true)
    ])
    if (!menuRes.error) {
      const invMap = {}
      if (invRes.data) invRes.data.forEach(i => { invMap[i.menu_item_id] = i.current_stock })
      setMenuItems(menuRes.data.map(item => ({ ...item, current_stock: invMap[item.id] ?? null })))
    }
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
        setShowPayment(false) // open order panel — waiter can add items or proceed to pay
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
// restock_log is for supplier restocks only — sales deductions tracked via inventory.current_stock
    }
  }

  const handlePlaceOrder = async ({ table, items, notes, total }) => {
    let order

    if (activeOrder) {
      // --- ADD TO EXISTING ORDER ---
      const newTotal = (activeOrder.total_amount || 0) + total
      await offlineUpdate('orders', activeOrder.id, {
        total_amount: newTotal,
        notes: notes || activeOrder.notes,
        updated_at: new Date().toISOString()
      })
      const newItems = items.map(item => ({
        id: crypto.randomUUID(),
        order_id: activeOrder.id,
        menu_item_id: item.id,
        quantity: item.quantity,
        unit_price: item.price,
        total_price: item.total,
        status: 'pending',
        destination: item.menu_categories?.destination || 'bar',
        modifier_notes: item.modifier_notes || null,
        extra_charge: item.extra_charge || 0,
        created_at: new Date().toISOString()
      }))
      let itemsError = null
      for (const item of newItems) {
        const { error } = await offlineInsert('order_items', item)
        if (error) { itemsError = error; break }
      }
      if (itemsError) {
        alert('Error adding items: ' + itemsError.message)
        return
      }
      await depleteInventory(items)
      await audit({
        action: 'ORDER_UPDATED',
        entity: 'order',
        entityId: activeOrder.id,
        entityName: 'Table ' + table.name,
        newValue: { addedItems: items.length, newTotal },
        performer: profile
      })
      // Reload the updated order then show payment
      const { data: refreshed } = await supabase
        .from('orders')
        .select('*, order_items(*, menu_items(name))')
        .eq('id', activeOrder.id)
        .single()
      setActiveOrder(refreshed)
      setShowPayment(true)
      return
    }

    // --- CREATE NEW ORDER ---
    const orderId = crypto.randomUUID()
    const { data: newOrder, error: orderError } = await offlineInsert('orders', {
      id: orderId,
      table_id: table.id,
      staff_id: profile.id,
      order_type: 'table',
      status: 'open',
      total_amount: total,
      notes,
      created_at: new Date().toISOString()
    })

    if (orderError) {
      console.error('Order error:', orderError)
      alert('Error creating order: ' + orderError.message)
      return
    }

    order = newOrder

    const orderItems = items.map(item => ({
      id: crypto.randomUUID(),
      order_id: order.id,
      menu_item_id: item.id,
      quantity: item.quantity,
      unit_price: item.price,
      total_price: item.total,
      status: 'pending',
      destination: item.menu_categories?.destination || 'bar',
      modifier_notes: item.modifier_notes || null,
      extra_charge: item.extra_charge || 0,
      created_at: new Date().toISOString()
    }))

    let itemsError = null
    for (const item of orderItems) {
      const { error } = await offlineInsert('order_items', item)
      if (error) { itemsError = error; break }
    }
    if (itemsError) {
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
    await offlineUpdate('tables', table.id, { status: 'occupied' })
    await fetchTables()
    setSelectedTable(null)
  }

  const openCashSale = (type) => {
    setCashSaleType(type)
    setShowCashSale(true)
  }

  if (geoStatus !== "inside") return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />

  if (isClockedIn === false) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
          <LogOut size={28} className="text-red-400" />
        </div>
        <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center mx-auto mb-4">
          <span className="text-black font-bold text-lg">B</span>
        </div>
        <h2 className="text-lg font-bold text-red-400 mb-2">You are not clocked in</h2>
        <p className="text-gray-400 text-sm mb-2">Please ask your manager to clock you in before you can access the POS.</p>
        <button onClick={signOut}
          className="mt-6 flex items-center gap-2 mx-auto bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors">
          <LogOut size={14} /> Sign Out
        </button>
      </div>
    </div>
  )

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">

      {/* Waiter call alerts — only shows calls for this waitron's tables */}
      <WaiterCalls />

      <nav className="bg-gray-900 border-b border-gray-800 px-4 py-3 sticky top-0 z-40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
              <Beer size={15} className="text-black" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-white font-bold text-sm">Beeshops Place</h1>
              <p className="text-gray-400 text-xs">Point of Sale</p>
            </div>
            <span className="sm:hidden text-white font-bold text-sm">POS</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => openCashSale('cash_sale')}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-2.5 py-2 rounded-xl transition-colors"
            >
              <ShoppingBag size={13} />
              <span className="hidden sm:inline">Cash Sale</span>
            </button>
            <button
              onClick={() => openCashSale('takeaway')}
              className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold px-2.5 py-2 rounded-xl transition-colors"
            >
              <Phone size={13} />
              <span className="hidden sm:inline">Takeaway</span>
            </button>
            <button onClick={fetchTables} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white">
              <RefreshCw size={15} />
            </button>
            <div className="hidden sm:block text-right">
              <p className="text-white text-xs">{profile?.full_name}</p>
              <p className="text-amber-500 text-xs capitalize">{profile?.role}</p>
            </div>
            <button onClick={signOut} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white">
              <LogOut size={16} />
            </button>
          </div>
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
              activeOrder={activeOrder}
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