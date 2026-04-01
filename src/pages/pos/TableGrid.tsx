import { useState, useEffect, useRef } from 'react'
import { Users, Lock } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import {
  type TableLayout,
  type ZoneBounds,
  ZONE_COLORS,
  ZONE_FILL_OCCUPIED,
  DEFAULT_ZONE_COLOR,
  CANVAS_W,
  CANVAS_H,
  getZoneColor,
  parseFloorPlanData,
} from '../../lib/floorPlanTypes'

interface TableCategory {
  id: string
  name: string
}

interface Table {
  id: string
  name: string
  capacity?: number
  category_id?: string
  status: 'available' | 'occupied' | string
  table_categories?: TableCategory
}

interface TableGridProps {
  tables: Table[]
  onSelectTable: (table: Table) => void
  selectedTable: Table | null
  assignedTableIds: string[] | null
  tableStaffMap?: Record<string, string>
  currentStaffId?: string | null
  currentRole?: string | null
}

const BYPASS_ROLES = ['owner', 'manager', 'accountant', 'supervisor']

const CATEGORIES = ['All', 'Outdoor', 'Indoor', 'VIP Lounge', 'The Nook'] as const

export default function TableGrid({
  tables,
  onSelectTable,
  selectedTable,
  assignedTableIds,
  defaultCategory = 'All',
  tableStaffMap = {},
  currentStaffId = null,
  currentRole = null,
}: TableGridProps & { defaultCategory?: string }) {
  const [activeCategory, setActiveCategory] = useState<string>(defaultCategory)
  const [tableLayouts, setTableLayouts] = useState<Record<string, TableLayout>>({})
  const [zoneBounds, setZoneBounds] = useState<Record<string, ZoneBounds>>({})
  const [hasLayout, setHasLayout] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)

  // Load saved floor plan layout
  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'floor_plan_layout')
      .single()
      .then(({ data }) => {
        const parsed = parseFloorPlanData(data?.value)
        if (Object.keys(parsed.tables).length > 0) {
          setTableLayouts(parsed.tables)
          setZoneBounds(parsed.zones)
          setHasLayout(true)
        }
      })
  }, [])

  // Measure container for responsive scaling
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const scale = containerWidth > 0 ? Math.min(1, containerWidth / CANVAS_W) : 0.5

  const filtered =
    activeCategory === 'All'
      ? tables
      : tables.filter((t) => t.table_categories?.name === activeCategory)

  // Floor plan view
  if (hasLayout) {
    return (
      <div className="flex flex-col h-full">
        {/* Category Filter */}
        <div className="flex gap-2 p-4 overflow-x-auto border-b border-gray-800">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? 'bg-amber-500 text-black'
                  : 'bg-gray-800 text-gray-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-2" ref={containerRef}>
          <div
            className="relative mx-auto select-none"
            style={{
              width: CANVAS_W * scale,
              height: CANVAS_H * scale,
            }}
          >
            {/* Zone boundaries */}
            {Object.entries(zoneBounds).map(([zoneName, bounds]) => {
              if (activeCategory !== 'All' && activeCategory !== zoneName) return null
              const c = ZONE_COLORS[zoneName] || DEFAULT_ZONE_COLOR
              return (
                <div
                  key={`zone-${zoneName}`}
                  style={{
                    position: 'absolute',
                    left: bounds.x * scale,
                    top: bounds.y * scale,
                    width: bounds.w * scale,
                    height: bounds.h * scale,
                    background: c.fill,
                    border: `${1.5 * scale}px dashed ${c.stroke}40`,
                    borderRadius: 14 * scale,
                    zIndex: 0,
                    pointerEvents: 'none',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 6 * scale,
                      left: 10 * scale,
                      color: c.text,
                      fontSize: Math.max(9, 12 * scale),
                      fontWeight: 700,
                      opacity: 0.5,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                    }}
                  >
                    {zoneName}
                  </span>
                </div>
              )
            })}

            {/* Tables */}
            {filtered.map((table) => {
              const layout = tableLayouts[table.id]
              if (!layout) return null
              const zoneName = table.table_categories?.name || ''
              const c = getZoneColor(zoneName)
              const isOccupied = table.status === 'occupied'
              const isSelected = selectedTable?.id === table.id
              const isAssigned = assignedTableIds === null || assignedTableIds.includes(table.id)

              const servingStaffId = tableStaffMap[table.id]
              const canBypass = currentRole && BYPASS_ROLES.includes(currentRole)
              const isOtherWaitronTable =
                isOccupied &&
                servingStaffId &&
                currentStaffId &&
                servingStaffId !== currentStaffId &&
                !canBypass
              const isClickable = isAssigned && !isOtherWaitronTable

              const occupiedFill = ZONE_FILL_OCCUPIED[zoneName] || c.stroke

              return (
                <button
                  key={table.id}
                  onClick={() => (isClickable ? onSelectTable(table) : undefined)}
                  disabled={!isClickable}
                  title={
                    isOtherWaitronTable
                      ? 'Being served by another waitron'
                      : !isAssigned
                        ? 'Not assigned to you'
                        : `${table.name} — ${table.capacity} seats`
                  }
                  style={{
                    position: 'absolute',
                    left: layout.x * scale,
                    top: layout.y * scale,
                    width: layout.w * scale,
                    height: layout.h * scale,
                    borderRadius: layout.shape === 'circle' ? '50%' : 10 * scale,
                    background: isOccupied ? occupiedFill : c.fill.replace('0.08', '0.2'),
                    border: `${2 * scale}px solid ${isSelected ? '#f59e0b' : c.stroke}`,
                    boxShadow: isSelected ? `0 0 0 ${3 * scale}px rgba(245,158,11,0.4)` : 'none',
                    zIndex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: isClickable ? 'pointer' : 'not-allowed',
                    opacity: isClickable ? 1 : 0.3,
                    filter: isClickable ? 'none' : 'grayscale(1)',
                    transition: 'box-shadow 0.15s, opacity 0.15s',
                    padding: 0,
                  }}
                >
                  <span
                    style={{
                      color: isOccupied ? '#fff' : c.text,
                      fontSize: Math.max(9, 12 * scale),
                      fontWeight: 700,
                      lineHeight: 1.2,
                      textAlign: 'center',
                    }}
                  >
                    {table.name}
                  </span>
                  <span
                    style={{
                      color: isOccupied ? 'rgba(255,255,255,0.7)' : 'rgba(156,163,175,0.7)',
                      fontSize: Math.max(7, 9 * scale),
                      display: 'flex',
                      alignItems: 'center',
                      gap: 2 * scale,
                    }}
                  >
                    <Users size={Math.max(7, 9 * scale)} />
                    {table.capacity}
                  </span>
                  {isOtherWaitronTable && (
                    <Lock
                      size={Math.max(8, 10 * scale)}
                      style={{
                        position: 'absolute',
                        top: 3 * scale,
                        right: 3 * scale,
                        color: '#f87171',
                      }}
                    />
                  )}
                  {!isAssigned && !isOtherWaitronTable && (
                    <Lock
                      size={Math.max(7, 9 * scale)}
                      style={{
                        position: 'absolute',
                        top: 3 * scale,
                        right: 3 * scale,
                        color: '#6b7280',
                      }}
                    />
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // Fallback: original grid view (no floor plan saved yet)
  const categoryColors: Record<string, { bg: string; border: string; text: string; dot: string }> =
    {
      Outdoor: {
        bg: 'bg-green-500/10',
        border: 'border-green-500/30',
        text: 'text-green-400',
        dot: 'bg-green-500',
      },
      Indoor: {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        text: 'text-blue-400',
        dot: 'bg-blue-500',
      },
      'VIP Lounge': {
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/30',
        text: 'text-amber-400',
        dot: 'bg-amber-500',
      },
      'The Nook': {
        bg: 'bg-purple-500/10',
        border: 'border-purple-500/30',
        text: 'text-purple-400',
        dot: 'bg-purple-500',
      },
    }
  const occupiedColors: Record<string, string> = {
    Outdoor: 'bg-green-500',
    Indoor: 'bg-blue-500',
    'VIP Lounge': 'bg-amber-500',
    'The Nook': 'bg-purple-500',
  }
  const grouped = CATEGORIES.slice(1).reduce<Record<string, Table[]>>((acc, cat) => {
    acc[cat] = filtered.filter((t) => t.table_categories?.name === cat)
    return acc
  }, {})

  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-2 p-4 overflow-x-auto border-b border-gray-800">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? 'bg-amber-500 text-black'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {Object.entries(grouped).map(([category, categoryTables]) => {
          if (categoryTables.length === 0) return null
          const colors = categoryColors[category]
          return (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-2 h-2 rounded-full ${colors?.dot}`} />
                <h3 className={`text-sm font-semibold ${colors?.text}`}>{category}</h3>
                <span className="text-gray-600 text-xs">
                  ({categoryTables.filter((t) => t.status === 'occupied').length}/
                  {categoryTables.length} occupied)
                </span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {categoryTables.map((table) => {
                  const isOccupied = table.status === 'occupied'
                  const isSelected = selectedTable?.id === table.id
                  const isAssigned =
                    assignedTableIds === null || assignedTableIds.includes(table.id)
                  const occupiedColor = occupiedColors[category]
                  const servingStaffId = tableStaffMap[table.id]
                  const canBypass = currentRole && BYPASS_ROLES.includes(currentRole)
                  const isOtherWaitronTable =
                    isOccupied &&
                    servingStaffId &&
                    currentStaffId &&
                    servingStaffId !== currentStaffId &&
                    !canBypass
                  const isClickable = isAssigned && !isOtherWaitronTable

                  return (
                    <button
                      key={table.id}
                      onClick={() => (isClickable ? onSelectTable(table) : undefined)}
                      disabled={!isClickable}
                      title={
                        isOtherWaitronTable
                          ? 'Being served by another waitron'
                          : !isAssigned
                            ? 'Not assigned to you'
                            : ''
                      }
                      className={`
                        relative p-3 rounded-xl border-2 transition-all text-left
                        ${!isClickable ? 'opacity-30 cursor-not-allowed grayscale' : ''}
                        ${isSelected ? 'ring-2 ring-amber-500 ring-offset-2 ring-offset-gray-950' : ''}
                        ${
                          isOccupied
                            ? `${occupiedColor} border-transparent text-white`
                            : `${colors?.bg} ${colors?.border} hover:border-opacity-60`
                        }
                      `}
                    >
                      <p
                        className={`text-xs font-bold ${isOccupied ? 'text-white' : colors?.text}`}
                      >
                        {table.name}
                      </p>
                      <div
                        className={`flex items-center gap-1 mt-1 ${isOccupied ? 'text-white/80' : 'text-gray-500'}`}
                      >
                        <Users size={10} />
                        <span className="text-xs">{table.capacity}</span>
                      </div>
                      {isOccupied && !isOtherWaitronTable && (
                        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/50" />
                      )}
                      {isOtherWaitronTable && (
                        <div className="absolute top-1 right-1">
                          <Lock size={8} className="text-red-400" />
                        </div>
                      )}
                      {!isAssigned && !isOtherWaitronTable && (
                        <div className="absolute top-1 right-1">
                          <Lock size={8} className="text-gray-500" />
                        </div>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
