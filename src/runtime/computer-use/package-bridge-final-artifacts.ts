import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { isRecord } from '../gateway-utils.js';
import { isFinalArtifactEvidenceRef } from './package-bridge-evidence.js';
import type { ScreenshotRef } from './types.js';
import { sanitizeId, workspaceRel } from './utils.js';
import type { VirtualRemoteVisibleArtifact } from './virtual-remote-session.js';

type FinalArtifactPromotionState = {
  runDir: string;
  visibleArtifacts: VirtualRemoteVisibleArtifact[];
};

type GenericArtifactFormat =
  | 'pptx'
  | 'docx'
  | 'csv'
  | 'markdown'
  | 'report'
  | 'image'
  | 'spreadsheet'
  | 'json'
  | 'text'
  | 'file';

type FinalArtifactDescriptor = {
  ref: string;
  artifactValidationRef?: string;
  validator?: string;
  format?: string;
  sha256?: string;
  bytes?: number;
  sourceRefs: string[];
  contentRefs: string[];
  savedByActionIndex?: number;
  savedByActionId?: string;
  savedByActionRef?: string;
  verifierVerdictRef?: string;
  metadata: Record<string, unknown>;
};

type GenericArtifactValidationEvidence = {
  artifactValidationRef: string;
  validator: string;
  format: GenericArtifactFormat | string;
  sha256: string;
  bytes: number;
  sourceRefs: string[];
  contentRefs: string[];
  savedByActionIndex?: number;
  savedByActionId?: string;
  savedByActionRef?: string;
  verifierVerdictRef?: string;
  metadata: Record<string, unknown>;
};

const MAX_GENERIC_ARTIFACT_VALIDATION_BYTES = 16 * 1024 * 1024;

export interface CurrentRunFinalArtifactRefValidation {
  ref: string;
  normalizedRef?: string;
  reason?: string;
}

export type FinalVisibleArtifactSelectionOptions = {
  requireSaved?: boolean;
};

export function finalVisibleArtifactForTrace(
  artifacts: VirtualRemoteVisibleArtifact[],
  options: FinalVisibleArtifactSelectionOptions = {},
) {
  const candidates = finalVisibleArtifactCandidates(artifacts, options);
  return candidates.find((artifact) => artifact.kind !== 'virtual-file-index')
    ?? candidates[0];
}

export function finalArtifactRefsForTrace(
  artifacts: VirtualRemoteVisibleArtifact[],
  options: FinalVisibleArtifactSelectionOptions = {},
) {
  const candidates = finalVisibleArtifactCandidates(artifacts, options);
  const preferred = candidates.filter((artifact) => artifact.kind !== 'virtual-file-index');
  return uniqueStrings((preferred.length ? preferred : candidates).map((artifact) => artifact.artifactRef));
}

