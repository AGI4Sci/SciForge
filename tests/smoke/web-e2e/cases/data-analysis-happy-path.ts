import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type {
  ArtifactDeliveryRole,
  ObjectReference,
  RuntimeArtifact,
  RuntimeExecutionUnit,
  SciForgeRun,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';
import type { ConversationProjection, ConversationRef } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eArtifactDeliveryManifest,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
  type WebE2eRunAuditEvidence,
} from '../contract-verifier.js';
import {
  createWebE2eEvidenceBundleManifest,
  type WebE2eEvidenceBundleManifest,
  type WebE2eRunEvidence,
} from '../evidence-bundle.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import { startScriptableAgentServerMock } from '../scriptable-agentserver-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerToolPayload,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
} from '../types.js';

export const DATA_ANALYSIS_HAPPY_PATH_CASE_ID = 'SA-WEB-16';

export interface DataAnalysisHappyPathResult {
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  runs: MockRunFetchResult[];
  recordedRunRequests: JsonRecord[];
  readRefCalls: JsonRecord[];
  largeCsv: LargeCsvFixture;
  markdownExportRef: string;
  codeRefs: string[];
  browserVisibleState: WebE2eBrowserVisibleState;
  runAudit: WebE2eRunAuditEvidence;
  artifactDeliveryManifest: WebE2eArtifactDeliveryManifest;
  verifierInput: WebE2eContractVerifierInput;
  evidenceBundle: WebE2eEvidenceBundleManifest;
}

interface MockRunFetchResult {
  envelopes: JsonRecord[];
  events: JsonRecord[];
  resultRun: JsonRecord;
}

interface LargeCsvFixture {
  ref: string;
  relPath: string;
  absolutePath: string;
  digest: string;
  sizeBytes: number;
  sentinel: string;
  rowCount: number;
}

type DataAnalysisRound = 'summary' | 'regroup' | 'outliers-export';

const now = '2026-05-16T00:00:00.000Z';
const sessionId = 'session-sa-web-16';
const scenarioId = 'scenario-sa-web-16';
const runId = 'run-sa-web-16-final';
const readRefTool = 'workspace.reader.read_ref';
const markdownExportRef = 'artifact:sa-web-16-report-md';
const codeArtifactRef = 'artifact:sa-web-16-analysis-code';
const codeFileRef = 'file:.sciforge/tasks/data-analysis-happy-path.py';

const roundPrompts: Record<DataAnalysisRound, string> = {
  summary: '上传并引用这个 CSV，先给出摘要统计。',
  regroup: '把分组从 treatment 改成 cohort，重新汇总。',
  'outliers-export': '解释异常值，并导出 markdown 报告和分析代码引用。',
};

export async function runDataAnalysisHappyPathCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<DataAnalysisHappyPathResult> {
  const fixedNow = options.now ?? now;
  const server = await startScriptableAgentServerMock({
    seed: DATA_ANALYSIS_HAPPY_PATH_CASE_ID,
    fixedNow,
    script: (request, exchange) => scriptForRound(roundFromRequest(request), request, exchange.requestIndex, fixedNow),
    discovery: {
      providers: [{
        id: 'sciforge.workspace-reader.read_ref',
        providerId: 'sciforge.workspace-reader.read_ref',
        capabilityId: 'read_ref',
        workerId: 'sciforge.workspace-reader',
        status: 'available',
      }],
    },
  });

  try {
    const fixture = await buildWebE2eFixtureWorkspace({
      caseId: DATA_ANALYSIS_HAPPY_PATH_CASE_ID,
      baseDir: options.baseDir,
      scenarioId,
      sessionId,
      runId,
      now: fixedNow,
      title: 'Data analysis happy path Web E2E case',
      prompt: roundPrompts.summary,
      agentServerBaseUrl: server.baseUrl,
      providerCapabilities: [{
        id: 'sciforge.workspace-reader.read_ref',
        providerId: 'sciforge.workspace-reader.read_ref',
        capabilityId: 'read_ref',
        workerId: 'sciforge.workspace-reader',
        status: 'available',
        fixtureMode: 'scripted-mock',
      }],
    });
    const largeCsv = await writeLargeCsvFixture(fixture.workspacePath);
    await materializeDataAnalysisArtifacts(fixture.workspacePath, largeCsv);
    finalizeDataAnalysisFixture(fixture, largeCsv, fixedNow);

    const runs: MockRunFetchResult[] = [];
    for (const round of ['summary', 'regroup', 'outliers-export'] as const satisfies readonly DataAnalysisRound[]) {
      runs.push(await fetchRun(server.baseUrl, requestForRound(fixture, largeCsv, round)));
    }

    const recordedRunRequests = server.requests.runs.map((request) => request.body);
    const readRefCalls = runs.flatMap((run) => run.events).filter((event) => event.tool === readRefTool);
    const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
    const browserVisibleState = browserVisibleStateFromExpected(fixture.expectedProjection);
    const runAudit = runAuditFromSession(session, fixture.expectedProjection);
    const artifactDeliveryManifest = artifactDeliveryManifestFromSession(session, fixture.expectedProjection);
    const verifierInput: WebE2eContractVerifierInput = {
      caseId: fixture.caseId,
      expected: fixture.expectedProjection,
      browserVisibleState,
      kernelProjection: fixture.expectedProjection.conversationProjection,
      sessionBundle: { session, workspaceState: fixture.workspaceState },
      runAudit,
      artifactDeliveryManifest,
    };
    assertWebE2eContract(verifierInput);

    const evidenceBundle = createWebE2eEvidenceBundleManifest({
      caseId: fixture.caseId,
      generatedAt: fixedNow,
      outputRoot: options.outputRoot,
      runs: runs.map((run, index): WebE2eRunEvidence => ({
        runId: String(run.resultRun.id ?? `run-sa-web-16-${index + 1}`),
        eventIds: run.events.map((event) => String(event.id)).filter(Boolean),
        requestDigest: server.requests.runs[index]?.digest,
        resultDigest: String(run.resultRun.digest ?? ''),
        status: String(run.resultRun.status ?? ''),
      })),
      projection: {
        projectionVersion: fixture.expectedProjection.projectionVersion,
        terminalState: fixture.expectedProjection.conversationProjection.visibleAnswer?.status,
      },
      note: {
        status: 'passed',
        summary: 'CSV data analysis completed through refs/read_ref across summary, regrouping, outlier explanation, markdown export, and code refs.',
      },
      extra: {
        largeCsvRef: largeCsv.ref,
        largeCsvDigest: largeCsv.digest,
        largeCsvSizeBytes: largeCsv.sizeBytes,
        readRefTool,
        readRefCalls: readRefCalls.map((event) => event.input).filter(isRecord),
        markdownExportRef,
        codeRefs: [codeArtifactRef, codeFileRef],
      },
    });

    const result: DataAnalysisHappyPathResult = {
      fixture,
      server,
      runs,
      recordedRunRequests,
      readRefCalls,
      largeCsv,
      markdownExportRef,
      codeRefs: [codeArtifactRef, codeFileRef],
      browserVisibleState,
      runAudit,
      artifactDeliveryManifest,
      verifierInput,
      evidenceBundle,
    };
    await assertDataAnalysisHappyPath(result);
    return result;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function assertDataAnalysisHappyPath(result: DataAnalysisHappyPathResult): Promise<void> {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.equal(result.recordedRunRequests.length, 3, 'data analysis happy path should have three user turns');
  assert.equal(result.readRefCalls.length, 3, 'each round must read the large CSV through read_ref');
  assert.ok(result.largeCsv.sizeBytes > 32_000, 'large CSV fixture must be large enough to exercise refs-first reads');

  const csvText = await readFile(result.largeCsv.absolutePath, 'utf8');
  assert.match(csvText, new RegExp(result.largeCsv.sentinel), 'large CSV fixture must contain the sentinel that raw prompts must not carry');
  assert.doesNotMatch(JSON.stringify(result.recordedRunRequests), new RegExp(result.largeCsv.sentinel), 'raw AgentServer requests must not contain large CSV contents');
  assert.doesNotMatch(JSON.stringify(result.recordedRunRequests), /sample_0719,rare_cell,omega/i, 'raw AgentServer requests must not contain CSV rows');

  for (const request of result.recordedRunRequests) {
    assert.equal(request.csvRef, result.largeCsv.ref);
    assert.equal(request.rawCsv, undefined);
    assert.equal(request.inlineCsv, undefined);
    assert.equal(request.largeFilePolicy, 'ref-only');
    const readRefs = request.readRefs;
    assert.ok(Array.isArray(readRefs), 'request must include readRefs');
    assert.equal(readRefs.includes(result.largeCsv.ref), true, 'request readRefs must include the uploaded CSV ref');
    assert.ok(!String(request.prompt ?? '').includes(result.largeCsv.sentinel), 'prompt must not inline large CSV data');
  }

  for (const call of result.readRefCalls) {
    assert.equal(readRefInput(call).ref, result.largeCsv.ref);
    assert.equal(readRefInput(call).mode, 'bounded-preview');
  }

  const finalPayload = toolPayloadFromRun(result.runs.at(-1)?.resultRun);
  assert.ok(finalPayload, 'final round must return a tool payload');
  assert.equal(result.browserVisibleState.primaryArtifactRefs?.includes(result.markdownExportRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(codeArtifactRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.some((ref) => ref === 'artifact:sa-web-16-large-csv'), true);
  assert.equal(result.runAudit.refs.includes(codeFileRef), true, 'RunAudit must retain the concrete code file ref');

  const exportedMarkdown = await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/data-analysis-report.md'), 'utf8');
  assert.match(exportedMarkdown, /grouping: cohort/i);
  assert.match(exportedMarkdown, /sample_0719/i);
  assert.match(exportedMarkdown, /file:\.sciforge\/tasks\/data-analysis-happy-path\.py/);

  const finalArtifacts = Array.isArray(finalPayload.artifacts) ? finalPayload.artifacts : [];
  assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === markdownExportRef), 'final payload must expose markdown export ref');
  assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === codeArtifactRef), 'final payload must expose code artifact ref');
}

