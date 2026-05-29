import { lstatSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { isRecord } from '../gateway-utils.js';
import { isFinalArtifactEvidenceRef } from './package-bridge-evidence.js';
import type { ScreenshotRef } from './types.js';
import { sanitizeId, workspaceRel } from './utils.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

type FinalArtifactPromotionState = {
  runDir: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

export interface CurrentRunFinalArtifactRefValidation {
  ref: string;
  normalizedRef?: string;
  reason?: string;
}

export function finalVisibleArtifactForTrace(artifacts: VirtualRemoteVisibleArtifact[]) {
  return [...artifacts].reverse().find((artifact) => (
    artifact.status === 'visible-and-saved' && isFinalArtifactEvidenceRef(artifact.artifactRef)
  ))
    ?? [...artifacts].reverse().find((artifact) => isFinalArtifactEvidenceRef(artifact.artifactRef));
}

export function finalArtifactRefsForTrace(artifacts: VirtualRemoteVisibleArtifact[]) {
  return uniqueStrings(artifacts.map((artifact) => artifact.artifactRef).filter(isFinalArtifactEvidenceRef));
}

export function promotePackageResultFinalArtifactRefs(
  packageResult: Record<string, unknown>,
  workspace: string,
  state: FinalArtifactPromotionState,
) {
  const promotedRefs = uniqueStrings(collectFinalArtifactRefs(packageResult)
    .map((ref) => currentRunFinalArtifactRefValidation(ref, workspace, state.runDir).normalizedRef)
    .filter((ref): ref is string => Boolean(ref)));
  const newArtifacts = promotedRefs
    .filter((ref) => !state.visibleArtifacts.some((artifact) => artifact.artifactRef === ref))
    .map((ref) => visibleArtifactFromFinalArtifactRef(ref));
  if (!newArtifacts.length) return;
  state.visibleArtifacts = mergeVisibleArtifacts(state.visibleArtifacts, newArtifacts);
}

export function currentRunFinalArtifactRefValidation(
  ref: string,
  workspace: string,
  runDir: string,
): CurrentRunFinalArtifactRefValidation {
  const trimmed = ref.trim();
  if (!trimmed) return { ref, reason: 'empty final artifact refs are not allowed' };
  if (isPseudoFinalArtifactRef(trimmed)) {
    return { ref: trimmed, reason: 'pseudo refs are not regular file refs' };
  }
  if (trimmed.split(/[\\/]+/).includes('..')) {
    return { ref: trimmed, reason: 'parent-directory escapes are not allowed' };
  }
  const workspaceDir = resolve(workspace);
  const resolvedRef = resolve(trimmed.startsWith('/') ? trimmed : join(workspaceDir, trimmed));
  const resolvedRunDir = resolve(runDir.startsWith('/') ? runDir : join(workspaceDir, runDir));
  if (resolvedRef === resolvedRunDir || !resolvedRef.startsWith(`${resolvedRunDir}/`)) {
    return { ref: trimmed, reason: 'final artifact ref is outside the current run directory' };
  }
  if (isControlFinalArtifactRef(trimmed)) {
    return { ref: trimmed, reason: 'control evidence sidecars are not final artifacts' };
  }
  try {
    const info = lstatSync(resolvedRef);
    if (!info.isFile() || info.isSymbolicLink()) {
      return { ref: trimmed, reason: 'final artifact ref must resolve to a regular file' };
    }
    const workspaceReal = realpathSync(workspaceDir);
    const runDirReal = realpathSync(resolvedRunDir);
    const refReal = realpathSync(resolvedRef);
    if (!isPathInsideOrSame(workspaceReal, refReal) || !isPathInsideOrSame(runDirReal, refReal)) {
      return { ref: trimmed, reason: 'final artifact ref must resolve inside the current run directory' };
    }
    return { ref: trimmed, normalizedRef: workspaceRel(workspaceDir, resolvedRef) };
  } catch {
    return { ref: trimmed, reason: 'final artifact ref must resolve to an existing regular file' };
  }
}

export function finalWindowScreenshotRef(refs: ScreenshotRef[]) {
  return [...refs].reverse().find((ref) => !ref.id.includes('-focus-') && !ref.path.includes('-focus-'))?.path
    ?? refs.at(-1)?.path;
}

function collectFinalArtifactRefs(value: unknown, key = '', depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === 'string') {
    return isFinalArtifactKey(key) ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFinalArtifactRefs(item, key, depth + 1));
  }
  if (!isRecord(value)) return [];
  const directRefs = isVisibleArtifactLike(value) || isFinalArtifactKey(key)
    ? refsInsideFinalArtifactValue(value)
    : [];
  return uniqueStrings([
    ...directRefs,
    ...Object.entries(value).flatMap(([itemKey, item]) => {
      if (isFinalArtifactKey(itemKey)) return refsInsideFinalArtifactValue(item);
      if (isRecord(item) || Array.isArray(item)) return collectFinalArtifactRefs(item, itemKey, depth + 1);
      return [];
    }),
  ]);
}

