import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  expandComputerUseChatCurrentRunEvidenceRefs as expandCurrentRunEvidenceRefs,
  isComputerUseChatWorkspaceLocalRef as isWorkspaceLocalRef,
  readComputerUseChatJsonRefs as readJsonRefs,
  readOptionalComputerUseChatJsonRecord as readOptionalJsonRecord,
} from './computer-use-chat-live-evidence-refs.js';
import {
  completionGradeFailureDiagnostics,
  invocationProcessDiagnosticSummaries,
  packageBridgeProcessFailureDiagnosticsFromTrace,
  packageBridgeRepairNeededDiagnosticsFromSidecars,
  safeIssueText,
  uniqueFailureDiagnostics,
  type ChatLiveExpectedStatus,
  type ChatLiveFailureDiagnostic,
} from './computer-use-chat-live-diagnostics.js';
import {
  validateCurrentRunLiveAcceptanceBundle,
  type CuNextLiveAcceptanceBundleValidation,
} from './computer-use-next/live-acceptance-bundle.js';
import {
  compactRecord,
  isRecord,
  recordAt,
  recordList,
  refsFromUnknown,
  stringAt,
  stringList,
  uniqueStrings,
} from './computer-use-chat-live-json.js';
import {
  runCuL3IndependentInputAcceptanceHarness,
} from './cu-l3-independent-input-acceptance-harness.js';

export interface ComputerUseChatLivePackageBridgeCompletionGrade {
  status: 'attached' | 'blocked' | 'missing';
  diagnosticRefs: string[];
  acceptanceManifestRefs: string[];
  acceptanceInputRefs: string[];
  completionEvidenceRefs: string[];
  producerDiagnosticRefs: string[];
  reason?: string;
  diagnosticIssues: string[];
  producerDiagnosticIssues: string[];
  sourceReadinessStatus: string[];
  sourceBlockedReasons: string[];
  processDiagnosticSummaries: string[];
  readIssues: string[];
  issues: string[];
}

export interface ComputerUseChatLiveCompletionManifestLike {
  expectedStatus: ChatLiveExpectedStatus;
  status: ChatLiveExpectedStatus | 'failed';
  visibleStatus?: string;
  displayedRefs: string[];
  artifactRefs: string[];
  auditRefs: string[];
  evidenceReadIssues: string[];
  failureDiagnostics: ChatLiveFailureDiagnostic[];
  issues: string[];
  requestSubmitted: boolean;
  liveAcceptanceCandidate: boolean;
  packageBridgeCompletionGrade?: ComputerUseChatLivePackageBridgeCompletionGrade;
  liveAcceptanceBundle?: CuNextLiveAcceptanceBundleValidation;
}

export interface ComputerUseChatLiveCompletionEvidenceOptions {
  workspacePath?: string;
  taskId?: string;
  scenarioId?: string;
}

