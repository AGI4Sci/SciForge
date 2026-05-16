import type {
  RuntimeExecutionUnit,
  SciForgeReference,
  SciForgeRun,
  SciForgeSession,
} from '../../domain';
import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';
import { CONVERSATION_PROJECTION_CONTINUATION_TOOL_ID } from '@sciforge-ui/runtime-contract/events';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionAuditRefs,
  conversationProjectionForSession,
  conversationProjectionPrimaryDiagnostic,
  conversationProjectionStatus,
  conversationProjectionVisibleText,
  type UiConversationProjection,
} from '../conversation-projection-view-model';

const REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT = 16;
const REQUEST_PAYLOAD_PROJECTION_LIMIT = 4;
const REQUEST_PAYLOAD_PROJECTION_TEXT_LIMIT = 360;
const REQUEST_PAYLOAD_SELECTED_REF_LIMIT = 8;
const REQUEST_PAYLOAD_AUDIT_REF_LIMIT = 24;

export interface ProjectionContinuationContext {
  sourceRunId: string;
  projection: UiConversationProjection;
  summary: ConversationProjectionContinuationSummary;
  auditRefs: string[];
}

interface ConversationProjectionContinuationSummary {
  schemaVersion: 'sciforge.conversation-projection-continuation.v1';
  source: 'conversation-projection';
  sourceRunId: string;
  status: string;
  currentTurnId?: string;
  visibleText?: string;
  diagnostic?: string;
  artifactRefs: string[];
  recoverActions: string[];
  backgroundState?: {
    status?: string;
    checkpointRefs?: string[];
    revisionPlan?: string;
  };
  verificationState?: {
    status?: string;
    verifierRef?: string;
    verdict?: string;
  };
  selectedRefs: Array<{
    id: string;
    kind: string;
    ref: string;
    title?: string;
    summary?: string;
  }>;
  auditRefs: string[];
}

export function projectionContinuationContexts(
  session: SciForgeSession,
  references: SciForgeReference[],
): ProjectionContinuationContext[] {
  const selectedRefs = compactSelectedRefsForProjectionContinuation(references);
  return session.runs
    .map((run) => {
      const projection = conversationProjectionForSession(session, run);
      if (!projection) return undefined;
      const auditRefs = uniqueStringRefs([
        ...conversationProjectionAuditRefs(projection),
        ...collectRuntimeRefsFromValue(run.raw, { maxDepth: 5, maxRefs: REQUEST_PAYLOAD_AUDIT_REF_LIMIT, includeIds: false }),
      ]).slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT);
      return {
        sourceRunId: run.id,
        projection,
        auditRefs,
        summary: compactConversationProjectionForRequestPayload(run.id, projection, selectedRefs, auditRefs),
      };
    })
    .filter((context): context is ProjectionContinuationContext => Boolean(context))
    .slice(-REQUEST_PAYLOAD_PROJECTION_LIMIT);
}

function compactConversationProjectionForRequestPayload(
  sourceRunId: string,
  projection: UiConversationProjection,
  selectedRefs: ConversationProjectionContinuationSummary['selectedRefs'],
  auditRefs: string[],
): ConversationProjectionContinuationSummary {
  return {
    schemaVersion: 'sciforge.conversation-projection-continuation.v1',
    source: 'conversation-projection',
    sourceRunId,
    status: conversationProjectionStatus(projection),
    currentTurnId: projection.currentTurn?.id,
    visibleText: clipOptionalText(conversationProjectionVisibleText(projection), REQUEST_PAYLOAD_PROJECTION_TEXT_LIMIT),
    diagnostic: clipOptionalText(conversationProjectionPrimaryDiagnostic(projection), 600),
    artifactRefs: conversationProjectionArtifactRefs(projection).slice(0, 12),
    recoverActions: projection.recoverActions.slice(0, 6).map((action) => clipText(action, 500)),
    backgroundState: projection.backgroundState ? {
      status: projection.backgroundState.status,
      checkpointRefs: projection.backgroundState.checkpointRefs?.slice(0, 8),
      revisionPlan: clipOptionalText(projection.backgroundState.revisionPlan, 600),
    } : undefined,
    verificationState: projection.verificationState ? {
      status: projection.verificationState.status,
      verifierRef: projection.verificationState.verifierRef,
      verdict: projection.verificationState.verdict,
    } : undefined,
    selectedRefs,
    auditRefs: auditRefs.slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT),
  };
}

