import { supabase } from './supabase'
import type { AuditParams } from '../types'

export async function audit({
  action,
  entity,
  entityId,
  entityName,
  oldValue,
  newValue,
  performer,
}: AuditParams): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      entity_name: entityName ?? null,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
      performed_by: performer?.id ?? null,
      performed_by_name: performer?.full_name ?? null,
      performed_by_role: performer?.role ?? null,
    })
  } catch (e) {
    // Never crash the app over an audit log failure
    console.warn('Audit log failed:', e)
  }
}
