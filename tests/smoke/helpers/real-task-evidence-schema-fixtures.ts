import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import type { DesktopLiveAcceptanceEvidence } from '../../../src/desktop/desktop-live-acceptance-evidence.js';
import { CANCELLATION_EVIDENCE_SCHEMA_VERSION } from '../../../src/runtime/codex/cancellation-evidence.js';
import { SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION } from '../../../src/runtime/codex/service-lifecycle-evidence.js';

export type RealTaskEvidenceStatus = 'not-run' | 'blocked' | 'partial' | 'failed' | 'passed';

export type RealTaskEvidenceManifest = {
  taskId: string;
  status: RealTaskEvidenceStatus;
  releaseEligible?: boolean;
  releaseBlocking?: boolean;
  attemptScope?: 'shared-preflight' | 'task-specific-live-attempt' | 'desktop-preflight' | 'desktop-live-attempt';
  currentRunEvidenceScope?: 'shared-preflight' | 'task-specific-live-attempt' | 'desktop-preflight' | 'desktop-live-attempt';
  source?: {
    entrypoint?: string;
    evidenceMode?: string;
    devServices?: string;
    harnessMode?: string;
    runtimeSource?: string;
  };
  entrypointExpectations?: {
    entrypoint?: string;
    startedFromDefaultChatEntry?: boolean;
    requiresRuntimeCodex?: boolean;
    requiresLiveBrowserAcceptance?: boolean;
    requiresProductionDesktopAcceptance?: boolean;
    requiresVisibleGuiPresentAnswer?: boolean;
    allowsScriptableMockAsPass?: boolean;
    allowsSeedDemoFixtureAsPass?: boolean;
  };
  provider?: string | null;
  model?: string | null;
  profile?: string | null;
  workspacePath?: string;
  actualUrl?: string;
  actualPort?: number;
  commandId?: string;
  desktopLiveAcceptanceEvidenceRef?: string;
  evidenceRefs?: string[];
  selectedRefEvidence?: {
    artifactRef?: string;
    exemptionReason?: string;
    evidenceRefs?: string[];
    selectedRefs?: string[];
    forbiddenRefs?: string[];
    followupRunIds?: string[];
    latestArtifactUsed?: boolean;
    derivedArtifactRef?: string;
    resumeMetadataRef?: string;
    commandTextPolicy?: {
      newUserRequestOnly?: boolean;
      selectedRefsOnly?: boolean;
      replaysGuiTranscript?: boolean;
      includesFullArtifactBody?: boolean;
      evidenceRefs?: string[];
    };
  };
  restoredGuiStateSource?: string;
  nativeContinuity?: {
    codexSessionId?: string;
    resumeCommand?: string;
    attemptId?: string;
    evidenceRefs?: string[];
  };
  serviceLifecycleEvidence?: {
    ledgerRef?: string;
    actualPort?: number;
    cleanupEvidenceRefs?: string[];
    readinessCheckRefs?: string[];
    browserRefreshEvidenceRefs?: string[];
    passClaimRefs?: string[];
  };
  cancellationEvidence?: {
    ledgerRef?: string;
    safeContinuationPlanRef?: string;
    partialArtifactRefs?: string[];
    unsafeRemainderRefs?: string[];
    irreversibleSideEffectRefs?: string[];
  };
  securityScrubEvidence?: {
    rawAuditBundleManifestRef?: string;
    diagnosisRef?: string;
    correctedConfigRetryRef?: string;
    primaryReplyDomRefs?: string[];
    forbiddenLeakCheckRefs?: string[];
  };
  failedRunAuditExport?: {
    bundleManifestRef?: string;
    runId?: string;
    commandId?: string;
    provider?: string;
    model?: string;
    profile?: string;
    boundedScrubbedRefs?: string[];
  };
  providerOutageRecovery?: {
    failureClassification?: string;
    initialFailureStatus?: string;
    initialFailureRunId?: string;
    recoveryRunId?: string;
    initialFailureRef?: string;
    recoveryEvidenceRef?: string;
    freshDispatchEvidenceRef?: string;
    reusedFailedOutputAsSuccessEvidence?: boolean;
  };
  capabilityDiscoveryEvidence?: {
    rounds?: Array<{
      round?: number;
      tuiPlanningRef?: string;
      chosenRoute?: string;
      alternatives?: string[];
      discoveryPlanIsCompletionEvidence?: boolean;
      guiRankingAbsent?: boolean;
      completionEvidenceRefAbsent?: boolean;
    }>;
    routeChanged?: boolean;
    finalRouteChangeRef?: string;
    finalAnswerRef?: string;
    evidenceRefs?: string[];
  };
  skillPromotionEvidence?: {
    artifactRef?: string;
    workspaceProposalRef?: string;
    stagingOnly?: boolean;
    targets?: Array<{
      targetType?: string;
      scope?: string[];
      safetyGates?: string[];
      validationCommands?: string[];
      installCallLocation?: string;
    }>;
    evidenceRefs?: string[];
  };
  computerUseEvidenceFold?: {
    foldedEvidenceRef?: string;
    rawRefs?: Array<{
      kind?: string;
      ref?: string;
      auditOnly?: boolean;
      foldedIntoRef?: string;
    }>;
    uiExecutedComputerUseActions?: boolean;
    visibleArtifactRefs?: string[];
    primaryArtifactRefs?: string[];
    supportingArtifactRefs?: string[];
    evidenceRefs?: string[];
  };
  turns: Array<{
    turnId: string;
    prompt: string;
    visibleAnswer?: string | { text?: string };
    screenshotRefs?: string[];
    auditRefs?: string[];
    evidenceSource?: string;
  }>;
  visibleAnswer?: string | { text?: string };
  screenshotRefs?: string[];
  auditRefs?: string[];
  artifactPaths?: string[];
  noArtifactReason?: string;
};

