import { lstatSync, realpathSync } from 'node:fs';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { cuNextCompletionGradeEvidenceIssues } from './completion-grade.js';
import {
  validateCuNextLiveAcceptanceTaskEvidence,
  type CuNextLiveAcceptanceIssue,
} from './live-acceptance-validator.js';
import { CU_NEXT_TASK_MAPPINGS } from './task-map.js';

export interface CuNextLiveAcceptanceBundleValidationOptions {
  workspacePath: string;
  refs: string[];
  taskId?: string;
}

export interface CuNextLiveAcceptanceBundleValidation {
  status: 'valid' | 'missing' | 'invalid';
  taskId?: string;
  runDirRef?: string;
  acceptanceManifestRef?: string;
  completionEvidenceRef?: string;
  issues: string[];
  missingRefs: string[];
}

export async function validateCurrentRunLiveAcceptanceBundle(
  options: CuNextLiveAcceptanceBundleValidationOptions,
): Promise<CuNextLiveAcceptanceBundleValidation> {
  const runDirRef = currentRunDirRef(options.refs);
  if (!runDirRef) {
    return {
      status: 'missing',
      issues: ['completion-grade: current Computer Use run dir could not be inferred from cu-user-acceptance-manifest.json, primitive-trace.json, or vision-trace.json refs.'],
      missingRefs: ['cu-user-acceptance-manifest.json'],
    };
  }
  const acceptanceManifestRef = `${runDirRef}/cu-user-acceptance-manifest.json`;
  const acceptancePath = resolve(options.workspacePath, acceptanceManifestRef);
  const acceptance = await readBundleJson(acceptancePath);
  if (!acceptance) {
    return {
      status: 'missing',
      runDirRef,
      acceptanceManifestRef,
      issues: [`completion-grade: ${acceptanceManifestRef} is missing for completed chat Computer Use run.`],
      missingRefs: ['cu-user-acceptance-manifest.json'],
    };
  }

  const issues: string[] = [];
  if (acceptance.schemaVersion !== 'sciforge.computer-use.user-acceptance-manifest.v1') {
    issues.push(`${acceptanceManifestRef} is not a CU user acceptance manifest.`);
  }
  const normalizedAcceptance = normalizeCurrentRunBundleRefs(acceptance, runDirRef);
  const taskId = stringValue(normalizedAcceptance.taskId) ?? options.taskId;
  const mapping = CU_NEXT_TASK_MAPPINGS.find((candidate) => candidate.taskId === taskId);
  if (!taskId) {
    issues.push(`${acceptanceManifestRef} taskId is required for completed chat Computer Use acceptance.`);
  } else if (!mapping) {
    issues.push(`${acceptanceManifestRef} taskId ${taskId} is not present in the CU-NEXT task map.`);
  }
  if (acceptance.level !== 'L3') issues.push(`${acceptanceManifestRef} level must be L3.`);

  if (taskId && mapping) {
    const refRecords = await readLiveAcceptanceRefRecords(acceptancePath, runDirRef, normalizedAcceptance);
    const liveAcceptance = validateCuNextLiveAcceptanceTaskEvidence({
      taskId,
      evidence: normalizedAcceptance,
      taskMappings: [mapping],
      refRecords,
    });
    if (!liveAcceptance.ok) issues.push(...liveAcceptance.issues.map(formatLiveAcceptanceIssue(acceptanceManifestRef)));

    const completionEvidenceRef = stringValue(normalizedAcceptance.completionEvidenceRef);
    const rawCompletionEvidenceData = completionEvidenceRef
      ? await readLiveAcceptanceLocalJsonRef(acceptancePath, runDirRef, completionEvidenceRef)
      : undefined;
    const completionEvidenceData = rawCompletionEvidenceData
      ? normalizeCurrentRunBundleRefValue(rawCompletionEvidenceData, runDirRef) as Record<string, unknown>
      : undefined;
    issues.push(...cuNextCompletionGradeEvidenceIssues(
      normalizedAcceptance,
      mapping,
      completionEvidenceData,
      {
        refScopeDescription: 'the current chat Computer Use evidence bundle',
        refExists: (ref) => liveAcceptanceRegularRefExistsSync(acceptancePath, runDirRef, ref),
      },
    ).map((issue) => `${acceptanceManifestRef} completion-grade: ${issue}`));
  }

  const missingRefs = await missingLiveAcceptanceFileRefs(acceptancePath, runDirRef, normalizedAcceptance);
  for (const ref of missingRefs) {
    issues.push(`${acceptanceManifestRef} live acceptance missing-ref: required evidence ref ${ref} was not found in the current run bundle.`);
  }
  return {
    status: issues.length ? 'invalid' : 'valid',
    taskId,
    runDirRef,
    acceptanceManifestRef,
    completionEvidenceRef: stringValue(normalizedAcceptance.completionEvidenceRef),
    issues,
    missingRefs,
  };
}

