import type { RuntimeArtifact } from './artifacts';
import type { AgentCompactCapability, AgentContextCompaction, AgentContextWindowSource, AgentContextWindowState, AgentStreamEvent } from './stream';
import type { RuntimeExecutionUnit } from './execution';
import type { GuidanceQueueRecord, RunStatus } from './messages';
import type { ObjectReference } from './references';

export type BackgroundCompletionEventType =
  | 'background-initial-response'
  | 'background-stage-update'
  | 'background-finalization';

export type BackgroundCompletionStatus = 'running' | 'completed' | 'failed' | 'cancelled';
export type RunTerminationReason = 'user-cancelled' | 'system-aborted' | 'timeout' | 'backend-error';
export type RunTerminationActor = 'user' | 'system' | 'backend';
export type SilentStreamDecisionLayer = 'backend-stream' | 'transport-watchdog' | 'ui-progress';

export interface RunTerminationRecord {
  schemaVersion: 'sciforge.run-termination.v1';
  reason: RunTerminationReason;
  actor: RunTerminationActor;
  progressStatus: 'cancelled' | 'failed';
  runState: 'cancelled' | 'failed';
  sessionStatus: Extract<RunStatus, 'cancelled' | 'failed'>;
  retryable: boolean;
  detail?: string;
}

export interface RunTerminationNormalizationInput {
  cancellationReason?: string;
  detail?: string;
  userRequested?: boolean;
  aborted?: boolean;
  timedOut?: boolean;
  backendError?: boolean;
}

export const SILENT_STREAM_DECISION_SCHEMA_VERSION = 'sciforge.silent-stream-decision.v1' as const;

