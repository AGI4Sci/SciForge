import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  createFailureSignature,
  createTaskRunCard,
  type CodingDeliverySummary,
  type FailureSignatureInput,
  type OwnershipLayerSuggestion,
  type TaskAttributionLayer,
  type TaskOutcomeStatus,
  type TaskProtocolStatus,
  type TaskRoundStatus,
  type TaskRunCardConversationProjectionSummary,
  type TaskRunCardRef,
} from '@sciforge-ui/runtime-contract/task-run-card';
import type { TaskAttemptRecord } from './runtime-types.js';
import { summarizeWorkEvidenceForHandoff } from './gateway/work-evidence-types.js';
import { fileExists } from './workspace-task-runner.js';
import { resolveWorkspaceFileRefPath } from './workspace-paths.js';
import { isRecord } from './gateway-utils.js';
import { auditSessionBundle, writeSessionBundleAudit } from './session-bundle.js';
import { recordTaskAttemptFailureSignatures } from './failure-signature-registry.js';
import {
  mergeValidationRepairAuditAttemptMetadata,
  projectValidationRepairAuditSink,
  validationRepairAuditAttemptMetadataFromPayload,
  type ValidationRepairAuditAttemptMetadata,
} from './gateway/validation-repair-audit-sink.js';
import {
  validationRepairTelemetryAttemptMetadataFromPayload,
  type ValidationRepairTelemetryAttemptMetadata,
} from './gateway/validation-repair-telemetry-sink.js';

export async function appendTaskAttempt(workspacePath: string, record: TaskAttemptRecord) {
  const workspace = resolve(workspacePath || process.cwd());
  const recordWithEvidence = await withWorkEvidenceSummary(workspace, record);
  const recordWithAudit = await withValidationRepairAuditMetadata(workspace, recordWithEvidence);
  const recordWithBundleAudit = await withSessionBundleAuditMetadata(workspace, recordWithAudit, true);
  const recordWithConversationProjection = await withConversationProjectionMetadata(workspace, recordWithBundleAudit);
  const recordWithCodingDelivery = await withCodingDeliverySummary(workspace, recordWithConversationProjection);
  const normalizedRecord = recordWithCodingDelivery.status === 'done'
    ? { ...recordWithCodingDelivery, failureReason: undefined }
    : recordWithCodingDelivery;
  const normalizedRecordWithCard = withTaskRunCard(normalizedRecord);
  const path = normalizedRecord.sessionBundleRef
    ? join(workspace, normalizedRecord.sessionBundleRef, 'records', 'task-attempts', `${safeName(record.id)}.json`)
    : join(workspace, '.sciforge', 'task-attempts', `${safeName(record.id)}.json`);
  const previous = await readAttempts(path);
  const attempts = [
    ...previous.filter((item) => item.attempt !== normalizedRecordWithCard.attempt),
    normalizedRecordWithCard,
  ].sort((left, right) => left.attempt - right.attempt);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({
    id: normalizedRecord.id,
    prompt: normalizedRecord.prompt,
    skillDomain: normalizedRecord.skillDomain,
    scenarioPackageRef: normalizedRecord.scenarioPackageRef,
    skillPlanRef: normalizedRecord.skillPlanRef,
    uiPlanRef: normalizedRecord.uiPlanRef,
    routeDecision: normalizedRecord.routeDecision,
    sessionId: normalizedRecord.sessionId,
    sessionBundleRef: normalizedRecord.sessionBundleRef,
    updatedAt: new Date().toISOString(),
    attempts,
  }, null, 2));
  await materializeTerminalProjectionForSessionRun(workspace, normalizedRecordWithCard);
  await recordTaskAttemptFailureSignatures(workspace, normalizedRecordWithCard);
  return path;
}

export async function readTaskAttempts(workspacePath: string, id: string): Promise<TaskAttemptRecord[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const rootAttempts = await readAttempts(join(workspace, '.sciforge', 'task-attempts', `${safeName(id)}.json`));
  if (rootAttempts.length) return withAttemptDerivedMetadata(workspace, rootAttempts);
  const sessionFiles = await sessionTaskAttemptFiles(workspace);
  const groups = await Promise.all(sessionFiles
    .filter((file) => file.endsWith(`/${safeName(id)}.json`))
    .map((file) => readAttempts(file)));
  return withAttemptDerivedMetadata(workspace, groups.flat());
}

export async function readRecentTaskAttempts(
  workspacePath: string,
  skillDomain?: string,
  limit = 8,
  scope: { scenarioPackageId?: string; skillPlanRef?: string; prompt?: string } = {},
): Promise<TaskAttemptRecord[]> {
  const workspace = resolve(workspacePath || process.cwd());
  const groups = await Promise.all((await taskAttemptFiles(workspace)).map((file) => readAttempts(file)));
  const attempts = groups
    .flat()
    .filter((attempt) => !skillDomain || attempt.skillDomain === skillDomain)
    .filter((attempt) => matchesAttemptScope(attempt, scope))
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
    .slice(0, limit);
  return withAttemptDerivedMetadata(workspace, attempts);
}

async function taskAttemptFiles(workspace: string) {
  const rootDir = join(workspace, '.sciforge', 'task-attempts');
  const rootFiles = await jsonFilesInDir(rootDir);
  return [...rootFiles, ...await sessionTaskAttemptFiles(workspace)];
}

