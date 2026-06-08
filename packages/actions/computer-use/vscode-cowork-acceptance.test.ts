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

test('Host-side VSCode co-work blocks raw window and observation refs before choosing an action', () => {
  const rawWindow = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-window-ref',
    operation: 'focus-editor',
    selectedWindowRef: 'Paper.md - Visual Studio Code',
    windowCandidates: [{
      appRef: 'Visual Studio Code',
      processRef: '/Applications/Visual Studio Code.app',
      windowRef: 'Paper.md - Visual Studio Code',
      titleRef: 'Paper.md - Visual Studio Code',
      frontmostRef: 'frontmost VSCode window',
    }],
    latestObservation: {
      ...freshObservation(),
      windowRef: 'Paper.md - Visual Studio Code',
    },
  });

  assert.equal(rawWindow.status, 'blocked');
  assert.equal(rawWindow.blockedReason, 'vscode_cowork_no_window_candidates');
  assert.equal(rawWindow.primitive, undefined);
  assert.equal(rawWindow.action, undefined);
  assert.doesNotMatch(JSON.stringify(rawWindow), /Paper\.md|Visual Studio Code|Applications/);

  const rawObservation = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-observation-ref',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      observationRef: 'visible editor with paper.md',
      screenshotRef: '/tmp/paper-window.png',
      accessibilityRef: 'raw AX tree for paper.md',
      textRefs: ['paper.md visible text'],
      elementRefs: ['editor element'],
      freshnessRef: 'fresh observation',
    },
  });

  assert.equal(rawObservation.status, 'blocked');
  assert.equal(rawObservation.blockedReason, 'vscode_cowork_observe_refs_required');
  assert.equal(rawObservation.primitive, undefined);
  assert.equal(rawObservation.action, undefined);
  assert.doesNotMatch(JSON.stringify(rawObservation), /paper\.md|visible editor|raw AX|tmp\/paper-window|fresh observation/);
});

test('Host-side VSCode co-work blocks window candidates without bind identity refs', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:missing-window-identity-refs',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [{
      appRef: 'macos-app:com.microsoft.VSCode',
      windowRef: 'window:vscode:paper',
    }],
    latestObservation: freshObservation(),
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_window_candidate_identity_refs_required');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.ok(decision.refs.includes('chat-request:vscode-cowork:missing-window-identity-refs'));
  assert.ok(decision.refs.includes('macos-app:com.microsoft.VSCode'));
  assert.ok(decision.refs.includes('window:vscode:paper'));
});

test('Host-side VSCode co-work blocks raw selected target refs instead of ignoring them', () => {
  const rawSelectedWindow = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-selected-window',
    operation: 'focus-editor',
    selectedWindowRef: 'Paper.md - Visual Studio Code',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
  });

  assert.equal(rawSelectedWindow.status, 'blocked');
  assert.equal(rawSelectedWindow.blockedReason, 'vscode_cowork_selected_window_ref_invalid');
  assert.equal(rawSelectedWindow.primitive, undefined);
  assert.equal(rawSelectedWindow.action, undefined);
  assert.ok(rawSelectedWindow.refs.includes('chat-request:vscode-cowork:raw-selected-window'));
  assert.ok(rawSelectedWindow.refs.includes('window:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(rawSelectedWindow), /Paper\.md|Visual Studio Code/);

  const rawSelectedFile = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-selected-file',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: '/Users/example/paper.md',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    draftTextRef: 'text-ref:vscode:draft',
  });

  assert.equal(rawSelectedFile.status, 'blocked');
  assert.equal(rawSelectedFile.blockedReason, 'vscode_cowork_selected_file_ref_invalid');
  assert.equal(rawSelectedFile.primitive, undefined);
  assert.equal(rawSelectedFile.action, undefined);
  assert.ok(rawSelectedFile.refs.includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(rawSelectedFile), /\/Users\/example\/paper\.md|paper\.md/);
});

test('Host-side VSCode co-work blocks task-shaped operations before consuming observe refs', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:unsupported-operation',
    operation: 'replace every TODO across this repo' as any,
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_operation_required');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.ok(decision.refs.includes('chat-request:vscode-cowork:unsupported-operation'));
  assert.ok(decision.refs.includes('window:vscode:paper'));
  assert.ok(!decision.refs.includes('observation:vscode:current'));
  assert.doesNotMatch(JSON.stringify(decision), /replace every TODO|across this repo|planner|product-ready/i);
});

