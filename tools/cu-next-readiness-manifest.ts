import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CU_NEXT_TASK_MAPPINGS as DEFAULT_CU_NEXT_TASK_MAP_MAPPINGS,
  loadValidatedCuNextTaskMap,
  type CuNextTaskMap,
  type CuNextTaskMapping as CuNextTaskMapEntry,
} from './computer-use-next/task-map.js';
import { cuNextCompletionGradeEvidenceIssues } from './computer-use-next/completion-grade.js';
import { validateCuNextLiveAcceptanceTaskEvidence } from './computer-use-next/live-acceptance-validator.js';
import {
  approvalChainSidecarRefsFromEvidence,
  validateCuNextApprovalChainSidecars,
  validateCuNextNeedsConfirmationSidecars,
} from './computer-use-next/approval-chain.js';

export const CU_NEXT_READINESS_SCHEMA_VERSION = 'sciforge.computer-use.cu-next-readiness.v1' as const;
const RUNTIME_BROWSER_OBSERVED_AT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const RUNTIME_BROWSER_OBSERVED_AT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export type CuNextTaskId = string;

export type CuNextTaskStatus = 'blocked' | 'evidence-ready' | 'passed';

export type CuNextRequirement =
  | 'l2-artifact-refs'
  | 'l3-workflow-refs'
  | 'approval-chain'
  | 'repair-continuity'
  | 'dense-grounding'
  | 'no-dom-playwright-accessibility';

export interface CuNextProjectChecklistItem {
  checked: boolean;
  text: string;
  line: number;
}

export interface CuNextProjectTask {
  id: CuNextTaskId;
  title: string;
  line: number;
  checklist: CuNextProjectChecklistItem[];
}

export type CuNextTaskMapping = CuNextTaskMapEntry;

export interface CuNextEvidenceFile {
  path: string;
  data: unknown;
}

export interface CuNextReadinessTask {
  id: CuNextTaskId;
  title: string;
  slug: string;
  status: CuNextTaskStatus;
  requirements: CuNextRequirement[];
  checkedChecklistItems: number;
  totalChecklistItems: number;
  matchingAcceptanceRefs: string[];
  acceptedEvidenceRef?: string;
  acceptedEvidenceStatus?: string;
  blockedItems: Array<{
    id: string;
    reason: string;
  }>;
}

export interface CuNextReadinessManifest {
  schemaVersion: typeof CU_NEXT_READINESS_SCHEMA_VERSION;
  generatedAt: string;
  sourceProjectRef: string;
  status: 'blocked' | 'ready';
  completionEligible: boolean;
  globalEvidence: {
    runtimeBrowser: {
      status: 'passed' | 'blocked' | 'missing';
      ref?: string;
      reason?: string;
    };
    kvGround: {
      status: 'passed' | 'blocked' | 'missing';
      ref?: string;
      endpoint?: string;
      reason?: string;
    };
  };
  tasks: CuNextReadinessTask[];
  blockedItems: Array<{
    id: string;
    reason: string;
  }>;
}

interface RuntimeBrowserManifest {
  schemaVersion?: unknown;
  status?: unknown;
  source?: unknown;
  observedAt?: unknown;
  releaseEligible?: unknown;
  reason?: unknown;
  blocker?: unknown;
  acceptanceConclusionFromRealBrowser?: unknown;
  automationSubstituteUsed?: unknown;
  seedDemoFixtureEvidenceUsed?: unknown;
  startedFromDefaultChatEntry?: unknown;
  submittedThroughRuntimeCodex?: unknown;
  providerModelProfileVisible?: unknown;
  workspaceVisible?: unknown;
  commandIdVisible?: unknown;
  singleTurn?: {
    status?: unknown;
    visibleAnswerConfirmed?: unknown;
    providerModelProfileVisible?: unknown;
    workspaceCommandIdVisible?: unknown;
  };
  artifactFollowUp?: {
    status?: unknown;
    visibleAnswerConfirmed?: unknown;
    providerModelProfileVisible?: unknown;
    workspaceCommandIdVisible?: unknown;
  };
  multiTurn?: {
    status?: unknown;
    visibleAnswerConfirmed?: unknown;
    providerModelProfileVisible?: unknown;
    workspaceCommandIdVisible?: unknown;
    secondTurnVisibleAnswerConfirmed?: unknown;
  };
}

interface KvGroundSmokeManifest {
  schemaVersion?: unknown;
  runId?: unknown;
  createdAt?: unknown;
  endpoint?: unknown;
  predictRequest?: unknown;
  checks?: {
    health?: {
      ok?: unknown;
    };
    predict?: {
      coordinates?: unknown;
      text?: unknown;
      raw_text?: unknown;
    };
  };
}

interface UserAcceptanceManifest {
  schemaVersion?: unknown;
  runId?: unknown;
  taskId?: unknown;
  scenarioId?: unknown;
  status?: unknown;
  taskText?: unknown;
  level?: unknown;
  appWorkflow?: {
    kind?: unknown;
    apps?: unknown;
    windowSwitchTraceRefs?: unknown;
  };
  antiShortcutGuard?: {
    status?: unknown;
    rejectedClaims?: unknown;
  };
  screenshotRefs?: {
    before?: unknown;
    after?: unknown;
  };
  focusCropRefs?: unknown;
  groundingDiagnosticsRefs?: unknown;
  executorLease?: {
    status?: unknown;
    ref?: unknown;
  };
  finalArtifactRef?: unknown;
  finalVisibleScreenshotRef?: unknown;
  verifierVerdict?: {
    status?: unknown;
    verdict?: unknown;
    ref?: unknown;
  };
  guiPresent?: {
    status?: unknown;
    recordRef?: unknown;
    payloadRef?: unknown;
    displayedRefs?: unknown;
  };
  tuiHostChain?: unknown;
  evidenceClaims?: unknown;
  inputChannel?: unknown;
  trace?: unknown;
  metadata?: unknown;
  cuNextTask?: unknown;
  evidenceMarkers?: unknown;
  completionEvidence?: unknown;
  completionEvidenceRef?: unknown;
  evidenceKind?: unknown;
  kind?: unknown;
  acceptanceTier?: unknown;
  targetEnvironmentKind?: unknown;
  realWindowEvidence?: unknown;
  userAcceptanceEligible?: unknown;
  diagnosticOnly?: unknown;
  sameSession?: unknown;
  sourceToWriterToPreviewCausality?: unknown;
  l3Workflow?: unknown;
}

