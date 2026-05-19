import type { PreviewDescriptor, RuntimeArtifact, SciForgeRun, SciForgeSession } from '../domain';
import { artifactHasUserFacingDelivery } from '../../../../packages/support/object-references';
import { normalizeArtifactPreviewDescriptor } from './results/previewDescriptor';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionForSession,
  conversationProjectionRecoverActions,
  conversationProjectionStatus,
  conversationProjectionVisibleText,
} from './conversation-projection-view-model';
import { runAuditRefs, runPresentationState } from './results-renderer-execution-model';
import {
  createApproveResultUIAction,
  createCancelRunUIAction,
  createLoadArtifactPreviewUIAction,
  createOpenDebugAuditUIAction,
  createRequestRetryUIAction,
  createSelectObjectUIAction,
  createSubmitTurnUIAction,
  createTriggerRecoverUIAction,
  createUpdateCapabilityPreferenceUIAction,
  commandTextForAskRef,
  commandTextForCapabilityPreference,
  commandTextForOpen,
  commandTextForRecover,
  commandTextForRerun,
  type UIAction,
} from './uiActionBoundary';

export interface ProjectionApi {
  getConversationProjection(input: { session: SciForgeSession; focusedRunId?: string }): Promise<ConversationProjectionView>;
  listRuns(input: { session: SciForgeSession; filter?: 'all' | 'active' | 'recoverable' | 'completed' | 'failed' }): Promise<RunSummary[]>;
  getRunProjection(input: { session: SciForgeSession; runId: string }): Promise<RunProjectionView>;
  getArtifactPreview(input: { session: SciForgeSession; artifactRef: string; mode?: 'summary' | 'inline' | 'manual-load' | 'raw'; byteLimit?: number }): Promise<ArtifactPreview>;
  getExecutionTrace(input: { session: SciForgeSession; runId: string; audience: 'user' | 'debug' | 'audit' }): Promise<ExecutionTraceView>;
  getCapabilityPlanSummary(input: { session: SciForgeSession; runId?: string }): Promise<CapabilityPlanSummary | undefined>;
}

export interface ProjectionSubscriptionApi {
  subscribeConversationProjection(
    input: { session: SciForgeSession; focusedRunId?: string },
    listener: (event: ProjectionSubscriptionEvent) => void,
  ): () => void;
}

export interface UserActionApi {
  submitTurn(input: { session: SciForgeSession; text: string; selectedRefs?: string[] }): Promise<UserActionResult>;
  selectObject(input: { session: SciForgeSession; objectRef: string; intent: 'inspect' | 'ask-followup' | 'compare' | 'pin' }): Promise<UserActionResult>;
  loadArtifactPreview(input: { session: SciForgeSession; artifactRef: string; byteLimit?: number }): Promise<ArtifactPreview>;
  openDebugAudit(input: { session: SciForgeSession; runId?: string }): Promise<UserActionResult>;
  requestRetry(input: { session: SciForgeSession; runId: string; reason?: string; scope: 'same-input' | 'with-repair-evidence' | 'rediscover-capabilities' }): Promise<UserActionResult>;
  triggerRecover(input: { session: SciForgeSession; runId: string; recoverAction: string }): Promise<UserActionResult>;
  approveResult(input: { session: SciForgeSession; runId: string; approval: 'human-approved' | 'reject-result'; note?: string }): Promise<UserActionResult>;
  cancelRun(input: { session: SciForgeSession; runId: string; rejectedGuidanceIds?: string[] }): Promise<UserActionResult>;
  updateCapabilityPreference(input: { session: SciForgeSession; preference: Record<string, unknown> }): Promise<UserActionResult>;
}

export interface ConversationProjectionView {
  sessionId: string;
  visibleAnswer: {
    status: ReturnType<typeof conversationProjectionStatus>;
    text: string;
    primaryArtifactRefs: string[];
    nextActions: UserActionDescriptor[];
  };
  focusedRun?: RunSummary;
  artifacts: ArtifactCard[];
  verification: VerificationSummary;
  debugAvailable: boolean;
}

