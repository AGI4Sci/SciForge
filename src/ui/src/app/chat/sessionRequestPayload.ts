import type {
  EvidenceClaim,
  GuidanceQueueRecord,
  ObjectReference,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  SciForgeMessage,
  SciForgeReference,
  SciForgeRun,
  SciForgeSession,
  UserGoalSnapshot,
} from '../../domain';
import { isSeedDemoOrFixtureMessage } from '@sciforge-ui/runtime-contract';
import { sameChatContinuityPrompt } from '../../conversationContinuity';
import {
  compactProjectionExecutionUnitsForRequestPayload,
  compactRunRawAuditForProjectionPayload,
  projectionContinuationContexts,
  type ProjectionContinuationContext,
} from './sessionProjectionContinuation';
import { compactRunRawForRequestPayload } from './runRawCompaction';
import {
  clipOptionalText,
  clipText,
  compactDiagnosticText,
  compactInlineValue,
  compactRecord,
  digestTextField,
  isCompactRecord,
  omittedTextDigestLabel,
} from './sessionPayloadText';

const REQUEST_PAYLOAD_MESSAGE_LIMIT = 12;
const REQUEST_PAYLOAD_ARTIFACT_LIMIT = 16;
const REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT = 16;
const REQUEST_PAYLOAD_RUN_LIMIT = 8;
const REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT = 6_000;
const REQUEST_PAYLOAD_RUN_TEXT_LIMIT = 2_000;
const REQUEST_PAYLOAD_RAW_TEXT_LIMIT = 2_500;
const REQUEST_PAYLOAD_INLINE_DATA_LIMIT = 3_000;

export function requestPayloadForTurn(session: SciForgeSession, userMessage: SciForgeMessage, references: SciForgeReference[]) {
  const hasExplicitReferences = references.length > 0;
  const selectedRefSet = selectedReferenceScope(references);
  const selectedMessageRefSet = selectedMessageReferenceScope(references);
  const priorMessages = session.messages.filter((message) => message.id !== userMessage.id);
  const hasRealPriorMessages = priorMessages.some((message) => !isSeedDemoOrFixtureMessage(message));
  const hasPriorWork = hasRealPriorMessages
    || session.runs.length > 0
    || session.artifacts.length > 0
    || session.executionUnits.length > 0;
  if (hasPriorWork || hasExplicitReferences) {
    const messages = compactMessagesForRequestPayload(session.messages, userMessage.id, selectedRefSet, selectedMessageRefSet);
    const projectionContexts = projectionContinuationContexts(session, references);
    const selectedRunIds = new Set([
      ...selectedRunIdsFromReferences(references),
      ...selectedRunIdsFromMessages(session.messages, selectedRefSet),
    ]);
    return {
      messages,
      artifacts: artifactsForRequestPayload(session.artifacts, selectedRefSet).map(compactArtifactForRequestPayload),
      claims: claimsForRequestPayload(session.claims),
      executionUnits: projectionContexts.length
        ? compactProjectionExecutionUnitsForRequestPayload(session.executionUnits, projectionContexts)
        : executionUnitsForRequestPayload(session.executionUnits, selectedRefSet).map(compactExecutionUnitForRequestPayload),
      runs: runsForRequestPayload(session.runs, selectedRefSet, projectionContexts, selectedRunIds)
        .map((run) => compactRunForRequestPayload(run, projectionContexts, selectedRefSet)),
    };
  }
  return {
    messages: [userMessage],
    artifacts: [],
    claims: [],
    executionUnits: [],
    runs: [],
  };
}

function selectedReferenceScope(references: SciForgeReference[]) {
  return new Set(references.flatMap(selectedReferenceAliases).filter(Boolean));
}

