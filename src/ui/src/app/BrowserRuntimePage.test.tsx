import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  BrowserRuntimePage,
  BROWSER_SCREENSHOT_CLIPBOARD_NOTICE,
  BROWSER_SCREENSHOT_FALLBACK_NOTICE_PREFIX,
  buildBrowserFeedbackRepairCommand,
  buildBrowserFeedbackSubmitCommand,
  browserPreviewSandboxForUrl,
  buildBrowserAnnotationCommand,
  buildBrowserWorkbenchPdfViewerUrl,
  buildBrowserPreviewUrl,
  buildBrowserTerminalCommands,
  buildBrowserWorkbenchProxyUrl,
  cleanBrowserWorkbenchUrlInput,
  browserWorkbenchSourceUrlFromPreviewUrl,
  normalizeBrowserWorkbenchUrl,
  shouldProxyBrowserWorkbenchUrl,
  shouldUseBrowserWorkbenchPdfViewerUrl,
} from './BrowserRuntimePage';

test('BrowserRuntimePage exposes a concise Chinese browser workbench without leaking runtime internals by default', () => {
  const html = renderToStaticMarkup(createElement(BrowserRuntimePage));

  assert.match(html, /内置浏览器/);
  assert.match(html, /内置浏览器工作台/);
  assert.match(html, /browser-workbench-pro/);
  assert.match(html, /browser-framebar/);
  assert.match(html, /browser-viewport-stage/);
  assert.match(html, /browser-inspector/);
  assert.match(html, /运行时与安全/);
  assert.match(html, /浏览器地址/);
  assert.match(html, /aria-label="前进"/);
  assert.match(html, /aria-label="截图"/);
  assert.match(html, /aria-label="更多浏览器操作"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /浏览器设置/);
  assert.match(html, /aria-label="收起设置"/);
  assert.match(html, /登录\/接管/);
  assert.match(html, /登录与账号态/);
  assert.match(html, /内置浏览器预览/);
  assert.match(html, /SciForge embedded browser preview/);
  assert.match(html, /标注页面/);
  assert.match(html, /强制重新加载/);
  assert.match(html, /显示设备工具栏/);
  assert.match(html, /隐藏编辑器/);
  assert.match(html, /缩放/);
  assert.match(html, /清除 Cookie/);
  assert.match(html, /清除缓存/);
  assert.match(html, /读取状态/);
  assert.match(html, /页面标注/);
  assert.match(html, /反馈与修复/);
  assert.match(html, /截图或标注后会生成可提交反馈/);
  assert.match(html, /会话与导航/);
  assert.match(html, /观察证据/);
  assert.match(html, /页面操作/);
  assert.match(html, /安全边界/);
  assert.match(html, /默认后台：Playwright 隔离浏览器/);
  assert.match(html, /人工接管：Edge 可见浏览器/);
  assert.match(html, /\/browser open &quot;about:blank&quot; --surface workbench --browser chrome/);
  assert.match(html, /\/browser snapshot --url &quot;about:blank&quot; --screenshot --dom --logs/);
  assert.match(html, /下载/);
  assert.match(html, /需确认/);
  assert.match(html, /允许/);
  assert.doesNotMatch(html, /Built-in browser runtime/);
  assert.doesNotMatch(html, /Provide a Codex-like browser runtime contract/);
  assert.doesNotMatch(html, /playwright_browser_automation/);
  assert.doesNotMatch(html, /playwright_edge_browser/);
  assert.doesNotMatch(html, /needs approval/);
  assert.match(html, /<iframe/);
  assert.match(html, /srcDoc/);
  assert.doesNotMatch(html, /GUI owns provider route/i);
  assert.doesNotMatch(html, /GUI owns prompt assembly/i);
});

test('browser screenshot copy uses Codex-style clipboard success and explicit fallback notices', () => {
  assert.equal(BROWSER_SCREENSHOT_CLIPBOARD_NOTICE, '截图已保存到剪贴板');
  assert.equal(BROWSER_SCREENSHOT_FALLBACK_NOTICE_PREFIX, '截图无法保存到剪贴板');
});