test('Host-side VSCode co-work blocks mixed raw and refs-first window candidates', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:mixed-window-candidates',
    operation: 'focus-editor',
    windowCandidates: [
      vscodeWindow({ windowRef: 'window:vscode:paper', titleRef: 'text:title:paper' }),
      {
        appRef: 'Visual Studio Code',
        processRef: '/Applications/Visual Studio Code.app',
        windowRef: 'Notes.md - Visual Studio Code',
        titleRef: 'Notes.md - Visual Studio Code',
        frontmostRef: 'frontmost VSCode window',
      },
    ],
    latestObservation: freshObservation(),
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_window_candidate_refs_invalid');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.ok(decision.refs.includes('chat-request:vscode-cowork:mixed-window-candidates'));
  assert.ok(decision.refs.includes('window:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(decision), /Notes\.md|Visual Studio Code|Applications|frontmost VSCode/);
});

test('Host-side VSCode co-work blocks stale or incomplete observe refs before selecting an action', () => {
  const stale = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:stale',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      windowRef: 'window:vscode:paper',
      sessionRef: 'window-action-session:vscode-cowork:1',
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

  const editorHiddenRead = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:editor-hidden-read',
    operation: 'read-visible-text',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      editorVisible: false,
    },
  });

  assert.equal(editorHiddenRead.status, 'blocked');
  assert.equal(editorHiddenRead.blockedReason, 'vscode_cowork_editor_not_visible');
  assert.equal(editorHiddenRead.primitive, undefined);
  assert.equal(editorHiddenRead.action, undefined);

  const editorElementMissing = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:editor-element-missing',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      elementRefs: ['element:vscode:file-tabs'],
      editorVisible: true,
    },
  });

  assert.equal(editorElementMissing.status, 'blocked');
  assert.equal(editorElementMissing.blockedReason, 'vscode_cowork_editor_element_ref_required');
  assert.equal(editorElementMissing.primitive, undefined);
  assert.equal(editorElementMissing.action, undefined);
  assert.ok(editorElementMissing.refs.includes('element:vscode:file-tabs'));

  const missingSession = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:missing-session',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      sessionRef: undefined,
    },
  });

  assert.equal(missingSession.status, 'blocked');
  assert.equal(missingSession.blockedReason, 'vscode_cowork_observe_session_ref_required');
  assert.equal(missingSession.primitive, undefined);
  assert.equal(missingSession.action, undefined);
});

test('Host-side VSCode co-work blocks mixed raw and refs-first observe refs', () => {
  const mixedObservation = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:mixed-observe-refs',
    operation: 'focus-editor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      textRefs: ['text:vscode:visible', 'paper.md raw visible text'],
      elementRefs: ['element:vscode:editor', 'raw editor element'],
    },
  });

  assert.equal(mixedObservation.status, 'blocked');
  assert.equal(mixedObservation.blockedReason, 'vscode_cowork_observe_refs_invalid');
  assert.equal(mixedObservation.primitive, undefined);
  assert.equal(mixedObservation.action, undefined);
  assert.ok(mixedObservation.refs.includes('observation:vscode:current'));
  assert.ok(mixedObservation.refs.includes('text:vscode:visible'));
  assert.doesNotMatch(JSON.stringify(mixedObservation), /paper\.md raw visible text|raw editor element/);
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

test('Host-side VSCode co-work blocks mixed raw and refs-first visible file refs', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:mixed-visible-file-refs',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [{
      ...vscodeWindow({ windowRef: 'window:vscode:paper' }),
      visibleFileRefs: ['file-ref:vscode:paper', '/Users/example/paper.md'],
    }],
    latestObservation: {
      ...freshObservation(),
      visibleFileRefs: ['file-ref:vscode:paper', 'Paper.md'],
    },
    draftTextRef: 'text-ref:vscode:draft',
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_visible_file_refs_invalid');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.ok(decision.refs.includes('file-ref:vscode:paper'));
  assert.doesNotMatch(JSON.stringify(decision), /\/Users\/example\/paper\.md|Paper\.md|paper\.md/);
});

test('Host-side VSCode co-work blocks file-target operations without refs-first file refs', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-file-path',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      visibleFileRefs: ['/Users/example/paper.md'],
    },
    draftTextRef: 'text-ref:vscode:draft',
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.blockedReason, 'vscode_cowork_target_file_refs_required');
  assert.equal(decision.primitive, undefined);
  assert.equal(decision.action, undefined);
  assert.ok(decision.refs.includes('observation:vscode:current'));
  assert.doesNotMatch(JSON.stringify(decision), /\/Users\/example\/paper\.md|paper\.md/);
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

  const rawDraftText = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-draft-text',
    operation: 'insert-draft',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    draftTextRef: 'Please insert this raw draft body into the editor.',
  });

  assert.equal(rawDraftText.status, 'blocked');
  assert.equal(rawDraftText.blockedReason, 'vscode_cowork_draft_text_ref_required');
  assert.equal(rawDraftText.primitive, undefined);
  assert.equal(rawDraftText.action, undefined);
  assert.ok(rawDraftText.refs.includes('observation:vscode:current'));
  assert.doesNotMatch(JSON.stringify(rawDraftText), /Please insert this raw draft body|rawDraftText|clipboard|providerPayload|base64|planner/i);
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
  assert.ok(decision.refs.includes('window-action-session:vscode-cowork:1'));
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

test('Host-side VSCode co-work requires refs-first cursor movement before moving the cursor', () => {
  const missingCursorMove = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:missing-cursor-move-ref',
    operation: 'move-cursor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
  });

  assert.equal(missingCursorMove.status, 'blocked');
  assert.equal(missingCursorMove.blockedReason, 'vscode_cowork_cursor_move_ref_required');
  assert.equal(missingCursorMove.primitive, undefined);
  assert.equal(missingCursorMove.action, undefined);

  const rawCursorMove = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:raw-cursor-move-ref',
    operation: 'move-cursor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    cursorMoveRef: 'move to next paragraph',
  });

  assert.equal(rawCursorMove.status, 'blocked');
  assert.equal(rawCursorMove.blockedReason, 'vscode_cowork_cursor_move_ref_required');
  assert.equal(rawCursorMove.primitive, undefined);
  assert.equal(rawCursorMove.action, undefined);
  assert.doesNotMatch(JSON.stringify(rawCursorMove), /move to next paragraph|planner|task|goal/);
});

