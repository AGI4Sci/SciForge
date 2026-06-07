import type { ComputerUseActionRisk, ComputerUseAtomicAction } from './index.js';

export const VSCODE_COWORK_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.computer-use.vscode-cowork-acceptance.v1' as const;
export const VSCODE_COWORK_LIVE_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.computer-use.vscode-cowork-live-acceptance.v1' as const;
const VSCODE_COWORK_REQUIRED_PRIMITIVE_CHAIN = ['bind', 'observe', 'act', 'observe', 'control(release)'] as const;

export const VSCODE_COWORK_ACCEPTANCE_CAPABILITY = {
  schemaVersion: VSCODE_COWORK_ACCEPTANCE_SCHEMA_VERSION,
  maturity: 'live-diagnostic',
  productReady: false,
  userProfileUsed: true,
  sharedSystemInputUsed: true,
  primitiveChainRequired: 'bind -> observe -> act -> observe -> control(release)',
  hostOwns: [
    'task-understanding',
    'target-choice',
    'next-primitive-choice-from-observe-refs',
    'approval-collection',
    'completion-truth',
    'final-answer',
  ],
  computerUseCoreOwns: [
    'primitive-contract',
    'target-bound-observation-refs',
    'host-specified-atomic-action-execution',
    'release-control-refs',
  ],
  cleanup: {
    required: true,
    asserts: [
      'input-lease-cursor-adapter-released',
      'front-app-restored',
      'mouse-position-restored',
      'user-vscode-process-not-killed',
      'user-profile-not-cleared',
    ],
  },
} as const;

export type VSCodeCoWorkOperation =
  | 'focus-editor'
  | 'read-visible-text'
  | 'insert-draft'
  | 'save-current-file'
  | 'bulk-replace'
  | 'cross-file-modify'
  | 'undo-last-action';

export interface VSCodeCoWorkWindowCandidate {
  appRef: string;
  processRef?: string;
  windowRef: string;
  titleRef?: string;
  frontmostRef?: string;
  visibleFileRefs?: string[];
}

export interface VSCodeCoWorkObservationRefs {
  windowRef: string;
  observationRef: string;
  screenshotRef: string;
  accessibilityRef: string;
  textRefs: string[];
  elementRefs: string[];
  freshnessRef: string;
  stale?: boolean;
  editorVisible?: boolean;
  visibleFileRefs?: string[];
  userFile?: boolean;
}

export interface VSCodeCoWorkDecisionInput {
  requestRef: string;
  operation: VSCodeCoWorkOperation;
  windowCandidates: VSCodeCoWorkWindowCandidate[];
  selectedWindowRef?: string;
  selectedFileRef?: string;
  latestObservation?: VSCodeCoWorkObservationRefs;
  draftTextRef?: string;
  riskActionHash?: string;
  confirmationRef?: string;
}

export interface VSCodeCoWorkDecision {
  schemaVersion: typeof VSCODE_COWORK_ACCEPTANCE_SCHEMA_VERSION;
  status: 'ready' | 'needs-confirmation' | 'blocked';
  maturity: 'live-diagnostic';
  productReady: false;
  userProfileUsed: true;
  targetWindowRef?: string;
  primitive?: 'observe' | 'act';
  action?: ComputerUseAtomicAction;
  risk?: ComputerUseActionRisk;
  approvalRef?: string;
  refs: string[];
  blockedReason?: string;
  confirmation?: {
    reason: string;
    candidateWindowRefs?: string[];
    candidateFileRefs?: string[];
    riskActionHash?: string;
    approvalScope?: string;
  };
  repairHints: Array<{
    code: string;
    message: string;
    suggestedPrimitive?: 'bind' | 'observe' | 'act' | 'control';
  }>;
}

