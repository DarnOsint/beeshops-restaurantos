// Shared types and constants for floor plan (editor + POS view)

export interface TableLayout {
  x: number
  y: number
  w: number
  h: number
  shape: 'rect' | 'circle'
}

export interface ZoneBounds {
  x: number
  y: number
  w: number
  h: number
}

export interface FloorPlanData {
  tables: Record<string, TableLayout>
  zones: Record<string, ZoneBounds>
}

export const ZONE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  Outdoor: { fill: 'rgba(34,197,94,0.08)', stroke: '#22c55e', text: '#4ade80' },
  Indoor: { fill: 'rgba(59,130,246,0.08)', stroke: '#3b82f6', text: '#60a5fa' },
  'VIP Lounge': { fill: 'rgba(245,158,11,0.08)', stroke: '#f59e0b', text: '#fbbf24' },
  'The Nook': { fill: 'rgba(168,85,247,0.08)', stroke: '#a855f7', text: '#c084fc' },
}

export const ZONE_FILL_OCCUPIED: Record<string, string> = {
  Outdoor: '#22c55e',
  Indoor: '#3b82f6',
  'VIP Lounge': '#f59e0b',
  'The Nook': '#a855f7',
}

export const DEFAULT_ZONE_COLOR = {
  fill: 'rgba(107,114,128,0.08)',
  stroke: '#6b7280',
  text: '#9ca3af',
}

export const CANVAS_W = 1200
export const CANVAS_H = 800
export const GRID_SIZE = 20

export function getZoneColor(zone?: string) {
  return zone ? ZONE_COLORS[zone] || DEFAULT_ZONE_COLOR : DEFAULT_ZONE_COLOR
}

export function parseFloorPlanData(raw: string | null | undefined): FloorPlanData {
  if (!raw) return { tables: {}, zones: {} }
  try {
    const parsed = JSON.parse(raw)
    // Backwards compat: old format was just a flat Record<string, TableLayout>
    if (parsed.tables) return parsed as FloorPlanData
    return { tables: parsed as Record<string, TableLayout>, zones: {} }
  } catch {
    return { tables: {}, zones: {} }
  }
}
