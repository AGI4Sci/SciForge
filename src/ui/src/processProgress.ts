import {
  GUIDANCE_QUEUED_EVENT_TYPE,
  PROCESS_PROGRESS_EVENT_TYPE,
  PROCESS_PROGRESS_PHASE,
  PROCESS_PROGRESS_REASON,
  PROCESS_PROGRESS_STATUS,
  USER_INTERRUPT_EVENT_TYPE,
  buildSilentStreamDecisionRecord,
  runtimeInteractionProgressEventFromUnknown,
  runtimeInteractionProgressPresentation,
  runtimeRequestAcceptedProgressCopy,
  silentStreamDecisionRecordFromUnknown,
} from '@sciforge-ui/runtime-contract';
import type { ProcessProgressModel, ProcessProgressPhase, RuntimeInteractionProgressEvent } from '@sciforge-ui/runtime-contract';
import type { AgentStreamEvent } from './domain';
import { makeId, nowIso } from './domain';
import type { RuntimeResponsePlan } from './latencyPolicy';

export type { ProcessProgressModel, ProcessProgressPhase } from '@sciforge-ui/runtime-contract';

export const SILENT_STREAM_WAIT_THRESHOLD_MS = 5_000;

interface SilentStreamPolicySummary {
  timeoutMs: number;
  decision?: string;
  maxRetries?: number;
  retryAttempt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function progressModelFromEvent(event: AgentStreamEvent): ProcessProgressModel | undefined {
  const raw = isRecord(event.raw) ? event.raw : {};
  const interactionProgress = runtimeInteractionProgressEventFromUnknown(raw)
    ?? (isRecord(raw.raw) ? runtimeInteractionProgressEventFromUnknown(raw.raw) : undefined);
  if (interactionProgress) return progressModelFromInteractionProgress(interactionProgress);
  const progress = isRecord(raw.progress) ? raw.progress : isRecord(raw.raw) && isRecord(raw.raw.progress) ? raw.raw.progress : undefined;
  if (progress) return normalizeProgressModel(progress, event);
  if (event.type === PROCESS_PROGRESS_EVENT_TYPE) return normalizeProgressModel(raw, event);
  return undefined;
}

export function latestProgressModel(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const model = progressModelFromEvent(event);
    if (model) return model;
  }
  return undefined;
}

export function latestProgressModelFromCompactTrace(source: unknown): ProcessProgressModel | undefined {
  const candidates = compactProgressCandidates(source);
  for (const candidate of [...candidates].reverse()) {
    const eventModel = progressModelFromCompactEvent(candidate);
    if (eventModel) return eventModel;
    const transcriptModel = progressModelFromCompactText(candidate);
    if (transcriptModel) return transcriptModel;
  }
  return undefined;
}

export function formatProgressHeadline(model: ProcessProgressModel | undefined, fallback?: string) {
  if (!model) return fallback;
  const parts = [model.title];
  if (model.reading.length) parts.push(`读 ${model.reading[0]}`);
  if (model.writing.length) parts.push(`写 ${model.writing[0]}`);
  if (model.waitingFor) parts.push(`等 ${model.waitingFor}`);
  if (model.lastEvent) parts.push(`最近 ${model.lastEvent.label}: ${model.lastEvent.detail}`);
  if (model.nextStep) parts.push(`下一步 ${model.nextStep}`);
  return parts.join(' · ');
}

