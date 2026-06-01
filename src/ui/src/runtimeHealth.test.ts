import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RUNTIME_HEALTH_STATUS } from '@sciforge-ui/runtime-contract';
import { defaultSciForgeConfig, updateConfig } from './config';
import { providerReadinessNoticeFromManifest } from './providerReadiness';
import {
  codexRuntimeHealth,
  modelHealth,
  probeWorkspaceWriterHealthDetailsUrl,
  probeWorkspaceWriterHealthUrl,
  workspaceWriterHealth,
} from './runtimeHealth';

describe('runtime health model status', () => {
  it('marks empty native model configuration as setup instead of online', () => {
    const health = modelHealth(updateConfig(defaultSciForgeConfig, {
      modelProvider: 'native',
      modelBaseUrl: '',
      modelName: '',
      apiKey: '',
    }));

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.NOT_CONFIGURED);
    assert.match(health.detail, /model.*not configured/i);
    assert.match(String(health.recoverAction), /will not switch providers automatically/i);
    assert.doesNotMatch(String(health.recoverAction), /Runtime Codex|allowOpenAiRuntime/);
  });

  it('treats native user model endpoints as an explicit online configuration', () => {
    const health = modelHealth(updateConfig(defaultSciForgeConfig, {
      modelProvider: 'native',
      modelBaseUrl: 'https://models.example.test/v1',
      modelName: 'sciforge-model',
      apiKey: 'test-key',
    }));

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.ONLINE);
    assert.match(health.detail, /sciforge-model/);
    assert.match(health.detail, /models\.example\.test/);
  });

  it('keeps OpenAI-compatible providers not-configured until API key is present', () => {
    const health = modelHealth(updateConfig(defaultSciForgeConfig, {
      modelProvider: 'openrouter',
      modelBaseUrl: 'https://openrouter.ai/api/v1',
      modelName: 'qwen/qwen3.6-plus:free',
      apiKey: '',
    }));

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.NOT_CONFIGURED);
    assert.match(String(health.recoverAction), /will not switch providers automatically/i);
    assert.doesNotMatch(String(health.recoverAction), /allowOpenAiRuntime/);
  });

  it('uses the shared provider preflight notice shape for repair display', () => {
    const notice = providerReadinessNoticeFromManifest({
      schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
      checkedAt: '2026-05-07T00:00:00.000Z',
      category: 'config-secret-source',
      owner: 'environment',
      releaseAcceptance: 'not-evaluated',
      evidenceMode: 'current-env-diagnostic-only',
      runtimeApiKeyPresentInServiceEnv: false,
      upstreamBaseUrlPresent: true,
      upstreamKeySourceKind: 'config-debug-fallback',
      upstreamBaseUrlSourceKind: 'config',
      missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
      policyViolations: [],
      nextActions: [{ label: 'Rerun provider preflight.', command: 'npm run smoke:runtime-provider-preflight', writesRepo: false }],
    });

    assert.equal(notice.ready, false);
    assert.equal(notice.state, 'partial');
    assert.match(notice.detail, /missing env: SCIFORGE_RUNTIME_API_KEY/);
    assert.equal(notice.recoverAction, 'npm run smoke:runtime-provider-preflight');
  });

  it('projects provider preflight into generic assistant connection health without env leaks', () => {
    const health = modelHealth(defaultSciForgeConfig, providerReadinessNoticeFromManifest({
      schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
      checkedAt: '2026-05-07T00:00:00.000Z',
      category: 'missing-runtime-env',
      owner: 'environment',
      releaseAcceptance: 'not-evaluated',
      evidenceMode: 'current-env-diagnostic-only',
      runtimeApiKeyPresentInServiceEnv: false,
      upstreamBaseUrlPresent: true,
      upstreamKeySourceKind: 'missing',
      upstreamBaseUrlSourceKind: 'config',
      missingEnv: ['SCIFORGE_RUNTIME_API_KEY'],
      policyViolations: [],
      nextActions: [{ label: 'Rerun provider preflight.', command: 'npm run smoke:runtime-provider-preflight', writesRepo: false }],
    }));

    assert.equal(health.id, 'model');
    assert.equal(health.label, 'Assistant Connection');
    assert.equal(health.source, 'runtime-provider-preflight');
    assert.equal(health.status, RUNTIME_HEALTH_STATUS.NOT_CONFIGURED);
    assert.match(health.detail, /Assistant connection preflight needs attention/);
    assert.doesNotMatch(health.detail, /SCIFORGE_RUNTIME_API_KEY|api key|provider URL|https?:\/\//i);
  });

  it('显示 Codex Runtime profile 健康状态', () => {
    const health = codexRuntimeHealth(defaultSciForgeConfig, true);

    assert.equal(health.id, 'codex-runtime');
    assert.equal(health.label, 'Codex Runtime');
    assert.equal(health.status, RUNTIME_HEALTH_STATUS.ONLINE);
    assert.match(health.detail, /Runtime Profile sciforge-runtime-deepseek/);
  });

  it('diagnoses stale Workspace Writer port drift when the default writer is reachable', () => {
    const health = workspaceWriterHealth(updateConfig(defaultSciForgeConfig, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:21431',
    }), false, true);

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.OFFLINE);
    assert.equal(health.detail, 'http://127.0.0.1:21431');
    assert.match(String(health.recoverAction), /默认 writer http:\/\/127\.0\.0\.1:5174 在线/);
    assert.match(String(health.recoverAction), /Settings/);
  });

  it('keeps the generic Workspace Writer recovery action when no default writer is reachable', () => {
    const health = workspaceWriterHealth(updateConfig(defaultSciForgeConfig, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:65535',
    }), false, false);

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.OFFLINE);
    assert.equal(health.recoverAction, '启动 npm run workspace:server 后刷新');
  });

  it('surfaces online Workspace Writers that need a restart before module dispatcher use', () => {
    const health = workspaceWriterHealth(defaultSciForgeConfig, {
      online: true,
      service: 'sciforge-workspace-writer',
      capabilities: ['workspace-files'],
    });

    assert.equal(health.status, RUNTIME_HEALTH_STATUS.OFFLINE);
    assert.equal(health.detail, defaultSciForgeConfig.workspaceWriterBaseUrl);
    assert.match(String(health.recoverAction), /runtime-module-dispatcher/);
    assert.match(String(health.recoverAction), /workspace:server/);
  });

  it('only treats workspace writer health as online when /health returns the writer service JSON', async () => {
    const ok = await probeWorkspaceWriterHealthUrl('http://127.0.0.1:6173/health', {
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        service: 'sciforge-workspace-writer',
        capabilities: { runtimeCodex: true },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });
    const viteHtml = await probeWorkspaceWriterHealthUrl('http://127.0.0.1:5174/health', {
      fetchImpl: async () => new Response('<!doctype html><title>Vite</title>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    });
    const wrongJson = await probeWorkspaceWriterHealthUrl('http://127.0.0.1:5174/health', {
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, service: 'vite-dev-server' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    });

    assert.equal(ok, true);
    assert.equal(viteHtml, false);
    assert.equal(wrongJson, false);
  });

  it('keeps Workspace Writer capabilities for feature-specific readiness checks', async () => {
    const probe = await probeWorkspaceWriterHealthDetailsUrl('http://127.0.0.1:6173/health', {
      fetchImpl: async () => new Response(JSON.stringify({
        ok: true,
        service: 'sciforge-workspace-writer',
        capabilities: ['workspace-files', 'runtime-module-dispatcher'],
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    });

    assert.equal(probe.online, true);
    assert.deepEqual(probe.capabilities, ['workspace-files', 'runtime-module-dispatcher']);
  });
});
