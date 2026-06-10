import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';

export const WEB_READ_STATIC_EXTRACT_METHOD = 'deterministic-static-html' as const;
export const WEB_READ_READABILITY_EXTRACT_METHOD = 'readability-static-html' as const;

export interface WebReadHtmlExtractionInput {
  html: string;
  url: string;
  contentType?: string;
}

export interface WebReadHtmlExtractionResult {
  method: string;
  title?: string;
  text: string;
  markdown: string;
  lowInformation: boolean;
  warnings: string[];
}

export type WebReadHtmlExtractor = (
  input: WebReadHtmlExtractionInput,
) => WebReadHtmlExtractionResult | Promise<WebReadHtmlExtractionResult>;

export async function extractStaticHtmlPage(
  input: WebReadHtmlExtractionInput,
  extractor: WebReadHtmlExtractor = readabilityStaticHtmlExtractor,
): Promise<WebReadHtmlExtractionResult> {
  return await extractor(input);
}

export function readabilityStaticHtmlExtractor(input: WebReadHtmlExtractionInput): WebReadHtmlExtractionResult {
  const extracted = extractWithReadability(input);
  if (extracted) return extracted;

  const fallback = deterministicStaticHtmlExtractor(input);
  return {
    ...fallback,
    warnings: ['readability_empty_fallback_deterministic', ...fallback.warnings],
  };
}

export function deterministicStaticHtmlExtractor(input: WebReadHtmlExtractionInput): WebReadHtmlExtractionResult {
  const html = input.html ?? '';
  const title = extractTitle(html);
  const body = extractBody(html) ?? html;
  const cleanedBody = stripNoisyHtml(body);
  const candidates = readableCandidates(cleanedBody);
  const best = chooseBestCandidate(candidates.length ? candidates : [cleanedBody]);
  const markdown = htmlBlockToMarkdown(best);
  const text = normalizeExtractedText(markdown);
  const extractedTitle = extractHeadingTitle(best) ?? title;
  const finalText = extractedTitle && !textStartsWithTitle(text, extractedTitle)
    ? normalizeExtractedText(`${extractedTitle}\n\n${text}`)
    : text;
  const warnings: string[] = [];
  if (finalText.length < 80) warnings.push('low_information_text');
  return {
    method: WEB_READ_STATIC_EXTRACT_METHOD,
    title: extractedTitle,
    text: finalText,
    markdown: finalText,
    lowInformation: finalText.length > 0 && finalText.length < 80,
    warnings,
  };
}

function extractWithReadability(input: WebReadHtmlExtractionInput): WebReadHtmlExtractionResult | undefined {
  const html = input.html ?? '';
  if (!html.trim()) return undefined;

  let dom: JSDOM | undefined;
  try {
    dom = new JSDOM(html, {
      url: input.url,
      contentType: 'text/html',
      virtualConsole: new VirtualConsole(),
    });
    const reader = new Readability(dom.window.document, {
      charThreshold: 20,
    });
    const article = reader.parse();
    const title = extractHeadingTitle(article?.content ?? '') ?? cleanTitle(article?.title ?? '') ?? extractTitle(html);
    const markdown = normalizeExtractedText(article?.content ? htmlBlockToMarkdown(article.content) : '');
    const textFromMarkdown = normalizeExtractedText(markdown);
    const textFromArticle = normalizeExtractedText(article?.textContent ?? '');
    const text = textFromMarkdown || textFromArticle;
    if (!text) return undefined;

    const finalText = title && !textStartsWithTitle(text, title)
      ? normalizeExtractedText(`${title}\n\n${text}`)
      : text;
    const warnings: string[] = [];
    if (finalText.length < 80) warnings.push('low_information_text');
    return {
      method: WEB_READ_READABILITY_EXTRACT_METHOD,
      title,
      text: finalText,
      markdown: finalText,
      lowInformation: finalText.length > 0 && finalText.length < 80,
      warnings,
    };
  } catch {
    return undefined;
  } finally {
    dom?.window.close();
  }
}

function extractTitle(html: string) {
  const metaTitle = firstMetaContent(html, 'og:title')
    ?? firstMetaContent(html, 'twitter:title');
  if (metaTitle) return cleanTitle(metaTitle);
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? cleanTitle(htmlToText(match[1])) : undefined;
}

function firstMetaContent(html: string, property: string) {
  const escaped = escapeRegExp(property);
  const propertyPattern = new RegExp(`<meta\\b(?=[^>]*(?:property|name)\\s*=\\s*["']${escaped}["'])(?=[^>]*content\\s*=\\s*["']([^"']*)["'])[^>]*>`, 'i');
  const match = propertyPattern.exec(html);
  return match?.[1] ? decodeHtmlEntities(match[1]) : undefined;
}

function extractHeadingTitle(html: string) {
  const match = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
  return match ? cleanTitle(htmlToText(match[1])) : undefined;
}

