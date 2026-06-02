import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildVirtualDisplayScreenPayload,
  createVirtualDisplayProviderContract,
  isVirtualDisplayReadinessControllable,
  probeVirtualDisplayProviders,
  virtualDisplayReadinessToAdapterReadiness,
  type VirtualDisplayProviderInvokeResult,
  type VirtualDisplayProviderProbeOptions,
} from '../../src/runtime/computer-use/virtual-display-provider.js';
import {
  buildVirtualAppScreenUserAcceptanceManifest,
  validateVirtualAppScreenUserAcceptanceManifest,
  type VirtualAppScreenEvidenceClaim,
  type VirtualAppScreenReadinessRecord,
  type VirtualAppScreenUserAcceptanceInput,
  type VirtualAppScreenUserAcceptanceManifest,
} from '../virtual-app-screen-user-acceptance-manifest.js';
import { VSCODE_BRIDGE_EXTENSION_JS } from './vscode-virtual-app-screen-bridge.js';

export const VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCHEMA_VERSION =
  'sciforge.computer-use.virtual-app-screen-vscode-smoke.v1' as const;

export const VIRTUAL_APP_SCREEN_VSCODE_SMOKE_TASK_ID = 'P0-CU-UA-VSCODE-MINIMAL-LOOP' as const;
export const VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCENARIO_ID = 'virtual-app-screen-vscode-minimal-loop' as const;

export type VirtualAppScreenVsCodeExecutionMode = 'probe-only' | 'provider-executed';

export interface VirtualAppScreenVsCodeExecutionEvidence {
  sessionCreated?: boolean;
  vscodeLaunched?: boolean;
  liveFrameAttached?: boolean;
  pointerInputExecuted?: boolean;
  keyboardInputExecuted?: boolean;
  beforeAfterVerified?: boolean;
  guiPresented?: boolean;
}

export interface VirtualAppScreenVsCodeAcceptanceEvidence {
  realIsolationEvidencePresent?: boolean;
  currentRunArtifactEvidencePresent?: boolean;
  currentRunGuiPresentEvidencePresent?: boolean;
  currentRunBeforeAfterEvidencePresent?: boolean;
  currentRunVerifierEvidencePresent?: boolean;
}

export interface VirtualAppScreenVsCodeProviderLifecycle {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-lifecycle.v1';
  createSession: VirtualDisplayProviderInvokeResult;
  launchApp: VirtualDisplayProviderInvokeResult;
  attachSurface: VirtualDisplayProviderInvokeResult;
  readFrame: VirtualDisplayProviderInvokeResult;
  sendInputIntent: VirtualDisplayProviderInvokeResult;
}

export interface VirtualAppScreenVsCodeEditorProfile {
  schemaVersion: 'sciforge.computer-use.virtual-app-screen-editor-profile.v1';
  profileId: 'vscode-editor-low-risk';
  profileRef: string;
  appIdentity: {
    appKind: 'vscode';
    displayName: 'VSCode';
    bundleId: 'com.microsoft.VSCode';
    executableName: 'Code';
    supportedExecutablePaths: string[];
  };
  workspaceTarget: {
    mode: 'temp-workspace';
    artifactFileName: 'sciforge-virtual-screen-note.md';
    writesOutsideWorkspace: false;
  };
  windowPlacement: {
    display: 'agent-owned-virtual-display';
    windowRole: 'main-editor-window';
    requireTargetWindowRef: true;
  };
  allowedActions: string[];
  disallowedActions: string[];
  inputIntentPolicy: {
    minimalIntentKind: 'focus-editor-temp-artifact-and-type';
    nonDestructive: true;
    requiresBeforeAfterFrameRefs: true;
    requiresExecutorAndVerifierRefs: true;
  };
  safeClosePolicy: {
    closeStrategy: 'terminate-temp-profile-only';
    preserveUserWindows: true;
    cleanupTempWorkspace: true;
  };
}

export interface VirtualAppScreenVsCodeSmokeOptions extends VirtualDisplayProviderProbeOptions {
  runId?: string;
  runDirRef?: string;
  createdAt?: string;
  executionMode?: VirtualAppScreenVsCodeExecutionMode;
  executionEvidence?: VirtualAppScreenVsCodeExecutionEvidence;
  acceptanceEvidence?: VirtualAppScreenVsCodeAcceptanceEvidence;
  executionBlockedReason?: string;
}

export interface VirtualAppScreenVsCodeNativeExecutionResult {
  executionEvidence: VirtualAppScreenVsCodeExecutionEvidence;
  executionBlockedReason?: string;
  permissionGrants: Record<string, boolean>;
  nodePackageAvailability: Record<string, boolean>;
  commandAvailability: Record<string, boolean>;
  records: Array<[string, unknown]>;
}

export interface VirtualAppScreenVsCodeSmokeBundle {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCHEMA_VERSION;
  taskId: typeof VIRTUAL_APP_SCREEN_VSCODE_SMOKE_TASK_ID;
  scenarioId: typeof VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCENARIO_ID;
  userIntent: string;
  runId: string;
  runDirRef: string;
  createdAt: string;
  executionMode: VirtualAppScreenVsCodeExecutionMode;
  providerReady: boolean;
  executionEvidenceComplete: boolean;
  userAcceptanceEvidenceComplete: boolean;
  blockedReason?: string;
  editorProfile: VirtualAppScreenVsCodeEditorProfile;
  providerProbeBundle: ReturnType<typeof probeVirtualDisplayProviders>;
  screenPayload: ReturnType<typeof buildVirtualDisplayScreenPayload>;
  adapterReadiness: VirtualAppScreenReadinessRecord;
  providerLifecycle: VirtualAppScreenVsCodeProviderLifecycle;
  records: {
    editorProfileRef: string;
    providerProbeRef: string;
    adapterReadinessRef: string;
    screenPayloadRef: string;
    providerLifecycleRef: string;
    createSessionRef: string;
    launchAppRef: string;
    attachSurfaceRef: string;
    readFrameRef: string;
    sendInputIntentRef: string;
    appLaunchRef: string;
    liveSurfaceRef: string;
    inputIntentRef: string;
    executorEventRef: string;
    beforeAfterRef: string;
    verificationRef: string;
    guiPresentRef: string;
    evidenceLedgerRef: string;
    providerExecutionRef: string;
    blockedRef: string;
  };
  manifestInput: VirtualAppScreenUserAcceptanceInput;
  manifest: VirtualAppScreenUserAcceptanceManifest;
}

const DEFAULT_RUN_ID = 'virtual-app-screen-vscode-smoke';
const DEFAULT_CREATED_AT = '2026-06-01T00:00:00.000Z';
const USER_INTENT =
  'Create an isolated agent-owned local VSCode VirtualAppScreen, attach a live frame, send pointer and keyboard InputIntent, and return before/after evidence.';
const MACOS_PROVIDER_ID = 'virtual-display.macos.cgvirtualdisplay-screencapturekit';
const MACOS_NATIVE_EXECUTION_SCHEMA =
  'sciforge.computer-use.macos-native-vscode-virtual-display-execution.v1' as const;
const VSCODE_EDITOR_PROFILE_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-editor-profile.v1' as const;
const VSCODE_EDITOR_PROFILE_ID = 'vscode-editor-low-risk' as const;
const execFileAsync = promisify(execFile);
const requireFromHere = createRequire(import.meta.url);

export function buildVirtualAppScreenVsCodeSmokeBundle(
  options: VirtualAppScreenVsCodeSmokeOptions = {},
): VirtualAppScreenVsCodeSmokeBundle {
  const runId = normalizeRunId(options.runId ?? DEFAULT_RUN_ID);
  const runDirRef = options.runDirRef ?? `.sciforge/vision-runs/${runId}`;
  const createdAt = options.createdAt ?? DEFAULT_CREATED_AT;
  const executionMode = options.executionMode ?? 'probe-only';
  const providerProbeBundle = probeVirtualDisplayProviders({
    ...options,
    targetAppKind: 'vscode',
  });
  const screenPayload = buildVirtualDisplayScreenPayload({
    runId,
    targetAppKind: 'vscode',
    targetAppName: 'VSCode',
    probeBundle: providerProbeBundle,
  });
  const selectedReadiness = providerProbeBundle.selectedReadiness;
  const providerReady = isVirtualDisplayReadinessControllable(selectedReadiness);
  const executionEvidenceComplete = providerReady
    && executionMode === 'provider-executed'
    && executionEvidenceCompleteFor(options.executionEvidence);
  const userAcceptanceEvidenceComplete = executionEvidenceComplete
    && acceptanceEvidenceCompleteFor(options.acceptanceEvidence);
  const editorProfile = buildVsCodeEditorProfile(runDirRef);
  const records = {
    editorProfileRef: editorProfile.profileRef,
    providerProbeRef: `${runDirRef}/virtual-display-provider/probe-bundle.json`,
    adapterReadinessRef: screenPayload.adapterReadinessRef,
    screenPayloadRef: `${runDirRef}/virtual-display-provider/screen-payload.json`,
    providerLifecycleRef: `${runDirRef}/virtual-display-provider/provider-lifecycle.json`,
    createSessionRef: `${runDirRef}/virtual-display-provider/lifecycle/create-session.json`,
    launchAppRef: `${runDirRef}/virtual-display-provider/lifecycle/launch-app.json`,
    attachSurfaceRef: `${runDirRef}/virtual-display-provider/lifecycle/attach-surface.json`,
    readFrameRef: `${runDirRef}/virtual-display-provider/lifecycle/read-frame.json`,
    sendInputIntentRef: `${runDirRef}/virtual-display-provider/lifecycle/send-input-intent.json`,
    appLaunchRef: `${runDirRef}/virtual-display-provider/app-launch/vscode.json`,
    liveSurfaceRef: screenPayload.liveSurfaceRef ?? `${runDirRef}/virtual-display-provider/live-surface.json`,
    inputIntentRef: screenPayload.inputIntentRefs?.[0] ?? `${runDirRef}/virtual-display-provider/input-intents/click-and-type.json`,
    executorEventRef: screenPayload.executorEventRefs?.[0] ?? `${runDirRef}/virtual-display-provider/executor-events/click-and-type.json`,
    beforeAfterRef: screenPayload.beforeAfterFrameRefs?.[0] ?? `${runDirRef}/virtual-display-provider/before-after/input.json`,
    verificationRef: screenPayload.verificationRefs?.[0] ?? `${runDirRef}/virtual-display-provider/verification/vscode-input.json`,
    guiPresentRef: screenPayload.guiPresentRefs?.[0] ?? `gui:present/${runId}/screen-pane`,
    evidenceLedgerRef: screenPayload.evidenceLedgerRef ?? `${runDirRef}/virtual-display-provider/evidence-ledger.json`,
    providerExecutionRef: `${runDirRef}/virtual-display-provider/provider-execution.json`,
    blockedRef: screenPayload.blockedRef ?? `${runDirRef}/virtual-display-provider/blocked.json`,
  };
  const adapterReadiness = selectedReadiness
    ? virtualDisplayReadinessToAdapterReadiness(selectedReadiness)
    : unavailableAdapterReadiness('No VirtualDisplayProvider profile was selected.');
  const providerLifecycle = buildVsCodeProviderLifecycle({
    runId,
    providerProbeBundle,
    blockedReason: options.executionBlockedReason ?? providerProbeBundle.blockedReason ?? selectedReadiness?.blockedReason,
  });
  const blockedReason = blockedReasonForVsCodeSmoke({
    providerReady,
    executionEvidenceComplete,
    userAcceptanceEvidenceComplete,
    providerBlockedReason: providerProbeBundle.blockedReason ?? selectedReadiness?.blockedReason,
    executionMode,
    executionEvidence: options.executionEvidence,
    executionBlockedReason: options.executionBlockedReason,
  });
  const manifestInput = manifestInputForVsCodeSmoke({
    screenPayload,
    adapterReadiness,
    providerLifecycle,
    records,
    providerReady,
    executionEvidenceComplete,
    userAcceptanceEvidenceComplete,
    executionMode,
    blockedReason,
    createdAt,
    editorProfile,
  });
  const manifest = buildVirtualAppScreenUserAcceptanceManifest(manifestInput);
  manifest.validation = validateVirtualAppScreenUserAcceptanceManifest(manifest);

  return {
    schemaVersion: VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCHEMA_VERSION,
    taskId: VIRTUAL_APP_SCREEN_VSCODE_SMOKE_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCENARIO_ID,
    userIntent: USER_INTENT,
    runId,
    runDirRef,
    createdAt,
    executionMode,
    providerReady,
    executionEvidenceComplete,
    userAcceptanceEvidenceComplete,
    blockedReason,
    editorProfile,
    providerProbeBundle,
    screenPayload: {
      ...screenPayload,
      liveSurfaceRef: executionEvidenceComplete ? records.liveSurfaceRef : screenPayload.liveSurfaceRef,
      inputIntentRefs: executionEvidenceComplete ? [records.inputIntentRef] : screenPayload.inputIntentRefs,
      executorEventRefs: executionEvidenceComplete ? [records.executorEventRef] : screenPayload.executorEventRefs,
      beforeAfterFrameRefs: executionEvidenceComplete ? [records.beforeAfterRef] : screenPayload.beforeAfterFrameRefs,
      verificationRefs: executionEvidenceComplete ? [records.verificationRef] : screenPayload.verificationRefs,
      guiPresentRefs: executionEvidenceComplete ? [records.guiPresentRef] : screenPayload.guiPresentRefs,
    },
    adapterReadiness,
    providerLifecycle,
    records,
    manifestInput,
    manifest,
  };
}

