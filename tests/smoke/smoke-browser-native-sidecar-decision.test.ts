import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES,
} from '../../src/desktop/browser-native-adapter-comparison.js';
import {
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA,
  DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
  NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS,
  type BrowserNativeAdapterPlatformBenchmarkResult,
} from '../../tools/browser-native-adapter-platform-benchmark-runner.js';
import {
  BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA,
  buildBrowserNativeSidecarDecisionEvidence,
  runBrowserNativeSidecarDecision,
  validateBrowserNativeSidecarDecisionEvidence,
} from '../../src/desktop/browser-native-sidecar-decision.js';

const execFileAsync = promisify(execFile);

test('browser native sidecar decision is blocked and refs-first without required real adapter commands', async () => {
  const platformBenchmark = blockedPlatformBenchmarkFixture();
  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:00.000Z',
  });

  assert.equal(decision.schemaVersion, BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA);
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.decisionGate.status, 'blocked');
  assert.equal(decision.selectedAdapterId, null);
  assert.equal(decision.benchmarkClaim, false);
  assert.equal(
    decision.decisionGate.unblocksWhen,
    'supported-candidates-have-real-bounded-results-and-unsupported-candidates-have-typed-unsupported-results',
  );
  assert.equal(decision.sidecarDecision.requiresPlatformSpecificNativeSidecar, null);
  assert.equal(decision.sidecarDecision.claimsDecision, false);
  assert.equal(decision.owner, 'BrowserHostSession');
  assert.equal(decision.liveSurfaceTransport, 'native-embedded');
  assert.equal(decision.singleInteractiveTruth, true);
  assert.equal(decision.secondTruthSource, false);
  const decisionRequirements = (decision as unknown as {
    decisionRequirements?: Record<string, {
      status: 'passed' | 'blocked';
      required: true;
      evidenceRefs: string[];
      blockerRefs: string[];
    }>;
  }).decisionRequirements;
  assert.ok(decisionRequirements, 'sidecar decision must record the required decision dimensions');
  assert.deepEqual(Object.keys(decisionRequirements), [
    'sameSessionOwnership',
    'refsCollection',
    'inputRouting',
    'securityIsolation',
    'lifecycle',
    'packagingRisk',
  ]);
  for (const [requirementId, requirement] of Object.entries(decisionRequirements)) {
    assert.equal(requirement.required, true, `${requirementId} must be a required gate`);
    assert.ok(['passed', 'blocked'].includes(requirement.status), `${requirementId} must expose a bounded status`);
    assert.ok(requirement.evidenceRefs.length > 0, `${requirementId} must cite bounded evidence refs`);
    for (const ref of [...requirement.evidenceRefs, ...requirement.blockerRefs]) {
      assert.doesNotMatch(ref, /https?:\/\//i, `${requirementId} refs must not contain raw URLs`);
      assert.ok(ref.length <= 240, `${requirementId} refs must remain bounded`);
    }
  }
  assert.ok(decision.requiredCommands.some((command) => (
    command.candidateId === 'wkwebview'
    && command.commandEnv === 'SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_COMMAND'
    && command.status === 'missing'
  )));
  assert.ok(decision.requiredCommands.some((command) => (
    command.candidateId === 'webview2'
    && command.status === 'unsupported-on-current-platform'
  )));
  assert.ok(decision.requiredCommands.some((command) => (
    command.candidateId === 'standalone-chromium-surface'
    && command.commandEnv === 'SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND'
    && command.status === 'missing'
  )));
  assert.ok(decision.referenceRefs.includes('PROJECT_browser.md:M3 platform Benchmark and Adapter decision'));
  assert.ok(decision.referenceRefs.includes(DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF));
  assert.deepEqual(
    decision.payloadPolicy.forbiddenInlineEvidenceKinds,
    ['raw-url', 'raw-dom', 'base64-image', 'screenshot-bytes', 'provider-payload', 'full-console-log', 'full-network-log', 'secret'],
  );
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);
  assertSidecarDecisionArtifactIsBounded(JSON.stringify(decision));
});

