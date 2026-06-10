import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  runWebSearch,
  type SearchCandidate,
  type SearchCandidateProvider,
  type SearchCandidateProviderRequest,
  type SearchCandidateProviderResult,
} from '../src/runtime/web-search-runtime.js';
import {
  readWebPageStatic,
  type WebReadResourceRef,
} from '../src/runtime/web-read-runtime.js';

export const WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION = 'sciforge.web-search.live-diagnostic.v1';
export const WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT = 5;
export const WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES = [
  'news_webpage',
  'ordinary_docs_page',
  'js_heavy_browser_render_required',
  'auth_blocked_or_403_401_surrogate',
  'network_failure',
] as const;

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_READ_MAX_CHARS = 4_000;
const DEFAULT_OUT = '.sciforge/web-search-live-diagnostic/manifest.json';
const LIVE_QUERY_SET: LiveDiagnosticQuery[] = [
  {
    queryId: 'zh-current-biomedicine',
    query: 'CRISPR prime editing 最新 临床试验',
    language: 'zh-CN',
    coverageCategory: 'news_webpage',
  },
  {
    queryId: 'es-climate-health',
    query: 'salud climática olas de calor estudio reciente',
    language: 'es',
    coverageCategory: 'ordinary_docs_page',
  },
  {
    queryId: 'ar-ai-drug-discovery',
    query: 'اكتشاف الأدوية بالذكاء الاصطناعي بحث حديث',
    language: 'ar',
    coverageCategory: 'js_heavy_browser_render_required',
  },
  {
    queryId: 'fr-fusion-energy',
    query: 'fusion nucléaire stellarator progrès récent',
    language: 'fr',
    coverageCategory: 'auth_blocked_or_403_401_surrogate',
  },
  {
    queryId: 'en-protein-models',
    query: 'open source protein language model benchmark recent',
    language: 'en',
    coverageCategory: 'network_failure',
  },
];

const DEFAULT_LIVE_COVERAGE_PROBES: LiveDiagnosticCoverageProbe[] = [
  {
    probeId: 'default-news-webpage',
    coverageCategory: 'news_webpage',
    url: 'https://phys.org/latest-news/',
  },
  {
    probeId: 'default-ordinary-docs-page',
    coverageCategory: 'ordinary_docs_page',
    url: 'https://docs.python.org/3/library/asyncio.html',
  },
  {
    probeId: 'default-js-heavy-browser-render-required',
    coverageCategory: 'js_heavy_browser_render_required',
    url: 'https://miro.com/app/',
  },
  {
    probeId: 'default-auth-blocked-or-403-401-surrogate',
    coverageCategory: 'auth_blocked_or_403_401_surrogate',
    url: 'https://www.canva.com/',
  },
  {
    probeId: 'default-network-failure',
    coverageCategory: 'network_failure',
    url: 'https://sciforge-live-diagnostic.invalid/network-failure',
  },
];

const REQUIRED_PROVIDER_ENV_HINTS = [
  'SCIFORGE_SEARXNG_BASE_URL or SEARXNG_BASE_URL',
  'SCIFORGE_OPENSERP_ENABLED=1 plus SCIFORGE_OPENSERP_BASE_URL or OPENSERP_BASE_URL',
  'SCIFORGE_WEB_SEARCH_PROVIDER plus SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL',
];
const SEARXNG_PRESETS = {
  docs: { engines: 'mdn,github' },
  science: { categories: 'science', engines: 'openalex,crossref,arxiv' },
  stable: { engines: 'mdn,github,openalex,crossref,arxiv' },
} as const;

export type WebSearchLiveDiagnosticStatus = 'passed' | 'failed' | 'skipped';
export type WebSearchLiveProviderKind = 'searxng' | 'openserp' | 'generic-json';
export type WebSearchLiveCoverageCategory = typeof WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES[number];
export type WebSearchLiveCoverageStatus = 'satisfied' | 'missing' | 'failed';

export interface WebSearchLiveProviderConfigured {
  configured: true;
  id: string;
  kind: WebSearchLiveProviderKind;
  baseUrl: string;
  timeoutMs?: number;
  allowPrivateNetwork?: boolean;
  searxng?: {
    searchParamNames: string[];
    headerNames: string[];
  };
}

export interface WebSearchLiveProviderMissing {
  configured: false;
  id: 'none';
  kind: 'none';
  missingEnv: string[];
}

export type WebSearchLiveProviderConfig = WebSearchLiveProviderConfigured | WebSearchLiveProviderMissing;

export interface LiveDiagnosticQuery {
  queryId: string;
  query: string;
  language: string;
  coverageCategory: WebSearchLiveCoverageCategory;
}

export interface LiveDiagnosticCoverageProbe {
  probeId: string;
  coverageCategory: WebSearchLiveCoverageCategory;
  url: string;
}

export interface WebSearchLiveDiagnosticManifest {
  schemaVersion: typeof WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION;
  status: WebSearchLiveDiagnosticStatus;
  diagnosticOnly: true;
  productProof: false;
  releaseEligible: false;
  checkedAt: string;
  provider: WebSearchLiveProviderConfig;
  queryRuns: WebSearchLiveDiagnosticQueryRun[];
  coverageProbes: WebSearchLiveCoverageProbeRun[];
  searchProof: WebSearchLiveSearchProofSummary;
  coverage: WebSearchLiveCoverageSummary;
  timingSummary: WebSearchLiveTimingSummary;
  refs: string[];
  skipReason?: {
    code: 'provider_env_missing';
    message: string;
    requiredEnv: string[];
  };
  failureReason?: {
    code: string;
    message: string;
    refs: string[];
  };
  policyScan: {
    rawLargePayloads: false;
    refsFirst: true;
  };
}

export interface WebSearchLiveCoverageProbeRun {
  probeId: string;
  coverageCategory: WebSearchLiveCoverageCategory;
  url: string;
  probeRef?: string;
  read: WebSearchLiveDiagnosticQueryRun['read'];
}

export interface WebSearchLiveDiagnosticQueryRun {
  queryId: string;
  query: string;
  language: string;
  coverageCategory: WebSearchLiveCoverageCategory;
  search: {
    status: string;
    resultCount: number;
    searchResultSetRef?: string;
    durationMs: number;
    candidateRefs: string[];
    warnings?: string[];
    error?: string;
  };
  read: {
    status: string;
    attemptedCandidateRef?: string;
    sourcePageRef?: string;
    pageTextRef?: string;
    finalUrl?: string;
    durationMs: number;
    httpStatus?: number;
    textCharCount?: number;
    textSha1?: string;
    preview?: string;
    blockedReason?: string;
    networkError?: string;
    browserRenderRequired?: boolean;
    warnings?: string[];
    error?: string;
  };
}

export interface WebSearchLiveCoverageSummary {
  requiredCategories: WebSearchLiveCoverageCategory[];
  observedCategories: WebSearchLiveCoverageCategory[];
  missingCategories: WebSearchLiveCoverageCategory[];
  categoryResults: Record<WebSearchLiveCoverageCategory, WebSearchLiveCoverageCategoryResult>;
  multilingual: {
    requiredQueryRuns: number;
    observedQueryRuns: number;
    distinctLanguages: string[];
    satisfied: boolean;
  };
  satisfied: boolean;
}

export interface WebSearchLiveSearchProofSummary {
  requiredQueryRuns: number;
  observedQueryRuns: number;
  queryRunsWithCandidates: number;
  queryRunsWithTiming: number;
  distinctLanguages: string[];
  satisfied: boolean;
}

export interface WebSearchLiveCoverageCategoryResult {
  status: WebSearchLiveCoverageStatus;
  queryRunIds: string[];
  probeIds?: string[];
  refs: string[];
  message?: string;
}

export interface WebSearchLiveTimingSummary {
  searchTotalMs: number;
  readTotalMs: number;
  totalMs: number;
}

export interface WebSearchLiveValidationResult {
  valid: boolean;
  blockers: string[];
}

export interface WebSearchLiveValidationOptions {
  requireCoverage?: boolean;
}

