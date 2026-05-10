import { appendTaskAttempt } from '../task-attempt-history.js';
import type {
  AgentBackendAdapter,
  AgentServerGenerationResponse,
  BackendContextCompactionResult,
  GatewayRequest,
  SkillAvailability,
  ToolPayload,
  WorkspaceRuntimeCallbacks,
} from '../runtime-types.js';
import { sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import {
  contextCompactionMetadata,
  workspaceContextWindowStateFromBackend,
} from './agentserver-context-window.js';
import { providerForBackend } from './agent-backend-config.js';
import { agentServerSessionRef } from './agentserver-run-output.js';
import {
  boundedRateLimitBackoffMs,
  classifyAgentServerBackendFailure,
  isContextWindowExceededError,
  providerRateLimitDiagnosticMessage,
  rateLimitRecoverActions,
  sanitizeAgentServerError,
  type AgentServerBackendFailureDiagnostic,
  type AgentServerBackendFailureKind,
} from './backend-failure-diagnostics.js';
import { attemptPlanRefs } from './runtime-routing.js';
import {
  AGENTSERVER_GENERATION_RETRY_SCHEMA_VERSION,
  agentServerContextWindowRecoveryStartEvent,
  agentServerContextWindowRecoverySucceededEvent,
  agentServerGenerationRecoveryStartEvent,
  agentServerGenerationRetrySucceededEvent,
} from '@sciforge-ui/runtime-contract/events';

export interface AgentServerGenerationRetryAudit {
  schemaVersion: typeof AGENTSERVER_GENERATION_RETRY_SCHEMA_VERSION;
  attempt: 2;
  maxAttempts: 2;
  trigger: AgentServerBackendFailureDiagnostic;
  firstFailedAt: string;
  backoffMs: number;
  recoveryActions: string[];
  contextPolicy: {
    mode: 'delta';
    handoff: 'slimmed';
    compactBeforeRetry: true;
    maxRetryCount: 1;
  };
  compaction?: ReturnType<typeof contextCompactionMetadata>;
  priorHandoff?: {
    rawRef: string;
    rawBytes: number;
    normalizedBytes: number;
  };
}

export type AgentServerGenerationFailureDiagnostics = {
  kind: 'contextWindowExceeded' | 'rateLimit' | 'agentserver';
  categories?: AgentServerBackendFailureKind[];
  retryAfterMs?: number;
  resetAt?: string;
  retryAudit?: AgentServerGenerationRetryAudit;
  backend?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  sessionRef?: string;
  originalErrorSummary: string;
  compaction?: BackendContextCompactionResult;
  priorHandoff?: AgentServerGenerationRetryAudit['priorHandoff'];
  retryAttempted?: boolean;
  retrySucceeded?: boolean;
};

export type AgentServerGenerationResult =
  | { ok: true; runId?: string; response: AgentServerGenerationResponse }
  | { ok: true; runId?: string; directPayload: ToolPayload }
  | { ok: false; error: string; diagnostics?: AgentServerGenerationFailureDiagnostics };

export async function recoverOrReturnAgentServerGenerationFailure(params: {
  error: string;
  sanitizedError: string;
  dispatchAttempt: number;
  contextRecovery?: AgentServerGenerationFailureDiagnostics;
  adapter: AgentBackendAdapter;
  baseUrl: string;
  workspace: string;
  agentId: string;
  provider?: string;
  model?: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  callbacks?: WorkspaceRuntimeCallbacks;
  httpStatus?: number;
  headers?: Headers;
  priorHandoff: {
    rawRef: string;
    rawBytes: number;
    normalizedBytes: number;
  };
}): Promise<
  | { retry: true; diagnostics: AgentServerGenerationFailureDiagnostics }
  | { retry: false; result: AgentServerGenerationResult }
> {
  const originalErrorSummary = sanitizeAgentServerError(params.error || params.sanitizedError);
  const contextSessionRef = agentServerSessionRef(params.baseUrl, params.agentId);
  const diagnosticProvider = params.provider ?? providerForBackend(params.adapter.backend);
  if (isContextWindowExceededError(`${params.error}\n${params.sanitizedError}`)) {
    if (params.dispatchAttempt >= 2 || params.contextRecovery?.retryAttempted) {
      return {
        retry: false,
        result: {
          ok: false,
          error: params.sanitizedError,
          diagnostics: {
            ...(params.contextRecovery ?? {}),
            kind: 'contextWindowExceeded',
            backend: params.contextRecovery?.backend ?? params.adapter.backend,
            provider: params.contextRecovery?.provider ?? diagnosticProvider,
            model: params.contextRecovery?.model ?? params.model,
            agentId: params.contextRecovery?.agentId ?? params.agentId,
            sessionRef: params.contextRecovery?.sessionRef ?? contextSessionRef,
            originalErrorSummary: params.contextRecovery?.originalErrorSummary ?? originalErrorSummary,
            priorHandoff: params.contextRecovery?.priorHandoff ?? params.priorHandoff,
            retryAttempted: true,
            retrySucceeded: false,
          },
        },
      };
    }
    emitWorkspaceRuntimeEvent(params.callbacks, agentServerContextWindowRecoveryStartEvent({
      detail: originalErrorSummary,
      raw: {
        backend: params.adapter.backend,
        provider: diagnosticProvider,
        model: params.model,
        agentId: params.agentId,
        sessionRef: contextSessionRef,
        priorHandoff: params.priorHandoff,
      },
    }));
    const compaction = await params.adapter.compactContext?.(
      { agentId: params.agentId, workspace: params.workspace, baseUrl: params.baseUrl },
      `contextWindowExceeded:${originalErrorSummary}`,
    ) ?? {
      ok: false,
      backend: params.adapter.backend,
      agentId: params.agentId,
      strategy: 'none' as const,
      reason: `contextWindowExceeded:${originalErrorSummary}`,
      message: 'Backend adapter did not provide compactContext.',
    };
    const compactionStatus = compaction.status === 'unsupported' || compaction.status === 'skipped'
      ? 'skipped'
      : compaction.ok ? 'completed' : 'failed';
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextCompaction',
      source: 'workspace-runtime',
      status: compactionStatus,
      message: compaction.ok
        ? 'Context compaction completed; retrying AgentServer generation once.'
        : compactionStatus === 'skipped'
          ? 'Context compact API unsupported; retrying AgentServer generation once with slim handoff diagnostics.'
          : 'Context compaction failed; retrying AgentServer generation once with slim handoff diagnostics.',
      detail: compaction.message || compaction.reason,
      contextCompaction: contextCompactionMetadata(compaction),
      contextWindowState: compaction.after ? workspaceContextWindowStateFromBackend(compaction.after) : undefined,
      raw: compaction,
    });
    const diagnostics: AgentServerGenerationFailureDiagnostics = {
      kind: 'contextWindowExceeded',
      backend: params.adapter.backend,
      provider: diagnosticProvider,
      model: params.model,
      agentId: params.agentId,
      sessionRef: contextSessionRef,
      originalErrorSummary,
      compaction,
      priorHandoff: params.priorHandoff,
      retryAttempted: true,
      retrySucceeded: false,
    };
    await appendContextRecoveryAuditAttempt({
      workspace: params.workspace,
      request: params.request,
      skill: params.skill,
      diagnostics,
      status: compaction.ok ? 'self-healed' : 'repair-needed',
      failureReason: originalErrorSummary,
    });
    return { retry: true, diagnostics };
  }

  const diagnostic = classifyAgentServerBackendFailure(params.error, {
    httpStatus: params.httpStatus,
    headers: params.headers,
    backend: params.adapter.backend,
    provider: diagnosticProvider,
    model: params.model,
  });
  if (!diagnostic) {
    return {
      retry: false,
      result: { ok: false, error: params.sanitizedError },
    };
  }

  if (params.dispatchAttempt >= 2 || params.contextRecovery?.retryAttempted) {
    return {
      retry: false,
      result: {
        ok: false,
        error: providerRateLimitDiagnosticMessage(diagnostic, true),
        diagnostics: {
          ...(params.contextRecovery ?? {}),
          kind: diagnostic.categories.includes('context-window') ? 'contextWindowExceeded' : diagnostic.categories.includes('rate-limit') || diagnostic.categories.includes('http-429') ? 'rateLimit' : 'agentserver',
          categories: diagnostic.categories,
          backend: diagnostic.backend,
          provider: diagnostic.provider,
          model: diagnostic.model,
          agentId: params.agentId,
          sessionRef: `${params.baseUrl}/api/agent-server/agents/${encodeURIComponent(params.agentId)}`,
          originalErrorSummary: providerRateLimitDiagnosticMessage(diagnostic, true),
          retryAfterMs: diagnostic.retryAfterMs,
          resetAt: diagnostic.resetAt,
          priorHandoff: params.priorHandoff,
          retryAttempted: true,
          retrySucceeded: false,
        },
      },
    };
  }

  const backoffMs = boundedRateLimitBackoffMs(diagnostic);
  emitWorkspaceRuntimeEvent(params.callbacks, agentServerGenerationRecoveryStartEvent({
    categories: diagnostic.categories,
    detail: providerRateLimitDiagnosticMessage(diagnostic, false),
    raw: diagnostic,
  }));
  if (backoffMs > 0) {
    await sleep(backoffMs);
  }
  const sessionRef = {
    agentId: params.agentId,
    workspace: params.workspace,
    baseUrl: params.baseUrl,
  };
  const compaction = await params.adapter.compactContext?.(
    sessionRef,
    `rate-limit-retry:${diagnostic.categories.join(',')}:${diagnostic.message.slice(0, 120)}`,
  );
  if (compaction) {
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextCompaction',
      source: 'workspace-runtime',
      status: compaction.ok ? 'completed' : 'failed',
      message: 'AgentServer compact before provider/rate-limit retry',
      detail: compaction.message || compaction.reason,
      contextCompaction: contextCompactionMetadata(compaction),
      contextWindowState: compaction.after ? workspaceContextWindowStateFromBackend(compaction.after) : undefined,
      raw: compaction,
    });
  }

  const retryAudit: AgentServerGenerationRetryAudit = {
    schemaVersion: AGENTSERVER_GENERATION_RETRY_SCHEMA_VERSION,
    attempt: 2,
    maxAttempts: 2,
    trigger: diagnostic,
    firstFailedAt: new Date().toISOString(),
    backoffMs,
    recoveryActions: rateLimitRecoverActions(diagnostic),
    contextPolicy: {
      mode: 'delta',
      handoff: 'slimmed',
      compactBeforeRetry: true,
      maxRetryCount: 1,
    },
    compaction: compaction ? contextCompactionMetadata(compaction) : undefined,
    priorHandoff: params.priorHandoff,
  };
  return {
    retry: true,
    diagnostics: {
      kind: diagnostic.categories.includes('context-window') ? 'contextWindowExceeded' : diagnostic.categories.includes('rate-limit') || diagnostic.categories.includes('http-429') ? 'rateLimit' : 'agentserver',
      categories: diagnostic.categories,
      backend: diagnostic.backend,
      provider: diagnostic.provider,
      model: diagnostic.model,
      agentId: params.agentId,
      sessionRef: `${params.baseUrl}/api/agent-server/agents/${encodeURIComponent(params.agentId)}`,
      originalErrorSummary: providerRateLimitDiagnosticMessage(diagnostic, false),
      retryAfterMs: diagnostic.retryAfterMs,
      resetAt: diagnostic.resetAt,
      compaction,
      priorHandoff: params.priorHandoff,
      retryAudit,
      retryAttempted: true,
      retrySucceeded: false,
    },
  };
}

