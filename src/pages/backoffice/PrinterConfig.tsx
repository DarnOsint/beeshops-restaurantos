import { useState, useEffect } from 'react'
import { ArrowLeft, Printer, Save, Wifi, WifiOff, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import { setPrintServerUrl, isNetworkPrinterAvailable } from '../../lib/networkPrinter'

interface Props {
  onBack: () => void
}

export default function PrinterConfig({ onBack }: Props) {
  const toast = useToast()
  const [serverUrl, setServerUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)

  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'print_server_url')
      .single()
      .then(({ data }) => {
        if (data?.value) {
          setServerUrl(data.value)
          setPrintServerUrl(data.value)
        }
      })
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const { error } = await supabase
        .from('settings')
        .upsert(
          { id: 'print_server_url', value: serverUrl.trim(), updated_at: new Date().toISOString() },
          { onConflict: 'id' }
        )
      if (error) throw error
      if (serverUrl.trim()) {
        setPrintServerUrl(serverUrl.trim())
      }
      toast.success('Printer settings saved')
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    if (serverUrl.trim()) {
      setPrintServerUrl(serverUrl.trim())
    }
    const available = await isNetworkPrinterAvailable()
    setTestResult(available ? 'success' : 'fail')
    setTesting(false)
  }

  return (
    <div className="min-h-full bg-gray-950 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <div className="max-w-lg">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Printer size={20} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">Printer Configuration</h2>
            <p className="text-gray-400 text-sm">Network thermal printer settings</p>
          </div>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          {/* How it works */}
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">How it works</p>
            <ul className="text-gray-400 text-xs space-y-1.5">
              <li>• Receipts always print via browser print dialog (guaranteed)</li>
              <li>
                • If a network print server is configured, receipts also print on your thermal
                printer automatically
              </li>
              <li>
                • The print server must be running on your local network (e.g. a Raspberry Pi or PC
                connected to the thermal printer)
              </li>
              <li>• Leave empty to use browser printing only</li>
            </ul>
          </div>

          {/* URL Input */}
          <div>
            <label className="block text-sm text-gray-400 mb-1.5">Print Server URL</label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.100:6543"
              className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-600"
            />
            <p className="text-gray-500 text-xs mt-1.5">
              The URL of your local print server (including port). Example:
              http://192.168.1.100:6543
            </p>
          </div>

          {/* Test Connection */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleTest}
              disabled={testing || !serverUrl.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 border border-gray-700 text-white rounded-xl text-sm hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Wifi size={14} />}
              {testing ? 'Testing...' : 'Test Connection'}
            </button>

            {testResult === 'success' && (
              <span className="flex items-center gap-1.5 text-green-400 text-sm">
                <Wifi size={14} /> Connected — printer is reachable
              </span>
            )}
            {testResult === 'fail' && (
              <span className="flex items-center gap-1.5 text-red-400 text-sm">
                <WifiOff size={14} /> Not reachable — check URL and ensure server is running
              </span>
            )}
          </div>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* USB/Bluetooth thermal printer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mt-4">
          <p className="text-gray-300 text-sm font-medium mb-2">USB / Bluetooth Thermal Printer</p>
          <p className="text-gray-400 text-xs">
            If your thermal printer is connected via USB or Bluetooth, use the WebSerial print
            button in the receipt dialog. It connects directly to the printer without needing a
            print server. Supported on Chrome and Edge on desktop.
          </p>
        </div>
      </div>
    </div>
  )
}
