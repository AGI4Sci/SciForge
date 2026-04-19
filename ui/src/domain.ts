import type { AgentId, ClaimType, EvidenceLevel } from './data';

export type MessageRole = 'user' | 'agent' | 'system';
export type RunStatus = 'idle' | 'running' | 'completed' | 'failed';
export type ExecutionUnitStatus = 'planned' | 'running' | 'done' | 'failed' | 'record-only';

export interface BioAgentMessage {
  id: string;
  role: MessageRole;
  content: string;
  confidence?: number;
  evidence?: EvidenceLevel;
  claimType?: ClaimType;
  expandable?: string;
  createdAt: string;
  status?: RunStatus;
}

export interface EvidenceClaim {
  id: string;
  text: string;
  type: ClaimType;
  confidence: number;
  evidenceLevel: EvidenceLevel;
  supportingRefs: string[];
  opposingRefs: string[];
  updatedAt: string;
}

export interface UIManifestSlot {
  componentId: string;
  title?: string;
  props?: Record<string, unknown>;
  artifactRef?: string;
  priority?: number;
}

export interface RuntimeArtifact {
  id: string;
  type: string;
  producerAgent: AgentId;
  schemaVersion: string;
  metadata?: Record<string, unknown>;
  data?: unknown;
  dataRef?: string;
}

export interface RuntimeExecutionUnit {
  id: string;
  tool: string;
  params: string;
  status: ExecutionUnitStatus;
  hash: string;
  code?: string;
  seed?: number;
  time?: string;
  environment?: string;
  inputData?: string[];
  dataFingerprint?: string;
  databaseVersions?: string[];
  artifacts?: string[];
  outputArtifacts?: string[];
}

export interface NotebookRecord {
  id: string;
  time: string;
  agent: AgentId;
  title: string;
  desc: string;
  claimType: ClaimType;
  confidence: number;
}

export interface BioAgentRun {
  id: string;
  agentId: AgentId;
  status: RunStatus;
  prompt: string;
  response: string;
  createdAt: string;
  completedAt?: string;
  raw?: unknown;
}

export interface BioAgentSession {
  schemaVersion: 1;
  sessionId: string;
  agentId: AgentId;
  messages: BioAgentMessage[];
  runs: BioAgentRun[];
  uiManifest: UIManifestSlot[];
  claims: EvidenceClaim[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  notebook: NotebookRecord[];
  updatedAt: string;
}

export interface SendAgentMessageInput {
  agentId: AgentId;
  agentName: string;
  agentDomain: string;
  prompt: string;
  roleView: string;
  messages: BioAgentMessage[];
}

export interface NormalizedAgentResponse {
  message: BioAgentMessage;
  run: BioAgentRun;
  uiManifest: UIManifestSlot[];
  claims: EvidenceClaim[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  notebook: NotebookRecord[];
}

export interface AgentServerRunPayload {
  agent: {
    id: string;
    name: string;
    backend: 'codex';
    workspace: string;
    systemPrompt: string;
    reconcileExisting: boolean;
    metadata: Record<string, unknown>;
  };
  input: {
    text: string;
    metadata: Record<string, unknown>;
  };
  metadata: Record<string, unknown>;
}

export function nowIso() {
  return new Date().toISOString();
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
