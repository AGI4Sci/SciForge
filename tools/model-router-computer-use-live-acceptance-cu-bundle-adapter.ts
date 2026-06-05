#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  modelRouterComputerUseLiveAcceptanceCases,
} from './model-router-computer-use-live-acceptance-cases.js';
import type {
  ModelRouterComputerUseLiveAcceptanceExecutorKind,
} from './model-router-computer-use-live-acceptance-matrix.js';
import {
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_DEFAULT_OUT_INPUT,
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION,
  type ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs,
  type ModelRouterComputerUseLiveAcceptanceMaterializerInput,
  type ModelRouterComputerUseLiveAcceptanceMaterializerLiveAttestation,
  type ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs,
} from './model-router-computer-use-live-acceptance-materializer.js';

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-cu-bundle-adapter.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_INPUT_SCHEMA_VERSION =
  'sciforge.model-router.computer-use.live-acceptance-cu-bundle-adapter-input.v1' as const;

export const MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_DEFAULT_OUT_MATERIALIZER_INPUT =
  MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_DEFAULT_OUT_INPUT;

export type ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput = {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_INPUT_SCHEMA_VERSION;
  runId: string;
  startedAt: string;
  completedAt: string;
  sourceBundle: {
    kind: 'cu-next-current-run-bundle' | 'cu-long-run';
    manifestRef?: string;
    runDirRef?: string;
    traceRef: string;
    acceptanceManifestRef?: string;
    completionEvidenceRef?: string;
    taskId: string;
    scenarioId: string;
  };
  modelRouter: {
    publicModelAlias: string;
    routerProfile: string;
    routerTraceRefs?: string[];
    capabilityIds: string[];
  };
  cases: Array<{
    caseId: string;
    executorKind: ModelRouterComputerUseLiveAcceptanceExecutorKind;
    routerTraceRefs?: string[];
    capabilityIds?: string[];
    sourceRefs?: string[];
    executorSourceRefs?: ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs;
    liveAttestation: ModelRouterComputerUseLiveAcceptanceMaterializerLiveAttestation;
    evidenceRefs: ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs;
  }>;
};

export type ModelRouterComputerUseLiveAcceptanceCuBundleAdapterOptions = {
  input?: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput;
  inputPath?: string;
  outMaterializerInputPath?: string;
  outPath?: string;
  now?: () => Date;
};