test('Host-side VSCode co-work moves the cursor only as one Host-selected atomic key action', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:move-cursor-right',
    operation: 'move-cursor',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    cursorMoveRef: 'cursor-move:vscode:right',
  });

  assert.equal(decision.status, 'ready');
  assert.equal(decision.primitive, 'act');
  assert.deepEqual(decision.action, {
    type: 'key',
    key: 'ArrowRight',
    elementRef: 'element:vscode:editor',
  });
  assert.ok(decision.refs.includes('cursor-move:vscode:right'));
  assert.doesNotMatch(JSON.stringify(decision), /planner|task|goal|move to/);
});

test('Host-side VSCode co-work requires refs-first selection and replacement refs before replacing selected text', () => {
  const missingSelection = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:replace-selection-missing-selection',
    operation: 'replace-selection',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    replacementTextRef: 'text-ref:vscode:replacement',
    riskActionHash: 'risk:replace-selection:paper',
  });

  assert.equal(missingSelection.status, 'blocked');
  assert.equal(missingSelection.blockedReason, 'vscode_cowork_selection_ref_required');
  assert.equal(missingSelection.primitive, undefined);
  assert.equal(missingSelection.action, undefined);

  const rawSelection = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:replace-selection-raw-selection',
    operation: 'replace-selection',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    selectionRef: 'currently highlighted paragraph',
    replacementTextRef: 'text-ref:vscode:replacement',
    riskActionHash: 'risk:replace-selection:paper',
  });

  assert.equal(rawSelection.status, 'blocked');
  assert.equal(rawSelection.blockedReason, 'vscode_cowork_selection_ref_required');
  assert.equal(rawSelection.primitive, undefined);
  assert.equal(rawSelection.action, undefined);
  assert.doesNotMatch(JSON.stringify(rawSelection), /currently highlighted paragraph|planner|task|goal/);

  const rawReplacement = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:replace-selection-raw-replacement',
    operation: 'replace-selection',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    selectionRef: 'selection-ref:vscode:current',
    replacementTextRef: 'replace with this raw body',
    riskActionHash: 'risk:replace-selection:paper',
  });

  assert.equal(rawReplacement.status, 'blocked');
  assert.equal(rawReplacement.blockedReason, 'vscode_cowork_replacement_text_ref_required');
  assert.equal(rawReplacement.primitive, undefined);
  assert.equal(rawReplacement.action, undefined);
  assert.ok(rawReplacement.refs.includes('selection-ref:vscode:current'));
  assert.doesNotMatch(JSON.stringify(rawReplacement), /replace with this raw body|planner|task|goal/);
});

test('Host-side VSCode co-work requires confirmation before replacing selected user-file text', () => {
  const unconfirmed = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:replace-selection-unconfirmed',
    operation: 'replace-selection',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    selectionRef: 'selection-ref:vscode:current',
    replacementTextRef: 'text-ref:vscode:replacement',
    riskActionHash: 'risk:replace-selection:file-ref:vscode:paper',
  });

  assert.equal(unconfirmed.status, 'needs-confirmation');
  assert.equal(unconfirmed.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.equal(unconfirmed.primitive, undefined);
  assert.equal(unconfirmed.action, undefined);
  assert.equal(unconfirmed.confirmation?.riskActionHash, 'risk:replace-selection:file-ref:vscode:paper');
  assert.ok(unconfirmed.refs.includes('selection-ref:vscode:current'));
  assert.ok(unconfirmed.refs.includes('text-ref:vscode:replacement'));
  assert.ok(unconfirmed.refs.includes('risk:replace-selection:file-ref:vscode:paper'));
});

test('Host-side VSCode co-work replaces selected user-file text only after matching confirmation', () => {
  const decision = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:replace-selection-confirmed',
    operation: 'replace-selection',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    selectionRef: 'selection-ref:vscode:current',
    replacementTextRef: 'text-ref:vscode:replacement',
    riskActionHash: 'risk:replace-selection:file-ref:vscode:paper',
    confirmationRef: 'approval:risk:replace-selection:file-ref:vscode:paper:file-ref:vscode:paper:confirmed',
  });

  assert.equal(decision.status, 'ready');
  assert.equal(decision.primitive, 'act');
  assert.deepEqual(decision.action, {
    type: 'type',
    textRef: 'text-ref:vscode:replacement',
    elementRef: 'element:vscode:editor',
  });
  assert.equal(decision.risk?.actionHash, 'risk:replace-selection:file-ref:vscode:paper');
  assert.equal(decision.approvalRef, 'approval:risk:replace-selection:file-ref:vscode:paper:file-ref:vscode:paper:confirmed');
  assert.ok(decision.refs.includes('selection-ref:vscode:current'));
  assert.ok(decision.refs.includes('text-ref:vscode:replacement'));
  assert.doesNotMatch(JSON.stringify(decision), /raw body|planner|task|goal/);
});

