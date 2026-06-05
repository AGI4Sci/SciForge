#!/usr/bin/env node
import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { readFile, writeFile, mkdir, stat, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  modelRouterComputerUseLiveAcceptanceCases,
  requiredModelRouterComputerUseLiveAcceptanceCategories,
  type ModelRouterComputerUseLiveAcceptanceCategory,
  type ModelRouterComputerUseLiveAcceptanceEvidenceKind,
} from './model-router-computer-use-live-acceptance-cases.js';

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION =
  'sciforge.model-router.computer-use-live-acceptance-matrix.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_DEFAULT_OUT =
  'docs/test-artifacts/model-router-computer-use-live-matrix/manifest.json' as const;

export type ModelRouterComputerUseLiveAcceptanceCaseStatus =
  | 'passed'
  | 'blocked'
  | 'missing'
  | 'not-evaluated';

export type ModelRouterComputerUseLiveAcceptanceExecutorKind =
  | 'desktop-native-host'
  | 'native-host'
  | 'app-window';

export type ModelRouterComputerUseLiveAcceptanceExecutorRefs = {
  kind: ModelRouterComputerUseLiveAcceptanceExecutorKind;
  currentRunRef?: string;
  executorRef?: string;
  appWindowRef?: string;
  sessionRef?: string;
  nativeHostRef?: string;
  refs?: string[];
};

export type ModelRouterComputerUseLiveAcceptanceEvidenceRefs = {
  screenshotRefs?: string[];
  fileRefs?: string[];
  artifactRefs?: string[];
  terminalRefs?: string[];
  verifierRefs?: string[];
  blockedRefs?: string[];
  repairRefs?: string[];
};

export type ModelRouterComputerUseLiveAcceptanceGuiRefs = {
  presentRef?: string;
  blockedRef?: string;
  repairRef?: string;
};

export type ModelRouterComputerUseLiveAcceptanceMatrixResult = {
  caseId: string;
  status: 'passed' | 'blocked' | 'not-evaluated';
  publicModelAlias?: string;
  routerProfile?: string;
  routerTraceRefs?: string[];
  capabilityIds?: string[];
  executor?: ModelRouterComputerUseLiveAcceptanceExecutorRefs;
  evidenceRefs?: ModelRouterComputerUseLiveAcceptanceEvidenceRefs;
  gui?: ModelRouterComputerUseLiveAcceptanceGuiRefs;
  issues?: string[];
};

export type ModelRouterComputerUseTraceAuditInput = {
  status: 'pass' | 'fail' | 'missing';
  schemaVersion?: string;
  reportRef?: string;
  traceRootSha256?: string;
  scannedFileRefs?: string[];
  scannedFiles?: number;
  scannedBytes?: number;
  findings?: unknown[];
  policy?: {
    knownSecretsChecked?: number;
    forbidsRawProviderPayload?: boolean;
    forbidsRawPrivateUrls?: boolean;
    forbidsLocalAbsolutePaths?: boolean;
    forbidsInlineImageData?: boolean;
  };
};

export type ModelRouterComputerUseLiveAcceptanceMatrixManifestCase = {
  id: ModelRouterComputerUseLiveAcceptanceCategory;
  category: ModelRouterComputerUseLiveAcceptanceCategory;
  title: string;
  taskShape: string;
  status: ModelRouterComputerUseLiveAcceptanceCaseStatus;
  publicModelAlias?: string;
  routerProfile?: string;
  routerTraceRefs: string[];
  capabilityIds: string[];
  requiredCapabilityIds: string[];
  executor?: {
    kind?: ModelRouterComputerUseLiveAcceptanceExecutorKind;
    currentRunRef?: string;
    executorRef?: string;
    appWindowRef?: string;
    sessionRef?: string;
    nativeHostRef?: string;
    refs: string[];
    currentRunEvidence: boolean;
  };
  requiredEvidenceKinds: ModelRouterComputerUseLiveAcceptanceEvidenceKind[];
  evidenceRefs: Required<ModelRouterComputerUseLiveAcceptanceEvidenceRefs>;
  gui: {
    status: 'present' | 'blocked' | 'repair' | 'missing';
    presentRef?: string;
    blockedRef?: string;
    repairRef?: string;
  };
  inputIssueDigests: string[];
  issues: string[];
};

export type ModelRouterComputerUseLiveAcceptanceMatrixManifest = {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION;
  checkedAt: string;
  status: 'passed' | 'blocked';
  releaseAcceptance: 'live-current-run' | 'not-evaluated';
  evidenceMode: 'live-model-router-computer-use-current-run';
  manifestRef: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_DEFAULT_OUT;
  source: {
    kind: 'builder-input' | 'input-file' | 'manifest-file' | 'no-input';
    ref?: string;
  };
  coverage: {
    requiredCategories: readonly ModelRouterComputerUseLiveAcceptanceCategory[];
    presentCategories: ModelRouterComputerUseLiveAcceptanceCategory[];
    missingCategories: ModelRouterComputerUseLiveAcceptanceCategory[];
    everyRequiredCategoryPresent: boolean;
    requiredCaseIds: ModelRouterComputerUseLiveAcceptanceCategory[];
    passedCaseIds: ModelRouterComputerUseLiveAcceptanceCategory[];
    missingCaseIds: ModelRouterComputerUseLiveAcceptanceCategory[];
    allCasesPassed: boolean;
  };
  traceAudit?: {
    status: ModelRouterComputerUseTraceAuditInput['status'];
    reportRef?: string;
    scannedFiles?: number;
  };
  cases: ModelRouterComputerUseLiveAcceptanceMatrixManifestCase[];
  unknownCaseIds: string[];
  issues: string[];
};

export type BuildModelRouterComputerUseLiveAcceptanceMatrixManifestInput = {
  checkedAt?: string;
  results?: ModelRouterComputerUseLiveAcceptanceMatrixResult[];
  source?: ModelRouterComputerUseLiveAcceptanceMatrixManifest['source'];
  sourceIssues?: string[];
  traceAudit?: ModelRouterComputerUseTraceAuditInput;
  requiredKnownSecretsChecked?: number;
};

type CliArgs = {
  inputPath?: string;
  manifestPath?: string;
  traceAuditReportPath?: string;
  expectedKnownSecretsChecked: number;
  outPath?: string;
  strict: boolean;
  json: boolean;
};

const forbiddenRawPayloadPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|api[_-]?key|secret|token|credential|password|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;
const wrappedLocalAbsoluteRefPattern =
  /(?:^|[:\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)/i;

const allowedExecutorKinds = new Set<ModelRouterComputerUseLiveAcceptanceExecutorKind>([
  'desktop-native-host',
  'native-host',
  'app-window',
]);

export function buildModelRouterComputerUseLiveAcceptanceMatrixManifest(
  input: BuildModelRouterComputerUseLiveAcceptanceMatrixManifestInput = {},
): ModelRouterComputerUseLiveAcceptanceMatrixManifest {
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const rawResults = input.results ?? [];
  const source = normalizeSource(input.source ?? (rawResults.length > 0 ? { kind: 'builder-input' } : { kind: 'no-input' }));
  const sourceIssues = [
    ...safeLabels(input.sourceIssues),
    ...sourceIssuesFor(source),
  ];
  const resultsByCase = new Map(rawResults.map((result) => [result.caseId, result]));
  const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);
  const requiredCaseIdSet = new Set<string>(requiredCaseIds);
  const unknownCaseIds = rawResults
    .map((result) => result.caseId)
    .filter((caseId) => !requiredCaseIdSet.has(caseId))
    .map((caseId) => safeLabel(caseId) ?? `unknown-case:${sha256Hex(caseId).slice(0, 12)}`);
  const duplicateCaseIssues = duplicateResultCaseIssues(rawResults);

  const cases = modelRouterComputerUseLiveAcceptanceCases.map((matrixCase) => {
    const result = resultsByCase.get(matrixCase.id);
    const normalized = normalizeResult(matrixCase.id, result);
    const inputIssueDigests = (result?.issues ?? []).map((issue) => `sha256:${sha256Hex(issue)}`);
    const issues = [
      ...caseEvidenceIssues(matrixCase, normalized, result),
      ...inputIssueDigests.map((digest) => `input-issue:${digest}`),
      ...forbiddenRawPayloadIssues(matrixCase.id, result),
    ];
    const status = caseStatus(result, issues);
    return {
      id: matrixCase.id,
      category: matrixCase.category,
      title: matrixCase.title,
      taskShape: matrixCase.taskShape,
      status,
      publicModelAlias: normalized.publicModelAlias,
      routerProfile: normalized.routerProfile,
      routerTraceRefs: normalized.routerTraceRefs,
      capabilityIds: normalized.capabilityIds,
      requiredCapabilityIds: matrixCase.requiredCapabilityIds,
      executor: normalized.executor,
      requiredEvidenceKinds: matrixCase.requiredEvidenceKinds,
      evidenceRefs: normalized.evidenceRefs,
      gui: normalized.gui,
      inputIssueDigests,
      issues,
    };
  });

  const passedCaseIds = cases
    .filter((item) => item.status === 'passed')
    .map((item) => item.id);
  const missingCaseIds = requiredCaseIds
    .filter((id) => !passedCaseIds.includes(id));
  const presentCategories = [...new Set(cases
    .filter((item) => item.status === 'passed')
    .map((item) => item.category))].sort();
  const missingCategories = requiredModelRouterComputerUseLiveAcceptanceCategories
    .filter((category) => !presentCategories.includes(category))
    .sort();
  const traceAudit = normalizeTraceAudit(input.traceAudit);
  const traceAuditIssues = traceAuditIssuesFor(
    traceAudit,
    cases,
    source,
    input.requiredKnownSecretsChecked ?? 0,
  );
  const duplicateRouterTraceIssues = duplicateRouterTraceRefIssues(cases);
  const issues = [
    ...sourceIssues,
    ...traceAuditIssues,
    ...duplicateRouterTraceIssues,
    ...missingCaseIds.map((id) => `missing-case:${id}`),
    ...missingCategories.map((category) => `missing-category:${category}`),
    ...duplicateCaseIssues,
    ...unknownCaseIds.map((caseId) => `unknown-case:${caseId}`),
    ...cases.flatMap((item) => item.issues.map((issue) => `${item.id}:${issue}`)),
  ];
  const status = issues.length === 0 ? 'passed' : 'blocked';
  const releaseAcceptance = status === 'passed' && (source.kind === 'input-file' || source.kind === 'manifest-file') && source.ref
    ? 'live-current-run'
    : 'not-evaluated';

  return {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION,
    checkedAt,
    status,
    releaseAcceptance,
    evidenceMode: 'live-model-router-computer-use-current-run',
    manifestRef: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_DEFAULT_OUT,
    source,
    coverage: {
      requiredCategories: requiredModelRouterComputerUseLiveAcceptanceCategories,
      presentCategories,
      missingCategories,
      everyRequiredCategoryPresent: missingCategories.length === 0,
      requiredCaseIds,
      passedCaseIds,
      missingCaseIds,
      allCasesPassed: missingCaseIds.length === 0,
    },
    traceAudit: publicTraceAudit(traceAudit),
    cases,
    unknownCaseIds,
    issues,
  };
}

function duplicateResultCaseIssues(results: ModelRouterComputerUseLiveAcceptanceMatrixResult[]) {
  const seen = new Set<string>();
  const duplicateCaseIds = new Set<string>();
  for (const result of results) {
    if (!result.caseId) continue;
    if (seen.has(result.caseId)) duplicateCaseIds.add(result.caseId);
    else seen.add(result.caseId);
  }
  return [...duplicateCaseIds]
    .sort()
    .map((caseId) => `duplicate-case:${safeLabel(caseId) ?? `sha256:${sha256Hex(caseId).slice(0, 12)}`}`);
}

function duplicateRouterTraceRefIssues(cases: ModelRouterComputerUseLiveAcceptanceMatrixManifestCase[]) {
  const seen = new Set<string>();
  const duplicateTraceRefs = new Set<string>();
  for (const item of cases) {
    if (item.status !== 'passed') continue;
    for (const traceRef of item.routerTraceRefs) {
      const normalized = traceJsonFileRefFromTraceRef(traceRef);
      if (!normalized) continue;
      if (seen.has(normalized)) duplicateTraceRefs.add(normalized);
      else seen.add(normalized);
    }
  }
  return [...duplicateTraceRefs]
    .sort()
    .map((traceRef) => `trace-audit-duplicate-router-trace-ref:${safeLabel(traceRef) ?? `sha256:${sha256Hex(traceRef).slice(0, 12)}`}`);
}

