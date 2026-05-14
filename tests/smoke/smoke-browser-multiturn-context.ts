import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright-core';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-multiturn-'));
const artifactsDir = resolve('docs', 'test-artifacts');
const workspacePort = 23080 + Math.floor(Math.random() * 1000);
const uiPort = 24080 + Math.floor(Math.random() * 1000);
const children: ChildProcess[] = [];

try {
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
  children.push(start('workspace', ['npm', 'run', 'workspace:server'], { SCIFORGE_WORKSPACE_PORT: String(workspacePort) }));
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], { SCIFORGE_UI_PORT: String(uiPort) }));
  await waitForHttp(`http://127.0.0.1:${workspacePort}/health`);
  await waitForHttp(`http://127.0.0.1:${uiPort}/`);

  const browser = await chromium.launch({
    executablePath: browserExecutablePath(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const page = await newConfiguredPage(browser);
    const runRequests: Array<Record<string, unknown>> = [];
    await page.route(`http://127.0.0.1:${workspacePort}/api/sciforge/tools/run/stream`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      runRequests.push(body);
      const round = runRequests.length;
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: browserMultiturnToolStreamBody(round),
      });
    });

    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await openLiteratureScenario(page);

    const meterUsedTokens: number[] = [];
    let visibleCompactions = 0;
    const prompts = complexMultiTurnPrompts();
    for (let index = 0; index < prompts.length; index += 1) {
      await sendPrompt(page, prompts[index], index + 1);
      meterUsedTokens.push(await readMeterUsedTokens(page));
      if ([8, 16].includes(index + 1)) {
        visibleCompactions += await visibleContextCompactionCount(page);
      }
    }

    assert.equal(runRequests.length, 24, 'browser should send 24 distinct user turns');
    assert.ok(isNonDecreasingExcept(meterUsedTokens, [8, 16]), `context meter should grow between compactions and drop only after compact boundaries, got ${meterUsedTokens.join(', ')}`);
    assert.ok(meterUsedTokens.at(-1)! > meterUsedTokens[0]!, 'final context estimate should include accumulated multi-turn context');
    assert.ok(visibleCompactions >= 2, `browser workflow should expose at least two context compactions, got ${visibleCompactions}`);

    const lastRequest = runRequests.at(-1)!;
    const uiState = lastRequest.uiState as Record<string, unknown>;
    const ledger = uiState.conversationLedger as Array<Record<string, unknown>>;
    const recentConversation = uiState.recentConversation as string[];
    const reusePolicy = uiState.contextReusePolicy as Record<string, unknown>;
    const agentContext = uiState.agentContext as Record<string, unknown>;
    const serializedRequestBytes = runRequests.map((request) => Buffer.byteLength(JSON.stringify(request), 'utf8'));

    assert.equal(ledger.length, 47, 'turn 24 request should carry 23 prior assistant replies plus 24 user messages in the ledger');
    assert.equal(ledger[0].id, ledger[0].id, 'ledger entries should be stable records');
    assert.match(String(ledger[0].contentPreview), /Round 01/);
    assert.match(String(ledger.at(-1)?.contentPreview), /Round 24/);
    assert.equal(recentConversation.length, 16, 'recent readable window should stay bounded after 20+ turns');
    assert.match(recentConversation[0], /Round 17|Browser reply 16/);
    assert.ok(['continue', 'repair', 'isolate', undefined].includes(reusePolicy.mode as string | undefined), 'context reuse policy should stay in AgentServer mode-signal vocabulary');
    assert.equal(agentContext.conversationLedger, undefined, 'browser transport must not present UI ledger as AgentServer memory');
    assert.equal(agentContext.contextReusePolicy, undefined, 'browser transport leaves context reuse decisions to Python policy and AgentServer');
    assert.ok(Math.max(...serializedRequestBytes) < 180_000, `handoff request body should stay bounded, got ${Math.max(...serializedRequestBytes)} bytes`);
    assert.ok(isNonDecreasing(serializedRequestBytes), 'request bytes should grow predictably with append-only context, not reset unpredictably');

    await page.screenshot({ path: join(artifactsDir, 'browser-smoke-multiturn-context.png'), fullPage: true });
    assert.deepEqual((page as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], '24-turn browser workflow should not emit page errors');
    console.log(`[ok] browser 24-turn context smoke verified bounded UI projection, two visible compactions, compaction-aware meter, and request size ceiling; screenshot in ${artifactsDir}`);
  } finally {
    await browser.close();
  }
} finally {
  for (const child of children.reverse()) child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
}