export interface RunWebSearchLiveDiagnosticOptions {
  env?: Record<string, string | undefined>;
  out?: string;
  workspacePath?: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
  readImpl?: typeof readWebPageStatic;
  timeoutMs?: number;
  readMaxChars?: number;
  requireCoverage?: boolean;
  coverageProbes?: LiveDiagnosticCoverageProbe[] | 'default' | string;
}

interface CliArgs {
  out?: string;
  workspacePath?: string;
  timeoutMs?: number;
  readMaxChars?: number;
  json: boolean;
  requireCoverage: boolean;
  coverageProbes?: string;
}

export function buildWebSearchLiveProviderConfig(env: Record<string, string | undefined> = process.env): WebSearchLiveProviderConfig {
  const explicitProvider = cleanEnv(env.SCIFORGE_WEB_SEARCH_PROVIDER ?? env.SCIFORGE_WEB_SEARCH_PROVIDER_ID);
  const explicitBase = firstNonEmpty(
    env.SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL,
    env.SCIFORGE_WEB_SEARCH_BASE_URL,
    env.WEB_SEARCH_PROVIDER_BASE_URL,
  );
  const searxngBase = firstNonEmpty(
    explicitProvider === 'searxng' ? explicitBase : undefined,
    env.SCIFORGE_SEARXNG_BASE_URL,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_BASE_URL,
    env.SEARXNG_BASE_URL,
  );
  const openserpBase = firstNonEmpty(
    explicitProvider === 'openserp' ? explicitBase : undefined,
    env.SCIFORGE_OPENSERP_BASE_URL,
    env.OPENSERP_BASE_URL,
    env.OPEN_SERP_BASE_URL,
  );
  const timeoutMs = boundedPositiveInteger(env.SCIFORGE_WEB_SEARCH_LIVE_TIMEOUT_MS ?? env.SCIFORGE_WEB_SEARCH_TIMEOUT_MS);
  const allowPrivateNetwork = truthyEnv(
    env.SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK
      ?? env.SCIFORGE_WEB_READ_ALLOW_PRIVATE_NETWORK,
  );
  const searxngTuning = buildSearxngTuningSummary(env);

  if (searxngBase) {
    return configuredProvider('searxng', 'searxng', searxngBase, timeoutMs, allowPrivateNetwork, searxngTuning);
  }
  if (openserpBase && (explicitProvider === 'openserp' || truthyEnv(env.SCIFORGE_OPENSERP_ENABLED) || truthyEnv(env.OPENSERP_ENABLED))) {
    return configuredProvider('openserp', 'openserp', openserpBase, timeoutMs, allowPrivateNetwork);
  }
  if (explicitBase) {
    return configuredProvider(explicitProvider || 'generic-json', 'generic-json', explicitBase, timeoutMs, allowPrivateNetwork);
  }
  return {
    configured: false,
    id: 'none',
    kind: 'none',
    missingEnv: REQUIRED_PROVIDER_ENV_HINTS,
  };
}

export async function runWebSearchLiveDiagnostic(
  options: RunWebSearchLiveDiagnosticOptions = {},
): Promise<WebSearchLiveDiagnosticManifest> {
  const env = options.env ?? process.env;
  const workspacePath = resolve(options.workspacePath ?? process.cwd());
  const out = resolve(workspacePath, options.out ?? DEFAULT_OUT);
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const providerConfig = buildWebSearchLiveProviderConfig(env);
  const totalStarted = nowMs();

  if (!providerConfig.configured) {
    const manifest: WebSearchLiveDiagnosticManifest = {
      schemaVersion: WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION,
      status: 'skipped',
      diagnosticOnly: true,
      productProof: false,
      releaseEligible: false,
      checkedAt,
      provider: providerConfig,
      queryRuns: [],
      coverageProbes: [],
      searchProof: buildSearchProofSummary([]),
      coverage: buildCoverageSummary([], []),
      timingSummary: {
        searchTotalMs: 0,
        readTotalMs: 0,
        totalMs: elapsedMs(totalStarted),
      },
      refs: [],
      skipReason: {
        code: 'provider_env_missing',
        message: 'No live web_search provider is configured. Configure local SearXNG, OpenSERP, or a generic provider env before treating this as a live diagnostic.',
        requiredEnv: REQUIRED_PROVIDER_ENV_HINTS,
      },
      policyScan: {
        rawLargePayloads: false,
        refsFirst: true,
      },
    };
    await writeManifest(out, manifest);
    return manifest;
  }

  const provider = createProvider(providerConfig, env, options.fetchImpl);
  const timeoutMs = options.timeoutMs ?? providerConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const readMaxChars = options.readMaxChars ?? DEFAULT_READ_MAX_CHARS;
  const coverageProbeDefinitions = buildCoverageProbeDefinitions(options.coverageProbes, env);
  const queryRuns: WebSearchLiveDiagnosticQueryRun[] = [];
  const coverageProbes: WebSearchLiveCoverageProbeRun[] = [];
  const refs: string[] = [];
  let searchTotalMs = 0;
  let readTotalMs = 0;

  for (const query of LIVE_QUERY_SET) {
    const searchStarted = nowMs();
    const search = await runWebSearch({
      query: query.query,
      limit: DEFAULT_SEARCH_LIMIT,
      language: query.language,
      provider: provider.id,
      timeoutMs,
      constraints: {
        allowUnsafeUrls: providerConfig.allowPrivateNetwork === true,
      },
    }, {
      workspacePath,
      provider,
      env,
      now: () => (options.now?.() ?? new Date()).toISOString(),
    });
    const searchDurationMs = elapsedMs(searchStarted);
    searchTotalMs += searchDurationMs;
    const searchResultSetRef = search.refs.searchResultSetRef;
    if (searchResultSetRef) refs.push(searchResultSetRef);
    const candidateRefs = search.refs.discoveredPageRefs.map((candidate) => candidate.ref);
    refs.push(...candidateRefs);

    const readStarted = nowMs();
    const resourceRefs = searchResourceRefs(search);
    const read = search.ok
      ? await readCandidateForCoverage({
        workspacePath,
        resourceRefs,
        timeoutMs,
        readMaxChars,
        allowPrivateNetwork: providerConfig.allowPrivateNetwork === true,
        now: () => (options.now?.() ?? new Date()).toISOString(),
        coverageCategory: query.coverageCategory,
        readImpl: options.readImpl,
      })
      : undefined;
    const readDurationMs = elapsedMs(readStarted);
    readTotalMs += readDurationMs;
    if (read?.sourcePageRef) refs.push(read.sourcePageRef);
    if (read?.pageTextRef) refs.push(read.pageTextRef);

    queryRuns.push({
      queryId: query.queryId,
      query: query.query,
      language: query.language,
      coverageCategory: query.coverageCategory,
      search: {
        status: search.status,
        resultCount: search.data?.results.length ?? 0,
        ...(searchResultSetRef ? { searchResultSetRef } : {}),
        durationMs: searchDurationMs,
        candidateRefs,
        ...(search.warnings.length ? { warnings: search.warnings.map(boundedMessage) } : {}),
        ...(search.error ? { error: boundedMessage(search.error.message) } : {}),
      },
      read: read ?? {
        status: search.ok ? 'failed' : 'skipped',
        durationMs: readDurationMs,
        error: search.ok
          ? 'web_read could not read any discovered candidate.'
          : 'web_read skipped because web_search did not return candidates.',
      },
    });
  }

  for (const probe of coverageProbeDefinitions) {
    const run = await readCoverageProbe({
      workspacePath,
      probe,
      timeoutMs,
      readMaxChars,
      allowPrivateNetwork: providerConfig.allowPrivateNetwork === true,
      now: () => (options.now?.() ?? new Date()).toISOString(),
      readImpl: options.readImpl,
    });
    coverageProbes.push(run);
    readTotalMs += run.read.durationMs;
    if (run.probeRef) refs.push(run.probeRef);
    if (run.read.sourcePageRef) refs.push(run.read.sourcePageRef);
    if (run.read.pageTextRef) refs.push(run.read.pageTextRef);
  }

  const uniqueRefs = uniqueStrings(refs);
  const searchProof = buildSearchProofSummary(queryRuns);
  const coverage = buildCoverageSummary(queryRuns, coverageProbes);
  const requireCoverage = options.requireCoverage === true;
  const passed = searchProof.satisfied && (!requireCoverage || coverage.satisfied);
  const manifest: WebSearchLiveDiagnosticManifest = {
    schemaVersion: WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION,
    status: passed ? 'passed' : 'failed',
    diagnosticOnly: true,
    productProof: false,
    releaseEligible: false,
    checkedAt,
    provider: providerConfig,
    queryRuns,
    coverageProbes,
    searchProof,
    coverage,
    timingSummary: {
      searchTotalMs: roundMs(searchTotalMs),
      readTotalMs: roundMs(readTotalMs),
      totalMs: elapsedMs(totalStarted),
    },
    refs: uniqueRefs,
    ...(passed ? {} : {
      failureReason: {
        code: searchProof.satisfied ? 'live_coverage_incomplete' : 'p1_search_candidate_timing_incomplete',
        message: searchProof.satisfied
          ? `Live diagnostic searchProof passed, but required real coverage is incomplete: ${coverage.missingCategories.join(', ') || 'unknown categories'}.`
          : `Live diagnostic did not prove at least ${WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT} multilingual web_search runs with parseable candidates and timing.`,
        refs: uniqueRefs.slice(0, 20),
      },
    }),
    policyScan: {
      rawLargePayloads: false,
      refsFirst: true,
    },
  };
  await writeManifest(out, manifest);
  return manifest;
}

