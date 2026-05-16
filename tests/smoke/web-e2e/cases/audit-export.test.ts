import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  AUDIT_EXPORT_CASE_ID,
  assertAuditExportBundle,
  readAuditExportManifest,
  runAuditExportCase,
} from './audit-export.js';

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-audit-export-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-10 exports audit bundle with ledger Projection RunAudit context refs and scrubbed secrets', async () => {
  const result = await runAuditExportCase(baseDir);

  assert.equal(result.manifest.caseId, AUDIT_EXPORT_CASE_ID);
  assertAuditExportBundle(result.manifest, result.fixture);
  assert.ok(result.scrubFindings.some((finding) => finding.kind === 'raw-auth-header'));
  assert.ok(result.scrubFindings.some((finding) => finding.kind === 'unsafe-provider-route-field'));

  const unsafePersisted = await readAuditExportManifest(result.manifestPath);
  assert.match(JSON.stringify(unsafePersisted), /worker\.internal\.example\.test/);
  assert.doesNotMatch(JSON.stringify(result.manifest), /worker\.internal\.example\.test/);
  assert.doesNotMatch(JSON.stringify(result.manifest), /sk-SA-WEB-10-do-not-export/);
  assert.doesNotMatch(JSON.stringify(result.manifest), /\\.secrets\\/);
});

test('SA-WEB-10 fails focused audit export verification when required evidence sections are missing', async () => {
  const result = await runAuditExportCase(baseDir);
  const broken = structuredClone(result.manifest);
  if (broken.extra) delete broken.extra.runAudit;

  assert.throws(
    () => assertAuditExportBundle(broken, result.fixture),
    /RunAudit/,
  );
});
