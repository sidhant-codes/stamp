import { useState } from 'react'
import { Link } from 'react-router-dom'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import api, { errorMessage } from '../../services/api'
import styles from '../Login/Login.module.css'

const ForgotPassword = () => {
  const [email, setEmail] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const { data } = await api.post('/api/user/forgot', { email })
      setNotice(data.message)
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
          <h1>Forgot password</h1>
          <VpnKeyIcon />
        </div>

        <input className={`field ${styles.input}`} type="email" placeholder="Email" aria-label="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />

        {error && <p className={`error-text ${styles.error}`} role="alert">{error}</p>}
        {notice && <p className={styles.notice} role="status">{notice}</p>}

        <button type="submit" className={`btn ${styles.submitBtn}`} disabled={busy}>
          {busy ? 'Please wait...' : 'Send reset link'}
        </button>
        <Link className={styles.switch} to="/">Back to login</Link>
      </form>
    </div>
  )
}

export default ForgotPassword
