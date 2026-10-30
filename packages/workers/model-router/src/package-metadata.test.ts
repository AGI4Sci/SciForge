import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MODEL_ROUTER_WORKER_CAPABILITIES,
  MODEL_ROUTER_WORKER_VERSION,
  modelRouterManifest
} from './manifest.js';

test('manifest exposes model-router worker diagnostics metadata without private bindings', () => {
  assert.equal(modelRouterManifest.workerVersion, MODEL_ROUTER_WORKER_VERSION);
  assert.deepEqual(modelRouterManifest.capabilities, [...MODEL_ROUTER_WORKER_CAPABILITIES]);
  assert.equal(
    modelRouterManifest.tools.every((tool) => tool.sideEffects.includes('network')),
    true
  );
  assert.equal(
    modelRouterManifest.tools
      .filter((tool) => !['model_router_image_generations', 'model_router_image_edits'].includes(tool.id))
      .every((tool) => tool.sideEffects.includes('filesystem')),
    true
  );
  assert.doesNotMatch(JSON.stringify(modelRouterManifest), /apiKeyEnv|baseUrl|Bearer|secret/i);
});

test('package metadata declares model-router as an HTTP sidecar, not an MCP server', async () => {
  const metadata = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8')
  ) as {
    exports: Record<string, string>;
    sciforge: Record<string, unknown>;
  };

  assert.equal(metadata.sciforge.lifecycleLayer, 'workers');
  assert.equal(metadata.sciforge.publicContract, true);
  assert.equal(metadata.sciforge.runtimeAdapter, true);
  assert.equal(metadata.sciforge.mcpServer, false);
  assert.equal(metadata.sciforge.sideEffects, 'network, filesystem');
  assert.equal(metadata.exports['./manifest'], './src/manifest.ts');
  assert.equal(metadata.exports['./server'], './src/router.ts');
});
