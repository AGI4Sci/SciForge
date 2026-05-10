import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

export const CONVERSATION_REFERENCE_DIGEST_SCHEMA_VERSION = 'sciforge.reference-digest.v1' as const;

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl']);
const DISCOVERABLE_REF_EXTENSIONS = ['md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'txt', 'pdf'];
const MAX_READ_BYTES = 1_000_000;
const DEFAULT_DIGEST_CHAR_BUDGET = 1_800;
const DEFAULT_EXCERPT_CHAR_BUDGET = 360;
const PDF_EXTRACTOR = 'pdftotext';
const PDF_EXTRACTOR_STAGE = 'reference-digest.pdf-text-extraction';
const PDF_MAX_PAGES = 8;
const PDF_EXTRACTION_TIMEOUT_MS = 8_000;

type JsonMap = Record<string, unknown>;

export interface ConversationReferenceDigestOptions {
  workspaceRoot: string;
  digestCharBudget?: number;
  excerptCharBudget?: number;
  maxReferences?: number;
  maxCsvRows?: number;
  maxJsonItems?: number;
}

export interface ConversationReferenceDigest {
  schemaVersion: typeof CONVERSATION_REFERENCE_DIGEST_SCHEMA_VERSION;
  id: string;
  sourceRef: string;
  sourceType: string;
  status: string;
  refSafe: boolean;
  path?: string;
  clickableRef?: string;
  mediaType?: string;
  sha256?: string;
  sizeBytes?: number;
  digestText: string;
  excerpts: JsonMap[];
  metrics: JsonMap;
  omitted: JsonMap;
  audit: JsonMap;
}

interface DigestBuildInput {
  references?: unknown[] | null;
  prompt?: string;
  workspaceRoot: string;
  options?: ConversationReferenceDigestOptions | null;
}

export function buildConversationReferenceDigests(input: DigestBuildInput): ConversationReferenceDigest[] {
  const options = normalizeReferenceDigestOptions(input.workspaceRoot, input.options);
  const root = realWorkspaceRoot(options.workspaceRoot);
  const candidates = expandPromptRefs(
    uniqueRefs([...refsFromValues(input.references ?? []), ...refsFromPrompt(input.prompt ?? '')]),
    root,
  );
  const digests: ConversationReferenceDigest[] = [];
  let omitted = 0;
  for (const sourceRef of candidates) {
    if (digests.length >= options.maxReferences) {
      omitted += 1;
      continue;
    }
    digests.push(digestConversationReference(sourceRef, options, root));
  }
  if (omitted && digests.length) {
    digests[digests.length - 1].omitted.referencesAfterLimit = omitted;
  }
  return digests;
}

export function digestConversationReference(
  sourceRef: string | JsonMap,
  options: Required<ConversationReferenceDigestOptions>,
  workspaceRoot?: string,
): ConversationReferenceDigest {
  const root = workspaceRoot ?? realWorkspaceRoot(options.workspaceRoot);
  const refText = sourceRefText(sourceRef);
  const resolved = resolveWorkspacePath(refText, root);
  const digestId = digestIdForRef(refText);
  const baseAudit = { sourceRef: refText, workspaceRoot: root, maxReadBytes: MAX_READ_BYTES };

  if (!resolved) {
    return {
      schemaVersion: CONVERSATION_REFERENCE_DIGEST_SCHEMA_VERSION,
      id: digestId,
      sourceRef: refText,
      sourceType: 'path',
      status: 'unresolved',
      refSafe: true,
      digestText: 'Reference path was not readable inside the workspace.',
      excerpts: [],
      metrics: {},
      omitted: { rawContent: 'not-read' },
      audit: { ...baseAudit, reason: 'outside-workspace-or-missing' },
    };
  }

  const { path, rel } = resolved;
  const stat = statSync(path);
  if (!stat.isFile()) {
    return {
      schemaVersion: CONVERSATION_REFERENCE_DIGEST_SCHEMA_VERSION,
      id: digestId,
      sourceRef: refText,
      sourceType: 'path',
      status: 'unreadable',
      refSafe: true,
      path: rel,
      clickableRef: `file:${rel}`,
      digestText: 'Reference exists but is not a regular file.',
      excerpts: [],
      metrics: {},
      omitted: { rawContent: 'not-regular-file' },
      audit: baseAudit,
    };
  }

  const suffix = extname(path).toLowerCase();
  const common = {
    schemaVersion: CONVERSATION_REFERENCE_DIGEST_SCHEMA_VERSION,
    id: digestId,
    sourceRef: refText,
    path: rel,
    clickableRef: `file:${rel}`,
    sha256: sha256File(path),
    sizeBytes: stat.size,
    refSafe: true,
    audit: { ...baseAudit, reader: 'bounded' },
  };

  if (suffix === '.pdf') {
    return digestPdfReference(path, rel, stat.size, common, options);
  }

  if (!TEXT_EXTENSIONS.has(suffix)) {
    return {
      ...common,
      sourceType: 'path',
      status: 'metadata-only',
      mediaType: mediaType(suffix),
      digestText: 'Non-text reference recorded as metadata only.',
      excerpts: [],
      metrics: {},
      omitted: { rawContent: 'non-text-file', bytes: stat.size },
    };
  }

  const { text, truncatedBytes } = readBoundedText(path);
  const kind = sourceTypeForPath(path);
  const summary = summarizeTextKind(text, kind, options);
  const [digestText, truncatedChars] = clipRefSafe(String(summary.digestText ?? ''), options.digestCharBudget);
  const omitted = { ...recordValue(summary.omitted) };
  if (truncatedBytes) omitted.readBytesAfterLimit = truncatedBytes;
  if (truncatedChars) omitted.digestCharsAfterLimit = truncatedChars;
  return {
    ...common,
    sourceType: kind,
    status: 'ok',
    mediaType: mediaType(suffix),
    digestText,
    excerpts: boundedExcerpts(Array.isArray(summary.excerpts) ? summary.excerpts.filter(recordValue) : [], options.excerptCharBudget),
    metrics: recordValue(summary.metrics) ?? {},
    omitted,
  };
}

export function buildConversationReferenceDigestsFromRequest(request: JsonMap): ConversationReferenceDigest[] {
  const workspace = recordValue(request.workspace) ?? {};
  const limits = recordValue(request.limits) ?? {};
  const workspaceRoot = stringValue(workspace.root) ?? stringValue(request.workspaceRoot) ?? '.';
  const turn = recordValue(request.turn) ?? {};
  const references = Array.isArray(turn.references)
    ? turn.references
    : Array.isArray(request.references)
      ? request.references
      : [];
  return buildConversationReferenceDigests({
    references,
    prompt: stringValue(turn.prompt) ?? stringValue(request.prompt) ?? '',
    workspaceRoot,
    options: {
      workspaceRoot,
      digestCharBudget: numberValue(limits.maxDigestChars) ?? numberValue(limits.maxInlineChars) ?? DEFAULT_DIGEST_CHAR_BUDGET,
      excerptCharBudget: numberValue(limits.maxExcerptChars) ?? DEFAULT_EXCERPT_CHAR_BUDGET,
      maxReferences: numberValue(limits.maxReferences) ?? 12,
    },
  });
}

function normalizeReferenceDigestOptions(workspaceRoot: string, options?: ConversationReferenceDigestOptions | null): Required<ConversationReferenceDigestOptions> {
  return {
    workspaceRoot,
    digestCharBudget: options?.digestCharBudget ?? DEFAULT_DIGEST_CHAR_BUDGET,
    excerptCharBudget: options?.excerptCharBudget ?? DEFAULT_EXCERPT_CHAR_BUDGET,
    maxReferences: options?.maxReferences ?? 12,
    maxCsvRows: options?.maxCsvRows ?? 8,
    maxJsonItems: options?.maxJsonItems ?? 18,
  };
}

function refsFromValues(values: unknown[]): string[] {
  const refs: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      refs.push(value);
      continue;
    }
    const record = recordValue(value);
    if (!record) continue;
    for (const key of ['ref', 'path', 'dataRef', 'artifactRef', 'url']) {
      const item = stringValue(record[key]);
      if (!item) continue;
      refs.push(item);
      break;
    }
  }
  return refs;
}

