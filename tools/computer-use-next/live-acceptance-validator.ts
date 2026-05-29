import {
  CU_NEXT_TASK_MAPPINGS,
  type CuNextTaskId,
  type CuNextTaskMapping,
} from './task-map.js';
import {
  approvalChainSidecarRefsFromMarker,
  highRiskActionFromApprovalChainSidecars,
  isSessionDerivedApprovalRef,
  validateCuNextApprovalChainSidecars,
  validateCuNextNeedsConfirmationSidecars,
} from './approval-chain.js';

export type CuNextLiveAcceptanceMarkerKind =
  | 'briefing-deck'
  | 'chart-report'
  | 'needs-confirmation'
  | 'file-index'
  | 'repair-continuity'
  | 'approval-ref'
  | 'dense-grounding';

export interface CuNextLiveAcceptanceTaskRule {
  taskId: CuNextTaskId;
  markerKind: CuNextLiveAcceptanceMarkerKind;
  label: string;
}

export interface CuNextLiveAcceptanceValidationInput {
  taskId: CuNextTaskId;
  evidence: unknown;
  taskMappings?: readonly CuNextTaskMapping[];
  refRecords?: Record<string, unknown>;
}

export interface CuNextLiveAcceptanceIssue {
  id: string;
  reason: string;
  path?: string;
}

export interface CuNextLiveAcceptanceValidation {
  ok: boolean;
  taskId: CuNextTaskId;
  scenarioIds: string[];
  markerKind?: CuNextLiveAcceptanceMarkerKind;
  markerFound: boolean;
  issues: CuNextLiveAcceptanceIssue[];
  checks: {
    exactTaskId: boolean;
    scenarioMapped: boolean;
    requiredRefs: boolean;
    disqualifiersClean: boolean;
    taskMarker: boolean;
  };
}

interface MarkerCandidate {
  path: string;
  record: Record<string, unknown>;
}

export const CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES: readonly CuNextLiveAcceptanceTaskRule[] = [
  { taskId: 'CU-NEXT-01', markerKind: 'briefing-deck', label: 'briefing deck' },
  { taskId: 'CU-NEXT-02', markerKind: 'chart-report', label: 'chart report' },
  { taskId: 'CU-NEXT-03', markerKind: 'needs-confirmation', label: 'needs-confirmation' },
  { taskId: 'CU-NEXT-04', markerKind: 'file-index', label: 'file index' },
  { taskId: 'CU-NEXT-05', markerKind: 'repair-continuity', label: 'repair continuity' },
  { taskId: 'CU-NEXT-06', markerKind: 'approval-ref', label: 'approvalRef' },
  { taskId: 'CU-NEXT-07', markerKind: 'dense-grounding', label: 'dense grounding' },
] as const;

const taskRulesById = new Map(CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES.map((rule) => [rule.taskId, rule]));
const shortcutClaimKinds = new Set(['dom', 'playwright', 'accessibility', 'generated-file-only']);
const markerAliases: Record<CuNextLiveAcceptanceMarkerKind, readonly string[]> = {
  'briefing-deck': ['briefing-deck', 'briefingdeck', 'deck-briefing', 'literature-briefing-deck'],
  'chart-report': ['chart-report', 'chartreport', 'spreadsheet-chart-report'],
  'needs-confirmation': ['needs-confirmation', 'needsconfirmation', 'confirmation-required', 'approval-request'],
  'file-index': ['file-index', 'fileindex', 'directory-index', 'workspace-file-index'],
  'repair-continuity': ['repair-continuity', 'repaircontinuity', 'continuation-repair'],
  'approval-ref': ['approval-ref', 'approvalref', 'human-approval-ref'],
  'dense-grounding': ['dense-grounding', 'densegrounding', 'visual-grounding-pressure-test'],
};

export function validateCuNextLiveAcceptanceTaskEvidence(
  input: CuNextLiveAcceptanceValidationInput,
): CuNextLiveAcceptanceValidation {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const taskMappings = input.taskMappings ?? CU_NEXT_TASK_MAPPINGS;
  const mapping = taskMappings.find((candidate) => candidate.taskId === input.taskId);
  const rule = taskRulesById.get(input.taskId);
  const evidence = asRecord(input.evidence);

  if (!mapping) {
    issues.push({
      id: 'unknown-cu-next-task',
      reason: `${input.taskId} is not present in the CU-NEXT task map.`,
    });
  }
  if (!rule) {
    issues.push({
      id: 'missing-task-semantic-rule',
      reason: `${input.taskId} does not have a CU-NEXT live acceptance semantic rule.`,
    });
  }
  if (!evidence) {
    issues.push({
      id: 'evidence-not-object',
      reason: 'Live acceptance evidence must be a structured object.',
    });
    return validationResult(input.taskId, [], rule, false, issues);
  }

  const exactTaskIdIssues = validateExactTaskId(evidence, input.taskId);
  issues.push(...exactTaskIdIssues);

  const scenarioIds = collectScenarioIds(evidence);
  if (mapping) {
    issues.push(...validateScenarioMapping(evidence, scenarioIds, mapping));
    issues.push(...validateRequiredRefs(evidence, mapping));
  }
  issues.push(...validateLiveDisqualifiers(evidence));

  const markerValidation = rule
    ? validateTaskMarker(evidence, rule, input.refRecords)
    : { markerFound: false, issues: [] };
  issues.push(...markerValidation.issues);

  return validationResult(input.taskId, scenarioIds, rule, markerValidation.markerFound, issues);
}

export function validateCuNextLiveAcceptanceMatrix(
  inputs: readonly CuNextLiveAcceptanceValidationInput[],
): CuNextLiveAcceptanceValidation[] {
  return inputs.map((input) => validateCuNextLiveAcceptanceTaskEvidence(input));
}

export function getCuNextLiveAcceptanceTaskRule(
  taskId: CuNextTaskId,
): CuNextLiveAcceptanceTaskRule | undefined {
  return taskRulesById.get(taskId);
}

