import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Save, RotateCcw, Circle, Square, ZoomIn, ZoomOut, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

interface Props {
  onBack: () => void
}

interface Zone {
  id: string
  name: string
}

interface TableRow {
  id: string
  name: string
  capacity: number
  category_id: string
  status: string
  table_categories?: { id: string; name: string }
}

interface TableLayout {
  x: number
  y: number
  w: number
  h: number
  shape: 'rect' | 'circle'
}

type LayoutMap = Record<string, TableLayout>

const ZONE_COLORS: Record<string, { fill: string; stroke: string; text: string; bg: string }> = {
  Outdoor: {
    fill: 'rgba(34,197,94,0.15)',
    stroke: '#22c55e',
    text: '#4ade80',
    bg: 'bg-green-500',
  },
  Indoor: { fill: 'rgba(59,130,246,0.15)', stroke: '#3b82f6', text: '#60a5fa', bg: 'bg-blue-500' },
  'VIP Lounge': {
    fill: 'rgba(245,158,11,0.15)',
    stroke: '#f59e0b',
    text: '#fbbf24',
    bg: 'bg-amber-500',
  },
  'The Nook': {
    fill: 'rgba(168,85,247,0.15)',
    stroke: '#a855f7',
    text: '#c084fc',
    bg: 'bg-purple-500',
  },
}

const DEFAULT_COLORS = {
  fill: 'rgba(107,114,128,0.15)',
  stroke: '#6b7280',
  text: '#9ca3af',
  bg: 'bg-gray-500',
}

const DEFAULT_SIZE = { w: 80, h: 80 }
const MIN_SIZE = 40
const CANVAS_W = 1200
const CANVAS_H = 800
const GRID_SIZE = 20

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE
}