function refsFromPrompt(prompt: string): string[] {
  if (!prompt) return [];
  const pattern = new RegExp(String.raw`(?:file:)?(?:[./~]?[\w@%+=:,.-]+/)*[\w@%+=:,.-]+\.(${DISCOVERABLE_REF_EXTENSIONS.join('|')})\b`, 'g');
  return [...prompt.matchAll(pattern)].map((match) => match[0]);
}

function uniqueRefs(refs: Iterable<string>): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const ref of refs) {
    const clean = ref.trim().replace(/^[`'"]|[`'"]$/g, '');
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    unique.push(clean);
  }
  return unique;
}

function expandPromptRefs(refs: string[], root: string): string[] {
  const candidateSets = refs.map((ref) => {
    const raw = ref.trim().replace(/^file:/, '').replace(/^\.\//, '');
    const normalized = normalizeWorkspaceRef(ref);
    return raw === normalized ? [normalized] : [raw, normalized];
  });
  const candidates = uniqueRefs(candidateSets.flat());
  const siblingDirs = candidates
    .filter((ref) => ref.includes('/') && dirname(ref) !== '.')
    .map((ref) => dirname(ref));
  const expanded = candidateSets.map((candidateSet) => {
    for (const candidate of candidateSet) {
      if (existsSync(resolve(root, candidate))) return candidate;
    }
    const ref = candidateSet[0] ?? '';
    if (ref.includes('/')) return ref;
    return resolveInSiblingDirs(ref, siblingDirs, root) ?? ref;
  });
  return uniqueRefs(expanded);
}

function resolveInSiblingDirs(ref: string, siblingDirs: string[], root: string): string | undefined {
  for (const dir of siblingDirs) {
    const candidate = `${dir}/${ref}`;
    if (existsSync(resolve(root, candidate))) return candidate;
  }
  const unique = findUniqueWorkspaceFile(ref, root);
  if (unique) return unique;
  return undefined;
}

function sourceRefText(sourceRef: string | JsonMap): string {
  if (typeof sourceRef === 'string') return sourceRef.trim();
  for (const key of ['ref', 'path', 'dataRef', 'artifactRef', 'url']) {
    const value = stringValue(sourceRef[key]);
    if (value) return value.trim();
  }
  return String(sourceRef);
}

function resolveWorkspacePath(ref: string, root: string): { path: string; rel: string } | undefined {
  const raw = ref.trim().replace(/^file:/, '').replace(/^\.\//, '').split('#', 1)[0];
  const normalized = normalizeWorkspaceRef(ref).split('#', 1)[0];
  const candidates = uniqueRefs([normalized, raw]);
  for (const clean of candidates) {
    if (clean.includes('://')) continue;
    const candidate = clean.startsWith('~/') ? resolve(homedir(), clean.slice(2)) : resolve(root, clean);
    if (!existsSync(candidate)) continue;
    const path = realpathSync(candidate);
    const rel = relative(root, path).replaceAll('\\', '/');
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
    return { path, rel };
  }
  return undefined;
}

function findUniqueWorkspaceFile(basename: string, root: string): string | undefined {
  const matches: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name === basename) {
        matches.push(relative(root, full).replaceAll('\\', '/'));
        if (matches.length > 1) return undefined;
      }
    }
  }
  return matches[0];
}

