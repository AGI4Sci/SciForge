export type AgentContextWindowSource = 'native' | 'provider-usage' | 'agentserver-estimate' | 'agentserver' | 'estimate' | 'unknown';
export type AgentCompactCapability = 'native' | 'agentserver' | 'handoff-only' | 'handoff-slimming' | 'session-rotate' | 'none' | 'unknown';

export interface AgentContextWindowState {
  backend?: string;
  provider?: string;
  model?: string;
  usedTokens?: number;
  input?: number;
  output?: number;
  cache?: number;
  window?: number;
  windowTokens?: number;
  ratio?: number;
  source: AgentContextWindowSource;
  status?: 'healthy' | 'watch' | 'near-limit' | 'exceeded' | 'compacting' | 'blocked' | 'unknown';
  compactCapability?: AgentCompactCapability;
  budget?: {
    rawRef?: string;
    rawSha1?: string;
    rawBytes?: number;
    normalizedBytes?: number;
    maxPayloadBytes?: number;
    rawTokens?: number;
    normalizedTokens?: number;
    savedTokens?: number;
    normalizedBudgetRatio?: number;
    decisions?: Array<Record<string, unknown>>;
  };
  auditRefs?: string[];
  autoCompactThreshold?: number;
  watchThreshold?: number;
  nearLimitThreshold?: number;
  lastCompactedAt?: string;
  pendingCompact?: boolean;
}

export interface AgentContextCompaction {
  status: 'started' | 'completed' | 'failed' | 'pending' | 'skipped';
  source?: AgentContextWindowSource;
  backend?: string;
  compactCapability?: AgentCompactCapability;
  before?: AgentContextWindowState;
  after?: AgentContextWindowState;
  auditRefs?: string[];
  startedAt?: string;
  completedAt?: string;
  lastCompactedAt?: string;
  reason?: string;
  message?: string;
}

export interface AgentTokenUsage {
  input?: number;
  output?: number;
  total?: number;
  cacheRead?: number;
  cacheWrite?: number;
  provider?: string;
  model?: string;
  source?: string;
}

export interface AgentStreamEvent {
  id: string;
  type: string;
  label: string;
  detail?: string;
  usage?: AgentTokenUsage;
  contextWindowState?: AgentContextWindowState;
  contextCompaction?: AgentContextCompaction;
  workEvidence?: Array<Record<string, unknown>>;
  createdAt: string;
  raw?: unknown;
}
