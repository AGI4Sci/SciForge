import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import type {
  ArtifactDeliveryRole,
  ObjectReference,
  RuntimeArtifact,
  SciForgeMessage,
  SciForgeRun,
  SciForgeSession,
} from '@sciforge-ui/runtime-contract';
import {
  createConversationEventLog,
  projectConversation,
  type ConversationEvent,
  type ConversationEventLog,
  type ConversationProjection,
  type ConversationRef,
} from '../../../src/runtime/conversation-kernel/index.js';
import type {
  BuildWebE2eFixtureWorkspaceOptions,
  WebE2eArtifactDeliveryProjection,
  WebE2eExpectedProjection,
  WebE2eFixtureWorkspace,
  WebE2eInitialRef,
  WebE2eProviderCapability,
  WebE2eProviderManifest,
  WebE2eSeedFile,
  WebE2eSeedFileKind,
  WebE2eWorkspaceState,
} from './types.js';

const DEFAULT_WORKSPACE_WRITER_BASE_URL = 'http://127.0.0.1:5174';
const DEFAULT_AGENT_SERVER_BASE_URL = 'http://127.0.0.1:18080';

export async function buildWebE2eFixtureWorkspace(
  options: BuildWebE2eFixtureWorkspaceOptions,
): Promise<WebE2eFixtureWorkspace> {
  const caseId = assertCaseId(options.caseId);
  const safeCaseId = slug(caseId);
  const now = options.now ?? new Date().toISOString();
  const scenarioId = options.scenarioId ?? `${safeCaseId}-scenario`;
  const sessionId = options.sessionId ?? `session-${safeCaseId}`;
  const runId = options.runId ?? `run-${safeCaseId}-current`;
  const userMessageId = `msg-${safeCaseId}-user-current`;
  const title = options.title ?? `Web E2E fixture ${caseId}`;
  const prompt = options.prompt ?? 'Use the explicitly selected old report, compare it with current CSV evidence, and produce the final projection.';
  const workspacePath = options.workspacePath ?? await makeIsolatedWorkspacePath(safeCaseId, options.baseDir);
  const sciforgeDir = join(workspacePath, '.sciforge');

  await mkdir(join(sciforgeDir, 'artifacts'), { recursive: true });
  await mkdir(join(sciforgeDir, 'task-results'), { recursive: true });
  await mkdir(join(sciforgeDir, 'logs'), { recursive: true });
  await mkdir(join(sciforgeDir, 'scenarios'), { recursive: true });

  const seedFiles = await writeSeedFiles(workspacePath, safeCaseId, runId);
  const providerManifest = buildProviderManifest(caseId, now, options.providerCapabilities);
  const providerManifestPath = join(sciforgeDir, 'provider-manifest.json');
  await writeJson(providerManifestPath, providerManifest);

  const seedArtifacts = buildSeedArtifacts(scenarioId, runId);
  const objectReferences = buildObjectReferences(runId);
  const currentTurnRef = initialRef({
    id: `turn-${safeCaseId}-current`,
    kind: 'user-turn',
    title: 'Current user turn',
    ref: `message:${userMessageId}`,
    source: 'current-turn',
  });
  const explicitOldReportRef = initialRef({
    id: 'ref-old-report',
    kind: 'artifact',
    title: 'Previously selected literature report',
    ref: 'artifact:fixture-old-report',
    source: 'explicit-selection',
    artifactType: 'research-report',
  });
  const initialRefs: WebE2eInitialRef[] = [
    currentTurnRef,
    explicitOldReportRef,
    initialRef({
      id: 'ref-current-report',
      kind: 'artifact',
      title: 'Current generated report',
      ref: 'artifact:fixture-current-report',
      source: 'seed-workspace',
      artifactType: 'research-report',
    }),
    initialRef({
      id: 'ref-csv',
      kind: 'file',
      title: 'Expression summary CSV',
      ref: 'file:.sciforge/artifacts/expression-summary.csv',
      source: 'seed-workspace',
      artifactType: 'differential-expression-table',
      digest: fileDigest(seedFiles, '.sciforge/artifacts/expression-summary.csv'),
    }),
    initialRef({
      id: 'ref-provider-manifest',
      kind: 'provider-manifest',
      title: 'Provider manifest',
      ref: 'file:.sciforge/provider-manifest.json',
      source: 'provider-manifest',
    }),
  ];

  const eventLog = buildConversationEventLog({ sessionId, runId, turnId: userMessageId, now, prompt });
  const conversationProjection = projectConversation(eventLog);
  const expectedProjection = buildExpectedProjection({
    caseId,
    sessionId,
    scenarioId,
    runId,
    currentTurnRef,
    explicitRefs: [explicitOldReportRef],
    selectedRefs: initialRefs.slice(0, 4),
    conversationProjection,
    seedArtifacts,
  });
  const expectedProjectionPath = join(sciforgeDir, 'task-results', `${safeCaseId}.expected-projection.json`);
  await writeJson(expectedProjectionPath, expectedProjection);

  const workspaceState = buildWorkspaceState({
    workspacePath,
    scenarioId,
    sessionId,
    userMessageId,
    runId,
    title,
    prompt,
    now,
    eventLog,
    conversationProjection,
    seedArtifacts,
    objectReferences,
  });
  const workspaceStatePath = join(sciforgeDir, 'workspace-state.json');
  await writeJson(workspaceStatePath, workspaceState);

  const configLocalPath = join(sciforgeDir, 'config.local.json');
  await writeJson(configLocalPath, {
    schemaVersion: 1,
    agentServerBaseUrl: options.agentServerBaseUrl ?? DEFAULT_AGENT_SERVER_BASE_URL,
    workspaceWriterBaseUrl: options.workspaceWriterBaseUrl ?? DEFAULT_WORKSPACE_WRITER_BASE_URL,
    workspacePath,
    modelProvider: 'native',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
    agentBackend: 'codex',
    requestTimeoutMs: 8_000,
    updatedAt: now,
  });

  return {
    caseId,
    workspacePath,
    sciforgeDir,
    workspaceStatePath,
    configLocalPath,
    providerManifestPath,
    expectedProjectionPath,
    sessionId,
    scenarioId,
    runId,
    seedFiles,
    seedArtifacts,
    initialRefs,
    objectReferences,
    providerManifest,
    expectedProjection,
    workspaceState,
  };
}

