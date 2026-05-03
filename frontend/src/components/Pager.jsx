const Pager = ({ page, pages, onChange }) =>
  pages > 1 && (
    <nav aria-label="Pagination" style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 24 }}>
      <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
      <span className="muted">Page {page} of {pages}</span>
      <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
    </nav>
  )

export default Pager
