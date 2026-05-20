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

export const TWO_TABLE_LINEAGE_CASE_ID = 'SA-WEB-22';

export interface TwoTableLineageCaseResult {
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  runs: MockRunFetchResult[];
  recordedRunRequests: JsonRecord[];
  readRefCalls: JsonRecord[];
  subjectsTable: TableFixture;
  measurementsTable: TableFixture;
  mappingFile: TableFixture;
  reportRef: string;
  cleanedDataRef: string;
  mappingArtifactRef: string;
  lineageManifestRef: string;
  reproduceCommand: string;
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

interface TableFixture {
  ref: string;
  relPath: string;
  absolutePath: string;
  digest: string;
  sizeBytes: number;
  sentinel?: string;
  rowCount?: number;
}

type TwoTableRound = 'initial-merge' | 'mapping-filter-update' | 'export-lineage';

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-22';
const scenarioId = 'scenario-sa-web-22';
const runId = 'run-sa-web-22-final';
const readRefTool = 'workspace.reader.read_ref';
const reportRef = 'artifact:sa-web-22-merge-report';
const cleanedDataRef = 'artifact:sa-web-22-cleaned-merged-data';
const mappingArtifactRef = 'artifact:sa-web-22-final-mapping';
const lineageManifestRef = 'artifact:sa-web-22-lineage-manifest';
const commandRef = 'artifact:sa-web-22-reproduce-command';
const codeRef = 'artifact:sa-web-22-reproduce-code';
const codeFileRef = 'file:.sciforge/tasks/sa-web-22-reproduce-merge.ts';
const runAuditRef = 'artifact:sa-web-22-run-audit';
const diagnosticLogRef = 'artifact:sa-web-22-diagnostic-log';

const roundPrompts: Record<TwoTableRound, string> = {
  'initial-merge': 'Merge two tables with the provided mapping and preserve lineage for each final column.',
  'mapping-filter-update': 'Update the mapping and filter conditions, then recompute metrics without losing lineage.',
  'export-lineage': 'Export cleaned data, final mapping artifact, lineage manifest, and a reproducibility command.',
};

export async function runTwoTableLineageCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<TwoTableLineageCaseResult> {
  const fixedNow = options.now ?? now;
  const server = await startScriptableAgentServerMock({
    seed: TWO_TABLE_LINEAGE_CASE_ID,
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
      caseId: TWO_TABLE_LINEAGE_CASE_ID,
      baseDir: options.baseDir,
      scenarioId,
      sessionId,
      runId,
      now: fixedNow,
      title: 'Two-table merge lineage Web E2E case',
      prompt: roundPrompts['initial-merge'],
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
    const subjectsTable = await writeSubjectsTable(fixture.workspacePath);
    const measurementsTable = await writeMeasurementsTable(fixture.workspacePath);
    const mappingFile = await writeMappingFile(fixture.workspacePath, subjectsTable, measurementsTable);
    const reproduceCommand = reproducibilityCommand(subjectsTable, measurementsTable, mappingFile);
    await materializeTwoTableArtifacts(fixture.workspacePath, subjectsTable, measurementsTable, mappingFile, reproduceCommand);
    finalizeTwoTableFixture(fixture, subjectsTable, measurementsTable, mappingFile, reproduceCommand, fixedNow);

    const runs: MockRunFetchResult[] = [];
    for (const round of ['initial-merge', 'mapping-filter-update', 'export-lineage'] as const satisfies readonly TwoTableRound[]) {
      runs.push(await fetchRun(server.baseUrl, requestForRound(fixture, subjectsTable, measurementsTable, mappingFile, reproduceCommand, round)));
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
        runId: String(run.resultRun.id ?? `run-sa-web-22-${index + 1}`),
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
        summary: 'Two-table merge exported cleaned data, mapping artifact, lineage manifest, and reproducibility command after mapping/filter changes.',
      },
      extra: {
        subjectsRef: subjectsTable.ref,
        measurementsRef: measurementsTable.ref,
        mappingRef: mappingFile.ref,
        readRefTool,
        readRefCalls: readRefCalls.map((event) => event.input).filter(isRecord),
        reportRef,
        cleanedDataRef,
        mappingArtifactRef,
        lineageManifestRef,
        reproduceCommand,
      },
    });

    const result: TwoTableLineageCaseResult = {
      fixture,
      server,
      runs,
      recordedRunRequests,
      readRefCalls,
      subjectsTable,
      measurementsTable,
      mappingFile,
      reportRef,
      cleanedDataRef,
      mappingArtifactRef,
      lineageManifestRef,
      reproduceCommand,
      browserVisibleState,
      runAudit,
      artifactDeliveryManifest,
      verifierInput,
      evidenceBundle,
    };
    await assertTwoTableLineageCase(result);
    return result;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function assertTwoTableLineageCase(result: TwoTableLineageCaseResult): Promise<void> {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.equal(result.recordedRunRequests.length, 3, 'two-table lineage case should have three user turns');
  assert.equal(result.readRefCalls.length, 9, 'each two-table round must read subjects, measurements, and mapping refs');

  const subjectsText = await readFile(result.subjectsTable.absolutePath, 'utf8');
  assert.match(subjectsText, new RegExp(result.subjectsTable.sentinel ?? ''), 'subjects table must contain the raw prompt sentinel');
  const requestBlob = JSON.stringify(result.recordedRunRequests);
  assert.doesNotMatch(requestBlob, new RegExp(result.subjectsTable.sentinel ?? ''), 'raw runtime-dispatch requests must not contain subjects table contents');
  assert.doesNotMatch(requestBlob, /SUBJ-017,legacy-017,site-b,dropout-risk/i, 'raw runtime-dispatch requests must not contain concrete subject rows');

  for (const request of result.recordedRunRequests) {
    assert.equal(request.leftTableRef, result.subjectsTable.ref);
    assert.equal(request.rightTableRef, result.measurementsTable.ref);
    assert.equal(request.mappingRef, result.mappingFile.ref);
    assert.equal(request.rawLeftTable, undefined);
    assert.equal(request.rawRightTable, undefined);
    assert.equal(request.inlineMapping, undefined);
    const readRefs = request.readRefs;
    assert.ok(Array.isArray(readRefs), 'request must include readRefs');
    assert.deepEqual(readRefs, [result.subjectsTable.ref, result.measurementsTable.ref, result.mappingFile.ref]);
    assertMappingAndFilterPlan(request);
  }

  for (const call of result.readRefCalls) {
    const input = readRefInput(call);
    assert.ok(
      input.ref === result.subjectsTable.ref || input.ref === result.measurementsTable.ref || input.ref === result.mappingFile.ref,
      `unexpected two-table read_ref target ${String(input.ref)}`,
    );
    assert.equal(input.mode, 'bounded-preview');
    assert.equal(input.includeRawRowsInPrompt, false);
  }

  const finalRequest = result.recordedRunRequests.at(-1);
  assert.ok(isRecord(finalRequest), 'final request must exist');
  assert.equal(finalRequest.reproduceCommand, result.reproduceCommand, 'final request must carry the reproducibility command');
  assert.match(String(finalRequest.reproduceCommand ?? ''), /^node --import tsx \.sciforge\/tasks\/sa-web-22-reproduce-merge\.ts /);

  const finalPayload = toolPayloadFromRun(result.runs.at(-1)?.resultRun);
  assert.ok(finalPayload, 'final round must return a tool payload');
  const finalArtifacts = Array.isArray(finalPayload.artifacts) ? finalPayload.artifacts : [];
  for (const expectedRef of [reportRef, cleanedDataRef, mappingArtifactRef, lineageManifestRef, commandRef, codeRef]) {
    assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === expectedRef), `final payload must expose ${expectedRef}`);
  }

