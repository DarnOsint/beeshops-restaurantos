import { useEffect, useRef, useState } from 'react'
import { X, Printer, Download } from 'lucide-react'
import type { Order, OrderItem, Table } from '../../types'

interface Props {
  order: Order
  table: Table | null
  items: OrderItem[]
  staffName: string
  tipAmount?: number
  amountReceived?: number
  autoPrint?: boolean
  onClose: () => void
}

export default function ReceiptModal({
  order,
  table,
  items,
  staffName,
  tipAmount = 0,
  amountReceived = 0,
  autoPrint = true,
  onClose,
}: Props) {
  const customerRef = useRef<HTMLDivElement>(null)
  const waiterRef = useRef<HTMLDivElement>(null)
  const [printing, setPrinting] = useState(false)
  const [activeTab, setActiveTab] = useState<'customer' | 'waiter'>('customer')

  const formatDate = (date: string) =>
    new Date(date).toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
  const formatTime = (date: string) =>
    new Date(date).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })

  const paymentLabel: Record<string, string> = {
    cash: 'Cash',
    card: 'Bank POS',
    transfer: 'Bank Transfer',
  }

  const orderRef = `BSP-${String(order.id).slice(0, 8).toUpperCase()}`

  const subtotal = items.reduce(
    (sum, i) =>
      sum +
      ((i as unknown as { total_price?: number }).total_price || 0) +
      ((i as unknown as { extra_charge?: number }).extra_charge || 0),
    0
  )
  // Total is order.total_amount (what was actually charged)
  const total = (order as unknown as { total_amount?: number }).total_amount || subtotal
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`${window.location.origin}/receipt/${order.id}`)}&color=000000&bgcolor=ffffff`

  const handleThermalPrint = () => {
    // Use window.open approach — reliable across all devices
    handlePrint('customer')
    setTimeout(onClose, 500)
  }
  // Auto-trigger print when receipt opens — only when autoPrint is true (post-payment flow)
  const hasPrinted = useRef(false)
  useEffect(() => {
    if (!autoPrint) return
    if (hasPrinted.current) return
    hasPrinted.current = true
    void handleThermalPrint()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const buildMonoReceipt = (type: 'customer' | 'waiter') => {
    const W = 40
    const fmtRow = (left: string, right: string) => {
      const l = left.substring(0, W - right.length - 1)
      const spaces = W - l.length - right.length
      return l + ' '.repeat(Math.max(1, spaces)) + right
    }
    const divider = '-'.repeat(W)
    const solidDivider = '='.repeat(W)
    const centre = (str: string) => {
      const pad = Math.max(0, Math.floor((W - str.length) / 2))
      return ' '.repeat(pad) + str
    }

    const pmRaw = (order.payment_method ?? '').toLowerCase()
    const pmLabel = pmRaw.startsWith('transfer:')
      ? `TRANSFER - ${pmRaw.replace('transfer:', '').toUpperCase()}`
      : pmRaw === 'cash'
        ? 'CASH'
        : pmRaw === 'card'
          ? 'BANK POS'
          : pmRaw === 'credit'
            ? 'PAY LATER (DEBT)'
            : pmRaw.toUpperCase()

    const itemLines = items
      .map((item) => {
        const iName = `${item.quantity}x ${(item as unknown as { menu_items?: { name: string } }).menu_items?.name || 'Item'}`
        const iPrice = `N${((item as unknown as { total_price?: number }).total_price || 0).toLocaleString()}`
        return fmtRow(iName, iPrice)
      })
      .join('\n')

    const tipLines =
      tipAmount > 0
        ? [
            divider,
            fmtRow(
              'Amt Received:',
              `N${(amountReceived > 0 ? amountReceived : total + tipAmount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ),
            fmtRow(
              'Tip (Thank you!):',
              `N${tipAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            ),
          ]
        : []

    if (type === 'waiter') {
      // Waiter copy — plain monospace
      const lines = [
        '',
        centre("BEESHOP'S PLACE"),
        centre('Lounge & Restaurant'),
        centre('-- WAITER COPY --'),
        divider,
        fmtRow('Ref:', orderRef),
        fmtRow('Table:', table?.name ?? 'N/A'),
        fmtRow('Date:', formatDate(order.created_at)),
        fmtRow('Time:', formatTime(order.created_at)),
        fmtRow('Served by:', staffName || 'Staff'),
        fmtRow('Payment:', pmLabel),
        divider,
        fmtRow('ITEM', 'AMOUNT'),
        divider,
        itemLines,
        solidDivider,
        fmtRow(
          'TOTAL:',
          `N${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        ),
        ...tipLines,
        solidDivider,
        '',
        centre('-- Staff Record Only --'),
        '',
      ].join('\n')

      return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Waiter Copy - ${orderRef}</title>
<style>* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #000; background: #fff; width: 80mm; padding: 4mm; white-space: pre; }
@media print { body { width: 80mm; } @page { margin: 0; size: 80mm auto; } }
</style></head><body>${lines}</body></html>`
    }

    // Customer copy — monospace with QR code image at bottom
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(`${window.location.origin}/receipt/${order.id}`)}&color=000000&bgcolor=ffffff`

    const customerLines = [
      '',
      centre("BEESHOP'S PLACE"),
      centre('Lounge & Restaurant'),
      divider,
      fmtRow('Ref:', orderRef),
      fmtRow('Table:', table?.name ?? 'N/A'),
      fmtRow('Date:', formatDate(order.created_at)),
      fmtRow('Time:', formatTime(order.created_at)),
      fmtRow('Served by:', staffName || 'Staff'),
      fmtRow('Payment:', pmLabel),
      divider,
      fmtRow('ITEM', 'AMOUNT'),
      divider,
      itemLines,
      solidDivider,
      fmtRow(
        'TOTAL:',
        `N${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      ),
      ...tipLines,
      solidDivider,
      '',
      centre('** PAYMENT CONFIRMED **'),
      '',
    ].join('\n')

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Customer Receipt - ${orderRef}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 13px; color: #000; background: #fff; width: 80mm; padding: 4mm; }
    .receipt-text { white-space: pre; }
    .qr-section { text-align: center; margin: 8px 0 4px; }
    .qr-label { font-size: 10px; color: #555; margin-top: 3px; font-style: italic; }
    .footer { text-align: center; font-size: 11px; margin-top: 6px; }
    @media print { body { width: 80mm; } @page { margin: 0; size: 80mm auto; } }
  </style>
</head>
<body>
  <div class="receipt-text">${customerLines}</div>
  <div class="qr-section">
    <img src="${qrUrl}" width="90" height="90" alt="QR" style="display:block;margin:0 auto;" onload="window._qrLoaded=true" />
    <div class="qr-label">Scan to view your order online</div>
  </div>
  <div class="footer">Thank you for visiting Beeshop's Place!</div>
</body>
</html>`
  }

  const handlePrint = (type: 'customer' | 'waiter') => {
    const html = buildMonoReceipt(type)
    const win = window.open(
      '',
      '_blank',
      'width=500,height=700,toolbar=no,menubar=no,scrollbars=no'
    )
    if (!win) return
    win.document.open('text/html', 'replace')
    win.document.write(html)
    win.document.close()
    win.onload = () => {
      // Wait longer for customer copy to allow QR image to load
      const delay = type === 'customer' ? 800 : 200
      setTimeout(() => {
        win.print()
        win.close()
      }, delay)
    }
  }

  const handleDownload = (type: 'customer' | 'waiter') => {
    const html = buildMonoReceipt(type)
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type === 'customer' ? 'receipt' : 'waiter-copy'}-${orderRef}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <h3 className="font-bold text-gray-900 text-lg">Receipt — {orderRef}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">
            <X size={20} />
          </button>
        </div>

        {/* Print choice — shown when opened from My Orders (not auto-print) */}
        {!autoPrint && (
          <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 shrink-0">
            <p className="text-amber-800 text-sm font-semibold mb-3">Select which copy to print:</p>
            <div className="flex gap-3">
              <button
                onClick={() => handlePrint('customer')}
                disabled={printing}
                className="flex-1 flex items-center justify-center gap-2 bg-black text-white font-semibold py-3 rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors text-sm"
              >
                <Printer size={15} /> {printing ? 'Printing...' : 'Customer Copy'}
              </button>
              <button
                onClick={() => handlePrint('waiter')}
                disabled={printing}
                className="flex-1 flex items-center justify-center gap-2 bg-amber-500 text-black font-semibold py-3 rounded-xl hover:bg-amber-400 disabled:opacity-50 transition-colors text-sm"
              >
                <Printer size={15} /> Waiter Copy
              </button>
            </div>
          </div>
        )}

        <div className="flex md:hidden border-b border-gray-200 bg-gray-50 shrink-0">
          <button
            onClick={() => setActiveTab('customer')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'customer' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
          >
            Customer Copy
          </button>
          <button
            onClick={() => setActiveTab('waiter')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${activeTab === 'waiter' ? 'text-gray-900 border-b-2 border-gray-900' : 'text-gray-400'}`}
          >
            Waiter Copy
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Customer Receipt */}
          <div
            className={`${activeTab === 'customer' ? 'flex' : 'hidden'} md:flex flex-1 flex-col border-r border-gray-200`}
          >
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Customer Receipt
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePrint('customer')}
                  disabled={printing}
                  className="flex items-center gap-1 text-xs bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  <Printer size={12} /> {printing ? 'Printing...' : '🖨 Print Receipt'}
                </button>
                <button
                  onClick={() => handleDownload('customer')}
                  className="flex items-center gap-1 text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  <Download size={12} /> Save
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-white flex justify-center">
              <div
                ref={customerRef}
                style={{
                  fontFamily: "'Courier New', monospace",
                  fontSize: '12px',
                  width: '72mm',
                  color: '#000',
                  background: '#fff',
                }}
              >
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px' }}>
                    BEESHOP'S PLACE
                  </div>
                  <div style={{ fontSize: '11px', marginTop: '2px' }}>Lounge & Restaurant</div>
                  <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>
                    — — — — — — — — — — — —
                  </div>
                </div>
                <div style={{ marginBottom: '6px' }}>
                  {[
                    ['Ref', orderRef],
                    ['Date', formatDate(order.created_at)],
                    ['Time', formatTime(order.created_at)],
                    [
                      'Table',
                      table?.name ||
                        (order.order_type === 'takeaway'
                          ? `Takeaway${(order as unknown as { customer_name?: string }).customer_name ? ` — ${(order as unknown as { customer_name: string }).customer_name}` : ''}`
                          : 'Counter'),
                    ],
                    ['Served by', staffName],
                    ['Payment', paymentLabel[order.payment_method!] || order.payment_method],
                  ].map(([label, value]) => (
                    <div
                      key={label as string}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: '2px 0',
                      }}
                    >
                      <span>{label}:</span>
                      <span style={{ fontWeight: 'bold' }}>{value as string}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '10px',
                    fontWeight: 'bold',
                    marginBottom: '4px',
                  }}
                >
                  <span style={{ flex: 1 }}>ITEM</span>
                  <span style={{ width: '24px', textAlign: 'center' }}>QTY</span>
                  <span style={{ width: '48px', textAlign: 'right' }}>PRICE</span>
                  <span style={{ width: '64px', textAlign: 'right' }}>TOTAL</span>
                </div>
                <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />
                {items.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      margin: '3px 0',
                      alignItems: 'flex-start',
                    }}
                  >
                    <span style={{ flex: 1, paddingRight: '4px', wordBreak: 'break-word' }}>
                      {(item as unknown as { menu_items?: { name: string } }).menu_items?.name ||
                        item.id}
                    </span>
                    <span style={{ width: '24px', textAlign: 'center' }}>{item.quantity}</span>
                    <span style={{ width: '48px', textAlign: 'right' }}>
                      ₦{item.unit_price?.toLocaleString()}
                    </span>
                    <span style={{ width: '64px', textAlign: 'right' }}>
                      ₦{(item as unknown as { total_price?: number }).total_price?.toLocaleString()}
                    </span>
                  </div>
                ))}
                <div style={{ borderTop: '2px solid #000', margin: '6px 0' }} />
                {[['Subtotal', `₦${subtotal.toLocaleString()}`]].map(([l, v]) => (
                  <div
                    key={l}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      margin: '3px 0',
                    }}
                  >
                    <span>{l}</span>
                    <span>{v}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 'bold',
                    fontSize: '14px',
                    margin: '4px 0',
                  }}
                >
                  <span>TOTAL</span>
                  <span>
                    ₦
                    {total.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {tipAmount > 0 && (
                  <>
                    <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: '3px 0',
                      }}
                    >
                      <span>Amount Received</span>
                      <span>
                        ₦
                        {amountReceived > 0
                          ? amountReceived.toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : (total + tipAmount).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: '3px 0',
                        color: '#16a34a',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>💚 Tip (Thank you!)</span>
                      <span>
                        ₦
                        {tipAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </>
                )}
                {(order as unknown as { notes?: string }).notes && (
                  <div style={{ fontSize: '10px', marginTop: '6px', color: '#444' }}>
                    Note: {(order as unknown as { notes: string }).notes}
                  </div>
                )}
                <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
                <div style={{ textAlign: 'center', margin: '8px 0' }}>
                  <img
                    src={qrUrl}
                    alt="QR"
                    style={{ width: '80px', height: '80px', display: 'block', margin: '0 auto' }}
                  />
                  <div style={{ fontSize: '9px', marginTop: '4px', color: '#666' }}>
                    Scan to review your order
                  </div>
                </div>
                <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />
                <div style={{ textAlign: 'center', fontSize: '10px', lineHeight: '1.6' }}>
                  <div>Thank you for visiting!</div>
                  <div style={{ color: '#666' }}>Please come again 🙏</div>
                  <div style={{ marginTop: '4px', fontSize: '9px', color: '#888' }}>
                    Powered by RestaurantOS
                  </div>
                </div>
                <div style={{ marginTop: '16px' }} />
              </div>
            </div>
          </div>

          {/* Waiter Copy */}
          <div className={`${activeTab === 'waiter' ? 'flex' : 'hidden'} md:flex flex-1 flex-col`}>
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Waiter Copy
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => handlePrint('waiter')}
                  className="flex items-center gap-1 text-xs bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors"
                >
                  <Printer size={12} /> Print
                </button>
                <button
                  onClick={() => handleDownload('waiter')}
                  className="flex items-center gap-1 text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-300 transition-colors"
                >
                  <Download size={12} /> Save
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-white flex justify-center">
              <div
                ref={waiterRef}
                style={{
                  fontFamily: "'Courier New', monospace",
                  fontSize: '12px',
                  width: '72mm',
                  color: '#000',
                  background: '#fff',
                }}
              >
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 'bold' }}>ORDER SUMMARY</div>
                  <div style={{ fontSize: '10px', color: '#444' }}>INTERNAL USE ONLY</div>
                  <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>
                    — — — — — — — —
                  </div>
                </div>
                <div style={{ marginBottom: '6px' }}>
                  {[
                    ['Ref', orderRef],
                    ['Date', formatDate(order.created_at)],
                    ['Time', formatTime(order.created_at)],
                    [
                      'Table',
                      table?.name ||
                        (order.order_type === 'takeaway'
                          ? `Takeaway${(order as unknown as { customer_name?: string }).customer_name ? ` — ${(order as unknown as { customer_name: string }).customer_name}` : ''}`
                          : 'Counter'),
                    ],
                    ['Staff', staffName],
                    ['Payment', paymentLabel[order.payment_method!] || order.payment_method],
                  ].map(([label, value]) => (
                    <div
                      key={label as string}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: '2px 0',
                      }}
                    >
                      <span>{label}:</span>
                      <span style={{ fontWeight: 'bold' }}>{value as string}</span>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />
                <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>
                  ITEMS ORDERED
                </div>
                {items.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      margin: '4px 0',
                    }}
                  >
                    <span style={{ flex: 1 }}>
                      {(item as unknown as { menu_items?: { name: string } }).menu_items?.name ||
                        item.id}
                    </span>
                    <span style={{ fontWeight: 'bold' }}>x{item.quantity}</span>
                  </div>
                ))}
                <div style={{ borderTop: '2px solid #000', margin: '6px 0' }} />
                {[['Subtotal', `₦${subtotal.toLocaleString()}`]].map(([l, v]) => (
                  <div
                    key={l}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '11px',
                      margin: '2px 0',
                    }}
                  >
                    <span>{l}</span>
                    <span>{v}</span>
                  </div>
                ))}
                <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 'bold',
                    fontSize: '13px',
                  }}
                >
                  <span>TOTAL CHARGED</span>
                  <span>
                    ₦
                    {total.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
                {tipAmount > 0 && (
                  <>
                    <div style={{ borderTop: '1px dashed #000', margin: '4px 0' }} />
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: '2px 0',
                      }}
                    >
                      <span>Amount Received</span>
                      <span>
                        ₦
                        {(amountReceived > 0 ? amountReceived : total + tipAmount).toLocaleString(
                          undefined,
                          { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                        )}
                      </span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '11px',
                        margin: '2px 0',
                        fontWeight: 'bold',
                      }}
                    >
                      <span>TIP RECEIVED</span>
                      <span>
                        ₦
                        {tipAmount.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </>
                )}
                {(order as unknown as { notes?: string }).notes && (
                  <div
                    style={{
                      fontSize: '10px',
                      marginTop: '6px',
                      padding: '4px',
                      border: '1px dashed #000',
                    }}
                  >
                    NOTE: {(order as unknown as { notes: string }).notes}
                  </div>
                )}
                <div style={{ borderTop: '1px dashed #000', margin: '10px 0' }} />
                <div style={{ fontSize: '10px', marginTop: '8px' }}>
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}
                  >
                    <div
                      style={{
                        borderTop: '1px solid #000',
                        width: '45%',
                        paddingTop: '3px',
                        textAlign: 'center',
                        fontSize: '9px',
                      }}
                    >
                      Waitron
                    </div>
                    <div
                      style={{
                        borderTop: '1px solid #000',
                        width: '45%',
                        paddingTop: '3px',
                        textAlign: 'center',
                        fontSize: '9px',
                      }}
                    >
                      Manager
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '16px' }} />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end shrink-0">
          <button
            onClick={() => {
              handlePrint('customer')
              setTimeout(onClose, 1500)
            }}
            className="bg-amber-500 hover:bg-amber-400 text-black font-bold px-6 py-2 rounded-xl text-sm transition-colors"
          >
            Print & Done
          </button>
        </div>
      </div>
    </div>
  )
}