export interface SilentStreamDecisionRecord {
  schemaVersion: typeof SILENT_STREAM_DECISION_SCHEMA_VERSION;
  decisionId: string;
  runId: string;
  source: string;
  layers: SilentStreamDecisionLayer[];
  decision: string;
  timeoutMs?: number;
  elapsedMs?: number;
  status?: string;
  retryCount?: number;
  maxRetries?: number;
  termination: RunTerminationRecord;
  detail?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SilentStreamRunIdInput {
  runId?: string;
  sessionId?: string;
  prompt?: string;
}

export interface SilentStreamDecisionRecordInput extends SilentStreamRunIdInput {
  source: string;
  layer: SilentStreamDecisionLayer;
  decision?: string;
  timeoutMs?: number;
  elapsedMs?: number;
  status?: string;
  retryCount?: number;
  maxRetries?: number;
  detail?: string;
  createdAt?: string;
  existing?: unknown;
}

export const BACKGROUND_COMPLETION_CONTRACT_ID = 'sciforge.background-completion.v1' as const;
export const BACKGROUND_COMPLETION_TOOL_ID = 'sciforge.background-completion' as const;
export const ACCEPTANCE_REPAIR_RERUN_TOOL_ID = 'sciforge.acceptance-repair-rerun' as const;

export interface BackgroundCompletionRef {
  ref: string;
  kind: 'run' | 'stage' | 'message' | 'artifact' | 'execution-unit' | 'verification' | 'work-evidence' | 'file' | 'url';
  runId: string;
  stageId?: string;
  title?: string;
}

export interface BackgroundCompletionRuntimeEvent {
  contract: typeof BACKGROUND_COMPLETION_CONTRACT_ID;
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
export const OUTPUT_EVENT_TYPE = 'output' as const;
export const TOOL_CALL_EVENT_TYPE = 'tool-call' as const;
export const TOOL_RESULT_EVENT_TYPE = 'tool-result' as const;
export const RUN_PLAN_EVENT_TYPE = 'run-plan' as const;
export const STAGE_START_EVENT_TYPE = 'stage-start' as const;
export const USAGE_UPDATE_EVENT_TYPE = 'usage-update' as const;
export const CONTEXT_COMPACTION_EVENT_TYPE = 'contextCompaction' as const;
export const CONTEXT_WINDOW_STATE_EVENT_TYPE = 'contextWindowState' as const;
export const RATE_LIMIT_EVENT_TYPE = 'rateLimit' as const;
export const BACKEND_EVENT_TYPE = 'backend-event' as const;
export const AGENTSERVER_EVENT_TYPE_PREFIX = 'agentserver-' as const;
export const PROCESS_PROGRESS_EVENT_TYPE = 'process-progress' as const;
export const INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION = 'sciforge.interaction-progress-event.v1' as const;
export const INTERACTION_REQUEST_EVENT_TYPE = 'interaction-request' as const;
export const CLARIFICATION_NEEDED_EVENT_TYPE = 'clarification-needed' as const;
export const HUMAN_APPROVAL_REQUIRED_EVENT_TYPE = 'human-approval-required' as const;
export const GUIDANCE_QUEUED_EVENT_TYPE = 'guidance-queued' as const;
export const RUN_CANCELLED_EVENT_TYPE = 'run-cancelled' as const;
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

export const PROCESS_PROGRESS_PHASE = {
  READ: 'read',
  WRITE: 'write',
  EXECUTE: 'execute',
  WAIT: 'wait',
  PLAN: 'plan',
  COMPLETE: 'complete',
  ERROR: 'error',
  OBSERVE: 'observe',
} as const;

export const PROCESS_PROGRESS_PHASES = Object.values(PROCESS_PROGRESS_PHASE);

export const PROCESS_PROGRESS_STATUS = {
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const PROCESS_PROGRESS_STATUSES = Object.values(PROCESS_PROGRESS_STATUS);

export const PROCESS_PROGRESS_REASON = {
  BACKEND_WAITING: 'backend-waiting',
  REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM: 'request-accepted-before-backend-stream',
} as const;

export const RUNTIME_HEALTH_STATUS = {
  CHECKING: 'checking',
  ONLINE: 'online',
  OFFLINE: 'offline',
  OPTIONAL: 'optional',
  NOT_CONFIGURED: 'not-configured',
} as const;

export const RUNTIME_HEALTH_STATUSES = Object.values(RUNTIME_HEALTH_STATUS);

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

export const STREAM_EVENT_TYPE = {
  TEXT_DELTA: TEXT_DELTA_EVENT_TYPE,
  OUTPUT: OUTPUT_EVENT_TYPE,
  TOOL_CALL: TOOL_CALL_EVENT_TYPE,
  TOOL_RESULT: TOOL_RESULT_EVENT_TYPE,
  RUN_PLAN: RUN_PLAN_EVENT_TYPE,
  STAGE_START: STAGE_START_EVENT_TYPE,
  USAGE_UPDATE: USAGE_UPDATE_EVENT_TYPE,
  PROCESS_PROGRESS: PROCESS_PROGRESS_EVENT_TYPE,
} as const;

export const STREAM_EVENT_TYPES = Object.values(STREAM_EVENT_TYPE);

export type WorkspaceRuntimeCompletionStatus = 'completed' | 'failed';
export type RuntimeStreamEventType = typeof STREAM_EVENT_TYPE[keyof typeof STREAM_EVENT_TYPE];
export type ProcessProgressPhase = typeof PROCESS_PROGRESS_PHASE[keyof typeof PROCESS_PROGRESS_PHASE];
export type ProcessProgressReason = typeof PROCESS_PROGRESS_REASON[keyof typeof PROCESS_PROGRESS_REASON];
export type ProcessProgressStatus = typeof PROCESS_PROGRESS_STATUS[keyof typeof PROCESS_PROGRESS_STATUS];
export type RuntimeInteractionProgressEventType =
  | typeof PROCESS_PROGRESS_EVENT_TYPE
  | typeof INTERACTION_REQUEST_EVENT_TYPE
  | typeof CLARIFICATION_NEEDED_EVENT_TYPE
  | typeof HUMAN_APPROVAL_REQUIRED_EVENT_TYPE
  | typeof GUIDANCE_QUEUED_EVENT_TYPE
  | typeof RUN_CANCELLED_EVENT_TYPE;
export type RuntimeInteractionProgressStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type RuntimeInteractionProgressImportance = 'low' | 'normal' | 'high' | 'blocking';
export type RuntimeInteractionKind = 'clarification' | 'human-approval' | 'guidance' | string;
export type RuntimeHealthStatus = typeof RUNTIME_HEALTH_STATUS[keyof typeof RUNTIME_HEALTH_STATUS];
export type RuntimeWorkEventKind =
  | 'plan'
  | 'explore'
  | 'search'
  | 'fetch'
  | 'analyze'
  | 'read'
  | 'write'
  | 'command'
  | 'wait'
  | 'validate'
  | 'emit'
  | 'artifact'
  | 'recover'
  | 'diagnostic'
  | 'message'
  | 'other';
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
  reason: typeof PROCESS_PROGRESS_REASON.REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM;
}

export interface ProcessProgressModel {
  phase: ProcessProgressPhase;
  title: string;
  detail: string;
  reading: string[];
  writing: string[];
  waitingFor?: string;
  nextStep?: string;
  lastEvent?: {
    label: string;
    detail: string;
    createdAt?: string;
  };
  reason?: ProcessProgressReason | string;
  recoveryHint?: string;
  canAbort?: boolean;
  canContinue?: boolean;
  status: ProcessProgressStatus;
}

export interface RuntimeInteractionRequest {
  id?: string;
  kind: RuntimeInteractionKind;
  required?: boolean;
}

export interface RuntimeInteractionProgressBudget {
  elapsedMs?: number;
  remainingMs?: number;
  retryCount?: number;
  maxRetries?: number;
  maxWallMs?: number;
}

export interface RuntimeInteractionProgressEvent {
  schemaVersion: typeof INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION;
  type: RuntimeInteractionProgressEventType;
  runState?: string;
  requestId?: string;
  runId?: string;
  traceRef?: string;
  phase?: string;
  status?: RuntimeInteractionProgressStatus;
  importance?: RuntimeInteractionProgressImportance;
  reason?: string;
  cancellationReason?: RunTerminationReason;
  budget?: RuntimeInteractionProgressBudget;
  interaction?: RuntimeInteractionRequest;
  termination?: RunTerminationRecord;
}

export interface RuntimeInteractionProgressPresentation {
  label: string;
  detail: string;
  phase?: string;
  status?: RuntimeInteractionProgressStatus;
  reason?: string;
  interaction?: RuntimeInteractionRequest;
  termination?: RunTerminationRecord;
}

export const STANDARD_INTERACTION_PROGRESS_EVENT_TYPES: readonly RuntimeInteractionProgressEventType[] = [
  PROCESS_PROGRESS_EVENT_TYPE,
  INTERACTION_REQUEST_EVENT_TYPE,
  CLARIFICATION_NEEDED_EVENT_TYPE,
  HUMAN_APPROVAL_REQUIRED_EVENT_TYPE,
  GUIDANCE_QUEUED_EVENT_TYPE,
  RUN_CANCELLED_EVENT_TYPE,
];

export interface RuntimeWorkEventClassificationInput {
  type?: string;
  label?: string;
  toolName?: string;
  detail?: string;
  shortDetail?: string;
  operationKind?: RuntimeWorkEventKind;
  hasContextWindowState?: boolean;
  hasContextCompaction?: boolean;
  hasUsageUpdate?: boolean;
}

export interface RuntimeWorkEventRecordLike {
  kind?: unknown;
  status?: unknown;
  recoverActions?: unknown;
}

export interface RuntimeStageRecordLike extends RuntimeWorkEventRecordLike {
  failure?: unknown;
  workEvidence?: unknown;
}

export type RuntimeToolEventActionKind = 'script-write' | 'command' | 'other';

export const DEFAULT_EMPTY_ARTIFACT_RECOVER_ACTIONS = [
  'run-current-scenario',
  'import-matching-package',
  'inspect-artifact-schema',
] as const;

export type RuntimeRecoverAction = typeof DEFAULT_EMPTY_ARTIFACT_RECOVER_ACTIONS[number] | string;

const RUNTIME_RECOVER_ACTION_LABELS: Record<string, string> = {
  'run-current-scenario': '运行当前场景',
  'rerun-current-scenario': '重试当前运行',
  'import-matching-package': '导入匹配 package',
  'inspect-artifact-schema': '检查 artifact schema',
  'inspect-artifact': '打开 Artifact Inspector',
  'inspect-ui-manifest': '检查 UIManifest',
  'inspect-claims': '检查 claims',
  'inspect-runtime-route': '查看 runtime route',
  'export-diagnostics': '导出诊断包',
  'repair-ui-plan': '修复 UIPlan',
  'create-timeline-event': '创建 timeline event',
  'import-research-bundle': '导入研究 bundle',
};

const BLOCKING_RUNTIME_STATUSES = new Set(['repair-needed', 'failed-with-reason', 'failed']);
const SUCCESSFUL_RUNTIME_STATUSES = new Set(['done', 'record-only', 'self-healed', 'completed', 'success']);
const RUNTIME_WORK_EVENT_FAILED_STATUSES = new Set(['failed', 'blocked', 'repair-needed', 'failed-with-reason']);

const runtimeWorkEventKeywordRules: Array<{ kind: RuntimeWorkEventKind; pattern: RegExp }> = [
  { kind: 'plan', pattern: /current-plan|run-plan|stage-start|plan:|计划|规划/ },
  { kind: 'recover', pattern: /acceptance-repair|repair|recover|retry|fallback|恢复|重试|修复/ },
  { kind: 'validate', pattern: /verifier|validation|validate|acceptance|验收|校验|验证/ },
  { kind: 'write', pattern: /taskfiles|agentservergenerationresponse|write_file|wrote \d+ bytes|\.sciforge\/tasks|生成任务文件|生成脚本|写入脚本|\.(?:py|r|sh|js|ts)\b/ },
  { kind: 'search', pattern: /search|grep|rg\b|检索|搜索/ },
  { kind: 'fetch', pattern: /fetch|curl|wget|download|抓取|下载/ },
  { kind: 'analyze', pattern: /analy[sz]e|analysis|reason|infer|summari[sz]e|compare|统计|分析|推理|总结|比对/ },
  { kind: 'explore', pattern: /explore|browse|list|ls\b|find\b|tree\b|scan|discover|探索|列出|浏览|枚举/ },
  { kind: 'read', pattern: /\bread\b|cat\b|sed\b|open\b|读取|查看/ },
  { kind: 'write', pattern: /write|patch|edit|save|create|写入|编辑|修改/ },
  { kind: 'command', pattern: /run_command|command|python|node|npm|pnpm|yarn|tsx|pytest|bash|执行命令|运行/ },
  { kind: 'wait', pattern: /wait|waiting|silent|等待|stream 仍在等待/ },
  { kind: 'emit', pattern: /emit|final|publish|report|输出|发布|汇总/ },
  { kind: 'artifact', pattern: /artifact|object reference|executionunit|paper-list|evidence-matrix|产物|报告对象/ },
  { kind: 'diagnostic', pattern: /error|failed|failure|blocked|timeout|exception|失败|阻断|超时/ },
];

const runtimeEvidenceKindRules: Array<{ kind: RuntimeWorkEventKind; pattern: RegExp }> = [
  { kind: 'search', pattern: /^(retrieval|search)$/ },
  { kind: 'fetch', pattern: /^fetch$/ },
  { kind: 'read', pattern: /^read$/ },
  { kind: 'validate', pattern: /^(validate|verification)$/ },
  { kind: 'command', pattern: /^command$/ },
  { kind: 'emit', pattern: /^(artifact|emit)$/ },
  { kind: 'analyze', pattern: /^(claim|analysis)$/ },
];

const runtimeStageKindRules: Array<{ kind: RuntimeWorkEventKind; pattern: RegExp }> = [
  { kind: 'search', pattern: /search|retriev|query/ },
  { kind: 'fetch', pattern: /fetch|download|crawl/ },
  { kind: 'validate', pattern: /valid|verify|check|accept/ },
  { kind: 'emit', pattern: /emit|report|final|artifact|publish|output/ },
  { kind: 'analyze', pattern: /analy|summar|reason|compare|compute|stat/ },
];

const runtimeKeyWorkEventTypePattern = /(current-plan|run-plan|stage-start|tool-call|project-tool-start|project-tool-done|repair-start|acceptance-repair|backend-silent|status)/;
const runtimeCompletionEventTypePattern = /(tool-result|result|completed|done)/;
const runtimeCompletionDetailPattern = /failed|repair|blocked|completed|done|成功|失败|修复|中断/i;
const runtimeGeneratedWorkDetailPattern = /(?:taskFiles|entrypoint|write_file|wrote \d+ bytes|cat\s*>\s*.*\.(?:py|js|ts|r|sh)|\.sciforge\/tasks|\/tasks\/|\.py\b|\.R\b|\.sh\b|research-report|paper-list|evidence-matrix|ToolPayload|AgentServerGenerationResponse)/i;
const runtimeScriptWritePattern = /write_file|cat\s*>|wrote \d+ bytes|\.py\b|\.R\b|\.sh\b/i;
const runtimeCommandPattern = /run_command|python3?|bash|sh\s+-lc|npm|pytest|tsx/i;
const runtimeToolFailureOutputPattern = /Traceback|Error|Exception|failed|失败|timeout/i;
const runtimeTaskPayloadMarkerPattern = /taskFiles|AgentServerGenerationResponse/i;
const runtimeTaskPathPattern = /"path"\s*:\s*"([^"]+)"/g;
const runtimeTaskFilePathPattern = /(?:^|\/)tasks\/|\.py$|\.R$|\.sh$|\.js$|\.ts$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function normalizedStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function workspaceRuntimeResultCompletion(result: Record<string, unknown>): WorkspaceRuntimeResultCompletion {
  const failure = firstBlockingRuntimeResultReason(result);
  return failure ? { status: 'failed', reason: failure } : { status: 'completed' };
}

