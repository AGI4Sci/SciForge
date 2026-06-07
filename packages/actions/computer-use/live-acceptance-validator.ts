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
  | 'desktop-file-save'
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
  { taskId: 'CU-NEXT-08', markerKind: 'desktop-file-save', label: 'desktop file save' },
] as const;

const taskRulesById = new Map(CU_NEXT_LIVE_ACCEPTANCE_TASK_RULES.map((rule) => [rule.taskId, rule]));
const shortcutClaimKinds = new Set(['dom', 'playwright', 'accessibility', 'generated-file-only']);
const domAxHintClaimKinds = new Set(['dom', 'playwright', 'accessibility']);
const browserRuntimeDomAxObservationSchema = 'sciforge.computer-use.browser-runtime-dom-ax-observation.v1';
const forbiddenLegacyBackendPattern = /\b(?:docker|no-?vnc|novnc|vnc|rdp|container)\b/i;
const markerAliases: Record<CuNextLiveAcceptanceMarkerKind, readonly string[]> = {
  'briefing-deck': ['briefing-deck', 'briefingdeck', 'deck-briefing', 'literature-briefing-deck'],
  'chart-report': ['chart-report', 'chartreport', 'spreadsheet-chart-report'],
  'needs-confirmation': ['needs-confirmation', 'needsconfirmation', 'confirmation-required', 'approval-request'],
  'file-index': ['file-index', 'fileindex', 'directory-index', 'workspace-file-index'],
  'desktop-file-save': ['desktop-file-save', 'desktopfilesave', 'desktop-local-document-save', 'local-document-save', 'gui-file-save'],
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
  issues.push(...validateComputerUseProvenanceAndReplay(evidence));
  issues.push(...validateUserControlRefs(evidence));
  issues.push(...validateObserveBeforeMutateRefs(evidence, input.refRecords));
  issues.push(...validateBrowserRuntimeObservationHints(evidence));
  issues.push(...validatePlatformSidecarIsolationReport(evidence));
  issues.push(...validateProductPathClassification(evidence));
  issues.push(...validateEvidenceLedgerTraceability(evidence));
  issues.push(...validateFinalArtifactValidationEvidence(evidence, input.refRecords));

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
    || issue.id === 'missing-screen-identity'
    || issue.id === 'missing-actor-cursor-provenance'
    || issue.id === 'missing-executor-lease-scope'
    || issue.id === 'missing-action-causality'
    || issue.id === 'missing-native-multi-screen-actor-cursor'
    || issue.id === 'missing-native-queue-semantics'
    || issue.id === 'missing-browser-runtime-observation-hint'
    || issue.id === 'invalid-browser-runtime-observation-hint'
    || issue.id === 'missing-user-control-ref'
    || issue.id === 'missing-observe-before-mutate-ref'
    || issue.id === 'invalid-observe-before-mutate-freshness'
    || issue.id === 'missing-evidence-ledger-trace'
    || issue.id === 'missing-gui-present-current-session'
    || issue.id === 'missing-platform-sidecar-isolation'
    || issue.id === 'invalid-platform-sidecar-isolation'
    || issue.id === 'invalid-product-path-classification'
    || issue.id === 'missing-artifact-validation-ref'
    || issue.id === 'invalid-artifact-validation-ref'
    || issue.id === 'missing-artifact-action-causality'
    || issue.id === 'invalid-artifact-verifier-support'
    || issue.id === 'blocking-artifact-uncertainty'
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

  const primitiveSessionLink = tuiHostChain.find((link) => (
    link.kind === 'computer-use-primitive-session'
    && link.status === 'present'
  ));
  if (!primitiveSessionLink) {
    issues.push({
      id: 'missing-required-ref',
      path: 'tuiHostChain',
      reason: 'tuiHostChain must include a present computer-use-primitive-session link.',
    });
  } else {
    requireRef(issues, 'tuiHostChain[computer-use-primitive-session].sessionRef', stringValue(primitiveSessionLink.sessionRef));
    requireRef(issues, 'tuiHostChain[computer-use-primitive-session].primitiveTraceRef', stringValue(primitiveSessionLink.primitiveTraceRef));
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
    || evidenceClaims.some((claim) => (
      shortcutClaimKinds.has(String(claim.kind ?? '').toLowerCase())
      && !isAllowedDomAxObservationHintClaim(claim)
    ))
  ) {
    issues.push({
      id: 'forbidden-shortcut-substitute',
      reason: 'DOM, Playwright, accessibility, generated-file-only, or automation substitute claims cannot satisfy CU-NEXT live acceptance; DOM/AX/Playwright may appear only as refs-first observe-before-mutate or grounding hints.',
    });
  }

  return issues;
}

function validateComputerUseProvenanceAndReplay(
  evidence: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const screenRecords = computerUseScreenRecords(evidence);
  const screenIds = uniqueStrings(screenRecords.map((screen) => stringValue(screen.screenId)).filter(isNonEmptyString));
  const displayGroupId = stringValue(evidence.displayGroupId)
    ?? stringValue(asRecord(evidence.virtualDisplayGroup)?.displayGroupId)
    ?? stringValue(asRecord(evidence.virtualDesktopSession)?.displayGroupId);
  if (!displayGroupId) {
    issues.push({
      id: 'missing-screen-identity',
      path: 'virtualDisplayGroup.displayGroupId',
      reason: 'Computer Use acceptance evidence must bind a VirtualDisplayGroup displayGroupId.',
    });
  }
  if (screenIds.length === 0) {
    issues.push({
      id: 'missing-screen-identity',
      path: 'screens',
      reason: 'Computer Use acceptance evidence must include at least one structured screenId; screenshot refs alone are not screen identity.',
    });
  }
  if (screenIds.length < 2) {
    issues.push({
      id: 'missing-native-multi-screen-actor-cursor',
      path: 'virtualDisplayGroup.screens',
      reason: 'Native multi-screen Computer Use product acceptance requires at least two structured screen refs in the same display group.',
    });
  }
  for (const [index, screen] of screenRecords.entries()) {
    const screenId = stringValue(screen.screenId);
    const screenRef = stringValue(screen.ref) ?? stringValue(screen.screenRef) ?? stringValue(screen.manifestRef);
    if (!screenId || !screenRef) {
      issues.push({
        id: 'missing-screen-identity',
        path: `screens[${index}]`,
        reason: 'Each Computer Use screen record must include screenId and a bundle-local screen ref.',
      });
    } else if (!isEvidenceBundleLocalFileRef(screenRef)) {
      issues.push({
        id: 'forbidden-cross-bundle-ref',
        path: `screens[${index}]`,
        reason: `Screen refs must be evidence-bundle-local file refs; got ${describeMarkerRef(screenRef)}.`,
      });
    }
  }

  const cursorRecords = computerUseCursorRecords(evidence);
  if (!cursorRecords.some((cursor) => (
    isNonEmptyString(cursor.actorId)
    && isNonEmptyString(cursor.cursorId)
    && isNonEmptyString(cursor.screenId)
    && (
      isNonEmptyString(cursor.ref)
      || isNonEmptyString(cursor.cursorEventLogRef)
      || isNonEmptyString(cursor.actorCursorLogRef)
    )
  ))) {
    issues.push({
      id: 'missing-actor-cursor-provenance',
      path: 'actorCursorProvenance',
      reason: 'Computer Use acceptance evidence must include actorId, cursorId, screenId, and cursor event/log refs.',
    });
  }
  for (const [index, cursor] of cursorRecords.entries()) {
    const screenId = stringValue(cursor.screenId);
    if (screenId && screenIds.length > 0 && !screenIds.includes(screenId)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `actorCursorProvenance[${index}].screenId`,
        reason: `Actor cursor screenId ${screenId} must match a declared screen.`,
      });
    }
  }
  const actorCursorPairs = uniqueStrings(cursorRecords.flatMap((cursor) => {
    const actorId = stringValue(cursor.actorId);
    const cursorId = stringValue(cursor.cursorId);
    return actorId && cursorId ? [`${actorId}::${cursorId}`] : [];
  }));
  const cursorScreenIds = uniqueStrings(cursorRecords.map((cursor) => stringValue(cursor.screenId)).filter(isNonEmptyString));
  if (actorCursorPairs.length < 3 || cursorScreenIds.filter((screenId) => screenIds.includes(screenId)).length < 2) {
    issues.push({
      id: 'missing-native-multi-screen-actor-cursor',
      path: 'actorCursorProvenance',
      reason: 'Native multi-actor acceptance requires at least three actor/cursor pairs whose provenance spans at least two declared screens.',
    });
  }
  issues.push(...validateActorCursorEvents(evidence, cursorRecords, screenIds));

  const executorLease = asRecord(evidence.executorLease);
  const leaseScope = asRecord(executorLease?.leaseScope) ?? asRecord(executorLease?.scope);
  const leaseScreenId = stringValue(executorLease?.screenId) ?? stringValue(leaseScope?.screenId);
  const leaseKind = stringValue(leaseScope?.kind) ?? stringValue(leaseScope?.scope);
  if (!executorLease || !leaseScope || !leaseScreenId || !leaseKind) {
    issues.push({
      id: 'missing-executor-lease-scope',
      path: 'executorLease.leaseScope',
      reason: 'executorLease must include screen/window scoped leaseScope and screenId.',
    });
  } else if (screenIds.length > 0 && !screenIds.includes(leaseScreenId)) {
    issues.push({
      id: 'missing-executor-lease-scope',
      path: 'executorLease.screenId',
      reason: `executorLease screenId ${leaseScreenId} must match a declared screen.`,
    });
  }
  if (leaseKind?.startsWith('window')) {
    const leaseWindowId = stringValue(executorLease?.windowId) ?? stringValue(leaseScope?.windowId);
    if (!leaseWindowId) {
      issues.push({
        id: 'missing-executor-lease-scope',
        path: 'executorLease.windowId',
        reason: 'window-local executor leases must include windowId.',
      });
    }
  }
  for (const key of ['actorId', 'cursorId']) {
    if (!stringValue(executorLease?.[key])) {
      issues.push({
        id: 'missing-executor-lease-scope',
        path: `executorLease.${key}`,
        reason: `executorLease must include ${key} owner provenance.`,
      });
    }
  }

  const queueEvidence = computerUseQueueRecords(evidence);
  if (!queueEvidence.some((record) => leaseKindFromRecord(record) === 'window-local')) {
    issues.push({
      id: 'missing-native-queue-semantics',
      path: 'actionProposals',
      reason: 'Native multi-screen acceptance requires at least one window-local proposal/lease record.',
    });
  }
  if (!queueEvidence.some((record) => leaseKindFromRecord(record) === 'screen-global')) {
    issues.push({
      id: 'missing-native-queue-semantics',
      path: 'executorQueue',
      reason: 'Native multi-screen acceptance requires at least one screen-global queue/lease record.',
    });
  }
  issues.push(...validateNativeQueueBindings(queueEvidence, screenIds, actorCursorPairs));

  const mutatingActions = computerUseMutatingActionRecords(evidence);
  if (mutatingActions.length === 0) {
    issues.push({
      id: 'missing-action-causality',
      path: 'mutatingActions',
      reason: 'Computer Use acceptance evidence must include at least one mutating action causality record.',
    });
  }
  for (const [index, action] of mutatingActions.entries()) {
    const actionPath = `mutatingActions[${index}]`;
    for (const key of ['screenId', 'actorId', 'cursorId']) {
      if (!stringValue(action[key])) {
        issues.push({
          id: 'missing-action-causality',
          path: `${actionPath}.${key}`,
          reason: `Mutating action evidence must include ${key}.`,
        });
      }
    }
    if (!asRecord(action.leaseScope) && !stringValue(action.leaseId)) {
      issues.push({
        id: 'missing-action-causality',
        path: `${actionPath}.leaseScope`,
        reason: 'Mutating action evidence must bind an executor lease scope or leaseId.',
      });
    }
    requireRefs(issues, `${actionPath}.beforeEvidenceRefs`, stringArray(action.beforeEvidenceRefs));
    requireRefs(issues, `${actionPath}.afterEvidenceRefs`, stringArray(action.afterEvidenceRefs));
    requireRefs(issues, `${actionPath}.groundingRefs`, stringArray(action.groundingRefs));
    requireRef(issues, `${actionPath}.executorEventRef`, stringValue(action.executorEventRef));
    requireRefs(issues, `${actionPath}.verificationRefs`, stringArray(action.verificationRefs));
    if (isBareGlobalCoordinateAction(action)) {
      issues.push({
        id: 'forbidden-bare-global-coordinates',
        path: `${actionPath}.target`,
        reason: 'Mutating Computer Use actions must be screen/window/element/region scoped; bare global coordinates are forbidden.',
      });
    }
  }

  issues.push(...validateReplayEvidence(evidence, screenIds));

  if (findRecordValue(evidence, (key, value) => (
    (key === 'historicalCompletionEvidenceUsed' || key === 'priorRoundCompletionEvidenceUsed' || key === 'staleEvidenceUsed')
    && value === true
  ))) {
    issues.push({
      id: 'forbidden-stale-evidence',
      reason: 'Current acceptance must not rely on stale, historical, or prior-round completion evidence.',
    });
  }
  if (findRecordValue(evidence, (_key, value) => (
    typeof value === 'string'
    && isForbiddenCrossBundleEvidenceRef(value)
  ))) {
    issues.push({
      id: 'forbidden-cross-bundle-ref',
      reason: 'Acceptance evidence refs must be bundle-local file refs, not absolute, scheme, or parent-relative refs.',
    });
  }
  return issues;
}

