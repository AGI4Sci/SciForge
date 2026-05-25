import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  runCuL3IndependentInputAcceptanceHarness,
} from '../../tools/cu-l3-independent-input-acceptance-harness.js';

const execFileAsync = promisify(execFile);

test('CU L3 independent-input harness projects a non-dry-run package-bridge trace into passable user acceptance', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-pass-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    await writeFile(join(workspace, 'host-ports.json'), JSON.stringify({ ports: { execute: { provider: 'sciforge-simulated-remote-desktop-input-adapter' } } }));
    await writeFile(join(workspace, 'tool-payload.json'), JSON.stringify({ displayIntent: { kind: 'gui.present' } }));
    await writeFile(join(workspace, 'request.json'), JSON.stringify({ task: 'Create a multi-app acceptance artifact from visible source facts.' }));
    await writeFile(tracePath, JSON.stringify(validTrace({
      runId: 'cu-l3-independent-fixture',
      runRef: workspace,
    }), null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-independent-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: '.sciforge/vision-runs/cu-l3-independent-fixture/acceptance-slide.pptx',
      guiPresentRecordRef: '.sciforge/vision-runs/cu-l3-independent-fixture/gui-present-record.json',
      guiPresentPayloadRef: '.sciforge/vision-runs/cu-l3-independent-fixture/tool-payload.json',
    });

    assert.equal(result.verifier.status, 'passed');
    assert.equal(result.manifest.status, 'multi-app-workflow-passed');
    assert.equal(result.manifest.level, 'L3');
    assert.deepEqual(result.manifest.appWorkflow.apps, ['Browser', 'Slide Editor', 'File Manager']);
    assert.deepEqual(result.manifest.appWorkflow.windowSwitchTraceRefs, [tracePath]);
    assert.ok(result.manifest.screenshotRefs.before.includes(`${workspace}/step-001-before.png`));
    assert.ok(result.manifest.screenshotRefs.before.includes(`${workspace}/step-003-before.png`));
    assert.ok(result.manifest.screenshotRefs.after.includes(`${workspace}/step-001-after.png`));
    assert.ok(result.manifest.screenshotRefs.after.includes(`${workspace}/step-003-after.png`));
    assert.deepEqual(result.manifest.focusCropRefs, [`${workspace}/step-001-before-focus.png`]);
    assert.deepEqual(result.manifest.groundingDiagnosticsRefs, [tracePath]);
    const independentClaim = result.manifest.evidenceClaims.find((claim) => claim.kind === 'independent-input-adapter');
    assert.ok(independentClaim);
    assert.ok(independentClaim.recordRefs?.includes(adapterPath));
    assert.ok(independentClaim.sessionRefs?.includes(adapterPath));
    assert.equal(result.manifest.executorLease.owner, 'sciforge-independent-input-adapter remote-desktop');
    assert.equal(result.manifest.verifierVerdict.ref, `${workspace}/cu-l3-independent-input-verifier.json`);
    assert.ok(result.manifest.guiPresent.displayedRefs?.includes('.sciforge/vision-runs/cu-l3-independent-fixture/acceptance-slide.pptx'));

    const writtenVerifier = JSON.parse(await readFile(result.paths.verifier, 'utf8'));
    assert.equal(writtenVerifier.schemaVersion, 'sciforge.computer-use.l3-independent-input-verifier.v1');
    assert.deepEqual(writtenVerifier.issueRefs, []);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input harness blocks shared system input traces even with an adapter file nearby', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-blocked-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const trace = validTrace({ runId: 'cu-l3-shared-input-fixture', runRef: workspace }) as Record<string, any>;
    trace.genericComputerUse.inputChannelContract = {
      type: 'generic-mouse-keyboard',
      pointerKeyboardOwnership: 'shared-system-pointer-keyboard',
      pointerMode: 'system-cursor-events',
      keyboardMode: 'system-key-events',
      userDeviceImpact: 'may-affect-frontmost-window',
    };
    trace.hostPorts.ports.execute = {
      provider: 'darwin-system-events-generic-gui-executor',
      inputAdapter: 'shared-system-input-acknowledged',
      sharedSystemInputExplicitlyAllowed: true,
    };
    await writeFile(tracePath, JSON.stringify(trace, null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-shared-input-fixture'), null, 2));

    const result = await runCuL3IndependentInputAcceptanceHarness({
      tracePath,
      adapterPath,
      finalArtifactRef: '.sciforge/vision-runs/cu-l3-shared-input-fixture/acceptance-slide.pptx',
      guiPresentRecordRef: '.sciforge/vision-runs/cu-l3-shared-input-fixture/gui-present-record.json',
      guiPresentPayloadRef: '.sciforge/vision-runs/cu-l3-shared-input-fixture/tool-payload.json',
    });

    assert.equal(result.verifier.status, 'blocked');
    assert.ok(result.verifier.issueRefs.includes('independent-input-contract'));
    assert.ok(result.verifier.issueRefs.includes('no-shared-system-input-markers'));
    assert.equal(result.manifest.status, 'blocked');
    assert.equal(result.manifest.verifierVerdict.status, 'blocked');
    assert.ok(result.manifest.blockedItems[0]?.reason.includes('verifier pass verdict'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('CU L3 independent-input CLI writes verifier, projected input, and user acceptance manifest', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-l3-independent-input-cli-'));
  try {
    const tracePath = join(workspace, 'vision-trace.json');
    const adapterPath = join(workspace, 'independent-input-adapter.json');
    const verifierPath = join(workspace, 'verifier.json');
    const inputPath = join(workspace, 'input.json');
    const manifestPath = join(workspace, 'manifest.json');
    await writeFile(tracePath, JSON.stringify(validTrace({
      runId: 'cu-l3-independent-cli',
      runRef: workspace,
    }), null, 2));
    await writeFile(adapterPath, JSON.stringify(validAdapter('cu-l3-independent-cli'), null, 2));

    const { stdout } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/cu-l3-independent-input-acceptance-harness.ts',
      '--trace',
      tracePath,
      '--adapter',
      adapterPath,
      '--verifier-out',
      verifierPath,
      '--input-out',
      inputPath,
      '--manifest-out',
      manifestPath,
      '--final-artifact-ref',
      '.sciforge/vision-runs/cu-l3-independent-cli/acceptance-slide.pptx',
      '--gui-present-record-ref',
      '.sciforge/vision-runs/cu-l3-independent-cli/gui-present-record.json',
      '--gui-present-payload-ref',
      '.sciforge/vision-runs/cu-l3-independent-cli/tool-payload.json',
    ]);

    assert.match(stdout, /\[passed\/multi-app-workflow-passed\]/);
    const verifier = JSON.parse(await readFile(verifierPath, 'utf8'));
    const input = JSON.parse(await readFile(inputPath, 'utf8'));
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(verifier.status, 'passed');
    assert.equal(input.level, 'L3');
    assert.equal(manifest.status, 'multi-app-workflow-passed');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function validTrace(options: { runId: string; runRef: string }) {
  return {
    schemaVersion: 'sciforge.vision-trace.v1',
    runId: options.runId,
    tool: 'action.sciforge.computer-use',
    runtime: 'sciforge.workspace-runtime.computer-use-package-bridge',
    actionProvider: 'action.sciforge.computer-use',
    createdAt: '2026-05-25T00:00:00.000Z',
    completedAt: '2026-05-25T00:01:00.000Z',
    request: {
      task: 'Create a generic multi-app acceptance artifact from visible source facts.',
    },
    config: {
      dryRun: false,
      inputAdapter: 'remote-desktop',
      independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
    },
    hostPorts: {
      ports: {
        execute: {
          provider: 'sciforge-simulated-remote-desktop-input-adapter',
          inputAdapter: 'remote-desktop',
          independentInputAdapterProvider: 'sciforge-simulated-remote-desktop',
        },
      },
    },
    genericComputerUse: {
      inputChannelContract: {
        type: 'generic-mouse-keyboard',
        currentIndependentAdapter: 'remote-desktop',
        independentAdapterStatus: 'ready',
        pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
        pointerMode: 'adapter-window-bound-pointer',
        keyboardMode: 'adapter-window-bound-keyboard',
        userDeviceImpact: 'none',
      },
    },
    finalVisibleScreenshotRef: `${options.runRef}/step-003-after.png`,
    guiPresent: {
      recordRef: '.sciforge/vision-runs/generic/gui-present-record.json',
      payloadRef: '.sciforge/vision-runs/generic/tool-payload.json',
    },
    steps: [
      {
        id: 'step-001-browser',
        kind: 'gui-execution',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${options.runRef}/step-001-before.png`,
            windowTarget: { appName: 'Browser' },
          },
          {
            type: 'screenshot',
            captureScope: 'focus-region',
            path: `${options.runRef}/step-001-before-focus.png`,
            windowTarget: { appName: 'Browser' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${options.runRef}/step-001-after.png`,
            windowTarget: { appName: 'Browser' },
          },
        ],
        plannedAction: { type: 'click', targetDescription: 'visible source summary' },
        grounding: { provider: 'kv-ground', localX: 100, localY: 80 },
      },
      {
        id: 'step-002-slide',
        kind: 'gui-execution',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${options.runRef}/step-002-before.png`,
            windowTarget: { appName: 'Slide Editor' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${options.runRef}/step-002-after.png`,
            windowTarget: { appName: 'Slide Editor' },
          },
        ],
        plannedAction: { type: 'type_text' },
      },
      {
        id: 'step-003-save',
        kind: 'gui-execution',
        status: 'done',
        beforeScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${options.runRef}/step-003-before.png`,
            windowTarget: { appName: 'File Manager' },
          },
        ],
        afterScreenshotRefs: [
          {
            type: 'screenshot',
            captureScope: 'window',
            path: `${options.runRef}/step-003-after.png`,
            windowTarget: { appName: 'File Manager' },
          },
        ],
        plannedAction: { type: 'click', targetDescription: 'save button' },
      },
    ],
  };
}

function validAdapter(runId: string) {
  return {
    schemaVersion: 'sciforge.computer-use.independent-input-adapter.v1',
    adapter: 'remote-desktop',
    provider: 'sciforge-simulated-remote-desktop',
    runId,
    userDeviceImpact: 'none',
    systemMouseEvents: 'not-sent',
    systemKeyboardEvents: 'not-sent',
    pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
    targetSession: {
      mode: 'window',
      appName: 'Remote Session',
      coordinateSpace: 'window-local',
    },
    virtualPointer: {
      mode: 'virtual-pointer',
      coordinateSpace: 'window-local',
      x: 100,
      y: 80,
    },
    virtualKeyboard: {
      mode: 'virtual-keyboard',
      pressedKeys: [],
      keyEvents: [],
      typedTextLedger: [{ text: 'Visible source facts' }],
    },
    actions: [
      {
        id: 'step-001-click',
        type: 'click',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
      {
        id: 'step-002-type',
        type: 'type_text',
        systemMouseEvents: 'not-sent',
        systemKeyboardEvents: 'not-sent',
      },
    ],
    createdAt: '2026-05-25T00:00:00.000Z',
    updatedAt: '2026-05-25T00:01:00.000Z',
  };
}
