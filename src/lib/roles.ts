import type { Role } from '../types'

/** Roles with owner-level access: full dashboard, back office, settings, cross-outlet. */
export const OWNER_LEVEL_ROLES: Role[] = ['owner', 'general_manager']

/** Owner-level plus management. */
export const MANAGEMENT_ROLES: Role[] = [...OWNER_LEVEL_ROLES, 'manager']

/** Roles that may always bypass operational restrictions (tables, clock-in, etc.). */
export const OVERSIGHT_ROLES: Role[] = [...MANAGEMENT_ROLES, 'accountant', 'auditor']

export function isOwnerLevel(role?: string | null): boolean {
  return !!role && OWNER_LEVEL_ROLES.includes(role as Role)
}
