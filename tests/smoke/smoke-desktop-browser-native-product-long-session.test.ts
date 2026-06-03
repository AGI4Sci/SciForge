import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA,
  runDesktopBrowserNativeProductLongSessionRunner,
  validateDesktopBrowserNativeProductLongSessionManifest,
  type DesktopBrowserNativeProductLongSessionManifest,
  type RealDesktopBrowserNativeProductLongSessionRunEvidence,
} from '../../tools/desktop-browser-native-product-long-session-runner.js';

const execFileAsync = promisify(execFile);

test('desktop-native product long-session runner writes a typed blocked skeleton without a real long run', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-native-long-session-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-acceptance.json');
  const outputPath = join(tmp, 'desktop-native-product-long-session.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeM0PassManifest(), null, 2));

  const manifest = await runDesktopBrowserNativeProductLongSessionRunner({
    inputManifestPath,
    outputPath,
    executeRealLongRun: false,
    now: '2026-06-02T00:00:00.000Z',
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as DesktopBrowserNativeProductLongSessionManifest;
  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.deepEqual(written, manifest);
  assert.equal(manifest.schemaVersion, DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.claimScope, 'blocked-or-diagnostic');
  assert.equal(manifest.target.durationTargetMs, 300_000);
  assert.equal(manifest.target.passRequiresElapsedDuration, true);
  assert.equal(manifest.sourceDesktopNativeLiveAcceptance.canClaimM0Pass, true);
  assert.equal(manifest.realLongSessionRun.status, 'not-run');
  assert.equal(manifest.realLongSessionRun.elapsedDurationMs, 0);
  assert.deepEqual(manifest.requirements.actionsRequired, [
    'continuous-surfing',
    'multi-tab',
    'reload',
    'back',
    'forward',
    'right-pane-resize',
    'writer-restart',
  ]);
  assert.deepEqual(manifest.requirements.actionsObserved, []);
  assert.equal(manifest.payloadPolicy.rawUrl, false);
  assert.equal(manifest.payloadPolicy.rawDom, false);
  assert.equal(manifest.payloadPolicy.rawScreenshot, false);
  assert.equal(manifest.payloadPolicy.base64, false);
  assert.equal(manifest.payloadPolicy.providerPayload, false);
  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('desktop-native-long-session-real-run-required'));
  assert.ok(validation.blockReasons.includes('duration-target-not-met'));
  assert.ok(validation.blockReasons.includes('m0-pass-does-not-satisfy-long-session'));
});

test('desktop-native product long-session runner accepts trusted in-process executor evidence and writes a pass manifest', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-native-long-session-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-acceptance.json');
  const outputPath = join(tmp, 'desktop-native-product-long-session.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeM0PassManifest(), null, 2));

  const manifest = await runDesktopBrowserNativeProductLongSessionRunner({
    inputManifestPath,
    outputPath,
    executeRealLongRun: true,
    now: '2026-06-02T00:00:00.000Z',
    realLongRunExecutor: async () => trustedExecutorLongRunEvidence(),
  });
  const written = JSON.parse(await readFile(outputPath, 'utf8')) as DesktopBrowserNativeProductLongSessionManifest;
  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.deepEqual(written, manifest);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.passClaim, true);
  assert.equal(manifest.claimScope, 'desktop-native-product-long-session');
  assert.equal(manifest.source, 'real-product-long-session-run');
  assert.equal(manifest.realLongSessionRun.status, 'executed');
  assert.equal(manifest.realLongSessionRun.elapsedDurationMs, 300_000);
  assert.deepEqual(manifest.realLongSessionRun.auditRefs, observedSessionContinuityAuditRefs());
  assert.deepEqual(manifest.requirements.actionsObserved, [
    'continuous-surfing',
    'multi-tab',
    'reload',
    'back',
    'forward',
    'right-pane-resize',
    'writer-restart',
  ]);
  assert.equal(Object.values(manifest.sessionContinuityProofs).every((proof) => (
    proof.status === 'observed'
    && proof.bounded === true
    && proof.sessionRef === manifest.browserHostSessionRef
    && proof.liveSurfaceRef === manifest.liveSurfaceRef
    && proof.auditRef.startsWith('real-product-long-session-audit:')
  )), true);
  assert.equal(Object.values(manifest.continuity).every((value) => value === true), true);
  assert.deepEqual(manifest.blockers, []);
  assert.equal(validation.canClaimPass, true);
});