function selectedMessageReferenceScope(references: SciForgeReference[]) {
  return new Set(references.flatMap((reference) => {
    const refs = selectedReferenceAliases(reference);
    if (reference.kind === 'message') return refs.flatMap(messageRefAliasesForSelectedReference);
    return refs.filter((ref) => ref.startsWith('message:'));
  }).filter(Boolean));
}

function messageRefAliasesForSelectedReference(ref: string) {
  if (ref.startsWith('message:')) return [ref, ref.slice('message:'.length)];
  if (ref.startsWith('artifact:') || ref.startsWith('run:')) return [];
  return [ref, `message:${ref}`];
}

function selectedReferenceAliases(reference: SciForgeReference): string[] {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : isRecord(payload.objectReference) ? payload.objectReference : {};
  const provenance = isRecord(currentReference.provenance) ? currentReference.provenance : {};
  const aliases = [
    reference.ref,
    reference.sourceId,
    reference.runId ? `run:${reference.runId}` : undefined,
    stringField(payload.path),
    stringField(payload.dataRef),
    stringField(payload.ref),
    stringField(payload.runId) ? `run:${stringField(payload.runId)}` : undefined,
    stringField(currentReference.ref),
    stringField(currentReference.id),
    stringField(currentReference.runId) ? `run:${stringField(currentReference.runId)}` : undefined,
    stringField(currentReference.artifactType),
    stringField(provenance.path),
    stringField(provenance.dataRef),
  ];
  if (reference.sourceId) aliases.push(`artifact:${reference.sourceId}`);
  if (reference.kind === 'message' && reference.sourceId) aliases.push(`message:${reference.sourceId}`);
  const currentId = stringField(currentReference.id);
  if (currentId) aliases.push(`artifact:${currentId}`);
  if (reference.kind === 'message' && currentId) aliases.push(`message:${currentId}`);
  return Array.from(new Set(aliases.filter((value): value is string => Boolean(value && value.trim()))));
}

function selectedRunIdsFromReferences(references: SciForgeReference[]) {
  return new Set(references.flatMap((reference) => {
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : isRecord(payload.objectReference) ? payload.objectReference : {};
    return [
      reference.runId,
      stringField(payload.runId),
      stringField(currentReference.runId),
    ];
  }).filter((value): value is string => Boolean(value && value.trim())));
}