function validationResult(
  taskId: CuNextTaskId,
  scenarioIds: string[],
  rule: CuNextLiveAcceptanceTaskRule | undefined,
  markerFound: boolean,
  issues: CuNextLiveAcceptanceIssue[],
): CuNextLiveAcceptanceValidation {
  const exactTaskId = !issues.some((issue) => issue.id === 'task-id-mismatch');
  const scenarioMapped = !issues.some((issue) => (
    issue.id === 'missing-scenario-id'
    || issue.id === 'scenario-not-mapped'
    || issue.id === 'primary-scenario-mismatch'
    || issue.id === 'long-scenario-map-mismatch'
  ));
  const requiredRefs = !issues.some((issue) => (
    issue.id === 'missing-required-ref'
    || issue.id === 'missing-required-evidence-claim'
    || issue.id === 'invalid-live-acceptance-status'
  ));
  const disqualifiersClean = !issues.some((issue) => issue.id.startsWith('forbidden-'));
  const taskMarker = markerFound && !issues.some((issue) => (
    issue.id === 'missing-task-marker'
    || issue.id === 'invalid-task-marker'
  ));

  return {
    ok: issues.length === 0,
    taskId,
    scenarioIds,
    markerKind: rule?.markerKind,
    markerFound,
    issues: uniqueIssues(issues),
    checks: {
      exactTaskId,
      scenarioMapped,
      requiredRefs,
      disqualifiersClean,
      taskMarker,
    },
  };
}

function validateExactTaskId(
  evidence: Record<string, unknown>,
  expectedTaskId: CuNextTaskId,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const taskId = stringValue(evidence.taskId);
  if (taskId !== expectedTaskId) {
    issues.push({
      id: 'task-id-mismatch',
      path: 'taskId',
      reason: `Expected structured taskId ${expectedTaskId}; got ${taskId ?? '(missing)'}. Text mentions do not count as a task binding.`,
    });
  }
  const cuNextTaskId = stringValue(evidence.cuNextTaskId);
  if (cuNextTaskId !== undefined && cuNextTaskId !== expectedTaskId) {
    issues.push({
      id: 'task-id-mismatch',
      path: 'cuNextTaskId',
      reason: `Expected structured cuNextTaskId ${expectedTaskId}; got ${cuNextTaskId}.`,
    });
  }
  const nestedTask = asRecord(evidence.cuNextTask);
  const nestedTaskId = stringValue(nestedTask?.taskId);
  if (nestedTaskId !== undefined && nestedTaskId !== expectedTaskId) {
    issues.push({
      id: 'task-id-mismatch',
      path: 'cuNextTask.taskId',
      reason: `Expected nested cuNextTask.taskId ${expectedTaskId}; got ${nestedTaskId}.`,
    });
  }
  return issues;
}

function validateScenarioMapping(
  evidence: Record<string, unknown>,
  scenarioIds: string[],
  mapping: CuNextTaskMapping,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  if (scenarioIds.length === 0) {
    issues.push({
      id: 'missing-scenario-id',
      reason: `${mapping.taskId} evidence must include a structured CU-LONG scenarioId from its task map.`,
    });
    return issues;
  }
  const mapped = new Set(mapping.longScenarioIds);
  const unmapped = scenarioIds.filter((scenarioId) => !mapped.has(scenarioId));
  if (unmapped.length > 0) {
    issues.push({
      id: 'scenario-not-mapped',
      reason: `${mapping.taskId} evidence includes unmapped scenario id(s): ${unmapped.join(', ')}. Expected one of ${mapping.longScenarioIds.join(', ')}.`,
    });
  }
  const nestedTask = asRecord(evidence.cuNextTask);
  const nestedPrimaryScenarioId = stringValue(nestedTask?.primaryScenarioId);
  if (nestedPrimaryScenarioId !== undefined && nestedPrimaryScenarioId !== mapping.primaryScenarioId) {
    issues.push({
      id: 'primary-scenario-mismatch',
      path: 'cuNextTask.primaryScenarioId',
      reason: `Expected primaryScenarioId ${mapping.primaryScenarioId}; got ${nestedPrimaryScenarioId}.`,
    });
  }
  const nestedLongScenarioIds = stringArray(nestedTask?.longScenarioIds);
  if (nestedLongScenarioIds.length > 0 && !sameStringSet(nestedLongScenarioIds, mapping.longScenarioIds)) {
    issues.push({
      id: 'long-scenario-map-mismatch',
      path: 'cuNextTask.longScenarioIds',
      reason: `Expected longScenarioIds ${mapping.longScenarioIds.join(', ')}; got ${nestedLongScenarioIds.join(', ')}.`,
    });
  }
  return issues;
}

