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
import { runtimeInteractionProgressEventFromCompactRecord } from '@sciforge-ui/runtime-contract/events';
import type { ProcessProgressModel, ProcessProgressPhase, RuntimeInteractionProgressEvent } from '@sciforge-ui/runtime-contract';
import type { AgentStreamEvent } from './domain';
import { localeText, type SupportedLocale } from './i18n';
import { makeId, nowIso } from './domain';
import type { RuntimeResponsePlan } from './latencyPolicy';
import { isRuntimeAuditOnlyEvent } from './runtimeAuditEvents';
import {
  PUBLIC_RUNTIME_AUDIT_FALLBACK,
  sanitizePublicText,
  sanitizePublicTextArray,
} from './publicProjectionSanitizer';

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

export function progressModelFromEvent(event: AgentStreamEvent): ProcessProgressModel | undefined {
  const raw = isRecord(event.raw) ? event.raw : {};
  const directInteractionProgress = runtimeInteractionProgressEventFromUnknown(raw)
    ?? (isRecord(raw.raw) ? runtimeInteractionProgressEventFromUnknown(raw.raw) : undefined);
  if (directInteractionProgress) return progressModelFromInteractionProgress(directInteractionProgress, { compactDetail: false });
  const compactInteractionProgress = runtimeInteractionProgressEventFromCompactRecord(raw);
  if (compactInteractionProgress) return progressModelFromInteractionProgress(compactInteractionProgress, { compactDetail: true });
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
  return progressModelsFromCompactTrace(source).at(-1);
}

export function progressModelsFromCompactTrace(source: unknown): ProcessProgressModel[] {
  return compactProgressCandidates(source)
    .map((candidate) => progressModelFromCompactEvent(candidate))
    .filter((model): model is ProcessProgressModel => Boolean(model));
}

export function formatProgressHeadline(model: ProcessProgressModel | undefined, fallback?: string, locale?: SupportedLocale) {
  if (!model) return fallback;
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale ?? 'en-US', copy);
  const parts = [model.title];
  if (model.reading.length) parts.push(t({ 'zh-CN': `读取 ${model.reading[0]}`, 'en-US': `Reading ${model.reading[0]}` }));
  if (model.writing.length) parts.push(t({ 'zh-CN': `写入 ${model.writing[0]}`, 'en-US': `Writing ${model.writing[0]}` }));
  if (model.waitingFor && !progressTitleAlreadyNamesWait(model.title, model.waitingFor)) {
    parts.push(t({ 'zh-CN': `等待 ${model.waitingFor}`, 'en-US': `Waiting for ${model.waitingFor}` }));
  }
  if (model.lastEvent) parts.push(t({ 'zh-CN': `最近 ${model.lastEvent.label}: ${model.lastEvent.detail}`, 'en-US': `Latest ${model.lastEvent.label}: ${model.lastEvent.detail}` }));
  if (model.nextStep) parts.push(t({ 'zh-CN': `下一步 ${model.nextStep}`, 'en-US': `Next ${model.nextStep}` }));
  return parts.join(' · ');
}

