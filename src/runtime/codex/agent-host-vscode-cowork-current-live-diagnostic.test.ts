import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
  runCurrentVSCodeCoWorkCommandPaletteLiveDiagnostic,
  runCurrentVSCodeCoWorkEditorPreviewLiveDiagnostic,
  runCurrentVSCodeCoWorkEditorScopeLiveDiagnostic,
  runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic,
  runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic,
  runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic,
  runCurrentVSCodeCoWorkTerminalLiveDiagnostic,
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

test('current VSCode co-work wrappers do not touch live ports without explicit env', async () => {
  const liveCalls: string[] = [];
  const readCurrentWindow = async () => {
    liveCalls.push('read-current-window');
    throw new Error('live port should not run without env');
  };
  const pressKeyInCurrentVSCode = async () => {
    liveCalls.push('press-key');
    throw new Error('focus port should not run without env');
  };
  const resolveTextRef = async () => {
    liveCalls.push('resolve-text');
    throw new Error('text resolver should not run without env');
  };
  const typeResolvedText = async () => {
    liveCalls.push('type-text');
    throw new Error('type port should not run without env');
  };
  const restoreFocus = async () => {
    liveCalls.push('restore-focus');
  };
  const restoreMouse = async () => {
    liveCalls.push('restore-mouse');
  };

  const read = await runCurrentVSCodeCoWorkReadVisibleTextLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-read-default-off',
    readCurrentWindow,
    restoreFocus,
    restoreMouse,
  });
  const focus = await runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-focus-default-off',
    readCurrentWindow,
    pressKeyInCurrentVSCode,
    restoreFocus,
    restoreMouse,
  });
  const insert = await runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-insert-default-off',
    draftTextRef: 'text-ref:current-vscode-cowork:default-off',
    readCurrentWindow,
    resolveTextRef,
    typeResolvedText,
    restoreFocus,
    restoreMouse,
  });
  const terminal = await runCurrentVSCodeCoWorkTerminalLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-terminal-default-off',
    terminalTextRef: 'text-ref:current-vscode-cowork:terminal-default-off',
    readCurrentWindow,
    resolveTextRef,
    typeResolvedText,
    pressKeyInCurrentVSCode,
    restoreFocus,
    restoreMouse,
  });

  for (const result of [read, focus, insert, terminal]) {
    assert.equal(result.status, 'blocked');
    assert.equal(result.maturity, 'live-diagnostic');
    assert.equal(result.productReady, false);
    assert.deepEqual(result.primitiveChainObserved, []);
    assert.match(result.message, /missing-env/);
    assert.doesNotMatch(JSON.stringify(result), /product-ready|kill-vscode|clear-profile|base64|providerPayload/i);
  }
  assert.deepEqual(liveCalls, []);
});

test('current VSCode co-work command palette diagnostic is independently env-gated and does not touch ports by default', async () => {
  const liveCalls: string[] = [];
  const result = await runCurrentVSCodeCoWorkCommandPaletteLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-palette-default-off',
    paletteQueryTextRef: 'text-ref:current-vscode-cowork:palette-query',
    readCurrentWindow: async () => {
      liveCalls.push('read-current-window');
      throw new Error('palette live port should not run without env');
    },
    performAction: async () => {
      liveCalls.push('perform-action');
      throw new Error('palette action should not run without env');
    },
    restoreFocus: async () => {
      liveCalls.push('restore-focus');
    },
    restoreMouse: async () => {
      liveCalls.push('restore-mouse');
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, []);
  assert.match(result.message, new RegExp(`missing-env:${VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV}`));
  assert.deepEqual(liveCalls, []);
  assert.doesNotMatch(JSON.stringify(result), /product-ready|kill-vscode|clear-profile|base64|providerPayload/i);
});

test('current VSCode co-work editor scope diagnostic is independently env-gated and does not touch ports by default', async () => {
  const liveCalls: string[] = [];
  const result = await runCurrentVSCodeCoWorkEditorScopeLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-scope-default-off',
    readCurrentWindow: async () => {
      liveCalls.push('read-current-window');
      throw new Error('scope live port should not run without env');
    },
    performAction: async () => {
      liveCalls.push('perform-action');
      throw new Error('scope action should not run without env');
    },
    restoreFocus: async () => {
      liveCalls.push('restore-focus');
    },
    restoreMouse: async () => {
      liveCalls.push('restore-mouse');
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, []);
  assert.deepEqual(result.evidenceRefs, []);
  assert.deepEqual(result.cleanupRefs, []);
  assert.match(result.message, new RegExp(`missing-env:${VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV}`));
  assert.deepEqual(liveCalls, []);
  assert.doesNotMatch(JSON.stringify(result), /product-ready|kill-vscode|clear-profile|base64|providerPayload|scoped-input-lease|scoped-input-adapter|cursor-marker/i);
});