test('Host-side VSCode co-work requires confirmation before real-file save, undo, bulk replace, or cross-file modification', () => {
  for (const operation of ['save-current-file', 'undo-last-action', 'bulk-replace', 'cross-file-modify'] as const) {
    const decision = decideVSCodeCoWorkNextPrimitive({
      requestRef: `chat-request:vscode-cowork:${operation}`,
      operation,
      selectedWindowRef: 'window:vscode:paper',
      windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
      latestObservation: freshObservation(),
      riskActionHash: `risk:${operation}:file-ref:vscode:paper`,
    });

    assert.equal(decision.status, 'needs-confirmation', operation);
    assert.equal(decision.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation', operation);
    assert.equal(decision.primitive, undefined, operation);
    assert.equal(decision.action, undefined, operation);
    assert.equal(decision.confirmation?.riskActionHash, `risk:${operation}:file-ref:vscode:paper`, operation);
    assert.ok(decision.refs.includes(`risk:${operation}:file-ref:vscode:paper`), operation);
  }

  const bareNonUserFileFlag = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-non-user-without-scope-ref',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      userFile: false,
    },
  });

  assert.equal(bareNonUserFileFlag.status, 'blocked');
  assert.equal(bareNonUserFileFlag.blockedReason, 'vscode_cowork_non_user_file_scope_ref_required');
  assert.equal(bareNonUserFileFlag.primitive, undefined);
  assert.equal(bareNonUserFileFlag.action, undefined);
  assert.ok(bareNonUserFileFlag.refs.includes('file-ref:vscode:paper'));

  const unboundNonUserFileScope = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-non-user-unbound-scope',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      userFile: false,
      nonUserFileScopeRef: 'non-user-file-scope:vscode:scratch',
    },
  });

  assert.equal(unboundNonUserFileScope.status, 'blocked');
  assert.equal(unboundNonUserFileScope.blockedReason, 'vscode_cowork_non_user_file_scope_target_ref_required');
  assert.equal(unboundNonUserFileScope.primitive, undefined);
  assert.equal(unboundNonUserFileScope.action, undefined);
  assert.ok(unboundNonUserFileScope.refs.includes('file-ref:vscode:paper'));
  assert.ok(unboundNonUserFileScope.refs.includes('non-user-file-scope:vscode:scratch'));

  const scopedNonUserFile = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-non-user-scoped',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: {
      ...freshObservation(),
      userFile: false,
      nonUserFileScopeRef: 'non-user-file-scope:file-ref:vscode:paper:scratch',
    },
  });

  assert.equal(scopedNonUserFile.status, 'ready');
  assert.equal(scopedNonUserFile.primitive, 'act');
  assert.equal(scopedNonUserFile.risk, undefined);
  assert.equal(scopedNonUserFile.approvalRef, undefined);
  assert.ok(scopedNonUserFile.refs.includes('non-user-file-scope:file-ref:vscode:paper:scratch'));

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

  const rawApprovalWithoutRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-raw-approval',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    confirmationRef: 'approval:/Users/example/paper.md:confirmed',
  });

  assert.equal(rawApprovalWithoutRiskHash.status, 'blocked');
  assert.equal(rawApprovalWithoutRiskHash.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
  assert.equal(rawApprovalWithoutRiskHash.primitive, undefined);
  assert.equal(rawApprovalWithoutRiskHash.action, undefined);
  assert.doesNotMatch(JSON.stringify(rawApprovalWithoutRiskHash), /\/Users\/example\/paper\.md|paper\.md/);

  const rawRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-raw-risk',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'save /Users/example/paper.md',
  });

  assert.equal(rawRiskHash.status, 'blocked');
  assert.equal(rawRiskHash.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
  assert.equal(rawRiskHash.primitive, undefined);
  assert.equal(rawRiskHash.action, undefined);
  assert.doesNotMatch(JSON.stringify(rawRiskHash), /\/Users\/example\/paper\.md|paper\.md/);

  const prefixedRawPathRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-prefixed-raw-risk',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:/Users/example/paper.md',
  });

  assert.equal(prefixedRawPathRiskHash.status, 'blocked');
  assert.equal(prefixedRawPathRiskHash.blockedReason, 'vscode_cowork_real_file_change_risk_hash_required');
  assert.equal(prefixedRawPathRiskHash.primitive, undefined);
  assert.equal(prefixedRawPathRiskHash.action, undefined);
  assert.doesNotMatch(JSON.stringify(prefixedRawPathRiskHash), /\/Users\/example\/paper\.md|paper\.md/);

  const unboundTargetRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-unbound-target-risk',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:paper',
    confirmationRef: 'approval:risk:save-current-file:paper:file-ref:vscode:paper:confirmed',
  });

  assert.equal(unboundTargetRiskHash.status, 'blocked');
  assert.equal(unboundTargetRiskHash.blockedReason, 'vscode_cowork_real_file_change_risk_hash_target_ref_required');
  assert.equal(unboundTargetRiskHash.primitive, undefined);
  assert.equal(unboundTargetRiskHash.action, undefined);
  assert.ok(unboundTargetRiskHash.refs.includes('file-ref:vscode:paper'));
  assert.ok(unboundTargetRiskHash.refs.includes('risk:save-current-file:paper'));
  assert.ok(unboundTargetRiskHash.refs.includes('approval:risk:save-current-file:paper:file-ref:vscode:paper:confirmed'));

  const approvalWithEmbeddedRiskHash = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-approval-embedded-risk',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
    confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper-old:file-ref:vscode:paper:confirmed',
  });

  assert.equal(approvalWithEmbeddedRiskHash.status, 'needs-confirmation');
  assert.equal(approvalWithEmbeddedRiskHash.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.equal(approvalWithEmbeddedRiskHash.primitive, undefined);
  assert.equal(approvalWithEmbeddedRiskHash.action, undefined);
  assert.ok(approvalWithEmbeddedRiskHash.refs.includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok(approvalWithEmbeddedRiskHash.refs.includes('approval:risk:save-current-file:file-ref:vscode:paper-old:file-ref:vscode:paper:confirmed'));

  const approvalWithoutConfirmationSuffix = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-approval-without-confirmation-suffix',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
    confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper',
  });

  assert.equal(approvalWithoutConfirmationSuffix.status, 'needs-confirmation');
  assert.equal(approvalWithoutConfirmationSuffix.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.equal(approvalWithoutConfirmationSuffix.primitive, undefined);
  assert.equal(approvalWithoutConfirmationSuffix.action, undefined);
  assert.ok(approvalWithoutConfirmationSuffix.refs.includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok(approvalWithoutConfirmationSuffix.refs.includes('approval:risk:save-current-file:file-ref:vscode:paper'));

  const approvalWithoutFileTarget = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-approval-without-file-target',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    selectedFileRef: 'file-ref:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
    confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper:confirmed',
  });

  assert.equal(approvalWithoutFileTarget.status, 'needs-confirmation');
  assert.equal(approvalWithoutFileTarget.blockedReason, 'vscode_cowork_real_file_change_needs_confirmation');
  assert.equal(approvalWithoutFileTarget.primitive, undefined);
  assert.equal(approvalWithoutFileTarget.action, undefined);
  assert.ok(approvalWithoutFileTarget.refs.includes('file-ref:vscode:paper'));
  assert.ok(approvalWithoutFileTarget.refs.includes('approval:risk:save-current-file:file-ref:vscode:paper:confirmed'));

  const confirmedSave = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:save-confirmed',
    operation: 'save-current-file',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:save-current-file:file-ref:vscode:paper',
    confirmationRef: 'approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed',
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
    actionHash: 'risk:save-current-file:file-ref:vscode:paper',
  });
  assert.equal(confirmedSave.approvalRef, 'approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed');
  assert.ok(confirmedSave.refs.includes('risk:save-current-file:file-ref:vscode:paper'));
  assert.ok(confirmedSave.refs.includes('approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed'));

  const confirmedUndo = decideVSCodeCoWorkNextPrimitive({
    requestRef: 'chat-request:vscode-cowork:undo-confirmed',
    operation: 'undo-last-action',
    selectedWindowRef: 'window:vscode:paper',
    windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
    latestObservation: freshObservation(),
    riskActionHash: 'risk:undo-last-action:file-ref:vscode:paper',
    confirmationRef: 'approval:risk:undo-last-action:file-ref:vscode:paper:file-ref:vscode:paper:confirmed',
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
    actionHash: 'risk:undo-last-action:file-ref:vscode:paper',
  });
  assert.equal(confirmedUndo.approvalRef, 'approval:risk:undo-last-action:file-ref:vscode:paper:file-ref:vscode:paper:confirmed');
  assert.ok(confirmedUndo.refs.includes('risk:undo-last-action:file-ref:vscode:paper'));
  assert.ok(confirmedUndo.refs.includes('approval:risk:undo-last-action:file-ref:vscode:paper:file-ref:vscode:paper:confirmed'));
});

