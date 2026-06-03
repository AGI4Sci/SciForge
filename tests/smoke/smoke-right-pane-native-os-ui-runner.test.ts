import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
  missingBrowserHostActionChannel,
  validateRightPaneNativeOsUiRunManifest,
  type RightPaneNativeOsUiRunManifest,
} from '../../src/desktop/right-pane-native-os-ui-run-contract.js';
import {
  RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV,
  RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV,
  runRightPaneNativeOsUiRunner,
} from '../../tools/right-pane-native-os-ui-runner.js';
import {
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE,
  SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE,
} from '../../tools/right-pane-native-os-ui-macos-observer.js';

const SCIFORGE_WORKSPACE_WRITER_BASE_URL = 'SCIFORGE_WORKSPACE_WRITER_BASE_URL' as const;
const SCIFORGE_WORKSPACE_WRITER_URL = 'SCIFORGE_WORKSPACE_WRITER_URL' as const;
const SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON =
  'SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON' as const;

test('right-pane native OS UI runner writes refs-first missing-os-observer manifest without observer env or command', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {},
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as RightPaneNativeOsUiRunManifest;

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'missing-os-observer');
  assert.equal(manifest.browserHostSessionRef, 'browser-host-session:m1-native-live');
  assert.equal(manifest.liveSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.boundedEvidenceOnly, true);
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.browserHostActionChannel.status, 'missing');
  assert.equal(manifest.browserHostActionChannel.blocker, 'missing-browser-host-action-channel');
  assert.equal(manifest.capturePolicy.screenshotUsedAsProof, false);
  assert.equal(manifest.capturePolicy.frameStreamUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawDomUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawClipboardPayloadUsedAsProof, false);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('right-pane native OS UI runner derives bounded BrowserHostSession action channel from Workspace Writer base without raw endpoint', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_WORKSPACE_WRITER_BASE_URL]: 'http://127.0.0.1:3891',
    },
    now: '2026-06-02T00:00:00.000Z',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.browserHostActionChannel.status, 'available');
  assert.equal(manifest.browserHostActionChannel.browserHostSessionRef, 'browser-host-session:m1-native-live');
  assert.equal(manifest.browserHostActionChannel.liveSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.equal(manifest.browserHostActionChannel.owner, 'BrowserHostSession');
  assert.equal(manifest.browserHostActionChannel.inputChannel, 'browser-host-session');
  assert.equal(manifest.browserHostActionChannel.rawEndpointRecorded, false);
  assert.equal(manifest.browserHostActionChannel.loopbackOnly, true);
  assert.match(manifest.browserHostActionChannel.channelRef, /^browser-host-session:m1-native-live\/right-pane-native-os-ui-run\/action-channel\/hash-[a-f0-9]{12}$/);
  assert.doesNotMatch(JSON.stringify(manifest), /127\.0\.0\.1|localhost|3891|api\/sciforge\/browser-host\/sessions/);
});

