import { resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { visionSenseSafetyVerifierContract } from './vision-sense/safety-verifier.js';
import { loadVisionSenseConfig, looksLikeComputerUseRequest, rebindWindowTargetForPromptAppAlias, visionSenseSelected } from './vision-sense/sense-provider.js';
import { VISION_SENSE_RUNTIME_ID, VISION_TOOL_ID } from './vision-sense/trace-policy.js';
import { windowTargetTraceConfig } from './computer-use/window-target.js';
import { hasExecutableIndependentInputAdapter } from './computer-use/independent-input-adapter.js';
import { visionSenseRuntimeEventTypes } from '../../packages/observe/vision/computer-use-runtime-policy.js';
import { COMPUTER_USE_ACTION_PROVIDER_ID, computerUseHostPortsContract, gatewayRequestToComputerUseRequest } from './computer-use/host-adapter.js';
import { runComputerUsePackageBridge } from './computer-use/package-bridge.js';
import { sanitizeId } from './computer-use/utils.js';
import type { ComputerUseConfig, WindowTarget } from './computer-use/types.js';
import {
  parseVirtualScreenInputIntentCommand,
  virtualScreenInputIntentTraceDetail,
} from './computer-use/input-intent-command.js';
import { runVirtualAppScreenInputRuntime } from './computer-use/virtual-app-screen-input-runtime.js';
import {
  parseVirtualAppScreenRuntimeCommand,
  virtualAppScreenRuntimeCommandBlockedReason,
  virtualAppScreenRuntimeCommandRoute,
  virtualAppScreenRuntimeCommandRunId,
  virtualAppScreenRuntimeCommandTraceDetail,
  type VirtualAppScreenRuntimeCommand,
} from './computer-use/virtual-app-screen-command.js';
import * as virtualAppScreenSessionManager from './computer-use/virtual-app-screen-session-manager.js';
import type { VirtualAppScreenSessionManagerAttachResult } from './computer-use/virtual-app-screen-session-manager.js';
import { ensureVirtualAppScreenRuntimeExecutorsRegistered } from './computer-use/virtual-app-screen-runtime-executors.js';
import {
  genericBridgeBlockedPayload,
  virtualAppScreenRuntimePayload,
} from './vision-sense/computer-use-trace-output.js';
import { isRecord, toStringList, uniqueStrings } from './gateway-utils.js';

export async function tryRunVisionSenseRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!visionSenseSelected(request)) return undefined;
  if (looksLikePlaywrightEdgeMcpBrowserRequest(request.prompt)) return undefined;
  if (!computerUseActionProviderSelected(request) && !looksLikeComputerUseRequest(request.prompt)) return undefined;

  const workspace = resolve(request.workspacePath || process.cwd());
  const inputIntentCommand = parseVirtualScreenInputIntentCommand(request.prompt);
  const virtualAppScreenCommand = parseVirtualAppScreenRuntimeCommand(request.prompt);
  if (inputIntentCommand.kind === 'invalid') {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      inputIntentCommand.reason,
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        route: 'virtual-app-screen-input-intent',
        safetyVerifierContract: visionSenseSafetyVerifierContract,
      },
    );
  }
  if (virtualAppScreenCommand.kind === 'invalid') {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      virtualAppScreenCommand.reason,
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        route: 'virtual-app-screen-runtime-command',
        safetyVerifierContract: visionSenseSafetyVerifierContract,
      },
    );
  }

  const config = await loadVisionSenseConfig(workspace, request);
  rebindWindowTargetForPromptAppAlias(config, request.prompt);
  const computerUseRequest = gatewayRequestToComputerUseRequest(request, config, workspace);
  const hostPorts = computerUseHostPortsContract(config);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: visionSenseRuntimeEventTypes.runtimeSelected,
    source: 'workspace-runtime',
    toolName: VISION_TOOL_ID,
    status: 'running',
    message: 'Selected Computer Use action provider with local.vision-sense host adapter.',
    detail: JSON.stringify({
      actionProviderRequest: computerUseRequest,
      hostPorts,
      dryRun: config.dryRun,
      captureDisplays: config.captureDisplays,
      windowTarget: windowTargetTraceConfig(config.windowTarget),
      testActionFixtureMode: config.testActionFixtureMode,
      testOnlyPlannedActions: config.testActionFixtureMode ? config.testOnlyPlannedActions.length : 0,
      virtualScreenInputIntent: inputIntentCommand.kind === 'parsed'
        ? virtualScreenInputIntentTraceDetail(inputIntentCommand.command)
        : undefined,
      virtualAppScreenRuntimeCommand: virtualAppScreenCommand.kind === 'parsed'
        ? virtualAppScreenRuntimeCommandTraceDetail(virtualAppScreenCommand.command)
        : undefined,
    }),
  });

  if (inputIntentCommand.kind === 'parsed') {
    const inputRuntime = await runVirtualAppScreenInputRuntime(inputIntentCommand.command, { dryRun: config.dryRun });
    return virtualAppScreenRuntimePayload(
      request,
      workspace,
      {
        runId: inputRuntime.runId,
        status: inputRuntime.status === 'executed' ? 'done' : 'failed-with-reason',
        message: inputRuntime.message,
        routeDecision: {
          selectedRuntime: VISION_SENSE_RUNTIME_ID,
          selectedToolId: VISION_TOOL_ID,
          desktopBridgeEnabled: config.desktopBridgeEnabled,
          dryRun: config.dryRun,
          safetyVerifierContract: visionSenseSafetyVerifierContract,
          inputRuntimeEvidence: inputRuntime.evidence,
          ...inputRuntime.routeDecision,
        },
        virtualScreen: {
          artifactId: `computer-use-virtual-screen-${inputRuntime.runId}`,
          title: 'Computer Use screen',
          data: inputRuntime.virtualScreenData,
        },
      },
    );
  }

  if (virtualAppScreenCommand.kind === 'parsed') {
    const command = virtualAppScreenCommand.command;
    const reconnectCommand = command.action === 'screen-reconnect';
    const runtimeExecutorBootstrap = reconnectCommand
      ? virtualAppScreenReconnectBootstrapSkipped()
      : ensureVirtualAppScreenRuntimeExecutorsRegistered({
        nativeDriverHooks: { env: process.env },
      });
    const sessionManagerResult = await runVirtualAppScreenSessionManagerCommand(command, { dryRun: config.dryRun });
    const traceDetail = {
      ...virtualAppScreenRuntimeCommandTraceDetail(command),
      providerExecuted: sessionManagerResult.evidence.providerExecuted,
      failClosed: !virtualAppScreenSessionManagerResultSucceeded(sessionManagerResult),
    };
    const blockedReason = [
      virtualAppScreenRuntimeCommandBlockedReason(command),
      sessionManagerResult.blockedReason,
    ].filter(Boolean).join(' ');
    const sessionManagerSucceeded = virtualAppScreenSessionManagerResultSucceeded(sessionManagerResult);
    return virtualAppScreenRuntimePayload(
      request,
      workspace,
      {
        runId: virtualAppScreenRuntimeCommandRunId(command),
        status: sessionManagerSucceeded ? 'done' : 'failed-with-reason',
        message: sessionManagerSucceeded
          ? virtualAppScreenRuntimeSuccessMessage(command)
          : blockedReason,
        routeDecision: {
          selectedRuntime: VISION_SENSE_RUNTIME_ID,
          selectedToolId: VISION_TOOL_ID,
          route: virtualAppScreenRuntimeCommandRoute(command),
          commandKind: command.action,
          reconnectReason: command.reconnectReason,
          source: command.source,
          profile: command.profile,
          targetAppRef: command.refs.targetAppRef,
          screenRef: command.refs.screenRef,
          sessionRef: command.refs.sessionRef,
          liveSurfaceRef: command.refs.liveSurfaceRef ?? command.refs.surfaceRef,
          surfaceRef: command.refs.surfaceRef,
          frameStreamRef: command.refs.frameStreamRef,
          currentFrameRef: command.refs.currentFrameRef,
          currentFrameSequence: command.currentFrameSequence,
          providerSessionOwnerRef: command.refs.providerSessionOwnerRef,
          providerSessionReconnectRef: command.refs.providerSessionReconnectRef,
          liveBindingAttachGrantRef: command.refs.liveBindingAttachGrantRef,
          surfaceTransportRef: command.refs.surfaceTransportRef,
          activationRef: command.refs.activationRef,
          targetRef: command.refs.providerSessionReconnectRef ?? command.refs.permissionHandoffRef ?? command.refs.permissionRecheckRef ?? command.refs.activationRef,
          adapterReadinessRef: command.refs.readinessRef,
          providerReadinessRef: command.refs.readinessRef,
          permissionRef: command.refs.permissionRef,
          recheckRef: command.refs.permissionRecheckRef,
          platformDriverRef: command.refs.platformDriverRef,
          evidenceLedgerRef: command.refs.evidenceLedgerRef,
          guiPresentRef: command.refs.guiPresentRef,
          desktopBridgeEnabled: config.desktopBridgeEnabled,
          safetyVerifierContract: visionSenseSafetyVerifierContract,
          mutatingActionExecuted: sessionManagerResult.evidence.mutatingActionExecuted,
          providerExecuted: sessionManagerResult.evidence.providerExecuted,
          sessionManagerStatus: sessionManagerResult.status,
          sessionManagerExecutorId: sessionManagerResult.executorId,
          sessionManagerProviderId: sessionManagerResult.providerId,
          sessionManagerEvidence: sessionManagerResult.evidence,
          runtimeExecutorBootstrap,
          terminalEquivalent: true,
          virtualAppScreenRuntimeCommand: traceDetail,
        },
        virtualScreen: {
          artifactId: `computer-use-virtual-screen-${virtualAppScreenRuntimeCommandRunId(command)}`,
          title: 'Computer Use screen',
          data: virtualAppScreenSessionManager.virtualAppScreenSessionManagerResultToVirtualScreenData(
            command,
            normalizeVirtualAppScreenSessionManagerResultForScreenData(sessionManagerResult),
          ),
        },
      },
    );
  }

  const silentBackgroundGuard = silentBackgroundVirtualAppScreenGuard(request, config);
  if (silentBackgroundGuard.required && !silentBackgroundGuard.ready) {
    const runId = sanitizeId(config.runId || `virtual-app-screen-background-blocked-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`);
    return genericBridgeBlockedPayload(
      request,
      workspace,
      silentBackgroundGuard.reason,
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        route: 'virtual-app-screen-silent-background',
        silentBackgroundRequired: true,
        backgroundAdapterReady: false,
        desktopBridgeEnabled: config.desktopBridgeEnabled,
        safetyVerifierContract: visionSenseSafetyVerifierContract,
        inputAdapter: config.inputAdapter,
        independentInputAdapterReady: silentBackgroundGuard.independentInputAdapterReady,
        windowTarget: windowTargetTraceConfig(config.windowTarget),
      },
      {
        runId,
        virtualScreen: {
          artifactId: `computer-use-virtual-screen-${runId}`,
          title: 'Computer Use screen',
          data: silentBackgroundVirtualScreenProjection({
            config,
            runId,
            reason: silentBackgroundGuard.reason,
            guard: silentBackgroundGuard,
          }),
        },
      },
    );
  }

  if (!config.desktopBridgeEnabled) {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      'Computer Use action provider host adapter is selected, but desktop bridge is disabled at preflight. Enable SCIFORGE_VISION_DESKTOP_BRIDGE=1 or .sciforge/config.json visionSense.desktopBridgeEnabled=true.',
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        safetyVerifierContract: visionSenseSafetyVerifierContract,
      },
    );
  }

  return runComputerUsePackageBridge(request, workspace, config, callbacks);
}

