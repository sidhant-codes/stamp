import styles from './AnalysisResult.module.css'

// Details of one analysis (strengths, gaps, keywords, suggestions); shared by the Analyzer and History.
const AnalysisResult = ({ result }) => {
  const matched = result.keywords_matched || []
  const missing = result.keywords_missing || []
  const total = matched.length + missing.length
  const checks = result.checks || []
  return (
    <div className={styles.result}>
      {checks.length > 0 && (
        <>
          <h3>ATS checklist ({checks.filter((c) => c.pass).length}/{checks.length} passed)</h3>
          <ul className={styles.checks}>
            {checks.map((c) => (
              <li key={c.label} className={c.pass ? styles.pass : styles.fail}>
                <span aria-hidden="true">{c.pass ? '✓' : '✗'}</span>
                <span>
                  <span className="sr-only">{c.pass ? 'Passed: ' : 'Needs work: '}</span>
                  {c.label}
                  {c.detail && <small> {c.detail}</small>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {result.strengths?.length > 0 && (
        <>
          <h3>Strengths</h3>
          <ul>{result.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}
      {result.gaps?.length > 0 && (
        <>
          <h3>Gaps</h3>
          <ul>{result.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </>
      )}
      {total > 0 && (
        <p className="muted">
          Your resume shows {matched.length} of {total} key terms from the job description.
        </p>
      )}
      {matched.length > 0 && (
        <>
          <h3>Keywords you match</h3>
          <ul className={styles.chips}>{matched.map((k) => <li key={k} className={styles.hit}>{k}</li>)}</ul>
        </>
      )}
      {missing.length > 0 && (
        <>
          <h3>Keywords to add (if true for you)</h3>
          <ul className={styles.chips}>{missing.map((k) => <li key={k} className={styles.miss}>{k}</li>)}</ul>
        </>
      )}
      {result.suggestions?.length > 0 && (
        <>
          <h3>Suggested improvements</h3>
          <ul>
            {result.suggestions.map((s, i) => (
              <li key={i}>
                <strong>{s.gap}</strong> {s.tip}
                {s.rewrite && <blockquote className={styles.rewrite}>{s.rewrite}</blockquote>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export const hasDetails = (r) =>
  [r.strengths, r.gaps, r.keywords_matched, r.keywords_missing, r.suggestions, r.checks].some((list) => list?.length > 0)

export default AnalysisResult
