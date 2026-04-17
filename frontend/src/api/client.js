import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
})

// Session
export const createSession = () => api.post('/session/create')

// Agent 1 — Requirement
export const startRequirement = (session_id, feature_request) =>
  api.post('/requirement/start', { session_id, feature_request })

export const respondRequirement = (session_id, answer) =>
  api.post('/requirement/respond', { session_id, answer })

export const getRequirementState = (session_id) =>
  api.get(`/requirement/${session_id}`)

// Agent 2 — Research
export const generateResearch = (session_id) =>
  api.post('/research/generate', { session_id })

export const submitResearchFeedback = (session_id, feedback, sections_to_regenerate = null) =>
  api.post('/research/feedback', { session_id, feedback, sections_to_regenerate })

export const getResearchState = (session_id) =>
  api.get(`/research/${session_id}`)

// Agent 3 — Canvas
export const generateCanvas = (session_id) =>
  api.post('/canvas/generate', { session_id })

export const regenerateSection = (session_id, section_key, instructions = null) =>
  api.post('/canvas/regenerate-section', { session_id, section_key, instructions })

export const updateSectionManually = (session_id, section_key, content) =>
  api.patch('/canvas/section', { session_id, section_key, content })

export const getCanvasState = (session_id) =>
  api.get(`/canvas/${session_id}`)

export const exportCanvas = (session_id, format = 'docx') =>
  api.get(`/canvas/${session_id}/export`, {
    params: { format },
    responseType: 'blob',
  })

// Agent 5 — Prototype Generation
export const generatePrototype = (session_id, brd_content, feature_name = '') =>
  api.post('/prototype/generate', { session_id, brd_content, feature_name })

export const getPrototypeState = (session_id) =>
  api.get(`/prototype/${session_id}`)

// History
export const listHistory = () =>
  api.get('/history')

export const getHistoryDetail = (session_id) =>
  api.get(`/history/${session_id}`)

export const renameHistorySession = (session_id, title) =>
  api.patch(`/history/${session_id}/title`, { title })

export const deleteHistorySession = (session_id) =>
  api.delete(`/history/${session_id}`)

// ── Document Generation (DocGen service on port 8001) ─────────────────────
const docgenApi = axios.create({
  baseURL: import.meta.env.VITE_DOCGEN_URL || 'http://localhost:8001',
  headers: { 'Content-Type': 'application/json' },
})

// Start a bundle job (BRD + TSD + Product Note + Circular in parallel)
export const generateDocBundle = (payload) =>
  docgenApi.post('/api/generate/bundle', payload)

// Poll bundle status
export const getBundleStatus = (bundle_id) =>
  docgenApi.get(`/api/bundles/${bundle_id}`)

// Download individual document
export const downloadDoc = (job_id) =>
  docgenApi.get(`/api/download/${job_id}`, { responseType: 'blob' })

// Download entire bundle as ZIP
export const downloadBundle = (bundle_id) =>
  docgenApi.get(`/api/bundles/${bundle_id}/download`, { responseType: 'blob' })

// Get job content as markdown (for inline preview)
export const getJobContent = (job_id) =>
  docgenApi.get(`/api/jobs/${job_id}/content`)

// DocGen health check
export const docgenHealth = () =>
  docgenApi.get('/api/health')
