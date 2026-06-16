import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import Login from '../pages/Login/Login'
import Generator from '../pages/Generator/Generator'
import Dashboard from '../pages/Dashboard/Dashboard'
import History from '../pages/History/History'
import Pager from '../components/Pager'
import AnalysisResult from '../components/AnalysisResult'
import api, { downloadResume } from '../services/api'

vi.mock('../services/api', () => ({
  default: { post: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() },
  errorMessage: (e) => e.response?.data?.message || e.message,
  downloadResume: vi.fn(() => Promise.resolve()),
  TOKEN_KEY: 'token',
  DRAFT_KEY: 'generator-draft',
  TEMPLATES: [['modern', 'Modern'], ['classic', 'Classic'], ['compact', 'Compact']],
}))
vi.mock('react-markdown', () => ({ default: ({ children }) => <div data-testid="md">{children}</div> }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  localStorage.clear()
})

const withAuth = (ui, value = {}) => (
  <MemoryRouter>
    <AuthContext.Provider value={{ userInfo: null, authenticate: vi.fn(), ...value }}>{ui}</AuthContext.Provider>
  </MemoryRouter>
)

describe('Login', () => {
  it('submits email and password', async () => {
    const authenticate = vi.fn().mockResolvedValue()
    render(withAuth(<Login />, { authenticate }))
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'secret12')
    await userEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect(authenticate).toHaveBeenCalledWith('login', { name: '', email: 'a@b.co', password: 'secret12' })
  })

  it('shows the server error message', async () => {
    const authenticate = vi.fn().mockRejectedValue({ response: { data: { message: 'Invalid email or password' } } })
    render(withAuth(<Login />, { authenticate }))
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.type(screen.getByLabelText('Password'), 'secret12')
    await userEvent.click(screen.getByRole('button', { name: 'Login' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
  })
})

describe('Generator', () => {
  it('requires name and skills before calling the API', async () => {
    render(withAuth(<Generator />))
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Name and skills are required')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('shows the generated resume, exports it and saves edits', async () => {
    api.post.mockResolvedValue({ data: { resume: '# Ann', id: 'abc' } })
    api.put.mockResolvedValue({ data: {} })
    render(withAuth(<Generator />))
    await userEvent.type(screen.getByLabelText('Full name *'), 'Ann')
    await userEvent.type(screen.getByLabelText('Skills * (comma separated)'), 'js')
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByTestId('md')).toHaveTextContent('# Ann')

    await userEvent.click(screen.getByRole('button', { name: 'PDF' }))
    expect(downloadResume).toHaveBeenCalledWith('# Ann', 'Ann', 'pdf', 'modern')

    await userEvent.click(screen.getByLabelText('Classic'))
    expect(api.put).toHaveBeenCalledWith('/api/resume/generated/abc', { template: 'classic' })
    await userEvent.click(screen.getByRole('button', { name: 'Word' }))
    expect(downloadResume).toHaveBeenLastCalledWith('# Ann', 'Ann', 'docx', 'classic')

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await userEvent.type(screen.getByLabelText('Edit resume'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/resume/generated/abc', { content: '# Ann!' }))
  })
})

describe('Improve flow', () => {
  it('analyzes, sends ticked keywords to improve, and opens the result in the Generator', async () => {
    api.post
      .mockResolvedValueOnce({ data: { data: { _id: 'a1', score: 40, feedback: 'ok', keywords_matched: [], keywords_missing: ['Docker', 'AWS'] } } })
      .mockResolvedValueOnce({
        data: {
          resume: '# Jane\n- Led APIs',
          original: 'Jane built APIs',
          id: 'g1',
          name: 'Jane',
          template: 'modern',
          coverage: { before: 0, after: 1, total: 2 },
          score: { before: 40, after: 65 },
        },
      })
    render(
      <MemoryRouter>
        <AuthContext.Provider value={{ userInfo: { name: 'Jane' } }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/generator" element={<Generator />} />
          </Routes>
        </AuthContext.Provider>
      </MemoryRouter>
    )
    await userEvent.upload(screen.getByLabelText('Upload resume'), new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }))
    await userEvent.type(screen.getByLabelText('Job description'), 'Need Docker')
    await userEvent.click(screen.getByRole('button', { name: 'Analyze' }))
    await userEvent.click(await screen.findByLabelText('Docker'))
    await userEvent.click(screen.getByRole('button', { name: 'Improve my resume' }))
    expect(api.post).toHaveBeenLastCalledWith('/api/resume/improve/a1', { confirmed: ['Docker'] })
    expect(await screen.findByText('Your Improved Resume')).toBeInTheDocument()
    expect(screen.getByText(/Job keywords covered: 0 →/)).toHaveTextContent('0 → 1 of 2')
    expect(screen.getByText(/Match score/)).toHaveTextContent('Match score 40% → 65%')
    expect(screen.getByTestId('md')).toHaveTextContent('# Jane')

    await userEvent.click(screen.getByRole('button', { name: 'Compare with original' }))
    expect(screen.getByText('Led').tagName).toBe('MARK') // new wording
    expect(screen.getByText('built').tagName).toBe('MARK') // dropped from the original
    expect([...document.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['built', 'Led']) // "Jane", "APIs" are in both
  })

  it('History offers Improve for analyses with stored text, and explains why older ones cannot', async () => {
    const base = { score: 50, feedback: 'ok', createdAt: '2026-10-01T00:00:00Z', keywords_missing: ['Docker'] }
    api.get.mockResolvedValue({
      data: { resumes: [{ ...base, _id: 'n1', resume_name: 'new.pdf', improvable: true }, { ...base, _id: 'o1', resume_name: 'old.pdf', improvable: false }], page: 1, pages: 1 },
    })
    api.post.mockResolvedValueOnce({ data: { resume: '# Jane', id: 'g1', coverage: { before: 0, after: 0, total: 1 }, score: null } })
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<History />} />
          <Route path="/generator" element={<Generator />} />
        </Routes>
      </MemoryRouter>
    )
    const [newer, older] = await screen.findAllByRole('button', { name: 'Details' })
    await userEvent.click(older)
    expect(screen.getByText(/Analyze this resume again/)).toBeInTheDocument()
    await userEvent.click(newer)
    await userEvent.click(screen.getByLabelText('Docker'))
    await userEvent.click(screen.getByRole('button', { name: 'Improve my resume' }))
    expect(api.post).toHaveBeenCalledWith('/api/resume/improve/n1', { confirmed: ['Docker'] })
    expect(await screen.findByText('Your Improved Resume')).toBeInTheDocument()
  })
})

describe('Generator draft', () => {
  it('keeps typed details across a remount and clears them on request', async () => {
    const first = render(withAuth(<Generator />))
    await userEvent.type(screen.getByLabelText('Full name *'), 'Ann')
    first.unmount()
    render(withAuth(<Generator />))
    expect(screen.getByLabelText('Full name *')).toHaveValue('Ann')
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByLabelText('Full name *')).toHaveValue('')
  })
})

