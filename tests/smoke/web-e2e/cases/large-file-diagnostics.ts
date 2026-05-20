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

export const LARGE_FILE_DIAGNOSTICS_CASE_ID = 'SA-WEB-19';

export interface LargeFileDiagnosticsCaseResult {
  fixture: WebE2eFixtureWorkspace;
  server: ScriptableAgentServerMockHandle;
  runs: MockRunFetchResult[];
  recordedRunRequests: JsonRecord[];
  readRefCalls: JsonRecord[];
  largeLog: LargeLogFixture;
  diagnosticReportRef: string;
  readFragmentsRef: string;
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

interface LargeLogFixture {
  ref: string;
  relPath: string;
  absolutePath: string;
  digest: string;
  sizeBytes: number;
  sentinel: string;
  anomalyAnchor: string;
  anomalyLine: number;
  lineCount: number;
}

type LargeFileRound = 'index' | 'anomaly-snippet' | 'export-diagnostics';

const now = '2026-05-20T00:00:00.000Z';
const sessionId = 'session-sa-web-19';
const scenarioId = 'scenario-sa-web-19';
const runId = 'run-sa-web-19-final';
const readRefTool = 'workspace.reader.read_ref';
const diagnosticReportRef = 'artifact:sa-web-19-diagnostic-report';
const readFragmentsRef = 'artifact:sa-web-19-read-fragments';
const logIndexRef = 'artifact:sa-web-19-log-index';
const runAuditRef = 'artifact:sa-web-19-run-audit';
const diagnosticLogRef = 'artifact:sa-web-19-diagnostic-log';

const roundPrompts: Record<LargeFileRound, string> = {
  index: '分析这个大日志，只允许生成摘要、索引和 refs，不要把全文放进 prompt 或 transcript。',
  'anomaly-snippet': '追问 trace-7f9c-window-spike 附近的异常片段，只允许读取 bounded snippet。',
  'export-diagnostics': '导出最终诊断和本轮读取片段清单，清单要证明每次读取都是 bounded refs。',
};

export async function runLargeFileDiagnosticsCase(options: {
  baseDir?: string;
  outputRoot?: string;
  now?: string;
} = {}): Promise<LargeFileDiagnosticsCaseResult> {
  const fixedNow = options.now ?? now;
  const server = await startScriptableAgentServerMock({
    seed: LARGE_FILE_DIAGNOSTICS_CASE_ID,
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
      caseId: LARGE_FILE_DIAGNOSTICS_CASE_ID,
      baseDir: options.baseDir,
      scenarioId,
      sessionId,
      runId,
      now: fixedNow,
      title: 'Large-file bounded diagnostics Web E2E case',
      prompt: roundPrompts.index,
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
    const largeLog = await writeLargeLogFixture(fixture.workspacePath);
    await materializeLargeFileDiagnosticsArtifacts(fixture.workspacePath, largeLog);
    finalizeLargeFileDiagnosticsFixture(fixture, largeLog, fixedNow);

    const runs: MockRunFetchResult[] = [];
    for (const round of ['index', 'anomaly-snippet', 'export-diagnostics'] as const satisfies readonly LargeFileRound[]) {
      runs.push(await fetchRun(server.baseUrl, requestForRound(fixture, largeLog, round)));
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
        runId: String(run.resultRun.id ?? `run-sa-web-19-${index + 1}`),
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
        summary: 'Large log diagnostics used an index plus bounded read_ref snippets, then exported a diagnostic report and read-fragment manifest.',
      },
      extra: {
        largeLogRef: largeLog.ref,
        largeLogDigest: largeLog.digest,
        largeLogSizeBytes: largeLog.sizeBytes,
        readRefTool,
        readRefCalls: readRefCalls.map((event) => event.input).filter(isRecord),
        diagnosticReportRef,
        readFragmentsRef,
        logIndexRef,
      },
    });

    const result: LargeFileDiagnosticsCaseResult = {
      fixture,
      server,
      runs,
      recordedRunRequests,
      readRefCalls,
      largeLog,
      diagnosticReportRef,
      readFragmentsRef,
      browserVisibleState,
      runAudit,
      artifactDeliveryManifest,
      verifierInput,
      evidenceBundle,
    };
    await assertLargeFileDiagnosticsCase(result);
    return result;
  } catch (error) {
    await server.close();
    throw error;
  }
}

