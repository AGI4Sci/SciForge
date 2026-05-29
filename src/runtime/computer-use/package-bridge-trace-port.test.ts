import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { WorkspaceRuntimeEvent } from '../runtime-types.js';
import { emitPackageBridgeEventPort } from './package-bridge-trace-port.js';
import type { HostPortCall } from './package-bridge-stdio.js';

function hostPortCall(args?: unknown[]): HostPortCall {
  return {
    type: 'hostPortCall',
    id: 'emit-event-001',
    port: 'emitEvent',
    args,
  };
}

test('emitPackageBridgeEventPort forwards package event metadata to runtime callbacks', () => {
  const events: WorkspaceRuntimeEvent[] = [];

  const result = emitPackageBridgeEventPort(hostPortCall([{
    type: 'computer-use.package.progress',
    status: 'running',
    task: 'Review current page',
    reason: 'Package reached planner checkpoint',
    extra: { step: 2 },
  }]), {
    callbacks: { onEvent: (event) => events.push(event) },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'computer-use.package.progress');
  assert.equal(events[0]?.source, 'computer-use-package-bridge');
  assert.equal(events[0]?.toolName, 'local.vision-sense');
  assert.equal(events[0]?.status, 'running');
  assert.equal(events[0]?.message, 'Package reached planner checkpoint');
  assert.deepEqual(JSON.parse(events[0]?.detail ?? '{}'), {
    type: 'computer-use.package.progress',
    status: 'running',
    task: 'Review current page',
    reason: 'Package reached planner checkpoint',
    extra: { step: 2 },
  });
});

test('emitPackageBridgeEventPort uses compatible defaults for malformed package events', () => {
  const events: WorkspaceRuntimeEvent[] = [];

  const result = emitPackageBridgeEventPort(hostPortCall(['not-a-record']), {
    callbacks: { onEvent: (event) => events.push(event) },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'computer-use.package.event');
  assert.equal(events[0]?.status, 'running');
  assert.equal(events[0]?.message, undefined);
  assert.equal(events[0]?.detail, '{}');
});
