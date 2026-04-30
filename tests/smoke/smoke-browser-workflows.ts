import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Browser, type Page } from 'playwright-core';
import { buildBuiltInScenarioPackage } from '../../src/ui/src/scenarioCompiler/scenarioPackage';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-browser-smoke-'));
const artifactsDir = resolve('docs', 'test-artifacts');
const importPackagePath = join(workspace, 'browser-smoke-imported.scenario-package.json');
const workspacePort = 21080 + Math.floor(Math.random() * 1000);
const uiPort = 22080 + Math.floor(Math.random() * 1000);
const children: ChildProcess[] = [];
const configLocalPath = 'config.local.json';
const originalConfigLocal = await readFile(configLocalPath, 'utf8').catch(() => undefined);

try {
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(join(workspace, '.bioagent'), { recursive: true });
  await writeFile(importPackagePath, JSON.stringify(browserSmokeScenarioPackage(), null, 2));
  await writeFile(join(workspace, '.bioagent', 'workspace-state.json'), JSON.stringify(browserSmokeWorkspaceState(workspace), null, 2));
  children.push(start('workspace', ['npm', 'run', 'workspace:server'], { BIOAGENT_WORKSPACE_PORT: String(workspacePort) }));
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], { BIOAGENT_UI_PORT: String(uiPort) }));
  await waitForHttp(`http://127.0.0.1:${workspacePort}/health`);
  await waitForHttp(`http://127.0.0.1:${uiPort}/`);

  const executablePath = browserExecutablePath();
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const page = await newConfiguredPage(browser, { width: 1440, height: 1050 });
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    logStep('first visit shows Scenario Builder, Runtime Health, and import CTAs');
    await page.getByText('AI Scenario Builder').waitFor({ timeout: 15_000 });
    await page.getByText('Runtime Health').first().waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '导入文献场景', exact: true }).waitFor();
    await assertNoRawJsonErrors(page, 'first-visit');
    await assertNoUnexplainedDisabledPrimaryButtons(page, 'first-visit');
    await assertTooltipCoverage(page, 'first-visit');
    logStep('keyboard navigation reaches controls and Esc closes Settings');
    await page.keyboard.press('Tab');
    await assertActiveElementInteractive(page, 'first tab stop');
    await page.getByLabel('设置').focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'BioAgent 设置' }).waitFor({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'BioAgent 设置' }).waitFor({ state: 'hidden', timeout: 15_000 });
    await assertNoRechartsSizeWarnings(page, 'first-visit');
    logStep('settings modal opens and exposes connection diagnostics');
    await page.getByLabel('设置').click();
    await page.getByRole('dialog', { name: 'BioAgent 设置' }).waitFor({ timeout: 15_000 });
    await page.getByText('Workspace Writer').first().waitFor();
    await page.getByText('AgentServer').first().waitFor();
    await page.getByLabel('关闭设置').click();
    logStep('workspace sidebar opens, explains current path, and lists .bioagent resources');
    await page.getByLabel('工作目录').click();
    await page.locator('.workspace-path-editor').waitFor({ timeout: 15_000 });
    await page.getByLabel('刷新').click();
    await page.getByText(/workspace-state\.json|scenarios|\.bioagent|未找到|Workspace Writer/).first().waitFor({ timeout: 15_000 });
    await page.getByLabel('.bioagent 专用分组').getByText('task-results').waitFor({ timeout: 15_000 });
    await page.getByRole('status').filter({ hasText: /已加载|当前目录为空/ }).first().waitFor({ timeout: 15_000 });
    logStep('workbench composer is available and timeline stays searchable');
    await page.getByLabel('导航').click();
    await page.getByRole('button', { name: '场景工作台' }).click();
    await page.locator('.chat-panel .composer textarea').waitFor({ timeout: 15_000 });
    await page.locator('.chat-panel .composer textarea').fill('browser-smoke-live-run 搜索最新 arXiv 并生成系统性报告，验证 AgentServer offline recovery card');
    await page.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).waitFor({ state: 'visible', timeout: 15_000 });
    const smokeRunAction = 'run.failed';
    logStep('timeline is reachable from navigation');
    await page.getByLabel('导航').click();
    await page.getByRole('button', { name: '研究时间线' }).click();
    await page.getByRole('heading', { name: '研究时间线' }).waitFor({ timeout: 15_000 });
    await page.getByLabel('搜索 Timeline').fill('browser-smoke-run');
    await page.getByRole('heading', { name: smokeRunAction }).waitFor({ timeout: 15_000 });
    await page.getByLabel('按事件类型过滤').selectOption(smokeRunAction);
    await page.getByText('browser-smoke-run').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '导出当前分支' }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '回到场景' }).first().click();
    await page.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await page.getByLabel('导航').click();
    await page.getByRole('button', { name: '研究概览' }).click();
    await page.getByRole('heading', { name: 'Scenario Library' }).waitFor({ timeout: 15_000 });
    await page.getByText('last run no runs yet').first().waitFor({ timeout: 15_000 });
    const catalogSection = page.locator('main', { has: page.getByRole('heading', { name: 'Scenario Library' }) });
    await catalogSection.locator('.scenario-card', { hasText: 'biomedical-knowledge-graph' }).waitFor({ timeout: 15_000 });
    const importChooser = page.waitForEvent('filechooser');
    logStep('local package import jumps directly into its workbench');
    await page.getByRole('button', { name: '导入 package', exact: true }).click();
    await (await importChooser).setFiles(importPackagePath);
    await page.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await page.getByText(/browser-smoke-imported-package 新聊天/).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '研究概览' }).click();
    await page.getByRole('heading', { name: 'Scenario Library' }).waitFor();
    await page.getByText(/versions/).first().waitFor({ timeout: 15_000 });
    const importedCard = page.locator('.scenario-card', { hasText: 'browser-smoke-imported-package' }).first();
    await importedCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await importedCard.getByRole('button', { name: '导出', exact: true }).click({ force: true });
    await page.getByRole('dialog', { name: 'Package export preview' }).waitFor({ timeout: 15_000 });
    await page.getByText(/portable manifest|contains workspace refs/).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '确认导出' }).click();
    await page.getByText(/已导出 Browser Smoke Imported Package package JSON/).waitFor({ timeout: 15_000 });
    await page.locator('.scenario-builder textarea').fill('构建一个单细胞差异表达场景，输入表达矩阵和metadata，输出火山图、热图、UMAP和execution diagnostics。');
    await page.getByRole('button', { name: '生成场景设置' }).click();
    await page.locator('code', { hasText: 'volcano-plot' }).first().waitFor();
    await page.getByRole('button', { name: /进入.*工作台/ }).click();
    await page.getByText('Scenario Builder').waitFor();
    await page.locator('.scenario-settings-summary').click();
    await page.getByLabel('Scenario Builder steps').getByRole('button', { name: /需求描述/ }).waitFor();
    await page.getByRole('button', { name: /推荐元素/ }).click();
    await page.locator('.component-selector button').first().hover();
    await page.locator('.element-popover').first().waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByText(/producer|accepts|fallback|skill domain/).first().waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: /编辑契约/ }).click();
    await captureSmokeScreenshot(page, join(artifactsDir, 'browser-smoke-builder-collapsed.png'));
    await page.getByRole('button', { name: 'ExecutionUnit' }).focus();
    await page.keyboard.press('Space');
    await page.getByRole('heading', { name: '可复现执行单元' }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '结果视图' }).focus();
    await page.keyboard.press('Enter');
    await page.getByText('展开高级 JSON contract').click();
    await page.getByRole('button', { name: 'skill', exact: true }).click();
    await page.getByText('skillIRs').waitFor();
    await page.getByRole('button', { name: 'validation', exact: true }).click();
    await page.locator('pre.inspector-json', { hasText: 'issues' }).waitFor();
    await page.getByRole('button', { name: '保存 draft' }).click();
    await page.getByText('已保存 draft 到 workspace。').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '发布', exact: true }).click();
    await page.getByText(/已发布到 workspace scenario library|quality gate/).waitFor({ timeout: 15_000 });
    await page.locator('.results-collapse-button').evaluate((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    await page.waitForFunction(() => Boolean(document.querySelector('.workbench-grid.results-collapsed')), null, { timeout: 15_000 });
    await captureSmokeScreenshot(page, join(artifactsDir, 'browser-smoke-results-collapsed.png'));
    await page.locator('.results-collapse-button').evaluate((element) => {
      if (element instanceof HTMLElement) element.click();
    });
    await assertNoCriticalOverflow(page, 'desktop-builder');
    await assertNoRawJsonErrors(page, 'desktop-builder');
    await assertNoUnexplainedDisabledPrimaryButtons(page, 'desktop-builder');
    await assertTooltipCoverage(page, 'desktop-builder');
    await assertNoRechartsSizeWarnings(page, 'desktop-builder');
    await captureSmokeScreenshot(page, join(artifactsDir, 'browser-smoke-desktop.png'));

    await page.getByRole('button', { name: '研究概览' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Scenario Library' }).waitFor();
    await page.getByLabel('搜索 Scenario Library').fill('omics');
    await page.getByLabel('按 skill domain 过滤').selectOption('omics');
    await page.locator('.scenario-card', { hasText: 'omics-differential-exploration-workspace-draft' }).first().waitFor({ timeout: 15_000 });
    await page.getByLabel('排序 Scenario Library').selectOption('title');
    await page.locator('.scenario-card', { hasText: 'omics-differential-exploration-workspace-draft' }).first().waitFor({ timeout: 15_000 });
    await page.locator('.scenario-card', { hasText: 'omics-differential-exploration-workspace-draft' }).getByRole('button', { name: '打开' }).click();
    await page.getByText('Scenario Builder').waitFor();
    await page.locator('code', { hasText: /workspace.*@1\.0\.0/ }).first().waitFor({ timeout: 15_000 });
    await page.getByText(/将使用|输入研究问题后即可运行/).waitFor({ timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByLabel('移动端工作区视图').waitFor({ timeout: 15_000 });
    await page.getByLabel('移动端工作区视图').getByRole('button', { name: 'Builder' }).click();
    await page.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await page.getByLabel('移动端工作区视图').getByRole('button', { name: 'Results' }).click();
    await page.getByRole('heading', { name: '结果视图' }).waitFor({ timeout: 15_000 });
    await page.getByLabel('移动端工作区视图').getByRole('button', { name: 'Chat' }).click();
    await page.getByPlaceholder('输入研究问题...').waitFor({ timeout: 15_000 });
    await assertNoCriticalOverflow(page, 'mobile-workbench');
    await assertNoRawJsonErrors(page, 'mobile-workbench');
    await assertNoUnexplainedDisabledPrimaryButtons(page, 'mobile-workbench');
    await assertNoRechartsSizeWarnings(page, 'mobile-workbench');
    await captureSmokeScreenshot(page, join(artifactsDir, 'browser-smoke-mobile.png'));
    assert.deepEqual((page as Page & { __bioagentPageErrors?: string[] }).__bioagentPageErrors ?? [], [], 'builder workflow should not emit page errors');
    await page.close();

    const offlineHealthPage = await newConfiguredPage(browser, { width: 1280, height: 900 }, false, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:65535',
      agentServerBaseUrl: 'http://127.0.0.1:65535',
    });
    await offlineHealthPage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    logStep('offline runtime health shows concrete recovery actions');
    await offlineHealthPage.getByText('Runtime Health').first().waitFor({ timeout: 15_000 });
    await offlineHealthPage.getByText('启动 npm run workspace:server 后刷新').waitFor({ timeout: 15_000 });
    await offlineHealthPage.getByText(/启动或修复 AgentServer|AgentServer\/agent backend/).waitFor({ timeout: 15_000 });
    await assertNoRawJsonErrors(offlineHealthPage, 'offline-health');
    await assertNoUnexplainedDisabledPrimaryButtons(offlineHealthPage, 'offline-health');
    await offlineHealthPage.close();

    const structurePage = await newConfiguredPage(browser, { width: 1280, height: 900 }, true);
    await structurePage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await structurePage.getByRole('heading', { name: 'Scenario Library' }).waitFor();
    const catalog = structurePage.locator('main', { has: structurePage.getByRole('heading', { name: 'Scenario Library' }) });
    const structurePackageCard = catalog.locator('.scenario-card', { hasText: 'structure-exploration' }).first();
    await structurePackageCard.scrollIntoViewIfNeeded();
    const importButton = structurePackageCard.getByRole('button', { name: '导入并打开', exact: true });
    if (await importButton.count()) {
      await importButton.click();
    } else {
      await structurePackageCard.getByRole('button', { name: '打开', exact: true }).click();
    }
    await structurePage.getByRole('heading', { name: '结果视图' }).waitFor({ timeout: 15_000 });
    await structurePage.locator('.molecule-viewer-shell').waitFor({ timeout: 15_000 });
    await structurePage.getByRole('button', { name: '只看图' }).click({ force: true });
    await structurePage.locator('.molecule-viewer-shell').waitFor({ timeout: 15_000 });
    await structurePage.getByRole('button', { name: '查看数据' }).first().evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
    });
    await structurePage.getByRole('dialog', { name: 'Artifact Inspector' }).waitFor({ timeout: 15_000 });
    await structurePage.getByText('Lineage').waitFor({ timeout: 15_000 });
    await structurePage.getByRole('button', { name: '关闭 Artifact Inspector' }).last().click({ force: true });
    await structurePage.locator('.registry-slot .handoff-actions button').first().evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
    });
    await structurePage.getByLabel('Handoff 确认预览').waitFor({ timeout: 15_000 });
    await structurePage.getByText('new run').waitFor({ timeout: 15_000 });
    await structurePage.getByRole('button', { name: '取消' }).click({ force: true });
    await captureSmokeScreenshot(structurePage, join(artifactsDir, 'browser-smoke-structure.png'));
    const viewerBox = await structurePage.locator('.molecule-viewer-shell').boundingBox();
    assert.ok(viewerBox && viewerBox.width > 260 && viewerBox.height > 220, 'structure viewer should be visible and stable');
    await assertNoRawJsonErrors(structurePage, 'structure-workflow');
    await assertNoUnexplainedDisabledPrimaryButtons(structurePage, 'structure-workflow');
    await assertNoRechartsSizeWarnings(structurePage, 'structure-workflow');
    assert.deepEqual((structurePage as Page & { __bioagentPageErrors?: string[] }).__bioagentPageErrors ?? [], [], 'structure workflow should not emit page errors');
    await structurePage.close();
  } finally {
    await browser.close();
  }

  console.log(`[ok] browser smoke covered onboarding, Settings, Workspace, Timeline, Builder publish/open flow, collapsed results, mobile layout, and structure viewer screenshots in ${artifactsDir}`);
} finally {
  for (const child of children.reverse()) child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
  if (originalConfigLocal === undefined) await rm(configLocalPath, { force: true });
  else await writeFile(configLocalPath, originalConfigLocal);
}