function validateRequiredRefs(
  evidence: Record<string, unknown>,
  mapping: CuNextTaskMapping,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const appWorkflow = asRecord(evidence.appWorkflow);
  const screenshotRefs = asRecord(evidence.screenshotRefs);
  const executorLease = asRecord(evidence.executorLease);
  const verifierVerdict = asRecord(evidence.verifierVerdict);
  const guiPresent = asRecord(evidence.guiPresent);
  const tuiHostChain = records(evidence.tuiHostChain);
  const evidenceClaims = records(evidence.evidenceClaims);
  const requiresL3 = mapping.requirements.includes('l3-workflow-refs');

  if (requiresL3) {
    const hasRequiredL3Shape = evidence.level === 'L3' && appWorkflow?.kind === 'multi-app-workflow';
    const hasRequiredStatus = mapping.taskId === 'CU-NEXT-03'
      ? evidence.status === 'needs-confirmation'
      : evidence.status === 'multi-app-workflow-passed';
    if (!hasRequiredStatus || !hasRequiredL3Shape) {
      issues.push({
        id: 'invalid-live-acceptance-status',
        reason: mapping.taskId === 'CU-NEXT-03'
          ? `${mapping.taskId} requires L3 live acceptance evidence stopped at top-level status=needs-confirmation.`
          : `${mapping.taskId} requires L3 multi-app-workflow-passed live acceptance evidence.`,
      });
    }
    requireRefs(issues, 'appWorkflow.windowSwitchTraceRefs', stringArray(appWorkflow?.windowSwitchTraceRefs));
  } else if (
    evidence.status !== 'single-app-artifact-passed'
    && evidence.status !== 'multi-app-workflow-passed'
  ) {
    issues.push({
      id: 'invalid-live-acceptance-status',
      reason: `${mapping.taskId} requires a passed live acceptance status.`,
    });
  }

  requireRefs(issues, 'screenshotRefs.before', stringArray(screenshotRefs?.before));
  requireRefs(issues, 'screenshotRefs.after', stringArray(screenshotRefs?.after));
  requireRefs(issues, 'focusCropRefs', stringArray(evidence.focusCropRefs));
  requireRefs(issues, 'groundingDiagnosticsRefs', stringArray(evidence.groundingDiagnosticsRefs));
  requireRef(issues, 'executorLease.ref', stringValue(executorLease?.ref));
  if (executorLease?.status !== 'present') {
    issues.push({
      id: 'missing-required-ref',
      path: 'executorLease.status',
      reason: 'executorLease.status must be present.',
    });
  }
  requireRef(issues, 'finalArtifactRef', stringValue(evidence.finalArtifactRef));
  requireRef(issues, 'finalVisibleScreenshotRef', stringValue(evidence.finalVisibleScreenshotRef));
  requireRef(issues, 'verifierVerdict.ref', stringValue(verifierVerdict?.ref));
  if (verifierVerdict?.status !== 'passed') {
    issues.push({
      id: 'missing-required-ref',
      path: 'verifierVerdict.status',
      reason: 'verifierVerdict.status must be passed.',
    });
  }
  requireRef(issues, 'guiPresent.recordRef', stringValue(guiPresent?.recordRef));
  requireRef(issues, 'guiPresent.payloadRef', stringValue(guiPresent?.payloadRef));
  const guiPresentDisplayedRefs = stringArray(guiPresent?.displayedRefs);
  const finalArtifactRef = stringValue(evidence.finalArtifactRef);
  requireRefs(issues, 'guiPresent.displayedRefs', guiPresentDisplayedRefs);
  if (finalArtifactRef && guiPresentDisplayedRefs.length > 0 && !guiPresentDisplayedRefs.includes(finalArtifactRef)) {
    issues.push({
      id: 'missing-required-ref',
      path: 'guiPresent.displayedRefs',
      reason: 'guiPresent.displayedRefs must include the same finalArtifactRef shown to the user.',
    });
  }
  if (guiPresent?.status !== 'present') {
    issues.push({
      id: 'missing-required-ref',
      path: 'guiPresent.status',
      reason: 'guiPresent.status must be present.',
    });
  }

  const chatOriginLink = tuiHostChain.find((link) => (
    link.kind === 'sciForge-chat-origin'
    && link.status === 'present'
  ));
  if (!chatOriginLink) {
    issues.push({
      id: 'missing-required-ref',
      path: 'tuiHostChain',
      reason: 'tuiHostChain must include present SciForge chat-origin proof.',
    });
  } else {
    requireRef(issues, 'tuiHostChain[sciForge-chat-origin].requestRef', stringValue(chatOriginLink.requestRef));
    if (!isSciForgeChatOrigin(chatOriginLink.origin)) {
      issues.push({
        id: 'missing-required-ref',
        path: 'tuiHostChain[sciForge-chat-origin].origin',
        reason: 'SciForge chat-origin proof must carry ui-chat/sciforge-chat origin metadata with terminalEquivalentText=true.',
      });
    }
  }

  const runTaskLink = tuiHostChain.find((link) => link.kind === 'tui-host-runTask' && link.status === 'present');
  if (!runTaskLink) {
    issues.push({
      id: 'missing-required-ref',
      path: 'tuiHostChain',
      reason: 'tuiHostChain must include a present tui-host-runTask link.',
    });
  } else {
    requireRef(issues, 'tuiHostChain[tui-host-runTask].requestRef', stringValue(runTaskLink.requestRef));
    requireRef(issues, 'tuiHostChain[tui-host-runTask].hostPortsRef', stringValue(runTaskLink.hostPortsRef));
  }

  const providerLink = tuiHostChain.find((link) => (
    link.kind === 'computer-use-action-provider'
    && link.status === 'present'
  ));
  if (!providerLink) {
    issues.push({
      id: 'missing-required-ref',
      path: 'tuiHostChain',
      reason: 'tuiHostChain must include a present computer-use-action-provider link.',
    });
  } else {
    requireRef(issues, 'tuiHostChain[computer-use-action-provider].toolPayloadRef', stringValue(providerLink.toolPayloadRef));
  }

  const guiPresentLink = tuiHostChain.find((link) => link.kind === 'gui.present' && link.status === 'present');
  if (!guiPresentLink) {
    issues.push({
      id: 'missing-required-ref',
      path: 'tuiHostChain',
      reason: 'tuiHostChain must include a present gui.present link.',
    });
  } else {
    requireRef(issues, 'tuiHostChain[gui.present].recordRef', stringValue(guiPresentLink.recordRef));
  }

  if (!hasClaimWithRefs(evidenceClaims, 'real-computer-use')) {
    issues.push({
      id: 'missing-required-evidence-claim',
      path: 'evidenceClaims',
      reason: 'evidenceClaims must include real-computer-use refs.',
    });
  }
  if (requiresL3 && !hasIndependentInputAdapterClaim(evidenceClaims)) {
    issues.push({
      id: 'missing-required-evidence-claim',
      path: 'evidenceClaims',
      reason: 'L3 evidenceClaims must include independent-input-adapter refs and sessionRefs.',
    });
  }
  if (!hasSciForgeChatOriginClaim(evidenceClaims, stringValue(chatOriginLink?.requestRef))) {
    issues.push({
      id: 'missing-required-evidence-claim',
      path: 'evidenceClaims',
      reason: 'evidenceClaims must include SciForge chat-origin refs from the UI chat handoff.',
    });
  }
  if (!hasGuiPresentClaim(evidenceClaims, stringValue(guiPresent?.recordRef), guiPresentDisplayedRefs, finalArtifactRef)) {
    issues.push({
      id: 'missing-required-evidence-claim',
      path: 'evidenceClaims',
      reason: 'evidenceClaims must include a gui-present-record claim for the displayed final artifact.',
    });
  }

  return issues;
}

