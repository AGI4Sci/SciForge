import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  createComputerUsePrimitiveService,
} from './index.js';
import {
  createCurrentVSCodeCoWorkLivePrimitivePorts,
  runCurrentVSCodeCoWorkLiveDiagnosticPreflight,
  VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV,
  VSCODE_COWORK_LIVE_DIAGNOSTIC_CAPABILITY,
} from './vscode-cowork-live-diagnostic.js';

test('current VSCode co-work live diagnostic is env-gated and never product-ready', async () => {
  const manifest = await runCurrentVSCodeCoWorkLiveDiagnosticPreflight({
    env: {},
    now: () => new Date('2026-06-08T00:00:00.000Z'),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.skipReason, `missing-env:${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}`);
  assert.equal(manifest.maturity, 'live-diagnostic');
  assert.equal(manifest.productReady, false);
  assert.equal(manifest.userProfileUsed, true);
  assert.equal(manifest.sharedSystemInputUsed, true);
  assert.equal(manifest.vscodeLaunched, false);
  assert.equal(manifest.userProfileCleared, false);
  assert.equal(manifest.userVSCodeKilled, false);
  assert.deepEqual(manifest.primitiveChainObserved, []);
  assert.doesNotMatch(JSON.stringify(manifest), /rawScreenshot|providerPayload|base64|product-ready|kill-vscode|clear-profile/i);

  assert.equal(VSCODE_COWORK_LIVE_DIAGNOSTIC_CAPABILITY.requiresExplicitEnv, `${VSCODE_COWORK_LIVE_DIAGNOSTIC_ENV}=1`);
  assert.equal(VSCODE_COWORK_LIVE_DIAGNOSTIC_CAPABILITY.productReady, false);
});

test('current VSCode co-work primitive ports bind current window, observe refs, and release restoration refs', async () => {
  const calls: string[] = [];
  const service = createComputerUsePrimitiveService({
    now: () => new Date('2026-06-08T00:00:00.000Z').getTime(),
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode',
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
    }),
  });

  const bind = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.bind,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.microsoft.VSCode',
        targetRef: 'current-vscode-cowork',
      },
    },
  });
  assert.equal(bind.ok, true);
  const sessionId = (bind.value?.output as { sessionId?: string } | undefined)?.sessionId;
  assert.equal(sessionId, 'current-vscode-cowork:unit-current-vscode');

  const observe = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId,
      capture: 'both',
      includeTree: true,
    },
  });
  assert.equal(observe.ok, true);

  const control = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.control,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId,
      command: 'release',
    },
  });
  assert.equal(control.ok, true);

  const refs = [
    ...((bind.value?.refs ?? []) as string[]),
    ...((observe.value?.refs ?? []) as string[]),
    ...((control.value?.refs ?? []) as string[]),
  ];
  assert.ok(refs.includes('window:vscode:paper'));
  assert.ok(refs.includes('file-ref:vscode:paper'));
  assert.ok(refs.includes('element:vscode:editor'));
  assert.ok(refs.includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode'));
  assert.ok(refs.includes('scoped-input-adapter:current-vscode-cowork:unit-current-vscode'));
  assert.ok(refs.includes('cursor-marker:current-vscode-cowork:unit-current-vscode'));
  assert.ok(refs.includes('front-app-restore:current-vscode-cowork:unit-current-vscode'));
  assert.ok(refs.includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode'));
  assert.deepEqual(calls, [
    'read-current-window',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode',
  ]);
  assert.doesNotMatch(JSON.stringify({ bind, observe, control }), /raw-|providerPayload|base64|kill-vscode|clear-profile/i);
});

test('current VSCode co-work primitive ports capture and restore desktop state on release', async () => {
  const calls: string[] = [];
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode-restore',
      captureRestorationState: async () => {
        calls.push('capture-restoration');
        return {
          frontApplicationName: 'Codex',
          mousePosition: { x: 12, y: 34 },
        };
      },
      restoreCapturedState: async (state, refs) => {
        calls.push(`restore-captured:${state.frontApplicationName}:${state.mousePosition?.x},${state.mousePosition?.y}:${refs.frontAppRestoreRef}:${refs.mousePositionRestoreRef}`);
      },
      readCurrentWindow: async () => {
        calls.push('read-current-window');
        return {
          appRef: 'macos-app:com.microsoft.VSCode',
          processRef: 'process:vscode:restore',
          windowRef: 'window:vscode:restore',
          titleRef: 'text:title:restore',
          frontmostRef: 'frontmost:vscode:restore',
          fileRefs: [],
          editorElementRef: 'element:vscode:editor',
          visibleTextRef: 'text:vscode:visible',
          screenshotRef: 'image:vscode:current',
          accessibilityRef: 'accessibility:vscode:current',
          freshnessRef: 'freshness:vscode:current',
          observationRef: 'observation:vscode:current',
        };
      },
    }),
  });

  const bind = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.bind,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'app',
        appId: 'com.microsoft.VSCode',
        targetRef: 'current-vscode-cowork',
      },
    },
  });
  const sessionId = (bind.value?.output as { sessionId?: string } | undefined)?.sessionId;
  assert.equal(sessionId, 'current-vscode-cowork:unit-current-vscode-restore');

  const control = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.control,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId,
      command: 'release',
    },
  });

  assert.equal(control.ok, true);
  assert.deepEqual(calls, [
    'capture-restoration',
    'read-current-window',
    'restore-captured:Codex:12,34:front-app-restore:current-vscode-cowork:unit-current-vscode-restore:mouse-position-restore:current-vscode-cowork:unit-current-vscode-restore',
  ]);
  assert.ok((control.value?.refs ?? []).includes('front-app-restore:current-vscode-cowork:unit-current-vscode-restore'));
  assert.ok((control.value?.refs ?? []).includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-restore'));
});