async function sessionTaskAttemptFiles(workspace: string) {
  const sessionsDir = join(workspace, '.sciforge', 'sessions');
  let sessionDirs: string[];
  try {
    sessionDirs = await readdir(sessionsDir);
  } catch {
    return [];
  }
  const nested = await Promise.all(sessionDirs
    .filter((entry) => !entry.endsWith('.json'))
    .map((entry) => jsonFilesInDir(join(sessionsDir, entry, 'records', 'task-attempts'))));
  return nested.flat();
}

async function jsonFilesInDir(dir: string) {
  if (!await fileExists(dir)) return [];
  try {
    return (await readdir(dir))
      .filter((file) => file.endsWith('.json'))
      .map((file) => join(dir, file));
  } catch {
    return [];
  }
}

function matchesAttemptScope(
  attempt: TaskAttemptRecord,
  scope: { scenarioPackageId?: string; skillPlanRef?: string; prompt?: string },
) {
  const scenarioPackageId = scope.scenarioPackageId?.trim();
  if (scenarioPackageId) {
    return attempt.scenarioPackageRef?.id === scenarioPackageId;
  }
  const skillPlanRef = scope.skillPlanRef?.trim();
  if (skillPlanRef && attempt.skillPlanRef && attempt.skillPlanRef !== skillPlanRef) {
    return false;
  }
  const prompt = scope.prompt?.trim();
  if (!prompt) return true;
  return prompt === attempt.prompt.trim();
}

async function readAttempts(path: string): Promise<TaskAttemptRecord[]> {
  if (!await fileExists(path)) return [];
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed.attempts) ? parsed.attempts : [];
  } catch {
    return [];
  }
}

async function withAttemptDerivedMetadata(workspace: string, attempts: TaskAttemptRecord[]) {
  return Promise.all(attempts.map(async (attempt) => {
    const withEvidence = await withWorkEvidenceSummary(workspace, attempt);
    const withAudit = await withValidationRepairAuditMetadata(workspace, withEvidence);
    const withTelemetry = await withValidationRepairTelemetryMetadata(workspace, withAudit);
    const withBundleAudit = await withSessionBundleAuditMetadata(workspace, withTelemetry);
    const withConversationProjection = await withConversationProjectionMetadata(workspace, withBundleAudit);
    const withCodingDelivery = await withCodingDeliverySummary(workspace, withConversationProjection);
    return withTaskRunCard(withCodingDelivery);
  }));
}

function withTaskRunCard(record: TaskAttemptRecord): TaskAttemptRecord {
  const refs = taskRunCardRefsForAttempt(record);
  const failureSignatures = failureSignaturesForAttempt(record);
  const genericAttributionLayer = genericAttributionLayerForAttempt(failureSignatures);
  const conversationProjection = conversationProjectionMetadataFromAttempt(record);
  return {
    ...record,
    taskRunCard: createTaskRunCard({
      id: `task-card:${record.id}:${record.attempt}`,
      taskId: record.id,
      title: record.skillId ?? record.id,
      goal: record.prompt,
      protocolStatus: protocolStatusForAttempt(record),
      taskOutcome: outcomeStatusForAttempt(record, refs),
      rounds: [{
        round: record.attempt,
        prompt: record.prompt,
        expected: 'Complete the requested task with durable refs, visible output, and recoverable diagnostics.',
        observed: observedAttemptSummary(record),
        status: roundStatusForAttempt(record),
        refs,
      }],
      refs,
      failureSignatures,
      genericAttributionLayer,
      ownershipLayerSuggestions: ownershipLayerSuggestionsForAttempt(record, genericAttributionLayer),
      conversationProjectionRef: conversationProjection.ref,
      conversationProjectionSummary: conversationProjection.summary,
      codingDeliverySummary: codingDeliverySummaryFromAttempt(record),
      updatedAt: record.createdAt,
      noHardcodeReview: {
        appliesGenerally: true,
        generalityStatement: 'TaskRunCard is projected only from stable task attempt fields, refs, status, and diagnostics; it does not branch on prompt wording, paper title, artifact name, or backend-specific success paths.',
        counterExamples: [
          'A semantic quality judgment still requires backend, verifier, or user evidence beyond this protocol card.',
          'A dry-run planning message without task refs should not be treated as completed work.',
        ],
        ownerLayer: 'runtime-server',
      },
    }),
  };
}

