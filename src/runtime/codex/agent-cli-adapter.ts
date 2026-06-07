import type { NormalizedAgentEvent } from './codex-event-normalizer.js';
import type { CodexAgentHostRuntimeTruth } from './agent-host-grounding.js';

export type AgentCliApprovalPolicy = 'never' | 'on-request' | 'on-failure' | 'untrusted';
export type AgentCliSandbox = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface RuntimeDeclaredIntentSnapshot {
  authorization?: {
    profileId?: string;
    publicLabel?: string;
    source?: string;
    scope?: {
      user: 'current-user';
      workspace: 'current-workspace';
    };
    singleTurnOverride?: boolean;
    hardConfirmCategories?: string[];
    actionId?: string;
    declaredAt?: string;
  };
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

export interface AgentHostGroundingSnapshot {
  schemaVersion: 'sciforge.agent-host.grounding-snapshot.v1';
  source: 'runtime-codex-grounding' | 'codex-agent-host-turn-loop';
  productCapabilities: {
    browser: 'supported';
    computerUse: 'supported';
  };
  runtimeReadiness: {
    browser: 'ready' | 'blocked';
    computerUse: 'ready' | 'blocked';
  };
  readiness: {
    browserHostSession: string;
    nativeBridge: string;
    nativeSurface: string;
    windowActionSession: string;
    computerUseAdapter: string;
  };
  blockers: string[];
  authorizationProfile?: {
    id: string;
    publicLabel: string;
    scope: {
      user: 'current-user';
      workspace: 'current-workspace';
    };
  };
  singleTurnOverride?: boolean;
  actionContext: {
    targetBound: boolean;
    freshObservation: boolean;
    permissionRefsPresent: boolean;
    stopCancelPath: boolean;
  };
  refs: string[];
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
    computerUseNext?: Record<string, unknown>;
    computerUseLong?: Record<string, unknown>;
  };
  guiExtension?: {
    enabled?: boolean;
    statePath?: string;
  };
  humanApproval?: Record<string, unknown>;
  uiState?: Record<string, unknown>;
  declaredIntents?: RuntimeDeclaredIntentSnapshot;
  agentHostGrounding?: AgentHostGroundingSnapshot;
  agentHostRuntimeTruth?: CodexAgentHostRuntimeTruth;
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
