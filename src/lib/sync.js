import { supabase } from './supabase'
import { getPendingQueue, removeFromQueue, localBulkPut, localPut } from './db'

const SEED_TABLES = [
  'menu_items', 'menu_categories', 'menu_item_zone_prices',
  'tables', 'profiles', 'zone_assignments', 'inventory',
]

export async function seedLocalDB() {
  try {
    await Promise.all(SEED_TABLES.map(async (table) => {
      const { data, error } = await supabase.from(table).select('*')
      if (!error && data) await localBulkPut(table, data)
    }))

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const { data: orders } = await supabase
      .from('orders').select('*')
      .gte('created_at', today.toISOString())
    if (orders) await localBulkPut('orders', orders.map(o => ({ ...o, synced: true })))

    const { data: items } = await supabase
      .from('order_items').select('*')
      .gte('created_at', today.toISOString())
    if (items) await localBulkPut('order_items', items.map(i => ({ ...i, synced: true })))

    console.log('[Sync] Local DB seeded')
  } catch (err) {
    console.warn('[Sync] Seed failed (offline):', err.message)
  }
}

async function resolveConflict(tableName, localRecord) {
  const { data: serverRecord } = await supabase
    .from(tableName).select('*').eq('id', localRecord.id).single()

  if (!serverRecord) return 'local_wins'

  const localTime = new Date(localRecord.created_at).getTime()
  const serverTime = new Date(serverRecord.created_at).getTime()

  if (localTime <= serverTime) {
    return 'local_wins'
  } else {
    await localPut(tableName, { ...serverRecord, synced: true })
    return 'server_wins'
  }
}

async function mergeOrderItems(orderId) {
  const { data: serverItems } = await supabase
    .from('order_items').select('*').eq('order_id', orderId)
  if (serverItems) {
    await localBulkPut('order_items', serverItems.map(i => ({ ...i, synced: true })))
  }
}

export async function replayQueue(onProgress) {
  const queue = await getPendingQueue()
  if (!queue.length) return { synced: 0, failed: 0 }

  let synced = 0
  let failed = 0

  for (const entry of queue) {
    try {
      const { table_name, operation, payload, record_id } = entry

      if (operation === 'INSERT') {
        const { data: existing } = await supabase
          .from(table_name).select('id').eq('id', record_id).single()

        if (existing) {
          await removeFromQueue(entry.id)
          synced++
          continue
        }

        if (table_name === 'order_items') {
          await mergeOrderItems(payload.order_id)
        }

        const { error } = await supabase.from(table_name).insert(payload)
        if (error) throw error

      } else if (operation === 'UPDATE') {
        const resolution = await resolveConflict(table_name, payload)
        if (resolution === 'local_wins') {
          const { error } = await supabase
            .from(table_name).update(payload).eq('id', record_id)
          if (error) throw error
        }

      } else if (operation === 'DELETE') {
        const { error } = await supabase
          .from(table_name).delete().eq('id', record_id)
        if (error && error.code !== 'PGRST116') throw error
      }

      await removeFromQueue(entry.id)
      synced++
      onProgress?.({ synced, total: queue.length })

    } catch (err) {
      console.error('[Sync] Failed:', err.message)
      failed++
      if (entry.retries >= 5) {
        await removeFromQueue(entry.id)
      } else {
        await localPut('sync_queue', { ...entry, retries: entry.retries + 1 })
      }
    }
  }

  return { synced, failed }
}

export function startSyncListener(onStatusChange) {
  const handleOnline = async () => {
    onStatusChange?.('syncing')
    await seedLocalDB()
    const result = await replayQueue()
    onStatusChange?.(result.failed > 0 ? 'partial' : 'online')
  }

  const handleOffline = () => {
    onStatusChange?.('offline')
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  if (navigator.onLine) {
    seedLocalDB()
  } else {
    onStatusChange?.('offline')
  }

  return () => {
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }
}
