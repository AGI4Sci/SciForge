import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  modelRouterComputerUseLiveAcceptanceCases,
  requiredModelRouterComputerUseLiveAcceptanceCategories,
} from '../../tools/model-router-computer-use-live-acceptance-cases.js';
import {
  buildModelRouterComputerUseLiveAcceptanceMatrixManifest,
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION,
  type ModelRouterComputerUseLiveAcceptanceMatrixResult,
} from '../../tools/model-router-computer-use-live-acceptance-matrix.js';

const execFileAsync = promisify(execFile);

const requiredIds = [
  'browser-research',
  'docs-sheets-edit',
  'file-management',
  'ide-terminal',
  'cross-window-recovery-verifier',
] as const;

const forbiddenRawPayloadPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|api[_-]?key|secret|token|credential|password|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;

test('Model Router Computer Use live acceptance matrix defines exactly the required cases refs-first', () => {
  assert.deepEqual([...requiredModelRouterComputerUseLiveAcceptanceCategories], [...requiredIds]);
  assert.deepEqual(modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id), [...requiredIds]);
  assert.deepEqual(modelRouterComputerUseLiveAcceptanceCases.map((item) => item.category), [...requiredIds]);

  const ids = new Set<string>();
  for (const item of modelRouterComputerUseLiveAcceptanceCases) {
    assert.equal(ids.has(item.id), false, `duplicate case id: ${item.id}`);
    ids.add(item.id);
    assert.ok(item.requiredCapabilityIds.length >= 3, `${item.id} should require router/computer-use capabilities`);
    assert.ok(item.requiredEvidenceKinds.length >= 2, `${item.id} should require current-run evidence kinds`);
    assert.equal(Object.hasOwn(item, 'expectedAnswer'), false, `${item.id} must not encode fake answer text`);
    assert.doesNotMatch(JSON.stringify(item), forbiddenRawPayloadPattern);
  }
});

test('Model Router Computer Use live acceptance manifest strips raw payload fields and blocks missing evidence', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: [{
      ...passingResult('browser-research'),
      routerTraceRefs: ['data:image/png;base64,abc123'],
      evidenceRefs: {
        screenshotRefs: ['/Users/alice/Desktop/raw.png'],
        verifierRefs: ['docs/test-artifacts/model-router-computer-use-live-matrix/runs/run-1/browser-research/verifier.json'],
      },
      publicModelAlias: 'sciforge-router Authorization: Bearer leaked',
      issues: ['rawProviderPayload should not appear'],
    }],
  });

  assert.equal(manifest.schemaVersion, MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.ok(manifest.issues.some((issue) => issue.includes('missing-case:ide-terminal')));
  assert.ok(manifest.issues.some((issue) => issue.includes('forbidden-raw-payload')));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest blocks broad raw refs without publishing them', () => {
  const longBase64 = 'A'.repeat(140);
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: [{
      ...passingResult('ide-terminal'),
      routerTraceRefs: [
        'https://provider.example/v1/raw',
        '/tmp/sciforge/raw-trace.json',
        'C:\\Users\\Alice\\raw-trace.json',
        'artifact:/Users/alice/private/raw-trace.json',
        'run:C:\\Users\\Alice\\raw-trace.json',
        longBase64,
      ],
      evidenceRefs: {
        terminalRefs: ['terminal:current-run'],
        verifierRefs: ['docs/test-artifacts/model-router-computer-use-live-matrix/runs/current/ide-terminal/verifier.json'],
        fileRefs: ['docs/test-artifacts/model-router-computer-use-live-matrix/runs/current/ide-terminal/workspace-diff.patch'],
      },
    }],
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.some((issue) => issue.includes('forbidden-raw-payload')));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
  assert.equal(JSON.stringify(manifest).includes('artifact:/Users'), false);
  assert.equal(JSON.stringify(manifest).includes('run:C:\\'), false);
});

test('Model Router Computer Use live acceptance manifest blocks when ide-terminal evidence is absent', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds
      .filter((id) => id !== 'ide-terminal')
      .map((id) => passingResult(id)),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.coverage.allCasesPassed, false);
  assert.ok(manifest.coverage.missingCaseIds.includes('ide-terminal'));
  assert.ok(manifest.coverage.missingCategories.includes('ide-terminal'));
  assert.ok(manifest.issues.includes('missing-case:ide-terminal'));
  assert.ok(manifest.issues.includes('missing-category:ide-terminal'));
});

