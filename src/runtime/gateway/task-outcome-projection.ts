import {
  createTaskRunCard,
  validateTaskRunCard,
  type FailureSignatureInput,
  type OwnershipLayerSuggestion,
  type TaskAttributionLayer,
  type TaskOutcomeStatus,
  type TaskProtocolStatus,
  type TaskRunCard,
  type TaskRunCardRef,
} from '@sciforge-ui/runtime-contract/task-run-card';
import type { RuntimeExecutionUnit } from '@sciforge-ui/runtime-contract/execution';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';

export const TASK_OUTCOME_PROJECTION_SCHEMA_VERSION = 'sciforge.gateway-task-outcome-projection.v1' as const;
export const USER_SATISFACTION_PROXY_SCHEMA_VERSION = 'sciforge.user-satisfaction-proxy.v1' as const;
export const NEXT_STEP_ATTRIBUTION_SCHEMA_VERSION = 'sciforge.next-step-attribution.v1' as const;
const externalServiceLayer = ['external', 'provider'].join('-') as TaskAttributionLayer;
const transientUnavailableStatus = ['transient', 'unavailable'].join('-');

export interface GatewayTaskOutcomeProjectionContext {
  request?: GatewayRequest;
  skill?: SkillAvailability;
  refs?: {
    taskRel?: string;
    outputRel?: string;
    stdoutRel?: string;
    stderrRel?: string;
  };
}

export interface UserSatisfactionProxy {
  schemaVersion: typeof USER_SATISFACTION_PROXY_SCHEMA_VERSION;
  answeredLatestRequest: boolean;
  usableResultVisible: boolean;
  structuredNextStep: boolean;
  preservesWorkRefs: boolean;
  avoidsDuplicateWork: boolean;
  score: number;
  status: 'likely-satisfied' | 'needs-work' | 'needs-human' | 'blocked' | 'unknown';
  reasons: string[];
}

export interface NextStepAttribution {
  schemaVersion: typeof NEXT_STEP_ATTRIBUTION_SCHEMA_VERSION;
  ownerLayer: TaskAttributionLayer;
  nextStep: string;
  reason: string;
  sourceRefs: string[];
  sourceSignals: string[];
}

export interface GatewayTaskOutcomeProjection {
  schemaVersion: typeof TASK_OUTCOME_PROJECTION_SCHEMA_VERSION;
  taskRunCard: TaskRunCard;
  protocolSuccess: boolean;
  taskSuccess: boolean;
  userSatisfactionProxy: UserSatisfactionProxy;
  nextStepAttribution: NextStepAttribution;
  ownershipLayerSuggestions: OwnershipLayerSuggestion[];
  projectionRules: string[];
}

export function attachTaskOutcomeProjection(
  payload: ToolPayload,
  context: GatewayTaskOutcomeProjectionContext = {},
): ToolPayload {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const existingProjection = isGatewayTaskOutcomeProjection(displayIntent.taskOutcomeProjection)
    ? displayIntent.taskOutcomeProjection
    : undefined;
  const projection = existingProjection ?? materializeTaskOutcomeProjection({ payload, ...context });
  return {
    ...payload,
    displayIntent: {
      ...displayIntent,
      taskRunCard: isValidTaskRunCard(displayIntent.taskRunCard) ? displayIntent.taskRunCard : projection.taskRunCard,
      taskOutcomeProjection: projection,
    },
  };
}

