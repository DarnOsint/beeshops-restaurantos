import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/auth/Login'
import Executive from './pages/executive/Executive'
import POS from './pages/pos/POS'
import Management from './pages/management/Management'
import KitchenKDS from './pages/kds/KitchenKDS'
import BarKDS from './pages/kds/BarKDS'
import GrillerKDS from './pages/kds/GrillerKDS'
import BackOffice from './pages/backoffice/BackOffice'
import Accounting from './pages/accounting/Accounting'
import RoomManagement from './pages/rooms/RoomManagement'
import TableView from './pages/customer/TableView'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )
  if (!user) return <Navigate to="/login" />
  return children
}

function RoleGuard({ children, allowed }) {
  const { profile, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )
  if (!profile) return <Navigate to="/login" />
  if (!allowed.includes(profile.role)) return <Navigate to="/dashboard" />
  return children
}

function RoleRoute() {
  const { profile, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500">Loading...</div>
    </div>
  )
  if (!profile) return <Navigate to="/login" />
  if (profile.role === 'owner') return <Navigate to="/executive" />
  if (profile.role === 'manager') return <Navigate to="/management" />
  if (profile.role === 'accountant') return <Navigate to="/accounting" />
  if (profile.role === 'waitron') return <Navigate to="/pos" />
  if (profile.role === 'kitchen') return <Navigate to="/kds/kitchen" />
  if (profile.role === 'bar') return <Navigate to="/kds/bar" />
  if (profile.role === 'griller') return <Navigate to="/kds/griller" />
  return <Navigate to="/login" />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<PrivateRoute><RoleRoute /></PrivateRoute>} />

      <Route path="/executive" element={
        <PrivateRoute><RoleGuard allowed={['owner']}><Executive /></RoleGuard></PrivateRoute>
      } />

      <Route path="/management" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager']}><Management /></RoleGuard></PrivateRoute>
      } />

      <Route path="/accounting" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager', 'accountant']}><Accounting /></RoleGuard></PrivateRoute>
      } />

      <Route path="/backoffice" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager']}><BackOffice /></RoleGuard></PrivateRoute>
      } />

      <Route path="/pos" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager', 'waitron']}><POS /></RoleGuard></PrivateRoute>
      } />

      <Route path="/kds/kitchen" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager', 'kitchen']}><KitchenKDS /></RoleGuard></PrivateRoute>
      } />

      <Route path="/kds/bar" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager', 'bar']}><BarKDS /></RoleGuard></PrivateRoute>
      } />

      <Route path="/kds/griller" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager', 'griller']}><GrillerKDS /></RoleGuard></PrivateRoute>
      } />

      <Route path="/rooms" element={
        <PrivateRoute><RoleGuard allowed={['owner', 'manager']}><RoomManagement /></RoleGuard></PrivateRoute>
      } />

      {/* Public route — no auth required */}
      <Route path="/table/:tableId" element={<TableView />} />

      <Route path="/" element={<Navigate to="/dashboard" />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App