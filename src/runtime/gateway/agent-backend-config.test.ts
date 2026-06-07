import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import {
  BACKEND_ALLOW_DEFAULT_LLM_ENV,
  BACKEND_BASE_URL_ENV_KEYS,
  DEFAULT_BACKEND_BASE_URL,
  selectedAgentBackend,
  backendBaseUrlSelectionDecision,
  configuredBackendBaseUrl,
  effectiveBackendBaseUrl,
  requiresUserLlmEndpointForBackendBaseUrl,
} from './agent-backend-config.js';

test('AgentServer backend selection reuses the centralized runtime backend policy', () => {
  const originalBackend = process.env.SCIFORGE_AGENTSERVER_BACKEND;
  try {
    delete process.env.SCIFORGE_AGENTSERVER_BACKEND;
    assert.equal(selectedAgentBackend(gatewayRequest({ agentBackend: 'gemini' })), 'gemini');
    assert.equal(selectedAgentBackend(gatewayRequest({ agentBackend: 'not-supported' })), 'codex');
    assert.equal(selectedAgentBackend(gatewayRequest(), { baseUrl: 'https://llm.example.test/v1' }), 'openteam_agent');

    process.env.SCIFORGE_AGENTSERVER_BACKEND = 'openclaw';
    assert.equal(selectedAgentBackend(gatewayRequest()), 'openclaw');
  } finally {
    restoreEnv('SCIFORGE_AGENTSERVER_BACKEND', originalBackend);
  }
});

test('AgentServer base URL selection honors request, env, workspace config, then optional runtime default', () => {
  const originals = snapshotEnv(BACKEND_BASE_URL_ENV_KEYS);
  try {
    clearEnv(BACKEND_BASE_URL_ENV_KEYS);

    assert.equal(backendBaseUrlSelectionDecision().baseUrl, undefined);
    assert.equal(effectiveBackendBaseUrl(), DEFAULT_BACKEND_BASE_URL);

    const requestDecision = backendBaseUrlSelectionDecision({
      request: { agentServerBaseUrl: 'http://127.0.0.1:28080/' },
      workspaceConfigBaseUrl: 'http://workspace-agent.example.test',
    });
    assert.equal(requestDecision.baseUrl, 'http://127.0.0.1:28080');
    assert.equal(requestDecision.source, 'request.agentServerBaseUrl');

    process.env.SCIFORGE_AGENT_SERVER_URL = 'http://127.0.0.1:29080/';
    const envDecision = backendBaseUrlSelectionDecision({
      workspaceConfigBaseUrl: 'http://workspace-agent.example.test',
    });
    assert.equal(envDecision.baseUrl, 'http://127.0.0.1:29080');
    assert.equal(envDecision.source, 'env.SCIFORGE_AGENT_SERVER_URL');

    delete process.env.SCIFORGE_AGENT_SERVER_URL;
    assert.equal(configuredBackendBaseUrl({
      workspaceConfigBaseUrl: 'http://workspace-agent.example.test/',
    }), 'http://workspace-agent.example.test');
  } finally {
    restoreEnvSnapshot(originals);
  }
});

test('default local LLM guard follows centralized AgentServer URL config with env and request overrides', () => {
  const originals = snapshotEnv([...BACKEND_BASE_URL_ENV_KEYS, BACKEND_ALLOW_DEFAULT_LLM_ENV]);
  try {
    clearEnv(BACKEND_BASE_URL_ENV_KEYS);
    delete process.env[BACKEND_ALLOW_DEFAULT_LLM_ENV];

    assert.equal(requiresUserLlmEndpointForBackendBaseUrl(DEFAULT_BACKEND_BASE_URL), true);
    assert.equal(requiresUserLlmEndpointForBackendBaseUrl('http://127.0.0.1:28080'), false);

    assert.equal(
      requiresUserLlmEndpointForBackendBaseUrl(
        'http://localhost:28080/',
        { agentServerBaseUrl: 'http://127.0.0.1:28080' },
      ),
      true,
    );

    process.env.SCIFORGE_AGENTSERVER_BASE_URL = 'http://127.0.0.1:29080';
    assert.equal(requiresUserLlmEndpointForBackendBaseUrl('http://localhost:29080/'), true);

    process.env[BACKEND_ALLOW_DEFAULT_LLM_ENV] = '1';
    assert.equal(requiresUserLlmEndpointForBackendBaseUrl(DEFAULT_BACKEND_BASE_URL), false);
  } finally {
    restoreEnvSnapshot(originals);
  }
});

function gatewayRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'knowledge',
    prompt: 'test',
    artifacts: [],
    ...overrides,
  };
}

function snapshotEnv(keys: readonly string[]) {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function clearEnv(keys: readonly string[]) {
  for (const key of keys) delete process.env[key];
}

function restoreEnvSnapshot(snapshot: Map<string, string | undefined>) {
  for (const [key, value] of snapshot) restoreEnv(key, value);
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}
