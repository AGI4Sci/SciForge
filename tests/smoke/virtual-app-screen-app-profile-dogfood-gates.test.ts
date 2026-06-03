import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate,
  evaluateVirtualAppScreenAppProfileDogfoodGate,
  evaluateVirtualAppScreenAppProfilePreflight,
  resolveVirtualAppScreenAppProfile,
  VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
  VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
} from '../../src/runtime/computer-use/virtual-app-screen-app-profiles.js';
import {
  buildVirtualAppScreenAppProfilePreflightArtifact,
} from '../../tools/virtual-app-screen-app-profile-preflight.js';

const guardedProfiles = [
  'word',
  'powerpoint',
] as const;
const execFileAsync = promisify(execFile);

test('Word and PowerPoint dogfood profiles use the generic Host API', () => {
  assert.equal(
    VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF,
    'adapter-profile:virtual-app-screen/generic-host-api',
  );

  for (const profile of guardedProfiles) {
    const resolved = resolveVirtualAppScreenAppProfile({ profile });

    assert.equal(resolved.status, 'resolved', profile);
    if (resolved.status !== 'resolved') continue;
    assert.equal(resolved.adapterProfileRef, VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF);
    assert.equal(resolved.targetAppRef, `app:profile/${profile}`);
    assert.equal(resolved.registryMetadataOnly, true);
  }

  for (const shortcut of ['obsidian', 'slack', 'chrome-remote-desktop', 'doc', 'deck', 'slides']) {
    const resolved = resolveVirtualAppScreenAppProfile({ profile: shortcut });

    assert.equal(resolved.status, 'blocked', shortcut);
  }
});

test('app-profile dogfood gates fail closed until VS Code real closed-loop evidence exists', () => {
  assert.equal(
    VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    'SCIFORGE_VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST',
  );

  for (const profile of guardedProfiles) {
    const gate = evaluateVirtualAppScreenAppProfileDogfoodGate({ profile });

    assert.equal(gate.status, 'blocked', profile);
    assert.equal(gate.realDogfoodPassClaim, false);
    assert.equal(gate.requiredProfileId, 'vscode-editor');
    assert.equal(gate.requiredManifestEnv, VIRTUAL_APP_SCREEN_VSCODE_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV);
    assert.match(gate.blockedReason, /VS Code real closed-loop evidence/u);
  }
});

test('app-profile dogfood gates only clear sequencing with a passed VS Code real closed-loop manifest', () => {
  for (const profile of guardedProfiles) {
    const gate = evaluateVirtualAppScreenAppProfileDogfoodGate({
      profile,
      vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
      evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
    });

    assert.equal(gate.status, 'sequencing-ready', profile);
    assert.equal(gate.profileId, profile);
    assert.equal(gate.adapterProfileRef, VIRTUAL_APP_SCREEN_GENERIC_HOST_API_ADAPTER_PROFILE_REF);
    assert.equal(gate.requiredProfileId, 'vscode-editor');
    assert.equal(gate.sequencingOnly, true);
    assert.equal(gate.realDogfoodPassClaim, false);
  }
});

test('app-profile dogfood gates keep target current-run manifests as non-pass preflight evidence', () => {
  const sequencingGate = evaluateVirtualAppScreenAppProfileDogfoodGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    targetRealSessionEvidenceManifest: passedTargetCurrentRunManifest('powerpoint'),
  });

  assert.equal(sequencingGate.status, 'sequencing-ready');
  assert.equal(sequencingGate.profileId, 'word');
  assert.equal(sequencingGate.sequencingOnly, true);
  assert.equal(sequencingGate.realDogfoodPassClaim, false);
  assert.match(sequencingGate.blockedReason ?? '', /targetAppProfile=word/u);

  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      checkedBy: 'test-injected-availability',
    },
  });

  assert.equal(preflight.status, 'launch-spec-ready');
  assert.equal(preflight.realDogfoodPassClaim, false);

  const gate = evaluateVirtualAppScreenAppProfileDogfoodGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    targetRealSessionEvidenceManifest: passedTargetCurrentRunManifest('word'),
    targetEvidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
    appProfilePreflightManifest: preflight,
  });

  assert.equal(gate.status, 'sequencing-ready');
  assert.equal(gate.profileId, 'word');
  assert.equal(gate.targetAppRef, 'app:profile/word');
  assert.equal(gate.sequencingOnly, true);
  assert.equal(gate.realDogfoodPassClaim, false);
  assert.match(gate.blockedReason ?? '', /preflight is not real dogfood evidence/u);
  assert.equal(
    gate.targetEvidenceManifestRef,
    'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  );
});

