import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { startModelRouterServer, type ModelRouterConfig } from './router';
import { resolveModelRouterCliOptions } from './cli-options';

const options = resolveModelRouterCliOptions(process.argv.slice(2), process.env);
const config = loadModelRouterConfig(options.configPath);

const server = await startModelRouterServer({
  host: options.host,
  port: options.port,
  config,
  workspaceRoot: options.workspaceRoot,
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
  const resolved = configPath;
  if (resolved) {
    const path = resolve(resolved);
    if (!existsSync(path)) throw new Error(`Model Router config file not found: ${path}`);
    return JSON.parse(readFileSync(path, 'utf8')) as ModelRouterConfig;
  }
  return envModelRouterConfig();
}

function envModelRouterConfig(): ModelRouterConfig {
  const defaultProfile = process.env.SCIFORGE_MODEL_ROUTER_DEFAULT_PROFILE || 'sciforge-runtime-default';
  const visionBaseUrl = process.env.SCIFORGE_VISION_BASE_URL;
  const visionModel = process.env.SCIFORGE_VISION_MODEL;
  return {
    defaultProfile,
    publicModelAlias: process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS || 'sciforge-router',
    profiles: {
      [defaultProfile]: {
        traceRoot: process.env.SCIFORGE_MODEL_ROUTER_TRACE_ROOT || '.sciforge/model-router-traces',
        textReasoner: {
          provider: process.env.SCIFORGE_TEXT_PROVIDER || 'text-reasoner',
          baseUrl: requiredEnv('SCIFORGE_TEXT_BASE_URL'),
          apiKeyEnv: process.env.SCIFORGE_TEXT_API_KEY_ENV || 'SCIFORGE_TEXT_API_KEY',
          model: requiredEnv('SCIFORGE_TEXT_MODEL'),
        },
        translators: visionBaseUrl && visionModel
          ? {
              vision: {
                provider: process.env.SCIFORGE_VISION_PROVIDER || 'vision-translator',
                baseUrl: visionBaseUrl,
                apiKeyEnv: process.env.SCIFORGE_VISION_API_KEY_ENV || 'SCIFORGE_VISION_API_KEY',
                model: visionModel,
                maxSupplementRounds: numberEnv('SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS'),
              },
            }
          : {},
      },
    },
  };
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required Model Router environment variable: ${name}`);
  return value;
}

function numberEnv(name: string) {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