function readinessMappingsFromTaskMap(map: Pick<CuNextTaskMap, 'tasks'>): CuNextTaskMapping[] {
  return map.tasks.map((mapping) => ({ ...mapping }));
}

export const CU_NEXT_TASK_MAPPINGS: CuNextTaskMapping[] = DEFAULT_CU_NEXT_TASK_MAP_MAPPINGS.map((mapping) => ({ ...mapping }));

export interface CuNextReadinessBuildInput {
  root?: string;
  projectText: string;
  projectRef?: string;
  generatedAt?: string;
  runtimeBrowserManifest?: CuNextEvidenceFile;
  kvGroundSmokeManifests?: CuNextEvidenceFile[];
  userAcceptanceManifests?: CuNextEvidenceFile[];
  taskMap?: CuNextTaskMap;
}

export interface CuNextReadinessBuildOptions {
  root?: string;
  projectPath?: string;
  runtimeBrowserManifestPath?: string;
  searchDirs?: string[];
  userAcceptanceManifestPaths?: string[];
  kvGroundSmokePaths?: string[];
  generatedAt?: string;
  taskMapPath?: string;
}

export function buildCuNextReadinessManifestFromData(input: CuNextReadinessBuildInput): CuNextReadinessManifest {
  const root = resolve(input.root ?? process.cwd());
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const projectRef = input.projectRef ?? 'PROJECT.md';
  const taskMappings = input.taskMap ? readinessMappingsFromTaskMap(input.taskMap) : CU_NEXT_TASK_MAPPINGS;
  const projectTasks = extractCuNextProjectTasks(input.projectText);
  const runtimeBrowser = evaluateRuntimeBrowser(input.runtimeBrowserManifest, generatedAt);
  const kvGround = evaluateKvGround(input.kvGroundSmokeManifests ?? []);
  const tasks = taskMappings.map((mapping) => {
    const projectTask = projectTasks.get(mapping.taskId);
    if (!projectTask) {
      return missingProjectTask(mapping);
    }
    return evaluateTask(mapping, projectTask, input.userAcceptanceManifests ?? [], runtimeBrowser, kvGround, root);
  });
  const blockedItems = collectBlockedItems(tasks, runtimeBrowser, kvGround, projectTasks, taskMappings);
  const completionEligible = blockedItems.length === 0 && tasks.every((task) => task.status === 'passed');
  return {
    schemaVersion: CU_NEXT_READINESS_SCHEMA_VERSION,
    generatedAt,
    sourceProjectRef: projectRef,
    status: completionEligible ? 'ready' : 'blocked',
    completionEligible,
    globalEvidence: {
      runtimeBrowser,
      kvGround,
    },
    tasks,
    blockedItems,
  };
}

export async function buildCuNextReadinessManifest(options: CuNextReadinessBuildOptions = {}): Promise<CuNextReadinessManifest> {
  const taskMap = await loadValidatedCuNextTaskMap(options.taskMapPath);
  const root = resolve(options.root ?? process.cwd());
  const projectPath = resolve(root, options.projectPath ?? 'PROJECT.md');
  const runtimeBrowserManifestPath = resolve(
    root,
    options.runtimeBrowserManifestPath ?? join('docs', 'test-artifacts', 'runtime-codex-browser-acceptance', 'manifest.json'),
  );
  const searchDirs = options.searchDirs ?? [join('.sciforge', 'vision-runs'), join('docs', 'test-artifacts')];
  const projectText = await readFile(projectPath, 'utf8');
  const discovered = await discoverEvidenceFiles(root, searchDirs);
  const explicitUserAcceptance = await readExistingJsonFiles(root, options.userAcceptanceManifestPaths ?? []);
  const explicitKvGround = await readExistingJsonFiles(root, options.kvGroundSmokePaths ?? []);
  const runtimeBrowserManifest = await readOptionalJsonFile(root, runtimeBrowserManifestPath);

  return buildCuNextReadinessManifestFromData({
    projectText,
    projectRef: normalizeRef(root, projectPath),
    root,
    generatedAt: options.generatedAt,
    runtimeBrowserManifest,
    userAcceptanceManifests: [
      ...explicitUserAcceptance,
      ...discovered.filter((file) => file.path.endsWith('/cu-user-acceptance-manifest.json')),
    ],
    kvGroundSmokeManifests: [
      ...explicitKvGround,
      ...discovered.filter((file) => file.path.endsWith('/kv-ground-smoke.json')),
    ],
    taskMap,
  });
}

