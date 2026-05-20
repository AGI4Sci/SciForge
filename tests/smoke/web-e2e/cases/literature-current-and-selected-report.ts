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
import type {
  JsonRecord,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eInitialRef,
  WebE2eWorkspaceState,
} from '../types.js';

export const LITERATURE_CURRENT_AND_SELECTED_REPORT_CASE_ID = 'SA-WEB-31';

const now = '2026-05-20T00:00:00.000Z';
const scenarioId = 'r-lit-current-and-selected-report-scenario';
const sessionId = 'session-r-lit-current-and-selected-report';
const providerManifestRef = 'offline-web-e2e-fixture://offline-fixture/provider-manifest/literature-current-selected';

const latestRunId = 'run-r-lit-01-latest-agentic-rl';
const reorderRunId = 'run-r-lit-01-reorder-report';
const exportRunId = 'run-r-lit-01-export-status';
const oldFollowupRunId = 'run-r-lit-03-selected-old-followup';
const switchFollowupRunId = 'run-r-lit-03-switch-selection-followup';
const matrixRunId = 'run-r-lit-03-evidence-matrix-next-papers';

const latestTurnId = 'msg-r-lit-01-latest-user';
const reorderTurnId = 'msg-r-lit-01-reorder-user';
const exportTurnId = 'msg-r-lit-01-export-user';
const oldFollowupTurnId = 'msg-r-lit-03-old-followup-user';
const switchFollowupTurnId = 'msg-r-lit-03-switch-followup-user';
const matrixTurnId = 'msg-r-lit-03-matrix-user';

const refs = {
  searchQueries: 'artifact:r-lit-01-search-queries',
  candidateList: 'artifact:r-lit-01-candidate-list',
  pdfReadState: 'artifact:r-lit-01-pdf-read-state',
  blockedReasons: 'artifact:r-lit-01-blocked-reasons',
  chineseReport: 'artifact:r-lit-01-chinese-report',
  reorderedReport: 'artifact:r-lit-01-reordered-report',
  exportStatus: 'artifact:r-lit-01-export-status',
  oldReport: 'artifact:r-lit-03-old-report',
  newReport: 'artifact:r-lit-03-new-report',
  oldFollowup: 'artifact:r-lit-03-old-followup',
  switchFollowup: 'artifact:r-lit-03-switch-followup',
  evidenceMatrix: 'artifact:r-lit-03-evidence-matrix',
  nextPapers: 'artifact:r-lit-03-next-papers',
  selectedScopeAudit: 'artifact:r-lit-03-selected-scope-audit',
  routeTrace: 'artifact:r-lit-current-selected-route-trace',
  runAudit: 'artifact:r-lit-current-selected-run-audit',
  searchResultA: 'offline-web-e2e-fixture://offline-fixture/arxiv/search/agentic-rl-today.json',
  paperAlphaPdf: 'offline-web-e2e-fixture://offline-fixture/arxiv/pdf/agentic-rl-alpha.pdf',
  paperAlphaText: 'offline-web-e2e-fixture://offline-fixture/read_ref/agentic-rl-alpha-fulltext.txt',
  paperBetaPdf: 'offline-web-e2e-fixture://offline-fixture/arxiv/pdf/agentic-rl-beta.pdf',
  paperBetaText: 'offline-web-e2e-fixture://offline-fixture/read_ref/agentic-rl-beta-fulltext.txt',
  blockedGamma: 'offline-web-e2e-fixture://offline-fixture/arxiv/pdf/agentic-rl-gamma-blocked.txt',
};

const latestAnswer = '离线 fixture: 已按 latest/today agentic RL arXiv 检索，生成候选列表、PDF 下载/阅读状态、blocked reasons 和中文报告路径。';
const reorderAnswer = '已按方法、环境/任务、证据强度、benchmark、局限性重排中文报告。';
const exportAnswer = '已导出 R-LIT-01 状态：live=false cached=false fixtureLevel=true，artifact path=.sciforge/artifacts/r-lit-01-chinese-report.md。';
const oldFollowupAnswer = '旧报告追问只使用 selectedRefs=[artifact:r-lit-03-old-report]，没有读取 latest artifact。';
const switchFollowupAnswer = '切换选择后只使用 selectedRefs=[artifact:r-lit-03-new-report]，回答不同 evidence status。';
const matrixAnswer = '已导出 evidence matrix 和 next papers；selected refs audit 证明 follow-up scoped 到 selected refs，而不是 latest artifact。';

export interface LiteratureCurrentAndSelectedReportCaseResult {
  input: WebE2eContractVerifierInput;
  workspaceState: WebE2eWorkspaceState;
  searchQueries: string[];
  candidateList: LiteratureCandidate[];
  readStates: LiteratureReadState[];
  blockedReasons: BlockedReason[];
  selectedRefAudit: SelectedRefAudit;
  evidenceMatrix: EvidenceMatrixRow[];
  nextPapers: NextPaper[];
}

