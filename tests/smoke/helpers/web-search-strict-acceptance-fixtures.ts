import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

export const WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION = 'sciforge.web-search.strict-acceptance.v1';
export const WEB_SEARCH_SOURCE_PAGE_SCHEMA_VERSION = 'sciforge.web-search.source-page.v1';

export const WEB_SEARCH_STRICT_TIMING_PHASES = [
  'planning',
  'searchProvider',
  'parse',
  'readFetch',
  'render',
  'extract',
  'persist',
  'finalSynthesis',
] as const;

export const WEB_SEARCH_STRICT_NEGATIVE_FIXTURE_IDS = [
  'search-only',
  'read-blocked',
  'low-info-page',
  'topic-mismatch',
  'stale-refs',
  'historical-manifest',
  'fixture-product-proof',
  'gui-projection',
  'screenshot-replay',
] as const;

type WebSearchStrictTimingPhase = typeof WEB_SEARCH_STRICT_TIMING_PHASES[number];
type WebSearchStrictNegativeFixtureId = typeof WEB_SEARCH_STRICT_NEGATIVE_FIXTURE_IDS[number];
type WebSearchStrictStatus = 'passed' | 'blocked' | 'failed' | 'partial';
type WebSearchToolName = 'web_search' | 'web_read';
type WebSearchToolPath = 'direct' | 'module-dispatcher';
type ProofLevel = 'unit proof' | 'local diagnostic' | 'live diagnostic' | 'product proof';
type SourceReadStatus = 'read' | 'blocked' | 'low-info' | 'topic-mismatch';

export type WebSearchLocalFixtureCaseId = 'search-read-success' | 'read-blocked';

export type WebSearchLocalFixtureServer = {
  baseUrl: string;
  urls: {
    success: string;
    blocked: string;
    lowInfo: string;
    mismatch: string;
  };
};

export type WebSearchStrictAcceptanceManifest = {
  schemaVersion: typeof WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION;
  status: WebSearchStrictStatus;
  proofLevel: ProofLevel;
  diagnosticOnly: boolean;
  liveDiagnostic: boolean;
  productProof: boolean;
  releaseEligible: boolean;
  observedAt: string;
  provider: {
    id: string;
    kind: 'local-fixture' | 'configured-provider' | 'live-provider';
    configured: boolean;
    fixture: boolean;
  };
  currentRun: {
    runId: string;
    entrypoint: 'local-fixture-suite' | 'desktop-default-chat' | 'live-diagnostic-script';
    route: {
      provider: 'native' | 'fallback' | 'unknown';
      evidence: 'search-only' | 'search-read';
    };
    refs: string[];
    toolTrace: WebSearchToolTraceEntry[];
    search: WebSearchSearchEvidence;
    sourcePages: WebSearchSourcePageEvidence[];
    directDispatcherConsistency: WebSearchDirectDispatcherConsistency;
  };
  finalAnswer: {
    text: string;
    sourceLinks: string[];
    supportingRefs: string[];
    snippetOnly: boolean;
    uiVisible: boolean;
  };
  timingReport: Partial<Record<WebSearchStrictTimingPhase, WebSearchTimingPhaseReport>>;
  strictGates: {
    searchOnlyAnswer: boolean;
    snippetOnlyAnswer: boolean;
    historicalManifest: boolean;
    staleRefs: boolean;
    fixtureRefsInProductProof: boolean;
    guiProjectionUsed: boolean;
    screenshotReplayUsed: boolean;
  };
  failureReason?: {
    code: string;
    message: string;
  };
  recoverActions?: Array<{
    label: string;
    command?: string;
    userVisible: boolean;
  }>;
  evidence?: {
    screenshotPath?: string;
  };
};

type WebSearchToolTraceEntry = {
  toolName: WebSearchToolName;
  path: WebSearchToolPath;
  status: 'completed' | 'blocked' | 'failed';
  startedAt: string;
  completedAt: string;
  refs: string[];
};

type WebSearchSearchEvidence = {
  query: string;
  searchResultRef: string;
  providerResultCount: number;
  resultRefs: string[];
  sourceLinks: string[];
  topicRelevance: {
    matched: boolean;
    matchedTerms: string[];
  };
};

type WebSearchSourcePageEvidence = {
  pageRef: string;
  sourcePageJsonRef: string;
  sourcePageJsonPath?: string;
  pageTextRef?: string;
  pageTextPath?: string;
  textSha1?: string;
  textChars: number;
  openedAt: string;
  finalUrl: string;
  httpStatus: number;
  readStatus: SourceReadStatus;
  informationQuality: 'high' | 'low';
  topicMatch: boolean;
  blockedReason?: string;
};

type WebSearchDirectDispatcherConsistency = {
  direct: WebSearchPipelineSummary;
  dispatcher: WebSearchPipelineSummary;
  consistent: boolean;
};

type WebSearchPipelineSummary = {
  searchResultRef: string;
  finalUrl?: string;
  pageTextSha1?: string;
  readStatus: 'read' | 'blocked' | 'skipped';
};

type WebSearchTimingPhaseReport = {
  status: 'completed' | 'blocked' | 'skipped';
  startedAt: string;
  completedAt: string;
  durationMs: number;
};

type WebSearchValidationOptions = {
  artifactRoot?: string;
  now?: Date;
  maxAgeMs?: number;
  requireProductProof?: boolean;
};

type WebSearchValidationResult = {
  valid: boolean;
  productProof: boolean;
  releaseEligible: boolean;
  blockers: string[];
  timingReportShapeValid: boolean;
  directDispatcherConsistent: boolean;
};

type RunWebSearchLocalFixtureOptions = {
  artifactDir: string;
  caseId?: WebSearchLocalFixtureCaseId;
  now?: () => Date;
  runId?: string;
};