test('app-profile dogfood gates reject non-VS Code real evidence manifests', () => {
  const manifest = {
    ...passedVsCodeClosedLoopManifest(),
    targetAppProfile: 'word',
    dogfoodRefs: {
      ...passedVsCodeClosedLoopManifest().dogfoodRefs,
      targetAppRef: 'app:profile/word',
    },
  };

  const gate = evaluateVirtualAppScreenAppProfileDogfoodGate({
    profile: 'powerpoint',
    vsCodeRealClosedLoopEvidenceManifest: manifest,
  });

  assert.equal(gate.status, 'blocked');
  assert.equal(gate.realDogfoodPassClaim, false);
  assert.match(gate.blockedReason, /targetAppProfile=vscode-editor/u);
});

test('app-profile target dogfood pass gate requires matching target current-run evidence', () => {
  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      checkedBy: 'test-injected-availability',
    },
  });

  const passed = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
    appProfilePreflightManifest: preflight,
    appProfilePreflightRef: 'computer-use:native-host/app-profile-preflight/word/manifest.json',
    targetRealSessionEvidenceManifest: passedTargetCurrentRunManifest('word'),
    targetEvidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  });

  assert.equal(passed.status, 'passed');
  assert.equal(passed.profileId, 'word');
  assert.equal(passed.targetAppRef, 'app:profile/word');
  assert.equal(passed.sequencingOnly, false);
  assert.equal(passed.realDogfoodPassClaim, true);
  assert.equal(
    passed.targetEvidenceManifestRef,
    'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  );

  const missingTarget = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    appProfilePreflightManifest: {
      ...preflight,
      appAvailability: {
        ...preflight.appAvailability,
        checkedBy: 'local-installed-app-probe/darwin',
      },
    },
  });

  assert.equal(missingTarget.status, 'blocked');
  assert.equal(missingTarget.realDogfoodPassClaim, false);
  assert.match(missingTarget.blockedReason, /current-run real session evidence manifest/u);

  const borrowedTarget = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    appProfilePreflightManifest: preflight,
    targetRealSessionEvidenceManifest: passedTargetCurrentRunManifest('powerpoint'),
  });

  assert.equal(borrowedTarget.status, 'blocked');
  assert.equal(borrowedTarget.realDogfoodPassClaim, false);
  assert.match(borrowedTarget.blockedReason, /targetAppProfile=word/u);
});

test('app-profile target dogfood pass gate requires refs-backed evidence before claiming pass', () => {
  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      checkedBy: 'test-injected-availability',
    },
  });

  const noRefs = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    appProfilePreflightManifest: preflight,
    targetRealSessionEvidenceManifest: passedTargetCurrentRunManifest('word'),
  });

  assert.equal(noRefs.status, 'blocked');
  assert.equal(noRefs.realDogfoodPassClaim, false);
  assert.match(noRefs.blockedReason, /evidence refs/u);
});