export function passedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  writeFileSync(join(workspaceRoot, 'screenshot-round-3.png'), 'png');
  writeFileSync(join(workspaceRoot, 'evidence-dom.txt'), 'visible DOM mentions codex-command-live-1 and selected artifact ref artifact:report\n');
  writeFileSync(join(workspaceRoot, 'report.md'), '# Evidence report\n');
  return {
    taskId: 'R-DATA-01',
    status: 'passed',
    releaseEligible: true,
    releaseBlocking: false,
    source: {
      entrypoint: 'codex-in-app-browser-default-chat',
      evidenceMode: 'live-runtime-codex',
      devServices: 'live-browser',
      harnessMode: 'manual-default-chat',
      runtimeSource: 'runtime-codex',
    },
    entrypointExpectations: {
      entrypoint: 'codex-in-app-browser-default-chat',
      startedFromDefaultChatEntry: true,
      requiresRuntimeCodex: true,
      requiresLiveBrowserAcceptance: true,
      requiresProductionDesktopAcceptance: false,
      requiresVisibleGuiPresentAnswer: true,
      allowsScriptableMockAsPass: false,
      allowsSeedDemoFixtureAsPass: false,
    },
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    profile: 'sciforge-runtime-deepseek',
    workspacePath: workspaceRoot,
    actualUrl: 'http://127.0.0.1:5173/',
    actualPort: 5173,
    commandId: 'codex-command-live-1',
    evidenceRefs: ['evidence-dom.txt', 'screenshot-round-3.png'],
    selectedRefEvidence: {
      artifactRef: 'artifact:report',
      evidenceRefs: ['evidence-dom.txt'],
    },
    turns: [
      { turnId: 'turn-1', prompt: 'Load the dataset and inspect columns.' },
      { turnId: 'turn-2', prompt: 'Run the analysis and preserve lineage refs.' },
      {
        turnId: 'turn-3',
        prompt: 'Explain the result from the visible UI.',
        visibleAnswer: 'The third visible answer is present in the default chat UI.',
        screenshotRefs: ['screenshot-round-3.png'],
        auditRefs: ['runtime-codex:command:cmd-1:attempt:1'],
      },
    ],
    visibleAnswer: {
      text: 'The third visible answer is present in the default chat UI.',
    },
    screenshotRefs: ['screenshot-round-3.png'],
    auditRefs: ['runtime-codex:command:cmd-1:attempt:1'],
    artifactPaths: ['report.md'],
  };
}

export function desktopPassedManifest(
  workspaceRoot: string,
  taskId: 'R-DESK-01' | 'R-PKG-01',
  desktopLiveAcceptanceEvidenceRef = writeDesktopLiveAcceptanceEvidence(workspaceRoot),
): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  return {
    ...manifest,
    taskId,
    source: {
      ...manifest.source,
      entrypoint: 'production-desktop-cold-start',
      devServices: 'production-electron',
      harnessMode: 'packaged-app-cold-start',
    },
    actualUrl: 'http://127.0.0.1:62010/',
    actualPort: 62010,
    desktopLiveAcceptanceEvidenceRef,
    evidenceRefs: [...stringList(manifest.evidenceRefs), desktopLiveAcceptanceEvidenceRef],
    entrypointExpectations: {
      entrypoint: 'production-desktop-cold-start',
      startedFromDefaultChatEntry: false,
      requiresRuntimeCodex: true,
      requiresLiveBrowserAcceptance: false,
      requiresProductionDesktopAcceptance: true,
      requiresVisibleGuiPresentAnswer: true,
      allowsScriptableMockAsPass: false,
      allowsSeedDemoFixtureAsPass: false,
    },
  };
}

