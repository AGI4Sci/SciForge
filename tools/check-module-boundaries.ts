import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

export type ImportEdge = {
  importer: string;
  specifier: string;
  line: number;
  resolvedPath?: string;
};

export type Finding = ImportEdge & {
  message: string;
  rule: string;
};

type WarningRule = {
  id: string;
  description: string;
  match: (edge: ImportEdge) => boolean;
};

export type ComputerUseBoundaryPolicy = {
  targetNativeSurfaces: string[];
  forbiddenOwners: string[];
  importBoundaries: string[];
  adapterClassifications: Set<string>;
  remainingMigrationSubtaskIds: Set<string>;
  actionProviderPublicSurface: ComputerUseActionProviderPublicSurface;
};

export type ComputerUseActionProviderPublicSurface = {
  requiredBacklogIds: Set<string>;
  requiredNativeSurfaces: string[];
  browserRuntimeAllowedRefs: Set<string>;
  browserRuntimeAllowedUses: Set<string>;
  browserRuntimeForbiddenUses: Set<string>;
  legacyBackendPackaging: Record<string, string>;
  legacyActiveProductGateEligible?: boolean;
  historicalEvidenceAllowedWhenRefsFirst?: boolean;
  nativeProductGatePolicy: {
    activeGate?: string;
    manifestName?: string;
    manifestSchemaRef?: string;
    requiredManifestFields: Set<string>;
    forbiddenSubstituteGateIds: Set<string>;
    historicalRegressionGateIds: Set<string>;
    productionHost?: string;
    requiredProvenance: Set<string>;
    guiExecutionAllowed?: boolean;
    runtimeBridgePublicProductionApiAllowed?: boolean;
    workspaceGatewayProductionFallbackAllowed?: boolean;
    codexExecJsonProductionFallbackAllowed?: boolean;
  };
  nativeToolsContract: {
    productionHost?: string;
    tools: Set<string>;
    forbiddenPublicParameters: Set<string>;
    requiredProvenance: Set<string>;
  };
  nativeMultiScreenSidecarProtocol: {
    requiredDiscoveryTools: Set<string>;
    requiredExecutionTools: Set<string>;
    completedRunRequiredRefs: Set<string>;
    completedRunRequiredCapabilities: Set<string>;
  };
  diagnosticProbes: Set<string>;
  isolatedDesktopBackendRuntime: {
    legacyDiagnosticOnly?: boolean;
    activeProductGateEligible?: boolean;
    backendPackagingOnly?: boolean;
    legacyBackendKinds: Set<string>;
    claimLimit?: string;
  };
};

export type ComputerUseBoundaryViolation = {
  rule: string;
  message: string;
};

