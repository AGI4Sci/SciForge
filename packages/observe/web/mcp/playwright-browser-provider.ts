import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import {
  PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID,
  PLAYWRIGHT_BROWSER_MCP_DEFAULT_BROWSER,
  PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID,
  playwrightBrowserMcpHttpUrl,
  playwrightBrowserMcpOutputDir,
  type PlaywrightBrowserMcpBrowser,
} from './playwright-browser';

export interface PlaywrightBrowserAutomationInvocationInput {
  task?: string;
  query?: string;
  url?: string;
  startUrl?: string;
  mode?: 'read' | 'search' | 'interactive' | 'download' | 'form';
  maxChars?: number;
  maxLinks?: number;
  timeoutMs?: number;
  openFirstResult?: boolean;
  keepOpen?: boolean;
  requiresHumanTakeover?: boolean;
  mcpUrl?: string;
  browserName?: PlaywrightBrowserMcpBrowser | string;
  extract?: PlaywrightBrowserPageExtractionSpec;
  actions?: PlaywrightBrowserAction[];
  download?: PlaywrightBrowserDownloadSpec;
  outputDir?: string;
}

export type PlaywrightBrowserElementSource = 'item' | 'detail' | 'document';

export interface PlaywrightBrowserRepeatedItemsFieldSpec {
  name: string;
  source?: PlaywrightBrowserElementSource;
  selector?: string;
  attr?: string;
  multiple?: boolean;
  regex?: string;
}

export interface PlaywrightBrowserRepeatedItemsSectionSpec {
  headingSelector?: string;
  startText?: string;
  startPattern?: string;
  stopTexts?: string[];
  stopPatterns?: string[];
}

export interface PlaywrightBrowserRepeatedItemsExtractionSpec {
  kind: 'repeated-items';
  itemSelector: string;
  detailSource?: 'item' | 'nextElementSibling';
  section?: PlaywrightBrowserRepeatedItemsSectionSpec;
  maxItems?: number;
  fields?: PlaywrightBrowserRepeatedItemsFieldSpec[];
}

export type PlaywrightBrowserPageExtractionSpec = PlaywrightBrowserRepeatedItemsExtractionSpec;

export interface PlaywrightBrowserPageExtractionOutput {
  kind: PlaywrightBrowserPageExtractionSpec['kind'];
  count: number;
  items: Array<Record<string, unknown>>;
  diagnostics: Record<string, unknown>;
}

export type PlaywrightBrowserActionType =
  | 'navigate'
  | 'back'
  | 'wait'
  | 'click'
  | 'scroll'
  | 'hover'
  | 'type'
  | 'fillForm'
  | 'pressKey'
  | 'selectOption'
  | 'drag'
  | 'drop'
  | 'uploadFiles'
  | 'handleDialog'
  | 'resize'
  | 'tabs'
  | 'snapshot'
  | 'screenshot'
  | 'evaluate'
  | 'consoleMessages'
  | 'networkRequests'
  | 'networkRequest'
  | 'downloadLinks';

export interface PlaywrightBrowserAction {
  type: PlaywrightBrowserActionType;
  [key: string]: unknown;
}

export interface PlaywrightBrowserActionResult {
  type: PlaywrightBrowserActionType;
  status: 'succeeded' | 'failed';
  toolName?: string;
  text?: string;
  data?: unknown;
  error?: string;
}

export interface PlaywrightBrowserDownloadSpec {
  selector?: string;
  hrefPattern?: string;
  textPattern?: string;
  urls?: string[];
  maxFiles?: number;
  maxBytes?: number;
  outputDir?: string;
  filenamePrefix?: string;
}

export interface PlaywrightBrowserDownloadRef {
  status: 'downloaded' | 'failed' | 'skipped';
  sourceUrl: string;
  localPath?: string;
  filename?: string;
  bytes?: number;
  contentType?: string;
  sha256?: string;
  reason?: string;
}

