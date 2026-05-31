import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  captureDisplays,
  extractVisibleTextsFromScreenshotRefs,
  toTraceScreenshotRef,
} from './capture.js';
import {
  materializeComputerUseBrowserRuntimeObservation,
} from './browser-runtime-observation.js';
import { hasExecutableIndependentInputAdapter } from './independent-input-adapter.js';
import type { HostPortCall } from './package-bridge-stdio.js';
import type { ComputerUseConfig, ScreenshotRef, WindowTargetResolution } from './types.js';
import { workspaceRel } from './utils.js';
import {
  collectVirtualRemoteSessionArtifacts,
  collectVirtualRemoteSessionVisibleTexts,
  readVirtualRemoteSessionState,
  type VirtualRemoteVisibleArtifact,
} from './virtual-remote-session.js';
import {
  resolveWindowTarget,
  toTraceWindowTarget,
} from './window-target.js';

type PackageBridgeCaptureState = {
  runDir: string;
  targetResolution: WindowTargetResolution;
  screenshotLedger: ScreenshotRef[];
  captureRefsByObservationRef: Map<string, ScreenshotRef[]>;
  actionQueue: unknown[];
  captureIndex: number;
  latestObservation?: Record<string, unknown>;
  virtualRemoteSessionRef?: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export async function capturePackageBridgePort(
  call: HostPortCall,
  context: {
    workspace: string;
    config: ComputerUseConfig;
    state: PackageBridgeCaptureState;
  },
) {
  const { workspace, config, state } = context;
  const query = typeof call.kwargs?.query === 'string' ? call.kwargs.query : undefined;
  const historyLength = Array.isArray(call.args?.[1]) ? call.args[1].length : 0;
  state.targetResolution = await resolveWindowTarget(config);
  const isMissingPlannerInitialCapture = state.captureIndex === 0 && !query && state.actionQueue.length === 0;
  state.captureIndex += 1;
  const prefix = isMissingPlannerInitialCapture
    ? 'step-000-before'
    : `step-${String(historyLength + 1).padStart(3, '0')}-${query === 'after-action' ? 'after' : 'before'}`;
  const refs = await captureDisplays(workspace, state.runDir, prefix, config, state.targetResolution);
  state.screenshotLedger.push(...refs);
  const visibleTextExtraction = await extractVisibleTextsFromScreenshotRefs(refs, config);
  const virtualSession = hasExecutableIndependentInputAdapter(config)
    ? await readVirtualRemoteSessionState(state.runDir)
    : undefined;
  const virtualVisibleTexts = collectVirtualRemoteSessionVisibleTexts(virtualSession);
  const virtualArtifacts = collectVirtualRemoteSessionArtifacts(virtualSession);
  if (virtualSession) state.virtualRemoteSessionRef = workspaceRel(workspace, join(state.runDir, 'virtual-remote-session.json'));
  state.visibleArtifacts = mergeVisibleArtifacts(state.visibleArtifacts, virtualArtifacts);
  const visibleTexts = uniqueStrings([
    ...visibleTextExtraction.visibleTexts,
    ...virtualVisibleTexts,
  ]);
  const primary = refs[0];
  const observedAt = primary?.captureTimestamp ?? new Date().toISOString();
  const targetWindow = state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined;
  const appStatePath = join(state.runDir, `${prefix}-app-state.json`);
  const accessibilityStatePath = join(state.runDir, `${prefix}-accessibility-state.json`);
  const appStateRef = workspaceRel(workspace, appStatePath);
  const accessibilitySnapshotRef = workspaceRel(workspace, accessibilityStatePath);
  const screenIdentity = observationScreenIdentity(state.targetResolution);
  await writeObservationStateSidecars({
    appStatePath,
    accessibilityStatePath,
    appStateRef,
    accessibilitySnapshotRef,
    observedAt,
    query,
    refs,
    targetWindow,
    visibleTexts,
    screenIdentity,
  });
  const browserRuntimeObservation = await materializeComputerUseBrowserRuntimeObservation({
    workspace,
    runDir: state.runDir,
    prefix,
    scope: screenIdentity,
    observedAt,
    screenshotRef: primary?.path,
    browserRuntimeObservation: call.kwargs?.browserRuntimeObservation
      ?? call.kwargs?.browserRuntime
      ?? call.kwargs?.browser_runtime_observation,
  });
  const observation = {
    ref: primary?.path ?? workspaceRel(workspace, join(state.runDir, `${prefix}.png`)),
    summary: [
      `Captured ${refs.length} screenshot ref(s) for ${query ?? 'before-action'}.`,
      state.targetResolution.ok ? `target=${state.targetResolution.captureKind}:${state.targetResolution.source}` : state.targetResolution.reason,
      visibleTexts.length
        ? `visibleText=${visibleTexts.slice(0, 8).join(' | ')}`
        : undefined,
      virtualArtifacts.length
        ? `visibleArtifacts=${virtualArtifacts.map((artifact) => artifact.artifactRef).join(' | ')}`
        : undefined,
    ].filter(Boolean).join(' '),
    visibleTexts,
    windowTarget: targetWindow,
    artifacts: {
      screenshotRefs: refs.map(toTraceScreenshotRef),
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: virtualArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: virtualArtifacts,
      ...(browserRuntimeObservation ? {
        browserRuntimeObservationRef: browserRuntimeObservation.observationRef,
        browserRuntimeDomAxRefs: [
          browserRuntimeObservation.visibleDomRef,
          browserRuntimeObservation.accessibilitySnapshotRef,
          browserRuntimeObservation.playwrightEvaluateRef,
        ].filter(Boolean),
        browserRuntimeGroundingHintRefs: browserRuntimeObservation.groundingRefs,
      } : {}),
    },
    metadata: {
      query,
      screenshotRefs: refs.map(toTraceScreenshotRef),
      appStateRef,
      stateSnapshotRef: appStateRef,
      accessibilitySnapshotRef,
      observedAt,
      capturedAt: observedAt,
      freshnessCheck: {
        status: 'current',
        observedAt,
        checkedAt: observedAt,
        maxAgeMs: 30_000,
      },
      ...screenIdentity,
      visibleTexts,
      visibleTextExtractionDiagnostics: visibleTextExtraction.diagnostics,
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: virtualArtifacts.map((artifact) => artifact.artifactRef),
      ...(browserRuntimeObservation ? {
        browserRuntimeObservationRef: browserRuntimeObservation.observationRef,
        browserRuntimeVisibleDomRef: browserRuntimeObservation.visibleDomRef,
        browserRuntimeAccessibilitySnapshotRef: browserRuntimeObservation.accessibilitySnapshotRef,
        browserRuntimePlaywrightEvaluateRef: browserRuntimeObservation.playwrightEvaluateRef,
        browserRuntimeStateSnapshotRef: browserRuntimeObservation.stateSnapshotRef,
        browserRuntimeGroundingHintRef: browserRuntimeObservation.groundingHintRef,
        browserRuntimeGroundingHintRefs: browserRuntimeObservation.groundingRefs,
        browserRuntimePageQuery: browserRuntimeObservation.pageQuery,
        browserRuntimeStableRefs: browserRuntimeObservation.stableRefs,
        browserRuntimeObservationUse: 'observe-before-mutate-hint',
        browserRuntimeTrust: 'untrusted-page-observation',
        browserRuntimeRefsFirst: true,
        browserRuntimeCurrentBundleOnly: true,
        browserRuntimeCompletionEvidenceEligible: false,
        browserRuntimeExecutorLeaseSubstitute: false,
        browserRuntimeGuiActionSubstitute: false,
        browserRuntimeArtifactCausalitySubstitute: false,
        browserRuntimeUserLevelCompletionSubstitute: false,
        browserRuntimeDiagnostics: browserRuntimeObservation.diagnostics,
      } : {}),
    },
  };
  state.captureRefsByObservationRef.set(observation.ref, refs);
  state.latestObservation = observation;
  return observation;
}

async function writeObservationStateSidecars(options: {
  appStatePath: string;
  accessibilityStatePath: string;
  appStateRef: string;
  accessibilitySnapshotRef: string;
  observedAt: string;
  query?: string;
  refs: ScreenshotRef[];
  targetWindow?: ReturnType<typeof toTraceWindowTarget>;
  visibleTexts: string[];
  screenIdentity: Record<string, string | undefined>;
}) {
  const screenshotRefs = options.refs.map(toTraceScreenshotRef);
  await writeFile(options.appStatePath, `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.app-state-snapshot.v1',
    ref: options.appStateRef,
    observedAt: options.observedAt,
    query: options.query,
    windowTarget: options.targetWindow,
    screenshotRefs,
    ...options.screenIdentity,
  }, null, 2)}\n`, 'utf8');
  await writeFile(options.accessibilityStatePath, `${JSON.stringify({
    schemaVersion: 'sciforge.computer-use.accessibility-state-snapshot.v1',
    ref: options.accessibilitySnapshotRef,
    observedAt: options.observedAt,
    query: options.query,
    windowTarget: options.targetWindow,
    visibleTexts: options.visibleTexts,
    screenshotRefs,
    ...options.screenIdentity,
  }, null, 2)}\n`, 'utf8');
}

function observationScreenIdentity(targetResolution: WindowTargetResolution) {
  if (!targetResolution.ok) return {};
  const displayId = targetResolution.displayId ?? targetResolution.target.displayId ?? 1;
  const displayGroupId = targetResolution.displayGroupId ?? targetResolution.target.displayGroupId ?? `display-group-${displayId}`;
  const screenId = targetResolution.screenId ?? targetResolution.target.screenId ?? `screen-${displayId}`;
  const numericWindowId = targetResolution.windowId !== undefined ? `window-${targetResolution.windowId}` : undefined;
  const windowId = targetResolution.virtualWindowId ?? targetResolution.target.virtualWindowId ?? numericWindowId;
  return { displayGroupId, screenId, windowId };
}

function mergeVisibleArtifacts(
  existing: VirtualRemoteVisibleArtifact[],
  next: VirtualRemoteVisibleArtifact[],
) {
  const merged = new Map(existing.map((artifact) => [artifact.artifactRef, artifact]));
  for (const artifact of next) merged.set(artifact.artifactRef, artifact);
  return [...merged.values()];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