export async function assertLargeFileDiagnosticsCase(result: LargeFileDiagnosticsCaseResult): Promise<void> {
  const verification = verifyWebE2eContract(result.verifierInput);
  assert.equal(verification.ok, true, verification.failures.join('\n'));

  assert.equal(result.recordedRunRequests.length, 3, 'large-file diagnostics should have three user turns');
  assert.equal(result.readRefCalls.length, 3, 'each round must use read_ref for index/snippet bounded access');
  assert.ok(result.largeLog.sizeBytes > 64_000, 'large log fixture must be large enough to exercise bounded diagnostics');

  const logText = await readFile(result.largeLog.absolutePath, 'utf8');
  assert.match(logText, new RegExp(result.largeLog.sentinel), 'large log fixture must contain the sentinel that must not enter prompt or transcript');

  const requestBlob = JSON.stringify(result.recordedRunRequests);
  assert.doesNotMatch(requestBlob, new RegExp(result.largeLog.sentinel), 'raw runtime-dispatch requests must not contain large log contents');
  assert.doesNotMatch(requestBlob, /line-1499 background-worker full-text-only/i, 'raw runtime-dispatch requests must not contain unrequested log lines');

  const session = result.fixture.workspaceState.sessionsByScenario[result.fixture.scenarioId];
  const transcriptBlob = JSON.stringify({
    messages: session.messages,
    projection: result.fixture.expectedProjection.conversationProjection,
  });
  assert.doesNotMatch(transcriptBlob, new RegExp(result.largeLog.sentinel), 'GUI transcript and Projection must not contain full large-log sentinel text');
  assert.doesNotMatch(transcriptBlob, /line-1499 background-worker full-text-only/i, 'GUI transcript and Projection must not contain unrequested large-log rows');

  for (const request of result.recordedRunRequests) {
    assert.equal(request.logRef, result.largeLog.ref);
    assert.equal(request.rawLog, undefined);
    assert.equal(request.fullLog, undefined);
    assert.equal(request.inlineLog, undefined);
    assert.equal(request.transcriptBody, undefined);
    assert.equal(request.largeFilePolicy, 'index-and-bounded-snippets-only');
    const readRefs = request.readRefs;
    assert.ok(Array.isArray(readRefs), 'request must include readRefs');
    assert.equal(readRefs.includes(result.largeLog.ref), true, 'request readRefs must include the large log ref');
    assert.ok(!String(request.prompt ?? '').includes(result.largeLog.sentinel), 'prompt must not inline large log data');
  }

  for (const call of result.readRefCalls) {
    const input = readRefInput(call);
    assert.equal(input.ref, result.largeLog.ref);
    assertBoundedReadRefInput(input);
  }

  const finalPayload = toolPayloadFromRun(result.runs.at(-1)?.resultRun);
  assert.ok(finalPayload, 'final round must return a tool payload');
  const finalArtifacts = Array.isArray(finalPayload.artifacts) ? finalPayload.artifacts : [];
  assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === diagnosticReportRef), 'final payload must expose diagnostic report ref');
  assert.ok(finalArtifacts.some((artifact) => isRecord(artifact) && artifact.deliveryRef === readFragmentsRef), 'final payload must expose read-fragment manifest ref');

  assert.equal(result.browserVisibleState.primaryArtifactRefs?.includes(diagnosticReportRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(readFragmentsRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes(logIndexRef), true);
  assert.equal(result.browserVisibleState.supportingArtifactRefs?.includes('artifact:sa-web-19-large-log'), true);
  assert.equal(result.runAudit.refs.includes('offline-web-e2e-fixture://sa-web-19/read-ref/anomaly-snippet'), true);
  assert.equal(result.runAudit.refs.includes(readFragmentsRef), true);

  const exportedReport = await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-19-diagnostic-report.md'), 'utf8');
  assert.match(exportedReport, /trace-7f9c-window-spike/i);
  assert.match(exportedReport, /read fragments manifest: artifact:sa-web-19-read-fragments/i);
  assert.doesNotMatch(exportedReport, new RegExp(result.largeLog.sentinel), 'diagnostic report must not embed unread full-text sentinel');

  const fragmentManifest = JSON.parse(await readFile(join(result.fixture.workspacePath, '.sciforge/task-results/sa-web-19-read-fragments.json'), 'utf8')) as JsonRecord;
  assertReadFragmentManifest(fragmentManifest, result.largeLog);
}

export async function closeLargeFileDiagnosticsCase(result: LargeFileDiagnosticsCaseResult): Promise<void> {
  await result.server.close();
}

function requestForRound(fixture: WebE2eFixtureWorkspace, log: LargeLogFixture, round: LargeFileRound): JsonRecord {
  return {
    caseId: LARGE_FILE_DIAGNOSTICS_CASE_ID,
    sessionId: fixture.sessionId,
    scenarioId: fixture.scenarioId,
    round,
    prompt: roundPrompts[round],
    logRef: log.ref,
    logDigest: log.digest,
    logSizeBytes: log.sizeBytes,
    readRefs: [log.ref],
    largeFilePolicy: 'index-and-bounded-snippets-only',
    requiredTool: readRefTool,
    currentTask: {
      currentTurnRef: refForRequest(fixture.expectedProjection.currentTask.currentTurnRef),
      explicitRefs: fixture.expectedProjection.currentTask.explicitRefs.map(refForRequest),
      selectedRefs: fixture.expectedProjection.currentTask.selectedRefs.map(refForRequest),
    },
    diagnosticPlan: {
      buildIndex: round === 'index',
      exportDiagnosticReport: round === 'export-diagnostics',
      exportReadFragments: round === 'export-diagnostics',
      maxSnippetBytes: 4096,
      ...(round !== 'index' ? { inspectAnchor: log.anomalyAnchor } : {}),
    },
  };
}

function scriptForRound(round: LargeFileRound, request: JsonRecord, index: number, fixedNow: string) {
  const logRef = String(request.logRef ?? '');
  const input = readRefInputForRound(round, logRef);
  const readEvent = {
    kind: 'event' as const,
    event: {
      type: 'tool-call',
      tool: readRefTool,
      input,
    },
  };
  return {
    id: `sa-web-19-${round}`,
    runId: `run-sa-web-19-${String(index + 1).padStart(2, '0')}-${round}`,
    steps: [
      { kind: 'status' as const, status: 'running', message: `Reading large log through ${input.mode} for ${round}.` },
      readEvent,
      { kind: 'toolPayload' as const, payload: toolPayloadForRound(round, logRef, fixedNow) },
    ],
  };
}

function readRefInputForRound(round: LargeFileRound, logRef: string): JsonRecord {
  if (round === 'index') {
    return {
      ref: logRef,
      mode: 'index-only',
      byteRange: [0, 4096],
      maxBytes: 4096,
      purpose: 'large-log-index',
      includeFullText: false,
    };
  }
  if (round === 'anomaly-snippet') {
    return {
      ref: logRef,
      mode: 'bounded-snippet',
      byteRange: [38320, 41760],
      lineRange: [872, 886],
      maxBytes: 4096,
      anchor: 'trace-7f9c-window-spike',
      purpose: 'inspect-anomaly-window',
      includeFullText: false,
    };
  }
  return {
    ref: logRef,
    mode: 'bounded-snippet',
    byteRange: [38320, 41760],
    lineRange: [872, 886],
    maxBytes: 4096,
    anchor: 'trace-7f9c-window-spike',
    purpose: 'export-fragment-manifest',
    includeFullText: false,
  };
}

function toolPayloadForRound(round: LargeFileRound, logRef: string, fixedNow: string): ScriptableAgentServerToolPayload {
  const base = {
    confidence: 0.9,
    claimType: 'diagnostic',
    evidenceLevel: 'offline-web-e2e-fixture-large-file-diagnostics',
    claims: [{
      id: `claim-sa-web-19-${round}`,
      text: `Round ${round} used ${logRef} through index or bounded read_ref snippets.`,
      refs: [logRef],
      createdAt: fixedNow,
    }],
  };
  if (round === 'index') {
    return {
      ...base,
      message: 'Large log indexed without foreground full-text ingestion: 1,520 lines, 3 anomaly clusters, source retained as ref.',
      reasoningTrace: 'SA-WEB-19 index round consumed metadata and bounded prefix only.',
      uiManifest: [{ componentId: 'record-table', title: 'Large log index', artifactRef: 'sa-web-19-log-index', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-19-index', tool: readRefTool, status: 'done', outputRef: 'offline-web-e2e-fixture://sa-web-19/read-ref/index' }],
      artifacts: [{ id: 'sa-web-19-log-index', deliveryRef: logIndexRef }],
    };
  }
  if (round === 'anomaly-snippet') {
    return {
      ...base,
      message: 'Bounded snippet inspected: trace-7f9c-window-spike shows queue latency followed by retry saturation in lines 872-886.',
      reasoningTrace: 'SA-WEB-19 anomaly round read only a bounded snippet around the requested trace anchor.',
      uiManifest: [{ componentId: 'report-viewer', title: 'Anomaly snippet diagnosis', artifactRef: 'sa-web-19-snippet-diagnosis', priority: 1 }],
      executionUnits: [{ id: 'EU-sa-web-19-anomaly-snippet', tool: readRefTool, status: 'done', outputRef: 'offline-web-e2e-fixture://sa-web-19/read-ref/anomaly-snippet' }],
      artifacts: [{ id: 'sa-web-19-snippet-diagnosis', deliveryRef: 'artifact:sa-web-19-snippet-diagnosis' }],
    };
  }
  return {
    ...base,
    message: 'Diagnostics exported with a read fragments manifest; no full large-log body was copied into the prompt, transcript, or foreground answer.',
    reasoningTrace: 'SA-WEB-19 final round exported report and manifest from index plus bounded snippet evidence.',
    uiManifest: [
      { componentId: 'report-viewer', title: 'Large log diagnostic report', artifactRef: 'sa-web-19-diagnostic-report', priority: 1 },
      { componentId: 'record-table', title: 'Read fragments manifest', artifactRef: 'sa-web-19-read-fragments', priority: 2 },
    ],
    executionUnits: [{
      id: 'EU-sa-web-19-export',
      tool: 'diagnostics.export',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/sa-web-19-diagnostic-report.md',
      outputArtifacts: ['sa-web-19-diagnostic-report', 'sa-web-19-read-fragments'],
    }],
    artifacts: [
      { id: 'sa-web-19-diagnostic-report', deliveryRef: diagnosticReportRef, dataRef: '.sciforge/task-results/sa-web-19-diagnostic-report.md' },
      { id: 'sa-web-19-read-fragments', deliveryRef: readFragmentsRef, dataRef: '.sciforge/task-results/sa-web-19-read-fragments.json' },
    ],
  };
}

async function writeLargeLogFixture(workspacePath: string): Promise<LargeLogFixture> {
  const relPath = '.sciforge/artifacts/sa-web-19-large-service.log';
  const absolutePath = join(workspacePath, relPath);
  const sentinel = 'SA_WEB_19_FULL_TEXT_SENTINEL_DO_NOT_INLINE';
  const anomalyAnchor = 'trace-7f9c-window-spike';
  const anomalyLine = 879;
  const rows: string[] = [];
  for (let line = 1; line <= 1520; line += 1) {
    if (line === 874) {
      rows.push(`${stamp(line)} INFO queue latency rising trace=${anomalyAnchor} service=ingest-worker p95_ms=920`);
    } else if (line === anomalyLine) {
      rows.push(`${stamp(line)} ERROR retry saturation trace=${anomalyAnchor} shard=blue-17 retry_budget=exhausted window=bounded-snippet`);
    } else if (line === 1499) {
      rows.push(`${stamp(line)} DEBUG line-1499 background-worker full-text-only marker=${sentinel}`);
    } else {
      const level = line % 53 === 0 ? 'WARN' : 'INFO';
      const worker = line % 7 === 0 ? 'background-worker' : 'ingest-worker';
      rows.push(`${stamp(line)} ${level} line-${String(line).padStart(4, '0')} ${worker} heartbeat queue_ms=${80 + (line % 29)} shard=${line % 12}`);
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
    sentinel,
    anomalyAnchor,
    anomalyLine,
    lineCount: rows.length,
  };
}

function stamp(line: number): string {
  const minute = String(Math.floor(line / 60) % 60).padStart(2, '0');
  const second = String(line % 60).padStart(2, '0');
  return `2026-05-20T09:${minute}:${second}.000Z`;
}

async function materializeLargeFileDiagnosticsArtifacts(workspacePath: string, log: LargeLogFixture): Promise<void> {
  await mkdir(join(workspacePath, '.sciforge/task-results'), { recursive: true });
  await mkdir(join(workspacePath, '.sciforge/logs'), { recursive: true });
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-19-log-index.json'), {
    schemaVersion: 'sciforge.web-e2e.large-log-index.v1',
    sourceRef: log.ref,
    sourceDigest: log.digest,
    lineCount: log.lineCount,
    sizeBytes: log.sizeBytes,
    indexOnly: true,
    anomalyAnchors: [{
      anchor: log.anomalyAnchor,
      lineRange: [872, 886],
      byteRange: [38320, 41760],
      summary: 'Queue latency rises before retry saturation in the ingest worker.',
    }],
  });
  await writeFile(
    join(workspacePath, '.sciforge/task-results/sa-web-19-diagnostic-report.md'),
    [
      '# SA-WEB-19 Large Log Diagnostic Report',
      '',
      `source ref: ${log.ref}`,
      `source digest: ${log.digest}`,
      'large-file policy: index-and-bounded-snippets-only',
      'diagnosis: trace-7f9c-window-spike shows queue latency rising before retry saturation in shard blue-17.',
      'bounded evidence: lines 872-886, bytes 38320-41760, maxBytes 4096.',
      'read fragments manifest: artifact:sa-web-19-read-fragments',
      '',
    ].join('\n'),
    'utf8',
  );
  await writeJson(join(workspacePath, '.sciforge/task-results/sa-web-19-read-fragments.json'), {
    schemaVersion: 'sciforge.web-e2e.read-fragments.v1',
    sourceRef: log.ref,
    sourceDigest: log.digest,
    fullTextEmbedded: false,
    entries: [
      {
        round: 'index',
        mode: 'index-only',
        ref: log.ref,
        byteRange: [0, 4096],
        maxBytes: 4096,
        bytesRead: 4096,
        bounded: true,
        purpose: 'large-log-index',
        excerpt: 'metadata prefix and anomaly index only',
      },
      {
        round: 'anomaly-snippet',
        mode: 'bounded-snippet',
        ref: log.ref,
        anchor: log.anomalyAnchor,
        lineRange: [872, 886],
        byteRange: [38320, 41760],
        maxBytes: 4096,
        bytesRead: 3440,
        bounded: true,
        purpose: 'inspect-anomaly-window',
        excerpt: 'trace-7f9c-window-spike queue latency rising before retry saturation',
      },
      {
        round: 'export-diagnostics',
        mode: 'bounded-snippet',
        ref: log.ref,
        anchor: log.anomalyAnchor,
        lineRange: [872, 886],
        byteRange: [38320, 41760],
        maxBytes: 4096,
        bytesRead: 3440,
        bounded: true,
        purpose: 'export-fragment-manifest',
        excerpt: 'same bounded anomaly window reused for final diagnostic export',
      },
    ],
  });
  await writeJson(join(workspacePath, '.sciforge/task-results/current-run-audit.json'), {
    schemaVersion: 'sciforge.web-e2e.large-file-run-audit.v1',
    runId,
    sourceRef: log.ref,
    readPolicy: 'index-and-bounded-snippets-only',
    readRefs: [
      'offline-web-e2e-fixture://sa-web-19/read-ref/index',
      'offline-web-e2e-fixture://sa-web-19/read-ref/anomaly-snippet',
      'offline-web-e2e-fixture://sa-web-19/read-ref/export-diagnostics',
    ],
    exportedRefs: [diagnosticReportRef, readFragmentsRef, logIndexRef],
  });
  await writeFile(
    join(workspacePath, '.sciforge/logs/current-run.stderr.log'),
    'diagnostic fixture: no raw large-log body emitted to stderr\n',
    'utf8',
  );
}

function finalizeLargeFileDiagnosticsFixture(fixture: WebE2eFixtureWorkspace, log: LargeLogFixture, fixedNow: string): void {
  const logInitialRef: WebE2eInitialRef = {
    id: 'ref-sa-web-19-large-log',
    kind: 'file',
    title: 'Large service log',
    ref: log.ref,
    source: 'explicit-selection',
    artifactType: 'large-log',
    digest: log.digest,
  };
  fixture.initialRefs.push(logInitialRef);
  fixture.expectedProjection.currentTask.explicitRefs = [logInitialRef];
  fixture.expectedProjection.currentTask.selectedRefs = [
    fixture.expectedProjection.currentTask.currentTurnRef,
    logInitialRef,
  ];

  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  const artifacts = largeFileArtifacts(fixture.scenarioId, fixture.runId, log);
  const objectReferences = largeFileObjectReferences(fixture.runId, log);
  const projection = largeFileProjection(fixture.expectedProjection, artifacts, log, fixedNow);
  fixture.expectedProjection.conversationProjection = projection;
  fixture.expectedProjection.artifactDelivery = artifactDeliveryProjection(artifacts);
  fixture.expectedProjection.runAuditRefs = uniqueStrings([
    runAuditRef,
    diagnosticLogRef,
    'offline-web-e2e-fixture://sa-web-19/read-ref/index',
    'offline-web-e2e-fixture://sa-web-19/read-ref/anomaly-snippet',
    'offline-web-e2e-fixture://sa-web-19/read-ref/export-diagnostics',
    readFragmentsRef,
    logIndexRef,
  ]);

  fixture.workspaceState.sessionsByScenario[fixture.scenarioId] = largeFileSession({
    session,
    projection,
    artifacts,
    objectReferences,
    log,
    fixedNow,
  });
}

function largeFileSession(input: {
  session: SciForgeSession;
  projection: ConversationProjection;
  artifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
  log: LargeLogFixture;
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
    prompt: roundPrompts['export-diagnostics'],
    response: input.projection.visibleAnswer?.text ?? 'Large-file diagnostics completed.',
    completedAt: input.fixedNow,
    objectReferences: input.objectReferences,
    raw: {
      displayIntent: {
        primaryGoal: 'Render large-file diagnostics from bounded refs and exported manifests.',
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
    title: 'Large-file bounded diagnostics Web E2E case',
    messages: input.session.messages.map((message) => {
      if (message.role === 'user') {
        return {
          ...message,
          content: roundPrompts.index,
          objectReferences: input.objectReferences.filter((ref) => ref.ref === input.log.ref),
        };
      }
      if (message.role === 'scenario') {
        return {
          ...message,
          content: input.projection.visibleAnswer?.text ?? 'Large-file diagnostics completed.',
          objectReferences: input.objectReferences.filter((ref) => ref.presentationRole !== 'audit' && ref.presentationRole !== 'diagnostic' && ref.presentationRole !== 'internal'),
          status: 'completed',
        };
      }
      return message;
    }),
    runs: [nextRun],
    uiManifest: [
      { componentId: 'report-viewer', title: 'Large log diagnostic report', artifactRef: 'sa-web-19-diagnostic-report', priority: 1 },
      { componentId: 'record-table', title: 'Read fragments manifest', artifactRef: 'sa-web-19-read-fragments', priority: 2 },
      { componentId: 'record-table', title: 'Large log index', artifactRef: 'sa-web-19-log-index', priority: 3 },
    ],
    executionUnits: largeFileExecutionUnits(input.fixedNow),
    artifacts: input.artifacts,
    updatedAt: input.fixedNow,
  };
}

function largeFileProjection(
  expected: WebE2eExpectedProjection,
  artifacts: RuntimeArtifact[],
  log: LargeLogFixture,
  fixedNow: string,
): ConversationProjection {
  const artifactRefs = artifacts
    .filter((artifact) => artifact.delivery?.role === 'primary-deliverable' || artifact.delivery?.role === 'supporting-evidence')
    .map((artifact): ConversationRef => ({
      ref: artifact.delivery?.ref ?? `artifact:${artifact.id}`,
      mime: artifact.delivery?.declaredMediaType,
      label: String(artifact.metadata?.title ?? artifact.id),
      sizeBytes: artifact.id === 'sa-web-19-large-log' ? log.sizeBytes : undefined,
    }));
  return {
    ...expected.conversationProjection,
    visibleAnswer: {
      status: 'satisfied',
      text: '已完成大日志 bounded 诊断：先生成索引，再只读取 trace-7f9c-window-spike 周边 bounded snippet，最后导出诊断报告和读取片段清单；全文没有进入 prompt 或 GUI transcript。',
      artifactRefs: [diagnosticReportRef, readFragmentsRef, logIndexRef, log.ref],
    },
    activeRun: { id: expected.runId, status: 'satisfied' },
    artifacts: artifactRefs,
    executionProcess: [
      {
        eventId: 'sa-web-19-index',
        type: 'OutputMaterialized',
        summary: 'Large service log indexed by ref without full-text foreground ingestion.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-19-anomaly-snippet',
        type: 'OutputMaterialized',
        summary: 'Only a bounded snippet around trace-7f9c-window-spike was read for anomaly diagnosis.',
        timestamp: fixedNow,
      },
      {
        eventId: 'sa-web-19-export-diagnostics',
        type: 'Satisfied',
        summary: 'Diagnostic report and read-fragment manifest exported.',
        timestamp: fixedNow,
      },
    ],
    recoverActions: [],
    auditRefs: [
      runAuditRef,
      diagnosticLogRef,
      'offline-web-e2e-fixture://sa-web-19/read-ref/index',
      'offline-web-e2e-fixture://sa-web-19/read-ref/anomaly-snippet',
      'offline-web-e2e-fixture://sa-web-19/read-ref/export-diagnostics',
      readFragmentsRef,
    ],
    diagnostics: [{
      severity: 'info',
      code: 'large-file-bounded-diagnostics',
      message: 'Large log content stayed behind refs; only index and bounded snippets were read.',
      refs: [{ ref: log.ref }, { ref: logIndexRef }, { ref: readFragmentsRef }],
    }],
  };
}

function largeFileArtifacts(scenario: string, run: string, log: LargeLogFixture): RuntimeArtifact[] {
  return [
    artifact('sa-web-19-large-log', 'large-log', scenario, run, 'Large service log', log.relPath, 'supporting-evidence', 'text/plain', 'log', 'raw-file', 'open-system'),
    artifact('sa-web-19-log-index', 'large-file-index', scenario, run, 'Large log index', '.sciforge/task-results/sa-web-19-log-index.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-19-diagnostic-report', 'large-file-diagnostic-report', scenario, run, 'Large log diagnostic report', '.sciforge/task-results/sa-web-19-diagnostic-report.md', 'primary-deliverable', 'text/markdown', 'md'),
    artifact('sa-web-19-read-fragments', 'read-fragment-manifest', scenario, run, 'Read fragments manifest', '.sciforge/task-results/sa-web-19-read-fragments.json', 'supporting-evidence', 'application/json', 'json'),
    artifact('sa-web-19-run-audit', 'run-audit', scenario, run, 'Large-file RunAudit', '.sciforge/task-results/current-run-audit.json', 'audit', 'application/json', 'json', 'raw-file', 'audit-only'),
    artifact('sa-web-19-diagnostic-log', 'diagnostic-log', scenario, run, 'Large-file diagnostic log', '.sciforge/logs/current-run.stderr.log', 'diagnostic', 'text/plain', 'log', 'raw-file', 'audit-only'),
    artifact('sa-web-19-provider-manifest', 'provider-manifest', scenario, run, 'Provider manifest', '.sciforge/provider-manifest.json', 'internal', 'application/json', 'json', 'raw-file', 'unsupported'),
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

function largeFileObjectReferences(run: string, log: LargeLogFixture): ObjectReference[] {
  return [
    objectReference('file-sa-web-19-large-log', 'Large service log', 'file', log.ref, 'large-log', 'supporting-evidence', run, log.sizeBytes),
    objectReference('object-sa-web-19-log-index', 'Large log index', 'artifact', logIndexRef, 'large-file-index', 'supporting-evidence', run),
    objectReference('object-sa-web-19-diagnostic-report', 'Large log diagnostic report', 'artifact', diagnosticReportRef, 'large-file-diagnostic-report', 'primary-deliverable', run),
    objectReference('object-sa-web-19-read-fragments', 'Read fragments manifest', 'artifact', readFragmentsRef, 'read-fragment-manifest', 'supporting-evidence', run),
    objectReference('object-sa-web-19-run-audit', 'Large-file RunAudit', 'artifact', runAuditRef, 'run-audit', 'audit', run),
    objectReference('object-sa-web-19-diagnostic-log', 'Large-file diagnostic log', 'artifact', diagnosticLogRef, 'diagnostic-log', 'diagnostic', run),
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
    preferredView: artifactType.includes('index') || artifactType.includes('manifest') ? 'record-table' : 'report-viewer',
    presentationRole,
    actions: kind === 'file' ? ['inspect', 'copy-path'] : ['focus-right-pane', 'copy-path'],
    status: 'available',
    provenance: { dataRef: ref.replace(/^file:/, ''), size },
  };
}

function largeFileExecutionUnits(fixedNow: string): RuntimeExecutionUnit[] {
  return [
    {
      id: 'EU-sa-web-19-read-ref-index',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-19-large-service.log mode=index-only maxBytes=4096',
      status: 'done',
      hash: 'sa-web-19-read-ref-index',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-19/read-ref/index',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-19-read-ref-anomaly-snippet',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-19-large-service.log mode=bounded-snippet lineRange=872-886 maxBytes=4096',
      status: 'done',
      hash: 'sa-web-19-read-ref-anomaly-snippet',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-19/read-ref/anomaly-snippet',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-19-read-ref-export-diagnostics',
      tool: readRefTool,
      params: 'ref=file:.sciforge/artifacts/sa-web-19-large-service.log mode=bounded-snippet export=read-fragments maxBytes=4096',
      status: 'done',
      hash: 'sa-web-19-read-ref-export-diagnostics',
      runId,
      outputRef: 'offline-web-e2e-fixture://sa-web-19/read-ref/export-diagnostics',
      time: fixedNow,
    },
    {
      id: 'EU-sa-web-19-export',
      tool: 'diagnostics.export',
      params: `report=${diagnosticReportRef} fragments=${readFragmentsRef}`,
      status: 'done',
      hash: 'sa-web-19-export',
      runId,
      outputRef: 'file:.sciforge/task-results/sa-web-19-diagnostic-report.md',
      outputArtifacts: ['sa-web-19-diagnostic-report', 'sa-web-19-read-fragments'],
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

function assertBoundedReadRefInput(input: JsonRecord): void {
  assert.ok(input.mode === 'index-only' || input.mode === 'bounded-snippet', `read_ref mode must be bounded, actual ${String(input.mode)}`);
  assert.equal(input.includeFullText, false, 'bounded read_ref calls must explicitly avoid full text');
  assert.equal(input.fullText, undefined, 'bounded read_ref calls must not request fullText');
  const maxBytes = Number(input.maxBytes);
  assert.ok(Number.isFinite(maxBytes) && maxBytes > 0 && maxBytes <= 8192, 'bounded read_ref calls must cap maxBytes at 8192');
  const byteRange = input.byteRange;
  assert.ok(Array.isArray(byteRange) && byteRange.length === 2, 'bounded read_ref calls must include byteRange');
  const [start, end] = byteRange.map(Number);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start, 'bounded read_ref byteRange must be valid');
  assert.ok(end - start <= maxBytes, 'bounded read_ref byteRange must fit within maxBytes');
}

function assertReadFragmentManifest(manifest: JsonRecord, log: LargeLogFixture): void {
  assert.equal(manifest.schemaVersion, 'sciforge.web-e2e.read-fragments.v1');
  assert.equal(manifest.sourceRef, log.ref);
  assert.equal(manifest.sourceDigest, log.digest);
  assert.equal(manifest.fullTextEmbedded, false);
  const entries = manifest.entries;
  assert.ok(Array.isArray(entries), 'read fragments manifest must contain entries');
  assert.equal(entries.length, 3, 'read fragments manifest must record all three bounded reads');
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(log.sentinel), 'read fragment manifest must not include unread full-text sentinel');
  for (const entry of entries) {
    assert.ok(isRecord(entry), 'read fragment entry must be an object');
    assert.equal(entry.ref, log.ref);
    assert.equal(entry.bounded, true);
    assert.equal(entry.fullText, undefined);
    assert.equal(entry.rawText, undefined);
    assertBoundedReadRefInput({
      ref: entry.ref,
      mode: entry.mode,
      byteRange: entry.byteRange,
      maxBytes: entry.maxBytes,
      includeFullText: false,
    });
    assert.ok(String(entry.excerpt ?? '').length <= 160, 'read fragment excerpts must stay bounded');
    assert.ok(Number(entry.bytesRead ?? 0) <= Number(entry.maxBytes ?? 0), 'bytesRead must not exceed maxBytes');
  }
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

function roundFromRequest(request: JsonRecord): LargeFileRound {
  if (request.round === 'index' || request.round === 'anomaly-snippet' || request.round === 'export-diagnostics') return request.round;
  throw new Error(`Unexpected SA-WEB-19 round: ${String(request.round)}`);
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