test('right-pane native OS UI runner passes Workspace Writer derived action channel to trusted macOS helper without raw endpoint', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const actionBodies: string[] = [];
  const actionPaths: string[] = [];
  const server = createServer((req, res) => {
    actionPaths.push(req.url ?? '');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      actionBodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        sessionId: 'm1-native-live',
        owner: 'BrowserHostSession',
        liveSurfaceTransport: 'native-embedded',
        singleInteractiveTruth: true,
        secondTruthSource: false,
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;

  try {
    const manifest = await runRightPaneNativeOsUiRunner({
      inputManifestPath,
      outputPath,
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [SCIFORGE_WORKSPACE_WRITER_URL]: `http://127.0.0.1:${address.port}/health`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
          '--import',
          'tsx',
          'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
          '--run-id',
          'm1-native-live',
          '--probe-mode',
          'bounded-action-channel-rerender-focus-fixture',
        ]),
      },
      now: '2026-06-02T00:00:00.000Z',
    });

    assert.ok(actionBodies.length > 0, 'trusted helper should invoke BrowserHostSession action channel');
    assert.ok(actionPaths.every((path) => path === '/api/sciforge/browser-host/sessions/m1-native-live/actions'));
    assert.ok(actionBodies.every((body) => {
      const parsed = JSON.parse(body) as { action?: unknown };
      return parsed.action === 'cursor';
    }));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.browserHostActionChannel.status, 'available');
    assert.equal(manifest.proofGroups.rerenderFocus.status, 'blocked');
    assert.equal(manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'rerenderFocus'
      && entry.actionId === 'verify-rerender-focus'
    ))?.status, 'partial');

    const text = await readFile(outputPath, 'utf8');
    assert.doesNotMatch(text, new RegExp(String(address.port)));
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions\/m1-native-live\/actions/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('right-pane native OS UI runner forwards bounded cursorCaret action plan through Workspace Writer action channel', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const actionBodies: Array<Record<string, unknown>> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const cursor = body.x === 11 ? 'pointer' : body.x === 31 ? 'text' : 'default';
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          cursor,
          diagnostics: [`cursor:${cursor}`],
        },
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const expectedProofs = [
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiRunner({
      inputManifestPath,
      outputPath,
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [SCIFORGE_WORKSPACE_WRITER_BASE_URL]: `http://127.0.0.1:${address.port}`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'cursorCaret',
          mode: 'bounded-cursor-caret',
          actions: expectedProofs,
        }),
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
          '--import',
          'tsx',
          'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
          '--run-id',
          'm1-native-live',
        ]),
      },
      now: '2026-06-02T00:00:00.000Z',
    });

    assert.equal(actionBodies.length, 3);
    assert.ok(actionBodies.every((body) => body.action === 'cursor'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.browserHostActionChannel.status, 'available');
    assert.equal(manifest.proofGroups.cursorCaret.status, 'blocked');
    for (const proofName of expectedProofs) {
      assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/cursor-caret/${proofName}`,
      ));
    }
    const cursorCaretAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'cursorCaret'
      && entry.actionId === 'focus-input-caret'
    ));
    assert.ok(cursorCaretAction, 'cursorCaret action ledger entry should be preserved');
    assert.equal(cursorCaretAction.status, 'partial');
    assert.ok(expectedProofs.every((proofName) => cursorCaretAction.observedProofNames.includes(proofName)));
    assert.equal(cursorCaretAction.rawPayloadRecorded, false);

    const text = await readFile(outputPath, 'utf8');
    assert.doesNotMatch(text, new RegExp(String(address.port)));
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions\/m1-native-live\/actions|endpoint|coords|payload|"x"|"y"/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('right-pane native OS UI runner forwards bounded keyboard action plan through Workspace Writer action channel', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const actionBodies: Array<Record<string, unknown>> = [];
  const requestedProofs: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      actionBodies.push(body);
      const expectedProofNames = Array.isArray(body.expectedProofNames)
        ? body.expectedProofNames.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const requestedProofName = expectedProofNames[0] ?? String(body.action ?? '');
      requestedProofs.push(requestedProofName);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        session: {
          nativeOsUiProof: {
            schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
            boundedEvidenceOnly: true,
            rawDomRecorded: false,
            rawTextRecorded: false,
            rawUrlRecorded: false,
            rawTitleRecorded: false,
            rawSelectorRecorded: false,
            rawCoordsRecorded: false,
            rawPayloadRecorded: false,
            source: 'native-embedded-action-state',
            proofGroup: 'keyboardImeClipboardSelection',
            actionId: 'verify-ime-clipboard-selection',
            observedProofNames: [requestedProofName],
            evidenceTokens: [`proof:${requestedProofName}:observed`],
            diagnostics: [`proof:${requestedProofName}:observed`],
          },
        },
        nativeOsUiProof: {
          schemaVersion: 'sciforge.browser-host-session.native-os-ui-proof.v1',
          boundedEvidenceOnly: true,
          rawDomRecorded: false,
          rawTextRecorded: false,
          rawUrlRecorded: false,
          rawTitleRecorded: false,
          rawSelectorRecorded: false,
          rawCoordsRecorded: false,
          rawPayloadRecorded: false,
          source: 'native-embedded-action-state',
          proofGroup: 'keyboardImeClipboardSelection',
          actionId: 'verify-ime-clipboard-selection',
          observedProofNames: [requestedProofName],
          evidenceTokens: [`proof:${requestedProofName}:observed`],
          diagnostics: [`proof:${requestedProofName}:observed`],
          clipboardPayload: 'secret clipboard text',
          imePayload: 'secret composition',
          selectionText: 'raw selected text',
          url: 'https://example.invalid/private',
          dom: '<textarea>secret</textarea>',
        },
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const expectedProofs = [
    'keyboard-enter-owner',
    'system-clipboard-round-trip-owner',
    'selection-range-owner',
  ];

  try {
    const manifest = await runRightPaneNativeOsUiRunner({
      inputManifestPath,
      outputPath,
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [SCIFORGE_WORKSPACE_WRITER_BASE_URL]: `http://127.0.0.1:${address.port}`,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON]: JSON.stringify({
          schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
          runId: 'm1-native-live',
          proofGroup: 'keyboardImeClipboardSelection',
          mode: 'bounded-keyboard-ime-clipboard-selection',
          actions: expectedProofs,
        }),
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
          '--import',
          'tsx',
          'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
          '--run-id',
          'm1-native-live',
        ]),
      },
      now: '2026-06-02T00:00:00.000Z',
    });

    assert.equal(actionBodies.length, expectedProofs.length);
    assert.deepEqual(requestedProofs, expectedProofs);
    assert.deepEqual(actionBodies.map((body) => body.action), expectedProofs.map(() => 'native-os-ui-proof'));
    assert.deepEqual(actionBodies.map((body) => body.proofGroup), expectedProofs.map(() => 'keyboardImeClipboardSelection'));
    assert.deepEqual(actionBodies.map((body) => body.actionId), expectedProofs.map(() => 'verify-ime-clipboard-selection'));
    assert.ok(actionBodies.every((body) => body.capture === 'none'));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.browserHostActionChannel.status, 'available');
    assert.equal(manifest.proofGroups.keyboardImeClipboardSelection.status, 'blocked');
    assert.deepEqual(
      manifest.partialProofLedger?.keyboardImeClipboardSelection.observedProofNames.filter((name) => expectedProofs.includes(name)),
      expectedProofs,
    );
    const keyboardAction = manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'keyboardImeClipboardSelection'
      && entry.actionId === 'verify-ime-clipboard-selection'
    ));
    assert.ok(keyboardAction, 'keyboard action ledger entry should be preserved');
    assert.equal(keyboardAction.status, 'partial');
    assert.equal(keyboardAction.rawPayloadRecorded, false);
    assert.ok(expectedProofs.every((proofName) => keyboardAction.observedProofNames.includes(proofName)));

    const text = await readFile(outputPath, 'utf8');
    assert.doesNotMatch(text, new RegExp(String(address.port)));
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions\/m1-native-live\/actions|clipboardPayload|imePayload|selectionText|secret clipboard|secret composition|raw selected|endpoint|"url"|"dom"|"text"|payload|<textarea|https?:/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('right-pane native OS UI runner records bounded BrowserHostSession action channel handoff without raw endpoint', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: 'http://127.0.0.1:3891/api/sciforge/browser-host/sessions/m1-native-live/actions',
    },
    now: '2026-06-02T00:00:00.000Z',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.browserHostActionChannel.status, 'available');
  assert.equal(manifest.browserHostActionChannel.browserHostSessionRef, 'browser-host-session:m1-native-live');
  assert.equal(manifest.browserHostActionChannel.liveSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.equal(manifest.browserHostActionChannel.owner, 'BrowserHostSession');
  assert.equal(manifest.browserHostActionChannel.inputChannel, 'browser-host-session');
  assert.equal(manifest.browserHostActionChannel.rawEndpointRecorded, false);
  assert.equal(manifest.browserHostActionChannel.loopbackOnly, true);
  assert.match(manifest.browserHostActionChannel.channelRef, /^browser-host-session:m1-native-live\/right-pane-native-os-ui-run\/action-channel\/hash-[a-f0-9]{12}$/);
  assert.doesNotMatch(JSON.stringify(manifest), /127\.0\.0\.1|localhost|3891|api\/sciforge\/browser-host\/sessions/);
});