async function runCli(args: CliArgs) {
  const input = await inputForCli(args);
  const manifest = buildModelRouterComputerUseLiveAcceptanceMatrixManifest(input);
  if (args.outPath) {
    await mkdir(dirname(args.outPath), { recursive: true });
    await writeFile(args.outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write([
      `[${manifest.status}] Model Router Computer Use live acceptance matrix`,
      `releaseAcceptance=${manifest.releaseAcceptance}`,
      `passed=${manifest.coverage.passedCaseIds.length}/${manifest.coverage.requiredCaseIds.length}`,
      `issues=${manifest.issues.length}`,
      '',
    ].join('; '));
  }
  if (args.strict && manifest.status !== 'passed') process.exitCode = 1;
}

async function inputForCli(args: CliArgs): Promise<BuildModelRouterComputerUseLiveAcceptanceMatrixManifestInput> {
  if (args.inputPath) {
    return {
      ...(await inputFromPath(args.inputPath, 'input-file', args.traceAuditReportPath)),
      requiredKnownSecretsChecked: args.expectedKnownSecretsChecked,
    };
  }
  if (args.manifestPath) {
    return {
      ...(await inputFromPath(args.manifestPath, 'manifest-file', args.traceAuditReportPath)),
      requiredKnownSecretsChecked: args.expectedKnownSecretsChecked,
    };
  }
  return {
    source: { kind: 'no-input' },
    traceAudit: args.traceAuditReportPath ? await traceAuditFromPath(args.traceAuditReportPath) : undefined,
    requiredKnownSecretsChecked: args.expectedKnownSecretsChecked,
  };
}

async function inputFromPath(
  path: string,
  kind: 'input-file' | 'manifest-file',
  traceAuditReportPath: string | undefined,
): Promise<BuildModelRouterComputerUseLiveAcceptanceMatrixManifestInput> {
  try {
    const record = await readJson(path);
    const input = inputFromRecord(record);
    const embeddedTraceAudit = input.traceAudit;
    const sourceStats = await stat(path);
    return {
      ...input,
      source: { kind, ref: publicSourceRef(path, kind) },
      traceAudit: traceAuditReportPath ? await traceAuditFromPath(traceAuditReportPath) : undefined,
      sourceIssues: [
        ...(await evidenceFileIssues(input.results ?? [])),
        ...(await traceAuditReportFreshnessIssues(traceAuditReportPath, sourceStats.mtimeMs)),
        ...(!traceAuditReportPath && embeddedTraceAudit ? ['trace-audit-external-binding-required'] : []),
      ],
    };
  } catch {
    return {
      results: [],
      source: { kind, ref: publicSourceRef(path, kind) },
      sourceIssues: [`source-read-error:${kind}`],
    };
  }
}

async function traceAuditReportFreshnessIssues(
  traceAuditReportPath: string | undefined,
  sourceMtimeMs: number,
) {
  if (!traceAuditReportPath) return [];
  try {
    const reportStats = await stat(traceAuditReportPath);
    return reportStats.isFile() && reportStats.mtimeMs + 1000 >= sourceMtimeMs
      ? []
      : ['trace-audit-report-stale'];
  } catch {
    return ['trace-audit-report-stale'];
  }
}

async function evidenceFileIssues(results: ModelRouterComputerUseLiveAcceptanceMatrixResult[]) {
  const refs = [...new Set(results.flatMap(fileEvidenceRefsFromResult))];
  const issues: string[] = [];
  const statsByRef = new Map<string, Stats>();
  await Promise.all(refs.map(async (ref) => {
    if (!isWorkspaceFileRef(ref)) return;
    try {
      const info = await workspaceEvidenceStat(ref, issues);
      if (!info) return;
      statsByRef.set(ref, info);
      if (!info.isFile()) issues.push(`missing-evidence-ref:${sha256Hex(ref).slice(0, 16)}`);
    } catch {
      issues.push(`missing-evidence-ref:${sha256Hex(ref).slice(0, 16)}`);
    }
  }));
  for (const result of results) {
    issues.push(...staleCurrentRunEvidenceIssues(result, statsByRef));
  }
  await Promise.all(results.map(async (result) => {
    issues.push(...await currentRunMarkerFreshnessIssues(result, statsByRef));
  }));
  await Promise.all(results.map(async (result) => {
    issues.push(...await currentRunEvidenceBindingIssues(result));
  }));
  await Promise.all(results.map(async (result) => {
    issues.push(...await routerTraceSemanticIssues(result));
  }));
  return [...new Set(issues)].sort();
}

async function workspaceEvidenceStat(ref: string, issues: string[]) {
  const linkInfo = await lstat(ref);
  if (linkInfo.isSymbolicLink()) {
    issues.push(`symlink-evidence-ref:${sha256Hex(ref).slice(0, 16)}`);
    return undefined;
  }
  const real = await realpath(ref);
  const workspaceRelative = relative(process.cwd(), real);
  if (!workspaceRelative || workspaceRelative.startsWith('..') || isAbsolute(workspaceRelative)) {
    issues.push(`evidence-ref-outside-workspace:${sha256Hex(ref).slice(0, 16)}`);
    return undefined;
  }
  return stat(ref);
}

function fileEvidenceRefsFromResult(result: ModelRouterComputerUseLiveAcceptanceMatrixResult) {
  return [
    ...(result.routerTraceRefs ?? []),
    result.executor?.currentRunRef,
    result.executor?.executorRef,
    result.executor?.appWindowRef,
    result.executor?.sessionRef,
    result.executor?.nativeHostRef,
    ...(result.executor?.refs ?? []),
    ...(result.evidenceRefs?.screenshotRefs ?? []),
    ...(result.evidenceRefs?.fileRefs ?? []),
    ...(result.evidenceRefs?.artifactRefs ?? []),
    ...(result.evidenceRefs?.terminalRefs ?? []),
    ...(result.evidenceRefs?.verifierRefs ?? []),
    ...(result.evidenceRefs?.blockedRefs ?? []),
    ...(result.evidenceRefs?.repairRefs ?? []),
    result.gui?.presentRef,
    result.gui?.blockedRef,
    result.gui?.repairRef,
  ].filter((ref): ref is string => Boolean(ref));
}

function staleCurrentRunEvidenceIssues(
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult,
  statsByRef: Map<string, Stats>,
) {
  const currentRunRef = result.executor?.currentRunRef;
  if (!currentRunRef || !isWorkspaceFileRef(currentRunRef)) return [];
  const currentRunStats = statsByRef.get(currentRunRef);
  const root = currentRunRootRef(currentRunRef);
  if (!currentRunStats?.isFile() || !root) return [];

  return fileEvidenceRefsFromResult(result)
    .filter((ref) => ref !== currentRunRef && isWorkspaceFileRef(ref) && refIsUnderCurrentRunRoot(ref, root))
    .filter((ref) => {
      const info = statsByRef.get(ref);
      return info?.isFile() && info.mtimeMs + 1000 < currentRunStats.mtimeMs;
    })
    .map((ref) => `stale-evidence-ref:${sha256Hex(ref).slice(0, 16)}`);
}

async function currentRunMarkerFreshnessIssues(
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult,
  statsByRef: Map<string, Stats>,
) {
  const currentRunRef = result.executor?.currentRunRef;
  if (!currentRunRef || !isWorkspaceFileRef(currentRunRef)) return [];
  const currentRunStats = statsByRef.get(currentRunRef);
  const root = currentRunRootRef(currentRunRef);
  if (!currentRunStats?.isFile() || !root) return [];

  const marker = await currentRunMarkerWindowFromRef(currentRunRef);
  const caseId = safeLabel(result.caseId) ?? `case:${sha256Hex(result.caseId).slice(0, 12)}`;
  if (!marker) return [`current-run-marker-invalid:${caseId}`];

  const hasEvidenceOutsideMarkerWindow = fileEvidenceRefsFromResult(result)
    .filter((ref) => ref !== currentRunRef && isWorkspaceFileRef(ref) && refIsUnderCurrentRunRoot(ref, root))
    .some((ref) => {
      const info = statsByRef.get(ref);
      return info?.isFile()
        && (info.mtimeMs + 1000 < marker.startedAtMs || info.mtimeMs - 1000 > marker.completedAtMs);
    });
  return hasEvidenceOutsideMarkerWindow ? [`stale-current-run-marker:${caseId}`] : [];
}

async function currentRunMarkerWindowFromRef(ref: string) {
  try {
    const parsed = JSON.parse(await readFile(ref, 'utf8')) as unknown;
    if (!isRecord(parsed)) return undefined;
    if (parsed.schemaVersion !== 'sciforge.model-router.computer-use.current-run.v1') return undefined;
    if (typeof parsed.runId !== 'string' || !parsed.runId.trim()) return undefined;
    const startedAtMs = timestampMs(parsed.startedAt);
    const completedAtMs = timestampMs(parsed.completedAt);
    if (startedAtMs === undefined || completedAtMs === undefined || completedAtMs < startedAtMs) {
      return undefined;
    }
    return { runId: parsed.runId.trim(), startedAtMs, completedAtMs };
  } catch {
    return undefined;
  }
}

async function currentRunEvidenceBindingIssues(result: ModelRouterComputerUseLiveAcceptanceMatrixResult) {
  if (result.status !== 'passed') return [];
  const currentRunRef = result.executor?.currentRunRef;
  if (!currentRunRef || !isWorkspaceFileRef(currentRunRef)) return [];
  const marker = await currentRunMarkerWindowFromRef(currentRunRef);
  if (!marker) return [];
  const caseId = safeLabel(result.caseId) ?? `case:${sha256Hex(result.caseId).slice(0, 12)}`;

  const checks: Array<{
    ref: string | undefined;
    slot: string;
    kind: string;
    allowedStatuses: readonly string[];
  }> = [
    {
      ref: result.gui?.presentRef,
      slot: 'gui-present',
      kind: 'gui.present',
      allowedStatuses: ['present'],
    },
    ...(result.evidenceRefs?.verifierRefs ?? []).map((ref, index) => ({
      ref,
      slot: `verifier-${index}`,
      kind: 'verifier',
      allowedStatuses: ['passed'],
    })),
  ];

  const issues: string[] = [];
  await Promise.all(checks.map(async (check) => {
    if (!check.ref || !isWorkspaceFileRef(check.ref)) return;
    const envelope = await readJsonEvidenceEnvelope(check.ref);
    if (!evidenceEnvelopeMatchesCurrentRun(envelope, {
      caseId: result.caseId,
      runId: marker.runId,
      kind: check.kind,
      allowedStatuses: check.allowedStatuses,
    })) {
      issues.push(`current-run-evidence-binding:${caseId}:${check.slot}`);
    }
  }));
  return issues;
}

async function routerTraceSemanticIssues(result: ModelRouterComputerUseLiveAcceptanceMatrixResult) {
  if (result.status !== 'passed') return [];
  const caseId = safeLabel(result.caseId) ?? `case:${sha256Hex(result.caseId).slice(0, 12)}`;
  const issues: string[] = [];
  await Promise.all((result.routerTraceRefs ?? []).map(async (ref) => {
    if (!isWorkspaceFileRef(ref)) return;
    try {
      const trace = JSON.parse(await readFile(ref, 'utf8')) as unknown;
      issues.push(...routerTraceIssues(trace, result, caseId));
    } catch {
      issues.push(`router-trace-semantic-missing:${caseId}`);
    }
  }));
  return issues;
}

function routerTraceIssues(
  value: unknown,
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult,
  caseId: string,
) {
  if (!isRecord(value) || value.schemaVersion !== 'sciforge.model-router.trace.v1') {
    return [`router-trace-semantic-missing:${caseId}`];
  }

  const issues: string[] = [];
  const expectedProfile = safeLabel(result.routerProfile);
  const expectedAlias = safeLabel(result.publicModelAlias);
  if (expectedProfile && stringValue(value.profileId) !== expectedProfile) {
    issues.push(`router-trace-profile-mismatch:${caseId}`);
  }
  if (expectedAlias && stringValue(value.publicModelAlias) !== expectedAlias) {
    issues.push(`router-trace-public-model-alias-mismatch:${caseId}`);
  }

  const calls = Array.isArray(value.calls) ? value.calls : [];
  if (!calls.some((item) => traceCallHasOkRole(item, 'visionTranslator'))) {
    issues.push(`router-trace-required-role-missing:${caseId}:visionTranslator`);
  }
  if (!calls.some((item) => traceCallHasOkRole(item, 'textReasoner'))) {
    issues.push(`router-trace-required-role-missing:${caseId}:textReasoner`);
  }
  return issues;
}

function traceCallHasOkRole(value: unknown, role: string) {
  if (!isRecord(value)) return false;
  const callRole = stringValue(value.role) ?? stringValue(value.roleAlias);
  return callRole === role && value.status === 'ok';
}

async function readJsonEvidenceEnvelope(ref: string) {
  try {
    return JSON.parse(await readFile(ref, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function evidenceEnvelopeMatchesCurrentRun(
  value: unknown,
  expected: {
    caseId: string;
    runId: string;
    kind: string;
    allowedStatuses: readonly string[];
  },
) {
  if (!isRecord(value)) return false;
  return value.schemaVersion === 'sciforge.model-router.computer-use.evidence.v1'
    && value.caseId === expected.caseId
    && value.runId === expected.runId
    && value.kind === expected.kind
    && typeof value.status === 'string'
    && expected.allowedStatuses.includes(value.status);
}

function timestampMs(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function isWorkspaceFileRef(ref: string) {
  const normalized = ref.replace(/\\/g, '/');
  return !isForbiddenPublicRef(ref)
    && isSafeRelativeFileRef(normalized)
    && (normalized.startsWith('docs/') || normalized.startsWith('.sciforge/') || normalized.startsWith('artifacts/'));
}

function sourceIssuesFor(source: ModelRouterComputerUseLiveAcceptanceMatrixManifest['source']) {
  if (source.kind !== 'input-file' && source.kind !== 'manifest-file') return [];
  if (!source.ref) return [`source-ref-missing:${source.kind}`];
  if (!isSafeSourceRef(source.ref)) return [`source-ref-invalid:${source.kind}`];
  return [];
}

function isSafeSourceRef(ref: string) {
  return isWorkspaceFileRef(ref) || /^(?:input-file|manifest-file):[a-f0-9]{16}$/i.test(ref);
}

function inputFromRecord(record: unknown): Pick<BuildModelRouterComputerUseLiveAcceptanceMatrixManifestInput, 'checkedAt' | 'results' | 'traceAudit'> {
  if (Array.isArray(record)) {
    return { results: record.map(resultFromUnknown) };
  }
  if (!isRecord(record)) return { results: [] };
  if (Array.isArray(record.results)) {
    return {
      checkedAt: stringValue(record.checkedAt),
      results: record.results.map(resultFromUnknown),
      traceAudit: traceAuditFromUnknown(record.traceAudit),
    };
  }
  if (
    record.schemaVersion === MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION
    && Array.isArray(record.cases)
  ) {
    return {
      checkedAt: stringValue(record.checkedAt),
      results: record.cases.map(resultFromManifestCase),
      traceAudit: traceAuditFromUnknown(record.traceAudit),
    };
  }
  return { results: [] };
}

async function traceAuditFromPath(path: string): Promise<ModelRouterComputerUseTraceAuditInput> {
  try {
    const record = await readJson(path);
    const traceAudit = traceAuditFromUnknown(record);
    return {
      ...traceAudit,
      status: traceAudit?.status === 'pass' ? 'pass' : 'fail',
      reportRef: publicSourceRef(path, 'manifest-file'),
    };
  } catch {
    return {
      status: 'missing',
      reportRef: publicSourceRef(path, 'manifest-file'),
    };
  }
}

function traceAuditFromUnknown(value: unknown): ModelRouterComputerUseTraceAuditInput | undefined {
  if (!isRecord(value)) return undefined;
  const status = value.status === 'pass' || value.status === 'fail' || value.status === 'missing'
    ? value.status
    : undefined;
  if (!status) return undefined;
  if (
    value.schemaVersion &&
    value.schemaVersion !== 'sciforge.model-router.trace-audit.v1' &&
    value.schemaVersion !== MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_SCHEMA_VERSION
  ) {
    return { status: 'fail' };
  }
  return {
    status,
    schemaVersion: stringValue(value.schemaVersion),
    reportRef: stringValue(value.reportRef),
    traceRootSha256: stringValue(value.traceRootSha256),
    scannedFileRefs: stringArray(value.scannedFileRefs),
    scannedFiles: typeof value.scannedFiles === 'number' ? value.scannedFiles : undefined,
    scannedBytes: typeof value.scannedBytes === 'number' ? value.scannedBytes : undefined,
    findings: Array.isArray(value.findings) ? value.findings : undefined,
    policy: isRecord(value.policy) ? {
      knownSecretsChecked: typeof value.policy.knownSecretsChecked === 'number'
        ? value.policy.knownSecretsChecked
        : undefined,
      forbidsRawProviderPayload: value.policy.forbidsRawProviderPayload === true,
      forbidsRawPrivateUrls: value.policy.forbidsRawPrivateUrls === true,
      forbidsLocalAbsolutePaths: value.policy.forbidsLocalAbsolutePaths === true,
      forbidsInlineImageData: value.policy.forbidsInlineImageData === true,
    } : undefined,
  };
}

function resultFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  const record = isRecord(value) ? value : {};
  return {
    caseId: stringValue(record.caseId) ?? '',
    status: resultStatus(record.status),
    publicModelAlias: stringValue(record.publicModelAlias),
    routerProfile: stringValue(record.routerProfile),
    routerTraceRefs: stringArray(record.routerTraceRefs),
    capabilityIds: stringArray(record.capabilityIds),
    executor: executorFromUnknown(record.executor),
    evidenceRefs: evidenceRefsFromUnknown(record.evidenceRefs),
    gui: guiFromUnknown(record.gui),
    issues: stringArray(record.issues),
  };
}

function resultFromManifestCase(value: unknown): ModelRouterComputerUseLiveAcceptanceMatrixResult {
  const record = isRecord(value) ? value : {};
  return {
    caseId: stringValue(record.id) ?? stringValue(record.caseId) ?? '',
    status: resultStatus(record.status),
    publicModelAlias: stringValue(record.publicModelAlias),
    routerProfile: stringValue(record.routerProfile),
    routerTraceRefs: stringArray(record.routerTraceRefs),
    capabilityIds: stringArray(record.capabilityIds),
    executor: executorFromUnknown(record.executor),
    evidenceRefs: evidenceRefsFromUnknown(record.evidenceRefs),
    gui: guiFromUnknown(record.gui),
    issues: stringArray(record.issues),
  };
}

function normalizeResult(
  caseId: ModelRouterComputerUseLiveAcceptanceCategory,
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult | undefined,
) {
  const executor = executorFromUnknown(result?.executor);
  const evidenceRefs = normalizeEvidenceRefs(result?.evidenceRefs);
  return {
    publicModelAlias: safeLabel(result?.publicModelAlias),
    routerProfile: safeLabel(result?.routerProfile),
    routerTraceRefs: safeRefs(result?.routerTraceRefs),
    capabilityIds: safeLabels(result?.capabilityIds),
    executor: executor
      ? {
          kind: allowedExecutorKinds.has(executor.kind) ? executor.kind : undefined,
          currentRunRef: safeRef(executor.currentRunRef),
          executorRef: safeRef(executor.executorRef),
          appWindowRef: safeRef(executor.appWindowRef),
          sessionRef: safeRef(executor.sessionRef),
          nativeHostRef: safeRef(executor.nativeHostRef),
          refs: safeRefs(executor.refs),
          currentRunEvidence: Boolean(safeRef(executor.currentRunRef)),
        }
      : undefined,
    evidenceRefs,
    gui: normalizeGuiRefs(caseId, result?.gui),
  };
}

function caseEvidenceIssues(
  matrixCase: (typeof modelRouterComputerUseLiveAcceptanceCases)[number],
  normalized: ReturnType<typeof normalizeResult>,
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult | undefined,
) {
  if (!result) return ['missing-result'];
  const issues: string[] = [];
  if (result.status !== 'passed') issues.push(`case-${result.status}`);
  if (!normalized.publicModelAlias) issues.push('missing-public-model-alias');
  if (!normalized.routerProfile) issues.push('missing-router-profile');
  if (normalized.routerTraceRefs.length === 0) issues.push('missing-router-trace-refs');
  for (const capabilityId of matrixCase.requiredCapabilityIds) {
    if (!normalized.capabilityIds.includes(capabilityId)) issues.push(`missing-capability:${capabilityId}`);
  }
  if (!normalized.executor) {
    issues.push('missing-current-run-executor');
  } else {
    if (!normalized.executor.kind) issues.push('missing-current-run-executor-kind');
    if (!normalized.executor.currentRunRef) issues.push('missing-current-run-ref');
    if (!normalized.executor.executorRef) issues.push('missing-executor-ref');
    if (
      (normalized.executor.kind === 'desktop-native-host' || normalized.executor.kind === 'native-host') &&
      !normalized.executor.nativeHostRef &&
      !normalized.executor.sessionRef
    ) {
      issues.push('missing-native-executor-binding-ref');
    }
    if (normalized.executor.kind === 'app-window' && !normalized.executor.appWindowRef) {
      issues.push('missing-app-window-executor-ref');
    }
    issues.push(...currentRunScopeIssues(normalized));
  }
  for (const kind of matrixCase.requiredEvidenceKinds) {
    if (evidenceRefsForKind(normalized.evidenceRefs, kind).length === 0) {
      issues.push(`missing-${kind}-refs`);
    }
  }
  if (result.status === 'passed') {
    if (!normalized.gui.presentRef) issues.push('missing-gui-present-ref');
    issues.push(...requiredWorkspaceFileRefIssues(normalized));
  } else if (normalized.gui.status === 'missing') {
    issues.push('missing-gui-present-or-blocked-repair-ref');
  }
  return issues;
}

function currentRunScopeIssues(normalized: ReturnType<typeof normalizeResult>) {
  const currentRunRef = normalized.executor?.currentRunRef;
  if (!currentRunRef) return [];
  const root = currentRunRootRef(currentRunRef);
  if (!root) return ['current-run-scope:currentRunRef'];

  const scopedRefs: Array<[string, string | undefined]> = [
    ['executorRef', normalized.executor?.executorRef],
    ['appWindowRef', normalized.executor?.appWindowRef],
    ['sessionRef', normalized.executor?.sessionRef],
    ...(normalized.executor?.refs ?? []).map((ref, index) => [`executor.refs[${index}]`, ref] as [string, string]),
    ...Object.entries(normalized.evidenceRefs).flatMap(([group, refs]) => (
      refs.map((ref, index) => [`${group}[${index}]`, ref] as [string, string])
    )),
    ['gui.presentRef', normalized.gui.presentRef],
    ['gui.blockedRef', normalized.gui.blockedRef],
    ['gui.repairRef', normalized.gui.repairRef],
  ];

  return scopedRefs
    .filter(([, ref]) => ref && !refIsUnderCurrentRunRoot(ref, root))
    .map(([label]) => `current-run-scope:${label}`);
}

function currentRunRootRef(currentRunRef: string) {
  const suffix = '/current-run.json';
  return currentRunRef.endsWith(suffix)
    ? currentRunRef.slice(0, -suffix.length)
    : undefined;
}

function refIsUnderCurrentRunRoot(ref: string, root: string) {
  return ref === root || ref.startsWith(`${root}/`);
}

function requiredWorkspaceFileRefIssues(normalized: ReturnType<typeof normalizeResult>) {
  return normalizedRequiredFileRefs(normalized)
    .filter(([, ref]) => ref && !isWorkspaceFileRef(ref))
    .map(([label]) => nonFileRefIssue(label));
}

function normalizedRequiredFileRefs(
  normalized: ReturnType<typeof normalizeResult>,
): Array<[string, string | undefined]> {
  return [
    ...normalized.routerTraceRefs.map((ref, index) => [`routerTraceRefs[${index}]`, ref] as [string, string]),
    ['executor.currentRunRef', normalized.executor?.currentRunRef],
    ['executor.executorRef', normalized.executor?.executorRef],
    ['executor.appWindowRef', normalized.executor?.appWindowRef],
    ['executor.sessionRef', normalized.executor?.sessionRef],
    ['executor.nativeHostRef', normalized.executor?.nativeHostRef],
    ...(normalized.executor?.refs ?? []).map((ref, index) => [`executor.refs[${index}]`, ref] as [string, string]),
    ...Object.entries(normalized.evidenceRefs).flatMap(([group, refs]) => (
      refs.map((ref, index) => [`evidenceRefs.${group}[${index}]`, ref] as [string, string])
    )),
    ['gui.presentRef', normalized.gui.presentRef],
    ['gui.blockedRef', normalized.gui.blockedRef],
    ['gui.repairRef', normalized.gui.repairRef],
  ];
}

function nonFileRefIssue(label: string) {
  return label.startsWith('gui.')
    ? `non-file-gui-ref:${label}`
    : `non-file-evidence-ref:${label}`;
}

function caseStatus(
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult | undefined,
  issues: string[],
): ModelRouterComputerUseLiveAcceptanceCaseStatus {
  if (!result) return 'missing';
  if (result.status === 'not-evaluated') return 'not-evaluated';
  if (result.status !== 'passed' || issues.length > 0) return 'blocked';
  return 'passed';
}

function traceAuditIssuesFor(
  traceAudit: ModelRouterComputerUseTraceAuditInput | undefined,
  cases: ModelRouterComputerUseLiveAcceptanceMatrixManifestCase[],
  source: ModelRouterComputerUseLiveAcceptanceMatrixManifest['source'],
  requiredKnownSecretsChecked: number,
) {
  const liveSource = source.kind === 'input-file' || source.kind === 'manifest-file';
  if (!traceAudit) return liveSource ? ['trace-audit-missing'] : [];
  if (traceAudit.status !== 'pass') return [`trace-audit-${traceAudit.status}`];
  if (!isValidTraceAuditReport(traceAudit)) return ['trace-audit-fail'];
  if (!traceAudit.reportRef?.trim()) return ['trace-audit-report-ref-missing'];
  if (isForbiddenPublicRef(traceAudit.reportRef)) return ['trace-audit-report-ref-forbidden'];
  if (!Number.isInteger(traceAudit.scannedFiles) || (traceAudit.scannedFiles ?? 0) <= 0) {
    return ['trace-audit-scanned-files-missing'];
  }
  if ((traceAudit.policy?.knownSecretsChecked ?? 0) < requiredKnownSecretsChecked) {
    return ['trace-audit-known-corpus-checked-too-low'];
  }
  const scannedFileRefs = traceAudit.scannedFileRefs ?? [];
  if (scannedFileRefs.length === 0) return ['trace-audit-scanned-file-refs-missing'];
  return cases
    .filter((item) => item.status === 'passed')
    .filter((item) => item.routerTraceRefs.some((ref) => !traceRefCoveredByAudit(ref, scannedFileRefs)))
    .map((item) => `trace-audit-missing-trace:${item.id}`);
}

function isValidTraceAuditReport(traceAudit: ModelRouterComputerUseTraceAuditInput) {
  if (traceAudit.schemaVersion !== 'sciforge.model-router.trace-audit.v1') return false;
  if (typeof traceAudit.traceRootSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(traceAudit.traceRootSha256)) return false;
  if (!Number.isInteger(traceAudit.scannedFiles) || (traceAudit.scannedFiles ?? 0) <= 0) return false;
  if (!Number.isInteger(traceAudit.scannedBytes) || (traceAudit.scannedBytes ?? 0) <= 0) return false;
  if (!Array.isArray(traceAudit.scannedFileRefs) || traceAudit.scannedFileRefs.length !== traceAudit.scannedFiles) return false;
  if (new Set(traceAudit.scannedFileRefs).size !== traceAudit.scannedFileRefs.length) return false;
  if (!Array.isArray(traceAudit.findings) || traceAudit.findings.length !== 0) return false;
  const policy = traceAudit.policy;
  return Number.isInteger(policy?.knownSecretsChecked)
    && Number(policy?.knownSecretsChecked) > 0
    && policy?.forbidsRawProviderPayload === true
    && policy.forbidsRawPrivateUrls === true
    && policy.forbidsLocalAbsolutePaths === true
    && policy.forbidsInlineImageData === true;
}

function traceRefCoveredByAudit(traceRef: string, scannedFileRefs: string[]) {
  const target = traceJsonFileRefFromTraceRef(traceRef);
  if (!target) return false;
  return scannedFileRefs.some((fileRef) => normalizeScannedTraceFileRef(fileRef) === target);
}

function traceJsonFileRefFromTraceRef(traceRef: string) {
  if (!traceRef || isForbiddenPublicRef(traceRef)) return undefined;
  const normalized = traceRef
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^\.?sciforge\/model-router-traces\//, '')
    .replace(/\/+$/, '');
  const bundle = normalized.endsWith('/trace.json')
    ? normalized.slice(0, -'/trace.json'.length)
    : normalized.endsWith('.json')
      ? normalized.slice(0, -'.json'.length)
      : normalized;
  return isSafeRelativeFileRef(bundle)
    ? `${bundle}/trace.json`
    : undefined;
}

function normalizeScannedTraceFileRef(fileRef: string) {
  if (isForbiddenPublicRef(fileRef)) return undefined;
  const normalized = fileRef
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .replace(/^\.?sciforge\/model-router-traces\//, '')
    .replace(/\/+$/, '');
  return normalized.endsWith('/trace.json') && isSafeRelativeFileRef(normalized) ? normalized : undefined;
}

function isSafeRelativeFileRef(ref: string) {
  if (!ref || ref.startsWith('/') || ref.includes(':')) return false;
  return ref.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
}

function normalizeTraceAudit(traceAudit: ModelRouterComputerUseTraceAuditInput | undefined) {
  if (!traceAudit) return undefined;
  const reportRef = safeRef(traceAudit.reportRef);
  return {
    status: traceAudit.status,
    schemaVersion: traceAudit.schemaVersion,
    reportRef,
    traceRootSha256: safeLabel(traceAudit.traceRootSha256),
    scannedFileRefs: safeRefs(traceAudit.scannedFileRefs),
    scannedFiles: traceAudit.scannedFiles,
    scannedBytes: traceAudit.scannedBytes,
    findings: traceAudit.findings,
    policy: traceAudit.policy,
  };
}

function publicTraceAudit(traceAudit: ModelRouterComputerUseTraceAuditInput | undefined) {
  if (!traceAudit) return undefined;
  return {
    status: traceAudit.status,
    reportRef: traceAudit.reportRef,
    scannedFiles: traceAudit.scannedFiles,
  };
}

function evidenceRefsForKind(
  refs: Required<ModelRouterComputerUseLiveAcceptanceEvidenceRefs>,
  kind: ModelRouterComputerUseLiveAcceptanceEvidenceKind,
) {
  if (kind === 'screenshot') return refs.screenshotRefs;
  if (kind === 'file') return refs.fileRefs;
  if (kind === 'artifact') return refs.artifactRefs;
  if (kind === 'terminal') return refs.terminalRefs;
  return refs.verifierRefs;
}

function normalizeEvidenceRefs(
  refs: ModelRouterComputerUseLiveAcceptanceEvidenceRefs | undefined,
): Required<ModelRouterComputerUseLiveAcceptanceEvidenceRefs> {
  return {
    screenshotRefs: safeRefs(refs?.screenshotRefs),
    fileRefs: safeRefs(refs?.fileRefs),
    artifactRefs: safeRefs(refs?.artifactRefs),
    terminalRefs: safeRefs(refs?.terminalRefs),
    verifierRefs: safeRefs(refs?.verifierRefs),
    blockedRefs: safeRefs(refs?.blockedRefs),
    repairRefs: safeRefs(refs?.repairRefs),
  };
}

function normalizeGuiRefs(
  _caseId: ModelRouterComputerUseLiveAcceptanceCategory,
  gui: ModelRouterComputerUseLiveAcceptanceGuiRefs | undefined,
): ModelRouterComputerUseLiveAcceptanceMatrixManifestCase['gui'] {
  const presentRef = safeRef(gui?.presentRef);
  const blockedRef = safeRef(gui?.blockedRef);
  const repairRef = safeRef(gui?.repairRef);
  const status = presentRef
    ? 'present'
    : repairRef
      ? 'repair'
      : blockedRef
        ? 'blocked'
        : 'missing';
  return { status, presentRef, blockedRef, repairRef };
}

function forbiddenRawPayloadIssues(
  caseId: ModelRouterComputerUseLiveAcceptanceCategory,
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult | undefined,
) {
  if (!result) return [];
  return hasForbiddenString(result) ? [`forbidden-raw-payload:${caseId}`] : [];
}

function hasForbiddenString(value: unknown): boolean {
  if (typeof value === 'string') return forbiddenRawPayloadPattern.test(value);
  if (Array.isArray(value)) return value.some(hasForbiddenString);
  if (isRecord(value)) return Object.values(value).some(hasForbiddenString);
  return false;
}

function executorFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceExecutorRefs | undefined {
  if (!isRecord(value)) return undefined;
  const kind = stringValue(value.kind);
  if (!kind || !allowedExecutorKinds.has(kind as ModelRouterComputerUseLiveAcceptanceExecutorKind)) {
    return undefined;
  }
  return {
    kind: kind as ModelRouterComputerUseLiveAcceptanceExecutorKind,
    currentRunRef: stringValue(value.currentRunRef),
    executorRef: stringValue(value.executorRef),
    appWindowRef: stringValue(value.appWindowRef),
    sessionRef: stringValue(value.sessionRef),
    nativeHostRef: stringValue(value.nativeHostRef),
    refs: stringArray(value.refs),
  };
}

function evidenceRefsFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceEvidenceRefs | undefined {
  if (!isRecord(value)) return undefined;
  return {
    screenshotRefs: stringArray(value.screenshotRefs),
    fileRefs: stringArray(value.fileRefs),
    artifactRefs: stringArray(value.artifactRefs),
    terminalRefs: stringArray(value.terminalRefs),
    verifierRefs: stringArray(value.verifierRefs),
    blockedRefs: stringArray(value.blockedRefs),
    repairRefs: stringArray(value.repairRefs),
  };
}

function guiFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceGuiRefs | undefined {
  if (!isRecord(value)) return undefined;
  return {
    presentRef: stringValue(value.presentRef),
    blockedRef: stringValue(value.blockedRef),
    repairRef: stringValue(value.repairRef),
  };
}

function resultStatus(value: unknown): ModelRouterComputerUseLiveAcceptanceMatrixResult['status'] {
  return value === 'passed' || value === 'blocked' || value === 'not-evaluated'
    ? value
    : 'not-evaluated';
}

function safeRefs(values: string[] | undefined) {
  return (values ?? []).map(safeRef).filter((value): value is string => Boolean(value));
}

function safeLabels(values: string[] | undefined) {
  return (values ?? []).map(safeLabel).filter((value): value is string => Boolean(value));
}

function safeRef(value: string | undefined) {
  if (!value || isForbiddenPublicRef(value)) return undefined;
  return value;
}

function safeLabel(value: string | undefined) {
  if (!value || isForbiddenPublicRef(value)) return undefined;
  return value;
}

function normalizeSource(source: ModelRouterComputerUseLiveAcceptanceMatrixManifest['source']) {
  return {
    kind: source.kind,
    ref: source.ref ? safeRef(source.ref) : undefined,
  };
}

function publicSourceRef(path: string, kind: 'input-file' | 'manifest-file') {
  const absolutePath = resolve(path);
  const relativePath = relative(process.cwd(), absolutePath).replace(/\\/g, '/');
  return relativePath && !relativePath.startsWith('..') && !relativePath.startsWith('/') && !isForbiddenPublicRef(relativePath)
    ? relativePath
    : `${kind}:${sha256Hex(absolutePath).slice(0, 16)}`;
}

function isForbiddenPublicRef(value: string) {
  return forbiddenRawPayloadPattern.test(value) || wrappedLocalAbsoluteRefPattern.test(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { expectedKnownSecretsChecked: 0, strict: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      parsed.inputPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--manifest') {
      parsed.manifestPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--trace-audit-report') {
      parsed.traceAuditReportPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--expected-known-secrets-checked') {
      parsed.expectedKnownSecretsChecked = positiveIntegerValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      parsed.outPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error(`Unknown Model Router Computer Use live acceptance matrix argument: ${arg}`);
    }
  }
  if (parsed.inputPath && parsed.manifestPath) {
    throw new Error('Use only one of --input or --manifest.');
  }
  return parsed;
}

function positiveIntegerValue(argv: string[], index: number, flag: string) {
  const raw = requiredValue(argv, index, flag);
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return value;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function helpText() {
  return [
    'Usage: tsx tools/model-router-computer-use-live-acceptance-matrix.ts [--input input.json | --manifest manifest.json] [--trace-audit-report report.json] [--out manifest.json] [--strict] [--json]',
    '',
    'Builds or validates a refs-first Model Router Computer Use live acceptance matrix manifest.',
    'No live smoke is run by default; without --input or --manifest the gate reports blocked/not-evaluated.',
    'Live current-run release acceptance requires a passing trace audit report covering every routerTraceRef.',
    'Use --expected-known-secrets-checked when release policy requires the report to prove an explicit known-secret corpus size.',
    `Default manifest convention: ${MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATRIX_DEFAULT_OUT}`,
  ].join('\n');
}

if (process.argv[1]?.endsWith('model-router-computer-use-live-acceptance-matrix.ts')) {
  await runCli(parseArgs(process.argv.slice(2)));
}