const root = process.cwd();
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'dist-ui', 'build', 'coverage']);
const requiredComputerUseAdapterClassifications = new Set([
  'production',
  'debug-smoke',
  'legacy-test-only',
  'legacy-migration-shim',
  'diagnostic-shim',
  'backend-packaging-not-concurrency-model',
  'legacy-diagnostic-backend-packaging',
]);
const requiredComputerUseOwnershipProductSubtasks = new Set([
  'CU-PKG-22-virtual-app-screen-user-acceptance-product-gate',
]);
const requiredComputerUseActionProductBacklogIds = new Set([
  'CU-PKG-22-window-action-session-current-evidence-product-gate',
  'CU-PKG-24-browser-runtime-dom-ax-observation-refs',
  'CU-PKG-25-native-multi-app-workflow-live-acceptance-matrix',
  'CU-PKG-26-public-surface-parity-guard',
]);
const requiredComputerUseHistoricalRegressionSubtasks = new Set([
  'CU-PKG-23-multi-screen-live-demo',
]);
const requiredComputerUseBoundarySubtasks = new Set([
  'CU-PKG-20-import-boundary-guard',
  ...requiredComputerUseOwnershipProductSubtasks,
  ...requiredComputerUseHistoricalRegressionSubtasks,
]);
const requiredComputerUseOwnershipNativeSurfaces = [
  'WindowActionSession action router',
  'current-run evidence bundle',
  'virtual-app-screen-user-acceptance product gate',
  'virtual-app-screen-user-acceptance-manifest',
  'BrowserRuntime DOM/AX observation refs',
  'native multi-app workflow/live acceptance matrix',
  'native multi-screen/multi-actor cursor historical opt-in regression',
  'multi-screen live demo historical diagnostic',
];
const requiredComputerUseActionNativeSurfaces = [
  'WindowActionSession current evidence product gate',
  'computer-use-current-evidence-bundle manifest',
  'BrowserRuntime DOM/AX observation refs',
  'native multi-app workflow/live acceptance matrix',
  'legacy VirtualAppScreen compatibility diagnostics',
  'native multi-screen/multi-actor cursor historical opt-in regression',
  'multi-screen live demo historical diagnostic',
];
const requiredCurrentEvidenceBundleManifestFields = new Set([
  'taskId',
  'scenarioId',
  'userIntent',
  'currentBundleRef',
  'windowActionSessionRef',
  'hostPortsRef',
  'targetWindowRefs',
  'executorEventRefs',
  'beforeAfterFrameRefs',
  'artifactRefs',
  'verificationRefs',
  'traceRefs',
  'evidenceLedgerRef',
  'isolationFlags',
  'blockedReason',
]);
const requiredCurrentEvidenceBundleProvenance = new Set([
  'taskId',
  'scenarioId',
  'userIntent',
  'currentBundleRef',
  'windowActionSessionRef',
  'hostPortsRef',
  'targetWindowRefs',
  'appStateRef',
  'screenshotRef',
  'focusCropRefs',
  'groundingRefs',
  'executorLeaseRefs',
  'executorEventRefs',
  'beforeAfterFrameRefs',
  'artifactRefs',
  'verificationRefs',
  'guiPresentRefs',
  'approvalRefs',
  'cancelRefs',
  'traceRefs',
  'replayRefs',
  'evidenceLedgerRef',
  'isolationFlags',
  'blockedReason',
]);
const requiredCurrentEvidenceForbiddenSubstituteGateIds = new Set([
  'package-smoke',
  'm6-native-multi-screen',
  'target-bound-fixture',
  'historical-docker-novnc',
  'single-click-smoke',
  'dom',
  'playwright',
  'accessibility',
  'shell-direct-artifact',
  'old-trace',
  'gui-executor',
  'shared-system-input',
]);
const requiredComputerUseNativeTools = new Set([
  'get_app_state',
  'observe',
  'click',
  'type_text',
  'scroll',
  'press_key',
  'propose_action',
  'execute_scoped_action',
  'get_replay_refs',
]);
const requiredForbiddenComputerUsePublicParameters = new Set([
  'providerRoute',
  'guiPrivateState',
  'schedulerInternals',
  'executorAdapterRef',
  'leaseId',
  'leaseScope',
  'globalX',
  'globalY',
]);
const requiredComputerUseNativeProvenance = new Set([
  'displayGroupId',
  'screenId',
  'windowId',
  'actorId',
  'cursorId',
  'schedulerLeaseRef',
  'appStateRef',
  'screenshotRef',
  'groundingRefs',
  'replayRefs',
  'currentBundleRef',
]);
const requiredNativeMultiScreenSidecarDiscoveryTools = new Set(['capabilities', 'discover']);
const requiredNativeMultiScreenSidecarExecutionTools = new Set(['preflight', 'capture', 'state', 'execute']);
const requiredNativeMultiScreenSidecarCompletedRefs = new Set([
  'sidecarBindingRef',
  'sidecarCapabilitiesRef',
  'sidecarDiscoveryRef',
  'schedulerLeaseRef',
  'replayRef',
  'currentBundleRef',
]);
const requiredNativeMultiScreenSidecarCapabilities = new Set([
  'multi-screen',
  'multi-actor-cursor',
  'window-local-lease',
  'screen-global-lease',
  'refs-first-evidence',
]);
const requiredBrowserRuntimeObservationRefs = new Set([
  'browserRuntimeDomSnapshotRef',
  'browserRuntimeVisibleDomRef',
  'browserRuntimeAccessibilitySnapshotRef',
  'browserRuntimePlaywrightEvaluateRef',
  'browserRuntimeStableTargetRef',
  'browserRuntimePageQueryRef',
  'browserRuntimeGroundingHintRef',
]);
const requiredBrowserRuntimeObservationUses = new Set([
  'observe-before-mutate-hint',
  'grounding-hint',
]);
const requiredLegacyBackendKinds = new Set([
  'docker',
  'linux-novnc',
  'rdp',
]);

const knownPackagePrivateImportWarnings: WarningRule[] = [
  {
    id: 'legacy-object-reference-ui-domain-types',
    description: 'packages/support/object-references still imports UI domain types; migrate those contracts into packages/contracts/runtime or a package-owned contract file.',
    match: (edge) => edge.importer.startsWith('packages/support/object-references/') && pointsAtUiDomain(edge),
  },
  {
    id: 'legacy-artifact-preview-ui-domain-types',
    description: 'packages/support/artifact-preview still imports UI domain types; migrate preview/artifact contracts into packages/contracts/runtime or a package-owned contract file.',
    match: (edge) => edge.importer.startsWith('packages/support/artifact-preview/') && pointsAtUiDomain(edge),
  },
];

const knownUiPackageDeepImportWarnings: WarningRule[] = [
  {
    id: 'ui-scenario-core-bridge-src-reexports',
    description: 'src/ui/src/scenarioCompiler is a compatibility bridge over packages/scenarios/core/src; migrate callers to package public exports.',
    match: (edge) => edge.importer.startsWith('src/ui/src/scenarioCompiler/') && edge.resolvedPath?.startsWith('packages/scenarios/core/src/') === true,
  },
  {
    id: 'ui-scenario-specs-src-import',
    description: 'src/ui/src/scenarioSpecs imports packages/scenarios/core/src/scenarioSpecs; migrate to package public exports with the rest of the scenario bridge.',
    match: (edge) => edge.importer === 'src/ui/src/scenarioSpecs.ts' && edge.resolvedPath === 'packages/scenarios/core/src/scenarioSpecs',
  },
  {
    id: 'ui-design-system-src-bridge',
    description: 'src/ui/src/app/uiPrimitives imports packages/presentation/design-system/src; use @agi4sci/design-system or the package root export after aliases are settled.',
    match: (edge) => edge.importer === 'src/ui/src/app/uiPrimitives.tsx' && edge.resolvedPath === 'packages/presentation/design-system/src',
  },
];