function progressTitleAlreadyNamesWait(title: string, waitingFor: string) {
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalizedWaitingFor = waitingFor.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalizedTitle || !normalizedWaitingFor) return false;
  return normalizedTitle.includes(`waiting for ${normalizedWaitingFor}`)
    || normalizedTitle.includes(`等待${normalizedWaitingFor}`)
    || normalizedTitle.includes(`等待 ${normalizedWaitingFor}`);
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
    ? `Still waiting for workspace activity after ${elapsedSeconds}s. Latest event: ${lastEventSummary.label} - ${lastEventSummary.detail}`
    : `Still waiting for workspace activity after ${elapsedSeconds}s.`;
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
    label: 'Waiting',
    detail,
    createdAt: new Date(nowMs).toISOString(),
    raw: {
      type: PROCESS_PROGRESS_EVENT_TYPE,
      progress: {
        phase: PROCESS_PROGRESS_PHASE.WAIT,
        title: 'Waiting for workspace activity',
        detail,
        waitingFor: 'workspace activity',
        nextStep: 'SciForge will continue when new activity arrives. You can also stop the task or queue more guidance.',
        lastEvent: lastEventSummary,
        reason: PROCESS_PROGRESS_REASON.BACKEND_WAITING,
        recoveryHint: 'Recent activity and waiting state are kept so the next turn can continue.',
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

export function buildInitialResponseProgressEvent(responsePlan: RuntimeResponsePlan | undefined, locale?: SupportedLocale): AgentStreamEvent | undefined {
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale ?? 'en-US', copy);
  const mode = responsePlan?.initialResponseMode;
  if (!mode) return undefined;
  if (mode === 'wait-for-result') {
    return progressEvent({
      phase: PROCESS_PROGRESS_PHASE.PLAN,
      title: t({ 'zh-CN': '正在规划工作区任务', 'en-US': 'Planning workspace task' }),
      detail: t({ 'zh-CN': '已收到请求；正在规划要执行的工作和检查。', 'en-US': 'Request received; planning the work and checks to run.' }),
      waitingFor: t({ 'zh-CN': '工作区任务进展', 'en-US': 'workspace task progress' }),
      nextStep: firstProgressPhase(responsePlan) ?? t({ 'zh-CN': '继续运行并流式展示进展。', 'en-US': 'Continue running and stream progress.' }),
      reason: 'initial-response-wait-for-result',
      locale,
    });
  }
  if (mode === 'quick-status' || mode === 'direct-context-answer' || mode === 'streaming-draft') {
    const direct = mode === 'direct-context-answer';
    return progressEvent({
      phase: direct ? PROCESS_PROGRESS_PHASE.READ : PROCESS_PROGRESS_PHASE.PLAN,
      title: direct
        ? t({ 'zh-CN': '正在读取当前上下文', 'en-US': 'Reading current context' })
        : t({ 'zh-CN': '正在准备可读进展', 'en-US': 'Preparing readable progress' }),
      detail: direct
        ? t({ 'zh-CN': '已收到请求；正在从当前上下文准备可读回答。', 'en-US': 'Request received; preparing a readable answer from the current context.' })
        : t({ 'zh-CN': '已收到请求；任务继续运行时会展示可读状态。', 'en-US': 'Request received; preparing a readable status while the work continues.' }),
      waitingFor: direct ? undefined : t({ 'zh-CN': '后续工作区事件', 'en-US': 'following workspace events' }),
      nextStep: firstProgressPhase(responsePlan) ?? t({ 'zh-CN': '继续流式展示进展。', 'en-US': 'Continue streaming progress.' }),
      reason: `initial-response-${mode}`,
      locale,
    });
  }
  return undefined;
}

export function buildRequestAcceptedProgressEvent(prompt: string, locale?: SupportedLocale): AgentStreamEvent {
  const copy = runtimeRequestAcceptedProgressCopy(prompt);
  const localizedCopy = locale === 'zh-CN'
    ? {
      detail: `正在把请求发送给 workspace agent：${prompt}`,
      waitingFor: '第一个 workspace agent 事件',
      nextStep: '收到新事件后继续展示实时进展。',
      reason: copy.reason,
    }
    : copy;
  return progressEvent({
    phase: PROCESS_PROGRESS_PHASE.PLAN,
    title: localeText(locale ?? 'en-US', { 'zh-CN': '已收到请求', 'en-US': 'Request received' }),
    detail: localizedCopy.detail,
    waitingFor: localizedCopy.waitingFor,
    nextStep: localizedCopy.nextStep,
    reason: localizedCopy.reason,
    locale,
  });
}

function progressEvent({
  phase,
  title,
  detail,
  waitingFor,
  nextStep,
  reason,
  locale,
}: {
  phase: ProcessProgressPhase;
  title: string;
  detail: string;
  waitingFor?: string;
  nextStep?: string;
  reason: string;
  locale?: SupportedLocale;
}): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type: PROCESS_PROGRESS_EVENT_TYPE,
    label: localeText(locale ?? 'en-US', { 'zh-CN': '进展', 'en-US': 'Progress' }),
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
  const detail = sanitizePublicText(asString(progress.detail) ?? event.detail, { fallback: PUBLIC_RUNTIME_AUDIT_FALLBACK });
  return {
    phase,
    title: sanitizePublicText(asString(progress.title), { fallback: titleForPhase(phase, event.label) }) ?? titleForPhase(phase, event.label),
    detail: detail || titleForPhase(phase, event.label),
    reading: sanitizePublicTextArray(progress.reading),
    writing: sanitizePublicTextArray(progress.writing),
    waitingFor: sanitizePublicText(asString(progress.waitingFor) ?? asString(progress.waiting_for), { fallback: 'workspace activity' }),
    nextStep: sanitizePublicText(asString(progress.nextStep) ?? asString(progress.next_step), { fallback: 'Continue when new workspace activity arrives.' }),
    lastEvent: normalizeLastEvent(progress.lastEvent) ?? normalizeLastEvent(progress.last_event),
    reason: asString(progress.reason),
    recoveryHint: sanitizePublicText(asString(progress.recoveryHint) ?? asString(progress.recovery_hint), { fallback: 'Recovery details are available in the run audit.' }),
    canAbort: progress.canAbort === true || progress.can_abort === true,
    canContinue: progress.canContinue === true || progress.can_continue === true,
    status: normalizeStatus(asString(progress.status), phase),
  };
}

