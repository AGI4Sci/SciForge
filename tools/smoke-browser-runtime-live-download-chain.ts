import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  BROWSER_PRIMITIVE_INPUT_SCHEMAS,
  BROWSER_PRIMITIVE_INTENTS,
  type BrowserDownloadOutput,
  type BrowserExtractOutput,
  type BrowserNavigateOutput,
  type BrowserPrimitiveEnvelope,
  type BrowserReadOutput,
  type BrowserSearchOutput,
} from '../packages/actions/browser-runtime/index.js';
import { browserHostSessionDir } from '../src/runtime/browser-host-session.js';
import { createBrowserRuntimeModuleHandler } from '../src/runtime/modules/bounded-operation-module-handlers.js';
import { createRuntimeModuleDispatcher, createRuntimeModuleRegistry } from '../src/runtime/modules/dispatcher.js';

export const BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION = 1;

const REQUIRE_ENV = 'SCIFORGE_REQUIRE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN=1';
const DEFAULT_OUT = 'docs/test-artifacts/browser-runtime-live-download-chain/manifest.json';
const DEFAULT_CSV_PAGE_QUERY = 'people sc fsu csv airtravel';
const DEFAULT_CSV_PAGE_URL = 'https://people.sc.fsu.edu/~jburkardt/data/csv/csv.html';
const DEFAULT_CSV_DOWNLOAD_URL = 'https://people.sc.fsu.edu/~jburkardt/data/csv/airtravel.csv';
const DEFAULT_PDF_DOWNLOAD_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';
const DEFAULT_AUTH_WALL_READ_URL = 'https://httpbingo.org/status/401';
const DEFAULT_FORBIDDEN_READ_URL = 'https://httpbingo.org/status/403';
const DEFAULT_NETWORK_FAILURE_READ_URL = 'https://source-read-network-failure.invalid/';
const PRIMITIVE_CHAIN = [
  'browser.search',
  'browser.navigate',
  'browser.read',
  'browser.extract',
  'browser.download',
] as const;

export interface BrowserRuntimeLiveDownloadChainOptions {
  env?: Record<string, string | undefined>;
  out?: string;
  workspacePath?: string;
  now?: () => Date;
}

type BrowserRuntimeLiveDownloadChainManifest = {
  schemaVersion: typeof BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION;
  status: 'blocked' | 'passed' | 'failed';
  diagnosticOnly: true;
  releaseProof: false;
  productProof: false;
  checkedAt: string;
  requireEnv: typeof REQUIRE_ENV;
  primitiveChain: typeof PRIMITIVE_CHAIN[number][];
  blockedReason?: string;
  currentRun?: {
    runId?: string;
    searchResultRef?: string;
    searchResultCount?: number;
    searchedUrl?: string;
    selectedSourceUrl?: string;
    sourceSelection?: 'search-result' | 'controlled-public-fallback';
    sourcePageRef?: string;
    pageTextRef?: string;
    extractRef?: string;
    extractedLinkCount?: number;
    extractedCsvLink?: string;
    csvDownloadRef?: string;
    csvDownloadSha256?: string;
    csvDownloadSize?: number;
    csvDownloadMimeType?: string;
    csvFinalUrl?: string;
    pdfDownloadRef?: string;
    pdfDownloadSha256?: string;
    pdfDownloadSize?: number;
    pdfDownloadMimeType?: string;
    pdfFinalUrl?: string;
    negativeDownloadChecks?: Array<{
      caseId: string;
      status?: string;
      blockedReason?: string;
      refsCount: number;
      artifactRefPresent: boolean;
    }>;
    negativeReadChecks?: Array<{
      caseId: string;
      status?: string;
      blockedReason?: string;
      refsCount: number;
      outputPresent: boolean;
      diagnosticCodes: string[];
      diagnosticMessagePreview?: string;
    }>;
    downloadRef?: string;
    downloadSha256?: string;
    downloadSize?: number;
    downloadMimeType?: string;
    traceIntents?: string[];
  };
  failures?: string[];
  policyScan: {
    inlineBinaryPayloads: boolean;
    opaqueEncodedPayloads: boolean;
    localPaths: boolean;
  };
};