function refsInsideFinalArtifactValue(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(refsInsideFinalArtifactValue);
  if (!isRecord(value)) return [];
  return uniqueStrings([
    stringAt(value, 'artifactRef'),
    stringAt(value, 'artifact_ref'),
    stringAt(value, 'dataRef'),
    stringAt(value, 'data_ref'),
    stringAt(value, 'outputRef'),
    stringAt(value, 'output_ref'),
    stringAt(value, 'path'),
    stringAt(value, 'ref'),
    ...Object.entries(value).flatMap(([key, item]) => isFinalArtifactKey(key) ? refsInsideFinalArtifactValue(item) : []),
  ].filter((ref): ref is string => Boolean(ref)));
}

function isFinalArtifactKey(key: string) {
  const normalized = key.replace(/[-_\s]+/g, '').toLowerCase();
  return normalized === 'finalartifactref'
    || normalized === 'finalartifactrefs'
    || normalized === 'finalartifact'
    || normalized === 'finalartifacts';
}

function isPseudoFinalArtifactRef(ref: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref)
    || /^EU-/i.test(ref)
    || ref.includes('\0')
    || ref.startsWith('~')
    || ref.includes('?')
    || !isFinalArtifactEvidenceRef(ref);
}

function isPathInsideOrSame(base: string, target: string) {
  return target === base || target.startsWith(`${base}/`);
}

function isVisibleArtifactLike(value: Record<string, unknown>) {
  const status = stringAt(value, 'status')?.toLowerCase();
  const delivery = stringAt(value, 'delivery');
  const kind = stringAt(value, 'kind') ?? stringAt(value, 'type') ?? '';
  return Boolean(stringAt(value, 'artifactRef') || stringAt(value, 'artifact_ref'))
    && (
      delivery === 'virtual-remote-session-artifact'
      || status === 'visible-and-saved'
      || status === 'saved'
      || status === 'final'
      || /artifact|document|index|report|deck|presentation/i.test(kind)
    );
}

function isControlFinalArtifactRef(ref: string) {
  const name = ref.split(/[\\/]/).pop() ?? ref;
  if (/^(vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|approval-source-request|approval-source-gui-ask-user|approval-source-risk-audit|approval-decision|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier)\.json$/i.test(name)) {
    return true;
  }
  return /\.json$/i.test(name) && /(^|[-_])(manifest|validator|validation|verifier)([-_.]|$)/i.test(name);
}

function visibleArtifactFromFinalArtifactRef(ref: string): VirtualRemoteVisibleArtifact {
  const name = ref.split(/[\\/]/).pop() || 'final-artifact';
  const now = new Date().toISOString();
  return {
    schemaVersion: 'sciforge.computer-use.virtual-remote-artifact.v1',
    id: `package-final-${sanitizeId(ref)}`,
    kind: 'virtual-document',
    title: name,
    artifactRef: ref,
    path: ref,
    dataRef: ref,
    appId: 'computer-use-package-bridge',
    delivery: 'virtual-remote-session-artifact',
    status: 'visible-and-saved',
    visibleTexts: [],
    sourceActionIds: ['package-result-final-artifact'],
    createdAt: now,
    updatedAt: now,
  };
}

function mergeVisibleArtifacts(
  existing: VirtualRemoteVisibleArtifact[],
  next: VirtualRemoteVisibleArtifact[],
) {
  const merged = new Map(existing.map((artifact) => [artifact.artifactRef, artifact]));
  for (const artifact of next) merged.set(artifact.artifactRef, artifact);
  return [...merged.values()];
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const raw = value[key];
  return typeof raw === 'string' ? raw : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
