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
  const query: any = originalFrom(table)

  const wrap = (method: 'insert' | 'update' | 'delete') => {
    const original = query[method]?.bind(query)
    if (!original) return
    query[method] = async (...args: any[]) => {
      const result = await original(...args)
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
  }

  wrap('insert')
  wrap('update')
  wrap('delete')

  return query
}) as typeof supabase.from
