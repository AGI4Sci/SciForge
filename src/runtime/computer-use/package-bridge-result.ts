import type { GenericVisionAction, ScreenshotRef } from './types.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';
import {
  finalArtifactRefsForTrace,
  finalVisibleArtifactForTrace,
  finalWindowScreenshotRef,
} from './package-bridge-final-artifacts.js';
import { computerUseRequiresSavedVisibleArtifact } from '../../../packages/actions/computer-use/runtime-policy.js';
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
  const policyPackageResult = applyPackageBridgeFinalVisibleArtifactPolicy(input);
  const finalArtifactSelection = { requireSaved: computerUseRequiresSavedVisibleArtifact(input.task) };
  const finalVisibleArtifact = finalVisibleArtifactForTrace(input.visibleArtifacts, finalArtifactSelection);
  const finalArtifactRefs = finalArtifactRefsForTrace(input.visibleArtifacts, finalArtifactSelection);
  const finalVisibleScreenshotRef = finalWindowScreenshotRef(input.screenshotLedger);
  const guardIssues = stringAt(policyPackageResult, 'status') === 'completed'
    ? packageBridgeCompletionGuardIssues({
      ...input,
      packageResult: policyPackageResult,
      finalVisibleArtifact,
      finalArtifactRefs,
      finalVisibleScreenshotRef,
    })
    : [];
  const packageResult = guardIssues.length > 0
    ? packageResultWithCompletionGuardFailure(policyPackageResult, guardIssues)
    : policyPackageResult;
  const packageStatus = stringAt(packageResult, 'status');
  const succeeded = packageStatus === 'completed';

  return {
    packageResult,
    packageStatus,
    payloadStatus: succeeded ? 'done' : 'failed-with-reason',
    succeeded,
    failureReason: succeeded ? '' : normalizePackageBridgeBlockedReason(packageResult, packageStatus),
    finalVisibleArtifact,
    finalArtifactRef: finalVisibleArtifact?.artifactRef,
    finalArtifactRefs,
    finalVisibleScreenshotRef,
  };
}

function packageBridgeCompletionGuardIssues(input: PackageBridgeResultMaterializerInput & {
  finalVisibleArtifact?: VirtualRemoteVisibleArtifact;
  finalArtifactRefs: string[];
  finalVisibleScreenshotRef?: string;
}) {
  const issues: string[] = [];
  if (hasBlockingUncertainty(input.packageResult)) {
    issues.push('blocking uncertainty is present; completed Computer Use results must return failed-with-reason until uncertainty is resolved.');
  }
  const finalVisibleArtifact = input.finalVisibleArtifact;
  if (finalVisibleArtifact) {
    issues.push(...finalArtifactGuardIssues({
      ...input,
      finalVisibleArtifact,
    }));
  } else if (!input.finalVisibleScreenshotRef) {
    issues.push('current observation or artifact evidence is required before completion can be accepted.');
  }
  return uniqueStrings(issues);
}

