import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { Hash, Mail, Eye, EyeOff, Delete } from 'lucide-react'

// Rate limit config
const EMAIL_MAX_ATTEMPTS = 5
const EMAIL_LOCKOUT_MS = 15 * 60 * 1000   // 15 minutes
const PIN_MAX_ATTEMPTS = 5
const PIN_LOCKOUT_MS = 5 * 60 * 1000       // 5 minutes

function getRateState(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null')
  } catch { return null }
}

function setRateState(key, state) {
  sessionStorage.setItem(key, JSON.stringify(state))
}

function isLockedOut(state, lockoutMs) {
  if (!state || state.attempts < (state.max || 5)) return false
  return (Date.now() - state.lockedAt) < lockoutMs
}

function getLockoutRemaining(state, lockoutMs) {
  if (!state?.lockedAt) return 0
  return Math.max(0, Math.ceil((lockoutMs - (Date.now() - state.lockedAt)) / 1000))
}

function recordAttempt(key, max) {
  const state = getRateState(key) || { attempts: 0, max }
  state.attempts += 1
  if (state.attempts >= max) state.lockedAt = Date.now()
  setRateState(key, state)
  return state
}

function resetAttempts(key) {
  sessionStorage.removeItem(key)
}

function useLockoutTimer(lockedOut, remaining, setRemaining) {
  const timer = useRef(null)
  useEffect(() => {
    if (!lockedOut || remaining <= 0) return
    timer.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 1) { clearInterval(timer.current); return 0 }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(timer.current)
  }, [lockedOut])
}

