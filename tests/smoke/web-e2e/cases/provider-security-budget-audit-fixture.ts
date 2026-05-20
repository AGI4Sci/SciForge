import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  assertEvidenceBundleScrubbed,
  scrubEvidenceBundle,
} from '../secret-scrubber.js';
import type { JsonRecord, JsonValue } from '../types.js';

export const PROVIDER_SECURITY_BUDGET_AUDIT_CASE_ID = 'SA-WEB-38-provider-security-budget-audit-fixture';

export const PROVIDER_SECURITY_REQUIREMENT_IDS = [
  'R-BUDGET-01',
  'R-SEC-01',
  'R-AUDIT-01',
  'R-FAIL-01',
] as const;

export interface ProviderSecurityBudgetAuditFixture {
  caseId: string;
  requirementIds: readonly string[];
  fixtureScope: 'offline-fixture-only';
  livePass: false;
  transparency: ProviderTransparency;
  failedRun: ProviderRunRecord;
  recoveredRun: ProviderRunRecord;
  visibleState: ProviderSecurityVisibleState;
  rawEvidenceBundle: JsonRecord;
  scrubbedAuditBundle: JsonRecord;
  scrubFindings: readonly JsonRecord[];
}

interface ProviderTransparency {
  provider: 'sciforge-deepseek-proxy';
  model: 'bailian/deepseek-v4-flash';
  profile: 'sciforge-runtime-deepseek';
  workspace: string;
  commandId: string;
  contactedOpenAI: false;
  fallbackPolicy: 'fail-closed-without-explicit-openai-opt-in';
  fallbackAttempts: readonly ProviderFallbackAttempt[];
}

interface ProviderFallbackAttempt {
  provider: string;
  allowed: boolean;
  reason: string;
}

interface ProviderRunRecord {
  runId: string;
  commandId: string;
  status: 'repair-needed' | 'completed';
  providerStatus: 'outage' | 'recovered';
  outputRef: string;
  outputDigest: string;
  auditRefs: readonly string[];
  evidenceRefs: readonly string[];
  visibleSummary: string;
}

interface ProviderSecurityVisibleState {
  status: 'repair-needed';
  visibleAnswerText: string;
  recoveryAnswerText: string;
  auditRefs: readonly string[];
  foregroundRawStreamRefs: readonly string[];
}

const runtimeProfile = 'sciforge-runtime-deepseek';
const runtimeModel = 'bailian/deepseek-v4-flash';
const runtimeProvider = 'sciforge-deepseek-proxy';
const failedRunId = 'run-sa-web-38-provider-502';
const recoveredRunId = 'run-sa-web-38-provider-recovered';
const commandId = 'cmd-sa-web-38-runtime-codex';
const workspace = '/fixture/workspaces/provider-security-budget-audit';
const providerToken = 'sk-provider-fixture-SA-WEB-38-do-not-leak';
const rawUpstreamHtml = '<html><body>502 upstream challenge token_endpoint=https://deepseek.internal/token</body></html>';
const rawSse = `event: error\ndata: {"error":"bad_gateway","authorization":"Bearer ${providerToken}"}\n\n`;
const rawStderr = `provider 502 Authorization: Bearer ${providerToken} config=/fixture/.secrets/provider-token.txt`;

