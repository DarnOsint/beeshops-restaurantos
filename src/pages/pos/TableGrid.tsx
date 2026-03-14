import { useState } from 'react'
import { Users, Lock } from 'lucide-react'

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

interface CategoryStyle {
  bg: string
  border: string
  text: string
  dot: string
}

interface TableGridProps {
  tables: Table[]
  onSelectTable: (table: Table) => void
  selectedTable: Table | null
  assignedTableIds: string[] | null
}

const categoryColors: Record<string, CategoryStyle> = {
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

const CATEGORIES = ['All', 'Outdoor', 'Indoor', 'VIP Lounge', 'The Nook'] as const

export default function TableGrid({
  tables,
  onSelectTable,
  selectedTable,
  assignedTableIds,
  defaultCategory = 'All',
}: TableGridProps & { defaultCategory?: string }) {
  const [activeCategory, setActiveCategory] = useState<string>(defaultCategory)

  const filtered =
    activeCategory === 'All'
      ? tables
      : tables.filter((t) => t.table_categories?.name === activeCategory)

  const grouped = CATEGORIES.slice(1).reduce<Record<string, Table[]>>((acc, cat) => {
    acc[cat] = filtered.filter((t) => t.table_categories?.name === cat)
    return acc
  }, {})

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

      {/* Tables */}
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
                  return (
                    <button
                      key={table.id}
                      onClick={() => (isAssigned ? onSelectTable(table) : undefined)}
                      disabled={!isAssigned}
                      title={!isAssigned ? 'Not assigned to you' : ''}
                      className={`
                        relative p-3 rounded-xl border-2 transition-all text-left
                        ${!isAssigned ? 'opacity-30 cursor-not-allowed grayscale' : ''}
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
                      {isOccupied && (
                        <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-white/50" />
                      )}
                      {!isAssigned && (
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