export function classifyRuntimeWorkEventKind(input: RuntimeWorkEventClassificationInput): RuntimeWorkEventKind {
  if (input.hasContextWindowState || input.hasContextCompaction || input.hasUsageUpdate || input.type === USAGE_UPDATE_EVENT_TYPE) return 'diagnostic';
  if (input.operationKind) return input.operationKind;
  const haystack = [
    input.type,
    input.label,
    input.toolName,
    input.detail,
    input.shortDetail,
  ].filter(Boolean).join(' ').toLowerCase();
  for (const rule of runtimeWorkEventKeywordRules) {
    if (rule.pattern.test(haystack)) return rule.kind;
  }
  return input.type === TEXT_DELTA_EVENT_TYPE ? 'message' : 'other';
}

export function runtimeOperationKindForWorkEvidence(evidence: RuntimeWorkEventRecordLike): RuntimeWorkEventKind {
  const kind = normalizedStatus(evidence.kind);
  const status = normalizedStatus(evidence.status);
  if (RUNTIME_WORK_EVENT_FAILED_STATUSES.has(status)) return stringList(evidence.recoverActions).length ? 'recover' : 'diagnostic';
  return runtimeEvidenceKindRules.find((rule) => rule.pattern.test(kind))?.kind ?? 'other';
}