type BuildNegativeFixtureOptions = {
  artifactDir: string;
  now?: () => Date;
  runId?: string;
};

type FakeSearchResult = {
  title: string;
  url: string;
  snippet: string;
  ref: string;
};

type FakeSearchOutput = {
  query: string;
  searchResultRef: string;
  results: FakeSearchResult[];
};

type FakeReadOutput = {
  status: 'read' | 'blocked';
  finalUrl: string;
  httpStatus: number;
  text: string;
  blockedReason?: string;
};

export async function withWebSearchLocalFixtureServer<T>(
  run: (fixtureServer: WebSearchLocalFixtureServer) => Promise<T>,
): Promise<T> {
  const server = createServer(handleFixtureRequest);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await run({
      baseUrl,
      urls: {
        success: `${baseUrl}/success`,
        blocked: `${baseUrl}/blocked`,
        lowInfo: `${baseUrl}/low-info`,
        mismatch: `${baseUrl}/mismatch`,
      },
    });
  } finally {
    await closeServer(server);
  }
}

export async function runWebSearchLocalFixtureSuite(
  fixtureServer: WebSearchLocalFixtureServer,
  options: RunWebSearchLocalFixtureOptions,
): Promise<WebSearchStrictAcceptanceManifest> {
  const caseId = options.caseId ?? 'search-read-success';
  const runId = options.runId ?? `web-search-local-${Date.now()}`;
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const query = 'SciForge P5 strict web search current source';
  const targetUrl = caseId === 'read-blocked' ? fixtureServer.urls.blocked : fixtureServer.urls.success;
  const searchRef = `web-search:${runId}/search-results.json`;
  const pageRef = `web-page:${runId}/source-1`;

  const directSearch = fakeWebSearch({ query, targetUrl, runId, path: 'direct' });
  const dispatcherSearch = await dispatchFixtureTool('web_search', { query, targetUrl, runId }) as FakeSearchOutput;
  const directRead = await fakeWebRead(directSearch.results[0]?.url ?? targetUrl);
  const dispatcherRead = await dispatchFixtureTool('web_read', { url: dispatcherSearch.results[0]?.url ?? targetUrl }) as FakeReadOutput;
  const directDispatcherConsistency = summarizeDirectDispatcher(directSearch, directRead, dispatcherSearch, dispatcherRead);
  const timingReport = buildTimingReport(observedAt, directRead.status === 'blocked' ? 'blocked' : 'completed');

  if (directRead.status === 'blocked') {
    const blockedPage = await writeBlockedSourcePage({
      artifactDir: options.artifactDir,
      runId,
      index: 1,
      pageRef,
      finalUrl: directRead.finalUrl,
      httpStatus: directRead.httpStatus,
      openedAt: observedAt,
      blockedReason: directRead.blockedReason ?? 'read_failed',
    });
    return {
      schemaVersion: WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION,
      status: 'blocked',
      proofLevel: 'local diagnostic',
      diagnosticOnly: true,
      liveDiagnostic: false,
      productProof: false,
      releaseEligible: false,
      observedAt,
      provider: localFixtureProvider(),
      currentRun: {
        runId,
        entrypoint: 'local-fixture-suite',
        route: {
          provider: 'fallback',
          evidence: 'search-read',
        },
        refs: [searchRef, pageRef, blockedPage.sourcePageJsonRef],
        toolTrace: [
          toolTraceEntry('web_search', 'direct', 'completed', observedAt, [searchRef]),
          toolTraceEntry('web_read', 'direct', 'blocked', observedAt, [pageRef, blockedPage.sourcePageJsonRef]),
        ],
        search: strictSearchEvidence(query, searchRef, directSearch.results),
        sourcePages: [blockedPage],
        directDispatcherConsistency,
      },
      finalAnswer: {
        text: '',
        sourceLinks: [],
        supportingRefs: [searchRef, pageRef],
        snippetOnly: false,
        uiVisible: false,
      },
      timingReport,
      strictGates: strictGateDefaults(),
      failureReason: {
        code: 'read_failed_needs_user_browser',
        message: 'The local blocked fixture returned a blocked read and must not synthesize a source-backed answer.',
      },
      recoverActions: [
        {
          label: 'Open the page in a user-owned browser session or choose another readable source.',
          userVisible: true,
        },
      ],
    };
  }

  const source = await writeReadSourcePage({
    artifactDir: options.artifactDir,
    runId,
    index: 1,
    pageRef,
    finalUrl: directRead.finalUrl,
    httpStatus: directRead.httpStatus,
    openedAt: observedAt,
    text: directRead.text,
    informationQuality: 'high',
    topicMatch: true,
  });
  return {
    schemaVersion: WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'passed',
    proofLevel: 'local diagnostic',
    diagnosticOnly: true,
    liveDiagnostic: false,
    productProof: false,
    releaseEligible: false,
    observedAt,
    provider: localFixtureProvider(),
    currentRun: {
      runId,
      entrypoint: 'local-fixture-suite',
      route: {
        provider: 'fallback',
        evidence: 'search-read',
      },
      refs: [searchRef, pageRef, source.sourcePageJsonRef, source.pageTextRef ?? ''],
      toolTrace: [
        toolTraceEntry('web_search', 'direct', 'completed', observedAt, [searchRef]),
        toolTraceEntry('web_read', 'direct', 'completed', observedAt, [pageRef, source.sourcePageJsonRef, source.pageTextRef ?? '']),
      ],
      search: strictSearchEvidence(query, searchRef, directSearch.results),
      sourcePages: [source],
      directDispatcherConsistency,
    },
    finalAnswer: {
      text: `Local diagnostic answer is grounded in a current web_read source: ${source.finalUrl}`,
      sourceLinks: [source.finalUrl],
      supportingRefs: [source.sourcePageJsonRef, source.pageTextRef ?? ''],
      snippetOnly: false,
      uiVisible: true,
    },
    timingReport,
    strictGates: strictGateDefaults(),
  };
}