export async function writeVirtualAppScreenVsCodeSmokeBundle(
  outDir: string,
  options: VirtualAppScreenVsCodeSmokeOptions = {},
): Promise<VirtualAppScreenVsCodeSmokeBundle> {
  const providerExecution = shouldRunNativeProviderExecution(options)
    ? await executeMacosNativeVsCodeProviderSmoke(outDir, options)
    : undefined;
  const bundle = buildVirtualAppScreenVsCodeSmokeBundle({
    ...options,
    nodePackageAvailability: {
      ...(options.nodePackageAvailability ?? {}),
      ...(providerExecution?.nodePackageAvailability ?? {}),
    },
    commandAvailability: {
      ...(options.commandAvailability ?? {}),
      ...(providerExecution?.commandAvailability ?? {}),
    },
    permissionGrants: {
      ...(options.permissionGrants ?? {}),
      ...(providerExecution?.permissionGrants ?? {}),
    },
    executionEvidence: options.executionEvidence ?? providerExecution?.executionEvidence,
    executionBlockedReason: options.executionBlockedReason ?? providerExecution?.executionBlockedReason,
  });
  const records: Array<[string, unknown]> = [
    ['vscode-smoke-bundle.json', bundle],
    ['virtual-app-screen-user-acceptance-input.json', bundle.manifestInput],
    ['virtual-app-screen-user-acceptance-manifest.json', bundle.manifest],
    [bundle.records.editorProfileRef, bundle.editorProfile],
    [bundle.records.providerProbeRef, bundle.providerProbeBundle],
    [bundle.records.adapterReadinessRef, bundle.adapterReadiness],
    [bundle.records.screenPayloadRef, bundle.screenPayload],
    ...providerLifecycleRecords(bundle),
    [bundle.records.blockedRef, {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-vscode-blocked.v1',
      ref: bundle.records.blockedRef,
      blockedReason: bundle.blockedReason ?? null,
      providerReady: bundle.providerReady,
      executionEvidenceComplete: bundle.executionEvidenceComplete,
      providerExecutionRef: providerExecution ? bundle.records.providerExecutionRef : null,
    }],
    ...(providerExecution?.records ?? []),
  ];
  if (bundle.executionEvidenceComplete && !providerExecution) {
    const replayRef = bundle.screenPayload.replayRef ?? `${bundle.runDirRef}/virtual-display-provider/replay.json`;
    const artifactRef = bundle.screenPayload.artifactRefs?.[0] ?? `artifact:${bundle.runId}/vscode-virtual-screen-note.md`;
    records.push(
      [bundle.records.appLaunchRef, {
        schemaVersion: 'sciforge.computer-use.virtual-app-screen-vscode-launch.v1',
        ref: bundle.records.appLaunchRef,
        providerId: bundle.providerProbeBundle.selectedProviderId,
        backendKind: bundle.providerProbeBundle.selectedReadiness?.backendKind,
        editorProfileRef: bundle.records.editorProfileRef,
        providerLifecycleRef: bundle.records.providerLifecycleRef,
        lifecycleOperationRefs: [bundle.records.createSessionRef, bundle.records.launchAppRef],
        appIdentity: bundle.editorProfile.appIdentity,
        workspaceTarget: bundle.editorProfile.workspaceTarget,
        windowPlacement: bundle.editorProfile.windowPlacement,
        allowedActions: bundle.editorProfile.allowedActions,
        safeClosePolicy: bundle.editorProfile.safeClosePolicy,
        targetAppRef: bundle.screenPayload.targetAppRef,
        targetWindowRef: bundle.screenPayload.targetWindowRef,
        sessionRef: bundle.screenPayload.sessionRef,
        createSessionRef: bundle.records.createSessionRef,
        launchAppRef: bundle.records.launchAppRef,
        providerCreatedSession: true,
        launchedInAgentOwnedSurface: true,
      }],
      [bundle.records.liveSurfaceRef, {
        schemaVersion: 'sciforge.computer-use.virtual-app-screen-live-surface.v1',
        ref: bundle.records.liveSurfaceRef,
        sessionRef: bundle.screenPayload.sessionRef,
        frameStreamRef: bundle.screenPayload.frameStreamRef,
        currentFrameRef: bundle.screenPayload.currentFrameRef,
        attachSurfaceRef: bundle.records.attachSurfaceRef,
        readFrameRef: bundle.records.readFrameRef,
        transport: bundle.screenPayload.surfaceTransport ?? bundle.providerProbeBundle.selectedReadiness?.selectedTransport ?? 'webrtc',
        singleInteractiveTruth: true,
      }],
      [bundle.screenPayload.beforeFrameRef ?? `${bundle.runDirRef}/virtual-display-provider/frames/before.json`, {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        ref: bundle.screenPayload.beforeFrameRef,
        role: 'before',
      }],
      [bundle.screenPayload.afterFrameRef ?? `${bundle.runDirRef}/virtual-display-provider/frames/after.json`, {
        schemaVersion: 'sciforge.computer-use.screen-frame.v1',
        ref: bundle.screenPayload.afterFrameRef,
        role: 'after',
      }],
      [bundle.records.inputIntentRef, {
        schemaVersion: 'sciforge.computer-use.input-intent.v1',
        ref: bundle.records.inputIntentRef,
        kind: bundle.editorProfile.inputIntentPolicy.minimalIntentKind,
        inputKind: bundle.editorProfile.inputIntentPolicy.minimalIntentKind,
        nonDestructive: true,
        editorProfileRef: bundle.records.editorProfileRef,
        targetAppRef: bundle.screenPayload.targetAppRef,
        targetWindowRef: bundle.screenPayload.targetWindowRef,
        inputLeaseRef: bundle.screenPayload.inputLeaseRef,
        actionAdapterRef: bundle.screenPayload.actionAdapterRef,
        sendInputIntentRef: bundle.records.sendInputIntentRef,
        beforeFrameRef: bundle.screenPayload.beforeFrameRef,
        afterFrameRef: bundle.screenPayload.afterFrameRef,
        beforeAfterFrameRefs: [bundle.records.beforeAfterRef],
        executorEventRef: bundle.records.executorEventRef,
        verificationRefs: [bundle.records.verificationRef],
      }],
      [bundle.records.executorEventRef, {
        schemaVersion: 'sciforge.computer-use.executor-event.v1',
        ref: bundle.records.executorEventRef,
        status: 'completed',
        inputIntentRef: bundle.records.inputIntentRef,
        providerLifecycleRef: bundle.records.providerLifecycleRef,
        sendInputIntentRef: bundle.records.sendInputIntentRef,
        beforeFrameRef: bundle.screenPayload.beforeFrameRef,
        afterFrameRef: bundle.screenPayload.afterFrameRef,
        affectsPhysicalDisplay: false,
        requiresFocusSteal: false,
        sharedSystemInputUsed: false,
      }],
      [bundle.records.beforeAfterRef, {
        schemaVersion: 'sciforge.computer-use.before-after-frame.v1',
        ref: bundle.records.beforeAfterRef,
        beforeFrameRef: bundle.screenPayload.beforeFrameRef,
        afterFrameRef: bundle.screenPayload.afterFrameRef,
        inputIntentRef: bundle.records.inputIntentRef,
        executorEventRef: bundle.records.executorEventRef,
      }],
      [bundle.records.verificationRef, {
        schemaVersion: 'sciforge.computer-use.verification.v1',
        ref: bundle.records.verificationRef,
        ok: true,
        checkedRefs: [bundle.records.beforeAfterRef, bundle.records.executorEventRef],
      }],
      [bundle.records.guiPresentRef, {
        schemaVersion: 'sciforge.computer-use.gui-present.v1',
        ref: bundle.records.guiPresentRef,
        surface: 'virtual-screen-viewer',
        screenPayloadRef: bundle.records.screenPayloadRef,
        liveSurfaceRef: bundle.records.liveSurfaceRef,
        displayedRefs: [bundle.screenPayload.afterFrameRef, bundle.records.beforeAfterRef, artifactRef, replayRef],
      }],
      [artifactRef, {
        schemaVersion: 'sciforge.computer-use.virtual-app-screen-artifact.v1',
        ref: artifactRef,
        source: 'virtual-app-screen-provider-executed-evidence',
        causalityRefs: [bundle.records.inputIntentRef, bundle.records.executorEventRef, bundle.records.beforeAfterRef],
        currentRunOnly: true,
      }],
      [replayRef, {
        schemaVersion: 'sciforge.computer-use.virtual-app-screen-replay.v1',
        ref: replayRef,
        sessionRef: bundle.screenPayload.sessionRef,
        timelineRefs: [
          bundle.screenPayload.beforeFrameRef,
          bundle.records.sendInputIntentRef,
          bundle.records.inputIntentRef,
          bundle.records.executorEventRef,
          bundle.records.beforeAfterRef,
          bundle.screenPayload.afterFrameRef,
          artifactRef,
          bundle.records.guiPresentRef,
        ].filter(Boolean),
        currentRunOnly: true,
      }],
      [bundle.records.evidenceLedgerRef, {
        schemaVersion: 'sciforge.computer-use.evidence-ledger.v1',
        ref: bundle.records.evidenceLedgerRef,
        currentRunOnly: true,
        refs: [
          bundle.records.appLaunchRef,
          bundle.records.providerLifecycleRef,
          bundle.records.createSessionRef,
          bundle.records.launchAppRef,
          bundle.records.attachSurfaceRef,
          bundle.records.readFrameRef,
          bundle.records.sendInputIntentRef,
          bundle.records.liveSurfaceRef,
          bundle.records.inputIntentRef,
          bundle.records.executorEventRef,
          bundle.records.beforeAfterRef,
          bundle.records.verificationRef,
          bundle.records.guiPresentRef,
          artifactRef,
          replayRef,
        ],
      }],
    );
  }

  await mkdir(resolve(outDir), { recursive: true });
  for (const [ref, data] of records) {
    await writeJsonRef(outDir, bundle.runDirRef, ref, data);
  }
  return bundle;
}

function shouldRunNativeProviderExecution(options: VirtualAppScreenVsCodeSmokeOptions) {
  return (options.executionMode ?? 'probe-only') === 'provider-executed'
    && !executionEvidenceCompleteFor(options.executionEvidence);
}

function buildVsCodeProviderLifecycle(options: {
  runId: string;
  providerProbeBundle: ReturnType<typeof probeVirtualDisplayProviders>;
  blockedReason?: string;
}): VirtualAppScreenVsCodeProviderLifecycle {
  const contract = createVirtualDisplayProviderContract({
    runId: options.runId,
    targetAppKind: 'vscode',
    targetAppName: 'VSCode',
    probeBundle: options.providerProbeBundle,
    blockedReason: options.blockedReason,
  });
  const operationOptions = {
    runId: options.runId,
    targetAppKind: 'vscode',
    targetAppName: 'VSCode',
    probeBundle: options.providerProbeBundle,
    blockedReason: options.blockedReason,
  };
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-lifecycle.v1',
    createSession: contract.createSession(operationOptions),
    launchApp: contract.launchApp(operationOptions),
    attachSurface: contract.attachSurface(operationOptions),
    readFrame: contract.readFrame(operationOptions),
    sendInputIntent: contract.sendInputIntent(operationOptions),
  };
}

