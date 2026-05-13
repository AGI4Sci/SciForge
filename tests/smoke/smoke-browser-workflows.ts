import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { buildBuiltInScenarioPackage } from '@sciforge/scenario-core/scenario-package';
import {
  browserSmokeContextWindowState,
  browserExecutablePath,
  browserSmokeReferenceToolResult,
  browserSmokeScenarioPackage,
  browserSmokeWorkspaceState,
  contextWindowToolStreamBody,
  cursorLikeWorklogResult,
  failedRunRestoreWorkspaceState,
  referenceWorkspaceState,
  structureWorkspaceState,
} from './browser-workflows-fixtures';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-browser-smoke-'));
const artifactsDir = resolve('docs', 'test-artifacts');
const importPackagePath = join(workspace, 'browser-smoke-imported.scenario-package.json');
const referencePreviewPath = join(workspace, '.sciforge', 'artifacts', 'reference-followup-report.md');
const workspacePort = 21080 + Math.floor(Math.random() * 1000);
const uiPort = 22080 + Math.floor(Math.random() * 1000);
const children: ChildProcess[] = [];
const configLocalPath = 'config.local.json';
const originalConfigLocal = await readFile(configLocalPath, 'utf8').catch(() => undefined);

try {
  await mkdir(artifactsDir, { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'artifacts'), { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'task-results'), { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'scenarios'), { recursive: true });
  await mkdir(join(workspace, '.sciforge', 'task-results'), { recursive: true });
  await writeFile(importPackagePath, JSON.stringify(browserSmokeScenarioPackage(), null, 2));
  await writeFile(referencePreviewPath, [
    '# Browser smoke reference follow-up',
    '',
    'This real workspace markdown file verifies inline preview after clicking the final object chip.',
    '',
    '| object | status |',
    '| --- | --- |',
    '| message/chart/table/file references | preserved |',
  ].join('\n'));
  await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify(browserSmokeWorkspaceState(workspace), null, 2));
  children.push(start('workspace', ['npm', 'run', 'workspace:server'], { SCIFORGE_WORKSPACE_PORT: String(workspacePort) }));
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], { SCIFORGE_UI_PORT: String(uiPort) }));
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
    await page.getByRole('dialog', { name: 'SciForge 设置' }).waitFor({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'SciForge 设置' }).waitFor({ state: 'hidden', timeout: 15_000 });
    await assertNoRechartsSizeWarnings(page, 'first-visit');
    logStep('settings modal opens and exposes connection diagnostics');
    await page.getByLabel('设置').click();
    await page.getByRole('dialog', { name: 'SciForge 设置' }).waitFor({ timeout: 15_000 });
    await page.getByText('Workspace Writer').first().waitFor();
    await page.getByText('AgentServer').first().waitFor();
    await page.getByLabel('关闭设置').click();
    logStep('workspace sidebar opens, explains current path, and lists .sciforge resources');
    await openNavigationPanel(page);
    await page.getByLabel('工作区文件树').waitFor({ timeout: 15_000 });
    await page.getByLabel('刷新').click();
    await page.getByText(/workspace-state\.json|scenarios|\.sciforge|未找到|Workspace Writer/).first().waitFor({ timeout: 15_000 });
    await page.getByText('.sciforge').first().waitFor({ timeout: 15_000 });
    await page.getByRole('status').filter({ hasText: /已加载|当前目录为空/ }).first().waitFor({ timeout: 15_000 });
    logStep('workbench composer is available and timeline stays searchable');
    await openNavigationPanel(page);
    await page.getByRole('button', { name: '场景工作台' }).click();
    if (!await page.locator('.chat-panel .composer textarea').isVisible({ timeout: 2_000 }).catch(() => false)) {
      await openNavigationPanel(page);
      await page.getByRole('button', { name: '研究概览' }).click();
      await page.getByRole('button', { name: '导入文献场景', exact: true }).click();
    }
    await expandWorkbenchChrome(page);
    await expandComposer(page);
    await page.locator('.chat-panel .composer textarea').waitFor({ timeout: 15_000 });
    await page.locator('.chat-panel .composer textarea').fill('browser-smoke-live-run 搜索最新 arXiv 并生成系统性报告，验证 AgentServer offline recovery card');
    await page.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).waitFor({ state: 'visible', timeout: 15_000 });
    const smokeRunAction = 'run.failed';
    logStep('timeline is reachable from navigation');
    await openNavigationPanel(page);
    await page.getByRole('button', { name: '研究时间线' }).click();
    await page.getByRole('heading', { name: '研究时间线' }).waitFor({ timeout: 15_000 });
    await page.getByLabel('搜索 Timeline').fill('browser-smoke-run');
    await page.getByRole('heading', { name: smokeRunAction }).waitFor({ timeout: 15_000 });
    await page.getByLabel('按事件类型过滤').selectOption(smokeRunAction);
    await page.getByText('browser-smoke-run').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '导出当前分支' }).waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: '回到场景' }).first().click();
    await expandWorkbenchChrome(page);
    await page.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await openNavigationPanel(page);
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
    await page.getByText('browser-smoke-imported-package').first().waitFor({ timeout: 15_000 });
    await openNavigationPanel(page);
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
    await page.locator('.draft-preview code').first().waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: /进入.*工作台/ }).click();
    await expandWorkbenchChrome(page);
    await page.getByLabel('Scenario Builder').getByRole('button', { name: '场景信息' }).waitFor();
    await page.getByRole('button', { name: '场景 UI allowlist' }).click();
    const firstElementRow = page.locator('.element-selector-row').first();
    await firstElementRow.waitFor({ state: 'visible', timeout: 15_000 });
    await firstElementRow.locator('summary', { hasText: '详细' }).click();
    await firstElementRow.locator('em').waitFor({ state: 'visible', timeout: 15_000 });
    await page.getByRole('button', { name: '场景契约' }).click();
    await captureSmokeScreenshot(page, join(artifactsDir, 'browser-smoke-builder-collapsed.png'));
    await page.getByLabel('结果区 focus mode').getByRole('button', { name: '只看执行单元' }).evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
    });
    await page.getByText(/可复现执行单元|ExecutionUnit|执行单元/).first().waitFor({ timeout: 15_000 });
    await page.getByLabel('结果区 focus mode').getByRole('button', { name: '全部', exact: true }).evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
    });
    await page.getByText('展开高级 JSON contract').click();
    await page.getByRole('button', { name: 'skill', exact: true }).click();
    await page.getByText('skillIRs').waitFor();
    await page.getByRole('button', { name: 'validation', exact: true }).click();
    await page.locator('pre.inspector-json', { hasText: 'issues' }).waitFor();
    await page.getByRole('button', { name: '发布运行' }).click();
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

    const failedRestorePage = await newConfiguredPage(browser, { width: 1280, height: 900 }, 'failed-restore');
    await failedRestorePage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    logStep('workspace restore opens the latest recoverable failed run directly in the workbench');
    await failedRestorePage.locator('.active-run-banner', { hasText: 'run-browser-failed-restore' }).waitFor({ timeout: 15_000 });
    await failedRestorePage.getByLabel('结果区 focus mode').getByRole('button', { name: '全部', exact: true }).evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
    });
    const failedRestoreSummary = failedRestorePage.locator('.run-status-summary').first();
    await failedRestoreSummary.waitFor({ timeout: 15_000 });
    await failedRestoreSummary.getByRole('heading', { name: /运行需要(恢复|处理)/ }).waitFor({ timeout: 15_000 });
    await failedRestoreSummary.getByText('PDF retrieval partially failed', { exact: false }).first().waitFor({ timeout: 15_000 });
    await failedRestorePage.locator('.run-recover-actions', { hasText: 'inspect diagnostics without rerun' }).first().waitFor({ timeout: 15_000 });
    await failedRestorePage.locator('.run-recover-actions', { hasText: 'rerun failed PDF downloads only after explicit confirmation' }).first().waitFor({ timeout: 15_000 });
    await failedRestorePage.locator('code', { hasText: 'file:.sciforge/task-results/failed-restore.bundle.json' }).first().waitFor({ timeout: 15_000 });
    await captureSmokeScreenshot(failedRestorePage, join(artifactsDir, 'browser-smoke-failed-run-restore.png'));
    await assertNoRawJsonErrors(failedRestorePage, 'failed-run-restore');
    await assertNoUnexplainedDisabledPrimaryButtons(failedRestorePage, 'failed-run-restore');
    await assertNoRechartsSizeWarnings(failedRestorePage, 'failed-run-restore');
    assert.deepEqual((failedRestorePage as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'failed run restore workflow should not emit page errors');
    await failedRestorePage.close();

    await openNavigationPanel(page);
    await page.getByRole('button', { name: '研究概览' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Scenario Library' }).waitFor();
    await page.getByLabel('搜索 Scenario Library').fill('omics');
    await page.getByLabel('按 skill domain 过滤').selectOption('omics');
    const omicsDraftOrBuiltInCard = page.locator('.scenario-card').filter({ hasText: /omics-differential-exploration-workspace-draft|omics-differential-exploration/ }).first();
    await omicsDraftOrBuiltInCard.waitFor({ timeout: 15_000 });
    await page.getByLabel('排序 Scenario Library').selectOption('title');
    await omicsDraftOrBuiltInCard.waitFor({ timeout: 15_000 });
    await omicsDraftOrBuiltInCard.getByRole('button', { name: /打开|导入并打开/ }).first().click();
    await expandWorkbenchChrome(page);
    await page.getByText('Scenario Builder').waitFor();
    await page.locator('code', { hasText: /workspace.*@1\.0\.0|omics-differential-exploration.*@/ }).first().waitFor({ timeout: 15_000 });
    await page.getByText(/将使用|输入研究问题后即可运行/).waitFor({ timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByLabel('移动端工作区视图').waitFor({ timeout: 15_000 });
    await clickMobileWorkbenchTab(page, 'Builder');
    await page.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await clickMobileWorkbenchTab(page, 'Results');
    await page.getByRole('heading', { name: '结果视图' }).waitFor({ timeout: 15_000 });
    await clickMobileWorkbenchTab(page, 'Chat');
    await expandComposer(page);
    await page.locator('.mobile-pane:not(.mobile-hidden) .chat-panel .composer textarea').waitFor({ timeout: 15_000 });
    await assertNoCriticalOverflow(page, 'mobile-workbench');
    await assertNoRawJsonErrors(page, 'mobile-workbench');
    await assertNoUnexplainedDisabledPrimaryButtons(page, 'mobile-workbench');
    await assertNoRechartsSizeWarnings(page, 'mobile-workbench');
    await captureSmokeScreenshot(page, join(artifactsDir, 'browser-smoke-mobile.png'));
    assert.deepEqual((page as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'builder workflow should not emit page errors');
    await page.close();

    const offlineHealthPage = await newConfiguredPage(browser, { width: 1280, height: 900 }, false, {
      workspaceWriterBaseUrl: 'http://127.0.0.1:65535',
      agentServerBaseUrl: 'http://127.0.0.1:65535',
    });
    await offlineHealthPage.route('http://127.0.0.1:5174/api/sciforge/config', (route) => route.abort());
    await offlineHealthPage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    logStep('offline runtime health shows concrete recovery actions');
    await offlineHealthPage.getByText('Runtime Health').first().waitFor({ timeout: 15_000 });
    await offlineHealthPage.locator('.runtime-health-item')
      .filter({ hasText: 'Workspace Writer' })
      .filter({ hasText: /启动 npm run workspace:server 后刷新|默认 writer .* 在线/ })
      .first()
      .waitFor({ timeout: 15_000 });
    await offlineHealthPage.locator('.runtime-health-item')
      .filter({ hasText: 'AgentServer' })
      .filter({ hasText: /启动或修复 AgentServer|AgentServer\/agent backend|127\.0\.0\.1:65535/ })
      .first()
      .waitFor({ timeout: 15_000 });
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
    await structurePage.locator('[data-component-id="structure-viewer"], .structure-viewer').first().waitFor({ timeout: 15_000 });
    await structurePage.getByRole('button', { name: '只看图' }).click({ force: true });
    await structurePage.locator('[data-component-id="structure-viewer"], .structure-viewer').first().waitFor({ timeout: 15_000 });
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
    await structurePage
      .getByLabel('Handoff 确认预览')
      .getByText('new run', { exact: true })
      .waitFor({ timeout: 15_000 });
    await structurePage.getByRole('button', { name: '取消' }).click({ force: true });
    await captureSmokeScreenshot(structurePage, join(artifactsDir, 'browser-smoke-structure.png'));
    const viewerBox = await structurePage.locator('[data-component-id="structure-viewer"], .structure-viewer').first().boundingBox();
    assert.ok(viewerBox && viewerBox.width > 260 && viewerBox.height > 220, 'structure viewer should be visible and stable');
    await assertNoRawJsonErrors(structurePage, 'structure-workflow');
    await assertNoUnexplainedDisabledPrimaryButtons(structurePage, 'structure-workflow');
    await assertNoRechartsSizeWarnings(structurePage, 'structure-workflow');
    assert.deepEqual((structurePage as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'structure workflow should not emit page errors');
    await structurePage.close();

    await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify(referenceWorkspaceState(workspace, referencePreviewPath), null, 2));
    await writeReferenceScenarioPackage();
    const referencePage = await newConfiguredPage(browser, { width: 1360, height: 980 }, 'references');
    const referenceRequests: Array<Record<string, unknown>> = [];
    await referencePage.route(`http://127.0.0.1:${workspacePort}/api/sciforge/tools/run/stream`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      referenceRequests.push(body);
      const result = browserSmokeReferenceToolResult(referencePreviewPath);
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: [
          JSON.stringify({ event: { type: 'status', message: 'reference browser smoke accepted explicit UI refs' } }),
          JSON.stringify({ result }),
          '',
        ].join('\n'),
      });
    });
    await referencePage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await referencePage.getByRole('heading', { name: 'Scenario Library' }).waitFor({ timeout: 15_000 });
    const referenceCatalog = referencePage.locator('main', { has: referencePage.getByRole('heading', { name: 'Scenario Library' }) });
    const omicsReferenceCard = referenceCatalog.locator('.scenario-card').filter({
      has: referencePage.locator('code').filter({ hasText: /^omics-differential-exploration$/ }),
    }).first();
    await omicsReferenceCard.getByRole('button', { name: /打开|导入并打开/ }).first().click();
    await expandWorkbenchChrome(referencePage);
    await referencePage.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await referencePage.getByText('Browser smoke reference seed message').first().waitFor({ timeout: 15_000 });
    await referencePage.locator('.object-reference-chip', { hasText: 'Browser smoke UMAP' }).waitFor({ timeout: 15_000 });
    await referencePage.locator('.object-reference-chip', { hasText: 'Browser smoke DE table' }).waitFor({ timeout: 15_000 });
    logStep('right-click selected text captures a concise composer marker and clickable source highlight');
    const selectedPhrase = 'inspect the UMAP';
    const seedMessage = referencePage.locator('.message.scenario', { hasText: 'Browser smoke reference seed message' }).first();
    const selectedTextBox = await selectTextInLocator(referencePage, seedMessage, selectedPhrase);
    await referencePage.mouse.click(selectedTextBox.x + Math.min(selectedTextBox.width - 2, 8), selectedTextBox.y + Math.max(2, selectedTextBox.height / 2), { button: 'right' });
    if (!await referencePage.locator('.reference-context-menu').isVisible({ timeout: 1500 }).catch(() => false)) {
      await selectTextInLocator(referencePage, seedMessage, selectedPhrase);
      await seedMessage.dispatchEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: selectedTextBox.x + Math.min(selectedTextBox.width - 2, 8),
        clientY: selectedTextBox.y + Math.max(2, selectedTextBox.height / 2),
        button: 2,
      });
    }
    await referencePage.getByRole('menuitem', { name: '引用到对话栏' }).evaluate((button) => {
      if (button instanceof HTMLElement) button.click();
    });
    await referencePage.waitForFunction(() => {
      const text = Array.from(document.querySelectorAll('[aria-label="用户引用的上下文"] .sciforge-reference-chip'))
        .map((element) => element.textContent ?? '')
        .join('\n');
      const input = document.querySelector<HTMLTextAreaElement>('.chat-panel .composer textarea')?.value ?? '';
      return text.includes('选中文本') && input.includes('※1');
    }, null, { timeout: 15_000 });
    await referencePage.locator('.sciforge-reference-chip', { hasText: '选中文本' }).click();
    await referencePage.waitForFunction((phrase) => window.getSelection()?.toString().includes(String(phrase)), selectedPhrase, { timeout: 15_000 });
    logStep('point-select captures historical message, chart, table, and file-like object refs for a follow-up');
    await referencePage.getByRole('button', { name: '点选' }).click();
    await referencePage.locator('.message.scenario', { hasText: 'Browser smoke reference seed message' }).click();
    await referencePage.getByRole('button', { name: '点选' }).click();
    await referencePage.locator('.object-reference-chip', { hasText: 'Browser smoke UMAP' }).click();
    await referencePage.getByRole('button', { name: '点选' }).click();
    await referencePage.locator('.object-reference-chip', { hasText: 'Browser smoke DE table' }).click();
    await referencePage.getByRole('button', { name: '点选' }).click();
    await referencePage.locator('.object-reference-chip', { hasText: 'Reference follow-up report' }).click();
    await referencePage.waitForFunction(() => document.querySelectorAll('[aria-label="用户引用的上下文"] .sciforge-reference-chip').length >= 5, null, { timeout: 15_000 });
    await expandComposer(referencePage);
    const markerPrompt = await referencePage.getByPlaceholder(/输入研究问题/).inputValue();
    await referencePage.getByPlaceholder(/输入研究问题/).fill(`${markerPrompt} 基于右键文本、点选的历史消息、图表、表格和文件继续追问，并打开报告预览`);
    await referencePage.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
    await referencePage.getByText('Reference follow-up accepted').first().waitFor({ timeout: 15_000 });
    const sentReferences = ((referenceRequests.at(-1)?.references ?? []) as Array<Record<string, unknown>>);
    assert.deepEqual(['ui', 'message', 'chart', 'table', 'file'].every((kind) => sentReferences.some((reference) => reference.kind === kind)), true, `follow-up should send text/message/chart/table/file refs, got ${JSON.stringify(sentReferences)}`);
    const sentTextReference = sentReferences.find((reference) => reference.kind === 'ui' && String(reference.ref).startsWith('ui-text:'));
    assert.ok(sentTextReference, `selected text reference should be sent, got ${JSON.stringify(sentReferences)}`);
    assert.equal((sentTextReference.payload as Record<string, unknown>).composerMarker, '※1');
    assert.equal((sentTextReference.payload as Record<string, unknown>).selectedText, selectedPhrase);
    assert.match(String(referenceRequests.at(-1)?.prompt ?? ''), /※1/);
    assert.doesNotMatch(String(referenceRequests.at(-1)?.prompt ?? ''), /inspect the UMAP/);
    logStep('final object chip focuses the right pane and previews the real workspace markdown file');
    await referencePage.locator('.object-reference-chip', { hasText: 'Reference follow-up report' }).last().click();
    await referencePage.locator('.object-focus-banner', { hasText: 'Reference follow-up report' }).waitFor({ timeout: 15_000 });
    await referencePage.locator('.workspace-object-preview', { hasText: 'reference-followup-report.md' }).waitFor({ timeout: 15_000 });
    await referencePage.locator('.workspace-object-preview', { hasText: 'real workspace markdown file verifies inline preview' }).waitFor({ timeout: 15_000 });
    await captureSmokeScreenshot(referencePage, join(artifactsDir, 'browser-smoke-reference-followup-preview.png'));
    await assertNoRawJsonErrors(referencePage, 'reference-followup');
    await assertNoUnexplainedDisabledPrimaryButtons(referencePage, 'reference-followup');
    await assertNoRechartsSizeWarnings(referencePage, 'reference-followup');
    assert.deepEqual((referencePage as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'reference follow-up workflow should not emit page errors');
    await referencePage.close();

    const cursorUxPage = await newConfiguredPage(browser, { width: 1360, height: 980 }, false);
    await installCursorLikeWorklogFixture(cursorUxPage);
    await cursorUxPage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await cursorUxPage.getByRole('heading', { name: 'Scenario Library' }).waitFor({ timeout: 15_000 });
    const cursorUxCatalog = cursorUxPage.locator('main', { has: cursorUxPage.getByRole('heading', { name: 'Scenario Library' }) });
    const cursorUxCard = cursorUxCatalog.locator('.scenario-card', { hasText: 'literature-evidence-review' }).first();
    await cursorUxCard.scrollIntoViewIfNeeded();
    const cursorUxImportButton = cursorUxCard.getByRole('button', { name: '导入并打开', exact: true });
    if (await cursorUxImportButton.count()) {
      await cursorUxImportButton.click();
    } else {
      await cursorUxCard.getByRole('button', { name: '打开', exact: true }).click();
    }
    await expandWorkbenchChrome(cursorUxPage);
    await expandComposer(cursorUxPage);
    await cursorUxPage.getByPlaceholder(/输入研究问题/).waitFor({ timeout: 15_000 });
    logStep('T097/T095 RunningWorkProcess keeps structured work facts compact and raw output folded');
    await cursorUxPage.getByPlaceholder(/输入研究问题/).fill('T097 generic fixture: run a multi-stage task with structured evidence and folded raw output');
    await cursorUxPage.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
    await assertCursorLikeRunningWorklog(cursorUxPage);
    await assertCursorLikeFinalAndRecovery(cursorUxPage);
    await captureSmokeScreenshot(cursorUxPage, join(artifactsDir, 'browser-smoke-t097-running-work-process.png'));
    await assertNoRawJsonErrors(cursorUxPage, 't097-running-work-process');
    await assertNoUnexplainedDisabledPrimaryButtons(cursorUxPage, 't097-running-work-process');
    await assertNoRechartsSizeWarnings(cursorUxPage, 't097-running-work-process');
    assert.deepEqual((cursorUxPage as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'T097 RunningWorkProcess workflow should not emit page errors');
    await cursorUxPage.close();

    const contextPage = await newConfiguredPage(browser, { width: 1360, height: 980 }, false);
    const compactRequests: Array<Record<string, unknown>> = [];
    const contextRunRequests: Array<Record<string, unknown>> = [];
    let contextRunCount = 0;
    let releaseThirdContextRun: (() => void) | undefined;
    let resolveThirdContextRunStarted: (() => void) | undefined;
    const thirdContextRunStarted = new Promise<void>((resolveThirdRun) => {
      resolveThirdContextRunStarted = resolveThirdRun;
    });
    await contextPage.route(`http://127.0.0.1:${workspacePort}/api/sciforge/tools/run/stream`, async (route, request) => {
      const body = request.postDataJSON() as Record<string, unknown>;
      contextRunRequests.push(body);
      contextRunCount += 1;
      if (contextRunCount === 3) {
        resolveThirdContextRunStarted?.();
        await new Promise<void>((resolveRelease) => {
          releaseThirdContextRun = resolveRelease;
        });
      }
      const ratio = contextRunCount === 1 ? 0.72 : contextRunCount === 2 ? 0.86 : contextRunCount === 3 ? 0.61 : 0.59;
      await route.fulfill({
        status: 200,
        contentType: 'application/x-ndjson; charset=utf-8',
        body: contextWindowToolStreamBody(contextRunCount, ratio),
      });
    });
    await contextPage.route('http://127.0.0.1:18080/api/agent-server/**', async (route, request) => {
      if (/compact/i.test(request.url())) compactRequests.push(request.postDataJSON() as Record<string, unknown>);
      const now = new Date().toISOString();
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          contextCompaction: {
            status: 'completed',
            source: 'agentserver',
            backend: 'codex',
            compactCapability: 'agentserver',
            reason: 'auto-threshold-before-send',
            completedAt: now,
            lastCompactedAt: now,
            message: 'browser smoke compact preflight completed',
            auditRefs: ['agentserver://browser-smoke/context-compact'],
            before: browserSmokeContextWindowState(0.86, 'near-limit'),
            after: browserSmokeContextWindowState(0.87, 'near-limit'),
          },
        }),
      });
    });
    await contextPage.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await contextPage.getByRole('heading', { name: 'Scenario Library' }).waitFor({ timeout: 15_000 });
    const contextCatalog = contextPage.locator('main', { has: contextPage.getByRole('heading', { name: 'Scenario Library' }) });
    const literatureCard = contextCatalog.locator('.scenario-card', { hasText: 'literature-evidence-review' }).first();
    await literatureCard.scrollIntoViewIfNeeded();
    const literatureImportButton = literatureCard.getByRole('button', { name: '导入并打开', exact: true });
    if (await literatureImportButton.count()) {
      await literatureImportButton.click();
    } else {
      await literatureCard.getByRole('button', { name: '打开', exact: true }).click();
    }
    await expandWorkbenchChrome(contextPage);
    await contextPage.getByText('Scenario Builder').waitFor({ timeout: 15_000 });
    await expandComposer(contextPage);
    await contextPage.getByPlaceholder(/输入研究问题/).waitFor({ timeout: 15_000 });
    logStep('context meter turns watch, then near-limit, from mocked multi-turn usage');
    await sendContextSmokePrompt(contextPage, 'context-window round one usage reaches watch threshold');
    await expandComposer(contextPage);
    await contextPage.waitForFunction(() => Array.from(document.querySelectorAll('.context-window-meter.watch'))
      .some((element) => element.getAttribute('aria-label')?.includes('72%')), null, { timeout: 15_000 });
    assert.equal(compactRequests.length, 0, 'watch-level context should not compact before the next turn');
    await sendContextSmokePrompt(contextPage, 'context-window round two usage reaches auto compact threshold');
    await expandComposer(contextPage);
    await contextPage.waitForFunction(() => Array.from(document.querySelectorAll('.context-window-meter.near-limit'))
      .some((element) => element.getAttribute('aria-label')?.includes('86%')), null, { timeout: 15_000 });
    assert.equal(compactRequests.length, 0, 'near-limit usage should wait until the following send to preflight compact');
    logStep('next send delegates compact preflight to AgentServer once');
    await contextPage.getByPlaceholder(/输入研究问题/).fill('context-window round three should compact before sending');
    await contextPage.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
    await thirdContextRunStarted;
    assert.equal(contextRunRequests.length, 3, 'third user send should continue into the backend run after one compact preflight');
    assert.equal(compactRequests.length, 1, 'near-limit send should request exactly one AgentServer compact preflight');
    logStep('running turn avoids duplicate compact preflight');
    await expandComposer(contextPage);
    await contextPage.locator('.chat-panel .composer textarea').fill('context-window guidance while backend is still running');
    await contextPage.locator('.chat-panel .composer').getByRole('button', { name: '引导' }).click();
    await contextPage.waitForTimeout(500);
    assert.equal(compactRequests.length, 1, 'running guidance should not trigger another compact preflight');
    releaseThirdContextRun?.();
    await contextPage.getByText('Context smoke response 4').first().waitFor({ timeout: 15_000 });
    assert.equal(contextRunRequests.length, 4, 'queued guidance should run after the active turn without duplicate compact');
    assert.equal(compactRequests.length, 1, 'context compact preflight should not duplicate across queued guidance');
    await captureSmokeScreenshot(contextPage, join(artifactsDir, 'browser-smoke-context-meter.png'));
    await assertNoRawJsonErrors(contextPage, 'context-meter');
    await assertNoUnexplainedDisabledPrimaryButtons(contextPage, 'context-meter');
    await assertNoRechartsSizeWarnings(contextPage, 'context-meter');
    assert.deepEqual((contextPage as Page & { __sciforgePageErrors?: string[] }).__sciforgePageErrors ?? [], [], 'context meter workflow should not emit page errors');
    await contextPage.close();
  } finally {
    await browser.close();
  }

  console.log(`[ok] browser smoke covered onboarding, Settings, Workspace, Timeline, failed-run restore, Builder publish/open flow, collapsed results, mobile layout, structure viewer, reference follow-up preview, T097/T095 RunningWorkProcess folding, and context meter compact UX screenshots in ${artifactsDir}`);
} finally {
  for (const child of children.reverse()) child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
  if (originalConfigLocal === undefined) await rm(configLocalPath, { force: true });
  else await writeFile(configLocalPath, originalConfigLocal);
}