export default function FloorPlan({ onBack }: Props) {
  const toast = useToast()
  const canvasRef = useRef<HTMLDivElement>(null)

  const [tables, setTables] = useState<TableRow[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [layouts, setLayouts] = useState<LayoutMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [filterZone, setFilterZone] = useState('All')

  // Interaction state
  const [dragId, setDragId] = useState<string | null>(null)
  const [resizeId, setResizeId] = useState<string | null>(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Load tables + saved layout
  useEffect(() => {
    const load = async () => {
      const [tablesRes, zonesRes, layoutRes] = await Promise.all([
        supabase.from('tables').select('*, table_categories(id, name)').order('name'),
        supabase.from('table_categories').select('id, name').order('name'),
        supabase.from('settings').select('value').eq('id', 'floor_plan_layout').single(),
      ])
      const tbls = (tablesRes.data || []) as TableRow[]
      setTables(tbls)
      setZones((zonesRes.data || []) as Zone[])

      // Parse saved layout or generate default grid positions
      let saved: LayoutMap = {}
      if (layoutRes.data?.value) {
        try {
          saved = JSON.parse(layoutRes.data.value) as LayoutMap
        } catch {
          /* corrupt, start fresh */
        }
      }

      // Ensure every table has a layout entry
      const merged: LayoutMap = {}
      let col = 0
      let row = 0
      for (const t of tbls) {
        if (saved[t.id]) {
          merged[t.id] = saved[t.id]
        } else {
          merged[t.id] = {
            x: 40 + col * 120,
            y: 40 + row * 120,
            ...DEFAULT_SIZE,
            shape: 'rect',
          }
          col++
          if (col > 8) {
            col = 0
            row++
          }
        }
      }
      setLayouts(merged)
      setLoading(false)
    }
    load()
  }, [])

  const getMousePos = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return {
        x: (e.clientX - rect.left) / zoom,
        y: (e.clientY - rect.top) / zoom,
      }
    },
    [zoom]
  )

  const handleMouseDown = (e: React.MouseEvent, tableId: string, isResize: boolean) => {
    e.stopPropagation()
    e.preventDefault()
    const pos = getMousePos(e)
    const layout = layouts[tableId]
    if (!layout) return

    if (isResize) {
      setResizeId(tableId)
    } else {
      setDragId(tableId)
      setDragOffset({ x: pos.x - layout.x, y: pos.y - layout.y })
    }
    setSelectedId(tableId)
  }

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragId && !resizeId) return
      const pos = getMousePos(e)

      if (dragId) {
        setLayouts((prev) => {
          const l = prev[dragId]
          if (!l) return prev
          const x = snapToGrid(Math.max(0, Math.min(CANVAS_W - l.w, pos.x - dragOffset.x)))
          const y = snapToGrid(Math.max(0, Math.min(CANVAS_H - l.h, pos.y - dragOffset.y)))
          return { ...prev, [dragId]: { ...l, x, y } }
        })
      }

      if (resizeId) {
        setLayouts((prev) => {
          const l = prev[resizeId]
          if (!l) return prev
          const w = snapToGrid(Math.max(MIN_SIZE, pos.x - l.x))
          const h = snapToGrid(Math.max(MIN_SIZE, pos.y - l.y))
          return { ...prev, [resizeId]: { ...l, w, h } }
        })
      }
    },
    [dragId, resizeId, dragOffset, getMousePos]
  )

  const handleMouseUp = useCallback(() => {
    setDragId(null)
    setResizeId(null)
  }, [])

  const toggleShape = (tableId: string) => {
    setLayouts((prev) => {
      const l = prev[tableId]
      if (!l) return prev
      return { ...prev, [tableId]: { ...l, shape: l.shape === 'rect' ? 'circle' : 'rect' } }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('settings').upsert(
        {
          id: 'floor_plan_layout',
          value: JSON.stringify(layouts),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      if (error) throw error
      toast.success('Floor plan saved')
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    const fresh: LayoutMap = {}
    let col = 0
    let row = 0
    for (const t of tables) {
      fresh[t.id] = {
        x: 40 + col * 120,
        y: 40 + row * 120,
        ...DEFAULT_SIZE,
        shape: 'rect',
      }
      col++
      if (col > 8) {
        col = 0
        row++
      }
    }
    setLayouts(fresh)
    setSelectedId(null)
    toast.success('Layout reset — save to apply')
  }

  const filteredTables =
    filterZone === 'All' ? tables : tables.filter((t) => t.table_categories?.name === filterZone)

  const colors = (zone?: string) => (zone ? ZONE_COLORS[zone] || DEFAULT_COLORS : DEFAULT_COLORS)

  if (loading) {
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={24} />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center gap-3 shrink-0">
        <button onClick={onBack} className="text-gray-400 hover:text-white">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-white font-bold">Floor Plan Editor</h1>
          <p className="text-gray-400 text-xs">
            Drag tables to position them. Drag corners to resize. Click to select, then toggle
            shape.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            className="p-2 bg-gray-800 text-gray-400 hover:text-white rounded-lg"
          >
            <ZoomOut size={16} />
          </button>
          <span className="text-gray-400 text-xs w-12 text-center">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(1.5, z + 0.1))}
            className="p-2 bg-gray-800 text-gray-400 hover:text-white rounded-lg"
          >
            <ZoomIn size={16} />
          </button>
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-xl text-sm transition-colors"
          >
            <RotateCcw size={14} /> Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} /> {saving ? 'Saving...' : 'Save Layout'}
          </button>
        </div>
      </div>

      {/* Zone filter + selected table info */}
      <div className="px-6 py-3 flex items-center gap-3 border-b border-gray-800 shrink-0 overflow-x-auto">
        {['All', ...zones.map((z) => z.name)].map((zone) => (
          <button
            key={zone}
            onClick={() => setFilterZone(zone)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              filterZone === zone
                ? 'bg-amber-500 text-black'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {zone}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-3">
          {selectedId && (
            <>
              <span className="text-gray-500 text-xs">
                Selected: {tables.find((t) => t.id === selectedId)?.name}
              </span>
              <button
                onClick={() => toggleShape(selectedId)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white rounded-lg text-xs transition-colors"
              >
                {layouts[selectedId]?.shape === 'rect' ? (
                  <>
                    <Circle size={12} /> Make Round
                  </>
                ) : (
                  <>
                    <Square size={12} /> Make Square
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-auto p-4">
        <div
          ref={canvasRef}
          className="relative bg-gray-900/50 border border-gray-800 rounded-2xl cursor-crosshair select-none"
          style={{
            width: CANVAS_W * zoom,
            height: CANVAS_H * zoom,
            backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={() => setSelectedId(null)}
        >
          {filteredTables.map((table) => {
            const layout = layouts[table.id]
            if (!layout) return null
            const zoneName = table.table_categories?.name
            const c = colors(zoneName)
            const isSelected = selectedId === table.id
            const isOccupied = table.status === 'occupied'

            const style: React.CSSProperties = {
              position: 'absolute',
              left: layout.x * zoom,
              top: layout.y * zoom,
              width: layout.w * zoom,
              height: layout.h * zoom,
              borderRadius: layout.shape === 'circle' ? '50%' : 12 * zoom,
              background: isOccupied ? c.stroke : c.fill,
              border: `${2 * zoom}px solid ${isSelected ? '#f59e0b' : c.stroke}`,
              boxShadow: isSelected ? '0 0 0 3px rgba(245,158,11,0.3)' : 'none',
              cursor: dragId === table.id ? 'grabbing' : 'grab',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              transition:
                dragId === table.id || resizeId === table.id ? 'none' : 'box-shadow 0.15s',
              userSelect: 'none',
            }

            return (
              <div
                key={table.id}
                style={style}
                onMouseDown={(e) => handleMouseDown(e, table.id, false)}
              >
                <span
                  style={{
                    color: isOccupied ? '#fff' : c.text,
                    fontSize: Math.max(10, 13 * zoom),
                    fontWeight: 700,
                    lineHeight: 1.2,
                    textAlign: 'center',
                    pointerEvents: 'none',
                  }}
                >
                  {table.name}
                </span>
                <span
                  style={{
                    color: isOccupied ? 'rgba(255,255,255,0.7)' : 'rgba(156,163,175,0.8)',
                    fontSize: Math.max(8, 10 * zoom),
                    pointerEvents: 'none',
                  }}
                >
                  {table.capacity} seats
                </span>
                {zoneName && (
                  <span
                    style={{
                      color: isOccupied ? 'rgba(255,255,255,0.5)' : c.text,
                      fontSize: Math.max(7, 9 * zoom),
                      opacity: 0.7,
                      pointerEvents: 'none',
                    }}
                  >
                    {zoneName}
                  </span>
                )}

                {/* Resize handle */}
                {isSelected && (
                  <div
                    onMouseDown={(e) => handleMouseDown(e, table.id, true)}
                    style={{
                      position: 'absolute',
                      right: -4 * zoom,
                      bottom: -4 * zoom,
                      width: 12 * zoom,
                      height: 12 * zoom,
                      background: '#f59e0b',
                      borderRadius: layout.shape === 'circle' ? '50%' : 2 * zoom,
                      cursor: 'nwse-resize',
                      border: `${1.5 * zoom}px solid #000`,
                    }}
                  />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Legend */}
      <div className="px-6 py-3 border-t border-gray-800 flex items-center gap-6 shrink-0">
        {Object.entries(ZONE_COLORS).map(([zone, c]) => (
          <div key={zone} className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-sm" style={{ background: c.stroke }} />
            <span className="text-gray-400 text-xs">{zone}</span>
          </div>
        ))}
        <div className="flex items-center gap-2 ml-4">
          <div className="w-3 h-3 rounded-sm bg-gray-600" />
          <span className="text-gray-400 text-xs">Available</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-sm bg-white/30" />
          <span className="text-gray-400 text-xs">Occupied (filled)</span>
        </div>
      </div>
    </div>
  )
}
