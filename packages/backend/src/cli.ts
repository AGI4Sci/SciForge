import { startCodexResponsesProxyServer } from './proxy';
import { resolveProxyCliOptions } from './cli-config';

const options = resolveProxyCliOptions(process.argv.slice(2));
if (!options.upstreamBaseUrl) {
  console.error('Missing upstream base URL. Set config.local.json codexProxy.upstreamBaseUrl, SCIFORGE_PROXY_UPSTREAM_BASE_URL, or pass --upstream-base-url.');
  process.exit(2);
}

const server = await startCodexResponsesProxyServer({
  host: options.host,
  port: options.port,
  upstreamBaseUrl: options.upstreamBaseUrl,
  upstreamApiKey: options.upstreamApiKey,
  defaultModel: options.defaultModel,
  log: options.quiet ? undefined : (message) => console.error(`[sciforge-backend] ${message}`),
});

if (!options.quiet) {
  console.log(`SciForge Codex Responses proxy listening at ${server.url}/v1`);
  console.log(`Upstream Chat Completions base URL: ${options.upstreamBaseUrl}`);
  console.log(`Upstream key source: ${options.upstreamKeySource ?? 'incoming Authorization header'}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}