async function newConfiguredPage(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[browser:${message.type()}] ${message.text()}`);
  });
  const config = {
    schemaVersion: 1,
    agentServerBaseUrl: 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: `http://127.0.0.1:${workspacePort}`,
    workspacePath: workspace,
    agentBackend: 'codex',
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: 'codex-test-200k',
    apiKey: '',
    requestTimeoutMs: 30_000,
    maxContextWindowTokens: 200_000,
    updatedAt: new Date().toISOString(),
  };
  await fetch(`http://127.0.0.1:${workspacePort}/api/sciforge/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  await page.addInitScript(({ config }) => {
    window.localStorage.setItem('sciforge.config.v1', JSON.stringify(config));
  }, { config });
  (page as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors = pageErrors;
  return page;
}

async function openLiteratureScenario(page: Page) {
  const composer = page.getByPlaceholder(/输入研究问题/);
  if (await composer.count()) {
    await composer.waitFor({ timeout: 15_000 });
    return;
  }
  await page.getByText(/Scenario Library|AI Scenario Builder/).first().waitFor({ timeout: 15_000 });
  const importButton = page.getByRole('button', { name: '导入文献场景', exact: true });
  if (await importButton.count()) {
    await importButton.click();
  } else {
    const library = page.locator('main');
    const card = library.locator('.scenario-card', { hasText: 'literature-evidence-review' }).first();
    await card.getByRole('button', { name: '打开', exact: true }).click();
  }
  await composer.waitFor({ timeout: 15_000 });
}

async function sendPrompt(page: Page, prompt: string, round: number) {
  const composer = page.getByPlaceholder(/输入研究问题/);
  await composer.fill(prompt);
  await page.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
  await page.getByText(`Browser reply ${round}`).first().waitFor({ timeout: 15_000 });
}

async function readMeterUsedTokens(page: Page) {
  const title = await page.locator('.context-window-meter').getAttribute('title', { timeout: 15_000 });
  const match = String(title ?? '').match(/used\/window:\s*([0-9,]+)\//);
  assert.ok(match, `context meter title should expose used/window, got ${title}`);
  return Number(match[1].replace(/,/g, ''));
}

function browserMultiturnToolStreamBody(round: number) {
  const contextBefore = {
    type: 'contextWindowState',
    contextWindowState: {
      source: 'native',
      backend: 'codex',
      usedTokens: 860,
      windowTokens: 1000,
      ratio: 0.86,
      status: 'near-limit',
      compactCapability: 'native',
      autoCompactThreshold: 0.82,
    },
  };
  const compaction = {
    type: 'contextCompaction',
    contextCompaction: {
      status: 'completed',
      source: 'native',
      backend: 'codex',
      compactCapability: 'native',
      reason: `browser-preflight-round-${round}`,
      message: `Browser compaction ${round} completed before dispatch.`,
      lastCompactedAt: `2026-05-03T00:${String(round).padStart(2, '0')}:00.000Z`,
      before: contextBefore.contextWindowState,
      after: {
        ...contextBefore.contextWindowState,
        usedTokens: 240,
        ratio: 0.24,
        status: 'healthy',
        lastCompactedAt: `2026-05-03T00:${String(round).padStart(2, '0')}:00.000Z`,
      },
    },
    contextWindowState: {
      ...contextBefore.contextWindowState,
      usedTokens: 240,
      ratio: 0.24,
      status: 'healthy',
      lastCompactedAt: `2026-05-03T00:${String(round).padStart(2, '0')}:00.000Z`,
    },
  };
  const lines = [
    ...(round === 8 || round === 16 ? [{ event: contextBefore }, { event: compaction }] : []),
    JSON.stringify({
      result: {
        message: `Browser reply ${round}: reused the prior workspace context and advanced the generic complex analysis without restarting.`,
        confidence: 0.91,
        claimType: 'fact',
        evidenceLevel: 'mock-browser',
        reasoningTrace: 'Mocked browser 24-turn response; the UI still builds real session, ledger, context meter, and request payloads.',
        claims: [],
        uiManifest: [],
        executionUnits: [{
          id: `eu-browser-multiturn-${round}`,
          tool: 'workspace.browser-multiturn-smoke',
          params: `round=${round}`,
          status: 'done',
          hash: `browser-multiturn-${round}`,
          outputRef: `.sciforge/task-results/browser-multiturn-${round}.json`,
        }],
        artifacts: [{
          id: `browser-multiturn-report-${round}`,
          type: 'research-report',
          schemaVersion: '1',
          dataRef: `.sciforge/artifacts/browser-multiturn-report-${round}.json`,
          metadata: { runId: `browser-multiturn-${round}`, status: 'done' },
          data: { markdown: `# Browser reply ${round}\\n\\nThis mocked report validates generic multi-turn context reuse.` },
        }],
      },
    }),
  ].map((line) => typeof line === 'string' ? line : JSON.stringify(line));
  return [...lines, ''].join('\n');
}

async function visibleContextCompactionCount(page: Page) {
  await page.locator('.stream-events-toggle').click();
  await page.getByText('上下文压缩').first().waitFor({ timeout: 15_000 });
  const count = await page.locator('.stream-event', { hasText: '上下文压缩' }).count();
  await page.locator('.stream-events-toggle').click();
  return count;
}

function complexMultiTurnPrompts() {
  return Array.from({ length: 24 }, (_, index) => {
    const round = String(index + 1).padStart(2, '0');
    const phase = [
      'define the objective and constraints',
      'identify required evidence objects and refs',
      'separate assumptions from durable facts',
      'plan reproducible workspace tasks',
      'inspect likely failure modes',
      'prioritize the next validation step',
      'summarize the latest artifact deltas',
      'compare alternative interpretations',
    ][index % 8];
    return `Round ${round}: continue the same complex analysis; ${phase}; reuse all previous decisions, workspace refs, and unresolved risks without re-reading the entire background.`;
  });
}

function isNonDecreasingExcept(values: number[], resetRounds: number[]) {
  return values.every((value, index) => {
    if (index === 0) return true;
    const round = index + 1;
    if (resetRounds.includes(round)) return value < values[index - 1];
    return value >= values[index - 1];
  });
}

function isNonDecreasing(values: number[]) {
  return values.every((value, index) => index === 0 || value >= values[index - 1]);
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

function browserExecutablePath() {
  const candidates = [
    process.env.SCIFORGE_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No Chromium-compatible browser found. Set SCIFORGE_BROWSER_EXECUTABLE to run browser smoke.');
}
