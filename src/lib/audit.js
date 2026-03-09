
import { supabase } from './supabase'

export const audit = async ({ action, entity, entityId, entityName, oldValue, newValue, performer }) => {
  try {
    await supabase.from('audit_log').insert({
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      entity_name: entityName || null,
      old_value: oldValue || null,
      new_value: newValue || null,
      performed_by: performer?.id || null,
      performed_by_name: performer?.full_name || performer?.name || null,
      performed_by_role: performer?.role || null,
    })
  } catch (e) {
    // Never crash the app over an audit log failure
    console.warn('Audit log failed:', e)
  }
}