export function materializeTaskOutcomeProjection(input: GatewayTaskOutcomeProjectionContext & {
  payload: ToolPayload;
}): GatewayTaskOutcomeProjection {
  const refs = refsFromPayload(input.payload, input.refs);
  const units = runtimeExecutionUnits(input.payload);
  const failures = failureSignaturesFromPayload(input.payload);
  const protocolStatus = protocolStatusFromPayload(input.payload, units);
  const nextStepAttribution = nextStepAttributionFromPayload(input.payload, refs, failures);
  const userSatisfactionProxy = userSatisfactionProxyFromPayload(input.payload, input.request, refs, protocolStatus, nextStepAttribution);
  const taskOutcome = taskOutcomeFromProjection(protocolStatus, input.payload, userSatisfactionProxy);
  const taskRunCard = createTaskRunCard({
    taskId: input.skill?.id,
    title: input.skill?.manifest?.description ?? input.request?.skillDomain,
    goal: input.request?.prompt ?? input.payload.message,
    protocolStatus,
    taskOutcome,
    refs,
    executionUnits: units,
    verificationRefs: verificationRefsFromPayload(input.payload),
    failureSignatures: failures,
    genericAttributionLayer: nextStepAttribution.ownerLayer,
    nextStep: nextStepAttribution.nextStep,
    noHardcodeReview: {
      appliesGenerally: true,
      generalityStatement: 'Gateway task outcome projection is derived from runtime payload status, evidence refs, expected artifacts, and execution unit semantics, not from prompt, scenario, paper, file, or backend names.',
      counterExamples: [
        'A syntactically valid payload that only promises future work should remain needs-work.',
        'A failed run with preserved partial refs should remain resumable instead of becoming complete.',
        'A transient provider failure should attribute recovery to the external-provider layer.',
      ],
    },
  });

  return {
    schemaVersion: TASK_OUTCOME_PROJECTION_SCHEMA_VERSION,
    taskRunCard,
    protocolSuccess: protocolStatus === 'protocol-success',
    taskSuccess: taskOutcome === 'satisfied',
    userSatisfactionProxy,
    nextStepAttribution,
    ownershipLayerSuggestions: taskRunCard.ownershipLayerSuggestions,
    projectionRules: [
      'Protocol success means the backend returned a parseable contract; task success means the current user goal appears satisfied.',
      'User satisfaction proxy is inferred from visible answer quality, usable artifacts/refs, next-step detail, and repeat-work avoidance.',
      'Next-step attribution names the generic failing or owning runtime layer without prompt/scenario hardcoding.',
    ],
  };
}

function protocolStatusFromPayload(payload: ToolPayload, units: RuntimeExecutionUnit[]): TaskProtocolStatus {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const explicit = stringField(displayIntent.protocolStatus);
  if (isTaskProtocolStatus(explicit)) return explicit;
  const text = `${payload.claimType} ${payload.evidenceLevel} ${payload.message} ${stringField(displayIntent.status) ?? ''}`.toLowerCase();
  if (/cancelled|canceled|user abort/.test(text)) return 'cancelled';
  if (/background|running|continuing/.test(text) || units.some((unit) => unit.status === 'running' || unit.status === 'planned')) return 'running';
  if (units.some((unit) => ['failed', 'failed-with-reason', 'repair-needed'].includes(unit.status))) return 'protocol-failed';
  if (payload.message || payload.artifacts.length || units.length || payload.claims.length) return 'protocol-success';
  return 'not-run';
}

function taskOutcomeFromProjection(
  protocolStatus: TaskProtocolStatus,
  payload: ToolPayload,
  proxy: UserSatisfactionProxy,
): TaskOutcomeStatus {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const explicit = stringField(displayIntent.taskOutcome);
  if (isTaskOutcomeStatus(explicit)) return explicit;
  if (proxy.status === 'needs-human') return 'needs-human';
  if (proxy.status === 'blocked') return 'blocked';
  if (protocolStatus === 'running' || protocolStatus === 'not-run') return 'unknown';
  if (protocolStatus === 'cancelled') return 'blocked';
  if (protocolStatus === 'protocol-failed') return proxy.preservesWorkRefs || proxy.usableResultVisible ? 'needs-work' : 'blocked';
  return proxy.status === 'likely-satisfied' ? 'satisfied' : 'needs-work';
}