export async function writeCuNextReadinessManifest(outPath: string, manifest: CuNextReadinessManifest): Promise<void> {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function extractCuNextProjectTasks(projectText: string): Map<CuNextTaskId, CuNextProjectTask> {
  const tasks = new Map<CuNextTaskId, CuNextProjectTask>();
  const lines = projectText.split(/\r?\n/);
  let current: CuNextProjectTask | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const section = /^### (CU-NEXT-\d{2,})\s+(.+)$/.exec(line);
    if (section && isCuNextTaskId(section[1])) {
      current = {
        id: section[1],
        title: section[2].trim(),
        line: index + 1,
        checklist: [],
      };
      tasks.set(current.id, current);
      continue;
    }
    if (!current) continue;
    if (/^###\s+/.test(line) || /^##\s+/.test(line)) {
      current = undefined;
      continue;
    }
    const item = /^- \[([ xX])\]\s+(.+)$/.exec(line);
    if (!item) continue;
    current.checklist.push({
      checked: item[1].toLowerCase() === 'x',
      text: item[2].trim(),
      line: index + 1,
    });
  }

  return tasks;
}

function evaluateTask(
  mapping: CuNextTaskMapping,
  projectTask: CuNextProjectTask,
  userAcceptanceManifests: CuNextEvidenceFile[],
  runtimeBrowser: CuNextReadinessManifest['globalEvidence']['runtimeBrowser'],
  kvGround: CuNextReadinessManifest['globalEvidence']['kvGround'],
  root: string,
): CuNextReadinessTask {
  const matchingAcceptance = userAcceptanceManifests.filter((file) => userAcceptanceMatchesTask(file.data, mapping));
  const strongAcceptance = matchingAcceptance.find((file) => hasStrongTaskEvidence(file, mapping, root));
  const completionGradeBlockers = uniqueStrings(matchingAcceptance.flatMap((file) => (
    cuNextCompletionGradeEvidenceIssues(
      file.data,
      mapping,
      loadCompletionEvidenceData(file, root),
      completionEvidenceBundleContext(file, root),
    )
  )));
  const blockedItems: CuNextReadinessTask['blockedItems'] = [];

  if (!strongAcceptance) {
    if (completionGradeBlockers.length > 0) {
      blockedItems.push({
        id: 'completion-ineligible-evidence-kind',
        reason: `${mapping.taskId} matching acceptance evidence is not isolated-L3 completion-grade evidence: ${completionGradeBlockers.join(' ')}`,
      });
    }
    blockedItems.push({
      id: 'missing-live-l2-l3-user-acceptance-manifest',
      reason: `${mapping.taskId} needs a matching cu-user-acceptance-manifest with real TUI Host -> computer_use.runTask evidence, screenshots, grounding diagnostics, verifier pass, and gui.present refs.`,
    });
  }
  if (runtimeBrowser.status !== 'passed' && requiresBrowser(mapping)) {
    blockedItems.push({
      id: 'runtime-codex-browser-acceptance-blocked',
      reason: runtimeBrowser.reason ?? 'Runtime Codex in-app browser acceptance is not passed.',
    });
  }
  if (kvGround.status !== 'passed') {
    blockedItems.push({
      id: 'missing-kv-ground-health-predict-evidence',
      reason: kvGround.reason ?? 'KV-Ground evidence must include /health ok and a /predict coordinate result.',
    });
  }

  const uncheckedItems = projectTask.checklist.filter((item) => !item.checked);
  if (uncheckedItems.length > 0) {
    blockedItems.push({
      id: 'project-checklist-unchecked',
      reason: `${mapping.taskId} still has ${uncheckedItems.length} unchecked PROJECT.md checklist item(s).`,
    });
  }
  const checkedWithoutEvidence = projectTask.checklist.filter((item) => item.checked && !hasInlineEvidence(item.text));
  if (checkedWithoutEvidence.length > 0) {
    blockedItems.push({
      id: 'project-checklist-missing-inline-evidence',
      reason: `${mapping.taskId} has checked PROJECT.md items without inline evidence date/status text.`,
    });
  }

  const projectChecked = projectTask.checklist.length > 0
    && uncheckedItems.length === 0
    && checkedWithoutEvidence.length === 0;
  const taskGlobalReady = (!requiresBrowser(mapping) || runtimeBrowser.status === 'passed')
    && kvGround.status === 'passed';
  const status: CuNextTaskStatus = !strongAcceptance || !taskGlobalReady
    ? 'blocked'
    : projectChecked
      ? 'passed'
      : 'evidence-ready';

  return {
    id: mapping.taskId,
    title: projectTask.title,
    slug: mapping.slug,
    status,
    requirements: mapping.requirements,
    checkedChecklistItems: projectTask.checklist.filter((item) => item.checked).length,
    totalChecklistItems: projectTask.checklist.length,
    matchingAcceptanceRefs: matchingAcceptance.map((file) => file.path),
    acceptedEvidenceRef: strongAcceptance?.path,
    acceptedEvidenceStatus: getStatus(strongAcceptance?.data),
    blockedItems,
  };
}