async function newConfiguredPage(
  browser: Browser,
  viewport: { width: number; height: number },
  withStructureState = false,
  configPatch: Partial<{ workspaceWriterBaseUrl: string; agentServerBaseUrl: string }> = {},
) {
  const page = await browser.newPage({ viewport });
  const configuredWorkspacePath = withStructureState ? join(workspace, 'structure-smoke') : workspace;
  const consoleWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[browser:${message.type()}] ${message.text()}`);
    if (message.type() === 'warning') consoleWarnings.push(message.text());
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  const config = {
    schemaVersion: 1,
    agentServerBaseUrl: configPatch.agentServerBaseUrl ?? 'http://127.0.0.1:18080',
    workspaceWriterBaseUrl: configPatch.workspaceWriterBaseUrl ?? `http://127.0.0.1:${workspacePort}`,
    workspacePath: configuredWorkspacePath,
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    requestTimeoutMs: 5_000,
    updatedAt: new Date().toISOString(),
  };
  await fetch(`http://127.0.0.1:${workspacePort}/api/bioagent/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  await page.addInitScript(({ config, structureState, defaultWorkspaceState }) => {
    window.localStorage.setItem('bioagent.config.v1', JSON.stringify(config));
    window.localStorage.setItem('bioagent.workspace.v2', JSON.stringify(structureState ?? defaultWorkspaceState));
  }, {
    config,
    structureState: withStructureState ? structureWorkspaceState(configuredWorkspacePath) : undefined,
    defaultWorkspaceState: browserSmokeWorkspaceState(configuredWorkspacePath),
  });
  (page as Page & { __bioagentPageErrors?: string[]; __bioagentConsoleWarnings?: string[] }).__bioagentPageErrors = pageErrors;
  (page as Page & { __bioagentPageErrors?: string[]; __bioagentConsoleWarnings?: string[] }).__bioagentConsoleWarnings = consoleWarnings;
  return page;
}

async function captureSmokeScreenshot(page: Page, path: string) {
  try {
    await page.screenshot({ path, fullPage: true, timeout: 10_000 });
  } catch (error) {
    console.warn(`[ux] skipped screenshot ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function browserSmokeTimelineEvent() {
  const now = new Date().toISOString();
  return {
    id: 'timeline-browser-smoke-run',
    actor: 'Browser Smoke',
    action: 'run.failed',
    subject: 'browser-smoke-run · AgentServer offline recovery card',
    artifactRefs: [],
    executionUnitRefs: ['skill-plan.browser-smoke'],
    beliefRefs: [],
    branchId: 'literature-evidence-review',
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: now,
  };
}

function structureWorkspaceState(workspacePath: string) {
  const now = new Date().toISOString();
  const structureSession = {
    schemaVersion: 2,
    sessionId: 'session-structure-browser-smoke',
    scenarioId: 'structure-exploration',
    title: 'Structure browser smoke',
    createdAt: now,
    messages: [],
    runs: [],
    uiManifest: [{ componentId: 'molecule-viewer', title: 'Structure viewer', artifactRef: 'artifact-structure-browser-smoke', priority: 1 }],
    claims: [],
    executionUnits: [],
    artifacts: [{
      id: 'artifact-structure-browser-smoke',
      type: 'structure-summary',
      producerScenario: 'structure-exploration',
      schemaVersion: '1',
      metadata: { pdbId: 'browser-smoke', ligand: 'ATP', pocketLabel: 'Browser smoke pocket' },
      dataRef: `data:text/plain,${encodeURIComponent(browserSmokePdb())}`,
      data: {
        pdbId: 'browser-smoke',
        ligand: 'ATP',
        pocketLabel: 'Browser smoke pocket',
        atoms: [
          { atomName: 'N', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'N', x: -1.2, y: 0.1, z: 0.2 },
          { atomName: 'CA', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'C', x: 0.0, y: 0.3, z: 0.0 },
          { atomName: 'C', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'C', x: 1.2, y: 0.0, z: -0.2 },
          { atomName: 'O', residueName: 'GLY', chain: 'A', residueNumber: '1', element: 'O', x: 1.8, y: -0.8, z: 0.1 },
          { atomName: 'P', residueName: 'ATP', chain: 'B', residueNumber: '2', element: 'P', x: 0.2, y: 1.4, z: 0.6, hetatm: true },
        ],
      },
      visibility: 'public',
    }],
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {
      'structure-exploration': structureSession,
    },
    archivedSessions: [],
    alignmentContracts: [],
    updatedAt: now,
  };
}

function browserSmokeWorkspaceState(workspacePath: string) {
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {},
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: [browserSmokeTimelineEvent()],
    updatedAt: new Date().toISOString(),
  };
}

