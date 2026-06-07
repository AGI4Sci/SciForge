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

  const riskEnvelopeBlock = realFileChangeRiskEnvelopeBlock(input, targetWindow, observation);
  if (riskEnvelopeBlock) return riskEnvelopeBlock;

  if (realFileChangeNeedsConfirmation(input, observation)) {
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
  if (screenshotRefs.length === 0) issues.push('invalid-evidence-ref:screenshot');
  if (screenshotRefs.length < 2) issues.push('missing-evidence-ref:before-after-screenshot');
  if (accessibilityRefs.length === 0) issues.push('invalid-evidence-ref:accessibility');
  if (accessibilityRefs.length < 2) issues.push('missing-evidence-ref:before-after-accessibility');
  if (textRefs.length === 0) issues.push('invalid-evidence-ref:text');
  if (textRefs.length < 2) issues.push('missing-evidence-ref:before-after-text');
  if (!manifest.evidence.beforeObservationRefs.some(observationRef)) issues.push('invalid-evidence-ref:before-observe');
  if (!manifest.evidence.hostDecisionRefs.some(hostDecisionRef)) issues.push('invalid-evidence-ref:host-decision');
  if (!manifest.evidence.actionRefs.some(actionRef)) issues.push('invalid-evidence-ref:act');
  if (!manifest.evidence.actionRefs.some(executorEventRef)) issues.push('missing-action-ref:executor-event');
  if (!manifest.evidence.actionRefs.some(inputEventRef)) issues.push('missing-action-ref:input-event');
  if (!manifest.evidence.actionRefs.some(inputAdapterRef)) issues.push('missing-action-ref:input-adapter');
  if (!manifest.evidence.actionRefs.some(cursorMarkerRef)) issues.push('missing-action-ref:cursor-marker');
  if (!manifest.evidence.actionRefs.some(scopedInputLeaseRef)) issues.push('missing-action-ref:scoped-input-lease');
  if (!manifest.evidence.actionRefs.some(staleInvalidationRef)) issues.push('missing-action-ref:stale-invalidation');
  if (!manifest.evidence.afterObservationRefs.some(observationRef)) issues.push('invalid-evidence-ref:after-observe');
  if (!manifest.evidence.controlRefs.some(controlRef)) issues.push('invalid-evidence-ref:control');
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
  if (realFileChangeOperation(manifest.operation) && !manifest.evidence.approvalRefs.some(riskActionHashRef)) issues.push('missing-approval-ref:risk-action-hash');
  if (realFileChangeOperation(manifest.operation) && !manifest.evidence.approvalRefs.some(approvalRef)) issues.push('missing-approval-ref:approval');
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
  if (riskActionHashRef(input.riskActionHash)) return undefined;
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
  const observedElementRefs = observation.elementRefs.filter(elementRef);
  const editorElementRef = observedElementRefs.find((ref) => /editor/i.test(ref)) ?? observedElementRefs[0];
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

function realFileChangeNeedsConfirmation(
  input: VSCodeCoWorkDecisionInput,
  observation: VSCodeCoWorkObservationRefs,
): boolean {
  if (!realFileChangeOperation(input.operation)) return false;
  if (observation.userFile === false) return false;
  if (!approvalRef(input.confirmationRef)) return true;
  if (!riskActionHashRef(input.riskActionHash)) return true;
  return !approvalRefMatchesRiskActionHash(input.confirmationRef, input.riskActionHash);
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

function cursorMoveKeyForRef(value: string): string | undefined {
  const direction = value.trim().split(':').at(-1);
  if (direction === 'left') return 'ArrowLeft';
  if (direction === 'right') return 'ArrowRight';
  if (direction === 'up') return 'ArrowUp';
  if (direction === 'down') return 'ArrowDown';
  return undefined;
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

function approvalRefMatchesRiskActionHash(approvalRef: string, riskActionHash: string): boolean {
  return approvalRef.startsWith(`approval:${riskActionHash}:`);
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

function editorOperation(operation: VSCodeCoWorkOperation): boolean {
  return operation !== 'read-visible-text';
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
    ...(targetWindow.visibleFileRefs ?? []).filter(fileRef),
    windowRef(observation.windowRef) ? observation.windowRef : undefined,
    observationRef(observation.observationRef) ? observation.observationRef : undefined,
    imageRef(observation.screenshotRef) ? observation.screenshotRef : undefined,
    accessibilityRef(observation.accessibilityRef) ? observation.accessibilityRef : undefined,
    freshnessRef(observation.freshnessRef) ? observation.freshnessRef : undefined,
    ...(observation.textRefs ?? []).filter(textRef),
    ...(observation.elementRefs ?? []).filter(elementRef),
    ...(observation.visibleFileRefs ?? []).filter(fileRef),
  ]);
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