export function promotePackageResultFinalArtifactRefs(
  packageResult: Record<string, unknown>,
  workspace: string,
  state: FinalArtifactPromotionState,
) {
  const promotedDescriptors = promotedCurrentRunFinalArtifactDescriptors(packageResult, workspace, state.runDir);
  const newArtifacts = promotedDescriptors
    .map((descriptor) => visibleArtifactFromFinalArtifactRef(
      descriptor.ref,
      materializeGenericArtifactValidation(workspace, descriptor),
    ));
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

function promotedCurrentRunFinalArtifactDescriptors(
  packageResult: Record<string, unknown>,
  workspace: string,
  runDir: string,
): FinalArtifactDescriptor[] {
  const byRef = new Map<string, FinalArtifactDescriptor>();
  for (const descriptor of collectVerifiedFinalArtifactDescriptors(packageResult)) {
    const normalizedRef = currentRunFinalArtifactRefValidation(descriptor.ref, workspace, runDir).normalizedRef;
    if (!normalizedRef) continue;
    const normalizedDescriptor = { ...descriptor, ref: normalizedRef };
    byRef.set(
      normalizedRef,
      byRef.has(normalizedRef)
        ? mergeFinalArtifactDescriptors(byRef.get(normalizedRef) as FinalArtifactDescriptor, normalizedDescriptor)
        : normalizedDescriptor,
    );
  }
  return [...byRef.values()];
}

function collectVerifiedFinalArtifactDescriptors(packageResult: Record<string, unknown>): FinalArtifactDescriptor[] {
  if (stringAt(packageResult, 'status') !== 'completed') return [];
  return recordList(packageResult.steps).flatMap((step, index) => {
    if (stringAt(step, 'status') !== 'done') return [];
    const verification = recordAt(step, 'verification');
    if (!verification || verification.ok === false || verification.done !== true) return [];
    const metadata = recordAt(verification, 'metadata');
    const context = mergeDescriptorContexts(
      descriptorContextFromPackageStep(step, index),
      descriptorContextFromRecord(verification),
      descriptorContextFromRecord(metadata),
      { metadata: { packageStepIndex: index } },
    );
    return [
      ...descriptorsFromExplicitFinalArtifactFields(verification, context),
      ...descriptorsFromExplicitFinalArtifactFields(metadata, context),
    ];
  });
}

function finalVisibleArtifactCandidates(
  artifacts: VirtualRemoteVisibleArtifact[],
  options: FinalVisibleArtifactSelectionOptions,
) {
  const reversed = [...artifacts].reverse();
  const saved = reversed.filter((artifact) => (
    artifact.status === 'visible-and-saved' && isPackageBridgeFinalArtifactRef(artifact.artifactRef)
  ));
  if (options.requireSaved) return saved;
  const draftVisible = reversed.filter((artifact) => (
    artifact.status === 'draft-visible' && isPackageBridgeFinalArtifactRef(artifact.artifactRef)
  ));
  return [...saved, ...draftVisible];
}

function descriptorsFromExplicitFinalArtifactFields(
  value: unknown,
  context: Partial<FinalArtifactDescriptor> = {},
): FinalArtifactDescriptor[] {
  if (!isRecord(value)) return [];
  const nextContext = mergeDescriptorContexts(context, descriptorContextFromRecord(value));
  return [
    ...descriptorsInsideFinalArtifactValue(value.finalArtifactRefs, nextContext),
    ...descriptorsInsideFinalArtifactValue(value.finalArtifactRef, nextContext),
  ];
}

function descriptorsInsideFinalArtifactValue(
  value: unknown,
  context: Partial<FinalArtifactDescriptor> = {},
): FinalArtifactDescriptor[] {
  if (typeof value === 'string') return [finalArtifactDescriptor(value, context)];
  if (Array.isArray(value)) return value.flatMap((item) => descriptorsInsideFinalArtifactValue(item, context));
  if (!isRecord(value)) return [];
  const nextContext = mergeDescriptorContexts(context, descriptorContextFromRecord(value));
  const ref = [
    stringAt(value, 'artifactRef'),
    stringAt(value, 'artifact_ref'),
    stringAt(value, 'dataRef'),
    stringAt(value, 'data_ref'),
    stringAt(value, 'outputRef'),
    stringAt(value, 'output_ref'),
    stringAt(value, 'path'),
    stringAt(value, 'ref'),
  ].find((candidate): candidate is string => Boolean(candidate));
  const nested = [
    ...descriptorsInsideFinalArtifactValue(value.finalArtifactRefs, nextContext),
    ...descriptorsInsideFinalArtifactValue(value.finalArtifactRef, nextContext),
  ];
  return ref ? [finalArtifactDescriptor(ref, nextContext), ...nested] : nested;
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
  ].filter((ref): ref is string => Boolean(ref)));
}

function isPseudoFinalArtifactRef(ref: string) {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref)
    || /^EU-/i.test(ref)
    || ref.includes('\0')
    || ref.startsWith('~')
    || ref.includes('?')
    || !isPackageBridgeFinalArtifactRef(ref);
}

function isPathInsideOrSame(base: string, target: string) {
  return target === base || target.startsWith(`${base}/`);
}

function isControlFinalArtifactRef(ref: string) {
  const name = ref.split(/[\\/]/).pop() ?? ref;
  if (/^(vision-trace|host-ports|tool-payload|gui-present|gui-ask-user|approval-request|approval-source-request|approval-source-gui-ask-user|approval-source-risk-audit|approval-decision|risk-audit|confirmed-request|blocked-manifest|repair-hint|continuation-request|directory-listing|tui-host-run-task-chain|computer-use-request|gateway-request|request|independent-input-adapter|virtual-remote-session|action-ledger|failure-diagnostics|cu-user-acceptance|cu-l3-independent-input-verifier)\.json$/i.test(name)) {
    return true;
  }
  return /\.json$/i.test(name) && /(^|[-_])(manifest|validator|validation|verifier)([-_.]|$)/i.test(name);
}