test('browser native sidecar decision stays blocked when a current-platform candidate is incomplete despite typed unsupported WebView2', () => {
  const platformBenchmark = claimedPassWithUnsupportedWebView2AndIncompleteStandaloneFixture();
  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:05.000Z',
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.decisionGate.status, 'blocked');
  assert.equal(decision.benchmarkClaim, false);
  assert.equal(decision.selectedAdapterId, null);
  assert.equal(decision.sidecarDecision.requiresPlatformSpecificNativeSidecar, null);
  assert.equal(decision.sidecarDecision.claimsDecision, false);
  assert.ok(decision.requiredCommands.some((command) => (
    command.candidateId === 'webview2'
    && command.status === 'unsupported-on-current-platform'
    && command.blockerRefs.includes(`platform:windows:unsupported-on-${process.platform}`)
  )));
  const webview2Command = decision.requiredCommands.find((command) => command.candidateId === 'webview2');
  assert.ok(webview2Command, 'WebView2 command evidence should be recorded');
  assert.ok(
    webview2Command.blockerRefs.every((ref) => !ref.includes('missing-real-adapter-command')),
    'typed unsupported WebView2 command evidence should not also report a missing real adapter command on Darwin',
  );
  const requirementBlockerRefs = Object.values(decision.decisionRequirements)
    .flatMap((requirement) => requirement.blockerRefs);
  assert.ok(
    requirementBlockerRefs.includes(`platform:windows:unsupported-on-${process.platform}`),
    'typed unsupported WebView2 should remain visible as a current-platform fact',
  );
  assert.ok(
    requirementBlockerRefs.every((ref) => !/^benchmark-result:webview2:missing-/.test(ref)),
    'typed unsupported WebView2 must not be reported as missing real adapter metrics on Darwin',
  );
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);
  assertSidecarDecisionArtifactIsBounded(JSON.stringify(decision));
});

test('browser native sidecar decision is ready when current-platform candidates are real and WebView2 is typed unsupported', () => {
  const platformBenchmark = claimedPassWithUnsupportedWebView2Fixture();
  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:05.500Z',
  });

  assert.equal(decision.status, 'ready-for-human-decision');
  assert.equal(decision.decisionGate.status, 'ready-for-human-decision');
  assert.equal(decision.benchmarkClaim, false);
  assert.equal(decision.selectedAdapterId, null);
  assert.equal(decision.sidecarDecision.requiresPlatformSpecificNativeSidecar, null);
  assert.equal(decision.sidecarDecision.claimsDecision, false);
  const webview2Command = decision.requiredCommands.find((command) => command.candidateId === 'webview2');
  assert.ok(webview2Command, 'WebView2 command evidence should be recorded');
  assert.equal(webview2Command.status, 'unsupported-on-current-platform');
  assert.ok(webview2Command.blockerRefs.includes(`platform:windows:unsupported-on-${process.platform}`));
  assert.ok(Object.values(decision.decisionRequirements).every((requirement) => requirement.status === 'passed'));
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);
  assertSidecarDecisionArtifactIsBounded(JSON.stringify(decision));
});

test('browser native sidecar decision stays blocked when nested real command proof refs are missing', () => {
  const platformBenchmark = claimedPassWithUnsupportedWebView2Fixture();
  for (const candidateId of ['wkwebview', 'standalone-chromium-surface'] as const) {
    const candidate = platformBenchmark.candidates.find((item) => item.id === candidateId);
    assert.ok(candidate, `${candidateId} candidate fixture should be present`);
    delete (candidate.adapterProofRefs as { nestedAdapterCommandProofRefs?: string[] }).nestedAdapterCommandProofRefs;
  }

  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:05.750Z',
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.decisionGate.status, 'blocked');
  const blockerRefs = Object.values(decision.decisionRequirements)
    .flatMap((requirement) => requirement.blockerRefs);
  assert.ok(blockerRefs.includes('benchmark-result:wkwebview:missing-nested-real-adapter-command-provenance'));
  assert.ok(blockerRefs.includes('benchmark-result:standalone-chromium-surface:missing-nested-real-adapter-command-provenance'));
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);
  assertSidecarDecisionArtifactIsBounded(JSON.stringify(decision));
});

