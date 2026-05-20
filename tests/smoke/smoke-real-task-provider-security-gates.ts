import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { currentProjectMappingsForSaWebTag } from './web-e2e/case-tags.js';

const root = process.cwd();

const [
  packageJson,
  matrixText,
  runtimeConfigText,
  proxySource,
  proxyTest,
  adapterTest,
  runtimeEventsTest,
] = await Promise.all([
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('tests/smoke/smoke-real-task-matrix.ts'),
  readText('src/runtime/codex/codex-runtime-config.ts'),
  readText('packages/backend/src/proxy.ts'),
  readText('packages/backend/src/proxy.test.ts'),
  readText('src/runtime/codex/codex-exec-json-adapter.test.ts'),
  readText('src/ui/src/api/sciforgeToolsClient/runtimeEvents.test.ts'),
]);

const requiredTaskIds = ['R-BUDGET-01', 'R-SEC-01', 'R-AUDIT-01', 'R-FAIL-01'] as const;

for (const taskId of requiredTaskIds) {
  assert.match(matrixText, new RegExp(`task\\('${taskId}'.*smoke:real-task-provider-security-gates`, 's'), `${taskId}: must include the provider/security real-task gate`);
}

for (const [taskId, assertion] of [
  ['R-BUDGET-01', 'runtime-provider-budget'],
  ['R-SEC-01', 'secret-raw-stream-scrub'],
  ['R-AUDIT-01', 'failed-run-audit-export'],
  ['R-FAIL-01', 'provider-outage-recovery'],
] as const) {
  assert.ok(
    currentProjectMappingsForSaWebTag('SA-WEB-38').some(
      (mapping) => mapping.taskId === taskId && mapping.contractAssertions.includes(assertion),
    ),
    `${taskId} must map to SA-WEB-38 ${assertion}`,
  );
}

assert.equal(
  packageJson.scripts?.['smoke:real-task-provider-security-gates'],
  'tsx tests/smoke/smoke-real-task-provider-security-gates.ts',
  'package.json must expose the provider/security real-task gate',
);

assert.match(runtimeConfigText, /RUNTIME_PROVIDER/, 'R-BUDGET: runtime config must use the canonical Runtime provider constant');
assert.match(runtimeConfigText, /RUNTIME_MODEL/, 'R-BUDGET: runtime config must use the canonical Runtime model constant');
assert.match(runtimeConfigText, /RUNTIME_PROFILE/, 'R-BUDGET: runtime config must use the canonical Runtime profile constant');
assert.match(runtimeConfigText, /allowOpenAiRuntime/, 'R-BUDGET: OpenAI runtime fallback must require explicit opt-in');
assert.match(runtimeConfigText, /Missing \$\{RUNTIME_KEY_ENV\}/, 'R-BUDGET: missing Runtime API key must fail closed');
assert.match(runtimeConfigText, /OpenAI Runtime Codex provider\/model is disabled/, 'R-BUDGET: OpenAI-looking runtime config must fail closed by default');

assert.match(proxySource, /function normalizeUpstreamError/, 'R-SEC/R-FAIL: proxy must normalize upstream provider errors');
assert.match(proxySource, /rawProviderBody:\s*'suppressed'/, 'R-SEC: raw provider body must be suppressed in public errors');
assert.match(proxySource, /bodySha256/, 'R-AUDIT: proxy public errors must include raw-body digest metadata');
assert.match(proxySource, /isRetryableUpstreamStatus/, 'R-FAIL: retryable provider outage status must be explicit');
assert.match(proxySource, /proxyRaw[\s\S]*!upstream\.ok[\s\S]*normalizeUpstreamError/, 'R-SEC: raw proxy endpoints must scrub non-2xx failures before response write');

for (const route of ['/v1/models', '/v1/chat/completions'] as const) {
  assert.match(proxyTest, new RegExp(escapeRegExp(route)), `R-SEC: ${route} must have non-2xx scrub regression coverage`);
}
for (const forbidden of ['www-authenticate', 'set-cookie', 'x-upstream-api-key', 'Cloudflare challenge', 'cf_chl_opt']) {
  assert.match(proxyTest, new RegExp(escapeRegExp(forbidden), 'i'), `R-SEC: proxy tests must guard ${forbidden} leakage`);
}

assert.match(adapterTest, /adapter writes a bounded scrubbed audit bundle for nonzero exits/, 'R-AUDIT: failed runs must write bounded scrubbed audit bundles');
assert.match(adapterTest, /adapter bounds and scrubs oversized HTML challenge audit diagnostics/, 'R-SEC: oversized HTML challenge diagnostics must be scrubbed and bounded');
assert.match(adapterTest, /assertAuditBundleManifestFiles/, 'R-AUDIT: audit bundle manifest file refs must be resolvable');
assert.match(adapterTest, /rawSha256/, 'R-AUDIT: audit bundle file metadata must include raw hashes');
assert.match(adapterTest, /bytes <= .*maxBytes/, 'R-AUDIT: audit bundle files must stay inside maxBytes');

for (const classifier of ['provider-auth', 'provider-gateway', 'external-network']) {
  assert.match(runtimeEventsTest, new RegExp(escapeRegExp(classifier)), `R-FAIL: Runtime Codex UI failure classifier must cover ${classifier}`);
}
assert.match(runtimeEventsTest, /retryable,\s*true/, 'R-FAIL: retryable provider failures must be represented');
assert.match(runtimeEventsTest, /resumeStrategy.*audit-only-retry/s, 'R-FAIL: provider/runtime failures without native session must use audit-only retry');

console.log('[ok] real-task provider/security gates cover R-BUDGET/R-SEC/R-AUDIT/R-FAIL with DeepSeek fail-closed config, scrubbed proxy failures, bounded audit bundles, and retry classification');

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
