import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS,
  COMPUTER_USE_PRIMITIVE_INTENTS,
  createComputerUsePrimitiveService,
  type ComputerUseActOutput,
  type ComputerUseBindOutput,
  type ComputerUseObserveOutput,
} from '../../../packages/actions/computer-use/index.js';
import { createWindowActionSession } from '../window-action-session.js';
import { createInMemoryWindowActionSessionStore } from '../window-action-session-store.js';
import {
  createWindowActionSessionComputerUsePrimitivePorts,
} from './window-action-computer-use-primitive-ports.js';

const now = '2026-06-07T00:00:00.000Z';

test('WindowActionSession Computer Use primitive ports bind observe act and release through Host store', async () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  store.upsert(createWindowActionSession({
    id: 'notes-window',
    windowRef: 'desktop-window:notes/main',
    app: { id: 'com.example.Notes', name: 'Notes', kind: 'ordinary-app' },
    evidenceRefs: [{ kind: 'desktop-native', ref: 'desktop-native:notes/window-main' }],
    timestamp: now,
  }), {
    observationRefs: [
      'desktop-native:notes/screenshot-before',
      'accessibility-ui-automation:notes/state-snapshot-before',
      'desktop-window:notes/main',
      'accessibility-ui-automation:notes/text-before',
    ],
  });

  const adapterCalls: Array<{ adapterRef: string; action: string; beforeRefs: string[] }> = [];
  const ports = createWindowActionSessionComputerUsePrimitivePorts({
    windowActionSessionStore: store,
    now: () => new Date(now),
    adapterHandlers: {
      'accessibility-ui-automation': (context) => {
        adapterCalls.push({
          adapterRef: context.scopedInputAdapter.ref,
          action: context.input.action,
          beforeRefs: (context.input.beforeEvidenceRefs ?? []).flatMap((item) => {
            if (typeof item === 'object' && item !== null && 'ref' in item) return [String((item as { ref?: unknown }).ref)];
            return [];
          }),
        });
        return {
          status: 'completed',
          inputEventRefs: ['executor-event:notes-window/click/input-event'],
          evidenceRefs: ['executor-event:notes-window/click/executor'],
          afterEvidenceRefs: [
            'desktop-native:notes/screenshot-after-click',
            'accessibility-ui-automation:notes/state-snapshot-after-click',
          ],
        };
      },
    },
  });
  const service = createComputerUsePrimitiveService({ ports, now: () => new Date(now).getTime() });

  const bind = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.bind,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        targetRef: 'window-action-session:notes-window',
      },
    },
  });
  assert.equal(bind.ok, true, bind.error);
  const bindOutput = bind.value?.output as ComputerUseBindOutput;
  assert.equal(bindOutput.sessionRef, 'computer-use:session:notes-window');
  assert.equal(bindOutput.windowActionSessionRef, 'window-action-session:notes-window');
  assert.equal(bindOutput.inputAdapterRef, 'scoped-input-adapter:notes-window/computer-use/accessibility-ui-automation');
  assert.equal(bindOutput.cursorRef, 'actor-cursor:computer-use/notes-window');
  assert.equal(bindOutput.scopedInputLeaseRef, 'input-lease:window-action-session/notes-window');

  const observed = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId: bindOutput.sessionId,
      capture: 'both',
      includeTree: true,
    },
  });
  assert.equal(observed.ok, true, observed.error);
  const observedOutput = observed.value?.output as ComputerUseObserveOutput;
  assert.equal(observedOutput.sessionId, bindOutput.sessionId);
  assert.equal(observedOutput.screenshotRef, 'desktop-native:notes/screenshot-before');
  assert.equal(observedOutput.accessibilityRef, 'accessibility-ui-automation:notes/state-snapshot-before');
  assert.ok(observedOutput.elementRefs?.includes('desktop-window:notes/main'));
  assert.ok(observedOutput.textRefs?.includes('accessibility-ui-automation:notes/text-before'));

  const acted = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.act,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: bindOutput.sessionId,
      action: {
        type: 'click',
        point: { x: 24, y: 32, coordinateSpace: 'window' },
      },
      captureAfter: true,
    },
  });
  assert.equal(acted.ok, true, acted.error);
  assert.equal(acted.value?.status, 'completed');
  const actOutput = acted.value?.output as ComputerUseActOutput;
  assert.equal(adapterCalls.length, 1);
  assert.equal(adapterCalls[0]?.adapterRef, bindOutput.inputAdapterRef);
  assert.equal(adapterCalls[0]?.action, 'click');
  assert.ok(adapterCalls[0]?.beforeRefs.includes(observedOutput.observationRef));
  assert.equal(actOutput.inputAdapterRef, bindOutput.inputAdapterRef);
  assert.equal(actOutput.cursorRef, bindOutput.cursorRef);
  assert.equal(actOutput.scopedInputLeaseRef, bindOutput.scopedInputLeaseRef);
  assert.equal(actOutput.beforeObservationRef, observedOutput.observationRef);
  assert.equal(actOutput.afterObservationRef, 'desktop-native:notes/screenshot-after-click');
  assert.equal(actOutput.inputEventRef, 'executor-event:notes-window/click/input-event');
  assert.ok(actOutput.invalidatedRefs?.includes(observedOutput.observationRef));

  const released = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.control,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.control,
      sessionId: bindOutput.sessionId,
      command: 'release',
    },
  });
  assert.equal(released.ok, true, released.error);
  assert.equal(released.value?.status, 'completed');
  assert.ok(released.value?.refs.includes(bindOutput.inputAdapterRef));
  assert.equal(store.getActiveByRef('window-action-session:notes-window'), undefined);
});