function visibleArtifactFromFinalArtifactRef(
  ref: string,
  validation?: GenericArtifactValidationEvidence,
): VirtualRemoteVisibleArtifact {
  const name = ref.split(/[\\/]/).pop() || 'final-artifact';
  const now = new Date().toISOString();
  const artifactRefs = uniqueStrings([
    ref,
    validation?.artifactValidationRef,
  ].filter((value): value is string => Boolean(value)));
  const sourceActionIds = uniqueStrings([
    validation?.savedByActionId,
    'package-result-final-artifact',
  ].filter((value): value is string => Boolean(value)));
  return {
    schemaVersion: 'sciforge.computer-use.virtual-remote-artifact.v1',
    id: `package-final-${sanitizeId(ref)}`,
    kind: artifactKindForFormat(validation?.format),
    title: name,
    artifactRef: ref,
    path: ref,
    dataRef: ref,
    appId: 'computer-use-package-bridge',
    delivery: 'virtual-remote-session-artifact',
    status: 'visible-and-saved',
    visibleTexts: [],
    sourceActionIds,
    createdAt: now,
    updatedAt: now,
    ...(validation ? {
      artifactRefs,
      contentRefs: validation.contentRefs,
      sourceRefs: validation.sourceRefs,
      artifactValidationRef: validation.artifactValidationRef,
      validator: validation.validator,
      format: validation.format,
      sha256: validation.sha256,
      bytes: validation.bytes,
      savedByActionIndex: validation.savedByActionIndex,
      savedByActionId: validation.savedByActionId,
      savedByActionRef: validation.savedByActionRef,
      verifierVerdictRef: validation.verifierVerdictRef,
      currentRunCausality: true,
      diagnosticOnly: true,
      productAcceptanceEvidence: false,
      metadata: {
        ...validation.metadata,
        artifactValidationRef: validation.artifactValidationRef,
        validator: validation.validator,
        format: validation.format,
        sha256: validation.sha256,
        bytes: validation.bytes,
        contentRefs: validation.contentRefs,
        sourceRefs: validation.sourceRefs,
        savedByActionIndex: validation.savedByActionIndex,
        savedByActionId: validation.savedByActionId,
        savedByActionRef: validation.savedByActionRef,
        verifierVerdictRef: validation.verifierVerdictRef,
        artifactRefs,
        currentRunCausality: true,
        diagnosticOnly: true,
        productAcceptanceEvidence: false,
      },
    } : {}),
  } as VirtualRemoteVisibleArtifact;
}

function finalArtifactDescriptor(ref: string, context: Partial<FinalArtifactDescriptor>): FinalArtifactDescriptor {
  return {
    ref,
    artifactValidationRef: context.artifactValidationRef,
    validator: context.validator,
    format: context.format,
    sha256: context.sha256,
    bytes: context.bytes,
    sourceRefs: context.sourceRefs ?? [],
    contentRefs: context.contentRefs ?? [],
    savedByActionIndex: context.savedByActionIndex,
    savedByActionId: context.savedByActionId,
    savedByActionRef: context.savedByActionRef,
    verifierVerdictRef: context.verifierVerdictRef,
    metadata: context.metadata ?? {},
  };
}

function descriptorContextFromRecord(value: unknown): Partial<FinalArtifactDescriptor> {
  if (!isRecord(value)) return {};
  const metadata = recordAt(value, 'metadata');
  const nested = metadata ? descriptorContextFromRecord(metadata) : {};
  return mergeDescriptorContexts(nested, {
    artifactValidationRef: firstString(value, ['artifactValidationRef', 'validationRef', 'formatValidationRef']),
    validator: firstString(value, ['validator', 'formatValidator', 'artifactValidator']),
    format: firstString(value, ['format', 'artifactFormat', 'mimeType', 'contentType']),
    sha256: firstString(value, ['sha256', 'contentSha256', 'artifactSha256']),
    bytes: numberAtKeys(value, ['bytes', 'size', 'contentBytes']),
    sourceRefs: refsFromKeys(value, ['sourceRefs', 'sourceRef', 'inputRefs', 'inputRef', 'citationRefs', 'citationRef']),
    contentRefs: refsFromKeys(value, ['contentRefs', 'contentRef', 'artifactRefs', 'artifactRef']),
    savedByActionIndex: numberAtKeys(value, ['savedByActionIndex', 'saveActionIndex', 'actionIndex']),
    savedByActionId: firstString(value, ['savedByActionId', 'saveActionId', 'sourceActionId']),
    savedByActionRef: firstString(value, ['savedByActionRef', 'saveActionRef', 'savedByCommandEventRef']),
    verifierVerdictRef: firstString(value, ['verifierVerdictRef', 'verificationRef', 'verifierRef', 'ref']),
    metadata: knownArtifactMetadata(value),
  });
}

