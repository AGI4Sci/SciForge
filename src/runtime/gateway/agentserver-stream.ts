import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { isRecord } from '../gateway-utils.js';
import {
  agentHarnessStageHookTraceMetadata,
  type AgentHarnessStageHookTraceMetadata,
} from './agent-harness-backend-selection.js';
import { collectWorkEvidenceFromBackendEvent, type WorkEvidence } from './work-evidence-types.js';
import {
  buildSilentStreamDecisionRecord,
  silentStreamDecisionRecordFromUnknown,
  type SilentStreamDecisionRecord,
} from '@sciforge-ui/runtime-contract/events';

export async function readAgentServerRunStream(
  response: Response,
  onEvent: (event: unknown) => void,
  options: {
    maxTotalUsage?: number;
    convergenceGuardMode?: 'generation' | 'repair-continuation';
    onGuardTrip?: (message: string) => void;
    maxSilentMs?: number;
    silencePolicy?: AgentServerStreamSilencePolicy;
    silentRetryCount?: number;
    silentRunId?: string;
    silentStreamDecision?: SilentStreamDecisionRecord;
    onSilentTimeout?: (message: string, audit: AgentServerSilentStreamGuardAudit) => void;
  } = {},
): Promise<{ json: unknown; run: Record<string, unknown>; error?: string; streamText?: string; workEvidence: WorkEvidence[] }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    return {
      json,
      run: isRecord(data.run) ? data.run : {},
      error: isRecord(json) ? String(json.error || '') : String(text).slice(0, 500),
      workEvidence: collectWorkEvidenceFromBackendEvent(json),
    };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const envelopes: unknown[] = [];
  let buffer = '';
  let finalResult: unknown;
  let streamError = '';
  let lastEnvelopeAt = Date.now();
  const streamTextParts: string[] = [];
  const workEvidence: WorkEvidence[] = [];
  const silencePolicy = options.silencePolicy ?? silentPolicyFromTimeout(options.maxSilentMs);
  const silentTimeoutMs = silencePolicy?.timeoutMs;
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    lastEnvelopeAt = Date.now();
    const envelope = JSON.parse(line) as unknown;
    envelopes.push(envelope);
    if (!isRecord(envelope)) return;
    for (const event of streamEventsFromEnvelope(envelope)) {
      workEvidence.push(...collectWorkEvidenceFromBackendEvent(event));
      if (isRecord(event)) {
        const text = typeof event.text === 'string'
          ? event.text
          : typeof event.delta === 'string'
            ? event.delta
            : undefined;
        if (text) streamTextParts.push(text);
      }
      onEvent(event);
      const totalUsage = agentServerEventTotalUsage(event);
      if (
        options.convergenceGuardMode
        && options.maxTotalUsage
        && totalUsage
        && totalUsage > options.maxTotalUsage
      ) {
        const message = convergenceGuardMessage(totalUsage, options.maxTotalUsage, options.convergenceGuardMode);
        options.onGuardTrip?.(message);
        if (options.convergenceGuardMode === 'repair-continuation') {
          throw new AgentServerRepairContinuationBoundedStopError(message, totalUsage, options.maxTotalUsage);
        }
        throw new AgentServerGenerationConvergenceGuardError(message, totalUsage, options.maxTotalUsage);
      }
    }
    if ('result' in envelope) finalResult = envelope.result;
    if ('error' in envelope) streamError = String(envelope.error || '');
  }
  for (;;) {
    const readResult = silentTimeoutMs
      ? await readStreamChunkWithSilentTimeout(reader, silentTimeoutMs)
      : await reader.read();
    if ('silentTimeout' in readResult) {
      const silentMs = Date.now() - lastEnvelopeAt;
      const audit = agentServerSilentStreamGuardAudit(silencePolicy, {
        elapsedMs: silentMs,
        retryCount: options.silentRetryCount,
        runId: options.silentRunId,
        existingDecision: options.silentStreamDecision,
      });
      options.onSilentTimeout?.(audit.message, audit);
      throw new Error(audit.message);
    }
    const { value, done } = readResult;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  const data = isRecord(finalResult) && isRecord(finalResult.data) ? finalResult.data : isRecord(finalResult) ? finalResult : {};
  return {
    json: finalResult ?? { envelopes, error: streamError },
    run: isRecord(data.run) ? data.run : {},
    error: streamError || undefined,
    streamText: streamTextParts.join(''),
    workEvidence: dedupeWorkEvidence(workEvidence),
  };
}