function ownershipLayerSuggestionsForAttempt(
  record: TaskAttemptRecord,
  genericAttributionLayer: TaskAttributionLayer,
): Array<Partial<OwnershipLayerSuggestion>> {
  const suggestions: Array<Partial<OwnershipLayerSuggestion>> = [];
  const conversationProjection = conversationProjectionMetadataFromAttempt(record).summary;
  if (conversationProjection?.failureOwner) {
    const layer = attributionLayerFromProjectionOwner(conversationProjection.failureOwner.ownerLayer);
    suggestions.push({
      layer,
      confidence: 'high',
      reason: `ConversationProjection failure owner maps this attempt to ${conversationProjection.failureOwner.ownerLayer}.`,
      signals: [
        `conversation:${conversationProjection.conversationId}`,
        `kernelStatus:${conversationProjection.status}`,
        `failureOwner:${conversationProjection.failureOwner.ownerLayer}`,
      ],
      nextStep: conversationProjection.failureOwner.nextStep ?? conversationProjection.recoverActions[0] ?? 'Review kernel projection recovery actions before rerun.',
    });
  }
  if (conversationProjection?.verificationState?.status === 'failed') {
    suggestions.push({
      layer: 'verification',
      confidence: 'high',
      reason: 'ConversationProjection verification state is failed, so verifier evidence owns the next improvement.',
      signals: [`verification:${conversationProjection.verificationState.verdict ?? 'failed'}`],
      nextStep: conversationProjection.recoverActions[0] ?? 'Supplement verifier evidence before marking the task satisfied.',
    });
  }
  if (conversationProjection?.backgroundState && conversationProjection.backgroundState.status !== 'completed') {
    suggestions.push({
      layer: 'runtime-server',
      confidence: 'medium',
      reason: 'ConversationProjection has an unfinished background continuation state.',
      signals: [
        `background:${conversationProjection.backgroundState.status}`,
        ...conversationProjection.backgroundState.checkpointRefs.map((ref) => `checkpoint:${ref}`),
      ],
      nextStep: conversationProjection.recoverActions[0] ?? 'Resume background continuation from preserved checkpoint refs.',
    });
  }
  if (record.runtimeProfileId) {
    suggestions.push({
      layer: 'harness',
      confidence: record.status === 'planned' || record.status === 'running' ? 'medium' : 'low',
      reason: 'Attempt metadata includes a harness/runtime profile, so profile and stage policy are a candidate ownership layer.',
      signals: [`runtimeProfileId:${record.runtimeProfileId}`, `status:${record.status}`],
      nextStep: 'Review harness profile, budget, and stage-hook decisions before rerun.',
    });
  }
  if (record.uiPlanRef) {
    suggestions.push({
      layer: 'presentation',
      confidence: 'low',
      reason: 'Attempt metadata includes a UI/presentation plan ref, so result projection is a candidate ownership layer.',
      signals: [`uiPlanRef:${record.uiPlanRef}`],
      nextStep: 'Materialize the result presentation contract from preserved refs before changing task logic.',
    });
  }
  if (record.routeDecision?.fallbackReason) {
    suggestions.push({
      layer: genericAttributionLayer === 'unknown' ? 'runtime-server' : genericAttributionLayer,
      confidence: 'medium',
      reason: 'Route decision metadata contains a fallback reason, so the selected generic runtime owner should be reviewed.',
      signals: [`routeFallback:${record.routeDecision.fallbackReason}`],
      nextStep: 'Inspect runtime routing and preserved diagnostics before rerun.',
    });
  }
  return suggestions;
}

function genericAttributionLayerForAttempt(failureSignatures: FailureSignatureInput[]): TaskAttributionLayer {
  const signatures = failureSignatures.map((signature) => createFailureSignature(signature));
  return signatures.find((signature) => signature.kind === 'external-transient')?.layer
    ?? signatures[0]?.layer
    ?? 'runtime-server';
}

function protocolStatusForAttempt(record: TaskAttemptRecord): TaskProtocolStatus {
  if (record.status === 'planned') return 'not-run';
  if (record.status === 'running') return 'running';
  if (record.status === 'done' || record.status === 'self-healed' || record.status === 'record-only') return 'protocol-success';
  return 'protocol-failed';
}

function outcomeStatusForAttempt(record: TaskAttemptRecord, refs: TaskRunCardRef[]): TaskOutcomeStatus {
  if (record.status === 'running' || record.status === 'planned') return 'unknown';
  if (record.status === 'done' || record.status === 'self-healed') return 'satisfied';
  if (record.status === 'needs-human') return 'needs-human';
  if (record.status === 'repair-needed' || record.status === 'failed-with-reason') return refs.length ? 'needs-work' : 'blocked';
  if (record.status === 'record-only') return refs.length ? 'needs-work' : 'unknown';
  return refs.length ? 'needs-work' : 'blocked';
}

function roundStatusForAttempt(record: TaskAttemptRecord): TaskRoundStatus {
  if (record.status === 'done' || record.status === 'self-healed') return 'passed';
  if (record.status === 'needs-human') return 'needs-human';
  if (record.status === 'record-only' || record.status === 'repair-needed') return 'partial';
  if (record.status === 'planned') return 'not-run';
  return 'failed';
}

function observedAttemptSummary(record: TaskAttemptRecord) {
  const conversationProjection = conversationProjectionMetadataFromAttempt(record).summary;
  const parts = [
    `status=${record.status}`,
    record.exitCode !== undefined ? `exitCode=${record.exitCode}` : '',
    record.failureReason ? `failure=${record.failureReason}` : '',
    record.schemaErrors?.length ? `schemaErrors=${record.schemaErrors.length}` : '',
    record.workEvidenceSummary ? `workEvidence=${record.workEvidenceSummary.count}` : '',
    conversationProjection ? `conversation=${conversationProjection.status}` : '',
  ].filter(Boolean);
  return parts.join('; ') || 'Attempt recorded without additional diagnostics.';
}

function taskRunCardRefsForAttempt(record: TaskAttemptRecord): TaskRunCardRef[] {
  return [
    taskRef('execution-unit', `execution-unit:${record.id}`, record.skillId ?? record.id, record.status),
    taskRef('file', record.codeRef, 'task code'),
    taskRef('file', record.inputRef, 'task input'),
    taskRef('artifact', record.outputRef, 'task output'),
    taskRef('log', record.stdoutRef, 'stdout'),
    taskRef('log', record.stderrRef, 'stderr'),
    taskRef('bundle', record.sessionBundleRef, 'session bundle'),
    ...codingDeliveryRefsForAttempt(record),
    ...attemptRecordRefs(record),
  ].filter((ref): ref is TaskRunCardRef => Boolean(ref));
}