export interface PlaywrightBrowserAutomationInvocationOutput {
  status: 'succeeded' | 'partial' | 'failed' | 'needs-human';
  capabilityId: typeof PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID;
  providerId: typeof PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID;
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
  structuredData?: PlaywrightBrowserPageExtractionOutput;
  actionResults?: PlaywrightBrowserActionResult[];
  downloadRefs?: PlaywrightBrowserDownloadRef[];
  providerDiagnostics: {
    mcpUrl: string;
    transport: 'streamable-http' | 'sse';
    toolCount?: number;
    userAgent?: string;
    brands?: unknown;
    browserName: string;
    outputDir: string;
    headlessIsolatedDefault: true;
  };
}

export interface PlaywrightBrowserAutomationProvider {
  search(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  fetch(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface PlaywrightBrowserAutomationProviderOptions {
  mcpUrl?: string;
  browserName?: PlaywrightBrowserMcpBrowser | string;
  maxChars?: number;
  timeoutMs?: number;
}

export function createPlaywrightBrowserAutomationProvider(
  defaults: PlaywrightBrowserAutomationProviderOptions = {},
): PlaywrightBrowserAutomationProvider {
  return {
    async search(input) {
      const query = stringField(input.query) ?? stringField(input.rawQuery);
      if (!query) throw new Error('playwright_browser_automation search requires query.');
      const limit = clampNumber(input.limit ?? input.maxResults, 5, 1, 10);
      const output = await invokePlaywrightBrowserAutomation({
        query,
        mode: 'search',
        openFirstResult: false,
        mcpUrl: stringField(input.mcpUrl) ?? defaults.mcpUrl,
        browserName: stringField(input.browserName) ?? defaults.browserName,
        maxChars: numberField(input.maxChars) ?? defaults.maxChars,
        maxLinks: numberField(input.maxLinks),
        timeoutMs: numberField(input.timeoutMs) ?? defaults.timeoutMs,
      });
      return {
        query,
        rawQuery: stringField(input.rawQuery) ?? query,
        provider: 'playwright-browser-mcp',
        engine: `${output.providerDiagnostics.browserName}-rendered-mcp`,
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
      if (!url) throw new Error('playwright_browser_automation fetch requires url.');
      const output = await invokePlaywrightBrowserAutomation({
        url,
        mode: 'read',
        mcpUrl: stringField(input.mcpUrl) ?? defaults.mcpUrl,
        browserName: stringField(input.browserName) ?? defaults.browserName,
        maxChars: numberField(input.maxChars) ?? defaults.maxChars,
        maxLinks: numberField(input.maxLinks),
        timeoutMs: numberField(input.timeoutMs) ?? defaults.timeoutMs,
        extract: pageExtractionSpecField(input.extract),
        actions: browserActionsField(input.actions),
        download: browserDownloadSpecField(input.download),
        outputDir: stringField(input.outputDir),
      });
      return {
        url,
        finalUrl: output.url,
        status: output.status === 'failed' ? 0 : 200,
        ok: output.status === 'succeeded' || output.status === 'partial',
        provider: 'playwright-browser-mcp',
        rendered: true,
        title: output.title,
        text: output.text,
        links: (output.links ?? []).map((link) => ({ text: link.text, url: link.href })),
        structuredData: output.structuredData,
        actionResults: output.actionResults,
        downloadRefs: output.downloadRefs,
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

export async function invokePlaywrightBrowserAutomation(
  input: PlaywrightBrowserAutomationInvocationInput,
): Promise<PlaywrightBrowserAutomationInvocationOutput> {
  const mcpUrl = normalizedMcpUrl(input.mcpUrl);
  const outputDir = normalizedOutputDir(input.outputDir);
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
      resultLinks = await browserResultLinks(client, input.maxLinks ?? 10);
      const first = input.openFirstResult === false ? undefined : resultLinks[0];
      if (first?.href) {
        await callToolText(client, 'browser_navigate', { url: first.href });
        await callToolText(client, 'browser_wait_for', { time: 2 });
      }
    }

    const actionResults = input.actions?.length
      ? await executeBrowserActions(client, input.actions, { outputDir })
      : undefined;
    const actionDownloadRefs = (actionResults ?? []).flatMap((result) => {
      const refs = (result.data as { downloadRefs?: unknown } | undefined)?.downloadRefs;
      return Array.isArray(refs) ? refs.filter(isDownloadRefRecord) : [];
    });
    const explicitDownloadRefs = input.download
      ? await downloadMatchingPageLinks(client, input.download, outputDir)
      : [];
    const downloadRefs = [...actionDownloadRefs, ...explicitDownloadRefs];
    const pageInfo = await browserPageInfo(client, input.maxChars ?? 4000, input.maxLinks ?? 50);
    const structuredData = input.extract ? await browserExtractStructuredData(client, input.extract) : undefined;
    if (!input.keepOpen && input.requiresHumanTakeover !== true) {
      await callToolText(client, 'browser_close', {}).catch(() => undefined);
    }
    return {
      status: pageInfo.text || (structuredData?.count ?? 0) > 0 ? 'succeeded' : 'partial',
      capabilityId: PLAYWRIGHT_BROWSER_AUTOMATION_CAPABILITY_ID,
      providerId: PLAYWRIGHT_BROWSER_MCP_PROVIDER_ID,
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
      ...(structuredData ? { structuredData } : {}),
      ...(actionResults ? { actionResults } : {}),
      ...(downloadRefs.length ? { downloadRefs } : {}),
      providerDiagnostics: {
        mcpUrl,
        transport: connected.transport,
        toolCount: tools.tools.length,
        userAgent: pageInfo.userAgent,
        brands: pageInfo.brands,
        browserName: input.browserName ?? PLAYWRIGHT_BROWSER_MCP_DEFAULT_BROWSER,
        outputDir,
        headlessIsolatedDefault: true,
      },
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function connectPlaywrightMcp(mcpUrl: string): Promise<ConnectedMcpClient> {
  const client = new Client({ name: 'sciforge-playwright-browser-provider', version: '0.1.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
    return { client, transport: 'streamable-http' };
  } catch (error) {
    await client.close().catch(() => undefined);
    const sseClient = new Client({ name: 'sciforge-playwright-browser-provider', version: '0.1.0' });
    const sseUrl = mcpUrl.replace(/\/mcp(?:[?#].*)?$/i, '/sse');
    try {
      await sseClient.connect(new SSEClientTransport(new URL(sseUrl)));
      return { client: sseClient, transport: 'sse' };
    } catch {
      throw error;
    }
  }
}

async function browserResultLinks(client: Client, maxLinks: number): Promise<Array<{ text: string; href: string }>> {
  const raw = await callToolText(client, 'browser_evaluate', {
    function: `() => Array.from(document.querySelectorAll('a')).map((anchor) => ({
      text: (anchor.innerText || anchor.textContent || '').replace(/\\s+/g, ' ').trim(),
      href: anchor.href
    })).filter((item) => item.href && /^https?:\\/\\//i.test(item.href) && !/\\b(?:bing|microsoft)\\.com\\//i.test(item.href)).slice(0, ${JSON.stringify(clampNumber(maxLinks, 10, 1, 200))})`,
  });
  return parseToolJsonResult<unknown[]>(raw, []).filter(isLinkRecord).map((link) => ({
    text: link.text,
    href: link.href,
  }));
}

async function browserPageInfo(client: Client, maxChars: number, maxLinks: number): Promise<PageInfo> {
  const raw = await callToolText(client, 'browser_evaluate', {
    function: `() => {
      const text = document.body ? document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, ${JSON.stringify(maxChars)}) : '';
      const links = Array.from(document.querySelectorAll('a')).slice(0, ${JSON.stringify(clampNumber(maxLinks, 50, 0, 500))}).map((anchor) => ({
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

async function browserExtractStructuredData(
  client: Client,
  extract: PlaywrightBrowserPageExtractionSpec,
): Promise<PlaywrightBrowserPageExtractionOutput | undefined> {
  if (extract.kind !== 'repeated-items') return undefined;
  const normalized = normalizeRepeatedItemsExtractionSpec(extract);
  const raw = await callToolText(client, 'browser_evaluate', {
    function: `() => {
      const spec = ${JSON.stringify(normalized)};
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const matchesText = (text, exacts, patterns) => {
        const haystack = normalize(text);
        if (!haystack) return false;
        if (Array.isArray(exacts) && exacts.some((needle) => needle && haystack.includes(needle))) return true;
        if (Array.isArray(patterns)) {
          return patterns.some((pattern) => {
            try {
              return pattern ? new RegExp(pattern, 'i').test(haystack) : false;
            } catch {
              return false;
            }
          });
        }
        return false;
      };
      const valueFromElement = (element, field) => {
        if (!element) return field.multiple ? [] : '';
        const nodes = field.selector
          ? Array.from(element.querySelectorAll(field.selector))
          : [element];
        const values = nodes.map((node) => {
          if (field.attr) {
            const attrValue = field.attr === 'href' && 'href' in node ? node.href : node.getAttribute(field.attr);
            return normalize(attrValue);
          }
          return normalize(node.innerText || node.textContent || '');
        }).filter(Boolean);
        const applyRegex = (value) => {
          if (!field.regex) return value;
          try {
            const match = value.match(new RegExp(field.regex, 'i'));
            return match ? normalize(match[1] || match[0]) : '';
          } catch {
            return value;
          }
        };
        if (field.multiple) return values.map(applyRegex).filter(Boolean);
        return applyRegex(values[0] || '');
      };
      const nearestHeadingText = (element, section) => {
        if (!section) return '';
        const headingSelector = section.headingSelector || 'h1,h2,h3,h4,h5,h6,[role="heading"]';
        const headings = Array.from(document.querySelectorAll(headingSelector));
        let heading = '';
        for (const candidate of headings) {
          const position = candidate.compareDocumentPosition(element);
          if (position & Node.DOCUMENT_POSITION_FOLLOWING) heading = normalize(candidate.innerText || candidate.textContent || '');
        }
        return heading;
      };
      const fields = Array.isArray(spec.fields) ? spec.fields : [];
      const allItems = Array.from(document.querySelectorAll(spec.itemSelector || ''));
      const items = [];
      const skippedBySection = { beforeStart: 0, afterStop: 0 };
      for (const item of allItems) {
        const detail = spec.detailSource === 'nextElementSibling' ? item.nextElementSibling : item;
        const headingText = nearestHeadingText(item, spec.section);
        if (spec.section) {
          const hasStart = Boolean(spec.section.startText || spec.section.startPattern);
          if (hasStart && !matchesText(headingText, [spec.section.startText], [spec.section.startPattern])) {
            if (matchesText(headingText, spec.section.stopTexts, spec.section.stopPatterns)) skippedBySection.afterStop += 1;
            else skippedBySection.beforeStart += 1;
            continue;
          }
          if (matchesText(headingText, spec.section.stopTexts, spec.section.stopPatterns)) {
            skippedBySection.afterStop += 1;
            continue;
          }
        }
        const record = {
          index: items.length,
          text: normalize([item.innerText || item.textContent || '', detail && detail !== item ? detail.innerText || detail.textContent || '' : ''].join(' ')),
        };
        for (const field of fields) {
          const source = field.source || 'detail';
          const element = source === 'item' ? item : source === 'document' ? document : detail;
          record[field.name] = valueFromElement(element, field);
        }
        items.push(record);
        if (items.length >= spec.maxItems) break;
      }
      return {
        kind: spec.kind,
        count: items.length,
        items,
        diagnostics: {
          itemSelector: spec.itemSelector,
          matchedItems: allItems.length,
          section: spec.section || null,
          skippedBySection
        }
      };
    }`,
  });
  return parseToolJsonResult<PlaywrightBrowserPageExtractionOutput | undefined>(raw, undefined);
}

async function executeBrowserActions(
  client: Client,
  actions: PlaywrightBrowserAction[],
  context: { outputDir: string },
): Promise<PlaywrightBrowserActionResult[]> {
  await mkdir(context.outputDir, { recursive: true });
  const results: PlaywrightBrowserActionResult[] = [];
  for (const action of actions) {
    try {
      if (action.type === 'downloadLinks') {
        const downloadRefs = await downloadMatchingPageLinks(client, browserDownloadSpecField(action) ?? {}, context.outputDir);
        results.push({ type: action.type, status: 'succeeded', data: { downloadRefs } });
        continue;
      }
      const mapped = browserActionToolCall(action, context);
      if (!mapped) {
        results.push({ type: action.type, status: 'failed', error: `Unsupported browser action type: ${action.type}` });
        continue;
      }
      const text = await callToolText(client, mapped.toolName, mapped.args);
      results.push({
        type: action.type,
        status: 'succeeded',
        toolName: mapped.toolName,
        ...(text ? { text } : {}),
      });
    } catch (error) {
      results.push({
        type: action.type,
        status: 'failed',
        error: errorMessage(error),
      });
    }
  }
  return results;
}

function browserActionToolCall(
  action: PlaywrightBrowserAction,
  context: { outputDir: string },
): { toolName: string; args: Record<string, unknown> } | undefined {
  switch (action.type) {
    case 'navigate':
      return { toolName: 'browser_navigate', args: { url: requiredStringField(action.url, 'url') } };
    case 'back':
      return { toolName: 'browser_navigate_back', args: {} };
    case 'wait':
      return { toolName: 'browser_wait_for', args: compactRecord({ time: numberField(action.time), text: stringField(action.text), textGone: stringField(action.textGone) }) };
    case 'click':
      return { toolName: 'browser_click', args: compactRecord({
        target: requiredStringField(action.target, 'target'),
        element: stringField(action.element),
        doubleClick: action.doubleClick === true,
        button: enumStringField(action.button, ['left', 'right', 'middle']),
        modifiers: stringArrayField(action.modifiers),
      }) };
    case 'scroll':
      return { toolName: 'browser_evaluate', args: compactRecord({
        target: stringField(action.target),
        element: stringField(action.element),
        function: `() => {
          const dx = ${JSON.stringify(clampNumber(action.deltaX, 0, -10000, 10000))};
          const dy = ${JSON.stringify(clampNumber(action.deltaY, 600, -10000, 10000))};
          const selector = ${JSON.stringify(stringField(action.selector))};
          const target = selector ? document.querySelector(selector) : null;
          if (target && typeof target.scrollBy === 'function') {
            target.scrollBy({ left: dx, top: dy, behavior: 'auto' });
          } else {
            window.scrollBy({ left: dx, top: dy, behavior: 'auto' });
          }
          return { scrollX: window.scrollX, scrollY: window.scrollY };
        }`,
      }) };
    case 'hover':
      return { toolName: 'browser_hover', args: compactRecord({
        target: requiredStringField(action.target, 'target'),
        element: stringField(action.element),
      }) };
    case 'type':
      return { toolName: 'browser_type', args: compactRecord({
        target: requiredStringField(action.target, 'target'),
        element: stringField(action.element),
        text: requiredStringField(action.text, 'text'),
        submit: action.submit === true,
        slowly: action.slowly === true,
      }) };
    case 'fillForm':
      return { toolName: 'browser_fill_form', args: { fields: formFieldsField(action.fields) } };
    case 'pressKey':
      return { toolName: 'browser_press_key', args: { key: requiredStringField(action.key, 'key') } };
    case 'selectOption':
      return { toolName: 'browser_select_option', args: compactRecord({
        target: requiredStringField(action.target, 'target'),
        element: stringField(action.element),
        values: stringArrayField(action.values) ?? [requiredStringField(action.value, 'value')],
      }) };
    case 'drag':
      return { toolName: 'browser_drag', args: compactRecord({
        startTarget: requiredStringField(action.startTarget, 'startTarget'),
        endTarget: requiredStringField(action.endTarget, 'endTarget'),
        startElement: stringField(action.startElement),
        endElement: stringField(action.endElement),
      }) };
    case 'drop':
      return { toolName: 'browser_drop', args: compactRecord({
        target: requiredStringField(action.target, 'target'),
        element: stringField(action.element),
        paths: stringArrayField(action.paths),
        data: objectField(action.data),
      }) };
    case 'uploadFiles':
      return { toolName: 'browser_file_upload', args: compactRecord({ paths: stringArrayField(action.paths) }) };
    case 'handleDialog':
      return { toolName: 'browser_handle_dialog', args: compactRecord({
        accept: action.accept !== false,
        promptText: stringField(action.promptText),
      }) };
    case 'resize':
      return { toolName: 'browser_resize', args: {
        width: clampNumber(action.width, 1440, 320, 7680),
        height: clampNumber(action.height, 900, 240, 4320),
      } };
    case 'tabs':
      return { toolName: 'browser_tabs', args: compactRecord({
        action: enumStringField(action.action, ['list', 'new', 'close', 'select']) ?? 'list',
        index: numberField(action.index),
        url: stringField(action.url),
      }) };
    case 'snapshot':
      return { toolName: 'browser_snapshot', args: compactRecord({
        target: stringField(action.target),
        filename: scopedOutputPath(stringField(action.filename), context.outputDir),
        depth: numberField(action.depth),
        boxes: action.boxes === true,
      }) };
    case 'screenshot':
      return { toolName: 'browser_take_screenshot', args: compactRecord({
        target: stringField(action.target),
        element: stringField(action.element),
        type: enumStringField(action.imageType ?? action.format, ['png', 'jpeg']) ?? 'png',
        filename: scopedOutputPath(
          stringField(action.filename) ?? `screenshot-${Date.now()}.${enumStringField(action.imageType ?? action.format, ['png', 'jpeg']) ?? 'png'}`,
          context.outputDir,
        ),
        fullPage: action.fullPage === true,
      }) };
    case 'evaluate':
      return { toolName: 'browser_evaluate', args: compactRecord({
        target: stringField(action.target),
        element: stringField(action.element),
        function: requiredStringField(action.function, 'function'),
        filename: scopedOutputPath(stringField(action.filename), context.outputDir),
      }) };
    case 'consoleMessages':
      return { toolName: 'browser_console_messages', args: compactRecord({
        level: enumStringField(action.level, ['error', 'warning', 'info', 'debug']) ?? 'info',
        all: action.all === true,
        filename: scopedOutputPath(stringField(action.filename), context.outputDir),
      }) };
    case 'networkRequests':
      return { toolName: 'browser_network_requests', args: compactRecord({
        static: action.static === true,
        filter: stringField(action.filter),
        filename: scopedOutputPath(stringField(action.filename), context.outputDir),
      }) };
    case 'networkRequest':
      return { toolName: 'browser_network_request', args: compactRecord({
        index: clampNumber(action.index, 1, 1, Number.MAX_SAFE_INTEGER),
        part: enumStringField(action.part, ['request-headers', 'request-body', 'response-headers', 'response-body']),
        filename: scopedOutputPath(stringField(action.filename), context.outputDir),
      }) };
    default:
      return undefined;
  }
}

async function downloadMatchingPageLinks(
  client: Client,
  download: PlaywrightBrowserDownloadSpec,
  defaultOutputDir: string,
): Promise<PlaywrightBrowserDownloadRef[]> {
  const explicitUrls = (download.urls ?? []).filter((url) => /^https?:\/\//i.test(url));
  const maxFiles = clampNumber(download.maxFiles, 20, 1, 200);
  const discovered = explicitUrls.length
    ? explicitUrls.map((href) => ({ href, text: '' }))
    : await discoverDownloadLinks(client, download, maxFiles);
  const outputDir = normalizedOutputDir(download.outputDir ?? defaultOutputDir);
  await mkdir(outputDir, { recursive: true });
  const refs: PlaywrightBrowserDownloadRef[] = [];
  for (const link of discovered.slice(0, maxFiles)) {
    refs.push(await downloadUrlToFile(link.href, {
      outputDir,
      filenamePrefix: download.filenamePrefix,
      maxBytes: clampNumber(download.maxBytes, 100 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    }));
  }
  return refs;
}

async function discoverDownloadLinks(
  client: Client,
  download: PlaywrightBrowserDownloadSpec,
  maxFiles: number,
): Promise<Array<{ href: string; text: string }>> {
  const raw = await callToolText(client, 'browser_evaluate', {
    function: `() => {
      const selector = ${JSON.stringify(download.selector || 'a[href]')};
      const hrefPattern = ${JSON.stringify(download.hrefPattern || '\\\\.(?:pdf|zip|csv|tsv|xlsx?|docx?|pptx?|json|txt|tar(?:\\\\.gz)?|tgz)(?:$|[?#])|/pdf/')};
      const textPattern = ${JSON.stringify(download.textPattern || '')};
      const hrefRegex = hrefPattern ? new RegExp(hrefPattern, 'i') : null;
      const textRegex = textPattern ? new RegExp(textPattern, 'i') : null;
      return Array.from(document.querySelectorAll(selector)).map((node) => ({
        href: node.href || node.getAttribute('href') || '',
        text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim()
      })).filter((item) => item.href && /^https?:\\/\\//i.test(item.href))
        .filter((item) => (!hrefRegex || hrefRegex.test(item.href)) && (!textRegex || textRegex.test(item.text)))
        .slice(0, ${JSON.stringify(maxFiles)});
    }`,
  });
  return parseToolJsonResult<unknown[]>(raw, []).filter(isLinkRecord);
}

async function downloadUrlToFile(
  sourceUrl: string,
  options: { outputDir: string; filenamePrefix?: string; maxBytes: number },
): Promise<PlaywrightBrowserDownloadRef> {
  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      headers: {
        accept: '*/*',
        'user-agent': 'SciForgePlaywrightBrowserProvider/0.1',
      },
    });
    const contentType = response.headers.get('content-type') ?? undefined;
    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
      return { status: 'skipped', sourceUrl, contentType, reason: `content-length ${contentLength} exceeds maxBytes ${options.maxBytes}` };
    }
    if (!response.ok) {
      return { status: 'failed', sourceUrl, contentType, reason: `HTTP ${response.status}` };
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > options.maxBytes) {
      return { status: 'skipped', sourceUrl, contentType, bytes: bytes.byteLength, reason: `downloaded bytes exceed maxBytes ${options.maxBytes}` };
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const filename = safeDownloadFilename(sourceUrl, response.headers.get('content-disposition'), options.filenamePrefix, sha256);
    const localPath = join(options.outputDir, filename);
    await writeFile(localPath, bytes);
    return {
      status: 'downloaded',
      sourceUrl,
      localPath,
      filename,
      bytes: bytes.byteLength,
      contentType,
      sha256,
    };
  } catch (error) {
    return { status: 'failed', sourceUrl, reason: errorMessage(error) };
  }
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
  const fromEnv = process.env.SCIFORGE_PLAYWRIGHT_BROWSER_MCP_URL;
  return (inputUrl || fromEnv || playwrightBrowserMcpHttpUrl()).trim();
}

function normalizedOutputDir(inputDir: string | undefined) {
  const fromEnv = process.env.SCIFORGE_PLAYWRIGHT_BROWSER_OUTPUT_DIR;
  return (inputDir || fromEnv || playwrightBrowserMcpOutputDir()).trim();
}

function normalizedQuery(input: PlaywrightBrowserAutomationInvocationInput) {
  if (input.query?.trim()) return input.query.trim();
  if (input.mode === 'search' && input.task?.trim()) return input.task.trim();
  return undefined;
}

function normalizedStartUrl(input: PlaywrightBrowserAutomationInvocationInput, query: string | undefined) {
  const explicit = input.url?.trim() || input.startUrl?.trim() || urlFromTask(input.task);
  if (explicit) return explicit;
  if (query) return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
  throw new Error('playwright_browser_automation requires url, startUrl, query, or a task containing a URL.');
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

function enumStringField<const T extends readonly string[]>(value: unknown, options: T): T[number] | undefined {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? value as T[number] : undefined;
}

function objectField(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function requiredStringField(value: unknown, fieldName: string): string {
  const field = stringField(value);
  if (!field) throw new Error(`browser action requires ${fieldName}.`);
  return field;
}

export function pageExtractionSpecField(value: unknown): PlaywrightBrowserPageExtractionSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== 'repeated-items') return undefined;
  if (!stringField(candidate.itemSelector)) return undefined;
  return normalizeRepeatedItemsExtractionSpec(candidate as Partial<PlaywrightBrowserRepeatedItemsExtractionSpec>);
}

export function normalizeRepeatedItemsExtractionSpec(
  value: Partial<PlaywrightBrowserRepeatedItemsExtractionSpec>,
): PlaywrightBrowserRepeatedItemsExtractionSpec {
  const sectionValue = value.section && typeof value.section === 'object'
    ? value.section as Record<string, unknown>
    : undefined;
  const fieldsValue = Array.isArray(value.fields) ? value.fields : [];
  return {
    kind: 'repeated-items',
    itemSelector: stringField(value.itemSelector) ?? '',
    detailSource: value.detailSource === 'nextElementSibling' ? 'nextElementSibling' : 'item',
    maxItems: clampNumber(value.maxItems, 100, 1, 2000),
    ...(sectionValue ? {
      section: {
        headingSelector: stringField(sectionValue.headingSelector),
        startText: stringField(sectionValue.startText),
        startPattern: stringField(sectionValue.startPattern),
        stopTexts: stringArrayField(sectionValue.stopTexts),
        stopPatterns: stringArrayField(sectionValue.stopPatterns),
      },
    } : {}),
    fields: fieldsValue.map((field): PlaywrightBrowserRepeatedItemsFieldSpec | undefined => {
      if (!field || typeof field !== 'object') return undefined;
      const record = field as unknown as Record<string, unknown>;
      const name = stringField(record.name);
      if (!name) return undefined;
      const source = record.source === 'item' || record.source === 'document' ? record.source : 'detail';
      return {
        name,
        source,
        selector: stringField(record.selector),
        attr: stringField(record.attr),
        multiple: record.multiple === true,
        regex: stringField(record.regex),
      };
    }).filter((field): field is PlaywrightBrowserRepeatedItemsFieldSpec => Boolean(field)),
  };
}

function stringArrayField(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.map(stringField).filter((item): item is string => Boolean(item));
  return strings.length ? strings : undefined;
}

function browserActionsField(value: unknown): PlaywrightBrowserAction[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const actions = value.map((item): PlaywrightBrowserAction | undefined => {
    if (!item || typeof item !== 'object') return undefined;
    const record = item as Record<string, unknown>;
    const type = enumStringField(record.type, [
      'navigate',
      'back',
      'wait',
      'click',
      'hover',
      'type',
      'fillForm',
      'pressKey',
      'selectOption',
      'drag',
      'drop',
      'uploadFiles',
      'handleDialog',
      'resize',
      'tabs',
      'snapshot',
      'screenshot',
      'evaluate',
      'consoleMessages',
      'networkRequests',
      'networkRequest',
      'downloadLinks',
    ] as const);
    return type ? { ...record, type } as PlaywrightBrowserAction : undefined;
  }).filter((action): action is PlaywrightBrowserAction => Boolean(action));
  return actions.length ? actions : undefined;
}

function browserDownloadSpecField(value: unknown): PlaywrightBrowserDownloadSpec | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  return {
    selector: stringField(record.selector),
    hrefPattern: stringField(record.hrefPattern),
    textPattern: stringField(record.textPattern),
    urls: stringArrayField(record.urls),
    maxFiles: numberField(record.maxFiles),
    maxBytes: numberField(record.maxBytes),
    outputDir: stringField(record.outputDir),
    filenamePrefix: stringField(record.filenamePrefix),
  };
}

function formFieldsField(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = objectField(item) ?? {};
    return compactRecord({
      target: requiredStringField(record.target, 'target'),
      element: stringField(record.element),
      name: stringField(record.name) ?? requiredStringField(record.target, 'target'),
      type: enumStringField(record.type, ['textbox', 'checkbox', 'radio', 'combobox', 'slider']) ?? 'textbox',
      value: requiredStringField(record.value, 'value'),
    });
  });
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function isDownloadRefRecord(value: unknown): value is PlaywrightBrowserDownloadRef {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as { status?: unknown }).status === 'string'
    && typeof (value as { sourceUrl?: unknown }).sourceUrl === 'string';
}

function safeDownloadFilename(sourceUrl: string, contentDisposition: string | null, prefix: string | undefined, sha256: string) {
  const dispositionName = contentDisposition?.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1];
  const urlName = basename(new URL(sourceUrl).pathname) || `download-${sha256.slice(0, 12)}`;
  const rawName = decodeURIComponent(dispositionName || urlName);
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || `download-${sha256.slice(0, 12)}`;
  const safePrefix = prefix?.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safePrefix ? `${safePrefix}-${safeName}` : safeName;
}

function scopedOutputPath(filename: string | undefined, outputDir: string): string | undefined {
  if (!filename) return undefined;
  return join(outputDir, basename(filename));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, numeric));
}

function publicProviderDiagnostics(diagnostics: PlaywrightBrowserAutomationInvocationOutput['providerDiagnostics']) {
  return {
    transport: diagnostics.transport,
    toolCount: diagnostics.toolCount,
    browserName: diagnostics.browserName,
    outputDir: diagnostics.outputDir,
    headlessIsolatedDefault: diagnostics.headlessIsolatedDefault,
  };
}
