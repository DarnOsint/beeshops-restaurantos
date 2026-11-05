/**
 * api/cron/stock-check.js
 * Vercel cron wrapper — runs daily at 06:00 UTC (07:00 WAT).
 * Checks all inventory for low/out-of-stock items and fires push alerts,
 * then restores any return that management did not confirm within 24h.
 */

import { expireReturns } from '../_lib/returnsExpiry.js'

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const response = await fetch(`${baseUrl}/api/stock-alerts`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${process.env.CRON_SECRET}`,
    },
  })

  const result = await response.json()

  let returns = null
  try {
    returns = await expireReturns()
  } catch (e) {
    console.error('[stock-check cron] returns expiry failed', e)
    returns = { error: e.message || 'returns expiry failed' }
  }

  console.log('[stock-check cron]', { stock: result, returns })
  return res.status(200).json({ stock: result, returns })
}