test('normalizeBrowserWorkbenchUrl preserves local browser targets and defaults schemes', () => {
  assert.equal(normalizeBrowserWorkbenchUrl('localhost:5173/foo'), 'http://localhost:5173/foo');
  assert.equal(normalizeBrowserWorkbenchUrl('127.0.0.1:3000'), 'http://127.0.0.1:3000');
  assert.equal(normalizeBrowserWorkbenchUrl('example.org'), 'https://example.org');
  assert.equal(normalizeBrowserWorkbenchUrl('https://example.org/a'), 'https://example.org/a');
  assert.equal(cleanBrowserWorkbenchUrlInput('https://arxiv.org/pdf/2605.00080v1about:blank'), 'https://arxiv.org/pdf/2605.00080v1');
  assert.equal(normalizeBrowserWorkbenchUrl('https://arxiv.org/pdf/2605.00080v1about:blank'), 'https://arxiv.org/pdf/2605.00080v1');
  assert.equal(normalizeBrowserWorkbenchUrl('about:blank'), 'about:blank');
});

test('browser preview proxies PDF-like URLs so arXiv PDFs can render and download inside SciForge', () => {
  const arxivPdf = 'https://arxiv.org/pdf/2605.00080v1';
  const arxivAbs = 'https://arxiv.org/abs/2605.00080';
  const arxivSearch = 'https://arxiv.org/search/?query=world+model&searchtype=all';
  const commands = buildBrowserTerminalCommands(arxivPdf);

  assert.equal(shouldProxyBrowserWorkbenchUrl(arxivPdf), true);
  assert.equal(shouldUseBrowserWorkbenchPdfViewerUrl(arxivPdf), true);
  assert.equal(shouldProxyBrowserWorkbenchUrl(arxivAbs), true);
  assert.equal(shouldUseBrowserWorkbenchPdfViewerUrl(arxivAbs), false);
  assert.equal(shouldProxyBrowserWorkbenchUrl(arxivSearch), true);
  assert.equal(shouldUseBrowserWorkbenchPdfViewerUrl(arxivSearch), false);
  assert.equal(shouldProxyBrowserWorkbenchUrl(`${arxivPdf}about:blank`), true);
  assert.equal(shouldProxyBrowserWorkbenchUrl('https://example.org/article'), false);
  assert.equal(
    buildBrowserPreviewUrl(arxivPdf),
    '/api/sciforge/browser/pdf-viewer?url=https%3A%2F%2Farxiv.org%2Fpdf%2F2605.00080v1',
  );
  assert.equal(
    buildBrowserWorkbenchPdfViewerUrl(arxivPdf),
    '/api/sciforge/browser/pdf-viewer?url=https%3A%2F%2Farxiv.org%2Fpdf%2F2605.00080v1',
  );
  assert.equal(
    buildBrowserPreviewUrl(`${arxivPdf}about:blank`),
    '/api/sciforge/browser/pdf-viewer?url=https%3A%2F%2Farxiv.org%2Fpdf%2F2605.00080v1',
  );
  assert.equal(
    buildBrowserPreviewUrl(arxivAbs),
    '/api/sciforge/browser/proxy?url=https%3A%2F%2Farxiv.org%2Fabs%2F2605.00080',
  );
  assert.equal(
    buildBrowserPreviewUrl(arxivSearch),
    '/api/sciforge/browser/proxy?url=https%3A%2F%2Farxiv.org%2Fsearch%2F%3Fquery%3Dworld%2Bmodel%26searchtype%3Dall',
  );
  assert.equal(
    buildBrowserWorkbenchProxyUrl(arxivPdf, { download: true }),
    '/api/sciforge/browser/proxy?url=https%3A%2F%2Farxiv.org%2Fpdf%2F2605.00080v1&download=1',
  );
  assert.equal(
    browserWorkbenchSourceUrlFromPreviewUrl('/api/sciforge/browser/proxy?url=https%3A%2F%2Farxiv.org%2Fabs%2F2605.00080'),
    arxivAbs,
  );
  assert.equal(
    browserWorkbenchSourceUrlFromPreviewUrl('http://127.0.0.1:5173/api/sciforge/browser/pdf-viewer?url=https%3A%2F%2Farxiv.org%2Fpdf%2F2605.00080v1'),
    arxivPdf,
  );
  assert.equal(browserWorkbenchSourceUrlFromPreviewUrl('about:blank'), undefined);
  assert.equal(browserPreviewSandboxForUrl(arxivPdf), undefined);
  assert.match(browserPreviewSandboxForUrl(arxivAbs) ?? '', /allow-same-origin/);
  assert.doesNotMatch(browserPreviewSandboxForUrl(arxivAbs) ?? '', /allow-scripts/);
  assert.match(browserPreviewSandboxForUrl('https://example.org/article') ?? '', /allow-scripts/);
  assert.match(browserPreviewSandboxForUrl('https://www.example.org/form') ?? '', /allow-forms/);
  assert.match(browserPreviewSandboxForUrl('https://www.example.org/form') ?? '', /allow-modals/);
  assert.doesNotMatch(browserPreviewSandboxForUrl('https://www.example.org/form') ?? '', /allow-popups/);
  assert.doesNotMatch(browserPreviewSandboxForUrl('https://www.example.org/form') ?? '', /allow-popups-to-escape-sandbox/);
  assert.doesNotMatch(browserPreviewSandboxForUrl('https://www.example.org/form') ?? '', /allow-top-navigation-by-user-activation/);
  assert.match(browserPreviewSandboxForUrl('https://www.example.org/form') ?? '', /allow-storage-access-by-user-activation/);
  assert.match(commands[0].command, /^\/browser open "\/api\/sciforge\/browser\/pdf-viewer\?url=https%3A%2F%2Farxiv\.org%2Fpdf%2F2605\.00080v1" --surface workbench --browser chrome --source-url "https:\/\/arxiv\.org\/pdf\/2605\.00080v1"$/);
  assert.match(commands[1].command, /--source-url "https:\/\/arxiv\.org\/pdf\/2605\.00080v1"/);
  assert.doesNotMatch(buildBrowserTerminalCommands(`${arxivPdf}about:blank`)[0].command, /about:blank/);
});

