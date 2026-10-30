import { readFile } from 'node:fs/promises';

export type LayoutIssueSeverity = 'error' | 'warning';

export type LayoutIssue = {
  severity: LayoutIssueSeverity;
  code: string;
  message: string;
  fileName?: string;
  element?: string;
};

export type LayoutRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ResearchSvgLayoutOptions = {
  fileName?: string;
  width?: number;
  height?: number;
  safeArea?: LayoutRect;
  footerTop?: number;
  footerBottom?: number;
};

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;
const DEFAULT_SAFE_AREA: LayoutRect = {
  left: 64,
  top: 56,
  right: 1216,
  bottom: 650
};
const DEFAULT_FOOTER_TOP = 628;
const DEFAULT_FOOTER_BOTTOM = 676;

export async function checkResearchSvgFile(
  path: string,
  options: Omit<ResearchSvgLayoutOptions, 'fileName'> = {}
): Promise<LayoutIssue[]> {
  const svg = await readFile(path, 'utf8');
  return checkResearchSvgLayout(svg, { ...options, fileName: path });
}

export function checkResearchSvgLayout(
  svg: string,
  options: ResearchSvgLayoutOptions = {}
): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const fileName = options.fileName;
  const expectedWidth = options.width ?? DEFAULT_WIDTH;
  const expectedHeight = options.height ?? DEFAULT_HEIGHT;
  const safeArea = options.safeArea ?? DEFAULT_SAFE_AREA;
  const footerTop = options.footerTop ?? DEFAULT_FOOTER_TOP;
  const footerBottom = options.footerBottom ?? DEFAULT_FOOTER_BOTTOM;
  const svgTag = svg.match(/<svg\b([^>]*)>/);

  if (!svgTag?.[1]) {
    return [{
      severity: 'error',
      code: 'missing-svg-root',
      message: 'Missing <svg> root element.',
      fileName
    }];
  }

  const rootAttrs = parseAttributes(svgTag[1]);
  const width = numberAttr(rootAttrs, 'width');
  const height = numberAttr(rootAttrs, 'height');
  const viewBox = rootAttrs.viewBox?.trim();
  if (width !== expectedWidth || height !== expectedHeight) {
    issues.push(issue('error', 'canvas-size', `Expected ${expectedWidth}x${expectedHeight} canvas, got ${rootAttrs.width ?? 'missing'}x${rootAttrs.height ?? 'missing'}.`, fileName));
  }
  if (viewBox !== `0 0 ${expectedWidth} ${expectedHeight}`) {
    issues.push(issue('error', 'viewbox', `Expected viewBox="0 0 ${expectedWidth} ${expectedHeight}", got "${viewBox ?? 'missing'}".`, fileName));
  }

  for (const match of svg.matchAll(/<(rect|image|circle)\b([^>]*)\/?>/g)) {
    const tagName = match[1] ?? '';
    const attrs = parseAttributes(match[2] ?? '');
    if (isFullBleedBackground(tagName, attrs, expectedWidth, expectedHeight)) {
      continue;
    }
    if (attrs['data-allow-bleed'] === 'true') {
      continue;
    }
    const box = elementBox(tagName, attrs);
    if (!box) {
      continue;
    }
    const role = attrs['data-role'];
    if (!containsRect({ left: 0, top: 0, right: expectedWidth, bottom: expectedHeight }, box)) {
      issues.push(issue('error', 'element-outside-canvas', `${tagName} extends outside the canvas.`, fileName, summarizeElement(tagName, attrs)));
    }
    if (role !== 'footer' && box.bottom > footerTop && box.top < footerBottom) {
      issues.push(issue('warning', 'element-in-footer-band', `${tagName} enters the reserved footer band.`, fileName, summarizeElement(tagName, attrs)));
    }
    if (role !== 'footer' && !containsRect(safeArea, box)) {
      issues.push(issue('warning', 'element-outside-safe-area', `${tagName} extends outside the body safe area.`, fileName, summarizeElement(tagName, attrs)));
    }
  }

  for (const match of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const attrs = parseAttributes(match[1] ?? '');
    const rawText = match[2] ?? '';
    const text = normalizeText(rawText);
    const x = numberAttr(attrs, 'x');
    const y = numberAttr(attrs, 'y');
    const fontSize = numberAttr(attrs, 'font-size') ?? 16;
    const maxWidth = numberAttr(attrs, 'data-max-width');
    const role = attrs['data-role'];
    const isFooter = role === 'footer';

    if (x === undefined || y === undefined) {
      issues.push(issue('error', 'text-position', 'Text element is missing x or y.', fileName, text || undefined));
      continue;
    }

    if (!isFooter && y > footerTop) {
      issues.push(issue('error', 'text-in-footer-band', `Body text baseline y=${y} enters reserved footer band.`, fileName, text));
    }
    if (isFooter && y > footerBottom) {
      issues.push(issue('error', 'footer-outside-footer-band', `Footer baseline y=${y} is below the footer band.`, fileName, text));
    }
    if (!isFooter && (x < safeArea.left || y < safeArea.top || y > safeArea.bottom)) {
      issues.push(issue('warning', 'text-outside-safe-area', `Text baseline (${x}, ${y}) is outside the body safe area.`, fileName, text));
    }

    const lineLimit = maxWidth ?? (isFooter ? expectedWidth - safeArea.left * 2 : safeArea.right - x);
    if (maxWidth !== undefined && x + maxWidth > (isFooter ? expectedWidth - safeArea.left : safeArea.right)) {
      issues.push(issue('error', 'text-slot-outside-safe-area', `Text slot extends beyond the safe right edge: x=${x}, max=${maxWidth}.`, fileName, text));
    }
    if (!isTemplatePlaceholderOnly(text)) {
      const estimatedWidth = estimateTextWidth(text, fontSize, attrs['font-weight']);
      if (estimatedWidth > lineLimit * 1.08) {
        issues.push(issue(
          'error',
          'text-overflow',
          `Estimated text width ${Math.round(estimatedWidth)} exceeds slot ${Math.round(lineLimit)}.`,
          fileName,
          text
        ));
      }
      if (maxWidth === undefined && estimatedWidth > 320) {
        issues.push(issue('warning', 'missing-text-slot', 'Long text should declare data-max-width for layout QA.', fileName, text));
      }
    }
  }

  return issues;
}

