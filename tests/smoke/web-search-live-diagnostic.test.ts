import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT,
  WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION,
  buildWebSearchLiveProviderConfig,
  runWebSearchLiveDiagnostic,
  validateWebSearchLiveDiagnosticManifest,
  type WebSearchLiveCoverageCategory,
  type WebSearchLiveCoverageSummary,
  type WebSearchLiveDiagnosticManifest,
  type WebSearchLiveDiagnosticQueryRun,
} from '../../tools/web-search-live-diagnostic.js';
import type {
  WebReadErrorCode,
  WebReadResult,
  WebReadStaticInput,
  WebReadStatus,
} from '../../src/runtime/web-read-runtime.js';

const requiredCoverageCategories = [
  'news_webpage',
  'ordinary_docs_page',
  'js_heavy_browser_render_required',
  'auth_blocked_or_403_401_surrogate',
  'network_failure',
] as const;
type CoverageCategory = WebSearchLiveCoverageCategory;
type CoverageQueryRun = WebSearchLiveDiagnosticQueryRun;

test('web search live diagnostic writes explicit skipped manifest without provider env', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-skip-'));
  const out = join(workspacePath, 'manifest.json');
  try {
    const manifest = await runWebSearchLiveDiagnostic({
      env: {},
      out,
      workspacePath,
      now: () => new Date('2026-06-10T08:00:00.000Z'),
    });
    const written = JSON.parse(await readFile(out, 'utf8'));

    assert.equal(manifest.schemaVersion, WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION);
    assert.equal(written.status, 'skipped');
    assert.equal(written.diagnosticOnly, true);
    assert.equal(written.productProof, false);
    assert.equal(written.releaseEligible, false);
    assert.equal(written.provider.configured, false);
    assert.deepEqual(written.coverage.requiredCategories, requiredCoverageCategories);
    assert.deepEqual(written.coverage.missingCategories, requiredCoverageCategories);
    assert.equal(written.coverage.multilingual.satisfied, false);
    assert.match(written.skipReason.message, /configure.*SearXNG|OpenSERP|provider/i);
    assert.equal(validateWebSearchLiveDiagnosticManifest(written).valid, true);
    assert.doesNotMatch(JSON.stringify(written), /raw(?:Search|Read|Provider)?Payload|"<html|base64|\"text\"\s*:/i);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic CLI exits nonzero and writes skipped manifest without provider env', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-cli-skip-'));
  const out = 'manifest.json';
  try {
    const result = spawnSync(process.execPath, [
      '--import',
      'tsx',
      join(process.cwd(), 'tools/web-search-live-diagnostic.ts'),
      '--workspace',
      workspacePath,
      '--out',
      out,
      '--json',
    ], {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
      },
      encoding: 'utf8',
    });
    const written = JSON.parse(await readFile(join(workspacePath, out), 'utf8'));

    assert.equal(result.status, 2);
    assert.equal(written.status, 'skipped');
    assert.equal(written.skipReason.code, 'provider_env_missing');
    assert.deepEqual(written.coverage.requiredCategories, requiredCoverageCategories);
    assert.equal(written.productProof, false);
    assert.equal(written.releaseEligible, false);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic CLI help includes local provider run commands', () => {
  const result = spawnSync(process.execPath, [
    '--import',
    'tsx',
    join(process.cwd(), 'tools/web-search-live-diagnostic.ts'),
    '--help',
  ], {
    cwd: process.cwd(),
    env: {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Local SearXNG example without Docker/);
  assert.match(result.stdout, /npm run web-search-searxng-sidecar -- --port 18890/);
  assert.doesNotMatch(result.stdout, /docker run|searxng\/searxng:latest/i);
  assert.match(result.stdout, /SCIFORGE_SEARXNG_BASE_URL=http:\/\/127\.0\.0\.1:18890 .*npm run web-search-live-diagnostic/);
  assert.doesNotMatch(result.stdout, /commercial API/i);
});

test('web search live diagnostic CLI require-coverage rejects searchProof-only passed runs', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-cli-coverage-'));
  const fixture = await startSearchProofOnlyFixtureServer();
  try {
    const result = await spawnNodeCli([
      '--import',
      'tsx',
      join(process.cwd(), 'tools/web-search-live-diagnostic.ts'),
      '--workspace',
      workspacePath,
      '--out',
      'manifest.json',
      '--timeout-ms',
      '500',
      '--read-max-chars',
      '600',
      '--require-coverage',
      '--json',
    ], {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        SCIFORGE_WEB_SEARCH_PROVIDER: 'search-proof-only-fixture',
        SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL: `${fixture.baseUrl}/search`,
        SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK: '1',
      },
    });
    const written = JSON.parse(await readFile(join(workspacePath, 'manifest.json'), 'utf8'));

    assert.equal(result.status, 1);
    assert.equal(written.status, 'failed');
    assert.equal(written.searchProof.satisfied, true);
    assert.equal(written.coverage.satisfied, false);
    assert.match(written.failureReason.message, /coverage/i);
    assert.equal(validateWebSearchLiveDiagnosticManifest(written, { requireCoverage: true }).valid, true);
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic provider config supports SearXNG OpenSERP and generic env', () => {
  assert.deepEqual(buildWebSearchLiveProviderConfig({
    SCIFORGE_SEARXNG_BASE_URL: 'http://127.0.0.1:8080',
  }), {
    configured: true,
    id: 'searxng',
    kind: 'searxng',
    baseUrl: 'http://127.0.0.1:8080/',
  });

  assert.deepEqual(buildWebSearchLiveProviderConfig({
    SCIFORGE_OPENSERP_ENABLED: '1',
    SCIFORGE_OPENSERP_BASE_URL: 'http://127.0.0.1:7000',
  }), {
    configured: true,
    id: 'openserp',
    kind: 'openserp',
    baseUrl: 'http://127.0.0.1:7000/',
  });

  assert.deepEqual(buildWebSearchLiveProviderConfig({
    SCIFORGE_WEB_SEARCH_PROVIDER: 'local-provider',
    SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL: 'http://127.0.0.1:9999/search',
  }), {
    configured: true,
    id: 'local-provider',
    kind: 'generic-json',
    baseUrl: 'http://127.0.0.1:9999/search',
  });
});

test('web search live diagnostic SearXNG provider applies configured params and headers to every multilingual query', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-searxng-'));
  const closedPort = await reserveClosedPort();
  const fixture = await startSearxngRequestCaptureFixtureServer();
  try {
    const manifest = await runWebSearchLiveDiagnostic({
      env: {
        SCIFORGE_SEARXNG_BASE_URL: fixture.baseUrl,
        SCIFORGE_SEARXNG_CATEGORIES: 'science',
        SCIFORGE_SEARXNG_ENGINES: 'openalex,crossref,arxiv',
        SCIFORGE_SEARXNG_SEARCH_PARAMS: 'disabled_engines=google,duckduckgo&time_range=year',
        SCIFORGE_SEARXNG_HEADERS: JSON.stringify({
          'X-SciForge-Search': 'live-diagnostic',
          'Accept-Language': 'en-US,en;q=0.8',
        }),
        SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK: '1',
      },
      out: 'manifest.json',
      workspacePath,
      now: () => new Date('2026-06-10T08:00:00.000Z'),
      timeoutMs: 500,
      readMaxChars: 600,
      readImpl: async (input) => failedRead('failed', 'read_failed', input.resourceRef ?? 'unknown', {
        networkError: `connect ECONNREFUSED 127.0.0.1:${closedPort}`,
        message: 'Static fetch failed before reading page content.',
      }),
    });
    const written = JSON.parse(await readFile(join(workspacePath, 'manifest.json'), 'utf8'));
    const validation = validateWebSearchLiveDiagnosticManifest(written);

    assert.equal(manifest.provider.kind, 'searxng');
    assert.equal(written.searchProof.satisfied, true);
    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.equal(fixture.requests.length, WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT);
    assert.deepEqual(written.provider.searxng.searchParamNames.sort(), [
      'categories',
      'disabled_engines',
      'engines',
      'time_range',
    ]);
    assert.deepEqual(written.provider.searxng.headerNames.sort(), [
      'accept-language',
      'x-sciforge-search',
    ]);
    assert.doesNotMatch(JSON.stringify(written), /:"live-diagnostic"|en-US,en;q=0\.8/);
    for (const request of fixture.requests) {
      assert.equal(request.pathname, '/search');
      assert.equal(request.searchParams.q?.length > 0, true);
      assert.equal(request.searchParams.format, 'json');
      assert.equal(request.searchParams.categories, 'science');
      assert.equal(request.searchParams.engines, 'openalex,crossref,arxiv');
      assert.equal(request.searchParams.disabled_engines, 'google,duckduckgo');
      assert.equal(request.searchParams.time_range, 'year');
      assert.equal(request.headers['x-sciforge-search'], 'live-diagnostic');
      assert.equal(request.headers['accept-language'], 'en-US,en;q=0.8');
    }
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic validation requires five multilingual query runs, explicit coverage, and no product proof', () => {
  const base = buildCoverageManifest();

  assert.equal(validateWebSearchLiveDiagnosticManifest(base).valid, true);
  assert.deepEqual(base.coverage.requiredCategories, requiredCoverageCategories);
  assert.deepEqual(base.coverage.missingCategories, []);
  assert.equal(base.coverage.multilingual.satisfied, true);
  assert.equal(validateWebSearchLiveDiagnosticManifest({
    ...base,
    queryRuns: base.queryRuns.slice(0, 4),
  }).valid, false);
  assert.equal(validateWebSearchLiveDiagnosticManifest({
    ...base,
    productProof: true,
  }).valid, false);
  assert.equal(validateWebSearchLiveDiagnosticManifest({
    ...base,
    coverage: undefined,
  }).valid, false);
  assert.equal(validateWebSearchLiveDiagnosticManifest({
    ...base,
    queryRuns: base.queryRuns.map((run, index) => index === 2 ? {
      ...run,
      read: {
        status: 'blocked',
        attemptedCandidateRef: 'web-page:3',
        finalUrl: 'https://example.com/js-heavy',
        durationMs: 203,
        error: 'Generic blocked read without escalation evidence.',
      },
    } : run),
  }).valid, false);
  assert.equal(validateWebSearchLiveDiagnosticManifest({
    ...base,
    queryRuns: base.queryRuns.map((run, index) => index === 4 ? { ...run, language: 'en' } : run),
    coverage: {
      ...base.coverage,
      multilingual: {
        ...base.coverage.multilingual,
        distinctLanguages: ['zh-CN', 'es', 'ar', 'fr'],
        satisfied: false,
      },
    },
  }).valid, false);
});

test('web search live diagnostic validation accepts expected JS, auth, and network diagnostic categories without product proof', () => {
  const manifest = buildCoverageManifest({
    queryRuns: buildCoverageQueryRuns([
      {
        category: 'news_webpage',
        language: 'zh-CN',
        read: readSuccess(1),
      },
      {
        category: 'ordinary_docs_page',
        language: 'es',
        read: readSuccess(2),
      },
      {
        category: 'js_heavy_browser_render_required',
        language: 'ar',
        read: {
          status: 'needs_browser',
          attemptedCandidateRef: 'web-page:3',
          finalUrl: 'https://example.com/js-heavy',
          durationMs: 203,
          httpStatus: 200,
          blockedReason: 'empty_extracted_text',
          browserRenderRequired: true,
          error: 'Static HTML extraction returned no readable page text.',
        },
      },
      {
        category: 'auth_blocked_or_403_401_surrogate',
        language: 'fr',
        read: {
          status: 'blocked',
          attemptedCandidateRef: 'web-page:4',
          finalUrl: 'https://example.com/auth',
          durationMs: 204,
          httpStatus: 403,
          blockedReason: 'http_403',
          error: 'Static fetch was blocked by HTTP 403.',
        },
      },
      {
        category: 'network_failure',
        language: 'en',
        read: {
          status: 'failed',
          attemptedCandidateRef: 'web-page:5',
          finalUrl: 'http://127.0.0.1:9/network-failure',
          durationMs: 205,
          networkError: 'connect ECONNREFUSED 127.0.0.1:9',
          error: 'Static fetch failed before reading page content.',
        },
      },
    ]),
  });

  const validation = validateWebSearchLiveDiagnosticManifest(manifest);

  assert.equal(validation.valid, true, validation.blockers.join('\n'));
  assert.equal(manifest.diagnosticOnly, true);
  assert.equal(manifest.productProof, false);
  assert.equal(manifest.releaseEligible, false);
  assert.equal(manifest.coverage.categoryResults.js_heavy_browser_render_required.status, 'satisfied');
  assert.equal(manifest.coverage.categoryResults.auth_blocked_or_403_401_surrogate.status, 'satisfied');
  assert.equal(manifest.coverage.categoryResults.network_failure.status, 'satisfied');
});

test('web search live diagnostic controlled fixture records required live coverage without product proof', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-fixture-'));
  const closedPort = await reserveClosedPort();
  const fixture = await startCoverageFixtureServer(closedPort);
  try {
    const manifest = await runWebSearchLiveDiagnostic({
      env: {
        SCIFORGE_WEB_SEARCH_PROVIDER: 'controlled-fixture-provider',
        SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL: `${fixture.baseUrl}/search`,
        SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK: '1',
      },
      out: 'manifest.json',
      workspacePath,
      now: () => new Date('2026-06-10T08:00:00.000Z'),
      timeoutMs: 500,
      readMaxChars: 600,
      readImpl: (input) => fakeControlledRead(input, closedPort),
    });
    const written = JSON.parse(await readFile(join(workspacePath, 'manifest.json'), 'utf8'));
    const validation = validateWebSearchLiveDiagnosticManifest(written);

    assert.equal(manifest.status, 'passed');
    assert.equal(written.status, 'passed');
    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    assert.deepEqual(written.coverage.requiredCategories, requiredCoverageCategories);
    assert.deepEqual(written.coverage.missingCategories, []);
    assert.equal(written.coverage.multilingual.satisfied, true);
    assert.equal(written.productProof, false);
    assert.equal(written.releaseEligible, false);
    assert.equal(written.queryRuns.length, WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT);
    assert.equal(written.queryRuns[2].read.browserRenderRequired, true);
    assert.equal(written.queryRuns[3].read.httpStatus, 403);
    assert.match(written.queryRuns[4].read.networkError, /ECONNREFUSED|fetch failed|network/i);
    assert.doesNotMatch(JSON.stringify(written), /raw(?:Search|Read|Provider)?Payload|"<html|base64|\"text\"\s*:/i);
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic P1 search proof is independent from diagnostic read coverage', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-search-proof-'));
  const closedPort = await reserveClosedPort();
  const fixture = await startCoverageFixtureServer(closedPort);
  try {
    const manifest = await runWebSearchLiveDiagnostic({
      env: {
        SCIFORGE_WEB_SEARCH_PROVIDER: 'controlled-fixture-provider',
        SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL: `${fixture.baseUrl}/search`,
        SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK: '1',
      },
      out: 'manifest.json',
      workspacePath,
      now: () => new Date('2026-06-10T08:00:00.000Z'),
      timeoutMs: 500,
      readMaxChars: 600,
      readImpl: async (input) => failedRead('failed', 'read_failed', input.resourceRef ?? 'unknown', {
        networkError: `connect ECONNREFUSED 127.0.0.1:${closedPort}`,
        message: 'Static fetch failed before reading page content.',
      }),
    });
    const written = JSON.parse(await readFile(join(workspacePath, 'manifest.json'), 'utf8'));
    const validation = validateWebSearchLiveDiagnosticManifest(written);

    assert.equal(manifest.status, 'passed');
    assert.equal(written.searchProof.satisfied, true);
    assert.equal(written.searchProof.requiredQueryRuns, WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT);
    assert.equal(written.searchProof.observedQueryRuns, WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT);
    assert.equal(written.searchProof.queryRunsWithCandidates, WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT);
    assert.equal(written.searchProof.queryRunsWithTiming, WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT);
    assert.equal(written.coverage.satisfied, false);
    assert.equal(written.productProof, false);
    assert.equal(written.releaseEligible, false);
    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    const strictValidation = validateWebSearchLiveDiagnosticManifest(written, { requireCoverage: true });
    assert.equal(strictValidation.valid, false);
    assert.match(strictValidation.blockers.join('\n'), /coverage/i);
    for (const run of written.queryRuns) {
      assert.equal(run.search.status, 'completed');
      assert.ok(run.search.resultCount > 0);
      assert.match(run.search.searchResultSetRef, /^web-search:/);
      assert.ok(run.search.candidateRefs.length > 0);
      assert.equal(typeof run.search.durationMs, 'number');
    }
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic requireCoverage option fails searchProof-only live runs without mutating P1 proof', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-require-coverage-'));
  const closedPort = await reserveClosedPort();
  const fixture = await startCoverageFixtureServer(closedPort);
  try {
    const manifest = await runWebSearchLiveDiagnostic({
      env: {
        SCIFORGE_WEB_SEARCH_PROVIDER: 'controlled-fixture-provider',
        SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL: `${fixture.baseUrl}/search`,
        SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK: '1',
      },
      out: 'manifest.json',
      workspacePath,
      now: () => new Date('2026-06-10T08:00:00.000Z'),
      timeoutMs: 500,
      readMaxChars: 600,
      requireCoverage: true,
      readImpl: async (input) => failedRead('failed', 'read_failed', input.resourceRef ?? 'unknown', {
        networkError: `connect ECONNREFUSED 127.0.0.1:${closedPort}`,
        message: 'Static fetch failed before reading page content.',
      }),
    });
    const written = JSON.parse(await readFile(join(workspacePath, 'manifest.json'), 'utf8'));
    const validation = validateWebSearchLiveDiagnosticManifest(written, { requireCoverage: true });

    assert.equal(manifest.status, 'failed');
    assert.equal(written.status, 'failed');
    assert.equal(written.searchProof.satisfied, true);
    assert.equal(written.coverage.satisfied, false);
    assert.match(written.failureReason.code, /coverage/i);
    assert.equal(validation.valid, true, validation.blockers.join('\n'));
  } finally {
    await fixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('web search live diagnostic coverage probes satisfy strict coverage independently from search result ranking', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-web-search-live-diagnostic-coverage-probes-'));
  const closedPort = await reserveClosedPort();
  const searchFixture = await startSearchProofOnlyFixtureServer();
  const coverageFixture = await startCoverageFixtureServer(closedPort);
  try {
    const manifest = await runWebSearchLiveDiagnostic({
      env: {
        SCIFORGE_WEB_SEARCH_PROVIDER: 'search-proof-only-fixture',
        SCIFORGE_WEB_SEARCH_PROVIDER_BASE_URL: `${searchFixture.baseUrl}/search`,
        SCIFORGE_WEB_SEARCH_LIVE_ALLOW_PRIVATE_NETWORK: '1',
      },
      out: 'manifest.json',
      workspacePath,
      now: () => new Date('2026-06-10T08:00:00.000Z'),
      timeoutMs: 800,
      readMaxChars: 600,
      requireCoverage: true,
      coverageProbes: [
        {
          probeId: 'fixture-news',
          coverageCategory: 'news_webpage',
          url: `${coverageFixture.baseUrl}/news_webpage`,
        },
        {
          probeId: 'fixture-docs',
          coverageCategory: 'ordinary_docs_page',
          url: `${coverageFixture.baseUrl}/ordinary_docs_page`,
        },
        {
          probeId: 'fixture-js-heavy',
          coverageCategory: 'js_heavy_browser_render_required',
          url: `${coverageFixture.baseUrl}/js_heavy_browser_render_required`,
        },
        {
          probeId: 'fixture-auth',
          coverageCategory: 'auth_blocked_or_403_401_surrogate',
          url: `${coverageFixture.baseUrl}/auth_blocked_or_403_401_surrogate`,
        },
        {
          probeId: 'fixture-network',
          coverageCategory: 'network_failure',
          url: `http://127.0.0.1:${closedPort}/network-failure`,
        },
      ],
    });
    const written = JSON.parse(await readFile(join(workspacePath, 'manifest.json'), 'utf8'));
    const validation = validateWebSearchLiveDiagnosticManifest(written, { requireCoverage: true });

    assert.equal(manifest.status, 'passed');
    assert.equal(written.searchProof.satisfied, true);
    assert.equal(written.coverage.satisfied, true);
    assert.equal(written.coverageProbes.length, requiredCoverageCategories.length);
    assert.equal(validation.valid, true, validation.blockers.join('\n'));
    for (const category of requiredCoverageCategories) {
      assert.equal(written.coverage.categoryResults[category].status, 'satisfied');
      assert.ok(written.coverage.categoryResults[category].probeIds.length > 0);
      assert.match(written.coverage.categoryResults[category].refs.join(' '), /web-coverage-probe:/);
    }
    assert.equal(written.coverageProbes[2].read.browserRenderRequired, true);
    assert.equal(written.coverageProbes[3].read.httpStatus, 403);
    assert.match(written.coverageProbes[4].read.networkError, /ECONNREFUSED|fetch failed|network/i);
  } finally {
    await searchFixture.close();
    await coverageFixture.close();
    await rm(workspacePath, { recursive: true, force: true });
  }
});

function buildCoverageManifest(overrides: Partial<WebSearchLiveDiagnosticManifest> = {}): WebSearchLiveDiagnosticManifest {
  const queryRuns: CoverageQueryRun[] = overrides.queryRuns ?? buildCategorySpecificCoverageQueryRuns();
  const manifest: WebSearchLiveDiagnosticManifest = {
    schemaVersion: WEB_SEARCH_LIVE_DIAGNOSTIC_SCHEMA_VERSION,
    status: 'passed',
    diagnosticOnly: true,
    productProof: false,
    releaseEligible: false,
    checkedAt: '2026-06-10T08:00:00.000Z',
    provider: {
      configured: true,
      id: 'searxng',
      kind: 'searxng',
      baseUrl: 'http://127.0.0.1:8080/',
    },
    queryRuns,
    coverageProbes: [],
    searchProof: buildSearchProofSummary(queryRuns),
    coverage: buildCoverageSummary(queryRuns),
    timingSummary: {
      searchTotalMs: 510,
      readTotalMs: 1010,
      totalMs: 1520,
    },
    refs: [
      'web-search:1',
      'web-source:1',
      'web-text:1',
    ],
    policyScan: {
      rawLargePayloads: false,
      refsFirst: true,
    },
  };
  return { ...manifest, ...overrides } as WebSearchLiveDiagnosticManifest;
}

function buildCoverageQueryRuns(entries: Array<{
  category: CoverageCategory;
  language: string;
  read: WebSearchLiveDiagnosticQueryRun['read'];
}>): CoverageQueryRun[] {
  return entries.map((entry, index) => ({
    queryId: `q${index + 1}`,
    query: `query ${index + 1}`,
    language: entry.language,
    coverageCategory: entry.category,
    search: {
      status: 'completed',
      resultCount: 2,
      searchResultSetRef: `web-search:${index + 1}`,
      durationMs: 100 + index,
      candidateRefs: [`web-page:${index + 1}`],
    },
    read: entry.read,
  }));
}

function buildCategorySpecificCoverageQueryRuns(): CoverageQueryRun[] {
  return buildCoverageQueryRuns([
    {
      category: 'news_webpage',
      language: 'zh-CN',
      read: readSuccess(1),
    },
    {
      category: 'ordinary_docs_page',
      language: 'es',
      read: readSuccess(2),
    },
    {
      category: 'js_heavy_browser_render_required',
      language: 'ar',
      read: {
        status: 'needs_browser',
        attemptedCandidateRef: 'web-page:3',
        finalUrl: 'https://example.com/js-heavy',
        durationMs: 203,
        httpStatus: 200,
        blockedReason: 'empty_extracted_text',
        browserRenderRequired: true,
        error: 'Static HTML extraction returned no readable page text.',
      },
    },
    {
      category: 'auth_blocked_or_403_401_surrogate',
      language: 'fr',
      read: {
        status: 'blocked',
        attemptedCandidateRef: 'web-page:4',
        finalUrl: 'https://example.com/auth',
        durationMs: 204,
        httpStatus: 403,
        blockedReason: 'http_403',
        error: 'Static fetch was blocked by HTTP 403.',
      },
    },
    {
      category: 'network_failure',
      language: 'en',
      read: {
        status: 'failed',
        attemptedCandidateRef: 'web-page:5',
        finalUrl: 'http://127.0.0.1:9/network-failure',
        durationMs: 205,
        networkError: 'connect ECONNREFUSED 127.0.0.1:9',
        error: 'Static fetch failed before reading page content.',
      },
    },
  ]);
}

function readSuccess(index: number): WebSearchLiveDiagnosticQueryRun['read'] {
  return {
    status: 'read',
    attemptedCandidateRef: `web-page:${index}`,
    sourcePageRef: `web-source:${index}`,
    pageTextRef: `web-text:${index}`,
    finalUrl: `https://example.com/${index}`,
    durationMs: 200 + index,
    httpStatus: 200,
    textCharCount: 1200,
    textSha1: 'a'.repeat(40),
    preview: 'bounded page preview',
  };
}

function buildCoverageSummary(queryRuns: CoverageQueryRun[]): WebSearchLiveCoverageSummary {
  const distinctLanguages = [...new Set(queryRuns.map((run) => String(run.language)).filter(Boolean))];
  const multilingualSatisfied = queryRuns.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT && distinctLanguages.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT;
  return {
    requiredCategories: [...requiredCoverageCategories],
    observedCategories: [...requiredCoverageCategories],
    missingCategories: [],
    categoryResults: Object.fromEntries(requiredCoverageCategories.map((category) => [
      category,
      {
        status: 'satisfied',
        queryRunIds: queryRuns
          .filter((run) => run.coverageCategory === category)
          .map((run) => String(run.queryId)),
        refs: [`web-search:${requiredCoverageCategories.indexOf(category) + 1}`],
      },
    ])) as WebSearchLiveCoverageSummary['categoryResults'],
    multilingual: {
      requiredQueryRuns: WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT,
      observedQueryRuns: queryRuns.length,
      distinctLanguages,
      satisfied: multilingualSatisfied,
    },
    satisfied: multilingualSatisfied,
  };
}

function buildSearchProofSummary(queryRuns: CoverageQueryRun[]): WebSearchLiveDiagnosticManifest['searchProof'] {
  const distinctLanguages = [...new Set(queryRuns.map((run) => String(run.language)).filter(Boolean))];
  return {
    requiredQueryRuns: WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT,
    observedQueryRuns: queryRuns.length,
    queryRunsWithCandidates: queryRuns.filter((run) => run.search.status === 'completed'
      && run.search.resultCount > 0
      && Boolean(run.search.searchResultSetRef)
      && run.search.candidateRefs.length > 0).length,
    queryRunsWithTiming: queryRuns.filter((run) => Number.isFinite(run.search.durationMs) && run.search.durationMs >= 0).length,
    distinctLanguages,
    satisfied: queryRuns.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
      && distinctLanguages.length >= WEB_SEARCH_LIVE_DIAGNOSTIC_QUERY_COUNT
      && queryRuns.every((run) => run.search.status === 'completed'
        && run.search.resultCount > 0
        && Boolean(run.search.searchResultSetRef)
        && run.search.candidateRefs.length > 0
        && Number.isFinite(run.search.durationMs)
        && run.search.durationMs >= 0),
  };
}

async function fakeControlledRead(input: WebReadStaticInput, networkFailurePort: number): Promise<WebReadResult> {
  const resource = input.resourceRefs?.find((candidate) => candidate.ref === input.resourceRef);
  const url = resource?.locator?.url ?? resource?.url ?? '';
  if (url.includes('news_webpage') || url.includes('ordinary_docs_page')) {
    const text = url.includes('news_webpage')
      ? 'A current multilingual science news report with enough body text for static extraction.'
      : 'This ordinary documentation page explains stable API usage with durable source text.';
    const sourcePageRef = `web-source:${input.resourceRef ?? 'controlled'}`;
    const pageTextRef = `web-text:${input.resourceRef ?? 'controlled'}`;
    return {
      ok: true,
      status: 'read',
      tool: 'web_read',
      provider: 'static-fetch',
      data: {
        requestedUrl: url,
        requestedResourceRef: input.resourceRef,
        finalUrl: url,
        contentType: 'text/html; charset=utf-8',
        openedAt: input.openedAt ?? '2026-06-10T08:00:00.000Z',
        text,
        textPreview: text,
        textCharCount: text.length,
        textSha1: 'b'.repeat(40),
        sourcePageRef,
        pageTextRef,
      },
      refs: {
        sourcePageRef,
        pageTextRef,
      },
      timings: { totalMs: 1, cache: 'miss', cachePolicy: 'default' },
      diagnostics: {
        requestedUrl: url,
        finalUrl: url,
        httpStatus: 200,
      },
      warnings: [],
    } satisfies WebReadResult;
  }
  if (url.includes('js_heavy_browser_render_required')) {
    return failedRead('blocked', 'extract_failed', url, {
      httpStatus: 200,
      blockedReason: 'empty_extracted_text',
      message: 'Static HTML extraction returned no readable page text.',
    });
  }
  if (url.includes('auth_blocked_or_403_401_surrogate')) {
    return failedRead('blocked', 'read_failed', url, {
      httpStatus: 403,
      blockedReason: 'http_403',
      message: 'Static fetch was blocked by HTTP 403.',
    });
  }
  return failedRead('failed', 'read_failed', url || `http://127.0.0.1:${networkFailurePort}/network-failure`, {
    networkError: `connect ECONNREFUSED 127.0.0.1:${networkFailurePort}`,
    message: 'Static fetch failed before reading page content.',
  });
}

function failedRead(status: Exclude<WebReadStatus, 'read' | 'partial'>, code: WebReadErrorCode, url: string, options: {
  httpStatus?: number;
  blockedReason?: string;
  networkError?: string;
  message: string;
}): WebReadResult {
  return {
    ok: false,
    status,
    tool: 'web_read',
    provider: 'static-fetch',
    refs: {},
    timings: { totalMs: 1, cache: 'miss', cachePolicy: 'default' },
    diagnostics: {
      requestedUrl: url,
      finalUrl: url,
      ...(options.httpStatus ? { httpStatus: options.httpStatus } : {}),
      ...(options.blockedReason ? { blockedReason: options.blockedReason } : {}),
      ...(options.networkError ? { networkError: options.networkError } : {}),
    },
    warnings: [],
    error: {
      code,
      message: options.message,
    },
  } satisfies WebReadResult;
}

async function startCoverageFixtureServer(networkFailurePort: number): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let searchHit = 0;
  let baseUrl = '';
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/search')) {
      const category = requiredCoverageCategories[searchHit++] ?? requiredCoverageCategories.at(-1)!;
      const url = category === 'network_failure'
        ? `http://127.0.0.1:${networkFailurePort}/network-failure`
        : `${baseUrl}/${category}`;
      writeJson(res, {
        results: [{
          title: `${category} fixture`,
          url,
          snippet: `Controlled fixture candidate for ${category}.`,
          source: 'controlled-fixture',
        }],
      });
      return;
    }
    if (req.url === '/news_webpage') {
      writeHtml(res, 200, '<article><h1>Current Research News</h1><p>A current multilingual science news report with enough body text for static extraction.</p><p>The fixture is diagnostic-only and never product proof.</p></article>');
      return;
    }
    if (req.url === '/ordinary_docs_page') {
      writeHtml(res, 200, '<main><h1>Ordinary Documentation Page</h1><p>This documentation page explains stable API usage with durable source text.</p><p>It is a plain HTML docs page for the controlled diagnostic fixture.</p></main>');
      return;
    }
    if (req.url === '/js_heavy_browser_render_required') {
      writeHtml(res, 200, '<html><head><script>window.__body="rendered later"</script></head><body><div id="root"></div><script>document.getElementById("root").textContent=window.__body</script></body></html>');
      return;
    }
    if (req.url === '/auth_blocked_or_403_401_surrogate') {
      writeHtml(res, 403, '<html><body>Forbidden login required</body></html>');
      return;
    }
    writeHtml(res, 404, '<main>not found</main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => closeServer(server),
  };
}

