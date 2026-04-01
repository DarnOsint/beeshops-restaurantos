import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeft, Save, RotateCcw, Circle, Square, ZoomIn, ZoomOut, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import {
  type TableLayout,
  type ZoneBounds,
  type FloorPlanData,
  ZONE_COLORS,
  DEFAULT_ZONE_COLOR,
  CANVAS_W,
  CANVAS_H,
  GRID_SIZE,
  getZoneColor,
  parseFloorPlanData,
} from '../../lib/floorPlanTypes'

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

const DEFAULT_SIZE = { w: 80, h: 80 }
const MIN_SIZE = 40

function snapToGrid(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE
}

// Default zone boundary positions (quadrants)
const DEFAULT_ZONE_BOUNDS: Record<string, ZoneBounds> = {
  Outdoor: { x: 20, y: 20, w: 560, h: 370 },
  Indoor: { x: 620, y: 20, w: 560, h: 370 },
  'VIP Lounge': { x: 20, y: 410, w: 560, h: 370 },
  'The Nook': { x: 620, y: 410, w: 560, h: 370 },
}

type DragTarget = { type: 'table'; id: string } | { type: 'zone'; name: string } | null

type ResizeTarget = { type: 'table'; id: string } | { type: 'zone'; name: string } | null

export default function FloorPlan({ onBack }: Props) {
  const toast = useToast()
  const canvasRef = useRef<HTMLDivElement>(null)

  const [tables, setTables] = useState<TableRow[]>([])
  const [zones, setZones] = useState<Zone[]>([])
  const [tableLayouts, setTableLayouts] = useState<Record<string, TableLayout>>({})
  const [zoneBounds, setZoneBounds] = useState<Record<string, ZoneBounds>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [filterZone, setFilterZone] = useState('All')

  // Use refs for drag/resize interaction so mousemove always sees latest values
  // (useState + useCallback creates stale closures that miss the first frames)
  const dragTargetRef = useRef<DragTarget>(null)
  const resizeTargetRef = useRef<ResizeTarget>(null)
  const dragOffsetRef = useRef({ x: 0, y: 0 })
  const [, forceRender] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const [tablesRes, zonesRes, layoutRes] = await Promise.all([
        supabase.from('tables').select('*, table_categories(id, name)').order('name'),
        supabase.from('table_categories').select('id, name').order('name'),
        supabase.from('settings').select('value').eq('id', 'floor_plan_layout').single(),
      ])
      const tbls = (tablesRes.data || []) as TableRow[]
      const zns = (zonesRes.data || []) as Zone[]
      setTables(tbls)
      setZones(zns)

      const saved = parseFloorPlanData(layoutRes.data?.value)

      // Ensure every table has a layout entry
      const merged: Record<string, TableLayout> = {}
      let col = 0
      let row = 0
      for (const t of tbls) {
        if (saved.tables[t.id]) {
          merged[t.id] = saved.tables[t.id]
        } else {
          merged[t.id] = { x: 40 + col * 120, y: 40 + row * 120, ...DEFAULT_SIZE, shape: 'rect' }
          col++
          if (col > 8) {
            col = 0
            row++
          }
        }
      }
      setTableLayouts(merged)

      // Ensure every zone has bounds
      const mergedZones: Record<string, ZoneBounds> = {}
      for (const z of zns) {
        mergedZones[z.name] = saved.zones[z.name] ||
          DEFAULT_ZONE_BOUNDS[z.name] || {
            x: 20,
            y: 20,
            w: 400,
            h: 300,
          }
      }
      setZoneBounds(mergedZones)
      setLoading(false)
    }
    load()
  }, [])

  const getMousePos = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom }
    },
    [zoom]
  )

  const handleMouseDown = (e: React.MouseEvent, target: DragTarget, isResize: boolean) => {
    e.stopPropagation()
    e.preventDefault()
    const pos = getMousePos(e)

    if (isResize) {
      resizeTargetRef.current = target
    } else {
      dragTargetRef.current = target
      if (target?.type === 'table') {
        const l = tableLayouts[target.id]
        if (l) dragOffsetRef.current = { x: pos.x - l.x, y: pos.y - l.y }
      } else if (target?.type === 'zone') {
        const b = zoneBounds[target.name]
        if (b) dragOffsetRef.current = { x: pos.x - b.x, y: pos.y - b.y }
      }
    }
    if (target?.type === 'table') setSelectedId(target.id)
    forceRender((n) => n + 1)
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const drag = dragTargetRef.current
    const resize = resizeTargetRef.current
    if (!drag && !resize) return
    const pos = getMousePos(e)
    const offset = dragOffsetRef.current

    if (drag?.type === 'table') {
      setTableLayouts((prev) => {
        const l = prev[drag.id]
        if (!l) return prev
        return {
          ...prev,
          [drag.id]: {
            ...l,
            x: snapToGrid(Math.max(0, Math.min(CANVAS_W - l.w, pos.x - offset.x))),
            y: snapToGrid(Math.max(0, Math.min(CANVAS_H - l.h, pos.y - offset.y))),
          },
        }
      })
    } else if (drag?.type === 'zone') {
      setZoneBounds((prev) => {
        const b = prev[drag.name]
        if (!b) return prev
        return {
          ...prev,
          [drag.name]: {
            ...b,
            x: snapToGrid(Math.max(0, Math.min(CANVAS_W - b.w, pos.x - offset.x))),
            y: snapToGrid(Math.max(0, Math.min(CANVAS_H - b.h, pos.y - offset.y))),
          },
        }
      })
    }

    if (resize?.type === 'table') {
      setTableLayouts((prev) => {
        const l = prev[resize.id]
        if (!l) return prev
        return {
          ...prev,
          [resize.id]: {
            ...l,
            w: snapToGrid(Math.max(MIN_SIZE, pos.x - l.x)),
            h: snapToGrid(Math.max(MIN_SIZE, pos.y - l.y)),
          },
        }
      })
    } else if (resize?.type === 'zone') {
      setZoneBounds((prev) => {
        const b = prev[resize.name]
        if (!b) return prev
        return {
          ...prev,
          [resize.name]: {
            ...b,
            w: snapToGrid(Math.max(120, pos.x - b.x)),
            h: snapToGrid(Math.max(80, pos.y - b.y)),
          },
        }
      })
    }
  }

  const handleMouseUp = () => {
    dragTargetRef.current = null
    resizeTargetRef.current = null
    forceRender((n) => n + 1)
  }

  const toggleShape = (tableId: string) => {
    setTableLayouts((prev) => {
      const l = prev[tableId]
      if (!l) return prev
      return { ...prev, [tableId]: { ...l, shape: l.shape === 'rect' ? 'circle' : 'rect' } }
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const data: FloorPlanData = { tables: tableLayouts, zones: zoneBounds }
      const { error } = await supabase.from('settings').upsert(
        {
          id: 'floor_plan_layout',
          value: JSON.stringify(data),
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
    const fresh: Record<string, TableLayout> = {}
    let col = 0
    let row = 0
    for (const t of tables) {
      fresh[t.id] = { x: 40 + col * 120, y: 40 + row * 120, ...DEFAULT_SIZE, shape: 'rect' }
      col++
      if (col > 8) {
        col = 0
        row++
      }
    }
    setTableLayouts(fresh)
    const freshZones: Record<string, ZoneBounds> = {}
    for (const z of zones) {
      freshZones[z.name] = DEFAULT_ZONE_BOUNDS[z.name] || { x: 20, y: 20, w: 400, h: 300 }
    }
    setZoneBounds(freshZones)
    setSelectedId(null)
    toast.success('Layout reset — save to apply')
  }

  const filteredTables =
    filterZone === 'All' ? tables : tables.filter((t) => t.table_categories?.name === filterZone)

  if (loading) {
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={24} />
      </div>
    )
  }

  const isDragging = dragTargetRef.current !== null || resizeTargetRef.current !== null

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
            Drag zone areas and tables to match your real layout. Resize with corner handles.
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
                {tableLayouts[selectedId]?.shape === 'rect' ? (
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
          {/* Zone boundary areas — rendered first (behind tables) */}
          {Object.entries(zoneBounds).map(([zoneName, bounds]) => {
            if (filterZone !== 'All' && filterZone !== zoneName) return null
            const c = ZONE_COLORS[zoneName] || DEFAULT_ZONE_COLOR
            return (
              <div
                key={`zone-${zoneName}`}
                style={{
                  position: 'absolute',
                  left: bounds.x * zoom,
                  top: bounds.y * zoom,
                  width: bounds.w * zoom,
                  height: bounds.h * zoom,
                  background: c.fill,
                  border: `${1.5 * zoom}px dashed ${c.stroke}40`,
                  borderRadius: 16 * zoom,
                  zIndex: 0,
                  cursor:
                    dragTargetRef.current?.type === 'zone' &&
                    dragTargetRef.current.name === zoneName
                      ? 'grabbing'
                      : 'grab',
                }}
                onMouseDown={(e) => handleMouseDown(e, { type: 'zone', name: zoneName }, false)}
              >
                {/* Zone label */}
                <span
                  style={{
                    position: 'absolute',
                    top: 8 * zoom,
                    left: 12 * zoom,
                    color: c.text,
                    fontSize: Math.max(11, 14 * zoom),
                    fontWeight: 700,
                    opacity: 0.7,
                    pointerEvents: 'none',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  {zoneName}
                </span>
                {/* Zone resize handle */}
                <div
                  onMouseDown={(e) => handleMouseDown(e, { type: 'zone', name: zoneName }, true)}
                  style={{
                    position: 'absolute',
                    right: -4 * zoom,
                    bottom: -4 * zoom,
                    width: 14 * zoom,
                    height: 14 * zoom,
                    background: c.stroke,
                    borderRadius: 3 * zoom,
                    cursor: 'nwse-resize',
                    border: `${1.5 * zoom}px solid #000`,
                    opacity: 0.6,
                  }}
                />
              </div>
            )
          })}

          {/* Tables — rendered on top */}
          {filteredTables.map((table) => {
            const layout = tableLayouts[table.id]
            if (!layout) return null
            const zoneName = table.table_categories?.name
            const c = getZoneColor(zoneName)
            const isSelected = selectedId === table.id
            const isOccupied = table.status === 'occupied'

            const style: React.CSSProperties = {
              position: 'absolute',
              left: layout.x * zoom,
              top: layout.y * zoom,
              width: layout.w * zoom,
              height: layout.h * zoom,
              borderRadius: layout.shape === 'circle' ? '50%' : 12 * zoom,
              background: isOccupied ? c.stroke : c.fill.replace('0.08', '0.25'),
              border: `${2 * zoom}px solid ${isSelected ? '#f59e0b' : c.stroke}`,
              boxShadow: isSelected ? '0 0 0 3px rgba(245,158,11,0.3)' : 'none',
              cursor:
                dragTargetRef.current?.type === 'table' && dragTargetRef.current.id === table.id
                  ? 'grabbing'
                  : 'grab',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
              transition: isDragging ? 'none' : 'box-shadow 0.15s',
              userSelect: 'none',
            }

            return (
              <div
                key={table.id}
                style={style}
                onMouseDown={(e) => handleMouseDown(e, { type: 'table', id: table.id }, false)}
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
                {isSelected && (
                  <div
                    onMouseDown={(e) => handleMouseDown(e, { type: 'table', id: table.id }, true)}
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
          <span className="text-gray-400 text-xs">Occupied</span>
        </div>
      </div>
    </div>
  )
}
