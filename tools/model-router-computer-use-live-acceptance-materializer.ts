#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, utimes, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from './model-router-computer-use-live-acceptance-cases.js';
import {
  buildModelRouterComputerUseLiveAcceptanceMatrixManifest,
  type ModelRouterComputerUseLiveAcceptanceExecutorKind,
  type ModelRouterComputerUseLiveAcceptanceMatrixResult,
} from './model-router-computer-use-live-acceptance-matrix.js';

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-materializer.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-materializer-input.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_DEFAULT_RUN_ROOT =
  'docs/test-artifacts/model-router-computer-use-live-matrix/runs' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_DEFAULT_OUT_INPUT =
  'docs/test-artifacts/model-router-computer-use-live-matrix/input.json' as const;

export type ModelRouterComputerUseLiveAcceptanceMaterializerLiveAttestation = {
  realDesktopRun: boolean;
  mutatingActionExecuted: boolean;
  diagnosticOnly: boolean;
  dryRun: boolean;
  fixtureMode: boolean;
  sharedSystemInputUsed: boolean;
};

export type ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs = {
  sessionRef?: string;
  nativeHostRef?: string;
  appWindowRef?: string;
  refs?: string[];
};

export type ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs = {
  screenshotRefs?: string[];
  fileRefs?: string[];
  artifactRefs?: string[];
  terminalRefs?: string[];
  verifierSourceRefs?: string[];
};

export type ModelRouterComputerUseLiveAcceptanceMaterializerInputCase = {
  caseId: string;
  status: 'passed' | 'blocked' | 'not-evaluated';
  publicModelAlias?: string;
  routerProfile?: string;
  routerTraceRefs?: string[];
  capabilityIds?: string[];
  executorKind: ModelRouterComputerUseLiveAcceptanceExecutorKind;
  sourceRefs?: string[];
  executorSourceRefs?: ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs;
  liveAttestation: ModelRouterComputerUseLiveAcceptanceMaterializerLiveAttestation;
  evidenceRefs: ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs;
};

export type ModelRouterComputerUseLiveAcceptanceMaterializerInput = {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  completedAt: string;
  publicModelAlias?: string;
  routerProfile?: string;
  cases: ModelRouterComputerUseLiveAcceptanceMaterializerInputCase[];
};

export type ModelRouterComputerUseLiveAcceptanceMaterializerOptions = {
  input?: ModelRouterComputerUseLiveAcceptanceMaterializerInput;
  inputPath?: string;
  outInputPath?: string;
  outPath?: string;
  runRootPath?: string;
  now?: () => Date;
};

export type ModelRouterComputerUseLiveAcceptanceMaterializerManifest = {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_SCHEMA_VERSION;
  checkedAt: string;
  status: 'completed' | 'blocked';
  releaseAcceptance: 'not-evaluated';
  evidenceMode: 'materialized-current-run-input-only';
  source: {
    kind: 'inline-input' | 'input-file' | 'missing-input';
    ref?: string;
    valuePrinted: false;
  };
  caseOutputs: Array<{
    caseId: string;
    status: 'materialized' | 'blocked' | 'missing';
    currentRunRef?: string;
    guiPresentRef?: string;
    verifierRef?: string;
    resultRef?: string;
    issues: string[];
    issueRefs: string[];
    valuePrinted: false;
  }>;
  matrixPrecheck: {
    status: 'passed' | 'blocked';
    issues: string[];
    releaseAcceptance: 'not-evaluated';
  };
  outputs: {
    matrixInputRef: string;
    matrixInputWritten: boolean;
    valuePrinted: false;
  };
  issues: string[];
  policyViolations: string[];
  nextActions: Array<{
    label: string;
    command?: string;
    writesRepo: false;
  }>;
};

type CliArgs = {
  inputPath?: string;
  outInputPath?: string;
  outPath?: string;
  runRootPath?: string;
  strict: boolean;
  json: boolean;
};

type MaterializedCase = {
  caseId: string;
  result: ModelRouterComputerUseLiveAcceptanceMatrixResult;
  files: Array<{ ref: string; value: unknown | string; json: boolean }>;
};

const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);
const requiredCaseIdSet: ReadonlySet<string> = new Set(requiredCaseIds);
const allowedExecutorKinds = new Set<ModelRouterComputerUseLiveAcceptanceExecutorKind>([
  'desktop-native-host',
  'native-host',
  'app-window',
]);

const forbiddenDiagnosticPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|api[_-]?key|secret|token|credential|password|baseUrl|endpoint|requestBody|responseBody|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

export async function runModelRouterComputerUseLiveAcceptanceMaterializer(
  options: ModelRouterComputerUseLiveAcceptanceMaterializerOptions = {},
): Promise<ModelRouterComputerUseLiveAcceptanceMaterializerManifest> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const loadedInput = options.input ?? await loadInput(options.inputPath);
  const source = sourceFor(options.input, options.inputPath, loadedInput);
  const outInputPath = options.outInputPath ?? MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_DEFAULT_OUT_INPUT;
  const runRootPath = options.runRootPath ?? MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_DEFAULT_RUN_ROOT;
  const outInputRef = publicPathRef(outInputPath);

  const validation = await validateAndBuildCases(loadedInput, {
    checkedAt,
    runRootPath,
  });
  const matrix = buildModelRouterComputerUseLiveAcceptanceMatrixManifest({
    checkedAt,
    results: validation.materializedCases.map((item) => item.result),
  });
  const matrixIssues = matrix.issues.map(safeIssueLabel);
  const issues = uniqueStrings([
    ...validation.issues,
    ...(matrix.status === 'passed' ? [] : ['matrix-precheck-blocked']),
  ]);
  const status = issues.length === 0 ? 'completed' : 'blocked';
  const matrixInput = {
    checkedAt,
    results: validation.materializedCases.map((item) => item.result),
  };

  if (status === 'completed') {
    await writeMaterializedCases(validation.materializedCases, checkedAt);
    await mkdir(dirname(resolve(outInputPath)), { recursive: true });
    await writeFile(resolve(outInputPath), `${JSON.stringify(matrixInput, null, 2)}\n`, 'utf8');
  }

  const manifest: ModelRouterComputerUseLiveAcceptanceMaterializerManifest = {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_SCHEMA_VERSION,
    checkedAt,
    status,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'materialized-current-run-input-only',
    source,
    caseOutputs: validation.caseOutputs.map((item) => ({
      ...item,
      status: status === 'completed' && item.status === 'blocked' ? 'materialized' : item.status,
    })),
    matrixPrecheck: {
      status: matrix.status === 'passed' ? 'passed' : 'blocked',
      issues: matrixIssues,
      releaseAcceptance: 'not-evaluated',
    },
    outputs: {
      matrixInputRef: outInputRef,
      matrixInputWritten: status === 'completed',
      valuePrinted: false,
    },
    issues,
    policyViolations: validation.policyViolations,
    nextActions: nextActions(outInputRef),
  };

  if (options.outPath) {
    await mkdir(dirname(resolve(options.outPath)), { recursive: true });
    await writeFile(resolve(options.outPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return manifest;
}

export async function runModelRouterComputerUseLiveAcceptanceMaterializerCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const manifest = await runModelRouterComputerUseLiveAcceptanceMaterializer({
    inputPath: args.inputPath,
    outInputPath: args.outInputPath,
    outPath: args.outPath,
    runRootPath: args.runRootPath,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[${manifest.status}] Model Router Computer Use live acceptance materializer; materialized=${manifest.caseOutputs.filter((item) => item.status === 'materialized').length}/${manifest.caseOutputs.length}; issues=${manifest.issues.length}\n`,
    );
    for (const action of manifest.nextActions) {
      process.stdout.write(`  - ${action.label}${action.command ? ` (${action.command})` : ''}\n`);
    }
  }
  if (args.strict && manifest.status !== 'completed') process.exitCode = 1;
}

async function validateAndBuildCases(
  input: ModelRouterComputerUseLiveAcceptanceMaterializerInput | undefined,
  context: {
    checkedAt: string;
    runRootPath: string;
  },
) {
  const issues: string[] = [];
  const policyViolations: string[] = [];
  const materializedCases: MaterializedCase[] = [];
  const caseOutputs: ModelRouterComputerUseLiveAcceptanceMaterializerManifest['caseOutputs'] = [];
  const runRootRef = publicPathRef(context.runRootPath);

  if (!input) {
    return {
      issues: ['missing-materializer-input'],
      policyViolations,
      materializedCases,
      caseOutputs: requiredCaseIds.map((caseId) => missingCaseOutput(caseId, 'missing-materializer-input')),
    };
  }
  if (input.schemaVersion !== MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION) {
    issues.push('input-schema-version-mismatch');
  }
  if (!safePathSegment(input.runId)) {
    issues.push('run-id-invalid');
  }
  if (!timestampMs(input.startedAt) || !timestampMs(input.completedAt) || Number(timestampMs(input.completedAt)) < Number(timestampMs(input.startedAt))) {
    issues.push('run-window-invalid');
  }
  if (!isWorkspaceDirectoryRef(runRootRef)) {
    issues.push('run-root-ref-invalid');
  }
  if (hasForbiddenString(input)) {
    issues.push('forbidden-diagnostic-payload');
    policyViolations.push('forbidden-diagnostic-payload');
  }

  const duplicates = duplicateCaseIds(input.cases);
  issues.push(...duplicates.map((caseId) => `duplicate-case:${safeIssueLabel(caseId)}`));
  for (const item of input.cases) {
    if (!requiredCaseIdSet.has(item.caseId)) issues.push(`unknown-case:${safeIssueLabel(item.caseId)}`);
  }

  const casesById = new Map(input.cases.map((item) => [item.caseId, item]));
  for (const caseId of requiredCaseIds) {
    const inputCase = casesById.get(caseId);
    if (!inputCase) {
      const issue = `missing-case:${caseId}`;
      issues.push(issue);
      caseOutputs.push(missingCaseOutput(caseId, issue));
      continue;
    }
    const built = await materializedCaseFromInputCase(input, inputCase, {
      checkedAt: context.checkedAt,
      runRootRef,
    });
    issues.push(...built.issues.map((issue) => `${caseId}:${issue}`));
    policyViolations.push(...built.policyViolations);
    caseOutputs.push({
      caseId,
      status: 'blocked',
      currentRunRef: built.materializedCase?.result.executor?.currentRunRef,
      guiPresentRef: built.materializedCase?.result.gui?.presentRef,
      verifierRef: built.materializedCase?.result.evidenceRefs?.verifierRefs?.[0],
      resultRef: built.materializedCase ? `result:${sha256Hex(JSON.stringify(built.materializedCase.result)).slice(0, 16)}` : undefined,
      issues: built.issues.map(safeIssueLabel),
      issueRefs: built.issues.map(issueRef),
      valuePrinted: false,
    });
    if (built.issues.length === 0 && built.materializedCase) {
      materializedCases.push(built.materializedCase);
    }
  }

  return {
    issues: uniqueStrings(issues.map(safeIssueLabel)),
    policyViolations: uniqueStrings(policyViolations.map(safeIssueLabel)),
    materializedCases: issues.length === 0 ? materializedCases : [],
    caseOutputs,
  };
}

async function materializedCaseFromInputCase(
  input: ModelRouterComputerUseLiveAcceptanceMaterializerInput,
  inputCase: ModelRouterComputerUseLiveAcceptanceMaterializerInputCase,
  context: {
    checkedAt: string;
    runRootRef: string;
  },
): Promise<{
  materializedCase?: MaterializedCase;
  issues: string[];
  policyViolations: string[];
}> {
  const matrixCase = modelRouterComputerUseLiveAcceptanceCases.find((item) => item.id === inputCase.caseId);
  const issues: string[] = [];
  const policyViolations: string[] = [];
  const caseRootRef = `${context.runRootRef}/${input.runId}/${inputCase.caseId}`;
  const liveAttestation = inputCase.liveAttestation;

  if (!matrixCase) return { issues: ['unknown-case'], policyViolations };
  if (inputCase.status !== 'passed') issues.push(`case-${inputCase.status}`);
  if (!allowedExecutorKinds.has(inputCase.executorKind)) issues.push('executor-kind-invalid');
  if (!matrixCase.allowedExecutorKinds.includes(inputCase.executorKind)) issues.push('executor-kind-not-allowed-for-case');
  if (!liveAttestation?.realDesktopRun) issues.push('live-attestation-real-desktop-run-missing');
  if (!liveAttestation?.mutatingActionExecuted) issues.push('live-attestation-mutating-action-missing');
  if (liveAttestation?.diagnosticOnly) issues.push('live-attestation-diagnostic-only');
  if (liveAttestation?.dryRun) issues.push('live-attestation-dry-run');
  if (liveAttestation?.fixtureMode) issues.push('live-attestation-fixture-mode');
  if (liveAttestation?.sharedSystemInputUsed) issues.push('live-attestation-shared-system-input');
  if (hasForbiddenString(inputCase)) {
    issues.push('forbidden-diagnostic-payload');
    policyViolations.push('forbidden-diagnostic-payload');
  }

  const publicModelAlias = safePublicValue(inputCase.publicModelAlias ?? input.publicModelAlias);
  const routerProfile = safePublicValue(inputCase.routerProfile ?? input.routerProfile);
  if (!publicModelAlias) issues.push('missing-public-model-alias');
  if (!routerProfile) issues.push('missing-router-profile');

  const routerTraceRefs = safeWorkspaceRefs(inputCase.routerTraceRefs);
  if (routerTraceRefs.length === 0) issues.push('missing-router-trace-refs');
  if (routerTraceRefs.length !== (inputCase.routerTraceRefs ?? []).length) issues.push('unsafe-source-or-evidence-ref');
  if (!await allRefsExist(routerTraceRefs)) issues.push('unsafe-source-or-evidence-ref');

  for (const capabilityId of matrixCase.requiredCapabilityIds) {
    if (!(inputCase.capabilityIds ?? []).includes(capabilityId)) issues.push(`missing-capability:${capabilityId}`);
  }
  const declaredSourceRefs = inputCase.sourceRefs ?? [];
  const executorSourceRefs = sourceRefsFromExecutorSourceRefs(inputCase.executorSourceRefs);
  if (uiProjectionSourceRefs([...declaredSourceRefs, ...executorSourceRefs])) issues.push('ui-projection-source-not-action-runner');
  if (unsafeSourceRefs(declaredSourceRefs)) issues.push('unsafe-source-or-evidence-ref');
  if (unsafeSourceRefs(executorSourceRefs)) issues.push('unsafe-source-or-evidence-ref');

  const requiredEvidenceIssues = await requiredEvidenceIssuesFor(matrixCase.requiredEvidenceKinds, inputCase.evidenceRefs);
  issues.push(...requiredEvidenceIssues);

  const currentRunRef = `${caseRootRef}/current-run.json`;
  const executorRef = `${caseRootRef}/executor.json`;
  const sessionRef = `${caseRootRef}/session.json`;
  const nativeHostRef = `${caseRootRef}/native-host.json`;
  const appWindowRef = `${caseRootRef}/app-window.json`;
  const executorSurfaceRef = `${caseRootRef}/executor-surface.json`;
  const guiPresentRef = `${caseRootRef}/gui-present.json`;
  const verifierRef = `${caseRootRef}/verifier.json`;

  const screenshotRefs = materializedEvidenceRefs(caseRootRef, 'screenshot', inputCase.evidenceRefs.screenshotRefs);
  const fileRefs = materializedEvidenceRefs(caseRootRef, 'file', inputCase.evidenceRefs.fileRefs);
  const artifactRefs = materializedEvidenceRefs(caseRootRef, 'artifact', inputCase.evidenceRefs.artifactRefs);
  const terminalRefs = materializedEvidenceRefs(caseRootRef, 'terminal', inputCase.evidenceRefs.terminalRefs);

  const result: ModelRouterComputerUseLiveAcceptanceMatrixResult = {
    caseId: inputCase.caseId,
    status: 'passed',
    publicModelAlias,
    routerProfile,
    routerTraceRefs,
    capabilityIds: inputCase.capabilityIds ?? [],
    executor: {
      kind: inputCase.executorKind,
      currentRunRef,
      executorRef,
      sessionRef: inputCase.executorKind === 'app-window' ? undefined : sessionRef,
      nativeHostRef: inputCase.executorKind === 'app-window' ? undefined : nativeHostRef,
      appWindowRef: inputCase.executorKind === 'app-window' ? appWindowRef : undefined,
      refs: [executorSurfaceRef],
    },
    evidenceRefs: {
      screenshotRefs,
      fileRefs,
      artifactRefs,
      terminalRefs,
      verifierRefs: [verifierRef],
    },
    gui: {
      presentRef: guiPresentRef,
    },
  };

  const attestationSummary = {
    realDesktopRun: true,
    mutatingActionExecuted: true,
    diagnosticOnly: false,
    dryRun: false,
    fixtureMode: false,
    sharedSystemInputUsed: false,
  };
  const files: MaterializedCase['files'] = [
    {
      ref: currentRunRef,
      json: true,
      value: {
        schemaVersion: 'sciforge.model-router.computer-use.current-run.v1',
        runId: input.runId,
        caseId: inputCase.caseId,
        startedAt: input.startedAt,
        completedAt: maxTimestampIso(input.completedAt, context.checkedAt),
        materializedAt: context.checkedAt,
        materializedFrom: 'refs-first-live-run-bundle',
        releaseAcceptance: 'not-evaluated',
      },
    },
    {
      ref: executorRef,
      json: true,
      value: {
        schemaVersion: 'sciforge.model-router.computer-use.executor-binding.v1',
        runId: input.runId,
        caseId: inputCase.caseId,
        kind: inputCase.executorKind,
        sourceRefs: safeSourceRefs([
          ...(inputCase.sourceRefs ?? []),
          ...sourceRefsFromExecutorSourceRefs(inputCase.executorSourceRefs),
        ]),
        liveAttestation: attestationSummary,
      },
    },
    {
      ref: executorSurfaceRef,
      json: true,
      value: {
        schemaVersion: 'sciforge.model-router.computer-use.executor-surface.v1',
        runId: input.runId,
        caseId: inputCase.caseId,
        sourceRefs: safeSourceRefs(inputCase.executorSourceRefs?.refs ?? []),
      },
    },
    {
      ref: guiPresentRef,
      json: true,
      value: evidenceEnvelope(input.runId, inputCase.caseId, 'gui.present', 'present', [
        ...(inputCase.evidenceRefs.screenshotRefs ?? []),
        ...(inputCase.sourceRefs ?? []),
      ], context.checkedAt),
    },
    {
      ref: verifierRef,
      json: true,
      value: evidenceEnvelope(input.runId, inputCase.caseId, 'verifier', 'passed', [
        ...(inputCase.evidenceRefs.verifierSourceRefs ?? []),
      ], context.checkedAt),
    },
    ...evidenceFiles(input.runId, inputCase.caseId, 'screenshot', screenshotRefs, inputCase.evidenceRefs.screenshotRefs, context.checkedAt),
    ...evidenceFiles(input.runId, inputCase.caseId, 'file', fileRefs, inputCase.evidenceRefs.fileRefs, context.checkedAt),
    ...evidenceFiles(input.runId, inputCase.caseId, 'artifact', artifactRefs, inputCase.evidenceRefs.artifactRefs, context.checkedAt),
    ...evidenceFiles(input.runId, inputCase.caseId, 'terminal', terminalRefs, inputCase.evidenceRefs.terminalRefs, context.checkedAt),
  ];
  if (inputCase.executorKind === 'app-window') {
    files.push({
      ref: appWindowRef,
      json: true,
      value: {
        schemaVersion: 'sciforge.model-router.computer-use.app-window-binding.v1',
        runId: input.runId,
        caseId: inputCase.caseId,
        sourceRef: safeSourceRef(inputCase.executorSourceRefs?.appWindowRef),
      },
    });
  } else {
    files.push(
      {
        ref: sessionRef,
        json: true,
        value: {
          schemaVersion: 'sciforge.model-router.computer-use.session-binding.v1',
          runId: input.runId,
          caseId: inputCase.caseId,
          sourceRef: safeSourceRef(inputCase.executorSourceRefs?.sessionRef),
        },
      },
      {
        ref: nativeHostRef,
        json: true,
        value: {
          schemaVersion: 'sciforge.model-router.computer-use.native-host-binding.v1',
          runId: input.runId,
          caseId: inputCase.caseId,
          sourceRef: safeSourceRef(inputCase.executorSourceRefs?.nativeHostRef),
        },
      },
    );
  }

  return {
    materializedCase: {
      caseId: inputCase.caseId,
      result,
      files,
    },
    issues: uniqueStrings(issues.map(safeIssueLabel)),
    policyViolations: uniqueStrings(policyViolations.map(safeIssueLabel)),
  };
}

async function writeMaterializedCases(materializedCases: MaterializedCase[], checkedAt: string) {
  const mtime = new Date(checkedAt);
  const writtenRefs: string[] = [];
  for (const item of materializedCases) {
    for (const file of item.files) {
      const target = resolve(file.ref);
      await mkdir(dirname(target), { recursive: true });
      const value = file.json ? `${JSON.stringify(file.value, null, 2)}\n` : String(file.value);
      await writeFile(target, value, 'utf8');
      writtenRefs.push(file.ref);
    }
  }
  await Promise.all(writtenRefs.map(async (ref) => {
    try {
      await utimes(resolve(ref), mtime, mtime);
    } catch {
      // Timestamp normalization is best-effort; the matrix gate still validates file presence and binding.
    }
  }));
}

function materializedEvidenceRefs(caseRootRef: string, kind: string, sourceRefs: string[] | undefined) {
  return (sourceRefs ?? []).map((_, index) => `${caseRootRef}/${kind}-${index + 1}.json`);
}

function evidenceFiles(
  runId: string,
  caseId: string,
  kind: string,
  refs: string[],
  sourceRefs: string[] | undefined,
  materializedAt: string,
): MaterializedCase['files'] {
  return refs.map((ref, index) => ({
    ref,
    json: true,
    value: evidenceEnvelope(runId, caseId, kind, 'present', [sourceRefs?.[index]].filter((item): item is string => Boolean(item)), materializedAt),
  }));
}

function evidenceEnvelope(
  runId: string,
  caseId: string,
  kind: string,
  status: string,
  sourceRefs: string[],
  materializedAt: string,
) {
  return {
    schemaVersion: 'sciforge.model-router.computer-use.evidence.v1',
    runId,
    caseId,
    kind,
    status,
    materializedAt,
    sourceRefs: safeSourceRefs(sourceRefs),
    releaseAcceptance: 'not-evaluated',
  };
}

async function requiredEvidenceIssuesFor(
  requiredKinds: readonly string[],
  evidenceRefs: ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs | undefined,
) {
  if (!evidenceRefs) return ['missing-evidence-refs'];
  const issues: string[] = [];
  const refsByKind: Record<string, string[] | undefined> = {
    screenshot: evidenceRefs.screenshotRefs,
    file: evidenceRefs.fileRefs,
    artifact: evidenceRefs.artifactRefs,
    terminal: evidenceRefs.terminalRefs,
    verifier: evidenceRefs.verifierSourceRefs,
  };
  for (const kind of requiredKinds) {
    const refs = refsByKind[kind] ?? [];
    if (refs.length === 0) issues.push(`missing-${kind}-refs`);
    if (safeWorkspaceRefs(refs).length !== refs.length) issues.push('unsafe-source-or-evidence-ref');
    if (!await allRefsExist(safeWorkspaceRefs(refs))) issues.push('unsafe-source-or-evidence-ref');
  }
  const allRefs = Object.values(refsByKind).flatMap((refs) => refs ?? []);
  if (safeWorkspaceRefs(allRefs).length !== allRefs.length) issues.push('unsafe-source-or-evidence-ref');
  return uniqueStrings(issues);
}

function sourceRefsFromExecutorSourceRefs(refs: ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs | undefined) {
  if (!refs) return [];
  return [
    refs.sessionRef,
    refs.nativeHostRef,
    refs.appWindowRef,
    ...(refs.refs ?? []),
  ].filter((item): item is string => Boolean(item));
}

async function allRefsExist(refs: string[]) {
  const checks = await Promise.all(refs.map(async (ref) => {
    try {
      await access(resolve(ref));
      return true;
    } catch {
      return false;
    }
  }));
  return checks.every(Boolean);
}

async function loadInput(path: string | undefined): Promise<ModelRouterComputerUseLiveAcceptanceMaterializerInput | undefined> {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return inputFromUnknown(parsed);
  } catch {
    return undefined;
  }
}

function inputFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMaterializerInput | undefined {
  if (!isRecord(value) || !Array.isArray(value.cases)) return undefined;
  return {
    schemaVersion: stringValue(value.schemaVersion) as typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION,
    runId: stringValue(value.runId) ?? '',
    startedAt: stringValue(value.startedAt) ?? '',
    completedAt: stringValue(value.completedAt) ?? '',
    publicModelAlias: stringValue(value.publicModelAlias),
    routerProfile: stringValue(value.routerProfile),
    cases: value.cases.map(caseFromUnknown),
  };
}

function caseFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMaterializerInputCase {
  const record = isRecord(value) ? value : {};
  return {
    caseId: stringValue(record.caseId) ?? '',
    status: statusFromUnknown(record.status),
    publicModelAlias: stringValue(record.publicModelAlias),
    routerProfile: stringValue(record.routerProfile),
    routerTraceRefs: stringArray(record.routerTraceRefs),
    capabilityIds: stringArray(record.capabilityIds),
    executorKind: stringValue(record.executorKind) as ModelRouterComputerUseLiveAcceptanceExecutorKind,
    sourceRefs: stringArray(record.sourceRefs),
    executorSourceRefs: sourceRefsFromUnknown(record.executorSourceRefs),
    liveAttestation: liveAttestationFromUnknown(record.liveAttestation),
    evidenceRefs: evidenceRefsFromUnknown(record.evidenceRefs),
  };
}

function sourceRefsFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs | undefined {
  if (!isRecord(value)) return undefined;
  return {
    sessionRef: stringValue(value.sessionRef),
    nativeHostRef: stringValue(value.nativeHostRef),
    appWindowRef: stringValue(value.appWindowRef),
    refs: stringArray(value.refs),
  };
}

function liveAttestationFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMaterializerLiveAttestation {
  const record = isRecord(value) ? value : {};
  return {
    realDesktopRun: record.realDesktopRun === true,
    mutatingActionExecuted: record.mutatingActionExecuted === true,
    diagnosticOnly: record.diagnosticOnly === true,
    dryRun: record.dryRun === true,
    fixtureMode: record.fixtureMode === true,
    sharedSystemInputUsed: record.sharedSystemInputUsed === true,
  };
}

function evidenceRefsFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs {
  const record = isRecord(value) ? value : {};
  return {
    screenshotRefs: stringArray(record.screenshotRefs),
    fileRefs: stringArray(record.fileRefs),
    artifactRefs: stringArray(record.artifactRefs),
    terminalRefs: stringArray(record.terminalRefs),
    verifierSourceRefs: stringArray(record.verifierSourceRefs),
  };
}

function sourceFor(
  inlineInput: ModelRouterComputerUseLiveAcceptanceMaterializerInput | undefined,
  inputPath: string | undefined,
  loadedInput: ModelRouterComputerUseLiveAcceptanceMaterializerInput | undefined,
): ModelRouterComputerUseLiveAcceptanceMaterializerManifest['source'] {
  if (inlineInput) return { kind: 'inline-input', valuePrinted: false };
  if (inputPath) return { kind: 'input-file', ref: loadedInput ? publicPathRef(inputPath) : `input-file:${sha256Hex(resolve(inputPath)).slice(0, 16)}`, valuePrinted: false };
  return { kind: 'missing-input', valuePrinted: false };
}

function nextActions(inputRef: string): ModelRouterComputerUseLiveAcceptanceMaterializerManifest['nextActions'] {
  return [{
    label: 'Run a fresh external trace audit and then validate the materialized input with the matrix gate.',
    command: `node --import tsx tools/model-router-computer-use-live-acceptance-matrix.ts --input ${inputRef} --trace-audit-report docs/test-artifacts/model-router-live-trace-audit/report.json --expected-known-secrets-checked 2 --strict`,
    writesRepo: false,
  }];
}

function missingCaseOutput(caseId: string, issue: string): ModelRouterComputerUseLiveAcceptanceMaterializerManifest['caseOutputs'][number] {
  return {
    caseId,
    status: 'missing',
    issues: [safeIssueLabel(issue)],
    issueRefs: [issueRef(issue)],
    valuePrinted: false,
  };
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = { strict: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') {
      parsed.inputPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out-input') {
      parsed.outInputPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      parsed.outPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--run-root') {
      parsed.runRootPath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--strict') {
      parsed.strict = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(helpText());
      process.exit(0);
    } else {
      throw new Error('Unknown Model Router Computer Use live acceptance materializer argument');
    }
  }
  return parsed;
}

function requiredValue(argv: string[], index: number, flag: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function helpText() {
  return [
    'Usage: tsx tools/model-router-computer-use-live-acceptance-materializer.ts --input input.json [--out-input input.json] [--run-root runs] [--strict] [--json]',
    '',
    'Materializes refs-first Computer Use live acceptance evidence into current-run envelopes and matrix input.',
    'This tool never grants release acceptance; it must be followed by a fresh trace audit and matrix gate validation.',
  ].join('\n');
}

function publicPathRef(path: string) {
  const absolute = resolve(path);
  const rel = relative(process.cwd(), absolute).split(sep).join('/');
  if (rel && !rel.startsWith('..') && !isAbsolute(rel) && /^(?:docs|artifacts|\.sciforge)\//u.test(rel)) return rel;
  return `path:${sha256Hex(absolute).slice(0, 16)}`;
}

function isWorkspaceFileRef(ref: string) {
  const normalized = ref.replace(/\\/g, '/');
  return !isForbiddenPublicRef(ref)
    && isSafeRelativeFileRef(normalized)
    && /^(?:docs|artifacts|\.sciforge)\//u.test(normalized);
}

function isWorkspaceDirectoryRef(ref: string) {
  return isWorkspaceFileRef(join(ref, 'probe.json').replace(/\\/g, '/'));
}

function isSafeRelativeFileRef(ref: string) {
  return Boolean(ref)
    && !isAbsolute(ref)
    && !ref.startsWith('file:')
    && !ref.includes('\0')
    && !ref.split('/').includes('..')
    && !/^[a-z][a-z0-9+.-]*:/i.test(ref);
}

function isForbiddenPublicRef(ref: string) {
  return forbiddenDiagnosticPattern.test(ref);
}

function safeWorkspaceRefs(refs: string[] | undefined) {
  return (refs ?? []).filter(isWorkspaceFileRef);
}

function unsafeSourceRefs(refs: string[]) {
  return refs.some((ref) => !safeSourceRef(ref));
}

function uiProjectionSourceRefs(refs: string[]) {
  return refs.some((ref) => /^gui\.(?:present|blocked|repair):/i.test(ref));
}

function safeSourceRefs(refs: string[]) {
  return refs.map(safeSourceRef).filter((ref): ref is string => Boolean(ref));
}

function safeSourceRef(ref: string | undefined) {
  if (!ref || forbiddenDiagnosticPattern.test(ref)) return undefined;
  if (isWorkspaceFileRef(ref)) return ref;
  if (/^(?:computer-use|computer-use-session|window|permission|approval):[a-z0-9_./:-]+$/i.test(ref)) {
    return ref;
  }
  return undefined;
}

function safePublicValue(value: string | undefined) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return undefined;
  const label = safeIssueLabel(value);
  return label.startsWith('issue:') ? undefined : label;
}

function safeIssueLabel(value: string) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return `issue:${sha256Hex(value).slice(0, 16)}`;
  return value.replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 120) || `issue:${sha256Hex(value).slice(0, 16)}`;
}

function hasForbiddenString(value: unknown): boolean {
  if (typeof value === 'string') return forbiddenDiagnosticPattern.test(value);
  if (Array.isArray(value)) return value.some(hasForbiddenString);
  if (isRecord(value)) return Object.values(value).some(hasForbiddenString);
  return false;
}

function statusFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceMaterializerInputCase['status'] {
  return value === 'passed' || value === 'blocked' || value === 'not-evaluated' ? value : 'not-evaluated';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function timestampMs(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function maxTimestampIso(left: string, right: string) {
  const leftMs = timestampMs(left) ?? 0;
  const rightMs = timestampMs(right) ?? 0;
  return new Date(Math.max(leftMs, rightMs)).toISOString();
}

function safePathSegment(value: string) {
  return /^[a-z0-9_.-]{1,96}$/i.test(value);
}

function duplicateCaseIds(cases: ModelRouterComputerUseLiveAcceptanceMaterializerInputCase[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of cases) {
    if (!item.caseId) continue;
    if (seen.has(item.caseId)) duplicates.add(item.caseId);
    else seen.add(item.caseId);
  }
  return [...duplicates].sort();
}

function issueRef(value: string) {
  return `issue:${sha256Hex(value).slice(0, 16)}`;
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

if (process.argv[1]?.endsWith('model-router-computer-use-live-acceptance-materializer.ts')) {
  await runModelRouterComputerUseLiveAcceptanceMaterializerCli(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${safeIssueLabel(message)}\n`);
    process.exitCode = 1;
  });
}
