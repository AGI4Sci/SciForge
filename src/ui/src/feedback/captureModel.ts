import type {
  FeedbackEvidenceStatus,
  FeedbackScreenshotEvidence,
  FeedbackRuntimeSnapshot,
  FeedbackTargetSnapshot,
  SciForgeReference,
  SciForgeSession,
  ScenarioInstanceId,
} from '../domain';
import type { PageId } from '../data';

const FEEDBACK_TEXT_LIMIT = 240;
const SELECTED_TEXT_LIMIT = 2400;
const SCREENSHOT_MAX_WIDTH = 2400;
const SCREENSHOT_MAX_HEIGHT = 10000;
const REDACTED_FEEDBACK_SECRET = '[redacted-feedback-secret]';
const REDACTED_FEEDBACK_PATH = '[redacted-feedback-path]';
const REDACTED_PROVIDER_BODY = '[redacted-provider-body]';

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
    url: scrubFeedbackRefText(url),
    scenarioId,
    sessionId: scrubFeedbackRefText(session.sessionId),
    activeRunId: activeRun?.id ? scrubFeedbackRefText(activeRun.id) : undefined,
    sessionTitle: scrubFeedbackText(session.title),
    messageCount: session.messages.length,
    artifactSummary: session.artifacts.slice(0, 12).map((artifact) => ({
      id: scrubFeedbackRefText(artifact.id),
      type: artifact.type,
      title: typeof artifact.metadata?.title === 'string' ? scrubFeedbackText(artifact.metadata.title) : undefined,
    })),
    executionSummary: session.executionUnits.slice(0, 12).map((unit) => ({
      id: scrubFeedbackRefText(unit.id),
      tool: unit.tool,
      status: unit.status,
    })),
    uiManifest: session.uiManifest.map((slot) => scrubFeedbackRefText(slot.componentId)),
    appVersion,
  };
}

export function buildFeedbackTargetSnapshot(element: Element, commentPoint?: { x: number; y: number }): FeedbackTargetSnapshot {
  const targetElement = feedbackTargetElement(element);
  const rect = targetElement.getBoundingClientRect();
  const htmlElement = targetElement as HTMLElement;
  const selector = cssSelectorForElement(targetElement);
  const text = compactFeedbackText(htmlElement.innerText || targetElement.textContent || '');
  const role = targetElement.getAttribute('role') || implicitRoleForElement(targetElement);
  const label = feedbackLabelForElement(targetElement);
  return {
    selector,
    stableSelector: selector,
    path: elementPath(targetElement),
    domPath: elementPath(targetElement),
    text,
    textSnippet: text,
    tagName: targetElement.tagName.toLowerCase(),
    role,
    label,
    ariaLabel: label,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    commentPoint: commentPoint ? { x: commentPoint.x, y: commentPoint.y } : undefined,
  };
}

