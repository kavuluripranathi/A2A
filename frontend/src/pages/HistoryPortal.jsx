import { useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  listHistory,
  getHistoryDetail,
  renameHistorySession,
  deleteHistorySession,
  getRequirementState,
  getResearchState,
  getCanvasState,
  getBundleStatus,
  getPrototypeState,
} from '../api/client'
import useSessionStore from '../store/sessionStore'

// ── Helpers ────────────────────────────────────────────────────────────────── //

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function timeAgo(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const PROGRESS_STEPS = ['requirement', 'research', 'canvas', 'documents', 'prototype']
const STEP_LABELS = { requirement: 'Requirements', research: 'Research', canvas: 'Canvas', documents: 'Documents', prototype: 'Prototype' }
const PROGRESS_ORDER = { new: -1, requirement: 0, research: 1, canvas: 2, documents: 3, prototype: 4 }

function ProgressBadge({ progress }) {
  const colors = {
    new:         'bg-slate-100 text-slate-500 dark:bg-navy-800 dark:text-slate-400',
    requirement: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    research:    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    canvas:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    documents:   'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
    prototype:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  }
  const labels = {
    new: 'New', requirement: 'Requirements Done',
    research: 'Research Done', canvas: 'Canvas Done',
    documents: 'Documents Done', prototype: 'Prototype Done',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${colors[progress] || colors.new}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {labels[progress] || progress}
    </span>
  )
}

function StepTrail({ progress }) {
  const reached = PROGRESS_ORDER[progress] ?? -1
  return (
    <div className="flex items-center gap-1">
      {PROGRESS_STEPS.map((step, i) => {
        const done = i <= reached
        return (
          <div key={step} className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full transition-colors ${done ? 'bg-brand-500' : 'bg-slate-200 dark:bg-navy-700'}`} />
            {i < PROGRESS_STEPS.length - 1 && (
              <div className={`w-4 h-px ${done && i < reached ? 'bg-brand-400' : 'bg-slate-200 dark:bg-navy-700'}`} />
            )}
          </div>
        )
      })}
      <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">
        {STEP_LABELS[progress] || 'New'}
      </span>
    </div>
  )
}

// ── Detail Tabs ────────────────────────────────────────────────────────────── //

function RequirementTab({ data }) {
  if (!data?.messages?.length) {
    return <p className="text-sm text-slate-400 py-6 text-center">No requirement messages recorded.</p>
  }
  return (
    <div className="space-y-3">
      {data.feature_request && (
        <div className="p-3 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-100 dark:border-brand-800">
          <p className="text-xs font-semibold text-brand-600 dark:text-brand-400 mb-1 uppercase tracking-wider">Feature Request</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">{data.feature_request}</p>
        </div>
      )}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {data.messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role !== 'user' && (
              <div className="w-6 h-6 rounded-full bg-brand-600 flex items-center justify-center text-white text-[9px] font-bold shrink-0 mt-0.5">
                AI
              </div>
            )}
            <div className={`max-w-[80%] px-3 py-2 rounded-xl text-sm leading-relaxed
              ${msg.role === 'user'
                ? 'bg-brand-600 text-white rounded-br-sm'
                : 'bg-slate-100 dark:bg-navy-800 text-slate-700 dark:text-slate-300 rounded-bl-sm'
              }`}>
              {msg.content}
            </div>
          </div>
        ))}
      </div>
      {data.structured_output && (
        <details className="mt-2">
          <summary className="text-xs font-semibold text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">
            Structured Output
          </summary>
          <pre className="mt-2 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-navy-900 p-3 rounded-lg overflow-x-auto">
            {JSON.stringify(data.structured_output, null, 2)}
          </pre>
        </details>
      )}
    </div>
  )
}

function ResearchTab({ data }) {
  const [expanded, setExpanded] = useState(null)
  const report = data?.current_report
  if (!report) {
    return <p className="text-sm text-slate-400 py-6 text-center">No research report available.</p>
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400">{data.version_count} version(s)</span>
        {data.feedback_history?.length > 0 && (
          <span className="text-xs text-slate-400">{data.feedback_history.length} feedback round(s)</span>
        )}
      </div>
      {report.summary && (
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-navy-800/50 border-l-4 border-brand-400 text-sm text-slate-700 dark:text-slate-300">
          <p className="text-xs font-bold text-brand-600 dark:text-brand-400 mb-1 uppercase tracking-wider">Executive Summary</p>
          {report.summary}
        </div>
      )}
      <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
        {report.sections?.map((section, i) => (
          <div key={i} className="rounded-xl border border-slate-100 dark:border-navy-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left
                         hover:bg-slate-50 dark:hover:bg-navy-800/50 transition-colors"
              onClick={() => setExpanded(expanded === i ? null : i)}
            >
              <div className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold shrink-0
                  ${expanded === i ? 'bg-brand-600 text-white' : 'bg-slate-100 dark:bg-navy-800 text-slate-400'}`}>
                  {i + 1}
                </span>
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{section.title}</span>
              </div>
              <svg className={`w-3.5 h-3.5 text-slate-400 transition-transform ${expanded === i ? 'rotate-180' : ''}`}
                   fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
            {expanded === i && (
              <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-navy-700">
                <div className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300
                                prose-headings:text-slate-900 dark:prose-headings:text-slate-100">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.content}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function CanvasTab({ data }) {
  const canvas = data?.current_canvas
  if (!canvas) {
    return <p className="text-sm text-slate-400 py-6 text-center">No canvas generated.</p>
  }
  const sections = canvas.sections || []
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400">
        Version {canvas.version} · {data.version_count} version(s) total
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {sections.map((sec, i) => (
          <div key={i} className="p-3 rounded-xl bg-slate-50 dark:bg-navy-800/50 border border-slate-100 dark:border-navy-700">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              {sec.title || sec.key?.replace(/_/g, ' ')}
            </p>
            <div className="prose prose-sm max-w-none text-slate-700 dark:text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{sec.content}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DocumentsTab({ bundleId }) {
  if (!bundleId) {
    return <p className="text-sm text-slate-400 py-6 text-center">No documents generated.</p>
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
        <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
        <div>
          <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">Document bundle generated</p>
          <p className="text-xs text-slate-400 mt-0.5">Bundle ID: {bundleId.slice(0, 8)}…</p>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        BRD · TSD · Product Note · Circular were generated for this session.
        Load the session to view, download, or regenerate them.
      </p>
    </div>
  )
}

function PrototypeTab({ prototypeStatus, featureName, screenCount }) {
  if (!prototypeStatus || prototypeStatus === 'idle') {
    return <p className="text-sm text-slate-400 py-6 text-center">No prototype generated.</p>
  }
  const isReady = prototypeStatus === 'ready'
  return (
    <div className="space-y-3">
      <div className={`flex items-center gap-2 p-3 rounded-xl border
        ${isReady
          ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800'
          : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800'}`}>
        <svg className={`w-4 h-4 shrink-0 ${isReady ? 'text-purple-500' : 'text-red-400'}`}
             fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          {isReady
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
            : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />}
        </svg>
        <div>
          <p className={`text-xs font-semibold ${isReady ? 'text-purple-700 dark:text-purple-300' : 'text-red-600 dark:text-red-400'}`}>
            {isReady ? 'UI Prototype generated' : 'Prototype generation failed'}
          </p>
          {featureName && <p className="text-xs text-slate-400 mt-0.5">{featureName}</p>}
        </div>
      </div>
      {isReady && (
        <div className="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400">
          {screenCount > 0 && (
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3" />
              </svg>
              {screenCount} screen{screenCount !== 1 ? 's' : ''}
            </span>
          )}
          <span>HTML prototype · load session to view & interact</span>
        </div>
      )}
    </div>
  )
}

// ── Session Detail Modal ───────────────────────────────────────────────────── //

function SessionDetailModal({ sessionId, onClose, onLoad }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('requirement')

  useEffect(() => {
    getHistoryDetail(sessionId)
      .then(r => { setDetail(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [sessionId])

  const tabs = [
    { id: 'requirement', label: 'Requirements', available: !!detail?.requirement?.messages?.length },
    { id: 'research',    label: 'Research',      available: !!detail?.research?.current_report },
    { id: 'canvas',      label: 'Canvas',         available: !!detail?.canvas?.current_canvas },
    { id: 'documents',   label: 'Documents',      available: !!detail?.bundle_id },
    { id: 'prototype',   label: 'Prototype',      available: !!detail?.prototype?.status && detail?.prototype?.status !== 'idle' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fade-in"
         onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-2xl bg-white dark:bg-navy-900 rounded-2xl shadow-2xl
                      border border-slate-200 dark:border-navy-700 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 dark:border-navy-700 shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            {loading ? (
              <div className="h-5 bg-slate-200 dark:bg-navy-700 rounded-lg w-48 animate-pulse" />
            ) : (
              <>
                <h2 className="font-semibold text-slate-900 dark:text-slate-100 text-base truncate">
                  {detail?.title || 'Session Detail'}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">{formatDate(detail?.created_at)}</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Jump directly to prototype if session has canvas data */}
            {!loading && detail?.canvas?.current_canvas && (
              <button
                onClick={() => onLoad(sessionId, { ...detail, _forceStep: 'prototype' })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                           bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700
                           text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900/40
                           transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3" />
                </svg>
                Prototype
              </button>
            )}
            <button
              onClick={() => onLoad(sessionId, detail)}
              className="btn-primary py-1.5 px-3 text-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z" />
              </svg>
              Load Session
            </button>
            <button onClick={onClose}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400
                               hover:bg-slate-100 dark:hover:bg-navy-800 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Tabs */}
        {!loading && (
          <div className="flex gap-1 px-6 pt-3 shrink-0 overflow-x-auto scrollbar-none">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => tab.available && setActiveTab(tab.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'bg-brand-600 text-white'
                    : tab.available
                      ? 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-navy-800'
                      : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
                  }`}
              >
                {tab.label}
                {!tab.available && (
                  <span className="ml-1 text-[10px] opacity-50">–</span>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 dark:bg-navy-800 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            <>
              {activeTab === 'requirement' && <RequirementTab data={detail?.requirement} />}
              {activeTab === 'research'    && <ResearchTab    data={detail?.research} />}
              {activeTab === 'canvas'      && <CanvasTab      data={detail?.canvas} />}
              {activeTab === 'documents'   && <DocumentsTab   bundleId={detail?.bundle_id} />}
              {activeTab === 'prototype'   && (
                <PrototypeTab
                  prototypeStatus={detail?.prototype?.status}
                  featureName={detail?.prototype?.feature_name}
                  screenCount={detail?.prototype?.screen_count}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Session Card ───────────────────────────────────────────────────────────── //

function SessionCard({ session, onView, onDelete, onRename, onLoadStep }) {
  const [renaming, setRenaming] = useState(false)
  const [titleInput, setTitleInput] = useState(session.title)
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  const handleRename = async () => {
    const t = titleInput.trim()
    if (!t || t === session.title) { setRenaming(false); setTitleInput(session.title); return }
    await onRename(session.session_id, t)
    setRenaming(false)
  }

  const handleDelete = async () => {
    if (!deleting) { setDeleting(true); return }
    await onDelete(session.session_id)
  }

  return (
    <div className="group relative bg-white dark:bg-navy-900 rounded-2xl border border-slate-200 dark:border-navy-700
                    shadow-sm hover:shadow-md hover:border-brand-300 dark:hover:border-brand-600
                    transition-all duration-200 p-5">
      {/* Top row */}
      <div className="flex items-start gap-3 mb-3">
        {/* Icon */}
        <div className="w-9 h-9 rounded-xl bg-brand-50 dark:bg-brand-900/30 flex items-center justify-center shrink-0">
          <svg className="w-4.5 h-4.5 text-brand-600 dark:text-brand-400 w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
          </svg>
        </div>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') { setRenaming(false); setTitleInput(session.title) } }}
                onBlur={handleRename}
                className="flex-1 text-sm font-semibold text-slate-900 dark:text-slate-100
                           bg-transparent border-b-2 border-brand-500 outline-none pb-0.5 min-w-0"
              />
            </div>
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="text-left group/title"
              title="Click to rename"
            >
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug
                             truncate group-hover/title:text-brand-600 dark:group-hover/title:text-brand-400 transition-colors">
                {session.title || 'Untitled Session'}
              </h3>
            </button>
          )}
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">
            {session.feature_request?.slice(0, 90) || 'No description'}
            {session.feature_request?.length > 90 ? '...' : ''}
          </p>
        </div>

        {/* Progress badge */}
        <ProgressBadge progress={session.progress} />
      </div>

      {/* Step trail */}
      <div className="mb-3">
        <StepTrail progress={session.progress} />
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500 mb-4">
        <span title={formatDate(session.created_at)}>Created {timeAgo(session.created_at)}</span>
        {session.updated_at !== session.created_at && (
          <>
            <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span title={formatDate(session.updated_at)}>Updated {timeAgo(session.updated_at)}</span>
          </>
        )}
        {session.message_count > 0 && (
          <>
            <span className="w-1 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            <span>{session.message_count} messages</span>
          </>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => onView(session.session_id)}
          className="btn-primary py-1.5 px-3 text-xs flex-1 justify-center"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.641 0-8.573-3.007-9.964-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          View & Load
        </button>
        {/* Show Prototype shortcut for sessions that have at least canvas data */}
        {PROGRESS_ORDER[session.progress] >= PROGRESS_ORDER['canvas'] && (
          <button
            onClick={() => onLoadStep(session.session_id, 'prototype')}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-all shrink-0
                       bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400
                       hover:bg-purple-100 dark:hover:bg-purple-900/40 border border-purple-200 dark:border-purple-800"
            title="Load session and open UI Prototype"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 8.25h3m-3 4.5h3" />
            </svg>
          </button>
        )}
        <button
          onClick={handleDelete}
          className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all
            ${deleting
              ? 'bg-red-500 text-white hover:bg-red-600'
              : 'text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-500'
            }`}
          title={deleting ? 'Confirm delete' : 'Delete session'}
          onBlur={() => setTimeout(() => setDeleting(false), 200)}
        >
          {deleting ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
            </svg>
          )}
        </button>
      </div>

      {deleting && (
        <p className="text-xs text-red-500 text-center mt-2 animate-fade-in">
          Click the checkmark to confirm delete
        </p>
      )}
    </div>
  )
}

// ── Main Portal ────────────────────────────────────────────────────────────── //

export default function HistoryPortal() {
  const [sessions, setSessions]       = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [search, setSearch]           = useState('')
  const [filterProgress, setFilter]  = useState('all')
  const [detailId, setDetailId]       = useState(null)

  const {
    setView, setSessionId, setStep,
    setRequirementState, setResearchState, setCanvasState,
    setDocBundle, setPrototypeState,
    setLoading: setGlobalLoading,
  } = useSessionStore()

  const loadList = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listHistory()
      setSessions(res.data.sessions || [])
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadList() }, [])

  const handleDelete = async (sessionId) => {
    await deleteHistorySession(sessionId)
    setSessions(prev => prev.filter(s => s.session_id !== sessionId))
  }

  const handleRename = async (sessionId, title) => {
    await renameHistorySession(sessionId, title)
    setSessions(prev => prev.map(s => s.session_id === sessionId ? { ...s, title } : s))
  }

  // Called from session cards for direct step navigation (no detail modal needed)
  const handleLoadStep = async (sessionId, step) => {
    setDetailId(null)
    // Fetch detail so bundle_id is available, then force-navigate to requested step
    try {
      const res = await getHistoryDetail(sessionId)
      await handleLoad(sessionId, { ...res.data, _forceStep: step })
    } catch (e) {
      await handleLoad(sessionId, { _forceStep: step })
    }
  }

  const handleLoad = async (sessionId, detail) => {
    setDetailId(null)
    setGlobalLoading(true)
    try {
      setSessionId(sessionId)

      // Restore core agent states in parallel
      const [reqRes, resRes, canRes] = await Promise.all([
        getRequirementState(sessionId),
        getResearchState(sessionId),
        getCanvasState(sessionId),
      ])
      setRequirementState(reqRes.data)
      setResearchState(resRes.data)
      setCanvasState(canRes.data)

      // Restore prototype state (non-fatal if missing)
      let protoStatus = 'idle'
      try {
        const protoRes = await getPrototypeState(sessionId)
        setPrototypeState(protoRes.data)
        protoStatus = protoRes.data?.status ?? 'idle'
      } catch (_) {}

      // Restore docBundle from persisted bundle_id (non-fatal if server restarted)
      const bundleId = detail?.bundle_id
      let bundleRestored = false
      if (bundleId) {
        try {
          const bundleRes = await getBundleStatus(bundleId)
          setDocBundle(bundleRes.data)
          bundleRestored = true
        } catch (_) {
          // JOBS lost on server restart — user will need to regenerate docs
          // but we still know they reached the documents step
        }
      }

      // Navigate to the requested or furthest completed step
      const forceStep = detail?._forceStep
      if (forceStep) {
        setStep(forceStep)
      } else if (protoStatus === 'ready') {
        setStep('prototype')
      } else if (bundleId) {
        setStep('documents')
      } else if (canRes.data.canvas) {
        setStep('canvas')
      } else if (resRes.data.current_report) {
        setStep('research')
      } else {
        setStep('requirement')
      }

      setView('app')
    } catch (e) {
      setView('app')
    } finally {
      setGlobalLoading(false)
    }
  }

  // Filter + search
  const filtered = sessions.filter(s => {
    const matchProgress = filterProgress === 'all' || s.progress === filterProgress
    const q = search.toLowerCase()
    const matchSearch = !q
      || s.title?.toLowerCase().includes(q)
      || s.feature_request?.toLowerCase().includes(q)
    return matchProgress && matchSearch
  })

  const filterOptions = [
    { value: 'all',         label: 'All Sessions' },
    { value: 'canvas',      label: 'Canvas Done' },
    { value: 'research',    label: 'Research Done' },
    { value: 'requirement', label: 'Requirements Done' },
    { value: 'new',         label: 'New' },
  ]

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="shrink-0 mb-5">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Session History</h2>
            <p className="text-sm text-slate-400">Browse, review, and reload past sessions</p>
          </div>
          <button
            onClick={loadList}
            disabled={loading}
            className="btn-ghost py-1.5 px-3 text-xs"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* ── Search + Filter ───────────────────────────────────── */}
      <div className="shrink-0 flex gap-2 mb-4">
        <div className="flex-1 relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none"
               fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by title or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white dark:bg-navy-800
                       border border-slate-200 dark:border-navy-600 text-sm
                       text-slate-900 dark:text-slate-100 placeholder-slate-400
                       focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
          />
        </div>
        <select
          value={filterProgress}
          onChange={(e) => setFilter(e.target.value)}
          className="px-3 py-2.5 rounded-xl bg-white dark:bg-navy-800 border border-slate-200 dark:border-navy-600
                     text-sm text-slate-700 dark:text-slate-300 focus:outline-none
                     focus:ring-2 focus:ring-brand-500/30 focus:border-brand-400"
        >
          {filterOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* ── Error ─────────────────────────────────────────────── */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 mb-4 rounded-xl
                        bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                        text-sm text-red-600 dark:text-red-400">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Session Grid ──────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-48 bg-white dark:bg-navy-900 rounded-2xl border border-slate-100 dark:border-navy-700 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-64 text-center py-16">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-navy-800 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
            </div>
            <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">
              {search || filterProgress !== 'all' ? 'No matching sessions' : 'No sessions yet'}
            </p>
            <p className="text-sm text-slate-400">
              {search || filterProgress !== 'all'
                ? 'Try adjusting your search or filter'
                : 'Start a new session to see your history here'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4">
            {filtered.map(session => (
              <SessionCard
                key={session.session_id}
                session={session}
                onView={setDetailId}
                onDelete={handleDelete}
                onRename={handleRename}
                onLoadStep={handleLoadStep}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Stats bar ─────────────────────────────────────────── */}
      {!loading && sessions.length > 0 && (
        <div className="shrink-0 pt-3 border-t border-slate-100 dark:border-navy-700 mt-2">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span>{sessions.length} total session{sessions.length !== 1 ? 's' : ''}</span>
            {filtered.length !== sessions.length && (
              <span>{filtered.length} shown</span>
            )}
            <span>{sessions.filter(s => s.progress === 'canvas').length} canvas completed</span>
          </div>
        </div>
      )}

      {/* ── Detail Modal ──────────────────────────────────────── */}
      {detailId && (
        <SessionDetailModal
          sessionId={detailId}
          onClose={() => setDetailId(null)}
          onLoad={handleLoad}
        />
      )}
    </div>
  )
}
