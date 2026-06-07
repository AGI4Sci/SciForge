import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VSCODE_COWORK_ACCEPTANCE_CAPABILITY,
  decideVSCodeCoWorkNextPrimitive,
  validateVSCodeCoWorkLiveAcceptanceManifest,
  validateVSCodeCoWorkRunCleanup,
} from './vscode-cowork-acceptance.js';
import { CU_NEXT_TASK_MAPPINGS } from './task-map.js';

test('VSCode co-work capability stays live-diagnostic and never product-ready', () => {
  assert.equal(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.maturity, 'live-diagnostic');
  assert.equal(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.productReady, false);
  assert.equal(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.userProfileUsed, true);
  assert.ok(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('input-lease-cursor-adapter-released'));
  assert.ok(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('front-app-restored'));
  assert.ok(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('mouse-position-restored'));
  assert.ok(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('user-vscode-process-not-killed'));
  assert.ok(VSCODE_COWORK_ACCEPTANCE_CAPABILITY.cleanup.asserts.includes('user-profile-not-cleared'));
});

test('CU-NEXT task map registers P9 current VSCode co-work without product-ready claims', () => {
  const mapping = CU_NEXT_TASK_MAPPINGS.find((task) => task.taskId === 'CU-NEXT-09');

  assert.ok(mapping);
  assert.equal(mapping.slug, 'current-vscode-cowork');
  assert.equal(mapping.recommendedTargetMode, 'active-window');
  assert.equal(mapping.recommendedTargetApp, 'Visual Studio Code');
  assert.ok(mapping.requirements.includes('observe-before-mutate-refs'));
  assert.ok(mapping.requirements.includes('approval-chain'));
  assert.ok(mapping.requirements.includes('user-control-refs'));
  assert.doesNotMatch(JSON.stringify(mapping), /product-ready/i);
});

test('Host-side VSCode co-work asks for confirmation when multiple user windows match', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:multi-window',
    operation: 'focus-editor',
    windowCandidates: [
      vscodeWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
      vscodeWindow({ windowRef: 'window:vscode:notes', titleRef: 'text:title:notes' }),
    ],
  });

  assert.equal(decision.status, 'needs-confirmation');
  assert.equal(decision.blockedReason, 'vscode_cowork_target_window_needs_confirmation');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.deepEqual(decision.confirmation?.candidateWindowRefs, ['window:vscode:paper', 'window:vscode:notes']);
  assert.ok(decision.refs.includes('chat-request:vscode-cowork:multi-window'));
  assert.ok(decision.refs.includes('window:vscode:paper'));
  assert.ok(decision.refs.includes('window:vscode:notes'));
  assert.equal(decision.productReady, false);
  assert.equal(decision.maturity, 'live-diagnostic');
});

test('Host-side VSCode co-work blocks stale or incomplete observe refs before selecting an action', () => {
  const stale = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:stale',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      windowRef: 'window:vscode:paper',
      observationRef: 'observation:vscode:old',
      screenshotRef: 'image:vscode:old',
      accessibilityRef: 'accessibility:vscode:old',
      textRefs: ['text:vscode:old'],
      elementRefs: ['element:vscode:editor'],
      freshnessRef: 'freshness:vscode:old',
      stale: true,
      editorVisible: true,
      userFile: true,
    },
  });

  assert.equal(stale.status, 'blocked');
  assert.equal(stale.blockedReason, 'vscode_cowork_observation_stale');
  assert.equal(stale.primitive, undefined);
  assert.equal(stale.action, undefined);

  const missingRefs = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:missing-refs',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      windowRef: 'window:vscode:paper',
      observationRef: 'observation:vscode:missing',
      screenshotRef: '',
      accessibilityRef: 'accessibility:vscode:missing',
      textRefs: [],
      elementRefs: ['element:vscode:editor'],
      freshnessRef: 'freshness:vscode:missing',
      editorVisible: true,
      userFile: true,
    },
  });

  assert.equal(missingRefs.status, 'blocked');
  assert.equal(missingRefs.blockedReason, 'vscode_cowork_observe_refs_required');
  assert.equal(missingRefs.primitive, undefined);
  assert.equal(missingRefs.action, undefined);

  const editorHidden = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:editor-hidden',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      editorVisible: false,
    },
  });

  assert.equal(editorHidden.status, 'blocked');
  assert.equal(editorHidden.blockedReason, 'vscode_cowork_editor_not_visible');
  assert.equal(editorHidden.primitive, undefined);
  assert.equal(editorHidden.action, undefined);
});

