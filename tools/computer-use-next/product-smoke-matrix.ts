export const CU_NEXT_PRODUCT_SMOKE_MATRIX_SCHEMA_VERSION =
  'sciforge.computer-use.product-smoke-matrix.v1' as const;
const NATIVE_MULTI_SCREEN_LIVE_DEMO_VALIDATION_SCHEMA =
  'sciforge.computer-use.native-multi-screen-live-demo-validation.v1' as const;
const NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA =
  'sciforge.computer-use.native-multi-screen-sidecar-binding.v1' as const;
const NATIVE_SIDECAR_CAPABILITIES_SCHEMA =
  'sciforge.computer-use.native-sidecar-capabilities.v1' as const;
const NATIVE_SIDECAR_DISCOVERY_SCHEMA =
  'sciforge.computer-use.native-sidecar-discovery.v1' as const;

export type CuNextProductSmokeTier =
  | 'package-diagnostic'
  | 'platform-smoke'
  | 'product-smoke';

export type CuNextProductSmokeStatus =
  | 'blocked'
  | 'opt-in-required'
  | 'pending'
  | 'passed'
  | 'failed';

export type CuNextProductSmokeEvidenceRequirement =
  | 'codex-app-server-native-plugin-path'
  | 'sciforge-computer-use-provider'
  | 'platform-sidecar-isolation'
  | 'native-multi-screen-sidecar'
  | 'real-single-app-input'
  | 'real-artifact-save'
  | 'high-risk-confirmation-stop'
  | 'blocked-recovery'
  | 'viewer-real-frames'
  | 'multi-app-workflow'
  | 'current-bundle-evidence'
  | 'single-screen-single-actor'
  | 'single-screen-multi-actor'
  | 'multi-screen-single-actor'
  | 'multi-screen-multi-actor'
  | 'multi-screen-live-demo'
  | 'multi-actor-cursor-provenance'
  | 'window-local-queue'
  | 'screen-global-queue'
  | 'browser-runtime-dom-ax-observation'
  | 'dom-aware-observe-before-mutate'
  | 'directory-preview';

export type CuNextProductSmokeCaseId =
  | 'product-path-codex-native-plugin-sidecar'
  | 'real-single-app-input'
  | 'real-artifact-save'
  | 'high-risk-confirmation-stop'
  | 'blocked-recovery'
  | 'viewer-real-frames'
  | 'multi-app-workflow'
  | 'current-bundle-evidence'
  | 'single-screen-single-actor'
  | 'single-screen-multi-actor'
  | 'multi-screen-single-actor'
  | 'multi-screen-multi-actor'
  | 'multi-screen-live-demo'
  | 'browser-runtime-dom-ax-observation'
  | 'dom-aware-observe-before-mutate'
  | 'window-local-queue'
  | 'screen-global-queue'
  | 'directory-preview';

export interface CuNextProductSmokeCaseDefinition {
  id: CuNextProductSmokeCaseId;
  label: string;
  taskId?: string;
  requiredTier: 'product-smoke';
  requiredExecutionMode: 'opt-in-live-backend';
  requirements: CuNextProductSmokeEvidenceRequirement[];
}

export interface CuNextProductSmokePath {
  entrypoint?: string;
  hops?: string[];
  appServerRunRef?: string;
  nativePluginInvocationRef?: string;
  sciforgeComputerUseRunTaskRef?: string;
  platformSidecarIsolationReportRef?: string;
  backendKind?: string;
}

export interface CuNextProductSmokeCaseEvidence {
  id: CuNextProductSmokeCaseId;
  status: CuNextProductSmokeStatus;
  evidenceTier: CuNextProductSmokeTier;
  executionMode: 'dry-run' | 'fixture' | 'opt-in-live-backend';
  realBackendExecuted: boolean;
  diagnosticOnly?: boolean;
  packageDiagnosticOnly?: boolean;
  dryRun?: boolean;
  fixture?: boolean;
  notRunReason?: string;
  productPath?: CuNextProductSmokePath;
  nativeMultiScreenSummary?: {
    screenCount?: number;
    actorCursorCount?: number;
    cursorEventTypes?: string[];
    windowLocalQueue?: boolean;
    screenGlobalQueue?: boolean;
    nonPlaceholderReplayScreenCount?: number;
    validationRef?: string;
    validation?: {
      schemaVersion?: string;
      ok?: boolean;
      status?: string;
      errorCount?: number;
      realNativeSidecarExecuted?: boolean;
      completionEligible?: boolean;
      screenCount?: number;
      actorCursorCount?: number;
      cursorEventTypes?: string[];
      nonPlaceholderReplayScreenCount?: number;
      sidecarBindingKind?: string;
    };
  };
  evidenceRefs?: Partial<Record<CuNextProductSmokeEvidenceRequirement, string[]>>;
  currentRunBundleRef?: string;
  acceptanceManifestRef?: string;
  issues?: string[];
}

export interface CuNextProductSmokeMatrix {
  schemaVersion: typeof CU_NEXT_PRODUCT_SMOKE_MATRIX_SCHEMA_VERSION;
  generatedAt: string;
  status: CuNextProductSmokeStatus;
  releaseAcceptance: 'opt-in-only';
  evidenceMode: 'product-smoke-matrix-classification';
  cases: CuNextProductSmokeCaseEvidence[];
  packageDiagnosticCompletesProductSmoke: false;
}

export interface CuNextProductSmokeMatrixIssue {
  id: string;
  reason: string;
  path?: string;
}

