import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from 'react'
import { supabase } from '../lib/supabase'
import { audit } from '../lib/audit'
import type { Profile } from '../types'
import type { User } from '@supabase/supabase-js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
  mfaRequired: boolean
  mfaVerified: boolean
  setMfaVerified: (value: boolean) => void
}

interface MfaStorage {
  verified: boolean
  expiry: number
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMEOUT_MS = 60 * 60 * 1000 // 60 minutes
const ACTIVITY_EVENTS = [
  'mousedown',
  'mousemove',
  'keydown',
  'touchstart',
  'scroll',
  'click',
] as const
const MFA_ROLES = ['owner', 'manager', 'executive', 'accountant'] as const

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue>({} as AuthContextValue)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── MFA state ──────────────────────────────────────────────────────────────

  const getMfaVerified = (): boolean => {
    try {
      const stored = localStorage.getItem('mfa_verified')
      if (!stored) return false
      const { verified, expiry } = JSON.parse(stored) as MfaStorage
      return verified && Date.now() < expiry
    } catch {
      return false
    }
  }

  const [mfaVerified, setMfaVerifiedState] = useState<boolean>(getMfaVerified)

  const setMfaVerified = (value: boolean): void => {
    if (value) {
      const expiry = new Date()
      expiry.setHours(23, 59, 59, 999)
      localStorage.setItem(
        'mfa_verified',
        JSON.stringify({ verified: true, expiry: expiry.getTime() } satisfies MfaStorage)
      )
    } else {
      localStorage.removeItem('mfa_verified')
    }
    setMfaVerifiedState(value)
  }

  // ── Session timeout ────────────────────────────────────────────────────────

  const doSignOut = useCallback(async (reason: 'timeout' | 'manual' = 'timeout') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setMfaVerifiedState(false)
    // Only clear MFA on explicit sign-out — timeout re-login should not re-trigger OTP
    if (reason === 'manual') {
      localStorage.removeItem('mfa_verified')
    }

    const pinSession = localStorage.getItem('pin_session')
    if (pinSession) {
      localStorage.removeItem('pin_session')
      setUser(null)
      setProfile(null)
      window.location.href = '/login?reason=' + reason
      return
    }

    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    if (reason === 'timeout') window.location.href = '/login?reason=timeout'
  }, [])

  const resetTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (localStorage.getItem('pin_session') || sessionStorage.getItem('auth_active')) {
      timeoutRef.current = setTimeout(() => doSignOut('timeout'), TIMEOUT_MS)
    }
  }, [doSignOut])

  useEffect(() => {
    if (!user) return
    sessionStorage.setItem('auth_active', '1')
    resetTimer()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer))
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      sessionStorage.removeItem('auth_active')
    }
  }, [user, resetTimer])

  // ── Auth init ──────────────────────────────────────────────────────────────

  const fetchProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (!error) setProfile(data as Profile)
    setLoading(false)
  }, [])

  useEffect(() => {
    // PIN session (staff roles)
    const pinSession = localStorage.getItem('pin_session')
    if (pinSession) {
      try {
        const parsed = JSON.parse(pinSession) as Profile & { logged_in_at: string }
        const hoursSince = (Date.now() - new Date(parsed.logged_in_at).getTime()) / 3_600_000
        if (hoursSince < 12) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setProfile(parsed)
          setUser({ id: parsed.id, pin_session: true } as unknown as User)
          setLoading(false)
          return
        } else {
          localStorage.removeItem('pin_session')
        }
      } catch {
        localStorage.removeItem('pin_session')
      }
    }

    // Email session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (localStorage.getItem('pin_session')) return
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signOut = async () => {
    void audit({
      action: 'LOGOUT',
      entity: 'auth',
      entityName: profile?.full_name ?? undefined,
      newValue: { reason: 'manual' },
      performer: profile as import('../types').Profile,
    })
    doSignOut('manual')
  }

  const mfaRequired = !!(
    profile &&
    (MFA_ROLES as readonly string[]).includes(profile.role) &&
    !(user as (User & { pin_session?: boolean }) | null)?.pin_session &&
    !mfaVerified
  )

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, signOut, mfaRequired, mfaVerified, setMfaVerified }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