function codingDeliveryRefsForAttempt(record: TaskAttemptRecord): TaskRunCardRef[] {
  const summary = codingDeliverySummaryFromAttempt(record);
  if (!summary) return [];
  return [
    ...summary.readFiles.map((ref) => taskRef('file', ref, 'codingDelivery.readFiles')),
    ...summary.plannedFiles.map((ref) => taskRef('file', ref, 'codingDelivery.plannedFiles')),
    ...summary.modifiedFiles.map((ref) => taskRef('file', ref, 'codingDelivery.modifiedFiles')),
    ...summary.patchRefs.map((ref) => taskRef('artifact', ref, 'codingDelivery.patchRefs')),
  ].filter((ref): ref is TaskRunCardRef => Boolean(ref));
}

function attemptRecordRefs(record: TaskAttemptRecord): TaskRunCardRef[] {
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  if (!isRecord(current.refs)) return [];
  return Object.entries(current.refs).flatMap(([key, value]) => {
    const values = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? [value]
        : [];
    return values
      .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
      .map((ref) => taskRef(refKindForAttemptRefKey(key), ref, key))
      .filter((ref): ref is TaskRunCardRef => Boolean(ref));
  });
}

function refKindForAttemptRefKey(key: string): TaskRunCardRef['kind'] {
  if (/audit|verification/i.test(key)) return 'verification';
  if (/log|stderr|stdout/i.test(key)) return 'log';
  if (/bundle/i.test(key)) return 'bundle';
  if (/artifact|output/i.test(key)) return 'artifact';
  return 'other';
}

function taskRef(
  kind: TaskRunCardRef['kind'],
  ref: string | undefined,
  label?: string,
  status?: string,
): TaskRunCardRef | undefined {
  if (!ref?.trim()) return undefined;
  return { kind, ref: ref.trim(), label, status };
}

function failureSignaturesForAttempt(record: TaskAttemptRecord): FailureSignatureInput[] {
  const signatures: FailureSignatureInput[] = [];
  const conversationProjection = conversationProjectionMetadataFromAttempt(record).summary;
  if (conversationProjection?.failureOwner) {
    signatures.push({
      message: conversationProjection.failureOwner.reason,
      layer: attributionLayerFromProjectionOwner(conversationProjection.failureOwner.ownerLayer),
      code: String(conversationProjection.failureOwner.ownerLayer),
      retryable: conversationProjection.failureOwner.retryable,
      refs: conversationProjection.failureOwner.evidenceRefs,
    });
  }
  if (record.failureReason) {
    signatures.push({
      kind: record.failureKind,
      layer: record.failureLayer,
      code: record.failureCode,
      httpStatus: record.httpStatus,
      message: record.failureReason,
      operation: record.skillId,
      refs: [record.stderrRef, record.stdoutRef, record.outputRef].filter((ref): ref is string => Boolean(ref)),
    });
  }
  for (const error of record.schemaErrors ?? []) {
    signatures.push({
      kind: 'schema-drift' as const,
      message: error,
      schemaPath: 'task-attempt.schemaErrors',
      refs: [record.outputRef].filter((ref): ref is string => Boolean(ref)),
    });
  }
  if (record.exitCode !== undefined && record.exitCode !== 0 && !record.failureReason) {
    signatures.push({
      message: `Workspace task exited with code ${record.exitCode}.`,
      operation: record.skillId,
      code: `exit-${record.exitCode}`,
      refs: [record.stderrRef, record.stdoutRef].filter((ref): ref is string => Boolean(ref)),
    });
  }
  return signatures;
}

async function withConversationProjectionMetadata(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  const fromAttempt = conversationProjectionMetadataFromAttempt(record);
  const fromOutput = record.outputRef
    ? await conversationProjectionMetadataFromOutput(workspace, record.outputRef)
    : {};
  const summary = fromAttempt.summary ?? fromOutput.summary;
  const ref = fromAttempt.ref ?? fromOutput.ref;
  if (!summary && !ref) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    conversationProjectionRef: ref,
    conversationProjectionSummary: summary,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      ...(ref ? { conversationProjection: [ref] } : {}),
    },
  } as TaskAttemptRecord;
}

async function withCodingDeliverySummary(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  const fromAttempt = codingDeliverySummaryFromAttempt(record);
  const fromOutput = record.outputRef
    ? await codingDeliverySummaryFromOutput(workspace, record.outputRef)
    : undefined;
  const summary = mergeCodingDeliverySummaries(fromAttempt, fromOutput);
  if (!summary) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    codingDeliverySummary: summary,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      codingDeliveryReadFiles: summary.readFiles,
      codingDeliveryPlannedFiles: summary.plannedFiles,
      codingDeliveryModifiedFiles: summary.modifiedFiles,
      codingDeliveryPatchRefs: summary.patchRefs,
    },
  } as TaskAttemptRecord;
}

function codingDeliverySummaryFromAttempt(record: TaskAttemptRecord): CodingDeliverySummary | undefined {
  return normalizeCodingDeliverySummary(record.codingDeliverySummary);
}

async function codingDeliverySummaryFromOutput(
  workspace: string,
  outputRef: string,
): Promise<CodingDeliverySummary | undefined> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return undefined;
  }
  return codingDeliverySummaryFromPayload(parsed);
}

function codingDeliverySummaryFromPayload(payload: unknown): CodingDeliverySummary | undefined {
  const root = isRecord(payload) ? payload : {};
  const displayIntent = isRecord(root.displayIntent) ? root.displayIntent : {};
  const taskOutcomeProjection = isRecord(displayIntent.taskOutcomeProjection) ? displayIntent.taskOutcomeProjection : {};
  const resultPresentation = isRecord(displayIntent.resultPresentation) ? displayIntent.resultPresentation : {};
  const taskRunCard = isRecord(displayIntent.taskRunCard)
    ? displayIntent.taskRunCard
    : isRecord(taskOutcomeProjection.taskRunCard)
      ? taskOutcomeProjection.taskRunCard
      : isRecord(resultPresentation.taskRunCard)
        ? resultPresentation.taskRunCard
        : {};
  return normalizeCodingDeliverySummary(
    root.codingDeliverySummary
      ?? displayIntent.codingDeliverySummary
      ?? taskOutcomeProjection.codingDeliverySummary
      ?? resultPresentation.codingDeliverySummary
      ?? taskRunCard.codingDeliverySummary,
  );
}