test('browser native sidecar decision runner writes bounded blocked evidence from benchmark refs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-sidecar-decision-'));
  const inputPath = join(tempDir, 'platform-benchmark-results.json');
  const outputPath = join(tempDir, 'sidecar-decision.json');
  await writeFile(inputPath, `${JSON.stringify(blockedPlatformBenchmarkFixture(), null, 2)}\n`, 'utf8');

  const decision = await runBrowserNativeSidecarDecision({
    inputPath,
    outputPath,
    now: '2026-06-02T00:00:01.000Z',
  });
  assert.equal(decision.status, 'blocked');
  assert.equal(decision.benchmarkClaim, false);
  assert.equal(decision.selectedAdapterId, null);
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);

  const persisted = await readFile(outputPath, 'utf8');
  assertSidecarDecisionArtifactIsBounded(persisted);
  const parsed = JSON.parse(persisted) as typeof decision;
  assert.equal(parsed.schemaVersion, BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA);
  assert.equal(parsed.decisionGate.selectedAdapterId, null);
  assert.equal(parsed.sidecarDecision.claimsDecision, false);
});

test('browser native sidecar decision stays blocked when claimed benchmark pass lacks full real metric evidence', () => {
  const platformBenchmark = claimedPassWithIncompleteElectronMetricsFixture();
  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:03.000Z',
  });

  assert.equal(decision.status, 'blocked');
  assert.equal(decision.decisionGate.status, 'blocked');
  assert.equal(decision.benchmarkClaim, false);
  assert.equal(decision.selectedAdapterId, null);
  assert.equal(decision.sidecarDecision.requiresPlatformSpecificNativeSidecar, null);
  assert.equal(decision.sidecarDecision.claimsDecision, false);
  assert.ok(decision.requiredCommands.some((command) => (
    command.candidateId === 'electron-web-contents-view'
    && command.status === 'blocked-or-invalid'
    && command.blockerRefs.includes('benchmark-result:electron-web-contents-view:missing-required-metric-section-results')
  )));
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);
  assertSidecarDecisionArtifactIsBounded(JSON.stringify(decision));
});

test('browser native sidecar decision preserves helper-present real-adapter-missing provenance', () => {
  const platformBenchmark = blockedPlatformBenchmarkFixture();
  for (const candidateId of ['wkwebview', 'standalone-chromium-surface'] as const) {
    const candidate = platformBenchmark.candidates.find((item) => item.id === candidateId);
    assert.ok(candidate, `${candidateId} candidate fixture should be present`);
    candidate.blockerRefs = [
      `benchmark-result:${candidateId}:missing-real-native-adapter-result`,
      `benchmark-result:${candidateId}:missing-required-metric-section-results`,
    ];
    candidate.diagnosticRefs = [
      `${candidateId}:typed-blocked-native-display-input-adapter-missing`,
      'browser-native-adapter-platform-benchmark:typed-blocked-external-result',
    ];
    Object.assign(candidate, {
      adapterAvailability: {
        helperCommandPresent: true,
        realAdapterCommandPresent: false,
        availabilityStatus: candidateId === 'wkwebview' && process.platform !== 'darwin'
          ? 'unsupported-on-current-platform'
          : 'missing-real-adapter-command',
        provenanceRefs: [
          `env:${commandEnvName(candidateId)}:helper-command-present`,
          `env:${commandEnvName(candidateId).replace(/_COMMAND$/, '_REAL_COMMAND')}:missing-real-adapter-command`,
        ],
      },
    });
  }

  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:06.000Z',
  });

  const standaloneCommand = decision.requiredCommands.find((command) => command.candidateId === 'standalone-chromium-surface');
  assert.ok(standaloneCommand, 'standalone command decision evidence should be present');
  assert.equal(standaloneCommand.status, 'missing');
  assert.deepEqual(requiredCommandAvailability(standaloneCommand), {
    helperCommandPresent: true,
    realAdapterCommandPresent: false,
    availabilityStatus: 'missing-real-adapter-command',
  });
  assert.ok(requiredCommandDiagnostics(standaloneCommand).includes(
    'standalone-chromium-surface:typed-blocked-native-display-input-adapter-missing',
  ));
  assert.ok(requiredCommandDiagnostics(standaloneCommand).every((ref) => ref !== 'blocked-or-invalid'));

  const wkCommand = decision.requiredCommands.find((command) => command.candidateId === 'wkwebview');
  assert.ok(wkCommand, 'WKWebView command decision evidence should be present');
  assert.equal(wkCommand.status, process.platform === 'darwin' ? 'missing' : 'unsupported-on-current-platform');
  assert.deepEqual(requiredCommandAvailability(wkCommand), {
    helperCommandPresent: true,
    realAdapterCommandPresent: false,
    availabilityStatus: process.platform === 'darwin' ? 'missing-real-adapter-command' : 'unsupported-on-current-platform',
  });
  assert.ok(requiredCommandDiagnostics(wkCommand).includes(
    'wkwebview:typed-blocked-native-display-input-adapter-missing',
  ));
  assert.deepEqual(validateBrowserNativeSidecarDecisionEvidence(decision), []);
  assertSidecarDecisionArtifactIsBounded(JSON.stringify(decision));
});

