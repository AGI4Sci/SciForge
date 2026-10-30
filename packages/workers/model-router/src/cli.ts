import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startModelRouterServer, type ModelRouterConfig } from './router';
import { resolveModelRouterCliOptions } from './cli-options';
import { ModelRouterFullTraceRecorder } from './full-trace-recorder';
import { ModelRouterFullTraceWorkerSink } from './full-trace-worker-sink';

const options = resolveModelRouterCliOptions(process.argv.slice(2), process.env);
const config = loadModelRouterConfig(options.configPath);
if (!options.userDataDir) {
  throw new Error('Model Router requires --user-data-dir or SCIFORGE_MODEL_ROUTER_USER_DATA_DIR for durable tracing.');
}
const sensitiveValues = configuredSensitiveValues(config, process.env);
const traceWriter = new ModelRouterFullTraceWorkerSink({
  userDataDirectory: resolve(options.userDataDir),
  sensitiveValues,
});
void traceWriter.initialize().catch((error: unknown) => {
  if (!options.quiet) {
    console.error(`[sciforge-model-router] Full Trace writer initialization failed: ${error instanceof Error ? error.message : String(error)}`);
  }
});
const fullTraceRecorder = new ModelRouterFullTraceRecorder({
  sink: traceWriter,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-model-router] ${message}`),
});

const server = await startModelRouterServer({
  host: options.host,
  port: options.port,
  config,
  workspaceRoot: options.workspaceRoot,
  fullTraceRecorder,
  fullTraceRequired: true,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-model-router] ${message}`),
}).catch(async (error: unknown) => {
  await traceWriter.close();
  throw error;
});

if (!options.quiet) {
  console.log(`SciForge Model Router listening at ${server.url}/v1`);
  console.log(`Default router profile: ${config.defaultProfile}`);
  console.log(`Public model alias: ${config.publicModelAlias ?? 'sciforge-model-router'}`);
}

let shutdownTask: Promise<void> | undefined;
const shutdown = (): Promise<void> => {
  if (shutdownTask) return shutdownTask;
  shutdownTask = (async () => {
    let failed = false;
    try {
      await server.close();
    } catch (error) {
      failed = true;
      if (!options.quiet) console.error(`[sciforge-model-router] Server shutdown failed: ${String(error)}`);
    }
    try {
      await traceWriter.close();
    } catch (error) {
      failed = true;
      if (!options.quiet) console.error(`[sciforge-model-router] Full Trace writer shutdown failed: ${String(error)}`);
    }
    process.exit(failed ? 1 : 0);
  })();
  return shutdownTask;
};

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void shutdown());
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
