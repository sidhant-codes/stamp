import { useContext, useState } from 'react'
import api, { errorMessage } from '../services/api'
import { AuthContext } from '../context/AuthContext'

const VerifyBanner = () => {
  const { userInfo } = useContext(AuthContext)
  const [msg, setMsg] = useState('')
  if (!userInfo || userInfo.emailVerified) return null

  const resend = async () => {
    try {
      const { data } = await api.post('/api/user/resend-verification')
      setMsg(data.message)
    } catch (err) {
      setMsg(errorMessage(err))
    }
  }

  return (
    <div role="status" style={{ background: '#fff4e5', color: '#663c00', padding: '10px 20px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <span>Verify your email ({userInfo.email}) to use the analyzer and generator.</span>
      <button type="button" className="btn ghost" onClick={resend}>Resend link</button>
      {msg && <span>{msg}</span>}
    </div>
  )
}

export default VerifyBanner
