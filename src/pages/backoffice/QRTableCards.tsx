import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, RefreshCw } from 'lucide-react'
import { createPDF, savePDF } from '../../lib/pdfExport'

const BASE_URL = 'https://beeshop.place'

interface TableRow {
  id: string
  name: string
  table_categories?: { name?: string } | null
}

declare global {
  interface Window {
    QRCode: new (el: HTMLElement, opts: object) => void & { CorrectLevel: { H: number } }
  }
}

export default function QRTableCards() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [tables, setTables] = useState<TableRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedZone, setSelectedZone] = useState('All')
  const [qrLoaded, setQrLoaded] = useState(false)
  const [exporting, setExporting] = useState(false)
  const scriptRef = useRef(false)

  useEffect(() => {
    if (scriptRef.current) return
    scriptRef.current = true
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    script.onload = () => setQrLoaded(true)
    document.head.appendChild(script)
  }, [])

  useEffect(() => {
    supabase
      .from('tables')
      .select('id, name, table_categories(name)')
      .order('name')
      .then(({ data }) => {
        setTables((data || []) as TableRow[])
        setLoading(false)
      })
  }, [])

  const zones = [
    'All',
    ...new Set(tables.map((t) => t.table_categories?.name).filter(Boolean)),
  ] as string[]
  const filtered =
    selectedZone === 'All'
      ? tables
      : tables.filter((t) => t.table_categories?.name === selectedZone)

  useEffect(() => {
    if (!qrLoaded || tables.length === 0) return
    setTimeout(() => {
      filtered.forEach((table) => {
        const el = document.getElementById(`qr-${table.id}`)
        if (!el || el.innerHTML !== '') return
        try {
          new window.QRCode(el, {
            text: `${BASE_URL}/table/${table.id}`,
            width: 160,
            height: 160,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: (window.QRCode as any).CorrectLevel.H,
          })
        } catch {
          /* intentional */
        }
      })
    }, 150)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrLoaded, tables, selectedZone])

  const waitForQRCodes = useCallback(async (): Promise<boolean> => {
    const deadline = Date.now() + 7000
    while (Date.now() < deadline) {
      const allReady = filtered.every((t) => {
        const el = document.getElementById(`qr-${t.id}`)
        if (!el) return false
        const canvas = el.querySelector('canvas')
        if (canvas) return true
        const img = el.querySelector('img') as HTMLImageElement | null
        return Boolean(img?.src)
      })
      if (allReady) return true

      await new Promise((r) => setTimeout(r, 120))
    }
    return false
  }, [filtered])

  const downloadPDF = useCallback(async () => {
    if (exporting) return
    setExporting(true)
    try {
      await waitForQRCodes()

      const subtitle =
        selectedZone === 'All'
          ? `${filtered.length} tables`
          : `${selectedZone} · ${filtered.length} tables`
      const doc = createPDF('QR Table Cards', subtitle)

      const pageW = 210
      const pageH = 297
      const marginX = 10
      const startY = 35
      const gap = 4
      const cols = 3
      const colW = (pageW - marginX * 2 - gap * (cols - 1)) / cols
      const cardH = 86

      let x = marginX
      let y = startY

      const nextCell = () => {
        x += colW + gap
        if (x + colW > pageW - marginX + 0.1) {
          x = marginX
          y += cardH + gap
        }
        if (y + cardH > pageH - 12) {
          doc.addPage()
          x = marginX
          y = startY
        }
      }

      filtered.forEach((table, idx) => {
        const zone = (table.table_categories?.name || 'Table').toString().toUpperCase()

        doc.setDrawColor(210, 210, 210)
        doc.setLineWidth(0.3)
        doc.rect(x, y, colW, cardH)

        // Header
        doc.setFillColor(26, 26, 46)
        doc.rect(x, y, colW, 18, 'F')
        doc.setTextColor(245, 158, 11)
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(6)
        doc.text(zone.substring(0, 24), x + 3, y + 6)
        doc.setTextColor(255, 255, 255)
        doc.setFontSize(12)
        doc.text(table.name.toString().substring(0, 18), x + 3, y + 14)

        // QR
        const qrEl = document.getElementById(`qr-${table.id}`)
        const canvas = qrEl?.querySelector('canvas') as HTMLCanvasElement | null
        const img = qrEl?.querySelector('img') as HTMLImageElement | null
        const dataUrl = canvas?.toDataURL('image/png') || img?.src

        const qrSize = Math.min(48, colW - 12)
        const qrX = x + (colW - qrSize) / 2
        const qrY = y + 22

        if (dataUrl) {
          try {
            doc.addImage(dataUrl, 'PNG', qrX, qrY, qrSize, qrSize)
          } catch {
            // ignore broken images; keep PDF generation going
          }
        } else {
          doc.setTextColor(120, 120, 120)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.text('QR not ready', x + colW / 2, qrY + qrSize / 2, { align: 'center' })
        }

        // Caption + footer
        doc.setTextColor(107, 114, 128)
        doc.setFontSize(6.5)
        doc.setFont('helvetica', 'normal')
        doc.text('Scan to view menu & order', x + colW / 2, y + cardH - 12, { align: 'center' })
        doc.setTextColor(156, 163, 175)
        doc.setFontSize(6)
        doc.text("Beeshop's Place Lounge", x + colW / 2, y + cardH - 5, { align: 'center' })

        // Link label (tiny)
        doc.setTextColor(180, 180, 180)
        doc.setFontSize(5.5)
        doc.text(`${BASE_URL}/table/${table.id}`.substring(0, 36), x + 2.5, y + cardH - 1.8)

        if (idx < filtered.length - 1) nextCell()
      })

      savePDF(doc, `qr-table-cards-${selectedZone.toLowerCase().replace(/\s+/g, '-')}.pdf`)
    } finally {
      setExporting(false)
    }
  }, [exporting, filtered, selectedZone, waitForQRCodes])

  if (!['owner', 'manager', 'executive'].includes(profile?.role || ''))
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center text-gray-400">
        Access denied
      </div>
    )

  return (
    <>
      <style>{`@media print{.no-print{display:none!important}.app-shell-sidebar,.app-shell-topbar{display:none!important}#main-scroll{overflow:visible!important;height:auto!important}#main-scroll .app-shell-main{height:auto!important}.print-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:0!important;padding:0!important}.card{break-inside:avoid;page-break-inside:avoid;border:1.5px solid #ccc!important;margin:6px!important}html,body{background:white!important;height:auto!important;overflow:visible!important}}@media screen{.print-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}}`}</style>
      <div className="min-h-full bg-gray-950">
        <div className="no-print bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-white">
              <ArrowLeft size={20} />
            </button>
            <div>
              <p className="text-white font-bold">QR Table Cards</p>
              <p className="text-gray-500 text-xs">
                {filtered.length} tables · {selectedZone}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={downloadPDF}
              disabled={exporting || loading || filtered.length === 0}
              className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors"
            >
              Download PDF
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors"
            >
              <Printer size={15} /> Print
            </button>
          </div>
        </div>
        <div className="no-print px-4 py-3 flex gap-2 overflow-x-auto">
          {zones.map((z) => (
            <button
              key={z}
              onClick={() => setSelectedZone(z)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-colors ${selectedZone === z ? 'bg-amber-500 text-black' : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              {z}
            </button>
          ))}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw size={24} className="text-amber-500 animate-spin" />
          </div>
        ) : (
          <div className="print-grid p-4">
            {filtered.map((table) => (
              <div
                key={table.id}
                className="card bg-white rounded-2xl overflow-hidden shadow-lg"
                style={{ border: '2px solid #e5e7eb' }}
              >
                <div style={{ background: '#1a1a2e', padding: '12px 16px' }}>
                  <p
                    style={{
                      color: '#f59e0b',
                      fontSize: '10px',
                      fontWeight: 600,
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      margin: 0,
                    }}
                  >
                    {table.table_categories?.name || 'Table'}
                  </p>
                  <p
                    style={{
                      color: '#ffffff',
                      fontSize: '22px',
                      fontWeight: 800,
                      margin: '2px 0 0 0',
                    }}
                  >
                    {table.name}
                  </p>
                </div>
                <div
                  style={{
                    background: '#ffffff',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <div id={`qr-${table.id}`} style={{ width: 160, height: 160 }} />
                  <p style={{ color: '#6b7280', fontSize: '9px', textAlign: 'center', margin: 0 }}>
                    Scan to view menu & order
                  </p>
                </div>
                <div
                  style={{
                    background: '#f9fafb',
                    padding: '8px 16px',
                    borderTop: '1px solid #e5e7eb',
                    textAlign: 'center',
                  }}
                >
                  <p
                    style={{
                      color: '#9ca3af',
                      fontSize: '9px',
                      margin: 0,
                      fontWeight: 600,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                    }}
                  >
                    Beeshop's Place Lounge
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
