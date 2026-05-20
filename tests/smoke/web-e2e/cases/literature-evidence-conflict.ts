import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import type {
  ObjectReference,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  assertWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import {
  writeWebE2eEvidenceBundle,
  type WebE2eEvidenceBundleManifest,
} from '../evidence-bundle.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerRecordedRequest,
  ScriptableAgentServerToolPayload,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eInitialRef,
  WebE2eWorkspaceState,
} from '../types.js';

export const LITERATURE_EVIDENCE_CONFLICT_CASE_ID = 'SA-WEB-32-literature-evidence-conflict';
export const LITERATURE_CONFLICT_REQUIREMENT_ID = 'R-LIT-02';
export const DYNAMIC_WEB_BLOCKED_REQUIREMENT_ID = 'R-WEB-01';

const now = '2026-05-20T00:00:00.000Z';
const scenarioId = 'sa-web-32-literature-evidence-conflict-scenario';
const sessionId = 'session-sa-web-32-literature-evidence-conflict';
const providerManifestRef = 'offline-web-e2e-fixture://mock/provider-manifest/offline-lit-web-conflict';

const litRuns = {
  collect: 'run-sa-web-32-lit-collect',
  stratify: 'run-sa-web-32-lit-stratify',
  rewrite: 'run-sa-web-32-lit-grant-rewrite',
} as const;

const webRuns = {
  render: 'run-sa-web-32-web-render-check',
  compare: 'run-sa-web-32-web-compare-source',
  export: 'run-sa-web-32-web-status-export',
} as const;

const litTurns = {
  collect: 'msg-sa-web-32-lit-collect-user',
  stratify: 'msg-sa-web-32-lit-stratify-user',
  rewrite: 'msg-sa-web-32-lit-rewrite-user',
} as const;

const webTurns = {
  render: 'msg-sa-web-32-web-render-user',
  compare: 'msg-sa-web-32-web-compare-user',
  export: 'msg-sa-web-32-web-export-user',
} as const;

const refs = {
  literatureSourcePack: 'artifact:sa-web-32-literature-source-pack',
  evidenceMatrix: 'artifact:sa-web-32-evidence-matrix',
  grantRewrite: 'artifact:sa-web-32-cautious-grant-rewrite',
  citationsExport: 'artifact:sa-web-32-citations-export',
  webStatusTable: 'artifact:sa-web-32-dynamic-web-evidence-status',
  webFactCheckReport: 'artifact:sa-web-32-web-fact-check-report',
  routeTrace: 'artifact:sa-web-32-provider-route-trace',
  runAudit: 'artifact:sa-web-32-run-audit',
  arxiv: 'offline-web-e2e-fixture://mock/web_search/sa-web-32/arxiv-preprint.json',
  pubmed: 'offline-web-e2e-fixture://mock/web_search/sa-web-32/pubmed-rct.json',
  semanticScholar: 'offline-web-e2e-fixture://mock/web_search/sa-web-32/semantic-scholar-meta.json',
  webEvidence: 'offline-web-e2e-fixture://mock/web_fetch/sa-web-32/registry-and-lab-pages.json',
  jsRendered: 'offline-web-e2e-fixture://mock/browser_fetch/sa-web-32/rendered-leaderboard.json',
  cloudflareBlocked: 'offline-web-e2e-fixture://mock/browser_fetch/sa-web-32/cloudflare-blocked.json',
  forbidden403: 'offline-web-e2e-fixture://mock/web_fetch/sa-web-32/forbidden-403.json',
  timeout: 'offline-web-e2e-fixture://mock/browser_fetch/sa-web-32/timeout.json',
  emptyPage: 'offline-web-e2e-fixture://mock/web_fetch/sa-web-32/empty-page.json',
  cachedFallback: 'offline-web-e2e-fixture://mock/cache/sa-web-32/cached-snapshot.json',
} as const;

const collectText = 'Offline R-LIT-02 fixture: arXiv supports the claim, PubMed contradicts it, Semantic Scholar is mixed, and a web registry is hypothesis-only.';
const stratifyText = 'Evidence was stratified by quality, confounders, datasets, and replication risk; contradictory sources remain explicitly separated.';
const rewriteText = 'Grant rewrite exported with cautious language: treat the claim as a testable hypothesis, not an established effect; citations were exported.';
const renderText = 'Offline R-WEB-01 fixture captured fetched/rendered/blocked/cached evidence statuses for a JS-rendered fact-check target.';
const compareText = 'Comparison source added: blocked Cloudflare, 403, timeout, and empty-page statuses are evidence of access limits, not evidence for the claim.';
const exportText = 'Dynamic web evidence table exported; cached fallback is marked stale and blocked pages do not contribute fabricated content.';

export type LiteratureEvidenceDirection = 'supports' | 'contradicts' | 'mixed' | 'hypothesis-only';
export type EvidenceQuality = 'low' | 'moderate' | 'high';
export type ReplicationRisk = 'low' | 'moderate' | 'high';
export type WebEvidenceStatus = 'fetched' | 'rendered' | 'blocked-cloudflare' | 'blocked-403' | 'timeout' | 'empty-page' | 'cached-fallback';

export interface LiteratureEvidenceFinding {
  source: 'arXiv' | 'PubMed' | 'Semantic Scholar' | 'web';
  ref: string;
  citationKey: string;
  direction: LiteratureEvidenceDirection;
  evidenceQuality: EvidenceQuality;
  confounders: string[];
  datasets: string[];
  replicationRisk: ReplicationRisk;
  claimBoundary: string;
}

export interface DynamicWebEvidenceFinding {
  source: string;
  ref: string;
  status: WebEvidenceStatus;
  httpStatus?: number;
  rendered: boolean;
  extractedContent?: string;
  cacheRef?: string;
  stale?: boolean;
  claimContribution: 'usable' | 'access-limited' | 'empty' | 'cached-context-only';
  note: string;
}

interface RouteTraceEntry {
  eventId: string;
  runId: string;
  providerId: string;
  capabilityId: 'web_search' | 'web_fetch' | 'browser_fetch' | 'cache_read' | 'export';
  status: 'completed' | 'blocked' | 'timeout' | 'empty' | 'cached';
  evidenceRefs: string[];
  routeDigest: string;
}

interface MockRunFetchResult {
  envelopes: JsonRecord[];
  events: JsonRecord[];
  resultRun: JsonRecord;
}