function validateLiveDisqualifiers(evidence: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  if (findRecordValue(evidence, (key, value) => (
    (key === 'fixture' || key === 'testActionFixtureMode' || key === 'fixtureMode' || key === 'seedDemoFixtureEvidenceUsed')
    && value === true
  )) || findRecordValue(evidence, (key, value) => (
    isModeKey(key)
    && typeof value === 'string'
    && /fixture|demo|synthetic/i.test(value)
  )) || findRecordValue(evidence, (key, value) => (
    isOriginKey(key)
    && typeof value === 'string'
    && /fixture|demo|synthetic/i.test(value)
  ))) {
    issues.push({
      id: 'forbidden-fixture',
      reason: 'Fixture, demo, or synthetic evidence cannot satisfy CU-NEXT live acceptance.',
    });
  }

  if (findRecordValue(evidence, (key, value) => (
    key === 'dryRun'
    && value === true
  )) || findRecordValue(evidence, (key, value) => (
    isModeKey(key)
    && typeof value === 'string'
    && /dry[-_\s]?run/i.test(value)
  ))) {
    issues.push({
      id: 'forbidden-dry-run',
      reason: 'dry-run evidence cannot satisfy CU-NEXT live acceptance.',
    });
  }

  const evidenceClaims = records(evidence.evidenceClaims);
  if (
    evidenceClaims.some((claim) => claim.kind === 'shared-input-ack')
    || findRecordValue(evidence, (key, value) => (
      (key === 'allowSharedSystemInput' || key === 'sharedSystemInputUsed' || key === 'sharedSystemInput')
      && value === true
    ))
    || findRecordValue(evidence, (key, value) => (
      (key === 'owner' || key === 'inputOwnership' || key === 'pointerKeyboardOwnership')
      && typeof value === 'string'
      && /shared-system|shared input|system mouse|system keyboard/i.test(value)
    ))
  ) {
    issues.push({
      id: 'forbidden-shared-input',
      reason: 'Shared system input cannot satisfy isolated CU-NEXT live acceptance.',
    });
  }

  if (findRecordValue(evidence, (key, value) => (
    (key === 'shellDirectArtifactWrite' || key === 'directShellArtifactWrite')
    && value === true
  )) || findRecordValue(evidence, (key, value) => (
    (key === 'artifactWriteMode' || key === 'artifactCausality')
    && typeof value === 'string'
    && /shell[-_\s]?direct/i.test(value)
  ))) {
    issues.push({
      id: 'forbidden-shell-direct-artifact-write',
      reason: 'Shell-direct artifact writes cannot satisfy GUI artifact causality.',
    });
  }

  const rejectedClaims = records(asRecord(evidence.antiShortcutGuard)?.rejectedClaims);
  if (
    asRecord(evidence.antiShortcutGuard)?.status === 'failed'
    || rejectedClaims.length > 0
    || evidence.automationSubstituteUsed === true
    || evidenceClaims.some((claim) => shortcutClaimKinds.has(String(claim.kind ?? '').toLowerCase()))
  ) {
    issues.push({
      id: 'forbidden-shortcut-substitute',
      reason: 'DOM, Playwright, accessibility, generated-file-only, or automation substitute claims cannot satisfy CU-NEXT live acceptance.',
    });
  }

  return issues;
}

function validateTaskMarker(
  evidence: Record<string, unknown>,
  rule: CuNextLiveAcceptanceTaskRule,
  refRecords?: Record<string, unknown>,
): { markerFound: boolean; issues: CuNextLiveAcceptanceIssue[] } {
  const marker = findTaskMarker(evidence, rule.markerKind);
  if (!marker) {
    return {
      markerFound: false,
      issues: [
        {
          id: 'missing-task-marker',
          reason: `${rule.taskId} requires a structured ${rule.label} evidence marker.`,
        },
      ],
    };
  }

  const markerIssues = validateMarkerFields(rule.markerKind, marker.record, evidence, refRecords).map((issue) => ({
    ...issue,
    path: issue.path ? `${marker.path}.${issue.path}` : marker.path,
  }));
  return {
    markerFound: true,
    issues: markerIssues,
  };
}