function selectedRunIdsFromMessages(messages: SciForgeMessage[], selectedRefs: Set<string>) {
  if (selectedRefs.size === 0) return new Set<string>();
  return new Set(messages.flatMap((message) => [
    ...(message.objectReferences ?? []),
    ...(message.acceptance?.objectReferences ?? []),
  ].filter((reference) => objectReferenceMatchesSelectedRefs(reference, selectedRefs))
    .map((reference) => reference.runId)
    .filter((value): value is string => Boolean(value && value.trim()))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function claimsForRequestPayload(claims: EvidenceClaim[]) {
  return claims.slice(0, 24).map((claim) => ({
    id: claim.id,
    text: clipText(claim.text, 600),
    type: claim.type,
    confidence: claim.confidence,
    evidenceLevel: claim.evidenceLevel,
    supportingRefs: claim.supportingRefs?.slice(0, 6),
  }));
}

function artifactsForRequestPayload(artifacts: RuntimeArtifact[], selectedRefs: Set<string>) {
  const scoped = selectedRefs.size > 0
    ? artifacts.filter((artifact) => artifactMatchesSelectedRefs(artifact, selectedRefs))
    : artifacts;
  return scoped.slice(-REQUEST_PAYLOAD_ARTIFACT_LIMIT);
}

function artifactMatchesSelectedRefs(artifact: RuntimeArtifact, selectedRefs: Set<string>) {
  return artifactReferenceAliases(artifact).some((ref) => selectedRefs.has(ref));
}

function artifactReferenceAliases(artifact: RuntimeArtifact) {
  return [
    artifact.id,
    `artifact:${artifact.id}`,
    artifact.dataRef,
    artifact.path,
    artifact.delivery?.ref,
    artifact.delivery?.readableRef,
    artifact.delivery?.rawRef,
    stringField(artifact.metadata?.markdownRef),
    stringField(artifact.metadata?.outputRef),
    stringField(artifact.metadata?.artifactRef),
  ].filter((value): value is string => Boolean(value && value.trim()));
}

function objectReferenceMatchesSelectedRefs(reference: ObjectReference, selectedRefs: Set<string>) {
  return objectReferenceAliases(reference).some((ref) => selectedRefs.has(ref));
}

function objectReferenceAliases(reference: ObjectReference): string[] {
  const provenance = isRecord(reference.provenance) ? reference.provenance : {};
  const path = stringField(provenance.path);
  const dataRef = stringField(provenance.dataRef);
  const aliases = [
    reference.ref,
    reference.id,
    reference.runId ? `run:${reference.runId}` : undefined,
    reference.artifactType,
    path,
    dataRef,
    path ? `file:${path}` : undefined,
    path ? `file::${path}` : undefined,
    dataRef ? `file:${dataRef}` : undefined,
    dataRef ? `file::${dataRef}` : undefined,
  ];
  if (reference.kind === 'artifact' && reference.id) aliases.push(`artifact:${reference.id}`);
  if (reference.kind === 'file' && path) aliases.push(path);
  return Array.from(new Set(aliases.filter((value): value is string => Boolean(value && value.trim()))));
}

function executionUnitsForRequestPayload(units: RuntimeExecutionUnit[], selectedRefs: Set<string>) {
  const scoped = selectedRefs.size > 0
    ? units.filter((unit) => executionUnitRefs(unit).some((ref) => selectedRefs.has(ref)))
    : units;
  return scoped.slice(-REQUEST_PAYLOAD_EXECUTION_UNIT_LIMIT);
}

function runsForRequestPayload(
  runs: SciForgeRun[],
  selectedRefs: Set<string>,
  projectionContexts: ProjectionContinuationContext[],
  selectedRunIds: Set<string> = new Set(),
) {
  if (selectedRefs.size === 0) return runs.slice(-REQUEST_PAYLOAD_RUN_LIMIT);
  const projectionRunIds = new Set(projectionContexts.map((context) => context.sourceRunId));
  const scoped = runs.filter((run) => selectedRunIds.has(run.id) || projectionRunIds.has(run.id) || runRefs(run).some((ref) => selectedRefs.has(ref)));
  return scoped.slice(-REQUEST_PAYLOAD_RUN_LIMIT);
}

function compactMessagesForRequestPayload(
  messages: SciForgeMessage[],
  currentMessageId: string,
  selectedRefs = new Set<string>(),
  selectedMessageRefs = new Set<string>(),
) {
  const currentMessage = messages.find((message) => message.id === currentMessageId);
  const continuityMessageIds = sameChatContinuityMessageIds(messages, currentMessageId, currentMessage?.content);
  return messages
    .filter((message) => !isSeedDemoOrFixtureMessage(message))
    .filter((message) => selectedRefs.size === 0 || message.id === currentMessageId || messageRefs(message).some((ref) => selectedRefs.has(ref)))
    .slice(-REQUEST_PAYLOAD_MESSAGE_LIMIT)
    .map((message) => {
      const isCurrentMessage = message.id === currentMessageId;
      const isSelectedMessage = selectedMessageRefs.size > 0 && messageOwnRefs(message).some((ref) => selectedMessageRefs.has(ref));
      const continuityContent = !isCurrentMessage && continuityMessageIds.has(message.id)
        ? clipText(message.content, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT)
        : undefined;
      return {
        id: message.id,
        role: message.role,
        content: isCurrentMessage || isSelectedMessage
          ? clipText(message.content, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT)
          : omittedTextDigestLabel('previous-message', message.content),
        confidence: message.confidence,
        evidence: message.evidence,
        claimType: message.claimType,
        expandable: isCurrentMessage
          ? clipOptionalText(message.expandable, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT)
          : undefined,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
        status: message.status,
        tokenUsage: message.tokenUsage,
        references: compactReferencesForRequestPayload(filterReferencesForRequestPayload(message.references, selectedRefs)),
        objectReferences: compactObjectReferencesForRequestPayload(filterObjectReferencesForRequestPayload(message.objectReferences, selectedRefs)),
        goalSnapshot: compactGoalSnapshotForRequestPayload(message.goalSnapshot, isCurrentMessage),
        acceptance: compactAcceptanceForRequestPayload(message.acceptance),
        guidanceQueue: compactGuidanceQueueForRequestPayload(message.guidanceQueue),
        contentDigest: isCurrentMessage || isSelectedMessage ? undefined : digestTextField(message.content),
        selectedReferenceContent: isSelectedMessage || undefined,
        continuityContent,
      };
    });
}

function sameChatContinuityMessageIds(
  messages: SciForgeMessage[],
  currentMessageId: string,
  currentPrompt: string | undefined,
) {
  if (!currentPrompt || !sameChatContinuityPrompt(currentPrompt)) return new Set<string>();
  const currentIndex = messages.findIndex((message) => message.id === currentMessageId);
  if (currentIndex <= 0) return new Set<string>();
  return new Set(messages
    .slice(0, currentIndex)
    .filter((message) => !isSeedDemoOrFixtureMessage(message))
    .slice(-4)
    .map((message) => message.id));
}

function filterReferencesForRequestPayload(references: SciForgeReference[] | undefined, selectedRefs: Set<string>) {
  if (!references || selectedRefs.size === 0) return references;
  return references.filter((reference) => selectedReferenceAliases(reference).some((ref) => selectedRefs.has(ref)));
}

function filterObjectReferencesForRequestPayload(objectReferences: ObjectReference[] | undefined, selectedRefs: Set<string>) {
  if (!objectReferences || selectedRefs.size === 0) return objectReferences;
  return objectReferences.filter((reference) => objectReferenceMatchesSelectedRefs(reference, selectedRefs));
}

function compactReferencesForRequestPayload(references: SciForgeReference[] | undefined) {
  return references?.slice(-8).map((reference) => ({
    id: reference.id,
    kind: reference.kind,
    title: clipText(reference.title, 160),
    ref: reference.ref,
    summary: clipOptionalText(reference.summary, 360),
    sourceId: reference.sourceId,
    runId: reference.runId,
    locator: reference.locator,
  }));
}

function compactObjectReferencesForRequestPayload(objectReferences: ObjectReference[] | undefined) {
  return objectReferences?.slice(-12).map((reference) => ({
    ...reference,
    title: clipText(reference.title, 160),
    summary: clipOptionalText(reference.summary, 360),
  }));
}

function compactGoalSnapshotForRequestPayload(goalSnapshot: UserGoalSnapshot | undefined, isCurrentMessage: boolean) {
  if (!goalSnapshot) return undefined;
  return {
    ...goalSnapshot,
    rawPrompt: isCurrentMessage
      ? clipText(goalSnapshot.rawPrompt, REQUEST_PAYLOAD_MESSAGE_TEXT_LIMIT)
      : omittedTextDigestLabel('previous-goal-prompt', goalSnapshot.rawPrompt),
    requiredFormats: goalSnapshot.requiredFormats.slice(0, 12).map((item) => clipText(item, 160)),
    requiredArtifacts: goalSnapshot.requiredArtifacts.slice(0, 12).map((item) => clipText(item, 160)),
    requiredReferences: goalSnapshot.requiredReferences.slice(0, 12).map((item) => clipText(item, 160)),
    uiExpectations: goalSnapshot.uiExpectations.slice(0, 12).map((item) => clipText(item, 160)),
    acceptanceCriteria: goalSnapshot.acceptanceCriteria.slice(0, 12).map((item) => clipText(item, 240)),
  };
}

function compactAcceptanceForRequestPayload(acceptance: SciForgeMessage['acceptance'] | undefined) {
  if (!acceptance) return undefined;
  return {
    pass: acceptance.pass,
    severity: acceptance.severity,
    checkedAt: acceptance.checkedAt,
    failures: acceptance.failures.slice(-8).map((failure) => ({
      code: failure.code,
      detail: compactDiagnosticText(failure.detail, 700, 'acceptance-failure-detail') ?? '',
      repairAction: clipOptionalText(failure.repairAction, 500),
    })),
    objectReferences: compactObjectReferencesForRequestPayload(acceptance.objectReferences) ?? [],
    repairPrompt: compactDiagnosticText(acceptance.repairPrompt, 800, 'acceptance-repair-prompt'),
    repairAttempt: acceptance.repairAttempt,
    semantic: acceptance.semantic ? {
      pass: acceptance.semantic.pass,
      confidence: acceptance.semantic.confidence,
      unmetCriteria: acceptance.semantic.unmetCriteria.slice(0, 12).map((item) => clipText(item, 180)),
      missingArtifacts: acceptance.semantic.missingArtifacts.slice(0, 12).map((item) => clipText(item, 180)),
      referencedEvidence: acceptance.semantic.referencedEvidence.slice(0, 12).map((item) => clipText(item, 180)),
      repairPrompt: compactDiagnosticText(acceptance.semantic.repairPrompt, 500, 'semantic-repair-prompt'),
      backendRunRef: acceptance.semantic.backendRunRef,
    } : undefined,
    repairHistory: acceptance.repairHistory?.slice(-6).map((entry) => ({
      ...entry,
      action: clipText(entry.action, 500),
      failureCodes: entry.failureCodes.slice(0, 12),
      reason: clipOptionalText(entry.reason, 500),
    })),
  };
}

function compactGuidanceQueueForRequestPayload(guidanceQueue: GuidanceQueueRecord | undefined) {
  if (!guidanceQueue) return undefined;
  return {
    ...guidanceQueue,
    prompt: compactDiagnosticText(guidanceQueue.prompt, 800, 'guidance-queue-prompt') ?? '',
    references: compactReferencesForRequestPayload(guidanceQueue.references),
    reason: clipOptionalText(guidanceQueue.reason, 500),
  };
}

function compactArtifactForRequestPayload(artifact: RuntimeArtifact): RuntimeArtifact {
  const compacted: RuntimeArtifact = {
    ...artifact,
    metadata: compactRecord(artifact.metadata, 1_500),
  };
  if (artifact.data === undefined) return compacted;
  const compactedData = compactInlineValue(artifact.data, REQUEST_PAYLOAD_INLINE_DATA_LIMIT);
  compacted.metadata = {
    ...(compacted.metadata ?? {}),
    inlineDataOmittedFromChatPayload: true,
    inlineDataApproxBytes: compactedData.approxBytes,
  };
  delete compacted.data;
  return compacted;
}

function compactExecutionUnitForRequestPayload(unit: RuntimeExecutionUnit): RuntimeExecutionUnit {
  return {
    ...unit,
    params: clipText(unit.params, 1_500),
    code: clipOptionalText(unit.code, 2_000),
    selfHealReason: clipOptionalText(unit.selfHealReason, 1_000),
    patchSummary: clipOptionalText(unit.patchSummary, 1_000),
    failureReason: clipOptionalText(unit.failureReason, 1_500),
    nextStep: clipOptionalText(unit.nextStep, 1_000),
    recoverActions: unit.recoverActions?.map((action) => clipText(action, 600)).slice(-6),
  };
}

function compactRunForRequestPayload(run: SciForgeRun, projectionContexts: ProjectionContinuationContext[] = [], selectedRefs = new Set<string>()): SciForgeRun {
  const raw = compactRunRawForRequestPayload(run.raw, {
    rawTextLimit: REQUEST_PAYLOAD_RAW_TEXT_LIMIT,
    runTextLimit: REQUEST_PAYLOAD_RUN_TEXT_LIMIT,
  });
  const cancelBoundary = cancelBoundaryForRun(run);
  const projectionContext = projectionContexts.find((context) => context.sourceRunId === run.id);
  const compactRaw = projectionContext
    ? compactRunRawAuditForProjectionPayload(raw, projectionContext)
    : raw;
  return {
    ...run,
    prompt: omittedTextDigestLabel('previous-run-prompt', run.prompt),
    response: omittedTextDigestLabel('previous-run-response', run.response),
    raw: cancelBoundary ? { ...(isCompactRecord(compactRaw) ? compactRaw : {}), cancelBoundary } : compactRaw,
    references: filterReferencesForRequestPayload(run.references, selectedRefs)?.slice(-8),
    objectReferences: filterObjectReferencesForRequestPayload(run.objectReferences, selectedRefs)?.slice(-12),
  };
}

function messageRefs(message: SciForgeMessage) {
  return uniqueStringRefs([
    `message:${message.id}`,
    ...(message.references ?? []).flatMap(selectedReferenceAliases),
    ...(message.objectReferences ?? []).flatMap(objectReferenceAliases),
    ...(message.acceptance?.objectReferences ?? []).flatMap(objectReferenceAliases),
  ]);
}

function messageOwnRefs(message: SciForgeMessage) {
  return uniqueStringRefs([message.id, `message:${message.id}`]);
}

function runRefs(run: SciForgeRun) {
  return uniqueStringRefs([
    `run:${run.id}`,
    ...(run.references ?? []).flatMap(selectedReferenceAliases),
    ...(run.objectReferences ?? []).flatMap(objectReferenceAliases),
  ]);
}

function executionUnitRefs(unit: RuntimeExecutionUnit) {
  return uniqueStringRefs([
    `execution-unit:${unit.id}`,
    unit.outputRef,
    unit.stdoutRef,
    unit.stderrRef,
    unit.diffRef,
    unit.verificationRef,
    ...(unit.artifacts ?? []).map((ref) => ref.startsWith('artifact:') ? ref : `artifact:${ref}`),
    ...(unit.outputArtifacts ?? []).map((ref) => ref.startsWith('artifact:') ? ref : `artifact:${ref}`),
  ]);
}

function cancelBoundaryForRun(run: SciForgeRun) {
  if (run.status !== 'cancelled') return undefined;
  const reason = terminationReasonFromRaw(run.raw) ?? 'user-cancelled';
  return {
    schemaVersion: 'sciforge.cancel-boundary.v1',
    reason,
    sideEffectPolicy: reason === 'user-cancelled' ? 'do-not-auto-resume' : 'inspect-before-resume',
    nextStep: reason === 'user-cancelled'
      ? 'Ask the user to confirm whether to reuse partial refs or start a new run; do not automatically resume irreversible side effects.'
      : 'Inspect termination diagnostics and preserved refs before deciding whether continuation is safe.',
  };
}

function terminationReasonFromRaw(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const record = raw as Record<string, unknown>;
  const direct = record.termination;
  if (direct && typeof direct === 'object' && !Array.isArray(direct) && typeof (direct as Record<string, unknown>).reason === 'string') {
    return (direct as Record<string, unknown>).reason as string;
  }
  const background = record.backgroundCompletion;
  if (background && typeof background === 'object' && !Array.isArray(background)) {
    const termination = (background as Record<string, unknown>).termination;
    if (termination && typeof termination === 'object' && !Array.isArray(termination) && typeof (termination as Record<string, unknown>).reason === 'string') {
      return (termination as Record<string, unknown>).reason as string;
    }
  }
  return undefined;
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
