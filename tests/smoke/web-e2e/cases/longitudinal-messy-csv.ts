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
import { startScriptableBackendMock } from '../scriptable-backend-mock.js';
import type {
  JsonRecord,
  ScriptableAgentServerMockHandle,
  ScriptableAgentServerToolPayload,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
} from '../types.js';

export const LONGITUDINAL_MESSY_CSV_CASE_ID = 'SA-WEB-20';

export interface LongitudinalMessyCsvCaseResult {
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  runs: MockRunFetchResult[];
  recordedRunRequests: JsonRecord[];
  readRefCalls: JsonRecord[];
  messyCsv: LongitudinalCsvFixture;
  reportRef: string;
  cleanedDataRef: string;
  coefficientComparisonRef: string;
  chartRef: string;
  codeRef: string;
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

interface LongitudinalCsvFixture {
  ref: string;
  relPath: string;
  absolutePath: string;
  digest: string;
  sizeBytes: number;
  sentinel: string;
  rowCount: number;
}

type LongitudinalRound = 'clean-eda' | 'covariate-model' | 'rerun-export';

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-20';
const scenarioId = 'scenario-sa-web-20';
const runId = 'run-sa-web-20-final';
const readRefTool = 'workspace.reader.read_ref';
const reportRef = 'artifact:sa-web-20-longitudinal-report';
const cleanedDataRef = 'artifact:sa-web-20-cleaned-longitudinal-csv';
const coefficientComparisonRef = 'artifact:sa-web-20-coefficient-comparison';
const chartRef = 'artifact:sa-web-20-trajectory-chart';
const codeRef = 'artifact:sa-web-20-rerun-code';
const codeFileRef = 'file:.sciforge/tasks/sa-web-20-rerun-analysis.ts';
const runAuditRef = 'artifact:sa-web-20-run-audit';
const diagnosticLogRef = 'artifact:sa-web-20-diagnostic-log';

const roundPrompts: Record<LongitudinalRound, string> = {
  'clean-eda': 'Clean the long-format messy CSV, run EDA, and keep the source as a file ref.',
  'covariate-model': 'Add batch and timepoint covariates, then explain how treatment coefficients change.',
  'rerun-export': 'Rerun from the generated script and export report, cleaned data, chart, coefficient comparison, and code refs.',
};

export async function runLongitudinalMessyCsvCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<LongitudinalMessyCsvCaseResult> {
  const fixedNow = options.now ?? now;
  const server = await startScriptableBackendMock({
    seed: LONGITUDINAL_MESSY_CSV_CASE_ID,
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
      caseId: LONGITUDINAL_MESSY_CSV_CASE_ID,
      baseDir: options.baseDir,
      scenarioId,
      sessionId,
      runId,
      now: fixedNow,
      title: 'Longitudinal messy CSV Web E2E case',
      prompt: roundPrompts['clean-eda'],
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
    const messyCsv = await writeLongitudinalCsvFixture(fixture.workspacePath);
    await materializeLongitudinalArtifacts(fixture.workspacePath, messyCsv);
    finalizeLongitudinalFixture(fixture, messyCsv, fixedNow);

    const runs: MockRunFetchResult[] = [];
    for (const round of ['clean-eda', 'covariate-model', 'rerun-export'] as const satisfies readonly LongitudinalRound[]) {
      runs.push(await fetchRun(server.baseUrl, requestForRound(fixture, messyCsv, round)));
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
        runId: String(run.resultRun.id ?? `run-sa-web-20-${index + 1}`),
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
        summary: 'Long-format messy CSV analysis preserved refs, adjusted for batch/timepoint, compared coefficients, and exported reproducible artifacts.',
      },
      extra: {
        messyCsvRef: messyCsv.ref,
        messyCsvDigest: messyCsv.digest,
        messyCsvSizeBytes: messyCsv.sizeBytes,
        readRefTool,
        readRefCalls: readRefCalls.map((event) => event.input).filter(isRecord),
        reportRef,
        cleanedDataRef,
        coefficientComparisonRef,
        chartRef,
        codeRef,
        codeFileRef,
      },
    });

    const result: LongitudinalMessyCsvCaseResult = {
      fixture,
      server,
      runs,
      recordedRunRequests,
      readRefCalls,
      messyCsv,
      reportRef,
      cleanedDataRef,
      coefficientComparisonRef,
      chartRef,
      codeRef,
      browserVisibleState,
      runAudit,
      artifactDeliveryManifest,
      verifierInput,
      evidenceBundle,
    };
    await assertLongitudinalMessyCsvCase(result);
    return result;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function assertLongitudinalMessyCsvCase(result: LongitudinalMessyCsvCaseResult): Promise<void> {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.equal(result.recordedRunRequests.length, 3, 'longitudinal messy CSV should have three user turns');
  assert.equal(result.readRefCalls.length, 3, 'each longitudinal round must read the CSV through read_ref');
  assert.ok(result.messyCsv.sizeBytes > 4_000, 'messy CSV fixture must be large enough to exercise refs-first reads');

  const csvText = await readFile(result.messyCsv.absolutePath, 'utf8');
  assert.match(csvText, new RegExp(result.messyCsv.sentinel), 'messy CSV fixture must contain the raw prompt sentinel');

  const requestBlob = JSON.stringify(result.recordedRunRequests);
  assert.doesNotMatch(requestBlob, new RegExp(result.messyCsv.sentinel), 'raw runtime-dispatch requests must not contain messy CSV contents');
  assert.doesNotMatch(requestBlob, /subject_047,treated,week8,batch-c,98\.10/i, 'raw runtime-dispatch requests must not contain concrete CSV rows');

  const session = result.fixture.workspaceState.sessionsByScenario[result.fixture.scenarioId];
  const transcriptBlob = JSON.stringify({
    messages: session.messages,
    projection: result.fixture.expectedProjection.conversationProjection,
  });
  assert.doesNotMatch(transcriptBlob, new RegExp(result.messyCsv.sentinel), 'GUI transcript and Projection must not contain messy CSV sentinel text');

  for (const request of result.recordedRunRequests) {
    assert.equal(request.csvRef, result.messyCsv.ref);
    assert.equal(request.rawCsv, undefined);
    assert.equal(request.inlineCsv, undefined);
    assert.equal(request.largeFilePolicy, 'ref-only-longitudinal-messy-csv');
    const readRefs = request.readRefs;
    assert.ok(Array.isArray(readRefs), 'request must include readRefs');
    assert.equal(readRefs.includes(result.messyCsv.ref), true, 'request readRefs must include the messy CSV ref');
    assertRequiredCovariates(request);
    assertCoefficientComparisonPlan(request);
  }

  for (const call of result.readRefCalls) {
    const input = readRefInput(call);
    assert.equal(input.ref, result.messyCsv.ref);
    assert.equal(input.mode, 'bounded-preview');
    assert.equal(input.schemaProfile, 'long-format');
    assert.equal(input.includeRawRowsInPrompt, false);
  }

  const finalPayload = toolPayloadFromRun(result.runs.at(-1)?.resultRun);
  assert.ok(finalPayload, 'final round must return a tool payload');
  const finalArtifacts = Array.isArray(finalPayload.artifacts) ? finalPayload.artifacts : [];
  for (const expectedRef of [reportRef, cleanedDataRef, coefficientComparisonRef, chartRef, codeRef]) {
    assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === expectedRef), `final payload must expose ${expectedRef}`);
  }

