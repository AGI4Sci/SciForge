import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AX_INPUT_CONTROL_SWIFT,
  runMacosAxInputControlHook,
  type MacosAxOperationInput,
} from './macos-ax-input-control-hook.js';
import type { NativeVirtualDisplayDriverInputControlContext } from './native-driver-input-control.js';

test('macOS AX input/control hook capability probe is non-mutating and provider-root scoped', async () => {
  const writes: Array<{ ref: string; data: unknown }> = [];
  const axCalls: MacosAxOperationInput[] = [];

  const result = await runMacosAxInputControlHook(baseContext({ capabilityProbe: true }), {
    executeAxOperation: (input) => {
      axCalls.push(input);
      return { ok: true, mutationKind: 'capabilityProbe', verification: { windowsReadable: true } };
    },
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data });
    },
    now: () => 1234,
  });

  assert.equal(result.ok, true, result.detail);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(result.providerEvidenceWritten, true);
  assert.equal(result.inputAdapterCapability?.ok, true);
  assert.equal(result.inputAdapterCapability?.mechanism, 'pid-scoped-ax');
  assert.deepEqual(result.inputAdapterCapability?.refs?.verificationRefs, [
    `${providerRootRef}/verification/capability-pid-scoped-ax.json`,
  ]);
  assert.equal(axCalls.length, 1);
  assert.equal(axCalls[0]?.mode, 'capabilityProbe');
  assert.equal(axCalls[0]?.targetPid, 4242);
  assert.equal(writes[0]?.ref, `${providerRootRef}/verification/capability-pid-scoped-ax.json`);
});

test('macOS AX input/control hook executes click through pid-scoped AX and writes required evidence refs', async () => {
  const writes: Array<{ ref: string; data: Record<string, unknown> }> = [];
  const axCalls: MacosAxOperationInput[] = [];

  const result = await runMacosAxInputControlHook(baseContext(), {
    executeAxOperation: (input) => {
      axCalls.push(input);
      return { ok: true, mutationKind: 'AXPress', verification: { hitPid: 4242 } };
    },
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data: data as Record<string, unknown> });
    },
    now: () => 2345,
  });

  assert.equal(result.ok, true, result.detail);
  assert.equal(result.mutatingActionExecuted, true);
  assert.equal(result.providerEvidenceWritten, true);
  assert.equal(result.affectsPhysicalDisplay, false);
  assert.equal(result.sharedSystemInputUsed, false);
  assert.equal(result.systemPointerMoved, false);
  assert.equal(result.systemKeyboardEventsSent, false);
  assert.equal(axCalls.length, 1);
  assert.deepEqual(axCalls[0]?.point, { x: 1732, y: 82 });
  assert.equal(axCalls[0]?.mode, 'click');
  for (const suffix of [
    '/input-intents/sendInputIntent-click.json',
    '/executor-events/sendInputIntent-click.json',
    '/frames/sendInputIntent-click-before.json',
    '/frames/sendInputIntent-click-after.json',
    '/before-after/sendInputIntent-click.json',
    '/verification/sendInputIntent-click.json',
    '/control-plane/sendInputIntent-click/isolation-evidence.json',
    '/control-plane/sendInputIntent-click/physical-desktop-probe.json',
  ]) {
    assert.ok(writes.some((write) => write.ref === `${providerRootRef}${suffix}`), `missing ${suffix}`);
  }
  const verification = writes.find((write) => write.ref.endsWith('/verification/sendInputIntent-click.json'))?.data;
  assert.equal(verification?.mechanism, 'pid-scoped-ax');
  assert.equal(verification?.displayScoped, true);
  assert.equal(verification?.affectsPhysicalDisplay, false);
});

test('macOS AX input/control hook accepts Host ratio click payloads', async () => {
  const axCalls: MacosAxOperationInput[] = [];

  const result = await runMacosAxInputControlHook(baseContext({
    action: {
      kind: 'click',
      xRatio: 0.5,
      yRatio: 0.5,
    },
  }), {
    executeAxOperation: (input) => {
      axCalls.push(input);
      return { ok: true, mutationKind: 'AXPress', verification: { hitPid: 4242 } };
    },
    writeJsonRef: () => undefined,
  });

  assert.equal(result.ok, true, result.detail);
  assert.equal(axCalls[0]?.mode, 'click');
  assert.deepEqual(axCalls[0]?.point, { x: 2132, y: 382 });
});

test('macOS AX input/control hook fails closed when click point is outside target window', async () => {
  let axCalls = 0;
  const context = baseContext({
    action: {
      type: 'click',
      x: -20,
      y: 20,
    },
  });

  const result = await runMacosAxInputControlHook(context, {
    executeAxOperation: () => {
      axCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /outside the attached target window/u);
  assert.equal(result.mutatingActionExecuted, false);
  assert.equal(result.providerEvidenceWritten, false);
  assert.equal(axCalls, 0);
});

test('macOS AX input/control hook writes queue, refresh, and safe-stop control refs without OS input', async () => {
  const writes: Array<{ ref: string; data: Record<string, unknown> }> = [];
  let axCalls = 0;

  const resume = await runMacosAxInputControlHook(baseContext({ operation: 'resume', controlKind: 'resume-agent' }), {
    executeAxOperation: () => {
      axCalls += 1;
      return { ok: false };
    },
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data: data as Record<string, unknown> });
    },
  });
  const close = await runMacosAxInputControlHook(baseContext({ operation: 'closeSession', controlKind: 'stop-session' }), {
    executeAxOperation: () => {
      axCalls += 1;
      return { ok: false };
    },
    writeJsonRef: (_outDir, _runDirRef, ref, data) => {
      writes.push({ ref, data: data as Record<string, unknown> });
    },
  });

  assert.equal(resume.ok, true, resume.detail);
  assert.equal(close.ok, true, close.detail);
  assert.equal(axCalls, 0);
  assert.ok(writes.some((write) => write.ref === `${providerRootRef}/control-plane/resume-resume-agent/agent-queue.json`));
  assert.ok(writes.some((write) => write.ref === `${providerRootRef}/control-plane/resume-resume-agent/current-frame-refresh.json`));
  const safeStop = writes.find((write) => write.ref === `${providerRootRef}/control-plane/closeSession-stop-session/safe-stop.json`)?.data;
  assert.equal(safeStop?.safeStopMode, 'safe-close-or-pause-virtual-session-only');
  assert.equal(safeStop?.closesUserRealApp, false);
});