test('Host-side VSCode co-work asks for confirmation when the target file is ambiguous', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:ambiguous-file',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      visibleFileRefs: ['file-ref:vscode:paper', 'file-ref:vscode:notes'],
    },
    draftTextRef: 'text-ref:vscode:draft',
  });

  assert.equal(decision.status, 'needs-confirmation');
  assert.equal(decision.blockedReason, 'vscode_cowork_target_file_needs_confirmation');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.deepEqual(decision.confirmation?.candidateFileRefs, ['file-ref:vscode:paper', 'file-ref:vscode:notes']);
  assert.ok(decision.refs.includes('file-ref:vscode:paper'));
  assert.ok(decision.refs.includes('file-ref:vscode:notes'));
});

test('Host-side VSCode co-work blocks selected file refs that are not in current observe refs', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:stale-selected-file',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:notes',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      visibleFileRefs: ['file-ref:vscode:paper'],
    },
    draftTextRef: 'text-ref:vscode:draft',
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_selected_file_not_found');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.ok(decision.refs.includes('file-ref:vscode:paper'));
  assert.ok(decision.refs.includes('file-ref:vscode:notes'));
});

test('Host-side VSCode co-work requires a draft text ref before inserting draft text', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:missing-draft-ref',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_draft_text_ref_required');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.deepEqual(decision.repairHints, [{
    code: 'provide-draft-text-ref',
    message: 'Host must provide a refs-first draftTextRef for draft insertion. Raw draft text must not be embedded in the Computer Use decision.',
    suggestedPrimitive: 'act',
  }]);
  assert.ok(decision.refs.includes('observation:vscode:current'));
  assert.ok(decision.refs.includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(decision), /draft body|rawDraftText|clipboard|providerPayload|base64|planner/i);
});

test('Host-side VSCode co-work chooses the next primitive only from fresh observe refs', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:focus',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
  });

  assert.equal(decision.status, 'ready');
  assert.equal(decision.primitive, 'act');
  assert.deepEqual(decision.action, {
    type: 'key',
    key: 'Command+1',
    elementRef: 'element:vscode:editor',
  });
  assert.equal(decision.targetWindowRef, 'window:vscode:paper');
  assert.ok(decision.refs.includes('observation:vscode:current'));
  assert.ok(decision.refs.includes('image:vscode:current'));
  assert.ok(decision.refs.includes('accessibility:vscode:current'));
  assert.ok(decision.refs.includes('text:vscode:visible'));
  assert.ok(decision.refs.includes('freshness:vscode:current'));
  assert.doesNotMatch(JSON.stringify(decision), /visibleText|rawScreenshot|base64|task|goal|planner/i);
});

test('Host-side VSCode co-work exposes visible text as refs-only observe decision', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:read-visible-text',
    operation: 'read-visible-text',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
  });

  assert.equal(decision.status, 'ready');
  assert.equal(decision.primitive, 'observe');
  assert.equal(decision.action, undefined);
  assert.equal(decision.targetWindowRef, 'window:vscode:paper');
  assert.ok(decision.refs.includes('observation:vscode:current'));
  assert.ok(decision.refs.includes('text:vscode:visible'));
  assert.ok(decision.refs.includes('accessibility:vscode:current'));
  assert.doesNotMatch(JSON.stringify(decision), /visibleText|rawScreenshot|base64|task|goal|planner/i);
});