test('desktop-native product long-session runner does not use executor evidence unless real execution is explicitly enabled', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-native-long-session-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-acceptance.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeM0PassManifest(), null, 2));
  let executorCalled = false;

  const manifest = await runDesktopBrowserNativeProductLongSessionRunner({
    inputManifestPath,
    executeRealLongRun: false,
    now: '2026-06-02T00:00:00.000Z',
    realLongRunExecutor: async () => {
      executorCalled = true;
      return trustedExecutorLongRunEvidence();
    },
  });

  assert.equal(executorCalled, false);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.claimScope, 'blocked-or-diagnostic');
  assert.equal(manifest.source, 'blocked-skeleton-no-real-long-run');
  assert.equal(manifest.realLongSessionRun.status, 'not-run');
  assert.ok(manifest.blockers.includes('desktop-native-long-session-real-run-required'));
  assert.ok(validateDesktopBrowserNativeProductLongSessionManifest(manifest).blockReasons.includes('desktop-native-long-session-real-run-required'));
});

test('desktop-native product long-session validator rejects an M0-only forged 5 minute pass', () => {
  const manifest = blockedLongSessionManifest();
  const forged: DesktopBrowserNativeProductLongSessionManifest = {
    ...manifest,
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    realLongSessionRun: {
      ...manifest.realLongSessionRun,
      status: 'not-run',
      elapsedDurationMs: 300_000,
    },
  };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(forged);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('desktop-native-long-session-real-run-required'));
  assert.ok(validation.blockReasons.includes('all-required-actions-must-be-observed'));
  assert.ok(validation.blockReasons.includes('m0-pass-does-not-satisfy-long-session'));
});

test('desktop-native product long-session validator rejects pass claims below the hard 5 minute elapsed floor', () => {
  const manifest = blockedLongSessionManifest();
  const forged: DesktopBrowserNativeProductLongSessionManifest = {
    ...manifest,
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    source: 'real-product-long-session-run',
    target: {
      ...manifest.target,
      durationTargetMs: 120_000,
    },
    realLongSessionRun: {
      status: 'executed',
      elapsedDurationMs: 120_000,
      runRef: 'real-product-long-session:bounded-short-run-ref',
      auditRefs: ['real-product-long-session-audit:bounded-short-run-audit-ref'],
    },
    requirements: {
      ...manifest.requirements,
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    },
    sessionContinuityProofs: observedSessionContinuityProofs(),
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    blockers: [],
  };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(forged);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('duration-target-not-met'));
});

test('desktop-native product long-session validator rejects raw URL, DOM, screenshot, base64, and provider payload evidence', () => {
  const manifest = blockedLongSessionManifest();
  const forged = manifest as unknown as Record<string, unknown>;
  forged.rawUrl = 'https://example.invalid/raw';
  forged.rawDom = '<html>raw</html>';
  forged.rawScreenshot = 'screenshot-bytes';
  forged.inlineImage = 'data:image/png;base64,abc123';
  forged.providerPayload = { token: 'secret-ish-provider-payload' };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('raw-url-dom-screenshot-base64-provider-payload-forbidden'));
});

test('desktop-native product long-session runner keeps caller-supplied real-run JSON blocked without live-runner provenance', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-native-long-session-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-acceptance.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeM0PassManifest(), null, 2));

  const manifest = await runDesktopBrowserNativeProductLongSessionRunner({
    inputManifestPath,
    executeRealLongRun: true,
    now: '2026-06-02T00:00:00.000Z',
    realRunEvidence: {
      status: 'executed',
      elapsedDurationMs: 300_000,
      runRef: 'real-product-long-session:bounded-run-ref',
      auditRefs: ['real-product-long-session-audit:bounded-audit-ref'],
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
      continuity: {
        sameBrowserHostSession: true,
        sameLiveSurfaceAfterReload: true,
        sameLiveSurfaceAfterResize: true,
        reconnectedAfterWorkspaceWriterRestart: true,
      },
      sessionContinuityProofs: observedSessionContinuityProofs(),
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.claimScope, 'blocked-or-diagnostic');
  assert.equal(manifest.source, 'blocked-skeleton-no-real-long-run');
  assert.equal(manifest.realLongSessionRun.status, 'not-run');
  assert.ok(manifest.blockers.includes('desktop-native-long-session-real-run-required'));
  assert.ok(manifest.blockers.includes('duration-target-not-met'));
  assert.ok(validateDesktopBrowserNativeProductLongSessionManifest(manifest).blockReasons.includes('desktop-native-long-session-real-run-required'));
});