test('right-pane native OS UI runner treats direct action-channel endpoints with credentials query or hash as unavailable', async () => {
  const variants = invalidActionChannelEndpointVariants();

  for (const variant of variants) {
    const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
    const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
    const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
    await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

    const manifest = await runRightPaneNativeOsUiRunner({
      inputManifestPath,
      outputPath,
      env: {
        [RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV]: JSON.stringify({
          boundedEvidenceOnly: true,
          source: 'bounded-invalid-action-channel-fixture',
        }),
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: variant.endpoint,
      },
      now: '2026-06-02T00:00:00.000Z',
    });
    const text = await readFile(outputPath, 'utf8');

    assert.equal(manifest.status, 'blocked', variant.name);
    assert.equal(manifest.passClaim, false, variant.name);
    assert.equal(manifest.browserHostActionChannel.status, 'missing', variant.name);
    assert.equal(manifest.browserHostActionChannel.blocker, 'missing-browser-host-action-channel', variant.name);
    assertNoRawActionChannelEndpointLeak(text, variant.port);
  }
});

test('right-pane native OS UI trusted helper does not invoke action-channel endpoints with credentials query or hash', async (t) => {
  const actionBodies: string[] = [];
  const actionPaths: string[] = [];
  const server = createServer((req, res) => {
    actionPaths.push(req.url ?? '');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      actionBodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const variants = invalidActionChannelEndpointVariants(address.port);

  try {
    for (const variant of variants) {
      actionBodies.length = 0;
      actionPaths.length = 0;
      const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
      const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
      const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
      await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

      const manifest = await runRightPaneNativeOsUiRunner({
        inputManifestPath,
        outputPath,
        env: {
          [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
          [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
          [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_PLAN_JSON]: JSON.stringify({
            schemaVersion: 'sciforge.browser.right-pane-native-os-ui-action-plan.v1',
            runId: 'm1-native-live',
            proofGroup: 'cursorCaret',
            mode: 'bounded-cursor-caret',
            actions: ['pointer-button-link'],
          }),
          [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
          [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
            '--import',
            'tsx',
            'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
            '--run-id',
            'm1-native-live',
            '--probe-mode',
            'bounded-partial-caret-fixture',
          ]),
          [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: variant.endpoint,
        },
        now: '2026-06-02T00:00:00.000Z',
      });
      const text = await readFile(outputPath, 'utf8');

      assert.equal(actionBodies.length, 0, variant.name);
      assert.equal(actionPaths.length, 0, variant.name);
      assert.equal(manifest.status, 'blocked', variant.name);
      assert.equal(manifest.passClaim, false, variant.name);
      assert.equal(manifest.browserHostActionChannel.status, 'missing', variant.name);
      assert.ok(manifest.actionLedger?.entries.every((entry) => entry.rawPayloadRecorded === false), variant.name);
      assertNoRawActionChannelEndpointLeak(text, variant.port);
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('right-pane native OS UI runner lets trusted macOS helper invoke BrowserHostSession action channel without recording raw endpoint', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const actionBodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      actionBodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        sessionId: 'm1-native-live',
        owner: 'BrowserHostSession',
        liveSurfaceTransport: 'native-embedded',
        singleInteractiveTruth: true,
        secondTruthSource: false,
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const actionUrl = `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`;

  try {
    const manifest = await runRightPaneNativeOsUiRunner({
      inputManifestPath,
      outputPath,
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
          '--import',
          'tsx',
          'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
          '--run-id',
          'm1-native-live',
          '--probe-mode',
          'bounded-complete-cursor-caret-action-fixture',
        ]),
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: actionUrl,
      },
      now: '2026-06-02T00:00:00.000Z',
    });

    assert.ok(actionBodies.length > 0, 'trusted helper should invoke BrowserHostSession action channel');
    assert.ok(actionBodies.every((body) => {
      const parsed = JSON.parse(body) as { action?: unknown };
      return parsed.action === 'cursor';
    }));
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.browserHostActionChannel.status, 'available');
    assert.equal(manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'cursorCaret'
      && entry.actionId === 'focus-input-caret'
    ))?.status, 'passed');

    const text = await readFile(outputPath, 'utf8');
    assert.doesNotMatch(text, new RegExp(String(address.port)));
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions\/m1-native-live\/actions/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('right-pane native OS UI runner preserves trusted macOS helper action-channel rerender focus proof while blocked', async (t) => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const actionBodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => {
      actionBodies.push(Buffer.concat(chunks).toString('utf8'));
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        sessionId: 'm1-native-live',
        owner: 'BrowserHostSession',
        liveSurfaceTransport: 'native-embedded',
        singleInteractiveTruth: true,
        secondTruthSource: false,
      }));
    });
  });
  const listened = await tryListenOnLoopback(server);
  if (!listened) {
    t.skip('loopback listen is unavailable in this sandbox');
    return;
  }
  const address = server.address() as AddressInfo;
  const actionUrl = `http://127.0.0.1:${address.port}/api/sciforge/browser-host/sessions/m1-native-live/actions`;

  try {
    const manifest = await runRightPaneNativeOsUiRunner({
      inputManifestPath,
      outputPath,
      env: {
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
        [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
          '--import',
          'tsx',
          'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
          '--run-id',
          'm1-native-live',
          '--probe-mode',
          'bounded-action-channel-rerender-focus-fixture',
        ]),
        [RIGHT_PANE_NATIVE_OS_UI_BROWSER_HOST_ACTION_CHANNEL_URL_ENV]: actionUrl,
      },
      now: '2026-06-02T00:00:00.000Z',
    });

    const expectedRerenderProofs = [
      'native-surface-not-detached',
      'focus-retained-after-rerender',
    ];
    assert.ok(actionBodies.length > 0, 'trusted helper should invoke BrowserHostSession action channel');
    assert.equal(manifest.status, 'blocked');
    assert.equal(manifest.passClaim, false);
    assert.equal(manifest.proofGroups.rerenderFocus.status, 'blocked');
    assert.deepEqual(manifest.partialProofLedger?.rerenderFocus.observedProofNames, expectedRerenderProofs);
    assert.equal(manifest.actionLedger?.entries.find((entry) => (
      entry.proofGroup === 'rerenderFocus'
      && entry.actionId === 'verify-rerender-focus'
    ))?.status, 'partial');
    for (const proofName of expectedRerenderProofs) {
      assert.ok(manifest.proofGroups.rerenderFocus.proofRefs.includes(
        `real-product-os-ui-run:m1-native-live/rerender-focus/${proofName}`,
      ));
      assert.ok(manifest.proofGroups.rerenderFocus.auditRefs.includes(
        `real-product-os-ui-audit:m1-native-live/rerender-focus/${proofName}`,
      ));
    }

    const text = await readFile(outputPath, 'utf8');
    assert.doesNotMatch(text, new RegExp(String(address.port)));
    assert.doesNotMatch(text, /127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions\/m1-native-live\/actions/);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function tryListenOnLoopback(server: ReturnType<typeof createServer>): Promise<boolean> {
  return new Promise((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(0, '127.0.0.1', () => resolve(true));
  });
}

