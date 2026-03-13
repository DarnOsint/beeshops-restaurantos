// ── Accounting-local types ─────────────────────────────────────────────────
// (extends src/types/index.ts — import domain types from there)

import type { PaymentMethod } from '../../types'

export interface AccountingSummary {
  total: number
  cash: number
  card: number
  transfer: number
  orders: number
  avgOrder: number
}

export interface WaitronStat {
  name: string
  orders: number
  revenue: number
}

export interface TrendPoint {
  day: string
  revenue: number
  orders: number
}

export interface LedgerEntry {
  id: string
  date: string
  type: 'credit' | 'debit'
  description: string
  ref: string
  debit: number
  credit: number
  balance: number
  method: PaymentMethod | string | null
  staff: string | null
}

export interface PayoutRow {
  id: string
  amount: number
  reason: string
  category: string
  paid_to: string | null
  created_at: string
  profiles?: { full_name: string } | null
}

export interface TillSession {
  id: string
  opening_float: number
  closing_float: number | null
  expected_cash: number | null
  status: 'open' | 'closed'
  opened_at: string
  profiles?: { full_name: string } | null
}

export interface TimesheetEntry {
  id: string
  staff_name: string
  role: string
  date: string
  clock_in: string
  clock_out: string | null
  duration_minutes: number | null
}

export interface AuditEntry {
  id: string
  action: string
  entity: string
  entity_name?: string | null
  performed_by_name?: string | null
  performed_by_role?: string | null
  new_value?: Record<string, unknown> | null
  created_at: string
}

export interface VoidEntry {
  id: string
  menu_item_name: string
  quantity: number
  unit_price: number
  total_value: number
  void_type: 'item' | 'order'
  reason: string | null
  approved_by_name: string | null
  voided_by_name: string | null
  created_at: string
}

export interface PayoutForm {
  amount: string
  reason: string
  category: string
  paid_to: string
}
