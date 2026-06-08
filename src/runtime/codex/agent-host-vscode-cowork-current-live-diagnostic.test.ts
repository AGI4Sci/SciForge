import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic,
  runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic,
  runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic,
} from './agent-host-vscode-cowork-current-live-diagnostic.js';

const currentVSCodeLiveEnabled = process.env[VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV] === '1';

test('current VSCode co-work live diagnostic uses real primitive ports shape and Host refs-only decision', async () => {
  const calls: string[] = [];
  const result = await runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-host',
    commandText: '读取我当前打开的 VSCode 可见文本。',
    commandId: 'current-vscode-host-read',
    attemptId: 'current-vscode-host-read-attempt-1',
    workspacePath: '/tmp/workspace',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return {
        appRef: 'macos-app:com.microsoft.VSCode',
        processRef: 'process:vscode:paper',
        windowRef: 'window:vscode:paper',
        titleRef: 'text:title:paper',
        frontmostRef: 'frontmost:vscode:paper',
        fileRefs: ['file-ref:vscode:paper'],
        editorElementRef: 'element:vscode:editor',
        visibleTextRef: 'text:vscode:visible',
        visibleTextSha256Ref: 'text:vscode:visible-sha256',
        screenshotRef: 'image:vscode:current',
        accessibilityRef: 'accessibility:vscode:current',
        freshnessRef: 'freshness:vscode:current',
        observationRef: 'observation:vscode:current',
      };
    },
    restoreFocus: async (ref) => {
      calls.push(`restore-focus:${ref}`);
    },
    restoreMouse: async (ref) => {
      calls.push(`restore-mouse:${ref}`);
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
  assert.equal(result.materializerResult?.claimType, 'computer-use-vscode-cowork-observe-decision');
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.ok(result.agentHostFinalAnswer?.evidenceRefs.includes('observation:vscode:current'));
  assert.ok(result.agentHostFinalAnswer?.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-host'));
  assert.ok(result.agentHostInput?.refs.includes('intent:current-vscode-cowork'));
  assert.ok(result.runtimeTruth?.target?.refs?.includes('window:vscode:paper'));
  assert.ok(result.runtimeTruth?.observation?.refs?.includes('element:vscode:editor'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-host'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-host'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-host'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-host'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-host'));
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-host',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-host',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work live diagnostic stays blocked without explicit env', async () => {
  const result = await runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-host-default',
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, []);
  assert.match(result.message, /missing-env/);
  assert.doesNotMatch(JSON.stringify(result), /product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work live diagnostic preserves restoration refs when bind cannot observe VSCode', async () => {
  const calls: string[] = [];
  const result = await runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-bind-fail',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      throw new Error('current-vscode-not-frontmost');
    },
    captureRestorationState: async () => {
      calls.push('capture-restoration');
      return {
        frontApplicationName: 'Codex',
        mousePosition: { x: 10, y: 20 },
      };
    },
    restoreCapturedState: async (state, refs) => {
      calls.push(`restore-captured:${state.frontApplicationName}:${state.mousePosition?.x},${state.mousePosition?.y}:${refs.frontAppRestoreRef}:${refs.mousePositionRestoreRef}`);
    },
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.message, /current-vscode-not-frontmost/);
  assert.deepEqual(result.primitiveChainObserved, ['bind']);
  assert.ok(result.evidenceRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-bind-fail'));
  assert.ok(result.evidenceRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-bind-fail'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-bind-fail'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-bind-fail'));
  assert.deepEqual(calls, [
    'capture-restoration',
    'read-current-window',
    'restore-captured:Codex:10,20:front-app-restore:current-vscode-cowork:unit-current-vscode-bind-fail:mouse-position-restore:current-vscode-cowork:unit-current-vscode-bind-fail',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work focus-editor diagnostic runs one Host-selected focus act then releases', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-wrapper',
      windowRef: 'window:vscode:focus-wrapper',
      titleRef: 'text:title:focus-wrapper',
      frontmostRef: 'frontmost:vscode:focus-wrapper',
      fileRefs: ['file-ref:vscode:focus-wrapper'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:focus-wrapper-bind',
      visibleTextSha256Ref: 'text:vscode:focus-wrapper-bind-sha256',
      screenshotRef: 'image:vscode:focus-wrapper-bind',
      accessibilityRef: 'accessibility:vscode:focus-wrapper-bind',
      freshnessRef: 'freshness:vscode:focus-wrapper-bind',
      observationRef: 'observation:vscode:focus-wrapper-bind',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-wrapper',
      windowRef: 'window:vscode:focus-wrapper',
      titleRef: 'text:title:focus-wrapper',
      frontmostRef: 'frontmost:vscode:focus-wrapper',
      fileRefs: ['file-ref:vscode:focus-wrapper'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:focus-wrapper-before',
      visibleTextSha256Ref: 'text:vscode:focus-wrapper-before-sha256',
      screenshotRef: 'image:vscode:focus-wrapper-before',
      accessibilityRef: 'accessibility:vscode:focus-wrapper-before',
      freshnessRef: 'freshness:vscode:focus-wrapper-before',
      observationRef: 'observation:vscode:focus-wrapper-before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-wrapper',
      windowRef: 'window:vscode:focus-wrapper',
      titleRef: 'text:title:focus-wrapper',
      frontmostRef: 'frontmost:vscode:focus-wrapper',
      fileRefs: ['file-ref:vscode:focus-wrapper'],
      editorElementRef: 'element:vscode:editor',
      focusedEditorRef: 'focused-editor:vscode:focus-wrapper',
      visibleTextRef: 'text:vscode:focus-wrapper-act-after',
      visibleTextSha256Ref: 'text:vscode:focus-wrapper-act-after-sha256',
      screenshotRef: 'image:vscode:focus-wrapper-act-after',
      accessibilityRef: 'accessibility:vscode:focus-wrapper-act-after',
      freshnessRef: 'freshness:vscode:focus-wrapper-act-after',
      observationRef: 'observation:vscode:focus-wrapper-act-after',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-wrapper',
      windowRef: 'window:vscode:focus-wrapper',
      titleRef: 'text:title:focus-wrapper',
      frontmostRef: 'frontmost:vscode:focus-wrapper',
      fileRefs: ['file-ref:vscode:focus-wrapper'],
      editorElementRef: 'element:vscode:editor',
      focusedEditorRef: 'focused-editor:vscode:focus-wrapper',
      visibleTextRef: 'text:vscode:focus-wrapper-after',
      visibleTextSha256Ref: 'text:vscode:focus-wrapper-after-sha256',
      screenshotRef: 'image:vscode:focus-wrapper-after',
      accessibilityRef: 'accessibility:vscode:focus-wrapper-after',
      freshnessRef: 'freshness:vscode:focus-wrapper-after',
      observationRef: 'observation:vscode:focus-wrapper-after',
    },
  ];

  const result = await runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-focus-wrapper',
    commandText: '聚焦我当前打开的 VSCode 编辑器。',
    commandId: 'current-vscode-host-focus',
    attemptId: 'current-vscode-host-focus-attempt-1',
    workspacePath: '/tmp/workspace',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    pressKeyInCurrentVSCode: async (input) => {
      calls.push(`press-key:${input.key}:${input.beforeObservationRef}`);
    },
    restoreFocus: async (ref) => {
      calls.push(`restore-focus:${ref}`);
    },
    restoreMouse: async (ref) => {
      calls.push(`restore-mouse:${ref}`);
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)']);
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'press-key:Command+1:observation:vscode:focus-wrapper-before',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-focus-wrapper',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-focus-wrapper',
  ]);
  assert.equal(result.materializerResult?.claimType, 'computer-use-vscode-cowork-act-decision');
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.match(result.agentHostFinalAnswer?.text ?? '', /focus-editor/i);
  assert.ok(result.evidenceRefs.includes('action:current-vscode-cowork:unit-current-vscode-focus-wrapper:focus-editor'));
  assert.ok(result.evidenceRefs.includes('executor-event:current-vscode-cowork:unit-current-vscode-focus-wrapper:focus-editor'));
  assert.ok(result.evidenceRefs.includes('input-event:current-vscode-cowork:unit-current-vscode-focus-wrapper:focus-editor'));
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:focus-wrapper'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:current-vscode-host-focus-attempt-1:focus-editor'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-focus-wrapper'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-focus-wrapper'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-focus-wrapper'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-focus-wrapper'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-focus-wrapper'));
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work focus-editor diagnostic accepts Host verifier evidence without focused-editor observe ref', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-verifier-wrapper',
      windowRef: 'window:vscode:focus-verifier-wrapper',
      titleRef: 'text:title:focus-verifier-wrapper',
      frontmostRef: 'frontmost:vscode:focus-verifier-wrapper',
      fileRefs: ['file-ref:vscode:focus-verifier-wrapper'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:focus-verifier-wrapper-bind',
      visibleTextSha256Ref: 'text:vscode:focus-verifier-wrapper-bind-sha256',
      screenshotRef: 'image:vscode:focus-verifier-wrapper-bind',
      accessibilityRef: 'accessibility:vscode:focus-verifier-wrapper-bind',
      freshnessRef: 'freshness:vscode:focus-verifier-wrapper-bind',
      observationRef: 'observation:vscode:focus-verifier-wrapper-bind',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-verifier-wrapper',
      windowRef: 'window:vscode:focus-verifier-wrapper',
      titleRef: 'text:title:focus-verifier-wrapper',
      frontmostRef: 'frontmost:vscode:focus-verifier-wrapper',
      fileRefs: ['file-ref:vscode:focus-verifier-wrapper'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:focus-verifier-wrapper-before',
      visibleTextSha256Ref: 'text:vscode:focus-verifier-wrapper-before-sha256',
      screenshotRef: 'image:vscode:focus-verifier-wrapper-before',
      accessibilityRef: 'accessibility:vscode:focus-verifier-wrapper-before',
      freshnessRef: 'freshness:vscode:focus-verifier-wrapper-before',
      observationRef: 'observation:vscode:focus-verifier-wrapper-before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-verifier-wrapper',
      windowRef: 'window:vscode:focus-verifier-wrapper',
      titleRef: 'text:title:focus-verifier-wrapper',
      frontmostRef: 'frontmost:vscode:focus-verifier-wrapper',
      fileRefs: ['file-ref:vscode:focus-verifier-wrapper'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:focus-verifier-wrapper-act-after',
      visibleTextSha256Ref: 'text:vscode:focus-verifier-wrapper-act-after-sha256',
      screenshotRef: 'image:vscode:focus-verifier-wrapper-act-after',
      accessibilityRef: 'accessibility:vscode:focus-verifier-wrapper-act-after',
      freshnessRef: 'freshness:vscode:focus-verifier-wrapper-act-after',
      observationRef: 'observation:vscode:focus-verifier-wrapper-act-after',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:focus-verifier-wrapper',
      windowRef: 'window:vscode:focus-verifier-wrapper',
      titleRef: 'text:title:focus-verifier-wrapper',
      frontmostRef: 'frontmost:vscode:focus-verifier-wrapper',
      fileRefs: ['file-ref:vscode:focus-verifier-wrapper'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:focus-verifier-wrapper-after',
      visibleTextSha256Ref: 'text:vscode:focus-verifier-wrapper-after-sha256',
      screenshotRef: 'image:vscode:focus-verifier-wrapper-after',
      accessibilityRef: 'accessibility:vscode:focus-verifier-wrapper-after',
      freshnessRef: 'freshness:vscode:focus-verifier-wrapper-after',
      observationRef: 'observation:vscode:focus-verifier-wrapper-after',
    },
  ];

  const result = await runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-focus-verifier-wrapper',
    commandText: '聚焦我当前打开的 VSCode 编辑器。',
    commandId: 'current-vscode-host-focus-verifier',
    attemptId: 'current-vscode-host-focus-verifier-attempt-1',
    workspacePath: '/tmp/workspace',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    pressKeyInCurrentVSCode: async (input) => {
      calls.push(`press-key:${input.key}:${input.beforeObservationRef}`);
    },
    focusedEditorEvidenceVerifier: (input) => {
      calls.push(`verify-focus:${input.afterObservationRef}`);
      assert.ok(input.afterObserveRefs.includes('image:vscode:focus-verifier-wrapper-after'));
      assert.ok(input.afterObserveRefs.includes('accessibility:vscode:focus-verifier-wrapper-after'));
      assert.ok(input.editorElementRefs.includes('element:vscode:editor'));
      assert.ok(input.actionRefs.includes('action:current-vscode-cowork:unit-current-vscode-focus-verifier-wrapper:focus-editor'));
      return {
        status: 'satisfied',
        focusedEditorRef: 'focused-editor:vscode:host-evidence:focus-verifier-wrapper',
        verifierRef: 'verifier:vscode-cowork:current-vscode-host-focus-verifier-attempt-1:focus-editor',
        evidenceRefs: [
          'image:vscode:focus-verifier-wrapper-after',
          'accessibility:vscode:focus-verifier-wrapper-after',
          'element:vscode:editor',
        ],
      };
    },
    restoreFocus: async (ref) => {
      calls.push(`restore-focus:${ref}`);
    },
    restoreMouse: async (ref) => {
      calls.push(`restore-mouse:${ref}`);
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'press-key:Command+1:observation:vscode:focus-verifier-wrapper-before',
    'read-current-window',
    'read-current-window',
    'verify-focus:observation:vscode:focus-verifier-wrapper-after',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-focus-verifier-wrapper',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-focus-verifier-wrapper',
  ]);
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.status, 'satisfied');
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:host-evidence:focus-verifier-wrapper'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:current-vscode-host-focus-verifier-attempt-1:focus-editor'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-focus-verifier-wrapper'));
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work insert-draft diagnostic resolves textRef, types, observes after state, and releases', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-wrapper',
      windowRef: 'window:vscode:insert-wrapper',
      titleRef: 'text:title:insert-wrapper',
      frontmostRef: 'frontmost:vscode:insert-wrapper',
      fileRefs: ['file-ref:vscode:insert-wrapper'],
      editorElementRef: 'element:vscode:editor',
      focusedEditorRef: 'focused-editor:vscode:insert-wrapper',
      visibleTextRef: 'text:vscode:insert-wrapper-bind',
      visibleTextSha256Ref: 'text:vscode:insert-wrapper-bind-sha256',
      screenshotRef: 'image:vscode:insert-wrapper-bind',
      accessibilityRef: 'accessibility:vscode:insert-wrapper-bind',
      freshnessRef: 'freshness:vscode:insert-wrapper-bind',
      observationRef: 'observation:vscode:insert-wrapper-bind',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-wrapper',
      windowRef: 'window:vscode:insert-wrapper',
      titleRef: 'text:title:insert-wrapper',
      frontmostRef: 'frontmost:vscode:insert-wrapper',
      fileRefs: ['file-ref:vscode:insert-wrapper'],
      editorElementRef: 'element:vscode:editor',
      focusedEditorRef: 'focused-editor:vscode:insert-wrapper',
      visibleTextRef: 'text:vscode:insert-wrapper-before',
      visibleTextSha256Ref: 'text:vscode:insert-wrapper-before-sha256',
      screenshotRef: 'image:vscode:insert-wrapper-before',
      accessibilityRef: 'accessibility:vscode:insert-wrapper-before',
      freshnessRef: 'freshness:vscode:insert-wrapper-before',
      observationRef: 'observation:vscode:insert-wrapper-before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-wrapper',
      windowRef: 'window:vscode:insert-wrapper',
      titleRef: 'text:title:insert-wrapper',
      frontmostRef: 'frontmost:vscode:insert-wrapper',
      fileRefs: ['file-ref:vscode:insert-wrapper'],
      editorElementRef: 'element:vscode:editor',
      focusedEditorRef: 'focused-editor:vscode:insert-wrapper',
      visibleTextRef: 'text:vscode:insert-wrapper-act-after',
      visibleTextSha256Ref: 'text:vscode:insert-wrapper-act-after-sha256',
      screenshotRef: 'image:vscode:insert-wrapper-act-after',
      accessibilityRef: 'accessibility:vscode:insert-wrapper-act-after',
      freshnessRef: 'freshness:vscode:insert-wrapper-act-after',
      observationRef: 'observation:vscode:insert-wrapper-act-after',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-wrapper',
      windowRef: 'window:vscode:insert-wrapper',
      titleRef: 'text:title:insert-wrapper',
      frontmostRef: 'frontmost:vscode:insert-wrapper',
      fileRefs: ['file-ref:vscode:insert-wrapper'],
      editorElementRef: 'element:vscode:editor',
      focusedEditorRef: 'focused-editor:vscode:insert-wrapper',
      visibleTextRef: 'text:vscode:insert-wrapper-after',
      visibleTextSha256Ref: 'text:vscode:insert-wrapper-after-sha256',
      screenshotRef: 'image:vscode:insert-wrapper-after',
      accessibilityRef: 'accessibility:vscode:insert-wrapper-after',
      freshnessRef: 'freshness:vscode:insert-wrapper-after',
      observationRef: 'observation:vscode:insert-wrapper-after',
    },
  ];

  const result = await runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-insert-wrapper',
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'current-vscode-host-insert',
    attemptId: 'current-vscode-host-insert-attempt-1',
    workspacePath: '/tmp/workspace',
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:draft'
        ? 'draft body hidden from evidence'
        : undefined;
    },
    typeResolvedText: async (input) => {
      calls.push(`type-resolved-text:${input.textRef}:${input.text.length}:${input.beforeObservationRef}`);
    },
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    restoreFocus: async (ref) => {
      calls.push(`restore-focus:${ref}`);
    },
    restoreMouse: async (ref) => {
      calls.push(`restore-mouse:${ref}`);
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'act', 'observe', 'control(release)']);
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'resolve-text:text-ref:current-vscode-cowork:draft',
    'type-resolved-text:text-ref:current-vscode-cowork:draft:31:observation:vscode:insert-wrapper-before',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-insert-wrapper',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-insert-wrapper',
  ]);
  assert.equal(result.materializerResult?.claimType, 'computer-use-vscode-cowork-act-decision');
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.ok(result.agentHostInput?.refs.includes('text-ref:current-vscode-cowork:draft'));
  assert.ok(result.evidenceRefs.includes('action:current-vscode-cowork:unit-current-vscode-insert-wrapper:insert-draft'));
  assert.ok(result.evidenceRefs.includes('executor-event:current-vscode-cowork:unit-current-vscode-insert-wrapper:insert-draft'));
  assert.ok(result.evidenceRefs.includes('input-event:current-vscode-cowork:unit-current-vscode-insert-wrapper:insert-draft'));
  assert.ok(result.evidenceRefs.includes('stale-invalidation:current-vscode-cowork:unit-current-vscode-insert-wrapper:insert-draft'));
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:insert-wrapper'));
  assert.ok(result.evidenceRefs.includes('observation:vscode:insert-wrapper-after'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-insert-wrapper'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-insert-wrapper'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-insert-wrapper'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-insert-wrapper'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-insert-wrapper'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|hidden from evidence|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work live diagnostic can observe the real current VSCode window', {
  skip: currentVSCodeLiveEnabled
    ? undefined
    : `set ${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}=1 with VSCode frontmost to run the current VSCode live diagnostic`,
  timeout: 60_000,
}, async () => {
  const result = await runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    runId: `live-current-vscode-${Date.now()}`,
    commandText: '读取我当前打开的 VSCode 可见文本。',
    commandId: 'current-vscode-live-read-visible-text',
    attemptId: 'current-vscode-live-read-visible-text-attempt-1',
    workspacePath: process.cwd(),
  });

  assert.equal(result.status, 'completed', result.message);
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'observe', 'control(release)']);
  assert.ok(result.evidenceRefs.some((ref) => ref.startsWith('window:vscode:')));
  assert.ok(result.evidenceRefs.some((ref) => ref.startsWith('accessibility:vscode:')));
  assert.ok(result.evidenceRefs.some((ref) => ref.startsWith('text:vscode:')));
  assert.ok(result.evidenceRefs.some((ref) => ref.startsWith('element:vscode:editor:') || ref === 'element:vscode:editor'));
  assert.ok(result.cleanupRefs.some((ref) => ref.startsWith('scoped-input-lease:current-vscode-cowork:')));
  assert.ok(result.cleanupRefs.some((ref) => ref.startsWith('scoped-input-adapter:current-vscode-cowork:')));
  assert.ok(result.cleanupRefs.some((ref) => ref.startsWith('cursor-marker:current-vscode-cowork:')));
  assert.ok(result.cleanupRefs.some((ref) => ref.startsWith('front-app-restore:current-vscode-cowork:')));
  assert.ok(result.cleanupRefs.some((ref) => ref.startsWith('mouse-position-restore:current-vscode-cowork:')));
  assert.equal(result.agentHostFinalAnswer?.status, 'completed');
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});