export interface LiteratureEvidenceConflictCaseResult {
  literatureInput: WebE2eContractVerifierInput;
  dynamicWebInput: WebE2eContractVerifierInput;
  manifest: WebE2eEvidenceBundleManifest;
  literatureFindings: LiteratureEvidenceFinding[];
  dynamicWebFindings: DynamicWebEvidenceFinding[];
  routeTrace: RouteTraceEntry[];
  recordedRunRequests: ScriptableAgentServerRecordedRequest[];
  runResults: MockRunFetchResult[];
}

export async function runLiteratureEvidenceConflictCase(outputRoot?: string): Promise<LiteratureEvidenceConflictCaseResult> {
  const routeTrace: RouteTraceEntry[] = [];
  const server = await startScriptableAgentServerMock({
    seed: LITERATURE_EVIDENCE_CONFLICT_CASE_ID,
    fixedNow: now,
    discovery: {
      providers: [
        { id: 'sciforge.web-worker.web_search', capabilityId: 'web_search', status: 'available' },
        { id: 'sciforge.web-worker.web_fetch', capabilityId: 'web_fetch', status: 'available' },
        { id: 'sciforge.browser-worker.browser_fetch', capabilityId: 'browser_fetch', status: 'available' },
        { id: 'sciforge.cache-worker.read', capabilityId: 'cache_read', status: 'available' },
      ],
    },
    script: (_request, exchange) => scriptForRound(exchange.requestIndex, routeTrace),
  });

  try {
    const runResults = [
      await fetchRun(server.baseUrl, { prompt: 'R-LIT-02 round 1: collect contradictory arXiv PubMed Semantic Scholar and web evidence.' }),
      await fetchRun(server.baseUrl, { prompt: 'R-LIT-02 round 2: stratify quality confounders datasets replication risk.', evidenceRefs: [refs.literatureSourcePack] }),
      await fetchRun(server.baseUrl, { prompt: 'R-LIT-02 round 3: cautious grant proposal rewrite and citations export.', explicitRefs: [refs.evidenceMatrix] }),
      await fetchRun(server.baseUrl, { prompt: 'R-WEB-01 round 1: check JS-rendered web fact with fetch/render evidence statuses.' }),
      await fetchRun(server.baseUrl, { prompt: 'R-WEB-01 round 2: compare another source and preserve blocked evidence statuses.', evidenceRefs: [refs.jsRendered] }),
      await fetchRun(server.baseUrl, { prompt: 'R-WEB-01 round 3: export fetched rendered blocked cached evidence table.', explicitRefs: [refs.webStatusTable] }),
    ];
    const literatureWorkspaceState = workspaceStateForCase(routeTrace, 'literature');
    const dynamicWebWorkspaceState = workspaceStateForCase(routeTrace, 'dynamic-web');
    const literatureInput = verifierInput(literatureWorkspaceState, literatureExpectedProjection(routeTrace), rewriteText);
    const dynamicWebInput = verifierInput(dynamicWebWorkspaceState, dynamicWebExpectedProjection(routeTrace), exportText);

    assertWebE2eContract(literatureInput);
    assertWebE2eContract(dynamicWebInput);

    const manifest = (await writeWebE2eEvidenceBundle({
      caseId: LITERATURE_EVIDENCE_CONFLICT_CASE_ID,
      generatedAt: '2026-05-20T00:00:01.000Z',
      outputRoot,
      runs: [
        evidenceRun(litRuns.collect, ['ledger:R-LIT-02:collect', ...eventIdsForRun(routeTrace, litRuns.collect)], 'completed'),
        evidenceRun(litRuns.stratify, ['ledger:R-LIT-02:stratify', ...eventIdsForRun(routeTrace, litRuns.stratify)], 'completed'),
        evidenceRun(litRuns.rewrite, ['ledger:R-LIT-02:grant-rewrite', 'ledger:R-LIT-02:citations-export', ...eventIdsForRun(routeTrace, litRuns.rewrite)], 'completed'),
        evidenceRun(webRuns.render, ['ledger:R-WEB-01:render-check', ...eventIdsForRun(routeTrace, webRuns.render)], 'completed'),
        evidenceRun(webRuns.compare, ['ledger:R-WEB-01:blocked-compare', ...eventIdsForRun(routeTrace, webRuns.compare)], 'completed'),
        evidenceRun(webRuns.export, ['ledger:R-WEB-01:status-export', ...eventIdsForRun(routeTrace, webRuns.export)], 'completed'),
      ],
      projection: {
        projectionVersion: dynamicWebInput.expected.projectionVersion,
        projectionDigest: digestJson({
          literature: literatureInput.expected.conversationProjection,
          dynamicWeb: dynamicWebInput.expected.conversationProjection,
        }),
        terminalState: dynamicWebInput.expected.conversationProjection.visibleAnswer?.status,
      },
      note: {
        status: 'passed',
        summary: 'Offline fixture contract only: R-LIT-02 contradictory evidence synthesis and R-WEB-01 dynamic/blocked evidence status export.',
      },
      extra: {
        fixtureMode: 'offline-contract-not-live-pass',
        requirementIds: [LITERATURE_CONFLICT_REQUIREMENT_ID, DYNAMIC_WEB_BLOCKED_REQUIREMENT_ID],
        literatureFindings: literatureFindings() as unknown as JsonRecord[],
        dynamicWebFindings: dynamicWebFindings() as unknown as JsonRecord[],
        routeTrace: routeTrace as unknown as JsonRecord[],
      },
    })).manifest;

    const result: LiteratureEvidenceConflictCaseResult = {
      literatureInput,
      dynamicWebInput,
      manifest,
      literatureFindings: literatureFindings(),
      dynamicWebFindings: dynamicWebFindings(),
      routeTrace,
      recordedRunRequests: [...server.requests.runs],
      runResults,
    };
    assertLiteratureEvidenceConflictCase(result);
    return result;
  } finally {
    await server.close();
  }
}

export function assertLiteratureEvidenceConflictCase(result: LiteratureEvidenceConflictCaseResult): void {
  assertWebE2eContract(result.literatureInput);
  assertWebE2eContract(result.dynamicWebInput);
  assert.equal(result.recordedRunRequests.length, 6, 'fixture must model three R-LIT-02 rounds and three R-WEB-01 rounds');
  assert.equal(result.manifest.extra?.fixtureMode, 'offline-contract-not-live-pass');
  assertLiteratureFindings(result.literatureFindings);
  assertCautiousGrantRewrite(result.literatureInput);
  assertDynamicWebFindings(result.dynamicWebFindings);
  assertNoFabricatedBlockedContent(result.dynamicWebFindings);
  assertRouteTrace(result.routeTrace);
  assertExportedCitations(result);
  assertDynamicStatusExport(result);
}

