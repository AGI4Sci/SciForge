import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { auditModelRouterTraceBundle } from './trace-audit';

const execFileAsync = promisify(execFile);

test('Model Router trace audit passes refs-first sanitized trace bundles', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-pass-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_safe');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_safe',
    responseId: 'resp_safe',
    profileId: 'sciforge-runtime-default',
    workspaceId: 'sha256:abcdef',
    publicModelAlias: 'sciforge-router',
    textReasoner: {
      roleAlias: 'textReasoner',
      publicModelAlias: 'sciforge-router',
      providerBindingSha256: 'sha256:text',
      wireApi: 'chat.completions',
    },
    translators: {
      vision: {
        roleAlias: 'translators.vision',
        publicModelAlias: 'sciforge-router',
        providerBindingSha256: 'sha256:vision',
        wireApi: 'chat.completions',
      },
    },
    modalityRefs: [{
      id: 'image_1',
      kind: 'vision.image',
      source: 'ref',
      sha256: 'sha256:image',
      ref: 'artifact:workspace/figures/plot.png',
    }],
    calls: [{
      role: 'textReasoner',
      phase: 'text-control-or-final',
      status: 'ok',
      roleAlias: 'textReasoner',
      providerBindingSha256: 'sha256:text',
      wireApi: 'chat.completions',
      latencyMs: 12,
    }],
    degraded: false,
  }, null, 2));
  await writeFile(join(bundleDir, 'final-routing-summary.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.final-routing-summary.v1',
    responseId: 'resp_safe',
    profileId: 'sciforge-runtime-default',
    status: 'completed',
    outputTextSha256: 'sha256:answer',
    degraded: false,
    traceRef: '.sciforge/model-router-traces/2026-06-05/resp_safe',
  }, null, 2));

  const report = await auditModelRouterTraceBundle({ traceRoot });

  assert.equal(report.status, 'pass');
  assert.equal(report.scannedFiles, 2);
  assert.deepEqual(report.findings, []);
});

test('Model Router trace audit fails closed for raw provider payloads and private material', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-fail-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_leaky');
  const knownSecret = 'sk-live-secret-123456';
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_leaky',
    provider: 'raw-provider-name',
    model: 'raw-model-name',
    request: {
      messages: [{ role: 'user', content: 'raw prompt' }],
      image_url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      authorization: `Bearer ${knownSecret}`,
      url: 'https://private.example.test/v1/chat/completions?token=raw-token',
      localPath: '/Users/alice/private/figure.png',
    },
  }, null, 2));

  const report = await auditModelRouterTraceBundle({
    traceRoot,
    knownSecrets: [knownSecret],
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'known-secret'));
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-provider-payload'));
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-provider-binding'));
  assert.ok(report.findings.some((finding) => finding.kind === 'inline-image-data'));
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-private-url'));
  assert.ok(report.findings.some((finding) => finding.kind === 'local-absolute-path'));
  assert.doesNotMatch(serialized, /sk-live-secret|private\.example|\/Users\/alice|raw-token|raw prompt/i);
});

test('Model Router trace audit does not echo unsafe file refs in reports', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-file-ref-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'sk-file-ref-secret-123456');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_safe_but_unsafe_name',
    profileId: 'sciforge-runtime-default',
  }, null, 2));

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'pass');
  assert.equal(report.scannedFiles, 1);
  assert.doesNotMatch(serialized, /sk-file-ref-secret/i);
  assert.match(report.scannedFileRefs[0] ?? '', /^trace-file:[a-f0-9]{16}$/);
});

test('Model Router trace audit fails closed for JSON header keys without echoing values', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-header-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_headers');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_headers',
    headers: {
      Authorization: 'Bearer header-secret-value-123456',
      'X-Api-Key': 'provider-secret-value-123456',
      Cookie: 'session=private-cookie-value',
    },
  }, null, 2));

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-auth-header'));
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-provider-binding'));
  assert.doesNotMatch(serialized, /header-secret-value|provider-secret-value|private-cookie-value/i);
});

for (const sample of [
  {
    label: 'Authorization=Bearer',
    text: 'stderr: Authorization=Bearer sk-equals-secret-123456',
    secret: /sk-equals-secret-123456/i,
  },
  {
    label: 'Authorization Bearer',
    text: 'stderr: Authorization Bearer sk-space-secret-123456',
    secret: /sk-space-secret-123456/i,
  },
] as const) {
  test(`Model Router trace audit fails closed for ${sample.label} text without echoing values`, async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-auth-text-'));
    const bundleDir = join(traceRoot, '2026-06-05', 'resp_auth_text');
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, 'provider.log.txt'), `${sample.text}\n`);

    const report = await auditModelRouterTraceBundle({ traceRoot });
    const serialized = JSON.stringify(report);

    assert.equal(report.status, 'fail');
    assert.ok(report.findings.some((finding) => finding.kind === 'raw-auth-header'));
    assert.doesNotMatch(serialized, sample.secret);
  });
}