export interface LiteratureCandidate {
  id: string;
  title: string;
  source: 'arXiv';
  freshness: 'latest' | 'today';
  pdfRef?: string;
  evidenceRef?: string;
  status: 'candidate' | 'downloaded' | 'read' | 'blocked';
}

export interface LiteratureReadState {
  paperId: string;
  pdfStatus: 'downloaded' | 'blocked';
  readStatus: 'fulltext-read' | 'not-read';
  evidenceRef?: string;
  blockedReasonId?: string;
}

export interface BlockedReason {
  id: string;
  paperId: string;
  reason: 'pdf-unavailable' | 'fixture-not-live';
  detail: string;
}

export interface SelectedRefAudit {
  oldFollowup: {
    selectedRefs: string[];
    forbiddenRefs: string[];
    answerRefs: string[];
  };
  switchFollowup: {
    selectedRefs: string[];
    forbiddenRefs: string[];
    answerRefs: string[];
  };
}

export interface EvidenceMatrixRow {
  reportRef: string;
  selectedInRunId: string;
  evidenceStatus: string;
  pdfOrReadRefs: string[];
  latestArtifactUsed: boolean;
}

export interface NextPaper {
  title: string;
  rationale: string;
  seedReportRef: string;
}

export function buildLiteratureCurrentAndSelectedReportCase(): LiteratureCurrentAndSelectedReportCaseResult {
  const searchQueries = [
    'site:arxiv.org agentic RL latest today',
    'arXiv agentic reinforcement learning tool use 2026',
    'arXiv agentic RL environments benchmarks evidence limitations',
  ];
  const candidateList: LiteratureCandidate[] = [
    {
      id: 'agentic-rl-alpha',
      title: 'Agentic Reinforcement Learning with Tool-Grounded Planning',
      source: 'arXiv',
      freshness: 'today',
      pdfRef: refs.paperAlphaPdf,
      evidenceRef: refs.paperAlphaText,
      status: 'read',
    },
    {
      id: 'agentic-rl-beta',
      title: 'Benchmarked Agentic RL for Long-Horizon Web Tasks',
      source: 'arXiv',
      freshness: 'latest',
      pdfRef: refs.paperBetaPdf,
      evidenceRef: refs.paperBetaText,
      status: 'read',
    },
    {
      id: 'agentic-rl-gamma',
      title: 'Agentic RL under Sparse Environment Feedback',
      source: 'arXiv',
      freshness: 'latest',
      status: 'blocked',
    },
  ];
  const readStates: LiteratureReadState[] = [
    { paperId: 'agentic-rl-alpha', pdfStatus: 'downloaded', readStatus: 'fulltext-read', evidenceRef: refs.paperAlphaText },
    { paperId: 'agentic-rl-beta', pdfStatus: 'downloaded', readStatus: 'fulltext-read', evidenceRef: refs.paperBetaText },
    { paperId: 'agentic-rl-gamma', pdfStatus: 'blocked', readStatus: 'not-read', blockedReasonId: 'blocked-gamma-pdf' },
  ];
  const blockedReasons: BlockedReason[] = [
    {
      id: 'blocked-gamma-pdf',
      paperId: 'agentic-rl-gamma',
      reason: 'pdf-unavailable',
      detail: 'Offline fixture records the blocked PDF state instead of pretending live retrieval succeeded.',
    },
    {
      id: 'offline-contract',
      paperId: 'all',
      reason: 'fixture-not-live',
      detail: 'This is a generic offline Web E2E contract and explicitly not a live arXiv pass.',
    },
  ];
  const selectedRefAudit: SelectedRefAudit = {
    oldFollowup: {
      selectedRefs: [refs.oldReport],
      forbiddenRefs: [refs.chineseReport, refs.newReport],
      answerRefs: [refs.oldReport, refs.oldFollowup],
    },
    switchFollowup: {
      selectedRefs: [refs.newReport],
      forbiddenRefs: [refs.chineseReport, refs.oldReport],
      answerRefs: [refs.newReport, refs.switchFollowup],
    },
  };
  const evidenceMatrix: EvidenceMatrixRow[] = [
    {
      reportRef: refs.oldReport,
      selectedInRunId: oldFollowupRunId,
      evidenceStatus: 'old report PDF read in prior session branch',
      pdfOrReadRefs: ['offline-web-e2e-fixture://offline-fixture/read_ref/r-lit-03-old-report-fulltext.txt'],
      latestArtifactUsed: false,
    },
    {
      reportRef: refs.newReport,
      selectedInRunId: switchFollowupRunId,
      evidenceStatus: 'new report fulltext evidence read after selection switch',
      pdfOrReadRefs: [refs.paperAlphaText, refs.paperBetaText],
      latestArtifactUsed: false,
    },
  ];
  const nextPapers: NextPaper[] = [
    {
      title: 'Tool-grounded agentic RL evaluation under hidden-state environments',
      rationale: 'Extends the selected new report benchmark gap without relying on latest artifact recency.',
      seedReportRef: refs.newReport,
    },
    {
      title: 'Longitudinal evidence audits for agentic RL papers',
      rationale: 'Follows the old selected report evidence-status question with a stronger audit design.',
      seedReportRef: refs.oldReport,
    },
  ];

  const workspaceState = workspaceStateForCase(searchQueries, candidateList, readStates, blockedReasons, selectedRefAudit, evidenceMatrix, nextPapers);
  const input = verifierInput(workspaceState);
  const result = {
    input,
    workspaceState,
    searchQueries,
    candidateList,
    readStates,
    blockedReasons,
    selectedRefAudit,
    evidenceMatrix,
    nextPapers,
  };
  assertLiteratureCurrentAndSelectedReportCase(result);
  return result;
}