test('Host-side VSCode co-work requires confirmation before real-file save, undo, bulk replace, or cross-file modification', () => {
  for (const operation of ['save-current-file', 'undo-last-action', 'bulk-replace', 'cross-file-modify'] as const) {
    const decision = decideVSCodeCoWorkNextPrimitive({
      requestRef: `chat-request:vscode-cowork:${operation}`,
      operation,
      selectedWindowRef: 'window:vscode:paper',
      windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
      latestObservation: freshObservation(),
      riskActionHash: `risk:${operation}:paper`,
    });

    assert.equal(decision.status, 'needs-confirmation', operation);
    assert.equal(decision.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation', operation);
    assert.equal(decision.primitive, undefined, operation);
    assert.equal(decision.action, undefined, operation);
    assert.equal(decision.confirmation?.riskActionHash, `risk:${operation}:paper`, operation);
    assert.ok(decision.refs.includes(`risk:${operation}:paper`), operation);
  }

  const approvalWithoutRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-approval-without-risk',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    confirmationRef: 'approval:save-current-file:paper:confirmed',
  });

  assert.equal(approvalWithoutRiskHash.status, 'blocked');
  assert.equal(approvalWithoutRiskHash.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
  assert.equal(approvalWithoutRiskHash.primitive, undefined);
  assert.equal(approvalWithoutRiskHash.action, undefined);
  assert.ok(approvalWithoutRiskHash.refs.includes('approval:save-current-file:paper:confirmed'));

  const approvalWithEmbeddedRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-approval-embedded-risk',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:paper',
    confirmationRef: 'approval:risk:save-current-file:paper-old:confirmed',
  });

  assert.equal(approvalWithEmbeddedRiskHash.status, 'needs-confirmation');
  assert.equal(approvalWithEmbeddedRiskHash.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.equal(approvalWithEmbeddedRiskHash.primitive, undefined);
  assert.equal(approvalWithEmbeddedRiskHash.action, undefined);
  assert.ok(approvalWithEmbeddedRiskHash.refs.includes('risk:save-current-file:paper'));
  assert.ok(approvalWithEmbeddedRiskHash.refs.includes('approval:risk:save-current-file:paper-old:confirmed'));

  const approvalWithoutConfirmationSuffix = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-approval-without-confirmation-suffix',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:paper',
    confirmationRef: 'approval:risk:save-current-file:paper',
  });

  assert.equal(approvalWithoutConfirmationSuffix.status, 'needs-confirmation');
  assert.equal(approvalWithoutConfirmationSuffix.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.equal(approvalWithoutConfirmationSuffix.primitive, undefined);
  assert.equal(approvalWithoutConfirmationSuffix.action, undefined);
  assert.ok(approvalWithoutConfirmationSuffix.refs.includes('risk:save-current-file:paper'));
  assert.ok(approvalWithoutConfirmationSuffix.refs.includes('approval:risk:save-current-file:paper'));

  const confirmedSave = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-confirmed',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:paper',
    confirmationRef: 'approval:risk:save-current-file:paper:confirmed',
  });

  assert.equal(confirmedSave.status, 'ready');
  assert.equal(confirmedSave.primitive, 'act');
  assert.deepEqual(confirmedSave.action, {
    type: 'app_command',
    command: 'save',
    elementRef: 'element:vscode:editor',
  });
  assert.deepEqual(confirmedSave.risk, {
    level: 'high',
    categories: ['user-real-file-change'],
    actionHash: 'risk:save-current-file:paper',
  });
  assert.equal(confirmedSave.approvalRef, 'approval:risk:save-current-file:paper:confirmed');
  assert.ok(confirmedSave.refs.includes('risk:save-current-file:paper'));
  assert.ok(confirmedSave.refs.includes('approval:risk:save-current-file:paper:confirmed'));

  const confirmedUndo = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:undo-confirmed',
    operation: 'undo-last-action',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:undo-last-action:paper',
    confirmationRef: 'approval:risk:undo-last-action:paper:confirmed',
  });

  assert.equal(confirmedUndo.status, 'ready');
  assert.equal(confirmedUndo.primitive, 'act');
  assert.deepEqual(confirmedUndo.action, {
    type: 'key',
    key: 'Command+Z',
    elementRef: 'element:vscode:editor',
  });
  assert.deepEqual(confirmedUndo.risk, {
    level: 'high',
    categories: ['user-real-file-change'],
    actionHash: 'risk:undo-last-action:paper',
  });
  assert.equal(confirmedUndo.approvalRef, 'approval:risk:undo-last-action:paper:confirmed');
  assert.ok(confirmedUndo.refs.includes('risk:undo-last-action:paper'));
  assert.ok(confirmedUndo.refs.includes('approval:risk:undo-last-action:paper:confirmed'));
});