export default function Login() {
  const [mode, setMode] = useState('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  // Rate limit state
  const [emailRemaining, setEmailRemaining] = useState(() => {
    const s = getRateState('rl_email')
    return isLockedOut(s, EMAIL_LOCKOUT_MS) ? getLockoutRemaining(s, EMAIL_LOCKOUT_MS) : 0
  })
  const [pinRemaining, setPinRemaining] = useState(() => {
    const s = getRateState('rl_pin')
    return isLockedOut(s, PIN_LOCKOUT_MS) ? getLockoutRemaining(s, PIN_LOCKOUT_MS) : 0
  })

  const emailLocked = emailRemaining > 0
  const pinLocked = pinRemaining > 0

  useLockoutTimer(emailLocked, emailRemaining, setEmailRemaining)
  useLockoutTimer(pinLocked, pinRemaining, setPinRemaining)

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return m > 0 ? `${m}m ${s}s` : `${s}s`
  }

  const handleEmailLogin = async (e) => {
    e.preventDefault()
    if (emailLocked) return

    const state = getRateState('rl_email')
    if (isLockedOut(state, EMAIL_LOCKOUT_MS)) {
      const rem = getLockoutRemaining(state, EMAIL_LOCKOUT_MS)
      setEmailRemaining(rem)
      setError(`Too many failed attempts. Try again in ${formatTime(rem)}.`)
      return
    }

    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      const newState = recordAttempt('rl_email', EMAIL_MAX_ATTEMPTS)
      if (newState.attempts >= EMAIL_MAX_ATTEMPTS) {
        const rem = getLockoutRemaining(newState, EMAIL_LOCKOUT_MS)
        setEmailRemaining(rem)
        setError(`Too many failed attempts. Locked out for ${formatTime(rem)}.`)
      } else {
        const left = EMAIL_MAX_ATTEMPTS - newState.attempts
        setError(`${error.message} — ${left} attempt${left !== 1 ? 's' : ''} remaining.`)
      }
      setLoading(false)
    } else {
      resetAttempts('rl_email')
      window.location.href = '/dashboard'
    }
  }

  const handlePinLogin = async (enteredPin) => {
    if (enteredPin.length !== 4) return
    if (pinLocked) return

    const state = getRateState('rl_pin')
    if (isLockedOut(state, PIN_LOCKOUT_MS)) {
      const rem = getLockoutRemaining(state, PIN_LOCKOUT_MS)
      setPinRemaining(rem)
      setPin('')
      setError(`Too many failed attempts. Try again in ${formatTime(rem)}.`)
      return
    }

    setLoading(true)
    setError(null)

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('pin', enteredPin)
      .eq('is_active', true)
      .single()

    if (error || !data) {
      const newState = recordAttempt('rl_pin', PIN_MAX_ATTEMPTS)
      if (newState.attempts >= PIN_MAX_ATTEMPTS) {
        const rem = getLockoutRemaining(newState, PIN_LOCKOUT_MS)
        setPinRemaining(rem)
        setError(`Too many failed attempts. Locked out for ${formatTime(rem)}.`)
      } else {
        const left = PIN_MAX_ATTEMPTS - newState.attempts
        setError(`Invalid PIN. ${left} attempt${left !== 1 ? 's' : ''} remaining.`)
      }
      setPin('')
      setLoading(false)
      return
    }

    resetAttempts('rl_pin')
    localStorage.setItem('pin_session', JSON.stringify({
      id: data.id,
      full_name: data.full_name,
      role: data.role,
      email: data.email,
      pin: data.pin,
      logged_in_at: new Date().toISOString()
    }))
    window.location.href = '/dashboard'
  }

  const handlePinPress = (digit) => {
    if (pin.length >= 4 || loading || pinLocked) return
    const newPin = pin + digit
    setPin(newPin)
    setError(null)
    if (newPin.length === 4) handlePinLogin(newPin)
  }

  const handlePinDelete = () => {
    setPin(prev => prev.slice(0, -1))
    setError(null)
  }

  const pinPad = [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['', '0', 'del'],
  ]

  return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-500 mb-4">
            <span className="text-3xl">🍺</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Beeshop's Place</h1>
          <p className="text-gray-400 mt-1">Restaurant Operating System</p>
        </div>

        <div className="flex bg-gray-900 border border-gray-800 rounded-2xl p-1 mb-6">
          <button
            onClick={() => { setMode('email'); setError(null); setPin('') }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${mode === 'email' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
          >
            <Mail size={15} /> Email Login
          </button>
          <button
            onClick={() => { setMode('pin'); setError(null) }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all ${mode === 'pin' ? 'bg-amber-500 text-black' : 'text-gray-400 hover:text-white'}`}
          >
            <Hash size={15} /> PIN Login
          </button>
        </div>

        <div className="bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 mb-6 text-sm">
              {error}
            </div>
          )}

          {mode === 'email' && (
            <>
              <h2 className="text-xl font-semibold text-white mb-2">Sign in</h2>
              <p className="text-gray-500 text-sm mb-6">For managers, owners and accountants</p>

              {emailLocked ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">🔒</span>
                  </div>
                  <p className="text-red-400 font-semibold mb-1">Account Locked</p>
                  <p className="text-gray-500 text-sm">Try again in <span className="text-white font-mono">{formatTime(emailRemaining)}</span></p>
                </div>
              ) : (
                <form onSubmit={handleEmailLogin} className="space-y-5">
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Email Address</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="you@beeshops.com"
                      required
                      className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-400 mb-2">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="••••••••"
                        required
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-3 pr-11 focus:outline-none focus:border-amber-500 transition-colors"
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-black font-semibold rounded-xl px-4 py-3 transition-colors"
                  >
                    {loading ? 'Signing in...' : 'Sign In'}
                  </button>
                </form>
              )}
            </>
          )}

          {mode === 'pin' && (
            <>
              <h2 className="text-xl font-semibold text-white mb-2">Enter PIN</h2>
              <p className="text-gray-500 text-sm mb-6">For waitrons, kitchen, bar and grill staff</p>

              {pinLocked ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                    <span className="text-2xl">🔒</span>
                  </div>
                  <p className="text-red-400 font-semibold mb-1">PIN Entry Locked</p>
                  <p className="text-gray-500 text-sm">Try again in <span className="text-white font-mono">{formatTime(pinRemaining)}</span></p>
                </div>
              ) : (
                <>
                  <div className="flex justify-center gap-4 mb-8">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className={`w-14 h-14 rounded-2xl border-2 flex items-center justify-center transition-all ${
                        pin.length > i ? 'border-amber-500 bg-amber-500/10' : 'border-gray-700 bg-gray-800'
                      }`}>
                        {pin.length > i && <div className="w-4 h-4 rounded-full bg-amber-500" />}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3">
                    {pinPad.map((row, ri) => (
                      <div key={ri} className="grid grid-cols-3 gap-3">
                        {row.map((digit, di) => (
                          <button
                            key={di}
                            onClick={() => digit === 'del' ? handlePinDelete() : digit !== '' ? handlePinPress(digit) : null}
                            disabled={loading || digit === ''}
                            className={`h-16 rounded-2xl text-xl font-bold transition-all ${
                              digit === ''
                                ? 'opacity-0 pointer-events-none'
                                : digit === 'del'
                                ? 'bg-gray-800 border border-gray-700 text-gray-400 hover:bg-gray-700 hover:text-white active:scale-95'
                                : 'bg-gray-800 border border-gray-700 text-white hover:bg-gray-700 hover:border-amber-500/50 active:scale-95'
                            }`}
                          >
                            {digit === 'del' ? <Delete size={20} className="mx-auto" /> : digit}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>

                  {loading && (
                    <div className="text-center mt-6 text-amber-500 text-sm">Verifying PIN...</div>
                  )}

                  <button
                    onClick={() => { setPin(''); setError(null) }}
                    className="w-full mt-4 text-gray-500 hover:text-gray-300 text-sm transition-colors"
                  >
                    Clear
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <p className="text-center text-gray-600 text-sm mt-6">
          RestaurantOS v1.0 — Beeshop's Place Lounge
        </p>
      </div>
    </div>
  )
}