function assertCaseId(caseId: string): string {
  if (!caseId.trim()) throw new Error('caseId is required');
  return caseId.trim();
}

async function makeIsolatedWorkspacePath(safeCaseId: string, baseDir: string | undefined): Promise<string> {
  const parent = baseDir ?? tmpdir();
  await mkdir(parent, { recursive: true });
  return await mkdtemp(join(parent, `sciforge-web-e2e-${safeCaseId}-`));
}

async function writeSeedFiles(workspacePath: string, safeCaseId: string, runId: string): Promise<WebE2eSeedFile[]> {
  const files: Array<{ kind: WebE2eSeedFileKind; relPath: string; mediaType: string; content: string | Buffer }> = [
    {
      kind: 'markdown',
      relPath: '.sciforge/artifacts/old-literature-report.md',
      mediaType: 'text/markdown',
      content: '# Prior literature report\n\nOlder selected evidence: IL7R signal remains the baseline interpretation.\n',
    },
    {
      kind: 'markdown',
      relPath: '.sciforge/artifacts/current-literature-report.md',
      mediaType: 'text/markdown',
      content: '# Current projection report\n\nThe final report preserves explicit old refs and adds current CSV/PDF evidence.\n',
    },
    {
      kind: 'csv',
      relPath: '.sciforge/artifacts/expression-summary.csv',
      mediaType: 'text/csv',
      content: 'gene,cluster,logFC,pValue\nIL7R,T cell,1.7,0.001\nMS4A1,B cell,1.4,0.003\nLYZ,Myeloid,-1.2,0.011\n',
    },
    {
      kind: 'pdf',
      relPath: '.sciforge/artifacts/seed-paper.pdf',
      mediaType: 'application/pdf',
      content: minimalPdf(`${safeCaseId} fixture paper`),
    },
    {
      kind: 'text',
      relPath: '.sciforge/artifacts/notes.txt',
      mediaType: 'text/plain',
      content: 'Fixture note: text refs are durable inputs, not raw prompt stuffing.\n',
    },
    {
      kind: 'json',
      relPath: '.sciforge/task-results/current-run-audit.json',
      mediaType: 'application/json',
      content: `${JSON.stringify({ schemaVersion: 1, caseId: safeCaseId, runId, checks: ['projection', 'artifact-delivery'] }, null, 2)}\n`,
    },
    {
      kind: 'log',
      relPath: '.sciforge/logs/current-run.stderr.log',
      mediaType: 'text/plain',
      content: 'diagnostic fixture: warning retained for audit surface only\n',
    },
  ];

  const written: WebE2eSeedFile[] = [];
  for (const file of files) {
    const absolutePath = join(workspacePath, file.relPath);
    const content = typeof file.content === 'string' ? Buffer.from(file.content, 'utf8') : file.content;
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
    written.push({
      kind: file.kind,
      relPath: file.relPath,
      absolutePath,
      mediaType: file.mediaType,
      digest: digest(content),
      sizeBytes: content.byteLength,
    });
  }
  return written;
}