export interface CuNextProductSmokeMatrixValidation {
  ok: boolean;
  status: CuNextProductSmokeStatus | 'invalid';
  passedCaseIds: CuNextProductSmokeCaseId[];
  pendingCaseIds: CuNextProductSmokeCaseId[];
  issues: CuNextProductSmokeMatrixIssue[];
}

export interface CuNextProductSmokeMatrixValidationOptions {
  refRecords?: Record<string, unknown>;
}

interface NativeMultiScreenValidationOptions {
  currentRunBundleRef?: string;
  requireValidationRefProof: boolean;
}

export const CU_NEXT_PRODUCT_SMOKE_CASES: readonly CuNextProductSmokeCaseDefinition[] = [
  {
    id: 'product-path-codex-native-plugin-sidecar',
    label: 'Codex app-server/native plugin to platform sidecar product path',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: [
      'codex-app-server-native-plugin-path',
      'sciforge-computer-use-provider',
      'platform-sidecar-isolation',
      'native-multi-screen-sidecar',
      'current-bundle-evidence',
    ],
  },
  {
    id: 'real-single-app-input',
    label: 'Real single-app visible input',
    taskId: 'CU-NEXT-01',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: [
      'real-single-app-input',
      'single-screen-single-actor',
      'window-local-queue',
      'dom-aware-observe-before-mutate',
      'current-bundle-evidence',
    ],
  },
  {
    id: 'real-artifact-save',
    label: 'Real artifact save through GUI causality',
    taskId: 'CU-NEXT-02',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['real-artifact-save', 'viewer-real-frames', 'current-bundle-evidence'],
  },
  {
    id: 'high-risk-confirmation-stop',
    label: 'High-risk action stops before confirmation',
    taskId: 'CU-NEXT-03',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['high-risk-confirmation-stop', 'screen-global-queue', 'current-bundle-evidence'],
  },
  {
    id: 'blocked-recovery',
    label: 'Blocked recovery produces current repair bundle',
    taskId: 'CU-NEXT-05',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['blocked-recovery', 'current-bundle-evidence'],
  },
  {
    id: 'viewer-real-frames',
    label: 'Viewer shows non-placeholder real frames',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['viewer-real-frames', 'current-bundle-evidence'],
  },
  {
    id: 'multi-app-workflow',
    label: 'Source to writer to file preview workflow',
    taskId: 'CU-NEXT-04',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['multi-app-workflow', 'directory-preview', 'dom-aware-observe-before-mutate', 'current-bundle-evidence'],
  },
  {
    id: 'current-bundle-evidence',
    label: 'Current-run bundle anchors all completion refs',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['current-bundle-evidence'],
  },
  {
    id: 'single-screen-single-actor',
    label: 'Single screen, single actor classification',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['single-screen-single-actor', 'viewer-real-frames'],
  },
  {
    id: 'single-screen-multi-actor',
    label: 'Single screen, multiple actors classification',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['single-screen-multi-actor', 'window-local-queue'],
  },
  {
    id: 'multi-screen-single-actor',
    label: 'Multiple screens, single actor classification',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['multi-screen-single-actor', 'screen-global-queue'],
  },
  {
    id: 'multi-screen-multi-actor',
    label: 'Multiple screens, multiple actors classification',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: [
      'multi-screen-multi-actor',
      'multi-actor-cursor-provenance',
      'native-multi-screen-sidecar',
      'window-local-queue',
      'screen-global-queue',
      'browser-runtime-dom-ax-observation',
      'dom-aware-observe-before-mutate',
      'current-bundle-evidence',
    ],
  },
  {
    id: 'multi-screen-live-demo',
    label: 'M6 multi-screen multi-actor live demo',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: [
      'multi-screen-live-demo',
      'multi-screen-multi-actor',
      'multi-actor-cursor-provenance',
      'native-multi-screen-sidecar',
      'window-local-queue',
      'screen-global-queue',
      'viewer-real-frames',
      'current-bundle-evidence',
    ],
  },
  {
    id: 'browser-runtime-dom-ax-observation',
    label: 'BrowserRuntime DOM/AX refs-first observation hints',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['browser-runtime-dom-ax-observation', 'dom-aware-observe-before-mutate', 'current-bundle-evidence'],
  },
  {
    id: 'dom-aware-observe-before-mutate',
    label: 'DOM-aware observe-before-mutate grounding hints',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['dom-aware-observe-before-mutate', 'window-local-queue', 'current-bundle-evidence'],
  },
  {
    id: 'window-local-queue',
    label: 'Window-local executor queue classification',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['window-local-queue', 'current-bundle-evidence'],
  },
  {
    id: 'screen-global-queue',
    label: 'Screen-global executor queue classification',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['screen-global-queue', 'current-bundle-evidence'],
  },
  {
    id: 'directory-preview',
    label: 'Directory preview after save classification',
    taskId: 'CU-NEXT-04',
    requiredTier: 'product-smoke',
    requiredExecutionMode: 'opt-in-live-backend',
    requirements: ['directory-preview', 'current-bundle-evidence'],
  },
] as const;

export const CU_NEXT_LIVE_MATRIX_CLASSIFICATION_CASES = CU_NEXT_PRODUCT_SMOKE_CASES;