function userSatisfactionProxyFromPayload(
  payload: ToolPayload,
  request: GatewayRequest | undefined,
  refs: TaskRunCardRef[],
  protocolStatus: TaskProtocolStatus,
  nextStep: NextStepAttribution,
): UserSatisfactionProxy {
  const units = toRecordList(payload.executionUnits);
  const expectedArtifactTypes = uniqueStrings([
    ...(request?.expectedArtifactTypes ?? []),
    ...toStringList(isRecord(request?.uiState) ? request?.uiState.expectedArtifactTypes : undefined),
  ]);
  const needsHuman = units.some((unit) => String(unit.status) === 'needs-human');
  const explicitFailure = protocolStatus === 'protocol-failed';
  const answeredLatestRequest = hasHumanAnswer(payload) && !looksLikeOnlyPlanPromise(payload.message) && !hasCurrentReferenceFailure(payload);
  const usableResultVisible = hasUsableVisibleResult(payload);
  const expectedArtifactsPresent = expectedArtifactTypes.length === 0 || expectedArtifactTypes.some((type) => {
    return payload.artifacts.some((artifact) => isRecord(artifact) && String(artifact.type || artifact.artifactType || '') === type);
  });
  const structuredNextStep = Boolean(nextStep.nextStep);
  const preservesWorkRefs = refs.length > 0;
  const avoidsDuplicateWork = !explicitFailure || preservesWorkRefs || usableResultVisible;
  const reasons = [
    answeredLatestRequest ? 'latest request has a visible answer' : 'latest request is not visibly answered yet',
    usableResultVisible ? 'usable answer/artifact evidence is visible' : 'no usable visible result or artifact was detected',
    expectedArtifactsPresent ? 'expected artifact coverage is present or not required' : 'one or more expected artifact types are missing',
    structuredNextStep ? 'structured next step is available' : 'structured next step is missing',
    preservesWorkRefs ? 'work refs are preserved for resume/audit' : 'no durable work refs are preserved',
    avoidsDuplicateWork ? 'projection can continue from existing refs' : 'rerun would risk repeating work without refs',
  ];
  const score = Math.round(100 * [
    answeredLatestRequest,
    usableResultVisible,
    expectedArtifactsPresent,
    structuredNextStep,
    preservesWorkRefs,
    avoidsDuplicateWork,
  ].filter(Boolean).length / 6) / 100;
  const status = needsHuman
    ? 'needs-human'
    : explicitFailure && !usableResultVisible && !preservesWorkRefs
      ? 'blocked'
      : protocolStatus === 'running' || protocolStatus === 'not-run'
        ? 'unknown'
        : score >= 0.75 && answeredLatestRequest && usableResultVisible && expectedArtifactsPresent
          ? 'likely-satisfied'
          : 'needs-work';
  return {
    schemaVersion: USER_SATISFACTION_PROXY_SCHEMA_VERSION,
    answeredLatestRequest,
    usableResultVisible,
    structuredNextStep,
    preservesWorkRefs,
    avoidsDuplicateWork,
    score,
    status,
    reasons,
  };
}

function nextStepAttributionFromPayload(
  payload: ToolPayload,
  refs: TaskRunCardRef[],
  failures: FailureSignatureInput[],
): NextStepAttribution {
  const units = toRecordList(payload.executionUnits);
  const evidence = payload.workEvidence ?? [];
  const verification = payload.verificationResults ?? [];
  const unitWithNextStep = units.find((unit) => stringField(unit.nextStep) || toStringList(unit.recoverActions).length);
  const workEvidenceWithNextStep = evidence.find((item) => item.nextStep || item.recoverActions.length);
  const verificationWithNextStep = verification.find((item) => item.repairHints?.length);
  const nextStep = stringField(unitWithNextStep?.nextStep)
    ?? toStringList(unitWithNextStep?.recoverActions)[0]
    ?? workEvidenceWithNextStep?.nextStep
    ?? workEvidenceWithNextStep?.recoverActions[0]
    ?? verificationWithNextStep?.repairHints?.[0]
    ?? defaultNextStepForPayload(payload, refs);
  const ownerLayer = layerFromPayload(payload, failures);
  return {
    schemaVersion: NEXT_STEP_ATTRIBUTION_SCHEMA_VERSION,
    ownerLayer,
    nextStep,
    reason: reasonForLayer(ownerLayer),
    sourceRefs: refs.slice(0, 12).map((ref) => ref.ref),
    sourceSignals: uniqueStrings([
      ...units.map((unit) => stringField(unit.status)).filter((value): value is string => Boolean(value)),
      ...units.map((unit) => stringField(unit.externalDependencyStatus)).filter((value): value is string => Boolean(value)),
      ...failures.map((failure) => failure.kind).filter((value): value is NonNullable<typeof value> => Boolean(value)),
    ]),
  };
}

