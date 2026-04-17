import { useState, useEffect, useRef } from 'react'
import { generatePrototype, getJobContent } from '../api/client'
import useSessionStore from '../store/sessionStore'

// ── Helpers ────────────────────────────────────────────────────────────────── //

function getBrdJob(docBundle) {
  return docBundle?.jobs?.find((j) => j.doc_type === 'BRD' && j.status === 'completed') ?? null
}

// ── Device icons ───────────────────────────────────────────────────────────── //

const MobileIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3" />
  </svg>
)
const TabletIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5h3m-6.75 2.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-15a2.25 2.25 0 0 0-2.25-2.25H6.75A2.25 2.25 0 0 0 4.5 4.5v15a2.25 2.25 0 0 0 2.25 2.25Z" />
  </svg>
)
const DesktopIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0H3" />
  </svg>
)

// ── Loading overlay ────────────────────────────────────────────────────────── //

function GeneratingOverlay() {
  const [step, setStep] = useState(0)
  const steps = [
    'Parsing user flows from BRD…',
    'Designing screen layouts…',
    'Adding interactions & navigation…',
    'Finalising prototype…',
  ]

  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % steps.length), 2200)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-8 py-16">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full border-4 border-brand-100 dark:border-navy-700" />
        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-brand-600 animate-spin" />
        <div className="absolute inset-0 flex items-center justify-center">
          <svg className="w-8 h-8 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3M9 7.5h.008v.008H9V7.5Z" />
          </svg>
        </div>
      </div>

      <div className="text-center space-y-2">
        <p className="text-base font-semibold text-slate-800 dark:text-slate-200">
          Generating UI Prototype
        </p>
        <p className="text-sm text-brand-600 dark:text-brand-400 h-5 transition-all duration-500 animate-pulse">
          {steps[step]}
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
          Analysing your BRD and generating interactive mobile screens — this may take a minute.
        </p>
      </div>

      <div className="flex gap-1.5">
        {steps.map((_, i) => (
          <div key={i} className={`h-1 rounded-full transition-all duration-500
            ${i === step ? 'w-6 bg-brand-600' : 'w-2 bg-slate-200 dark:bg-navy-700'}`} />
        ))}
      </div>
    </div>
  )
}

// ── Phone mockup frame ─────────────────────────────────────────────────────── //