test('app-profile target dogfood pass gate rejects deferred Linux and Windows provider pass claims', () => {
  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      checkedBy: 'test-injected-availability',
    },
  });

  for (const platformProvider of ['linux', 'windows'] as const) {
    const gate = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
      profile: 'word',
      vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
      evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
      appProfilePreflightManifest: preflight,
      appProfilePreflightRef: 'computer-use:native-host/app-profile-preflight/word/manifest.json',
      targetRealSessionEvidenceManifest: {
        ...passedTargetCurrentRunManifest('word'),
        platformProvider,
      },
      targetEvidenceManifestRef: `computer-use:native-host/real-opt-in-runs/word-current-run-${platformProvider}/manifest.json`,
    });

    assert.equal(gate.status, 'blocked', platformProvider);
    assert.equal(gate.realDogfoodPassClaim, false);
    assert.match(gate.blockedReason, /platformProvider=macos/u);
  }
});

test('app-profile target dogfood pass gate rejects target manifests without current-run ledger consistency', () => {
  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      checkedBy: 'test-injected-availability',
    },
  });
  const missingLedger = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
    appProfilePreflightManifest: preflight,
    appProfilePreflightRef: 'computer-use:native-host/app-profile-preflight/word/manifest.json',
    targetRealSessionEvidenceManifest: {
      ...passedTargetCurrentRunManifest('word'),
      dogfoodRefs: {
        ...passedTargetCurrentRunManifest('word').dogfoodRefs,
        evidenceLedgerRef: undefined,
      },
    },
    targetEvidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  });

  assert.equal(missingLedger.status, 'blocked');
  assert.equal(missingLedger.realDogfoodPassClaim, false);
  assert.match(missingLedger.blockedReason, /dogfoodRefs.evidenceLedgerRef/u);

  const replayOutsideLedger = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
    appProfilePreflightManifest: preflight,
    appProfilePreflightRef: 'computer-use:native-host/app-profile-preflight/word/manifest.json',
    targetRealSessionEvidenceManifest: {
      ...passedTargetCurrentRunManifest('word'),
      dogfoodRefs: {
        ...passedTargetCurrentRunManifest('word').dogfoodRefs,
        minimalEvidenceReplayRefs: [
          'computer-use:native-host/ledgers/other-run/evidence-ledger.json/events/0001-session.created.json',
        ],
      },
    },
    targetEvidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  });

  assert.equal(replayOutsideLedger.status, 'blocked');
  assert.equal(replayOutsideLedger.realDogfoodPassClaim, false);
  assert.match(replayOutsideLedger.blockedReason, /minimalEvidenceReplayRefs.*evidenceLedgerRef/u);
});

test('app-profile target dogfood pass gate requires validation ok and rejects mock or snapshot refs', () => {
  const preflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      checkedBy: 'test-injected-availability',
    },
  });

  const missingValidation = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
    appProfilePreflightManifest: preflight,
    appProfilePreflightRef: 'computer-use:native-host/app-profile-preflight/word/manifest.json',
    targetRealSessionEvidenceManifest: {
      ...passedTargetCurrentRunManifest('word'),
      validation: undefined,
    },
    targetEvidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  });

  assert.equal(missingValidation.status, 'blocked');
  assert.equal(missingValidation.realDogfoodPassClaim, false);
  assert.match(missingValidation.blockedReason, /validation.ok=true/u);

  const mockRef = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'word',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    evidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/manifest.json',
    appProfilePreflightManifest: preflight,
    appProfilePreflightRef: 'computer-use:native-host/app-profile-preflight/word/manifest.json',
    targetRealSessionEvidenceManifest: {
      ...passedTargetCurrentRunManifest('word'),
      dogfoodRefs: {
        ...passedTargetCurrentRunManifest('word').dogfoodRefs,
        backgroundEvidenceRefs: [
          'computer-use:native-host/mocks/word-current-run/frame-stream.json',
        ],
      },
    },
    targetEvidenceManifestRef: 'computer-use:native-host/real-opt-in-runs/word-current-run/manifest.json',
  });

  assert.equal(mockRef.status, 'blocked');
  assert.equal(mockRef.realDogfoodPassClaim, false);
  assert.match(mockRef.blockedReason, /must not reference fixture, mock, snapshot, or replay evidence/u);
});

