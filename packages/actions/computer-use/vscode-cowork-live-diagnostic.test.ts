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

test('current VSCode co-work primitive ports execute refs-first type action and return action evidence refs', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:mutate',
      windowRef: 'window:vscode:mutate',
      titleRef: 'text:title:mutate',
      frontmostRef: 'frontmost:vscode:mutate',
      fileRefs: ['file-ref:vscode:mutate'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:visible-before',
      visibleTextSha256Ref: 'text:vscode:visible-before-sha256',
      screenshotRef: 'image:vscode:before',
      accessibilityRef: 'accessibility:vscode:before',
      freshnessRef: 'freshness:vscode:before',
      observationRef: 'observation:vscode:before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:mutate',
      windowRef: 'window:vscode:mutate',
      titleRef: 'text:title:mutate',
      frontmostRef: 'frontmost:vscode:mutate',
      fileRefs: ['file-ref:vscode:mutate'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:visible-after',
      visibleTextSha256Ref: 'text:vscode:visible-after-sha256',
      screenshotRef: 'image:vscode:after',
      accessibilityRef: 'accessibility:vscode:after',
      freshnessRef: 'freshness:vscode:after',
      observationRef: 'observation:vscode:after',
    },
  ];
  const service = createComputerUsePrimitiveService({
    now: () => new Date('2026-06-08T00:00:00.000Z').getTime(),
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode-act',
      readCurrentWindow: async () => {
        calls.push('read-current-window');
        return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
      },
      performAction: async (input) => {
        calls.push([
          'perform-action',
          input.action.type,
          input.action.textRef,
          input.action.elementRef,
          input.inputAdapterRef,
          input.cursorRef,
          input.scopedInputLeaseRef,
          input.beforeObservationRef,
        ].join(':'));
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
  assert.equal(sessionId, 'current-vscode-cowork:unit-current-vscode-act');

  const act = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.act,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId,
      actionId: 'insert-draft',
      action: {
        type: 'type',
        textRef: 'text-ref:current-vscode-cowork:draft',
        elementRef: 'element:vscode:editor',
      },
      captureAfter: true,
    },
  });
  assert.equal(act.ok, true, act.error);

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

  const output = act.value?.output as Record<string, unknown> | undefined;
  assert.equal(output?.actionRef, 'action:current-vscode-cowork:unit-current-vscode-act:insert-draft');
  assert.equal(output?.executorEventRef, 'executor-event:current-vscode-cowork:unit-current-vscode-act:insert-draft');
  assert.equal(output?.inputEventRef, 'input-event:current-vscode-cowork:unit-current-vscode-act:insert-draft');
  assert.equal(output?.beforeObservationRef, 'observation:vscode:before');
  assert.equal(output?.afterObservationRef, 'observation:vscode:after');
  assert.deepEqual(output?.invalidatedRefs, ['stale-invalidation:current-vscode-cowork:unit-current-vscode-act:insert-draft']);
  assert.equal(output?.inputAdapterRef, 'scoped-input-adapter:current-vscode-cowork:unit-current-vscode-act');
  assert.equal(output?.cursorRef, 'cursor-marker:current-vscode-cowork:unit-current-vscode-act');
  assert.equal(output?.scopedInputLeaseRef, 'scoped-input-lease:current-vscode-cowork:unit-current-vscode-act');
  assert.ok((act.value?.refs ?? []).includes('text-ref:current-vscode-cowork:draft'));
  assert.ok((act.value?.refs ?? []).includes('observation:vscode:after'));
  assert.ok((control.value?.refs ?? []).includes('scoped-input-lease:current-vscode-cowork:unit-current-vscode-act'));
  assert.deepEqual(calls, [
    'read-current-window',
    'perform-action:type:text-ref:current-vscode-cowork:draft:element:vscode:editor:scoped-input-adapter:current-vscode-cowork:unit-current-vscode-act:cursor-marker:current-vscode-cowork:unit-current-vscode-act:scoped-input-lease:current-vscode-cowork:unit-current-vscode-act:observation:vscode:before',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-act',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-act',
  ]);
  assert.doesNotMatch(JSON.stringify({ act, control }), /draft body|raw-|providerPayload|base64|kill-vscode|clear-profile/i);
});

