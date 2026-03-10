import { useState, useEffect } from 'react'
import { startSyncListener, replayQueue } from '../lib/sync'
import { getPendingCount } from '../lib/db'

export function useSyncStatus() {
  const [status, setStatus] = useState(navigator.onLine ? 'online' : 'offline')
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSynced, setLastSynced] = useState(null)

  useEffect(() => {
    const cleanup = startSyncListener((s) => {
      setStatus(s)
      if (s === 'online') setLastSynced(new Date())
      getPendingCount().then(setPendingCount)
    })

    const interval = setInterval(async () => {
      const count = await getPendingCount()
      setPendingCount(count)
    }, 10000)

    return () => { cleanup(); clearInterval(interval) }
  }, [])

  const manualSync = async () => {
    if (!navigator.onLine) return
    setStatus('syncing')
    const result = await replayQueue()
    setStatus(result.failed > 0 ? 'partial' : 'online')
    setLastSynced(new Date())
    const count = await getPendingCount()
    setPendingCount(count)
  }

  return { status, pendingCount, lastSynced, manualSync }
}
