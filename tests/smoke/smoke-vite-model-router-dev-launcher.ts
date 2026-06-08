import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = await readFile(join(process.cwd(), 'vite.config.ts'), 'utf8');
const providerModelsBlock = blockAfter(source, "server.middlewares.use('/api/sciforge/provider-models'");
const runtimeStartBlock = blockAfter(source, "server.middlewares.use('/api/sciforge/runtime/start'");

assert.match(source, /MODEL_ROUTER_PORT/, 'vite dev launcher must name the Model Router port explicitly');
assert.doesNotMatch(source, /\bCODEX_PROXY_PORT\b/, 'vite dev launcher must not keep the legacy codex proxy port path');
assert.match(providerModelsBlock, /modelRouterBaseUrl\(\)/, 'provider model catalog must query the Model Router model list');
assert.doesNotMatch(providerModelsBlock, /SCIFORGE_PROXY_PORT|CODEX_PROXY_PORT/, 'provider model catalog must not query the legacy proxy port');

assert.doesNotMatch(runtimeStartBlock, /agentserver|AgentServer|AGENT_SERVER_ROOT|agentServerEnv|agentServerModelEnvFromLocalConfig/i, 'runtime/start must not autostart AgentServer or inject raw LLM env');
assert.doesNotMatch(source, /AGENT_SERVER_MODEL_API_KEY|AGENT_SERVER_ADAPTER_LLM_API_KEY|agentServerModelEnvFromLocalConfig/, 'vite dev launcher must not read raw config.local LLM secrets for AgentServer');

console.log('[ok] vite dev launcher uses Model Router and does not autostart AgentServer/raw LLM path');

function blockAfter(text: string, marker: string): string {
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing marker: ${marker}`);
  const rest = text.slice(start);
  const next = rest.indexOf("server.middlewares.use('", marker.length);
  return next >= 0 ? rest.slice(0, next) : rest;
}
