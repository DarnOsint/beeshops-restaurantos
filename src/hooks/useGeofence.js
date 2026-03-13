import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Fallback coordinates — overridden by settings table if present
const FALLBACK_LOCATIONS = {
  main:      { lat: 7.350834, lng: 3.840780 },
  apartment: { lat: 7.349545, lng: 3.839690 },
}

const DEFAULT_RADIUS = { main: 400, apartment: 200 }

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
  const [enabled,  setEnabled]  = useState(null)
  const [radius,   setRadius]   = useState(null)
  const [target,   setTarget]   = useState(null)

  useEffect(() => {
    supabase
      .from('settings')
      .select('id, value')
      .in('id', [
        'geofence_enabled',
        'geofence_radius_main', 'geofence_radius_apartment',
        'geofence_lat_main',    'geofence_lng_main',
        'geofence_lat_apartment', 'geofence_lng_apartment',
      ])
      .then(({ data }) => {
        const fallback = FALLBACK_LOCATIONS[locKey] || FALLBACK_LOCATIONS.main
        if (!data) {
          setEnabled(true)
          setRadius(DEFAULT_RADIUS[locKey] || 400)
          setTarget(fallback)
          return
        }
        const map = Object.fromEntries(data.map(r => [r.id, r.value]))

        setEnabled(map['geofence_enabled'] !== 'false')

        const r = locKey === 'apartment'
          ? parseInt(map['geofence_radius_apartment'] || DEFAULT_RADIUS.apartment)
          : parseInt(map['geofence_radius_main']      || DEFAULT_RADIUS.main)
        setRadius(r)

        const lat = locKey === 'apartment'
          ? parseFloat(map['geofence_lat_apartment'] || fallback.lat)
          : parseFloat(map['geofence_lat_main']      || fallback.lat)
        const lng = locKey === 'apartment'
          ? parseFloat(map['geofence_lng_apartment'] || fallback.lng)
          : parseFloat(map['geofence_lng_main']      || fallback.lng)
        setTarget({ lat, lng })
      })
      .catch(() => {
        setEnabled(true)
        setRadius(DEFAULT_RADIUS[locKey] || 400)
        setTarget(FALLBACK_LOCATIONS[locKey] || FALLBACK_LOCATIONS.main)
      })
  }, [locKey])

  useEffect(() => {
    if (enabled === null || radius === null || !target) return

    if (!enabled) {
      setStatus('inside')
      setDistance(0)
      return
    }

    const check = (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords
      setLocation({ lat, lng })
      const dist = getDistance(lat, lng, target.lat, target.lng)
      setDistance(Math.round(dist))
      setStatus(dist <= radius ? 'inside' : 'outside')
    }

    const error = () => setStatus('error')

    if (!navigator.geolocation) { setStatus('unsupported'); return }

    navigator.geolocation.getCurrentPosition(check, error, { enableHighAccuracy: true })
    const interval = setInterval(() => {
      navigator.geolocation.getCurrentPosition(check, error, { enableHighAccuracy: true })
    }, 60000)

    return () => clearInterval(interval)
  }, [locKey, enabled, radius, target])

  return { status, distance, location }
}