test('current VSCode co-work primitive ports resolve text refs for the default type executor without leaking raw text', async () => {
  const calls: string[] = [];
  const observations = [
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:default-type',
      windowRef: 'window:vscode:default-type',
      titleRef: 'text:title:default-type',
      frontmostRef: 'frontmost:vscode:default-type',
      fileRefs: ['file-ref:vscode:default-type'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:default-type-before',
      visibleTextSha256Ref: 'text:vscode:default-type-before-sha256',
      screenshotRef: 'image:vscode:default-type-before',
      accessibilityRef: 'accessibility:vscode:default-type-before',
      freshnessRef: 'freshness:vscode:default-type-before',
      observationRef: 'observation:vscode:default-type-before',
    },
    {
      appRef: 'macos-app:com.microsoft.VSCode',
      processRef: 'process:vscode:default-type',
      windowRef: 'window:vscode:default-type',
      titleRef: 'text:title:default-type',
      frontmostRef: 'frontmost:vscode:default-type',
      fileRefs: ['file-ref:vscode:default-type'],
      editorElementRef: 'element:vscode:editor',
      visibleTextRef: 'text:vscode:default-type-after',
      visibleTextSha256Ref: 'text:vscode:default-type-after-sha256',
      screenshotRef: 'image:vscode:default-type-after',
      accessibilityRef: 'accessibility:vscode:default-type-after',
      freshnessRef: 'freshness:vscode:default-type-after',
      observationRef: 'observation:vscode:default-type-after',
    },
  ];
  const service = createComputerUsePrimitiveService({
    now: () => new Date('2026-06-08T00:00:00.000Z').getTime(),
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode-default-type',
      readCurrentWindow: async () => {
        calls.push('read-current-window');
        return observations[Math.min(calls.filter((call) => call === 'read-current-window').length - 1, observations.length - 1)]!;
      },
      resolveTextRef: async (textRef) => {
        calls.push(`resolve-text:${textRef}`);
        return textRef === 'text-ref:current-vscode-cowork:draft'
          ? 'draft body that must stay private'
          : undefined;
      },
      typeResolvedText: async (input) => {
        calls.push(`type-resolved-text:${input.textRef}:${input.text.length}:${input.beforeObservationRef}`);
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
  assert.equal(sessionId, 'current-vscode-cowork:unit-current-vscode-default-type');

  const act = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.act,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId,
      actionId: 'insert-draft',
      action: {
        type: 'type',
        textRef: 'text-ref:current-vscode-cowork:draft',
        elementRef: 'element:vscode:editor',
      },
      captureAfter: true,
    },
  });
  assert.equal(act.ok, true, act.error);

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
    'read-current-window',
    'resolve-text:text-ref:current-vscode-cowork:draft',
    'type-resolved-text:text-ref:current-vscode-cowork:draft:33:observation:vscode:default-type-before',
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-default-type',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-default-type',
  ]);
  assert.ok((act.value?.refs ?? []).includes('text-ref:current-vscode-cowork:draft'));
  assert.ok((act.value?.refs ?? []).includes('action:current-vscode-cowork:unit-current-vscode-default-type:insert-draft'));
  assert.ok((act.value?.refs ?? []).includes('observation:vscode:default-type-after'));
  assert.doesNotMatch(JSON.stringify({ act, control }), /draft body|must stay private|raw-|providerPayload|base64|kill-vscode|clear-profile/i);
});

test('current VSCode co-work primitive ports block the default type executor when text refs are unresolved', async () => {
  const calls: string[] = [];
  const observation = {
    appRef: 'macos-app:com.microsoft.VSCode',
    processRef: 'process:vscode:unresolved-type',
    windowRef: 'window:vscode:unresolved-type',
    titleRef: 'text:title:unresolved-type',
    frontmostRef: 'frontmost:vscode:unresolved-type',
    fileRefs: ['file-ref:vscode:unresolved-type'],
    editorElementRef: 'element:vscode:editor',
    visibleTextRef: 'text:vscode:unresolved-type-before',
    visibleTextSha256Ref: 'text:vscode:unresolved-type-before-sha256',
    screenshotRef: 'image:vscode:unresolved-type-before',
    accessibilityRef: 'accessibility:vscode:unresolved-type-before',
    freshnessRef: 'freshness:vscode:unresolved-type-before',
    observationRef: 'observation:vscode:unresolved-type-before',
  };
  const service = createComputerUsePrimitiveService({
    now: () => new Date('2026-06-08T00:00:00.000Z').getTime(),
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode-unresolved-type',
      readCurrentWindow: async () => {
        calls.push('read-current-window');
        return observation;
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

  const act = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.act,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId,
      actionId: 'insert-draft',
      action: {
        type: 'type',
        textRef: 'text-ref:current-vscode-cowork:missing-draft',
        elementRef: 'element:vscode:editor',
      },
      captureAfter: true,
    },
  });
  assert.equal(act.ok, false);
  assert.equal(act.value?.blockedReason, 'current-vscode-act-text-ref-unresolved');

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
    'read-current-window',
    'restore-focus:front-app-restore:current-vscode-cowork:unit-current-vscode-unresolved-type',
    'restore-mouse:mouse-position-restore:current-vscode-cowork:unit-current-vscode-unresolved-type',
  ]);
  assert.doesNotMatch(JSON.stringify({ act, control }), /draft body|raw-|providerPayload|base64|kill-vscode|clear-profile/i);
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