export function runtimeOperationKindForStage(stage: RuntimeStageRecordLike): RuntimeWorkEventKind {
  const status = normalizedStatus(stage.status);
  const failure = isRecord(stage.failure) ? stage.failure : undefined;
  const stageEvidence = arrayRecords(stage.workEvidence).find(isRuntimeWorkEvidenceLike);
  const evidenceStatus = normalizedStatus(stageEvidence?.status);
  if (RUNTIME_WORK_EVENT_FAILED_STATUSES.has(status)) {
    return stringList(failure?.recoverActions).length || stringList(stage.recoverActions).length ? 'recover' : 'diagnostic';
  }
  if (RUNTIME_WORK_EVENT_FAILED_STATUSES.has(evidenceStatus)) {
    return stringList(stageEvidence?.recoverActions).length || stringList(stage.recoverActions).length ? 'recover' : 'diagnostic';
  }
  const kind = normalizedStatus(stage.kind);
  return runtimeStageKindRules.find((rule) => rule.pattern.test(kind))?.kind ?? 'other';
}

export function runtimeStreamEventTypeIsKeyWorkStatus(type: string) {
  return type === GUIDANCE_QUEUED_EVENT_TYPE || runtimeKeyWorkEventTypePattern.test(type);
}

export function runtimeStreamEventTypeIsCompletion(type: string) {
  return runtimeCompletionEventTypePattern.test(type);
}

