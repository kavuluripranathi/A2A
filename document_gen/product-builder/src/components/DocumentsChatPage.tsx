import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Brain, Check, FileText, ChevronRight } from 'lucide-react';
import { generateDocuments, generateExecutionItems } from '../utils/canvasGenerator';
import DocumentsView from './DocumentsView';
import type { CanvasData, Document, ExecutionItem } from '../types';

interface ThinkingStep {
  label: string;
  detail: string;
  duration: number;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; steps: ThinkingStep[]; totalMs: number; expanded: boolean }
  | { type: 'documents-ready'; documents: Document[] };

interface Message {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
  createdAt: number;
}

interface DocumentsChatPageProps {
  canvas: CanvasData;
  featureName: string;
  messages: any[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  active: boolean;
  onApprove: (docs: Document[], execItems: ExecutionItem[]) => void;
}

type DocumentGenerationStart =
  | { status: 'fallback'; feature_name: string; documents: Document[] }
  | { status: 'pending'; bundle_id: string; feature_name: string };

interface BundleStatusJob {
  doc_type: string;
  job_id?: string | null;
  status: string;
  progress: number;
  current_step: string;
  rag_warning?: string | null;
  document: Document;
}

interface BundleStatusResponse {
  bundle_id: string;
  overall_status: string;
  jobs: BundleStatusJob[];
  documents: Document[];
}

const DOCUMENT_ORDER: Array<{ id: string; title: string; icon: string; docType: string }> = [
  { id: 'product-doc', title: 'Business Requirements Document', icon: 'FileText', docType: 'BRD' },
  { id: 'test-cases', title: 'Technical Specification Document', icon: 'TestTube2', docType: 'TSD' },
  { id: 'product-note', title: 'Product Note', icon: 'FileText', docType: 'Product Note' },
  { id: 'circular-draft', title: 'Regulatory Circular', icon: 'ScrollText', docType: 'Circular' },
];

function buildPlaceholderDocuments(featureName: string): Document[] {
  return DOCUMENT_ORDER.map((doc, index) => ({
    id: doc.id,
    title: `${doc.title} — ${featureName}`,
    icon: doc.icon,
    content: '',
    approved: false,
    _status: index === 0 ? 'generating' : 'pending',
    _progress: 0,
    _doc_type: doc.docType,
    _current_step: index === 0 ? 'Preparing document pipeline' : 'Queued',
  }));
}

function markFallbackDocuments(documents: Document[]): Document[] {
  return documents.map(doc => ({
    ...doc,
    _status: 'fallback',
    _progress: 100,
    _current_step: 'Local fallback preview',
  }));
}

function mergeBundleDocuments(status: BundleStatusResponse, previous: Document[]): Document[] {
  const completedById = new Map(status.documents.map(doc => [doc.id, doc]));

  return status.jobs.map(job => {
    const previousDoc = previous.find(doc => doc.id === job.document.id);
    const completedDoc = completedById.get(job.document.id);
    if (completedDoc) {
      return {
        ...previousDoc,
        ...completedDoc,
        approved: previousDoc?.approved ?? false,
        _status: 'completed',
        _progress: 100,
        _current_step: 'Ready',
      };
    }

    return {
      ...previousDoc,
      ...job.document,
      approved: previousDoc?.approved ?? false,
      content: previousDoc?.content ?? '',
      _status: job.status === 'failed' ? 'failed' : job.document._status ?? 'generating',
      _progress: job.progress,
      _current_step: job.current_step,
      _rag_warning: job.rag_warning ?? null,
    };
  });
}

// Gap 12: sessionStorage key per feature so bundle survives page refresh
function _bundleStorageKey(featureName: string) {
  return `docgen_bundle_${featureName.replace(/\s+/g, '_').toLowerCase()}`;
}

async function apiGenerateDocuments(canvas: CanvasData, feedback?: string): Promise<DocumentGenerationStart> {
  try {
    const res = await fetch('/api/documents/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas, feedback }),
    });
    if (!res.ok) throw new Error(`docs api ${res.status}`);
    const data = await res.json();
    if (data.status === 'fallback') {
      return {
        status: 'fallback',
        feature_name: data.feature_name ?? canvas.featureName,
        documents: markFallbackDocuments(data.documents || generateDocuments(canvas)),
      };
    }
    // Gap 12: persist bundle_id so poll can resume after a page refresh
    if (data.bundle_id) {
      try {
        sessionStorage.setItem(
          _bundleStorageKey(data.feature_name ?? canvas.featureName),
          JSON.stringify({ bundle_id: data.bundle_id, feature_name: data.feature_name ?? canvas.featureName }),
        );
      } catch { /* sessionStorage not available (private mode etc.) — silently ignore */ }
    }
    return {
      status: 'pending',
      bundle_id: data.bundle_id,
      feature_name: data.feature_name ?? canvas.featureName,
    };
  } catch {
    return {
      status: 'fallback',
      feature_name: canvas.featureName,
      documents: markFallbackDocuments(generateDocuments(canvas)),
    };
  }
}