function mergeCodingDeliverySummaries(
  left: CodingDeliverySummary | undefined,
  right: CodingDeliverySummary | undefined,
): CodingDeliverySummary | undefined {
  if (!left) return right;
  if (!right) return left;
  return normalizeCodingDeliverySummary({
    readFiles: [...left.readFiles, ...right.readFiles],
    plannedFiles: [...left.plannedFiles, ...right.plannedFiles],
    modifiedFiles: [...left.modifiedFiles, ...right.modifiedFiles],
    patchRefs: [...left.patchRefs, ...right.patchRefs],
    verificationCommands: [...left.verificationCommands, ...right.verificationCommands],
    riskChecklist: [...left.riskChecklist, ...right.riskChecklist],
    generalityStatement: left.generalityStatement ?? right.generalityStatement,
  });
}

function normalizeCodingDeliverySummary(value: unknown): CodingDeliverySummary | undefined {
  if (!isRecord(value)) return undefined;
  const summary = {
    schemaVersion: 'sciforge.coding-delivery-summary.v1' as const,
    readFiles: uniqueStrings(stringArray(value.readFiles)),
    plannedFiles: uniqueStrings(stringArray(value.plannedFiles)),
    modifiedFiles: uniqueStrings(stringArray(value.modifiedFiles)),
    patchRefs: uniqueStrings(stringArray(value.patchRefs)),
    verificationCommands: uniqueStrings(stringArray(value.verificationCommands)),
    riskChecklist: uniqueStrings(stringArray(value.riskChecklist)),
    generalityStatement: stringField(value.generalityStatement),
  };
  return summary.readFiles.length
    || summary.plannedFiles.length
    || summary.modifiedFiles.length
    || summary.patchRefs.length
    || summary.verificationCommands.length
    || summary.riskChecklist.length
    ? summary
    : undefined;
}

function conversationProjectionMetadataFromAttempt(record: TaskAttemptRecord): {
  ref?: string;
  summary?: TaskRunCardConversationProjectionSummary;
} {
  const current = record as TaskAttemptRecord & {
    conversationProjectionRef?: unknown;
    conversationProjectionSummary?: unknown;
    refs?: Record<string, unknown>;
  };
  const ref = stringField(current.conversationProjectionRef)
    ?? (isRecord(current.refs) ? firstString(current.refs.conversationProjection) : undefined);
  const summary = normalizeConversationProjectionSummary(current.conversationProjectionSummary);
  return { ref, summary };
}

async function conversationProjectionMetadataFromOutput(
  workspace: string,
  outputRef: string,
): Promise<{ ref?: string; summary?: TaskRunCardConversationProjectionSummary }> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return {};
  }
  return conversationProjectionMetadataFromPayload(parsed, `${outputRef}#displayIntent.conversationProjection`);
}

function conversationProjectionMetadataFromPayload(payload: unknown, fallbackRef?: string): {
  ref?: string;
  summary?: TaskRunCardConversationProjectionSummary;
} {
  const root = isRecord(payload) ? payload : {};
  const displayIntent = isRecord(root.displayIntent) ? root.displayIntent : root;
  const projection = isRecord(displayIntent.conversationProjection)
    ? displayIntent.conversationProjection
    : isRecord(displayIntent.taskOutcomeProjection) && isRecord(displayIntent.taskOutcomeProjection.conversationProjection)
      ? displayIntent.taskOutcomeProjection.conversationProjection
      : isRecord(displayIntent.resultPresentation) && isRecord(displayIntent.resultPresentation.conversationProjection)
        ? displayIntent.resultPresentation.conversationProjection
      : undefined;
  const embeddedCard = isRecord(displayIntent.taskRunCard)
    ? displayIntent.taskRunCard
    : isRecord(displayIntent.taskOutcomeProjection) && isRecord(displayIntent.taskOutcomeProjection.taskRunCard)
      ? displayIntent.taskOutcomeProjection.taskRunCard
      : isRecord(displayIntent.resultPresentation) && isRecord(displayIntent.resultPresentation.taskRunCard)
        ? displayIntent.resultPresentation.taskRunCard
      : undefined;
  const embeddedSummary = normalizeConversationProjectionSummary(embeddedCard?.conversationProjectionSummary);
  const explicitRef = stringField(displayIntent.conversationProjectionRef) ?? stringField(embeddedCard?.conversationProjectionRef);
  return {
    ref: explicitRef ?? (projection ? fallbackRef : undefined),
    summary: embeddedSummary ?? conversationProjectionSummaryFromProjection(projection),
  };
}