test('VSCode co-work cleanup validation requires release refs and focus/mouse restoration without killing user state', () => {
  const passed = validateVSCodeCoWorkRunCleanup({
    maturity: 'live-diagnostic',
    productReady: false,
    userProfileUsed: true,
    sharedSystemInputUsed: true,
    evidence: {
      releaseRefs: [
        'scoped-input-lease:vscode-cowork:1',
        'input-adapter:vscode-cowork:1',
        'cursor-marker:vscode-cowork:1',
      ],
      restorationRefs: [
        'front-app-restore:vscode-cowork:1',
        'mouse-position-restore:vscode-cowork:1',
      ],
    },
    cleanup: {
      inputLeaseReleased: true,
      cursorReleased: true,
      adapterReleased: true,
      frontAppRestored: true,
      mousePositionRestored: true,
      userVSCodeProcessKilled: false,
      userProfileCleared: false,
    },
  });

  assert.equal(passed.ok, true);
  assert.deepEqual(passed.issues, []);

  const failed = validateVSCodeCoWorkRunCleanup({
    maturity: 'product-ready',
    productReady: true,
    userProfileUsed: true,
    sharedSystemInputUsed: true,
    evidence: {
      releaseRefs: ['input-adapter:vscode-cowork:1'],
      restorationRefs: ['front-app-restore:vscode-cowork:1'],
    },
    cleanup: {
      inputLeaseReleased: false,
      cursorReleased: false,
      adapterReleased: true,
      frontAppRestored: true,
      mousePositionRestored: false,
      userVSCodeProcessKilled: true,
      userProfileCleared: true,
    },
  });

  assert.equal(failed.ok, false);
  assert.deepEqual(failed.issues, [
    'vscode-cowork-capability-must-remain-live-diagnostic',
    'vscode-cowork-must-not-claim-product-ready',
    'missing-release-ref:scoped-input-lease',
    'missing-release-ref:cursor-marker',
    'missing-restoration-ref:mouse-position',
    'cleanup-input-lease-not-released',
    'cleanup-cursor-not-released',
    'cleanup-mouse-position-not-restored',
    'cleanup-must-not-kill-user-vscode',
    'cleanup-must-not-clear-user-profile',
  ]);
});

test('VSCode co-work validators require explicit user profile and shared input markers', () => {
  const cleanup = validateVSCodeCoWorkRunCleanup({
    maturity: 'live-diagnostic',
    productReady: false,
    userProfileUsed: false,
    sharedSystemInputUsed: false,
    evidence: {
      releaseRefs: [
        'scoped-input-lease:vscode-cowork:1',
        'input-adapter:vscode-cowork:1',
        'cursor-marker:vscode-cowork:1',
      ],
      restorationRefs: [
        'front-app-restore:vscode-cowork:1',
        'mouse-position-restore:vscode-cowork:1',
      ],
    },
    cleanup: {
      inputLeaseReleased: true,
      cursorReleased: true,
      adapterReleased: true,
      frontAppRestored: true,
      mousePositionRestored: true,
      userVSCodeProcessKilled: false,
      userProfileCleared: false,
    },
  });

  assert.equal(cleanup.ok, false);
  assert.deepEqual(cleanup.issues, [
    'vscode-cowork-user-profile-must-be-marked-used',
    'vscode-cowork-shared-system-input-impact-required',
  ]);

  const live = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...vscodeCoWorkLiveManifest(),
    userProfileUsed: false,
    sharedSystemInputUsed: false,
  });

  assert.equal(live.ok, false);
  assert.deepEqual(live.issues, [
    'vscode-cowork-user-profile-must-be-marked-used',
    'vscode-cowork-shared-system-input-impact-required',
  ]);
});

test('VSCode co-work live manifest requires primitive chain, cleanup, restoration, and approval refs', () => {
  const passed = validateVSCodeCoWorkLiveAcceptanceManifest(vscodeCoWorkLiveManifest());

  assert.equal(passed.ok, true);
  assert.deepEqual(passed.issues, []);

  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...vscodeCoWorkLiveManifest(),
    status: 'passed',
    productReady: true,
    primitiveChainObserved: ['bind', 'observe', 'act'],
    evidence: {
      ...vscodeCoWorkLiveManifest().evidence,
      approvalRefs: [],
      releaseRefs: ['input-adapter:vscode-cowork:1'],
      restorationRefs: ['front-app-restore:vscode-cowork:1'],
    },
    cleanup: {
      ...vscodeCoWorkLiveManifest().cleanup,
      inputLeaseReleased: false,
      cursorReleased: false,
      mousePositionRestored: false,
      userVSCodeProcessKilled: true,
      userProfileCleared: true,
    },
  });

  assert.equal(failed.ok, false);
  assert.deepEqual(failed.issues, [
    'vscode-cowork-must-not-claim-product-ready',
    'vscode-cowork-live-primitive-chain-incomplete',
    'missing-release-ref:scoped-input-lease',
    'missing-release-ref:cursor-marker',
    'missing-restoration-ref:mouse-position',
    'cleanup-input-lease-not-released',
    'cleanup-cursor-not-released',
    'cleanup-mouse-position-not-restored',
    'cleanup-must-not-kill-user-vscode',
    'cleanup-must-not-clear-user-profile',
    'missing-approval-ref:risk-action-hash',
    'missing-approval-ref:approval',
  ]);
});