export function assertLiteratureFindings(findings: LiteratureEvidenceFinding[]): void {
  assert.deepEqual(new Set(findings.map((finding) => finding.source)), new Set(['arXiv', 'PubMed', 'Semantic Scholar', 'web']));
  assert.ok(findings.some((finding) => finding.direction === 'supports'), 'must preserve supporting evidence');
  assert.ok(findings.some((finding) => finding.direction === 'contradicts'), 'must preserve contradictory evidence');
  assert.ok(findings.some((finding) => finding.direction === 'mixed'), 'must preserve mixed evidence');
  assert.ok(findings.some((finding) => finding.direction === 'hypothesis-only'), 'must keep web findings as hypothesis-only when appropriate');
  for (const finding of findings) {
    assert.ok(finding.confounders.length > 0, `${finding.source}: confounders are required`);
    assert.ok(finding.datasets.length > 0, `${finding.source}: datasets are required`);
    assert.match(finding.citationKey, /^(arxiv|pubmed|semanticscholar|web)-/);
    assert.match(finding.ref, /^(offline-web-e2e-fixture:\/\/|artifact:)/);
  }
}

export function assertDynamicWebFindings(findings: DynamicWebEvidenceFinding[]): void {
  const statuses = new Set(findings.map((finding) => finding.status));
  for (const required of ['fetched', 'rendered', 'blocked-cloudflare', 'blocked-403', 'timeout', 'empty-page', 'cached-fallback'] satisfies WebEvidenceStatus[]) {
    assert.ok(statuses.has(required), `dynamic evidence table must include ${required}`);
  }
  assert.ok(findings.some((finding) => finding.status === 'cached-fallback' && finding.stale && finding.cacheRef), 'cached fallback must be marked stale with a cache ref');
  assert.ok(findings.some((finding) => finding.status === 'rendered' && finding.rendered && finding.extractedContent), 'JS-rendered source must have rendered content');
}

export function assertNoFabricatedBlockedContent(findings: DynamicWebEvidenceFinding[]): void {
  for (const finding of findings) {
    if (['blocked-cloudflare', 'blocked-403', 'timeout', 'empty-page'].includes(finding.status)) {
      assert.equal(finding.extractedContent, undefined, `${finding.status}: blocked/empty evidence must not invent page content`);
      assert.notEqual(finding.claimContribution, 'usable', `${finding.status}: blocked/empty evidence cannot support the claim`);
    }
  }
}

function scriptForRound(requestIndex: number, routeTrace: RouteTraceEntry[]) {
  if (requestIndex === 1) {
    return {
      id: 'sa-web-32-lit-collect',
      runId: litRuns.collect,
      steps: [
        { kind: 'event' as const, event: routeEvent(routeTrace, litRuns.collect, 'sciforge.web-worker.web_search', 'web_search', 'completed', [refs.arxiv, refs.pubmed, refs.semanticScholar]) },
        { kind: 'event' as const, event: routeEvent(routeTrace, litRuns.collect, 'sciforge.web-worker.web_fetch', 'web_fetch', 'completed', [refs.webEvidence]) },
        { kind: 'toolPayload' as const, payload: toolPayload(litRuns.collect, collectText, collectProjection(routeTrace), [refs.literatureSourcePack, refs.arxiv, refs.pubmed, refs.semanticScholar, refs.webEvidence]) },
      ],
    };
  }
  if (requestIndex === 2) {
    return {
      id: 'sa-web-32-lit-stratify',
      runId: litRuns.stratify,
      steps: [
        { kind: 'toolPayload' as const, payload: toolPayload(litRuns.stratify, stratifyText, stratifyProjection(routeTrace), [refs.evidenceMatrix, refs.literatureSourcePack]) },
      ],
    };
  }
  if (requestIndex === 3) {
    return {
      id: 'sa-web-32-lit-rewrite',
      runId: litRuns.rewrite,
      steps: [
        { kind: 'event' as const, event: routeEvent(routeTrace, litRuns.rewrite, 'sciforge.workspace-writer.export', 'export', 'completed', [refs.grantRewrite, refs.citationsExport]) },
        { kind: 'toolPayload' as const, payload: toolPayload(litRuns.rewrite, rewriteText, literatureFinalProjection(routeTrace), [refs.grantRewrite, refs.citationsExport, refs.evidenceMatrix]) },
      ],
    };
  }
  if (requestIndex === 4) {
    return {
      id: 'sa-web-32-web-render',
      runId: webRuns.render,
      steps: [
        { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.render, 'sciforge.browser-worker.browser_fetch', 'browser_fetch', 'completed', [refs.jsRendered]) },
        { kind: 'toolPayload' as const, payload: toolPayload(webRuns.render, renderText, dynamicRenderProjection(routeTrace), [refs.jsRendered, refs.webStatusTable]) },
      ],
    };
  }
  if (requestIndex === 5) {
    return {
      id: 'sa-web-32-web-compare',
      runId: webRuns.compare,
      steps: [
        { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.compare, 'sciforge.browser-worker.browser_fetch', 'browser_fetch', 'blocked', [refs.cloudflareBlocked]) },
        { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.compare, 'sciforge.web-worker.web_fetch', 'web_fetch', 'blocked', [refs.forbidden403]) },
        { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.compare, 'sciforge.browser-worker.browser_fetch', 'browser_fetch', 'timeout', [refs.timeout]) },
        { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.compare, 'sciforge.web-worker.web_fetch', 'web_fetch', 'empty', [refs.emptyPage]) },
        { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.compare, 'sciforge.cache-worker.read', 'cache_read', 'cached', [refs.cachedFallback]) },
        { kind: 'toolPayload' as const, payload: toolPayload(webRuns.compare, compareText, dynamicCompareProjection(routeTrace), [refs.webStatusTable, refs.cloudflareBlocked, refs.forbidden403, refs.timeout, refs.emptyPage, refs.cachedFallback]) },
      ],
    };
  }
  return {
    id: 'sa-web-32-web-export',
    runId: webRuns.export,
    steps: [
      { kind: 'event' as const, event: routeEvent(routeTrace, webRuns.export, 'sciforge.workspace-writer.export', 'export', 'completed', [refs.webFactCheckReport, refs.webStatusTable]) },
      { kind: 'toolPayload' as const, payload: toolPayload(webRuns.export, exportText, dynamicWebFinalProjection(routeTrace), [refs.webFactCheckReport, refs.webStatusTable]) },
    ],
  };
}