async function newConfiguredPage(
  browser: Browser,
  viewport: { width: number; height: number },
  stateMode: boolean | 'default' | 'structure' | 'references' | 'failed-restore' = false,
  configPatch: Partial<{ workspaceWriterBaseUrl: string; agentServerBaseUrl: string }> = {},
) {
  const page = await browser.newPage({ viewport });
  const withStructureState = stateMode === true || stateMode === 'structure';
  const withReferenceState = stateMode === 'references';
  const withFailedRestoreState = stateMode === 'failed-restore';
  const configuredWorkspacePath = withStructureState
    ? join(workspace, 'structure-smoke')
    : withFailedRestoreState
      ? join(workspace, 'failed-restore-smoke')
      : workspace;
  const workspaceState = withStructureState
    ? structureWorkspaceState(configuredWorkspacePath)
    : withReferenceState
      ? referenceWorkspaceState(configuredWorkspacePath, referencePreviewPath)
      : withFailedRestoreState
        ? failedRunRestoreWorkspaceState(configuredWorkspacePath)
      : browserSmokeWorkspaceState(configuredWorkspacePath);
  await mkdir(join(configuredWorkspacePath, '.sciforge'), { recursive: true });
  await writeFile(join(configuredWorkspacePath, '.sciforge', 'workspace-state.json'), JSON.stringify(workspaceState, null, 2));
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
  await fetch(`http://127.0.0.1:${workspacePort}/api/sciforge/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  await page.addInitScript(({ config, structureState, referenceState, failedRestoreState, defaultWorkspaceState }) => {
    window.localStorage.setItem('sciforge.config.v1', JSON.stringify(config));
    window.localStorage.setItem('sciforge.workspace.v2', JSON.stringify(structureState ?? referenceState ?? failedRestoreState ?? defaultWorkspaceState));
  }, {
    config,
    structureState: withStructureState ? workspaceState : undefined,
    referenceState: withReferenceState ? workspaceState : undefined,
    failedRestoreState: withFailedRestoreState ? workspaceState : undefined,
    defaultWorkspaceState: workspaceState,
  });
  (page as Page & { __sciforgePageErrors?: string[]; __sciforgeConsoleWarnings?: string[] }).__sciforgePageErrors = pageErrors;
  (page as Page & { __sciforgePageErrors?: string[]; __sciforgeConsoleWarnings?: string[] }).__sciforgeConsoleWarnings = consoleWarnings;
  return page;
}

async function captureSmokeScreenshot(page: Page, path: string) {
  try {
    await page.screenshot({ path, fullPage: true, timeout: 10_000 });
  } catch (error) {
    console.warn(`[ux] skipped screenshot ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function selectTextInLocator(page: Page, locator: Locator, phrase: string) {
  const box = await locator.evaluate((element, selectedPhrase) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent ?? '';
      const index = text.indexOf(String(selectedPhrase));
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + String(selectedPhrase).length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const rect = range.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      node = walker.nextNode();
    }
    throw new Error(`Could not select phrase: ${String(selectedPhrase)}`);
  }, phrase);
  await page.waitForFunction((selectedPhrase) => window.getSelection()?.toString() === String(selectedPhrase), phrase, { timeout: 15_000 });
  assert.ok(box && box.width > 0 && box.height > 0, `selected phrase should have a visible range: ${phrase}`);
  return box;
}