function failureSignaturesFromPayload(payload: ToolPayload): FailureSignatureInput[] {
  const units = toRecordList(payload.executionUnits);
  const fromUnits = units.flatMap((unit): FailureSignatureInput[] => {
    const message = stringField(unit.failureReason) ?? stringField(unit.error) ?? stringField(unit.message);
    const status = stringField(unit.status);
    if (!message && !/failed|repair-needed|needs-human/i.test(status ?? '')) return [];
    return [{
      message: message ?? status ?? 'Execution unit did not complete successfully.',
      layer: layerFromExecutionUnit(unit),
      retryable: stringField(unit.externalDependencyStatus) === 'transient-unavailable' ? true : undefined,
      refs: unitRefs(unit),
    }];
  });
  const fromWorkEvidence = (payload.workEvidence ?? []).flatMap((evidence): FailureSignatureInput[] => {
    if (evidence.status === 'success') return [];
    const message = evidence.failureReason ?? evidence.nextStep ?? evidence.diagnostics?.[0];
    return message ? [{
      message,
      layer: 'verification',
      refs: uniqueStrings([...evidence.evidenceRefs, evidence.rawRef].filter((ref): ref is string => Boolean(ref))),
    }] : [];
  });
  return [...fromUnits, ...fromWorkEvidence];
}

function refsFromPayload(
  payload: ToolPayload,
  runtimeRefs: GatewayTaskOutcomeProjectionContext['refs'],
): TaskRunCardRef[] {
  const refs: TaskRunCardRef[] = [];
  for (const [key, ref] of Object.entries(runtimeRefs ?? {})) {
    if (typeof ref === 'string' && ref.trim()) refs.push({ kind: refKind(ref), ref, label: key });
  }
  for (const artifact of toRecordList(payload.artifacts)) {
    const ref = artifactRef(artifact);
    if (ref) refs.push({ kind: 'artifact', ref, label: stringField(artifact.title) ?? stringField(artifact.id) ?? stringField(artifact.type) });
  }
  for (const reference of toRecordList(payload.objectReferences)) {
    const ref = stringField(reference.ref) ?? stringField(reference.id);
    if (ref) refs.push({ kind: refKind(ref, stringField(reference.kind)), ref, label: stringField(reference.title), status: stringField(reference.status) });
  }
  for (const log of toRecordList(payload.logs)) {
    const ref = stringField(log.ref) ?? stringField(log.path);
    if (ref) refs.push({ kind: 'log', ref, label: stringField(log.kind) ?? stringField(log.label) });
  }
  for (const unit of toRecordList(payload.executionUnits)) {
    const id = stringField(unit.id);
    if (id) refs.push({ kind: 'execution-unit', ref: `execution-unit:${id}`, status: stringField(unit.status) });
    for (const ref of unitRefs(unit)) refs.push({ kind: refKind(ref), ref, label: id });
  }
  for (const ref of verificationRefsFromPayload(payload)) refs.push({ kind: 'verification', ref });
  return uniqueTaskRefs(refs);
}

function runtimeExecutionUnits(payload: ToolPayload): RuntimeExecutionUnit[] {
  return toRecordList(payload.executionUnits).map((unit, index) => ({
    id: stringField(unit.id) ?? `execution-unit-${index + 1}`,
    tool: stringField(unit.tool) ?? 'workspace-runtime-gateway',
    params: stringField(unit.params) ?? '{}',
    status: executionStatus(unit.status),
    hash: stringField(unit.hash) ?? String(index + 1),
    codeRef: stringField(unit.codeRef),
    stdoutRef: stringField(unit.stdoutRef),
    stderrRef: stringField(unit.stderrRef),
    outputRef: stringField(unit.outputRef),
    failureReason: stringField(unit.failureReason),
    recoverActions: toStringList(unit.recoverActions),
    nextStep: stringField(unit.nextStep),
    verificationRef: stringField(unit.verificationRef),
    verificationVerdict: verificationVerdict(unit.verificationVerdict),
  }));
}

function layerFromPayload(payload: ToolPayload, failures: FailureSignatureInput[]): TaskAttributionLayer {
  const units = toRecordList(payload.executionUnits);
  return failures.find((failure) => failure.layer)?.layer
    ?? units.map(layerFromExecutionUnit).find((layer) => layer !== 'unknown')
    ?? (payload.verificationResults?.some((result) => result.verdict !== 'pass') ? 'verification' : undefined)
    ?? 'runtime-server';
}