async function materializeTerminalProjectionForSessionRun(workspace: string, record: TaskAttemptRecord) {
  if (!record.sessionBundleRef || !record.taskRunCard?.conversationProjectionSummary) return;
  const projection = record.outputRef
    ? await conversationProjectionFromOutput(workspace, record.outputRef)
    : undefined;
  if (!projection) return;
  const bundleRoot = workspaceSafePath(workspace, record.sessionBundleRef);
  if (!bundleRoot) return;
  const sessionPath = join(bundleRoot, 'records', 'session.json');
  const runsPath = join(bundleRoot, 'records', 'runs.json');
  const session = await readJsonRecord(sessionPath);
  if (!session) return;

  const createdAt = stringField(record.createdAt) ?? new Date().toISOString();
  const completedAt = new Date().toISOString();
  const runId = record.taskRunCard.conversationProjectionSummary.activeRunId
    ?? stringField(record.taskRunCard.id)
    ?? `task-attempt:${record.id}:${record.attempt}`;
  const visibleAnswer = isRecord(projection.visibleAnswer) ? projection.visibleAnswer : {};
  const responseText = stringField(visibleAnswer.text)
    ?? stringField(visibleAnswer.diagnostic)
    ?? record.taskRunCard.nextStep
    ?? record.taskRunCard.goal
    ?? '';
  const runStatus = runStatusFromProjectionStatus(record.taskRunCard.conversationProjectionSummary.status);
  const current = record as TaskAttemptRecord & { conversationProjectionRef?: unknown };
  const projectionRef = stringField(record.taskRunCard.conversationProjectionRef)
    ?? stringField(current.conversationProjectionRef);
  const minimalRun = {
    id: runId,
    scenarioId: stringField(record.scenarioPackageRef?.id) ?? stringField(session.scenarioId) ?? record.skillDomain,
    scenarioPackageRef: record.scenarioPackageRef,
    skillPlanRef: record.skillPlanRef,
    uiPlanRef: record.uiPlanRef,
    status: runStatus,
    prompt: record.prompt,
    response: responseText,
    createdAt,
    completedAt: runStatus === 'running' ? undefined : completedAt,
    raw: {
      displayIntent: {
        conversationProjection: projection,
        conversationProjectionRef: projectionRef,
        taskRunCard: record.taskRunCard,
      },
      conversationProjectionRef: projectionRef,
      taskAttemptRef: `${record.sessionBundleRef.replace(/\/+$/, '')}/records/task-attempts/${safeName(record.id)}.json`,
    },
  };
  const existingRuns = Array.isArray(session.runs) ? session.runs.filter(isRecord) : await readJsonArray(runsPath);
  const runs = mergeRunRecords(existingRuns, minimalRun);
  const projectionMap = projectionMapWithRun(
    isRecord(session.materializedConversationProjections) ? session.materializedConversationProjections : undefined,
    runId,
    projection,
  );
  const nextSession = {
    ...session,
    runs,
    materializedConversationProjection: projection,
    materializedConversationProjections: projectionMap,
    updatedAt: completedAt,
  };
  await writeFile(sessionPath, JSON.stringify(nextSession, null, 2));
  await writeFile(runsPath, JSON.stringify(runs, null, 2));
}

async function conversationProjectionFromOutput(workspace: string, outputRef: string): Promise<Record<string, unknown> | undefined> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(outputPath, 'utf8'));
  } catch {
    return undefined;
  }
  const root = isRecord(parsed) ? parsed : {};
  const displayIntent = isRecord(root.displayIntent) ? root.displayIntent : root;
  const projection = isRecord(displayIntent.conversationProjection)
    ? displayIntent.conversationProjection
    : isRecord(displayIntent.taskOutcomeProjection) && isRecord(displayIntent.taskOutcomeProjection.conversationProjection)
      ? displayIntent.taskOutcomeProjection.conversationProjection
      : isRecord(displayIntent.resultPresentation) && isRecord(displayIntent.resultPresentation.conversationProjection)
        ? displayIntent.resultPresentation.conversationProjection
      : undefined;
  return isRecord(projection) && projection.schemaVersion === 'sciforge.conversation-projection.v1'
    ? projection
    : undefined;
}