function buildProviderManifest(
  caseId: string,
  now: string,
  capabilities: WebE2eProviderCapability[] | undefined,
): WebE2eProviderManifest {
  const defaultCapabilities: WebE2eProviderCapability[] = [
    providerCapability('sciforge.web-worker.web_search', 'web_search', 'available'),
    providerCapability('sciforge.web-worker.web_fetch', 'web_fetch', 'available'),
    providerCapability('sciforge.workspace-reader.read_ref', 'read_ref', 'available'),
  ];
  return {
    schemaVersion: 'sciforge.web-e2e.provider-manifest.v1',
    caseId,
    generatedAt: now,
    capabilities: capabilities ?? defaultCapabilities,
    refs: [{ ref: 'file:.sciforge/provider-manifest.json', mime: 'application/json', label: 'Provider manifest' }],
  };
}

function providerCapability(
  id: string,
  capabilityId: string,
  status: WebE2eProviderCapability['status'],
): WebE2eProviderCapability {
  const [workerId] = id.split(`.${capabilityId}`);
  return {
    id,
    providerId: id,
    capabilityId,
    workerId,
    status,
    fixtureMode: 'scripted-mock',
  };
}

function buildSeedArtifacts(scenarioId: string, runId: string): RuntimeArtifact[] {
  return [
    artifact({
      id: 'fixture-old-report',
      type: 'research-report',
      scenarioId,
      runId: 'run-fixture-old',
      title: 'Prior selected literature report',
      dataRef: '.sciforge/artifacts/old-literature-report.md',
      role: 'supporting-evidence',
      mediaType: 'text/markdown',
      extension: 'md',
    }),
    artifact({
      id: 'fixture-current-report',
      type: 'research-report',
      scenarioId,
      runId,
      title: 'Current projection report',
      dataRef: '.sciforge/artifacts/current-literature-report.md',
      role: 'primary-deliverable',
      mediaType: 'text/markdown',
      extension: 'md',
    }),
    artifact({
      id: 'fixture-expression-summary',
      type: 'differential-expression-table',
      scenarioId,
      runId,
      title: 'Expression summary CSV',
      dataRef: '.sciforge/artifacts/expression-summary.csv',
      role: 'supporting-evidence',
      mediaType: 'text/csv',
      extension: 'csv',
    }),
    artifact({
      id: 'fixture-seed-paper',
      type: 'paper-pdf',
      scenarioId,
      runId,
      title: 'Seed paper PDF',
      dataRef: '.sciforge/artifacts/seed-paper.pdf',
      role: 'supporting-evidence',
      mediaType: 'application/pdf',
      extension: 'pdf',
      contentShape: 'binary-ref',
      previewPolicy: 'open-system',
    }),
    artifact({
      id: 'fixture-notes',
      type: 'research-note',
      scenarioId,
      runId,
      title: 'Text fixture note',
      dataRef: '.sciforge/artifacts/notes.txt',
      role: 'supporting-evidence',
      mediaType: 'text/plain',
      extension: 'txt',
    }),
    artifact({
      id: 'fixture-run-audit',
      type: 'run-audit',
      scenarioId,
      runId,
      title: 'Run audit bundle',
      dataRef: '.sciforge/task-results/current-run-audit.json',
      role: 'audit',
      mediaType: 'application/json',
      extension: 'json',
      previewPolicy: 'audit-only',
    }),
    artifact({
      id: 'fixture-diagnostic-log',
      type: 'diagnostic-log',
      scenarioId,
      runId,
      title: 'Diagnostic stderr log',
      dataRef: '.sciforge/logs/current-run.stderr.log',
      role: 'diagnostic',
      mediaType: 'text/plain',
      extension: 'log',
      previewPolicy: 'audit-only',
    }),
    artifact({
      id: 'fixture-provider-manifest',
      type: 'provider-manifest',
      scenarioId,
      runId,
      title: 'Provider manifest',
      dataRef: '.sciforge/provider-manifest.json',
      role: 'internal',
      mediaType: 'application/json',
      extension: 'json',
      previewPolicy: 'unsupported',
    }),
  ];
}

