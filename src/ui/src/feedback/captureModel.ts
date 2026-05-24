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
const HTML2CANVAS_COLOR_PROPERTIES = [
  { css: 'background-color', js: 'backgroundColor' },
  { css: 'border-top-color', js: 'borderTopColor' },
  { css: 'border-right-color', js: 'borderRightColor' },
  { css: 'border-bottom-color', js: 'borderBottomColor' },
  { css: 'border-left-color', js: 'borderLeftColor' },
  { css: 'caret-color', js: 'caretColor' },
  { css: 'color', js: 'color' },
  { css: 'column-rule-color', js: 'columnRuleColor' },
  { css: 'outline-color', js: 'outlineColor' },
  { css: 'text-decoration-color', js: 'textDecorationColor' },
] as const;

interface FeedbackScreenshotAnnotationInput {
  label: string;
  target: FeedbackTargetSnapshot;
}

interface FeedbackScreenshotAnnotation {
  label: string;
  target: FeedbackTargetSnapshot;
}

interface FeedbackCaptureArea {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  scrollX: number;
  scrollY: number;
  captureMode: 'full-page';
}

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
  options: { annotationLabel?: string; annotations?: FeedbackScreenshotAnnotationInput[] } = {},
): Promise<FeedbackScreenshotEvidence | undefined> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-feedback-control="true"]'));
  const previousVisibility = controls.map((element) => element.style.visibility);
  controls.forEach((element) => {
    element.style.visibility = 'hidden';
  });
  try {
    const { default: html2canvas } = await import('html2canvas');
    const annotations = feedbackScreenshotAnnotations(target, options);
    const captureArea = expandFeedbackCaptureAreaForAnnotations(feedbackFullPageCaptureArea(), annotations);
    const scale = feedbackScreenshotScale(captureArea.width, captureArea.height, 1);
    const canvas = await html2canvas(document.documentElement, {
      backgroundColor: '#0a0f1a',
      useCORS: true,
      allowTaint: false,
      logging: false,
      scale,
      width: captureArea.width,
      height: captureArea.height,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      windowWidth: captureArea.width,
      windowHeight: captureArea.height,
      ignoreElements: (element) => element instanceof HTMLElement && element.dataset.feedbackControl === 'true',
      onclone: prepareFeedbackScreenshotClone,
    });
    const primaryTarget = feedbackTargetInCaptureCoordinates(annotations[0]?.target ?? target, captureArea);
    const rawDataUrl = canvas.toDataURL('image/png');
    const annotated = annotateFeedbackCanvas(canvas, annotations, captureArea);
    const annotatedDataUrl = annotated.toDataURL('image/png');
    return scrubFeedbackScreenshotEvidence({
      schemaVersion: 1,
      captureMode: captureArea.captureMode,
      dataUrl: annotatedDataUrl,
      rawDataUrl,
      annotatedDataUrl,
      mediaType: 'image/png',
      width: annotated.width,
      height: annotated.height,
      capturedAt,
      targetRect: { ...primaryTarget.rect },
      targetAnnotations: annotations.map((annotation) => {
        const pageTarget = feedbackTargetInCaptureCoordinates(annotation.target, captureArea);
        return {
          label: annotation.label,
          rect: { ...pageTarget.rect },
          commentPoint: pageTarget.commentPoint ? { ...pageTarget.commentPoint } : undefined,
          selector: pageTarget.stableSelector || pageTarget.selector,
          title: pageTarget.label || pageTarget.text || pageTarget.textSnippet || pageTarget.tagName,
        };
      }),
      commentPoint: primaryTarget.commentPoint ? { ...primaryTarget.commentPoint } : undefined,
      scrollX: captureArea.scrollX,
      scrollY: captureArea.scrollY,
      annotationLabel: annotations[0]?.label,
      includeForAgent: false,
      note: `Full page screenshot captured at ${Math.round(captureArea.width)}x${Math.round(captureArea.height)} CSS px, viewport ${Math.round(captureArea.viewportWidth)}x${Math.round(captureArea.viewportHeight)}, scroll ${Math.round(captureArea.scrollX)},${Math.round(captureArea.scrollY)}; ${annotations.length} target annotation(s) are highlighted in context.`,
    });
  } catch (error) {
    return fallbackFeedbackScreenshotEvidence(target, capturedAt, options, error);
  } finally {
    controls.forEach((element, index) => {
      element.style.visibility = previousVisibility[index] ?? '';
    });
  }
}

