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

export const LITERATURE_HAPPY_PATH_CASE_ID = 'SA-WEB-15';

const now = '2026-05-16T00:00:00.000Z';
const scenarioId = 'sa-web-15-literature-happy-path-scenario';
const sessionId = 'session-sa-web-15-literature-happy-path';
const providerManifestRef = 'agentserver://mock/provider-manifest/literature-web';
const searchRunId = 'run-sa-web-15-search';
const fetchRunId = 'run-sa-web-15-fetch-read';
const reportRunId = 'run-sa-web-15-chinese-report';
const citationRepairRunId = 'run-sa-web-15-citation-repair';
const searchTurnId = 'msg-sa-web-15-search-user';
const fetchTurnId = 'msg-sa-web-15-fetch-user';
const reportTurnId = 'msg-sa-web-15-report-user';
const repairTurnId = 'msg-sa-web-15-repair-user';
const query = 'retrieval augmented generation citation grounding agent paper 2025';

const refs = {
  searchResults: 'agentserver://mock/web_search/sa-web-15/results.json',
  paperOnePdf: 'agentserver://mock/web_fetch/sa-web-15/paper-one.pdf',
  paperOneText: 'agentserver://mock/read_ref/sa-web-15/paper-one-fulltext.txt',
  paperTwoText: 'agentserver://mock/read_ref/sa-web-15/paper-two-abstract.txt',
  paperListArtifact: 'artifact:sa-web-15-paper-list',
  fulltextArtifact: 'artifact:sa-web-15-fulltext-pack',
  chineseReportArtifact: 'artifact:sa-web-15-chinese-report',
  correctedReportArtifact: 'artifact:sa-web-15-corrected-report',
  citationAuditArtifact: 'artifact:sa-web-15-citation-audit',
  routeTraceArtifact: 'artifact:sa-web-15-provider-route-trace',
  runAuditArtifact: 'artifact:sa-web-15-run-audit',
};

const searchText = '已检索到 2 篇候选论文，并保留 provider route trace 与结果证据。';
const fetchText = '已下载并读取全文与摘要，所有阅读结果都以 evidence refs 进入后续轮次。';
const reportText = '中文报告已生成：RAG 文献显示，引用落地需要同时记录检索结果、全文读取片段与声明级证据。';
const repairText = '已修正中文报告引用：旧占位符已替换为 [1] 和 [2]，并导出审计包。';

export interface LiteratureHappyPathCaseResult {
  input: WebE2eContractVerifierInput;
  manifest: WebE2eEvidenceBundleManifest;
  providerRouteTrace: ProviderRouteTraceEntry[];
  artifactLineage: ArtifactLineageEntry[];
  evidenceRefs: string[];
  recordedRunRequests: ScriptableAgentServerRecordedRequest[];
  discoveryProviderIds: string[];
  runResults: MockRunFetchResult[];
}

export interface ProviderRouteTraceEntry {
  eventId: string;
  runId: string;
  routeId: string;
  providerId: string;
  capabilityId: 'web_search' | 'web_fetch' | 'read_ref';
  routeDigest: string;
  evidenceRefs: string[];
}

export interface ArtifactLineageEntry {
  artifactRef: string;
  derivedFrom: string[];
  evidenceRefs: string[];
}

interface MockRunFetchResult {
  envelopes: JsonRecord[];
  events: JsonRecord[];
  resultRun: JsonRecord;
}