test('app-profile target dogfood pass gate rejects sequencing-only or unavailable preflight evidence', () => {
  const unavailablePreflight = evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'powerpoint',
    availability: {
      status: 'unavailable',
      reason: 'Microsoft PowerPoint is not installed on this dogfood machine',
    },
  });

  const gate = evaluateVirtualAppScreenAppProfileTargetDogfoodPassGate({
    profile: 'powerpoint',
    vsCodeRealClosedLoopEvidenceManifest: passedVsCodeClosedLoopManifest(),
    appProfilePreflightManifest: unavailablePreflight,
    targetRealSessionEvidenceManifest: passedTargetCurrentRunManifest('powerpoint'),
  });

  assert.equal(gate.status, 'blocked');
  assert.equal(gate.realDogfoodPassClaim, false);
  assert.match(gate.blockedReason, /launch-spec-ready/u);
});

test('app-profile target dogfood pass gate package scripts expose smoke and CLI entrypoints', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };

  assert.equal(
    packageJson.scripts?.['smoke:virtual-app-screen-app-profile-target-dogfood-gate'],
    'node --import tsx --test tests/smoke/virtual-app-screen-app-profile-dogfood-gates.test.ts',
  );
  assert.equal(
    packageJson.scripts?.['virtual-app-screen-app-profile-target-dogfood-gate'],
    'node --import tsx tools/check-virtual-app-screen-app-profile-target-dogfood-gate.ts',
  );
});

test('app-profile target dogfood pass gate CLI validates matching target manifests', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-target-dogfood-gate-'));
  const vscodeManifestPath = join(workspace, 'vscode.json');
  const targetManifestPath = join(workspace, 'word.json');
  const preflightPath = join(workspace, 'preflight.json');
  await writeFile(vscodeManifestPath, `${JSON.stringify(passedVsCodeClosedLoopManifest(), null, 2)}\n`, 'utf8');
  await writeFile(targetManifestPath, `${JSON.stringify(passedTargetCurrentRunManifest('word'), null, 2)}\n`, 'utf8');
  await writeFile(preflightPath, `${JSON.stringify(evaluateVirtualAppScreenAppProfilePreflight({
    profile: 'word',
    availability: {
      status: 'available',
      checkedBy: 'test-injected-availability',
      evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
    },
  }), null, 2)}\n`, 'utf8');

  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/check-virtual-app-screen-app-profile-target-dogfood-gate.ts',
    '--profile',
    'word',
    '--vscode-manifest',
    vscodeManifestPath,
    '--preflight-manifest',
    preflightPath,
    '--target-manifest',
    targetManifestPath,
  ]);

  assert.match(stdout, /^\[passed\] VirtualAppScreen app-profile target dogfood gate profile=word/u);
  assert.match(stdout, /realDogfoodPassClaim=true/u);
  assert.doesNotMatch(stdout, /sequencingOnly=true/u);
});