test('desktop-native product long-session CLI refuses SCIFORGE real-run JSON as pass-grade proof', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-native-long-session-cli-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-acceptance.json');
  const outputPath = join(tmp, 'desktop-native-product-long-session.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeM0PassManifest(), null, 2));

  await execFileAsync(process.execPath, [
    '--import',
    'tsx',
    'tools/desktop-browser-native-product-long-session-runner.ts',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SCIFORGE_DESKTOP_BROWSER_NATIVE_LONG_SESSION_INPUT_MANIFEST: inputManifestPath,
      SCIFORGE_DESKTOP_BROWSER_NATIVE_LONG_SESSION_OUTPUT: outputPath,
      SCIFORGE_DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_EXECUTE_REAL_RUN: '1',
      SCIFORGE_DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_REAL_RUN_JSON: JSON.stringify({
        status: 'executed',
        elapsedDurationMs: 300_000,
        runRef: 'real-product-long-session:env-forged-run-ref',
        auditRefs: ['real-product-long-session-audit:env-forged-audit-ref'],
        actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
        continuity: {
          sameBrowserHostSession: true,
          sameLiveSurfaceAfterReload: true,
          sameLiveSurfaceAfterResize: true,
          reconnectedAfterWorkspaceWriterRestart: true,
        },
        sessionContinuityProofs: observedSessionContinuityProofs(),
      }),
    },
  });

  const manifest = JSON.parse(await readFile(outputPath, 'utf8')) as DesktopBrowserNativeProductLongSessionManifest;

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.equal(manifest.source, 'blocked-skeleton-no-real-long-run');
  assert.equal(manifest.realLongSessionRun.status, 'not-run');
  assert.ok(manifest.blockers.includes('desktop-native-long-session-real-run-required'));
});

test('desktop-native product long-session runner keeps blocked when supplied real-run evidence carries raw payloads', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'sciforge-desktop-native-long-session-'));
  const inputManifestPath = join(tmp, 'desktop-native-live-acceptance.json');
  await writeFile(inputManifestPath, JSON.stringify(desktopNativeM0PassManifest(), null, 2));

  const realRunEvidence = {
    status: 'executed',
    elapsedDurationMs: 300_000,
    runRef: 'real-product-long-session:bounded-run-ref',
    auditRefs: ['real-product-long-session-audit:bounded-audit-ref'],
    actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    sessionContinuityProofs: observedSessionContinuityProofs(),
    rawUrl: 'https://example.invalid/forged',
    rawDom: '<html>forged</html>',
    rawScreenshot: 'screenshot-bytes',
    screenshotBase64: 'data:image/png;base64,abc123',
    providerPayload: { token: 'secret-provider-payload' },
    secret: 'sk-secret',
  };

  const manifest = await runDesktopBrowserNativeProductLongSessionRunner({
    inputManifestPath,
    executeRealLongRun: true,
    now: '2026-06-02T00:00:00.000Z',
    realRunEvidence: realRunEvidence as never,
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.passClaim, false);
  assert.ok(manifest.blockers.includes('raw-url-dom-screenshot-base64-provider-payload-forbidden'));
});

test('desktop-native product long-session validator rejects a pass claim with stale blockers', () => {
  const manifest: DesktopBrowserNativeProductLongSessionManifest = {
    ...blockedLongSessionManifest(),
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    source: 'real-product-long-session-run',
    realLongSessionRun: {
      status: 'executed',
      elapsedDurationMs: 300_000,
      runRef: 'real-product-long-session:bounded-run-ref',
      auditRefs: ['real-product-long-session-audit:bounded-audit-ref'],
    },
    requirements: {
      ...blockedLongSessionManifest().requirements,
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    },
    sessionContinuityProofs: observedSessionContinuityProofs(),
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    blockers: ['desktop-native-long-session-real-run-required'],
  };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok(validation.blockReasons.includes('stale-blockers-must-not-claim-pass'));
});