function currentRunDirRef(refs: string[]) {
  const ref = refs.find((candidate) => /(?:^|\/)(?:cu-user-acceptance-manifest|primitive-trace|vision-trace)\.json$/i.test(candidate));
  if (!ref || !isLocalFileEvidenceRef(ref)) return undefined;
  return ref.replace(/\/[^/]+$/, '');
}

async function readBundleJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function readLiveAcceptanceLocalJsonRef(acceptancePath: string, runDirRef: string, ref: string | undefined) {
  const path = await liveAcceptanceRegularRefPath(acceptancePath, runDirRef, ref);
  if (!path) return undefined;
  return readBundleJson(path);
}

async function readLiveAcceptanceRefRecords(acceptancePath: string, runDirRef: string, manifest: Record<string, unknown>) {
  const entries: Array<[string, unknown]> = [];
  for (const ref of collectLiveAcceptanceFileRefs(manifest)) {
    if (!/\.json$/i.test(ref)) continue;
    const record = await readLiveAcceptanceLocalJsonRef(acceptancePath, runDirRef, ref);
    if (record) entries.push([ref, record]);
  }
  return Object.fromEntries(entries);
}

async function missingLiveAcceptanceFileRefs(acceptancePath: string, runDirRef: string, manifest: Record<string, unknown>) {
  const refs = collectLiveAcceptanceFileRefs(manifest);
  const missing: string[] = [];
  for (const ref of refs) {
    if (!(await liveAcceptanceRegularRefExists(acceptancePath, runDirRef, ref))) missing.push(ref);
  }
  return missing;
}

async function liveAcceptanceRegularRefExists(acceptancePath: string, runDirRef: string, ref: string) {
  return (await liveAcceptanceRegularRefPath(acceptancePath, runDirRef, ref)) !== undefined;
}

function liveAcceptanceRegularRefExistsSync(acceptancePath: string, runDirRef: string, ref: string) {
  const localRef = normalizeCurrentRunBundleRef(ref, runDirRef);
  if (!isLocalFileEvidenceRef(localRef)) return false;
  if (isNormalizedCrossBundleRef(localRef)) return false;
  const baseDir = dirname(resolve(acceptancePath));
  const target = resolve(baseDir, localRef);
  try {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const baseReal = realpathSync(baseDir);
    const targetReal = realpathSync(target);
    return isPathInsideOrSame(baseReal, targetReal);
  } catch {
    return false;
  }
}

async function liveAcceptanceRegularRefPath(acceptancePath: string, runDirRef: string, ref: string | undefined) {
  const localRef = ref ? normalizeCurrentRunBundleRef(ref, runDirRef) : undefined;
  if (!localRef || !isLocalFileEvidenceRef(localRef)) return undefined;
  if (isNormalizedCrossBundleRef(localRef)) return undefined;
  const baseDir = dirname(resolve(acceptancePath));
  const target = resolve(baseDir, localRef);
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    const baseReal = await realpath(baseDir);
    const targetReal = await realpath(target);
    if (!isPathInsideOrSame(baseReal, targetReal)) return undefined;
    return target;
  } catch {
    return undefined;
  }
}

function normalizeCurrentRunBundleRefs(value: Record<string, unknown>, runDirRef: string): Record<string, unknown> {
  return normalizeCurrentRunBundleRefValue(value, runDirRef) as Record<string, unknown>;
}

function normalizeCurrentRunBundleRefValue(value: unknown, runDirRef: string): unknown {
  if (typeof value === 'string') return normalizeCurrentRunBundleRef(value, runDirRef);
  if (Array.isArray(value)) return value.map((item) => normalizeCurrentRunBundleRefValue(item, runDirRef));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeCurrentRunBundleRefValue(child, runDirRef)]),
  );
}

