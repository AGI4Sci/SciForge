import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright-core';

import { browserExecutablePath } from './browser-workflows-fixtures';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-provider-preflight-smoke-'));
const workspacePort = 24080 + Math.floor(Math.random() * 1000);
const uiPort = 25080 + Math.floor(Math.random() * 1000);
const children: ChildProcess[] = [];
const agentServer = await createMockAgentServer();

try {
  await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'task-results'), { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'scenarios'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify({
    schemaVersion: 2,
    workspacePath: workspace,
    sessionsByScenario: {},
    archivedSessions: [],
    alignmentContracts: [],
    updatedAt: new Date().toISOString(),
  }, null, 2));

  children.push(start('workspace', ['npm', 'run', 'workspace:server'], {
    SCIFORGE_WORKSPACE_PORT: String(workspacePort),
    SCIFORGE_CONFIG_PATH: join(workspace, '.sciforge', 'config.local.json'),
  }));
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    SCIFORGE_UI_PORT: String(uiPort),
  }));
  await waitForHttp(`http://127.0.0.1:${workspacePort}/health`);
  await waitForHttp(`http://127.0.0.1:${uiPort}/`);

  const browser = await chromium.launch({
    executablePath: browserExecutablePath(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const page = await newProviderPreflightPage(browser, agentServer.baseUrl);

    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '场景工作台' }).click();
    await expandWorkbenchChrome(page);
    await page.getByText('Scenario Builder').first().waitFor({ timeout: 15_000 });
    await waitForComposer(page);

    await sendPrompt(page, '请检索今天 arXiv 上 agentic harness evolution 的最新论文，下载全文并生成证据报告。');
    await page.getByText('尚未就绪的工具能力').first().waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.body.textContent?.includes('Capability provider preflight'), null, { timeout: 10_000 });
    await page.waitForFunction(() => document.body.textContent?.includes('web_search'), null, { timeout: 10_000 });
    assert.equal(agentServer.runRequests.length, 0, 'missing provider preflight must stop before AgentServer run dispatch');

    agentServer.setSearchEnabled(true);
    await sendPrompt(page, '启用 AgentServer server-side web_search 后，用同一个窄日期 query 再检索；如果为空请说明 empty result 并给恢复建议。');
    await page.getByText('CAP-P2-02 server-side empty result summary').first().waitFor({ timeout: 25_000 });
    await waitForTextContent(page, '扩大 query');
    await waitForTextContent(page, '运行需要恢复');

    assert.equal(agentServer.runRequests.length, 1, 'ready provider route should allow exactly one AgentServer run dispatch');
    const handoff = await handoffTextWithRawRef(agentServer.runRequests[0]);
    assert.match(handoff, /capabilityProviderRoutes/, 'handoff should carry capability provider routes');
    assert.match(handoff, /sciforge\.web-worker\.web_search/, 'handoff should select independent web worker provider');
    assert.ok(agentServer.discoveryRequests.length >= 2, 'workspace runtime should discover AgentServer provider availability server-side');
    assert.deepEqual((page as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'provider preflight workflow should not emit page errors');
    await page.close();
  } finally {
    await browser.close();
  }
  console.log('[ok] browser provider preflight smoke covered fail-closed discovery and recoverable empty server-side search result');
} finally {
  for (const child of children.reverse()) child.kill('SIGTERM');
  await agentServer.close();
  await rm(workspace, { recursive: true, force: true });
}

