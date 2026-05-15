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
	    await page.route('http://127.0.0.1:18080/**', async (route, request) => {
	      const now = new Date().toISOString();
	      if (/compact/i.test(request.url())) {
	        await route.fulfill({
	          status: 200,
	          contentType: 'application/json; charset=utf-8',
	          body: JSON.stringify({
	            contextCompaction: {
	              status: 'completed',
	              source: 'agentserver',
	              backend: 'codex',
	              compactCapability: 'agentserver',
	              reason: 'browser-multiturn-smoke',
	              completedAt: now,
	              auditRefs: ['agentserver://browser-multiturn/compact'],
	            },
	          }),
	        });
	        return;
	      }
	      await route.fulfill({
	        status: 200,
	        contentType: 'application/json; charset=utf-8',
	        body: JSON.stringify({ status: 'ok', checkedAt: now }),
	      });
	    });

	    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await openLiteratureScenario(page);

    const meterUsedTokens: number[] = [];
    const prompts = complexMultiTurnPrompts();
    for (let index = 0; index < prompts.length; index += 1) {
      await sendPrompt(page, prompts[index], index + 1);
      meterUsedTokens.push(await readMeterUsedTokens(page));
    }

    assert.equal(runRequests.length, 24, 'browser should send 24 distinct user turns');
    assert.ok(isNonDecreasingExcept(meterUsedTokens, [8, 16]), `context meter should grow between compactions and drop only after compact boundaries, got ${meterUsedTokens.join(', ')}`);
    assert.ok(meterUsedTokens[7] < meterUsedTokens[6], `round 8 compaction should reduce the visible meter, got ${meterUsedTokens[6]} -> ${meterUsedTokens[7]}`);
    assert.ok(meterUsedTokens[15] < meterUsedTokens[14], `round 16 compaction should reduce the visible meter, got ${meterUsedTokens[14]} -> ${meterUsedTokens[15]}`);
    assert.ok(meterUsedTokens.at(-1)! > meterUsedTokens[0]!, 'final context estimate should include accumulated multi-turn context');

    const lastRequest = runRequests.at(-1)!;
    const uiState = lastRequest.uiState as Record<string, unknown>;
    const sessionMessages = uiState.sessionMessages as Array<Record<string, unknown>>;
    const reusePolicy = uiState.contextReusePolicy as Record<string, unknown>;
    const agentContext = lastRequest.agentContext as Record<string, unknown>;
    const serializedRequestBytes = runRequests.map((request) => Buffer.byteLength(JSON.stringify(request), 'utf8'));

    assert.equal(uiState.conversationLedger, undefined, 'browser transport should not send a UI conversation ledger as memory');
    assert.equal(uiState.recentConversation, undefined, 'browser transport should use bounded sessionMessages instead of a second recent conversation memory');
    assert.equal(sessionMessages.length, 12, 'turn 24 request should carry a bounded recent session message projection');
    assert.match(String(uiState.currentPrompt ?? ''), /Round 24/, 'current prompt should carry the active turn outside the bounded session projection');
    assert.ok(sessionMessages.every((message) => /^\[session-message omitted;/.test(String(message.content ?? ''))), `session messages should carry digest labels instead of plaintext history, got ${JSON.stringify(sessionMessages)}`);
    assert.ok(sessionMessages.every((message) => typeof message.contentDigest === 'object' && message.contentDigest), `session message digests should be present, got ${JSON.stringify(sessionMessages)}`);
    assert.doesNotMatch(JSON.stringify(sessionMessages), /Round 1:|Round 8:|Round 16:/, 'bounded session projection should not replay older turn plaintext');
    assert.ok(['continue', 'repair', 'isolate', undefined].includes(reusePolicy?.mode as string | undefined), 'context reuse policy should stay in AgentServer mode-signal vocabulary');
    assert.equal(agentContext?.conversationLedger, undefined, 'browser transport must not present UI ledger as AgentServer memory');
    assert.equal(agentContext?.contextReusePolicy, undefined, 'browser transport leaves context reuse decisions to Python policy and AgentServer');
    assert.ok(Math.max(...serializedRequestBytes) < 180_000, `handoff request body should stay bounded, got ${Math.max(...serializedRequestBytes)} bytes`);
    assert.ok(Math.min(...serializedRequestBytes) > 1000, 'handoff request body should continue carrying structured multi-turn context');

    await sendPrompt(page, 'Round 25: filter the evidence matrix by confidence_score and keep any partial output if the filter fails.', 25);
    await sendPrompt(page, 'Round 26: continue from the failed filter; reuse the partial matrix and stderr, do not rerun downloaded paper retrieval.', 26);
    const repairRequest = runRequests.at(-1)!;
    const repairUiState = repairRequest.uiState as Record<string, unknown>;
    const repairExecutionRefs = repairUiState.recentExecutionRefs as Array<Record<string, unknown>>;
    const repairRequestText = JSON.stringify(repairRequest);
    assert.ok(repairExecutionRefs.some((unit) => unit.failureReason === 'Missing required column: confidence_score'), `repair continuation should source the failure reason from structured execution refs, got ${JSON.stringify(repairExecutionRefs)}`);
    assert.ok(repairExecutionRefs.some((unit) => unit.stderrRef === 'file:.sciforge/task-results/browser-repair.stderr.txt'), `repair continuation should source stderr from structured execution refs, got ${JSON.stringify(repairExecutionRefs)}`);
    assert.match(repairRequestText, /Missing required column: confidence_score/, 'repair continuation should carry the concrete failed execution reason');
    assert.match(repairRequestText, /browser-repair\.stderr\.txt/, 'repair continuation should carry stderr refs instead of raw logs');
    assert.match(repairRequestText, /reuse the partial matrix and stderr/, 'repair continuation should carry the current user recovery constraint');
    assert.doesNotMatch(repairRequestText, /large browser repair raw log/, 'repair continuation should not inline raw process logs');

    await sendPrompt(page, 'Round 27: export an audit summary from the repaired report with task graph, data lineage, and artifact refs only.', 27);
    const auditRequestText = JSON.stringify(runRequests.at(-1));
    assert.match(auditRequestText, /browser-repair-report\.md/, 'audit follow-up should preserve repaired report artifact lineage');
    assert.match(auditRequestText, /artifact refs only/, 'audit follow-up should carry the latest user export constraint');
    assert.doesNotMatch(auditRequestText, /This repaired report has large inline markdown/, 'audit follow-up should not inline repaired report bodies');

    assert.equal(runRequests.length, 27, 'browser should send 24 long-context turns plus repair, continuation, and audit follow-up turns');
    await page.screenshot({ path: join(artifactsDir, 'browser-smoke-multiturn-context.png'), fullPage: true });
    assert.deepEqual((page as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], '24-turn browser workflow should not emit page errors');
    console.log(`[ok] browser 27-turn context smoke verified bounded UI projection, repair continuation, audit follow-up, and request size ceiling; screenshot in ${artifactsDir}`);
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
  const composer = page.locator('.chat-panel .composer textarea');
  if (await composer.isVisible({ timeout: 1_000 }).catch(() => false)) {
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
  await openWorkbenchChrome(page);
  await expandComposer(page);
  await composer.waitFor({ timeout: 15_000 });
}

async function sendPrompt(page: Page, prompt: string, round: number) {
  await expandComposer(page);
  const composer = page.locator('.chat-panel .composer textarea');
  await composer.fill(prompt);
  await page.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
  await page.getByText(`Browser reply ${round}`).first().waitFor({ timeout: 15_000 });
}

async function expandComposer(page: Page) {
  const textarea = page.locator('.chat-panel .composer textarea');
  if (await textarea.isVisible({ timeout: 1_000 }).catch(() => false)) return;
  const collapsed = page.locator('.chat-panel .composer-collapsed').first();
  if (await collapsed.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await collapsed.click();
  }
}

async function openWorkbenchChrome(page: Page) {
  const textarea = page.locator('.chat-panel .composer textarea');
  const collapsed = page.locator('.chat-panel .composer-collapsed').first();
  if (await textarea.isVisible({ timeout: 1_000 }).catch(() => false) || await collapsed.isVisible({ timeout: 1_000 }).catch(() => false)) {
    return;
  }
  const workbenchButton = page.getByRole('button', { name: '场景工作台' });
  if (await workbenchButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await workbenchButton.click();
  }
  const toggle = page.locator('.workbench-chrome-toggle-main');
  if (await toggle.isVisible({ timeout: 5_000 }).catch(() => false) && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

async function readMeterUsedTokens(page: Page) {
  await expandComposer(page);
  const title = await page.locator('.context-window-meter').getAttribute('title', { timeout: 15_000 });
  const match = String(title ?? '').match(/used\/window:\s*([0-9,]+)\//);
  assert.ok(match, `context meter title should expose used/window, got ${title}`);
  return Number(match[1].replace(/,/g, ''));
}

function browserMultiturnToolStreamBody(round: number) {
  if (round === 25) return browserRepairFailureStreamBody();
  if (round === 26) return browserRepairSuccessStreamBody();
  if (round === 27) return browserAuditExportStreamBody();
  const usedTokens = 260 + round * 20;
  const contextState = {
    type: 'contextWindowState',
    contextWindowState: {
      source: 'native',
      backend: 'codex',
      usedTokens,
      windowTokens: 1000,
      ratio: usedTokens / 1000,
      status: usedTokens >= 820 ? 'near-limit' : usedTokens >= 700 ? 'watch' : 'healthy',
      compactCapability: 'native',
      autoCompactThreshold: 0.82,
    },
  };
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
    ...(round === 8 || round === 16 ? [{ event: contextBefore }, { event: compaction }] : [{ event: contextState }]),
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

function browserRepairFailureStreamBody() {
  return [
    JSON.stringify({
      event: {
        type: 'process-progress',
        label: '执行筛选',
        detail: 'Filtering evidence matrix failed: Missing required column: confidence_score. large browser repair raw log '.repeat(20),
      },
    }),
    JSON.stringify({
      result: {
        run: { id: 'run-browser-repair-boundary', status: 'failed' },
        message: 'Browser reply 25: failed to filter the evidence matrix, but preserved partial output and stderr refs.',
        confidence: 0.72,
        claimType: 'fact',
        evidenceLevel: 'mock-browser',
        reasoningTrace: 'Failure is intentionally generic: a missing column in a prior artifact should produce repair context, not a prompt-specific branch.',
        executionUnits: [{
          id: 'eu-browser-repair-filter',
          tool: 'python',
          params: 'python tasks/filter_matrix.py --input evidence-matrix.csv',
          status: 'failed-with-reason',
          hash: 'browser-repair-filter',
          codeRef: '.sciforge/tasks/filter_matrix.py',
          stdoutRef: 'file:.sciforge/task-results/browser-repair.stdout.txt',
          stderrRef: 'file:.sciforge/task-results/browser-repair.stderr.txt',
          outputRef: 'file:.sciforge/task-results/browser-repair.partial.json',
          failureReason: 'Missing required column: confidence_score',
          recoverActions: ['Map confidence_score to an existing confidence column or continue with partial output.'],
          nextStep: 'Ask the user whether to map a replacement column or continue from the partial matrix.',
        }],
        artifacts: [{
          id: 'artifact-browser-repair-partial',
          type: 'evidence-matrix',
          schemaVersion: '1',
          dataRef: '.sciforge/artifacts/browser-repair.partial.json',
          metadata: { runId: 'run-browser-repair-boundary', status: 'partial', rows: 12 },
          data: { rows: [{ id: 'partial-1', confidence: 0.82, note: 'partial row preserved' }] },
        }],
      },
    }),
    '',
  ].join('\n');
}

function browserRepairSuccessStreamBody() {
  return [
    JSON.stringify({
      event: {
        type: 'process-progress',
        label: '继续修复',
        detail: 'Reusing partial refs and stderr diagnostics without rerunning retrieval.',
      },
    }),
    JSON.stringify({
      result: {
        run: { id: 'run-browser-repair-success', status: 'completed' },
        message: 'Browser reply 26: continued from the failed filter and produced a repaired report.',
        confidence: 0.88,
        claimType: 'fact',
        evidenceLevel: 'mock-browser',
        reasoningTrace: 'Continuation reused partial artifact refs and prior stderr diagnostics.',
        executionUnits: [{
          id: 'eu-browser-repair-continue',
          tool: 'python',
          params: 'python tasks/filter_matrix.py --input browser-repair.partial.json --map confidence_score=confidence',
          status: 'done',
          hash: 'browser-repair-success',
          codeRef: '.sciforge/tasks/filter_matrix.py',
          stdoutRef: 'file:.sciforge/task-results/browser-repair-success.stdout.txt',
          outputRef: 'file:.sciforge/task-results/browser-repair-success.json',
        }],
        artifacts: [{
          id: 'artifact-browser-repair-report',
          type: 'research-report',
          schemaVersion: '1',
          dataRef: '.sciforge/artifacts/browser-repair-report.md',
          metadata: { runId: 'run-browser-repair-success', status: 'done', sourceArtifactRef: 'artifact-browser-repair-partial' },
          data: { markdown: `# Browser repair report\n\n${'This repaired report has large inline markdown. '.repeat(80)}` },
        }],
      },
    }),
    '',
  ].join('\n');
}

function browserAuditExportStreamBody() {
  return [
    JSON.stringify({
      result: {
        run: { id: 'run-browser-audit-export', status: 'completed' },
        message: 'Browser reply 27: exported an audit summary with task graph, data lineage, and artifact refs only.',
        confidence: 0.9,
        claimType: 'fact',
        evidenceLevel: 'mock-browser',
        artifacts: [{
          id: 'artifact-browser-audit-summary',
          type: 'audit-report',
          schemaVersion: '1',
          dataRef: '.sciforge/artifacts/browser-audit-summary.json',
          metadata: {
            runId: 'run-browser-audit-export',
            sourceArtifactRefs: ['artifact-browser-repair-report', 'artifact-browser-repair-partial'],
          },
          data: { refs: ['file:.sciforge/artifacts/browser-repair-report.md', 'file:.sciforge/task-results/browser-repair.stderr.txt'] },
        }],
      },
    }),
    '',
  ].join('\n');
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
