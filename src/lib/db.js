const DB_NAME = 'beeshops_os'
const DB_VERSION = 1

let _db = null

async function openDB() {
  if (_db) return _db
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onupgradeneeded = (e) => {
      const db = e.target.result
      const stores = [
        'orders', 'order_items', 'till_sessions', 'payouts',
        'menu_items', 'menu_categories', 'menu_item_zone_prices',
        'tables', 'profiles', 'zone_assignments', 'inventory', 'sync_queue'
      ]
      stores.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' })
        }
      })
    }
  })
}

export async function localGet(storeName, id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(id)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function localGetAll(storeName, filterKey, filterValue) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => {
      let results = req.result || []
      if (filterKey && filterValue !== undefined) {
        results = results.filter(r => r[filterKey] === filterValue)
      }
      resolve(results)
    }
    req.onerror = () => reject(req.error)
  })
}

export async function localPut(storeName, record) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function localDelete(storeName, id) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(id)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function localBulkPut(storeName, records) {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    records.forEach(r => store.put(r))
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function queueSync(tableName, operation, recordId, payload) {
  const entry = {
    id: crypto.randomUUID(),
    table_name: tableName,
    operation,
    record_id: recordId,
    payload,
    created_at: new Date().toISOString(),
    retries: 0,
  }
  await localPut('sync_queue', entry)
  return entry
}

export async function getPendingQueue() {
  const all = await localGetAll('sync_queue')
  return all.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
}

export async function removeFromQueue(id) {
  await localDelete('sync_queue', id)
}

export async function getPendingCount() {
  const q = await getPendingQueue()
  return q.length
}