  assert.equal(result.browserVisibleState.primaryArtifactRefs?.includes(reportRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(cleanedDataRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(mappingArtifactRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(lineageManifestRef), true);
  assert.equal(result.runAudit.refs.includes(codeFileRef), true, 'RunAudit must retain the reproduce code file ref');

  const lineage = JSON.parse(await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-22-lineage.json'), 'utf8')) as JsonRecord;
  assertLineageManifest(lineage, result);

  const report = await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-22-merge-report.md'), 'utf8');
  assert.match(report, /mapping changed from patient_id to subject_id/i);
  assert.match(report, /filter changed to qc_pass=true and timepoint=week8/i);
  assert.match(report, /node --import tsx \.sciforge\/tasks\/sa-web-22-reproduce-merge\.ts/i);
}

export async function closeTwoTableLineageCase(result: TwoTableLineageCaseResult): Promise<void> {
  await result.server.close();
}

function requestForRound(
  fixture: WebE2eFixtureWorkspace,
  subjectsTable: TableFixture,
  measurementsTable: TableFixture,
  mappingFile: TableFixture,
  reproduceCommand: string,
  round: TwoTableRound,
): JsonRecord {
  const reproduceCommandFields: JsonRecord = round === 'export-lineage' ? { reproduceCommand } : {};
  return {
    caseId: TWO_TABLE_LINEAGE_CASE_ID,
    sessionId: fixture.sessionId,
    scenarioId: fixture.scenarioId,
    round,
    prompt: roundPrompts[round],
    leftTableRef: subjectsTable.ref,
    rightTableRef: measurementsTable.ref,
    mappingRef: mappingFile.ref,
    leftDigest: subjectsTable.digest,
    rightDigest: measurementsTable.digest,
    mappingDigest: mappingFile.digest,
    readRefs: [subjectsTable.ref, measurementsTable.ref, mappingFile.ref],
    requiredTool: readRefTool,
    currentTask: {
      currentTurnRef: refForRequest(fixture.expectedProjection.currentTask.currentTurnRef),
      explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map(refForRequest),
      selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map(refForRequest),
    },
    mergePlan: {
      mappingVersion: round === 'initial-merge' ? 'v1-patient-id' : 'v2-subject-id',
      joinKeyLeft: round === 'initial-merge' ? 'patient_id' : 'subject_id',
      joinKeyRight: round === 'initial-merge' ? 'patient_id' : 'subject_id',
      mappingChanges: round === 'initial-merge'
        ? []
        : ['join key changed from patient_id to subject_id', 'legacy_id retained as audit-only alias'],
      filters: round === 'initial-merge'
        ? { qc_pass: 'any', timepoint: 'any' }
        : { qc_pass: true, timepoint: 'week8' },
      requiredLineage: ['final_column_sources', 'mapping_changes', 'filter_changes', 'input_digests'],
      exportCleanedData: round === 'export-lineage',
      exportLineageManifest: round === 'export-lineage',
    },
    ...reproduceCommandFields,
  };
}

function scriptForRound(round: TwoTableRound, request: JsonRecord, index: number, fixedNow: string) {
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
        includeRawRowsInPrompt: false,
        purpose: `two-table-${round}`,
      },
    },
  }));
  return {
    id: `sa-web-22-${round}`,
    runId: `run-sa-web-22-${String(index + 1).padStart(2, '0')}-${round}`,
    steps: [
      { kind: 'status' as const, status: 'running', message: `Reading two-table refs for ${round}.` },
      ...readEvents,
      { kind: 'toolPayload' as const, payload: toolPayloadForRound(round, fixedNow) },
    ],
  };
}

