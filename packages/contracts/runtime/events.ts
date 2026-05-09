import type { RuntimeArtifact } from './artifacts';
import type { AgentCompactCapability, AgentContextCompaction, AgentContextWindowSource, AgentContextWindowState, AgentStreamEvent } from './stream';
import type { RuntimeExecutionUnit } from './execution';
import type { GuidanceQueueRecord } from './messages';
import type { ObjectReference } from './references';

export type BackgroundCompletionEventType =
  | 'background-initial-response'
  | 'background-stage-update'
  | 'background-finalization';

export type BackgroundCompletionStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface BackgroundCompletionRef {
  ref: string;
  kind: 'run' | 'stage' | 'message' | 'artifact' | 'execution-unit' | 'verification' | 'work-evidence' | 'file' | 'url';
  runId: string;
  stageId?: string;
  title?: string;
}

export interface BackgroundCompletionRuntimeEvent {
  contract: 'sciforge.background-completion.v1';
  type: BackgroundCompletionEventType;
  runId: string;
  stageId?: string;
  ref?: string;
  status: BackgroundCompletionStatus;
  prompt?: string;
  message?: string;
  finalResponse?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  cancellationReason?: string;
  failureReason?: string;
  recoverActions?: string[];
  nextStep?: string;
  refs?: BackgroundCompletionRef[];
  artifacts?: RuntimeArtifact[];
  executionUnits?: RuntimeExecutionUnit[];
  verificationResults?: Array<Record<string, unknown>>;
  workEvidence?: Array<Record<string, unknown>>;
  objectReferences?: ObjectReference[];
  raw?: unknown;
}

export const WORKSPACE_RUNTIME_EVENT_TYPE = 'workspace-runtime-event';
export const PROJECT_TOOL_STARTED_EVENT_TYPE = 'project-tool-start';
export const PROJECT_TOOL_DONE_EVENT_TYPE = 'project-tool-done';
export const PROJECT_TOOL_FAILED_EVENT_TYPE = 'project-tool-failed';
export const TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE = 'target-issue-lookup-failed';
export const TARGET_ISSUE_READ_EVENT_TYPE = 'target-issue-read';
export const TARGET_INSTANCE_CONTEXT_EVENT_TYPE = 'target-instance-context';
export const TARGET_WORKTREE_PREPARING_EVENT_TYPE = 'target-worktree-preparing';
export const TARGET_REPAIR_MODIFYING_EVENT_TYPE = 'target-repair-modifying';
export const TARGET_REPAIR_TESTING_EVENT_TYPE = 'target-repair-testing';
export const TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE = 'target-repair-written-back';
export const DEFAULT_WORKSPACE_EVENT_TYPE = 'runtime-event' as const;
export const TEXT_DELTA_EVENT_TYPE = 'text-delta' as const;
export const CONTEXT_COMPACTION_EVENT_TYPE = 'contextCompaction' as const;
export const CONTEXT_WINDOW_STATE_EVENT_TYPE = 'contextWindowState' as const;
export const RATE_LIMIT_EVENT_TYPE = 'rateLimit' as const;
export const BACKEND_EVENT_TYPE = 'backend-event' as const;
export const AGENTSERVER_EVENT_TYPE_PREFIX = 'agentserver-' as const;
export const PROCESS_PROGRESS_EVENT_TYPE = 'process-progress' as const;
export const GUIDANCE_QUEUED_EVENT_TYPE = 'guidance-queued' as const;
export const USER_INTERRUPT_EVENT_TYPE = 'user-interrupt' as const;
export const GUIDANCE_QUEUE_RUN_ORCHESTRATION_CONTRACT = 'guidance-queue/run-orchestration' as const;
export const PROCESS_EVENTS_SCHEMA_VERSION = 'sciforge.process-events.v1' as const;
export const LATENCY_DIAGNOSTICS_SCHEMA_VERSION = 'sciforge.latency-diagnostics.v1' as const;
export const LATENCY_DIAGNOSTICS_EVENT_TYPE = 'latency-diagnostics' as const;
export const LATENCY_DIAGNOSTICS_REF = 'runtime://latency-diagnostics' as const;
export const LATENCY_DIAGNOSTICS_LOG_KIND = 'latency-diagnostics' as const;
export const WORKSPACE_RUNTIME_SOURCE = 'workspace-runtime' as const;
export const SCIFORGE_RUNTIME_PROVIDER = 'sciforge-runtime' as const;
export const CONVERSATION_POLICY_EVENT_TYPE = 'conversation-policy' as const;
export const AGENTSERVER_CONTEXT_WINDOW_STATE_EVENT_TYPE = 'agentserver-context-window-state' as const;
export const GATEWAY_REQUEST_RECEIVED_EVENT_TYPE = 'gateway-request-received' as const;
export const CONVERSATION_POLICY_STARTED_EVENT_TYPE = 'conversation-policy-started' as const;
export const DIRECT_CONTEXT_FAST_PATH_EVENT_TYPE = 'direct-context-fast-path' as const;
export const WORKSPACE_SKILL_SELECTED_EVENT_TYPE = 'workspace-skill-selected' as const;
export const REPAIR_ATTEMPT_START_EVENT_TYPE = 'repair-attempt-start' as const;
export const REPAIR_ATTEMPT_RESULT_EVENT_TYPE = 'repair-attempt-result' as const;
export const AGENTSERVER_DISPATCH_EVENT_TYPE = 'agentserver-dispatch' as const;
export const AGENTSERVER_CONVERGENCE_GUARD_EVENT_TYPE = 'agentserver-convergence-guard' as const;
export const AGENTSERVER_SILENT_STREAM_GUARD_EVENT_TYPE = 'agentserver-silent-stream-guard' as const;
export const AGENTSERVER_CONTEXT_WINDOW_RECOVERY_EVENT_TYPE = 'agentserver-context-window-recovery' as const;
export const AGENTSERVER_GENERATION_RETRY_EVENT_TYPE = 'agentserver-generation-retry' as const;
export const AGENTSERVER_GENERATION_RETRY_SCHEMA_VERSION = 'sciforge.agentserver-generation-retry.v1' as const;

