import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
  LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
  runVirtualAppScreenRealHostEvidenceManifestHandoffGate,
} from '../../tools/check-virtual-app-screen-real-host-evidence-manifest-gate.js';
import {
  parseVirtualAppScreenRealOptInSmokeLauncherArgs,
} from '../../tools/run-virtual-app-screen-real-opt-in-smoke.js';

test('Linux and Windows handoff gate validates prerequisite manifests without claiming platform pass', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-real-host-handoff-gate-'));
  try {
    const macosPath = await writeManifest(workspace, 'macos-passed.json', passedRealHostManifest('macos'));
    const linuxPath = await writeManifest(workspace, 'linux-xpra-passed.json', passedRealHostManifest('linux-xpra'));

    const linuxGate = await runVirtualAppScreenRealHostEvidenceManifestHandoffGate({
      target: 'linux-after-macos',
      manifestPath: macosPath,
    });
    assert.equal(linuxGate.status, 'passed');
    assert.equal(linuxGate.passClaim, false);
    assert.equal(linuxGate.target, 'linux-after-macos');
    assert.equal(linuxGate.manifestEnv, MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV);
    assert.deepEqual(linuxGate.expectedPlatformProviders, ['macos']);
    assert.match(linuxGate.exportEnvCommand, /SCIFORGE_VIRTUAL_APP_SCREEN_MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=/u);
    assert.match(linuxGate.handoffCommands.join('\n'), /smoke:virtual-app-screen-linux-xpra-real-human-input:opt-in/u);

    const windowsGate = await runVirtualAppScreenRealHostEvidenceManifestHandoffGate({
      target: 'windows-after-linux',
      manifestPath: linuxPath,
    });
    assert.equal(windowsGate.status, 'passed');
    assert.equal(windowsGate.passClaim, false);
    assert.equal(windowsGate.target, 'windows-after-linux');
    assert.equal(windowsGate.manifestEnv, LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV);
    assert.deepEqual(windowsGate.expectedPlatformProviders, ['linux-xpra', 'linux']);
    assert.match(windowsGate.exportEnvCommand, /SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST=/u);
    assert.match(windowsGate.handoffCommands.join('\n'), /smoke:virtual-app-screen-windows-idd-real-driver:opt-in/u);
    assert.match(windowsGate.handoffCommands.join('\n'), /smoke:virtual-app-screen-windows-idd-real-human-input:opt-in/u);
    assert.match(
      windowsGate.handoffCommands.join('\n'),
      /--linux-manifest .*linux-xpra-passed\.json/u,
    );
    assert.match(
      windowsGate.handoffCommands.join('\n'),
      /--evidence-manifest .*windows-idd-real-closed-loop\/manifest\.json/u,
    );
    assert.equal(windowsGate.handoffCommandsByShell.powershell.join('\n'), windowsGate.handoffCommands.join('\n'));
    assert.equal(windowsGate.handoffCommandsByShell.cmd.join('\n'), windowsGate.handoffCommands.join('\n'));

    const rejectedWindowsGate = await runVirtualAppScreenRealHostEvidenceManifestHandoffGate({
      target: 'windows-after-linux',
      manifestPath: macosPath,
    });
    assert.equal(rejectedWindowsGate.status, 'failed');
    assert.equal(rejectedWindowsGate.passClaim, false);
    assert.match(rejectedWindowsGate.issues.join('\n'), /platformProvider must be linux-xpra or linux/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('handoff gate scripts and runbook expose explicit manifest env commands', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.match(
    packageJson.scripts?.['smoke:virtual-app-screen-linux-xpra-real-handoff-gate'] ?? '',
    /--target linux-after-macos/u,
  );
  assert.match(
    packageJson.scripts?.['smoke:virtual-app-screen-windows-idd-real-handoff-gate'] ?? '',
    /--target windows-after-linux/u,
  );
  assert.match(
    packageJson.scripts?.['smoke:virtual-app-screen-windows-idd-real-human-input:opt-in'] ?? '',
    /tools\/run-virtual-app-screen-real-opt-in-smoke\.ts windows-idd-real-human-input/u,
  );

  const windowsDriverScript = packageJson.scripts?.['smoke:virtual-app-screen-windows-idd-real-driver:opt-in'] ?? '';
  const windowsHumanInputScript = packageJson.scripts?.['smoke:virtual-app-screen-windows-idd-real-human-input:opt-in'] ?? '';
  assert.match(windowsDriverScript, /tools\/run-virtual-app-screen-real-opt-in-smoke\.ts windows-idd-real-driver/u);
  assert.doesNotMatch(windowsDriverScript, /^SCIFORGE_/u);
  assert.doesNotMatch(windowsHumanInputScript, /^SCIFORGE_/u);

  const launcher = await readFile('tools/run-virtual-app-screen-real-opt-in-smoke.ts', 'utf8');
  assert.match(launcher, /windows-idd-real-driver/u);
  assert.match(launcher, /windows-idd-real-human-input/u);
  assert.match(launcher, /--linux-manifest/u);
  assert.match(launcher, /--evidence-manifest/u);

  const driverSmoke = await readFile('tests/smoke/smoke-virtual-app-screen-windows-idd-real-driver-opt-in.test.ts', 'utf8');
  const humanInputSmoke = await readFile('tests/smoke/smoke-virtual-app-screen-windows-idd-real-human-input-opt-in.test.ts', 'utf8');
  assert.match(driverSmoke, /assert\.fail\(optInBlockedPassFailureMessage\(attached\)\)/u);
  assert.match(humanInputSmoke, /assert\.fail\(optInBlockedPassFailureMessage\(attached\)\)/u);
  assert.doesNotMatch(driverSmoke, /if \(attached\.status !== 'attached'\) \{[\s\S]*?assertOptInBlockedEvidence\(attached\);[\s\S]*?return;/u);
  assert.doesNotMatch(humanInputSmoke, /if \(attached\.status !== 'attached'\) \{[\s\S]*?assertOptInBlockedEvidence\(attached\);[\s\S]*?return;/u);

  const runbook = await readFile('docs/runbooks/virtual-app-screen-dogfood-runbook.md', 'utf8');
  for (const token of [
    MACOS_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST_ENV,
    'npm run smoke:virtual-app-screen-linux-xpra-real-handoff-gate --silent',
    'npm run smoke:virtual-app-screen-windows-idd-real-handoff-gate --silent',
    'npm run smoke:virtual-app-screen-windows-idd-real-human-input:opt-in --silent',
  ]) {
    assert.match(runbook, new RegExp(escapeRegExp(token), 'u'));
  }
});

test('Windows real opt-in launcher converts manifest args into child env without shell prefixes', () => {
  const parsed = parseVirtualAppScreenRealOptInSmokeLauncherArgs([
    '--linux-manifest',
    'docs/test-artifacts/linux/manifest.json',
    '--evidence-manifest',
    'docs/test-artifacts/windows/manifest.json',
    '--test-name-pattern',
    'Windows IDD real human input',
  ]);

  assert.deepEqual(parsed.env, {
    SCIFORGE_VIRTUAL_APP_SCREEN_LINUX_REAL_CLOSED_LOOP_EVIDENCE_MANIFEST: 'docs/test-artifacts/linux/manifest.json',
    SCIFORGE_VIRTUAL_APP_SCREEN_REAL_HOST_SESSION_EVIDENCE_MANIFEST: 'docs/test-artifacts/windows/manifest.json',
  });
  assert.deepEqual(parsed.passthroughArgs, [
    '--test-name-pattern',
    'Windows IDD real human input',
  ]);
  assert.throws(
    () => parseVirtualAppScreenRealOptInSmokeLauncherArgs(['--linux-manifest']),
    /--linux-manifest requires a path/u,
  );
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