export async function finalizeAgentServerGenerationSuccess<T extends Extract<AgentServerGenerationResult, { ok: true }>>(params: {
  result: T;
  contextRecovery?: AgentServerGenerationFailureDiagnostics;
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  callbacks?: WorkspaceRuntimeCallbacks;
}): Promise<T> {
  if (!params.contextRecovery) return params.result;
  params.contextRecovery.retrySucceeded = true;
  if (String(params.contextRecovery.kind) === 'contextWindowExceeded') {
    emitWorkspaceRuntimeEvent(params.callbacks, agentServerContextWindowRecoverySucceededEvent({
      detail: params.contextRecovery.compaction?.message || params.contextRecovery.originalErrorSummary,
      raw: params.contextRecovery,
    }));
    await appendContextRecoveryAuditAttempt({
      workspace: params.workspace,
      request: params.request,
      skill: params.skill,
      diagnostics: params.contextRecovery,
      status: 'self-healed',
      failureReason: `Recovered from contextWindowExceeded after one compact+retry: ${params.contextRecovery.originalErrorSummary}`,
    });
    return params.result;
  }
  emitWorkspaceRuntimeEvent(params.callbacks, agentServerGenerationRetrySucceededEvent({
    detail: params.contextRecovery.originalErrorSummary,
    raw: params.contextRecovery,
  }));
  return params.result;
}

async function appendContextRecoveryAuditAttempt(params: {
  workspace: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  diagnostics: AgentServerGenerationFailureDiagnostics;
  status: 'repair-needed' | 'self-healed';
  failureReason: string;
}) {
  const id = `agentserver-context-recovery-${params.request.skillDomain}-${sha1(`${params.request.prompt}:${params.status}:${Date.now()}`).slice(0, 12)}`;
  await appendTaskAttempt(params.workspace, {
    id,
    prompt: params.request.prompt,
    skillDomain: params.request.skillDomain,
    ...attemptPlanRefs(params.request, params.skill, params.failureReason),
    skillId: params.skill.id,
    attempt: 1,
    status: params.status,
    failureReason: params.failureReason,
    contextRecovery: {
      kind: 'contextWindowExceeded',
      backend: params.diagnostics.backend,
      provider: params.diagnostics.provider,
      agentId: params.diagnostics.agentId,
      sessionRef: params.diagnostics.sessionRef,
      originalErrorSummary: params.diagnostics.originalErrorSummary,
      compaction: params.diagnostics.compaction,
      retryAttempted: params.diagnostics.retryAttempted,
      retrySucceeded: params.diagnostics.retrySucceeded,
    },
    createdAt: new Date().toISOString(),
  });
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
