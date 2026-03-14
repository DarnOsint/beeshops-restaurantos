import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Printer, RefreshCw } from 'lucide-react'

const BASE_URL = 'https://beeshops-restaurantos.vercel.app'

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

  if (!['owner', 'manager', 'executive'].includes(profile?.role || ''))
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center text-gray-400">
        Access denied
      </div>
    )

  return (
    <>
      <style>{`@media print{.no-print{display:none!important}.print-grid{display:grid!important;grid-template-columns:repeat(3,1fr)!important;gap:0!important;padding:0!important}.card{break-inside:avoid;page-break-inside:avoid;border:1.5px solid #ccc!important;margin:6px!important}body{background:white!important}}@media screen{.print-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}}`}</style>
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
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            <Printer size={15} /> Print
          </button>
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
