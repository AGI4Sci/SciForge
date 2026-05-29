import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_PLAN_SCHEMA =
  'sciforge.computer-use.chat-live-case-isolation.seed-plan.v1' as const;
export const COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA =
  'sciforge.computer-use.chat-live-case-isolation.reset-manifest.v1' as const;

export type ComputerUseChatLiveCaseIsolationStrategy =
  | 'per-case-workspace-fork'
  | 'resettable-workspace-fixture';

export interface ComputerUseChatLiveCaseIsolationCaseInput {
  id: string;
  taskId?: string;
  scenarioId?: string;
  expectedStatus?: string;
}

export interface ComputerUseChatLiveCaseIsolationPlanOptions {
  matrixRunId: string;
  baseWorkspacePath: string;
  cases: ComputerUseChatLiveCaseIsolationCaseInput[];
  strategy?: ComputerUseChatLiveCaseIsolationStrategy;
  now?: () => Date;
  materialize?: boolean;
}

export interface ComputerUseChatLiveCaseIsolationSeedPlan {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_PLAN_SCHEMA;
  checkedAt: string;
  matrixRunId: string;
  strategy: ComputerUseChatLiveCaseIsolationStrategy;
  baseWorkspacePath: string;
  resetManifestSchemaVersion: typeof COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA;
  cases: ComputerUseChatLiveCaseIsolationSeedPlanCase[];
  runnerIntegration: {
    setWorkspacePathPerCase: true;
    setSessionAndTurnPerCase: true;
    resetBeforeEachCase: true;
    writeResetManifestBeforeSubmittingCase: true;
    failClosedWhenResetManifestHasIssues: true;
    preserveCurrentRunCompletionEvidenceOnly: true;
  };
  issues: string[];
}

export interface ComputerUseChatLiveCaseIsolationSeedPlanCase {
  id: string;
  taskId?: string;
  scenarioId?: string;
  expectedStatus?: string;
  caseIndex: number;
  caseRunId: string;
  sessionId: string;
  currentTurnId: string;
  workspace: {
    kind: ComputerUseChatLiveCaseIsolationStrategy;
    baseWorkspacePath: string;
    caseWorkspacePath: string;
    caseWorkspaceRef: string;
    seedManifestRef: string;
    resetManifestRef: string;
    windowStateRootRef: string;
    tempRootRef: string;
    plannerMemoryRootRef: string;
    forkPolicy: {
      copyFromBaseWorkspace: string[];
      excludeFromFork: string[];
      recreateEmpty: string[];
    };
  };
  isolationContract: {
    windowStateScopeId: string;
    tempScopeId: string;
    plannerMemoryScopeId: string;
    forbiddenPreviousCaseIds: string[];
  };
}

export interface ComputerUseChatLiveCaseIsolationObservedState {
  workspacePath: string;
  sessionId: string;
  currentTurnId: string;
  windowState: {
    scopeId: string;
    refs: string[];
    priorCaseMarkers?: string[];
  };
  tempFiles: {
    rootRef: string;
    refs: string[];
  };
  plannerMemory: {
    scopeId: string;
    refs: string[];
    priorCaseMarkers?: string[];
  };
}

export interface ComputerUseChatLiveCaseIsolationResetManifest {
  schemaVersion: typeof COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA;
  checkedAt: string;
  status: 'passed' | 'failed';
  matrixRunId: string;
  caseId: string;
  caseRunId: string;
  sessionId: string;
  currentTurnId: string;
  strategy: ComputerUseChatLiveCaseIsolationStrategy;
  workspace: ComputerUseChatLiveCaseIsolationSeedPlanCase['workspace'];
  observed: ComputerUseChatLiveCaseIsolationObservedState;
  previousCases: Array<{
    caseId: string;
    sessionId: string;
    currentTurnId: string;
    workspacePath: string;
    windowStateRefs: string[];
    tempRootRef: string;
    tempFileRefs: string[];
    plannerMemoryScopeId: string;
    plannerMemoryRefs: string[];
  }>;
  checks: ComputerUseChatLiveCaseIsolationResetCheck[];
  issues: string[];
}

