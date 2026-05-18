import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import Compare from '../../components/Compare'
import api, { DRAFT_KEY, TEMPLATES, downloadResume, errorMessage } from '../../services/api'
import styles from './Generator.module.css'

const FIELDS = [
  { key: 'name', label: 'Full name *', rows: 1 },
  { key: 'contact', label: 'Email / phone / LinkedIn / location', rows: 1 },
  { key: 'skills', label: 'Skills * (comma separated)', rows: 2 },
  { key: 'experience', label: 'Work experience (roles, companies, dates, what you did)', rows: 5 },
  { key: 'projects', label: 'Projects', rows: 4 },
  { key: 'education', label: 'Education', rows: 3 },
  { key: 'job_desc', label: 'Target job description (optional, to tailor the resume)', rows: 5 },
]

// The form survives reloads and navigation; storage can be unavailable (private mode), so failures are ignored.
const loadDraft = () => {
  try {
    return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}
  } catch {
    return {}
  }
}

const Generator = () => {
  // Set when "Improve" sends a rewritten resume here: { resume, id, name, template, coverage, score, original }.
  const improved = useLocation().state?.improved
  const [form, setForm] = useState(loadDraft)
  const [resume, setResume] = useState(improved?.resume || '')
  const [id, setId] = useState(improved?.id || null) // saved copy on the server
  const [name, setName] = useState(improved?.name || '') // for file names
  const [template, setTemplate] = useState(improved?.template || 'modern')
  const [gains, setGains] = useState(improved ? { coverage: improved.coverage, score: improved.score, original: improved.original } : null)
  const [comparing, setComparing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch {}
  }, [form])

  const flash = (text) => {
    setNote(text)
    setTimeout(() => setNote(''), 1800)
  }

  const copy = async () => {
    await navigator.clipboard.writeText(resume)
    flash('Copied')
  }

  const handleGenerate = async () => {
    setError('')
    if (!form.name?.trim() || !form.skills?.trim()) {
      setError('Name and skills are required.')
      return
    }
    setLoading(true)
    try {
      const { data } = await api.post('/api/resume/generate', { ...form, template })
      setResume(data.resume)
      setId(data.id)
      setName(form.name)
      setGains(null)
      setComparing(false)
      setEditing(false)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const saveEdits = async () => {
    setError('')
    try {
      await api.put(`/api/resume/generated/${id}`, { content: resume })
      setEditing(false)
      flash('Saved')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  // The choice is saved with the resume so History exports it the same way.
  const pickTemplate = (value) => {
    setTemplate(value)
    if (id) api.put(`/api/resume/generated/${id}`, { template: value }).catch((err) => setError(errorMessage(err)))
  }

  const exportAs = (format) => downloadResume(resume, name, format, template).catch((err) => setError(errorMessage(err)))

  const download = () => {
    const url = URL.createObjectURL(new Blob([resume], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(name || 'resume').trim().replace(/\s+/g, '_')}_resume.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="page">
      <div className={styles.Generator}>
        <section className={`card ${styles.panel}`}>
          <h1>Resume Generator</h1>
          {FIELDS.map(({ key, label, rows }) => (
            <textarea
              key={key}
              className={`field ${styles.field}`}
              placeholder={label}
              aria-label={label}
              rows={rows}
              value={form[key] || ''}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          ))}
          <div className={styles.actions}>
            <button type="button" className="btn" onClick={handleGenerate} disabled={loading}>
              {loading ? 'Generating...' : 'Generate'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setForm({})} disabled={loading}>Clear</button>
          </div>
          {error && <div className="error-text" role="alert">{error}</div>}
        </section>

        {resume && (
          <section className={`card ${styles.panel}`}>
            <h1>{gains ? 'Your Improved Resume' : 'Your Resume'}</h1>
            {gains && (
              <div className={styles.coverage}>
                {gains.score && (
                  <p className={styles.scoreLine}>
                    Match score {gains.score.before}% → <strong className={gains.score.after > gains.score.before ? styles.up : ''}>{gains.score.after}%</strong>
                  </p>
                )}
                <p>
                  Job keywords covered: {gains.coverage.before} → <strong>{gains.coverage.after}</strong> of {gains.coverage.total}.{' '}
                  {gains.score
                    ? 'The new score is saved in your History. Edits you make here are not re-scored.'
                    : 'Export it and run the Analyzer again to see your new score.'}
                </p>
              </div>
            )}
            <fieldset className={styles.templates}>
              <legend>Template</legend>
              {TEMPLATES.map(([value, label]) => (
                <label key={value} className={template === value ? styles.picked : ''}>
                  <input type="radio" name="template" value={value} checked={template === value} onChange={() => pickTemplate(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
            {editing ? (
              <textarea className={`field ${styles.field}`} aria-label="Edit resume" rows={22} value={resume} onChange={(e) => setResume(e.target.value)} />
            ) : comparing ? (
              <Compare original={gains.original} improved={resume} />
            ) : (
              <div className={`${styles.output} ${styles[template]}`}><ReactMarkdown>{resume}</ReactMarkdown></div>
            )}
            <div className={styles.actions}>
              {editing ? (
                <button type="button" className="btn" onClick={saveEdits}>Save changes</button>
              ) : (
                <button type="button" className="btn ghost" onClick={() => setEditing(true)}>Edit</button>
              )}
              {gains?.original && !editing && (
                <button type="button" className="btn ghost" aria-pressed={comparing} onClick={() => setComparing(!comparing)}>
                  {comparing ? 'Show resume' : 'Compare with original'}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={copy}>Copy</button>
              <button type="button" className="btn ghost" onClick={() => exportAs('pdf')}>PDF</button>
              <button type="button" className="btn ghost" onClick={() => exportAs('docx')}>Word</button>
              <button type="button" className="btn ghost" onClick={download}>.md</button>
            </div>
            <p className="muted" role="status">{note || 'Saved to your History automatically.'}</p>
          </section>
        )}
      </div>
    </main>
  )
}

export default Generator