test('browser native sidecar decision validation rejects ready status with incomplete required metric results', () => {
  const platformBenchmark = claimedPassWithIncompleteElectronMetricsFixture();
  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: '2026-06-02T00:00:04.000Z',
  });

  const invalidReadyDecision = {
    ...decision,
    status: 'ready-for-human-decision' as const,
    sidecarDecision: {
      ...decision.sidecarDecision,
      status: 'ready-for-human-decision' as const,
    },
    decisionGate: {
      ...decision.decisionGate,
      status: 'ready-for-human-decision' as const,
    },
  };

  const issues = validateBrowserNativeSidecarDecisionEvidence(invalidReadyDecision);
  assert.ok(
    issues.some((issue) => issue.path === 'status' && /required command evidence/i.test(issue.message)),
    'ready sidecar decision must be rejected when required metric results are incomplete',
  );
});

test('browser native sidecar decision package script writes bounded blocked evidence from benchmark refs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-sidecar-decision-script-'));
  const inputPath = join(tempDir, 'platform-benchmark-results.json');
  const outputPath = join(tempDir, 'sidecar-decision.json');
  await writeFile(inputPath, `${JSON.stringify(blockedPlatformBenchmarkFixture(), null, 2)}\n`, 'utf8');

  await execFileAsync('npm', [
    'run',
    'browser-native-sidecar-decision:runner',
    '--silent',
    '--',
    '--input',
    inputPath,
    '--output',
    outputPath,
    '--now',
    '2026-06-02T00:00:02.000Z',
  ], { cwd: process.cwd() });

  const persisted = await readFile(outputPath, 'utf8');
  assertSidecarDecisionArtifactIsBounded(persisted);
  const parsed = JSON.parse(persisted) as ReturnType<typeof buildBrowserNativeSidecarDecisionEvidence>;
  assert.equal(parsed.schemaVersion, BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA);
  assert.equal(parsed.status, 'blocked');
  assert.equal(parsed.benchmarkClaim, false);
  assert.equal(parsed.selectedAdapterId, null);
  assert.equal(parsed.decisionGate.selectedAdapterId, null);
  assert.equal(parsed.sidecarDecision.requiresPlatformSpecificNativeSidecar, null);
  assert.equal(parsed.sidecarDecision.claimsDecision, false);
});