function layerFromExecutionUnit(unit: Record<string, unknown>): TaskAttributionLayer {
  if (stringField(unit.externalDependencyStatus) === transientUnavailableStatus) return externalServiceLayer;
  const refs = isRecord(unit.refs) ? unit.refs : {};
  if (isRecord(refs.validationFailure)) return 'payload-normalization';
  if (isRecord(refs.backendFailure)) return 'agentserver-parser';
  if (['fail', 'uncertain', 'needs-human'].includes(String(unit.verificationVerdict))) return 'verification';
  if (/missing ref|stale ref|deleted artifact|not found/i.test(String(unit.failureReason ?? unit.message ?? ''))) return 'resume';
  if (stringField(unit.stderrRef) || stringField(unit.stdoutRef) || stringField(unit.outputRef)) return 'runtime-server';
  return 'unknown';
}

function defaultNextStepForPayload(payload: ToolPayload, refs: TaskRunCardRef[]) {
  const text = `${payload.claimType} ${payload.evidenceLevel} ${payload.message}`.toLowerCase();
  if (/transient|rate.?limit|too many requests|timeout|service unavailable|429|503/.test(text)) {
    return 'Retry after provider backoff, or continue with cached evidence and label freshness explicitly.';
  }
  if (/failed|repair-needed|failure|失败/.test(text)) {
    return refs.length
      ? 'Inspect preserved refs and repair the generic failing layer before rerunning expensive work.'
      : 'Inspect the backend failure and return a structured failed-with-reason payload before rerun.';
  }
  if (/partial|missing|unavailable|insufficient|unverified/.test(text)) {
    return 'Continue from preserved partial refs, fill the missing evidence, or ask the user to adjust scope.';
  }
  return 'Inspect generated artifacts and preserve refs for follow-up, export, or audit.';
}

function reasonForLayer(layer: TaskAttributionLayer) {
  if (layer === externalServiceLayer) return 'Recovery depends on an external service becoming available or cached evidence being attached.';
  if (layer === 'payload-normalization') return 'The next step belongs to contract normalization because payload semantics or schema shape are incomplete.';
  if (layer === 'verification') return 'The next step belongs to verification because evidence or verifier verdicts are incomplete.';
  if (layer === 'resume') return 'The next step belongs to resume because referenced work must be located or refreshed.';
  if (layer === 'agentserver-parser') return 'The next step belongs to backend handoff parsing because runtime could not safely classify backend output.';
  if (layer === 'presentation') return 'The next step belongs to presentation because user-visible result projection is incomplete.';
  return 'The next step belongs to the runtime gateway because it owns task execution state, refs, and recovery.';
}

function hasHumanAnswer(payload: ToolPayload) {
  const text = payload.message.replace(/\s+/g, ' ').trim();
  if (text.length < 12) return false;
  if (/^\s*[{[]/.test(text)) return false;
  if (/taskFiles|uiManifest|reasoningTrace|executionUnits/.test(text) && text.length < 240) return false;
  return true;
}

function hasUsableVisibleResult(payload: ToolPayload) {
  return hasHumanAnswer(payload) || payload.artifacts.some((artifact) => {
    if (!isRecord(artifact)) return false;
    return Boolean(
      stringField(artifact.title)
      || stringField(artifact.content)
      || stringField(artifact.path)
      || stringField(artifact.dataRef)
      || stringField(artifact.imageRef)
      || isRecord(artifact.data)
    );
  });
}

function hasCurrentReferenceFailure(payload: ToolPayload) {
  return /current-turn reference contract failed/i.test(payload.message)
    || toRecordList(payload.executionUnits).some((unit) => String(unit.id || '').startsWith('current-reference-usage-'));
}

function looksLikeOnlyPlanPromise(value: unknown) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!text) return false;
  return /^(?:i(?:['’]ll|\s+(?:will|would|can|am going to|plan to|intend to|need to|shall))|we(?:['’]ll|\s+(?:will|would|can|are going to|plan to|intend to|need to|shall)))\s+(?:retrieve|fetch|search|look\s+up|analy[sz]e|investigate|review|read|compare|summari[sz]e|generate|create|build|run|perform|collect|download|query|parse|extract|write|prepare)\b/i.test(text)
    || /^(?:我(?:将|会|来|需要|可以)|接下来我(?:会|将)|下一步(?:我)?(?:会|将))\s*(?:检索|搜索|分析|调研|读取|查看|比较|总结|生成|创建|运行|下载|查询|提取|撰写|准备)/.test(text);
}

