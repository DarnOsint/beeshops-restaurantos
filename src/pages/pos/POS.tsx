import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { setPrintServerUrl } from '../../lib/networkPrinter'
import { HelpTooltip } from '../../components/HelpTooltip'
import { audit } from '../../lib/audit'
import { useAuth } from '../../context/AuthContext'
import { usePushNotifications } from '../../hooks/usePushNotifications'
import {
  LogOut,
  Beer,
  RefreshCw,
  ShoppingBag,
  Phone,
  History,
  Printer,
  TrendingUp,
  Clock,
} from 'lucide-react'
import TableGrid from './TableGrid'
import CoversModal from './CoversModal'
import OrderPanel from './OrderPanel'
import ReceiptModal from './ReceiptModal'
import PaymentModal from './PaymentModal'
import CashSaleModal from './CashSaleModal'
import CustomerOrderAlerts from '../../components/CustomerOrderAlerts'
import WaiterCalls from '../management/WaiterCalls'
import { useGeofence } from '../../hooks/useGeofence'
import GeofenceBlock from '../../components/GeofenceBlock'
import type { Table, MenuItem, Order, OrderItem, Profile } from '../../types'
import { useToast } from '../../context/ToastContext'

interface ZonePrice {
  menu_item_id: string
  category_id: string
  price: number
}
interface MenuItemWithZone extends MenuItem {
  hasZonePrice?: boolean
  current_stock?: number | null
}

interface ShiftOrder {
  id: string
  total_amount?: number
  closed_at: string
  tables?: { name: string } | null
  order_items: { quantity: number; menu_items?: { name: string } | null }[]
}
interface ShiftStats {
  clockIn?: string
  ordersCount: number
  totalSales: number
  totalItems: number
  uniqueTables: number
  recentOrders: ShiftOrder[]
}

interface HistoryOrder {
  id: string
  total_amount: number
  payment_method?: string | null
  status: string
  order_type: string
  created_at: string
  closed_at?: string | null
  customer_name?: string | null
  staff_id?: string | null
  table_id?: string | null
  notes?: string | null
  tables?: { name: string } | null
  order_items?: (OrderItem & { menu_items?: { name: string } | null })[]
}

interface OrderPayload {
  table: Table
  items: {
    id: string
    name: string
    price: number
    quantity: number
    total: number
    menu_categories?: { name?: string; destination?: string } | null
    modifier_notes?: string
    extra_charge?: number
  }[]
  notes: string
  total: number
}

