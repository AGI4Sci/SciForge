import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Eye,
  Globe2,
  Minus,
  MoreVertical,
  PencilLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react';
import {
  browserRuntimeCommandRisk,
  buildBrowserRuntimeStableRef,
  type BrowserRuntimeStableRef,
} from '@sciforge-observe/web/browser-runtime';
import { Badge, Button, Input, SectionHeader, cx } from './uiPrimitives';

const DEFAULT_BROWSER_URL = 'about:blank';
const BROWSER_START_PAGE_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; font: 14px system-ui, sans-serif; color: #dbeafe; background: #07111f; }
      main { display: grid; place-items: center; min-height: 100vh; padding: 32px; box-sizing: border-box; }
      section { max-width: 680px; padding: 28px; border: 1px solid rgba(0,229,160,.26); border-radius: 12px; background: rgba(15,23,42,.78); }
      h1 { margin: 0 0 10px; font-size: 24px; }
      p { margin: 0; line-height: 1.6; color: #93a4b8; }
      code { color: #00e5a0; }
    </style>
  </head>
  <body>
    <main>
      <section>
        <h1>SciForge 内置浏览器</h1>
        <p>输入本地开发地址、公开网页或 PDF 链接。PDF 会通过同源代理在工作台内预览，并可下载为 refs-first 证据。</p>
      </section>
    </main>
  </body>
</html>`;

export const BROWSER_SCREENSHOT_CLIPBOARD_NOTICE = '截图已保存到剪贴板';
export const BROWSER_SCREENSHOT_FALLBACK_NOTICE_PREFIX = '截图无法保存到剪贴板';

export interface BrowserWorkbenchAnnotation {
  id: string;
  url: string;
  comment: string;
  createdAt: string;
  target: {
    kind: 'element' | 'region';
    selector?: string;
    stableRef?: BrowserRuntimeStableRef;
    text?: string;
    tagName?: string;
    role?: string;
    rect: BrowserWorkbenchRect;
  };
  terminalCommand: string;
}

export interface BrowserWorkbenchFeedbackBundle {
  id: string;
  kind: 'screenshot' | 'annotation';
  url: string;
  comment: string;
  summary: string;
  createdAt: string;
  target?: BrowserWorkbenchAnnotation['target'];
  submitCommand: string;
  repairCommand?: string;
  status: 'draft' | 'submitted' | 'repair-requested';
  feedbackId?: string;
}

export interface BrowserWorkbenchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrowserRuntimePageProps {
  onFeedbackSubmit?: (bundle: BrowserWorkbenchFeedbackBundle) => string | undefined;
  onFeedbackRepairRequest?: (input: { feedbackId: string; bundle: BrowserWorkbenchFeedbackBundle }) => void;
  onOpenFeedbackInbox?: () => void;
}

interface BrowserDragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface SameOriginInspection {
  selector?: string;
  text?: string;
  tagName?: string;
  role?: string;
  title?: string;
  visibleText?: string;
  links: Array<{ text: string; href: string }>;
  controls: Array<{ role: string; label: string; selector?: string }>;
  assets: Array<{ kind: 'image' | 'stylesheet' | 'script'; url: string }>;
  error?: string;
}

const runtimeSummaryItems = [
  {
    title: '会话与导航',
    body: '打开、后退、刷新和标签状态归 TUI runtime；GUI 只显示当前页面投影。',
  },
  {
    title: '观察证据',
    body: '截图、DOM、console、network、下载记录都写成 refs，不塞进页面状态。',
  },
  {
    title: '页面操作',
    body: '优先 DOM / Playwright 定位和操作；坐标点击只作为兜底，并必须留下 trace。',
  },
  {
    title: '安全边界',
    body: '读取用户标签、剪贴板、上传、外部提交和真实桌面输入都需要明确确认。',
  },
];

const runtimeRiskExamples = [
  {
    label: '公开页面导航',
    reason: '公开页面的只读或无副作用导航可直接交给浏览器运行时。',
    command: { type: 'tab.navigate' as const, url: 'https://example.org' },
  },
  {
    label: '读取用户浏览器标签',
    reason: '会暴露用户本机浏览器上下文，执行前必须让用户确认。',
    command: { type: 'browser.user.openTabs' as const },
  },
  {
    label: '写剪贴板',
    reason: '会修改用户本机剪贴板，执行前必须让用户确认。',
    command: { type: 'clipboard.write' as const, text: 'draft command' },
  },
  {
    label: '坐标点击',
    reason: '坐标动作可能误点页面或桌面，必须绑定目标并记录 trace。',
    command: { type: 'cua.click' as const, target: 'viewport@400,300' },
  },
];

export function normalizeBrowserWorkbenchUrl(input: string): string {
  const trimmed = cleanBrowserWorkbenchUrlInput(input);
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^(?:https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function cleanBrowserWorkbenchUrlInput(input: string): string {
  const trimmed = input.trim();
  if (/^about:blank$/i.test(trimmed)) return DEFAULT_BROWSER_URL;
  if (/about:blank$/i.test(trimmed)) return trimmed.slice(0, -'about:blank'.length).trim();
  return trimmed;
}

export function shouldProxyBrowserWorkbenchUrl(url: string): boolean {
  const cleanUrl = cleanBrowserWorkbenchUrlInput(url);
  if (!/^https?:\/\//i.test(cleanUrl)) return false;
  return shouldUseBrowserWorkbenchPdfViewerUrl(cleanUrl) || shouldProxyBrowserWorkbenchHtmlUrl(cleanUrl);
}

export function shouldUseBrowserWorkbenchPdfViewerUrl(url: string): boolean {
  const cleanUrl = cleanBrowserWorkbenchUrlInput(url);
  return /^https?:\/\//i.test(cleanUrl) && /(?:\.pdf(?:[?#].*)?$|\/pdf\/|arxiv\.org\/pdf\/)/i.test(cleanUrl);
}

export function shouldProxyBrowserWorkbenchHtmlUrl(url: string): boolean {
  try {
    const target = new URL(cleanBrowserWorkbenchUrlInput(url));
    const host = target.hostname.toLowerCase();
    return (host === 'arxiv.org' || host === 'www.arxiv.org') && /^\/(?:abs|search)\b/.test(target.pathname);
  } catch {
    return false;
  }
}

export function buildBrowserWorkbenchProxyUrl(url: string, options: { download?: boolean } = {}): string {
  const params = new URLSearchParams({ url: cleanBrowserWorkbenchUrlInput(url) });
  if (options.download) params.set('download', '1');
  return `/api/sciforge/browser/proxy?${params.toString()}`;
}

export function buildBrowserWorkbenchPdfViewerUrl(url: string): string {
  const params = new URLSearchParams({ url: cleanBrowserWorkbenchUrlInput(url) });
  return `/api/sciforge/browser/pdf-viewer?${params.toString()}`;
}

export function buildBrowserPreviewUrl(url: string): string {
  const cleanUrl = cleanBrowserWorkbenchUrlInput(url);
  if (shouldUseBrowserWorkbenchPdfViewerUrl(cleanUrl)) return buildBrowserWorkbenchPdfViewerUrl(cleanUrl);
  if (shouldProxyBrowserWorkbenchHtmlUrl(cleanUrl)) return buildBrowserWorkbenchProxyUrl(cleanUrl);
  return cleanUrl;
}

export function browserWorkbenchSourceUrlFromPreviewUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url, 'http://127.0.0.1:5173');
    if (parsed.pathname !== '/api/sciforge/browser/proxy' && parsed.pathname !== '/api/sciforge/browser/pdf-viewer') return undefined;
    const source = parsed.searchParams.get('url');
    return source ? cleanBrowserWorkbenchUrlInput(source) : undefined;
  } catch {
    return undefined;
  }
}

export function browserPreviewSandboxForUrl(url: string): string | undefined {
  if (shouldUseBrowserWorkbenchPdfViewerUrl(url)) return undefined;
  if (shouldProxyBrowserWorkbenchHtmlUrl(url)) return 'allow-downloads allow-forms allow-same-origin';
  return 'allow-downloads allow-forms allow-modals allow-same-origin allow-scripts allow-storage-access-by-user-activation';
}

export function buildBrowserTerminalCommands(url: string) {
  const sourceUrl = cleanBrowserWorkbenchUrlInput(url);
  const safeUrl = JSON.stringify(sourceUrl);
  const browserUrl = buildBrowserPreviewUrl(sourceUrl);
  const safeBrowserUrl = JSON.stringify(browserUrl);
  return [
    { label: '打开页面', command: `/browser open ${safeBrowserUrl} --surface workbench --browser chrome${browserUrl !== sourceUrl ? ` --source-url ${safeUrl}` : ''}` },
    { label: '页面快照', command: `/browser snapshot --url ${safeBrowserUrl} --screenshot --dom --logs${browserUrl !== sourceUrl ? ` --source-url ${safeUrl}` : ''}` },
    { label: '读取页面状态', command: `/browser state --url ${safeBrowserUrl} --dom --ax --console --network${browserUrl !== sourceUrl ? ` --source-url ${safeUrl}` : ''}` },
    { label: '滚动页面', command: `/browser action page.scroll --url ${safeBrowserUrl} --dy 800${browserUrl !== sourceUrl ? ` --source-url ${safeUrl}` : ''}` },
    { label: '人工接管', command: `/browser takeover --url ${safeBrowserUrl}${browserUrl !== sourceUrl ? ` --source-url ${safeUrl}` : ''}` },
    { label: '登录/接管', command: `/browser takeover --url ${safeBrowserUrl} --auth --visible --approval required --surface workbench --browser chrome${browserUrl !== sourceUrl ? ` --source-url ${safeUrl}` : ''}` },
    { label: '强制重新加载', command: `/browser reload ${safeUrl} --hard --surface workbench --browser chrome` },
    { label: '显示设备工具栏', command: `/browser device-toolbar --url ${safeUrl} --toggle --surface workbench --browser chrome` },
    { label: '隐藏编辑器', command: `/browser editor --url ${safeUrl} --hide --surface workbench` },
    { label: '清除 Cookie', command: `/browser storage clear --url ${safeUrl} --cookies --surface workbench --browser chrome` },
    { label: '清除缓存', command: `/browser storage clear --url ${safeUrl} --cache --surface workbench --browser chrome` },
  ];
}

export function buildBrowserAnnotationCommand(annotation: Pick<BrowserWorkbenchAnnotation, 'url' | 'comment' | 'target'>) {
  const target = annotation.target.selector
    ? `--selector ${JSON.stringify(annotation.target.selector)}`
    : annotation.target.stableRef
      ? `--stable-ref ${JSON.stringify(annotation.target.stableRef.primary)}`
    : `--rect ${Math.round(annotation.target.rect.x)},${Math.round(annotation.target.rect.y)},${Math.round(annotation.target.rect.width)},${Math.round(annotation.target.rect.height)}`;
  return `/browser annotate --url ${JSON.stringify(annotation.url)} ${target} --comment ${JSON.stringify(annotation.comment)} --snapshot --dom --refs-first`;
}

export function buildBrowserFeedbackSubmitCommand(bundle: Pick<BrowserWorkbenchFeedbackBundle, 'id' | 'kind' | 'url' | 'comment' | 'summary' | 'target'>) {
  const target = bundle.target?.selector
    ? ` --selector ${JSON.stringify(bundle.target.selector)}`
    : bundle.target?.stableRef
      ? ` --stable-ref ${JSON.stringify(bundle.target.stableRef.primary)}`
      : bundle.target?.rect
        ? ` --rect ${Math.round(bundle.target.rect.x)},${Math.round(bundle.target.rect.y)},${Math.round(bundle.target.rect.width)},${Math.round(bundle.target.rect.height)}`
        : '';
  return `/feedback submit --source browser --bundle-id ${JSON.stringify(bundle.id)} --kind ${JSON.stringify(bundle.kind)} --url ${JSON.stringify(bundle.url)}${target} --summary ${JSON.stringify(bundle.summary)} --comment ${JSON.stringify(bundle.comment)} --refs-first`;
}

export function buildBrowserFeedbackRepairCommand(feedbackId: string) {
  return `/feedback repair --feedback-id ${JSON.stringify(feedbackId)} --source browser --refs-first --approval required`;
}

export function BrowserRuntimePage({ onFeedbackSubmit, onFeedbackRepairRequest, onOpenFeedbackInbox }: BrowserRuntimePageProps = {}) {
  const initialUrl = initialBrowserWorkbenchUrl();
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [history, setHistory] = useState([initialUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [annotationMode, setAnnotationMode] = useState(false);
  const [drag, setDrag] = useState<BrowserDragState | null>(null);
  const [draftRect, setDraftRect] = useState<BrowserWorkbenchRect | null>(null);
  const [draftTarget, setDraftTarget] = useState<SameOriginInspection | null>(null);
  const [comment, setComment] = useState('');
  const [annotations, setAnnotations] = useState<BrowserWorkbenchAnnotation[]>([]);
  const [feedbackBundles, setFeedbackBundles] = useState<BrowserWorkbenchFeedbackBundle[]>([]);
  const [inspection, setInspection] = useState<SameOriginInspection | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const [editorHidden, setEditorHidden] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(100);
  const [deviceToolbarVisible, setDeviceToolbarVisible] = useState(false);
  const [actionNotice, setActionNotice] = useState('');
  const [screenshotToast, setScreenshotToast] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const currentUrl = history[historyIndex] ?? DEFAULT_BROWSER_URL;
  const previewUrl = buildBrowserPreviewUrl(currentUrl);
  const frameSrc = previewUrl;
  const frameSrcDoc = currentUrl === DEFAULT_BROWSER_URL ? BROWSER_START_PAGE_HTML : undefined;
  const downloadUrl = buildBrowserWorkbenchProxyUrl(currentUrl, { download: true });
  const canDownload = /^https?:\/\//i.test(currentUrl);
  const previewSandbox = browserPreviewSandboxForUrl(currentUrl);
  const commandExamples = useMemo(() => buildBrowserTerminalCommands(currentUrl), [currentUrl]);
  const previewViewportStyle = { '--browser-preview-zoom': String(previewZoom / 100) } as CSSProperties;

  useEffect(() => {
    if (!moreMenuOpen) return undefined;

    function closeFromOutside(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!moreMenuRef.current?.contains(target)) {
        setMoreMenuOpen(false);
      }
    }

    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMoreMenuOpen(false);
      }
    }

    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromKeyboard);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromKeyboard);
    };
  }, [moreMenuOpen]);

  function commandByLabel(label: string) {
    return commandExamples.find((example) => example.label === label)?.command ?? commandExamples[0]?.command ?? '';
  }

  async function openUrl(nextUrl = urlInput) {
    const normalized = normalizeBrowserWorkbenchUrl(nextUrl);
    setHistory((existing) => [...existing.slice(0, historyIndex + 1), normalized]);
    setHistoryIndex((index) => index + 1);
    setUrlInput(normalized);
    setStatus('loading');
    setInspection(null);
    setDraftRect(null);
    setDraftTarget(null);
  }

  function syncFrameNavigation() {
    let frameUrl = '';
    try {
      frameUrl = frameRef.current?.contentWindow?.location.href ?? '';
    } catch {
      return;
    }
    const sourceUrl = browserWorkbenchSourceUrlFromPreviewUrl(frameUrl);
    if (!sourceUrl) return;
    const normalized = normalizeBrowserWorkbenchUrl(sourceUrl);
    if (normalized === currentUrl) return;
    setHistory((existing) => [...existing.slice(0, historyIndex + 1), normalized]);
    setHistoryIndex((index) => index + 1);
    setUrlInput(normalized);
    setStatus('ready');
    setInspection(null);
    setDraftRect(null);
    setDraftTarget(null);
    setActionNotice(`已在内置浏览器内跳转到 ${normalized}`);
  }

  function goBack() {
    setHistoryIndex((index) => {
      const nextIndex = Math.max(0, index - 1);
      setUrlInput(history[nextIndex] ?? DEFAULT_BROWSER_URL);
      return nextIndex;
    });
    setStatus('loading');
  }

  function goForward() {
    setHistoryIndex((index) => {
      const nextIndex = Math.min(history.length - 1, index + 1);
      setUrlInput(history[nextIndex] ?? DEFAULT_BROWSER_URL);
      return nextIndex;
    });
    setStatus('loading');
  }

  function reloadFrame() {
    setReloadKey((value) => value + 1);
    setStatus('loading');
  }

  function hardReloadFrame() {
    reloadFrame();
    setMoreMenuOpen(false);
    void copyCommand(commandByLabel('强制重新加载'), '已强制重新加载预览，并复制 runtime 命令');
  }

  function changePreviewZoom(delta: number) {
    setPreviewZoom((value) => Math.min(200, Math.max(50, value + delta)));
    setActionNotice('已调整预览缩放');
  }

  function toggleDeviceToolbar() {
    setDeviceToolbarVisible((value) => !value);
    setMoreMenuOpen(false);
    void copyCommand(commandByLabel('显示设备工具栏'), '已切换设备工具栏，并复制 runtime 命令');
  }

  function hideEditor() {
    setEditorHidden((value) => !value);
    setMoreMenuOpen(false);
    void copyCommand(commandByLabel('隐藏编辑器'), editorHidden ? '已显示检查器' : '已隐藏检查器，并复制 runtime 命令');
  }

  function requestRuntimeCommand(label: string, notice: string) {
    setMoreMenuOpen(false);
    void copyCommand(commandByLabel(label), notice);
  }

  function requestAuthTakeover() {
    requestRuntimeCommand('登录/接管', '已复制通用登录/接管命令；账号态、验证码和 Cookie 由 TUI browser runtime 显式确认后处理');
  }

  function startAnnotation(event: ReactMouseEvent<HTMLDivElement>) {
    if (!annotationMode) return;
    const point = localPoint(event);
    setDrag({ startX: point.x, startY: point.y, currentX: point.x, currentY: point.y });
    setDraftRect(null);
    setDraftTarget(null);
  }

  function updateAnnotation(event: ReactMouseEvent<HTMLDivElement>) {
    if (!annotationMode || !drag) return;
    const point = localPoint(event);
    setDrag({ ...drag, currentX: point.x, currentY: point.y });
  }

  function finishAnnotation(event: ReactMouseEvent<HTMLDivElement>) {
    if (!annotationMode || !drag) return;
    const point = localPoint(event);
    const rect = normalizeRect({ ...drag, currentX: point.x, currentY: point.y });
    setDrag(null);
    setDraftRect(rect);
    setDraftTarget(inspectFrameAt(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }

  function saveAnnotation() {
    if (!draftRect || !comment.trim()) return;
    const target: BrowserWorkbenchAnnotation['target'] = {
      kind: draftTarget?.selector ? 'element' : 'region',
      selector: draftTarget?.selector,
      stableRef: buildBrowserRuntimeStableRef({
        selector: draftTarget?.selector,
        domPath: draftTarget?.selector ?? `viewport-region@${Math.round(draftRect.x)},${Math.round(draftRect.y)}`,
        role: draftTarget?.role,
        accessibleName: draftTarget?.text,
        text: draftTarget?.text,
        bbox: draftRect,
      }),
      text: draftTarget?.text,
      tagName: draftTarget?.tagName,
      role: draftTarget?.role,
      rect: draftRect,
    };
    const next: BrowserWorkbenchAnnotation = {
      id: `browser-annotation-${Date.now().toString(36)}`,
      url: currentUrl,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
      target,
      terminalCommand: buildBrowserAnnotationCommand({ url: currentUrl, comment: comment.trim(), target }),
    };
    const bundle = buildFeedbackBundleFromAnnotation(next);
    setAnnotations((items) => [next, ...items]);
    setFeedbackBundles((items) => [bundle, ...items]);
    setComment('');
    setDraftRect(null);
    setDraftTarget(null);
    setActionNotice('标注已保存，并生成反馈 bundle。可在右侧“反馈与修复”提交到收件箱；修复由收件箱确认后派发。');
  }

  function inspectVisibleState() {
    setInspection(inspectFrameDocument());
  }

  async function copyCommand(command: string, notice = '已复制终端等价命令') {
    await copyTextToClipboard(command);
    setCopyNotice(notice);
    setActionNotice(notice);
    window.setTimeout(() => setCopyNotice(''), 1800);
    window.setTimeout(() => setActionNotice(''), 2400);
  }

  function localPoint(event: ReactMouseEvent<HTMLDivElement>) {
    const rect = viewportRef.current?.getBoundingClientRect();
    return {
      x: Math.max(0, event.clientX - (rect?.left ?? 0)),
      y: Math.max(0, event.clientY - (rect?.top ?? 0)),
    };
  }

  function inspectFrameAt(x: number, y: number): SameOriginInspection | null {
    try {
      const frame = frameRef.current;
      const doc = frame?.contentDocument;
      if (!doc) return { links: [], controls: [], assets: [], error: '当前页面不可被 GUI 直接读取；请使用页面快照命令生成 refs-first 证据。' };
      const element = doc.elementFromPoint(x, y) as HTMLElement | null;
      if (!element) return { links: [], controls: [], assets: [], error: '未命中可读元素。' };
      return {
        selector: cssSelectorForFrameElement(element),
        text: compactText(element.innerText || element.textContent || ''),
        tagName: element.tagName.toLowerCase(),
        role: element.getAttribute('role') || implicitFrameRole(element),
        links: [],
        controls: [],
        assets: [],
      };
    } catch {
      return { links: [], controls: [], assets: [], error: '跨域页面不能由 GUI 直接读取 DOM；请使用页面快照命令生成 DOM/screenshot refs。' };
    }
  }

  async function createScreenshotFeedbackBundle() {
    const screenshotResult = await captureAndCopyBrowserScreenshot();
    const now = new Date().toISOString();
    const id = `browser-feedback-${Date.now().toString(36)}`;
    const bundle: BrowserWorkbenchFeedbackBundle = {
      id,
      kind: 'screenshot',
      url: currentUrl,
      comment: '请基于当前浏览器页面截图和页面状态检查问题，并给出可修复的修改建议。',
      summary: `截图反馈：${currentUrl}`,
      createdAt: now,
      submitCommand: '',
      status: 'draft',
    };
    const withCommand = {
      ...bundle,
      submitCommand: buildBrowserFeedbackSubmitCommand(bundle),
    };
    setFeedbackBundles((items) => [withCommand, ...items]);
    if (screenshotResult.ok) {
      showScreenshotToast(BROWSER_SCREENSHOT_CLIPBOARD_NOTICE);
      return;
    }
    showScreenshotToast(`${BROWSER_SCREENSHOT_FALLBACK_NOTICE_PREFIX}`);
    void copyCommand(
      commandByLabel('页面快照'),
      `${BROWSER_SCREENSHOT_FALLBACK_NOTICE_PREFIX}：${screenshotResult.reason}；已复制页面快照命令`,
    );
  }

  function showScreenshotToast(message: string) {
    setScreenshotToast(message);
    window.setTimeout(() => setScreenshotToast(''), 4200);
  }

  async function captureAndCopyBrowserScreenshot(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const dataUrl = await captureIframeScreenshotDataUrl();
      await copyImageDataUrlToClipboard(dataUrl);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: compactText(error instanceof Error ? error.message : String(error), 120) || 'unknown' };
    }
  }

  async function captureIframeScreenshotDataUrl(): Promise<string> {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!doc || !win) {
      throw new Error('当前页面是跨域 iframe、PDF 或浏览器沙箱内容，网页端不能直接读取像素');
    }
    const { default: html2canvas } = await import('html2canvas');
    const viewportWidth = Math.max(1, Math.round(win.innerWidth || frame.clientWidth || 1));
    const viewportHeight = Math.max(1, Math.round(win.innerHeight || frame.clientHeight || 1));
    const canvas = await html2canvas(doc.documentElement, {
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      windowWidth: Math.max(viewportWidth, doc.documentElement.scrollWidth),
      windowHeight: Math.max(viewportHeight, doc.documentElement.scrollHeight),
      x: Math.max(0, Math.round(win.scrollX || 0)),
      y: Math.max(0, Math.round(win.scrollY || 0)),
      width: viewportWidth,
      height: viewportHeight,
    });
    return canvas.toDataURL('image/png');
  }

  function submitFeedbackBundle(bundleId: string) {
    const bundle = feedbackBundles.find((item) => item.id === bundleId);
    if (!bundle) return undefined;
    if (bundle.feedbackId) return bundle.feedbackId;
    const feedbackId = onFeedbackSubmit?.(bundle);
    setFeedbackBundles((items) => items.map((item) => item.id === bundleId
      ? {
        ...item,
        status: feedbackId ? 'submitted' : item.status,
        feedbackId,
        repairCommand: feedbackId ? buildBrowserFeedbackRepairCommand(feedbackId) : item.repairCommand,
      }
      : item));
    setActionNotice(feedbackId
      ? `已提交到反馈收件箱：${feedbackId}`
      : '当前运行环境没有连接反馈收件箱；已保留本地反馈 bundle，可复制命令手动提交。');
    return feedbackId;
  }

  function requestFeedbackRepair(bundleId: string) {
    const bundle = feedbackBundles.find((item) => item.id === bundleId);
    if (!bundle) return;
    const feedbackId = bundle.feedbackId ?? submitFeedbackBundle(bundleId);
    if (!feedbackId) {
      void copyCommand(bundle.submitCommand, '未连接反馈收件箱；已复制反馈提交命令');
      return;
    }
    const repairCommand = buildBrowserFeedbackRepairCommand(feedbackId);
    setFeedbackBundles((items) => items.map((item) => item.id === bundleId
      ? { ...item, status: 'repair-requested', feedbackId, repairCommand }
      : item));
    onFeedbackRepairRequest?.({ feedbackId, bundle: { ...bundle, feedbackId, repairCommand, status: 'repair-requested' } });
    onOpenFeedbackInbox?.();
    void copyCommand(repairCommand, `已进入反馈收件箱确认修复：${feedbackId}`);
  }

  function buildFeedbackBundleFromAnnotation(annotation: BrowserWorkbenchAnnotation): BrowserWorkbenchFeedbackBundle {
    const bundle: BrowserWorkbenchFeedbackBundle = {
      id: `browser-feedback-${Date.now().toString(36)}`,
      kind: 'annotation',
      url: annotation.url,
      comment: annotation.comment,
      summary: `页面标注：${annotation.comment.slice(0, 80)}`,
      createdAt: annotation.createdAt,
      target: annotation.target,
      submitCommand: '',
      status: 'draft',
    };
    return {
      ...bundle,
      submitCommand: buildBrowserFeedbackSubmitCommand(bundle),
    };
  }

  function inspectFrameDocument(): SameOriginInspection {
    try {
      const frame = frameRef.current;
      const doc = frame?.contentDocument;
      if (!doc) throw new Error('frame document unavailable');
      const links = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]')).slice(0, 12).map((link) => ({
        text: compactText(link.innerText || link.textContent || link.href),
        href: link.href,
      }));
      const controls = Array.from(doc.querySelectorAll<HTMLElement>('button, input, textarea, select, [role="button"], [role="link"], a[href]'))
        .slice(0, 16)
        .map((element) => ({
          role: element.getAttribute('role') || implicitFrameRole(element) || element.tagName.toLowerCase(),
          label: compactText(element.getAttribute('aria-label') || element.innerText || element.textContent || element.getAttribute('placeholder') || element.getAttribute('value') || ''),
          selector: cssSelectorForFrameElement(element),
        }));
      const assets = [
        ...Array.from(doc.querySelectorAll<HTMLImageElement>('img[src]')).slice(0, 8).map((asset) => ({ kind: 'image' as const, url: asset.src })),
        ...Array.from(doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]')).slice(0, 8).map((asset) => ({ kind: 'stylesheet' as const, url: asset.href })),
        ...Array.from(doc.querySelectorAll<HTMLScriptElement>('script[src]')).slice(0, 8).map((asset) => ({ kind: 'script' as const, url: asset.src })),
      ];
      return {
        title: doc.title,
        visibleText: compactText(doc.body?.innerText ?? ''),
        links,
        controls,
        assets,
      };
    } catch {
      return {
        links: [],
        controls: [],
        assets: [],
        error: '当前页面是跨域、PDF 或 sandboxed 内容；GUI 不能直接读取 DOM。请使用页面快照命令让 browser_runtime 产出 DOM、AX、console、network 和 screenshot refs。',
      };
    }
  }

  const activeRect = drag ? normalizeRect(drag) : draftRect;

  return (
    <main className="browser-runtime-page" aria-label="SciForge 内置浏览器运行时">
      <SectionHeader
        icon={Globe2}
        title="内置浏览器"
        subtitle="页面在工作台内预览；PDF 等被站点 frame policy 阻断的资源会通过同源代理打开，并保留下载入口。"
      />

      <section className="browser-workbench browser-workbench-pro" aria-label="内置浏览器工作台">
        <div className="browser-framebar">
          <div className="browser-window-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div className="browser-nav-actions" aria-label="浏览器导航">
            <button type="button" onClick={goBack} disabled={historyIndex === 0} aria-label="后退"><ArrowLeft size={15} /></button>
            <button type="button" onClick={goForward} disabled={historyIndex >= history.length - 1} aria-label="前进"><ArrowRight size={15} /></button>
            <button type="button" onClick={reloadFrame} aria-label="刷新"><RefreshCw size={15} /></button>
          </div>
          <form
            className="browser-url-form"
            onSubmit={(event) => {
              event.preventDefault();
              void openUrl();
            }}
          >
            <Input aria-label="浏览器地址" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="localhost:5173 或 https://example.com" />
            <Button type="submit" variant="primary">打开</Button>
            <a
              className={cx('browser-download-link', !canDownload && 'disabled')}
              href={canDownload ? downloadUrl : undefined}
              aria-disabled={!canDownload}
              onClick={(event) => {
                if (!canDownload) event.preventDefault();
              }}
            >
              下载
            </a>
          </form>
          <div className="browser-status-cluster" aria-live="polite">
            <Badge variant={status === 'ready' ? 'success' : status === 'failed' ? 'warning' : 'muted'}>{status}</Badge>
            <span>{currentUrl}</span>
          </div>
          <div className="browser-workbench-actions">
            <Button type="button" variant="secondary" onClick={requestAuthTakeover} aria-label="登录或人工接管">
              登录/接管
            </Button>
            <Button type="button" variant="secondary" onClick={createScreenshotFeedbackBundle} aria-label="截图">
              <Camera size={14} />
              截图
            </Button>
            <Button type="button" variant="secondary" onClick={inspectVisibleState} aria-label="读取状态">状态</Button>
            <Button type="button" variant={annotationMode ? 'primary' : 'secondary'} onClick={() => setAnnotationMode((value) => !value)} aria-label="注释">
              {annotationMode ? '退出' : '注释'}
            </Button>
            <div className="browser-more-menu" ref={moreMenuRef}>
              <button
                type="button"
                aria-label="更多浏览器操作"
                aria-controls="browser-more-menu-popover"
                aria-expanded={moreMenuOpen}
                title={moreMenuOpen ? '收起设置' : '打开设置'}
                onClick={() => setMoreMenuOpen((value) => !value)}
              >
                <MoreVertical size={16} />
              </button>
              <div id="browser-more-menu-popover" className="browser-more-menu-popover" role="menu" hidden={!moreMenuOpen}>
                <div className="browser-more-menu-head">
                  <strong>浏览器设置</strong>
                  <button type="button" aria-label="收起设置" onClick={() => setMoreMenuOpen(false)}>
                    收起
                  </button>
                </div>
                <button type="button" role="menuitem" onClick={hardReloadFrame}>
                  <RefreshCw size={14} />
                  <span>强制重新加载</span>
                </button>
                <button type="button" role="menuitem" onClick={toggleDeviceToolbar}>
                  <span>显示设备工具栏</span>
                </button>
                <button type="button" role="menuitem" onClick={hideEditor}>
                  <span>{editorHidden ? '显示编辑器' : '隐藏编辑器'}</span>
                </button>
                <div className="browser-zoom-row" aria-label="缩放" role="group">
                  <span>缩放</span>
                  <button type="button" onClick={() => changePreviewZoom(-10)} aria-label="缩小">
                    <Minus size={14} />
                  </button>
                  <strong>{previewZoom}%</strong>
                  <button type="button" onClick={() => changePreviewZoom(10)} aria-label="放大">
                    <Plus size={14} />
                  </button>
                  <button type="button" onClick={() => setPreviewZoom(100)} aria-label="重置缩放">
                    <RefreshCw size={13} />
                  </button>
                </div>
                <button type="button" role="menuitem" onClick={() => requestRuntimeCommand('清除 Cookie', '已准备清除 Cookie 命令；真实 Cookie 由 browser runtime 清理')}>
                  <span>清除 Cookie</span>
                </button>
                <button type="button" role="menuitem" onClick={() => requestRuntimeCommand('清除缓存', '已准备清除缓存命令；真实缓存由 browser runtime 清理')}>
                  <span>清除缓存</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        {actionNotice ? (
          <div className="browser-action-notice" role="status">
            {actionNotice}
          </div>
        ) : null}
        {screenshotToast ? (
          <div className="browser-screenshot-toast" role="status" aria-live="polite">
            <span aria-hidden="true">✓</span>
            {screenshotToast}
            <button type="button" onClick={() => setScreenshotToast('')} aria-label="关闭截图提示">×</button>
          </div>
        ) : null}
        {deviceToolbarVisible ? (
          <div className="browser-device-toolbar" aria-label="设备工具栏">
            <span>设备工具栏</span>
            <button type="button" onClick={() => setPreviewZoom(75)}>移动端预览</button>
            <button type="button" onClick={() => setPreviewZoom(100)}>桌面预览</button>
            <button type="button" onClick={() => setDeviceToolbarVisible(false)}>关闭</button>
          </div>
        ) : null}

        <div className={cx('browser-workbench-body browser-canvas-layout', editorHidden && 'editor-hidden')}>
          <div className="browser-viewport-stage">
            <div className="browser-preview-shell">
              <div className="browser-preview-status" aria-live="polite">
                <Badge variant={annotationMode ? 'success' : shouldProxyBrowserWorkbenchUrl(currentUrl) ? 'success' : 'muted'}>{annotationMode ? '标注中' : shouldProxyBrowserWorkbenchUrl(currentUrl) ? '同源代理' : 'preview'}</Badge>
                <span>{annotationMode ? '拖拽页面区域即可创建 refs-first 标注' : shouldProxyBrowserWorkbenchUrl(currentUrl) ? 'PDF/受限资源通过 SciForge 代理内嵌预览' : '内置浏览器预览'}</span>
              </div>
              <div
                ref={viewportRef}
                className={cx('browser-preview-viewport', annotationMode && 'annotating')}
                style={previewViewportStyle}
                onMouseDown={startAnnotation}
                onMouseMove={updateAnnotation}
                onMouseUp={finishAnnotation}
              >
                <iframe
                  key={`${currentUrl}:${reloadKey}`}
                  ref={frameRef}
                  title="SciForge embedded browser preview"
                  src={frameSrc}
                  srcDoc={frameSrcDoc}
                  allow="clipboard-read; clipboard-write; fullscreen; storage-access"
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox={previewSandbox}
                  onLoad={() => {
                    setStatus('ready');
                    syncFrameNavigation();
                  }}
                  onError={() => setStatus('failed')}
                />
                {annotationMode ? <div className="browser-annotation-capture-layer" aria-label="浏览器标注捕获层" /> : null}
                {activeRect ? <div className="browser-annotation-rect" style={rectStyle(activeRect)} /> : null}
                {annotations.map((annotation, index) => (
                  <div
                    key={annotation.id}
                    className="browser-annotation-pin"
                    style={{ left: annotation.target.rect.x + 6, top: annotation.target.rect.y + 6 }}
                    title={annotation.comment}
                  >
                    {index + 1}
                  </div>
                ))}
              </div>
            </div>
            <div className="browser-annotation-list" aria-label="已保存浏览器标注">
              {annotations.length ? annotations.map((annotation) => (
                <article key={annotation.id}>
                  <Badge variant="muted">{annotation.target.kind}</Badge>
                  <strong>{annotation.comment}</strong>
                  <small>{annotation.target.selector ?? `region ${Math.round(annotation.target.rect.x)},${Math.round(annotation.target.rect.y)}`}</small>
                  <code>{annotation.terminalCommand}</code>
                  <button type="button" onClick={() => void copyCommand(annotation.terminalCommand)}>复制</button>
                </article>
              )) : <p>还没有浏览器标注。标注会记录 URL、区域、selector/text（若同源可读）和 TUI 可执行命令。</p>}
            </div>
          </div>

          <aside className="browser-side-panel browser-inspector" aria-label="浏览器状态和标注">
            <div className="browser-inspector-header">
              <strong>检查器</strong>
              <span>标注 · 状态 · 命令</span>
            </div>
            <div className="browser-side-card">
              <div className="browser-side-card-head">
                <PencilLine size={15} />
                <strong>页面标注</strong>
              </div>
              {draftRect ? (
                <div className="browser-annotation-draft">
                  <Badge variant={draftTarget?.selector ? 'success' : 'muted'}>{draftTarget?.selector ? 'element' : 'region'}</Badge>
                  <span>{draftTarget?.selector ?? `${Math.round(draftRect.width)}x${Math.round(draftRect.height)} region`}</span>
                  {draftTarget?.text ? <small>{draftTarget.text}</small> : null}
                  {draftTarget?.error ? <small>{draftTarget.error}</small> : null}
                  <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="描述这个区域的问题或修改建议..." />
                  <Button type="button" variant="primary" onClick={saveAnnotation} disabled={!comment.trim()}>保存标注</Button>
                </div>
              ) : (
                <p>打开“标注页面”后，在预览区域拖拽选择元素或区域。保存后会生成 refs-first browser feedback bundle 命令。</p>
              )}
            </div>

            <div className="browser-side-card browser-feedback-card">
              <div className="browser-side-card-head">
                <ShieldCheck size={15} />
                <strong>反馈与修复</strong>
              </div>
              {feedbackBundles.length ? (
                <div className="browser-feedback-stack">
                  {feedbackBundles.map((bundle) => (
                    <article key={bundle.id} className="browser-feedback-bundle">
                      <div className="browser-feedback-bundle-head">
                        <Badge variant={bundle.status === 'repair-requested' ? 'success' : bundle.status === 'submitted' ? 'info' : 'muted'}>
                          {bundle.kind === 'screenshot' ? '截图' : '标注'}
                        </Badge>
                        <strong>{bundle.summary}</strong>
                      </div>
                      <small>{bundle.feedbackId ? `收件箱：${bundle.feedbackId}` : '尚未提交到反馈收件箱'}</small>
                      <code>{bundle.submitCommand}</code>
                      <div className="browser-feedback-actions">
                        <button type="button" onClick={() => submitFeedbackBundle(bundle.id)}>
                          提交反馈
                        </button>
                        <button type="button" onClick={() => requestFeedbackRepair(bundle.id)}>
                          去收件箱确认修复
                        </button>
                        <button type="button" onClick={() => void copyCommand(bundle.repairCommand ?? bundle.submitCommand)}>
                          复制命令
                        </button>
                      </div>
                    </article>
                  ))}
                  {onOpenFeedbackInbox ? (
                    <Button type="button" variant="secondary" onClick={onOpenFeedbackInbox}>
                      打开反馈收件箱
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p>截图或标注后会生成可提交反馈。提交后进入 SciForge 反馈收件箱；修复任务需要在收件箱里确认后派发。</p>
              )}
            </div>

            <div className="browser-side-card">
              <div className="browser-side-card-head">
                <Eye size={15} />
                <strong>页面状态</strong>
              </div>
              {inspection ? <BrowserInspectionView inspection={inspection} /> : <p>点击“读取状态”。同源页面可直接读取 DOM 摘要；跨域页面会提示使用 `/browser snapshot`。</p>}
            </div>

            <div className="browser-side-card browser-auth-card">
              <div className="browser-side-card-head">
                <ShieldCheck size={15} />
                <strong>登录与账号态</strong>
              </div>
              <BrowserAuthBoundaryCopy />
            </div>

            <details className="browser-command-details">
              <summary>
                <SquareTerminal size={15} />
                <span>终端命令</span>
              </summary>
              <div className="browser-command-stack">
                {commandExamples.map((example) => (
                  <button key={example.command} type="button" onClick={() => void copyCommand(example.command)}>
                    <span>{example.label}</span>
                    <code>{example.command}</code>
                  </button>
                ))}
              </div>
              {copyNotice ? <small className="browser-copy-notice">{copyNotice}</small> : null}
            </details>
          </aside>
        </div>
      </section>

      <details className="browser-runtime-details">
        <summary>
          <ShieldCheck size={16} />
          <span>运行时与安全</span>
        </summary>

        <section className="browser-runtime-hero" aria-label="内置浏览器状态">
          <div>
            <Badge variant="success">运行时</Badge>
            <h3>内置浏览器运行时</h3>
            <p>浏览器会话、页面快照和调试证据由 TUI/Codex runtime 生成 refs；GUI 只负责展示、标注和触发终端等价命令。</p>
          </div>
          <div className="browser-runtime-provider-stack" aria-label="浏览器运行时后台">
            <span>默认后台：Playwright 隔离浏览器</span>
            <span>人工接管：Edge 可见浏览器</span>
          </div>
        </section>

        <section className="browser-runtime-summary-grid" aria-label="内置浏览器运行时摘要">
          {runtimeSummaryItems.map((item) => (
            <article key={item.title} className="browser-runtime-card browser-runtime-summary-card">
              <strong>{item.title}</strong>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <section className="browser-runtime-section" aria-label="安全确认策略">
          <div className="browser-runtime-section-head">
            <ShieldCheck size={16} />
            <div>
              <h3>安全确认</h3>
              <p>只读浏览可以直接执行；会暴露本机状态或产生外部副作用的动作必须确认。</p>
            </div>
          </div>
          <div className="browser-runtime-risk-list">
            {runtimeRiskExamples.map((example) => {
              const risk = browserRuntimeCommandRisk(example.command);
              return (
                <div key={example.label} className={cx('browser-runtime-risk-row', risk.requiresApproval && 'needs-approval')}>
                  <span>{example.label}</span>
                  <Badge variant={risk.requiresApproval ? 'warning' : 'success'}>{risk.requiresApproval ? '需确认' : '允许'}</Badge>
                  <small>{example.reason}</small>
                </div>
              );
            })}
          </div>
        </section>
      </details>
    </main>
  );
}

function initialBrowserWorkbenchUrl() {
  return DEFAULT_BROWSER_URL;
}

function BrowserAuthBoundaryCopy() {
  return <p>涉及密码、二维码、Cookie、验证码或三方授权时，GUI 只准备通用 `/browser takeover --auth --approval required` 命令；具体登录、接管和持久账号态由 TUI browser runtime 在用户确认后执行。</p>;
}

function BrowserInspectionView({ inspection }: { inspection: SameOriginInspection }) {
  if (inspection.error) {
    return (
      <div className="browser-inspection-block warning">
        <Badge variant="warning">cross-origin</Badge>
        <p>{inspection.error}</p>
      </div>
    );
  }
  return (
    <div className="browser-inspection-block">
      {inspection.title ? <strong>{inspection.title}</strong> : null}
      {inspection.visibleText ? <p>{inspection.visibleText}</p> : null}
      <small>{inspection.controls.length} controls · {inspection.links.length} links · {inspection.assets.length} assets</small>
      {inspection.controls.length ? (
        <div className="browser-mini-list">
          {inspection.controls.slice(0, 6).map((item, index) => <code key={`${item.role}:${item.label}:${index}`}>{item.role}: {item.label || item.selector}</code>)}
        </div>
      ) : null}
    </div>
  );
}

function normalizeRect(rect: BrowserDragState): BrowserWorkbenchRect {
  const x = Math.min(rect.startX, rect.currentX);
  const y = Math.min(rect.startY, rect.currentY);
  return {
    x,
    y,
    width: Math.abs(rect.currentX - rect.startX),
    height: Math.abs(rect.currentY - rect.startY),
  };
}

function rectStyle(rect: BrowserWorkbenchRect) {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function compactText(value: string, limit = 280) {
  const compacted = value.replace(/\s+/g, ' ').trim();
  return compacted.length > limit ? `${compacted.slice(0, limit - 1)}…` : compacted;
}

function implicitFrameRole(element: Element) {
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a') return 'link';
  if (tag === 'input' || tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (/^h[1-6]$/.test(tag)) return 'heading';
  return undefined;
}

function cssSelectorForFrameElement(element: Element) {
  if (element.id) return `#${cssEscape(element.id)}`;
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
  if (testId) return `[data-testid="${cssAttrEscape(testId)}"]`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    const tag = current.tagName.toLowerCase();
    const currentElement: Element = current;
    const parent: Element | null = currentElement.parentElement;
    const siblings = parent ? Array.from(parent.children) as Element[] : [];
    const sameTagIndex = parent ? siblings.filter((child) => child.tagName === currentElement.tagName).indexOf(currentElement) + 1 : 1;
    parts.unshift(`${tag}${sameTagIndex > 1 ? `:nth-of-type(${sameTagIndex})` : ''}`);
    current = parent;
  }
  return parts.join(' > ');
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function cssAttrEscape(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Embedded browser previews can deny clipboard; fallback below keeps the UI usable.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function copyImageDataUrlToClipboard(dataUrl: string) {
  const clipboard = navigator.clipboard;
  const ClipboardItemCtor = globalThis.ClipboardItem;
  if (!clipboard?.write || !ClipboardItemCtor) {
    throw new Error('当前浏览器不支持写入图片剪贴板');
  }
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await clipboard.write([
    new ClipboardItemCtor({ [blob.type || 'image/png']: blob }),
  ]);
}
