import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DEFAULT_MODEL_ROUTER_TRACE_ROOT, startModelRouterServer, type ModelRouterConfig } from './router';
import { resolveModelRouterCliOptions } from './cli-options';

const options = resolveModelRouterCliOptions(process.argv.slice(2), process.env);
const config = loadModelRouterConfig(options.configPath);

const server = await startModelRouterServer({
  host: options.host,
  port: options.port,
  config,
  workspaceRoot: options.workspaceRoot,
  traceDataRoot: options.traceDataRoot,
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
  const imageBaseUrl = process.env.SCIFORGE_IMAGE_BASE_URL;
  const imageModel = process.env.SCIFORGE_IMAGE_MODEL;
  const scientificBaseUrl = process.env.SCIFORGE_SCIMODALITY_SERVICE_URL;
  const translators: ModelRouterConfig['profiles'][string]['translators'] = {};
  if (visionBaseUrl && visionModel) {
    translators.vision = {
      provider: process.env.SCIFORGE_VISION_PROVIDER || 'vision-translator',
      baseUrl: visionBaseUrl,
      apiKeyEnv: process.env.SCIFORGE_VISION_API_KEY_ENV || 'SCIFORGE_VISION_API_KEY',
      model: visionModel,
      maxSupplementRounds: numberEnv('SCIFORGE_VISION_MAX_SUPPLEMENT_ROUNDS'),
    };
  }
  if (scientificBaseUrl) {
    translators.scientific = {
      baseUrl: scientificBaseUrl,
      tokenEnv: process.env.SCIFORGE_SCIMODALITY_SERVICE_TOKEN_ENV || 'SCIFORGE_SCIMODALITY_SERVICE_TOKEN',
      model: requiredEnv('SCIFORGE_SCIMODALITY_SERVICE_MODEL'),
      timeoutMs: numberEnv('SCIFORGE_SCIMODALITY_SERVICE_TIMEOUT_MS'),
    };
  }
  return {
    defaultProfile,
    publicModelAlias: process.env.SCIFORGE_MODEL_ROUTER_PUBLIC_MODEL_ALIAS || 'sciforge-router',
    profiles: {
      [defaultProfile]: {
        traceRoot: process.env.SCIFORGE_MODEL_ROUTER_TRACE_ROOT || DEFAULT_MODEL_ROUTER_TRACE_ROOT,
        textReasoner: {
          provider: process.env.SCIFORGE_TEXT_PROVIDER || 'text-reasoner',
          baseUrl: requiredEnv('SCIFORGE_TEXT_BASE_URL'),
          apiKeyEnv: process.env.SCIFORGE_TEXT_API_KEY_ENV || 'SCIFORGE_TEXT_API_KEY',
          model: requiredEnv('SCIFORGE_TEXT_MODEL'),
          endpointFormat: endpointFormatEnv('SCIFORGE_TEXT_ENDPOINT_FORMAT'),
        },
        ...(imageBaseUrl && imageModel
          ? {
              imageGenerator: {
                provider: process.env.SCIFORGE_IMAGE_PROVIDER || 'image-generator',
                baseUrl: imageBaseUrl,
                apiKeyEnv: process.env.SCIFORGE_IMAGE_API_KEY_ENV || 'SCIFORGE_IMAGE_API_KEY',
                model: imageModel,
              },
            }
          : {}),
        translators,
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

function endpointFormatEnv(name: string): 'chat_completions' | 'responses' | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (value === 'chat_completions' || value === 'responses') return value;
  throw new Error(`${name} must be "chat_completions" or "responses".`);
}