export function validateWebSearchLiveDiagnosticManifest(
  input: unknown,
  options: WebSearchLiveValidationOptions = {},
): WebSearchLiveValidationResult {
  const manifest = record(input);
  const blockers: string[] = [];
  if (manifest.schemaVersion !== WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION) {
    blockers.push('schemaVersion must be sciforge.web-search.live-diagnostic.v1');
  }
  const status = stringValue(manifest.status);
  if (!['passed', 'failed', 'skipped'].includes(status)) blockers.push('status must be passed, failed, or skipped');
  if (manifest.diagnosticOnly !== true) blockers.push('manifest must be diagnosticOnly=true');
  if (manifest.productProof !== false) blockers.push('live diagnostic must not claim productProof');
  if (manifest.releaseEligible !== false) blockers.push('live diagnostic must not be releaseEligible');
  if (record(manifest.policyScan).rawLargePayloads !== false) blockers.push('policyScan must reject raw large payloads');
  if (record(manifest.policyScan).refsFirst !== true) blockers.push('policyScan must be refs-first');

  const provider = record(manifest.provider);
  const queryRuns = arrayValue(manifest.queryRuns).map(record);
  const coverageProbes = arrayValue(manifest.coverageProbes).map(record);
  validateSearchProofSummaryShape(manifest, queryRuns, status, blockers);
  validateCoverageProbeShape(manifest, coverageProbes, status, blockers);
  validateCoverageSummaryShape(manifest, queryRuns, coverageProbes, status, blockers, options);
  if (status === 'skipped') {
    if (provider.configured !== false) blockers.push('skipped manifest must record provider.configured=false');
    if (!stringValue(record(manifest.skipReason).message)) blockers.push('skipped manifest must explain missing provider env');
  } else {
    if (provider.configured !== true) blockers.push('live manifest must record configured provider');
    if (queryRuns.length < WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT) {
      blockers.push(`live diagnostic must include at least ${WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT} query runs`);
    }
    const distinctLanguages = uniqueStrings(queryRuns.map((run) => stringValue(run.language)));
    if (distinctLanguages.length < WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT) {
      blockers.push(`live diagnostic must include at least ${WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT} distinct multilingual query languages`);
    }
    for (const [index, run] of queryRuns.entries()) {
      const search = record(run.search);
      const category = stringValue(run.coverageCategory);
      if (!isLiveCoverageCategory(category)) {
        blockers.push(`query ${index + 1} must record a required coverage category`);
        continue;
      }
      if (!searchRecordSatisfiesSearchProof(search)) {
        blockers.push(`query ${index + 1} must prove web_search candidates and timing`);
      }
    }
  }

  const serialized = JSON.stringify(input);
  if (/raw(?:Search|Read|Provider)?Payload|"<html|base64|\"text\"\s*:/i.test(serialized)) {
    blockers.push('manifest must not inline raw provider/read payloads');
  }
  return {
    valid: blockers.length === 0,
    blockers,
  };
}

function validateSearchProofSummaryShape(
  manifest: Record<string, unknown>,
  queryRuns: Array<Record<string, unknown>>,
  status: string,
  blockers: string[],
): void {
  const searchProof = record(manifest.searchProof);
  const distinctLanguages = uniqueStrings(queryRuns.map((run) => stringValue(run.language)));
  const queryRunsWithCandidates = queryRuns
    .filter((run) => searchRecordHasCandidates(record(run.search)))
    .length;
  const queryRunsWithTiming = queryRuns
    .filter((run) => searchRecordHasTiming(record(run.search)))
    .length;
  const satisfied = queryRuns.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
    && distinctLanguages.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
    && queryRuns.every((run) => searchRecordSatisfiesSearchProof(record(run.search)));

  if (numberValue(searchProof.requiredQueryRuns) !== WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT) {
    blockers.push(`searchProof.requiredQueryRuns must be ${WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT}`);
  }
  if (numberValue(searchProof.observedQueryRuns) !== queryRuns.length) {
    blockers.push('searchProof.observedQueryRuns must match queryRuns length');
  }
  if (numberValue(searchProof.queryRunsWithCandidates) !== queryRunsWithCandidates) {
    blockers.push('searchProof.queryRunsWithCandidates must match completed candidate-bearing search runs');
  }
  if (numberValue(searchProof.queryRunsWithTiming) !== queryRunsWithTiming) {
    blockers.push('searchProof.queryRunsWithTiming must match timed search runs');
  }
  if (!sameStringSet(arrayValue(searchProof.distinctLanguages).map(String), distinctLanguages)) {
    blockers.push('searchProof.distinctLanguages must match query run languages');
  }
  if (searchProof.satisfied !== satisfied) {
    blockers.push('searchProof.satisfied must reflect P1 multilingual candidate and timing proof');
  }
  if (status === 'passed' && !satisfied) {
    blockers.push('passed live diagnostic must satisfy P1 multilingual candidate and timing proof');
  }
  if (status === 'skipped' && searchProof.satisfied !== false) {
    blockers.push('skipped manifest must not satisfy searchProof');
  }
}

function validateCoverageProbeShape(
  manifest: Record<string, unknown>,
  coverageProbes: Array<Record<string, unknown>>,
  status: string,
  blockers: string[],
): void {
  if (!Array.isArray(manifest.coverageProbes)) {
    blockers.push('coverageProbes must be an array');
    return;
  }
  if (status === 'skipped') {
    if (coverageProbes.length) blockers.push('skipped manifest must not run coverage probes');
    return;
  }
  const seenProbeIds = new Set<string>();
  for (const [index, probe] of coverageProbes.entries()) {
    const probeId = stringValue(probe.probeId);
    const category = stringValue(probe.coverageCategory);
    const url = stringValue(probe.url);
    const probeRef = stringValue(probe.probeRef);
    if (!probeId) blockers.push(`coverage probe ${index + 1} must record probeId`);
    if (probeId && seenProbeIds.has(probeId)) blockers.push(`coverage probe ${probeId} must be unique`);
    seenProbeIds.add(probeId);
    if (!isLiveCoverageCategory(category)) blockers.push(`coverage probe ${probeId || index + 1} must record a required coverage category`);
    if (!normalizeUrl(url)) blockers.push(`coverage probe ${probeId || index + 1} must record an HTTP(S) URL`);
    if (!probeRef.startsWith('web-coverage-probe:')) blockers.push(`coverage probe ${probeId || index + 1} must record a web-coverage-probe ref`);
    if (!record(probe.read).status) blockers.push(`coverage probe ${probeId || index + 1} must record read status`);
  }
}