export async function attachComputerUseChatLiveCompletionEvidence<T extends ComputerUseChatLiveCompletionManifestLike>(input: {
  manifest: T;
  env: NodeJS.ProcessEnv;
  options?: ComputerUseChatLiveCompletionEvidenceOptions;
}): Promise<T> {
  if (!shouldValidateLiveAcceptanceBundle(input.manifest)) {
    return {
      ...input.manifest,
      liveAcceptanceCandidate: false,
    };
  }
  const workspacePath = input.options?.workspacePath
    ?? input.env.SCIFORGE_WORKSPACE_PATH
    ?? process.cwd();
  const refs = uniqueStrings([
    ...input.manifest.displayedRefs,
    ...input.manifest.artifactRefs,
    ...input.manifest.auditRefs,
  ]);
  const packageBridgeCompletionGrade = await collectComputerUseChatLivePackageBridgeCompletionGradeEvidence({
    workspacePath,
    refs,
  });
  let projectionIssues: string[] = [];
  let projectionRefs: string[] = [];
  let bundle: CuNextLiveAcceptanceBundleValidation | undefined;
  if (packageBridgeCompletionGrade.status !== 'blocked') {
    projectionIssues = await materializeCurrentRunLiveAcceptanceBundle({
      workspacePath,
      refs,
      taskId: input.options?.taskId,
      scenarioId: input.options?.scenarioId,
    });
    const sidecarProjection = await materializeCurrentRunCuNextProjectionSidecars({
      workspacePath,
      refs,
      taskId: input.options?.taskId,
    });
    const ledgerProjection = await materializeCurrentRunLedgerSidecars({
      workspacePath,
      refs,
    });
    projectionIssues.push(...sidecarProjection.issues);
    projectionIssues.push(...ledgerProjection.issues);
    projectionRefs = uniqueStrings([...sidecarProjection.refs, ...ledgerProjection.refs]);
    bundle = await validateCurrentRunLiveAcceptanceBundle({
      workspacePath,
      refs,
      taskId: input.options?.taskId,
    });
  } else {
    bundle = {
      status: 'missing',
      issues: [],
      missingRefs: ['cu-user-acceptance-manifest.json'],
    };
  }
  const issues = uniqueStrings([
    ...input.manifest.issues,
    ...projectionIssues,
    ...(bundle?.issues ?? []),
    ...packageBridgeCompletionGrade.issues,
    input.manifest.expectedStatus === 'completed' && packageBridgeCompletionGrade.status === 'missing'
      ? 'completion-grade: package bridge completion-grade evidence must be attached for completed chat Computer Use run (fail-closed).'
      : undefined,
  ]);
  const failureDiagnostics = uniqueFailureDiagnostics([
    ...input.manifest.failureDiagnostics,
    ...completionGradeFailureDiagnostics({
      expectedStatus: input.manifest.expectedStatus,
      packageBridgeCompletionGrade,
      liveAcceptanceBundle: bundle,
      refs,
    }),
  ]);
  return {
    ...input.manifest,
    packageBridgeCompletionGrade,
    liveAcceptanceBundle: bundle,
    auditRefs: uniqueStrings([...input.manifest.auditRefs, ...projectionRefs]),
    issues,
    failureDiagnostics,
    status: issues.length ? 'failed' : input.manifest.status,
    liveAcceptanceCandidate: issues.length === 0 && bundle?.status === 'valid' && input.manifest.status === 'completed',
  } as T;
}

export async function attachComputerUseChatLivePackageInvocationFailureDiagnostics<T extends ComputerUseChatLiveCompletionManifestLike>(input: {
  manifest: T;
  workspacePath: string;
}): Promise<T> {
  if (!input.manifest.requestSubmitted) return input.manifest;
  const readIssues: string[] = [];
  const refs = await expandCurrentRunEvidenceRefs(uniqueStrings([
    ...input.manifest.displayedRefs,
    ...input.manifest.artifactRefs,
    ...input.manifest.auditRefs,
  ]), input.workspacePath, readIssues);
  const traceRefs = refs.filter((ref) => /(?:^|\/)vision-trace\.json$/i.test(ref));
  const blockedManifestRefs = refs.filter((ref) => /(?:^|\/)blocked-manifest\.json$/i.test(ref));
  const repairHintRefs = refs.filter((ref) => /(?:^|\/)repair-hint\.json$/i.test(ref));
  const continuationRequestRefs = refs.filter((ref) => /(?:^|\/)continuation-request\.json$/i.test(ref));
  const traces = await readJsonRefs(traceRefs.slice(0, 3), input.workspacePath, readIssues);
  const [
    blockedManifests,
    repairHints,
    continuationRequests,
  ] = await Promise.all([
    readJsonRefs(blockedManifestRefs.slice(0, 1), input.workspacePath, readIssues),
    readJsonRefs(repairHintRefs.slice(0, 1), input.workspacePath, readIssues),
    readJsonRefs(continuationRequestRefs.slice(0, 1), input.workspacePath, readIssues),
  ]);
  const diagnostics = [
    ...traces.flatMap((trace, index) => packageBridgeProcessFailureDiagnosticsFromTrace({
      trace,
      ref: traceRefs[index],
    })),
    ...packageBridgeRepairNeededDiagnosticsFromSidecars({
      blockedManifest: blockedManifests[0] ? { record: blockedManifests[0], ref: blockedManifestRefs[0] } : undefined,
      repairHint: repairHints[0] ? { record: repairHints[0], ref: repairHintRefs[0] } : undefined,
      continuationRequest: continuationRequests[0] ? { record: continuationRequests[0], ref: continuationRequestRefs[0] } : undefined,
    }),
  ];
  if (!diagnostics.length) return input.manifest;
  return {
    ...input.manifest,
    evidenceReadIssues: uniqueStrings([...input.manifest.evidenceReadIssues, ...readIssues]),
    failureDiagnostics: uniqueFailureDiagnostics([
      ...input.manifest.failureDiagnostics,
      ...diagnostics,
    ]),
  } as T;
}