export function writeDesktopLiveAcceptanceEvidence(
  workspaceRoot: string,
  fileName = 'desktop-live-acceptance.json',
  overrides: {
    runtimeTask?: Partial<DesktopLiveAcceptanceEvidence['runtimeTask']>;
    artifactFollowup?: Partial<DesktopLiveAcceptanceEvidence['artifactFollowup']>;
    shutdown?: Partial<DesktopLiveAcceptanceEvidence['shutdown']>;
  } = {},
): string {
  const appDataPath = join(workspaceRoot, 'app-data');
  const logsPath = join(appDataPath, 'logs');
  const runtimeCommandId = 'codex-command-desktop-live-001';
  const followupCommandId = 'codex-command-desktop-followup-001';
  const evidence: DesktopLiveAcceptanceEvidence = {
    schemaVersion: 'sciforge.desktop.live-acceptance-evidence.v1',
    launch: {
      mode: 'packaged-app',
      electronEntrypointPresent: true,
      electronDependencyPresent: true,
      coldStart: true,
      packagedArtifactPath: '/Applications/SciForge.app',
      productionMode: true,
      productionArtifactInspection: {
        schemaVersion: 'sciforge.desktop.production-artifact-inspection.v1',
        artifactPath: '/Applications/SciForge.app',
        inspectable: true,
        credentialsRequired: false,
        mainProcessInspected: true,
        preloadInspected: true,
        rendererArtifactInspected: true,
        viteDevServerUrlFound: false,
        canClaimRDeskOrRPkgPass: false,
      },
    },
    renderer: {
      loadedFrom: 'dist-ui/index.html',
      filePath: '/Applications/SciForge.app/Contents/Resources/app/dist-ui/index.html',
      buildArtifactExists: true,
    },
    runtimeTask: {
      runtime: 'Runtime Codex',
      taskKind: 'real-user-task',
      profile: 'sciforge-runtime-deepseek',
      provider: 'sciforge-deepseek-proxy',
      model: 'bailian/deepseek-v4-flash',
      workspacePath: join(workspaceRoot, 'workspace'),
      commandId: runtimeCommandId,
      providerProxyUsed: true,
      providerAuditVisible: true,
      answerVisibleInRenderer: true,
      rawPreflightOnly: false,
      taskId: 'desktop-live-task-001',
      auditRefs: [
        join(logsPath, 'runtime-codex', runtimeCommandId, 'manifest.json'),
      ],
      ...overrides.runtimeTask,
    },
    artifactFollowup: {
      selectedArtifactRef: 'artifact:research-report',
      commandId: followupCommandId,
      artifactOpenedInRenderer: true,
      followupSubmittedAgainstSelectedArtifact: true,
      followupAnswerVisibleInRenderer: true,
      didNotStartNewSearch: true,
      evidenceRefs: [
        join(logsPath, 'runtime-codex', followupCommandId, 'selected-followup.json'),
      ],
      ...overrides.artifactFollowup,
    },
    sidecars: [
      {
        role: 'workspace-server',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(logsPath, 'sidecars', 'workspace-server.log'),
      },
      {
        role: 'provider-proxy',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(logsPath, 'sidecars', 'provider-proxy.log'),
      },
      {
        role: 'runtime-codex',
        owner: 'electron-main',
        startedBy: 'electron-main-before-renderer-ready',
        stoppedBy: 'electron-main-shutdown',
        healthCheck: 'pass',
        logPath: join(logsPath, 'sidecars', 'runtime-codex.log'),
      },
    ],
    ports: [
      { name: 'workspace-server', host: '127.0.0.1', actualPort: 62010, allocation: 'dynamic' },
      { name: 'provider-proxy', host: '127.0.0.1', actualPort: 62011, allocation: 'dynamic' },
      { name: 'runtime-codex', host: '127.0.0.1', actualPort: 62012, allocation: 'dynamic' },
    ],
    paths: {
      appDataPath,
      logsPath,
      sidecarLogsPath: join(logsPath, 'sidecars'),
      auditLogPath: join(logsPath, 'desktop-runtime-audit.ndjson'),
    },
    shutdown: {
      requestedFrom: 'app-quit',
      clean: true,
      rendererClosed: true,
      sidecarsStopped: true,
      portsReleased: true,
      auditLogClosed: true,
      evidenceRefs: [
        join(logsPath, 'desktop-runtime-audit.ndjson'),
      ],
      ...overrides.shutdown,
    },
  };
  materializeDesktopLiveAcceptanceEvidence(evidence);
  writeFileSync(join(workspaceRoot, fileName), JSON.stringify(evidence, null, 2));
  return fileName;
}

function materializeDesktopLiveAcceptanceEvidence(evidence: DesktopLiveAcceptanceEvidence): void {
  mkdirSync(evidence.runtimeTask.workspacePath, { recursive: true });
  mkdirSync(evidence.paths.appDataPath, { recursive: true });
  mkdirSync(evidence.paths.logsPath, { recursive: true });
  mkdirSync(evidence.paths.sidecarLogsPath, { recursive: true });

  writeMaterializedFile(evidence.paths.auditLogPath, '{"event":"desktop-live-acceptance"}\n');
  for (const sidecar of evidence.sidecars) {
    writeMaterializedFile(sidecar.logPath, `${sidecar.role} health=pass\n`);
  }
  for (const ref of evidence.runtimeTask.auditRefs) {
    if (ref === join(evidence.paths.logsPath, 'runtime-codex', evidence.runtimeTask.commandId, 'manifest.json')) {
      writeMaterializedJsonFile(ref, {
        commandId: evidence.runtimeTask.commandId,
        provider: evidence.runtimeTask.provider,
        model: evidence.runtimeTask.model,
      });
    } else {
      writeMaterializedFile(ref, '{"event":"runtime-audit"}\n');
    }
  }
  for (const ref of evidence.artifactFollowup.evidenceRefs) {
    writeMaterializedJsonFile(ref, {
      commandId: evidence.artifactFollowup.commandId,
      selectedArtifactRef: evidence.artifactFollowup.selectedArtifactRef,
    });
  }
  for (const ref of evidence.shutdown.evidenceRefs) {
    writeMaterializedFile(ref, '{"event":"shutdown"}\n');
  }
}

