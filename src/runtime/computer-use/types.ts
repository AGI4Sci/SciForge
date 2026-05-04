export type GenericVisionAction =
  | ({ type: 'click'; x?: number; y?: number } & GenericActionMetadata)
  | ({ type: 'double_click'; x?: number; y?: number } & GenericActionMetadata)
  | ({ type: 'drag'; fromX?: number; fromY?: number; toX?: number; toY?: number; fromTargetDescription?: string; toTargetDescription?: string } & GenericActionMetadata)
  | ({ type: 'type_text'; text: string } & GenericActionMetadata)
  | ({ type: 'press_key'; key: string } & GenericActionMetadata)
  | ({ type: 'hotkey'; keys: string[] } & GenericActionMetadata)
  | ({ type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number } & GenericActionMetadata)
  | ({ type: 'open_app'; appName: string } & GenericActionMetadata)
  | ({ type: 'wait'; ms?: number } & GenericActionMetadata);

export type GenericSwiftGuiAction = Extract<GenericVisionAction, { type: 'click' | 'double_click' | 'drag' | 'scroll' }>;

export interface GenericActionMetadata {
  targetDescription?: string;
  grounding?: Record<string, unknown>;
  riskLevel?: 'low' | 'medium' | 'high';
  requiresConfirmation?: boolean;
  confirmationText?: string;
}

export interface ComputerUseConfig {
  desktopBridgeEnabled: boolean;
  dryRun: boolean;
  captureDisplays: number[];
  desktopPlatform: string;
  windowTarget: WindowTarget;
  runId?: string;
  outputDir?: string;
  maxSteps: number;
  allowHighRiskActions: boolean;
  executorCoordinateScale?: number;
  planner: VisionPlannerConfig;
  grounder: VisionGrounderConfig;
  plannedActions: GenericVisionAction[];
}

export interface VisionPlannerConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  maxTokens: number;
}

export interface VisionGrounderConfig {
  baseUrl?: string;
  timeoutMs: number;
  allowServiceLocalPaths: boolean;
  localPathPrefix?: string;
  remotePathPrefix?: string;
  visionBaseUrl?: string;
  visionApiKey?: string;
  visionModel?: string;
  visionTimeoutMs: number;
  visionMaxTokens: number;
}

export interface WindowTarget {
  enabled: boolean;
  required: boolean;
  mode: 'display' | 'active-window' | 'window-id' | 'app-window';
  windowId?: number;
  processId?: number;
  bundleId?: string;
  appName?: string;
  title?: string;
  displayId?: number;
  bounds?: WindowBounds;
  contentRect?: WindowBounds;
  devicePixelRatio?: number;
  focused?: boolean;
  minimized?: boolean;
  occluded?: boolean;
  coordinateSpace: 'screen' | 'window' | 'window-local';
  inputIsolation: 'best-effort' | 'require-focused-target';
}

export interface ResolvedWindowTarget {
  ok: true;
  target: WindowTarget;
  captureKind: 'display' | 'window';
  windowId?: number;
  processId?: number;
  bundleId?: string;
  appName?: string;
  title?: string;
  displayId?: number;
  bounds?: WindowBounds;
  contentRect?: WindowBounds;
  devicePixelRatio?: number;
  focused?: boolean;
  minimized?: boolean;
  occluded?: boolean;
  captureTimestamp?: string;
  coordinateSpace: 'screen' | 'window' | 'window-local';
  inputIsolation: WindowTarget['inputIsolation'];
  schedulerLockId: string;
  source: 'config' | 'active-window' | 'display-fallback' | 'dry-run';
  diagnostics: string[];
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type WindowTargetResolution = ResolvedWindowTarget | { ok: false; target: WindowTarget; reason: string; diagnostics: string[] };

export type GroundingResolution =
  | { ok: true; action: GenericVisionAction; grounding?: Record<string, unknown> }
  | { ok: false; action: GenericVisionAction; grounding?: Record<string, unknown>; reason: string };

export type PlannerContractIssue = 'coordinate-output' | 'platform-incompatible-action';

export interface ScreenshotRef {
  id: string;
  path: string;
  absPath: string;
  displayId: number;
  windowTarget?: TraceWindowTarget;
  captureScope?: 'display' | 'window';
  captureProvider?: string;
  captureTimestamp?: string;
  diagnostics?: string[];
  captureDiagnostics?: CaptureDiagnostic[];
  width?: number;
  height?: number;
  sha256: string;
  bytes: number;
}

export interface CaptureDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  provider?: string;
  captureScope?: 'display' | 'window';
  command?: string;
  args?: string[];
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timestamp: string;
}

export interface CaptureProviderFailure {
  ok: false;
  provider: string;
  captureScope: 'display' | 'window';
  displayId: number;
  path: string;
  windowId?: number;
  diagnostics: CaptureDiagnostic[];
}

export interface TraceWindowTarget {
  enabled: boolean;
  required: boolean;
  mode: WindowTarget['mode'];
  captureKind: 'display' | 'window';
  coordinateSpace: WindowTarget['coordinateSpace'];
  inputIsolation: WindowTarget['inputIsolation'];
  windowId?: number;
  processId?: number;
  bundleId?: string;
  appName?: string;
  title?: string;
  displayId?: number;
  bounds?: WindowBounds;
  contentRect?: WindowBounds;
  devicePixelRatio?: number;
  focused?: boolean;
  minimized?: boolean;
  occluded?: boolean;
  captureTimestamp?: string;
  schedulerLockId?: string;
  source: ResolvedWindowTarget['source'];
  diagnostics?: string[];
}

export type TraceScreenshotRef = ReturnType<typeof toTraceScreenshotRef>;

export interface LoopStep {
  id: string;
  kind: 'planning' | 'gui-execution';
  status: 'done' | 'failed' | 'blocked';
  beforeScreenshotRefs?: TraceScreenshotRef[];
  afterScreenshotRefs?: TraceScreenshotRef[];
  plannedAction?: GenericVisionAction;
  grounding?: Record<string, unknown>;
  execution?: Record<string, unknown>;
  windowTarget?: TraceWindowTarget;
  localCoordinate?: Record<string, unknown>;
  mappedCoordinate?: Record<string, unknown>;
  inputChannel?: Record<string, unknown>;
  verifier?: Record<string, unknown>;
  scheduler?: Record<string, unknown>;
  failureReason?: string;
}

export function toTraceScreenshotRef(ref: ScreenshotRef) {
  return {
    id: ref.id,
    type: 'screenshot',
    path: ref.path,
    displayId: ref.displayId,
    windowTarget: ref.windowTarget,
    captureScope: ref.captureScope,
    captureProvider: ref.captureProvider,
    captureTimestamp: ref.captureTimestamp,
    diagnostics: ref.diagnostics,
    captureDiagnostics: ref.captureDiagnostics,
    width: ref.width,
    height: ref.height,
    sha256: ref.sha256,
    bytes: ref.bytes,
  };
}