function validateMarkerFields(
  kind: CuNextLiveAcceptanceMarkerKind,
  marker: Record<string, unknown>,
  evidence: Record<string, unknown>,
  refRecords?: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  switch (kind) {
    case 'briefing-deck':
      return [
        ...requireMarkerRef(marker, evidence, 'briefing deck artifact', ['deckRef', 'artifactRef', 'finalArtifactRef'], 'finalArtifactRef'),
        ...requireMarkerRefs(marker, 'literature/source refs', ['sourceRefs', 'literatureRefs', 'citationRefs', 'inputRefs']),
        ...requireAnyMarkerShape(marker, 'slide outline or slide refs', ['outlineRef', 'slideRefs'], ['slideCount']),
      ];
    case 'chart-report':
      return [
        ...requireMarkerRef(marker, evidence, 'chart report artifact', ['reportRef', 'artifactRef', 'finalArtifactRef'], 'finalArtifactRef'),
        ...requireMarkerRefs(marker, 'spreadsheet/table source refs', ['dataRefs', 'tableRefs', 'spreadsheetRefs', 'sourceRefs']),
        ...requireMarkerRefs(marker, 'chart or figure refs', ['chartRefs', 'plotRefs', 'figureRefs', 'imageRefs']),
      ];
    case 'needs-confirmation':
      return [
        ...requireNeedsConfirmationStatus(marker),
        ...requireMarkerRefs(marker, 'approval request refs', ['approvalRequestRef', 'approvalRequestRefs']),
        ...requireMarkerRefs(marker, 'gui.ask_user refs', ['guiAskUserRef', 'guiAskUserRecordRef', 'guiAskUserRefs']),
        ...requireMarkerRefs(marker, 'risk audit refs', ['riskAuditRef', 'riskAuditRefs']),
        ...requireMarkerValue(marker, 'high-risk action', ['highRiskAction', 'actionKind', 'sideEffectClass']),
        ...rejectMarkerRefs(marker, 'confirmed request refs', ['confirmedRequestRef', 'confirmedRequestRefs', 'confirmedRequest', 'confirmedRequestSidecar']),
        ...requireDeniedExecutionFalse(marker),
        ...requireNeedsConfirmationSidecars(marker, refRecords),
      ];
    case 'file-index':
      return [
        ...requireMarkerRefs(marker, 'file index ref', ['indexRef', 'fileIndexRef', 'artifactRef']),
        ...requireMarkerRefs(marker, 'directory/file listing refs', ['directoryListingRefs', 'fileRefs', 'organizedFileRefs', 'movedFileRefs']),
        ...requireMarkerRefs(marker, 'file preview refs', ['previewRef', 'previewRefs', 'finalVisibleScreenshotRef']),
      ];
    case 'repair-continuity':
      return [
        ...requireMarkerRefs(marker, 'blocked manifest ref', ['blockedManifestRef', 'blockedRunRef']),
        ...requireMarkerRefs(marker, 'repair hint ref', ['repairHintRef', 'repairInstructionRef']),
        ...requireMarkerRefs(marker, 'continuation request ref', ['continuationRequestRef', 'resumeRequestRef']),
        ...requireRepairSessionContinuity(marker, evidence),
      ];
    case 'approval-ref':
      return [
        ...requireApprovalRef(marker),
        ...requireMarkerRefs(marker, 'approval request refs', ['approvalRequestRef', 'approvalRequestRefs']),
        ...requireMarkerRefs(marker, 'gui.ask_user refs', ['guiAskUserRef', 'guiAskUserRecordRef', 'guiAskUserRefs']),
        ...requireMarkerRefs(marker, 'confirmed request refs', ['confirmedRequestRef', 'confirmedRequestRefs']),
        ...requireMarkerRefs(marker, 'risk audit refs', ['riskAuditRef', 'riskAuditRefs']),
        ...requireMarkerRefs(marker, 'source approval request refs', ['sourceApprovalRequestRef', 'sourceApprovalRequestRefs']),
        ...requireMarkerRefs(marker, 'source gui.ask_user refs', ['sourceGuiAskUserRef', 'sourceGuiAskUserRecordRef', 'sourceGuiAskUserRefs']),
        ...requireMarkerRefs(marker, 'source risk audit refs', ['sourceRiskAuditRef', 'sourceRiskAuditRefs']),
        ...requireMarkerRefs(marker, 'approval decision refs', ['approvalDecisionRef', 'approvalDecisionRefs']),
        ...requireDeniedExecutionFalse(marker),
        ...requireApprovalChainSidecars(marker, refRecords),
      ];
    case 'dense-grounding':
      return [
        ...requireMarkerValue(marker, 'target description', ['targetDescription', 'targetLabel']),
        ...requireMarkerRefs(marker, 'coarse window screenshot ref', ['coarseWindowScreenshotRef', 'coarseScreenshotRef', 'windowScreenshotRef']),
        ...requireMarkerRef(marker, evidence, 'focus crop ref', ['focusCropRef', 'focusCropRefs'], 'focusCropRefs'),
        ...requireMarkerRef(marker, evidence, 'fine grounding diagnostic ref', ['fineGroundingDiagnosticRef', 'groundingDiagnosticRef', 'groundingDiagnosticsRefs'], 'groundingDiagnosticsRefs'),
        ...requireMarkerRefs(marker, 'rejected or excluded target refs', ['rejectedTargetRefs', 'excludedTargetRefs', 'negativeTargetRefs']),
        ...requireDenseGroundingRejectionEvidence(marker, refRecords),
      ];
  }
}

function requireNeedsConfirmationStatus(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const status = stringValue(marker.status) ?? stringValue(marker.initialStatus) ?? stringValue(marker.resultStatus);
  if (status === 'needs-confirmation' || marker.needsConfirmation === true) return [];
  return [{
    id: 'invalid-task-marker',
    path: 'status',
    reason: 'needs-confirmation marker must carry status=needs-confirmation or needsConfirmation=true.',
  }];
}

function rejectMarkerRefs(
  marker: Record<string, unknown>,
  label: string,
  keys: string[],
): CuNextLiveAcceptanceIssue[] {
  const entries = markerRefEntriesFromKeys(marker, keys);
  if (entries.length === 0) return [];
  return [{
    id: 'invalid-task-marker',
    path: keys[0],
    reason: `needs-confirmation marker must not include ${label}.`,
  }];
}

function requireDeniedExecutionFalse(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  if (marker.deniedExecuted === undefined || marker.deniedExecuted === false) return [];
  return [{
    id: 'invalid-task-marker',
    path: 'deniedExecuted',
    reason: 'Denied high-risk actions must be recorded as not executed.',
  }];
}

function requireRepairSessionContinuity(
  marker: Record<string, unknown>,
  evidence: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const sessionRef = firstString(marker, ['traceSessionRef', 'sessionRef', 'continuationSessionRef']);
  if (!sessionRef) {
    return [{
      id: 'invalid-task-marker',
      path: 'traceSessionRef',
      reason: 'repair continuity marker must include traceSessionRef or sessionRef.',
    }];
  }
  if (!isEvidenceBundleLocalFileRef(sessionRef)) {
    return [{
      id: 'invalid-task-marker',
      path: 'traceSessionRef',
      reason: `repair continuity traceSessionRef must use an evidence-bundle-local file ref; got ${describeMarkerRef(sessionRef)}.`,
    }];
  }
  const evidenceSessionRefs = collectSessionRefs(evidence);
  if (!evidenceSessionRefs.includes(sessionRef)) {
    return [{
      id: 'invalid-task-marker',
      path: 'traceSessionRef',
      reason: `repair continuity session ${sessionRef} must also appear in evidence sessionRefs.`,
    }];
  }
  return [];
}