export function estimateTextWidth(text: string, fontSize: number, fontWeight?: string): number {
  let units = 0;
  for (const char of text) {
    units += characterWidthUnit(char);
  }
  const weightFactor = fontWeight && fontWeight !== '400' && fontWeight !== 'normal' ? 1.06 : 1;
  return units * fontSize * weightFactor;
}

function parseAttributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    if (match[1]) {
      attrs[match[1]] = match[3] ?? '';
    }
  }
  return attrs;
}

function numberAttr(attrs: Record<string, string>, key: string): number | undefined {
  const value = attrs[key];
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isFullBleedBackground(
  tagName: string,
  attrs: Record<string, string>,
  width: number,
  height: number
): boolean {
  return tagName === 'rect'
    && numberAttr(attrs, 'x') === 0
    && numberAttr(attrs, 'y') === 0
    && numberAttr(attrs, 'width') === width
    && numberAttr(attrs, 'height') === height;
}

function elementBox(tagName: string, attrs: Record<string, string>): LayoutRect | undefined {
  if (tagName === 'rect' || tagName === 'image') {
    const x = numberAttr(attrs, 'x');
    const y = numberAttr(attrs, 'y');
    const width = numberAttr(attrs, 'width');
    const height = numberAttr(attrs, 'height');
    if (x === undefined || y === undefined || width === undefined || height === undefined) {
      return undefined;
    }
    return { left: x, top: y, right: x + width, bottom: y + height };
  }
  if (tagName === 'circle') {
    const cx = numberAttr(attrs, 'cx');
    const cy = numberAttr(attrs, 'cy');
    const radius = numberAttr(attrs, 'r');
    if (cx === undefined || cy === undefined || radius === undefined) {
      return undefined;
    }
    return { left: cx - radius, top: cy - radius, right: cx + radius, bottom: cy + radius };
  }
  return undefined;
}

function containsRect(container: LayoutRect, box: LayoutRect): boolean {
  return box.left >= container.left
    && box.top >= container.top
    && box.right <= container.right
    && box.bottom <= container.bottom;
}

function normalizeText(rawText: string): string {
  return rawText
    .replace(/<tspan\b[^>]*>/g, ' ')
    .replace(/<\/tspan>/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTemplatePlaceholderOnly(text: string): boolean {
  return /^\{\{[A-Z0-9_]+\}\}$/.test(text);
}

function characterWidthUnit(char: string): number {
  if (/\s/.test(char)) {
    return 0.35;
  }
  if (/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(char)) {
    return 1;
  }
  if (/[ilI.,:;|!]/.test(char)) {
    return 0.32;
  }
  if (/[mwMW@#%]/.test(char)) {
    return 0.86;
  }
  if (/[A-Z]/.test(char)) {
    return 0.64;
  }
  if (/[0-9]/.test(char)) {
    return 0.56;
  }
  if (/[-_+=/\\]/.test(char)) {
    return 0.48;
  }
  return 0.55;
}

function issue(
  severity: LayoutIssueSeverity,
  code: string,
  message: string,
  fileName?: string,
  element?: string
): LayoutIssue {
  return { severity, code, message, fileName, element };
}

function summarizeElement(tagName: string, attrs: Record<string, string>): string {
  const bits = [tagName];
  for (const key of ['x', 'y', 'width', 'height', 'cx', 'cy', 'r']) {
    if (attrs[key] !== undefined) {
      bits.push(`${key}=${attrs[key]}`);
    }
  }
  return bits.join(' ');
}
