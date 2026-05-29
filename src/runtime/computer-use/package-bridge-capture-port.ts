import { join } from 'node:path';

import {
  captureDisplays,
  extractVisibleTextsFromScreenshotRefs,
  toTraceScreenshotRef,
} from './capture.js';
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
    windowTarget: state.targetResolution.ok ? toTraceWindowTarget(state.targetResolution) : undefined,
    artifacts: {
      screenshotRefs: refs.map(toTraceScreenshotRef),
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: virtualArtifacts.map((artifact) => artifact.artifactRef),
      visibleArtifacts: virtualArtifacts,
    },
    metadata: {
      query,
      screenshotRefs: refs.map(toTraceScreenshotRef),
      visibleTexts,
      visibleTextExtractionDiagnostics: visibleTextExtraction.diagnostics,
      virtualRemoteSessionRef: state.virtualRemoteSessionRef,
      visibleArtifactRefs: virtualArtifacts.map((artifact) => artifact.artifactRef),
    },
  };
  state.captureRefsByObservationRef.set(observation.ref, refs);
  state.latestObservation = observation;
  return observation;
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
