import { useState, useEffect } from 'react'
import { ArrowLeft, Camera, Plus, Trash2, Save, Loader2, Wifi, WifiOff, Eye } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useToast } from '../../context/ToastContext'

interface Props {
  onBack: () => void
}

interface CameraConfig {
  id: string
  name: string
  zone: string
  rtsp: string
  detection_types: string[]
  enabled: boolean
}

interface CVSettings {
  enabled: boolean
  detection_interval: number
  confidence_threshold: number
  yolo_model: string
}

const ZONES = ['indoor', 'outdoor', 'vip', 'nook', 'entrance', 'bar', 'kitchen', 'parking']
const DETECTION_TYPES = [
  { id: 'people_count', label: 'People Counting', desc: 'Count people in frame' },
  { id: 'zone_heatmap', label: 'Zone Heatmap', desc: 'Track zone occupancy over time' },
  { id: 'alerts', label: 'Crowd Alerts', desc: 'Alert when crowd exceeds threshold' },
]

export default function CCTVConfig({ onBack }: Props) {
  const toast = useToast()
  const [cameras, setCameras] = useState<CameraConfig[]>([])
  const [settings, setSettings] = useState<CVSettings>({
    enabled: true,
    detection_interval: 5,
    confidence_threshold: 0.5,
    yolo_model: 'yolov8n.pt',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingCam, setEditingCam] = useState<CameraConfig | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, 'ok' | 'fail'>>({})

  const blankCamera: CameraConfig = {
    id: '',
    name: '',
    zone: 'indoor',
    rtsp: '',
    detection_types: ['people_count'],
    enabled: true,
  }
  const [form, setForm] = useState<CameraConfig>(blankCamera)

  useEffect(() => {
    const load = async () => {
      const [camRes, setRes] = await Promise.all([
        supabase.from('settings').select('value').eq('id', 'cv_cameras').maybeSingle(),
        supabase.from('settings').select('value').eq('id', 'cv_settings').maybeSingle(),
      ])
      if (camRes.data?.value) {
        try {
          setCameras(JSON.parse(camRes.data.value))
        } catch {
          /* invalid */
        }
      }
      if (setRes.data?.value) {
        try {
          setSettings((prev) => ({ ...prev, ...JSON.parse(setRes.data.value) }))
        } catch {
          /* invalid */
        }
      }
      setLoading(false)
    }
    load()
  }, [])

  const saveCameras = async (cams: CameraConfig[]) => {
    const { error } = await supabase.from('settings').upsert(
      {
        id: 'cv_cameras',
        value: JSON.stringify(cams),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    if (error) throw error
    setCameras(cams)
  }

  const saveSettings = async (s: CVSettings) => {
    const { error } = await supabase.from('settings').upsert(
      {
        id: 'cv_settings',
        value: JSON.stringify(s),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    )
    if (error) throw error
    setSettings(s)
  }

  const handleAddCamera = async () => {
    if (!form.name || !form.rtsp) {
      toast.warning('Required', 'Camera name and RTSP URL are required')
      return
    }
    setSaving(true)
    try {
      const newCam = { ...form, id: form.id || `cam_${Date.now()}` }
      const updated = editingCam
        ? cameras.map((c) => (c.id === editingCam.id ? newCam : c))
        : [...cameras, newCam]
      await saveCameras(updated)
      setForm(blankCamera)
      setShowAdd(false)
      setEditingCam(null)
      toast.success(editingCam ? 'Camera Updated' : 'Camera Added', newCam.name)
    } catch (e) {
      toast.error('Error', (e as { message?: string })?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const removeCamera = async (id: string) => {
    if (!confirm('Remove this camera?')) return
    setSaving(true)
    try {
      await saveCameras(cameras.filter((c) => c.id !== id))
      toast.success('Removed')
    } catch (e) {
      toast.error('Error', (e as { message?: string })?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      await saveSettings(settings)
      toast.success('Settings Saved')
    } catch (e) {
      toast.error('Error', (e as { message?: string })?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  const toggleDetection = (type: string) => {
    setForm((prev) => ({
      ...prev,
      detection_types: prev.detection_types.includes(type)
        ? prev.detection_types.filter((t) => t !== type)
        : [...prev.detection_types, type],
    }))
  }

  const inp =
    'w-full bg-gray-800 border border-gray-700 text-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500'

  if (loading)
    return (
      <div className="min-h-full bg-gray-950 flex items-center justify-center">
        <Loader2 className="animate-spin text-amber-500" size={24} />
      </div>
    )

  return (
    <div className="min-h-full bg-gray-950 p-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
      >
        <ArrowLeft size={18} /> Back
      </button>

      <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center">
            <Camera size={20} className="text-violet-400" />
          </div>
          <div>
            <h2 className="text-white text-xl font-bold">CCTV Configuration</h2>
            <p className="text-gray-400 text-sm">
              Configure cameras and detection settings — the Pi picks up changes automatically
            </p>
          </div>
        </div>

        {/* Global Settings */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white font-semibold text-sm">Detection Settings</p>
            <button
              onClick={() => {
                setSettings((s) => ({ ...s, enabled: !s.enabled }))
              }}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${settings.enabled ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}
            >
              {settings.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-gray-400 text-xs block mb-1">
                Detection Interval (seconds)
              </label>
              <input
                type="number"
                min="1"
                max="60"
                value={settings.detection_interval}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, detection_interval: parseInt(e.target.value) || 5 }))
                }
                className={inp}
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Confidence Threshold</label>
              <input
                type="number"
                min="0.1"
                max="1"
                step="0.05"
                value={settings.confidence_threshold}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    confidence_threshold: parseFloat(e.target.value) || 0.5,
                  }))
                }
                className={inp}
              />
            </div>
          </div>
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 bg-violet-500 hover:bg-violet-400 disabled:opacity-50 text-white font-semibold rounded-xl py-2.5 text-sm transition-colors"
          >
            <Save size={14} /> Save Settings
          </button>
        </div>

        {/* Cameras */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-white font-semibold">Cameras ({cameras.length})</p>
          <button
            onClick={() => {
              setForm(blankCamera)
              setEditingCam(null)
              setShowAdd(true)
            }}
            className="flex items-center gap-1 text-amber-400 hover:text-amber-300 text-sm font-medium"
          >
            <Plus size={14} /> Add Camera
          </button>
        </div>

        {/* Camera list */}
        {cameras.length === 0 && !showAdd && (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center mb-4">
            <Camera size={32} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-500">No cameras configured</p>
            <p className="text-gray-600 text-xs mt-1">
              Add your CCTV cameras — the Pi will start processing automatically
            </p>
          </div>
        )}

        <div className="space-y-2 mb-4">
          {cameras.map((cam) => (
            <div
              key={cam.id}
              className={`bg-gray-900 border rounded-xl p-4 ${cam.enabled ? 'border-gray-800' : 'border-red-500/30 opacity-60'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-white text-sm font-semibold">{cam.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 uppercase">
                      {cam.zone}
                    </span>
                    {cam.enabled ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">
                        Active
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                        Disabled
                      </span>
                    )}
                  </div>
                  <p className="text-gray-500 text-xs truncate font-mono">{cam.rtsp}</p>
                  <div className="flex gap-1 mt-1.5">
                    {cam.detection_types.map((dt) => (
                      <span
                        key={dt}
                        className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400"
                      >
                        {dt}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => {
                      setForm(cam)
                      setEditingCam(cam)
                      setShowAdd(true)
                    }}
                    className="text-gray-400 hover:text-white p-1"
                  >
                    <Eye size={14} />
                  </button>
                  <button
                    onClick={() => removeCamera(cam.id)}
                    className="text-gray-400 hover:text-red-400 p-1"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add/Edit Camera Form */}
        {showAdd && (
          <div className="bg-gray-900 border border-amber-500/30 rounded-xl p-5 space-y-4 mb-4">
            <p className="text-amber-400 font-semibold text-sm">
              {editingCam ? 'Edit Camera' : 'New Camera'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-gray-400 text-xs block mb-1">Camera Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Outdoor Zone 1"
                  className={inp}
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs block mb-1">Zone</label>
                <select
                  value={form.zone}
                  onChange={(e) => setForm((p) => ({ ...p, zone: e.target.value }))}
                  className={inp}
                >
                  {ZONES.map((z) => (
                    <option key={z} value={z}>
                      {z.charAt(0).toUpperCase() + z.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">RTSP URL</label>
              <input
                value={form.rtsp}
                onChange={(e) => setForm((p) => ({ ...p, rtsp: e.target.value }))}
                placeholder="rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101"
                className={inp}
              />
              <p className="text-gray-600 text-[10px] mt-1">
                The RTSP stream URL from your CCTV camera. Check your camera's manual for the exact
                format.
              </p>
            </div>
            <div>
              <label className="text-gray-400 text-xs block mb-1">Detection Types</label>
              <div className="space-y-2">
                {DETECTION_TYPES.map((dt) => (
                  <button
                    key={dt.id}
                    onClick={() => toggleDetection(dt.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left text-xs transition-colors ${form.detection_types.includes(dt.id) ? 'bg-violet-500/20 border border-violet-500/30 text-violet-300' : 'bg-gray-800 border border-gray-700 text-gray-400'}`}
                  >
                    <div>
                      <p className="font-medium">{dt.label}</p>
                      <p className="text-gray-500 text-[10px]">{dt.desc}</p>
                    </div>
                    <span
                      className={`text-xs ${form.detection_types.includes(dt.id) ? 'text-violet-400' : 'text-gray-600'}`}
                    >
                      {form.detection_types.includes(dt.id) ? '✓' : '○'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-gray-400 text-xs">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm((p) => ({ ...p, enabled: e.target.checked }))}
                  className="rounded"
                />
                Camera enabled
              </label>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAddCamera}
                disabled={saving}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold rounded-xl py-2.5 text-sm"
              >
                {saving ? 'Saving...' : editingCam ? 'Update Camera' : 'Add Camera'}
              </button>
              <button
                onClick={() => {
                  setShowAdd(false)
                  setEditingCam(null)
                }}
                className="flex-1 bg-gray-800 text-gray-300 rounded-xl py-2.5 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Info */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <p className="text-gray-300 text-sm font-medium mb-2">How it works</p>
          <ul className="text-gray-500 text-xs space-y-1.5">
            <li>
              • The Raspberry Pi polls this config every 5 minutes and auto-starts new cameras
            </li>
            <li>• RTSP URLs are the stream addresses from your CCTV NVR or IP cameras</li>
            <li>• People counting uses YOLOv8 AI to detect and count people in each frame</li>
            <li>• Zone heatmap tracks occupancy per area over time</li>
            <li>• Crowd alerts trigger when more than 20 people are detected in one frame</li>
            <li>• Results appear in the Executive Dashboard CCTV panel and Supervisor view</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