function literatureFindings(): LiteratureEvidenceFinding[] {
  return [
    {
      source: 'arXiv',
      ref: refs.arxiv,
      citationKey: 'arxiv-metformin-microbiome-2026',
      direction: 'supports',
      evidenceQuality: 'low',
      confounders: ['retrospective cohort', 'concomitant antibiotics', 'uncontrolled cancer stage imbalance'],
      datasets: ['single-center EHR plus microbiome n=124', 'self-supervised ML responder classifier'],
      replicationRisk: 'high',
      claimBoundary: 'Suggests an association only; preprint has no external clinical validation.',
    },
    {
      source: 'PubMed',
      ref: refs.pubmed,
      citationKey: 'pubmed-rct-metformin-ici-2025',
      direction: 'contradicts',
      evidenceQuality: 'high',
      confounders: ['trial excludes severe renal disease', 'microbiome not deeply profiled'],
      datasets: ['multi-center randomized trial n=312', 'overall survival and progression-free survival endpoints'],
      replicationRisk: 'low',
      claimBoundary: 'Does not support a broad efficacy claim for adjunct low-dose metformin.',
    },
    {
      source: 'Semantic Scholar',
      ref: refs.semanticScholar,
      citationKey: 'semanticscholar-meta-metformin-ici-2026',
      direction: 'mixed',
      evidenceQuality: 'moderate',
      confounders: ['publication bias', 'heterogeneous tumor types', 'inconsistent diabetes status adjustment'],
      datasets: ['meta-analysis of 11 observational cohorts', '2 small prospective cohorts'],
      replicationRisk: 'moderate',
      claimBoundary: 'Signals vary by tumor type and adjustment strategy.',
    },
    {
      source: 'web',
      ref: refs.webEvidence,
      citationKey: 'web-registry-metformin-microbiome-2026',
      direction: 'hypothesis-only',
      evidenceQuality: 'low',
      confounders: ['registry entry lacks outcome data', 'lab page is not peer reviewed'],
      datasets: ['trial registry protocol', 'lab project page'],
      replicationRisk: 'high',
      claimBoundary: 'Useful for trial context but not evidence that the claim is true.',
    },
  ];
}

function dynamicWebFindings(): DynamicWebEvidenceFinding[] {
  return [
    {
      source: 'Official JS leaderboard',
      ref: refs.jsRendered,
      status: 'rendered',
      rendered: true,
      extractedContent: 'Rendered table says benchmark entry is pending verification.',
      claimContribution: 'usable',
      note: 'Content is only accepted after browser rendering, not raw HTML.',
    },
    {
      source: 'Static API mirror',
      ref: refs.webEvidence,
      status: 'fetched',
      httpStatus: 200,
      rendered: false,
      extractedContent: 'Fetched JSON reports prior verified score.',
      claimContribution: 'usable',
      note: 'Fetched source is usable but may lag behind JS-rendered page.',
    },
    {
      source: 'Vendor page behind Cloudflare',
      ref: refs.cloudflareBlocked,
      status: 'blocked-cloudflare',
      httpStatus: 403,
      rendered: false,
      claimContribution: 'access-limited',
      note: 'Cloudflare challenge recorded; no page claims were extracted.',
    },
    {
      source: 'Publisher detail page',
      ref: refs.forbidden403,
      status: 'blocked-403',
      httpStatus: 403,
      rendered: false,
      claimContribution: 'access-limited',
      note: 'HTTP 403 recorded; status is not treated as content.',
    },
    {
      source: 'Slow dashboard',
      ref: refs.timeout,
      status: 'timeout',
      rendered: false,
      claimContribution: 'access-limited',
      note: 'Timeout recorded; no claim text was inferred.',
    },
    {
      source: 'Empty HTML page',
      ref: refs.emptyPage,
      status: 'empty-page',
      httpStatus: 200,
      rendered: false,
      claimContribution: 'empty',
      note: 'HTTP 200 with empty body recorded as empty evidence.',
    },
    {
      source: 'Cached search snapshot',
      ref: refs.cachedFallback,
      status: 'cached-fallback',
      rendered: false,
      cacheRef: refs.cachedFallback,
      stale: true,
      claimContribution: 'cached-context-only',
      note: 'Cached fallback gives context only and cannot replace blocked live content.',
    },
  ];
}