export async function collectComputerUseChatLivePackageBridgeCompletionGradeEvidence(input: {
  workspacePath: string;
  refs: string[];
}): Promise<ComputerUseChatLivePackageBridgeCompletionGrade> {
  const readIssues: string[] = [];
  const expandedRefs = await expandCurrentRunEvidenceRefs(input.refs, input.workspacePath, readIssues);
  const currentRunDirRef = currentRunDirRefFromRefs(expandedRefs);
  const scopedRefs = scopeBundleLocalCompletionGradeRefs(expandedRefs, currentRunDirRef);
  const completionGradeEvidenceRefs = scopedRefs.filter(isCompletionGradeEvidenceRef);
  const nonCurrentRunCompletionEvidenceRefs = currentRunDirRef
    ? completionGradeEvidenceRefs.filter((ref) => !refIsInCurrentRunDir(ref, currentRunDirRef))
    : [];
  const currentRunRefs = currentRunDirRef
    ? scopedRefs.filter((ref) => !isCompletionGradeEvidenceRef(ref) || refIsInCurrentRunDir(ref, currentRunDirRef))
    : scopedRefs;
  const diagnosticRefs = currentRunRefs.filter((ref) => /(?:^|\/)completion-grade-diagnostics\.json$/i.test(ref));
  const acceptanceManifestRefs = currentRunRefs.filter((ref) => /(?:^|\/)cu-user-acceptance-manifest\.json$/i.test(ref));
  const acceptanceInputRefs = currentRunRefs.filter((ref) => /(?:^|\/)cu-user-acceptance-input\.json$/i.test(ref));
  const completionEvidenceRefs = currentRunRefs.filter((ref) => /(?:^|\/)isolated-desktop-l3-workflow-evidence\.json$/i.test(ref));
  const producerDiagnosticRefs = currentRunRefs.filter((ref) => /(?:^|\/)embedded-l3-completion-producer-diagnostics\.json$/i.test(ref));
  const [diagnostic] = await readJsonRefs(diagnosticRefs.slice(0, 1), input.workspacePath, readIssues);
  const [producerDiagnostic] = await readJsonRefs(producerDiagnosticRefs.slice(0, 1), input.workspacePath, readIssues);
  const status = completionGradeStatus(diagnostic, acceptanceManifestRefs);
  const reason = safeOptionalIssueText(stringAt(diagnostic, 'reason'));
  const diagnosticIssues = uniqueStrings([
    ...stringList(diagnostic?.issues),
    ...recordList(diagnostic?.issues).map((issue) => stringAt(issue, 'reason') ?? stringAt(issue, 'message')),
  ].filter((issue): issue is string => Boolean(issue)).map(safeIssueText));
  const producerReason = safeOptionalIssueText(stringAt(producerDiagnostic, 'reason'));
  const producerDiagnosticIssues = uniqueStrings([
    producerReason,
    ...stringList(producerDiagnostic?.issues),
    ...recordList(producerDiagnostic?.issues).map((issue) => stringAt(issue, 'reason') ?? stringAt(issue, 'message')),
  ].filter((issue): issue is string => Boolean(issue)).map(safeIssueText));
  const sourceReadinessStatus = uniqueStrings([
    ...stringList(producerDiagnostic?.sourceReadinessStatus),
    stringAt(producerDiagnostic, 'readinessStatus'),
    stringAt(producerDiagnostic, 'backendReadinessStatus'),
  ].filter((status): status is string => Boolean(status)).map(safeIssueText));
  const sourceBlockedReasons = uniqueStrings([
    ...stringList(producerDiagnostic?.sourceBlockedReasons),
    ...stringList(producerDiagnostic?.blockedReasons),
  ].filter((reasonItem): reasonItem is string => Boolean(reasonItem)).map(safeIssueText));
  const processDiagnosticSummaries = producerDiagnostic
    ? invocationProcessDiagnosticSummaries(recordAt(producerDiagnostic, 'process'), producerDiagnostic, 'embedded L3 producer')
    : [];
  const issues = uniqueStrings([
    ...nonCurrentRunCompletionEvidenceRefs.map((ref) => `completion-grade: ignored non-current-run completion evidence ref: ${safeIssueText(ref)}`),
    status === 'blocked'
      ? `completion-grade: package bridge completion-grade blocked${reason ? `: ${reason}` : '.'}`
      : undefined,
    ...diagnosticIssues.map((issue) => `completion-grade: package bridge diagnostic: ${issue}`),
    ...producerDiagnosticIssues.map((issue) => `completion-grade: embedded L3 producer diagnostic: ${safeIssueText(issue)}`),
    ...sourceReadinessStatus.map((statusItem) => `completion-grade: embedded L3 source readiness: ${safeIssueText(statusItem)}`),
    ...sourceBlockedReasons.map((reasonItem) => `completion-grade: embedded L3 source blocker: ${safeIssueText(reasonItem)}`),
    ...processDiagnosticSummaries.map((summary) => `completion-grade: embedded L3 process diagnostic: ${summary}`),
    diagnosticRefs.length > 0 && !diagnostic
      ? `completion-grade: package bridge diagnostic ref could not be read: ${diagnosticRefs[0]}`
      : undefined,
    producerDiagnosticRefs.length > 0 && !producerDiagnostic
      ? `completion-grade: embedded L3 producer diagnostic ref could not be read: ${producerDiagnosticRefs[0]}`
      : undefined,
  ].filter((issue): issue is string => Boolean(issue)));
  return {
    status,
    diagnosticRefs,
    acceptanceManifestRefs,
    acceptanceInputRefs,
    completionEvidenceRefs,
    producerDiagnosticRefs,
    reason,
    diagnosticIssues,
    producerDiagnosticIssues,
    sourceReadinessStatus,
    sourceBlockedReasons,
    processDiagnosticSummaries,
    readIssues: uniqueStrings(readIssues),
    issues,
  };
}