export function buildCuNextProductSmokeMatrix(input: {
  generatedAt?: string;
  cases?: CuNextProductSmokeCaseEvidence[];
} = {}): CuNextProductSmokeMatrix {
  const cases = input.cases ?? CU_NEXT_PRODUCT_SMOKE_CASES.map((item) => ({
    id: item.id,
    status: 'opt-in-required' as const,
    evidenceTier: 'product-smoke' as const,
    executionMode: 'dry-run' as const,
    realBackendExecuted: false,
    dryRun: true,
    notRunReason: 'Product smoke requires opt-in Codex app-server/native plugin plus native platform sidecar execution.',
    evidenceRefs: {},
  }));
  return {
    schemaVersion: CU_NEXT_PRODUCT_SMOKE_MATRIX_SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date(0).toISOString(),
    status: matrixStatusFromCases(cases),
    releaseAcceptance: 'opt-in-only',
    evidenceMode: 'product-smoke-matrix-classification',
    cases,
    packageDiagnosticCompletesProductSmoke: false,
  };
}

export function validateCuNextProductSmokeMatrix(
  matrix: unknown,
  options: CuNextProductSmokeMatrixValidationOptions = {},
): CuNextProductSmokeMatrixValidation {
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  const record = asRecord(matrix);
  if (!record) {
    return {
      ok: false,
      status: 'invalid',
      passedCaseIds: [],
      pendingCaseIds: [],
      issues: [{ id: 'matrix-not-object', reason: 'Product smoke matrix must be a structured object.' }],
    };
  }
  if (record.schemaVersion !== CU_NEXT_PRODUCT_SMOKE_MATRIX_SCHEMA_VERSION) {
    issues.push({
      id: 'invalid-schema-version',
      path: 'schemaVersion',
      reason: `schemaVersion must be ${CU_NEXT_PRODUCT_SMOKE_MATRIX_SCHEMA_VERSION}.`,
    });
  }
  if (record.releaseAcceptance !== 'opt-in-only') {
    issues.push({
      id: 'invalid-release-acceptance',
      path: 'releaseAcceptance',
      reason: 'Product Computer Use smoke is opt-in-only and must not be a default release pass.',
    });
  }
  if (record.packageDiagnosticCompletesProductSmoke !== false) {
    issues.push({
      id: 'package-diagnostic-policy-not-fail-closed',
      path: 'packageDiagnosticCompletesProductSmoke',
      reason: 'Package diagnostics must never complete product smoke.',
    });
  }

  const cases = records(record.cases);
  const definitionsById = new Map(CU_NEXT_PRODUCT_SMOKE_CASES.map((item) => [item.id, item]));
  for (const definition of CU_NEXT_PRODUCT_SMOKE_CASES) {
    if (!cases.some((item) => item.id === definition.id)) {
      issues.push({
        id: 'missing-product-smoke-case',
        path: 'cases',
        reason: `Missing product smoke case ${definition.id}.`,
      });
    }
  }

  for (const [index, item] of cases.entries()) {
    const id = stringValue(item.id) as CuNextProductSmokeCaseId | undefined;
    const definition = id ? definitionsById.get(id) : undefined;
    if (!definition) {
      issues.push({
        id: 'unknown-product-smoke-case',
        path: `cases[${index}].id`,
        reason: `Unknown product smoke case ${String(item.id ?? '(missing)')}.`,
      });
      continue;
    }
    issues.push(...validateProductSmokeCase(item, definition, `cases[${index}]`, options));
  }

  const status = isProductSmokeStatus(record.status) ? record.status : 'invalid';
  if (status === 'passed' && cases.some((item) => item.status !== 'passed')) {
    issues.push({
      id: 'matrix-passed-with-unpassed-cases',
      path: 'status',
      reason: 'Matrix status=passed requires every product smoke case to be passed by opt-in live backend evidence.',
    });
  }

  const passedCaseIds = cases
    .filter((item) => item.status === 'passed' && isProductSmokeCaseId(item.id))
    .map((item) => item.id as CuNextProductSmokeCaseId);
  const pendingCaseIds = cases
    .filter((item) => item.status === 'blocked' || item.status === 'opt-in-required' || item.status === 'pending')
    .filter((item) => isProductSmokeCaseId(item.id))
    .map((item) => item.id as CuNextProductSmokeCaseId);

  return {
    ok: issues.length === 0,
    status,
    passedCaseIds,
    pendingCaseIds,
    issues: uniqueIssues(issues),
  };
}

