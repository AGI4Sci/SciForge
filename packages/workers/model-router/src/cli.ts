import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LocalTraceStore } from '@sciforge/full-trace';

import { startModelRouterServer, type ModelRouterConfig } from './router';
import { resolveModelRouterCliOptions } from './cli-options';
import { ModelRouterFullTraceRecorder } from './full-trace-recorder';

const options = resolveModelRouterCliOptions(process.argv.slice(2), process.env);
const config = loadModelRouterConfig(options.configPath);
if (!options.userDataDir) {
  throw new Error('Model Router requires --user-data-dir or SCIFORGE_MODEL_ROUTER_USER_DATA_DIR for durable tracing.');
}
const sensitiveValues = configuredSensitiveValues(config, process.env);
const traceStore = new LocalTraceStore({
  userDataDirectory: resolve(options.userDataDir),
  sensitiveValues: () => sensitiveValues,
});
await traceStore.initialize();
const fullTraceRecorder = new ModelRouterFullTraceRecorder({
  sink: traceStore,
  sensitiveValues: () => sensitiveValues,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-model-router] ${message}`),
});

const server = await startModelRouterServer({
  host: options.host,
  port: options.port,
  config,
  workspaceRoot: options.workspaceRoot,
  fullTraceRecorder,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-model-router] ${message}`),
});

if (!options.quiet) {
  console.log(`SciForge Model Router listening at ${server.url}/v1`);
  console.log(`Default router profile: ${config.defaultProfile}`);
  console.log(`Public model alias: ${config.publicModelAlias ?? 'sciforge-model-router'}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}

function loadModelRouterConfig(configPath: string | undefined): ModelRouterConfig {
  if (!configPath) throw new Error('Model Router requires --config.');
  const path = resolve(configPath);
  if (!existsSync(path)) throw new Error(`Model Router config file not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as ModelRouterConfig;
}

function configuredSensitiveValues(
  config: ModelRouterConfig,
  env: Record<string, string | undefined>,
): string[] {
  const names = new Set<string>();
  if (config.runtimeApiKeyEnv) names.add(config.runtimeApiKeyEnv);
  for (const profile of Object.values(config.profiles)) {
    names.add(profile.textReasoner.apiKeyEnv);
    if (profile.imageGenerator) names.add(profile.imageGenerator.apiKeyEnv);
    if (profile.translators.vision) names.add(profile.translators.vision.apiKeyEnv);
    if (profile.translators.scientific) names.add(profile.translators.scientific.tokenEnv);
  }
  return [...names].flatMap((name) => {
    const value = env[name]?.trim();
    return value ? [value] : [];
  });
}
