import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  generateDocBundle,
  getBundleStatus,
  downloadDoc,
  downloadBundle,
  getJobContent,
} from '../api/client'
import useSessionStore from '../store/sessionStore'

// ── Constants ──────────────────────────────────────────────────────────────── //

const DOC_TYPES = ['BRD', 'TSD', 'Product Note', 'Circular']

const DOC_META = {
  BRD: {
    label: 'Business Requirements Document',
    abbr: 'BRD',
    desc: 'Formal specification of business needs, stakeholders, scope and success criteria.',
    color: 'brand',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
      </svg>
    ),
  },
  TSD: {
    label: 'Technical Specification Document',
    abbr: 'TSD',
    desc: 'Architecture, API contracts, data flows and integration points for engineering teams.',
    color: 'indigo',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75 22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5" />
      </svg>
    ),
  },
  'Product Note': {
    label: 'Product Note',
    abbr: 'PN',
    desc: 'Concise internal memo summarising the product concept, rationale and key decisions.',
    color: 'emerald',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 18.549 2.8a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
      </svg>
    ),
  },
  Circular: {
    label: 'Regulatory Circular',
    abbr: 'CIR',
    desc: 'Formal directive from NPCI to member institutions covering compliance obligations.',
    color: 'amber',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5h1.5m-1.5 3h1.5m-7.5 3h7.5m-7.5 3h7.5m3-9h3.375c.621 0 1.125.504 1.125 1.125V18a2.25 2.25 0 0 1-2.25 2.25M16.5 7.5V18a2.25 2.25 0 0 0 2.25 2.25M16.5 7.5V4.875c0-.621-.504-1.125-1.125-1.125H4.125C3.504 3.75 3 4.254 3 4.875V18a2.25 2.25 0 0 0 2.25 2.25h13.5M6 7.5h3v3H6v-3Z" />
      </svg>
    ),
  },
}