test('desktop-native product long-session validator rejects generic action coverage without session-continuity proof groups', () => {
  const manifest = {
    ...blockedLongSessionManifest(),
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    source: 'real-product-long-session-run',
    realLongSessionRun: {
      status: 'executed',
      elapsedDurationMs: 300_000,
      runRef: 'real-product-long-session:bounded-run-ref',
      auditRefs: ['real-product-long-session-audit:bounded-audit-ref'],
    },
    requirements: {
      ...blockedLongSessionManifest().requirements,
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    },
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    blockers: [],
  } as DesktopBrowserNativeProductLongSessionManifest;

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok((validation.blockReasons as string[]).includes('session-continuity-proof-groups-required'));
});

test('desktop-native product long-session validator rejects continuity proof refs from another BrowserHostSession', () => {
  const manifest: DesktopBrowserNativeProductLongSessionManifest = {
    ...blockedLongSessionManifest(),
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    source: 'real-product-long-session-run',
    realLongSessionRun: {
      status: 'executed',
      elapsedDurationMs: 300_000,
      runRef: 'real-product-long-session:bounded-run-ref',
      auditRefs: ['real-product-long-session-audit:bounded-audit-ref'],
    },
    requirements: {
      ...blockedLongSessionManifest().requirements,
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    },
    sessionContinuityProofs: observedSessionContinuityProofsFor(
      'browser-host-session:other-native-long',
      'browser-host-session:other-native-long/live-surface',
    ),
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    blockers: [],
  };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok((validation.blockReasons as string[]).includes('session-continuity-proof-refs-must-match-session'));
});

test('desktop-native product long-session validator rejects run audit refs that do not cover proof groups', () => {
  const manifest: DesktopBrowserNativeProductLongSessionManifest = {
    ...blockedLongSessionManifest(),
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    source: 'real-product-long-session-run',
    realLongSessionRun: {
      status: 'executed',
      elapsedDurationMs: 300_000,
      runRef: 'real-product-long-session:bounded-run-ref',
      auditRefs: ['real-product-long-session-audit:aggregate-only'],
    },
    requirements: {
      ...blockedLongSessionManifest().requirements,
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    },
    sessionContinuityProofs: observedSessionContinuityProofs(),
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    blockers: [],
  };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok((validation.blockReasons as string[]).includes('long-session-audit-refs-must-cover-proof-groups'));
});

test('desktop-native product long-session validator rejects proof group audit refs that do not match required actions', () => {
  const mismatchedProofs = observedSessionContinuityProofs();
  mismatchedProofs.reload = {
    ...mismatchedProofs.reload,
    auditRef: 'real-product-long-session-audit:back-forward',
  };
  mismatchedProofs.backForward = {
    ...mismatchedProofs.backForward,
    auditRef: 'real-product-long-session-audit:reload',
  };
  const manifest: DesktopBrowserNativeProductLongSessionManifest = {
    ...blockedLongSessionManifest(),
    status: 'passed',
    passClaim: true,
    claimScope: 'desktop-native-product-long-session',
    source: 'real-product-long-session-run',
    realLongSessionRun: {
      status: 'executed',
      elapsedDurationMs: 300_000,
      runRef: 'real-product-long-session:bounded-run-ref',
      auditRefs: Object.values(mismatchedProofs).map((proof) => proof.auditRef),
    },
    requirements: {
      ...blockedLongSessionManifest().requirements,
      actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    },
    sessionContinuityProofs: mismatchedProofs,
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    blockers: [],
  };

  const validation = validateDesktopBrowserNativeProductLongSessionManifest(manifest);

  assert.equal(validation.canClaimPass, false);
  assert.ok((validation.blockReasons as string[]).includes('session-continuity-proof-group-audit-refs-must-match-required-actions'));
});