type VirtualAppScreenSessionManagerRuntimeResult =
  Omit<VirtualAppScreenSessionManagerAttachResult, 'status'>
  & { status: VirtualAppScreenSessionManagerAttachResult['status'] | 'reconnected' };

type VirtualAppScreenSessionManagerReconnectModule =
  typeof virtualAppScreenSessionManager
  & {
    reconnectVirtualAppScreenSession?: (
      command: VirtualAppScreenRuntimeCommand,
      options?: { dryRun?: boolean },
    ) => Promise<VirtualAppScreenSessionManagerRuntimeResult> | VirtualAppScreenSessionManagerRuntimeResult;
  };

async function runVirtualAppScreenSessionManagerCommand(
  command: VirtualAppScreenRuntimeCommand,
  options: { dryRun?: boolean },
): Promise<VirtualAppScreenSessionManagerRuntimeResult> {
  if (command.action !== 'screen-reconnect') {
    return virtualAppScreenSessionManager.attachVirtualAppScreenSession(command, options);
  }
  const reconnectVirtualAppScreenSession = (
    virtualAppScreenSessionManager as VirtualAppScreenSessionManagerReconnectModule
  ).reconnectVirtualAppScreenSession;
  if (typeof reconnectVirtualAppScreenSession !== 'function') {
    return virtualAppScreenSessionManager.blockedVirtualAppScreenSessionManagerResult(
      command,
      'VirtualAppScreen reconnect session manager is not available; reconnect failed closed without creating, launching, or attaching a native session.',
    );
  }
  return reconnectVirtualAppScreenSession(command, options);
}