test('right-pane native OS UI runner preserves bounded built-in macOS diagnostic refs without claiming pass', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
    },
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as RightPaneNativeOsUiRunManifest;

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.browserHostSessionRef, 'browser-host-session:m1-native-live');
  assert.equal(manifest.liveSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assertBuiltInObserverDiagnosticProofGroups(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /missing-env|screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
  assert.ok(validation.blockReasons.includes('all-proof-groups-must-pass'));
});

test('right-pane native OS UI runner rejects forged observer evidence that uses screenshots and non-real refs', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const forged = validObserverEvidence({
    source: 'contract-fixture',
    osUiRun: {
      runRef: 'screenshot:fake-pass',
      auditRefs: ['frame-stream:fake-audit'],
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
    },
    proofGroups: {
      cursorCaret: {
        status: 'passed',
        proofRefs: ['screenshot:cursor-caret'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/cursor-caret'],
      },
      mouseContextMenu: {
        status: 'passed',
        proofRefs: ['frame-stream:context-menu'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/context-menu'],
      },
      keyboardImeClipboardSelection: {
        status: 'passed',
        proofRefs: ['raw-dom:selection'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/selection'],
      },
      rerenderFocus: {
        status: 'passed',
        proofRefs: ['raw-clipboard:focus'],
        auditRefs: ['real-product-os-ui-audit:m1-native-live/focus'],
      },
    },
    capturePolicy: {
      screenshotUsedAsProof: true,
      frameStreamUsedAsProof: true,
      rawDomUsedAsProof: true,
      rawClipboardPayloadUsedAsProof: true,
      rawSelectionTextRecorded: false,
      rawImePayloadRecorded: false,
      rawContextMenuPayloadRecorded: false,
    } as unknown as RightPaneNativeOsUiRunManifest['capturePolicy'],
  });

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV]: JSON.stringify(forged),
    },
    now: '2026-06-02T00:00:00.000Z',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.browserHostSessionRef, 'browser-host-session:m1-native-live');
  assert.equal(manifest.liveSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.notEqual(manifest.source, 'real-product-os-ui-run');

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-ref-required'));
  assert.ok(validation.blockReasons.includes('real-product-os-ui-audit-ref-required'));
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:/);
  assert.equal(manifest.capturePolicy.screenshotUsedAsProof, false);
  assert.equal(manifest.capturePolicy.frameStreamUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawDomUsedAsProof, false);
  assert.equal(manifest.capturePolicy.rawClipboardPayloadUsedAsProof, false);
});

