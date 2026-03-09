import { useEffect, useRef } from 'react'
import { X, Printer, Download } from 'lucide-react'

export default function ReceiptModal({ order, table, items, staffName, onClose }) {
  const customerRef = useRef()
  const waiterRef = useRef()

  useEffect(() => {
    // Auto-trigger print dialog on mount
    setTimeout(() => handlePrint('customer'), 500)
  }, [])

  const formatDate = (date) => {
    const d = new Date(date)
    return d.toLocaleDateString('en-NG', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const formatTime = (date) => {
    return new Date(date).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: true })
  }

  const paymentLabel = {
    cash: 'Cash',
    card: 'Bank POS',
    transfer: 'Bank Transfer'
  }

  const orderRef = `BSP-${String(order.id).slice(0, 8).toUpperCase()}`

  const handlePrint = (type) => {
    const ref = type === 'customer' ? customerRef : waiterRef
    const printWindow = window.open('', '_blank', 'width=340,height=600')
    printWindow.document.write(`
      <html>
        <head>
          <title>${type === 'customer' ? 'Customer Receipt' : 'Waiter Copy'} - ${orderRef}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; background: #fff; width: 80mm; padding: 4mm; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .large { font-size: 15px; }
            .xlarge { font-size: 18px; }
            .small { font-size: 10px; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            .divider-solid { border-top: 2px solid #000; margin: 6px 0; }
            .row { display: flex; justify-content: space-between; margin: 3px 0; }
            .row-top { display: flex; justify-content: space-between; align-items: flex-start; margin: 3px 0; }
            .item-name { flex: 1; padding-right: 8px; }
            .item-qty { width: 24px; text-align: center; }
            .item-price { width: 64px; text-align: right; }
            .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin: 4px 0; }
            .qr-placeholder { width: 80px; height: 80px; border: 2px solid #000; margin: 8px auto; display: flex; align-items: center; justify-content: center; font-size: 8px; text-align: center; }
            .tag { border: 1px solid #000; padding: 2px 6px; display: inline-block; font-size: 10px; margin: 2px; }
            @media print {
              body { width: 80mm; }
              @page { margin: 0; size: 80mm auto; }
            }
          </style>
        </head>
        <body>
          ${ref.current.innerHTML}
          <script>window.onload = function() { window.print(); }</script>
        </body>
      </html>
    `)
    printWindow.document.close()
  }

  const handleDownload = (type) => {
    const ref = type === 'customer' ? customerRef : waiterRef
    const html = `
      <html>
        <head>
          <title>${type === 'customer' ? 'Customer Receipt' : 'Waiter Copy'} - ${orderRef}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; background: #fff; width: 80mm; padding: 4mm; }
            .center { text-align: center; }
            .bold { font-weight: bold; }
            .large { font-size: 15px; }
            .xlarge { font-size: 18px; }
            .small { font-size: 10px; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            .divider-solid { border-top: 2px solid #000; margin: 6px 0; }
            .row { display: flex; justify-content: space-between; margin: 3px 0; }
            .row-top { display: flex; justify-content: space-between; align-items: flex-start; margin: 3px 0; }
            .item-name { flex: 1; padding-right: 8px; }
            .item-qty { width: 24px; text-align: center; }
            .item-price { width: 64px; text-align: right; }
            .total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 14px; margin: 4px 0; }
          </style>
        </head>
        <body>${ref.current.innerHTML}</body>
      </html>
    `
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${type === 'customer' ? 'receipt' : 'waiter-copy'}-${orderRef}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const subtotal = items.reduce((sum, i) => sum + (i.total_price || 0) + (i.extra_charge || 0), 0)
  const vatRate = 0.075 // 7.5% Nigerian VAT
  const vatAmount = subtotal * vatRate
  const total = subtotal + vatAmount

  // QR code URL — links to customer order view
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=80x80&data=${encodeURIComponent(`${window.location.origin}/order/${order.id}`)}&color=000000&bgcolor=ffffff`

  return (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">

        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50 shrink-0">
          <h3 className="font-bold text-gray-900 text-lg">Receipt — {orderRef}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="flex flex-1 overflow-hidden">

          {/* Customer Receipt */}
          <div className="flex-1 flex flex-col border-r border-gray-200">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Customer Receipt</span>
              <div className="flex gap-2">
                <button onClick={() => handlePrint('customer')}
                  className="flex items-center gap-1 text-xs bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
                  <Printer size={12} /> Print
                </button>
                <button onClick={() => handleDownload('customer')}
                  className="flex items-center gap-1 text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-300 transition-colors">
                  <Download size={12} /> Save
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-white flex justify-center">
              {/* Hidden ref div — actual receipt content */}
              <div ref={customerRef} style={{ fontFamily: "'Courier New', monospace", fontSize: '12px', width: '72mm', color: '#000', background: '#fff' }}>

                {/* Header */}
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '2px' }}>BEESHOP'S PLACE</div>
                  <div style={{ fontSize: '11px', marginTop: '2px' }}>Lounge & Restaurant</div>
                  <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>— — — — — — — — — — — —</div>
                </div>

                {/* Order info */}
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                    <span>Ref:</span><span style={{ fontWeight: 'bold' }}>{orderRef}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                    <span>Date:</span><span>{formatDate(order.created_at)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                    <span>Time:</span><span>{formatTime(order.created_at)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                    <span>Table:</span><span>{table?.name || order.order_type === 'takeaway' ? `Takeaway${order.customer_name ? ` — ${order.customer_name}` : ''}` : 'Counter'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                    <span>Served by:</span><span>{staffName}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                    <span>Payment:</span><span>{paymentLabel[order.payment_method] || order.payment_method}</span>
                  </div>
                </div>

                {/* Divider */}
                <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

                {/* Column headers */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', fontWeight: 'bold', marginBottom: '4px' }}>
                  <span style={{ flex: 1 }}>ITEM</span>
                  <span style={{ width: '24px', textAlign: 'center' }}>QTY</span>
                  <span style={{ width: '48px', textAlign: 'right' }}>PRICE</span>
                  <span style={{ width: '64px', textAlign: 'right' }}>TOTAL</span>
                </div>

                <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />

                {/* Items */}
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '3px 0', alignItems: 'flex-start' }}>
                    <span style={{ flex: 1, paddingRight: '4px', wordBreak: 'break-word' }}>{item.menu_items?.name || item.name}</span>
                    <span style={{ width: '24px', textAlign: 'center' }}>{item.quantity}</span>
                    <span style={{ width: '48px', textAlign: 'right' }}>₦{item.unit_price?.toLocaleString()}</span>
                    <span style={{ width: '64px', textAlign: 'right' }}>₦{item.total_price?.toLocaleString()}</span>
                  </div>
                ))}

                <div style={{ borderTop: '2px solid #000', margin: '6px 0' }} />

                {/* Totals */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '3px 0' }}>
                  <span>Subtotal</span>
                  <span>₦{subtotal.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '3px 0' }}>
                  <span>VAT (7.5%)</span>
                  <span>₦{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '14px', margin: '4px 0' }}>
                  <span>TOTAL</span>
                  <span>₦{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div style={{ fontSize: '9px', color: '#666', margin: '2px 0' }}>
                  VAT Reg: [Your TIN Number]
                </div>

                {order.notes && (
                  <div style={{ fontSize: '10px', marginTop: '6px', color: '#444' }}>
                    Note: {order.notes}
                  </div>
                )}

                <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

                {/* QR Code */}
                <div style={{ textAlign: 'center', margin: '8px 0' }}>
                  <img src={qrUrl} alt="QR" style={{ width: '80px', height: '80px', display: 'block', margin: '0 auto' }} />
                  <div style={{ fontSize: '9px', marginTop: '4px', color: '#666' }}>Scan to review your order</div>
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '8px 0' }} />

                {/* Footer */}
                <div style={{ textAlign: 'center', fontSize: '10px', lineHeight: '1.6' }}>
                  <div>Thank you for visiting!</div>
                  <div style={{ color: '#666' }}>Please come again 🙏</div>
                  <div style={{ marginTop: '4px', fontSize: '9px', color: '#888' }}>Powered by RestaurantOS</div>
                </div>

                <div style={{ marginTop: '16px' }} />
              </div>
            </div>
          </div>

          {/* Waiter Copy */}
          <div className="flex-1 flex flex-col">
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between shrink-0">
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Waiter Copy</span>
              <div className="flex gap-2">
                <button onClick={() => handlePrint('waiter')}
                  className="flex items-center gap-1 text-xs bg-black text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
                  <Printer size={12} /> Print
                </button>
                <button onClick={() => handleDownload('waiter')}
                  className="flex items-center gap-1 text-xs bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-300 transition-colors">
                  <Download size={12} /> Save
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-white flex justify-center">
              <div ref={waiterRef} style={{ fontFamily: "'Courier New', monospace", fontSize: '12px', width: '72mm', color: '#000', background: '#fff' }}>

                {/* Waiter Header — no branding */}
                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '13px', fontWeight: 'bold' }}>ORDER SUMMARY</div>
                  <div style={{ fontSize: '10px', color: '#444' }}>INTERNAL USE ONLY</div>
                  <div style={{ fontSize: '10px', color: '#444', marginTop: '2px' }}>— — — — — — — —</div>
                </div>

                {/* Order info — minimal */}
                <div style={{ marginBottom: '6px' }}>
                  {[
                    ['Ref', orderRef],
                    ['Date', formatDate(order.created_at)],
                    ['Time', formatTime(order.created_at)],
                    ['Table', table?.name || (order.order_type === 'takeaway' ? `Takeaway${order.customer_name ? ` — ${order.customer_name}` : ''}` : 'Counter')],
                    ['Staff', staffName],
                    ['Payment', paymentLabel[order.payment_method] || order.payment_method],
                  ].map(([label, value]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                      <span>{label}:</span><span style={{ fontWeight: 'bold' }}>{value}</span>
                    </div>
                  ))}
                </div>

                <div style={{ borderTop: '1px dashed #000', margin: '6px 0' }} />

                {/* Items — no prices */}
                <div style={{ fontWeight: 'bold', fontSize: '10px', marginBottom: '4px' }}>ITEMS ORDERED</div>
                {items.map((item, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', margin: '4px 0' }}>
                    <span style={{ flex: 1 }}>{item.menu_items?.name || item.name}</span>
                    <span style={{ fontWeight: 'bold' }}>x{item.quantity}</span>
                  </div>
                ))}

                <div style={{ borderTop: '2px solid #000', margin: '6px 0' }} />

                {/* Total */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                  <span>Subtotal</span><span>₦{subtotal.toLocaleString()}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', margin: '2px 0' }}>
                  <span>VAT (7.5%)</span><span>₦{vatAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div style={{ borderTop: '1px solid #000', margin: '3px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: '13px' }}>
                  <span>TOTAL CHARGED</span>
                  <span>₦{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>

                {order.notes && (
                  <div style={{ fontSize: '10px', marginTop: '6px', padding: '4px', border: '1px dashed #000' }}>
                    NOTE: {order.notes}
                  </div>
                )}

                <div style={{ borderTop: '1px dashed #000', margin: '10px 0' }} />

                {/* Signature line */}
                <div style={{ fontSize: '10px', marginTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '16px' }}>
                    <div style={{ borderTop: '1px solid #000', width: '45%', paddingTop: '3px', textAlign: 'center', fontSize: '9px' }}>Waitron</div>
                    <div style={{ borderTop: '1px solid #000', width: '45%', paddingTop: '3px', textAlign: 'center', fontSize: '9px' }}>Manager</div>
                  </div>
                </div>

                <div style={{ marginTop: '16px' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end shrink-0">
          <button onClick={onClose} className="bg-gray-900 text-white px-6 py-2 rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}