export function assertLiteratureCurrentAndSelectedReportCase(result: LiteratureCurrentAndSelectedReportCaseResult): void {
  assertWebE2eContract(result.input);
  assertRlit01CurrentRetrieval(result);
  assertRlit03SelectedReportScoping(result);
}

export function assertRlit01CurrentRetrieval(result: LiteratureCurrentAndSelectedReportCaseResult): void {
  assert.ok(result.searchQueries.length >= 3, 'R-LIT-01 must preserve search queries');
  assert.ok(result.searchQueries.some((query) => /latest|today/i.test(query)), 'R-LIT-01 query set must model latest/today retrieval');
  assert.ok(result.candidateList.length >= 3, 'R-LIT-01 must expose a candidate list');
  assert.ok(result.candidateList.every((candidate) => candidate.source === 'arXiv'), 'R-LIT-01 must model arXiv candidates');
  assert.ok(result.readStates.some((state) => state.pdfStatus === 'downloaded' && state.readStatus === 'fulltext-read'), 'R-LIT-01 must include downloaded and read states');
  assert.ok(result.blockedReasons.some((reason) => reason.reason === 'fixture-not-live'), 'R-LIT-01 must explicitly declare this is not a live pass');
  assert.ok(result.blockedReasons.some((reason) => reason.reason === 'pdf-unavailable'), 'R-LIT-01 must preserve blocked PDF reasons');

  const session = result.workspaceState.sessionsByScenario[scenarioId];
  const exportRun = session.runs.find((run) => run.id === exportRunId);
  const exportPayload = runFixtureOutput(exportRun);
  assert.equal(exportPayload?.live, false, 'R-LIT-01 fixture must not claim live retrieval');
  assert.equal(exportPayload?.fixtureLevel, true, 'R-LIT-01 fixture must identify fixture-level coverage');
  assert.equal(exportPayload?.artifactPath, '.sciforge/artifacts/r-lit-01-chinese-report.md');
  assert.equal(exportPayload?.exportStatus, 'exported');

  const reordered = artifactByRef(session, refs.reorderedReport);
  assert.deepEqual(
    ((reordered.metadata as JsonRecord).reorderAxes as string[]),
    ['methods', 'environments/tasks', 'evidence strength', 'benchmarks', 'limitations'],
    'R-LIT-01 reordered report must keep the requested ordering axes',
  );
}

export function assertRlit03SelectedReportScoping(result: LiteratureCurrentAndSelectedReportCaseResult): void {
  assert.equal(result.evidenceMatrix.length, 2, 'R-LIT-03 must include two literature reports in one session');
  assert.ok(result.nextPapers.length >= 2, 'R-LIT-03 must export next papers');

  for (const [label, audit] of Object.entries(result.selectedRefAudit)) {
    assert.equal(audit.selectedRefs.length, 1, `${label} must have exactly one selected report ref`);
    for (const forbidden of audit.forbiddenRefs) {
      assert.equal(audit.answerRefs.includes(forbidden), false, `${label} must not include forbidden latest/unselected ref ${forbidden}`);
    }
  }

  assert.deepEqual(result.selectedRefAudit.oldFollowup.selectedRefs, [refs.oldReport], 'old follow-up must scope to the old selected report');
  assert.deepEqual(result.selectedRefAudit.switchFollowup.selectedRefs, [refs.newReport], 'switch follow-up must scope to the newly selected report');
  assert.ok(result.evidenceMatrix.every((row) => row.latestArtifactUsed === false), 'evidence matrix must prove selected refs, not latest artifact');

  const finalText = result.input.browserVisibleState.visibleAnswerText ?? '';
  assert.match(finalText, /selected refs audit/i);
  assert.doesNotMatch(finalText, /latest artifact used=true/i);
}

