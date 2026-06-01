import type { ObjectReference, SciForgeReference } from './references';
import type { AgentTokenUsage } from './stream';

export type MessageRole = 'user' | 'scenario' | 'system';
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export type RuntimeClaimType = 'fact' | 'inference' | 'hypothesis';
export type RuntimeEvidenceLevel =
  | 'meta'
  | 'rct'
  | 'cohort'
  | 'case'
  | 'experimental'
  | 'review'
  | 'database'
  | 'preprint'
  | 'prediction';

export type UserGoalType = 'answer' | 'report' | 'analysis' | 'visualization' | 'file' | 'repair' | 'continuation' | 'workflow';
export type TurnAcceptanceSeverity = 'pass' | 'warning' | 'repairable' | 'failed';

export interface UserGoalSnapshot {
  turnId: string;
  rawPrompt: string;
  goalType: UserGoalType;
  requiredFormats: string[];
  requiredArtifacts: string[];
  requiredReferences: string[];
  freshness?: {
    kind: 'today' | 'latest' | 'current-session' | 'prior-run';
    date?: string;
  };
  uiExpectations: string[];
  acceptanceCriteria: string[];
}

export interface TurnAcceptanceFailure {
  code: string;
  detail: string;
  repairAction?: string;
}

export interface SemanticTurnAcceptance {
  pass: boolean;
  confidence: number;
  unmetCriteria: string[];
  missingArtifacts: string[];
  referencedEvidence: string[];
  repairPrompt?: string;
  backendRunRef?: string;
}

export interface TurnAcceptance {
  pass: boolean;
  severity: TurnAcceptanceSeverity;
  checkedAt: string;
  failures: TurnAcceptanceFailure[];
  objectReferences: ObjectReference[];
  repairPrompt?: string;
  repairAttempt?: number;
  semantic?: SemanticTurnAcceptance;
  repairHistory?: Array<{
    attempt: number;
    action: string;
    status: 'started' | 'completed' | 'failed-with-reason' | 'skipped-budget-exhausted';
    startedAt: string;
    completedAt?: string;
    sourceRunId?: string;
    repairRunId?: string;
    failureCodes: string[];
    reason?: string;
  }>;
}

export type GuidanceQueueStatus = 'queued' | 'merged' | 'rejected' | 'deferred';

export interface GuidanceQueueRecord {
  id: string;
  prompt: string;
  status: GuidanceQueueStatus;
  receivedAt: string;
  references?: SciForgeReference[];
  updatedAt?: string;
  activeRunId?: string;
  handlingRunId?: string;
  reason?: string;
}

export type SciForgeMessageProvenance = {
  kind?: string;
  source?: string | { channel?: string; [key: string]: unknown };
  runtimeRequestEligible?: boolean;
  liveAcceptanceEligible?: boolean;
  [key: string]: unknown;
};

export interface SciForgeMessage {
  id: string;
  role: MessageRole;
  content: string;
  confidence?: number;
  evidence?: RuntimeEvidenceLevel;
  claimType?: RuntimeClaimType;
  expandable?: string;
  createdAt: string;
  updatedAt?: string;
  status?: RunStatus;
  tokenUsage?: AgentTokenUsage;
  references?: SciForgeReference[];
  objectReferences?: ObjectReference[];
  provenance?: SciForgeMessageProvenance;
  goalSnapshot?: UserGoalSnapshot;
  acceptance?: TurnAcceptance;
  guidanceQueue?: GuidanceQueueRecord;
}

export function isSeedDemoOrFixtureMessage(message: Pick<SciForgeMessage, 'id' | 'role' | 'provenance'>): boolean {
  const provenance = message.provenance;
  if (provenance?.kind === 'live-runtime-codex' || provenance?.liveAcceptanceEligible === true) return false;
  const marker = [
    message.id,
    message.role,
    provenance?.kind,
    provenance?.source,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ');
  if (provenance?.kind === 'seed-demo' || provenance?.kind === 'fixture') return true;
  if (/\b(seed|demo|fixture)\b|scenariodemodata/.test(marker)) return true;
  if (provenance?.runtimeRequestEligible === false || provenance?.liveAcceptanceEligible === false) return true;
  return false;
}

export function isLiveRuntimeCodexMessage(message: Pick<SciForgeMessage, 'provenance'>): boolean {
  return message.provenance?.kind === 'live-runtime-codex'
    && message.provenance.liveAcceptanceEligible === true;
}
