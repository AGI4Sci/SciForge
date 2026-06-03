import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildVirtualAppScreenUserAcceptanceManifest,
  validateVirtualAppScreenUserAcceptanceManifest,
  VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION,
  type VirtualAppScreenUserAcceptanceInput,
} from '../../tools/virtual-app-screen-user-acceptance-manifest.js';

const execFileAsync = promisify(execFile);

test('VirtualAppScreen user acceptance contract fixture passes only with real-host-shaped provider evidence fields', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(validInput());

  assert.equal(manifest.schemaVersion, VIRTUAL_APP_SCREEN_USER_ACCEPTANCE_SCHEMA_VERSION);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.blockedReason, null);
  assert.equal(manifest.userAcceptanceEligible, true);
  assert.equal(manifest.diagnosticOnly, false);
  assert.equal(manifest.validation.ok, true);
  assert.equal(manifest.taskId, 'P0-CU-UA-FIRST-SCENARIO');
  assert.equal(manifest.scenarioId, 'virtual-app-screen-local-research-note');
  assert.deepEqual(manifest.targetAppRefs, ['app:profile/vscode-editor']);
  assert.deepEqual(manifest.targetWindowRefs, ['computer-use:native-host/windows/vas-local-research-note/main.json']);
  assert.deepEqual(manifest.sessionRefs, ['computer-use:native-host/sessions/vas-local-research-note/session.json']);
  assert.deepEqual(manifest.adapterReadinessRefs, ['computer-use:native-host/readiness/vas-local-research-note/native-provider.json']);
  assert.deepEqual(manifest.screenFrameRefs, [
    'computer-use:native-host/frames/vas-local-research-note/before.png',
    'computer-use:native-host/frames/vas-local-research-note/after.png',
  ]);
  assert.deepEqual(manifest.inputIntentRefs, ['computer-use:native-host/input-intents/vas-local-research-note/highlight-title.json']);
  assert.deepEqual(manifest.executorEventRefs, ['computer-use:native-host/executor-events/vas-local-research-note/highlight-title.json']);
  assert.deepEqual(manifest.beforeAfterFrameRefs, ['computer-use:native-host/before-after/vas-local-research-note/highlight-title.json']);
  assert.deepEqual(manifest.annotationProposalRefs, ['computer-use:session/vas-local-research-note/annotation-proposals/highlight-title.json']);
  assert.deepEqual(manifest.artifactRefs, ['file:research-note.md']);
  assert.deepEqual(manifest.verificationRefs, ['computer-use:native-host/verifiers/vas-local-research-note/research-note.json']);
  assert.deepEqual(manifest.guiPresentRefs, ['gui.present:virtual-app-screen/research-note']);
  assert.equal(manifest.replayRef, 'computer-use:native-host/replay/vas-local-research-note/replay.json');
  assert.equal(manifest.evidenceLedgerRef, 'computer-use:native-host/ledgers/vas-local-research-note/evidence-ledger.json');
});

test('VirtualAppScreen user acceptance blocks Host-shaped claims without real opt-in provider evidence', () => {
  const {
    realOptInRunRef: _realOptInRunRef,
    realPlatformEvidenceRefs: _realPlatformEvidenceRefs,
    ...hostShapedClaim
  } = realVirtualAppScreenClaim();
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    evidenceClaims: [{
      ...hostShapedClaim,
      id: 'host-shaped-without-real-opt-in-provider',
    }],
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.match(manifest.validation.issues.join('\n'), /real opt-in Host provider session evidence is required/);
});