export function createProviderSecurityBudgetAuditFixture(): ProviderSecurityBudgetAuditFixture {
  const failedOutputDigest = digestJson({
    runId: failedRunId,
    status: 'repair-needed',
    rawUpstreamHtml,
    rawSse,
    rawStderr,
  });
  const recoveredOutputDigest = digestJson({
    runId: recoveredRunId,
    status: 'completed',
    source: 'fresh-provider-response-after-config-recovery',
    excludedFailedOutputDigest: failedOutputDigest,
  });

  const failedRun: ProviderRunRecord = {
    runId: failedRunId,
    commandId,
    status: 'repair-needed',
    providerStatus: 'outage',
    outputRef: 'audit://sa-web-38/failed/raw-jsonl.scrubbed.jsonl',
    outputDigest: failedOutputDigest,
    auditRefs: [
      'audit://sa-web-38/manifest.json',
      'audit://sa-web-38/raw-jsonl.scrubbed.jsonl',
      'audit://sa-web-38/stderr.scrubbed.log',
      'audit://sa-web-38/normalized-events.jsonl',
      'failure:sa-web-38-provider-502',
    ],
    evidenceRefs: [
      'event:sa-web-38-provider-outage',
      'event:sa-web-38-repair-needed',
      'provider-manifest:sciforge-runtime-deepseek',
    ],
    visibleSummary: 'DeepSeek provider proxy returned 502; run is repair-needed with scrubbed audit refs.',
  };

  const recoveredRun: ProviderRunRecord = {
    runId: recoveredRunId,
    commandId: 'cmd-sa-web-38-runtime-codex-retry',
    status: 'completed',
    providerStatus: 'recovered',
    outputRef: 'artifact://sa-web-38/recovered-provider-result.json',
    outputDigest: recoveredOutputDigest,
    auditRefs: [
      'audit://sa-web-38/retry-manifest.json',
      'audit://sa-web-38/retry-normalized-events.jsonl',
      'provider-manifest:sciforge-runtime-deepseek',
    ],
    evidenceRefs: [
      'event:sa-web-38-provider-recovered',
      'event:sa-web-38-fresh-dispatch',
      'artifact://sa-web-38/recovered-provider-result.json',
    ],
    visibleSummary: 'Provider recovered after config retry; success evidence is a fresh dispatch output.',
  };

  const transparency: ProviderTransparency = {
    provider: runtimeProvider,
    model: runtimeModel,
    profile: runtimeProfile,
    workspace,
    commandId,
    contactedOpenAI: false,
    fallbackPolicy: 'fail-closed-without-explicit-openai-opt-in',
    fallbackAttempts: [{
      provider: 'openai',
      allowed: false,
      reason: 'OpenAI fallback requires explicit user opt-in and must never be silent.',
    }],
  };

  const rawEvidenceBundle: JsonRecord = {
    schemaVersion: 'sciforge.provider-security-budget-audit-fixture.raw.v1',
    caseId: PROVIDER_SECURITY_BUDGET_AUDIT_CASE_ID,
    requirementIds: [...PROVIDER_SECURITY_REQUIREMENT_IDS],
    livePass: false,
    transparency: {
      ...transparency,
      route: {
        providerId: runtimeProvider,
        routeDigest: digestJson({ runtimeProvider, runtimeProfile }),
        endpoint: 'https://deepseek.internal.example.test/v1/responses',
        baseUrl: 'https://deepseek.internal.example.test',
        invokeUrl: `https://deepseek.internal.example.test/v1/responses?token=${providerToken}`,
        workerId: 'runtime-codex-sidecar-01',
        workspaceRoot: '/fixture/.secrets/provider-workspace',
        auth: { Authorization: `Bearer ${providerToken}` },
      },
    } as unknown as JsonRecord,
    failedRun: failedRun as unknown as JsonRecord,
    recoveredRun: recoveredRun as unknown as JsonRecord,
    rawStreams: {
      stderr: rawStderr,
      providerSse: rawSse,
      upstreamHtml: rawUpstreamHtml,
      diagnosticSecretPath: '/fixture/.secrets/provider-token.txt',
    },
    auditManifest: auditManifest(failedRun, recoveredRun, failedOutputDigest),
  };
  const scrubbed = scrubEvidenceBundle(rawEvidenceBundle, {
    knownSecrets: [
      providerToken,
      rawUpstreamHtml,
      'token_endpoint=https://deepseek.internal/token',
    ],
  });
  const scrubbedAuditBundle = scrubbed.bundle as JsonRecord;

  return {
    caseId: PROVIDER_SECURITY_BUDGET_AUDIT_CASE_ID,
    requirementIds: PROVIDER_SECURITY_REQUIREMENT_IDS,
    fixtureScope: 'offline-fixture-only',
    livePass: false,
    transparency,
    failedRun,
    recoveredRun,
    visibleState: {
      status: 'repair-needed',
      visibleAnswerText: [
        'Provider proxy profile sciforge-runtime-deepseek using bailian/deepseek-v4-flash returned 502.',
        'No OpenAI fallback was contacted; repair is needed before retry.',
      ].join(' '),
      recoveryAnswerText: 'Config retry dispatched a fresh DeepSeek provider request and used recovered output evidence.',
      auditRefs: failedRun.auditRefs,
      foregroundRawStreamRefs: [],
    },
    rawEvidenceBundle,
    scrubbedAuditBundle,
    scrubFindings: scrubbed.findings as unknown as JsonRecord[],
  };
}

