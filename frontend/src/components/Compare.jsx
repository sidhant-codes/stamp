import styles from './Compare.module.css'

// Lowercased word without surrounding punctuation ("C#", "C++" keep theirs); '' for Markdown markers like "#" or "-".
const norm = (w) => {
  const core = w.toLowerCase().replace(/^[^a-z0-9+#]+|[^a-z0-9+#]+$/g, '')
  return /[a-z0-9]/.test(core) ? core : ''
}
const words = (text) => new Set(text.split(/\s+/).map(norm).filter(Boolean))

// Keeps the text's own spacing; wraps words that `other` does not contain.
const mark = (text, other, className) =>
  text.split(/(\s+)/).map((part, i) => {
    const w = norm(part)
    return w && !other.has(w) ? <mark key={i} className={className}>{part}</mark> : part
  })

// Before/after view of an improved resume: words the rewrite added, and words of the original it no longer uses.
// ponytail: word-set comparison, not a positional diff, so reordered text is not flagged; a real diff if users need it.
const Compare = ({ original, improved }) => {
  const before = words(original)
  const after = words(improved)
  return (
    <div className={styles.compare}>
      <section aria-label="Original resume">
        <h3>Original</h3>
        <p className="muted">Struck through: not in the new version</p>
        <pre>{mark(original, after, styles.gone)}</pre>
      </section>
      <section aria-label="Improved resume">
        <h3>Improved</h3>
        <p className="muted">Highlighted: new wording</p>
        <pre>{mark(improved, before, styles.added)}</pre>
      </section>
    </div>
  )
}

export default Compare