test('right-pane native OS UI runner refuses env JSON macOS accessibility observations as pass-grade proof', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [RIGHT_PANE_NATIVE_OS_UI_OBSERVER_EVIDENCE_JSON_ENV]: JSON.stringify({
        source: 'macos-accessibility-observer',
        runId: 'm1-native-live',
        proofGroups: RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES,
      }),
    },
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as RightPaneNativeOsUiRunManifest;

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.notEqual(manifest.source, 'real-product-os-ui-run');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('right-pane native OS UI runner refuses command-backed accessibility JSON as pass-grade proof without real observer provenance', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '-e',
        `process.stdout.write(JSON.stringify({
          source: 'macos-accessibility-observer',
          runId: 'm1-native-live',
          proofGroups: ${JSON.stringify(RIGHT_PANE_NATIVE_OS_UI_REQUIRED_PROOF_NAMES)}
        }))`,
      ]),
    },
    now: '2026-06-02T00:00:00.000Z',
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.notEqual(manifest.source, 'real-product-os-ui-run');
  assert.equal(manifest.osObserver.status, 'missing');
  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('right-pane native OS UI runner keeps macOS metadata probe diagnostic blocked until real OS UI proof exists', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
        '-e',
        `process.stdout.write(JSON.stringify({
          source: 'macos-accessibility-metadata-probe',
          runId: 'm1-native-live',
          accessibilityTrusted: true,
          frontmostApplicationCount: 1,
          windowCount: 2,
          focusedElementPresent: true,
          caretCandidateCount: 1,
          contextMenuCandidateCount: 1,
          keyboardFocusCandidateCount: 1,
          rerenderFocusCandidateCount: 1
        }))`,
      ]),
    },
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as RightPaneNativeOsUiRunManifest;

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.browserHostSessionRef, 'browser-host-session:m1-native-live');
  assert.equal(manifest.liveSurfaceRef, 'browser-host-session:m1-native-live/live-surface');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assert.ok(manifest.proofGroups.cursorCaret.proofRefs.every((ref) => ref.startsWith('browser-host-session:m1-native-live/')));
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('right-pane native OS UI runner preserves trusted macOS helper proof-incomplete diagnostics', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv(),
    },
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as RightPaneNativeOsUiRunManifest;

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.blocker, 'native-os-ui-proof-incomplete');
  assert.equal(manifest.osObserver.status, 'missing');
  assert.equal(manifest.osUiRun, undefined);
  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
});