function finalArtifactGuardIssues(input: PackageBridgeResultMaterializerInput & {
  finalVisibleArtifact: VirtualRemoteVisibleArtifact;
  finalArtifactRefs: string[];
  finalVisibleScreenshotRef?: string;
}) {
  const artifact = input.finalVisibleArtifact as VirtualRemoteVisibleArtifact & Record<string, unknown>;
  const metadata = recordAt(artifact, 'metadata') ?? {};
  const artifactRef = artifact.artifactRef;
  const issues: string[] = [];
  const artifactValidationRef = firstString(artifact, metadata, [
    'artifactValidationRef',
    'validationRef',
    'formatValidationRef',
  ]);
  const artifactEvidenceRefs = uniqueStrings([
    ...refsFromRecordKeys(artifact, ['artifactRefs', 'validationRefs', 'artifactValidationRefs']),
    ...refsFromRecordKeys(metadata, ['artifactRefs', 'validationRefs', 'artifactValidationRefs']),
  ]);
  const artifactValidationRefBound = Boolean(
    artifactValidationRef
    && artifactEvidenceRefs.includes(artifactValidationRef),
  );
  const validator = firstString(artifact, metadata, ['validator', 'formatValidator', 'artifactValidator']);
  const format = firstString(artifact, metadata, ['format', 'artifactFormat', 'mimeType', 'contentType']);
  const sha256 = firstString(artifact, metadata, ['sha256', 'contentSha256', 'artifactSha256']);
  const contentRefs = uniqueStrings([
    ...refsFromRecordKeys(artifact, ['contentRefs', 'artifactRefs']),
    ...refsFromRecordKeys(metadata, ['contentRefs', 'artifactRefs']),
  ]);
  const sourceRefs = uniqueStrings([
    ...refsFromRecordKeys(artifact, ['sourceRefs', 'inputRefs', 'citationRefs']),
    ...refsFromRecordKeys(metadata, ['sourceRefs', 'inputRefs', 'citationRefs']),
  ]);
  const verifierRef = firstString(artifact, metadata, [
    'verifierVerdictRef',
    'verificationRef',
    'verifierRef',
    'validatorRef',
  ]) ?? packageVerificationRefForArtifact(input.packageResult, artifactRef);
  const savedByActionIndex = firstNumber(artifact, metadata, [
    'savedByActionIndex',
    'saveActionIndex',
    'actionIndex',
  ]);
  const savedByActionId = firstString(artifact, metadata, ['savedByActionId', 'saveActionId', 'sourceActionId']);
  const savedByActionRef = firstString(artifact, metadata, [
    'savedByActionRef',
    'saveActionRef',
    'savedByCommandEventRef',
  ]);
  const hasCurrentObservationOrArtifactEvidence = Boolean(input.finalVisibleScreenshotRef)
    || Boolean(artifactValidationRef && artifactValidationRefBound && sha256)
    || contentRefs.includes(artifactRef);
  const hasSaveActionIndex = savedByActionIndex !== undefined
    && Number.isInteger(savedByActionIndex)
    && savedByActionIndex >= 0
    && currentRunActionIndexExists(input, savedByActionIndex);
  const hasActionCausality = hasSaveActionIndex
    && (
      artifact.sourceActionIds.length > 0
      || savedByActionId !== undefined
      || savedByActionRef !== undefined
    );
  const hasValidatorSupport = Boolean(artifactValidationRef && artifactValidationRefBound && (validator || format || sha256));
  const hasVerifierSupport = Boolean(verifierRef);
  const hasSourceAndContentRefs = contentRefs.includes(artifactRef) && sourceRefs.length > 0;
  const currentRunCausality = artifact.currentRunCausality === true
    || metadata.currentRunCausality === true;

  if (!hasCurrentObservationOrArtifactEvidence) {
    issues.push('current observation or artifact evidence is required for final artifact completion.');
  }
  if (!hasActionCausality) {
    issues.push('final artifact action causality is required through savedByActionIndex plus sourceActionIds, savedByActionId, or savedByActionRef.');
  }
  if (!hasSaveActionIndex) {
    issues.push('final artifact savedByActionIndex must identify an executed action in the current run.');
  }
  if (!hasValidatorSupport) {
    issues.push('final artifact validation support is required through artifactValidationRef plus validator, format, or hash metadata.');
  }
  if (artifactValidationRef && !artifactValidationRefBound) {
    issues.push('final artifact artifactValidationRef must be bound in artifactRefs, validationRefs, or artifactValidationRefs metadata.');
  }
  if (!hasVerifierSupport) {
    issues.push('final artifact verifier support is required; file existence alone is insufficient.');
  }
  if (!hasSourceAndContentRefs) {
    issues.push('final artifact verifier support must bind contentRefs and sourceRefs for the artifact.');
  }
  if (!currentRunCausality) {
    issues.push('final artifact must carry current-run causality for the selected artifact ref.');
  }
  return issues;
}