test('Model Router Computer Use live acceptance manifest blocks evidence outside the declared current-run scope', () => {
  const crossRun = passingResult('docs-sheets-edit');
  crossRun.executor = {
    ...crossRun.executor!,
    executorRef: 'docs/test-artifacts/model-router-computer-use-live-matrix/runs/other/docs-sheets-edit/executor.json',
  };
  crossRun.evidenceRefs = {
    ...crossRun.evidenceRefs,
    fileRefs: ['docs/test-artifacts/model-router-computer-use-live-matrix/runs/other/docs-sheets-edit/sheet.xlsx'],
  };

  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => id === 'docs-sheets-edit' ? crossRun : passingResult(id)),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(
    manifest.issues.some((issue) => issue.includes('current-run-scope')),
    manifest.issues.join('\n'),
  );
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest requires visible GUI present evidence for passed cases', () => {
  const blockedGui = passingResult('file-management');
  blockedGui.gui = {
    blockedRef: 'gui.blocked:model-router-computer-use-live-matrix/current/file-management',
    repairRef: 'gui.repair:model-router-computer-use-live-matrix/current/file-management',
  };

  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => id === 'file-management' ? blockedGui : passingResult(id)),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.some((issue) => issue.includes('missing-gui-present-ref')), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest requires native executor binding refs', () => {
  const missingNativeBinding = passingResult('ide-terminal');
  missingNativeBinding.executor = {
    ...missingNativeBinding.executor!,
    sessionRef: undefined,
    nativeHostRef: undefined,
  };

  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => id === 'ide-terminal' ? missingNativeBinding : passingResult(id)),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.some((issue) => issue.includes('missing-native-executor-binding-ref')), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance file-source manifest requires trace audit binding', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    source: { kind: 'manifest-file', ref: 'docs/test-artifacts/model-router-computer-use-live-matrix/manifest.json' },
    results: requiredIds.map((id) => passingResult(id)),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.ok(manifest.issues.includes('trace-audit-missing'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest blocks router traces not covered by trace audit', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit: traceAuditFor(requiredIds.filter((id) => id !== 'ide-terminal')),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-missing-trace:ide-terminal'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest requires audit coverage of exact trace json files', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit: {
      ...traceAuditFor(requiredIds),
      scannedFileRefs: requiredIds.map((id) => `current/${id}/final-routing-summary.json`),
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-missing-trace:browser-research'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest rejects embedded traversal router trace refs', () => {
  const traversalResult = passingResult('browser-research');
  traversalResult.routerTraceRefs = ['.sciforge/model-router-traces/current/browser-research/../../browser-research/trace.json'];

  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => id === 'browser-research' ? traversalResult : passingResult(id)),
    traceAudit: {
      ...traceAuditFor(requiredIds),
      scannedFileRefs: requiredIds.map((id) => (
        id === 'browser-research'
          ? 'current/browser-research/../../browser-research/trace.json'
          : `current/${id}/trace.json`
      )),
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(
    manifest.issues.includes('browser-research:non-file-evidence-ref:routerTraceRefs[0]'),
    manifest.issues.join('\n'),
  );
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest blocks malformed passing trace audit reports', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit: {
      status: 'pass',
      reportRef: 'docs/test-artifacts/model-router-computer-use-live-matrix/trace-audit.json',
      scannedFiles: requiredIds.length,
      scannedFileRefs: requiredIds.map((id) => `current/${id}/trace.json`),
      findings: [{ kind: 'known-secret' }],
      policy: {
        forbidsRawProviderPayload: false,
      },
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-fail'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest blocks trace audits without known secret scans', () => {
  const traceAudit = traceAuditFor(requiredIds);
  traceAudit.policy.knownSecretsChecked = 0;
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit,
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-fail'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest enforces expected known secret scan count', () => {
  const traceAudit = traceAuditFor(requiredIds);
  traceAudit.policy.knownSecretsChecked = 1;
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    requiredKnownSecretsChecked: 2,
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit,
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-known-corpus-checked-too-low'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance builder manifest passes structurally without live release acceptance', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => passingResult(id)),
  });

  assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.deepEqual(manifest.issues, []);
  assert.equal(manifest.coverage.everyRequiredCategoryPresent, true);
  assert.equal(manifest.coverage.allCasesPassed, true);
  assert.equal(manifest.cases.every((item) => item.gui.status === 'present'), true);
  assert.equal(manifest.cases.every((item) => item.routerTraceRefs.length >= 1), true);
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest blocks duplicate result case ids instead of letting the last result win', () => {
  const hiddenBlockedResult: ModelRouterComputerUseLiveAcceptanceMatrixResult = {
    ...passingResult('browser-research'),
    status: 'blocked',
    issues: ['blocked duplicate should not be hidden by a later passed result'],
  };
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: [
      hiddenBlockedResult,
      ...requiredIds.map((id) => passingResult(id)),
    ],
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('duplicate-case:browser-research'), manifest.issues.join('\n'));
  assert.equal(manifest.coverage.passedCaseIds.includes('browser-research'), true);
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest passes when all router traces are audit-covered', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit: traceAuditFor(requiredIds),
  });

  assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.deepEqual(manifest.issues, []);
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance manifest blocks duplicate router trace refs across passed cases', () => {
  const sharedTraceRef = '.sciforge/model-router-traces/current/shared/trace.json';
  const results = requiredIds.map((id) => ({
    ...passingResult(id),
    routerTraceRefs: [sharedTraceRef],
  }));
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    results,
    traceAudit: {
      ...traceAuditFor(requiredIds),
      scannedFiles: 1,
      scannedBytes: 128,
      scannedFileRefs: ['current/shared/trace.json'],
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.issues.includes('trace-audit-duplicate-router-trace-ref:current/shared/trace.json'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance file-source manifest can claim current run only with trace audit binding', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    source: { kind: 'manifest-file', ref: 'docs/test-artifacts/model-router-computer-use-live-matrix/manifest.json' },
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit: traceAuditFor(requiredIds),
  });

  assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
  assert.equal(manifest.releaseAcceptance, 'live-current-run');
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance requires a source ref before current-run release', () => {
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    source: { kind: 'input-file' },
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit: traceAuditFor(requiredIds),
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.ok(manifest.issues.includes('source-ref-missing:input-file'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance blocks inconsistent trace audit scan counts', () => {
  const traceAudit = traceAuditFor(requiredIds);
  traceAudit.scannedFiles = requiredIds.length + 10;
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt: '2026-06-05T00:00:00.000Z',
    source: { kind: 'manifest-file', ref: 'docs/test-artifacts/model-router-computer-use-live-matrix/manifest.json' },
    results: requiredIds.map((id) => passingResult(id)),
    traceAudit,
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.ok(manifest.issues.includes('trace-audit-fail'), manifest.issues.join('\n'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
});

test('Model Router Computer Use live acceptance CLI defaults to blocked/not-evaluated and strict fails', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-computer-use-live-acceptance-matrix.ts',
      '--strict',
      '--json',
    ], { cwd: process.cwd() }),
    (error: unknown) => {
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      assert.match(`${stdout}\n${stderr}`, /"status": "blocked"/);
      assert.match(`${stdout}\n${stderr}`, /"releaseAcceptance": "not-evaluated"/);
      assert.match(`${stdout}\n${stderr}`, /missing-case:ide-terminal/);
      return true;
    },
  );
});

