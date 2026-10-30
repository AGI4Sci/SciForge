import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

/**
 * Full-text ingestion for Paper Radar: fetch a paper PDF, extract its text with line and page
 * structure preserved, split it into sections, and report how reliable that split is.
 *
 * Section detection is heuristic. Instead of hiding that, every document carries a
 * `reliability` block so callers (and eventually the deep-read contract) can see when a paper
 * was only partly understood rather than silently treating the result as complete.
 */

export type FulltextSectionKind =
  | 'front_matter'
  | 'abstract'
  | 'introduction'
  | 'background'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'references'
  | 'acknowledgements'
  | 'appendix'
  | 'other';

export interface FulltextLine {
  page: number;
  text: string;
}

export interface FulltextSection {
  kind: FulltextSectionKind;
  /** Heading text as it appears in the paper; empty for front matter. */
  heading: string;
  text: string;
  pageStart: number;
  pageEnd: number;
}

export type FulltextStatus = 'ok' | 'partial' | 'failed';

export type FulltextWarning =
  | 'no_text_layer'
  | 'no_headings_found'
  | 'core_sections_missing'
  | 'introduction_unheaded'
  | 'truncated_pages'
  | 'truncated_chars';

export interface FulltextReliability {
  status: FulltextStatus;
  /** Canonical section kinds that were actually recognized (front matter and `other` excluded). */
  recognizedKinds: FulltextSectionKind[];
  /** Core kinds (introduction, methods, results) that were not found. Informational, not an error. */
  missingCoreKinds: FulltextSectionKind[];
  warnings: FulltextWarning[];
}

export interface FulltextDocument {
  pageCount: number;
  charCount: number;
  sections: FulltextSection[];
  reliability: FulltextReliability;
}

export interface ExtractedPdfLines {
  lines: FulltextLine[];
  pageCount: number;
  truncatedPages: boolean;
  truncatedChars: boolean;
}

export interface ExtractPdfOptions {
  maxPages?: number;
  maxChars?: number;
}

export const DEFAULT_FULLTEXT_MAX_PAGES = 80;
export const DEFAULT_FULLTEXT_MAX_CHARS = 600_000;
export const DEFAULT_PDF_MAX_BYTES = 25 * 1024 * 1024;
export const DEFAULT_PDF_FETCH_TIMEOUT_MS = 60_000;

export type FulltextErrorCode =
  | 'invalid_url'
  | 'forbidden_target'
  | 'upstream_error'
  | 'not_pdf'
  | 'too_large'
  | 'timeout'
  | 'extract_failed';

export class FulltextError extends Error {
  readonly code: FulltextErrorCode;

  constructor(code: FulltextErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'FulltextError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------

export interface FetchPdfOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** Cancels the download. A cancelled fetch rejects with an AbortError rather than a timeout. */
  signal?: AbortSignal;
}

/**
 * Download a PDF into memory. The timeout covers the response body as well as the headers, and
 * the body is read with a hard byte cap so an oversized or endless response cannot exhaust memory.
 *
 * URLs come from paper metadata, so they are untrusted: literal private-network and loopback
 * targets are refused, and redirects are followed manually so every hop is checked, not just the
 * first. Names that only resolve to private addresses need DNS-layer protection, which a URL
 * check cannot provide.
 */
export async function fetchPdfBytes(pdfUrl: string, options: FetchPdfOptions = {}): Promise<Uint8Array> {
  let url: URL;
  try {
    url = new URL(pdfUrl);
  } catch (error) {
    throw new FulltextError('invalid_url', 'The PDF URL is not a valid URL.', { cause: error });
  }
  assertPublicPdfTarget(url);

  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = positiveInteger(options.maxBytes, DEFAULT_PDF_MAX_BYTES);
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PDF_FETCH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const external = options.signal;
  const onAbort = (): void => controller.abort();
  const cancelled = (): Error => Object.assign(new Error('Fetching the PDF was cancelled.'), { name: 'AbortError' });
  if (external?.aborted) {
    clearTimeout(timer);
    throw cancelled();
  }
  external?.addEventListener('abort', onAbort, { once: true });
  const timedOut = (): Error =>
    external?.aborted ? cancelled() : new FulltextError('timeout', `Fetching the PDF timed out after ${timeoutMs} ms.`);

  try {
    let response: Response | undefined;
    for (let hop = 0; ; hop += 1) {
      let current: Response;
      try {
        current = await fetchImpl(url.href, { signal: controller.signal, redirect: 'manual' });
      } catch (error) {
        if (controller.signal.aborted) throw timedOut();
        throw new FulltextError('upstream_error', 'Fetching the PDF failed.', { cause: error });
      }
      if (current.status >= 300 && current.status < 400) {
        if (hop >= MAX_PDF_REDIRECTS) {
          throw new FulltextError('upstream_error', `Fetching the PDF exceeded ${MAX_PDF_REDIRECTS} redirects.`);
        }
        const location = current.headers.get('location');
        if (!location) {
          throw new FulltextError('upstream_error', `The PDF redirect with HTTP ${current.status} has no target.`);
        }
        try {
          url = new URL(location, url);
        } catch (error) {
          throw new FulltextError('upstream_error', 'The PDF redirect target is not a valid URL.', { cause: error });
        }
        assertPublicPdfTarget(url);
        continue;
      }
      response = current;
      break;
    }
    if (!response) throw new FulltextError('upstream_error', 'Fetching the PDF failed.');
    if (!response.ok) {
      throw new FulltextError('upstream_error', `Fetching the PDF failed with HTTP ${response.status}.`);
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new FulltextError('too_large', `The PDF is larger than the ${maxBytes} byte limit.`);
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new FulltextError('too_large', `The PDF is larger than the ${maxBytes} byte limit.`);
          }
          chunks.push(value);
        }
      }
    } catch (error) {
      if (error instanceof FulltextError) throw error;
      if (controller.signal.aborted) throw timedOut();
      throw new FulltextError('upstream_error', 'Reading the PDF response failed.', { cause: error });
    }

    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (!startsWithPdfMagic(bytes)) {
      throw new FulltextError('not_pdf', 'The downloaded file is not a PDF.');
    }
    return bytes;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  }
}