export interface VSCodeCoWorkCleanupManifest {
  maturity: string;
  productReady: boolean;
  userProfileUsed: boolean;
  sharedSystemInputUsed: boolean;
  evidence: {
    releaseRefs: string[];
    restorationRefs: string[];
  };
  cleanup: {
    inputLeaseReleased: boolean;
    cursorReleased: boolean;
    adapterReleased: boolean;
    frontAppRestored: boolean;
    mousePositionRestored: boolean;
    userVSCodeProcessKilled: boolean;
    userProfileCleared: boolean;
  };
}

export interface VSCodeCoWorkCleanupValidation {
  ok: boolean;
  issues: string[];
}

export interface VSCodeCoWorkLiveAcceptanceManifest {
  schemaVersion: typeof VSCODE_COWORK_LIVE_ACCEPTANCE_SCHEMA_VERSION;
  status: 'passed' | 'blocked' | 'needs-confirmation';
  maturity: string;
  productReady: boolean;
  userProfileUsed: boolean;
  sharedSystemInputUsed: boolean;
  primitiveChainObserved: string[];
  operation: VSCodeCoWorkOperation;
  target: {
    windowRef: string;
    selectedFileRef?: string;
  };
  evidence: {
    bindRefs: string[];
    beforeObservationRefs: string[];
    hostDecisionRefs: string[];
    actionRefs: string[];
    afterObservationRefs: string[];
    controlRefs: string[];
    screenshotRefs: string[];
    accessibilityRefs: string[];
    textRefs: string[];
    approvalRefs: string[];
    releaseRefs: string[];
    restorationRefs: string[];
  };
  cleanup: VSCodeCoWorkCleanupManifest['cleanup'];
}

export function decideVSCodeCoWorkNextPrimitive(input: VSCodeCoWorkDecisionInput): VSCodeCoWorkDecision {
  const requestRefs = uniqueStrings([input.requestRef]);
  const candidateRefs = input.windowCandidates.map((candidate) => candidate.windowRef).filter(nonEmptyString);

  if (candidateRefs.length === 0) {
    return blocked(input, 'vscode_cowork_no_window_candidates', requestRefs, [{
      code: 'ask-user-to-open-or-select-vscode-window',
      message: 'No current VSCode window refs were available. Ask the user to open or select the target window before binding.',
      suggestedPrimitive: 'bind',
    }]);
  }

  if (!input.selectedWindowRef && candidateRefs.length > 1) {
    return {
      ...decisionBase('needs-confirmation', uniqueStrings([...requestRefs, ...candidateRefs])),
      blockedReason: 'vscode_cowork_target_window_needs_confirmation',
      confirmation: {
        reason: 'Multiple VSCode window refs match this co-work request; Host must ask the user which one to bind.',
        candidateWindowRefs: candidateRefs,
        approvalScope: 'target-window',
      },
      repairHints: [{
        code: 'confirm-target-window',
        message: 'Collect a user-selected windowRef, then call bind/observe for that exact target.',
        suggestedPrimitive: 'bind',
      }],
    };
  }

  const targetWindowRef = input.selectedWindowRef ?? candidateRefs[0];
  const targetWindow = input.windowCandidates.find((candidate) => candidate.windowRef === targetWindowRef);
  if (!targetWindow || !targetWindowRef) {
    return blocked(input, 'vscode_cowork_selected_window_not_found', uniqueStrings([...requestRefs, ...candidateRefs]), [{
      code: 'refresh-window-candidates',
      message: 'The selected VSCode windowRef is not in the current candidate set. Refresh candidates and ask again if needed.',
      suggestedPrimitive: 'bind',
    }]);
  }

  const observationBlock = observationRefsBlock(input, targetWindowRef, targetWindow);
  if (observationBlock) return observationBlock;
  const observation = input.latestObservation as VSCodeCoWorkObservationRefs;

  const targetFileBlock = targetFileRefsBlock(input, targetWindow, observation);
  if (targetFileBlock) return targetFileBlock;

  const riskEnvelopeBlock = realFileChangeRiskEnvelopeBlock(input, targetWindow, observation);
  if (riskEnvelopeBlock) return riskEnvelopeBlock;

  if (realFileChangeNeedsConfirmation(input, observation)) {
    return {
      ...decisionBase('needs-confirmation', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef,
      blockedReason: 'vscode_cowork_real_file_change_needs_confirmation',
      confirmation: {
        reason: 'Saving, bulk replacement, or cross-file modification against a user file requires Host-collected confirmation.',
        riskActionHash: input.riskActionHash,
        approvalScope: input.operation,
      },
      repairHints: [{
        code: 'collect-real-file-change-confirmation',
        message: 'Show a preview or confirmation outside Computer Use, then retry the same Host-chosen primitive with a matching confirmationRef.',
        suggestedPrimitive: 'act',
      }],
    };
  }

  const action = actionForOperation(input, observation);
  if (!action) {
    return blocked(input, `vscode_cowork_unsupported_operation:${input.operation}`, refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'choose-supported-atomic-operation',
      message: 'Host must map the request to one supported atomic primitive at a time.',
      suggestedPrimitive: 'act',
    }]);
  }

  return {
    ...decisionBase('ready', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef,
    primitive: 'act',
    action,
    ...(realFileChangeOperation(input.operation) ? {
      risk: {
        level: 'high' as const,
        categories: ['user-real-file-change'],
        actionHash: input.riskActionHash,
      },
      approvalRef: input.confirmationRef,
    } : {}),
    repairHints: [],
  };
}

