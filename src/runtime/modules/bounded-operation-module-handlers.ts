import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
} from '@sciforge-ui/runtime-contract/modules';
import {
  BROWSER_PRIMITIVE_INTENTS,
  BROWSER_PRIMITIVE_NAMES,
  browserPrimitiveModuleDescription,
  createBrowserPrimitiveService,
  type BrowserDownloadInput,
  type BrowserDownloadOutput,
  type BrowserExtractInput,
  type BrowserExtractOutput,
  type BrowserNavigateInput,
  type BrowserNavigateOutput,
  type BrowserObserveInput,
  type BrowserObserveOutput,
  type BrowserPrimitiveIntent,
  type BrowserPrimitiveName,
  type BrowserPrimitivePorts,
  type BrowserPrimitivePortResult,
  type BrowserReadInput,
  type BrowserReadOutput,
  type BrowserSearchInput as BrowserPrimitiveSearchInput,
  type BrowserSearchOutput as BrowserPrimitiveSearchOutput,
} from '../../../packages/actions/browser-runtime/index.js';
import {
  browserHostSessionDir,
  defaultBrowserHostSessionManager,
  type BrowserHostSessionManager,
  type BrowserHostSessionState,
} from '../browser-host-session.js';
import type { RuntimeModuleHandler } from './dispatcher.js';

export interface BrowserRuntimeModulePorts {
  primitivePorts?: BrowserPrimitivePorts;
  workspacePath?: string;
  manager?: BrowserHostSessionManager;
}

export function createBrowserRuntimeModuleHandler(ports: BrowserRuntimeModulePorts = {}): RuntimeModuleHandler {
  const primitiveService = createBrowserPrimitiveService({
    ports: browserPrimitivePortsFromHost(ports),
  });
  return {
    describe: browserModuleDescription,
    invoke: async (request) => {
      if (isBrowserPrimitiveIntent(request.intent)) {
        return primitiveService.invoke(request);
      }
      return moduleResult({
        moduleId: 'browser',
        ok: false,
        error: `unsupported_intent:${request.intent}`,
      });
    },
  };
}

function browserPrimitivePortsFromHost(ports: BrowserRuntimeModulePorts): BrowserPrimitivePorts {
  return {
    search: ports.primitivePorts?.search ?? ((input) => browserPrimitiveSearchWithManager(ports, input)),
    navigate: ports.primitivePorts?.navigate ?? ((input) => browserPrimitiveNavigateWithManager(ports, input)),
    observe: ports.primitivePorts?.observe ?? ((input) => browserPrimitiveObserveWithManager(ports, input)),
    read: ports.primitivePorts?.read ?? ((input) => browserPrimitiveReadWithManager(ports, input)),
    extract: ports.primitivePorts?.extract ?? ((input) => browserPrimitiveExtractWithWorkspace(ports, input)),
    download: ports.primitivePorts?.download ?? ((input) => browserPrimitiveDownloadWithWorkspace(ports, input)),
  };
}

async function browserPrimitiveSearchWithManager(
  ports: BrowserRuntimeModulePorts,
  input: BrowserPrimitiveSearchInput,
): Promise<BrowserPrimitivePortResult<BrowserPrimitiveSearchOutput>> {
  if (!ports.workspacePath) return browserPrimitiveBlocked('search', 'missing_workspace_path');
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const output = await manager.search(ports.workspacePath, {
    query: input.query,
    engine: browserHostDiscoveryEngine(input.engine),
    region: input.region,
    limit: input.limit,
    sourcePageLimit: 0,
    timeoutMs: numericBudget(Number(input.budget?.maxTimeMs ?? 30_000), 1_000, 120_000),
  });
  const refs = browserSessionRefs(output.session, [output.searchResultRef]);
  return {
    status: output.results.length ? 'completed' : 'partial',
    refs,
    output: {
      query: output.query,
      queryUsed: output.query,
      engine: output.engine,
      searchUrl: output.searchUrl,
      searchedAt: output.searchedAt,
      results: output.results.map((result, index) => ({
        rank: index + 1,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
      })),
      searchResultRef: output.searchResultRef,
    },
    diagnostics: output.session.diagnostics.map((message) => ({
      code: 'browser-host-session-diagnostic',
      message,
      severity: 'warning' as const,
      retryable: true,
    })),
    budget: input.budget,
  };
}