export const LATENCY_DIAGNOSTICS_CACHE_POLICY_KEYS = [
  'reuseScenarioPlan',
  'reuseSkillPlan',
  'reuseUiPlan',
  'reuseReferenceDigests',
  'reuseArtifactIndex',
  'reuseLastSuccessfulStage',
  'reuseBackendSession',
] as const;

export const USER_VISIBLE_EVENT_EXCLUSION_TYPES = [
  LATENCY_DIAGNOSTICS_EVENT_TYPE,
  CONVERSATION_POLICY_EVENT_TYPE,
  CONTEXT_WINDOW_STATE_EVENT_TYPE,
] as const;

export type WorkspaceRuntimeCompletionStatus = 'completed' | 'failed';
export type ProjectToolEventType =
  | typeof PROJECT_TOOL_STARTED_EVENT_TYPE
  | typeof PROJECT_TOOL_DONE_EVENT_TYPE
  | typeof PROJECT_TOOL_FAILED_EVENT_TYPE;
export type TargetIssueEventType =
  | typeof TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE
  | typeof TARGET_ISSUE_READ_EVENT_TYPE
  | typeof TARGET_INSTANCE_CONTEXT_EVENT_TYPE
  | typeof TARGET_WORKTREE_PREPARING_EVENT_TYPE
  | typeof TARGET_REPAIR_MODIFYING_EVENT_TYPE
  | typeof TARGET_REPAIR_TESTING_EVENT_TYPE
  | typeof TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE;

export interface WorkspaceRuntimeResultCompletion {
  status: WorkspaceRuntimeCompletionStatus;
  reason?: string;
}

export interface RuntimeEventIdentity {
  id: string;
  createdAt: string;
}

export interface WorkspaceRuntimePolicyEvent {
  type: string;
  message?: string;
  detail?: string;
  status?: string;
  source?: string;
  raw?: unknown;
}

