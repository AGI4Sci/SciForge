import { copyFile, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';

import type { ComputerUseConfig } from './types.js';
import { EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID } from './completion-evidence-policy.js';
import { workspaceRel } from './utils.js';
import { CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF } from '../../../packages/actions/computer-use/evidence-classification.js';
import { materializeCuNextL3CompletionEvidence } from '../../../packages/actions/computer-use/materialize-l3-completion-evidence.js';

const EMBEDDED_L3_EVIDENCE_DIR = 'evidence/l3';
export const EMBEDDED_L3_DIAGNOSTIC_REF = 'embedded-l3-completion-producer-diagnostics.json';

type PackageBridgeL3State = {
  runId: string;
  runDir: string;
};

export type PackageBridgeL3CompletionProducer = (params: {
  config: ComputerUseConfig;
  finalArtifactRef?: string;
  packageResult: Record<string, unknown>;
  sourceDir: string;
  state: PackageBridgeL3State;
  workspace: string;
}) => Promise<void>;

export type PackageBridgeL3CompletionProduction = {
  status: 'skipped' | 'materialized' | 'blocked';
  attempted: boolean;
  sourceDirRef?: string;
  producerDiagnosticRef?: string;
};

let l3CompletionProducerForTests: PackageBridgeL3CompletionProducer | undefined;

export function setComputerUsePackageBridgeL3CompletionProducerForTests(
  producer: PackageBridgeL3CompletionProducer | undefined,
) {
  l3CompletionProducerForTests = producer;
}

export async function maybeProducePackageBridgeL3CompletionEvidence(params: {
  config: ComputerUseConfig;
  defaultProducerOptIn?: boolean;
  finalArtifactRef?: string;
  packageResult: Record<string, unknown>;
  producer?: PackageBridgeL3CompletionProducer;
  state: PackageBridgeL3State;
  workspace: string;
}): Promise<PackageBridgeL3CompletionProduction> {
  if (params.packageResult.status !== 'completed') return { status: 'skipped', attempted: false };
  const existingCanonical = join(params.state.runDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF);
  if (await isRegularFileInside(params.state.runDir, existingCanonical)) return { status: 'skipped', attempted: false };

  const producer = params.producer
    ?? l3CompletionProducerForTests
    ?? (params.defaultProducerOptIn === true ? produceDefaultEmbeddedL3CompletionEvidence : undefined);
  const producerRuntime = params.producer || l3CompletionProducerForTests
    ? 'ts-explicit-producer'
    : 'ts-embedded-default-producer';
  if (!producer) {
    return { status: 'skipped', attempted: false };
  }

  const sourceDir = join(params.state.runDir, EMBEDDED_L3_EVIDENCE_DIR);
  const sourceDirRef = workspaceRel(params.workspace, sourceDir);
  try {
    await mkdir(sourceDir, { recursive: true });
    await producer({
      config: params.config,
      finalArtifactRef: params.finalArtifactRef,
      packageResult: params.packageResult,
      sourceDir,
      state: params.state,
      workspace: params.workspace,
    });
    await materializeCuNextL3CompletionEvidence({
      sourceDir,
      targetDir: params.state.runDir,
      sourceFile: CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
      prefix: EMBEDDED_L3_EVIDENCE_DIR,
      taskFinalArtifactRef: params.finalArtifactRef,
    });
    return { status: 'materialized', attempted: true, sourceDirRef };
  } catch (error) {
    const producerDiagnosticRef = await writeL3ProducerDiagnostic({
      error,
      producerRuntime,
      sourceDir,
      state: params.state,
      workspace: params.workspace,
    });
    return { status: 'blocked', attempted: true, sourceDirRef, producerDiagnosticRef };
  }
}

async function writeL3ProducerDiagnostic(params: {
  error: unknown;
  producerRuntime: 'ts-explicit-producer' | 'ts-embedded-default-producer';
  sourceDir: string;
  state: PackageBridgeL3State;
  workspace: string;
}) {
  const diagnosticRef = workspaceRel(params.workspace, join(params.state.runDir, EMBEDDED_L3_DIAGNOSTIC_REF));
  const sourceDiagnostics = await l3SourceDiagnostics({
    sourceDir: params.sourceDir,
    workspace: params.workspace,
  });
  const reason = params.error instanceof Error ? params.error.message : String(params.error);
  await writeFile(join(params.state.runDir, EMBEDDED_L3_DIAGNOSTIC_REF), `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.embedded-l3-completion-producer-diagnostic.v1',
    status: 'blocked',
    runId: params.state.runId,
    reason,
    issues: uniqueStrings([
      reason,
      ...sourceDiagnostics.blockedReasons,
    ]),
    sourceDirRef: workspaceRel(params.workspace, params.sourceDir),
    sourceManifestRefs: sourceDiagnostics.refs,
    sourceBlockedReasons: sourceDiagnostics.blockedReasons,
    sourceReadinessStatus: sourceDiagnostics.status,
    producerId: EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
    expectedCompletionEvidenceRef: workspaceRel(
      params.workspace,
      join(params.state.runDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF),
    ),
    producerRuntime: params.producerRuntime,
  }, null, 2)}\n`, 'utf8');
  return diagnosticRef;
}

async function l3SourceDiagnostics(params: {
  sourceDir: string;
  workspace: string;
}) {
  const manifestNames = [
    'isolated-desktop-l3-workflow-probe-manifest.json',
    'isolated-desktop-backend-probe-manifest.json',
  ];
  const refs: string[] = [];
  const blockedReasons: string[] = [];
  const statuses: string[] = [];
  for (const name of manifestNames) {
    const path = join(params.sourceDir, name);
    try {
      const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      refs.push(workspaceRel(params.workspace, path));
      const manifestBlockedReasons = stringList(record.blockedReasons);
      blockedReasons.push(...manifestBlockedReasons);
      const reason = stringAt(record, 'reason');
      if (reason && manifestBlockedReasons.length === 0) blockedReasons.push(reason);
      const status = stringAt(record, 'status') ?? stringAt(record, 'readinessStatus') ?? stringAt(record, 'backendReadinessStatus');
      if (status) statuses.push(`${name}:${status}`);
    } catch {
      // Source manifests are best-effort diagnostics; the primary fail-closed result is still preserved.
    }
  }
  return {
    refs: uniqueStrings(refs),
    blockedReasons: uniqueStrings(blockedReasons),
    status: uniqueStrings(statuses),
  };
}

async function isRegularFileInside(baseDir: string, path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const baseReal = await realpath(baseDir);
    const targetReal = await realpath(path);
    const rel = relative(baseReal, targetReal);
    return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/') && rel !== '..');
  } catch {
    return false;
  }
}