type BrowserEnvelope<T> = {
  status?: string;
  output?: T;
  refs?: string[];
  blockedReason?: string;
  diagnostics?: Array<{ code?: string; message?: string }>;
};

export async function runBrowserRuntimeLiveDownloadChain(
  options: BrowserRuntimeLiveDownloadChainOptions = {},
): Promise<BrowserRuntimeLiveDownloadChainManifest> {
  const env = options.env ?? process.env;
  const out = options.out ?? env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_OUT ?? DEFAULT_OUT;
  const workspacePath = options.workspacePath ?? process.cwd();
  const now = options.now ?? (() => new Date());
  const checkedAt = now().toISOString();

  if (env.SCIFORGE_REQUIRE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN !== '1') {
    const manifest = manifestWithPolicyScan({
      schemaVersion: BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION,
      status: 'blocked',
      diagnosticOnly: true,
      releaseProof: false,
      productProof: false,
      checkedAt,
      requireEnv: REQUIRE_ENV,
      primitiveChain: [...PRIMITIVE_CHAIN],
      blockedReason: 'missing_opt_in_env',
      policyScan: {
        inlineBinaryPayloads: false,
        opaqueEncodedPayloads: false,
        localPaths: false,
      },
    });
    await writeManifest(out, manifest);
    return manifest;
  }

  const runId = `browser-runtime-live-download-chain-${checkedAt.replace(/[:.]/g, '-')}`;
  const dispatcher = createRuntimeModuleDispatcher(createRuntimeModuleRegistry({
    browser: createBrowserRuntimeModuleHandler({ workspacePath }),
  }));
  const failures: string[] = [];

  try {
    const search = await invokeBrowser<BrowserSearchOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.search, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.search,
      query: env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_QUERY ?? DEFAULT_CSV_PAGE_QUERY,
      engine: 'duckduckgo',
      limit: 8,
      budget: { maxTimeMs: 45_000 },
    });
    assertSearchAttempted(search);

    const selectedSource = selectCsvSource(search.output);
    const navigate = await invokeBrowser<BrowserNavigateOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.navigate, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.navigate,
      url: selectedSource.url,
      capture: 'none',
      timeoutMs: 45_000,
    });
    assertPrimitiveCompleted(navigate, 'browser.navigate');

    const read = await invokeBrowser<BrowserReadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      sessionId: navigate.output?.sessionId,
      includeText: true,
      maxTextChars: 40_000,
      timeoutMs: 45_000,
    });
    assertPrimitiveCompleted(read, 'browser.read');
    if (!read.output?.pageTextRef) throw new Error('browser.read did not return pageTextRef');

    const extract = await invokeBrowser<BrowserExtractOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.extract, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.extract,
      ref: read.output.pageTextRef,
      extract: ['links', 'metadata', 'resultItems'],
      maxItems: 80,
    });
    assertPrimitiveCompleted(extract, 'browser.extract');

    const pdfRead = await invokeBrowser<BrowserReadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      url: env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_PDF_URL ?? DEFAULT_PDF_DOWNLOAD_URL,
      navigationMode: 'ephemeral',
      includeText: true,
      maxTextChars: 40_000,
      timeoutMs: 45_000,
    });
    const authWallRead = await invokeBrowser<BrowserReadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      url: env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_AUTH_WALL_URL ?? DEFAULT_AUTH_WALL_READ_URL,
      navigationMode: 'ephemeral',
      includeText: true,
      maxTextChars: 8_000,
      timeoutMs: 20_000,
    });
    const forbiddenRead = await invokeBrowser<BrowserReadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      url: env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_FORBIDDEN_URL ?? DEFAULT_FORBIDDEN_READ_URL,
      navigationMode: 'ephemeral',
      includeText: true,
      maxTextChars: 8_000,
      timeoutMs: 20_000,
    });
    const networkFailureRead = await invokeBrowser<BrowserReadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.read, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.read,
      url: env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_NETWORK_FAILURE_URL ?? DEFAULT_NETWORK_FAILURE_READ_URL,
      navigationMode: 'ephemeral',
      includeText: true,
      maxTextChars: 8_000,
      timeoutMs: 12_000,
    });
    const negativeReadChecks = [
      negativeReadCheck('pdf-source-read', pdfRead, 'source_page_read_failed'),
      negativeReadCheck('auth-wall-http-status-source-read', authWallRead, 'source_page_read_failed'),
      negativeReadCheck('forbidden-http-status-source-read', forbiddenRead, 'source_page_read_failed'),
      negativeReadCheck('network-source-read', networkFailureRead, 'source_page_read_failed'),
    ];
    for (const check of negativeReadChecks) {
      if (check.status !== 'blocked') failures.push(`${check.caseId} did not block: ${check.status ?? 'missing-status'}`);
      if (check.blockedReason !== check.expectedBlockedReason) failures.push(`${check.caseId} blockedReason mismatch: ${check.blockedReason ?? 'missing'}`);
      if (check.outputPresent) failures.push(`${check.caseId} returned readable source output while blocked`);
    }

    const extractedCsvLink = selectExtractedCsvLink(extract.output);
    const csvUrl = env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_CSV_URL
      ?? extractedCsvLink
      ?? DEFAULT_CSV_DOWNLOAD_URL;
    const csvDownload = await invokeBrowser<BrowserDownloadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: csvUrl,
      sessionId: read.output.sessionId ?? navigate.output?.sessionId,
      saveScope: 'session-artifacts',
      maxBytes: 256_000,
      timeoutMs: 45_000,
      filenameHint: 'airtravel.csv',
      constraints: { allowedDomains: ['people.sc.fsu.edu'] },
    });
    assertPrimitiveCompleted(csvDownload, 'browser.download(csv)');

    const pdfUrl = env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_PDF_URL ?? DEFAULT_PDF_DOWNLOAD_URL;
    const pdfDownload = await invokeBrowser<BrowserDownloadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: pdfUrl,
      sessionId: read.output.sessionId ?? navigate.output?.sessionId,
      saveScope: 'session-artifacts',
      maxBytes: 512_000,
      timeoutMs: 45_000,
      filenameHint: 'w3c-dummy.pdf',
      constraints: { allowedDomains: ['w3.org'] },
    });
    assertPrimitiveCompleted(pdfDownload, 'browser.download(pdf)');

    await assertDownloadArtifact(workspacePath, csvDownload.output);
    await assertDownloadArtifact(workspacePath, pdfDownload.output);

    const csvOverBudgetDownload = await invokeBrowser<BrowserDownloadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: csvUrl,
      sessionId: read.output.sessionId ?? navigate.output?.sessionId,
      saveScope: 'session-artifacts',
      maxBytes: 8,
      timeoutMs: 45_000,
      filenameHint: 'airtravel-overbudget.csv',
      constraints: { allowedDomains: ['people.sc.fsu.edu'] },
    });
    const wrongDomainDownload = await invokeBrowser<BrowserDownloadOutput>(dispatcher, BROWSER_PRIMITIVE_INTENTS.download, {
      schemaVersion: BROWSER_PRIMITIVE_INPUT_SCHEMAS.download,
      url: csvUrl,
      sessionId: read.output.sessionId ?? navigate.output?.sessionId,
      saveScope: 'session-artifacts',
      maxBytes: 256_000,
      timeoutMs: 45_000,
      filenameHint: 'wrong-domain.csv',
      constraints: { allowedDomains: ['example.invalid'] },
    });
    const negativeDownloadChecks = [
      negativeDownloadCheck('csv-overbudget', csvOverBudgetDownload, 'download_content_length_exceeds_budget'),
      negativeDownloadCheck('csv-domain-not-allowed', wrongDomainDownload, 'download_domain_not_allowed'),
    ];
    for (const check of negativeDownloadChecks) {
      if (check.status !== 'blocked') failures.push(`${check.caseId} did not block: ${check.status ?? 'missing-status'}`);
      if (check.blockedReason !== check.expectedBlockedReason) failures.push(`${check.caseId} blockedReason mismatch: ${check.blockedReason ?? 'missing'}`);
      if (check.artifactRefPresent) failures.push(`${check.caseId} returned artifact output while blocked`);
      if (check.refsCount !== 0) failures.push(`${check.caseId} returned refs while blocked`);
    }

    const manifest = manifestWithPolicyScan({
      schemaVersion: BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION,
      status: failures.length ? 'failed' : 'passed',
      diagnosticOnly: true,
      releaseProof: false,
      productProof: false,
      checkedAt,
      requireEnv: REQUIRE_ENV,
      primitiveChain: [...PRIMITIVE_CHAIN],
      currentRun: {
        runId,
        searchResultRef: search.output?.searchResultRef,
        searchResultCount: search.output?.results.length ?? 0,
        searchedUrl: search.output?.searchUrl,
        selectedSourceUrl: selectedSource.url,
        sourceSelection: selectedSource.source,
        sourcePageRef: read.output.sourcePageRef,
        pageTextRef: read.output.pageTextRef,
        extractRef: extract.output?.ref,
        extractedLinkCount: extract.output?.links?.length ?? 0,
        extractedCsvLink,
        csvDownloadRef: csvDownload.output?.artifactRef,
        csvDownloadSha256: csvDownload.output?.sha256,
        csvDownloadSize: csvDownload.output?.byteLength,
        csvDownloadMimeType: csvDownload.output?.mimeType,
        csvFinalUrl: csvDownload.output?.finalUrl,
        pdfDownloadRef: pdfDownload.output?.artifactRef,
        pdfDownloadSha256: pdfDownload.output?.sha256,
        pdfDownloadSize: pdfDownload.output?.byteLength,
        pdfDownloadMimeType: pdfDownload.output?.mimeType,
        pdfFinalUrl: pdfDownload.output?.finalUrl,
        negativeDownloadChecks,
        negativeReadChecks,
        downloadRef: csvDownload.output?.artifactRef,
        downloadSha256: csvDownload.output?.sha256,
        downloadSize: csvDownload.output?.byteLength,
        downloadMimeType: csvDownload.output?.mimeType,
        traceIntents: dispatcher.trace().map((step) => step.intent).filter((intent): intent is string => typeof intent === 'string'),
      },
      failures: failures.length ? failures : undefined,
      policyScan: {
        inlineBinaryPayloads: false,
        opaqueEncodedPayloads: false,
        localPaths: false,
      },
    });
    await writeManifest(out, manifest);
    return manifest;
  } catch (error) {
    const manifest = manifestWithPolicyScan({
      schemaVersion: BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION,
      status: 'failed',
      diagnosticOnly: true,
      releaseProof: false,
      productProof: false,
      checkedAt,
      requireEnv: REQUIRE_ENV,
      primitiveChain: [...PRIMITIVE_CHAIN],
      currentRun: {
        runId,
        traceIntents: dispatcher.trace().map((step) => step.intent).filter((intent): intent is string => typeof intent === 'string'),
      },
      failures: [error instanceof Error ? error.message : String(error)],
      policyScan: {
        inlineBinaryPayloads: false,
        opaqueEncodedPayloads: false,
        localPaths: false,
      },
    });
    await writeManifest(out, manifest);
    if (env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_STRICT === '1') throw error;
    return manifest;
  }
}