function compactProgressCandidates(source: unknown, depth = 0): unknown[] {
  if (depth > 5 || source === undefined || source === null) return [];
  if (Array.isArray(source)) return source.flatMap((item) => compactProgressCandidates(item, depth + 1));
  if (!isRecord(source)) return [];

  const direct: unknown[] = [];
  if (looksLikeCompactStreamEvent(source)) direct.push(source);
  const streamProcess = isRecord(source.streamProcess) ? source.streamProcess : undefined;
  if (streamProcess) {
    direct.push(...compactProgressCandidates(streamProcess.events, depth + 1));
    direct.push(...compactProgressCandidates(streamProcess.eventSummaries, depth + 1));
  }
  if (Array.isArray(source.runs)) direct.push(...compactProgressCandidates(source.runs, depth + 1));
  if (isRecord(source.raw)) direct.push(...compactProgressCandidates(source.raw, depth + 1));
  if (Array.isArray(source.events)) direct.push(...compactProgressCandidates(source.events, depth + 1));
  if (isRecord(source.progress)) direct.push({ type: PROCESS_PROGRESS_EVENT_TYPE, progress: source.progress });
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
  const compactDetail = asString(value.detail) ?? '';
  const detail = isInteractionProgressCompactType(type)
    ? compactDetail
    : compactDetail;
  const createdAt = asString(value.createdAt) ?? asString(value.created_at) ?? nowIso();
  if (isRecord(value.progress)) {
    return progressModelFromEvent({
      id: asString(value.id) ?? makeId('evt'),
      type,
      label,
      detail,
      createdAt,
      raw: { type, progress: value.progress },
    });
  }
  const interactionProgress = runtimeInteractionProgressEventFromCompactRecord(value);
  if (interactionProgress) return progressModelFromInteractionProgress(interactionProgress, { compactDetail: true });
  const raw = compactEventRaw(value, type, label, detail);
  if (isInteractionProgressCompactType(type) && !isRecord(raw.progress)) return undefined;
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
  return undefined;
}

function compactEventRaw(value: Record<string, unknown>, type: string, label: string, detail: string): Record<string, unknown> {
  if (isRecord(value.raw)) return value.raw;
  if (value.schemaVersion === 'sciforge.interaction-progress-event.v1') return value;
  if (isRecord(value.progress)) return { type, progress: value.progress };
  return { type };
}

