import { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

// Inactivity timeout — 30 minutes for all roles
const TIMEOUT_MS = 30 * 60 * 1000
// Events that reset the inactivity timer
const ACTIVITY_EVENTS = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'click']

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const timeoutRef = useRef(null)

  const getMfaVerified = () => {
    try {
      const stored = localStorage.getItem('mfa_verified')
      if (!stored) return false
      const { verified, expiry } = JSON.parse(stored)
      return verified && Date.now() < expiry
    } catch {
      return false
    }
  }
  const [mfaVerified, setMfaVerifiedState] = useState(getMfaVerified)

  const setMfaVerified = (value) => {
    if (value) {
      const expiry = new Date()
      expiry.setHours(23, 59, 59, 999)
      localStorage.setItem(
        'mfa_verified',
        JSON.stringify({ verified: true, expiry: expiry.getTime() })
      )
    } else {
      localStorage.removeItem('mfa_verified')
    }
    setMfaVerifiedState(value)
  }

  // ── Session timeout ──────────────────────────────────────────────────────

  const doSignOut = useCallback(async (reason = 'timeout') => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setMfaVerifiedState(false)
    localStorage.removeItem('mfa_verified')
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
    // Only set timeout if user is logged in
    if (localStorage.getItem('pin_session') || sessionStorage.getItem('auth_active')) {
      timeoutRef.current = setTimeout(() => doSignOut('timeout'), TIMEOUT_MS)
    }
  }, [doSignOut])

  // Attach activity listeners when user is logged in
  useEffect(() => {
    if (!user) return
    // Mark session active for the timer check
    sessionStorage.setItem('auth_active', '1')
    resetTimer()
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }))
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer))
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      sessionStorage.removeItem('auth_active')
    }
  }, [user, resetTimer])

  // ── Auth init ────────────────────────────────────────────────────────────

  const fetchProfile = useCallback(async (userId) => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (!error) setProfile(data)
    setLoading(false)
  }, [])

  useEffect(() => {
    // Check for PIN session first
    const pinSession = localStorage.getItem('pin_session')
    if (pinSession) {
      try {
        const parsed = JSON.parse(pinSession)
        const hoursSince = (Date.now() - new Date(parsed.logged_in_at).getTime()) / (1000 * 60 * 60)
        if (hoursSince < 12) {
          setProfile(parsed)
          setUser({ id: parsed.id, pin_session: true })
          setLoading(false)
          return
        } else {
          localStorage.removeItem('pin_session')
        }
      } catch {
        localStorage.removeItem('pin_session')
      }
    }

    // Otherwise check Supabase Auth session (email login)
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
  }, [])

  const signOut = async () => doSignOut('manual')

  const MFA_ROLES = ['owner', 'manager', 'executive', 'accountant']
  const mfaRequired = !!(
    profile &&
    MFA_ROLES.includes(profile.role) &&
    !user?.pin_session &&
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

export const useAuth = () => useContext(AuthContext)