function hasStrongTaskEvidence(file: CuNextEvidenceFile, mapping: CuNextTaskMapping, root: string): boolean {
  const manifest = file.data as UserAcceptanceManifest;
  const bundleContext = evidenceBundleContext(root, file.path);
  if (!userAcceptanceMatchesTask(file.data, mapping)) return false;
  if (manifest.schemaVersion !== 'sciforge.computer-use.user-acceptance-manifest.v1') return false;
  if (cuNextCompletionGradeEvidenceIssues(
    file.data,
    mapping,
    loadCompletionEvidenceData(file, root),
    completionEvidenceBundleContext(file, root),
  ).length > 0) return false;
  if (manifest.antiShortcutGuard?.status !== 'passed') return false;
  if (!isArrayEmpty(manifest.antiShortcutGuard.rejectedClaims)) return false;
  if (!hasRequiredTuiHostChain(manifest, bundleContext)) return false;
  if (!hasRequiredGuiPresentEvidence(manifest, bundleContext)) return false;
  if (!hasRealComputerUseEvidence(manifest, bundleContext)) return false;
  if (hasStructuredFixtureDisqualifier(file.data)) return false;
  if (hasSharedInputDisqualifier(manifest, mapping)) return false;
  if (hasShellDirectArtifactWriteDisqualifier(manifest)) return false;
  if (mapping.requirements.includes('l3-workflow-refs') && !hasIndependentInputAdapterEvidence(manifest, bundleContext)) return false;
  const liveAcceptance = validateCuNextLiveAcceptanceTaskEvidence({
    taskId: mapping.taskId,
    evidence: manifest,
    taskMappings: [mapping],
    refRecords: approvalChainRefRecords(manifest, bundleContext),
  });
  if (!liveAcceptance.ok) return false;
  if (!hasLiveAcceptanceMarkerRefs(manifest, bundleContext)) return false;
  if ((mapping.taskId === 'CU-NEXT-03' || mapping.taskId === 'CU-NEXT-06') && !hasValidApprovalChainSidecars(manifest, mapping, bundleContext)) return false;
  if (!hasRequiredStatus(manifest, mapping)) return false;
  if (!hasWorkflowRefs(manifest, mapping, bundleContext)) return false;
  if (!hasRequiredRefs(manifest, bundleContext)) return false;
  if (mapping.requirements.includes('approval-chain')) {
    const approvalTextMarkers = mapping.taskId === 'CU-NEXT-03'
      ? [/needs-confirmation/i, /gui[._-]?ask[._-]?user/i, /approval(ref|:|-request)/i]
      : [/approval(ref|:|-request)/i, /confirmed[._-]?request/i, /risk[._-]?audit/i];
    if (!jsonTextContains(file.data, approvalTextMarkers)) return false;
  }
  if (mapping.requirements.includes('repair-continuity') && !jsonTextContains(file.data, [/blocked[._-]?manifest/i, /repair[._-]?hint/i, /continuation/i, /session/i])) {
    return false;
  }
  if (mapping.requirements.includes('dense-grounding') && !jsonTextContains(file.data, [/coarse/i, /fine/i, /focus[._-]?crop/i, /rejected|excluded|exclude/i])) {
    return false;
  }
  return true;
}

function hasValidApprovalChainSidecars(
  manifest: UserAcceptanceManifest,
  mapping: CuNextTaskMapEntry,
  context: EvidenceBundleContext,
): boolean {
  const refs = approvalChainSidecarRefsFromEvidence(manifest);
  const sidecars = {
    approvalRequest: readEvidenceBundleJsonRef(refs.approvalRequestRef, context),
    guiAskUser: readEvidenceBundleJsonRef(refs.guiAskUserRecordRef, context),
    confirmedRequest: readEvidenceBundleJsonRef(refs.confirmedRequestRef, context),
    riskAudit: readEvidenceBundleJsonRef(refs.riskAuditRef, context),
    sourceApprovalRequest: readEvidenceBundleJsonRef(refs.sourceApprovalRequestRef, context),
    sourceGuiAskUser: readEvidenceBundleJsonRef(refs.sourceGuiAskUserRecordRef, context),
    sourceRiskAudit: readEvidenceBundleJsonRef(refs.sourceRiskAuditRef, context),
    approvalDecision: readEvidenceBundleJsonRef(refs.approvalDecisionRef, context),
  };
  const issues = mapping.taskId === 'CU-NEXT-03'
    ? validateCuNextNeedsConfirmationSidecars({ sidecars, refs })
    : validateCuNextApprovalChainSidecars({ sidecars, refs });
  return issues.length === 0;
}

function approvalChainRefRecords(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): Record<string, unknown> {
  const refs = approvalChainSidecarRefsFromEvidence(manifest);
  const markerRefs = markerEvidenceRefs(manifest.evidenceMarkers);
  return Object.fromEntries(uniqueStrings([
    ...Object.values(refs).filter((ref): ref is string => Boolean(ref)),
    ...markerRefs,
  ]).flatMap((ref) => {
    const record = readEvidenceBundleJsonRef(ref, context);
    return record === undefined ? [] : [[ref, record] as const];
  }));
}