function progressModelFromCompactText(value: unknown): ProcessProgressModel | undefined {
  if (typeof value !== 'string') return undefined;
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean);
  const latestStructuredBlock = latestStructuredDetailBlock(lines);
  if (latestStructuredBlock) return progressModelFromStructuredDetail(latestStructuredBlock);
  const wholeStructured = progressModelFromStructuredDetail(value);
  if (wholeStructured) return wholeStructured;
  for (const line of [...lines].reverse()) {
    const model = progressModelFromTranscriptLine(line);
    if (model) return model;
  }
  return undefined;
}

function latestStructuredDetailBlock(lines: string[]) {
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    const normalized = stripStructuredDetailPrefix(line);
    if (/\bPhase:\s*/.test(normalized)) {
      if (current.length) blocks.push(current);
      current = [normalized];
      continue;
    }
    if (current.length && /^(Status|Reason|Cancellation|Interaction):\s*/.test(normalized)) {
      current.push(normalized);
      continue;
    }
    if (current.length) {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks.at(-1)?.join('\n');
}

function stripStructuredDetailPrefix(line: string) {
  return line.replace(/^[^:：]+[:：]\s*(?=Phase:\s*)/, '').trim();
}

function progressModelFromTranscriptLine(line: string): ProcessProgressModel | undefined {
  const structured = progressModelFromStructuredDetail(line);
  if (structured) return structured;
  const separator = line.indexOf(':');
  const label = separator > 0 ? line.slice(0, separator).trim() : '';
  const headline = separator > 0 ? line.slice(separator + 1).trim() : line;
  if (!headline || (!label && !/读 |写 |等 |最近 |下一步 |Reading |Writing |Waiting for |Latest |Next |Phase:|Status:/i.test(headline))) return undefined;
  const parts = headline.split(/\s+·\s+/).map((part) => part.trim()).filter(Boolean);
  const title = parts[0] || label || headline;
  const reading: string[] = [];
  const writing: string[] = [];
  let waitingFor: string | undefined;
  let nextStep: string | undefined;
  let lastEvent: ProcessProgressModel['lastEvent'];
  for (const part of parts.slice(1)) {
    const read = part.match(/^(?:读|Reading)\s+(.+)$/);
    if (read?.[1]) reading.push(...splitCompactList(read[1]));
    const write = part.match(/^(?:写|Writing)\s+(.+)$/);
    if (write?.[1]) writing.push(...splitCompactList(write[1]));
    const wait = part.match(/^(?:等|Waiting for)\s+(.+)$/);
    if (wait?.[1]) waitingFor = wait[1].trim();
    const recent = part.match(/^(?:最近|Latest)\s+([^:：]+)[:：]\s*(.+)$/);
    if (recent?.[1] && recent?.[2]) lastEvent = { label: recent[1].trim(), detail: recent[2].trim() };
    const next = part.match(/^(?:下一步|Next)\s+(.+)$/);
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
    title: titleForPhase(phase, phaseText ?? 'progress'),
    detail,
    reading: [],
    writing: [],
    waitingFor: interaction?.includes('human-approval') ? 'approval' : interaction?.includes('clarification') ? 'clarification' : undefined,
    nextStep: interaction?.includes('human-approval') ? 'Wait for approval before continuing the guarded step.' : undefined,
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

function progressModelFromInteractionProgress(
  progress: RuntimeInteractionProgressEvent,
  options: { compactDetail?: boolean } = {},
): ProcessProgressModel {
  const presentation = runtimeInteractionProgressPresentation(progress);
  const phase = normalizePhase(progress.phase ?? progress.type);
  const interactionKind = progress.interaction?.kind;
  const detail = interactionProgressModelDetail(progress, presentation?.detail, options);
  return {
    phase,
    title: presentation?.label ?? titleForPhase(phase, progress.type),
    detail,
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

function interactionProgressModelDetail(
  progress: RuntimeInteractionProgressEvent,
  publicDetail: string | undefined,
  options: { compactDetail?: boolean },
) {
  const structuredDetail = [
    publicDetail,
    progress.reason ? `Reason: ${progress.reason}` : '',
    options.compactDetail ? interactionProgressModelInteractionLine(progress.interaction) : '',
  ].filter(Boolean).join('\n');
  return structuredDetail || progress.reason || progress.type;
}

function interactionProgressModelInteractionLine(interaction: RuntimeInteractionProgressEvent['interaction']) {
  if (!interaction?.kind) return '';
  const requirement = interaction.required === false ? 'optional' : 'required';
  return `Interaction: ${interaction.kind} ${requirement}`;
}

function latestNonSyntheticEvent(events: AgentStreamEvent[]) {
  for (const event of [...events].reverse()) {
    const raw = isRecord(event.raw) ? event.raw : {};
    if (isRuntimeAuditOnlyEvent(event)) continue;
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
  const label = sanitizePublicText(event.label || event.type || 'Event', { fallback: 'Event', maxLength: 80 }) ?? 'Event';
  const detail = sanitizePublicText(event.detail || event.type || event.label || 'event', { fallback: PUBLIC_RUNTIME_AUDIT_FALLBACK, maxLength: 180 })
    ?? PUBLIC_RUNTIME_AUDIT_FALLBACK;
  return {
    label,
    detail,
    createdAt: event.createdAt,
  };
}

function normalizeLastEvent(value: unknown): ProcessProgressModel['lastEvent'] | undefined {
  if (!isRecord(value)) return undefined;
  if (isRuntimeAuditOnlyEvent(value)) return undefined;
  const label = sanitizePublicText(asString(value.label) ?? asString(value.type), { fallback: 'Event', maxLength: 80 });
  const detail = sanitizePublicText(asString(value.detail) ?? asString(value.message) ?? asString(value.text), { fallback: PUBLIC_RUNTIME_AUDIT_FALLBACK, maxLength: 180 });
  if (!label || !detail) return undefined;
  return {
    label,
    detail,
    createdAt: sanitizePublicText(asString(value.createdAt) ?? asString(value.created_at), { maxLength: 80 }),
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
  if (interactionKind === 'human-approval') return 'approval';
  if (interactionKind === 'clarification') return 'clarification';
  if (interactionKind === 'guidance') return 'merge guidance after the current run';
  if (required) return 'user input';
  return type === GUIDANCE_QUEUED_EVENT_TYPE ? 'merge guidance after the current run' : undefined;
}

function nextStepForInteraction(type: string, interactionKind: string | undefined) {
  if (type === 'run-cancelled') return 'The run ended; the structured termination reason is saved for the next turn.';
  if (interactionKind === 'guidance') return 'Wait for the current run to end, then merge into the next turn.';
  if (interactionKind === 'human-approval') return 'Wait for approval before continuing the guarded step.';
  if (interactionKind === 'clarification') return 'Wait for clarification before continuing.';
  return undefined;
}

function isInteractionProgressCompactType(type: string) {
  return type === PROCESS_PROGRESS_EVENT_TYPE
    || type === 'interaction-request'
    || type === 'clarification-needed'
    || type === 'human-approval-required'
    || type === GUIDANCE_QUEUED_EVENT_TYPE
    || type === 'run-cancelled';
}

function titleForPhase(phase: ProcessProgressPhase, fallback: string) {
  if (phase === PROCESS_PROGRESS_PHASE.READ) return 'Reading';
  if (phase === PROCESS_PROGRESS_PHASE.WRITE) return 'Writing';
  if (phase === PROCESS_PROGRESS_PHASE.EXECUTE) return 'Running';
  if (phase === PROCESS_PROGRESS_PHASE.WAIT) return 'Waiting';
  if (phase === PROCESS_PROGRESS_PHASE.PLAN) return 'Planning next step';
  if (phase === PROCESS_PROGRESS_PHASE.COMPLETE) return 'Step complete';
  if (phase === PROCESS_PROGRESS_PHASE.ERROR) return 'Blocked';
  return fallback || 'Watching activity';
}
