import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertRealBrowserEvidenceManifest,
  readRealBrowserEvidenceManifest,
} from './real-browser-evidence.js';

test('real in-app browser evidence manifest blocks fixture-only final gates', async () => {
  const manifest = await readRealBrowserEvidenceManifest();
  await assertRealBrowserEvidenceManifest(manifest, { requireFiles: true });
});

test('real in-app browser evidence manifest rejects missing required categories', async () => {
  const manifest = await readRealBrowserEvidenceManifest();
  const withoutProviderLatency = {
    ...manifest,
    records: (manifest.records ?? []).filter((record) => record.category !== 'provider-tool-latency'),
  };

  await assert.rejects(
    () => assertRealBrowserEvidenceManifest(withoutProviderLatency),
    /provider-tool-latency/,
  );
});

test('real in-app browser evidence manifest rejects raw leaks and Projection waits', async () => {
  const manifest = await readRealBrowserEvidenceManifest();
  assert.ok(manifest.records?.[0], 'fixture manifest must have at least one record');
  const leaky = {
    ...manifest,
    records: [
      {
        ...manifest.records[0],
        ProjectionWaitAtTerminal: 1,
        RawLeak: true,
      },
      ...manifest.records.slice(1),
    ],
  };

  await assert.rejects(
    () => assertRealBrowserEvidenceManifest(leaky),
    /ProjectionWaitAtTerminal/,
  );
});

test('real in-app browser evidence manifest rejects non-accurate golden path blockers', async () => {
  const manifest = await readRealBrowserEvidenceManifest();
  const downgraded = {
    ...manifest,
    records: (manifest.records ?? []).map((record) => record.goldenPathReleaseBlocker
      ? { ...record, AnswerQuality: 'partial' as const }
      : record),
  };

  await assert.rejects(
    () => assertRealBrowserEvidenceManifest(downgraded),
    /accurate golden path release blocker|AnswerQuality must be accurate/,
  );
});

test('real in-app browser evidence manifest rejects diagnostic-only golden path blockers', async () => {
  const manifest = await readRealBrowserEvidenceManifest();
  const diagnosticOnly = {
    ...manifest,
    records: (manifest.records ?? []).map((record) => record.goldenPathReleaseBlocker
      ? { ...record, diagnosticOnly: true, terminalStatus: 'repair-needed' }
      : record),
  };

  await assert.rejects(
    () => assertRealBrowserEvidenceManifest(diagnosticOnly),
    /golden path release blocker must be an accurate successful golden-path record|accurate golden path release blocker/,
  );
});

test('real in-app browser evidence manifest rejects TaskSuccess=false records', async () => {
  const manifest = await readRealBrowserEvidenceManifest();
  assert.ok(manifest.records?.[0], 'fixture manifest must have at least one record');
  const unsuccessful = {
    ...manifest,
    records: [
      {
        ...manifest.records[0],
        TaskSuccess: false,
        AnswerQuality: 'accurate' as const,
      },
      ...manifest.records.slice(1),
    ],
  };

  await assert.rejects(
    () => assertRealBrowserEvidenceManifest(unsuccessful),
    /TaskSuccess must be true/,
  );
});