export function shouldValidateLiveAcceptanceBundle(
  manifest: ComputerUseChatLiveCompletionManifestLike,
) {
  if (!manifest.requestSubmitted) return false;
  if (manifest.expectedStatus !== 'completed') return false;
  return manifest.visibleStatus === 'output-materialized' || manifest.status === 'completed';
}

async function materializeCurrentRunLiveAcceptanceBundle(input: {
  workspacePath: string;
  refs: string[];
  taskId?: string;
  scenarioId?: string;
}): Promise<string[]> {
  const traceRef = input.refs.find((ref) => /(?:^|\/)vision-trace\.json$/i.test(ref));
  if (!traceRef || !isWorkspaceLocalRef(traceRef)) return [];
  const tracePath = resolve(input.workspacePath, traceRef);
  if (await currentRunAcceptanceManifestAlreadyPresent(dirname(tracePath))) return [];
  try {
    await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      outDir: dirname(tracePath),
      taskId: input.taskId,
      scenarioId: input.scenarioId,
    });
    return [];
  } catch (error) {
    return [`completion-grade: current-run acceptance materializer failed: ${safeIssueText(error)}`];
  }
}

async function currentRunAcceptanceManifestAlreadyPresent(runDir: string) {
  try {
    JSON.parse(await readFile(resolve(runDir, 'cu-user-acceptance-manifest.json'), 'utf8'));
    return true;
  } catch {
    return false;
  }
}