export async function buildWebSearchStrictNegativeFixture(
  caseId: WebSearchStrictNegativeFixtureId,
  options: BuildNegativeFixtureOptions,
): Promise<WebSearchStrictAcceptanceManifest> {
  const runId = options.runId ?? `web-search-negative-${caseId}`;
  const manifest = await buildPassingProductProofFixture({
    artifactDir: options.artifactDir,
    now: options.now,
    runId,
  });
  const source = manifest.currentRun.sourcePages[0];
  switch (caseId) {
    case 'search-only':
      makeStrictSearchOnlyNegative(manifest);
      manifest.finalAnswer = {
        text: 'Snippet-only answer copied from search results.',
        sourceLinks: [],
        supportingRefs: [manifest.currentRun.search.searchResultRef],
        snippetOnly: true,
        uiVisible: true,
      };
      manifest.strictGates.searchOnlyAnswer = true;
      manifest.strictGates.snippetOnlyAnswer = true;
      break;
    case 'read-blocked':
      if (source) {
        source.readStatus = 'blocked';
        source.blockedReason = 'http_403';
        source.httpStatus = 403;
      }
      break;
    case 'low-info-page':
      if (source) {
        source.readStatus = 'low-info';
        source.informationQuality = 'low';
        source.textChars = 24;
      }
      break;
    case 'topic-mismatch':
      if (source) {
        source.readStatus = 'topic-mismatch';
        source.topicMatch = false;
      }
      break;
    case 'stale-refs':
      makeStrictSearchOnlyNegative(manifest);
      rewriteStrictRefs(manifest, runId, 'web-search-previous-run');
      manifest.strictGates.staleRefs = true;
      break;
    case 'historical-manifest':
      manifest.observedAt = '2020-01-01T00:00:00.000Z';
      if (source) source.openedAt = '2020-01-01T00:00:00.000Z';
      manifest.strictGates.historicalManifest = true;
      break;
    case 'fixture-product-proof':
      makeStrictSearchOnlyNegative(manifest);
      manifest.provider = localFixtureProvider();
      manifest.currentRun.refs.push('fixture:web-search/local-pass');
      manifest.finalAnswer.supportingRefs.push('fixture:web-text/local-pass');
      manifest.strictGates.fixtureRefsInProductProof = true;
      break;
    case 'gui-projection':
      makeStrictSearchOnlyNegative(manifest);
      manifest.finalAnswer.supportingRefs = [`gui.present:final-answer/${runId}`];
      manifest.currentRun.refs.push(`gui.present:final-answer/${runId}`);
      manifest.strictGates.guiProjectionUsed = true;
      break;
    case 'screenshot-replay':
      makeStrictSearchOnlyNegative(manifest);
      manifest.currentRun.sourcePages = [];
      manifest.currentRun.refs.push(`screenshot:${runId}/replay.png`);
      manifest.finalAnswer.supportingRefs = [`screenshot:${runId}/replay.png`];
      manifest.evidence = { screenshotPath: 'screenshots/replay.png' };
      manifest.strictGates.screenshotReplayUsed = true;
      break;
  }
  return manifest;
}

export async function validateWebSearchStrictAcceptanceManifest(
  manifest: WebSearchStrictAcceptanceManifest,
  options: WebSearchValidationOptions = {},
): Promise<WebSearchValidationResult> {
  const blockers: string[] = [];
  const productBlockers: string[] = [];
  const now = options.now ?? new Date();
  const maxAgeMs = options.maxAgeMs ?? 30 * 60 * 1000;

  if (manifest.schemaVersion !== WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION) {
    blockers.push('schemaVersion must be sciforge.web-search.strict-acceptance.v1');
  }
  if (!['passed', 'blocked', 'failed', 'partial'].includes(manifest.status)) {
    blockers.push('status must be passed, blocked, failed, or partial');
  }

  const timingReportShapeValid = validateTimingReport(manifest, blockers);
  const directDispatcherConsistent = validateDirectDispatcherConsistency(manifest, blockers);

  if (manifest.status === 'passed') {
    await validatePassedProtocol(manifest, blockers, options, now, maxAgeMs);
  } else {
    validateBlockedOrPartial(manifest, blockers);
  }

  if (options.requireProductProof || manifest.proofLevel === 'product proof' || manifest.productProof) {
    validateProductProof(manifest, productBlockers);
  }

  blockers.push(...productBlockers);
  const productProof = manifest.status === 'passed'
    && manifest.proofLevel === 'product proof'
    && manifest.productProof === true
    && manifest.diagnosticOnly === false
    && manifest.releaseEligible === true
    && blockers.length === 0
    && productBlockers.length === 0;
  if (options.requireProductProof && !productProof) {
    blockers.push('product proof required but not satisfied by current web_search/web_read evidence');
  }

  return {
    valid: blockers.length === 0,
    productProof,
    releaseEligible: productProof,
    blockers,
    timingReportShapeValid,
    directDispatcherConsistent,
  };
}