test('right-pane native OS UI runner preserves trusted macOS helper partial proof ledger without pass claim', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-os-ui-runner-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-manifest.json');
  const outputPath = join(tmp, 'right-pane-native-os-ui-manifest.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeLiveManifest(), null, 2));

  const manifest = await runRightPaneNativeOsUiRunner({
    inputManifestPath,
    outputPath,
    env: {
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ENABLE]: '1',
      [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_TRUSTED_HELPER_ENABLE]: '1',
      ...trustedHelperCommandEnv([
        '--run-id',
        'm1-native-live',
        '--probe-mode',
        'bounded-partial-proof-ledger-fixture',
      ]),
    },
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as RightPaneNativeOsUiRunManifest;

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'contract-fixture');
  assert.equal(manifest.osUiRun, undefined);
  assert.ok(manifest.proofGroups.cursorCaret.proofRefs.includes(
    'real-product-os-ui-run:m1-native-live/cursor-caret/focus-blur-restore',
  ));
  assert.ok(manifest.proofGroups.rerenderFocus.proofRefs.includes(
    'real-product-os-ui-run:m1-native-live/rerender-focus/focus-retained-after-rerender',
  ));
  assert.deepEqual(manifest.partialProofLedger?.cursorCaret.observedProofNames, [
    'input-caret-visible',
    'focus-blur-restore',
  ]);
  assert.deepEqual(manifest.partialProofLedger?.rerenderFocus.observedProofNames, [
    'native-surface-not-detached',
    'focus-retained-after-rerender',
  ]);
  assert.ok(manifest.actionLedger, 'runner should preserve bounded action ledger from trusted helper');
  assert.ok(manifest.actionLedger?.entries.some((entry) => (
    entry.proofGroup === 'rerenderFocus'
    && entry.actionId === 'verify-rerender-focus'
    && entry.status === 'partial'
    && entry.targetSurfaceRef === 'browser-host-session:m1-native-live/live-surface'
    && entry.expectedProofNames.includes('native-surface-not-detached')
    && entry.observedProofNames.includes('focus-retained-after-rerender')
  )));
  assert.ok(manifest.actionLedger?.entries.every((entry) => (
    entry.owner === 'BrowserHostSession'
    && entry.productSurface === 'right-pane-browser'
    && entry.inputChannel === 'browser-host-session'
    && entry.rawPayloadRecorded === false
  )));
  assertTrustedHelperProofIncompleteProofGroups(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /screenshot:|frame-stream:|raw-dom:|raw-clipboard:|clipboard-payload:|dom:|<html|data:image/);

  const validation = validateRightPaneNativeOsUiRunManifest(manifest);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('real-product-os-ui-run-source-required'));
  assert.ok(validation.blockReasons.includes('available-os-observer-required'));
  assert.ok(validation.blockReasons.includes('complete-m1-native-os-ui-proof-refs-required'));
});