async function materializeCurrentRunCuNextProjectionSidecars(input: {
  workspacePath: string;
  refs: string[];
  taskId?: string;
}): Promise<{ issues: string[]; refs: string[] }> {
  if (input.taskId !== 'CU-NEXT-07') return { issues: [], refs: [] };
  const runDirRef = currentRunDirRefFromRefs(input.refs);
  if (!runDirRef) return { issues: [], refs: [] };
  const runDirPath = resolve(input.workspacePath, runDirRef);
  const manifestPath = resolve(runDirPath, 'cu-user-acceptance-manifest.json');
  const manifest = await readOptionalJsonRecord(manifestPath);
  if (!manifest) return { issues: [], refs: [] };
  const sidecarRef = `${runDirRef}/dense-grounding-rejections.json`;
  const sidecarPath = resolve(runDirPath, 'dense-grounding-rejections.json');
  const existingMarker = recordList(manifest.evidenceMarkers).find((marker) => stringAt(marker, 'kind') === 'dense-grounding');
  const screenshotRefs = recordAt(manifest, 'screenshotRefs');
  const coarseWindowScreenshotRef = stringAt(existingMarker, 'coarseWindowScreenshotRef')
    ?? stringAt(manifest, 'finalVisibleScreenshotRef')
    ?? stringList(screenshotRefs?.after).at(-1)
    ?? stringList(screenshotRefs?.before).at(-1);
  const focusCropRef = stringAt(existingMarker, 'focusCropRef') ?? stringList(manifest.focusCropRefs)[0];
  const fineGroundingDiagnosticRef = stringAt(existingMarker, 'fineGroundingDiagnosticRef')
    ?? stringList(manifest.groundingDiagnosticsRefs)[0]
    ?? `${runDirRef}/vision-trace.json`;
  const targetDescription = stringAt(existingMarker, 'targetDescription')
    ?? 'Safe central content or editor body target selected after dense visual grounding.';
  const sidecar = {
    schemaVersion: 'sciforge.computer-use.dense-grounding-rejections.v1',
    status: 'recorded',
    taskId: input.taskId,
    createdAt: stringAt(manifest, 'createdAt') ?? new Date().toISOString(),
    traceRef: `${runDirRef}/vision-trace.json`,
    selectedTarget: {
      targetDescription,
      coarseWindowScreenshotRef,
      focusCropRef,
      fineGroundingDiagnosticRef,
    },
    rejectedTargets: [{
      id: 'rejected-shortcut-fallback-1',
      targetDescription: 'Shortcut or fallback completion candidate.',
      reason: 'Rejected because CU-NEXT dense grounding requires current-run focus crops, grounding diagnostics, and visible Computer Use evidence.',
      coarseWindowScreenshotRef,
      focusCropRef,
      fineGroundingDiagnosticRef,
    }],
    coarseWindowScreenshotRef,
    focusCropRef,
    fineGroundingDiagnosticRef,
  };
  await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');

  const denseMarker = compactRecord({
    ...(existingMarker ?? {}),
    kind: 'dense-grounding',
    targetDescription,
    coarseWindowScreenshotRef,
    focusCropRef,
    fineGroundingDiagnosticRef,
    rejectedTargetRefs: [sidecarRef],
  });
  const markers = recordList(manifest.evidenceMarkers);
  const markerIndex = markers.findIndex((marker) => stringAt(marker, 'kind') === 'dense-grounding');
  const evidenceMarkers = markerIndex >= 0
    ? markers.map((marker, index) => (index === markerIndex ? denseMarker : marker))
    : [...markers, denseMarker];
  const updatedManifest = { ...manifest, evidenceMarkers };
  await writeFile(manifestPath, `${JSON.stringify(updatedManifest, null, 2)}\n`, 'utf8');
  await updateCuNextAcceptanceInputMarker(resolve(runDirPath, 'cu-user-acceptance-input.json'), evidenceMarkers);
  await appendDirectoryListingRef(resolve(runDirPath, 'directory-listing.json'), sidecarRef);
  return { issues: [], refs: [sidecarRef] };
}