export function buildSilentStreamProgressEvent({
  events,
  nowMs,
  backend,
  thresholdMs,
  runId,
}: {
  events: AgentStreamEvent[];
  nowMs: number;
  backend?: string;
  thresholdMs?: number;
  runId?: string;
}): AgentStreamEvent | undefined {
  const silencePolicy = silentStreamPolicyFromEvents(events);
  const effectiveThresholdMs = thresholdMs ?? silencePolicy?.timeoutMs ?? SILENT_STREAM_WAIT_THRESHOLD_MS;
  const lastEvent = latestNonSyntheticEvent(events);
  const latestAtMs = lastEvent ? Date.parse(lastEvent.createdAt) : undefined;
  const elapsedMs = Number.isFinite(latestAtMs) ? nowMs - (latestAtMs as number) : effectiveThresholdMs;
  if (elapsedMs < effectiveThresholdMs) return undefined;
  const lastEventSummary = lastEvent ? summarizeLastEvent(lastEvent) : undefined;
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const detail = lastEventSummary
    ? `HTTP stream 仍在等待；已 ${elapsedSeconds}s 没有收到新事件。最近事件：${lastEventSummary.label} - ${lastEventSummary.detail}`
    : `HTTP stream 仍在等待；已 ${elapsedSeconds}s 没有收到新事件，尚无可展示的后端事件。`;
  const existingDecision = latestSilentStreamDecision(events);
  const silentStreamDecision = buildSilentStreamDecisionRecord({
    existing: existingDecision,
    runId: runId ?? existingDecision?.runId,
    source: 'ui.progress.silentStreamWait',
    layer: 'ui-progress',
    decision: silencePolicy?.decision ?? existingDecision?.decision ?? 'visible-status',
    timeoutMs: effectiveThresholdMs,
    elapsedMs,
    status: 'waiting-for-backend-event',
    maxRetries: silencePolicy?.maxRetries,
    detail,
    createdAt: new Date(nowMs).toISOString(),
  });
  return {
    id: 'evt-silent-stream-wait',
    type: PROCESS_PROGRESS_EVENT_TYPE,
    label: '等待',
    detail,
    createdAt: new Date(nowMs).toISOString(),
    raw: {
      type: PROCESS_PROGRESS_EVENT_TYPE,
      progress: {
        phase: PROCESS_PROGRESS_PHASE.WAIT,
        title: '正在等待后端返回新事件',
        detail,
        waitingFor: '后端返回新事件',
        nextStep: '收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
        lastEvent: lastEventSummary,
        reason: PROCESS_PROGRESS_REASON.BACKEND_WAITING,
        recoveryHint: '保留最近真实事件和等待原因，下一轮可基于这些线索继续或恢复。',
        canAbort: true,
        canContinue: true,
        status: PROCESS_PROGRESS_STATUS.RUNNING,
      },
      silentStreamWaiting: true,
      backend,
      elapsedMs,
      thresholdMs: effectiveThresholdMs,
      silencePolicy,
      silentStreamDecision,
      streamOpen: true,
    },
  };
}

export function silentStreamWaitThresholdMs(events: AgentStreamEvent[]) {
  return silentStreamPolicyFromEvents(events)?.timeoutMs ?? SILENT_STREAM_WAIT_THRESHOLD_MS;
}

export function buildInitialResponseProgressEvent(responsePlan: RuntimeResponsePlan | undefined): AgentStreamEvent | undefined {
  const mode = responsePlan?.initialResponseMode;
  if (!mode) return undefined;
  if (mode === 'wait-for-result') {
    return progressEvent({
      phase: PROCESS_PROGRESS_PHASE.PLAN,
      title: '正在规划工作区任务',
      detail: '已收到请求，正在规划需要执行和验证的工作。',
      waitingFor: '工作区任务进展',
      nextStep: firstProgressPhase(responsePlan) ?? '继续执行并流式显示进展。',
      reason: 'initial-response-wait-for-result',
    });
  }
  if (mode === 'quick-status' || mode === 'direct-context-answer' || mode === 'streaming-draft') {
    const direct = mode === 'direct-context-answer';
    return progressEvent({
      phase: direct ? PROCESS_PROGRESS_PHASE.READ : PROCESS_PROGRESS_PHASE.PLAN,
      title: direct ? '正在整理当前上下文' : '正在准备可读进展',
      detail: direct
        ? '已收到请求，正在基于当前上下文整理可读回复。'
        : '已收到请求，正在准备可读状态并继续执行所需工作。',
      waitingFor: direct ? undefined : '后续工作区事件',
      nextStep: firstProgressPhase(responsePlan) ?? '继续流式显示进展。',
      reason: `initial-response-${mode}`,
    });
  }
  return undefined;
}

export function buildRequestAcceptedProgressEvent(prompt: string): AgentStreamEvent {
  const copy = runtimeRequestAcceptedProgressCopy(prompt);
  return progressEvent({
    phase: PROCESS_PROGRESS_PHASE.PLAN,
    title: '已收到请求',
    detail: copy.detail,
    waitingFor: copy.waitingFor,
    nextStep: copy.nextStep,
    reason: copy.reason,
  });
}

function progressEvent({
  phase,
  title,
  detail,
  waitingFor,
  nextStep,
  reason,
}: {
  phase: ProcessProgressPhase;
  title: string;
  detail: string;
  waitingFor?: string;
  nextStep?: string;
  reason: string;
}): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type: PROCESS_PROGRESS_EVENT_TYPE,
    label: '进展',
    detail,
    createdAt: nowIso(),
    raw: {
      type: PROCESS_PROGRESS_EVENT_TYPE,
      progress: {
        phase,
        title,
        detail,
        waitingFor,
        nextStep,
        reason,
        canAbort: true,
        canContinue: true,
        status: PROCESS_PROGRESS_STATUS.RUNNING,
      },
      responsePlanInitialStatus: true,
    },
  };
}