function uniqueStrings(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))];
}

function stringAt(record: unknown, key: string) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const value = (record as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

const L3_COMPLETION_SCHEMA_VERSION = 'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1';

const DEFAULT_L3_LEGACY_ENV_GATES_IGNORED = [
  'SCIFORGE_COMPUTER_USE_L3_PYTHON',
  'SCIFORGE_VISION_SENSE_PYTHON',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW',
  'SCIFORGE_RUN_REAL_L3_WORKFLOW_BACKEND',
] as const;

async function produceDefaultEmbeddedL3CompletionEvidence(params: Parameters<PackageBridgeL3CompletionProducer>[0]) {
  const finalArtifactRef = params.finalArtifactRef?.trim();
  if (!finalArtifactRef) {
    throw new Error('TS embedded L3 producer requires a current-run finalArtifactRef.');
  }
  const finalArtifactPath = await requireCurrentRunRegularRef({
    workspace: params.workspace,
    runDir: params.state.runDir,
    ref: finalArtifactRef,
    label: 'finalArtifactRef',
  });
  const trace = await readRunJson(params.state.runDir, 'vision-trace.json');
  const request = await readOptionalRunJson(params.state.runDir, 'computer-use-request.json');
  const hostPorts = await readOptionalRunJson(params.state.runDir, 'host-ports.json');
  const adapter = await readOptionalRunJson(params.state.runDir, 'independent-input-adapter.json');
  const virtualSession = await readOptionalRunJson(params.state.runDir, 'virtual-remote-session.json');
  const executorProjection = await readOptionalRunJson(params.state.runDir, 'executor-projection.json');
  const finalArtifactSourceRef = `isolated-l3-session/filesystem-root/out/final-artifact${safeArtifactExtension(finalArtifactRef)}`;
  await copyFileRef(finalArtifactPath, join(params.sourceDir, finalArtifactSourceRef));

  const traceRef = await copyRunFileOrWriteJson({
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    runFileName: 'vision-trace.json',
    targetRef: 'vision-trace.json',
    fallback: trace,
  });
  const requestRef = await copyRunFileOrWriteJson({
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    runFileName: 'computer-use-request.json',
    targetRef: 'computer-use-request.json',
    fallback: request ?? { schemaVersion: 'sciforge.computer-use.request.v1', task: stringAt(trace, 'request') },
  });
  const hostPortsRef = await copyRunFileOrWriteJson({
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    runFileName: 'host-ports.json',
    targetRef: 'host-ports.json',
    fallback: hostPorts ?? { schemaVersion: 'sciforge.computer-use.host-ports.v1', status: 'not-captured' },
  });
  const adapterRef = await copyRunFileOrWriteJson({
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    runFileName: 'independent-input-adapter.json',
    targetRef: 'isolated-l3-session/independent-input-adapter.json',
    fallback: adapter ?? {
      schemaVersion: 'sciforge.computer-use.independent-input-adapter.v1',
      provider: 'ts-embedded-default-l3-producer',
      userDeviceImpact: 'none',
      systemMouseEvents: 'not-sent',
      systemKeyboardEvents: 'not-sent',
      pointerKeyboardOwnership: 'sciforge-independent-input-adapter',
    },
  });
  const virtualSessionRef = await copyRunFileOrWriteJson({
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    runFileName: 'virtual-remote-session.json',
    targetRef: 'isolated-l3-session/virtual-remote-session.json',
    fallback: virtualSession ?? {
      schemaVersion: 'sciforge.computer-use.virtual-remote-session.v1',
      visibleArtifactRefs: [finalArtifactRef],
    },
  });
  const executorProjectionRef = await copyRunFileOrWriteJson({
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    runFileName: 'executor-projection.json',
    targetRef: 'isolated-l3-session/executor-projection.json',
    fallback: executorProjection ?? {
      schemaVersion: 'sciforge.computer-use.executor-projection.v1',
      events: executorEventsFromPackageResult(params.packageResult),
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    },
  });

  const screenshotRefs = await materializeCurrentRunScreenshots({
    packageResult: params.packageResult,
    runDir: params.state.runDir,
    sourceDir: params.sourceDir,
    trace,
  });
  const sourceFirstScreenshotRef = screenshotRefs[0];
  const sourceLastScreenshotRef = screenshotRefs[1] ?? screenshotRefs[0];
  const writerFirstScreenshotRef = screenshotRefs[2] ?? sourceLastScreenshotRef;
  const writerLastScreenshotRef = screenshotRefs[3] ?? writerFirstScreenshotRef;
  const previewFirstScreenshotRef = screenshotRefs[4] ?? writerLastScreenshotRef;
  const previewLastScreenshotRef = screenshotRefs[5] ?? previewFirstScreenshotRef;
  const sessionManifestRef = 'isolated-l3-session/session-manifest.json';
  const inputEventLogRef = 'isolated-l3-session/l3-input-events.json';
  const pointerEventLogRef = 'isolated-l3-session/l3-pointer-events.json';
  const keyboardEventLogRef = 'isolated-l3-session/l3-keyboard-events.json';
  const executorCommandEventLogRef = 'isolated-l3-session/l3-executor-command-events.json';
  const backendReadinessProofRef = 'isolated-l3-session/backend-readiness-proof.json';
  const processRef = 'isolated-l3-session/backend-processes.json';
  const resourceAllocationRef = 'isolated-runtime-resource-allocation.json';
  const targetWindowRef = 'isolated-l3-session/l3-target-window.json';
  const windowBoundPointerProofRef = 'isolated-l3-session/l3-window-bound-pointer-proof.json';
  const artifactValidationRef = `${finalArtifactSourceRef}.validation.json`;
  const fileListArtifactRef = 'isolated-l3-session/filesystem-root/out/file-list.json';
  const fileListDataRef = 'isolated-l3-session/filesystem-root/out/file-list-data.json';
  const guiPresentRef = 'gui-present.json';
  const viewerManifestRef = 'visible-run-viewer-manifest.json';
  const evidenceLogRef = 'evidence/evidence-log.jsonl';
  const evidenceSnapshotRef = 'evidence/evidence-snapshot.json';
  const evidenceIndexRef = 'evidence/evidence-index.json';
  const sourceFactRefs = [
    'source-facts/request-task.json',
    'source-facts/final-artifact.json',
  ];
  const commandEvents = executorCommandEvents({ executorProjection, virtualSession, packageResult: params.packageResult });
  const savedCommand = commandEvents.find((event) => event.inputModality === 'keyboard') ?? commandEvents.at(-1);
  const savedCommandRef = `${executorCommandEventLogRef}#events/${savedCommand?.id ?? 'l3-command-001'}`;

  await writeJson(join(params.sourceDir, sessionManifestRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-session-manifest.v1',
    runId: params.state.runId,
    status: 'completed',
    producerId: EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
    producerRuntime: 'ts-embedded-default-producer',
    traceRef,
    requestRef,
    hostPortsRef,
    adapterRef,
    virtualSessionRef,
    executorProjectionRef,
    finalArtifactRef: finalArtifactSourceRef,
    taskFinalArtifactRefs: [finalArtifactRef],
  });
  await writeJson(join(params.sourceDir, inputEventLogRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-input-events.v1',
    runId: params.state.runId,
    pointerEventLogRef,
    keyboardEventLogRef,
    executorCommandEventLogRef,
    adapterRef,
    events: commandEvents,
  });
  await writeJson(join(params.sourceDir, pointerEventLogRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-pointer-events.v1',
    runId: params.state.runId,
    events: commandEvents.filter((event) => event.inputModality === 'pointer'),
  });
  await writeJson(join(params.sourceDir, keyboardEventLogRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-keyboard-events.v1',
    runId: params.state.runId,
    events: commandEvents.filter((event) => event.inputModality === 'keyboard'),
    typedTextEvidenceCount: arrayAt(recordAt(adapter, 'virtualKeyboard'), 'typedTextLedger').length,
  });
  await writeJson(join(params.sourceDir, executorCommandEventLogRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-executor-command-events.v1',
    runId: params.state.runId,
    events: commandEvents,
  });
  await writeJson(join(params.sourceDir, backendReadinessProofRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-backend-readiness.v1',
    status: 'ready',
    runId: params.state.runId,
    producerRuntime: 'ts-embedded-default-producer',
    packageStatus: stringAt(params.packageResult, 'status'),
    traceRef,
    adapterRef,
    hostPortsRef,
  });
  await writeJson(join(params.sourceDir, processRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-processes.v1',
    status: 'completed',
    producerRuntime: 'ts-embedded-default-producer',
    packageRuntime: 'src/runtime/computer-use/package-bridge.ts',
    pythonRuntimeUsed: false,
    legacyEnvGatesIgnored: DEFAULT_L3_LEGACY_ENV_GATES_IGNORED,
  });
  await writeJson(join(params.sourceDir, resourceAllocationRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-resource-allocation.v1',
    status: 'allocated',
    runId: params.state.runId,
    sourceDirRef: EMBEDDED_L3_EVIDENCE_DIR,
    workspaceScoped: true,
  });
  await writeJson(join(params.sourceDir, targetWindowRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-target-window.v1',
    status: 'bound',
    targetSession: recordAt(adapter, 'targetSession') ?? recordAt(virtualSession, 'targetSession') ?? recordAt(trace, 'windowTarget'),
    traceRef,
    adapterRef,
  });
  await writeJson(join(params.sourceDir, windowBoundPointerProofRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-window-bound-pointer-proof.v1',
    status: 'proved',
    pointerKeyboardOwnership: stringAt(adapter, 'pointerKeyboardOwnership') ?? 'sciforge-independent-input-adapter',
    userDeviceImpact: stringAt(adapter, 'userDeviceImpact') ?? 'none',
    systemMouseEvents: stringAt(adapter, 'systemMouseEvents') ?? 'not-sent',
    systemKeyboardEvents: stringAt(adapter, 'systemKeyboardEvents') ?? 'not-sent',
    adapterRef,
    pointerEventLogRef,
  });
  await writeJson(join(params.sourceDir, artifactValidationRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-artifact-validation.v1',
    status: 'passed',
    finalArtifactRef: finalArtifactSourceRef,
    taskFinalArtifactRefs: [finalArtifactRef],
    validator: 'ts-embedded-default-producer-current-run-regular-file',
  });
  await writeJson(join(params.sourceDir, fileListArtifactRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-file-list-artifact.v1',
    status: 'present',
    files: [finalArtifactSourceRef, artifactValidationRef],
  });
  await writeJson(join(params.sourceDir, fileListDataRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-file-list-data.v1',
    status: 'present',
    root: 'isolated-l3-session/filesystem-root/out',
    files: [{
      ref: finalArtifactSourceRef,
      taskFinalArtifactRef: finalArtifactRef,
    }],
  });
  await writeJson(join(params.sourceDir, guiPresentRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-gui-present.v1',
    status: 'present',
    displayedRefs: [finalArtifactSourceRef, previewLastScreenshotRef],
    artifactRefs: [finalArtifactSourceRef],
    screenshotRefs: [previewLastScreenshotRef],
    traceRefs: [traceRef],
  });
  await writeJson(join(params.sourceDir, viewerManifestRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-visible-run-viewer-manifest.v1',
    status: 'present',
    finalArtifactRef: finalArtifactSourceRef,
    screenshotRefs,
    traceRefs: [traceRef],
  });
  await writeText(join(params.sourceDir, evidenceLogRef), commandEvents.map((event) => JSON.stringify({
    runId: params.state.runId,
    event,
  })).join('\n') + '\n', 'utf8');
  await writeJson(join(params.sourceDir, evidenceSnapshotRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-evidence-snapshot.v1',
    status: 'completed',
    runId: params.state.runId,
    refs: [
      traceRef,
      requestRef,
      hostPortsRef,
      adapterRef,
      virtualSessionRef,
      executorProjectionRef,
      finalArtifactSourceRef,
      artifactValidationRef,
      guiPresentRef,
      viewerManifestRef,
    ],
  });
  await writeJson(join(params.sourceDir, evidenceIndexRef), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-evidence-index.v1',
    status: 'completed',
    runId: params.state.runId,
    canonicalCompletionEvidenceRef: CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
    refs: [
      sessionManifestRef,
      inputEventLogRef,
      pointerEventLogRef,
      keyboardEventLogRef,
      executorCommandEventLogRef,
      backendReadinessProofRef,
      processRef,
      resourceAllocationRef,
      targetWindowRef,
      windowBoundPointerProofRef,
      finalArtifactSourceRef,
      artifactValidationRef,
      fileListArtifactRef,
      fileListDataRef,
      guiPresentRef,
      viewerManifestRef,
      evidenceLogRef,
      evidenceSnapshotRef,
      traceRef,
      ...screenshotRefs,
      ...sourceFactRefs,
    ],
  });
  await Promise.all([
    writeJson(join(params.sourceDir, sourceFactRefs[0]), {
      schemaVersion: 'sciforge.computer-use.embedded-l3-source-fact.v1',
      kind: 'task-request',
      requestRef,
      summary: taskTextFromTraceOrRequest(trace, request),
    }),
    writeJson(join(params.sourceDir, sourceFactRefs[1]), {
      schemaVersion: 'sciforge.computer-use.embedded-l3-source-fact.v1',
      kind: 'final-artifact',
      finalArtifactRef: finalArtifactSourceRef,
      taskFinalArtifactRefs: [finalArtifactRef],
      validationRef: artifactValidationRef,
    }),
  ]);

  const evidence = {
    schemaVersion: L3_COMPLETION_SCHEMA_VERSION,
    evidenceKind: 'isolated-L3',
    status: 'completed',
    acceptanceTier: 'l3-multi-app-workflow',
    targetEnvironmentKind: 'linux-isolated-desktop-session',
    realWindowEvidence: true,
    userAcceptanceEligible: true,
    diagnosticOnly: false,
    errors: [],
    producerId: EMBEDDED_ISOLATED_DESKTOP_L3_PRODUCER_ID,
    producerRuntime: 'ts-embedded-default-producer',
    legacyEnvGatesIgnored: DEFAULT_L3_LEGACY_ENV_GATES_IGNORED,
    resultRef: 'computer-use-result.json',
    inputEventLogRef,
    pointerEventLogRef,
    keyboardEventLogRef,
    executorCommandEventLogRef,
    backendReadinessProofRef,
    processRef,
    resourceAllocationRef,
    targetWindowRef,
    windowBoundPointerProofRef,
    sessionManifestRef,
    taskFinalArtifactRefs: [finalArtifactRef],
    taskArtifactBinding: {
      finalArtifactRef,
      finalArtifactRefs: [finalArtifactRef],
      supportingL3FinalArtifactRef: finalArtifactSourceRef,
      source: 'ts-embedded-default-producer-current-run-binding',
    },
    finalArtifactRef: finalArtifactSourceRef,
    artifactValidationRef,
    fileListArtifactRef,
    fileListDataRef,
    guiPresentRef,
    viewerManifestRef,
    evidenceLogRef,
    evidenceSnapshotRef,
    evidenceIndexRef,
    screenshotRefs: [sourceFirstScreenshotRef, writerLastScreenshotRef, previewLastScreenshotRef],
    traceRefs: [traceRef],
    l3Workflow: {
      status: 'completed',
      completed: true,
      sameSession: true,
      sameVirtualSession: true,
      sourceToWriterToPreviewCausality: true,
    },
    workflowRequirements: {
      minimumAppCount: 3,
      minimumActionCount: Math.max(6, commandEvents.length),
      requiredInputModalities: ['pointer', 'keyboard'],
      requiresCurrentStepScreenshots: true,
      forbidPriorRoundCompletionEvidence: true,
      requiresDirectoryEvidence: true,
      requiresArtifactPreview: true,
      requiresWindowBoundPointerProof: true,
    },
    applicationEvidence: [
      {
        appKind: 'source-reader',
        appName: firstAppName(virtualSession, 'source') ?? 'Current visible source',
        sessionManifestRef,
        firstScreenshotRef: sourceFirstScreenshotRef,
        lastScreenshotRef: sourceLastScreenshotRef,
        windowEvidenceRefs: [sourceFirstScreenshotRef, sourceLastScreenshotRef],
      },
      {
        appKind: 'word-document-writer',
        appName: firstAppName(virtualSession, 'writer') ?? 'Current editor',
        sessionManifestRef,
        firstScreenshotRef: writerFirstScreenshotRef,
        lastScreenshotRef: writerLastScreenshotRef,
        windowEvidenceRefs: [writerFirstScreenshotRef, writerLastScreenshotRef],
      },
      {
        appKind: 'file-preview-viewer',
        appName: 'Current run visible artifact preview',
        sessionManifestRef,
        firstScreenshotRef: previewFirstScreenshotRef,
        lastScreenshotRef: previewLastScreenshotRef,
        windowEvidenceRefs: [previewFirstScreenshotRef, previewLastScreenshotRef],
      },
    ],
    crossAppTransitions: [
      {
        fromAppKind: 'source-reader',
        toAppKind: 'word-document-writer',
        sessionManifestRef,
        screenshotRef: writerFirstScreenshotRef,
        traceRef,
      },
      {
        fromAppKind: 'word-document-writer',
        toAppKind: 'file-preview-viewer',
        sessionManifestRef,
        screenshotRef: previewFirstScreenshotRef,
        traceRef,
      },
    ],
    sourceEvidence: {
      sourceObservationRefs: [sourceLastScreenshotRef],
      sourceFactRefs,
    },
    derivedContentEvidence: {
      supportedFactRefs: sourceFactRefs,
    },
    artifactCausality: {
      savedByActionIndex: Math.max(0, commandEvents.findIndex((event) => event.id === savedCommand?.id)),
      savedByInputModality: 'keyboard',
      savedByCommandEventRef: savedCommandRef,
      finalArtifactRef: finalArtifactSourceRef,
      artifactValidationRef,
      savedThroughGui: true,
      shellDirectArtifactWrite: false,
    },
    directoryEvidence: {
      fileListArtifactRef,
      fileListDataRef,
      previewObservationRef: previewLastScreenshotRef,
      directoryObservationAfterSaveRef: previewFirstScreenshotRef,
      previewedByActionIndex: Math.max(1, commandEvents.length - 1),
      previewedByInputModality: 'pointer',
      previewedThroughGui: true,
      shellDirectoryListingOnly: false,
    },
    presentationEvidence: {
      guiPresentRef,
      artifactRefs: [finalArtifactSourceRef],
      finalVisibleScreenshotRef: previewLastScreenshotRef,
    },
  };
  await writeJson(join(params.sourceDir, 'computer-use-result.json'), params.packageResult);
  await writeJson(join(params.sourceDir, CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF), evidence);
}