function validateCoverageSummaryShape(
  manifest: Record<string, unknown>,
  queryRuns: Array<Record<string, unknown>>,
  coverageProbes: Array<Record<string, unknown>>,
  status: string,
  blockers: string[],
  options: WebSearchLiveValidationOptions,
): void {
  const coverage = record(manifest.coverage);
  const requiredCategories = arrayValue(coverage.requiredCategories).map(String);
  if (!sameStringSet(requiredCategories, WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES)) {
    blockers.push('coverage.requiredCategories must list all required PROJECT browser live diagnostic categories');
  }

  const observedCategories = arrayValue(coverage.observedCategories).map(String);
  const missingCategories = arrayValue(coverage.missingCategories).map(String);
  const categoryResults = record(coverage.categoryResults);
  for (const category of WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES) {
    const result = record(categoryResults[category]);
    const resultStatus = stringValue(result.status);
    const categoryRuns = queryRuns.filter((run) => stringValue(run.coverageCategory) === category);
    const categoryProbes = coverageProbes.filter((probe) => stringValue(probe.coverageCategory) === category);
    const satisfyingRuns = categoryRuns.filter((run) => queryRunRecordSatisfiesCoverage(run, category));
    const satisfyingProbes = categoryProbes.filter((probe) => coverageProbeRecordSatisfiesCoverage(probe, category));
    const expectedStatus: WebSearchLiveCoverageStatus = satisfyingRuns.length || satisfyingProbes.length
      ? 'satisfied'
      : categoryRuns.length || categoryProbes.length ? 'failed' : 'missing';
    if (!['satisfied', 'missing', 'failed'].includes(resultStatus)) {
      blockers.push(`coverage category ${category} must record satisfied, missing, or failed status`);
    }
    if (status === 'skipped') {
      if (resultStatus !== 'missing') blockers.push(`skipped coverage category ${category} must remain missing`);
      continue;
    }
    if (!categoryRuns.length) blockers.push(`live diagnostic must include query coverage for ${category}`);
    if (resultStatus !== expectedStatus) blockers.push(`coverage category ${category} must reflect observed read coverage status`);
    const queryRunIds = arrayValue(result.queryRunIds).map(String);
    if (!categoryRuns.every((run) => queryRunIds.includes(stringValue(run.queryId)))) {
      blockers.push(`coverage category ${category} queryRunIds must point to current manifest runs`);
    }
    const probeIds = arrayValue(result.probeIds).map(String);
    if (!categoryProbes.every((probe) => probeIds.includes(stringValue(probe.probeId)))) {
      blockers.push(`coverage category ${category} probeIds must point to current manifest probes`);
    }
  }

  const multilingual = record(coverage.multilingual);
  const distinctLanguages = uniqueStrings(queryRuns.map((run) => stringValue(run.language)));
  if (numberValue(multilingual.requiredQueryRuns) !== WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT) {
    blockers.push(`coverage.multilingual.requiredQueryRuns must be ${WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT}`);
  }
  if (numberValue(multilingual.observedQueryRuns) !== queryRuns.length) {
    blockers.push('coverage.multilingual.observedQueryRuns must match queryRuns length');
  }
  if (!sameStringSet(arrayValue(multilingual.distinctLanguages).map(String), distinctLanguages)) {
    blockers.push('coverage.multilingual.distinctLanguages must match query run languages');
  }
  const multilingualSatisfied = queryRuns.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
    && distinctLanguages.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT;
  if (multilingual.satisfied !== multilingualSatisfied) {
    blockers.push('coverage.multilingual.satisfied must reflect query run and language coverage');
  }

  const computedObserved = WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES
    .filter((category) => queryRuns.some((run) => stringValue(run.coverageCategory) === category && queryRunRecordSatisfiesCoverage(run, category))
      || coverageProbes.some((probe) => stringValue(probe.coverageCategory) === category && coverageProbeRecordSatisfiesCoverage(probe, category)));
  const computedMissing = WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES
    .filter((category) => !computedObserved.includes(category));
  if (status === 'skipped') {
    if (observedCategories.length !== 0) blockers.push('skipped coverage must not record observed categories');
    if (!sameStringSet(missingCategories, WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES)) {
      blockers.push('skipped coverage must record every required category as missing');
    }
  } else {
    if (!sameStringSet(observedCategories, computedObserved)) {
      blockers.push('coverage.observedCategories must match satisfied query categories');
    }
    if (!sameStringSet(missingCategories, computedMissing)) {
      blockers.push('coverage.missingCategories must match unsatisfied query categories');
    }
  }

  const coverageSatisfied = computedMissing.length === 0 && multilingualSatisfied;
  if (coverage.satisfied !== coverageSatisfied) {
    blockers.push('coverage.satisfied must reflect category and multilingual coverage');
  }
  if (options.requireCoverage === true && status === 'passed' && coverage.satisfied !== true) {
    blockers.push('passed live diagnostic with requireCoverage must satisfy real coverage categories');
  }
}

function createProvider(config: WebSearchLiveProviderConfigured, env: Record<string, string | undefined>, fetchImpl?: typeof fetch): SearchCandidateProvider {
  if (config.kind === 'searxng') return createSearxngLiveProvider(config, env, fetchImpl);
  return createJsonEndpointProvider(config, fetchImpl);
}

function createSearxngLiveProvider(config: WebSearchLiveProviderConfigured, env: Record<string, string | undefined>, fetchImpl?: typeof fetch): SearchCandidateProvider {
  const searchParams = buildSearxngSearchParams(env);
  const headers = buildSearxngHeaders(env);
  return {
    id: config.id,
    selfLinkBaseUrl: config.baseUrl,
    async search(request) {
      const url = new URL('/search', config.baseUrl);
      for (const [key, value] of Object.entries(searchParams)) {
        url.searchParams.set(key, value);
      }
      url.searchParams.set('q', request.query);
      url.searchParams.set('format', 'json');
      if (request.language && !url.searchParams.has('language')) url.searchParams.set('language', request.language);
      if (request.safeSearch && !url.searchParams.has('safesearch')) url.searchParams.set('safesearch', searxngSafeSearch(request.safeSearch));
      return fetchJsonCandidates({
        providerId: config.id,
        url,
        request,
        fetchImpl,
        headers,
        mapPayload: searxngCandidatesFromPayload,
      });
    },
  };
}

function createJsonEndpointProvider(config: WebSearchLiveProviderConfigured, fetchImpl?: typeof fetch): SearchCandidateProvider {
  return {
    id: config.id,
    selfLinkBaseUrl: config.baseUrl,
    async search(request) {
      const url = new URL(config.baseUrl);
      if (config.kind === 'openserp') {
        if (!/\/search\/?$/i.test(url.pathname)) {
          url.pathname = `${url.pathname.replace(/\/+$/, '')}/search`;
        }
        url.searchParams.delete('q');
        if (!url.searchParams.has('text')) url.searchParams.set('text', request.query);
      } else if (!url.searchParams.has('q')) {
        url.searchParams.set('q', request.query);
      }
      if (!url.searchParams.has('format')) url.searchParams.set('format', 'json');
      return fetchJsonCandidates({
        providerId: config.id,
        url,
        request,
        fetchImpl,
        mapPayload: genericCandidatesFromPayload,
      });
    },
  };
}