test('Host-side VSCode co-work blocks confirmed bulk and cross-file requests until Host decomposes them', () => {
  for (const operation of ['bulk-replace', 'cross-file-modify'] as const) {
    const decision = decideVSCodeCoWorkNextPrimitive({
      requestRef: `chat-request:vscode-cowork:${operation}-confirmed`,
      operation,
      selectedWindowRef: 'window:vscode:paper',
      selectedFileRef: 'file-ref:vscode:paper',
      windowCandidates: [vscodeWindow({ windowRef: 'window:vscode:paper' })],
      latestObservation: freshObservation(),
      riskActionHash: `risk:${operation}:file-ref:vscode:paper`,
      confirmationRef: `approval:risk:${operation}:file-ref:vscode:paper:file-ref:vscode:paper:confirmed`,
    });

    assert.equal(decision.status, 'blocked', operation);
    assert.equal(decision.blockedReason, 'vscode_cowork_non_atomic_operation_requires_host_decomposition', operation);
    assert.equal(decision.primitive, undefined, operation);
    assert.equal(decision.action, undefined, operation);
    assert.ok(decision.refs.includes(`risk:${operation}:file-ref:vscode:paper`), operation);
    assert.ok(decision.refs.includes(`approval:risk:${operation}:file-ref:vscode:paper:file-ref:vscode:paper:confirmed`), operation);
    assert.deepEqual(decision.repairHints, [{
      code: 'decompose-file-change-into-atomic-primitives',
      message: 'Host must decompose bulk replacement or cross-file modification into explicit refs-first atomic editor primitives; Computer Use core must not plan or execute a batch edit.',
      suggestedPrimitive: 'act',
    }], operation);
  }
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

test('VSCode co-work cleanup validation rejects unsafe release and restoration refs', () => {
  const failed = validateVSCodeCoWorkRunCleanup({
    maturity: 'live-diagnostic',
    productReady: false,
    userProfileUsed: true,
    sharedSystemInputUsed: true,
    evidence: {
      releaseRefs: [
        'scoped-input-lease:vscode-cowork:1',
        'input-adapter:/Users/example/.vscode/profile',
        'cursor-marker:vscode-cowork:1',
      ],
      restorationRefs: [
        'front-app-restore:vscode-cowork:1',
        'mouse-position-restore:/Users/example/.vscode/profile',
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

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('unsafe-evidence-ref:release'));
  assert.ok(failed.issues.includes('unsafe-evidence-ref:restoration'));
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
    'missing-control-ref:scoped-input-lease',
    'missing-control-ref:cursor-marker',
    'missing-control-ref:mouse-position',
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
    'missing-approval-ref:target-file',
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

test('VSCode co-work live manifest rejects raw path risk and approval evidence refs', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      approvalRefs: [
        'risk:/Users/example/paper.md',
        'approval:/Users/example/paper.md:confirmed',
      ],
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-approval-ref:risk-action-hash'));
  assert.ok(failed.issues.includes('missing-approval-ref:approval'));
  assert.ok(failed.issues.includes('unsafe-evidence-ref:approval'));
});

test('VSCode co-work live manifest requires approval refs to bind the selected file target', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      approvalRefs: base.evidence.approvalRefs.filter((ref) => ref !== base.target.selectedFileRef),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-approval-ref:target-file'));
});

test('VSCode co-work live manifest requires risk refs to bind the selected file target', () => {
  const base = vscodeCoWorkLiveManifest();
  const boundRiskRef = 'risk:save-current-file:file-ref:vscode:paper';
  const unboundRiskRef = 'risk:save-current-file:paper';
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      hostDecisionRefs: base.evidence.hostDecisionRefs.map((ref) =>
        ref === boundRiskRef ? unboundRiskRef : ref,
      ),
      approvalRefs: base.evidence.approvalRefs.map((ref) =>
        ref === boundRiskRef ? unboundRiskRef : ref,
      ),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-host-decision-ref:risk-action-hash-target-file'));
  assert.ok(failed.issues.includes('missing-approval-ref:risk-action-hash-target-file'));
});

test('VSCode co-work live manifest requires refs-first target window and file refs for user-file changes', () => {
  const base = vscodeCoWorkLiveManifest();
  const rawWindow = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    target: {
      ...base.target,
      windowRef: 'Paper.md - Visual Studio Code',
    },
  });

  assert.equal(rawWindow.ok, false);
  assert.ok(rawWindow.issues.includes('invalid-target-ref:window'));

  const missingFile = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    target: {
      windowRef: 'window:vscode:paper',
    },
  });

  assert.equal(missingFile.ok, false);
  assert.ok(missingFile.issues.includes('missing-target-ref:file'));

  const rawFile = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    target: {
      windowRef: 'window:vscode:paper',
      selectedFileRef: '/Users/example/paper.md',
    },
  });

  assert.equal(rawFile.ok, false);
  assert.ok(rawFile.issues.includes('invalid-target-ref:file'));
  assert.doesNotMatch(JSON.stringify(rawFile), /\/Users\/example\/paper\.md|paper\.md/);
});