function toolPayloadForRound(round: TwoTableRound, fixedNow: string): ScriptableAgentServerToolPayload {
  const base = {
    confidence: 0.91,
    claimType: 'lineage',
    evidenceLevel: 'offline-web-e2e-fixture-two-table-lineage',
    claims: [{
      id: `claim-sa-web-22-${round}`,
      text: `Round ${round} preserved two-table mapping, filters, and lineage refs.`,
      refs: [lineageManifestRef],
      createdAt: fixedNow,
    }],
  };
  if (round === 'initial-merge') {
    return {
      ...base,
      message: 'Initial two-table merge completed with v1 patient_id mapping and lineage placeholders.',
      reasoningTrace: 'SA-WEB-22 initial round read both tables and mapping by ref.',
      uiManifest: [{ componentId: 'record-table', title: 'Initial merge preview', artifactRef: 'sa-web-22-initial-merge-preview', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-22-initial-merge', tool: readRefTool, status: 'done', outputRef: 'offline-web-e2e-fixture://sa-web-22/read-ref/initial-merge' }],
      artifacts: [{ id: 'sa-web-22-initial-merge-preview', deliveryRef: 'artifact:sa-web-22-initial-merge-preview' }],
    };
  }
  if (round === 'mapping-filter-update') {
    return {
      ...base,
      message: 'Mapping updated to subject_id and filters changed to qc_pass=true plus timepoint=week8; metrics recomputed with lineage.',
      reasoningTrace: 'SA-WEB-22 update round changed mapping/filter rules and retained input refs.',
      uiManifest: [{ componentId: 'record-table', title: 'Updated merge metrics', artifactRef: 'sa-web-22-updated-metrics', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-22-mapping-filter-update', tool: 'analysis.merge.recompute', status: 'done', outputRef: 'artifact:sa-web-22-updated-metrics' }],
      artifacts: [{ id: 'sa-web-22-updated-metrics', deliveryRef: 'artifact:sa-web-22-updated-metrics' }],
    };
  }
  return {
    ...base,
    message: 'Cleaned data, final mapping, lineage manifest, reproducibility command, and rerun code exported.',
    reasoningTrace: 'SA-WEB-22 final round exported a reproducible lineage bundle.',
    uiManifest: [
      { componentId: 'report-viewer', title: 'Two-table merge report', artifactRef: 'sa-web-22-merge-report', priority: 1 },
      { componentId: 'record-table', title: 'Lineage manifest', artifactRef: 'sa-web-22-lineage-manifest', priority: 2 },
      { componentId: 'code-viewer', title: 'Reproduce merge code', artifactRef: 'sa-web-22-reproduce-code', priority: 3 },
    ],
    executionUnits: [{
      id: 'EU-sa-web-22-export-lineage',
      tool: 'analysis.merge.export-lineage',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/sa-web-22-lineage.json',
      outputArtifacts: [
        'sa-web-22-merge-report',
        'sa-web-22-cleaned-merged-data',
        'sa-web-22-final-mapping',
        'sa-web-22-lineage-manifest',
        'sa-web-22-reproduce-command',
        'sa-web-22-reproduce-code',
      ],
      codeRefs: [codeFileRef],
    }],
    artifacts: [
      { id: 'sa-web-22-merge-report', deliveryRef: reportRef, dataRef: '.sciforge/task-results/sa-web-22-merge-report.md' },
      { id: 'sa-web-22-cleaned-merged-data', deliveryRef: cleanedDataRef, dataRef: '.sciforge/task-results/sa-web-22-cleaned-merged.csv' },
      { id: 'sa-web-22-final-mapping', deliveryRef: mappingArtifactRef, dataRef: '.sciforge/task-results/sa-web-22-final-mapping.json' },
      { id: 'sa-web-22-lineage-manifest', deliveryRef: lineageManifestRef, dataRef: '.sciforge/task-results/sa-web-22-lineage.json' },
      { id: 'sa-web-22-reproduce-command', deliveryRef: commandRef, dataRef: '.sciforge/task-results/sa-web-22-reproduce-command.txt' },
      { id: 'sa-web-22-reproduce-code', deliveryRef: codeRef, dataRef: '.sciforge/tasks/sa-web-22-reproduce-merge.ts' },
    ],
  };
}

async function writeSubjectsTable(workspacePath: string): Promise<TableFixture> {
  const relPath = '.sciforge/artifacts/sa-web-22-subjects.csv';
  const absolutePath = join(workspacePath, relPath);
  const sentinel = 'SA_WEB_22_SUBJECT_SENTINEL_DO_NOT_INLINE';
  const rows = ['subject_id,patient_id,site,risk_group'];
  for (let index = 1; index <= 40; index += 1) {
    const site = index % 2 === 0 ? 'site-a' : 'site-b';
    const risk = index === 17 ? `dropout-risk-${sentinel}` : index % 5 === 0 ? 'high' : 'standard';
    rows.push(`SUBJ-${String(index).padStart(3, '0')},legacy-${String(index).padStart(3, '0')},${site},${risk}`);
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

async function writeMeasurementsTable(workspacePath: string): Promise<TableFixture> {
  const relPath = '.sciforge/artifacts/sa-web-22-measurements.csv';
  const absolutePath = join(workspacePath, relPath);
  const rows = ['subject_id,patient_id,timepoint,qc_pass,score'];
  for (let index = 1; index <= 40; index += 1) {
    for (const timepoint of ['baseline', 'week8']) {
      const qcPass = index % 13 === 0 && timepoint === 'week8' ? 'false' : 'true';
      const score = 20 + (index % 8) * 1.5 + (timepoint === 'week8' ? 4.2 : 0);
      rows.push(`SUBJ-${String(index).padStart(3, '0')},legacy-${String(index).padStart(3, '0')},${timepoint},${qcPass},${score.toFixed(1)}`);
    }
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
    rowCount: rows.length - 1,
  };
}

async function writeMappingFile(workspacePath: string, subjectsTable: TableFixture, measurementsTable: TableFixture): Promise<TableFixture> {
  const relPath = '.sciforge/artifacts/sa-web-22-mapping.json';
  const absolutePath = join(workspacePath, relPath);
  const content = `${JSON.stringify({
    schemaVersion: 'sciforge.web-e2e.two-table-mapping.v2',
    sources: {
      subjects: subjectsTable.ref,
      measurements: measurementsTable.ref,
    },
    versions: {
      v1: { joinKeyLeft: 'patient_id', joinKeyRight: 'patient_id' },
      v2: { joinKeyLeft: 'subject_id', joinKeyRight: 'subject_id', legacyIdRole: 'audit-only alias' },
    },
    finalVersion: 'v2',
    filters: { qc_pass: true, timepoint: 'week8' },
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

function reproducibilityCommand(subjectsTable: TableFixture, measurementsTable: TableFixture, mappingFile: TableFixture): string {
  return [
    'node --import tsx .sciforge/tasks/sa-web-22-reproduce-merge.ts',
    `--left ${subjectsTable.relPath}`,
    `--right ${measurementsTable.relPath}`,
    `--mapping ${mappingFile.relPath}`,
    '--join-key subject_id',
    '--filter qc_pass=true',
    '--filter timepoint=week8',
  ].join(' ');
}

async function materializeTwoTableArtifacts(
  workspacePath: string,
  subjectsTable: TableFixture,
  measurementsTable: TableFixture,
  mappingFile: TableFixture,
  reproduceCommand: string,
): Promise<void> {
  await mkdir(join(workspacePath, '.sciforge/task-results'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/tasks'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/logs'), { recursive: true });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-22-cleaned-merged.csv'),
    [
      'subject_id,site,risk_group,timepoint,score,source_subject_ref,source_measurement_ref,filter_rule',
      `SUBJ-001,site-b,standard,week8,25.7,${subjectsTable.ref},${measurementsTable.ref},qc_pass=true;timepoint=week8`,
      `SUBJ-002,site-a,standard,week8,27.2,${subjectsTable.ref},${measurementsTable.ref},qc_pass=true;timepoint=week8`,
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-22-final-mapping.json'), {
    schemaVersion: 'sciforge.web-e2e.two-table-final-mapping.v1',
    sourceMappingRef: mappingFile.ref,
    finalVersion: 'v2-subject-id',
    joinKeyLeft: 'subject_id',
    joinKeyRight: 'subject_id',
    legacyIdRole: 'audit-only alias',
    filters: { qc_pass: true, timepoint: 'week8' },
  });
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-22-lineage.json'), {
    schemaVersion: 'sciforge.web-e2e.two-table-lineage.v1',
    sourceRefs: {
      subjects: subjectsTable.ref,
      measurements: measurementsTable.ref,
      mapping: mappingFile.ref,
    },
    inputDigests: {
      subjects: subjectsTable.digest,
      measurements: measurementsTable.digest,
      mapping: mappingFile.digest,
    },
    mappingChanges: [
      { from: 'patient_id', to: 'subject_id', reason: 'user updated mapping to stable subject_id' },
      { field: 'patient_id', role: 'audit-only alias' },
    ],
    filterChanges: [
      { field: 'qc_pass', from: 'any', to: true },
      { field: 'timepoint', from: 'any', to: 'week8' },
    ],
    finalColumns: [
      { name: 'subject_id', sourceRef: subjectsTable.ref, sourceColumn: 'subject_id' },
      { name: 'site', sourceRef: subjectsTable.ref, sourceColumn: 'site' },
      { name: 'risk_group', sourceRef: subjectsTable.ref, sourceColumn: 'risk_group' },
      { name: 'timepoint', sourceRef: measurementsTable.ref, sourceColumn: 'timepoint' },
      { name: 'score', sourceRef: measurementsTable.ref, sourceColumn: 'score' },
      { name: 'filter_rule', sourceRef: mappingFile.ref, sourceColumn: 'filters' },
    ],
    cleanedDataRef,
    mappingArtifactRef,
    reproducibilityCommand: reproduceCommand,
  });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-22-merge-report.md'),
    [
      '# SA-WEB-22 Two-Table Merge Report',
      '',
      `subjects ref: ${subjectsTable.ref}`,
      `measurements ref: ${measurementsTable.ref}`,
      `mapping ref: ${mappingFile.ref}`,
      'mapping changed from patient_id to subject_id.',
      'filter changed to qc_pass=true and timepoint=week8.',
      `lineage manifest: ${lineageManifestRef}`,
      `reproduce: ${reproduceCommand}`,
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(join(workspacePath, '.sciforge/task-results/sa-web-22-reproduce-command.txt'), `${reproduceCommand}\n`, 'utf8');
  await writeFile(
    join(workspacePath, '.sciforge/tasks/sa-web-22-reproduce-merge.ts'),
    [
      'const args = new Set(process.argv.slice(2));',
      'if (!args.has("--join-key")) throw new Error("missing join key");',
      'if (!process.argv.join(" ").includes("subject_id")) throw new Error("expected subject_id mapping");',
      'if (!process.argv.join(" ").includes("qc_pass=true")) throw new Error("expected qc filter");',
      'console.log("reproduced SA-WEB-22 merge lineage bundle");',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/current-run-audit.json'), {
    schemaVersion: 'sciforge.web-e2e.two-table-run-audit.v1',
    runId,
    sourceRefs: [subjectsTable.ref, measurementsTable.ref, mappingFile.ref],
    exportedRefs: [reportRef, cleanedDataRef, mappingArtifactRef, lineageManifestRef, commandRef, codeRef],
    reproducibilityCommand: reproduceCommand,
  });
  await writeFile(join(workspacePath, '.sciforge/logs/current-run.stderr.log'), 'two-table fixture: lineage exported without raw table prompts\n', 'utf8');
}

function finalizeTwoTableFixture(
  fixture: WebE2eFixtureWorkspace,
  subjectsTable: TableFixture,
  measurementsTable: TableFixture,
  mappingFile: TableFixture,
  reproduceCommand: string,
  fixedNow: string,
): void {
  const subjectsInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-22-subjects',
    kind: 'file',
    title: 'Subjects table',
    ref: subjectsTable.ref,
    source: 'explicit-selection',
    artifactType: 'subjects-table',
    digest: subjectsTable.digest,
  };
  const measurementsInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-22-measurements',
    kind: 'file',
    title: 'Measurements table',
    ref: measurementsTable.ref,
    source: 'explicit-selection',
    artifactType: 'measurements-table',
    digest: measurementsTable.digest,
  };
  const mappingInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-22-mapping',
    kind: 'file',
    title: 'Mapping rules',
    ref: mappingFile.ref,
    source: 'explicit-selection',
    artifactType: 'mapping-rules',
    digest: mappingFile.digest,
  };
  fixture.initialRefs.push(subjectsInitialRef, measurementsInitialRef, mappingInitialRef);
  fixture.expectedProjection.currentTask.explicitRefs = [subjectsInitialRef, measurementsInitialRef, mappingInitialRef];
  fixture.expectedProjection.currentTask.selectedRefs = [
    fixture.expectedProjection.currentTask.currentTurnRef,
    subjectsInitialRef,
    measurementsInitialRef,
    mappingInitialRef,
  ];

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const artifacts = twoTableArtifacts(fixture.scenarioId, fixture.runId, subjectsTable, measurementsTable, mappingFile);
  const objectReferences = twoTableObjectReferences(fixture.runId, subjectsTable, measurementsTable, mappingFile);
  const projection = twoTableProjection(fixture.expectedProjection, artifacts, subjectsTable, measurementsTable, mappingFile, reproduceCommand, fixedNow);
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.artifactDelivery = artifactDeliveryProjection(artifacts);
  fixture.expectedProjection.runAuditRefs = uniqueStrings([
    runAuditRef,
    diagnosticLogRef,
    'offline-web-e2e-fixture://sa-web-22/read-ref/initial-merge',
    'offline-web-e2e-fixture://sa-web-22/read-ref/mapping-filter-update',
    'offline-web-e2e-fixture://sa-web-22/read-ref/export-lineage',
    lineageManifestRef,
    commandRef,
    codeFileRef,
  ]);

  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = twoTableSession({
    session,
    projection,
    artifacts,
    objectReferences,
    subjectsTable,
    fixedNow,
  });
}

function twoTableSession(input: {
  session: SciForgeSession;
  projection: ConversationProjection;
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
  subjectsTable: TableFixture;
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
    prompt: roundPrompts['export-lineage'],
    response: input.projection.visibleAnswer?.text ?? 'Two-table merge lineage completed.',
    completedAt: input.fixedNow,
    objectReferences: input.objectReferences,
    raw: {
      displayIntent: {
        primaryGoal: 'Render two-table merge lineage from Projection and refs-first artifacts.',
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
    title: 'Two-table merge lineage Web E2E case',
    messages: input.session.messages.map((message) => {
      if (message.role === 'user') {
        return {
          ...message,
          content: roundPrompts['initial-merge'],
          objectReferences: input.objectReferences.filter((ref) => ref.ref === input.subjectsTable.ref || ref.artifactType === 'measurements-table' || ref.artifactType === 'mapping-rules'),
        };
      }
      if (message.role === 'scenario') {
        return {
          ...message,
          content: input.projection.visibleAnswer?.text ?? 'Two-table merge lineage completed.',
          objectReferences: input.objectReferences.filter((ref) => ref.presentationRole !== 'audit' && ref.presentationRole !== 'diagnostic' && ref.presentationRole !== 'internal'),
          status: 'completed',
        };
      }
      return message;
    }),
    runs: [nextRun],
    uiManifest: [
      { componentId: 'report-viewer', title: 'Two-table merge report', artifactRef: 'sa-web-22-merge-report', priority: 1 },
      { componentId: 'record-table', title: 'Lineage manifest', artifactRef: 'sa-web-22-lineage-manifest', priority: 2 },
      { componentId: 'code-viewer', title: 'Reproduce merge code', artifactRef: 'sa-web-22-reproduce-code', priority: 3 },
    ],
    executionUnits: twoTableExecutionUnits(input.fixedNow),
    artifacts: input.artifacts,
    updatedAt: input.fixedNow,
  };
}

function twoTableProjection(
  expected: WebE2eExpectedProjection,
  artifacts: RuntimeArtifact[],
  subjectsTable: TableFixture,
  measurementsTable: TableFixture,
  mappingFile: TableFixture,
  reproduceCommand: string,
  fixedNow: string,
): ConversationProjection {
  const artifactRefs = artifacts
    .filter((artifact) => artifact.delivery?.role === 'primary-deliverable' || artifact.delivery?.role === 'supporting-evidence')
    .map((artifact): ConversationRef => ({
      ref: artifact.delivery?.ref ?? `artifact:${artifact.id}`,
      mime: artifact.delivery?.declaredMediaType,
      label: String(artifact.metadata?.title ?? artifact.id),
      sizeBytes: artifact.id === 'sa-web-22-subjects' ? subjectsTable.sizeBytes : undefined,
    }));
  return {
    ...expected.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: `Two-table merge lineage completed: mapping changed from patient_id to subject_id, filters changed to qc_pass=true and timepoint=week8, and the bundle includes reproducibility command ${reproduceCommand}.`,
      artifactRefs: [reportRef, cleanedDataRef, mappingArtifactRef, lineageManifestRef, commandRef, codeRef, subjectsTable.ref, measurementsTable.ref, mappingFile.ref],
    },
    activeRun: { id: expected.runId, status: 'satisfied' },
    artifacts: artifactRefs,
    executionProcess: [
      {
        eventId: 'sa-web-22-initial-merge',
        type: 'OutputMaterialized',
        summary: 'Initial two-table merge created from subjects, measurements, and mapping refs.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-22-mapping-filter-update',
        type: 'OutputMaterialized',
        summary: 'Mapping changed to subject_id and filters changed to qc_pass=true plus week8.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-22-export-lineage',
        type: 'Satisfied',
        summary: 'Cleaned data, mapping artifact, lineage manifest, command, and code exported.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs: [
      runAuditRef,
      diagnosticLogRef,
      'offline-web-e2e-fixture://sa-web-22/read-ref/initial-merge',
      'offline-web-e2e-fixture://sa-web-22/read-ref/mapping-filter-update',
      'offline-web-e2e-fixture://sa-web-22/read-ref/export-lineage',
      lineageManifestRef,
      commandRef,
      codeFileRef,
    ],
    diagnostics: [{
      severity: 'info',
      code: 'two-table-lineage-reproducibility',
      message: 'Every final column and filter rule is traceable to source refs and the exported command.',
      refs: [{ ref: subjectsTable.ref }, { ref: measurementsTable.ref }, { ref: mappingFile.ref }, { ref: lineageManifestRef }, { ref: codeFileRef }],
    }],
  };
}

function twoTableArtifacts(
  scenario: string,
  run: string,
  subjectsTable: TableFixture,
  measurementsTable: TableFixture,
  mappingFile: TableFixture,
): RuntimeArtifact[] {
  return [
    artifact('sa-web-22-subjects', 'subjects-table', scenario, run, 'Subjects table', subjectsTable.relPath, 'supporting-evidence', 'text/csv', 'csv', 'raw-file', 'open-system'),
    artifact('sa-web-22-measurements', 'measurements-table', scenario, run, 'Measurements table', measurementsTable.relPath, 'supporting-evidence', 'text/csv', 'csv', 'raw-file', 'open-system'),
    artifact('sa-web-22-source-mapping', 'mapping-rules', scenario, run, 'Source mapping rules', mappingFile.relPath, 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-22-merge-report', 'merge-report', scenario, run, 'Two-table merge report', '.sciforge/task-results/sa-web-22-merge-report.md', 'primary-deliverable', 'text/markdown', 'md'),
    artifact('sa-web-22-cleaned-merged-data', 'cleaned-merged-data', scenario, run, 'Cleaned merged data', '.sciforge/task-results/sa-web-22-cleaned-merged.csv', 'supporting-evidence', 'text/csv', 'csv'),
    artifact('sa-web-22-final-mapping', 'final-mapping', scenario, run, 'Final mapping artifact', '.sciforge/task-results/sa-web-22-final-mapping.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-22-lineage-manifest', 'lineage-manifest', scenario, run, 'Lineage manifest', '.sciforge/task-results/sa-web-22-lineage.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-22-reproduce-command', 'reproduce-command', scenario, run, 'Reproducibility command', '.sciforge/task-results/sa-web-22-reproduce-command.txt', 'supporting-evidence', 'text/plain', 'txt'),
    artifact('sa-web-22-reproduce-code', 'reproduce-code', scenario, run, 'Reproduce merge code', '.sciforge/tasks/sa-web-22-reproduce-merge.ts', 'supporting-evidence', 'text/typescript', 'ts', 'raw-file', 'open-system'),
    artifact('sa-web-22-run-audit', 'run-audit', scenario, run, 'Two-table RunAudit', '.sciforge/task-results/current-run-audit.json', 'audit', 'application/json', 'json', 'raw-file', 'audit-only'),
    artifact('sa-web-22-diagnostic-log', 'diagnostic-log', scenario, run, 'Two-table diagnostic log', '.sciforge/logs/current-run.stderr.log', 'diagnostic', 'text/plain', 'log', 'raw-file', 'audit-only'),
    artifact('sa-web-22-provider-manifest', 'provider-manifest', scenario, run, 'Provider manifest', '.sciforge/provider-manifest.json', 'internal', 'application/json', 'json', 'raw-file', 'unsupported'),
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

function twoTableObjectReferences(
  run: string,
  subjectsTable: TableFixture,
  measurementsTable: TableFixture,
  mappingFile: TableFixture,
): ObjectReference[] {
  return [
    objectReference('file-sa-web-22-subjects', 'Subjects table', 'file', subjectsTable.ref, 'subjects-table', 'supporting-evidence', run, subjectsTable.sizeBytes),
    objectReference('file-sa-web-22-measurements', 'Measurements table', 'file', measurementsTable.ref, 'measurements-table', 'supporting-evidence', run, measurementsTable.sizeBytes),
    objectReference('file-sa-web-22-mapping', 'Mapping rules', 'file', mappingFile.ref, 'mapping-rules', 'supporting-evidence', run, mappingFile.sizeBytes),
    objectReference('object-sa-web-22-report', 'Two-table merge report', 'artifact', reportRef, 'merge-report', 'primary-deliverable', run),
    objectReference('object-sa-web-22-cleaned', 'Cleaned merged data', 'artifact', cleanedDataRef, 'cleaned-merged-data', 'supporting-evidence', run),
    objectReference('object-sa-web-22-final-mapping', 'Final mapping artifact', 'artifact', mappingArtifactRef, 'final-mapping', 'supporting-evidence', run),
    objectReference('object-sa-web-22-lineage', 'Lineage manifest', 'artifact', lineageManifestRef, 'lineage-manifest', 'supporting-evidence', run),
    objectReference('object-sa-web-22-command', 'Reproducibility command', 'artifact', commandRef, 'reproduce-command', 'supporting-evidence', run),
    objectReference('object-sa-web-22-code', 'Reproduce merge code', 'artifact', codeRef, 'reproduce-code', 'supporting-evidence', run),
    objectReference('object-sa-web-22-run-audit', 'Two-table RunAudit', 'artifact', runAuditRef, 'run-audit', 'audit', run),
    objectReference('object-sa-web-22-diagnostic-log', 'Two-table diagnostic log', 'artifact', diagnosticLogRef, 'diagnostic-log', 'diagnostic', run),
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
    preferredView: artifactType.includes('table') || artifactType.includes('mapping') || artifactType.includes('lineage') ? 'record-table' : artifactType.includes('code') ? 'code-viewer' : 'report-viewer',
    presentationRole,
    actions: kind === 'file' ? ['inspect', 'copy-path'] : ['focus-right-pane', 'copy-path'],
    status: 'available',
    provenance: { dataRef: ref.replace(/^file:/, ''), size },
  };
}

function twoTableExecutionUnits(fixedNow: string): RuntimeExecutionUnit[] {
  return [
    {
      id: 'EU-sa-web-22-read-ref-initial-merge',
      tool: readRefTool,
      params: 'refs=subjects,measurements,mapping round=initial-merge',
      status: 'done',
      hash: 'sa-web-22-read-ref-initial-merge',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-22/read-ref/initial-merge',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-22-read-ref-mapping-filter-update',
      tool: readRefTool,
      params: 'refs=subjects,measurements,mapping joinKey=subject_id filters=qc_pass,timepoint',
      status: 'done',
      hash: 'sa-web-22-read-ref-mapping-filter-update',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-22/read-ref/mapping-filter-update',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-22-read-ref-export-lineage',
      tool: readRefTool,
      params: 'refs=subjects,measurements,mapping export=lineage,command',
      status: 'done',
      hash: 'sa-web-22-read-ref-export-lineage',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-22/read-ref/export-lineage',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-22-export-lineage',
      tool: 'analysis.merge.export-lineage',
      params: `lineage=${lineageManifestRef} command=${commandRef} code=${codeFileRef}`,
      status: 'done',
      hash: 'sa-web-22-export-lineage',
      runId,
      outputRef: 'file:.sciforge/task-results/sa-web-22-lineage.json',
      outputArtifacts: [
        'sa-web-22-merge-report',
        'sa-web-22-cleaned-merged-data',
        'sa-web-22-final-mapping',
        'sa-web-22-lineage-manifest',
        'sa-web-22-reproduce-command',
        'sa-web-22-reproduce-code',
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

function assertMappingAndFilterPlan(request: JsonRecord): void {
  const plan = isRecord(request.mergePlan) ? request.mergePlan : {};
  const requiredLineage = plan.requiredLineage;
  assert.ok(Array.isArray(requiredLineage), 'merge plan must declare required lineage fields');
  for (const required of ['final_column_sources', 'mapping_changes', 'filter_changes', 'input_digests']) {
    assert.ok(requiredLineage.includes(required), `merge plan must include ${required}`);
  }
  if (request.round !== 'initial-merge') {
    assert.equal(plan.mappingVersion, 'v2-subject-id');
    assert.equal(plan.joinKeyLeft, 'subject_id');
    assert.equal(plan.joinKeyRight, 'subject_id');
    const mappingChanges = plan.mappingChanges;
    assert.ok(Array.isArray(mappingChanges) && mappingChanges.some((entry) => String(entry).includes('patient_id to subject_id')), 'merge plan must record mapping changes');
    const filters = isRecord(plan.filters) ? plan.filters : {};
    assert.equal(filters.qc_pass, true);
    assert.equal(filters.timepoint, 'week8');
  }
}

function assertLineageManifest(lineage: JsonRecord, result: TwoTableLineageCaseResult): void {
  assert.equal(lineage.schemaVersion, 'sciforge.web-e2e.two-table-lineage.v1');
  const sourceRefs = isRecord(lineage.sourceRefs) ? lineage.sourceRefs : {};
  assert.equal(sourceRefs.subjects, result.subjectsTable.ref);
  assert.equal(sourceRefs.measurements, result.measurementsTable.ref);
  assert.equal(sourceRefs.mapping, result.mappingFile.ref);
  const mappingChanges = lineage.mappingChanges;
  assert.ok(Array.isArray(mappingChanges), 'lineage manifest must include mapping changes');
  assert.ok(JSON.stringify(mappingChanges).includes('patient_id'), 'lineage manifest must record original patient_id mapping');
  assert.ok(JSON.stringify(mappingChanges).includes('subject_id'), 'lineage manifest must record updated subject_id mapping');
  const filterChanges = lineage.filterChanges;
  assert.ok(Array.isArray(filterChanges), 'lineage manifest must include filter changes');
  assert.ok(JSON.stringify(filterChanges).includes('qc_pass'), 'lineage manifest must record qc_pass filter');
  assert.ok(JSON.stringify(filterChanges).includes('week8'), 'lineage manifest must record timepoint filter');
  const finalColumns = lineage.finalColumns;
  assert.ok(Array.isArray(finalColumns), 'lineage manifest must include final columns');
  for (const column of ['subject_id', 'site', 'risk_group', 'timepoint', 'score', 'filter_rule']) {
    assert.ok(finalColumns.some((entry) => isRecord(entry) && entry.name === column && typeof entry.sourceRef === 'string'), `lineage manifest must trace ${column}`);
  }
  assert.equal(lineage.reproducibilityCommand, result.reproduceCommand);
  assert.match(String(lineage.reproducibilityCommand ?? ''), /^node --import tsx \.sciforge\/tasks\/sa-web-22-reproduce-merge\.ts /);
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

function resultRunFromEnvelope(envelope: JsonRecord | undefined): JsonRecord {
  const result = isRecord(envelope?.result) ? envelope.result : {};
  const data = isRecord(result.data) ? result.data : {};
  return isRecord(data.run) ? data.run : {};
}

function toolPayloadFromRun(run: JsonRecord | undefined): JsonRecord | undefined {
  const output = isRecord(run?.output) ? run.output : undefined;
  return isRecord(output?.toolPayload) ? output.toolPayload : undefined;
}

function roundFromRequest(request: JsonRecord): TwoTableRound {
  if (request.round === 'initial-merge' || request.round === 'mapping-filter-update' || request.round === 'export-lineage') return request.round;
  throw new Error(`Unexpected SA-WEB-22 round: ${String(request.round)}`);
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