function browserHostDiscoveryEngine(engine: string | undefined) {
  if (engine === 'bing' || engine === 'duckduckgo') return engine;
  return undefined;
}

async function browserPrimitiveNavigateWithManager(
  ports: BrowserRuntimeModulePorts,
  input: BrowserNavigateInput,
): Promise<BrowserPrimitivePortResult<BrowserNavigateOutput>> {
  if (!ports.workspacePath) return browserPrimitiveBlocked('navigate', 'missing_workspace_path');
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const capture = browserPrimitiveCaptureToHost(input.capture);
  let session: BrowserHostSessionState;
  if (input.sessionId) {
    try {
      session = await manager.act(ports.workspacePath, input.sessionId, {
        action: 'navigate',
        url: input.url,
        capture,
        timeoutMs: input.timeoutMs,
      });
    } catch {
      session = await manager.openSession(ports.workspacePath, {
        url: input.url,
        sessionId: input.sessionId,
        timeoutMs: input.timeoutMs,
      });
    }
  } else {
    session = await manager.openSession(ports.workspacePath, {
      url: input.url,
      timeoutMs: input.timeoutMs,
    });
  }
  const refs = browserSessionRefs(session);
  return {
    status: session.status === 'failed' ? 'failed' : 'completed',
    refs,
    output: {
      sessionId: session.id,
      sessionRef: `browser-host-session:${session.id}`,
      requestedUrl: input.url,
      finalUrl: session.url,
      title: session.title,
      openedAt: session.updatedAt,
      navigation: {
        redirected: session.url !== input.url,
        blockedByLogin: false,
        blockedByConsent: false,
        errorCode: session.status === 'failed' ? 'navigation-failed' : undefined,
      },
      frameRef: session.frameRef,
      screenshotRef: session.screenshotRef,
      domSnapshotRef: session.domSnapshotRef,
      axSnapshotRef: session.axSnapshotRef,
    },
    diagnostics: browserSessionDiagnostics(session),
    blockedReason: session.status === 'failed' ? 'navigation_failed' : undefined,
  };
}

async function browserPrimitiveObserveWithManager(
  ports: BrowserRuntimeModulePorts,
  input: BrowserObserveInput,
): Promise<BrowserPrimitivePortResult<BrowserObserveOutput>> {
  if (!ports.workspacePath) return browserPrimitiveBlocked('observe', 'missing_workspace_path');
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const session = input.capture && input.capture !== 'none'
    ? (await manager.captureFrameIfIdle(ports.workspacePath, input.sessionId, { quietWindowMs: 80 })).session
    : await manager.sessionState(ports.workspacePath, input.sessionId);
  if (!session) return browserPrimitiveBlocked('observe', 'browser_session_not_found');
  return {
    status: session.status === 'failed' ? 'failed' : 'completed',
    refs: browserSessionRefs(session),
    output: {
      sessionId: session.id,
      url: session.url,
      title: session.title,
      status: session.status,
      stateRef: `browser-host-session:${session.id}/session.json`,
      frameRef: session.frameRef,
      screenshotRef: session.screenshotRef,
      domSnapshotRef: session.domSnapshotRef,
      axSnapshotRef: session.axSnapshotRef,
      consoleLogRef: session.consoleLogRef,
      networkLogRef: session.networkLogRef,
      diagnostics: session.diagnostics,
    },
    diagnostics: browserSessionDiagnostics(session),
    blockedReason: session.status === 'failed' ? 'browser_session_failed' : undefined,
  };
}