function validateEvidenceLedgerTraceability(
  evidence: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const currentBundleRef = stringValue(asRecord(evidence.productPathClassification)?.currentBundleRef)
    ?? stringValue(asRecord(evidence.productPath)?.currentBundleRef)
    ?? stringValue(evidence.currentRunBundleRef)
    ?? stringValue(evidence.currentBundleRef);
  const bundleRoot = currentBundleRef ? currentBundleRootFromRef(currentBundleRef) : undefined;
  const sessionRefs = collectSessionRefs(evidence);
  const declaredRefs = new Set(collectAllEvidenceFileRefs(evidence));
  const completionEvidence = asRecord(evidence.completionEvidence) ?? {};
  const actionLedgerRef = firstString(evidence, ['actionLedgerRef', 'mutatingActionLedgerRef', 'evidenceActionLedgerRef'])
    ?? firstString(asRecord(evidence.evidenceLedger) ?? {}, ['ref', 'actionLedgerRef'])
    ?? firstString(completionEvidence, ['actionLedgerRef', 'executorCommandEventLogRef', 'inputEventLogRef', 'evidenceLogRef']);
  const evidenceIndexRef = firstString(evidence, ['evidenceIndexRef', 'evidenceRefsIndexRef', 'currentRunEvidenceIndexRef'])
    ?? firstString(asRecord(evidence.evidenceIndex) ?? {}, ['ref', 'indexRef'])
    ?? firstString(completionEvidence, ['evidenceIndexRef', 'evidenceSnapshotRef']);
  const guiPresent = asRecord(evidence.guiPresent) ?? {};
  const guiPresentDisplayedRefs = stringArray(guiPresent.displayedRefs);
  const guiPresentSessionRefs = stringArray(guiPresent.sessionRefs);
  const replay = asRecord(evidence.replayBundle)
    ?? asRecord(evidence.replayManifest)
    ?? asRecord(evidence.visibleReplay)
    ?? {};
  const replayFrameRefs = records(replay.frames).flatMap((frame) => refsFromKeys(frame, [
    'frameRef',
    'screenshotRef',
    'imageRef',
    'sourceEvidenceRefs',
    'cursorOverlayRefs',
  ]));
  const replayRefs = new Set([
    stringValue(replay.ref),
    stringValue(evidence.replayRef),
    ...stringArray(replay.beforeEvidenceRefs),
    ...stringArray(replay.afterEvidenceRefs),
    ...replayFrameRefs,
  ].filter(isNonEmptyString));

  if (guiPresentSessionRefs.length === 0 || !guiPresentSessionRefs.some((ref) => sessionRefs.includes(ref))) {
    issues.push({
      id: 'missing-gui-present-current-session',
      path: 'guiPresent.sessionRefs',
      reason: 'gui.present evidence must bind the same current Computer Use session that produced the evidence ledger.',
    });
  }
  if (!stringValue(guiPresent.recordRef)) {
    issues.push({
      id: 'missing-gui-present-current-session',
      path: 'guiPresent.recordRef',
      reason: 'gui.present evidence must include a recordRef for the current Screen presentation.',
    });
  }
  if (!guiPresentDisplayedRefs.some((ref) => ref === stringValue(evidence.finalArtifactRef))) {
    issues.push({
      id: 'missing-gui-present-current-session',
      path: 'guiPresent.displayedRefs',
      reason: 'gui.present evidence must display the current-session artifact ref.',
    });
  }
  if (!guiPresentDisplayedRefs.some((ref) => replayRefs.has(ref))) {
    issues.push({
      id: 'missing-gui-present-current-session',
      path: 'guiPresent.displayedRefs',
      reason: 'gui.present evidence must prove the current session is presentable by displaying a live/replay frame ref.',
    });
  }

  if (!actionLedgerRef || !evidenceIndexRef) {
    issues.push({
      id: 'missing-evidence-ledger-trace',
      path: !actionLedgerRef ? 'actionLedgerRef' : 'evidenceIndexRef',
      reason: 'Product-smoke Computer Use evidence must include independent action ledger and evidence index refs.',
    });
  }

  const productPathTier = stringValue(asRecord(evidence.productPathClassification)?.tier)
    ?? stringValue(asRecord(evidence.productPath)?.tier);
  if (productPathTier === 'product-smoke' && !hasIndependentEvidenceLedgerRecords(evidence, actionLedgerRef)) {
    issues.push({
      id: 'missing-evidence-ledger-trace',
      path: 'evidenceLedger',
      reason: 'Product-smoke Computer Use evidence ledger must include independent action ledger records; top-level action summaries are not enough.',
    });
  }

  const actionRecords = computerUseActionRecords(evidence);
  if (actionRecords.length === 0) {
    issues.push({
      id: 'missing-evidence-ledger-trace',
      path: 'mutatingActions',
      reason: 'Evidence ledger must include at least one Computer Use action record.',
    });
  }
  for (const [index, action] of actionRecords.entries()) {
    const path = `mutatingActions[${index}]`;
    const inputIntentRef = firstString(action, ['inputIntentRef', 'intentRef', 'inputRef']);
    const providerAdapterRef = firstString(action, ['providerAdapterRef', 'adapterRef', 'executorAdapterRef', 'actionAdapterRef']);
    const executorEventRef = firstString(action, ['executorEventRef', 'executeEventRef']);
    const beforeFrameRefs = uniqueStrings([
      ...stringArray(action.beforeFrameRefs),
      ...stringArray(action.beforeEvidenceRefs),
      firstString(action, ['beforeFrameRef', 'beforeScreenshotRef', 'currentScreenshotRef']),
    ].filter(isNonEmptyString));
    const afterFrameRefs = uniqueStrings([
      ...stringArray(action.afterFrameRefs),
      ...stringArray(action.afterEvidenceRefs),
      firstString(action, ['afterFrameRef', 'afterScreenshotRef']),
    ].filter(isNonEmptyString));
    const verificationRefs = uniqueStrings([
      ...stringArray(action.verificationRefs),
      ...stringArray(action.verifierRefs),
      firstString(action, ['verifierRef', 'verificationRef', 'verifierVerdictRef']),
    ].filter(isNonEmptyString));
    const artifactRefs = uniqueStrings([
      ...stringArray(action.artifactRefs),
      ...stringArray(action.outputArtifactRefs),
      firstString(action, ['artifactRef', 'finalArtifactRef']),
      stringValue(evidence.finalArtifactRef),
    ].filter(isNonEmptyString));
    const blockedRefs = uniqueStrings([
      ...stringArray(action.blockedReasonRefs),
      ...stringArray(action.blockedEvidenceRefs),
      firstString(action, ['blockedReasonRef', 'permissionHandoffRef', 'observeOnlyRef']),
      firstString(evidence, ['blockedReasonRef', 'permissionHandoffRef', 'observeOnlyRef']),
    ].filter(isNonEmptyString));
    const blockedReason = stringValue(action.blockedReason) ?? stringValue(evidence.blockedReason);

    requireCustomRef(issues, 'missing-evidence-ledger-trace', `${path}.inputIntentRef`, inputIntentRef);
    requireCustomRef(issues, 'missing-evidence-ledger-trace', `${path}.providerAdapterRef`, providerAdapterRef);
    requireCustomRef(issues, 'missing-evidence-ledger-trace', `${path}.executorEventRef`, executorEventRef);
    requireCustomRefs(issues, 'missing-evidence-ledger-trace', `${path}.beforeFrameRefs`, beforeFrameRefs);
    requireCustomRefs(issues, 'missing-evidence-ledger-trace', `${path}.afterFrameRefs`, afterFrameRefs);
    requireCustomRefs(issues, 'missing-evidence-ledger-trace', `${path}.verificationRefs`, verificationRefs);
    if (artifactRefs.length === 0 && blockedRefs.length === 0 && !blockedReason) {
      issues.push({
        id: 'missing-evidence-ledger-trace',
        path: `${path}.artifactRefs`,
        reason: 'Each Computer Use action must end in artifact refs or a structured blocked/permission/observe-only reason.',
      });
    }

    for (const ref of [
      inputIntentRef,
      providerAdapterRef,
      executorEventRef,
      ...beforeFrameRefs,
      ...afterFrameRefs,
      ...verificationRefs,
      ...artifactRefs,
      ...blockedRefs,
    ].filter(isNonEmptyString)) {
      if (!declaredRefs.has(ref)) {
        issues.push({
          id: 'missing-evidence-ledger-trace',
          path,
          reason: `Action causality ref ${ref} must also appear in the current evidence ledger or manifest refs.`,
        });
      }
    }
  }

  if (findRecordValue(evidence, (key, value) => (
    (
      key === 'shellOnly'
      || key === 'shellOnlyArtifact'
      || key === 'staleFile'
      || key === 'staleArtifact'
      || key === 'fixturePass'
      || key === 'fixtureArtifactPass'
      || key === 'passFromFixture'
    )
    && value === true
  ))) {
    issues.push({
      id: 'forbidden-shell-stale-fixture-artifact',
      reason: 'Artifact evidence must reject shell-only, stale-file, fixture, or fixture-pass completion records.',
    });
  }

  if (bundleRoot) {
    for (const [index, ref] of collectAllEvidenceFileRefs(evidence).entries()) {
      if (!isEvidenceRefInCurrentBundle(ref, bundleRoot)) {
        issues.push({
          id: 'forbidden-cross-bundle-ref',
          path: `refs[${index}]`,
          reason: `Evidence ref ${describeMarkerRef(ref)} must belong to current bundle ${currentBundleRef}.`,
        });
      }
    }
  }

  return issues;
}