function firstProgressPhase(responsePlan: RuntimeResponsePlan | undefined) {
  return responsePlan?.userVisibleProgress?.[0] ?? responsePlan?.progressPhases?.[0];
}

function normalizeProgressModel(progress: Record<string, unknown>, event: AgentStreamEvent): ProcessProgressModel {
  const phase = normalizePhase(asString(progress.phase) ?? event.type);
  const detail = asString(progress.detail) ?? event.detail;
  return {
    phase,
    title: asString(progress.title) ?? titleForPhase(phase, event.label),
    detail: detail || titleForPhase(phase, event.label),
    reading: asStringArray(progress.reading),
    writing: asStringArray(progress.writing),
    waitingFor: asString(progress.waitingFor) ?? asString(progress.waiting_for),
    nextStep: asString(progress.nextStep) ?? asString(progress.next_step),
    lastEvent: normalizeLastEvent(progress.lastEvent) ?? normalizeLastEvent(progress.last_event),
    reason: asString(progress.reason),
    recoveryHint: asString(progress.recoveryHint) ?? asString(progress.recovery_hint),
    canAbort: progress.canAbort === true || progress.can_abort === true,
    canContinue: progress.canContinue === true || progress.can_continue === true,
    status: normalizeStatus(asString(progress.status), phase),
  };
}

function compactProgressCandidates(source: unknown, depth = 0): unknown[] {
  if (depth > 5 || source === undefined || source === null) return [];
  if (typeof source === 'string') return [source];
  if (Array.isArray(source)) return source.flatMap((item) => compactProgressCandidates(item, depth + 1));
  if (!isRecord(source)) return [];

  const direct: unknown[] = [];
  if (looksLikeCompactStreamEvent(source)) direct.push(source);
  const streamProcess = isRecord(source.streamProcess) ? source.streamProcess : undefined;
  if (streamProcess) {
    direct.push(...compactProgressCandidates(streamProcess.events, depth + 1));
    if (typeof streamProcess.summary === 'string') direct.push(streamProcess.summary);
  }
  if (Array.isArray(source.runs)) direct.push(...compactProgressCandidates(source.runs, depth + 1));
  if (isRecord(source.raw)) direct.push(...compactProgressCandidates(source.raw, depth + 1));
  if (Array.isArray(source.events)) direct.push(...compactProgressCandidates(source.events, depth + 1));
  if (isRecord(source.session)) direct.push(...compactProgressCandidates(source.session, depth + 1));
  if (typeof source.summary === 'string') direct.push(source.summary);
  return direct;
}

function looksLikeCompactStreamEvent(value: Record<string, unknown>) {
  return typeof value.type === 'string'
    || typeof value.label === 'string'
    || isRecord(value.progress)
    || isRecord(value.raw)
    || value.schemaVersion === 'sciforge.interaction-progress-event.v1';
}

function progressModelFromCompactEvent(value: unknown): ProcessProgressModel | undefined {
  if (!isRecord(value)) return undefined;
  const type = asString(value.type) ?? PROCESS_PROGRESS_EVENT_TYPE;
  const label = asString(value.label) ?? type;
  const detail = asString(value.detail) ?? asString(value.message) ?? asString(value.text) ?? '';
  const createdAt = asString(value.createdAt) ?? asString(value.created_at) ?? nowIso();
  const raw = compactEventRaw(value, type, label, detail);
  const model = progressModelFromEvent({
    id: asString(value.id) ?? makeId('evt'),
    type,
    label,
    detail,
    createdAt,
    raw,
  });
  if (model && (model.phase !== PROCESS_PROGRESS_PHASE.OBSERVE || type !== PROCESS_PROGRESS_EVENT_TYPE || isRecord(raw.progress))) {
    return model;
  }
  return progressModelFromCompactText(`${label}: ${detail}`);
}