export interface ComputerUseChatLiveCaseIsolationResetCheck {
  kind:
    | 'workspace-fork'
    | 'session-turn-seed'
    | 'window-state-reset'
    | 'temp-file-reset'
    | 'planner-memory-reset';
  status: 'passed' | 'failed';
  note: string;
  refs: string[];
  issues: string[];
}

interface CliArgs {
  matrixRunId?: string;
  baseWorkspacePath?: string;
  cases: ComputerUseChatLiveCaseIsolationCaseInput[];
  strategy: ComputerUseChatLiveCaseIsolationStrategy;
  out?: string;
  materialize: boolean;
  json: boolean;
}

export async function buildComputerUseChatLiveCaseIsolationSeedPlan(
  options: ComputerUseChatLiveCaseIsolationPlanOptions,
): Promise<ComputerUseChatLiveCaseIsolationSeedPlan> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const matrixRunId = safeId(options.matrixRunId);
  const baseWorkspacePath = resolve(options.baseWorkspacePath);
  const strategy = options.strategy ?? 'per-case-workspace-fork';
  const cases: ComputerUseChatLiveCaseIsolationSeedPlanCase[] = [];
  for (const [index, item] of options.cases.entries()) {
    cases.push(casePlanForInput({
      item,
      index,
      matrixRunId,
      baseWorkspacePath,
      strategy,
      previousCaseIds: cases.map((existing) => existing.id),
    }));
  }
  const duplicateCaseIds = duplicateValues(cases.map((item) => item.id));
  const duplicateWorkspacePaths = duplicateValues(cases.map((item) => item.workspace.caseWorkspacePath));
  const duplicateSessions = duplicateValues(cases.map((item) => item.sessionId));
  const issues = [
    ...duplicateCaseIds.map((id) => `duplicate-case-id:${id}`),
    ...duplicateWorkspacePaths.map((path) => `duplicate-case-workspace-path:${path}`),
    ...duplicateSessions.map((sessionId) => `duplicate-case-session-id:${sessionId}`),
  ];
  const plan: ComputerUseChatLiveCaseIsolationSeedPlan = {
    schemaVersion: COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_PLAN_SCHEMA,
    checkedAt,
    matrixRunId,
    strategy,
    baseWorkspacePath,
    resetManifestSchemaVersion: COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA,
    cases,
    runnerIntegration: {
      setWorkspacePathPerCase: true,
      setSessionAndTurnPerCase: true,
      resetBeforeEachCase: true,
      writeResetManifestBeforeSubmittingCase: true,
      failClosedWhenResetManifestHasIssues: true,
      preserveCurrentRunCompletionEvidenceOnly: true,
    },
    issues,
  };
  if (options.materialize) await materializeSeedPlan(plan);
  return plan;
}

export function e2eOptionsForCaseIsolationPlanCase(
  item: ComputerUseChatLiveCaseIsolationSeedPlanCase,
  env: NodeJS.ProcessEnv = process.env,
): {
  env: NodeJS.ProcessEnv;
  workspacePath: string;
  sessionId: string;
  currentTurnId: string;
} {
  return {
    env: {
      ...env,
      SCIFORGE_WORKSPACE_PATH: item.workspace.caseWorkspacePath,
      SCIFORGE_COMPUTER_USE_CASE_ISOLATION_RESET_MANIFEST: item.workspace.resetManifestRef,
    },
    workspacePath: item.workspace.caseWorkspacePath,
    sessionId: item.sessionId,
    currentTurnId: item.currentTurnId,
  };
}

