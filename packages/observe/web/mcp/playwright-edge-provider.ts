import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID,
  PLAYWRIGHT_EDGE_MCP_PROVIDER_ID,
  playwrightEdgeMcpHttpUrl,
} from './playwright-edge';

export interface PlaywrightEdgeBrowserInvocationInput {
  task?: string;
  query?: string;
  url?: string;
  startUrl?: string;
  mode?: 'read' | 'search' | 'interactive' | 'download' | 'form';
  maxChars?: number;
  timeoutMs?: number;
  openFirstResult?: boolean;
  keepOpen?: boolean;
  requiresHumanTakeover?: boolean;
  mcpUrl?: string;
  workspaceProfileDir?: string;
  outputDir?: string;
}

export interface PlaywrightEdgeBrowserInvocationOutput {
  status: 'succeeded' | 'partial' | 'failed' | 'needs-human';
  capabilityId: typeof PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID;
  providerId: typeof PLAYWRIGHT_EDGE_MCP_PROVIDER_ID;
  mode: string;
  query?: string;
  url: string;
  title: string;
  text: string;
  observations: Array<{
    kind: string;
    text: string;
    url?: string;
    title?: string;
  }>;
  resultLinks?: Array<{ text: string; href: string }>;
  links?: Array<{ text: string; href: string }>;
  providerDiagnostics: {
    mcpUrl: string;
    transport: 'streamable-http' | 'sse';
    toolCount?: number;
    userAgent?: string;
    brands?: unknown;
    edgeDetected: boolean;
  };
}