async function main() {
  const computerUseBoundaryPolicy = await loadComputerUseBoundaryPolicy(root);
  const packageRoots = await collectPackageRoots();
  const packageNames = await collectPackageNames(packageRoots);
  const files = [
    ...await collectSourceFiles(join(root, 'packages')),
    ...await collectSourceFilesIfExists(join(root, 'src/shared')),
    ...await collectSourceFilesIfExists(join(root, 'src/ui')),
    ...await collectSourceFilesIfExists(join(root, 'src/runtime/computer-use')),
    ...await collectSourceFilesIfExists(join(root, 'src/runtime/vision-sense')),
  ];
  const uniqueFiles = [...new Set(files)];
  const edges = (await Promise.all(uniqueFiles.map(readImportEdges))).flat();

  const errors: Finding[] = [];
  const warnings: Finding[] = [];

  for (const issue of computerUseBoundaryManifestIssues(computerUseBoundaryPolicy)) {
    errors.push({
      importer: 'docs/native-extension-ownership-map.json',
      specifier: 'computer-use',
      line: 1,
      rule: 'cu-manifest-boundary-policy',
      message: issue,
    });
  }

  for (const sharedFile of await collectSourceFilesIfExists(join(root, 'src/shared'))) {
    errors.push({
      importer: relative(root, sharedFile).replaceAll('\\', '/'),
      specifier: 'src/shared',
      line: 1,
      resolvedPath: relative(root, sharedFile).replaceAll('\\', '/'),
      rule: 'legacy-src-shared-file',
      message: 'src/shared is not a long-term boundary. Move shared contracts into packages/contracts/runtime, runtime execution into src/runtime, and UI logic into src/ui.',
    });
  }

  for (const edge of edges) {
    checkComputerUseImportBoundary(edge, packageNames, errors);
    if (edge.importer.startsWith('packages/')) {
      checkPackagePrivateRuntimeImport(edge, errors, warnings);
    }
    if (edge.importer.startsWith('src/ui/')) {
      checkUiPackageDeepImport(edge, packageRoots, packageNames, errors, warnings);
    }
  }

  if (warnings.length) {
    console.warn('[module-boundaries] warnings: known migration exceptions remain');
    for (const [rule, grouped] of groupFindings(warnings)) {
      console.warn(`- ${rule}: ${grouped[0].message} (${grouped.length})`);
      for (const finding of grouped.slice(0, 8)) {
        console.warn(`  ${finding.importer}:${finding.line} -> ${finding.specifier}`);
      }
      if (grouped.length > 8) console.warn(`  ... ${grouped.length - 8} more`);
    }
  }

  if (errors.length) {
    console.error('[module-boundaries] boundary violations found');
    for (const finding of errors) {
      console.error(`- ${finding.importer}:${finding.line} -> ${finding.specifier}`);
      console.error(`  ${finding.message}`);
    }
    console.error('Move shared contracts into packages/contracts/runtime, packages/scenarios/core, or a package public export; move execution logic into src/runtime and UI logic into src/ui. Update the allowlist only for intentional temporary migrations.');
    process.exitCode = 1;
    return;
  }

  console.log(`[ok] module boundaries checked: ${uniqueFiles.length} files, ${edges.length} imports.`);
}

function checkPackagePrivateRuntimeImport(edge: ImportEdge, errors: Finding[], warnings: Finding[]) {
  if (!pointsAtPrivateAppOrRuntime(edge)) return;
  const allowed = knownPackagePrivateImportWarnings.find((rule) => rule.match(edge));
  const finding = {
    ...edge,
    rule: allowed?.id ?? 'package-private-app-runtime-import',
    message: allowed?.description ?? 'Package code must not import src/ui/src or src/runtime private files.',
  };
  if (allowed) warnings.push(finding);
  else errors.push(finding);
}

export function checkComputerUseImportBoundary(
  edge: ImportEdge,
  packageNames: Map<string, string>,
  errors: Finding[],
) {
  const violation = computerUseImportBoundaryViolation(edge, packageNames);
  if (!violation) return;
  errors.push({
    ...edge,
    rule: violation.rule,
    message: violation.message,
  });
}

export function computerUseImportBoundaryViolation(
  edge: ImportEdge,
  packageNames: Map<string, string> = new Map(),
): ComputerUseBoundaryViolation | undefined {
  if (isGuiImporter(edge.importer)) {
    const forbiddenTarget = computerUseForbiddenGuiTarget(edge);
    if (!forbiddenTarget) return undefined;
    return {
      rule: `cu-gui-import-${forbiddenTarget}`,
      message: 'src/ui may only consume Computer Use through shared contracts, GUI presentation packages, terminal-equivalent text, or TUI-host GUI intents; it must not import Computer Use action providers, observe provider implementations, runtime bridges, executors, or schedulers.',
    };
  }

  if (isComputerUseBoundaryImporter(edge.importer)) {
    const forbiddenTarget = computerUseForbiddenL0Target(edge, packageNames);
    if (!forbiddenTarget) return undefined;
    return {
      rule: `cu-l0-import-${forbiddenTarget}`,
      message: 'Computer Use L0/L1 handlers and migration bridges must not import GUI presentation/private UI such as renderer registries, Workbench, AnnotationSidebar, or presentation packages; presentation must flow through refs and TUI-host GUI module intents.',
    };
  }

  return undefined;
}