function verifierInput(workspaceState: WebE2eWorkspaceState): WebE2eContractVerifierInput {
  const session = workspaceState.sessionsByScenario[scenarioId];
  const expected = expectedProjection();
  const browserVisibleState: WebE2eBrowserVisibleState = {
    status: 'satisfied',
    visibleAnswerText: matrixAnswer,
    visibleArtifactRefs: [
      ...artifactDelivery().primaryArtifactRefs,
      ...artifactDelivery().supportingArtifactRefs,
    ],
    primaryArtifactRefs: artifactDelivery().primaryArtifactRefs,
    supportingArtifactRefs: artifactDelivery().supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
  };
  return {
    caseId: LITERATURE_CURRENT_AND_SELECTED_REPORT_CASE_ID,
    expected,
    browserVisibleState,
    kernelProjection: expected.conversationProjection,
    sessionBundle: { session, workspaceState },
    runAudit: runAudit(),
    artifactDeliveryManifest: {
      schemaVersion: 'sciforge.web-e2e.artifact-delivery-manifest.v1',
      caseId: LITERATURE_CURRENT_AND_SELECTED_REPORT_CASE_ID,
      runId: matrixRunId,
      artifactDelivery: artifactDelivery(),
    },
  };
}

function expectedProjection(): WebE2eExpectedProjection {
  const currentTurnRef = currentTurn(matrixTurnId, 'R-LIT-03 evidence matrix export');
  const explicitNewReport: WebE2eInitialRef = {
    id: 'ref-r-lit-03-new-report',
    kind: 'artifact',
    title: 'New selected literature report',
    ref: refs.newReport,
    source: 'explicit-selection',
    artifactType: 'research-report',
  };
  const explicitOldReport: WebE2eInitialRef = {
    id: 'ref-r-lit-03-old-report',
    kind: 'artifact',
    title: 'Old selected literature report',
    ref: refs.oldReport,
    source: 'seed-workspace',
    artifactType: 'research-report',
  };
  return {
    schemaVersion: 'sciforge.web-e2e.expected-projection.v1',
    projectionVersion: 'sciforge.conversation-projection.v1',
    caseId: LITERATURE_CURRENT_AND_SELECTED_REPORT_CASE_ID,
    sessionId,
    scenarioId,
    runId: matrixRunId,
    currentTask: {
      currentTurnRef,
      explicitRefs: [explicitNewReport],
      selectedRefs: [currentTurnRef, explicitNewReport, explicitOldReport],
    },
    conversationProjection: finalProjection(),
    artifactDelivery: artifactDelivery(),
    runAuditRefs: [
      refs.runAudit,
      refs.routeTrace,
      refs.selectedScopeAudit,
      refs.evidenceMatrix,
      refs.nextPapers,
    ],
    providerManifestRef,
  };
}