async function readJsonRecord(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function readJsonArray(path: string): Promise<Record<string, unknown>[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function mergeRunRecords(runs: Record<string, unknown>[], nextRun: Record<string, unknown>) {
  const nextId = stringField(nextRun.id);
  if (!nextId) return runs;
  const found = runs.some((run) => stringField(run.id) === nextId);
  if (!found) return [...runs, nextRun];
  return runs.map((run) => stringField(run.id) === nextId ? { ...run, ...nextRun } : run);
}

function projectionMapWithRun(current: Record<string, unknown> | undefined, runId: string, projection: Record<string, unknown>) {
  const currentProjections = isRecord(current?.projections) ? current.projections : {};
  return {
    ...(current ?? {}),
    currentRunId: runId,
    activeRunId: runId,
    current: projection,
    latest: projection,
    projections: {
      ...currentProjections,
      [runId]: projection,
    },
  };
}

function runStatusFromProjectionStatus(status: string) {
  if (status === 'running' || status === 'idle') return status;
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'failed-with-reason') return 'failed';
  return 'completed';
}

function conversationProjectionSummaryFromProjection(projection: unknown): TaskRunCardConversationProjectionSummary | undefined {
  if (!isRecord(projection) || projection.schemaVersion !== 'sciforge.conversation-projection.v1') return undefined;
  const conversationId = stringField(projection.conversationId);
  if (!conversationId) return undefined;
  const visibleAnswer = isRecord(projection.visibleAnswer) ? projection.visibleAnswer : {};
  const activeRun = isRecord(projection.activeRun) ? projection.activeRun : {};
  const diagnostics = Array.isArray(projection.diagnostics)
    ? projection.diagnostics.filter(isRecord)
    : [];
  const recoverActions = uniqueStrings(Array.isArray(projection.recoverActions)
    ? projection.recoverActions.filter((action): action is string => typeof action === 'string' && action.trim().length > 0)
    : []);
  const failureDiagnostic = diagnostics.find((diagnostic) => stringField(diagnostic.code) || diagnostic.severity === 'error');
  const verificationState = isRecord(projection.verificationState) ? projection.verificationState : undefined;
  const backgroundState = isRecord(projection.backgroundState) ? projection.backgroundState : undefined;
  return normalizeConversationProjectionSummary({
    schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1',
    conversationId,
    status: stringField(visibleAnswer.status) ?? stringField(activeRun.status) ?? 'idle',
    activeRunId: stringField(activeRun.id),
    failureOwner: failureDiagnostic
      ? {
          ownerLayer: stringField(failureDiagnostic.code) ?? 'unknown',
          reason: stringField(failureDiagnostic.message) ?? 'ConversationProjection reported a failure diagnostic.',
          evidenceRefs: Array.isArray(failureDiagnostic.refs)
            ? failureDiagnostic.refs
                .filter(isRecord)
                .map((ref) => stringField(ref.ref))
                .filter((ref): ref is string => Boolean(ref))
            : [],
          nextStep: recoverActions[0],
        }
      : undefined,
    recoverActions,
    verificationState: verificationState
      ? {
          status: stringField(verificationState.status) ?? 'unverified',
          verifierRef: stringField(verificationState.verifierRef),
          verdict: stringField(verificationState.verdict),
        }
      : undefined,
    backgroundState: backgroundState
      ? {
          status: stringField(backgroundState.status) ?? 'running',
          checkpointRefs: Array.isArray(backgroundState.checkpointRefs)
            ? backgroundState.checkpointRefs.filter((ref): ref is string => typeof ref === 'string')
            : [],
          revisionPlan: stringField(backgroundState.revisionPlan),
        }
      : undefined,
  });
}

function normalizeConversationProjectionSummary(value: unknown): TaskRunCardConversationProjectionSummary | undefined {
  if (!isRecord(value)) return undefined;
  const conversationId = stringField(value.conversationId);
  const status = stringField(value.status);
  if (!conversationId || !status) return undefined;
  const failureOwner = isRecord(value.failureOwner) ? value.failureOwner : undefined;
  const verificationState = isRecord(value.verificationState) ? value.verificationState : undefined;
  const backgroundState = isRecord(value.backgroundState) ? value.backgroundState : undefined;
  return {
    schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1',
    conversationId,
    status,
    activeRunId: stringField(value.activeRunId),
    failureOwner: failureOwner
      ? {
          ownerLayer: stringField(failureOwner.ownerLayer) ?? 'unknown',
          action: stringField(failureOwner.action),
          retryable: typeof failureOwner.retryable === 'boolean' ? failureOwner.retryable : undefined,
          reason: stringField(failureOwner.reason) ?? 'ConversationProjection reported a failure owner.',
          evidenceRefs: Array.isArray(failureOwner.evidenceRefs)
            ? failureOwner.evidenceRefs.filter((ref): ref is string => typeof ref === 'string')
            : [],
          nextStep: stringField(failureOwner.nextStep),
        }
      : undefined,
    recoverActions: Array.isArray(value.recoverActions)
      ? uniqueStrings(value.recoverActions.filter((action): action is string => typeof action === 'string'))
      : [],
    verificationState: verificationState
      ? {
          status: stringField(verificationState.status) ?? 'unverified',
          verifierRef: stringField(verificationState.verifierRef),
          verdict: stringField(verificationState.verdict),
        }
      : undefined,
    backgroundState: backgroundState
      ? {
          status: stringField(backgroundState.status) ?? 'running',
          checkpointRefs: Array.isArray(backgroundState.checkpointRefs)
            ? uniqueStrings(backgroundState.checkpointRefs.filter((ref): ref is string => typeof ref === 'string'))
            : [],
          revisionPlan: stringField(backgroundState.revisionPlan),
        }
      : undefined,
  };
}

function attributionLayerFromProjectionOwner(ownerLayer: unknown): TaskAttributionLayer {
  const owner = String(ownerLayer || '');
  if (owner === 'external-provider') return 'external-provider';
  if (owner === 'payload-contract') return 'payload-normalization';
  if (owner === 'runtime-runner') return 'runtime-server';
  if (owner === 'backend-generation') return 'agentserver-parser';
  if (owner === 'verification') return 'verification';
  if (owner === 'ui-presentation') return 'presentation';
  if (owner === 'payload-normalization' || owner === 'runtime-server' || owner === 'agentserver-parser' || owner === 'presentation') return owner;
  return 'unknown';
}

function firstString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) return value.find((item): item is string => typeof item === 'string' && item.trim().length > 0)?.trim();
  return undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

async function withWorkEvidenceSummary(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  if (record.workEvidenceSummary || !record.outputRef) return record;
  const outputPath = workspaceSafePath(workspace, record.outputRef);
  if (!outputPath || !await fileExists(outputPath)) return record;
  try {
    const parsed = JSON.parse(await readFile(outputPath, 'utf8'));
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(parsed);
    return workEvidenceSummary ? { ...record, workEvidenceSummary } : record;
  } catch {
    return record;
  }
}

async function withValidationRepairAuditMetadata(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  const fromAttempt = validationRepairAuditAttemptMetadataFromAttempt(record);
  const fromOutput = record.outputRef
    ? await validationRepairAuditAttemptMetadataFromOutput(workspace, record.outputRef)
    : undefined;
  const metadata = mergeValidationRepairAuditAttemptMetadata(fromAttempt, fromOutput);
  if (!metadata) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      validationRepairAudit: metadata.auditRefs,
      validationRepairAuditSink: metadata.sinkRefs,
    },
    validationRepairAuditRecords: metadata.auditRecords,
    validationRepairAuditSinkRecords: metadata.sinkRecords,
  } as TaskAttemptRecord;
}

