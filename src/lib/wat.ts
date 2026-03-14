// West African Time (WAT) = UTC+1
// All display formatting should use this timezone

export const WAT = 'Africa/Lagos'

export function watDate(date?: string | Date): Date {
  return date ? new Date(date) : new Date()
}

export function fmtWATTime(date: string | Date): string {
  return new Date(date).toLocaleTimeString('en-NG', {
    timeZone: WAT,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function fmtWATDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-NG', {
    timeZone: WAT,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function fmtWATDateTime(date: string | Date): string {
  return new Date(date).toLocaleString('en-NG', {
    timeZone: WAT,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}

export function fmtWATDateFull(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-NG', {
    timeZone: WAT,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// For date-only strings used in DB queries — get today in WAT
export function todayWAT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: WAT }) // YYYY-MM-DD
}

// WAT start/end of day for DB range queries
export function watDayRange(dateStr?: string): { start: Date; end: Date } {
  const base = dateStr
    ? new Date(dateStr + 'T00:00:00+01:00')
    : new Date(new Date().toLocaleDateString('en-CA', { timeZone: WAT }) + 'T00:00:00+01:00')
  const start = new Date(base)
  const end = new Date(base)
  end.setHours(end.getHours() + 24)
  return { start, end }
}