export function runtimeStreamCompletionDetailIsKey(detail: string) {
  return runtimeCompletionDetailPattern.test(detail);
}

export function runtimeTextLooksLikeGeneratedWorkDetail(value: string) {
  return runtimeGeneratedWorkDetailPattern.test(value);
}

export function runtimeToolEventActionKind(input: { toolName?: string; detail?: string }): RuntimeToolEventActionKind {
  const haystack = `${input.toolName || ''}\n${input.detail || ''}`;
  if (runtimeScriptWritePattern.test(haystack)) return 'script-write';
  if (runtimeCommandPattern.test(haystack)) return 'command';
  return 'other';
}

export function runtimeToolOutputLooksLikeFailure(output: string) {
  return runtimeToolFailureOutputPattern.test(output);
}

export function summarizeRuntimeGeneratedTaskFiles(value: string) {
  if (!runtimeTaskPayloadMarkerPattern.test(value)) return '';
  const paths = Array.from(value.matchAll(runtimeTaskPathPattern))
    .map((match) => match[1])
    .filter((path) => runtimeTaskFilePathPattern.test(path));
  const uniquePaths = Array.from(new Set(paths)).slice(0, 3);
  if (!uniquePaths.length) return '生成任务文件与运行入口。';
  return `生成任务文件：${uniquePaths.join('、')}`;
}

function isRuntimeWorkEvidenceLike(record: Record<string, unknown>) {
  return Boolean(asString(record.kind)) && Boolean(asString(record.status));
}

export function backgroundCompletionContractId() {
  return BACKGROUND_COMPLETION_CONTRACT_ID;
}

export function backgroundCompletionToolId() {
  return BACKGROUND_COMPLETION_TOOL_ID;
}

export function acceptanceRepairRerunToolId() {
  return ACCEPTANCE_REPAIR_RERUN_TOOL_ID;
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
    reason: PROCESS_PROGRESS_REASON.REQUEST_ACCEPTED_BEFORE_BACKEND_STREAM,
  };
}