export async function closeDataAnalysisHappyPathCase(result: DataAnalysisHappyPathResult): Promise<void> {
  await result.server.close();
}

function requestForRound(fixture: WebE2eFixtureWorkspace, csv: LargeCsvFixture, round: DataAnalysisRound): JsonRecord {
  return {
    caseId: DATA_ANALYSIS_HAPPY_PATH_CASE_ID,
    sessionId: fixture.sessionId,
    scenarioId: fixture.scenarioId,
    round,
    prompt: roundPrompts[round],
    csvRef: csv.ref,
    csvDigest: csv.digest,
    csvSizeBytes: csv.sizeBytes,
    readRefs: [csv.ref],
    largeFilePolicy: 'ref-only',
    requiredTool: readRefTool,
    currentTask: {
      currentTurnRef: refForRequest(fixture.expectedProjection.currentTask.currentTurnRef),
      explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map(refForRequest),
      selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map(refForRequest),
    },
    analysisPlan: {
      summary: round === 'summary',
      grouping: round === 'summary' ? 'treatment' : 'cohort',
      explainOutliers: round === 'outliers-export',
      exportMarkdown: round === 'outliers-export',
      exportCodeRefs: round === 'outliers-export',
    },
  };
}

function scriptForRound(round: DataAnalysisRound, request: JsonRecord, index: number, fixedNow: string) {
  const csvRef = String(request.csvRef ?? '');
  const readEvent = {
    kind: 'event' as const,
    event: {
      type: 'tool-call',
      tool: readRefTool,
      input: {
        ref: csvRef,
        mode: 'bounded-preview',
        byteRange: [0, 8192],
        purpose: `data-analysis-${round}`,
      },
    },
  };
  return {
    id: `sa-web-16-${round}`,
    runId: `run-sa-web-16-${String(index + 1).padStart(2, '0')}-${round}`,
    steps: [
      { kind: 'status' as const, status: 'running', message: `Reading CSV by ref for ${round}.` },
      readEvent,
      { kind: 'toolPayload' as const, payload: toolPayloadForRound(round, csvRef, fixedNow) },
    ],
  };
}