function writeMaterializedJsonFile(path: string, value: Record<string, unknown>): void {
  writeMaterializedFile(path, JSON.stringify(value, null, 2));
}

function writeMaterializedFile(path: string, value: string): void {
  if (!isAbsolute(path) || path.split('/').includes('..')) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
}

export function lit03PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  writeFileSync(join(workspaceRoot, 'selected-scope-audit.json'), JSON.stringify({
    oldFollowup: {
      selectedRefs: ['artifact:r-lit-03-old-report'],
      forbiddenRefs: ['artifact:r-lit-01-chinese-report', 'artifact:r-lit-03-new-report'],
    },
    switchFollowup: {
      selectedRefs: ['artifact:r-lit-03-new-report'],
      forbiddenRefs: ['artifact:r-lit-01-chinese-report', 'artifact:r-lit-03-old-report'],
    },
    latestArtifactUsed: false,
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'evidence-matrix.json'), JSON.stringify([
    { reportRef: 'artifact:r-lit-03-old-report', latestArtifactUsed: false },
    { reportRef: 'artifact:r-lit-03-new-report', latestArtifactUsed: false },
  ], null, 2));
  return {
    ...passedManifest(workspaceRoot),
    taskId: 'R-LIT-03',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-lit-03-old-report',
      selectedRefs: ['artifact:r-lit-03-old-report', 'artifact:r-lit-03-new-report'],
      forbiddenRefs: ['artifact:r-lit-01-chinese-report', 'artifact:r-lit-03-new-report', 'artifact:r-lit-03-old-report'],
      followupRunIds: ['run-r-lit-03-selected-old-followup', 'run-r-lit-03-switch-selection-followup'],
      latestArtifactUsed: false,
      evidenceRefs: ['evidence-dom.txt', 'selected-scope-audit.json', 'evidence-matrix.json'],
    },
    artifactPaths: ['report.md', 'evidence-matrix.json'],
  };
}

export function resume01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  writeFileSync(join(workspaceRoot, 'derived-report.md'), '# Derived resume risk matrix\n');
  writeFileSync(join(workspaceRoot, 'resume-metadata.json'), JSON.stringify({
    status: 'resumed',
    codexSessionId: 'codex-session-r-resume-01-native',
    selectedRefs: ['artifact:r-resume-01-source-report'],
    derivedArtifactRef: 'artifact:r-resume-01-derived-report',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'command-text.txt'), [
    'Using the selected artifact only, derive the risk matrix and include native resume metadata.',
    '',
    'Selected refs:',
    '- artifact:r-resume-01-source-report',
  ].join('\n'));
  return {
    ...passedManifest(workspaceRoot),
    taskId: 'R-RESUME-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-resume-01-source-report',
      selectedRefs: ['artifact:r-resume-01-source-report'],
      derivedArtifactRef: 'artifact:r-resume-01-derived-report',
      resumeMetadataRef: 'resume-metadata.json',
      evidenceRefs: ['evidence-dom.txt', 'resume-metadata.json', 'command-text.txt'],
      commandTextPolicy: {
        newUserRequestOnly: true,
        selectedRefsOnly: true,
        replaysGuiTranscript: false,
        includesFullArtifactBody: false,
        evidenceRefs: ['command-text.txt'],
      },
    },
    nativeContinuity: {
      codexSessionId: 'codex-session-r-resume-01-native',
      attemptId: 'codex-command-r-resume-01-attempt-1',
      resumeCommand: 'codex exec resume --json codex-session-r-resume-01-native ask "Using the selected artifact only, derive the risk matrix for artifact:r-resume-01-source-report"',
      evidenceRefs: ['resume-metadata.json'],
    },
    artifactPaths: ['report.md', 'derived-report.md'],
  };
}

export function resume02PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  return {
    ...passedManifest(workspaceRoot),
    taskId: 'R-RESUME-02',
    restoredGuiStateSource: 'conversation-projection-after-browser-refresh',
    nativeContinuity: {
      codexSessionId: '019e3e82-164d-79b2-a5d4-b16241620b10',
      attemptId: 'codex-command-refresh-attempt-2',
      resumeCommand: 'codex exec resume --json 019e3e82-164d-79b2-a5d4-b16241620b10 ask "continue from restored GUI state summary"',
      evidenceRefs: [
        'audit:codex-runtime:codex-command-refresh:codex-command-refresh-attempt-2:normalized-events',
      ],
    },
    noArtifactReason: 'R-RESUME-02 verifies refresh recovery and native continuity evidence rather than producing a new artifact.',
  };
}