test('VirtualAppScreen user acceptance P1.3 coverage rejects claims without the concrete evidence tuple', () => {
  type MutableRealVirtualAppScreenClaim = ReturnType<typeof realVirtualAppScreenClaim> & Record<string, unknown>;
  const cases = [
    {
      field: 'targetAppRef',
      mutate: (input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        input.targetAppRefs = [];
        Reflect.deleteProperty(claim, 'targetAppRef');
      },
    },
    {
      field: 'sessionRefs',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        Reflect.deleteProperty(claim, 'sessionRefs');
      },
    },
    {
      field: 'realHostProviderSessionRef',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        Reflect.deleteProperty(claim, 'realHostProviderSessionRef');
      },
    },
    {
      field: 'realOptInRunRef',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        Reflect.deleteProperty(claim, 'realOptInRunRef');
      },
    },
    {
      field: 'minimalEvidenceReplayRefs',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        Reflect.deleteProperty(claim, 'minimalEvidenceReplayRefs');
      },
    },
    {
      field: 'realAgentQueueEvidenceRefs',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        Reflect.deleteProperty(claim, 'realAgentQueueEvidenceRefs');
      },
    },
    {
      field: 'realPlatformEvidenceRefs',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        Reflect.deleteProperty(claim, 'realPlatformEvidenceRefs');
      },
    },
    {
      field: 'diagnosticOnly=false',
      mutate: (_input: VirtualAppScreenUserAcceptanceInput, claim: MutableRealVirtualAppScreenClaim): void => {
        claim.diagnosticOnly = true;
      },
    },
  ];

  assert.deepEqual(projectCuP13RealAppSessionCoverage(buildVirtualAppScreenUserAcceptanceManifest(validInput())), {
    ok: true,
    missing: [],
  });

  for (const { field, mutate } of cases) {
    const incompleteClaim: MutableRealVirtualAppScreenClaim = { ...realVirtualAppScreenClaim() };
    const input: VirtualAppScreenUserAcceptanceInput = {
      ...validInput(),
      evidenceClaims: [{
        ...incompleteClaim,
        id: `real-app-session-missing-${field}`,
      }],
    };
    mutate(input, incompleteClaim);

    const manifest = buildVirtualAppScreenUserAcceptanceManifest({
      ...input,
      evidenceClaims: [{
        ...incompleteClaim,
        id: `real-app-session-missing-${field}`,
      }],
    });
    const coverage = projectCuP13RealAppSessionCoverage(manifest);

    assert.equal(coverage.ok, false, `${field} must be required for PROJECT_CU.md P1.3 real app session coverage`);
    assert.deepEqual(coverage.missing, [field]);
  }
});

test('VirtualAppScreen user acceptance manifest blocks BrowserRuntime fixture evidence', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(browserRuntimeInput());

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.equal(manifest.diagnosticOnly, false);
  assert.match(manifest.validation.issues.join('\n'), /real VirtualAppScreen action-causality evidence is required/);
});

test('VirtualAppScreen manifest blocks missing refs instead of fabricating user acceptance', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    screenFrameRefs: [],
    beforeAfterFrameRefs: [],
    guiPresentRefs: [],
    replayRef: undefined,
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.deepEqual(manifest.validation.missingRefs, [
    'screenFrameRefs',
    'beforeAfterFrameRefs',
    'guiPresentRefs',
    'replayRef',
  ]);
  assert.match(String(manifest.blockedReason), /missing screenFrameRefs/);
});

test('VirtualAppScreen manifest uses needs-confirmation for high-risk pending approval', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    confirmationRequired: true,
    confirmationRef: 'approval:computer-use/annotate-save',
  });

  assert.equal(manifest.status, 'needs-confirmation');
  assert.match(String(manifest.blockedReason), /User confirmation is required/);
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.equal(manifest.confirmationRef, 'approval:computer-use/annotate-save');
  assert.equal(manifest.validation.ok, true);
});

test('VirtualAppScreen manifest requires handoff when isolation cannot be proven', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    isolationFlags: {
      ...validInput().isolationFlags,
      backgroundRenderable: false,
      requiresFocusSteal: true,
      sharedSystemInputUsed: true,
      affectsPhysicalDisplay: true,
      physicalDisplayPopup: true,
    },
  });

  assert.equal(manifest.status, 'requires-handoff');
  assert.match(String(manifest.blockedReason), /background rendering is unavailable/);
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.match(String(manifest.requiresHandoffReason), /background rendering is unavailable/);
  assert.match(String(manifest.requiresHandoffReason), /requires focus steal/);
  assert.match(String(manifest.requiresHandoffReason), /shared system input/);
  assert.match(String(manifest.requiresHandoffReason), /physical display/);
});

