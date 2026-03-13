import { useState, useEffect } from 'react'
import { startSyncListener, replayQueue } from '../lib/sync'
import { getPendingCount } from '../lib/db'
import type { SyncStatus } from '../lib/sync'

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>(navigator.onLine ? 'online' : 'offline')
  const [pendingCount, setPendingCount] = useState(0)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)

  useEffect(() => {
    const cleanup = startSyncListener((s) => {
      setStatus(s)
      if (s === 'online') setLastSynced(new Date())
      getPendingCount().then(setPendingCount)
    })

    const interval = setInterval(async () => {
      setPendingCount(await getPendingCount())
    }, 10_000)

    return () => {
      cleanup()
      clearInterval(interval)
    }
  }, [])

  const manualSync = async (): Promise<void> => {
    if (!navigator.onLine) return
    setStatus('syncing')
    const result = await replayQueue()
    setStatus(result.failed > 0 ? 'partial' : 'online')
    setLastSynced(new Date())
    setPendingCount(await getPendingCount())
  }

  return { status, pendingCount, lastSynced, manualSync }
}