async function fetchJsonCandidates(input: {
  providerId: string;
  url: URL;
  request: SearchCandidateProviderRequest;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  mapPayload: (payload: unknown, limit: number) => SearchCandidate[];
}): Promise<SearchCandidateProviderResult> {
  const started = nowMs();
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.request.timeoutMs);
  try {
    const response = await fetchImpl(input.url, {
      signal: controller.signal,
      headers: {
        ...(input.headers ?? {}),
        Accept: 'application/json',
      },
    });
    const fetchMs = elapsedMs(started);
    if (response.status === 429) {
      return providerFailure('rate_limited', `${input.providerId} returned HTTP 429.`, fetchMs);
    }
    if (!response.ok) {
      return providerFailure('provider_unavailable', `${input.providerId} returned HTTP ${response.status}.`, fetchMs);
    }
    const parseStarted = nowMs();
    const payload = await response.json();
    const candidates = input.mapPayload(payload, input.request.limit);
    if (!candidates.length) {
      return {
        status: 'no_results',
        candidates: [],
        error: { code: 'no_results', message: `${input.providerId} returned no candidates.` },
        diagnostics: { noResults: true },
        timings: { fetchMs, parseMs: elapsedMs(parseStarted) },
      };
    }
    return {
      status: 'completed',
      candidates,
      diagnostics: {},
      timings: { fetchMs, parseMs: elapsedMs(parseStarted) },
    };
  } catch (error) {
    const code = isAbortLike(error) ? 'timeout' : 'provider_unavailable';
    return {
      status: code,
      candidates: [],
      error: { code, message: `${input.providerId} request failed: ${boundedMessage(errorMessage(error))}` },
      diagnostics: code === 'timeout' ? { timeout: true } : { providerDegraded: true },
      timings: { fetchMs: elapsedMs(started), parseMs: 0 },
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readCandidateForCoverage(input: {
  workspacePath: string;
  resourceRefs: WebReadResourceRef[];
  timeoutMs: number;
  readMaxChars: number;
  allowPrivateNetwork: boolean;
  now: () => string;
  coverageCategory: WebSearchLiveCoverageCategory;
  readImpl?: typeof readWebPageStatic;
}): Promise<WebSearchLiveDiagnosticQueryRun['read'] | undefined> {
  let firstSummary: WebSearchLiveDiagnosticQueryRun['read'] | undefined;
  let firstFailure: WebSearchLiveDiagnosticQueryRun['read'] | undefined;
  const readImpl = input.readImpl ?? readWebPageStatic;

  for (const resource of input.resourceRefs) {
    const started = nowMs();
    try {
      const read = await readImpl({
        workspacePath: input.workspacePath,
        resourceRef: resource.ref,
        resourceRefs: input.resourceRefs,
        format: 'text',
        maxChars: input.readMaxChars,
        timeoutMs: input.timeoutMs,
        networkPolicy: {
          allowPrivateNetwork: input.allowPrivateNetwork,
        },
        openedAt: input.now(),
      });
      const summary = summarizeReadResult(read, resource.ref, elapsedMs(started), input.coverageCategory);
      firstSummary ??= summary;
      if (!read.ok) firstFailure ??= summary;
      if (queryRunReadSatisfiesCategory(summary, input.coverageCategory)) return summary;
    } catch (error) {
      const summary: WebSearchLiveDiagnosticQueryRun['read'] = {
        status: 'failed',
        attemptedCandidateRef: resource.ref,
        durationMs: elapsedMs(started),
        error: boundedMessage(errorMessage(error)),
      };
      firstSummary ??= summary;
      firstFailure ??= summary;
      if (queryRunReadSatisfiesCategory(summary, input.coverageCategory)) return summary;
    }
  }
  return firstFailure ?? firstSummary;
}

async function readCoverageProbe(input: {
  workspacePath: string;
  probe: LiveDiagnosticCoverageProbe;
  timeoutMs: number;
  readMaxChars: number;
  allowPrivateNetwork: boolean;
  now: () => string;
  readImpl?: typeof readWebPageStatic;
}): Promise<WebSearchLiveCoverageProbeRun> {
  const readImpl = input.readImpl ?? readWebPageStatic;
  const started = nowMs();
  let summary: WebSearchLiveDiagnosticQueryRun['read'];
  try {
    const read = await readImpl({
      workspacePath: input.workspacePath,
      url: input.probe.url,
      format: 'text',
      maxChars: input.readMaxChars,
      timeoutMs: input.timeoutMs,
      networkPolicy: {
        allowPrivateNetwork: input.allowPrivateNetwork,
      },
      cachePolicy: 'bypass',
      openedAt: input.now(),
    });
    summary = summarizeReadResult(read, `coverage-probe:${input.probe.probeId}`, elapsedMs(started), input.probe.coverageCategory);
  } catch (error) {
    summary = {
      status: 'failed',
      attemptedCandidateRef: `coverage-probe:${input.probe.probeId}`,
      finalUrl: input.probe.url,
      durationMs: elapsedMs(started),
      error: boundedMessage(errorMessage(error)),
    };
  }
  const run: WebSearchLiveCoverageProbeRun = {
    probeId: input.probe.probeId,
    coverageCategory: input.probe.coverageCategory,
    url: input.probe.url,
    read: summary,
  };
  const probeRef = await persistCoverageProbeRef(input.workspacePath, run);
  return {
    ...run,
    probeRef,
  };
}

function summarizeReadResult(
  read: Awaited<ReturnType<typeof readWebPageStatic>>,
  attemptedCandidateRef: string,
  durationMs: number,
  coverageCategory: WebSearchLiveCoverageCategory,
): WebSearchLiveDiagnosticQueryRun['read'] {
  if (read.ok && read.data) {
    return {
      status: read.status,
      attemptedCandidateRef,
      sourcePageRef: read.refs.sourcePageRef,
      pageTextRef: read.refs.pageTextRef,
      finalUrl: read.data.finalUrl,
      durationMs,
      httpStatus: read.diagnostics.httpStatus,
      textCharCount: read.data.textCharCount,
      textSha1: read.data.textSha1,
      preview: boundedPreview(read.data.textPreview),
      ...(read.warnings.length ? { warnings: read.warnings.map(boundedMessage) } : {}),
    };
  }

  const browserRenderRequired = coverageCategory === 'js_heavy_browser_render_required' && staticReadNeedsBrowser(read);
  return {
    status: browserRenderRequired ? 'needs_browser' : read.status,
    attemptedCandidateRef,
    ...(read.diagnostics.finalUrl || read.diagnostics.requestedUrl ? {
      finalUrl: read.diagnostics.finalUrl ?? read.diagnostics.requestedUrl,
    } : {}),
    durationMs,
    ...(read.diagnostics.httpStatus ? { httpStatus: read.diagnostics.httpStatus } : {}),
    ...(read.diagnostics.blockedReason ? { blockedReason: boundedMessage(read.diagnostics.blockedReason) } : {}),
    ...(read.diagnostics.networkError ? { networkError: boundedMessage(read.diagnostics.networkError) } : {}),
    ...(browserRenderRequired ? { browserRenderRequired: true } : {}),
    ...(read.warnings.length ? { warnings: read.warnings.map(boundedMessage) } : {}),
    ...(read.error ? { error: boundedMessage(read.error.message) } : {}),
  };
}

function buildCoverageSummary(
  queryRuns: WebSearchLiveDiagnosticQueryRun[],
  coverageProbes: WebSearchLiveCoverageProbeRun[] = [],
): WebSearchLiveCoverageSummary {
  const distinctLanguages = uniqueStrings(queryRuns.map((run) => run.language.trim()).filter(Boolean));
  const categoryResults = Object.fromEntries(WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES.map((category) => {
    const categoryRuns = queryRuns.filter((run) => run.coverageCategory === category);
    const categoryProbes = coverageProbes.filter((probe) => probe.coverageCategory === category);
    const satisfyingRuns = categoryRuns.filter((run) => queryRunSatisfiesCoverage(run, category));
    const satisfyingProbes = categoryProbes.filter((probe) => coverageProbeSatisfiesCoverage(probe, category));
    const status: WebSearchLiveCoverageStatus = satisfyingRuns.length || satisfyingProbes.length
      ? 'satisfied'
      : categoryRuns.length || categoryProbes.length ? 'failed' : 'missing';
    return [category, {
      status,
      queryRunIds: categoryRuns.map((run) => run.queryId),
      probeIds: categoryProbes.map((probe) => probe.probeId),
      refs: uniqueStrings([
        ...satisfyingRuns.flatMap((run) => refsForCoverageRun(run)),
        ...satisfyingProbes.flatMap((probe) => refsForCoverageProbe(probe)),
      ]).slice(0, 20),
      ...(status === 'satisfied' ? {} : { message: coverageCategoryMessage(category, status) }),
    }];
  })) as Record<WebSearchLiveCoverageCategory, WebSearchLiveCoverageCategoryResult>;
  const observedCategories = WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES
    .filter((category) => categoryResults[category].status === 'satisfied');
  const missingCategories = WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES
    .filter((category) => categoryResults[category].status !== 'satisfied');
  const multilingual = {
    requiredQueryRuns: WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT,
    observedQueryRuns: queryRuns.length,
    distinctLanguages,
    satisfied: queryRuns.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
      && distinctLanguages.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT,
  };
  return {
    requiredCategories: [...WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES],
    observedCategories,
    missingCategories,
    categoryResults,
    multilingual,
    satisfied: missingCategories.length === 0 && multilingual.satisfied,
  };
}

function buildSearchProofSummary(queryRuns: WebSearchLiveDiagnosticQueryRun[]): WebSearchLiveSearchProofSummary {
  const distinctLanguages = uniqueStrings(queryRuns.map((run) => run.language.trim()).filter(Boolean));
  return {
    requiredQueryRuns: WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT,
    observedQueryRuns: queryRuns.length,
    queryRunsWithCandidates: queryRuns.filter((run) => searchRecordHasCandidates(record(run.search))).length,
    queryRunsWithTiming: queryRuns.filter((run) => searchRecordHasTiming(record(run.search))).length,
    distinctLanguages,
    satisfied: queryRuns.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
      && distinctLanguages.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
      && queryRuns.every((run) => searchRecordSatisfiesSearchProof(record(run.search))),
  };
}

function queryRunSatisfiesCoverage(run: WebSearchLiveDiagnosticQueryRun, category: WebSearchLiveCoverageCategory): boolean {
  return searchRecordSatisfiesCoverage(record(run.search))
    && queryRunReadSatisfiesCategory(record(run.read), category);
}

function queryRunRecordSatisfiesCoverage(run: Record<string, unknown>, category: WebSearchLiveCoverageCategory): boolean {
  return searchRecordSatisfiesCoverage(record(run.search))
    && queryRunReadSatisfiesCategory(record(run.read), category);
}

function coverageProbeSatisfiesCoverage(probe: WebSearchLiveCoverageProbeRun, category: WebSearchLiveCoverageCategory): boolean {
  return stringValue(probe.probeRef).startsWith('web-coverage-probe:')
    && queryRunReadSatisfiesCategory(record(probe.read), category);
}

function coverageProbeRecordSatisfiesCoverage(probe: Record<string, unknown>, category: WebSearchLiveCoverageCategory): boolean {
  return stringValue(probe.probeRef).startsWith('web-coverage-probe:')
    && queryRunReadSatisfiesCategory(record(probe.read), category);
}

function queryRunReadSatisfiesCategory(read: Record<string, unknown>, category: WebSearchLiveCoverageCategory): boolean {
  switch (category) {
    case 'news_webpage':
    case 'ordinary_docs_page':
      return readableReadRecord(read);
    case 'js_heavy_browser_render_required':
      return browserRequiredReadRecord(read);
    case 'auth_blocked_or_403_401_surrogate':
      return authBlockedReadRecord(read);
    case 'network_failure':
      return networkFailureReadRecord(read);
  }
}

function searchRecordSatisfiesCoverage(search: Record<string, unknown>): boolean {
  return search.status === 'completed'
    && stringValue(search.searchResultSetRef).startsWith('web-search:')
    && arrayValue(search.candidateRefs).length > 0;
}

function searchRecordSatisfiesSearchProof(search: Record<string, unknown>): boolean {
  return searchRecordSatisfiesCoverage(search)
    && numberValue(search.resultCount) > 0
    && searchRecordHasTiming(search);
}

function searchRecordHasCandidates(search: Record<string, unknown>): boolean {
  return search.status === 'completed'
    && numberValue(search.resultCount) > 0
    && arrayValue(search.candidateRefs).length > 0
    && stringValue(search.searchResultSetRef).startsWith('web-search:');
}

function searchRecordHasTiming(search: Record<string, unknown>): boolean {
  const durationMs = numberValue(search.durationMs);
  return Number.isFinite(durationMs) && durationMs >= 0;
}

function readableReadRecord(read: Record<string, unknown>): boolean {
  return readStatusSatisfies(stringValue(read.status))
    && stringValue(read.sourcePageRef).startsWith('web-source:')
    && stringValue(read.pageTextRef).startsWith('web-text:')
    && /^[a-f0-9]{40}$/i.test(stringValue(read.textSha1));
}

function browserRequiredReadRecord(read: Record<string, unknown>): boolean {
  const evidence = [
    stringValue(read.status),
    stringValue(read.blockedReason),
    stringValue(read.error),
  ].join(' ');
  return read.browserRenderRequired === true
    || stringValue(read.status) === 'needs_browser'
    || /empty_extracted_text|needs_browser|browser render|required browser|no readable page text/i.test(evidence);
}

function authBlockedReadRecord(read: Record<string, unknown>): boolean {
  const status = stringValue(read.status);
  const evidence = [
    stringValue(read.blockedReason),
    stringValue(read.error),
  ].join(' ');
  const httpStatus = numberValue(read.httpStatus);
  return (status === 'blocked' || status === 'needs_user_browser')
    && (httpStatus === 401 || httpStatus === 403 || /http_40[13]|login|auth|authentication|account required|captcha/i.test(evidence));
}

function networkFailureReadRecord(read: Record<string, unknown>): boolean {
  const status = stringValue(read.status);
  const evidence = [
    stringValue(read.networkError),
    stringValue(read.blockedReason),
    stringValue(read.error),
  ].join(' ');
  return (status === 'failed' || status === 'timeout')
    && /network|fetch failed|econn|enotfound|ehost|timeout|timed out|failed before reading/i.test(evidence);
}

function refsForCoverageRun(run: WebSearchLiveDiagnosticQueryRun): string[] {
  return [
    run.search.searchResultSetRef,
    ...run.search.candidateRefs,
    run.read.sourcePageRef,
    run.read.pageTextRef,
  ].filter(Boolean) as string[];
}

function refsForCoverageProbe(probe: WebSearchLiveCoverageProbeRun): string[] {
  return [
    probe.probeRef,
    probe.read.sourcePageRef,
    probe.read.pageTextRef,
  ].filter(Boolean) as string[];
}

function coverageCategoryMessage(category: WebSearchLiveCoverageCategory, status: WebSearchLiveCoverageStatus): string {
  if (status === 'missing') return `No query run or coverage probe recorded required category ${category}.`;
  return `No query run or coverage probe satisfied required category ${category}.`;
}

function staticReadNeedsBrowser(read: Awaited<ReturnType<typeof readWebPageStatic>>): boolean {
  const evidence = [
    read.error?.code,
    read.error?.message,
    read.diagnostics.blockedReason,
  ].join(' ');
  return /extract_failed|empty_extracted_text|no readable page text|needs_browser|browser render/i.test(evidence);
}

function searchResourceRefs(search: Awaited<ReturnType<typeof runWebSearch>>): WebReadResourceRef[] {
  const byRef = new Map(search.data?.results.map((result) => [result.ref, result]) ?? []);
  return search.refs.discoveredPageRefs.map((candidate) => {
    const result = byRef.get(candidate.ref);
    return {
      ref: candidate.ref,
      kind: 'web_page',
      sourceTool: 'web_search',
      locator: { url: candidate.url },
      url: candidate.url,
      ...(result?.title ? { title: result.title } : {}),
    };
  });
}

function searxngCandidatesFromPayload(payload: unknown, limit: number): SearchCandidate[] {
  return arrayValue(record(payload).results)
    .map((item) => {
      const value = record(item);
      return {
        title: stringValue(value.title),
        url: stringValue(value.url),
        snippet: stringValue(value.content) || stringValue(value.snippet),
        source: stringValue(value.engine) || arrayValue(value.engines).map(String).filter(Boolean).join(', '),
        publishedAt: stringValue(value.publishedDate) || stringValue(value.publishedAt) || stringValue(value.published_at),
      };
    })
    .filter((candidate) => candidate.title && candidate.url)
    .slice(0, Math.max(limit, DEFAULT_SEARCH_LIMIT));
}

function genericCandidatesFromPayload(payload: unknown, limit: number): SearchCandidate[] {
  const root = record(payload);
  const candidates = firstArray(root.results, root.organic_results, root.items, root.data);
  return candidates
    .map((item) => {
      const value = record(item);
      return {
        title: stringValue(value.title) || stringValue(value.name),
        url: stringValue(value.url) || stringValue(value.link) || stringValue(value.href),
        snippet: stringValue(value.snippet) || stringValue(value.content) || stringValue(value.description),
        source: stringValue(value.source) || stringValue(value.engine),
        publishedAt: stringValue(value.publishedAt) || stringValue(value.date),
      };
    })
    .filter((candidate) => candidate.title && candidate.url)
    .slice(0, Math.max(limit, DEFAULT_SEARCH_LIMIT));
}

function providerFailure(
  code: 'provider_unavailable' | 'timeout' | 'rate_limited',
  message: string,
  fetchMs: number,
): SearchCandidateProviderResult {
  return {
    status: code,
    candidates: [],
    error: { code, message },
    diagnostics: {
      providerDegraded: code !== 'timeout',
      timeout: code === 'timeout',
      rateLimited: code === 'rate_limited',
    },
    timings: { fetchMs, parseMs: 0 },
  };
}

function buildSearxngTuningSummary(env: Record<string, string | undefined>): WebSearchLiveProviderConfigured['searxng'] | undefined {
  const searchParamNames = Object.keys(buildSearxngSearchParams(env)).sort();
  const headerNames = Object.keys(buildSearxngHeaders(env)).map((name) => name.toLowerCase()).sort();
  if (!searchParamNames.length && !headerNames.length) return undefined;
  return {
    searchParamNames,
    headerNames,
  };
}

function buildSearxngSearchParams(env: Record<string, string | undefined>): Record<string, string> {
  const params = parseKeyValueConfig(firstNonEmpty(
    env.SCIFORGE_SEARXNG_SEARCH_PARAMS,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_SEARCH_PARAMS,
    env.SEARXNG_SEARCH_PARAMS,
  ));
  const preset = searxngPreset(firstNonEmpty(
    env.SCIFORGE_SEARXNG_PRESET,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_PRESET,
    env.SEARXNG_PRESET,
  ));
  const categories = firstNonEmpty(
    env.SCIFORGE_SEARXNG_CATEGORIES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_CATEGORIES,
    env.SEARXNG_CATEGORIES,
    preset?.categories,
  );
  const engines = firstNonEmpty(
    env.SCIFORGE_SEARXNG_ENGINES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_ENGINES,
    env.SEARXNG_ENGINES,
    preset?.engines,
  );
  const disabledEngines = firstNonEmpty(
    env.SCIFORGE_SEARXNG_DISABLED_ENGINES,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_DISABLED_ENGINES,
    env.SEARXNG_DISABLED_ENGINES,
  );
  if (categories) params.categories = categories;
  if (engines) params.engines = engines;
  if (disabledEngines) params.disabled_engines = disabledEngines;
  delete params.q;
  delete params.format;
  return sanitizeSearchParams(params);
}

function searxngPreset(value: string | undefined): { categories?: string; engines?: string } | undefined {
  const key = value?.trim().toLowerCase();
  if (!key) return undefined;
  return key === 'docs' || key === 'science' || key === 'stable' ? SEARXNG_PRESETS[key] : undefined;
}

function buildSearxngHeaders(env: Record<string, string | undefined>): Record<string, string> {
  return sanitizeHeaders(parseKeyValueConfig(firstNonEmpty(
    env.SCIFORGE_SEARXNG_HEADERS,
    env.SCIFORGE_WEB_SEARCH_SEARXNG_HEADERS,
    env.SEARXNG_HEADERS,
  )));
}

function parseKeyValueConfig(value: string | undefined): Record<string, string> {
  const raw = value?.trim();
  if (!raw) return {};
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Object.fromEntries(Object.entries(record(parsed))
        .map(([key, item]) => [key.trim(), String(item).trim()])
        .filter(([key, item]) => key && item));
    } catch {
      return {};
    }
  }
  return Object.fromEntries([...new URLSearchParams(raw).entries()]
    .map(([key, item]) => [key.trim(), item.trim()])
    .filter(([key, item]) => key && item));
}

