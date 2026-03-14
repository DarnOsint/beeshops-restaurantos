// Supabase Edge Function — Daily Report Email
// Schedule: every day at 03:30 UTC (4:30am WAT)
// Deploy: supabase functions deploy daily-report
// Schedule: supabase functions schedule daily-report --cron "30 3 * * *"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

const fmt = (n: number) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`

Deno.serve(async () => {
  try {
    const now = new Date()
    // Yesterday WAT (UTC+1)
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toLocaleDateString('en-NG', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
      timeZone: 'Africa/Lagos'
    })
    const dayStart = new Date(yesterday)
    dayStart.setUTCHours(23, 0, 0, 0) // midnight WAT = 23:00 UTC prev day
    dayStart.setDate(dayStart.getDate() - 1)
    const dayEnd = new Date(dayStart)
    dayEnd.setUTCHours(22, 59, 59, 999)
    dayEnd.setDate(dayEnd.getDate() + 1)

    // Fetch yesterday's paid orders
    const { data: orders } = await supabase
      .from('orders')
      .select('total_amount, payment_method, order_type, profiles(full_name)')
      .eq('status', 'paid')
      .gte('closed_at', dayStart.toISOString())
      .lte('closed_at', dayEnd.toISOString())

    const paid = orders || []
    const total = paid.reduce((s: number, o: Record<string, unknown>) => s + ((o.total_amount as number) || 0), 0)
    const cash = paid.filter((o: Record<string, unknown>) => o.payment_method === 'cash')
      .reduce((s: number, o: Record<string, unknown>) => s + ((o.total_amount as number) || 0), 0)
    const transfer = paid.filter((o: Record<string, unknown>) => o.payment_method === 'transfer')
      .reduce((s: number, o: Record<string, unknown>) => s + ((o.total_amount as number) || 0), 0)
    const card = paid.filter((o: Record<string, unknown>) => o.payment_method === 'card')
      .reduce((s: number, o: Record<string, unknown>) => s + ((o.total_amount as number) || 0), 0)
    const credit = paid.filter((o: Record<string, unknown>) => o.payment_method === 'credit')
      .reduce((s: number, o: Record<string, unknown>) => s + ((o.total_amount as number) || 0), 0)

    // Per-waitron breakdown
    const waitronMap: Record<string, number> = {}
    paid.forEach((o: Record<string, unknown>) => {
      const name = ((o.profiles as Record<string, unknown>)?.full_name as string) || 'Unknown'
      waitronMap[name] = (waitronMap[name] || 0) + ((o.total_amount as number) || 0)
    })
    const waitronRows = Object.entries(waitronMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, rev]) => `<tr><td style="padding:6px 12px">${name}</td><td style="padding:6px 12px;text-align:right">${fmt(rev)}</td></tr>`)
      .join('')

    // Voids
    const { data: voids } = await supabase
      .from('void_log')
      .select('total_value')
      .gte('created_at', dayStart.toISOString())
      .lte('created_at', dayEnd.toISOString())
    const totalVoided = (voids || []).reduce((s: number, v: Record<string, unknown>) => s + ((v.total_value as number) || 0), 0)

    // Fetch recipient emails — owners and managers
    const { data: staff } = await supabase
      .from('profiles')
      .select('email')
      .in('role', ['owner', 'manager'])
      .eq('is_active', true)
      .not('email', 'is', null)

    const recipients = (staff || []).map((s: Record<string, unknown>) => s.email as string).filter(Boolean)
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ ok: true, message: 'No recipients' }), { status: 200 })
    }

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;padding:20px">
  <div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden">
    <div style="background:#0f172a;padding:24px">
      <h1 style="color:#f59e0b;margin:0;font-size:20px">Beeshop's Place</h1>
      <p style="color:#94a3b8;margin:4px 0 0;font-size:13px">Daily Trading Summary</p>
    </div>
    <div style="padding:24px">
      <p style="color:#64748b;font-size:13px;margin:0 0 20px">${dateStr}</p>

      <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
        <tr style="background:#f8fafc">
          <td style="padding:10px 12px;font-size:13px;color:#475569">Total Revenue</td>
          <td style="padding:10px 12px;font-size:18px;font-weight:800;color:#f59e0b;text-align:right">${fmt(total)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#475569">Orders Closed</td>
          <td style="padding:8px 12px;font-size:13px;font-weight:600;text-align:right">${paid.length}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;font-size:13px;color:#475569">Cash</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right">${fmt(cash)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#475569">Bank Transfer</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right">${fmt(transfer)}</td>
        </tr>
        <tr style="background:#f8fafc">
          <td style="padding:8px 12px;font-size:13px;color:#475569">Bank POS</td>
          <td style="padding:8px 12px;font-size:13px;text-align:right">${fmt(card)}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px;font-size:13px;color:#e07a0b">Credit (Pay Later)</td>
          <td style="padding:8px 12px;font-size:13px;color:#e07a0b;text-align:right">${fmt(credit)}</td>
        </tr>
        <tr style="background:#fff0f0">
          <td style="padding:8px 12px;font-size:13px;color:#dc2626">Total Voided</td>
          <td style="padding:8px 12px;font-size:13px;color:#dc2626;text-align:right">${fmt(totalVoided)}</td>
        </tr>
      </table>

      ${waitronRows ? `
      <h3 style="font-size:13px;color:#0f172a;text-transform:uppercase;letter-spacing:.5px;margin:0 0 8px">Per Waitron</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="background:#0f172a;color:white">
          <th style="padding:8px 12px;text-align:left">Staff</th>
          <th style="padding:8px 12px;text-align:right">Revenue</th>
        </tr></thead>
        <tbody>${waitronRows}</tbody>
      </table>` : ''}

      <p style="margin:24px 0 0;font-size:11px;color:#94a3b8">
        This report was generated automatically by RestaurantOS at 4:30am WAT.
        Log in at <a href="https://beeshop.place" style="color:#f59e0b">beeshop.place</a> for full details.
      </p>
    </div>
  </div>
</body>
</html>`

    // Send via Resend (or any SMTP configured in Supabase)
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (!resendKey) {
      console.error('RESEND_API_KEY not set')
      return new Response(JSON.stringify({ ok: false, error: 'RESEND_API_KEY not configured' }), { status: 500 })
    }

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'RestaurantOS <reports@beeshop.place>',
        to: recipients,
        subject: `Daily Report — ${dateStr} — ${fmt(total)}`,
        html,
      }),
    })

    if (!emailRes.ok) {
      const err = await emailRes.text()
      console.error('Resend error:', err)
      return new Response(JSON.stringify({ ok: false, error: err }), { status: 500 })
    }

    return new Response(
      JSON.stringify({ ok: true, recipients, total, orders: paid.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500 })
  }
})
