import { useContext, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import api, { errorMessage } from '../../services/api'
import { AuthContext } from '../../context/AuthContext'
import styles from '../Login/Login.module.css'

const VerifyEmail = () => {
  const [params] = useSearchParams()
  const { markVerified } = useContext(AuthContext)
  const token = params.get('token')
  const email = params.get('email')
  const [status, setStatus] = useState(token && email ? 'working' : 'bad')
  const [error, setError] = useState('This verification link is incomplete.')

  useEffect(() => {
    if (!token || !email) return
    api
      .post('/api/user/verify', { email, token })
      .then(() => {
        markVerified()
        setStatus('done')
      })
      .catch((err) => {
        setError(errorMessage(err))
        setStatus('bad')
      })
  }, [token, email, markVerified])

  return (
    <div className={styles.Login}>
      <div className={styles.loginCard}>
        <div className={styles.loginCardTitle}>
          <h1>Verify email</h1>
          <VpnKeyIcon />
        </div>
        {status === 'working' && <p role="status">Verifying...</p>}
        {status === 'done' && <p role="status">Your email is verified. You can now use the analyzer and generator.</p>}
        {status === 'bad' && <p className="error-text" role="alert">{error} Log in and use the "Resend" button to get a new link.</p>}
        <Link className={styles.switch} to="/dashboard">Continue</Link>
      </div>
    </div>
  )
}

export default VerifyEmail