function validateProductSmokeCase(
  item: Record<string, unknown>,
  definition: CuNextProductSmokeCaseDefinition,
  path: string,
  options: CuNextProductSmokeMatrixValidationOptions,
): CuNextProductSmokeMatrixIssue[] {
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  const status = stringValue(item.status);
  const evidenceTier = stringValue(item.evidenceTier);
  const executionMode = stringValue(item.executionMode);
  const passed = status === 'passed';

  if (!isProductSmokeStatus(status)) {
    issues.push({
      id: 'invalid-product-smoke-status',
      path: `${path}.status`,
      reason: 'Product smoke case status must be blocked, opt-in-required, pending, passed, or failed.',
    });
  }
  if (status === 'passed' && item.realBackendExecuted !== true) {
    issues.push({
      id: 'product-smoke-pass-without-real-backend',
      path: `${path}.realBackendExecuted`,
      reason: 'Unexecuted, fixture, or dry-run product smoke cases must remain blocked/opt-in-required/pending, not passed.',
    });
  }
  if (passed && evidenceTier !== definition.requiredTier) {
    issues.push({
      id: 'non-product-tier-cannot-pass-product-smoke',
      path: `${path}.evidenceTier`,
      reason: `${evidenceTier ?? '(missing)'} evidence cannot pass product smoke; required tier is product-smoke.`,
    });
  }
  if (passed && executionMode !== definition.requiredExecutionMode) {
    issues.push({
      id: 'product-smoke-pass-requires-opt-in-live-backend',
      path: `${path}.executionMode`,
      reason: 'Product smoke pass requires opt-in-live-backend execution, not dry-run or fixture execution.',
    });
  }
  if (passed && (item.dryRun === true || item.fixture === true || item.diagnosticOnly === true || item.packageDiagnosticOnly === true)) {
    issues.push({
      id: 'diagnostic-cannot-pass-product-smoke',
      path,
      reason: 'Package diagnostic, fixture, dry-run, or diagnostic-only evidence cannot pass product smoke.',
    });
  }
  if (!passed && !stringValue(item.notRunReason) && status !== 'failed') {
    issues.push({
      id: 'missing-not-run-reason',
      path: `${path}.notRunReason`,
      reason: 'Blocked, opt-in-required, or pending product smoke cases must state why no product pass was claimed.',
    });
  }
  if (!passed) return issues;

  issues.push(...validateProductPath(item.productPath, `${path}.productPath`));
  const currentRunBundleRef = stringValue(item.currentRunBundleRef);
  requireRef(issues, `${path}.currentRunBundleRef`, currentRunBundleRef);
  requireRef(issues, `${path}.acceptanceManifestRef`, stringValue(item.acceptanceManifestRef));
  const evidenceRefs = asRecord(item.evidenceRefs) ?? {};
  for (const requirement of definition.requirements) {
    const refs = stringArray(evidenceRefs[requirement]);
    if (refs.length === 0) {
      issues.push({
        id: 'missing-product-smoke-evidence-ref',
        path: `${path}.evidenceRefs.${requirement}`,
        reason: `Product smoke case ${definition.id} requires ${requirement} refs.`,
      });
    }
    refs.forEach((ref, index) => requireRef(issues, `${path}.evidenceRefs.${requirement}[${index}]`, ref));
  }
  if (
    definition.requirements.includes('multi-screen-multi-actor')
    || definition.requirements.includes('multi-screen-live-demo')
  ) {
    issues.push(...validateNativeMultiScreenSummary(item.nativeMultiScreenSummary, path, options.refRecords, {
      currentRunBundleRef,
      requireValidationRefProof: definition.id === 'multi-screen-live-demo',
    }));
  }
  issues.push(...validateCurrentBundleScopedRefs(item, currentRunBundleRef, path));
  return issues;
}

function validateProductPath(value: unknown, path: string): CuNextProductSmokeMatrixIssue[] {
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  const productPath = asRecord(value);
  if (!productPath) {
    return [{
      id: 'missing-product-path',
      path,
      reason: 'Product smoke pass must bind the Codex app-server/native plugin -> SciForge Computer Use -> platform sidecar path.',
    }];
  }
  const hops = stringArray(productPath.hops).map(normalizeToken);
  if (containsForbiddenLegacyBackendMarker([
    stringValue(productPath.entrypoint),
    stringValue(productPath.backendKind),
    ...stringArray(productPath.hops),
  ])) {
    issues.push({
      id: 'forbidden-legacy-backend-gate',
      path,
      reason: 'Docker/noVNC/RDP/container hops cannot participate in native Computer Use product smoke pass evidence.',
    });
  }
  const requiredHops = ['codex-app-server', 'codex-native-plugin', 'sciforge-computer-use'];
  for (const hop of requiredHops) {
    if (!hops.includes(hop)) {
      issues.push({
        id: 'missing-product-path-hop',
        path: `${path}.hops`,
        reason: `Product path must include ${hop}.`,
      });
    }
  }
  if (!hops.some((hop) => hop === 'platform-sidecar' || hop === 'native-platform-sidecar' || hop === 'native-multi-screen-sidecar')) {
    issues.push({
      id: 'missing-product-path-hop',
      path: `${path}.hops`,
      reason: 'Product path must include a native platform sidecar backend hop.',
    });
  }
  const backendKind = normalizeToken(stringValue(productPath.backendKind) ?? '');
  if (backendKind && !['platform-sidecar', 'native-platform-sidecar', 'native-multi-screen-sidecar'].includes(backendKind)) {
    issues.push({
      id: 'invalid-product-backend-kind',
      path: `${path}.backendKind`,
      reason: 'Product path backendKind must identify a native platform sidecar backend.',
    });
  }
  if (!/codex.*app.*server.*native.*plugin|native.*plugin.*codex.*app.*server/i.test(stringValue(productPath.entrypoint) ?? '')) {
    issues.push({
      id: 'invalid-product-entrypoint',
      path: `${path}.entrypoint`,
      reason: 'Product smoke entrypoint must be Codex app-server/native plugin, not package-local or gateway diagnostic.',
    });
  }
  requireRef(issues, `${path}.appServerRunRef`, stringValue(productPath.appServerRunRef));
  requireRef(issues, `${path}.nativePluginInvocationRef`, stringValue(productPath.nativePluginInvocationRef));
  requireRef(issues, `${path}.sciforgeComputerUseRunTaskRef`, stringValue(productPath.sciforgeComputerUseRunTaskRef));
  requireRef(issues, `${path}.platformSidecarIsolationReportRef`, stringValue(productPath.platformSidecarIsolationReportRef));
  return issues;
}

