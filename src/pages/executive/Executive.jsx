import { useAuth } from '../../context/AuthContext'
import { 
  LayoutDashboard, 
  ShoppingBag, 
  Users, 
  BedDouble,
  TrendingUp,
  Package,
  LogOut,
  Beer
} from 'lucide-react'

function getGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Morning'
  if (hour < 17) return 'Afternoon'
  return 'Evening'
}

export default function Executive() {
  const { profile, signOut } = useAuth()

  const stats = [
    { label: "Today's Revenue", value: "₦0.00", icon: TrendingUp, color: "text-green-400", bg: "bg-green-400/10" },
    { label: "Open Orders", value: "0", icon: ShoppingBag, color: "text-amber-400", bg: "bg-amber-400/10" },
    { label: "Occupied Tables", value: "0/60", icon: LayoutDashboard, color: "text-blue-400", bg: "bg-blue-400/10" },
    { label: "Occupied Rooms", value: "0/20", icon: BedDouble, color: "text-purple-400", bg: "bg-purple-400/10" },
    { label: "Staff On Duty", value: "0", icon: Users, color: "text-pink-400", bg: "bg-pink-400/10" },
    { label: "Low Stock Items", value: "0", icon: Package, color: "text-red-400", bg: "bg-red-400/10" },
  ]

  return (
    <div className="min-h-screen bg-gray-950">
      
      <nav className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center">
              <Beer size={20} className="text-black" />
            </div>
            <div>
              <h1 className="text-white font-bold">Beeshops Place</h1>
              <p className="text-gray-400 text-xs">Executive Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-white text-sm font-medium">{profile?.full_name}</p>
              <p className="text-amber-500 text-xs capitalize">{profile?.role}</p>
            </div>
            <button
              onClick={signOut}
              className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </nav>

      <div className="p-6">
        
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white">
            Good {getGreeting()}, {profile?.full_name?.split(' ')[0]}!
          </h2>
          <p className="text-gray-400 mt-1">
            Here is what is happening at Beeshops Place today.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
          {stats.map((stat, index) => (
            <div key={index} className="bg-gray-900 rounded-2xl p-5 border border-gray-800">
              <div className={`inline-flex p-2 rounded-lg ${stat.bg} mb-3`}>
                <stat.icon size={20} className={stat.color} />
              </div>
              <p className="text-gray-400 text-sm">{stat.label}</p>
              { label: "Today's Revenue", value: "₦0.00", icon: TrendingUp, color: "text-green-400", bg: "bg-green-400/10" },
            </div>
          ))}
        </div>

        <div className="mb-8">
          <h3 className="text-white font-semibold mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'View Reports', icon: TrendingUp, color: 'bg-green-500' },
              { label: 'Manage Staff', icon: Users, color: 'bg-blue-500' },
              { label: 'View Rooms', icon: BedDouble, color: 'bg-purple-500' },
              { label: 'Check Stock', icon: Package, color: 'bg-red-500' },
            ].map((action, index) => (
              <button
                key={index}
                className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex flex-col items-center gap-2 hover:border-gray-600 transition-colors"
              >
                <div className={`w-10 h-10 ${action.color} rounded-lg flex items-center justify-center`}>
                  <action.icon size={18} className="text-white" />
                </div>
                <span className="text-gray-300 text-sm">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <h3 className="text-white font-semibold mb-4">Recent Activity</h3>
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-16 h-16 bg-gray-800 rounded-full flex items-center justify-center mb-3">
              <ShoppingBag size={24} className="text-gray-600" />
            </div>
            <p className="text-gray-400">No activity yet today</p>
            <p className="text-gray-600 text-sm mt-1">Orders and events will appear here</p>
          </div>
        </div>

      </div>
    </div>
  )
}