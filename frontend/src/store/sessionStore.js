import { create } from 'zustand'

const getInitialTheme = () => {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('cop-theme')
    if (stored) return stored
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  }
  return 'light'
}

const useSessionStore = create((set, get) => ({
  // ── Auth ──────────────────────────────────────────────────
  isAuthenticated: false,
  user: null,
  login: (userData) => set({ isAuthenticated: true, user: userData }),
  logout: () => set({
    isAuthenticated: false,
    user: null,
    sessionId: null,
    currentStep: 'requirement',
    currentView: 'app',
    requirementMessages: [],
    requirementStatus: 'idle',
    questionsAsked: 0,
    structuredOutput: null,
    researchReport: null,
    researchStatus: 'idle',
    researchVersions: [],
    canvas: null,
    canvasStatus: 'idle',
    canvasVersions: [],
    docBundle: null,
    docStatus: 'idle',
    loading: false,
    error: null,
  }),

  // ── Theme ─────────────────────────────────────────────────
  theme: getInitialTheme(),
  setTheme: (theme) => {
    localStorage.setItem('cop-theme', theme)
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
    set({ theme })
  },

  // ── View: 'app' | 'history' ───────────────────────────────
  currentView: 'app',
  setView: (view) => set({ currentView: view }),

  // ── Session ───────────────────────────────────────────────
  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),

  // ── Step tracking: 'requirement' | 'research' | 'canvas' ──
  currentStep: 'requirement',
  setStep: (step) => set({ currentStep: step }),

  // ── Agent 1: Requirement ──────────────────────────────────
  requirementMessages: [],
  requirementStatus: 'idle',   // idle | clarifying | complete
  questionsAsked: 0,
  structuredOutput: null,
  setRequirementState: (data) => set({
    requirementMessages: data.messages || [],
    requirementStatus: data.status,
    questionsAsked: data.questions_asked,
    structuredOutput: data.structured_output,
  }),

  // ── Agent 2: Research ─────────────────────────────────────
  researchReport: null,
  researchStatus: 'idle',
  researchVersions: [],
  setResearchState: (data) => set({
    researchReport: data.current_report,
    researchStatus: data.status,
    researchVersions: data.versions || [],
  }),

  // ── Agent 3: Canvas ───────────────────────────────────────
  canvas: null,
  canvasStatus: 'idle',
  canvasVersions: [],
  setCanvasState: (data) => set({
    canvas: data.canvas,
    canvasStatus: data.status,
    canvasVersions: data.versions || [],
  }),

  // ── Agent 4: Document Generation ─────────────────────────
  docBundle: null,         // { bundle_id, overall_status, jobs: [{doc_type, job_id, status, progress, current_step, output_path}] }
  docStatus: 'idle',       // idle | generating | partial | completed | failed
  setDocBundle: (data) => set({ docBundle: data, docStatus: data?.overall_status || 'idle' }),
  clearDocBundle: () => set({ docBundle: null, docStatus: 'idle' }),

  // ── Agent 5: Prototype Generation ────────────────────────
  prototypeHtml: null,
  prototypeStatus: 'idle',   // idle | generating | ready | failed
  prototypeFeature: null,
  prototypeScreenCount: 0,
  setPrototypeState: (data) => set({
    prototypeHtml: data.prototype_html ?? null,
    prototypeStatus: data.status ?? 'idle',
    prototypeFeature: data.feature_name ?? null,
    prototypeScreenCount: data.screen_count ?? 0,
  }),
  clearPrototype: () => set({
    prototypeHtml: null, prototypeStatus: 'idle',
    prototypeFeature: null, prototypeScreenCount: 0,
  }),

  // ── UI State ──────────────────────────────────────────────
  loading: false,
  setLoading: (v) => set({ loading: v }),
  error: null,
  setError: (e) => set({ error: e }),
  clearError: () => set({ error: null }),
}))

export default useSessionStore