function blockedPlatformBenchmarkFixture(): BrowserNativeAdapterPlatformBenchmarkResult {
  return {
    schemaVersion: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA,
    manifestRef: 'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-manifest.json',
    resultRef: DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
    observedAt: '2026-06-02T00:00:00.000Z',
    status: 'blocked',
    benchmarkClaim: false,
    owner: 'BrowserHostSession',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    runner: {
      runnerId: 'browser-native-adapter-platform-benchmark-runner',
      status: 'blocked',
      optInEnvVar: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK',
      optIn: true,
      adapterCommandEnvSuffix: '_COMMAND',
      adapterArgsEnvSuffix: '_ARGS_JSON',
      defaultTimeoutMs: 120_000,
    },
    externalAdapterCommandContract: {
      stdoutSchemaVersion: 'sciforge.browser-native-adapter-platform-benchmark-external-result.v1',
      stdoutMaxBytes: 96_000,
      requiredStdoutFields: [
        'schemaVersion',
        'candidateId',
        'platform',
        'owner',
        'liveSurfaceTransport',
        'singleInteractiveTruth',
        'secondTruthSource',
        'status',
        'benchmarkClaim',
        'metricSections',
      ],
      passRequiresAdapterRunProof: {
        resultKind: 'real-native-adapter-run',
        realAdapterResult: true,
        liveSurfaceTransport: 'native-embedded',
        singleInteractiveTruth: true,
        secondTruthSource: false,
        requiredRefs: [
          'browser-host-session:<id>',
          'browser-host-session:<id>/live-surface',
          'benchmark-result:<candidate>:native-adapter-surface',
          'benchmark-result:<candidate>:action-trace',
          'benchmark-result:<candidate>:platform-summary',
        ],
        forbiddenResultKinds: ['schema-validation-only'],
        forbiddenPassEvidenceTokens: [...REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES],
      },
      passRequiresNestedAdapterCommandProofRefs: {
        candidates: ['wkwebview', 'standalone-chromium-surface'],
        proofKinds: [...NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS],
        boundedRefsOnly: true,
        missingStatus: 'failed',
      },
      realProofRefusalPolicy: {
        currentProcessPlatform: process.platform,
        unsupportedPlatformStatus: 'blocked',
        missingCommandStatus: 'blocked',
        schemaFixtureStatus: 'blocked',
        failedCommandStatus: 'failed',
        partialPlatformResultsDoNotPass: true,
        passRequiresEveryCandidateRealResult: true,
      },
      injectedEnv: [
        'SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE',
        'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM',
        'SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA',
        'SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON',
      ],
      perCandidateCommandEnv: Object.fromEntries(REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.map((candidateId) => [candidateId, {
        platform: candidateId === 'webview2' ? 'windows' : candidateId === 'wkwebview' ? 'macos' : 'cross-platform',
        commandEnv: commandEnvName(candidateId),
        argsJsonEnv: argsEnvName(candidateId),
        supportedOnCurrentPlatform: candidateId !== 'webview2',
      }])) as BrowserNativeAdapterPlatformBenchmarkResult['externalAdapterCommandContract']['perCandidateCommandEnv'],
      trustedPassGradeHelpers: trustedPassGradeHelpersFixture(),
    },
    payloadPolicy: {
      refsFirst: true,
      maxInlineEvidenceBytes: 0,
      forbiddenInlineEvidenceKinds: [
        'raw-dom',
        'base64-image',
        'screenshot-bytes',
        'provider-payload',
        'full-console-log',
        'full-network-log',
      ],
    },
    candidates: REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.map((candidateId) => ({
      id: candidateId,
      platform: candidateId === 'webview2' ? 'windows' : candidateId === 'wkwebview' ? 'macos' : 'cross-platform',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
      status: candidateId === 'electron-web-contents-view' ? 'passed' : 'blocked',
      benchmarkClaim: candidateId === 'electron-web-contents-view',
      realAdapterResult: candidateId === 'electron-web-contents-view',
      supportedOnCurrentPlatform: candidateId !== 'webview2',
      adapterCommandRef: `env:${commandEnvName(candidateId)}`,
      adapterRunRef: candidateId === 'electron-web-contents-view'
        ? 'benchmark-result:electron-web-contents-view:platform-summary:bounded'
        : `benchmark-result:${candidateId}:blocked`,
      adapterProofRefs: {
        proofMode: candidateId === 'electron-web-contents-view' ? 'real-native-adapter-run' : 'blocked-or-invalid',
        browserHostSessionRef: candidateId === 'electron-web-contents-view' ? 'browser-host-session:electron' : null,
        liveSurfaceRef: candidateId === 'electron-web-contents-view' ? 'browser-host-session:electron/live-surface' : null,
        nativeAdapterSurfaceRef: candidateId === 'electron-web-contents-view' ? 'benchmark-result:electron-web-contents-view:native-adapter-surface:bounded' : null,
        actionTraceRef: candidateId === 'electron-web-contents-view' ? 'benchmark-result:electron-web-contents-view:action-trace:bounded' : null,
        platformResultRef: candidateId === 'electron-web-contents-view' ? 'benchmark-result:electron-web-contents-view:platform-summary:bounded' : null,
      },
      metricSections: [],
      blockerRefs: candidateId === 'electron-web-contents-view' ? [] : [
        candidateId === 'webview2'
          ? `platform:windows:unsupported-on-${process.platform}`
          : `env:${commandEnvName(candidateId)}:missing-real-adapter-command`,
      ],
      diagnosticRefs: candidateId === 'electron-web-contents-view'
        ? ['benchmark-result:electron-web-contents-view:bounded-summary']
        : ['browser-native-adapter-platform-benchmark:blocked-no-real-native-adapter-result'],
    })),
    decisionGate: {
      status: 'blocked',
      selectedAdapterId: null,
      unblocksWhen: 'all-required-candidates-have-real-bounded-results',
    },
  };
}