export function runtimeRecoverActionLabel(action: RuntimeRecoverAction) {
  if (RUNTIME_RECOVER_ACTION_LABELS[action]) return RUNTIME_RECOVER_ACTION_LABELS[action];
  if (action.startsWith('run-skill:')) return `运行 skill ${action.slice('run-skill:'.length)}`;
  if (action.startsWith('inspect-artifact-schema:')) return `检查 ${action.slice('inspect-artifact-schema:'.length)} schema`;
  if (action.startsWith('import-package:')) return `导入 ${action.slice('import-package:'.length)} package`;
  if (action.startsWith('add-field:')) return `补齐字段 ${action.slice('add-field:'.length)}`;
  if (action.startsWith('add-fields:')) return `补齐字段 ${action.slice('add-fields:'.length)}`;
  if (action.startsWith('map-fields:')) return `映射字段 ${action.slice('map-fields:'.length)}`;
  if (action.startsWith('map-array-field:')) return `映射数组字段 ${action.slice('map-array-field:'.length)}`;
  if (action.startsWith('repair-task:')) return `修复任务 ${action.slice('repair-task:'.length)}`;
  return action;
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

export function normalizeRunTermination(input: RunTerminationNormalizationInput = {}): RunTerminationRecord {
  const detail = input.detail?.trim();
  const reason = normalizeRunTerminationReason(input);
  const failed = reason === 'backend-error';
  return {
    schemaVersion: 'sciforge.run-termination.v1',
    reason,
    actor: runTerminationActor(reason),
    progressStatus: failed ? 'failed' : 'cancelled',
    runState: failed ? 'failed' : 'cancelled',
    sessionStatus: reason === 'user-cancelled' ? 'cancelled' : 'failed',
    retryable: reason !== 'user-cancelled',
    ...(detail ? { detail } : {}),
  };
}

export function buildSilentStreamRunId(input: SilentStreamRunIdInput = {}) {
  const explicit = cleanIdentifier(input.runId);
  if (explicit) return explicit;
  const session = cleanIdentifier(input.sessionId) || 'sessionless';
  const promptHash = stableTextHash(input.prompt ?? '');
  return `${session}:turn-${promptHash}`;
}

export function buildSilentStreamDecisionId(input: SilentStreamRunIdInput = {}) {
  return `${buildSilentStreamRunId(input)}:silent-stream`;
}

export function buildSilentStreamDecisionRecord(input: SilentStreamDecisionRecordInput): SilentStreamDecisionRecord {
  const existing = silentStreamDecisionRecordFromUnknown(input.existing);
  const runId = buildSilentStreamRunId({
    runId: input.runId ?? existing?.runId,
    sessionId: input.sessionId,
    prompt: input.prompt,
  });
  const detail = input.detail?.trim() || existing?.detail || 'Silent stream timeout decision.';
  const decision = input.decision ?? existing?.decision ?? 'visible-status';
  return {
    schemaVersion: SILENT_STREAM_DECISION_SCHEMA_VERSION,
    decisionId: existing?.decisionId ?? buildSilentStreamDecisionId({ runId }),
    runId,
    source: existing?.source ?? input.source,
    layers: uniqueSilentDecisionLayers([...(existing?.layers ?? []), input.layer]),
    decision,
    timeoutMs: finiteNumber(input.timeoutMs) ?? existing?.timeoutMs,
    elapsedMs: finiteNumber(input.elapsedMs) ?? existing?.elapsedMs,
    status: input.status ?? existing?.status,
    retryCount: nonNegativeInteger(input.retryCount) ?? existing?.retryCount,
    maxRetries: nonNegativeInteger(input.maxRetries) ?? existing?.maxRetries,
    termination: existing?.termination ?? normalizeRunTermination({
      cancellationReason: 'timeout',
      detail,
      timedOut: true,
    }),
    detail,
    createdAt: existing?.createdAt ?? input.createdAt,
    updatedAt: input.createdAt ?? existing?.updatedAt,
  };
}

export function silentStreamDecisionRecordFromUnknown(value: unknown): SilentStreamDecisionRecord | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record || record.schemaVersion !== SILENT_STREAM_DECISION_SCHEMA_VERSION) return undefined;
  const decisionId = asString(record.decisionId);
  const runId = asString(record.runId);
  const source = asString(record.source);
  if (!decisionId || !runId || !source) return undefined;
  const layers = Array.isArray(record.layers)
    ? uniqueSilentDecisionLayers(record.layers.filter(isSilentDecisionLayer))
    : [];
  const termination = isRunTerminationRecord(record.termination)
    ? record.termination
    : normalizeRunTermination({ cancellationReason: 'timeout', detail: asString(record.detail), timedOut: true });
  return {
    schemaVersion: SILENT_STREAM_DECISION_SCHEMA_VERSION,
    decisionId,
    runId,
    source,
    layers,
    decision: asString(record.decision) ?? 'visible-status',
    timeoutMs: finiteNumber(record.timeoutMs),
    elapsedMs: finiteNumber(record.elapsedMs),
    status: asString(record.status),
    retryCount: nonNegativeInteger(record.retryCount),
    maxRetries: nonNegativeInteger(record.maxRetries),
    termination,
    detail: asString(record.detail),
    createdAt: asString(record.createdAt),
    updatedAt: asString(record.updatedAt),
  };
}