  assert.equal(result.browserVisibleState.primaryArtifactRefs?.includes(reportRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(cleanedDataRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(coefficientComparisonRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(chartRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(codeRef), true);
  assert.equal(result.runAudit.refs.includes(codeFileRef), true, 'RunAudit must retain the concrete rerun code file ref');

  const exportedReport = await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-20-longitudinal-report.md'), 'utf8');
  assert.match(exportedReport, /batch and timepoint covariates/i);
  assert.match(exportedReport, /unadjusted treatment coefficient: 8\.40/i);
  assert.match(exportedReport, /adjusted treatment coefficient: 5\.10/i);
  assert.match(exportedReport, /coefficient changed by -3\.30/i);

  const coefficients = JSON.parse(await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-20-coefficients.json'), 'utf8')) as JsonRecord;
  assert.equal(coefficients.schemaVersion, 'sciforge.web-e2e.longitudinal-coefficients.v1');
  assert.equal(coefficients.sourceRef, result.messyCsv.ref);
  assert.equal(coefficients.unadjustedTreatmentCoefficient, 8.4);
  assert.equal(coefficients.adjustedTreatmentCoefficient, 5.1);
  assert.deepEqual(coefficients.adjustmentCovariates, ['batch', 'timepoint']);
}

export async function closeLongitudinalMessyCsvCase(result: LongitudinalMessyCsvCaseResult): Promise<void> {
  await result.server.close();
}

function requestForRound(fixture: WebE2eFixtureWorkspace, csv: LongitudinalCsvFixture, round: LongitudinalRound): JsonRecord {
  return {
    caseId: LONGITUDINAL_MESSY_CSV_CASE_ID,
    sessionId: fixture.sessionId,
    scenarioId: fixture.scenarioId,
    round,
    prompt: roundPrompts[round],
    csvRef: csv.ref,
    csvDigest: csv.digest,
    csvSizeBytes: csv.sizeBytes,
    readRefs: [csv.ref],
    largeFilePolicy: 'ref-only-longitudinal-messy-csv',
    requiredTool: readRefTool,
    currentTask: {
      currentTurnRef: refForRequest(fixture.expectedProjection.currentTask.currentTurnRef),
      explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map(refForRequest),
      selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map(refForRequest),
    },
    analysisPlan: {
      cleanMessyLongFormat: true,
      model: 'linear-mixed-effects-lite',
      groupColumn: 'group',
      outcomeColumn: 'outcome',
      subjectColumn: 'subject_id',
      requiredCovariates: ['batch', 'timepoint'],
      coefficientComparison: ['unadjusted-treatment', 'adjusted-treatment'],
      exportCleanedData: round === 'rerun-export',
      exportChart: round === 'rerun-export',
      exportRerunCode: round === 'rerun-export',
    },
  };
}

function scriptForRound(round: LongitudinalRound, request: JsonRecord, index: number, fixedNow: string) {
  const csvRef = String(request.csvRef ?? '');
  const readEvent = {
    kind: 'event' as const,
    event: {
      type: 'tool-call',
      tool: readRefTool,
      input: {
        ref: csvRef,
        mode: 'bounded-preview',
        schemaProfile: 'long-format',
        byteRange: [0, 8192],
        includeRawRowsInPrompt: false,
        purpose: `longitudinal-${round}`,
      },
    },
  };
  return {
    id: `sa-web-20-${round}`,
    runId: `run-sa-web-20-${String(index + 1).padStart(2, '0')}-${round}`,
    steps: [
      { kind: 'status' as const, status: 'running', message: `Reading long-format CSV by ref for ${round}.` },
      readEvent,
      { kind: 'toolPayload' as const, payload: toolPayloadForRound(round, csvRef, fixedNow) },
    ],
  };
}

function toolPayloadForRound(round: LongitudinalRound, csvRef: string, fixedNow: string): ScriptableAgentServerToolPayload {
  const base = {
    confidence: 0.9,
    claimType: 'analysis',
    evidenceLevel: 'offline-web-e2e-fixture-longitudinal-messy-csv',
    claims: [{
      id: `claim-sa-web-20-${round}`,
      text: `Round ${round} used ${csvRef} through read_ref and preserved batch/timepoint covariates.`,
      refs: [csvRef],
      createdAt: fixedNow,
    }],
  };
  if (round === 'clean-eda') {
    return {
      ...base,
      message: 'Cleaned long-format CSV profile: 150 rows, 50 subjects, three timepoints, messy missingness normalized by ref.',
      reasoningTrace: 'SA-WEB-20 clean round consumed bounded CSV refs only.',
      uiManifest: [{ componentId: 'record-table', title: 'Longitudinal cleaning summary', artifactRef: 'sa-web-20-cleaning-summary', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-20-clean-eda', tool: readRefTool, status: 'done', outputRef: 'offline-web-e2e-fixture://sa-web-20/read-ref/clean-eda' }],
      artifacts: [{ id: 'sa-web-20-cleaning-summary', deliveryRef: 'artifact:sa-web-20-cleaning-summary' }],
    };
  }
  if (round === 'covariate-model') {
    return {
      ...base,
      message: 'Coefficient comparison complete: unadjusted treatment coefficient 8.40, adjusted coefficient 5.10 after batch/timepoint covariates.',
      reasoningTrace: 'SA-WEB-20 model round compared unadjusted and adjusted coefficients with required covariates.',
      uiManifest: [{ componentId: 'record-table', title: 'Coefficient comparison', artifactRef: 'sa-web-20-coefficient-comparison', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-20-covariate-model', tool: 'analysis.model.compare-coefficients', status: 'done', outputRef: coefficientComparisonRef }],
      artifacts: [{ id: 'sa-web-20-coefficient-comparison', deliveryRef: coefficientComparisonRef }],
    };
  }
  return {
    ...base,
    message: 'Rerun completed from generated script; report, cleaned data, chart, coefficient comparison, and code refs were exported.',
    reasoningTrace: 'SA-WEB-20 final round reran the generated analysis package and exposed reproducible artifacts.',
    uiManifest: [
      { componentId: 'report-viewer', title: 'Longitudinal report', artifactRef: 'sa-web-20-longitudinal-report', priority: 1 },
      { componentId: 'record-table', title: 'Coefficient comparison', artifactRef: 'sa-web-20-coefficient-comparison', priority: 2 },
      { componentId: 'image-viewer', title: 'Trajectory chart', artifactRef: 'sa-web-20-trajectory-chart', priority: 3 },
    ],
    executionUnits: [{
      id: 'EU-sa-web-20-export',
      tool: 'analysis.export.reproducible-package',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/sa-web-20-longitudinal-report.md',
      outputArtifacts: [
        'sa-web-20-longitudinal-report',
        'sa-web-20-cleaned-longitudinal-csv',
        'sa-web-20-coefficient-comparison',
        'sa-web-20-trajectory-chart',
        'sa-web-20-rerun-code',
      ],
      codeRefs: [codeFileRef],
    }],
    artifacts: [
      { id: 'sa-web-20-longitudinal-report', deliveryRef: reportRef, dataRef: '.sciforge/task-results/sa-web-20-longitudinal-report.md' },
      { id: 'sa-web-20-cleaned-longitudinal-csv', deliveryRef: cleanedDataRef, dataRef: '.sciforge/task-results/sa-web-20-cleaned-longitudinal.csv' },
      { id: 'sa-web-20-coefficient-comparison', deliveryRef: coefficientComparisonRef, dataRef: '.sciforge/task-results/sa-web-20-coefficients.json' },
      { id: 'sa-web-20-trajectory-chart', deliveryRef: chartRef, dataRef: '.sciforge/task-results/sa-web-20-trajectory.svg' },
      { id: 'sa-web-20-rerun-code', deliveryRef: codeRef, dataRef: '.sciforge/tasks/sa-web-20-rerun-analysis.ts' },
    ],
  };
}

async function writeLongitudinalCsvFixture(workspacePath: string): Promise<LongitudinalCsvFixture> {
  const relPath = '.sciforge/artifacts/sa-web-20-longitudinal-messy.csv';
  const absolutePath = join(workspacePath, relPath);
  const sentinel = 'SA_WEB_20_RAW_LONGITUDINAL_SENTINEL_DO_NOT_INLINE';
  const rows = ['subject_id,group,timepoint,batch,outcome,note'];
  const groups = ['treated', 'control'];
  const timepoints = ['baseline', 'week4', 'week8'];
  const batches = ['batch-a', 'batch-b', 'batch-c'];
  for (let subject = 1; subject <= 50; subject += 1) {
    const group = groups[subject % 2] ?? 'control';
    for (const [tpIndex, timepoint] of timepoints.entries()) {
      const batch = batches[(subject + tpIndex) % batches.length] ?? 'batch-a';
      const base = 42 + (subject % 9) * 0.8 + tpIndex * 2.7 + (group === 'treated' ? tpIndex * 2.4 : 0);
      const messyOutcome = subject === 47 && timepoint === 'week8'
        ? '98.10'
        : subject === 12 && timepoint === 'week4'
          ? 'NA'
          : base.toFixed(2);
      const note = subject === 47 && timepoint === 'week8' ? sentinel : subject % 13 === 0 ? ' trailing-space ' : 'ok';
      rows.push(`subject_${String(subject).padStart(3, '0')},${group},${timepoint},${batch},${messyOutcome},${note}`);
    }
  }
  rows.push('subject_012,treated,week4,batch-b,NA,duplicate-row-kept-for-cleaning-audit');
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

async function materializeLongitudinalArtifacts(workspacePath: string, csv: LongitudinalCsvFixture): Promise<void> {
  await mkdir(join(workspacePath, '.sciforge/task-results'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/tasks'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/logs'), { recursive: true });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-20-cleaned-longitudinal.csv'),
    [
      'subject_id,group,timepoint,batch,outcome,cleaning_flag',
      'subject_001,control,baseline,batch-b,42.80,ok',
      'subject_001,control,week4,batch-c,45.50,ok',
      'subject_047,treated,week8,batch-c,98.10,outlier-retained',
      'subject_012,treated,week4,batch-b,,missing-normalized',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-20-coefficients.json'), {
    schemaVersion: 'sciforge.web-e2e.longitudinal-coefficients.v1',
    sourceRef: csv.ref,
    sourceDigest: csv.digest,
    modelFamily: 'linear-mixed-effects-lite',
    unadjustedTreatmentCoefficient: 8.4,
    adjustedTreatmentCoefficient: 5.1,
    coefficientDelta: -3.3,
    adjustmentCovariates: ['batch', 'timepoint'],
    consistencyCheck: 'statistics-chart-text-agree',
  });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-20-longitudinal-report.md'),
    [
      '# SA-WEB-20 Longitudinal Messy CSV Report',
      '',
      `input ref: ${csv.ref}`,
      'cleaning: normalized missing values, retained subject_047 outlier, and recorded duplicate handling.',
      'model: outcome ~ treatment + batch and timepoint covariates.',
      'unadjusted treatment coefficient: 8.40',
      'adjusted treatment coefficient: 5.10',
      'coefficient changed by -3.30 after adding batch and timepoint covariates.',
      'chart: artifact:sa-web-20-trajectory-chart',
      `rerun code: ${codeFileRef}`,
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-20-trajectory.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><title>SA-WEB-20 trajectory chart</title><path d="M40 250 L220 190 L400 135" stroke="#2563eb" fill="none"/><path d="M40 245 L220 220 L400 205" stroke="#dc2626" fill="none"/></svg>\n',
    'utf8',
  );
  await writeFile(
    join(workspacePath, '.sciforge/tasks/sa-web-20-rerun-analysis.ts'),
    [
      "import { readFileSync, writeFileSync } from 'node:fs';",
      '',
      "const csvPath = '.sciforge/artifacts/sa-web-20-longitudinal-messy.csv';",
      'const csv = readFileSync(csvPath, "utf8");',
      'if (!csv.includes("subject_id,group,timepoint,batch,outcome")) throw new Error("schema drift");',
      'writeFileSync(".sciforge/task-results/sa-web-20-rerun.json", JSON.stringify({ adjustedTreatmentCoefficient: 5.1, covariates: ["batch", "timepoint"] }, null, 2));',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/current-run-audit.json'), {
    schemaVersion: 'sciforge.web-e2e.longitudinal-run-audit.v1',
    runId,
    sourceRef: csv.ref,
    readPolicy: 'ref-only-longitudinal-messy-csv',
    exportedRefs: [reportRef, cleanedDataRef, coefficientComparisonRef, chartRef, codeRef],
  });
  await writeFile(join(workspacePath, '.sciforge/logs/current-run.stderr.log'), 'longitudinal fixture: no raw CSV body emitted\n', 'utf8');
}

function finalizeLongitudinalFixture(fixture: WebE2eFixtureWorkspace, csv: LongitudinalCsvFixture, fixedNow: string): void {
  const csvInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-20-longitudinal-csv',
    kind: 'file',
    title: 'Long-format messy CSV',
    ref: csv.ref,
    source: 'explicit-selection',
    artifactType: 'longitudinal-data-table',
    digest: csv.digest,
  };
  fixture.initialRefs.push(csvInitialRef);
  fixture.expectedProjection.currentTask.explicitRefs = [csvInitialRef];
  fixture.expectedProjection.currentTask.selectedRefs = [
    fixture.expectedProjection.currentTask.currentTurnRef,
    csvInitialRef,
  ];

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const artifacts = longitudinalArtifacts(fixture.scenarioId, fixture.runId, csv);
  const objectReferences = longitudinalObjectReferences(fixture.runId, csv);
  const projection = longitudinalProjection(fixture.expectedProjection, artifacts, csv, fixedNow);
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.artifactDelivery = artifactDeliveryProjection(artifacts);
  fixture.expectedProjection.runAuditRefs = uniqueStrings([
    runAuditRef,
    diagnosticLogRef,
    'offline-web-e2e-fixture://sa-web-20/read-ref/clean-eda',
    'offline-web-e2e-fixture://sa-web-20/read-ref/covariate-model',
    'offline-web-e2e-fixture://sa-web-20/read-ref/rerun-export',
    coefficientComparisonRef,
    codeFileRef,
  ]);

  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = longitudinalSession({
    session,
    projection,
    artifacts,
    objectReferences,
    csv,
    fixedNow,
  });
}

function longitudinalSession(input: {
  session: SciForgeSession;
  projection: ConversationProjection;
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
  csv: LongitudinalCsvFixture;
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
    prompt: roundPrompts['rerun-export'],
    response: input.projection.visibleAnswer?.text ?? 'Longitudinal analysis completed.',
    completedAt: input.fixedNow,
    objectReferences: input.objectReferences,
    raw: {
      displayIntent: {
        primaryGoal: 'Render longitudinal messy CSV analysis from Projection and refs-first artifacts.',
        source: 'runtime-dispatch',
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
    title: 'Longitudinal messy CSV Web E2E case',
    messages: input.session.messages.map((message) => {
      if (message.role === 'user') {
        return {
          ...message,
          content: roundPrompts['clean-eda'],
          objectReferences: input.objectReferences.filter((ref) => ref.ref === input.csv.ref),
        };
      }
      if (message.role === 'scenario') {
        return {
          ...message,
          content: input.projection.visibleAnswer?.text ?? 'Longitudinal analysis completed.',
          objectReferences: input.objectReferences.filter((ref) => ref.presentationRole !== 'audit' && ref.presentationRole !== 'diagnostic' && ref.presentationRole !== 'internal'),
          status: 'completed',
        };
      }
      return message;
    }),
    runs: [nextRun],
    uiManifest: [
      { componentId: 'report-viewer', title: 'Longitudinal report', artifactRef: 'sa-web-20-longitudinal-report', priority: 1 },
      { componentId: 'record-table', title: 'Coefficient comparison', artifactRef: 'sa-web-20-coefficient-comparison', priority: 2 },
      { componentId: 'image-viewer', title: 'Trajectory chart', artifactRef: 'sa-web-20-trajectory-chart', priority: 3 },
    ],
    executionUnits: longitudinalExecutionUnits(input.fixedNow),
    artifacts: input.artifacts,
    updatedAt: input.fixedNow,
  };
}

function longitudinalProjection(
  expected: WebE2eExpectedProjection,
  artifacts: RuntimeArtifact[],
  csv: LongitudinalCsvFixture,
  fixedNow: string,
): ConversationProjection {
  const artifactRefs = artifacts
    .filter((artifact) => artifact.delivery?.role === 'primary-deliverable' || artifact.delivery?.role === 'supporting-evidence')
    .map((artifact): ConversationRef => ({
      ref: artifact.delivery?.ref ?? `artifact:${artifact.id}`,
      mime: artifact.delivery?.declaredMediaType,
      label: String(artifact.metadata?.title ?? artifact.id),
      sizeBytes: artifact.id === 'sa-web-20-source-csv' ? csv.sizeBytes : undefined,
    }));
  return {
    ...expected.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: 'Longitudinal messy CSV analysis completed with refs-first reads: cleaning, EDA, batch/timepoint-adjusted coefficient comparison, rerun code, cleaned data, report, and chart are aligned.',
      artifactRefs: [reportRef, cleanedDataRef, coefficientComparisonRef, chartRef, codeRef, csv.ref],
    },
    activeRun: { id: expected.runId, status: 'satisfied' },
    artifacts: artifactRefs,
    executionProcess: [
      {
        eventId: 'sa-web-20-clean-eda',
        type: 'OutputMaterialized',
        summary: 'Messy long-format CSV was cleaned from a file ref.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-20-covariate-model',
        type: 'OutputMaterialized',
        summary: 'Treatment coefficients compared before and after batch/timepoint adjustment.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-20-rerun-export',
        type: 'Satisfied',
        summary: 'Report, cleaned data, chart, coefficient comparison, and rerun code exported.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs: [
      runAuditRef,
      diagnosticLogRef,
      'offline-web-e2e-fixture://sa-web-20/read-ref/clean-eda',
      'offline-web-e2e-fixture://sa-web-20/read-ref/covariate-model',
      'offline-web-e2e-fixture://sa-web-20/read-ref/rerun-export',
      codeFileRef,
    ],
    diagnostics: [{
      severity: 'info',
      code: 'longitudinal-coefficient-consistency',
      message: 'Statistics, chart, text, and rerun code agree on the batch/timepoint-adjusted coefficient comparison.',
      refs: [{ ref: csv.ref }, { ref: coefficientComparisonRef }, { ref: reportRef }, { ref: codeFileRef }],
    }],
  };
}

function longitudinalArtifacts(scenario: string, run: string, csv: LongitudinalCsvFixture): RuntimeArtifact[] {
  return [
    artifact('sa-web-20-source-csv', 'longitudinal-data-table', scenario, run, 'Long-format messy CSV', csv.relPath, 'supporting-evidence', 'text/csv', 'csv', 'raw-file', 'open-system'),
    artifact('sa-web-20-cleaned-longitudinal-csv', 'cleaned-data-table', scenario, run, 'Cleaned longitudinal CSV', '.sciforge/task-results/sa-web-20-cleaned-longitudinal.csv', 'supporting-evidence', 'text/csv', 'csv'),
    artifact('sa-web-20-coefficient-comparison', 'coefficient-comparison', scenario, run, 'Coefficient comparison JSON', '.sciforge/task-results/sa-web-20-coefficients.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-20-trajectory-chart', 'trajectory-chart', scenario, run, 'Longitudinal trajectory chart', '.sciforge/task-results/sa-web-20-trajectory.svg', 'supporting-evidence', 'image/svg+xml', 'svg'),
    artifact('sa-web-20-longitudinal-report', 'analysis-report', scenario, run, 'Longitudinal analysis report', '.sciforge/task-results/sa-web-20-longitudinal-report.md', 'primary-deliverable', 'text/markdown', 'md'),
    artifact('sa-web-20-rerun-code', 'rerun-code', scenario, run, 'Longitudinal rerun code', '.sciforge/tasks/sa-web-20-rerun-analysis.ts', 'supporting-evidence', 'text/typescript', 'ts', 'raw-file', 'open-system'),
    artifact('sa-web-20-run-audit', 'run-audit', scenario, run, 'Longitudinal RunAudit', '.sciforge/task-results/current-run-audit.json', 'audit', 'application/json', 'json', 'raw-file', 'audit-only'),
    artifact('sa-web-20-diagnostic-log', 'diagnostic-log', scenario, run, 'Longitudinal diagnostic log', '.sciforge/logs/current-run.stderr.log', 'diagnostic', 'text/plain', 'log', 'raw-file', 'audit-only'),
    artifact('sa-web-20-provider-manifest', 'provider-manifest', scenario, run, 'Provider manifest', '.sciforge/provider-manifest.json', 'internal', 'application/json', 'json', 'raw-file', 'unsupported'),
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
  contentShape: NonNullable<RuntimeArtifact['delivery']>['contentShape'] = 'raw-file',
  previewPolicy: NonNullable<RuntimeArtifact['delivery']>['previewPolicy'] = 'inline',
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

function longitudinalObjectReferences(run: string, csv: LongitudinalCsvFixture): ObjectReference[] {
  return [
    objectReference('file-sa-web-20-source-csv', 'Long-format messy CSV', 'file', csv.ref, 'longitudinal-data-table', 'supporting-evidence', run, csv.sizeBytes),
    objectReference('object-sa-web-20-cleaned-csv', 'Cleaned longitudinal CSV', 'artifact', cleanedDataRef, 'cleaned-data-table', 'supporting-evidence', run),
    objectReference('object-sa-web-20-coefficients', 'Coefficient comparison JSON', 'artifact', coefficientComparisonRef, 'coefficient-comparison', 'supporting-evidence', run),
    objectReference('object-sa-web-20-chart', 'Longitudinal trajectory chart', 'artifact', chartRef, 'trajectory-chart', 'supporting-evidence', run),
    objectReference('object-sa-web-20-report', 'Longitudinal analysis report', 'artifact', reportRef, 'analysis-report', 'primary-deliverable', run),
    objectReference('object-sa-web-20-code', 'Longitudinal rerun code', 'artifact', codeRef, 'rerun-code', 'supporting-evidence', run),
    objectReference('object-sa-web-20-run-audit', 'Longitudinal RunAudit', 'artifact', runAuditRef, 'run-audit', 'audit', run),
    objectReference('object-sa-web-20-diagnostic-log', 'Longitudinal diagnostic log', 'artifact', diagnosticLogRef, 'diagnostic-log', 'diagnostic', run),
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
    preferredView: artifactType.includes('chart') ? 'image-viewer' : artifactType.includes('table') || artifactType.includes('comparison') ? 'record-table' : artifactType.includes('code') ? 'code-viewer' : 'report-viewer',
    presentationRole,
    actions: kind === 'file' ? ['inspect', 'copy-path'] : ['focus-right-pane', 'copy-path'],
    status: 'available',
    provenance: { dataRef: ref.replace(/^file:/, ''), size },
  };
}

function longitudinalExecutionUnits(fixedNow: string): RuntimeExecutionUnit[] {
  return [
    {
      id: 'EU-sa-web-20-read-ref-clean-eda',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-20-longitudinal-messy.csv round=clean-eda mode=bounded-preview',
      status: 'done',
      hash: 'sa-web-20-read-ref-clean-eda',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-20/read-ref/clean-eda',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-20-read-ref-covariate-model',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-20-longitudinal-messy.csv covariates=batch,timepoint',
      status: 'done',
      hash: 'sa-web-20-read-ref-covariate-model',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-20/read-ref/covariate-model',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-20-read-ref-rerun-export',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-20-longitudinal-messy.csv export=report,cleaned,chart,code',
      status: 'done',
      hash: 'sa-web-20-read-ref-rerun-export',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-20/read-ref/rerun-export',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-20-export',
      tool: 'analysis.export.reproducible-package',
      params: `report=${reportRef} cleaned=${cleanedDataRef} coefficients=${coefficientComparisonRef} chart=${chartRef} code=${codeFileRef}`,
      status: 'done',
      hash: 'sa-web-20-export',
      runId,
      outputRef: 'file:.sciforge/task-results/sa-web-20-longitudinal-report.md',
      outputArtifacts: [
        'sa-web-20-longitudinal-report',
        'sa-web-20-cleaned-longitudinal-csv',
        'sa-web-20-coefficient-comparison',
        'sa-web-20-trajectory-chart',
        'sa-web-20-rerun-code',
      ],
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
  if (!response.ok) throw new Error(`offline Web E2E fixture run failed: ${response.status}`);
  const text = await response.text();
  const envelopes = text.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as JsonRecord);
  const events = envelopes.map((envelope) => envelope.event).filter(isRecord);
  return {
    envelopes,
    events,
    resultRun: resultRunFromEnvelope(envelopes.at(-1)),
  };
}

function assertRequiredCovariates(request: JsonRecord): void {
  const analysisPlan = isRecord(request.analysisPlan) ? request.analysisPlan : {};
  const covariates = analysisPlan.requiredCovariates;
  assert.ok(Array.isArray(covariates), 'analysis plan must declare batch/timepoint covariates');
  assert.ok(covariates.includes('batch') && covariates.includes('timepoint'), 'analysis plan must preserve batch/timepoint covariates');
}

function assertCoefficientComparisonPlan(request: JsonRecord): void {
  const analysisPlan = isRecord(request.analysisPlan) ? request.analysisPlan : {};
  const comparison = analysisPlan.coefficientComparison;
  assert.ok(Array.isArray(comparison), 'analysis plan must declare coefficient comparison');
  assert.ok(
    comparison.includes('unadjusted-treatment') && comparison.includes('adjusted-treatment'),
    'analysis plan must compare unadjusted and adjusted treatment coefficients',
  );
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

function roundFromRequest(request: JsonRecord): LongitudinalRound {
  if (request.round === 'clean-eda' || request.round === 'covariate-model' || request.round === 'rerun-export') return request.round;
  throw new Error(`Unexpected SA-WEB-20 round: ${String(request.round)}`);
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
