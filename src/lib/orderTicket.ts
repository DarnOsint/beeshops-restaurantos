// ESC/POS Order Ticket Builder
// Builds a compact kitchen/griller ticket — not a customer receipt.

const ESC = 0x1b
const GS = 0x1d

const cmd = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  bold: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  doubleSize: [ESC, 0x21, 0x30],
  normalSize: [ESC, 0x21, 0x00],
  cut: [GS, 0x56, 0x42, 0x00],
  feed: (n: number) => [ESC, 0x64, n],
} as const

function text(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

function row(left: string, right: string, width = 40): number[] {
  const space = width - left.length - right.length
  if (space <= 0) return text(left.substring(0, width - right.length - 1) + ' ' + right + '\n')
  return text(left + ' '.repeat(space) + right + '\n')
}

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

export function buildOrderTicket(data: OrderTicketData): Uint8Array {
  const { station, tableName, orderRef, staffName, items, createdAt } = data
  const W = 40
  const bytes: number[] = []
  const push = (...chunks: (number | number[] | readonly number[])[]) =>
    chunks.forEach((c) =>
      Array.isArray(c) ? bytes.push(...(c as number[])) : bytes.push(c as number)
    )

  const divider = '-'.repeat(W) + '\n'
  const fmtTime = (d: string) =>
    new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })

  push(cmd.init)
  push(cmd.alignCenter)
  push(cmd.doubleSize, ...text(`** ${station.toUpperCase()} **\n`), cmd.normalSize)
  push(cmd.alignLeft)
  push(text(divider))
  push(row('Table:', tableName))
  push(row('Ref:', orderRef))
  push(row('Waiter:', staffName.substring(0, 20)))
  push(row('Time:', fmtTime(createdAt)))
  push(text(divider))

  items.forEach((item) => {
    push(cmd.bold)
    push(cmd.doubleSize)
    push(text(`${item.quantity}x ${item.name.substring(0, 18)}\n`))
    push(cmd.normalSize)
    push(cmd.boldOff)
    if (item.modifier_notes) {
      push(text(`   >> ${item.modifier_notes.substring(0, 33)}\n`))
    }
  })

  push(text(divider))
  push(cmd.alignCenter)
  push(text(`${items.length} item${items.length === 1 ? '' : 's'}\n`))
  push(cmd.feed(3))
  push(cmd.cut)

  return new Uint8Array(bytes)
}