export interface RuntimeRequestAcceptedProgressCopy {
  detail: string;
  waitingFor: string;
  nextStep: string;
  reason: string;
}

const BLOCKING_RUNTIME_STATUSES = new Set(['repair-needed', 'failed-with-reason', 'failed']);
const SUCCESSFUL_RUNTIME_STATUSES = new Set(['done', 'record-only', 'self-healed', 'completed', 'success']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizedStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function workspaceRuntimeResultCompletion(result: Record<string, unknown>): WorkspaceRuntimeResultCompletion {
  const failure = firstBlockingRuntimeResultReason(result);
  return failure ? { status: 'failed', reason: failure } : { status: 'completed' };
}

export function normalizeRuntimeWorkspaceEventType(type: string, record: Record<string, unknown>) {
  const lower = type.toLowerCase();
  if (lower === 'text_delta' || lower === 'token_delta' || lower === 'content_delta') return TEXT_DELTA_EVENT_TYPE;
  if (lower === 'context_compressor' || lower === 'context-compressor') return CONTEXT_COMPACTION_EVENT_TYPE;
  if (lower === 'ratelimit' || lower === 'rate_limit' || lower === 'rate-limit') return RATE_LIMIT_EVENT_TYPE;
  if (lower.includes('context_compressor') || record.context_compressor || record.contextCompressor) return CONTEXT_COMPACTION_EVENT_TYPE;
  if (lower.includes('rate-limit') || lower.includes('rate_limit') || record.rate_limit || record.rateLimit || record.rate_limit_reset || record.rate_limit_reset_at) return RATE_LIMIT_EVENT_TYPE;
  return type;
}

export function runtimeEventIsUserVisible(event: {
  type: string;
  text?: unknown;
  output?: unknown;
  message?: unknown;
}) {
  if ((USER_VISIBLE_EVENT_EXCLUSION_TYPES as readonly string[]).includes(event.type)) return false;
  if (event.text || event.output) return true;
  return Boolean(event.message);
}

export function runtimeEventIsBackend(event: {
  type: string;
  source?: unknown;
}) {
  if (typeof event.source === 'string' && event.source && event.source !== WORKSPACE_RUNTIME_SOURCE) return true;
  return event.type.startsWith(AGENTSERVER_EVENT_TYPE_PREFIX) || event.type === BACKEND_EVENT_TYPE;
}

export function latencyDiagnosticsCachePolicy(policy: Record<string, unknown>) {
  const hits: string[] = [];
  const misses: string[] = [];
  for (const key of LATENCY_DIAGNOSTICS_CACHE_POLICY_KEYS) {
    if (policy[key] === true) hits.push(key);
    else if (policy[key] === false) misses.push(key);
  }
  return { hits, misses };
}

export function compactRuntimePromptSummary(prompt: string, limit = 160) {
  return prompt.replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function runtimeRequestAcceptedProgressCopy(prompt: string): RuntimeRequestAcceptedProgressCopy {
  const compactPrompt = compactRuntimePromptSummary(prompt);
  return {
    detail: compactPrompt
      ? `正在把本轮请求交给 workspace runtime：${compactPrompt}`
      : '正在把本轮请求交给 workspace runtime。',
    waitingFor: 'workspace runtime 首个事件',
    nextStep: '收到后端事件后继续展示读取、执行、写入和验证进展。',
    reason: 'request-accepted-before-backend-stream',
  };
}

export function gatewayRequestReceivedEvent(skillDomain: string): WorkspaceRuntimePolicyEvent {
  return {
    type: GATEWAY_REQUEST_RECEIVED_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'running',
    message: 'Workspace runtime received the chat turn and is preparing policy and execution routing.',
    detail: skillDomain,
  };
}

export function conversationPolicyStartedEvent(): WorkspaceRuntimePolicyEvent {
  return {
    type: CONVERSATION_POLICY_STARTED_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'running',
    message: 'Starting Python conversation policy.',
    detail: 'Selecting memory, latency, recovery, and execution plans before dispatch.',
  };
}

export function directContextFastPathEvent(raw: unknown): WorkspaceRuntimePolicyEvent {
  return {
    type: DIRECT_CONTEXT_FAST_PATH_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'completed',
    message: 'Python policy selected direct-context-answer; answered from existing session context without starting a workspace task.',
    raw,
  };
}

export function workspaceSkillSelectedEvent(input: {
  skillId: string;
  skillDomain: string;
  entrypointType?: string;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: WORKSPACE_SKILL_SELECTED_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    message: `Selected skill ${input.skillId} for ${input.skillDomain}`,
    detail: input.entrypointType,
  };
}

export function repairAttemptStartEvent(input: {
  attempt: number;
  maxAttempts: number;
  failureReason: string;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: REPAIR_ATTEMPT_START_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'running',
    message: `AgentServer repair attempt ${input.attempt}/${input.maxAttempts}`,
    detail: input.failureReason,
  };
}

export function repairAttemptResultEvent(input: {
  attempt: number;
  maxAttempts: number;
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: REPAIR_ATTEMPT_RESULT_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: input.exitCode === 0 ? 'completed' : 'failed',
    message: `AgentServer repair attempt ${input.attempt}/${input.maxAttempts} rerun exited ${input.exitCode}`,
    detail: [input.stdout?.slice(0, 1000), input.stderr?.slice(0, 1000)].filter(Boolean).join('\n'),
  };
}

export function agentServerDispatchEvent(input: {
  backend: string;
  baseUrl: string;
  normalizedBytes: number;
  maxPayloadBytes: number;
  rawRef: string;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: AGENTSERVER_DISPATCH_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    message: `Dispatching to AgentServer ${input.backend}`,
    detail: `${input.baseUrl} · handoff ${input.normalizedBytes}/${input.maxPayloadBytes} bytes · raw ${input.rawRef}`,
  };
}

export function agentServerConvergenceGuardEvent(message: string): WorkspaceRuntimePolicyEvent {
  return {
    type: AGENTSERVER_CONVERGENCE_GUARD_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'failed-with-reason',
    message,
    detail: 'Current-reference digests are already available; SciForge will recover from bounded refs instead of letting the backend replay large files indefinitely.',
  };
}

export function agentServerSilentStreamGuardEvent(message: string): WorkspaceRuntimePolicyEvent {
  return {
    type: AGENTSERVER_SILENT_STREAM_GUARD_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'failed-with-reason',
    message,
    detail: 'Current-reference digests are already available; SciForge will recover from bounded refs instead of waiting on a silent backend stream indefinitely.',
  };
}

export function agentServerContextWindowRecoveryStartEvent(input: {
  detail: string;
  raw: unknown;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: AGENTSERVER_CONTEXT_WINDOW_RECOVERY_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'running',
    message: 'AgentServer reported context window exceeded; compacting context before one retry.',
    detail: input.detail,
    raw: input.raw,
  };
}

export function agentServerGenerationRecoveryEventType(categories: readonly unknown[]) {
  return categories.includes('context-window')
    ? AGENTSERVER_CONTEXT_WINDOW_RECOVERY_EVENT_TYPE
    : AGENTSERVER_GENERATION_RETRY_EVENT_TYPE;
}

export function agentServerGenerationRecoveryStartEvent(input: {
  categories: readonly unknown[];
  detail: string;
  raw: unknown;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: agentServerGenerationRecoveryEventType(input.categories),
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'running',
    message: 'AgentServer provider/rate-limit recovery: compacting context and retrying once.',
    detail: input.detail,
    raw: input.raw,
  };
}

export function agentServerContextWindowRecoverySucceededEvent(input: {
  detail?: string;
  raw: unknown;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: AGENTSERVER_CONTEXT_WINDOW_RECOVERY_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'completed',
    message: 'AgentServer generation succeeded after context compaction retry.',
    detail: input.detail,
    raw: input.raw,
  };
}

export function agentServerGenerationRetrySucceededEvent(input: {
  detail: string;
  raw: unknown;
}): WorkspaceRuntimePolicyEvent {
  return {
    type: AGENTSERVER_GENERATION_RETRY_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'completed',
    message: 'AgentServer provider/rate-limit recovery succeeded after one compact retry.',
    detail: input.detail,
    raw: input.raw,
  };
}

export function firstBlockingRuntimeResultReason(result: Record<string, unknown>): string | undefined {
  const units = arrayRecords(result.executionUnits);
  for (const unit of units) {
    const status = normalizedStatus(unit.status);
    if (BLOCKING_RUNTIME_STATUSES.has(status)) {
      return asString(unit.failureReason)
        || asString(unit.message)
        || `${asString(unit.id) || 'execution unit'} status=${status}`;
    }
  }

  const artifacts = arrayRecords(result.artifacts);
  for (const artifact of artifacts) {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    const status = normalizedStatus(metadata.status || data.status);
    if (BLOCKING_RUNTIME_STATUSES.has(status)) {
      return asString(metadata.failureReason)
        || asString(data.failureReason)
        || `${asString(artifact.id) || asString(artifact.type) || 'artifact'} status=${status}`;
    }
  }

  const message = asString(result.message);
  if (message && runtimeMessageCarriesBlockingResult(message, units, artifacts)) return message.slice(0, 240);
  return undefined;
}

function runtimeMessageCarriesBlockingResult(
  message: string,
  units: Record<string, unknown>[],
  artifacts: Record<string, unknown>[],
) {
  if (!/\b(?:repair-needed|failed-with-reason)\b/i.test(message)) return false;
  if (/^\s*(?:repair-needed|failed-with-reason|failed)\s*$/i.test(message)) return true;
  if (looksLikeBlockingRuntimeDiagnosticMessage(message)) return true;
  return !hasSuccessfulRuntimeResultEvidence(units, artifacts);
}

function looksLikeBlockingRuntimeDiagnosticMessage(message: string) {
  return /^(?:SciForge runtime gateway needs repair|Agent backend .* failed|AgentServer .* failed|No validated local skill|Task output failed|AgentServer .* did not|Generated artifacts did not)/i.test(message)
    || /\b(?:execution unit|artifact|[a-z0-9][a-z0-9._-]*)\s+status=(?:repair-needed|failed-with-reason|failed)\b/i.test(message);
}

function hasSuccessfulRuntimeResultEvidence(units: Record<string, unknown>[], artifacts: Record<string, unknown>[]) {
  const hasCompletedUnit = units.some((unit) => SUCCESSFUL_RUNTIME_STATUSES.has(normalizedStatus(unit.status)));
  const hasUsableArtifact = artifacts.some((artifact) => {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    const status = normalizedStatus(metadata.status || data.status);
    return !BLOCKING_RUNTIME_STATUSES.has(status)
      && Boolean(asString(artifact.id) || asString(artifact.type));
  });
  return hasCompletedUnit || hasUsableArtifact;
}

export function normalizeRuntimeContextWindowSource(value?: string): AgentContextWindowSource {
  if (value === 'native' || value === 'provider-usage' || value === 'agentserver-estimate' || value === 'agentserver' || value === 'estimate' || value === 'unknown') return value;
  if (value === 'usage' || value === 'provider') return 'provider-usage';
  if (value === 'backend') return 'native';
  if (value === 'handoff') return 'agentserver-estimate';
  return 'unknown';
}

export function normalizeRuntimeCompactCapability(value?: string): AgentCompactCapability {
  if (value === 'native' || value === 'agentserver' || value === 'handoff-only' || value === 'handoff-slimming' || value === 'session-rotate' || value === 'none' || value === 'unknown') return value;
  return 'unknown';
}

export function compactCapabilityForBackend(backend: string): AgentCompactCapability {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-only';
  return 'unknown';
}

export function normalizeRuntimeContextWindowStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<AgentContextWindowState['status']> {
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82) && (!value || value === 'healthy' || value === 'ok' || value === 'normal')) return 'near-limit';
  if (value === 'healthy' || value === 'watch' || value === 'near-limit' || value === 'exceeded' || value === 'compacting' || value === 'blocked' || value === 'unknown') return value;
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /compact/i.test(value)) return 'compacting';
  if (value && /blocked|rate/i.test(value)) return 'blocked';
  if (value && /near|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

export function normalizeRuntimeContextCompactionStatus(
  value?: string,
  inferred: { ok?: boolean; completedAt?: string; lastCompactedAt?: string; message?: string } = {},
): AgentContextCompaction['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value === 'compacted') return 'completed';
  if (value === 'unsupported') return 'skipped';
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /skip|unsupported|handoff/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compact(ed)?|compressed/i.test(value)) return 'completed';
  if (inferred.ok === true || inferred.completedAt || inferred.lastCompactedAt || (inferred.message && /complete|done|success|compact(ed)?|compressed|完成/i.test(inferred.message))) return 'completed';
  if (inferred.ok === false || (inferred.message && /fail|error|失败|未完成/i.test(inferred.message))) return 'failed';
  return 'pending';
}

