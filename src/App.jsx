import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import Login from './pages/auth/Login'
import Executive from './pages/executive/Executive'
import POS from './pages/pos/POS'
import Management from './pages/management/Management'

function PrivateRoute({ children }) {
  const { user, loading } = useAuth()
  
  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500 text-xl">Loading...</div>
    </div>
  )
  
  return user ? children : <Navigate to="/login" />
}

function RoleRoute() {
  const { profile, loading } = useAuth()

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-amber-500 text-xl">Loading...</div>
    </div>
  )

  if (!profile) return <Navigate to="/login" />

  switch (profile.role) {
    case 'owner': return <Navigate to="/executive" />
    case 'manager': return <Navigate to="/management" />
    case 'accountant': return <Navigate to="/accounting" />
    case 'waitron': return <Navigate to="/pos" />
    default: return <Navigate to="/login" />
  }
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={
          <PrivateRoute>
            <RoleRoute />
          </PrivateRoute>
        } />
        <Route path="/executive" element={
          <PrivateRoute>
            <Executive />
          </PrivateRoute>
        } />
        <Route path="/pos" element={
          <PrivateRoute>
            <POS />
          </PrivateRoute>
        } />
        <Route path="/management" element={
          <PrivateRoute>
            <Management />
          </PrivateRoute>
        } />
        <Route path="/" element={<Navigate to="/dashboard" />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App