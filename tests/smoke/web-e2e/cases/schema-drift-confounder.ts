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

export const SCHEMA_DRIFT_CONFOUNDER_CASE_ID = 'SA-WEB-21';

export interface SchemaDriftConfounderCaseResult {
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  runs: MockRunFetchResult[];
  recordedRunRequests: JsonRecord[];
  readRefCalls: JsonRecord[];
  dataTable: DriftDataFixture;
  schemaFile: DriftSchemaFixture;
  staleAnalysisRef: string;
  reinterpretationReportRef: string;
  methodSectionRef: string;
  validRefsManifestRef: string;
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

interface DriftDataFixture {
  ref: string;
  relPath: string;
  absolutePath: string;
  digest: string;
  sizeBytes: number;
  sentinel: string;
  rowCount: number;
}

interface DriftSchemaFixture {
  ref: string;
  relPath: string;
  absolutePath: string;
  digest: string;
  sizeBytes: number;
}

type SchemaDriftRound = 'generic-analysis' | 'reveal-confounder' | 'export-method';

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-21';
const scenarioId = 'scenario-sa-web-21';
const runId = 'run-sa-web-21-final';
const readRefTool = 'workspace.reader.read_ref';
const staleAnalysisRef = 'artifact:sa-web-21-round1-generic-report';
const cleaningSummaryRef = 'artifact:sa-web-21-cleaning-summary';
const reinterpretationReportRef = 'artifact:sa-web-21-confounder-reinterpretation-report';
const methodSectionRef = 'artifact:sa-web-21-method-section';
const validRefsManifestRef = 'artifact:sa-web-21-valid-stale-refs';
const codeRef = 'artifact:sa-web-21-method-code';
const codeFileRef = 'file:.sciforge/tasks/sa-web-21-method-section.ts';
const runAuditRef = 'artifact:sa-web-21-run-audit';
const diagnosticLogRef = 'artifact:sa-web-21-diagnostic-log';

const roundPrompts: Record<SchemaDriftRound, string> = {
  'generic-analysis': 'Analyze the generic table with missing values without hard-coding treatment or biomarker assumptions.',
  'reveal-confounder': 'The x2 column is actually site/batch. Reinterpret the result and say which earlier refs are still valid.',
  'export-method': 'Export a notebook-style method section that separates valid refs from stale interpretation refs.',
};

export async function runSchemaDriftConfounderCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<SchemaDriftConfounderCaseResult> {
  const fixedNow = options.now ?? now;
  const server = await startScriptableAgentServerMock({
    seed: SCHEMA_DRIFT_CONFOUNDER_CASE_ID,
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
      caseId: SCHEMA_DRIFT_CONFOUNDER_CASE_ID,
      baseDir: options.baseDir,
      scenarioId,
      sessionId,
      runId,
      now: fixedNow,
      title: 'Schema drift confounder Web E2E case',
      prompt: roundPrompts['generic-analysis'],
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
    const dataTable = await writeDriftDataFixture(fixture.workspacePath);
    const schemaFile = await writeDriftSchemaFixture(fixture.workspacePath, dataTable);
    await materializeSchemaDriftArtifacts(fixture.workspacePath, dataTable, schemaFile);
    finalizeSchemaDriftFixture(fixture, dataTable, schemaFile, fixedNow);

    const runs: MockRunFetchResult[] = [];
    for (const round of ['generic-analysis', 'reveal-confounder', 'export-method'] as const satisfies readonly SchemaDriftRound[]) {
      runs.push(await fetchRun(server.baseUrl, requestForRound(fixture, dataTable, schemaFile, round)));
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
        runId: String(run.resultRun.id ?? `run-sa-web-21-${index + 1}`),
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
        summary: 'Schema drift round reinterpreted x2 as a site/batch confounder and separated stale interpretation refs from still-valid data/QC refs.',
      },
      extra: {
        dataRef: dataTable.ref,
        schemaRef: schemaFile.ref,
        staleAnalysisRef,
        readRefTool,
        readRefCalls: readRefCalls.map((event) => event.input).filter(isRecord),
        reinterpretationReportRef,
        methodSectionRef,
        validRefsManifestRef,
      },
    });

    const result: SchemaDriftConfounderCaseResult = {
      fixture,
      server,
      runs,
      recordedRunRequests,
      readRefCalls,
      dataTable,
      schemaFile,
      staleAnalysisRef,
      reinterpretationReportRef,
      methodSectionRef,
      validRefsManifestRef,
      browserVisibleState,
      runAudit,
      artifactDeliveryManifest,
      verifierInput,
      evidenceBundle,
    };
    await assertSchemaDriftConfounderCase(result);
    return result;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function assertSchemaDriftConfounderCase(result: SchemaDriftConfounderCaseResult): Promise<void> {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.equal(result.recordedRunRequests.length, 3, 'schema drift confounder case should have three user turns');
  assert.equal(result.readRefCalls.length, 5, 'schema drift case must read data once and data+schema for reinterpretation/export');

  const dataText = await readFile(result.dataTable.absolutePath, 'utf8');
  assert.match(dataText, new RegExp(result.dataTable.sentinel), 'schema drift data fixture must contain the raw prompt sentinel');

  const requestBlob = JSON.stringify(result.recordedRunRequests);
  assert.doesNotMatch(requestBlob, new RegExp(result.dataTable.sentinel), 'raw runtime-dispatch requests must not contain schema-drift table contents');
  assert.doesNotMatch(requestBlob, /case_041,active,site-west,missing-biomarker/i, 'raw runtime-dispatch requests must not contain concrete schema-drift rows');

  for (const request of result.recordedRunRequests) {
    assert.equal(request.dataRef, result.dataTable.ref);
    assert.equal(request.rawData, undefined);
    assert.equal(request.inlineTable, undefined);
    assert.equal(request.staleRefPolicy, 'qc-only-not-inference');
    assertValidAndStaleRefs(request, result);
  }

  for (const call of result.readRefCalls) {
    const input = readRefInput(call);
    assert.notEqual(input.ref, result.staleAnalysisRef, 'stale refs must not be used as analysis inputs');
    assert.ok(input.ref === result.dataTable.ref || input.ref === result.schemaFile.ref, `unexpected read_ref target ${String(input.ref)}`);
    assert.equal(input.mode, 'bounded-preview');
    assert.equal(input.includeStaleInterpretation, false);
  }

  const finalPayload = toolPayloadFromRun(result.runs.at(-1)?.resultRun);
  assert.ok(finalPayload, 'final round must return a tool payload');
  const finalArtifacts = Array.isArray(finalPayload.artifacts) ? finalPayload.artifacts : [];
  for (const expectedRef of [reinterpretationReportRef, methodSectionRef, validRefsManifestRef, codeRef]) {
    assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === expectedRef), `final payload must expose ${expectedRef}`);
  }

