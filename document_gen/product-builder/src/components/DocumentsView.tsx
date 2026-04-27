import { useMemo, useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Download,
  Eye,
  FileText,
  HelpCircle,
  Loader2,
  RefreshCw,
  ScrollText,
  Shield,
  Sparkles,
  TestTube2,
  ThumbsUp,
  Video,
  X,
} from 'lucide-react';
import type { Document } from '../types';

interface DocumentsViewProps {
  documents: Document[];
  featureName: string;
  onUpdate: (docs: Document[]) => void;
  onApprove: () => void;
  onRetry?: (docId: string) => void;
}

const DOC_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'product-doc': FileText,
  'circular': ScrollText,
  'faqs': HelpCircle,
  'video-script': Video,
  'rbi-summary': Shield,
  'test-cases': TestTube2,
  'product-deck': FileText,
  'faq-bundle': HelpCircle,
  'uat-strategy': TestTube2,
  'circular-draft': ScrollText,
  'product-note': FileText,
};

const DOC_COLORS: Record<string, string> = {
  'product-doc': 'bg-indigo-100 text-indigo-700',
  'circular': 'bg-indigo-100 text-indigo-700',
  'faqs': 'bg-amber-100 text-amber-700',
  'video-script': 'bg-rose-100 text-rose-700',
  'rbi-summary': 'bg-emerald-100 text-emerald-700',
  'test-cases': 'bg-indigo-100 text-indigo-700',
  'product-deck': 'bg-rose-100 text-rose-700',
  'faq-bundle': 'bg-amber-100 text-amber-700',
  'uat-strategy': 'bg-indigo-100 text-indigo-700',
  'circular-draft': 'bg-indigo-100 text-indigo-700',
  'product-note': 'bg-indigo-100 text-indigo-700',
};

