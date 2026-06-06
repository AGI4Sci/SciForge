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
} as const;

export const computerUseModelRouterCapabilityIds = {
  computerUsePlanner: 'model-router.capability.computer-use.planner',
  screenshotTranslator: 'model-router.capability.computer-use.screenshot-translator',
  cropTranslator: 'model-router.capability.computer-use.crop-translator',
  groundingTranslator: 'model-router.capability.computer-use.grounding-translator',
  verifierTranslator: 'model-router.capability.computer-use.verifier-translator',
} as const;

export type ComputerUseModelRouterPublicProfile = 'textReasoner' | 'translators.vision';
export type ComputerUseModelRouterCallPointId =
  | 'local-action-planner'
  | 'screenshot-describe'
  | 'crop-inspect'
  | 'ocr-vision-observation-summarize'
  | 'candidate-disambiguation'
  | 'grounding-translator'
  | 'before-after-compare'
  | 'verifier-explanation';
export type ComputerUseModelRouterCallPoint = {
  id: ComputerUseModelRouterCallPointId;
  profile: ComputerUseModelRouterPublicProfile;
  role: ComputerUseModelRouterPublicProfile;
  capabilityId: string;
};

export const computerUseModelRouterPublicProfiles = ['textReasoner', 'translators.vision'] as const;

export const computerUseModelRouterCallPoints: readonly ComputerUseModelRouterCallPoint[] = [
  {
    id: 'local-action-planner',
    profile: 'textReasoner',
    role: 'textReasoner',
    capabilityId: computerUseModelRouterCapabilityIds.computerUsePlanner,
  },
  {
    id: 'screenshot-describe',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.screenshotTranslator,
  },
  {
    id: 'crop-inspect',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.cropTranslator,
  },
  {
    id: 'ocr-vision-observation-summarize',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.screenshotTranslator,
  },
  {
    id: 'candidate-disambiguation',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.screenshotTranslator,
  },
  {
    id: 'grounding-translator',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.groundingTranslator,
  },
  {
    id: 'before-after-compare',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.verifierTranslator,
  },
  {
    id: 'verifier-explanation',
    profile: 'translators.vision',
    role: 'translators.vision',
    capabilityId: computerUseModelRouterCapabilityIds.verifierTranslator,
  },
] as const;

export type ComputerUseModelRouterCallValidationInput = {
  callPoint: ComputerUseModelRouterCallPointId | string;
  endpoint?: string;
  profile?: string;
  role?: string;
  modalityRefs?: readonly string[];
  providerConfig?: Record<string, unknown>;
};

export type ComputerUseModelRouterTraceInput = {
  callPoint: ComputerUseModelRouterCallPointId;
  profile: ComputerUseModelRouterPublicProfile;
  role: ComputerUseModelRouterPublicProfile;
  modalityRefs: ReadonlyArray<{
    ref: string;
    width?: number;
    height?: number;
    sha256?: string;
    bytes?: number;
  }>;
  latencyMs?: number;
  status: 'ok' | 'failed' | 'blocked' | 'unavailable';
  error?: string;
  providerRequestBody?: unknown;
  providerResponseBody?: unknown;
};

export function computerUseModelRouterCallPointManifest() {
  return {
    schemaVersion: 'sciforge.computer-use.model-router-call-points.v1',
    endpoint: '/v1/responses',
    transportOwner: 'model-router',
    publicProfiles: [...computerUseModelRouterPublicProfiles],
    callPoints: computerUseModelRouterCallPoints.map((callPoint) => ({ ...callPoint })),
  };
}

export function validateComputerUseModelRouterCall(
  input: ComputerUseModelRouterCallValidationInput,
): string[] {
  const violations: string[] = [];
  const expected = computerUseModelRouterCallPoints.find((callPoint) => callPoint.id === input.callPoint);
  if (!expected) {
    violations.push('call-point.unregistered');
  }
  if (input.endpoint !== '/v1/responses') {
    violations.push('endpoint.must-be-model-router-responses');
  }
  if (!isComputerUseModelRouterPublicProfile(input.profile)) {
    violations.push('profile.unregistered');
  } else if (expected && input.profile !== expected.profile) {
    violations.push(`profile.must-be:${expected.profile}`);
  }
  if (!isComputerUseModelRouterPublicProfile(input.role)) {
    violations.push('role.unregistered');
  } else if (expected && input.role !== expected.role) {
    violations.push(`role.must-be:${expected.role}`);
  }
  for (const ref of input.modalityRefs ?? []) {
    if (isInlineModelRouterPayloadRef(ref)) {
      violations.push('modality-ref.inline-payload-forbidden');
    }
  }
  violations.push(...directProviderConfigViolations(input.providerConfig));
  return uniqueComputerUseStrings(violations);
}

