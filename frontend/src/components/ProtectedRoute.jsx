import { useContext } from 'react'
import { Navigate } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'

const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { userInfo, loading } = useContext(AuthContext)
  if (loading) return null
  if (!userInfo) return <Navigate to="/" replace />
  if (adminOnly && userInfo.role !== 'admin') return <Navigate to="/dashboard" replace />
  return children
}

export default ProtectedRoute