export function buildComputerUseChatLiveCaseIsolationResetManifest(input: {
  plan: ComputerUseChatLiveCaseIsolationSeedPlan;
  caseId: string;
  observed: ComputerUseChatLiveCaseIsolationObservedState;
  previousManifests?: ComputerUseChatLiveCaseIsolationResetManifest[];
  now?: () => Date;
}): ComputerUseChatLiveCaseIsolationResetManifest {
  const checkedAt = (input.now ?? (() => new Date()))().toISOString();
  const planCase = input.plan.cases.find((item) => item.id === input.caseId);
  if (!planCase) {
    const observed = normalizeObservedState(input.observed);
    return {
      schemaVersion: COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA,
      checkedAt,
      status: 'failed',
      matrixRunId: input.plan.matrixRunId,
      caseId: input.caseId,
      caseRunId: '',
      sessionId: observed.sessionId,
      currentTurnId: observed.currentTurnId,
      strategy: input.plan.strategy,
      workspace: emptyWorkspacePlan(input.plan.baseWorkspacePath),
      observed,
      previousCases: previousCaseSummaries(input.previousManifests ?? []),
      checks: [{
        kind: 'workspace-fork',
        status: 'failed',
        note: 'Case isolation plan does not contain the requested case id.',
        refs: [],
        issues: [`case-not-in-isolation-plan:${input.caseId}`],
      }],
      issues: [`case-not-in-isolation-plan:${input.caseId}`],
    };
  }
  const observed = normalizeObservedState(input.observed);
  const previousCases = previousCaseSummaries(input.previousManifests ?? []);
  const checks = [
    workspaceForkCheck(planCase, observed, previousCases),
    sessionTurnSeedCheck(planCase, observed, previousCases),
    windowStateResetCheck(planCase, observed, previousCases),
    tempFileResetCheck(planCase, observed, previousCases),
    plannerMemoryResetCheck(planCase, observed, previousCases),
  ];
  const issues = uniqueStrings(checks.flatMap((check) => check.issues));
  return {
    schemaVersion: COMPUTER_USE_CHAT_LIVE_CASE_ISOLATION_RESET_MANIFEST_SCHEMA,
    checkedAt,
    status: issues.length ? 'failed' : 'passed',
    matrixRunId: input.plan.matrixRunId,
    caseId: planCase.id,
    caseRunId: planCase.caseRunId,
    sessionId: planCase.sessionId,
    currentTurnId: planCase.currentTurnId,
    strategy: input.plan.strategy,
    workspace: planCase.workspace,
    observed,
    previousCases,
    checks,
    issues,
  };
}