export type ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest = {
  schemaVersion: typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_SCHEMA_VERSION;
  checkedAt: string;
  status: 'completed' | 'blocked';
  releaseAcceptance: 'not-evaluated';
  evidenceMode: 'cu-bundle-explicit-mapping-to-materializer-input-only';
  source: {
    kind: 'inline-input' | 'input-file' | 'missing-input';
    ref?: string;
    valuePrinted: false;
  };
  sourceBundle: {
    kind?: string;
    taskId?: string;
    scenarioId?: string;
    status: 'accepted' | 'blocked' | 'missing';
    refs: {
      manifestRef?: string;
      runDirRef?: string;
      traceRef?: string;
      acceptanceManifestRef?: string;
      completionEvidenceRef?: string;
    };
    issues: string[];
    issueRefs: string[];
    valuePrinted: false;
  };
  caseMappings: Array<{
    caseId: string;
    status: 'mapped' | 'blocked' | 'missing';
    executorKind?: string;
    routerTraceRefCount: number;
    evidenceRefCount: number;
    issues: string[];
    issueRefs: string[];
    valuePrinted: false;
  }>;
  outputs: {
    materializerInputRef: string;
    materializerInputWritten: boolean;
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
  outMaterializerInputPath?: string;
  outPath?: string;
  strict: boolean;
  json: boolean;
};

type SourceBundleValidation = {
  issues: string[];
  policyViolations: string[];
};

type CaseValidation = {
  issues: string[];
  policyViolations: string[];
  caseMappings: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['caseMappings'];
  materializerCases: ModelRouterComputerUseLiveAcceptanceMaterializerInput['cases'];
};

const requiredCaseIds = modelRouterComputerUseLiveAcceptanceCases.map((item) => item.id);
const requiredCaseIdSet: ReadonlySet<string> = new Set(requiredCaseIds);
const allowedExecutorKinds = new Set<ModelRouterComputerUseLiveAcceptanceExecutorKind>([
  'desktop-native-host',
  'native-host',
  'app-window',
]);
const allowedSourceBundleKinds = new Set(['cu-next-current-run-bundle', 'cu-long-run']);
const forbiddenDiagnosticPattern =
  /data:image|;base64,|[A-Za-z0-9+/]{120,}={0,2}|rawProviderPayload|providerPayload|Authorization|Bearer|api[_-]?key|secret|token|credential|password|baseUrl|endpoint|requestBody|responseBody|https?:\/\/|(?:^|[\s"'([{])(?:file:\/\/)?(?:\/(?:Applications|Users|Volumes|private|tmp|var|home|opt|etc)\/|[A-Za-z]:\\|\\\\)|qwen3\.7-plus|deepseek-v4-flash|raw-private-model/i;

export async function runModelRouterComputerUseLiveAcceptanceCuBundleAdapter(
  options: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterOptions = {},
): Promise<ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest> {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const loadedInput = options.input ?? await loadInput(options.inputPath);
  const source = sourceFor(options.input, options.inputPath, loadedInput);
  const outMaterializerInputPath = options.outMaterializerInputPath
    ?? MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_DEFAULT_OUT_MATERIALIZER_INPUT;
  const materializerInputRef = publicPathRef(outMaterializerInputPath);

  const validation = await validateAndBuildInput(loadedInput);
  const issues = uniqueStrings(validation.issues.map(safeIssueLabel));
  const policyViolations = uniqueStrings(validation.policyViolations.map(safeIssueLabel));
  const status = issues.length === 0 ? 'completed' : 'blocked';
  const materializerInput = validation.materializerInput;

  if (status === 'completed' && materializerInput) {
    await mkdir(dirname(resolve(outMaterializerInputPath)), { recursive: true });
    await writeFile(resolve(outMaterializerInputPath), `${JSON.stringify(materializerInput, null, 2)}\n`, 'utf8');
  }

  const manifest: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest = {
    schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_SCHEMA_VERSION,
    checkedAt,
    status,
    releaseAcceptance: 'not-evaluated',
    evidenceMode: 'cu-bundle-explicit-mapping-to-materializer-input-only',
    source,
    sourceBundle: validation.sourceBundle,
    caseMappings: validation.caseMappings,
    outputs: {
      materializerInputRef,
      materializerInputWritten: status === 'completed',
      valuePrinted: false,
    },
    issues,
    policyViolations,
    nextActions: nextActions(materializerInputRef),
  };

  if (options.outPath) {
    await mkdir(dirname(resolve(options.outPath)), { recursive: true });
    await writeFile(resolve(options.outPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  }
  return manifest;
}

export async function runModelRouterComputerUseLiveAcceptanceCuBundleAdapterCli(argv = process.argv): Promise<void> {
  const args = parseArgs(argv.slice(2));
  const manifest = await runModelRouterComputerUseLiveAcceptanceCuBundleAdapter({
    inputPath: args.inputPath,
    outMaterializerInputPath: args.outMaterializerInputPath,
    outPath: args.outPath,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    process.stdout.write(
      `[${manifest.status}] Model Router Computer Use CU bundle adapter; mapped=${manifest.caseMappings.filter((item) => item.status === 'mapped').length}/${manifest.caseMappings.length}; issues=${manifest.issues.length}\n`,
    );
    for (const action of manifest.nextActions) {
      process.stdout.write(`  - ${action.label}${action.command ? ` (${action.command})` : ''}\n`);
    }
  }
  if (args.strict && manifest.status !== 'completed') process.exitCode = 1;
}

async function validateAndBuildInput(input: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput | undefined): Promise<{
  issues: string[];
  policyViolations: string[];
  sourceBundle: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['sourceBundle'];
  caseMappings: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['caseMappings'];
  materializerInput?: ModelRouterComputerUseLiveAcceptanceMaterializerInput;
}> {
  const issues: string[] = [];
  const policyViolations: string[] = [];
  if (!input) {
    return {
      issues: ['missing-cu-bundle-adapter-input'],
      policyViolations,
      sourceBundle: missingSourceBundle('missing-cu-bundle-adapter-input'),
      caseMappings: requiredCaseIds.map((caseId) => missingCaseMapping(caseId, 'missing-cu-bundle-adapter-input')),
    };
  }

  if (input.schemaVersion !== MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_INPUT_SCHEMA_VERSION) {
    issues.push('input-schema-version-mismatch');
  }
  if (!safePathSegment(input.runId)) issues.push('run-id-invalid');
  if (!timestampMs(input.startedAt) || !timestampMs(input.completedAt) || Number(timestampMs(input.completedAt)) < Number(timestampMs(input.startedAt))) {
    issues.push('run-window-invalid');
  }
  if (hasForbiddenString(input)) {
    issues.push('forbidden-diagnostic-payload');
    policyViolations.push('forbidden-diagnostic-payload');
  }
  if (!safePublicValue(input.modelRouter?.publicModelAlias)) issues.push('model-router-public-alias-unsafe');
  if (!safePublicValue(input.modelRouter?.routerProfile)) issues.push('model-router-profile-unsafe');

  const sourceValidation = await validateSourceBundle(input);
  issues.push(...sourceValidation.issues);
  policyViolations.push(...sourceValidation.policyViolations);

  const caseValidation = await validateCases(input);
  issues.push(...caseValidation.issues);
  policyViolations.push(...caseValidation.policyViolations);

  const materializerInput: ModelRouterComputerUseLiveAcceptanceMaterializerInput | undefined = issues.length === 0
    ? {
      schemaVersion: MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_MATERIALIZER_INPUT_SCHEMA_VERSION,
      runId: input.runId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      publicModelAlias: safePublicValue(input.modelRouter.publicModelAlias),
      routerProfile: safePublicValue(input.modelRouter.routerProfile),
      cases: caseValidation.materializerCases,
    }
    : undefined;

  return {
    issues: uniqueStrings(issues),
    policyViolations: uniqueStrings(policyViolations),
    sourceBundle: {
      kind: safeOptionalValue(input.sourceBundle?.kind),
      taskId: safeOptionalValue(input.sourceBundle?.taskId),
      scenarioId: safeOptionalValue(input.sourceBundle?.scenarioId),
      status: sourceValidation.issues.length === 0 ? 'accepted' : 'blocked',
      refs: {
        manifestRef: safePublicRef(input.sourceBundle?.manifestRef),
        runDirRef: safePublicRef(input.sourceBundle?.runDirRef),
        traceRef: safePublicRef(input.sourceBundle?.traceRef),
        acceptanceManifestRef: safePublicRef(input.sourceBundle?.acceptanceManifestRef),
        completionEvidenceRef: safePublicRef(input.sourceBundle?.completionEvidenceRef),
      },
      issues: sourceValidation.issues.map(safeIssueLabel),
      issueRefs: sourceValidation.issues.map(issueRef),
      valuePrinted: false,
    },
    caseMappings: caseValidation.caseMappings,
    materializerInput,
  };
}

async function validateSourceBundle(
  input: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput,
): Promise<SourceBundleValidation> {
  const issues: string[] = [];
  const policyViolations: string[] = [];
  const bundle = input.sourceBundle;
  if (!bundle || !isRecord(bundle)) {
    return { issues: ['source-bundle-missing'], policyViolations };
  }
  if (!allowedSourceBundleKinds.has(bundle.kind)) issues.push('source-bundle-kind-invalid');
  if (!safeTaskLabel(bundle.taskId)) issues.push('source-bundle-task-id-invalid');
  if (!safeTaskLabel(bundle.scenarioId)) issues.push('source-bundle-scenario-id-invalid');

  const checkedRefs = [
    bundle.manifestRef,
    bundle.runDirRef,
    bundle.traceRef,
    bundle.acceptanceManifestRef,
    bundle.completionEvidenceRef,
  ].filter((item): item is string => Boolean(item));
  const refStatuses = await Promise.all(checkedRefs.map(workspaceRefStatus));
  if (!bundle.traceRef || refStatuses.some((item) => !item.ok)) {
    issues.push('source-bundle-ref-unsafe');
  }

  const trace = await readJsonRef(bundle.traceRef);
  const acceptance = await readJsonRef(bundle.acceptanceManifestRef);
  const completion = await readJsonRef(bundle.completionEvidenceRef);
  if (bundle.traceRef && !trace.loaded) issues.push('source-bundle-trace-unreadable');
  if (bundle.acceptanceManifestRef && !acceptance.loaded) issues.push('source-bundle-acceptance-manifest-unreadable');
  if (bundle.completionEvidenceRef && !completion.loaded) issues.push('source-bundle-completion-evidence-unreadable');

  if (trace.record) {
    if (stringValue(trace.record.taskId) && trace.record.taskId !== bundle.taskId) issues.push('source-bundle-task-binding-mismatch');
    if (stringValue(trace.record.scenarioId) && trace.record.scenarioId !== bundle.scenarioId) issues.push('source-bundle-scenario-binding-mismatch');
    const config = isRecord(trace.record.config) ? trace.record.config : {};
    if (config.dryRun === true) issues.push('source-bundle-dry-run');
    if (config.testActionFixtureMode === true) issues.push('source-bundle-fixture-mode');
    if (config.allowSharedSystemInput === true) issues.push('source-bundle-shared-system-input');
  }

  if (acceptance.record) {
    const acceptedTaskId = stringValue(acceptance.record.taskId) ?? stringValue(acceptance.record.cuNextTaskId);
    const acceptedScenarioId = stringValue(acceptance.record.scenarioId);
    if (acceptedTaskId && acceptedTaskId !== bundle.taskId) issues.push('source-bundle-task-binding-mismatch');
    if (acceptedScenarioId && acceptedScenarioId !== bundle.scenarioId) issues.push('source-bundle-scenario-binding-mismatch');
    if (!['passed', 'multi-app-workflow-passed', 'needs-confirmation'].includes(stringValue(acceptance.record.status) ?? '')) {
      issues.push('source-bundle-acceptance-not-passed');
    }
    if (stringValue(acceptance.record.level) && acceptance.record.level !== 'L3') issues.push('source-bundle-level-not-l3');
    const completionRef = stringValue(acceptance.record.completionEvidenceRef);
    if (completionRef && bundle.completionEvidenceRef && completionRef !== bundle.completionEvidenceRef) {
      issues.push('source-bundle-completion-ref-mismatch');
    }
  }

  if (completion.record) {
    if ((stringValue(completion.record.status) ?? '') !== 'completed') issues.push('source-bundle-completion-not-completed');
    if (completion.record.userAcceptanceEligible !== true) issues.push('source-bundle-completion-not-user-eligible');
    if (completion.record.realWindowEvidence !== true) issues.push('source-bundle-completion-not-real-window');
    if (completion.record.diagnosticOnly === true) issues.push('source-bundle-diagnostic-only');
    if (Array.isArray(completion.record.errors) && completion.record.errors.length > 0) issues.push('source-bundle-completion-errors-present');
  }

  return { issues: uniqueStrings(issues), policyViolations };
}

async function validateCases(input: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput): Promise<CaseValidation> {
  const issues: string[] = [];
  const policyViolations: string[] = [];
  const caseMappings: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['caseMappings'] = [];
  const materializerCases: ModelRouterComputerUseLiveAcceptanceMaterializerInput['cases'] = [];
  const duplicates = duplicateCaseIds(input.cases ?? []);
  issues.push(...duplicates.map((caseId) => `duplicate-case:${safeIssueLabel(caseId)}`));
  for (const item of input.cases ?? []) {
    if (!requiredCaseIdSet.has(item.caseId)) issues.push(`unknown-case:${safeIssueLabel(item.caseId)}`);
  }

  const casesById = new Map((input.cases ?? []).map((item) => [item.caseId, item]));
  for (const matrixCase of modelRouterComputerUseLiveAcceptanceCases) {
    const inputCase = casesById.get(matrixCase.id);
    if (!inputCase) {
      const issue = `missing-case:${matrixCase.id}`;
      issues.push(issue);
      caseMappings.push(missingCaseMapping(matrixCase.id, issue));
      continue;
    }

    const caseIssues: string[] = [];
    if (!allowedExecutorKinds.has(inputCase.executorKind)) caseIssues.push('executor-kind-invalid');
    if (!matrixCase.allowedExecutorKinds.includes(inputCase.executorKind)) caseIssues.push('executor-kind-not-allowed-for-case');
    const liveIssues = liveAttestationIssues(inputCase.liveAttestation);
    caseIssues.push(...liveIssues);
    if (hasForbiddenString(inputCase)) {
      caseIssues.push('forbidden-diagnostic-payload');
      policyViolations.push('forbidden-diagnostic-payload');
    }

    const capabilityIds = inputCase.capabilityIds ?? input.modelRouter.capabilityIds ?? [];
    for (const capabilityId of matrixCase.requiredCapabilityIds) {
      if (!capabilityIds.includes(capabilityId)) caseIssues.push(`missing-capability:${capabilityId}`);
    }

    const routerTraceRefs = inputCase.routerTraceRefs ?? input.modelRouter.routerTraceRefs ?? [];
    if (routerTraceRefs.length === 0) caseIssues.push('missing-router-trace-refs');
    if (!await allWorkspaceRefsUsable(routerTraceRefs)) caseIssues.push('unsafe-router-trace-ref');
    if (unsafeSourceRefs(inputCase.sourceRefs ?? [])) caseIssues.push('unsafe-source-ref');
    if (unsafeSourceRefs(sourceRefsFromExecutorSourceRefs(inputCase.executorSourceRefs))) caseIssues.push('unsafe-executor-source-ref');
    caseIssues.push(...await evidenceIssuesFor(matrixCase.requiredEvidenceKinds, inputCase.evidenceRefs));

    const prefixedIssues = uniqueStrings(caseIssues).map((issue) => `${matrixCase.id}:${issue}`);
    issues.push(...prefixedIssues);
    caseMappings.push({
      caseId: matrixCase.id,
      status: caseIssues.length === 0 ? 'mapped' : 'blocked',
      executorKind: safeOptionalValue(inputCase.executorKind),
      routerTraceRefCount: routerTraceRefs.length,
      evidenceRefCount: allEvidenceRefs(inputCase.evidenceRefs).length,
      issues: prefixedIssues.map(safeIssueLabel),
      issueRefs: prefixedIssues.map(issueRef),
      valuePrinted: false,
    });

    if (caseIssues.length === 0) {
      materializerCases.push({
        caseId: matrixCase.id,
        status: 'passed',
        publicModelAlias: safePublicValue(input.modelRouter.publicModelAlias),
        routerProfile: safePublicValue(input.modelRouter.routerProfile),
        routerTraceRefs,
        capabilityIds,
        executorKind: inputCase.executorKind,
        sourceRefs: safeSourceRefs([
          input.sourceBundle.traceRef,
          input.sourceBundle.manifestRef,
          input.sourceBundle.acceptanceManifestRef,
          input.sourceBundle.completionEvidenceRef,
          ...(inputCase.sourceRefs ?? []),
        ]),
        executorSourceRefs: safeExecutorSourceRefs(inputCase.executorSourceRefs),
        liveAttestation: inputCase.liveAttestation,
        evidenceRefs: inputCase.evidenceRefs,
      });
    }
  }

  return {
    issues: uniqueStrings(issues),
    policyViolations: uniqueStrings(policyViolations),
    caseMappings,
    materializerCases,
  };
}

function liveAttestationIssues(attestation: ModelRouterComputerUseLiveAcceptanceMaterializerLiveAttestation | undefined) {
  const issues: string[] = [];
  if (!attestation?.realDesktopRun) issues.push('live-attestation-real-desktop-run-missing');
  if (!attestation?.mutatingActionExecuted) issues.push('live-attestation-mutating-action-missing');
  if (attestation?.diagnosticOnly) issues.push('live-attestation-diagnostic-only');
  if (attestation?.dryRun) issues.push('live-attestation-dry-run');
  if (attestation?.fixtureMode) issues.push('live-attestation-fixture-mode');
  if (attestation?.sharedSystemInputUsed) issues.push('live-attestation-shared-system-input');
  return issues;
}

async function evidenceIssuesFor(
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
    if (!await allWorkspaceRefsUsable(refs)) issues.push('unsafe-evidence-ref');
  }
  if (!await allWorkspaceRefsUsable(allEvidenceRefs(evidenceRefs))) issues.push('unsafe-evidence-ref');
  return uniqueStrings(issues);
}

async function allWorkspaceRefsUsable(refs: string[]) {
  if (refs.length === 0) return true;
  const statuses = await Promise.all(refs.map(workspaceRefStatus));
  return statuses.every((item) => item.ok);
}

async function workspaceRefStatus(ref: string | undefined): Promise<{ ok: boolean }> {
  if (!ref || !isWorkspaceFileRef(ref)) return { ok: false };
  try {
    const absolute = resolve(ref);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) return { ok: false };
    const real = await realpath(absolute);
    const rel = relative(process.cwd(), real);
    return { ok: Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel) };
  } catch {
    return { ok: false };
  }
}

async function readJsonRef(ref: string | undefined): Promise<{ loaded: boolean; record?: Record<string, unknown> }> {
  if (!ref || !(await workspaceRefStatus(ref)).ok) return { loaded: false };
  try {
    const parsed = JSON.parse(await readFile(resolve(ref), 'utf8')) as unknown;
    return isRecord(parsed) ? { loaded: true, record: parsed } : { loaded: true };
  } catch {
    return { loaded: false };
  }
}

async function loadInput(path: string | undefined): Promise<ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput | undefined> {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return inputFromUnknown(parsed);
  } catch {
    return undefined;
  }
}

function inputFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput | undefined {
  if (!isRecord(value) || !Array.isArray(value.cases) || !isRecord(value.sourceBundle) || !isRecord(value.modelRouter)) return undefined;
  return {
    schemaVersion: stringValue(value.schemaVersion) as typeof MODEL_ROUTER_COMPUTER_USE_LIVE_ACCEPTANCE_CU_BUNDLE_ADAPTER_INPUT_SCHEMA_VERSION,
    runId: stringValue(value.runId) ?? '',
    startedAt: stringValue(value.startedAt) ?? '',
    completedAt: stringValue(value.completedAt) ?? '',
    sourceBundle: {
      kind: stringValue(value.sourceBundle.kind) as ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput['sourceBundle']['kind'],
      manifestRef: stringValue(value.sourceBundle.manifestRef),
      runDirRef: stringValue(value.sourceBundle.runDirRef),
      traceRef: stringValue(value.sourceBundle.traceRef) ?? '',
      acceptanceManifestRef: stringValue(value.sourceBundle.acceptanceManifestRef),
      completionEvidenceRef: stringValue(value.sourceBundle.completionEvidenceRef),
      taskId: stringValue(value.sourceBundle.taskId) ?? '',
      scenarioId: stringValue(value.sourceBundle.scenarioId) ?? '',
    },
    modelRouter: {
      publicModelAlias: stringValue(value.modelRouter.publicModelAlias) ?? '',
      routerProfile: stringValue(value.modelRouter.routerProfile) ?? '',
      routerTraceRefs: stringArray(value.modelRouter.routerTraceRefs),
      capabilityIds: stringArray(value.modelRouter.capabilityIds),
    },
    cases: value.cases.map(caseFromUnknown),
  };
}

function caseFromUnknown(value: unknown): ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput['cases'][number] {
  const record = isRecord(value) ? value : {};
  return {
    caseId: stringValue(record.caseId) ?? '',
    executorKind: stringValue(record.executorKind) as ModelRouterComputerUseLiveAcceptanceExecutorKind,
    routerTraceRefs: stringArray(record.routerTraceRefs),
    capabilityIds: stringArray(record.capabilityIds),
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
  inlineInput: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput | undefined,
  inputPath: string | undefined,
  loadedInput: ModelRouterComputerUseLiveAcceptanceCuBundleAdapterInput | undefined,
): ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['source'] {
  if (inlineInput) return { kind: 'inline-input', valuePrinted: false };
  if (inputPath) return { kind: 'input-file', ref: loadedInput ? publicPathRef(inputPath) : `input-file:${sha256Hex(resolve(inputPath)).slice(0, 16)}`, valuePrinted: false };
  return { kind: 'missing-input', valuePrinted: false };
}

function missingSourceBundle(issue: string): ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['sourceBundle'] {
  return {
    status: 'missing',
    refs: {},
    issues: [safeIssueLabel(issue)],
    issueRefs: [issueRef(issue)],
    valuePrinted: false,
  };
}

function missingCaseMapping(
  caseId: string,
  issue: string,
): ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['caseMappings'][number] {
  return {
    caseId,
    status: 'missing',
    routerTraceRefCount: 0,
    evidenceRefCount: 0,
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
    } else if (arg === '--out-materializer-input' || arg === '--out-input') {
      parsed.outMaterializerInputPath = requiredValue(argv, index, arg);
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
      throw new Error('Unknown Model Router Computer Use live acceptance CU bundle adapter argument');
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
    'Usage: tsx tools/model-router-computer-use-live-acceptance-cu-bundle-adapter.ts --input input.json [--out-materializer-input input.json] [--strict] [--json]',
    '',
    'Adapts an already-existing refs-first CU-NEXT/current chat Computer Use acceptance bundle into Model Router materializer input.',
    'This tool never runs live desktop tasks or grants release acceptance.',
  ].join('\n');
}

function nextActions(inputRef: string): ModelRouterComputerUseLiveAcceptanceCuBundleAdapterManifest['nextActions'] {
  return [{
    label: 'Materialize the adapted refs and then run fresh trace audit plus strict matrix gate.',
    command: `node --import tsx tools/model-router-computer-use-live-acceptance-materializer.ts --input ${inputRef} --out-input docs/test-artifacts/model-router-computer-use-live-matrix/input.json --strict`,
    writesRepo: false,
  }];
}

function allEvidenceRefs(evidenceRefs: ModelRouterComputerUseLiveAcceptanceMaterializerEvidenceRefs | undefined) {
  if (!evidenceRefs) return [];
  return [
    ...(evidenceRefs.screenshotRefs ?? []),
    ...(evidenceRefs.fileRefs ?? []),
    ...(evidenceRefs.artifactRefs ?? []),
    ...(evidenceRefs.terminalRefs ?? []),
    ...(evidenceRefs.verifierSourceRefs ?? []),
  ];
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

function safeExecutorSourceRefs(
  refs: ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs | undefined,
): ModelRouterComputerUseLiveAcceptanceMaterializerSourceRefs | undefined {
  if (!refs) return undefined;
  return {
    sessionRef: safeSourceRef(refs.sessionRef),
    nativeHostRef: safeSourceRef(refs.nativeHostRef),
    appWindowRef: safeSourceRef(refs.appWindowRef),
    refs: safeSourceRefs(refs.refs ?? []),
  };
}

function unsafeSourceRefs(refs: string[]) {
  return refs.some((ref) => !safeSourceRef(ref));
}

function safeSourceRefs(refs: Array<string | undefined>) {
  return uniqueStrings(refs.map(safeSourceRef).filter((ref): ref is string => Boolean(ref)));
}

function safeSourceRef(ref: string | undefined) {
  if (!ref || forbiddenDiagnosticPattern.test(ref)) return undefined;
  if (isWorkspaceFileRef(ref)) return ref;
  if (/^(?:computer-use|computer-use-session|gui\.present|gui\.blocked|gui\.repair|window|permission|approval):[a-z0-9_./:-]+$/i.test(ref)) {
    return ref;
  }
  return undefined;
}

function safePublicValue(value: string | undefined) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return undefined;
  const label = safeIssueLabel(value);
  return label.startsWith('issue:') ? undefined : label;
}

function safeOptionalValue(value: string | undefined) {
  if (!value) return undefined;
  return safePublicValue(value) ?? `value:${sha256Hex(value).slice(0, 16)}`;
}

function safePublicRef(ref: string | undefined) {
  if (!ref) return undefined;
  if (isWorkspaceFileRef(ref)) return ref;
  if (isWorkspaceDirectoryRef(ref)) return ref;
  if (safeSourceRef(ref)) return ref;
  return `ref:${sha256Hex(ref).slice(0, 16)}`;
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
  return !isForbiddenPublicRef(ref)
    && isSafeRelativeFileRef(ref.replace(/\\/g, '/'))
    && /^(?:docs|artifacts|\.sciforge)(?:\/|$)/u.test(ref.replace(/\\/g, '/'));
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

function safeIssueLabel(value: string) {
  if (!value || forbiddenDiagnosticPattern.test(value)) return `issue:${sha256Hex(value).slice(0, 16)}`;
  return value.replace(/[^a-z0-9_.:-]/gi, '-').slice(0, 140) || `issue:${sha256Hex(value).slice(0, 16)}`;
}

function hasForbiddenString(value: unknown): boolean {
  if (typeof value === 'string') return forbiddenDiagnosticPattern.test(value);
  if (Array.isArray(value)) return value.some(hasForbiddenString);
  if (isRecord(value)) return Object.values(value).some(hasForbiddenString);
  return false;
}

function timestampMs(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function safePathSegment(value: string) {
  return /^[a-z0-9_.-]{1,96}$/i.test(value);
}

function safeTaskLabel(value: string | undefined) {
  return Boolean(value && !forbiddenDiagnosticPattern.test(value) && /^[a-z0-9_.:-]{1,96}$/i.test(value));
}

function duplicateCaseIds(cases: Array<{ caseId?: string }>) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of cases) {
    if (!item.caseId) continue;
    if (seen.has(item.caseId)) duplicates.add(item.caseId);
    else seen.add(item.caseId);
  }
  return [...duplicates].sort();
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : undefined;
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

if (process.argv[1]?.endsWith('model-router-computer-use-live-acceptance-cu-bundle-adapter.ts')) {
  await runModelRouterComputerUseLiveAcceptanceCuBundleAdapterCli(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${safeIssueLabel(message)}\n`);
    process.exitCode = 1;
  });
}