export function assertProviderSecurityBudgetAuditFixture(fixture: ProviderSecurityBudgetAuditFixture): void {
  assert.equal(fixture.fixtureScope, 'offline-fixture-only');
  assert.equal(fixture.livePass, false, 'case is a bounded fixture, not a live pass claim');
  assert.deepEqual([...fixture.requirementIds].sort(), [...PROVIDER_SECURITY_REQUIREMENT_IDS].sort());

  assertDeepSeekTransparency(fixture);
  assertRawStreamsAndSecretsAreScrubbed(fixture);
  assertFailedRunAuditBundleRefs(fixture);
  assertProviderOutageRecovery(fixture);
}

export function assertDeepSeekTransparency(fixture: ProviderSecurityBudgetAuditFixture): void {
  assert.equal(fixture.transparency.profile, runtimeProfile);
  assert.equal(fixture.transparency.model, runtimeModel);
  assert.equal(fixture.transparency.provider, runtimeProvider);
  assert.equal(fixture.transparency.contactedOpenAI, false);
  assert.equal(fixture.transparency.workspace, workspace);
  assert.equal(fixture.transparency.commandId, commandId);
  assert.equal(fixture.transparency.fallbackPolicy, 'fail-closed-without-explicit-openai-opt-in');
  assert.ok(
    fixture.transparency.fallbackAttempts.some((attempt) => attempt.provider === 'openai' && attempt.allowed === false),
    'OpenAI fallback must be represented as blocked, not silently used',
  );
  assert.doesNotMatch(fixture.visibleState.visibleAnswerText, /contacted openai|using openai fallback/i);
}

export function assertRawStreamsAndSecretsAreScrubbed(fixture: ProviderSecurityBudgetAuditFixture): void {
  const scrubbedJson = JSON.stringify(fixture.scrubbedAuditBundle);
  assertEvidenceBundleScrubbed(fixture.scrubbedAuditBundle, {
    knownSecrets: [
      providerToken,
      rawUpstreamHtml,
      'token_endpoint=https://deepseek.internal/token',
    ],
  });
  assert.match(scrubbedJson, /sciforge-runtime-deepseek/);
  assert.match(scrubbedJson, /bailian\/deepseek-v4-flash/);
  assert.doesNotMatch(scrubbedJson, new RegExp(escapeRegExp(providerToken)));
  assert.doesNotMatch(scrubbedJson, /Authorization: Bearer/i);
  assert.doesNotMatch(scrubbedJson, /token_endpoint=https:\/\/deepseek\.internal\/token/i);
  assert.doesNotMatch(scrubbedJson, /deepseek\.internal\.example\.test/);
  assert.doesNotMatch(scrubbedJson, /\/fixture\/\.secrets/);
  assert.equal(fixture.visibleState.foregroundRawStreamRefs.length, 0);
  assert.ok(fixture.scrubFindings.some((finding) => finding.kind === 'provider-token'));
  assert.ok(fixture.scrubFindings.some((finding) => finding.kind === 'raw-auth-header'));
  assert.ok(fixture.scrubFindings.some((finding) => finding.kind === 'absolute-secret-path'));
  assert.ok(fixture.scrubFindings.some((finding) => finding.kind === 'unsafe-provider-route-field'));
}