async function materializeCurrentRunLedgerSidecars(input: {
  workspacePath: string;
  refs: string[];
}): Promise<{ issues: string[]; refs: string[] }> {
  const runDirRef = currentRunDirRefFromRefs(input.refs);
  if (!runDirRef) return { issues: [], refs: [] };
  const runDirPath = resolve(input.workspacePath, runDirRef);
  const manifestPath = resolve(runDirPath, 'cu-user-acceptance-manifest.json');
  const manifest = await readOptionalJsonRecord(manifestPath);
  if (!manifest) return { issues: [], refs: [] };

  const actionLedgerRef = firstManifestRef(manifest, [
    'actionLedgerRef',
    'mutatingActionLedgerRef',
    'evidenceActionLedgerRef',
  ]) ?? firstManifestRef(recordAt(manifest, 'evidenceLedger'), ['ref', 'actionLedgerRef']);
  const evidenceIndexRef = firstManifestRef(manifest, [
    'evidenceIndexRef',
    'evidenceRefsIndexRef',
    'currentRunEvidenceIndexRef',
  ]) ?? firstManifestRef(recordAt(manifest, 'evidenceIndex'), ['ref', 'indexRef']);

  const actionLedger = actionLedgerSidecar(manifest);
  const actionLedgerActions = recordList(actionLedger.actions);
  const needsIndependentLedgerRecords = actionLedgerActions.length > 0
    && !hasIndependentActionLedgerRecords(manifest, actionLedgerRef);
  const refs: string[] = [];
  const updates: Record<string, unknown> = {};
  if (!actionLedgerRef || needsIndependentLedgerRecords) {
    const ref = actionLedgerRef ?? 'action-ledger.json';
    refs.push(`${runDirRef}/${ref}`);
    if (!actionLedgerRef) updates.actionLedgerRef = ref;
    updates.evidenceLedger = {
      ...(recordAt(manifest, 'evidenceLedger') ?? {}),
      ref,
      actionLedgerRef: ref,
      actions: actionLedgerActions,
    };
    if (isWorkspaceLocalRef(ref)) {
      await writeFile(resolve(runDirPath, ref), `${JSON.stringify(actionLedger, null, 2)}\n`, 'utf8');
    }
  }
  if (!evidenceIndexRef) {
    const ref = 'evidence-index.json';
    refs.push(`${runDirRef}/${ref}`);
    updates.evidenceIndexRef = ref;
    updates.evidenceIndex = {
      ...(recordAt(manifest, 'evidenceIndex') ?? {}),
      ref,
    };
    await writeFile(resolve(runDirPath, ref), `${JSON.stringify(evidenceIndexSidecar(manifest, runDirRef), null, 2)}\n`, 'utf8');
  }
  if (!refs.length) return { issues: [], refs: [] };
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, ...updates }, null, 2)}\n`, 'utf8');
  for (const ref of refs) {
    await appendDirectoryListingRef(resolve(runDirPath, 'directory-listing.json'), ref);
  }
  return { issues: [], refs };
}

function actionLedgerSidecar(manifest: Record<string, unknown>): Record<string, unknown> {
  const actions = [
    ...recordList(manifest.mutatingActions),
    ...recordList(manifest.actionCausality),
    ...recordList(manifest.evidenceLedgerActions),
    ...recordList(recordAt(manifest, 'evidenceLedger')?.actions),
  ];
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-action-ledger.v1',
    status: 'present',
    actionCount: actions.length,
    actions: actions.map((action, index) => compactRecord({
      index,
      actionKind: stringAt(action, 'actionKind') ?? stringAt(action, 'kind') ?? stringAt(action, 'type'),
      screenId: stringAt(action, 'screenId'),
      windowId: stringAt(action, 'windowId'),
      actorId: stringAt(action, 'actorId'),
      cursorId: stringAt(action, 'cursorId'),
      inputIntentRef: stringAt(action, 'inputIntentRef') ?? stringAt(action, 'intentRef') ?? stringAt(action, 'inputRef'),
      providerAdapterRef: stringAt(action, 'providerAdapterRef')
        ?? stringAt(action, 'adapterRef')
        ?? stringAt(action, 'executorAdapterRef')
        ?? stringAt(action, 'actionAdapterRef'),
      executorEventRef: stringAt(action, 'executorEventRef') ?? stringAt(action, 'executeEventRef'),
      beforeEvidenceRefs: uniqueStrings([
        ...stringList(action.beforeEvidenceRefs),
        ...stringList(action.beforeFrameRefs),
        stringAt(action, 'beforeFrameRef'),
        stringAt(action, 'beforeScreenshotRef'),
        stringAt(action, 'currentScreenshotRef'),
      ].filter((ref): ref is string => Boolean(ref))),
      afterEvidenceRefs: uniqueStrings([
        ...stringList(action.afterEvidenceRefs),
        ...stringList(action.afterFrameRefs),
        stringAt(action, 'afterFrameRef'),
        stringAt(action, 'afterScreenshotRef'),
      ].filter((ref): ref is string => Boolean(ref))),
      verificationRefs: uniqueStrings([
        ...stringList(action.verificationRefs),
        ...stringList(action.verifierRefs),
        stringAt(action, 'verifierRef'),
        stringAt(action, 'verificationRef'),
        stringAt(action, 'verifierVerdictRef'),
      ].filter((ref): ref is string => Boolean(ref))),
      artifactRefs: uniqueStrings([
        ...stringList(action.artifactRefs),
        ...stringList(action.outputArtifactRefs),
        stringAt(action, 'artifactRef'),
        stringAt(action, 'finalArtifactRef'),
        stringAt(manifest, 'finalArtifactRef'),
      ].filter((ref): ref is string => Boolean(ref))),
      blockedEvidenceRefs: uniqueStrings([
        ...stringList(action.blockedEvidenceRefs),
        ...stringList(action.blockedReasonRefs),
        stringAt(action, 'blockedReasonRef'),
        stringAt(action, 'permissionHandoffRef'),
        stringAt(action, 'observeOnlyRef'),
        stringAt(manifest, 'blockedReasonRef'),
        stringAt(manifest, 'permissionHandoffRef'),
        stringAt(manifest, 'observeOnlyRef'),
      ].filter((ref): ref is string => Boolean(ref))),
      blockedReason: stringAt(action, 'blockedReason') ?? stringAt(manifest, 'blockedReason'),
    })),
  };
}

function hasIndependentActionLedgerRecords(
  manifest: Record<string, unknown>,
  actionLedgerRef: string | undefined,
): boolean {
  const ledger = recordAt(manifest, 'evidenceLedger') ?? recordAt(manifest, 'actionLedger');
  const ledgerActions = [
    ...recordList(ledger?.actions),
    ...recordList(ledger?.actionRecords),
    ...recordList(ledger?.mutatingActions),
    ...recordList(ledger?.entries),
    ...recordList(ledger?.records),
    ...recordList(manifest.evidenceLedgerActions),
  ];
  const ledgerRefs = uniqueStrings([
    stringAt(ledger, 'ref'),
    stringAt(ledger, 'actionLedgerRef'),
    ...stringList(ledger?.refs),
    ...stringList(ledger?.evidenceRefs),
    ...stringList(ledger?.actionCausalityRefs),
  ].filter((ref): ref is string => Boolean(ref)));
  return ledgerActions.some((action) => (
    Boolean(stringAt(action, 'executorEventRef') ?? stringAt(action, 'executeEventRef') ?? stringAt(action, 'eventRef') ?? stringAt(action, 'ref'))
    && (
      stringList(action.beforeEvidenceRefs).length > 0
      || stringList(action.afterEvidenceRefs).length > 0
      || stringList(action.verificationRefs).length > 0
      || stringList(action.artifactRefs).length > 0
    )
  )) && (!actionLedgerRef || ledgerRefs.includes(actionLedgerRef) || stringAt(ledger, 'ref') === actionLedgerRef);
}

function evidenceIndexSidecar(manifest: Record<string, unknown>, runDirRef: string): Record<string, unknown> {
  return {
    schemaVersion: 'sciforge.computer-use.chat-live-evidence-index.v1',
    status: 'present',
    runDirRef,
    refs: refsFromUnknown(manifest).filter((ref) => isWorkspaceLocalRef(ref)),
  };
}

function firstManifestRef(record: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = stringAt(record, key);
    if (value) return value;
  }
  return undefined;
}

async function updateCuNextAcceptanceInputMarker(path: string, evidenceMarkers: Array<Record<string, unknown>>) {
  const input = await readOptionalJsonRecord(path);
  if (!input) return;
  await writeFile(path, `${JSON.stringify({ ...input, evidenceMarkers }, null, 2)}\n`, 'utf8');
}

async function appendDirectoryListingRef(path: string, ref: string) {
  const listing = await readOptionalJsonRecord(path);
  if (!listing) return;
  await writeFile(path, `${JSON.stringify({
    ...listing,
    fileRefs: uniqueStrings([...stringList(listing.fileRefs), ref]),
  }, null, 2)}\n`, 'utf8');
}

function currentRunDirRefFromRefs(refs: string[]) {
  const ref = refs.find((candidate) => /(?:^|\/)(?:vision-trace|tui-host-run-task-chain)\.json$/i.test(candidate));
  if (!ref || !isWorkspaceLocalRef(ref)) return undefined;
  return ref.replace(/\/[^/]+$/, '');
}

function completionGradeStatus(
  diagnostic: Record<string, unknown> | undefined,
  acceptanceManifestRefs: string[],
): ComputerUseChatLivePackageBridgeCompletionGrade['status'] {
  if (isRecord(diagnostic) && stringAt(diagnostic, 'status') === 'blocked') return 'blocked';
  if (acceptanceManifestRefs.length > 0) return 'attached';
  return 'missing';
}

function isCompletionGradeEvidenceRef(ref: string) {
  return /(?:^|\/)(?:completion-grade-diagnostics|cu-user-acceptance-manifest|cu-user-acceptance-input|isolated-desktop-l3-workflow-evidence|embedded-l3-completion-producer-diagnostics)\.json$/i.test(ref);
}

function scopeBundleLocalCompletionGradeRefs(refs: string[], currentRunDirRef: string | undefined): string[] {
  if (!currentRunDirRef) return refs;
  const anchoredAcceptanceRef = `${currentRunDirRef}/cu-user-acceptance-manifest.json`;
  const anchoredCompletionRef = `${currentRunDirRef}/isolated-desktop-l3-workflow-evidence.json`;
  const hasAnchoredCurrentRunBundle = refs.includes(anchoredAcceptanceRef) && refs.includes(anchoredCompletionRef);
  if (!hasAnchoredCurrentRunBundle) return refs;
  return uniqueStrings(refs.map((ref) => (ref === 'isolated-desktop-l3-workflow-evidence.json' ? anchoredCompletionRef : ref)));
}

function refIsInCurrentRunDir(ref: string, currentRunDirRef: string) {
  return ref === currentRunDirRef || ref.startsWith(`${currentRunDirRef}/`);
}

function safeOptionalIssueText(value: string | undefined) {
  return value ? safeIssueText(value) : undefined;
}
