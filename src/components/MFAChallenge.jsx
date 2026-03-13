import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { ShieldCheck, Smartphone, ArrowLeft, Loader } from 'lucide-react'

export default function MFAChallenge({ user, profile, onVerified, onSignOut }) {
  const [method, setMethod] = useState('totp')
  const [step, setStep] = useState('pick')
  const [code, setCode] = useState('')
  const [qrCode, setQrCode] = useState(null)
  const [factorId, setFactorId] = useState(null)
  const [challengeId, setChallengeId] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const startTOTP = async () => {
    setLoading(true); setError('')
    const { data: factors } = await supabase.auth.mfa.listFactors()
    const verified = factors?.totp?.find(f => f.status === 'verified')
    const unverified = factors?.totp?.filter(f => f.status !== 'verified') || []

    // Clean up any unverified/dangling factors first
    for (const f of unverified) {
      await supabase.auth.mfa.unenroll({ factorId: f.id })
    }

    if (verified) {
      // Already enrolled — just challenge
      const { data, error } = await supabase.auth.mfa.challenge({ factorId: verified.id })
      if (error) { setError(error.message); setLoading(false); return }
      setFactorId(verified.id)
      setChallengeId(data.id)
      setStep('verify')
    } else {
      // Fresh enroll
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'BeeshopOS' })
      if (error) { setError(error.message); setLoading(false); return }
      setFactorId(data.id)
      setQrCode(data.totp.qr_code)
      setStep('enroll_totp')
    }
    setLoading(false)
  }

  const confirmTOTPEnroll = async () => {
    if (code.length !== 6) return
    setLoading(true); setError('')
    const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId })
    if (challengeErr) { setError(challengeErr.message); setLoading(false); return }
    const { error: verifyErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challengeData.id, code })
    if (verifyErr) {
      // Unenroll the failed factor so user can retry cleanly
      await supabase.auth.mfa.unenroll({ factorId })
      setError('Invalid code. Please try again.')
      setCode('')
      setLoading(false)
      // Restart enrollment fresh
      setTimeout(() => startTOTP(), 500)
      return
    }
    setLoading(false)
    onVerified()
  }

const verifyTOTP = async () => {
    if (code.length !== 6) return
    setLoading(true); setError('')
    const { error } = await supabase.auth.mfa.verify({ factorId, challengeId, code })
    if (error) { setError('Invalid code. Try again.'); setCode(''); setLoading(false); return }
    setLoading(false)
    onVerified()
  }

return (
    <div className="min-h-full bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 mb-4">
            <ShieldCheck size={28} className="text-amber-400" />
          </div>
          <h1 className="text-white font-bold text-xl">Two-Factor Authentication</h1>
          <p className="text-gray-500 text-sm mt-1">Extra security required for {profile?.role}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 space-y-4">

          {/* Step: Pick method */}
          {step === 'pick' && (
            <>
              <p className="text-gray-400 text-sm text-center mb-2">Use your authenticator app to verify</p>
              <button onClick={startTOTP} disabled={loading}
                className="w-full flex items-center gap-4 bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-amber-500/40 rounded-xl p-4 transition-all text-left">
                <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center shrink-0">
                  <Smartphone size={18} className="text-amber-400" />
                </div>
                <div>
                  <p className="text-white font-semibold text-sm">Authenticator App</p>
                  <p className="text-gray-500 text-xs">Google Authenticator, Authy, etc.</p>
                </div>
              </button>

              {loading && <div className="text-center text-amber-500 text-sm flex items-center justify-center gap-2"><Loader size={14} className="animate-spin" /> Please wait...</div>}
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
            </>
          )}

          {/* Step: Enroll TOTP — show QR */}
          {step === 'enroll_totp' && (
            <>
              <button onClick={() => { setStep('pick'); setCode(''); setError('') }} className="flex items-center gap-1 text-gray-500 hover:text-white text-xs mb-2">
                <ArrowLeft size={12} /> Back
              </button>
              <p className="text-white font-semibold text-sm text-center">Scan with your authenticator app</p>
              <p className="text-gray-500 text-xs text-center mb-3">Open Google Authenticator or Authy, tap + and scan this QR code</p>
              {qrCode && (
                <div className="flex justify-center">
                  <img src={qrCode} alt="TOTP QR Code" className="w-48 h-48 rounded-xl border border-gray-700" />
                </div>
              )}
              <div>
                <label className="text-gray-400 text-xs block mb-1">Enter the 6-digit code to confirm</label>
                <input type="number" value={code} onChange={e => setCode(e.target.value.slice(0,6))}
                  placeholder="000000" maxLength={6}
                  className="w-full bg-gray-800 border border-gray-700 text-white text-center text-2xl font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 tracking-widest" />
              </div>
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
              <button onClick={confirmTOTPEnroll} disabled={code.length !== 6 || loading}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 transition-colors">
                {loading ? 'Verifying...' : 'Confirm & Continue'}
              </button>
            </>
          )}

          {/* Step: Verify */}
          {step === 'verify' && (
            <>
              <button onClick={() => { setStep('pick'); setCode(''); setError('') }} className="flex items-center gap-1 text-gray-500 hover:text-white text-xs mb-2">
                <ArrowLeft size={12} /> Back
              </button>
              <p className="text-white font-semibold text-sm text-center">
                {method === 'totp' ? 'Enter code from your app' : `Check your email`}
              </p>
              <p className="text-gray-500 text-xs text-center mb-3">
                {method === 'email' ? `A 6-digit code was sent to ${user?.email}` : 'Enter the current 6-digit code from your authenticator app'}
              </p>
              <input type="number" value={code} onChange={e => setCode(e.target.value.slice(0,6))}
                placeholder="000000" maxLength={6}
                className="w-full bg-gray-800 border border-gray-700 text-white text-center text-2xl font-bold rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 tracking-widest" />
              {error && <p className="text-red-400 text-xs text-center">{error}</p>}
              <button onClick={verifyTOTP} disabled={code.length !== 6 || loading}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 disabled:text-gray-500 text-black font-bold rounded-xl py-3 transition-colors">
                {loading ? 'Verifying...' : 'Verify'}
              </button>

            </>
          )}

        </div>

        <button onClick={onSignOut} className="w-full mt-4 text-gray-600 hover:text-gray-400 text-xs transition-colors">
          Sign out and use a different account
        </button>
      </div>
    </div>
  )
}
