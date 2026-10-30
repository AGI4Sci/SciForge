// Executable entry point for the sci-modality router worker.
// Reads local Model Router/listen config from the environment, starts the HTTP service, and
// shuts down cleanly on SIGINT/SIGTERM. The library surface lives in ./index.ts.
import { createSciModalityRouterServer, SCIMODALITY_ROUTER_RUNTIME_TOKEN_ENV } from './server.js';
import { MODEL_ROUTER_BASE_URL_ENV, expertConfigFromModelRouterEnv } from './experts.js';
import { MODALITIES } from './types.js';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const experts = expertConfigFromModelRouterEnv(process.env);

const host = process.env.SCIMODALITY_ROUTER_HOST ?? '127.0.0.1';
const port = Number(process.env.SCIMODALITY_ROUTER_PORT ?? 3898);
const runtimeToken = requiredEnv(SCIMODALITY_ROUTER_RUNTIME_TOKEN_ENV);
const maxBodyBytes = process.env.SCIMODALITY_ROUTER_MAX_BODY_BYTES
  ? Number(process.env.SCIMODALITY_ROUTER_MAX_BODY_BYTES)
  : undefined;

const server = createSciModalityRouterServer({ experts, runtimeToken, maxBodyBytes });
server.listen(port, host, () => {
  console.log(`SciForge Sci-Modality Router listening at http://${host}:${port}`);
  console.log(
    `Local Model Router: configured=true env=${MODEL_ROUTER_BASE_URL_ENV} experts=${MODALITIES.length} tokenGuard=enabled`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