function requireApprovalRef(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const approvalRef = stringValue(marker.approvalRef);
  if (!isApprovalRefToken(approvalRef)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'approvalRef',
      reason: 'approvalRef marker must include canonical approvalRef with a non-empty approval: token.',
    });
  } else if (isSessionDerivedApprovalRef(approvalRef)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'approvalRef',
      reason: 'approvalRef marker must come from confirmed-request sidecar content, not a session, trace, or request-derived token.',
    });
  }
  issues.push(...invalidMarkerRefIssues(
    markerRefEntriesFromKeys(marker, ['humanApprovalRef', 'confirmedApprovalRef']),
    'approval alias refs',
    { allowApproval: true },
  ));
  return issues;
}

function requireNeedsConfirmationSidecars(
  marker: Record<string, unknown>,
  refRecords: Record<string, unknown> | undefined,
): CuNextLiveAcceptanceIssue[] {
  const refs = approvalChainSidecarRefsFromMarker(marker);
  const sidecars = {
    approvalRequest: marker.approvalRequestSidecar ?? marker.approvalRequest ?? recordForRef(refRecords, refs.approvalRequestRef),
    guiAskUser: marker.guiAskUserSidecar ?? marker.guiAskUserRecord ?? marker.guiAskUser ?? recordForRef(refRecords, refs.guiAskUserRecordRef),
    confirmedRequest: marker.confirmedRequestSidecar ?? marker.confirmedRequest ?? recordForRef(refRecords, refs.confirmedRequestRef),
    riskAudit: marker.riskAuditSidecar ?? marker.riskAudit ?? recordForRef(refRecords, refs.riskAuditRef),
  };
  const issues = validateCuNextNeedsConfirmationSidecars({
    sidecars,
    marker,
    refs,
  }).map((issue) => ({
    id: 'invalid-task-marker',
    path: issue.path,
    reason: issue.reason,
  }));
  const markerAction = firstString(marker, ['highRiskAction', 'actionKind', 'sideEffectClass']);
  const sidecarAction = highRiskActionFromApprovalChainSidecars(sidecars, 'needs-confirmation');
  if (markerAction && !highRiskActionMatches(markerAction, sidecarAction)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'highRiskAction',
      reason: 'needs-confirmation highRiskAction must match the action derived from approval sidecar evidence.',
    });
  }
  return issues;
}

function requireApprovalChainSidecars(
  marker: Record<string, unknown>,
  refRecords: Record<string, unknown> | undefined,
): CuNextLiveAcceptanceIssue[] {
  const refs = approvalChainSidecarRefsFromMarker(marker);
  const sidecars = {
    approvalRequest: marker.approvalRequestSidecar ?? marker.approvalRequest ?? recordForRef(refRecords, refs.approvalRequestRef),
    guiAskUser: marker.guiAskUserSidecar ?? marker.guiAskUserRecord ?? marker.guiAskUser ?? recordForRef(refRecords, refs.guiAskUserRecordRef),
    confirmedRequest: marker.confirmedRequestSidecar ?? marker.confirmedRequest ?? recordForRef(refRecords, refs.confirmedRequestRef),
    riskAudit: marker.riskAuditSidecar ?? marker.riskAudit ?? recordForRef(refRecords, refs.riskAuditRef),
    sourceApprovalRequest: marker.sourceApprovalRequestSidecar ?? marker.sourceApprovalRequest ?? recordForRef(refRecords, refs.sourceApprovalRequestRef),
    sourceGuiAskUser: marker.sourceGuiAskUserSidecar ?? marker.sourceGuiAskUserRecord ?? marker.sourceGuiAskUser ?? recordForRef(refRecords, refs.sourceGuiAskUserRecordRef),
    sourceRiskAudit: marker.sourceRiskAuditSidecar ?? marker.sourceRiskAudit ?? recordForRef(refRecords, refs.sourceRiskAuditRef),
    approvalDecision: marker.approvalDecisionSidecar ?? marker.approvalDecision ?? recordForRef(refRecords, refs.approvalDecisionRef),
  };
  return validateCuNextApprovalChainSidecars({
    sidecars,
    marker,
    refs,
  }).map((issue) => ({
    id: 'invalid-task-marker',
    path: issue.path,
    reason: issue.reason,
  }));
}

function requireDenseGroundingRejectionEvidence(
  marker: Record<string, unknown>,
  refRecords: Record<string, unknown> | undefined,
): CuNextLiveAcceptanceIssue[] {
  const refs = markerRefEntriesFromKeys(marker, ['rejectedTargetRefs', 'excludedTargetRefs', 'negativeTargetRefs']);
  const issues: CuNextLiveAcceptanceIssue[] = [];
  for (const entry of refs) {
    if (/cu-l3-independent-input-verifier\.json$/i.test(entry.ref)) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejectedTargetRefs must point to dedicated rejected-target evidence, not the generic verifier.',
      });
      continue;
    }
    const record = asRecord(recordForRef(refRecords, entry.ref)) ?? {};
    if (record.schemaVersion !== 'sciforge.computer-use.dense-grounding-rejections.v1') {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must use schemaVersion=sciforge.computer-use.dense-grounding-rejections.v1.',
      });
      continue;
    }
    if (record.status !== 'recorded' && record.status !== 'passed') {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must record status=recorded or passed.',
      });
    }
    if (!asRecord(record.selectedTarget)) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must include selectedTarget.',
      });
    }
    const rejectedTargets = Array.isArray(record.rejectedTargets)
      ? record.rejectedTargets.filter((item): item is Record<string, unknown> => Boolean(asRecord(item)))
      : [];
    if (rejectedTargets.length === 0) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must include non-empty rejectedTargets.',
      });
    }
    if (!stringValue(record.coarseWindowScreenshotRef) || !stringValue(record.focusCropRef) || !stringValue(record.fineGroundingDiagnosticRef)) {
      issues.push({
        id: 'invalid-task-marker',
        path: entry.path,
        reason: 'dense-grounding rejected target evidence must bind coarse screenshot, focus crop, and fine grounding diagnostic refs.',
      });
    }
  }
  return issues;
}

