import assert from 'node:assert/strict';

import {
  assertEvidenceBundleScrubbed,
  scrubEvidenceBundle,
} from './secret-scrubber.js';

const providerToken = 'sk-provider-token-SA-WEB-25-do-not-export';
const secretPath = '/Users/research/.secrets/sciforge/provider-token.txt';
const authHeader = `Bearer ${providerToken}`;

const evidenceBundle = {
  schemaVersion: 'sciforge.web-e2e.evidence-bundle.v1',
  caseId: 'SA-WEB-25',
  runIds: ['run-secret-scrubber'],
  routeDecision: {
    providerId: 'sciforge.web-worker.web_search',
    routeDigest: 'sha256:route-decision',
    digest: 'sha256:public-route-record',
    healthSummary: 'available',
    permissionSummary: 'read-only web search allowed',
    endpoint: 'https://worker.internal.example.test/invoke',
    baseUrl: 'https://worker.internal.example.test',
    invokeUrl: 'https://worker.internal.example.test/invoke?token=hidden',
    workerId: 'worker-internal-01',
    workspaceRoot: '/Users/research/.secrets/sciforge',
    auth: {
      Authorization: authHeader,
    },
  },
  networkSummaries: [
    {
      url: 'https://app.local/run',
      requestHeaders: {
        authorization: authHeader,
      },
    },
  ],
  consoleLogs: [
    `curl -H "Authorization: Bearer ${providerToken}" https://worker.internal.example.test/invoke`,
    `loaded credential path ${secretPath}`,
  ],
  refsManifest: [
    {
      ref: 'artifact:run-audit',
      digest: 'sha256:run-audit',
      summary: 'audit-safe run summary only',
    },
  ],
  audit: {
    providerToken,
    secretPath,
  },
};

const scrubbed = scrubEvidenceBundle(evidenceBundle, { knownSecrets: [providerToken] });
const scrubbedJson = JSON.stringify(scrubbed.bundle);

assert.match(scrubbedJson, /sciforge\.web-worker\.web_search/);
assert.match(scrubbedJson, /sha256:route-decision/);
assert.match(scrubbedJson, /audit-safe run summary only/);
assert.doesNotMatch(scrubbedJson, new RegExp(escapeRegExp(providerToken)));
assert.doesNotMatch(scrubbedJson, new RegExp(escapeRegExp(secretPath)));
assert.doesNotMatch(scrubbedJson, /Authorization: Bearer/i);
assert.doesNotMatch(scrubbedJson, /worker\.internal\.example\.test/);
assert.doesNotMatch(scrubbedJson, /worker-internal-01/);
assert.doesNotMatch(scrubbedJson, /workspaceRoot/);
assert.doesNotMatch(scrubbedJson, /endpoint/);
assert.doesNotMatch(scrubbedJson, /baseUrl/);
assert.doesNotMatch(scrubbedJson, /invokeUrl/);
assert.ok(scrubbed.findings.some((finding) => finding.kind === 'provider-token' && finding.path === '$.audit.providerToken'));
assert.ok(scrubbed.findings.some((finding) => finding.kind === 'raw-auth-header'));
assert.ok(scrubbed.findings.some((finding) => finding.kind === 'absolute-secret-path'));
assert.ok(scrubbed.findings.some((finding) => finding.kind === 'unsafe-provider-route-field'));
assert.ok(scrubbed.findings.every((finding) => finding.digest.startsWith('sha256:')));
assert.ok(scrubbed.findings.every((finding) => !finding.summary.includes(providerToken)));

assert.doesNotThrow(() => assertEvidenceBundleScrubbed(scrubbed.bundle, { knownSecrets: [providerToken] }));
assert.throws(
  () => assertEvidenceBundleScrubbed(evidenceBundle, { knownSecrets: [providerToken] }),
  /unsanitized secret material/,
);

console.log('[ok] SA-WEB-25 secret scrubber removes provider tokens, secret paths, raw auth headers, and internal route fields from evidence bundles');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