export async function runLiteratureHappyPathCase(outputRoot?: string): Promise<LiteratureHappyPathCaseResult> {
  const providerRouteTrace: ProviderRouteTraceEntry[] = [];
  const server = await startScriptableAgentServerMock({
    seed: LITERATURE_HAPPY_PATH_CASE_ID,
    fixedNow: now,
    discovery: {
      providers: [
        { id: 'sciforge.web-worker.web_search', capabilityId: 'web_search', status: 'available' },
        { id: 'sciforge.web-worker.web_fetch', capabilityId: 'web_fetch', status: 'available' },
        { id: 'sciforge.workspace-reader.read_ref', capabilityId: 'read_ref', status: 'available' },
      ],
    },
    script: (_request, exchange) => scriptForRound(exchange.requestIndex, providerRouteTrace),
  });

  try {
    const discoveryProviderIds = await fetchDiscoveryProviderIds(server.baseUrl);
    const runResults = [
      await fetchRun(server.baseUrl, { prompt: `检索 ${query}`, turnId: searchTurnId, expectedCapabilities: ['web_search'] }),
      await fetchRun(server.baseUrl, { prompt: '下载并读取前两篇文献。', turnId: fetchTurnId, evidenceRefs: [refs.searchResults], expectedCapabilities: ['web_fetch', 'read_ref'] }),
      await fetchRun(server.baseUrl, { prompt: '基于读取证据写中文报告。', turnId: reportTurnId, evidenceRefs: [refs.paperOneText, refs.paperTwoText], expectedArtifactTypes: ['research-report'] }),
      await fetchRun(server.baseUrl, { prompt: '修正报告中缺失的引用并导出审计。', turnId: repairTurnId, explicitRefs: [refs.chineseReportArtifact], expectedCapabilities: ['read_ref'] }),
    ];
    const workspaceState = workspaceStateForCase(providerRouteTrace);
    const input = verifierInput(workspaceState, providerRouteTrace);
    assertWebE2eContract(input);

    const artifactLineage = artifactLineageForCase();
    const evidenceRefs = finalEvidenceRefs(providerRouteTrace);
    const manifest = (await writeWebE2eEvidenceBundle({
      caseId: LITERATURE_HAPPY_PATH_CASE_ID,
      generatedAt: '2026-05-16T00:00:01.000Z',
      outputRoot,
      runs: [
        evidenceRun(searchRunId, ['ledger:literature-search', ...eventIdsForRun(providerRouteTrace, searchRunId)], 'completed'),
        evidenceRun(fetchRunId, ['ledger:literature-fetch-read', ...eventIdsForRun(providerRouteTrace, fetchRunId)], 'completed'),
        evidenceRun(reportRunId, ['ledger:literature-cn-report'], 'completed'),
        evidenceRun(citationRepairRunId, ['ledger:literature-citation-repair', 'ledger:audit-export', ...eventIdsForRun(providerRouteTrace, citationRepairRunId)], 'completed'),
      ],
      projection: {
        projectionVersion: input.expected.projectionVersion,
        projectionDigest: digestJson(input.expected.conversationProjection),
        terminalState: input.expected.conversationProjection.visibleAnswer?.status,
      },
      note: {
        status: 'passed',
        summary: 'Literature happy path covers non-empty web search, fetch/read, Chinese report, citation repair, and audit export.',
      },
      extra: {
        providerRouteTrace: providerRouteTrace as unknown as JsonRecord[],
        artifactLineage: artifactLineage as unknown as JsonRecord[],
        evidenceRefs,
        runAudit: input.runAudit as unknown as JsonRecord,
        conversationProjection: input.expected.conversationProjection as unknown as JsonRecord,
        auditExport: {
          exportedAt: '2026-05-16T00:00:01.000Z',
          includes: ['providerRouteTrace', 'artifactLineage', 'evidenceRefs', 'projection', 'runAudit'],
        },
      },
    })).manifest;

    const result = {
      input,
      manifest,
      providerRouteTrace,
      artifactLineage,
      evidenceRefs,
      recordedRunRequests: [...server.requests.runs],
      discoveryProviderIds,
      runResults,
    };
    assertLiteratureHappyPathCase(result);
    return result;
  } finally {
    await server.close();
  }
}

export function assertLiteratureHappyPathCase(result: LiteratureHappyPathCaseResult): void {
  assertWebE2eContract(result.input);
  assert.equal(result.recordedRunRequests.length, 4, 'literature happy path must execute four user-visible AgentServer rounds');
  assert.deepEqual(result.discoveryProviderIds.sort(), [
    'sciforge.web-worker.web_fetch',
    'sciforge.web-worker.web_search',
    'sciforge.workspace-reader.read_ref',
  ].sort(), 'mock web provider discovery must be non-empty and include search/fetch/read');
  assertRouteTrace(result.providerRouteTrace);
  assertArtifactLineage(result.artifactLineage);
  assertEvidenceRefs(result.evidenceRefs, result.providerRouteTrace);
  assertChineseReportAndCitationRepair(result);
  assertAuditManifest(result.manifest);
  for (const run of result.runResults) {
    assert.equal(run.resultRun.status, 'completed', 'each literature happy-path run must complete');
  }
}