export async function captureFeedbackScreenshotEvidence(
  target: FeedbackTargetSnapshot,
  capturedAt: string,
  options: { annotationLabel?: string } = {},
): Promise<FeedbackScreenshotEvidence | undefined> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-feedback-control="true"]'));
  const previousVisibility = controls.map((element) => element.style.visibility);
  controls.forEach((element) => {
    element.style.visibility = 'hidden';
  });
  try {
    const { default: html2canvas } = await import('html2canvas');
    const captureArea = feedbackVisibleViewportCaptureArea();
    const pageTarget = feedbackTargetInViewportCoordinates(target);
    const scale = feedbackScreenshotScale(captureArea.width, captureArea.height, 1);
    const canvas = await html2canvas(document.body, {
      backgroundColor: '#0a0f1a',
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale,
      width: captureArea.width,
      height: captureArea.height,
      x: captureArea.scrollX,
      y: captureArea.scrollY,
      scrollX: -captureArea.scrollX,
      scrollY: -captureArea.scrollY,
      windowWidth: captureArea.width,
      windowHeight: captureArea.height,
      ignoreElements: (element) => element instanceof HTMLElement && element.dataset.feedbackControl === 'true',
    });
    const annotationLabel = scrubFeedbackText(options.annotationLabel ?? '1').slice(0, 12) || '1';
    const rawDataUrl = canvas.toDataURL('image/png');
    const annotated = annotateFeedbackCanvas(canvas, pageTarget.rect, pageTarget.commentPoint, annotationLabel, captureArea);
    const annotatedDataUrl = annotated.toDataURL('image/png');
    return scrubFeedbackScreenshotEvidence({
      schemaVersion: 1,
      captureMode: 'visible-viewport',
      dataUrl: annotatedDataUrl,
      rawDataUrl,
      annotatedDataUrl,
      mediaType: 'image/png',
      width: annotated.width,
      height: annotated.height,
      capturedAt,
      targetRect: { ...pageTarget.rect },
      commentPoint: pageTarget.commentPoint ? { ...pageTarget.commentPoint } : undefined,
      scrollX: captureArea.scrollX,
      scrollY: captureArea.scrollY,
      annotationLabel,
      includeForAgent: false,
      note: `Visible viewport screenshot captured at ${Math.round(captureArea.width)}x${Math.round(captureArea.height)} CSS px, scroll ${Math.round(captureArea.scrollX)},${Math.round(captureArea.scrollY)}; raw and annotated screenshots are stored as local evidence.`,
    });
  } catch {
    return fallbackFeedbackScreenshotEvidence(target, capturedAt, options.annotationLabel);
  } finally {
    controls.forEach((element, index) => {
      element.style.visibility = previousVisibility[index] ?? '';
    });
  }
}

function fallbackFeedbackScreenshotEvidence(
  target: FeedbackTargetSnapshot,
  capturedAt: string,
  annotationLabelInput = '1',
): FeedbackScreenshotEvidence | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const captureArea = feedbackVisibleViewportCaptureArea();
  const pageTarget = feedbackTargetInViewportCoordinates(target);
  const scale = feedbackScreenshotScale(captureArea.width, captureArea.height, 1);
  const width = Math.max(320, Math.round(captureArea.width * scale));
  const height = Math.max(240, Math.round(captureArea.height * scale));
  const raw = document.createElement('canvas');
  raw.width = width;
  raw.height = height;
  const rawContext = raw.getContext('2d');
  if (!rawContext) return undefined;
  drawFallbackViewport(rawContext, { width, height, scale, target: pageTarget, annotated: false, annotationLabel: '' });
  const annotated = document.createElement('canvas');
  annotated.width = width;
  annotated.height = height;
  const annotatedContext = annotated.getContext('2d');
  if (!annotatedContext) return undefined;
  const annotationLabel = scrubFeedbackText(annotationLabelInput).slice(0, 12) || '1';
  drawFallbackViewport(annotatedContext, { width, height, scale, target: pageTarget, annotated: true, annotationLabel });
  const rawDataUrl = raw.toDataURL('image/png');
  const annotatedDataUrl = annotated.toDataURL('image/png');
  return scrubFeedbackScreenshotEvidence({
    schemaVersion: 1,
    captureMode: 'fallback-viewport',
    dataUrl: annotatedDataUrl,
    rawDataUrl,
    annotatedDataUrl,
    mediaType: 'image/png',
    width,
    height,
    capturedAt,
    targetRect: { ...pageTarget.rect },
    commentPoint: pageTarget.commentPoint ? { ...pageTarget.commentPoint } : undefined,
    scrollX: captureArea.scrollX,
    scrollY: captureArea.scrollY,
    annotationLabel,
    includeForAgent: false,
    note: `html2canvas capture failed; generated a scrubbed visible viewport evidence fallback at ${Math.round(captureArea.width)}x${Math.round(captureArea.height)} CSS px, scroll ${Math.round(captureArea.scrollX)},${Math.round(captureArea.scrollY)} with target geometry, URL, and marker.`,
  });
}