function validateFinalArtifactValidationEvidence(
  evidence: Record<string, unknown>,
  refRecords?: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const finalArtifactRef = stringValue(evidence.finalArtifactRef);
  if (!finalArtifactRef) return issues;

  const completionEvidence = asRecord(evidence.completionEvidence) ?? {};
  const verifierVerdict = asRecord(evidence.verifierVerdict) ?? {};
  const artifactValidation = asRecord(evidence.artifactValidation) ?? {};
  const artifactCausality = asRecord(evidence.artifactCausality)
    ?? asRecord(completionEvidence.artifactCausality)
    ?? {};
  const completionArtifactCausality = asRecord(completionEvidence.artifactCausality) ?? {};
  const completionSourceEvidence = asRecord(completionEvidence.sourceEvidence) ?? {};
  const completionDerivedContent = asRecord(completionEvidence.derivedContentEvidence) ?? {};
  const completionTaskBinding = asRecord(completionEvidence.taskArtifactBinding) ?? {};
  const completionPresentation = asRecord(completionEvidence.presentationEvidence) ?? {};
  const artifactValidationRef = firstString(evidence, ['artifactValidationRef', 'validationRef', 'formatValidationRef'])
    ?? firstString(artifactValidation, ['artifactValidationRef', 'validationRef', 'ref'])
    ?? firstString(artifactCausality, ['artifactValidationRef', 'validationRef'])
    ?? firstString(verifierVerdict, ['artifactValidationRef', 'validationRef'])
    ?? firstString(completionEvidence, ['artifactValidationRef', 'validationRef'])
    ?? firstString(completionArtifactCausality, ['artifactValidationRef', 'validationRef']);
  const artifactValidationRecord = asRecord(recordForRef(refRecords, artifactValidationRef));
  const artifactValidationContentRefs = artifactValidationRecord
    ? refsFromKeys(artifactValidationRecord, [
      'contentRef',
      'contentRefs',
      'checkedRefs',
      'checkedArtifactRefs',
      'checkedContentRefs',
      'validatedContentRefs',
    ])
    : [];
  const contentRefs = uniqueStrings([
    ...artifactValidationContentRefs,
    ...stringArray(verifierVerdict.contentRefs),
    ...stringArray(verifierVerdict.checkedRefs),
    ...stringArray(verifierVerdict.checkedArtifactRefs),
    ...stringArray(verifierVerdict.artifactRefs),
    ...stringArray(evidence.taskFinalArtifactRefs),
    ...stringArray(completionEvidence.taskFinalArtifactRefs),
    ...stringArray(completionTaskBinding.finalArtifactRefs),
    ...stringArray(completionPresentation.artifactRefs),
    stringValue(completionTaskBinding.finalArtifactRef),
    stringValue(completionArtifactCausality.finalArtifactRef),
  ].filter(isNonEmptyString));
  const sourceRefs = uniqueStrings([
    ...stringArray(verifierVerdict.sourceRefs),
    ...stringArray(verifierVerdict.contentSourceRefs),
    ...stringArray(evidence.sourceRefs),
    ...stringArray(completionSourceEvidence.sourceFactRefs),
    ...stringArray(completionSourceEvidence.sourceObservationRefs),
    ...stringArray(completionDerivedContent.supportedFactRefs),
    ...(artifactValidationRecord
      ? refsFromKeys(artifactValidationRecord, [
        'sourceRef',
        'sourceRefs',
        'contentSourceRefs',
        'sourceFactRefs',
        'sourceObservationRefs',
      ])
      : []),
  ]);
  const verifierSaveRefs = uniqueStrings([
    stringValue(verifierVerdict.savedByActionRef),
    stringValue(verifierVerdict.saveActionRef),
    stringValue(verifierVerdict.savedByCommandEventRef),
    stringValue(artifactCausality.savedByActionRef),
    stringValue(artifactCausality.savedByCommandEventRef),
    stringValue(completionArtifactCausality.savedByActionRef),
    stringValue(completionArtifactCausality.savedByCommandEventRef),
  ].filter(isNonEmptyString));
  const hasArtifactValidationRef = typeof artifactValidationRef === 'string'
    && artifactValidationRef.trim().length > 0;
  const hasSaveActionIndex = Number.isInteger(verifierVerdict.savedByActionIndex)
    || Number.isInteger(verifierVerdict.saveActionIndex)
    || Number.isInteger(artifactCausality.savedByActionIndex)
    || Number.isInteger(completionArtifactCausality.savedByActionIndex);
  const hasMutatingActionCausality = computerUseMutatingActionRecords(evidence).some((action) => {
    const artifactRefs = uniqueStrings([
      ...stringArray(action.artifactRefs),
      ...stringArray(action.outputArtifactRefs),
      stringValue(action.artifactRef),
      stringValue(action.finalArtifactRef),
    ].filter(isNonEmptyString));
    return artifactRefs.includes(finalArtifactRef)
      && Boolean(firstString(action, ['executorEventRef', 'executeEventRef']))
      && stringArray(action.beforeEvidenceRefs).length > 0
      && stringArray(action.afterEvidenceRefs).length > 0
      && stringArray(action.verificationRefs).length > 0;
  });
  const hasSaveActionCausality = hasSaveActionIndex || verifierSaveRefs.length > 0 || hasMutatingActionCausality;
  const completionEvidenceSupportsVerifier = Boolean(
    hasArtifactValidationRef
    && sourceRefs.length > 0
    && contentRefs.includes(finalArtifactRef)
    && hasSaveActionCausality
    && Object.keys(completionSourceEvidence).length > 0
    && Object.keys(completionDerivedContent).length > 0
    && Object.keys(completionArtifactCausality).length > 0,
  );
  const verifierSupportsContentSourceAndSave = Boolean(
    stringValue(verifierVerdict.ref)
    && contentRefs.includes(finalArtifactRef)
    && sourceRefs.length > 0
    && hasSaveActionCausality
  );
  const currentBundleOnly = asRecord(evidence.productPathClassification)?.currentBundleOnly === true
    || asRecord(evidence.productPath)?.currentBundleOnly === true
    || evidence.currentBundleOnly === true;
  const currentRunCausality = currentBundleOnly
    && isEvidenceBundleLocalFileRef(finalArtifactRef)
    && (hasMutatingActionCausality || completionEvidenceSupportsVerifier);

  if (fileArtifactRequiresValidation(finalArtifactRef) && !hasArtifactValidationRef) {
    issues.push({
      id: 'missing-artifact-validation-ref',
      path: 'artifactValidationRef',
      reason: 'Final file artifacts must carry artifactValidationRef from a generic format validator; file existence alone is not sufficient.',
    });
  }
  if (hasArtifactValidationRef && !isEvidenceBundleLocalFileRef(artifactValidationRef)) {
    issues.push({
      id: 'invalid-artifact-validation-ref',
      path: 'artifactValidationRef',
      reason: `artifactValidationRef must be a bundle-local file ref; got ${describeMarkerRef(artifactValidationRef)}.`,
    });
  }
  if (hasArtifactValidationRef && !artifactValidationRecord) {
    issues.push({
      id: 'invalid-artifact-validation-ref',
      path: 'artifactValidationRef',
      reason: 'artifactValidationRef must resolve to a readable validation record in refRecords.',
    });
  }
  if (artifactValidationRecord) {
    const recordIssues = validateArtifactValidationRecord(
      artifactValidationRecord,
      finalArtifactRef,
      completionTaskBinding,
    );
    issues.push(...recordIssues);
  }
  if (!hasSaveActionCausality || !currentRunCausality) {
    issues.push({
      id: 'missing-artifact-action-causality',
      path: 'artifactCausality',
      reason: 'Final artifact evidence must bind content to a current-run save action and current-run causality.',
    });
  }
  if (!verifierSupportsContentSourceAndSave && !completionEvidenceSupportsVerifier) {
    issues.push({
      id: 'invalid-artifact-verifier-support',
      path: 'verifierVerdict',
      reason: 'Verifier support must check artifact content refs, source refs, save action causality, and current-run causality; existence-only checks cannot pass.',
    });
  }
  if (hasBlockingArtifactUncertainty(verifierVerdict, artifactValidationRecord, completionEvidence, evidence)) {
    issues.push({
      id: 'blocking-artifact-uncertainty',
      path: 'verifierVerdict',
      reason: 'Blocking uncertainty must be resolved before final artifact completion can be accepted.',
    });
  }
  return issues;
}