function blockedLongSessionManifest(): DesktopBrowserNativeProductLongSessionManifest {
  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_PRODUCT_LONG_SESSION_SCHEMA,
    status: 'blocked',
    passClaim: false,
    claimScope: 'blocked-or-diagnostic',
    runner: 'desktop-browser-native-product-long-session-runner',
    source: 'blocked-skeleton-no-real-long-run',
    observedAt: '2026-06-02T00:00:00.000Z',
    shell: 'desktop-right-pane',
    owner: 'BrowserHostSession',
    inputChannel: 'browser-host-session',
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:m2-native-long',
    liveSurfaceRef: 'browser-host-session:m2-native-long/live-surface',
    refsFirst: true,
    boundedEvidenceOnly: true,
    target: {
      durationTargetMs: 300_000,
      targetLabel: '5min',
      passRequiresElapsedDuration: true,
    },
    sourceDesktopNativeLiveAcceptance: {
      manifestRef: 'desktop-native-live-acceptance:fixture',
      status: 'passed',
      canClaimDesktopNativeLivePass: true,
      canClaimM0Pass: true,
      validationBlockReasonCount: 0,
    },
    requirements: {
      actionsRequired: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
      actionsObserved: [],
      continuousSurfingRequired: true,
      multiTabRequired: true,
      reloadRequired: true,
      backForwardRequired: true,
      rightPaneResizeRequired: true,
      writerRestartRequired: true,
    },
    sessionContinuityProofs: blockedSessionContinuityProofs(),
    realLongSessionRun: {
      status: 'not-run',
      elapsedDurationMs: 0,
      runRef: 'browser-host-session:m2-native-long/m2-long-session/not-run',
      auditRefs: [],
    },
    continuity: {
      sameBrowserHostSession: false,
      sameLiveSurfaceAfterReload: false,
      sameLiveSurfaceAfterResize: false,
      reconnectedAfterWorkspaceWriterRestart: false,
    },
    payloadPolicy: {
      rawUrl: false,
      rawDom: false,
      rawScreenshot: false,
      base64: false,
      providerPayload: false,
      secret: false,
    },
    forbiddenSubstitutes: {
      hostStream: false,
      canvas: false,
      webRtc: false,
      httpFrame: false,
      snapshot: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      externalBrowser: false,
      secondBrowserOwner: false,
    },
    blockers: ['desktop-native-long-session-real-run-required', 'duration-target-not-met', 'm0-pass-does-not-satisfy-long-session'],
  };
}

function observedSessionContinuityProofs(): DesktopBrowserNativeProductLongSessionManifest['sessionContinuityProofs'] {
  return observedSessionContinuityProofsFor(
    'browser-host-session:m2-native-long',
    'browser-host-session:m2-native-long/live-surface',
  );
}

function observedSessionContinuityProofsFor(
  sessionRef: string,
  liveSurfaceRef: string,
): DesktopBrowserNativeProductLongSessionManifest['sessionContinuityProofs'] {
  return {
    continuousSurfing: observedSessionContinuityProof('continuous-surfing', 18, sessionRef, liveSurfaceRef),
    multiTab: observedSessionContinuityProof('multi-tab', 21, sessionRef, liveSurfaceRef),
    reload: observedSessionContinuityProof('reload', 34, sessionRef, liveSurfaceRef),
    backForward: observedSessionContinuityProof('back-forward', 32, sessionRef, liveSurfaceRef),
    rightPaneResize: observedSessionContinuityProof('right-pane-resize', 16, sessionRef, liveSurfaceRef),
    workspaceWriterRestart: observedSessionContinuityProof('workspace-writer-restart', 420, sessionRef, liveSurfaceRef),
  };
}

function trustedExecutorLongRunEvidence(): RealDesktopBrowserNativeProductLongSessionRunEvidence {
  const sessionContinuityProofs = observedSessionContinuityProofs();
  return {
    status: 'executed' as const,
    elapsedDurationMs: 300_000,
    runRef: 'real-product-long-session:bounded-run-ref',
    auditRefs: Object.values(sessionContinuityProofs).map((proof) => proof.auditRef),
    actionsObserved: ['continuous-surfing', 'multi-tab', 'reload', 'back', 'forward', 'right-pane-resize', 'writer-restart'],
    continuity: {
      sameBrowserHostSession: true,
      sameLiveSurfaceAfterReload: true,
      sameLiveSurfaceAfterResize: true,
      reconnectedAfterWorkspaceWriterRestart: true,
    },
    sessionContinuityProofs,
  };
}