function verifierInput(
  workspaceState: WebE2eWorkspaceState,
  expected: WebE2eExpectedProjection,
  visibleAnswerText: string,
): WebE2eContractVerifierInput {
  const session = workspaceState.sessionsByScenario[scenarioId];
  const browserVisibleState: WebE2eBrowserVisibleState = {
    status: 'satisfied',
    visibleAnswerText,
    visibleArtifactRefs: [
      ...expected.artifactDelivery.primaryArtifactRefs,
      ...expected.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
  return {
    caseId: LITERATURE_EVIDENCE_CONFLICT_CASE_ID,
    expected,
    browserVisibleState,
    kernelProjection: expected.conversationProjection,
    sessionBundle: { session, workspaceState },
    runAudit: runAudit(expected),
    artifactDeliveryManifest: {
      schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
      caseId: LITERATURE_EVIDENCE_CONFLICT_CASE_ID,
      runId: expected.runId,
      artifactDelivery: expected.artifactDelivery,
    },
  };
}

function workspaceStateForCase(routeTrace: RouteTraceEntry[], scope: 'literature' | 'dynamic-web'): WebE2eWorkspaceState {
  const scopedRouteTrace = routeTrace.filter((entry) => scope === 'literature'
    ? entry.runId.startsWith('run-sa-web-32-lit')
    : entry.runId.startsWith('run-sa-web-32-web'));
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: 'SA-WEB-32 offline literature and dynamic web evidence conflict',
    createdAt: now,
    messages: [
      userMessage(litTurns.collect, 'Collect contradictory biomedical/ML claim evidence from arXiv, PubMed, Semantic Scholar, and web sources.', []),
      scenarioMessage('msg-sa-web-32-lit-collect-agent', collectText, litRuns.collect, [objectRef('sa-web-32-literature-source-pack', 'Contradictory literature source pack', 'literature-source-pack', 'supporting-evidence', litRuns.collect)]),
      userMessage(litTurns.stratify, 'Stratify by evidence quality, confounders, datasets, and replication risk.', [objectRef('sa-web-32-literature-source-pack', 'Contradictory literature source pack', 'literature-source-pack', 'supporting-evidence', litRuns.collect)]),
      scenarioMessage('msg-sa-web-32-lit-stratify-agent', stratifyText, litRuns.stratify, [objectRef('sa-web-32-evidence-matrix', 'Evidence quality and replication matrix', 'evidence-matrix', 'supporting-evidence', litRuns.stratify)]),
      userMessage(litTurns.rewrite, 'Rewrite as cautious grant proposal conclusion and export citations.', [objectRef('sa-web-32-evidence-matrix', 'Evidence quality and replication matrix', 'evidence-matrix', 'supporting-evidence', litRuns.stratify)]),
      scenarioMessage('msg-sa-web-32-lit-rewrite-agent', rewriteText, litRuns.rewrite, [
        objectRef('sa-web-32-cautious-grant-rewrite', 'Cautious grant proposal rewrite', 'grant-proposal-section', 'primary-deliverable', litRuns.rewrite),
        objectRef('sa-web-32-citations-export', 'Exported citations', 'citation-export', 'supporting-evidence', litRuns.rewrite),
      ]),
      userMessage(webTurns.render, 'Fact-check a JS-rendered dynamic web claim and record fetch/render evidence status.', []),
      scenarioMessage('msg-sa-web-32-web-render-agent', renderText, webRuns.render, [objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table draft', 'web-evidence-status-table', 'supporting-evidence', webRuns.render)]),
      userMessage(webTurns.compare, 'Compare another source and include Cloudflare, 403, timeout, empty page, and cache statuses.', [objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table draft', 'web-evidence-status-table', 'supporting-evidence', webRuns.render)]),
      scenarioMessage('msg-sa-web-32-web-compare-agent', compareText, webRuns.compare, [objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table', 'web-evidence-status-table', 'supporting-evidence', webRuns.compare)]),
      userMessage(webTurns.export, 'Export fetched/rendered/blocked/cached evidence table without fabricating unavailable content.', [objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table', 'web-evidence-status-table', 'supporting-evidence', webRuns.compare)]),
      scenarioMessage('msg-sa-web-32-web-export-agent', exportText, webRuns.export, [
        objectRef('sa-web-32-web-fact-check-report', 'Dynamic web fact-check report', 'web-fact-check-report', 'primary-deliverable', webRuns.export),
        objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table', 'web-evidence-status-table', 'supporting-evidence', webRuns.export),
      ]),
    ],
    runs: [
      run(litRuns.collect, litTurns.collect, collectText, collectProjection(routeTrace)),
      run(litRuns.stratify, litTurns.stratify, stratifyText, stratifyProjection(routeTrace)),
      run(litRuns.rewrite, litTurns.rewrite, rewriteText, literatureFinalProjection(routeTrace)),
      run(webRuns.render, webTurns.render, renderText, dynamicRenderProjection(routeTrace)),
      run(webRuns.compare, webTurns.compare, compareText, dynamicCompareProjection(routeTrace)),
      run(webRuns.export, webTurns.export, exportText, dynamicWebFinalProjection(routeTrace)),
    ],
    uiManifest: [
      { componentId: 'grant-rewrite-viewer', title: 'Cautious grant rewrite', artifactRef: 'sa-web-32-cautious-grant-rewrite', priority: 1 },
      { componentId: 'dynamic-web-status-table', title: 'Dynamic web evidence status', artifactRef: 'sa-web-32-dynamic-web-evidence-status', priority: 2 },
    ],
    claims: [],
    executionUnits: executionUnits(scopedRouteTrace),
    artifacts: artifactsForCase(routeTrace, scope),
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-sa-web-32-literature-evidence-conflict',
    sessionsByScenario: { [scenarioId]: session },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: scopedRouteTrace.map((entry) => ({
      id: entry.eventId,
      actor: 'Runtime fixture',
      action: `provider.${entry.status}`,
      subject: entry.providerId,
      artifactRefs: entry.evidenceRefs,
      executionUnitRefs: [`EU-${entry.eventId}`],
      beliefRefs: [],
      branchId: scenarioId,
      visibility: 'project-record',
      decisionStatus: 'not-a-decision',
      createdAt: now,
    })),
    updatedAt: now,
  };
}

function literatureExpectedProjection(routeTrace: RouteTraceEntry[]): WebE2eExpectedProjection {
  return expectedProjection({
    runId: litRuns.rewrite,
    turnId: litTurns.rewrite,
    title: 'R-LIT-02 cautious grant rewrite turn',
    explicitRefs: [initialArtifactRef('ref-sa-web-32-evidence-matrix', 'Evidence quality and replication matrix', refs.evidenceMatrix, 'evidence-matrix')],
    projection: literatureFinalProjection(routeTrace),
    delivery: literatureArtifactDelivery(),
    auditRefs: [refs.routeTrace, refs.runAudit, refs.citationsExport, ...literatureEvidenceRefs(routeTrace)],
  });
}

function dynamicWebExpectedProjection(routeTrace: RouteTraceEntry[]): WebE2eExpectedProjection {
  return expectedProjection({
    runId: webRuns.export,
    turnId: webTurns.export,
    title: 'R-WEB-01 dynamic evidence export turn',
    explicitRefs: [initialArtifactRef('ref-sa-web-32-web-status-table', 'Dynamic web evidence status table', refs.webStatusTable, 'web-evidence-status-table')],
    projection: dynamicWebFinalProjection(routeTrace),
    delivery: dynamicWebArtifactDelivery(),
    auditRefs: [refs.routeTrace, refs.runAudit, ...dynamicWebEvidenceRefs(routeTrace)],
  });
}

function literatureArtifactDelivery(): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: [refs.grantRewrite],
    supportingArtifactRefs: [refs.literatureSourcePack, refs.evidenceMatrix, refs.citationsExport],
    auditRefs: [refs.routeTrace, refs.runAudit],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function dynamicWebArtifactDelivery(): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: [refs.webFactCheckReport],
    supportingArtifactRefs: [refs.webStatusTable],
    auditRefs: [refs.routeTrace, refs.runAudit],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function expectedProjection(input: {
  runId: string;
  turnId: string;
  title: string;
  explicitRefs: WebE2eInitialRef[];
  projection: ConversationProjection;
  delivery: WebE2eArtifactDeliveryProjection;
  auditRefs: string[];
}): WebE2eExpectedProjection {
  const currentTurnRef = currentTurn(input.turnId, input.title);
  return {
    schemaVersion: 'sciforge.web-e2e.expected-projection.v1',
    projectionVersion: 'sciforge.conversation-projection.v1',
    caseId: LITERATURE_EVIDENCE_CONFLICT_CASE_ID,
    sessionId,
    scenarioId,
    runId: input.runId,
    currentTask: {
      currentTurnRef,
      explicitRefs: input.explicitRefs,
      selectedRefs: [currentTurnRef, ...input.explicitRefs],
    },
    conversationProjection: input.projection,
    artifactDelivery: input.delivery,
    runAuditRefs: input.auditRefs,
    providerManifestRef,
  };
}

function collectProjection(routeTrace: RouteTraceEntry[]): ConversationProjection {
  return projection(litRuns.collect, litTurns.collect, collectText, [refs.literatureSourcePack], [refs.arxiv, refs.pubmed, refs.semanticScholar, refs.webEvidence, ...eventIdsForRun(routeTrace, litRuns.collect)]);
}

function stratifyProjection(routeTrace: RouteTraceEntry[]): ConversationProjection {
  return projection(litRuns.stratify, litTurns.stratify, stratifyText, [refs.evidenceMatrix], [refs.literatureSourcePack, ...eventIdsForRun(routeTrace, litRuns.stratify)]);
}

function literatureFinalProjection(routeTrace: RouteTraceEntry[]): ConversationProjection {
  return {
    ...projection(litRuns.rewrite, litTurns.rewrite, rewriteText, [refs.grantRewrite, refs.citationsExport, refs.evidenceMatrix], literatureEvidenceRefs(routeTrace)),
    verificationState: {
      status: 'verified',
      verdict: 'mixed',
      verifierRef: refs.runAudit,
    },
  };
}

function dynamicRenderProjection(routeTrace: RouteTraceEntry[]): ConversationProjection {
  return projection(webRuns.render, webTurns.render, renderText, [refs.webStatusTable], [refs.jsRendered, ...eventIdsForRun(routeTrace, webRuns.render)]);
}

function dynamicCompareProjection(routeTrace: RouteTraceEntry[]): ConversationProjection {
  return projection(webRuns.compare, webTurns.compare, compareText, [refs.webStatusTable], dynamicWebEvidenceRefs(routeTrace));
}

function dynamicWebFinalProjection(routeTrace: RouteTraceEntry[]): ConversationProjection {
  return {
    ...projection(webRuns.export, webTurns.export, exportText, [refs.webFactCheckReport, refs.webStatusTable], dynamicWebEvidenceRefs(routeTrace)),
    verificationState: {
      status: 'verified',
      verdict: 'access-limited',
      verifierRef: refs.webStatusTable,
    },
  };
}

function projection(runId: string, turnId: string, text: string, artifactRefs: string[], auditRefs: string[]): ConversationProjection {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: sessionId,
    currentTurn: { id: turnId, prompt: text },
    visibleAnswer: {
      status: 'satisfied',
      text,
      artifactRefs,
    },
    activeRun: { id: runId, status: 'satisfied' },
    artifacts: artifactRefs.map((ref) => ({ id: ref.replace(/^artifact:/, ''), type: 'offline-contract-artifact', ref })),
    executionProcess: [{
      eventId: `event:${runId}:terminal`,
      type: 'Satisfied',
      summary: text,
      timestamp: now,
    }],
    recoverActions: [],
    verificationState: {
      status: 'verified',
      verdict: 'supported',
      verifierRef: refs.runAudit,
    },
    auditRefs,
    diagnostics: [],
  };
}

function artifactsForCase(routeTrace: RouteTraceEntry[], scope: 'literature' | 'dynamic-web'): RuntimeArtifact[] {
  const literatureArtifacts = [
    artifact('sa-web-32-literature-source-pack', 'literature-source-pack', 'Contradictory literature source pack', litRuns.collect, 'supporting-evidence', '.sciforge/artifacts/sa-web-32-literature-source-pack.json', [refs.arxiv, refs.pubmed, refs.semanticScholar, refs.webEvidence]),
    artifact('sa-web-32-evidence-matrix', 'evidence-matrix', 'Evidence quality and replication matrix', litRuns.stratify, 'supporting-evidence', '.sciforge/artifacts/sa-web-32-evidence-matrix.json', literatureEvidenceRefs(routeTrace)),
    artifact('sa-web-32-cautious-grant-rewrite', 'grant-proposal-section', 'Cautious grant proposal rewrite', litRuns.rewrite, 'primary-deliverable', '.sciforge/artifacts/sa-web-32-cautious-grant-rewrite.md', [refs.evidenceMatrix, refs.citationsExport, ...literatureEvidenceRefs(routeTrace)]),
    artifact('sa-web-32-citations-export', 'citation-export', 'Exported citations', litRuns.rewrite, 'supporting-evidence', '.sciforge/artifacts/sa-web-32-citations.bib', literatureFindings().map((finding) => finding.ref)),
  ];
  const dynamicWebArtifacts = [
    artifact('sa-web-32-dynamic-web-evidence-status', 'web-evidence-status-table', 'Dynamic web evidence status table', webRuns.export, 'supporting-evidence', '.sciforge/artifacts/sa-web-32-dynamic-web-evidence-status.json', dynamicWebEvidenceRefs(routeTrace)),
    artifact('sa-web-32-web-fact-check-report', 'web-fact-check-report', 'Dynamic web fact-check report', webRuns.export, 'primary-deliverable', '.sciforge/artifacts/sa-web-32-web-fact-check-report.md', [refs.webStatusTable, ...dynamicWebEvidenceRefs(routeTrace)]),
  ];
  const auditArtifacts = [
    artifact('sa-web-32-provider-route-trace', 'provider-route-trace', 'Provider route trace', scope === 'literature' ? litRuns.rewrite : webRuns.export, 'audit', '.sciforge/task-results/sa-web-32-route-trace.json', routeTrace.flatMap((entry) => entry.evidenceRefs)),
    artifact('sa-web-32-run-audit', 'run-audit', 'Run audit export', scope === 'literature' ? litRuns.rewrite : webRuns.export, 'audit', '.sciforge/task-results/sa-web-32-run-audit.json', [refs.routeTrace, ...routeTrace.flatMap((entry) => entry.evidenceRefs)]),
  ];
  return scope === 'literature'
    ? [...literatureArtifacts, ...auditArtifacts]
    : [...dynamicWebArtifacts, ...auditArtifacts];
}

function artifact(
  id: string,
  type: string,
  title: string,
  runId: string,
  role: NonNullable<RuntimeArtifact['delivery']>['role'],
  dataRef: string,
  evidenceRefs: string[],
): RuntimeArtifact {
  return {
    id,
    type,
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: { title, path: dataRef, runId, evidenceRefs },
    dataRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role,
      declaredMediaType: dataRef.endsWith('.md') ? 'text/markdown' : dataRef.endsWith('.bib') ? 'text/plain' : 'application/json',
      declaredExtension: dataRef.split('.').at(-1) ?? 'json',
      contentShape: 'raw-file',
      readableRef: role === 'audit' ? undefined : dataRef,
      rawRef: dataRef,
      previewPolicy: role === 'audit' ? 'audit-only' : 'inline',
    },
    visibility: 'project-record',
  };
}

function executionUnits(routeTrace: RouteTraceEntry[]): RuntimeExecutionUnit[] {
  return routeTrace.map((entry) => ({
    id: `EU-${entry.eventId}`,
    tool: entry.providerId,
    params: `capability=${entry.capabilityId};status=${entry.status}`,
    status: entry.status === 'completed' || entry.status === 'cached' ? 'done' : 'failed',
    hash: entry.routeDigest,
    runId: entry.runId,
    outputRef: entry.evidenceRefs[0],
    outputArtifacts: entry.evidenceRefs.filter((ref) => ref.startsWith('artifact:')).map((ref) => ref.replace(/^artifact:/, '')),
    time: now,
  }));
}

function routeEvent(
  routeTrace: RouteTraceEntry[],
  runId: string,
  providerId: RouteTraceEntry['providerId'],
  capabilityId: RouteTraceEntry['capabilityId'],
  status: RouteTraceEntry['status'],
  evidenceRefs: string[],
): JsonRecord {
  const eventId = `route:${runId}:${capabilityId}:${routeTrace.length + 1}`;
  const entry: RouteTraceEntry = {
    eventId,
    runId,
    providerId,
    capabilityId,
    status,
    evidenceRefs,
    routeDigest: digestJson({ eventId, runId, providerId, capabilityId, status, evidenceRefs }),
  };
  routeTrace.push(entry);
  return entry as unknown as JsonRecord;
}

function run(id: string, turnId: string, response: string, conversationProjection: ConversationProjection): SciForgeRun {
  return {
    id,
    scenarioId,
    status: 'completed',
    prompt: conversationProjection.currentTurn?.prompt ?? response,
    response,
    createdAt: now,
    completedAt: now,
    objectReferences: objectReferencesForRun(id),
    raw: {
      displayIntent: {
        protocolStatus: 'protocol-success',
        taskOutcome: 'satisfied',
        status: 'satisfied',
        turnId,
        conversationProjection,
        taskOutcomeProjection: {
          conversationProjection,
          taskSuccess: true,
          protocolSuccess: true,
        },
      },
      resultPresentation: { conversationProjection },
    },
  };
}

function userMessage(id: string, content: string, objectReferences: ObjectReference[]): SciForgeMessage {
  return { id, role: 'user', content, createdAt: now, status: 'completed', objectReferences };
}

function scenarioMessage(id: string, content: string, _runId: string, objectReferences: ObjectReference[]): SciForgeMessage {
  return { id, role: 'scenario', content, createdAt: now, status: 'completed', objectReferences };
}

function objectReferencesForRun(runId: string): ObjectReference[] {
  if (runId === litRuns.collect) return [objectRef('sa-web-32-literature-source-pack', 'Contradictory literature source pack', 'literature-source-pack', 'supporting-evidence', runId)];
  if (runId === litRuns.stratify) return [objectRef('sa-web-32-evidence-matrix', 'Evidence quality and replication matrix', 'evidence-matrix', 'supporting-evidence', runId)];
  if (runId === litRuns.rewrite) {
    return [
      objectRef('sa-web-32-cautious-grant-rewrite', 'Cautious grant proposal rewrite', 'grant-proposal-section', 'primary-deliverable', runId),
      objectRef('sa-web-32-citations-export', 'Exported citations', 'citation-export', 'supporting-evidence', runId),
    ];
  }
  if (runId === webRuns.export) {
    return [
      objectRef('sa-web-32-web-fact-check-report', 'Dynamic web fact-check report', 'web-fact-check-report', 'primary-deliverable', runId),
      objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table', 'web-evidence-status-table', 'supporting-evidence', runId),
    ];
  }
  return [objectRef('sa-web-32-dynamic-web-evidence-status', 'Dynamic web evidence status table', 'web-evidence-status-table', 'supporting-evidence', runId)];
}

function objectRef(
  artifactId: string,
  title: string,
  artifactType: string,
  presentationRole: ObjectReference['presentationRole'],
  runId: string,
): ObjectReference {
  return {
    id: `object-${artifactId}-${runId}`,
    kind: 'artifact',
    title,
    ref: `artifact:${artifactId}`,
    artifactType,
    runId,
    presentationRole,
    preferredView: artifactType.includes('report') || artifactType.includes('grant') ? 'report-viewer' : 'record-table',
    actions: ['focus-right-pane', 'copy-path'],
    status: 'available',
  };
}

function currentTurn(messageId: string, title: string): WebE2eInitialRef {
  return {
    id: `turn-${messageId}`,
    kind: 'user-turn',
    title,
    ref: `message:${messageId}`,
    source: 'current-turn',
  };
}

function initialArtifactRef(id: string, title: string, ref: string, artifactType: string): WebE2eInitialRef {
  return {
    id,
    kind: 'artifact',
    title,
    ref,
    source: 'explicit-selection',
    artifactType,
  };
}

function toolPayload(
  runId: string,
  message: string,
  conversationProjection: ConversationProjection,
  evidenceRefs: string[],
): ScriptableAgentServerToolPayload {
  return {
    message,
    confidence: 0.78,
    claimType: 'offline-contract',
    evidenceLevel: 'fixture-not-live-pass',
    reasoningTrace: 'Scripted offline Web E2E contract fixture; no live network evidence is claimed.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'satisfied',
      conversationProjection: conversationProjection as unknown as JsonRecord,
    },
    claims: evidenceRefs.map((ref, index) => ({ id: `claim-${runId}-${index + 1}`, text: message, refs: [{ ref }] })),
    uiManifest: [],
    executionUnits: [{
      id: `EU-${runId}`,
      tool: 'offline-web-e2e-fixture.offline-contract',
      status: 'done',
      outputRef: evidenceRefs[0],
      evidenceRefs,
      runId,
    }],
    artifacts: [],
  };
}

function runAudit(expected: WebE2eExpectedProjection): WebE2eRunAuditEvidence {
  return {
    runId: expected.runId,
    refs: [providerManifestRef, ...expected.runAuditRefs],
    providerManifestRef,
    currentTurnRef: expected.currentTask.currentTurnRef.ref,
    explicitRefs: expected.currentTask.explicitRefs.map((ref) => ref.ref),
    status: 'completed',
  };
}

function literatureEvidenceRefs(routeTrace: RouteTraceEntry[]): string[] {
  return unique([
    refs.arxiv,
    refs.pubmed,
    refs.semanticScholar,
    refs.webEvidence,
    refs.literatureSourcePack,
    refs.evidenceMatrix,
    refs.grantRewrite,
    refs.citationsExport,
    ...routeTrace.filter((entry) => entry.runId.startsWith('run-sa-web-32-lit')).flatMap((entry) => [entry.eventId, entry.routeDigest, ...entry.evidenceRefs]),
  ]);
}

function dynamicWebEvidenceRefs(routeTrace: RouteTraceEntry[]): string[] {
  return unique([
    refs.jsRendered,
    refs.cloudflareBlocked,
    refs.forbidden403,
    refs.timeout,
    refs.emptyPage,
    refs.cachedFallback,
    refs.webStatusTable,
    refs.webFactCheckReport,
    ...routeTrace.filter((entry) => entry.runId.startsWith('run-sa-web-32-web')).flatMap((entry) => [entry.eventId, entry.routeDigest, ...entry.evidenceRefs]),
  ]);
}

function eventIdsForRun(routeTrace: RouteTraceEntry[], runId: string): string[] {
  return routeTrace.filter((entry) => entry.runId === runId).map((entry) => entry.eventId);
}

function evidenceRun(runId: string, eventIds: string[], status: string) {
  return {
    runId,
    eventIds: unique(eventIds),
    requestDigest: digestJson({ runId, eventIds }),
    resultDigest: digestJson({ runId, status }),
    status,
  };
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<MockRunFetchResult> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`offline Web E2E fixture run failed with HTTP ${response.status}`);
  const envelopes = (await response.text()).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  const result = resultEnvelope?.result as JsonRecord | undefined;
  const data = result?.data as JsonRecord | undefined;
  const resultRun = data?.run as JsonRecord | undefined;
  if (!resultRun) throw new Error('offline Web E2E fixture run stream did not include result.data.run');
  return {
    envelopes,
    events: envelopes.map((envelope) => envelope.event).filter(Boolean) as JsonRecord[],
    resultRun,
  };
}

function assertCautiousGrantRewrite(input: WebE2eContractVerifierInput): void {
  const answer = input.expected.conversationProjection.visibleAnswer;
  const text = 'text' in (answer ?? {}) ? String(answer?.text) : '';
  assert.match(text, /cautious/i);
  assert.match(text, /hypothesis/i);
  assert.match(text, /not an established effect/i, 'grant rewrite must preserve uncertainty instead of claiming an established effect');
  assert.doesNotMatch(text, /\b(proven|settled|definitive)\b/i, 'grant rewrite must not flatten conflict into a single-sided conclusion');
  assert.ok(input.expected.artifactDelivery.supportingArtifactRefs.includes(refs.citationsExport), 'citations export must be visible as supporting evidence');
}

function assertRouteTrace(routeTrace: RouteTraceEntry[]): void {
  assert.ok(routeTrace.length >= 10, 'route trace must include literature, render, blocked, cache, and export evidence events');
  for (const capability of ['web_search', 'web_fetch', 'browser_fetch', 'cache_read', 'export'] satisfies RouteTraceEntry['capabilityId'][]) {
    assert.ok(routeTrace.some((entry) => entry.capabilityId === capability), `route trace must include ${capability}`);
  }
  for (const status of ['blocked', 'timeout', 'empty', 'cached'] satisfies RouteTraceEntry['status'][]) {
    assert.ok(routeTrace.some((entry) => entry.status === status), `route trace must include ${status}`);
  }
  for (const entry of routeTrace) {
    assert.match(entry.routeDigest, /^sha256:/, `${entry.eventId}: route digest`);
    assert.ok(entry.evidenceRefs.length > 0, `${entry.eventId}: evidence refs`);
  }
}

function assertExportedCitations(result: LiteratureEvidenceConflictCaseResult): void {
  assert.ok(result.manifest.eventIds.includes('ledger:R-LIT-02:citations-export'), 'manifest must include R-LIT-02 citations export ledger event');
  const citationKeys = result.literatureFindings.map((finding) => finding.citationKey);
  assert.equal(new Set(citationKeys).size, citationKeys.length, 'citation keys must be unique');
  assert.deepEqual(citationKeys.sort(), [
    'arxiv-metformin-microbiome-2026',
    'pubmed-rct-metformin-ici-2025',
    'semanticscholar-meta-metformin-ici-2026',
    'web-registry-metformin-microbiome-2026',
  ].sort());
}

function assertDynamicStatusExport(result: LiteratureEvidenceConflictCaseResult): void {
  assert.ok(result.manifest.eventIds.includes('ledger:R-WEB-01:status-export'), 'manifest must include R-WEB-01 status export ledger event');
  const answer = result.dynamicWebInput.expected.conversationProjection.visibleAnswer;
  const text = 'text' in (answer ?? {}) ? String(answer?.text) : '';
  assert.match(text, /cached fallback is marked stale/i);
  assert.match(text, /blocked pages do not contribute fabricated content/i);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