function fileArtifactRequiresValidation(ref: string) {
  const normalized = ref.toLowerCase().split(/[?#]/, 1)[0];
  const name = normalized.split('/').pop() ?? normalized;
  return /\.(pptx|docx?|csv|tsv|md|markdown|pdf|html?|txt|png|jpe?g|webp|gif|bmp|tiff?)$/i.test(normalized)
    || /report|summary|brief|briefing/.test(name);
}

function validateArtifactValidationRecord(
  record: Record<string, unknown>,
  finalArtifactRef: string,
  completionTaskBinding: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const status = normalizeToken(stringValue(record.status) ?? '');
  const artifactRefs = uniqueStrings([
    stringValue(record.finalArtifactRef),
    stringValue(record.artifactRef),
    stringValue(record.outputArtifactRef),
    ...stringArray(record.finalArtifactRefs),
    ...stringArray(record.artifactRefs),
    ...stringArray(record.outputArtifactRefs),
  ].filter(isNonEmptyString));
  const contentRefs = refsFromKeys(record, [
    'contentRef',
    'contentRefs',
    'checkedRefs',
    'checkedArtifactRefs',
    'checkedContentRefs',
    'validatedContentRefs',
  ]);
  const sourceRefs = refsFromKeys(record, [
    'sourceRef',
    'sourceRefs',
    'contentSourceRefs',
    'sourceFactRefs',
    'sourceObservationRefs',
  ]);
  const hasMatchingArtifactRef = artifactRefs.includes(finalArtifactRef)
    || stringArray(completionTaskBinding.finalArtifactRefs).includes(finalArtifactRef);
  const hasHash = Boolean(firstString(record, ['sha256', 'hash', 'digest', 'contentHash']));
  const bytes = record.bytes;
  const hasBytes = typeof bytes === 'number'
    && Number.isFinite(bytes)
    && bytes > 0;
  const hasMetadata = Boolean(
    asRecord(record.metadata)
    || asRecord(record.fileMetadata)
    || stringValue(record.metadataRef)
    || stringValue(record.fileMetadataRef),
  );
  const hasFormat = Boolean(firstString(record, ['format', 'fileFormat', 'mimeType', 'mediaType']));
  const hasValidator = Boolean(firstString(record, [
    'validator',
    'validatorRef',
    'formatValidator',
    'formatValidatorRef',
    'validatorName',
  ]));
  const metadata = asRecord(record.metadata);
  const diagnosticValidationRecord = record.diagnosticOnly === true
    || record.packageDiagnosticOnly === true
    || record.productAcceptanceEvidence === false
    || metadata?.diagnosticOnly === true
    || metadata?.packageDiagnosticOnly === true
    || metadata?.productAcceptanceEvidence === false;
  const fixtureValidationRecord = artifactValidationRecordIsFixture(record, metadata);

  if (diagnosticValidationRecord) {
    issues.push({
      id: 'invalid-artifact-validation-ref',
      path: 'artifactValidationRef',
      reason: 'artifact validation record is diagnostic-only and cannot satisfy product-smoke artifact completion.',
    });
  }
  if (fixtureValidationRecord) {
    issues.push({
      id: 'invalid-artifact-validation-ref',
      path: 'artifactValidationRef',
      reason: 'artifact validation record is fixture, demo, or synthetic evidence and cannot satisfy product-smoke artifact completion.',
    });
  }

  if (
    status !== 'passed'
    || record.ok === false
    || !hasMatchingArtifactRef
    || !hasHash
    || !hasBytes
    || !hasMetadata
    || !hasFormat
    || !hasValidator
    || sourceRefs.length === 0
    || contentRefs.length === 0
    || !contentRefs.includes(finalArtifactRef)
  ) {
    issues.push({
      id: 'invalid-artifact-validation-ref',
      path: 'artifactValidationRef',
      reason: 'artifact validation record must have passed status, match finalArtifactRef, and include hash, bytes, metadata, format validator, source refs, and content refs for the final artifact.',
    });
  }
  return issues;
}

function artifactValidationRecordIsFixture(
  record: Record<string, unknown>,
  metadata: Record<string, unknown> | undefined,
) {
  return [
    stringValue(record.schemaVersion),
    stringValue(record.generatedBy),
    stringValue(record.validationScope),
    stringValue(record.source),
    stringValue(metadata?.schemaVersion),
    stringValue(metadata?.generatedBy),
    stringValue(metadata?.validationScope),
    stringValue(metadata?.source),
  ].some((value) => typeof value === 'string' && /fixture|demo|synthetic|\bcu-next-runner\b/i.test(value));
}

function hasBlockingArtifactUncertainty(...values: unknown[]) {
  return values.some((value) => findRecordValue(value, (key, child) => {
    if (!/^(?:blockingUncertainty|artifactUncertainty|verifierUncertainty|uncertainty|uncertain|cannotVerify|notVerified)$/i.test(key)) {
      return false;
    }
    if (child === true) return true;
    if (typeof child !== 'string') return false;
    return !/^(?:false|no|none|resolved|not-applicable|n\/a)$/i.test(child.trim());
  }));
}

function validateUserControlRefs(evidence: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const control = asRecord(evidence.userControlPlane)
    ?? asRecord(evidence.userControl)
    ?? asRecord(evidence.sessionPermission);
  if (!control) {
    return [{
      id: 'missing-user-control-ref',
      path: 'userControlPlane',
      reason: 'User-level Computer Use acceptance must include user-control refs for permission, allowlists, risk/data visibility, and stop/cancel.',
    }];
  }

  const issues: CuNextLiveAcceptanceIssue[] = [];
  requireCustomRef(issues, 'missing-user-control-ref', 'userControlPlane.sessionPermissionRef', stringValue(control.sessionPermissionRef));
  requireCustomRefs(issues, 'missing-user-control-ref', 'userControlPlane.allowedAppRefs', stringArray(control.allowedAppRefs));
  requireCustomRefs(issues, 'missing-user-control-ref', 'userControlPlane.allowedWindowRefs', stringArray(control.allowedWindowRefs));
  requireCustomRefs(issues, 'missing-user-control-ref', 'userControlPlane.forbiddenAppRefs', stringArray(control.forbiddenAppRefs));
  requireCustomRef(
    issues,
    'missing-user-control-ref',
    'userControlPlane.inputModalityPolicyRef',
    stringValue(control.inputModalityPolicyRef) ?? stringValue(asRecord(control.inputModalityPolicy)?.ref),
  );
  requireCustomRef(issues, 'missing-user-control-ref', 'userControlPlane.riskPreviewRef', stringValue(control.riskPreviewRef));
  requireCustomRef(issues, 'missing-user-control-ref', 'userControlPlane.dataVisibilityRef', stringValue(control.dataVisibilityRef));
  if (!stringValue(control.stopRef) && !stringValue(control.cancelLeaseRef)) {
    issues.push({
      id: 'missing-user-control-ref',
      path: 'userControlPlane.stopRef',
      reason: 'User-control evidence must include stopRef or cancelLeaseRef.',
    });
  }
  if (!stringValue(control.approvalMode)) {
    issues.push({
      id: 'missing-user-control-ref',
      path: 'userControlPlane.approvalMode',
      reason: 'User-control evidence must declare approvalMode; third-party page text cannot substitute for user confirmation.',
    });
  }
  return issues;
}

function validateObserveBeforeMutateRefs(
  evidence: Record<string, unknown>,
  refRecords?: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const policy = asRecord(evidence.observeBeforeMutate)
    ?? asRecord(evidence.observationFreshness)
    ?? {};
  const mutatingActions = computerUseMutatingActionRecords(evidence);
  for (const [index, action] of mutatingActions.entries()) {
    const path = `mutatingActions[${index}]`;
    const currentAppStateRef = firstString(action, ['currentAppStateRef', 'appStateRef', 'stateRef'])
      ?? firstString(policy, ['currentAppStateRef', 'appStateRef', 'stateRef']);
    const screenshotOrCaptureRef = firstString(action, ['currentScreenshotRef', 'screenshotRef', 'captureRef'])
      ?? firstString(policy, ['currentScreenshotRef', 'screenshotRef', 'captureRef']);
    const stateSnapshotRef = firstString(action, ['accessibilitySnapshotRef', 'stateSnapshotRef', 'visibleStateSnapshotRef'])
      ?? firstString(policy, ['accessibilitySnapshotRef', 'stateSnapshotRef', 'visibleStateSnapshotRef']);
    const freshnessCheckRef = firstString(action, ['freshnessCheckRef', 'evidenceFreshnessRef'])
      ?? firstString(policy, ['freshnessCheckRef', 'evidenceFreshnessRef']);

    requireCustomRef(issues, 'missing-observe-before-mutate-ref', `${path}.currentAppStateRef`, currentAppStateRef);
    requireCustomRef(issues, 'missing-observe-before-mutate-ref', `${path}.currentScreenshotRef`, screenshotOrCaptureRef);
    requireCustomRef(issues, 'missing-observe-before-mutate-ref', `${path}.stateSnapshotRef`, stateSnapshotRef);
    requireCustomRefs(
      issues,
      'missing-observe-before-mutate-ref',
      `${path}.groundingRefs`,
      stringArray(action.groundingRefs),
    );
    requireCustomRef(issues, 'missing-observe-before-mutate-ref', `${path}.freshnessCheckRef`, freshnessCheckRef);
    if (freshnessCheckRef) {
      issues.push(...validateFreshnessCheckRef(`${path}.freshnessCheckRef`, freshnessCheckRef, refRecords));
    }
  }
  return issues;
}

function validateFreshnessCheckRef(
  path: string,
  freshnessCheckRef: string,
  refRecords?: Record<string, unknown>,
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  if (!isEvidenceBundleLocalFileRef(freshnessCheckRef)) {
    return [{
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: `freshnessCheckRef must be an evidence-bundle-local file ref; got ${describeMarkerRef(freshnessCheckRef)}.`,
    }];
  }
  const record = asRecord(recordForRef(refRecords, freshnessCheckRef));
  if (!record) {
    return [{
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: 'freshnessCheckRef must resolve to a readable freshness record in refRecords.',
    }];
  }

  const recordRefs = freshnessRecordRefs(record);
  const crossBundleRef = recordRefs.find((ref) => !isEvidenceBundleLocalFileRef(ref));
  if (crossBundleRef) {
    issues.push({
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: `freshness record refs must be evidence-bundle-local file refs; got ${describeMarkerRef(crossBundleRef)}.`,
    });
  }

  const status = normalizeToken(stringValue(record.status) ?? '');
  if (status !== 'current') {
    issues.push({
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: stringValue(record.reason)
        ?? stringValue(record.staleBy)
        ?? `freshness status is ${status || 'missing'}; expected current.`,
    });
  }

  const observedAt = timestampMs(stringValue(record.observedAt) ?? stringValue(record.capturedAt));
  const checkedAt = timestampMs(stringValue(record.checkedAt) ?? stringValue(record.freshnessCheckedAt));
  const expiresAtRaw = stringValue(record.expiresAt);
  const expiresAt = timestampMs(expiresAtRaw);
  if (observedAt === undefined) {
    issues.push({
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: 'freshness record must include a valid observedAt timestamp.',
    });
  }
  if (checkedAt === undefined) {
    issues.push({
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: 'freshness record must include a valid checkedAt timestamp.',
    });
  }
  if (expiresAtRaw && expiresAt === undefined) {
    issues.push({
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: 'freshness record expiresAt timestamp is invalid.',
    });
  }
  if (checkedAt !== undefined && expiresAt !== undefined && checkedAt > expiresAt) {
    issues.push({
      id: 'invalid-observe-before-mutate-freshness',
      path,
      reason: `freshness record expired at ${expiresAtRaw}.`,
    });
  }

  if (observedAt !== undefined && checkedAt !== undefined) {
    const defaultMaxAgeMs = 30_000;
    const declaredMaxAgeMs = finiteNumber(record.maxAgeMs) ?? defaultMaxAgeMs;
    const maxAgeMs = Math.min(Math.max(1, declaredMaxAgeMs), defaultMaxAgeMs);
    if (checkedAt - observedAt > maxAgeMs) {
      issues.push({
        id: 'invalid-observe-before-mutate-freshness',
        path,
        reason: `freshness record observation is older than ${maxAgeMs}ms.`,
      });
    }
  }
  return issues;
}

function validateBrowserRuntimeObservationHints(evidence: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const observations = browserRuntimeObservationRecords(evidence);
  const hintClaims = records(evidence.evidenceClaims).filter((claim) => (
    domAxHintClaimKinds.has(String(claim.kind ?? '').toLowerCase())
  ));
  if (observations.length === 0) {
    return [{
      id: 'missing-browser-runtime-observation-hint',
      path: 'browserRuntimeDomAxObservation',
      reason: 'DOM-aware Computer Use acceptance requires structured BrowserRuntime DOM/AX/Playwright observation refs; claim-only DOM/AX hints are not completion evidence.',
    }];
  }
  const structuredObservationRefs = new Set(observations.flatMap((observation) => browserRuntimeObservationRefs(observation)));
  const boundObservationRefs = new Set(browserRuntimeRefsBoundToActions(evidence));

  for (const [index, claim] of hintClaims.entries()) {
    if (!isAllowedDomAxObservationHintClaim(claim)) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `evidenceClaims[dom-ax-hint:${index}]`,
        reason: 'DOM/AX/Playwright claims must be bundle-local refs-first hints and must not substitute for executor leases, GUI action causality, artifact validation, or completion evidence.',
      });
    }
    const claimRefs = refsFromClaim(claim);
    if (claimRefs.some((ref) => !structuredObservationRefs.has(ref))) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `evidenceClaims[dom-ax-hint:${index}].refs`,
        reason: 'DOM/AX/Playwright claim refs must be emitted by the structured BrowserRuntime observation for this run.',
      });
    }
  }

  for (const [index, observation] of observations.entries()) {
    const path = `browserRuntimeDomAxObservation[${index}]`;
    if (observation.schemaVersion !== browserRuntimeDomAxObservationSchema) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.schemaVersion`,
        reason: `BrowserRuntime DOM/AX observation hints must use schemaVersion=${browserRuntimeDomAxObservationSchema}.`,
      });
    }
    if (observation.trust !== 'untrusted-page-observation') {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.trust`,
        reason: 'BrowserRuntime DOM/AX observation hints must mark page data as untrusted-page-observation.',
      });
    }
    if (observation.refsFirst !== true || observation.currentBundleOnly !== true) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path,
        reason: 'BrowserRuntime DOM/AX observation hints must assert refsFirst=true and currentBundleOnly=true.',
      });
    }
    for (const flag of [
      'completionEvidenceEligible',
      'executorLeaseSubstitute',
      'guiActionSubstitute',
      'artifactCausalitySubstitute',
      'userLevelCompletionSubstitute',
    ]) {
      if (observation[flag] !== false) {
        issues.push({
          id: 'invalid-browser-runtime-observation-hint',
          path: `${path}.${flag}`,
          reason: `BrowserRuntime DOM/AX observation hints must explicitly set ${flag}=false.`,
        });
      }
    }
    const observationScreenId = stringValue(observation.screenId) ?? stringValue(asRecord(observation.scope)?.screenId);
    if (!observationScreenId) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.screenId`,
        reason: 'BrowserRuntime DOM/AX observation hints must bind a Computer Use screenId.',
      });
    } else {
      const declaredScreenIds = uniqueStrings(computerUseScreenRecords(evidence).map((screen) => stringValue(screen.screenId)).filter(isNonEmptyString));
      if (declaredScreenIds.length > 0 && !declaredScreenIds.includes(observationScreenId)) {
        issues.push({
          id: 'invalid-browser-runtime-observation-hint',
          path: `${path}.screenId`,
          reason: `BrowserRuntime DOM/AX observation screenId ${observationScreenId} must match a declared Computer Use screen.`,
        });
      }
    }
    const mutatingWindowBound = computerUseMutatingActionRecords(evidence).some((action) => (
      stringValue(action.windowId) || stringValue(asRecord(action.leaseScope)?.windowId)
    ));
    if (mutatingWindowBound && !stringValue(observation.windowId) && !stringValue(asRecord(observation.scope)?.windowId)) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.windowId`,
        reason: 'BrowserRuntime DOM/AX observation hints must bind windowId when grounding window-scoped actions.',
      });
    }
    const refs = refsFromKeys(observation, [
      'ref',
      'observationRef',
      'visibleDomRef',
      'accessibilitySnapshotRef',
      'playwrightEvaluateRef',
      'pageQueryRef',
      'stableRef',
      'stableRefs',
      'stableElementRefs',
      'groundingHintRef',
      'groundingHintRefs',
    ]);
    if (refs.length === 0 || refs.some((item) => !isEvidenceBundleLocalFileRef(item))) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path,
        reason: 'BrowserRuntime DOM/AX observation hints must use bundle-local file refs and avoid inline page state as evidence.',
      });
    }
    const use = normalizeToken(
      stringValue(observation.observationUse)
        ?? stringValue(observation.use)
        ?? stringValue(observation.evidenceUse)
        ?? '',
    );
    if (use !== 'observe-before-mutate-hint' && use !== 'grounding-hint') {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.observationUse`,
        reason: 'BrowserRuntime DOM/AX observations may only be observe-before-mutate-hint or grounding-hint evidence.',
      });
    }
    if (hasDomAxSubstituteFlag(observation)) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path,
        reason: 'BrowserRuntime DOM/AX observations must explicitly avoid executor-lease, GUI-action, artifact-validation, and completion-evidence substitution.',
      });
    }
    const pageQuery = asRecord(observation.pageQuery) ?? asRecord(observation.browserRuntimePageQuery);
    if (!pageQuery && !stringValue(observation.pageQueryRef)) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.pageQuery`,
        reason: 'BrowserRuntime DOM/AX observation hints must bind a BrowserRuntimePageQuery ref or structured query.',
      });
    }
    const stableRefs = stringArray(observation.stableRefs)
      .concat(stringArray(observation.stableElementRefs));
    if (
      stableRefs.length === 0
      && records(observation.stableElementRefs).length === 0
      && records(observation.stableRefs).length === 0
      && !stringValue(observation.stableRef)
    ) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path: `${path}.stableRefs`,
        reason: 'BrowserRuntime DOM/AX observation hints must include stable refs for refs-first grounding.',
      });
    }
    const observationRefs = browserRuntimeObservationRefs(observation);
    if (observationRefs.length > 0 && !observationRefs.some((ref) => boundObservationRefs.has(ref))) {
      issues.push({
        id: 'invalid-browser-runtime-observation-hint',
        path,
        reason: 'BrowserRuntime DOM/AX observation refs must be bound to observe-before-mutate or a mutating action beforeEvidenceRefs/groundingRefs.',
      });
    }
  }

  return issues;
}