function descriptorContextFromPackageStep(
  step: Record<string, unknown>,
  packageStepIndex: number,
): Partial<FinalArtifactDescriptor> {
  const verification = recordAt(step, 'verification');
  const metadata = recordAt(verification, 'metadata');
  return {
    savedByActionIndex: packageStepIndex,
    sourceRefs: uniqueStrings([
      ...refsFromKeys(step, ['beforeRef', 'afterRef', 'observationRef', 'finalObservationRef']),
      ...refsFromKeys(verification, ['beforeRef', 'afterRef', 'sourceRefs', 'inputRefs', 'evidenceRefs']),
      ...refsFromKeys(metadata, [
        'beforeScreenshotRefs',
        'afterScreenshotRefs',
        'currentScreenshotRef',
        'finalVisibleScreenshotRef',
        'sourceRefs',
        'inputRefs',
        'evidenceRefs',
      ]),
    ]),
  };
}

function keepCurrentRunRefs(refs: string[], runDirRef: string | undefined) {
  if (!runDirRef) return [];
  const normalizedRunDir = runDirRef.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  return uniqueStrings(refs.filter((ref) => {
    const normalized = ref.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    return normalized.startsWith(`${normalizedRunDir}/`)
      && !normalized.split('/').includes('..')
      && !/^[a-z][a-z0-9+.-]*:/i.test(normalized);
  }));
}

function mergeDescriptorContexts(
  ...contexts: Array<Partial<FinalArtifactDescriptor> | undefined>
): Partial<FinalArtifactDescriptor> {
  return contexts.reduce<Partial<FinalArtifactDescriptor>>((merged, context) => {
    if (!context) return merged;
    return {
      ...merged,
      ...definedRecord(context),
      sourceRefs: uniqueStrings([...(merged.sourceRefs ?? []), ...(context.sourceRefs ?? [])]),
      contentRefs: uniqueStrings([...(merged.contentRefs ?? []), ...(context.contentRefs ?? [])]),
      metadata: {
        ...(merged.metadata ?? {}),
        ...(context.metadata ?? {}),
      },
    };
  }, {});
}

function mergeFinalArtifactDescriptors(
  left: FinalArtifactDescriptor,
  right: FinalArtifactDescriptor,
): FinalArtifactDescriptor {
  return finalArtifactDescriptor(left.ref, mergeDescriptorContexts(left, right));
}

