import { startResearchSearchMcpServer } from './mcp-server.js';
import { createResearchSearchWorkerService, researchSearchConfigFromEnv } from './service.js';

const quiet = process.argv.includes('--quiet');
const config = researchSearchConfigFromEnv();
const service = createResearchSearchWorkerService(config);

if (!quiet) {
  console.error('[sciforge-research-search] starting MCP stdio server');
  console.error(`[sciforge-research-search] maxResults=${config.maxResults} timeoutMs=${config.timeoutMs}`);
}

await startResearchSearchMcpServer(service);