function cleanTitle(value: string) {
  const title = normalizeInlineWhitespace(value);
  if (!title) return undefined;
  const parts = title.split(/\s+(?:[|·•]|[-–—])\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts[0].length >= 8) return parts[0];
  return title;
}

function extractBody(html: string) {
  const match = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return match?.[1];
}

function stripNoisyHtml(html: string) {
  let current = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<canvas\b[\s\S]*?<\/canvas>/gi, ' ');

  const tagNoise = ['nav', 'header', 'footer', 'aside', 'form', 'dialog', 'button'];
  for (const tag of tagNoise) {
    current = removePairedTag(current, tag);
  }
  current = removeAttributeNoise(current);
  return current;
}

function removePairedTag(html: string, tag: string) {
  return html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
}

function removeAttributeNoise(html: string) {
  const noise = [
    'cookie',
    'consent',
    'banner',
    'newsletter',
    'subscribe',
    'sidebar',
    'advert',
    'promo',
    'modal',
    'breadcrumb',
    'related',
    'recommended',
    'trending',
    'share',
    'social',
    'utility',
    'masthead',
    'table-of-contents',
    'toc',
    'on-this-page',
    'site-header',
    'site-footer',
  ].join('|');
  const pattern = new RegExp(
    `<([a-z][a-z0-9-]*)\\b(?=[^>]*(?:class|id|role|aria-label)\\s*=\\s*["'][^"']*(?:${noise})[^"']*["'])[^>]*>[\\s\\S]*?<\\/\\1>`,
    'gi',
  );
  return html.replace(pattern, ' ');
}

function readableCandidates(html: string) {
  const candidates: string[] = [];
  const patterns = [
    /<article\b[^>]*>[\s\S]*?<\/article>/gi,
    /<main\b[^>]*>[\s\S]*?<\/main>/gi,
    /<([a-z][a-z0-9-]*)\b(?=[^>]*itemprop\s*=\s*["']articleBody["'])[^>]*>[\s\S]*?<\/\1>/gi,
    /<([a-z][a-z0-9-]*)\b(?=[^>]*role\s*=\s*["']main["'])[^>]*>[\s\S]*?<\/\1>/gi,
    /<section\b(?=[^>]*(?:class|id)\s*=\s*["'][^"']*(?:article|content|post|entry|story)[^"']*["'])[^>]*>[\s\S]*?<\/section>/gi,
    /<section\b(?=[^>]*(?:class|id)\s*=\s*["'][^"']*(?:docs?|document|markdown|reference|guide)[^"']*["'])[^>]*>[\s\S]*?<\/section>/gi,
    /<div\b(?=[^>]*(?:class|id)\s*=\s*["'][^"']*(?:article|articleBody|content|post|entry|story|main)[^"']*["'])[^>]*>[\s\S]*?<\/div>/gi,
    /<div\b(?=[^>]*(?:class|id)\s*=\s*["'][^"']*(?:docs?|document|markdown|reference|guide)[^"']*["'])[^>]*>[\s\S]*?<\/div>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (match[0]) candidates.push(match[0]);
    }
  }
  candidates.push(html);
  return candidates;
}

function chooseBestCandidate(candidates: string[]) {
  let best = candidates[0] ?? '';
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const text = htmlToText(candidate);
    const length = text.length;
    const paragraphCount = (candidate.match(/<\/p>/gi) ?? []).length;
    const headingCount = (candidate.match(/<h[1-3]\b/gi) ?? []).length;
    const linkText = [...candidate.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => htmlToText(match[1] ?? '').length)
      .reduce((sum, value) => sum + value, 0);
    const linkDensity = length > 0 ? linkText / length : 1;
    const score = length + paragraphCount * 140 + headingCount * 80 - linkDensity * 600;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function htmlBlockToMarkdown(html: string) {
  let current = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|main|blockquote)>/gi, '\n\n')
    .replace(/<(?:p|div|section|article|main|blockquote)\b[^>]*>/gi, '\n')
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_match, content: string) => `\n# ${htmlToText(content)}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_match, content: string) => `\n## ${htmlToText(content)}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_match, content: string) => `\n### ${htmlToText(content)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_match, content: string) => `\n- ${normalizeInlineWhitespace(htmlToText(content))}`)
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (_match, content: string) => htmlToText(content));
  current = current.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(current);
}

function htmlToText(html: string) {
  return normalizeInlineWhitespace(decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')));
}

function normalizeExtractedText(value: string) {
  return value
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => normalizeInlineWhitespace(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeInlineWhitespace(value: string) {
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function textStartsWithTitle(text: string, title: string) {
  const normalizedText = normalizeInlineWhitespace(text).toLowerCase();
  const normalizedTitle = normalizeInlineWhitespace(title).toLowerCase();
  return normalizedText === normalizedTitle || normalizedText.startsWith(`${normalizedTitle} `);
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