function trustedPassGradeHelpersFixture(): BrowserNativeAdapterPlatformBenchmarkResult['externalAdapterCommandContract']['trustedPassGradeHelpers'] {
  return {
    'electron-web-contents-view': {
      helperRef: 'tools/browser-native-adapter-electron-web-contents-view-external-result.ts',
      helperBasename: 'browser-native-adapter-electron-web-contents-view-external-result.ts',
      requiredOptInEnv: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_RUN_LIVE_SMOKE',
      forbiddenEnv: ['SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_LIVE_EVIDENCE_PATH'],
      actualEntrypointForms: [
        'tsx <helper>',
        'node --import tsx <helper>',
        'node --import=tsx <helper>',
      ],
      passGradeStatus: 'active',
    },
    wkwebview: {
      helperRef: 'tools/browser-native-adapter-wkwebview-external-result.ts',
      helperBasename: 'browser-native-adapter-wkwebview-external-result.ts',
      requiredOptInEnv: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_RUN_LIVE_SMOKE',
      forbiddenEnv: [],
      actualEntrypointForms: [
        'tsx <helper>',
        'node --import tsx <helper>',
        'node --import=tsx <helper>',
      ],
      passGradeStatus: 'contract-defined-fail-closed',
    },
    'standalone-chromium-surface': {
      helperRef: 'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts',
      helperBasename: 'browser-native-adapter-standalone-chromium-surface-external-result.ts',
      requiredOptInEnv: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE',
      forbiddenEnv: [],
      actualEntrypointForms: [
        'tsx <helper>',
        'node --import tsx <helper>',
        'node --import=tsx <helper>',
      ],
      passGradeStatus: 'contract-defined-fail-closed',
    },
  };
}

