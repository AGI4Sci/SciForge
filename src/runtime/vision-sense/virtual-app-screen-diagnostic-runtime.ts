import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { hasExecutableIndependentInputAdapter } from '../computer-use/independent-input-adapter.js';
import type { ComputerUseConfig, WindowTarget } from '../computer-use/types.js';
import type { VirtualAppScreenRuntimeCommand } from '../computer-use/virtual-app-screen-command.js';
import type { VirtualAppScreenSessionManagerAttachResult } from '../computer-use/virtual-app-screen-session-manager.js';
import { sanitizeId } from '../computer-use/utils.js';
import { windowTargetTraceConfig } from '../computer-use/window-target.js';
import { isRecord } from '../gateway-utils.js';
import {
  genericBridgeBlockedPayload,
  virtualAppScreenRuntimePayload,
} from './computer-use-trace-output.js';
import { visionSenseSafetyVerifierContract } from './safety-verifier.js';
import { VISION_SENSE_RUNTIME_ID, VISION_TOOL_ID } from './trace-policy.js';

export async function tryRunVirtualAppScreenDiagnosticRuntime(params: {
  request: GatewayRequest;
  workspace: string;
  config: ComputerUseConfig;
}): Promise<ToolPayload | undefined> {
  const { request, workspace, config } = params;
  const inputIntentCommandText = looksLikeVirtualAppScreenInputIntentCommandText(request.prompt);
  const virtualAppScreenCommandText = looksLikeVirtualAppScreenRuntimeCommandText(request.prompt);
  const inputIntentModule = inputIntentCommandText
    ? await import('../computer-use/input-intent-command.js')
    : undefined;
  const inputIntentCommand = inputIntentModule?.parseVirtualScreenInputIntentCommand(request.prompt);
  const virtualAppScreenCommandModule = virtualAppScreenCommandText && !inputIntentCommandText
    ? await import('../computer-use/virtual-app-screen-command.js')
    : undefined;
  const virtualAppScreenCommand = virtualAppScreenCommandModule?.parseVirtualAppScreenRuntimeCommand(request.prompt);

  if (inputIntentCommand?.kind === 'invalid') {
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
  if (virtualAppScreenCommand?.kind === 'invalid') {
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

  if (inputIntentCommand?.kind === 'parsed') {
    const { runVirtualAppScreenInputRuntime } = await import('../computer-use/virtual-app-screen-input-runtime.js');
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

  if (virtualAppScreenCommand?.kind === 'parsed' && virtualAppScreenCommandModule) {
    const [
      virtualAppScreenSessionManager,
      { ensureVirtualAppScreenRuntimeExecutorsRegistered },
    ] = await Promise.all([
      import('../computer-use/virtual-app-screen-session-manager.js'),
      import('../computer-use/virtual-app-screen-runtime-executors.js'),
    ]);
    const command = virtualAppScreenCommand.command;
    const reconnectCommand = command.action === 'screen-reconnect';
    const runtimeExecutorBootstrap = reconnectCommand
      ? virtualAppScreenReconnectBootstrapSkipped()
      : ensureVirtualAppScreenRuntimeExecutorsRegistered({
          nativeDriverHooks: { env: process.env },
        });
    const sessionManagerResult = await runVirtualAppScreenSessionManagerCommand(
      virtualAppScreenSessionManager,
      command,
      { dryRun: config.dryRun },
    );
    const traceDetail = {
      ...virtualAppScreenCommandModule.virtualAppScreenRuntimeCommandTraceDetail(command),
      providerExecuted: sessionManagerResult.evidence.providerExecuted,
      failClosed: !virtualAppScreenSessionManagerResultSucceeded(sessionManagerResult),
    };
    const blockedReason = [
      virtualAppScreenCommandModule.virtualAppScreenRuntimeCommandBlockedReason(command),
      sessionManagerResult.blockedReason,
    ].filter(Boolean).join(' ');
    const sessionManagerSucceeded = virtualAppScreenSessionManagerResultSucceeded(sessionManagerResult);
    return virtualAppScreenRuntimePayload(
      request,
      workspace,
      {
        runId: virtualAppScreenCommandModule.virtualAppScreenRuntimeCommandRunId(command),
        status: sessionManagerSucceeded ? 'done' : 'failed-with-reason',
        message: sessionManagerSucceeded
          ? virtualAppScreenRuntimeSuccessMessage(command)
          : blockedReason,
        routeDecision: {
          selectedRuntime: VISION_SENSE_RUNTIME_ID,
          selectedToolId: VISION_TOOL_ID,
          route: virtualAppScreenCommandModule.virtualAppScreenRuntimeCommandRoute(command),
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
          evidenceLedgerRef: sessionManagerResult.refs.hostEvidenceLedgerRef
            ?? sessionManagerResult.refs.evidenceLedgerRef
            ?? command.refs.evidenceLedgerRef,
          hostEvidenceLedgerRef: sessionManagerResult.refs.hostEvidenceLedgerRef,
          permissionHandoffLedgerEntryRef: sessionManagerResult.refs.permissionHandoffLedgerEntryRef,
          permissionRecheckLedgerEntryRef: sessionManagerResult.refs.permissionRecheckLedgerEntryRef,
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
          artifactId: `computer-use-virtual-screen-${virtualAppScreenCommandModule.virtualAppScreenRuntimeCommandRunId(command)}`,
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

  return undefined;
}

export function looksLikeVirtualAppScreenRuntimeCommandText(prompt: string) {
  const tokens = computerUseSlashCommandTokens(prompt);
  const command = tokens[0];
  const subcommand = tokens[1];
  return command === 'input-intent'
    || (command === 'screen' && (subcommand === 'attach' || subcommand === 'reconnect'))
    || command === 'permission-handoff'
    || command === 'permission-recheck';
}

export function looksLikeVirtualAppScreenSilentBackgroundRequest(request: GatewayRequest) {
  return requiresSilentBackgroundVirtualAppScreen(request);
}

function looksLikeVirtualAppScreenInputIntentCommandText(prompt: string) {
  return computerUseSlashCommandTokens(prompt)[0] === 'input-intent';
}

function computerUseSlashCommandTokens(prompt: string): string[] {
  const trimmed = prompt.trim();
  const slashPrefix = '/computer-use';
  const spacedSlashPrefix = '/computer use';
  const lower = trimmed.toLowerCase();
  const body = lower.startsWith(slashPrefix)
    ? trimmed.slice(slashPrefix.length)
    : lower.startsWith(spacedSlashPrefix)
      ? trimmed.slice(spacedSlashPrefix.length)
      : undefined;
  return body?.trim().split(/\s+/).filter(Boolean).map((token) => token.toLowerCase()) ?? [];
}

type VirtualAppScreenSessionManagerRuntimeResult =
  Omit<VirtualAppScreenSessionManagerAttachResult, 'status'>
  & { status: VirtualAppScreenSessionManagerAttachResult['status'] | 'reconnected' };

type VirtualAppScreenSessionManagerModule = typeof import('../computer-use/virtual-app-screen-session-manager.js');

type VirtualAppScreenSessionManagerReconnectModule =
  VirtualAppScreenSessionManagerModule
  & {
    reconnectVirtualAppScreenSession?: (
      command: VirtualAppScreenRuntimeCommand,
      options?: { dryRun?: boolean },
    ) => Promise<VirtualAppScreenSessionManagerRuntimeResult> | VirtualAppScreenSessionManagerRuntimeResult;
  };

async function runVirtualAppScreenSessionManagerCommand(
  virtualAppScreenSessionManager: VirtualAppScreenSessionManagerModule,
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