export interface RunSummary {
  runId: string;
  status: string;
  presentationKind: string;
  title: string;
  artifactRefs: string[];
  recoverActions: string[];
}

export interface RunProjectionView {
  run: RunSummary;
  answer: ConversationProjectionView['visibleAnswer'];
  trace: ExecutionTraceView;
}

export interface ArtifactPreview {
  artifactRef: string;
  status: 'ready' | 'requires-manual-load' | 'too-large' | 'unavailable' | 'unsupported';
  title: string;
  mediaType?: string;
  sizeBytes?: number;
  preview?: string;
  structuredData?: unknown;
  actions: UserActionDescriptor[];
  sourceAction?: UIAction;
}

export interface ExecutionTraceView {
  runId: string;
  audience: 'user' | 'debug' | 'audit';
  events: Array<{ id: string; label: string; ref?: string }>;
}

export interface CapabilityPlanSummary {
  status: 'none' | 'available';
  summary: string;
  debugRefs: string[];
}

export interface UserActionResult {
  accepted: boolean;
  projection?: ConversationProjectionView;
  queuedRunId?: string;
  message?: string;
  auditRef?: string;
  commandText?: string;
  action?: UIAction;
}

export type ProjectionSubscriptionEvent =
  | {
    type: 'projection-restored';
    projection: ConversationProjectionView;
    run?: RunSummary;
  };

export interface UserActionDescriptor {
  id: string;
  label: string;
  kind: 'inspect' | 'load-preview' | 'retry' | 'approve' | 'cancel' | 'debug' | 'capability-preference';
  commandText: string;
  ref?: string;
}

interface ArtifactCard {
  artifactRef: string;
  title: string;
  type: string;
}

interface VerificationSummary {
  status: string;
  verifierRef?: string;
}

export function createLocalProjectionApi(): ProjectionApi {
  return {
    async getConversationProjection(input) {
      const run = focusedRun(input.session, input.focusedRunId);
      return conversationProjectionView(input.session, run);
    },
    async listRuns(input) {
      return input.session.runs
        .map((run) => runSummary(input.session, run))
        .filter((summary) => runSummaryMatchesFilter(summary, input.filter ?? 'all'));
    },
    async getRunProjection(input) {
      const run = focusedRun(input.session, input.runId);
      if (!run) throw new Error(`Unknown run ${input.runId}`);
      const projection = conversationProjectionView(input.session, run);
      return {
        run: runSummary(input.session, run),
        answer: projection.visibleAnswer,
        trace: executionTraceView(input.session, run, 'user'),
      };
    },
    async getArtifactPreview(input) {
      return artifactPreviewView(input.session, input.artifactRef, input.mode ?? 'summary', input.byteLimit);
    },
    async getExecutionTrace(input) {
      const run = focusedRun(input.session, input.runId);
      if (!run) throw new Error(`Unknown run ${input.runId}`);
      return executionTraceView(input.session, run, input.audience);
    },
    async getCapabilityPlanSummary(input) {
      return capabilityPlanSummaryForSession(input.session, input.runId);
    },
  };
}

export function createLocalProjectionSubscriptionApi(projectionApi: ProjectionApi = createLocalProjectionApi()): ProjectionSubscriptionApi {
  return {
    subscribeConversationProjection(input, listener) {
      let active = true;
      void projectionApi.getConversationProjection(input).then((projection) => {
        if (!active) return;
        listener({
          type: 'projection-restored',
          projection,
          run: projection.focusedRun,
        });
      });
      return () => {
        active = false;
      };
    },
  };
}

