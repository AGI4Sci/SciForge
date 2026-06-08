import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION,
  runBrowserRuntimeLiveDownloadChain,
  validateBrowserRuntimeLiveDownloadChainManifest,
} from '../../tools/smoke-browser-runtime-live-download-chain.js';

test('browser runtime live download diagnostic writes blocked manifest without opt-in env', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-runtime-live-chain-'));
  const out = join(workspacePath, 'manifest.json');
  try {
    const manifest = await runBrowserRuntimeLiveDownloadChain({
      env: {},
      out,
      workspacePath,
      now: () => new Date('2026-06-08T00:00:00.000Z'),
    });
    const written = JSON.parse(await readFile(out, 'utf8'));

    assert.equal(manifest.schemaVersion, BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION);
    assert.equal(written.schemaVersion, BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION);
    assert.equal(written.status, 'blocked');
    assert.equal(written.diagnosticOnly, true);
    assert.equal(written.releaseProof, false);
    assert.equal(written.productProof, false);
    assert.equal(written.requireEnv, 'SCIFORGE_REQUIRE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN=1');
    assert.deepEqual(written.primitiveChain, ['browser.search', 'browser.navigate', 'browser.read', 'browser.extract', 'browser.download']);
    assert.equal(validateBrowserRuntimeLiveDownloadChainManifest(written).valid, true);
    assert.doesNotMatch(JSON.stringify(written), /"bytes"\s*:|"byteLength"\s*:|data:|base64|\/Applications\/|\/Users\/|\/private\/|\/tmp\//i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('browser runtime live download diagnostic schema requires bounded download refs when passed', () => {
  const manifest = {
    schemaVersion: BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION,
    status: 'passed',
    diagnosticOnly: true,
    releaseProof: false,
    productProof: false,
    checkedAt: '2026-06-08T00:00:00.000Z',
    requireEnv: 'SCIFORGE_REQUIRE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN=1',
    primitiveChain: ['browser.search', 'browser.navigate', 'browser.read', 'browser.extract', 'browser.download'],
    currentRun: {
      searchResultRef: 'browser-host-session:live/search-results.json',
      sourcePageRef: 'browser-host-session:live/source-pages/source-1.source.json',
      pageTextRef: 'browser-host-session:live/source-pages/source-1.txt',
      downloadRef: 'browser-host-session:live/downloads/abc-data.csv',
      downloadSha256: 'a'.repeat(64),
      downloadSize: 42,
      downloadMimeType: 'text/csv',
      csvDownloadRef: 'browser-host-session:live/downloads/abc-data.csv',
      csvDownloadSha256: 'a'.repeat(64),
      csvDownloadSize: 42,
      csvDownloadMimeType: 'text/csv',
      pdfDownloadRef: 'browser-host-session:live/downloads/def-paper.pdf',
      pdfDownloadSha256: 'b'.repeat(64),
      pdfDownloadSize: 13264,
      pdfDownloadMimeType: 'application/pdf',
      negativeDownloadChecks: [
        {
          caseId: 'csv-overbudget',
          status: 'blocked',
          blockedReason: 'download_content_length_exceeds_budget',
          refsCount: 0,
          artifactRefPresent: false,
        },
        {
          caseId: 'csv-domain-not-allowed',
          status: 'blocked',
          blockedReason: 'download_domain_not_allowed',
          refsCount: 0,
          artifactRefPresent: false,
        },
      ],
      negativeReadChecks: [
        {
          caseId: 'pdf-source-read',
          status: 'blocked',
          blockedReason: 'source_page_read_failed',
          refsCount: 8,
          outputPresent: false,
          diagnosticCodes: ['source-page-read-failed'],
        },
        {
          caseId: 'auth-wall-http-status-source-read',
          status: 'blocked',
          blockedReason: 'source_page_read_failed',
          refsCount: 8,
          outputPresent: false,
          diagnosticCodes: ['source-page-read-failed'],
        },
        {
          caseId: 'forbidden-http-status-source-read',
          status: 'blocked',
          blockedReason: 'source_page_read_failed',
          refsCount: 8,
          outputPresent: false,
          diagnosticCodes: ['source-page-read-failed'],
        },
        {
          caseId: 'network-source-read',
          status: 'blocked',
          blockedReason: 'source_page_read_failed',
          refsCount: 8,
          outputPresent: false,
          diagnosticCodes: ['source-page-read-failed'],
        },
      ],
      traceIntents: ['browser.search', 'browser.navigate', 'browser.read', 'browser.extract', 'browser.download'],
    },
    policyScan: {
      inlineBinaryPayloads: false,
      opaqueEncodedPayloads: false,
      localPaths: false,
    },
  };

  assert.equal(validateBrowserRuntimeLiveDownloadChainManifest(manifest).valid, true);
  assert.equal(validateBrowserRuntimeLiveDownloadChainManifest({
    ...manifest,
    currentRun: { ...manifest.currentRun, downloadRef: '/tmp/data.csv' },
  }).valid, false);
});