test('Model Router trace audit does not echo unsafe JSON keys in finding paths', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-key-path-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_key_path');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    safe: {
      'sk-json-key-secret-123456': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      'https://private.example.test/v1?token=raw-token': '/Users/alice/private/file.png',
    },
  }, null, 2));

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'inline-image-data'));
  assert.ok(report.findings.some((finding) => finding.kind === 'local-absolute-path'));
  assert.doesNotMatch(serialized, /sk-json-key-secret|private\.example|raw-token|\/Users\/alice/i);
});

test('Model Router trace audit scans JSONL records for raw auth headers and provider payload aliases', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-jsonl-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_jsonl');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.jsonl'), `${JSON.stringify({
    headers: { Authorization: 'Bearer abcdefghijk' },
    raw_provider_payload: 'opaque provider body',
  })}\n`);

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-auth-header'));
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-provider-payload'));
  assert.doesNotMatch(serialized, /abcdefghijk|opaque provider body/i);
});

test('Model Router trace audit scans SSE data JSON for raw provider payload aliases', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-sse-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_sse');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'provider-stream.txt'), [
    'event: response.output_text.delta',
    `data: ${JSON.stringify({
      response: { choices: [{ delta: { content: 'raw streamed provider chunk' } }] },
    })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n'));

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-provider-payload'));
  assert.doesNotMatch(serialized, /raw streamed provider chunk/i);
});

test('Model Router trace audit fails closed for normalized raw provider payload key aliases', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-key-aliases-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_key_aliases');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    raw_provider_payload: 'opaque provider body 1',
    'raw-provider-payload': 'opaque provider body 2',
    response_body: 'opaque provider body 3',
    request_body: 'opaque provider body 4',
    rawProviderResponse: 'opaque provider body 5',
  }, null, 2));

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-provider-payload'));
  assert.doesNotMatch(serialized, /opaque provider body/i);
});

test('Model Router trace audit fails closed for raw binary files under trace roots', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-binary-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_binary');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'raw-screenshot.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const report = await auditModelRouterTraceBundle({ traceRoot });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.findings.some((finding) => finding.kind === 'raw-binary-artifact'));
  assert.doesNotMatch(serialized, /\/tmp|\/var|\/Users|\/Applications/i);
});

test('Model Router trace audit fails closed for symlinked trace entries', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-symlink-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_symlink');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'safe.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_safe',
  }, null, 2));
  const targetDir = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-symlink-target-'));
  const targetPath = join(targetDir, 'leaky-trace.json');
  await writeFile(targetPath, JSON.stringify({
    headers: { Authorization: 'Bearer symlink-secret-123456' },
  }, null, 2));
  await symlink(targetPath, join(bundleDir, 'trace.json'));

  const report = await auditModelRouterTraceBundle({
    traceRoot,
    requireNonEmpty: true,
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.ok(report.scannedFileRefs.includes('2026-06-05/resp_symlink/trace.json'));
  assert.ok(report.findings.some((finding) => finding.kind === 'unscannable-trace-entry'));
  assert.doesNotMatch(serialized, /symlink-secret|leaky-trace|sciforge-model-router-trace-audit-symlink-target|\/tmp|\/var|\/Users|\/Applications/i);
});

test('Model Router trace audit can require non-empty trace roots for release gates', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-empty-'));

  const report = await auditModelRouterTraceBundle({
    traceRoot,
    requireNonEmpty: true,
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.status, 'fail');
  assert.equal(report.scannedFiles, 0);
  assert.ok(report.findings.some((finding) => finding.kind === 'trace-root-empty'));
  assert.doesNotMatch(serialized, /\/tmp|\/var|node:internal/i);
});

test('Model Router trace audit CLI writes a bounded report and exits nonzero on findings', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-cli-'));
  const outPath = join(traceRoot, 'audit-report.json');
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_cli');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_cli',
    response: { choices: [{ message: { content: 'raw provider body' } }] },
    stderr: 'Authorization: Bearer sk-cli-secret-123456',
  }, null, 2));

  let error: unknown;
  try {
    await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-trace-audit.ts',
      '--trace-root',
      traceRoot,
      '--out',
      outPath,
      '--known-secret-env',
      'SCIFORGE_TEXT_API_KEY',
      '--json',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SCIFORGE_TEXT_API_KEY: 'sk-cli-secret-123456',
      },
    });
  } catch (caught) {
    error = caught;
  }
  assert.ok(error && typeof error === 'object' && 'code' in error);
  assert.equal((error as { code?: unknown }).code, 1);

  const reportText = await readFile(outPath, 'utf8');
  const outputText = String((error as { stdout?: unknown }).stdout ?? '');
  assert.match(reportText, /"status":\s*"fail"/);
  assert.doesNotMatch(reportText, /sk-cli-secret|raw provider body/i);
  assert.doesNotMatch(outputText, /sk-cli-secret|raw provider body/i);
});

test('Model Router trace audit CLI rejects invalid max-file-bytes before scanning', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-invalid-budget-'));

  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-trace-audit.ts',
      '--trace-root',
      traceRoot,
      '--max-file-bytes',
      'nope',
      '--json',
    ], { cwd: process.cwd() }),
    (error: unknown) => {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      assert.equal(stdout, '');
      assert.match(stderr, /--max-file-bytes must be a positive integer/);
      assert.doesNotMatch(stderr, /\/tmp|\/var|node:internal/i);
      return true;
    },
  );
});

test('Model Router trace audit CLI redacts unknown sensitive arguments from stderr', async () => {
  const cases = [
    {
      arg: '--sk-live-secret-123456',
      unsafe: /sk-live-secret-123456/i,
    },
    {
      arg: '--provider=https://private.example/v1?token=x',
      unsafe: /private\.example|token=x|--provider=https/i,
    },
    {
      arg: `--bundle=${resolve(process.cwd(), 'private-model-router-traces')}`,
      unsafe: /\/Applications\/workspace|private-model-router-traces/i,
    },
  ] as const;

  for (const { arg, unsafe } of cases) {
    await assert.rejects(
      execFileAsync(process.execPath, [
        '--import',
        'tsx',
        'tools/model-router-trace-audit.ts',
        arg,
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
        const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
        assert.equal(stdout, '');
        assert.match(stderr, /Unknown model-router trace audit argument/);
        assert.doesNotMatch(stderr, unsafe);
        return true;
      },
    );
  }
});

test('Model Router trace audit CLI fail-closes explicit missing known secret env vars', async () => {
  const traceRoot = await mkdtemp(join(tmpdir(), 'sciforge-model-router-trace-audit-missing-secret-'));
  const bundleDir = join(traceRoot, '2026-06-05', 'resp_safe');
  await mkdir(bundleDir, { recursive: true });
  await writeFile(join(bundleDir, 'trace.json'), JSON.stringify({
    schemaVersion: 'sciforge.model-router.trace.v1',
    traceId: 'resp_safe',
    responseId: 'resp_safe',
    profileId: 'sciforge-runtime-default',
    publicModelAlias: 'sciforge-router',
  }, null, 2));

  const env = { ...process.env };
  delete env.SCIFORGE_TEXT_API_KEY;

  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-trace-audit.ts',
      '--trace-root',
      traceRoot,
      '--known-secret-env',
      'SCIFORGE_TEXT_API_KEY',
      '--json',
    ], {
      cwd: process.cwd(),
      env,
    }),
    (error: unknown) => {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      assert.equal(stderr, '');
      const report = JSON.parse(stdout) as Awaited<ReturnType<typeof auditModelRouterTraceBundle>>;
      assert.equal(report.status, 'fail');
      assert.ok(report.findings.some((finding) => finding.kind === 'known-secret-env-missing'));
      assert.doesNotMatch(JSON.stringify(report), /SCIFORGE_TEXT_API_KEY|\/tmp|\/var|node:internal/i);
      return true;
    },
  );
});

test('Model Router trace audit CLI fail-closes missing trace roots without leaking local paths', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-trace-audit.ts',
      '--trace-root',
      resolve(process.cwd(), '..', 'missing-model-router-traces'),
      '--json',
    ], { cwd: process.cwd() }),
    (error: unknown) => {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      assert.equal(stderr, '');
      const report = JSON.parse(stdout) as Awaited<ReturnType<typeof auditModelRouterTraceBundle>>;
      assert.equal(report.status, 'fail');
      assert.equal(report.scannedFiles, 0);
      assert.ok(report.findings.some((finding) => finding.kind === 'trace-root-unavailable'));
      assert.doesNotMatch(JSON.stringify(report), /\/Applications|\/Users|missing-model-router-traces|ENOENT|node:internal/i);
      return true;
    },
  );
});