const MAX_PDF_REDIRECTS = 5;

function assertPublicPdfTarget(url: URL): void {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new FulltextError('invalid_url', `Unsupported PDF URL protocol "${url.protocol}".`);
  }
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || isPrivateIpLiteral(host)) {
    throw new FulltextError('forbidden_target', `PDF URL host "${host}" is a local or private network target.`);
  }
}

function isPrivateIpLiteral(host: string): boolean {
  const v4 = parseIpv4(host);
  if (v4) return isPrivateIpv4(v4);
  // Dotted-quad-shaped hosts that fail strict parsing (leading zeros such as
  // 0177.0.0.1, or out-of-range octets) are numeric aliases some resolvers
  // read as octal: refuse them instead of falling through to DNS.
  if (/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.test(host)) return true;
  const v6 = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!v6.includes(':')) return false;
  if (v6 === '::1' || v6 === '::') return true;
  if (v6.startsWith('::ffff:')) {
    // IPv4-mapped; WHATWG URLs normalize the dotted form to two hex groups (::ffff:7f00:1).
    const rest = v6.slice('::ffff:'.length);
    const dotted = parseIpv4(rest);
    if (dotted) return isPrivateIpv4(dotted);
    const groups = rest.split(':').filter((group) => group.length > 0);
    if (groups.length === 2 && groups.every((group) => /^[0-9a-f]{1,4}$/u.test(group))) {
      const high = parseInt(groups[0], 16);
      const low = parseInt(groups[1], 16);
      return isPrivateIpv4([high >> 8, high & 0xff, low >> 8, low & 0xff]);
    }
    return false;
  }
  const first = v6.split(':', 1)[0];
  if (/^fe[89ab]/u.test(first)) return true; // fe80::/10 link-local
  if (first.startsWith('fc') || first.startsWith('fd')) return true; // fc00::/7 unique-local
  return false;
}

function isPrivateIpv4([a, b]: readonly [number, number, number, number]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function parseIpv4(host: string): [number, number, number, number] | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  // Leading zeros make a dotted quad ambiguous: some resolvers read 0177 as
  // octal for 127. Such hosts are refused by the caller, never parsed here.
  const octets = parts.map((part) => (/^(?:0|[1-9]\d{0,2})$/u.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet > 255)) return undefined;
  return octets as [number, number, number, number];
}

function startsWithPdfMagic(bytes: Uint8Array): boolean {
  // The header may be preceded by a few junk bytes; the PDF spec allows this within the first 1 KiB.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  return head.includes('%PDF-');
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;
}

// ---------------------------------------------------------------------------------------------
// PDF text extraction
// ---------------------------------------------------------------------------------------------

