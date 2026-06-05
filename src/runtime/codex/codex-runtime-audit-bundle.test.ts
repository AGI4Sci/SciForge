import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createRuntimeCodexAuditBundle } from './codex-runtime-audit-bundle.js';
import type { CodexRuntimeMetadata } from './codex-event-normalizer.js';

test('runtime audit manifest exposes router alias/profile without private provider details', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-runtime-audit-'));
  const metadata: CodexRuntimeMetadata = {
    provider: 'https://private.provider.example/v1',
    model: 'provider/raw-private-model-slug',
    profile: 'sciforge-runtime-default',
    workspace,
    commandId: 'codex-audit-test',
    attemptId: 'codex-audit-test-attempt-1',
    evidenceRefs: ['audit:runtime'],
    resumeRequested: false,
  };

  const bundle = createRuntimeCodexAuditBundle(metadata);
  await bundle.initialize();
  bundle.appendRawJsonlLine(JSON.stringify({
    type: 'response.created',
    provider: 'private-upstream',
    model: 'provider/raw-private-model-slug',
    base_url: 'https://private.provider.example/v1',
    env_key: 'PRIVATE_PROVIDER_KEY_ENV',
    workspace,
    transcript_path: `${workspace}/.codex/sessions/thread-private.jsonl`,
    nested: {
      configPath: '/Users/alice/.codex/auth.json',
      providerUrl: 'https://private.provider.example/v1/responses?api_key=sk-provider-secret-123456',
    },
  }));
  bundle.appendStderr(`provider failed at ${workspace}/config.local.json with Authorization: Bearer sk-stderr-secret-123456 and url https://private.provider.example/v1/responses?token=sk-url-secret-123456\n`);
  bundle.appendNormalizedEvent({
    schemaVersion: 'sciforge.codex.normalized-event.v1',
    type: 'run_started',
    timestamp: new Date().toISOString(),
    provider: 'private-upstream',
    model: 'provider/raw-private-model-slug',
    profile: 'sciforge-runtime-default',
    workspace,
    commandId: 'codex-audit-test',
    attemptId: 'codex-audit-test-attempt-1',
  });
  await bundle.finalize({ status: 'done', exitCode: 0, signal: null });

  const manifestText = await readFile(join(bundle.bundleDir, 'manifest.json'), 'utf8');
  const rawJsonlText = await readFile(join(bundle.bundleDir, 'raw-jsonl.scrubbed.jsonl'), 'utf8');
  const stderrText = await readFile(join(bundle.bundleDir, 'stderr.scrubbed.log'), 'utf8');
  const normalizedText = await readFile(join(bundle.bundleDir, 'normalized-events.jsonl'), 'utf8');
  const bundleText = `${manifestText}\n${rawJsonlText}\n${stderrText}\n${normalizedText}`;
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  assert.equal(manifest.routerProfile, 'sciforge-runtime-default');
  assert.equal(manifest.routerAlias, 'sciforge-router');
  assert.deepEqual(manifest.capabilities, ['text', 'vision']);
  assert.match(String(manifest.workspace), /^\[workspace:sha256:[a-f0-9]{16}\]$/);
  assert.equal('provider' in manifest, false);
  assert.equal('model' in manifest, false);
  assert.equal(bundleText.includes(workspace), false);
  assert.match(normalizedText, /"provider":"sciforge-model-router"/);
  assert.match(normalizedText, /"model":"sciforge-router"/);
  assert.doesNotMatch(bundleText, /private\.provider|raw-private-model-slug|PRIVATE_PROVIDER_KEY_ENV|api[_-]?key|env_key|\/Users\/alice|sk-stderr-secret|sk-provider-secret|sk-url-secret|Authorization: Bearer sk/i);
  assert.match(bundleText, /\[redacted-(?:url|secret|local-path):sha256:[a-f0-9]{16}\]/);
});