test('current VSCode co-work primitive ports restore desktop state when bind observation fails', async () => {
  const calls: string[] = [];
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode-bind-fail',
      captureRestorationState: async () => {
        calls.push('capture-restoration');
        return {
          frontApplicationName: 'Codex',
          mousePosition: { x: 56, y: 78 },
        };
      },
      restoreCapturedState: async (state, refs) => {
        calls.push(`restore-captured:${state.frontApplicationName}:${state.mousePosition?.x},${state.mousePosition?.y}:${refs.frontAppRestoreRef}:${refs.mousePositionRestoreRef}`);
      },
      readCurrentWindow: async () => {
        calls.push('read-current-window');
        throw new Error('current-vscode-not-frontmost');
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

  assert.equal(bind.ok, false);
  assert.equal(bind.value?.status, 'blocked');
  assert.match(bind.value?.blockedReason ?? '', /current-vscode-not-frontmost/);
  assert.deepEqual(calls, [
    'capture-restoration',
    'read-current-window',
    'restore-captured:Codex:56,78:front-app-restore:current-vscode-cowork:unit-current-vscode-bind-fail:mouse-position-restore:current-vscode-cowork:unit-current-vscode-bind-fail',
  ]);
  assert.doesNotMatch(JSON.stringify(bind), /product-ready|kill-vscode|clear-profile|providerPayload|base64/i);
});

test('current VSCode co-work primitive ports keep restoration refs when restoration hooks fail', async () => {
  const calls: string[] = [];
  const service = createComputerUsePrimitiveService({
    ports: createCurrentVSCodeCoWorkLivePrimitivePorts({
      runId: 'unit-current-vscode-restore-hook-fail',
      captureRestorationState: async () => {
        calls.push('capture-restoration');
        return {
          frontApplicationName: 'Codex',
          mousePosition: { x: 90, y: 12 },
        };
      },
      restoreCapturedState: async () => {
        calls.push('restore-captured');
        throw new Error('/Users/example/Desktop/restore failed');
      },
      restoreFocus: async () => {
        calls.push('restore-focus');
        throw new Error('focus restore failed');
      },
      restoreMouse: async () => {
        calls.push('restore-mouse');
        throw new Error('mouse restore failed');
      },
      readCurrentWindow: async () => {
        calls.push('read-current-window');
        throw new Error('current-vscode-not-frontmost');
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

  assert.equal(bind.ok, false);
  assert.equal(bind.value?.status, 'blocked');
  assert.match(bind.value?.blockedReason ?? '', /current-vscode-not-frontmost/);
  assert.ok((bind.value?.refs ?? []).includes('front-app-restore:current-vscode-cowork:unit-current-vscode-restore-hook-fail'));
  assert.ok((bind.value?.refs ?? []).includes('mouse-position-restore:current-vscode-cowork:unit-current-vscode-restore-hook-fail'));
  assert.deepEqual(calls, [
    'capture-restoration',
    'read-current-window',
    'restore-captured',
    'restore-focus',
    'restore-mouse',
  ]);
  assert.deepEqual((bind.value?.diagnostics ?? []).map((diagnostic) => diagnostic.code), [
    'current_vscode_restore_captured_failed',
    'current_vscode_restore_focus_failed',
    'current_vscode_restore_mouse_failed',
  ]);
  assert.doesNotMatch(JSON.stringify(bind), /\/Users\/example|product-ready|kill-vscode|clear-profile|providerPayload|base64/i);
});