function compactEventRaw(value: Record<string, unknown>, type: string, label: string, detail: string): Record<string, unknown> {
  if (isRecord(value.raw)) return value.raw;
  if (value.schemaVersion === 'sciforge.interaction-progress-event.v1') return value;
  if (isRecord(value.progress)) return { type, progress: value.progress };
  if (type === PROCESS_PROGRESS_EVENT_TYPE) {
    const recovered = progressModelFromCompactText(`${label}: ${detail}`);
    if (recovered) {
      return {
        type,
        progress: {
          phase: recovered.phase,
          title: recovered.title,
          detail: recovered.detail,
          reading: recovered.reading,
          writing: recovered.writing,
          waitingFor: recovered.waitingFor,
          nextStep: recovered.nextStep,
          lastEvent: recovered.lastEvent,
          reason: recovered.reason,
          recoveryHint: recovered.recoveryHint,
          canAbort: recovered.canAbort,
          canContinue: recovered.canContinue,
          status: recovered.status,
        },
      };
    }
  }
  return { type };
}

function progressModelFromCompactText(value: unknown): ProcessProgressModel | undefined {
  if (typeof value !== 'string') return undefined;
  const wholeStructured = progressModelFromStructuredDetail(value);
  if (wholeStructured) return wholeStructured;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);
  for (const line of [...lines].reverse()) {
    const model = progressModelFromTranscriptLine(line);
    if (model) return model;
  }
  return undefined;
}

function progressModelFromTranscriptLine(line: string): ProcessProgressModel | undefined {
  const structured = progressModelFromStructuredDetail(line);
  if (structured) return structured;
  const separator = line.indexOf(':');
  const label = separator > 0 ? line.slice(0, separator).trim() : '';
  const headline = separator > 0 ? line.slice(separator + 1).trim() : line;
  if (!headline || (!label && !/读 |写 |等 |最近 |下一步 |Phase:|Status:/i.test(headline))) return undefined;
  const parts = headline.split(/\s+·\s+/).map((part) => part.trim()).filter(Boolean);
  const title = parts[0] || label || headline;
  const reading: string[] = [];
  const writing: string[] = [];
  let waitingFor: string | undefined;
  let nextStep: string | undefined;
  let lastEvent: ProcessProgressModel['lastEvent'];
  for (const part of parts.slice(1)) {
    const read = part.match(/^读\s+(.+)$/);
    if (read?.[1]) reading.push(...splitCompactList(read[1]));
    const write = part.match(/^写\s+(.+)$/);
    if (write?.[1]) writing.push(...splitCompactList(write[1]));
    const wait = part.match(/^等\s+(.+)$/);
    if (wait?.[1]) waitingFor = wait[1].trim();
    const recent = part.match(/^最近\s+([^:：]+)[:：]\s*(.+)$/);
    if (recent?.[1] && recent?.[2]) lastEvent = { label: recent[1].trim(), detail: recent[2].trim() };
    const next = part.match(/^下一步\s+(.+)$/);
    if (next?.[1]) nextStep = next[1].trim();
  }
  const phase = normalizePhase([label, title, waitingFor, nextStep].filter(Boolean).join(' '));
  const hasProgressFacts = Boolean(reading.length || writing.length || waitingFor || nextStep || lastEvent)
    || /安全中止|中止|补充指令|continue|abort|backend|HTTP stream/i.test(headline);
  if (!hasProgressFacts && phase === PROCESS_PROGRESS_PHASE.OBSERVE) return undefined;
  return {
    phase,
    title,
    detail: headline,
    reading,
    writing,
    waitingFor,
    nextStep,
    lastEvent,
    reason: /后端返回新事件|HTTP stream|backend/i.test(headline) ? PROCESS_PROGRESS_REASON.BACKEND_WAITING : undefined,
    recoveryHint: undefined,
    canAbort: /安全中止|中止|abort/i.test(headline),
    canContinue: /补充指令|继续补充|continue/i.test(headline),
    status: normalizeStatus(undefined, phase),
  };
}

