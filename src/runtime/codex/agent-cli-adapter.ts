import type { NormalizedAgentEvent } from './codex-event-normalizer.js';

export type AgentCliApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';
export type AgentCliSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface RuntimeDeclaredIntentSnapshot {
  model?: {
    modelIntentId?: string;
    publicLabel?: string;
    mode?: string;
    capabilityTier?: string;
    actionId?: string;
    declaredAt?: string;
  };
  mode?: {
    modeIntentId?: string;
    publicLabel?: string;
    summaryGuidance?: string;
    actionId?: string;
    declaredAt?: string;
  };
}

export interface AgentCliStartTurnInput {
  commandText: string;
  workspacePath: string;
  commandId?: string;
  attemptId?: string;
  profile?: string;
  approvalPolicy?: AgentCliApprovalPolicy;
  sandbox?: AgentCliSandbox;
  codexSessionId?: string;
  abortSignal?: AbortSignal;
  allowOpenAiRuntime?: boolean;
  runtimeIntent?: {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1';
    kind: 'computer-use-native-route';
    source: 'host-owned';
  };
  guiExtension?: {
    enabled?: boolean;
    statePath?: string;
  };
  humanApproval?: Record<string, unknown>;
  uiState?: Record<string, unknown>;
  declaredIntents?: RuntimeDeclaredIntentSnapshot;
}

export interface AgentCliTurn {
  turnId: string;
  attemptId: string;
  codexSessionId?: string;
  events: AsyncIterable<NormalizedAgentEvent>;
}

export interface AgentCliAdapter {
  startTurn(input: AgentCliStartTurnInput): Promise<AgentCliTurn>;
  cancel(turnId: string): Promise<void>;
}
