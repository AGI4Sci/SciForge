import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ArrowLeft,
  Camera,
  Clipboard,
  Code2,
  Compass,
  Eye,
  Globe2,
  ListTree,
  MousePointerClick,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  SquareTerminal,
} from 'lucide-react';
import {
  browserRuntimeCodexFeatureMatrix,
  browserRuntimeCommandRisk,
  buildBrowserRuntimeStableRef,
  type BrowserRuntimeStableRef,
} from '@sciforge-observe/web/browser-runtime';
import browserRuntimeManifest from '@sciforge-observe/web/browser_runtime';
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
        <h1>SciForge Browser Workbench</h1>
        <p>Enter a local dev URL such as <code>localhost:5173</code> or a public URL, then use annotation mode to create refs-first browser feedback.</p>
      </section>
    </main>
  </body>
</html>`;

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

export interface BrowserWorkbenchRect {
  x: number;
  y: number;
  width: number;
  height: number;
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

const capabilityGroups = [
  {
    title: 'Session / Tabs',
    icon: ListTree,
    items: ['session.open', 'session.list', 'tab.new', 'tab.select', 'tab.close', 'browser.list_frames', 'browser.switch_frame'],
  },
  {
    title: 'Navigation',
    icon: Compass,
    items: ['tab.navigate', 'tab.back', 'tab.reload', 'browser.wait_for_idle', 'browser.close'],
  },
  {
    title: 'DOM / Playwright',
    icon: Code2,
    items: ['dom_cua.visible_dom', 'dom_cua.click', 'playwright.locator', 'playwright.evaluate', 'page.click', 'page.type', 'page.scroll'],
  },
  {
    title: 'CUA Fallback',
    icon: MousePointerClick,
    items: ['cua.click', 'cua.double_click', 'cua.drag', 'cua.move', 'cua.scroll', 'cua.type'],
  },
  {
    title: 'Snapshot / Logs',
    icon: Camera,
    items: ['tab.snapshot', 'logs.console', 'logs.network', 'dev.logs', 'browser.get_network_log', 'browser.get_storage'],
  },
  {
    title: 'Clipboard / Safety',
    icon: Clipboard,
    items: ['clipboard.read', 'clipboard.write', 'browser.user.openTabs', 'browser.list_dialogs', 'browser.handle_dialog', 'browser.upload_file', 'browser.emulate_media'],
  },
];

export function normalizeBrowserWorkbenchUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return DEFAULT_BROWSER_URL;
  if (/^(?:https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function buildBrowserTerminalCommands(url: string) {
  const safeUrl = JSON.stringify(url);
  return [
    { label: '打开页面', command: `/browser open ${safeUrl}` },
    { label: '页面快照', command: `/browser snapshot --url ${safeUrl} --screenshot --dom --logs` },
    { label: '读取页面状态', command: `/browser state --url ${safeUrl} --dom --ax --console --network` },
    { label: '滚动页面', command: `/browser action page.scroll --url ${safeUrl} --dy 800` },
    { label: '人工接管', command: `/browser takeover --url ${safeUrl}` },
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

export function BrowserRuntimePage() {
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
  const [inspection, setInspection] = useState<SameOriginInspection | null>(null);
  const [copyNotice, setCopyNotice] = useState('');
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const currentUrl = history[historyIndex] ?? DEFAULT_BROWSER_URL;
  const matrix = browserRuntimeCodexFeatureMatrix();
  const commandExamples = useMemo(() => buildBrowserTerminalCommands(currentUrl), [currentUrl]);

  function openUrl(nextUrl = urlInput) {
    const normalized = normalizeBrowserWorkbenchUrl(nextUrl);
    setHistory((existing) => [...existing.slice(0, historyIndex + 1), normalized]);
    setHistoryIndex((index) => index + 1);
    setUrlInput(normalized);
    setStatus('loading');
    setInspection(null);
    setDraftRect(null);
    setDraftTarget(null);
  }

  function goBack() {
    setHistoryIndex((index) => {
      const nextIndex = Math.max(0, index - 1);
      setUrlInput(history[nextIndex] ?? DEFAULT_BROWSER_URL);
      return nextIndex;
    });
    setStatus('loading');
  }

  function reloadFrame() {
    setReloadKey((value) => value + 1);
    setStatus('loading');
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
    setAnnotations((items) => [next, ...items]);
    setComment('');
    setDraftRect(null);
    setDraftTarget(null);
  }

  function inspectVisibleState() {
    setInspection(inspectFrameDocument());
  }

  async function copyCommand(command: string) {
    await copyTextToClipboard(command);
    setCopyNotice('已复制终端等价命令');
    window.setTimeout(() => setCopyNotice(''), 1800);
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
      if (!doc) return { links: [], controls: [], assets: [], error: '当前页面不可被 GUI 直接读取；将由 /browser snapshot 生成 refs-first 证据。' };
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
      return { links: [], controls: [], assets: [], error: '跨域页面不能由 GUI 读取 DOM；请让 TUI browser runtime 生成 DOM/screenshot refs。' };
    }
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
        error: '当前页面是跨域、file 或 sandboxed 内容；GUI 不能直接读取。请使用页面快照命令让 browser_runtime 产出 DOM、AX、console、network 和 screenshot refs。',
      };
    }
  }

  const activeRect = drag ? normalizeRect(drag) : draftRect;

  return (
    <main className="browser-runtime-page" aria-label="SciForge 内置浏览器运行时">
      <SectionHeader
        icon={Globe2}
        title="内置浏览器"
        subtitle="共享预览、页面标注和 TUI browser runtime 命令在同一个工作台里闭环；GUI 负责呈现和输入，执行仍归 TUI/Codex。"
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
            <button type="button" onClick={reloadFrame} aria-label="刷新"><RefreshCw size={15} /></button>
          </div>
          <form
            className="browser-url-form"
            onSubmit={(event) => {
              event.preventDefault();
              openUrl();
            }}
          >
            <Input aria-label="浏览器地址" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="localhost:5173 或 https://example.com" />
            <Button type="submit" variant="primary">打开</Button>
          </form>
          <div className="browser-status-cluster" aria-live="polite">
            <Badge variant={status === 'ready' ? 'success' : status === 'failed' ? 'warning' : 'muted'}>{status}</Badge>
            <span>{currentUrl}</span>
          </div>
          <div className="browser-workbench-actions">
            <Button type="button" variant="secondary" onClick={inspectVisibleState} aria-label="读取状态">状态</Button>
            <Button type="button" variant={annotationMode ? 'primary' : 'secondary'} onClick={() => setAnnotationMode((value) => !value)}>
              {annotationMode ? '退出' : '标注'}
            </Button>
          </div>
        </div>

        <div className="browser-workbench-body browser-canvas-layout">
          <div className="browser-viewport-stage">
            <div className="browser-preview-shell">
              <div className="browser-preview-status" aria-live="polite">
                <Badge variant={annotationMode ? 'success' : 'muted'}>{annotationMode ? 'annotating' : 'preview'}</Badge>
                <span>{annotationMode ? '拖拽页面区域即可创建 refs-first 标注' : '共享浏览器预览'}</span>
              </div>
              <div
                ref={viewportRef}
                className={cx('browser-preview-viewport', annotationMode && 'annotating')}
                onMouseDown={startAnnotation}
                onMouseMove={updateAnnotation}
                onMouseUp={finishAnnotation}
              >
                <iframe
                  key={`${currentUrl}:${reloadKey}`}
                  ref={frameRef}
                  title="SciForge embedded browser preview"
                  src={currentUrl}
                  srcDoc={currentUrl === 'about:blank' ? BROWSER_START_PAGE_HTML : undefined}
                  sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
                  onLoad={() => setStatus('ready')}
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
              <strong>Inspector</strong>
              <span>Annotations · State · Commands</span>
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

            <div className="browser-side-card">
              <div className="browser-side-card-head">
                <Eye size={15} />
                <strong>页面状态</strong>
              </div>
              {inspection ? <BrowserInspectionView inspection={inspection} /> : <p>点击“读取状态”。同源页面可直接读取 DOM 摘要；跨域页面会提示使用 `/browser snapshot`。</p>}
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
          <span>运行时细节与安全策略</span>
        </summary>

        <section className="browser-runtime-hero" aria-label="内置浏览器状态">
          <div>
            <Badge variant="success">browser_runtime</Badge>
            <h3>{browserRuntimeManifest.name}</h3>
            <p>{browserRuntimeManifest.brief}</p>
          </div>
          <div className="browser-runtime-provider-stack" aria-label="provider stack">
            <span>默认后台</span>
            <strong>playwright_browser_automation</strong>
            <span>人工接管</span>
            <strong>playwright_edge_browser</strong>
          </div>
        </section>

        <section className="browser-runtime-grid" aria-label="Codex 内置浏览器能力对齐">
          {matrix.map((feature) => (
            <article key={feature.codexFeature} className="browser-runtime-card">
              <div className="browser-runtime-card-head">
                <Badge variant="muted">{feature.owner}</Badge>
                <strong>{feature.codexFeature}</strong>
              </div>
              <p>{feature.sciforgeSurface}</p>
              <small>{feature.notes}</small>
            </article>
          ))}
        </section>

        <section className="browser-runtime-capability-groups" aria-label="能力分组">
          {capabilityGroups.map((group) => (
            <article key={group.title} className="browser-runtime-card browser-runtime-group-card">
              <div className="browser-runtime-card-head">
                <group.icon size={16} />
                <strong>{group.title}</strong>
              </div>
              <div className="browser-runtime-chip-list">
                {group.items.map((item) => <span key={item}>{item}</span>)}
              </div>
            </article>
          ))}
        </section>

        <section className="browser-runtime-section" aria-label="安全确认策略">
          <div className="browser-runtime-section-head">
            <ShieldCheck size={16} />
            <div>
              <h3>Safety Gate</h3>
              <p>登录、用户标签、剪贴板、坐标动作、上传/下载/外部提交等动作不能静默执行。</p>
            </div>
          </div>
          <div className="browser-runtime-risk-list">
            {[
              { label: '公开页面导航', command: { type: 'tab.navigate' as const, url: currentUrl } },
              { label: '读取用户浏览器标签', command: { type: 'browser.user.openTabs' as const } },
              { label: '写剪贴板', command: { type: 'clipboard.write' as const, text: 'draft command' } },
              { label: '坐标点击', command: { type: 'cua.click' as const, target: 'viewport@400,300' } },
            ].map((example) => {
              const risk = browserRuntimeCommandRisk(example.command);
              return (
                <div key={example.label} className={cx('browser-runtime-risk-row', risk.requiresApproval && 'needs-approval')}>
                  <span>{example.label}</span>
                  <Badge variant={risk.requiresApproval ? 'warning' : 'success'}>{risk.requiresApproval ? 'needs approval' : 'allowed'}</Badge>
                  <small>{risk.reasons[0] ?? '公开页面的只读/无副作用动作可直接交给后台 browser runtime。'}</small>
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
    const parent = current.parentElement;
    const sameTagIndex = parent ? Array.from(parent.children).filter((child) => child.tagName === current?.tagName).indexOf(current) + 1 : 1;
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