function progressModelFromStructuredDetail(line: string): ProcessProgressModel | undefined {
  if (!/\bPhase:\s*/.test(line) && !/\bStatus:\s*/.test(line)) return undefined;
  const phaseText = firstStructuredField(line, 'Phase');
  const statusText = firstStructuredField(line, 'Status');
  const reason = firstStructuredField(line, 'Reason');
  const cancellation = firstStructuredField(line, 'Cancellation');
  const interaction = firstStructuredField(line, 'Interaction');
  const phase = normalizePhase(phaseText ?? line);
  const detail = [
    phaseText ? `Phase: ${phaseText}` : '',
    statusText ? `Status: ${statusText}` : '',
    reason ? `Reason: ${reason}` : '',
    cancellation ? `Cancellation: ${cancellation}` : '',
    interaction ? `Interaction: ${interaction}` : '',
  ].filter(Boolean).join('\n') || line;
  return {
    phase,
    title: titleForPhase(phase, phaseText ?? '进展'),
    detail,
    reading: [],
    writing: [],
    waitingFor: interaction?.includes('human-approval') ? '人工确认' : interaction?.includes('clarification') ? '澄清信息' : undefined,
    nextStep: interaction?.includes('human-approval') ? '等待确认后继续执行需要人工批准的步骤。' : undefined,
    lastEvent: undefined,
    reason,
    recoveryHint: cancellation,
    canAbort: statusText === 'running' || statusText === 'blocked',
    canContinue: statusText === 'blocked',
    status: normalizeStatus(statusText, phase),
  };
}

function firstStructuredField(line: string, name: string) {
  const match = line.match(new RegExp(`${name}:\\s*([^\\n]+)`));
  return match?.[1]?.trim();
}

function splitCompactList(value: string) {
  return value.split(/[、,]/).map((item) => item.trim()).filter(Boolean);
}

function progressModelFromInteractionProgress(progress: RuntimeInteractionProgressEvent): ProcessProgressModel {
  const presentation = runtimeInteractionProgressPresentation(progress);
  const phase = normalizePhase(progress.phase ?? progress.type);
  const interactionKind = progress.interaction?.kind;
  return {
    phase,
    title: presentation?.label ?? titleForPhase(phase, progress.type),
    detail: presentation?.detail || progress.reason || progress.type,
    reading: [],
    writing: [],
    waitingFor: waitingForInteraction(progress.type, interactionKind, progress.interaction?.required),
    nextStep: nextStepForInteraction(progress.type, interactionKind),
    reason: progress.reason,
    recoveryHint: progress.termination?.detail,
    canAbort: progress.status === 'running' || progress.status === 'blocked',
    canContinue: progress.type === GUIDANCE_QUEUED_EVENT_TYPE || progress.status === 'blocked',
    status: normalizeInteractionStatus(progress),
  };
}

function latestNonSyntheticEvent(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const raw = isRecord(event.raw) ? event.raw : {};
    if (raw.silentStreamWaiting === true) continue;
    if (event.type === PROCESS_PROGRESS_EVENT_TYPE && isRecord(raw.progress) && raw.progress.reason === PROCESS_PROGRESS_REASON.BACKEND_WAITING) continue;
    if (event.type === 'queued' || event.type === GUIDANCE_QUEUED_EVENT_TYPE || event.type === USER_INTERRUPT_EVENT_TYPE) continue;
    return event;
  }
  return undefined;
}

function silentStreamPolicyFromEvents(events: AgentStreamEvent[]): SilentStreamPolicySummary | undefined {
  for (const event of [...events].reverse()) {
    const raw = isRecord(event.raw) ? event.raw : {};
    const contract = isRecord(raw.contract) ? raw.contract : undefined;
    const progressPlan = isRecord(contract?.progressPlan)
      ? contract.progressPlan
      : isRecord(raw.progressPlan)
        ? raw.progressPlan
        : undefined;
    if (!progressPlan) continue;
    const silencePolicy = isRecord(progressPlan.silencePolicy) ? progressPlan.silencePolicy : {};
    const timeoutMs = numberField(silencePolicy.timeoutMs) ?? numberField(progressPlan.silenceTimeoutMs);
    if (timeoutMs === undefined) continue;
    return {
      timeoutMs,
      decision: asString(silencePolicy.decision),
      maxRetries: numberField(silencePolicy.maxRetries),
      retryAttempt: numberField(silencePolicy.retryAttempt),
    };
  }
  return undefined;
}

function latestSilentStreamDecision(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const raw = isRecord(event.raw) ? event.raw : {};
    const direct = silentStreamDecisionRecordFromUnknown(raw.silentStreamDecision);
    if (direct) return direct;
    const nestedRaw = isRecord(raw.raw) ? raw.raw : undefined;
    const nested = silentStreamDecisionRecordFromUnknown(nestedRaw?.silentStreamDecision);
    if (nested) return nested;
  }
  return undefined;
}

function summarizeLastEvent(event: AgentStreamEvent) {
  return {
    label: event.label || event.type || '事件',
    detail: (event.detail || event.type || event.label || '后端事件').trim().slice(0, 180),
    createdAt: event.createdAt,
  };
}

