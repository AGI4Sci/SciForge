import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { isRecord } from '../gateway-utils.js';
import type { ConversationPolicyApplication } from '../conversation-policy/apply.js';
import {
  LATENCY_DIAGNOSTICS_EVENT_TYPE,
  LATENCY_DIAGNOSTICS_LOG_KIND,
  LATENCY_DIAGNOSTICS_REF,
  LATENCY_DIAGNOSTICS_SCHEMA_VERSION,
  SCIFORGE_RUNTIME_PROVIDER,
  WORKSPACE_RUNTIME_SOURCE,
  latencyDiagnosticsCachePolicy,
  runtimeEventIsBackend,
  runtimeEventIsUserVisible,
} from '@sciforge-ui/runtime-contract/events';

export { LATENCY_DIAGNOSTICS_SCHEMA_VERSION } from '@sciforge-ui/runtime-contract/events';

export interface LatencyDiagnostics {
  schemaVersion: typeof LATENCY_DIAGNOSTICS_SCHEMA_VERSION;
  timeToFirstVisibleResponseMs?: number;
  timeToFirstBackendEventMs?: number;
  compactionWaitMs: number;
  verificationWaitMs: number;
  backgroundCompletionDurationMs?: number;
  cache: {
    hits: string[];
    misses: string[];
  };
  policySource: 'python' | 'fallback' | 'disabled';
  fallbackReason?: string;
}