function claimedPassWithIncompleteElectronMetricsFixture(): BrowserNativeAdapterPlatformBenchmarkResult {
  const fixture = blockedPlatformBenchmarkFixture();
  fixture.status = 'passed';
  fixture.benchmarkClaim = true;
  fixture.runner.status = 'passed';
  fixture.decisionGate.status = 'ready-for-human-decision';
  fixture.candidates = fixture.candidates.map((candidate) => {
    if (candidate.id !== 'electron-web-contents-view') {
      return {
        ...candidate,
        status: 'passed',
        benchmarkClaim: true,
        realAdapterResult: true,
        supportedOnCurrentPlatform: true,
        adapterRunRef: `benchmark-result:${candidate.id}:platform-summary:realrun`,
        adapterProofRefs: {
          proofMode: 'real-native-adapter-run',
          browserHostSessionRef: `browser-host-session:${candidate.id}`,
          liveSurfaceRef: `browser-host-session:${candidate.id}/live-surface`,
          nativeAdapterSurfaceRef: `benchmark-result:${candidate.id}:native-adapter-surface:realrun`,
          actionTraceRef: `benchmark-result:${candidate.id}:action-trace:realrun`,
          platformResultRef: `benchmark-result:${candidate.id}:platform-summary:realrun`,
          nestedAdapterCommandProofRefs: nestedAdapterCommandProofRefs(candidate.id),
        },
        metricSections: fullMetricSections(candidate.id),
        blockerRefs: [],
        diagnosticRefs: [`benchmark-result:${candidate.id}:bounded-summary`],
      };
    }
    return {
      ...candidate,
      status: 'passed',
      benchmarkClaim: true,
      realAdapterResult: true,
      supportedOnCurrentPlatform: true,
      adapterRunRef: 'benchmark-result:electron-web-contents-view:platform-summary:realrun',
      adapterProofRefs: {
        proofMode: 'real-native-adapter-run',
        browserHostSessionRef: 'browser-host-session:electron',
        liveSurfaceRef: 'browser-host-session:electron/live-surface',
        nativeAdapterSurfaceRef: 'benchmark-result:electron-web-contents-view:native-adapter-surface:realrun',
        actionTraceRef: 'benchmark-result:electron-web-contents-view:action-trace:realrun',
        platformResultRef: 'benchmark-result:electron-web-contents-view:platform-summary:realrun',
      },
      metricSections: fullMetricSections(candidate.id).filter((section) => section.section !== 'reconnect'),
      blockerRefs: ['benchmark-result:electron-web-contents-view:missing-required-metric-section-results'],
      diagnosticRefs: ['benchmark-result:electron-web-contents-view:bounded-summary'],
    };
  });
  return fixture;
}

function claimedPassWithUnsupportedWebView2Fixture(): BrowserNativeAdapterPlatformBenchmarkResult {
  const fixture = blockedPlatformBenchmarkFixture();
  fixture.status = 'passed';
  fixture.benchmarkClaim = true;
  fixture.runner.status = 'passed';
  fixture.decisionGate.status = 'ready-for-human-decision';
  fixture.candidates = fixture.candidates.map((candidate) => {
    if (candidate.id === 'webview2') {
      return {
        ...candidate,
        status: 'blocked',
        benchmarkClaim: false,
        realAdapterResult: false,
        supportedOnCurrentPlatform: false,
        adapterRunRef: 'benchmark-result:webview2:typed-unsupported',
        adapterProofRefs: {
          proofMode: 'blocked-or-invalid',
          browserHostSessionRef: null,
          liveSurfaceRef: null,
          nativeAdapterSurfaceRef: null,
          actionTraceRef: null,
          platformResultRef: null,
        },
        metricSections: [],
        blockerRefs: [`platform:windows:unsupported-on-${process.platform}`],
        diagnosticRefs: ['browser-native-adapter-platform-benchmark:typed-unsupported'],
      };
    }
    return {
      ...candidate,
      status: 'passed',
      benchmarkClaim: true,
      realAdapterResult: true,
      supportedOnCurrentPlatform: true,
      adapterRunRef: `benchmark-result:${candidate.id}:platform-summary:realrun`,
      adapterProofRefs: {
        proofMode: 'real-native-adapter-run',
        browserHostSessionRef: `browser-host-session:${candidate.id}`,
        liveSurfaceRef: `browser-host-session:${candidate.id}/live-surface`,
        nativeAdapterSurfaceRef: `benchmark-result:${candidate.id}:native-adapter-surface:realrun`,
        actionTraceRef: `benchmark-result:${candidate.id}:action-trace:realrun`,
        platformResultRef: `benchmark-result:${candidate.id}:platform-summary:realrun`,
        nestedAdapterCommandProofRefs: nestedAdapterCommandProofRefs(candidate.id),
      },
      metricSections: fullMetricSections(candidate.id),
      blockerRefs: [],
      diagnosticRefs: [`benchmark-result:${candidate.id}:bounded-summary`],
    };
  });
  return fixture;
}