function virtualAppScreenSessionManagerResultSucceeded(result: VirtualAppScreenSessionManagerRuntimeResult) {
  return result.status === 'attached' || result.status === 'reconnected';
}

function normalizeVirtualAppScreenSessionManagerResultForScreenData(
  result: VirtualAppScreenSessionManagerRuntimeResult,
): VirtualAppScreenSessionManagerAttachResult {
  const { status, ...rest } = result;
  if (status !== 'reconnected') {
    return { ...rest, status };
  }
  return {
    ...rest,
    status: 'attached',
  };
}

function virtualAppScreenRuntimeSuccessMessage(command: VirtualAppScreenRuntimeCommand) {
  if (command.action === 'screen-reconnect') {
    return 'VirtualAppScreen reconnect completed through the existing provider session checkpoint; the Screen artifact preserves the current live session refs.';
  }
  return 'VirtualAppScreen attach completed through a registered runtime-owned native provider executor; the Screen artifact contains the current live session refs.';
}

function virtualAppScreenReconnectBootstrapSkipped() {
  return {
    platform: process.platform,
    registeredExecutorIds: [],
    alreadyRegistered: false,
    skippedForReconnect: true,
    reason: 'screen-reconnect uses existing provider-session refs and does not create, launch, or attach a native session.',
  };
}