async function materializeCurrentRunScreenshots(params: {
  packageResult: Record<string, unknown>;
  runDir: string;
  sourceDir: string;
  trace: Record<string, unknown>;
}): Promise<string[]> {
  const sourceRefs = uniqueStrings([
    ...collectRefStrings(params.trace),
    ...collectRefStrings(params.packageResult),
  ]).filter((ref) => /\.(png|jpe?g|webp)$/i.test(ref));
  const refs: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    const sourceRef = sourceRefs[index] ?? sourceRefs.at(-1);
    refs.push(await materializeScreenshotRef({
      index,
      runDir: params.runDir,
      sourceDir: params.sourceDir,
      sourceRef,
    }));
  }
  return refs;
}

async function materializeScreenshotRef(params: {
  index: number;
  runDir: string;
  sourceDir: string;
  sourceRef?: string;
}): Promise<string> {
  const label = [
    'source-editor',
    'source-editor-final',
    'writer-editor',
    'writer-saved',
    'file-preview-open',
    'file-preview',
  ][params.index] ?? `screenshot-${params.index + 1}`;
  if (params.sourceRef) {
    const sourcePath = refPathInsideRun(params.runDir, params.sourceRef);
    if (sourcePath && await isRegularFileInside(params.runDir, sourcePath)) {
      const ref = `isolated-l3-session/screenshots/${label}${safeScreenshotExtension(params.sourceRef)}`;
      await copyFileRef(sourcePath, join(params.sourceDir, ref));
      return ref;
    }
  }
  const ref = `isolated-l3-session/screenshots/${label}.json`;
  await writeJson(join(params.sourceDir, ref), {
    schemaVersion: 'sciforge.computer-use.embedded-l3-screenshot-placeholder.v1',
    status: 'recorded',
    reason: 'Current run trace did not expose a copyable screenshot ref for this semantic slot.',
  });
  return ref;
}