export async function buildWebSearchStrictOrdinarySearchOnlyProductProofFixture(
  options: BuildNegativeFixtureOptions,
): Promise<WebSearchStrictAcceptanceManifest> {
  const runId = options.runId ?? 'web-search-product-search-only-current';
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const query = 'Iran situation latest five current sources';
  const searchRef = `web-search:${runId}/search-results.json`;
  const results: FakeSearchResult[] = Array.from({ length: 5 }, (_, index) => ({
    title: `Iran situation current source ${index + 1}`,
    url: `https://news.example.test/iran-situation-${index + 1}`,
    snippet: `Current-run source ${index + 1} for ordinary Iran situation search.`,
    ref: `web-page:${runId}/source-${index + 1}`,
  }));
  return {
    schemaVersion: WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'passed',
    proofLevel: 'product proof',
    diagnosticOnly: false,
    liveDiagnostic: false,
    productProof: true,
    releaseEligible: true,
    observedAt,
    provider: {
      id: 'codex-native.web_search',
      kind: 'live-provider',
      configured: true,
      fixture: false,
    },
    currentRun: {
      runId,
      entrypoint: 'desktop-default-chat',
      route: {
        provider: 'native',
        evidence: 'search-only',
      },
      refs: [searchRef, ...results.map((result) => result.ref)],
      toolTrace: [
        toolTraceEntry('web_search', 'module-dispatcher', 'completed', observedAt, [searchRef, ...results.map((result) => result.ref)]),
      ],
      search: strictSearchEvidence(query, searchRef, results),
      sourcePages: [],
      directDispatcherConsistency: {
        direct: {
          searchResultRef: searchRef,
          finalUrl: results[0]?.url,
          readStatus: 'skipped',
        },
        dispatcher: {
          searchResultRef: searchRef,
          finalUrl: results[0]?.url,
          readStatus: 'skipped',
        },
        consistent: true,
      },
    },
    finalAnswer: {
      text: [
        'The ordinary search answer is grounded in current web_search source links.',
        ...results.map((result, index) => `Source ${index + 1}: ${result.url}`),
      ].join('\n'),
      sourceLinks: results.map((result) => result.url),
      supportingRefs: [searchRef, ...results.map((result) => result.ref)],
      snippetOnly: false,
      uiVisible: true,
    },
    timingReport: buildTimingReport(observedAt, 'completed'),
    strictGates: strictGateDefaults(),
  };
}

async function buildPassingProductProofFixture(options: BuildNegativeFixtureOptions): Promise<WebSearchStrictAcceptanceManifest> {
  const runId = options.runId ?? 'web-search-product-current';
  const observedAt = (options.now?.() ?? new Date()).toISOString();
  const query = 'SciForge P5 strict web search product proof';
  const searchRef = `web-search:${runId}/search-results.json`;
  const pageRef = `web-page:${runId}/source-1`;
  const finalUrl = 'https://docs.example.test/sciforge-web-search-p5';
  const searchResults: FakeSearchResult[] = [{
    title: 'SciForge P5 strict web search product proof',
    url: finalUrl,
    snippet: 'Current-run source for strict web search product proof.',
    ref: pageRef,
  }];
  const text = [
    'SciForge P5 strict web search product proof requires a current web_search then web_read chain.',
    'The final answer cites the actual read source page JSON and text artifact instead of snippets.',
    'This source includes enough topic-specific detail for a high-information, matching page.',
  ].join('\n');
  const source = await writeReadSourcePage({
    artifactDir: options.artifactDir,
    runId,
    index: 1,
    pageRef,
    finalUrl,
    httpStatus: 200,
    openedAt: observedAt,
    text,
    informationQuality: 'high',
    topicMatch: true,
  });
  return {
    schemaVersion: WEB_SEARCH_STRICT_ACCEPTANCE_SCHEMA_VERSION,
    status: 'passed',
    proofLevel: 'product proof',
    diagnosticOnly: false,
    liveDiagnostic: false,
    productProof: true,
    releaseEligible: true,
    observedAt,
    provider: {
      id: 'sciforge.web-worker.web_search',
      kind: 'configured-provider',
      configured: true,
      fixture: false,
    },
    currentRun: {
      runId,
      entrypoint: 'desktop-default-chat',
      route: {
        provider: 'fallback',
        evidence: 'search-read',
      },
      refs: [searchRef, pageRef, source.sourcePageJsonRef, source.pageTextRef ?? ''],
      toolTrace: [
        toolTraceEntry('web_search', 'module-dispatcher', 'completed', observedAt, [searchRef]),
        toolTraceEntry('web_read', 'module-dispatcher', 'completed', observedAt, [pageRef, source.sourcePageJsonRef, source.pageTextRef ?? '']),
      ],
      search: strictSearchEvidence(query, searchRef, searchResults),
      sourcePages: [source],
      directDispatcherConsistency: {
        direct: {
          searchResultRef: searchRef,
          finalUrl,
          pageTextSha1: source.textSha1,
          readStatus: 'read',
        },
        dispatcher: {
          searchResultRef: searchRef,
          finalUrl,
          pageTextSha1: source.textSha1,
          readStatus: 'read',
        },
        consistent: true,
      },
    },
    finalAnswer: {
      text: `The current source confirms the P5 chain requirements. Source: ${finalUrl}`,
      sourceLinks: [finalUrl],
      supportingRefs: [source.sourcePageJsonRef, source.pageTextRef ?? ''],
      snippetOnly: false,
      uiVisible: true,
    },
    timingReport: buildTimingReport(observedAt, 'completed'),
    strictGates: strictGateDefaults(),
  };
}