function normalizeCurrentRunBundleRef(ref: string, runDirRef: string): string {
  const normalized = ref.replace(/\\/g, '/').replace(/^\.\//, '');
  const normalizedRunDir = runDirRef.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (normalized === normalizedRunDir) return '.';
  if (normalized.startsWith(`${normalizedRunDir}/`)) return normalized.slice(normalizedRunDir.length + 1);
  return ref;
}

function collectLiveAcceptanceFileRefs(manifest: Record<string, unknown>) {
  const appWorkflow = recordValue(manifest.appWorkflow);
  const screenshotRefs = recordValue(manifest.screenshotRefs);
  const executorLease = recordValue(manifest.executorLease);
  const verifierVerdict = recordValue(manifest.verifierVerdict);
  const guiPresent = recordValue(manifest.guiPresent);
  const refs = [
    ...stringArray(appWorkflow.windowSwitchTraceRefs),
    ...stringArray(screenshotRefs.before),
    ...stringArray(screenshotRefs.after),
    ...stringArray(manifest.focusCropRefs),
    ...stringArray(manifest.groundingDiagnosticsRefs),
    stringValue(executorLease.ref),
    stringValue(manifest.finalArtifactRef),
    stringValue(manifest.finalVisibleScreenshotRef),
    stringValue(verifierVerdict.ref),
    stringValue(guiPresent.recordRef),
    stringValue(guiPresent.payloadRef),
    stringValue(manifest.replayRef),
    stringValue(manifest.evidenceLedgerRef),
    stringValue(manifest.completionEvidenceRef),
    ...stringArray(guiPresent.displayedRefs),
    ...records(manifest.mutatingActions).flatMap(actionFileRefs),
    ...records(manifest.actionCausality).flatMap(actionFileRefs),
    ...records(manifest.evidenceLedgerActions).flatMap(actionFileRefs),
    ...records(recordValue(manifest.evidenceLedger).actions).flatMap(actionFileRefs),
    ...records(manifest.tuiHostChain).flatMap((link) => [
      stringValue(link.requestRef),
      stringValue(link.hostPortsRef),
      stringValue(link.toolPayloadRef),
      stringValue(link.recordRef),
    ]),
    ...records(manifest.evidenceClaims).flatMap((claim) => [
      stringValue(claim.ref),
      ...stringArray(claim.refs),
      ...stringArray(claim.recordRefs),
      ...stringArray(claim.evidenceRefs),
      ...stringArray(claim.artifactRefs),
    ]),
    ...records(manifest.evidenceMarkers).flatMap(markerFileRefs),
  ];
  return uniqueStrings(refs.filter((ref): ref is string => Boolean(ref)));
}

function actionFileRefs(action: Record<string, unknown>) {
  return [
    stringValue(action.inputIntentRef),
    stringValue(action.intentRef),
    stringValue(action.providerAdapterRef),
    stringValue(action.adapterRef),
    stringValue(action.executorAdapterRef),
    stringValue(action.actionAdapterRef),
    stringValue(action.executorEventRef),
    stringValue(action.beforeFrameRef),
    stringValue(action.afterFrameRef),
    stringValue(action.beforeAfterFrameRef),
    stringValue(action.beforeScreenshotRef),
    stringValue(action.afterScreenshotRef),
    stringValue(action.currentScreenshotRef),
    stringValue(action.currentAppStateRef),
    stringValue(action.stateSnapshotRef),
    stringValue(action.freshnessCheckRef),
    stringValue(action.verifierRef),
    stringValue(action.verificationRef),
    stringValue(action.verifierVerdictRef),
    stringValue(action.artifactRef),
    stringValue(action.finalArtifactRef),
    stringValue(action.blockedReasonRef),
    stringValue(action.permissionHandoffRef),
    stringValue(action.observeOnlyRef),
    stringValue(action.guiPresentRef),
    ...stringArray(action.beforeFrameRefs),
    ...stringArray(action.afterFrameRefs),
    ...stringArray(action.beforeEvidenceRefs),
    ...stringArray(action.afterEvidenceRefs),
    ...stringArray(action.groundingRefs),
    ...stringArray(action.verificationRefs),
    ...stringArray(action.artifactRefs),
    ...stringArray(action.outputArtifactRefs),
    ...stringArray(action.blockedReasonRefs),
    ...stringArray(action.blockedEvidenceRefs),
  ].filter((ref): ref is string => typeof ref === 'string' && isPotentialEvidenceRef(ref));
}

function markerFileRefs(marker: Record<string, unknown>) {
  return Object.values(marker).flatMap((value) => {
    if (typeof value === 'string') return isPotentialEvidenceRef(value) ? [value] : [];
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && isPotentialEvidenceRef(item));
    return [];
  });
}

function formatLiveAcceptanceIssue(acceptanceManifestRef: string) {
  return (issue: CuNextLiveAcceptanceIssue) => (
    `${acceptanceManifestRef} live acceptance ${issue.id}${issue.path ? ` at ${issue.path}` : ''}: ${issue.reason}`
  );
}

function isLocalFileEvidenceRef(ref: string) {
  return Boolean(ref)
    && !ref.startsWith('/')
    && !/^[a-z][a-z0-9+.-]*:/i.test(ref)
    && !ref.split('/').includes('..');
}

function isPotentialEvidenceRef(value: string) {
  return /\/|\.json$|\.png$|\.csv$|\.md$|\.txt$|\.docx$|\.pptx$|\.xlsx$/i.test(value);
}

function isNormalizedCrossBundleRef(ref: string) {
  return /^\.?sciforge\/vision-runs\//i.test(ref.replace(/\\/g, '/').replace(/^\.\//, ''));
}

function isPathInsideOrSame(base: string, target: string) {
  return target === base || target.startsWith(`${base}/`);
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