export function runtimeStreamEventLabel(type: string, source?: string, toolName?: string) {
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE) return '上下文窗口';
  if (type === CONTEXT_COMPACTION_EVENT_TYPE) return '上下文压缩';
  if (type === 'run-plan') return '计划';
  if (type === 'stage-start') return '阶段';
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return '过程';
  if (type === TEXT_DELTA_EVENT_TYPE) return '思考';
  if (type === 'tool-call') return toolName ? `调用 ${toolName}` : '工具调用';
  if (type === 'tool-result') return toolName ? `结果 ${toolName}` : '工具结果';
  if (type === 'status') return source === 'agentserver' ? 'AgentServer 状态' : '运行状态';
  if (type.includes('error')) return '错误';
  if (type.includes('silent')) return '等待';
  return source === 'agentserver' ? 'AgentServer' : 'Workspace Runtime';
}

export function runtimeDetailIndicatesAbort(detail: string) {
  return /cancel|abort|已取消|cancelled|canceled/i.test(detail);
}

export function projectToolFailureDetail(detail: string) {
  return `SciForge project tool unavailable: ${detail}`;
}

export function projectToolStartDetail(scenarioId: string) {
  return `SciForge ${scenarioId} project tool started`;
}

export function projectToolDoneDetail(scenarioId: string, completion: WorkspaceRuntimeResultCompletion) {
  return completion.status === 'failed'
    ? `SciForge ${scenarioId} 未完成：${completion.reason ?? '后台返回 repair-needed/failed-with-reason 诊断，未产出用户要求的最终结果。'}`
    : `SciForge ${scenarioId} project tool completed`;
}

