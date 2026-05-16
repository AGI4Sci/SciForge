import assert from 'node:assert/strict';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { JsonRecord } from '../types.js';
import {
  writeWebE2eEvidenceBundle,
  type WebE2eEvidenceBundleManifest,
} from '../evidence-bundle.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import {
  assertEvidenceBundleScrubbed,
  scrubEvidenceBundle,
  type SecretScrubberFinding,
} from '../secret-scrubber.js';
import type { WebE2eFixtureWorkspace } from '../types.js';

export const AUDIT_EXPORT_CASE_ID = 'SA-WEB-10';

export interface AuditExportCaseResult {
  fixture: WebE2eFixtureWorkspace;
  manifest: WebE2eEvidenceBundleManifest;
  manifestPath: string;
  scrubFindings: SecretScrubberFinding[];
}

const providerToken = 'sk-SA-WEB-10-do-not-export';

export async function runAuditExportCase(outputRoot?: string): Promise<AuditExportCaseResult> {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: AUDIT_EXPORT_CASE_ID,
    now: '2026-05-16T00:00:00.000Z',
    title: 'Audit export Web E2E case',
    prompt: 'Export the complete audit bundle without rerunning the task.',
  });
  const unsafeManifest = await createUnsafeAuditExportManifest(fixture, outputRoot);
  const scrubbed = scrubEvidenceBundle(unsafeManifest.manifest, { knownSecrets: [providerToken] });
  assertAuditExportBundle(scrubbed.bundle, fixture);
  assertEvidenceBundleScrubbed(scrubbed.bundle, { knownSecrets: [providerToken] });
  return {
    fixture,
    manifest: scrubbed.bundle as WebE2eEvidenceBundleManifest,
    manifestPath: unsafeManifest.manifestPath,
    scrubFindings: scrubbed.findings,
  };
}

export function assertAuditExportBundle(bundle: unknown, fixture: WebE2eFixtureWorkspace): void {
  assert.ok(bundle && typeof bundle === 'object' && !Array.isArray(bundle), 'audit export must be a JSON object');
  const manifest = bundle as WebE2eEvidenceBundleManifest & { extra?: JsonRecord };
  assert.equal(manifest.schemaVersion, 'sciforge.web-e2e.evidence-bundle.v1');
  assert.equal(manifest.caseId, AUDIT_EXPORT_CASE_ID);
  assert.ok(manifest.runIds.includes(fixture.runId), 'audit export must include run ids');
  assert.ok(manifest.eventIds.includes('ledger:user-turn'), 'audit export must include ledger events');
  assert.ok(manifest.eventIds.includes('ledger:run-terminal'), 'audit export must include terminal ledger event');
  assert.equal(manifest.projectionVersion, 'sciforge.conversation-projection.v1');
  assert.equal(manifest.projection.projectionDigest, digestJson(fixture.expectedProjection.conversationProjection));

  const extra = manifest.extra ?? {};
  assert.ok(isJsonRecord(extra.ledger), 'audit export must include ledger events');
  assert.ok(isJsonRecord(extra.conversationProjection), 'audit export must include Projection');
  assert.ok(isJsonRecord(extra.runAudit), 'audit export must include RunAudit');
  assert.ok(isJsonRecord(extra.contextSnapshot), 'audit export must include context snapshot');
  assert.ok(isJsonRecord(extra.refsManifest), 'audit export must include refs manifest');
  assert.ok(isJsonRecord(extra.failureEvidence), 'audit export must include failure evidence');
  assert.ok(isJsonRecord(extra.degradedEvidence), 'audit export must include degraded evidence');
  assert.ok(isJsonRecord(extra.tombstoneEvidence), 'audit export must include tombstone evidence');
}

async function createUnsafeAuditExportManifest(fixture: WebE2eFixtureWorkspace, outputRoot?: string) {
  return await writeWebE2eEvidenceBundle({
    caseId: AUDIT_EXPORT_CASE_ID,
    generatedAt: '2026-05-16T00:00:01.000Z',
    outputRoot,
    runs: [{
      runId: fixture.runId,
      eventIds: ['ledger:user-turn', 'ledger:provider-route', 'ledger:run-terminal'],
      requestDigest: digestJson({ prompt: 'export audit bundle' }),
      resultDigest: digestJson(fixture.expectedProjection),
      status: 'completed',
    }],
    projection: {
      projectionVersion: fixture.expectedProjection.projectionVersion,
      projectionDigest: digestJson(fixture.expectedProjection.conversationProjection),
      terminalState: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
    },
    note: {
      status: 'passed',
      summary: 'Audit export includes contract evidence while scrubbing provider secrets.',
    },
    extra: auditExtra(fixture),
  });
}

function auditExtra(fixture: WebE2eFixtureWorkspace): JsonRecord {
  return {
    ledger: {
      schemaVersion: 'sciforge.web-e2e.ledger-events.v1',
      events: [
        { id: 'ledger:user-turn', type: 'user-turn', ref: fixture.expectedProjection.currentTask.currentTurnRef.ref },
        { id: 'ledger:run-terminal', type: 'run-terminal', runId: fixture.runId },
      ],
    },
    conversationProjection: fixture.expectedProjection.conversationProjection as unknown as JsonRecord,
    runAudit: {
      runId: fixture.runId,
      refs: fixture.expectedProjection.runAuditRefs,
      failureSignature: 'sha256:fixture-failure-signature',
    },
    contextSnapshot: {
      currentTurnRef: fixture.expectedProjection.currentTask.currentTurnRef.ref,
      explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref),
      boundedRefCount: fixture.initialRefs.length,
    },
    refsManifest: {
      refs: fixture.initialRefs.map((ref) => ({ ref: ref.ref, source: ref.source, digest: ref.digest ?? digestJson(ref) })),
    },
    tombstoneEvidence: {
      tombstones: [{ ref: 'artifact:stale-diagnostic', reason: 'superseded-by-terminal-projection' }],
    },
    degradedEvidence: {
      packets: [{ ref: 'degraded:agentserver-context', reason: 'context-api-unavailable', refsOnly: true }],
    },
    failureEvidence: {
      failures: [{ ref: 'failure:empty-provider-result', class: 'empty-result', recoverable: true }],
    },
    networkCapture: {
      requestHeaders: {
        authorization: `Bearer ${providerToken}`,
      },
    },
    providerRoute: {
      providerId: 'sciforge.web-worker.web_search',
      routeDigest: 'sha256:public-route',
      endpoint: 'https://worker.internal.example.test/invoke',
      auth: `Bearer ${providerToken}`,
      workspaceRoot: '/Users/research/.secrets/sciforge',
    },
  };
}

export async function readAuditExportManifest(path: string): Promise<WebE2eEvidenceBundleManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as WebE2eEvidenceBundleManifest;
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