test('Model Router Computer Use live acceptance CLI fail-closes missing manifests without leaking local paths', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-computer-use-live-acceptance-matrix.ts',
      '--manifest',
      join(process.cwd(), '..', 'missing-model-router-computer-use-live-matrix.json'),
      '--strict',
      '--json',
    ], { cwd: process.cwd() }),
    (error: unknown) => {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      assert.equal(stderr, '');
      const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
      assert.equal(manifest.status, 'blocked');
      assert.equal(manifest.source.kind, 'manifest-file');
      assert.match(manifest.source.ref ?? '', /^manifest-file:[a-f0-9]{16}$/);
      assert.ok(manifest.issues.includes('source-read-error:manifest-file'));
      assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
      return true;
    },
  );
});

test('Model Router Computer Use live acceptance CLI strict blocks fabricated refs without evidence files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-model-router-cu-live-matrix-'));
  const manifestPath = join(workspace, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    results: requiredIds.map((id) => passingResult(id)),
  }), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')));
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI requires external trace audit binding for input files', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-embedded-audit-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  await writeFile(manifestPath, JSON.stringify({
    results,
    traceAudit: traceAuditForResults(results),
  }), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.includes('trace-audit-external-binding-required'), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI passes live-current-run with file-backed evidence and external trace audit', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-release-pass-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-computer-use-live-acceptance-matrix.ts',
      '--input',
      manifestPath,
      '--trace-audit-report',
      traceAuditReport,
      '--expected-known-secrets-checked',
      '2',
      '--strict',
      '--json',
    ], { cwd: process.cwd() });
    const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;

    assert.equal(stderr, '');
    assert.equal(manifest.status, 'passed', manifest.issues.join('\n'));
    assert.equal(manifest.releaseAcceptance, 'live-current-run');
    assert.equal(manifest.source.kind, 'input-file');
    assert.equal(manifest.traceAudit?.status, 'pass');
    assert.deepEqual(manifest.issues, []);
    assert.deepEqual(manifest.coverage.passedCaseIds, [...requiredIds]);
    assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI rejects empty or identity-mismatched router trace json files', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-trace-semantics-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  await writeFile(join(process.cwd(), results[0].routerTraceRefs![0]), '{}', 'utf8');
  await writeFile(join(process.cwd(), results[1].routerTraceRefs![0]), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    profileId: 'different-runtime-profile',
    publicModelAlias: 'different-router-alias',
    calls: [{ role: 'visionTranslator', status: 'ok' }],
  }), 'utf8');
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.includes('router-trace-semantic-missing:browser-research'), manifest.issues.join('\n'));
        assert.ok(manifest.issues.includes('router-trace-profile-mismatch:docs-sheets-edit'), manifest.issues.join('\n'));
        assert.ok(manifest.issues.includes('router-trace-public-model-alias-mismatch:docs-sheets-edit'), manifest.issues.join('\n'));
        assert.ok(manifest.issues.includes('router-trace-required-role-missing:docs-sheets-edit:textReasoner'), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI enforces expected known secret scan count', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-known-corpus-count-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  const traceAudit = traceAuditForResults(results);
  traceAudit.policy.knownSecretsChecked = 1;
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAudit), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--expected-known-secrets-checked',
        '2',
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.includes('trace-audit-known-corpus-checked-too-low'), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI rejects stale trace audit reports', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-stale-report-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');
  const staleDate = new Date(Date.now() - 60_000);
  await utimes(traceAuditReport, staleDate, staleDate);

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.includes('trace-audit-report-stale'), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI rejects evidence older than current-run marker', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-stale-evidence-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');

  const staleRef = results[0].evidenceRefs?.screenshotRefs?.[0];
  const currentRunRef = results[0].executor?.currentRunRef;
  assert.ok(staleRef);
  assert.ok(currentRunRef);
  const staleDate = new Date(Date.now() - 60_000);
  const currentDate = new Date();
  await utimes(join(process.cwd(), staleRef), staleDate, staleDate);
  await utimes(join(process.cwd(), currentRunRef), currentDate, currentDate);

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.some((issue) => issue.startsWith('stale-evidence-ref:')), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI rejects stale current-run marker replay', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-stale-marker-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');

  const staleMarker = {
    schemaVersion: 'sciforge.model-router.computer-use.current-run.v1',
    runId: 'old-run',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z',
  };
  for (const result of results) {
    assert.ok(result.executor?.currentRunRef);
    await writeFile(join(process.cwd(), result.executor.currentRunRef), JSON.stringify(staleMarker), 'utf8');
  }

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.some((issue) => issue.startsWith('stale-current-run-marker:')), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI rejects evidence not bound to current run and case', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-unbound-evidence-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results, { bindCurrentRunEvidence: false });
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--expected-known-secrets-checked',
        '2',
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.some((issue) => issue.includes('current-run-evidence-binding')), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI rejects symlink-backed workspace evidence refs', async () => {
  const artifactsRoot = join(process.cwd(), 'artifacts', 'test-artifacts');
  await mkdir(artifactsRoot, { recursive: true });
  const workspace = await mkdtemp(join(artifactsRoot, 'cu-live-matrix-symlink-evidence-'));
  const workspaceRef = relative(process.cwd(), workspace).replace(/\\/g, '/');
  const manifestPath = join(workspace, 'input.json');
  const traceAuditReport = join(workspace, 'trace-audit-report.json');
  const results = requiredIds.map((id) => fileBackedResult(id, `${workspaceRef}/runs/current/${id}`));
  await writeEvidenceFilesForResults(results);
  const verifierRef = results[0].evidenceRefs?.verifierRefs?.[0];
  const currentRunRef = results[0].executor?.currentRunRef;
  assert.ok(verifierRef);
  assert.ok(currentRunRef);
  const verifierPath = join(process.cwd(), verifierRef);
  const targetDir = await mkdtemp(join(tmpdir(), 'sciforge-cu-live-matrix-symlink-target-'));
  const targetPath = join(targetDir, 'external-verifier.json');
  await writeFile(targetPath, JSON.stringify({
    schemaVersion: 'sciforge.model-router.computer-use.evidence.v1',
    kind: 'verifier',
    status: 'passed',
    caseId: results[0].caseId,
    runId: testRunIdForCurrentRunRef(currentRunRef),
  }), 'utf8');
  await rm(verifierPath);
  await symlink(targetPath, verifierPath);
  await writeFile(manifestPath, JSON.stringify({ results }), 'utf8');
  await writeFile(traceAuditReport, JSON.stringify(traceAuditForResults(results)), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--trace-audit-report',
        traceAuditReport,
        '--expected-known-secrets-checked',
        '2',
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.some((issue) => issue.startsWith('symlink-evidence-ref:')), manifest.issues.join('\n'));
        assert.equal(manifest.issues.some((issue) => issue.startsWith('missing-evidence-ref:')), false, manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        assert.equal(JSON.stringify(manifest).includes(targetDir), false);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(targetDir, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance CLI strict rejects non-file evidence schemes', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-model-router-cu-live-matrix-'));
  const manifestPath = join(workspace, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    results: requiredIds.map((id) => customSchemeResult(id)),
    traceAudit: traceAuditForCustomScheme(requiredIds),
  }), 'utf8');

  try {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-computer-use-live-acceptance-matrix.ts',
        '--input',
        manifestPath,
        '--strict',
        '--json',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const manifest = JSON.parse(stdout) as ReturnType<typeof buildModelRouterComputerUseLiveAcceptanceMatrixManifest>;
        assert.equal(manifest.status, 'blocked');
        assert.equal(manifest.releaseAcceptance, 'not-evaluated');
        assert.ok(manifest.issues.some((issue) => issue.includes('non-file-evidence-ref')), manifest.issues.join('\n'));
        assert.ok(manifest.issues.some((issue) => issue.includes('non-file-gui-ref')), manifest.issues.join('\n'));
        assert.doesNotMatch(JSON.stringify(manifest), forbiddenRawPayloadPattern);
        return true;
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

function passingResult(
  caseId: typeof requiredIds[number],
): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  const baseRef = `docs/test-artifacts/model-router-computer-use-live-matrix/runs/current/${caseId}`;
  return {
    caseId,
    status: 'passed',
    publicModelAlias: 'sciforge-router',
    routerProfile: 'sciforge-runtime-default',
    routerTraceRefs: [`.sciforge/model-router-traces/current/${caseId}/trace.json`],
    capabilityIds: [
      'model-router.capability.computer-use.planner',
      'model-router.capability.computer-use.screenshot-translator',
      'model-router.capability.computer-use.grounding-translator',
      'model-router.capability.computer-use.verifier-translator',
    ],
    executor: {
      kind: caseId === 'browser-research' ? 'app-window' : 'desktop-native-host',
      currentRunRef: `${baseRef}/current-run.json`,
      executorRef: `${baseRef}/executor.json`,
      appWindowRef: `${baseRef}/app-window.json`,
      sessionRef: `${baseRef}/session.json`,
      nativeHostRef: caseId === 'browser-research' ? undefined : `${baseRef}/native-host.json`,
    },
    evidenceRefs: evidenceRefsFor(caseId, baseRef),
    gui: {
      presentRef: `${baseRef}/gui-present.json`,
    },
  };
}

