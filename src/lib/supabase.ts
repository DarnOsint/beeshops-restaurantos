import { createClient } from '@supabase/supabase-js'
import { getAuditPerformer } from './auditContext'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// Primary client used by the app
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
// Secondary client used only for audit writes (prevents recursion)
export const auditClient = createClient(supabaseUrl, supabaseAnonKey)

// Monkey-patch mutation methods to auto-log into audit_log
const originalFrom = supabase.from.bind(supabase)

supabase.from = ((table: string) => {
  const query = originalFrom(table)

  const wrap =
    (method: 'insert' | 'update' | 'delete') =>
    async (...args: any[]) => {
      const result = await (query as any)[method](...args)
      // Avoid logging audit table itself or failed operations
      if (!result?.error && table !== 'audit_log') {
        try {
          await auditClient.from('audit_log').insert({
            action: method.toUpperCase(),
            entity: table,
            entity_name: Array.isArray(args[0]) ? undefined : (args[0]?.name ?? null),
            new_value: method === 'delete' ? null : (args[0] ?? null),
            old_value: null,
            performed_by: getAuditPerformer()?.id ?? null,
            performed_by_name: getAuditPerformer()?.full_name ?? null,
            performed_by_role: getAuditPerformer()?.role ?? null,
          })
        } catch (e) {
          console.warn('Auto-audit failed:', e)
        }
      }
      return result
    }

  return {
    ...query,
    insert: wrap('insert'),
    update: wrap('update'),
    delete: wrap('delete'),
  }
}) as typeof supabase.from