function normalizeWorkspaceRef(ref: string): string {
  let clean = ref.trim().replace(/^file:/, '').replace(/^\.\//, '');
  if (clean.startsWith('workspace/')) clean = clean.slice('workspace/'.length);
  return clean;
}

function sha256File(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(path));
  return hash.digest('hex');
}

function readBoundedText(path: string): { text: string; truncatedBytes: number } {
  const data = readFileSync(path);
  const truncatedBytes = Math.max(0, data.length - MAX_READ_BYTES);
  return { text: data.subarray(0, MAX_READ_BYTES).toString('utf8').replaceAll('\u0000', ''), truncatedBytes };
}

function digestPdfReference(
  path: string,
  rel: string,
  sizeBytes: number,
  common: Omit<ConversationReferenceDigest, 'sourceType' | 'status' | 'mediaType' | 'digestText' | 'excerpts' | 'metrics' | 'omitted'>,
  options: Required<ConversationReferenceDigestOptions>,
): ConversationReferenceDigest {
  const extraction = extractPdfTextBounded(path);
  if (!extraction.ok) {
    const diagnostic = pdfExtractionDiagnostic(rel, extraction);
    return {
      ...common,
      sourceType: 'pdf',
      status: 'failed',
      mediaType: 'application/pdf',
      digestText: [
        `PDF digest: text extraction failed at ${PDF_EXTRACTOR_STAGE}.`,
        `Extractor: ${PDF_EXTRACTOR}; fileRef: file:${rel}; errorType: ${diagnostic.errorType}.`,
        `Next steps: ${(diagnostic.nextSteps as string[]).slice(0, 2).join(' ')}`,
      ].join('\n'),
      excerpts: [{ kind: 'extraction-diagnostic', stage: PDF_EXTRACTOR_STAGE, extractor: PDF_EXTRACTOR, text: diagnostic.summary }],
      metrics: { extractedPageCount: 0, textChars: 0, fallbackAvailable: false },
      omitted: { rawContent: 'pdf-extraction-failed', bytes: sizeBytes, diagnostic },
      audit: {
        ...common.audit,
        reader: 'pdf-bounded-extractor',
        extraction: diagnostic,
      },
    };
  }

  const summary = summarizePdfText(extraction.text);
  const [digestText, truncatedChars] = clipRefSafe(String(summary.digestText ?? ''), options.digestCharBudget);
  const omitted = { ...recordValue(summary.omitted) };
  if (truncatedChars) omitted.digestCharsAfterLimit = truncatedChars;
  if (extraction.truncatedChars) omitted.extractedCharsAfterLimit = extraction.truncatedChars;
  if (extraction.pagesAfterLimit) omitted.pagesAfterLimit = extraction.pagesAfterLimit;
  omitted.rawContent = 'pdf-text-extracted-bounded';
  return {
    ...common,
    sourceType: 'pdf',
    status: 'ok',
    mediaType: 'application/pdf',
    digestText,
    excerpts: boundedExcerpts(Array.isArray(summary.excerpts) ? summary.excerpts.filter(recordValue) : [], options.excerptCharBudget),
    metrics: {
      ...recordValue(summary.metrics),
      extractor: PDF_EXTRACTOR,
      stage: PDF_EXTRACTOR_STAGE,
      pageLimit: PDF_MAX_PAGES,
      fallbackAvailable: true,
    },
    omitted,
    audit: {
      ...common.audit,
      reader: 'pdf-bounded-extractor',
      extraction: {
        extractor: PDF_EXTRACTOR,
        stage: PDF_EXTRACTOR_STAGE,
        fileRef: `file:${rel}`,
        status: 'ok',
        pageLimit: PDF_MAX_PAGES,
        timeoutMs: PDF_EXTRACTION_TIMEOUT_MS,
      },
    },
  };
}

