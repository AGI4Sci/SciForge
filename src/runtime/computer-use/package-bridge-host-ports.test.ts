import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dispatchPackageBridgeHostPortCall,
  type PackageBridgeHostPortHandlers,
} from './package-bridge-host-ports.js';
import type { HostPortCall } from './package-bridge-stdio.js';

const baseHandlers = (events: string[] = []): PackageBridgeHostPortHandlers => ({
  capture: (call) => {
    events.push(`capture:${call.id}`);
    return { ref: 'capture-ref' };
  },
  plan: () => ({ actions: [] }),
  locate: () => ({ target: null }),
  execute: () => ({ status: 'skipped' }),
  verify: () => ({ ok: true }),
  writeTrace: () => ({ traceRef: 'trace.json' }),
  emitEvent: () => ({ emitted: true }),
});

function hostPortCall(port: string, id = 'call-001'): HostPortCall {
  return {
    type: 'hostPortCall',
    id,
    port,
  };
}

test('dispatchPackageBridgeHostPortCall routes supported host ports to handlers', async () => {
  const events: string[] = [];
  const result = await dispatchPackageBridgeHostPortCall(hostPortCall('capture'), {
    callbacks: {},
    handlers: baseHandlers(events),
  });

  assert.deepEqual(result, { ref: 'capture-ref' });
  assert.deepEqual(events, ['capture:call-001']);
});

test('dispatchPackageBridgeHostPortCall rejects when workspace runtime signal is aborted', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    dispatchPackageBridgeHostPortCall(hostPortCall('capture'), {
      callbacks: { signal: controller.signal },
      handlers: baseHandlers(),
    }),
    /Computer Use host port call aborted by workspace runtime signal/,
  );
});

test('dispatchPackageBridgeHostPortCall rejects unsupported host ports', async () => {
  await assert.rejects(
    dispatchPackageBridgeHostPortCall(hostPortCall('directGuiCall'), {
      callbacks: {},
      handlers: baseHandlers(),
    }),
    /Unsupported Computer Use host port: directGuiCall/,
  );
});