async function reserveClosedPort(): Promise<number> {
  const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  const port = address.port;
  await closeServer(server);
  return port;
}

async function startSearchProofOnlyFixtureServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  let baseUrl = '';
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/search')) {
      writeJson(res, {
        results: [{
          title: 'Search proof only fixture',
          url: `${baseUrl}/plain`,
          snippet: 'Candidate proves search transport but not required live coverage categories.',
          source: 'search-proof-only-fixture',
        }],
      });
      return;
    }
    if (req.url === '/plain') {
      writeHtml(res, 200, '<main><h1>Plain Fixture Page</h1><p>This readable fixture page gives searchProof candidates and timing while intentionally avoiding JS-heavy, auth-blocked, and network-failure live coverage.</p><p>It is not a product proof and should only satisfy the P1 search path.</p></main>');
      return;
    }
    writeHtml(res, 404, '<main>not found</main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    close: () => closeServer(server),
  };
}

async function startSearxngRequestCaptureFixtureServer(): Promise<{
  baseUrl: string;
  requests: Array<{
    pathname: string;
    searchParams: Record<string, string>;
    headers: Record<string, string>;
  }>;
  close: () => Promise<void>;
}> {
  const requests: Array<{
    pathname: string;
    searchParams: Record<string, string>;
    headers: Record<string, string>;
  }> = [];
  let baseUrl = '';
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', baseUrl || 'http://127.0.0.1');
    if (url.pathname === '/search') {
      requests.push({
        pathname: url.pathname,
        searchParams: Object.fromEntries(url.searchParams.entries()),
        headers: Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [
          key,
          Array.isArray(value) ? value.join(',') : String(value ?? ''),
        ])),
      });
      writeJson(res, {
        results: [{
          title: `SearXNG fixture ${requests.length}`,
          url: `${baseUrl}/candidate-${requests.length}`,
          content: 'Candidate from configured SearXNG fixture.',
          engine: 'openalex',
        }],
      });
      return;
    }
    writeHtml(res, 404, '<main>not found</main>');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    requests,
    close: () => closeServer(server),
  };
}

async function spawnNodeCli(args: string[], options: {
  cwd: string;
  env: Record<string, string | undefined>;
}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const timeout = setTimeout(() => {
    child.kill('SIGKILL');
  }, 15_000);
  return await new Promise((resolve, reject) => {
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (status) => {
      clearTimeout(timeout);
      resolve({ status, stdout, stderr });
    });
  });
}

function writeJson(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

function writeHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html>${html}`);
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  });
}