function providerLifecycleRecords(
  bundle: Pick<VirtualAppScreenVsCodeSmokeBundle, 'runId' | 'executionMode' | 'providerReady' | 'executionEvidenceComplete' | 'providerProbeBundle' | 'providerLifecycle' | 'records'>,
): Array<[string, unknown]> {
  const operationRefs = {
    createSession: bundle.records.createSessionRef,
    launchApp: bundle.records.launchAppRef,
    attachSurface: bundle.records.attachSurfaceRef,
    readFrame: bundle.records.readFrameRef,
    sendInputIntent: bundle.records.sendInputIntentRef,
  };
  const operations = (Object.keys(operationRefs) as Array<keyof typeof operationRefs>).map((operation) => ({
    operation,
    ref: operationRefs[operation],
    invokeResult: bundle.providerLifecycle[operation],
  }));
  return [
    [bundle.records.providerLifecycleRef, {
      schemaVersion: bundle.providerLifecycle.schemaVersion,
      ref: bundle.records.providerLifecycleRef,
      runId: bundle.runId,
      providerId: bundle.providerProbeBundle.selectedProviderId,
      executionMode: bundle.executionMode,
      providerReady: bundle.providerReady,
      providerExecuted: operations.every((operation) => operation.invokeResult.providerExecuted === true),
      currentRunOnly: bundle.executionEvidenceComplete,
      operationRefs,
      chain: operations.map((operation) => operation.ref),
    }],
    ...operations.map((operation): [string, unknown] => [operation.ref, {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-lifecycle-operation.v1',
      ref: operation.ref,
      runId: bundle.runId,
      operation: operation.operation,
      providerId: operation.invokeResult.providerId,
      status: operation.invokeResult.status,
      refs: operation.invokeResult.refs,
      blockedReason: operation.invokeResult.blockedReason ?? null,
      providerExecuted: operation.invokeResult.providerExecuted,
      mutatingActionExecuted: operation.invokeResult.mutatingActionExecuted,
      rawPayloadWritten: operation.invokeResult.rawPayloadWritten,
      currentRunOnly: bundle.executionEvidenceComplete,
    }]),
  ];
}