function readEvidenceBundleJsonRef(ref: string | undefined, context: EvidenceBundleContext): unknown {
  if (!ref) return undefined;
  const path = resolveExistingEvidenceBundleRef(ref, context);
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function hasRequiredStatus(manifest: UserAcceptanceManifest, mapping: CuNextTaskMapping): boolean {
  if (mapping.requirements.includes('l3-workflow-refs')) {
    const statusAccepted = manifest.status === 'multi-app-workflow-passed'
      || (mapping.taskId === 'CU-NEXT-03' && manifest.status === 'needs-confirmation');
    return statusAccepted
      && manifest.level === 'L3'
      && manifest.appWorkflow?.kind === 'multi-app-workflow'
      && arrayLength(manifest.appWorkflow.windowSwitchTraceRefs) > 0;
  }
  if (mapping.requirements.includes('l2-artifact-refs')) {
    return manifest.status === 'single-app-artifact-passed' || manifest.status === 'multi-app-workflow-passed';
  }
  return manifest.status === 'single-app-artifact-passed' || manifest.status === 'multi-app-workflow-passed';
}

function hasWorkflowRefs(
  manifest: UserAcceptanceManifest,
  mapping: CuNextTaskMapping,
  context: EvidenceBundleContext,
): boolean {
  if (!mapping.requirements.includes('l3-workflow-refs')) return true;
  return refsExistInEvidenceBundle(stringArray(manifest.appWorkflow?.windowSwitchTraceRefs), context);
}

function hasRequiredRefs(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): boolean {
  const executorLeaseRef = stringValue(manifest.executorLease?.ref);
  const finalArtifactRef = stringValue(manifest.finalArtifactRef);
  const finalVisibleScreenshotRef = stringValue(manifest.finalVisibleScreenshotRef);
  const verifierVerdictRef = stringValue(manifest.verifierVerdict?.ref);
  const guiPresentRecordRef = stringValue(manifest.guiPresent?.recordRef);
  const guiPresentPayloadRef = stringValue(manifest.guiPresent?.payloadRef);
  const completionEvidenceRef = stringValue(manifest.completionEvidenceRef);
  const criticalRefs = [
    ...stringArray(manifest.screenshotRefs?.before),
    ...stringArray(manifest.screenshotRefs?.after),
    ...stringArray(manifest.focusCropRefs),
    ...stringArray(manifest.groundingDiagnosticsRefs),
    executorLeaseRef,
    finalArtifactRef,
    finalVisibleScreenshotRef,
    verifierVerdictRef,
    guiPresentRecordRef,
    guiPresentPayloadRef,
    completionEvidenceRef,
    ...stringArray(manifest.guiPresent?.displayedRefs),
  ].filter((ref): ref is string => Boolean(ref));

  return arrayLength(manifest.screenshotRefs?.before) > 0
    && arrayLength(manifest.screenshotRefs?.after) > 0
    && arrayLength(manifest.focusCropRefs) > 0
    && arrayLength(manifest.groundingDiagnosticsRefs) > 0
    && manifest.executorLease?.status === 'present'
    && isNonEmptyString(executorLeaseRef)
    && isNonEmptyString(finalArtifactRef)
    && isNonEmptyString(finalVisibleScreenshotRef)
    && manifest.verifierVerdict?.status === 'passed'
    && isNonEmptyString(verifierVerdictRef)
    && manifest.guiPresent?.status === 'present'
    && isNonEmptyString(guiPresentRecordRef)
    && isNonEmptyString(guiPresentPayloadRef)
    && isNonEmptyString(completionEvidenceRef)
    && arrayLength(manifest.guiPresent.displayedRefs) > 0
    && refsExistInEvidenceBundle(criticalRefs, context);
}

function loadCompletionEvidenceData(file: CuNextEvidenceFile, root: string): unknown {
  const manifest = file.data as UserAcceptanceManifest;
  const ref = stringValue(manifest.completionEvidenceRef);
  if (!ref) return undefined;
  const context = evidenceBundleContext(root, file.path);
  const path = resolveExistingEvidenceBundleRef(ref, context);
  if (!path) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function completionEvidenceBundleContext(file: CuNextEvidenceFile, root: string) {
  const context = evidenceBundleContext(root, file.path);
  return {
    refScopeDescription: 'the current acceptance evidence bundle',
    refExists: (ref: string) => refExistsInEvidenceBundle(ref, context),
  };
}

function hasLiveAcceptanceMarkerRefs(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): boolean {
  const refs = markerEvidenceRefs(manifest.evidenceMarkers);
  return refs.length > 0 && refsExistInEvidenceBundle(refs, context);
}

function hasRequiredTuiHostChain(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): boolean {
  const chain = records(manifest.tuiHostChain);
  return chain.some((link) => (
    link.kind === 'tui-host-runTask'
    && link.status === 'present'
    && isNonEmptyString(link.requestRef)
    && isNonEmptyString(link.hostPortsRef)
    && refsExistInEvidenceBundle([link.requestRef, link.hostPortsRef], context)
  )) && chain.some((link) => (
    link.kind === 'computer-use-action-provider'
    && link.status === 'present'
    && isNonEmptyString(link.toolPayloadRef)
    && refsExistInEvidenceBundle([link.toolPayloadRef], context)
  ));
}

function hasRequiredGuiPresentEvidence(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): boolean {
  const recordRef = stringValue(manifest.guiPresent?.recordRef);
  const displayedRefs = stringArray(manifest.guiPresent?.displayedRefs);
  if (!recordRef || displayedRefs.length === 0) return false;
  const chain = records(manifest.tuiHostChain);
  const hasChainLink = chain.some((link) => (
    link.kind === 'gui.present'
    && link.status === 'present'
    && stringValue(link.recordRef) === recordRef
  ));
  if (!hasChainLink) return false;
  return records(manifest.evidenceClaims).some((claim) => {
    if (claim.kind !== 'gui-present-record') return false;
    const refs = recordRefs(claim);
    return refs.includes(recordRef)
      && refsExistInEvidenceBundle(refs, context)
      && displayedRefs.some((displayedRef) => refs.includes(displayedRef) || stringArray(claim.artifactRefs).includes(displayedRef));
  });
}

function hasRealComputerUseEvidence(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): boolean {
  return records(manifest.evidenceClaims).some((claim) => (
    claim.kind === 'real-computer-use'
    && recordRefs(claim).length > 0
    && refsExistInEvidenceBundle(recordRefs(claim), context)
  ));
}

function hasIndependentInputAdapterEvidence(manifest: UserAcceptanceManifest, context: EvidenceBundleContext): boolean {
  return records(manifest.evidenceClaims).some((claim) => (
    claim.kind === 'independent-input-adapter'
    && recordRefs(claim).length > 0
    && refsExistInEvidenceBundle(recordRefs(claim), context)
    && stringArray(claim.sessionRefs).length > 0
  ));
}

function hasStructuredFixtureDisqualifier(data: unknown): boolean {
  return findRecordValue(data, (key, value) => (
    (key === 'testActionFixtureMode' || key === 'fixtureMode' || key === 'seedDemoFixtureEvidenceUsed' || key === 'fixture')
    && value === true
  )) || findRecordValue(data, (key, value) => (
    key === 'dryRun' && value === true
  )) || findRecordValue(data, (key, value) => (
    (key === 'evidenceMode' || key === 'sourceMode' || key === 'sourceKind' || key === 'kind' || key === 'evidenceKind')
    && typeof value === 'string'
    && /fixture|demo|synthetic/i.test(value)
  ));
}

function hasSharedInputDisqualifier(manifest: UserAcceptanceManifest, mapping: CuNextTaskMapping): boolean {
  if (!mapping.requirements.includes('l3-workflow-refs')) return false;
  if (records(manifest.evidenceClaims).some((claim) => claim.kind === 'shared-input-ack')) return true;
  if (typeof manifest.executorLease?.ref === 'string' && /shared-system/i.test(manifest.executorLease.ref)) return true;
  return findRecordValue(manifest, (key, value) => (
    ((key === 'allowSharedSystemInput' || key === 'sharedSystemInputUsed') && value === true)
    || (
      typeof value === 'string'
      && (key === 'pointerKeyboardOwnership' || key === 'inputOwnership' || key === 'owner')
      && /shared-system|system mouse|system keyboard|shared input/i.test(value)
    )
  ));
}

function hasShellDirectArtifactWriteDisqualifier(manifest: UserAcceptanceManifest): boolean {
  return findRecordValue(manifest, (key, value) => key === 'shellDirectArtifactWrite' && value === true);
}

function userAcceptanceMatchesTask(data: unknown, mapping: CuNextTaskMapping): boolean {
  const manifest = data as UserAcceptanceManifest;
  if (manifest.schemaVersion !== 'sciforge.computer-use.user-acceptance-manifest.v1') return false;
  return manifest.taskId === mapping.taskId;
}

function evaluateRuntimeBrowser(
  file: CuNextEvidenceFile | undefined,
  generatedAt: string,
): CuNextReadinessManifest['globalEvidence']['runtimeBrowser'] {
  if (!file) {
    return {
      status: 'missing',
      reason: 'Runtime Codex browser acceptance manifest was not found.',
    };
  }
  const data = file.data as RuntimeBrowserManifest;
  const freshnessIssue = runtimeBrowserFreshnessIssue(data.observedAt, generatedAt);
  const passed = data.schemaVersion === 'sciforge.runtime-codex.browser-acceptance.v1'
    && data.status === 'passed'
    && data.source === 'codex-in-app-browser'
    && !freshnessIssue
    && data.releaseEligible === true
    && data.acceptanceConclusionFromRealBrowser === true
    && data.automationSubstituteUsed !== true
    && data.seedDemoFixtureEvidenceUsed !== true
    && data.startedFromDefaultChatEntry === true
    && data.submittedThroughRuntimeCodex === true
    && data.providerModelProfileVisible === true
    && data.workspaceVisible === true
    && data.commandIdVisible === true
    && browserStepPassed(data.singleTurn)
    && browserStepPassed(data.artifactFollowUp)
    && browserStepPassed(data.multiTurn)
    && data.multiTurn?.secondTurnVisibleAnswerConfirmed === true;
  return passed
    ? {
        status: 'passed',
        ref: file.path,
      }
    : {
        status: data.status === 'blocked' || freshnessIssue ? 'blocked' : 'missing',
        ref: file.path,
        reason: freshnessIssue
          ?? stringValue(data.reason)
          ?? stringValue(data.blocker)
          ?? 'Runtime Codex browser acceptance is not a current passed in-app-browser manifest.',
      };
}

function evaluateKvGround(files: CuNextEvidenceFile[]): CuNextReadinessManifest['globalEvidence']['kvGround'] {
  if (files.length === 0) {
    return {
      status: 'missing',
      reason: 'KV-Ground smoke manifest was not found.',
    };
  }
  const sorted = [...files].sort((a, b) => evidenceTimestamp(a).localeCompare(evidenceTimestamp(b)) || a.path.localeCompare(b.path));
  const latest = sorted.at(-1);
  if (!latest) {
    return {
      status: 'missing',
      reason: 'KV-Ground smoke manifest was not found.',
    };
  }
  const data = latest.data as KvGroundSmokeManifest;
  const passed = data.schemaVersion === 'sciforge.kv-ground-smoke.v1'
    && data.checks?.health?.ok === true
    && isCoordinatePair(data.checks.predict?.coordinates)
    && isNonEmptyString(data.endpoint)
    && data.predictRequest !== undefined;
  if (passed) {
    return {
      status: 'passed',
      ref: latest.path,
      endpoint: stringValue(data.endpoint),
    };
  }
  return {
    status: 'blocked',
    ref: latest.path,
    reason: 'Latest KV-Ground smoke evidence does not contain both /health ok and /predict coordinates.',
  };
}

function collectBlockedItems(
  tasks: CuNextReadinessTask[],
  runtimeBrowser: CuNextReadinessManifest['globalEvidence']['runtimeBrowser'],
  kvGround: CuNextReadinessManifest['globalEvidence']['kvGround'],
  projectTasks: Map<CuNextTaskId, CuNextProjectTask>,
  taskMappings: CuNextTaskMapping[],
): CuNextReadinessManifest['blockedItems'] {
  const blocked: CuNextReadinessManifest['blockedItems'] = [];
  const missingIds = taskMappings
    .map((mapping) => mapping.taskId)
    .filter((taskId) => !projectTasks.has(taskId));
  if (missingIds.length > 0) {
    blocked.push({
      id: 'project-cu-next-sections-missing',
      reason: `PROJECT.md is missing active task sections: ${missingIds.join(', ')}.`,
    });
  }
  if (runtimeBrowser.status !== 'passed') {
    blocked.push({
      id: 'runtime-codex-browser-acceptance-not-passed',
      reason: runtimeBrowser.reason ?? 'Runtime Codex browser acceptance is not passed.',
    });
  }
  if (kvGround.status !== 'passed') {
    blocked.push({
      id: 'kv-ground-smoke-not-passed',
      reason: kvGround.reason ?? 'KV-Ground smoke evidence is not passed.',
    });
  }
  for (const task of tasks) {
    if (task.status === 'passed') continue;
    blocked.push({
      id: `${task.id}-not-passed`,
      reason: task.blockedItems.map((item) => `${item.id}: ${item.reason}`).join(' '),
    });
  }
  return blocked;
}

function missingProjectTask(mapping: CuNextTaskMapping): CuNextReadinessTask {
  return {
    id: mapping.taskId,
    title: '(missing PROJECT.md section)',
    slug: mapping.slug,
    status: 'blocked',
    requirements: mapping.requirements,
    checkedChecklistItems: 0,
    totalChecklistItems: 0,
    matchingAcceptanceRefs: [],
    blockedItems: [
      {
        id: 'project-section-missing',
        reason: `${mapping.taskId} is missing from PROJECT.md.`,
      },
    ],
  };
}

async function discoverEvidenceFiles(root: string, searchDirs: string[]): Promise<CuNextEvidenceFile[]> {
  const files: CuNextEvidenceFile[] = [];
  for (const searchDir of searchDirs) {
    const absoluteSearchDir = resolve(root, searchDir);
    const refs = await collectJsonEvidenceRefs(root, absoluteSearchDir);
    const parsed = await readExistingJsonFiles(root, refs);
    files.push(...parsed);
  }
  return dedupeEvidenceFiles(files);
}

async function collectJsonEvidenceRefs(root: string, dir: string): Promise<string[]> {
  const refs: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return refs;
  }
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      refs.push(...await collectJsonEvidenceRefs(root, absolute));
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name === 'cu-user-acceptance-manifest.json' || entry.name === 'kv-ground-smoke.json') {
      refs.push(normalizeRef(root, absolute));
    }
  }
  return refs;
}