function compactSelectedRefsForProjectionContinuation(references: SciForgeReference[]) {
  return references.slice(-REQUEST_PAYLOAD_SELECTED_REF_LIMIT).map((reference) => ({
    id: reference.id,
    kind: reference.kind,
    ref: reference.ref,
    title: clipOptionalText(reference.title, 160),
    summary: clipOptionalText(reference.summary, 360),
  }));
}

export function compactProjectionExecutionUnitsForRequestPayload(
  units: RuntimeExecutionUnit[],
  contexts: ProjectionContinuationContext[],
): RuntimeExecutionUnit[] {
  const auditRefs = new Set(contexts.flatMap((context) => context.auditRefs));
  const sourceRunIds = new Set(contexts.map((context) => context.sourceRunId));
  const auditUnits = units
    .filter((unit) => executionUnitBelongsToProjectionAudit(unit, auditRefs, sourceRunIds))
    .slice(-(REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT - 1))
    .map(compactExecutionUnitAuditForRequestPayload);
  return [
    ...auditUnits,
    projectionContinuationExecutionUnit(contexts),
  ];
}

function projectionContinuationExecutionUnit(contexts: ProjectionContinuationContext[]): RuntimeExecutionUnit {
  const params = projectionContinuationParams(contexts);
  return {
    id: `projection-continuation-${contexts.at(-1)?.sourceRunId ?? 'session'}`,
    tool: CONVERSATION_PROJECTION_CONTINUATION_TOOL_ID,
    params,
    status: 'record-only',
    hash: stableTextHash(params),
    runId: contexts.at(-1)?.sourceRunId,
    sourceRunId: contexts.at(-1)?.sourceRunId,
  };
}

function projectionContinuationParams(contexts: ProjectionContinuationContext[]) {
  const build = (projections: ConversationProjectionContinuationSummary[]) => JSON.stringify({
    schemaVersion: 'sciforge.conversation-projection-continuation-set.v1',
    policy: 'projection-first; raw runs and execution units are audit refs only',
    projections,
  });
  const full = build(contexts.map((context) => context.summary));
  if (full.length <= 900) return full;
  const compact = build(contexts.slice(-1).map((context) => ({
    ...context.summary,
    visibleText: context.summary.visibleText ? omittedTextDigestLabel('projection-visible-text', context.summary.visibleText) : undefined,
    diagnostic: clipOptionalText(context.summary.diagnostic, 160),
    recoverActions: context.summary.recoverActions.map((action) => clipText(action, 160)).slice(0, 3),
    selectedRefs: context.summary.selectedRefs.map((ref) => ({
      ...ref,
      title: clipOptionalText(ref.title, 60),
      summary: undefined,
    })),
    auditRefs: context.summary.auditRefs.slice(0, 12),
  })));
  if (compact.length <= 900) return compact;
  return build(contexts.slice(-1).map((context) => ({
    schemaVersion: context.summary.schemaVersion,
    source: context.summary.source,
    sourceRunId: context.summary.sourceRunId,
    status: context.summary.status,
    currentTurnId: context.summary.currentTurnId,
    diagnostic: clipOptionalText(context.summary.diagnostic, 120),
    artifactRefs: context.summary.artifactRefs.slice(0, 4),
    recoverActions: context.summary.recoverActions.map((action) => clipText(action, 120)).slice(0, 2),
    selectedRefs: context.summary.selectedRefs.map((ref) => ({
      id: ref.id,
      kind: ref.kind,
      ref: ref.ref,
    })).slice(0, 4),
    auditRefs: context.summary.auditRefs.slice(0, 8),
  })));
}

function executionUnitBelongsToProjectionAudit(
  unit: RuntimeExecutionUnit,
  auditRefs: Set<string>,
  sourceRunIds: Set<string>,
) {
  if (sourceRunIds.has(unit.runId ?? '') || sourceRunIds.has(unit.sourceRunId ?? '') || sourceRunIds.has(unit.producerRunId ?? '')) return true;
  const candidateRefs = executionUnitAuditRefs(unit);
  return candidateRefs.some((ref) => auditRefs.has(ref) || auditRefs.has(`execution-unit:${unit.id}`));
}