async function validatePassedProtocol(
  manifest: WebSearchStrictAcceptanceManifest,
  blockers: string[],
  options: WebSearchValidationOptions,
  now: Date,
  maxAgeMs: number,
): Promise<void> {
  const traceNames = manifest.currentRun.toolTrace.map((entry) => entry.toolName);
  const route = manifest.currentRun.route;
  if (!traceNames.includes('web_search')) {
    blockers.push('passed manifest must include a current web_search call');
  }
  if (route.provider !== 'native' && route.provider !== 'fallback') {
    blockers.push('passed manifest must record native or fallback web_search route');
  }
  if (route.evidence !== 'search-only' && route.evidence !== 'search-read') {
    blockers.push('passed manifest must record search-only or search-read evidence route');
  }
  if (route.evidence === 'search-read' && !traceNames.includes('web_read')) {
    blockers.push('search-read passed manifest must include a current web_read call');
  }
  if (manifest.finalAnswer.snippetOnly || manifest.strictGates.snippetOnlyAnswer || manifest.strictGates.searchOnlyAnswer) {
    blockers.push('snippet-only search answers cannot pass strict web_search acceptance');
  }
  if (manifest.finalAnswer.uiVisible !== true) {
    blockers.push('passed manifest must record a UI-visible final answer');
  }
  if (manifest.currentRun.search.providerResultCount !== manifest.currentRun.search.resultRefs.length) {
    blockers.push('web_search providerResultCount must match current-run result refs');
  }
  if (manifest.currentRun.search.topicRelevance.matched !== true || manifest.currentRun.search.topicRelevance.matchedTerms.length === 0) {
    blockers.push('web_search topic relevance must match current-run source results');
  }
  validateFreshObservedAt(manifest, blockers, now, maxAgeMs);
  validateCurrentRunRefs(manifest, blockers);
  validateForbiddenEvidence(manifest, blockers);

  if (route.evidence === 'search-only') {
    validateSearchOnlyProductProof(manifest, blockers);
    return;
  }

  if (manifest.currentRun.sourcePages.length === 0) {
    blockers.push('search-read passed manifest must include source page JSON and page text evidence; screenshot replay cannot pass');
    return;
  }

  for (const source of manifest.currentRun.sourcePages) {
    if (source.readStatus !== 'read') {
      blockers.push(`source ${source.pageRef} read status is ${source.readStatus}; read blocked/read failed pages cannot pass`);
    }
    if (source.informationQuality === 'low') {
      blockers.push(`source ${source.pageRef} has low information content`);
    }
    if (source.topicMatch !== true) {
      blockers.push(`source ${source.pageRef} has a topic mismatch`);
    }
    if (!source.finalUrl || !/^https?:\/\//.test(source.finalUrl)) {
      blockers.push(`source ${source.pageRef} must include finalUrl`);
    }
    if (!source.openedAt || !Number.isFinite(Date.parse(source.openedAt))) {
      blockers.push(`source ${source.pageRef} must include openedAt`);
    }
    if (!source.sourcePageJsonRef.startsWith(`web-source:${manifest.currentRun.runId}/`)) {
      blockers.push(`source ${source.pageRef} source JSON ref must belong to the current run`);
    }
    if (!source.pageTextRef?.startsWith(`web-text:${manifest.currentRun.runId}/`)) {
      blockers.push(`source ${source.pageRef} page text ref must belong to the current run`);
    }
    if (!source.textSha1 || !/^[a-f0-9]{40}$/.test(source.textSha1)) {
      blockers.push(`source ${source.pageRef} must include textSha1`);
    }
    if (!manifest.finalAnswer.sourceLinks.includes(source.finalUrl)) {
      blockers.push(`final answer must include source link ${source.finalUrl}`);
    }
    if (!manifest.finalAnswer.supportingRefs.includes(source.sourcePageJsonRef)) {
      blockers.push(`final answer must cite source page JSON ref ${source.sourcePageJsonRef}`);
    }
    if (source.pageTextRef && !manifest.finalAnswer.supportingRefs.includes(source.pageTextRef)) {
      blockers.push(`final answer must cite page text ref ${source.pageTextRef}`);
    }
    if (options.artifactRoot) {
      await validateSourceArtifacts(source, options.artifactRoot, blockers);
    }
  }
}

function validateSearchOnlyProductProof(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): void {
  if (manifest.currentRun.sourcePages.length !== 0) {
    blockers.push('search-only product proof must not claim web_read source page artifacts');
  }
  const searchRef = manifest.currentRun.search.searchResultRef;
  if (!manifest.finalAnswer.supportingRefs.includes(searchRef)) {
    blockers.push('search-only final answer must cite the current-run web_search result ref');
  }
  const sourceLinks = new Set(manifest.finalAnswer.sourceLinks);
  if (sourceLinks.size === 0) {
    blockers.push('search-only product proof requires current-run web_search source links');
  }
  for (const link of sourceLinks) {
    if (!manifest.finalAnswer.text.includes(link)) {
      blockers.push(`search-only final answer text must visibly include source link ${link}`);
    }
  }
  for (const ref of manifest.currentRun.search.resultRefs) {
    if (!manifest.currentRun.refs.includes(ref)) {
      blockers.push(`currentRun.refs must include search-only source ref ${ref}`);
    }
  }
  const linkedResultRefs = manifest.currentRun.search.resultRefs.filter((ref, index) => {
    const link = manifest.currentRun.search.sourceLinks[index];
    return Boolean(link && sourceLinks.has(link));
  });
  if (linkedResultRefs.length === 0) {
    blockers.push('search-only product proof requires source links from current-run web_search results');
  }
  for (const ref of linkedResultRefs) {
    if (!manifest.finalAnswer.supportingRefs.includes(ref)) {
      blockers.push(`search-only final answer must cite current-run source ref ${ref}`);
    }
  }
}

function validateBlockedOrPartial(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): void {
  if (!manifest.currentRun.runId) {
    blockers.push('blocked/partial manifest must retain a current run id');
  }
  if (!manifest.currentRun.refs.some((ref) => ref.startsWith(`web-search:${manifest.currentRun.runId}/`))) {
    blockers.push('blocked/partial manifest must retain current-run web_search refs');
  }
  if (!manifest.failureReason?.code || !manifest.failureReason.message) {
    blockers.push('blocked/partial manifest must include a failure reason');
  }
  if (!(manifest.recoverActions ?? []).some((action) => action.userVisible)) {
    blockers.push('blocked/partial manifest must include a user-visible recovery path');
  }
  if (manifest.productProof || manifest.releaseEligible) {
    blockers.push('blocked/partial manifest cannot claim product proof or release eligibility');
  }
}