export interface PlaywrightEdgeBrowserAutomationProvider {
  search(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  fetch(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface PlaywrightEdgeBrowserAutomationProviderOptions {
  mcpUrl?: string;
  maxChars?: number;
  timeoutMs?: number;
}

export function createPlaywrightEdgeBrowserAutomationProvider(
  defaults: PlaywrightEdgeBrowserAutomationProviderOptions = {},
): PlaywrightEdgeBrowserAutomationProvider {
  return {
    async search(input) {
      const query = stringField(input.query) ?? stringField(input.rawQuery);
      if (!query) throw new Error('playwright_edge_browser search requires query.');
      const limit = clampNumber(input.limit ?? input.maxResults, 5, 1, 10);
      const output = await invokePlaywrightEdgeBrowser({
        query,
        mode: 'search',
        openFirstResult: false,
        mcpUrl: stringField(input.mcpUrl) ?? defaults.mcpUrl,
        maxChars: numberField(input.maxChars) ?? defaults.maxChars,
        timeoutMs: numberField(input.timeoutMs) ?? defaults.timeoutMs,
      });
      return {
        query,
        rawQuery: stringField(input.rawQuery) ?? query,
        provider: 'playwright-edge-mcp',
        engine: 'bing-rendered-edge-mcp',
        finalUrl: output.url,
        status: output.status,
        ok: output.status === 'succeeded' || output.status === 'partial',
        title: output.title,
        rendered: true,
        resultLinks: output.resultLinks ?? [],
        results: (output.resultLinks ?? []).slice(0, limit).map((link) => ({
          title: link.text || link.href,
          url: link.href,
          snippet: link.text,
        })),
        providerDiagnostics: publicProviderDiagnostics(output.providerDiagnostics),
      };
    },
    async fetch(input) {
      const url = stringField(input.url);
      if (!url) throw new Error('playwright_edge_browser fetch requires url.');
      const output = await invokePlaywrightEdgeBrowser({
        url,
        mode: 'read',
        mcpUrl: stringField(input.mcpUrl) ?? defaults.mcpUrl,
        maxChars: numberField(input.maxChars) ?? defaults.maxChars,
        timeoutMs: numberField(input.timeoutMs) ?? defaults.timeoutMs,
      });
      return {
        url,
        finalUrl: output.url,
        status: output.status === 'failed' ? 0 : 200,
        ok: output.status === 'succeeded' || output.status === 'partial',
        provider: 'playwright-edge-mcp',
        rendered: true,
        title: output.title,
        text: output.text,
        links: (output.links ?? []).map((link) => ({ text: link.text, url: link.href })),
        observations: output.observations,
        providerDiagnostics: publicProviderDiagnostics(output.providerDiagnostics),
      };
    },
  };
}

interface ConnectedMcpClient {
  client: Client;
  transport: 'streamable-http' | 'sse';
}

interface PageInfo {
  title: string;
  url: string;
  text: string;
  userAgent: string;
  brands?: unknown;
  links?: Array<{ text: string; href: string }>;
}

export async function invokePlaywrightEdgeBrowser(
  input: PlaywrightEdgeBrowserInvocationInput,
): Promise<PlaywrightEdgeBrowserInvocationOutput> {
  const mcpUrl = normalizedMcpUrl(input.mcpUrl);
  const connected = await connectPlaywrightMcp(mcpUrl);
  const { client } = connected;
  try {
    const tools = await client.listTools();
    const mode = input.mode ?? (input.query ? 'search' : 'read');
    const query = normalizedQuery(input);
    const startUrl = normalizedStartUrl(input, query);

    await callToolText(client, 'browser_navigate', { url: startUrl });
    await callToolText(client, 'browser_wait_for', { time: 1 });

    let resultLinks: Array<{ text: string; href: string }> | undefined;
    if (query) {
      resultLinks = await browserResultLinks(client);
      const first = input.openFirstResult === false ? undefined : resultLinks[0];
      if (first?.href) {
        await callToolText(client, 'browser_navigate', { url: first.href });
        await callToolText(client, 'browser_wait_for', { time: 2 });
      }
    }

    const pageInfo = await browserPageInfo(client, input.maxChars ?? 4000);
    if (!input.keepOpen && input.requiresHumanTakeover !== true) {
      await callToolText(client, 'browser_close', {}).catch(() => undefined);
    }
    return {
      status: pageInfo.text ? 'succeeded' : 'partial',
      capabilityId: PLAYWRIGHT_EDGE_MCP_CAPABILITY_ID,
      providerId: PLAYWRIGHT_EDGE_MCP_PROVIDER_ID,
      mode,
      ...(query ? { query } : {}),
      url: pageInfo.url,
      title: pageInfo.title,
      text: pageInfo.text,
      observations: [{
        kind: query ? 'browser-search-result-page' : 'browser-page-text',
        text: pageInfo.text,
        url: pageInfo.url,
        title: pageInfo.title,
      }],
      ...(resultLinks ? { resultLinks } : {}),
      ...(pageInfo.links ? { links: pageInfo.links } : {}),
      providerDiagnostics: {
        mcpUrl,
        transport: connected.transport,
        toolCount: tools.tools.length,
        userAgent: pageInfo.userAgent,
        brands: pageInfo.brands,
        edgeDetected: /Edg\//.test(pageInfo.userAgent) || JSON.stringify(pageInfo.brands ?? '').includes('Microsoft Edge'),
      },
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function connectPlaywrightMcp(mcpUrl: string): Promise<ConnectedMcpClient> {
  const client = new Client({ name: 'sciforge-playwright-edge-provider', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
    return { client, transport: 'streamable-http' };
  } catch (error) {
    await client.close().catch(() => undefined);
    const sseClient = new Client({ name: 'sciforge-playwright-edge-provider', version: '0.1.0' });
    const sseUrl = mcpUrl.replace(/\/mcp(?:[?#].*)?$/i, '/sse');
    try {
      await sseClient.connect(new SSEClientTransport(new URL(sseUrl)));
      return { client: sseClient, transport: 'sse' };
    } catch {
      throw error;
    }
  }
}

async function browserResultLinks(client: Client): Promise<Array<{ text: string; href: string }>> {
  const raw = await callToolText(client, 'browser_evaluate', {
    function: `() => Array.from(document.querySelectorAll('a')).map((anchor) => ({
      text: (anchor.innerText || anchor.textContent || '').replace(/\\s+/g, ' ').trim(),
      href: anchor.href
    })).filter((item) => item.href && /^https?:\\/\\//i.test(item.href) && !/\\b(?:bing|microsoft)\\.com\\//i.test(item.href)).slice(0, 10)`,
  });
  return parseToolJsonResult<unknown[]>(raw, []).filter(isLinkRecord).map((link) => ({
    text: link.text,
    href: link.href,
  }));
}

async function browserPageInfo(client: Client, maxChars: number): Promise<PageInfo> {
  const raw = await callToolText(client, 'browser_evaluate', {
    function: `() => {
      const text = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, ${JSON.stringify(maxChars)}) : '';
      const links = Array.from(document.querySelectorAll('a')).slice(0, 50).map((anchor) => ({
        text: (anchor.innerText || anchor.textContent || '').replace(/\\s+/g, ' ').trim(),
        href: anchor.href
      })).filter((item) => item.href);
      return {
        title: document.title,
        url: location.href,
        text,
        userAgent: navigator.userAgent,
        brands: navigator.userAgentData?.brands || null,
        links
      };
    }`,
  });
  const parsed = parseToolJsonResult<PageInfo>(raw, {
    title: '',
    url: '',
    text: '',
    userAgent: '',
    links: [],
  });
  return {
    title: parsed.title ?? '',
    url: parsed.url ?? '',
    text: parsed.text ?? '',
    userAgent: parsed.userAgent ?? '',
    brands: parsed.brands,
    links: Array.isArray(parsed.links) ? parsed.links.filter(isLinkRecord) : [],
  };
}

async function callToolText(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.map((part: unknown) => {
    if (isTextContent(part)) return part.text;
    return '';
  }).filter(Boolean).join('\n');
  if ((result as { isError?: unknown }).isError === true) {
    throw new Error(text || `Playwright MCP tool ${name} failed.`);
  }
  return text;
}

function normalizedMcpUrl(inputUrl: string | undefined) {
  const fromEnv = process.env.SCIFORGE_PLAYWRIGHT_EDGE_MCP_URL;
  return (inputUrl || fromEnv || playwrightEdgeMcpHttpUrl()).trim();
}

function normalizedQuery(input: PlaywrightEdgeBrowserInvocationInput) {
  if (input.query?.trim()) return input.query.trim();
  if (input.mode === 'search' && input.task?.trim()) return input.task.trim();
  return undefined;
}

function normalizedStartUrl(input: PlaywrightEdgeBrowserInvocationInput, query: string | undefined) {
  const explicit = input.url?.trim() || input.startUrl?.trim() || urlFromTask(input.task);
  if (explicit) return explicit;
  if (query) return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  throw new Error('playwright_edge_browser requires url, startUrl, query, or a task containing a URL.');
}

function urlFromTask(task: string | undefined) {
  return task?.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
}

function parseToolJsonResult<T>(text: string, fallback: T): T {
  const resultMatch = text.match(/### Result\s*\n([\s\S]*?)(?:\n### |\n```|$)/);
  const candidate = (resultMatch?.[1] ?? text).trim();
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const jsonMatch = candidate.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (!jsonMatch) return fallback;
    try {
      return JSON.parse(jsonMatch[1] ?? '') as T;
    } catch {
      return fallback;
    }
  }
}

function isLinkRecord(value: unknown): value is { text: string; href: string } {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { text?: unknown }).text === 'string'
    && typeof (value as { href?: unknown }).href === 'string'
    && (value as { href: string }).href.length > 0;
}

function isTextContent(value: unknown): value is { type: 'text'; text: string } {
  return Boolean(value)
    && typeof value === 'object'
    && (value as { type?: unknown }).type === 'text'
    && typeof (value as { text?: unknown }).text === 'string';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function publicProviderDiagnostics(diagnostics: PlaywrightEdgeBrowserInvocationOutput['providerDiagnostics']) {
  return {
    transport: diagnostics.transport,
    toolCount: diagnostics.toolCount,
    edgeDetected: diagnostics.edgeDetected,
  };
}