function validateNativeMultiScreenSummary(
  value: unknown,
  path: string,
  refRecords: Record<string, unknown> | undefined,
  validationOptions: NativeMultiScreenValidationOptions,
): CuNextProductSmokeMatrixIssue[] {
  const summary = asRecord(value);
  if (!summary) {
    return [{
      id: 'missing-native-multi-screen-summary',
      path: `${path}.nativeMultiScreenSummary`,
      reason: 'Native multi-screen product smoke pass requires structured screen/cursor/queue/replay summary evidence.',
    }];
  }
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  if (numberValue(summary.screenCount) < 2) {
    issues.push({
      id: 'invalid-native-multi-screen-summary',
      path: `${path}.nativeMultiScreenSummary.screenCount`,
      reason: 'Native multi-screen summary requires at least two screens.',
    });
  }
  if (numberValue(summary.actorCursorCount) < 3) {
    issues.push({
      id: 'invalid-native-multi-screen-summary',
      path: `${path}.nativeMultiScreenSummary.actorCursorCount`,
      reason: 'Native multi-screen summary requires at least three actor cursors.',
    });
  }
  const cursorEventTypes = new Set(stringArray(summary.cursorEventTypes).map(normalizeToken));
  for (const required of ['move', 'point', 'annotate']) {
    if (!cursorEventTypes.has(required)) {
      issues.push({
        id: 'invalid-native-multi-screen-summary',
        path: `${path}.nativeMultiScreenSummary.cursorEventTypes`,
        reason: `Native multi-screen summary requires read-only ${required} cursor events.`,
      });
    }
  }
  if (summary.windowLocalQueue !== true || summary.screenGlobalQueue !== true) {
    issues.push({
      id: 'invalid-native-multi-screen-summary',
      path: `${path}.nativeMultiScreenSummary`,
      reason: 'Native multi-screen summary requires both window-local and screen-global queues.',
    });
  }
  if (numberValue(summary.nonPlaceholderReplayScreenCount) < 2) {
    issues.push({
      id: 'invalid-native-multi-screen-summary',
      path: `${path}.nativeMultiScreenSummary.nonPlaceholderReplayScreenCount`,
      reason: 'Native multi-screen summary requires non-placeholder replay frames for at least two screens.',
    });
  }
  const validationRef = stringValue(summary.validationRef);
  requireRef(issues, `${path}.nativeMultiScreenSummary.validationRef`, validationRef);
  const validation = asRecord(summary.validation);
  const validationRefRecord = validationRef ? asRecord(refRecords?.[validationRef]) : undefined;
  if (!validationRefRecord) {
    issues.push({
      id: 'missing-native-multi-screen-validation-ref-record',
      path: `${path}.nativeMultiScreenSummary.validationRef`,
      reason: 'Native multi-screen product smoke pass requires loading the validationRef record; inline validation alone is not completion evidence.',
    });
  }
  if (!validation) {
    issues.push({
      id: 'missing-native-multi-screen-validation',
      path: `${path}.nativeMultiScreenSummary.validation`,
      reason: 'Native multi-screen product smoke pass requires runner validation payload, not only self-reported summary counts.',
    });
    return issues;
  }
  const validationProjection = nativeValidationProjection(validation);
  const validationRefProjection = validationRefRecord ? nativeValidationProjection(validationRefRecord) : undefined;
  if (validationRefProjection && JSON.stringify(stableJson(validationRefProjection)) !== JSON.stringify(stableJson(validationProjection))) {
    issues.push({
      id: 'native-multi-screen-validation-ref-mismatch',
      path: `${path}.nativeMultiScreenSummary.validationRef`,
      reason: 'Native multi-screen inline validation must match the loaded validationRef record.',
    });
  }
  if (
    validationProjection.schemaVersion !== NATIVE_MULTI_SCREEN_LIVE_DEMO_VALIDATION_SCHEMA
    || validationProjection.ok !== true
    || validationProjection.status !== 'accepted'
    || numberValue(validationProjection.errorCount) !== 0
    || validationProjection.realNativeSidecarExecuted !== true
    || validationProjection.completionEligible !== true
  ) {
    issues.push({
      id: 'invalid-native-multi-screen-validation',
      path: `${path}.nativeMultiScreenSummary.validation`,
      reason: 'Native multi-screen validation must be an accepted M6 live runner validation for real native sidecar execution.',
    });
  }
  for (const [field, minimum] of [['screenCount', 2], ['actorCursorCount', 3], ['nonPlaceholderReplayScreenCount', 2]] as const) {
    if (numberValue(validationProjection[field]) !== numberValue(summary[field]) || numberValue(validationProjection[field]) < minimum) {
      issues.push({
        id: 'native-multi-screen-validation-summary-mismatch',
        path: `${path}.nativeMultiScreenSummary.validation.${field}`,
        reason: `Native multi-screen validation ${field} must match summary and satisfy the product minimum.`,
      });
    }
  }
  const validationEventTypes = new Set(stringArray(validationProjection.cursorEventTypes).map(normalizeToken));
  for (const required of ['move', 'point', 'annotate']) {
    if (!validationEventTypes.has(required) || !cursorEventTypes.has(required)) {
      issues.push({
        id: 'native-multi-screen-validation-summary-mismatch',
        path: `${path}.nativeMultiScreenSummary.validation.cursorEventTypes`,
        reason: `Native multi-screen validation must confirm read-only ${required} cursor event evidence.`,
      });
    }
  }
  if (validationOptions.requireValidationRefProof && validationRefRecord) {
    issues.push(...validateNativeMultiScreenValidationRefRecord(
      validationRefRecord,
      validationProjection,
      `${path}.nativeMultiScreenSummary.validationRef`,
      validationOptions.currentRunBundleRef,
    ));
  }
  return issues;
}

