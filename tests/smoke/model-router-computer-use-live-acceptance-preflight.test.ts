import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  buildModelRouterComputerUseLiveAcceptancePreflightManifest,
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_SCHEMA_VERSION,
} from '../../tools/model-router-computer-use-live-acceptance-preflight.js';

const execFileAsync = promisify(execFile);

const requiredCaseIds = [
  'browser-research',
  'docs-sheets-edit',
  'file-management',
  'ide-terminal',
  'cross-window-recovery-verifier',
] as const;

const forbiddenDiagnosticPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|sk-[A-Za-z0-9_-]+|https?:\/\/provider\.example|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

test('Model Router Computer Use live acceptance preflight reaches ready without publishing private router/provider details', async () => {
  const paths: string[] = [];
  const manifest = await buildModelRouterComputerUseLiveAcceptancePreflightManifest({
    now: () => new Date('2026-06-05T01:02:03.000Z'),
    routerUrl: 'https://provider.example.test/v1?raw=private',
    requestDisallowSharedSystemInput: true,
    env: {
      SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
      SCIFORGE_CU_LIVE_EXECUTOR_KIND: 'desktop-native-host',
      SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER: '/Users/alice/bin/run-live-cu --model qwen3.7-plus',
      SCIFORGE_TEXT_API_KEY: 'sk-text-secret-value',
      SCIFORGE_VISION_API_KEY: 'sk-vision-secret-value',
      SCIFORGE_MODEL_ROUTER_URL: 'https://provider.example.test/should-not-print',
    },
    localConfigs: [{
      path: '/Users/alice/private/config.local.json',
      config: {
        modelBaseUrl: 'https://provider.example.test/v1',
        apiKey: 'sk-local-secret',
        model: 'raw-private-model-qwen3.7-plus',
        translators: { vision: { model: 'deepseek-v4-flash', apiKey: 'sk-vision-local-secret' } },
      },
    }],
    fetchImpl: async (url) => {
      paths.push(new URL(String(url)).pathname);
      return jsonResponse(url, routerFixtureFor(new URL(String(url)).pathname));
    },
  });

  assert.equal(manifest.schemaVersion, MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_PREFLIGHT_SCHEMA_VERSION);
  assert.equal(manifest.status, 'ready');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.equal(manifest.evidenceMode, 'current-env-diagnostic-only');
  assert.deepEqual(paths.sort(), ['/health', '/manifest', '/v1/models'].sort());
  assert.deepEqual(manifest.casePlan.map((item) => item.id), [...requiredCaseIds]);
  assert.deepEqual(manifest.missingRequirements, []);
  assert.deepEqual(manifest.policyViolations, []);
  assert.equal(manifest.routerChecks.every((check) => check.status === 'pass'), true);
  assert.equal(manifest.routerModelList?.modelCount, 2);
  assert.equal(manifest.routerModelList?.valuePrinted, false);
  assert.equal(manifest.computerUsePreflight.runner.valuePrinted, false);
  assert.match(manifest.computerUsePreflight.runner.commandRef ?? '', /^command:[a-f0-9]{16}$/);
  assert.equal(manifest.authReadiness.valuePrinted, false);
  assert.equal(manifest.authReadiness.textReasonerAuthPresent, true);
  assert.equal(manifest.authReadiness.visionTranslatorAuthPresent, true);
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenDiagnosticPattern);
});

test('Model Router Computer Use live acceptance preflight blocks missing live prerequisites and router capability gaps', async () => {
  const manifest = await buildModelRouterComputerUseLiveAcceptancePreflightManifest({
    now: () => new Date('2026-06-05T01:02:03.000Z'),
    routerUrl: 'http://127.0.0.1:3894',
    env: {},
    fetchImpl: async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/manifest') {
        return jsonResponse(url, {
          workerId: 'sciforge.model-router',
          capabilities: ['model_router_responses'],
        });
      }
      return jsonResponse(url, routerFixtureFor(path));
    },
  });

  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.releaseAcceptance, 'not-evaluated');
  assert.ok(manifest.missingRequirements.includes('missing-live-opt-in'));
  assert.ok(manifest.missingRequirements.includes('missing-live-runner'));
  assert.ok(manifest.missingRequirements.includes('missing-executor-kind'));
  assert.ok(manifest.routerCapabilityCheck.missingCapabilities.includes('vision_translation'));
  assert.ok(manifest.routerCapabilityCheck.missingCapabilities.includes('refs_first_trace'));
  assert.ok(manifest.nextActions.some((action) => action.command?.includes('model-router-computer-use-live-acceptance-matrix.ts')));
  assert.ok(manifest.nextActions.some((action) => action.command?.includes('model-router-trace-audit.ts')));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenDiagnosticPattern);
});

