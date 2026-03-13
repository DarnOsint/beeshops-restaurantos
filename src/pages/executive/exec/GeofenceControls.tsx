import { useState } from 'react'
import { MapPin, Package, Smartphone } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import type { Stats } from './types'

interface Props {
  stats: Stats
  geofenceEnabled: boolean
  setGeofenceEnabled: (v: boolean) => void
  radiusMain: number
  setRadiusMain: (v: number) => void
  radiusApartment: number
  setRadiusApartment: (v: number) => void
  latMain: string
  setLatMain: (v: string) => void
  lngMain: string
  setLngMain: (v: string) => void
  latApartment: string
  setLatApartment: (v: string) => void
  lngApartment: string
  setLngApartment: (v: string) => void
  bankName: string
  setBankName: (v: string) => void
  bankAccountNumber: string
  setBankAccountNumber: (v: string) => void
  bankAccountName: string
  setBankAccountName: (v: string) => void
  peakHour: string | null
  onNavigateBackoffice: () => void
}

export default function GeofenceControls({
  stats,
  geofenceEnabled,
  setGeofenceEnabled,
  radiusMain,
  setRadiusMain,
  radiusApartment,
  setRadiusApartment,
  latMain,
  setLatMain,
  lngMain,
  setLngMain,
  latApartment,
  setLatApartment,
  lngApartment,
  setLngApartment,
  bankName,
  setBankName,
  bankAccountNumber,
  setBankAccountNumber,
  bankAccountName,
  setBankAccountName,
  peakHour,
  onNavigateBackoffice,
}: Props) {
  const [geoToggling, setGeoToggling] = useState(false)
  const [radiusSaving, setRadiusSaving] = useState(false)
  const [savingBank, setSavingBank] = useState(false)
  const [showRadiusEdit, setShowRadiusEdit] = useState(false)
  const [showBankEdit, setShowBankEdit] = useState(false)

  const toggleGeofence = async () => {
    setGeoToggling(true)
    await supabase
      .from('settings')
      .update({ value: (!geofenceEnabled).toString(), updated_at: new Date().toISOString() })
      .eq('id', 'geofence_enabled')
    setGeofenceEnabled(!geofenceEnabled)
    setGeoToggling(false)
  }

  const saveRadius = async () => {
    setRadiusSaving(true)
    await Promise.all([
      supabase
        .from('settings')
        .upsert({
          id: 'geofence_radius_main',
          value: String(radiusMain),
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('settings')
        .upsert({
          id: 'geofence_radius_apartment',
          value: String(radiusApartment),
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('settings')
        .upsert({
          id: 'geofence_lat_main',
          value: String(latMain),
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('settings')
        .upsert({
          id: 'geofence_lng_main',
          value: String(lngMain),
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('settings')
        .upsert({
          id: 'geofence_lat_apartment',
          value: String(latApartment),
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('settings')
        .upsert({
          id: 'geofence_lng_apartment',
          value: String(lngApartment),
          updated_at: new Date().toISOString(),
        }),
    ])
    setRadiusSaving(false)
    setShowRadiusEdit(false)
  }

  const saveBank = async () => {
    setSavingBank(true)
    await Promise.all([
      supabase
        .from('settings')
        .upsert({ id: 'bank_name', value: bankName, updated_at: new Date().toISOString() }),
      supabase
        .from('settings')
        .upsert({
          id: 'bank_account_number',
          value: bankAccountNumber,
          updated_at: new Date().toISOString(),
        }),
      supabase
        .from('settings')
        .upsert({
          id: 'bank_account_name',
          value: bankAccountName,
          updated_at: new Date().toISOString(),
        }),
    ])
    setSavingBank(false)
  }

  const inp =
    'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-500'

  return (
    <>
      {/* Control row */}
      <div className="mb-6 flex flex-wrap items-center gap-2 relative">
        <button
          onClick={toggleGeofence}
          disabled={geoToggling}
          className={`flex items-center gap-2 text-xs px-3 py-2 rounded-xl border transition-colors ${geofenceEnabled ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20' : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'}`}
        >
          <MapPin size={13} />
          {geoToggling ? 'Updating...' : geofenceEnabled ? 'Geofence ON' : 'Geofence OFF'}
          <span
            className={`w-2 h-2 rounded-full ${geofenceEnabled ? 'bg-green-400' : 'bg-red-400'}`}
          />
        </button>

        <button
          onClick={() => setShowRadiusEdit((v) => !v)}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border bg-gray-800 border-gray-700 text-gray-400 hover:text-white transition-colors"
        >
          <MapPin size={13} /> Radius
        </button>

        {stats.lowStock > 0 && (
          <button
            onClick={onNavigateBackoffice}
            className="bg-red-500/10 border border-red-500/30 text-red-400 text-xs px-3 py-2 rounded-xl flex items-center gap-1.5 hover:bg-red-500/20 transition-colors"
          >
            <Package size={13} /> {stats.lowStock} Low Stock
          </button>
        )}

        {peakHour && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2">
            <p className="text-amber-400 text-xs">Peak Hour</p>
            <p className="text-white font-bold text-sm">{peakHour}</p>
          </div>
        )}

        {/* Radius popover */}
        {showRadiusEdit && (
          <div className="absolute top-12 left-0 z-50 bg-gray-900 border border-gray-700 rounded-2xl p-4 shadow-xl w-72">
            <p className="text-white font-semibold text-sm mb-3">Geofence Radius Settings</p>
            <div className="space-y-3">
              <p className="text-gray-600 text-xs mb-1">Main Venue</p>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Radius (metres)</label>
                <input
                  type="number"
                  value={radiusMain}
                  onChange={(e) => setRadiusMain(parseInt(e.target.value) || 0)}
                  className={inp}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Latitude</label>
                  <input
                    type="text"
                    value={latMain}
                    placeholder="e.g. 7.350834"
                    onChange={(e) => setLatMain(e.target.value)}
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Longitude</label>
                  <input
                    type="text"
                    value={lngMain}
                    placeholder="e.g. 3.840780"
                    onChange={(e) => setLngMain(e.target.value)}
                    className={inp}
                  />
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-2 mb-1">Apartments</p>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Radius (metres)</label>
                <input
                  type="number"
                  value={radiusApartment}
                  onChange={(e) => setRadiusApartment(parseInt(e.target.value) || 0)}
                  className={inp}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Latitude</label>
                  <input
                    type="text"
                    value={latApartment}
                    placeholder="e.g. 7.349545"
                    onChange={(e) => setLatApartment(e.target.value)}
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Longitude</label>
                  <input
                    type="text"
                    value={lngApartment}
                    placeholder="e.g. 3.839690"
                    onChange={(e) => setLngApartment(e.target.value)}
                    className={inp}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={saveRadius}
                  disabled={radiusSaving}
                  className="flex-1 bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold py-2 rounded-xl transition-colors"
                >
                  {radiusSaving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowRadiusEdit(false)}
                  className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-xs py-2 rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bank settings accordion */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl mb-4 overflow-hidden">
        <button
          onClick={() => setShowBankEdit((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Smartphone size={15} className="text-amber-400" />
            <span className="text-white font-semibold text-sm">Bank Transfer Details</span>
            {bankName && <span className="text-gray-500 text-xs">· {bankName}</span>}
          </div>
          <span className="text-gray-500 text-xs">{showBankEdit ? 'Close ▲' : 'Edit ▼'}</span>
        </button>
        {showBankEdit && (
          <div className="px-4 pb-4 space-y-2 border-t border-gray-800 pt-3">
            <p className="text-gray-500 text-xs mb-2">
              Shown to waitrons when processing bank transfer payments.
            </p>
            <div>
              <label className="text-gray-400 text-xs mb-1 block">Bank Name</label>
              <input
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                placeholder="e.g. Moniepoint"
                className={inp}
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-1 block">Account Number</label>
              <input
                value={bankAccountNumber}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                placeholder="e.g. 1234567890"
                className={inp}
              />
            </div>
            <div>
              <label className="text-gray-400 text-xs mb-1 block">Account Name</label>
              <input
                value={bankAccountName}
                onChange={(e) => setBankAccountName(e.target.value)}
                placeholder="e.g. Beeshop's Place Lounge"
                className={inp}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={saveBank}
                disabled={savingBank}
                className="flex-1 bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black text-sm font-bold py-2.5 rounded-xl transition-colors"
              >
                {savingBank ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setShowBankEdit(false)}
                className="flex-1 bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded-xl transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
