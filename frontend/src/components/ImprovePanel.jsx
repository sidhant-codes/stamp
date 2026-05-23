import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api, { errorMessage } from '../services/api'
import styles from './ImprovePanel.module.css'

// "Improve this resume" for one analysis: tick missing keywords you really have, rewrite, open in the Generator.
// Used on the Analyzer page and in History; give it key={analysis._id} so ticks reset per analysis.
const ImprovePanel = ({ analysis }) => {
  const [confirmed, setConfirmed] = useState([])
  const [improving, setImproving] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const missing = analysis.keywords_missing || []

  const toggle = (k) => setConfirmed((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]))

  const improve = async () => {
    setError('')
    setImproving(true)
    try {
      const { data } = await api.post(`/api/resume/improve/${analysis._id}`, { confirmed })
      navigate('/generator', { state: { improved: data } })
    } catch (err) {
      setError(errorMessage(err))
      setImproving(false)
    }
  }

  return (
    <div className={styles.panel}>
      <p className={styles.text}>
        AI rewrites your resume for this job: most relevant work first, the job's wording where your experience matches, and the
        suggestions applied, then scores the new version against this job. It only uses what is already in your resume.
      </p>
      {missing.length > 0 && (
        <fieldset className={styles.confirm}>
          <legend>Tick the missing skills you genuinely have, so they can be added:</legend>
          {missing.map((k) => (
            <label key={k}>
              <input type="checkbox" checked={confirmed.includes(k)} onChange={() => toggle(k)} /> {k}
            </label>
          ))}
        </fieldset>
      )}
      <button type="button" className="btn" onClick={improve} disabled={improving}>
        {improving ? 'Improving...' : 'Improve my resume'}
      </button>
      {error && <div className="error-text" role="alert">{error}</div>}
    </div>
  )
}

export default ImprovePanel