export async function writeComputerUseChatLiveCaseIsolationResetManifest(input: {
  manifest: ComputerUseChatLiveCaseIsolationResetManifest;
  outputPath?: string;
}): Promise<string> {
  const outputPath = resolve(
    input.outputPath ?? input.manifest.workspace.caseWorkspacePath,
    input.outputPath ? '' : input.manifest.workspace.resetManifestRef,
  );
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(input.manifest, null, 2)}\n`);
  return outputPath;
}

export async function runComputerUseChatLiveCaseIsolationCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  if (!args.matrixRunId || !args.baseWorkspacePath || !args.cases.length) {
    throw new Error('Usage: tsx tools/computer-use-chat-live-case-isolation.ts --matrix-run-id ID --base-workspace PATH --case CASE_ID[:TASK_ID[:SCENARIO_ID]] [--out PATH] [--materialize]');
  }
  const plan = await buildComputerUseChatLiveCaseIsolationSeedPlan({
    matrixRunId: args.matrixRunId,
    baseWorkspacePath: args.baseWorkspacePath,
    cases: args.cases,
    strategy: args.strategy,
    materialize: args.materialize,
  });
  if (args.out) {
    const outputPath = resolve(args.out);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  } else {
    process.stdout.write(`[${plan.issues.length ? 'failed' : 'planned'}] Computer Use chat live case isolation plan; cases=${plan.cases.length}; strategy=${plan.strategy}; issues=${plan.issues.length}\n`);
    if (args.out) process.stdout.write(`  manifest: ${resolve(args.out)}\n`);
    for (const item of plan.cases) {
      process.stdout.write(`  - ${item.id}: workspace=${item.workspace.caseWorkspacePath}; session=${item.sessionId}; reset=${item.workspace.resetManifestRef}\n`);
    }
  }
}

async function materializeSeedPlan(plan: ComputerUseChatLiveCaseIsolationSeedPlan): Promise<void> {
  await Promise.all(plan.cases.map(async (item) => {
    await Promise.all([
      mkdir(item.workspace.caseWorkspacePath, { recursive: true }),
      mkdir(resolve(item.workspace.caseWorkspacePath, item.workspace.windowStateRootRef), { recursive: true }),
      mkdir(resolve(item.workspace.caseWorkspacePath, item.workspace.tempRootRef), { recursive: true }),
      mkdir(resolve(item.workspace.caseWorkspacePath, item.workspace.plannerMemoryRootRef), { recursive: true }),
    ]);
    const seedPath = resolve(item.workspace.caseWorkspacePath, item.workspace.seedManifestRef);
    await mkdir(dirname(seedPath), { recursive: true });
    await writeFile(seedPath, `${JSON.stringify({
      schemaVersion: 'sciforge.computer-use.chat-live-case-isolation.workspace-seed.v1',
      matrixRunId: plan.matrixRunId,
      caseId: item.id,
      caseRunId: item.caseRunId,
      sessionId: item.sessionId,
      currentTurnId: item.currentTurnId,
      strategy: plan.strategy,
      workspace: item.workspace,
      isolationContract: item.isolationContract,
    }, null, 2)}\n`);
  }));
}

function casePlanForInput(input: {
  item: ComputerUseChatLiveCaseIsolationCaseInput;
  index: number;
  matrixRunId: string;
  baseWorkspacePath: string;
  strategy: ComputerUseChatLiveCaseIsolationStrategy;
  previousCaseIds: string[];
}): ComputerUseChatLiveCaseIsolationSeedPlanCase {
  const id = safeId(input.item.id || `case-${input.index + 1}`);
  const caseRunId = safeId(`${input.matrixRunId}-${String(input.index + 1).padStart(2, '0')}-${id}`);
  const caseWorkspaceRef = `.sciforge/case-workspaces/${input.matrixRunId}/${String(input.index + 1).padStart(2, '0')}-${id}`;
  const caseWorkspacePath = resolve(input.baseWorkspacePath, caseWorkspaceRef);
  return {
    id,
    taskId: input.item.taskId,
    scenarioId: input.item.scenarioId,
    expectedStatus: input.item.expectedStatus,
    caseIndex: input.index,
    caseRunId,
    sessionId: caseRunId,
    currentTurnId: `${caseRunId}-turn`,
    workspace: {
      kind: input.strategy,
      baseWorkspacePath: input.baseWorkspacePath,
      caseWorkspacePath,
      caseWorkspaceRef,
      seedManifestRef: '.sciforge/case-isolation/workspace-seed.json',
      resetManifestRef: '.sciforge/case-isolation/case-reset-manifest.json',
      windowStateRootRef: `.sciforge/window-state/${caseRunId}`,
      tempRootRef: `.sciforge/tmp/${caseRunId}`,
      plannerMemoryRootRef: `.sciforge/planner-memory/${caseRunId}`,
      forkPolicy: {
        copyFromBaseWorkspace: [
          'input/**',
          'fixtures/**',
          'references/**',
          '.sciforge/project.json',
        ],
        excludeFromFork: [
          '.sciforge/vision-runs/**',
          '.sciforge/window-state/**',
          '.sciforge/tmp/**',
          '.sciforge/planner-memory/**',
          '**/.DS_Store',
        ],
        recreateEmpty: [
          '.sciforge/vision-runs',
          '.sciforge/window-state',
          '.sciforge/tmp',
          '.sciforge/planner-memory',
        ],
      },
    },
    isolationContract: {
      windowStateScopeId: `window:${caseRunId}`,
      tempScopeId: `temp:${caseRunId}`,
      plannerMemoryScopeId: `planner:${caseRunId}`,
      forbiddenPreviousCaseIds: input.previousCaseIds,
    },
  };
}

function workspaceForkCheck(
  planCase: ComputerUseChatLiveCaseIsolationSeedPlanCase,
  observed: ComputerUseChatLiveCaseIsolationObservedState,
  previousCases: ComputerUseChatLiveCaseIsolationResetManifest['previousCases'],
): ComputerUseChatLiveCaseIsolationResetCheck {
  const issues = [
    resolve(observed.workspacePath) !== resolve(planCase.workspace.caseWorkspacePath)
      ? `workspace-path-mismatch:expected:${planCase.workspace.caseWorkspacePath}`
      : '',
    previousCases.some((item) => resolve(item.workspacePath) === resolve(observed.workspacePath))
      ? 'workspace-path-reused-from-previous-case'
      : '',
  ].filter(Boolean);
  return {
    kind: 'workspace-fork',
    status: issues.length ? 'failed' : 'passed',
    note: issues.length
      ? 'Observed workspace does not satisfy the per-case fork/reset fixture contract.'
      : 'Observed workspace is case-scoped and distinct from previous case workspaces.',
    refs: [workspaceRef(planCase.workspace.baseWorkspacePath, observed.workspacePath)],
    issues,
  };
}

function sessionTurnSeedCheck(
  planCase: ComputerUseChatLiveCaseIsolationSeedPlanCase,
  observed: ComputerUseChatLiveCaseIsolationObservedState,
  previousCases: ComputerUseChatLiveCaseIsolationResetManifest['previousCases'],
): ComputerUseChatLiveCaseIsolationResetCheck {
  const issues = [
    observed.sessionId !== planCase.sessionId ? `session-id-mismatch:expected:${planCase.sessionId}` : '',
    observed.currentTurnId !== planCase.currentTurnId ? `current-turn-id-mismatch:expected:${planCase.currentTurnId}` : '',
    previousCases.some((item) => item.sessionId === observed.sessionId) ? 'session-id-reused-from-previous-case' : '',
    previousCases.some((item) => item.currentTurnId === observed.currentTurnId) ? 'current-turn-id-reused-from-previous-case' : '',
  ].filter(Boolean);
  return {
    kind: 'session-turn-seed',
    status: issues.length ? 'failed' : 'passed',
    note: issues.length
      ? 'Session or turn seed was reused or did not match the isolation plan.'
      : 'Session and turn seeds are unique for this case.',
    refs: [observed.sessionId, observed.currentTurnId],
    issues,
  };
}

function windowStateResetCheck(
  planCase: ComputerUseChatLiveCaseIsolationSeedPlanCase,
  observed: ComputerUseChatLiveCaseIsolationObservedState,
  previousCases: ComputerUseChatLiveCaseIsolationResetManifest['previousCases'],
): ComputerUseChatLiveCaseIsolationResetCheck {
  const previousRefs = new Set(previousCases.flatMap((item) => item.windowStateRefs));
  const previousCaseIds = new Set(previousCases.map((item) => item.caseId));
  const reusedRefs = observed.windowState.refs.filter((ref) => previousRefs.has(ref));
  const leakedMarkers = (observed.windowState.priorCaseMarkers ?? []).filter((marker) => previousCaseIds.has(safeId(marker)));
  const issues = [
    observed.windowState.scopeId !== planCase.isolationContract.windowStateScopeId
      ? `window-state-scope-mismatch:expected:${planCase.isolationContract.windowStateScopeId}`
      : '',
    ...reusedRefs.map((ref) => `window-state-ref-reused:${ref}`),
    ...leakedMarkers.map((marker) => `window-state-prior-case-marker:${safeId(marker)}`),
  ].filter(Boolean);
  return {
    kind: 'window-state-reset',
    status: issues.length ? 'failed' : 'passed',
    note: issues.length
      ? 'Current case window state contains prior-case scope, refs, or markers.'
      : 'Window state is scoped to this case and contains no previous-case markers.',
    refs: observed.windowState.refs,
    issues,
  };
}

function tempFileResetCheck(
  planCase: ComputerUseChatLiveCaseIsolationSeedPlanCase,
  observed: ComputerUseChatLiveCaseIsolationObservedState,
  previousCases: ComputerUseChatLiveCaseIsolationResetManifest['previousCases'],
): ComputerUseChatLiveCaseIsolationResetCheck {
  const previousRefs = new Set(previousCases.flatMap((item) => item.tempFileRefs));
  const previousRoots = previousCases.map((item) => trimSlash(item.tempRootRef));
  const reusedRefs = observed.tempFiles.refs.filter((ref) => previousRefs.has(ref));
  const refsUnderPreviousRoot = observed.tempFiles.refs.filter((ref) => previousRoots.some((root) => trimSlash(ref).startsWith(`${root}/`)));
  const issues = [
    observed.tempFiles.rootRef !== planCase.workspace.tempRootRef
      ? `temp-root-mismatch:expected:${planCase.workspace.tempRootRef}`
      : '',
    ...reusedRefs.map((ref) => `temp-file-ref-reused:${ref}`),
    ...refsUnderPreviousRoot.map((ref) => `temp-file-from-previous-case-root:${ref}`),
  ].filter(Boolean);
  return {
    kind: 'temp-file-reset',
    status: issues.length ? 'failed' : 'passed',
    note: issues.length
      ? 'Current case temporary files overlap with previous case temporary state.'
      : 'Temporary files are rooted under this case and do not reuse previous refs.',
    refs: [observed.tempFiles.rootRef, ...observed.tempFiles.refs],
    issues,
  };
}

function plannerMemoryResetCheck(
  planCase: ComputerUseChatLiveCaseIsolationSeedPlanCase,
  observed: ComputerUseChatLiveCaseIsolationObservedState,
  previousCases: ComputerUseChatLiveCaseIsolationResetManifest['previousCases'],
): ComputerUseChatLiveCaseIsolationResetCheck {
  const previousRefs = new Set(previousCases.flatMap((item) => item.plannerMemoryRefs));
  const previousCaseIds = new Set(previousCases.map((item) => item.caseId));
  const reusedRefs = observed.plannerMemory.refs.filter((ref) => previousRefs.has(ref));
  const leakedMarkers = (observed.plannerMemory.priorCaseMarkers ?? []).filter((marker) => previousCaseIds.has(safeId(marker)));
  const issues = [
    observed.plannerMemory.scopeId !== planCase.isolationContract.plannerMemoryScopeId
      ? `planner-memory-scope-mismatch:expected:${planCase.isolationContract.plannerMemoryScopeId}`
      : '',
    previousCases.some((item) => item.plannerMemoryScopeId === observed.plannerMemory.scopeId)
      ? 'planner-memory-scope-reused-from-previous-case'
      : '',
    ...reusedRefs.map((ref) => `planner-memory-ref-reused:${ref}`),
    ...leakedMarkers.map((marker) => `planner-memory-prior-case-marker:${safeId(marker)}`),
  ].filter(Boolean);
  return {
    kind: 'planner-memory-reset',
    status: issues.length ? 'failed' : 'passed',
    note: issues.length
      ? 'Current case planner memory contains prior-case scope, refs, or markers.'
      : 'Planner memory is scoped to this case and contains no previous-case markers.',
    refs: observed.plannerMemory.refs,
    issues,
  };
}

function normalizeObservedState(observed: ComputerUseChatLiveCaseIsolationObservedState): ComputerUseChatLiveCaseIsolationObservedState {
  return {
    ...observed,
    workspacePath: resolve(observed.workspacePath),
    windowState: {
      ...observed.windowState,
      refs: uniqueStrings(observed.windowState.refs),
      priorCaseMarkers: uniqueStrings((observed.windowState.priorCaseMarkers ?? []).map(safeId)),
    },
    tempFiles: {
      ...observed.tempFiles,
      refs: uniqueStrings(observed.tempFiles.refs),
    },
    plannerMemory: {
      ...observed.plannerMemory,
      refs: uniqueStrings(observed.plannerMemory.refs),
      priorCaseMarkers: uniqueStrings((observed.plannerMemory.priorCaseMarkers ?? []).map(safeId)),
    },
  };
}

function previousCaseSummaries(
  manifests: ComputerUseChatLiveCaseIsolationResetManifest[],
): ComputerUseChatLiveCaseIsolationResetManifest['previousCases'] {
  return manifests.map((manifest) => ({
    caseId: safeId(manifest.caseId),
    sessionId: manifest.observed.sessionId,
    currentTurnId: manifest.observed.currentTurnId,
    workspacePath: resolve(manifest.observed.workspacePath),
    windowStateRefs: manifest.observed.windowState.refs,
    tempRootRef: manifest.observed.tempFiles.rootRef,
    tempFileRefs: manifest.observed.tempFiles.refs,
    plannerMemoryScopeId: manifest.observed.plannerMemory.scopeId,
    plannerMemoryRefs: manifest.observed.plannerMemory.refs,
  }));
}

function emptyWorkspacePlan(baseWorkspacePath: string): ComputerUseChatLiveCaseIsolationSeedPlanCase['workspace'] {
  return {
    kind: 'per-case-workspace-fork',
    baseWorkspacePath,
    caseWorkspacePath: '',
    caseWorkspaceRef: '',
    seedManifestRef: '',
    resetManifestRef: '',
    windowStateRootRef: '',
    tempRootRef: '',
    plannerMemoryRootRef: '',
    forkPolicy: {
      copyFromBaseWorkspace: [],
      excludeFromFork: [],
      recreateEmpty: [],
    },
  };
}

function duplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates).sort();
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    cases: [],
    strategy: 'per-case-workspace-fork',
    materialize: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--matrix-run-id') args.matrixRunId = argv[++index];
    else if (arg === '--base-workspace') args.baseWorkspacePath = argv[++index];
    else if (arg === '--case') args.cases.push(parseCaseArg(argv[++index] ?? ''));
    else if (arg === '--strategy') args.strategy = parseStrategy(argv[++index] ?? '');
    else if (arg === '--out') args.out = argv[++index];
    else if (arg === '--materialize') args.materialize = true;
    else if (arg === '--json') args.json = true;
  }
  return args;
}

function parseCaseArg(value: string): ComputerUseChatLiveCaseIsolationCaseInput {
  const [id, taskId, scenarioId, expectedStatus] = value.split(':');
  return {
    id: id ?? '',
    taskId: taskId || undefined,
    scenarioId: scenarioId || undefined,
    expectedStatus: expectedStatus || undefined,
  };
}

function parseStrategy(value: string): ComputerUseChatLiveCaseIsolationStrategy {
  if (value === 'resettable-workspace-fixture') return value;
  return 'per-case-workspace-fork';
}

function safeId(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || shortHash(value || 'case');
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/g, '');
}

function workspaceRef(baseWorkspacePath: string, targetPath: string): string {
  const base = resolve(baseWorkspacePath);
  const target = resolve(targetPath);
  const rel = relative(base, target);
  if (rel && !rel.startsWith('..') && rel !== '') return rel.split(sep).join('/');
  return target;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  runComputerUseChatLiveCaseIsolationCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

export async function readComputerUseChatLiveCaseIsolationSeedPlan(path: string): Promise<ComputerUseChatLiveCaseIsolationSeedPlan> {
  return JSON.parse(await readFile(path, 'utf8')) as ComputerUseChatLiveCaseIsolationSeedPlan;
}
