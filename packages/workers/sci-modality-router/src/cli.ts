// Executable entry point for the sci-modality router worker.
// Reads provider/listen config from the environment, starts the HTTP service, and
// shuts down cleanly on SIGINT/SIGTERM. The library surface lives in ./index.ts.
import { createSciModalityRouterServer } from './server.js';
import type { ExpertConfig } from './experts.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const experts: ExpertConfig = {
  baseUrl: requiredEnv('EXPERT_PROVIDER_BASE_URL'),
  // The expert-translator is a local GPU service; an API key is usually irrelevant but kept
  // for OpenAI-compatible wire format / future auth. Defaults to a placeholder.
  apiKey: process.env.EXPERT_PROVIDER_API_KEY ?? 'sk-local',
  // The main agent cannot read these modalities, so this service owns "keep trying until the
  // expert answers": each attempt waits generously and transient failures are retried (experts.ts).
  timeoutMs: Number(process.env.EXPERT_PROVIDER_TIMEOUT_MS ?? 180_000),
  maxAttempts: Number(process.env.EXPERT_PROVIDER_MAX_ATTEMPTS ?? 6),
  retryBaseMs: Number(process.env.EXPERT_PROVIDER_RETRY_BASE_MS ?? 1_500),
};

const host = process.env.SCIMODALITY_ROUTER_HOST ?? '127.0.0.1';
const port = Number(process.env.SCIMODALITY_ROUTER_PORT ?? 3898);

const server = createSciModalityRouterServer({ experts });
server.listen(port, host, () => {
  console.log(`SciForge Sci-Modality Router listening at http://${host}:${port}`);
  console.log(`Expert provider: ${experts.baseUrl}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
