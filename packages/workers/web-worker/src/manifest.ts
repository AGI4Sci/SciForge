import type { ToolWorkerManifest } from '../../../contracts/tool-worker/src/index';

export const webWorkerManifest: ToolWorkerManifest = {
  protocolVersion: 'sciforge.tools.v1',
  workerId: 'sciforge.web-worker',
  workerVersion: '0.1.0',
  description: 'Read-only web search and fetch worker for SciForge agents.',
  capabilities: ['web_search', 'web_fetch', 'read_only_network'],
  providers: [
    {
      providerId: 'sciforge.web-worker.web_search',
      capabilityId: 'web_search',
      transport: 'http',
      invokePath: '/invoke',
      healthPath: '/health',
      manifestPath: '/manifest',
      permissions: ['network'],
      status: 'available',
    },
    {
      providerId: 'sciforge.web-worker.web_fetch',
      capabilityId: 'web_fetch',
      transport: 'http',
      invokePath: '/invoke',
      healthPath: '/health',
      manifestPath: '/manifest',
      permissions: ['network'],
      status: 'available',
    },
  ],
  tools: [
    {
      id: 'web_search',
      name: 'Web Search',
      version: '0.1.0',
      description: 'Search the public web and return compact organic result records.',
      inputSchema: {
        query: { type: 'string', required: true, description: 'Search query.' },
        limit: { type: 'number', description: 'Maximum number of results, from 1 to 10.', default: 5 },
        region: { type: 'string', description: 'Optional DuckDuckGo region code, for example us-en.' },
      },
      outputSchema: {
        query: { type: 'string', required: true },
        results: { type: 'array', required: true },
      },
      sideEffects: ['network'],
      timeoutMs: 15000,
      tags: ['web', 'search', 'research'],
    },
    {
      id: 'web_fetch',
      name: 'Web Fetch',
      version: '0.1.0',
      description: 'Fetch a URL and extract readable text from HTML or plain text responses.',
      inputSchema: {
        url: { type: 'string', required: true, description: 'HTTP or HTTPS URL to fetch.' },
        maxChars: { type: 'number', description: 'Maximum text characters to return.', default: 12000 },
      },
      outputSchema: {
        url: { type: 'string', required: true },
        finalUrl: { type: 'string', required: true },
        status: { type: 'number', required: true },
        title: { type: 'string' },
        text: { type: 'string', required: true },
      },
      sideEffects: ['network'],
      timeoutMs: 20000,
      tags: ['web', 'fetch', 'research'],
    },
  ],
};
