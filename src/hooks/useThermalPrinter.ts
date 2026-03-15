// ESC/POS Thermal Printer Hook
// Works via WebSerial API on Chrome (Windows + Android)
// Falls back to browser print dialog automatically

const ESC = 0x1b
const GS = 0x1d

const cmd = {
  init: [ESC, 0x40],
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  alignRight: [ESC, 0x61, 0x02],
  bold: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  doubleHeight: [ESC, 0x21, 0x10],
  doubleSize: [ESC, 0x21, 0x30],
  normalSize: [ESC, 0x21, 0x00],
  cut: [GS, 0x56, 0x42, 0x00],
  feed: (n: number) => [ESC, 0x64, n],
} as const

function text(str: string): number[] {
  return Array.from(new TextEncoder().encode(str))
}

function row(left: string, right: string, width = 32): number[] {
  const space = width - left.length - right.length
  if (space <= 0) return text(left.substring(0, width - right.length - 1) + ' ' + right + '\n')
  return text(left + ' '.repeat(space) + right + '\n')
}

export interface ReceiptData {
  order: { created_at: string; order_type: string; payment_method?: string | null }
  items: Array<{
    quantity: number
    total_price: number
    extra_charge?: number
    modifier_notes?: string | null
    menu_items?: { name: string } | null
    name?: string
  }>
  table?: { name: string } | null
  staffName?: string
  orderRef: string
  subtotal: number
  vatAmount: number
  total: number
}

export function buildReceipt(data: ReceiptData): Uint8Array {
  const { order, items, table, staffName, orderRef, subtotal, vatAmount, total } = data
  const bytes: number[] = []
  const push = (...chunks: (number | number[] | readonly number[])[]) =>
    chunks.forEach((c) =>
      Array.isArray(c) ? bytes.push(...(c as number[])) : bytes.push(c as number)
    )

  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
  const fmtTime = (d: string) =>
    new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })

  push(cmd.init)
  push(cmd.alignCenter)
  push(cmd.doubleSize, ...text("BEESHOP'S PLACE\n"), cmd.normalSize)
  push(cmd.bold, ...text('Lounge & Restaurant\n'), cmd.boldOff)
  push(text('--------------------------------\n'))
  push(cmd.alignLeft)
  push(row('Ref:', orderRef))
  push(row('Date:', fmtDate(order.created_at)))
  push(row('Time:', fmtTime(order.created_at)))
  push(row('Table:', table?.name ?? (order.order_type === 'takeaway' ? 'Takeaway' : 'Counter')))
  push(row('Served by:', staffName ?? ''))
  push(row('Payment:', (order.payment_method ?? '').toUpperCase()))
  push(text('--------------------------------\n'))
  push(cmd.bold, ...text('ITEM             QTY    TOTAL\n'), cmd.boldOff)
  push(text('--------------------------------\n'))

  items.forEach((item) => {
    const name = (item.menu_items?.name ?? item.name ?? '').substring(0, 16).padEnd(16)
    const qty = String(item.quantity).padStart(3)
    const tot = ('\u20A6' + (item.total_price ?? 0).toLocaleString()).padStart(10)
    push(text(`${name} ${qty} ${tot}\n`))
    if (item.modifier_notes) push(text(`  > ${item.modifier_notes.substring(0, 28)}\n`))
  })

  push(text('================================\n'))
  push(row('Subtotal (VAT incl.):', '\u20A6' + subtotal.toLocaleString()))

  push(text('--------------------------------\n'))
  push(
    cmd.bold,
    cmd.doubleHeight,
    ...row(
      'TOTAL:',
      '\u20A6' +
        total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ),
    cmd.normalSize,
    cmd.boldOff
  )
  push(text('--------------------------------\n'))
  push(cmd.alignCenter)
  push(text('Thank you for visiting!\n'))
  push(text('Please come again\n\n'))
  push(text('Powered by RestaurantOS\n'))
  push(cmd.feed(4))
  push(cmd.cut)

  return new Uint8Array(bytes)
}

// Module-level serial port state (survives re-renders)
let port: SerialPort | null = null
let writer: WritableStreamDefaultWriter | null = null

export function useThermalPrinter() {
  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator

  const connect = async (): Promise<boolean> => {
    if (!isSupported) return false
    try {
      port = await (
        navigator as Navigator & { serial: { requestPort: () => Promise<SerialPort> } }
      ).serial.requestPort()
      await port.open({ baudRate: 9600 })
      writer = port.writable!.getWriter()
      return true
    } catch (e) {
      console.warn('Serial port not selected or failed:', e)
      return false
    }
  }

  const printReceipt = async (data: ReceiptData, fallbackFn?: () => void): Promise<void> => {
    if (!isSupported) {
      fallbackFn?.()
      return
    }
    try {
      // Always get a fresh writer — release previous lock first if held
      if (writer) {
        try {
          writer.releaseLock()
        } catch (_e) {
          /* already released */
        }
        writer = null
      }
      // Connect if no port or port is closed
      if (!port) {
        // Try to auto-reconnect to a previously permitted port first
        try {
          const serial = (
            navigator as Navigator & { serial: { getPorts: () => Promise<SerialPort[]> } }
          ).serial
          const ports = await serial.getPorts()
          if (ports.length > 0) {
            port = ports[0]
            await port.open({ baudRate: 9600 })
          }
        } catch (_e) {
          /* no saved port */
        }
      }
      // If still no port, ask user to select one
      if (!port) {
        const connected = await connect()
        if (!connected) {
          fallbackFn?.()
          return
        }
      }
      // Get a fresh writer, write, then immediately release
      writer = port!.writable!.getWriter()
      await writer.write(buildReceipt(data))
      writer.releaseLock()
      writer = null
    } catch (e) {
      console.warn('Thermal print failed, falling back:', e)
      try {
        if (writer) {
          writer.releaseLock()
          writer = null
        }
        if (port) {
          try {
            await port.close()
          } catch (_e) {
            /* ignore */
          }
          port = null
        }
      } catch (_e) {
        /* intentional */
      }
      fallbackFn?.()
    }
  }

  const disconnect = async (): Promise<void> => {
    try {
      writer?.releaseLock()
      await port?.close()
      writer = null
      port = null
    } catch (_e) {
      /* intentional */
    }
  }

  return { isSupported, connect, printReceipt, disconnect }
}
