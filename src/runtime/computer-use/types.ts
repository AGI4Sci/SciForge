import type { ComputerUsePlannerContractIssue } from '../../../packages/actions/computer-use/runtime-policy.js';

export type ComputerUseLeaseScopeKind = 'screen-global' | 'window-local';
export type ComputerUseFocusLeaseLane = 'global-focus' | 'adapter-local';
export type ComputerUseInputFocusClassification = 'focused-system-input' | 'non-focus-adapter';

export type ComputerUseApprovalState = 'not-required' | 'needs-confirmation' | 'approved' | 'denied';

export type ComputerUseSchedulerEntryStatus =
  | 'queued'
  | 'ready'
  | 'needs-observation'
  | 'blocked'
  | 'needs-confirmation'
  | 'cancelled'
  | 'timed-out'
  | 'rejected';

export interface ComputerUseLeaseScope {
  kind: ComputerUseLeaseScopeKind;
  displayGroupId: string;
  screenId: string;
  windowId?: string;
  reason?: string;
}

export interface ComputerUseFocusLeaseProjection {
  schemaVersion: 'sciforge.computer-use.focus-lease-projection.v1';
  lane: ComputerUseFocusLeaseLane;
  inputClassification: ComputerUseInputFocusClassification;
  requiresGlobalFocus: boolean;
  lockId: string;
  laneId: string;
  leaseScope: ComputerUseLeaseScope;
  displayGroupId: string;
  screenId: string;
  windowId?: string;
  actorId?: string;
  cursorId?: string;
  reason: string;
}

export interface ComputerUseActorCursorProvenance {
  displayGroupId: string;
  screenId: string;
  windowId?: string;
  actorId: string;
  cursorId: string;
  source?: 'planner' | 'grounder' | 'executor' | 'adapter' | 'compat-projection';
}

export interface ComputerUseActionProvenance extends ComputerUseActorCursorProvenance {
  leaseScope?: ComputerUseLeaseScope;
  beforeEvidenceRefs?: string[];
  groundingRefs?: string[];
  afterEvidenceRefs?: string[];
  executorEventRef?: string;
  verificationRefs?: string[];
  approvalState?: ComputerUseApprovalState;
}

export interface ComputerUseVisibleEvidenceInvalidation {
  invalidatesVisibleState: boolean;
  staleBy: string;
  scope: ComputerUseLeaseScope;
  staleEvidenceKinds: Array<'observation' | 'region' | 'text' | 'visual-object' | 'vlm-claim' | 'grounding'>;
  preservedEvidenceKinds: Array<'artifact' | 'verification' | 'completion-claim'>;
  reason: string;
}

export interface ComputerUseObservationFreshnessCheck {
  status: 'current' | 'stale' | 'unknown';
  checkedAt?: string;
  observedAt?: string;
  expiresAt?: string;
  maxAgeMs?: number;
  staleBy?: string;
  reason?: string;
}

export interface ComputerUseObserveBeforeMutateEvidence {
  appStateRef?: string;
  screenshotRef?: string;
  captureRef?: string;
  accessibilitySnapshotRef?: string;
  stateSnapshotRef?: string;
  groundingRef?: string;
  groundingHintRefs?: string[];
  browserRuntimeObservationRef?: string;
  browserRuntimeVisibleDomRef?: string;
  browserRuntimeAccessibilitySnapshotRef?: string;
  browserRuntimePlaywrightEvaluateRef?: string;
  browserRuntimeStateSnapshotRef?: string;
  browserRuntimeObservationUse?: 'observe-before-mutate-hint' | 'grounding-hint';
  browserRuntimeCompletionEvidenceEligible?: false;
  browserRuntimeExecutorLeaseSubstitute?: false;
  browserRuntimeGuiActionSubstitute?: false;
  browserRuntimeArtifactCausalitySubstitute?: false;
  browserRuntimeUserLevelCompletionSubstitute?: false;
  sourceObservationRef?: string;
  displayGroupId?: string;
  screenId?: string;
  windowId?: string;
  appName?: string;
  windowTitle?: string;
  observedAt?: string;
  capturedAt?: string;
  freshnessCheckedAt?: string;
  freshnessCheck?: ComputerUseObservationFreshnessCheck;
}