test('WindowActionSession Computer Use primitive ports serialize shared system input globally', async () => {
  const store = createInMemoryWindowActionSessionStore({ now: () => new Date(now) });
  for (const id of ['canvas-a', 'canvas-b']) {
    store.upsert(createWindowActionSession({
      id,
      windowRef: `desktop-window:${id}/main`,
      app: { id: 'com.example.LegacyCanvas', name: 'Legacy Canvas', kind: 'ordinary-app' },
      evidenceRefs: [{ kind: 'desktop-native', ref: `desktop-native:${id}/window-main` }],
      timestamp: now,
    }), {
      observationRefs: [
        `desktop-native:${id}/screenshot-before`,
        `accessibility-ui-automation:${id}/state-snapshot-before`,
        `desktop-window:${id}/main`,
        `accessibility-ui-automation:${id}/text-before`,
      ],
    });
  }

  let releaseFirstHandler!: () => void;
  const firstHandlerReleased = new Promise<void>((resolve) => {
    releaseFirstHandler = resolve;
  });
  let firstHandlerStarted!: () => void;
  const firstHandlerReady = new Promise<void>((resolve) => {
    firstHandlerStarted = resolve;
  });
  const handlerSessions: string[] = [];
  const ports = createWindowActionSessionComputerUsePrimitivePorts({
    windowActionSessionStore: store,
    now: () => new Date(now),
    sharedSystemInputMode: 'explicit-handoff',
    adapterHandlers: {
      'system-input': async (context) => {
        handlerSessions.push(context.session.id);
        firstHandlerStarted();
        await firstHandlerReleased;
        return {
          status: 'completed',
          inputEventRefs: [`input-event:${context.session.id}/click`],
          evidenceRefs: [`executor-event:${context.session.id}/click`],
          afterEvidenceRefs: [`desktop-native:${context.session.id}/screenshot-after-click`],
        };
      },
    },
  });
  const service = createComputerUsePrimitiveService({ ports, now: () => new Date(now).getTime() });

  const firstBind = await bindSession(service, 'canvas-a');
  const secondBind = await bindSession(service, 'canvas-b');
  await observeSession(service, firstBind.sessionId);
  await observeSession(service, secondBind.sessionId);

  const firstAct = service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.act,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: firstBind.sessionId,
      action: {
        type: 'click',
        point: { x: 8, y: 12, coordinateSpace: 'window' },
      },
    },
  });
  await firstHandlerReady;

  const secondAct = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.act,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.act,
      sessionId: secondBind.sessionId,
      action: {
        type: 'click',
        point: { x: 16, y: 24, coordinateSpace: 'window' },
      },
    },
  });
  assert.equal(secondAct.ok, false);
  assert.match(secondAct.error ?? '', /shared_system_input_lease_busy/);
  assert.deepEqual(handlerSessions, ['canvas-a']);

  releaseFirstHandler();
  const completedFirst = await firstAct;
  assert.equal(completedFirst.ok, true, completedFirst.error);
  assert.equal(completedFirst.value?.status, 'completed');
});

async function bindSession(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  id: string,
): Promise<ComputerUseBindOutput> {
  const bind = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.bind,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.bind,
      target: {
        kind: 'window',
        targetRef: `window-action-session:${id}`,
      },
    },
  });
  assert.equal(bind.ok, true, bind.error);
  return bind.value?.output as ComputerUseBindOutput;
}

async function observeSession(
  service: ReturnType<typeof createComputerUsePrimitiveService>,
  sessionId: string,
): Promise<ComputerUseObserveOutput> {
  const observed = await service.invoke({
    moduleId: 'computer_use',
    intent: COMPUTER_USE_PRIMITIVE_INTENTS.observe,
    input: {
      schemaVersion: COMPUTER_USE_PRIMITIVE_INPUT_SCHEMAS.observe,
      sessionId,
      capture: 'both',
    },
  });
  assert.equal(observed.ok, true, observed.error);
  return observed.value?.output as ComputerUseObserveOutput;
}
