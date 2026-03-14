import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { verifyPin, hashPin, isPinHashed } from '../lib/pinHash'
import { sendPushToStaff } from '../hooks/usePushNotifications'
import { ShieldAlert } from 'lucide-react'

interface Approver {
  id: string
  name: string
  role: string
}
interface Props {
  onApproved: (approver: Approver) => void
  onCancel: () => void
  voidDescription: string
}

export default function VoidPinModal({ onApproved, onCancel, voidDescription }: Props) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    supabase
      .from('profiles')
      .select('id')
      .in('role', ['owner', 'manager'])
      .eq('is_active', true)
      .then(({ data }) => {
        data?.forEach((m) => sendPushToStaff(m.id, '🚨 Void Approval Needed', voidDescription))
      })
  }, [voidDescription])

  const handleDigit = (d: string) => {
    if (pin.length < 4) setPin((p) => p + d)
  }
  const handleBackspace = () => setPin((p) => p.slice(0, -1))

  const handleSubmit = async () => {
    if (pin.length !== 4) return
    setChecking(true)
    setError('')
    // Fetch all manager/owner approval PINs and verify client-side (supports hashing)
    const { data: managers, error: err } = await supabase
      .from('profiles')
      .select('id, full_name, role, approval_pin')
      .in('role', ['owner', 'manager'])
      .eq('is_active', true)
      .not('approval_pin', 'is', null)

    let data = null
    if (!err && managers) {
      for (const m of managers) {
        if (m.approval_pin && (await verifyPin(pin, m.approval_pin))) {
          data = m
          break
        }
      }
    }
    setChecking(false)
    if (err || !data) {
      setError('Invalid PIN. Manager approval required.')
      setPin('')
      return
    }
    // Auto-upgrade plain-text approval_pin to PBKDF2 on successful use
    if (data.approval_pin && !isPinHashed(data.approval_pin)) {
      void hashPin(pin).then((hashed) => {
        supabase.from('profiles').update({ approval_pin: hashed }).eq('id', data.id)
      })
    }
    onApproved({ id: data.id, name: data.full_name, role: data.role })
  }

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫']

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-red-500/30 rounded-2xl w-full max-w-xs p-6 space-y-5">
        <div className="text-center space-y-1">
          <div className="flex justify-center">
            <ShieldAlert size={28} className="text-red-400" />
          </div>
          <h2 className="text-white font-bold text-lg">Manager Approval</h2>
          <p className="text-gray-400 text-xs">{voidDescription}</p>
        </div>
        <div className="flex justify-center gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-4 h-4 rounded-full border-2 ${pin.length > i ? 'bg-red-400 border-red-400' : 'border-gray-600'}`}
            />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {digits.map((d, i) => (
            <button
              key={i}
              onClick={() =>
                d === '⌫' ? handleBackspace() : d !== '' ? handleDigit(d) : undefined
              }
              disabled={d === ''}
              className={`h-12 rounded-xl text-lg font-bold transition-colors ${
                d === ''
                  ? 'invisible'
                  : d === '⌫'
                    ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                    : 'bg-gray-800 text-white hover:bg-gray-700 active:bg-gray-600'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        {error && <p className="text-red-400 text-xs text-center">{error}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onCancel}
            className="py-3 rounded-xl bg-gray-800 text-gray-300 hover:bg-gray-700 font-medium text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={pin.length !== 4 || checking}
            className="py-3 rounded-xl bg-red-500 hover:bg-red-400 disabled:bg-gray-700 text-white font-bold text-sm"
          >
            {checking ? 'Checking...' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}