export interface ComputerUseSchedulerStopSignal {
  aborted?: boolean;
  cancelled?: boolean;
  reason?: string;
  ref?: string;
  receivedAt?: string;
  proposalIds?: string[];
  leaseIds?: string[];
  scope?: ComputerUseLeaseScope;
  displayGroupId?: string;
  screenId?: string;
  windowId?: string;
}

export interface ComputerUseSchedulerDecisionRefs {
  schemaVersion: 'sciforge.computer-use.scheduler-decision-refs.v1';
  status: 'blocked' | 'aborted' | 'cancelled' | 'needs-observation';
  reason: string;
  executorEventRef?: string;
  blockedManifestRef: string;
  traceRefs: string[];
  replayRefs: string[];
  mutatingActionExecuted: false;
}

export type GenericVisionAction =
  | ({ type: 'click'; x?: number; y?: number } & GenericActionMetadata)
  | ({ type: 'double_click'; x?: number; y?: number } & GenericActionMetadata)
  | ({ type: 'drag'; fromX?: number; fromY?: number; toX?: number; toY?: number; fromTargetDescription?: string; toTargetDescription?: string } & GenericActionMetadata)
  | ({ type: 'type_text'; text: string } & GenericActionMetadata)
  | ({ type: 'press_key'; key: string } & GenericActionMetadata)
  | ({ type: 'hotkey'; keys: string[] } & GenericActionMetadata)
  | ({ type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount?: number } & GenericActionMetadata)
  | ({ type: 'open_app'; appName: string } & GenericActionMetadata)
  | ({ type: 'save'; targetPath?: string } & GenericActionMetadata)
  | ({ type: 'open_menu'; menuName?: string } & GenericActionMetadata)
  | ({ type: 'wait'; ms?: number } & GenericActionMetadata);

export type GenericSwiftGuiAction = Extract<GenericVisionAction, { type: 'click' | 'double_click' | 'drag' | 'scroll' }>;

export interface GenericActionMetadata {
  targetDescription?: string;
  targetRegionDescription?: string;
  focusRegion?: Partial<FocusRegion>;
  grounding?: Record<string, unknown>;
  displayGroupId?: string;
  screenId?: string;
  windowId?: string;
  actorId?: string;
  cursorId?: string;
  leaseScope?: ComputerUseLeaseScope;
  beforeEvidenceRefs?: string[];
  groundingRefs?: string[];
  afterEvidenceRefs?: string[];
  executorEventRef?: string;
  verificationRefs?: string[];
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
  approvalState?: ComputerUseApprovalState;
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
  schedulerLockTimeoutMs?: number;
  schedulerStaleLockMs?: number;
  inputAdapter?: string;
  independentInputAdapterProvider?: string;
  allowSharedSystemInput?: boolean;
  showVisualCursor?: boolean;
  visibleTextExtraction?: VisionVisibleTextExtractionConfig;
  completionPolicy?: VisionCompletionPolicy;
  planner: ComputerUsePlannerConfig;
  grounder: VisionGrounderConfig;
  testActionFixtureMode: boolean;
  testOnlyPlannedActions: GenericVisionAction[];
}

export interface VisionCompletionPolicy {
  mode?: 'planner-confirmed' | 'one-successful-non-wait-action';
  reason?: string;
}

export interface ComputerUsePlannerConfig {
  profile?: string;
  allowOpenAiRuntime?: boolean;
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxTokens: number;
}

export interface VisionGrounderConfig {
  baseUrl?: string;
  timeoutMs: number;
  allowServiceLocalPaths: boolean;
  localPathPrefix?: string;
  remotePathPrefix?: string;
  upload?: {
    strategy?: 'scp' | 'inline' | 'file-ref';
    host?: string;
    user?: string;
    port?: number;
    remoteDir?: string;
    identityFile?: string;
    remoteUrlPrefix?: string;
  };
}

export interface VisionVisibleTextExtractionConfig {
  enabled: boolean;
  provider?: 'macos-vision-framework-ocr';
  maxItems?: number;
}