export function run01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  const actualPort = 6176;
  writeServiceLifecycleEvidence(workspaceRoot, actualPort);
  return {
    ...manifest,
    taskId: 'R-RUN-01',
    actualUrl: `http://127.0.0.1:${actualPort}/`,
    actualPort,
    noArtifactReason: 'R-RUN-01 verifies service lifecycle recovery and does not need a user artifact.',
    artifactPaths: [],
    selectedRefEvidence: {
      exemptionReason: 'Service lifecycle recovery has no selectable artifact; browser refresh evidence is exported instead.',
      evidenceRefs: ['browser-refresh-evidence.txt'],
    },
    serviceLifecycleEvidence: {
      ledgerRef: 'service-lifecycle-evidence.json',
      actualPort,
      cleanupEvidenceRefs: ['stale-cleanup.txt'],
      readinessCheckRefs: ['readiness-check.txt'],
      browserRefreshEvidenceRefs: ['browser-refresh-evidence.txt'],
      passClaimRefs: ['service-pass-claim.txt'],
    },
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'service-lifecycle-evidence.json',
      'readiness-check.txt',
      'browser-refresh-evidence.txt',
    ],
  };
}

export function run02PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeCancellationEvidence(workspaceRoot);
  return {
    ...manifest,
    taskId: 'R-RUN-02',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-run-02-partial-notebook',
      selectedRefs: ['artifact:r-run-02-partial-notebook'],
      evidenceRefs: ['partial-artifact-ref.txt', 'safe-continuation-plan.json'],
    },
    cancellationEvidence: {
      ledgerRef: 'cancellation-evidence.json',
      safeContinuationPlanRef: 'safe-continuation-plan.json',
      partialArtifactRefs: ['partial-artifact-ref.txt'],
      unsafeRemainderRefs: ['unsafe-remainder.json'],
      irreversibleSideEffectRefs: ['irreversible-side-effects.json'],
    },
    artifactPaths: ['report.md'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'cancellation-evidence.json',
      'safe-continuation-plan.json',
    ],
  };
}

export function sec01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeRuntimeAuditBundle(workspaceRoot, { manifestRef: 'security-audit-bundle/manifest.json', status: 'failed' });
  writeFileSync(join(workspaceRoot, 'diagnosis.md'), 'Provider failure diagnosis uses scrubbed digests and no raw provider body.\n');
  writeFileSync(join(workspaceRoot, 'corrected-config-retry.json'), JSON.stringify({
    retryCommandId: 'codex-command-r-sec-01-retry',
    correctedConfigApplied: true,
    rawSecretIncluded: false,
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'primary-reply-dom.txt'), 'Visible diagnosis: provider configuration failed; audit refs are scrubbed.\n');
  writeFileSync(join(workspaceRoot, 'forbidden-leak-check.json'), JSON.stringify({
    apiKeysInDom: 0,
    rawProviderBodiesInDom: 0,
    pluginChallengeHtmlInDom: 0,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-SEC-01',
    securityScrubEvidence: {
      rawAuditBundleManifestRef: 'security-audit-bundle/manifest.json',
      diagnosisRef: 'diagnosis.md',
      correctedConfigRetryRef: 'corrected-config-retry.json',
      primaryReplyDomRefs: ['primary-reply-dom.txt'],
      forbiddenLeakCheckRefs: ['forbidden-leak-check.json'],
    },
    artifactPaths: ['diagnosis.md'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'security-audit-bundle/manifest.json',
      'primary-reply-dom.txt',
      'forbidden-leak-check.json',
    ],
  };
}

export function audit01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  const auditBundle = writeRuntimeAuditBundle(workspaceRoot, { manifestRef: 'failed-run-audit-bundle/manifest.json', status: 'failed' });
  return {
    ...manifest,
    taskId: 'R-AUDIT-01',
    failedRunAuditExport: {
      bundleManifestRef: 'failed-run-audit-bundle/manifest.json',
      runId: auditBundle.runId,
      commandId: auditBundle.commandId,
      provider: auditBundle.provider,
      model: auditBundle.model,
      profile: auditBundle.profile,
      boundedScrubbedRefs: [
        'failed-run-audit-bundle/raw-jsonl.scrubbed.jsonl',
        'failed-run-audit-bundle/stderr.scrubbed.log',
        'failed-run-audit-bundle/normalized-events.jsonl',
      ],
    },
    artifactPaths: ['report.md'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'failed-run-audit-bundle/manifest.json',
    ],
  };
}

export function fail01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'initial-provider-failure.json'), JSON.stringify({
    runId: 'run-r-fail-01-provider-502',
    status: 'repair-needed',
    classification: 'provider-gateway',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'provider-recovery.json'), JSON.stringify({
    runId: 'run-r-fail-01-recovered',
    status: 'completed',
    source: 'fresh-dispatch-after-provider-recovery',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'fresh-dispatch-evidence.json'), JSON.stringify({
    freshDispatch: true,
    reusedFailedOutputAsSuccessEvidence: false,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-FAIL-01',
    providerOutageRecovery: {
      failureClassification: 'provider-gateway',
      initialFailureStatus: 'repair-needed',
      initialFailureRunId: 'run-r-fail-01-provider-502',
      recoveryRunId: 'run-r-fail-01-recovered',
      initialFailureRef: 'initial-provider-failure.json',
      recoveryEvidenceRef: 'provider-recovery.json',
      freshDispatchEvidenceRef: 'fresh-dispatch-evidence.json',
      reusedFailedOutputAsSuccessEvidence: false,
    },
    artifactPaths: ['provider-recovery.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'initial-provider-failure.json',
      'provider-recovery.json',
      'fresh-dispatch-evidence.json',
    ],
  };
}

export function cap01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'capability-discovery-plan.json'), JSON.stringify({
    rounds: ['workspace-ref-reader', 'workspace-ref-reader', 'web-research-provider'],
    completionEvidence: 'not-evidence',
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'route-change-evidence.json'), JSON.stringify({
    from: 'workspace-ref-reader',
    to: 'web-research-provider',
    changedAtTurn: 3,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-CAP-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-cap-01-final-answer',
      selectedRefs: ['artifact:r-cap-01-final-answer'],
      evidenceRefs: ['capability-discovery-plan.json', 'route-change-evidence.json'],
    },
    capabilityDiscoveryEvidence: {
      rounds: [
        capabilityRound(1, 'workspace-ref-reader', ['web-research-provider', 'desktop-perception-bridge']),
        capabilityRound(2, 'workspace-ref-reader', ['web-research-provider', 'desktop-perception-bridge']),
        capabilityRound(3, 'web-research-provider', ['workspace-ref-reader', 'desktop-perception-bridge']),
      ],
      routeChanged: true,
      finalRouteChangeRef: 'route-change-evidence.json',
      finalAnswerRef: 'artifact:r-cap-01-final-answer',
      evidenceRefs: ['capability-discovery-plan.json', 'route-change-evidence.json'],
    },
    artifactPaths: ['report.md', 'capability-discovery-plan.json', 'route-change-evidence.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'capability-discovery-plan.json',
      'route-change-evidence.json',
    ],
  };
}

export function skill01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'skill-promotion-proposal.md'), '# Skill promotion proposal\n');
  writeFileSync(join(workspaceRoot, 'promotion-targets.json'), JSON.stringify({
    targets: ['skill', 'plugin', 'mcp', 'slash-command'],
    stagingOnly: true,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-SKILL-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-skill-01-codex-native-promotion-proposal',
      selectedRefs: ['artifact:r-skill-01-codex-native-promotion-proposal'],
      evidenceRefs: ['skill-promotion-proposal.md', 'promotion-targets.json'],
    },
    skillPromotionEvidence: {
      artifactRef: 'artifact:r-skill-01-codex-native-promotion-proposal',
      workspaceProposalRef: 'file:.sciforge/task-results/r-skill-01-promotion-proposal.md',
      stagingOnly: true,
      targets: [
        promotionTarget('skill', 'CODEX_HOME/skills/capability-route-planner/SKILL.md'),
        promotionTarget('plugin', '.agents/plugins/capability-boundary/.codex-plugin/plugin.json'),
        promotionTarget('mcp', 'Codex MCP config mcpServers.capability-boundary'),
        promotionTarget('slash-command', 'Codex slash-command registry /capability-route'),
      ],
      evidenceRefs: ['skill-promotion-proposal.md', 'promotion-targets.json'],
    },
    artifactPaths: ['report.md', 'skill-promotion-proposal.md', 'promotion-targets.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'skill-promotion-proposal.md',
      'promotion-targets.json',
    ],
  };
}