test('browser command builders keep GUI input as terminal-equivalent text', () => {
  const commands = buildBrowserTerminalCommands('http://localhost:5173/');
  assert.deepEqual(commands.map((command) => command.label), ['打开页面', '页面快照', '读取页面状态', '滚动页面', '人工接管', '登录/接管', '强制重新加载', '显示设备工具栏', '隐藏编辑器', '清除 Cookie', '清除缓存']);
  assert.match(commands[0].command, /^\/browser open "http:\/\/localhost:5173\/" --surface workbench --browser chrome$/);
  assert.match(commands[1].command, /--screenshot --dom --logs/);
  assert.match(commands[5].command, /\/browser takeover --url "http:\/\/localhost:5173\/" --auth --visible --approval required/);
  assert.match(commands[6].command, /^\/browser reload "http:\/\/localhost:5173\/" --hard --surface workbench --browser chrome$/);
  assert.match(commands[7].command, /\/browser device-toolbar --url "http:\/\/localhost:5173\/" --toggle/);
  assert.match(commands[9].command, /\/browser storage clear --url "http:\/\/localhost:5173\/" --cookies/);
  assert.match(commands[10].command, /\/browser storage clear --url "http:\/\/localhost:5173\/" --cache/);

  const authCommands = buildBrowserTerminalCommands('https://example.org/login');
  assert.equal(authCommands[5].command, '/browser takeover --url "https://example.org/login" --auth --visible --approval required --surface workbench --browser chrome');

  const annotationCommand = buildBrowserAnnotationCommand({
    url: 'http://localhost:5173/',
    comment: '按钮溢出，请修复。',
    target: {
      kind: 'region',
      stableRef: {
        schemaVersion: 'sciforge.browser-runtime.stable-ref.v1',
        primary: '[data-testid="submit"]',
        resolveStrategy: 'exact',
        signals: {
          selector: '[data-testid="submit"]',
          domPath: 'main > button',
          bbox: { x: 10, y: 20, width: 300, height: 44 },
        },
      },
      rect: { x: 10, y: 20, width: 300, height: 44 },
    },
  });
  assert.match(annotationCommand, /^\/browser annotate /);
  assert.match(annotationCommand, /--stable-ref "\[data-testid=\\"submit\\"\]"/);
  assert.match(annotationCommand, /--snapshot --dom --refs-first/);
});

test('browser feedback commands make screenshot and annotation bundles actionable', () => {
  const submitCommand = buildBrowserFeedbackSubmitCommand({
    id: 'browser-feedback-1',
    kind: 'annotation',
    url: 'http://localhost:5173/',
    comment: '登录按钮点击后没有弹窗。',
    summary: '登录按钮没有反应',
    target: {
      kind: 'element',
      selector: '#login',
      rect: { x: 10, y: 20, width: 80, height: 32 },
    },
  });
  const repairCommand = buildBrowserFeedbackRepairCommand('feedback-1');

  assert.match(submitCommand, /^\/feedback submit /);
  assert.match(submitCommand, /--source browser/);
  assert.match(submitCommand, /--kind "annotation"/);
  assert.match(submitCommand, /--selector "#login"/);
  assert.match(submitCommand, /--refs-first/);
  assert.equal(repairCommand, '/feedback repair --feedback-id "feedback-1" --source browser --refs-first --approval required');
});