function workspaceStateForCase(
  searchQueries: string[],
  candidateList: LiteratureCandidate[],
  readStates: LiteratureReadState[],
  blockedReasons: BlockedReason[],
  selectedRefAudit: SelectedRefAudit,
  evidenceMatrix: EvidenceMatrixRow[],
  nextPapers: NextPaper[],
): WebE2eWorkspaceState {
  const artifacts = artifactsForCase(searchQueries, candidateList, readStates, blockedReasons, selectedRefAudit, evidenceMatrix, nextPapers);
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: 'R-LIT-01 and R-LIT-03 offline literature contract',
    createdAt: now,
    messages: [
      userMessage(latestTurnId, '检索今日或最新 agentic RL arXiv 论文，下载 PDF，阅读全文，写中文报告。', []),
      scenarioMessage('msg-r-lit-01-latest-agent', latestAnswer, latestRunId, [
        objectRef('r-lit-01-candidate-list', 'agentic RL arXiv candidate list', 'literature-search-results', 'supporting-evidence', latestRunId),
        objectRef('r-lit-01-chinese-report', '中文 agentic RL 文献报告', 'research-report', 'primary-deliverable', latestRunId),
      ]),
      userMessage(reorderTurnId, '按方法、环境/任务、证据强度、benchmark、局限性重排。', [objectRefFromRef(refs.chineseReport, latestRunId)]),
      scenarioMessage('msg-r-lit-01-reorder-agent', reorderAnswer, reorderRunId, [objectRefFromRef(refs.reorderedReport, reorderRunId)]),
      userMessage(exportTurnId, '导出 search queries、PDF/read 状态、blocked reasons 和 artifact path。', [objectRefFromRef(refs.reorderedReport, reorderRunId)]),
      scenarioMessage('msg-r-lit-01-export-agent', exportAnswer, exportRunId, [objectRefFromRef(refs.exportStatus, exportRunId)]),
      scenarioMessage('msg-r-lit-03-old-report-agent', '会话中已有旧 literature report，后续会显式选中它追问。', exportRunId, [objectRefFromRef(refs.oldReport, exportRunId)]),
      userMessage(oldFollowupTurnId, '选中旧报告，只回答它的 PDF/full-text evidence status。', [objectRefFromRef(refs.oldReport, exportRunId)]),
      scenarioMessage('msg-r-lit-03-old-followup-agent', oldFollowupAnswer, oldFollowupRunId, [objectRefFromRef(refs.oldFollowup, oldFollowupRunId)]),
      userMessage(switchFollowupTurnId, '切换选择到新报告，问同类 evidence status。', [objectRefFromRef(refs.newReport, latestRunId)]),
      scenarioMessage('msg-r-lit-03-switch-followup-agent', switchFollowupAnswer, switchFollowupRunId, [objectRefFromRef(refs.switchFollowup, switchFollowupRunId)]),
      userMessage(matrixTurnId, '导出 evidence matrix 和 next papers，并证明 selected refs 不是 latest artifact。', [
        objectRefFromRef(refs.oldReport, oldFollowupRunId),
        objectRefFromRef(refs.newReport, switchFollowupRunId),
      ]),
      scenarioMessage('msg-r-lit-03-matrix-agent', matrixAnswer, matrixRunId, [
        objectRefFromRef(refs.evidenceMatrix, matrixRunId),
        objectRefFromRef(refs.nextPapers, matrixRunId),
        objectRefFromRef(refs.selectedScopeAudit, matrixRunId),
      ]),
    ],
    runs: [
      run(latestRunId, latestTurnId, latestAnswer, latestProjection(), 'completed', {
        searchQueries,
        candidateList,
        readStates,
        blockedReasons,
        reportLanguage: 'zh-CN',
        reportArtifactPath: '.sciforge/artifacts/r-lit-01-chinese-report.md',
        live: false,
        fixtureLevel: true,
      }),
      run(reorderRunId, reorderTurnId, reorderAnswer, reorderProjection(), 'completed', {
        reorderAxes: ['methods', 'environments/tasks', 'evidence strength', 'benchmarks', 'limitations'],
      }),
      run(exportRunId, exportTurnId, exportAnswer, exportProjection(), 'completed', {
        live: false,
        cached: false,
        fixtureLevel: true,
        exportStatus: 'exported',
        artifactPath: '.sciforge/artifacts/r-lit-01-chinese-report.md',
        exportedRefs: [refs.searchQueries, refs.pdfReadState, refs.blockedReasons, refs.chineseReport],
      }),
      run(oldFollowupRunId, oldFollowupTurnId, oldFollowupAnswer, oldFollowupProjection(), 'completed', selectedRefAudit.oldFollowup),
      run(switchFollowupRunId, switchFollowupTurnId, switchFollowupAnswer, switchFollowupProjection(), 'completed', selectedRefAudit.switchFollowup),
      run(matrixRunId, matrixTurnId, matrixAnswer, finalProjection(), 'completed', { evidenceMatrix, nextPapers, selectedRefAudit }),
    ],
    uiManifest: [
      { componentId: 'report-viewer', title: 'R-LIT-03 evidence matrix', artifactRef: 'r-lit-03-evidence-matrix', priority: 1 },
      { componentId: 'next-papers', title: 'R-LIT-03 next papers', artifactRef: 'r-lit-03-next-papers', priority: 2 },
    ],
    claims: [],
    executionUnits: executionUnits(),
    artifacts,
    notebook: [],
    versions: [],
    updatedAt: now,
  };
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-r-lit-current-and-selected-report',
    sessionsByScenario: { [scenarioId]: session },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: executionUnits().map((unit) => ({
      id: `event:${unit.id}`,
      actor: 'Offline Web E2E Fixture',
      action: 'literature.contract.fixture',
      subject: unit.tool,
      artifactRefs: unit.outputArtifacts?.map((id) => `artifact:${id}`) ?? [],
      executionUnitRefs: [unit.id],
      beliefRefs: [],
      branchId: scenarioId,
      visibility: 'project-record',
      decisionStatus: 'not-a-decision',
      createdAt: now,
    })),
    updatedAt: now,
  };
}

function latestProjection(): ConversationProjection {
  return projection(latestRunId, latestTurnId, '检索今日或最新 agentic RL arXiv 论文，下载 PDF，阅读全文，写中文报告。', latestAnswer, [
    refs.searchQueries,
    refs.candidateList,
    refs.pdfReadState,
    refs.blockedReasons,
    refs.chineseReport,
  ], [refs.searchResultA, refs.paperAlphaText, refs.paperBetaText, refs.blockedGamma]);
}