export function normalizeRunTerminationReason(input: RunTerminationNormalizationInput = {}): RunTerminationReason {
  const explicit = normalizedRunTerminationReason(input.cancellationReason);
  if (explicit) return explicit;
  const detail = input.detail ?? input.cancellationReason ?? '';
  if (input.userRequested) return 'user-cancelled';
  if (input.timedOut || /\b(timeout|timed out|deadline|time limit|超时)\b/i.test(detail)) return 'timeout';
  if (input.backendError || /\b(backend|agentserver|workspace runtime|http\s*5\d\d|schema|contract|error|failed|failure|后端|失败)\b/i.test(detail)) return 'backend-error';
  if (input.aborted || /abort|aborted|cancelled|canceled|disconnect|network|system|系统|网络|中断/i.test(detail)) return 'system-aborted';
  return 'backend-error';
}

function normalizedRunTerminationReason(value: string | undefined): RunTerminationReason | undefined {
  if (value === 'user-cancelled' || value === 'system-aborted' || value === 'timeout' || value === 'backend-error') return value;
  if (!value) return undefined;
  if (/user|manual|requested cancel|已中断|用户|人工/i.test(value)) return 'user-cancelled';
  if (/\b(timeout|timed out|deadline|time limit|超时)\b/i.test(value)) return 'timeout';
  if (/\b(backend|agentserver|workspace runtime|http\s*5\d\d|schema|contract|error|failed|failure|后端|失败)\b/i.test(value)) return 'backend-error';
  if (/abort|aborted|cancelled|canceled|disconnect|network|system|系统|网络|中断/i.test(value)) return 'system-aborted';
  return undefined;
}

function runTerminationActor(reason: RunTerminationReason): RunTerminationActor {
  if (reason === 'user-cancelled') return 'user';
  if (reason === 'backend-error') return 'backend';
  return 'system';
}

function cleanIdentifier(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || undefined;
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : undefined;
}

function isSilentDecisionLayer(value: unknown): value is SilentStreamDecisionLayer {
  return value === 'backend-stream' || value === 'transport-watchdog' || value === 'ui-progress';
}

function uniqueSilentDecisionLayers(values: SilentStreamDecisionLayer[]) {
  return Array.from(new Set(values));
}

function isRunTerminationRecord(value: unknown): value is RunTerminationRecord {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'sciforge.run-termination.v1'
    && normalizedRunTerminationReason(asString(value.reason)) !== undefined
    && (value.actor === 'user' || value.actor === 'system' || value.actor === 'backend');
}

export function runtimeInteractionProgressEventFromUnknown(value: unknown): RuntimeInteractionProgressEvent | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record || record.schemaVersion !== INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION) return undefined;
  const type = asString(record.type);
  if (!isRuntimeInteractionProgressEventType(type)) return undefined;
  const cancellationReason = normalizedRunTerminationReason(asString(record.cancellationReason));
  const termination = isRunTerminationRecord(record.termination)
    ? record.termination
    : cancellationReason
      ? normalizeRunTermination({ cancellationReason, detail: asString(record.reason) })
      : undefined;
  return {
    schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
    type,
    runState: asString(record.runState),
    requestId: asString(record.requestId),
    runId: asString(record.runId),
    traceRef: asString(record.traceRef),
    phase: asString(record.phase),
    status: normalizeRuntimeInteractionProgressStatus(asString(record.status)),
    importance: normalizeRuntimeInteractionProgressImportance(asString(record.importance)),
    reason: asString(record.reason),
    cancellationReason,
    budget: normalizeRuntimeInteractionProgressBudget(record.budget),
    interaction: normalizeRuntimeInteractionRequest(record.interaction),
    termination,
  };
}

export function runtimeInteractionProgressPresentation(value: unknown): RuntimeInteractionProgressPresentation | undefined {
  const event = runtimeInteractionProgressEventFromUnknown(value);
  if (!event) return undefined;
  const phase = event.phase ?? event.type;
  const parts = [
    `Phase: ${phase}`,
    event.status ? `Status: ${event.status}` : '',
    event.reason ? `Reason: ${event.reason}` : '',
    event.cancellationReason ? `Cancellation: ${event.cancellationReason}` : '',
    event.interaction ? `Interaction: ${event.interaction.kind}${event.interaction.required === undefined ? '' : event.interaction.required ? ' required' : ' optional'}` : '',
    runtimeInteractionProgressBudgetSummary(event.budget),
  ].filter(Boolean);
  return {
    label: runtimeStreamEventLabel(event.type),
    detail: parts.join('\n'),
    phase: event.phase,
    status: event.status,
    reason: event.reason,
    interaction: event.interaction,
    termination: event.termination,
  };
}