function computerUseForbiddenGuiTarget(edge: ImportEdge) {
  if (pointsAtWorkspacePath(edge, ['packages/actions/computer-use']) || looksLikeBareComputerUseActionProvider(edge.specifier)) {
    return 'action-provider';
  }
  if (pointsAtWorkspacePath(edge, ['packages/observe/vision']) || looksLikeBareComputerUseObserveProvider(edge.specifier)) {
    return 'observe-provider';
  }
  if (
    pointsAtWorkspacePath(edge, ['src/runtime/computer-use', 'src/runtime/vision-sense'])
    || pointsAtRuntimeComputerUseBridge(edge.specifier)
  ) {
    return 'runtime-bridge';
  }
  return undefined;
}

function computerUseForbiddenL0Target(edge: ImportEdge, packageNames: Map<string, string>) {
  if (pointsAtWorkspacePath(edge, ['src/ui', 'packages/presentation'])) return 'gui-presentation';
  const barePackage = bareWorkspacePackage(edge.specifier, packageNames);
  if (barePackage?.root.startsWith('packages/presentation/')) return 'gui-presentation';
  if (looksLikeBareGuiPresentationPackage(edge.specifier)) return 'gui-presentation';
  return undefined;
}

function isGuiImporter(importer: string) {
  return importer === 'src/ui' || importer.startsWith('src/ui/');
}

function isComputerUseBoundaryImporter(importer: string) {
  return pathIsWithin(importer, 'packages/actions/computer-use')
    || pathIsWithin(importer, 'packages/observe/vision')
    || pathIsWithin(importer, 'src/runtime/computer-use')
    || pathIsWithin(importer, 'src/runtime/vision-sense');
}