async function downloadDocx(doc: Document) {
  const safeTitle = doc.title.replace(/\s+/g, '_').replace(/[/\\]/g, '-');

  // ── 1. Pipeline-generated DOCX via direct GET endpoint ─────────────────────
  // This endpoint reads the file directly from outputs/sessions/{bundle_id}/
  // or outputs/{job_id}/ — no Pydantic alias issues.
  if (doc._docgen_job_id) {
    const params = new URLSearchParams({ title: doc.title });
    if (doc._bundle_id) params.set('bundle_id', doc._bundle_id);
    if (doc._doc_type)  params.set('doc_type',  doc._doc_type);

    const res = await fetch(`/api/documents/docx/${doc._docgen_job_id}?${params.toString()}`);
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeTitle}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return;
    }
    console.warn('[downloadDocx] Direct GET failed (status', res.status, ') — falling back to markdown DOCX');
  }

  // ── 2. Fallback: generate DOCX from markdown content ──────────────────────
  const body: Record<string, unknown> = { title: doc.title, content: doc.content };
  const res = await fetch('/api/documents/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error('DOCX download failed');

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function InlineText({ text }: { text: string }) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-black text-slate-900">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={index} className="italic text-slate-800">{part.slice(1, -1)}</em>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split('\n');
  const rendered: React.ReactNode[] = [];
  let currentTable: string[][] = [];

  const flushTable = (key: number) => {
    if (currentTable.length === 0) return null;
    const table = (
      <div key={`table-${key}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm my-6">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <tbody className="divide-y divide-slate-100">
              {currentTable.map((row, rowIndex) => (
                <tr key={rowIndex} className={rowIndex === 0 ? 'bg-slate-50/80' : 'hover:bg-indigo-50/10 transition-colors'}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      className={`px-5 py-3 text-xs border-r border-slate-100 last:border-r-0 ${rowIndex === 0 ? 'font-black text-slate-900' : 'font-medium text-slate-600'}`}
                    >
                      <InlineText text={cell.trim()} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
    currentTable = [];
    return table;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed.startsWith('|')) {
      const cells = line.split('|').filter((cell, cellIndex, allCells) => {
        if (cellIndex === 0 && !cell.trim()) return false;
        if (cellIndex === allCells.length - 1 && !cell.trim()) return false;
        return true;
      });
      if (cells.every(cell => cell.trim().match(/^[-:| ]+$/))) continue;
      currentTable.push(cells);
      continue;
    }

    const table = flushTable(index);
    if (table) rendered.push(table);

    if (trimmed.startsWith('# ')) {
      rendered.push(<h1 key={index} className="text-4xl font-black text-slate-950 mt-10 mb-6 tracking-tight leading-tight">{line.slice(2)}</h1>);
    } else if (trimmed.startsWith('## ')) {
      rendered.push(<h2 key={index} className="text-2xl font-black text-slate-950 mt-8 mb-4 pb-3 border-b border-slate-200 tracking-tight">{line.slice(3)}</h2>);
    } else if (trimmed.startsWith('### ')) {
      rendered.push(<h3 key={index} className="text-lg font-black text-slate-900 mt-6 mb-3 tracking-tight">{line.slice(4)}</h3>);
    } else if (trimmed.startsWith('• ') || trimmed.startsWith('- ')) {
      rendered.push(
        <div key={index} className="flex gap-3 items-start">
          <span className="text-indigo-500 font-black mt-0.5">•</span>
          <span className="text-slate-700"><InlineText text={trimmed.slice(2)} /></span>
        </div>
      );
    } else if (line === '---') {
      rendered.push(<div key={index} className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent my-10" />);
    } else if (line.startsWith('```')) {
      continue;
    } else if (line === '') {
      rendered.push(<div key={`empty-${index}`} className="h-2" />);
    } else {
      rendered.push(
        <p key={index} className="text-slate-700 font-medium leading-8">
          <InlineText text={line} />
        </p>
      );
    }
  }

  const finalTable = flushTable(lines.length);
  if (finalTable) rendered.push(finalTable);

  return <div className="space-y-4">{rendered}</div>;
}

export default function DocumentsView({ documents, featureName, onUpdate, onApprove, onRetry }: DocumentsViewProps) {
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  // Holds the freshly-fetched document from the backend, used directly in the
  // preview modal so we never depend on the parent re-rendering before the modal
  // opens (avoids the stale-documents-prop race condition).
  const [previewDocOverride, setPreviewDocOverride] = useState<Document | null>(null);
  const [previewLoadingDocId, setPreviewLoadingDocId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Gap 10: elapsed time counter for edit overlay
  const [editElapsedSec, setEditElapsedSec] = useState(0);
  const editStartRef = useRef<number | null>(null);
  const documentsRef = useRef<Document[]>(documents);

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  // previewDocOverride wins if present (freshly fetched from backend).
  // Falls back to documents prop lookup for applyEdit / other in-place updates.
  const previewDoc = previewDocOverride
    ?? (previewDocId ? (documents.find(doc => doc.id === previewDocId) ?? null) : null);

  const updateDocument = (docId: string, mutate: (doc: Document) => Document) => {
    onUpdate(documentsRef.current.map(doc => (doc.id === docId ? mutate(doc) : doc)));
  };

  const toggleApprove = (docId: string) => {
    updateDocument(docId, doc => ({ ...doc, approved: !doc.approved }));
  };

  const refreshDocumentFromBackend = async (doc: Document): Promise<Document> => {
    if (!doc._docgen_job_id || !doc._doc_type) return doc;

    const params = new URLSearchParams({
      doc_type: doc._doc_type,
      feature_name: featureName,
      force_refresh: 'true',
    });
    const res = await fetch(`/api/documents/content/${doc._docgen_job_id}?${params.toString()}`);
    if (!res.ok) throw new Error('Document refresh failed');

    const data = await res.json();
    const refreshed = data.document as Document;
    const merged = {
      ...doc,
      ...refreshed,
      approved: doc.approved,
      lastEdited: refreshed.lastEdited ?? doc.lastEdited,
    };

    onUpdate(documentsRef.current.map(existing => (
      existing.id === doc.id ? merged : existing
    )));
    return merged;
  };

  const openPreview = async (docId: string) => {
    const current = documentsRef.current.find(doc => doc.id === docId);
    if (!current) return;

    setEditInstruction('');
    setEditError(null);
    setPreviewDocOverride(null);
    setPreviewLoadingDocId(docId);

    // Open immediately with the current (possibly stale) content so the
    // modal is visible while the refresh is in flight.
    setPreviewDocId(docId);

    try {
      const latest = await refreshDocumentFromBackend(current);
      // Override wins: preview now shows the freshly-fetched content
      // without waiting for the parent's documents prop to update.
      setPreviewDocOverride(latest);
    } catch (error) {
      console.error('[openPreview] refresh failed — showing cached content', error);
      // Keep showing whatever is in documents (already set via setPreviewDocId)
    } finally {
      setPreviewLoadingDocId(null);
    }
  };

  const closePreview = () => {
    if (isSubmittingEdit) return;
    setPreviewDocId(null);
    setPreviewDocOverride(null);
    setEditInstruction('');
    setEditError(null);
  };

  // Gap 10: tick the elapsed counter while edit is running
  useEffect(() => {
    if (!isSubmittingEdit) {
      editStartRef.current = null;
      setEditElapsedSec(0);
      return;
    }
    editStartRef.current = Date.now();
    const id = window.setInterval(() => {
      setEditElapsedSec(Math.floor((Date.now() - (editStartRef.current ?? Date.now())) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isSubmittingEdit]);

  const applyEdit = async () => {
    if (!previewDoc || !previewDoc._docgen_job_id || !previewDoc._doc_type || !editInstruction.trim() || isSubmittingEdit) return;

    setIsSubmittingEdit(true);
    setEditError(null);
    updateDocument(previewDoc.id, doc => ({
      ...doc,
      _status: 'editing',
      _current_step: 'Applying edit instruction',
    }));

    try {
      const res = await fetch('/api/documents/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_id: previewDoc._docgen_job_id,
          edit_instruction: editInstruction,
          feature_name: featureName,
          doc_type: previewDoc._doc_type,
        }),
      });
      if (!res.ok) throw new Error('Edit request failed');

      const data = await res.json();
      const updatedDoc = data.document as Document;
      const merged = {
        ...(previewDocOverride ?? previewDoc),
        ...updatedDoc,
        approved: false,
        lastEdited: new Date().toLocaleString(),
        _status: 'completed' as const,
        _progress: 100,
      };
      // Keep the override up-to-date so the preview immediately reflects the edit.
      setPreviewDocOverride(merged);
      onUpdate(documentsRef.current.map(doc => (doc.id === previewDoc.id ? merged : doc)));
      setEditInstruction('');
    } catch (error) {
      console.error(error);
      setEditError('The edit could not be applied right now.');
      updateDocument(previewDoc.id, doc => ({
        ...doc,
        _status: 'completed',
        _current_step: 'Ready',
      }));
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  const completedDocs = documents.filter(doc => doc._status === 'completed');
  const approvedCount = documents.filter(doc => doc.approved).length;
  const generationComplete = documents.length > 0 && documents.every(doc => doc._status === 'completed' || doc._status === 'fallback');
  const allApproved = generationComplete && documents.length > 0 && approvedCount === documents.length;

  return (
    <div className="w-full h-full overflow-y-auto px-6 py-6">
      <div className="mb-8 flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">Universal Product Kit</div>
          <h2 className="text-3xl font-black tracking-tight text-slate-950">{featureName}</h2>
          <p className="mt-2 text-sm font-medium text-slate-500">
            {completedDocs.length} of {documents.length} documents ready for preview and download
          </p>
        </div>

        <div className="flex flex-col items-start gap-3 xl:items-end">
          <div className="w-full xl:w-72">
            <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
              <span>Verification Progress</span>
              <span>{approvedCount}/{documents.length}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full border border-slate-200 bg-slate-100 p-0.5">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-indigo-500 transition-all duration-700"
                style={{ width: `${documents.length ? (approvedCount / documents.length) * 100 : 0}%` }}
              />
            </div>
          </div>
          <button
            onClick={onApprove}
            disabled={!allApproved}
            className={`inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-black uppercase tracking-[0.14em] transition-all ${allApproved ? 'bg-slate-950 text-white hover:bg-black shadow-xl shadow-slate-900/15' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
          >
            <ChevronRight className="w-4 h-4" />
            Proceed to Technical Plan
          </button>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-4">
        {documents.map(doc => {
          const Icon = DOC_ICONS[doc.id] || FileText;
          const iconColor = DOC_COLORS[doc.id] || 'bg-slate-100 text-slate-600';
          const status = doc._status ?? 'completed';
          const canPreview = status === 'completed' || status === 'fallback';
          const canDownload = status === 'completed';
          const isEditing = status === 'editing';
          const progress = doc._progress ?? (status === 'completed' ? 100 : 0);

          return (
            <div key={doc.id} className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 bg-gradient-to-br from-white via-slate-50 to-indigo-50/30 p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconColor}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-widest ${status === 'failed' ? 'border-rose-200 bg-rose-50 text-rose-600' : 'border-slate-200 bg-white text-slate-500'}`}>
                    {status === 'completed' && 'Ready'}
                    {status === 'generating' && 'Generating'}
                    {status === 'pending' && 'Queued'}
                    {status === 'editing' && 'Editing'}
                    {status === 'failed' && 'Failed'}
                    {status === 'fallback' && 'Local Preview'}
                  </div>
                </div>

                <h3 className="text-base font-black leading-snug tracking-tight text-slate-950">{doc.title}</h3>
                {/* Gap 16: show last-edited timestamp when present */}
                {doc.lastEdited && (
                  <p className="mt-1 text-[10px] font-black uppercase tracking-widest text-indigo-400">
                    Edited {doc.lastEdited}
                  </p>
                )}
                <p className="mt-2 min-h-[40px] text-sm font-medium leading-6 text-slate-500">
                  {isEditing
                    ? 'Refreshing this document with your latest instruction.'
                    : doc._current_step || (status === 'completed' ? 'Document generated and ready for review.' : 'Document pipeline is still running.')}
                </p>

                <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Progress</span>
                    <span>{progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${status === 'failed' ? 'bg-rose-500' : 'bg-gradient-to-r from-indigo-500 to-emerald-500'}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {doc._rag_warning && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <p className="text-[10px] font-bold leading-snug text-amber-700">
                      Generated without NPCI corpus — RAG service was unreachable. Start the RAG system and regenerate for accurate content.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-3 p-5">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => openPreview(doc.id)}
                    disabled={!canPreview || previewLoadingDocId === doc.id}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${canPreview && previewLoadingDocId !== doc.id ? 'bg-slate-950 text-white hover:bg-black' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                  >
                    {(isEditing || previewLoadingDocId === doc.id) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                    {previewLoadingDocId === doc.id ? 'Loading…' : 'Preview'}
                  </button>

                  <button
                    onClick={async (e) => {
                      const btn = e.currentTarget;
                      btn.disabled = true;
                      try {
                        const latest = await refreshDocumentFromBackend(doc);
                        await downloadDocx(latest);
                      } catch (error) {
                        console.error(error);
                      } finally {
                        btn.disabled = false;
                      }
                    }}
                    disabled={!canDownload}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${canDownload ? 'border border-indigo-200 text-indigo-700 hover:bg-indigo-50' : 'border border-slate-200 text-slate-300 cursor-not-allowed'}`}
                  >
                    <Download className="h-3.5 w-3.5" />
                    .docx
                  </button>
                </div>

                {/* Gap 6: Retry button for failed documents */}
                {status === 'failed' && onRetry && (
                  <button
                    onClick={() => onRetry(doc.id)}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all bg-rose-600 text-white hover:bg-rose-700"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                )}

                <button
                  onClick={() => toggleApprove(doc.id)}
                  disabled={!canDownload}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-black uppercase tracking-widest transition-all ${doc.approved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : canDownload ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}
                >
                  <ThumbsUp className={`h-3.5 w-3.5 ${doc.approved ? 'fill-emerald-700' : ''}`} />
                  {doc.approved ? 'Verified' : 'Verify'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8 rounded-[2rem] border border-slate-200 bg-slate-950 p-8 shadow-2xl">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-400/30 bg-indigo-500/15">
              <Shield className="h-6 w-6 text-indigo-300" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-lg font-black tracking-tight text-white">
                Product Kit Verification: {allApproved ? 'Verified' : 'Pending'}
                {allApproved && <CheckCircle className="h-5 w-5 text-emerald-400" />}
              </div>
              <p className="mt-1 text-sm font-medium text-slate-400">
                {allApproved
                  ? 'Every generated document is reviewed and ready for the next stage.'
                  : 'Downloads unlock per document as generation finishes. Verify each completed file before moving on.'}
              </p>
            </div>
          </div>

          <button
            onClick={onApprove}
            disabled={!allApproved}
            className={`inline-flex items-center gap-2 rounded-2xl px-8 py-4 text-sm font-black uppercase tracking-[0.14em] transition-all ${allApproved ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-900/30' : 'bg-slate-800 text-slate-500 cursor-not-allowed'}`}
          >
            <Sparkles className="h-4 w-4" />
            Finalize Product Kit
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {previewDoc && (
        <div className="fixed inset-0 z-50 flex bg-slate-950/70 backdrop-blur-sm">
          <div className="flex h-full w-full flex-col bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-8 py-5">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-500">Document Preview</div>
                <h3 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{previewDoc.title}</h3>
              </div>
              <button
                onClick={closePreview}
                disabled={isSubmittingEdit}
                className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.6fr)_420px]">
              <div className="min-h-0 overflow-y-auto bg-slate-50 px-8 py-8">
                {previewDoc._status === 'editing' || isSubmittingEdit ? (
                  <div className="flex h-full min-h-[400px] flex-col items-center justify-center text-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-indigo-100">
                      <Loader2 className="h-9 w-9 animate-spin text-indigo-600" />
                    </div>
                    <h4 className="mt-6 text-xl font-black tracking-tight text-slate-950">Regenerating document</h4>
                    <p className="mt-2 max-w-md text-sm font-medium leading-6 text-slate-500">
                      Applying your instruction and rebuilding the latest preview. Download and preview actions will refresh once the updated document is ready.
                    </p>
                    {/* Gap 10: elapsed time counter */}
                    <div className="mt-4 rounded-full bg-indigo-50 px-5 py-2 text-sm font-black text-indigo-600">
                      {Math.floor(editElapsedSec / 60).toString().padStart(2, '0')}:{(editElapsedSec % 60).toString().padStart(2, '0')} elapsed
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto max-w-4xl rounded-[2rem] border border-slate-200 bg-white px-8 py-8 shadow-sm">
                    <MarkdownRenderer content={previewDoc.content} />
                  </div>
                )}
              </div>

              <div className="flex min-h-0 flex-col border-l border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-6 py-5">
                  <div className="text-sm font-black uppercase tracking-widest text-slate-400">Actions</div>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-500">
                    Enter one instruction to refine the full document. The updated preview replaces this one as soon as regeneration finishes.
                  </p>
                </div>

                <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status</div>
                    <div className="mt-2 text-sm font-black text-slate-900">
                      {previewDoc._status === 'fallback' ? 'Local fallback preview only' : previewDoc._status === 'editing' ? 'Applying edit' : 'Ready for review'}
                    </div>
                    <div className="mt-1 text-sm font-medium text-slate-500">
                      {previewDoc._status === 'fallback'
                        ? 'This preview was generated locally, so AI-powered edit and native DOCX download are unavailable.'
                        : 'Preview, edit, and download are wired to the claudedocuer job for this document.'}
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-[10px] font-black uppercase tracking-widest text-slate-400">
                      Editing Instruction
                    </label>
                    <textarea
                      value={editInstruction}
                      onChange={event => setEditInstruction(event.target.value)}
                      placeholder="Example: expand the architecture section, add clearer API assumptions, and tighten the regulator-facing language."
                      disabled={!previewDoc._docgen_job_id || isSubmittingEdit}
                      className="min-h-[180px] w-full rounded-2xl border border-slate-200 px-4 py-4 text-sm font-medium leading-6 text-slate-800 outline-none transition focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-100 disabled:text-slate-400"
                    />
                    {editError && <p className="mt-2 text-sm font-medium text-rose-600">{editError}</p>}
                  </div>
                </div>

                <div className="space-y-3 border-t border-slate-100 px-6 py-5">
                  <button
                    onClick={applyEdit}
                    disabled={!previewDoc._docgen_job_id || !editInstruction.trim() || isSubmittingEdit}
                    className={`inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black uppercase tracking-[0.14em] transition-all ${previewDoc._docgen_job_id && editInstruction.trim() && !isSubmittingEdit ? 'bg-slate-950 text-white hover:bg-black' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}
                  >
                    {isSubmittingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Apply Edit
                  </button>

                  <div className="grid grid-cols-1 gap-3">
                    <button
                      onClick={async () => {
                        try {
                          const latest = await refreshDocumentFromBackend(previewDoc);
                          await downloadDocx(latest);
                        } catch (error) {
                          console.error(error);
                        }
                      }}
                      disabled={previewDoc._status !== 'completed'}
                      className={`inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all ${previewDoc._status === 'completed' ? 'border border-indigo-200 text-indigo-700 hover:bg-indigo-50' : 'border border-slate-200 text-slate-300 cursor-not-allowed'}`}
                    >
                      <Download className="h-3.5 w-3.5" />
                      .docx
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