async function openNavigationPanel(page: Page) {
  if (await page.getByLabel('展开侧栏').isVisible().catch(() => false)) {
    await page.getByLabel('展开侧栏').click();
  }
  await page.locator('.sidebar-activitybar button[aria-label="导航"]').click();
  await page.getByRole('button', { name: '研究概览' }).waitFor({ timeout: 15_000 });
}

async function clickMobileWorkbenchTab(page: Page, name: 'Builder' | 'Chat' | 'Results') {
  await page.getByLabel('移动端工作区视图').getByRole('button', { name, exact: true }).evaluate((button) => {
    if (button instanceof HTMLElement) button.click();
  });
}

async function expandWorkbenchChrome(page: Page) {
  const toggle = page.locator('.workbench-chrome-toggle-main');
  await toggle.waitFor({ state: 'visible', timeout: 15_000 });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

async function expandComposer(page: Page) {
  const textarea = page.locator('.chat-panel .composer textarea');
  if (await textarea.isVisible({ timeout: 1_000 }).catch(() => false)) return;
  const collapsed = page.locator('.chat-panel .composer-collapsed').first();
  if (await collapsed.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await collapsed.click();
  }
}

async function installCursorLikeWorklogFixture(page: Page) {
  const result = cursorLikeWorklogResult();
  const streamChunks = [
    JSON.stringify({
      event: {
        type: 'task-project-summary',
        source: 'agentserver',
        message: 'TEXT_FALLBACK_PROJECT_SHOULD_NOT_APPEAR',
        output: {
          schemaVersion: 'sciforge.task-project-handoff.v1',
          project: {
            id: 'browser-project-t097',
            title: 'Browser smoke durable evidence project',
            goal: 'Exercise RunningWorkProcess structured facts without provider-specific UI branches',
            status: 'running',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          refs: {},
          stages: [
            {
              id: 'stage-search',
              projectId: 'browser-project-t097',
              index: 0,
              kind: 'search',
              title: 'Search durable evidence',
              status: 'running',
              ref: 'stage:browser-search',
              evidenceRefs: ['trace:browser-search'],
              artifactRefs: [],
              diagnostics: ['primary provider status 200'],
              recoverActions: [],
              nextStep: 'Fetch selected records',
              workEvidence: [{
                kind: 'retrieval',
                status: 'success',
                provider: 'generic-provider',
                input: { query: 'browser smoke durable evidence' },
                resultCount: 3,
                outputSummary: 'Structured retrieval found 3 reusable records',
                evidenceRefs: ['evidence:browser-search'],
                recoverActions: [],
                diagnostics: ['primary provider status 200'],
                nextStep: 'Fetch selected records',
                rawRef: 'raw:browser-search',
              }],
            },
            {
              id: 'stage-fetch',
              projectId: 'browser-project-t097',
              index: 1,
              kind: 'fetch',
              title: 'Fetch selected records',
              status: 'planned',
              ref: 'stage:browser-fetch',
              evidenceRefs: [],
              artifactRefs: [],
              diagnostics: [],
              recoverActions: [],
              workEvidence: [],
            },
          ],
          truncated: false,
          providerRawOutput: 'RAW_SEARCH_PAYLOAD_SHOULD_STAY_FOLDED '.repeat(80),
        },
      },
    }),
    JSON.stringify({
      event: {
        type: 'task-stage',
        source: 'agentserver',
        message: 'TEXT_FALLBACK_STAGE_SHOULD_NOT_APPEAR',
        output: {
          taskStage: {
            schemaVersion: 'sciforge.task-stage.v1',
            id: 'stage-fetch',
            projectId: 'browser-project-t097',
            index: 1,
            kind: 'fetch',
            title: 'Fetch selected records',
            status: 'running',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            inputRefs: ['input:browser-fetch'],
            outputRefs: [],
            artifactRefs: [],
            evidenceRefs: ['trace:browser-fetch'],
            logRefs: ['log:browser-fetch'],
            diagnostics: ['fetch bounded to 2 records'],
            recoverActions: [],
            nextStep: 'Validate evidence refs',
            workEvidence: [{
              kind: 'fetch',
              status: 'partial',
              provider: 'generic-provider',
              input: { refs: ['evidence:browser-search'] },
              resultCount: 2,
              outputSummary: 'Structured fetch retained 2 bounded records',
              evidenceRefs: ['evidence:browser-fetch'],
              recoverActions: [],
              diagnostics: ['fetch bounded to 2 records'],
              nextStep: 'Validate evidence refs',
              rawRef: 'raw:browser-fetch',
            }],
          },
          providerRawOutput: 'RAW_FETCH_PAYLOAD_SHOULD_STAY_FOLDED '.repeat(80),
        },
      },
    }),
    JSON.stringify({
      event: {
        type: 'task-stage',
        source: 'agentserver',
        message: 'TEXT_FALLBACK_FAILURE_SHOULD_NOT_APPEAR',
        output: {
          taskStage: {
            schemaVersion: 'sciforge.task-stage.v1',
            id: 'stage-validate',
            projectId: 'browser-project-t097',
            index: 2,
            kind: 'validate',
            title: 'Validate evidence refs',
            status: 'failed',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            inputRefs: ['input:browser-validate'],
            outputRefs: [],
            artifactRefs: [],
            evidenceRefs: ['trace:browser-validate'],
            logRefs: ['log:browser-validate-stderr'],
            failureReason: 'structured fixture detected a missing artifact schema',
            recoverActions: ['rerun validator with bounded artifact refs'],
            diagnostics: ['validator schema mismatch'],
            nextStep: 'Repair artifact schema and rerun current stage',
            failure: {
              reason: 'structured fixture detected a missing artifact schema',
              recoverActions: ['rerun validator with bounded artifact refs'],
              evidenceRefs: ['trace:browser-validate'],
            },
            workEvidence: [{
              kind: 'command',
              status: 'repair-needed',
              provider: 'local-runtime',
              input: { command: 'validate artifact refs' },
              resultCount: 0,
              outputSummary: 'Validator preserved failure as structured evidence',
              evidenceRefs: ['evidence:browser-validate'],
              failureReason: 'structured fixture detected a missing artifact schema',
              recoverActions: ['rerun validator with bounded artifact refs'],
              diagnostics: ['validator schema mismatch'],
              nextStep: 'Repair artifact schema and rerun current stage',
              rawRef: 'raw:browser-validate',
            }],
          },
          providerRawOutput: 'RAW_FAILURE_PAYLOAD_SHOULD_STAY_FOLDED '.repeat(80),
        },
      },
    }),
    JSON.stringify({ result }),
    '',
  ];
  await page.addInitScript(({ chunks }) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!url.includes('/api/sciforge/tools/run/stream')) return originalFetch(input, init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const delays = [120, 300, 480, 1600, 1700];
          chunks.forEach((chunk, index) => {
            window.setTimeout(() => {
              controller.enqueue(encoder.encode(`${chunk}\n`));
              if (index === chunks.length - 1) controller.close();
            }, delays[index] ?? 1700 + index * 100);
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
      });
    };
  }, { chunks: streamChunks });
}