export class AgentServerRepairContinuationBoundedStopError extends Error {
  readonly code = 'AGENTSERVER_REPAIR_CONTINUATION_BOUNDED_STOP';
  readonly totalUsage: number;
  readonly limit: number;

  constructor(message: string, totalUsage: number, limit: number) {
    super(message);
    this.name = 'AgentServerRepairContinuationBoundedStopError';
    this.totalUsage = totalUsage;
    this.limit = limit;
  }
}

export class AgentServerGenerationConvergenceGuardError extends Error {
  readonly code = 'AGENTSERVER_GENERATION_CONVERGENCE_GUARD';
  readonly totalUsage: number;
  readonly limit: number;

  constructor(message: string, totalUsage: number, limit: number) {
    super(message);
    this.name = 'AgentServerGenerationConvergenceGuardError';
    this.totalUsage = totalUsage;
    this.limit = limit;
  }
}

export function isAgentServerRepairContinuationBoundedStopError(error: unknown): error is AgentServerRepairContinuationBoundedStopError {
  if (error instanceof AgentServerRepairContinuationBoundedStopError) return true;
  if (!isRecord(error)) return false;
  return error.code === 'AGENTSERVER_REPAIR_CONTINUATION_BOUNDED_STOP'
    || String(error.message || '').includes('AgentServer repair generation bounded-stop');
}

function convergenceGuardMessage(totalUsage: number, limit: number, mode: 'generation' | 'repair-continuation' = 'generation') {
  if (mode === 'repair-continuation') {
    return `AgentServer repair generation bounded-stop after ${totalUsage} total tokens (limit ${limit}); return a minimal single-stage repair/continue response, or a failed-with-reason ToolPayload with recoverActions requesting refs/digests-only follow-up instead of an unbounded repair loop.`;
  }
  return `AgentServer generation stopped by convergence guard after ${totalUsage} total tokens (limit ${limit}); use bounded session refs, current-reference digests, or a smaller task plan instead of an unbounded generation loop.`;
}

async function readStreamChunkWithSilentTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<{ silentTimeout: true }>((resolve) => {
        timeout = setTimeout(() => resolve({ silentTimeout: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const AGENTSERVER_SILENT_STREAM_POLICY_SCHEMA_VERSION = 'sciforge.agentserver-silent-stream-policy.v1' as const;
export const AGENTSERVER_SILENT_STREAM_GUARD_AUDIT_SCHEMA_VERSION = 'sciforge.agentserver-silent-stream-guard-audit.v1' as const;

export type AgentServerStreamSilenceDecision = 'visible-status' | 'retry' | 'abort' | 'background';

export interface AgentServerStreamSilencePolicy {
  schemaVersion: typeof AGENTSERVER_SILENT_STREAM_POLICY_SCHEMA_VERSION;
  source: string;
  timeoutMs: number;
  decision: AgentServerStreamSilenceDecision;
  status?: string;
  maxRetries?: number;
  auditRequired: boolean;
  digestRefCount: number;
  fallbackTimeoutMs: number;
  contractRef?: string;
  traceRef?: string;
  harnessSignals: AgentHarnessStageHookTraceMetadata;
}

export interface AgentServerSilentStreamGuardAudit {
  schemaVersion: typeof AGENTSERVER_SILENT_STREAM_GUARD_AUDIT_SCHEMA_VERSION;
  silentStreamDecision: SilentStreamDecisionRecord;
  source: string;
  timeoutMs: number;
  elapsedMs: number;
  decision: AgentServerStreamSilenceDecision;
  status?: string;
  retryCount: number;
  maxRetries?: number;
  retryable: boolean;
  auditRequired: boolean;
  digestRefCount: number;
  fallbackTimeoutMs: number;
  contractRef?: string;
  traceRef?: string;
  harnessSignals: AgentHarnessStageHookTraceMetadata;
  recoveryAction: string;
  message: string;
  detail: string;
}

function streamEventsFromEnvelope(envelope: Record<string, unknown>) {
  if ('event' in envelope) return [envelope.event];
  const events = Array.isArray(envelope.events) ? envelope.events : undefined;
  if (events) return events;
  if (looksLikeAgentServerStreamEvent(envelope)) return [normalizeTopLevelStreamEvent(envelope)];
  return [];
}

function looksLikeAgentServerStreamEvent(value: Record<string, unknown>) {
  if ('result' in value || 'error' in value && !('type' in value) && !('kind' in value)) return false;
  return typeof value.type === 'string'
    || typeof value.kind === 'string'
    || typeof value.delta === 'string'
    || typeof value.text === 'string'
    || isRecord(value.progress)
    || isRecord(value.usage);
}

function normalizeTopLevelStreamEvent(value: Record<string, unknown>) {
  const rawType = typeof value.type === 'string'
    ? value.type
    : typeof value.kind === 'string'
      ? value.kind
      : typeof value.delta === 'string'
        ? 'text-delta'
        : 'status';
  const type = rawType === 'text_delta' || rawType === 'token_delta' || rawType === 'content_delta'
    ? 'text-delta'
    : rawType;
  if (type === rawType && typeof value.delta !== 'string') return value;
  return {
    ...value,
    type,
    text: typeof value.text === 'string' ? value.text : typeof value.delta === 'string' ? value.delta : undefined,
  };
}

export function mergeBackendStreamWorkEvidence(payload: ToolPayload, workEvidence: WorkEvidence[]) {
  if (!workEvidence.length) return payload;
  const existing = Array.isArray(payload.workEvidence) ? payload.workEvidence : [];
  return {
    ...payload,
    workEvidence: dedupeWorkEvidence([...existing, ...workEvidence]),
  };
}

export function dedupeWorkEvidence(items: WorkEvidence[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify({
      kind: item.kind,
      status: item.status,
      provider: item.provider,
      input: item.input,
      resultCount: item.resultCount,
      failureReason: item.failureReason,
      rawRef: item.rawRef,
      evidenceRefs: item.evidenceRefs,
    });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function currentReferenceDigestGuardLimit(request: GatewayRequest) {
  const digests = Array.isArray(request.uiState?.currentReferenceDigests)
    ? request.uiState.currentReferenceDigests
    : [];
  if (!digests.length) return undefined;
  const configured = typeof request.maxContextWindowTokens === 'number' && Number.isFinite(request.maxContextWindowTokens)
    ? request.maxContextWindowTokens
    : 200_000;
  return Math.max(40_000, Math.min(80_000, Math.floor(configured * 0.4)));
}

export function agentServerGenerationTokenGuardLimit(request: GatewayRequest, options: { repairContinuation?: boolean } = {}) {
  void request;
  void options;
  return undefined;
}

export function currentReferenceDigestSilentGuardMs(request: GatewayRequest) {
  return currentReferenceDigestSilentGuardPolicy(request).timeoutMs;
}

export function currentReferenceDigestSilentGuardPolicy(request: GatewayRequest): AgentServerStreamSilencePolicy {
  const digests = Array.isArray(request.uiState?.currentReferenceDigests)
    ? request.uiState.currentReferenceDigests
    : [];
  const fallbackTimeoutMs = digests.length ? 45_000 : 30_000;
  const source = harnessSilencePolicySource(request.uiState);
  const silencePolicy = source?.silencePolicy;
  const progressPlan = source?.progressPlan;
  const configuredTimeoutMs = positiveNumberField(silencePolicy?.timeoutMs)
    ?? positiveNumberField(progressPlan?.silenceTimeoutMs);
  const harnessSignals = agentHarnessStageHookTraceMetadata(request, 'onStreamGuardTrip', {
    agentHarness: source?.agentHarness,
    summary: source?.summary,
    trace: source?.trace,
  });
  return {
    schemaVersion: AGENTSERVER_SILENT_STREAM_POLICY_SCHEMA_VERSION,
    source: source?.source ?? 'runtime.default',
    timeoutMs: Math.max(fallbackTimeoutMs, configuredTimeoutMs ?? fallbackTimeoutMs),
    decision: silenceDecisionField(silencePolicy?.decision) ?? 'visible-status',
    status: stringField(silencePolicy?.status),
    maxRetries: nonNegativeNumberField(silencePolicy?.maxRetries),
    auditRequired: booleanField(silencePolicy?.auditRequired) ?? Boolean(source),
    digestRefCount: digests.length,
    fallbackTimeoutMs,
    contractRef: stringField(source?.contractRef) ?? harnessSignals.contractRef,
    traceRef: harnessSignals.traceRef,
    harnessSignals,
  };
}

export function agentServerSilentStreamGuardAudit(
  policy: AgentServerStreamSilencePolicy | undefined,
  input: { elapsedMs: number; retryCount?: number; runId?: string; existingDecision?: unknown },
): AgentServerSilentStreamGuardAudit {
  const fallback = policy ?? silentPolicyFromTimeout(undefined) ?? {
    schemaVersion: AGENTSERVER_SILENT_STREAM_POLICY_SCHEMA_VERSION,
    source: 'runtime.default',
    timeoutMs: 30_000,
    decision: 'visible-status' as const,
    auditRequired: false,
    digestRefCount: 0,
    fallbackTimeoutMs: 30_000,
    harnessSignals: agentHarnessStageHookTraceMetadata({ skillDomain: 'knowledge', prompt: '', artifacts: [] }, 'onStreamGuardTrip'),
  };
  const retryCount = input.retryCount ?? 0;
  const retryable = fallback.decision === 'retry'
    ? retryCount < (fallback.maxRetries ?? 0)
    : fallback.decision === 'background' || fallback.decision === 'visible-status';
  const recoveryAction = recoveryActionForSilenceDecision(fallback.decision, retryable);
  const elapsedMs = Math.max(0, Math.trunc(input.elapsedMs));
  const message = `AgentServer generation stopped by silent stream guard after ${elapsedMs}ms without stream events; silencePolicy decision=${fallback.decision}, timeoutMs=${fallback.timeoutMs}, retry=${retryCount}/${fallback.maxRetries ?? 0}.`;
  const silentStreamDecision = buildSilentStreamDecisionRecord({
    existing: input.existingDecision,
    runId: input.runId,
    source: 'agentserver.stream.silentGuard',
    layer: 'backend-stream',
    decision: fallback.decision,
    timeoutMs: fallback.timeoutMs,
    elapsedMs,
    status: fallback.status,
    retryCount,
    maxRetries: fallback.maxRetries,
    detail: message,
  });
  return {
    schemaVersion: AGENTSERVER_SILENT_STREAM_GUARD_AUDIT_SCHEMA_VERSION,
    silentStreamDecision,
    source: fallback.source,
    timeoutMs: fallback.timeoutMs,
    elapsedMs,
    decision: fallback.decision,
    status: fallback.status,
    retryCount,
    maxRetries: fallback.maxRetries,
    retryable,
    auditRequired: fallback.auditRequired,
    digestRefCount: fallback.digestRefCount,
    fallbackTimeoutMs: fallback.fallbackTimeoutMs,
    contractRef: fallback.contractRef,
    traceRef: fallback.traceRef,
    harnessSignals: fallback.harnessSignals,
    recoveryAction,
    message,
    detail: [
      `source=${fallback.source}`,
      `decision=${fallback.decision}`,
      `timeoutMs=${fallback.timeoutMs}`,
      `elapsedMs=${elapsedMs}`,
      `retry=${retryCount}/${fallback.maxRetries ?? 0}`,
      `recoveryAction=${recoveryAction}`,
      fallback.status ? `status=${fallback.status}` : undefined,
      fallback.contractRef ? `contractRef=${fallback.contractRef}` : undefined,
      fallback.traceRef ? `traceRef=${fallback.traceRef}` : undefined,
    ].filter(Boolean).join(' · '),
  };
}

function silentPolicyFromTimeout(timeoutMs: number | undefined): AgentServerStreamSilencePolicy | undefined {
  const normalized = positiveNumberField(timeoutMs);
  if (!normalized) return undefined;
  return {
    schemaVersion: AGENTSERVER_SILENT_STREAM_POLICY_SCHEMA_VERSION,
    source: 'runtime.option.maxSilentMs',
    timeoutMs: normalized,
    decision: 'visible-status',
    auditRequired: false,
    digestRefCount: 0,
    fallbackTimeoutMs: normalized,
    harnessSignals: agentHarnessStageHookTraceMetadata({ skillDomain: 'knowledge', prompt: '', artifacts: [] }, 'onStreamGuardTrip'),
  };
}

function harnessSilencePolicySource(uiState: Record<string, unknown> | undefined): {
  source: string;
  progressPlan: Record<string, unknown>;
  silencePolicy: Record<string, unknown>;
  agentHarness?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  trace?: Record<string, unknown>;
  contractRef?: unknown;
} | undefined {
  if (!isRecord(uiState)) return undefined;
  const agentHarness = isRecord(uiState.agentHarness) ? uiState.agentHarness : undefined;
  const summary = isRecord(agentHarness?.summary) ? agentHarness.summary : undefined;
  const trace = isRecord(agentHarness?.trace) ? agentHarness.trace : undefined;
  const contract = isRecord(agentHarness?.contract) ? agentHarness.contract : undefined;
  const contractProgressPlan = isRecord(contract?.progressPlan) ? contract.progressPlan : undefined;
  const contractSilencePolicy = isRecord(contractProgressPlan?.silencePolicy) ? contractProgressPlan.silencePolicy : undefined;
  if (contract && contractProgressPlan && contractSilencePolicy) {
    const contractRef = contract.contractRef ?? agentHarness?.contractRef;
    return {
      source: 'request.uiState.agentHarness.contract.progressPlan.silencePolicy',
      progressPlan: contractProgressPlan,
      silencePolicy: contractSilencePolicy,
      agentHarness,
      summary,
      trace,
      contractRef,
    };
  }
  const handoff = isRecord(uiState.agentHarnessHandoff) ? uiState.agentHarnessHandoff : undefined;
  const handoffProgressPlan = isRecord(handoff?.progressPlan) ? handoff.progressPlan : undefined;
  const handoffSilencePolicy = isRecord(handoffProgressPlan?.silencePolicy) ? handoffProgressPlan.silencePolicy : undefined;
  if (handoffProgressPlan && handoffSilencePolicy) {
    return {
      source: 'request.uiState.agentHarnessHandoff.progressPlan.silencePolicy',
      progressPlan: handoffProgressPlan,
      silencePolicy: handoffSilencePolicy,
      agentHarness,
      summary,
      trace,
      contractRef: handoff?.harnessContractRef,
    };
  }
  return undefined;
}

export function silentStreamDecisionFromGatewayRequest(request: GatewayRequest) {
  return silentStreamDecisionRecordFromUnknown(isRecord(request.uiState) ? request.uiState.silentStreamDecision : undefined);
}

function recoveryActionForSilenceDecision(decision: AgentServerStreamSilenceDecision, retryable: boolean) {
  if (decision === 'retry') return retryable ? 'retry-compact-context' : 'fail-with-silent-stream-audit';
  if (decision === 'abort') return 'abort-run';
  if (decision === 'background') return 'continue-in-background';
  return 'emit-visible-status-and-recover-from-digests';
}

function silenceDecisionField(value: unknown): AgentServerStreamSilenceDecision | undefined {
  if (value === 'visible-status' || value === 'retry' || value === 'abort' || value === 'background') return value;
  return undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function positiveNumberField(value: unknown): number | undefined {
  const normalized = numberField(value);
  return normalized && normalized > 0 ? normalized : undefined;
}

function nonNegativeNumberField(value: unknown): number | undefined {
  const normalized = numberField(value);
  return normalized !== undefined && normalized >= 0 ? normalized : undefined;
}

function numberField(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function agentServerEventTotalUsage(event: unknown) {
  if (!isRecord(event)) return undefined;
  const usage = isRecord(event.usage) ? event.usage : isRecord(event.output) && isRecord(event.output.usage) ? event.output.usage : undefined;
  const candidates = [
    event.total,
    event.totalTokens,
    event.tokens,
    usage?.total,
    usage?.totalTokens,
    usage?.input && usage?.output ? Number(usage.input) + Number(usage.output) : undefined,
    usage?.inputTokens && usage?.outputTokens ? Number(usage.inputTokens) + Number(usage.outputTokens) : undefined,
    usage?.promptTokens && usage?.completionTokens ? Number(usage.promptTokens) + Number(usage.completionTokens) : undefined,
  ];
  return candidates
    .map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN)
    .find((value) => Number.isFinite(value) && value > 0);
}
