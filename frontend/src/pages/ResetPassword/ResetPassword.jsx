import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import api, { errorMessage } from '../../services/api'
import styles from '../Login/Login.module.css'

const ResetPassword = () => {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token')
  const email = params.get('email')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await api.post('/api/user/reset', { email, token, password })
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.Login}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <div className={styles.loginCardTitle}>
          <h1>New password</h1>
          <VpnKeyIcon />
        </div>

        {!token || !email ? (
          <p className={`error-text ${styles.error}`} role="alert">This reset link is incomplete. Request a new one.</p>
        ) : (
          <>
            <input className={`field ${styles.input}`} type="password" placeholder="New password" aria-label="New password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            {error && <p className={`error-text ${styles.error}`} role="alert">{error}</p>}
            <button type="submit" className={`btn ${styles.submitBtn}`} disabled={busy}>
              {busy ? 'Please wait...' : 'Update password'}
            </button>
          </>
        )}
        <Link className={styles.switch} to="/forgot">Request a new link</Link>
      </form>
    </div>
  )
}

export default ResetPassword