export function createLatencyTelemetry(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: {
    now?: () => number;
  } = {},
) {
  const now = options.now ?? Date.now;
  const startedAt = now();
  let firstVisibleResponseMs: number | undefined;
  let firstBackendEventMs: number | undefined;
  let compactionStartedAt: number | undefined;
  let compactionWaitMs = 0;
  let verificationStartedAt: number | undefined;
  let verificationWaitMs = 0;
  let backgroundStartedAt: number | undefined;
  let backgroundCompletionDurationMs: number | undefined;
  let policySource: LatencyDiagnostics['policySource'] = 'fallback';
  let fallbackReason: string | undefined;
  let policyRequest: GatewayRequest = request;

  const wrappedCallbacks: WorkspaceRuntimeCallbacks = {
    ...callbacks,
    onEvent: (event) => {
      observeEvent(event);
      callbacks.onEvent?.(event);
    },
  };

  function observeEvent(event: WorkspaceRuntimeEvent) {
    const elapsed = Math.max(0, Math.round(now() - startedAt));
    if (firstVisibleResponseMs === undefined && runtimeEventIsUserVisible(event)) {
      firstVisibleResponseMs = elapsed;
    }
    if (firstBackendEventMs === undefined && runtimeEventIsBackend(event)) {
      firstBackendEventMs = elapsed;
    }
    observeCompaction(event);
    observeBackgroundCompletion(event);
  }

  function observeCompaction(event: WorkspaceRuntimeEvent) {
    const status = event.contextCompaction?.status ?? event.status;
    if (event.contextCompaction?.startedAt && event.contextCompaction.completedAt) {
      compactionWaitMs += Math.max(0, Date.parse(event.contextCompaction.completedAt) - Date.parse(event.contextCompaction.startedAt));
      compactionStartedAt = undefined;
      return;
    }
    if (event.type !== 'contextCompaction' && !event.contextCompaction) return;
    if ((status === 'started' || status === 'running' || status === 'pending') && compactionStartedAt === undefined) {
      compactionStartedAt = now();
      return;
    }
    if ((status === 'completed' || status === 'failed' || status === 'skipped') && compactionStartedAt !== undefined) {
      compactionWaitMs += Math.max(0, Math.round(now() - compactionStartedAt));
      compactionStartedAt = undefined;
    }
  }

  function observeBackgroundCompletion(event: WorkspaceRuntimeEvent) {
    const raw = isRecord(event.raw) ? event.raw : {};
    const background = isRecord(raw.backgroundCompletion) ? raw.backgroundCompletion : event.type.startsWith('background-') ? raw : undefined;
    if (!background && !event.type.startsWith('background-')) return;
    const status = stringField(background?.status) ?? event.status;
    const createdAt = stringField(background?.createdAt);
    const completedAt = stringField(background?.completedAt);
    if (createdAt && completedAt) {
      backgroundCompletionDurationMs = Math.max(0, Date.parse(completedAt) - Date.parse(createdAt));
      backgroundStartedAt = undefined;
      return;
    }
    if (status === 'running' && backgroundStartedAt === undefined) {
      backgroundStartedAt = now();
      return;
    }
    if ((status === 'completed' || status === 'failed' || status === 'cancelled') && backgroundStartedAt !== undefined) {
      backgroundCompletionDurationMs = Math.max(0, Math.round(now() - backgroundStartedAt));
      backgroundStartedAt = undefined;
    }
  }

  function markPolicyApplication(application: ConversationPolicyApplication) {
    policyRequest = application.request;
    if (application.status === 'applied') {
      policySource = 'python';
      return;
    }
    policySource = application.status === 'disabled' ? 'disabled' : 'fallback';
    fallbackReason = application.error ?? application.status;
  }

  function markVerificationStart() {
    verificationStartedAt = now();
  }

  function markVerificationEnd() {
    if (verificationStartedAt === undefined) return;
    verificationWaitMs += Math.max(0, Math.round(now() - verificationStartedAt));
    verificationStartedAt = undefined;
  }

  function markFallback(reason: string) {
    fallbackReason = reason;
    if (policySource === 'python') return;
    policySource = policySource === 'disabled' ? 'disabled' : 'fallback';
  }

  function diagnostics(): LatencyDiagnostics {
    return {
      schemaVersion: LATENCY_DIAGNOSTICS_SCHEMA_VERSION,
      timeToFirstVisibleResponseMs: firstVisibleResponseMs,
      timeToFirstBackendEventMs: firstBackendEventMs,
      compactionWaitMs,
      verificationWaitMs,
      backgroundCompletionDurationMs,
      cache: cacheDiagnostics(policyRequest),
      policySource,
      fallbackReason,
    };
  }

  function emitFinal(payload?: ToolPayload): ToolPayload | undefined {
    const summary = diagnostics();
    emitWorkspaceRuntimeEvent(callbacks, {
      type: LATENCY_DIAGNOSTICS_EVENT_TYPE,
      source: WORKSPACE_RUNTIME_SOURCE,
      status: fallbackReason ? 'completed-with-fallback' : 'completed',
      message: 'SciForge latency diagnostics captured.',
      detail: lowNoiseSummary(summary),
      raw: summary,
    });
    if (!payload) return undefined;
    return {
      ...payload,
      logs: [
        ...(payload.logs ?? []),
        { kind: LATENCY_DIAGNOSTICS_LOG_KIND, ref: LATENCY_DIAGNOSTICS_REF, data: summary },
      ],
      workEvidence: [
        ...(payload.workEvidence ?? []),
        {
          kind: 'other',
          status: 'success',
          provider: SCIFORGE_RUNTIME_PROVIDER,
          input: { policySource: summary.policySource },
          resultCount: 1,
          outputSummary: lowNoiseSummary(summary),
          evidenceRefs: [LATENCY_DIAGNOSTICS_REF],
          recoverActions: [],
          diagnostics: [
            `timeToFirstVisibleResponseMs=${summary.timeToFirstVisibleResponseMs ?? 'n/a'}`,
            `timeToFirstBackendEventMs=${summary.timeToFirstBackendEventMs ?? 'n/a'}`,
            `compactionWaitMs=${summary.compactionWaitMs}`,
            `verificationWaitMs=${summary.verificationWaitMs}`,
            `cacheHit=${summary.cache.hits.join(',') || 'none'}`,
            `cacheMiss=${summary.cache.misses.join(',') || 'none'}`,
            summary.fallbackReason ? `fallbackReason=${summary.fallbackReason}` : 'fallbackReason=none',
          ],
          rawRef: LATENCY_DIAGNOSTICS_REF,
        },
      ],
    };
  }

  return {
    callbacks: wrappedCallbacks,
    diagnostics,
    emitFinal,
    markFallback,
    markPolicyApplication,
    markVerificationEnd,
    markVerificationStart,
    observeEvent,
  };
}

function cacheDiagnostics(request: GatewayRequest) {
  const policy = isRecord(request.uiState?.cachePolicy) ? request.uiState.cachePolicy : {};
  return latencyDiagnosticsCachePolicy(policy);
}

function lowNoiseSummary(diagnostics: LatencyDiagnostics) {
  const parts = [
    `firstVisible=${diagnostics.timeToFirstVisibleResponseMs ?? 'n/a'}ms`,
    `firstBackend=${diagnostics.timeToFirstBackendEventMs ?? 'n/a'}ms`,
    `compaction=${diagnostics.compactionWaitMs}ms`,
    `verification=${diagnostics.verificationWaitMs}ms`,
    diagnostics.backgroundCompletionDurationMs !== undefined ? `background=${diagnostics.backgroundCompletionDurationMs}ms` : undefined,
    `cache=${diagnostics.cache.hits.length} hit/${diagnostics.cache.misses.length} miss`,
    `policy=${diagnostics.policySource}`,
    diagnostics.fallbackReason ? `fallback=${diagnostics.fallbackReason}` : undefined,
  ].filter(Boolean);
  return parts.join('; ');
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