export function cu01PassedManifest(workspaceRoot: string): RealTaskEvidenceManifest {
  const manifest = passedManifest(workspaceRoot);
  writeFileSync(join(workspaceRoot, 'computer-use-folding-proof.json'), JSON.stringify({
    foldedEvidenceRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
    rawRefsVisible: false,
    uiExecutedComputerUseActions: false,
  }, null, 2));
  return {
    ...manifest,
    taskId: 'R-CU-01',
    selectedRefEvidence: {
      artifactRef: 'artifact:r-cu-01-folded-audit-summary',
      selectedRefs: ['artifact:r-cu-01-folded-audit-summary'],
      evidenceRefs: ['computer-use-folding-proof.json'],
    },
    computerUseEvidenceFold: {
      foldedEvidenceRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
      rawRefs: [
        {
          kind: 'screenshot',
          ref: 'audit-raw://r-cu-01/screenshot/initial-visible-state.png',
          auditOnly: true,
          foldedIntoRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
        },
        {
          kind: 'desktop-log',
          ref: 'audit-raw://r-cu-01/desktop-log/bridge-actions.jsonl',
          auditOnly: true,
          foldedIntoRef: 'audit://r-cu-01/folded/gui-perception-and-action-summary',
        },
      ],
      uiExecutedComputerUseActions: false,
      visibleArtifactRefs: ['artifact:r-cu-01-folded-audit-summary'],
      primaryArtifactRefs: ['artifact:r-cu-01-folded-audit-summary'],
      supportingArtifactRefs: [],
      evidenceRefs: ['computer-use-folding-proof.json'],
    },
    artifactPaths: ['report.md', 'computer-use-folding-proof.json'],
    evidenceRefs: [
      ...stringList(manifest.evidenceRefs),
      'computer-use-folding-proof.json',
    ],
  };
}

function capabilityRound(
  round: 1 | 2 | 3,
  chosenRoute: string,
  alternatives: string[],
): NonNullable<NonNullable<RealTaskEvidenceManifest['capabilityDiscoveryEvidence']>['rounds']>[number] {
  return {
    round,
    tuiPlanningRef: `tui-plan://r-cap-01/round-${round}`,
    chosenRoute,
    alternatives,
    discoveryPlanIsCompletionEvidence: false,
    guiRankingAbsent: true,
    completionEvidenceRefAbsent: true,
  };
}

