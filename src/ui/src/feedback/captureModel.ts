import type {
  FeedbackScreenshotEvidence,
  FeedbackRuntimeSnapshot,
  FeedbackTargetSnapshot,
  SciForgeReference,
  SciForgeSession,
  ScenarioInstanceId,
} from '../domain';
import type { PageId } from '../data';

export function buildFeedbackRuntimeSnapshot({
  page,
  scenarioId,
  session,
  url,
  appVersion,
}: {
  page: PageId;
  scenarioId: ScenarioInstanceId;
  session: SciForgeSession;
  url: string;
  appVersion: string;
}): FeedbackRuntimeSnapshot {
  const activeRun = session.runs.at(-1);
  return {
    page,
    url,
    scenarioId,
    sessionId: session.sessionId,
    activeRunId: activeRun?.id,
    sessionTitle: session.title,
    messageCount: session.messages.length,
    artifactSummary: session.artifacts.slice(0, 12).map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      title: typeof artifact.metadata?.title === 'string' ? artifact.metadata.title : undefined,
    })),
    executionSummary: session.executionUnits.slice(0, 12).map((unit) => ({
      id: unit.id,
      tool: unit.tool,
      status: unit.status,
    })),
    uiManifest: session.uiManifest.map((slot) => slot.componentId),
    appVersion,
  };
}

export function buildFeedbackTargetSnapshot(element: Element): FeedbackTargetSnapshot {
  const rect = element.getBoundingClientRect();
  const htmlElement = element as HTMLElement;
  return {
    selector: cssSelectorForElement(element),
    path: elementPath(element),
    text: compactFeedbackText(htmlElement.innerText || element.textContent || ''),
    tagName: element.tagName.toLowerCase(),
    role: element.getAttribute('role') || undefined,
    ariaLabel: element.getAttribute('aria-label') || htmlElement.title || undefined,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
  };
}

export async function captureFeedbackScreenshotEvidence(
  target: FeedbackTargetSnapshot,
  capturedAt: string,
): Promise<FeedbackScreenshotEvidence | undefined> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-feedback-control="true"]'));
  const previousVisibility = controls.map((element) => element.style.visibility);
  controls.forEach((element) => {
    element.style.visibility = 'hidden';
  });
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#0a0f1a',
      logging: false,
      scale: 0.55,
      width: window.innerWidth,
      height: window.innerHeight,
      x: window.scrollX,
      y: window.scrollY,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      ignoreElements: (element) => element instanceof HTMLElement && element.dataset.feedbackControl === 'true',
    });
    const annotated = annotateFeedbackCanvas(canvas, target.rect);
    return {
      schemaVersion: 1,
      dataUrl: annotated.toDataURL('image/jpeg', 0.48),
      mediaType: 'image/jpeg',
      width: annotated.width,
      height: annotated.height,
      capturedAt,
      targetRect: { ...target.rect },
      includeForAgent: false,
      note: 'Screenshot evidence is stored for human review; include it in agent context only when visual reasoning is necessary.',
    };
  } catch {
    return undefined;
  } finally {
    controls.forEach((element, index) => {
      element.style.visibility = previousVisibility[index] ?? '';
    });
  }
}

export function compactSelectedText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 2400 ? `${normalized.slice(0, 2400)}...` : normalized;
}

export function sciForgeReferenceFromElement(element: Element): SciForgeReference | undefined {
  const referenceElement = element.closest<HTMLElement>('[data-sciforge-reference]');
  const raw = referenceElement?.dataset.sciforgeReference;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SciForgeReference>;
    if (!parsed.id || !parsed.kind || !parsed.title || !parsed.ref) return undefined;
    return parsed as SciForgeReference;
  } catch {
    return undefined;
  }
}

export function referenceForFeedbackTarget(target: FeedbackTargetSnapshot, selectedText: string, mode: 'object' | 'selection'): SciForgeReference {
  const sourceRef = `ui:${target.selector}`;
  if (mode === 'selection' && selectedText) {
    const textHash = feedbackHash(`${sourceRef}:${selectedText}`);
    return {
      id: `ref-context-text-${textHash}`,
      kind: 'ui',
      title: `选中内容 · ${selectedText.slice(0, 28)}`,
      ref: `ui-text:${sourceRef}#${textHash}`,
      summary: selectedText,
      locator: {
        textRange: selectedText.slice(0, 160),
        region: sourceRef,
      },
      payload: {
        selectedText,
        sourceTitle: target.text || target.ariaLabel || target.tagName,
        sourceRef,
        sourceKind: 'ui',
        composerMarkerHint: 'selection',
      },
    };
  }
  return {
    id: `ref-context-ui-${feedbackHash(sourceRef)}`,
    kind: 'ui',
    title: target.text || target.ariaLabel || `${target.tagName} 对象`,
    ref: sourceRef,
    summary: target.text || target.ariaLabel || target.path,
    payload: {
      tagName: target.tagName,
      ariaLabel: target.ariaLabel,
      selector: target.selector,
      path: target.path,
      textPreview: target.text,
      composerMarkerHint: 'object',
    },
  };
}

function feedbackHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function cssSelectorForElement(element: Element) {
  if (element.id) return `#${CSS.escape(element.id)}`;
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const classNames = Array.from(current.classList).filter((name) => !/^active|selected|hover/.test(name)).slice(0, 2);
    if (classNames.length) part += classNames.map((name) => `.${CSS.escape(name)}`).join('');
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children) as Element[];
      const sameTagSiblings = siblings.filter((child) => child.tagName === current?.tagName);
      if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(' > ');
}

function elementPath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
    parts.unshift(current.tagName.toLowerCase());
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function compactFeedbackText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function annotateFeedbackCanvas(source: HTMLCanvasElement, rect: FeedbackTargetSnapshot['rect']) {
  const maxWidth = 760;
  const scale = Math.min(1, maxWidth / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const captureScaleX = source.width / window.innerWidth;
  const captureScaleY = source.height / window.innerHeight;
  const x = rect.x * captureScaleX * scale;
  const y = rect.y * captureScaleY * scale;
  const width = Math.max(10, rect.width * captureScaleX * scale);
  const height = Math.max(10, rect.height * captureScaleY * scale);
  context.save();
  context.fillStyle = 'rgba(0, 229, 160, 0.12)';
  context.strokeStyle = '#00e5a0';
  context.lineWidth = Math.max(3, 3 * scale);
  context.shadowColor = 'rgba(0, 229, 160, 0.8)';
  context.shadowBlur = 14;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
  context.restore();
  return canvas;
}
