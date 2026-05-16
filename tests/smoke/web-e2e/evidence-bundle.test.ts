import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createWebE2eEvidenceBundleManifest,
  writeWebE2eEvidenceBundle,
} from './evidence-bundle.js';
import type { BrowserInstrumentationSnapshot } from './types.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-evidence-test-'));

try {
  const screenshotPath = join(baseDir, 'SA-WEB-17', 'screenshots', 'terminal.png');
  const browserSnapshot: BrowserInstrumentationSnapshot = {
    schemaVersion: 1,
    label: 'SA-WEB-17 terminal',
    capturedAt: '2026-05-16T00:00:00.000Z',
    counts: {
      consoleWarnings: 1,
      consoleErrors: 1,
      pageErrors: 0,
      requestFailures: 1,
      responseFailures: 1,
      screenshots: 1,
      domSnapshots: 0,
      downloads: 0,
    },
    hasFailures: true,
    events: [
      {
        kind: 'console',
        severity: 'warning',
        type: 'warning',
        text: 'recoverable fixture warning',
        timestamp: '2026-05-16T00:00:01.000Z',
        pageLabel: 'terminal',
        location: { url: 'http://127.0.0.1:5173', lineNumber: 42, columnNumber: 7 },
      },
      {
        kind: 'console',
        severity: 'error',
        type: 'error',
        text: 'fixture console error',
        timestamp: '2026-05-16T00:00:02.000Z',
        pageLabel: 'terminal',
      },
      {
        kind: 'requestfailed',
        severity: 'error',
        url: 'http://127.0.0.1:29992/api/agent-server/runs/stream',
        method: 'POST',
        resourceType: 'fetch',
        errorText: 'net::ERR_CONNECTION_REFUSED',
        timestamp: '2026-05-16T00:00:03.000Z',
        pageLabel: 'terminal',
      },
      {
        kind: 'response',
        severity: 'error',
        url: 'http://127.0.0.1:29992/api/agent-server/tools/manifest',
        method: 'GET',
        resourceType: 'fetch',
        status: 503,
        statusText: 'Service Unavailable',
        timestamp: '2026-05-16T00:00:04.000Z',
        pageLabel: 'terminal',
      },
    ],
    evidence: [
      {
        kind: 'screenshot',
        id: 'terminal',
        path: screenshotPath,
        fullPage: true,
        timestamp: '2026-05-16T00:00:05.000Z',
        pageLabel: 'terminal',
        viewport: { width: 1280, height: 720 },
      },
    ],
  };

  const { manifest, manifestPath } = await writeWebE2eEvidenceBundle({
    caseId: 'SA-WEB-17',
    generatedAt: '2026-05-16T00:00:06.000Z',
    artifactRoot: baseDir,
    outputRoot: baseDir,
    runs: [
      {
        runId: 'run-SA-WEB-17-a',
        eventIds: ['event-start', 'event-final', 'event-final'],
        requestDigest: 'sha256:request-a',
        resultDigest: 'sha256:result-a',
        status: 'failed',
      },
      {
        runId: 'run-SA-WEB-17-b',
        eventIds: ['event-repair'],
        requestDigest: 'sha256:request-b',
        resultDigest: 'sha256:result-b',
        status: 'completed',
      },
    ],
    projection: {
      projectionVersion: 'sciforge.conversation-projection.v1',
      projectionDigest: 'sha256:projection',
      terminalState: 'repair-needed',
    },
    browser: browserSnapshot,
    note: {
      status: 'improvement-needed',
      summary: 'Fixture records a recoverable browser failure and repair path.',
      improvement: 'Surface the provider unavailable message before retrying the run.',
    },
    extra: {
      expectedProjectionRef: '.sciforge/expected-projection.json',
    },
  });

  assert.equal(manifestPath, join(baseDir, 'SA-WEB-17', 'manifest.json'));
  assert.equal(manifest.schemaVersion, 'sciforge.web-e2e.evidence-bundle.v1');
  assert.deepEqual(manifest.runIds, ['run-SA-WEB-17-a', 'run-SA-WEB-17-b']);
  assert.deepEqual(manifest.eventIds, ['event-start', 'event-final', 'event-repair']);
  assert.equal(manifest.projectionVersion, 'sciforge.conversation-projection.v1');
  assert.equal(manifest.screenshots[0]?.relativePath, join('SA-WEB-17', 'screenshots', 'terminal.png'));
  assert.equal(manifest.consoleLogs.length, 2);
  assert.equal(manifest.networkSummaries.length, 2);
  assert.equal(manifest.networkSummaries[0]?.kind, 'requestfailed');
  assert.equal(manifest.networkSummaries[1]?.status, 503);
  assert.equal(manifest.instrumentation?.counts.consoleErrors, 1);
  assert.equal(manifest.note.status, 'improvement-needed');
  assert.equal(manifest.note.improvement, 'Surface the provider unavailable message before retrying the run.');

  const persisted = JSON.parse(await readFile(manifestPath, 'utf8')) as typeof manifest;
  assert.deepEqual(persisted, manifest);

  assert.throws(
    () => createWebE2eEvidenceBundleManifest({
      caseId: 'SA-WEB-17-failed-note',
      runs: [{ runId: 'run-failed', eventIds: ['event-failed'] }],
      projection: { projectionVersion: 'sciforge.conversation-projection.v1' },
      note: { status: 'failed', summary: 'failed without a reason' },
    }),
    /failed note requires failureReason/,
  );

  assert.throws(
    () => createWebE2eEvidenceBundleManifest({
      caseId: 'SA-WEB-17-no-events',
      runs: [{ runId: 'run-without-events', eventIds: [] }],
      projection: { projectionVersion: 'sciforge.conversation-projection.v1' },
      note: { status: 'passed', summary: 'missing event ids should fail' },
    }),
    /requires event ids/,
  );
} finally {
  await rm(baseDir, { recursive: true, force: true });
}

console.log('[ok] SA-WEB-17 evidence bundle writes per-case manifest with runs, events, Projection, screenshots, logs, network summaries, and note');
