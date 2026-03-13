// ESC/POS Thermal Printer Hook
// Works via WebSerial API on Chrome (Windows + Android)
// Falls back to browser print dialog automatically

const ESC = 0x1b
const GS = 0x1d

// ESC/POS command helpers
const cmd = {
  init: [ESC, 0x40], // Initialize printer
  alignLeft: [ESC, 0x61, 0x00],
  alignCenter: [ESC, 0x61, 0x01],
  alignRight: [ESC, 0x61, 0x02],
  bold: [ESC, 0x45, 0x01],
  boldOff: [ESC, 0x45, 0x00],
  doubleHeight: [ESC, 0x21, 0x10],
  doubleSize: [ESC, 0x21, 0x30],
  normalSize: [ESC, 0x21, 0x00],
  cut: [GS, 0x56, 0x42, 0x00], // Full cut
  feed: (n) => [ESC, 0x64, n], // Feed n lines
  divider: () => text('-'.repeat(32) + '\n'),
}

function text(str) {
  return Array.from(new TextEncoder().encode(str))
}

function row(left, right, width = 32) {
  const space = width - left.length - right.length
  if (space <= 0) return text(left.substring(0, width - right.length - 1) + ' ' + right + '\n')
  return text(left + ' '.repeat(space) + right + '\n')
}

function buildReceipt({ order, items, table, staffName, orderRef, subtotal, vatAmount, total }) {
  const bytes = []
  const push = (...chunks) =>
    chunks.forEach((c) => (Array.isArray(c) ? bytes.push(...c) : bytes.push(...c)))

  push(cmd.init)
  push(cmd.alignCenter)
  push(cmd.doubleSize, ...text("BEESHOP'S PLACE\n"), cmd.normalSize)
  push(cmd.bold, ...text('Lounge & Restaurant\n'), cmd.boldOff)
  push(...text('--------------------------------\n'))
  push(cmd.alignLeft)

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
  const formatTime = (d) =>
    new Date(d).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })

  push(...row('Ref:', orderRef))
  push(...row('Date:', formatDate(order.created_at)))
  push(...row('Time:', formatTime(order.created_at)))
  push(...row('Table:', table?.name || (order.order_type === 'takeaway' ? 'Takeaway' : 'Counter')))
  push(...row('Served by:', staffName || ''))
  push(...row('Payment:', order.payment_method?.toUpperCase() || ''))
  push(...text('--------------------------------\n'))

  // Items header
  push(cmd.bold, ...text('ITEM             QTY    TOTAL\n'), cmd.boldOff)
  push(...text('--------------------------------\n'))

  items.forEach((item) => {
    const name = (item.menu_items?.name || item.name || '').substring(0, 16).padEnd(16)
    const qty = String(item.quantity).padStart(3)
    const tot = ('\u20A6' + (item.total_price || 0).toLocaleString()).padStart(10)
    push(...text(`${name} ${qty} ${tot}\n`))
    if (item.modifier_notes) push(...text(`  > ${item.modifier_notes.substring(0, 28)}\n`))
  })

  push(...text('================================\n'))
  push(...row('Subtotal:', '\u20A6' + subtotal.toLocaleString()))
  push(
    ...row(
      'VAT (7.5%):',
      '\u20A6' +
        vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    )
  )
  push(...text('--------------------------------\n'))
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
  push(...text('VAT Reg: [Your TIN]\n'))
  push(...text('--------------------------------\n'))
  push(cmd.alignCenter)
  push(...text('Thank you for visiting!\n'))
  push(...text('Please come again\n'))
  push(...text('\n'))
  push(...text('Powered by RestaurantOS\n'))
  push(...cmd.feed(4))
  push(...cmd.cut)

  return new Uint8Array(bytes)
}

let port = null
let writer = null

export function useThermalPrinter() {
  const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator

  const connect = async () => {
    if (!isSupported) return false
    try {
      port = await navigator.serial.requestPort()
      await port.open({ baudRate: 9600 })
      writer = port.writable.getWriter()
      return true
    } catch (e) {
      console.warn('Serial port not selected or failed:', e)
      return false
    }
  }

  const printReceipt = async (data, fallbackFn) => {
    if (!isSupported) {
      fallbackFn?.()
      return
    }
    try {
      if (!port || !writer) {
        const connected = await connect()
        if (!connected) {
          fallbackFn?.()
          return
        }
      }
      const bytes = buildReceipt(data)
      await writer.write(bytes)
    } catch (e) {
      console.warn('Thermal print failed, falling back:', e)
      // Release port on error
      try {
        writer?.releaseLock()
        writer = null
        port = null
      } catch (_e) {
        /* intentional */
      }
      fallbackFn?.()
    }
  }

  const disconnect = async () => {
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