function reorderProjection(): ConversationProjection {
  return projection(reorderRunId, reorderTurnId, '按方法、环境/任务、证据强度、benchmark、局限性重排。', reorderAnswer, [refs.reorderedReport], [
    refs.chineseReport,
    refs.pdfReadState,
  ]);
}

function exportProjection(): ConversationProjection {
  return projection(exportRunId, exportTurnId, '导出 search queries、PDF/read 状态、blocked reasons 和 artifact path。', exportAnswer, [refs.exportStatus], [
    refs.searchQueries,
    refs.pdfReadState,
    refs.blockedReasons,
    refs.chineseReport,
  ]);
}

function oldFollowupProjection(): ConversationProjection {
  return projection(oldFollowupRunId, oldFollowupTurnId, '选中旧报告，只回答它的 PDF/full-text evidence status。', oldFollowupAnswer, [refs.oldFollowup], [
    refs.oldReport,
    refs.selectedScopeAudit,
  ]);
}

function switchFollowupProjection(): ConversationProjection {
  return projection(switchFollowupRunId, switchFollowupTurnId, '切换选择到新报告，问同类 evidence status。', switchFollowupAnswer, [refs.switchFollowup], [
    refs.newReport,
    refs.selectedScopeAudit,
  ]);
}

function finalProjection(): ConversationProjection {
  return {
    ...projection(matrixRunId, matrixTurnId, '导出 evidence matrix 和 next papers，并证明 selected refs 不是 latest artifact。', matrixAnswer, [
      refs.evidenceMatrix,
      refs.nextPapers,
      refs.oldFollowup,
      refs.switchFollowup,
    ], [
      refs.oldReport,
      refs.newReport,
      refs.selectedScopeAudit,
      refs.runAudit,
      refs.routeTrace,
    ]),
    verificationState: {
      status: 'verified',
      verdict: 'supported',
      verifierRef: refs.selectedScopeAudit,
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
    visibleAnswer: { status: 'satisfied', text, artifactRefs },
    activeRun: { id: runId, status: 'satisfied' },
    artifacts: artifactRefs.map((ref) => ({ id: ref.replace(/^artifact:/, ''), type: 'literature-contract', ref })),
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

function artifactsForCase(
  searchQueries: string[],
  candidateList: LiteratureCandidate[],
  readStates: LiteratureReadState[],
  blockedReasons: BlockedReason[],
  selectedRefAudit: SelectedRefAudit,
  evidenceMatrix: EvidenceMatrixRow[],
  nextPapers: NextPaper[],
): RuntimeArtifact[] {
  return [
    artifact('r-lit-01-search-queries', 'literature-search-queries', 'R-LIT-01 search queries', latestRunId, 'internal', '.sciforge/artifacts/r-lit-01-search-queries.json', searchQueries, [refs.searchResultA]),
    artifact('r-lit-01-candidate-list', 'literature-candidates', 'R-LIT-01 arXiv candidates', latestRunId, 'internal', '.sciforge/artifacts/r-lit-01-candidate-list.json', candidateList, [refs.searchResultA]),
    artifact('r-lit-01-pdf-read-state', 'literature-read-state', 'R-LIT-01 PDF/read states', latestRunId, 'internal', '.sciforge/artifacts/r-lit-01-pdf-read-state.json', readStates, [refs.paperAlphaPdf, refs.paperAlphaText, refs.paperBetaPdf, refs.paperBetaText]),
    artifact('r-lit-01-blocked-reasons', 'blocked-reasons', 'R-LIT-01 blocked reasons', latestRunId, 'internal', '.sciforge/task-results/r-lit-01-blocked-reasons.json', blockedReasons, [refs.blockedGamma]),
    artifact('r-lit-01-chinese-report', 'research-report', 'R-LIT-01 中文 agentic RL 报告', latestRunId, 'internal', '.sciforge/artifacts/r-lit-01-chinese-report.md', { language: 'zh-CN', artifactPath: '.sciforge/artifacts/r-lit-01-chinese-report.md' }, [refs.candidateList, refs.pdfReadState]),
    artifact('r-lit-01-reordered-report', 'research-report', 'R-LIT-01 reordered Chinese report', reorderRunId, 'internal', '.sciforge/artifacts/r-lit-01-reordered-report.md', { reorderAxes: ['methods', 'environments/tasks', 'evidence strength', 'benchmarks', 'limitations'] }, [refs.chineseReport]),
    artifact('r-lit-01-export-status', 'literature-export-status', 'R-LIT-01 export status', exportRunId, 'internal', '.sciforge/task-results/r-lit-01-export-status.json', { live: false, cached: false, fixtureLevel: true, exportStatus: 'exported' }, [refs.reorderedReport]),
    artifact('r-lit-03-old-report', 'research-report', 'R-LIT-03 old selected report', exportRunId, 'internal', '.sciforge/artifacts/r-lit-03-old-report.md', { evidenceStatus: 'old selected report fulltext read' }, []),
    artifact('r-lit-03-new-report', 'research-report', 'R-LIT-03 new selected report', latestRunId, 'internal', '.sciforge/artifacts/r-lit-03-new-report.md', { evidenceStatus: 'new report from current session' }, [refs.chineseReport]),
    artifact('r-lit-03-old-followup', 'selected-report-followup', 'R-LIT-03 old report follow-up', oldFollowupRunId, 'supporting-evidence', '.sciforge/artifacts/r-lit-03-old-followup.md', selectedRefAudit.oldFollowup, [refs.oldReport]),
    artifact('r-lit-03-switch-followup', 'selected-report-followup', 'R-LIT-03 switched report follow-up', switchFollowupRunId, 'supporting-evidence', '.sciforge/artifacts/r-lit-03-switch-followup.md', selectedRefAudit.switchFollowup, [refs.newReport]),
    artifact('r-lit-03-evidence-matrix', 'literature-evidence-matrix', 'R-LIT-03 evidence matrix', matrixRunId, 'primary-deliverable', '.sciforge/artifacts/r-lit-03-evidence-matrix.json', evidenceMatrix, [refs.oldFollowup, refs.switchFollowup]),
    artifact('r-lit-03-next-papers', 'literature-next-papers', 'R-LIT-03 next papers', matrixRunId, 'supporting-evidence', '.sciforge/artifacts/r-lit-03-next-papers.json', nextPapers, [refs.evidenceMatrix]),
    artifact('r-lit-03-selected-scope-audit', 'selected-ref-audit', 'R-LIT-03 selected refs audit', matrixRunId, 'audit', '.sciforge/task-results/r-lit-03-selected-scope-audit.json', selectedRefAudit, [refs.oldReport, refs.newReport]),
    artifact('r-lit-current-selected-route-trace', 'provider-route-trace', 'R-LIT route trace', matrixRunId, 'audit', '.sciforge/task-results/r-lit-current-selected-route-trace.json', routeTrace(), [providerManifestRef]),
    artifact('r-lit-current-selected-run-audit', 'run-audit', 'R-LIT run audit', matrixRunId, 'audit', '.sciforge/task-results/r-lit-current-selected-run-audit.json', runAudit(), [refs.evidenceMatrix, refs.nextPapers, refs.selectedScopeAudit]),
  ];
}

function artifact(
  id: string,
  type: string,
  title: string,
  runId: string,
  role: NonNullable<RuntimeArtifact['delivery']>['role'],
  dataRef: string,
  payload: unknown,
  evidenceRefs: string[],
): RuntimeArtifact {
  const isMarkdown = dataRef.endsWith('.md');
  return {
    id,
    type,
    producerScenario: scenarioId,
    schemaVersion: '1',
    metadata: {
      title,
      path: dataRef,
      runId,
      payload,
      evidenceRefs,
      ...(isRecord(payload) ? payload : {}),
    },
    dataRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role,
      declaredMediaType: isMarkdown ? 'text/markdown' : 'application/json',
      declaredExtension: isMarkdown ? 'md' : 'json',
      contentShape: 'raw-file',
      readableRef: role === 'audit' || role === 'diagnostic' ? undefined : dataRef,
      rawRef: dataRef,
      previewPolicy: role === 'audit' || role === 'diagnostic' ? 'audit-only' : 'inline',
    },
    visibility: 'project-record',
  };
}

function artifactDelivery(): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: [refs.evidenceMatrix],
    supportingArtifactRefs: [refs.oldFollowup, refs.switchFollowup, refs.nextPapers],
    auditRefs: [refs.selectedScopeAudit, refs.routeTrace, refs.runAudit],
    diagnosticRefs: [],
    internalRefs: [
      refs.searchQueries,
      refs.candidateList,
      refs.pdfReadState,
      refs.blockedReasons,
      refs.chineseReport,
      refs.reorderedReport,
      refs.exportStatus,
      refs.oldReport,
      refs.newReport,
    ],
  };
}