export function createLocalUserActionApi(projectionApi: ProjectionApi = createLocalProjectionApi()): UserActionApi {
  return {
    async submitTurn(input) {
      const action = createSubmitTurnUIAction({
        session: input.session,
        id: actionId('submit-turn'),
        createdAt: new Date().toISOString(),
        prompt: input.text,
        references: (input.selectedRefs ?? []).map((ref) => ({ id: ref, kind: 'task-result', ref, title: ref })),
      });
      return acceptedAction(action, await projectionApi.getConversationProjection({ session: input.session }));
    },
    async selectObject(input) {
      const action = createSelectObjectUIAction({
        session: input.session,
        id: actionId('select-object'),
        createdAt: new Date().toISOString(),
        objectRef: input.objectRef,
        intent: input.intent,
      });
      return acceptedAction(action, await projectionApi.getConversationProjection({ session: input.session }), '对象已通过 UserActionApi 选中。');
    },
    async loadArtifactPreview(input) {
      const action = createLoadArtifactPreviewUIAction({
        session: input.session,
        id: actionId('load-artifact-preview'),
        createdAt: new Date().toISOString(),
        artifactRef: input.artifactRef,
        byteLimit: input.byteLimit,
      });
      const preview = await projectionApi.getArtifactPreview({
        session: input.session,
        artifactRef: input.artifactRef,
        mode: 'manual-load',
        byteLimit: input.byteLimit,
      });
      return { ...preview, sourceAction: action };
    },
    async openDebugAudit(input) {
      const run = focusedRun(input.session, input.runId);
      const capabilitySummary = capabilityPlanSummaryForSession(input.session, run?.id);
      const action = createOpenDebugAuditUIAction({
        session: input.session,
        id: actionId('open-debug-audit'),
        createdAt: new Date().toISOString(),
        runId: run?.id,
        auditRefs: uniqueStrings([
          ...runAuditRefs(input.session, run),
          ...(capabilitySummary?.debugRefs ?? []),
        ].filter(isSafeDebugActionRef)),
      });
      return acceptedAction(action, await projectionApi.getConversationProjection({ session: input.session, focusedRunId: run?.id }), '调试审计展开动作已记录。');
    },
    async requestRetry(input) {
      const auditRefs = runAuditRefs(input.session, focusedRun(input.session, input.runId));
      const action = createRequestRetryUIAction({
        session: input.session,
        id: actionId('request-retry'),
        createdAt: new Date().toISOString(),
        runId: input.runId,
        reason: input.reason,
        scope: input.scope,
        auditRefs,
      });
      return acceptedAction(
        action,
        await projectionApi.getConversationProjection({ session: input.session, focusedRunId: input.runId }),
        '重试请求已转换为终端等价文本。',
        commandTextForRerun({ runId: input.runId, scope: input.scope, reason: input.reason, auditRefs }),
      );
    },
    async triggerRecover(input) {
      const auditRefs = runAuditRefs(input.session, focusedRun(input.session, input.runId));
      const action = createTriggerRecoverUIAction({
        session: input.session,
        id: actionId('trigger-recover'),
        createdAt: new Date().toISOString(),
        runId: input.runId,
        recoverAction: input.recoverAction,
        auditRefs,
      });
      return acceptedAction(
        action,
        await projectionApi.getConversationProjection({ session: input.session, focusedRunId: input.runId }),
        '恢复请求已转换为终端等价文本。',
        commandTextForRecover({ runId: input.runId, recoverAction: input.recoverAction, auditRefs }),
      );
    },
    async approveResult(input) {
      const action = createApproveResultUIAction({
        session: input.session,
        id: actionId('approve-result'),
        createdAt: new Date().toISOString(),
        runId: input.runId,
        approval: input.approval,
        note: input.note,
      });
      return acceptedAction(action, await projectionApi.getConversationProjection({ session: input.session, focusedRunId: input.runId }));
    },
    async cancelRun(input) {
      const action = createCancelRunUIAction({
        session: input.session,
        id: actionId('cancel-run'),
        createdAt: new Date().toISOString(),
        runId: input.runId,
        rejectedGuidanceIds: input.rejectedGuidanceIds,
      });
      return acceptedAction(action, await projectionApi.getConversationProjection({ session: input.session, focusedRunId: input.runId }), '取消请求已记录为语义动作。');
    },
    async updateCapabilityPreference(input) {
      const action = createUpdateCapabilityPreferenceUIAction({
        session: input.session,
        id: actionId('update-capability-preference'),
        createdAt: new Date().toISOString(),
        preference: input.preference,
      });
      return acceptedAction(
        action,
        await projectionApi.getConversationProjection({ session: input.session }),
        undefined,
        commandTextForCapabilityPreference(input.preference),
      );
    },
  };
}