export function runtimeInteractionProgressBudgetSummary(budget: RuntimeInteractionProgressBudget | undefined) {
  if (!budget) return '';
  const parts = [
    budget.elapsedMs !== undefined ? `elapsed ${budget.elapsedMs}ms` : '',
    budget.remainingMs !== undefined ? `remaining ${budget.remainingMs}ms` : '',
    budget.retryCount !== undefined || budget.maxRetries !== undefined
      ? `retries ${budget.retryCount ?? '?'}/${budget.maxRetries ?? '?'}`
      : '',
    budget.maxWallMs !== undefined ? `max wall ${budget.maxWallMs}ms` : '',
  ].filter(Boolean);
  return parts.length ? `Budget: ${parts.join(', ')}` : '';
}

function isRuntimeInteractionProgressEventType(value: string | undefined): value is RuntimeInteractionProgressEventType {
  return Boolean(value && STANDARD_INTERACTION_PROGRESS_EVENT_TYPES.includes(value as RuntimeInteractionProgressEventType));
}

function normalizeRuntimeInteractionProgressStatus(value: string | undefined): RuntimeInteractionProgressStatus | undefined {
  if (value === 'pending' || value === 'running' || value === 'blocked' || value === 'completed' || value === 'failed' || value === 'cancelled') return value;
  return undefined;
}

function normalizeRuntimeInteractionProgressImportance(value: string | undefined): RuntimeInteractionProgressImportance | undefined {
  if (value === 'low' || value === 'normal' || value === 'high' || value === 'blocking') return value;
  return undefined;
}

function normalizeRuntimeInteractionRequest(value: unknown): RuntimeInteractionRequest | undefined {
  const record = isRecord(value) ? value : undefined;
  const kind = asString(record?.kind);
  if (!record || !kind) return undefined;
  return {
    id: asString(record.id),
    kind,
    required: typeof record.required === 'boolean' ? record.required : undefined,
  };
}

function normalizeRuntimeInteractionProgressBudget(value: unknown): RuntimeInteractionProgressBudget | undefined {
  const record = isRecord(value) ? value : undefined;
  if (!record) return undefined;
  const budget = {
    elapsedMs: finiteNumber(record.elapsedMs),
    remainingMs: finiteNumber(record.remainingMs),
    retryCount: nonNegativeInteger(record.retryCount),
    maxRetries: nonNegativeInteger(record.maxRetries),
    maxWallMs: finiteNumber(record.maxWallMs),
  };
  return Object.values(budget).some((entry) => entry !== undefined) ? budget : undefined;
}

export function runtimeStreamEventLabel(type: string, source?: string, toolName?: string) {
  if (type === CONTEXT_WINDOW_STATE_EVENT_TYPE) return '上下文窗口';
  if (type === CONTEXT_COMPACTION_EVENT_TYPE) return '上下文压缩';
  if (type === RUN_PLAN_EVENT_TYPE) return '计划';
  if (type === STAGE_START_EVENT_TYPE) return '阶段';
  if (type === PROCESS_PROGRESS_EVENT_TYPE) return '过程';
  if (type === CLARIFICATION_NEEDED_EVENT_TYPE) return '需要澄清';
  if (type === HUMAN_APPROVAL_REQUIRED_EVENT_TYPE) return '需要确认';
  if (type === INTERACTION_REQUEST_EVENT_TYPE) return '需要交互';
  if (type === GUIDANCE_QUEUED_EVENT_TYPE) return '引导已排队';
  if (type === RUN_CANCELLED_EVENT_TYPE) return '运行取消';
  if (type === TEXT_DELTA_EVENT_TYPE) return '思考';
  if (type === TOOL_CALL_EVENT_TYPE) return toolName ? `调用 ${toolName}` : '工具调用';
  if (type === TOOL_RESULT_EVENT_TYPE) return toolName ? `结果 ${toolName}` : '工具结果';
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
      schemaVersion: INTERACTION_PROGRESS_EVENT_SCHEMA_VERSION,
      type: GUIDANCE_QUEUED_EVENT_TYPE,
      runState: 'guidance-queued',
      phase: 'interaction',
      status: 'running',
      importance: 'normal',
      reason: guidance.reason,
      interaction: {
        id: guidance.id,
        kind: 'guidance',
        required: false,
      },
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
