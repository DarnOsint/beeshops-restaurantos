import { useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleLogin = async (e) => {
  e.preventDefault()
  setLoading(true)
  setError(null)

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password
  })

  if (error) {
    setError(error.message)
    setLoading(false)
  } else {
    window.location.href = '/dashboard'
  }
}

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo Area */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-amber-500 mb-4">
            <span className="text-3xl">🍺</span>
          </div>
          <h1 className="text-3xl font-bold text-white">Beeshop's Place</h1>
          <p className="text-gray-400 mt-1">Restaurant Operating System</p>
        </div>

        {/* Login Card */}
        <div className="bg-gray-900 rounded-2xl p-8 shadow-2xl border border-gray-800">
          <h2 className="text-xl font-semibold text-white mb-6">Sign in to continue</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg p-3 mb-6 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@beeshops.com"
                required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-2">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg px-4 py-3 focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/50 text-black font-semibold rounded-lg px-4 py-3 transition-colors"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-600 text-sm mt-6">
          RestaurantOS v1.0 — Beeshop's Place Lounge
        </p>
      </div>
    </div>
  )
}