function fallbackFeedbackScreenshotEvidence(
  target: FeedbackTargetSnapshot,
  capturedAt: string,
  options: { annotationLabel?: string; annotations?: FeedbackScreenshotAnnotationInput[] } = {},
  cause?: unknown,
): FeedbackScreenshotEvidence | undefined {
  if (typeof window === 'undefined' || typeof document === 'undefined') return undefined;
  const annotations = feedbackScreenshotAnnotations(target, options);
  const captureArea = expandFeedbackCaptureAreaForAnnotations(feedbackFullPageCaptureArea(), annotations);
  const primaryTarget = feedbackTargetInCaptureCoordinates(annotations[0]?.target ?? target, captureArea);
  const scale = feedbackScreenshotScale(captureArea.width, captureArea.height, 1);
  const width = Math.max(320, Math.round(captureArea.width * scale));
  const height = Math.max(240, Math.round(captureArea.height * scale));
  const raw = document.createElement('canvas');
  raw.width = width;
  raw.height = height;
  const rawContext = raw.getContext('2d');
  if (!rawContext) return undefined;
  drawFallbackPageContext(rawContext, { width, height, scale, captureArea, annotations, annotated: false });
  const annotated = document.createElement('canvas');
  annotated.width = width;
  annotated.height = height;
  const annotatedContext = annotated.getContext('2d');
  if (!annotatedContext) return undefined;
  drawFallbackPageContext(annotatedContext, { width, height, scale, captureArea, annotations, annotated: true });
  const rawDataUrl = raw.toDataURL('image/png');
  const annotatedDataUrl = annotated.toDataURL('image/png');
  return scrubFeedbackScreenshotEvidence({
    schemaVersion: 1,
    captureMode: 'page-structure-fallback',
    dataUrl: annotatedDataUrl,
    rawDataUrl,
    annotatedDataUrl,
    mediaType: 'image/png',
    width,
    height,
    capturedAt,
    targetRect: { ...primaryTarget.rect },
    targetAnnotations: annotations.map((annotation) => {
      const pageTarget = feedbackTargetInCaptureCoordinates(annotation.target, captureArea);
      return {
        label: annotation.label,
        rect: { ...pageTarget.rect },
        commentPoint: pageTarget.commentPoint ? { ...pageTarget.commentPoint } : undefined,
        selector: pageTarget.stableSelector || pageTarget.selector,
        title: pageTarget.label || pageTarget.text || pageTarget.textSnippet || pageTarget.tagName,
      };
    }),
    commentPoint: primaryTarget.commentPoint ? { ...primaryTarget.commentPoint } : undefined,
    scrollX: captureArea.scrollX,
    scrollY: captureArea.scrollY,
    annotationLabel: annotations[0]?.label,
    includeForAgent: false,
    note: `html2canvas capture failed (${scrubFeedbackText(errorMessage(cause)).slice(0, 180) || 'unknown error'}); generated a scrubbed full-page structure fallback at ${Math.round(captureArea.width)}x${Math.round(captureArea.height)} CSS px with ${annotations.length} target annotation(s). The fallback preserves page layout context and target geometry, but not exact pixels.`,
  });
}

