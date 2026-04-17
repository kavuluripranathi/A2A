const STEPS = [
  { key: 'requirement', label: 'Requirements', num: 1 },
  { key: 'research',    label: 'Research',     num: 2 },
  { key: 'canvas',      label: 'Canvas',       num: 3 },
  { key: 'documents',   label: 'Documents',    num: 4 },
  { key: 'prototype',   label: 'Prototype',    num: 5 },
]

export default function StepIndicator({ current }) {
  const currentIdx = STEPS.findIndex((s) => s.key === current)

  return (
    <div className="shrink-0 flex items-center mb-5 px-1">
      {STEPS.map((step, i) => {
        const done   = i < currentIdx
        const active = i === currentIdx

        return (
          <div key={step.key} className="flex items-center" style={{ flex: i < STEPS.length - 1 ? '1' : 'none' }}>
            {/* Node */}
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
                               border-2 transition-all duration-200 shrink-0
                ${done
                  ? 'bg-emerald-500 border-emerald-500 text-white shadow-sm'
                  : active
                    ? 'bg-brand-600 border-brand-600 text-white shadow-md shadow-brand-600/30'
                    : 'bg-white dark:bg-navy-900 border-slate-200 dark:border-navy-600 text-slate-400 dark:text-slate-500'
                }`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                  </svg>
                ) : step.num}
              </div>
              <span className={`text-[10px] font-semibold leading-none whitespace-nowrap transition-colors
                ${active
                  ? 'text-brand-600 dark:text-brand-400'
                  : done
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-slate-400 dark:text-slate-500'}`}>
                {step.label}
              </span>
            </div>

            {/* Connector */}
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-px mx-2 mb-3.5 transition-colors duration-300
                              rounded-full overflow-hidden relative">
                <div className="absolute inset-0 bg-slate-200 dark:bg-navy-700" />
                <div className={`absolute inset-0 bg-emerald-400 dark:bg-emerald-500 transition-all duration-500
                  ${done ? 'scale-x-100' : 'scale-x-0'}`}
                     style={{ transformOrigin: 'left' }} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