function customSchemeResult(
  caseId: typeof requiredIds[number],
): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  const baseRef = `evidence:model-router-computer-use-live-matrix/runs/current/${caseId}`;
  return {
    ...passingResult(caseId),
    routerTraceRefs: [`${baseRef}/trace.json`],
    executor: {
      kind: caseId === 'browser-research' ? 'app-window' : 'desktop-native-host',
      currentRunRef: `${baseRef}/current-run.json`,
      executorRef: `${baseRef}/executor.json`,
      appWindowRef: `${baseRef}/app-window.json`,
      sessionRef: `${baseRef}/session.json`,
      nativeHostRef: caseId === 'browser-research' ? undefined : `${baseRef}/native-host.json`,
    },
    evidenceRefs: evidenceRefsFor(caseId, baseRef),
    gui: {
      presentRef: `${baseRef}/gui-present.json`,
    },
  };
}

function fileBackedResult(
  caseId: typeof requiredIds[number],
  baseRef: string,
): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  return {
    ...passingResult(caseId),
    routerTraceRefs: [`${baseRef}/trace.json`],
    executor: {
      kind: caseId === 'browser-research' ? 'app-window' : 'desktop-native-host',
      currentRunRef: `${baseRef}/current-run.json`,
      executorRef: `${baseRef}/executor.json`,
      appWindowRef: `${baseRef}/app-window.json`,
      sessionRef: `${baseRef}/session.json`,
      nativeHostRef: caseId === 'browser-research' ? undefined : `${baseRef}/native-host.json`,
    },
    evidenceRefs: evidenceRefsFor(caseId, baseRef),
    gui: {
      presentRef: `${baseRef}/gui-present.json`,
    },
  };
}

