import { useContext, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import { errorMessage } from '../../services/api'
import { AuthContext } from '../../context/AuthContext'
import styles from './Login.module.css'

const Login = () => {
  const { userInfo, authenticate } = useContext(AuthContext)
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (userInfo) navigate('/dashboard', { replace: true })
  }, [userInfo, navigate])

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await authenticate(mode, form)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const isLogin = mode === 'login'

  return (
    <div className={styles.Login}>
      <form className={styles.loginCard} onSubmit={handleSubmit}>
        <p className={styles.brand}>Stamp</p>
        <div className={styles.loginCardTitle}>
          <h1>{isLogin ? 'Login' : 'Sign up'}</h1>
          <VpnKeyIcon />
        </div>

        {!isLogin && (
          <input className={`field ${styles.input}`} placeholder="Name" aria-label="Name" autoComplete="name" value={form.name} onChange={set('name')} required />
        )}
        <input className={`field ${styles.input}`} type="email" placeholder="Email" aria-label="Email" autoComplete="email" value={form.email} onChange={set('email')} required />
        <input className={`field ${styles.input}`} type="password" placeholder="Password" aria-label="Password" autoComplete={isLogin ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} required minLength={6} />

        {error && <p className={`error-text ${styles.error}`} role="alert">{error}</p>}

        <button type="submit" className={`btn ${styles.submitBtn}`} disabled={busy}>
          {busy ? 'Please wait...' : isLogin ? 'Login' : 'Create account'}
        </button>
        {isLogin && <Link className={styles.switch} to="/forgot">Forgot password?</Link>}
        <button type="button" className={styles.switch} onClick={() => { setMode(isLogin ? 'register' : 'login'); setError('') }}>
          {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Login'}
        </button>
      </form>
    </div>
  )
}

export default Login
