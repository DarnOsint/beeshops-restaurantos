import { useState, useEffect } from 'react'

const LOCATIONS = {
  main: {
    lat: 7.350834,
    lng: 3.840780,
    radius: 400, // metres
    name: "Beeshop's Place"
  },
  apartment: {
    lat: 7.349545,
    lng: 3.839690,
    radius: 200,
    name: "Beeshop's Apartments"
  }
}

function getDistanceMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function useGeofence(locationType = 'main') {
  const [status, setStatus] = useState('checking') // 'checking' | 'inside' | 'outside' | 'denied' | 'unavailable'
  const [distance, setDistance] = useState(null)

  useEffect(() => {
    if (!navigator.geolocation) {
      setStatus('unavailable')
      return
    }

    const check = () => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords
          const location = LOCATIONS[locationType]
          const dist = getDistanceMetres(latitude, longitude, location.lat, location.lng)
          setDistance(Math.round(dist))
          setStatus(dist <= location.radius ? 'inside' : 'outside')
        },
        (err) => {
          if (err.code === err.PERMISSION_DENIED) setStatus('denied')
          else setStatus('unavailable')
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      )
    }

    check()
    const interval = setInterval(check, 60000) // re-check every 60s
    return () => clearInterval(interval)
  }, [locationType])

  return { status, distance, location: LOCATIONS[locationType] }
}