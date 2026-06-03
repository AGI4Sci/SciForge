import { defineConfig } from 'vite';
import type { ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WORKSPACE_PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || 5174);
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || 5173);
const AGENT_SERVER_PORT = Number(process.env.SCIFORGE_AGENT_SERVER_PORT || 18080);
const CODEX_PROXY_PORT = Number(process.env.SCIFORGE_PROXY_PORT || 3891);
const AGENT_SERVER_ROOT = resolve(process.env.SCIFORGE_AGENT_SERVER_ROOT || '../AgentServer');
const CONFIG_LOCAL_PATH = resolve(process.env.SCIFORGE_CONFIG_PATH || 'config.local.json');
const RUNTIME_LOG_DIR = resolve(process.env.SCIFORGE_LOG_DIR || 'workspace/.sciforge/logs');
const runtimeChildren = new Map<string, ReturnType<typeof spawn>>();
const STARTUP_TIMEOUT_MS = Number(process.env.SCIFORGE_RUNTIME_START_TIMEOUT_MS || 30_000);
const BROWSER_HOST_SESSION_RUNTIME_ENDPOINT_TOKENS = ['start', 'state', 'actions', 'computer-use-actions'] as const;
const BROWSER_HOST_SESSION_NATIVE_ENDPOINT_TOKENS = ['start', 'state', 'actions', 'computer-use-actions'] as const;
const BROWSER_HOST_NATIVE_SURFACE_ENDPOINT_TOKENS = ['health', 'attach', 'state'] as const;
const BROWSER_HOST_SEARCH_ENDPOINT_TOKENS = ['search'] as const;

export default defineConfig({
  base: './',
  plugins: [react(), sciForgeRuntimeLauncher()],
  root: 'src/ui',
  define: {
    'import.meta.env.VITE_SCIFORGE_INSTANCE_ID': JSON.stringify(
      process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE || '',
    ),
    'import.meta.env.VITE_SCIFORGE_DEFAULT_AGENT_SERVER_URL': JSON.stringify(
      process.env.SCIFORGE_AGENT_SERVER_URL || `http://127.0.0.1:${AGENT_SERVER_PORT}`,
    ),
    'import.meta.env.VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL': JSON.stringify(
      process.env.SCIFORGE_WORKSPACE_WRITER_URL || `http://127.0.0.1:${WORKSPACE_PORT}`,
    ),
    'import.meta.env.VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH': JSON.stringify(
      process.env.SCIFORGE_WORKSPACE_PATH || '/Applications/workspace/ailab/research/app/SciForge/workspace',
    ),
  },
  build: {
    outDir: '../../dist-ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/3dmol')) return 'vendor-3dmol';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) return 'vendor-charts';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
          if (id.includes('src/ui/src/app/ResultsRenderer') || id.includes('src/ui/src/app/results') || id.includes('packages/presentation')) return 'results-rendering';
          if (id.includes('src/ui/src/app/ScenarioBuilderPanel') || id.includes('src/ui/src/scenarioCompiler')) return 'scenario-builder';
          if (id.includes('src/ui/src/app/ComponentWorkbenchPage')) return 'component-workbench';
          return undefined;
        },
      },
    },
  },
  server: {
    port: UI_PORT,
    strictPort: true,
  },
});

