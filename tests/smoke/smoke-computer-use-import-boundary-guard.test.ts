import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computerUseBoundaryManifestIssues,
  computerUseImportBoundaryViolation,
  loadComputerUseBoundaryPolicy,
  type ImportEdge,
} from '../../tools/check-module-boundaries.js';

const packageNames = new Map([
  ['@sciforge-ui/browser-workbench', 'packages/presentation/components/browser-workbench'],
  ['@sciforge-ui/components', 'packages/presentation/components'],
  ['@sciforge-ui/runtime-contract', 'packages/contracts/runtime'],
]);

test('Computer Use boundary guard blocks GUI imports of action provider, observe provider, and runtime bridge', () => {
  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUsePanel.tsx',
      specifier: '../../../packages/actions/computer-use/runtime-policy.js',
      resolvedPath: 'packages/actions/computer-use/runtime-policy.js',
    })?.rule,
    'cu-gui-import-action-provider',
  );

  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUsePanel.tsx',
      specifier: '../../../packages/observe/vision/computer-use-runtime-policy.js',
      resolvedPath: 'packages/observe/vision/computer-use-runtime-policy.js',
    })?.rule,
    'cu-gui-import-observe-provider',
  );

  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUsePanel.tsx',
      specifier: '../../../src/runtime/computer-use/package-bridge.js',
      resolvedPath: 'src/runtime/computer-use/package-bridge.js',
    })?.rule,
    'cu-gui-import-runtime-bridge',
  );

  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUsePanel.tsx',
      specifier: '@sciforge-actions/computer-use',
    })?.rule,
    'cu-gui-import-action-provider',
  );

  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUsePanel.tsx',
      specifier: '@sciforge-observe/vision',
    })?.rule,
    'cu-gui-import-observe-provider',
  );
});

test('Computer Use boundary guard allows GUI shared contracts and GUI presentation packages', () => {
  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUseReplay.tsx',
      specifier: '@sciforge-ui/runtime-contract',
    }),
    undefined,
  );

  assert.equal(
    violation({
      importer: 'src/ui/src/app/ComputerUseReplay.tsx',
      specifier: '@sciforge-ui/components',
    }),
    undefined,
  );
});

test('Computer Use L0 owners cannot import GUI presentation or private UI implementation', () => {
  assert.equal(
    violation({
      importer: 'packages/actions/computer-use/provider-policy.ts',
      specifier: '../../../src/ui/src/feedback/AnnotationSidebar.tsx',
      resolvedPath: 'src/ui/src/feedback/AnnotationSidebar.tsx',
    })?.rule,
    'cu-l0-import-gui-presentation',
  );

  assert.equal(
    violation({
      importer: 'packages/observe/vision/computer-use-runtime-policy.ts',
      specifier: '@sciforge-ui/browser-workbench',
    })?.rule,
    'cu-l0-import-gui-presentation',
  );

  assert.equal(
    violation({
      importer: 'src/runtime/computer-use/package-bridge.ts',
      specifier: '../../ui/src/app/ResultsRenderer.tsx',
      resolvedPath: 'src/ui/src/app/ResultsRenderer.tsx',
    })?.rule,
    'cu-l0-import-gui-presentation',
  );
});

test('Computer Use ownership manifest carries import boundary and adapter classifications', async () => {
  const policy = await loadComputerUseBoundaryPolicy();
  assert.deepEqual(computerUseBoundaryManifestIssues(policy), []);
  assert.equal(policy.adapterClassifications.has('diagnostic-shim'), true);
  assert.equal(policy.adapterClassifications.has('backend-packaging-not-concurrency-model'), true);
  assert.equal(policy.remainingMigrationSubtaskIds.has('CU-PKG-20-import-boundary-guard'), true);

  const missingDiagnosticShim = {
    ...policy,
    adapterClassifications: new Set([...policy.adapterClassifications].filter((item) => item !== 'diagnostic-shim')),
  };
  assert.ok(
    computerUseBoundaryManifestIssues(missingDiagnosticShim).some((issue) => issue.includes('diagnostic-shim')),
    'manifest validation should fail closed when a Computer Use boundary classification disappears',
  );

  const guiExecutionAllowed = {
    ...policy,
    actionProviderPublicSurface: {
      ...policy.actionProviderPublicSurface,
      nativeProductGatePolicy: {
        ...policy.actionProviderPublicSurface.nativeProductGatePolicy,
        guiExecutionAllowed: true,
      },
    },
  };
  assert.ok(
    computerUseBoundaryManifestIssues(guiExecutionAllowed).some((issue) => issue.includes('native product gate policy')),
    'manifest validation should fail closed if GUI execution is allowed for Computer Use',
  );

  const missingNativeSidecarProtocolRefs = {
    ...policy,
    actionProviderPublicSurface: {
      ...policy.actionProviderPublicSurface,
      nativeMultiScreenSidecarProtocol: {
        ...policy.actionProviderPublicSurface.nativeMultiScreenSidecarProtocol,
        completedRunRequiredRefs: new Set([...policy.actionProviderPublicSurface.nativeMultiScreenSidecarProtocol.completedRunRequiredRefs].filter((item) => item !== 'sidecarDiscoveryRef')),
        completedRunRequiredCapabilities: new Set([...policy.actionProviderPublicSurface.nativeMultiScreenSidecarProtocol.completedRunRequiredCapabilities].filter((item) => item !== 'refs-first-evidence')),
      },
    },
  };
  const nativeProtocolIssues = computerUseBoundaryManifestIssues(missingNativeSidecarProtocolRefs);
  assert.ok(
    nativeProtocolIssues.some((issue) => issue.includes('sidecarDiscoveryRef')),
    'manifest validation should fail closed when the native sidecar discovery ref requirement disappears',
  );
  assert.ok(
    nativeProtocolIssues.some((issue) => issue.includes('refs-first-evidence')),
    'manifest validation should fail closed when the native sidecar refs-first capability disappears',
  );

  const missingWindowProvenance = {
    ...policy,
    actionProviderPublicSurface: {
      ...policy.actionProviderPublicSurface,
      nativeProductGatePolicy: {
        ...policy.actionProviderPublicSurface.nativeProductGatePolicy,
        requiredProvenance: new Set([...policy.actionProviderPublicSurface.nativeProductGatePolicy.requiredProvenance].filter((item) => item !== 'windowActionSessionRef')),
      },
    },
  };
  assert.ok(
    computerUseBoundaryManifestIssues(missingWindowProvenance).some((issue) => issue.includes('windowActionSessionRef')),
    'manifest validation should fail closed when window-scoped provenance disappears from the native product gate',
  );

  const missingDomAxRef = {
    ...policy,
    actionProviderPublicSurface: {
      ...policy.actionProviderPublicSurface,
      browserRuntimeAllowedRefs: new Set([...policy.actionProviderPublicSurface.browserRuntimeAllowedRefs].filter((item) => item !== 'browserRuntimePlaywrightEvaluateRef')),
    },
  };
  assert.ok(
    computerUseBoundaryManifestIssues(missingDomAxRef).some((issue) => issue.includes('browserRuntimePlaywrightEvaluateRef')),
    'manifest validation should fail closed when BrowserRuntime DOM/AX hint refs disappear',
  );

});

function violation(edge: Omit<ImportEdge, 'line'>) {
  return computerUseImportBoundaryViolation({ line: 1, ...edge }, packageNames);
}
