// Order Ticket Builder for kitchen/griller station printers.
// Uses PLAIN TEXT only — no ESC/POS commands.
// Compatible with every thermal printer via raw TCP socket.

export interface TicketItem {
  quantity: number
  name: string
  modifier_notes?: string | null
}

export interface OrderTicketData {
  station: string
  tableName: string
  orderRef: string
  staffName: string
  items: TicketItem[]
  createdAt: string
}

/**
 * Build a plain-text ticket as raw bytes.
 * No ESC/POS commands — just ASCII text + newlines.
 * Works on every thermal printer connected via TCP:9100.
 */
export function buildOrderTicket(data: OrderTicketData): Uint8Array {
  const text = buildOrderTicketText(data)
  // Add a few newlines at the end so the paper feeds past the cutter
  return new TextEncoder().encode(text + '\n\n\n\n\n')
}

/**
 * Build plain text version of the ticket (used by both raw and HTML).
 */
export function buildOrderTicketText(data: OrderTicketData): string {
  const { station, tableName, orderRef, staffName, items, createdAt } = data
  const W = 32 // 58mm printers = ~32 chars, 80mm = ~42 chars. Use 32 for safety.
  const divider = '-'.repeat(W)
  const doubleDivider = '='.repeat(W)

  const centre = (s: string) => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2))
    return ' '.repeat(pad) + s
  }

  const row = (left: string, right: string) => {
    const l = left.substring(0, W - right.length - 1)
    const space = W - l.length - right.length
    return l + ' '.repeat(Math.max(1, space)) + right
  }

  const fmtTime = new Date(createdAt).toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })

  const itemLines = items
    .map((item) => {
      const line = `  ${item.quantity}x ${item.name}`
      if (item.modifier_notes) return line + '\n     >> ' + item.modifier_notes
      return line
    })
    .join('\n')

  return [
    '',
    centre('** ' + station.toUpperCase() + ' **'),
    doubleDivider,
    row('Table:', tableName),
    row('Ref:', orderRef),
    row('Waiter:', staffName.substring(0, 18)),
    row('Time:', fmtTime),
    divider,
    '',
    itemLines,
    '',
    divider,
    centre(items.length + ' item' + (items.length === 1 ? '' : 's')),
    '',
  ].join('\n')
}

/**
 * Build an HTML version of the kitchen/griller ticket.
 * Fallback for print servers that render HTML.
 */
export function buildOrderTicketHTML(data: OrderTicketData): string {
  const text = buildOrderTicketText(data)
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${data.station.toUpperCase()} Order</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Courier New', Courier, monospace; font-size: 14px; font-weight: bold; color: #000; background: #fff; width: 80mm; padding: 3mm; white-space: pre; line-height: 1.4; }
@media print { body { width: 80mm; } @page { margin: 0; size: 80mm auto; } }
</style></head><body>${text}</body></html>`
}
