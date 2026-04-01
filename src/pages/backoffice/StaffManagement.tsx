import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { hashPin } from '../../lib/pinHash'
import {
  ArrowLeft,
  Plus,
  Edit2,
  X,
  Save,
  Search,
  ToggleLeft,
  ToggleRight,
  Eye,
  EyeOff,
  User,
  Phone,
  Mail,
  Shield,
  Hash,
  Calendar,
  FileText,
} from 'lucide-react'
import type { Profile } from '../../types'
import { useToast } from '../../context/ToastContext'

const ROLES = [
  'waitron',
  'kitchen',
  'bar',
  'griller',
  'manager',
  'accountant',
  'auditor',
  'owner',
] as const
const FLOOR_ROLES = ['waitron', 'kitchen', 'bar', 'griller']
const roleColors: Record<string, string> = {
  owner: 'bg-amber-500/20 text-amber-400',
  manager: 'bg-purple-500/20 text-purple-400',
  accountant: 'bg-blue-500/20 text-blue-400',
  auditor: 'bg-indigo-500/20 text-indigo-400',
  waitron: 'bg-green-500/20 text-green-400',
  kitchen: 'bg-red-500/20 text-red-400',
  bar: 'bg-cyan-500/20 text-cyan-400',
  griller: 'bg-orange-500/20 text-orange-400',
}
interface StaffForm {
  full_name: string
  email: string
  phone: string
  role: string
  pin: string
  password: string
  hire_date: string
  emergency_contact: string
  notes: string
  is_active: boolean
}
interface Props {
  onBack: () => void
}