function validateProductProof(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): void {
  if (manifest.proofLevel !== 'product proof' || manifest.productProof !== true) {
    blockers.push('product proof requires proofLevel=product proof and productProof=true');
  }
  if (manifest.diagnosticOnly !== false || manifest.releaseEligible !== true) {
    blockers.push('product proof must not be diagnostic-only and must be release eligible');
  }
  if (manifest.currentRun.entrypoint !== 'desktop-default-chat') {
    blockers.push('product proof must come from the desktop default chat entrypoint');
  }
  if (manifest.currentRun.route.provider !== 'native' && manifest.currentRun.route.provider !== 'fallback') {
    blockers.push('product proof must record native or fallback web_search route');
  }
  if (manifest.finalAnswer.uiVisible !== true) {
    blockers.push('product proof must include a UI-visible final answer');
  }
  if (manifest.provider.fixture || manifest.provider.kind === 'local-fixture' || manifest.provider.id.includes('fixture')) {
    blockers.push('fixture provider evidence cannot satisfy product proof');
  }
  const allRefs = [
    ...manifest.currentRun.refs,
    ...manifest.currentRun.toolTrace.flatMap((entry) => entry.refs),
    ...manifest.finalAnswer.supportingRefs,
  ];
  if (allRefs.some((ref) => ref.startsWith('fixture:') || ref.includes('/fixture/'))) {
    blockers.push('fixture refs cannot satisfy product proof');
  }
}

function validateTimingReport(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): boolean {
  let valid = true;
  for (const phase of WEB_SEARCH_STRICT_TIMING_PHASES) {
    const report = manifest.timingReport[phase];
    if (!report) {
      blockers.push(`timing report missing ${phase} phase`);
      valid = false;
      continue;
    }
    if (!['completed', 'blocked', 'skipped'].includes(report.status)) {
      blockers.push(`timing report ${phase} has invalid status`);
      valid = false;
    }
    if (!Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.completedAt))) {
      blockers.push(`timing report ${phase} must include ISO timestamps`);
      valid = false;
    }
    if (!Number.isFinite(report.durationMs) || report.durationMs < 0) {
      blockers.push(`timing report ${phase} must include non-negative durationMs`);
      valid = false;
    }
  }
  return valid;
}

function validateDirectDispatcherConsistency(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): boolean {
  const consistency = manifest.currentRun.directDispatcherConsistency;
  const consistent = consistency.consistent === true
    && consistency.direct.searchResultRef === consistency.dispatcher.searchResultRef
    && consistency.direct.finalUrl === consistency.dispatcher.finalUrl
    && consistency.direct.pageTextSha1 === consistency.dispatcher.pageTextSha1
    && consistency.direct.readStatus === consistency.dispatcher.readStatus;
  if (!consistent) {
    blockers.push('direct web_search/web_read and module dispatcher evidence must be consistent');
  }
  return consistent;
}

function validateFreshObservedAt(
  manifest: WebSearchStrictAcceptanceManifest,
  blockers: string[],
  now: Date,
  maxAgeMs: number,
): void {
  const observedAtMs = Date.parse(manifest.observedAt);
  if (!Number.isFinite(observedAtMs)) {
    blockers.push('passed manifest must include a fresh observedAt timestamp');
    return;
  }
  const nowMs = now.getTime();
  if (observedAtMs > nowMs + 5 * 60 * 1000 || observedAtMs < nowMs - maxAgeMs) {
    blockers.push('historical manifest cannot pass; observedAt must be fresh for the current run');
  }
}

function validateCurrentRunRefs(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): void {
  const webRefPattern = /^(web-search|web-page|web-source|web-text):/;
  const allRefs = [
    ...manifest.currentRun.refs,
    ...manifest.currentRun.toolTrace.flatMap((entry) => entry.refs),
    ...manifest.finalAnswer.supportingRefs,
  ].filter((ref) => ref.trim());
  if (allRefs.some((ref) => webRefPattern.test(ref) && !ref.includes(`${manifest.currentRun.runId}/`))) {
    blockers.push('web refs must belong to the current run; stale refs cannot pass');
  }
}

function validateForbiddenEvidence(manifest: WebSearchStrictAcceptanceManifest, blockers: string[]): void {
  const refs = [
    ...manifest.currentRun.refs,
    ...manifest.finalAnswer.supportingRefs,
  ].join('\n');
  if (manifest.strictGates.guiProjectionUsed || /gui\.present|conversation-projection|browserVisibleState/i.test(refs)) {
    blockers.push('GUI projection evidence cannot satisfy web_search product acceptance');
  }
  if (manifest.strictGates.screenshotReplayUsed || /screenshot:|\.png$|image\/png|html2canvas/i.test(refs) || manifest.evidence?.screenshotPath) {
    blockers.push('screenshot replay evidence cannot satisfy web_search product acceptance');
  }
}

async function validateSourceArtifacts(
  source: WebSearchSourcePageEvidence,
  artifactRoot: string,
  blockers: string[],
): Promise<void> {
  if (!source.sourcePageJsonPath || !source.pageTextPath) {
    blockers.push(`source ${source.pageRef} must include source page JSON path and page text path`);
    return;
  }
  try {
    const text = await readFile(join(artifactRoot, source.pageTextPath), 'utf8');
    const textSha1 = sha1(text);
    if (textSha1 !== source.textSha1) {
      blockers.push(`source ${source.pageRef} page text sha1 does not match textSha1`);
    }
    const sourceJson = JSON.parse(await readFile(join(artifactRoot, source.sourcePageJsonPath), 'utf8')) as Record<string, unknown>;
    if (sourceJson.schemaVersion !== WEB_SEARCH_SOURCE_PAGE_SCHEMA_VERSION) {
      blockers.push(`source ${source.pageRef} source JSON has invalid schemaVersion`);
    }
    if (sourceJson.finalUrl !== source.finalUrl || sourceJson.textSha1 !== source.textSha1 || sourceJson.textRef !== source.pageTextRef) {
      blockers.push(`source ${source.pageRef} source JSON must match finalUrl, textRef, and textSha1`);
    }
  } catch {
    blockers.push(`source ${source.pageRef} source page JSON and page text files must be readable`);
  }
}