function feedbackVisibleViewportCaptureArea() {
  return {
    width: Math.max(320, window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0),
    height: Math.max(240, window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0),
    scrollX: Math.max(0, window.scrollX || window.pageXOffset || 0),
    scrollY: Math.max(0, window.scrollY || window.pageYOffset || 0),
  };
}

function feedbackScreenshotScale(width: number, height: number, preferredScale: number) {
  return Math.max(0.18, Math.min(
    preferredScale,
    SCREENSHOT_MAX_WIDTH / Math.max(1, width),
    SCREENSHOT_MAX_HEIGHT / Math.max(1, height),
  ));
}

function feedbackTargetInViewportCoordinates(target: FeedbackTargetSnapshot): FeedbackTargetSnapshot {
  return {
    ...target,
    rect: { ...target.rect },
    commentPoint: target.commentPoint ? { ...target.commentPoint } : undefined,
  };
}

function drawFallbackViewport(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    scale: number;
    target: FeedbackTargetSnapshot;
    annotated: boolean;
    annotationLabel: string;
  },
) {
  const { width, height, scale, target } = input;
  context.fillStyle = '#0a0f1a';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#101a2c';
  context.fillRect(0, 0, width, 46);
  context.fillStyle = '#e7f5ff';
  context.font = '700 14px system-ui, sans-serif';
  context.fillText('SciForge feedback viewport evidence', 16, 20);
  context.font = '11px system-ui, sans-serif';
  context.fillStyle = '#9fb3c8';
  context.fillText(scrubFeedbackText(window.location.href).slice(0, 120), 16, 38);
  const rect = {
    x: Math.max(0, Math.round(target.rect.x * scale)),
    y: Math.max(0, Math.round(target.rect.y * scale)),
    width: Math.max(2, Math.round(target.rect.width * scale)),
    height: Math.max(2, Math.round(target.rect.height * scale)),
  };
  context.fillStyle = '#132238';
  context.strokeStyle = '#2b4664';
  context.lineWidth = 1;
  context.fillRect(18, 66, Math.max(160, width - 36), Math.min(160, height - 90));
  context.strokeRect(18, 66, Math.max(160, width - 36), Math.min(160, height - 90));
  context.fillStyle = '#d6f7ee';
  context.font = '700 13px system-ui, sans-serif';
  context.fillText(`target: ${scrubFeedbackText(target.role || target.tagName).slice(0, 32)}`, 34, 92);
  context.font = '12px system-ui, sans-serif';
  context.fillStyle = '#b7c7d8';
  wrapCanvasText(context, scrubFeedbackText(target.label || target.text || target.textSnippet || target.selector).slice(0, 240), 34, 116, width - 68, 16, 5);
  context.strokeStyle = input.annotated ? '#ffca57' : '#00e5a0';
  context.lineWidth = input.annotated ? 4 : 2;
  context.strokeRect(rect.x, rect.y, rect.width, rect.height);
  if (input.annotated) {
    const point = target.commentPoint
      ? { x: Math.round(target.commentPoint.x * scale), y: Math.round(target.commentPoint.y * scale) }
      : { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
    context.fillStyle = '#ffca57';
    context.beginPath();
    context.arc(point.x, point.y, 14, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#0a0f1a';
    context.font = '900 13px system-ui, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(input.annotationLabel, point.x, point.y + 0.5);
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
  }
}

function wrapCanvasText(context: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  let line = '';
  let lineCount = 0;
  for (const word of words) {
    const nextLine = line ? `${line} ${word}` : word;
    if (context.measureText(nextLine).width > maxWidth && line) {
      context.fillText(line, x, y + lineCount * lineHeight);
      line = word;
      lineCount += 1;
      if (lineCount >= maxLines) return;
    } else {
      line = nextLine;
    }
  }
  if (line && lineCount < maxLines) context.fillText(line, x, y + lineCount * lineHeight);
}

export function compactSelectedText(text: string) {
  const normalized = scrubFeedbackText(text.replace(/\s+/g, ' ').trim());
  return normalized.length > SELECTED_TEXT_LIMIT ? `${normalized.slice(0, SELECTED_TEXT_LIMIT)}...` : normalized;
}

export function sciForgeReferenceFromElement(element: Element): SciForgeReference | undefined {
  const referenceElement = element.closest<HTMLElement>('[data-sciforge-reference]');
  const raw = referenceElement?.dataset.sciforgeReference;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<SciForgeReference>;
    if (!parsed.id || !parsed.kind || !parsed.title || !parsed.ref) return undefined;
    return scrubSciForgeReference(parsed as SciForgeReference);
  } catch {
    return undefined;
  }
}

export function referenceForFeedbackTarget(target: FeedbackTargetSnapshot, selectedText: string, mode: 'object' | 'selection'): SciForgeReference {
  const sourceRef = scrubFeedbackRefText(`ui:${target.stableSelector || target.selector}`);
  const safeSelectedText = compactSelectedText(selectedText);
  if (mode === 'selection' && safeSelectedText) {
    const textHash = feedbackHash(`${sourceRef}:${safeSelectedText}`);
    return scrubSciForgeReference({
      id: `ref-context-text-${textHash}`,
      kind: 'ui',
      title: `选中内容 · ${safeSelectedText.slice(0, 28)}`,
      ref: `ui-text:${sourceRef}#${textHash}`,
      summary: safeSelectedText,
      locator: {
        textRange: safeSelectedText.slice(0, 160),
        region: sourceRef,
      },
      payload: {
        selectedText: safeSelectedText,
        sourceTitle: target.text || target.ariaLabel || target.tagName,
        sourceRef,
        sourceKind: 'ui',
        composerMarkerHint: 'selection',
      },
    });
  }
  return scrubSciForgeReference({
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
  });
}

export function feedbackEvidenceRefs(feedbackId: string) {
  const safeId = scrubFeedbackIdentifier(feedbackId);
  return {
    evidenceBundleRef: `feedback-bundle:${safeId}`,
    rawScreenshotRef: `feedback-bundle:${safeId}/screenshots/raw.png`,
    annotatedScreenshotRef: `feedback-bundle:${safeId}/screenshots/annotated.png`,
  };
}

export function buildFeedbackEvidenceStatus({
  screenshot,
  target,
  runtime,
  diagnostics = [],
}: {
  screenshot?: FeedbackScreenshotEvidence;
  target?: FeedbackTargetSnapshot;
  runtime?: FeedbackRuntimeSnapshot;
  diagnostics?: string[];
}): FeedbackEvidenceStatus {
  const rawScreenshot = Boolean(screenshot?.rawDataUrl || screenshot?.rawScreenshotRef);
  const annotatedScreenshot = Boolean(screenshot?.annotatedDataUrl || screenshot?.dataUrl || screenshot?.annotatedScreenshotRef);
  const targetSnapshot = Boolean(target?.selector && target?.rect);
  const runtimeSnapshot = Boolean(runtime?.page && runtime?.url);
  const nextDiagnostics = [...diagnostics];
  if (!rawScreenshot) nextDiagnostics.push('raw screenshot unavailable');
  if (!annotatedScreenshot) nextDiagnostics.push('annotated screenshot unavailable');
  if (!targetSnapshot) nextDiagnostics.push('target snapshot unavailable');
  if (!runtimeSnapshot) nextDiagnostics.push('runtime snapshot unavailable');
  const status = rawScreenshot && annotatedScreenshot && targetSnapshot && runtimeSnapshot
    ? 'complete'
    : targetSnapshot || runtimeSnapshot || rawScreenshot || annotatedScreenshot
      ? 'partial'
      : 'missing';
  return {
    status,
    rawScreenshot,
    annotatedScreenshot,
    targetSnapshot,
    runtimeSnapshot,
    scrubbed: true,
    diagnostics: nextDiagnostics.map((item) => scrubFeedbackText(item)).filter(Boolean),
  };
}

export function scrubFeedbackScreenshotEvidence(evidence: FeedbackScreenshotEvidence): FeedbackScreenshotEvidence {
  return {
    ...evidence,
    dataUrl: evidence.dataUrl ? scrubScreenshotDataUrl(evidence.dataUrl) : undefined,
    rawDataUrl: evidence.rawDataUrl ? scrubScreenshotDataUrl(evidence.rawDataUrl) : undefined,
    annotatedDataUrl: evidence.annotatedDataUrl ? scrubScreenshotDataUrl(evidence.annotatedDataUrl) : undefined,
    rawScreenshotRef: evidence.rawScreenshotRef ? scrubFeedbackRefText(evidence.rawScreenshotRef) : undefined,
    annotatedScreenshotRef: evidence.annotatedScreenshotRef ? scrubFeedbackRefText(evidence.annotatedScreenshotRef) : undefined,
    annotationLabel: evidence.annotationLabel ? scrubFeedbackText(evidence.annotationLabel).slice(0, 12) : undefined,
    note: evidence.note ? scrubFeedbackText(evidence.note) : undefined,
  };
}

export function scrubSciForgeReference(reference: SciForgeReference): SciForgeReference {
  return {
    ...reference,
    id: scrubFeedbackIdentifier(reference.id),
    title: scrubFeedbackText(reference.title),
    ref: scrubFeedbackRefText(reference.ref),
    summary: reference.summary ? scrubFeedbackText(reference.summary) : undefined,
    sourceId: reference.sourceId ? scrubFeedbackRefText(reference.sourceId) : undefined,
    runId: reference.runId ? scrubFeedbackRefText(reference.runId) : undefined,
    locator: reference.locator ? scrubFeedbackValue(reference.locator, 'locator') as SciForgeReference['locator'] : undefined,
    payload: reference.payload === undefined ? undefined : scrubFeedbackValue(reference.payload, 'payload'),
  };
}

export function scrubFeedbackText(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (looksLikeRawProviderBody(normalized)) {
    return `${REDACTED_PROVIDER_BODY}:${feedbackHash(normalized)}:${normalized.length}chars`;
  }
  return normalized
    .replace(/\b(?:authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic|token)\s+[^\s"',;)}\]]+/giu, `authorization: ${REDACTED_FEEDBACK_SECRET}`)
    .replace(/\b(api[-_ ]?key|token|secret|password|credential|client_secret)(["'\s]*[:=]\s*["']?)([^"',\s)]+)/giu, `$1$2${REDACTED_FEEDBACK_SECRET}`)
    .replace(/\b(?:sk|pk|ak)-[A-Za-z0-9_-]{12,}\b/giu, REDACTED_FEEDBACK_SECRET)
    .replace(/https?:\/\/[^\s"'<>]*?(?:token|secret|api[_-]?key|authorization|client_secret)[^\s"'<>]*/giu, '[redacted-feedback-url]')
    .replace(/(^|[\s"'(=])\/(?:Users|Applications|private|var|tmp|Volumes)\/[^\s"'<>),;]+/giu, `$1${REDACTED_FEEDBACK_PATH}`)
    .replace(/(^|[\s"'(=])[A-Z]:\\[^\s"'<>),;]+/giu, `$1${REDACTED_FEEDBACK_PATH}`);
}

export function scrubFeedbackRefText(ref: string) {
  return scrubFeedbackText(ref).slice(0, 512);
}

function feedbackHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(36);
}

function feedbackTargetElement(element: Element): Element {
  const interactive = element.closest('button,a,input,select,textarea,summary,[role],[tabindex]');
  if (interactive && !interactive.closest('[data-feedback-control="true"]')) return interactive;
  return element;
}

function cssSelectorForElement(element: Element) {
  const directSelector = stableAttributeSelector(element);
  if (directSelector && selectorIsUnique(directSelector)) return directSelector;
  if (element.id && !looksGeneratedToken(element.id)) {
    const idSelector = `#${cssEscape(element.id)}`;
    if (selectorIsUnique(idSelector)) return scrubFeedbackRefText(idSelector);
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    const stablePart = stableAttributeSelector(current);
    let part = stablePart ?? current.tagName.toLowerCase();
    const classNames = Array.from(current.classList)
      .filter((name) => !/^active|selected|hover/.test(name) && !looksGeneratedToken(name))
      .slice(0, 2);
    if (!stablePart && classNames.length) part += classNames.map((name) => `.${cssEscape(name)}`).join('');
    const parent: Element | null = current.parentElement;
    if (parent && !stablePart) {
      const siblings = Array.from(parent.children) as Element[];
      const sameTagSiblings = siblings.filter((child) => child.tagName === current?.tagName);
      if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    const candidate = scrubFeedbackRefText(parts.join(' > '));
    if (stablePart && selectorIsUnique(candidate)) return candidate;
    current = parent;
  }
  return scrubFeedbackRefText(parts.join(' > '));
}

function elementPath(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
    parts.unshift(scrubFeedbackText(current.tagName.toLowerCase()));
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function compactFeedbackText(text: string) {
  return scrubFeedbackText(text).slice(0, FEEDBACK_TEXT_LIMIT);
}

function annotateFeedbackCanvas(
  source: HTMLCanvasElement,
  rect: FeedbackTargetSnapshot['rect'],
  commentPoint: FeedbackTargetSnapshot['commentPoint'],
  annotationLabel: string,
  captureArea: { width: number; height: number },
) {
  const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const captureScaleX = source.width / Math.max(1, captureArea.width);
  const captureScaleY = source.height / Math.max(1, captureArea.height);
  const x = rect.x * captureScaleX * scale;
  const y = rect.y * captureScaleY * scale;
  const width = Math.max(10, rect.width * captureScaleX * scale);
  const height = Math.max(10, rect.height * captureScaleY * scale);
  const pointX = (commentPoint?.x ?? rect.x + rect.width / 2) * captureScaleX * scale;
  const pointY = (commentPoint?.y ?? rect.y + rect.height / 2) * captureScaleY * scale;
  const markerRadius = Math.max(11, 12 * scale);
  context.save();
  context.fillStyle = 'rgba(0, 229, 160, 0.12)';
  context.strokeStyle = '#00e5a0';
  context.lineWidth = Math.max(3, 3 * scale);
  context.shadowColor = 'rgba(0, 229, 160, 0.8)';
  context.shadowBlur = 14;
  context.fillRect(x, y, width, height);
  context.strokeRect(x, y, width, height);
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(pointX, pointY, markerRadius, 0, Math.PI * 2);
  context.fillStyle = '#00e5a0';
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#001b17';
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#001b17';
  context.font = `700 ${Math.max(12, Math.round(13 * scale))}px ui-sans-serif, system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(annotationLabel, pointX, pointY + 0.5);
  context.restore();
  return canvas;
}

function feedbackLabelForElement(element: Element) {
  const htmlElement = element as HTMLElement;
  const explicit = element.getAttribute('aria-label')
    || element.getAttribute('alt')
    || htmlElement.title
    || labelFromAssociatedElement(element);
  return explicit ? scrubFeedbackText(explicit).slice(0, FEEDBACK_TEXT_LIMIT) : undefined;
}

function labelFromAssociatedElement(element: Element) {
  if (!(element instanceof HTMLElement) || !element.id || typeof document === 'undefined') return undefined;
  const label = document.querySelector<HTMLLabelElement>(`label[for="${cssAttributeValue(element.id)}"]`);
  return label?.innerText || label?.textContent || undefined;
}

function implicitRoleForElement(element: Element) {
  const tagName = element.tagName.toLowerCase();
  if (tagName === 'button') return 'button';
  if (tagName === 'a' && element.hasAttribute('href')) return 'link';
  if (tagName === 'input') return inputRole(element as HTMLInputElement);
  if (tagName === 'select') return 'combobox';
  if (tagName === 'textarea') return 'textbox';
  if (/^h[1-6]$/.test(tagName)) return 'heading';
  if (tagName === 'img') return 'img';
  if (tagName === 'nav') return 'navigation';
  if (tagName === 'main') return 'main';
  if (tagName === 'aside') return 'complementary';
  if (tagName === 'section') return 'region';
  return undefined;
}

function inputRole(element: HTMLInputElement) {
  switch (element.type) {
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'range':
      return 'slider';
    case 'button':
    case 'submit':
    case 'reset':
      return 'button';
    default:
      return 'textbox';
  }
}

function stableAttributeSelector(element: Element) {
  const tagName = element.tagName.toLowerCase();
  const attributes = ['data-testid', 'data-test-id', 'data-cy', 'data-sciforge-reference-id', 'aria-label', 'name'];
  for (const name of attributes) {
    const value = element.getAttribute(name);
    if (!value || looksGeneratedToken(value) || scrubFeedbackText(value).includes(REDACTED_FEEDBACK_SECRET)) continue;
    return scrubFeedbackRefText(`${tagName}[${name}="${cssAttributeValue(value)}"]`);
  }
  return undefined;
}

function selectorIsUnique(selector: string) {
  if (typeof document === 'undefined') return false;
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function cssEscape(value: string) {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function cssAttributeValue(value: string) {
  return scrubFeedbackText(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 160);
}

function looksGeneratedToken(value: string) {
  const text = value.trim();
  return text.length > 64
    || /^[a-f0-9]{8,}$/i.test(text)
    || /(?:^|[-_])[a-f0-9]{8,}(?:$|[-_])/i.test(text)
    || /(?:token|secret|api[_-]?key|password|credential)/i.test(text);
}

function scrubFeedbackIdentifier(value: string) {
  const scrubbed = scrubFeedbackRefText(value);
  return scrubbed.includes(REDACTED_FEEDBACK_SECRET) || scrubbed.includes(REDACTED_FEEDBACK_PATH) || scrubbed.includes(REDACTED_PROVIDER_BODY)
    ? `redacted-${feedbackHash(value)}`
    : scrubbed.replace(/[^a-zA-Z0-9:_./-]/g, '-').slice(0, 160);
}

function scrubScreenshotDataUrl(value: string) {
  return /^data:image\/(?:jpeg|jpg|png);base64,[a-z0-9+/=]+$/i.test(value)
    ? value
    : `${REDACTED_PROVIDER_BODY}:screenshot-data:${feedbackHash(value)}`;
}

function scrubFeedbackValue(value: unknown, key: string, depth = 0): unknown {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return scrubFeedbackText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth > 5) return { omitted: 'feedback-scrub-depth', digest: feedbackHash(JSON.stringify(value)) };
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => scrubFeedbackValue(item, key, depth + 1));
  const record = value as Record<string, unknown>;
  if (looksLikeSensitivePayloadKey(key) || Object.keys(record).some((item) => looksLikeSensitivePayloadKey(item))) {
    return {
      omitted: 'feedback-sensitive-payload',
      keys: Object.keys(record).slice(0, 12).map((item) => scrubFeedbackText(item)),
      digest: feedbackHash(JSON.stringify(record)),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record)) {
    out[scrubFeedbackText(childKey).slice(0, 120)] = scrubFeedbackValue(child, childKey, depth + 1);
  }
  return out;
}

function looksLikeSensitivePayloadKey(key: string) {
  return /(?:authorization|auth|token|secret|password|credential|api[_-]?key|client[_-]?secret|rawprovider|providerbody|rawbody|rawpayload|stdout|stderr|logs?|endpoint|baseurl|invokeurl|workspacepath|workspaceroot)/i.test(key);
}

function looksLikeRawProviderBody(text: string) {
  if (text.length < 64) return false;
  if (/(?:rawProviderBody|RAW_[A-Z0-9_]+|cf_chl|<html|event:\s*error|data:\s*\{)/i.test(text)) return true;
  return text.length > 200
    && /(?:Authorization:\s*Bearer|Invalid token|Unauthorized|Forbidden)/i.test(text)
    && /(?:provider|authorization|token|secret|api[_-]?key|raw|html|error|upstream)/i.test(text);
}