function validateNativeMultiScreenValidationRefRecord(
  value: Record<string, unknown>,
  validationProjection: Record<string, unknown>,
  path: string,
  currentRunBundleRef: string | undefined,
): CuNextProductSmokeMatrixIssue[] {
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  const currentBundle = asRecord(value.currentBundle);
  const runId = stringValue(value.runId)
    ?? stringValue(asRecord(value.metadata)?.runId)
    ?? stringValue(currentBundle?.runId);
  if (!runId) {
    issues.push({
      id: 'missing-native-multi-screen-validation-ref-proof',
      path: `${path}.runId`,
      reason: 'Native multi-screen validationRef record must name the completed runId.',
    });
  }

  const namedRefs: Array<{ path: string; ref: string }> = [];
  const requireNamedRef = (fieldPath: string, ref: string | undefined): void => {
    const refPath = `${path}.${fieldPath}`;
    if (!ref) {
      issues.push({
        id: 'missing-native-multi-screen-validation-ref-proof',
        path: refPath,
        reason: `Native multi-screen validationRef record must prove ${fieldPath}.`,
      });
      return;
    }
    requireRef(issues, refPath, ref);
    namedRefs.push({ path: refPath, ref });
  };

  requireNamedRef('currentBundleRef', stringValue(value.currentBundleRef));
  requireNamedRef('sidecarBindingRef', stringValue(value.sidecarBindingRef));
  requireNamedRef('sidecarCapabilitiesRef', stringValue(value.sidecarCapabilitiesRef));
  requireNamedRef('sidecarDiscoveryRef', stringValue(value.sidecarDiscoveryRef));
  requireNamedRef('replayRef', stringValue(value.replayRef));

  const schedulerLeaseRefs = uniqueStringList([
    stringValue(value.schedulerLeaseRef),
    ...stringArray(value.schedulerLeaseRefs),
  ]);
  if (schedulerLeaseRefs.length === 0) {
    issues.push({
      id: 'missing-native-multi-screen-validation-ref-proof',
      path: `${path}.schedulerLeaseRefs`,
      reason: 'Native multi-screen validationRef record must prove scheduler lease refs.',
    });
  }
  schedulerLeaseRefs.forEach((ref, index) => requireNamedRef(`schedulerLeaseRefs[${index}]`, ref));

  const targetRefs = uniqueStringList(stringArray(value.targetRefs));
  if (targetRefs.length < 2) {
    issues.push({
      id: 'missing-native-multi-screen-validation-ref-proof',
      path: `${path}.targetRefs`,
      reason: 'Native multi-screen validationRef record must prove per-screen target refs.',
    });
  }
  targetRefs.forEach((ref, index) => requireNamedRef(`targetRefs[${index}]`, ref));

  const validationRefs = new Set(stringArray(value.refs));
  if (validationRefs.size === 0) {
    issues.push({
      id: 'missing-native-multi-screen-validation-ref-proof',
      path: `${path}.refs`,
      reason: 'Native multi-screen validationRef record must include the runner-validated refs list.',
    });
  } else {
    for (const namedRef of namedRefs) {
      if (!validationRefs.has(namedRef.ref)) {
        issues.push({
          id: 'invalid-native-multi-screen-validation-ref-proof',
          path: `${path}.refs`,
          reason: `Native multi-screen validationRef refs must include ${namedRef.ref}.`,
        });
      }
    }
  }

  const currentBundleRefs = new Set(stringArray(currentBundle?.refs));
  if (currentBundleRefs.size > 0) {
    for (const namedRef of namedRefs.filter((item) => !item.path.endsWith('.currentBundleRef'))) {
      if (!currentBundleRefs.has(namedRef.ref)) {
        issues.push({
          id: 'invalid-native-multi-screen-validation-ref-proof',
          path: `${path}.currentBundle.refs`,
          reason: `Native multi-screen currentBundle refs must include ${namedRef.ref}.`,
        });
      }
    }
  }

  const bindingKind = normalizeToken(
    stringValue(value.sidecarBindingKind)
    ?? stringValue(asRecord(value.sidecarBinding)?.bindingKind)
    ?? stringValue(asRecord(value.summary)?.sidecarBindingKind)
    ?? stringValue(validationProjection.sidecarBindingKind)
    ?? '',
  );
  if (!bindingKind) {
    issues.push({
      id: 'missing-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarBindingKind`,
      reason: 'Native multi-screen validationRef record must prove the live sidecar binding kind.',
    });
  } else if (bindingKind === 'diagnostic-local') {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarBindingKind`,
      reason: 'Native multi-screen product pass cannot use a diagnostic-local sidecar binding.',
    });
  } else if (!['custom-dispatcher', 'external-command'].includes(bindingKind)) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarBindingKind`,
      reason: 'Native multi-screen product pass requires a live custom-dispatcher or external-command sidecar binding.',
    });
  }

  const sidecarBinding = asRecord(value.sidecarBinding);
  if (sidecarBinding) {
    if (sidecarBinding.schemaVersion !== NATIVE_MULTI_SCREEN_SIDECAR_BINDING_SCHEMA) {
      issues.push({
        id: 'invalid-native-multi-screen-validation-ref-proof',
        path: `${path}.sidecarBinding.schemaVersion`,
        reason: 'Native multi-screen validationRef sidecar binding schema is invalid.',
      });
    }
    if (sidecarBinding.dockerNovncRequired !== false) {
      issues.push({
        id: 'invalid-native-multi-screen-validation-ref-proof',
        path: `${path}.sidecarBinding.dockerNovncRequired`,
        reason: 'Native multi-screen validationRef sidecar binding must not require Docker/noVNC.',
      });
    }
  }

  issues.push(...validateNativeSidecarCapabilitiesProof(asRecord(value.sidecarCapabilities), path));
  issues.push(...validateNativeSidecarDiscoveryProof(asRecord(value.sidecarDiscovery), path));

  const bundleRoot = currentRunBundleRef && isSafeProductSmokeRef(currentRunBundleRef)
    ? currentBundleRoot(currentRunBundleRef)
    : undefined;
  if (bundleRoot) {
    const expectedRunId = runIdFromBundleRoot(bundleRoot);
    if (runId && expectedRunId && runId !== expectedRunId) {
      issues.push({
        id: 'invalid-native-multi-screen-validation-ref-proof',
        path: `${path}.runId`,
        reason: `Native multi-screen validationRef runId ${runId} must match currentRunBundleRef ${currentRunBundleRef}.`,
      });
    }
    for (const namedRef of namedRefs) {
      if (isSafeProductSmokeRef(namedRef.ref) && !isRefUnderBundleRoot(namedRef.ref, bundleRoot)) {
        issues.push({
          id: 'product-smoke-ref-outside-current-bundle',
          path: namedRef.path,
          reason: `Product smoke validationRef proof ${namedRef.ref} must be under currentRunBundleRef ${currentRunBundleRef}.`,
        });
      }
    }
  }

  const currentBundleRunId = stringValue(currentBundle?.runId);
  if (runId && currentBundleRunId && currentBundleRunId !== runId) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.currentBundle.runId`,
      reason: 'Native multi-screen currentBundle runId must match the validationRef runId.',
    });
  }

  return issues;
}

function validateNativeSidecarCapabilitiesProof(
  value: Record<string, unknown> | undefined,
  path: string,
): CuNextProductSmokeMatrixIssue[] {
  if (!value) return [];
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  if (value.schemaVersion !== NATIVE_SIDECAR_CAPABILITIES_SCHEMA) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarCapabilities.schemaVersion`,
      reason: 'Native sidecar capabilities proof has an invalid schema.',
    });
  }
  const features = new Set(stringArray(value.features).map(normalizeToken));
  for (const feature of ['multi-screen', 'multi-actor-cursor', 'window-local-lease', 'screen-global-lease', 'refs-first-evidence']) {
    if (!features.has(feature)) {
      issues.push({
        id: 'invalid-native-multi-screen-validation-ref-proof',
        path: `${path}.sidecarCapabilities.features`,
        reason: `Native sidecar capabilities proof must include ${feature}.`,
      });
    }
  }
  const tools = new Set(stringArray(value.tools).map(normalizeToken));
  for (const tool of ['capabilities', 'preflight', 'capture', 'state', 'execute', 'discover']) {
    if (!tools.has(tool)) {
      issues.push({
        id: 'invalid-native-multi-screen-validation-ref-proof',
        path: `${path}.sidecarCapabilities.tools`,
        reason: `Native sidecar capabilities proof must include tool ${tool}.`,
      });
    }
  }
  for (const key of ['planningPerformed', 'completionJudged', 'sharedSystemInputAllowed', 'dockerNovncRequired']) {
    if (value[key] !== false) {
      issues.push({
        id: 'invalid-native-multi-screen-validation-ref-proof',
        path: `${path}.sidecarCapabilities.${key}`,
        reason: `Native sidecar capabilities proof must keep ${key}=false.`,
      });
    }
  }
  return issues;
}