function normalizeLastEvent(value: unknown): ProcessProgressModel['lastEvent'] | undefined {
  if (!isRecord(value)) return undefined;
  const label = asString(value.label) ?? asString(value.type);
  const detail = asString(value.detail) ?? asString(value.message) ?? asString(value.text);
  if (!label || !detail) return undefined;
  return {
    label,
    detail,
    createdAt: asString(value.createdAt) ?? asString(value.created_at),
  };
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function normalizePhase(value: string): ProcessProgressPhase {
  const lowered = value.toLowerCase();
  if (/write|写/.test(lowered)) return PROCESS_PROGRESS_PHASE.WRITE;
  if (/read|读/.test(lowered)) return PROCESS_PROGRESS_PHASE.READ;
  if (/wait|silent|pending|等待|配额/.test(lowered)) return PROCESS_PROGRESS_PHASE.WAIT;
  if (/plan|next|stage|计划|下一步/.test(lowered)) return PROCESS_PROGRESS_PHASE.PLAN;
  if (/complete|done|success|完成/.test(lowered)) return PROCESS_PROGRESS_PHASE.COMPLETE;
  if (/error|fail|traceback|失败|报错/.test(lowered)) return PROCESS_PROGRESS_PHASE.ERROR;
  if (/execute|run|command|执行|运行/.test(lowered)) return PROCESS_PROGRESS_PHASE.EXECUTE;
  return PROCESS_PROGRESS_PHASE.OBSERVE;
}

function normalizeStatus(value: string | undefined, phase: ProcessProgressPhase): ProcessProgressModel['status'] {
  if (/cancel/.test(value ?? '')) return PROCESS_PROGRESS_STATUS.CANCELLED;
  if (phase === PROCESS_PROGRESS_PHASE.ERROR || /fail|error|失败/.test(value ?? '')) return PROCESS_PROGRESS_STATUS.FAILED;
  if (phase === PROCESS_PROGRESS_PHASE.COMPLETE || /done|complete|success|完成/.test(value ?? '')) return PROCESS_PROGRESS_STATUS.COMPLETED;
  return PROCESS_PROGRESS_STATUS.RUNNING;
}

function normalizeInteractionStatus(progress: RuntimeInteractionProgressEvent): ProcessProgressModel['status'] {
  if (progress.termination?.progressStatus === 'cancelled' || progress.status === 'cancelled') return PROCESS_PROGRESS_STATUS.CANCELLED;
  if (progress.termination?.progressStatus === 'failed' || progress.status === 'failed') return PROCESS_PROGRESS_STATUS.FAILED;
  if (progress.status === 'completed') return PROCESS_PROGRESS_STATUS.COMPLETED;
  return PROCESS_PROGRESS_STATUS.RUNNING;
}

function waitingForInteraction(type: string, interactionKind: string | undefined, required: boolean | undefined) {
  if (type === 'run-cancelled') return undefined;
  if (interactionKind === 'human-approval') return '人工确认';
  if (interactionKind === 'clarification') return '澄清信息';
  if (interactionKind === 'guidance') return '当前 run 结束后合并引导';
  if (required) return '用户交互';
  return type === GUIDANCE_QUEUED_EVENT_TYPE ? '当前 run 结束后合并引导' : undefined;
}

function nextStepForInteraction(type: string, interactionKind: string | undefined) {
  if (type === 'run-cancelled') return '运行已结束，保留结构化终止原因供下一轮恢复或审计。';
  if (interactionKind === 'guidance') return '等待当前 run 结束后合并到下一轮。';
  if (interactionKind === 'human-approval') return '等待确认后继续执行需要人工批准的步骤。';
  if (interactionKind === 'clarification') return '等待补充澄清后继续执行。';
  return undefined;
}

function titleForPhase(phase: ProcessProgressPhase, fallback: string) {
  if (phase === PROCESS_PROGRESS_PHASE.READ) return '正在读取';
  if (phase === PROCESS_PROGRESS_PHASE.WRITE) return '正在写入';
  if (phase === PROCESS_PROGRESS_PHASE.EXECUTE) return '正在执行';
  if (phase === PROCESS_PROGRESS_PHASE.WAIT) return '正在等待';
  if (phase === PROCESS_PROGRESS_PHASE.PLAN) return '正在规划下一步';
  if (phase === PROCESS_PROGRESS_PHASE.COMPLETE) return '阶段完成';
  if (phase === PROCESS_PROGRESS_PHASE.ERROR) return '遇到阻断';
  return fallback || '正在观察后端状态';
}