export function projectToolEvent(
  identity: RuntimeEventIdentity,
  type: ProjectToolEventType,
  detail: string,
): AgentStreamEvent {
  return {
    id: identity.id,
    type,
    label: '项目工具',
    detail,
    createdAt: identity.createdAt,
    raw: { type, detail },
  };
}

export function projectToolStartedEvent(identity: RuntimeEventIdentity, scenarioId: string): AgentStreamEvent {
  return projectToolEvent(identity, PROJECT_TOOL_STARTED_EVENT_TYPE, projectToolStartDetail(scenarioId));
}

export function projectToolDoneEvent(
  identity: RuntimeEventIdentity,
  scenarioId: string,
  completion: WorkspaceRuntimeResultCompletion,
): AgentStreamEvent {
  return projectToolEvent(identity, PROJECT_TOOL_DONE_EVENT_TYPE, projectToolDoneDetail(scenarioId, completion));
}

export function projectToolFailedEvent(identity: RuntimeEventIdentity, detail: string): AgentStreamEvent {
  const eventDetail = projectToolFailureDetail(detail);
  return {
    ...projectToolEvent(identity, PROJECT_TOOL_FAILED_EVENT_TYPE, eventDetail),
    raw: { error: detail },
  };
}

export function guidanceQueuedEvent(identity: RuntimeEventIdentity, guidance: GuidanceQueueRecord): AgentStreamEvent {
  return {
    id: identity.id,
    type: GUIDANCE_QUEUED_EVENT_TYPE,
    label: '引导已排队',
    detail: `${guidance.prompt}\n状态：已排队，等待当前 run 结束后合并到下一轮。`,
    createdAt: identity.createdAt,
    raw: {
      guidanceQueue: guidance,
      contract: GUIDANCE_QUEUE_RUN_ORCHESTRATION_CONTRACT,
    },
  };
}

