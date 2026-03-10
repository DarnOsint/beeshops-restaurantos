import { supabase } from './supabase'
import { localGet, localPut, localDelete, queueSync } from './db'

export async function offlineInsert(tableName, record) {
  const localRecord = { ...record, synced: false }
  await localPut(tableName, localRecord)

  if (!navigator.onLine) {
    await queueSync(tableName, 'INSERT', record.id, record)
    return { data: localRecord, error: null, offline: true }
  }

  const { data, error } = await supabase.from(tableName).insert(record).select().single()
  if (!error) {
    await localPut(tableName, { ...data, synced: true })
    return { data, error: null, offline: false }
  }

  await queueSync(tableName, 'INSERT', record.id, record)
  return { data: localRecord, error: null, offline: true }
}

export async function offlineUpdate(tableName, id, updates) {
  const current = await localGet(tableName, id)
  const updated = { ...current, ...updates, synced: false }
  await localPut(tableName, updated)

  if (!navigator.onLine) {
    await queueSync(tableName, 'UPDATE', id, updated)
    return { data: updated, error: null, offline: true }
  }

  const { data, error } = await supabase
    .from(tableName).update(updates).eq('id', id).select().single()
  if (!error) {
    await localPut(tableName, { ...data, synced: true })
    return { data, error: null, offline: false }
  }

  await queueSync(tableName, 'UPDATE', id, updated)
  return { data: updated, error: null, offline: true }
}

export async function offlineDelete(tableName, id) {
  await localDelete(tableName, id)

  if (!navigator.onLine) {
    await queueSync(tableName, 'DELETE', id, { id })
    return { error: null, offline: true }
  }

  const { error } = await supabase.from(tableName).delete().eq('id', id)
  if (!error) return { error: null, offline: false }

  await queueSync(tableName, 'DELETE', id, { id })
  return { error: null, offline: true }
}