function browserSmokePdb() {
  return [
    'ATOM      1 N    GLY A   1      -1.200   0.100   0.200  1.00 20.00           N',
    'ATOM      2 CA   GLY A   1       0.000   0.300   0.000  1.00 20.00           C',
    'ATOM      3 C    GLY A   1       1.200   0.000  -0.200  1.00 20.00           C',
    'ATOM      4 O    GLY A   1       1.800  -0.800   0.100  1.00 20.00           O',
    'HETATM    5 P    ATP B   2       0.200   1.400   0.600  1.00 20.00           P',
    'END',
  ].join('\n');
}

function browserSmokeScenarioPackage() {
  const pkg = buildBuiltInScenarioPackage('biomedical-knowledge-graph', '2026-04-25T00:00:00.000Z');
  return {
    ...pkg,
    id: 'browser-smoke-imported-package',
    version: '1.0.0',
    status: 'draft',
    scenario: {
      ...pkg.scenario,
      id: 'browser-smoke-imported-package',
      title: 'Browser Smoke Imported Package',
      source: 'workspace',
    },
    versions: [{
      version: '1.0.0',
      status: 'draft',
      createdAt: '2026-04-25T00:00:00.000Z',
      summary: 'Browser smoke imported package fixture.',
      scenarioHash: 'browser-smoke',
    }],
  };
}

