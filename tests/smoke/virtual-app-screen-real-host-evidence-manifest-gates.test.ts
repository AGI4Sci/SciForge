import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertRealHostSessionEvidenceManifestGateFromEnv,
  validateRealHostSessionEvidenceManifestGate,
} from './helpers/virtual-app-screen-real-host-evidence-manifest-gates.js';

const MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST';
const LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST';

test('real Host manifest gate lets a passed macOS manifest unlock Linux sequencing only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-real-host-macos-gate-'));
  try {
    const passedPath = await writeManifest(workspace, 'macos-passed.json', passedRealHostManifest('macos'));
    const blockedPath = await writeManifest(workspace, 'macos-blocked.json', {
      ...passedRealHostManifest('macos'),
      status: 'blocked',
      blockedReason: 'provider evidence was not complete',
      validation: { ok: false, missing: ['resume proof is required'] },
    });
    const diagnosticPath = await writeManifest(workspace, 'macos-diagnostic.json', {
      ...passedRealHostManifest('macos'),
      diagnosticOnly: true,
      dogfoodRefs: {
        ...passedRealHostManifest('macos').dogfoodRefs,
        diagnosticOnly: true,
      },
      userAcceptanceInput: {
        evidenceClaims: [{
          ...passedRealHostManifest('macos').userAcceptanceInput.evidenceClaims[0],
          diagnosticOnly: true,
        }],
      },
    });
    const fixturePath = await writeManifest(workspace, 'macos-fixture.json', {
      ...passedRealHostManifest('macos'),
      dogfoodRefs: {
        ...passedRealHostManifest('macos').dogfoodRefs,
        realPlatformEvidenceRefs: ['computer-use:native-host/fixtures/macos/diagnostic-only-false.json'],
      },
    });
    const missingCurrentRunPath = await writeManifest(workspace, 'macos-missing-current-run.json', {
      ...passedRealHostManifest('macos'),
      dogfoodRefs: {
        ...passedRealHostManifest('macos').dogfoodRefs,
        currentRunPointerRef: undefined,
        evidenceLedgerRef: undefined,
      },
    });
    const replayOutsideLedgerPath = await writeManifest(workspace, 'macos-replay-outside-ledger.json', {
      ...passedRealHostManifest('macos'),
      dogfoodRefs: {
        ...passedRealHostManifest('macos').dogfoodRefs,
        minimalEvidenceReplayRefs: [
          'computer-use:native-host/ledgers/other-run/evidence-ledger.json/events/0001-session.created.json',
        ],
      },
    });
    const mismatchedClaimCurrentRunPath = await writeManifest(workspace, 'macos-mismatched-claim-current-run.json', {
      ...passedRealHostManifest('macos'),
      userAcceptanceInput: {
        evidenceClaims: [{
          ...passedRealHostManifest('macos').userAcceptanceInput.evidenceClaims[0],
          currentRunPointerRef: 'computer-use:native-host/runs/other-run/current-run-pointer.json',
        }],
      },
    });

    assert.equal(await validateRealHostSessionEvidenceManifestGate(passedPath, {
      expectedPlatformProviders: ['macos'],
      manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
      gateName: 'Linux Xpra after macOS',
    }), passedPath);
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(blockedPath, {
        expectedPlatformProviders: ['macos'],
        manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Linux Xpra after macOS',
      }),
      /status must be passed/u,
    );
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(diagnosticPath, {
        expectedPlatformProviders: ['macos'],
        manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Linux Xpra after macOS',
      }),
      /diagnosticOnly must be false/u,
    );
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(fixturePath, {
        expectedPlatformProviders: ['macos'],
        manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Linux Xpra after macOS',
      }),
      /must not reference fixture evidence/u,
    );
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(missingCurrentRunPath, {
        expectedPlatformProviders: ['macos'],
        manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Linux Xpra after macOS',
      }),
      /current-run Host refs/u,
    );
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(replayOutsideLedgerPath, {
        expectedPlatformProviders: ['macos'],
        manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Linux Xpra after macOS',
      }),
      /minimalEvidenceReplayRefs.*must be scoped to dogfoodRefs.evidenceLedgerRef/u,
    );
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(mismatchedClaimCurrentRunPath, {
        expectedPlatformProviders: ['macos'],
        manifestEnv: MACOS_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Linux Xpra after macOS',
      }),
      /claim.currentRunPointerRef must match dogfoodRefs.currentRunPointerRef/u,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('real Host manifest gate reads env paths and keeps Windows sequenced after Linux only', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-real-host-windows-gate-'));
  const previousEnv = process.env[LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV];
  try {
    const linuxPath = await writeManifest(workspace, 'linux-passed.json', passedRealHostManifest('linux'));
    const linuxXpraPath = await writeManifest(workspace, 'linux-xpra-passed.json', passedRealHostManifest('linux-xpra'));
    const macosPath = await writeManifest(workspace, 'macos-passed.json', passedRealHostManifest('macos'));

    process.env[LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV] = linuxPath;
    assert.equal(await assertRealHostSessionEvidenceManifestGateFromEnv({
      expectedPlatformProviders: ['linux-xpra', 'linux'],
      manifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
      gateName: 'Windows IDD after Linux',
      missingManifestMessage: 'Linux evidence manifest is required before Windows IDD can claim a pass.',
    }), linuxPath);

    assert.equal(await validateRealHostSessionEvidenceManifestGate(linuxXpraPath, {
      expectedPlatformProviders: ['linux-xpra', 'linux'],
      manifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
      gateName: 'Windows IDD after Linux',
    }), linuxXpraPath);
    await assert.rejects(
      () => validateRealHostSessionEvidenceManifestGate(macosPath, {
        expectedPlatformProviders: ['linux-xpra', 'linux'],
        manifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Windows IDD after Linux',
      }),
      /platformProvider must be linux-xpra or linux/u,
    );

    delete process.env[LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV];
    await assert.rejects(
      () => assertRealHostSessionEvidenceManifestGateFromEnv({
        expectedPlatformProviders: ['linux-xpra', 'linux'],
        manifestEnv: LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
        gateName: 'Windows IDD after Linux',
        missingManifestMessage: 'Linux evidence manifest is required before Windows IDD can claim a pass.',
      }),
      /Linux evidence manifest is required/u,
    );
  } finally {
    if (previousEnv === undefined) {
      delete process.env[LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV];
    } else {
      process.env[LINUX_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV] = previousEnv;
    }
    await rm(workspace, { recursive: true, force: true });
  }
});