test('app-profile target dogfood pass gate CLI accepts batch preflight artifacts by selecting the requested profile', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'virtual-app-screen-target-dogfood-batch-gate-'));
  const vscodeManifestPath = join(workspace, 'vscode.json');
  const targetManifestPath = join(workspace, 'word.json');
  const preflightArtifactPath = join(workspace, 'preflight-artifact.json');
  await writeFile(vscodeManifestPath, `${JSON.stringify(passedVsCodeClosedLoopManifest(), null, 2)}\n`, 'utf8');
  await writeFile(targetManifestPath, `${JSON.stringify(passedTargetCurrentRunManifest('word'), null, 2)}\n`, 'utf8');
  await writeFile(preflightArtifactPath, `${JSON.stringify(buildVirtualAppScreenAppProfilePreflightArtifact({
    runId: 'batch-preflight-for-target-gate',
    generatedAt: '2026-06-03T00:00:00.000Z',
    checkedBy: 'test-batch-preflight',
    availabilityByProfile: {
      word: {
        status: 'available',
        evidenceRef: 'computer-use:native-host/app-availability/word/available.json',
      },
      powerpoint: {
        status: 'unavailable',
        reason: 'Microsoft PowerPoint is unavailable in this fixture',
      },
    },
  }), null, 2)}\n`, 'utf8');

  const { stdout } = await execFileAsync('node', [
    '--import',
    'tsx',
    'tools/check-virtual-app-screen-app-profile-target-dogfood-gate.ts',
    '--profile',
    'word',
    '--vscode-manifest',
    vscodeManifestPath,
    '--preflight-manifest',
    preflightArtifactPath,
    '--target-manifest',
    targetManifestPath,
  ]);

  assert.match(stdout, /^\[passed\] VirtualAppScreen app-profile target dogfood gate profile=word/u);
  assert.match(stdout, /preflightManifest=.*preflight-artifact\.json/u);
  assert.match(stdout, /realDogfoodPassClaim=true/u);
});

function passedTargetCurrentRunManifest(profile: typeof guardedProfiles[number]) {
  return {
    ...passedVsCodeClosedLoopManifest(),
    runId: `${profile}-current-run`,
    targetAppProfile: profile,
    dogfoodRefs: {
      ...passedVsCodeClosedLoopManifest().dogfoodRefs,
      targetAppRef: `app:profile/${profile}`,
      realHostProviderSessionRef: `computer-use:native-host/real-provider-sessions/${profile}-current-run/session.json`,
      realOptInRunRef: `computer-use:native-host/real-opt-in-runs/${profile}-current-run/run.json`,
      sessionRef: `computer-use:native-host/sessions/${profile}-current-run/session.json`,
      liveSurfaceRef: `computer-use:native-host/surfaces/${profile}-current-run/live-surface.json`,
      currentFrameRef: `computer-use:native-host/frames/${profile}-current-run/after-resume.json`,
      currentRunPointerRef: `computer-use:native-host/runs/${profile}-current-run/current-run-pointer.json`,
      evidenceLedgerRef: `computer-use:native-host/ledgers/${profile}-current-run/evidence-ledger.json`,
      realPlatformEvidenceRefs: [
        `computer-use:native-host/real-opt-in-runs/${profile}-current-run/diagnostic-only-false.json`,
        'computer-use:native-host/platform-drivers/macos/ready.json',
        `computer-use:native-host/ledgers/${profile}-current-run/evidence-ledger.json`,
      ],
      realAgentQueueEvidenceRefs: [
        `computer-use:native-host/provider-adapter-control/${profile}-current-run/pause/agent-queue.json`,
        `computer-use:native-host/provider-adapter-control/${profile}-current-run/resume/agent-queue.json`,
        `computer-use:native-host/provider-adapter-control/${profile}-current-run/resume/current-frame-refresh.json`,
      ],
      minimalEvidenceReplayRefs: [
        `computer-use:native-host/ledgers/${profile}-current-run/evidence-ledger.json/events/0001-session.created.json`,
        `computer-use:native-host/ledgers/${profile}-current-run/evidence-ledger.json/events/0006-human-input.accepted.json`,
        `computer-use:native-host/ledgers/${profile}-current-run/evidence-ledger.json/events/0008-agent.resumed.json`,
      ],
      inputAcceptedRefs: [
        `computer-use:native-host/inputs/${profile}-current-run/0001-type-text.json`,
      ],
      automationBarrierRefs: [
        `computer-use:native-host/provider-adapter-control/${profile}-current-run/pause/agent-queue.json`,
        `computer-use:native-host/provider-adapter-control/${profile}-current-run/resume/agent-queue.json`,
      ],
      backgroundEvidenceRefs: [
        `computer-use:native-host/surfaces/${profile}-current-run/frame-stream.json`,
      ],
    },
    userAcceptanceInput: {
      evidenceClaims: [{
        kind: 'real-virtual-app-screen',
        status: 'present',
        diagnosticOnly: false,
        realHostProviderSessionRef: `computer-use:native-host/real-provider-sessions/${profile}-current-run/session.json`,
        realOptInRunRef: `computer-use:native-host/real-opt-in-runs/${profile}-current-run/run.json`,
        realPlatformEvidenceRefs: [
          `computer-use:native-host/real-opt-in-runs/${profile}-current-run/diagnostic-only-false.json`,
        ],
      }],
    },
    validation: {
      ok: true,
      missing: [],
    },
  } as const;
}