async function createVsCodeBridgeExtension(workspaceDir: string): Promise<VsCodeBridgePaths> {
  const extensionDir = join(workspaceDir, '.sciforge-vscode-bridge-extension');
  const bridgeDataDir = join(workspaceDir, '.sciforge-vscode-bridge');
  const requestPath = join(bridgeDataDir, 'request.json');
  const resultPath = join(bridgeDataDir, 'result.json');
  const workspaceArtifactPath = join(workspaceDir, 'sciforge-virtual-screen-note.md');
  await mkdir(extensionDir, { recursive: true });
  await mkdir(bridgeDataDir, { recursive: true });
  await writeFile(join(extensionDir, 'package.json'), `${JSON.stringify({
    name: 'sciforge-vscode-virtual-app-screen-bridge',
    displayName: 'SciForge VSCode VirtualAppScreen Bridge',
    version: '0.0.1',
    publisher: 'sciforge',
    engines: { vscode: '^1.80.0' },
    activationEvents: ['*'],
    main: './extension.js',
    contributes: {},
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(extensionDir, 'extension.js'), VSCODE_BRIDGE_EXTENSION_JS, 'utf8');
  await writeFile(resultPath, `${JSON.stringify({
    schemaVersion: 'sciforge.vscode.bridge.result.v1',
    status: 'waiting-for-extension-activation',
    ok: false,
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');
  return { extensionDir, bridgeDataDir, requestPath, resultPath, workspaceArtifactPath };
}

async function writeVsCodeIsolatedUserSettings(userDataDir: string): Promise<string> {
  const settingsDir = join(userDataDir, 'User');
  const settingsPath = join(settingsDir, 'settings.json');
  await mkdir(settingsDir, { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify({
    'workbench.startupEditor': 'none',
    'workbench.welcome.enabled': false,
    'workbench.welcomePage.experimentalOnboarding': false,
    'workbench.welcomePage.walkthroughs.openOnInstall': false,
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
    'extensions.ignoreRecommendations': true,
    'update.mode': 'none',
    'chat.commandCenter.enabled': false,
    'github.copilot.chat.agent.enabled': false,
  }, null, 2)}\n`, 'utf8');
  return settingsPath;
}

export async function executeMacosNativeVsCodeProviderSmoke(
  outDir: string,
  options: VirtualAppScreenVsCodeSmokeOptions = {},
): Promise<VirtualAppScreenVsCodeNativeExecutionResult> {
  const runId = normalizeRunId(options.runId ?? DEFAULT_RUN_ID);
  const runDirRef = options.runDirRef ?? `.sciforge/vision-runs/${runId}`;
  const providerExecutionRef = `${runDirRef}/virtual-display-provider/provider-execution.json`;
  const startedAt = new Date().toISOString();
  const platform = options.platform ?? process.platform;
  const nodePackageAvailability: Record<string, boolean> = {};
  const commandAvailability: Record<string, boolean> = {};
  const permissionGrants: Record<string, boolean> = {
    ...(options.permissionGrants ?? {}),
  };
  const executionEvidence: VirtualAppScreenVsCodeExecutionEvidence = {
    sessionCreated: false,
    vscodeLaunched: false,
    liveFrameAttached: false,
    pointerInputExecuted: false,
    keyboardInputExecuted: false,
    beforeAfterVerified: false,
    guiPresented: false,
  };
  const executionRecords: Array<[string, unknown]> = [];
  const record: Record<string, unknown> = {
    schemaVersion: MACOS_NATIVE_EXECUTION_SCHEMA,
    ref: providerExecutionRef,
    runId,
    providerId: MACOS_PROVIDER_ID,
    backendKind: 'node-mac-virtual-display+screencapture',
    platform: String(platform),
    status: 'running',
    startedAt,
    finishedAt: null,
    executionEvidence,
    permissionFindings: {},
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      singleInteractiveTruth: true,
    },
    actions: [],
  };

  const finish = (blockedReason?: string): VirtualAppScreenVsCodeNativeExecutionResult => {
    record.status = executionEvidenceCompleteFor(executionEvidence) ? 'completed' : 'blocked';
    record.blockedReason = blockedReason ?? null;
    record.finishedAt = new Date().toISOString();
    record.executionEvidence = { ...executionEvidence };
    return {
      executionEvidence: { ...executionEvidence },
      executionBlockedReason: blockedReason,
      permissionGrants,
      nodePackageAvailability,
      commandAvailability,
      records: [[providerExecutionRef, record], ...executionRecords],
    };
  };

  if (platform !== 'darwin') {
    return finish(`Native VSCode VirtualAppScreen execution currently requires macOS; host platform is ${String(platform)}.`);
  }

  const injectedPackageAvailability = options.nodePackageAvailability?.['node-mac-virtual-display'];
  if (injectedPackageAvailability === false) {
    nodePackageAvailability['node-mac-virtual-display'] = false;
    return finish('node-mac-virtual-display is not installed; local native virtual display execution is blocked.');
  }

  let VirtualDisplay: new () => {
    createVirtualDisplay(options: {
      width: number;
      height: number;
      frameRate?: number;
      hiDPI?: boolean;
      displayName?: string;
      ppi?: number;
      mirror?: boolean;
    }): { id: number; width: number; height: number };
    destroyVirtualDisplay(): boolean;
  };
  try {
    VirtualDisplay = requireFromHere('node-mac-virtual-display');
    nodePackageAvailability['node-mac-virtual-display'] = true;
  } catch (error) {
    nodePackageAvailability['node-mac-virtual-display'] = false;
    record.loadError = shortError(error);
    return finish('node-mac-virtual-display failed to load; local native virtual display execution is blocked.');
  }

  if (!commandExists('screencapture', options)) {
    commandAvailability.screencapture = false;
    return finish('macOS screencapture is unavailable; live frame evidence cannot be produced.');
  }
  if (!commandExists('swift', options)) {
    commandAvailability.swift = false;
    return finish('Swift/CoreGraphics display inventory is unavailable; virtual display identity cannot be proven.');
  }
  if (!commandExists('swiftc', options)) {
    commandAvailability.swiftc = false;
    return finish('Swift compiler is unavailable; macOS Accessibility provider adapters cannot be materialized.');
  }
  commandAvailability.screencapture = true;
  commandAvailability.swift = true;
  commandAvailability.swiftc = true;

  const accessibilityProbe = probeMacosAccessibility();
  if (accessibilityProbe.ok) {
    permissionGrants['permission:macos/accessibility'] = true;
  }
  record.permissionFindings = {
    screenRecordingGranted: false,
    accessibilityProbeSucceeded: accessibilityProbe.ok,
    accessibilityGrantClaimed: accessibilityProbe.ok,
    accessibilityDetail: accessibilityProbe.ok ? undefined : accessibilityProbe.detail,
  };

  const displayName = `SciForge VAS ${runId.slice(0, 48)}`;
  const displayWidth = 1024;
  const displayHeight = 768;
  const display = new VirtualDisplay();
  let displayDestroyed = false;
  let userDataDir: string | undefined;
  const tempDirs: string[] = [];
  try {
    const displayInfo = display.createVirtualDisplay({
      width: displayWidth,
      height: displayHeight,
      frameRate: 30,
      hiDPI: false,
      displayName,
      mirror: false,
    });
    executionEvidence.sessionCreated = true;
    record.displayCreate = {
      status: 'completed',
      displayInfo,
      displayName,
      requestedSize: { width: displayWidth, height: displayHeight },
    };
    await sleep(1200);

    const displays = listMacosDisplays();
    record.displayInventoryAfterCreate = displays;
    const virtualDisplay = displays.find((entry) => entry.id === displayInfo.id)
      ?? displays.find((entry) => entry.width === displayInfo.width && entry.height === displayInfo.height && !entry.main);
    if (!virtualDisplay) {
      return finish('created virtual display was not visible in the current CoreGraphics online display inventory.');
    }
    record.displayIdentity = virtualDisplay;

    const preLaunchFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'pre-launch', virtualDisplay);
    record.preLaunchFrame = preLaunchFrame.frameRecord;
    record.preLaunchFrameRef = preLaunchFrame.frameRef;
    record.preLaunchScreenshotRef = preLaunchFrame.screenshotRef;
    executionRecords.push([preLaunchFrame.frameRef, preLaunchFrame.frameRecord]);
    executionEvidence.liveFrameAttached = true;
    permissionGrants['permission:macos/screen-recording'] = true;
    record.permissionFindings = {
      ...(record.permissionFindings as Record<string, unknown>),
      screenRecordingGranted: true,
    };

    const appPath = '/Applications/Visual Studio Code.app';
    const appExecutablePath = `${appPath}/Contents/MacOS/Code`;
    const codeCliPath = `${appPath}/Contents/Resources/app/bin/code`;
    if (!existsSync(appPath) || !existsSync(appExecutablePath) || !existsSync(codeCliPath)) {
      return finish('VSCode.app is not installed at /Applications/Visual Studio Code.app.');
    }
    const vscodeTempRoot = '/tmp';
    userDataDir = await mkdtemp(join(vscodeTempRoot, `sciforge-vscode-${runId}-user-`));
    const extensionsDir = await mkdtemp(join(vscodeTempRoot, `sciforge-vscode-${runId}-ext-`));
    const workspaceDir = await mkdtemp(join(vscodeTempRoot, `sciforge-vscode-${runId}-workspace-`));
    const bridgePaths = await createVsCodeBridgeExtension(workspaceDir);
    const userSettingsPath = await writeVsCodeIsolatedUserSettings(userDataDir);
    tempDirs.push(userDataDir, extensionsDir, workspaceDir);
    record.appLaunch = {
      status: 'started',
      appPath,
      appExecutablePath,
      codeCliPath,
      userDataDir,
      userSettingsPath,
      extensionsDir,
      workspaceDir,
      bridgeExtensionDir: bridgePaths.extensionDir,
      bridgeRequestPath: bridgePaths.requestPath,
      bridgeResultPath: bridgePaths.resultPath,
      launchKind: 'launchservices-background-native-app',
    };
    await execFileAsync('open', [
      '-g',
      '-na',
      appPath,
      '--args',
      '--user-data-dir',
      userDataDir,
      '--extensions-dir',
      extensionsDir,
      '--disable-workspace-trust',
      '--skip-welcome',
      '--extensionDevelopmentPath',
      bridgePaths.extensionDir,
      '--new-window',
      workspaceDir,
    ], { timeout: 10000 });
    const launchedPids = await waitForCodePidsForUserDataDir(userDataDir, 20000);
    executionEvidence.vscodeLaunched = launchedPids.length > 0;
    record.appLaunch = {
      ...(record.appLaunch as Record<string, unknown>),
      status: launchedPids.length ? 'completed' : 'blocked',
      launchedPids,
    };
    executionRecords.push([`${runDirRef}/virtual-display-provider/app-launch/vscode.json`, record.appLaunch]);
    if (!launchedPids.length) {
      const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
      record.afterFrame = afterFrame.frameRecord;
      record.afterFrameRef = afterFrame.frameRef;
      record.afterScreenshotRef = afterFrame.screenshotRef;
      executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
      return finish('VSCode app launch did not yield a running isolated Code process for the temp profile.');
    }

    const cgWindowBinding = await waitForMacosCgWindowForUserDataDir(userDataDir, launchedPids, 20000);
    const cgWindow = cgWindowBinding.window;
    record.cgWindowBinding = {
      status: cgWindow ? 'observed' : 'blocked',
      matchingPids: cgWindowBinding.pids,
      window: cgWindow,
    };
    if (!cgWindow) {
      const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
      record.afterFrame = afterFrame.frameRecord;
      record.afterFrameRef = afterFrame.frameRef;
      record.afterScreenshotRef = afterFrame.screenshotRef;
      executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
      return finish('VSCode launched, but CoreGraphics did not expose an on-screen target window for the isolated profile.');
    }
    if (!accessibilityProbe.ok) {
      const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
      record.afterFrame = afterFrame.frameRecord;
      record.afterFrameRef = afterFrame.frameRef;
      record.afterScreenshotRef = afterFrame.screenshotRef;
      executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
      return finish('macOS Accessibility is unavailable to the provider process; VSCode window binding is blocked.');
    }

    let windows: MacosCodeWindowInventoryEntry[] = [];
    try {
      windows = await waitForMacosAxWindows([cgWindow.pid], 15000);
    } catch (error) {
      record.axWindowInventory = {
        matchingPids: [cgWindow.pid],
        windows: [],
        error: shortError(error),
      };
      const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
      record.afterFrame = afterFrame.frameRecord;
      record.afterFrameRef = afterFrame.frameRef;
      record.afterScreenshotRef = afterFrame.screenshotRef;
      executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
      return finish(`VSCode AX window inventory failed: ${shortError(error)}`);
    }
    record.axWindowInventory = {
      matchingPids: [cgWindow.pid],
      windows,
    };
    const targetWindows = windows.filter((window) => window.pid === cgWindow.pid);
    const targetWindow = targetWindows.length === 1 ? targetWindows[0] : undefined;
    if (!targetWindow) {
      const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
      record.afterFrame = afterFrame.frameRecord;
      record.afterFrameRef = afterFrame.frameRef;
      record.afterScreenshotRef = afterFrame.screenshotRef;
      executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
      return finish('VSCode launched, but no unique AX window could be bound to the CoreGraphics target window.');
    }

    const moveResult = moveMacosCodeWindow(targetWindow, virtualDisplay);
    await sleep(1200);
    const movedCgWindow = inventoryMacosCgWindows([cgWindow.pid])
      .find((window) => window.windowNumber === cgWindow.windowNumber)
      ?? inventoryMacosCgWindows([cgWindow.pid])[0];
    const movedInsideVirtualDisplay = movedCgWindow
      ? windowWithinDisplay(movedCgWindow, virtualDisplay)
      : false;
    record.windowBinding = {
      status: moveResult.ok && movedInsideVirtualDisplay ? 'completed' : 'blocked',
      targetWindow,
      cgWindow,
      movedCgWindow,
      movedInsideVirtualDisplay,
      moveResult,
      virtualDisplay,
    };
    if (!moveResult.ok || !movedInsideVirtualDisplay) {
      const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
      record.afterFrame = afterFrame.frameRecord;
      record.afterFrameRef = afterFrame.frameRef;
      record.afterScreenshotRef = afterFrame.screenshotRef;
      executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
      return finish('VSCode AX window was discovered, but moving it onto the virtual display could not be verified by CoreGraphics bounds.');
    }

    const editorProfile = buildVsCodeEditorProfile(runDirRef);
    executionRecords.push([editorProfile.profileRef, editorProfile]);
    const inputBeforeFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'before', virtualDisplay);
    record.beforeFrame = inputBeforeFrame.frameRecord;
    record.beforeFrameRef = inputBeforeFrame.frameRef;
    record.beforeScreenshotRef = inputBeforeFrame.screenshotRef;
    executionRecords.push([inputBeforeFrame.frameRef, inputBeforeFrame.frameRecord]);
    const inputExecution = await executeMacosVsCodeInputIntents({
      runId,
      runDirRef,
      targetWindow,
      userDataDir,
      extensionsDir,
      workspaceDir,
      bridgePaths,
      editorProfile,
      text: `SciForge isolated keyboard InputIntent ${runId}`,
    });
    record.inputExecution = inputExecution.summary;
    executionRecords.push(...inputExecution.records);
    executionEvidence.pointerInputExecuted = inputExecution.pointerInputExecuted;
    executionEvidence.keyboardInputExecuted = inputExecution.keyboardInputExecuted;
    await sleep(1800);
    const afterFrame = await captureMacosDisplayFrame(outDir, runDirRef, 'after', virtualDisplay);
    record.afterFrame = afterFrame.frameRecord;
    record.afterFrameRef = afterFrame.frameRef;
    record.afterScreenshotRef = afterFrame.screenshotRef;
    executionRecords.push([afterFrame.frameRef, afterFrame.frameRecord]);
    const beforeHash = stringField(inputBeforeFrame.frameRecord.screenshotSha256);
    const afterHash = stringField(afterFrame.frameRecord.screenshotSha256);
    const beforeAfterVerified = Boolean(beforeHash && afterHash && beforeHash !== afterHash && inputExecution.pointerInputExecuted && inputExecution.keyboardInputExecuted);
    executionEvidence.beforeAfterVerified = beforeAfterVerified;
    executionEvidence.guiPresented = beforeAfterVerified;
    executionRecords.push(...virtualAppScreenCompletionRecords({
      runId,
      runDirRef,
      screenPayloadRefs: {
        targetAppRef: `app:${runId}/vscode`,
        targetWindowRef: `window:${runId}/vscode/main`,
        sessionRef: `computer-use:session/${runId}/virtual-display-session.json`,
        frameStreamRef: `${runDirRef}/virtual-display-provider/frame-stream.json`,
        inputLeaseRef: `${runDirRef}/virtual-display-provider/input-lease.json`,
        actionAdapterRef: `${runDirRef}/virtual-display-provider/action-adapter.json`,
        adapterReadinessRef: `${runDirRef}/virtual-display-provider/adapter-readiness.json`,
      },
      beforeFrameRef: inputBeforeFrame.frameRef,
      afterFrameRef: afterFrame.frameRef,
      beforeHash,
      afterHash,
      inputExecution,
      ok: beforeAfterVerified,
    }));
    if (!beforeAfterVerified) {
      return finish(inputExecution.blockedReason ?? 'VSCode isolated InputIntent execution did not produce verifiable before/after frame evidence.');
    }
    return finish();
  } catch (error) {
    record.executionError = shortError(error);
    return finish(`macOS native VSCode VirtualAppScreen execution failed: ${shortError(error)}`);
  } finally {
    if (userDataDir) {
      await killCodeProcessesForUserDataDir(userDataDir);
    }
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => undefined)));
    try {
      displayDestroyed = display.destroyVirtualDisplay();
    } catch (error) {
      record.displayDestroyError = shortError(error);
    }
    record.displayDestroyed = displayDestroyed;
  }
}

function manifestInputForVsCodeSmoke(options: {
  screenPayload: ReturnType<typeof buildVirtualDisplayScreenPayload>;
  adapterReadiness: VirtualAppScreenReadinessRecord;
  providerLifecycle: VirtualAppScreenVsCodeProviderLifecycle;
  records: VirtualAppScreenVsCodeSmokeBundle['records'];
  providerReady: boolean;
  executionEvidenceComplete: boolean;
  userAcceptanceEvidenceComplete: boolean;
  executionMode: VirtualAppScreenVsCodeExecutionMode;
  blockedReason?: string;
  createdAt: string;
  editorProfile: VirtualAppScreenVsCodeEditorProfile;
}): VirtualAppScreenUserAcceptanceInput {
  const evidenceClaims: VirtualAppScreenEvidenceClaim[] = options.executionEvidenceComplete
    ? [{
        id: 'vscode-real-virtual-app-screen',
        kind: 'real-virtual-app-screen',
        status: options.userAcceptanceEvidenceComplete ? 'present' : 'diagnostic-only',
        ref: options.records.liveSurfaceRef,
        evidenceRefs: [
          options.records.editorProfileRef,
          options.records.providerLifecycleRef,
          options.records.createSessionRef,
          options.records.launchAppRef,
          options.records.attachSurfaceRef,
          options.records.readFrameRef,
          options.records.sendInputIntentRef,
          options.records.appLaunchRef,
          options.records.liveSurfaceRef,
          options.records.inputIntentRef,
          options.records.executorEventRef,
          options.records.beforeAfterRef,
          options.records.verificationRef,
          options.records.guiPresentRef,
        ],
        userAcceptanceEligible: options.userAcceptanceEvidenceComplete,
        note: options.userAcceptanceEvidenceComplete
          ? undefined
          : 'Provider-executed VSCode/editor loop evidence is present, but user acceptance remains disabled until real isolation, artifact, gui.present, current-run before/after, and verifier evidence are all proven by the product path.',
      }]
    : [{
        id: 'vscode-provider-probe-boundary',
        kind: 'adapter-readiness',
        status: options.providerReady ? 'blocked' : 'diagnostic-only',
        ref: options.records.providerProbeRef,
        evidenceRefs: options.executionMode === 'provider-executed'
          ? [
              options.records.providerProbeRef,
              options.records.adapterReadinessRef,
              options.records.providerLifecycleRef,
              options.records.providerExecutionRef,
              options.records.blockedRef,
            ]
          : [options.records.providerProbeRef, options.records.adapterReadinessRef, options.records.providerLifecycleRef, options.records.blockedRef],
        userAcceptanceEligible: false,
        note: options.blockedReason,
      }];
  return {
    taskId: VIRTUAL_APP_SCREEN_VSCODE_SMOKE_TASK_ID,
    scenarioId: VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCENARIO_ID,
    userIntent: USER_INTENT,
    targetAppRefs: [options.screenPayload.targetAppRef],
    targetWindowRefs: refArray(options.screenPayload.targetWindowRef),
    sessionRefs: refArray(options.screenPayload.sessionRef),
    adapterReadinessRefs: [options.records.adapterReadinessRef],
    adapterReadinessRecords: [options.adapterReadiness],
    screenFrameRefs: options.executionEvidenceComplete ? refArray(options.screenPayload.beforeFrameRef, options.screenPayload.afterFrameRef) : [],
    inputIntentRefs: options.executionEvidenceComplete ? [options.records.inputIntentRef] : [],
    executorEventRefs: options.executionEvidenceComplete ? [options.records.executorEventRef] : [],
    beforeAfterFrameRefs: options.executionEvidenceComplete ? [options.records.beforeAfterRef] : [],
    annotationProposalRefs: options.executionEvidenceComplete ? [`${options.records.beforeAfterRef}#vscode-input-proposal`] : [],
    artifactRefs: options.executionEvidenceComplete ? [`artifact:${options.screenPayload.targetAppRef.replace(/^app:/, '')}/vscode-virtual-screen-note.md`] : [],
    verificationRefs: options.executionEvidenceComplete ? [options.records.verificationRef] : [],
    guiPresentRefs: options.executionEvidenceComplete ? [options.records.guiPresentRef] : [],
    replayRef: options.executionEvidenceComplete ? options.screenPayload.replayRef : undefined,
    evidenceLedgerRef: options.executionEvidenceComplete ? options.records.evidenceLedgerRef : undefined,
    isolationFlags: {
      backgroundRenderable: options.providerReady,
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      physicalDisplayPopup: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      diagnosticOnly: !options.userAcceptanceEvidenceComplete,
    },
    evidenceClaims,
    blockedReason: options.blockedReason,
    createdAt: options.createdAt,
    metadata: {
      vscodeSmokeSchemaVersion: VIRTUAL_APP_SCREEN_VSCODE_SMOKE_SCHEMA_VERSION,
      editorProfileId: options.editorProfile.profileId,
      editorProfileRef: options.records.editorProfileRef,
      providerLifecycleRef: options.records.providerLifecycleRef,
      providerLifecycleSchemaVersion: options.providerLifecycle.schemaVersion,
      providerLifecycleOperationRefs: [
        options.records.createSessionRef,
        options.records.launchAppRef,
        options.records.attachSurfaceRef,
        options.records.readFrameRef,
        options.records.sendInputIntentRef,
      ],
      appIdentity: options.editorProfile.appIdentity,
      workspaceTarget: options.editorProfile.workspaceTarget,
      windowPlacement: options.editorProfile.windowPlacement,
      allowedActions: options.editorProfile.allowedActions,
      safeClosePolicy: options.editorProfile.safeClosePolicy,
      providerProbeRef: options.records.providerProbeRef,
      screenPayloadRef: options.records.screenPayloadRef,
      providerExecutionRef: options.executionMode === 'provider-executed' ? options.records.providerExecutionRef : undefined,
      blockedRef: options.userAcceptanceEvidenceComplete ? undefined : options.records.blockedRef,
    },
  };
}

function blockedReasonForVsCodeSmoke(options: {
  providerReady: boolean;
  executionEvidenceComplete: boolean;
  userAcceptanceEvidenceComplete: boolean;
  providerBlockedReason?: string;
  executionMode: VirtualAppScreenVsCodeExecutionMode;
  executionEvidence?: VirtualAppScreenVsCodeExecutionEvidence;
  executionBlockedReason?: string;
}) {
  if (options.executionEvidenceComplete && options.userAcceptanceEvidenceComplete) return undefined;
  if (options.executionEvidenceComplete) {
    return 'VSCode provider-created closed-loop evidence is present, but user acceptance is disabled until real isolation, current-run artifact, gui.present, before/after, and verifier evidence are all present.';
  }
  if (!options.providerReady) {
    return options.providerBlockedReason
      ?? 'No isolated VirtualDisplayProvider is ready for VSCode.';
  }
  if (options.executionBlockedReason) return options.executionBlockedReason;
  if (options.executionMode !== 'provider-executed') {
    return 'VirtualDisplayProvider readiness is available, but this smoke is probe-only and has not launched VSCode or executed InputIntent.';
  }
  const missing = Object.entries({
    sessionCreated: options.executionEvidence?.sessionCreated,
    vscodeLaunched: options.executionEvidence?.vscodeLaunched,
    liveFrameAttached: options.executionEvidence?.liveFrameAttached,
    pointerInputExecuted: options.executionEvidence?.pointerInputExecuted,
    keyboardInputExecuted: options.executionEvidence?.keyboardInputExecuted,
    beforeAfterVerified: options.executionEvidence?.beforeAfterVerified,
    guiPresented: options.executionEvidence?.guiPresented,
  }).filter(([, ok]) => ok !== true).map(([key]) => key);
  return `VSCode provider-executed smoke is missing current evidence: ${missing.join(', ')}.`;
}

function executionEvidenceCompleteFor(evidence: VirtualAppScreenVsCodeExecutionEvidence | undefined) {
  return Boolean(
    evidence?.sessionCreated
    && evidence.vscodeLaunched
    && evidence.liveFrameAttached
    && evidence.pointerInputExecuted
    && evidence.keyboardInputExecuted
    && evidence.beforeAfterVerified
    && evidence.guiPresented,
  );
}

function acceptanceEvidenceCompleteFor(evidence: VirtualAppScreenVsCodeAcceptanceEvidence | undefined) {
  return Boolean(
    evidence?.realIsolationEvidencePresent
    && evidence.currentRunArtifactEvidencePresent
    && evidence.currentRunGuiPresentEvidencePresent
    && evidence.currentRunBeforeAfterEvidencePresent
    && evidence.currentRunVerifierEvidencePresent,
  );
}

function buildVsCodeEditorProfile(runDirRef: string): VirtualAppScreenVsCodeEditorProfile {
  return {
    schemaVersion: VSCODE_EDITOR_PROFILE_SCHEMA,
    profileId: VSCODE_EDITOR_PROFILE_ID,
    profileRef: `${runDirRef}/app-profiles/${VSCODE_EDITOR_PROFILE_ID}.json`,
    appIdentity: {
      appKind: 'vscode',
      displayName: 'VSCode',
      bundleId: 'com.microsoft.VSCode',
      executableName: 'Code',
      supportedExecutablePaths: [
        '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      ],
    },
    workspaceTarget: {
      mode: 'temp-workspace',
      artifactFileName: 'sciforge-virtual-screen-note.md',
      writesOutsideWorkspace: false,
    },
    windowPlacement: {
      display: 'agent-owned-virtual-display',
      windowRole: 'main-editor-window',
      requireTargetWindowRef: true,
    },
    allowedActions: [
      'focus-editor',
      'open-temp-workspace-artifact',
      'type_text',
      'undo',
      'save-temp-workspace-artifact',
    ],
    disallowedActions: [
      'open-user-workspace-file',
      'modify-user-workspace-file',
      'install-extension',
      'run-terminal-command',
      'send-shared-system-input',
      'move-physical-pointer',
    ],
    inputIntentPolicy: {
      minimalIntentKind: 'focus-editor-temp-artifact-and-type',
      nonDestructive: true,
      requiresBeforeAfterFrameRefs: true,
      requiresExecutorAndVerifierRefs: true,
    },
    safeClosePolicy: {
      closeStrategy: 'terminate-temp-profile-only',
      preserveUserWindows: true,
      cleanupTempWorkspace: true,
    },
  };
}

interface MacosDisplayInventoryEntry {
  id: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  main: boolean;
}

interface MacosCodeWindowInventoryEntry {
  pid: number;
  windowIndex: number;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MacosCgWindowInventoryEntry {
  pid: number;
  windowNumber: number;
  ownerName: string;
  title: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MacosDisplayFrameCapture {
  frameRef: string;
  screenshotRef: string;
  frameRecord: Record<string, unknown>;
}

interface MacosVsCodeInputExecution {
  pointerInputExecuted: boolean;
  keyboardInputExecuted: boolean;
  blockedReason?: string;
  markerInWorkspaceFile?: boolean;
  workspaceArtifactPath?: string;
  workspaceArtifactSha256?: string;
  summary: Record<string, unknown>;
  records: Array<[string, unknown]>;
}

interface VsCodeBridgePaths {
  extensionDir: string;
  bridgeDataDir: string;
  requestPath: string;
  resultPath: string;
  workspaceArtifactPath: string;
}

interface MacosVsCodeInputIntentOptions {
  runId: string;
  runDirRef: string;
  targetWindow: MacosCodeWindowInventoryEntry;
  userDataDir: string;
  extensionsDir: string;
  workspaceDir: string;
  bridgePaths: VsCodeBridgePaths;
  editorProfile: VirtualAppScreenVsCodeEditorProfile;
  text: string;
}

interface VirtualAppScreenCompletionRecordOptions {
  runId: string;
  runDirRef: string;
  screenPayloadRefs: {
    targetAppRef: string;
    targetWindowRef: string;
    sessionRef: string;
    frameStreamRef: string;
    inputLeaseRef: string;
    actionAdapterRef: string;
    adapterReadinessRef: string;
  };
  beforeFrameRef: string;
  afterFrameRef: string;
  beforeHash?: string;
  afterHash?: string;
  inputExecution: MacosVsCodeInputExecution;
  ok: boolean;
}

function commandExists(command: string, options: VirtualDisplayProviderProbeOptions = {}) {
  const injected = options.commandAvailability?.[command];
  if (injected !== undefined) return injected;
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function probeMacosAccessibility(): { ok: boolean; detail?: string } {
  try {
    const stdout = runOsascript(ACCESSIBILITY_PROBE_APPLESCRIPT, []);
    return { ok: Number(stdout.trim()) >= 1 };
  } catch (error) {
    return { ok: false, detail: shortError(error) };
  }
}

function listMacosDisplays(): MacosDisplayInventoryEntry[] {
  const stdout = execFileSync('swift', ['-'], {
    input: DISPLAY_INVENTORY_SWIFT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  const parsed = JSON.parse(stdout) as {
    error?: number;
    displays?: MacosDisplayInventoryEntry[];
  };
  if (parsed.error !== 0) throw new Error(`CGGetOnlineDisplayList failed with ${parsed.error}`);
  return Array.isArray(parsed.displays) ? parsed.displays : [];
}

async function captureMacosDisplayFrame(
  outDir: string,
  runDirRef: string,
  phase: string,
  display: MacosDisplayInventoryEntry,
): Promise<MacosDisplayFrameCapture> {
  const frameRef = `${runDirRef}/virtual-display-provider/frames/${phase}.json`;
  const screenshotRef = `${runDirRef}/virtual-display-provider/frames/${phase}.png`;
  const screenshotPath = localPathForRef(outDir, runDirRef, screenshotRef);
  await mkdir(dirname(screenshotPath), { recursive: true });
  await execFileAsync('screencapture', ['-x', '-D', String(display.index), screenshotPath], { timeout: 15000 });
  const screenshotStat = await stat(screenshotPath);
  if (screenshotStat.size <= 0) throw new Error(`${phase} capture was empty`);
  const digest = createHash('sha256').update(await readFile(screenshotPath)).digest('hex');
  const frameRecord = {
    schemaVersion: 'sciforge.computer-use.screen-frame.v1',
    ref: frameRef,
    role: phase,
    providerId: MACOS_PROVIDER_ID,
    screenRef: `${runDirRef}/virtual-display-provider/screen.json`,
    screenshotRef,
    screenshotBytes: screenshotStat.size,
    screenshotSha256: digest,
    captureTool: 'screencapture',
    captureDisplayIndex: display.index,
    displayIdentity: display,
    currentRunOnly: true,
  };
  return { frameRef, screenshotRef, frameRecord };
}

async function findCodePidsForUserDataDir(userDataDir: string): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-wwaxo', 'pid=,args='], {
      maxBuffer: 1024 * 1024,
      timeout: 5000,
    });
    return String(stdout)
      .split(/\r?\n/u)
      .filter((line) => line.includes(userDataDir) && line.includes('Visual Studio Code.app'))
      .map((line) => Number(line.trim().split(/\s+/u)[0]))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

async function waitForCodePidsForUserDataDir(userDataDir: string, timeoutMs: number): Promise<number[]> {
  const startedAt = Date.now();
  let pids: number[] = [];
  do {
    pids = await findCodePidsForUserDataDir(userDataDir);
    if (pids.length) return pids;
    await sleep(500);
  } while (Date.now() - startedAt < timeoutMs);
  return pids;
}

async function killCodeProcessesForUserDataDir(userDataDir: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pids = await findCodePidsForUserDataDir(userDataDir);
    if (!pids.length) break;
    try {
      await execFileAsync('kill', ['-TERM', ...pids.map(String)], { timeout: 5000 });
    } catch {
      // The temp VSCode instance may have already exited between ps and kill.
    }
    try {
      await execFileAsync('pkill', ['-TERM', '-f', userDataDir], { timeout: 5000 });
    } catch {
      // pkill exits non-zero when no matching process remains.
    }
    await sleep(500);
  }
  try {
    await rm(userDataDir, { recursive: true, force: true });
  } catch {
    // The temp profile is best-effort cleanup evidence, not acceptance proof.
  }
}

function inventoryMacosCodeWindows(pids: number[]): MacosCodeWindowInventoryEntry[] {
  const stdout = runOsascript(CODE_WINDOW_INVENTORY_APPLESCRIPT, pids.map(String));
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [pid, windowIndex, title, x, y, width, height] = line.split('\t');
      return {
        pid: Number(pid),
        windowIndex: Number(windowIndex),
        title: title ?? '',
        x: Number(x),
        y: Number(y),
        width: Number(width),
        height: Number(height),
      };
    })
    .filter((entry) => Number.isInteger(entry.pid) && Number.isInteger(entry.windowIndex));
}

async function waitForMacosAxWindows(pids: number[], timeoutMs: number): Promise<MacosCodeWindowInventoryEntry[]> {
  const startedAt = Date.now();
  let windows: MacosCodeWindowInventoryEntry[] = [];
  do {
    windows = inventoryMacosCodeWindows(pids);
    if (windows.some((window) => pids.includes(window.pid))) return windows;
    await sleep(500);
  } while (Date.now() - startedAt < timeoutMs);
  return windows;
}

function inventoryMacosCgWindows(pids: number[]): MacosCgWindowInventoryEntry[] {
  const stdout = execFileSync('swift', ['-', ...pids.map(String)], {
    input: CG_WINDOW_INVENTORY_SWIFT,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 15000,
  });
  const parsed = JSON.parse(stdout) as {
    windows?: MacosCgWindowInventoryEntry[];
  };
  return Array.isArray(parsed.windows) ? parsed.windows : [];
}

async function waitForMacosCgWindow(
  pids: number[],
  timeoutMs: number,
): Promise<MacosCgWindowInventoryEntry | undefined> {
  const startedAt = Date.now();
  let windows: MacosCgWindowInventoryEntry[] = [];
  do {
    windows = inventoryMacosCgWindows(pids);
    const targetWindow = selectMacosCgTargetWindow(windows);
    if (targetWindow) return targetWindow;
    await sleep(500);
  } while (Date.now() - startedAt < timeoutMs);
  return selectMacosCgTargetWindow(windows);
}

async function waitForMacosCgWindowForUserDataDir(
  userDataDir: string,
  initialPids: number[],
  timeoutMs: number,
): Promise<{ pids: number[]; window?: MacosCgWindowInventoryEntry }> {
  const startedAt = Date.now();
  let pids = initialPids;
  let window: MacosCgWindowInventoryEntry | undefined;
  do {
    pids = uniqueNumbers([...pids, ...await findCodePidsForUserDataDir(userDataDir)]);
    window = await waitForMacosCgWindow(pids, 500);
    if (window) return { pids, window };
    await sleep(500);
  } while (Date.now() - startedAt < timeoutMs);
  return { pids, window };
}

function selectMacosCgTargetWindow(windows: MacosCgWindowInventoryEntry[]): MacosCgWindowInventoryEntry | undefined {
  const visibleCodeWindows = windows
    .filter((window) => window.layer === 0 && window.width >= 200 && window.height >= 120)
    .sort((left, right) => (right.width * right.height) - (left.width * left.height));
  return visibleCodeWindows[0];
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))];
}

function moveMacosCodeWindow(
  window: MacosCodeWindowInventoryEntry,
  display: MacosDisplayInventoryEntry,
): { ok: boolean; stdout: string; targetBounds: Record<string, number> } {
  const margin = 32;
  const targetBounds = {
    x: display.x + margin,
    y: display.y + margin,
    width: Math.max(320, display.width - margin * 2),
    height: Math.max(240, display.height - margin * 2),
  };
  try {
    const stdout = runCompiledSwiftHelper('ax-move', AX_MOVE_WINDOW_SWIFT, [
      String(window.pid),
      String(window.windowIndex),
      String(Math.round(targetBounds.x)),
      String(Math.round(targetBounds.y)),
      String(Math.round(targetBounds.width)),
      String(Math.round(targetBounds.height)),
    ]);
    const parsed = JSON.parse(stdout) as { ok?: boolean; status?: string; error?: string };
    return { ok: parsed.ok === true, stdout: parsed.status ?? parsed.error ?? stdout.trim(), targetBounds };
  } catch (error) {
    return { ok: false, stdout: shortError(error), targetBounds };
  }
}

async function executeMacosVsCodeInputIntents(
  options: MacosVsCodeInputIntentOptions,
): Promise<MacosVsCodeInputExecution> {
  const inputIntentRef = `${options.runDirRef}/virtual-display-provider/input-intents/click-and-type.json`;
  const executorEventRef = `${options.runDirRef}/virtual-display-provider/executor-events/click-and-type.json`;
  const providerLifecycleRef = `${options.runDirRef}/virtual-display-provider/provider-lifecycle.json`;
  const sendInputIntentRef = `${options.runDirRef}/virtual-display-provider/lifecycle/send-input-intent.json`;
  const requestId = `input-intent-${Date.now()}`;
  const bridgeResult = await executeVsCodeBridgeRequest({
    requestId,
    bridgePaths: options.bridgePaths,
    runId: options.runId,
    text: options.text,
    targetWindow: options.targetWindow,
    workspaceDir: options.workspaceDir,
    userDataDir: options.userDataDir,
    extensionsDir: options.extensionsDir,
    editorProfile: options.editorProfile,
  });
  const workspaceArtifact = await readWorkspaceArtifact(options.bridgePaths.workspaceArtifactPath);
  const pointerInputExecuted = bridgeResult.ok && bridgeResult.openedDocument === true && bridgeResult.revealedRange === true;
  const keyboardInputExecuted = bridgeResult.ok && bridgeResult.appliedEdit === true && workspaceArtifact.markerInWorkspaceFile;
  const blockedReason = !pointerInputExecuted
    ? `VSCode app-command pointer-equivalent InputIntent failed: ${bridgeResult.status}.`
    : !keyboardInputExecuted
      ? `VSCode app-command keyboard InputIntent failed: ${bridgeResult.status}.`
      : undefined;
  const inputLeaseRef = `${options.runDirRef}/virtual-display-provider/input-lease.json`;
  const actionAdapterRef = `${options.runDirRef}/virtual-display-provider/action-adapter.json`;
  const adapterReadinessRef = `${options.runDirRef}/virtual-display-provider/adapter-readiness.json`;
  const targetAppRef = `app:${options.runId}/vscode`;
  const targetWindowRef = `window:${options.runId}/vscode/main`;
  const screenId = `virtual-app-screen:${options.runId}/screen`;
  const actorId = `actor:agent/${options.runId}`;
  const cursorId = `cursor:agent/${options.runId}/virtual-app-screen`;
  const inputIntent = {
    schemaVersion: 'sciforge.computer-use.input-intent.v1',
    ref: inputIntentRef,
    intentId: `input-intent:${requestId}`,
    kind: options.editorProfile.inputIntentPolicy.minimalIntentKind,
    inputKind: options.editorProfile.inputIntentPolicy.minimalIntentKind,
    source: 'virtual-screen-viewer-terminal-equivalent',
    editorProfileRef: options.editorProfile.profileRef,
    nonDestructive: options.editorProfile.inputIntentPolicy.nonDestructive,
    actorId,
    cursorId,
    screenId,
    target: {
      targetAppRef,
      targetWindowRef,
      workspaceArtifactPath: options.bridgePaths.workspaceArtifactPath,
      regionRef: `${options.runDirRef}/virtual-display-provider/frames/before.json#vscode-editor`,
    },
    targetAppRef,
    targetWindowRef,
    inputLeaseRef,
    actionAdapterRef,
    adapterReadinessRef,
    providerLifecycleRef,
    sendInputIntentRef,
    executorEventRef,
    beforeFrameRef: `${options.runDirRef}/virtual-display-provider/frames/before.json`,
    afterFrameRef: `${options.runDirRef}/virtual-display-provider/frames/after.json`,
    beforeAfterFrameRefs: [`${options.runDirRef}/virtual-display-provider/before-after/input.json`],
    verificationRefs: [`${options.runDirRef}/virtual-display-provider/verification/vscode-input.json`],
    actions: [
      {
        kind: 'focus-editor',
        adapter: 'vscode-extension-host-app-command',
        terminalEquivalent: 'open/reveal target document in the bound VSCode window',
        target: 'editor:sciforge-virtual-screen-note.md',
        result: {
          ok: pointerInputExecuted,
          status: bridgeResult.status,
          openedDocument: bridgeResult.openedDocument,
          revealedRange: bridgeResult.revealedRange,
        },
      },
      {
        kind: 'type_text',
        adapter: 'vscode-extension-host-app-command',
        terminalEquivalent: 'apply VSCode WorkspaceEdit text insertion',
        textLength: options.text.length,
        result: {
          ok: keyboardInputExecuted,
          status: bridgeResult.status,
          appliedEdit: bridgeResult.appliedEdit,
          markerInWorkspaceFile: workspaceArtifact.markerInWorkspaceFile,
        },
      },
    ],
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    },
  };
  const executorEvent = {
    schemaVersion: 'sciforge.computer-use.executor-event.v1',
    ref: executorEventRef,
    eventId: `executor-event:${requestId}`,
    actionKind: options.editorProfile.inputIntentPolicy.minimalIntentKind,
    leaseId: inputLeaseRef,
    actorId,
    cursorId,
    screenId,
    editorProfileRef: options.editorProfile.profileRef,
    nonDestructive: options.editorProfile.inputIntentPolicy.nonDestructive,
    target: {
      targetAppRef,
      targetWindowRef,
      workspaceArtifactPath: options.bridgePaths.workspaceArtifactPath,
    },
    status: pointerInputExecuted && keyboardInputExecuted ? 'completed' : 'blocked',
    inputIntentRef,
    providerLifecycleRef,
    sendInputIntentRef,
    actionAdapterRef,
    executorCommandRef: `${options.runDirRef}/virtual-display-provider/vscode-bridge/request.json`,
    beforeEvidenceRefs: [`${options.runDirRef}/virtual-display-provider/frames/before.json`],
    afterEvidenceRefs: [`${options.runDirRef}/virtual-display-provider/frames/after.json`],
    groundingRefs: [`${options.runDirRef}/virtual-display-provider/window-binding.json`],
    verificationRefs: [`${options.runDirRef}/virtual-display-provider/verification/vscode-input.json`],
    adapter: 'vscode-extension-host-app-command',
    bridgeRequestId: requestId,
    bridgeResult,
    markerInWorkspaceFile: workspaceArtifact.markerInWorkspaceFile,
    workspaceArtifactSha256: workspaceArtifact.sha256,
    pointerInputExecuted,
    keyboardInputExecuted,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    blockedReason: blockedReason ?? null,
  };
  const inputLease = {
    schemaVersion: 'sciforge.computer-use.input-lease.v1',
    ref: inputLeaseRef,
    leaseId: inputLeaseRef,
    actorId,
    cursorId,
    screenId,
    targetAppRef,
    targetWindowRef,
    leaseScope: 'virtual-app-screen-window',
    owner: 'computer-use-provider',
    expiresWhen: 'provider-session-closed',
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
  };
  const actionAdapter = {
    schemaVersion: 'sciforge.computer-use.action-adapter.v1',
    ref: actionAdapterRef,
    adapterKind: 'vscode-extension-host-app-command',
    targetScope: 'virtual-app-screen-window',
    providerId: MACOS_PROVIDER_ID,
    editorProfileRef: options.editorProfile.profileRef,
    supportedActions: ['click', 'type_text', 'menu_command'],
    captureSupported: true,
    backgroundRenderable: true,
    inputExecution: 'VSCode extension host app-command bridge',
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    systemPointerMoved: false,
    systemKeyboardEventsSent: false,
    bridgeExtensionDir: options.bridgePaths.extensionDir,
  };
  return {
    pointerInputExecuted,
    keyboardInputExecuted,
    blockedReason,
    markerInWorkspaceFile: workspaceArtifact.markerInWorkspaceFile,
    workspaceArtifactPath: options.bridgePaths.workspaceArtifactPath,
    workspaceArtifactSha256: workspaceArtifact.sha256,
    summary: {
      schemaVersion: 'sciforge.computer-use.macos-native-vscode-input-execution.v1',
      status: pointerInputExecuted && keyboardInputExecuted ? 'completed' : 'blocked',
      inputIntentRef,
      executorEventRef,
      editorProfileRef: options.editorProfile.profileRef,
      nonDestructive: options.editorProfile.inputIntentPolicy.nonDestructive,
      bridgeRequestId: requestId,
      bridgeResult,
      markerInWorkspaceFile: workspaceArtifact.markerInWorkspaceFile,
      workspaceArtifactSha256: workspaceArtifact.sha256,
      workspaceArtifactPath: options.bridgePaths.workspaceArtifactPath,
      blockedReason: blockedReason ?? null,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    },
    records: [
      [inputLeaseRef, inputLease],
      [actionAdapterRef, actionAdapter],
      [`${options.runDirRef}/virtual-display-provider/vscode-bridge/request.json`, bridgeResult.request],
      [`${options.runDirRef}/virtual-display-provider/vscode-bridge/result.json`, bridgeResult],
      [inputIntentRef, inputIntent],
      [executorEventRef, executorEvent],
    ],
  };
}

async function executeVsCodeBridgeRequest(options: {
  requestId: string;
  bridgePaths: VsCodeBridgePaths;
  runId: string;
  text: string;
  targetWindow: MacosCodeWindowInventoryEntry;
  workspaceDir: string;
  userDataDir: string;
  extensionsDir: string;
  editorProfile: VirtualAppScreenVsCodeEditorProfile;
}): Promise<Record<string, unknown> & {
  ok: boolean;
  status: string;
  request: Record<string, unknown>;
  openedDocument?: boolean;
  revealedRange?: boolean;
  appliedEdit?: boolean;
}> {
  const request = {
    schemaVersion: 'sciforge.vscode.bridge.input-request.v1',
    requestId: options.requestId,
    runId: options.runId,
    createdAt: new Date().toISOString(),
    kind: options.editorProfile.inputIntentPolicy.minimalIntentKind,
    profileId: options.editorProfile.profileId,
    profileRef: options.editorProfile.profileRef,
    nonDestructive: options.editorProfile.inputIntentPolicy.nonDestructive,
    workspaceScope: options.editorProfile.workspaceTarget.mode,
    targetWindow: options.targetWindow,
    workspaceDir: options.workspaceDir,
    userDataDir: options.userDataDir,
    extensionsDir: options.extensionsDir,
    filePath: options.bridgePaths.workspaceArtifactPath,
    text: [
      '# SciForge VirtualAppScreen VSCode Evidence',
      '',
      options.text,
      '',
      `Run: ${options.runId}`,
      `InputIntent: ${options.requestId}`,
      '',
    ].join('\n'),
    actions: [
      { kind: 'focus-editor', command: 'showTextDocument', target: options.bridgePaths.workspaceArtifactPath },
      { kind: 'type_text', command: 'workspace.applyEdit', textLength: options.text.length },
    ],
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: false,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
    },
  };
  await writeFile(options.bridgePaths.requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
  const result = await waitForVsCodeBridgeResult(options.bridgePaths.resultPath, options.requestId, 25000);
  return {
    ...result,
    request,
    ok: result.ok === true,
    status: typeof result.status === 'string' ? result.status : 'unknown',
    openedDocument: result.openedDocument === true,
    revealedRange: result.revealedRange === true,
    appliedEdit: result.appliedEdit === true,
  };
}

async function readWorkspaceArtifact(path: string): Promise<{
  markerInWorkspaceFile: boolean;
  sha256?: string;
  bytes?: number;
}> {
  try {
    const content = await readFile(path);
    return {
      markerInWorkspaceFile: content.includes(Buffer.from('SciForge isolated keyboard InputIntent')),
      sha256: createHash('sha256').update(content).digest('hex'),
      bytes: content.byteLength,
    };
  } catch {
    return { markerInWorkspaceFile: false };
  }
}

async function waitForVsCodeBridgeResult(
  resultPath: string,
  requestId: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const startedAt = Date.now();
  let lastResult: Record<string, unknown> | undefined;
  do {
    try {
      const parsed = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>;
      lastResult = parsed;
      if (parsed.requestId === requestId && (parsed.status === 'completed' || parsed.status === 'failed')) {
        return parsed;
      }
    } catch {
      // Keep polling until the extension writes its current-run result file.
    }
    await sleep(250);
  } while (Date.now() - startedAt < timeoutMs);
  return {
    schemaVersion: 'sciforge.vscode.bridge.result.v1',
    requestId,
    status: 'timeout',
    ok: false,
    lastResult,
  };
}

function virtualAppScreenCompletionRecords(
  options: VirtualAppScreenCompletionRecordOptions,
): Array<[string, unknown]> {
  const refs = {
    providerLifecycleRef: `${options.runDirRef}/virtual-display-provider/provider-lifecycle.json`,
    createSessionRef: `${options.runDirRef}/virtual-display-provider/lifecycle/create-session.json`,
    launchAppRef: `${options.runDirRef}/virtual-display-provider/lifecycle/launch-app.json`,
    attachSurfaceRef: `${options.runDirRef}/virtual-display-provider/lifecycle/attach-surface.json`,
    readFrameRef: `${options.runDirRef}/virtual-display-provider/lifecycle/read-frame.json`,
    sendInputIntentRef: `${options.runDirRef}/virtual-display-provider/lifecycle/send-input-intent.json`,
    appLaunchRef: `${options.runDirRef}/virtual-display-provider/app-launch/vscode.json`,
    liveSurfaceRef: `${options.runDirRef}/virtual-display-provider/live-surface.json`,
    inputIntentRef: `${options.runDirRef}/virtual-display-provider/input-intents/click-and-type.json`,
    executorEventRef: `${options.runDirRef}/virtual-display-provider/executor-events/click-and-type.json`,
    beforeAfterRef: `${options.runDirRef}/virtual-display-provider/before-after/input.json`,
    verificationRef: `${options.runDirRef}/virtual-display-provider/verification/vscode-input.json`,
    guiPresentRef: `gui:present/${options.runId}/screen-pane`,
    evidenceLedgerRef: `${options.runDirRef}/virtual-display-provider/evidence-ledger.json`,
    replayRef: `${options.runDirRef}/virtual-display-provider/replay.json`,
    artifactRef: `artifact:${options.runId}/vscode-virtual-screen-note.md`,
  };
  return [
    [refs.providerLifecycleRef, {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-lifecycle.v1',
      ref: refs.providerLifecycleRef,
      runId: options.runId,
      providerId: MACOS_PROVIDER_ID,
      executionMode: 'provider-executed',
      providerReady: true,
      currentRunOnly: true,
      operationRefs: {
        createSession: refs.createSessionRef,
        launchApp: refs.launchAppRef,
        attachSurface: refs.attachSurfaceRef,
        readFrame: refs.readFrameRef,
        sendInputIntent: refs.sendInputIntentRef,
      },
      chain: [
        refs.createSessionRef,
        refs.launchAppRef,
        refs.attachSurfaceRef,
        refs.readFrameRef,
        refs.sendInputIntentRef,
      ],
    }],
    [refs.createSessionRef, providerLifecycleOperationRecord({
      runId: options.runId,
      ref: refs.createSessionRef,
      operation: 'createSession',
      refs: {
        sessionRef: options.screenPayloadRefs.sessionRef,
        screenRef: `virtual-app-screen:${options.runId}/screen`,
        targetAppRef: options.screenPayloadRefs.targetAppRef,
      },
    })],
    [refs.launchAppRef, providerLifecycleOperationRecord({
      runId: options.runId,
      ref: refs.launchAppRef,
      operation: 'launchApp',
      refs: {
        sessionRef: options.screenPayloadRefs.sessionRef,
        targetAppRef: options.screenPayloadRefs.targetAppRef,
        targetWindowRef: options.screenPayloadRefs.targetWindowRef,
        appLaunchRef: refs.appLaunchRef,
      },
    })],
    [refs.attachSurfaceRef, providerLifecycleOperationRecord({
      runId: options.runId,
      ref: refs.attachSurfaceRef,
      operation: 'attachSurface',
      refs: {
        sessionRef: options.screenPayloadRefs.sessionRef,
        liveSurfaceRef: refs.liveSurfaceRef,
        frameStreamRef: options.screenPayloadRefs.frameStreamRef,
        currentFrameRef: options.afterFrameRef,
      },
    })],
    [refs.readFrameRef, providerLifecycleOperationRecord({
      runId: options.runId,
      ref: refs.readFrameRef,
      operation: 'readFrame',
      refs: {
        sessionRef: options.screenPayloadRefs.sessionRef,
        liveSurfaceRef: refs.liveSurfaceRef,
        frameStreamRef: options.screenPayloadRefs.frameStreamRef,
        beforeFrameRef: options.beforeFrameRef,
        afterFrameRef: options.afterFrameRef,
        currentFrameRef: options.afterFrameRef,
      },
    })],
    [refs.sendInputIntentRef, providerLifecycleOperationRecord({
      runId: options.runId,
      ref: refs.sendInputIntentRef,
      operation: 'sendInputIntent',
      refs: {
        sessionRef: options.screenPayloadRefs.sessionRef,
        inputIntentRefs: [refs.inputIntentRef],
        executorEventRefs: [refs.executorEventRef],
        beforeFrameRef: options.beforeFrameRef,
        afterFrameRef: options.afterFrameRef,
        beforeAfterFrameRefs: [refs.beforeAfterRef],
        verificationRefs: [refs.verificationRef],
      },
      mutatingActionExecuted: true,
    })],
    [refs.liveSurfaceRef, {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-live-surface.v1',
      ref: refs.liveSurfaceRef,
      sessionRef: options.screenPayloadRefs.sessionRef,
      frameStreamRef: options.screenPayloadRefs.frameStreamRef,
      transport: 'native-frame-stream',
      singleInteractiveTruth: true,
    }],
    [refs.beforeAfterRef, {
      schemaVersion: 'sciforge.computer-use.before-after-frame.v1',
      ref: refs.beforeAfterRef,
      beforeFrameRef: options.beforeFrameRef,
      afterFrameRef: options.afterFrameRef,
      beforeFrameSha256: options.beforeHash,
      afterFrameSha256: options.afterHash,
      readFrameRef: refs.readFrameRef,
      sendInputIntentRef: refs.sendInputIntentRef,
      inputIntentRef: refs.inputIntentRef,
      executorEventRef: refs.executorEventRef,
      changedRegionRefs: [`${options.afterFrameRef}#vscode-editor`],
      currentRunOnly: true,
    }],
    [refs.verificationRef, {
      schemaVersion: 'sciforge.computer-use.verification.v1',
      ref: refs.verificationRef,
      ok: options.ok,
      checkedRefs: [
        options.beforeFrameRef,
        options.afterFrameRef,
        refs.beforeAfterRef,
        refs.executorEventRef,
        refs.artifactRef,
      ],
      verifier: 'sha256-before-after-frame-difference+vscode-workspace-artifact-marker',
      markerInWorkspaceFile: options.inputExecution.markerInWorkspaceFile === true,
      workspaceArtifactSha256: options.inputExecution.workspaceArtifactSha256,
      workspaceArtifactPath: options.inputExecution.workspaceArtifactPath,
      reason: options.ok
        ? 'Before and after frames differ, and the VSCode extension-host app-command adapter wrote the marker into the current workspace artifact.'
        : options.inputExecution.blockedReason ?? 'InputIntent did not produce verified before/after frame evidence.',
    }],
    [refs.guiPresentRef, {
      schemaVersion: 'sciforge.computer-use.gui-present.v1',
      ref: refs.guiPresentRef,
      surface: 'virtual-screen-viewer',
      screenPayloadRef: `${options.runDirRef}/virtual-display-provider/screen-payload.json`,
      liveSurfaceRef: refs.liveSurfaceRef,
      currentFrameRef: options.afterFrameRef,
      displayedRefs: [
        options.afterFrameRef,
        refs.beforeAfterRef,
        refs.artifactRef,
        refs.replayRef,
      ],
    }],
    [refs.artifactRef, {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-artifact.v1',
      ref: refs.artifactRef,
      source: 'vscode-extension-host-app-command',
      workspaceArtifactPath: options.inputExecution.workspaceArtifactPath,
      workspaceArtifactSha256: options.inputExecution.workspaceArtifactSha256,
      markerInWorkspaceFile: options.inputExecution.markerInWorkspaceFile === true,
      causalityRefs: [
        refs.inputIntentRef,
        refs.executorEventRef,
        refs.beforeAfterRef,
      ],
      currentRunOnly: true,
    }],
    [refs.replayRef, {
      schemaVersion: 'sciforge.computer-use.virtual-app-screen-replay.v1',
      ref: refs.replayRef,
      sessionRef: options.screenPayloadRefs.sessionRef,
      timelineRefs: [
        refs.createSessionRef,
        refs.launchAppRef,
        refs.attachSurfaceRef,
        options.beforeFrameRef,
        refs.readFrameRef,
        refs.sendInputIntentRef,
        refs.inputIntentRef,
        refs.executorEventRef,
        refs.beforeAfterRef,
        options.afterFrameRef,
        refs.artifactRef,
        refs.guiPresentRef,
      ],
      currentRunOnly: true,
    }],
    [refs.evidenceLedgerRef, {
      schemaVersion: 'sciforge.computer-use.evidence-ledger.v1',
      ref: refs.evidenceLedgerRef,
      currentRunOnly: true,
      refs: [
        refs.providerLifecycleRef,
        refs.createSessionRef,
        refs.launchAppRef,
        refs.attachSurfaceRef,
        refs.readFrameRef,
        refs.sendInputIntentRef,
        refs.appLaunchRef,
        refs.liveSurfaceRef,
        refs.inputIntentRef,
        refs.executorEventRef,
        refs.beforeAfterRef,
        refs.verificationRef,
        refs.guiPresentRef,
        refs.artifactRef,
        refs.replayRef,
      ],
    }],
  ];
}

function providerLifecycleOperationRecord(options: {
  runId: string;
  ref: string;
  operation: 'createSession' | 'launchApp' | 'attachSurface' | 'readFrame' | 'sendInputIntent';
  refs: Record<string, string | string[] | undefined>;
  mutatingActionExecuted?: boolean;
}) {
  return {
    schemaVersion: 'sciforge.computer-use.virtual-app-screen-provider-lifecycle-operation.v1',
    ref: options.ref,
    runId: options.runId,
    operation: options.operation,
    providerId: MACOS_PROVIDER_ID,
    status: 'completed',
    refs: options.refs,
    blockedReason: null,
    providerExecuted: true,
    mutatingActionExecuted: options.mutatingActionExecuted === true,
    rawPayloadWritten: false,
    currentRunOnly: true,
  };
}

function runCompiledSwiftHelper(name: string, source: string, args: string[]): string {
  const helperDir = mkdtempSync(join(tmpdir(), `sciforge-${name}-`));
  try {
    const sourcePath = join(helperDir, `${name}.swift`);
    const binaryPath = join(helperDir, name);
    writeFileSync(sourcePath, source, 'utf8');
    execFileSync('swiftc', ['-framework', 'ApplicationServices', sourcePath, '-o', binaryPath], {
      stdio: 'ignore',
      timeout: 20000,
    });
    return execFileSync(binaryPath, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 15000,
    });
  } finally {
    rmSync(helperDir, { recursive: true, force: true });
  }
}