async function browserPrimitiveReadWithManager(
  ports: BrowserRuntimeModulePorts,
  input: BrowserReadInput,
): Promise<BrowserPrimitivePortResult<BrowserReadOutput>> {
  if (!ports.workspacePath) return browserPrimitiveBlocked('read', 'missing_workspace_path');
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const session = input.sessionId ? await manager.sessionState(ports.workspacePath, input.sessionId) : undefined;
  const url = input.url ?? session?.url;
  if (!url) return browserPrimitiveBlocked('read', 'missing_read_url');
  const output = await manager.readPage(ports.workspacePath, {
    url,
    sessionId: input.sessionId,
    timeoutMs: input.timeoutMs,
  });
  const sourcePage = output.sourcePage;
  const sourceRefs = uniqueStrings([sourcePage.sourcePageRef]);
  const pageTextRefs = uniqueStrings([sourcePage.textRef]);
  return {
    status: sourcePage.status === 'read' ? 'completed' : 'blocked',
    refs: uniqueStrings([...sourceRefs, ...pageTextRefs, ...browserSessionRefs(output.session)]),
    output: sourcePage.status === 'read'
      ? {
          sessionId: output.session.id,
          url: sourcePage.url,
          finalUrl: sourcePage.finalUrl,
          title: sourcePage.title,
          sourcePageRef: sourcePage.sourcePageRef ?? browserSourcePageRef(sourcePage.textRef) ?? '',
          pageTextRef: sourcePage.textRef,
          textPreview: sourcePage.textPreview,
          textCharCount: sourcePage.textCharCount,
          textSha1: sourcePage.textSha1,
        }
      : undefined,
    diagnostics: [
      ...browserSessionDiagnostics(output.session),
      ...(sourcePage.error ? [{
        code: 'source-page-read-failed',
        message: sourcePage.error,
        severity: 'error' as const,
        retryable: true,
      }] : []),
    ],
    blockedReason: sourcePage.status === 'read' ? undefined : 'source_page_read_failed',
  };
}

async function browserPrimitiveExtractWithWorkspace(
  ports: BrowserRuntimeModulePorts,
  input: BrowserExtractInput,
): Promise<BrowserPrimitivePortResult<BrowserExtractOutput>> {
  if (!ports.workspacePath) return browserPrimitiveBlocked('extract', 'missing_workspace_path');
  const filePath = browserHostFilePathForRef(ports.workspacePath, input.ref);
  if (!filePath) return browserPrimitiveBlocked('extract', 'unsupported_ref_for_extract');
  const text = await readFile(filePath, 'utf8');
  const limited = text.slice(0, 2_000_000);
  const output: BrowserExtractOutput = { ref: input.ref };
  const maxItems = input.maxItems ?? 200;
  if (input.extract.includes('links')) output.links = extractLinks(limited, maxItems);
  if (input.extract.includes('dates')) output.dates = extractDates(limited, maxItems);
  if (input.extract.includes('metadata')) output.metadata = extractMetadata(limited);
  if (input.extract.includes('resultItems')) output.resultItems = extractResultItems(limited, maxItems);
  if (input.extract.includes('forms')) output.forms = extractForms(limited, maxItems);
  return {
    status: 'completed',
    refs: [input.ref],
    output,
    diagnostics: [],
  };
}