function scriptForRound(requestIndex: number, trace: ProviderRouteTraceEntry[]) {
  if (requestIndex === 1) {
    return {
      id: 'sa-web-15-search',
      runId: searchRunId,
      steps: [
        { kind: 'event' as const, event: routeEvent(trace, searchRunId, 'search-route', 'sciforge.web-worker.web_search', 'web_search', [refs.searchResults]) },
        { kind: 'toolPayload' as const, payload: toolPayload(searchRunId, searchText, searchProjection(), [refs.searchResults, refs.paperListArtifact]) },
      ],
    };
  }
  if (requestIndex === 2) {
    return {
      id: 'sa-web-15-fetch-read',
      runId: fetchRunId,
      steps: [
        { kind: 'event' as const, event: routeEvent(trace, fetchRunId, 'fetch-pdf-route', 'sciforge.web-worker.web_fetch', 'web_fetch', [refs.paperOnePdf]) },
        { kind: 'event' as const, event: routeEvent(trace, fetchRunId, 'read-fulltext-route', 'sciforge.workspace-reader.read_ref', 'read_ref', [refs.paperOneText, refs.paperTwoText]) },
        { kind: 'toolPayload' as const, payload: toolPayload(fetchRunId, fetchText, fetchProjection(), [refs.paperOnePdf, refs.paperOneText, refs.paperTwoText, refs.fulltextArtifact]) },
      ],
    };
  }
  if (requestIndex === 3) {
    return {
      id: 'sa-web-15-chinese-report',
      runId: reportRunId,
      steps: [
        { kind: 'textDelta' as const, delta: '中文报告草稿生成中。', fields: { language: 'zh-CN' } },
        { kind: 'toolPayload' as const, payload: toolPayload(reportRunId, reportText, reportProjection(), [refs.searchResults, refs.paperOneText, refs.paperTwoText, refs.chineseReportArtifact]) },
      ],
    };
  }
  return {
    id: 'sa-web-15-citation-repair',
    runId: citationRepairRunId,
    steps: [
      { kind: 'event' as const, event: routeEvent(trace, citationRepairRunId, 'citation-read-route', 'sciforge.workspace-reader.read_ref', 'read_ref', [refs.chineseReportArtifact, refs.paperOneText, refs.paperTwoText]) },
      { kind: 'toolPayload' as const, payload: toolPayload(citationRepairRunId, repairText, finalProjection(trace), finalEvidenceRefs(trace)) },
    ],
  };
}

function routeEvent(
  trace: ProviderRouteTraceEntry[],
  runId: string,
  routeId: string,
  providerId: string,
  capabilityId: ProviderRouteTraceEntry['capabilityId'],
  evidenceRefs: string[],
): JsonRecord {
  const entry: ProviderRouteTraceEntry = {
    eventId: `route:${runId}:${routeId}`,
    runId,
    routeId,
    providerId,
    capabilityId,
    routeDigest: digestJson({ runId, routeId, providerId, capabilityId, evidenceRefs }),
    evidenceRefs,
  };
  trace.push(entry);
  return {
    type: 'provider-route',
    eventId: entry.eventId,
    providerId,
    capabilityId,
    routeId,
    routeDigest: entry.routeDigest,
    status: 'completed',
    evidenceRefs,
  };
}