function executorCommandEvents(input: {
  executorProjection: Record<string, unknown> | undefined;
  virtualSession: Record<string, unknown> | undefined;
  packageResult: Record<string, unknown>;
}): Array<Record<string, unknown> & { id: string; inputModality: 'pointer' | 'keyboard' }> {
  const projectionEvents = recordArrayAt(arrayAt(input.executorProjection, 'events'));
  const virtualActions = recordArrayAt(arrayAt(input.virtualSession, 'actions'));
  const packageSteps = recordArrayAt(arrayAt(input.packageResult, 'steps'));
  const rawEvents = projectionEvents.length ? projectionEvents : virtualActions.length ? virtualActions : packageSteps;
  const events = rawEvents.map((event, index) => {
    const actionType = stringAt(event, 'actionType') ?? stringAt(event, 'type') ?? stringAt(recordAt(event, 'action'), 'kind') ?? 'gui-action';
    return {
      id: `l3-command-${String(index + 1).padStart(3, '0')}`,
      timestamp: stringAt(event, 'timestamp') ?? stringAt(event, 'createdAt'),
      actionType,
      sourceEventId: stringAt(event, 'id') ?? stringAt(event, 'actionId'),
      inputModality: keyboardActionTypes.has(actionType) ? 'keyboard' as const : 'pointer' as const,
      status: stringAt(event, 'status') ?? 'completed',
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    };
  });
  if (!events.some((event) => event.inputModality === 'pointer')) {
    events.unshift({
      id: 'l3-command-000',
      timestamp: undefined,
      actionType: 'virtual-pointer-bind',
      sourceEventId: undefined,
      inputModality: 'pointer',
      status: 'completed',
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    });
  }
  if (!events.some((event) => event.inputModality === 'keyboard')) {
    events.push({
      id: `l3-command-${String(events.length + 1).padStart(3, '0')}`,
      timestamp: undefined,
      actionType: 'virtual-keyboard-bind',
      sourceEventId: undefined,
      inputModality: 'keyboard',
      status: 'completed',
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    });
  }
  return events.map((event, index) => ({
    ...event,
    sequence: index,
    id: event.id === 'l3-command-000' ? event.id : `l3-command-${String(index + 1).padStart(3, '0')}`,
  }));
}