export function validateBrowserRuntimeLiveDownloadChainManifest(input: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(input)) return { valid: false, errors: ['manifest_not_object'] };
  if (input.schemaVersion !== BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_SCHEMA_VERSION) errors.push('schema_version_mismatch');
  if (!['blocked', 'passed', 'failed'].includes(String(input.status))) errors.push('invalid_status');
  if (input.diagnosticOnly !== true) errors.push('diagnostic_only_required');
  if (input.releaseProof !== false) errors.push('release_proof_must_be_false');
  if (input.productProof !== false) errors.push('product_proof_must_be_false');
  if (input.requireEnv !== REQUIRE_ENV) errors.push('require_env_mismatch');
  if (!Array.isArray(input.primitiveChain) || !arraysEqual(input.primitiveChain, [...PRIMITIVE_CHAIN])) {
    errors.push('primitive_chain_mismatch');
  }
  if (!isRecord(input.policyScan)) {
    errors.push('policy_scan_required');
  } else {
    if (input.policyScan.inlineBinaryPayloads !== false) errors.push('inline_binary_payloads_policy_failed');
    if (input.policyScan.opaqueEncodedPayloads !== false) errors.push('opaque_encoded_payloads_policy_failed');
    if (input.policyScan.localPaths !== false) errors.push('local_paths_policy_failed');
  }
  if (input.status === 'passed') {
    if (!isRecord(input.currentRun)) {
      errors.push('current_run_required');
    } else {
      const currentRun = input.currentRun;
      requireBrowserRef(currentRun.searchResultRef, 'search_result_ref', errors);
      requireBrowserRef(currentRun.sourcePageRef, 'source_page_ref', errors);
      requireBrowserRef(currentRun.pageTextRef, 'page_text_ref', errors);
      requireBrowserRef(currentRun.downloadRef, 'download_ref', errors);
      requireSha256(currentRun.downloadSha256, 'download_sha256', errors);
      requireBrowserRef(currentRun.csvDownloadRef, 'csv_download_ref', errors);
      requireSha256(currentRun.csvDownloadSha256, 'csv_download_sha256', errors);
      requireBrowserRef(currentRun.pdfDownloadRef, 'pdf_download_ref', errors);
      requireSha256(currentRun.pdfDownloadSha256, 'pdf_download_sha256', errors);
      if (!positiveNumber(currentRun.downloadSize)) errors.push('download_size_required');
      if (!positiveNumber(currentRun.csvDownloadSize)) errors.push('csv_download_size_required');
      if (!positiveNumber(currentRun.pdfDownloadSize)) errors.push('pdf_download_size_required');
      if (!String(currentRun.csvDownloadMimeType ?? '').toLowerCase().includes('csv')) errors.push('csv_mime_required');
      if (!String(currentRun.pdfDownloadMimeType ?? '').toLowerCase().includes('pdf')) errors.push('pdf_mime_required');
      if (!validNegativeDownloadChecks(currentRun.negativeDownloadChecks)) errors.push('negative_download_checks_required');
      if (!validNegativeReadChecks(currentRun.negativeReadChecks)) errors.push('negative_read_checks_required');
      const traceIntents = currentRun.traceIntents;
      if (!Array.isArray(traceIntents) || !PRIMITIVE_CHAIN.every((intent) => traceIntents.includes(intent))) {
        errors.push('trace_intents_missing_primitive_chain');
      }
    }
  }

  const text = JSON.stringify(input);
  if (/\b(?:data:|base64)\b/i.test(text)) errors.push('inline_data_or_base64_present');
  if (/\/(?:Applications|Users|private|tmp)\//i.test(text)) errors.push('local_absolute_path_present');
  return { valid: errors.length === 0, errors };
}