function verifierInput(workspaceState: WebE2eWorkspaceState, routeTrace: ProviderRouteTraceEntry[]): WebE2eContractVerifierInput {
  const session = workspaceState.sessionsByScenario[scenarioId];
  const expected = expectedProjection(routeTrace);
  const browserVisibleState: WebE2eBrowserVisibleState = {
    status: 'satisfied',
    visibleAnswerText: repairText,
    visibleArtifactRefs: [
      refs.correctedReportArtifact,
      refs.chineseReportArtifact,
      refs.paperListArtifact,
      refs.fulltextArtifact,
    ],
    primaryArtifactRefs: [refs.correctedReportArtifact],
    supportingArtifactRefs: [refs.chineseReportArtifact, refs.paperListArtifact, refs.fulltextArtifact],
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
  return {
    caseId: LITERATURE_HAPPY_PATH_CASE_ID,
    expected,
    browserVisibleState,
    kernelProjection: expected.conversationProjection,
    sessionBundle: { session, workspaceState },
    runAudit: runAudit(routeTrace),
    artifactDeliveryManifest: {
      schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
      caseId: LITERATURE_HAPPY_PATH_CASE_ID,
      runId: citationRepairRunId,
      artifactDelivery: artifactDelivery(),
    },
  };
}

function expectedProjection(routeTrace: ProviderRouteTraceEntry[]): WebE2eExpectedProjection {
  const currentTurnRef = currentTurn(repairTurnId, 'Citation repair turn');
  const explicitReportRef: WebE2eInitialRef = {
    id: 'ref-sa-web-15-cn-report',
    kind: 'artifact',
    title: 'Chinese report before citation repair',
    ref: refs.chineseReportArtifact,
    source: 'explicit-selection',
    artifactType: 'research-report',
  };
  const evidenceRef: WebE2eInitialRef = {
    id: 'ref-sa-web-15-fulltext-pack',
    kind: 'artifact',
    title: 'Downloaded and read literature evidence',
    ref: refs.fulltextArtifact,
    source: 'seed-workspace',
    artifactType: 'literature-fulltext-pack',
  };
  return {
    schemaVersion: 'sciforge.web-e2e.expected-projection.v1',
    projectionVersion: 'sciforge.conversation-projection.v1',
    caseId: LITERATURE_HAPPY_PATH_CASE_ID,
    sessionId,
    scenarioId,
    runId: citationRepairRunId,
    currentTask: {
      currentTurnRef,
      explicitRefs: [explicitReportRef],
      selectedRefs: [currentTurnRef, explicitReportRef, evidenceRef],
    },
    conversationProjection: finalProjection(routeTrace),
    artifactDelivery: artifactDelivery(),
    runAuditRefs: [
      refs.runAuditArtifact,
      refs.citationAuditArtifact,
      refs.routeTraceArtifact,
      ...finalEvidenceRefs(routeTrace),
    ],
    providerManifestRef,
  };
}

function workspaceStateForCase(routeTrace: ProviderRouteTraceEntry[]): WebE2eWorkspaceState {
  const artifacts = artifactsForCase(routeTrace);
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: 'SA-WEB-15 literature happy path',
    createdAt: now,
    messages: [
      userMessage(searchTurnId, `检索 ${query}`, []),
      scenarioMessage('msg-sa-web-15-search-agent', searchText, searchRunId, [objectRef('sa-web-15-paper-list', '检索结果列表', 'literature-search-results', 'supporting-evidence', searchRunId)]),
      userMessage(fetchTurnId, '下载并读取前两篇文献。', [objectRef('sa-web-15-paper-list', '检索结果列表', 'literature-search-results', 'supporting-evidence', searchRunId)]),
      scenarioMessage('msg-sa-web-15-fetch-agent', fetchText, fetchRunId, [objectRef('sa-web-15-fulltext-pack', '全文读取证据包', 'literature-fulltext-pack', 'supporting-evidence', fetchRunId)]),
      userMessage(reportTurnId, '基于读取证据写中文报告。', [objectRef('sa-web-15-fulltext-pack', '全文读取证据包', 'literature-fulltext-pack', 'supporting-evidence', fetchRunId)]),
      scenarioMessage('msg-sa-web-15-report-agent', reportText, reportRunId, [objectRef('sa-web-15-chinese-report', '中文文献报告草稿', 'research-report', 'supporting-evidence', reportRunId)]),
      userMessage(repairTurnId, '修正报告中缺失的引用并导出审计。', [objectRef('sa-web-15-chinese-report', '中文文献报告草稿', 'research-report', 'supporting-evidence', reportRunId)]),
      scenarioMessage('msg-sa-web-15-repair-agent', repairText, citationRepairRunId, [
        objectRef('sa-web-15-corrected-report', '引用修正后的中文报告', 'research-report', 'primary-deliverable', citationRepairRunId),
        objectRef('sa-web-15-citation-audit', '引用修正审计', 'citation-audit', 'audit', citationRepairRunId),
      ]),
    ],
    runs: [
      run(searchRunId, searchTurnId, `检索 ${query}`, searchText, searchProjection(), 'completed'),
      run(fetchRunId, fetchTurnId, '下载并读取前两篇文献。', fetchText, fetchProjection(), 'completed'),
      run(reportRunId, reportTurnId, '基于读取证据写中文报告。', reportText, reportProjection(), 'completed'),
      run(citationRepairRunId, repairTurnId, '修正报告中缺失的引用并导出审计。', repairText, finalProjection(routeTrace), 'completed'),
    ],
    uiManifest: [
      { componentId: 'report-viewer', title: '引用修正后的中文报告', artifactRef: 'sa-web-15-corrected-report', priority: 1 },
      { componentId: 'evidence-list', title: '文献证据', artifactRef: 'sa-web-15-fulltext-pack', priority: 2 },
    ],
    claims: [],
    executionUnits: executionUnits(routeTrace),
    artifacts,
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-sa-web-15-literature-happy-path',
    sessionsByScenario: { [scenarioId]: session },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: routeTrace.map((entry) => ({
      id: entry.eventId,
      actor: 'AgentServer Mock',
      action: 'provider.route.completed',
      subject: entry.providerId,
      artifactRefs: entry.evidenceRefs,
      executionUnitRefs: [`EU-${entry.routeId}`],
      beliefRefs: [],
      branchId: scenarioId,
      visibility: 'project-record',
      decisionStatus: 'not-a-decision',
      createdAt: now,
    })),
    updatedAt: now,
  };
}