test('VSCode co-work live manifest rejects unsafe refs across all evidence groups', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      bindRefs: [...base.evidence.bindRefs, 'providerPayload:secret-window-state'],
      beforeObservationRefs: [...base.evidence.beforeObservationRefs, 'base64:before-observe'],
      hostDecisionRefs: [...base.evidence.hostDecisionRefs, 'https://example.invalid/decision'],
      actionRefs: [...base.evidence.actionRefs, 'secret:act-evidence'],
      afterObservationRefs: [...base.evidence.afterObservationRefs, 'data:application/json;base64,eyJvayI6dHJ1ZX0='],
      controlRefs: [...base.evidence.controlRefs, 'https://example.invalid/control'],
      screenshotRefs: [...base.evidence.screenshotRefs, 'rawScreenshot:data:image/png;base64,abc123'],
      accessibilityRefs: [...base.evidence.accessibilityRefs, 'providerPayload:ax-tree'],
      textRefs: [...base.evidence.textRefs, 'text:secret:visible'],
      approvalRefs: [...base.evidence.approvalRefs, 'token:approval-sidecar'],
      releaseRefs: [...base.evidence.releaseRefs, 'token:release-evidence'],
      restorationRefs: [...base.evidence.restorationRefs, 'password:restore-evidence'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'unsafe-evidence-ref:bind',
    'unsafe-evidence-ref:before-observe',
    'unsafe-evidence-ref:host-decision',
    'unsafe-evidence-ref:act',
    'unsafe-evidence-ref:after-observe',
    'unsafe-evidence-ref:control',
    'unsafe-evidence-ref:screenshot',
    'unsafe-evidence-ref:accessibility',
    'unsafe-evidence-ref:text',
    'unsafe-evidence-ref:approval',
    'unsafe-evidence-ref:release',
    'unsafe-evidence-ref:restoration',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

function vscodeWindow(input: {
  windowRef: string;
  titleRef?: string;
}) {
  return {
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: input.windowRef.replace('window:', 'process:'),
    windowRef: input.windowRef,
    titleRef: input.titleRef ?? `${input.windowRef}:title`,
    frontmostRef: `${input.windowRef}:frontmost`,
  };
}

function freshObservation() {
  return {
    windowRef: 'window:vscode:paper',
    observationRef: 'observation:vscode:current',
    screenshotRef: 'image:vscode:current',
    accessibilityRef: 'accessibility:vscode:current',
    textRefs: ['text:vscode:visible'],
    elementRefs: ['element:vscode:editor', 'element:vscode:file-tabs'],
    freshnessRef: 'freshness:vscode:current',
    editorVisible: true,
    visibleFileRefs: ['file-ref:vscode:paper'],
    userFile: true,
  };
}

function vscodeCoWorkLiveManifest() {
  return {
    schemaVersion: 'sciforge.computer-use.vscode-cowork-live-acceptance.v1' as const,
    status: 'passed' as const,
    maturity: 'live-diagnostic',
    productReady: false,
    userProfileUsed: true,
    sharedSystemInputUsed: true,
    primitiveChainObserved: ['bind', 'observe', 'act', 'observe', 'control(release)'],
    operation: 'save-current-file' as const,
    target: {
      windowRef: 'window:vscode:paper',
      selectedFileRef: 'file-ref:vscode:paper',
    },
    evidence: {
      bindRefs: ['window-action-session:vscode-cowork:1'],
      beforeObservationRefs: ['observation:vscode:before'],
      hostDecisionRefs: ['decision:vscode-cowork:save-confirmed'],
      actionRefs: ['action:vscode-cowork:save'],
      afterObservationRefs: ['observation:vscode:after'],
      controlRefs: ['control:vscode-cowork:release'],
      screenshotRefs: ['image:vscode:before', 'image:vscode:after'],
      accessibilityRefs: ['accessibility:vscode:before', 'accessibility:vscode:after'],
      textRefs: ['text:vscode:visible'],
      approvalRefs: [
        'risk:save-current-file:paper',
        'approval:risk:save-current-file:paper:confirmed',
      ],
      releaseRefs: [
        'scoped-input-lease:vscode-cowork:1',
        'input-adapter:vscode-cowork:1',
        'cursor-marker:vscode-cowork:1',
      ],
      restorationRefs: [
        'front-app-restore:vscode-cowork:1',
        'mouse-position-restore:vscode-cowork:1',
      ],
    },
    cleanup: {
      inputLeaseReleased: true,
      cursorReleased: true,
      adapterReleased: true,
      frontAppRestored: true,
      mousePositionRestored: true,
      userVSCodeProcessKilled: false,
      userProfileCleared: false,
    },
  };
}
