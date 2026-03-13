/**
 * api/cron/daily-report.js
 * Vercel cron job — runs every day at 11:30 PM WAT (22:30 UTC).
 * Sends a daily summary email to the owner.
 *
 * Setup:
 * 1. Create a free account at resend.com
 * 2. Add RESEND_API_KEY to Vercel environment variables
 * 3. Add REPORT_EMAIL (owner's email) to Vercel environment variables
 * 4. Add a verified sender domain or use Resend's onboarding address
 * 5. The vercel.json cron config triggers this route automatically
 */

import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const resend = new Resend(process.env.RESEND_API_KEY)

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET

function fmt(n) {
  return `₦${Number(n || 0).toLocaleString('en-NG')}`
}

export default async function handler(req, res) {
  // Security — only allow Vercel cron or internal calls
  const authHeader = req.headers['authorization']
  const internalHeader = req.headers['x-internal-secret']
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  const isInternal = internalHeader === INTERNAL_SECRET

  if (!isCron && !isInternal) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayISO = today.toISOString()

    // Fetch today's orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .gte('created_at', todayISO)

    const paid = orders?.filter(o => o.status === 'paid') || []
    const voided = orders?.filter(o => o.status === 'cancelled') || []
    const open = orders?.filter(o => o.status === 'open') || []

    const totalRevenue = paid.reduce((s, o) => s + (o.total_amount || 0), 0)
    const cashRevenue = paid.filter(o => o.payment_method === 'cash').reduce((s, o) => s + (o.total_amount || 0), 0)
    const posRevenue = paid.filter(o => o.payment_method === 'bank_pos').reduce((s, o) => s + (o.total_amount || 0), 0)
    const transferRevenue = paid.filter(o => o.payment_method === 'bank_transfer').reduce((s, o) => s + (o.total_amount || 0), 0)
    const creditRevenue = paid.filter(o => o.payment_method === 'credit').reduce((s, o) => s + (o.total_amount || 0), 0)

    // Fetch till sessions
    const { data: tillSessions } = await supabase
      .from('till_sessions')
      .select('*')
      .gte('created_at', todayISO)

    const totalPayouts = tillSessions?.reduce((s, t) => s + (t.total_payouts || 0), 0) || 0
    const totalFloat = tillSessions?.reduce((s, t) => s + (t.opening_float || 0), 0) || 0

    // Fetch unresolved CV alerts
    const { data: cvAlerts } = await supabase
      .from('cv_alerts')
      .select('*')
      .eq('resolved', false)
      .gte('created_at', todayISO)

    const dateStr = new Date().toLocaleDateString('en-NG', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    })

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f9fafb; margin: 0; padding: 20px; }
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .header { background: #0f172a; color: #f59e0b; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 20px; }
    .header p { margin: 4px 0 0; color: #9ca3af; font-size: 13px; }
    .kpi-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .kpi { background: white; border-radius: 10px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    .kpi .label { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
    .kpi .value { color: #111827; font-size: 22px; font-weight: 700; margin-top: 4px; }
    .kpi .value.green { color: #059669; }
    .kpi .value.red { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; color: #6b7280; font-size: 11px; text-transform: uppercase; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    td { padding: 8px 0; border-bottom: 1px solid #f3f4f6; color: #374151; }
    .alert-badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
    .critical { background: #fef2f2; color: #dc2626; }
    .high { background: #fff7ed; color: #ea580c; }
    .medium { background: #fefce8; color: #ca8a04; }
    .footer { color: #9ca3af; font-size: 11px; text-align: center; margin-top: 24px; }
  </style>
</head>
<body>
  <div style="max-width: 600px; margin: 0 auto;">

    <div class="header">
      <h1>🍺 Beeshop's Place — Daily Report</h1>
      <p>${dateStr}</p>
    </div>

    <div class="kpi-grid">
      <div class="kpi">
        <div class="label">Total Revenue</div>
        <div class="value green">${fmt(totalRevenue)}</div>
      </div>
      <div class="kpi">
        <div class="label">Paid Orders</div>
        <div class="value">${paid.length}</div>
      </div>
      <div class="kpi">
        <div class="label">Voided Orders</div>
        <div class="value red">${voided.length}</div>
      </div>
      <div class="kpi">
        <div class="label">Still Open</div>
        <div class="value">${open.length}</div>
      </div>
    </div>

    <div class="card">
      <h3 style="margin: 0 0 12px; color: #111827; font-size: 14px;">Revenue by Payment Method</h3>
      <table>
        <tr><th>Method</th><th style="text-align:right">Amount</th></tr>
        <tr><td>Cash</td><td style="text-align:right">${fmt(cashRevenue)}</td></tr>
        <tr><td>POS / Card</td><td style="text-align:right">${fmt(posRevenue)}</td></tr>
        <tr><td>Bank Transfer</td><td style="text-align:right">${fmt(transferRevenue)}</td></tr>
        <tr><td>Credit (Debtors)</td><td style="text-align:right">${fmt(creditRevenue)}</td></tr>
        <tr>
          <td><strong>Total</strong></td>
          <td style="text-align:right"><strong>${fmt(totalRevenue)}</strong></td>
        </tr>
      </table>
    </div>

    <div class="card">
      <h3 style="margin: 0 0 12px; color: #111827; font-size: 14px;">Till Summary</h3>
      <table>
        <tr><th>Item</th><th style="text-align:right">Amount</th></tr>
        <tr><td>Opening Float</td><td style="text-align:right">${fmt(totalFloat)}</td></tr>
        <tr><td>Total Payouts</td><td style="text-align:right">${fmt(totalPayouts)}</td></tr>
        <tr><td>Till Sessions</td><td style="text-align:right">${tillSessions?.length || 0}</td></tr>
      </table>
    </div>

    ${cvAlerts && cvAlerts.length > 0 ? `
    <div class="card" style="border: 1px solid #fecaca;">
      <h3 style="margin: 0 0 12px; color: #dc2626; font-size: 14px;">⚠️ Unresolved CCTV Alerts (${cvAlerts.length})</h3>
      <table>
        <tr><th>Camera</th><th>Type</th><th>Severity</th></tr>
        ${cvAlerts.slice(0, 5).map(a => `
        <tr>
          <td>${a.camera_id}</td>
          <td>${a.alert_type?.replace(/_/g, ' ')}</td>
          <td><span class="alert-badge ${a.severity}">${a.severity}</span></td>
        </tr>`).join('')}
      </table>
      ${cvAlerts.length > 5 ? `<p style="color:#6b7280;font-size:12px;margin-top:8px;">...and ${cvAlerts.length - 5} more</p>` : ''}
    </div>` : `
    <div class="card" style="border: 1px solid #d1fae5; text-align: center; padding: 16px;">
      <p style="color: #059669; margin: 0; font-size: 13px;">✓ No unresolved CCTV alerts today</p>
    </div>`}

    <div class="footer">
      <p>RestaurantOS · Beeshop's Place Lounge · Generated automatically at 11:30 PM WAT</p>
      <p>Manage your restaurant at <a href="https://beeshop.place" style="color:#f59e0b;">beeshop.place</a></p>
    </div>

  </div>
</body>
</html>`

    const { data, error } = await resend.emails.send({
      from: 'RestaurantOS <reports@beeshop.place>',
      to: [process.env.REPORT_EMAIL],
      subject: `Daily Report — Beeshop's Place · ${fmt(totalRevenue)} · ${dateStr}`,
      html,
    })

    if (error) {
      console.error('Email send failed:', error)
      return res.status(500).json({ error: error.message })
    }

    return res.status(200).json({
      sent: true,
      emailId: data?.id,
      revenue: totalRevenue,
      orders: paid.length,
    })

  } catch (err) {
    console.error('Daily report error:', err)
    return res.status(500).json({ error: err.message })
  }
}
