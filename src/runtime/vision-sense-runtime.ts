import { resolve } from 'node:path';

import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { visionSenseSafetyVerifierContract } from './vision-sense/safety-verifier.js';
import { loadVisionSenseConfig, looksLikeComputerUseRequest, rebindWindowTargetForPromptAppAlias, visionSenseSelected } from './vision-sense/sense-provider.js';
import { VISION_SENSE_RUNTIME_ID, VISION_TOOL_ID } from './vision-sense/trace-policy.js';
import { windowTargetTraceConfig } from './computer-use/window-target.js';
import { visionSenseRuntimeEventTypes } from '../../packages/observe/vision/computer-use-runtime-policy.js';
import { COMPUTER_USE_ACTION_PROVIDER_ID, computerUseHostPortsContract, gatewayRequestToComputerUseRequest } from './computer-use/host-adapter.js';
import { runComputerUsePackageBridge } from './computer-use/package-bridge.js';
import { genericBridgeBlockedPayload } from './vision-sense/computer-use-trace-output.js';
import { isRecord, toStringList, uniqueStrings } from './gateway-utils.js';

const VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV = 'SCIFORGE_VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC';

export async function tryRunVisionSenseRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  if (!visionSenseSelected(request)) return undefined;
  if (looksLikePlaywrightEdgeMcpBrowserRequest(request.prompt)) return undefined;
  if (!computerUseActionProviderSelected(request) && !looksLikeComputerUseRequest(request.prompt)) return undefined;

  const workspace = resolve(request.workspacePath || process.cwd());
  const virtualAppScreenCommandText = looksLikeVirtualAppScreenRuntimeCommandText(request.prompt);
  const virtualAppScreenSilentBackgroundText = looksLikeVirtualAppScreenSilentBackgroundText(request);
  const virtualAppScreenDiagnosticRuntimeRequested = virtualAppScreenCommandText || virtualAppScreenSilentBackgroundText;
  if (virtualAppScreenDiagnosticRuntimeRequested && !virtualAppScreenRuntimeDiagnosticEnabled()) {
    return genericBridgeBlockedPayload(
      request,
      workspace,
      `VirtualAppScreen runtime commands are retired from the default Computer Use product path; set ${VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV}=1 only for legacy diagnostic smoke runs.`,
      {
        selectedRuntime: VISION_SENSE_RUNTIME_ID,
        selectedToolId: VISION_TOOL_ID,
        route: virtualAppScreenSilentBackgroundText
          ? 'virtual-app-screen-silent-background'
          : virtualAppScreenCommandRoute(request.prompt),
        diagnosticOnly: true,
        diagnosticOptInEnv: VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV,
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
    }),
  });

  if (virtualAppScreenDiagnosticRuntimeRequested) {
    const { tryRunVirtualAppScreenDiagnosticRuntime } = await import('./vision-sense/virtual-app-screen-diagnostic-runtime.js');
    const diagnosticPayload = await tryRunVirtualAppScreenDiagnosticRuntime({ request, workspace, config });
    if (diagnosticPayload) return diagnosticPayload;
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

function virtualAppScreenRuntimeDiagnosticEnabled() {
  return process.env[VIRTUAL_APP_SCREEN_RUNTIME_DIAGNOSTIC_ENV] === '1';
}

function looksLikeVirtualAppScreenRuntimeCommandText(prompt: string) {
  const tokens = computerUseSlashCommandTokens(prompt);
  const command = tokens[0];
  const subcommand = tokens[1];
  return command === 'input-intent'
    || (command === 'screen' && (subcommand === 'attach' || subcommand === 'reconnect'))
    || command === 'permission-handoff'
    || command === 'permission-recheck';
}

function virtualAppScreenCommandRoute(prompt: string) {
  return computerUseSlashCommandTokens(prompt)[0] === 'input-intent'
    ? 'virtual-app-screen-input-intent'
    : 'virtual-app-screen-runtime-command';
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

function looksLikeVirtualAppScreenSilentBackgroundText(request: GatewayRequest) {
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
