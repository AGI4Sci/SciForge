import type { RuntimeArtifact } from './artifacts';
import type { AgentCompactCapability, AgentContextCompaction, AgentContextWindowSource, AgentContextWindowState } from './stream';
import type { RuntimeExecutionUnit } from './execution';
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
export const PROJECT_TOOL_FAILED_EVENT_TYPE = 'project-tool-failed';

export type WorkspaceRuntimeCompletionStatus = 'completed' | 'failed';

export interface WorkspaceRuntimeResultCompletion {
  status: WorkspaceRuntimeCompletionStatus;
  reason?: string;
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
  if (type === 'contextWindowState') return '上下文窗口';
  if (type === 'contextCompaction') return '上下文压缩';
  if (type === 'run-plan') return '计划';
  if (type === 'stage-start') return '阶段';
  if (type === 'process-progress') return '过程';
  if (type === 'text-delta') return '思考';
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