export interface WindowTarget {
  enabled: boolean;
  required: boolean;
  mode: 'display' | 'active-window' | 'window-id' | 'app-window';
  displayGroupId?: string;
  screenId?: string;
  windowId?: number;
  virtualWindowId?: string;
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
  displayGroupId?: string;
  screenId?: string;
  windowId?: number;
  virtualWindowId?: string;
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

export type PlannerContractIssue = ComputerUsePlannerContractIssue;

export interface ComputerUseSchedulerActionProposal {
  id: string;
  action: GenericVisionAction;
  targetResolution: WindowTargetResolution;
  provenance?: ComputerUseActionProvenance;
  submittedAt?: string;
  sequence?: number;
  approvalState?: ComputerUseApprovalState;
  cancelReason?: string;
  timeoutAt?: string;
  beforeEvidenceRefs?: string[];
  groundingRefs?: string[];
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
}

export interface ComputerUseActiveLease {
  leaseId: string;
  scope: ComputerUseLeaseScope;
  focusLeaseProjection?: ComputerUseFocusLeaseProjection;
  ownerId?: string;
  actorId?: string;
  cursorId?: string;
  acquiredAt?: string;
  expiresAt?: string;
}

export interface ComputerUseSchedulerQueueEntry {
  proposalId: string;
  actionType: GenericVisionAction['type'];
  status: ComputerUseSchedulerEntryStatus;
  reason?: string;
  submittedAt?: string;
  sequence: number;
  provenance: ComputerUseActionProvenance;
  leaseScope?: ComputerUseLeaseScope;
  focusLeaseProjection?: ComputerUseFocusLeaseProjection;
  leaseId?: string;
  executorEventRef?: string;
  staleEvidenceInvalidation?: ComputerUseVisibleEvidenceInvalidation;
  observeBeforeMutate?: ComputerUseObserveBeforeMutateEvidence;
  schedulerDecisionRefs?: ComputerUseSchedulerDecisionRefs;
  approvalState?: ComputerUseApprovalState;
  blocksFollowingActions?: boolean;
}

export interface ComputerUseSchedulerQueue {
  schemaVersion: 'sciforge.computer-use.scheduler-queue.v1';
  entries: ComputerUseSchedulerQueueEntry[];
  deterministicOrder: string[];
  diagnostics: string[];
}

export interface ScreenshotRef {
  id: string;
  path: string;
  absPath: string;
  displayId: number;
  displayGroupId?: string;
  screenId?: string;
  windowId?: string;
  actorId?: string;
  cursorId?: string;
  windowTarget?: TraceWindowTarget;
  captureScope?: 'display' | 'window' | 'focus-region';
  captureProvider?: string;
  captureTimestamp?: string;
  diagnostics?: string[];
  captureDiagnostics?: CaptureDiagnostic[];
  focusRegion?: FocusRegion;
  width?: number;
  height?: number;
  sha256: string;
  bytes: number;
}

export interface FocusRegion {
  sourceScreenshotRef: string;
  coordinateFrame: 'source-screenshot-pixels';
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  sourceWidth?: number;
  sourceHeight?: number;
  reason?: string;
}

export interface CaptureDiagnostic {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  provider?: string;
  captureScope?: 'display' | 'window' | 'focus-region';
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
  displayGroupId?: string;
  screenId?: string;
  virtualWindowId?: string;
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
  visualFocus?: Record<string, unknown>;
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
    displayGroupId: ref.displayGroupId,
    screenId: ref.screenId,
    windowId: ref.windowId,
    actorId: ref.actorId,
    cursorId: ref.cursorId,
    windowTarget: ref.windowTarget,
    captureScope: ref.captureScope,
    captureProvider: ref.captureProvider,
    captureTimestamp: ref.captureTimestamp,
    diagnostics: ref.diagnostics,
    captureDiagnostics: ref.captureDiagnostics,
    focusRegion: ref.focusRegion,
    width: ref.width,
    height: ref.height,
    sha256: ref.sha256,
    bytes: ref.bytes,
  };
}