function validationRepairAuditAttemptMetadataFromAttempt(record: TaskAttemptRecord): ValidationRepairAuditAttemptMetadata | undefined {
  const current = record as TaskAttemptRecord & {
    refs?: Record<string, unknown>;
    validationRepairAuditRecords?: unknown;
    validationRepairAuditSinkRecords?: unknown;
  };
  const refs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairAudit)
    ? current.refs.validationRepairAudit
    : [];
  const sinkRefs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairAuditSink)
    ? current.refs.validationRepairAuditSink
    : [];
  const records = Array.isArray(current.validationRepairAuditRecords)
    ? current.validationRepairAuditRecords
    : [];
  const sinkRecords = Array.isArray(current.validationRepairAuditSinkRecords)
    ? current.validationRepairAuditSinkRecords
    : [];
  const projectedFromAuditRecords = records.length
    ? projectValidationRepairAuditSink(records.map((auditRecord) => ({ auditRecord }))).attemptMetadata
    : undefined;
  return refs.length || records.length || sinkRefs.length || sinkRecords.length || projectedFromAuditRecords
    ? mergeValidationRepairAuditAttemptMetadata(projectedFromAuditRecords, {
      auditRefs: refs as ValidationRepairAuditAttemptMetadata['auditRefs'],
      auditRecords: records as ValidationRepairAuditAttemptMetadata['auditRecords'],
      sinkRefs: sinkRefs as ValidationRepairAuditAttemptMetadata['sinkRefs'],
      sinkRecords: sinkRecords as ValidationRepairAuditAttemptMetadata['sinkRecords'],
    })
    : undefined;
}

async function validationRepairAuditAttemptMetadataFromOutput(
  workspace: string,
  outputRef: string,
): Promise<ValidationRepairAuditAttemptMetadata | undefined> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return undefined;
  try {
    return validationRepairAuditAttemptMetadataFromPayload(JSON.parse(await readFile(outputPath, 'utf8')));
  } catch {
    return undefined;
  }
}

async function withValidationRepairTelemetryMetadata(workspace: string, record: TaskAttemptRecord): Promise<TaskAttemptRecord> {
  const fromAttempt = validationRepairTelemetryAttemptMetadataFromAttempt(record);
  const fromOutput = record.outputRef
    ? await validationRepairTelemetryAttemptMetadataFromOutput(workspace, record.outputRef)
    : undefined;
  const telemetryRefs = uniqueTelemetryRefs([
    ...(fromAttempt?.telemetryRefs ?? []),
    ...(fromOutput?.telemetryRefs ?? []),
  ]);
  if (!telemetryRefs.length) return record;
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  return {
    ...record,
    refs: {
      ...(isRecord(current.refs) ? current.refs : {}),
      validationRepairTelemetry: telemetryRefs,
    },
  } as TaskAttemptRecord;
}

async function withSessionBundleAuditMetadata(
  workspace: string,
  record: TaskAttemptRecord,
  persist = false,
): Promise<TaskAttemptRecord> {
  if (!record.sessionBundleRef) return record;
  try {
    const { report: sessionBundleAudit, auditRef } = persist
      ? await writeSessionBundleAudit(workspace, record.sessionBundleRef)
      : {
        report: await auditSessionBundle(workspace, record.sessionBundleRef),
        auditRef: `${record.sessionBundleRef.replace(/\/+$/, '')}/records/session-bundle-audit.json`,
      };
    const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
    return {
      ...record,
      sessionBundleAudit,
      refs: {
        ...(isRecord(current.refs) ? current.refs : {}),
        sessionBundleAudit: [auditRef],
      },
    } as TaskAttemptRecord;
  } catch {
    return record;
  }
}

function validationRepairTelemetryAttemptMetadataFromAttempt(record: TaskAttemptRecord): ValidationRepairTelemetryAttemptMetadata | undefined {
  const current = record as TaskAttemptRecord & { refs?: Record<string, unknown> };
  const telemetryRefs = isRecord(current.refs) && Array.isArray(current.refs.validationRepairTelemetry)
    ? current.refs.validationRepairTelemetry
    : [];
  return validationRepairTelemetryAttemptMetadataFromPayload({ refs: { validationRepairTelemetry: telemetryRefs } });
}

async function validationRepairTelemetryAttemptMetadataFromOutput(
  workspace: string,
  outputRef: string,
): Promise<ValidationRepairTelemetryAttemptMetadata | undefined> {
  const outputPath = workspaceSafePath(workspace, outputRef);
  if (!outputPath || !await fileExists(outputPath)) return undefined;
  try {
    return validationRepairTelemetryAttemptMetadataFromPayload(JSON.parse(await readFile(outputPath, 'utf8')));
  } catch {
    return undefined;
  }
}

function uniqueTelemetryRefs(refs: ValidationRepairTelemetryAttemptMetadata['telemetryRefs']) {
  const byKey = new Map<string, ValidationRepairTelemetryAttemptMetadata['telemetryRefs'][number]>();
  for (const ref of refs) {
    const key = `${ref.ref}:${ref.recordRefs.join('|')}:${ref.spanRefs.join('|')}`;
    if (byKey.has(key)) continue;
    byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function workspaceSafePath(workspace: string, ref: string) {
  try {
    return resolveWorkspaceFileRefPath(ref, workspace);
  } catch {
    return undefined;
  }
}

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