async function invokeBrowser<T>(
  dispatcher: ReturnType<typeof createRuntimeModuleDispatcher>,
  intent: string,
  input: Record<string, unknown>,
): Promise<BrowserEnvelope<T>> {
  const envelope = await dispatcher.invoke({
    moduleId: 'browser',
    intent,
    input,
  });
  const value = envelope.value as BrowserPrimitiveEnvelope<T> | undefined;
  if (!envelope.ok) {
    return {
      status: value?.status ?? 'failed',
      output: value?.output,
      refs: value?.refs ?? envelope.refs,
      blockedReason: value?.blockedReason ?? envelope.error,
      diagnostics: value?.diagnostics?.map((diagnostic) => ({ code: diagnostic.code, message: diagnostic.message })),
    };
  }
  return value as BrowserEnvelope<T>;
}

function assertPrimitiveCompleted(envelope: BrowserEnvelope<unknown>, name: string) {
  if (envelope.status !== 'completed') {
    const reason = envelope.blockedReason ?? envelope.diagnostics?.map((entry) => entry.message).filter(Boolean).join('; ') ?? 'unknown';
    throw new Error(`${name} did not complete: ${envelope.status ?? 'missing-status'} ${reason}`);
  }
  if (!envelope.output) throw new Error(`${name} did not return output`);
}