test('VSCode co-work live manifest requires action input and stale invalidation refs', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      beforeObservationRefs: ['image:vscode:before'],
      actionRefs: ['action:vscode-cowork:save'],
      afterObservationRefs: ['text:vscode:after'],
      controlRefs: ['action:vscode-cowork:release'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'invalid-evidence-ref:before-observe',
    'missing-action-ref:executor-event',
    'missing-action-ref:input-event',
    'missing-action-ref:input-adapter',
    'missing-action-ref:cursor-marker',
    'missing-action-ref:scoped-input-lease',
    'missing-action-ref:stale-invalidation',
    'invalid-evidence-ref:after-observe',
    'invalid-evidence-ref:control',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires before and after visual refs', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      screenshotRefs: ['observation:vscode:before'],
      accessibilityRefs: ['image:vscode:after'],
      textRefs: ['text:vscode:visible-before'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'invalid-evidence-ref:screenshot',
    'missing-evidence-ref:before-after-screenshot',
    'invalid-evidence-ref:accessibility',
    'missing-evidence-ref:before-after-accessibility',
    'missing-evidence-ref:before-after-text',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest binds visual refs to before and after observe evidence', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      beforeObservationRefs: ['observation:vscode:before', 'freshness:vscode:before'],
      afterObservationRefs: ['observation:vscode:after', 'window:vscode:paper', 'freshness:vscode:after'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'missing-before-observe-ref:screenshot',
    'missing-before-observe-ref:accessibility',
    'missing-before-observe-ref:text',
    'missing-after-observe-ref:screenshot',
    'missing-after-observe-ref:accessibility',
    'missing-after-observe-ref:text',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires before observe refs to bind the target window', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      beforeObservationRefs: [
        'observation:vscode:before',
        'freshness:vscode:before',
        'image:vscode:before',
        'accessibility:vscode:before',
        'text:vscode:visible-before',
      ],
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-before-observe-ref:target-window'));
});

test('VSCode co-work live manifest requires before observe refs to bind the selected file target', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      beforeObservationRefs: base.evidence.beforeObservationRefs.filter((ref) => ref !== base.target.selectedFileRef),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-before-observe-ref:target-file'));
});

