import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../../services/api'
import { AuthContext } from '../../context/AuthContext'

const Account = () => {
  const { userInfo, logout } = useContext(AuthContext)
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleDelete = async (e) => {
    e.preventDefault()
    if (!window.confirm('Permanently delete your account and all your analyses and resumes?')) return
    setError('')
    setBusy(true)
    try {
      await api.delete('/api/user/me', { data: { password } })
      logout()
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <main className="page">
      <h1 className="page-title">Account</h1>
      <section className="card" style={{ maxWidth: 480 }}>
        <p><strong>{userInfo.name}</strong><br />{userInfo.email}</p>
        <h2>Delete account</h2>
        <p className="muted">This removes your profile, analysis history and generated resumes. It cannot be undone.</p>
        <form onSubmit={handleDelete}>
          <input className="field" type="password" placeholder="Confirm with your password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="error-text" role="alert">{error}</p>}
          <button type="submit" className="btn" style={{ marginTop: 16 }} disabled={busy}>{busy ? 'Deleting...' : 'Delete my account'}</button>
        </form>
      </section>
    </main>
  )
}

export default Account
