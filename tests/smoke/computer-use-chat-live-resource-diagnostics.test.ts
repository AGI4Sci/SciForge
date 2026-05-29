import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  COMPUTER_USE_CHAT_LIVE_RESOURCE_DIAGNOSTICS_SCHEMA,
  buildComputerUseChatLiveResourceDiagnostics,
  runComputerUseChatLiveResourceDiagnostics,
} from '../../tools/computer-use-chat-live-resource-diagnostics.js';

test('Computer Use chat live resource diagnostics normalizes env, refs, ports, timeouts, and cleanup notes', () => {
  const diagnostics = buildComputerUseChatLiveResourceDiagnostics({
    now: () => new Date('2026-05-29T00:00:00.000Z'),
    env: {
      SCIFORGE_UI_PORT: '5173',
      SCIFORGE_WORKSPACE_PORT: '6173',
      SCIFORGE_RUNTIME_CODEX_PORT: '18080',
      SCIFORGE_RUN_REAL_L3_WORKFLOW_BACKEND: 'docker',
      SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT: '6090',
      SCIFORGE_RUN_REAL_L3_WORKFLOW_RESOURCE_LOCK_ROOT: '/tmp/sciforge-computer-use-l3-locks',
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: 'https://provider.example/v1',
      SCIFORGE_RUNTIME_API_KEY: 'sk-should-not-appear',
    },
    manifestRefs: [
      '.sciforge/vision-runs/live-run/embedded-l3-completion-producer-diagnostics.json',
    ],
    manifests: [{
      runDirRef: '.sciforge/vision-runs/live-run',
      packageBridgeCompletionGrade: {
        diagnosticRefs: ['.sciforge/vision-runs/live-run/completion-grade-diagnostics.json'],
        producerDiagnosticRefs: ['.sciforge/vision-runs/live-run/embedded-l3-completion-producer-diagnostics.json'],
        acceptanceManifestRefs: ['.sciforge/vision-runs/live-run/cu-user-acceptance-manifest.json'],
      },
      sourceDirRef: '.sciforge/vision-runs/live-run/evidence/l3',
      runnerOptions: {
        backend: 'docker',
        vncPort: '5910',
        novncPort: '6090',
        dockerImage: 'sciforge-computer-use-isolated-backend:ci',
      },
      process: {
        command: 'docker',
        args: [
          'run',
          '127.0.0.1:6090:6090',
          '/tmp/sciforge-cu-l3-docker-secret:/evidence/l3',
        ],
        timedOut: true,
        timeoutMs: 195000,
        code: 124,
        signal: 'SIGTERM',
      },
    }],
    processNotes: [{
      kind: 'docker-container',
      containerId: 'abc123',
      containerName: 'sciforge-live-run',
      image: 'sciforge-computer-use-isolated-backend:ci',
      cleanup: {
        attempted: true,
        released: false,
        method: 'docker rm -f',
        error: 'failed Authorization Bearer sk-secret-value token=raw-secret https://provider.example/v1',
      },
    }],
  });

  assert.equal(diagnostics.schemaVersion, COMPUTER_USE_CHAT_LIVE_RESOURCE_DIAGNOSTICS_SCHEMA);
  assert.equal(diagnostics.checkedAt, '2026-05-29T00:00:00.000Z');
  assert.equal(diagnostics.status, 'needs-attention');
  assert.equal(diagnostics.evidenceMode, 'diagnostic-only');
  assert.equal(diagnostics.env.SCIFORGE_UI_PORT, '5173');
  assert.equal('SCIFORGE_RUNTIME_API_KEY' in diagnostics.env, false);
  assert.equal('SCIFORGE_PROXY_UPSTREAM_BASE_URL' in diagnostics.env, false);
  assert.deepEqual(diagnostics.refs.runDirRefs, ['.sciforge/vision-runs/live-run']);
  assert.ok(diagnostics.refs.producerDiagnosticRefs.includes('.sciforge/vision-runs/live-run/embedded-l3-completion-producer-diagnostics.json'));
  assert.ok(diagnostics.refs.completionDiagnosticRefs.includes('.sciforge/vision-runs/live-run/completion-grade-diagnostics.json'));
  assert.ok(diagnostics.refs.acceptanceManifestRefs.includes('.sciforge/vision-runs/live-run/cu-user-acceptance-manifest.json'));
  assert.ok(diagnostics.refs.stagingDirRefs.includes('.sciforge/vision-runs/live-run/evidence/l3'));
  assert.ok(diagnostics.resources.ports.some((port) => port.port === 6090 && port.kind === 'novnc'));
  assert.ok(diagnostics.resources.ports.some((port) => port.port === 5910 && port.kind === 'vnc'));
  assert.ok(diagnostics.resources.timeouts.some((timeout) => timeout.timedOut && timeout.timeoutMs === 195000));
  assert.ok(diagnostics.resources.containers.some((container) => container.name === 'sciforge-live-run'));
  assert.ok(diagnostics.resources.cleanup.some((cleanup) => cleanup.resourceKind === 'container' && cleanup.released === false));
  assert.ok(diagnostics.issues.some((issue) => issue.startsWith('resource-timeout:')));
  assert.ok(diagnostics.issues.some((issue) => issue.startsWith('resource-cleanup-not-released:container:')));

  const text = JSON.stringify(diagnostics);
  assert.equal(text.includes('sk-should-not-appear'), false);
  assert.equal(text.includes('sk-secret-value'), false);
  assert.equal(text.includes('raw-secret'), false);
  assert.equal(text.includes('provider.example'), false);
});