function windowWithinDisplay(
  window: Pick<MacosCgWindowInventoryEntry, 'x' | 'y' | 'width' | 'height'>,
  display: MacosDisplayInventoryEntry,
): boolean {
  const inset = 8;
  const windowLeft = window.x;
  const windowTop = window.y;
  const windowRight = window.x + Math.min(window.width, 80);
  const windowBottom = window.y + Math.min(window.height, 80);
  return windowLeft >= display.x - inset
    && windowTop >= display.y - inset
    && windowRight <= display.x + display.width + inset
    && windowBottom <= display.y + display.height + inset;
}

function runOsascript(script: string, args: string[]): string {
  return execFileSync('osascript', ['-', ...args], {
    input: script,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
    timeout: 10000,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function shortError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

const DISPLAY_INVENTORY_SWIFT = `
import CoreGraphics
import Foundation

let maxDisplays: UInt32 = 32
var displayIds = [CGDirectDisplayID](repeating: 0, count: Int(maxDisplays))
var displayCount: UInt32 = 0
let error = CGGetOnlineDisplayList(maxDisplays, &displayIds, &displayCount)
var displays = [[String: Any]]()
for index in 0..<Int(displayCount) {
  let displayId = displayIds[index]
  let bounds = CGDisplayBounds(displayId)
  displays.append([
    "id": Int(displayId),
    "index": index + 1,
    "x": Int(bounds.origin.x),
    "y": Int(bounds.origin.y),
    "width": Int(bounds.size.width),
    "height": Int(bounds.size.height),
    "main": CGDisplayIsMain(displayId) != 0
  ])
}
let output: [String: Any] = ["error": Int(error.rawValue), "displays": displays]
let data = try JSONSerialization.data(withJSONObject: output, options: [])
FileHandle.standardOutput.write(data)
`;

const CG_WINDOW_INVENTORY_SWIFT = `
import CoreGraphics
import Foundation

let targetPids = Set(CommandLine.arguments.dropFirst().compactMap { Int($0) })
let options = CGWindowListOption(arrayLiteral: [.optionOnScreenOnly, .excludeDesktopElements])
let windowInfo = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []
var windows = [[String: Any]]()
for entry in windowInfo {
  let pid = entry[kCGWindowOwnerPID as String] as? Int ?? -1
  if !targetPids.isEmpty && !targetPids.contains(pid) {
    continue
  }
  let bounds = entry[kCGWindowBounds as String] as? [String: Any] ?? [:]
  let width = bounds["Width"] as? Double ?? 0
  let height = bounds["Height"] as? Double ?? 0
  windows.append([
    "pid": pid,
    "windowNumber": entry[kCGWindowNumber as String] as? Int ?? -1,
    "ownerName": entry[kCGWindowOwnerName as String] as? String ?? "",
    "title": entry[kCGWindowName as String] as? String ?? "",
    "layer": entry[kCGWindowLayer as String] as? Int ?? -1,
    "x": Int(bounds["X"] as? Double ?? 0),
    "y": Int(bounds["Y"] as? Double ?? 0),
    "width": Int(width),
    "height": Int(height)
  ])
}
let output: [String: Any] = ["windows": windows]
let data = try JSONSerialization.data(withJSONObject: output, options: [])
FileHandle.standardOutput.write(data)
`;

const AX_MOVE_WINDOW_SWIFT = `
import ApplicationServices
import CoreGraphics
import Foundation

func emit(_ value: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: value, options: [])
  FileHandle.standardOutput.write(data)
}

let args = CommandLine.arguments.dropFirst()
guard args.count == 6,
  let pid = Int32(args[args.startIndex]),
  let windowIndex = Int(args[args.index(args.startIndex, offsetBy: 1)]),
  let x = Double(args[args.index(args.startIndex, offsetBy: 2)]),
  let y = Double(args[args.index(args.startIndex, offsetBy: 3)]),
  let width = Double(args[args.index(args.startIndex, offsetBy: 4)]),
  let height = Double(args[args.index(args.startIndex, offsetBy: 5)])
else {
  emit(["ok": false, "status": "invalid-arguments"])
  exit(0)
}

let app = AXUIElementCreateApplication(pid)
var windowsValue: CFTypeRef?
let windowsResult = AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &windowsValue)
guard windowsResult == .success, let windows = windowsValue as? [AXUIElement], windowIndex >= 1, windowIndex <= windows.count else {
  emit(["ok": false, "status": "window-not-found", "copyResult": Int(windowsResult.rawValue)])
  exit(0)
}

let window = windows[windowIndex - 1]
var targetPoint = CGPoint(x: x, y: y)
var targetSize = CGSize(width: width, height: height)
guard let pointValue = AXValueCreate(.cgPoint, &targetPoint),
  let sizeValue = AXValueCreate(.cgSize, &targetSize)
else {
  emit(["ok": false, "status": "ax-value-create-failed"])
  exit(0)
}

let positionResult = AXUIElementSetAttributeValue(window, kAXPositionAttribute as CFString, pointValue)
let sizeResult = AXUIElementSetAttributeValue(window, kAXSizeAttribute as CFString, sizeValue)
emit([
  "ok": positionResult == .success && sizeResult == .success,
  "status": positionResult == .success && sizeResult == .success ? "moved" : "move-failed",
  "positionResult": Int(positionResult.rawValue),
  "sizeResult": Int(sizeResult.rawValue)
])
`;

const ACCESSIBILITY_PROBE_APPLESCRIPT = `
tell application "System Events"
  return count of processes
end tell
`;

const CODE_WINDOW_INVENTORY_APPLESCRIPT = `
on run argv
  set outText to ""
  tell application "System Events"
    repeat with pidText in argv
      set targetPid to pidText as integer
      repeat with proc in (every process whose unix id is targetPid)
        set windowIndex to 0
        repeat with win in windows of proc
          set windowIndex to windowIndex + 1
          try
            set posValue to position of win
            set sizeValue to size of win
            set titleText to name of win
            set outText to outText & pidText & tab & (windowIndex as text) & tab & titleText & tab & ((item 1 of posValue) as text) & tab & ((item 2 of posValue) as text) & tab & ((item 1 of sizeValue) as text) & tab & ((item 2 of sizeValue) as text) & linefeed
          end try
        end repeat
      end repeat
    end repeat
    return outText
  end tell
end run
`;

function unavailableAdapterReadiness(blockedReason: string): VirtualAppScreenReadinessRecord {
  return {
    adapterKind: 'virtual-display-provider-unavailable',
    targetScope: 'virtual-app-screen',
    supportedActions: [],
    captureSupported: false,
    backgroundRenderable: false,
    affectsPhysicalDisplay: false,
    requiresFocusSteal: false,
    sharedSystemInputUsed: false,
    blockedReason,
    schemaRefs: ['sciforge.computer-use.action-adapter-readiness.v1', 'sciforge.virtual-display.readiness.v1'],
  };
}

function refArray(...values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
}

function normalizeRunId(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_RUN_ID;
}

function localPathForRef(outDir: string, runDirRef: string, ref: string): string {
  if (!ref.startsWith(`${runDirRef}/`)) return join(outDir, ref.replace(/[^a-zA-Z0-9._/-]+/g, '_'));
  return join(outDir, relative(runDirRef, ref));
}

async function writeJsonRef(outDir: string, runDirRef: string, ref: string, data: unknown): Promise<void> {
  const path = localPathForRef(outDir, runDirRef, ref);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

interface CliArgs extends VirtualAppScreenVsCodeSmokeOptions {
  outDir: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    outDir: join('.sciforge', 'vision-runs', DEFAULT_RUN_ID),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out-dir') {
      args.outDir = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--run-id') {
      args.runId = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--platform') {
      args.platform = argv[index + 1] ?? '';
      index += 1;
      continue;
    }
    if (arg === '--execute' || arg === '--provider-executed') {
      args.executionMode = 'provider-executed';
      continue;
    }
    if (arg === '--probe-only') {
      args.executionMode = 'probe-only';
      continue;
    }
    throw new Error(`Unknown VirtualAppScreen VSCode smoke argument: ${arg}`);
  }
  if (!args.outDir) throw new Error('--out-dir must not be empty');
  return args;
}

async function main(): Promise<void> {
  const { outDir, ...options } = parseArgs(process.argv.slice(2));
  const bundle = await writeVirtualAppScreenVsCodeSmokeBundle(outDir, options);
  const reason = bundle.blockedReason ? ` blockedReason="${bundle.blockedReason}"` : '';
  process.stdout.write(
    `[${bundle.manifest.status}] wrote ${bundle.schemaVersion} to ${outDir}; `
      + `providerReady=${bundle.providerReady} executionEvidenceComplete=${bundle.executionEvidenceComplete} `
      + `userAcceptanceEligible=${bundle.manifest.userAcceptanceEligible}${reason}\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