type PdfExtractionResult =
  | { ok: true; text: string; truncatedChars: number; pagesAfterLimit: number }
  | { ok: false; errorType: string; message: string; stderr?: string; exitCode?: number | string; signal?: string };

function extractPdfTextBounded(path: string): PdfExtractionResult {
  try {
    const output = execFileSync(PDF_EXTRACTOR, ['-layout', '-enc', 'UTF-8', '-f', '1', '-l', String(PDF_MAX_PAGES), path, '-'], {
      encoding: 'utf8',
      maxBuffer: MAX_READ_BYTES,
      timeout: PDF_EXTRACTION_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const text = String(output || '').replaceAll('\u0000', '').trim();
    if (!text) {
      return {
        ok: false,
        errorType: 'empty-output',
        message: `${PDF_EXTRACTOR} returned no text for the requested page range.`,
      };
    }
    const [bounded, truncatedChars] = clipRefSafe(text, MAX_READ_BYTES);
    const pages = text.split('\f').length;
    return { ok: true, text: bounded, truncatedChars, pagesAfterLimit: Math.max(0, pages - PDF_MAX_PAGES) };
  } catch (error) {
    const record = recordValue(error) ?? {};
    const stderr = bufferOrString(record.stderr);
    const message = error instanceof Error && error.message ? error.message : stderr || `${PDF_EXTRACTOR} failed`;
    return {
      ok: false,
      errorType: classifyPdfExtractionError(message, stderr, record),
      message: scrubInline(message),
      stderr: stderr ? scrubInline(stderr).slice(0, 800) : undefined,
      exitCode: typeof record.status === 'number' || typeof record.status === 'string' ? record.status : undefined,
      signal: typeof record.signal === 'string' ? record.signal : undefined,
    };
  }
}

function summarizePdfText(text: string): JsonMap {
  const pages = text.split('\f').map((page) => page.trim()).filter(Boolean);
  const lines = text.split(/\r?\n/);
  const pageExcerpts = pages.slice(0, 4).map((page, index) => {
    const firstUseful = page.split(/\r?\n/).find((line) => line.trim().length > 20) ?? page.slice(0, 240);
    return { kind: 'pdf-page', page: index + 1, text: scrubInline(firstUseful) };
  });
  return {
    digestText: `PDF digest: extracted bounded text from pages 1-${Math.min(PDF_MAX_PAGES, Math.max(1, pages.length))} with ${lines.length} lines and ${text.length} chars.`,
    excerpts: pageExcerpts,
    metrics: { extractedPageCount: pages.length, lineCount: lines.length, textChars: text.length },
    omitted: { fullPdfText: 'refs-first-not-inlined' },
  };
}

function pdfExtractionDiagnostic(rel: string, failure: Extract<PdfExtractionResult, { ok: false }>): JsonMap {
  return {
    extractor: PDF_EXTRACTOR,
    stage: PDF_EXTRACTOR_STAGE,
    fileRef: `file:${rel}`,
    errorType: failure.errorType,
    message: failure.message || 'PDF text extraction failed with a classified error.',
    stderr: failure.stderr,
    exitCode: failure.exitCode,
    signal: failure.signal,
    summary: `PDF extraction failed via ${PDF_EXTRACTOR} at ${PDF_EXTRACTOR_STAGE}; fileRef=file:${rel}; errorType=${failure.errorType}.`,
    nextSteps: pdfExtractionNextSteps(failure.errorType),
  };
}

function classifyPdfExtractionError(message: string, stderr: string | undefined, record: JsonMap): string {
  const combined = `${message}\n${stderr ?? ''}`.toLowerCase();
  if (record.code === 'ENOENT' || combined.includes('enoent')) return 'missing-extractor';
  if (combined.includes('timed out') || record.signal === 'SIGTERM') return 'timeout';
  if (combined.includes('permission denied')) return 'permission-denied';
  if (combined.includes('incorrect password') || combined.includes('encrypted')) return 'encrypted-pdf';
  if (combined.includes('may not be a pdf') || combined.includes('syntax error') || combined.includes('xref') || combined.includes('trailer')) return 'invalid-pdf';
  if (combined.includes('no text') || combined.includes('empty')) return 'empty-output';
  return 'extractor-failed';
}

function pdfExtractionNextSteps(errorType: string): string[] {
  if (errorType === 'missing-extractor') return [
    'Install poppler/pdftotext or select a runtime image that provides it.',
    'Retry the same workspace ref so the digest records bounded page text.',
  ];
  if (errorType === 'encrypted-pdf') return [
    'Provide an unlocked PDF or a permitted text/supplementary source ref.',
    'Record this as missing evidence if the full text cannot be legally read.',
  ];
  if (errorType === 'invalid-pdf') return [
    'Verify the uploaded file is a complete PDF and re-upload if it is truncated.',
    'Use DOI/PMID/landing-page metadata as bounded refs while full text remains unavailable.',
  ];
  if (errorType === 'empty-output') return [
    'Try OCR or publisher XML when the PDF is scanned or text is embedded as images.',
    'Continue with metadata-only evidence and mark claim extraction as partial.',
  ];
  return [
    'Inspect stderr and retry with a different bounded extractor or source format.',
    'Preserve the failure artifact and continue with explicit missing evidence.',
  ];
}

function bufferOrString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return undefined;
}

function sourceTypeForPath(path: string): string {
  const suffix = extname(path).toLowerCase();
  if (suffix === '.md' || suffix === '.markdown') return 'markdown';
  if (suffix === '.json' || suffix === '.jsonl') return 'json';
  if (suffix === '.csv' || suffix === '.tsv') return 'csv';
  return 'text';
}

function summarizeTextKind(text: string, kind: string, options: Required<ConversationReferenceDigestOptions>): JsonMap {
  if (kind === 'markdown') return summarizeMarkdown(text);
  if (kind === 'json') return summarizeJson(text, options.maxJsonItems);
  if (kind === 'csv') return summarizeCsv(text, options.maxCsvRows);
  return summarizePlainText(text);
}

function summarizeMarkdown(text: string): JsonMap {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const headings = lines.filter((line) => /^#{1,6}\s+/.test(line)).map((line) => line.replace(/^#+\s*/, '').trim());
  const bullets = lines.filter((line) => /^\s*[-*]\s+/.test(line)).map((line) => line.replace(/^\s*[-*]\s+/, '').trim());
  const tables = lines.filter((line) => line.includes('|') && line.trim().length > 3);
  const digestLines = [`Markdown digest: headings=${headings.length}, bullets=${bullets.length}, tableLines=${tables.length}.`];
  if (headings.length) digestLines.push(`Headings: ${headings.slice(0, 8).map(scrubInline).join('; ')}`);
  if (bullets.length) digestLines.push(`Representative bullets: ${bullets.slice(0, 5).map(scrubInline).join('; ')}`);
  return {
    digestText: digestLines.join('\n'),
    excerpts: lineExcerpts(lines, (line) => Boolean(line.trim()) && !/^\s*[-#|]/.test(line), 4),
    metrics: { lineCount: lines.length, headingCount: headings.length, bulletCount: bullets.length, tableLineCount: tables.length },
    omitted: { headingsAfterLimit: Math.max(0, headings.length - 8), bulletsAfterLimit: Math.max(0, bullets.length - 5) },
  };
}

function summarizeJson(text: string, maxItems: number): JsonMap {
  try {
    const value = JSON.parse(text);
    const paths: string[] = [];
    const scalars: string[] = [];
    walkJson(value, '$', paths, scalars, maxItems);
    const topKeys = recordValue(value) ? Object.keys(value).sort() : [];
    const digestLines = [`JSON digest: root=${rootType(value)}, topKeys=${topKeys.slice(0, 12).join(', ') || 'n/a'}.`];
    if (paths.length) digestLines.push(`Observed paths: ${paths.slice(0, maxItems).join('; ')}`);
    if (scalars.length) digestLines.push(`Scalar samples: ${scalars.slice(0, Math.min(8, maxItems)).join('; ')}`);
    return {
      digestText: digestLines.join('\n'),
      excerpts: [],
      metrics: { parseOk: true, topKeyCount: topKeys.length, observedPathCount: paths.length },
      omitted: { jsonPathsAfterLimit: Math.max(0, paths.length - maxItems) },
    };
  } catch (error) {
    return {
      digestText: `JSON digest: parse failed (${error instanceof Error ? error.constructor.name : 'Error'}); using bounded text preview only.`,
      excerpts: lineExcerpts(text.split(/\r?\n/), (line) => Boolean(line.trim()), 4),
      metrics: { parseOk: false },
      omitted: {},
    };
  }
}

function summarizeCsv(text: string, maxRows: number): JsonMap {
  const sample = text.split(/\r?\n/).slice(0, maxRows + 1);
  const delimiter = sample[0]?.includes('\t') && !sample[0].includes(',') ? '\t' : ',';
  const rows = sample.map((line) => line.split(delimiter));
  const header = rows[0] ?? [];
  const dataRows = rows.slice(1);
  const excerpts = dataRows.slice(0, maxRows).map((row, index) => ({
    kind: 'csv-row',
    row: index + 1,
    text: scrubInline(header.length ? JSON.stringify(Object.fromEntries(header.map((key, cellIndex) => [key, row[cellIndex] ?? '']))) : row.join(', ')),
  }));
  const totalLines = text.split(/\r?\n/).length;
  return {
    digestText: `CSV digest: columns=${header.length}, sampledRows=${dataRows.length}, totalLines=${totalLines}. Headers: ${header.slice(0, 24).join(', ') || 'n/a'}.`,
    excerpts,
    metrics: { columnCount: header.length, sampledRowCount: dataRows.length, lineCount: totalLines },
    omitted: { rowsAfterSample: Math.max(0, totalLines - 1 - dataRows.length) },
  };
}

function summarizePlainText(text: string): JsonMap {
  const lines = text.split(/\r?\n/);
  return {
    digestText: `Text digest: lines=${lines.length}, nonEmptyLines=${lines.filter((line) => line.trim()).length}.`,
    excerpts: lineExcerpts(lines, (line) => Boolean(line.trim()), 6),
    metrics: { lineCount: lines.length },
    omitted: {},
  };
}

function walkJson(value: unknown, path: string, paths: string[], scalars: string[], maxItems: number): void {
  if (paths.length >= maxItems * 2) return;
  const record = recordValue(value);
  if (record) {
    paths.push(`${path}{keys=${Object.keys(record).length}}`);
    for (const [key, child] of Object.entries(record).slice(0, maxItems)) {
      walkJson(child, `${path}.${key}`, paths, scalars, maxItems);
    }
    return;
  }
  if (Array.isArray(value)) {
    paths.push(`${path}[len=${value.length}]`);
    value.slice(0, Math.min(3, maxItems)).forEach((child, index) => walkJson(child, `${path}[${index}]`, paths, scalars, maxItems));
    return;
  }
  if (value !== null && value !== undefined && scalars.length < maxItems) {
    scalars.push(`${path}=${scrubInline(String(value))}`);
  }
}

function lineExcerpts(lines: string[], include: (line: string) => boolean, limit: number): JsonMap[] {
  const excerpts: JsonMap[] = [];
  lines.forEach((line, index) => {
    if (excerpts.length >= limit || !include(line)) return;
    let text = scrubInline(line);
    if (text.length > 240) {
      text = `[long-line omitted chars=${text.length} sha1=${sha1Text(text).slice(0, 12)}]`;
    }
    excerpts.push({ kind: 'line', lineStart: index + 1, lineEnd: index + 1, text });
  });
  return excerpts;
}

function boundedExcerpts(excerpts: JsonMap[], budget: number): JsonMap[] {
  return excerpts.map((excerpt) => {
    const item = { ...excerpt };
    const [text, truncated] = clipRefSafe(String(item.text ?? ''), budget);
    item.text = text;
    if (truncated) item.truncatedChars = truncated;
    return item;
  });
}

function clipRefSafe(text: string, budget: number): [string, number] {
  const scrubbed = scrubInline(text);
  if (scrubbed.length <= budget) return [scrubbed, 0];
  const marker = `... [truncated ${scrubbed.length - budget} chars]`;
  return [`${scrubbed.slice(0, Math.max(0, budget - marker.length)).trimEnd()}${marker}`, scrubbed.length - budget];
}

function scrubInline(text: string): string {
  return text
    .replace(/data:[^,\s]+,[A-Za-z0-9+/=_-]{80,}/g, '[data-url-redacted]')
    .replace(/\b[A-Za-z0-9+/]{240,}={0,2}\b/g, '[long-token-redacted]')
    .replace(/\s+/g, ' ')
    .trim();
}

function mediaType(suffix: string): string {
  return {
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.json': 'application/json',
    '.jsonl': 'application/jsonl',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
  }[suffix] ?? 'application/octet-stream';
}

function realWorkspaceRoot(workspaceRoot: string): string {
  const root = resolve(workspaceRoot);
  return existsSync(root) ? realpathSync(root) : root;
}

function digestIdForRef(ref: string): string {
  return `ref-digest-${sha1Text(ref).slice(0, 12)}`;
}

function sha1Text(text: string): string {
  return createHash('sha1').update(text, 'utf8').digest('hex');
}

function recordValue(value: unknown): JsonMap | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonMap : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function rootType(value: unknown): string {
  if (Array.isArray(value)) return 'list';
  if (recordValue(value)) return 'dict';
  if (value === null) return 'NoneType';
  return typeof value;
}
