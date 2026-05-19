import { startCodexResponsesProxyServer } from './proxy';

type CliOptions = {
  host: string;
  port: number;
  upstreamBaseUrl: string;
  apiKeyEnv: string;
  defaultModel?: string;
  quiet: boolean;
};

const options = parseArgs(process.argv.slice(2));
if (!options.upstreamBaseUrl) {
  console.error('Missing upstream base URL. Set SCIFORGE_PROXY_UPSTREAM_BASE_URL or pass --upstream-base-url.');
  process.exit(2);
}

const upstreamApiKey = process.env[options.apiKeyEnv];
const server = await startCodexResponsesProxyServer({
  host: options.host,
  port: options.port,
  upstreamBaseUrl: options.upstreamBaseUrl,
  upstreamApiKey,
  defaultModel: options.defaultModel,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-backend] ${message}`),
});

if (!options.quiet) {
  console.log(`SciForge Codex Responses proxy listening at ${server.url}/v1`);
  console.log(`Upstream Chat Completions base URL: ${options.upstreamBaseUrl}`);
  console.log(`Upstream key source: ${upstreamApiKey ? options.apiKeyEnv : 'incoming Authorization header'}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}

function parseArgs(args: string[]): CliOptions {
  const get = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };

  return {
    host: get('--host') ?? process.env.SCIFORGE_PROXY_HOST ?? '127.0.0.1',
    port: Number(get('--port') ?? process.env.SCIFORGE_PROXY_PORT ?? 3891),
    upstreamBaseUrl: get('--upstream-base-url') ?? process.env.SCIFORGE_PROXY_UPSTREAM_BASE_URL ?? '',
    apiKeyEnv: get('--api-key-env') ?? process.env.SCIFORGE_PROXY_API_KEY_ENV ?? 'SCIFORGE_RUNTIME_API_KEY',
    defaultModel: get('--default-model') ?? process.env.SCIFORGE_PROXY_DEFAULT_MODEL,
    quiet: args.includes('--quiet') || process.env.SCIFORGE_PROXY_QUIET === '1',
  };
}