async function browserPrimitiveDownloadWithWorkspace(
  ports: BrowserRuntimeModulePorts,
  input: BrowserDownloadInput,
): Promise<BrowserPrimitivePortResult<BrowserDownloadOutput>> {
  if (!ports.workspacePath) return browserPrimitiveBlocked('download', 'missing_workspace_path');
  const downloadUrl = input.url ?? await browserDownloadUrlFromSessionLink(ports, input);
  if (typeof downloadUrl !== 'string') return downloadUrl;
  const resolvedInput = { ...input, url: downloadUrl };
  const domainBlock = browserDownloadDomainBlock(resolvedInput);
  if (domainBlock) return browserPrimitiveBlocked('download', domainBlock);
  const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(input.timeoutMs ?? 30_000) });
  const finalUrl = response.url || downloadUrl;
  const finalDomainBlock = browserDownloadDomainBlock(resolvedInput, finalUrl);
  if (finalDomainBlock) return browserPrimitiveBlocked('download', finalDomainBlock);
  if (!response.ok) {
    return {
      status: 'failed',
      refs: [],
      blockedReason: `download_http_status:${response.status}`,
      diagnostics: [{
        code: 'download-http-status',
        message: `Download failed with HTTP ${response.status}.`,
        severity: 'error',
        retryable: response.status >= 500,
      }],
    };
  }
  const mimeType = response.headers.get('content-type') ?? undefined;
  const risk = browserDownloadRisk(resolvedInput, mimeType);
  if (risk) {
    return {
      status: 'needs-confirmation',
      refs: [],
      blockedReason: risk.blockedReason,
      diagnostics: [{
        code: risk.code,
        message: risk.message,
        severity: 'warning',
        retryable: false,
      }],
      repairHints: [{
        code: 'browser-download-confirmation-required',
        message: 'Ask Agent Host for explicit user confirmation before downloading high-risk or unknown file types.',
        suggestedPrimitive: 'download',
      }],
    };
  }
  const contentLength = Number(response.headers.get('content-length') ?? 0);
  if (input.maxBytes && contentLength > input.maxBytes) return browserPrimitiveBlocked('download', 'download_content_length_exceeds_budget');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (input.maxBytes && bytes.byteLength > input.maxBytes) return browserPrimitiveBlocked('download', 'download_bytes_exceed_budget');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const filename = safeBrowserArtifactFilename(input.filenameHint ?? (basename(new URL(finalUrl).pathname) || 'download.bin'));
  const sessionId = safeBrowserArtifactSegment(input.sessionId ?? 'downloads');
  const fileName = `${sha256.slice(0, 12)}-${filename}`;
  const dir = join(browserHostSessionDir(ports.workspacePath, sessionId), 'downloads');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, fileName), bytes);
  const artifactRef = `browser-host-session:${sessionId}/downloads/${fileName}`;
  return {
    status: 'completed',
    refs: [artifactRef],
    output: {
      artifactRef,
      filename,
      mimeType,
      byteLength: bytes.byteLength,
      sha256,
      finalUrl,
    },
    diagnostics: [],
  };
}

async function browserDownloadUrlFromSessionLink(
  ports: BrowserRuntimeModulePorts,
  input: BrowserDownloadInput,
): Promise<string | BrowserPrimitivePortResult<BrowserDownloadOutput>> {
  if (!input.sessionId || !input.linkSelector) return browserPrimitiveBlocked('download', 'missing_download_source:url_or_session_linkSelector');
  const manager = ports.manager ?? defaultBrowserHostSessionManager();
  const session = await manager.sessionState(ports.workspacePath ?? '', input.sessionId);
  if (!session) return browserPrimitiveBlocked('download', 'browser_session_not_found');
  if (!session.frameRef) return browserPrimitiveBlocked('download', 'download_selector_missing_frame_ref');
  const framePath = browserHostFilePathForRef(ports.workspacePath ?? '', session.frameRef);
  if (!framePath) return browserPrimitiveBlocked('download', 'download_selector_invalid_frame_ref');
  let html: string;
  try {
    html = await readFile(framePath, 'utf8');
  } catch {
    return browserPrimitiveBlocked('download', 'download_selector_frame_ref_unreadable');
  }
  const href = hrefForLinkSelector(html, input.linkSelector);
  if (!href) return browserPrimitiveBlocked('download', 'download_link_selector_not_found');
  try {
    const resolved = new URL(href, session.url);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return browserPrimitiveBlocked('download', 'download_link_selector_non_http_url');
    }
    return resolved.toString();
  } catch {
    return browserPrimitiveBlocked('download', 'download_link_selector_invalid_url');
  }
}

function browserDownloadRisk(
  input: BrowserDownloadInput,
  mimeType: string | undefined,
): { code: string; blockedReason: string; message: string } | undefined {
  const normalizedMime = (mimeType ?? '').split(';', 1)[0]?.trim().toLowerCase();
  const filename = `${input.filenameHint ?? ''} ${input.url ? basename(new URL(input.url).pathname) : ''}`.toLowerCase();
  if (browserDownloadFilenameLooksExecutable(filename) || browserDownloadMimeLooksExecutable(normalizedMime)) {
    return {
      code: 'browser-download-high-risk-mime',
      blockedReason: 'download_high_risk_mime_requires_confirmation',
      message: 'Browser download is paused because the target appears to be executable or installable content.',
    };
  }
  if (!normalizedMime || normalizedMime === 'application/octet-stream') {
    return {
      code: 'browser-download-unknown-mime',
      blockedReason: 'download_unknown_mime_requires_confirmation',
      message: 'Browser download is paused because the target MIME type is unknown or opaque.',
    };
  }
  return undefined;
}

