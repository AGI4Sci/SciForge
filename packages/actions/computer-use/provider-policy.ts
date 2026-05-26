import {
  computerUseInputPolicyIds,
  isComputerUseDarwinPlatform,
  type ComputerUseWindowTargetMode,
} from './runtime-policy.js';

export type ComputerUseCaptureScope = 'display' | 'window' | 'focus-region';
export type ComputerUseHostPortName = 'capture' | 'crop' | 'query' | 'plan' | 'locate' | 'execute' | 'verify' | 'writeTrace' | 'emitEvent';

export const computerUseHostPortsContractIds = {
  schemaVersion: 'sciforge.computer-use.host-ports.v1',
  hostPortCall: 'sciforge.computer-use.host-port-call.v1',
  hostPortResult: 'sciforge.computer-use.host-port-result.v1',
  cliFinalResult: 'sciforge.computer-use.cli-final-result.v1',
} as const;

export const computerUseHostPortProviderIds = {
  displayCapture: 'display-capture',
  targetWindowCapture: 'target-window-capture',
  focusRegionCrop: 'host-focus-region-crop',
  writeTrace: 'workspace-file-ref-trace-writer',
  emitEvent: 'workspace-runtime-events',
  runtimeCodexTuiTextPlanner: 'runtime-codex-tui-text-planner',
  layeredVerifier: 'layered-vision-verifier',
  kvGround: 'kv-ground',
} as const;

export const computerUseHostPortLists = {
  required: ['capture', 'plan', 'locate', 'execute', 'verify'],
  optional: ['crop', 'query', 'writeTrace', 'emitEvent'],
  forbidden: ['requestApproval', 'gui.present', 'gui.ask_user'],
} as const;

export const computerUseTraceHandoffContract = {
  schemaRef: 'sciforge.computer-use.trace-handoff.v1',
  presentationTarget: 'computer-use.trace-summary',
  approvalTarget: 'computer-use.approval-request',
  storagePolicy: 'refs-first',
  payloadPolicy: 'refs-and-compact-summary-only',
  forbiddenInlinePayloads: ['rawScreenshot', 'base64', 'data:image'],
} as const;

export const computerUseCaptureProviderIds = {
  dryRunDisplayPng: 'dry-run-display-png',
  dryRunWindowPng: 'dry-run-window-png',
  dryRunFocusRegionCopy: 'dry-run-focus-region-copy',
  macosDisplayCapture: 'macos-screencapture-display',
  macosWindowCapture: 'macos-screencapture-window',
  sipsFocusRegionCrop: 'sips-focus-region-crop',
} as const;

export const computerUseCaptureDiagnostics = {
  displayProviderResult: {
    code: 'capture.display.provider-result',
  },
  focusRegionFallbackCopy: {
    code: 'capture.focus-region.fallback-copy',
    message: 'Focus crop provider failed; copied source screenshot so the trace still has a file ref for verifier memory.',
  },
  focusRegionProviderResult: {
    code: 'capture.focus-region.provider-result',
  },
  windowProviderResult: {
    code: 'capture.window.provider-result',
  },
  windowUnsupportedProvider: {
    code: 'capture.window.unsupported-provider',
    message: 'Target-window screenshot capture is not available for the configured desktop platform/provider.',
    stderr: 'Target-window capture requires a macOS screencapture-compatible windowId provider for the configured desktop platform.',
  },
} as const;

export function computerUseCaptureProviderName(options: {
  desktopPlatform: string;
  captureScope: Extract<ComputerUseCaptureScope, 'display' | 'window'>;
}) {
  if (isComputerUseDarwinPlatform(options.desktopPlatform)) {
    return options.captureScope === 'window'
      ? computerUseCaptureProviderIds.macosWindowCapture
      : computerUseCaptureProviderIds.macosDisplayCapture;
  }
  return `${options.desktopPlatform}-${options.captureScope}-capture-provider`;
}

export function computerUseWindowCaptureProvider(options: {
  desktopPlatform: string;
  dryRun?: boolean;
  windowId?: number;
}) {
  if (options.dryRun) return computerUseCaptureProviderIds.dryRunWindowPng;
  if (isComputerUseDarwinPlatform(options.desktopPlatform) && options.windowId !== undefined) {
    return computerUseCaptureProviderIds.macosWindowCapture;
  }
  return `${options.desktopPlatform || 'unknown'}-window-provider-unavailable`;
}

export function computerUseCaptureHostPortProvider(options: {
  enabled?: boolean;
  mode?: ComputerUseWindowTargetMode;
}) {
  if (!options.enabled || !options.mode || options.mode === 'display') {
    return computerUseHostPortProviderIds.displayCapture;
  }
  return computerUseHostPortProviderIds.targetWindowCapture;
}

export function computerUseActionRequestExecutorProvider(options: {
  desktopPlatform?: string;
  dryRun?: boolean;
}) {
  return options.dryRun
    ? computerUseInputPolicyIds.dryRunExecutor
    : `${computerUseProviderSegment(options.desktopPlatform)}-host-port-executor`;
}

export function computerUseExecuteHostPortProvider(options: {
  desktopPlatform?: string;
  dryRun?: boolean;
}) {
  return options.dryRun
    ? computerUseInputPolicyIds.dryRunExecutor
    : `${computerUseProviderSegment(options.desktopPlatform)}-generic-gui-executor`;
}

export function computerUseHostPortsPolicySummary(options: {
  desktopPlatform?: string;
  dryRun?: boolean;
  grounder?: {
    baseUrl?: string;
  };
  windowTarget?: {
    enabled?: boolean;
    mode?: ComputerUseWindowTargetMode;
  };
}) {
  return {
    schemaVersion: computerUseHostPortsContractIds.schemaVersion,
    requiredPorts: [...computerUseHostPortLists.required],
    optionalPorts: [...computerUseHostPortLists.optional],
    forbiddenPorts: [...computerUseHostPortLists.forbidden],
    providers: {
      actionRequestExecutor: computerUseActionRequestExecutorProvider(options),
      capture: computerUseCaptureHostPortProvider(options.windowTarget ?? {}),
      crop: computerUseHostPortProviderIds.focusRegionCrop,
      plan: computerUseHostPortProviderIds.runtimeCodexTuiTextPlanner,
      locate: options.grounder?.baseUrl
        ? computerUseHostPortProviderIds.kvGround
        : computerUseHostPortProviderIds.focusRegionCrop,
      execute: computerUseExecuteHostPortProvider(options),
      verify: computerUseHostPortProviderIds.layeredVerifier,
      writeTrace: computerUseHostPortProviderIds.writeTrace,
      emitEvent: computerUseHostPortProviderIds.emitEvent,
    },
    traceHandoff: computerUseTraceHandoffContract,
  };
}

function computerUseProviderSegment(value: string | undefined) {
  return (value || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}
