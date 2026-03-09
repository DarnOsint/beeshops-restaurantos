import { MapPin, RefreshCw, AlertTriangle } from 'lucide-react'

export default function GeofenceBlock({ status, distance, location }) {
  const messages = {
    outside: {
      title: "You're not on-site",
      subtitle: `You must be within ${location.radius}m of ${location.name} to use this app.`,
      detail: distance ? `You are currently ${distance}m away.` : null,
      icon: MapPin,
      color: 'text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20'
    },
    denied: {
      title: 'Location access denied',
      subtitle: 'Please allow location access in your browser settings to use this app.',
      detail: 'Settings → Privacy → Location → Allow',
      icon: AlertTriangle,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20'
    },
    unavailable: {
      title: 'Location unavailable',
      subtitle: 'Your device does not support location services.',
      detail: 'Please use a device with GPS enabled.',
      icon: AlertTriangle,
      color: 'text-gray-400',
      bg: 'bg-gray-500/10',
      border: 'border-gray-500/20'
    },
    checking: {
      title: 'Checking your location...',
      subtitle: 'Please wait while we verify you are on-site.',
      detail: null,
      icon: RefreshCw,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20'
    }
  }

  const msg = messages[status] || messages.checking
  const Icon = msg.icon

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
      <div className={`max-w-sm w-full ${msg.bg} border ${msg.border} rounded-2xl p-8 text-center`}>
        <div className={`w-16 h-16 rounded-full ${msg.bg} border ${msg.border} flex items-center justify-center mx-auto mb-5`}>
          <Icon
            size={28}
            className={`${msg.color} ${status === 'checking' ? 'animate-spin' : ''}`}
          />
        </div>

        <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center mx-auto mb-4">
          <span className="text-black font-bold text-lg">B</span>
        </div>

        <h2 className={`text-lg font-bold ${msg.color} mb-2`}>{msg.title}</h2>
        <p className="text-gray-400 text-sm mb-2">{msg.subtitle}</p>
        {msg.detail && (
          <p className="text-gray-500 text-xs">{msg.detail}</p>
        )}

        {status !== 'checking' && (
          <button
            onClick={() => window.location.reload()}
            className="mt-6 flex items-center gap-2 mx-auto bg-gray-800 hover:bg-gray-700 text-white text-sm font-medium px-4 py-2.5 rounded-xl transition-colors"
          >
            <RefreshCw size={14} /> Try Again
          </button>
        )}
      </div>
    </div>
  )
}