test('VirtualAppScreen manifest rejects package smoke, M6, DOM, fixture, and shell-only substitute pass evidence', () => {
  const manifest = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    evidenceClaims: [
      realVirtualAppScreenClaim(),
      { id: 'package-smoke', kind: 'package-smoke', userAcceptanceEligible: true },
      { id: 'm6', kind: 'm6-native-multi-screen', completionEvidence: true },
      { id: 'fixture', kind: 'target-bound-fixture', userAcceptanceEligible: true },
      { id: 'dom', kind: 'dom', completionEvidence: true },
      { id: 'playwright', kind: 'playwright', completionEvidence: true },
      { id: 'accessibility', kind: 'accessibility', completionEvidence: true },
      { id: 'shell', kind: 'shell-direct-artifact', userAcceptanceEligible: true },
    ],
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.userAcceptanceEligible, false);
  assert.deepEqual(manifest.validation.rejectedClaimKinds, [
    'package-smoke',
    'm6-native-multi-screen',
    'target-bound-fixture',
    'dom',
    'playwright',
    'accessibility',
    'shell-direct-artifact',
  ]);
  assert.match(manifest.validation.issues.join('\n'), /non-substitute evidence/);
});

test('VirtualAppScreen adapter readiness schema fail-closes unsafe capabilities', () => {
  const unsafe = buildVirtualAppScreenUserAcceptanceManifest({
    ...validInput(),
    adapterReadinessRecords: [{
      adapterKind: 'macos-global-input-diagnostic',
      targetScope: 'window',
      supportedActions: ['click'],
      captureSupported: true,
      backgroundRenderable: false,
      affectsPhysicalDisplay: true,
      requiresFocusSteal: true,
      sharedSystemInputUsed: true,
      blockedReason: 'Global system input would move the user desktop.',
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    }],
  });

  assert.equal(unsafe.status, 'requires-handoff');
  assert.equal(unsafe.validation.ok, false);
  assert.ok(unsafe.validation.issues.some((issue) => issue.includes('backgroundRenderable must be true')));
  assert.ok(unsafe.validation.issues.some((issue) => issue.includes('sharedSystemInputUsed must be false')));

  const validation = validateVirtualAppScreenUserAcceptanceManifest(unsafe);
  assert.equal(validation.ok, false);
});

