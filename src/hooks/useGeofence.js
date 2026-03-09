
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

const LOCATIONS = {
  main:      { lat: 7.350834, lng: 3.840780, radius: 400 },
  apartment: { lat: 7.349545, lng: 3.839690, radius: 200 },
}

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

export function useGeofence(locKey = 'main') {
  const [status,   setStatus]   = useState('checking')
  const [distance, setDistance] = useState(null)
  const [location, setLocation] = useState(null)
  const [enabled,  setEnabled]  = useState(null) // null = not yet loaded

  // Step 1: fetch setting first
  useEffect(() => {
    supabase
      .from('settings')
      .select('value')
      .eq('id', 'geofence_enabled')
      .single()
      .then(({ data }) => {
        const isEnabled = data ? data.value === 'true' : true
        setEnabled(isEnabled)
      })
      .catch(() => setEnabled(true)) // default to enabled on error
  }, [])

  // Step 2: only run GPS check AFTER setting is loaded
  useEffect(() => {
    if (enabled === null) return // still loading setting — wait

    // Geofence is OFF — immediately set inside
    if (!enabled) {
      setStatus('inside')
      setDistance(0)
      return
    }

    // Geofence is ON — do GPS check
    const check = (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords
      setLocation({ lat, lng })
      const loc = LOCATIONS[locKey]
      if (!loc) { setStatus('inside'); return }
      const dist = getDistance(lat, lng, loc.lat, loc.lng)
      setDistance(Math.round(dist))
      setStatus(dist <= loc.radius ? 'inside' : 'outside')
    }

    const error = () => setStatus('error')

    if (!navigator.geolocation) { setStatus('unsupported'); return }

    navigator.geolocation.getCurrentPosition(check, error, { enableHighAccuracy: true })
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(check, error, { enableHighAccuracy: true })
    }, 60000)

    return () => clearInterval(interval)
  }, [locKey, enabled]) // runs when enabled changes from null to true/false

  return { status, distance, location }
}