function packageResultWithCompletionGuardFailure(
  packageResult: Record<string, unknown>,
  issues: string[],
) {
  const reason = `Computer Use completion guard rejected final artifact evidence: ${issues.join(' ')}`;
  return {
    ...packageResult,
    status: 'failed-with-reason',
    reason,
    failureDiagnostics: {
      ...recordAt(packageResult, 'failureDiagnostics'),
      failedStage: 'completion-artifact-guard',
      reason,
      issues,
    },
  };
}

function currentRunActionIndexExists(
  input: PackageBridgeResultMaterializerInput,
  index: number,
) {
  if (index < input.executedActions.length) return true;
  const packageStep = recordList(input.packageResult.steps)[index];
  if (!packageStep || stringAt(packageStep, 'status') !== 'done') return false;
  return isRecord(packageStep.action);
}

function packageVerificationRefForArtifact(packageResult: Record<string, unknown>, artifactRef: string) {
  for (const step of recordList(packageResult.steps)) {
    const verification = recordAt(step, 'verification');
    const metadata = recordAt(verification, 'metadata');
    const refs = [
      ...refsFromFinalArtifactValue(verification?.finalArtifactRefs),
      ...refsFromFinalArtifactValue(verification?.finalArtifactRef),
      ...refsFromFinalArtifactValue(metadata?.finalArtifactRefs),
      ...refsFromFinalArtifactValue(metadata?.finalArtifactRef),
    ];
    if (!refs.includes(artifactRef)) continue;
    return stringAt(verification, 'ref')
      ?? stringAt(metadata, 'verifierVerdictRef')
      ?? stringAt(metadata, 'verificationRef');
  }
  return undefined;
}

function refsFromFinalArtifactValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(refsFromFinalArtifactValue);
  if (!isRecord(value)) return [];
  return [
    stringAt(value, 'artifactRef'),
    stringAt(value, 'artifact_ref'),
    stringAt(value, 'dataRef'),
    stringAt(value, 'data_ref'),
    stringAt(value, 'outputRef'),
    stringAt(value, 'output_ref'),
    stringAt(value, 'path'),
    stringAt(value, 'ref'),
  ].filter((ref): ref is string => Boolean(ref));
}

function hasBlockingUncertainty(value: unknown) {
  return findRecordValue(value, (key, child) => {
    if (!/^(?:blockingUncertainty|completionUncertainty|artifactUncertainty|verifierUncertainty|uncertainty|uncertain|cannotVerify|notVerified)$/i.test(key)) {
      return false;
    }
    if (child === true) return true;
    if (typeof child !== 'string') return false;
    return !/^(?:false|no|none|resolved|not-applicable|n\/a)$/i.test(child.trim());
  });
}

function firstString(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const primaryValue = stringAt(primary, key);
    if (primaryValue) return primaryValue;
    const secondaryValue = stringAt(secondary, key);
    if (secondaryValue) return secondaryValue;
  }
  return undefined;
}

function firstNumber(
  primary: Record<string, unknown>,
  secondary: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const primaryValue = numberAt(primary[key]);
    if (primaryValue !== undefined) return primaryValue;
    const secondaryValue = numberAt(secondary[key]);
    if (secondaryValue !== undefined) return secondaryValue;
  }
  return undefined;
}

function refsFromRecordKeys(record: Record<string, unknown>, keys: string[]) {
  return uniqueStrings(keys.flatMap((key) => refsFromValue(record[key])));
}

function refsFromValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return [];
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === 'string' && item.trim() ? item : undefined;
}

function numberAt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function findRecordValue(
  value: unknown,
  predicate: (key: string, value: unknown) => boolean,
  seen = new Set<unknown>(),
): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => findRecordValue(item, predicate, seen));
  return Object.entries(value).some(([key, child]) => (
    predicate(key, child) || findRecordValue(child, predicate, seen)
  ));
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