test('Computer Use chat live resource diagnostics CLI reads manifests and writes sanitized diagnostic JSON', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-resource-diagnostics-'));
  try {
    const manifestPath = join(workspace, 'producer-diagnostic.json');
    const notePath = join(workspace, 'cleanup-note.json');
    const outPath = join(workspace, 'resource-diagnostics.json');
    await writeFile(manifestPath, `${JSON.stringify({
      schemaVersion: 'sciforge.computer-use.embedded-l3-completion-producer-diagnostic.v1',
      runId: 'live-run',
      sourceDirRef: '.sciforge/vision-runs/live-run/evidence/l3',
      expectedCompletionEvidenceRef: '.sciforge/vision-runs/live-run/isolated-desktop-l3-workflow-evidence.json',
      runnerOptions: {
        backend: 'docker',
        novncPort: '6091',
      },
      process: {
        command: 'docker',
        timedOut: false,
        timeoutMs: 120000,
        code: 0,
        signal: null,
      },
    }, null, 2)}\n`, 'utf8');
    await writeFile(notePath, `${JSON.stringify({
      pid: 4242,
      service: 'workspace-server',
      cleanup: { attempted: true, released: true, method: 'SIGTERM' },
    }, null, 2)}\n`, 'utf8');

    const diagnostics = await runComputerUseChatLiveResourceDiagnostics({
      env: {
        SCIFORGE_WORKSPACE_PORT: '6173',
        SCIFORGE_RUN_REAL_L3_WORKFLOW_NOVNC_PORT: '6091',
      },
      manifestPaths: [manifestPath],
      notePaths: [notePath],
      out: outPath,
      now: () => new Date('2026-05-29T01:00:00.000Z'),
    });
    const written = JSON.parse(await readFile(outPath, 'utf8')) as typeof diagnostics;

    assert.equal(diagnostics.status, 'passed', JSON.stringify(diagnostics.issues));
    assert.equal(written.schemaVersion, COMPUTER_USE_CHAT_LIVE_RESOURCE_DIAGNOSTICS_SCHEMA);
    assert.ok(written.refs.stagingDirRefs.includes('.sciforge/vision-runs/live-run/evidence/l3'));
    assert.ok(written.resources.processes.some((process) => process.pid === 4242 && process.kind === 'server'));
    assert.ok(written.resources.cleanup.some((cleanup) => cleanup.resourceKind === 'process' && cleanup.released === true));
    assert.equal(written.issues.length, 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Computer Use chat live resource diagnostics auto reads lifecycle pidfiles, port ownership, and cleanup notes with redaction', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-resource-lifecycle-'));
  try {
    const lifecycleDir = join(workspace, 'dev-lifecycle');
    const outPath = join(workspace, 'resource-diagnostics.json');
    await mkdir(lifecycleDir, { recursive: true });
    await writeFile(join(lifecycleDir, 'ui-p1-55173.pid.json'), `${JSON.stringify({
      service: 'ui',
      repoRoot: workspace,
      port: 55173,
      launcherPid: 8811,
      childPid: 8812,
      token: 'lifecycle-token-secret-value',
      startedAt: '2026-05-29T02:00:00.000Z',
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(lifecycleDir, 'port-ownership.json'), `${JSON.stringify({
      port: 55173,
      pid: 8812,
      service: 'ui',
      command: 'vite --api_key=sk-port-secret-value --model=gpt-secret https://provider.example/v1 Authorization: Bearer raw-token',
      cleanup: { resourceKind: 'process', result: 'unknown' },
    }, null, 2)}\n`, 'utf8');
    await writeFile(join(lifecycleDir, 'process-cleanup-note.json'), `${JSON.stringify({
      pid: 8812,
      service: 'ui',
      cleanup: {
        resourceKind: 'process',
        attempted: true,
        released: true,
        method: 'SIGTERM model=gpt-secret token=raw-token',
        error: 'provider https://provider.example/v1 Authorization: Bearer raw-token password=hunter2',
      },
    }, null, 2)}\n`, 'utf8');

    const diagnostics = await runComputerUseChatLiveResourceDiagnostics({
      env: {
        SCIFORGE_UI_PORT: '55173',
        SCIFORGE_LIVE_RESOURCE_LIFECYCLE_DIR: lifecycleDir,
      },
      out: outPath,
      now: () => new Date('2026-05-29T02:00:00.000Z'),
    });
    const written = JSON.parse(await readFile(outPath, 'utf8')) as typeof diagnostics;

    assert.equal(written.status, 'passed', JSON.stringify(written.issues));
    assert.ok(written.resources.ports.some((port) => port.port === 55173 && port.kind === 'ui'));
    assert.ok(written.resources.processes.some((process) => process.pid === 8811 && process.label?.includes('launcherPid')));
    assert.ok(written.resources.processes.some((process) => process.pid === 8812 && process.source.includes('ui-p1-55173.pid.json')));
    assert.ok(written.resources.processes.some((process) => process.pid === 8812 && process.source.includes('port-ownership.json')));
    assert.ok(written.resources.cleanup.some((cleanup) => cleanup.resourceKind === 'process' && cleanup.released === true));

    const text = JSON.stringify(written);
    assert.equal(text.includes('provider.example'), false);
    assert.equal(text.includes('sk-port-secret-value'), false);
    assert.equal(text.includes('gpt-secret'), false);
    assert.equal(text.includes('raw-token'), false);
    assert.equal(text.includes('hunter2'), false);
    assert.equal(text.includes('lifecycle-token-secret-value'), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