function toolPayloadForRound(round: DataAnalysisRound, csvRef: string, fixedNow: string): ScriptableAgentServerToolPayload {
  const base = {
    confidence: 0.89,
    claimType: 'fact',
    evidenceLevel: 'scriptable-agentserver-data-analysis',
    claims: [{
      id: `claim-sa-web-16-${round}`,
      text: `Round ${round} used ${csvRef} through read_ref.`,
      refs: [csvRef],
      createdAt: fixedNow,
    }],
  };
  if (round === 'summary') {
    return {
      ...base,
      message: '摘要统计完成：720 rows, mean value 14.8, missing rate 0.7%，输入 CSV 仅通过 read_ref 读取。',
      reasoningTrace: 'SA-WEB-16 summary round consumed file refs instead of raw CSV prompt data.',
      uiManifest: [{ componentId: 'record-table', title: 'Summary statistics', artifactRef: 'sa-web-16-summary-stats', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-16-summary', tool: 'workspace.reader.read_ref', status: 'done', outputRef: csvRef }],
      artifacts: [{ id: 'sa-web-16-summary-stats', deliveryRef: 'artifact:sa-web-16-summary-stats' }],
    };
  }
  if (round === 'regroup') {
    return {
      ...base,
      message: '已按 cohort 重新分组：A/B/C 三组均有足够样本，cohort B 的均值最高。',
      reasoningTrace: 'SA-WEB-16 regroup round changed grouping from treatment to cohort using the same read_ref CSV.',
      uiManifest: [{ componentId: 'record-table', title: 'Grouped by cohort', artifactRef: 'sa-web-16-grouped-stats', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-16-regroup', tool: 'analysis.groupby', status: 'done', outputRef: 'artifact:sa-web-16-grouped-stats' }],
      artifacts: [{ id: 'sa-web-16-grouped-stats', deliveryRef: 'artifact:sa-web-16-grouped-stats' }],
    };
  }
  return {
    ...base,
    message: '异常值解释完成：sample_0719 来自 rare_cell/omega 分组，应保留并在报告中标注；已导出 markdown 和代码引用。',
    reasoningTrace: 'SA-WEB-16 final round exported markdown plus code refs after bounded read_ref access to the large CSV.',
    uiManifest: [
      { componentId: 'report-viewer', title: 'Data analysis report', artifactRef: 'sa-web-16-report-md', priority: 1 },
      { componentId: 'code-viewer', title: 'Analysis code', artifactRef: 'sa-web-16-analysis-code', priority: 2 },
    ],
    executionUnits: [{
      id: 'EU-sa-web-16-export',
      tool: 'analysis.export.markdown',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/data-analysis-report.md',
      outputArtifacts: ['sa-web-16-report-md', 'sa-web-16-analysis-code'],
      codeRefs: [codeFileRef],
    }],
    artifacts: [
      { id: 'sa-web-16-report-md', deliveryRef: markdownExportRef, dataRef: '.sciforge/task-results/data-analysis-report.md' },
      { id: 'sa-web-16-analysis-code', deliveryRef: codeArtifactRef, dataRef: '.sciforge/tasks/data-analysis-happy-path.py' },
    ],
  };
}

async function writeLargeCsvFixture(workspacePath: string): Promise<LargeCsvFixture> {
  const relPath = '.sciforge/artifacts/sa-web-16-large-observations.csv';
  const absolutePath = join(workspacePath, relPath);
  const sentinel = 'SA_WEB_16_RAW_PROMPT_SENTINEL_OMEGA';
  const rows = ['sample_id,cell_type,cohort,treatment,value,z_score,note'];
  for (let index = 0; index < 719; index += 1) {
    const cohort = ['A', 'B', 'C'][index % 3];
    const treatment = index % 2 === 0 ? 'drug' : 'control';
    const value = 10 + (index % 19) * 0.7;
    rows.push(`sample_${String(index).padStart(4, '0')},t_cell,${cohort},${treatment},${value.toFixed(2)},${((value - 14.8) / 2.1).toFixed(2)},ordinary`);
  }
  rows.push(`sample_0719,rare_cell,omega,drug,99.90,12.40,${sentinel}`);
  const content = `${rows.join('\n')}\n`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  const fileStat = await stat(absolutePath);
  return {
    ref: `file:${relPath}`,
    relPath,
    absolutePath,
    digest: digestText(content),
    sizeBytes: fileStat.size,
    sentinel,
    rowCount: rows.length - 1,
  };
}

async function materializeDataAnalysisArtifacts(workspacePath: string, csv: LargeCsvFixture): Promise<void> {
  await mkdir(join(workspacePath, '.sciforge/task-results'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/tasks'), { recursive: true });
  await writeJson(join(workspacePath, '.sciforge/task-results/data-analysis-summary.json'), {
    schemaVersion: 'sciforge.web-e2e.data-analysis-summary.v1',
    inputRef: csv.ref,
    rowCount: csv.rowCount,
    numericColumns: ['value', 'z_score'],
    summary: {
      value: { mean: 14.8, min: 10.0, max: 99.9 },
      missingRate: 0.007,
    },
  });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/data-analysis-grouped-by-cohort.csv'),
    'cohort,n,mean_value,outlier_count\nA,240,14.3,0\nB,240,15.2,0\nC,239,14.9,0\nomega,1,99.9,1\n',
    'utf8',
  );
  await writeFile(
    join(workspacePath, '.sciforge/task-results/data-analysis-report.md'),
    [
      '# SA-WEB-16 Data Analysis Report',
      '',
      `input: ${csv.ref}`,
      'summary: 720 observations; mean value 14.8; missing rate 0.7%.',
      'grouping: cohort',
      'outlier: sample_0719 belongs to rare_cell/omega and is retained with an explicit annotation.',
      `code: ${codeFileRef}`,
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workspacePath, '.sciforge/tasks/data-analysis-happy-path.py'),
    [
      'import pandas as pd',
      '',
      "csv_ref = '.sciforge/artifacts/sa-web-16-large-observations.csv'",
      'df = pd.read_csv(csv_ref)',
      "summary = df.groupby('cohort')['value'].agg(['count', 'mean', 'max'])",
      "outliers = df[df['z_score'].abs() > 3]",
      "print(summary.to_markdown())",
      "print(outliers[['sample_id', 'cell_type', 'cohort', 'value', 'z_score']].to_markdown(index=False))",
      '',
    ].join('\n'),
    'utf8',
  );
}

function finalizeDataAnalysisFixture(fixture: WebE2eFixtureWorkspace, csv: LargeCsvFixture, fixedNow: string): void {
  const csvInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-16-large-csv',
    kind: 'file',
    title: 'Uploaded observations CSV',
    ref: csv.ref,
    source: 'explicit-selection',
    artifactType: 'data-table',
    digest: csv.digest,
  };
  fixture.initialRefs.push(csvInitialRef);
  fixture.expectedProjection.currentTask.explicitRefs = [csvInitialRef];
  fixture.expectedProjection.currentTask.selectedRefs = [
    fixture.expectedProjection.currentTask.currentTurnRef,
    csvInitialRef,
  ];

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const artifacts = dataAnalysisArtifacts(fixture.scenarioId, fixture.runId, csv);
  const objectReferences = dataAnalysisObjectReferences(fixture.runId, csv);
  const projection = dataAnalysisProjection(fixture.expectedProjection, artifacts, csv, fixedNow);
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.artifactDelivery = artifactDeliveryProjection(artifacts);
  fixture.expectedProjection.runAuditRefs = uniqueStrings([
    'artifact:sa-web-16-run-audit',
    'artifact:sa-web-16-diagnostic-log',
    'agentserver://sa-web-16/read-ref/summary',
    'agentserver://sa-web-16/read-ref/regroup',
    'agentserver://sa-web-16/read-ref/outliers-export',
    codeFileRef,
  ]);

  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = dataAnalysisSession({
    session,
    projection,
    artifacts,
    objectReferences,
    csv,
    fixedNow,
  });
}

function dataAnalysisSession(input: {
  session: SciForgeSession;
  projection: ConversationProjection;
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
  csv: LargeCsvFixture;
  fixedNow: string;
}): SciForgeSession {
  const run = input.session.runs[0];
  const nextRun: SciForgeRun = {
    ...(run ?? {
      id: runId,
      scenarioId,
      createdAt: input.fixedNow,
    }),
    id: runId,
    scenarioId,
    status: 'completed',
    prompt: roundPrompts['outliers-export'],
    response: input.projection.visibleAnswer?.text ?? 'Data analysis completed.',
    completedAt: input.fixedNow,
    objectReferences: input.objectReferences,
    raw: {
      displayIntent: {
        primaryGoal: 'Render data analysis happy path from Projection and refs-first artifacts.',
        source: 'agentserver',
        conversationProjection: input.projection,
        taskOutcomeProjection: {
          conversationProjection: input.projection,
          projectionRestore: {
            source: 'conversation-event-log',
            eventCount: input.projection.executionProcess.length,
          },
        },
      },
      resultPresentation: {
        conversationProjection: input.projection,
      },
    },
  };
  return {
    ...input.session,
    title: 'Data analysis happy path Web E2E case',
    messages: input.session.messages.map((message) => {
      if (message.role === 'user') {
        return {
          ...message,
          content: roundPrompts.summary,
          objectReferences: input.objectReferences.filter((ref) => ref.ref === input.csv.ref),
        };
      }
      if (message.role === 'scenario') {
        return {
          ...message,
          content: input.projection.visibleAnswer?.text ?? 'Data analysis completed.',
          objectReferences: input.objectReferences.filter((ref) => ref.presentationRole !== 'audit' && ref.presentationRole !== 'diagnostic' && ref.presentationRole !== 'internal'),
          status: 'completed',
        };
      }
      return message;
    }),
    runs: [nextRun],
    uiManifest: [
      { componentId: 'report-viewer', title: 'Data analysis report', artifactRef: 'sa-web-16-report-md', priority: 1 },
      { componentId: 'record-table', title: 'Grouped by cohort', artifactRef: 'sa-web-16-grouped-stats', priority: 2 },
      { componentId: 'code-viewer', title: 'Analysis code', artifactRef: 'sa-web-16-analysis-code', priority: 3 },
    ],
    executionUnits: dataAnalysisExecutionUnits(input.fixedNow),
    artifacts: input.artifacts,
    updatedAt: input.fixedNow,
  };
}

function dataAnalysisProjection(
  expected: WebE2eExpectedProjection,
  artifacts: RuntimeArtifact[],
  csv: LargeCsvFixture,
  fixedNow: string,
): ConversationProjection {
  const artifactRefs = artifacts
    .filter((artifact) => artifact.delivery?.role === 'primary-deliverable' || artifact.delivery?.role === 'supporting-evidence')
    .map((artifact): ConversationRef => ({
      ref: artifact.delivery?.ref ?? `artifact:${artifact.id}`,
      mime: artifact.delivery?.declaredMediaType,
      label: String(artifact.metadata?.title ?? artifact.id),
      sizeBytes: artifact.id === 'sa-web-16-large-csv' ? csv.sizeBytes : undefined,
    }));
  return {
    ...expected.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: '已完成 CSV 多轮分析：先用 read_ref 读取上传 CSV 做摘要统计，再把分组改为 cohort，最后解释 sample_0719 异常值并导出 markdown 报告和 Python 代码引用。',
      artifactRefs: [markdownExportRef, codeArtifactRef, csv.ref],
    },
    activeRun: { id: expected.runId, status: 'satisfied' },
    artifacts: artifactRefs,
    executionProcess: [
      {
        eventId: 'sa-web-16-summary',
        type: 'OutputMaterialized',
        summary: 'Summary statistics computed from uploaded CSV via read_ref.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-16-regroup',
        type: 'OutputMaterialized',
        summary: 'Grouping changed from treatment to cohort.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-16-outliers-export',
        type: 'Satisfied',
        summary: 'Outlier explanation plus markdown and code refs exported.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs: [
      'artifact:sa-web-16-run-audit',
      'artifact:sa-web-16-diagnostic-log',
      'agentserver://sa-web-16/read-ref/summary',
      'agentserver://sa-web-16/read-ref/regroup',
      'agentserver://sa-web-16/read-ref/outliers-export',
      codeFileRef,
    ],
    diagnostics: [{
      severity: 'info',
      code: 'outlier-explained',
      message: 'sample_0719 is a valid rare_cell/omega outlier retained in the exported markdown report.',
      refs: [{ ref: csv.ref }, { ref: markdownExportRef }, { ref: codeFileRef }],
    }],
  };
}

function dataAnalysisArtifacts(scenario: string, run: string, csv: LargeCsvFixture): RuntimeArtifact[] {
  return [
    artifact('sa-web-16-large-csv', 'data-table', scenario, run, 'Uploaded observations CSV', csv.relPath, 'supporting-evidence', 'text/csv', 'csv', 'raw-file', 'open-system'),
    artifact('sa-web-16-summary-stats', 'summary-statistics', scenario, run, 'Summary statistics JSON', '.sciforge/task-results/data-analysis-summary.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-16-grouped-stats', 'grouped-statistics-table', scenario, run, 'Grouped by cohort CSV', '.sciforge/task-results/data-analysis-grouped-by-cohort.csv', 'supporting-evidence', 'text/csv', 'csv'),
    artifact('sa-web-16-report-md', 'data-analysis-report', scenario, run, 'Data analysis markdown export', '.sciforge/task-results/data-analysis-report.md', 'primary-deliverable', 'text/markdown', 'md'),
    artifact('sa-web-16-analysis-code', 'analysis-code', scenario, run, 'Data analysis Python code', '.sciforge/tasks/data-analysis-happy-path.py', 'supporting-evidence', 'text/x-python', 'py', 'raw-file', 'open-system'),
    artifact('sa-web-16-run-audit', 'run-audit', scenario, run, 'Data analysis RunAudit', '.sciforge/task-results/current-run-audit.json', 'audit', 'application/json', 'json', 'raw-file', 'audit-only'),
    artifact('sa-web-16-diagnostic-log', 'diagnostic-log', scenario, run, 'Data analysis diagnostic log', '.sciforge/logs/current-run.stderr.log', 'diagnostic', 'text/plain', 'log', 'raw-file', 'audit-only'),
    artifact('sa-web-16-provider-manifest', 'provider-manifest', scenario, run, 'Provider manifest', '.sciforge/provider-manifest.json', 'internal', 'application/json', 'json', 'raw-file', 'unsupported'),
  ];
}

function artifact(
  id: string,
  type: string,
  scenario: string,
  run: string,
  title: string,
  dataRef: string,
  role: ArtifactDeliveryRole,
  mediaType: string,
  extension: string,
  contentShape: RuntimeArtifact['delivery'] extends infer Delivery ? Delivery extends { contentShape: infer Shape } ? Shape : never : never = 'raw-file',
  previewPolicy: RuntimeArtifact['delivery'] extends infer Delivery ? Delivery extends { previewPolicy: infer Policy } ? Policy : never : never = 'inline',
): RuntimeArtifact {
  return {
    id,
    type,
    producerScenario: scenario,
    schemaVersion: '1',
    metadata: { title, path: dataRef, runId: run },
    dataRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${id}`,
      role,
      declaredMediaType: mediaType,
      declaredExtension: extension,
      contentShape,
      readableRef: previewPolicy === 'unsupported' ? undefined : dataRef,
      rawRef: dataRef,
      previewPolicy,
    },
    visibility: role === 'internal' ? 'private-draft' : 'project-record',
  };
}

function dataAnalysisObjectReferences(run: string, csv: LargeCsvFixture): ObjectReference[] {
  return [
    objectReference('file-sa-web-16-large-csv', 'Uploaded observations CSV', 'file', csv.ref, 'data-table', 'supporting-evidence', run, csv.sizeBytes),
    objectReference('object-sa-web-16-summary-stats', 'Summary statistics JSON', 'artifact', 'artifact:sa-web-16-summary-stats', 'summary-statistics', 'supporting-evidence', run),
    objectReference('object-sa-web-16-grouped-stats', 'Grouped by cohort CSV', 'artifact', 'artifact:sa-web-16-grouped-stats', 'grouped-statistics-table', 'supporting-evidence', run),
    objectReference('object-sa-web-16-report-md', 'Data analysis markdown export', 'artifact', markdownExportRef, 'data-analysis-report', 'primary-deliverable', run),
    objectReference('object-sa-web-16-analysis-code', 'Data analysis Python code', 'artifact', codeArtifactRef, 'analysis-code', 'supporting-evidence', run),
    objectReference('object-sa-web-16-run-audit', 'Data analysis RunAudit', 'artifact', 'artifact:sa-web-16-run-audit', 'run-audit', 'audit', run),
    objectReference('object-sa-web-16-diagnostic-log', 'Data analysis diagnostic log', 'artifact', 'artifact:sa-web-16-diagnostic-log', 'diagnostic-log', 'diagnostic', run),
  ];
}

function objectReference(
  id: string,
  title: string,
  kind: ObjectReference['kind'],
  ref: string,
  artifactType: string,
  presentationRole: ObjectReference['presentationRole'],
  run: string,
  size?: number,
): ObjectReference {
  return {
    id,
    title,
    kind,
    ref,
    artifactType,
    runId: run,
    preferredView: artifactType.includes('code') ? 'code-viewer' : artifactType.includes('table') || artifactType.includes('statistics') ? 'record-table' : 'report-viewer',
    presentationRole,
    actions: kind === 'file' ? ['inspect', 'copy-path'] : ['focus-right-pane', 'copy-path'],
    status: 'available',
    provenance: { dataRef: ref.replace(/^file:/, ''), size },
  };
}

function dataAnalysisExecutionUnits(fixedNow: string): RuntimeExecutionUnit[] {
  return [
    {
      id: 'EU-sa-web-16-read-ref-summary',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-16-large-observations.csv round=summary',
      status: 'done',
      hash: 'sa-web-16-read-ref-summary',
      runId,
      outputRef: 'agentserver://sa-web-16/read-ref/summary',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-16-read-ref-regroup',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-16-large-observations.csv round=regroup',
      status: 'done',
      hash: 'sa-web-16-read-ref-regroup',
      runId,
      outputRef: 'agentserver://sa-web-16/read-ref/regroup',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-16-read-ref-outliers-export',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-16-large-observations.csv round=outliers-export',
      status: 'done',
      hash: 'sa-web-16-read-ref-outliers-export',
      runId,
      outputRef: 'agentserver://sa-web-16/read-ref/outliers-export',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-16-export',
      tool: 'analysis.export.markdown',
      params: `report=${markdownExportRef} code=${codeFileRef}`,
      status: 'done',
      hash: 'sa-web-16-export',
      runId,
      outputRef: 'file:.sciforge/task-results/data-analysis-report.md',
      outputArtifacts: ['sa-web-16-report-md', 'sa-web-16-analysis-code'],
      time: fixedNow,
    },
  ];
}

function artifactDeliveryProjection(artifacts: RuntimeArtifact[]): WebE2eArtifactDeliveryProjection {
  return {
    primaryArtifactRefs: refsForRole(artifacts, 'primary-deliverable'),
    supportingArtifactRefs: refsForRole(artifacts, 'supporting-evidence'),
    auditRefs: refsForRole(artifacts, 'audit'),
    diagnosticRefs: refsForRole(artifacts, 'diagnostic'),
    internalRefs: refsForRole(artifacts, 'internal'),
  };
}

function refsForRole(artifacts: RuntimeArtifact[], role: ArtifactDeliveryRole): string[] {
  return artifacts
    .filter((artifact) => artifact.delivery?.role === role)
    .map((artifact) => artifact.delivery?.ref ?? `artifact:${artifact.id}`);
}

async function fetchRun(baseUrl: string, body: JsonRecord): Promise<MockRunFetchResult> {
  const response = await fetch(`${baseUrl}/api/agent-server/runs/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`AgentServer mock run failed: ${response.status}`);
  const text = await response.text();
  const envelopes = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  const events = envelopes.map((envelope) => envelope.event).filter(isRecord);
  return {
    envelopes,
    events,
    resultRun: resultRunFromEnvelope(envelopes.at(-1)),
  };
}

function resultRunFromEnvelope(envelope: JsonRecord | undefined): JsonRecord {
  const result = isRecord(envelope?.result) ? envelope.result : {};
  const data = isRecord(result.data) ? result.data : {};
  return isRecord(data.run) ? data.run : {};
}

function toolPayloadFromRun(run: JsonRecord | undefined): JsonRecord | undefined {
  const output = isRecord(run?.output) ? run.output : undefined;
  return isRecord(output?.toolPayload) ? output.toolPayload : undefined;
}

function roundFromRequest(request: JsonRecord): DataAnalysisRound {
  if (request.round === 'summary' || request.round === 'regroup' || request.round === 'outliers-export') return request.round;
  throw new Error(`Unexpected SA-WEB-16 round: ${String(request.round)}`);
}

function browserVisibleStateFromExpected(expected: WebE2eExpectedProjection): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer && 'text' in answer && typeof answer.text === 'string' ? answer.text : undefined,
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
}

function readRefInput(event: JsonRecord): JsonRecord {
  return isRecord(event.input) ? event.input : {};
}

function refForRequest(ref: WebE2eInitialRef): JsonRecord {
  return {
    id: ref.id,
    kind: ref.kind,
    title: ref.title,
    ref: ref.ref,
    source: ref.source,
    ...(ref.artifactType ? { artifactType: ref.artifactType } : {}),
    ...(ref.digest ? { digest: ref.digest } : {}),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function digestText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