function validatePlatformSidecarIsolationReport(evidence: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const report = asRecord(evidence.platformSidecarIsolationReport)
    ?? asRecord(evidence.platformSidecarIsolation)
    ?? asRecord(evidence.platformSidecar);
  if (!report) {
    return [{
      id: 'missing-platform-sidecar-isolation',
      path: 'platformSidecarIsolationReport',
      reason: 'Product-level Computer Use evidence must include native platform sidecar isolation report refs.',
    }];
  }

  const issues: CuNextLiveAcceptanceIssue[] = [];
  const status = stringValue(report.status);
  if (status !== 'present' && status !== 'passed') {
    issues.push({
      id: 'invalid-platform-sidecar-isolation',
      path: 'platformSidecarIsolationReport.status',
      reason: 'platform sidecar isolation report status must be present or passed.',
    });
  }
  const backendKind = normalizeToken(
    stringValue(report.backendKind)
      ?? stringValue(report.sidecarKind)
      ?? stringValue(report.kind)
      ?? '',
  );
  if (!['platform-sidecar', 'native-platform-sidecar', 'native-multi-screen-sidecar'].includes(backendKind)) {
    issues.push({
      id: 'invalid-platform-sidecar-isolation',
      path: 'platformSidecarIsolationReport.backendKind',
      reason: 'platform sidecar isolation report must identify a native platform sidecar backend.',
    });
  }
  requireCustomRef(issues, 'missing-platform-sidecar-isolation', 'platformSidecarIsolationReport.reportRef', stringValue(report.reportRef));
  requireCustomRef(issues, 'missing-platform-sidecar-isolation', 'platformSidecarIsolationReport.captureRef', stringValue(report.captureRef));
  requireCustomRef(issues, 'missing-platform-sidecar-isolation', 'platformSidecarIsolationReport.stateRef', stringValue(report.stateRef));
  requireCustomRef(issues, 'missing-platform-sidecar-isolation', 'platformSidecarIsolationReport.preflightRef', stringValue(report.preflightRef));
  requireCustomRef(issues, 'missing-platform-sidecar-isolation', 'platformSidecarIsolationReport.executorAdapterRef', stringValue(report.executorAdapterRef));

  const isolationFlags = asRecord(report.isolationFlags) ?? report;
  if (
    isolationFlags.sharedSystemInputUsed === true
    || isolationFlags.systemPointerMoved === true
    || isolationFlags.systemKeyboardEventsSent === true
  ) {
    issues.push({
      id: 'invalid-platform-sidecar-isolation',
      path: 'platformSidecarIsolationReport.isolationFlags',
      reason: 'platform sidecar isolation must prove shared system input, system pointer movement, and system keyboard events were not used.',
    });
  }
  if (isolationFlags.sidecarDoesPlanning !== false || isolationFlags.sidecarDoesCompletion !== false) {
    issues.push({
      id: 'invalid-platform-sidecar-isolation',
      path: 'platformSidecarIsolationReport.isolationFlags',
      reason: 'platform sidecar must be isolated to capture/state/input/preflight; planning and completion must remain outside the sidecar.',
    });
  }
  return issues;
}