export function userInterruptEvent(identity: RuntimeEventIdentity): AgentStreamEvent {
  return {
    id: identity.id,
    type: USER_INTERRUPT_EVENT_TYPE,
    label: '中断请求',
    detail: '用户请求中断当前 backend 运行；已关闭当前 HTTP stream，并清空排队引导。',
    createdAt: identity.createdAt,
  };
}

export function targetIssueLookupFailedEvent(
  identity: RuntimeEventIdentity,
  detail: string,
  raw?: unknown,
): AgentStreamEvent {
  return {
    id: identity.id,
    type: TARGET_ISSUE_LOOKUP_FAILED_EVENT_TYPE,
    label: '目标 issue',
    detail,
    createdAt: identity.createdAt,
    raw,
  };
}

export function targetIssueReadEvent(
  identity: RuntimeEventIdentity,
  input: { peerName: string; issueId?: string; raw?: unknown },
): AgentStreamEvent {
  return {
    id: identity.id,
    type: TARGET_ISSUE_READ_EVENT_TYPE,
    label: '已读取 B issue',
    detail: `已从 ${input.peerName} 读取 issue bundle ${input.issueId ?? ''}。`,
    createdAt: identity.createdAt,
    raw: input.raw,
  };
}

export function targetInstanceContextEvent(
  identity: RuntimeEventIdentity,
  input: { peerName: string; summaryCount?: number; banner: string; raw?: unknown },
): AgentStreamEvent {
  return {
    id: identity.id,
    type: TARGET_INSTANCE_CONTEXT_EVENT_TYPE,
    label: '目标实例',
    detail: input.summaryCount !== undefined
      ? `已从 ${input.peerName} 读取 ${input.summaryCount} 条 issue 摘要。`
      : input.banner,
    createdAt: identity.createdAt,
    raw: input.raw,
  };
}