function checkUiPackageDeepImport(
  edge: ImportEdge,
  packageRoots: string[],
  packageNames: Map<string, string>,
  errors: Finding[],
  warnings: Finding[],
) {
  if (edge.specifier === '@sciforge-observe/web/browser-runtime') {
    errors.push({
      ...edge,
      rule: 'ui-browser-runtime-observe-import',
      message: 'GUI code must import pure browser runtime types/helpers from @sciforge-ui/runtime-contract/browser-runtime; @sciforge-observe/web owns the TUI browser_runtime capability wrapper.',
    });
    return;
  }

  if (edge.resolvedPath?.startsWith('packages/')) {
    const packageRoot = longestPackageRootForPath(edge.resolvedPath, packageRoots);
    if (!packageRoot) return;
    const subpath = packageSubpath(edge.resolvedPath, packageRoot);
    if (!subpath || subpath === 'index' || subpath === 'index.ts' || subpath === 'index.tsx') return;
    const allowed = knownUiPackageDeepImportWarnings.find((rule) => rule.match(edge));
    const finding = {
      ...edge,
      rule: allowed?.id ?? 'ui-package-relative-deep-import',
      message: allowed?.description ?? `UI app imports package internals (${packageRoot}/${subpath}); use the package root or an exported subpath instead.`,
    };
    if (allowed) warnings.push(finding);
    else errors.push(finding);
    return;
  }

  const barePackage = bareWorkspacePackage(edge.specifier, packageNames);
  if (!barePackage) return;
  const subpath = edge.specifier.slice(barePackage.name.length).replace(/^\//, '');
  if (!subpath) return;
  if (subpath.includes('/src/') || subpath === 'src' || subpath.startsWith('src/')) {
    errors.push({
      ...edge,
      rule: 'ui-package-bare-src-import',
      message: `UI app imports ${barePackage.root}/${subpath}; use ${barePackage.name} public exports instead of package src internals.`,
    });
  }
}

async function collectPackageRoots() {
  const packageJsonFiles = await collectFiles(join(root, 'packages'), (name) => name === 'package.json');
  return packageJsonFiles
    .map((file) => relative(root, dirname(file)).replaceAll('\\', '/'))
    .sort((left, right) => right.length - left.length);
}

async function collectPackageNames(packageRoots: string[]) {
  const names = new Map<string, string>();
  for (const packageRoot of packageRoots) {
    const json = JSON.parse(await readFile(join(root, packageRoot, 'package.json'), 'utf8')) as { name?: unknown };
    if (typeof json.name === 'string') names.set(json.name, packageRoot);
  }
  return names;
}

export async function loadComputerUseBoundaryPolicy(workspaceRoot = root): Promise<ComputerUseBoundaryPolicy> {
  const manifestPath = join(workspaceRoot, 'docs/native-extension-ownership-map.json');
  const actionManifestPath = join(workspaceRoot, 'packages/actions/computer-use/action-provider.manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    entries?: Array<{
      id?: unknown;
      targetNativeSurfaces?: unknown;
      forbiddenOwners?: unknown;
      importBoundaries?: unknown;
      adapterClassifications?: unknown;
      remainingMigrationSubtasks?: unknown;
    }>;
  };
  const actionManifest = JSON.parse(await readFile(actionManifestPath, 'utf8')) as {
    nativeToolsContract?: unknown;
    publicSurfaceParity?: unknown;
    isolatedDesktopBackendRuntime?: unknown;
    hostPortsContract?: unknown;
  };
  const computerUse = Array.isArray(manifest.entries)
    ? manifest.entries.find((entry) => entry.id === 'computer-use')
    : undefined;
  const nativeToolsContract = asRecord(actionManifest.nativeToolsContract);
  const publicSurfaceParity = asRecord(actionManifest.publicSurfaceParity);
  const browserRuntimeObservationPolicy = asRecord(publicSurfaceParity?.browserRuntimeObservationPolicy);
  const legacyBackendPackaging = asRecord(publicSurfaceParity?.legacyBackendPackaging);
  const nativeProductGatePolicy = asRecord(publicSurfaceParity?.nativeProductGatePolicy);
  const hostPortsContract = asRecord(actionManifest.hostPortsContract);
  const nativeMultiScreenSidecarProtocol = asRecord(hostPortsContract?.nativeMultiScreenSidecarProtocol);
  const isolatedDesktopBackendRuntime = asRecord(actionManifest.isolatedDesktopBackendRuntime);
  return {
    targetNativeSurfaces: stringArray(computerUse?.targetNativeSurfaces),
    forbiddenOwners: stringArray(computerUse?.forbiddenOwners),
    importBoundaries: stringArray(computerUse?.importBoundaries),
    adapterClassifications: new Set(classificationArray(computerUse?.adapterClassifications)),
    remainingMigrationSubtaskIds: new Set(migrationSubtaskIds(computerUse?.remainingMigrationSubtasks)),
    actionProviderPublicSurface: {
      requiredBacklogIds: new Set(stringArray(publicSurfaceParity?.requiredBacklogIds)),
      requiredNativeSurfaces: stringArray(publicSurfaceParity?.requiredNativeSurfaces),
      browserRuntimeAllowedRefs: new Set(stringArray(browserRuntimeObservationPolicy?.allowedRefs)),
      browserRuntimeAllowedUses: new Set(stringArray(browserRuntimeObservationPolicy?.allowedUses)),
      browserRuntimeForbiddenUses: new Set(stringArray(browserRuntimeObservationPolicy?.forbiddenUses)),
      legacyBackendPackaging: stringRecord(legacyBackendPackaging),
      legacyActiveProductGateEligible: booleanField(legacyBackendPackaging?.activeProductGateEligible),
      historicalEvidenceAllowedWhenRefsFirst: booleanField(legacyBackendPackaging?.historicalEvidenceAllowedWhenRefsFirst),
      nativeProductGatePolicy: {
        activeGate: stringField(nativeProductGatePolicy?.activeGate),
        manifestName: stringField(nativeProductGatePolicy?.manifestName),
        manifestSchemaRef: stringField(nativeProductGatePolicy?.manifestSchemaRef),
        requiredManifestFields: new Set(stringArray(nativeProductGatePolicy?.requiredManifestFields)),
        forbiddenSubstituteGateIds: new Set(stringArray(nativeProductGatePolicy?.forbiddenSubstituteGateIds)),
        historicalRegressionGateIds: new Set(stringArray(nativeProductGatePolicy?.historicalRegressionGateIds)),
        productionHost: stringField(nativeProductGatePolicy?.productionHost),
        requiredProvenance: new Set(stringArray(nativeProductGatePolicy?.requiredProvenance)),
        guiExecutionAllowed: booleanField(nativeProductGatePolicy?.guiExecutionAllowed),
        runtimeBridgePublicProductionApiAllowed: booleanField(nativeProductGatePolicy?.runtimeBridgePublicProductionApiAllowed),
        workspaceGatewayProductionFallbackAllowed: booleanField(nativeProductGatePolicy?.workspaceGatewayProductionFallbackAllowed),
        codexExecJsonProductionFallbackAllowed: booleanField(nativeProductGatePolicy?.codexExecJsonProductionFallbackAllowed),
      },
      nativeToolsContract: {
        productionHost: stringField(nativeToolsContract?.productionHost),
        tools: new Set(stringArray(nativeToolsContract?.tools)),
        forbiddenPublicParameters: new Set(stringArray(nativeToolsContract?.forbiddenPublicParameters)),
        requiredProvenance: new Set(stringArray(nativeToolsContract?.requiredProvenance)),
      },
      nativeMultiScreenSidecarProtocol: {
        requiredDiscoveryTools: new Set(stringArray(nativeMultiScreenSidecarProtocol?.requiredDiscoveryTools)),
        requiredExecutionTools: new Set(stringArray(nativeMultiScreenSidecarProtocol?.requiredExecutionTools)),
        completedRunRequiredRefs: new Set(stringArray(nativeMultiScreenSidecarProtocol?.completedRunRequiredRefs)),
        completedRunRequiredCapabilities: new Set(stringArray(nativeMultiScreenSidecarProtocol?.completedRunRequiredCapabilities)),
      },
      diagnosticProbes: new Set(Object.keys(asRecord(hostPortsContract?.diagnosticProbes) ?? {})),
      isolatedDesktopBackendRuntime: {
        legacyDiagnosticOnly: booleanField(isolatedDesktopBackendRuntime?.legacyDiagnosticOnly),
        activeProductGateEligible: booleanField(isolatedDesktopBackendRuntime?.activeProductGateEligible),
        backendPackagingOnly: booleanField(isolatedDesktopBackendRuntime?.backendPackagingOnly),
        legacyBackendKinds: new Set(stringArray(isolatedDesktopBackendRuntime?.legacyBackendKinds)),
        claimLimit: stringField(isolatedDesktopBackendRuntime?.claimLimit),
      },
    },
  };
}