function searchProjection(): ConversationProjection {
  return projection(searchRunId, searchTurnId, `检索 ${query}`, searchText, [refs.searchResults, refs.paperListArtifact], [refs.searchResults]);
}

function fetchProjection(): ConversationProjection {
  return projection(fetchRunId, fetchTurnId, '下载并读取前两篇文献。', fetchText, [refs.fulltextArtifact], [refs.paperOnePdf, refs.paperOneText, refs.paperTwoText]);
}

function reportProjection(): ConversationProjection {
  return projection(reportRunId, reportTurnId, '基于读取证据写中文报告。', reportText, [refs.chineseReportArtifact], [refs.searchResults, refs.paperOneText, refs.paperTwoText]);
}

function finalProjection(routeTrace: ProviderRouteTraceEntry[]): ConversationProjection {
  return {
    ...projection(citationRepairRunId, repairTurnId, '修正报告中缺失的引用并导出审计。', repairText, [
      refs.correctedReportArtifact,
      refs.paperListArtifact,
      refs.fulltextArtifact,
    ], finalEvidenceRefs(routeTrace)),
    verificationState: {
      status: 'verified',
      verdict: 'supported',
      verifierRef: refs.citationAuditArtifact,
    },
  };
}

function projection(
  runId: string,
  turnId: string,
  prompt: string,
  text: string,
  artifactRefs: string[],
  auditRefs: string[],
): ConversationProjection {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: sessionId,
    currentTurn: { id: turnId, prompt },
    visibleAnswer: {
      status: 'satisfied',
      text,
      artifactRefs,
    },
    activeRun: { id: runId, status: 'satisfied' },
    artifacts: artifactRefs.map((ref) => ({ id: ref.replace(/^artifact:/, ''), type: 'literature-evidence', ref })),
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
      verifierRef: refs.runAuditArtifact,
    },
    auditRefs,
    diagnostics: [],
  };
}