async function expandWorkbenchChrome(page: Page) {
  const toggle = page.locator('.workbench-chrome-toggle-main');
  await toggle.waitFor({ state: 'visible', timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

async function newProviderPreflightPage(browser: Browser, agentServerBaseUrl: string) {
  const page = await browser.newPage({ viewport: { width: 1360, height: 980 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[browser:${message.type()}] ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    console.error(`[browser:requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  await page.route('http://127.0.0.1:5174/health', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ ok: true, status: 'mocked-default-workspace-health' }),
    });
  });
  const config = {
    schemaVersion: 1,
    agentServerBaseUrl,
    workspaceWriterBaseUrl: `http://127.0.0.1:${workspacePort}`,
    workspacePath: workspace,
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    agentBackend: 'codex',
    requestTimeoutMs: 8_000,
    updatedAt: new Date().toISOString(),
  };
  await fetch(`http://127.0.0.1:${workspacePort}/api/sciforge/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  await page.addInitScript(({ config }) => {
    window.localStorage.setItem('sciforge.config.v1', JSON.stringify(config));
    window.localStorage.setItem('sciforge.workspace.v2', JSON.stringify({
      schemaVersion: 2,
      workspacePath: config.workspacePath,
      sessionsByScenario: {},
      archivedSessions: [],
      alignmentContracts: [],
      updatedAt: new Date().toISOString(),
    }));
  }, { config });
  (page as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors = pageErrors;
  return page;
}

async function sendPrompt(page: Page, prompt: string) {
  await waitForComposer(page);
  await page.locator('.chat-panel .composer textarea').fill(prompt);
  await page.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
}

async function waitForComposer(page: Page) {
  try {
    const collapsed = page.locator('.chat-panel .composer-collapsed');
    if (await collapsed.isVisible().catch(() => false)) await collapsed.click();
    await page.locator('.chat-panel .composer textarea').waitFor({ timeout: 15_000 });
  } catch (error) {
    const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    console.error(`[browser:body]\n${bodyText.slice(0, 4_000)}`);
    throw error;
  }
}

async function waitForTextContent(page: Page, text: string, timeout = 10_000) {
  try {
    await page.waitForFunction((value) => document.body.textContent?.includes(value), text, { timeout });
  } catch (error) {
    const bodyText = await page.locator('body').innerText({ timeout: 2_000 }).catch(() => '');
    console.error(`[browser:missing:${text}]\n${bodyText.slice(0, 4_000)}`);
    throw error;
  }
}

async function handoffTextWithRawRef(request: Record<string, unknown>) {
  const inline = JSON.stringify(request);
  const input = isRecord(request.input) ? request.input : {};
  const text = typeof input.text === 'string' ? input.text : '';
  const rawRef = /^rawRef:\s*(.+)$/m.exec(text)?.[1]?.trim();
  if (!rawRef) return inline;
  const rawPath = join(workspace, rawRef);
  const raw = await readFile(rawPath, 'utf8').catch(() => '');
  return `${inline}\n${raw}`;
}

async function createMockAgentServer() {
  let searchEnabled = false;
  const runRequests: Array<Record<string, unknown>> = [];
  const discoveryRequests: string[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (url.pathname === '/health' || url.pathname === '/api/agent-server/health') {
      writeJson(response, { ok: true, status: 'online' });
      return;
    }
    if (isProviderDiscoveryPath(url.pathname)) {
      discoveryRequests.push(url.pathname);
      writeJson(response, searchEnabled ? readyProviderDiscoveryPayload() : emptyProviderDiscoveryPayload());
      return;
    }
    if (/\/api\/agent-server\/agents\/[^/]+\/context$/.test(url.pathname)) {
      writeJson(response, { ok: true, context: { refs: [], digest: 'mock provider preflight context' } });
      return;
    }
    if (url.pathname === '/api/agent-server/compact') {
      writeJson(response, { contextCompaction: { status: 'skipped', reason: 'mock provider preflight smoke' } });
      return;
    }
    if (url.pathname === '/api/agent-server/runs/stream') {
      runRequests.push(await readJsonBody(request));
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      response.end([
        JSON.stringify({ event: { type: 'status', message: 'mock AgentServer server-side search started' } }),
        JSON.stringify({
          result: {
            data: {
              run: {
                id: `cap-p2-02-run-${runRequests.length}`,
                status: 'completed',
                output: { toolPayload: zeroResultToolPayload() },
              },
            },
          },
        }),
        '',
      ].join('\n'));
      return;
    }
    writeJson(response, { ok: true, path: url.pathname });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    runRequests,
    discoveryRequests,
    setSearchEnabled(value: boolean) {
      searchEnabled = value;
    },
    close: () => closeServer(server),
  };
}

function isProviderDiscoveryPath(pathname: string) {
  return pathname === '/api/agent-server/tools/manifest'
    || pathname === '/api/agent-server/workers'
    || pathname === '/tools/manifest'
    || pathname === '/workers';
}

function readyProviderDiscoveryPayload() {
  return {
    providers: [{
      id: 'sciforge.web-worker.web_search',
      providerId: 'sciforge.web-worker.web_search',
      capabilityId: 'web_search',
      workerId: 'sciforge.web-worker',
      status: 'available',
    }, {
      id: 'sciforge.web-worker.web_fetch',
      providerId: 'sciforge.web-worker.web_fetch',
      capabilityId: 'web_fetch',
      workerId: 'sciforge.web-worker',
      status: 'available',
    }],
  };
}

function emptyProviderDiscoveryPayload() {
  return { workers: [] };
}

function zeroResultToolPayload() {
  return {
    message: 'CAP-P2-02 server-side empty result summary: provider route ready, but arXiv search returned zero results for the narrow date query. 扩大 query 或放宽日期范围后重试。',
    confidence: 0.82,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      status: 'repair-needed',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: 'browser-provider-preflight',
        currentTurn: {
          id: 'turn-zero-result',
          prompt: '启用 AgentServer server-side web_search 后，用同一个窄日期 query 再检索。',
        },
        visibleAnswer: {
          status: 'repair-needed',
          text: 'CAP-P2-02 server-side empty result summary: 没有找到匹配论文；这是 empty result，不是 completed report。',
          artifactRefs: [],
          diagnostic: 'empty-results from sciforge.web-worker.web_search',
        },
        activeRun: { id: 'cap-p2-02-run', status: 'repair-needed' },
        artifacts: [],
        executionProcess: [{
          eventId: 'provider-route',
          type: 'provider-route',
          summary: 'web_search -> sciforge.web-worker.web_search',
          timestamp: new Date().toISOString(),
        }],
        recoverActions: ['扩大 query', '放宽日期范围', '启用 fallback provider 后重试'],
        diagnostics: [{
          severity: 'warning',
          code: 'empty-results',
          message: 'web_search provider returned zero records for the narrow arXiv date query.',
          refs: [{ ref: 'provider:sciforge.web-worker.web_search' }],
        }],
        auditRefs: [
          'provider:sciforge.web-worker.web_search',
          'runtime://capability-provider-route/web_search',
        ],
      },
    },
    claims: [{
      id: 'claim-cap-p2-02-empty-result',
      type: 'limitation',
      text: 'The server-side web_search provider was available but returned zero records for the requested narrow query.',
      confidence: 0.86,
      evidenceLevel: 'runtime',
      supportingRefs: ['provider:sciforge.web-worker.web_search'],
      opposingRefs: [],
    }],
    executionUnits: [{
      id: 'EU-cap-p2-02-web-search-empty',
      tool: 'sciforge.web-worker.web_search',
      params: JSON.stringify({
        query: 'agentic harness evolution',
        date: 'today',
        routeTraceRef: 'runtime://capability-provider-route/web_search',
      }),
      status: 'repair-needed',
      hash: 'cap-p2-02-empty-result',
      failureReason: 'empty-results',
      recoverActions: ['扩大 query', '放宽日期范围', '启用 fallback provider 后重试'],
      nextStep: 'Expand the search query or relax the date range, then rerun through the ready provider route.',
      stdoutRef: 'provider:sciforge.web-worker.web_search',
      outputRef: 'provider-result:empty',
    }],
    artifacts: [],
  };
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function writeJson(response: ServerResponse, payload: unknown) {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function start(label: string, command: string[], extraEnv: Record<string, string>) {
  const child = spawn(command[0] ?? 'npm', command.slice(1), {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) console.log(`[${label}] ${text}`);
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk).trim();
    if (text) console.error(`[${label}] ${text}`);
  });
  return child;
}

async function waitForHttp(url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