export function assertFailedRunAuditBundleRefs(fixture: ProviderSecurityBudgetAuditFixture): void {
  const manifest = getRecord(fixture.scrubbedAuditBundle.auditManifest, 'auditManifest');
  assert.equal(manifest.runId, fixture.failedRun.runId);
  assert.equal(manifest.commandId, fixture.failedRun.commandId);
  assert.equal(manifest.provider, runtimeProvider);
  assert.equal(manifest.model, runtimeModel);
  assert.equal(manifest.profile, runtimeProfile);
  assert.equal(manifest.status, 'repair-needed');
  assert.deepEqual(manifest.requirementIds, [...PROVIDER_SECURITY_REQUIREMENT_IDS]);
  for (const ref of [
    'audit://sa-web-38/manifest.json',
    'audit://sa-web-38/raw-jsonl.scrubbed.jsonl',
    'audit://sa-web-38/stderr.scrubbed.log',
    'audit://sa-web-38/normalized-events.jsonl',
    'failure:sa-web-38-provider-502',
  ]) {
    assert.ok(fixture.failedRun.auditRefs.includes(ref), `failed run audit refs must include ${ref}`);
  }
  const boundedFiles = getArray(manifest.boundedFiles, 'auditManifest.boundedFiles');
  assert.ok(boundedFiles.length >= 4);
  for (const file of boundedFiles) {
    const record = getRecord(file, 'boundedFiles[]');
    assert.equal(typeof record.ref, 'string');
    assert.equal(typeof record.maxBytes, 'number');
    assert.equal(typeof record.sizeBytes, 'number');
    assert.ok(Number(record.sizeBytes) <= Number(record.maxBytes), `${String(record.ref)} must be bounded`);
  }
}

export function assertProviderOutageRecovery(fixture: ProviderSecurityBudgetAuditFixture): void {
  assert.equal(fixture.failedRun.status, 'repair-needed');
  assert.equal(fixture.failedRun.providerStatus, 'outage');
  assert.match(fixture.failedRun.visibleSummary, /repair-needed/i);
  assert.equal(fixture.visibleState.status, 'repair-needed');

  assert.equal(fixture.recoveredRun.status, 'completed');
  assert.equal(fixture.recoveredRun.providerStatus, 'recovered');
  assert.notEqual(
    fixture.recoveredRun.outputDigest,
    fixture.failedRun.outputDigest,
    'recovery must not reuse failed output digest as success evidence',
  );
  assert.equal(fixture.recoveredRun.evidenceRefs.includes(fixture.failedRun.outputRef), false);
  assert.equal(fixture.recoveredRun.evidenceRefs.includes(fixture.failedRun.outputDigest), false);
  assert.ok(fixture.recoveredRun.evidenceRefs.includes('event:sa-web-38-fresh-dispatch'));
  assert.match(fixture.visibleState.recoveryAnswerText, /fresh DeepSeek provider request/i);
}

function auditManifest(
  failedRun: ProviderRunRecord,
  recoveredRun: ProviderRunRecord,
  failedOutputDigest: string,
): JsonRecord {
  return {
    schemaVersion: 'sciforge.runtime-codex.audit-bundle.v1',
    caseId: PROVIDER_SECURITY_BUDGET_AUDIT_CASE_ID,
    requirementIds: [...PROVIDER_SECURITY_REQUIREMENT_IDS],
    runId: failedRun.runId,
    commandId: failedRun.commandId,
    provider: runtimeProvider,
    model: runtimeModel,
    profile: runtimeProfile,
    workspace,
    status: failedRun.status,
    refs: [...failedRun.auditRefs],
    boundedFiles: [
      boundedFile('audit://sa-web-38/manifest.json', 8192, 1220),
      boundedFile('audit://sa-web-38/raw-jsonl.scrubbed.jsonl', 65536, 4096),
      boundedFile('audit://sa-web-38/stderr.scrubbed.log', 32768, 1024),
      boundedFile('audit://sa-web-38/normalized-events.jsonl', 65536, 2048),
    ],
    recovery: {
      policy: 'retry-after-provider-recovers-with-fresh-dispatch',
      recoveredRunId: recoveredRun.runId,
      recoveredOutputDigest: recoveredRun.outputDigest,
      excludedFailedOutputDigest: failedOutputDigest,
      reusedFailedOutputAsSuccessEvidence: false,
    },
  };
}

function boundedFile(ref: string, maxBytes: number, sizeBytes: number): JsonRecord {
  return {
    ref,
    maxBytes,
    sizeBytes,
    digest: digestJson({ ref, maxBytes, sizeBytes }),
  };
}

function digestJson(value: JsonValue): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function getRecord(value: unknown, label: string): JsonRecord {
  assert.equal(typeof value, 'object', `${label} must be an object`);
  assert.notEqual(value, null, `${label} must be an object`);
  assert.equal(Array.isArray(value), false, `${label} must be an object`);
  return value as JsonRecord;
}

function getArray(value: unknown, label: string): JsonValue[] {
  assert.equal(Array.isArray(value), true, `${label} must be an array`);
  return value as JsonValue[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