async function writeEvidenceFilesForResults(
  results: ModelRouterComputerUseLiveAcceptanceMatrixResult[],
  options: { bindCurrentRunEvidence?: boolean } = {},
) {
  const bindCurrentRunEvidence = options.bindCurrentRunEvidence ?? true;
  const refs = new Set<string>();
  const currentRunRefs = new Set<string>();
  const startedAt = new Date(Date.now() - 1000).toISOString();
  for (const result of results) {
    for (const ref of [
      ...(result.routerTraceRefs ?? []),
      result.executor?.currentRunRef,
      result.executor?.executorRef,
      result.executor?.appWindowRef,
      result.executor?.sessionRef,
      result.executor?.nativeHostRef,
      ...(result.executor?.refs ?? []),
      ...(result.evidenceRefs?.screenshotRefs ?? []),
      ...(result.evidenceRefs?.fileRefs ?? []),
      ...(result.evidenceRefs?.artifactRefs ?? []),
      ...(result.evidenceRefs?.terminalRefs ?? []),
      ...(result.evidenceRefs?.verifierRefs ?? []),
      ...(result.evidenceRefs?.blockedRefs ?? []),
      ...(result.evidenceRefs?.repairRefs ?? []),
      result.gui?.presentRef,
      result.gui?.blockedRef,
      result.gui?.repairRef,
    ]) {
      if (!ref) continue;
      if (ref.endsWith('/current-run.json')) currentRunRefs.add(ref);
      else refs.add(ref);
    }
  }
  await Promise.all([...refs].map(async (ref) => {
    const path = join(process.cwd(), ref);
    await mkdir(dirname(path), { recursive: true });
    const result = results.find((item) => item.routerTraceRefs?.includes(ref));
    await writeFile(path, JSON.stringify(result ? routerTraceForResult(result) : {}), 'utf8');
  }));
  if (bindCurrentRunEvidence) {
    await writeCurrentRunEvidenceBindings(results);
  }
  const completedAt = new Date(Date.now() + 1000).toISOString();
  await Promise.all([...currentRunRefs].map(async (ref) => {
    const path = join(process.cwd(), ref);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({
      schemaVersion: 'sciforge.model-router.computer-use.current-run.v1',
      runId: testRunIdForCurrentRunRef(ref),
      startedAt,
      completedAt,
    }), 'utf8');
  }));
}