async function assertCursorLikeRunningWorklog(page: Page) {
  const runningMessage = page.locator('.message.scenario', { has: page.locator('.running-work-process') }).last();
  await runningMessage.waitFor({ timeout: 15_000 });
  const processFold = runningMessage.locator('.running-work-process-raw');
  await processFold.waitFor({ timeout: 15_000 });
  assert.equal(await processFold.getAttribute('open'), null, 'running process details should default to a compact collapsed summary');
  assert.equal(await runningMessage.locator('.stream-event:visible').count(), 0, 'running message should not show operation detail rows until expanded');
  assert.equal(await runningMessage.locator('.stream-event-raw-fold:visible').count(), 0, 'running message should not show raw/tool output in the default compact state');
  await page.waitForFunction(() => {
    const messages = Array.from(document.querySelectorAll('.message.scenario')).filter((message) => message.querySelector('.running-work-process'));
    const latest = messages.at(-1);
    const text = latest?.textContent ?? '';
    return /Project Browser smoke durable evidence project|Project browser-project-t097/.test(text)
      && /Failure|Recover|structured fixture detected a missing artifact schema/.test(text);
  }, null, { timeout: 15_000 });
  const compactText = await runningMessage.locator('.running-work-live').innerText({ timeout: 15_000 });
  assert.match(compactText, /Project Browser smoke durable evidence project|Project browser-project-t097/, 'compact running message should show project');
  assert.match(compactText, /Stage [123] /, 'compact running message should show stage');
  assert.match(compactText, /running|failed/, 'compact running message should show status');
  assert.match(compactText, /Evidence|Failure/, 'compact running message should show structured evidence or failure');
  assert.doesNotMatch(compactText, /TEXT_FALLBACK_/, 'structured TaskStage/WorkEvidence fields should win over text fallback');
  assert.doesNotMatch(compactText, /RAW_(SEARCH|FETCH|FAILURE)_PAYLOAD_SHOULD_STAY_FOLDED/, 'raw output should not be flattened into the compact running message');
  const processSummary = processFold.locator(':scope > summary');
  await processSummary.click();
  await runningMessage.locator('.stream-event').first().waitFor({ timeout: 15_000 });
  assert.ok(await runningMessage.locator('.stream-event').count() >= 2, 'expanded running process should expose operation detail rows');
  const expandedTextWithoutRaw = await runningMessage.evaluate((message) => {
    const clone = message.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.stream-event-raw-fold').forEach((node) => node.remove());
    return clone.textContent ?? '';
  });
  assert.match(expandedTextWithoutRaw, /Recover/);
  assert.match(expandedTextWithoutRaw, /Diagnostic/);
  assert.match(expandedTextWithoutRaw, /Next/);
  assert.doesNotMatch(expandedTextWithoutRaw, /TEXT_FALLBACK_/);
  assert.doesNotMatch(expandedTextWithoutRaw, /RAW_(SEARCH|FETCH|FAILURE)_PAYLOAD_SHOULD_STAY_FOLDED/, 'raw output should remain only inside second-level raw folds');
  const rawFold = runningMessage.locator('.stream-event-raw-fold').first();
  await rawFold.waitFor({ timeout: 15_000 });
  assert.equal(await rawFold.getAttribute('open'), null, 'raw/tool output should remain second-level collapsed after expanding operation details');
  await processSummary.click();
}