function PhoneFrame({ html, iframeRef }) {
  return (
    <div className="relative mx-auto select-none" style={{ width: 390 }}>
      {/* Side buttons */}
      <div className="absolute -left-[5px] top-[100px] w-[4px] h-9   bg-slate-600 rounded-l-md shadow-inner" />
      <div className="absolute -left-[5px] top-[150px] w-[4px] h-14  bg-slate-600 rounded-l-md shadow-inner" />
      <div className="absolute -left-[5px] top-[218px] w-[4px] h-14  bg-slate-600 rounded-l-md shadow-inner" />
      <div className="absolute -right-[5px] top-[130px] w-[4px] h-20 bg-slate-600 rounded-r-md shadow-inner" />

      {/* Phone shell */}
      <div className="rounded-[3.25rem] border-[7px] border-slate-700 bg-black overflow-hidden"
           style={{
             boxShadow: '0 0 0 1px #000, 0 0 0 2px #1e293b, 0 32px 80px rgba(0,0,0,0.85), inset 0 0 0 1px rgba(255,255,255,0.04)',
             height: 844,
           }}>

        {/* Screen */}
        <div className="relative w-full h-full bg-white overflow-hidden">
          {/* Dynamic island */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20"
               style={{ width: 120, height: 34, background: '#000', borderRadius: 20 }} />

          {/* Prototype iframe */}
          <iframe
            ref={iframeRef}
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin"
            className="absolute inset-0 w-full h-full border-0"
            title="UI Prototype"
          />

          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20"
               style={{ width: 134, height: 5, background: 'rgba(0,0,0,0.18)', borderRadius: 10 }} />
        </div>
      </div>
    </div>
  )
}

// ── Tablet frame ───────────────────────────────────────────────────────────── //

function TabletFrame({ html, iframeRef }) {
  return (
    <div className="relative mx-auto select-none" style={{ maxWidth: 744 }}>
      <div className="rounded-[2rem] border-[8px] border-slate-700 bg-black overflow-hidden"
           style={{
             boxShadow: '0 0 0 1px #000, 0 0 0 2px #1e293b, 0 28px 60px rgba(0,0,0,0.75)',
             minHeight: 600,
             height: '70vh',
           }}>
        <div className="relative w-full h-full bg-white">
          {/* Camera */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 w-3 h-3 bg-slate-800 rounded-full z-20" />
          <iframe
            ref={iframeRef}
            srcDoc={html}
            sandbox="allow-scripts allow-same-origin"
            className="absolute inset-0 w-full h-full border-0 pt-7"
            title="UI Prototype"
          />
          {/* Home bar */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20"
               style={{ width: 100, height: 4, background: 'rgba(0,0,0,0.15)', borderRadius: 10 }} />
        </div>
      </div>
    </div>
  )
}

// ── Prototype viewer ───────────────────────────────────────────────────────── //

const DEVICES = [
  { key: 'mobile',   label: 'Mobile',   Icon: MobileIcon },
  { key: 'tablet',   label: 'Tablet',   Icon: TabletIcon },
  { key: 'desktop',  label: 'Desktop',  Icon: DesktopIcon },
]

function PrototypeViewer({ html, screenCount, featureName, onRegenerate, generating }) {
  const iframeRef = useRef(null)
  const [device, setDevice] = useState('mobile')

  const openInTab = () => {
    const w = window.open('about:blank', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Toolbar ───────────────────────────────────────────── */}
      <div className="shrink-0 mb-3 flex items-center gap-3
                      px-4 py-2.5 rounded-xl
                      bg-white dark:bg-navy-900
                      border border-slate-200 dark:border-navy-700
                      shadow-sm">

        {/* Status + meta */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_2px_rgba(34,197,94,0.4)]" />
            Live Preview
          </span>
          {screenCount > 0 && (
            <span className="text-xs text-slate-400 dark:text-slate-500 pl-3 border-l border-slate-200 dark:border-navy-700">
              {screenCount} screen{screenCount !== 1 ? 's' : ''}
            </span>
          )}
          {featureName && (
            <span className="text-xs text-slate-400 dark:text-slate-500 pl-3 border-l border-slate-200 dark:border-navy-700 truncate max-w-48 hidden lg:block">
              {featureName}
            </span>
          )}
        </div>

        {/* Device switcher */}
        <div className="shrink-0 flex items-center bg-slate-100 dark:bg-navy-800 rounded-lg p-0.5 gap-0.5">
          {DEVICES.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setDevice(key)}
              title={label}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150
                ${device === key
                  ? 'bg-white dark:bg-navy-700 text-slate-800 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'}`}
            >
              <Icon />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={onRegenerate}
            disabled={generating}
            className="btn-secondary gap-1.5 text-xs py-1.5 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Regenerate
          </button>
          <button
            onClick={openInTab}
            className="btn-ghost gap-1.5 text-xs py-1.5"
            title="Open in new tab"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Open
          </button>
        </div>
      </div>

      {/* ── Preview canvas ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 rounded-xl overflow-auto
                      bg-[#0d1117]
                      border border-slate-800
                      shadow-inner">

        {device === 'mobile' && (
          <div className="min-h-full flex items-center justify-center p-8">
            <PhoneFrame html={html} iframeRef={iframeRef} />
          </div>
        )}

        {device === 'tablet' && (
          <div className="min-h-full flex items-center justify-center p-8">
            <TabletFrame html={html} iframeRef={iframeRef} />
          </div>
        )}

        {device === 'desktop' && (
          <div className="w-full h-full min-h-[600px] p-4">
            <div className="w-full h-full min-h-[600px] rounded-lg overflow-hidden border border-slate-700 shadow-xl bg-white">
              {/* Browser chrome */}
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border-b border-slate-700">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <div className="flex-1 mx-4">
                  <div className="flex items-center gap-2 px-3 py-1 bg-slate-700 rounded-md text-xs text-slate-400">
                    <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
                    </svg>
                    prototype.npci.local
                  </div>
                </div>
              </div>
              <iframe
                ref={iframeRef}
                srcDoc={html}
                sandbox="allow-scripts allow-same-origin"
                className="w-full border-0"
                style={{ height: 'calc(100% - 44px)' }}
                title="UI Prototype"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty / no-BRD state ───────────────────────────────────────────────────── //

function NoBrdState() {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-5 py-16 text-center">
      <div className="w-14 h-14 rounded-2xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
        <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
        </svg>
      </div>
      <div>
        <p className="font-semibold text-slate-700 dark:text-slate-300">BRD not ready</p>
        <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-xs">
          Complete the Document Suite step and wait for the BRD to finish before generating a prototype.
        </p>
      </div>
      <button
        onClick={() => useSessionStore.getState().setStep('documents')}
        className="btn-secondary text-sm py-1.5 gap-2"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
        </svg>
        Go to Document Suite
      </button>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────── //

export default function PrototypeGeneration() {
  const {
    sessionId, structuredOutput, docBundle,
    prototypeHtml, prototypeStatus, prototypeFeature, prototypeScreenCount,
    setPrototypeState, clearPrototype,
  } = useSessionStore()

  const [error, setError] = useState(null)
  const [autoStarted, setAutoStarted] = useState(false)

  const brdJob = getBrdJob(docBundle)
  const featureName = structuredOutput?.feature_name || prototypeFeature || ''
  const isGenerating = prototypeStatus === 'generating'
  const isReady = prototypeStatus === 'ready' && prototypeHtml

  // Auto-generate on mount when BRD is available but prototype is absent
  useEffect(() => {
    if (!autoStarted && brdJob && sessionId) {
      const needsGeneration =
        prototypeStatus === 'idle' ||
        (prototypeStatus === 'ready' && !prototypeHtml)
      if (needsGeneration) {
        setAutoStarted(true)
        handleGenerate()
      }
    }
  }, [sessionId, brdJob, prototypeStatus])

  const handleGenerate = async () => {
    if (!brdJob) return
    setError(null)
    clearPrototype()
    setPrototypeState({ status: 'generating' })

    try {
      const { getJobContent } = await import('../api/client')
      const contentRes = await getJobContent(brdJob.job_id)
      const brdContent = contentRes.data?.markdown || ''

      if (!brdContent) throw new Error('BRD content is empty — please regenerate documents first.')

      const res = await generatePrototype(sessionId, brdContent, featureName)
      setPrototypeState(res.data)
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || 'Prototype generation failed'
      setError(msg)
      setPrototypeState({ status: 'failed' })
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full animate-fade-in">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3M9 7.5h.008v.008H9V7.5Z" />
              </svg>
            </span>
            UI Prototype
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 ml-9">
            Interactive prototype generated from BRD — powered by{' '}
            <span className="font-medium text-slate-500 dark:text-slate-400">GPT-4.1</span>
          </p>
        </div>

        {!isGenerating && brdJob && !isReady && (
          <button onClick={handleGenerate} className="btn-primary gap-2 text-sm py-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            Generate Prototype
          </button>
        )}
      </div>

      {/* ── Error banner ──────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 flex items-start gap-3 px-4 py-3 mb-4 rounded-xl
                        bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                        text-sm text-red-600 dark:text-red-400 animate-fade-in">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <div className="flex-1">
            <p className="font-semibold">Prototype Generation Failed</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="shrink-0 opacity-50 hover:opacity-100 transition-opacity">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Content area ──────────────────────────────────────── */}
      {!brdJob && !isReady ? (
        <NoBrdState />
      ) : isGenerating ? (
        <GeneratingOverlay />
      ) : isReady ? (
        <PrototypeViewer
          html={prototypeHtml}
          screenCount={prototypeScreenCount}
          featureName={prototypeFeature || featureName}
          onRegenerate={handleGenerate}
          generating={isGenerating}
        />
      ) : (
        /* Idle — waiting for user to trigger */
        <div className="flex flex-col items-center justify-center flex-1 gap-5 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3M9 7.5h.008v.008H9V7.5Z" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-slate-700 dark:text-slate-300">Ready to generate your UI prototype</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mt-1 max-w-sm">
              The BRD will be analysed to extract user flows and produce an interactive multi-screen mobile prototype.
            </p>
          </div>
          <button onClick={handleGenerate} className="btn-primary gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
            </svg>
            Generate Prototype
          </button>
        </div>
      )}

      {/* ── Bottom nav ────────────────────────────────────────── */}
      <div className="shrink-0 mt-3 pt-3 border-t border-slate-100 dark:border-navy-700 flex justify-between items-center">
        <button
          onClick={() => useSessionStore.getState().setStep('documents')}
          className="btn-ghost text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Documents
        </button>
        {isReady && (
          <span className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            </svg>
            Prototype ready — interact directly in the viewer
          </span>
        )}
      </div>
    </div>
  )
}