async function readExistingJsonFiles(root: string, refs: string[]): Promise<CuNextEvidenceFile[]> {
  const files: CuNextEvidenceFile[] = [];
  for (const ref of refs) {
    const absolute = resolve(root, ref);
    const file = await readOptionalJsonFile(root, absolute);
    if (file) files.push(file);
  }
  return dedupeEvidenceFiles(files);
}

async function readOptionalJsonFile(root: string, absolutePath: string): Promise<CuNextEvidenceFile | undefined> {
  try {
    const text = await readFile(absolutePath, 'utf8');
    return {
      path: normalizeRef(root, absolutePath),
      data: JSON.parse(text),
    };
  } catch {
    return undefined;
  }
}

function dedupeEvidenceFiles(files: CuNextEvidenceFile[]): CuNextEvidenceFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.path)) return false;
    seen.add(file.path);
    return true;
  });
}

function normalizeRef(root: string, absoluteOrRelativePath: string): string {
  const absolute = resolve(root, absoluteOrRelativePath);
  const rel = relative(root, absolute);
  return rel.startsWith('..') ? absolute : rel.split('\\').join('/');
}

interface EvidenceBundleContext {
  root: string;
  bundleDir: string;
}

function evidenceBundleContext(root: string, manifestRef: string): EvidenceBundleContext {
  const absoluteManifestPath = resolve(root, manifestRef);
  return {
    root,
    bundleDir: dirname(absoluteManifestPath),
  };
}