function materializeGenericArtifactValidation(
  workspace: string,
  descriptor: FinalArtifactDescriptor,
): GenericArtifactValidationEvidence | undefined {
  const artifactPath = resolve(workspace, descriptor.ref);
  try {
    const info = lstatSync(artifactPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_GENERIC_ARTIFACT_VALIDATION_BYTES) {
      return undefined;
    }
    const bytes = readFileSync(artifactPath);
    const sha256 = validSha256(descriptor.sha256) ? descriptor.sha256 as string : sha256Hex(bytes);
    const format = inferredArtifactFormat(descriptor.ref, bytes, descriptor.format);
    const validator = descriptor.validator || `sciforge-generic-${format}-artifact-contract-validator`;
    const artifactValidationRef = `${descriptor.ref}.validation.json`;
    const contentRefs = uniqueStrings([descriptor.ref, ...descriptor.contentRefs]);
    const runDirRef = descriptor.ref.replace(/\/[^/]+$/, '');
    const sourceRefs = keepCurrentRunRefs(descriptor.sourceRefs, runDirRef);
    if (sourceRefs.length === 0) return undefined;
    const verifierVerdictRef = keepCurrentRunRefs(
      descriptor.verifierVerdictRef ? [descriptor.verifierVerdictRef] : [],
      runDirRef,
    )[0] ?? `${descriptor.ref}.verifier-verdict.json`;
    const metadata = {
      ...descriptor.metadata,
      validatorScope: 'contract-level',
      productAcceptanceEvidence: false,
      deepBinaryParse: false,
      generatedBy: 'computer-use-package-bridge-final-artifacts',
    };
    if (!descriptor.verifierVerdictRef || descriptor.verifierVerdictRef !== verifierVerdictRef) {
      const verifierVerdictPath = resolve(workspace, verifierVerdictRef);
      mkdirSync(dirname(verifierVerdictPath), { recursive: true });
      writeFileSync(verifierVerdictPath, `${JSON.stringify({
        schemaVersion: 'sciforge.computer-use.package-artifact-verifier-verdict.v1',
        status: 'passed',
        diagnosticOnly: true,
        productAcceptanceEvidence: false,
        verifierVerdictRef,
        finalArtifactRef: descriptor.ref,
        artifactRef: descriptor.ref,
        contentRefs,
        sourceRefs,
        savedByActionIndex: descriptor.savedByActionIndex,
        savedByActionId: descriptor.savedByActionId,
        savedByActionRef: descriptor.savedByActionRef,
        currentRunCausality: true,
        metadata,
      }, null, 2)}\n`, 'utf8');
    }
    const validation = {
      schemaVersion: 'sciforge.computer-use.generic-artifact-validation.v1',
      status: 'passed',
      diagnosticOnly: true,
      productAcceptanceEvidence: false,
      artifactValidationRef,
      finalArtifactRef: descriptor.ref,
      artifactRef: descriptor.ref,
      contentRefs,
      sourceRefs,
      format,
      validator,
      sha256,
      bytes: bytes.byteLength,
      savedByActionIndex: descriptor.savedByActionIndex,
      savedByActionId: descriptor.savedByActionId,
      savedByActionRef: descriptor.savedByActionRef,
      verifierVerdictRef,
      currentRunCausality: true,
      checks: {
        currentRunRegularFile: true,
        contractLevelFormat: true,
        hashRecorded: true,
        metadataRecorded: true,
      },
      metadata,
    };
    const validationPath = resolve(workspace, artifactValidationRef);
    mkdirSync(dirname(validationPath), { recursive: true });
    writeFileSync(validationPath, `${JSON.stringify(validation, null, 2)}\n`, 'utf8');
    return {
      artifactValidationRef,
      validator,
      format,
      sha256,
      bytes: bytes.byteLength,
      sourceRefs,
      contentRefs,
      savedByActionIndex: descriptor.savedByActionIndex,
      savedByActionId: descriptor.savedByActionId,
      savedByActionRef: descriptor.savedByActionRef,
      verifierVerdictRef,
      metadata,
    };
  } catch {
    return undefined;
  }
}

function inferredArtifactFormat(ref: string, bytes?: Buffer, explicit?: string): GenericArtifactFormat | string {
  const normalized = normalizeFormatToken(explicit);
  if (normalized) return normalized;
  return artifactFormatForRef(ref, bytes) ?? 'file';
}

function artifactFormatForRef(ref: string, bytes?: Buffer): GenericArtifactFormat | undefined {
  const path = ref.split(/[?#]/, 1)[0].toLowerCase();
  const name = path.split('/').pop() ?? path;
  if (/\.pptx$/.test(path)) return 'pptx';
  if (/\.docx$/.test(path)) return 'docx';
  if (/\.(csv|tsv)$/.test(path)) return 'csv';
  if (/\.(md|markdown)$/.test(path)) return 'markdown';
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/.test(path)) return 'image';
  if (/\.(pdf|html?|rtf)$/.test(path)) return 'report';
  if (/report|summary|brief|briefing/.test(name) && /\.(txt|text)$/.test(path)) return 'report';
  if (/\.(xlsx|ods)$/.test(path)) return 'spreadsheet';
  if (/\.json$/.test(path) && !isControlFinalArtifactRef(path)) return 'json';
  if (/\.(txt|text)$/.test(path)) return 'text';
  if (bytes && looksLikeImageBytes(bytes)) return 'image';
  if (bytes && looksLikeZipOfficeBytes(bytes) && /deck|slides?|presentation/.test(name)) return 'pptx';
  if (bytes && looksLikeZipOfficeBytes(bytes)) return 'docx';
  return undefined;
}

function isPackageBridgeFinalArtifactRef(ref: string) {
  return isFinalArtifactEvidenceRef(ref) || artifactFormatForRef(ref) !== undefined;
}

function artifactKindForFormat(format: string | undefined): VirtualRemoteVisibleArtifact['kind'] {
  return format === 'pptx' ? 'virtual-slide-deck' : 'virtual-document';
}

function looksLikeImageBytes(bytes: Buffer) {
  return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
    || bytes.subarray(0, 4).toString('ascii') === 'RIFF';
}

function looksLikeZipOfficeBytes(bytes: Buffer) {
  return bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

function normalizeFormatToken(value: string | undefined) {
  if (!value) return undefined;
  const token = value.toLowerCase().replace(/^[./]+/, '').replace(/[^a-z0-9]+/g, '-');
  if (!token) return undefined;
  if (token.includes('presentation') || token.includes('powerpoint') || token.includes('pptx')) return 'pptx';
  if (token.includes('word') || token.includes('docx')) return 'docx';
  if (token.includes('csv') || token.includes('tsv')) return 'csv';
  if (token.includes('markdown') || token === 'md') return 'markdown';
  if (token.includes('image') || token.includes('png') || token.includes('jpeg') || token.includes('webp')) return 'image';
  if (token.includes('report') || token.includes('pdf') || token.includes('html')) return 'report';
  return token;
}

function sha256Hex(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function validSha256(value: string | undefined) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

function firstString(value: unknown, keys: string[]) {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const item = stringAt(value, key);
    if (item) return item;
  }
  return undefined;
}

function refsFromKeys(value: unknown, keys: string[]) {
  if (!isRecord(value)) return [];
  return uniqueStrings(keys.flatMap((key) => refsInsideFinalArtifactValue(value[key])));
}

function numberAtKeys(value: unknown, keys: string[]) {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const item = numberAt(value[key]);
    if (item !== undefined) return item;
  }
  return undefined;
}

function numberAt(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function knownArtifactMetadata(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([key, child]) => (
    /^(?:format|artifactFormat|mimeType|contentType|savedBy|saveAction|sourceRefs|contentRefs|sha256|bytes|validator|artifactValidationRef|verifierVerdictRef)$/i.test(key)
    && child !== undefined
  )));
}