function assertSearchAttempted(envelope: BrowserEnvelope<BrowserSearchOutput>) {
  if (envelope.status !== 'completed' && envelope.status !== 'partial') {
    const reason = envelope.blockedReason ?? envelope.diagnostics?.map((entry) => entry.message).filter(Boolean).join('; ') ?? 'unknown';
    throw new Error(`browser.search did not complete or partially complete: ${envelope.status ?? 'missing-status'} ${reason}`);
  }
  if (!envelope.output?.searchResultRef) throw new Error('browser.search did not return searchResultRef');
}

function selectCsvSource(search: BrowserSearchOutput | undefined): { url: string; source: 'search-result' | 'controlled-public-fallback' } {
  const result = search?.results.find((item) => {
    const url = item.url.toLowerCase();
    const haystack = `${item.title} ${item.url} ${item.snippet ?? ''}`.toLowerCase();
    return url.includes('people.sc.fsu.edu') && url.endsWith('/csv.html') && haystack.includes('csv');
  }) ?? search?.results.find((item) => {
    const url = item.url.toLowerCase();
    const haystack = `${item.title} ${item.url} ${item.snippet ?? ''}`.toLowerCase();
    return url.includes('people.sc.fsu.edu') && !/\.csv(?:$|[?#])/i.test(item.url) && haystack.includes('csv');
  });
  return result?.url
    ? { url: result.url, source: 'search-result' }
    : { url: DEFAULT_CSV_PAGE_URL, source: 'controlled-public-fallback' };
}

function selectExtractedCsvLink(output: BrowserExtractOutput | undefined): string | undefined {
  return output?.links?.find((link) =>
    /\.csv(?:$|[?#])/i.test(link.url) && /^(?:https?):\/\//i.test(link.url)
  )?.url;
}

function negativeDownloadCheck(
  caseId: string,
  envelope: BrowserEnvelope<BrowserDownloadOutput>,
  expectedBlockedReason: string,
) {
  return {
    caseId,
    status: envelope.status,
    blockedReason: envelope.blockedReason,
    refsCount: envelope.refs?.length ?? 0,
    artifactRefPresent: Boolean(envelope.output?.artifactRef),
    expectedBlockedReason,
  };
}

function negativeReadCheck(
  caseId: string,
  envelope: BrowserEnvelope<BrowserReadOutput>,
  expectedBlockedReason: string,
) {
  const diagnosticCodes = (envelope.diagnostics ?? [])
    .map((diagnostic) => diagnostic.code)
    .filter((code): code is string => typeof code === 'string' && code.trim().length > 0);
  const diagnosticMessagePreview = (envelope.diagnostics ?? [])
    .map((diagnostic) => diagnostic.message)
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
    .join('; ')
    .slice(0, 320);
  return {
    caseId,
    status: envelope.status,
    blockedReason: envelope.blockedReason,
    refsCount: envelope.refs?.length ?? 0,
    outputPresent: Boolean(envelope.output),
    diagnosticCodes,
    ...(diagnosticMessagePreview ? { diagnosticMessagePreview } : {}),
    expectedBlockedReason,
  };
}

async function assertDownloadArtifact(workspacePath: string, output: BrowserDownloadOutput | undefined) {
  if (!output?.artifactRef) throw new Error('download did not return artifactRef');
  if (!output.sha256) throw new Error(`download ${output.artifactRef} did not return sha256`);
  const path = artifactPathForBrowserHostRef(workspacePath, output.artifactRef);
  const bytes = await readFile(path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), output.sha256);
  assert.equal((await stat(path)).size, output.byteLength);
}

function artifactPathForBrowserHostRef(workspacePath: string, ref: string) {
  const match = /^browser-host-session:([^/]+)\/(.+)$/.exec(ref);
  if (!match) throw new Error(`unsupported browser artifact ref: ${ref}`);
  return join(browserHostSessionDir(workspacePath, match[1] ?? ''), match[2] ?? '');
}

function manifestWithPolicyScan<T extends BrowserRuntimeLiveDownloadChainManifest>(manifest: T): T {
  const text = JSON.stringify({
    ...manifest,
    policyScan: {
      inlineBinaryPayloads: false,
      opaqueEncodedPayloads: false,
      localPaths: false,
    },
  });
  return {
    ...manifest,
    policyScan: {
      inlineBinaryPayloads: /"bytes"\s*:|byteArray|arrayBuffer/i.test(text),
      opaqueEncodedPayloads: /\b(?:data:|base64)\b/i.test(text),
      localPaths: /\/(?:Applications|Users|private|tmp)\//i.test(text),
    },
  };
}

async function writeManifest(out: string, manifest: BrowserRuntimeLiveDownloadChainManifest) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function requireBrowserRef(value: unknown, field: string, errors: string[]) {
  if (typeof value !== 'string' || !/^browser-host-session:[^/]+\/.+/.test(value)) errors.push(`${field}_missing_or_invalid`);
}

function requireSha256(value: unknown, field: string, errors: string[]) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) errors.push(`${field}_missing_or_invalid`);
}

function positiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function validNegativeDownloadChecks(value: unknown) {
  if (!Array.isArray(value)) return false;
  const expected = new Map([
    ['csv-overbudget', 'download_content_length_exceeds_budget'],
    ['csv-domain-not-allowed', 'download_domain_not_allowed'],
  ]);
  for (const [caseId, blockedReason] of expected) {
    const check = value.find((entry) => isRecord(entry) && entry.caseId === caseId);
    if (!isRecord(check)) return false;
    if (check.status !== 'blocked') return false;
    if (check.blockedReason !== blockedReason) return false;
    if (check.refsCount !== 0) return false;
    if (check.artifactRefPresent !== false) return false;
  }
  return true;
}

function validNegativeReadChecks(value: unknown) {
  if (!Array.isArray(value)) return false;
  const expected = [
    'pdf-source-read',
    'auth-wall-http-status-source-read',
    'forbidden-http-status-source-read',
    'network-source-read',
  ];
  for (const caseId of expected) {
    const check = value.find((entry) => isRecord(entry) && entry.caseId === caseId);
    if (!isRecord(check)) return false;
    if (check.status !== 'blocked') return false;
    if (check.blockedReason !== 'source_page_read_failed') return false;
    if (check.outputPresent !== false) return false;
    if (!Array.isArray(check.diagnosticCodes) || !check.diagnosticCodes.some((code) => code === 'source-page-read-failed')) return false;
  }
  return true;
}

function arraysEqual(left: unknown[], right: unknown[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseArgs(argv: string[]) {
  const parsed: { out?: string; workspacePath?: string; strict?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out') parsed.out = argv[++index];
    else if (arg === '--workspace') parsed.workspacePath = argv[++index];
    else if (arg === '--strict') parsed.strict = true;
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (args.strict) process.env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_STRICT = '1';
  const manifest = await runBrowserRuntimeLiveDownloadChain({
    out: args.out,
    workspacePath: args.workspacePath,
  });
  const validation = validateBrowserRuntimeLiveDownloadChainManifest(manifest);
  if (!validation.valid) {
    console.error(`[failed] invalid browser runtime live download manifest: ${validation.errors.join(', ')}`);
    process.exitCode = 1;
  } else if (manifest.status === 'failed' && process.env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_STRICT === '1') {
    console.error(`[failed] browser runtime live download chain failed: ${(manifest.failures ?? []).join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log(`[${manifest.status}] browser runtime live download chain manifest: ${process.env.SCIFORGE_BROWSER_RUNTIME_LIVE_DOWNLOAD_CHAIN_OUT ?? DEFAULT_OUT}`);
  }
}