export function computerUseBoundaryManifestIssues(policy: ComputerUseBoundaryPolicy) {
  const issues: string[] = [];
  if (!policy.importBoundaries.some((item) => item.includes('src/ui') && item.includes('packages/actions/computer-use'))) {
    issues.push('Computer Use ownership manifest must classify the GUI -> action provider import boundary.');
  }
  if (!policy.importBoundaries.some((item) => item.includes('packages/observe/vision') && /provider implementation|sense|grounding/i.test(item))) {
    issues.push('Computer Use ownership manifest must classify observe/vision as a TUI sense provider implementation, not a GUI import surface.');
  }
  if (!policy.importBoundaries.some((item) => item.includes('src/runtime/computer-use') && /bridge|host-port|diagnostic|adapter/i.test(item))) {
    issues.push('Computer Use ownership manifest must classify src/runtime/computer-use as a runtime bridge or host adapter boundary.');
  }
  if (!policy.importBoundaries.some((item) => /L0|handlers?|Workbench|AnnotationSidebar|renderer/i.test(item))) {
    issues.push('Computer Use ownership manifest must classify L0 handler imports away from GUI renderer, Workbench, and AnnotationSidebar implementation details.');
  }
  for (const classification of requiredComputerUseAdapterClassifications) {
    if (!policy.adapterClassifications.has(classification)) {
      issues.push(`Computer Use ownership manifest is missing adapter classification ${classification}.`);
    }
  }
  for (const id of requiredComputerUseBoundarySubtasks) {
    if (!policy.remainingMigrationSubtaskIds.has(id)) {
      issues.push(`Computer Use ownership manifest is missing migration subtask ${id}.`);
    }
  }
  for (const surface of requiredComputerUseOwnershipNativeSurfaces) {
    if (!policy.targetNativeSurfaces.includes(surface)) {
      issues.push(`Computer Use ownership manifest is missing native surface ${surface}.`);
    }
  }
  for (const surface of requiredComputerUseActionNativeSurfaces) {
    if (!policy.actionProviderPublicSurface.requiredNativeSurfaces.includes(surface)) {
      issues.push(`Computer Use public surface parity is missing native surface ${surface}.`);
    }
  }
  for (const id of requiredComputerUseActionProductBacklogIds) {
    if (!policy.actionProviderPublicSurface.requiredBacklogIds.has(id)) {
      issues.push(`Computer Use public surface parity is missing backlog id ${id}.`);
    }
  }
  for (const id of requiredComputerUseHistoricalRegressionSubtasks) {
    if (!policy.remainingMigrationSubtaskIds.has(id) || !policy.actionProviderPublicSurface.requiredBacklogIds.has(id)) {
      issues.push(`Computer Use must retain historical opt-in regression subtask ${id}.`);
    }
  }
  const nativePolicy = policy.actionProviderPublicSurface.nativeProductGatePolicy;
  if (nativePolicy.activeGate !== 'window-action-session-current-evidence') {
    issues.push('Computer Use active product gate must be window-action-session-current-evidence.');
  }
  if (nativePolicy.manifestName !== 'computer-use-current-evidence-bundle') {
    issues.push('Computer Use active product gate must name computer-use-current-evidence-bundle.');
  }
  if (nativePolicy.manifestSchemaRef !== 'sciforge.computer-use.current-evidence-bundle.v1') {
    issues.push('Computer Use active product gate must declare the current evidence bundle schema ref.');
  }
  if (!/WindowActionSession|TypeScript|host-port/i.test(nativePolicy.productionHost ?? '')) {
    issues.push('Computer Use active product gate production host must name the TypeScript WindowActionSession host-port route.');
  }
  for (const field of requiredCurrentEvidenceBundleManifestFields) {
    if (!nativePolicy.requiredManifestFields.has(field) || !nativePolicy.requiredProvenance.has(field)) {
      issues.push(`Computer Use current evidence bundle policy is missing manifest/provenance field ${field}.`);
    }
  }
  for (const field of requiredCurrentEvidenceBundleProvenance) {
    if (!nativePolicy.requiredProvenance.has(field)) {
      issues.push(`Computer Use current evidence bundle policy is missing provenance field ${field}.`);
    }
  }
  for (const gateId of requiredCurrentEvidenceForbiddenSubstituteGateIds) {
    if (!nativePolicy.forbiddenSubstituteGateIds.has(gateId)) {
      issues.push(`Computer Use current evidence bundle policy must reject substitute gate ${gateId}.`);
    }
  }
  for (const historicalGate of ['m6-native-multi-screen', 'multi-screen-live-demo']) {
    if (!nativePolicy.historicalRegressionGateIds.has(historicalGate)) {
      issues.push(`Computer Use policy must retain ${historicalGate} only as a historical opt-in regression gate.`);
    }
  }
  for (const tool of requiredComputerUseNativeTools) {
    if (!policy.actionProviderPublicSurface.nativeToolsContract.tools.has(tool)) {
      issues.push(`Computer Use native tool public surface is missing tool ${tool}.`);
    }
  }
  for (const parameter of requiredForbiddenComputerUsePublicParameters) {
    if (!policy.actionProviderPublicSurface.nativeToolsContract.forbiddenPublicParameters.has(parameter)) {
      issues.push(`Computer Use native tool public surface must forbid parameter ${parameter}.`);
    }
  }
  for (const provenance of requiredComputerUseNativeProvenance) {
    if (!policy.actionProviderPublicSurface.nativeToolsContract.requiredProvenance.has(provenance)) {
      issues.push(`Computer Use native tool public surface is missing required provenance ${provenance}.`);
    }
  }
  if (!policy.actionProviderPublicSurface.diagnosticProbes.has('nativeMultiScreenLiveDemo')) {
    issues.push('Computer Use diagnostic probes must expose nativeMultiScreenLiveDemo for opt-in M6 evidence collection.');
  }
  const nativeMultiScreenProtocol = policy.actionProviderPublicSurface.nativeMultiScreenSidecarProtocol;
  for (const tool of requiredNativeMultiScreenSidecarDiscoveryTools) {
    if (!nativeMultiScreenProtocol.requiredDiscoveryTools.has(tool)) {
      issues.push(`Computer Use native multi-screen sidecar protocol is missing discovery tool ${tool}.`);
    }
  }
  for (const tool of requiredNativeMultiScreenSidecarExecutionTools) {
    if (!nativeMultiScreenProtocol.requiredExecutionTools.has(tool)) {
      issues.push(`Computer Use native multi-screen sidecar protocol is missing execution tool ${tool}.`);
    }
  }
  for (const ref of requiredNativeMultiScreenSidecarCompletedRefs) {
    if (!nativeMultiScreenProtocol.completedRunRequiredRefs.has(ref)) {
      issues.push(`Computer Use native multi-screen sidecar protocol is missing completed run ref ${ref}.`);
    }
  }
  for (const capability of requiredNativeMultiScreenSidecarCapabilities) {
    if (!nativeMultiScreenProtocol.completedRunRequiredCapabilities.has(capability)) {
      issues.push(`Computer Use native multi-screen sidecar protocol is missing completed capability ${capability}.`);
    }
  }
  for (const ref of requiredBrowserRuntimeObservationRefs) {
    if (!policy.actionProviderPublicSurface.browserRuntimeAllowedRefs.has(ref)) {
      issues.push(`Computer Use BrowserRuntime observation policy is missing allowed ref ${ref}.`);
    }
  }
  for (const use of requiredBrowserRuntimeObservationUses) {
    if (!policy.actionProviderPublicSurface.browserRuntimeAllowedUses.has(use)) {
      issues.push(`Computer Use BrowserRuntime observation policy is missing allowed use ${use}.`);
    }
  }
  for (const forbiddenUse of ['Computer Use executor', 'completion evidence by itself', 'DOM click shortcut', 'AX action shortcut', 'Playwright action shortcut']) {
    if (!policy.actionProviderPublicSurface.browserRuntimeForbiddenUses.has(forbiddenUse)) {
      issues.push(`Computer Use BrowserRuntime observation policy is missing forbidden use ${forbiddenUse}.`);
    }
  }
  if (!nativePolicy.productionHost) {
    issues.push('Computer Use native product gate policy must declare a productionHost.');
  }
  if (
    nativePolicy.guiExecutionAllowed !== false
    || nativePolicy.runtimeBridgePublicProductionApiAllowed !== false
    || nativePolicy.workspaceGatewayProductionFallbackAllowed !== false
    || nativePolicy.codexExecJsonProductionFallbackAllowed !== false
  ) {
    issues.push('Computer Use native product gate policy must fail closed for GUI execution, runtime bridge public production API, Workspace Gateway fallback, and codex exec JSON fallback.');
  }
  const legacyRuntime = policy.actionProviderPublicSurface.isolatedDesktopBackendRuntime;
  if (
    legacyRuntime.legacyDiagnosticOnly !== true
    || legacyRuntime.activeProductGateEligible !== false
    || legacyRuntime.backendPackagingOnly !== true
  ) {
    issues.push('Computer Use isolated desktop backend runtime must remain legacy diagnostic/backend packaging only and not active product gate eligible.');
  }
  for (const kind of requiredLegacyBackendKinds) {
    if (!legacyRuntime.legacyBackendKinds.has(kind)) {
      issues.push(`Computer Use isolated desktop backend runtime is missing legacy backend kind ${kind}.`);
    }
  }
  return issues;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function stringRecord(value: unknown) {
  const record = asRecord(value);
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : undefined;
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function classificationArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const classification = (item as { classification?: unknown }).classification;
    return typeof classification === 'string' ? [classification] : [];
  });
}

function migrationSubtaskIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const id = (item as { id?: unknown }).id;
    return typeof id === 'string' ? [id] : [];
  });
}

async function collectSourceFiles(dir: string): Promise<string[]> {
  return collectFiles(dir, (name) => sourceExtensions.has(extension(name)));
}

async function collectSourceFilesIfExists(dir: string): Promise<string[]> {
  try {
    await access(dir);
  } catch {
    return [];
  }
  return collectSourceFiles(dir);
}

async function collectFiles(dir: string, includeFile: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFiles(full, includeFile));
      continue;
    }
    if (entry.isFile() && includeFile(entry.name)) out.push(full);
  }
  return out;
}

async function readImportEdges(file: string): Promise<ImportEdge[]> {
  const text = await readFile(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const importer = relative(root, file).replaceAll('\\', '/');
  const edges: ImportEdge[] = [];

  function add(specifier: string, node: ts.Node) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    edges.push({
      importer,
      specifier,
      line,
      resolvedPath: resolveSpecifier(importer, specifier),
    });
  }

  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.moduleSpecifier);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [firstArg] = node.arguments;
      if (firstArg && ts.isStringLiteral(firstArg)) add(firstArg.text, firstArg);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return edges;
}

function resolveSpecifier(importer: string, specifier: string) {
  if (!specifier.startsWith('.')) return undefined;
  return relative(root, resolve(root, dirname(importer), specifier)).replaceAll('\\', '/');
}

