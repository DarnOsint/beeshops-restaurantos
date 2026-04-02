import { useState, useEffect } from 'react'
import {
  ArrowLeft,
  Printer,
  Save,
  Wifi,
  WifiOff,
  Loader2,
  ChefHat,
  Flame,
  Beer,
  Monitor,
  Copy,
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'
import {
  setPrintServerUrl,
  isNetworkPrinterAvailable,
  setStationPrinterUrl,
  isStationPrinterAvailable,
} from '../../lib/networkPrinter'

interface Props {
  onBack: () => void
}

interface StationPrinter {
  key: string
  label: string
  description: string
  icon: React.ReactNode
  settingId: string
}

const STATIONS: StationPrinter[] = [
  {
    key: 'kitchen',
    label: 'Kitchen Printer',
    description: 'Auto-prints order tickets for kitchen items when orders are placed',
    icon: <ChefHat size={18} className="text-orange-400" />,
    settingId: 'kitchen_printer_url',
  },
  {
    key: 'griller',
    label: 'Griller Printer',
    description: 'Auto-prints order tickets for grill items when orders are placed',
    icon: <Flame size={18} className="text-red-400" />,
    settingId: 'griller_printer_url',
  },
]

export default function PrinterConfig({ onBack }: Props) {
  const toast = useToast()
  const [serverUrl, setServerUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'fail' | null>(null)

  const [stationUrls, setStationUrls] = useState<Record<string, string>>({})
  const [stationTesting, setStationTesting] = useState<Record<string, boolean>>({})
  const [stationTestResults, setStationTestResults] = useState<
    Record<string, 'success' | 'fail' | null>
  >({})
  const [stationSaving, setStationSaving] = useState(false)

  // Station modes: 'display' | 'printer' | 'both'
  const [stationModes, setStationModes] = useState<Record<string, string>>({
    kitchen: 'display',
    griller: 'display',
    bar: 'display',
  })
  const [printCopies, setPrintCopies] = useState<Record<string, number>>({
    kitchen: 2,
    griller: 2,
    bar: 1,
  })
  const [modesSaving, setModesSaving] = useState(false)

  useEffect(() => {
    // Load all printer settings at once
    supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'print_server_url',
        'station_modes',
        'print_copies',
        ...STATIONS.map((s) => s.settingId),
      ])
      .then(({ data }) => {
        if (!data) return
        for (const row of data) {
          if (row.id === 'print_server_url' && row.value) {
            setServerUrl(row.value)
            setPrintServerUrl(row.value)
          }
          if (row.id === 'station_modes' && row.value) {
            try {
              setStationModes((prev) => ({ ...prev, ...JSON.parse(row.value) }))
            } catch {
              /* */
            }
          }
          if (row.id === 'print_copies' && row.value) {
            try {
              setPrintCopies((prev) => ({ ...prev, ...JSON.parse(row.value) }))
            } catch {
              /* */
            }
          }
          const station = STATIONS.find((s) => s.settingId === row.id)
          if (station && row.value) {
            setStationUrls((prev) => ({ ...prev, [station.key]: row.value }))
            setStationPrinterUrl(station.key, row.value)
          }
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

  const handleStationTest = async (station: StationPrinter) => {
    setStationTesting((prev) => ({ ...prev, [station.key]: true }))
    setStationTestResults((prev) => ({ ...prev, [station.key]: null }))
    const url = stationUrls[station.key]?.trim()
    if (url) setStationPrinterUrl(station.key, url)
    const available = await isStationPrinterAvailable(station.key)
    setStationTestResults((prev) => ({ ...prev, [station.key]: available ? 'success' : 'fail' }))
    setStationTesting((prev) => ({ ...prev, [station.key]: false }))
  }

  const handleStationsSave = async () => {
    setStationSaving(true)
    try {
      for (const station of STATIONS) {
        const url = stationUrls[station.key]?.trim() || ''
        const { error } = await supabase.from('settings').upsert(
          {
            id: station.settingId,
            value: url,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        )
        if (error) throw error
        setStationPrinterUrl(station.key, url)
      }
      toast.success('Station printers saved')
    } catch (e) {
      toast.error('Failed to save', e instanceof Error ? e.message : String(e))
    } finally {
      setStationSaving(false)
    }
  }

  return (
    <div className="min-h-full bg-gray-950 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <div className="max-w-lg space-y-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/10 flex items-center justify-center">
            <Printer size={20} className="text-indigo-400" />
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">Printer Configuration</h2>
            <p className="text-gray-400 text-sm">Network thermal printer settings</p>
          </div>
        </div>

        {/* Receipt Printer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">Receipt Printer</p>
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

          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Receipt Printer'}
          </button>
        </div>

        {/* Station Printers */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-5">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">Station Printers</p>
            <ul className="text-gray-400 text-xs space-y-1.5">
              <li>
                • Assign a dedicated printer to kitchen and/or griller stations so order tickets
                print automatically when orders are placed
              </li>
              <li>
                • Each station printer needs its own print server running on the network, connected
                to the station's thermal printer
              </li>
              <li>• Stations without a printer configured will use the KDS screen instead</li>
              <li>• Bar orders always go to the bar KDS screen</li>
            </ul>
          </div>

          {STATIONS.map((station) => (
            <div key={station.key} className="space-y-3">
              <div className="flex items-center gap-2">
                {station.icon}
                <div>
                  <p className="text-white text-sm font-medium">{station.label}</p>
                  <p className="text-gray-500 text-xs">{station.description}</p>
                </div>
              </div>

              <input
                type="text"
                value={stationUrls[station.key] || ''}
                onChange={(e) =>
                  setStationUrls((prev) => ({ ...prev, [station.key]: e.target.value }))
                }
                placeholder={`http://192.168.1.${station.key === 'kitchen' ? '101' : '102'}:6543`}
                className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-amber-500 placeholder-gray-600"
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleStationTest(station)}
                  disabled={stationTesting[station.key] || !stationUrls[station.key]?.trim()}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 border border-gray-700 text-white rounded-lg text-xs hover:border-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {stationTesting[station.key] ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Wifi size={12} />
                  )}
                  {stationTesting[station.key] ? 'Testing...' : 'Test'}
                </button>

                {stationTestResults[station.key] === 'success' && (
                  <span className="flex items-center gap-1 text-green-400 text-xs">
                    <Wifi size={12} /> Reachable
                  </span>
                )}
                {stationTestResults[station.key] === 'fail' && (
                  <span className="flex items-center gap-1 text-red-400 text-xs">
                    <WifiOff size={12} /> Not reachable
                  </span>
                )}

                {stationUrls[station.key]?.trim() && (
                  <button
                    onClick={() => {
                      setStationUrls((prev) => ({ ...prev, [station.key]: '' }))
                      setStationTestResults((prev) => ({ ...prev, [station.key]: null }))
                    }}
                    className="text-gray-500 hover:text-red-400 text-xs transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}

          <button
            onClick={handleStationsSave}
            disabled={stationSaving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {stationSaving ? 'Saving...' : 'Save Station Printers'}
          </button>
        </div>

        {/* Station Modes */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 space-y-4">
          <div className="bg-gray-800/50 rounded-lg p-4">
            <p className="text-gray-300 text-sm font-medium mb-2">Station Output Modes</p>
            <ul className="text-gray-400 text-xs space-y-1.5">
              <li>
                • <span className="text-white">Display Only</span> — orders appear on the KDS
                screen, no printing
              </li>
              <li>
                • <span className="text-white">Printer Only</span> — orders auto-print, KDS screen
                shows no new orders
              </li>
              <li>
                • <span className="text-white">Both</span> — orders appear on KDS AND auto-print
              </li>
              <li>
                • Set <span className="text-white">copies</span> to 2 for kitchen/griller so they
                keep one and give one out
              </li>
            </ul>
          </div>

          {[
            {
              key: 'kitchen',
              label: 'Kitchen',
              icon: <ChefHat size={16} className="text-orange-400" />,
            },
            {
              key: 'griller',
              label: 'Griller',
              icon: <Flame size={16} className="text-red-400" />,
            },
            { key: 'bar', label: 'Bar', icon: <Beer size={16} className="text-cyan-400" /> },
          ].map((station) => (
            <div key={station.key} className="space-y-2">
              <div className="flex items-center gap-2">
                {station.icon}
                <p className="text-white text-sm font-medium">{station.label}</p>
              </div>
              <div className="flex gap-2">
                {(['display', 'printer', 'both'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setStationModes((prev) => ({ ...prev, [station.key]: mode }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-medium border-2 transition-all ${
                      stationModes[station.key] === mode
                        ? 'border-amber-500 bg-amber-500/10 text-amber-400'
                        : 'border-gray-700 bg-gray-800 text-gray-500'
                    }`}
                  >
                    {mode === 'display' && <Monitor size={12} />}
                    {mode === 'printer' && <Printer size={12} />}
                    {mode === 'both' && (
                      <>
                        <Monitor size={10} />
                        <span>+</span>
                        <Printer size={10} />
                      </>
                    )}
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
              {(stationModes[station.key] === 'printer' ||
                stationModes[station.key] === 'both') && (
                <div className="flex items-center gap-3 pl-6">
                  <Copy size={12} className="text-gray-500" />
                  <span className="text-gray-400 text-xs">Print copies:</span>
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      onClick={() => setPrintCopies((prev) => ({ ...prev, [station.key]: n }))}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                        printCopies[station.key] === n
                          ? 'bg-amber-500 text-black'
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}

          <button
            onClick={async () => {
              setModesSaving(true)
              try {
                await Promise.all([
                  supabase
                    .from('settings')
                    .upsert(
                      {
                        id: 'station_modes',
                        value: JSON.stringify(stationModes),
                        updated_at: new Date().toISOString(),
                      },
                      { onConflict: 'id' }
                    ),
                  supabase
                    .from('settings')
                    .upsert(
                      {
                        id: 'print_copies',
                        value: JSON.stringify(printCopies),
                        updated_at: new Date().toISOString(),
                      },
                      { onConflict: 'id' }
                    ),
                ])
                toast.success('Station modes saved')
              } catch (e) {
                toast.error('Failed to save', e instanceof Error ? e.message : String(e))
              } finally {
                setModesSaving(false)
              }
            }}
            disabled={modesSaving}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded-xl py-2.5 text-sm transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {modesSaving ? 'Saving...' : 'Save Station Modes'}
          </button>
        </div>

        {/* USB/Bluetooth thermal printer */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
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
