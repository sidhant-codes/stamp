import { createContext, useCallback, useEffect, useState } from 'react'
import api, { DRAFT_KEY, TOKEN_KEY } from '../services/api'

export const AuthContext = createContext()

const AuthProvider = ({ children }) => {
  const [userInfo, setUserInfo] = useState(null) // { _id, name, email, role }
  const [loading, setLoading] = useState(true)

  // Restore the session from the saved token on page load.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setLoading(false)
      return
    }
    api
      .get('/api/user/me')
      .then((res) => setUserInfo(res.data.user))
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setLoading(false))
  }, [])

  // mode: 'login' | 'register'
  const authenticate = async (mode, form) => {
    const { data } = await api.post(`/api/user/${mode}`, form)
    localStorage.setItem(TOKEN_KEY, data.token)
    setUserInfo(data.user)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(DRAFT_KEY)
    setUserInfo(null)
  }

  const markVerified = useCallback(() => setUserInfo((u) => u && { ...u, emailVerified: true }), [])

  return (
    <AuthContext.Provider value={{ userInfo, loading, authenticate, logout, markVerified }}>
      {children}
    </AuthContext.Provider>
  )
}

export default AuthProvider