function routerTraceForResult(result: ModelRouterComputerUseLiveAcceptanceMatrixResult) {
  return {
    schemaVersion: 'sciforge.model-router.trace.v1',
    profileId: result.routerProfile,
    publicModelAlias: result.publicModelAlias,
    calls: [
      { role: 'visionTranslator', status: 'ok' },
      { role: 'textReasoner', status: 'ok' },
    ],
  };
}

async function writeCurrentRunEvidenceBindings(results: ModelRouterComputerUseLiveAcceptanceMatrixResult[]) {
  await Promise.all(results.flatMap((result) => {
    const currentRunRef = result.executor?.currentRunRef;
    if (!currentRunRef) return [];
    const runId = testRunIdForCurrentRunRef(currentRunRef);
    const writes: Array<Promise<void>> = [];
    if (result.gui?.presentRef) {
      writes.push(writeEvidenceEnvelope(result.gui.presentRef, {
        schemaVersion: 'sciforge.model-router.computer-use.evidence.v1',
        kind: 'gui.present',
        status: 'present',
        caseId: result.caseId,
        runId,
      }));
    }
    for (const verifierRef of result.evidenceRefs?.verifierRefs ?? []) {
      writes.push(writeEvidenceEnvelope(verifierRef, {
        schemaVersion: 'sciforge.model-router.computer-use.evidence.v1',
        kind: 'verifier',
        status: 'passed',
        caseId: result.caseId,
        runId,
      }));
    }
    return writes;
  }));
}