function desktopNativeLiveManifest() {
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    source: 'desktop-native-browser-pane-smoke',
    observedAt: '2026-06-02T00:00:00.000Z',
    canClaimDesktopNativeLivePass: true,
    claimScope: 'desktop-native-embedded-browser-pane-live',
    m0SurfingLoop: {
      sessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    },
  };
}

function invalidActionChannelEndpointVariants(port = 3891): Array<{ name: string; endpoint: string; port: number }> {
  const path = '/api/sciforge/browser-host/sessions/m1-native-live/actions';
  return [
    {
      name: 'credentials',
      endpoint: `http://credential-user:credential-password@127.0.0.1:${port}${path}`,
      port,
    },
    {
      name: 'query',
      endpoint: `http://127.0.0.1:${port}${path}?token=sentinel-query-token`,
      port,
    },
    {
      name: 'hash',
      endpoint: `http://127.0.0.1:${port}${path}#sentinel-fragment-token`,
      port,
    },
  ];
}

function assertNoRawActionChannelEndpointLeak(text: string, port: number): void {
  assert.doesNotMatch(text, /https?:\/\/|127\.0\.0\.1|localhost|api\/sciforge\/browser-host\/sessions\/m1-native-live\/actions/);
  assert.doesNotMatch(text, /credential-user|credential-password|sentinel-query-token|sentinel-fragment-token/);
  assert.doesNotMatch(text, new RegExp(String(port)));
}