function promotionTarget(
  targetType: 'skill' | 'plugin' | 'mcp' | 'slash-command',
  installCallLocation: string,
): NonNullable<NonNullable<RealTaskEvidenceManifest['skillPromotionEvidence']>['targets']>[number] {
  return {
    targetType,
    scope: ['Capture reusable capability routing decisions without task output payloads.'],
    safetyGates: ['Fail closed when required capability evidence is missing.'],
    validationCommands: ['npm run smoke:real-task-capability-skill-cu-gates'],
    installCallLocation,
  };
}

function writeServiceLifecycleEvidence(workspaceRoot: string, actualPort: number): void {
  writeFileSync(join(workspaceRoot, 'stale-cleanup.txt'), 'port 5176 verified not running before fallback\n');
  writeFileSync(join(workspaceRoot, 'readiness-check.txt'), `GET http://127.0.0.1:${actualPort}/healthz -> 200\n`);
  writeFileSync(join(workspaceRoot, 'browser-refresh-evidence.txt'), `Codex in-app browser refreshed to http://127.0.0.1:${actualPort}/\n`);
  writeFileSync(join(workspaceRoot, 'service-pass-claim.txt'), `pass claimed on actual port ${actualPort}\n`);
  writeFileSync(join(workspaceRoot, 'service-lifecycle-evidence.json'), JSON.stringify({
    schemaVersion: SERVICE_LIFECYCLE_EVIDENCE_SCHEMA_VERSION,
    runId: 'run-r-run-01-live',
    serviceName: 'sciforge-runtime-gateway',
    defaultPort: 5176,
    portBindings: [{
      role: 'runtime-gateway',
      defaultPort: 5176,
      actualPort,
      url: `http://127.0.0.1:${actualPort}/`,
      assignedBy: 'manual-recovery',
      conflictWithDefault: true,
      evidenceRefs: ['readiness-check.txt'],
    }],
    staleProcessCleanup: [{
      cleanupId: 'cleanup-r-run-01-verified-not-running',
      port: 5176,
      action: 'verified-not-running',
      verifiedAt: '2026-05-20T00:00:00.000Z',
      evidenceRefs: ['stale-cleanup.txt'],
    }],
    portConflictRecovery: [{
      recoveryId: 'recovery-r-run-01-fallback-port',
      requestedPort: 5176,
      actualPort,
      reason: 'default-port-occupied',
      detectedBy: 'port-preflight',
      staleCleanupIds: ['cleanup-r-run-01-verified-not-running'],
      evidenceRefs: ['readiness-check.txt'],
    }],
    codeChangeRestarts: [{
      restartId: 'restart-r-run-01-code-change',
      trigger: 'manual-after-change',
      changeRef: 'git-diff:runtime-gateway',
      previousUrl: 'http://127.0.0.1:5176/',
      restartedUrl: `http://127.0.0.1:${actualPort}/`,
      observedAt: '2026-05-20T00:00:00.000Z',
      evidenceRefs: ['readiness-check.txt'],
    }],
    browserRefreshes: [{
      refreshId: 'refresh-r-run-01-codex-browser',
      method: 'codex-in-app-browser',
      beforeUrl: 'http://127.0.0.1:5176/',
      afterUrl: `http://127.0.0.1:${actualPort}/`,
      refreshedAt: '2026-05-20T00:00:00.000Z',
      observedContent: 'ready',
      evidenceRefs: ['browser-refresh-evidence.txt'],
    }],
    readinessChecks: [{
      checkId: 'ready-r-run-01',
      url: `http://127.0.0.1:${actualPort}/`,
      port: actualPort,
      status: 'pass',
      checkedAt: '2026-05-20T00:00:00.000Z',
      responseStatus: 200,
      evidenceRefs: ['readiness-check.txt'],
    }],
    passClaims: [{
      claimId: 'pass-r-run-01',
      status: 'pass',
      claimedUrl: `http://127.0.0.1:${actualPort}/`,
      claimedPort: actualPort,
      assumesDefaultPort: false,
      evidenceRefs: ['service-pass-claim.txt'],
    }],
    auditRefs: ['audit:service-lifecycle-r-run-01'],
  }, null, 2));
}