async function writeManifest(workspace: string, name: string, manifest: unknown): Promise<string> {
  const path = join(workspace, name);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return path;
}

function passedRealHostManifest(platformProvider: string) {
  const refs = {
    diagnosticOnly: false,
    realHostProviderSessionRef: `computer-use:native-host/real-provider-sessions/${platformProvider}/session.json`,
    realOptInRunRef: `computer-use:native-host/real-opt-in-runs/${platformProvider}/run.json`,
    sessionRef: `computer-use:native-host/sessions/${platformProvider}/session.json`,
    liveSurfaceRef: `computer-use:native-host/surfaces/${platformProvider}/live-surface.json`,
    currentFrameRef: `computer-use:native-host/frames/${platformProvider}/after-resume.json`,
    currentRunPointerRef: `computer-use:native-host/runs/${platformProvider}/current-run-pointer.json`,
    evidenceLedgerRef: `computer-use:native-host/ledgers/${platformProvider}/evidence-ledger.json`,
    realPlatformEvidenceRefs: [
      `computer-use:native-host/real-opt-in-runs/${platformProvider}/diagnostic-only-false.json`,
      `computer-use:native-host/platform-drivers/${platformProvider}/ready.json`,
      `computer-use:native-host/ledgers/${platformProvider}/evidence-ledger.json`,
    ],
    realAgentQueueEvidenceRefs: [
      `computer-use:native-host/provider-adapter-control/${platformProvider}/pause/agent-queue.json`,
      `computer-use:native-host/provider-adapter-control/${platformProvider}/resume/agent-queue.json`,
      `computer-use:native-host/provider-adapter-control/${platformProvider}/resume/current-frame-refresh.json`,
    ],
    minimalEvidenceReplayRefs: [
      `computer-use:native-host/ledgers/${platformProvider}/evidence-ledger.json/events/0001-session.created.json`,
      `computer-use:native-host/ledgers/${platformProvider}/evidence-ledger.json/events/0006-human-input.accepted.json`,
      `computer-use:native-host/ledgers/${platformProvider}/evidence-ledger.json/events/0008-agent.resumed.json`,
    ],
    inputAcceptedRefs: [
      `computer-use:native-host/inputs/${platformProvider}/0001-type-text.json`,
    ],
    automationBarrierRefs: [
      `computer-use:native-host/provider-adapter-control/${platformProvider}/pause/agent-queue.json`,
      `computer-use:native-host/provider-adapter-control/${platformProvider}/resume/agent-queue.json`,
    ],
    backgroundEvidenceRefs: [
      `computer-use:native-host/surfaces/${platformProvider}/frame-stream.json`,
    ],
  };
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-real-host-session-evidence.v1',
    status: 'passed',
    runId: `${platformProvider}-real-closed-loop`,
    platformProvider,
    targetAppProfile: 'generic-editor',
    diagnosticOnly: false,
    refsFirst: true,
    dogfoodRefs: refs,
    userAcceptanceInput: {
      evidenceClaims: [{
        kind: 'real-virtual-app-screen',
        status: 'present',
        diagnosticOnly: false,
        realHostProviderSessionRef: refs.realHostProviderSessionRef,
        realOptInRunRef: refs.realOptInRunRef,
        currentRunPointerRef: refs.currentRunPointerRef,
        realPlatformEvidenceRefs: refs.realPlatformEvidenceRefs,
        evidenceRefs: [
          ...refs.inputAcceptedRefs,
          ...refs.automationBarrierRefs,
          ...refs.backgroundEvidenceRefs,
        ],
        minimalEvidenceReplayRefs: refs.minimalEvidenceReplayRefs,
      }],
    },
    validation: {
      ok: true,
      missing: [],
    },
  };
}