async function apiRetryDocument(canvas: CanvasData, bundleId: string, docType: string): Promise<void> {
  const res = await fetch('/api/documents/retry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvas, bundle_id: bundleId, doc_type: docType }),
  });
  if (!res.ok) throw new Error(`retry api ${res.status}`);
}

async function apiDocumentStatus(bundleId: string, featureName: string): Promise<BundleStatusResponse> {
  const params = new URLSearchParams({ feature_name: featureName });
  const res = await fetch(`/api/documents/status/${bundleId}?${params.toString()}`);
  if (!res.ok) throw new Error('status api failed');
  return res.json();
}

async function apiGenerateExecution(canvas: CanvasData, feedback?: string): Promise<ExecutionItem[]> {
  try {
    const res = await fetch('/api/execution/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas, feedback }),
    });
    if (!res.ok) throw new Error('exec api failed');
    const data = await res.json();
    return data.items || generateExecutionItems(canvas);
  } catch { return generateExecutionItems(canvas); }
}

function ThinkingBlock({ block, onToggle }: { block: Extract<ContentBlock, { type: 'thinking' }>; onToggle: () => void }) {
  const mins = Math.floor(block.totalMs / 60000);
  const secs = Math.floor((block.totalMs % 60000) / 1000);
  const timeLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="mb-3 rounded-xl border border-slate-200 overflow-hidden bg-white shadow-sm">
      <button onClick={onToggle} className="flex items-center gap-2.5 w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors">
        <Brain className="w-4 h-4 text-indigo-500 flex-shrink-0" />
        <span className="text-base font-semibold text-slate-700 flex-1">Thought for {timeLabel}</span>
        {block.expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {block.expanded && (
        <div className="border-t border-slate-100 px-4 py-4 max-h-72 overflow-y-auto bg-slate-50/50 space-y-3">
          {block.steps.map((s, i) => (
            <div key={i} className="flex gap-3">
              <div className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0 mt-0.5"><Check className="w-3 h-3" /></div>
              <div className="flex-1">
                <div className="text-base font-semibold text-slate-800">{s.label}</div>
                <div className="text-sm text-slate-500 mt-1 leading-relaxed">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StreamingThinking({ steps, currentStep }: { steps: ThinkingStep[]; currentStep: number; }) {
  const startTimeRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isExpanded, setIsExpanded] = useState(true);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setElapsedMs(Date.now() - startTimeRef.current), 100);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (textRef.current && isExpanded) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [currentStep, isExpanded]);

  const secs = Math.floor(elapsedMs / 1000);
  const ms = Math.floor((elapsedMs % 1000) / 100);
  const timerLabel = `${secs}.${ms}s`;
  const isStreaming = currentStep < steps.length - 1;

  return (
    <div className={`mb-3 rounded-xl border transition-all duration-500 overflow-hidden shadow-sm ${isStreaming ? 'border-indigo-200 bg-indigo-50/30' : 'border-slate-200 bg-slate-50/50'}`}>
      <button onClick={() => setIsExpanded(v => !v)} className={`flex items-center gap-2.5 w-full text-left px-4 py-3 transition-colors ${isStreaming ? 'hover:bg-indigo-50/80' : 'hover:bg-slate-100/50'}`}>
        <Brain className={`w-4 h-4 flex-shrink-0 transition-colors duration-500 ${isStreaming ? 'text-indigo-500 animate-pulse' : 'text-slate-400'}`} />
        <span className={`text-base font-semibold flex-1 transition-colors duration-500 ${isStreaming ? 'text-indigo-900' : 'text-slate-700'}`}>
          {isStreaming ? `Thinking… ${timerLabel}` : `Thought for ${timerLabel}`}
        </span>
        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {isExpanded && (
        <div ref={textRef} className={`border-t px-4 py-4 max-h-64 overflow-y-auto space-y-4 transition-colors duration-500 ${isStreaming ? 'border-indigo-100 bg-indigo-50/50' : 'border-slate-100 bg-white'}`} style={{ scrollBehavior: 'smooth' }}>
          {steps.slice(0, currentStep + 1).map((s, i) => {
            const isLastActive = isStreaming && i === currentStep;
            return (
              <div key={i} className={`flex gap-3 transition-all duration-300 ${isLastActive ? 'opacity-100 translate-y-0' : 'opacity-70'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-500 ${isLastActive ? 'bg-indigo-600 shadow-sm shadow-indigo-500/30' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                  {isLastActive ? <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> : <Check className="w-3 h-3" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold transition-colors duration-500 ${isLastActive ? 'text-indigo-900' : 'text-slate-900'}`}>{s.label}</div>
                  <div className={`text-xs mt-1 leading-relaxed transition-colors duration-500 ${isLastActive ? 'text-indigo-700' : 'text-slate-500'}`}>{s.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center flex-shrink-0 shadow-sm">
      <Sparkles className="w-4 h-4 text-white" />
    </div>
  );
}

export default function DocumentsChatPage({ canvas, featureName, messages, setMessages, active, onApprove }: DocumentsChatPageProps) {
  const [activeDocs, setActiveDocs] = useState<Document[] | null>(null);
  const [techPlanItems, setTechPlanItems] = useState<ExecutionItem[] | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingTP, setIsGeneratingTP] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [thinkingStepsForStream, setThinkingStepsForStream] = useState<ThinkingStep[]>([]);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [feedbackInput, setFeedbackInput] = useState('');
  // bundle_id kept here so retry can reference it
  const currentBundleIdRef = useRef<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const generationStartedRef = useRef(false);
  const pollingCancelledRef = useRef(false);
  const activeDocsRef = useRef<Document[] | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinkingStep]);

  useEffect(() => {
    activeDocsRef.current = activeDocs;
  }, [activeDocs]);

  useEffect(() => {
    return () => {
      pollingCancelledRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (!active || generationStartedRef.current) return;
    const hasDocGenStarted = messages.some((m: any) => m.id.startsWith('a-doc-') || m.blocks.some((b: any) => b.type === 'documents-ready'));
    if (hasDocGenStarted) return;

    // Gap 12: try to resume an in-flight bundle from sessionStorage (survives F5)
    try {
      const stored = sessionStorage.getItem(_bundleStorageKey(featureName));
      if (stored) {
        const parsed = JSON.parse(stored) as { bundle_id: string; feature_name: string };
        if (parsed.bundle_id) {
          currentBundleIdRef.current = parsed.bundle_id;
          resumePolling(parsed.bundle_id, parsed.feature_name);
          return;
        }
      }
    } catch { /* ignore */ }

    startGeneration();
  }, [canvas, featureName, active, messages.length]);

  const handleRefineDocuments = () => {
    if (!feedbackInput.trim() || isGenerating) return;
    const feedback = feedbackInput;
    setFeedbackInput('');
    startGeneration(feedback);
  };

  // Gap 6: retry a single failed document
  const handleRetryDoc = async (docId: string) => {
    const bundleId = currentBundleIdRef.current;
    if (!bundleId || isGenerating) return;
    const doc = activeDocsRef.current?.find(d => d.id === docId);
    const docType = doc?._doc_type;
    if (!docType) return;
    try {
      await apiRetryDocument(canvas, bundleId, docType);
      // Mark the doc as generating again optimistically
      setActiveDocs(prev => prev?.map(d => d.id === docId ? { ...d, _status: 'generating', _progress: 0, _current_step: 'Retrying…' } : d) ?? prev);
    } catch (err) {
      console.error('[retry] failed:', err);
    }
  };

  // Gap 12: resume polling a bundle that was in-flight before a page refresh
  const resumePolling = (bundleId: string, feature: string) => {
    generationStartedRef.current = true;
    pollingCancelledRef.current = false;
    setActiveDocs(buildPlaceholderDocuments(feature));

    const poll = async () => {
      if (pollingCancelledRef.current) return;
      try {
        const status = await apiDocumentStatus(bundleId, feature);
        setActiveDocs(prev => mergeBundleDocuments(status, prev ?? buildPlaceholderDocuments(feature)));
        const isDone = status.jobs.length > 0 && status.jobs.every(j => ['completed', 'failed'].includes(j.status));
        if (isDone || ['completed', 'partial', 'failed'].includes(status.overall_status)) {
          try { sessionStorage.removeItem(_bundleStorageKey(feature)); } catch { /* ignore */ }
          return;
        }
      } catch (err) {
        console.warn('[resumePolling] error — will retry:', err);
      }
      if (!pollingCancelledRef.current) window.setTimeout(poll, 3000);
    };
    poll();
  };

  const startGeneration = async (feedback?: string) => {
    if (!feedback) generationStartedRef.current = true;
    // Gap 13: cancel any running poll before starting a new one
    pollingCancelledRef.current = true;
    // Tiny delay so any in-flight poll iteration sees the cancellation
    await new Promise(r => window.setTimeout(r, 50));
    pollingCancelledRef.current = false;
    const steps: ThinkingStep[] = [
      { label: 'Analyzing approved Product Canvas', detail: 'Extracting feature requirements, user journeys, and regulatory context for documentation mapping.', duration: 800 },
      { label: 'Submitting to claudedocuer pipeline', detail: 'Dispatching BRD, TSD, Product Note & Circular generation jobs in parallel via the claudedocuer bundle API.', duration: 1200 },
      { label: 'Retrieving UPI knowledge base context', detail: 'RAG retrieval over NPCI operational circulars and UPI specification documents.', duration: 2500 },
      { label: 'Planning document structure', detail: 'AI-driven section planning aligned to NPCI documentation blueprints.', duration: 2000 },
      { label: 'Writing document sections', detail: 'Parallel LLM-driven authoring of all document sections with regulatory depth.', duration: 5000 },
      { label: 'Validating & reviewing generated content', detail: 'Running structural validation and substantive content checks across all sections.', duration: 2000 },
      { label: 'Assembling final compliance pack', detail: 'Finalizing markdown preview and building high-quality DOCX documents.', duration: 2000 },
    ];
    setThinkingStepsForStream(steps);
    setThinkingStep(0);

    const aiMsgId = `a-doc-${Date.now()}`;
    setMessages((prev: any[]) => [
      ...prev,
      ...(feedback ? [{ id: `u-fb-${Date.now()}`, role: 'user', blocks: [{ type: 'text', text: feedback }], createdAt: Date.now() }] : []),
      { id: `a-doc-msg-${Date.now()}`, role: 'assistant', blocks: [{ type: 'text', text: feedback ? `Understood. I'm regenerating the **Documentation Pack** with your feedback: "${feedback}"` : `I am now generating the **Documentation Pack** for *${featureName}* based on your approved Canvas.` }], createdAt: Date.now() + 1 },
      { id: aiMsgId, role: 'assistant', blocks: [{ type: 'thinking', steps: [], totalMs: 0, expanded: false }], createdAt: Date.now() + 2 }
    ]);
    setStreamingMsgId(aiMsgId);
    setIsGenerating(true);

    const startMs = Date.now();
    let idx = 0;
    const LAST_STEP = steps.length - 1;
    let apiComplete = false;
    let docsResult: Document[] | null = null;

    setActiveDocs(buildPlaceholderDocuments(featureName));

    apiGenerateDocuments(canvas, feedback).then(async (res: DocumentGenerationStart) => {
      if (res.status === 'fallback') {
        // Gap 4: surface fallback reason in chat so user is not left guessing
        setMessages((prev: any[]) => [
          ...prev,
          {
            id: `a-fallback-${Date.now()}`,
            role: 'assistant',
            blocks: [{
              type: 'text',
              text: '⚠ The document generation pipeline is unavailable right now. Showing a local preview instead. You can still review the structure and regenerate once the service is back.',
            }],
            createdAt: Date.now(),
          },
        ]);
        docsResult = res.documents;
        setActiveDocs(res.documents);
        apiComplete = true;
        return;
      }

      currentBundleIdRef.current = res.bundle_id;
      setActiveDocs(buildPlaceholderDocuments(res.feature_name));

      // Gap 5: track consecutive errors; only fallback after 3 failures
      let consecutiveErrors = 0;
      const MAX_POLL_ERRORS = 3;

      const poll = async () => {
        if (pollingCancelledRef.current) return;
        try {
          const status = await apiDocumentStatus(res.bundle_id, res.feature_name);
          consecutiveErrors = 0; // reset on success

          setActiveDocs(prev => mergeBundleDocuments(status, prev ?? buildPlaceholderDocuments(res.feature_name)));

          const isDone = status.jobs.length > 0 && status.jobs.every(job => ['completed', 'failed'].includes(job.status));
          if (isDone || ['completed', 'partial', 'failed'].includes(status.overall_status)) {
            docsResult = mergeBundleDocuments(status, activeDocsRef.current ?? buildPlaceholderDocuments(res.feature_name));
            // Clear sessionStorage once generation is complete
            try { sessionStorage.removeItem(_bundleStorageKey(res.feature_name)); } catch { /* ignore */ }
            apiComplete = true;
            return;
          }
        } catch (error) {
          consecutiveErrors++;
          console.warn(`[poll] error #${consecutiveErrors}/${MAX_POLL_ERRORS}:`, error);
          if (consecutiveErrors >= MAX_POLL_ERRORS) {
            // Gap 5: only fall back after 3 consecutive failures, not on the first one
            console.error('[poll] max errors reached — falling back to local preview');
            docsResult = markFallbackDocuments(activeDocsRef.current?.length
              ? activeDocsRef.current
              : generateDocuments(canvas));
            setActiveDocs(docsResult);
            apiComplete = true;
            return;
          }
        }

        if (!pollingCancelledRef.current) {
          window.setTimeout(poll, 3000);
        }
      };

      poll();
    }).catch((err: unknown) => {
      console.error(err);
      docsResult = markFallbackDocuments(generateDocuments(canvas));
      setActiveDocs(docsResult);
      apiComplete = true;
    });

    const runStep = () => {
      if (idx > LAST_STEP) {
        if (!apiComplete) { setTimeout(runStep, 500); return; }
        finalize(); return;
      }
      setThinkingStep(idx);
      if (idx === LAST_STEP) {
        if (!apiComplete) { setTimeout(runStep, 500); return; }
        finalize(); return;
      }
      idx++;
      setTimeout(runStep, steps[idx - 1]?.duration || 800);
    };

    const finalize = () => {
      if (!docsResult) { setTimeout(finalize, 300); return; }
      const totalMs = Date.now() - startMs;
      setIsGenerating(false);
      setStreamingMsgId(null);
      setActiveDocs(docsResult);

      setMessages(prev => prev.map(m => {
        if (m.id !== aiMsgId) return m;
        return {
          ...m,
          blocks: [
            { type: 'thinking', steps, totalMs, expanded: false },
            { type: 'text', text: feedback ? 'Documentation has been refined. Each document card now unlocks preview and download as soon as that file is ready.' : 'Document generation is underway. Preview and download controls unlock per document as each file finishes.' },
            { type: 'documents-ready', documents: docsResult! }
          ]
        };
      }));
    };

    setTimeout(runStep, 300);
  };

  const renderBlock = (block: ContentBlock, msg: Message, blockIdx: number) => {
    if (block.type === 'thinking') {
      if (isGenerating && msg.id === streamingMsgId) return <StreamingThinking key={blockIdx} steps={thinkingStepsForStream} currentStep={thinkingStep} />;
      if (block.steps.length === 0) return null;
      return <ThinkingBlock key={blockIdx} block={block} onToggle={() => setMessages((prev: any[]) => prev.map((m: any) => {
        if (m.id !== msg.id) return m;
        return {
          ...m,
          blocks: m.blocks.map((b: any, bi: number) => {
            if (bi === blockIdx && b.type === 'thinking') {
              return { ...b, expanded: !b.expanded };
            }
            return b;
          })
        };
      }))} />;
    }

    if (block.type === 'text') {
      const isTPReady = block.text.includes('Technical Plan is ready');
      return (
        <div key={blockIdx}>
          <div className="text-base text-gray-800 leading-relaxed mb-2">
            {block.text.split('\n').map((line, i) => {
              if (!line) return <br key={i} />;
              const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
              return (
                <span key={i} className="block mb-0.5">
                  {parts.map((p, j) => {
                    if (p.startsWith('**')) return <strong key={j}>{p.slice(2, -2)}</strong>;
                    if (p.startsWith('*')) return <em key={j}>{p.slice(1, -1)}</em>;
                    return p;
                  })}
                </span>
              );
            })}
          </div>
          {isTPReady && (
            <div className="mt-4">
              <button
                onClick={() => onApprove(activeDocs || [], techPlanItems || [])}
                className="flex items-center gap-2 px-6 py-3 bg-slate-900 text-white font-black rounded-xl shadow-lg hover:bg-black transition-all hover:scale-105 active:scale-95 uppercase tracking-wider text-sm"
              >
                <ChevronRight className="w-4 h-4" />
                Go to Technical Plan Interface
              </button>
            </div>
          )}
        </div>
      );
    }

    if (block.type === 'documents-ready') {
      return null;
    }

    return null;
  };

  async function handleStartTechPlan() {
    if (isGeneratingTP) return;
    setIsGeneratingTP(true);

    const steps: ThinkingStep[] = [
      { label: 'Ingesting Product Canvas & Documents', detail: 'Parsing functional requirements and compliance constraints.', duration: 3500 },
      { label: 'Synthesizing Architecture Blueprint', detail: 'Designing service mesh and API orchestration layer.', duration: 5000 },
      { label: 'Mapping UPI Lifecycle Transitions', detail: 'Defining state machine for block creation, execution, and revocation.', duration: 4500 },
      { label: 'Integrating Regulatory Checkpoints', detail: 'Mapping NPCI Operational Circulars to system validation logic.', duration: 4000 },
      { label: 'Building Agent Execution Matrix', detail: 'Allocating tasks across Risk, Compliance, and Technical Advisory agents.', duration: 5500 },
      { label: 'Simulating Edge Case Scenarios', detail: 'Verifying partial debits, concurrent revocations, and transaction timeouts.', duration: 6000 },
      { label: 'Finalizing Deployment Manifest', detail: 'Formatting technical roadmap and implementation sequence.', duration: 5000 },
      { label: 'Verification Complete', detail: 'Technical plan validated against UPI switch specifications.', duration: 2500 },
    ];
    setThinkingStepsForStream(steps);
    setThinkingStep(0);

    const tpMsgId = `a-tp-${Date.now()}`;
    setMessages((prev: any[]) => [
      ...prev,
      { 
        id: `u-tp-appr-${Date.now()}`, 
        role: 'user', 
        blocks: [{ type: 'text', text: 'Documentation pack is approved. Please generate the technical orchestration plan.' }], 
        createdAt: Date.now() 
      },
      {
        id: `a-tp-msg-${Date.now()}`,
        role: 'assistant',
        blocks: [{ type: 'text', text: `I am now architecting the **Technical Orchestration Plan** for this feature.` }],
        createdAt: Date.now() + 1
      },
      {
        id: tpMsgId,
        role: 'assistant',
        blocks: [{ type: 'thinking', steps: [], totalMs: 0, expanded: true }],
        createdAt: Date.now() + 2
      }
    ]);
    setStreamingMsgId(tpMsgId);
    setIsGenerating(true);

    const startMs = Date.now();
    let idx = 0;
    const LAST_STEP = steps.length - 1;
    let apiComplete = false;
    let execResult: ExecutionItem[] | null = null;

    apiGenerateExecution(canvas).then(res => {
      execResult = res;
      apiComplete = true;
    }).catch(err => {
      console.error(err);
      apiComplete = true;
    });

    const runStep = () => {
      if (idx > LAST_STEP) {
        if (!apiComplete) { setTimeout(runStep, 500); return; }
        finalize(); return;
      }
      setThinkingStep(idx);
      if (idx === LAST_STEP) {
        if (!apiComplete) { setTimeout(runStep, 500); return; }
        finalize(); return;
      }
      idx++;
      setTimeout(runStep, steps[idx - 1]?.duration || 800);
    };

    const finalize = () => {
      if (!execResult) { setTimeout(finalize, 300); return; }
      const totalMs = Date.now() - startMs;
      setStreamingMsgId(null);
      setIsGenerating(false);
      setIsGeneratingTP(false);
      setTechPlanItems(execResult);

      setMessages(prev => prev.map(m => {
        if (m.id !== tpMsgId) return m;
        return {
          ...m,
          blocks: [
            { type: 'thinking', steps, totalMs, expanded: false },
            { type: 'text', text: 'Technical Plan is ready! You can now proceed to the orchestration interface.' }
          ]
        };
      }));
    };

    setTimeout(runStep, 300);
  }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* ════ LEFT — Chat ════ */}
      <div className={`flex flex-col border-r border-slate-200 transition-all duration-300 ${activeDocs ? 'w-[30%] min-w-[340px]' : 'w-full max-w-3xl mx-auto'}`}>
        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6 bg-white">
          {messages.map((msg: any) => (
            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {msg.role === 'user' ? (
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">USER</span>
                </div>
              ) : (
                <AssistantAvatar />
              )}
              <div className={`flex-1 min-w-0 max-w-full ${msg.role === 'user' ? 'flex flex-col items-end' : ''}`}>
                {msg.role === 'user' ? (
                   <div className="bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 max-w-sm shadow-lg shadow-indigo-500/10">
                     <p className="text-sm leading-relaxed whitespace-pre-wrap font-bold">{(msg.blocks[0] as any).text?.replace(/\*\*/g, '')}</p>
                   </div>
                ) : (
                  msg.blocks.map((block: any, bi: number) => renderBlock(block, msg, bi))
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        
        <div className="flex-shrink-0 border-t border-slate-100 bg-white p-6">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2.5 focus-within:ring-4 focus-within:ring-indigo-500/5 focus-within:border-indigo-500 transition-all shadow-inner">
            <input
              type="text"
              value={feedbackInput}
              onChange={e => setFeedbackInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRefineDocuments()}
              placeholder="Suggest refinements to documentation..."
              className="flex-1 bg-transparent border-none outline-none text-sm font-bold text-slate-800 placeholder-slate-400 py-1"
              disabled={isGenerating}
            />
            <button
              onClick={handleRefineDocuments}
              disabled={!feedbackInput.trim() || isGenerating}
              className={`p-2 rounded-xl transition-all ${feedbackInput.trim() && !isGenerating ? 'bg-slate-900 text-white shadow-xl shadow-slate-900/20 hover:bg-black' : 'bg-slate-200 text-slate-400'}`}
            >
              <Sparkles className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ════ RIGHT — Documents Panel ════ */}
      {activeDocs ? (
        <div className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden">
          <DocumentsView
            documents={activeDocs}
            featureName={featureName}
            onUpdate={setActiveDocs}
            onApprove={() => handleStartTechPlan()}
            onRetry={handleRetryDoc}
          />
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-slate-50/50 flex-col gap-6 text-center p-12">
          <div className="w-24 h-24 bg-white border border-slate-100 shadow-2xl shadow-slate-200/50 rounded-[2.5rem] flex items-center justify-center animate-pulse">
            <FileText className="w-11 h-11 text-indigo-400" />
          </div>
          <div className="max-w-xs">
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-widest mb-2">Build Repository</h3>
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] leading-relaxed">Agentic pipeline is generating compliance and product kit manifestations…</p>
          </div>
        </div>
      )}
    </div>
  );
}