function recordForRef(refRecords: Record<string, unknown> | undefined, ref: string | undefined): unknown {
  if (!refRecords || !ref) return undefined;
  return refRecords[ref] ?? refRecords[ref.replace(/^\.\//, '')];
}

function requireMarkerRef(
  marker: Record<string, unknown>,
  evidence: Record<string, unknown>,
  label: string,
  markerKeys: readonly string[],
  evidenceFallbackKey: string,
): CuNextLiveAcceptanceIssue[] {
  const markerRefs = markerRefEntriesFromKeys(marker, markerKeys);
  const markerRefIssues = invalidMarkerRefIssues(markerRefs, label);
  if (markerRefIssues.length > 0) return markerRefIssues;
  if (markerRefs.length > 0) return [];
  const fallbackRefs = markerRefEntriesFromKeys(evidence, [evidenceFallbackKey]);
  if (fallbackRefs.some((entry) => isEvidenceBundleLocalFileRef(entry.ref))) return [];
  if (fallbackRefs.length > 0) {
    return [{
      id: 'invalid-task-marker',
      reason: `${label} fallback ${evidenceFallbackKey} must use an evidence-bundle-local file ref.`,
    }];
  }
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

function requireMarkerRefs(
  marker: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const refs = markerRefEntriesFromKeys(marker, keys);
  const refIssues = invalidMarkerRefIssues(refs, label);
  if (refIssues.length > 0) return refIssues;
  if (refs.length > 0) return [];
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

function requireMarkerValue(
  marker: Record<string, unknown>,
  label: string,
  keys: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  if (keys.some((key) => isNonEmptyString(marker[key]) || Boolean(asRecord(marker[key]) && Object.keys(asRecord(marker[key]) ?? {}).length > 0))) return [];
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

function requireAnyMarkerShape(
  marker: Record<string, unknown>,
  label: string,
  refKeys: readonly string[],
  numberKeys: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const refs = markerRefEntriesFromKeys(marker, refKeys);
  const refIssues = invalidMarkerRefIssues(refs, label);
  if (refIssues.length > 0) return refIssues;
  const hasRef = refs.length > 0;
  const hasNumber = numberKeys.some((key) => {
    const value = marker[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0;
  });
  if (hasRef || hasNumber) return [];
  return [{
    id: 'invalid-task-marker',
    reason: `Missing ${label}.`,
  }];
}

function findTaskMarker(
  evidence: Record<string, unknown>,
  kind: CuNextLiveAcceptanceMarkerKind,
): MarkerCandidate | undefined {
  const candidates = records(evidence.evidenceMarkers)
    .map((record, index) => ({ path: `$.evidenceMarkers[${index}]`, record }))
    .filter((candidate) => recordHasMarkerIdentity(candidate.record, kind));
  const valid = candidates.find((candidate) => validateMarkerFields(kind, candidate.record, evidence).length === 0);
  return valid ?? candidates[0];
}

interface MarkerRefEntry {
  path: string;
  ref: string;
}

function markerRefEntriesFromKeys(record: Record<string, unknown>, keys: readonly string[]): MarkerRefEntry[] {
  return keys.flatMap((key) => {
    const value = record[key];
    if (isNonEmptyString(value)) return [{ path: key, ref: value }];
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => (
        isNonEmptyString(item) ? [{ path: `${key}[${index}]`, ref: item }] : []
      ));
    }
    return [];
  });
}

function invalidMarkerRefIssues(
  refs: readonly MarkerRefEntry[],
  label: string,
  options: { allowApproval?: boolean } = {},
): CuNextLiveAcceptanceIssue[] {
  return refs
    .filter((entry) => !isAllowedMarkerRef(entry.ref, options))
    .map((entry) => ({
      id: 'invalid-task-marker',
      path: entry.path,
      reason: `${label} must use evidence-bundle-local file refs${options.allowApproval ? ' or approval: tokens' : ''}; got ${describeMarkerRef(entry.ref)}.`,
    }));
}

function isAllowedMarkerRef(ref: string, options: { allowApproval?: boolean } = {}): boolean {
  return isEvidenceBundleLocalFileRef(ref) || (options.allowApproval === true && isApprovalRefToken(ref));
}

function isEvidenceBundleLocalFileRef(ref: string): boolean {
  const trimmed = ref.trim();
  if (!trimmed) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return false;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return false;
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (!parts.every((part) => part !== '' && part !== '.' && part !== '..')) return false;
  const fileName = parts.at(-1) ?? '';
  return /\.[a-z0-9][a-z0-9-]{0,15}$/i.test(fileName);
}

function isApprovalRefToken(ref: string | undefined): boolean {
  if (!ref) return false;
  const trimmed = ref.trim();
  return trimmed.startsWith('approval:')
    && trimmed.slice('approval:'.length).trim().length > 0;
}

function describeMarkerRef(ref: string): string {
  const trimmed = ref.trim();
  if (!trimmed) return '(empty)';
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme) return `${scheme}: ref`;
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
}

function recordHasMarkerIdentity(
  record: Record<string, unknown>,
  kind: CuNextLiveAcceptanceMarkerKind,
): boolean {
  return ['kind', 'type', 'markerKind', 'marker', 'id'].some((key) => {
    const value = stringValue(record[key]);
    return value !== undefined && markerTokenMatches(value, kind);
  });
}

function markerTokenMatches(value: string, kind: CuNextLiveAcceptanceMarkerKind): boolean {
  const token = normalizeToken(value);
  return markerAliases[kind].some((alias) => normalizeToken(alias) === token);
}

function collectScenarioIds(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => collectScenarioIds(item, seen)));
  }
  const record = value as Record<string, unknown>;
  const ids: string[] = [];
  for (const [key, child] of Object.entries(record)) {
    if (
      (key === 'scenarioId' || key === 'primaryScenarioId' || key === 'cuLongScenarioId')
      && typeof child === 'string'
      && /^CU-LONG-\d{3}$/.test(child)
    ) {
      ids.push(child);
    }
    if (
      (key === 'scenarioIds' || key === 'longScenarioIds')
      && Array.isArray(child)
    ) {
      ids.push(...child.filter((item): item is string => typeof item === 'string' && /^CU-LONG-\d{3}$/.test(item)));
    }
    ids.push(...collectScenarioIds(child, seen));
  }
  return uniqueStrings(ids);
}