test('VirtualAppScreen manifest contract fixture CLI writes refs-first status output', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-vas-acceptance-'));
  try {
    const inputPath = join(workspace, 'input.json');
    const outPath = join(workspace, 'manifest.json');
    await writeFile(inputPath, `${JSON.stringify(validInput(), null, 2)}\n`, 'utf8');

    const { stdout } = await execFileAsync('node', [
      '--import',
      'tsx',
      'tools/virtual-app-screen-user-acceptance-manifest.ts',
      '--input-json',
      inputPath,
      '--out',
      outPath,
    ]);
    const manifest = JSON.parse(await readFile(outPath, 'utf8')) as Record<string, unknown>;

    assert.match(stdout, /\[passed\] wrote sciforge\.computer-use\.virtual-app-screen-user-acceptance-manifest\.v1/);
    assert.equal(manifest.status, 'passed');
    assert.equal(manifest.blockedReason, null);
    assert.equal(manifest.userAcceptanceEligible, true);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function projectCuP13RealAppSessionCoverage(
  manifest: ReturnType<typeof buildVirtualAppScreenUserAcceptanceManifest>,
): { ok: boolean; missing: string[] } {
  const claim = manifest.evidenceClaims.find((entry) => entry.kind === 'real-virtual-app-screen');
  const extendedClaim = claim as (typeof claim & {
    targetAppRef?: string;
    realAgentQueueEvidenceRefs?: string[];
  });
  const targetAppRef = extendedClaim?.targetAppRef;
  const missing = [
    typeof targetAppRef === 'string' && isAppProfileRef(targetAppRef) && manifest.targetAppRefs.includes(targetAppRef)
      ? undefined
      : 'targetAppRef',
    hasNativeHostRef(claim?.sessionRefs) ? undefined : 'sessionRefs',
    isNativeHostRef(claim?.realHostProviderSessionRef) ? undefined : 'realHostProviderSessionRef',
    isNativeHostRef(claim?.realOptInRunRef) ? undefined : 'realOptInRunRef',
    hasMinimalReplayRefs(claim?.minimalEvidenceReplayRefs) ? undefined : 'minimalEvidenceReplayRefs',
    hasRealAgentQueueRefs(extendedClaim?.realAgentQueueEvidenceRefs) ? undefined : 'realAgentQueueEvidenceRefs',
    hasRealPlatformEvidenceRefs(claim?.realPlatformEvidenceRefs) ? undefined : 'realPlatformEvidenceRefs',
    manifest.diagnosticOnly === false && claim?.diagnosticOnly === false ? undefined : 'diagnosticOnly=false',
  ].filter((field): field is string => Boolean(field));

  return {
    ok: missing.length === 0,
    missing,
  };
}

function isAppProfileRef(ref: string | undefined): boolean {
  return typeof ref === 'string' && /^app:profile\/[a-z0-9._-]+$/iu.test(ref);
}

function isNativeHostRef(ref: string | undefined): boolean {
  return typeof ref === 'string' && ref.startsWith('computer-use:native-host/');
}

function hasNativeHostRef(refs: string[] | undefined): boolean {
  return refs?.some(isNativeHostRef) === true;
}

function hasMinimalReplayRefs(refs: string[] | undefined): boolean {
  const requiredEvents = ['session.created', 'surface.attached', 'human-input.accepted', 'agent.resumed'];
  return (refs?.length ?? 0) >= requiredEvents.length
    && refs?.every(isNativeHostRef) === true
    && requiredEvents.every((eventName) => refs?.some((ref) => ref.includes(eventName)) === true);
}

function hasRealAgentQueueRefs(refs: string[] | undefined): boolean {
  return (refs?.length ?? 0) >= 3
    && refs?.every(isNativeHostRef) === true
    && refs?.some((ref) => ref.includes('/pause/') && ref.endsWith('/agent-queue.json')) === true
    && refs?.some((ref) => ref.includes('/resume/') && ref.endsWith('/agent-queue.json')) === true
    && refs?.some((ref) => ref.includes('/resume/') && ref.endsWith('/current-frame-refresh.json')) === true;
}

function hasRealPlatformEvidenceRefs(refs: string[] | undefined): boolean {
  return (refs?.length ?? 0) >= 2
    && refs?.every(isNativeHostRef) === true
    && refs?.some((ref) => ref.endsWith('/diagnostic-only-false.json')) === true;
}

function validInput(): VirtualAppScreenUserAcceptanceInput {
  return {
    taskId: 'P0-CU-UA-FIRST-SCENARIO',
    scenarioId: 'virtual-app-screen-local-research-note',
    userIntent: 'Read local research notes in a background app screen, annotate a sentence, and produce research-note.md.',
    targetAppRefs: ['app:profile/vscode-editor'],
    targetWindowRefs: ['computer-use:native-host/windows/vas-local-research-note/main.json'],
    sessionRefs: ['computer-use:native-host/sessions/vas-local-research-note/session.json'],
    adapterReadinessRefs: ['computer-use:native-host/readiness/vas-local-research-note/native-provider.json'],
    adapterReadinessRecords: [{
      adapterKind: 'native-virtual-app-screen-host',
      targetScope: 'app',
      supportedActions: ['click', 'type', 'scroll', 'hotkey', 'annotate'],
      captureSupported: true,
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      blockedReason: null,
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    }],
    screenFrameRefs: [
      'computer-use:native-host/frames/vas-local-research-note/before.png',
      'computer-use:native-host/frames/vas-local-research-note/after.png',
    ],
    inputIntentRefs: ['computer-use:native-host/input-intents/vas-local-research-note/highlight-title.json'],
    executorEventRefs: ['computer-use:native-host/executor-events/vas-local-research-note/highlight-title.json'],
    beforeAfterFrameRefs: ['computer-use:native-host/before-after/vas-local-research-note/highlight-title.json'],
    annotationProposalRefs: ['computer-use:session/vas-local-research-note/annotation-proposals/highlight-title.json'],
    artifactRefs: ['file:research-note.md'],
    verificationRefs: ['computer-use:native-host/verifiers/vas-local-research-note/research-note.json'],
    guiPresentRefs: ['gui.present:virtual-app-screen/research-note'],
    replayRef: 'computer-use:native-host/replay/vas-local-research-note/replay.json',
    evidenceLedgerRef: 'computer-use:native-host/ledgers/vas-local-research-note/evidence-ledger.json',
    isolationFlags: {
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      physicalDisplayPopup: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      diagnosticOnly: false,
    },
    evidenceClaims: [
      realVirtualAppScreenClaim(),
      {
        id: 'gui-present',
        kind: 'gui-present',
        status: 'present',
        ref: 'gui.present:virtual-app-screen/research-note',
      },
      {
        id: 'verifier',
        kind: 'validator-verifier',
        status: 'present',
        ref: 'computer-use:session/vas-local-research-note/verifier/research-note.json',
      },
    ],
    createdAt: '2026-06-01T00:00:00.000Z',
  };
}

function realVirtualAppScreenClaim() {
  return {
    id: 'real-virtual-app-screen',
    kind: 'real-virtual-app-screen' as const,
    status: 'present' as const,
    targetAppRef: 'app:profile/vscode-editor',
    ref: 'computer-use:native-host/ledgers/vas-local-research-note/evidence-ledger.json',
    refs: ['computer-use:native-host/replay/vas-local-research-note/replay.json'],
    evidenceRefs: ['computer-use:native-host/before-after/vas-local-research-note/highlight-title.json'],
    sessionRefs: ['computer-use:native-host/sessions/vas-local-research-note/session.json'],
    realHostProviderSessionRef: 'computer-use:native-host/provider-sessions/vas-local-research-note/session.json',
    realOptInRunRef: 'computer-use:native-host/real-opt-in-runs/vas-local-research-note/run.json',
    currentRunPointerRef: 'computer-use:native-host/runs/vas-local-research-note/current-run-pointer.json',
    realPlatformEvidenceRefs: [
      'computer-use:native-host/provider-sessions/vas-local-research-note/diagnostic-only-false.json',
      'computer-use:native-host/provider-sessions/vas-local-research-note/platform-evidence.json',
    ],
    minimalEvidenceReplayRefs: [
      'computer-use:native-host/ledgers/vas-local-research-note/events/0001-session.created.json',
      'computer-use:native-host/ledgers/vas-local-research-note/events/0003-surface.attached.json',
      'computer-use:native-host/ledgers/vas-local-research-note/events/0006-human-input.accepted.json',
      'computer-use:native-host/ledgers/vas-local-research-note/events/0008-agent.resumed.json',
    ],
    realAgentQueueEvidenceRefs: [
      'computer-use:native-host/provider-adapter-control/vas-local-research-note/pause/agent-queue.json',
      'computer-use:native-host/provider-adapter-control/vas-local-research-note/resume/agent-queue.json',
      'computer-use:native-host/provider-adapter-control/vas-local-research-note/resume/current-frame-refresh.json',
    ],
    diagnosticOnly: false,
  };
}

function browserRuntimeInput(): VirtualAppScreenUserAcceptanceInput {
  return {
    ...validInput(),
    targetAppRefs: ['app:browser-research-profile'],
    targetWindowRefs: ['window:browser-research-profile/main'],
    sessionRefs: ['computer-use-session:vas-local-research-note'],
    adapterReadinessRefs: ['computer-use:adapter-readiness/browser-background.json'],
    adapterReadinessRecords: [{
      adapterKind: 'browser-runtime-window',
      targetScope: 'window',
      supportedActions: ['click', 'type', 'scroll', 'hotkey', 'annotate'],
      captureSupported: true,
      backgroundRenderable: true,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      blockedReason: null,
      schemaRefs: ['schema:computer-use/action-adapter-readiness.v1'],
    }],
    evidenceClaims: [{
      id: 'browser-runtime-fixture',
      kind: 'real-virtual-app-screen',
      status: 'present',
      ref: 'computer-use:session/vas-local-research-note/evidence-ledger.json',
      refs: ['computer-use:session/vas-local-research-note/replay.json'],
      evidenceRefs: ['computer-use:session/vas-local-research-note/before-after/highlight-title.json'],
      sessionRefs: ['computer-use-session:vas-local-research-note'],
    }],
  };
}