function hrefForLinkSelector(html: string, selector: string): string | undefined {
  const trimmedSelector = selector.trim();
  if (!trimmedSelector || /[\s>+~]/u.test(trimmedSelector)) return undefined;
  for (const candidateSelector of trimmedSelector.split(',').map((value) => value.trim()).filter(Boolean)) {
    for (const anchor of anchorLinksFromHtml(html)) {
      if (anchorMatchesSelector(anchor.attrs, candidateSelector)) return anchor.href;
    }
  }
  return undefined;
}

function anchorLinksFromHtml(html: string): Array<{ attrs: string; href: string }> {
  const anchors: Array<{ attrs: string; href: string }> = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/giu)) {
    const attrs = match[1] ?? '';
    const href = attr(attrs, 'href')?.trim();
    if (href) anchors.push({ attrs, href });
  }
  return anchors;
}

function anchorMatchesSelector(attrs: string, selector: string): boolean {
  if (!selector) return false;
  const tagMatch = /^[a-z][a-z0-9-]*/iu.exec(selector);
  const tag = tagMatch?.[0]?.toLowerCase();
  if (tag && tag !== 'a') return false;
  const selectorWithoutTag = tag ? selector.slice(tag.length) : selector;
  const idMatch = /#([a-zA-Z0-9_-]+)/u.exec(selectorWithoutTag);
  if (idMatch && attr(attrs, 'id') !== idMatch[1]) return false;
  const classNames = (attr(attrs, 'class') ?? '').split(/\s+/u).filter(Boolean);
  for (const classMatch of selectorWithoutTag.matchAll(/\.([a-zA-Z0-9_-]+)/gu)) {
    if (!classNames.includes(classMatch[1] ?? '')) return false;
  }
  for (const attrMatch of selectorWithoutTag.matchAll(/\[([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]+)))?\]/gu)) {
    const name = attrMatch[1] ?? '';
    const expected = attrMatch[2] ?? attrMatch[3] ?? attrMatch[4];
    const actual = attr(attrs, name);
    if (actual === undefined) return false;
    if (expected !== undefined && actual !== expected.trim()) return false;
  }
  return selectorWithoutTag
    .replace(/#[a-zA-Z0-9_-]+/gu, '')
    .replace(/\.[a-zA-Z0-9_-]+/gu, '')
    .replace(/\[[^\]]+\]/gu, '')
    .trim() === '';
}

function browserDownloadDomainBlock(input: BrowserDownloadInput, candidateUrl = input.url): string | undefined {
  if (!candidateUrl) return undefined;
  const constraints = input.constraints;
  if (!constraints) return undefined;
  const host = new URL(candidateUrl).hostname.toLowerCase();
  if ((constraints.blockedDomains ?? []).some((domain) => browserDomainMatches(host, domain))) {
    return 'download_domain_blocked';
  }
  const allowedDomains = constraints.allowedDomains ?? [];
  if (allowedDomains.length > 0 && !allowedDomains.some((domain) => browserDomainMatches(host, domain))) {
    return 'download_domain_not_allowed';
  }
  return undefined;
}

function browserDomainMatches(host: string, domain: string): boolean {
  const normalized = domain.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  return Boolean(normalized) && (host === normalized || host.endsWith(`.${normalized}`));
}

function browserDownloadMimeLooksExecutable(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return [
    'application/java-archive',
    'application/vnd.microsoft.portable-executable',
    'application/x-apple-diskimage',
    'application/x-debian-package',
    'application/x-dosexec',
    'application/x-executable',
    'application/x-mach-binary',
    'application/x-msdownload',
    'application/x-msdos-program',
    'application/x-rpm',
    'application/x-sh',
  ].includes(mimeType);
}