function sanitizeSearchParams(params: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(params)
    .filter(([key, value]) => /^[a-zA-Z0-9_.-]+$/.test(key) && safeHeaderOrParamValue(value)));
}

function sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers)
    .filter(([key, value]) => /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(key) && safeHeaderOrParamValue(value)));
}

function safeHeaderOrParamValue(value: string): boolean {
  return Boolean(value.trim()) && !/[\r\n]/.test(value);
}

function buildCoverageProbeDefinitions(
  option: RunWebSearchLiveDiagnosticOptions['coverageProbes'],
  env: Record<string, string | undefined>,
): LiveDiagnosticCoverageProbe[] {
  if (Array.isArray(option)) return normalizeCoverageProbes(option);
  const raw = firstNonEmpty(
    typeof option === 'string' ? option : undefined,
    env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_PROBES,
    env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_PROBE_URLS,
  );
  if (raw?.toLowerCase() === 'default') return [...DEFAULT_LIVE_COVERAGE_PROBES];
  if (raw?.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return normalizeCoverageProbes(parsed);
    } catch {
      return [];
    }
  }
  const fromEnv = coverageProbesFromCategoryEnv(env);
  return fromEnv.length ? fromEnv : [];
}

function coverageProbesFromCategoryEnv(env: Record<string, string | undefined>): LiveDiagnosticCoverageProbe[] {
  const entries: Array<[WebSearchLiveCoverageCategory, string, string | undefined]> = [
    ['news_webpage', 'env-news-webpage', env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_NEWS_URL],
    ['ordinary_docs_page', 'env-ordinary-docs-page', env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_DOCS_URL],
    ['js_heavy_browser_render_required', 'env-js-heavy-browser-render-required', env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_JS_HEAVY_URL],
    ['auth_blocked_or_403_401_surrogate', 'env-auth-blocked-or-403-401-surrogate', env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_AUTH_URL],
    ['network_failure', 'env-network-failure', env.SCIFORGE_WEB_SEARCH_LIVE_COVERAGE_NETWORK_URL],
  ];
  return normalizeCoverageProbes(entries
    .map(([coverageCategory, probeId, url]) => ({
      probeId,
      coverageCategory,
      url: url ?? '',
    })));
}

