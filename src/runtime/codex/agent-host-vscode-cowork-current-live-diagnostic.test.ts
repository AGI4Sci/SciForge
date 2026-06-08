import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
} from '../../../packages/actions/computer-use/vscode-cowork-live-diagnostic.js';
import {
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