function browserDownloadFilenameLooksExecutable(filename: string): boolean {
  return /\.(?:app|apk|bat|cmd|com|deb|dmg|exe|jar|msi|pkg|ps1|rpm|scr|sh)(?:\b|$)/i.test(filename);
}

function isBrowserPrimitiveIntent(intent: string): intent is BrowserPrimitiveIntent {
  return Object.values(BROWSER_PRIMITIVE_INTENTS).includes(intent as BrowserPrimitiveIntent);
}

function browserPrimitiveBlocked(
  primitive: BrowserPrimitiveName,
  blockedReason: string,
): BrowserPrimitivePortResult<never> {
  return {
    status: 'blocked',
    refs: [],
    blockedReason,
    diagnostics: [{
      code: blockedReason.replace(/_/g, '-'),
      message: `Browser primitive ${primitive} is blocked: ${blockedReason}.`,
      severity: 'error',
      retryable: true,
    }],
    repairHints: [{
      code: 'host-repair-required',
      message: 'Agent Host should choose a different primitive, provide the missing input, or register a host port.',
      suggestedPrimitive: primitive,
    }],
  };
}

function browserPrimitiveCaptureToHost(capture: BrowserNavigateInput['capture']) {
  if (capture === 'none') return 'none' as const;
  if (capture === 'screenshot') return 'full' as const;
  return 'frame' as const;
}

function browserSessionRefs(session: BrowserHostSessionState, extraRefs: Array<string | undefined> = []) {
  return uniqueStrings([
    `browser-host-session:${session.id}`,
    `browser-host-session:${session.id}/session.json`,
    session.liveSurfaceRef,
    session.frameStreamRef,
    session.frameRef,
    session.screenshotRef,
    session.domSnapshotRef,
    session.axSnapshotRef,
    session.consoleLogRef,
    session.networkLogRef,
    session.searchResultRef,
    ...extraRefs,
  ]);
}

function browserSessionDiagnostics(session: BrowserHostSessionState) {
  return session.diagnostics.map((message) => ({
    code: 'browser-host-session-diagnostic',
    message,
    severity: session.status === 'failed' ? 'error' as const : 'warning' as const,
    retryable: true,
  }));
}

function browserHostFilePathForRef(workspacePath: string, ref: string): string | undefined {
  const match = /^browser-host-session:([^/]+)\/(.+)$/.exec(ref);
  if (!match) return undefined;
  const sessionId = safeBrowserArtifactSegment(match[1] ?? '');
  const relativePath = match[2] ?? '';
  if (!sessionId || !/^[a-zA-Z0-9._:-]+(?:\/[a-zA-Z0-9._:-]+)*$/.test(relativePath)) return undefined;
  return join(browserHostSessionDir(workspacePath, sessionId), relativePath);
}

function extractLinks(text: string, maxItems: number) {
  const links = new Map<string, { url: string; text?: string; rel?: string; confidence?: number }>();
  const hrefPattern = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/giu;
  for (const match of text.matchAll(hrefPattern)) {
    const url = cleanExtractedUrl(match[1]);
    if (!url || links.has(url)) continue;
    links.set(url, {
      url,
      text: cleanExtractedText(stripTags(match[2] ?? '')).slice(0, 240) || undefined,
      confidence: 0.9,
    });
    if (links.size >= maxItems) return [...links.values()];
  }
  const bareUrlPattern = /\bhttps?:\/\/[^\s<>"'`)\]]+/giu;
  for (const match of text.matchAll(bareUrlPattern)) {
    const url = cleanExtractedUrl(match[0]);
    if (!url || links.has(url)) continue;
    links.set(url, { url, confidence: 0.6 });
    if (links.size >= maxItems) break;
  }
  return [...links.values()];
}

function extractDates(text: string, maxItems: number) {
  const dates: Array<{ value: string; context?: string }> = [];
  const pattern = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+,\s+\d{4}|[A-Za-z]+\s+\d{1,2},\s+\d{4})\b/gu;
  for (const match of text.matchAll(pattern)) {
    const value = match[0];
    dates.push({
      value,
      context: cleanExtractedText(text.slice(Math.max(0, match.index - 80), Math.min(text.length, match.index + value.length + 80))).slice(0, 240),
    });
    if (dates.length >= maxItems) break;
  }
  return dates;
}

