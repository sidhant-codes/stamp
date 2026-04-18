import { useContext, useState } from 'react'
import Skeleton from '@mui/material/Skeleton'
import CreditScoreIcon from '@mui/icons-material/CreditScore'
import api, { errorMessage } from '../../services/api'
import AnalysisResult from '../../components/AnalysisResult'
import ImprovePanel from '../../components/ImprovePanel'
import { AuthContext } from '../../context/AuthContext'
import styles from './Dashboard.module.css'

const Dashboard = () => {
  const { userInfo } = useContext(AuthContext)
  const [fileName, setFileName] = useState('Upload your resume')
  const [resumeFile, setResumeFile] = useState(null)
  const [jobDesc, setJobDesc] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState('')

  const handleFile = (e) => {
    const file = e.target.files[0]
    if (!file) return
    setResumeFile(file)
    setFileName(file.name)
  }

  const handleAnalyze = async () => {
    setResult(null)
    setError('')
    if (!jobDesc.trim() || !resumeFile) {
      setError('Please paste a job description and upload your resume.')
      return
    }
    const formData = new FormData()
    formData.append('resume', resumeFile)
    formData.append('job_desc', jobDesc)

    setLoading(true)
    try {
      const { data } = await api.post('/api/resume/analyze', formData)
      setResult(data.data)
      setCached(!!data.cached)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const tone = result ? (result.score >= 70 ? 'high' : result.score < 40 ? 'low' : '') : ''

  return (
    <main className="page">
      <div className={styles.Dashboard}>
        <section className="card">
          <header className={styles.header}>
            <p>Smart Resume Screening</p>
            <h1>Resume Match Score</h1>
          </header>

          <ul className={styles.notes}>
            <li>Paste the complete job description before submitting.</li>
            <li>Only PDF (.pdf) resumes up to 5 MB are accepted.</li>
          </ul>

          <div className={styles.upload}>
            <div className={`${styles.fileName} ${resumeFile ? styles.chosen : ''}`} title={fileName}>{fileName}</div>
            <input type="file" accept=".pdf" id="inputField" className={styles.fileInput} onChange={handleFile} />
            <label htmlFor="inputField" className="btn ghost">{resumeFile ? 'Change file' : 'Upload resume'}</label>
          </div>

          <textarea
            value={jobDesc}
            onChange={(e) => setJobDesc(e.target.value)}
            className={`field ${styles.textArea}`}
            placeholder="Paste the job description"
            aria-label="Job description"
            rows={10}
          />
          <button type="button" className="btn" onClick={handleAnalyze} disabled={loading}>
            {loading ? 'Analyzing...' : 'Analyze'}
          </button>
          {error && <div className="error-text" role="alert">{error}</div>}
        </section>

        <aside className={styles.side} aria-live="polite">
          <div className="card">
            <p className={styles.hello}>Analyze with AI</p>
            <h2>{userInfo?.name}</h2>
          </div>

          {loading && <Skeleton variant="rectangular" sx={{ borderRadius: '14px' }} width="100%" height={240} />}

          {result && (
            <div className="card">
              <p className={styles.hello}>Match score</p>
              <div className={`${styles.bigScore} score ${tone}`}>
                {result.score}%
                <CreditScoreIcon sx={{ fontSize: 32 }} />
              </div>
              <h3>Feedback</h3>
              <p>{result.feedback}</p>
              <AnalysisResult result={result} />
              {cached && <p className="muted">Same resume and job description as before, so this is your saved result (no quota used).</p>}
            </div>
          )}

          {result && (
            <div className="card">
              <p className={styles.hello}>Raise your score</p>
              <h2>Improve this resume</h2>
              <ImprovePanel key={result._id} analysis={result} />
            </div>
          )}
        </aside>
      </div>
    </main>
  )
}

export default Dashboard