async function assertNoCriticalOverflow(page: Page, label: string) {
  const offenders = await page.evaluate(() => Array.from(document.querySelectorAll('button, .scenario-card, .scenario-settings-summary, .scenario-publish-row, .manifest-diagnostics'))
    .map((element) => {
      const box = element.getBoundingClientRect();
      const html = element instanceof HTMLElement ? element.innerText.trim().replace(/\s+/g, ' ').slice(0, 80) : element.tagName;
      return {
        html,
        width: box.width,
        height: box.height,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        hasTooltip: element.hasAttribute('data-tooltip'),
      };
    })
    .filter((item) => !(item.hasTooltip && !item.html))
    .filter((item) => item.width > 0 && item.height > 0 && (item.scrollWidth > item.width + 8 || item.scrollHeight > item.height + 12)));
  assert.deepEqual(offenders, [], `${label} should not have critical text overflow`);
}

async function assertNoRawJsonErrors(page: Page, label: string) {
  const offenders = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
    .map((element) => element instanceof HTMLElement ? element.innerText.trim() : '')
    .filter(Boolean)
    .filter((text) => /\{"ok":false|"error":"not found"|^\s*\{[\s\S]{0,240}"error"/.test(text))
    .slice(0, 8));
  assert.deepEqual(offenders, [], `${label} should not expose raw JSON errors`);
}

async function assertNoUnexplainedDisabledPrimaryButtons(page: Page, label: string) {
  const offenders = await page.evaluate(() => Array.from(document.querySelectorAll('button.action-primary:disabled, button.action-button:disabled'))
    .map((element) => {
      const button = element as HTMLButtonElement;
      const text = button.innerText.trim();
      const aria = button.getAttribute('aria-label')?.trim() ?? '';
      const title = button.getAttribute('title')?.trim() ?? '';
      const nearbyReadiness = button.closest('.chat-panel')?.querySelector('.run-readiness')?.textContent?.trim() ?? '';
      return { text, aria, title, nearbyReadiness };
    })
    .filter((item) => !item.text && !item.aria && !item.title && !item.nearbyReadiness)
    .slice(0, 8));
  assert.deepEqual(offenders, [], `${label} should not have unexplained disabled primary buttons`);
}

async function assertTooltipCoverage(page: Page, label: string) {
  const offenders = await page.evaluate(() => Array.from(document.querySelectorAll('.icon-button, .tab'))
    .map((element) => {
      const html = element instanceof HTMLElement ? element.innerText.trim().replace(/\s+/g, ' ') : element.tagName;
      const aria = element.getAttribute('aria-label')?.trim() ?? '';
      const title = element.getAttribute('title')?.trim() ?? '';
      const tooltip = element.getAttribute('data-tooltip')?.trim() ?? '';
      return { html, aria, title, tooltip };
    })
    .filter((item) => !item.aria && !item.title && !item.tooltip)
    .slice(0, 8));
  assert.deepEqual(offenders, [], `${label} should provide tooltip/aria text for icon and tab buttons`);
}

async function assertActiveElementInteractive(page: Page, label: string) {
  const active = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element) return { tag: '', role: '', aria: '', text: '' };
    return {
      tag: element.tagName,
      role: element.getAttribute('role') ?? '',
      aria: element.getAttribute('aria-label') ?? '',
      text: element instanceof HTMLElement ? element.innerText.trim().slice(0, 80) : '',
    };
  });
  assert.ok(
    ['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'A'].includes(active.tag) || active.role === 'button',
    `${label} should land on an interactive element, got ${JSON.stringify(active)}`,
  );
}

async function assertNoRechartsSizeWarnings(page: Page, label: string) {
  await page.waitForTimeout(150);
  const warnings = (page as Page & { __bioagentConsoleWarnings?: string[] }).__bioagentConsoleWarnings ?? [];
  const offenders = warnings.filter((warning) => /width\(-1\)|height\(-1\)|width.*height.*greater than 0/i.test(warning));
  assert.deepEqual(offenders, [], `${label} should not emit Recharts negative-size warnings`);
}

function logStep(message: string) {
  console.log(`[ux] ${message}`);
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
    process.env.BIOAGENT_BROWSER_EXECUTABLE,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ].filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('No Chromium-compatible browser found. Set BIOAGENT_BROWSER_EXECUTABLE to run browser smoke.');
}