function conversationProjectionView(session: SciForgeSession, run?: SciForgeRun): ConversationProjectionView {
  const projection = conversationProjectionForSession(session, run);
  const presentation = runPresentationState(session, run);
  const artifactRefs = projection ? conversationProjectionArtifactRefs(projection) : [];
  const recoverActions = projection ? conversationProjectionRecoverActions(projection) : [];
  return {
    sessionId: session.sessionId,
    visibleAnswer: {
      status: projection ? conversationProjectionStatus(projection) : 'idle',
      text: projection ? conversationProjectionVisibleText(projection) ?? projection.visibleAnswer?.diagnostic ?? presentation.reason : presentation.reason,
      primaryArtifactRefs: artifactRefs,
      nextActions: [
        ...artifactRefs.map((ref) => ({ id: `inspect:${ref}`, label: '基于该 artifact 追问', kind: 'inspect' as const, ref, commandText: commandTextForAskRef(ref) })),
        ...recoverActions.map((action, index) => ({
          id: `retry:${index}`,
          label: action,
          kind: 'retry' as const,
          commandText: commandTextForRecover({ runId: run?.id, recoverAction: action, auditRefs: runAuditRefs(session, run) }),
        })),
      ],
    },
    focusedRun: run ? runSummary(session, run) : undefined,
    artifacts: artifactRefs.map((ref) => artifactCard(session, ref)).filter((card): card is ArtifactCard => Boolean(card)),
    verification: {
      status: projection?.verificationState?.status ?? 'unknown',
      verifierRef: projection?.verificationState?.verifierRef,
    },
    debugAvailable: runAuditRefs(session, run).length > 0,
  };
}

function runSummary(session: SciForgeSession, run: SciForgeRun): RunSummary {
  const projection = conversationProjectionForSession(session, run);
  const presentation = runPresentationState(session, run);
  return {
    runId: run.id,
    status: projection ? conversationProjectionStatus(projection) : run.status,
    presentationKind: presentation.kind,
    title: presentation.title,
    artifactRefs: projection ? conversationProjectionArtifactRefs(projection) : [],
    recoverActions: projection ? conversationProjectionRecoverActions(projection) : [],
  };
}