async function assertCursorLikeFinalAndRecovery(page: Page) {
  const finalAuditFold = page.locator('.message.scenario .final-message-audit-fold').last();
  await finalAuditFold.waitFor({ timeout: 15_000 });
  assert.equal(await finalAuditFold.getAttribute('open'), null, 'final scenario message should default-collapse execution audit');
  await page.locator('.results-panel .registry-slot').first().waitFor({ timeout: 15_000 });
  const artifactRefs = await page.locator('.results-panel .registry-slot, .results-panel .artifact-source-bar').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-sciforge-reference') ?? node.textContent ?? ''),
  );
  assert.ok(artifactRefs.some((text) => /artifact|research-report|report/.test(text)), `results should still expose a runtime artifact, got ${artifactRefs.join('\n')}`);
  await page.locator('.results-panel .run-status-summary').waitFor({ timeout: 15_000 });
  await page.locator('.results-panel .run-recover-actions').first().waitFor({ timeout: 15_000 });
}

async function sendContextSmokePrompt(page: Page, prompt: string) {
  await expandComposer(page);
  await page.getByPlaceholder(/输入研究问题/).fill(prompt);
  await page.locator('.chat-panel .composer').getByRole('button', { name: '发送' }).click();
  await page.getByText(new RegExp(`Context smoke response ${contextSmokeResponseIndexForPrompt(prompt)}`)).first().waitFor({ timeout: 15_000 });
}