test('VSCode co-work live manifest requires observe refs to bind the active session', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      beforeObservationRefs: base.evidence.beforeObservationRefs.map((ref) =>
        ref.startsWith('window-action-session:')
          ? 'window-action-session:vscode-cowork:other-before'
          : ref,
      ),
      afterObservationRefs: base.evidence.afterObservationRefs.map((ref) =>
        ref.startsWith('window-action-session:')
          ? 'window-action-session:vscode-cowork:other-after'
          : ref,
      ),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-before-observe-ref:active-session'));
  assert.ok(failed.issues.includes('missing-after-observe-ref:active-session'));
});

test('VSCode co-work live manifest requires refs-first bind target evidence', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      bindRefs: ['window-action-session:vscode-cowork:1'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'missing-bind-ref:target-window',
    'missing-bind-ref:app',
    'missing-bind-ref:process',
    'missing-bind-ref:frontmost',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires bind refs to assign released input resources', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      bindRefs: base.evidence.bindRefs.filter((ref) =>
        !ref.startsWith('scoped-input-lease:')
          && !ref.startsWith('input-adapter:')
          && !ref.startsWith('cursor-marker:')
          && !ref.startsWith('cursor:'),
      ),
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'missing-bind-ref:scoped-input-lease',
    'missing-bind-ref:input-adapter',
    'missing-bind-ref:cursor-marker',
    'missing-bind-release-ref:scoped-input-lease',
    'missing-bind-release-ref:input-adapter',
    'missing-bind-release-ref:cursor-marker',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires Host decision refs to bind request, observe, target, and approval evidence', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      hostDecisionRefs: ['decision:vscode-cowork:save-confirmed'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'missing-host-decision-ref:request',
    'missing-host-decision-ref:target-window',
    'missing-host-decision-ref:before-observe',
    'missing-host-decision-ref:freshness',
    'missing-host-decision-ref:action',
    'missing-host-decision-ref:target-file',
    'missing-host-decision-ref:risk-action-hash',
    'missing-host-decision-ref:approval',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires Host decision refs to bind the active session', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      hostDecisionRefs: base.evidence.hostDecisionRefs.map((ref) =>
        ref.startsWith('window-action-session:')
          ? 'window-action-session:vscode-cowork:other-decision'
          : ref,
      ),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-host-decision-ref:active-session'));
});

test('VSCode co-work live manifest requires Host decision refs to bind the executed action', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      hostDecisionRefs: base.evidence.hostDecisionRefs.filter((ref) => !ref.startsWith('action:') && !ref.startsWith('window-action:')),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-host-decision-ref:action'));

  const mismatched = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      hostDecisionRefs: [
        ...base.evidence.hostDecisionRefs.filter((ref) => !ref.startsWith('action:') && !ref.startsWith('window-action:')),
        'action:vscode-cowork:other',
      ],
    },
  });

  assert.equal(mismatched.ok, false);
  assert.ok(mismatched.issues.includes('missing-host-decision-ref:action'));
});

test('VSCode co-work live manifest requires Host decision and action refs to bind the editor element target', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      beforeObservationRefs: base.evidence.beforeObservationRefs.filter((ref) => !ref.startsWith('element:')),
      hostDecisionRefs: base.evidence.hostDecisionRefs.filter((ref) => !ref.startsWith('element:')),
      actionRefs: base.evidence.actionRefs.filter((ref) => !ref.startsWith('element:')),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-before-observe-ref:editor-element'));
  assert.ok(failed.issues.includes('missing-host-decision-ref:editor-element'));
  assert.ok(failed.issues.includes('missing-action-ref:editor-element'));
});

test('VSCode co-work live manifest requires after observe refs to bind target window and freshness', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      afterObservationRefs: ['observation:vscode:after'],
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-after-observe-ref:target-window'));
  assert.ok(failed.issues.includes('missing-after-observe-ref:freshness'));
});

test('VSCode co-work live manifest requires after observe refs to bind the selected file target', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      afterObservationRefs: base.evidence.afterObservationRefs.filter((ref) => ref !== base.target.selectedFileRef),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-after-observe-ref:target-file'));
});

test('VSCode co-work live manifest requires after observe refs to bind the editor element target', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      afterObservationRefs: base.evidence.afterObservationRefs.filter((ref) => !ref.startsWith('element:')),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-after-observe-ref:editor-element'));
});