function runAudit(): WebE2eRunAuditEvidence {
  return {
    runId: matrixRunId,
    refs: [
      refs.runAudit,
      refs.routeTrace,
      refs.selectedScopeAudit,
      refs.evidenceMatrix,
      refs.nextPapers,
      providerManifestRef,
    ],
    providerManifestRef,
    currentTurnRef: `message:${matrixTurnId}`,
    explicitRefs: [refs.newReport],
    status: 'completed',
  };
}

function routeTrace(): JsonRecord[] {
  return [
    {
      eventId: 'route:r-lit-01:arxiv-search',
      runId: latestRunId,
      providerId: 'offline-fixture.arxiv-search',
      capabilityId: 'web_search',
      status: 'fixture-only',
      evidenceRefs: [refs.searchResultA, refs.searchQueries, refs.candidateList],
    },
    {
      eventId: 'route:r-lit-01:pdf-read',
      runId: latestRunId,
      providerId: 'offline-fixture.read-ref',
      capabilityId: 'read_ref',
      status: 'fixture-only',
      evidenceRefs: [refs.paperAlphaText, refs.paperBetaText, refs.blockedGamma],
    },
  ];
}

function executionUnits(): RuntimeExecutionUnit[] {
  return [
    executionUnit('EU-r-lit-01-search', latestRunId, 'offline-fixture.arxiv-search', refs.candidateList, ['r-lit-01-search-queries', 'r-lit-01-candidate-list']),
    executionUnit('EU-r-lit-01-read', latestRunId, 'offline-fixture.read-ref', refs.pdfReadState, ['r-lit-01-pdf-read-state', 'r-lit-01-blocked-reasons']),
    executionUnit('EU-r-lit-01-reorder', reorderRunId, 'offline-fixture.report-reorder', refs.reorderedReport, ['r-lit-01-reordered-report']),
    executionUnit('EU-r-lit-01-export', exportRunId, 'offline-fixture.export-status', refs.exportStatus, ['r-lit-01-export-status']),
    executionUnit('EU-r-lit-03-old-selected', oldFollowupRunId, 'offline-fixture.selected-ref-reader', refs.oldFollowup, ['r-lit-03-old-followup']),
    executionUnit('EU-r-lit-03-switch-selected', switchFollowupRunId, 'offline-fixture.selected-ref-reader', refs.switchFollowup, ['r-lit-03-switch-followup']),
    executionUnit('EU-r-lit-03-matrix', matrixRunId, 'offline-fixture.evidence-matrix', refs.evidenceMatrix, ['r-lit-03-evidence-matrix', 'r-lit-03-next-papers']),
  ];
}