function validateProductPathClassification(evidence: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const classification = asRecord(evidence.productPathClassification)
    ?? asRecord(evidence.productPath)
    ?? asRecord(evidence.acceptancePathClassification);
  if (!classification) {
    return [{
      id: 'invalid-product-path-classification',
      path: 'productPathClassification',
      reason: 'Live acceptance must classify the path as product-smoke, platform-smoke, or package-diagnostic; missing classification fails closed.',
    }];
  }

  const issues: CuNextLiveAcceptanceIssue[] = [];
  const tier = normalizeToken(
    stringValue(classification.tier)
      ?? stringValue(classification.kind)
      ?? stringValue(classification.evidenceTier)
      ?? '',
  );
  if (tier !== 'product-smoke') {
    issues.push({
      id: 'invalid-product-path-classification',
      path: 'productPathClassification.tier',
      reason: `${tier || '(missing)'} evidence cannot satisfy product-level live acceptance; package diagnostic and platform smoke are not product smoke.`,
    });
  }
  const hops = stringArray(classification.hops).map(normalizeToken);
  if (containsForbiddenLegacyBackendMarker([
    stringValue(classification.entrypoint),
    stringValue(classification.backendKind),
    stringValue(classification.sidecarKind),
    ...stringArray(classification.hops),
  ])) {
    issues.push({
      id: 'forbidden-legacy-backend-gate',
      path: 'productPathClassification.hops',
      reason: 'Docker/noVNC/RDP/container hops cannot participate in native Computer Use product acceptance.',
    });
  }
  for (const requiredHop of ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use']) {
    if (!hops.includes(requiredHop)) {
      issues.push({
        id: 'invalid-product-path-classification',
        path: 'productPathClassification.hops',
        reason: `product path must include ${requiredHop}.`,
      });
    }
  }
  if (!hops.some((hop) => hop === 'platform-sidecar' || hop === 'native-platform-sidecar' || hop === 'native-multi-screen-sidecar')) {
    issues.push({
      id: 'invalid-product-path-classification',
      path: 'productPathClassification.hops',
      reason: 'product path must include a native platform sidecar backend hop.',
    });
  }
  if (classification.diagnosticOnly === true || classification.packageDiagnosticOnly === true) {
    issues.push({
      id: 'invalid-product-path-classification',
      path: 'productPathClassification.diagnosticOnly',
      reason: 'package diagnostic evidence must not be accepted as product smoke.',
    });
  }
  if (classification.currentBundleOnly !== true) {
    issues.push({
      id: 'invalid-product-path-classification',
      path: 'productPathClassification.currentBundleOnly',
      reason: 'product path classification must assert currentBundleOnly=true.',
    });
  }
  requireCustomRef(issues, 'invalid-product-path-classification', 'productPathClassification.appServerRunRef', stringValue(classification.appServerRunRef));
  requireCustomRef(issues, 'invalid-product-path-classification', 'productPathClassification.nativePluginInvocationRef', stringValue(classification.nativePluginInvocationRef));
  requireCustomRef(issues, 'invalid-product-path-classification', 'productPathClassification.sciforgeComputerUsePrimitiveTraceRef', stringValue(classification.sciforgeComputerUsePrimitiveTraceRef));
  requireCustomRef(issues, 'invalid-product-path-classification', 'productPathClassification.platformSidecarIsolationReportRef', stringValue(classification.platformSidecarIsolationReportRef));
  requireCustomRef(issues, 'invalid-product-path-classification', 'productPathClassification.currentBundleRef', stringValue(classification.currentBundleRef));
  return issues;
}

function validateReplayEvidence(
  evidence: Record<string, unknown>,
  screenIds: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const replay = asRecord(evidence.replayBundle)
    ?? asRecord(evidence.replayManifest)
    ?? asRecord(evidence.visibleReplay);
  if (!replay) {
    return [{
      id: 'missing-action-causality',
      path: 'replayBundle',
      reason: 'Computer Use acceptance evidence must include a replay bundle/manifest with screen frames and cursor overlays.',
    }];
  }
  const frames = records(replay.frames);
  if (frames.length === 0) {
    return [{
      id: 'forbidden-placeholder-viewer',
      path: 'replayBundle.frames',
      reason: 'Replay bundle must include real screen frames; placeholder-only viewers cannot be completion evidence.',
    }];
  }
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const realFrameCount = frames.filter((frame) => frame.placeholder !== true && stringValue(frame.screenshotRef)).length;
  if (realFrameCount === 0) {
    issues.push({
      id: 'forbidden-placeholder-viewer',
      path: 'replayBundle.frames',
      reason: 'Replay bundle must include at least one non-placeholder screenshot frame.',
    });
  }
  for (const [index, frame] of frames.entries()) {
    const screenId = stringValue(frame.screenId);
    if (!screenId) {
      issues.push({
        id: 'missing-screen-identity',
        path: `replayBundle.frames[${index}].screenId`,
        reason: 'Every replay frame must carry screenId.',
      });
    } else if (screenIds.length > 0 && !screenIds.includes(screenId)) {
      issues.push({
        id: 'missing-screen-identity',
        path: `replayBundle.frames[${index}].screenId`,
        reason: `Replay frame screenId ${screenId} must match a declared screen.`,
      });
    }
    if (frame.placeholder === true && !stringValue(frame.screenshotRef)) {
      issues.push({
        id: 'forbidden-placeholder-viewer',
        path: `replayBundle.frames[${index}]`,
        reason: 'Placeholder replay frames without screenshotRef cannot be completion evidence.',
      });
    }
    requireCustomRefs(
      issues,
      'missing-action-causality',
      `replayBundle.frames[${index}].cursorOverlayRefs`,
      stringArray(frame.cursorOverlayRefs),
    );
  }
  const frameScreenIds = uniqueStrings(frames
    .filter((frame) => frame.placeholder !== true && stringValue(frame.screenshotRef))
    .map((frame) => stringValue(frame.screenId))
    .filter(isNonEmptyString));
  for (const screenId of screenIds) {
    if (!frameScreenIds.includes(screenId)) {
      issues.push({
        id: 'missing-action-causality',
        path: 'replayBundle.frames',
        reason: `Replay bundle must include a non-placeholder frame for declared screen ${screenId}.`,
      });
    }
  }
  requireRefs(issues, 'replayBundle.cursorOverlayRefs', stringArray(replay.cursorOverlayRefs));
  requireRefs(issues, 'replayBundle.leaseOwnerRefs', stringArray(replay.leaseOwnerRefs));
  requireRefs(issues, 'replayBundle.beforeEvidenceRefs', stringArray(replay.beforeEvidenceRefs));
  requireRefs(issues, 'replayBundle.afterEvidenceRefs', stringArray(replay.afterEvidenceRefs));
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
    case 'desktop-file-save':
      return [
        ...requireMarkerRefs(marker, 'target window ref', ['targetWindowRef', 'windowRef', 'targetWindowRefs']),
        ...requireMarkerRefs(marker, 'before screenshot ref', ['beforeScreenshotRef', 'beforeScreenshotRefs']),
        ...requireMarkerRefs(marker, 'before AX evidence ref', ['beforeAxRef', 'beforeAxRefs', 'beforeAccessibilityRef']),
        ...requireMarkerRefs(marker, 'GUI save command ref', ['guiSaveCommandRef', 'saveCommandRef', 'saveIntentRef']),
        ...requireMarkerRefs(marker, 'executor event ref', ['executorEventRef', 'executorEventRefs']),
        ...requireMarkerRefs(marker, 'after screenshot ref', ['afterScreenshotRef', 'afterScreenshotRefs']),
        ...requireMarkerRefs(marker, 'after AX evidence ref', ['afterAxRef', 'afterAxRefs', 'afterAccessibilityRef']),
        ...requireMarkerRef(marker, evidence, 'saved file artifact ref', ['artifactRef', 'fileArtifactRef', 'finalArtifactRef'], 'finalArtifactRef'),
        ...requireMarkerRef(marker, evidence, 'artifact validation ref', ['artifactValidationRef', 'fileValidationRef'], 'artifactValidationRef'),
        ...requireDesktopFileSaveCausality(marker),
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

function requireDesktopFileSaveCausality(marker: Record<string, unknown>): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const owner = stringValue(marker.fileCreationOwner) ?? stringValue(marker.creationOwner) ?? stringValue(marker.artifactCreationOwner);
  if (owner !== 'scoped-gui-save' && owner !== 'native-gui-save') {
    issues.push({
      id: 'invalid-task-marker',
      path: 'fileCreationOwner',
      reason: 'desktop-file-save marker must prove a scoped/native GUI save owner; workspace-file-writer-assisted or shell writes cannot satisfy Evolve T1.',
    });
  }
  if (marker.sharedSystemInputUsed === true || stringValue(marker.inputOwnership)?.match(/shared-system|system mouse|system keyboard/i)) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'sharedSystemInputUsed',
      reason: 'desktop-file-save marker must not use shared system input; it must be scoped to the target desktop session.',
    });
  }
  if (marker.shellDirectArtifactWrite === true || marker.directShellArtifactWrite === true) {
    issues.push({
      id: 'invalid-task-marker',
      path: 'shellDirectArtifactWrite',
      reason: 'desktop-file-save marker must not use shell/direct file writes as the artifact creation path.',
    });
  }
  return issues;
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

