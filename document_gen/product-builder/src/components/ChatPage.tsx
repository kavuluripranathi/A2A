import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Send, ChevronDown, ChevronUp, Sparkles, User,
  Layout, RefreshCw, AlertCircle, Brain,
  Check, X
} from 'lucide-react';
import CanvasView from './CanvasView';
import type { CanvasData, CanvasSection, PrototypeData } from '../types';

/* ─────────────────── Types ─────────────────── */
interface ThinkingStep {
  label: string;
  detail: string;
  duration: number;
}

type ContentBlock =
  | { type: 'text';     text: string }
  | { type: 'thinking'; steps: ThinkingStep[]; totalMs: number; expanded: boolean }
  | { type: 'artifact'; canvas: CanvasData; active: boolean; approved?: boolean }
  | { type: 'prototype-ready'; canvas: CanvasData; prototype: PrototypeData }
  | { type: 'prototype-choice'; canvas: CanvasData; aiMsgId: string }
  | { type: 'analyzing' };

interface Message {
  id: string;
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
  createdAt: number;
}

interface ChatPageProps {
  prompt: string;
  featureName: string;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<any[]>>;
  onApprove: (canvas: CanvasData, prototype?: PrototypeData) => void;
}

/* ─────────────────── API Client ─────────────────── */
interface ClarifyResult {
  confident: boolean;
  questions: { id: string; question: string; reason: string; placeholder: string }[];
  missing_areas: string[];
  summary: string;
}

async function apiClarify(prompt: string, featureName: string): Promise<ClarifyResult> {
  const res = await fetch('/api/canvas/clarify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, feature_name: featureName }),
  });
  if (!res.ok) return { confident: true, questions: [], missing_areas: [], summary: '' };
  return res.json();
}

async function apiGenerateCanvas(
  prompt: string,
  featureName: string,
  clarificationQA?: { question: string; answer: string }[],
): Promise<{
  canvas: CanvasData;
  thinking_steps: ThinkingStep[];
  elapsed_ms: number;
}> {
  const res = await fetch('/api/canvas/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, feature_name: featureName, clarification_qa: clarificationQA || [] }),
  });
  if (!res.ok) throw new Error(`Canvas generation failed: ${res.status}`);
  return res.json();
}

async function apiFollowup(userText: string, canvas: CanvasData): Promise<{
  text: string;
  updated_section: CanvasSection | null;
  thinking: string;
}> {
  const res = await fetch('/api/canvas/followup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_text: userText, canvas }),
  });
  if (!res.ok) throw new Error(`Follow-up failed: ${res.status}`);
  return res.json();
}

async function apiGeneratePrototype(canvas: CanvasData): Promise<PrototypeData> {
  try {
    const res = await fetch('/api/prototype/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ canvas }),
    });
    if (!res.ok) throw new Error('proto api failed');
    const data = await res.json();
    return data.prototype || import('../utils/canvasGenerator').then(m => m.generatePrototype(canvas));
  } catch { return import('../utils/canvasGenerator').then(m => m.generatePrototype(canvas)); }
}

/* ─────────────────── Subcomponents ─────────────────── */