function artifactRef(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.dataRef)
    ?? stringField(artifact.path)
    ?? stringField(artifact.ref)
    ?? stringField(artifact.outputRef)
    ?? stringField(artifact.imageRef)
    ?? stringField(metadata.artifactRef)
    ?? stringField(metadata.outputRef)
    ?? stringField(metadata.reportRef);
}

function unitRefs(unit: Record<string, unknown>) {
  return uniqueStrings([
    stringField(unit.codeRef),
    stringField(unit.outputRef),
    stringField(unit.stdoutRef),
    stringField(unit.stderrRef),
    stringField(unit.diffRef),
    stringField(unit.verificationRef),
    ...toStringList(unit.outputArtifacts),
    ...toStringList(unit.artifacts),
  ].filter((ref): ref is string => Boolean(ref)));
}

function verificationRefsFromPayload(payload: ToolPayload) {
  return uniqueStrings((payload.verificationResults ?? []).flatMap((result, index) => [
    result.id ? `verification:${result.id}` : `verification:${index + 1}`,
    ...result.evidenceRefs,
  ]));
}

function refKind(ref: string, declaredKind?: string): TaskRunCardRef['kind'] {
  if (declaredKind === 'artifact') return 'artifact';
  if (declaredKind === 'execution-unit') return 'execution-unit';
  if (declaredKind === 'verification') return 'verification';
  if (declaredKind === 'log') return 'log';
  if (declaredKind === 'screenshot' || declaredKind === 'screenshot-region') return 'screenshot';
  if (/^run:/i.test(ref)) return 'run';
  if (/^artifact[:]|\.sciforge\/(?:sessions\/[^/]+\/)?(?:artifacts|task-results|exports)\//i.test(ref)) return 'artifact';
  if (/^execution-unit:/i.test(ref)) return 'execution-unit';
  if (/^verification:/i.test(ref)) return 'verification';
  if (/stdout|stderr|\.log$/i.test(ref)) return 'log';
  if (/screenshot|\.(?:png|jpg|jpeg|webp)$/i.test(ref)) return 'screenshot';
  if (/^file:|^\./i.test(ref)) return 'file';
  return 'other';
}

function uniqueTaskRefs(refs: TaskRunCardRef[]) {
  const byKey = new Map<string, TaskRunCardRef>();
  for (const ref of refs) {
    if (!ref.ref.trim()) continue;
    byKey.set(`${ref.kind}:${ref.ref}`, ref);
  }
  return [...byKey.values()].sort((left, right) => `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`));
}

function executionStatus(value: unknown): RuntimeExecutionUnit['status'] {
  const text = String(value || '');
  return ['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(text)
    ? text as RuntimeExecutionUnit['status']
    : 'done';
}

function verificationVerdict(value: unknown): RuntimeExecutionUnit['verificationVerdict'] | undefined {
  const text = String(value || '');
  return ['pass', 'fail', 'uncertain', 'needs-human', 'unverified'].includes(text)
    ? text as RuntimeExecutionUnit['verificationVerdict']
    : undefined;
}

function isTaskProtocolStatus(value: unknown): value is TaskProtocolStatus {
  return ['not-run', 'running', 'protocol-success', 'protocol-failed', 'cancelled'].includes(String(value));
}

function isTaskOutcomeStatus(value: unknown): value is TaskOutcomeStatus {
  return ['satisfied', 'needs-work', 'needs-human', 'blocked', 'unknown'].includes(String(value));
}

function isGatewayTaskOutcomeProjection(value: unknown): value is GatewayTaskOutcomeProjection {
  return isRecord(value)
    && value.schemaVersion === TASK_OUTCOME_PROJECTION_SCHEMA_VERSION
    && isValidTaskRunCard(value.taskRunCard);
}

function isValidTaskRunCard(value: unknown): value is TaskRunCard {
  return validateTaskRunCard(value).length === 0;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