function definedRecord<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, child]) => child !== undefined)) as Partial<T>;
}

function mergeVisibleArtifacts(
  existing: VirtualRemoteVisibleArtifact[],
  next: VirtualRemoteVisibleArtifact[],
) {
  const merged = new Map(existing.map((artifact) => [artifact.artifactRef, artifact]));
  for (const artifact of next) {
    const current = merged.get(artifact.artifactRef);
    merged.set(artifact.artifactRef, current ? mergeVisibleArtifactEvidence(current, artifact) : artifact);
  }
  return [...merged.values()];
}

function mergeVisibleArtifactEvidence(
  current: VirtualRemoteVisibleArtifact,
  next: VirtualRemoteVisibleArtifact,
): VirtualRemoteVisibleArtifact {
  const currentRecord = current as VirtualRemoteVisibleArtifact & Record<string, unknown>;
  const nextRecord = next as VirtualRemoteVisibleArtifact & Record<string, unknown>;
  const runDirRef = next.artifactRef.replace(/\/[^/]+$/, '');
  const sourceRefs = keepCurrentRunRefs([
    ...refsFromKeys(currentRecord, ['sourceRefs', 'inputRefs', 'citationRefs']),
    ...refsFromKeys(nextRecord, ['sourceRefs', 'inputRefs', 'citationRefs']),
  ], runDirRef);
  const artifactRefs = uniqueStrings([
    ...keepCurrentRunRefs([
      ...refsFromKeys(currentRecord, ['artifactRefs']),
      ...refsFromKeys(nextRecord, ['artifactRefs']),
    ], runDirRef),
    next.artifactRef,
  ]);
  const contentRefs = uniqueStrings([
    ...keepCurrentRunRefs([
      ...refsFromKeys(currentRecord, ['contentRefs']),
      ...refsFromKeys(nextRecord, ['contentRefs']),
    ], runDirRef),
    next.artifactRef,
  ]);
  const metadata = {
    ...(recordAt(currentRecord, 'metadata') ?? {}),
    ...(recordAt(nextRecord, 'metadata') ?? {}),
    artifactRefs,
    sourceRefs,
    contentRefs,
  };
  return {
    ...currentRecord,
    ...nextRecord,
    status: current.status === 'visible-and-saved' || next.status === 'visible-and-saved'
      ? 'visible-and-saved'
      : current.status,
    visibleTexts: uniqueStrings([...current.visibleTexts, ...next.visibleTexts]),
    sourceActionIds: uniqueStrings([...current.sourceActionIds, ...next.sourceActionIds]),
    updatedAt: next.updatedAt,
    artifactRefs,
    contentRefs,
    sourceRefs,
    metadata,
  } as VirtualRemoteVisibleArtifact;
}

function stringAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const raw = value[key];
  return typeof raw === 'string' ? raw : undefined;
}

function recordAt(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return isRecord(item) ? item : undefined;
}

function recordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}