function artifactPreviewView(
  session: SciForgeSession,
  artifactRef: string,
  mode: 'summary' | 'inline' | 'manual-load' | 'raw',
  byteLimit: number | undefined,
): ArtifactPreview {
  const artifact = artifactForRef(session, artifactRef);
  if (!artifact) {
    return {
      artifactRef,
      status: 'unavailable',
      title: artifactRef,
      actions: [],
    };
  }
  if (!artifactHasUserFacingDelivery(artifact)) {
    return {
      artifactRef,
      status: 'unsupported',
      title: artifactTitle(artifact),
      mediaType: artifact.type,
      actions: [{ id: `debug:${artifactRef}`, label: '查看调试信息', kind: 'debug', ref: artifactRef, commandText: commandTextForOpen(artifactRef) }],
    };
  }
  const descriptor = normalizeArtifactPreviewDescriptor(artifact, artifactPath(artifact));
  const sizeBytes = descriptor?.sizeBytes
    ?? numberField(isRecord(artifact.delivery) ? artifact.delivery.sizeBytes : undefined)
    ?? numberField(isRecord(artifact.metadata) ? artifact.metadata.sizeBytes : undefined);
  const manual = mode !== 'manual-load' && (descriptor?.inlinePolicy !== 'inline' || (sizeBytes ?? 0) > (byteLimit ?? 1024 * 1024));
  return {
    artifactRef,
    status: manual ? 'requires-manual-load' : 'ready',
    title: artifactTitle(artifact),
    mediaType: stringField(artifact.delivery?.declaredMediaType) ?? artifact.type,
    sizeBytes,
    preview: manual ? undefined : inlineArtifactPreview(artifact, descriptor),
    structuredData: manual || mode === 'raw' ? undefined : structuredArtifactData(artifact),
    actions: manual
      ? [{ id: `load:${artifactRef}`, label: '加载预览', kind: 'load-preview', ref: artifactRef, commandText: commandTextForOpen(artifactRef) }]
      : [{ id: `select:${artifactRef}`, label: '基于该 artifact 追问', kind: 'inspect', ref: artifactRef, commandText: commandTextForAskRef(artifactRef) }],
  };
}

function executionTraceView(session: SciForgeSession, run: SciForgeRun, audience: 'user' | 'debug' | 'audit'): ExecutionTraceView {
  const projection = conversationProjectionForSession(session, run);
  const projectionEvents = projection?.executionProcess.map((event) => ({ id: event.eventId, label: event.summary || event.type }));
  if (projectionEvents?.length) return { runId: run.id, audience, events: projectionEvents };
  if (audience === 'user') return { runId: run.id, audience, events: [] };
  return {
    runId: run.id,
    audience,
    events: runAuditRefs(session, run).map((ref, index) => ({ id: `audit:${index}`, label: 'audit ref', ref })),
  };
}

export function capabilityPlanSummaryForSession(session: SciForgeSession, runId?: string): CapabilityPlanSummary | undefined {
  const run = focusedRun(session, runId);
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  const summary = stringField(raw?.capabilityPlanSummary) ?? stringField(raw?.capabilityDiscoverySummary);
  const toolResults = capabilityDiscoveryToolResultsFromRaw(raw);
  const generatedSummary = capabilityDiscoverySummaryFromToolResults(toolResults);
  const displaySummary = summary ?? generatedSummary;
  if (!displaySummary) return undefined;
  return {
    status: 'available',
    summary: displaySummary,
    debugRefs: uniqueStrings([
      ...toolResults.flatMap((result) => toStringList(result.auditRefs).filter(isSafeCapabilityDebugRef)),
      ...runAuditRefs(session, run).filter((ref) => /capability|discovery/i.test(ref)),
    ]),
  };
}

function isSafeCapabilityDebugRef(ref: string) {
  return /capability|discovery/i.test(ref)
    && !/https?:\/\/|localhost|127\.0\.0\.1|token|secret|api[_-]?key|\/(?:Applications|Users|private|var|tmp)\//i.test(ref);
}

function isSafeDebugActionRef(ref: string) {
  return Boolean(ref.trim())
    && !/https?:\/\/|localhost|127\.0\.0\.1|token|secret|api[_-]?key|\/(?:Applications|Users|private|var|tmp)\//i.test(ref);
}

function capabilityDiscoveryToolResultsFromRaw(raw: Record<string, unknown> | undefined): Record<string, unknown>[] {
  if (!raw) return [];
  return [
    raw.capabilityDiscoveryToolResults,
    isRecord(raw.contextEnvelope) ? raw.contextEnvelope.capabilityDiscoveryToolResults : undefined,
    isRecord(raw.metadata) ? raw.metadata.capabilityDiscoveryToolResults : undefined,
    isRecord(raw.input) && isRecord(raw.input.metadata) ? raw.input.metadata.capabilityDiscoveryToolResults : undefined,
  ].flatMap(toRecordList);
}