function normalizeCoverageProbes(probes: unknown[]): LiveDiagnosticCoverageProbe[] {
  const seen = new Set<string>();
  return probes
    .map((probe) => ({
      probeId: safeProbeId(stringValue(record(probe).probeId)) || safeProbeId(`${record(probe).coverageCategory}-${seen.size + 1}`),
      coverageCategory: stringValue(record(probe).coverageCategory) as WebSearchLiveCoverageCategory,
      url: stringValue(record(probe).url).trim(),
    }))
    .filter((probe) => {
      if (!probe.probeId || seen.has(probe.probeId)) return false;
      if (!isLiveCoverageCategory(probe.coverageCategory)) return false;
      if (!normalizeUrl(probe.url)) return false;
      seen.add(probe.probeId);
      return true;
    });
}

function safeProbeId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

async function persistCoverageProbeRef(workspacePath: string, probe: WebSearchLiveCoverageProbeRun): Promise<string> {
  const artifact = {
    schemaVersion: 'sciforge.web-search.live-coverage-probe.v1',
    probeId: probe.probeId,
    coverageCategory: probe.coverageCategory,
    url: probe.url,
    read: probe.read,
  };
  const digest = createHash('sha1').update(JSON.stringify(artifact)).digest('hex').slice(0, 16);
  const probeRef = `web-coverage-probe:${digest}`;
  const artifactPath = resolve(workspacePath, '.sciforge', 'web-search', 'coverage-probes', `probe-${digest}.json`);
  await mkdir(dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify({ ...artifact, probeRef }, null, 2)}\n`, 'utf8');
  return probeRef;
}

async function writeManifest(out: string, manifest: WebSearchLiveDiagnosticManifest) {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function configuredProvider(
  id: string,
  kind: WebSearchLiveProviderKind,
  baseUrl: string,
  timeoutMs: number | undefined,
  allowPrivateNetwork: boolean,
  searxng?: WebSearchLiveProviderConfigured['searxng'],
): WebSearchLiveProviderConfigured {
  const normalized = normalizeUrl(baseUrl);
  if (!normalized) {
    return {
      configured: true,
      id,
      kind,
      baseUrl,
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(allowPrivateNetwork ? { allowPrivateNetwork } : {}),
      ...(searxng ? { searxng } : {}),
    };
  }
  return {
    configured: true,
    id,
    kind,
    baseUrl: normalized,
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(allowPrivateNetwork ? { allowPrivateNetwork } : {}),
    ...(searxng ? { searxng } : {}),
  };
}

function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { json: false, requireCoverage: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--require-coverage' || arg === '--strict-coverage') {
      args.requireCoverage = true;
    } else if (arg === '--coverage-probes') {
      args.coverageProbes = requiredArg(arg, next);
      index += 1;
    } else if (arg === '--out') {
      args.out = requiredArg(arg, next);
      index += 1;
    } else if (arg === '--workspace') {
      args.workspacePath = requiredArg(arg, next);
      index += 1;
    } else if (arg === '--timeout-ms') {
      args.timeoutMs = parsePositiveCliInteger(arg, next);
      index += 1;
    } else if (arg === '--read-max-chars') {
      args.readMaxChars = parsePositiveCliInteger(arg, next);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  console.log([
    'Usage: tsx tools/web-search-live-diagnostic.ts [--out manifest.json] [--workspace path] [--coverage-probes default|json] [--require-coverage] [--json]',
    '',
    'Required provider env, choose one:',
    ...REQUIRED_PROVIDER_ENV_HINTS.map((hint) => `  - ${hint}`),
    '',
    'Optional:',
    '  SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK=1 allows local/private candidate page reads.',
    '  SCIFORGE_SEARXNG_CATEGORIES=science and SCIFORGE_SEARXNG_ENGINES=openalex,crossref,arxiv tune local SearXNG sidecars.',
    '  SCIFORGE_SEARXNG_SEARCH_PARAMS="disabled_engines=google,duckduckgo&time_range=year" adds SearXNG query params.',
    '  SCIFORGE_SEARXNG_HEADERS=\'{"Accept-Language":"en-US,en;q=0.8"}\' adds request headers; manifests record header names only.',
    '  --coverage-probes default runs independent real web_read probes for required live coverage categories.',
    '  --require-coverage fails the live diagnostic unless all required real coverage categories are satisfied.',
    '',
    'Local SearXNG example without Docker:',
    '  npm run web-search-searxng-sidecar -- --port 18890',
    '  SCIFORGE_SEARXNG_BASE_URL=http://127.0.0.1:18890 SCIFORGE_SEARXNG_PRESET=science npm run web-search-live-diagnostic -- --out docs/test-artifacts/web-search-live-diagnostic/manifest.json',
  ].join('\n'));
}

function printSummary(manifest: WebSearchLiveDiagnosticManifest, out: string, json: boolean) {
  if (json) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }
  console.log(`web-search-live-diagnostic status=${manifest.status} provider=${manifest.provider.id} out=${out}`);
  if (manifest.skipReason) {
    console.error(manifest.skipReason.message);
    console.error(`Required env: ${manifest.skipReason.requiredEnv.join(' | ')}`);
    return;
  }
  console.log([
    `searchProof=${manifest.searchProof.satisfied ? 'satisfied' : 'missing'}`,
    `coverage=${manifest.coverage.satisfied ? 'satisfied' : 'missing'}`,
    `queries=${manifest.searchProof.observedQueryRuns}/${manifest.searchProof.requiredQueryRuns}`,
    `candidates=${manifest.searchProof.queryRunsWithCandidates}/${manifest.searchProof.requiredQueryRuns}`,
    `timing=${manifest.searchProof.queryRunsWithTiming}/${manifest.searchProof.requiredQueryRuns}`,
    `missingCoverage=${manifest.coverage.missingCategories.join(',') || 'none'}`,
  ].join(' '));
  for (const run of manifest.queryRuns) {
    const primaryRef = run.read.pageTextRef ?? run.read.sourcePageRef ?? run.search.searchResultSetRef ?? 'no-ref';
    console.log([
      run.queryId,
      `search=${run.search.status}/${run.search.durationMs}ms`,
      `read=${run.read.status}/${run.read.durationMs}ms`,
      `ref=${primaryRef}`,
    ].join(' '));
  }
  console.log(`refs=${manifest.refs.slice(0, 30).join(' ')}`);
  console.log(`timings search=${manifest.timingSummary.searchTotalMs}ms read=${manifest.timingSummary.readTotalMs}ms total=${manifest.timingSummary.totalMs}ms`);
}

function requiredArg(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function parsePositiveCliInteger(flag: string, value: string | undefined): number {
  const parsed = Number.parseInt(requiredArg(flag, value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

function normalizeUrl(value: string): string | undefined {
  try {
    return new URL(value.trim()).toString();
  } catch {
    return undefined;
  }
}

function readStatusSatisfies(status: string): boolean {
  return status === 'read' || status === 'partial';
}

function cleanEnv(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()))?.trim();
}

function boundedPositiveInteger(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function truthyEnv(value: string | undefined): boolean {
  return /^(?:1|true|yes|on)$/i.test((value ?? '').trim());
}

function firstArray(...values: unknown[]): unknown[] {
  return values.find(Array.isArray) as unknown[] ?? [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN;
}

function isLiveCoverageCategory(value: string): value is WebSearchLiveCoverageCategory {
  return (WEB_SEARCH_LIVE_REQUIRED_COVERAGE_CATEGORIES as readonly string[]).includes(value);
}

function sameStringSet(values: readonly string[], expected: readonly string[]): boolean {
  const valueSet = new Set(values);
  const expectedSet = new Set(expected);
  if (valueSet.size !== expectedSet.size) return false;
  return [...expectedSet].every((value) => valueSet.has(value));
}

function boundedPreview(value: string): string {
  return boundedMessage(value, 320);
}

function boundedMessage(value: string, limit = 240): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1)}…`;
}

function searxngSafeSearch(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off' || normalized === 'none' || normalized === '0') return '0';
  if (normalized === 'strict' || normalized === '2') return '2';
  return '1';
}

function nowMs() {
  return performance.now();
}

function elapsedMs(start: number) {
  return roundMs(nowMs() - start);
}

function roundMs(value: number) {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

function isAbortLike(error: unknown): boolean {
  return /abort|timeout/i.test(errorMessage(error)) || record(error).name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const workspacePath = resolve(args.workspacePath ?? process.cwd());
    const out = resolve(workspacePath, args.out ?? DEFAULT_OUT);
    const manifest = await runWebSearchLiveDiagnostic({
      workspacePath,
      out,
      timeoutMs: args.timeoutMs,
      readMaxChars: args.readMaxChars,
      requireCoverage: args.requireCoverage,
      coverageProbes: args.coverageProbes,
    });
    printSummary(manifest, out, args.json);
    if (manifest.status !== 'passed') process.exitCode = manifest.status === 'skipped' ? 2 : 1;
  } catch (error) {
    console.error(`web-search-live-diagnostic failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