export function computerUseModelRouterTraceEvent(input: ComputerUseModelRouterTraceInput) {
  return {
    schemaVersion: 'sciforge.computer-use.model-router-trace.v1',
    endpoint: '/v1/responses',
    callPoint: input.callPoint,
    profile: input.profile,
    role: input.role,
    modalityRefs: input.modalityRefs.map((item) => item.ref),
    dimensions: input.modalityRefs
      .filter((item) => Number.isFinite(item.width) && Number.isFinite(item.height))
      .map((item) => ({ ref: item.ref, width: item.width, height: item.height })),
    contentHashes: input.modalityRefs
      .filter((item) => typeof item.sha256 === 'string' && item.sha256.trim())
      .map((item) => ({ ref: item.ref, sha256: item.sha256, bytes: item.bytes })),
    latencyMs: input.latencyMs,
    status: input.status,
    errorSummary: input.error ? boundedProviderSafeError(input.error) : undefined,
  };
}

export function computerUseVisionFailureObservation(input: {
  mode: 'unavailable' | 'blocked' | 'text-fallback';
  reason: string;
  textFallback?: string;
}) {
  const observation: {
    status: 'observation-unavailable' | 'blocked' | 'text-fallback';
    seenImage: false;
    reason: string;
    textFallback?: string;
  } = {
    status: input.mode === 'unavailable'
      ? 'observation-unavailable'
      : input.mode,
    seenImage: false,
    reason: boundedProviderSafeError(input.reason),
  };
  if (input.mode === 'text-fallback' && input.textFallback) {
    observation.textFallback = boundedTextFallback(input.textFallback);
  }
  return observation;
}

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
  forbiddenInlinePayloads: [
    'rawScreenshot',
    'rawProviderPayload',
    'providerRequestBody',
    'providerResponseBody',
    'base64',
    'data:image',
    'image_base64',
    'inlineImageBytes',
  ],
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
      query: computerUseModelRouterCapabilityIds.screenshotTranslator,
      plan: computerUseModelRouterCapabilityIds.computerUsePlanner,
      locate: computerUseModelRouterCapabilityIds.groundingTranslator,
      execute: computerUseExecuteHostPortProvider(options),
      verify: computerUseModelRouterCapabilityIds.verifierTranslator,
      writeTrace: computerUseHostPortProviderIds.writeTrace,
      emitEvent: computerUseHostPortProviderIds.emitEvent,
    },
    routerRoles: {
      screenshot: computerUseModelRouterCapabilityIds.screenshotTranslator,
      crop: computerUseModelRouterCapabilityIds.cropTranslator,
      grounding: computerUseModelRouterCapabilityIds.groundingTranslator,
      verifier: computerUseModelRouterCapabilityIds.verifierTranslator,
    },
    legacyAdapters: undefined,
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

function isComputerUseModelRouterPublicProfile(value: unknown): value is ComputerUseModelRouterPublicProfile {
  return value === 'textReasoner' || value === 'translators.vision';
}

function isInlineModelRouterPayloadRef(value: string) {
  return /(?:^data:image\/|;base64,|^base64:|\bbase64\b|^raw:)/i.test(value);
}

const directProviderConfigKeys = new Set([
  'apikey',
  'api_key',
  'token',
  'secret',
  'baseurl',
  'base_url',
  'providerurl',
  'provider_url',
  'url',
  'model',
  'modelid',
  'model_id',
  'modelslug',
  'model_slug',
  'provider',
  'providerslug',
  'provider_slug',
]);

function directProviderConfigViolations(value: Record<string, unknown> | undefined) {
  if (!value) return [];
  const violations: string[] = [];
  const visit = (record: Record<string, unknown>, path: string[] = []) => {
    for (const [key, child] of Object.entries(record)) {
      const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      const childPath = [...path, key];
      if (directProviderConfigKeys.has(normalized)) {
        violations.push(`provider-config.direct-provider-field:${childPath.join('.')}`);
      }
      if (isPlainRecord(child)) visit(child, childPath);
    }
  };
  visit(value);
  return violations;
}

function boundedProviderSafeError(value: string) {
  if (containsProviderSecretOrPrivateEndpoint(value)) {
    return '[redacted-provider-detail]';
  }
  return boundedTextFallback(value);
}

function boundedTextFallback(value: string) {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function containsProviderSecretOrPrivateEndpoint(value: string) {
  return /(?:https?:\/\/|sk-[a-z0-9_-]+|api[_-]?key|token|secret|provider|qwen|gpt-|claude|model\s+[a-z0-9._/-]+)/i.test(value);
}

function uniqueComputerUseStrings(values: string[]) {
  return Array.from(new Set(values));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