function capabilityDiscoverySummaryFromToolResults(results: Record<string, unknown>[]): string | undefined {
  const plan = results
    .map((event) => isRecord(event.result) ? event.result : undefined)
    .find((result) => result && (Array.isArray(result.steps) || stringField(result.summary)));
  if (plan) {
    const planSummary = stringField(plan.summary);
    const steps = toRecordList(plan.steps)
      .map((step) => stringField(step.capabilityId))
      .filter((value): value is string => Boolean(value))
      .slice(0, 4);
    return [
      planSummary ?? 'SciForge 已生成能力使用计划。',
      steps.length ? `计划能力：${steps.join('、')}。` : undefined,
      '能力发现本身不是任务完成证据，仍需执行所选 capability 并验证结果。',
    ].filter(Boolean).join(' ');
  }
  const candidates = uniqueStrings(results.flatMap((event) => {
    const result = isRecord(event.result) ? event.result : undefined;
    return toRecordList(result?.candidates)
      .map((candidate) => stringField(candidate.title) ?? stringField(candidate.capabilityId))
      .filter((value): value is string => Boolean(value));
  })).slice(0, 5);
  if (!candidates.length) return undefined;
  return `SciForge 已发现可用能力候选：${candidates.join('、')}。能力发现本身不是任务完成证据，仍需执行所选 capability 并验证结果。`;
}

function acceptedAction(action: UIAction, projection: ConversationProjectionView, message?: string, commandText?: string): UserActionResult {
  return {
    accepted: true,
    projection,
    message,
    auditRef: `ui-action:${action.id}`,
    commandText,
    action,
  };
}

function runSummaryMatchesFilter(summary: RunSummary, filter: 'all' | 'active' | 'recoverable' | 'completed' | 'failed') {
  if (filter === 'all') return true;
  if (filter === 'active') return summary.presentationKind === 'running';
  if (filter === 'recoverable') return summary.presentationKind === 'recoverable' || summary.recoverActions.length > 0;
  if (filter === 'completed') return summary.status === 'satisfied';
  return summary.presentationKind === 'failed';
}

function focusedRun(session: SciForgeSession, focusedRunId?: string) {
  return focusedRunId ? session.runs.find((run) => run.id === focusedRunId) : session.runs.at(-1);
}

function artifactForRef(session: SciForgeSession, artifactRef: string) {
  const id = artifactRef.replace(/^artifact::?/, '');
  return session.artifacts.find((artifact) => artifact.id === id || artifact.delivery?.ref === artifactRef);
}

function artifactCard(session: SciForgeSession, artifactRef: string): ArtifactCard | undefined {
  const artifact = artifactForRef(session, artifactRef);
  if (!artifact || !artifactHasUserFacingDelivery(artifact)) return undefined;
  return {
    artifactRef,
    title: artifactTitle(artifact),
    type: artifact.type,
  };
}

function artifactTitle(artifact: RuntimeArtifact) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : undefined;
  return stringField(metadata?.title) || stringField(metadata?.label) || artifact.id;
}

function artifactPath(artifact: RuntimeArtifact) {
  return stringField(artifact.delivery?.readableRef)
    ?? stringField(artifact.dataRef)
    ?? stringField(artifact.path);
}

function inlineArtifactPreview(artifact: RuntimeArtifact, descriptor?: PreviewDescriptor) {
  if (descriptor?.inlinePolicy && descriptor.inlinePolicy !== 'inline') return undefined;
  const data = artifact.data;
  if (typeof data === 'string') return data.slice(0, 12_000);
  if (isRecord(data)) {
    const markdown = stringField(data.markdown) ?? stringField(data.content) ?? stringField(data.text);
    if (markdown) return markdown.slice(0, 12_000);
  }
  return undefined;
}

function structuredArtifactData(artifact: RuntimeArtifact) {
  return typeof artifact.data === 'string' ? undefined : artifact.data;
}

function actionId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