function observedSessionContinuityAuditRefs(): string[] {
  return Object.values(observedSessionContinuityProofs()).map((proof) => proof.auditRef);
}

function blockedSessionContinuityProofs(): DesktopBrowserNativeProductLongSessionManifest['sessionContinuityProofs'] {
  return {
    continuousSurfing: blockedSessionContinuityProof('continuous-surfing'),
    multiTab: blockedSessionContinuityProof('multi-tab'),
    reload: blockedSessionContinuityProof('reload'),
    backForward: blockedSessionContinuityProof('back-forward'),
    rightPaneResize: blockedSessionContinuityProof('right-pane-resize'),
    workspaceWriterRestart: blockedSessionContinuityProof('workspace-writer-restart'),
  };
}

function observedSessionContinuityProof(
  label: string,
  latencyMs: number,
  sessionRef = 'browser-host-session:m2-native-long',
  liveSurfaceRef = 'browser-host-session:m2-native-long/live-surface',
) {
  return {
    status: 'observed' as const,
    bounded: true as const,
    sessionRef,
    liveSurfaceRef,
    auditRef: `real-product-long-session-audit:${label}`,
    latencyMs,
  };
}

function blockedSessionContinuityProof(label: string) {
  return {
    status: 'blocked' as const,
    bounded: true as const,
    sessionRef: 'browser-host-session:m2-native-long',
    liveSurfaceRef: 'browser-host-session:m2-native-long/live-surface',
    auditRef: `real-product-long-session-audit:${label}-not-run`,
  };
}

function desktopNativeM0PassManifest() {
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: 'passed',
    source: 'desktop-native-browser-pane-smoke',
    observedAt: '2026-06-02T00:00:00.000Z',
    canClaimDesktopNativeLivePass: true,
    claimScope: 'desktop-native-embedded-browser-pane-live',
    m0SurfingLoop: {
      schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.m0-surfing-loop.v1',
      status: 'passed',
      claimScope: 'desktop-native-m0-surfing-loop',
      passClaim: true,
      shell: 'desktop-right-pane',
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      refsFirst: true,
      evidenceMode: 'bounded-refs-and-summaries',
      sessionRef: 'browser-host-session:m2-native-long',
      liveSurfaceRef: 'browser-host-session:m2-native-long/live-surface',
      nativeAdapterRef: 'native-adapter:loopback:0123456789abcdef',
      surfaceRef: 'desktop-native-surface:electron-web-contents-view:0123456789abcdef',
      transport: {
        liveSurfaceTransport: 'native-embedded',
        frameTransport: 'native-embedded',
        surfaceType: 'electron-web-contents-view',
      },
      health: {
        nativeAdapterHealthOk: true,
        nativeStateHeartbeat: true,
        actionAckSource: 'native-adapter-action-state',
      },
      urlEvidence: {
        requested: { length: 32, hash: '0123456789abcdef' },
        final: { length: 32, hash: 'fedcba9876543210' },
        rawUrlCaptured: false,
      },
      actionCoverage: Object.fromEntries(
        ['open', 'click', 'type', 'scroll', 'drag', 'reload', 'back', 'forward', 'stop'].map((action) => [
          action,
          {
            status: 'passed',
            latencyMs: 12,
            resultRef: `browser-host-session:m2-native-long/m0/${action}`,
            ...(action === 'type' ? { textLength: 16, textHash: '0011223344556677' } : {}),
          },
        ]),
      ),
      inputHotPath: {
        dependsOnScreenshot: false,
        dependsOnFrameStream: false,
        screenshotRequestsDuringAck: 0,
        frameStreamRequestsDuringAck: 0,
      },
      singleInteractiveTruth: true,
      secondTruthSource: false,
      noLegacyFallback: {
        hostStream: false,
        canvas: false,
        webRtc: false,
        httpFrame: false,
        snapshot: false,
        iframe: false,
        proxy: false,
        webview: false,
        systemPopup: false,
        externalBrowser: false,
      },
      payloadPolicy: {
        rawDom: false,
        rawLogs: false,
        rawScreenshot: false,
        base64: false,
        providerPayload: false,
        secret: false,
      },
      coverageGaps: [],
    },
  };
}
