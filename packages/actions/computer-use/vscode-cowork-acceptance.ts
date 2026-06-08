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
  | 'move-cursor'
  | 'insert-draft'
  | 'replace-selection'
  | 'save-current-file'
  | 'bulk-replace'
  | 'cross-file-modify'
  | 'undo-last-action';

const SUPPORTED_VSCODE_COWORK_OPERATIONS = new Set<string>([
  'focus-editor',
  'read-visible-text',
  'move-cursor',
  'insert-draft',
  'replace-selection',
  'save-current-file',
  'bulk-replace',
  'cross-file-modify',
  'undo-last-action',
]);

export interface VSCodeCoWorkWindowCandidate {
  appRef: string;
  processRef?: string;
  windowRef: string;
  titleRef?: string;
  frontmostRef?: string;
  visibleFileRefs?: string[];
  invalidVisibleFileRefCount?: number;
}

export interface VSCodeCoWorkObservationRefs {
  windowRef: string;
  sessionRef?: string;
  observationRef: string;
  screenshotRef: string;
  accessibilityRef: string;
  textRefs: string[];
  elementRefs: string[];
  freshnessRef: string;
  stale?: boolean;
  editorVisible?: boolean;
  visibleFileRefs?: string[];
  invalidObservationRefCount?: number;
  invalidVisibleFileRefCount?: number;
  userFile?: boolean;
  nonUserFileScopeRef?: string;
}

export interface VSCodeCoWorkDecisionInput {
  requestRef: string;
  operation: VSCodeCoWorkOperation;
  windowCandidates: VSCodeCoWorkWindowCandidate[];
  invalidWindowCandidateCount?: number;
  invalidSelectedWindowRef?: boolean;
  invalidSelectedFileRef?: boolean;
  selectedWindowRef?: string;
  selectedFileRef?: string;
  latestObservation?: VSCodeCoWorkObservationRefs;
  cursorMoveRef?: string;
  selectionRef?: string;
  replacementTextRef?: string;
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
  const requestRefs = uniqueStrings([requestRef(input.requestRef) ? input.requestRef : undefined]);
  const validWindowCandidates = input.windowCandidates.filter(windowCandidateRefSafe);
  const candidateRefs = validWindowCandidates.map((candidate) => candidate.windowRef).filter(windowRef);
  const invalidWindowCandidateCount = input.invalidWindowCandidateCount
    ?? input.windowCandidates.length - validWindowCandidates.length;

  if (candidateRefs.length === 0) {
    return blocked(input, 'vscode_cowork_no_window_candidates', requestRefs, [{
      code: 'ask-user-to-open-or-select-vscode-window',
      message: 'No current VSCode window refs were available. Ask the user to open or select the target window before binding.',
      suggestedPrimitive: 'bind',
    }]);
  }

  if (invalidWindowCandidateCount > 0) {
    return blocked(input, 'vscode_cowork_window_candidate_refs_invalid', uniqueStrings([...requestRefs, ...candidateRefs]), [{
      code: 'refresh-window-candidate-refs',
      message: 'Host must provide refs-first window/app/process/title/frontmost refs for every VSCode window candidate before selecting a target.',
      suggestedPrimitive: 'bind',
    }]);
  }

  const missingWindowIdentityRefs = validWindowCandidates.filter((candidate) => !windowCandidateIdentityRefsComplete(candidate));
  if (missingWindowIdentityRefs.length > 0) {
    return blocked(input, 'vscode_cowork_window_candidate_identity_refs_required', uniqueStrings([
      ...requestRefs,
      ...windowCandidateRefs(validWindowCandidates),
    ]), [{
      code: 'refresh-window-bind-identity-refs',
      message: 'Host must bind each current VSCode window candidate with app, process, title, and frontmost refs before selecting a target.',
      suggestedPrimitive: 'bind',
    }]);
  }

  if (!supportedVSCodeCoWorkOperation(input.operation)) {
    return blocked(input, 'vscode_cowork_operation_required', uniqueStrings([...requestRefs, ...windowCandidateRefs(validWindowCandidates)]), [{
      code: 'provide-host-selected-vscode-operation',
      message: 'Host must choose one supported VSCode co-work operation from current observe refs before Computer Use primitive execution.',
      suggestedPrimitive: 'observe',
    }]);
  }