function claimedPassWithUnsupportedWebView2AndIncompleteStandaloneFixture(): BrowserNativeAdapterPlatformBenchmarkResult {
  const fixture = claimedPassWithUnsupportedWebView2Fixture();
  fixture.candidates = fixture.candidates.map((candidate) => candidate.id === 'standalone-chromium-surface'
    ? {
        ...candidate,
        metricSections: candidate.metricSections.filter((section) => section.section !== 'streamQuality'),
        blockerRefs: ['benchmark-result:standalone-chromium-surface:missing-streamQuality-metric-result'],
      }
    : candidate);
  return fixture;
}

function fullMetricSections(
  candidateId: string,
): BrowserNativeAdapterPlatformBenchmarkResult['candidates'][number]['metricSections'] {
  type MetricSection = BrowserNativeAdapterPlatformBenchmarkResult['candidates'][number]['metricSections'][number];
  const metric = (
    section: MetricSection['section'],
    numericSummary: NonNullable<MetricSection['numericSummary']>,
  ): MetricSection => ({
    section,
    status: 'passed' as const,
    evidenceMode: 'bounded-summary-ref' as const,
    inlineEvidence: 'forbidden' as const,
    resultRefs: [`benchmark-result:${candidateId}:${section}:realrun`],
    numericSummary,
  });

  return [
    metric('latency', { openAckMs: 1, navigationAckMs: 1, inputAckMs: 1, paintAckLagMs: 1, p95ActionAckMs: 1 }),
    metric('cpu', { processCpuAveragePercent: 1, processCpuP95Percent: 1, sampleCount: 1 }),
    metric('memory', { rssMb: 1, heapUsedMb: 1, nativeSurfaceMb: 1, peakRssMb: 1 }),
    metric('inputCompleteness', { keyboard: true, textEditing: true, pointerClick: true, drag: true, scroll: true, navigationControls: true }),
    metric('lifecycle', { open: true, navigationStart: true, navigationCommitted: true, interactive: true, load: true, networkQuiet: true, blocked: true, retry: true, close: true }),
    metric('reconnect', { disconnectDetected: true, sameBrowserHostSessionOwner: true, stateHeartbeatRestored: true, inputRoutedAfterReconnect: true }),
    metric('streamQuality', {
      latencyP50Ms: 1,
      latencyP95Ms: 1,
      framerateAvgFps: 60,
      framerateP5Fps: 55,
      inputToFrameP50Ms: 1,
      inputToFrameP95Ms: 1,
      reconnectP50Ms: 1,
      reconnectP95Ms: 1,
      sampleCount: 1,
      fallbackRequired: false,
    }),
  ];
}

function nestedAdapterCommandProofRefs(candidateId: string): string[] | undefined {
  if (candidateId !== 'wkwebview' && candidateId !== 'standalone-chromium-surface') {
    return undefined;
  }
  return NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS.map((kind) => (
    `benchmark-result:${candidateId}:nested-real-adapter-command:${kind}:realrun`
  ));
}

function commandEnvName(candidateId: string): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_COMMAND`;
}

function argsEnvName(candidateId: string): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_ARGS_JSON`;
}

function requiredCommandAvailability(command: unknown): {
  helperCommandPresent: boolean;
  realAdapterCommandPresent: boolean;
  availabilityStatus: string;
} | undefined {
  const availability = (command as { adapterAvailability?: {
    helperCommandPresent: boolean;
    realAdapterCommandPresent: boolean;
    availabilityStatus: string;
  } }).adapterAvailability;
  return availability && {
    helperCommandPresent: availability.helperCommandPresent,
    realAdapterCommandPresent: availability.realAdapterCommandPresent,
    availabilityStatus: availability.availabilityStatus,
  };
}

function requiredCommandDiagnostics(command: unknown): string[] {
  return (command as { diagnosticRefs?: string[] }).diagnosticRefs ?? [];
}

function assertSidecarDecisionArtifactIsBounded(text: string): void {
  assert.ok(text.length <= 96_000, 'sidecar decision evidence must remain bounded');
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /"(?:rawUrl|url|requestedUrl|currentUrl|finalUrl|rawDom|domSnapshot|screenshotBase64|screenshotBytes|providerPayload|consoleLog|networkLog|secret|token|password|credential)"\s*:/i);
  assert.doesNotMatch(text, /data:image\//i);
}
