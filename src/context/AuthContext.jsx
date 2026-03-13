import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const getMfaVerified = () => {
  try {
    const stored = localStorage.getItem("mfa_verified")
    if (!stored) return false
    const { verified, expiry } = JSON.parse(stored)
    return verified && Date.now() < expiry
  } catch { return false }
}
const [mfaVerified, setMfaVerifiedState] = useState(getMfaVerified)

const setMfaVerified = (value) => {
  if (value) {
    const expiry = new Date()
    expiry.setHours(23, 59, 59, 999)
    localStorage.setItem("mfa_verified", JSON.stringify({ verified: true, expiry: expiry.getTime() }))
  } else {
    localStorage.removeItem("mfa_verified")
  }
  setMfaVerifiedState(value)
}

  useEffect(() => {
    // Check for PIN session first
    const pinSession = localStorage.getItem('pin_session')
    if (pinSession) {
      try {
        const parsed = JSON.parse(pinSession)
        // Validate session is not older than 12 hours
        const loggedInAt = new Date(parsed.logged_in_at)
        const hoursSince = (Date.now() - loggedInAt.getTime()) / (1000 * 60 * 60)
        if (hoursSince < 12) {
          setProfile(parsed)
          setUser({ id: parsed.id, pin_session: true })
          setLoading(false)
          return
        } else {
          // Expired — clear it
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        // Ignore auth changes if we're in a PIN session
        if (localStorage.getItem('pin_session')) return
        setUser(session?.user ?? null)
        if (session?.user) fetchProfile(session.user.id)
        else {
          setProfile(null)
          setLoading(false)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    if (!error) setProfile(data)
    setLoading(false)
  }

  const signOut = async () => {
    setMfaVerified(false)
    const pinSession = localStorage.getItem('pin_session')
    if (pinSession) {
      localStorage.removeItem('pin_session')
      setUser(null)
      setProfile(null)
      window.location.href = '/login'
      return
    }
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
  }

  const MFA_ROLES = ['owner', 'manager', 'executive', 'accountant']
  const mfaRequired = !!(profile && MFA_ROLES.includes(profile.role) && !user?.pin_session && !mfaVerified)

  return (
    <AuthContext.Provider value={{ user, profile, loading, signOut, mfaRequired, mfaVerified, setMfaVerified }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)