function looksLikePlaywrightEdgeMcpBrowserRequest(prompt: string) {
  const text = prompt.toLowerCase();
  return /\bplaywright_edge_browser\b/.test(text)
    || /sciforge\.observe\.playwright-edge-mcp/.test(text)
    || (/\bplaywright\s+mcp\b/.test(text) && /\b(edge|msedge|microsoft\s+edge)\b/.test(text));
}

function computerUseActionProviderSelected(request: GatewayRequest) {
  if (/^\/(?:computer-use|computer\s+use)\b/i.test(request.prompt.trim())) return true;
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const selectedActionIds = uniqueStrings([
    ...(request.selectedActionIds ?? []),
    ...toStringList(uiState.selectedActionIds),
  ]);
  return selectedActionIds.includes(COMPUTER_USE_ACTION_PROVIDER_ID);
}

type SilentBackgroundVirtualAppScreenGuard = {
  required: boolean;
  ready: boolean;
  reason: string;
  independentInputAdapterReady: boolean;
  requestedSharedSystemInput: boolean;
  sharedSystemInputRisk: boolean;
  requiresFocusSteal: boolean;
  desktopBridgeDisabled: boolean;
};

function silentBackgroundVirtualAppScreenGuard(
  request: GatewayRequest,
  config: ComputerUseConfig,
): SilentBackgroundVirtualAppScreenGuard {
  const required = requiresSilentBackgroundVirtualAppScreen(request);
  const independentInputAdapterReady = Boolean(hasExecutableIndependentInputAdapter(config));
  const desktopBridgeDisabled = !config.desktopBridgeEnabled;
  const requestedSharedSystemInput = Boolean(config.allowSharedSystemInput) || looksLikeSharedSystemInputAdapter(config.inputAdapter);
  const sharedSystemInputRisk = !independentInputAdapterReady && requestedSharedSystemInput;
  const requiresFocusSteal = !independentInputAdapterReady && config.windowTarget.inputIsolation === 'require-focused-target';
  const ready = required && !desktopBridgeDisabled && independentInputAdapterReady && !sharedSystemInputRisk;
  const blockers = [
    desktopBridgeDisabled ? 'desktop bridge is disabled' : undefined,
    !independentInputAdapterReady ? 'no real background live-surface/input adapter is bound' : undefined,
    sharedSystemInputRisk ? 'the configured route would require shared system input' : undefined,
    requiresFocusSteal ? 'the configured app-window route is focus-bound' : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  const reason = ready
    ? 'Silent background VirtualAppScreen can use a bound background adapter.'
    : `Silent/background VirtualAppScreen was requested, but ${blockers.join('; ')}. The run was blocked before launching or activating the desktop app so the physical desktop is not disturbed.`;
  return {
    required,
    ready,
    reason,
    independentInputAdapterReady,
    requestedSharedSystemInput,
    sharedSystemInputRisk,
    requiresFocusSteal,
    desktopBridgeDisabled,
  };
}

function requiresSilentBackgroundVirtualAppScreen(request: GatewayRequest) {
  const requestConfig = isRecord(request.uiState?.visionSenseConfig) ? request.uiState.visionSenseConfig : {};
  const virtualAppScreen = isRecord(requestConfig.virtualAppScreen) ? requestConfig.virtualAppScreen : {};
  if (
    truthyConfig(requestConfig.requireSilentBackgroundVirtualAppScreen)
    || truthyConfig(requestConfig.requireBackgroundVirtualAppScreen)
    || truthyConfig(requestConfig.virtualAppScreenBackgroundOnly)
    || truthyConfig(virtualAppScreen.requireSilentBackground)
    || truthyConfig(virtualAppScreen.backgroundOnly)
    || truthyConfig(virtualAppScreen.silentBackground)
  ) return true;

  const prompt = request.prompt;
  return /后台|静默|不干扰|不要干扰|不抢焦点|不要抢焦点|不弹出|不弹窗|物理屏幕|真实桌面|用户桌面/.test(prompt)
    || /只在.{0,24}虚拟屏幕|虚拟屏幕.{0,24}只/.test(prompt)
    || /\b(?:background|silent|offscreen|headless)\b/i.test(prompt)
    || /\b(?:do not|don't|without)\b.{0,40}\b(?:affect|disturb|interrupt|steal focus|move the mouse|send keyboard|show on the desktop)\b/i.test(prompt)
    || /\bonly\b.{0,40}\b(?:virtual screen|sciforge screen|sciforge virtual screen)\b/i.test(prompt);
}

function truthyConfig(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return /^(1|true|yes|on|enabled)$/i.test(value.trim());
  return false;
}

function looksLikeSharedSystemInputAdapter(value: string | undefined) {
  return typeof value === 'string' && /shared[-_\s]?system|system[-_\s]?input|os[-_\s]?input/i.test(value);
}

function silentBackgroundVirtualScreenProjection(params: {
  config: ComputerUseConfig;
  runId: string;
  reason: string;
  guard: SilentBackgroundVirtualAppScreenGuard;
}) {
  const target = params.config.windowTarget;
  const displayGroupRef = target.displayGroupId ? `display-group:${target.displayGroupId}` : 'display-group:virtual-app-screen-background-blocked';
  const screenRef = target.screenId ? `screen:${target.screenId}` : 'screen:virtual-app-screen-background-blocked';
  return {
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    title: 'Computer Use Virtual Screen',
    status: 'blocked',
    attachState: 'blocked',
    surfaceMode: 'empty',
    displayGroupRef,
    screenRef,
    visibleScreenRefs: [screenRef],
    targetAppRef: targetAppRefFromWindowTarget(target),
    targetWindowRef: targetWindowRefFromWindowTarget(target),
    blockedRef: `audit:computer-use-virtual-screen:${params.runId}:silent-background-adapter-blocked`,
    screen: {
      label: target.title ?? target.appName ?? target.bundleId ?? 'VirtualAppScreen background target',
    },
    isolationFlags: {
      affectsPhysicalDisplay: false,
      requiresFocusSteal: params.guard.requiresFocusSteal,
      sharedSystemInputUsed: false,
      systemPointerMoved: false,
      systemKeyboardEventsSent: false,
      backgroundRenderable: false,
      diagnosticOnly: true,
      failClosedByDefault: true,
      requestedSharedSystemInput: params.guard.requestedSharedSystemInput,
      sharedSystemInputRisk: params.guard.sharedSystemInputRisk,
      desktopBridgeDisabled: params.guard.desktopBridgeDisabled,
      independentInputAdapterReady: params.guard.independentInputAdapterReady,
    },
    runSummary: {
      status: 'blocked',
      runId: params.runId,
      blockedReason: params.reason,
      frameCount: 0,
      screenCount: 0,
      realNativeSidecarExecuted: false,
      completionEligible: false,
      backgroundRenderable: false,
    },
  };
}

function targetAppRefFromWindowTarget(target: WindowTarget) {
  if (target.bundleId?.trim()) return `app:${target.bundleId.trim()}`;
  if (target.appName?.trim()) return `app:${sanitizeId(target.appName.trim())}`;
  return undefined;
}

function targetWindowRefFromWindowTarget(target: WindowTarget) {
  if (typeof target.windowId === 'number' && Number.isFinite(target.windowId)) return `window:${target.windowId}`;
  if (target.virtualWindowId?.trim()) return `window:${sanitizeId(target.virtualWindowId.trim())}`;
  return undefined;
}
