import type { GenericVisionAction, ScreenshotRef } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import {
  finalArtifactRefsForTrace,
  finalVisibleArtifactForTrace,
  finalWindowScreenshotRef,
} from './package-bridge-final-artifacts.js';
import {
  applyPackageBridgeFinalVisibleArtifactPolicy,
  normalizePackageBridgeBlockedReason,
} from './package-bridge-policy.js';

export type PackageBridgeResultMaterializerInput = {
  packageResult: Record<string, unknown>;
  task: string;
  executedActions: GenericVisionAction[];
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
  screenshotLedger: ScreenshotRef[];
};

export type PackageBridgeMaterializedResult = {
  packageResult: Record<string, unknown>;
  packageStatus?: string;
  payloadStatus: 'done' | 'failed-with-reason';
  succeeded: boolean;
  failureReason: string;
  finalVisibleArtifact?: VirtualRemoteVisibleArtifact;
  finalArtifactRef?: string;
  finalArtifactRefs: string[];
  finalVisibleScreenshotRef?: string;
};

export function materializePackageBridgeResult(
  input: PackageBridgeResultMaterializerInput,
): PackageBridgeMaterializedResult {
  const packageResult = applyPackageBridgeFinalVisibleArtifactPolicy(input);
  const packageStatus = stringAt(packageResult, 'status');
  const succeeded = packageStatus === 'completed';
  const finalVisibleArtifact = finalVisibleArtifactForTrace(input.visibleArtifacts);
  const finalArtifactRefs = finalArtifactRefsForTrace(input.visibleArtifacts);

  return {
    packageResult,
    packageStatus,
    payloadStatus: succeeded ? 'done' : 'failed-with-reason',
    succeeded,
    failureReason: succeeded ? '' : normalizePackageBridgeBlockedReason(packageResult, packageStatus),
    finalVisibleArtifact,
    finalArtifactRef: finalVisibleArtifact?.artifactRef,
    finalArtifactRefs,
    finalVisibleScreenshotRef: finalWindowScreenshotRef(input.screenshotLedger),
  };
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