function compactExecutionUnitAuditForRequestPayload(unit: RuntimeExecutionUnit): RuntimeExecutionUnit {
  return {
    id: unit.id,
    tool: unit.tool,
    params: omittedTextDigestLabel('execution-unit-params', unit.params),
    status: unit.status,
    hash: unit.hash,
    runId: unit.runId,
    sourceRunId: unit.sourceRunId,
    producerRunId: unit.producerRunId,
    agentServerRunId: unit.agentServerRunId,
    codeRef: unit.codeRef,
    stdoutRef: unit.stdoutRef,
    stderrRef: unit.stderrRef,
    outputRef: unit.outputRef,
    diffRef: unit.diffRef,
    artifacts: unit.artifacts?.slice(-8),
    outputArtifacts: unit.outputArtifacts?.slice(-8),
    failureReason: compactDiagnosticText(unit.failureReason, 1_200, 'execution-unit-failure-reason'),
    recoverActions: unit.recoverActions?.slice(-6).map((action) => clipText(action, 500)),
    nextStep: clipOptionalText(unit.nextStep, 600),
    verificationRef: unit.verificationRef,
    verificationVerdict: unit.verificationVerdict,
    scenarioPackageRef: unit.scenarioPackageRef,
    skillPlanRef: unit.skillPlanRef,
    uiPlanRef: unit.uiPlanRef,
  };
}

export function compactRunRawAuditForProjectionPayload(
  raw: unknown,
  context: ProjectionContinuationContext,
) {
  const record = isCompactRecord(raw) ? raw : {};
  const backgroundCompletion = isCompactRecord(record.backgroundCompletion) ? record.backgroundCompletion : undefined;
  return {
    termination: record.termination,
    cancelBoundary: record.cancelBoundary,
    historicalEditConflict: record.historicalEditConflict,
    guidanceQueue: record.guidanceQueue,
    backgroundCompletion: backgroundCompletion ? {
      status: backgroundCompletion.status,
      stage: backgroundCompletion.stage,
      runId: backgroundCompletion.runId,
      termination: backgroundCompletion.termination,
      refs: uniqueStringRefs([
        ...(Array.isArray(backgroundCompletion.refs) ? backgroundCompletion.refs : []),
        ...context.auditRefs,
      ]).slice(0, 16),
    } : undefined,
    projectionAudit: {
      schemaVersion: 'sciforge.conversation-projection-audit.v1',
      source: 'conversation-projection',
      sourceRunId: context.sourceRunId,
      projectionDigest: stableTextHash(JSON.stringify(context.summary)),
      auditRefs: context.auditRefs.slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT),
      selectedRefs: context.summary.selectedRefs.map((ref) => ref.ref),
    },
    refs: uniqueStringRefs([
      ...(Array.isArray(record.refs) ? record.refs : []),
      ...context.auditRefs,
    ]).slice(0, REQUEST_PAYLOAD_AUDIT_REF_LIMIT),
    bodySummary: {
      omitted: 'run-raw-body',
      keys: Array.isArray((record.bodySummary as { keys?: unknown } | undefined)?.keys)
        ? ((record.bodySummary as { keys?: unknown[] }).keys ?? []).filter((key): key is string => typeof key === 'string').slice(0, 16)
        : Object.keys(record).slice(0, 16),
      projectionFirst: true,
    },
  };
}

function omittedTextDigestLabel(label: string, value: string) {
  const digest = digestTextField(value);
  return digest?.hash
    ? `[${label} omitted; digest=${digest.hash}; chars=${digest.chars ?? value.length}]`
    : `[${label} omitted]`;
}

function compactDiagnosticText(value: string | undefined, maxChars: number, label: string) {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return omittedTextDigestLabel(label, normalized);
}

function digestTextField(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function isCompactRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function executionUnitAuditRefs(unit: RuntimeExecutionUnit) {
  return uniqueStringRefs([
    `execution-unit:${unit.id}`,
    unit.codeRef,
    unit.stdoutRef,
    unit.stderrRef,
    unit.outputRef,
    unit.diffRef,
    unit.verificationRef,
    ...(unit.artifacts ?? []).map((id) => id.startsWith('artifact:') ? id : `artifact:${id}`),
    ...(unit.outputArtifacts ?? []).map((id) => id.startsWith('artifact:') ? id : `artifact:${id}`),
  ]);
}

function uniqueStringRefs(values: unknown[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function clipOptionalText(value: string | undefined, maxChars: number) {
  return value === undefined ? undefined : clipText(value, maxChars);
}

function clipText(value: string, maxChars: number) {
  return value.length > maxChars ? `${value.slice(0, maxChars)}...[truncated]` : value;
}
