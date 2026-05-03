import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@mui/material'
import ReactMarkdown from 'react-markdown'
import api, { downloadResume, errorMessage } from '../../services/api'
import Pager from '../../components/Pager'
import AnalysisResult, { hasDetails } from '../../components/AnalysisResult'
import ImprovePanel from '../../components/ImprovePanel'
import styles from './History.module.css'

const tone = (score) => (score >= 70 ? 'high' : score < 40 ? 'low' : '')

// Scores of the listed analyses, oldest to newest, as a tiny line chart.
const Trend = ({ items }) => {
  const scores = items.map((i) => i.score).reverse()
  if (scores.length < 2) return null
  const w = 240
  const h = 48
  const pts = scores.map((s, i) => `${(i / (scores.length - 1)) * w},${h - (s / 100) * h}`).join(' ')
  return (
    <figure className={`card ${styles.trend}`}>
      <figcaption className="muted">Score trend on this page ({scores.length} analyses, oldest to newest)</figcaption>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Scores: ${scores.join(', ')}`} width="100%" height={h} preserveAspectRatio="none">
        <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
    </figure>
  )
}

const Analyses = () => {
  const [data, setData] = useState({ resumes: [], page: 1, pages: 1 })
  const [loader, setLoader] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  const load = useCallback((page) => {
    setLoader(true)
    api
      .get('/api/resume/history', { params: { page, limit: 12 } })
      .then((res) => setData(res.data))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoader(false))
  }, [])

  useEffect(() => load(1), [load])

  const remove = async (id) => {
    if (!window.confirm('Delete this analysis?')) return
    try {
      await api.delete(`/api/resume/history/${id}`)
      load(data.resumes.length === 1 && data.page > 1 ? data.page - 1 : data.page)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <>
      <Trend items={data.resumes} />
      <div className={styles.grid}>
        {loader && [0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rectangular" width="100%" height={200} sx={{ borderRadius: '14px' }} />)}
        {!loader &&
          data.resumes.map((item) => (
            <article key={item._id} className={`card ${styles.item}`}>
              <div className={`score ${tone(item.score)}`}>{item.score}%</div>
              <h2>{item.resume_name}</h2>
              <p>{item.feedback}</p>
              {open === item._id && (
                <>
                  <AnalysisResult result={item} />
                  {item.improvable ? (
                    <ImprovePanel key={item._id} analysis={item} />
                  ) : (
                    <p className="muted">Analyze this resume again to be able to improve it.</p>
                  )}
                </>
              )}
              <time className="muted" dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time>
              <div className={styles.row}>
                {(hasDetails(item) || item.improvable) && (
                  <button type="button" className="btn ghost" onClick={() => setOpen(open === item._id ? null : item._id)}>
                    {open === item._id ? 'Hide' : 'Details'}
                  </button>
                )}
                <button type="button" className="btn ghost" onClick={() => remove(item._id)}>Delete</button>
              </div>
            </article>
          ))}
      </div>
      <Pager page={data.page} pages={data.pages} onChange={load} />
      {error && <p className="error-text" role="alert">{error}</p>}
      {!loader && !error && data.resumes.length === 0 && (
        <p className={`muted ${styles.empty}`}>No analyses yet. Run one from the Analyzer and it will show up here.</p>
      )}
    </>
  )
}

const Generated = () => {
  const [items, setItems] = useState([])
  const [loader, setLoader] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    api
      .get('/api/resume/generated')
      .then((res) => setItems(res.data.resumes))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoader(false))
  }, [])

  const remove = async (id) => {
    if (!window.confirm('Delete this resume?')) return
    try {
      await api.delete(`/api/resume/generated/${id}`)
      setItems((list) => list.filter((i) => i._id !== id))
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const exportAs = (item, format) => downloadResume(item.content, item.name, format, item.template).catch((e) => setError(errorMessage(e)))

  return (
    <>
      <div className={styles.grid}>
        {loader && [0, 1].map((i) => <Skeleton key={i} variant="rectangular" width="100%" height={200} sx={{ borderRadius: '14px' }} />)}
        {items.map((item) => (
          <article key={item._id} className={`card ${styles.item}`}>
            <h2>{item.name}</h2>
            <time className="muted" dateTime={item.createdAt}>
              {item.createdAt.slice(0, 10)} · {item.template || 'modern'} template
            </time>
            {open === item._id && <div className={styles.preview}><ReactMarkdown>{item.content}</ReactMarkdown></div>}
            <div className={styles.row}>
              <button type="button" className="btn ghost" onClick={() => setOpen(open === item._id ? null : item._id)}>{open === item._id ? 'Hide' : 'View'}</button>
              <button type="button" className="btn ghost" onClick={() => exportAs(item, 'pdf')}>PDF</button>
              <button type="button" className="btn ghost" onClick={() => exportAs(item, 'docx')}>Word</button>
              <button type="button" className="btn ghost" onClick={() => remove(item._id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {!loader && !error && items.length === 0 && <p className={`muted ${styles.empty}`}>No generated resumes yet. Create one in the Generator.</p>}
    </>
  )
}

const History = () => {
  const [tab, setTab] = useState('analyses')
  return (
    <main className="page">
      <h1 className="page-title">History</h1>
      <div className={styles.tabs} role="tablist">
        {[['analyses', 'Analyses'], ['resumes', 'Generated resumes']].map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={`btn ${tab === key ? '' : 'ghost'}`} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'analyses' ? <Analyses /> : <Generated />}
    </main>
  )
}

export default History