function artifactsForCase(routeTrace: ProviderRouteTraceEntry[]): RuntimeArtifact[] {
  const routeTraceRefs = routeTrace.flatMap((entry) => entry.evidenceRefs);
  return [
    artifact('sa-web-15-paper-list', 'literature-search-results', '检索结果列表', searchRunId, 'supporting-evidence', '.sciforge/artifacts/sa-web-15-paper-list.json', [refs.searchResults], [refs.searchResults]),
    artifact('sa-web-15-fulltext-pack', 'literature-fulltext-pack', '全文读取证据包', fetchRunId, 'supporting-evidence', '.sciforge/artifacts/sa-web-15-fulltext-pack.json', [refs.paperOnePdf, refs.paperOneText, refs.paperTwoText], [refs.paperListArtifact, refs.searchResults]),
    artifact('sa-web-15-chinese-report', 'research-report', '中文文献报告草稿', reportRunId, 'supporting-evidence', '.sciforge/artifacts/sa-web-15-chinese-report.md', [refs.searchResults, refs.paperOneText, refs.paperTwoText], [refs.fulltextArtifact]),
    artifact('sa-web-15-corrected-report', 'research-report', '引用修正后的中文报告', citationRepairRunId, 'primary-deliverable', '.sciforge/artifacts/sa-web-15-corrected-report.md', finalEvidenceRefs(routeTrace), [refs.chineseReportArtifact, refs.fulltextArtifact, refs.citationAuditArtifact]),
    artifact('sa-web-15-citation-audit', 'citation-audit', '引用修正审计', citationRepairRunId, 'audit', '.sciforge/task-results/sa-web-15-citation-audit.json', [refs.chineseReportArtifact, refs.paperOneText, refs.paperTwoText], [refs.chineseReportArtifact]),
    artifact('sa-web-15-provider-route-trace', 'provider-route-trace', 'Provider route trace', citationRepairRunId, 'audit', '.sciforge/task-results/sa-web-15-provider-route-trace.json', routeTraceRefs, routeTraceRefs),
    artifact('sa-web-15-run-audit', 'run-audit', 'Run audit export', citationRepairRunId, 'audit', '.sciforge/task-results/sa-web-15-run-audit.json', finalEvidenceRefs(routeTrace), [refs.correctedReportArtifact, refs.routeTraceArtifact]),
  ];
}

function artifact(
  id: string,
  type: string,
  title: string,
  runId: string,
  role: NonNullable<RuntimeArtifact['delivery']>['role'],
  dataRef: string,
  evidenceRefs: string[],
  derivedFrom: string[],
): RuntimeArtifact {
  return {
    id,
    type,
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: {
      title,
      path: dataRef,
      runId,
      lineage: { derivedFrom, evidenceRefs },
    },
    dataRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role,
      declaredMediaType: dataRef.endsWith('.md') ? 'text/markdown' : 'application/json',
      declaredExtension: dataRef.endsWith('.md') ? 'md' : 'json',
      contentShape: 'raw-file',
      readableRef: role === 'audit' ? undefined : dataRef,
      rawRef: dataRef,
      previewPolicy: role === 'audit' ? 'audit-only' : 'inline',
    },
    visibility: 'project-record',
  };
}

function artifactDelivery(): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: [refs.correctedReportArtifact],
    supportingArtifactRefs: [refs.paperListArtifact, refs.fulltextArtifact, refs.chineseReportArtifact],
    auditRefs: [refs.citationAuditArtifact, refs.routeTraceArtifact, refs.runAuditArtifact],
    diagnosticRefs: [],
    internalRefs: [],
  };
}

function artifactLineageForCase(): ArtifactLineageEntry[] {
  return [
    { artifactRef: refs.paperListArtifact, derivedFrom: [refs.searchResults], evidenceRefs: [refs.searchResults] },
    { artifactRef: refs.fulltextArtifact, derivedFrom: [refs.paperListArtifact, refs.paperOnePdf], evidenceRefs: [refs.paperOnePdf, refs.paperOneText, refs.paperTwoText] },
    { artifactRef: refs.chineseReportArtifact, derivedFrom: [refs.fulltextArtifact], evidenceRefs: [refs.searchResults, refs.paperOneText, refs.paperTwoText] },
    { artifactRef: refs.correctedReportArtifact, derivedFrom: [refs.chineseReportArtifact, refs.citationAuditArtifact], evidenceRefs: [refs.searchResults, refs.paperOneText, refs.paperTwoText, refs.citationAuditArtifact] },
  ];
}

function executionUnits(routeTrace: ProviderRouteTraceEntry[]): RuntimeExecutionUnit[] {
  return routeTrace.map((entry) => ({
    id: `EU-${entry.routeId}`,
    tool: entry.providerId,
    params: `capability=${entry.capabilityId}`,
    status: 'done',
    hash: entry.routeDigest,
    runId: entry.runId,
    outputRef: entry.evidenceRefs[0],
    outputArtifacts: entry.evidenceRefs.filter((ref) => ref.startsWith('artifact:')).map((ref) => ref.replace(/^artifact:/, '')),
    time: now,
  }));
}

