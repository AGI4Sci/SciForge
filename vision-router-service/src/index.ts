import { createVisionRouterServer } from './server.js';
import type { QwenConfig } from './qwen.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const qwen: QwenConfig = {
  baseUrl: requiredEnv('VISION_PROVIDER_BASE_URL'),
  apiKey: requiredEnv('VISION_PROVIDER_API_KEY'),
  model: process.env.VISION_PROVIDER_MODEL ?? 'Qwen3.7-Plus',
  // The main agent has no vision, so this service owns "keep trying until Qwen answers": each
  // attempt waits generously and transient failures are retried with backoff (see qwen.ts).
  timeoutMs: Number(process.env.VISION_PROVIDER_TIMEOUT_MS ?? 180_000),
  maxAttempts: Number(process.env.VISION_PROVIDER_MAX_ATTEMPTS ?? 6),
  retryBaseMs: Number(process.env.VISION_PROVIDER_RETRY_BASE_MS ?? 1_500),
};

const host = process.env.VISION_ROUTER_HOST ?? '127.0.0.1';
const port = Number(process.env.VISION_ROUTER_PORT ?? 3899);

const server = createVisionRouterServer({ qwen });
server.listen(port, host, () => {
  console.log(`SciForge Vision Router listening at http://${host}:${port}`);
  console.log(`Vision provider: ${qwen.model} @ ${qwen.baseUrl}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