  assert.equal(result.browserVisibleState.primaryArtifactRefs?.includes(methodSectionRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(reinterpretationReportRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(validRefsManifestRef), true);
  assert.equal(result.runAudit.refs.includes(result.staleAnalysisRef), true, 'RunAudit must preserve the stale ref decision');
  assert.equal(result.runAudit.refs.includes(codeFileRef), true, 'RunAudit must retain method code ref');

  const report = await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-21-confounder-reinterpretation.md'), 'utf8');
  assert.match(report, /x2 is site\/batch confounder/i);
  assert.match(report, /stale for inference/i);
  assert.match(report, /valid for data cleaning and row counts/i);

  const manifest = JSON.parse(await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-21-valid-stale-refs.json'), 'utf8')) as JsonRecord;
  assert.equal(manifest.schemaVersion, 'sciforge.web-e2e.schema-drift-valid-stale-refs.v1');
  assert.deepEqual(manifest.validRefs, [result.dataTable.ref, result.schemaFile.ref, cleaningSummaryRef]);
  assert.deepEqual(manifest.staleRefs, [result.staleAnalysisRef]);
  assert.equal(manifest.confounderColumn, 'x2');
}

export async function closeSchemaDriftConfounderCase(result: SchemaDriftConfounderCaseResult): Promise<void> {
  await result.server.close();
}

function requestForRound(
  fixture: WebE2eFixtureWorkspace,
  dataTable: DriftDataFixture,
  schemaFile: DriftSchemaFixture,
  round: SchemaDriftRound,
): JsonRecord {
  const readRefs = round === 'generic-analysis' ? [dataTable.ref] : [dataTable.ref, schemaFile.ref];
  const hasRevealedConfounder = round !== 'generic-analysis';
  const schemaRefFields: JsonRecord = hasRevealedConfounder
    ? {
      schemaRef: schemaFile.ref,
      schemaDigest: schemaFile.digest,
    }
    : {};
  const confounderFields: JsonRecord = hasRevealedConfounder
    ? {
      confounderColumn: 'x2',
      confounderMeaning: 'site/batch',
    }
    : {};
  return {
    caseId: SCHEMA_DRIFT_CONFOUNDER_CASE_ID,
    sessionId: fixture.sessionId,
    scenarioId: fixture.scenarioId,
    round,
    prompt: roundPrompts[round],
    dataRef: dataTable.ref,
    dataDigest: dataTable.digest,
    ...schemaRefFields,
    readRefs,
    staleRefs: [staleAnalysisRef],
    validRefs: round === 'generic-analysis' ? [dataTable.ref, cleaningSummaryRef] : [dataTable.ref, schemaFile.ref, cleaningSummaryRef],
    staleRefPolicy: 'qc-only-not-inference',
    requiredTool: readRefTool,
    currentTask: {
      currentTurnRef: refForRequest(fixture.expectedProjection.currentTask.currentTurnRef),
      explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map(refForRequest),
      selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map(refForRequest),
    },
    reinterpretation: {
      revealedConfounder: round !== 'generic-analysis',
      ...confounderFields,
      validEarlierRefs: round === 'generic-analysis' ? [dataTable.ref, cleaningSummaryRef] : [dataTable.ref, schemaFile.ref, cleaningSummaryRef],
      staleEarlierRefs: [staleAnalysisRef],
      forbidHardcodedAssumptions: ['treatment/placebo', 'biomarker'],
      exportNotebookMethod: round === 'export-method',
    },
  };
}

function scriptForRound(round: SchemaDriftRound, request: JsonRecord, index: number, fixedNow: string) {
  const readRefs = Array.isArray(request.readRefs) ? request.readRefs.map(String) : [];
  const readEvents = readRefs.map((ref) => ({
    kind: 'event' as const,
    event: {
      type: 'tool-call',
      tool: readRefTool,
      input: {
        ref,
        mode: 'bounded-preview',
        byteRange: [0, 4096],
        includeStaleInterpretation: false,
        purpose: `schema-drift-${round}`,
      },
    },
  }));
  return {
    id: `sa-web-21-${round}`,
    runId: `run-sa-web-21-${String(index + 1).padStart(2, '0')}-${round}`,
    steps: [
      { kind: 'status' as const, status: 'running', message: `Reading valid refs for ${round}.` },
      ...readEvents,
      { kind: 'toolPayload' as const, payload: toolPayloadForRound(round, String(request.dataRef ?? ''), fixedNow) },
    ],
  };
}

function toolPayloadForRound(round: SchemaDriftRound, dataRef: string, fixedNow: string): ScriptableAgentServerToolPayload {
  const base = {
    confidence: 0.88,
    claimType: 'analysis',
    evidenceLevel: 'offline-web-e2e-fixture-schema-drift-confounder',
    claims: [{
      id: `claim-sa-web-21-${round}`,
      text: `Round ${round} used ${dataRef} and separated stale interpretation refs from valid refs.`,
      refs: [dataRef],
      createdAt: fixedNow,
    }],
  };
  if (round === 'generic-analysis') {
    return {
      ...base,
      message: 'Generic table profile completed without hard-coded treatment or biomarker assumptions; missingness and row counts are valid.',
      reasoningTrace: 'SA-WEB-21 round 1 only made schema-agnostic QC claims.',
      uiManifest: [{ componentId: 'record-table', title: 'Cleaning summary', artifactRef: 'sa-web-21-cleaning-summary', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-21-generic-analysis', tool: readRefTool, status: 'done', outputRef: 'offline-web-e2e-fixture://sa-web-21/read-ref/generic-analysis' }],
      artifacts: [
        { id: 'sa-web-21-cleaning-summary', deliveryRef: cleaningSummaryRef },
        { id: 'sa-web-21-round1-generic-report', deliveryRef: staleAnalysisRef },
      ],
    };
  }
  if (round === 'reveal-confounder') {
    return {
      ...base,
      message: 'Schema drift reinterpreted x2 as site/batch confounder. Earlier generic QC remains valid, but the round-1 generic effect interpretation is stale for inference.',
      reasoningTrace: 'SA-WEB-21 round 2 used valid schema ref and quarantined stale interpretation refs.',
      uiManifest: [{ componentId: 'report-viewer', title: 'Confounder reinterpretation', artifactRef: 'sa-web-21-confounder-reinterpretation-report', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-21-reveal-confounder', tool: 'analysis.schema-drift.reinterpret', status: 'done', outputRef: reinterpretationReportRef }],
      artifacts: [{ id: 'sa-web-21-confounder-reinterpretation-report', deliveryRef: reinterpretationReportRef }],
    };
  }
  return {
    ...base,
    message: 'Notebook-style method section exported with valid/stale refs: data and cleaning refs remain valid; generic round-1 effect interpretation is stale after x2 became site/batch confounder.',
    reasoningTrace: 'SA-WEB-21 final round exported method and refs manifest from valid data/schema refs only.',
    uiManifest: [
      { componentId: 'report-viewer', title: 'Method section', artifactRef: 'sa-web-21-method-section', priority: 1 },
      { componentId: 'record-table', title: 'Valid/stale refs manifest', artifactRef: 'sa-web-21-valid-stale-refs', priority: 2 },
    ],
    executionUnits: [{
      id: 'EU-sa-web-21-export-method',
      tool: 'analysis.export.method-section',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/sa-web-21-method-section.md',
      outputArtifacts: [
        'sa-web-21-method-section',
        'sa-web-21-valid-stale-refs',
        'sa-web-21-method-code',
      ],
      codeRefs: [codeFileRef],
    }],
    artifacts: [
      { id: 'sa-web-21-confounder-reinterpretation-report', deliveryRef: reinterpretationReportRef, dataRef: '.sciforge/task-results/sa-web-21-confounder-reinterpretation.md' },
      { id: 'sa-web-21-method-section', deliveryRef: methodSectionRef, dataRef: '.sciforge/task-results/sa-web-21-method-section.md' },
      { id: 'sa-web-21-valid-stale-refs', deliveryRef: validRefsManifestRef, dataRef: '.sciforge/task-results/sa-web-21-valid-stale-refs.json' },
      { id: 'sa-web-21-method-code', deliveryRef: codeRef, dataRef: '.sciforge/tasks/sa-web-21-method-section.ts' },
    ],
  };
}

async function writeDriftDataFixture(workspacePath: string): Promise<DriftDataFixture> {
  const relPath = '.sciforge/artifacts/sa-web-21-generic-observations.csv';
  const absolutePath = join(workspacePath, relPath);
  const sentinel = 'SA_WEB_21_SCHEMA_DRIFT_SENTINEL_DO_NOT_INLINE';
  const rows = ['case_id,x1,x2,x3,y,missing_note'];
  for (let index = 1; index <= 72; index += 1) {
    const x1 = index % 2 === 0 ? 'active' : 'hold';
    const x2 = index % 3 === 0 ? 'site-west' : index % 3 === 1 ? 'site-east' : 'site-north';
    const x3 = index % 11 === 0 ? '' : (12 + (index % 7) * 0.5).toFixed(1);
    const y = (50 + (x1 === 'active' ? 4 : 0) + (x2 === 'site-west' ? 6 : 0) + (index % 5)).toFixed(1);
    const note = index === 41 ? `missing-biomarker-${sentinel}` : index % 10 === 0 ? 'missing-biomarker' : 'ok';
    rows.push(`case_${String(index).padStart(3, '0')},${x1},${x2},${x3},${y},${note}`);
  }
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

async function writeDriftSchemaFixture(workspacePath: string, dataTable: DriftDataFixture): Promise<DriftSchemaFixture> {
  const relPath = '.sciforge/artifacts/sa-web-21-schema-v2.json';
  const absolutePath = join(workspacePath, relPath);
  const content = `${JSON.stringify({
    schemaVersion: 'sciforge.web-e2e.schema-drift.v2',
    sourceRef: dataTable.ref,
    columns: {
      case_id: 'record id',
      x1: 'exposure status, not assumed treatment/placebo',
      x2: 'site/batch confounder',
      x3: 'generic numeric covariate with missing values',
      y: 'outcome',
    },
    confounderColumn: 'x2',
  }, null, 2)}\n`;
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
  const fileStat = await stat(absolutePath);
  return {
    ref: `file:${relPath}`,
    relPath,
    absolutePath,
    digest: digestText(content),
    sizeBytes: fileStat.size,
  };
}

async function materializeSchemaDriftArtifacts(
  workspacePath: string,
  dataTable: DriftDataFixture,
  schemaFile: DriftSchemaFixture,
): Promise<void> {
  await mkdir(join(workspacePath, '.sciforge/task-results'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/tasks'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/logs'), { recursive: true });
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-21-cleaning-summary.json'), {
    schemaVersion: 'sciforge.web-e2e.schema-drift-cleaning.v1',
    sourceRef: dataTable.ref,
    rowCount: dataTable.rowCount,
    missingColumns: ['x3', 'missing_note'],
    validAfterSchemaDrift: true,
  });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-21-round1-generic-report.md'),
    [
      '# SA-WEB-21 Round 1 Generic Report',
      '',
      'Generic association note. This effect interpretation becomes stale once x2 is revealed as site/batch.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-21-confounder-reinterpretation.md'),
    [
      '# SA-WEB-21 Confounder Reinterpretation',
      '',
      `data ref: ${dataTable.ref}`,
      `schema ref: ${schemaFile.ref}`,
      'x2 is site/batch confounder, not a biomarker or treatment arm.',
      'round-1 generic QC and missingness refs remain valid for data cleaning and row counts.',
      'round-1 generic effect interpretation is stale for inference after schema drift.',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-21-method-section.md'),
    [
      '# SA-WEB-21 Notebook-Style Method Section',
      '',
      'We analyzed the generic table without assuming treatment/placebo semantics.',
      'After schema update, x2 was modeled as site/batch confounder and earlier interpretation refs were reclassified.',
      `valid refs: ${dataTable.ref}, ${schemaFile.ref}, ${cleaningSummaryRef}`,
      `stale refs: ${staleAnalysisRef}`,
      `code: ${codeFileRef}`,
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-21-valid-stale-refs.json'), {
    schemaVersion: 'sciforge.web-e2e.schema-drift-valid-stale-refs.v1',
    dataDigest: dataTable.digest,
    schemaDigest: schemaFile.digest,
    confounderColumn: 'x2',
    confounderMeaning: 'site/batch',
    validRefs: [dataTable.ref, schemaFile.ref, cleaningSummaryRef],
    staleRefs: [staleAnalysisRef],
    staleReason: 'Round-1 generic effect interpretation predated the schema update that revealed x2 as site/batch.',
  });
  await writeFile(
    join(workspacePath, '.sciforge/tasks/sa-web-21-method-section.ts'),
    [
      "import { readFileSync } from 'node:fs';",
      '',
      "const schema = JSON.parse(readFileSync('.sciforge/artifacts/sa-web-21-schema-v2.json', 'utf8'));",
      'if (schema.confounderColumn !== "x2") throw new Error("schema drift not applied");',
      'console.log("x2 modeled as site/batch confounder; stale interpretation refs quarantined");',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/current-run-audit.json'), {
    schemaVersion: 'sciforge.web-e2e.schema-drift-run-audit.v1',
    runId,
    dataRef: dataTable.ref,
    schemaRef: schemaFile.ref,
    staleRefs: [staleAnalysisRef],
    validRefs: [dataTable.ref, schemaFile.ref, cleaningSummaryRef],
    exportedRefs: [reinterpretationReportRef, methodSectionRef, validRefsManifestRef, codeRef],
  });
  await writeFile(join(workspacePath, '.sciforge/logs/current-run.stderr.log'), 'schema drift fixture: stale refs retained for audit only\n', 'utf8');
}

function finalizeSchemaDriftFixture(
  fixture: WebE2eFixtureWorkspace,
  dataTable: DriftDataFixture,
  schemaFile: DriftSchemaFixture,
  fixedNow: string,
): void {
  const dataInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-21-generic-data',
    kind: 'file',
    title: 'Generic schema-drift data table',
    ref: dataTable.ref,
    source: 'explicit-selection',
    artifactType: 'generic-data-table',
    digest: dataTable.digest,
  };
  const schemaInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-21-schema-v2',
    kind: 'file',
    title: 'Updated schema v2',
    ref: schemaFile.ref,
    source: 'explicit-selection',
    artifactType: 'schema-manifest',
    digest: schemaFile.digest,
  };
  const staleInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-21-stale-generic-report',
    kind: 'artifact',
    title: 'Round 1 generic interpretation',
    ref: staleAnalysisRef,
    source: 'explicit-selection',
    artifactType: 'stale-analysis-report',
  };
  fixture.initialRefs.push(dataInitialRef, schemaInitialRef, staleInitialRef);
  fixture.expectedProjection.currentTask.explicitRefs = [dataInitialRef, schemaInitialRef, staleInitialRef];
  fixture.expectedProjection.currentTask.selectedRefs = [
    fixture.expectedProjection.currentTask.currentTurnRef,
    dataInitialRef,
    schemaInitialRef,
    staleInitialRef,
  ];

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const artifacts = schemaDriftArtifacts(fixture.scenarioId, fixture.runId, dataTable, schemaFile);
  const objectReferences = schemaDriftObjectReferences(fixture.runId, dataTable, schemaFile);
  const projection = schemaDriftProjection(fixture.expectedProjection, artifacts, dataTable, schemaFile, fixedNow);
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.artifactDelivery = artifactDeliveryProjection(artifacts);
  fixture.expectedProjection.runAuditRefs = uniqueStrings([
    runAuditRef,
    diagnosticLogRef,
    'offline-web-e2e-fixture://sa-web-21/read-ref/generic-analysis',
    'offline-web-e2e-fixture://sa-web-21/read-ref/reveal-confounder',
    'offline-web-e2e-fixture://sa-web-21/read-ref/export-method',
    staleAnalysisRef,
    validRefsManifestRef,
    codeFileRef,
  ]);

  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = schemaDriftSession({
    session,
    projection,
    artifacts,
    objectReferences,
    dataTable,
    fixedNow,
  });
}

function schemaDriftSession(input: {
  session: SciForgeSession;
  projection: ConversationProjection;
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
  dataTable: DriftDataFixture;
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
    prompt: roundPrompts['export-method'],
    response: input.projection.visibleAnswer?.text ?? 'Schema drift reinterpretation completed.',
    completedAt: input.fixedNow,
    objectReferences: input.objectReferences,
    raw: {
      displayIntent: {
        primaryGoal: 'Render schema drift confounder reinterpretation from Projection and refs-first artifacts.',
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
    title: 'Schema drift confounder Web E2E case',
    messages: input.session.messages.map((message) => {
      if (message.role === 'user') {
        return {
          ...message,
          content: roundPrompts['generic-analysis'],
          objectReferences: input.objectReferences.filter((ref) => [input.dataTable.ref, staleAnalysisRef].includes(ref.ref)),
        };
      }
      if (message.role === 'scenario') {
        return {
          ...message,
          content: input.projection.visibleAnswer?.text ?? 'Schema drift reinterpretation completed.',
          objectReferences: input.objectReferences.filter((ref) => ref.presentationRole !== 'audit' && ref.presentationRole !== 'diagnostic' && ref.presentationRole !== 'internal'),
          status: 'completed',
        };
      }
      return message;
    }),
    runs: [nextRun],
    uiManifest: [
      { componentId: 'report-viewer', title: 'Method section', artifactRef: 'sa-web-21-method-section', priority: 1 },
      { componentId: 'report-viewer', title: 'Confounder reinterpretation', artifactRef: 'sa-web-21-confounder-reinterpretation-report', priority: 2 },
      { componentId: 'record-table', title: 'Valid/stale refs manifest', artifactRef: 'sa-web-21-valid-stale-refs', priority: 3 },
    ],
    executionUnits: schemaDriftExecutionUnits(input.fixedNow),
    artifacts: input.artifacts,
    updatedAt: input.fixedNow,
  };
}

function schemaDriftProjection(
  expected: WebE2eExpectedProjection,
  artifacts: RuntimeArtifact[],
  dataTable: DriftDataFixture,
  schemaFile: DriftSchemaFixture,
  fixedNow: string,
): ConversationProjection {
  const artifactRefs = artifacts
    .filter((artifact) => artifact.delivery?.role === 'primary-deliverable' || artifact.delivery?.role === 'supporting-evidence')
    .map((artifact): ConversationRef => ({
      ref: artifact.delivery?.ref ?? `artifact:${artifact.id}`,
      mime: artifact.delivery?.declaredMediaType,
      label: String(artifact.metadata?.title ?? artifact.id),
      sizeBytes: artifact.id === 'sa-web-21-generic-data' ? dataTable.sizeBytes : undefined,
    }));
  return {
    ...expected.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: 'Schema drift reinterpretation completed: x2 is treated as site/batch confounder, data and cleaning refs remain valid, and the earlier generic effect interpretation is marked stale for inference.',
      artifactRefs: [methodSectionRef, reinterpretationReportRef, validRefsManifestRef, dataTable.ref, schemaFile.ref],
    },
    activeRun: { id: expected.runId, status: 'satisfied' },
    artifacts: artifactRefs,
    executionProcess: [
      {
        eventId: 'sa-web-21-generic-analysis',
        type: 'OutputMaterialized',
        summary: 'Generic QC and missingness summary created without hard-coded semantics.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-21-reveal-confounder',
        type: 'OutputMaterialized',
        summary: 'x2 reinterpreted as site/batch confounder and stale interpretation refs quarantined.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-21-export-method',
        type: 'Satisfied',
        summary: 'Notebook-style method section and valid/stale refs manifest exported.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs: [
      runAuditRef,
      diagnosticLogRef,
      'offline-web-e2e-fixture://sa-web-21/read-ref/generic-analysis',
      'offline-web-e2e-fixture://sa-web-21/read-ref/reveal-confounder',
      'offline-web-e2e-fixture://sa-web-21/read-ref/export-method',
      staleAnalysisRef,
      codeFileRef,
    ],
    diagnostics: [{
      severity: 'info',
      code: 'schema-drift-confounder-reinterpretation',
      message: 'Earlier generic QC refs remain valid; earlier generic effect interpretation is stale after x2 is revealed as site/batch.',
      refs: [{ ref: dataTable.ref }, { ref: schemaFile.ref }, { ref: staleAnalysisRef }, { ref: validRefsManifestRef }],
    }],
  };
}

function schemaDriftArtifacts(
  scenario: string,
  run: string,
  dataTable: DriftDataFixture,
  schemaFile: DriftSchemaFixture,
): RuntimeArtifact[] {
  return [
    artifact('sa-web-21-generic-data', 'generic-data-table', scenario, run, 'Generic schema-drift data table', dataTable.relPath, 'supporting-evidence', 'text/csv', 'csv', 'raw-file', 'open-system'),
    artifact('sa-web-21-schema-v2', 'schema-manifest', scenario, run, 'Updated schema v2', schemaFile.relPath, 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-21-cleaning-summary', 'cleaning-summary', scenario, run, 'Cleaning summary', '.sciforge/task-results/sa-web-21-cleaning-summary.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-21-round1-generic-report', 'stale-analysis-report', scenario, run, 'Round 1 generic interpretation', '.sciforge/task-results/sa-web-21-round1-generic-report.md', 'audit', 'text/markdown', 'md', 'raw-file', 'audit-only'),
    artifact('sa-web-21-confounder-reinterpretation-report', 'confounder-reinterpretation-report', scenario, run, 'Confounder reinterpretation report', '.sciforge/task-results/sa-web-21-confounder-reinterpretation.md', 'supporting-evidence', 'text/markdown', 'md'),
    artifact('sa-web-21-method-section', 'method-section', scenario, run, 'Notebook-style method section', '.sciforge/task-results/sa-web-21-method-section.md', 'primary-deliverable', 'text/markdown', 'md'),
    artifact('sa-web-21-valid-stale-refs', 'valid-stale-refs-manifest', scenario, run, 'Valid/stale refs manifest', '.sciforge/task-results/sa-web-21-valid-stale-refs.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-21-method-code', 'method-code', scenario, run, 'Method section code', '.sciforge/tasks/sa-web-21-method-section.ts', 'supporting-evidence', 'text/typescript', 'ts', 'raw-file', 'open-system'),
    artifact('sa-web-21-run-audit', 'run-audit', scenario, run, 'Schema drift RunAudit', '.sciforge/task-results/current-run-audit.json', 'audit', 'application/json', 'json', 'raw-file', 'audit-only'),
    artifact('sa-web-21-diagnostic-log', 'diagnostic-log', scenario, run, 'Schema drift diagnostic log', '.sciforge/logs/current-run.stderr.log', 'diagnostic', 'text/plain', 'log', 'raw-file', 'audit-only'),
    artifact('sa-web-21-provider-manifest', 'provider-manifest', scenario, run, 'Provider manifest', '.sciforge/provider-manifest.json', 'internal', 'application/json', 'json', 'raw-file', 'unsupported'),
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

function schemaDriftObjectReferences(run: string, dataTable: DriftDataFixture, schemaFile: DriftSchemaFixture): ObjectReference[] {
  return [
    objectReference('file-sa-web-21-generic-data', 'Generic schema-drift data table', 'file', dataTable.ref, 'generic-data-table', 'supporting-evidence', run, dataTable.sizeBytes),
    objectReference('file-sa-web-21-schema-v2', 'Updated schema v2', 'file', schemaFile.ref, 'schema-manifest', 'supporting-evidence', run, schemaFile.sizeBytes),
    objectReference('object-sa-web-21-cleaning-summary', 'Cleaning summary', 'artifact', cleaningSummaryRef, 'cleaning-summary', 'supporting-evidence', run),
    objectReference('object-sa-web-21-round1-generic-report', 'Round 1 generic interpretation', 'artifact', staleAnalysisRef, 'stale-analysis-report', 'audit', run),
    objectReference('object-sa-web-21-reinterpretation', 'Confounder reinterpretation report', 'artifact', reinterpretationReportRef, 'confounder-reinterpretation-report', 'supporting-evidence', run),
    objectReference('object-sa-web-21-method-section', 'Notebook-style method section', 'artifact', methodSectionRef, 'method-section', 'primary-deliverable', run),
    objectReference('object-sa-web-21-valid-stale-refs', 'Valid/stale refs manifest', 'artifact', validRefsManifestRef, 'valid-stale-refs-manifest', 'supporting-evidence', run),
    objectReference('object-sa-web-21-method-code', 'Method section code', 'artifact', codeRef, 'method-code', 'supporting-evidence', run),
    objectReference('object-sa-web-21-run-audit', 'Schema drift RunAudit', 'artifact', runAuditRef, 'run-audit', 'audit', run),
    objectReference('object-sa-web-21-diagnostic-log', 'Schema drift diagnostic log', 'artifact', diagnosticLogRef, 'diagnostic-log', 'diagnostic', run),
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
    preferredView: artifactType.includes('manifest') || artifactType.includes('summary') || artifactType.includes('table') ? 'record-table' : artifactType.includes('code') ? 'code-viewer' : 'report-viewer',
    presentationRole,
    actions: kind === 'file' ? ['inspect', 'copy-path'] : ['focus-right-pane', 'copy-path'],
    status: 'available',
    provenance: { dataRef: ref.replace(/^file:/, ''), size },
  };
}

function schemaDriftExecutionUnits(fixedNow: string): RuntimeExecutionUnit[] {
  return [
    {
      id: 'EU-sa-web-21-read-ref-generic-analysis',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-21-generic-observations.csv round=generic-analysis',
      status: 'done',
      hash: 'sa-web-21-read-ref-generic-analysis',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-21/read-ref/generic-analysis',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-21-read-ref-reveal-confounder',
      tool: readRefTool,
      params: 'refs=data,schema round=reveal-confounder stalePolicy=qc-only-not-inference',
      status: 'done',
      hash: 'sa-web-21-read-ref-reveal-confounder',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-21/read-ref/reveal-confounder',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-21-read-ref-export-method',
      tool: readRefTool,
      params: 'refs=data,schema round=export-method stalePolicy=qc-only-not-inference',
      status: 'done',
      hash: 'sa-web-21-read-ref-export-method',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-21/read-ref/export-method',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-21-export-method',
      tool: 'analysis.export.method-section',
      params: `method=${methodSectionRef} validStaleRefs=${validRefsManifestRef} stale=${staleAnalysisRef} code=${codeFileRef}`,
      status: 'done',
      hash: 'sa-web-21-export-method',
      runId,
      outputRef: 'file:.sciforge/task-results/sa-web-21-method-section.md',
      outputArtifacts: [
        'sa-web-21-method-section',
        'sa-web-21-valid-stale-refs',
        'sa-web-21-method-code',
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

function assertValidAndStaleRefs(request: JsonRecord, result: SchemaDriftConfounderCaseResult): void {
  const staleRefs = request.staleRefs;
  assert.ok(Array.isArray(staleRefs) && staleRefs.includes(result.staleAnalysisRef), 'request must carry stale refs explicitly');
  const validRefs = request.validRefs;
  assert.ok(Array.isArray(validRefs) && validRefs.includes(result.dataTable.ref), 'request must carry valid data refs explicitly');
  assert.equal(validRefs.includes(result.staleAnalysisRef), false, 'stale refs must not be listed as valid refs');
  const reinterpretation = isRecord(request.reinterpretation) ? request.reinterpretation : {};
  const staleEarlierRefs = reinterpretation.staleEarlierRefs;
  assert.ok(Array.isArray(staleEarlierRefs) && staleEarlierRefs.includes(result.staleAnalysisRef), 'reinterpretation must identify stale earlier refs');
  const validEarlierRefs = reinterpretation.validEarlierRefs;
  assert.ok(Array.isArray(validEarlierRefs) && validEarlierRefs.includes(result.dataTable.ref), 'reinterpretation must identify valid earlier refs');
  if (request.round !== 'generic-analysis') {
    assert.equal(reinterpretation.confounderColumn, 'x2');
    assert.equal(reinterpretation.confounderMeaning, 'site/batch');
    assert.ok(Array.isArray(validEarlierRefs) && validEarlierRefs.includes(result.schemaFile.ref), 'updated schema ref must be valid after reveal');
  }
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

function roundFromRequest(request: JsonRecord): SchemaDriftRound {
  if (request.round === 'generic-analysis' || request.round === 'reveal-confounder' || request.round === 'export-method') return request.round;
  throw new Error(`Unexpected SA-WEB-21 round: ${String(request.round)}`);
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