function writeCancellationEvidence(workspaceRoot: string): void {
  writeFileSync(join(workspaceRoot, 'partial-artifact-ref.txt'), 'artifact:r-run-02-partial-notebook\n');
  writeFileSync(join(workspaceRoot, 'unsafe-remainder.json'), JSON.stringify([
    { stepId: 'submit-external-job', reason: 'would create an irreversible side effect' },
  ], null, 2));
  writeFileSync(join(workspaceRoot, 'irreversible-side-effects.json'), JSON.stringify([
    { sideEffectId: 'external-submit-blocked', status: 'not-executed' },
  ], null, 2));
  writeFileSync(join(workspaceRoot, 'safe-continuation-plan.json'), JSON.stringify({
    ok: true,
    schemaVersion: CANCELLATION_EVIDENCE_SCHEMA_VERSION,
    continuationScope: 'safe-remainder-only',
    cancelledRunId: 'run-r-run-02-cancelled',
    attemptId: 'attempt-r-run-02-1',
    executableSteps: [
      { stepId: 'validate-partial-artifact', effect: 'read-only' },
      { stepId: 'write-final-summary', effect: 'reversible-write' },
    ],
    blockedSteps: [
      { stepId: 'submit-external-job', effect: 'irreversible-side-effect' },
    ],
  }, null, 2));
  writeFileSync(join(workspaceRoot, 'cancellation-evidence.json'), JSON.stringify({
    schemaVersion: CANCELLATION_EVIDENCE_SCHEMA_VERSION,
    cancelledRunId: 'run-r-run-02-cancelled',
    attemptId: 'attempt-r-run-02-1',
    cancellation: {
      kind: 'user-cancelled',
      reason: 'User clicked cancel after partial artifact was written.',
      observedAt: '2026-05-20T00:00:00.000Z',
      requestedBy: 'user',
    },
    completedSteps: [{
      stepId: 'write-partial-notebook',
      summary: 'Partial notebook was written before cancellation.',
      artifactRefs: ['artifact:r-run-02-partial-notebook'],
      auditRefs: ['audit:cancellation-boundary'],
    }],
    partialArtifacts: [{
      ref: 'artifact:r-run-02-partial-notebook',
      status: 'partial',
      description: 'Notebook contains completed setup and incomplete final validation.',
      producerStepId: 'write-partial-notebook',
      auditRefs: ['audit:cancellation-boundary'],
    }],
    irreversibleSideEffects: [{
      sideEffectId: 'external-submit-blocked',
      stepId: 'submit-external-job',
      description: 'External submission would be irreversible and was not executed.',
      auditRefs: ['audit:cancellation-boundary'],
    }],
    unsafeRemainder: [{
      stepId: 'submit-external-job',
      action: 'Submit external job',
      reason: 'Irreversible side effect after cancellation boundary.',
      effect: 'irreversible-side-effect',
      blockedBySideEffectIds: ['external-submit-blocked'],
      auditRefs: ['audit:cancellation-boundary'],
    }],
    safeRemainder: [{
      stepId: 'validate-partial-artifact',
      action: 'Validate partial artifact without external writes',
      effect: 'read-only',
      requiredArtifactRefs: ['artifact:r-run-02-partial-notebook'],
      auditRefs: ['audit:safe-remainder'],
    }, {
      stepId: 'write-final-summary',
      action: 'Write final summary from validated partial artifact',
      effect: 'reversible-write',
      dependsOn: ['validate-partial-artifact'],
      auditRefs: ['audit:safe-remainder'],
    }],
    auditRefs: ['audit:cancellation-boundary'],
  }, null, 2));
}

export function writeRuntimeAuditBundle(
  workspaceRoot: string,
  options: { manifestRef: string; status?: 'failed' | 'done'; bytes?: number; maxBytes?: number },
): Record<string, string> {
  const bundleDir = dirname(join(workspaceRoot, options.manifestRef));
  mkdirSync(bundleDir, { recursive: true });
  const bytes = options.bytes ?? 128;
  const maxBytes = options.maxBytes ?? 1024;
  const files = {
    rawJsonl: {
      path: join(dirname(options.manifestRef), 'raw-jsonl.scrubbed.jsonl'),
      bytes,
      maxBytes,
      rawBytes: bytes,
      truncated: false,
      omittedScrubbedBytes: 0,
      rawSha256: 'sha256:raw',
    },
    stderr: {
      path: join(dirname(options.manifestRef), 'stderr.scrubbed.log'),
      bytes,
      maxBytes,
      rawBytes: bytes,
      truncated: false,
      omittedScrubbedBytes: 0,
      rawSha256: 'sha256:stderr',
    },
    normalizedEvents: {
      path: join(dirname(options.manifestRef), 'normalized-events.jsonl'),
      bytes,
      maxBytes,
      rawBytes: bytes,
      truncated: false,
      omittedScrubbedBytes: 0,
      rawSha256: 'sha256:normalized',
    },
  };
  for (const file of Object.values(files)) {
    writeFileSync(join(workspaceRoot, file.path), '{"scrubbed":true}\n');
  }
  const manifest = {
    schemaVersion: 'sciforge.runtime-codex.audit-bundle.v1',
    status: options.status ?? 'failed',
    exitCode: options.status === 'done' ? 0 : 1,
    signal: null,
    provider: 'sciforge-deepseek-proxy',
    model: 'bailian/deepseek-v4-flash',
    profile: 'sciforge-runtime-deepseek',
    workspace: workspaceRoot,
    runId: 'codex-command-audit-failed',
    commandId: 'codex-command-audit-failed',
    attemptId: 'attempt-audit-1',
    evidenceRefs: ['audit:runtime-codex:failed'],
    files,
  };
  writeFileSync(join(workspaceRoot, options.manifestRef), JSON.stringify(manifest, null, 2));
  return {
    runId: manifest.runId,
    commandId: manifest.commandId,
    provider: manifest.provider,
    model: manifest.model,
    profile: manifest.profile,
  };
}

export function withEvidenceWorkspace(run: (workspaceRoot: string) => void): void {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'sciforge-real-task-evidence-'));
  try {
    run(workspaceRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}