function feedbackFullPageCaptureArea(): FeedbackCaptureArea {
  const viewportWidth = Math.max(320, window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth || 0);
  const viewportHeight = Math.max(240, window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight || 0);
  const width = Math.max(
    viewportWidth,
    document.documentElement.scrollWidth || 0,
    document.body.scrollWidth || 0,
    document.documentElement.clientWidth || 0,
    document.body.clientWidth || 0,
  );
  const height = Math.max(
    viewportHeight,
    document.documentElement.scrollHeight || 0,
    document.body.scrollHeight || 0,
    document.documentElement.clientHeight || 0,
    document.body.clientHeight || 0,
  );
  return {
    width,
    height,
    viewportWidth,
    viewportHeight,
    scrollX: Math.max(0, window.scrollX || window.pageXOffset || 0),
    scrollY: Math.max(0, window.scrollY || window.pageYOffset || 0),
    captureMode: 'full-page',
  };
}

function expandFeedbackCaptureAreaForAnnotations(
  captureArea: FeedbackCaptureArea,
  annotations: FeedbackScreenshotAnnotation[],
): FeedbackCaptureArea {
  const padding = 64;
  const bounds = annotations.reduce((current, annotation) => {
    const target = feedbackTargetInCaptureCoordinates(annotation.target, captureArea);
    return {
      width: Math.max(
        current.width,
        target.rect.x + target.rect.width + padding,
        (target.commentPoint?.x ?? 0) + padding,
      ),
      height: Math.max(
        current.height,
        target.rect.y + target.rect.height + padding,
        (target.commentPoint?.y ?? 0) + padding,
      ),
    };
  }, { width: captureArea.width, height: captureArea.height });
  return {
    ...captureArea,
    width: Math.ceil(Math.max(captureArea.viewportWidth, bounds.width)),
    height: Math.ceil(Math.max(captureArea.viewportHeight, bounds.height)),
  };
}

function prepareFeedbackScreenshotClone(clonedDocument: Document) {
  const clonedWindow = clonedDocument.defaultView;
  if (!clonedWindow) return;
  clonedDocument.querySelectorAll<HTMLElement>('*').forEach((element) => {
    const style = clonedWindow.getComputedStyle(element);
    HTML2CANVAS_COLOR_PROPERTIES.forEach((property) => {
      const safeColor = html2CanvasSafeColor(style[property.js], property.js);
      if (!safeColor) return;
      element.style.setProperty(property.css, safeColor, 'important');
      if (property.js === 'backgroundColor') element.style.setProperty('background', safeColor, 'important');
    });
    if (hasHtml2CanvasUnsupportedColor(style.boxShadow)) element.style.setProperty('box-shadow', 'none', 'important');
    if (hasHtml2CanvasUnsupportedColor(style.textShadow)) element.style.setProperty('text-shadow', 'none', 'important');
    if (hasHtml2CanvasUnsupportedColor(style.backgroundImage)) element.style.setProperty('background-image', 'none', 'important');
  });
}

function html2CanvasSafeColor(value: string, property: typeof HTML2CANVAS_COLOR_PROPERTIES[number]['js']) {
  if (!hasHtml2CanvasUnsupportedColor(value)) return undefined;
  const colorFunction = cssColorFunctionToRgba(value);
  if (colorFunction) return colorFunction;
  if (property.toLowerCase().includes('background')) return 'rgba(10, 15, 26, 0.92)';
  if (property.toLowerCase().includes('border') || property === 'outlineColor' || property === 'columnRuleColor') {
    return 'rgba(123, 147, 176, 0.36)';
  }
  return 'rgb(231, 245, 255)';
}