function validateNativeSidecarDiscoveryProof(
  value: Record<string, unknown> | undefined,
  path: string,
): CuNextProductSmokeMatrixIssue[] {
  if (!value) return [];
  const issues: CuNextProductSmokeMatrixIssue[] = [];
  if (value.schemaVersion !== NATIVE_SIDECAR_DISCOVERY_SCHEMA) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarDiscovery.schemaVersion`,
      reason: 'Native sidecar discovery proof has an invalid schema.',
    });
  }
  if (records(value.screens).length < 2) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarDiscovery.screens`,
      reason: 'Native sidecar discovery proof must include at least two discovered screens.',
    });
  }
  if (records(value.actorCursorPlan).length < 3) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarDiscovery.actorCursorPlan`,
      reason: 'Native sidecar discovery proof must include at least three actor cursor plans.',
    });
  }
  if (records(value.windows).filter((window) => stringValue(window.windowRef)).length < 2) {
    issues.push({
      id: 'invalid-native-multi-screen-validation-ref-proof',
      path: `${path}.sidecarDiscovery.windows`,
      reason: 'Native sidecar discovery proof must bind discovered windows to sidecar window refs.',
    });
  }
  return issues;
}

function validateCurrentBundleScopedRefs(
  item: Record<string, unknown>,
  currentRunBundleRef: string | undefined,
  path: string,
): CuNextProductSmokeMatrixIssue[] {
  if (!currentRunBundleRef || !isSafeProductSmokeRef(currentRunBundleRef)) return [];
  const root = currentBundleRoot(currentRunBundleRef);
  if (!root) return [];
  const refs: Array<{ path: string; ref: string }> = [];
  const productPath = asRecord(item.productPath);
  for (const [key, value] of Object.entries(productPath ?? {})) {
    if (key.endsWith('Ref')) {
      const ref = stringValue(value);
      if (ref) refs.push({ path: `${path}.productPath.${key}`, ref });
    }
  }
  const evidenceRefs = asRecord(item.evidenceRefs);
  for (const [requirement, value] of Object.entries(evidenceRefs ?? {})) {
    stringArray(value).forEach((ref, index) => refs.push({
      path: `${path}.evidenceRefs.${requirement}[${index}]`,
      ref,
    }));
  }
  const validationRef = stringValue(asRecord(item.nativeMultiScreenSummary)?.validationRef);
  if (validationRef) {
    refs.push({ path: `${path}.nativeMultiScreenSummary.validationRef`, ref: validationRef });
  }
  const acceptanceManifestRef = stringValue(item.acceptanceManifestRef);
  if (acceptanceManifestRef) {
    refs.push({ path: `${path}.acceptanceManifestRef`, ref: acceptanceManifestRef });
  }
  return refs
    .filter(({ ref }) => isSafeProductSmokeRef(ref) && !isRefUnderBundleRoot(ref, root))
    .map(({ path: refPath, ref }) => ({
      id: 'product-smoke-ref-outside-current-bundle',
      path: refPath,
      reason: `Product smoke ref ${ref} must be under currentRunBundleRef ${currentRunBundleRef}.`,
    }));
}

function nativeValidationProjection(value: Record<string, unknown>): Record<string, unknown> {
  const summary = asRecord(value.summary);
  return {
    schemaVersion: value.schemaVersion,
    ok: value.ok,
    status: value.status,
    errorCount: value.errorCount,
    realNativeSidecarExecuted: value.realNativeSidecarExecuted ?? summary?.realNativeSidecarExecuted,
    completionEligible: value.completionEligible ?? summary?.completionEligible,
    screenCount: value.screenCount ?? summary?.screenCount,
    actorCursorCount: value.actorCursorCount ?? summary?.actorCursorCount,
    cursorEventTypes: value.cursorEventTypes ?? summary?.cursorEventTypes,
    nonPlaceholderReplayScreenCount: value.nonPlaceholderReplayScreenCount ?? summary?.nonPlaceholderReplayScreenCount,
    sidecarBindingKind: value.sidecarBindingKind ?? summary?.sidecarBindingKind,
  };
}

function matrixStatusFromCases(cases: readonly CuNextProductSmokeCaseEvidence[]): CuNextProductSmokeStatus {
  if (cases.length > 0 && cases.every((item) => item.status === 'passed')) return 'passed';
  if (cases.some((item) => item.status === 'failed')) return 'failed';
  if (cases.some((item) => item.status === 'blocked')) return 'blocked';
  if (cases.some((item) => item.status === 'opt-in-required')) return 'opt-in-required';
  return 'pending';
}

function requireRef(
  issues: CuNextProductSmokeMatrixIssue[],
  path: string,
  ref: string | undefined,
): void {
  if (!ref) {
    issues.push({
      id: 'missing-product-smoke-ref',
      path,
      reason: `${path} is required for product smoke pass evidence.`,
    });
    return;
  }
  if (!isSafeProductSmokeRef(ref)) {
    issues.push({
      id: 'unsafe-product-smoke-ref',
      path,
      reason: `${path} must be a bundle-local relative evidence ref, not an absolute, parent-relative, or URL ref.`,
    });
  }
}

function isSafeProductSmokeRef(ref: string): boolean {
  const normalized = ref.trim();
  if (!normalized) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
  if (normalized.startsWith('/') || normalized.startsWith('~')) return false;
  return !normalized.split(/[\\/]+/).some((part) => part === '..');
}

function currentBundleRoot(ref: string): string {
  const normalized = ref.replace(/\\/g, '/').replace(/\/+$/g, '');
  if (normalized.endsWith('.json')) {
    return normalized.split('/').slice(0, -1).join('/');
  }
  return normalized;
}

function isRefUnderBundleRoot(ref: string, root: string): boolean {
  const normalizedRef = ref.replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/g, '');
  return normalizedRef === normalizedRoot || normalizedRef.startsWith(`${normalizedRoot}/`);
}

function runIdFromBundleRoot(ref: string): string | undefined {
  const parts = ref.replace(/\\/g, '/').replace(/\/+$/g, '').split('/').filter(Boolean);
  return parts.at(-1);
}

function stableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => stableJson(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableJson(item)]),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function uniqueStringList(values: Array<string | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function containsForbiddenLegacyBackendMarker(values: Array<string | undefined>): boolean {
  return values.some((value) => value !== undefined && /\b(?:docker|no-?vnc|novnc|vnc|rdp|container)\b/i.test(value));
}

function normalizeToken(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function isProductSmokeStatus(value: unknown): value is CuNextProductSmokeStatus {
  return value === 'blocked'
    || value === 'opt-in-required'
    || value === 'pending'
    || value === 'passed'
    || value === 'failed';
}

function isProductSmokeCaseId(value: unknown): value is CuNextProductSmokeCaseId {
  return typeof value === 'string'
    && CU_NEXT_PRODUCT_SMOKE_CASES.some((item) => item.id === value);
}

function uniqueIssues(issues: CuNextProductSmokeMatrixIssue[]): CuNextProductSmokeMatrixIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.id}:${issue.path ?? ''}:${issue.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