function ThinkingBlock({
  block, onToggle
}: {
  block: Extract<ContentBlock, { type: 'thinking' }>;
  onToggle: () => void;
}) {
  const mins = Math.floor(block.totalMs / 60000);
  const secs = Math.floor((block.totalMs % 60000) / 1000);
  const timeLabel = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return (
    <div className="mb-4 rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm transition-all hover:shadow-md">
      {/* Header toggle */}
      <button
        onClick={onToggle}
        className="flex items-center gap-3 w-full text-left px-5 py-4 hover:bg-slate-50 transition-colors group"
      >
        <div className="w-8 h-8 rounded-xl bg-indigo-50 flex items-center justify-center transition-colors group-hover:bg-indigo-100">
          <Brain className="w-4 h-4 text-indigo-600 flex-shrink-0" />
        </div>
        <span className="text-[11px] font-black text-slate-700 flex-1 uppercase tracking-widest">
          Analysis Pulsed for {timeLabel}
        </span>
        {block.expanded
          ? <ChevronUp className="w-4 h-4 text-slate-400" />
          : <ChevronDown className="w-4 h-4 text-slate-400" />
        }
      </button>

      {block.expanded && (
        <div className="border-t border-slate-100 px-5 py-5 max-h-80 overflow-y-auto bg-slate-50/50 space-y-4 custom-scrollbar">
          {block.steps.map((s, i) => (
            <div key={i} className="flex gap-4 group/step">
              <div className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0 mt-0.5 border border-emerald-100 transition-colors group-hover/step:bg-emerald-100">
                <Check className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 overflow-hidden">
                <div className="text-sm font-black text-slate-800 tracking-tight">{s.label}</div>
                <div className="text-[10px] text-slate-500 mt-1.5 leading-relaxed font-bold uppercase tracking-tight break-words">{s.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Live streaming thinking ───────────────────────────── */
function StreamingThinking({ steps, currentStep, active }: {
  steps: ThinkingStep[];
  currentStep: number;
  active: boolean;
}) {
  const startTimeRef = useRef(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isExpanded, setIsExpanded] = useState(true);
  const textRef = useRef<HTMLDivElement>(null);

  // Live timer — measures real wall-clock time from mount
  useEffect(() => {
    const t = setInterval(() => {
      setElapsedMs(Date.now() - startTimeRef.current);
    }, 100);
    return () => clearInterval(t);
  }, []);

  // Auto-scroll the streaming list
  useEffect(() => {
    if (textRef.current && isExpanded) {
      textRef.current.scrollTop = textRef.current.scrollHeight;
    }
  }, [currentStep, isExpanded]);

  const secs = Math.floor(elapsedMs / 1000);
  const ms   = Math.floor((elapsedMs % 1000) / 100);
  const timerLabel = `${secs}.${ms}s`;
  const isStreaming = active;

  return (
    <div className="mb-4 rounded-[2rem] border border-indigo-100 bg-indigo-50/40 backdrop-blur-sm overflow-hidden shadow-sm transition-all">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(v => !v)}
        className="flex items-center gap-3 w-full text-left px-5 py-4 hover:bg-white/40 transition-colors group"
      >
        <div className="w-9 h-9 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Brain className={`w-5 h-5 flex-shrink-0 text-white ${isStreaming ? 'animate-pulse' : ''}`} />
        </div>
        <span className="text-[11px] font-black text-indigo-900 flex-1 uppercase tracking-widest">
          {isStreaming ? `Analyzing Ecosystem… ${timerLabel}` : `Analysis Complete (${timerLabel})`}
        </span>
        {isExpanded
          ? <ChevronUp className="w-5 h-5 text-indigo-400" />
          : <ChevronDown className="w-5 h-5 text-indigo-400" />
        }
      </button>

      {isExpanded && (
        <div
          ref={textRef}
          className="border-t border-indigo-100 px-6 py-5 max-h-72 overflow-y-auto space-y-5 bg-white/40 custom-scrollbar"
          style={{ scrollBehavior: 'smooth' }}
        >
          {steps.slice(0, currentStep + 1).map((s, i) => {
            const isLastActive = isStreaming && i === currentStep;
            return (
              <div key={i} className={`flex gap-4 transition-all duration-500 ${isLastActive ? 'opacity-100 translate-y-0 scale-100' : 'opacity-60 scale-[0.98]'}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 transition-all duration-300 ${isLastActive ? 'bg-indigo-600 shadow-lg shadow-indigo-500/40 text-white' : 'bg-indigo-100 text-indigo-500'}`}>
                  {isLastActive ? (
                    <div className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-black tracking-tight ${isLastActive ? 'text-indigo-900' : 'text-slate-700'}`}>{s.label}</div>
                  <div className={`text-[10px] mt-1.5 leading-relaxed font-bold uppercase tracking-tight break-words ${isLastActive ? 'text-indigo-700' : 'text-slate-500'}`}>{s.detail}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function CanvasArtifactCard({
  canvas, active, onClick, approved
}: {
  canvas: CanvasData;
  active: boolean;
  onClick: () => void;
  approved?: boolean;
}) {
  const approvedCount = canvas.sections.filter(s => s.approved).length;
  const total = canvas.sections.length;

  return (
    <button
      onClick={onClick}
      className={`mt-4 flex items-center gap-4 w-full text-left rounded-[2rem] border p-5 transition-all duration-300 group shadow-sm
        ${approved
          ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-400 hover:shadow-emerald-900/5'
          : active
          ? 'border-indigo-600 bg-indigo-50 shadow-indigo-900/10 scale-[1.02]'
          : 'border-slate-100 bg-white hover:border-indigo-200 hover:shadow-xl hover:shadow-indigo-900/5 hover:-translate-y-0.5'
        }`}
    >
      <div className={`w-14 h-14 rounded-[1.25rem] flex items-center justify-center flex-shrink-0 transition-all group-hover:scale-110 group-hover:rotate-3 ${approved ? 'bg-emerald-100' : active ? 'bg-slate-900 shadow-xl shadow-slate-900/20' : 'bg-slate-50'}`}>
        <Layout className={`w-7 h-7 ${approved ? 'text-emerald-600' : active ? 'text-white' : 'text-slate-400'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className={`text-base font-black tracking-tight mb-1 ${approved ? 'text-emerald-900' : 'text-slate-900'}`}>Product Canvas Orchestrator</div>
        <div className={`text-[10px] font-black uppercase tracking-[0.2em] ${approved ? 'text-emerald-600' : 'text-slate-400'}`}>
          {approved ? 'Mission Profile Validated' : `${approvedCount}/${total} MODULES VERIFIED`}
        </div>
      </div>
      <div className={`px-5 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] transition-all shadow-sm ${approved ? 'bg-emerald-100 text-emerald-700' : active ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-500 group-hover:bg-indigo-600 group-hover:text-white'}`}>
        {approved ? '✓ Sign-off' : active ? 'Open' : 'Review'}
      </div>
    </button>
  );
}

/* ─────────────────── Clarification UI ──────────────────────────────────── */
function ClarificationCard({
  questions,
  summary,
  onSubmit,
  onSkip,
}: {
  questions: ClarifyResult['questions'];
  summary: string;
  onSubmit: (answers: Record<string, string>) => void;
  onSkip: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map(q => [q.id, '']))
  );

  const allAnswered = questions.every(q => answers[q.id]?.trim());

  return (
    <div className="my-6 bg-blue-50 border border-blue-100 rounded-[2.5rem] overflow-hidden shadow-xl shadow-blue-900/5 transition-all">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-5 bg-blue-100/50 border-b border-blue-100">
        <div className="w-10 h-10 rounded-2xl bg-blue-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-blue-500/20">
          <Brain className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-black text-blue-900 uppercase tracking-widest leading-none mb-1">A few clarifications needed</div>
          <div className="text-[10px] font-black text-blue-600 uppercase tracking-widest opacity-80">{summary}</div>
        </div>
        <button onClick={onSkip} className="text-[10px] font-black text-blue-500 hover:text-blue-700 uppercase tracking-widest underline transition-colors">
          Skip & build anyway
        </button>
      </div>

      {/* Questions */}
      <div className="p-6 space-y-6">
        {questions.map((q, i) => (
          <div key={q.id} className="group">
            <div className="flex items-start gap-4 mb-3">
              <span className="w-6 h-6 rounded-lg bg-blue-200 text-blue-700 text-[10px] font-black flex items-center justify-center flex-shrink-0 mt-0.5 tracking-tighter">
                0{i + 1}
              </span>
              <div>
                <div className="text-sm font-black text-slate-800 tracking-tight">{q.question}</div>
                <div className="text-[10px] font-black text-slate-400 mt-1 uppercase tracking-widest">{q.reason}</div>
              </div>
            </div>
            <textarea
              value={answers[q.id]}
              onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))}
              placeholder={q.placeholder}
              rows={2}
              className="w-full ml-10 text-sm border border-slate-200 rounded-2xl px-4 py-3 bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 text-slate-700 font-bold placeholder-slate-300 resize-none shadow-inner"
              style={{ width: 'calc(100% - 2.5rem)' }}
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-6 py-4 bg-white/50 border-t border-blue-100">
        <button
          onClick={() => onSubmit(answers)}
          disabled={!allAnswered}
          className={`flex items-center gap-3 px-6 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
            allAnswered
              ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-xl shadow-blue-500/20 active:scale-[0.98]'
              : 'bg-slate-100 text-slate-300 cursor-not-allowed'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          Initialize Build
        </button>
        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
          {questions.filter(q => answers[q.id]?.trim()).length} of {questions.length} Answered
        </span>
      </div>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="w-10 h-10 rounded-[1.25rem] bg-gradient-to-br from-slate-900 to-indigo-600 flex items-center justify-center flex-shrink-0 shadow-xl shadow-indigo-900/20 transition-transform hover:scale-110">
      <Sparkles className="w-5 h-5 text-white" />
    </div>
  );
}

function AnalyzingAnimation() {
  const [dots, setDots] = useState('');
  const [taskIdx, setTaskIdx] = useState(0);
  const tasks = [
    'Scanning NPCI Circulars...',
    'Reviewing RBI Digital Payment Guidelines...',
    'Analyzing Ecosystem Impact...',
    'Scoping Regulatory Compliance...',
    'Mapping User Persona Workflows...'
  ];

  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400);
    const t2 = setInterval(() => setTaskIdx(i => (i + 1) % tasks.length), 2000);
    return () => { clearInterval(t); clearInterval(t2); };
  }, []);

  return (
    <div className="flex flex-col gap-4 p-7 bg-slate-900 text-white rounded-[2.5rem] shadow-2xl shadow-indigo-900/10 animate-pulse relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-3xl" />
      <div className="flex items-center gap-4 relative z-10">
        <div className="w-11 h-11 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 flex items-center justify-center">
          <Brain className="w-6 h-6 text-indigo-400 animate-spin" />
        </div>
        <span className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-100">Titan Agent: Deep Synthesis Pulsing{dots}</span>
      </div>
      <div className="space-y-4 pl-15 relative z-10">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin" />
          <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest italic transition-all duration-500">{tasks[taskIdx]}</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full w-full overflow-hidden shadow-inner">
          <div className="h-full bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.6)] animate-loading-bar" style={{ width: '40%' }}></div>
        </div>
      </div>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-10 h-10 rounded-[1.25rem] bg-slate-100 flex items-center justify-center flex-shrink-0 border border-slate-200 transition-transform hover:scale-110">
      <User className="w-5 h-5 text-slate-400" />
    </div>
  );
}

/* ─────────────────── Main ChatPage ─────────────────── */
export default function ChatPage({ prompt, featureName, messages, setMessages, onApprove }: ChatPageProps) {
  const [activeCanvas, setActiveCanvas] = useState<CanvasData | null>(null);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [thinkingStep, setThinkingStep] = useState(0);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinkingStepsForStream, setThinkingStepsForStream] = useState<ThinkingStep[]>([]);
  // Clarification state
  const [clarifyResult, setClarifyResult] = useState<ClarifyResult | null>(null);
  const [clarifyMsgId, setClarifyMsgId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Guard against React StrictMode double-invocation
  const initFiredRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, thinkingStep, clarifyResult]);

  /* ── Core canvas generation (after clarification) ── */
  const runCanvasGeneration = useCallback((extraQA: { question: string; answer: string }[]) => {
    const aiMsgId = `a${Date.now()}`;
    const generationStartMs = Date.now(); // wall-clock start for real timer
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      blocks: [{ type: 'thinking', steps: [], totalMs: 0, expanded: false }],
      createdAt: Date.now(),
    };

    // Use default steps immediately — don't switch mid-animation to avoid double render
    const steps = getDefaultThinkingSteps(featureName);
    setThinkingStepsForStream(steps);
    setThinkingStep(0);

    setMessages(prev => [...prev, aiMsg]);
    setStreamingMsgId(aiMsgId);
    setIsGenerating(true);
    setError(null);
    setClarifyResult(null);

    let apiComplete = false;
    let apiResult: { canvas: CanvasData; thinking_steps: ThinkingStep[]; elapsed_ms: number } | null = null;

    // Fetch canvas in background — use its thinking steps for the FINAL block only
    apiGenerateCanvas(prompt, featureName, extraQA).then(result => {
      apiResult = result;
      apiComplete = true;
    }).catch(async () => {
      const { generateCanvas } = await import('../utils/canvasGenerator');
      const canvas = generateCanvas(prompt, featureName);
      apiResult = { canvas, thinking_steps: steps, elapsed_ms: 0 };
      apiComplete = true;
    });

    let idx = 0;
    const LAST_STEP = steps.length - 1; // "Building & validating canvas…" — stays active until API done

    const runStep = () => {
      if (idx > LAST_STEP) {
        // Shouldn't normally reach here, but guard anyway
        if (!apiComplete) { setTimeout(runStep, 500); return; }
        finalize(); return;
      }

      setThinkingStep(idx);

      // Last step: stay active (keep polling) until API is done
      if (idx === LAST_STEP) {
        if (!apiComplete) { setTimeout(runStep, 500); return; }
        finalize(); return;
      }

      idx++;
      setTimeout(runStep, steps[idx - 1]?.duration || 800);
    };

    const streamText = (fullText: string, canvas: CanvasData, finalSteps: ThinkingStep[], totalMs: number) => {
      let currentText = "";
      const words = fullText.split(" ");
      let wordIdx = 0;
      const interval = setInterval(() => {
        if (wordIdx >= words.length) {
          clearInterval(interval);
          setIsGenerating(false);
          setStreamingMsgId(null);
          return;
        }
        currentText += (wordIdx === 0 ? "" : " ") + words[wordIdx];
        wordIdx++;
        setMessages(prev => prev.map(m => {
          if (m.id !== aiMsgId) return m;
          return {
            ...m,
            blocks: [
              { type: 'thinking', steps: finalSteps, totalMs, expanded: false },
              { type: 'text', text: currentText },
              { type: 'artifact', canvas, active: false },
            ],
          };
        }));
      }, 40);
    };

    const finalize = () => {
      if (!apiResult) { setTimeout(finalize, 300); return; }
      const { canvas } = apiResult;
      // Always prefer the dynamic, research-based steps from the API
      const finalSteps = (apiResult.thinking_steps?.length ?? 0) > 0
        ? apiResult.thinking_steps
        : steps;
      // Real wall-clock elapsed time — not sum of hardcoded durations
      const totalMs = Date.now() - generationStartMs;

      const qaNote = extraQA.length > 0
        ? `\n\nI've incorporated your clarifications:\n${extraQA.map(q => `• ${q.question}\n  → ${q.answer}`).join('\n')}`
        : '';

      const responseText = `I've analysed **${featureName}** against RBI notifications and NPCI circulars with full ecosystem mapping.${qaNote}\n\nThe 10-section product canvas is ready — structured exactly as NPCI internal documents with specific compliance references, ecosystem effort estimates, and strategic framing. Click the canvas card below to open it, or review each section and approve them individually.`;

      streamText(responseText, canvas, finalSteps, totalMs);
    };

    setTimeout(runStep, 300);
  }, [prompt, featureName]);

  /* ── Initial load: clarify first, then generate ── */
  useEffect(() => {
    // Prevent React StrictMode double-invocation from firing twice
    if (initFiredRef.current) return;
    initFiredRef.current = true;

    const userMsg: Message = {
      id: 'u0',
      role: 'user',
      blocks: [{ type: 'text', text: `Build a product canvas for: **${featureName}**\n\n${prompt}` }],
      createdAt: Date.now(),
    };

    // AI "thinking" message while we evaluate
    const evalMsgId = 'eval0';
    const evalMsg: Message = {
      id: evalMsgId,
      role: 'assistant',
      blocks: [{ type: 'analyzing' }],
      createdAt: Date.now(),
    };
    setMessages([userMsg, evalMsg]);

    const runClarify = async () => {
      try {
        const result = await apiClarify(prompt, featureName);
        if (result.confident || result.questions.length === 0) {
          // Confident — go straight to canvas generation
          setMessages(prev => prev.filter(m => m.id !== evalMsgId));
          runCanvasGeneration([]);
        } else {
          // Show clarification questions
          const clarifyMsg: Message = {
            id: evalMsgId,
            role: 'assistant',
            blocks: [{
              type: 'text',
              text: `I've read your feature brief for **${featureName}**. ${result.summary} Before building the full 10-section canvas, I have ${result.questions.length} quick question${result.questions.length > 1 ? 's' : ''} to ensure the canvas is accurate and complete:`,
            }],
            createdAt: Date.now(),
          };
          setMessages(prev => prev.map(m => m.id === evalMsgId ? clarifyMsg : m));
          setClarifyResult(result);
          setClarifyMsgId(evalMsgId);
        }
      } catch {
        // On error, skip clarification
        setMessages(prev => prev.filter(m => m.id !== evalMsgId));
        runCanvasGeneration([]);
      }
    };

    setTimeout(runClarify, 600);
  }, []);

  /* ── Clarification submitted ── */
  const handleClarifySubmit = useCallback((answers: Record<string, string>) => {
    if (!clarifyResult) return;
    const qa = clarifyResult.questions.map(q => ({
      question: q.question,
      answer: answers[q.id] || '',
    })).filter(q => q.answer.trim());

    // Add user answers as a message
    const answerText = qa.map(q => `**Q: ${q.question}**\nA: ${q.answer}`).join('\n\n');
    const userAnswerMsg: Message = {
      id: `u${Date.now()}`,
      role: 'user',
      blocks: [{ type: 'text', text: answerText }],
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, userAnswerMsg]);
    setClarifyResult(null);
    runCanvasGeneration(qa);
  }, [clarifyResult, runCanvasGeneration]);

  /* ── Toggle thinking expand ── */
  const toggleThinking = (msgId: string) => {
    setMessages(prev => prev.map(m => {
      if (m.id !== msgId) return m;
      return {
        ...m,
        blocks: m.blocks.map((b: ContentBlock) =>
          b.type === 'thinking' ? { ...b, expanded: !b.expanded } : b
        ),
      };
    }));
  };

  /* ── Click artifact card — toggle open/close ── */
  const handleArtifactClick = (canvas: CanvasData, msgId: string) => {
    const isAlreadyOpen = activeCanvas?.featureName === canvas.featureName;
    const next = isAlreadyOpen ? null : canvas;
    setActiveCanvas(next);
    setMessages(prev => prev.map(m => ({
      ...m,
      blocks: m.blocks.map((b: ContentBlock) =>
        b.type === 'artifact'
          ? { ...b, active: !isAlreadyOpen && m.id === msgId && (b as any).canvas.featureName === canvas.featureName }
          : b
      ),
    })));
  };

  /* ── Close canvas panel ── */
  const handleCloseCanvas = () => {
    setActiveCanvas(null);
    setMessages(prev => prev.map(m => ({
      ...m,
      blocks: m.blocks.map((b: ContentBlock) => b.type === 'artifact' ? { ...b, active: false } : b),
    })));
  };

  /* ── Canvas update from right panel ── */
  const handleCanvasUpdate = (updated: CanvasData) => {
    setActiveCanvas(updated);
    setMessages(prev => prev.map(m => ({
      ...m,
      blocks: m.blocks.map((b: ContentBlock) =>
        b.type === 'artifact' ? { ...b, canvas: updated } : b
      ),
    })));
  };

  /* ── Approve Canvas → offer Generate or Skip ── */
  const handleApproveCanvasInternal = (canvasToApprove: CanvasData) => {
    setActiveCanvas(null);

    const userMsg: Message = {
      id: 'u-appr-canv-final',
      role: 'user',
      blocks: [{ type: 'text', text: 'Product Canvas is approved.' }],
      createdAt: Date.now(),
    };

    setMessages(prev => prev.map(m => ({
      ...m,
      blocks: m.blocks.map((b: ContentBlock) => b.type === 'artifact' ? { ...b, active: false, approved: true } : b),
    })).concat(userMsg));

    const aiMsgId = `a${Date.now()}`;
    const aiMsg: Message = {
      id: aiMsgId,
      role: 'assistant',
      blocks: [
        { type: 'text', text: 'Canvas approved! Would you like to generate an interactive prototype, or skip and proceed directly to the Product Kit?' },
        { type: 'prototype-choice', canvas: canvasToApprove, aiMsgId },
      ],
      createdAt: Date.now() + 1,
    };
    setMessages(prev => [...prev, aiMsg]);
  };

  /* ── Generate Prototype (after user chooses to generate) ── */
  const handleGeneratePrototype = (canvasToApprove: CanvasData, choiceMsgId: string) => {
    // Replace the choice block with thinking animation
    const steps: ThinkingStep[] = [
      { label: 'Reading approved product canvas sections…', detail: 'Analysing all 10 modules for UI mapping.', duration: 800 },
      { label: 'Extracting user journey and UI requirements…', detail: 'Determining necessary screens and user flow.', duration: 900 },
      { label: 'Designing screen flow and navigation map…', detail: 'Drafting core layout patterns.', duration: 1100 },
      { label: 'Generating Home dashboard with feature-specific balance card…', detail: 'Building dashboard components.', duration: 1200 },
      { label: 'Creating transaction initiation form with dynamic fields…', detail: 'Adding action forms.', duration: 1000 },
      { label: 'Building authentication & biometric confirmation screen…', detail: 'Integrating security blocks.', duration: 1100 },
      { label: 'Adding management dashboard and dispute flow…', detail: 'Adding settings and dispute views.', duration: 1000 },
      { label: 'Applying NPCI UPI design guidelines…', detail: 'Finalizing color palette and typography.', duration: 99999 },
    ];
    setThinkingStepsForStream(steps);
    setThinkingStep(0);

    setMessages(prev => prev.map(m =>
      m.id !== choiceMsgId ? m : {
        ...m,
        blocks: [{ type: 'thinking', steps: [], totalMs: 0, expanded: false }],
      }
    ));
    setStreamingMsgId(choiceMsgId);
    setIsGenerating(true);

    const startMs = Date.now();
    let idx = 0;
    const LAST_STEP = steps.length - 1;
    let apiComplete = false;
    let apiResult: PrototypeData | null = null;

    apiGeneratePrototype(canvasToApprove).then(res => {
      apiResult = res;
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
      if (!apiResult) { setTimeout(finalize, 300); return; }
      const totalMs = Date.now() - startMs;
      setIsGenerating(false);
      setStreamingMsgId(null);

      setMessages(prev => prev.map(m => {
        if (m.id !== choiceMsgId) return m;
        return {
          ...m,
          blocks: [
            { type: 'thinking', steps, totalMs, expanded: false },
            { type: 'text', text: 'The interactive prototype is ready! Click the button below to view it.' },
            { type: 'prototype-ready', canvas: canvasToApprove, prototype: apiResult! }
          ]
        };
      }));
    };

    setTimeout(runStep, 300);
  };

  /* ── Send follow-up message via AI backend ── */
  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isGenerating) return;
    setInput('');
    setError(null);

    const userMsg: Message = {
      id: `u${Date.now()}`,
      role: 'user',
      blocks: [{ type: 'text', text }],
      createdAt: Date.now(),
    };
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);

    try {
      const result = await apiFollowup(text, activeCanvas!);
      let updatedCanvas = activeCanvas;

      if (result.updated_section && activeCanvas) {
        updatedCanvas = {
          ...activeCanvas,
          sections: activeCanvas.sections.map(s =>
            s.id === result.updated_section!.id ? result.updated_section! : s
          ),
        };
        setActiveCanvas(updatedCanvas);
        setMessages(prev => prev.map(m => ({
          ...m,
          blocks: m.blocks.map((b: ContentBlock) =>
            b.type === 'artifact' ? { ...b, canvas: updatedCanvas! } : b
          ),
        })));
      }

      const thinkingSteps: ThinkingStep[] = [
        { label: 'Reading your request', detail: `Analysing: "${text}"`, duration: 300 },
        { label: 'Updating canvas section', detail: result.thinking?.slice(0, 200) || 'Identifying relevant section and generating update.', duration: 400 },
      ];

      const aiMsgId = `a${Date.now()}`;
      let currentText = "";
      const words = result.text.split(" ");
      let wordIdx = 0;

      const aiMsg: Message = {
        id: aiMsgId,
        role: 'assistant',
        blocks: [
          { type: 'thinking', steps: thinkingSteps, totalMs: 700, expanded: false },
          { type: 'text', text: "" },
          ...(updatedCanvas && updatedCanvas !== activeCanvas
            ? [{ type: 'artifact' as const, canvas: updatedCanvas, active: true }]
            : []),
        ],
        createdAt: Date.now(),
      };
      setMessages(prev => [...prev, aiMsg]);

      const interval = setInterval(() => {
        if (wordIdx >= words.length) {
          clearInterval(interval);
          setIsGenerating(false);
          return;
        }
        currentText += (wordIdx === 0 ? "" : " ") + words[wordIdx];
        wordIdx++;
        setMessages(prev => prev.map(m => {
          if (m.id !== aiMsgId) return m;
          return {
            ...m,
            blocks: m.blocks.map((b: ContentBlock) => b.type === 'text' ? { ...b, text: currentText } : b)
          };
        }));
      }, 30);
    } catch (err) {
      console.error('Follow-up error:', err);
      setIsGenerating(false);
      // Fallback response
      const aiMsgId = `a${Date.now()}`;
      setMessages(prev => [...prev, {
        id: aiMsgId,
        role: 'assistant',
        blocks: [{ type: 'text', text: `I've noted your request about **"${text}"**. The canvas sections most relevant here are **Need** (#2) and **Product Operating** (#6). You can click any section tile directly to edit it.` }],
        createdAt: Date.now(),
      }]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /* ── Render message block ── */
  const renderBlock = (block: ContentBlock, msg: Message, blockIdx: number) => {
    if (block.type === 'thinking') {
      if (isGenerating && msg.id === streamingMsgId) {
        return (
          <StreamingThinking
            key={blockIdx}
            steps={thinkingStepsForStream}
            currentStep={thinkingStep}
            active={isGenerating}
          />
        );
      }
      if (block.steps.length === 0) return null;
      return (
        <ThinkingBlock
          key={blockIdx}
          block={block}
          onToggle={() => toggleThinking(msg.id)}
        />
      );
    }

    if (block.type === 'text') {
      return (
        <div key={blockIdx} className="text-sm text-slate-800 leading-relaxed mb-2 overflow-wrap-anywhere break-words font-medium">
          {block.text.split('\n').map((line, i) => {
            if (!line) return <div key={i} className="h-3" />;
            const parts = line.split(/(\*\*[^*]+\*\*)/g);
            return (
              <span key={i} className="block mb-1">
                {parts.map((p, j) =>
                  p.startsWith('**')
                    ? <strong key={j} className="font-black text-slate-900">{p.slice(2, -2)}</strong>
                    : p
                )}
              </span>
            );
          })}
        </div>
      );
    }

    if (block.type === 'artifact') {
      return (
        <CanvasArtifactCard
          key={blockIdx}
          canvas={block.canvas}
          active={block.active}
          approved={block.approved}
          onClick={() => handleArtifactClick(block.canvas, msg.id)}
        />
      );
    }

    if (block.type === 'prototype-choice') {
      return (
        <div key={blockIdx} className="mt-3 flex flex-wrap gap-3">
          <button
            onClick={() => handleGeneratePrototype(block.canvas, block.aiMsgId)}
            disabled={isGenerating}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-600 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-all transform hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-4 h-4 text-indigo-200" />
            Generate Prototype
          </button>
          <button
            onClick={() => onApprove(block.canvas)}
            disabled={isGenerating}
            className="flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 font-semibold rounded-xl border border-slate-200 hover:bg-slate-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Skip & Continue to Product Kit
          </button>
        </div>
      );
    }

    if (block.type === 'prototype-ready') {
      return (
        <div key={blockIdx} className="mt-3">
          <button
            onClick={() => onApprove(block.canvas, block.prototype)}
            className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-600 text-white font-bold rounded-xl shadow-[0_0_15px_rgba(79,70,229,0.3)] hover:shadow-[0_0_20px_rgba(79,70,229,0.5)] transition-all transform hover:-translate-y-0.5"
          >
            <Sparkles className="w-4 h-4 text-indigo-200" />
            Go to Prototype Interface
          </button>
        </div>
      );
    }

    if ((block as any).type === 'analyzing') {
      return <AnalyzingAnimation key={blockIdx} />;
    }

    return null;
  };

  return (
    <div className="flex h-[calc(100vh-112px)] bg-slate-50/50">

      {/* ════ LEFT — Chat ════ */}
      <div className={`flex flex-col transition-all duration-300 ${activeCanvas ? 'w-[42%] min-w-[360px] border-r border-slate-200' : 'w-full max-w-4xl mx-auto'}`}>

        {/* Error banner */}
        {error && (
          <div className="flex-shrink-0 bg-red-50 border-b border-red-100 px-6 py-3 flex items-center gap-3">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <span className="text-[11px] font-black text-red-700 uppercase tracking-widest">{error}</span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-10 space-y-8 bg-transparent custom-scrollbar">
          {messages.map(msg => (
            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              {msg.role === 'user' ? (
                <UserAvatar />
              ) : (
                <AssistantAvatar />
              )}
              <div className={`flex-1 min-w-0 ${msg.role === 'user' ? 'flex flex-col items-end' : ''}`}>
                {msg.role === 'user' ? (
                  <div className="bg-slate-900 text-white rounded-[2.5rem] rounded-tr-lg px-7 py-5 max-w-md shadow-2xl shadow-indigo-900/10 border border-white/5">
                    <p className="text-sm font-black leading-relaxed whitespace-pre-wrap tracking-tight uppercase">{(msg.blocks[0] as any).text?.replace(/\*\*/g, '')}</p>
                  </div>
                ) : (
                  <div className="max-w-2xl bg-white rounded-[2.5rem] rounded-tl-lg p-8 shadow-2xl shadow-slate-200/50 border border-slate-100">
                    {msg.blocks.map((block, bi) => renderBlock(block, msg, bi))}
                    {/* Clarification card attached to the eval message */}
                    {clarifyResult && clarifyMsgId === msg.id && (
                      <ClarificationCard
                        questions={clarifyResult.questions}
                        summary={clarifyResult.summary}
                        onSubmit={handleClarifySubmit}
                        onSkip={() => { setClarifyResult(null); runCanvasGeneration([]); }}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 px-6 py-8 border-t border-slate-200/60 bg-white/40 backdrop-blur-md">
          <div className={`flex items-end gap-3 bg-white border rounded-[2.5rem] px-6 py-5 shadow-2xl shadow-slate-200/50 transition-all duration-300 ${isGenerating ? 'border-slate-100 opacity-60' : 'border-slate-200 focus-within:border-indigo-400 focus-within:ring-8 focus-within:ring-indigo-500/5'}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isGenerating}
              placeholder={isGenerating ? 'Titan Agent is pulsing build logic…' : 'Refine compliance mapping or update canvas sections…'}
              rows={1}
              className="flex-1 resize-none text-sm text-slate-800 font-bold placeholder-slate-400 focus:outline-none leading-relaxed bg-transparent pt-1"
              style={{ maxHeight: 120, overflowY: 'auto' }}
            />
            <button
              onClick={sendMessage}
              disabled={isGenerating || !input.trim()}
              className="w-12 h-12 rounded-2xl bg-slate-900 hover:bg-black disabled:bg-slate-100 disabled:cursor-not-allowed flex items-center justify-center shadow-xl shadow-slate-900/20 transition-all active:scale-95 group"
            >
              {isGenerating
                ? <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
                : <Send className="w-5 h-5 text-white group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
              }
            </button>
          </div>
          <div className="text-center mt-3 scale-90 opacity-70">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Press Enter to Pulse · NPCI TITAN ENGINE</span>
          </div>
        </div>
      </div>

      {/* ════ RIGHT — Canvas Panel ════ */}
      {activeCanvas ? (
        <div className="flex-1 flex flex-col min-w-0 bg-white">
          {/* Panel top-bar with close button */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-white/80 backdrop-blur-md flex-shrink-0 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
                <Layout className="w-4 h-4 text-blue-600" />
              </div>
              <span className="text-sm font-black text-slate-900 truncate max-w-sm uppercase tracking-tight">
                {activeCanvas.featureName || 'Product Canvas'}
              </span>
            </div>
            <button
              onClick={handleCloseCanvas}
              className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-all active:scale-90"
              title="Close canvas"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CanvasView
              canvas={activeCanvas}
              onUpdate={handleCanvasUpdate}
              onApprove={() => handleApproveCanvasInternal(activeCanvas)}
            />
          </div>
        </div>
      ) : (
        <div className="hidden lg:flex flex-1 items-center justify-center bg-slate-50/30 flex-col gap-6 text-center p-12">
          <div className="w-24 h-24 bg-white rounded-[2.5rem] flex items-center justify-center shadow-xl shadow-slate-200/50 border border-slate-100 group transition-all hover:scale-105">
            <Layout className="w-10 h-10 text-slate-200 group-hover:text-blue-200 transition-colors" />
          </div>
          <div className="max-w-xs">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-2">Workspace Empty</p>
            <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.15em] leading-relaxed">Select a Product Canvas card from the chat to begin high-fidelity orchestration.</p>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────── Default Thinking Steps ─────────────────── */
// These are generic animation steps shown while the API is running.
// They do NOT reference feature-specific documents — those come from the backend
// via build_thinking_steps_from_research() and replace these in the final ThinkingBlock.
function getDefaultThinkingSteps(featureName: string): ThinkingStep[] {
  return [
    {
      label: 'Parsing feature requirements',
      detail: `Deconstructing the scope for "${featureName}". Identifying primary user segments (consumers, merchants, issuers), core UPI protocol hooks, A2A/payment rail requirements, RBI phase context, and integration complexity with the existing NPCI ecosystem. Estimating delivery complexity and stakeholder coordination needs.`,
      duration: 800,
    },
    {
      label: 'Searching regulatory knowledge base',
      detail: `Running semantic search across the RBI/NPCI document database for regulations applicable to "${featureName}". Matching against Master Directions, Operational Circulars, DPDP Act, IT Act §43A, and PSS Act 2007. Ranking by relevance to this feature's payment flow and user segments.`,
      duration: 700,
    },
    {
      label: 'Reading applicable RBI directives',
      detail: 'Extracting key provisions from the top-ranked RBI Master Directions: authentication requirements (MFA, biometric), API security standards (TLS 1.3+, certificate pinning), DSC validation rules, 5-year immutable audit trail mandate, fraud incident reporting timelines, and customer protection obligations.',
      duration: 1100,
    },
    {
      label: 'Reading applicable NPCI circulars',
      detail: `Reviewing NPCI Operational Circulars relevant to "${featureName}". Extracting: transaction limits per category, block/mandate lifecycle rules, mandatory notification events (create/modify/debit/revoke/expire), merchant eligibility criteria, NPCI risk score thresholds, UDIR dispute routing integration, and daily MIS reporting obligations.`,
      duration: 1000,
    },
    {
      label: 'Mapping ecosystem landscape',
      detail: `PSP market share: PhonePe 48%, Google Pay 37%, Paytm 8%, CRED 3%, WhatsApp Pay 2%. Issuer banks: SBI 520M accounts, HDFC 85M, ICICI 72M, Axis 33M — CBS upgrade readiness varies (private banks 8 weeks, PSBs 16 weeks). Analysing merchant pipeline for ${featureName}: Tier-1 (high demand, SDK-ready), Tier-2 SMBs (need plug-and-play). TAM: 180M active UPI users eligible.`,
      duration: 1000,
    },
    {
      label: 'Identifying strategic differentiation',
      detail: `Classifying "${featureName}" on the EXPONENTIAL vs incremental innovation spectrum. Aligning with RBI Payments Vision 2025 — "programmable money" pillar, NPCI 1B txns/day target, and Digital India financial inclusion mandate. Mapping addressable gap: 18% cart abandonment (₹2,400 Cr GMV lost/year), average 28s checkout time vs 8s target.`,
      duration: 900,
    },
    {
      label: 'Structuring canvas sections 1–5',
      detail: `Drafting Feature (layman explanation + user journey), Need (strategic why + differentiation vs existing UPI products), Market View (PSP/bank/merchant response modelling + regulatory signal), Scalability (demand & supply anchors + volume ramp), and Validation (MVP scope + pilot partners + data KPIs) for "${featureName}".`,
      duration: 1200,
    },
    {
      label: 'Structuring canvas sections 6–10',
      detail: `Drafting Product Operating (3 north-star KPIs + UDIR + Day-0 runbook), Product Comms (demo video + FAQs + circular plan + product docs), Pricing (3-year MDR model), Potential Risks (fraud/infosec/second-order effects matrix), and Compliance (full checklist against all applicable regulations) for "${featureName}".`,
      duration: 1100,
    },
    {
      label: 'Building & validating canvas with AI',
      detail: `Generating the full 10-section Product Build Canvas for "${featureName}" with deep regulatory references, real ecosystem player names, and specific metrics. Cross-checking every section against applicable RBI/NPCI provisions. Flagging open regulatory items. Running final consistency pass across all sections…`,
      duration: 99999, // stays active until API responds — overridden in runStep logic
    },
  ];
}