function artifact(input: {
  id: string;
  type: string;
  scenarioId: string;
  runId: string;
  title: string;
  dataRef: string;
  role: ArtifactDeliveryRole;
  mediaType: string;
  extension: string;
  contentShape?: 'raw-file' | 'binary-ref';
  previewPolicy?: 'inline' | 'open-system' | 'audit-only' | 'unsupported';
}): RuntimeArtifact {
  return {
    id: input.id,
    type: input.type,
    producerScenario: input.scenarioId,
    schemaVersion: '1',
    metadata: { title: input.title, path: input.dataRef, runId: input.runId },
    dataRef: input.dataRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${input.id}`,
      role: input.role,
      declaredMediaType: input.mediaType,
      declaredExtension: input.extension,
      contentShape: input.contentShape ?? 'raw-file',
      readableRef: input.previewPolicy === 'unsupported' ? undefined : input.dataRef,
      rawRef: input.dataRef,
      previewPolicy: input.previewPolicy ?? 'inline',
    },
    visibility: input.role === 'internal' ? 'private-draft' : 'project-record',
  };
}

function buildObjectReferences(runId: string): ObjectReference[] {
  return [
    objectReference('fixture-old-report', 'Prior selected literature report', 'research-report', 'supporting-evidence', 'run-fixture-old'),
    objectReference('fixture-current-report', 'Current projection report', 'research-report', 'primary-deliverable', runId),
    objectReference('fixture-expression-summary', 'Expression summary CSV', 'differential-expression-table', 'supporting-evidence', runId),
    objectReference('fixture-seed-paper', 'Seed paper PDF', 'paper-pdf', 'supporting-evidence', runId),
    objectReference('fixture-run-audit', 'Run audit bundle', 'run-audit', 'audit', runId),
    objectReference('fixture-diagnostic-log', 'Diagnostic stderr log', 'diagnostic-log', 'diagnostic', runId),
  ];
}

function objectReference(
  artifactId: string,
  title: string,
  artifactType: string,
  presentationRole: ObjectReference['presentationRole'],
  runId: string,
): ObjectReference {
  return {
    id: `object-${artifactId}`,
    title,
    kind: 'artifact',
    ref: `artifact:${artifactId}`,
    artifactType,
    runId,
    preferredView: artifactType === 'differential-expression-table' ? 'record-table' : 'report-viewer',
    presentationRole,
    actions: ['focus-right-pane', 'copy-path'],
    status: 'available',
  };
}

function buildConversationEventLog(input: {
  sessionId: string;
  runId: string;
  turnId: string;
  now: string;
  prompt: string;
}): ConversationEventLog {
  return {
    ...createConversationEventLog(input.sessionId),
    events: [
      inlineEvent('event-current-turn', 'TurnReceived', input.now, 'user', { prompt: input.prompt }, { turnId: input.turnId }),
      refEvent('event-harness-decision', 'HarnessDecisionRecorded', input.now, 'kernel', {
        schemaVersion: 'sciforge.harness-decision-record.v1',
        decisionId: 'decision-web-e2e-fixture',
        profileId: 'balanced-default',
        digest: 'sha256:web-e2e-fixture-decision',
        summary: 'Scripted fixture routes through AgentServer mock with explicit refs.',
        refs: [
          { ref: 'file:.sciforge/provider-manifest.json', digest: 'sha256:provider-manifest', mime: 'application/json' },
          { ref: 'artifact:fixture-old-report', digest: 'sha256:old-report', mime: 'text/markdown' },
        ],
      }, { turnId: input.turnId, runId: input.runId }),
      refEvent('event-output-materialized', 'OutputMaterialized', input.now, 'runtime', {
        summary: 'Current report and supporting fixtures materialized.',
        refs: [
          { ref: 'artifact:fixture-current-report', digest: 'sha256:current-report', mime: 'text/markdown', label: 'Current projection report' },
          { ref: 'artifact:fixture-expression-summary', digest: 'sha256:expression-summary', mime: 'text/csv', label: 'Expression summary CSV' },
          { ref: 'artifact:fixture-seed-paper', digest: 'sha256:seed-paper', mime: 'application/pdf', label: 'Seed paper PDF' },
          { ref: 'artifact:fixture-run-audit', digest: 'sha256:run-audit', mime: 'application/json', label: 'Run audit bundle' },
        ],
      }, { turnId: input.turnId, runId: input.runId }),
      refEvent('event-verification-recorded', 'VerificationRecorded', input.now, 'verifier', {
        verdict: 'supported',
        summary: 'Fixture projection includes currentTask refs, artifact delivery roles, and audit refs.',
        refs: [{ ref: 'artifact:fixture-run-audit', digest: 'sha256:run-audit', mime: 'application/json' }],
      }, { turnId: input.turnId, runId: input.runId }),
      refEvent('event-satisfied', 'Satisfied', input.now, 'runtime', {
        text: 'Fixture final answer is available from the expected Projection and seeded artifacts.',
        summary: 'Terminal satisfied fixture projection.',
        refs: [{ ref: 'artifact:fixture-current-report', digest: 'sha256:current-report', mime: 'text/markdown' }],
      }, { turnId: input.turnId, runId: input.runId }),
    ],
  };
}

function buildExpectedProjection(input: {
  caseId: string;
  sessionId: string;
  scenarioId: string;
  runId: string;
  currentTurnRef: WebE2eInitialRef;
  explicitRefs: WebE2eInitialRef[];
  selectedRefs: WebE2eInitialRef[];
  conversationProjection: ConversationProjection;
  seedArtifacts: RuntimeArtifact[];
}): WebE2eExpectedProjection {
  return {
    schemaVersion: 'sciforge.web-e2e.expected-projection.v1',
    projectionVersion: 'sciforge.conversation-projection.v1',
    caseId: input.caseId,
    sessionId: input.sessionId,
    scenarioId: input.scenarioId,
    runId: input.runId,
    currentTask: {
      currentTurnRef: input.currentTurnRef,
      explicitRefs: input.explicitRefs,
      selectedRefs: input.selectedRefs,
    },
    conversationProjection: input.conversationProjection,
    artifactDelivery: artifactDeliveryProjection(input.seedArtifacts),
    runAuditRefs: [
      'artifact:fixture-run-audit',
      'artifact:fixture-diagnostic-log',
      'file:.sciforge/task-results/current-run-audit.json',
    ],
    providerManifestRef: 'file:.sciforge/provider-manifest.json',
  };
}

function buildWorkspaceState(input: {
  workspacePath: string;
  scenarioId: string;
  sessionId: string;
  userMessageId: string;
  runId: string;
  title: string;
  prompt: string;
  now: string;
  eventLog: ConversationEventLog;
  conversationProjection: ConversationProjection;
  seedArtifacts: RuntimeArtifact[];
  objectReferences: ObjectReference[];
}): WebE2eWorkspaceState {
  const userMessage: SciForgeMessage = {
    id: input.userMessageId,
    role: 'user',
    content: input.prompt,
    createdAt: input.now,
    status: 'completed',
    objectReferences: [input.objectReferences[0]],
  };
  const agentMessage: SciForgeMessage = {
    id: 'msg-web-e2e-agent-final',
    role: 'scenario',
    content: input.conversationProjection.visibleAnswer?.text ?? 'Fixture final answer is available.',
    createdAt: input.now,
    status: 'completed',
    objectReferences: input.objectReferences.filter((ref) => ref.presentationRole !== 'internal'),
  };
  const run: SciForgeRun = {
    id: input.runId,
    scenarioId: input.scenarioId,
    status: 'completed',
    prompt: input.prompt,
    response: input.conversationProjection.visibleAnswer?.text ?? 'Fixture final answer is available.',
    createdAt: input.now,
    completedAt: input.now,
    objectReferences: input.objectReferences,
    raw: {
      displayIntent: {
        primaryGoal: 'Render only projection-backed final state from seeded refs.',
        requiredArtifactTypes: ['research-report', 'differential-expression-table'],
        preferredModules: ['report-viewer', 'record-table'],
        source: 'agentserver',
        conversationEventLog: input.eventLog,
        conversationProjection: input.conversationProjection,
        taskOutcomeProjection: {
          conversationEventLog: input.eventLog,
          conversationProjection: input.conversationProjection,
          projectionRestore: {
            source: 'conversation-event-log',
            eventCount: input.eventLog.events.length,
          },
        },
      },
      resultPresentation: {
        conversationProjection: input.conversationProjection,
      },
    },
  };
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: input.sessionId,
    scenarioId: input.scenarioId,
    title: input.title,
    createdAt: input.now,
    messages: [userMessage, agentMessage],
    runs: [run],
    uiManifest: [
      { componentId: 'report-viewer', title: 'Current projection report', artifactRef: 'fixture-current-report', priority: 1 },
      { componentId: 'record-table', title: 'Expression summary CSV', artifactRef: 'fixture-expression-summary', priority: 2 },
    ],
    claims: [],
    executionUnits: [{
      id: 'eu-web-e2e-fixture',
      tool: 'web-e2e.fixture-builder',
      params: 'projection=seeded artifactDelivery=seeded',
      status: 'done',
      hash: 'web-e2e-fixture',
      runId: input.runId,
      outputRef: '.sciforge/task-results/current-run-audit.json',
      outputArtifacts: ['fixture-current-report', 'fixture-expression-summary'],
      time: input.now,
    }],
    artifacts: input.seedArtifacts,
    notebook: [],
    versions: [],
    updatedAt: input.now,
  };
  return {
    schemaVersion: 2,
    workspacePath: input.workspacePath,
    sessionsByScenario: { [input.scenarioId]: session },
    archivedSessions: [],
    alignmentContracts: [],
    timelineEvents: [{
      id: 'timeline-web-e2e-fixture',
      actor: 'Web E2E Fixture',
      action: 'run.completed',
      subject: `${input.runId} projection fixture`,
      artifactRefs: ['artifact:fixture-current-report', 'artifact:fixture-expression-summary'],
      executionUnitRefs: ['eu-web-e2e-fixture'],
      beliefRefs: [],
      branchId: input.scenarioId,
      visibility: 'project-record',
      decisionStatus: 'not-a-decision',
      createdAt: input.now,
    }],
    updatedAt: input.now,
  };
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

function inlineEvent(
  id: string,
  type: ConversationEvent['type'],
  timestamp: string,
  actor: ConversationEvent['actor'],
  payload: Record<string, unknown>,
  ids: Pick<ConversationEvent, 'turnId' | 'runId'>,
): ConversationEvent {
  return { id, type, timestamp, actor, storage: 'inline', payload, ...ids };
}

function refEvent(
  id: string,
  type: ConversationEvent['type'],
  timestamp: string,
  actor: ConversationEvent['actor'],
  payload: { refs: ConversationRef[]; summary?: string; [key: string]: unknown },
  ids: Pick<ConversationEvent, 'turnId' | 'runId'>,
): ConversationEvent {
  return { id, type, timestamp, actor, storage: 'ref', payload, ...ids };
}

function initialRef(ref: WebE2eInitialRef): WebE2eInitialRef {
  return ref;
}

function fileDigest(files: WebE2eSeedFile[], relPath: string): string | undefined {
  return files.find((file) => file.relPath === relPath)?.digest;
}

function digest(content: Buffer): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'case';
}

function minimalPdf(title: string): Buffer {
  return Buffer.from([
    '%PDF-1.4',
    '1 0 obj',
    '<< /Type /Catalog /Pages 2 0 R >>',
    'endobj',
    '2 0 obj',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    'endobj',
    '3 0 obj',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>',
    'endobj',
    '4 0 obj',
    `<< /Length ${title.length + 44} >>`,
    'stream',
    'BT /F1 12 Tf 24 96 Td',
    `(${title.replace(/[()\\]/g, '')}) Tj`,
    'ET',
    'endstream',
    'endobj',
    'xref',
    '0 5',
    '0000000000 65535 f ',
    'trailer',
    '<< /Root 1 0 R /Size 5 >>',
    '%%EOF',
    '',
  ].join('\n'), 'utf8');
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
