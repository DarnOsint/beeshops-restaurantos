import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { Users, UtensilsCrossed, MapPin, LayoutGrid, LogOut, Beer, ArrowLeft, Package, Truck } from 'lucide-react'
import StaffManagement from './StaffManagement'
import MenuManagement from './MenuManagement'
import ZonePricing from './ZonePricing'
import TableConfig from './TableConfig'
import Inventory from './Inventory'
import Suppliers from './Suppliers'
import { useNavigate } from 'react-router-dom'

export default function BackOffice() {
  const { profile, signOut } = useAuth()
  const [activeSection, setActiveSection] = useState(null)
  const navigate = useNavigate()

  const sections = [
    { id: 'staff', label: 'Staff Management', desc: 'Add, edit and manage staff roles and PINs', icon: Users, color: 'bg-blue-500', roles: ['owner', 'manager'] },
    { id: 'menu', label: 'Menu Management', desc: 'Add and edit menu items, prices, availability', icon: UtensilsCrossed, color: 'bg-green-500', roles: ['owner', 'manager'] },
    { id: 'zonepricing', label: 'Zone Pricing', desc: 'Set drink prices per zone', icon: MapPin, color: 'bg-purple-500', roles: ['owner', 'manager'] },
    { id: 'tables', label: 'Table Configuration', desc: 'Edit table names and capacity', icon: LayoutGrid, color: 'bg-amber-500', roles: ['owner', 'manager'] },
    { id: 'inventory', label: 'Drink Inventory', desc: 'Stock levels, restocking and supplier logs', icon: Package, color: 'bg-blue-600', roles: ['owner', 'manager'] },
    { id: 'suppliers', label: 'Suppliers', desc: 'Manage suppliers and purchase orders', icon: Truck, color: 'bg-teal-600', roles: ['owner', 'manager'] },
  ]

  if (!profile) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )

  const allowed = sections.filter(s => s.roles.includes(profile?.role))

  if (activeSection === 'staff') return <StaffManagement onBack={() => setActiveSection(null)} />
  if (activeSection === 'menu') return <MenuManagement onBack={() => setActiveSection(null)} />
  if (activeSection === 'zonepricing') return <ZonePricing onBack={() => setActiveSection(null)} />
  if (activeSection === 'tables') return <TableConfig onBack={() => setActiveSection(null)} />
  if (activeSection === 'inventory') return <Inventory onBack={() => setActiveSection(null)} />
  if (activeSection === 'suppliers') return <Suppliers onBack={() => setActiveSection(null)} />

  return (
    <div className="min-h-screen bg-gray-950">
      

      <div className="p-6">
        <div className="mb-8">
          <h2 className="text-white text-2xl font-bold">Back Office</h2>
          <p className="text-gray-400 mt-1">Manage your restaurant settings</p>
        </div>

        {allowed.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">You do not have access to any back office sections.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            {allowed.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className="bg-gray-900 border border-gray-800 hover:border-amber-500/50 rounded-2xl p-6 text-left flex items-start gap-4 transition-all group"
              >
                <div className={`w-12 h-12 ${section.color} rounded-xl flex items-center justify-center shrink-0`}>
                  <section.icon size={22} className="text-white" />
                </div>
                <div>
                  <h3 className="text-white font-semibold group-hover:text-amber-400 transition-colors">{section.label}</h3>
                  <p className="text-gray-500 text-sm mt-1">{section.desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}