function pointsAtPrivateAppOrRuntime(edge: ImportEdge) {
  return edge.resolvedPath?.startsWith('src/ui/src/') === true
    || edge.resolvedPath === 'src/ui/src'
    || edge.resolvedPath?.startsWith('src/runtime/') === true
    || edge.resolvedPath === 'src/runtime'
    || edge.resolvedPath?.startsWith('src/shared/') === true
    || edge.resolvedPath === 'src/shared'
    || /(^|\/)src\/ui\/src(\/|$)/.test(edge.specifier)
    || /(^|\/)src\/runtime(\/|$)/.test(edge.specifier)
    || /(^|\/)src\/shared(\/|$)/.test(edge.specifier);
}

function pointsAtWorkspacePath(edge: ImportEdge, prefixes: string[]) {
  return prefixes.some((prefix) => {
    const normalizedPrefix = prefix.replaceAll('\\', '/').replace(/\/$/, '');
    return pathIsWithin(edge.resolvedPath, normalizedPrefix)
      || pathIsWithin(normalizeSpecifierPath(edge.specifier), normalizedPrefix);
  });
}

function pointsAtRuntimeComputerUseBridge(specifier: string) {
  const normalized = normalizeSpecifierPath(specifier);
  return pathIsWithin(normalized, 'src/runtime/computer-use')
    || pathIsWithin(normalized, 'src/runtime/vision-sense')
    || /(^|\/)vision-sense-runtime(?:\.[cm]?[jt]sx?|$)/.test(normalized);
}

function looksLikeBareComputerUseActionProvider(specifier: string) {
  return /^@[^/]*actions?[^/]*\/computer-use(?:\/|$)/.test(specifier)
    || /^@[^/]+(?:\/|-)actions?(?:\/|-)computer-use(?:\/|$)/.test(specifier)
    || /^@[^/]+\/computer-use-action(?:\/|$)/.test(specifier)
    || /^@[^/]+\/computer-use-provider(?:\/|$)/.test(specifier);
}

function looksLikeBareComputerUseObserveProvider(specifier: string) {
  return /^@[^/]*observe[^/]*\/vision(?:\/|$)/.test(specifier)
    || /^@[^/]+(?:\/|-)observe(?:\/|-)vision(?:\/|$)/.test(specifier)
    || /^@[^/]+\/vision-sense(?:\/|$)/.test(specifier);
}

function looksLikeBareGuiPresentationPackage(specifier: string) {
  if (specifier === '@sciforge/interactive-views' || specifier.startsWith('@sciforge/interactive-views/')) return true;
  if (specifier === '@sciforge-ui/components' || specifier.startsWith('@sciforge-ui/components/')) return true;
  return /^@sciforge-ui\/(?:.+-viewer|browser-workbench|terminal-session-viewer|workspace-file-viewer|presentation-|design-system)(?:\/|$)/.test(specifier);
}

function pathIsWithin(path: string | undefined, prefix: string) {
  if (!path) return false;
  const normalizedPath = path.replaceAll('\\', '/').replace(/\/$/, '');
  const normalizedPrefix = prefix.replaceAll('\\', '/').replace(/\/$/, '');
  return normalizedPath === normalizedPrefix
    || normalizedPath.startsWith(`${normalizedPrefix}/`)
    || normalizedPath.startsWith(`${normalizedPrefix}.`);
}

function normalizeSpecifierPath(specifier: string) {
  return specifier.replaceAll('\\', '/').replace(/^\.\//, '');
}

function pointsAtUiDomain(edge: ImportEdge) {
  return edge.resolvedPath === 'src/ui/src/domain' || edge.resolvedPath === 'src/ui/src/domain.ts';
}

function longestPackageRootForPath(path: string, packageRoots: string[]) {
  return packageRoots.find((packageRoot) => path === packageRoot || path.startsWith(`${packageRoot}/`));
}

function packageSubpath(path: string, packageRoot: string) {
  return path === packageRoot ? '' : path.slice(packageRoot.length + 1);
}

function bareWorkspacePackage(specifier: string, packageNames: Map<string, string>) {
  for (const [name, packageRoot] of packageNames) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return { name, root: packageRoot };
  }
  return undefined;
}

function groupFindings(findings: Finding[]) {
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    groups.set(finding.rule, [...(groups.get(finding.rule) ?? []), finding]);
  }
  return groups.entries();
}

function extension(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index) : '';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
