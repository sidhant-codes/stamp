import { useCallback, useEffect, useState } from 'react'
import { Skeleton } from '@mui/material'
import api, { errorMessage } from '../../services/api'
import Pager from '../../components/Pager'
import styles from './Admin.module.css'

const tone = (score) => (score >= 70 ? 'high' : score < 40 ? 'low' : '')

const Admin = () => {
  const [data, setData] = useState([])
  const [pg, setPg] = useState({ page: 1, pages: 1 })
  const [loader, setLoader] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback((page) => {
    setLoader(true)
    api
      .get('/api/resume/all', { params: { page, limit: 12 } })
      .then((res) => {
        setData(res.data.resumes)
        setPg({ page: res.data.page, pages: res.data.pages })
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoader(false))
  }, [])

  useEffect(() => load(1), [load])

  return (
    <main className="page">
      <h1 className="page-title">All analyses</h1>
      <div className={styles.grid}>
        {loader &&
          [0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" width="100%" height={240} sx={{ borderRadius: '14px' }} />
          ))}
        {!loader &&
          data.map((item) => (
            <article key={item._id} className={`card ${styles.item}`}>
              <h2>{item.user?.name}</h2>
              <p className={styles.email}>{item.user?.email}</p>
              <div className={`score ${tone(item.score)}`}>{item.score}%</div>
              <p>{item.feedback}</p>
            </article>
          ))}
      </div>
      <Pager page={pg.page} pages={pg.pages} onChange={load} />
      {error && <p className="error-text" role="alert">{error}</p>}
      {!loader && !error && data.length === 0 && <p className="muted">No analyses from any user yet.</p>}
    </main>
  )
}

export default Admin
