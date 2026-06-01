import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildVirtualAppScreenLifecycleBlockedEvent,
  buildVirtualAppScreenLifecycleEventLog,
  event,
  lifecycleLog,
  validateVirtualAppScreenLifecycleEventLog,
  VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES,
  VIRTUAL_APP_SCREEN_LIFECYCLE_SCHEMA_VERSION,
  type VirtualAppScreenLifecycleEvent,
} from '../../tools/computer-use-next/virtual-app-screen-lifecycle.js';

test('VirtualAppScreen lifecycle builder emits complete refs-first create-to-handoff sequence', () => {
  const log = validLifecycleLog('complete-sequence');

  assert.equal(log.schemaVersion, VIRTUAL_APP_SCREEN_LIFECYCLE_SCHEMA_VERSION);
  assert.equal(log.refsFirst, true);
  assert.equal(log.guiBoundary.executesBackend, false);
  assert.equal(log.guiBoundary.role, 'presentation-and-event-refs');
  assert.deepEqual(log.events.map((item) => item.type), VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES);
  assert.equal(log.validation.ok, true, log.validation.issues.map((issue) => issue.message).join('\n'));
  for (const item of log.events) {
    assert.equal(item.refsFirst, true);
    assert.ok(item.refs.eventRef);
    assert.ok(item.refs.screenRef);
    assert.ok(item.refs.targetAppRef);
    assert.ok(item.refs.targetWindowRef);
    assert.ok(item.refs.sessionRef);
  }
  assert.ok(log.events.find((item) => item.type === 'observe')?.refs.frameRef);
  assert.ok(log.events.find((item) => item.type === 'annotate')?.refs.annotationProposalRef);
  assert.ok(log.events.find((item) => item.type === 'control')?.refs.inputIntentRef);
  assert.ok(log.events.find((item) => item.type === 'handoff')?.refs.handoffRef);
  assert.ok(log.events.find((item) => item.type === 'handoff')?.refs.blockedReasonRef);
});

test('VirtualAppScreen lifecycle validator blocks missing lifecycle events', () => {
  const log = validLifecycleLog('missing-event');
  const validation = validateVirtualAppScreenLifecycleEventLog({
    ...log,
    events: log.events.filter((item) => item.type !== 'annotate'),
  });

  assert.equal(validation.ok, false);
  assert.deepEqual(validation.missingEventTypes, ['annotate']);
  assert.ok(validation.issues.some((issue) => issue.code === 'missing-lifecycle-event'));
});

test('VirtualAppScreen lifecycle rejects active screen and target binding conflicts', () => {
  const sameScreenConflict = validLifecycleLog('same-screen-conflict');
  sameScreenConflict.events[1] = {
    ...sameScreenConflict.events[1],
    refs: {
      ...sameScreenConflict.events[1].refs,
      targetAppRef: 'app:other-editor',
      targetWindowRef: 'window:other-editor/main',
      sessionRef: 'computer-use-session:other-editor',
    },
  };
  const sameScreenValidation = validateVirtualAppScreenLifecycleEventLog(sameScreenConflict);

  assert.equal(sameScreenValidation.ok, false);
  assert.ok(sameScreenValidation.activeBindingConflicts.some((conflict) => (
    conflict.code === 'screen-target-conflict'
    && conflict.screenRef === 'virtual-app-screen:same-screen-conflict'
  )));

  const targetConflict = validLifecycleLog('target-conflict');
  const secondScreenCreate = event('create', '2026-06-01T00:00:00.000Z', {
    ...targetConflict.events[0].refs,
    screenRef: 'virtual-app-screen:target-conflict-second',
    eventRef: '.sciforge/vision-runs/target-conflict/lifecycle/second-create.json',
  });
  const targetValidation = validateVirtualAppScreenLifecycleEventLog({
    ...targetConflict,
    events: [
      targetConflict.events[0],
      secondScreenCreate,
      ...targetConflict.events.slice(1),
    ],
  });

  assert.equal(targetValidation.ok, false);
  assert.ok(targetValidation.activeBindingConflicts.some((conflict) => (
    conflict.code === 'target-app-active-conflict'
    && conflict.targetRef === 'app:target-conflict'
  )));
  assert.ok(targetValidation.activeBindingConflicts.some((conflict) => (
    conflict.code === 'target-window-active-conflict'
    && conflict.targetRef === 'window:target-conflict/main'
  )));
  assert.ok(targetValidation.activeBindingConflicts.some((conflict) => (
    conflict.code === 'target-session-active-conflict'
    && conflict.targetRef === 'computer-use-session:target-conflict'
  )));
});

