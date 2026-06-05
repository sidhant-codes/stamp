import { useContext } from 'react'
import { Routes, Route } from 'react-router-dom'
import SideBar from './components/SideBar/SideBar'
import ProtectedRoute from './components/ProtectedRoute'
import { AuthContext } from './context/AuthContext'
import Login from './pages/Login/Login'
import Dashboard from './pages/Dashboard/Dashboard'
import Generator from './pages/Generator/Generator'
import History from './pages/History/History'
import Admin from './pages/Admin/Admin'
import ForgotPassword from './pages/ForgotPassword/ForgotPassword'
import ResetPassword from './pages/ResetPassword/ResetPassword'
import VerifyEmail from './pages/VerifyEmail/VerifyEmail'
import Account from './pages/Account/Account'
import VerifyBanner from './components/VerifyBanner'

function App() {
  const { userInfo } = useContext(AuthContext)

  return (
    <div className="App">
      {userInfo && <SideBar />}
      <div className="main-col">
      <VerifyBanner />
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/forgot" element={<ForgotPassword />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/generator" element={<ProtectedRoute><Generator /></ProtectedRoute>} />
        <Route path="/history" element={<ProtectedRoute><History /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute adminOnly><Admin /></ProtectedRoute>} />
        <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
        <Route path="/verify" element={<VerifyEmail />} />
      </Routes>
      </div>
    </div>
  )
}

export default App
