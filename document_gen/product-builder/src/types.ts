export type AppMode = 'nfb' | 'cm';

export type Stage = 'input' | 'clarify' | 'canvas' | 'documents' | 'product-kit' | 'brd' | 'technical-plan' | 'a2a-sync' | 'execution' | 'verify' | 'certification' | 'deploy';

export type CMStage = 'prompt' | 'plan' | 'execution' | 'test' | 'deploy';

export type CanvasStatus = 'on-track' | 'open' | 'ongoing' | 'approved';

export interface CanvasSection {
  id: number;
  title: string;
  content: string;
  status: CanvasStatus;
  approved: boolean;
}

export interface CanvasData {
  featureName: string;
  buildTitle: string;
  overallStatus: 'information' | 'on-track' | 'open' | 'ongoing';
  sections: CanvasSection[];
  rbiGuidelines: string;
  ecosystemChallenges: string;
  approved: boolean;
}

export interface Document {
  id: string;
  title: string;
  icon: string;
  content: string;
  approved: boolean;
  lastEdited?: string;
  _status?: 'pending' | 'generating' | 'completed' | 'failed' | 'fallback' | 'editing';
  _progress?: number;
  _doc_type?: string;
  _current_step?: string;
  // claudedocuer integration: job reference for native DOCX download
  _docgen_job_id?: string;
  _docgen_base_url?: string;
  _bundle_id?: string;
  _rag_warning?: string | null;
}

export interface PrototypeData {
  status: 'pending' | 'building' | 'ready';
  url?: string;
  figma_url?: string;
  screens: PrototypeScreen[];
  feedback: string;
  approved: boolean;
  userJourney?: UserJourney;
}

export interface PrototypeScreen {
  id: string;
  title: string;
  description: string;
  elements: string[];
  journeyStep?: number;
  journeyPhase?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: Record<string, any>;
}

export interface JourneyStep {
  step: number;
  phase: string;
  screen_id: string;
  actor: string;
  action: string;
  what_happens_technically: string;
  user_feeling: string;
  pain_point_solved: string;
}

export interface UserJourney {
  persona: { name: string; context: string };
  upi_flow_overview: string;
  journey_steps: JourneyStep[];
}

export interface ExecutionItem {
  id: string;
  file: string;
  change: string;
  type: 'add' | 'modify' | 'delete';
  status: 'pending' | 'in-progress' | 'done';
}

export interface AppState {
  stage: Stage;
  prompt: string;
  featureName: string;
  canvas: CanvasData | null;
  prototype: PrototypeData | null;
  documents: Document[];
  executionItems: ExecutionItem[];
  thinkingStep: number;
}

/* ── Phase 2 / Change Management types ── */

export interface CMImpactAnalysis {
  business_value?: string;
  compliance_check?: string;
  risk_assessment?: string;
}

export interface CMPlan {
  version?: string;
  seq_version?: number;
  description?: string;
  brd?: string;
  tsd?: string;
  plan?: string[];
  impact_analysis?: CMImpactAnalysis | string[];
  verification_payload?: string;
}

export interface AgentCard {
  name: string;
  status: 'queued' | 'running' | 'done' | 'error' | 'skipped' | 'updating' | 'ready' | 'completed' | 'action' | 'action_ok' | 'action_fail';
  msg: string;
  icon?: string;
}

export interface TestResult {
  id: string;
  scenario: string;
  status: 'pass' | 'fail' | 'pending';
  detail: string;
  timestamp: string;
}

export interface FlowStep {
  id: string;
  label: string;
  xml: string;
}

export interface DeployVersion {
  id: string;
  version?: string;
  seq_version?: number;
  description?: string;
  label?: string;
  timestamp?: string;
}