export default function StaffManagement({ onBack }: Props) {
  const [staff, setStaff] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('All')
  const [showModal, setShowModal] = useState(false)
  const [editingStaff, setEditingStaff] = useState<Profile | null>(null)
  const [saving, setSaving] = useState(false)
  const [showPin, setShowPin] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'security'>('info')

  const blankForm: StaffForm = {
    full_name: '',
    email: '',
    phone: '',
    role: 'waitron',
    pin: '',
    password: '',
    hire_date: new Date().toISOString().split('T')[0],
    emergency_contact: '',
    notes: '',
    is_active: true,
  }
  const [form, setForm] = useState<StaffForm>(blankForm)
  const f = (v: Partial<StaffForm>) => setForm((prev) => ({ ...prev, ...v }))

  useEffect(() => {
    fetchStaff()
  }, [])

  const fetchStaff = async () => {
    const { data, error } = await supabase.from('profiles').select('*').order('full_name')
    if (!error) setStaff((data || []) as Profile[])
    setLoading(false)
  }

  const isFloorRole = (role: string) => FLOOR_ROLES.includes(role)

  const openAdd = () => {
    setEditingStaff(null)
    setForm(blankForm)
    setActiveTab('info')
    setShowModal(true)
  }
  const openEdit = (member: Profile) => {
    setEditingStaff(member)
    setForm({
      full_name: member.full_name || '',
      email: (member as unknown as { email?: string }).email || '',
      phone: (member as unknown as { phone?: string }).phone || '',
      role: member.role || 'waitron',
      pin: (member as unknown as { pin?: string }).pin || '',
      password: '',
      hire_date:
        (member as unknown as { hire_date?: string }).hire_date ||
        new Date().toISOString().split('T')[0],
      emergency_contact:
        (member as unknown as { emergency_contact?: string }).emergency_contact || '',
      notes: (member as unknown as { notes?: string }).notes || '',
      is_active: (member as unknown as { is_active?: boolean }).is_active ?? true,
    })
    setActiveTab('info')
    setShowModal(true)
  }

  const validateForm = () => {
    if (!form.full_name.trim()) return 'Full name is required'
    if (!form.role) return 'Role is required'
    if (!editingStaff) {
      if (isFloorRole(form.role)) {
        if (!form.pin || form.pin.length !== 4) return 'PIN must be exactly 4 digits'
      } else {
        if (!form.email.trim()) return 'Email is required for office staff'
        if (!form.password || form.password.length < 6)
          return 'Password must be at least 6 characters'
        if (!form.pin || form.pin.length !== 4) return 'PIN is required for all staff'
      }
    }
    return null
  }

  const saveStaff = async () => {
    const err = validateForm()
    if (err) {
      toast.info('Notice', err)
      return
    }
    setSaving(true)
    try {
      if (editingStaff) {
        const updates: Record<string, unknown> = {
          full_name: form.full_name,
          phone: form.phone,
          role: form.role,
          hire_date: form.hire_date,
          emergency_contact: form.emergency_contact,
          notes: form.notes,
          is_active: form.is_active,
        }
        if (form.pin) updates.pin = await hashPin(form.pin)
        const { error } = await supabase.from('profiles').update(updates).eq('id', editingStaff.id)
        if (error) throw error
      } else if (isFloorRole(form.role)) {
        const { error } = await supabase.from('profiles').insert({
          id: crypto.randomUUID(),
          full_name: form.full_name,
          email: form.email || null,
          phone: form.phone,
          role: form.role,
          pin: await hashPin(form.pin),
          hire_date: form.hire_date,
          emergency_contact: form.emergency_contact,
          notes: form.notes,
          is_active: true,
        })
        if (error) throw error
      } else {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.full_name } },
        })
        if (signUpError) throw signUpError
        // When email confirmation is enabled, signUpData.user is null until confirmed.
        // Fall back to session user or a new UUID so the profile is still created.
        const userId = signUpData.user?.id ?? signUpData.session?.user?.id ?? crypto.randomUUID()
        const profileData: Record<string, unknown> = {
          id: userId,
          full_name: form.full_name,
          email: form.email,
          phone: form.phone,
          role: form.role,
          pin: await hashPin(form.pin),
          hire_date: form.hire_date,
          emergency_contact: form.emergency_contact,
          notes: form.notes,
          is_active: true,
        }
        const { error: upsertError } = await supabase.from('profiles').upsert(profileData)
        if (upsertError) throw upsertError
      }
      await fetchStaff()
      setSaving(false)
      setShowModal(false)
      toast.success(editingStaff ? 'Staff Updated' : 'Staff Added')
    } catch (e) {
      toast.error('Error', e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  const toggleActive = async (member: Profile) => {
    const { error } = await supabase
      .from('profiles')
      .update({ is_active: !(member as unknown as { is_active?: boolean }).is_active })
      .eq('id', member.id)
    if (error) {
      toast.error('Error', 'Failed to update staff status: ' + error.message)
      return
    }
    fetchStaff()
  }

  const filtered = staff.filter((s) => {
    const m = s as unknown as { email?: string; phone?: string; is_active?: boolean }
    const matchSearch =
      s.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      m.email?.toLowerCase().includes(search.toLowerCase()) ||
      m.phone?.includes(search)
    const matchRole = filterRole === 'All' || s.role === filterRole
    return matchSearch && matchRole
  })
  const activeCount = staff.filter(
    (s) => (s as unknown as { is_active?: boolean }).is_active
  ).length

  return (
    <div className="min-h-full bg-gray-950">
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-white font-bold">Staff Management</h1>
            <p className="text-gray-400 text-xs">
              {staff.length} total · {activeCount} active
            </p>
          </div>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-black font-bold px-3 py-1.5 rounded-xl text-xs transition-colors"
        >
          <Plus size={14} /> Add Staff
        </button>
      </div>
      <div className="p-4">
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or phone..."
              className="w-full bg-gray-900 border border-gray-800 text-white rounded-xl pl-9 pr-4 py-2.5 focus:outline-none focus:border-amber-500 text-sm"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto">
            {(['All', ...ROLES] as string[]).map((role) => (
              <button
                key={role}
                onClick={() => setFilterRole(role)}
                className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-colors capitalize ${filterRole === role ? 'bg-amber-500 text-black' : 'bg-gray-900 border border-gray-800 text-gray-400 hover:text-white'}`}
              >
                {role}
              </button>
            ))}
          </div>
        </div>
        {loading ? (
          <div className="text-amber-500 text-center py-12">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500">No staff found</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map((member) => {
              const m = member as unknown as {
                email?: string
                phone?: string
                pin?: string
                hire_date?: string
                is_active?: boolean
              }
              return (
                <div
                  key={member.id}
                  className={`bg-gray-900 border rounded-xl p-4 ${m.is_active ? 'border-gray-800' : 'border-gray-800 opacity-50'}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gray-700 flex items-center justify-center text-white font-bold text-sm">
                        {member.full_name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white font-semibold text-sm">{member.full_name}</p>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-lg capitalize ${roleColors[member.role] || 'bg-gray-700 text-gray-400'}`}
                        >
                          {member.role}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEdit(member)}
                        className="text-gray-400 hover:text-white p-1"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => toggleActive(member)}>
                        {m.is_active ? (
                          <ToggleRight size={22} className="text-green-400" />
                        ) : (
                          <ToggleLeft size={22} className="text-gray-500" />
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    {m.email && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <Mail size={11} />
                        <span className="truncate">{m.email}</span>
                      </div>
                    )}
                    {m.phone && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <Phone size={11} />
                        <span>{m.phone}</span>
                      </div>
                    )}
                    {m.pin && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <Hash size={11} />
                        <span>PIN: {'•'.repeat(m.pin.length)}</span>
                      </div>
                    )}
                    {m.hire_date && (
                      <div className="flex items-center gap-2 text-gray-400 text-xs">
                        <Calendar size={11} />
                        <span>
                          Hired:{' '}
                          {new Date(m.hire_date).toLocaleDateString('en-NG', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="mt-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${isFloorRole(member.role) ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}
                    >
                      {isFloorRole(member.role) ? '🏃 Floor Staff' : '🏢 Office Staff'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-2xl w-full max-w-lg border border-gray-800 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between p-5 border-b border-gray-800 shrink-0">
              <div>
                <h3 className="text-white font-bold">
                  {editingStaff ? 'Edit Staff Member' : 'Add New Staff'}
                </h3>
                <p className="text-gray-400 text-xs mt-0.5">
                  {editingStaff
                    ? `Editing ${editingStaff.full_name}`
                    : 'Fill in staff details below'}
                </p>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="text-gray-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="flex border-b border-gray-800 px-5 shrink-0">
              {(
                [
                  { id: 'info', label: 'Personal Info', Icon: User },
                  { id: 'security', label: 'Access & Security', Icon: Shield },
                ] as const
              ).map(({ id, label, Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id as 'info' | 'security')}
                  className={`flex items-center gap-2 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === id ? 'border-amber-500 text-amber-500' : 'border-transparent text-gray-400 hover:text-white'}`}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {activeTab === 'info' && (
                <>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Full Name *
                    </label>
                    <div className="relative">
                      <User
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        value={form.full_name}
                        onChange={(e) => f({ full_name: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                        placeholder="e.g. Chisom Okafor"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Role *
                    </label>
                    <div className="relative">
                      <Shield
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <select
                        value={form.role}
                        onChange={(e) => f({ role: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm capitalize appearance-none"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r.charAt(0).toUpperCase() + r.slice(1)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p
                      className={`text-xs mt-1 ${isFloorRole(form.role) ? 'text-blue-400' : 'text-purple-400'}`}
                    >
                      {isFloorRole(form.role)
                        ? '🏃 Floor staff — logs in with PIN only'
                        : '🏢 Office staff — logs in with email + password'}
                    </p>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        value={form.phone}
                        onChange={(e) => f({ phone: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                        placeholder="e.g. 08012345678"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Hire Date
                    </label>
                    <div className="relative">
                      <Calendar
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        type="date"
                        value={form.hire_date}
                        onChange={(e) => f({ hire_date: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Emergency Contact
                    </label>
                    <div className="relative">
                      <Phone
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        value={form.emergency_contact}
                        onChange={(e) => f({ emergency_contact: e.target.value })}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                        placeholder="Name — phone number"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Notes
                    </label>
                    <div className="relative">
                      <FileText size={14} className="absolute left-3 top-3 text-gray-500" />
                      <textarea
                        value={form.notes}
                        onChange={(e) => f({ notes: e.target.value })}
                        rows={2}
                        placeholder="Any additional notes..."
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm resize-none"
                      />
                    </div>
                  </div>
                  {editingStaff && (
                    <div className="flex items-center justify-between bg-gray-800 rounded-xl px-4 py-3">
                      <span className="text-white text-sm">Active Staff Member</span>
                      <button onClick={() => f({ is_active: !form.is_active })}>
                        {form.is_active ? (
                          <ToggleRight size={24} className="text-green-400" />
                        ) : (
                          <ToggleLeft size={24} className="text-gray-500" />
                        )}
                      </button>
                    </div>
                  )}
                </>
              )}
              {activeTab === 'security' && (
                <>
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      Email {!isFloorRole(form.role) ? '*' : '(optional)'}
                    </label>
                    <div className="relative">
                      <Mail
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        value={form.email}
                        onChange={(e) => f({ email: e.target.value })}
                        type="email"
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-4 py-3 focus:outline-none focus:border-amber-500 text-sm"
                        placeholder="staff@beeshops.com"
                        disabled={!!editingStaff}
                      />
                    </div>
                    {editingStaff && (
                      <p className="text-gray-500 text-xs mt-1">
                        Email cannot be changed after creation
                      </p>
                    )}
                  </div>
                  {!isFloorRole(form.role) && !editingStaff && (
                    <div>
                      <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                        Password *
                      </label>
                      <div className="relative">
                        <Shield
                          size={14}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                        />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          value={form.password}
                          onChange={(e) => f({ password: e.target.value })}
                          className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-10 py-3 focus:outline-none focus:border-amber-500 text-sm"
                          placeholder="Min. 6 characters"
                        />
                        <button
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                        >
                          {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-gray-400 text-xs uppercase tracking-wide block mb-1">
                      4-Digit PIN *
                    </label>
                    <div className="relative">
                      <Hash
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
                      />
                      <input
                        type={showPin ? 'text' : 'password'}
                        value={form.pin}
                        onChange={(e) => f({ pin: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        className="w-full bg-gray-800 border border-gray-700 text-white rounded-xl pl-9 pr-10 py-3 focus:outline-none focus:border-amber-500 text-sm tracking-widest text-lg"
                        placeholder="••••"
                        maxLength={4}
                      />
                      <button
                        onClick={() => setShowPin(!showPin)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                      >
                        {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <p className="text-gray-500 text-xs mt-1">
                      Used for quick POS login on the floor
                    </p>
                  </div>

                  <div
                    className={`rounded-xl p-4 text-sm ${isFloorRole(form.role) ? 'bg-blue-500/10 border border-blue-500/20 text-blue-300' : 'bg-purple-500/10 border border-purple-500/20 text-purple-300'}`}
                  >
                    {isFloorRole(form.role) ? (
                      <>
                        <p className="font-semibold mb-1">🏃 Floor Staff Access</p>
                        <p className="text-xs opacity-80">
                          This staff member will log in using their 4-digit PIN only. No app account
                          will be created.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold mb-1">🏢 Office Staff Access</p>
                        <p className="text-xs opacity-80">
                          This staff member will log in with their email and password. A PIN is also
                          set for quick POS access if needed.
                        </p>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="p-5 border-t border-gray-800 shrink-0">
              <button
                onClick={saveStaff}
                disabled={saving}
                className="w-full bg-amber-500 hover:bg-amber-400 disabled:bg-gray-700 text-black font-bold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
              >
                <Save size={16} />{' '}
                {saving ? 'Saving...' : editingStaff ? 'Update Staff Member' : 'Add Staff Member'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