function validObserverEvidence(overrides: Partial<RightPaneNativeOsUiRunManifest>): RightPaneNativeOsUiRunManifest {
  const base: RightPaneNativeOsUiRunManifest = {
    schemaVersion: 'sciforge.browser.right-pane-native-os-ui-run.v1',
    status: 'passed',
    passClaim: true,
    runner: 'right-pane-native-os-ui-run',
    source: 'real-product-os-ui-run',
    productSurface: 'right-pane-browser',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:m1-native-live',
    liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
    observedAt: '2026-06-02T00:00:00.000Z',
    refsFirst: true,
    boundedEvidenceOnly: true,
    osObserver: {
      status: 'available',
      observerRef: 'real-product-os-ui-run:m1-native-live/platform-observer',
      observerKind: 'platform-os-ui-observer',
    },
    browserHostActionChannel: missingBrowserHostActionChannel(),
    osUiRun: {
      runRef: 'real-product-os-ui-run:m1-native-live/run',
      auditRefs: ['real-product-os-ui-audit:m1-native-live/audit'],
      browserHostSessionRef: 'browser-host-session:m1-native-live',
      liveSurfaceRef: 'browser-host-session:m1-native-live/live-surface',
      productSurface: 'right-pane-browser',
      owner: 'BrowserHostSession',
    },
    proofGroups: {
      cursorCaret: passedProofGroup('cursor-caret'),
      mouseContextMenu: passedProofGroup('mouse-context-menu'),
      keyboardImeClipboardSelection: passedProofGroup('keyboard-ime-clipboard-selection'),
      rerenderFocus: passedProofGroup('rerender-focus'),
    },
    capturePolicy: {
      screenshotUsedAsProof: false,
      frameStreamUsedAsProof: false,
      rawDomUsedAsProof: false,
      rawClipboardPayloadUsedAsProof: false,
      rawSelectionTextRecorded: false,
      rawImePayloadRecorded: false,
      rawContextMenuPayloadRecorded: false,
    },
    forbiddenSubstitutes: {
      screenshot: false,
      frameStream: false,
      rawDom: false,
      rawClipboardPayload: false,
      systemPopup: false,
      secondBrowserOwner: false,
    },
  };
  return { ...base, ...overrides };
}

function trustedHelperCommandEnv(extraArgs: string[] = []): Record<string, string> {
  return {
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_COMMAND]: process.execPath,
    [SCIFORGE_RIGHT_PANE_NATIVE_OS_UI_MACOS_OBSERVER_ARGS_JSON]: JSON.stringify([
      '--import',
      'tsx',
      'tools/right-pane-native-os-ui-macos-accessibility-helper.ts',
      ...extraArgs,
    ]),
  };
}

function passedProofGroup(area: string): RightPaneNativeOsUiRunManifest['proofGroups']['cursorCaret'] {
  return {
    status: 'passed',
    proofRefs: [`real-product-os-ui-run:m1-native-live/${area}`],
    auditRefs: [`real-product-os-ui-audit:m1-native-live/${area}`],
  };
}

function assertBuiltInObserverDiagnosticProofGroups(manifest: RightPaneNativeOsUiRunManifest): void {
  for (const group of Object.values(manifest.proofGroups)) {
    assert.equal(group.status, 'blocked');
    assert.ok(group.proofRefs.some((ref) => ref.includes('/macos-accessibility-observer/diagnostic-probe/')));
    assert.ok(group.auditRefs.some((ref) => ref.includes('/macos-accessibility-observer/diagnostic-probe/')));
  }
}

function assertTrustedHelperProofIncompleteProofGroups(manifest: RightPaneNativeOsUiRunManifest): void {
  for (const group of Object.values(manifest.proofGroups)) {
    assert.equal(group.status, 'blocked');
    assert.ok(group.proofRefs.some((ref) => ref.includes('/macos-accessibility-observer/trusted-helper-proof-incomplete')));
    assert.ok(group.auditRefs.some((ref) => ref.includes('/macos-accessibility-observer/trusted-helper-proof-incomplete/audit')));
  }
}