function hasHtml2CanvasUnsupportedColor(value: string) {
  return /(?:color|color-mix|oklch|oklab|lab|lch)\(/i.test(value);
}

function cssColorFunctionToRgba(value: string) {
  const match = value.match(/^color\(\s*[a-z0-9-]+\s+([+-]?\d*\.?\d+%?)\s+([+-]?\d*\.?\d+%?)\s+([+-]?\d*\.?\d+%?)(?:\s*\/\s*([+-]?\d*\.?\d+%?))?\s*\)$/i);
  if (!match) return undefined;
  const red = cssColorComponentToByte(match[1]);
  const green = cssColorComponentToByte(match[2]);
  const blue = cssColorComponentToByte(match[3]);
  const alpha = cssAlphaComponent(match[4] ?? '1');
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function cssColorComponentToByte(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return Math.round(clampNumber(normalized, 0, 1) * 255);
}

function cssAlphaComponent(value: string) {
  const trimmed = value.trim();
  const normalized = trimmed.endsWith('%') ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return Number(clampNumber(normalized, 0, 1).toFixed(4));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function feedbackScreenshotScale(width: number, height: number, preferredScale: number) {
  return Math.max(0.18, Math.min(
    preferredScale,
    SCREENSHOT_MAX_WIDTH / Math.max(1, width),
    SCREENSHOT_MAX_HEIGHT / Math.max(1, height),
  ));
}

function feedbackScreenshotAnnotations(
  target: FeedbackTargetSnapshot,
  options: { annotationLabel?: string; annotations?: FeedbackScreenshotAnnotationInput[] },
): FeedbackScreenshotAnnotation[] {
  const annotations = options.annotations?.length
    ? options.annotations
    : [{ label: options.annotationLabel ?? '1', target }];
  return annotations.map((annotation, index) => ({
    label: scrubFeedbackText(annotation.label || options.annotationLabel || String(index + 1)).slice(0, 12) || String(index + 1),
    target: annotation.target,
  }));
}

function feedbackTargetInCaptureCoordinates(target: FeedbackTargetSnapshot, captureArea: FeedbackCaptureArea): FeedbackTargetSnapshot {
  const xOffset = captureArea.scrollX;
  const yOffset = captureArea.scrollY;
  return {
    ...target,
    rect: {
      x: target.rect.x + xOffset,
      y: target.rect.y + yOffset,
      width: target.rect.width,
      height: target.rect.height,
    },
    commentPoint: target.commentPoint
      ? { x: target.commentPoint.x + xOffset, y: target.commentPoint.y + yOffset }
      : undefined,
  };
}

function drawFallbackPageContext(
  context: CanvasRenderingContext2D,
  input: {
    width: number;
    height: number;
    scale: number;
    captureArea: FeedbackCaptureArea;
    annotations: FeedbackScreenshotAnnotation[];
    annotated: boolean;
  },
) {
  const { width, height, scale, captureArea, annotations } = input;
  context.fillStyle = '#0a0f1a';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#101a2c';
  context.fillRect(0, 0, width, 46);
  context.fillStyle = '#e7f5ff';
  context.font = '700 14px system-ui, sans-serif';
  context.fillText('SciForge feedback page-structure fallback', 16, 20);
  context.font = '11px system-ui, sans-serif';
  context.fillStyle = '#9fb3c8';
  context.fillText(scrubFeedbackText(window.location.href).slice(0, 120), 16, 38);

  context.strokeStyle = 'rgba(123, 147, 176, 0.24)';
  context.lineWidth = 1;
  context.strokeRect(0.5, 46.5, width - 1, height - 47);

  const viewport = {
    x: Math.round(captureArea.scrollX * scale),
    y: Math.round(captureArea.scrollY * scale),
    width: Math.round(captureArea.viewportWidth * scale),
    height: Math.round(captureArea.viewportHeight * scale),
  };
  context.save();
  context.strokeStyle = 'rgba(0, 229, 160, 0.34)';
  context.setLineDash([7, 6]);
  context.strokeRect(viewport.x + 0.5, viewport.y + 0.5, Math.max(20, viewport.width - 1), Math.max(20, viewport.height - 1));
  context.setLineDash([]);
  context.restore();

  for (const item of fallbackPageContextRects(captureArea).slice(0, 180)) {
    const x = Math.round(item.rect.x * scale);
    const y = Math.round(item.rect.y * scale);
    const rectWidth = Math.max(3, Math.round(item.rect.width * scale));
    const rectHeight = Math.max(3, Math.round(item.rect.height * scale));
    context.fillStyle = item.kind === 'landmark' ? 'rgba(19, 34, 56, 0.54)' : 'rgba(19, 34, 56, 0.24)';
    context.strokeStyle = item.kind === 'action' ? 'rgba(0, 229, 160, 0.36)' : 'rgba(123, 147, 176, 0.28)';
    context.lineWidth = item.kind === 'landmark' ? 1.4 : 1;
    context.fillRect(x, y, rectWidth, rectHeight);
    context.strokeRect(x, y, rectWidth, rectHeight);
    if (item.label && rectWidth > 50 && rectHeight > 16) {
      context.fillStyle = item.kind === 'action' ? '#9df9df' : '#b7c7d8';
      context.font = `${item.kind === 'landmark' ? '700' : '600'} ${Math.max(9, Math.round(10 * scale))}px system-ui, sans-serif`;
      context.fillText(item.label.slice(0, Math.max(12, Math.floor(rectWidth / 7))), x + 5, y + Math.min(rectHeight - 4, 14));
    }
  }

  if (input.annotated) {
    drawFeedbackAnnotations(context, annotations, captureArea, { x: scale, y: scale }, '#ffca57');
  }
}

function fallbackPageContextRects(captureArea: FeedbackCaptureArea) {
  const elements = Array.from(document.querySelectorAll<HTMLElement>('header, nav, main, aside, section, article, figure, form, details, summary, [role], button, a, input, textarea, select, [data-sciforge-reference], .message, .feedback-item, .feedback-evidence-review, .chat-panel, .app-shell'));
  return elements
    .filter((element) => !element.closest('[data-feedback-control="true"]'))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return undefined;
      const pageRect = {
        x: rect.x + captureArea.scrollX,
        y: rect.y + captureArea.scrollY,
        width: rect.width,
        height: rect.height,
      };
      if (pageRect.width < 8 || pageRect.height < 8) return undefined;
      if (pageRect.x > captureArea.width || pageRect.y > captureArea.height || pageRect.x + pageRect.width < 0 || pageRect.y + pageRect.height < 0) return undefined;
      const tagName = element.tagName.toLowerCase();
      const role = element.getAttribute('role') || implicitRoleForElement(element);
      const kind = /^(header|nav|main|aside|section|article|figure|form)$/.test(tagName) || ['main', 'navigation', 'complementary', 'region'].includes(role ?? '')
        ? 'landmark'
        : ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio'].includes(role ?? '') || /^(button|a|input|textarea|select|summary)$/.test(tagName)
          ? 'action'
          : 'content';
      return {
        kind,
        rect: pageRect,
        label: scrubFeedbackText(element.getAttribute('aria-label') || element.title || element.innerText || element.textContent || tagName).slice(0, 48),
      };
    })
    .filter((item): item is { kind: 'landmark' | 'action' | 'content'; rect: { x: number; y: number; width: number; height: number }; label: string } => Boolean(item))
    .sort((left, right) => {
      const rank = (value: typeof left) => value.kind === 'landmark' ? 0 : value.kind === 'content' ? 1 : 2;
      return rank(left) - rank(right) || (right.rect.width * right.rect.height) - (left.rect.width * left.rect.height);
    });
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
  const structureFallback = screenshot?.captureMode === 'page-structure-fallback';
  const nextDiagnostics = [...diagnostics];
  if (!rawScreenshot) nextDiagnostics.push('raw screenshot unavailable');
  if (!annotatedScreenshot) nextDiagnostics.push('annotated screenshot unavailable');
  if (!targetSnapshot) nextDiagnostics.push('target snapshot unavailable');
  if (!runtimeSnapshot) nextDiagnostics.push('runtime snapshot unavailable');
  if (structureFallback) nextDiagnostics.push('full page screenshot pixels unavailable; using page structure fallback');
  const status = rawScreenshot && annotatedScreenshot && targetSnapshot && runtimeSnapshot && !structureFallback
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
    dataUrl: scrubScreenshotDataUrl(evidence.dataUrl),
    rawDataUrl: evidence.rawDataUrl ? scrubScreenshotDataUrl(evidence.rawDataUrl) : undefined,
    annotatedDataUrl: evidence.annotatedDataUrl ? scrubScreenshotDataUrl(evidence.annotatedDataUrl) : undefined,
    rawScreenshotRef: evidence.rawScreenshotRef ? scrubFeedbackRefText(evidence.rawScreenshotRef) : undefined,
    annotatedScreenshotRef: evidence.annotatedScreenshotRef ? scrubFeedbackRefText(evidence.annotatedScreenshotRef) : undefined,
    targetAnnotations: evidence.targetAnnotations?.map((annotation) => ({
      label: scrubFeedbackText(annotation.label).slice(0, 12),
      rect: { ...annotation.rect },
      commentPoint: annotation.commentPoint ? { ...annotation.commentPoint } : undefined,
      selector: annotation.selector ? scrubFeedbackRefText(annotation.selector) : undefined,
      title: annotation.title ? scrubFeedbackText(annotation.title) : undefined,
    })),
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
  annotations: FeedbackScreenshotAnnotation[],
  captureArea: FeedbackCaptureArea,
) {
  const scale = Math.min(1, SCREENSHOT_MAX_WIDTH / source.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext('2d');
  if (!context) return source;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  drawFeedbackAnnotations(context, annotations, captureArea, {
    x: canvas.width / Math.max(1, captureArea.width),
    y: canvas.height / Math.max(1, captureArea.height),
  }, '#00e5a0');
  return canvas;
}

function drawFeedbackAnnotations(
  context: CanvasRenderingContext2D,
  annotations: FeedbackScreenshotAnnotation[],
  captureArea: FeedbackCaptureArea,
  scale: { x: number; y: number },
  accent: string,
) {
  annotations.forEach((annotation, index) => {
    const target = feedbackTargetInCaptureCoordinates(annotation.target, captureArea);
    const x = target.rect.x * scale.x;
    const y = target.rect.y * scale.y;
    const width = Math.max(10, target.rect.width * scale.x);
    const height = Math.max(10, target.rect.height * scale.y);
    const pointX = (target.commentPoint?.x ?? target.rect.x + target.rect.width / 2) * scale.x;
    const pointY = (target.commentPoint?.y ?? target.rect.y + target.rect.height / 2) * scale.y;
    const markerRadius = Math.max(12, Math.min(20, 12 / Math.min(1, Math.max(scale.x, scale.y))));
    const markerLabel = annotation.label || String(index + 1);
    drawFeedbackAnnotation(context, {
      accent,
      height,
      markerLabel,
      markerRadius,
      pointX,
      pointY,
      width,
      x,
      y,
    });
  });
}

function drawFeedbackAnnotation(
  context: CanvasRenderingContext2D,
  input: {
    accent: string;
    height: number;
    markerLabel: string;
    markerRadius: number;
    pointX: number;
    pointY: number;
    width: number;
    x: number;
    y: number;
  },
) {
  context.save();
  context.fillStyle = input.accent === '#ffca57' ? 'rgba(255, 202, 87, 0.14)' : 'rgba(0, 229, 160, 0.12)';
  context.strokeStyle = input.accent;
  context.lineWidth = 4;
  context.shadowColor = input.accent === '#ffca57' ? 'rgba(255, 202, 87, 0.72)' : 'rgba(0, 229, 160, 0.8)';
  context.shadowBlur = 14;
  context.fillRect(input.x, input.y, input.width, input.height);
  context.strokeRect(input.x, input.y, input.width, input.height);
  context.shadowBlur = 8;
  context.beginPath();
  context.arc(input.pointX, input.pointY, input.markerRadius, 0, Math.PI * 2);
  context.fillStyle = input.accent;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = '#001b17';
  context.stroke();
  context.shadowBlur = 0;
  context.fillStyle = '#001b17';
  context.font = '900 13px ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(input.markerLabel, input.pointX, input.pointY + 0.5);
  context.restore();
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

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return value === undefined || value === null ? '' : String(value);
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