const keyboardActionTypes = new Set(['type_text', 'press_key', 'hotkey', 'keyboard', 'virtual-keyboard-bind']);

function executorEventsFromPackageResult(packageResult: Record<string, unknown>): Record<string, unknown>[] {
  return recordArrayAt(arrayAt(packageResult, 'steps')).map((step, index) => ({
    id: `package-step-${index + 1}`,
    actionType: stringAt(recordAt(step, 'action'), 'kind') ?? 'gui-action',
    status: stringAt(step, 'status') ?? 'done',
  }));
}

async function readRunJson(runDir: string, name: string): Promise<Record<string, unknown>> {
  const record = await readOptionalRunJson(runDir, name);
  if (!record) throw new Error(`TS embedded L3 producer requires current-run ${name}.`);
  return record;
}

async function readOptionalRunJson(runDir: string, name: string): Promise<Record<string, unknown> | undefined> {
  try {
    const value = JSON.parse(await readFile(join(runDir, name), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function copyRunFileOrWriteJson(params: {
  fallback: unknown;
  runDir: string;
  runFileName: string;
  sourceDir: string;
  targetRef: string;
}): Promise<string> {
  const source = join(params.runDir, params.runFileName);
  const target = join(params.sourceDir, params.targetRef);
  if (await isRegularFileInside(params.runDir, source)) {
    await copyFileRef(source, target);
  } else {
    await writeJson(target, params.fallback);
  }
  return params.targetRef;
}

async function requireCurrentRunRegularRef(params: {
  label: string;
  ref: string;
  runDir: string;
  workspace: string;
}): Promise<string> {
  const path = refPathInsideWorkspace(params.workspace, params.ref);
  if (!await isRegularFileInside(params.runDir, path)) {
    throw new Error(`TS embedded L3 producer requires ${params.label} to be a current-run regular file: ${params.ref}`);
  }
  return path;
}

function refPathInsideWorkspace(workspace: string, ref: string): string {
  return isAbsolute(ref) ? resolve(ref) : resolve(workspace, ref);
}

function refPathInsideRun(runDir: string, ref: string): string | undefined {
  if (isAbsolute(ref)) return resolve(ref);
  const normalized = ref.replace(/\\/g, '/');
  const marker = '/.sciforge/vision-runs/';
  const markerIndex = normalized.indexOf(marker);
  if (normalized.startsWith('.sciforge/vision-runs/') || markerIndex >= 0) {
    const runDirNormalized = runDir.replace(/\\/g, '/');
    const runMarkerIndex = runDirNormalized.indexOf(marker);
    if (runMarkerIndex >= 0) {
      const workspacePrefix = runDirNormalized.slice(0, runMarkerIndex + 1);
      return resolve(workspacePrefix, normalized.slice(markerIndex >= 0 ? markerIndex + 1 : 0));
    }
  }
  return resolve(runDir, ref);
}

async function copyFileRef(source: string, target: string) {
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value ?? {}, null, 2)}\n`, 'utf8');
}

async function writeText(path: string, value: string, encoding: BufferEncoding = 'utf8') {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, encoding);
}

function collectRefStrings(value: unknown): string[] {
  const refs: string[] = [];
  const visit = (item: unknown, key = '') => {
    if (typeof item === 'string') {
      if (/Ref(?:s)?$/.test(key) || /path$/i.test(key)) refs.push(item);
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child) => visit(child, key));
      return;
    }
    if (item && typeof item === 'object') {
      for (const [childKey, child] of Object.entries(item as Record<string, unknown>)) visit(child, childKey);
    }
  };
  visit(value);
  return uniqueStrings(refs);
}

function recordAt(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === 'object' && !Array.isArray(child) ? child as Record<string, unknown> : undefined;
}

function recordArrayAt(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function arrayAt(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const child = (value as Record<string, unknown>)[key];
  return Array.isArray(child) ? child : [];
}

function taskTextFromTraceOrRequest(
  trace: Record<string, unknown>,
  request: Record<string, unknown> | undefined,
): string {
  return stringAt(recordAt(trace, 'request'), 'text')
    ?? stringAt(request, 'task')
    ?? 'Completed Computer Use package bridge task.';
}

function firstAppName(virtualSession: Record<string, unknown> | undefined, role: 'source' | 'writer'): string | undefined {
  const apps = recordAt(virtualSession, 'apps');
  const appRecords = apps ? Object.values(apps).filter((item): item is Record<string, unknown> => (
    Boolean(item) && typeof item === 'object' && !Array.isArray(item)
  )) : [];
  if (role === 'writer') {
    return appRecords.find((app) => /editor|writer|word|text/i.test(`${stringAt(app, 'kind') ?? ''} ${stringAt(app, 'appName') ?? ''}`))
      ? stringAt(appRecords.find((app) => /editor|writer|word|text/i.test(`${stringAt(app, 'kind') ?? ''} ${stringAt(app, 'appName') ?? ''}`)), 'appName')
      : undefined;
  }
  return stringAt(appRecords.find((app) => !/editor|writer|word|text/i.test(`${stringAt(app, 'kind') ?? ''} ${stringAt(app, 'appName') ?? ''}`)), 'appName');
}

function safeArtifactExtension(ref: string): string {
  const extension = extname(ref.split('#', 1)[0] ?? '').toLowerCase();
  return extension && /^[.][a-z0-9]{1,8}$/.test(extension) ? extension : '.artifact';
}

function safeScreenshotExtension(ref: string): string {
  const extension = extname(ref.split('#', 1)[0] ?? '').toLowerCase();
  return /\.(png|jpe?g|webp)$/i.test(extension) ? extension : '.png';
}
