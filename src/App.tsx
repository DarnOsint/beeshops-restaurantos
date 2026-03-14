import { useEffect } from 'react'
import { useNotifications } from './hooks/useNotifications'
import AppShell from './components/AppShell'
import NotificationToast from './components/NotificationToast'
import ErrorBoundary from './components/ErrorBoundary'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import MFAChallenge from './components/MFAChallenge'
import Login from './pages/auth/Login'
import Executive from './pages/executive/Executive'
import POS from './pages/pos/POS'
import Management from './pages/management/Management'
import KitchenKDS from './pages/kds/KitchenKDS'
import BarKDS from './pages/kds/BarKDS'
import GrillerKDS from './pages/kds/GrillerKDS'
import BackOffice from './pages/backoffice/BackOffice'
import QRTableCards from './pages/backoffice/QRTableCards'
import Accounting from './pages/accounting/Accounting'
import RoomManagement from './pages/rooms/RoomManagement'
import Debtors from './pages/accounting/Debtors'
import Reports from './pages/reports/Reports'
import Analytics from './pages/analytics/Analytics'
import ApartmentDashboard from './pages/apartment/ApartmentDashboard'
import SupervisorDashboard from './pages/supervisor/SupervisorDashboard'
import TableView from './pages/customer/TableView'
import ReceiptView from './pages/customer/ReceiptView'
import type { Role } from './types'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    // AppShell's <main> is the scroll container — window.scrollTo has no effect
    const main = document.getElementById('main-scroll')
    if (main) {
      main.scrollTop = 0
    } else {
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
  }, [pathname])
  return null
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, profile, loading, mfaRequired, setMfaVerified, signOut } = useAuth()
  if (!loading && mfaRequired)
    return (
      <MFAChallenge
        user={user}
        profile={profile}
        onVerified={() => setMfaVerified(true)}
        onSignOut={signOut}
      />
    )
  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )
  if (!user) return <Navigate to="/login" />
  return <>{children}</>
}

function RoleGuard({ children, allowed }: { children: React.ReactNode; allowed: Role[] }) {
  const { user, profile, loading, mfaRequired, setMfaVerified, signOut } = useAuth()
  if (!loading && mfaRequired)
    return (
      <MFAChallenge
        user={user}
        profile={profile}
        onVerified={() => setMfaVerified(true)}
        onSignOut={signOut}
      />
    )
  if (loading)
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-amber-500">Loading...</div>
      </div>
    )
  if (!profile) return <Navigate to="/login" />
  if (!allowed.includes(profile.role as Role)) return <Navigate to="/dashboard" />
  return <>{children}</>
}

function RoleRoute() {
  const { user, profile, loading, mfaRequired, setMfaVerified, signOut } = useAuth()
  if (!loading && mfaRequired)
    return (
      <MFAChallenge
        user={user}
        profile={profile}
        onVerified={() => setMfaVerified(true)}
        onSignOut={signOut}
      />
    )
  if (loading)
    return (
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
  if (profile.role === 'apartment_manager') return <Navigate to="/apartment" />
  if (profile.role === 'supervisor') return <Navigate to="/supervisor" />
  return <Navigate to="/login" />
}

const EB = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <ErrorBoundary title={title}>{children}</ErrorBoundary>
)

function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <RoleRoute />
            </PrivateRoute>
          }
        />

        <Route
          path="/executive"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner']}>
                <EB title="Dashboard error">
                  <Executive />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/management"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager']}>
                <EB title="Management error">
                  <Management />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/accounting"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'accountant']}>
                <EB title="Accounting error">
                  <Accounting />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/backoffice"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager']}>
                <EB title="Back office error">
                  <BackOffice />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/backoffice/qr-cards"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'executive'] as Role[]}>
                <EB title="QR cards error">
                  <QRTableCards />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/pos"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'waitron']}>
                <EB title="POS error">
                  <POS />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/kds/kitchen"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'kitchen']}>
                <EB title="Kitchen display error">
                  <KitchenKDS />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/kds/bar"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'bar']}>
                <EB title="Bar display error">
                  <BarKDS />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/kds/griller"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'griller']}>
                <EB title="Grill display error">
                  <GrillerKDS />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/rooms"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager']}>
                <EB title="Room management error">
                  <RoomManagement />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/debtors"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'accountant']}>
                <EB title="Debtors error">
                  <Debtors onBack={() => window.history.back()} />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager']}>
                <EB title="Reports error">
                  <Reports />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager']}>
                <EB title="Analytics error">
                  <Analytics />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/supervisor"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'manager', 'supervisor'] as Role[]}>
                <SupervisorDashboard />
              </RoleGuard>
            </PrivateRoute>
          }
        />
        <Route
          path="/apartment"
          element={
            <PrivateRoute>
              <RoleGuard allowed={['owner', 'apartment_manager']}>
                <EB title="Apartment dashboard error">
                  <ApartmentDashboard />
                </EB>
              </RoleGuard>
            </PrivateRoute>
          }
        />

        {/* Public customer routes */}
        <Route
          path="/table/:tableId"
          element={
            <EB title="Order page error">
              <TableView />
            </EB>
          }
        />
        <Route
          path="/receipt/:orderId"
          element={
            <EB title="Receipt error">
              <ReceiptView />
            </EB>
          }
        />

        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </>
  )
}

function AppInner() {
  const { profile } = useAuth()
  const { toasts, dismiss } = useNotifications(profile)
  return (
    <>
      <NotificationToast toasts={toasts} onDismiss={dismiss} />
      <AppShell>
        <AppRoutes />
      </AppShell>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