test('current VSCode co-work editor preview diagnostic is independently env-gated and does not touch ports by default', async () => {
  const liveCalls: string[] = [];
  const result = await runCurrentVSCodeCoWorkEditorPreviewLiveDiagnostic({
    env: {},
    runId: 'unit-current-vscode-preview-default-off',
    readCurrentWindow: async () => {
      liveCalls.push('read-current-window');
      throw new Error('preview live port should not run without env');
    },
    performAction: async () => {
      liveCalls.push('perform-action');
      throw new Error('preview action should not run without env');
    },
    restoreFocus: async () => {
      liveCalls.push('restore-focus');
    },
    restoreMouse: async () => {
      liveCalls.push('restore-mouse');
    },
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.maturity, 'live-diagnostic');
  assert.equal(result.productReady, false);
  assert.deepEqual(result.primitiveChainObserved, []);
  assert.deepEqual(result.evidenceRefs, []);
  assert.deepEqual(result.cleanupRefs, []);
  assert.match(result.message, new RegExp(`missing-env:${VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV}`));
  assert.deepEqual(liveCalls, []);
  assert.doesNotMatch(JSON.stringify(result), /product-ready|kill-vscode|clear-profile|base64|providerPayload|scoped-input-lease|scoped-input-adapter|cursor-marker/i);
});

test('current VSCode co-work editor scope diagnostic mocks observe scope and releases', async () => {
  const calls: string[] = [];
  const scopeObservation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:scope',
    windowRef: 'window:vscode:scope',
    titleRef: 'text:title:scope',
    frontmostRef: 'frontmost:vscode:scope',
    fileRefs: ['selected-file:vscode:scope-paper'],
    editorElementRef: 'element:vscode:editor:scope',
    focusedEditorRef: 'focused-editor:vscode:scope',
    selectionRef: 'selection-ref:vscode:scope:current',
    cursorRef: 'cursor-ref:vscode:scope:current',
    rangeRef: 'range-ref:vscode:scope:current',
    visibleTextRef: `text:vscode:scope-${suffix}`,
    visibleTextSha256Ref: `text:vscode:scope-${suffix}-sha256`,
    screenshotRef: `image:vscode:scope-${suffix}`,
    accessibilityRef: `accessibility:vscode:scope-${suffix}`,
    freshnessRef: `freshness:vscode:scope-${suffix}`,
    observationRef: `observation:vscode:scope-${suffix}`,
  });
  const observations = [
    scopeObservation('bind'),
    scopeObservation('before'),
    scopeObservation('after'),
  ];

  const result = await runCurrentVSCodeCoWorkEditorScopeLiveDiagnostic({
    env: {
      [VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-scope-mock',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    performAction: async () => {
      calls.push('perform-action');
      throw new Error('scope diagnostic must not act');
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
  assert.deepEqual(result.primitiveChainObserved, [
    'bind',
    'observe',
    'host-decision',
    'observe',
    'control(release)',
  ]);
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-scope-mock',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-scope-mock',
  ]);
  assert.ok(result.evidenceRefs.includes('element:vscode:editor:scope'));
  assert.ok(result.evidenceRefs.includes('selected-file:vscode:scope-paper'));
  assert.ok(result.evidenceRefs.includes('selection-ref:vscode:scope:current'));
  assert.ok(result.evidenceRefs.includes('cursor-ref:vscode:scope:current'));
  assert.ok(result.evidenceRefs.includes('range-ref:vscode:scope:current'));
  assert.ok(result.evidenceRefs.includes('freshness:vscode:scope-before'));
  assert.ok(result.evidenceRefs.includes('freshness:vscode:scope-after'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-scope-mock'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-scope-mock'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-scope-mock'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-scope-mock'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-scope-mock'));
  assert.equal(result.agentHostFinalAnswer?.hostOwnsFinalAnswer, true);
  assert.equal(result.agentHostFinalAnswer?.computerUseCorePlanning, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /text:vscode:scope|image:vscode|accessibility:vscode|window:vscode|observation:vscode|operation-ref:|module:vscode-app|capability:vscode|terminal-output|history:vscode|providerPayload|rawSelectedText|selectedText|rawVisibleText|visibleText|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work editor scope diagnostic releases when scope refs are incomplete', async () => {
  const calls: string[] = [];
  const incompleteScopeObservation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:scope-missing',
    windowRef: 'window:vscode:scope-missing',
    titleRef: 'text:title:scope-missing',
    frontmostRef: 'frontmost:vscode:scope-missing',
    fileRefs: ['file-ref:vscode:scope-missing'],
    editorElementRef: 'element:vscode:editor:scope-missing',
    selectionRef: 'selection-ref:vscode:scope-missing:current',
    visibleTextRef: `text:vscode:scope-missing-${suffix}`,
    screenshotRef: `image:vscode:scope-missing-${suffix}`,
    accessibilityRef: `accessibility:vscode:scope-missing-${suffix}`,
    freshnessRef: `freshness:vscode:scope-missing-${suffix}`,
    observationRef: `observation:vscode:scope-missing-${suffix}`,
  });
  const observations = [
    incompleteScopeObservation('bind'),
    incompleteScopeObservation('before'),
  ];

  const result = await runCurrentVSCodeCoWorkEditorScopeLiveDiagnostic({
    env: {
      [VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-scope-missing',
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

  assert.equal(result.status, 'needs-confirmation');
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'control(release)']);
  assert.ok(result.evidenceRefs.includes('needs-confirmation:vscode-app-module:editor-scope-cursor-required'));
  assert.ok(result.evidenceRefs.includes('selection-ref:vscode:scope-missing:current'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-scope-missing'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-scope-missing'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-scope-missing'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-scope-missing'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-scope-missing'));
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-scope-missing',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-scope-missing',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /text:vscode:scope-missing|image:vscode|accessibility:vscode|window:vscode|observation:vscode|operation-ref:|module:vscode-app|capability:vscode|providerPayload|raw-|base64|product-ready/i);
});

test('current VSCode co-work editor scope diagnostic filters unsafe scope refs before returning a safe non-completed result', async () => {
  const calls: string[] = [];
  const unsafeScopeObservation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:scope-unsafe',
    windowRef: 'window:vscode:scope-unsafe',
    titleRef: 'text:title:scope-unsafe',
    frontmostRef: 'frontmost:vscode:scope-unsafe',
    fileRefs: ['file-ref:vscode:scope-unsafe'],
    editorElementRef: 'element:vscode:editor:scope-unsafe',
    selectionRef: 'selection-ref:vscode:raw-selected-text',
    cursorRef: 'cursor-ref:vscode:scope-unsafe:current',
    rangeRef: 'range-ref:vscode:scope-unsafe:current',
    visibleTextRef: `text:vscode:scope-unsafe-${suffix}`,
    screenshotRef: `image:vscode:scope-unsafe-${suffix}`,
    accessibilityRef: `accessibility:vscode:scope-unsafe-${suffix}`,
    freshnessRef: `freshness:vscode:scope-unsafe-${suffix}`,
    observationRef: `observation:vscode:scope-unsafe-${suffix}`,
  });
  const observations = [
    unsafeScopeObservation('bind'),
    unsafeScopeObservation('before'),
  ];

  const result = await runCurrentVSCodeCoWorkEditorScopeLiveDiagnostic({
    env: {
      [VSCODE_COWORK_SCOPE_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-scope-unsafe',
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

  assert.ok(result.status === 'blocked' || result.status === 'needs-confirmation', result.status);
  assert.deepEqual(result.primitiveChainObserved, ['bind', 'observe', 'host-decision', 'control(release)']);
  assert.ok(result.evidenceRefs.some((ref) =>
    ref === 'blocked:vscode-app-module:unsafe-editor-scope-ref-not-allowed'
      || ref === 'blocked:vscode-app-module:raw-ref-not-allowed'
      || ref === 'needs-confirmation:vscode-app-module:editor-scope-selection-required'
  ));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-scope-unsafe'));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /selection-ref:vscode:raw-selected-text|rawSelectedText|selectedText|text:vscode:scope-unsafe|image:vscode|accessibility:vscode|window:vscode|observation:vscode|operation-ref:|module:vscode-app|capability:vscode|providerPayload|base64|product-ready/i);
});

test('current VSCode co-work editor preview diagnostic mocks current selection preview and releases without writing', async () => {
  const calls: string[] = [];
  const previewObservation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:preview',
    windowRef: 'window:vscode:preview',
    titleRef: 'text:title:preview',
    frontmostRef: 'frontmost:vscode:preview',
    fileRefs: ['selected-file:vscode:preview-paper'],
    editorElementRef: 'element:vscode:editor:preview',
    focusedEditorRef: 'focused-editor:vscode:preview',
    selectionRef: 'selection-ref:vscode:preview:current',
    cursorRef: 'cursor-ref:vscode:preview:current',
    rangeRef: 'range-ref:vscode:preview:current',
    visibleTextRef: `text:vscode:preview-${suffix}`,
    visibleTextSha256Ref: `text:vscode:preview-${suffix}-sha256`,
    screenshotRef: `image:vscode:preview-${suffix}`,
    accessibilityRef: `accessibility:vscode:preview-${suffix}`,
    freshnessRef: `freshness:vscode:preview-${suffix}`,
    observationRef: `observation:vscode:preview-${suffix}`,
  });
  const observations = [
    previewObservation('bind'),
    previewObservation('before'),
  ];

  const result = await runCurrentVSCodeCoWorkEditorPreviewLiveDiagnostic({
    env: {
      [VSCODE_COWORK_PREVIEW_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-preview-mock',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    performAction: async () => {
      calls.push('perform-action');
      throw new Error('preview diagnostic must not act or write');
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
  assert.deepEqual(result.primitiveChainObserved, [
    'bind',
    'observe',
    'host-decision',
    'control(release)',
  ]);
  assert.ok(result.evidenceRefs.includes('selected-file:vscode:preview-paper'));
  assert.ok(result.evidenceRefs.includes('selection-ref:vscode:preview:current'));
  assert.ok(result.evidenceRefs.includes('cursor-ref:vscode:preview:current'));
  assert.ok(result.evidenceRefs.includes('range-ref:vscode:preview:current'));
  assert.ok(result.evidenceRefs.includes('artifact:vscode-editor-draft:unit-current-vscode-preview-mock'));
  assert.ok(result.evidenceRefs.includes('artifact:vscode-editor-preview:unit-current-vscode-preview-mock'));
  assert.ok(result.evidenceRefs.includes('artifact:vscode-editor-preview-diff:unit-current-vscode-preview-mock'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-editor-preview:unit-current-vscode-preview-mock:refs-only'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-preview-mock'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-preview-mock'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-preview-mock'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-preview-mock'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-preview-mock'));
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-preview-mock',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-preview-mock',
  ]);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /perform-action|text:vscode:preview|image:vscode|accessibility:vscode|window:vscode|observation:vscode|operation-ref:|module:vscode-app|capability:vscode|rawSelectedText|selectedText|rawDiff|@@|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile|replace-selection|insert-draft/i);
});

test('current VSCode co-work command palette diagnostic mocks open query observe close and release without selecting', async () => {
  const calls: string[] = [];
  const paletteObservation = (suffix: string, paletteOpen: boolean, withItems = false) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:palette-close',
    windowRef: 'window:vscode:palette-close',
    titleRef: 'text:title:palette-close',
    frontmostRef: 'frontmost:vscode:palette-close',
    fileRefs: ['file-ref:vscode:palette-close'],
    editorElementRef: 'element:vscode:editor:palette-close',
    visibleTextRef: `text:vscode:palette-close-${suffix}`,
    visibleTextSha256Ref: `text:vscode:palette-close-${suffix}-sha256`,
    screenshotRef: `image:vscode:palette-close-${suffix}`,
    accessibilityRef: `accessibility:vscode:palette-close-${suffix}`,
    freshnessRef: `freshness:vscode:palette-close-${suffix}`,
    observationRef: `observation:vscode:palette-close-${suffix}`,
    ...(paletteOpen ? {
      commandPaletteRootRef: 'command-palette:vscode:palette-close:current',
      commandPaletteInputRef: 'command-palette-input:vscode:palette-close:current',
      commandPaletteItemsRef: `command-palette-items:vscode:palette-close:obs-palette-close-${suffix}`,
    } : {}),
    ...(withItems ? {
      commandPaletteItemRefs: [`command-palette-item:vscode:palette-close:obs-palette-close-${suffix}:rank-1`],
      commandPaletteItemRankRefs: [`command-palette-item-rank:vscode:palette-close:obs-palette-close-${suffix}:rank-1`],
      commandPaletteItemHashRefs: ['command-palette-item-hash:vscode:palette-close:obs-palette-close-items:sha256:abc123'],
    } : {}),
  });
  const observations = [
    paletteObservation('bind', false),
    paletteObservation('before', false),
    paletteObservation('open-act-after', true),
    paletteObservation('open', true),
    paletteObservation('send-act-after', true),
    paletteObservation('items', true, true),
    paletteObservation('close-act-after', false),
    paletteObservation('closed', false),
  ];

  const result = await runCurrentVSCodeCoWorkCommandPaletteLiveDiagnostic({
    env: {
      [VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-palette-close',
    paletteQueryTextRef: 'text-ref:current-vscode-cowork:palette-query',
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:palette-query' ? 'hidden query' : undefined;
    },
    performAction: async (input) => {
      calls.push(`perform-action:${input.action.type}:${input.action.key ?? input.action.textRef}:${input.beforeObservationRef}`);
      assert.ok(input.contextRefs?.some((ref) => ref.startsWith('command-palette:')) || input.action.key === 'Meta+Shift+P');
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
  assert.deepEqual(result.primitiveChainObserved, [
    'bind',
    'observe',
    'host-decision(open-command-palette)',
    'act(open-command-palette)',
    'observe',
    'host-decision(send-command-palette-query)',
    'act(send-command-palette-query)',
    'observe',
    'host-decision(close-command-palette)',
    'act(close-command-palette)',
    'observe',
    'control(release)',
  ]);
  assert.ok(calls.includes('perform-action:key:Meta+Shift+P:observation:vscode:palette-close-before'));
  assert.ok(calls.includes('perform-action:type:text-ref:current-vscode-cowork:palette-query:observation:vscode:palette-close-open'));
  assert.ok(calls.includes('perform-action:key:Escape:observation:vscode:palette-close-items'));
  assert.ok(!calls.some((call) => call.includes(':Enter:')));
  assert.ok(result.evidenceRefs.includes('command-palette-item:vscode:palette-close:obs-palette-close-items:rank-1'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-palette-close'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-palette-close'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-palette-close'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-palette-close'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-palette-close'));
  assert.doesNotMatch(JSON.stringify(result), /hidden query|Save File|workbench|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work command palette diagnostic selects only the current observed item ref', async () => {
  const calls: string[] = [];
  const paletteObservation = (suffix: string, withItems = false) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:palette-select',
    windowRef: 'window:vscode:palette-select',
    titleRef: 'text:title:palette-select',
    frontmostRef: 'frontmost:vscode:palette-select',
    fileRefs: ['file-ref:vscode:palette-select'],
    editorElementRef: 'element:vscode:editor:palette-select',
    visibleTextRef: `text:vscode:palette-select-${suffix}`,
    visibleTextSha256Ref: `text:vscode:palette-select-${suffix}-sha256`,
    screenshotRef: `image:vscode:palette-select-${suffix}`,
    accessibilityRef: `accessibility:vscode:palette-select-${suffix}`,
    freshnessRef: `freshness:vscode:palette-select-${suffix}`,
    observationRef: `observation:vscode:palette-select-${suffix}`,
    commandPaletteRootRef: 'command-palette:vscode:palette-select:current',
    commandPaletteInputRef: 'command-palette-input:vscode:palette-select:current',
    commandPaletteItemsRef: `command-palette-items:vscode:palette-select:obs-palette-select-${suffix}`,
    ...(withItems ? {
      commandPaletteItemRefs: [`command-palette-item:vscode:palette-select:obs-palette-select-${suffix}:rank-1`],
      commandPaletteItemRankRefs: [`command-palette-item-rank:vscode:palette-select:obs-palette-select-${suffix}:rank-1`],
      commandPaletteItemHashRefs: [`command-palette-item-hash:vscode:palette-select:obs-palette-select-${suffix}:sha256:def456`],
    } : {}),
  });
  const observations = [
    { ...paletteObservation('bind'), commandPaletteRootRef: undefined, commandPaletteInputRef: undefined, commandPaletteItemsRef: undefined },
    { ...paletteObservation('before'), commandPaletteRootRef: undefined, commandPaletteInputRef: undefined, commandPaletteItemsRef: undefined },
    paletteObservation('open-act-after'),
    paletteObservation('open'),
    paletteObservation('send-act-after'),
    paletteObservation('items', true),
    paletteObservation('select-act-after', true),
    paletteObservation('after-select', true),
  ];

  const result = await runCurrentVSCodeCoWorkCommandPaletteLiveDiagnostic({
    env: {
      [VSCODE_COWORK_PALETTE_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-palette-select',
    paletteQueryTextRef: 'text-ref:current-vscode-cowork:palette-query-select',
    selectCurrentItem: true,
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:palette-query-select' ? 'hidden query' : undefined;
    },
    performAction: async (input) => {
      calls.push(`perform-action:${input.action.type}:${input.action.key ?? input.action.textRef}:${input.beforeObservationRef}`);
      if (input.action.key === 'Enter') {
        assert.ok(input.contextRefs?.includes('command-palette-item:vscode:palette-select:obs-palette-select-items:rank-1'));
        assert.ok(!input.contextRefs?.some((ref) => /workbench|label|Save File/i.test(ref)));
      }
    },
    restoreFocus: async (ref) => {
      calls.push(`restore-focus:${ref}`);
    },
    restoreMouse: async (ref) => {
      calls.push(`restore-mouse:${ref}`);
    },
  });

  assert.equal(result.status, 'completed', result.message);
  assert.deepEqual(result.primitiveChainObserved, [
    'bind',
    'observe',
    'host-decision(open-command-palette)',
    'act(open-command-palette)',
    'observe',
    'host-decision(send-command-palette-query)',
    'act(send-command-palette-query)',
    'observe',
    'host-decision(select-command-palette-item)',
    'act(select-command-palette-item)',
    'observe',
    'control(release)',
  ]);
  assert.ok(calls.includes('perform-action:key:Enter:observation:vscode:palette-select-items'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-app-module:palette-current-observation:palette-select-obs-palette-select-items'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-app-module:palette-same-item:palette-select-obs-palette-select-items-rank-1'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-palette-select'));
  assert.doesNotMatch(JSON.stringify(result), /hidden query|Save File|workbench|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
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

test('current VSCode co-work focus-editor diagnostic uses default refs-first provider after focus act', async () => {
  const calls: string[] = [];
  const observation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:focus-default-provider',
    windowRef: 'window:vscode:focus-default-provider',
    titleRef: 'text:title:focus-default-provider',
    frontmostRef: 'frontmost:vscode:focus-default-provider',
    fileRefs: ['file-ref:vscode:focus-default-provider'],
    editorElementRef: 'element:vscode:editor:focus-default-provider',
    visibleTextRef: `text:vscode:focus-default-provider-${suffix}`,
    visibleTextSha256Ref: `text:vscode:focus-default-provider-${suffix}-sha256`,
    screenshotRef: `image:vscode:focus-default-provider-${suffix}`,
    accessibilityRef: `accessibility:vscode:focus-default-provider-${suffix}`,
    freshnessRef: `freshness:vscode:focus-default-provider-${suffix}`,
    observationRef: `observation:vscode:focus-default-provider-${suffix}`,
  });
  const observations = [
    observation('bind'),
    observation('before'),
    observation('act-after'),
    observation('after'),
  ];

  const result = await runCurrentVSCodeCoWorkFocusEditorLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-focus-default-provider',
    commandText: '聚焦我当前打开的 VSCode 编辑器。',
    commandId: 'current-vscode-host-focus-default-provider',
    attemptId: 'current-vscode-host-focus-default-provider-attempt-1',
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
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'press-key:Command+1:observation:vscode:focus-default-provider-before',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-focus-default-provider',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-focus-default-provider',
  ]);
  assert.equal(result.agentHostFinalAnswer?.completionTruth?.status, 'satisfied');
  assert.ok(result.evidenceRefs.includes('action:current-vscode-cowork:unit-current-vscode-focus-default-provider:focus-editor'));
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:sciforge-provider:current-vscode-host-focus-default-provider-attempt-1'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:current-vscode-host-focus-default-provider-attempt-1:focus-editor'));
  assert.ok(result.evidenceRefs.includes('accessibility:vscode:focus-default-provider-after'));
  assert.ok(result.evidenceRefs.includes('element:vscode:editor:focus-default-provider'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-focus-default-provider'));
  assert.doesNotMatch(JSON.stringify(result), /raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
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

test('current VSCode co-work insert-draft diagnostic accepts Host supplied focused-editor context refs', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-host-context',
      windowRef: 'window:vscode:insert-host-context',
      titleRef: 'text:title:insert-host-context',
      frontmostRef: 'frontmost:vscode:insert-host-context',
      fileRefs: ['file-ref:vscode:insert-host-context'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-host-context-bind',
      visibleTextSha256Ref: 'text:vscode:insert-host-context-bind-sha256',
      screenshotRef: 'image:vscode:insert-host-context-bind',
      accessibilityRef: 'accessibility:vscode:insert-host-context-bind',
      freshnessRef: 'freshness:vscode:insert-host-context-bind',
      observationRef: 'observation:vscode:insert-host-context-bind',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-host-context',
      windowRef: 'window:vscode:insert-host-context',
      titleRef: 'text:title:insert-host-context',
      frontmostRef: 'frontmost:vscode:insert-host-context',
      fileRefs: ['file-ref:vscode:insert-host-context'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-host-context-before',
      visibleTextSha256Ref: 'text:vscode:insert-host-context-before-sha256',
      screenshotRef: 'image:vscode:insert-host-context-before',
      accessibilityRef: 'accessibility:vscode:insert-host-context-before',
      freshnessRef: 'freshness:vscode:insert-host-context-before',
      observationRef: 'observation:vscode:insert-host-context-before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-host-context',
      windowRef: 'window:vscode:insert-host-context',
      titleRef: 'text:title:insert-host-context',
      frontmostRef: 'frontmost:vscode:insert-host-context',
      fileRefs: ['file-ref:vscode:insert-host-context'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-host-context-act-after',
      visibleTextSha256Ref: 'text:vscode:insert-host-context-act-after-sha256',
      screenshotRef: 'image:vscode:insert-host-context-act-after',
      accessibilityRef: 'accessibility:vscode:insert-host-context-act-after',
      freshnessRef: 'freshness:vscode:insert-host-context-act-after',
      observationRef: 'observation:vscode:insert-host-context-act-after',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-host-context',
      windowRef: 'window:vscode:insert-host-context',
      titleRef: 'text:title:insert-host-context',
      frontmostRef: 'frontmost:vscode:insert-host-context',
      fileRefs: ['file-ref:vscode:insert-host-context'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-host-context-after',
      visibleTextSha256Ref: 'text:vscode:insert-host-context-after-sha256',
      screenshotRef: 'image:vscode:insert-host-context-after',
      accessibilityRef: 'accessibility:vscode:insert-host-context-after',
      freshnessRef: 'freshness:vscode:insert-host-context-after',
      observationRef: 'observation:vscode:insert-host-context-after',
    },
  ];

  const result = await runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-insert-host-context',
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'current-vscode-host-insert-context',
    attemptId: 'current-vscode-host-insert-context-attempt-1',
    workspacePath: '/tmp/workspace',
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
    focusedEditorContextRefs: [
      'focused-editor:vscode:host-evidence:insert-host-context',
      'verifier:vscode-cowork:current-vscode-host-insert-context-attempt-1:focus-editor',
    ],
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:draft'
        ? 'draft body hidden from evidence'
        : undefined;
    },
    typeResolvedText: async (input) => {
      calls.push(`type-resolved-text:${input.textRef}:${input.focusedEditorRef}:${input.beforeObservationRef}`);
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
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'resolve-text:text-ref:current-vscode-cowork:draft',
    'type-resolved-text:text-ref:current-vscode-cowork:draft:focused-editor:vscode:host-evidence:insert-host-context:observation:vscode:insert-host-context-before',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-insert-host-context',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-insert-host-context',
  ]);
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:host-evidence:insert-host-context'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:current-vscode-host-insert-context-attempt-1:focus-editor'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-insert-host-context'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|hidden from evidence|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work insert-draft diagnostic derives focus context from Host evidence verifier', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-provider',
      windowRef: 'window:vscode:insert-provider',
      titleRef: 'text:title:insert-provider',
      frontmostRef: 'frontmost:vscode:insert-provider',
      fileRefs: ['file-ref:vscode:insert-provider'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-provider-bind',
      visibleTextSha256Ref: 'text:vscode:insert-provider-bind-sha256',
      screenshotRef: 'image:vscode:insert-provider-bind',
      accessibilityRef: 'accessibility:vscode:insert-provider-bind',
      freshnessRef: 'freshness:vscode:insert-provider-bind',
      observationRef: 'observation:vscode:insert-provider-bind',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-provider',
      windowRef: 'window:vscode:insert-provider',
      titleRef: 'text:title:insert-provider',
      frontmostRef: 'frontmost:vscode:insert-provider',
      fileRefs: ['file-ref:vscode:insert-provider'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-provider-before',
      visibleTextSha256Ref: 'text:vscode:insert-provider-before-sha256',
      screenshotRef: 'image:vscode:insert-provider-before',
      accessibilityRef: 'accessibility:vscode:insert-provider-before',
      freshnessRef: 'freshness:vscode:insert-provider-before',
      observationRef: 'observation:vscode:insert-provider-before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-provider',
      windowRef: 'window:vscode:insert-provider',
      titleRef: 'text:title:insert-provider',
      frontmostRef: 'frontmost:vscode:insert-provider',
      fileRefs: ['file-ref:vscode:insert-provider'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-provider-act-after',
      visibleTextSha256Ref: 'text:vscode:insert-provider-act-after-sha256',
      screenshotRef: 'image:vscode:insert-provider-act-after',
      accessibilityRef: 'accessibility:vscode:insert-provider-act-after',
      freshnessRef: 'freshness:vscode:insert-provider-act-after',
      observationRef: 'observation:vscode:insert-provider-act-after',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:insert-provider',
      windowRef: 'window:vscode:insert-provider',
      titleRef: 'text:title:insert-provider',
      frontmostRef: 'frontmost:vscode:insert-provider',
      fileRefs: ['file-ref:vscode:insert-provider'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:insert-provider-after',
      visibleTextSha256Ref: 'text:vscode:insert-provider-after-sha256',
      screenshotRef: 'image:vscode:insert-provider-after',
      accessibilityRef: 'accessibility:vscode:insert-provider-after',
      freshnessRef: 'freshness:vscode:insert-provider-after',
      observationRef: 'observation:vscode:insert-provider-after',
    },
  ];

  const result = await runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-insert-provider',
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'current-vscode-host-insert-provider',
    attemptId: 'current-vscode-host-insert-provider-attempt-1',
    workspacePath: '/tmp/workspace',
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
    focusedEditorEvidenceVerifier: (input) => {
      calls.push(`verify-insert-focus:${input.afterObservationRef}:${input.actionRefs.length}`);
      assert.ok(input.afterObserveRefs.includes('image:vscode:insert-provider-before'));
      assert.ok(input.afterObserveRefs.includes('accessibility:vscode:insert-provider-before'));
      assert.ok(input.editorElementRefs.includes('element:vscode:editor'));
      assert.equal(input.actionRefs.length, 0);
      return {
        status: 'satisfied',
        focusedEditorRef: 'focused-editor:vscode:host-evidence:insert-provider',
        verifierRef: 'verifier:vscode-cowork:current-vscode-host-insert-provider-attempt-1:focus-editor',
        evidenceRefs: [
          'image:vscode:insert-provider-before',
          'accessibility:vscode:insert-provider-before',
          'element:vscode:editor',
        ],
      };
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:draft'
        ? 'draft body hidden from evidence'
        : undefined;
    },
    typeResolvedText: async (input) => {
      calls.push(`type-resolved-text:${input.textRef}:${input.focusedEditorRef}:${input.beforeObservationRef}`);
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
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'verify-insert-focus:observation:vscode:insert-provider-before:0',
    'resolve-text:text-ref:current-vscode-cowork:draft',
    'type-resolved-text:text-ref:current-vscode-cowork:draft:focused-editor:vscode:host-evidence:insert-provider:observation:vscode:insert-provider-before',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-insert-provider',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-insert-provider',
  ]);
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:host-evidence:insert-provider'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:current-vscode-host-insert-provider-attempt-1:focus-editor'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-insert-provider'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|hidden from evidence|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work insert-draft diagnostic adapts SciForge focused-editor evidence provider refs', async () => {
  const calls: string[] = [];
  const observation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:insert-sciforge-provider',
    windowRef: 'window:vscode:insert-sciforge-provider',
    titleRef: 'text:title:insert-sciforge-provider',
    frontmostRef: 'frontmost:vscode:insert-sciforge-provider',
    fileRefs: ['file-ref:vscode:insert-sciforge-provider'],
    editorElementRef: 'element:vscode:editor',
    visibleTextRef: `text:vscode:insert-sciforge-provider-${suffix}`,
    visibleTextSha256Ref: `text:vscode:insert-sciforge-provider-${suffix}-sha256`,
    screenshotRef: `image:vscode:insert-sciforge-provider-${suffix}`,
    accessibilityRef: `accessibility:vscode:insert-sciforge-provider-${suffix}`,
    freshnessRef: `freshness:vscode:insert-sciforge-provider-${suffix}`,
    observationRef: `observation:vscode:insert-sciforge-provider-${suffix}`,
  });
  const observations = [
    observation('bind'),
    observation('before'),
    observation('act-after'),
    observation('after'),
  ];

  const result = await runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-insert-sciforge-provider',
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'current-vscode-host-insert-sciforge-provider',
    attemptId: 'current-vscode-host-insert-sciforge-provider-attempt-1',
    workspacePath: '/tmp/workspace',
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
    focusedEditorEvidenceProvider: (input) => {
      calls.push(`provider-focus:${input.afterObservationRef}`);
      assert.equal(input.schemaVersion, 'sciforge.vscode-cowork.focused-editor-evidence-provider-input.v1');
      assert.ok(input.evidenceRefs.length >= 10);
      assert.ok(input.afterObserveRefs.includes('image:vscode:insert-sciforge-provider-before'));
      assert.ok(input.afterObserveRefs.includes('accessibility:vscode:insert-sciforge-provider-before'));
      assert.ok(input.afterObserveRefs.includes('text:vscode:insert-sciforge-provider-before'));
      assert.ok(input.targetRefs.includes('window:vscode:insert-sciforge-provider'));
      assert.ok(input.targetRefs.includes('file-ref:vscode:insert-sciforge-provider'));
      assert.ok(input.editorElementRefs.includes('element:vscode:editor'));
      assert.doesNotMatch(JSON.stringify(input), /raw-|providerPayload|data:image|base64|\/tmp\/workspace/i);
      return {
        status: 'satisfied',
        focusedEditorRef: 'focused-editor:vscode:sciforge-provider:insert-draft',
        verifierRef: 'verifier:vscode-cowork:current-vscode-host-insert-sciforge-provider-attempt-1:focus-editor',
        evidenceRefs: [
          input.decisionRef,
          'image:vscode:insert-sciforge-provider-before',
          'accessibility:vscode:insert-sciforge-provider-before',
          'text:vscode:insert-sciforge-provider-before',
          'element:vscode:editor',
        ],
      };
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:draft'
        ? 'draft body hidden from evidence'
        : undefined;
    },
    typeResolvedText: async (input) => {
      calls.push(`type-resolved-text:${input.textRef}:${input.focusedEditorRef}:${input.beforeObservationRef}`);
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
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'provider-focus:observation:vscode:insert-sciforge-provider-before',
    'resolve-text:text-ref:current-vscode-cowork:draft',
    'type-resolved-text:text-ref:current-vscode-cowork:draft:focused-editor:vscode:sciforge-provider:insert-draft:observation:vscode:insert-sciforge-provider-before',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-insert-sciforge-provider',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-insert-sciforge-provider',
  ]);
  assert.ok(result.evidenceRefs.includes('focused-editor:vscode:sciforge-provider:insert-draft'));
  assert.ok(result.evidenceRefs.includes('verifier:vscode-cowork:current-vscode-host-insert-sciforge-provider-attempt-1:focus-editor'));
  assert.ok(result.evidenceRefs.includes('image:vscode:insert-sciforge-provider-before'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-insert-sciforge-provider'));
  assert.doesNotMatch(JSON.stringify(result), /draft body|hidden from evidence|raw-|providerPayload|data:image|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work insert-draft diagnostic blocks unsafe SciForge focused-editor provider refs before typing', async () => {
  const calls: string[] = [];
  const observation = (suffix: string) => ({
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:insert-unsafe-provider',
    windowRef: 'window:vscode:insert-unsafe-provider',
    titleRef: 'text:title:insert-unsafe-provider',
    frontmostRef: 'frontmost:vscode:insert-unsafe-provider',
    fileRefs: ['file-ref:vscode:insert-unsafe-provider'],
    editorElementRef: 'element:vscode:editor',
    visibleTextRef: `text:vscode:insert-unsafe-provider-${suffix}`,
    visibleTextSha256Ref: `text:vscode:insert-unsafe-provider-${suffix}-sha256`,
    screenshotRef: `image:vscode:insert-unsafe-provider-${suffix}`,
    accessibilityRef: `accessibility:vscode:insert-unsafe-provider-${suffix}`,
    freshnessRef: `freshness:vscode:insert-unsafe-provider-${suffix}`,
    observationRef: `observation:vscode:insert-unsafe-provider-${suffix}`,
  });
  const observations = [observation('bind'), observation('before')];

  const result = await runCurrentVSCodeCoWorkInsertDraftLiveDiagnostic({
    env: {
      [VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-insert-unsafe-provider',
    commandText: '在我当前打开的 VSCode 文件里插入这段草稿。',
    commandId: 'current-vscode-host-insert-unsafe-provider',
    attemptId: 'current-vscode-host-insert-unsafe-provider-attempt-1',
    workspacePath: '/tmp/workspace',
    draftTextRef: 'text-ref:current-vscode-cowork:draft',
    focusedEditorEvidenceProvider: () => {
      calls.push('provider-focus:unsafe-output');
      return {
        status: 'satisfied',
        focusedEditorRef: 'raw focused editor',
        verifierRef: 'https://example.invalid/focus-verifier',
        evidenceRefs: ['data:image/png;base64,abc', '/tmp/raw-screenshot.png', 'providerPayload:raw'],
      };
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return 'draft body hidden from evidence';
    },
    typeResolvedText: async () => {
      calls.push('type-resolved-text');
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

  assert.equal(result.status, 'blocked');
  assert.match(result.message, /focused-editor evidence verifier/i);
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'provider-focus:unsafe-output',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-insert-unsafe-provider',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-insert-unsafe-provider',
  ]);
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-insert-unsafe-provider'));
  assert.ok(!result.evidenceRefs.some((ref) => ref.startsWith('focused-editor:')));
  assert.ok(!result.evidenceRefs.some((ref) => ref.startsWith('verifier:') && ref.includes('focus-editor')));
  assert.doesNotMatch(JSON.stringify(result), /draft body|hidden from evidence|raw focused editor|example\.invalid|data:image|base64|raw-screenshot|providerPayload|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work terminal diagnostic runs focus send observe without submit', async () => {
  const calls: string[] = [];
  const result = await runCurrentVSCodeCoWorkTerminalLiveDiagnostic({
    env: {
      [VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-terminal-no-submit',
    terminalTextRef: 'text-ref:current-vscode-cowork:terminal-probe',
    submit: false,
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return currentTerminalWrapperObservation('no-submit');
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:terminal-probe'
        ? 'private terminal probe'
        : undefined;
    },
    typeResolvedText: async (input) => {
      calls.push(`type-terminal:${input.textRef}:${input.contextRefs?.join(',')}:${input.beforeObservationRef}`);
    },
    pressKeyInCurrentVSCode: async (input) => {
      calls.push(`press-key:${input.key}:${input.contextRefs?.join(',')}:${input.beforeObservationRef}`);
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
  assert.deepEqual(result.primitiveChainObserved, [
    'bind',
    'observe',
    'host-decision',
    'act(focus-terminal)',
    'act(send-terminal-text)',
    'observe',
    'control(release)',
  ]);
  assert.ok(result.evidenceRefs.includes('decision:vscode-cowork:unit-current-vscode-terminal-no-submit:terminal-no-submit'));
  assert.ok(result.evidenceRefs.includes('terminal:vscode:terminal-wrapper:1'));
  assert.ok(result.evidenceRefs.includes('terminal-output:vscode:terminal-wrapper:1:current'));
  assert.ok(result.evidenceRefs.includes('terminal-output-hash:vscode:terminal-wrapper:1:sha256:abc123'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-terminal-no-submit'));
  assert.ok(result.cleanupRefs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode-terminal-no-submit'));
  assert.ok(result.cleanupRefs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode-terminal-no-submit'));
  assert.ok(result.cleanupRefs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode-terminal-no-submit'));
  assert.ok(result.cleanupRefs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-terminal-no-submit'));
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'press-key:Control+Backquote:terminal:vscode:terminal-wrapper:1,terminal-session:vscode:terminal-wrapper:1:session-a,terminal-input:vscode:terminal-wrapper:1:input-a:observation:vscode:terminal-wrapper:no-submit',
    'read-current-window',
    'resolve-text:text-ref:current-vscode-cowork:terminal-probe',
    'type-terminal:text-ref:current-vscode-cowork:terminal-probe:terminal:vscode:terminal-wrapper:1,terminal-session:vscode:terminal-wrapper:1:session-a,terminal-input:vscode:terminal-wrapper:1:input-a:observation:vscode:terminal-wrapper:no-submit',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-terminal-no-submit',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-terminal-no-submit',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private terminal probe|stdout|stderr|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

test('current VSCode co-work terminal diagnostic can submit only after send and observe', async () => {
  const calls: string[] = [];
  const result = await runCurrentVSCodeCoWorkTerminalLiveDiagnostic({
    env: {
      [VSCODE_COWORK_TERMINAL_LIVE_DIAGNOSTIC_ENV]: '1',
    },
    runId: 'unit-current-vscode-terminal-submit',
    terminalTextRef: 'text-ref:current-vscode-cowork:terminal-probe',
    submit: true,
    readCurrentWindow: async () => {
      calls.push('read-current-window');
      return currentTerminalWrapperObservation('submit');
    },
    resolveTextRef: async (textRef) => {
      calls.push(`resolve-text:${textRef}`);
      return textRef === 'text-ref:current-vscode-cowork:terminal-probe'
        ? 'private terminal probe'
        : undefined;
    },
    typeResolvedText: async (input) => {
      calls.push(`type-terminal:${input.textRef}:${input.beforeObservationRef}`);
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
  assert.deepEqual(result.primitiveChainObserved, [
    'bind',
    'observe',
    'host-decision',
    'act(focus-terminal)',
    'act(send-terminal-text)',
    'observe',
    'act(submit-terminal-command)',
    'observe',
    'control(release)',
  ]);
  assert.ok(result.evidenceRefs.includes('action:current-vscode-cowork:unit-current-vscode-terminal-submit:submit-terminal-command'));
  assert.ok(result.evidenceRefs.includes('terminal-input:vscode:terminal-wrapper:1:input-a'));
  assert.ok(result.cleanupRefs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-terminal-submit'));
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'press-key:Control+Backquote:observation:vscode:terminal-wrapper:submit',
    'read-current-window',
    'resolve-text:text-ref:current-vscode-cowork:terminal-probe',
    'type-terminal:text-ref:current-vscode-cowork:terminal-probe:observation:vscode:terminal-wrapper:submit',
    'read-current-window',
    'read-current-window',
    'press-key:Enter:observation:vscode:terminal-wrapper:submit',
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-terminal-submit',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-terminal-submit',
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private terminal probe|stdout|stderr|raw-|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);
});

function currentTerminalWrapperObservation(stage: string) {
  return {
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:terminal-wrapper',
    windowRef: 'window:vscode:terminal-wrapper',
    titleRef: 'text:title:terminal-wrapper',
    frontmostRef: 'frontmost:vscode:terminal-wrapper',
    fileRefs: ['file-ref:vscode:terminal-wrapper'],
    editorElementRef: 'element:vscode:editor:terminal-wrapper',
    terminalElementRef: 'terminal:vscode:terminal-wrapper:1',
    terminalSessionRef: 'terminal-session:vscode:terminal-wrapper:1:session-a',
    terminalInputRef: 'terminal-input:vscode:terminal-wrapper:1:input-a',
    terminalOutputRef: 'terminal-output:vscode:terminal-wrapper:1:current',
    terminalOutputHashRef: 'terminal-output-hash:vscode:terminal-wrapper:1:sha256:abc123',
    visibleTextRef: `text:vscode:terminal-wrapper:${stage}`,
    visibleTextSha256Ref: `text:vscode:terminal-wrapper:${stage}:sha256`,
    screenshotRef: `image:vscode:terminal-wrapper:${stage}`,
    accessibilityRef: `accessibility:vscode:terminal-wrapper:${stage}`,
    freshnessRef: `freshness:vscode:terminal-wrapper:${stage}`,
    observationRef: `observation:vscode:terminal-wrapper:${stage}`,
  };
}

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
