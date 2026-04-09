import axios from 'axios'

export const TOKEN_KEY = 'token'
export const DRAFT_KEY = 'generator-draft' // unsent Generator form, cleared on logout
// [value, label] of the resume styles the backend can export (services/export.js TEMPLATES).
export const TEMPLATES = [['modern', 'Modern'], ['classic', 'Classic'], ['compact', 'Compact']]

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export const errorMessage = (err) => err.response?.data?.message || err.message || 'Something went wrong'

// Asks the server to render resume Markdown as a PDF or DOCX and saves the file.
export async function downloadResume(markdown, name, format, template = 'modern') {
  const { data } = await api.post(`/api/resume/export?format=${format}`, { markdown, name, template }, { responseType: 'blob' })
  const url = URL.createObjectURL(data)
  const a = document.createElement('a')
  a.href = url
  a.download = `${(name || 'resume').trim().replace(/\s+/g, '_')}_resume.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

export default api