async function writeReadSourcePage(options: {
  artifactDir: string;
  runId: string;
  index: number;
  pageRef: string;
  finalUrl: string;
  httpStatus: number;
  openedAt: string;
  text: string;
  informationQuality: 'high' | 'low';
  topicMatch: boolean;
}): Promise<WebSearchSourcePageEvidence> {
  const sourcePageJsonRef = `web-source:${options.runId}/source-pages/source-${options.index}.source.json`;
  const pageTextRef = `web-text:${options.runId}/source-pages/source-${options.index}.txt`;
  const sourcePageJsonPath = `source-pages/source-${options.index}.source.json`;
  const pageTextPath = `source-pages/source-${options.index}.txt`;
  const textSha1 = sha1(options.text);
  await mkdir(join(options.artifactDir, 'source-pages'), { recursive: true });
  await writeFile(join(options.artifactDir, pageTextPath), options.text, 'utf8');
  await writeFile(join(options.artifactDir, sourcePageJsonPath), `${JSON.stringify({
    schemaVersion: WEB_SEARCH_SOURCE_PAGE_SCHEMA_VERSION,
    status: 'read',
    openedAt: options.openedAt,
    finalUrl: options.finalUrl,
    textRef: pageTextRef,
    textSha1,
    httpStatus: options.httpStatus,
    extractMethod: 'static-fetch',
  }, null, 2)}\n`, 'utf8');
  return {
    pageRef: options.pageRef,
    sourcePageJsonRef,
    sourcePageJsonPath,
    pageTextRef,
    pageTextPath,
    textSha1,
    textChars: Buffer.byteLength(options.text, 'utf8'),
    openedAt: options.openedAt,
    finalUrl: options.finalUrl,
    httpStatus: options.httpStatus,
    readStatus: options.informationQuality === 'low' ? 'low-info' : options.topicMatch ? 'read' : 'topic-mismatch',
    informationQuality: options.informationQuality,
    topicMatch: options.topicMatch,
  };
}

async function writeBlockedSourcePage(options: {
  artifactDir: string;
  runId: string;
  index: number;
  pageRef: string;
  finalUrl: string;
  httpStatus: number;
  openedAt: string;
  blockedReason: string;
}): Promise<WebSearchSourcePageEvidence> {
  const sourcePageJsonRef = `web-source:${options.runId}/source-pages/source-${options.index}.source.json`;
  const sourcePageJsonPath = `source-pages/source-${options.index}.source.json`;
  await mkdir(join(options.artifactDir, 'source-pages'), { recursive: true });
  await writeFile(join(options.artifactDir, sourcePageJsonPath), `${JSON.stringify({
    schemaVersion: WEB_SEARCH_SOURCE_PAGE_SCHEMA_VERSION,
    status: 'blocked',
    openedAt: options.openedAt,
    finalUrl: options.finalUrl,
    httpStatus: options.httpStatus,
    blockedReason: options.blockedReason,
  }, null, 2)}\n`, 'utf8');
  return {
    pageRef: options.pageRef,
    sourcePageJsonRef,
    sourcePageJsonPath,
    textChars: 0,
    openedAt: options.openedAt,
    finalUrl: options.finalUrl,
    httpStatus: options.httpStatus,
    readStatus: 'blocked',
    informationQuality: 'low',
    topicMatch: true,
    blockedReason: options.blockedReason,
  };
}

function fakeWebSearch(options: {
  query: string;
  targetUrl: string;
  runId: string;
  path: WebSearchToolPath;
}): FakeSearchOutput {
  void options.path;
  return {
    query: options.query,
    searchResultRef: `web-search:${options.runId}/search-results.json`,
    results: [
      {
        title: 'SciForge P5 strict fixture source',
        url: options.targetUrl,
        snippet: 'A deterministic local fixture result that still requires a web_read before final synthesis.',
        ref: `web-page:${options.runId}/source-1`,
      },
    ],
  };
}

async function fakeWebRead(url: string): Promise<FakeReadOutput> {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    return {
      status: 'blocked',
      finalUrl: response.url,
      httpStatus: response.status,
      text: '',
      blockedReason: response.status === 403 ? 'read_failed_http_403' : `read_failed_http_${response.status}`,
    };
  }
  return {
    status: 'read',
    finalUrl: response.url,
    httpStatus: response.status,
    text: extractText(text),
  };
}

async function dispatchFixtureTool(toolName: WebSearchToolName, input: Record<string, unknown>): Promise<FakeSearchOutput | FakeReadOutput> {
  if (toolName === 'web_search') {
    return fakeWebSearch({
      query: String(input.query),
      targetUrl: String(input.targetUrl),
      runId: String(input.runId),
      path: 'module-dispatcher',
    });
  }
  return fakeWebRead(String(input.url));
}

function summarizeDirectDispatcher(
  directSearch: FakeSearchOutput,
  directRead: FakeReadOutput,
  dispatcherSearch: FakeSearchOutput,
  dispatcherRead: FakeReadOutput,
): WebSearchDirectDispatcherConsistency {
  const directSummary = summarizePipeline(directSearch, directRead);
  const dispatcherSummary = summarizePipeline(dispatcherSearch, dispatcherRead);
  return {
    direct: directSummary,
    dispatcher: dispatcherSummary,
    consistent: directSummary.searchResultRef === dispatcherSummary.searchResultRef
      && directSummary.finalUrl === dispatcherSummary.finalUrl
      && directSummary.pageTextSha1 === dispatcherSummary.pageTextSha1
      && directSummary.readStatus === dispatcherSummary.readStatus,
  };
}