export function targetWorktreePreparingEvent(
  identity: RuntimeEventIdentity,
  input: TargetRepairStageEventInput,
): AgentStreamEvent {
  return targetRepairStageEvent(identity, TARGET_WORKTREE_PREPARING_EVENT_TYPE, '正在准备 B worktree', input);
}

export function targetRepairModifyingEvent(
  identity: RuntimeEventIdentity,
  input: TargetRepairStageEventInput,
): AgentStreamEvent {
  return targetRepairStageEvent(identity, TARGET_REPAIR_MODIFYING_EVENT_TYPE, '正在修改 B', input);
}

export function targetRepairTestingEvent(
  identity: RuntimeEventIdentity,
  input: TargetRepairStageEventInput,
): AgentStreamEvent {
  return targetRepairStageEvent(identity, TARGET_REPAIR_TESTING_EVENT_TYPE, '正在测试', input);
}

export function targetRepairWrittenBackEvent(
  identity: RuntimeEventIdentity,
  input: TargetRepairStageEventInput,
): AgentStreamEvent {
  return targetRepairStageEvent(identity, TARGET_REPAIR_WRITTEN_BACK_EVENT_TYPE, '已写回 B', input);
}

interface TargetRepairStageEventInput {
  targetName: string;
  issueRef?: string;
  targetInstance?: unknown;
  issueId?: string;
}

function targetRepairStageEvent(
  identity: RuntimeEventIdentity,
  type: TargetIssueEventType,
  label: string,
  input: TargetRepairStageEventInput,
): AgentStreamEvent {
  return {
    id: identity.id,
    type,
    label,
    detail: `${label}：${input.targetName} / ${input.issueRef ?? ''}`,
    createdAt: identity.createdAt,
    raw: {
      targetInstance: input.targetInstance,
      issueId: input.issueId,
      executionBoundary: 'repair-handoff-runner-target-worktree',
    },
  };
}