export function validateVSCodeCoWorkRunCleanup(manifest: VSCodeCoWorkCleanupManifest): VSCodeCoWorkCleanupValidation {
  const issues: string[] = [];
  const releaseRefs = manifest.evidence.releaseRefs;
  const restorationRefs = manifest.evidence.restorationRefs;

  if (manifest.maturity !== 'live-diagnostic') issues.push('vscode-cowork-capability-must-remain-live-diagnostic');
  if (manifest.productReady !== false) issues.push('vscode-cowork-must-not-claim-product-ready');
  if (!hasRefPrefix(releaseRefs, 'scoped-input-lease:')) issues.push('missing-release-ref:scoped-input-lease');
  if (!hasRefPrefix(releaseRefs, 'input-adapter:')) issues.push('missing-release-ref:input-adapter');
  if (!releaseRefs.some((ref) => ref.startsWith('cursor-marker:') || ref.startsWith('cursor:'))) issues.push('missing-release-ref:cursor-marker');
  if (!restorationRefs.some((ref) => /^front-app-restore:|^focus-restore:/i.test(ref))) issues.push('missing-restoration-ref:front-app');
  if (!restorationRefs.some((ref) => /^mouse-position-restore:|^cursor-position-restore:/i.test(ref))) issues.push('missing-restoration-ref:mouse-position');
  if (!manifest.cleanup.inputLeaseReleased) issues.push('cleanup-input-lease-not-released');
  if (!manifest.cleanup.cursorReleased) issues.push('cleanup-cursor-not-released');
  if (!manifest.cleanup.adapterReleased) issues.push('cleanup-adapter-not-released');
  if (!manifest.cleanup.frontAppRestored) issues.push('cleanup-front-app-not-restored');
  if (!manifest.cleanup.mousePositionRestored) issues.push('cleanup-mouse-position-not-restored');
  if (manifest.cleanup.userVSCodeProcessKilled) issues.push('cleanup-must-not-kill-user-vscode');
  if (manifest.cleanup.userProfileCleared) issues.push('cleanup-must-not-clear-user-profile');

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function validateVSCodeCoWorkLiveAcceptanceManifest(
  manifest: VSCodeCoWorkLiveAcceptanceManifest,
): VSCodeCoWorkCleanupValidation {
  const issues: string[] = [];
  const releaseRefs = manifest.evidence.releaseRefs;
  const restorationRefs = manifest.evidence.restorationRefs;

  if (manifest.schemaVersion !== VSCODE_COWORK_LIVE_ACCEPTANCE_SCHEMA_VERSION) issues.push('vscode-cowork-live-schema-version-mismatch');
  if (manifest.status !== 'passed') issues.push('vscode-cowork-live-acceptance-not-passed');
  if (manifest.maturity !== 'live-diagnostic') issues.push('vscode-cowork-capability-must-remain-live-diagnostic');
  if (manifest.productReady !== false) issues.push('vscode-cowork-must-not-claim-product-ready');
  if (!primitiveChainMatches(manifest.primitiveChainObserved)) issues.push('vscode-cowork-live-primitive-chain-incomplete');
  if (!nonEmptyString(manifest.target.windowRef)) issues.push('missing-target-ref:window');
  if (!manifest.evidence.bindRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:bind');
  if (!manifest.evidence.beforeObservationRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:before-observe');
  if (!manifest.evidence.hostDecisionRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:host-decision');
  if (!manifest.evidence.actionRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:act');
  if (!manifest.evidence.afterObservationRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:after-observe');
  if (!manifest.evidence.controlRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:control');
  if (!manifest.evidence.screenshotRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:screenshot');
  if (!manifest.evidence.accessibilityRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:accessibility');
  if (!manifest.evidence.textRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:text');
  if (!hasRefPrefix(releaseRefs, 'scoped-input-lease:')) issues.push('missing-release-ref:scoped-input-lease');
  if (!hasRefPrefix(releaseRefs, 'input-adapter:')) issues.push('missing-release-ref:input-adapter');
  if (!releaseRefs.some((ref) => ref.startsWith('cursor-marker:') || ref.startsWith('cursor:'))) issues.push('missing-release-ref:cursor-marker');
  if (!restorationRefs.some((ref) => /^front-app-restore:|^focus-restore:/i.test(ref))) issues.push('missing-restoration-ref:front-app');
  if (!restorationRefs.some((ref) => /^mouse-position-restore:|^cursor-position-restore:/i.test(ref))) issues.push('missing-restoration-ref:mouse-position');
  if (!manifest.cleanup.inputLeaseReleased) issues.push('cleanup-input-lease-not-released');
  if (!manifest.cleanup.cursorReleased) issues.push('cleanup-cursor-not-released');
  if (!manifest.cleanup.adapterReleased) issues.push('cleanup-adapter-not-released');
  if (!manifest.cleanup.frontAppRestored) issues.push('cleanup-front-app-not-restored');
  if (!manifest.cleanup.mousePositionRestored) issues.push('cleanup-mouse-position-not-restored');
  if (manifest.cleanup.userVSCodeProcessKilled) issues.push('cleanup-must-not-kill-user-vscode');
  if (manifest.cleanup.userProfileCleared) issues.push('cleanup-must-not-clear-user-profile');
  if (realFileChangeOperation(manifest.operation) && !manifest.evidence.approvalRefs.some((ref) => ref.startsWith('risk:'))) issues.push('missing-approval-ref:risk-action-hash');
  if (realFileChangeOperation(manifest.operation) && !manifest.evidence.approvalRefs.some((ref) => ref.startsWith('approval:'))) issues.push('missing-approval-ref:approval');
  issues.push(...unsafeEvidenceRefIssues(manifest.evidence));

  return {
    ok: issues.length === 0,
    issues,
  };
}

function observationRefsBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindowRef: string,
  targetWindow: VSCodeCoWorkWindowCandidate,
): VSCodeCoWorkDecision | undefined {
  const observation = input.latestObservation;
  const targetRefs = uniqueStrings([
    input.requestRef,
    targetWindow.windowRef,
    targetWindow.appRef,
    targetWindow.processRef,
    targetWindow.titleRef,
    targetWindow.frontmostRef,
    ...(targetWindow.visibleFileRefs ?? []),
  ]);
  if (!observation || observation.windowRef !== targetWindowRef || !hasCompleteObservationRefs(observation)) {
    return blocked(input, 'vscode_cowork_observe_refs_required', targetRefs, [{
      code: 'observe-selected-window',
      message: 'Host must call observe on the selected VSCode window and use current screenshot, AX, text, element, and freshness refs before choosing an action.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (observation.stale) {
    return blocked(input, 'vscode_cowork_observation_stale', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'refresh-observation',
      message: 'The latest VSCode observation is stale. Observe again before selecting the next atomic primitive.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (editorOperation(input.operation) && observation.editorVisible === false) {
    return blocked(input, 'vscode_cowork_editor_not_visible', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'make-editor-visible',
      message: 'The current observation does not show an editor area. Ask the user or choose another primitive without guessing.',
      suggestedPrimitive: 'observe',
    }]);
  }
  return undefined;
}

function targetFileRefsBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (!fileTargetOperation(input.operation)) return undefined;
  const candidateFileRefs = uniqueStrings([
    ...(targetWindow.visibleFileRefs ?? []),
    ...(observation.visibleFileRefs ?? []),
  ]);
  if (nonEmptyString(input.selectedFileRef) && candidateFileRefs.includes(input.selectedFileRef.trim())) return undefined;
  if (nonEmptyString(input.selectedFileRef)) {
    return blocked(input, 'vscode_cowork_selected_file_not_found', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'refresh-visible-file-refs',
      message: 'The selected fileRef is not visible in the current VSCode observation. Refresh observe refs and ask again if needed.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (candidateFileRefs.length <= 1) return undefined;
  return {
    ...decisionBase('needs-confirmation', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_target_file_needs_confirmation',
    confirmation: {
      reason: 'Multiple visible file refs match this VSCode co-work request; Host must ask the user which file to modify.',
      candidateFileRefs,
      approvalScope: 'target-file',
    },
    repairHints: [{
      code: 'confirm-target-file',
      message: 'Collect a user-selected fileRef from the current observation, then retry the same Host-chosen primitive.',
      suggestedPrimitive: 'act',
    }],
  };
}

function realFileChangeRiskEnvelopeBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (!realFileChangeOperation(input.operation)) return undefined;
  if (observation.userFile === false) return undefined;
  if (nonEmptyString(input.riskActionHash)) return undefined;
  return {
    ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_real_file_change_risk_hash_required',
    confirmation: {
      reason: 'Saving, bulk replacement, or cross-file modification against a user file requires a Host-computed riskActionHash before confirmation can authorize the action.',
      approvalScope: input.operation,
    },
    repairHints: [{
      code: 'provide-real-file-risk-action-hash',
      message: 'Compute a refs-first riskActionHash for the exact user-file mutation, collect confirmation bound to that hash, then retry the Host-chosen primitive.',
      suggestedPrimitive: 'act',
    }],
  };
}

function actionForOperation(
  input: VSCodeCoWorkDecisionInput,
  observation: VSCodeCoWorkObservationRefs,
): ComputerUseAtomicAction | undefined {
  const editorElementRef = observation.elementRefs.find((ref) => /editor/i.test(ref)) ?? observation.elementRefs[0];
  if (input.operation === 'focus-editor') {
    return {
      type: 'key',
      key: 'Command+1',
      elementRef: editorElementRef,
    };
  }
  if (input.operation === 'save-current-file') {
    return {
      type: 'app_command',
      command: 'save',
      elementRef: editorElementRef,
    };
  }
  if (input.operation === 'insert-draft' && nonEmptyString(input.draftTextRef)) {
    return {
      type: 'type',
      textRef: input.draftTextRef,
      elementRef: editorElementRef,
    };
  }
  if (input.operation === 'undo-last-action') {
    return {
      type: 'key',
      key: 'Command+Z',
      elementRef: editorElementRef,
    };
  }
  return undefined;
}

function realFileChangeNeedsConfirmation(
  input: VSCodeCoWorkDecisionInput,
  observation: VSCodeCoWorkObservationRefs,
): boolean {
  if (!realFileChangeOperation(input.operation)) return false;
  if (observation.userFile === false) return false;
  if (!nonEmptyString(input.confirmationRef)) return true;
  if (!nonEmptyString(input.riskActionHash)) return true;
  return !input.confirmationRef.includes(input.riskActionHash);
}

function realFileChangeOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation === 'save-current-file'
    || operation === 'bulk-replace'
    || operation === 'cross-file-modify';
}

function primitiveChainMatches(chain: string[]): boolean {
  return chain.length === VSCODE_COWORK_REQUIRED_PRIMITIVE_CHAIN.length
    && VSCODE_COWORK_REQUIRED_PRIMITIVE_CHAIN.every((item, index) => chain[index] === item);
}

function fileTargetOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation === 'insert-draft'
    || operation === 'save-current-file'
    || operation === 'bulk-replace'
    || operation === 'cross-file-modify'
    || operation === 'undo-last-action';
}

function hasCompleteObservationRefs(observation: VSCodeCoWorkObservationRefs): boolean {
  return nonEmptyString(observation.observationRef)
    && nonEmptyString(observation.screenshotRef)
    && nonEmptyString(observation.accessibilityRef)
    && nonEmptyString(observation.freshnessRef)
    && observation.textRefs.some(nonEmptyString)
    && observation.elementRefs.some(nonEmptyString);
}

function editorOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation !== 'read-visible-text';
}

function refsForTargetAndObservation(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): string[] {
  return uniqueStrings([
    input.requestRef,
    targetWindow.windowRef,
    targetWindow.appRef,
    targetWindow.processRef,
    targetWindow.titleRef,
    targetWindow.frontmostRef,
    input.selectedFileRef,
    input.riskActionHash,
    input.confirmationRef,
    ...(targetWindow.visibleFileRefs ?? []),
    observation.windowRef,
    observation.observationRef,
    observation.screenshotRef,
    observation.accessibilityRef,
    observation.freshnessRef,
    ...(observation.textRefs ?? []),
    ...(observation.elementRefs ?? []),
    ...(observation.visibleFileRefs ?? []),
  ]);
}

function blocked(
  input: VSCodeCoWorkDecisionInput,
  blockedReason: string,
  refs: string[],
  repairHints: VSCodeCoWorkDecision['repairHints'],
): VSCodeCoWorkDecision {
  return {
    ...decisionBase('blocked', uniqueStrings([input.requestRef, ...refs])),
    blockedReason,
    repairHints,
  };
}

function decisionBase(status: VSCodeCoWorkDecision['status'], refs: string[]): Pick<VSCodeCoWorkDecision, 'schemaVersion' | 'status' | 'maturity' | 'productReady' | 'userProfileUsed' | 'refs' | 'repairHints'> {
  return {
    schemaVersion: VSCODE_COWORK_ACCEPTANCE_SCHEMA_VERSION,
    status,
    maturity: 'live-diagnostic',
    productReady: false,
    userProfileUsed: true,
    refs: uniqueStrings(refs),
    repairHints: [],
  };
}

function hasRefPrefix(refs: string[], prefix: string): boolean {
  return refs.some((ref) => ref.startsWith(prefix));
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(nonEmptyString).map((value) => value.trim()))];
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function unsafeEvidenceRefIssues(evidence: VSCodeCoWorkLiveAcceptanceManifest['evidence']): string[] {
  const groups: Array<[string, string[]]> = [
    ['bind', evidence.bindRefs],
    ['before-observe', evidence.beforeObservationRefs],
    ['host-decision', evidence.hostDecisionRefs],
    ['act', evidence.actionRefs],
    ['after-observe', evidence.afterObservationRefs],
    ['control', evidence.controlRefs],
    ['screenshot', evidence.screenshotRefs],
    ['accessibility', evidence.accessibilityRefs],
    ['text', evidence.textRefs],
    ['approval', evidence.approvalRefs],
    ['release', evidence.releaseRefs],
    ['restoration', evidence.restorationRefs],
  ];

  return groups.flatMap(([label, refs]) => (
    refs.some(unsafeEvidenceRef) ? [`unsafe-evidence-ref:${label}`] : []
  ));
}

function unsafeEvidenceRef(value: string): boolean {
  return /(?:rawScreenshot|providerPayload|data:[^,\s]+;base64,|base64|secret|token|password|https?:\/\/)/i.test(value);
}
