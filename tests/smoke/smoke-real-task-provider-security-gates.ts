import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

const [
  packageJson,
  runtimeConfigText,
  modelRouterSource,
  modelRouterTest,
  adapterTest,
  runtimeFailureSource,
  sciforgeClientSource,
] = await Promise.all([
  readJson<{ scripts?: Record<string, string> }>('package.json'),
  readText('src/runtime/codex/codex-runtime-config.ts'),
  readText('packages/workers/model-router/src/router.ts'),
  readText('packages/workers/model-router/src/router.test.ts'),
  readText('src/runtime/codex/codex-exec-json-adapter.test.ts'),
  readText('src/ui/src/api/sciforgeToolsClient/runtimeFailure.ts'),
  readText('src/ui/src/api/sciforgeToolsClient/client.ts'),
]);

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

assert.equal(existsSync(join(root, 'packages/backend/src/proxy.ts')), false, 'R-SEC: legacy Codex Responses proxy source must not remain as a callable bypass');
assert.match(modelRouterSource, /function modelRouterHealthzUpstreamDiagnostic/, 'R-SEC/R-FAIL: Model Router healthz must own provider readiness diagnostics');
assert.match(modelRouterSource, /function normalizeRouterError/, 'R-SEC/R-FAIL: Model Router must normalize public router errors');
assert.match(modelRouterSource, /provider_http_\$\{response\.status\}/, 'R-FAIL: provider HTTP failures must be reduced to bounded status categories');
assert.match(modelRouterSource, /boundedProviderTraceText/, 'R-SEC: provider traces must be redacted before persistence');
assert.match(modelRouterSource, /providerTraceRedactionValues/, 'R-SEC: provider binding fields must be treated as sensitive trace redaction values');

for (const coverage of [
  'healthz reports provider readiness without leaking private bindings',
  'healthz blocks missing provider credentials without leaking binding names',
  'text reasoner HTTP failures still write sanitized refs-first trace summaries',
  'text reasoner exceptions still write sanitized failure traces',
] as const) {
  assert.match(modelRouterTest, new RegExp(escapeRegExp(coverage)), `R-SEC/R-FAIL: Model Router tests must cover ${coverage}`);
}

assert.match(adapterTest, /adapter writes a bounded scrubbed audit bundle for nonzero exits/, 'R-AUDIT: failed runs must write bounded scrubbed audit bundles');
assert.match(adapterTest, /adapter bounds and scrubs oversized HTML challenge audit diagnostics/, 'R-SEC: oversized HTML challenge diagnostics must be scrubbed and bounded');
assert.match(adapterTest, /assertAuditBundleManifestFiles/, 'R-AUDIT: audit bundle manifest file refs must be resolvable');
assert.match(adapterTest, /rawSha256/, 'R-AUDIT: audit bundle file metadata must include raw hashes');
assert.match(adapterTest, /bytes <= .*maxBytes/, 'R-AUDIT: audit bundle files must stay inside maxBytes');

for (const classifier of ['provider-auth', 'provider-gateway', 'external-network']) {
  assert.match(runtimeFailureSource, new RegExp(escapeRegExp(classifier)), `R-FAIL: Runtime Codex UI failure classifier must cover ${classifier}`);
}
assert.match(runtimeFailureSource, /provider-gateway[\s\S]*true/, 'R-FAIL: retryable provider failures must be represented');
assert.match(sciforgeClientSource, /resumeStrategy:\s*codexSessionId \? 'native-session-resume' : 'audit-only-retry'/, 'R-FAIL: provider/runtime failures without native session must use audit-only retry');

console.log('[ok] real-task provider/security gate covers Runtime budget, Model Router-only provider diagnostics, bounded audit bundles, and retry classification');

async function readText(path: string): Promise<string> {
  return readFile(join(root, path), 'utf8');
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