function requireCustomRef(
  issues: CuNextLiveAcceptanceIssue[],
  id: string,
  path: string,
  ref: string | undefined,
): void {
  if (ref) return;
  issues.push({
    id,
    path,
    reason: `${path} is required.`,
  });
}

function requireCustomRefs(
  issues: CuNextLiveAcceptanceIssue[],
  id: string,
  path: string,
  refs: string[],
): void {
  if (refs.length > 0) return;
  issues.push({
    id,
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

function isAllowedDomAxObservationHintClaim(claim: Record<string, unknown>): boolean {
  const kind = String(claim.kind ?? '').toLowerCase();
  if (!domAxHintClaimKinds.has(kind)) return false;
  const use = normalizeToken(
    stringValue(claim.observationUse)
      ?? stringValue(claim.evidenceUse)
      ?? stringValue(claim.use)
      ?? '',
  );
  const refs = refsFromClaim(claim);
  return (use === 'observe-before-mutate-hint' || use === 'grounding-hint')
    && refs.length > 0
    && refs.every(isEvidenceBundleLocalFileRef)
    && !hasDomAxSubstituteFlag(claim);
}

function hasDomAxSubstituteFlag(value: Record<string, unknown>): boolean {
  const substituteFlagKeys = new Set([
    'executorLeaseSubstitute',
    'guiActionSubstitute',
    'artifactValidationSubstitute',
    'artifactCausalitySubstitute',
    'completionEvidence',
    'completionEvidenceEligible',
    'completionEvidenceSubstitute',
    'completionSubstitute',
    'finalArtifactSubstitute',
    'userLevelCompletionSubstitute',
  ]);
  return findRecordValue(value, (key, child) => (
    substituteFlagKeys.has(key)
    && child === true
  ));
}

function refsFromKeys(record: Record<string, unknown>, keys: readonly string[]): string[] {
  return uniqueStrings(keys.flatMap((key) => {
    const value = record[key];
    if (isNonEmptyString(value)) return [value];
    if (Array.isArray(value)) return value.filter(isNonEmptyString);
    return [];
  }));
}

function freshnessRecordRefs(record: Record<string, unknown>): string[] {
  const refs: string[] = [];
  const collect = (value: unknown, seen = new Set<unknown>()) => {
    if (!value || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) collect(item, seen);
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      if (/ref$/i.test(childKey) && isNonEmptyString(childValue)) refs.push(childValue);
      if (/refs$/i.test(childKey) && Array.isArray(childValue)) refs.push(...childValue.filter(isNonEmptyString));
      collect(childValue, seen);
    }
  };
  collect(record);
  return uniqueStrings(refs);
}

function timestampMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
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

function containsForbiddenLegacyBackendMarker(values: Array<string | undefined>): boolean {
  return values.some((value) => value !== undefined && forbiddenLegacyBackendPattern.test(value));
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

function validateActorCursorEvents(
  evidence: Record<string, unknown>,
  cursorRecords: readonly Record<string, unknown>[],
  screenIds: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const events = [
    ...records(evidence.cursorEvents),
    ...records(evidence.actorCursorEvents),
    ...records(asRecord(evidence.virtualDesktopSession)?.cursorEvents),
  ];
  const eventTypes = new Set(events.map((event) => normalizeToken(
    stringValue(event.eventType) ?? stringValue(event.kind) ?? stringValue(event.type) ?? '',
  )));
  for (const required of ['move', 'point', 'annotate']) {
    if (!eventTypes.has(required)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: 'cursorEvents',
        reason: `Actor cursor event log must include read-only ${required} events.`,
      });
    }
  }
  const knownPairs = new Set(cursorRecords.flatMap((cursor) => {
    const actorId = stringValue(cursor.actorId);
    const cursorId = stringValue(cursor.cursorId);
    return actorId && cursorId ? [`${actorId}::${cursorId}`] : [];
  }));
  for (const [index, event] of events.entries()) {
    const eventType = normalizeToken(stringValue(event.eventType) ?? stringValue(event.kind) ?? stringValue(event.type) ?? '');
    if (!['move', 'point', 'annotate'].includes(eventType)) continue;
    const actorId = stringValue(event.actorId);
    const cursorId = stringValue(event.cursorId);
    const screenId = stringValue(event.screenId);
    if (!actorId || !cursorId || !screenId) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}]`,
        reason: 'Read-only actor cursor events must include actorId, cursorId, and screenId.',
      });
    }
    if (actorId && cursorId && knownPairs.size > 0 && !knownPairs.has(`${actorId}::${cursorId}`)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}]`,
        reason: 'Read-only actor cursor events must match declared actor/cursor provenance.',
      });
    }
    if (screenId && screenIds.length > 0 && !screenIds.includes(screenId)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}].screenId`,
        reason: `Read-only actor cursor event screenId ${screenId} must match a declared screen.`,
      });
    }
    if (!firstString(event, ['cursorEventLogRef', 'actorCursorLogRef', 'ref', 'eventRef'])) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}].cursorEventLogRef`,
        reason: 'Read-only actor cursor events must bind a cursor event log ref.',
      });
    }
    if (event.readOnlyCursorEvent !== true || event.mutatingGuiAction === true || stringValue(event.executorEventRef)) {
      issues.push({
        id: 'missing-actor-cursor-provenance',
        path: `cursorEvents[${index}]`,
        reason: 'move/point/annotate actor cursor events must be read-only and must not project into executor events.',
      });
    }
  }
  return issues;
}

function validateNativeQueueBindings(
  queueRecords: readonly Record<string, unknown>[],
  screenIds: readonly string[],
  actorCursorPairs: readonly string[],
): CuNextLiveAcceptanceIssue[] {
  const issues: CuNextLiveAcceptanceIssue[] = [];
  const pairSet = new Set(actorCursorPairs);
  for (const [index, record] of queueRecords.entries()) {
    const kind = leaseKindFromRecord(record);
    if (!kind) continue;
    const scope = asRecord(record.leaseScope)
      ?? asRecord(record.scope)
      ?? asRecord(record.proposalScope)
      ?? asRecord(record.queueScope)
      ?? {};
    const screenId = stringValue(record.screenId) ?? stringValue(scope.screenId);
    if (!screenId || (screenIds.length > 0 && !screenIds.includes(screenId))) {
      issues.push({
        id: 'missing-native-queue-semantics',
        path: `queueRecords[${index}].screenId`,
        reason: 'Native queue/proposal records must bind a declared screenId.',
      });
    }
    if (kind === 'window-local' && stringValue(record.proposalId) && !(stringValue(record.windowId) ?? stringValue(scope.windowId))) {
      issues.push({
        id: 'missing-native-queue-semantics',
        path: `queueRecords[${index}].windowId`,
        reason: 'window-local queue/proposal records must bind windowId.',
      });
    }
    if (stringValue(record.proposalId)) {
      const actorId = stringValue(record.actorId);
      const cursorId = stringValue(record.cursorId);
      if (!actorId || !cursorId || (pairSet.size > 0 && !pairSet.has(`${actorId}::${cursorId}`))) {
        issues.push({
          id: 'missing-native-queue-semantics',
          path: `queueRecords[${index}]`,
          reason: 'Action proposals must bind declared actorId/cursorId provenance.',
        });
      }
      if (!firstString(record, ['proposalRef', 'evidenceRef', 'recordRef'])) {
        issues.push({
          id: 'missing-native-queue-semantics',
          path: `queueRecords[${index}].proposalRef`,
          reason: 'Action proposals must include a proposal/evidence ref.',
        });
      }
    }
    if (stringValue(record.queueId) && stringArray(record.leaseOwnerRefs).length === 0) {
      issues.push({
        id: 'missing-native-queue-semantics',
        path: `queueRecords[${index}].leaseOwnerRefs`,
        reason: 'Executor queue records must include leaseOwnerRefs.',
      });
    }
  }
  return issues;
}

function computerUseScreenRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  const screens = [
    ...records(evidence.screens),
    ...records(evidence.virtualScreens),
    ...records(asRecord(evidence.virtualDisplayGroup)?.screens),
    ...records(asRecord(evidence.virtualDesktopSession)?.screens),
  ];
  const visibleScreenRefs = stringArray(evidence.visibleScreenRefs);
  if (visibleScreenRefs.length > 0) {
    screens.push(...visibleScreenRefs.map((ref, index) => ({
      screenId: stringArray(evidence.screenIds)[index] ?? stringValue(evidence.screenId),
      ref,
    })));
  }
  return screens;
}

function computerUseCursorRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return [
    ...records(evidence.actorCursorProvenance),
    ...records(evidence.actorCursors),
    ...records(evidence.visibleCursorRefs).map((cursorRef, index) => ({
      actorId: stringArray(evidence.actorIds)[index] ?? stringValue(evidence.actorId),
      cursorId: stringArray(evidence.cursorIds)[index] ?? stringValue(evidence.cursorId),
      screenId: stringArray(evidence.screenIds)[index] ?? stringValue(evidence.screenId),
      ref: stringValue(cursorRef.ref) ?? String(cursorRef),
    })),
    ...records(asRecord(evidence.virtualDesktopSession)?.actorCursors),
  ];
}

function computerUseMutatingActionRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return [
    ...records(evidence.mutatingActions),
    ...records(evidence.actionCausality),
    ...records(evidence.executorEvents),
    ...records(evidence.inputEvents).filter((event) => isMutatingActionKind(stringValue(event.kind) ?? stringValue(event.actionKind))),
  ].filter((action) => {
    const kind = stringValue(action.kind) ?? stringValue(action.actionKind) ?? stringValue(asRecord(action.action)?.kind);
    return !kind || isMutatingActionKind(kind);
  });
}

function computerUseActionRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  return [
    ...computerUseMutatingActionRecords(evidence),
    ...records(evidence.evidenceLedgerActions),
    ...records(asRecord(evidence.evidenceLedger)?.actions),
    ...records(asRecord(evidence.evidenceLedger)?.actionRecords),
  ];
}

function hasIndependentEvidenceLedgerRecords(
  evidence: Record<string, unknown>,
  actionLedgerRef: string | undefined,
): boolean {
  const ledger = asRecord(evidence.evidenceLedger) ?? asRecord(evidence.actionLedger);
  const ledgerActions = [
    ...records(ledger?.actions),
    ...records(ledger?.actionRecords),
    ...records(ledger?.mutatingActions),
    ...records(ledger?.entries),
    ...records(ledger?.records),
    ...records(evidence.evidenceLedgerActions),
  ];
  const ledgerRefs = uniqueStrings([
    stringValue(ledger?.ref),
    stringValue(ledger?.actionLedgerRef),
    ...stringArray(ledger?.refs),
    ...stringArray(ledger?.evidenceRefs),
    ...stringArray(ledger?.actionCausalityRefs),
  ].filter(isNonEmptyString));
  const hasLedgerAction = ledgerActions.some((action) => (
    Boolean(firstString(action, ['executorEventRef', 'executeEventRef', 'eventRef', 'ref']))
    && (
      stringArray(action.beforeEvidenceRefs).length > 0
      || stringArray(action.afterEvidenceRefs).length > 0
      || stringArray(action.verificationRefs).length > 0
      || stringArray(action.artifactRefs).length > 0
    )
  ));
  return hasLedgerAction
    && (!actionLedgerRef || ledgerRefs.includes(actionLedgerRef) || stringValue(ledger?.ref) === actionLedgerRef);
}

function computerUseQueueRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  const recordsFromTopLevel = [
    ...records(evidence.actionProposals),
    ...records(evidence.proposals),
    ...records(evidence.executorQueue),
    ...records(evidence.leaseQueue),
    ...records(evidence.schedulerQueue),
    ...records(evidence.executorLeases),
    ...records(evidence.leases),
    ...computerUseMutatingActionRecords(evidence),
  ];
  const executorLease = asRecord(evidence.executorLease);
  return executorLease ? [executorLease, ...recordsFromTopLevel] : recordsFromTopLevel;
}

function leaseKindFromRecord(record: Record<string, unknown>): 'window-local' | 'screen-global' | undefined {
  const scope = asRecord(record.leaseScope)
    ?? asRecord(record.scope)
    ?? asRecord(record.proposalScope)
    ?? asRecord(record.queueScope);
  const candidates = [
    stringValue(record.leaseKind),
    stringValue(record.queueKind),
    stringValue(record.kind),
    stringValue(record.scope),
    stringValue(scope?.kind),
    stringValue(scope?.scope),
  ].filter(isNonEmptyString).map(normalizeToken);
  if (candidates.some((candidate) => candidate === 'window-local' || candidate === 'window')) return 'window-local';
  if (candidates.some((candidate) => candidate === 'screen-global' || candidate === 'screen')) return 'screen-global';
  return undefined;
}

function browserRuntimeObservationRecords(evidence: Record<string, unknown>): Array<Record<string, unknown>> {
  const recordsFromArrays = [
    ...records(evidence.browserRuntimeDomAxObservations),
    ...records(evidence.browserRuntimeObservationHints),
    ...records(evidence.domAxObservationHints),
  ];
  return [
    asRecord(evidence.browserRuntimeDomAxObservation),
    asRecord(evidence.browserRuntimeObservation),
    asRecord(evidence.browserRuntimeObservationHint),
    asRecord(evidence.domAxObservation),
    ...recordsFromArrays,
  ].filter((item): item is Record<string, unknown> => Boolean(item));
}

function browserRuntimeObservationRefs(observation: Record<string, unknown>): string[] {
  return refsFromKeys(observation, [
    'ref',
    'observationRef',
    'visibleDomRef',
    'accessibilitySnapshotRef',
    'playwrightEvaluateRef',
    'pageQueryRef',
    'stableRef',
    'stableRefs',
    'stableElementRefs',
    'groundingHintRef',
    'groundingHintRefs',
  ]);
}

function browserRuntimeRefsBoundToActions(evidence: Record<string, unknown>): string[] {
  const observeBeforeMutate = asRecord(evidence.observeBeforeMutate);
  return [
    ...refsFromKeys(observeBeforeMutate ?? {}, [
      'browserRuntimeObservationRef',
      'browserRuntimeVisibleDomRef',
      'browserRuntimeAccessibilitySnapshotRef',
      'browserRuntimePlaywrightEvaluateRef',
      'browserRuntimePageQueryRef',
      'browserRuntimeStableRef',
      'browserRuntimeStableRefs',
      'browserRuntimeGroundingHintRef',
      'browserRuntimeGroundingHintRefs',
      'beforeEvidenceRefs',
      'groundingRefs',
    ]),
    ...computerUseMutatingActionRecords(evidence).flatMap((action) => refsFromKeys(action, [
      'beforeEvidenceRefs',
      'groundingRefs',
      'browserRuntimeObservationRef',
      'browserRuntimeGroundingHintRef',
      'browserRuntimeGroundingHintRefs',
    ])),
  ];
}

function isMutatingActionKind(kind: string | undefined): boolean {
  if (!kind) return true;
  return !new Set(['observe', 'capture', 'crop', 'ocr', 'vlm_describe', 'cursor_move', 'move_cursor', 'point', 'annotate', 'proposal']).has(normalizeToken(kind));
}

function isBareGlobalCoordinateAction(action: Record<string, unknown>): boolean {
  const target = asRecord(action.target) ?? action;
  const coordinateSpace = stringValue(target.coordinateSpace) ?? stringValue(target.coordinate_space);
  const hasGlobalCoordinateSpace = coordinateSpace ? /^(global|system|desktop)$/i.test(coordinateSpace) : false;
  const hasXy = typeof target.x === 'number' && typeof target.y === 'number';
  const hasScopedBinding = Boolean(
    target.screenId
    || target.windowId
    || target.elementRef
    || target.regionRef
    || target.bounds
    || target.targetRef
  );
  return hasGlobalCoordinateSpace || (hasXy && !hasScopedBinding);
}

function isForbiddenCrossBundleEvidenceRef(value: string): boolean {
  const trimmed = value.trim();
  if (!/\.(json|png|jpe?g|webp|txt|md|pptx|docx|csv|html)$/i.test(trimmed)) return false;
  if (trimmed.startsWith('../') || trimmed.includes('/../')) return true;
  if (trimmed.startsWith('/') || trimmed.startsWith('~')) return true;
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !trimmed.startsWith('approval:');
}

function collectAllEvidenceFileRefs(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' && isPotentialEvidenceFileRef(value) && isEvidenceBundleLocalFileRef(value) ? [value] : [];
  }
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => collectAllEvidenceFileRefs(item, seen)));
  }
  return uniqueStrings(Object.values(value).flatMap((item) => collectAllEvidenceFileRefs(item, seen)));
}

function isPotentialEvidenceFileRef(value: string): boolean {
  return /\/|\.json$|\.png$|\.jpe?g$|\.webp$|\.txt$|\.md$|\.pptx$|\.docx$|\.csv$|\.html$|\.xlsx$/i.test(value.trim());
}

function currentBundleRootFromRef(ref: string): string {
  const normalized = ref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  if (!normalized || normalized === '.') return '.';
  if (/\.[a-z0-9][a-z0-9-]{0,15}$/i.test(normalized.split('/').at(-1) ?? '')) {
    return normalized.split('/').slice(0, -1).join('/') || '.';
  }
  return normalized;
}

function isEvidenceRefInCurrentBundle(ref: string, bundleRoot: string): boolean {
  if (!isEvidenceBundleLocalFileRef(ref)) return false;
  const normalizedRef = ref.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
  const normalizedRoot = bundleRoot.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '') || '.';
  if (normalizedRoot === '.') {
    return !normalizedRef.startsWith('.sciforge/vision-runs/');
  }
  return normalizedRef === normalizedRoot || normalizedRef.startsWith(`${normalizedRoot}/`);
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