describe('AnalysisResult', () => {
  it('shows keyword coverage and grounded rewrites', () => {
    render(
      <AnalysisResult
        result={{ keywords_matched: ['Node.js'], keywords_missing: ['AWS', 'Docker'], suggestions: [{ gap: 'APIs', tip: 'Be specific', rewrite: 'Built Node.js APIs' }] }}
      />
    )
    expect(screen.getByText(/shows 1 of 3 key terms/)).toBeInTheDocument()
    expect(screen.getByText('Built Node.js APIs')).toBeInTheDocument()
    expect(screen.queryByText(/ATS checklist/)).toBeNull()
  })

  it('shows the ATS checklist with pass/fail and details', () => {
    render(
      <AnalysisResult
        result={{ checks: [{ label: 'Email address', pass: true, detail: '' }, { label: 'Length', pass: false, detail: '120 words (aim for 250-1000)' }] }}
      />
    )
    expect(screen.getByText('ATS checklist (1/2 passed)')).toBeInTheDocument()
    expect(screen.getByText('Length').closest('li')).toHaveTextContent('Needs work: Length 120 words')
  })
})

describe('Pager', () => {
  it('renders nothing for a single page and navigates otherwise', async () => {
    const onChange = vi.fn()
    const { container, rerender } = render(<Pager page={1} pages={1} onChange={onChange} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<Pager page={2} pages={3} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(onChange).toHaveBeenCalledWith(3)
  })
})