function refsExistInEvidenceBundle(refs: string[], context: EvidenceBundleContext): boolean {
  return refs.length > 0 && refs.every((ref) => refExistsInEvidenceBundle(ref, context));
}

function refExistsInEvidenceBundle(ref: string, context: EvidenceBundleContext): boolean {
  return Boolean(resolveExistingEvidenceBundleRef(ref, context));
}

function resolveExistingEvidenceBundleRef(ref: string, context: EvidenceBundleContext): string | undefined {
  const refPath = filePathFromRef(ref);
  if (!refPath) return undefined;
  const candidates = isAbsolute(refPath)
    ? [resolve(refPath)]
    : [resolve(context.root, refPath), resolve(context.bundleDir, refPath)];
  return candidates.find((candidate) => (
    isPathInsideOrSame(context.bundleDir, candidate) && isExistingRegularBundleFile(candidate, context.bundleDir)
  ));
}

function filePathFromRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('file://')) {
    try {
      return fileURLToPath(trimmed);
    } catch {
      return undefined;
    }
  }
  if (trimmed.startsWith('file:')) return trimmed.slice('file:'.length);
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  return trimmed;
}

function isPathInsideOrSame(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isExistingRegularBundleFile(path: string, bundleDir: string): boolean {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const realBundle = realpathSync(bundleDir);
    const realPath = realpathSync(path);
    return isPathInsideOrSame(realBundle, realPath);
  } catch {
    return false;
  }
}

