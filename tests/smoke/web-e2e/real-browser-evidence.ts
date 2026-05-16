import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

export type RealBrowserEvidenceCategory =
  | 'projection-restore'
  | 'artifact-selection'
  | 'audit-boundary'
  | 'provider-tool-latency'
  | 'golden-path';

export type RealBrowserEvidenceRecord = {
  id?: string;
  category?: RealBrowserEvidenceCategory;
  mode?: string;
  url?: string;
  sessionId?: string;
  runId?: string;
  prompt?: string;
  selectedRefs?: string[];
  requestSummary?: string;
  domEvidence?: string[];
  consoleSummary?: string;
  networkSummary?: string;
  timing?: Record<string, unknown>;
  TaskSuccess?: boolean;
  AnswerQuality?: 'accurate' | 'partial' | 'inaccurate' | 'diagnostic-only' | 'unknown';
  MultiturnContinuity?: boolean;
  ProjectionWaitAtTerminal?: number;
  RawLeak?: boolean;
  goldenPathReleaseBlocker?: boolean;
  diagnosticOnly?: boolean;
  terminalStatus?: string;
  screenshotPaths?: string[];
  domSnapshotPaths?: string[];
};

export type RealBrowserEvidenceManifest = {
  schemaVersion?: string;
  source?: string;
  generatedAt?: string;
  records?: RealBrowserEvidenceRecord[];
};

export const defaultRealBrowserEvidenceManifestPath = resolve(
  process.cwd(),
  'tests',
  'fixtures',
  'real-browser-evidence',
  'manifest.json',
);

const requiredCategories: RealBrowserEvidenceCategory[] = [
  'projection-restore',
  'artifact-selection',
  'provider-tool-latency',
  'golden-path',
];

export async function readRealBrowserEvidenceManifest(
  manifestPath = defaultRealBrowserEvidenceManifestPath,
): Promise<RealBrowserEvidenceManifest> {
  return JSON.parse(await readFile(manifestPath, 'utf8')) as RealBrowserEvidenceManifest;
}

export async function assertRealBrowserEvidenceManifest(
  manifest: RealBrowserEvidenceManifest,
  options: { manifestPath?: string; requireFiles?: boolean } = {},
): Promise<void> {
  assert.equal(manifest.schemaVersion, 'sciforge.real-browser-evidence.v1', 'real browser evidence schema');
  assert.equal(manifest.source, 'codex-in-app-browser', 'real browser evidence source');
  assert.ok(manifest.generatedAt, 'real browser evidence generatedAt is required');
  const records = manifest.records ?? [];
  assert.ok(records.length >= 3, 'real browser evidence requires at least three records');

  for (const category of requiredCategories) {
    assert.ok(records.some((record) => record.category === category), `real browser evidence missing ${category}`);
  }
  assert.ok(
    records.some((record) => isValidGoldenPathReleaseBlocker(record)),
    'real browser evidence requires one accurate golden path release blocker record',
  );

  for (const record of records) {
    assert.ok(record.id?.trim(), 'real browser evidence record id is required');
    assert.ok(record.mode === 'real-in-app-browser', `${record.id}: mode must be real-in-app-browser`);
    assert.ok(record.url?.startsWith('http://127.0.0.1:'), `${record.id}: localhost URL is required`);
    assert.ok(record.sessionId?.trim(), `${record.id}: sessionId is required`);
    assert.ok(record.runId?.trim(), `${record.id}: runId is required`);
    assert.ok(record.prompt?.trim(), `${record.id}: prompt is required`);
    assert.ok(record.requestSummary?.trim(), `${record.id}: requestSummary is required`);
    assert.ok((record.domEvidence ?? []).length > 0, `${record.id}: DOM evidence is required`);
    assert.ok(typeof record.consoleSummary === 'string', `${record.id}: console summary is required`);
    assert.ok(typeof record.networkSummary === 'string', `${record.id}: network summary is required`);
    assert.ok(record.timing && typeof record.timing === 'object', `${record.id}: timing is required`);
    assert.equal(record.TaskSuccess, true, `${record.id}: TaskSuccess must be true`);
    assert.equal(record.AnswerQuality, 'accurate', `${record.id}: AnswerQuality must be accurate`);
    assert.equal(typeof record.MultiturnContinuity, 'boolean', `${record.id}: MultiturnContinuity is required`);
    assert.equal(record.ProjectionWaitAtTerminal, 0, `${record.id}: ProjectionWaitAtTerminal must be 0`);
    assert.equal(record.RawLeak, false, `${record.id}: RawLeak must be false`);
    assert.ok((record.screenshotPaths ?? []).length > 0, `${record.id}: screenshot evidence is required`);
    assert.ok((record.domSnapshotPaths ?? []).length > 0, `${record.id}: DOM snapshot evidence is required`);
    if (record.category === 'artifact-selection') {
      assert.ok((record.selectedRefs ?? []).length > 0, `${record.id}: selected refs are required`);
    }
    if (record.goldenPathReleaseBlocker === true) {
      assert.ok(isValidGoldenPathReleaseBlocker(record), `${record.id}: golden path release blocker must be an accurate successful golden-path record`);
    }
  }

  if (options.requireFiles) {
    await assertEvidenceFilesExist(records, options.manifestPath ?? defaultRealBrowserEvidenceManifestPath);
  }
}

function isValidGoldenPathReleaseBlocker(record: RealBrowserEvidenceRecord) {
  return record.goldenPathReleaseBlocker === true
    && record.category === 'golden-path'
    && record.TaskSuccess === true
    && record.AnswerQuality === 'accurate'
    && record.MultiturnContinuity === true
    && record.ProjectionWaitAtTerminal === 0
    && record.RawLeak === false
    && record.diagnosticOnly !== true
    && !['failed', 'failed-with-reason', 'repair-needed', 'needs-human', 'diagnostic-only'].includes(String(record.terminalStatus || '').toLowerCase());
}

async function assertEvidenceFilesExist(records: RealBrowserEvidenceRecord[], manifestPath: string): Promise<void> {
  const root = process.cwd();
  for (const record of records) {
    for (const filePath of [...record.screenshotPaths ?? [], ...record.domSnapshotPaths ?? []]) {
      const resolved = isAbsolute(filePath) ? filePath : resolve(root, filePath);
      await access(resolved);
    }
  }
}