function run(
  id: string,
  turnId: string,
  prompt: string,
  response: string,
  conversationProjection: ConversationProjection,
  status: SciForgeRun['status'],
): SciForgeRun {
  return {
    id,
    scenarioId,
    status,
    prompt,
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
  if (runId === searchRunId) return [objectRef('sa-web-15-paper-list', '检索结果列表', 'literature-search-results', 'supporting-evidence', runId)];
  if (runId === fetchRunId) return [objectRef('sa-web-15-fulltext-pack', '全文读取证据包', 'literature-fulltext-pack', 'supporting-evidence', runId)];
  if (runId === reportRunId) return [objectRef('sa-web-15-chinese-report', '中文文献报告草稿', 'research-report', 'supporting-evidence', runId)];
  return [
    objectRef('sa-web-15-corrected-report', '引用修正后的中文报告', 'research-report', 'primary-deliverable', runId),
    objectRef('sa-web-15-citation-audit', '引用修正审计', 'citation-audit', 'audit', runId),
  ];
}

function objectRef(
  artifactId: string,
  title: string,
  artifactType: string,
  presentationRole: ObjectReference['presentationRole'],
  runId: string,
): ObjectReference {
  return {
    id: `object-${artifactId}`,
    kind: 'artifact',
    title,
    ref: `artifact:${artifactId}`,
    artifactType,
    runId,
    presentationRole,
    preferredView: artifactType === 'research-report' ? 'report-viewer' : 'record-table',
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

function toolPayload(
  runId: string,
  message: string,
  conversationProjection: ConversationProjection,
  evidenceRefs: string[],
): ScriptableAgentServerToolPayload {
  return {
    message,
    confidence: 0.91,
    claimType: 'fact',
    evidenceLevel: 'mock-web-provider',
    reasoningTrace: 'SA-WEB-15 scripted literature happy path.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'satisfied',
      conversationProjection: conversationProjection as unknown as JsonRecord,
    },
    claims: evidenceRefs.map((ref, index) => ({
      id: `claim-${runId}-${index + 1}`,
      text: message,
      refs: [{ ref }],
    })),
    uiManifest: [],
    executionUnits: [{
      id: `EU-${runId}`,
      tool: 'agentserver.mock.literature',
      status: 'done',
      outputRef: evidenceRefs[0],
      evidenceRefs,
      runId,
    }],
    artifacts: [],
  };
}

function runAudit(routeTrace: ProviderRouteTraceEntry[]): WebE2eRunAuditEvidence {
  return {
    runId: citationRepairRunId,
    refs: [
      providerManifestRef,
      refs.runAuditArtifact,
      refs.citationAuditArtifact,
      refs.routeTraceArtifact,
      ...finalEvidenceRefs(routeTrace),
    ],
    providerManifestRef,
    currentTurnRef: `message:${repairTurnId}`,
    explicitRefs: [refs.chineseReportArtifact],
    status: 'completed',
  };
}

function finalEvidenceRefs(routeTrace: ProviderRouteTraceEntry[]): string[] {
  return unique([
    refs.searchResults,
    refs.paperOnePdf,
    refs.paperOneText,
    refs.paperTwoText,
    refs.paperListArtifact,
    refs.fulltextArtifact,
    refs.chineseReportArtifact,
    refs.correctedReportArtifact,
    refs.citationAuditArtifact,
    refs.routeTraceArtifact,
    ...routeTrace.flatMap((entry) => [entry.eventId, entry.routeDigest, ...entry.evidenceRefs]),
  ]);
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

function eventIdsForRun(routeTrace: ProviderRouteTraceEntry[], runId: string): string[] {
  return routeTrace.filter((entry) => entry.runId === runId).map((entry) => entry.eventId);
}

async function fetchDiscoveryProviderIds(baseUrl: string): Promise<string[]> {
  const response = await fetch(`${baseUrl}/api/agent-server/tools/manifest`);
  if (!response.ok) throw new Error(`AgentServer mock discovery failed with HTTP ${response.status}`);
  const body = await response.json() as JsonRecord;
  const providers = Array.isArray(body.providers) ? body.providers : [];
  return providers
    .map((provider) => isJsonRecord(provider) ? provider.providerId : undefined)
    .filter((providerId): providerId is string => typeof providerId === 'string');
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<MockRunFetchResult> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AgentServer mock run failed with HTTP ${response.status}`);
  const lines = (await response.text()).trim().split('\n').filter(Boolean);
  const envelopes = lines.map((line) => JSON.parse(line) as JsonRecord);
  const resultEnvelope = envelopes.find((envelope) => envelope.result) as JsonRecord | undefined;
  const result = resultEnvelope?.result as JsonRecord | undefined;
  const data = result?.data as JsonRecord | undefined;
  const resultRun = data?.run as JsonRecord | undefined;
  if (!resultRun) throw new Error('AgentServer mock run stream did not include result.data.run');
  return {
    envelopes,
    events: envelopes.map((envelope) => envelope.event).filter(Boolean) as JsonRecord[],
    resultRun,
  };
}

function assertRouteTrace(routeTrace: ProviderRouteTraceEntry[]): void {
  assert.equal(routeTrace.length, 4, 'provider route trace must include search, fetch, read, and citation-read routes');
  for (const capability of ['web_search', 'web_fetch', 'read_ref'] as const) {
    assert.ok(routeTrace.some((entry) => entry.capabilityId === capability), `provider route trace must include ${capability}`);
  }
  for (const entry of routeTrace) {
    assert.match(entry.routeDigest, /^sha256:/, `${entry.routeId}: routeDigest`);
    assert.ok(entry.evidenceRefs.length > 0, `${entry.routeId}: evidenceRefs`);
  }
}

function assertArtifactLineage(lineage: ArtifactLineageEntry[]): void {
  const corrected = lineage.find((entry) => entry.artifactRef === refs.correctedReportArtifact);
  assert.ok(corrected, 'corrected Chinese report lineage must be recorded');
  assert.ok(corrected.derivedFrom.includes(refs.chineseReportArtifact), 'corrected report must derive from the pre-repair Chinese report');
  assert.ok(corrected.derivedFrom.includes(refs.citationAuditArtifact), 'corrected report must derive from citation audit');
  assert.ok(corrected.evidenceRefs.includes(refs.paperOneText), 'corrected report must preserve fulltext evidence refs');
  assert.ok(corrected.evidenceRefs.includes(refs.paperTwoText), 'corrected report must preserve abstract/read evidence refs');
}

function assertEvidenceRefs(evidenceRefs: string[], routeTrace: ProviderRouteTraceEntry[]): void {
  for (const required of [
    refs.searchResults,
    refs.paperOnePdf,
    refs.paperOneText,
    refs.paperTwoText,
    refs.correctedReportArtifact,
    refs.citationAuditArtifact,
  ]) {
    assert.ok(evidenceRefs.includes(required), `missing evidence ref ${required}`);
  }
  for (const entry of routeTrace) {
    assert.ok(evidenceRefs.includes(entry.eventId), `missing route event ref ${entry.eventId}`);
    assert.ok(evidenceRefs.includes(entry.routeDigest), `missing route digest ref ${entry.routeDigest}`);
  }
}

function assertChineseReportAndCitationRepair(result: LiteratureHappyPathCaseResult): void {
  const answer = result.input.expected.conversationProjection.visibleAnswer;
  assert.equal(answer?.status, 'satisfied');
  const text = 'text' in (answer ?? {}) ? String(answer?.text) : '';
  assert.match(text, /已修正中文报告引用/);
  assert.match(text, /\[1\].*\[2\]/);
  assert.doesNotMatch(text, /\[ref\?\]/);
  assert.ok(result.input.browserVisibleState.visibleAnswerText?.includes('导出审计包'));
}

function assertAuditManifest(manifest: WebE2eEvidenceBundleManifest): void {
  assert.equal(manifest.schemaVersion, 'sciforge.web-e2e.evidence-bundle.v1');
  assert.equal(manifest.caseId, LITERATURE_HAPPY_PATH_CASE_ID);
  assert.deepEqual(manifest.runIds, [searchRunId, fetchRunId, reportRunId, citationRepairRunId]);
  assert.ok(manifest.eventIds.includes('ledger:audit-export'), 'audit export ledger event must be present');
  assert.ok(Array.isArray(manifest.extra?.providerRouteTrace), 'audit export must include provider route trace');
  assert.ok(Array.isArray(manifest.extra?.artifactLineage), 'audit export must include artifact lineage');
  assert.ok(Array.isArray(manifest.extra?.evidenceRefs), 'audit export must include evidence refs');
  assert.ok(isJsonRecord(manifest.extra?.runAudit), 'audit export must include run audit');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