interface PdfTextItem {
  str?: unknown;
  transform?: unknown;
  width?: unknown;
  height?: unknown;
  hasEOL?: unknown;
}

interface PdfJsModule {
  getDocument: (options: unknown) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{ items?: unknown[] }>;
        cleanup?: () => void;
      }>;
      destroy: () => Promise<void>;
    }>;
  };
}

const pdfJsModuleSpecifier: string = 'pdfjs-dist/legacy/build/pdf.mjs';
const nodeRequire = createRequire(import.meta.url);
let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let standardFontDataUrl: string | undefined;

async function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfJsModulePromise) {
    // pdf.js probes for a few browser globals at import time; they are not used for text extraction.
    const target = globalThis as unknown as Record<string, unknown>;
    target.DOMMatrix ??= class DOMMatrix {};
    target.ImageData ??= class ImageData {};
    target.Path2D ??= class Path2D {};
    pdfJsModulePromise = import(pdfJsModuleSpecifier) as Promise<PdfJsModule>;
  }
  return pdfJsModulePromise;
}

function pdfStandardFontDataUrl(): string | undefined {
  if (standardFontDataUrl === undefined) {
    try {
      standardFontDataUrl = `${join(dirname(nodeRequire.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;
    } catch {
      standardFontDataUrl = '';
    }
  }
  return standardFontDataUrl || undefined;
}

/**
 * Extract text as lines with page numbers. Unlike a flat join of text items, this keeps line
 * boundaries, which section-heading detection depends on.
 */
export async function extractPdfLines(data: Uint8Array, options: ExtractPdfOptions = {}): Promise<ExtractedPdfLines> {
  const maxPages = positiveInteger(options.maxPages, DEFAULT_FULLTEXT_MAX_PAGES);
  const maxChars = positiveInteger(options.maxChars, DEFAULT_FULLTEXT_MAX_CHARS);
  try {
    const pdfjs = await loadPdfJs();
    const loadingTask = pdfjs.getDocument({
      // pdf.js may take ownership of the buffer, so hand it a copy.
      data: new Uint8Array(data),
      disableAutoFetch: true,
      disableFontFace: true,
      disableWorker: true,
      isEvalSupported: false,
      standardFontDataUrl: pdfStandardFontDataUrl(),
      useSystemFonts: false,
    });
    const document = await loadingTask.promise;
    const lines: FulltextLine[] = [];
    let chars = 0;
    let truncatedChars = false;
    const pageLimit = Math.min(document.numPages, maxPages);
    try {
      for (let pageNumber = 1; pageNumber <= pageLimit && !truncatedChars; pageNumber += 1) {
        const page = await document.getPage(pageNumber);
        const content = await page.getTextContent();
        for (const text of itemsToLines(content.items ?? [])) {
          if (chars + text.length > maxChars) {
            truncatedChars = true;
            break;
          }
          lines.push({ page: pageNumber, text });
          chars += text.length + 1;
        }
        page.cleanup?.();
      }
    } finally {
      await document.destroy();
    }
    return {
      lines,
      pageCount: document.numPages,
      truncatedPages: document.numPages > pageLimit,
      truncatedChars,
    };
  } catch (error) {
    throw new FulltextError('extract_failed', 'PDF text extraction failed.', { cause: error });
  }
}

/** Rebuild lines from pdf.js text items using their vertical position and horizontal gaps. */
function itemsToLines(items: unknown[]): string[] {
  const lines: string[] = [];
  let buffer = '';
  let currentY: number | null = null;
  let previousEnd = 0;

  const flush = (): void => {
    const line = buffer.replace(/\s+/g, ' ').trim();
    if (line) lines.push(line.normalize('NFKC'));
    buffer = '';
    currentY = null;
  };

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as PdfTextItem;
    if (typeof item.str !== 'string') continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = typeof transform[4] === 'number' ? transform[4] : 0;
    const y = typeof transform[5] === 'number' ? transform[5] : 0;
    const width = typeof item.width === 'number' ? item.width : 0;
    const height = typeof item.height === 'number' ? item.height : 0;

    if (currentY !== null && Math.abs(y - currentY) > Math.max(2.5, height * 0.4)) flush();
    if (currentY === null) currentY = y;

    if (item.str.trim() === '') {
      if (buffer && !buffer.endsWith(' ')) buffer += ' ';
    } else {
      const gap = x - previousEnd;
      if (buffer && !buffer.endsWith(' ') && gap > Math.max(1, height * 0.2)) buffer += ' ';
      buffer += item.str;
    }
    previousEnd = x + width;

    if (item.hasEOL === true) flush();
  }
  flush();
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Section detection
// ---------------------------------------------------------------------------------------------

const CANONICAL_HEADINGS: ReadonlyArray<readonly [FulltextSectionKind, RegExp]> = [
  ['abstract', /^abstract$/],
  ['introduction', /^introduction$/],
  ['background', /^(?:background|related works?|literature review|preliminaries|prior work)$/],
  [
    'methods',
    /^(?:methods?|methodology|(?:materials?|patients?|subjects?|participants?) and methods?|methods? and materials?|experimental (?:procedures?|methods?|design|setup)|approach|our approach|study design|proposed method)$/,
  ],
  ['results', /^(?:results?|results and discussion|experiments?|experimental results|evaluation|findings)$/],
  ['discussion', /^(?:discussion|limitations|general discussion)$/],
  ['conclusion', /^(?:conclusions?|concluding remarks|conclusions? and future work|summary)$/],
  ['references', /^(?:references|bibliography|literature cited|works cited)$/],
  [
    'acknowledgements',
    /^(?:acknowledge?ments?(?: and disclosures?)?|funding(?: statements?)?|author contributions?|credit authorship contribution statement|conflicts? of interests?(?: statement)?|competing interests?|declarations? of (?:competing )?interests?|disclosures?|(?:data|code)(?: and (?:data|code))? availab\w*(?: statement)?|ethics(?: statement| approval)?|generative ai statement|publisher.?s note)$/,
  ],
  [
    'appendix',
    /^(?:(?:appendix|appendices)(?: [a-z0-9])?(?:[.:] ?[a-z ,&-]{3,60})?|supplementary (?:material|information|data)s?|supporting information)$/,
  ],
];

const RUN_IN_BACK_MATTER =
  /^(conflicts? of interests?|competing interests?|declarations? of (?:competing )?interests?|funding|data availability(?: statement)?|code availability|author contributions?|acknowledge?ments?|ethics(?: statement| approval)?|generative ai statement|publisher.?s note)\s*[:—–]\s*(\S.{9,})$/i;

const UNHEADED_INTRODUCTION_MIN_CHARS = 4_000;

const CORE_KINDS: readonly FulltextSectionKind[] = ['introduction', 'methods', 'results'];
const MAX_HEADING_LENGTH = 70;

export interface ClassifiedHeading {
  kind: FulltextSectionKind;
  heading: string;
  /** Text that followed an inline heading on the same line, e.g. "Abstract. We show ...". */
  rest?: string;
}

/**
 * Decide whether a line is a section heading. Returns null for ordinary text. Numbered headings
 * that do not match a canonical name (e.g. "3 Voyager") are reported as kind `other`.
 */
export function classifyHeading(line: string): ClassifiedHeading | null {
  const text = line.trim();
  if (!text || text.length > 400) return null;

  const inlineAbstract = /^abstract\b\s*[.:—–-]+\s*(\S.{19,})$/i.exec(text);
  if (inlineAbstract) return { kind: 'abstract', heading: 'Abstract', rest: inlineAbstract[1] };

  // Back-matter headings are often run in with their text: "Conflict of Interest: The authors ...".
  const runIn = RUN_IN_BACK_MATTER.exec(text);
  if (runIn) return { kind: 'acknowledgements', heading: runIn[1], rest: runIn[2] };

  if (text.length > MAX_HEADING_LENGTH) return null;

  const stripped = stripNumbering(text);
  // A trailing period is kept: "Methods." is the start of a sentence, not a heading.
  let normalized = stripped.body
    .toLowerCase()
    .replace(/:+$/, '')
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
    .trim();
  // Letter-spaced headings such as "A B S T R A C T" collapse to a single word.
  if (/^(?:[a-z] ){3,}[a-z]$/.test(normalized)) normalized = normalized.replace(/ /g, '');
  // Small-caps headings often extract with a detached first letter, e.g. "I NTRODUCTION".
  normalized = normalized.replace(/^([a-z]) (?=[a-z]{3,}$)/, '$1');
  if (!normalized) return null;

  for (const [kind, pattern] of CANONICAL_HEADINGS) {
    if (pattern.test(normalized)) return { kind, heading: stripped.body.replace(/[:.]+$/, '').trim() };
  }

  // A numbered top-level heading such as "3 Voyager" still starts a new section. Lines that end
  // like a list or a sentence fragment (author lists, contribution statements) are not headings.
  if (
    stripped.numbered &&
    stripped.topLevel &&
    /^[A-Z][A-Za-z0-9 ,:'’\-–&()/]{2,69}$/.test(stripped.body) &&
    !/[.,;:\-–]$/.test(stripped.body)
  ) {
    return { kind: 'other', heading: stripped.body };
  }
  // Review articles often use unnumbered all-caps headings, e.g. "METHODOLOGICAL CONSIDERATIONS".
  if (!stripped.numbered && !ARTICLE_TYPE_LABEL.test(text) && isAllCapsHeading(text)) return { kind: 'other', heading: text };
  return null;
}

/** Journal article-type labels printed above the title ("RESEARCH ARTICLE"); they are not sections. */
const ARTICLE_TYPE_LABEL = /^(?:original|research|review|brief|short|special|invited|open)\s+(?:article|research|report|paper|communication|access)s?$/i;

const CAPS_HEADING_STOP_WORDS = new Set(['OF', 'IN', 'ON', 'TO', 'BY', 'AS', 'AT', 'OR', 'AND', 'FOR', 'THE']);

/**
 * Unnumbered all-caps headings must look like phrases: figure labels such as "EP EP EP" or a bare
 * acronym pair are all-caps too, so require reasonably long words (short function words excepted).
 */
function isAllCapsHeading(text: string): boolean {
  if (text.length < 12 || !/^[A-Z][A-Z ,&\-–]{4,58}[A-Z]$/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 8) return false;
  return words.every((word) => word.replace(/[^A-Z]/g, '').length >= 3 || CAPS_HEADING_STOP_WORDS.has(word));
}

function stripNumbering(text: string): { body: string; numbered: boolean; topLevel: boolean } {
  const arabic = /^(\d{1,2})(\.\d+)*[.)]?\s+(\S.*)$/.exec(text);
  if (arabic) return { body: arabic[3], numbered: true, topLevel: arabic[2] === undefined };
  const roman = /^([IVXLC]{1,6})\.\s+(\S.*)$/.exec(text);
  if (roman) return { body: roman[2], numbered: true, topLevel: true };
  const letter = /^([A-Z])\.\s+(\S.*)$/.exec(text);
  if (letter) return { body: letter[2], numbered: true, topLevel: true };
  return { body: text, numbered: false, topLevel: false };
}

/**
 * Drop text that repeats on many pages (running headers and footers) and bare page numbers, so
 * they do not leak into section text.
 */
export function removePageFurniture(lines: readonly FulltextLine[], pageCount: number): FulltextLine[] {
  if (pageCount < 3) return lines.filter((line) => !/^\d{1,3}$/.test(line.text));
  const pagesByKey = new Map<string, Set<number>>();
  for (const line of lines) {
    if (line.text.length > MAX_FURNITURE_LENGTH) continue;
    const key = furnitureKey(line.text);
    const pages = pagesByKey.get(key) ?? new Set<number>();
    pages.add(line.page);
    pagesByKey.set(key, pages);
  }
  const threshold = Math.max(3, Math.ceil(pageCount * 0.4));
  return lines.filter((line) => {
    if (/^\d{1,3}$/.test(line.text)) return false;
    if (line.text.length > MAX_FURNITURE_LENGTH) return true;
    const pages = pagesByKey.get(furnitureKey(line.text));
    return !pages || pages.size < threshold;
  });
}

const MAX_FURNITURE_LENGTH = 90;
/** Only short lines are digit-normalized ("Page 3 of 10"); a long body line must repeat verbatim. */
const MAX_DIGIT_NORMALIZED_LENGTH = 48;

function furnitureKey(text: string): string {
  return text.length <= MAX_DIGIT_NORMALIZED_LENGTH ? text.replace(/\d+/g, '#') : text;
}

/** Split lines into sections. Text before the first heading becomes front matter. */
export function splitSections(lines: readonly FulltextLine[]): FulltextSection[] {
  const sections: Array<{ kind: FulltextSectionKind; heading: string; lines: string[]; pageStart: number; pageEnd: number }> = [];
  let current = { kind: 'front_matter' as FulltextSectionKind, heading: '', lines: [] as string[], pageStart: lines[0]?.page ?? 1, pageEnd: lines[0]?.page ?? 1 };

  const pushCurrent = (): void => {
    if (current.lines.length > 0 || current.heading) sections.push(current);
  };

  // Non-canonical ("other") headings are only trusted once a canonical section has started, and
  // never inside the reference list, where numbered entries would otherwise look like headings.
  let seenCanonical = false;
  let inReferences = false;

  for (const line of lines) {
    let heading = classifyHeading(line.text);
    if (heading?.kind === 'other' && (!seenCanonical || inReferences)) heading = null;
    if (heading) {
      if (heading.kind !== 'other') {
        seenCanonical = true;
        inReferences = heading.kind === 'references';
      }
      pushCurrent();
      current = { kind: heading.kind, heading: heading.heading, lines: [], pageStart: line.page, pageEnd: line.page };
      if (heading.rest) current.lines.push(heading.rest);
      continue;
    }
    current.lines.push(line.text);
    current.pageEnd = line.page;
  }
  pushCurrent();

  return sections.map((section) => ({
    kind: section.kind,
    heading: section.heading,
    text: joinWrappedLines(section.lines),
    pageStart: section.pageStart,
    pageEnd: section.pageEnd,
  }));
}

/** Join wrapped lines into paragraphs text, repairing words hyphenated across a line break. */
function joinWrappedLines(lines: readonly string[]): string {
  let out = '';
  for (const line of lines) {
    if (!out) {
      out = line;
    } else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(line)) {
      out = out.slice(0, -1) + line;
    } else {
      out += ` ${line}`;
    }
  }
  return out.trim();
}

/** Assess how much of the paper's structure was recognized. */
export function assessReliability(input: {
  sections: readonly FulltextSection[];
  charCount: number;
  truncatedPages?: boolean;
  truncatedChars?: boolean;
}): FulltextReliability {
  const warnings: FulltextWarning[] = [];
  if (input.truncatedPages) warnings.push('truncated_pages');
  if (input.truncatedChars) warnings.push('truncated_chars');

  const recognized: FulltextSectionKind[] = [...new Set(input.sections.map((s) => s.kind))].filter(
    (kind) => kind !== 'front_matter' && kind !== 'other',
  );
  const missingCoreKinds = CORE_KINDS.filter((kind) => !recognized.includes(kind));

  if (input.charCount === 0) {
    return { status: 'failed', recognizedKinds: [], missingCoreKinds: [...CORE_KINDS], warnings: ['no_text_layer', ...warnings] };
  }
  if (recognized.length === 0) {
    return { status: 'failed', recognizedKinds: [], missingCoreKinds: [...CORE_KINDS], warnings: ['no_headings_found', ...warnings] };
  }
  if (missingCoreKinds.length > 0) warnings.push('core_sections_missing');

  // Journals such as Nature print the introduction without a heading. The PDF text carries no
  // layout, so its boundary with the abstract cannot be recovered; say so instead of guessing.
  const leading = input.sections.filter((s) => s.kind === 'front_matter' || s.kind === 'abstract');
  const leadingChars = Math.max(0, ...leading.map((s) => s.text.length));
  const hasBodySection = recognized.some((kind) => kind === 'results' || kind === 'methods' || kind === 'discussion');
  if (!recognized.includes('introduction') && hasBodySection && leadingChars > UNHEADED_INTRODUCTION_MIN_CHARS) {
    warnings.push('introduction_unheaded');
  }

  // "ok" needs the introduction plus at least two other recognized canonical sections.
  const status: FulltextStatus = recognized.includes('introduction') && recognized.length >= 3 ? 'ok' : 'partial';
  return { status, recognizedKinds: recognized, missingCoreKinds, warnings };
}

/** Build a document from already-extracted lines. Pure, so it can be tested without a PDF. */
export function buildFulltextDocument(extracted: ExtractedPdfLines): FulltextDocument {
  const cleaned = removePageFurniture(extracted.lines, extracted.pageCount);
  const sections = splitSections(cleaned);
  const charCount = sections.reduce((total, section) => total + section.text.length, 0);
  return {
    pageCount: extracted.pageCount,
    charCount,
    sections,
    reliability: assessReliability({
      sections,
      charCount,
      truncatedPages: extracted.truncatedPages,
      truncatedChars: extracted.truncatedChars,
    }),
  };
}

/** Extract a PDF and split it into sections in one step. */
export async function extractFulltext(data: Uint8Array, options: ExtractPdfOptions = {}): Promise<FulltextDocument> {
  return buildFulltextDocument(await extractPdfLines(data, options));
}