export default function POS() {
  const { profile, signOut } = useAuth()
  const toast = useToast()
  usePushNotifications(profile?.id)
  const { status: geoStatus, distance: geoDist, location: geoLocation } = useGeofence('main')

  const [tables, setTables] = useState<Table[]>([])
  const [menuItems, setMenuItems] = useState<MenuItemWithZone[]>([])
  const [zonePrices, setZonePrices] = useState<ZonePrice[]>([])
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const [pendingTable, setPendingTable] = useState<Table | null>(null)
  const [pendingCovers, setPendingCovers] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeOrder, setActiveOrder] = useState<
    | (Order & {
        order_items?: (OrderItem & {
          menu_items?: {
            name: string
            price: number
            menu_categories?: { name?: string; destination?: string } | null
          } | null
        })[]
      })
    | null
  >(null)
  const [assignedTableIds, setAssignedTableIds] = useState<string[] | null>(null)
  const [defaultZone, setDefaultZone] = useState<string>('All')
  const [posTab, setPosTab] = useState<'tables' | 'history' | 'shift'>('tables')
  const [orderHistory, setOrderHistory] = useState<HistoryOrder[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [reprintOrder, setReprintOrder] = useState<HistoryOrder | null>(null)
  const [shiftStats, setShiftStats] = useState<ShiftStats | null>(null)
  const [shiftLoading, setShiftLoading] = useState(false)
  const [isClockedIn, setIsClockedIn] = useState<boolean | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [showCashSale, setShowCashSale] = useState(false)
  const [cashSaleType, setCashSaleType] = useState<'cash' | 'takeaway'>('cash')

  // Load print server URL from settings on mount
  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'print_server_url')
      .single()
      .then(({ data }) => {
        if (data?.value) setPrintServerUrl(data.value)
      })
  }, [])

  useEffect(() => {
    fetchTables()
    fetchMenu()
    fetchZonePrices()
    const channel = supabase
      .channel('tables-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tables' }, () => {
        fetchTables()
        // Don't re-check clock-in on table updates — causes mid-session logout flicker
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!profile) return
    fetchAssignedTables(profile.role, profile.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const fetchAssignedTables = async (role: string, staffId: string) => {
    if (['owner', 'manager', 'accountant'].includes(role)) {
      setAssignedTableIds(null)
      setIsClockedIn(true)
      return
    }

    // Use WAT (UTC+1) date to match Lagos timezone
    const today = new Date(Date.now() + 60 * 60 * 1000).toISOString().split('T')[0]
    const { data: attendance } = await supabase
      .from('attendance')
      .select('id')
      .eq('staff_id', staffId)
      .eq('date', today)
      .is('clock_out', null)
      .limit(1)
    // Only update if we haven't already confirmed clocked-in — prevents mid-session flicker
    const clockedIn = attendance !== null && attendance.length > 0
    setIsClockedIn((prev) => {
      // Once clocked in, don't flip to false due to a network hiccup
      if (prev === true && !clockedIn) return true
      return clockedIn
    })

    const { data: zoneData } = await supabase
      .from('zone_assignments')
      .select('category_id')
      .eq('staff_id', staffId)
      .eq('is_active', true)

    const { data: directTables } = await supabase
      .from('tables')
      .select('id')
      .eq('assigned_staff', staffId)
    const directIds = (directTables || []).map((t: { id: string }) => t.id)

    if ((!zoneData || zoneData.length === 0) && directIds.length === 0) {
      setAssignedTableIds(null)
      return
    }

    if (!zoneData || zoneData.length === 0) {
      setAssignedTableIds(directIds)
      return
    }

    const categoryIds = zoneData.map((z: { category_id: string }) => z.category_id)
    const { data: zoneTableData } = await supabase
      .from('tables')
      .select('id, category_id')
      .in('category_id', categoryIds)

    const zoneIds = (zoneTableData || []).map((t: { id: string }) => t.id)
    const combined = [...new Set([...zoneIds, ...directIds])]
    setAssignedTableIds(combined.length > 0 ? combined : null)

    // Auto-open the waitron's zone tab
    const firstCatId = categoryIds[0]
    const matchingZone = tables.find((t) => t.category_id === firstCatId)
    if (matchingZone?.table_categories?.name) {
      setDefaultZone(matchingZone.table_categories.name)
    }
  }

  const activeOrderRef = useRef<typeof activeOrder>(null)
  useEffect(() => {
    activeOrderRef.current = activeOrder
  }, [activeOrder])

  const fullRefresh = () => {
    fetchTables()
    if (profile) fetchAssignedTables(profile.role, profile.id)
    const current = activeOrderRef.current
    if (current) {
      supabase
        .from('orders')
        .select('*, order_items(*, menu_items(name, price, menu_categories(name, destination)))')
        .eq('id', current.id)
        .single()
        .then(({ data }) => {
          if (data) setActiveOrder(data)
        })
    }
  }

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fullRefresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchShiftStats = async () => {
    setShiftLoading(true)
    // Use WAT (UTC+1) date to match Lagos timezone
    const today = new Date(Date.now() + 60 * 60 * 1000).toISOString().split('T')[0]
    const [attendanceRes, ordersRes] = await Promise.all([
      supabase
        .from('attendance')
        .select('clock_in, date')
        .eq('staff_id', profile?.id)
        .eq('date', today)
        .is('clock_out', null)
        .limit(1),
      supabase
        .from('orders')
        .select(
          'id, total_amount, closed_at, tables(name), order_items(quantity, menu_items(name))'
        )
        .eq('staff_id', profile?.id)
        .eq('status', 'paid')
        .gte('closed_at', new Date(today).toISOString()),
    ])
    const attendance = attendanceRes.data?.[0] as { clock_in: string } | undefined
    const orders = (ordersRes.data || []) as unknown as ShiftOrder[]
    const totalSales = orders.reduce((s, o) => s + (o.total_amount || 0), 0)
    const totalItems = orders.reduce(
      (s, o) => s + o.order_items.reduce((ss, i) => ss + (i.quantity || 0), 0),
      0
    )
    const uniqueTables = new Set(orders.map((o) => o.tables?.name).filter(Boolean)).size
    setShiftStats({
      clockIn: attendance?.clock_in,
      ordersCount: orders.length,
      totalSales,
      totalItems,
      uniqueTables,
      recentOrders: orders.slice(0, 5),
    })
    setShiftLoading(false)
  }

  const fetchHistory = async () => {
    setHistoryLoading(true)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { data } = await supabase
      .from('orders')
      .select('*, tables(name), order_items(*, menu_items(name))')
      .eq('status', 'paid')
      .eq('staff_id', profile?.id)
      .gte('closed_at', today.toISOString())
      .order('closed_at', { ascending: false })
    setOrderHistory((data || []) as HistoryOrder[])
    setHistoryLoading(false)
  }

  const fetchTables = async () => {
    const { data, error } = await supabase
      .from('tables')
      .select('*, table_categories(id, name, hire_fee)')
      .order('name')
    if (!error) setTables(data || [])
    setLoading(false)
  }

  const fetchMenu = async () => {
    const [menuRes, invRes] = await Promise.all([
      supabase
        .from('menu_items')
        .select('*, menu_categories(name, destination)')
        .eq('is_available', true)
        .order('name'),
      supabase.from('inventory').select('menu_item_id, current_stock').eq('is_active', true),
    ])
    if (!menuRes.error) {
      const invMap: Record<string, number> = {}
      if (invRes.data)
        invRes.data.forEach((i: { menu_item_id: string; current_stock: number }) => {
          invMap[i.menu_item_id] = i.current_stock
        })
      setMenuItems(
        (menuRes.data || []).map((item: MenuItem) => ({
          ...item,
          current_stock: invMap[item.id] ?? null,
        }))
      )
    }
  }

  const fetchZonePrices = async () => {
    const { data, error } = await supabase.from('menu_item_zone_prices').select('*')
    if (!error) setZonePrices(data || [])
  }

  const getMenuItemsWithZonePrices = (table: Table | null): MenuItemWithZone[] => {
    if (!table) return menuItems
    const categoryId = (table as unknown as { table_categories?: { id: string } }).table_categories
      ?.id
    return menuItems.map((item) => {
      const zonePrice = zonePrices.find(
        (zp) => zp.menu_item_id === item.id && zp.category_id === categoryId
      )
      return { ...item, price: zonePrice ? zonePrice.price : item.price, hasZonePrice: !!zonePrice }
    })
  }

  const handleSelectTable = async (table: Table) => {
    // Always check DB for open orders — don't trust table.status alone
    // (table may be 'available' but have an orphaned open order, or vice versa)
    const { data: openOrders } = await supabase
      .from('orders')
      .select('*, order_items(*, menu_items(name))')
      .eq('table_id', table.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
    if (openOrders && openOrders.length > 0) {
      // Heal table status if it was wrong
      if (table.status !== 'occupied') {
        void supabase.from('tables').update({ status: 'occupied' }).eq('id', table.id)
      }
      setActiveOrder(openOrders[0])
      setSelectedTable(table)
      setShowPayment(false)
      return
    }
    // No open order — new table, ask for covers
    setActiveOrder(null)
    setShowPayment(false)
    setPendingTable(table)
  }

  const handleCoversConfirmed = (covers: number) => {
    if (!pendingTable) return
    setPendingCovers(covers)
    setSelectedTable(pendingTable)
    setPendingTable(null)
  }

  const handleCoversCancel = () => {
    setPendingTable(null)
  }

  const placingOrderRef = useRef(false)
  const handlePlaceOrder = async ({ table, items, notes, total }: OrderPayload) => {
    if (placingOrderRef.current) return
    placingOrderRef.current = true
    try {
      if (activeOrder) {
        const newTotal = (activeOrder.total_amount || 0) + total
        await supabase
          .from('orders')
          .update({
            total_amount: newTotal,
            notes: notes || activeOrder.notes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', activeOrder.id)
        const newItems = items.map((item) => ({
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
          created_at: new Date().toISOString(),
        }))
        for (const item of newItems) {
          const { error } = await supabase.from('order_items').insert(item)
          if (error) {
            toast.error('Error', 'Error adding items: ' + error.message)
            return
          }
        }
        await audit({
          action: 'ORDER_UPDATED',
          entity: 'order',
          entityId: activeOrder.id,
          entityName: 'Table ' + table.name,
          newValue: { addedItems: items.length, newTotal },
          performer: profile as Profile,
        })
        const { data: refreshed } = await supabase
          .from('orders')
          .select('*, order_items(*, menu_items(name))')
          .eq('id', activeOrder.id)
          .single()
        if (refreshed) setActiveOrder(refreshed)
        setShowPayment(true)
        return
      }

      // Last-chance DB check — prevent duplicate open orders on same table
      const { data: existingOpen } = await supabase
        .from('orders')
        .select('*, order_items(*, menu_items(name))')
        .eq('table_id', table.id)
        .eq('status', 'open')
        .limit(1)
      if (existingOpen && existingOpen.length > 0) {
        setActiveOrder(existingOpen[0])
        setShowPayment(true)
        return
      }

      const orderId = crypto.randomUUID()
      // Use direct Supabase call — offlineInsert's .single() can fail silently
      // leaving the order in the sync queue instead of the DB
      const hireFeeAmt =
        (table as unknown as { table_categories?: { hire_fee?: number | null } }).table_categories
          ?.hire_fee || 0
      const { error: orderError } = await supabase.from('orders').insert({
        id: orderId,
        table_id: table.id,
        staff_id: profile!.id,
        order_type: 'table',
        status: 'open',
        total_amount: total + hireFeeAmt,
        notes,
        covers: pendingCovers,
        created_at: new Date().toISOString(),
      })
      setPendingCovers(null)
      if (orderError) {
        console.error('Order error:', orderError)
        toast.error('Error', 'Error creating order: ' + orderError.message)
        return
      }
      const newOrder = { id: orderId } as Order

      // Auto-add hire fee as first line item if this zone charges one
      const hireFee = (table as unknown as { table_categories?: { hire_fee?: number | null } })
        .table_categories?.hire_fee
      const baseItems =
        hireFee && hireFee > 0
          ? [
              {
                id: crypto.randomUUID(),
                order_id: orderId,
                menu_item_id: null,
                quantity: 1,
                unit_price: hireFee,
                total_price: hireFee,
                status: 'delivered', // hire fee is charged immediately, not a kitchen item
                destination: 'bar',
                modifier_notes: `Zone hire fee — ${table.table_categories?.name || 'The Nook'}`,
                extra_charge: 0,
                created_at: new Date().toISOString(),
                is_hire_fee: true,
              },
            ]
          : []

      const orderItemRows = [
        ...baseItems,
        ...items.map((item) => ({
          id: crypto.randomUUID(),
          order_id: (newOrder as Order).id,
          menu_item_id: item.id,
          quantity: item.quantity,
          unit_price: item.price,
          total_price: item.total,
          status: 'pending',
          destination: item.menu_categories?.destination || 'bar',
          modifier_notes: item.modifier_notes || null,
          extra_charge: item.extra_charge || 0,
          created_at: new Date().toISOString(),
        })),
      ]
      for (const item of orderItemRows) {
        const { error } = await supabase.from('order_items').insert(item)
        if (error) {
          toast.error('Error', 'Error adding items: ' + error.message)
          return
        }
      }
      await audit({
        action: 'ORDER_CREATED',
        entity: 'order',
        entityId: (newOrder as Order).id,
        entityName: 'Table ' + table.name,
        newValue: { total, items: items.length, table: table.name },
        performer: profile as Profile,
      })
      await supabase.from('tables').update({ status: 'occupied' }).eq('id', table.id)
      // Reload the newly created order so PaymentModal has full order_items
      const { data: freshOrder } = await supabase
        .from('orders')
        .select('*, order_items(*, menu_items(name))')
        .eq('id', (newOrder as Order).id)
        .single()
      if (freshOrder) {
        setActiveOrder(freshOrder)
        setShowPayment(true)
      }
      // Refresh table grid in background — don't await so it doesn't block modal
      void fetchTables()
    } catch (err) {
      console.error('handlePlaceOrder error:', err)
      toast.error('Error', 'Order failed: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      placingOrderRef.current = false
    }
  }

  const openCashSale = (type: 'cash' | 'takeaway') => {
    setCashSaleType(type)
    setShowCashSale(true)
  }

  if (geoStatus === 'outside')
    return <GeofenceBlock status={geoStatus} distance={geoDist} location={geoLocation} />

  if (isClockedIn === false)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full bg-red-500/10 border border-red-500/20 rounded-2xl p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5">
            <LogOut size={28} className="text-red-400" />
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center mx-auto mb-4">
            <span className="text-black font-bold text-lg">B</span>
          </div>
          <h2 className="text-lg font-bold text-red-400 mb-2">You are not clocked in</h2>
          <p className="text-gray-400 text-sm mb-2">
            Please ask your manager to clock you in before you can access the POS.
          </p>
          <button
            onClick={signOut}
            className="mt-6 flex items-center gap-2 mx-auto bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </div>
    )

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )

  return (
    <div className="fixed inset-0 bg-gray-950 flex flex-col">
      <WaiterCalls />
      <CustomerOrderAlerts profile={profile} assignedTableIds={assignedTableIds || []} />

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
              onClick={() => openCashSale('cash')}
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
            <button
              onClick={fullRefresh}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white active:rotate-180 transition-transform duration-300"
            >
              <RefreshCw size={15} />
            </button>
            <div className="hidden sm:block text-right">
              <p className="text-white text-xs">{profile?.full_name}</p>
              <p className="text-amber-500 text-xs capitalize">{profile?.role}</p>
            </div>
            <HelpTooltip
              storageKey="pos"
              tips={[
                {
                  id: 'pos-clockin',
                  title: 'Clock In Required',
                  description:
                    'You must be clocked in by a manager before accessing the POS. If you see a locked screen, contact your shift manager. The manager also assigns you a POS machine terminal at clock-in — this links all your sales to that device for end-of-shift reconciliation.',
                },
                {
                  id: 'pos-tables',
                  title: 'Table Grid',
                  description:
                    'Your assigned tables are shown here colour-coded by zone. Green = available, amber/coloured = occupied. Tap an occupied table to add more items or proceed to payment. Tables outside your assigned zone are greyed out. Use the zone filter tabs to focus on your area.',
                },
                {
                  id: 'pos-search',
                  title: 'Menu Search',
                  description:
                    'Type any item name in the search bar to filter the menu instantly. Use it together with category tabs — select Drinks first, then type "chap" to find Chapman immediately.',
                },
                {
                  id: 'pos-cashsale',
                  title: 'Cash Sale',
                  description:
                    'For counter walk-ins who pay immediately. No table needed — pick items and process payment on the spot. Inventory is depleted at payment, not at order time.',
                },
                {
                  id: 'pos-takeaway',
                  title: 'Takeaway',
                  description:
                    'For phone-in or walk-in orders to go. Enter the customer name and phone number, select items, and process payment. The order appears on the relevant KDS screens.',
                },
                {
                  id: 'pos-zonepricing',
                  title: 'Zone Pricing & Hire Fee',
                  description:
                    'Drink prices vary by zone — Outdoor, Indoor, VIP Lounge, and The Nook each have their own tier. Food is always fixed price. The correct price is applied automatically. If a zone has a hire fee (e.g. The Nook), a banner reminds you to add it to the bill.',
                },
                {
                  id: 'pos-payment',
                  title: 'Processing Payment',
                  description:
                    'Tap Pay on any open order. Choose Cash, Bank POS, Transfer, or Credit (runs a tab). Split Bill divides the order between multiple people, each paying separately. Run Tab keeps the order open to add more items later. Inventory is depleted at the point of payment.',
                },
                {
                  id: 'pos-void',
                  title: 'Voiding an Item',
                  description:
                    'Tap the minus/delete button on any existing order item. A manager PIN is required. Once confirmed, the item is deleted from the database, the order total is reduced, and the KDS ticket is updated. Voids cannot be processed while the payment screen is open.',
                },
                {
                  id: 'pos-split',
                  title: 'Split Payment',
                  description:
                    'Use Split Bill to divide the check between 2–6 people. Assign items to each person, then collect payment from each one in turn using any payment method. All splits must be completed before the order closes.',
                },
                {
                  id: 'pos-credit',
                  title: 'Credit / Account Payment',
                  description:
                    'Selecting Credit creates a debtor record for the customer. If the customer already has an account (matched by phone number), their existing balance is increased rather than creating a duplicate entry.',
                },
                {
                  id: 'pos-shift',
                  title: 'My Shift Tab',
                  description:
                    'Your shift summary — clock-in time, POS machine assigned, orders closed, tables served, and total sales. Refreshes in real time. Use this before clocking out to verify your figures match the till.',
                },
              ]}
            />
            <button
              onClick={signOut}
              className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>

      <div className="flex border-b border-gray-800 bg-gray-900 px-4">
        {(
          [
            ['tables', Beer, 'Tables'],
            ['history', History, 'My Orders'],
            ['shift', TrendingUp, 'My Shift'],
          ] as const
        ).map(([id, Icon, label]) => (
          <button
            key={id}
            onClick={() => {
              setPosTab(id)
              if (id === 'history') fetchHistory()
              if (id === 'shift') fetchShiftStats()
            }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${posTab === id ? 'border-amber-500 text-amber-400' : 'border-transparent text-gray-500 hover:text-white'}`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {posTab === 'tables' && (
          <div className={`flex flex-1 flex-col overflow-hidden`}>
            <TableGrid
              tables={tables}
              onSelectTable={handleSelectTable}
              selectedTable={selectedTable}
              assignedTableIds={assignedTableIds}
              defaultCategory={defaultZone}
            />
          </div>
        )}

        {posTab === 'shift' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-sm">Current shift summary</p>
              <button onClick={fetchShiftStats} className="text-gray-500 hover:text-white">
                <RefreshCw size={14} />
              </button>
            </div>
            {shiftLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={20} className="animate-spin text-amber-500" />
              </div>
            ) : !shiftStats ? (
              <div className="text-center py-16">
                <Clock size={32} className="text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No shift data available</p>
              </div>
            ) : (
              <>
                <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center gap-3">
                  <div className="w-10 h-10 bg-amber-500/20 rounded-xl flex items-center justify-center">
                    <Clock size={18} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-gray-500 text-xs">Clocked in at</p>
                    <p className="text-white font-bold">
                      {shiftStats.clockIn
                        ? new Date(shiftStats.clockIn).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : 'N/A'}
                    </p>
                  </div>
                  <div className="ml-auto text-right">
                    <p className="text-gray-500 text-xs">Duration</p>
                    <p className="text-white font-bold">
                      {shiftStats.clockIn
                        ? (() => {
                            const mins = Math.floor(
                              (Date.now() - new Date(shiftStats.clockIn).getTime()) / 60000
                            )
                            return mins < 60
                              ? `${mins}m`
                              : `${Math.floor(mins / 60)}h ${mins % 60}m`
                          })()
                        : 'N/A'}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(
                    [
                      ['Orders Closed', shiftStats.ordersCount, 'text-blue-400'],
                      ['Tables Served', shiftStats.uniqueTables, 'text-green-400'],
                      ['Items Sold', shiftStats.totalItems, 'text-purple-400'],
                    ] as const
                  ).map(([label, value, color]) => (
                    <div
                      key={label}
                      className="bg-gray-900 border border-gray-800 rounded-2xl p-3 text-center"
                    >
                      <p className={`text-2xl font-bold ${color}`}>{value}</p>
                      <p className="text-gray-500 text-xs mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>
                <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-4 text-center">
                  <p className="text-gray-400 text-xs uppercase tracking-wide mb-1">Total Sales</p>
                  <p className="text-amber-400 text-3xl font-bold">
                    ₦{shiftStats.totalSales.toLocaleString()}
                  </p>
                </div>
                {shiftStats.recentOrders.length > 0 && (
                  <div>
                    <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">
                      Recent Orders
                    </p>
                    <div className="space-y-2">
                      {shiftStats.recentOrders.map((order) => (
                        <div
                          key={order.id}
                          className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-center justify-between"
                        >
                          <div>
                            <p className="text-white text-sm">
                              {order.tables?.name || 'Cash Sale'}
                            </p>
                            <p className="text-gray-500 text-xs">
                              {new Date(order.closed_at).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>
                          <p className="text-amber-400 font-bold text-sm">
                            ₦{(order.total_amount || 0).toLocaleString()}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {posTab === 'history' && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-gray-400 text-sm">Today's closed orders</p>
              <button onClick={fetchHistory} className="text-gray-500 hover:text-white">
                <RefreshCw size={14} />
              </button>
            </div>
            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <RefreshCw size={20} className="animate-spin text-amber-500" />
              </div>
            ) : orderHistory.length === 0 ? (
              <div className="text-center py-16">
                <History size={32} className="text-gray-700 mx-auto mb-3" />
                <p className="text-gray-500 text-sm">No orders closed today</p>
              </div>
            ) : (
              orderHistory.map((order) => (
                <div key={order.id} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <p className="text-white font-semibold text-sm">
                        {order.tables?.name ||
                          (order as unknown as { customer_name?: string }).customer_name ||
                          'Cash Sale'}
                      </p>
                      <p className="text-gray-500 text-xs mt-0.5">
                        {new Date(
                          (order as unknown as { closed_at: string }).closed_at
                        ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                        · {order.payment_method?.replace('_', ' ')}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-amber-400 font-bold text-sm">
                        ₦{(order.total_amount || 0).toLocaleString()}
                      </p>
                      <button
                        onClick={() => setReprintOrder(order)}
                        className="flex items-center gap-1 text-gray-400 hover:text-white text-xs mt-1 transition-colors"
                      >
                        <Printer size={12} /> Reprint
                      </button>
                    </div>
                  </div>
                  <div className="border-t border-gray-800 pt-2 space-y-0.5">
                    {order.order_items?.map((item) => (
                      <p key={item.id} className="text-gray-500 text-xs">
                        {item.quantity}x{' '}
                        {(item as unknown as { menu_items?: { name: string } }).menu_items?.name ||
                          'Item'}{' '}
                        — ₦{(item.total_price || 0).toLocaleString()}
                      </p>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {selectedTable && !showPayment && (
          <div className="fixed inset-0 z-50 bg-gray-950 flex flex-col overflow-hidden">
            <OrderPanel
              table={selectedTable}
              menuItems={getMenuItemsWithZonePrices(selectedTable) as MenuItem[]}
              paymentInProgress={showPayment}
              profile={profile}
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
          menuItems={menuItems as MenuItem[]}
          staffId={profile!.id}
          onSuccess={() => setShowCashSale(false)}
          onClose={() => setShowCashSale(false)}
        />
      )}

      {reprintOrder && (
        <ReceiptModal
          order={reprintOrder as unknown as import('../../types').Order}
          table={
            reprintOrder.tables
              ? (reprintOrder.tables as unknown as import('../../types').Table)
              : ({
                  name:
                    (reprintOrder as unknown as { customer_name?: string }).customer_name ||
                    'Cash Sale',
                } as import('../../types').Table)
          }
          items={(reprintOrder.order_items || []) as import('../../types').OrderItem[]}
          staffName={profile?.full_name || ''}
          autoPrint={false}
          onClose={() => setReprintOrder(null)}
        />
      )}

      {/* Covers modal — shown when waitron selects an available table */}
      {pendingTable && (
        <CoversModal
          tableName={pendingTable.name}
          onConfirm={handleCoversConfirmed}
          onCancel={handleCoversCancel}
        />
      )}
    </div>
  )
}