function collectSessionRefs(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) return uniqueStrings(value.flatMap((item) => collectSessionRefs(item, seen)));
  const record = value as Record<string, unknown>;
  const refs = stringArray(record.sessionRefs);
  for (const child of Object.values(record)) refs.push(...collectSessionRefs(child, seen));
  return uniqueStrings(refs);
}

function requireRef(
  issues: CuNextLiveAcceptanceIssue[],
  path: string,
  ref: string | undefined,
): void {
  if (ref) return;
  issues.push({
    id: 'missing-required-ref',
    path,
    reason: `${path} is required.`,
  });
}

function requireRefs(
  issues: CuNextLiveAcceptanceIssue[],
  path: string,
  refs: string[],
): void {
  if (refs.length > 0) return;
  issues.push({
    id: 'missing-required-ref',
    path,
    reason: `${path} must include at least one ref.`,
  });
}

function hasClaimWithRefs(
  claims: Array<Record<string, unknown>>,
  kind: string,
): boolean {
  return claims.some((claim) => claim.kind === kind && refsFromClaim(claim).length > 0);
}

function hasIndependentInputAdapterClaim(claims: Array<Record<string, unknown>>): boolean {
  return claims.some((claim) => (
    claim.kind === 'independent-input-adapter'
    && refsFromClaim(claim).length > 0
    && stringArray(claim.sessionRefs).length > 0
  ));
}

function hasSciForgeChatOriginClaim(
  claims: Array<Record<string, unknown>>,
  requestRef: string | undefined,
): boolean {
  if (!requestRef) return false;
  return claims.some((claim) => (
    claim.kind === 'sciForge-chat-origin'
    && claim.status === 'present'
    && refsFromClaim(claim).includes(requestRef)
    && stringArray(claim.sessionRefs).length > 0
    && isSciForgeChatOrigin(claim.origin)
  ));
}

function hasGuiPresentClaim(
  claims: Array<Record<string, unknown>>,
  guiPresentRecordRef: string | undefined,
  displayedRefs: string[],
  finalArtifactRef: string | undefined,
): boolean {
  if (!guiPresentRecordRef || !finalArtifactRef || displayedRefs.length === 0) return false;
  return claims.some((claim) => {
    if (claim.kind !== 'gui-present-record') return false;
    const claimRefs = refsFromClaim(claim);
    return claimRefs.includes(guiPresentRecordRef)
      && displayedRefs.includes(finalArtifactRef)
      && (claimRefs.includes(finalArtifactRef) || stringArray(claim.artifactRefs).includes(finalArtifactRef));
  });
}

function isSciForgeChatOrigin(value: unknown): boolean {
  const origin = asRecord(value);
  if (!origin) return false;
  return origin.schemaVersion === 'sciforge.computer-use.chat-origin.v1'
    && origin.handoffSource === 'ui-chat'
    && origin.entrypoint === 'sciforge-chat'
    && origin.terminalEquivalentText === true;
}

function refsFromClaim(claim: Record<string, unknown>): string[] {
  return refsFromKeys(claim, ['ref', 'refs', 'recordRefs', 'evidenceRefs', 'artifactRefs']);
}

function refsFromKeys(record: Record<string, unknown>, keys: readonly string[]): string[] {
  return uniqueStrings(keys.flatMap((key) => {
    const value = record[key];
    if (isNonEmptyString(value)) return [value];
    if (Array.isArray(value)) return value.filter(isNonEmptyString);
    return [];
  }));
}

function firstString(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (isNonEmptyString(value)) return value;
  }
  return undefined;
}

function findRecordValue(
  value: unknown,
  predicate: (key: string, value: unknown) => boolean,
  seen = new Set<unknown>(),
): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => findRecordValue(item, predicate, seen));
  for (const [key, child] of Object.entries(value)) {
    if (predicate(key, child)) return true;
    if (findRecordValue(child, predicate, seen)) return true;
  }
  return false;
}

function isModeKey(key: string): boolean {
  return key === 'kind'
    || key === 'evidenceKind'
    || key === 'sourceKind'
    || key === 'sourceMode'
    || key === 'evidenceMode'
    || key === 'runMode'
    || key === 'mode';
}

function isOriginKey(key: string): boolean {
  return key === 'origin'
    || key === 'evidenceOrigin'
    || key === 'provenance'
    || key === 'source'
    || key === 'generatedFrom'
    || key === 'materializedFrom';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function highRiskActionMatches(markerAction: string, sidecarAction: unknown): boolean {
  const marker = normalizeToken(markerAction);
  if (!marker) return false;
  if (isNonEmptyString(sidecarAction)) return normalizeToken(sidecarAction) === marker;
  const record = asRecord(sidecarAction);
  if (!record) return false;
  const candidates = [
    stringValue(record.actionKind),
    stringValue(record.action_kind),
    stringValue(record.kind),
    stringValue(record.type),
    stringValue(record.sideEffectClass),
    stringValue(record.side_effect_class),
    stringValue(record.targetDescription),
    stringValue(record.target),
  ].filter(isNonEmptyString).map(normalizeToken);
  return candidates.some((candidate) => candidate === marker || marker.includes(candidate) || candidate.includes(marker));
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function uniqueIssues(issues: CuNextLiveAcceptanceIssue[]): CuNextLiveAcceptanceIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.id}:${issue.path ?? ''}:${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