function sciForgeRuntimeLauncher() {
  return {
    name: 'sciforge-runtime-launcher',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/sciforge/provider-models', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, error: 'GET required' });
          return;
        }
        try {
          const response = await fetch(`http://127.0.0.1:${CODEX_PROXY_PORT}/v1/models`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8_000),
          });
          const body = await response.json().catch(() => ({}));
          writeJson(res, response.ok ? 200 : response.status, body);
        } catch (error) {
          writeJson(res, 502, {
            error: {
              code: 'provider_models_unavailable',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      });
      server.middlewares.use('/api/sciforge/browser/proxy', async (req: IncomingMessage, res: ServerResponse) => {
        await handleBrowserProxyRequest(req, res);
      });
      server.middlewares.use('/api/sciforge/browser/pdf-viewer', async (req: IncomingMessage, res: ServerResponse) => {
        await handleBrowserPdfViewerRequest(req, res);
      });
      server.middlewares.use('/api/sciforge/workspace/pick-directory', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'POST required' });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const { pickWorkspaceDirectoryPath } = await import('./src/runtime/server/workspace-directory-picker.js');
          const path = await pickWorkspaceDirectoryPath({
            defaultPath: typeof body.defaultPath === 'string' ? body.defaultPath : undefined,
          });
          writeJson(res, 200, { ok: true, path, cancelled: !path });
        } catch (error) {
          writeJson(res, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
      server.middlewares.use('/api/sciforge/runtime/start', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'POST required' });
          return;
        }
        try {
          const body = await readJsonBody(req);
          const requireBrowserHostNativeSurface = body.requireBrowserHostNativeSurface === true;
          const [workspace, agentserver] = await Promise.all([
            ensureRuntimeProcess({
              id: 'workspace',
              label: 'Workspace Writer',
              port: WORKSPACE_PORT,
              healthUrl: `http://127.0.0.1:${WORKSPACE_PORT}/health`,
              cwd: process.cwd(),
              args: ['run', 'workspace:server'],
              requiredCapabilities: browserRuntimeWorkspaceCapabilities(requireBrowserHostNativeSurface),
              requiredEndpoints: browserRuntimeWorkspaceEndpoints(requireBrowserHostNativeSurface),
              startupBlocked: requireBrowserHostNativeSurface ? browserRuntimeNativeSurfaceStartupBlocker : undefined,
            }),
            ensureRuntimeProcess({
              id: 'agentserver',
              label: 'AgentServer',
              port: AGENT_SERVER_PORT,
              healthUrl: `http://127.0.0.1:${AGENT_SERVER_PORT}/health`,
              cwd: AGENT_SERVER_ROOT,
              args: ['run', 'dev'],
              env: agentServerEnv(),
              enabled: existsSync(AGENT_SERVER_ROOT),
              missingReason: `AgentServer root not found at ${AGENT_SERVER_ROOT}`,
            }),
          ]);
          writeJson(res, 200, { ok: workspace.ok && agentserver.ok, services: [workspace, agentserver] });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

type RuntimeHealth = {
  ok: boolean;
  capabilities: string[];
  endpoints: Record<string, unknown>;
};

type RuntimeRequiredEndpoint = {
  key: string;
  tokens: readonly string[];
};

async function ensureRuntimeProcess(options: {
  id: string;
  label: string;
  port: number;
  healthUrl: string;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  missingReason?: string;
  requiredCapabilities?: readonly string[];
  requiredEndpoints?: readonly RuntimeRequiredEndpoint[];
  startupBlocked?: (health: RuntimeHealth) => { status: string; detail: string } | undefined;
}) {
  if (options.enabled === false) return { id: options.id, label: options.label, ok: false, status: 'missing', detail: options.missingReason };
  const health = await readHealth(options.healthUrl);
  if (runtimeHealthSatisfiesRequirements(health, options.requiredCapabilities, options.requiredEndpoints)) {
    return { id: options.id, label: options.label, ok: true, status: 'online', detail: options.healthUrl };
  }
  const blocked = options.startupBlocked?.(health);
  if (blocked) return { id: options.id, label: options.label, ok: false, status: blocked.status, detail: blocked.detail };
  const existing = runtimeChildren.get(options.id);
  if (existing && existing.exitCode === null && !existing.killed) {
    await stopRuntimeChild(options.id, existing);
  }
  await mkdir(RUNTIME_LOG_DIR, { recursive: true });
  const logPath = join(RUNTIME_LOG_DIR, `${options.id}-runtime.log`);
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`\n\n[${new Date().toISOString()}] starting ${options.label}: npm ${options.args.join(' ')}\n`);
  const child = spawn('npm', options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once('exit', (code, signal) => {
    log.write(`[${new Date().toISOString()}] ${options.label} exited: ${signal || `code ${code}`}\n`);
    log.end();
    runtimeChildren.delete(options.id);
  });
  runtimeChildren.set(options.id, child);
  const healthy = await waitForHealthy(options.healthUrl, STARTUP_TIMEOUT_MS, options.requiredCapabilities, options.requiredEndpoints);
  if (healthy) {
    return { id: options.id, label: options.label, ok: true, status: 'online', detail: options.healthUrl, logPath };
  }
  const stillRunning = child.exitCode === null && !child.killed;
  return {
    id: options.id,
    label: options.label,
    ok: false,
    status: stillRunning ? 'starting-timeout' : 'failed',
    detail: stillRunning
      ? `${options.healthUrl} 未在 ${STARTUP_TIMEOUT_MS}ms 内通过 health check`
      : `${options.label} 启动后已退出`,
    logPath,
  };
}

async function stopRuntimeChild(id: string, child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.killed) {
    runtimeChildren.delete(id);
    return;
  }
  child.kill('SIGTERM');
  await sleep(1200);
  if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  runtimeChildren.delete(id);
}