test('VirtualAppScreen lifecycle carries handoff and blocked reason refs before summaries', () => {
  const log = validLifecycleLog('blocked-handoff');
  const blocked = buildVirtualAppScreenLifecycleBlockedEvent({
    runId: 'blocked-handoff',
    createdAt: '2026-06-01T00:00:00.000Z',
    screenRef: 'virtual-app-screen:blocked-handoff',
    targetAppRef: 'app:blocked-handoff',
    targetWindowRef: 'window:blocked-handoff/main',
    sessionRef: 'computer-use-session:blocked-handoff',
    blockedReason: 'Adapter cannot prove background isolation; user handoff required.',
    blockedReasonRef: '.sciforge/vision-runs/blocked-handoff/lifecycle/blocked-reason.json',
    handoffRef: '.sciforge/vision-runs/blocked-handoff/lifecycle/handoff.json',
  });
  const withBlocked = validateVirtualAppScreenLifecycleEventLog({
    ...log,
    events: [...log.events.slice(0, -1), blocked],
  });

  assert.equal(withBlocked.ok, true, withBlocked.issues.map((issue) => issue.message).join('\n'));
  assert.equal(blocked.status, 'blocked');
  assert.match(String(blocked.reason), /background isolation/);
  assert.ok(blocked.refs.blockedReasonRef);
  assert.ok(blocked.refs.handoffRef);

  const missingReasonRef = validateVirtualAppScreenLifecycleEventLog({
    ...log,
    events: [
      ...log.events.slice(0, -1),
      {
        ...blocked,
        refs: {
          ...blocked.refs,
          blockedReasonRef: undefined,
        },
      },
    ],
  });

  assert.equal(missingReasonRef.ok, false);
  assert.ok(missingReasonRef.issues.some((issue) => issue.code === 'missing-blocked-reason-ref'));
});

test('VirtualAppScreen lifecycle rejects raw screenshot, base64, provider payload, and backend execution', () => {
  const log = validLifecycleLog('raw-payload');
  const control = log.events.find((item) => item.type === 'control');
  assert.ok(control);
  const pollutedControl = {
    ...control,
    backendExecuted: true,
    payload: {
      providerPayload: {
        rawScreenshot: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      },
    },
    metadata: {
      screenshotBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAAAAAAABAAAAAAABAAAAAAABAAAAAAABAAAAAAABAAAAAAABAAAAAAABAAAAAAAB',
    },
  } as VirtualAppScreenLifecycleEvent & {
    backendExecuted: boolean;
    payload: Record<string, unknown>;
  };
  const validation = validateVirtualAppScreenLifecycleEventLog({
    ...log,
    events: log.events.map((item) => (item.type === 'control' ? pollutedControl : item)),
  });

  assert.equal(validation.ok, false);
  assert.ok(validation.rawPayloadViolations.some((violation) => violation.reason === 'raw-payload-key'));
  assert.ok(validation.rawPayloadViolations.some((violation) => violation.reason === 'inline-base64'));
  assert.ok(validation.rawPayloadViolations.some((violation) => violation.reason === 'backend-execution'));
});

function validLifecycleLog(runId: string) {
  return buildVirtualAppScreenLifecycleEventLog({
    runId,
    createdAt: '2026-06-01T00:00:00.000Z',
    screenRef: `virtual-app-screen:${runId}`,
    targetAppRef: `app:${runId}`,
    targetWindowRef: `window:${runId}/main`,
    sessionRef: `computer-use-session:${runId}`,
    presentationRefs: [`.sciforge/vision-runs/${runId}/gui-present.json`],
    evidenceRefs: [`.sciforge/vision-runs/${runId}/evidence-ledger.json`],
  });
}

test('VirtualAppScreen lifecycle custom logs still validate without fixture-specific ids', () => {
  const at = '2026-06-01T00:00:00.000Z';
  const refs = {
    screenRef: 'virtual-app-screen:custom',
    targetAppRef: 'app:custom-analysis',
    targetWindowRef: 'window:custom-analysis/document-2',
    sessionRef: 'computer-use-session:custom-analysis-run',
    presentationRefs: ['gui.present:custom-analysis/screen'],
    evidenceRefs: ['computer-use:custom-analysis/evidence-ledger.json'],
  };
  const log = lifecycleLog({
    logRef: 'computer-use:custom-analysis/lifecycle.json',
    createdAt: at,
    events: VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES.map((type, index) => event(type, at, {
      ...refs,
      eventRef: `computer-use:custom-analysis/lifecycle/${type}.json`,
      previousEventRef: index > 0
        ? `computer-use:custom-analysis/lifecycle/${VIRTUAL_APP_SCREEN_LIFECYCLE_EVENT_TYPES[index - 1]}.json`
        : undefined,
      frameRef: type === 'observe' ? 'computer-use:custom-analysis/frames/current.png' : undefined,
      annotationProposalRef: type === 'annotate' ? 'computer-use:custom-analysis/annotations/proposal.json' : undefined,
      inputIntentRef: type === 'control' ? 'computer-use:custom-analysis/input-intents/edit.json' : undefined,
      handoffRef: type === 'handoff' ? 'computer-use:custom-analysis/handoff.json' : undefined,
      blockedReasonRef: type === 'handoff' ? 'computer-use:custom-analysis/handoff-reason.json' : undefined,
    }, type === 'handoff' ? 'handoff summary is backed by blockedReasonRef' : undefined)),
  });
  const validation = validateVirtualAppScreenLifecycleEventLog(log);

  assert.equal(validation.ok, true, validation.issues.map((issue) => issue.message).join('\n'));
});