function passedVsCodeClosedLoopManifest() {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1',
    status: 'passed',
    runId: 'vscode-real-closed-loop',
    platformProvider: 'macos',
    targetAppProfile: 'vscode-editor',
    diagnosticOnly: false,
    refsFirst: true,
    dogfoodRefs: {
      targetAppRef: 'app:profile/vscode-editor',
      realHostProviderSessionRef: 'computer-use:native-host/real-provider-sessions/vscode-real-closed-loop/session.json',
      realOptInRunRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/run.json',
      sessionRef: 'computer-use:native-host/sessions/vscode-real-closed-loop/session.json',
      liveSurfaceRef: 'computer-use:native-host/surfaces/vscode-real-closed-loop/live-surface.json',
      currentFrameRef: 'computer-use:native-host/frames/vscode-real-closed-loop/after-resume.json',
      currentRunPointerRef: 'computer-use:native-host/runs/vscode-real-closed-loop/current-run-pointer.json',
      evidenceLedgerRef: 'computer-use:native-host/ledgers/vscode-real-closed-loop/evidence-ledger.json',
      realPlatformEvidenceRefs: [
        'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/diagnostic-only-false.json',
        'computer-use:native-host/platform-drivers/macos/ready.json',
        'computer-use:native-host/ledgers/vscode-real-closed-loop/evidence-ledger.json',
      ],
      realAgentQueueEvidenceRefs: [
        'computer-use:native-host/provider-adapter-control/vscode-real-closed-loop/pause/agent-queue.json',
        'computer-use:native-host/provider-adapter-control/vscode-real-closed-loop/resume/agent-queue.json',
        'computer-use:native-host/provider-adapter-control/vscode-real-closed-loop/resume/current-frame-refresh.json',
      ],
      minimalEvidenceReplayRefs: [
        'computer-use:native-host/ledgers/vscode-real-closed-loop/evidence-ledger.json/events/0001-session.created.json',
        'computer-use:native-host/ledgers/vscode-real-closed-loop/evidence-ledger.json/events/0006-human-input.accepted.json',
        'computer-use:native-host/ledgers/vscode-real-closed-loop/evidence-ledger.json/events/0008-agent.resumed.json',
      ],
      inputAcceptedRefs: [
        'computer-use:native-host/inputs/vscode-real-closed-loop/0001-type-text.json',
      ],
      automationBarrierRefs: [
        'computer-use:native-host/provider-adapter-control/vscode-real-closed-loop/pause/agent-queue.json',
        'computer-use:native-host/provider-adapter-control/vscode-real-closed-loop/resume/agent-queue.json',
      ],
      backgroundEvidenceRefs: [
        'computer-use:native-host/surfaces/vscode-real-closed-loop/frame-stream.json',
      ],
    },
    userAcceptanceInput: {
      evidenceClaims: [{
        kind: 'real-virtual-app-screen',
        status: 'present',
        diagnosticOnly: false,
        realHostProviderSessionRef: 'computer-use:native-host/real-provider-sessions/vscode-real-closed-loop/session.json',
        realOptInRunRef: 'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/run.json',
        realPlatformEvidenceRefs: [
          'computer-use:native-host/real-opt-in-runs/vscode-real-closed-loop/diagnostic-only-false.json',
        ],
      }],
    },
    validation: {
      ok: true,
      missing: [],
    },
  } as const;
}