  if (input.invalidSelectedWindowRef || (nonEmptyString(input.selectedWindowRef) && !windowRef(input.selectedWindowRef))) {
    return blocked(input, 'vscode_cowork_selected_window_ref_invalid', uniqueStrings([...requestRefs, ...candidateRefs]), [{
      code: 'provide-selected-window-ref',
      message: 'The selected VSCode target must be a refs-first windowRef from the current candidate set; raw window titles must not be ignored or guessed.',
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
  const targetWindow = validWindowCandidates.find((candidate) => candidate.windowRef === targetWindowRef);
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

  const cursorMoveRefBlock = cursorMoveRefRequiredBlock(input, targetWindow, observation);
  if (cursorMoveRefBlock) return cursorMoveRefBlock;

  const selectionReplacementRefBlock = selectionReplacementRefsRequiredBlock(input, targetWindow, observation);
  if (selectionReplacementRefBlock) return selectionReplacementRefBlock;

  const draftTextRefBlock = draftTextRefRequiredBlock(input, targetWindow, observation);
  if (draftTextRefBlock) return draftTextRefBlock;

  const nonUserFileScopeRefBlock = nonUserFileScopeRefRequiredBlock(input, targetWindow, observation);
  if (nonUserFileScopeRefBlock) return nonUserFileScopeRefBlock;

  const riskEnvelopeBlock = realFileChangeRiskEnvelopeBlock(input, targetWindow, observation);
  if (riskEnvelopeBlock) return riskEnvelopeBlock;

  if (realFileChangeNeedsConfirmation(input, targetWindow, observation)) {
    return {
      ...decisionBase('needs-confirmation', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef,
      blockedReason: 'vscode_cowork_real_file_change_needs_confirmation',
      confirmation: {
        reason: 'Replacing selected text, saving, undoing, bulk replacement, or cross-file modification against a user file requires Host-collected confirmation.',
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

  const nonAtomicFileChangeBlock = nonAtomicFileChangeOperationBlock(input, targetWindow, observation);
  if (nonAtomicFileChangeBlock) return nonAtomicFileChangeBlock;

  if (input.operation === 'read-visible-text') {
    return {
      ...decisionBase('ready', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef,
      primitive: 'observe',
      repairHints: [],
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
    ...(userRealFileChangeOperation(input, observation) ? {
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
  if (manifest.userProfileUsed !== true) issues.push('vscode-cowork-user-profile-must-be-marked-used');
  if (manifest.sharedSystemInputUsed !== true) issues.push('vscode-cowork-shared-system-input-impact-required');
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
  issues.push(...unsafeCleanupEvidenceRefIssues(manifest.evidence));

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
  if (manifest.userProfileUsed !== true) issues.push('vscode-cowork-user-profile-must-be-marked-used');
  if (manifest.sharedSystemInputUsed !== true) issues.push('vscode-cowork-shared-system-input-impact-required');
  if (!primitiveChainMatches(manifest.primitiveChainObserved)) issues.push('vscode-cowork-live-primitive-chain-incomplete');
  if (!nonEmptyString(manifest.target.windowRef)) {
    issues.push('missing-target-ref:window');
  } else if (!windowRef(manifest.target.windowRef)) {
    issues.push('invalid-target-ref:window');
  }
  if (fileTargetOperation(manifest.operation)) {
    if (!nonEmptyString(manifest.target.selectedFileRef)) {
      issues.push('missing-target-ref:file');
    } else if (!fileRef(manifest.target.selectedFileRef)) {
      issues.push('invalid-target-ref:file');
    }
  }
  if (!manifest.evidence.bindRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:bind');
  if (!manifest.evidence.bindRefs.some(sessionRef)) issues.push('missing-bind-ref:session');
  if (!manifest.evidence.bindRefs.some((ref) => ref.trim() === manifest.target.windowRef.trim())) issues.push('missing-bind-ref:target-window');
  if (!manifest.evidence.bindRefs.some(appRef)) issues.push('missing-bind-ref:app');
  if (!manifest.evidence.bindRefs.some(processRef)) issues.push('missing-bind-ref:process');
  if (!manifest.evidence.bindRefs.some(frontmostRef)) issues.push('missing-bind-ref:frontmost');
  if (!manifest.evidence.bindRefs.some(scopedInputLeaseRef)) issues.push('missing-bind-ref:scoped-input-lease');
  if (!manifest.evidence.bindRefs.some(inputAdapterRef)) issues.push('missing-bind-ref:input-adapter');
  if (!manifest.evidence.bindRefs.some(cursorMarkerRef)) issues.push('missing-bind-ref:cursor-marker');
  if (releaseRefs.some(scopedInputLeaseRef) && !refsContainBoundRef(manifest.evidence.bindRefs, releaseRefs, scopedInputLeaseRef)) {
    issues.push('missing-bind-release-ref:scoped-input-lease');
  }
  if (releaseRefs.some(inputAdapterRef) && !refsContainBoundRef(manifest.evidence.bindRefs, releaseRefs, inputAdapterRef)) {
    issues.push('missing-bind-release-ref:input-adapter');
  }
  if (releaseRefs.some(cursorMarkerRef) && !refsContainBoundRef(manifest.evidence.bindRefs, releaseRefs, cursorMarkerRef)) {
    issues.push('missing-bind-release-ref:cursor-marker');
  }
  if (!manifest.evidence.beforeObservationRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:before-observe');
  if (!manifest.evidence.hostDecisionRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:host-decision');
  if (!manifest.evidence.actionRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:act');
  if (!manifest.evidence.afterObservationRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:after-observe');
  if (!manifest.evidence.controlRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:control');
  if (!manifest.evidence.screenshotRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:screenshot');
  if (!manifest.evidence.accessibilityRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:accessibility');
  if (!manifest.evidence.textRefs.some(nonEmptyString)) issues.push('missing-evidence-ref:text');
  const screenshotRefs = manifest.evidence.screenshotRefs.filter(imageRef);
  const accessibilityRefs = manifest.evidence.accessibilityRefs.filter(accessibilityRef);
  const textRefs = manifest.evidence.textRefs.filter(textRef);
  const hostDecisionRefs = manifest.evidence.hostDecisionRefs;
  const actionRefs = manifest.evidence.actionRefs;
  const controlRefs = manifest.evidence.controlRefs;
  const beforeObservationRefs = manifest.evidence.beforeObservationRefs;
  const afterObservationRefs = manifest.evidence.afterObservationRefs;
  const beforeEditorElementRefs = beforeObservationRefs.filter(editorElementEvidenceRef);
  const afterEditorElementRefs = afterObservationRefs.filter(editorElementEvidenceRef);
  if (screenshotRefs.length === 0) issues.push('invalid-evidence-ref:screenshot');
  if (screenshotRefs.length < 2) issues.push('missing-evidence-ref:before-after-screenshot');
  if (accessibilityRefs.length === 0) issues.push('invalid-evidence-ref:accessibility');
  if (accessibilityRefs.length < 2) issues.push('missing-evidence-ref:before-after-accessibility');
  if (textRefs.length === 0) issues.push('invalid-evidence-ref:text');
  if (textRefs.length < 2) issues.push('missing-evidence-ref:before-after-text');
  if (!manifest.evidence.beforeObservationRefs.some(observationRef)) issues.push('invalid-evidence-ref:before-observe');
  if (!manifest.evidence.beforeObservationRefs.some((ref) => sameRef(ref, manifest.target.windowRef))) issues.push('missing-before-observe-ref:target-window');
  if (fileTargetOperation(manifest.operation) && !manifest.evidence.beforeObservationRefs.some((ref) => nonEmptyString(manifest.target.selectedFileRef) && sameRef(ref, manifest.target.selectedFileRef))) {
    issues.push('missing-before-observe-ref:target-file');
  }
  if (!manifest.evidence.beforeObservationRefs.some(freshnessRef)) issues.push('missing-evidence-ref:before-freshness');
  if (!refsContainBoundRef(beforeObservationRefs, screenshotRefs, imageRef)) issues.push('missing-before-observe-ref:screenshot');
  if (!refsContainBoundRef(beforeObservationRefs, accessibilityRefs, accessibilityRef)) issues.push('missing-before-observe-ref:accessibility');
  if (!refsContainBoundRef(beforeObservationRefs, textRefs, textRef)) issues.push('missing-before-observe-ref:text');
  if (beforeEditorElementRefs.length === 0) issues.push('missing-before-observe-ref:editor-element');
  if (manifest.evidence.bindRefs.some(sessionRef) && !refsContainBoundRef(beforeObservationRefs, manifest.evidence.bindRefs, sessionRef)) {
    issues.push('missing-before-observe-ref:active-session');
  }
  if (!manifest.evidence.hostDecisionRefs.some(hostDecisionRef)) issues.push('invalid-evidence-ref:host-decision');
  if (!hostDecisionRefs.some(requestRef)) issues.push('missing-host-decision-ref:request');
  if (manifest.evidence.bindRefs.some(sessionRef) && !refsContainBoundRef(hostDecisionRefs, manifest.evidence.bindRefs, sessionRef)) {
    issues.push('missing-host-decision-ref:active-session');
  }
  if (!hostDecisionRefs.some((ref) => sameRef(ref, manifest.target.windowRef))) issues.push('missing-host-decision-ref:target-window');
  if (!hostDecisionRefs.some((ref) => manifest.evidence.beforeObservationRefs.some((beforeRef) => observationRef(ref) && sameRef(ref, beforeRef)))) {
    issues.push('missing-host-decision-ref:before-observe');
  }
  if (!hostDecisionRefs.some((ref) => manifest.evidence.beforeObservationRefs.some((beforeRef) => freshnessRef(ref) && sameRef(ref, beforeRef)))) {
    issues.push('missing-host-decision-ref:freshness');
  }
  if (!hostDecisionRefs.some(actionRef)) {
    issues.push('missing-host-decision-ref:action');
  } else if (!refsContainBoundRef(hostDecisionRefs, actionRefs, actionRef)) {
    issues.push('missing-host-decision-ref:action');
  }
  if (!hostDecisionRefs.some(editorElementEvidenceRef)) {
    issues.push('missing-host-decision-ref:editor-element');
  } else if (beforeEditorElementRefs.length > 0 && !refsContainBoundRef(hostDecisionRefs, beforeEditorElementRefs, editorElementEvidenceRef)) {
    issues.push('missing-host-decision-ref:editor-element');
  }
  if (fileTargetOperation(manifest.operation) && !hostDecisionRefs.some((ref) => nonEmptyString(manifest.target.selectedFileRef) && sameRef(ref, manifest.target.selectedFileRef))) {
    issues.push('missing-host-decision-ref:target-file');
  }
  const hostDecisionRiskRefs = hostDecisionRefs.filter(riskActionHashRef);
  if (realFileChangeOperation(manifest.operation) && hostDecisionRiskRefs.length === 0) {
    issues.push('missing-host-decision-ref:risk-action-hash');
  } else if (
    realFileChangeOperation(manifest.operation)
    && !hostDecisionRiskRefs.some((ref) => riskActionHashRefMatchesTargetFile(ref, manifest.target.selectedFileRef))
  ) {
    issues.push('missing-host-decision-ref:risk-action-hash-target-file');
  }
  if (realFileChangeOperation(manifest.operation) && !hostDecisionRefs.some(approvalRef)) issues.push('missing-host-decision-ref:approval');
  if (!manifest.evidence.actionRefs.some(actionRef)) issues.push('invalid-evidence-ref:act');
  if (manifest.evidence.bindRefs.some(sessionRef) && !refsContainBoundRef(actionRefs, manifest.evidence.bindRefs, sessionRef)) {
    issues.push('missing-action-ref:session');
  }
  if (!actionRefs.some((ref) => sameRef(ref, manifest.target.windowRef))) issues.push('missing-action-ref:target-window');
  if (fileTargetOperation(manifest.operation) && !actionRefs.some((ref) => nonEmptyString(manifest.target.selectedFileRef) && sameRef(ref, manifest.target.selectedFileRef))) {
    issues.push('missing-action-ref:target-file');
  }
  if (!manifest.evidence.actionRefs.some(executorEventRef)) issues.push('missing-action-ref:executor-event');
  if (!manifest.evidence.actionRefs.some(inputEventRef)) issues.push('missing-action-ref:input-event');
  if (!manifest.evidence.actionRefs.some(inputAdapterRef)) issues.push('missing-action-ref:input-adapter');
  if (!manifest.evidence.actionRefs.some(cursorMarkerRef)) issues.push('missing-action-ref:cursor-marker');
  if (!manifest.evidence.actionRefs.some(scopedInputLeaseRef)) issues.push('missing-action-ref:scoped-input-lease');
  if (!manifest.evidence.actionRefs.some(staleInvalidationRef)) issues.push('missing-action-ref:stale-invalidation');
  if (!actionRefs.some(editorElementEvidenceRef)) {
    issues.push('missing-action-ref:editor-element');
  } else if (beforeEditorElementRefs.length > 0 && !refsContainBoundRef(actionRefs, beforeEditorElementRefs, editorElementEvidenceRef)) {
    issues.push('missing-action-ref:editor-element');
  }
  if (releaseRefs.some(scopedInputLeaseRef) && !refsContainBoundRef(actionRefs, releaseRefs, scopedInputLeaseRef)) {
    issues.push('missing-action-release-ref:scoped-input-lease');
  }
  if (releaseRefs.some(inputAdapterRef) && !refsContainBoundRef(actionRefs, releaseRefs, inputAdapterRef)) {
    issues.push('missing-action-release-ref:input-adapter');
  }
  if (releaseRefs.some(cursorMarkerRef) && !refsContainBoundRef(actionRefs, releaseRefs, cursorMarkerRef)) {
    issues.push('missing-action-release-ref:cursor-marker');
  }
  if (!manifest.evidence.afterObservationRefs.some(observationRef)) issues.push('invalid-evidence-ref:after-observe');
  if (!manifest.evidence.afterObservationRefs.some((ref) => sameRef(ref, manifest.target.windowRef))) issues.push('missing-after-observe-ref:target-window');
  if (fileTargetOperation(manifest.operation) && !manifest.evidence.afterObservationRefs.some((ref) => nonEmptyString(manifest.target.selectedFileRef) && sameRef(ref, manifest.target.selectedFileRef))) {
    issues.push('missing-after-observe-ref:target-file');
  }
  if (!manifest.evidence.afterObservationRefs.some(freshnessRef)) issues.push('missing-after-observe-ref:freshness');
  if (afterEditorElementRefs.length === 0) {
    issues.push('missing-after-observe-ref:editor-element');
  } else if (beforeEditorElementRefs.length > 0 && !refsContainBoundRef(afterEditorElementRefs, beforeEditorElementRefs, editorElementEvidenceRef)) {
    issues.push('missing-after-observe-ref:editor-element');
  }
  if (!refsContainBoundRef(afterObservationRefs, screenshotRefs, imageRef)) issues.push('missing-after-observe-ref:screenshot');
  if (!refsContainBoundRef(afterObservationRefs, accessibilityRefs, accessibilityRef)) issues.push('missing-after-observe-ref:accessibility');
  if (!refsContainBoundRef(afterObservationRefs, textRefs, textRef)) issues.push('missing-after-observe-ref:text');
  if (manifest.evidence.bindRefs.some(sessionRef) && !refsContainBoundRef(afterObservationRefs, manifest.evidence.bindRefs, sessionRef)) {
    issues.push('missing-after-observe-ref:active-session');
  }
  if (!manifest.evidence.controlRefs.some(controlRef)) issues.push('invalid-evidence-ref:control');
  if (!controlRefs.some(sessionRef)) issues.push('missing-control-ref:session');
  if (manifest.evidence.bindRefs.some(sessionRef) && !refsContainBoundRef(controlRefs, manifest.evidence.bindRefs, sessionRef)) {
    issues.push('missing-control-ref:active-session');
  }
  if (!controlRefs.some((ref) => releaseRefs.some((releaseRef) => scopedInputLeaseRef(ref) && sameRef(ref, releaseRef)))) {
    issues.push('missing-control-ref:scoped-input-lease');
  }
  if (!controlRefs.some((ref) => releaseRefs.some((releaseRef) => inputAdapterRef(ref) && sameRef(ref, releaseRef)))) {
    issues.push('missing-control-ref:input-adapter');
  }
  if (!controlRefs.some((ref) => releaseRefs.some((releaseRef) => cursorMarkerRef(ref) && sameRef(ref, releaseRef)))) {
    issues.push('missing-control-ref:cursor-marker');
  }
  if (!controlRefs.some((ref) => restorationRefs.some((restorationRef) => frontAppRestoreRef(ref) && sameRef(ref, restorationRef)))) {
    issues.push('missing-control-ref:front-app');
  }
  if (!controlRefs.some((ref) => restorationRefs.some((restorationRef) => mousePositionRestoreRef(ref) && sameRef(ref, restorationRef)))) {
    issues.push('missing-control-ref:mouse-position');
  }
  if (!hasRefPrefix(releaseRefs, 'scoped-input-lease:')) issues.push('missing-release-ref:scoped-input-lease');
  if (!hasRefPrefix(releaseRefs, 'input-adapter:')) issues.push('missing-release-ref:input-adapter');
  if (!releaseRefs.some((ref) => ref.startsWith('cursor-marker:') || ref.startsWith('cursor:'))) issues.push('missing-release-ref:cursor-marker');
  if (!restorationRefs.some(frontAppRestoreRef)) issues.push('missing-restoration-ref:front-app');
  if (!restorationRefs.some(mousePositionRestoreRef)) issues.push('missing-restoration-ref:mouse-position');
  if (!manifest.cleanup.inputLeaseReleased) issues.push('cleanup-input-lease-not-released');
  if (!manifest.cleanup.cursorReleased) issues.push('cleanup-cursor-not-released');
  if (!manifest.cleanup.adapterReleased) issues.push('cleanup-adapter-not-released');
  if (!manifest.cleanup.frontAppRestored) issues.push('cleanup-front-app-not-restored');
  if (!manifest.cleanup.mousePositionRestored) issues.push('cleanup-mouse-position-not-restored');
  if (manifest.cleanup.userVSCodeProcessKilled) issues.push('cleanup-must-not-kill-user-vscode');
  if (manifest.cleanup.userProfileCleared) issues.push('cleanup-must-not-clear-user-profile');
  const approvalRiskRefs = manifest.evidence.approvalRefs.filter(riskActionHashRef);
  if (realFileChangeOperation(manifest.operation) && approvalRiskRefs.length === 0) {
    issues.push('missing-approval-ref:risk-action-hash');
  } else if (
    realFileChangeOperation(manifest.operation)
    && !approvalRiskRefs.some((ref) => riskActionHashRefMatchesTargetFile(ref, manifest.target.selectedFileRef))
  ) {
    issues.push('missing-approval-ref:risk-action-hash-target-file');
  }
  if (realFileChangeOperation(manifest.operation) && !manifest.evidence.approvalRefs.some(approvalRef)) issues.push('missing-approval-ref:approval');
  if (realFileChangeOperation(manifest.operation) && !manifest.evidence.approvalRefs.some((ref) => nonEmptyString(manifest.target.selectedFileRef) && sameRef(ref, manifest.target.selectedFileRef))) {
    issues.push('missing-approval-ref:target-file');
  }
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
    requestRef(input.requestRef) ? input.requestRef : undefined,
    windowRef(targetWindow.windowRef) ? targetWindow.windowRef : undefined,
    appRef(targetWindow.appRef) ? targetWindow.appRef : undefined,
    processRef(targetWindow.processRef) ? targetWindow.processRef : undefined,
    titleRef(targetWindow.titleRef) ? targetWindow.titleRef : undefined,
    frontmostRef(targetWindow.frontmostRef) ? targetWindow.frontmostRef : undefined,
    ...(targetWindow.visibleFileRefs ?? []).filter(fileRef),
  ]);
  if (!observation || observation.windowRef !== targetWindowRef || !hasCompleteObservationRefs(observation)) {
    return blocked(input, 'vscode_cowork_observe_refs_required', targetRefs, [{
      code: 'observe-selected-window',
      message: 'Host must call observe on the selected VSCode window and use current screenshot, AX, text, element, and freshness refs before choosing an action.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (!sessionRef(observation.sessionRef)) {
    return blocked(input, 'vscode_cowork_observe_session_ref_required', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'bind-observe-session-ref',
      message: 'Host must bind current VSCode observe refs to a window-action-session ref before choosing the next atomic primitive.',
      suggestedPrimitive: 'bind',
    }]);
  }
  if (invalidObservationRefCount(observation) > 0) {
    return blocked(input, 'vscode_cowork_observe_refs_invalid', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'refresh-observe-refs',
      message: 'Host must provide refs-first observation, text, and element refs only; raw observation payloads must not be dropped and ignored.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (invalidVisibleFileRefCount(targetWindow, observation) > 0) {
    return blocked(input, 'vscode_cowork_visible_file_refs_invalid', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'refresh-visible-file-refs',
      message: 'Visible VSCode file targets must be refs-first file-ref entries only; raw paths or titles must not be dropped and ignored.',
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
  if (observation.editorVisible === false) {
    return blocked(input, 'vscode_cowork_editor_not_visible', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'make-editor-visible',
      message: 'The current observation does not show an editor area. Ask the user or choose another primitive without guessing.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (!editorElementRef(observation)) {
    return blocked(input, 'vscode_cowork_editor_element_ref_required', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'observe-editor-element-ref',
      message: 'Host must provide a refs-first editor element ref from the current VSCode observation before choosing an editor primitive.',
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
  ].filter(fileRef));
  if (fileRef(input.selectedFileRef) && candidateFileRefs.includes(input.selectedFileRef.trim())) return undefined;
  if (input.invalidSelectedFileRef || (nonEmptyString(input.selectedFileRef) && !fileRef(input.selectedFileRef))) {
    return blocked(input, 'vscode_cowork_selected_file_ref_invalid', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'provide-selected-file-ref',
      message: 'The selected file target must be a refs-first file-ref from the current VSCode observation.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (nonEmptyString(input.selectedFileRef)) {
    return blocked(input, 'vscode_cowork_selected_file_not_found', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'refresh-visible-file-refs',
      message: 'The selected fileRef is not visible in the current VSCode observation. Refresh observe refs and ask again if needed.',
      suggestedPrimitive: 'observe',
    }]);
  }
  if (candidateFileRefs.length === 0) {
    return blocked(input, 'vscode_cowork_target_file_refs_required', refsForTargetAndObservation(input, targetWindow, observation), [{
      code: 'observe-visible-file-refs',
      message: 'Host must provide refs-first visible file refs from the current VSCode observation before choosing a file-target operation.',
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

function draftTextRefRequiredBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (input.operation !== 'insert-draft') return undefined;
  if (draftTextRef(input.draftTextRef)) return undefined;
  return {
    ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_draft_text_ref_required',
    repairHints: [{
      code: 'provide-draft-text-ref',
      message: 'Host must provide a refs-first draftTextRef for draft insertion. Raw draft text must not be embedded in the Computer Use decision.',
      suggestedPrimitive: 'act',
    }],
  };
}

function cursorMoveRefRequiredBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (input.operation !== 'move-cursor') return undefined;
  if (cursorMoveRef(input.cursorMoveRef)) return undefined;
  return {
    ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_cursor_move_ref_required',
    repairHints: [{
      code: 'provide-cursor-move-ref',
      message: 'Host must provide a refs-first cursorMoveRef for one observe-derived cursor movement. Raw cursor directions or movement plans must not be embedded.',
      suggestedPrimitive: 'act',
    }],
  };
}

function selectionReplacementRefsRequiredBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (input.operation !== 'replace-selection') return undefined;
  if (!selectionRef(input.selectionRef)) {
    return {
      ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef: targetWindow.windowRef,
      blockedReason: 'vscode_cowork_selection_ref_required',
      repairHints: [{
        code: 'provide-selection-ref',
        message: 'Host must provide a refs-first selectionRef from the latest observation before replacing selected text.',
        suggestedPrimitive: 'observe',
      }],
    };
  }
  if (!replacementTextRef(input.replacementTextRef)) {
    return {
      ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef: targetWindow.windowRef,
      blockedReason: 'vscode_cowork_replacement_text_ref_required',
      repairHints: [{
        code: 'provide-replacement-text-ref',
        message: 'Host must provide a refs-first replacementTextRef; raw replacement text must not be embedded in the Computer Use decision.',
        suggestedPrimitive: 'act',
      }],
    };
  }
  return undefined;
}

function realFileChangeRiskEnvelopeBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (!realFileChangeOperation(input.operation)) return undefined;
  if (observation.userFile === false) return undefined;
  if (riskActionHashRef(input.riskActionHash)) {
    const targetFileRef = resolvedTargetFileRef(input, targetWindow, observation);
    if (riskActionHashRefMatchesTargetFile(input.riskActionHash, targetFileRef)) return undefined;
    return {
      ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef: targetWindow.windowRef,
      blockedReason: 'vscode_cowork_real_file_change_risk_hash_target_ref_required',
      confirmation: {
        reason: 'Replacing selected text, saving, undoing, bulk replacement, or cross-file modification against a user file requires a riskActionHash bound to the selected file ref before confirmation can authorize the action.',
        approvalScope: input.operation,
      },
      repairHints: [{
        code: 'bind-real-file-risk-action-hash-to-target-file',
        message: 'Host must bind the riskActionHash to the same selected fileRef before collecting confirmation for the user-file mutation.',
        suggestedPrimitive: 'act',
      }],
    };
  }
  return {
    ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_real_file_change_risk_hash_required',
    confirmation: {
      reason: 'Replacing selected text, saving, undoing, bulk replacement, or cross-file modification against a user file requires a Host-computed riskActionHash before confirmation can authorize the action.',
      approvalScope: input.operation,
    },
    repairHints: [{
      code: 'provide-real-file-risk-action-hash',
      message: 'Compute a refs-first riskActionHash for the exact user-file mutation, collect confirmation bound to that hash, then retry the Host-chosen primitive.',
      suggestedPrimitive: 'act',
    }],
  };
}

function nonUserFileScopeRefRequiredBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (!realFileChangeOperation(input.operation)) return undefined;
  if (observation.userFile !== false) return undefined;
  if (!nonUserFileScopeRef(observation.nonUserFileScopeRef)) {
    return {
      ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
      targetWindowRef: targetWindow.windowRef,
      blockedReason: 'vscode_cowork_non_user_file_scope_ref_required',
      repairHints: [{
        code: 'provide-non-user-file-scope-ref',
        message: 'Host must provide a refs-first non-user file scope ref before treating a VSCode file mutation as exempt from user-file confirmation.',
        suggestedPrimitive: 'observe',
      }],
    };
  }
  const targetFileRef = resolvedTargetFileRef(input, targetWindow, observation);
  if (nonUserFileScopeRefMatchesTargetFile(observation.nonUserFileScopeRef, targetFileRef)) return undefined;
  return {
    ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_non_user_file_scope_target_ref_required',
    repairHints: [{
      code: 'bind-non-user-file-scope-to-target-file',
      message: 'Host must bind the non-user file scope ref to the same selected fileRef before treating a VSCode mutation as exempt from user-file confirmation.',
      suggestedPrimitive: 'observe',
    }],
  };
}

function nonAtomicFileChangeOperationBlock(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): VSCodeCoWorkDecision | undefined {
  if (!nonAtomicFileChangeOperation(input.operation)) return undefined;
  return {
    ...decisionBase('blocked', refsForTargetAndObservation(input, targetWindow, observation)),
    targetWindowRef: targetWindow.windowRef,
    blockedReason: 'vscode_cowork_non_atomic_operation_requires_host_decomposition',
    repairHints: [{
      code: 'decompose-file-change-into-atomic-primitives',
      message: 'Host must decompose bulk replacement or cross-file modification into explicit refs-first atomic editor primitives; Computer Use core must not plan or execute a batch edit.',
      suggestedPrimitive: 'act',
    }],
  };
}

function actionForOperation(
  input: VSCodeCoWorkDecisionInput,
  observation: VSCodeCoWorkObservationRefs,
): ComputerUseAtomicAction | undefined {
  const editorElementRef = editorElementRefForObservation(observation);
  if (!editorElementRef) return undefined;
  if (input.operation === 'focus-editor') {
    return {
      type: 'key',
      key: 'Command+1',
      elementRef: editorElementRef,
    };
  }
  const cursorMoveKey = cursorMoveRef(input.cursorMoveRef)
    ? cursorMoveKeyForRef(input.cursorMoveRef)
    : undefined;
  if (input.operation === 'move-cursor' && cursorMoveKey) {
    return {
      type: 'key',
      key: cursorMoveKey,
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
  if (input.operation === 'insert-draft' && draftTextRef(input.draftTextRef)) {
    return {
      type: 'type',
      textRef: input.draftTextRef.trim(),
      elementRef: editorElementRef,
    };
  }
  if (input.operation === 'replace-selection' && replacementTextRef(input.replacementTextRef)) {
    return {
      type: 'type',
      textRef: input.replacementTextRef.trim(),
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

function editorElementRef(observation: VSCodeCoWorkObservationRefs): boolean {
  return editorElementRefForObservation(observation) !== undefined;
}

function editorElementRefForObservation(observation: VSCodeCoWorkObservationRefs): string | undefined {
  return observation.elementRefs.filter(elementRef).find((ref) => /editor/i.test(ref));
}

function editorElementEvidenceRef(value: unknown): value is string {
  return elementRef(value) && /editor/i.test(value);
}

function realFileChangeNeedsConfirmation(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): boolean {
  if (!userRealFileChangeOperation(input, observation)) return false;
  if (!approvalRef(input.confirmationRef)) return true;
  if (!riskActionHashRef(input.riskActionHash)) return true;
  const targetFileRef = resolvedTargetFileRef(input, targetWindow, observation);
  return !approvalRefMatchesRiskActionHashAndTargetFile(input.confirmationRef, input.riskActionHash, targetFileRef);
}

function userRealFileChangeOperation(
  input: VSCodeCoWorkDecisionInput,
  observation: VSCodeCoWorkObservationRefs,
): boolean {
  return realFileChangeOperation(input.operation) && observation.userFile !== false;
}

function draftTextRef(value: unknown): value is string {
  return structuredRef(value, ['text-ref:']);
}

function cursorMoveRef(value: unknown): value is string {
  return structuredRef(value, ['cursor-move:'])
    && cursorMoveKeyForRef(value) !== undefined;
}

function selectionRef(value: unknown): value is string {
  return structuredRef(value, ['selection-ref:']);
}

function replacementTextRef(value: unknown): value is string {
  return structuredRef(value, ['text-ref:']);
}

function nonUserFileScopeRef(value: unknown): value is string {
  return structuredRef(value, ['non-user-file-scope:']);
}

function cursorMoveKeyForRef(value: string): string | undefined {
  const direction = value.trim().split(':').at(-1);
  if (direction === 'left') return 'ArrowLeft';
  if (direction === 'right') return 'ArrowRight';
  if (direction === 'up') return 'ArrowUp';
  if (direction === 'down') return 'ArrowDown';
  return undefined;
}

function supportedVSCodeCoWorkOperation(value: unknown): value is VSCodeCoWorkOperation {
  return typeof value === 'string' && SUPPORTED_VSCODE_COWORK_OPERATIONS.has(value);
}

function fileRef(value: unknown): value is string {
  return structuredRef(value, ['file-ref:']);
}

function riskActionHashRef(value: unknown): value is string {
  return typeof value === 'string' && /^risk:[a-z0-9_-]+(?::[a-z0-9_-]+)*$/i.test(value.trim());
}

function approvalRef(value: unknown): value is string {
  return typeof value === 'string' && /^approval:[a-z0-9_-]+(?::[a-z0-9_-]+)*$/i.test(value.trim());
}

function actionRef(value: unknown): value is string {
  return structuredRef(value, ['action:', 'window-action:']);
}

function sessionRef(value: unknown): value is string {
  return structuredRef(value, ['window-action-session:', 'computer-use-session:']);
}

function executorEventRef(value: unknown): value is string {
  return structuredRef(value, ['executor-event:']);
}

function inputEventRef(value: unknown): value is string {
  return structuredRef(value, ['input-event:']);
}

function inputAdapterRef(value: unknown): value is string {
  return structuredRef(value, ['input-adapter:']);
}

function scopedInputLeaseRef(value: unknown): value is string {
  return structuredRef(value, ['scoped-input-lease:']);
}

function cursorMarkerRef(value: unknown): value is string {
  return structuredRef(value, ['cursor-marker:', 'cursor:']);
}

function hostDecisionRef(value: unknown): value is string {
  return structuredRef(value, ['decision:']);
}

function controlRef(value: unknown): value is string {
  return structuredRef(value, ['control:']);
}

function frontAppRestoreRef(value: unknown): value is string {
  return typeof value === 'string' && /^front-app-restore:|^focus-restore:/i.test(value.trim());
}

function mousePositionRestoreRef(value: unknown): value is string {
  return typeof value === 'string' && /^mouse-position-restore:|^cursor-position-restore:/i.test(value.trim());
}

function staleInvalidationRef(value: unknown): value is string {
  return structuredRef(value, ['stale-invalidation:', 'freshness-invalidation:', 'invalidated-observation:']);
}

function requestRef(value: unknown): value is string {
  return structuredRef(value, ['chat-request:']);
}

function appRef(value: unknown): value is string {
  return structuredRef(value, ['macos-app:']);
}

function processRef(value: unknown): value is string {
  return structuredRef(value, ['process:']);
}

function windowRef(value: unknown): value is string {
  return structuredRef(value, ['window:']);
}

function titleRef(value: unknown): value is string {
  return structuredRef(value, ['text:', 'window:']);
}

function frontmostRef(value: unknown): value is string {
  return structuredRef(value, ['frontmost:', 'window:']);
}

function observationRef(value: unknown): value is string {
  return structuredRef(value, ['observation:']);
}

function imageRef(value: unknown): value is string {
  return structuredRef(value, ['image:']);
}

function accessibilityRef(value: unknown): value is string {
  return structuredRef(value, ['accessibility:']);
}

function textRef(value: unknown): value is string {
  return structuredRef(value, ['text:']);
}

function elementRef(value: unknown): value is string {
  return structuredRef(value, ['element:']);
}

function freshnessRef(value: unknown): value is string {
  return structuredRef(value, ['freshness:']);
}

function structuredRef(value: unknown, prefixes: string[]): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  return /^[a-z][a-z0-9_-]*:[^\s/\\]+$/i.test(text)
    && prefixes.some((prefix) => text.startsWith(prefix));
}

function windowCandidateRefSafe(candidate: VSCodeCoWorkWindowCandidate): boolean {
  return appRef(candidate.appRef)
    && windowRef(candidate.windowRef)
    && (candidate.processRef === undefined || processRef(candidate.processRef))
    && (candidate.titleRef === undefined || titleRef(candidate.titleRef))
    && (candidate.frontmostRef === undefined || frontmostRef(candidate.frontmostRef));
}

function windowCandidateIdentityRefsComplete(candidate: VSCodeCoWorkWindowCandidate): boolean {
  return appRef(candidate.appRef)
    && processRef(candidate.processRef)
    && windowRef(candidate.windowRef)
    && titleRef(candidate.titleRef)
    && frontmostRef(candidate.frontmostRef);
}

function resolvedTargetFileRef(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): string | undefined {
  if (fileRef(input.selectedFileRef)) return input.selectedFileRef.trim();
  const candidateFileRefs = uniqueStrings([
    ...(targetWindow.visibleFileRefs ?? []),
    ...(observation.visibleFileRefs ?? []),
  ].filter(fileRef));
  return candidateFileRefs.length === 1 ? candidateFileRefs[0] : undefined;
}

function approvalRefMatchesRiskActionHashAndTargetFile(approvalRef: string, riskActionHash: string, targetFileRef: string | undefined): boolean {
  if (!fileRef(targetFileRef)) return false;
  return approvalRef.startsWith(`approval:${riskActionHash}:${targetFileRef}:`);
}

function riskActionHashRefMatchesTargetFile(riskActionHash: string, targetFileRef: string | undefined): boolean {
  if (!fileRef(targetFileRef)) return false;
  const text = riskActionHash.trim();
  const targetToken = `:${targetFileRef}`;
  return text.endsWith(targetToken) || text.includes(`${targetToken}:`);
}

function nonUserFileScopeRefMatchesTargetFile(scopeRef: string, targetFileRef: string | undefined): boolean {
  if (!fileRef(targetFileRef)) return false;
  return scopeRef.startsWith(`non-user-file-scope:${targetFileRef}:`);
}

function realFileChangeOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation === 'save-current-file'
    || operation === 'undo-last-action'
    || operation === 'replace-selection'
    || operation === 'bulk-replace'
    || operation === 'cross-file-modify';
}

function nonAtomicFileChangeOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation === 'bulk-replace'
    || operation === 'cross-file-modify';
}

function primitiveChainMatches(chain: string[]): boolean {
  return chain.length === VSCODE_COWORK_REQUIRED_PRIMITIVE_CHAIN.length
    && VSCODE_COWORK_REQUIRED_PRIMITIVE_CHAIN.every((item, index) => chain[index] === item);
}

function fileTargetOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation === 'insert-draft'
    || operation === 'replace-selection'
    || operation === 'save-current-file'
    || operation === 'bulk-replace'
    || operation === 'cross-file-modify'
    || operation === 'undo-last-action';
}

function hasCompleteObservationRefs(observation: VSCodeCoWorkObservationRefs): boolean {
  return observationRef(observation.observationRef)
    && imageRef(observation.screenshotRef)
    && accessibilityRef(observation.accessibilityRef)
    && freshnessRef(observation.freshnessRef)
    && observation.textRefs.some(textRef)
    && observation.elementRefs.some(elementRef);
}

function invalidObservationRefCount(observation: VSCodeCoWorkObservationRefs): number {
  return (observation.invalidObservationRefCount ?? 0)
    + invalidRefListItemCount(observation.textRefs, textRef)
    + invalidRefListItemCount(observation.elementRefs, elementRef);
}

function invalidVisibleFileRefCount(
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): number {
  const visibleFileRefs = [
    ...(targetWindow.visibleFileRefs ?? []),
    ...(observation.visibleFileRefs ?? []),
  ];
  if (!visibleFileRefs.some(fileRef)) return 0;
  return (targetWindow.invalidVisibleFileRefCount ?? 0)
    + (observation.invalidVisibleFileRefCount ?? 0)
    + invalidRefListItemCount(targetWindow.visibleFileRefs, fileRef)
    + invalidRefListItemCount(observation.visibleFileRefs, fileRef);
}

function invalidRefListItemCount(
  values: readonly unknown[] | undefined,
  predicate: (value: unknown) => value is string,
): number {
  return (values ?? []).filter((value) => !predicate(value)).length;
}

function refsForTargetAndObservation(
  input: VSCodeCoWorkDecisionInput,
  targetWindow: VSCodeCoWorkWindowCandidate,
  observation: VSCodeCoWorkObservationRefs,
): string[] {
  return uniqueStrings([
    requestRef(input.requestRef) ? input.requestRef : undefined,
    windowRef(targetWindow.windowRef) ? targetWindow.windowRef : undefined,
    appRef(targetWindow.appRef) ? targetWindow.appRef : undefined,
    processRef(targetWindow.processRef) ? targetWindow.processRef : undefined,
    titleRef(targetWindow.titleRef) ? targetWindow.titleRef : undefined,
    frontmostRef(targetWindow.frontmostRef) ? targetWindow.frontmostRef : undefined,
    fileRef(input.selectedFileRef) ? input.selectedFileRef : undefined,
    cursorMoveRef(input.cursorMoveRef) ? input.cursorMoveRef : undefined,
    selectionRef(input.selectionRef) ? input.selectionRef : undefined,
    replacementTextRef(input.replacementTextRef) ? input.replacementTextRef : undefined,
    riskActionHashRef(input.riskActionHash) ? input.riskActionHash : undefined,
    approvalRef(input.confirmationRef) ? input.confirmationRef : undefined,
    nonUserFileScopeRef(observation.nonUserFileScopeRef) ? observation.nonUserFileScopeRef : undefined,
    ...(targetWindow.visibleFileRefs ?? []).filter(fileRef),
    windowRef(observation.windowRef) ? observation.windowRef : undefined,
    sessionRef(observation.sessionRef) ? observation.sessionRef : undefined,
    observationRef(observation.observationRef) ? observation.observationRef : undefined,
    imageRef(observation.screenshotRef) ? observation.screenshotRef : undefined,
    accessibilityRef(observation.accessibilityRef) ? observation.accessibilityRef : undefined,
    freshnessRef(observation.freshnessRef) ? observation.freshnessRef : undefined,
    ...(observation.textRefs ?? []).filter(textRef),
    ...(observation.elementRefs ?? []).filter(elementRef),
    ...(observation.visibleFileRefs ?? []).filter(fileRef),
  ]);
}

function windowCandidateRefs(candidates: readonly VSCodeCoWorkWindowCandidate[]): string[] {
  return uniqueStrings(candidates.flatMap((candidate) => [
    appRef(candidate.appRef) ? candidate.appRef : undefined,
    processRef(candidate.processRef) ? candidate.processRef : undefined,
    windowRef(candidate.windowRef) ? candidate.windowRef : undefined,
    titleRef(candidate.titleRef) ? candidate.titleRef : undefined,
    frontmostRef(candidate.frontmostRef) ? candidate.frontmostRef : undefined,
    ...(candidate.visibleFileRefs ?? []).filter(fileRef),
  ]));
}

function blocked(
  input: VSCodeCoWorkDecisionInput,
  blockedReason: string,
  refs: string[],
  repairHints: VSCodeCoWorkDecision['repairHints'],
): VSCodeCoWorkDecision {
  return {
    ...decisionBase('blocked', uniqueStrings([requestRef(input.requestRef) ? input.requestRef : undefined, ...refs])),
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

function sameRef(left: unknown, right: unknown): boolean {
  return typeof left === 'string'
    && typeof right === 'string'
    && left.trim() === right.trim();
}

function refsContainBoundRef(
  refs: readonly string[],
  allowedRefs: readonly string[],
  predicate: (value: unknown) => value is string,
): boolean {
  return refs.some((ref) => predicate(ref) && allowedRefs.some((allowedRef) => sameRef(ref, allowedRef)));
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

function unsafeCleanupEvidenceRefIssues(evidence: VSCodeCoWorkCleanupManifest['evidence']): string[] {
  const groups: Array<[string, string[]]> = [
    ['release', evidence.releaseRefs],
    ['restoration', evidence.restorationRefs],
  ];

  return groups.flatMap(([label, refs]) => (
    refs.some(unsafeEvidenceRef) ? [`unsafe-evidence-ref:${label}`] : []
  ));
}

function unsafeEvidenceRef(value: string): boolean {
  return /(?:rawScreenshot|providerPayload|data:[^,\s]+;base64,|base64|secret|token|password|https?:\/\/|(?:^|[:\s])(?:~\/|\/(?:Users|Applications|tmp|var|private|Volumes)\/|[A-Za-z]:[\\/]))/i.test(value);
}