function agentServerEnv() {
  return {
    OPENTEAM_SERVER_PORT: String(AGENT_SERVER_PORT),
    PORT: String(AGENT_SERVER_PORT),
    NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, '--max-old-space-size=8192'),
    ...agentServerModelEnvFromLocalConfig(),
  };
}

function agentServerModelEnvFromLocalConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_LOCAL_PATH, 'utf8'));
    const llm = isRecord(parsed?.llm) ? parsed.llm : {};
    const provider = typeof llm.provider === 'string' ? llm.provider.trim() : '';
    const baseUrl = typeof llm.baseUrl === 'string' ? llm.baseUrl.trim().replace(/\/+$/, '') : '';
    const apiKey = typeof llm.apiKey === 'string' ? llm.apiKey.trim() : '';
    const model = typeof llm.model === 'string' ? llm.model.trim() : typeof llm.modelName === 'string' ? llm.modelName.trim() : '';
    return {
      ...(provider ? { AGENT_SERVER_MODEL_PROVIDER: provider, AGENT_SERVER_ADAPTER_LLM_PROVIDER: provider } : {}),
      ...(baseUrl ? { AGENT_SERVER_MODEL_BASE_URL: baseUrl, AGENT_SERVER_ADAPTER_LLM_BASE_URL: baseUrl } : {}),
      ...(apiKey ? { AGENT_SERVER_MODEL_API_KEY: apiKey, AGENT_SERVER_ADAPTER_LLM_API_KEY: apiKey } : {}),
      ...(model ? { AGENT_SERVER_MODEL: model, AGENT_SERVER_MODEL_NAME: model, AGENT_SERVER_ADAPTER_LLM_MODEL: model } : {}),
    };
  } catch {
    return {};
  }
}

function mergeNodeOptions(existing: string | undefined, required: string) {
  const current = existing?.trim() ?? '';
  return current.includes('--max-old-space-size') ? current : [current, required].filter(Boolean).join(' ');
}