async function writeEvidenceEnvelope(ref: string, value: unknown) {
  const path = join(process.cwd(), ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value), 'utf8');
}

function testRunIdForCurrentRunRef(ref: string) {
  return `test-run-${createHash('sha256').update(ref).digest('hex').slice(0, 12)}`;
}

function evidenceRefsFor(caseId: typeof requiredIds[number], baseRef: string) {
  const common = {
    screenshotRefs: [`${baseRef}/screenshots/before.png`, `${baseRef}/screenshots/after.png`],
    verifierRefs: [`${baseRef}/verifier.json`],
  };
  if (caseId === 'browser-research') {
    return {
      ...common,
      artifactRefs: [`${baseRef}/research-summary.md`],
    };
  }
  if (caseId === 'docs-sheets-edit') {
    return {
      ...common,
      fileRefs: [`${baseRef}/sheet.xlsx`, `${baseRef}/document.docx`],
      artifactRefs: [`${baseRef}/edit-report.json`],
    };
  }
  if (caseId === 'file-management') {
    return {
      ...common,
      fileRefs: [`${baseRef}/file-index.json`, `${baseRef}/renamed-folder/listing.json`],
    };
  }
  if (caseId === 'ide-terminal') {
    return {
      ...common,
      fileRefs: [`${baseRef}/workspace-diff.patch`],
      terminalRefs: [`${baseRef}/terminal-session.json`],
    };
  }
  return {
    ...common,
    artifactRefs: [`${baseRef}/recovery-report.md`],
    terminalRefs: [`${baseRef}/recovery-terminal.json`],
    verifierRefs: [`${baseRef}/verifier-before.json`, `${baseRef}/verifier-after.json`],
  };
}

function traceAuditFor(caseIds: readonly (typeof requiredIds[number])[]) {
  return {
    schemaVersion: 'sciforge.model-router.trace-audit.v1',
    status: 'pass' as const,
    traceRootSha256: '0'.repeat(64),
    reportRef: 'docs/test-artifacts/model-router-computer-use-live-matrix/trace-audit.json',
    scannedFiles: caseIds.length,
    scannedBytes: caseIds.length * 128,
    scannedFileRefs: caseIds.map((id) => `current/${id}/trace.json`),
    findings: [],
    policy: {
      knownSecretsChecked: 2,
      forbidsRawProviderPayload: true,
      forbidsRawPrivateUrls: true,
      forbidsLocalAbsolutePaths: true,
      forbidsInlineImageData: true,
    },
  };
}

function traceAuditForResults(results: readonly ModelRouterComputerUseLiveAcceptanceMatrixResult[]) {
  return {
    ...traceAuditFor(requiredIds),
    scannedFiles: results.length,
    scannedBytes: results.length * 128,
    scannedFileRefs: results.flatMap((result) => result.routerTraceRefs ?? []),
  };
}

function traceAuditForCustomScheme(caseIds: readonly (typeof requiredIds[number])[]) {
  return {
    ...traceAuditFor(caseIds),
    scannedFileRefs: caseIds.map((id) => `evidence:model-router-computer-use-live-matrix/runs/current/${id}/trace.json`),
  };
}
