import type { RuntimeArtifact } from './artifacts';
import type { CapabilityInvocationBudgetDebitRecord } from './capability-budget';
import type { ObjectReference, ObjectResolution } from './references';

export type BackendArtifactToolName =
  | 'list_session_artifacts'
  | 'resolve_object_reference'
  | 'read_artifact'
  | 'render_artifact'
  | 'resume_run';

export type BackendObjectRefKind =
  | 'workspace'
  | 'artifact'
  | 'execution-unit'
  | 'run'
  | 'file'
  | 'agentserver';

export interface BackendToolContext {
  workspacePath: string;
  sessionId?: string;
  skillDomain?: string;
  artifacts?: Array<Record<string, unknown>>;
}

export interface ListSessionArtifactsInput extends BackendToolContext {
  limit?: number;
}

export interface ListSessionArtifactsResult {
  tool: 'list_session_artifacts';
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
  budgetDebitRefs?: string[];
  budgetDebits?: CapabilityInvocationBudgetDebitRecord[];
  executionUnit?: BackendArtifactToolExecutionUnit;
  workEvidence?: BackendArtifactToolWorkEvidence;
  audit?: BackendArtifactToolAuditRecord;
}

export interface ResolveObjectReferenceInput extends BackendToolContext {
  ref: string;
}

export interface ResolveObjectReferenceResult extends ObjectResolution {
  tool: 'resolve_object_reference';
  refKind: BackendObjectRefKind;
}

export interface ReadArtifactInput extends BackendToolContext {
  ref: string;
}

export interface ReadArtifactResult {
  tool: 'read_artifact';
  reference: ObjectReference;
  artifact?: RuntimeArtifact;
  content?: unknown;
  text?: string;
  mimeType?: string;
  status: 'read' | 'missing' | 'blocked';
  reason?: string;
}

export type RenderArtifactFormat = 'markdown' | 'json' | 'text';

export interface RenderArtifactInput extends BackendToolContext {
  ref: string;
  format?: RenderArtifactFormat;
}

export interface RenderArtifactResult {
  tool: 'render_artifact';
  reference: ObjectReference;
  format: RenderArtifactFormat;
  rendered?: string;
  status: 'rendered' | 'missing' | 'blocked';
  reason?: string;
}

export interface ResumeRunInput extends BackendToolContext {
  ref: string;
  reason?: string;
}

export interface ResumeRunResult {
  tool: 'resume_run';
  runRef: string;
  status: 'resume-requested' | 'missing' | 'blocked';
  objectReferences: ObjectReference[];
  reason?: string;
  budgetDebitRefs?: string[];
  budgetDebits?: CapabilityInvocationBudgetDebitRecord[];
  executionUnit?: BackendArtifactToolExecutionUnit;
  workEvidence?: BackendArtifactToolWorkEvidence;
  audit?: BackendArtifactToolAuditRecord;
}

export interface BackendArtifactToolExecutionUnit {
  id: string;
  tool: string;
  status: 'done' | 'missing' | 'blocked';
  params: string;
  inputData: string[];
  outputArtifacts: string[];
  artifacts: string[];
  budgetDebitRefs: string[];
}

export interface BackendArtifactToolWorkEvidence {
  id: string;
  kind: 'runtime';
  status: 'success' | 'failed-with-reason';
  provider: 'backend-artifact-tools';
  input: Record<string, unknown>;
  resultCount: number;
  outputSummary: string;
  evidenceRefs: string[];
  failureReason?: string;
  recoverActions: string[];
  rawRef: string;
  budgetDebitRefs: string[];
}

export interface BackendArtifactToolAuditRecord {
  kind: 'capability-budget-debit-audit';
  ref: string;
  capabilityId: string;
  tool: BackendArtifactToolName;
  budgetDebitRefs: string[];
  sinkRefs: CapabilityInvocationBudgetDebitRecord['sinkRefs'];
}