test('macOS AX input/control hook rejects shared/system-style actions', async () => {
  let axCalls = 0;
  const result = await runMacosAxInputControlHook(baseContext({
    action: {
      type: 'hotkey',
      keys: ['Meta', 'L'],
    },
  }), {
    executeAxOperation: () => {
      axCalls += 1;
      return { ok: true };
    },
  });

  assert.equal(result.ok, false);
  assert.match(result.detail ?? '', /does not support action type hotkey/u);
  assert.equal(axCalls, 0);
  assert.equal(result.mutatingActionExecuted, false);
});

test('macOS AX helper Swift source compiles against the current SDK', {
  skip: process.platform !== 'darwin' || !swiftcAvailable(),
}, () => {
  const helperDir = mkdtempSync(join(tmpdir(), 'sciforge-ax-input-control-compile-test-'));
  try {
    const sourcePath = join(helperDir, 'ax-input-control.swift');
    const binaryPath = join(helperDir, 'ax-input-control');
    writeFileSync(sourcePath, AX_INPUT_CONTROL_SWIFT, 'utf8');
    execFileSync('swiftc', ['-framework', 'ApplicationServices', sourcePath, '-o', binaryPath], {
      stdio: 'pipe',
      timeout: 20000,
    });
  } finally {
    rmSync(helperDir, { recursive: true, force: true });
  }
});

const runDirRef = '.sciforge/vision-runs/macos-ax-hook-test';
const providerRootRef = `${runDirRef}/virtual-display-provider`;

function swiftcAvailable(): boolean {
  try {
    execFileSync('which', ['swiftc'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function baseContext(overrides: {
  capabilityProbe?: boolean;
  operation?: NativeVirtualDisplayDriverInputControlContext['operation'];
  controlKind?: string;
  action?: Record<string, unknown>;
} = {}): NativeVirtualDisplayDriverInputControlContext {
  const operation = overrides.operation ?? 'sendInputIntent';
  const kind = overrides.controlKind ?? 'click';
  const action = overrides.action ?? {
    type: 'click',
    x: 100,
    y: 50,
  };
  return {
    providerId: 'virtual-display.macos.cgvirtualdisplay-screencapturekit',
    operation,
    operationOptions: {
      runId: 'macos-ax-hook-test',
      targetAppKind: 'generic-editor',
      inputIntent: {
        source: operation === 'sendInputIntent' ? 'virtual-app-screen-canvas' : 'virtual-app-screen-control',
        kind,
        controlKind: operation === 'sendInputIntent' ? undefined : kind,
        action: operation === 'sendInputIntent' ? action : undefined,
        refs: {
          sessionRef: `${providerRootRef}/session.json`,
          frameRef: 'computer-use:native-host/frames/session-1/0001.png',
        },
      },
    },
    capabilityProbe: overrides.capabilityProbe,
    inputIntent: {
      source: operation === 'sendInputIntent' ? 'virtual-app-screen-canvas' : 'virtual-app-screen-control',
      kind,
      controlKind: operation === 'sendInputIntent' ? undefined : kind,
      actionType: operation === 'sendInputIntent' ? action.type : undefined,
      frameRef: 'computer-use:native-host/frames/session-1/0001.png',
      sessionRef: `${providerRootRef}/session.json`,
    },
    refs: {
      currentRunRef: `${providerRootRef}/current-run.json`,
      providerRootRef,
      sessionRef: `${providerRootRef}/session.json`,
      inputLeaseRef: `${providerRootRef}/leases/input.json`,
      actionAdapterRef: `${providerRootRef}/adapters/action.json`,
      adapterReadinessRef: `${providerRootRef}/readiness/action.json`,
      evidenceLedgerRef: `${providerRootRef}/evidence-ledger.json`,
    },
    evidenceRoot: {
      outDir: '/tmp/sciforge-macos-ax-hook-test',
      runDirRef,
      providerRootRef,
    },
    platformState: {
      display: {
        id: 777,
        index: 3,
        x: 1600,
        y: 0,
        width: 1440,
        height: 900,
      },
      targetWindow: {
        cgWindow: {
          pid: 4242,
          windowNumber: 19,
          ownerName: 'Research Editor',
          title: 'Untitled',
          layer: 0,
          x: 1632,
          y: 32,
          width: 1000,
          height: 700,
        },
        axWindow: {
          pid: 4242,
          windowIndex: 1,
          title: 'Untitled',
          x: 1632,
          y: 32,
          width: 1000,
          height: 700,
        },
      },
      frameSequence: 1,
    },
  };
}