function executionUnit(id: string, runId: string, tool: string, outputRef: string, outputArtifacts: string[]): RuntimeExecutionUnit {
  return {
    id,
    tool,
    params: 'offlineFixture=true live=false',
    status: 'done',
    hash: digestJson({ id, runId, tool, outputRef, outputArtifacts }),
    runId,
    outputRef,
    outputArtifacts,
    time: now,
  };
}

function run(
  id: string,
  turnId: string,
  response: string,
  conversationProjection: ConversationProjection,
  status: SciForgeRun['status'],
  output: unknown,
): SciForgeRun {
  return {
    id,
    scenarioId,
    prompt: conversationProjection.currentTurn?.prompt ?? '',
    status,
    createdAt: now,
    completedAt: now,
    response,
    raw: {
      fixtureOutput: output,
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

function userMessage(id: string, text: string, refsForMessage: ObjectReference[]): SciForgeMessage {
  return {
    id,
    role: 'user',
    content: text,
    createdAt: now,
    status: 'completed',
    objectReferences: refsForMessage,
  };
}

function scenarioMessage(id: string, text: string, runId: string, refsForMessage: ObjectReference[]): SciForgeMessage {
  return {
    id,
    role: 'scenario',
    content: text,
    createdAt: now,
    status: 'completed',
    provenance: {
      source: 'offline-web-e2e-fixture',
      runId,
    },
    objectReferences: refsForMessage,
  };
}

function objectRefFromRef(ref: string, runId: string): ObjectReference {
  const id = ref.replace(/^artifact:/, '');
  return objectRef(id, id, 'research-report', 'supporting-evidence', runId);
}

function objectRef(
  id: string,
  title: string,
  artifactType: string,
  role: NonNullable<ObjectReference['presentationRole']>,
  runId: string,
): ObjectReference {
  return {
    id: `object-${id}`,
    kind: 'artifact',
    title,
    ref: `artifact:${id}`,
    artifactType,
    runId,
    presentationRole: role,
    preferredView: artifactType === 'research-report' ? 'report-viewer' : 'record-table',
    actions: ['focus-right-pane', 'copy-path'],
    status: 'available',
  };
}

function runFixtureOutput(run: SciForgeRun | undefined): JsonRecord | undefined {
  const raw = isRecord(run?.raw) ? run.raw : undefined;
  return isRecord(raw?.fixtureOutput) ? raw.fixtureOutput as JsonRecord : undefined;
}

function currentTurn(turnId: string, title: string): WebE2eInitialRef {
  return {
    id: `ref-${turnId}`,
    kind: 'user-turn',
    title,
    ref: `message:${turnId}`,
    source: 'current-turn',
  };
}

function artifactByRef(session: SciForgeSession, ref: string): RuntimeArtifact {
  const id = ref.replace(/^artifact:/, '');
  const artifactMatch = session.artifacts.find((candidate) => candidate.id === id);
  assert.ok(artifactMatch, `missing artifact ${ref}`);
  return artifactMatch;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