const COLOR_MAP = {
  brand:   { bg: 'bg-brand-50 dark:bg-brand-900/20',   border: 'border-brand-200 dark:border-brand-700',   icon: 'text-brand-600 dark:text-brand-400',   bar: 'bg-brand-600',   badge: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300' },
  indigo:  { bg: 'bg-indigo-50 dark:bg-indigo-900/20', border: 'border-indigo-200 dark:border-indigo-700', icon: 'text-indigo-600 dark:text-indigo-400', bar: 'bg-indigo-600', badge: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300' },
  emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20', border: 'border-emerald-200 dark:border-emerald-700', icon: 'text-emerald-600 dark:text-emerald-400', bar: 'bg-emerald-600', badge: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300' },
  amber:   { bg: 'bg-amber-50 dark:bg-amber-900/20',   border: 'border-amber-200 dark:border-amber-700',   icon: 'text-amber-600 dark:text-amber-400',   bar: 'bg-amber-500',   badge: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300' },
}

// ── Helpers ────────────────────────────────────────────────────────────────── //

function buildPromptFromCanvas(canvas, structuredOutput) {
  if (!canvas?.sections) return ''

  const lines = []
  const featureName = structuredOutput?.feature_name || 'Product Feature'
  lines.push(`Product: ${featureName}`)
  lines.push('')
  lines.push('Product Canvas Summary:')

  canvas.sections.forEach((s) => {
    const title = s.key?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || s.key
    lines.push(`\n## ${title}`)
    // Strip markdown headers from content, keep body
    const body = (s.content || '')
      .replace(/^#+\s+.*/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    lines.push(body)
  })

  return lines.join('\n')
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ── Status badge ───────────────────────────────────────────────────────────── //

function StatusBadge({ status }) {
  const map = {
    pending:            { cls: 'bg-slate-100 dark:bg-navy-700 text-slate-500 dark:text-slate-400', label: 'Queued' },
    retrieving:         { cls: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 animate-pulse', label: 'Retrieving context' },
    planning:           { cls: 'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 animate-pulse', label: 'Planning structure' },
    generating_diagrams:{ cls: 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 animate-pulse', label: 'Generating diagrams' },
    writing:            { cls: 'bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 animate-pulse', label: 'Writing content' },
    reviewing:          { cls: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 animate-pulse', label: 'Reviewing' },
    assembling:         { cls: 'bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-400 animate-pulse', label: 'Assembling DOCX' },
    completed:          { cls: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400', label: 'Ready' },
    failed:             { cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', label: 'Failed' },
    FAILED:             { cls: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400', label: 'Failed' },
  }
  const { cls, label } = map[status] || { cls: 'bg-slate-100 text-slate-500', label: status }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {status !== 'completed' && status !== 'failed' && status !== 'FAILED' && status !== 'pending' && (
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {status === 'completed' && (
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      )}
      {label}
    </span>
  )
}

// ── Preview Modal ──────────────────────────────────────────────────────────── //

function PreviewModal({ jobId, docType, onClose }) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getJobContent(jobId)
      .then((r) => setContent(r.data.markdown || ''))
      .catch((e) => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }, [jobId])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-3xl bg-white dark:bg-navy-900 rounded-2xl shadow-2xl
                      border border-slate-200 dark:border-navy-700 flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-navy-700 shrink-0">
          <div>
            <p className="text-sm font-bold text-slate-800 dark:text-white">{docType} Preview</p>
            <p className="text-xs text-slate-400 mt-0.5">Inline markdown view — download for full DOCX</p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                       hover:bg-slate-100 dark:hover:bg-navy-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <div className="flex items-center gap-3 text-slate-400 text-sm">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading preview…
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
          {!loading && !error && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Document Card ──────────────────────────────────────────────────────────── //

function DocCard({ job, onDownload, onPreview }) {
  const meta = DOC_META[job.doc_type] || DOC_META['BRD']
  const colors = COLOR_MAP[meta.color] || COLOR_MAP.brand
  const isComplete = job.status === 'completed'
  const isFailed = job.status === 'failed' || job.status === 'FAILED'
  const isActive = !isComplete && !isFailed && job.status !== 'pending'
  const progress = job.progress ?? 0

  return (
    <div className={`relative flex flex-col rounded-2xl border p-5 transition-all duration-300
                     ${isComplete ? `${colors.bg} ${colors.border}` : 'bg-white dark:bg-navy-900 border-slate-200 dark:border-navy-700'}
                     ${isActive ? 'shadow-md' : 'shadow-sm'}`}>
      {/* Icon + title row */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0
                         ${isComplete ? `${colors.bg} ${colors.icon}` : 'bg-slate-100 dark:bg-navy-800 text-slate-400 dark:text-slate-500'}`}>
          {meta.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900 dark:text-white">{meta.abbr}</span>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{meta.desc}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {job.current_step || 'Queued'}
          </span>
          <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-slate-100 dark:bg-navy-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ease-out ${colors.bar}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Error */}
      {isFailed && job.error && (
        <p className="text-xs text-red-500 dark:text-red-400 mb-2 bg-red-50 dark:bg-red-900/20 px-3 py-1.5 rounded-lg">
          {job.error}
        </p>
      )}

      {/* Actions */}
      {isComplete && (
        <div className="flex gap-2 mt-auto pt-2">
          <button
            onClick={() => onPreview(job.job_id, job.doc_type)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                       text-xs font-semibold border border-slate-200 dark:border-navy-600
                       text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-navy-800
                       transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            Preview
          </button>
          <button
            onClick={() => onDownload(job.job_id, job.doc_type)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg
                        text-xs font-semibold text-white transition-colors ${colors.bar} hover:opacity-90`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Download
          </button>
        </div>
      )}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────── //

export default function DocumentGeneration() {
  const {
    canvas, structuredOutput, sessionId,
    docBundle, docStatus, setDocBundle, clearDocBundle,
  } = useSessionStore()

  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)
  const [preview, setPreview] = useState(null) // { jobId, docType }
  const [downloading, setDownloading] = useState(false)
  const pollRef = useRef(null)

  // ── Stop polling on unmount ──────────────────────────────
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  // ── Auto-start polling if a bundle is in progress ────────
  useEffect(() => {
    if (docBundle && docStatus !== 'completed' && docStatus !== 'failed') {
      startPolling(docBundle.bundle_id)
    }
  }, [])

  const startPolling = (bundleId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await getBundleStatus(bundleId)
        const data = res.data
        setDocBundle(data)
        const terminal = data.overall_status === 'completed' || data.overall_status === 'partial'
        if (terminal) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch (e) {
        console.error('Bundle poll error:', e)
      }
    }, 2500)
  }

  const handleGenerate = async () => {
    if (!canvas) return
    setError(null)
    setGenerating(true)
    clearDocBundle()
    if (pollRef.current) clearInterval(pollRef.current)

    const prompt = buildPromptFromCanvas(canvas, structuredOutput)
    const featureName = structuredOutput?.feature_name || 'Product Feature'

    const payload = {
      prompt,
      session_id: sessionId,
      organization_name: 'NPCI',
      audience: 'Product managers, engineers, compliance teams',
      desired_outcome: `Complete document suite for ${featureName}`,
      use_rag: true,
      include_diagrams: true,
      brd_title: `Business Requirements Document — ${featureName}`,
      tsd_title: `Technical Specification Document — ${featureName}`,
      product_note_title: `Product Note — ${featureName}`,
      circular_title: `Circular — ${featureName}`,
      signatory_name: 'Chief Product Officer',
      signatory_title: 'Chief Product Officer',
      signatory_department: 'Product Management',
    }

    try {
      const res = await generateDocBundle(payload)
      const data = res.data
      setDocBundle(data)
      startPolling(data.bundle_id)
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Failed to reach the DocGen service. Is it running on port 8001?')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownloadDoc = async (jobId, docType) => {
    try {
      const res = await downloadDoc(jobId)
      const safe = docType.replace(/\s+/g, '_').toLowerCase()
      triggerDownload(res.data, `${safe}.docx`)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    }
  }

  const handleDownloadAll = async () => {
    if (!docBundle?.bundle_id) return
    setDownloading(true)
    try {
      const res = await downloadBundle(docBundle.bundle_id)
      triggerDownload(res.data, `document_suite_${docBundle.bundle_id.slice(0, 8)}.zip`)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setDownloading(false)
    }
  }

  // Build job map keyed by doc_type
  const jobMap = {}
  docBundle?.jobs?.forEach((j) => { jobMap[j.doc_type] = j })

  const completedCount = docBundle?.jobs?.filter((j) => j.status === 'completed').length ?? 0
  const totalCount = DOC_TYPES.length
  const allDone = docBundle?.overall_status === 'completed' || docBundle?.overall_status === 'partial'
  const isRunning = docStatus === 'generating' || (docBundle && !allDone && docStatus !== 'idle' && docStatus !== 'failed')

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full animate-fade-in">

      {/* ── Header ──────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3" />
              </svg>
            </span>
            Document Suite
          </h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 ml-9">
            AI-generated BRD · TSD · Product Note · Circular — derived from your Product Canvas
          </p>
        </div>

        <div className="flex items-center gap-2">
          {allDone && completedCount > 0 && (
            <button
              onClick={handleDownloadAll}
              disabled={downloading}
              className="btn-secondary gap-2 text-sm py-1.5"
            >
              {downloading ? (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m-3 0V3m0 5.25-3-3m3 3 3-3" />
                </svg>
              )}
              Download All (.zip)
            </button>
          )}

          <button
            onClick={handleGenerate}
            disabled={generating || isRunning || !canvas}
            className="btn-primary gap-2 text-sm py-1.5"
          >
            {generating || isRunning ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating…
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
                </svg>
                {docBundle ? 'Regenerate All' : 'Generate All Documents'}
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 flex items-start gap-2 px-4 py-3 mb-4 rounded-xl
                        bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                        text-sm text-red-600 dark:text-red-400 animate-fade-in">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          <div>
            <p className="font-semibold">Generation Error</p>
            <p className="text-xs mt-0.5 opacity-80">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="ml-auto shrink-0 opacity-60 hover:opacity-100">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Canvas Prompt Preview ─────────────────────────────── */}
      {!docBundle && (
        <div className="shrink-0 mb-4 p-4 rounded-xl border border-slate-200 dark:border-navy-700
                        bg-slate-50 dark:bg-navy-800 animate-fade-in">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
            Source — Product Canvas
          </p>
          {canvas ? (
            <div className="flex flex-wrap gap-2">
              {canvas.sections?.map((s) => (
                <span key={s.key}
                  className="px-2 py-0.5 rounded-md bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300
                             border border-brand-100 dark:border-brand-800 text-[11px] font-medium">
                  {s.key?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No canvas data — please complete the Product Canvas step first.</p>
          )}
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
            The canvas content above will be used as context to generate all 4 documents simultaneously.
          </p>
        </div>
      )}

      {/* ── Overall progress banner ───────────────────────────── */}
      {docBundle && (
        <div className={`shrink-0 mb-4 flex items-center gap-3 px-4 py-3 rounded-xl border animate-fade-in
                         ${allDone
                           ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800'
                           : 'bg-brand-50 dark:bg-brand-900/20 border-brand-200 dark:border-brand-800'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0
                           ${allDone ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-brand-100 dark:bg-brand-900/40'}`}>
            {allDone ? (
              <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-brand-600 dark:text-brand-400 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${allDone ? 'text-emerald-800 dark:text-emerald-300' : 'text-brand-800 dark:text-brand-300'}`}>
              {allDone
                ? `${completedCount} of ${totalCount} documents ready`
                : `Generating documents — ${completedCount} of ${totalCount} complete`}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Bundle ID: {docBundle.bundle_id?.slice(0, 8)}
            </p>
          </div>
          {/* overall progress bar */}
          <div className="w-32 shrink-0">
            <div className="h-1.5 rounded-full bg-slate-200 dark:bg-navy-700 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${allDone ? 'bg-emerald-500' : 'bg-brand-600'}`}
                style={{ width: `${(completedCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── Document Cards ────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-2">
          {DOC_TYPES.map((docType) => {
            const job = jobMap[docType] ?? {
              doc_type: docType,
              job_id: null,
              status: 'pending',
              progress: 0,
              current_step: 'Not started',
            }
            return (
              <DocCard
                key={docType}
                job={job}
                onDownload={handleDownloadDoc}
                onPreview={(jobId, dt) => setPreview({ jobId, docType: dt })}
              />
            )
          })}
        </div>

        {/* Empty state — no generation started */}
        {!docBundle && canvas && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center mb-3">
              <svg className="w-7 h-7 text-brand-600 dark:text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m6.75 12H9m1.5-12H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Ready to generate your document suite</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs">
              Click <strong>Generate All Documents</strong> above to produce BRD, TSD, Product Note and Circular in parallel.
            </p>
          </div>
        )}
      </div>

      {/* ── Bottom nav ────────────────────────────────────────── */}
      <div className="shrink-0 mt-3 pt-3 border-t border-slate-100 dark:border-navy-700 flex justify-between items-center">
        <button
          onClick={() => useSessionStore.getState().setStep('canvas')}
          className="btn-ghost"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
          </svg>
          Back to Canvas
        </button>
        {allDone && completedCount > 0 && (
          <button
            onClick={() => useSessionStore.getState().setStep('prototype')}
            className="btn-primary gap-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3M9 7.5h.008v.008H9V7.5Z" />
            </svg>
            Generate UI Prototype
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
            </svg>
          </button>
        )}
      </div>

      {/* ── Preview Modal ──────────────────────────────────────── */}
      {preview && (
        <PreviewModal
          jobId={preview.jobId}
          docType={preview.docType}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}