function extractMetadata(text: string) {
  const metadata: Record<string, string> = {};
  const title = /<title[^>]*>([\s\S]*?)<\/title>/iu.exec(text)?.[1];
  if (title) metadata.title = cleanExtractedText(stripTags(title)).slice(0, 500);
  for (const match of text.matchAll(/<meta\b[^>]*?\bname\s*=\s*["']([^"']+)["'][^>]*?\bcontent\s*=\s*["']([^"']*)["'][^>]*>/giu)) {
    const key = cleanExtractedText(match[1] ?? '').slice(0, 120);
    const value = cleanExtractedText(match[2] ?? '').slice(0, 1_000);
    if (key && value) metadata[key] = value;
  }
  return metadata;
}

function extractResultItems(text: string, maxItems: number) {
  const links = extractLinks(text, maxItems);
  return links.map((link) => ({
    title: link.text,
    url: link.url,
  }));
}

function extractForms(text: string, maxItems: number) {
  const forms: Array<{
    action?: string;
    method?: 'get' | 'post';
    controls: Array<{ name?: string; type?: string; value?: string }>;
  }> = [];
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/giu;
  for (const formMatch of text.matchAll(formPattern)) {
    const attrs = formMatch[1] ?? '';
    const body = formMatch[2] ?? '';
    const method = attr(attrs, 'method')?.toLowerCase();
    const controls = [...body.matchAll(/<(?:input|textarea|select)\b([^>]*)>/giu)]
      .slice(0, 50)
      .map((control) => ({
        name: attr(control[1] ?? '', 'name'),
        type: attr(control[1] ?? '', 'type'),
        value: attr(control[1] ?? '', 'value'),
      }));
    forms.push({
      action: attr(attrs, 'action'),
      method: method === 'post' ? 'post' : method === 'get' ? 'get' : undefined,
      controls,
    });
    if (forms.length >= maxItems) break;
  }
  return forms;
}

function attr(attrs: string, name: string) {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'iu').exec(attrs)?.[1];
}

function cleanExtractedUrl(value: string | undefined) {
  if (!value) return undefined;
  const trimmed = value.trim().replace(/[.,;:]+$/u, '');
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function stripTags(value: string) {
  return value.replace(/<[^>]*>/gu, ' ');
}

function cleanExtractedText(value: string) {
  return value.replace(/\s+/gu, ' ').trim();
}

function safeBrowserArtifactSegment(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact';
}

function safeBrowserArtifactFilename(value: string) {
  const clean = value.trim().replace(/[/\\?%*:|"<>]+/g, '-').replace(/\s+/g, '-').replace(/^-+|-+$/g, '');
  return clean || 'download.bin';
}

function browserSourcePageRef(textRef: string | undefined): string | undefined {
  if (!textRef) return undefined;
  return textRef.replace(/(?:-[a-f0-9]{10})?\.txt$/i, '.source.json');
}

function browserModuleDescription(): ModuleDescription {
  const primitives = browserPrimitiveModuleDescription();
  return createModuleDescription({
    moduleId: 'browser',
    title: 'Browser',
    summary: 'Browser primitive module; Host owns source choice, repair, verification, final synthesis, and completion truth.',
    resources: [
      { kind: 'browser-source-page', refPrefix: 'browser:source-page:', queryable: false, readable: true },
      { kind: 'browser-page-text', refPrefix: 'browser:page-text:', queryable: false, readable: true },
      { kind: 'browser-host-session', refPrefix: 'browser-host-session:', queryable: false, readable: true },
      ...(primitives.resources ?? []).filter((resource) =>
        !['browser:source-page:', 'browser:page-text:'].includes(resource.refPrefix),
      ),
    ],
    intents: primitives.intents ?? [],
    facets: { refs: true, events: true },
    limits: { maxInlineBytes: 16_000, expectedLatencyMs: 500 },
  });
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))];
}

function numericBudget(value: number, min: number, max: number) {
  const numeric = Math.floor(value);
  return Math.max(min, Math.min(max, numeric));
}