async function handleBrowserProxyRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeJson(res, 405, { ok: false, error: 'GET or HEAD required' });
    return;
  }
  try {
    const requestUrl = new URL(req.url ?? '', 'http://127.0.0.1');
    const target = browserProxyTargetUrl(requestUrl.searchParams.get('url'));
    const download = requestUrl.searchParams.get('download') === '1';
    const upstream = await readBrowserProxyUpstream(target);
    if (upstream.status < 200 || upstream.status >= 300) {
      writeJson(res, upstream.status, {
        ok: false,
        error: `Browser proxy upstream returned ${upstream.status}`,
        url: target.href,
      });
      return;
    }
    const maxBytes = 100 * 1024 * 1024;
    const body = upstream.body;
    if (body.byteLength > maxBytes) {
      writeJson(res, 413, { ok: false, error: 'Browser proxy response is too large', maxBytes, bytes: body.byteLength });
      return;
    }
    const contentType = upstream.headers.get('content-type') || inferBrowserProxyContentType(target.pathname);
    const filename = browserProxyFilename(target, contentType);
    const shouldTransformHtml = !download && /text\/html|application\/xhtml\+xml/i.test(contentType);
    const responseBody = shouldTransformHtml ? transformBrowserProxyHtml(upstream.body.toString('utf8'), target) : upstream.body;
    const responseContentType = shouldTransformHtml ? 'text/html; charset=utf-8' : contentType;
    res.writeHead(200, {
      ...corsHeaders(),
      'Content-Type': responseContentType,
      'Content-Length': String(responseBody.byteLength),
      'Cache-Control': 'no-store',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
      'X-SciForge-Proxied-Url': target.href,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(responseBody);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleBrowserPdfViewerRequest(req: IncomingMessage, res: ServerResponse) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeJson(res, 405, { ok: false, error: 'GET or HEAD required' });
    return;
  }
  try {
    const requestUrl = new URL(req.url ?? '', 'http://127.0.0.1');
    const target = browserProxyTargetUrl(requestUrl.searchParams.get('url'));
    const upstream = await readBrowserProxyUpstream(target);
    if (upstream.status < 200 || upstream.status >= 300) {
      writeJson(res, upstream.status, {
        ok: false,
        error: `Browser PDF viewer upstream returned ${upstream.status}`,
        url: target.href,
      });
      return;
    }
    const maxBytes = 100 * 1024 * 1024;
    if (upstream.body.byteLength > maxBytes) {
      writeJson(res, 413, { ok: false, error: 'Browser PDF viewer response is too large', maxBytes, bytes: upstream.body.byteLength });
      return;
    }
    const contentType = upstream.headers.get('content-type') || inferBrowserProxyContentType(target.pathname);
    if (!/application\/pdf|octet-stream/i.test(contentType) && !/\.pdf$|\/pdf\/?/i.test(target.pathname)) {
      writeJson(res, 415, { ok: false, error: `Browser PDF viewer expected a PDF response, got ${contentType || 'unknown'}`, url: target.href });
      return;
    }
    const preview = await renderBrowserPdfPreviewImage(upstream.body, browserProxyFilename(target, 'application/pdf'));
    const html = browserPdfViewerHtml({
      title: browserProxyFilename(target, 'application/pdf'),
      sourceUrl: target.href,
      proxyUrl: browserProxyPath(target, false),
      downloadUrl: browserProxyPath(target, true),
      previewDataUrl: preview?.dataUrl,
      previewNote: preview?.note,
      bytes: upstream.body.byteLength,
    });
    res.writeHead(200, {
      ...corsHeaders(),
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-SciForge-Proxied-Url': target.href,
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(html);
  } catch (error) {
    writeJson(res, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function browserProxyTargetUrl(raw: string | null) {
  const cleaned = cleanBrowserProxyTargetInput(raw);
  if (!cleaned) throw new Error('Browser proxy requires url query parameter.');
  const url = new URL(cleaned);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Browser proxy only supports http/https URLs, got ${url.protocol}`);
  }
  return url;
}

function cleanBrowserProxyTargetInput(raw: string | null) {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed || /^about:blank$/i.test(trimmed)) return trimmed;
  if (/about:blank$/i.test(trimmed)) return trimmed.slice(0, -'about:blank'.length).trim();
  return trimmed;
}

async function readBrowserProxyUpstream(url: URL): Promise<{ status: number; headers: Map<string, string>; body: Buffer }> {
  try {
    const upstream = await fetch(url.href, {
      redirect: 'follow',
      headers: browserProxyHeaders(),
      signal: AbortSignal.timeout(30_000),
    });
    return {
      status: upstream.status,
      headers: responseHeaderMap(upstream.headers),
      body: Buffer.from(await upstream.arrayBuffer()),
    };
  } catch {
    return readBrowserProxyUpstreamWithCurl(url);
  }
}

async function readBrowserProxyUpstreamWithCurl(url: URL): Promise<{ status: number; headers: Map<string, string>; body: Buffer }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-proxy-'));
  const bodyPath = join(tempDir, 'body.bin');
  const headerPath = join(tempDir, 'headers.txt');
  try {
    const { code, stderr } = await spawnAndWait('curl', [
      '-L',
      '--silent',
      '--show-error',
      '--max-time',
      '30',
      '--output',
      bodyPath,
      '--dump-header',
      headerPath,
      '--header',
      `Accept: ${browserProxyHeaders().Accept}`,
      '--user-agent',
      browserProxyHeaders()['User-Agent'],
      url.href,
    ]);
    const headers = parseCurlHeaderBlocks(await readFile(headerPath, 'utf8').catch(() => ''));
    const body = await readFile(bodyPath).catch(() => Buffer.alloc(0));
    if (code !== 0) {
      throw new Error(stderr || `curl exited ${code}`);
    }
    return { status: headers.status || 502, headers: headers.headers, body };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function browserProxyHeaders() {
  return {
    Accept: 'application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'User-Agent': 'Mozilla/5.0 SciForgeBrowserWorkbench/1.0 (+https://github.com/AGI4Sci/SciForge)',
  };
}

function responseHeaderMap(headers: Headers) {
  const map = new Map<string, string>();
  headers.forEach((value, key) => map.set(key.toLowerCase(), value));
  return map;
}

function parseCurlHeaderBlocks(raw: string) {
  const blocks = raw.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
  const block = blocks.at(-1) || '';
  const lines = block.split(/\r?\n/).filter(Boolean);
  const status = Number(lines[0]?.match(/\s(\d{3})(?:\s|$)/)?.[1] || 0);
  const headers = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return { status, headers };
}

function spawnAndWait(command: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
    child.once('error', (error) => resolvePromise({ code: 1, stderr: error.message }));
    child.once('exit', (code) => resolvePromise({
      code: code ?? 1,
      stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
    }));
  });
}

function inferBrowserProxyContentType(pathname: string) {
  return /\.pdf$/i.test(pathname) || /\/pdf\/?/i.test(pathname) ? 'application/pdf' : 'application/octet-stream';
}

function browserProxyFilename(url: URL, contentType: string) {
  const lastSegment = decodeURIComponent(url.pathname.split('/').filter(Boolean).at(-1) || 'download');
  const safe = lastSegment.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'download';
  if (/application\/pdf/i.test(contentType) && !/\.pdf$/i.test(safe)) return `${safe}.pdf`;
  return safe;
}

function browserProxyPath(url: URL, download: boolean) {
  const params = new URLSearchParams({ url: url.href });
  if (download) params.set('download', '1');
  return `/api/sciforge/browser/proxy?${params.toString()}`;
}

function browserPdfViewerPath(url: URL) {
  const params = new URLSearchParams({ url: url.href });
  return `/api/sciforge/browser/pdf-viewer?${params.toString()}`;
}

export function transformBrowserProxyHtml(rawHtml: string, target: URL) {
  const withoutScripts = rawHtml
    .replace(/<base\b[^>]*>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+target\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return Buffer.from(rewriteBrowserProxyResourceUrls(withoutScripts, target), 'utf8');
}

function rewriteBrowserProxyResourceUrls(html: string, target: URL) {
  const hrefRewritten = html.replace(/(<(?:a|link)\b[^>]*?\shref=)(["'])([^"']+)\2/gi, (match, prefix: string, quote: string, href: string) => {
    const rewritten = browserProxyResourceUrl(href, target);
    if (!rewritten) return match;
    return `${prefix}${quote}${escapeHtml(rewritten)}${quote}`;
  });
  const srcRewritten = hrefRewritten.replace(/(<(?:img|source|video|audio|iframe)\b[^>]*?\ssrc=)(["'])([^"']+)\2/gi, (match, prefix: string, quote: string, src: string) => {
    const rewritten = browserProxyResourceUrl(src, target);
    if (!rewritten) return match;
    return `${prefix}${quote}${escapeHtml(rewritten)}${quote}`;
  });
  return srcRewritten.replace(/(<form\b[^>]*?\saction=)(["'])([^"']+)\2/gi, (match, prefix: string, quote: string, action: string) => {
    const rewritten = browserProxyResourceUrl(action, target);
    if (!rewritten) return match;
    return `${prefix}${quote}${escapeHtml(rewritten)}${quote}`;
  });
}

function browserProxyResourceUrl(href: string, target: URL) {
  const trimmed = href.trim();
  if (!trimmed || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(trimmed)) return undefined;
  try {
    const resolved = new URL(trimmed, target);
    if (isBrowserProxyPdfTarget(resolved)) return browserPdfViewerPath(resolved);
    return browserProxyPath(resolved, false);
  } catch {
    return undefined;
  }
}

function isBrowserProxyPdfTarget(url: URL) {
  return /\.pdf$/i.test(url.pathname) || /\/pdf\/?/i.test(url.pathname);
}

function isBrowserProxyStaticHtmlTarget(url: URL) {
  const host = url.hostname.toLowerCase();
  return (host === 'arxiv.org' || host === 'www.arxiv.org') && /^\/(?:abs|search)\b/.test(url.pathname);
}

async function renderBrowserPdfPreviewImage(body: Buffer, filename: string): Promise<{ dataUrl?: string; note?: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-browser-pdf-viewer-'));
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]+/g, '-') || 'paper.pdf';
  const pdfPath = join(tempDir, /\.pdf$/i.test(safeFilename) ? safeFilename : `${safeFilename}.pdf`);
  try {
    await writeFile(pdfPath, body);
    const { code, stderr } = await spawnAndWait('qlmanage', ['-t', '-s', '1400', '-o', tempDir, pdfPath]);
    if (code !== 0) {
      return { note: stderr || `qlmanage exited ${code}; PDF can still be downloaded.` };
    }
    const png = await readFile(`${pdfPath}.png`).catch(() => undefined);
    if (!png?.byteLength) return { note: 'PDF preview image was not generated; PDF can still be downloaded.' };
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}` };
  } catch (error) {
    return { note: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function browserPdfViewerHtml(input: {
  title: string;
  sourceUrl: string;
  proxyUrl: string;
  downloadUrl: string;
  previewDataUrl?: string;
  previewNote?: string;
  bytes: number;
}) {
  const title = escapeHtml(input.title);
  const sourceUrl = escapeHtml(input.sourceUrl);
  const proxyUrl = escapeHtml(input.proxyUrl);
  const downloadUrl = escapeHtml(input.downloadUrl);
  const sizeMb = (input.bytes / 1024 / 1024).toFixed(2);
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      :root { color-scheme: dark light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { margin: 0; background: #202124; color: #e5e7eb; }
      header { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center; padding: 10px 14px; background: #303134; border-bottom: 1px solid rgba(255,255,255,.12); }
      strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      a { color: #dbeafe; text-decoration: none; border: 1px solid rgba(255,255,255,.18); border-radius: 8px; padding: 6px 10px; background: rgba(255,255,255,.08); }
      main { display: grid; justify-items: center; padding: 28px 16px 48px; }
      .page { max-width: min(920px, 94vw); background: #f8fafc; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
      img { display: block; width: 100%; height: auto; }
      .fallback { max-width: 720px; padding: 32px; background: rgba(15,23,42,.78); border: 1px solid rgba(148,163,184,.24); border-radius: 12px; color: #cbd5e1; }
      small { color: #aab4c3; }
    </style>
  </head>
  <body>
    <header>
      <strong>${title}</strong>
      <small>${sizeMb} MB</small>
      <a href="${downloadUrl}" download>下载 PDF</a>
      <a href="${proxyUrl}">原始 PDF</a>
    </header>
    <main>
      ${input.previewDataUrl
        ? `<section class="page" aria-label="PDF 首页预览"><img src="${input.previewDataUrl}" alt="${title} 首页预览" /></section>`
        : `<section class="fallback"><h1>PDF 已获取，但当前环境没有生成可视预览</h1><p>${escapeHtml(input.previewNote ?? '可以使用上方下载入口保存全文 PDF。')}</p><p><small>${sourceUrl}</small></p></section>`}
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readHealth(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    const json = await response.json().catch(() => ({})) as { capabilities?: unknown; endpoints?: unknown };
    return {
      ok: response.ok,
      capabilities: Array.isArray(json.capabilities) ? json.capabilities.map(String) : [],
      endpoints: isRecord(json.endpoints) ? json.endpoints : {},
    };
  } catch {
    return { ok: false, capabilities: [], endpoints: {} };
  }
}

async function waitForHealthy(
  url: string,
  timeoutMs: number,
  requiredCapabilities?: readonly string[],
  requiredEndpoints?: readonly RuntimeRequiredEndpoint[],
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await readHealth(url);
    if (runtimeHealthSatisfiesRequirements(health, requiredCapabilities, requiredEndpoints)) return true;
    await sleep(350);
  }
  return false;
}

function runtimeHealthSatisfiesRequirements(
  health: RuntimeHealth,
  requiredCapabilities: readonly string[] = [],
  requiredEndpoints: readonly RuntimeRequiredEndpoint[] = [],
) {
  if (!health.ok) return false;
  for (const capability of requiredCapabilities) {
    if (!health.capabilities.includes(capability)) return false;
  }
  for (const requiredEndpoint of requiredEndpoints) {
    const endpoint = health.endpoints[requiredEndpoint.key];
    if (typeof endpoint !== 'string') return false;
    if (!requiredEndpoint.tokens.every((token) => endpoint.includes(token))) return false;
  }
  return true;
}

function browserRuntimeWorkspaceCapabilities(requireBrowserHostNativeSurface: boolean): readonly string[] {
  return requireBrowserHostNativeSurface
    ? ['browser-host-session', 'browser-host-native-surface', 'browser-host-search']
    : ['browser-host-session'];
}

function browserRuntimeWorkspaceEndpoints(requireBrowserHostNativeSurface: boolean): readonly RuntimeRequiredEndpoint[] {
  return requireBrowserHostNativeSurface ? [{
    key: 'browserHostSession',
    tokens: BROWSER_HOST_SESSION_NATIVE_ENDPOINT_TOKENS,
  }, {
    key: 'browserHostNativeSurface',
    tokens: BROWSER_HOST_NATIVE_SURFACE_ENDPOINT_TOKENS,
  }, {
    key: 'browserHostSearch',
    tokens: BROWSER_HOST_SEARCH_ENDPOINT_TOKENS,
  }] : [{
    key: 'browserHostSession',
    tokens: BROWSER_HOST_SESSION_RUNTIME_ENDPOINT_TOKENS,
  }];
}

function browserRuntimeNativeSurfaceStartupBlocker(_health: RuntimeHealth) {
  if (browserHostNativeAdapterEnvIsLoopback()) return undefined;
  return {
    status: 'native-surface-adapter-missing',
    detail: 'BrowserHostSession live browser sessions require a Desktop Electron native surface adapter. The Vite web dev server cannot create a right-pane native surface by itself; launch the Desktop Electron host or start Workspace Writer with SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL from the Desktop surface server.',
  };
}

function browserHostNativeAdapterEnvIsLoopback() {
  const value = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL?.trim();
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1')
      && Boolean(url.port);
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function writeJson(res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body?: string) => void }, status: number, body: unknown) {
  res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  return isRecord(parsed) ? parsed : {};
}
