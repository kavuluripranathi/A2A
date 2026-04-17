import useSessionStore from '../store/sessionStore'

function RobotIcon({ className = 'w-6 h-6' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="5" />
      <circle cx="12" cy="1.5" r="1" fill="currentColor" stroke="none" />
      <rect x="4" y="5" width="16" height="12" rx="3" />
      <circle cx="9"  cy="11" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="15" cy="11" r="1.5" fill="currentColor" stroke="none" />
      <path d="M9 14.5 Q12 16.5 15 14.5" strokeWidth={1.4} />
      <path d="M8 17 v2 M16 17 v2" strokeWidth={1.6} />
      <path d="M6 19 h12" strokeWidth={1.6} />
    </svg>
  )
}

const STEPS = [
  {
    key: 'requirement',
    label: 'Requirements',
    sublabel: 'Gather & structure',
    icon: (
      <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
      </svg>
    ),
  },
  {
    key: 'research',
    label: 'Deep Research',
    sublabel: 'AI-powered analysis',
    icon: (
      <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 1-6.23-.693L5 14.5m14.8.8 1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0 1 12 21a48.25 48.25 0 0 1-8.135-.687c-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
  },
  {
    key: 'canvas',
    label: 'Product Canvas',
    sublabel: 'Export-ready spec',
    icon: (
      <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    ),
  },
  {
    key: 'documents',
    label: 'Document Suite',
    sublabel: 'BRD · TSD · Circular · Note',
    icon: (
      <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3" />
      </svg>
    ),
  },
  {
    key: 'prototype',
    label: 'UI Prototype',
    sublabel: 'From BRD → mobile UI',
    icon: (
      <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 3h3m-3 3h3" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const {
    currentStep, setStep,
    requirementStatus, researchStatus, canvasStatus, docStatus, prototypeStatus,
    currentView, setView,
    user, logout,
  } = useSessionStore()

  const stepIndex = STEPS.findIndex((s) => s.key === currentStep)

  const getState = (i) => {
    if (i < stepIndex) return 'done'
    if (i === stepIndex) return 'active'
    return 'pending'
  }

  const getStatusLabel = (key) => {
    if (key === 'requirement' && requirementStatus === 'complete')
      return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Done</span>
    if (key === 'research' && researchStatus === 'ready')
      return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Done</span>
    if (key === 'canvas' && canvasStatus === 'ready')
      return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Done</span>
    if (key === 'documents' && docStatus === 'completed')
      return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Done</span>
    if (key === 'documents' && docStatus === 'generating')
      return <span className="text-xs font-semibold text-accent-500 dark:text-accent-400 animate-pulse">Generating…</span>
    if (key === 'prototype' && prototypeStatus === 'ready')
      return <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Done</span>
    if (key === 'prototype' && prototypeStatus === 'generating')
      return <span className="text-xs font-semibold text-accent-500 dark:text-accent-400 animate-pulse">Generating…</span>
    return null
  }

  return (
    <aside className="w-64 shrink-0 flex flex-col h-screen sticky top-0
                      bg-white dark:bg-navy-900
                      border-r border-slate-200 dark:border-navy-700">

      {/* ── Logo ──────────────────────────────────────────────── */}
      <div className="shrink-0 px-5 py-4 border-b border-slate-100 dark:border-navy-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center text-white shrink-0 shadow-sm relative">
            <RobotIcon className="w-5 h-5" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-accent-500 border-2 border-white dark:border-navy-900" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white leading-tight">NPCI AgentHub</div>
            <div className="text-[11px] text-slate-400 dark:text-slate-500">AI Orchestration Platform</div>
          </div>
        </div>
      </div>

      {/* ── Workflow nav — scrolls internally ─────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-4">
        <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2 mb-2">
          Workflow
        </p>

        <nav className="space-y-0.5">
          {STEPS.map((step, i) => {
            const state = getState(i)
            const clickable = i <= stepIndex

            return (
              <button
                key={step.key}
                onClick={() => clickable && setStep(step.key)}
                disabled={!clickable}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150
                  ${state === 'active'
                    ? 'bg-brand-50 dark:bg-navy-700 border border-brand-200 dark:border-navy-600'
                    : state === 'done'
                      ? 'hover:bg-slate-50 dark:hover:bg-navy-800 cursor-pointer'
                      : 'opacity-35 cursor-not-allowed'
                  }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors
                  ${state === 'active'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : state === 'done'
                      ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-navy-700 text-slate-400 dark:text-slate-500'
                  }`}
                >
                  {state === 'done' ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                    </svg>
                  ) : step.icon}
                </div>

                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold leading-tight truncate
                    ${state === 'active'
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-slate-700 dark:text-slate-300'}`}>
                    {step.label}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {getStatusLabel(step.key) || step.sublabel}
                  </div>
                </div>

                {state === 'active' && (
                  <div className="w-2 h-2 rounded-full bg-accent-500 shrink-0" />
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {/* ── Bottom section — always visible, never scrolls ──── */}
      <div className="shrink-0 border-t border-slate-100 dark:border-navy-700">

        {/* History */}
        <div className="px-3 pt-2 pb-1">
          <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-2 mb-1.5">
            Navigation
          </p>
          <button
            onClick={() => setView(currentView === 'history' ? 'app' : 'history')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150
              ${currentView === 'history'
                ? 'bg-brand-50 dark:bg-navy-700 border border-brand-200 dark:border-navy-600'
                : 'hover:bg-slate-50 dark:hover:bg-navy-800'
              }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors
              ${currentView === 'history'
                ? 'bg-brand-600 text-white shadow-sm'
                : 'bg-slate-100 dark:bg-navy-700 text-slate-400 dark:text-slate-500'
              }`}>
              <svg className="w-[17px] h-[17px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-sm font-semibold leading-tight truncate
                ${currentView === 'history' ? 'text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-300'}`}>
                Session History
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Browse past sessions</div>
            </div>
            {currentView === 'history' && (
              <div className="w-2 h-2 rounded-full bg-accent-500 shrink-0" />
            )}
          </button>
        </div>

        {/* User profile */}
        <div className="px-3 pt-1 pb-3">
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl
                          hover:bg-slate-50 dark:hover:bg-navy-800 transition-colors group">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-brand-700
                            flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm">
              {(user?.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate capitalize leading-tight">
                {user?.name || 'User'}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-500 truncate">NPCI Agent Platform</div>
            </div>
            <button
              onClick={logout}
              title="Sign out"
              className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center
                         text-slate-400 opacity-0 group-hover:opacity-100
                         hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20
                         transition-all duration-150"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 9V5.25A2.25 2.25 0 0 1 10.5 3h6a2.25 2.25 0 0 1 2.25 2.25v13.5A2.25 2.25 0 0 1 16.5 21h-6a2.25 2.25 0 0 1-2.25-2.25V15m-3 0-3-3m0 0 3-3m-3 3H15" />
              </svg>
            </button>
          </div>
        </div>

      </div>
    </aside>
  )
}