function requiresBrowser(mapping: CuNextTaskMapping): boolean {
  return mapping.recommendedTargetApp?.toLowerCase() === 'browser';
}

function hasInlineEvidence(text: string): boolean {
  return /20\d{2}-\d{2}-\d{2}/.test(text)
    && /evidence|passed|status|blocked|partial|证据|状态/i.test(text);
}

function getStatus(data: unknown): string | undefined {
  return stringValue((data as { status?: unknown } | undefined)?.status);
}

function jsonTextContains(data: unknown, patterns: RegExp[]): boolean {
  const text = JSON.stringify(data);
  return patterns.every((pattern) => pattern.test(text));
}

function browserStepPassed(step: RuntimeBrowserManifest['singleTurn']): boolean {
  return step?.status === 'passed'
    && step.visibleAnswerConfirmed === true
    && step.providerModelProfileVisible === true
    && step.workspaceCommandIdVisible === true;
}

function runtimeBrowserFreshnessIssue(value: unknown, generatedAt: string): string | undefined {
  if (!isNonEmptyString(value)) return 'Runtime Codex browser acceptance observedAt is missing.';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'Runtime Codex browser acceptance observedAt is not a valid ISO date.';
  const generatedAtTimestamp = Date.parse(generatedAt);
  const referenceTimestamp = Number.isFinite(generatedAtTimestamp) ? generatedAtTimestamp : Date.now();
  const ageMs = referenceTimestamp - timestamp;
  if (ageMs > RUNTIME_BROWSER_OBSERVED_AT_MAX_AGE_MS) {
    return 'Runtime Codex browser acceptance observedAt is older than the 24h release window.';
  }
  if (ageMs < -RUNTIME_BROWSER_OBSERVED_AT_FUTURE_SKEW_MS) {
    return 'Runtime Codex browser acceptance observedAt is after the current generation time.';
  }
  return undefined;
}

function evidenceTimestamp(file: CuNextEvidenceFile): string {
  const data = file.data as { createdAt?: unknown; observedAt?: unknown; runId?: unknown };
  const direct = stringValue(data.createdAt) ?? stringValue(data.observedAt);
  if (direct) return direct;
  const runIdTimestamp = stringValue(data.runId)?.match(/20\d{6}T?\d{6}Z?/i)?.[0];
  if (runIdTimestamp) return runIdTimestamp;
  return file.path;
}

function isArrayEmpty(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringValue(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function recordRefs(record: Record<string, unknown>): string[] {
  return [
    stringValue(record.ref),
    ...stringArray(record.refs),
    ...stringArray(record.recordRefs),
    ...stringArray(record.evidenceRefs),
    ...stringArray(record.artifactRefs),
  ].filter((ref): ref is string => Boolean(ref));
}

function markerEvidenceRefs(value: unknown, key = '', seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') {
    if (!/refs?$/i.test(key) || !filePathFromRef(value)) return [];
    return [value];
  }
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return uniqueStrings(value.flatMap((item) => markerEvidenceRefs(item, key, seen)));
  }
  return uniqueStrings(Object.entries(value).flatMap(([childKey, child]) => (
    markerEvidenceRefs(child, childKey, seen)
  )));
}

function findRecordValue(
  value: unknown,
  predicate: (key: string, value: unknown) => boolean,
  seen = new Set<unknown>(),
): boolean {
  if (!value || typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) {
    return value.some((item) => findRecordValue(item, predicate, seen));
  }
  for (const [key, child] of Object.entries(value)) {
    if (predicate(key, child)) return true;
    if (findRecordValue(child, predicate, seen)) return true;
  }
  return false;
}

function isCoordinatePair(value: unknown): boolean {
  return Array.isArray(value)
    && value.length === 2
    && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function isCuNextTaskId(value: string): value is CuNextTaskId {
  return /^CU-NEXT-\d{2,}$/.test(value);
}

interface CuNextReadinessCliArgs extends CuNextReadinessBuildOptions {
  outPath?: string;
}

function parseArgs(argv: string[]): CuNextReadinessCliArgs {
  const args: CuNextReadinessCliArgs = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    const value = argv[index + 1];
    if (arg === '--out') {
      args.outPath = requiredArg(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--project') {
      args.projectPath = requiredArg(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--root') {
      args.root = requiredArg(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--browser-manifest') {
      args.runtimeBrowserManifestPath = requiredArg(arg, value);
      index += 1;
      continue;
    }
    if (arg === '--search-dir') {
      args.searchDirs = [...(args.searchDirs ?? []), requiredArg(arg, value)];
      index += 1;
      continue;
    }
    if (arg === '--acceptance-manifest') {
      args.userAcceptanceManifestPaths = [...(args.userAcceptanceManifestPaths ?? []), requiredArg(arg, value)];
      index += 1;
      continue;
    }
    if (arg === '--kv-ground-smoke') {
      args.kvGroundSmokePaths = [...(args.kvGroundSmokePaths ?? []), requiredArg(arg, value)];
      index += 1;
      continue;
    }
    if (arg === '--task-map') {
      args.taskMapPath = requiredArg(arg, value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown CU-NEXT readiness manifest argument: ${arg}`);
  }
  return args;
}

function requiredArg(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await buildCuNextReadinessManifest(args);
  if (args.outPath) await writeCuNextReadinessManifest(args.outPath, manifest);
  const passed = manifest.tasks.filter((task) => task.status === 'passed').length;
  console.log(`[${manifest.status}] CU-NEXT readiness ${passed}/${manifest.tasks.length} passed; completionEligible=${manifest.completionEligible}`);
  if (args.outPath) console.log(`wrote ${args.outPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