test('VSCode co-work live manifest requires control refs to bind release and restoration evidence', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      controlRefs: ['control:vscode-cowork:release'],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'missing-control-ref:session',
    'missing-control-ref:scoped-input-lease',
    'missing-control-ref:input-adapter',
    'missing-control-ref:cursor-marker',
    'missing-control-ref:front-app',
    'missing-control-ref:mouse-position',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires control refs to bind the active session', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      controlRefs: base.evidence.controlRefs.map((ref) =>
        ref.startsWith('window-action-session:')
          ? 'window-action-session:vscode-cowork:other'
          : ref,
      ),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-control-ref:active-session'));
});

test('VSCode co-work live manifest requires action refs to bind released input resources', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      actionRefs: [
        'action:vscode-cowork:save',
        'executor-event:vscode-cowork:save',
        'input-event:vscode-cowork:save',
        'input-adapter:vscode-cowork:other',
        'cursor-marker:vscode-cowork:other',
        'scoped-input-lease:vscode-cowork:other',
        'stale-invalidation:vscode-cowork:before-observation',
      ],
    },
  });

  assert.equal(failed.ok, false);
  for (const issue of [
    'missing-action-release-ref:scoped-input-lease',
    'missing-action-release-ref:input-adapter',
    'missing-action-release-ref:cursor-marker',
  ]) {
    assert.ok(failed.issues.includes(issue), issue);
  }
});

test('VSCode co-work live manifest requires action refs to bind the active session', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      actionRefs: base.evidence.actionRefs.filter((ref) => !ref.startsWith('window-action-session:')),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-action-ref:session'));
});

test('VSCode co-work live manifest requires action refs to bind the target window', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      actionRefs: base.evidence.actionRefs.filter((ref) => ref !== base.target.windowRef),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-action-ref:target-window'));
});

test('VSCode co-work live manifest requires action refs to bind the selected file target', () => {
  const base = vscodeCoWorkLiveManifest();
  const failed = validateVSCodeCoWorkLiveAcceptanceManifest({
    ...base,
    evidence: {
      ...base.evidence,
      actionRefs: base.evidence.actionRefs.filter((ref) => ref !== base.target.selectedFileRef),
    },
  });

  assert.equal(failed.ok, false);
  assert.ok(failed.issues.includes('missing-action-ref:target-file'));
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
    sessionRef: 'window-action-session:vscode-cowork:1',
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
      bindRefs: [
        'window-action-session:vscode-cowork:1',
        'window:vscode:paper',
        'macos-app:com.microsoft.VSCode',
        'process:vscode:paper',
        'frontmost:vscode:paper',
        'scoped-input-lease:vscode-cowork:1',
        'input-adapter:vscode-cowork:1',
        'cursor-marker:vscode-cowork:1',
      ],
      beforeObservationRefs: [
        'observation:vscode:before',
        'window-action-session:vscode-cowork:1',
        'window:vscode:paper',
        'file-ref:vscode:paper',
        'freshness:vscode:before',
        'element:vscode:editor',
        'image:vscode:before',
        'accessibility:vscode:before',
        'text:vscode:visible-before',
      ],
      hostDecisionRefs: [
        'decision:vscode-cowork:save-confirmed',
        'window-action-session:vscode-cowork:1',
        'chat-request:vscode-cowork:save-confirmed',
        'action:vscode-cowork:save',
        'window:vscode:paper',
        'file-ref:vscode:paper',
        'observation:vscode:before',
        'freshness:vscode:before',
        'element:vscode:editor',
        'risk:save-current-file:file-ref:vscode:paper',
        'approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed',
      ],
      actionRefs: [
        'action:vscode-cowork:save',
        'window-action-session:vscode-cowork:1',
        'window:vscode:paper',
        'file-ref:vscode:paper',
        'element:vscode:editor',
        'executor-event:vscode-cowork:save',
        'input-event:vscode-cowork:save',
        'input-adapter:vscode-cowork:1',
        'cursor-marker:vscode-cowork:1',
        'scoped-input-lease:vscode-cowork:1',
        'stale-invalidation:vscode-cowork:before-observation',
      ],
      afterObservationRefs: [
        'observation:vscode:after',
        'window-action-session:vscode-cowork:1',
        'window:vscode:paper',
        'file-ref:vscode:paper',
        'freshness:vscode:after',
        'element:vscode:editor',
        'image:vscode:after',
        'accessibility:vscode:after',
        'text:vscode:visible-after',
      ],
      controlRefs: [
        'control:vscode-cowork:release',
        'window-action-session:vscode-cowork:1',
        'scoped-input-lease:vscode-cowork:1',
        'input-adapter:vscode-cowork:1',
        'cursor-marker:vscode-cowork:1',
        'front-app-restore:vscode-cowork:1',
        'mouse-position-restore:vscode-cowork:1',
      ],
      screenshotRefs: ['image:vscode:before', 'image:vscode:after'],
      accessibilityRefs: ['accessibility:vscode:before', 'accessibility:vscode:after'],
      textRefs: ['text:vscode:visible-before', 'text:vscode:visible-after'],
      approvalRefs: [
        'risk:save-current-file:file-ref:vscode:paper',
        'file-ref:vscode:paper',
        'approval:risk:save-current-file:file-ref:vscode:paper:file-ref:vscode:paper:confirmed',
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