test('Model Router Computer Use live acceptance preflight policy violations fail closed even when services are ready', async () => {
  const manifest = await buildModelRouterComputerUseLiveAcceptancePreflightManifest({
    now: () => new Date('2026-06-05T01:02:03.000Z'),
    routerUrl: 'http://127.0.0.1:3894',
    requestDisallowSharedSystemInput: true,
    env: {
      SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
      SCIFORGE_CU_LIVE_EXECUTOR_KIND: 'app-window',
      SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER: 'run-live-cu',
      SCIFORGE_TEXT_API_KEY: 'sk-text-secret-value',
      SCIFORGE_VISION_API_KEY: 'sk-vision-secret-value',
      SCIFORGE_CU_LIVE_DRY_RUN: '1',
      SCIFORGE_VISION_TEST_ACTION_FIXTURES: 'true',
    },
    fetchImpl: async (url) => jsonResponse(url, routerFixtureFor(new URL(String(url)).pathname)),
  });

  assert.equal(manifest.status, 'blocked');
  assert.ok(manifest.policyViolations.includes('dry-run-cannot-satisfy-live-acceptance'));
  assert.ok(manifest.policyViolations.includes('test-action-fixtures-cannot-satisfy-live-acceptance'));
  assert.doesNotMatch(JSON.stringify(manifest), forbiddenDiagnosticPattern);
});

test('Model Router Computer Use live acceptance preflight CLI strict writes sanitized manifests and hides local paths', async () => {
  const server = await startRouterFixtureServer();
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-cu-preflight-'));
  const out = join(workspace, 'absolute-preflight.json');
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-computer-use-live-acceptance-preflight.ts',
      '--router-url',
      server.url,
      '--request-disallow-shared-system-input',
      '--known-secret-env',
      'SCIFORGE_TEXT_API_KEY',
      '--known-secret-env',
      'SCIFORGE_VISION_API_KEY',
      '--out',
      out,
      '--strict',
      '--json',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SCIFORGE_REQUIRE_MODEL_ROUTER_CU_LIVE_ACCEPTANCE: '1',
        SCIFORGE_CU_LIVE_EXECUTOR_KIND: 'native-host',
        SCIFORGE_CU_LIVE_ACCEPTANCE_RUNNER: '/Applications/private/run-live-cu --provider https://provider.example.test/v1 --model raw-private-model',
        SCIFORGE_TEXT_API_KEY: 'sk-text-secret-value',
        SCIFORGE_VISION_API_KEY: 'sk-vision-secret-value',
      },
    });

    assert.equal(stderr, '');
    const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof buildModelRouterComputerUseLiveAcceptancePreflightManifest>>;
    const fileManifest = JSON.parse(await readFile(out, 'utf8')) as typeof manifest;
    assert.equal(manifest.status, 'ready');
    assert.equal(fileManifest.status, 'ready');
    assert.equal(manifest.expectedArtifacts.preflightRef, 'docs/test-artifacts/model-router-computer-use-live-matrix/preflight.json');
    assert.doesNotMatch(stdout, forbiddenDiagnosticPattern);
    assert.doesNotMatch(JSON.stringify(fileManifest), forbiddenDiagnosticPattern);
    assert.equal(stdout.includes(out), false);
    assert.equal(stdout.includes(server.url), false);
  } finally {
    await server.close();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('Model Router Computer Use live acceptance preflight CLI strict exits nonzero when blocked without stack traces', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [
      '--import',
      'tsx',
      'tools/model-router-computer-use-live-acceptance-preflight.ts',
      '--strict',
      '--json',
    ], { cwd: process.cwd(), env: { ...process.env, SCIFORGE_CU_LIVE_DRY_RUN: '1' } }),
    (error: unknown) => {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
      const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
      const manifest = JSON.parse(stdout) as Awaited<ReturnType<typeof buildModelRouterComputerUseLiveAcceptancePreflightManifest>>;
      assert.equal(stderr, '');
      assert.equal(manifest.status, 'blocked');
      assert.ok(manifest.missingRequirements.includes('missing-router-url'));
      assert.ok(manifest.policyViolations.includes('dry-run-cannot-satisfy-live-acceptance'));
      assert.doesNotMatch(stdout, forbiddenDiagnosticPattern);
      assert.doesNotMatch(stderr, /Error:|at .*model-router-computer-use-live-acceptance-preflight/);
      return true;
    },
  );
});

function routerFixtureFor(path: string) {
  if (path === '/health') return { ok: true, service: 'sciforge.model-router' };
  if (path === '/manifest') {
    return {
      workerId: 'sciforge.model-router',
      capabilities: ['model_router_responses', 'text_reasoning', 'vision_translation', 'refs_first_trace'],
      providers: [{
        providerId: 'sciforge.model-router.responses',
        capabilityId: 'model_router_responses',
      }],
    };
  }
  if (path === '/v1/models') {
    return {
      object: 'list',
      data: [
        { id: 'qwen3.7-plus', object: 'model', owned_by: 'provider-private' },
        { id: 'deepseek-v4-flash', object: 'model', owned_by: 'provider-private' },
      ],
    };
  }
  return { error: { message: 'not found' } };
}

function jsonResponse(url: unknown, body: unknown): Response {
  const path = new URL(String(url)).pathname;
  const status = path === '/unknown' ? 404 : 200;
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function startRouterFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const path = request.url ? new URL(request.url, 'http://127.0.0.1').pathname : '/';
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(routerFixtureFor(path)));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