function contextSmokeResponseIndexForPrompt(prompt: string) {
  if (/round one/.test(prompt)) return 1;
  if (/round two/.test(prompt)) return 2;
  return 3;
}

async function writeReferenceScenarioPackage() {
  const pkg = {
    ...buildBuiltInScenarioPackage('omics-differential-exploration', '2026-05-02T00:00:00.000Z'),
    status: 'published',
  };
  const scenarioDir = join(workspace, '.sciforge', 'scenarios', 'omics-differential-exploration');
  await mkdir(scenarioDir, { recursive: true });
  await writeFile(join(scenarioDir, 'package.json'), JSON.stringify(pkg, null, 2));
}

async function assertNoCriticalOverflow(page: Page, label: string) {
  const offenders = await page.evaluate(() => Array.from(document.querySelectorAll('button, .scenario-card, .scenario-settings-chrome-heading, .scenario-publish-row, .manifest-diagnostics'))
    .map((element) => {
      const box = element.getBoundingClientRect();
      const html = element instanceof HTMLElement ? element.innerText.trim().replace(/\s+/g, ' ').slice(0, 80) : element.tagName;
      return {
        html,
        className: element instanceof HTMLElement ? element.className : '',
        width: box.width,
        height: box.height,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        hasTooltip: element.hasAttribute('data-tooltip') || Boolean(element.getAttribute('title')?.trim()),
      };
    })
    .filter((item) => !(item.hasTooltip && !item.html))
    .filter((item) => !(typeof item.className === 'string' && item.className.includes('context-window-meter') && item.hasTooltip))
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
  const warnings = (page as Page & { __sciforgeConsoleWarnings?: string[] }).__sciforgeConsoleWarnings ?? [];
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