function summarizePipeline(search: FakeSearchOutput, read: FakeReadOutput): WebSearchPipelineSummary {
  return {
    searchResultRef: search.searchResultRef,
    finalUrl: read.finalUrl,
    pageTextSha1: read.status === 'read' ? sha1(read.text) : undefined,
    readStatus: read.status,
  };
}

function buildTimingReport(
  observedAt: string,
  terminalStatus: 'completed' | 'blocked',
): Partial<Record<WebSearchStrictTimingPhase, WebSearchTimingPhaseReport>> {
  const timingReport: Partial<Record<WebSearchStrictTimingPhase, WebSearchTimingPhaseReport>> = {};
  let cursor = Date.parse(observedAt);
  WEB_SEARCH_STRICT_TIMING_PHASES.forEach((phase, index) => {
    const durationMs = index + 1;
    const startedAt = new Date(cursor).toISOString();
    cursor += durationMs;
    timingReport[phase] = {
      status: terminalStatus === 'blocked' && ['readFetch', 'render', 'extract', 'persist', 'finalSynthesis'].includes(phase)
        ? 'blocked'
        : 'completed',
      startedAt,
      completedAt: new Date(cursor).toISOString(),
      durationMs,
    };
  });
  return timingReport;
}

function strictSearchEvidence(
  query: string,
  searchResultRef: string,
  results: FakeSearchResult[],
): WebSearchSearchEvidence {
  const matchedTerms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 8);
  return {
    query,
    searchResultRef,
    providerResultCount: results.length,
    resultRefs: results.map((result) => result.ref),
    sourceLinks: results.map((result) => result.url),
    topicRelevance: {
      matched: results.length > 0,
      matchedTerms,
    },
  };
}

function makeStrictSearchOnlyNegative(manifest: WebSearchStrictAcceptanceManifest): void {
  manifest.currentRun.route = {
    provider: 'native',
    evidence: 'search-only',
  };
  manifest.currentRun.toolTrace = manifest.currentRun.toolTrace.filter((entry) => entry.toolName === 'web_search');
  manifest.currentRun.sourcePages = [];
  manifest.currentRun.refs = [
    manifest.currentRun.search.searchResultRef,
    ...manifest.currentRun.search.resultRefs,
  ];
  manifest.finalAnswer = {
    text: manifest.currentRun.search.sourceLinks.map((link, index) => `Source ${index + 1}: ${link}`).join('\n'),
    sourceLinks: manifest.currentRun.search.sourceLinks,
    supportingRefs: manifest.currentRun.refs,
    snippetOnly: false,
    uiVisible: true,
  };
}

function rewriteStrictRefs(manifest: WebSearchStrictAcceptanceManifest, fromRunId: string, toRunId: string): void {
  const rewrite = (ref: string) => ref.replaceAll(`${fromRunId}/`, `${toRunId}/`);
  manifest.currentRun.refs = manifest.currentRun.refs.map(rewrite);
  manifest.currentRun.toolTrace = manifest.currentRun.toolTrace.map((entry) => ({
    ...entry,
    refs: entry.refs.map(rewrite),
  }));
  manifest.currentRun.search = {
    ...manifest.currentRun.search,
    searchResultRef: rewrite(manifest.currentRun.search.searchResultRef),
    resultRefs: manifest.currentRun.search.resultRefs.map(rewrite),
  };
  manifest.finalAnswer.supportingRefs = manifest.finalAnswer.supportingRefs.map(rewrite);
}

function toolTraceEntry(
  toolName: WebSearchToolName,
  path: WebSearchToolPath,
  status: 'completed' | 'blocked' | 'failed',
  observedAt: string,
  refs: string[],
): WebSearchToolTraceEntry {
  return {
    toolName,
    path,
    status,
    startedAt: observedAt,
    completedAt: new Date(Date.parse(observedAt) + 1).toISOString(),
    refs: refs.filter(Boolean),
  };
}

function strictGateDefaults(): WebSearchStrictAcceptanceManifest['strictGates'] {
  return {
    searchOnlyAnswer: false,
    snippetOnlyAnswer: false,
    historicalManifest: false,
    staleRefs: false,
    fixtureRefsInProductProof: false,
    guiProjectionUsed: false,
    screenshotReplayUsed: false,
  };
}

function localFixtureProvider(): WebSearchStrictAcceptanceManifest['provider'] {
  return {
    id: 'local-fixture.web_search',
    kind: 'local-fixture',
    configured: true,
    fixture: true,
  };
}

function handleFixtureRequest(req: IncomingMessage, res: ServerResponse): void {
  const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
  if (path === '/blocked') {
    res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>Access restricted</h1><p>Login required for this source.</p></body></html>');
    return;
  }
  if (path === '/low-info') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><nav>Home</nav><footer>Copyright</footer></body></html>');
    return;
  }
  if (path === '/mismatch') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>Completely unrelated cooking notes</h1><p>Boil pasta and serve.</p></body></html>');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end([
    '<html><head><title>SciForge P5 strict fixture source</title></head><body>',
    '<main>',
    '<h1>SciForge P5 strict web search acceptance</h1>',
    '<p>This deterministic local fixture contains enough source text to prove the web_read extraction shape.</p>',
    '<p>The answer must cite this final URL, source page JSON, page text ref, textSha1, and openedAt.</p>',
    '</main>',
    '</body></html>',
  ].join(''));
}

function extractText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
