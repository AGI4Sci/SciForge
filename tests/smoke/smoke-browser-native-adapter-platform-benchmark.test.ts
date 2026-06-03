import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES,
  buildBrowserNativeAdapterComparisonManifest,
  validateBrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterBenchmarkMetricSection,
  type BrowserNativeAdapterCandidateId,
  type BrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterMetricFieldContract,
} from '../../src/desktop/browser-native-adapter-comparison.js';
import {
  DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
  DESKTOP_BROWSER_NATIVE_M0_SURFING_LOOP_SCHEMA,
  rejectedDesktopLiveSubstitutes,
  type DesktopBrowserNativeLiveAcceptanceEvidence,
  type DesktopBrowserNativeM0Action,
} from '../../src/desktop/desktop-browser-native-live-acceptance.js';
import {
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA,
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV,
  DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
  runBrowserNativeAdapterPlatformBenchmark,
  type BrowserNativeAdapterPlatformBenchmarkCandidateResult,
  type BrowserNativeAdapterPlatformBenchmarkExternalResult,
} from '../../tools/browser-native-adapter-platform-benchmark-runner.js';
import {
  ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV,
} from '../../tools/browser-native-adapter-electron-web-contents-view-external-result.js';
import {
  buildStandaloneChromiumSurfaceExternalBenchmarkResult,
} from '../../tools/browser-native-adapter-standalone-chromium-surface-external-result.js';
import {
  buildWkwebviewExternalBenchmarkResult,
} from '../../tools/browser-native-adapter-wkwebview-external-result.js';

const PLATFORM_BENCHMARK_MANIFEST_SCHEMA = 'sciforge.browser-native-adapter-platform-benchmark-manifest.v1' as const;
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-native-adapter-comparison');
const comparisonManifestRef = 'docs/test-artifacts/browser-native-adapter-comparison/manifest.json';
const platformBenchmarkManifestRef = 'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-manifest.json';
const platformBenchmarkManifestPath = join(artifactDir, 'platform-benchmark-manifest.json');
const platformBenchmarkResultPath = join(artifactDir, 'platform-benchmark-results.json');
const DIRECT_VERIFICATION_COMMAND = 'node --import tsx --test tests/smoke/smoke-browser-native-adapter-platform-benchmark.test.ts';
const REAL_RUNNER_OPT_IN_ENV = BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV;
const REAL_RUNNER_COMMAND_REF = 'tsx tools/browser-native-adapter-platform-benchmark-runner.ts';
const MAX_PLATFORM_BENCHMARK_MANIFEST_BYTES = 96_000;
const EXTERNAL_FIXTURE_CANDIDATE: BrowserNativeAdapterCandidateId = 'electron-web-contents-view';
const STANDALONE_CHROMIUM_FIXTURE_CANDIDATE: BrowserNativeAdapterCandidateId = 'standalone-chromium-surface';
const WKWEBVIEW_FIXTURE_CANDIDATE: BrowserNativeAdapterCandidateId = 'wkwebview';

type RealPlatformBenchmarkMetricSection = BrowserNativeAdapterBenchmarkMetricSection;
type PlatformBenchmarkStatus = 'blocked' | 'not-run';
type PlatformBenchmarkRunnerStatus = 'not-run';
type PlatformBenchmarkFieldRequirement = Pick<BrowserNativeAdapterMetricFieldContract, 'field' | 'unit' | 'required' | 'source'> & {
  status: 'not-run';
  resultRef: string;
};
type PlatformBenchmarkMetricRequirement = {
  section: RealPlatformBenchmarkMetricSection;
  status: 'not-run';
  evidenceMode: 'bounded-summary-ref';
  inlineEvidence: 'forbidden';
  summaryRef: string;
  requiredFields: PlatformBenchmarkFieldRequirement[];
  bounds: {
    maxInlineEvidenceBytes: 0;
    resultValueMode: 'aggregate-summary-only';
    sampleStorage: 'bounded-summary-ref-only';
  };
};
type PlatformBenchmarkComparisonMetrics = Record<
  RealPlatformBenchmarkMetricSection,
  { fields: BrowserNativeAdapterMetricFieldContract[] }
>;
type PlatformBenchmarkCandidatePlan = {
  id: BrowserNativeAdapterCandidateId;
  candidateRef: string;
  comparisonRefs: string[];
  platform: BrowserNativeAdapterComparisonManifest['candidates'][number]['platform'];
  surfaceApi: string;
  inputApi: string;
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  status: 'blocked';
  benchmarkClaim: false;
  blockedByRefs: string[];
  runnerInputRef: string;
  metricRequirements: PlatformBenchmarkMetricRequirement[];
};
type PlatformBenchmarkManifest = {
  schemaVersion: typeof PLATFORM_BENCHMARK_MANIFEST_SCHEMA;
  manifestId: string;
  observedAt: string;
  status: 'blocked';
  statusReasonRef: string;
  benchmarkClaim: false;
  comparisonManifestRef: string;
  sourceComparisonManifestId: string;
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  refsFirst: true;
  artifactPayloadMode: 'bounded-summary-refs-only';
  payloadPolicy: {
    refsFirst: true;
    maxInlineEvidenceBytes: 0;
    allowedInlineValueKinds: Array<'ids' | 'refs' | 'booleans' | 'numeric-summaries' | 'status-flags' | 'hashes'>;
    forbiddenInlineEvidenceKinds: Array<'raw-dom' | 'base64-image' | 'screenshot-bytes' | 'provider-payload' | 'full-console-log' | 'full-network-log'>;
  };
  platformRunner: {
    runnerId: 'browser-native-adapter-platform-benchmark-runner';
    status: PlatformBenchmarkRunnerStatus;
    optInEnvVar: typeof REAL_RUNNER_OPT_IN_ENV;
    optInValue: '1';
    defaultBehavior: 'write-manifest-only';
    directSmokeCommand: typeof DIRECT_VERIFICATION_COMMAND;
    realRunnerCommandRef: typeof REAL_RUNNER_COMMAND_REF;
    inputManifestRef: typeof platformBenchmarkManifestRef;
    expectedResultArtifactRef: typeof DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF;
    requiredResultStatusValues: Array<'passed' | 'blocked' | 'failed'>;
    handoffContract: {
      inputRefs: string[];
      outputRefs: string[];
      resultPatchRules: string[];
    };
    externalAdapterCommandContract: {
      stdoutSchemaVersion: typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA;
      stdoutMaxBytes: number;
      injectedEnv: string[];
      passRequiresAdapterRunProof: {
        resultKind: 'real-native-adapter-run';
        realAdapterResult: true;
        liveSurfaceTransport: 'native-embedded';
        singleInteractiveTruth: true;
        secondTruthSource: false;
        requiredRefs: string[];
        forbiddenResultKinds: Array<'schema-validation-only'>;
        forbiddenPassEvidenceTokens: typeof REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES[number][];
      };
      passRequiresNestedAdapterCommandProofRefs: {
        candidates: Array<'wkwebview' | 'standalone-chromium-surface'>;
        proofKinds: Array<'policy' | 'entrypoint' | 'helper-chain' | 'live-smoke'>;
        boundedRefsOnly: true;
        missingStatus: 'failed';
      };
      realProofRefusalPolicy: {
        currentProcessPlatform: NodeJS.Platform;
        unsupportedPlatformStatus: 'blocked';
        missingCommandStatus: 'blocked';
        schemaFixtureStatus: 'blocked';
        failedCommandStatus: 'failed';
        partialPlatformResultsDoNotPass: true;
        passRequiresEveryCandidateRealResult: true;
      };
      adapterCommandResponsibilities: string[];
      perPlatformCommandEnvDocs: Array<{
        candidateId: BrowserNativeAdapterCandidateId;
        platform: BrowserNativeAdapterComparisonManifest['candidates'][number]['platform'];
        commandEnv: string;
        argsJsonEnv: string;
        supportedOnCurrentPlatform: boolean;
      }>;
      sampleFixture: {
        candidateId: BrowserNativeAdapterCandidateId;
        purpose: 'schema-validation-only-no-real-native-adapter-benchmark';
        expectedRunnerStatus: 'blocked';
      };
    };
  };
  requiredMetricSections: RealPlatformBenchmarkMetricSection[];
  metricFieldContract: Array<{
    section: RealPlatformBenchmarkMetricSection;
    status: 'not-run';
    evidenceMode: 'bounded-summary-ref';
    inlineEvidence: 'forbidden';
    fields: Array<Pick<BrowserNativeAdapterMetricFieldContract, 'field' | 'unit' | 'required' | 'source'>>;
  }>;
  candidateRefs: Array<{
    id: BrowserNativeAdapterCandidateId;
    candidateRef: string;
    status: PlatformBenchmarkStatus;
    comparisonRefs: string[];
  }>;
  candidates: PlatformBenchmarkCandidatePlan[];
  decisionGate: {
    status: 'blocked';
    selectedAdapterId: null;
    unblocksWhenRefs: string[];
  };
  verificationCommand: typeof DIRECT_VERIFICATION_COMMAND;
};

const REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS: RealPlatformBenchmarkMetricSection[] =
  [...REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS];

test('browser native adapter platform benchmark manifest is opt-in, refs-first, and not-run by default', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-default-benchmark-'));
  const defaultResultPath = join(tempDir, 'platform-benchmark-results.json');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-platform-benchmark-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: [
      'PROJECT_browser.md:Electron/WebView2/WKWebView benchmark gap',
      'browser-native-adapter-platform-benchmark:manifest-only',
    ],
    decision: {
      status: 'undecided',
      rationaleRefs: ['browser-native-adapter-platform-benchmark:real-runner-required'],
      followUpRefs: [REAL_RUNNER_COMMAND_REF],
    },
  });
  assert.deepEqual(validateBrowserNativeAdapterComparisonManifest(comparisonManifest), []);

  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  assertPlatformBenchmarkManifest(manifest, comparisonManifest);
  await writePlatformBenchmarkManifest(manifest);

  const defaultRunnerResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {},
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: defaultResultPath,
    now: '2026-06-02T00:00:00.000Z',
  });
  assert.equal(defaultRunnerResult.schemaVersion, BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA);
  assert.equal(defaultRunnerResult.status, 'blocked');
  assert.equal(defaultRunnerResult.benchmarkClaim, false);
  assert.equal(defaultRunnerResult.runner.status, 'not-run');
  assert.equal(defaultRunnerResult.runner.optIn, false);
  assert.equal(defaultRunnerResult.owner, 'BrowserHostSession');
  assert.equal(defaultRunnerResult.liveSurfaceTransport, 'native-embedded');
  assert.equal(defaultRunnerResult.singleInteractiveTruth, true);
  assert.equal(defaultRunnerResult.secondTruthSource, false);
  assert.ok(defaultRunnerResult.candidates.every((candidate) => candidate.status === 'blocked'));
  assert.ok(defaultRunnerResult.candidates.every((candidate) => candidate.benchmarkClaim === false));
  assert.ok(defaultRunnerResult.candidates.every((candidate) => (
    candidate.liveSurfaceTransport === 'native-embedded'
    && candidate.singleInteractiveTruth === true
    && candidate.secondTruthSource === false
  )));
  assert.ok(defaultRunnerResult.candidates.every((candidate) => (
    candidate.blockerRefs.includes(`env:${REAL_RUNNER_OPT_IN_ENV}:not-set`)
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(defaultRunnerResult));
  assert.equal(defaultRunnerResult.resultRef, defaultResultPath);

  const optInBlockedRunnerResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: { [REAL_RUNNER_OPT_IN_ENV]: '1' },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: defaultResultPath,
    now: '2026-06-02T00:00:01.000Z',
  });
  assert.equal(optInBlockedRunnerResult.status, 'blocked');
  assert.equal(optInBlockedRunnerResult.benchmarkClaim, false);
  assert.equal(optInBlockedRunnerResult.runner.status, 'blocked');
  assert.equal(optInBlockedRunnerResult.runner.optIn, true);
  assert.ok(optInBlockedRunnerResult.candidates.some((candidate) => (
    candidate.blockerRefs.some((ref) => ref.includes(':missing-real-adapter-command'))
  )));
  const optInBlockedWebView2 = optInBlockedRunnerResult.candidates.find((candidate) => candidate.id === 'webview2');
  assert.ok(optInBlockedWebView2, 'WebView2 blocked result should be present');
  if (process.platform === 'darwin') {
    assert.equal(optInBlockedWebView2.supportedOnCurrentPlatform, false);
    assert.ok(optInBlockedWebView2.blockerRefs.includes('platform:windows:unsupported-on-darwin'));
    assert.ok(
      optInBlockedWebView2.blockerRefs.every((ref) => !ref.includes('missing-real-adapter-command')),
      'typed unsupported WebView2 must not also report a missing adapter command on Darwin',
    );
  }
  assert.ok(optInBlockedRunnerResult.decisionGate.status === 'blocked');
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(optInBlockedRunnerResult));

  const persistedResultText = await readFile(defaultResultPath, 'utf8');
  assertPlatformBenchmarkArtifactIsBounded(persistedResultText);
  const persistedResult = JSON.parse(persistedResultText) as typeof optInBlockedRunnerResult;
  assert.equal(persistedResult.schemaVersion, BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA);
  assert.equal(persistedResult.status, 'blocked');
  assert.equal(persistedResult.benchmarkClaim, false);
});

test('browser native adapter blocked helpers default to every required metric section', async () => {
  const helperResults = [
    {
      candidateId: STANDALONE_CHROMIUM_FIXTURE_CANDIDATE,
      result: await buildStandaloneChromiumSurfaceExternalBenchmarkResult({}),
    },
    {
      candidateId: WKWEBVIEW_FIXTURE_CANDIDATE,
      result: await buildWkwebviewExternalBenchmarkResult({}),
    },
  ];

  for (const { candidateId, result } of helperResults) {
    assert.equal(result.status, 'blocked');
    assert.equal(result.benchmarkClaim, false);
    assert.ok(result.adapterRun);
    assert.equal(result.adapterRun.realAdapterResult, false);
    for (const section of REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS) {
      const metricSection = result.metricSections?.[section];
      assert.ok(metricSection, `${candidateId} default blocked helper should include ${section}`);
      assert.equal(metricSection.status, 'blocked');
      const resultRefs = metricSection.resultRefs ?? [];
      assert.ok(resultRefs.length > 0);
      assert.ok(resultRefs.every((ref) => (
        ref.startsWith(`benchmark-result:${candidateId}:${section}:typed-blocked-native-display-input-adapter-missing`)
      )));
    }
  }
});

test('browser native adapter platform benchmark requires trusted helper registry for pass-grade candidates', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-trusted-helper-registry-'));
  const registryResultPath = join(tempDir, 'trusted-helper-registry-results.json');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-trusted-helper-registry-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: ['browser-native-adapter-platform-benchmark:trusted-helper-registry'],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writePlatformBenchmarkManifest(manifest);

  const result = await runBrowserNativeAdapterPlatformBenchmark({
    env: { [REAL_RUNNER_OPT_IN_ENV]: '1' },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: registryResultPath,
    now: '2026-06-02T00:00:01.750Z',
  });

  const contract = result.externalAdapterCommandContract as typeof result.externalAdapterCommandContract & {
    trustedPassGradeHelpers?: Record<string, {
      helperRef: string;
      helperBasename: string;
      requiredOptInEnv: string;
      forbiddenEnv: string[];
      actualEntrypointForms: string[];
      passGradeStatus: 'active' | 'contract-defined-fail-closed';
    }>;
  };
  assert.ok(contract.trustedPassGradeHelpers, 'platform benchmark contract should publish trusted pass-grade helper registry');
  assert.deepEqual(Object.keys(contract.trustedPassGradeHelpers).sort(), [
    'electron-web-contents-view',
    'standalone-chromium-surface',
    'wkwebview',
  ]);
  assert.equal(
    contract.trustedPassGradeHelpers['electron-web-contents-view']?.helperRef,
    'tools/browser-native-adapter-electron-web-contents-view-external-result.ts',
  );
  assert.equal(
    contract.trustedPassGradeHelpers.wkwebview?.helperRef,
    'tools/browser-native-adapter-wkwebview-external-result.ts',
  );
  assert.equal(
    contract.trustedPassGradeHelpers['standalone-chromium-surface']?.helperRef,
    'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts',
  );
  assert.ok(Object.values(contract.trustedPassGradeHelpers).every((helper) => (
    helper.actualEntrypointForms.includes('tsx <helper>')
    && helper.actualEntrypointForms.includes('node --import tsx <helper>')
    && helper.actualEntrypointForms.includes('node --import=tsx <helper>')
  )));
  assert.equal(contract.trustedPassGradeHelpers.wkwebview?.passGradeStatus, 'active');
  assert.equal(contract.trustedPassGradeHelpers['standalone-chromium-surface']?.passGradeStatus, 'active');
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('WKWebView helper forwards complete live-smoke REAL_COMMAND proof refs as pass-grade external result', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-wk-helper-pass-'));
  const realCommandPath = join(tempDir, 'wk-real-adapter-command.js');
  await writeFile(realCommandPath, buildRealAdapterCommandScriptSource({
    includeNestedAdapterCommandProofRefs: true,
  }), 'utf8');

  const result = await buildWkwebviewExternalBenchmarkResult({
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_RUN_LIVE_SMOKE: '1',
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_COMMAND: process.execPath,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_ARGS_JSON: JSON.stringify([realCommandPath]),
  });

  assertCompleteExternalCandidatePass(result, WKWEBVIEW_FIXTURE_CANDIDATE);
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('WKWebView helper refuses live-smoke REAL_COMMAND pass stdout without nested adapter command proof refs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-wk-helper-nested-proof-'));
  const realCommandPath = join(tempDir, 'wk-real-adapter-command.js');
  await writeFile(realCommandPath, buildRealAdapterCommandScriptSource(), 'utf8');

  const result = await buildWkwebviewExternalBenchmarkResult({
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_RUN_LIVE_SMOKE: '1',
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_COMMAND: process.execPath,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_ARGS_JSON: JSON.stringify([realCommandPath]),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  assert.equal(result.adapterRun?.realAdapterResult, false);
  assert.ok(result.diagnosticRefs?.some((ref) => ref.includes('nested adapter command provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('WKWebView external helper refuses pass-shaped REAL_COMMAND stdout without trusted live adapter helper provenance', async () => {
  const result = await buildWkwebviewExternalBenchmarkResult({
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_COMMAND: process.execPath,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_ARGS_JSON: JSON.stringify(buildRealAdapterCommandArgs()),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  assert.equal(result.adapterRun?.realAdapterResult, false);
  assert.ok(result.diagnosticRefs?.some((ref) => ref.includes('trusted live adapter helper provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('standalone Chromium surface helper forwards complete live-smoke REAL_COMMAND proof refs as pass-grade external result', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-standalone-helper-pass-'));
  const realCommandPath = join(tempDir, 'standalone-real-adapter-command.js');
  await writeFile(realCommandPath, buildRealAdapterCommandScriptSource({
    includeNestedAdapterCommandProofRefs: true,
  }), 'utf8');

  const result = await buildStandaloneChromiumSurfaceExternalBenchmarkResult({
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE: '1',
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND: process.execPath,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON: JSON.stringify([realCommandPath]),
  });

  assertCompleteExternalCandidatePass(result, STANDALONE_CHROMIUM_FIXTURE_CANDIDATE);
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('standalone Chromium surface helper refuses live-smoke REAL_COMMAND pass stdout without nested adapter command proof refs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-standalone-helper-nested-proof-'));
  const realCommandPath = join(tempDir, 'standalone-real-adapter-command.js');
  await writeFile(realCommandPath, buildRealAdapterCommandScriptSource(), 'utf8');

  const result = await buildStandaloneChromiumSurfaceExternalBenchmarkResult({
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE: '1',
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND: process.execPath,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON: JSON.stringify([realCommandPath]),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  assert.equal(result.adapterRun?.realAdapterResult, false);
  assert.ok(result.diagnosticRefs?.some((ref) => ref.includes('nested adapter command provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('standalone Chromium surface helper refuses standalone process pass without native display-input adapter provenance', async () => {
  const result = await buildStandaloneChromiumSurfaceExternalBenchmarkResult({
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE: '1',
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND: process.execPath,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON: JSON.stringify(
      buildStandaloneProcessSecondTruthPassArgs(),
    ),
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  assert.equal(result.adapterRun?.realAdapterResult, false);
  assert.ok(result.diagnosticRefs?.some((ref) => ref.includes('trusted live adapter helper provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

test('trusted WKWebView and standalone helpers pass through only complete nested real-native-adapter-run refs', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-wk-standalone-pass-through-'));
  const passThroughManifestPath = join(tempDir, 'platform-benchmark-manifest.json');
  const standaloneResultPath = join(tempDir, 'standalone-pass-through-results.json');
  const wkResultPath = join(tempDir, 'wk-pass-through-results.json');
  const realCommandPath = join(tempDir, 'real-adapter-command.js');
  const standaloneHelperPath = resolve(
    process.cwd(),
    'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts',
  );
  const wkHelperPath = resolve(process.cwd(), 'tools/browser-native-adapter-wkwebview-external-result.ts');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-wk-standalone-pass-through-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: ['browser-native-adapter-platform-benchmark:wk-standalone-pass-through-contract'],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writeFile(passThroughManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(realCommandPath, buildRealAdapterCommandScriptSource({
    includeNestedAdapterCommandProofRefs: true,
  }), 'utf8');

  const standaloneResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_ARGS_JSON: JSON.stringify([
        '--import',
        'tsx',
        standaloneHelperPath,
      ]),
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON: JSON.stringify([realCommandPath]),
    },
    inputManifestPath: passThroughManifestPath,
    outputPath: standaloneResultPath,
    now: '2026-06-02T00:00:01.000Z',
  });

  assert.equal(standaloneResult.status, 'blocked');
  assert.equal(standaloneResult.benchmarkClaim, false);
  const standaloneCandidate = standaloneResult.candidates.find((candidate) => (
    candidate.id === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE
  ));
  assert.ok(standaloneCandidate, 'standalone pass-through candidate should be present');
  assertCompleteRunnerCandidatePass(standaloneCandidate, STANDALONE_CHROMIUM_FIXTURE_CANDIDATE);
  assert.deepEqual(candidateAvailability(standaloneCandidate), {
    helperCommandPresent: true,
    realAdapterCommandPresent: true,
    availabilityStatus: 'real-adapter-command-present',
  });
  assert.ok(standaloneResult.candidates.some((candidate) => (
    candidate.id !== STANDALONE_CHROMIUM_FIXTURE_CANDIDATE && candidate.status === 'blocked'
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(standaloneResult));

  if (process.platform === 'darwin') {
    const wkResult = await runBrowserNativeAdapterPlatformBenchmark({
      env: {
        [REAL_RUNNER_OPT_IN_ENV]: '1',
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_RUN_LIVE_SMOKE: '1',
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_COMMAND: process.execPath,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_ARGS_JSON: JSON.stringify([
          '--import',
          'tsx',
          wkHelperPath,
        ]),
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_COMMAND: process.execPath,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_ARGS_JSON: JSON.stringify([realCommandPath]),
      },
      inputManifestPath: passThroughManifestPath,
      outputPath: wkResultPath,
      now: '2026-06-02T00:00:01.500Z',
    });

    assert.equal(wkResult.status, 'blocked');
    assert.equal(wkResult.benchmarkClaim, false);
    const wkCandidate = wkResult.candidates.find((candidate) => candidate.id === WKWEBVIEW_FIXTURE_CANDIDATE);
    assert.ok(wkCandidate, 'WK pass-through candidate should be present');
    assertCompleteRunnerCandidatePass(wkCandidate, WKWEBVIEW_FIXTURE_CANDIDATE);
    assert.deepEqual(candidateAvailability(wkCandidate), {
      helperCommandPresent: true,
      realAdapterCommandPresent: true,
      availabilityStatus: 'real-adapter-command-present',
    });
    assert.ok(wkResult.candidates.some((candidate) => (
      candidate.id !== WKWEBVIEW_FIXTURE_CANDIDATE && candidate.status === 'blocked'
    )));
    assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(wkResult));
  }
});

test('browser native adapter platform benchmark runner validates sample external adapter stdout schema', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-benchmark-'));
  const fixtureOutputPath = join(tempDir, 'schema-fixture-results.json');
  const genericRealExternalOutputPath = join(tempDir, 'generic-real-external-results.json');
  const electronExternalOutputPath = join(tempDir, 'electron-external-results.json');
  const standaloneChromiumExternalOutputPath = join(tempDir, 'standalone-chromium-external-results.json');
  const standaloneChromiumRealExternalOutputPath = join(tempDir, 'standalone-chromium-real-external-results.json');
  const wkwebviewExternalOutputPath = join(tempDir, 'wkwebview-external-results.json');
  const wkwebviewRealExternalOutputPath = join(tempDir, 'wkwebview-real-external-results.json');
  const electronLiveEvidencePath = join(tempDir, 'electron-native-live-evidence.json');
  const invalidSchemaOutputPath = join(tempDir, 'invalid-schema-results.json');
  const falsePassOutputPath = join(tempDir, 'false-pass-results.json');
  const partialProofRefsFalsePassOutputPath = join(tempDir, 'partial-proof-refs-false-pass-results.json');
  const legacyPassEvidenceFalsePassOutputPath = join(tempDir, 'legacy-pass-evidence-false-pass-results.json');
  const rawFieldFalsePassOutputPath = join(tempDir, 'raw-field-false-pass-results.json');
  const rawStringFalsePassOutputPath = join(tempDir, 'raw-string-false-pass-results.json');
  const fixtureMetricRefsFalsePassOutputPath = join(tempDir, 'fixture-metric-refs-false-pass-results.json');
  const missingMetricSummaryFalsePassOutputPath = join(tempDir, 'missing-metric-summary-false-pass-results.json');
  const wrongTypeMetricSummaryFalsePassOutputPath = join(tempDir, 'wrong-type-metric-summary-false-pass-results.json');
  const platformDriftManifestPath = join(tempDir, 'platform-drift-manifest.json');
  const platformDriftResultPath = join(tempDir, 'platform-drift-results.json');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-platform-benchmark-fixture-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: [
      'PROJECT_browser.md:external-adapter-command-contract',
      'browser-native-adapter-platform-benchmark:fixture-schema-validation-only',
    ],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writePlatformBenchmarkManifest(manifest);

  const platformDriftManifest: PlatformBenchmarkManifest = JSON.parse(JSON.stringify(manifest)) as PlatformBenchmarkManifest;
  const driftedWebView2 = platformDriftManifest.candidates.find((candidate) => candidate.id === 'webview2');
  assert.ok(driftedWebView2, 'platform drift fixture should include webview2');
  driftedWebView2.platform = 'cross-platform';
  await writeFile(platformDriftManifestPath, `${JSON.stringify(platformDriftManifest, null, 2)}\n`, 'utf8');
  await assert.rejects(
    runBrowserNativeAdapterPlatformBenchmark({
      env: {
        [REAL_RUNNER_OPT_IN_ENV]: '1',
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WEBVIEW2_COMMAND: process.execPath,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WEBVIEW2_ARGS_JSON: JSON.stringify(buildExternalAdapterFixtureArgs()),
      },
      inputManifestPath: platformDriftManifestPath,
      outputPath: platformDriftResultPath,
      now: '2026-06-02T00:00:01.500Z',
    }),
    /candidate webview2 must keep canonical platform windows/,
  );

  const fixtureResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildExternalAdapterFixtureArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: fixtureOutputPath,
    now: '2026-06-02T00:00:02.000Z',
  });

  assert.equal(fixtureResult.status, 'blocked');
  assert.equal(fixtureResult.benchmarkClaim, false);
  assert.equal(fixtureResult.runner.status, 'blocked');
  assert.equal(
    fixtureResult.externalAdapterCommandContract.stdoutSchemaVersion,
    BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
  );
  assert.ok(fixtureResult.externalAdapterCommandContract.stdoutMaxBytes <= MAX_PLATFORM_BENCHMARK_MANIFEST_BYTES);
  assert.ok(fixtureResult.externalAdapterCommandContract.injectedEnv.includes('SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON'));
  assert.deepEqual(
    fixtureResult.externalAdapterCommandContract.passRequiresAdapterRunProof.forbiddenPassEvidenceTokens,
    [...REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES],
  );
  assert.equal(
    fixtureResult.externalAdapterCommandContract.perCandidateCommandEnv[EXTERNAL_FIXTURE_CANDIDATE].commandEnv,
    'SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND',
  );

  const fixtureCandidate = fixtureResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(fixtureCandidate, 'fixture candidate result should be present');
  assert.equal(fixtureCandidate.status, 'blocked');
  assert.equal(fixtureCandidate.benchmarkClaim, false);
  assert.equal(fixtureCandidate.realAdapterResult, false);
  assert.equal(fixtureCandidate.liveSurfaceTransport, 'native-embedded');
  assert.equal(fixtureCandidate.singleInteractiveTruth, true);
  assert.equal(fixtureCandidate.secondTruthSource, false);
  assert.ok(fixtureCandidate.blockerRefs.some((ref) => ref.includes('schema-validation-only-not-a-benchmark')));
  assert.ok(fixtureCandidate.metricSections.every((section) => section.status === 'blocked'));
  assert.ok(fixtureCandidate.metricSections.every((section) => (
    section.resultRefs.every((ref) => ref.startsWith(`schema-fixture-result:${EXTERNAL_FIXTURE_CANDIDATE}:`))
  )));
  assert.ok(fixtureResult.candidates.some((candidate) => candidate.id !== EXTERNAL_FIXTURE_CANDIDATE && candidate.status === 'blocked'));
  assert.equal(fixtureResult.decisionGate.status, 'blocked');
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(fixtureResult));

  const genericRealExternalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildRealAdapterCommandArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: genericRealExternalOutputPath,
    now: '2026-06-02T00:00:02.250Z',
  });
  assert.equal(genericRealExternalResult.status, 'failed');
  assert.equal(genericRealExternalResult.benchmarkClaim, false);
  const genericRealExternalCandidate = genericRealExternalResult.candidates.find((candidate) => (
    candidate.id === EXTERNAL_FIXTURE_CANDIDATE
  ));
  assert.ok(genericRealExternalCandidate, 'generic real external adapter candidate should be present');
  assert.equal(genericRealExternalCandidate.status, 'failed');
  assert.equal(genericRealExternalCandidate.benchmarkClaim, false);
  assert.equal(genericRealExternalCandidate.realAdapterResult, false);
  assert.ok(genericRealExternalCandidate.diagnosticRefs.some((ref) => (
    ref.includes('trusted live adapter helper provenance')
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(genericRealExternalResult));

  await writeFile(electronLiveEvidencePath, `${JSON.stringify(buildDesktopNativeLiveAcceptanceFixture(), null, 2)}\n`, 'utf8');
  const electronExternalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify([
        '--import',
        'tsx',
        resolve(process.cwd(), 'tools/browser-native-adapter-electron-web-contents-view-external-result.ts'),
      ]),
      [ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV]: electronLiveEvidencePath,
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: electronExternalOutputPath,
    now: '2026-06-02T00:00:02.500Z',
  });
  assert.equal(electronExternalResult.status, 'blocked');
  assert.equal(electronExternalResult.benchmarkClaim, false);
  assert.equal(electronExternalResult.runner.status, 'blocked');
  assert.equal(electronExternalResult.decisionGate.status, 'blocked');
  const electronExternalCandidate = electronExternalResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(electronExternalCandidate, 'Electron external adapter candidate should be present');
  assert.equal(electronExternalCandidate.status, 'blocked');
  assert.equal(electronExternalCandidate.benchmarkClaim, false);
  assert.equal(electronExternalCandidate.realAdapterResult, false);
  assert.equal(electronExternalCandidate.liveSurfaceTransport, 'native-embedded');
  assert.equal(electronExternalCandidate.singleInteractiveTruth, true);
  assert.equal(electronExternalCandidate.secondTruthSource, false);
  assert.equal(electronExternalCandidate.adapterProofRefs.proofMode, 'blocked-or-invalid');
  assert.ok(electronExternalCandidate.blockerRefs.includes(`benchmark-result:${EXTERNAL_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`));
  assert.ok(electronExternalCandidate.diagnosticRefs.includes(
    'electron-web-contents-view:explicit-live-evidence-file-diagnostic-only',
  ));
  assert.ok(electronExternalResult.candidates.some((candidate) => candidate.id !== EXTERNAL_FIXTURE_CANDIDATE && candidate.status === 'blocked'));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(electronExternalResult));
  const persistedElectronExternalText = await readFile(electronExternalOutputPath, 'utf8');
  assertPlatformBenchmarkArtifactIsBounded(persistedElectronExternalText);
  const persistedElectronExternalResult = JSON.parse(persistedElectronExternalText) as typeof electronExternalResult;
  const persistedElectronExternalCandidate = persistedElectronExternalResult.candidates.find((candidate) => (
    candidate.id === EXTERNAL_FIXTURE_CANDIDATE
  ));
  assert.ok(persistedElectronExternalCandidate, 'persisted Electron external adapter candidate should be present');
  assert.equal(persistedElectronExternalResult.status, 'blocked');
  assert.equal(persistedElectronExternalResult.benchmarkClaim, false);
  assert.equal(persistedElectronExternalResult.decisionGate.status, 'blocked');
  assert.equal(persistedElectronExternalCandidate.realAdapterResult, false);
  assert.equal(persistedElectronExternalCandidate.status, 'blocked');
  assert.equal(persistedElectronExternalCandidate.benchmarkClaim, false);
  assert.ok(persistedElectronExternalCandidate.blockerRefs.includes(
    `benchmark-result:${EXTERNAL_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`,
  ));

  const standaloneChromiumExternalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_ARGS_JSON: JSON.stringify([
        '--import',
        'tsx',
        resolve(process.cwd(), 'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts'),
      ]),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: standaloneChromiumExternalOutputPath,
    now: '2026-06-02T00:00:02.750Z',
  });
  assert.equal(standaloneChromiumExternalResult.status, 'blocked');
  assert.equal(standaloneChromiumExternalResult.benchmarkClaim, false);
  assert.equal(standaloneChromiumExternalResult.runner.status, 'blocked');
  assert.equal(standaloneChromiumExternalResult.decisionGate.status, 'blocked');
  const standaloneChromiumCandidate = standaloneChromiumExternalResult.candidates.find((candidate) => (
    candidate.id === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE
  ));
  assert.ok(standaloneChromiumCandidate, 'standalone Chromium external adapter candidate should be present');
  assert.equal(standaloneChromiumCandidate.status, 'blocked');
  assert.equal(standaloneChromiumCandidate.benchmarkClaim, false);
  assert.equal(standaloneChromiumCandidate.realAdapterResult, false);
  assert.deepEqual(candidateAvailability(standaloneChromiumCandidate), {
    helperCommandPresent: true,
    realAdapterCommandPresent: false,
    availabilityStatus: 'missing-real-adapter-command',
  });
  assert.equal(standaloneChromiumCandidate.supportedOnCurrentPlatform, true);
  assert.equal(standaloneChromiumCandidate.adapterProofRefs.proofMode, 'blocked-or-invalid');
  assert.ok(standaloneChromiumCandidate.blockerRefs.includes(
    `benchmark-result:${STANDALONE_CHROMIUM_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`,
  ));
  assert.ok(standaloneChromiumCandidate.blockerRefs.includes(
    `benchmark-result:${STANDALONE_CHROMIUM_FIXTURE_CANDIDATE}:missing-required-metric-section-results`,
  ));
  assert.ok(standaloneChromiumCandidate.diagnosticRefs.includes(
    'standalone-chromium-surface:typed-blocked-no-native-display-input-adapter',
  ));
  assert.ok(standaloneChromiumCandidate.diagnosticRefs.includes(
    'standalone-chromium-surface:missing-browser-host-session-native-surface-attach',
  ));
  assert.ok(standaloneChromiumCandidate.diagnosticRefs.includes(
    'standalone-chromium-surface:missing-native-input-routing-proof',
  ));
  assert.ok(standaloneChromiumCandidate.metricSections.every((section) => section.status === 'blocked'));
  assert.ok(standaloneChromiumCandidate.metricSections.every((section) => (
    section.resultRefs.every((ref) => ref.startsWith(
      `benchmark-result:${STANDALONE_CHROMIUM_FIXTURE_CANDIDATE}:${section.section}:typed-blocked-native-display-input-adapter-missing`,
    ))
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(standaloneChromiumExternalResult));

  const standaloneChromiumRealExternalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_ARGS_JSON: JSON.stringify([
        '--import',
        'tsx',
        resolve(process.cwd(), 'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts'),
      ]),
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON: JSON.stringify(buildRealAdapterCommandArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: standaloneChromiumRealExternalOutputPath,
    now: '2026-06-02T00:00:02.800Z',
  });
  assert.equal(standaloneChromiumRealExternalResult.status, 'failed');
  assert.equal(standaloneChromiumRealExternalResult.benchmarkClaim, false);
  const standaloneChromiumRealCandidate = standaloneChromiumRealExternalResult.candidates.find((candidate) => (
    candidate.id === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE
  ));
  assert.ok(standaloneChromiumRealCandidate, 'standalone Chromium real external adapter candidate should be present');
  assert.equal(standaloneChromiumRealCandidate.status, 'failed');
  assert.equal(standaloneChromiumRealCandidate.benchmarkClaim, false);
  assert.equal(standaloneChromiumRealCandidate.realAdapterResult, false);
  assert.equal(standaloneChromiumRealCandidate.adapterProofRefs.proofMode, 'blocked-or-invalid');
  assert.ok(
    standaloneChromiumRealCandidate.blockerRefs.includes('env:SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND:execution-failed')
    || standaloneChromiumRealCandidate.blockerRefs.includes(`benchmark-result:${STANDALONE_CHROMIUM_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`),
  );
  assert.ok(standaloneChromiumRealCandidate.diagnosticRefs.some((ref) => (
    ref.includes('missing metric section streamQuality')
    || ref.includes('real proof must include candidate-scoped')
    || ref.includes('real candidate-scoped benchmark result refs')
    || ref.includes('trusted live adapter helper provenance')
  )));
  assert.ok(standaloneChromiumRealCandidate.metricSections.every((section) => section.status === 'blocked'));
  assert.ok(standaloneChromiumRealExternalResult.candidates.some((candidate) => (
    candidate.id !== STANDALONE_CHROMIUM_FIXTURE_CANDIDATE && candidate.status === 'blocked'
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(standaloneChromiumRealExternalResult));

  const wkwebviewExternalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_ARGS_JSON: JSON.stringify([
        '--import',
        'tsx',
        resolve(process.cwd(), 'tools/browser-native-adapter-wkwebview-external-result.ts'),
      ]),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: wkwebviewExternalOutputPath,
    now: '2026-06-02T00:00:02.875Z',
  });
  assert.equal(wkwebviewExternalResult.status, 'blocked');
  assert.equal(wkwebviewExternalResult.benchmarkClaim, false);
  assert.equal(wkwebviewExternalResult.runner.status, 'blocked');
  assert.equal(wkwebviewExternalResult.decisionGate.status, 'blocked');
  assert.equal(wkwebviewExternalResult.decisionGate.selectedAdapterId, null);
  const wkwebviewCandidate = wkwebviewExternalResult.candidates.find((candidate) => (
    candidate.id === WKWEBVIEW_FIXTURE_CANDIDATE
  ));
  assert.ok(wkwebviewCandidate, 'WKWebView external adapter candidate should be present');
  assert.equal(wkwebviewCandidate.platform, 'macos');
  assert.equal(wkwebviewCandidate.status, 'blocked');
  assert.equal(wkwebviewCandidate.benchmarkClaim, false);
  assert.equal(wkwebviewCandidate.realAdapterResult, false);
  assert.deepEqual(candidateAvailability(wkwebviewCandidate), {
    helperCommandPresent: true,
    realAdapterCommandPresent: false,
    availabilityStatus: process.platform === 'darwin' ? 'missing-real-adapter-command' : 'unsupported-on-current-platform',
  });
  assert.equal(wkwebviewCandidate.supportedOnCurrentPlatform, process.platform === 'darwin');
  assert.equal(wkwebviewCandidate.liveSurfaceTransport, 'native-embedded');
  assert.equal(wkwebviewCandidate.singleInteractiveTruth, true);
  assert.equal(wkwebviewCandidate.secondTruthSource, false);
  assert.equal(wkwebviewCandidate.adapterProofRefs.proofMode, 'blocked-or-invalid');
  assert.ok(wkwebviewCandidate.blockerRefs.includes(
    `benchmark-result:${WKWEBVIEW_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`,
  ));
  assert.ok(wkwebviewCandidate.blockerRefs.includes(
    `benchmark-result:${WKWEBVIEW_FIXTURE_CANDIDATE}:missing-required-metric-section-results`,
  ));
  assert.ok(wkwebviewCandidate.blockerRefs.includes(
    `benchmark-result:${WKWEBVIEW_FIXTURE_CANDIDATE}:schema-validation-only-not-a-benchmark`,
  ));
  assert.ok(wkwebviewCandidate.diagnosticRefs.includes(
    'wkwebview:typed-blocked-native-display-input-adapter-missing',
  ));
  assert.ok(wkwebviewCandidate.diagnosticRefs.includes(
    'wkwebview:missing-browser-host-session-native-surface-attach',
  ));
  assert.ok(wkwebviewCandidate.diagnosticRefs.includes(
    'wkwebview:missing-native-input-routing-proof',
  ));
  assert.ok(wkwebviewCandidate.diagnosticRefs.includes(
    'browser-native-adapter-platform-benchmark:typed-blocked-external-result',
  ));
  assert.ok(wkwebviewCandidate.metricSections.every((section) => section.status === 'blocked'));
  assert.ok(wkwebviewCandidate.metricSections.every((section) => (
    section.resultRefs.every((ref) => ref.startsWith(
      `benchmark-result:${WKWEBVIEW_FIXTURE_CANDIDATE}:${section.section}:typed-blocked-native-display-input-adapter-missing`,
    ))
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(wkwebviewExternalResult));

  const wkwebviewRealExternalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_ARGS_JSON: JSON.stringify([
        '--import',
        'tsx',
        resolve(process.cwd(), 'tools/browser-native-adapter-wkwebview-external-result.ts'),
      ]),
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_ARGS_JSON: JSON.stringify(buildRealAdapterCommandArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: wkwebviewRealExternalOutputPath,
    now: '2026-06-02T00:00:02.900Z',
  });
  assert.equal(wkwebviewRealExternalResult.status, process.platform === 'darwin' ? 'failed' : 'blocked');
  assert.equal(wkwebviewRealExternalResult.benchmarkClaim, false);
  const webview2UnsupportedCandidate = wkwebviewRealExternalResult.candidates.find((candidate) => candidate.id === 'webview2');
  assert.ok(webview2UnsupportedCandidate, 'WebView2 candidate should be present');
  if (process.platform === 'darwin') {
    assert.equal(webview2UnsupportedCandidate.supportedOnCurrentPlatform, false);
    assert.ok(webview2UnsupportedCandidate.blockerRefs.includes('platform:windows:unsupported-on-darwin'));
  }
  const wkwebviewRealCandidate = wkwebviewRealExternalResult.candidates.find((candidate) => (
    candidate.id === WKWEBVIEW_FIXTURE_CANDIDATE
  ));
  assert.ok(wkwebviewRealCandidate, 'WKWebView real external adapter candidate should be present');
  assert.equal(wkwebviewRealCandidate.status, process.platform === 'darwin' ? 'failed' : 'blocked');
  assert.equal(wkwebviewRealCandidate.benchmarkClaim, false);
  assert.equal(wkwebviewRealCandidate.realAdapterResult, false);
  assert.equal(wkwebviewRealCandidate.supportedOnCurrentPlatform, process.platform === 'darwin');
  assert.equal(wkwebviewRealCandidate.adapterProofRefs.proofMode, 'blocked-or-invalid');
  if (process.platform === 'darwin') {
    assert.ok(
      wkwebviewRealCandidate.blockerRefs.includes('env:SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_COMMAND:execution-failed')
      || wkwebviewRealCandidate.blockerRefs.includes(`benchmark-result:${WKWEBVIEW_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`),
    );
    assert.ok(wkwebviewRealCandidate.diagnosticRefs.some((ref) => (
      ref.includes('real native adapter result proof')
      || ref.includes('real candidate-scoped benchmark result refs')
      || ref.includes('real proof must include candidate-scoped')
      || ref.includes('missing metric section streamQuality')
      || ref.includes('trusted live adapter helper provenance')
    )));
  } else {
    assert.ok(wkwebviewRealCandidate.blockerRefs.includes(`platform:macos:unsupported-on-${process.platform}`));
  }
  assert.ok(wkwebviewRealExternalResult.candidates.some((candidate) => (
    candidate.id !== WKWEBVIEW_FIXTURE_CANDIDATE && candidate.status === 'blocked'
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(wkwebviewRealExternalResult));

  const invalidSchemaResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(['-e', 'process.stdout.write(JSON.stringify({ status: "passed", benchmarkClaim: true }))']),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: invalidSchemaOutputPath,
    now: '2026-06-02T00:00:03.000Z',
  });
  assert.equal(invalidSchemaResult.status, 'failed');
  const invalidCandidate = invalidSchemaResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(invalidCandidate, 'invalid schema candidate result should be present');
  assert.equal(invalidCandidate.status, 'failed');
  assert.ok(invalidCandidate.diagnosticRefs.some((ref) => ref.includes('external adapter stdout must declare')));
  assert.equal(invalidSchemaResult.benchmarkClaim, false);
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(invalidSchemaResult));

  const falsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithoutRealAdapterProofArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: falsePassOutputPath,
    now: '2026-06-02T00:00:04.000Z',
  });
  assert.equal(falsePassResult.status, 'failed');
  assert.equal(falsePassResult.benchmarkClaim, false);
  const falsePassCandidate = falsePassResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(falsePassCandidate, 'false pass candidate result should be present');
  assert.equal(falsePassCandidate.status, 'failed');
  assert.equal(falsePassCandidate.benchmarkClaim, false);
  assert.equal(falsePassCandidate.realAdapterResult, false);
  assert.ok(falsePassCandidate.diagnosticRefs.some((ref) => ref.includes('real native adapter result proof')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(falsePassResult));

  const partialProofRefsFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithPartialAdapterProofRefsArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: partialProofRefsFalsePassOutputPath,
    now: '2026-06-02T00:00:05.000Z',
  });
  assert.equal(partialProofRefsFalsePassResult.status, 'failed');
  assert.equal(partialProofRefsFalsePassResult.benchmarkClaim, false);
  const partialProofRefsCandidate = partialProofRefsFalsePassResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(partialProofRefsCandidate, 'partial proof refs candidate result should be present');
  assert.equal(partialProofRefsCandidate.status, 'failed');
  assert.equal(partialProofRefsCandidate.benchmarkClaim, false);
  assert.equal(partialProofRefsCandidate.realAdapterResult, false);
  assert.equal(partialProofRefsCandidate.adapterProofRefs.proofMode, 'blocked-or-invalid');
  assert.ok(partialProofRefsCandidate.diagnosticRefs.some((ref) => (
    ref.includes('real native adapter result proof')
    || ref.includes('real proof must include candidate-scoped')
    || ref.includes('real proof refs must not contain')
    || ref.includes('real candidate-scoped benchmark result refs')
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(partialProofRefsFalsePassResult));

  const legacyPassEvidenceFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithLegacyEvidenceArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: legacyPassEvidenceFalsePassOutputPath,
    now: '2026-06-02T00:00:05.500Z',
  });
  assert.equal(legacyPassEvidenceFalsePassResult.status, 'failed');
  assert.equal(legacyPassEvidenceFalsePassResult.benchmarkClaim, false);
  const legacyPassEvidenceCandidate = legacyPassEvidenceFalsePassResult.candidates.find((candidate) => (
    candidate.id === EXTERNAL_FIXTURE_CANDIDATE
  ));
  assert.ok(legacyPassEvidenceCandidate, 'legacy pass evidence false pass candidate should be present');
  assert.equal(legacyPassEvidenceCandidate.status, 'failed');
  assert.equal(legacyPassEvidenceCandidate.benchmarkClaim, false);
  assert.equal(legacyPassEvidenceCandidate.realAdapterResult, false);
  assert.ok(legacyPassEvidenceCandidate.diagnosticRefs.some((ref) => (
    ref.includes('legacy frame-stream/canvas/WebRTC tokens')
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(legacyPassEvidenceFalsePassResult));

  const rawFieldFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithForbiddenRawFieldsArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: rawFieldFalsePassOutputPath,
    now: '2026-06-02T00:00:05.750Z',
  });
  assert.equal(rawFieldFalsePassResult.status, 'failed');
  assert.equal(rawFieldFalsePassResult.benchmarkClaim, false);
  const rawFieldFalsePassCandidate = rawFieldFalsePassResult.candidates.find((candidate) => (
    candidate.id === EXTERNAL_FIXTURE_CANDIDATE
  ));
  assert.ok(rawFieldFalsePassCandidate, 'raw field false pass candidate should be present');
  assert.equal(rawFieldFalsePassCandidate.status, 'failed');
  assert.equal(rawFieldFalsePassCandidate.benchmarkClaim, false);
  assert.equal(rawFieldFalsePassCandidate.realAdapterResult, false);
  assert.ok(rawFieldFalsePassCandidate.diagnosticRefs.some((ref) => (
    ref.includes('raw URL, DOM, screenshot, provider payload, log, or secret fields')
    || ref.includes('raw URLs')
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(rawFieldFalsePassResult));

  const rawStringFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithRawUrlStringArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: rawStringFalsePassOutputPath,
    now: '2026-06-02T00:00:05.875Z',
  });
  assert.equal(rawStringFalsePassResult.status, 'failed');
  assert.equal(rawStringFalsePassResult.benchmarkClaim, false);
  const rawStringFalsePassCandidate = rawStringFalsePassResult.candidates.find((candidate) => (
    candidate.id === EXTERNAL_FIXTURE_CANDIDATE
  ));
  assert.ok(rawStringFalsePassCandidate, 'raw string false pass candidate should be present');
  assert.equal(rawStringFalsePassCandidate.status, 'failed');
  assert.equal(rawStringFalsePassCandidate.benchmarkClaim, false);
  assert.equal(rawStringFalsePassCandidate.realAdapterResult, false);
  assert.ok(rawStringFalsePassCandidate.diagnosticRefs.some((ref) => (
    ref.includes('raw URL') || ref.includes('refs-first')
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(rawStringFalsePassResult));

  const fixtureMetricRefsFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithFixtureMetricRefsArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: fixtureMetricRefsFalsePassOutputPath,
    now: '2026-06-02T00:00:06.000Z',
  });
  assert.equal(fixtureMetricRefsFalsePassResult.status, 'failed');
  assert.equal(fixtureMetricRefsFalsePassResult.benchmarkClaim, false);
  const fixtureMetricRefsCandidate = fixtureMetricRefsFalsePassResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(fixtureMetricRefsCandidate, 'fixture metric refs candidate result should be present');
  assert.equal(fixtureMetricRefsCandidate.status, 'failed');
  assert.equal(fixtureMetricRefsCandidate.benchmarkClaim, false);
  assert.ok(fixtureMetricRefsCandidate.diagnosticRefs.some((ref) => ref.includes('real candidate-scoped benchmark result refs')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(fixtureMetricRefsFalsePassResult));

  const missingMetricSummaryFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithoutMetricSummariesArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: missingMetricSummaryFalsePassOutputPath,
    now: '2026-06-02T00:00:07.000Z',
  });
  assert.equal(missingMetricSummaryFalsePassResult.status, 'failed');
  assert.equal(missingMetricSummaryFalsePassResult.benchmarkClaim, false);
  const missingMetricSummaryCandidate = missingMetricSummaryFalsePassResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(missingMetricSummaryCandidate, 'missing metric summary false pass candidate result should be present');
  assert.equal(missingMetricSummaryCandidate.status, 'failed');
  assert.equal(missingMetricSummaryCandidate.benchmarkClaim, false);
  assert.ok(missingMetricSummaryCandidate.diagnosticRefs.some((ref) => ref.includes('bounded aggregate summary keys')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(missingMetricSummaryFalsePassResult));

  const wrongTypeMetricSummaryFalsePassResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithWrongTypeMetricSummariesArgs()),
    },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: wrongTypeMetricSummaryFalsePassOutputPath,
    now: '2026-06-02T00:00:08.000Z',
  });
  assert.equal(wrongTypeMetricSummaryFalsePassResult.status, 'failed');
  assert.equal(wrongTypeMetricSummaryFalsePassResult.benchmarkClaim, false);
  const wrongTypeMetricSummaryCandidate = wrongTypeMetricSummaryFalsePassResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(wrongTypeMetricSummaryCandidate, 'wrong-type metric summary false pass candidate result should be present');
  assert.equal(wrongTypeMetricSummaryCandidate.status, 'failed');
  assert.equal(wrongTypeMetricSummaryCandidate.benchmarkClaim, false);
  assert.ok(wrongTypeMetricSummaryCandidate.diagnosticRefs.some((ref) => ref.includes('bounded aggregate summary keys')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(wrongTypeMetricSummaryFalsePassResult));
});

test('browser native adapter platform benchmark rejects raw URL string false-pass output independently', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-raw-url-'));
  const rawStringManifestPath = join(tempDir, 'platform-benchmark-manifest.json');
  const rawStringResultPath = join(tempDir, 'raw-string-results.json');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-raw-url-guard-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: ['browser-native-adapter-platform-benchmark:raw-url-string-guard'],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writeFile(rawStringManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const result = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify(buildFalsePassWithRawUrlStringArgs()),
    },
    inputManifestPath: rawStringManifestPath,
    outputPath: rawStringResultPath,
    now: '2026-06-02T00:00:09.000Z',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  const candidate = result.candidates.find((item) => item.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(candidate, 'raw URL false-pass candidate should be present');
  assert.equal(candidate.status, 'failed');
  assert.equal(candidate.benchmarkClaim, false);
  assert.equal(candidate.realAdapterResult, false);
  assert.ok(candidate.diagnosticRefs.some((ref) => ref.includes('raw URLs') || ref.includes('refs-first')));
  const persisted = await readFile(rawStringResultPath, 'utf8');
  assertPlatformBenchmarkArtifactIsBounded(persisted);
});

test('browser native adapter platform benchmark requires the Electron helper as the actual executed entrypoint', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-helper-provenance-'));
  const helperProvenanceManifestPath = join(tempDir, 'platform-benchmark-manifest.json');
  const helperProvenanceResultPath = join(tempDir, 'helper-provenance-results.json');
  const helperEvalProvenanceResultPath = join(tempDir, 'helper-eval-provenance-results.json');
  const fakePassScriptPath = join(tempDir, 'fake-pass.js');
  const electronHelperPath = resolve(process.cwd(), 'tools/browser-native-adapter-electron-web-contents-view-external-result.ts');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-helper-provenance-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: ['browser-native-adapter-platform-benchmark:helper-provenance-guard'],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writeFile(helperProvenanceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(fakePassScriptPath, buildRealAdapterCommandScriptSource(), 'utf8');

  const result = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_RUN_LIVE_SMOKE: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify([
        fakePassScriptPath,
        electronHelperPath,
      ]),
    },
    inputManifestPath: helperProvenanceManifestPath,
    outputPath: helperProvenanceResultPath,
    now: '2026-06-02T00:00:10.000Z',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  const electronCandidate = result.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(electronCandidate, 'Electron helper provenance candidate should be present');
  assert.equal(electronCandidate.status, 'failed');
  assert.equal(electronCandidate.benchmarkClaim, false);
  assert.equal(electronCandidate.realAdapterResult, false);
  assert.ok(electronCandidate.diagnosticRefs.some((ref) => ref.includes('trusted live adapter helper provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));

  const evalResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_RUN_LIVE_SMOKE: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_ARGS_JSON: JSON.stringify([
        `--eval=${buildRealAdapterCommandScriptSource()}`,
        electronHelperPath,
      ]),
    },
    inputManifestPath: helperProvenanceManifestPath,
    outputPath: helperEvalProvenanceResultPath,
    now: '2026-06-02T00:00:10.500Z',
  });

  assert.equal(evalResult.status, 'failed');
  assert.equal(evalResult.benchmarkClaim, false);
  const evalElectronCandidate = evalResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(evalElectronCandidate, 'Electron --eval provenance candidate should be present');
  assert.equal(evalElectronCandidate.status, 'failed');
  assert.equal(evalElectronCandidate.benchmarkClaim, false);
  assert.equal(evalElectronCandidate.realAdapterResult, false);
  assert.ok(evalElectronCandidate.diagnosticRefs.some((ref) => ref.includes('trusted live adapter helper provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(evalResult));
});

test('trusted helper basename in argv does not satisfy actual executed entrypoint provenance for WK and standalone', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-wk-standalone-helper-provenance-'));
  const helperProvenanceManifestPath = join(tempDir, 'platform-benchmark-manifest.json');
  const standaloneHelperProvenanceResultPath = join(tempDir, 'standalone-helper-provenance-results.json');
  const wkHelperProvenanceResultPath = join(tempDir, 'wk-helper-provenance-results.json');
  const fakePassScriptPath = join(tempDir, 'fake-pass.js');
  const standaloneHelperPath = resolve(
    process.cwd(),
    'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts',
  );
  const wkHelperPath = resolve(process.cwd(), 'tools/browser-native-adapter-wkwebview-external-result.ts');
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-wk-standalone-helper-provenance-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: ['browser-native-adapter-platform-benchmark:wk-standalone-helper-provenance-guard'],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writeFile(helperProvenanceManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(fakePassScriptPath, buildRealAdapterCommandScriptSource(), 'utf8');

  const standaloneResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_ARGS_JSON: JSON.stringify([
        fakePassScriptPath,
        standaloneHelperPath,
      ]),
    },
    inputManifestPath: helperProvenanceManifestPath,
    outputPath: standaloneHelperProvenanceResultPath,
    now: '2026-06-02T00:00:11.000Z',
  });

  assert.equal(standaloneResult.status, 'failed');
  assert.equal(standaloneResult.benchmarkClaim, false);
  const standaloneCandidate = standaloneResult.candidates.find((candidate) => (
    candidate.id === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE
  ));
  assert.ok(standaloneCandidate, 'standalone helper provenance candidate should be present');
  assert.equal(standaloneCandidate.status, 'failed');
  assert.equal(standaloneCandidate.benchmarkClaim, false);
  assert.equal(standaloneCandidate.realAdapterResult, false);
  assert.ok(standaloneCandidate.diagnosticRefs.some((ref) => ref.includes('trusted live adapter helper provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(standaloneResult));

  if (process.platform === 'darwin') {
    const wkRunnerResult = await runBrowserNativeAdapterPlatformBenchmark({
      env: {
        [REAL_RUNNER_OPT_IN_ENV]: '1',
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_RUN_LIVE_SMOKE: '1',
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_COMMAND: process.execPath,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_ARGS_JSON: JSON.stringify([
          fakePassScriptPath,
          wkHelperPath,
        ]),
      },
      inputManifestPath: helperProvenanceManifestPath,
      outputPath: wkHelperProvenanceResultPath,
      now: '2026-06-02T00:00:11.500Z',
    });

    assert.equal(wkRunnerResult.status, 'failed');
    assert.equal(wkRunnerResult.benchmarkClaim, false);
    const wkCandidate = wkRunnerResult.candidates.find((candidate) => candidate.id === WKWEBVIEW_FIXTURE_CANDIDATE);
    assert.ok(wkCandidate, 'WK helper provenance candidate should be present');
    assert.equal(wkCandidate.status, 'failed');
    assert.equal(wkCandidate.benchmarkClaim, false);
    assert.equal(wkCandidate.realAdapterResult, false);
    assert.ok(wkCandidate.diagnosticRefs.some((ref) => ref.includes('trusted live adapter helper provenance')));
    assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(wkRunnerResult));
  } else {
    const wkDirectResult = await buildWkwebviewExternalBenchmarkResult({
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_COMMAND: process.execPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_REAL_ARGS_JSON: JSON.stringify([
        fakePassScriptPath,
        wkHelperPath,
      ]),
    });
    assert.equal(wkDirectResult.status, 'failed');
    assert.equal(wkDirectResult.benchmarkClaim, false);
    assert.ok(wkDirectResult.diagnosticRefs?.some((ref) => ref.includes('trusted live adapter helper provenance')));
    assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(wkDirectResult));
  }
});

test('fake executable named tsx cannot satisfy trusted helper provenance for WK or standalone', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-fake-tsx-helper-provenance-'));
  const fakeTsxManifestPath = join(tempDir, 'platform-benchmark-manifest.json');
  const fakeTsxResultPath = join(tempDir, 'fake-tsx-helper-provenance-results.json');
  const fakeTsxPath = join(tempDir, 'tsx');
  const standaloneHelperPath = resolve(
    process.cwd(),
    'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts',
  );
  const comparisonManifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-fake-tsx-helper-provenance-source-comparison',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: ['browser-native-adapter-platform-benchmark:fake-tsx-helper-provenance-guard'],
  });
  const manifest = buildPlatformBenchmarkManifest(comparisonManifest);
  await writeFile(fakeTsxManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(fakeTsxPath, fakeTsxPassScriptSource(), { mode: 0o755 });

  const result = await runBrowserNativeAdapterPlatformBenchmark({
    env: {
      [REAL_RUNNER_OPT_IN_ENV]: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE: '1',
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_COMMAND: fakeTsxPath,
      SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_ARGS_JSON: JSON.stringify([
        standaloneHelperPath,
      ]),
    },
    inputManifestPath: fakeTsxManifestPath,
    outputPath: fakeTsxResultPath,
    now: '2026-06-02T00:00:12.000Z',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.benchmarkClaim, false);
  const candidate = result.candidates.find((entry) => entry.id === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE);
  assert.ok(candidate, 'standalone fake tsx candidate should be present');
  assert.equal(candidate.status, 'failed');
  assert.equal(candidate.benchmarkClaim, false);
  assert.equal(candidate.realAdapterResult, false);
  assert.ok(candidate.diagnosticRefs.some((ref) => ref.includes('trusted live adapter helper provenance')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(result));
});

function buildPlatformBenchmarkManifest(comparisonManifest: BrowserNativeAdapterComparisonManifest): PlatformBenchmarkManifest {
  const candidateRefs = comparisonManifest.candidates.map((candidate) => ({
    id: candidate.id,
    candidateRef: candidateRef(candidate.id),
    status: 'blocked' as const,
    comparisonRefs: candidate.comparisonRefs,
  }));

  return {
    schemaVersion: PLATFORM_BENCHMARK_MANIFEST_SCHEMA,
    manifestId: 'browser-native-adapter-platform-benchmark-manifest',
    observedAt: new Date().toISOString(),
    status: 'blocked',
    statusReasonRef: 'browser-native-adapter-platform-benchmark:not-run-without-opt-in-runner',
    benchmarkClaim: false,
    comparisonManifestRef,
    sourceComparisonManifestId: comparisonManifest.manifestId,
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    refsFirst: true,
    artifactPayloadMode: 'bounded-summary-refs-only',
    payloadPolicy: {
      refsFirst: true,
      maxInlineEvidenceBytes: 0,
      allowedInlineValueKinds: ['ids', 'refs', 'booleans', 'numeric-summaries', 'status-flags', 'hashes'],
      forbiddenInlineEvidenceKinds: [
        'raw-dom',
        'base64-image',
        'screenshot-bytes',
        'provider-payload',
        'full-console-log',
        'full-network-log',
      ],
    },
    platformRunner: {
      runnerId: 'browser-native-adapter-platform-benchmark-runner',
      status: 'not-run',
      optInEnvVar: REAL_RUNNER_OPT_IN_ENV,
      optInValue: '1',
      defaultBehavior: 'write-manifest-only',
      directSmokeCommand: DIRECT_VERIFICATION_COMMAND,
      realRunnerCommandRef: REAL_RUNNER_COMMAND_REF,
      inputManifestRef: platformBenchmarkManifestRef,
      expectedResultArtifactRef: DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
      requiredResultStatusValues: ['passed', 'blocked', 'failed'],
      handoffContract: {
        inputRefs: [
          platformBenchmarkManifestRef,
          comparisonManifestRef,
          ...candidateRefs.map((candidate) => candidate.candidateRef),
        ],
        outputRefs: [
          'benchmark-result:electron-web-contents-view',
          'benchmark-result:webview2',
          'benchmark-result:wkwebview',
          'benchmark-result:standalone-chromium-surface',
        ],
        resultPatchRules: [
          'runner reads candidateRefs and requiredMetricSections from this manifest',
          'runner writes only bounded aggregate summaries and refs for each metric section',
          'runner leaves selectedAdapterId unset unless all required platform candidates have real result refs',
        ],
      },
      externalAdapterCommandContract: {
        stdoutSchemaVersion: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
        stdoutMaxBytes: MAX_PLATFORM_BENCHMARK_MANIFEST_BYTES,
        injectedEnv: [
          'SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE',
          'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM',
          'SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA',
          'SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON',
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
          proofKinds: ['policy', 'entrypoint', 'helper-chain', 'live-smoke'],
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
        adapterCommandResponsibilities: [
          'launch-or-attach-real-native-adapter-for-this-candidate',
          'drive-real-BrowserHostSession-owned-input-and-navigation',
          'write-only-bounded-summary-refs-and-numeric-aggregates-to-stdout',
          'return-blocked-or-failed-instead-of-synthesizing-missing-platform-results',
        ],
        perPlatformCommandEnvDocs: comparisonManifest.candidates.map((candidate) => ({
          candidateId: candidate.id,
          platform: candidate.platform,
          commandEnv: adapterEnvName(candidate.id, 'COMMAND'),
          argsJsonEnv: adapterEnvName(candidate.id, 'ARGS_JSON'),
          supportedOnCurrentPlatform: platformSupported(candidate.platform),
        })),
        sampleFixture: {
          candidateId: EXTERNAL_FIXTURE_CANDIDATE,
          purpose: 'schema-validation-only-no-real-native-adapter-benchmark',
          expectedRunnerStatus: 'blocked',
        },
      },
    },
    requiredMetricSections: [...REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS],
    metricFieldContract: REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS.map((section) => ({
      section,
      status: 'not-run',
      evidenceMode: 'bounded-summary-ref',
      inlineEvidence: 'forbidden',
      fields: comparisonManifest.candidates[0]!.metrics[section].fields.map((field) => ({
        field: field.field,
        unit: field.unit,
        required: field.required,
        source: field.source,
      })),
    })),
    candidateRefs,
    candidates: comparisonManifest.candidates.map((candidate) => ({
      id: candidate.id,
      candidateRef: candidateRef(candidate.id),
      comparisonRefs: candidate.comparisonRefs,
      platform: candidate.platform,
      surfaceApi: candidate.surfaceApi,
      inputApi: candidate.inputApi,
      liveSurfaceTransport: candidate.liveSurfaceTransport,
      singleInteractiveTruth: candidate.singleInteractiveTruth,
      secondTruthSource: candidate.secondTruthSource,
      status: 'blocked',
      benchmarkClaim: false,
      blockedByRefs: [
        'PROJECT_browser.md:Electron/WebView2/WKWebView benchmark gap',
        REAL_RUNNER_COMMAND_REF,
      ],
      runnerInputRef: `benchmark-runner-input:${candidate.id}`,
      metricRequirements: REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS.map((section) => ({
        section,
        status: 'not-run',
        evidenceMode: 'bounded-summary-ref',
        inlineEvidence: 'forbidden',
        summaryRef: `benchmark-summary:${candidate.id}:${section}`,
        requiredFields: candidate.metrics[section].fields.map((field) => ({
          field: field.field,
          unit: field.unit,
          required: field.required,
          source: field.source,
          status: 'not-run',
          resultRef: `benchmark-result:${candidate.id}:${section}:${field.field}`,
        })),
        bounds: {
          maxInlineEvidenceBytes: 0,
          resultValueMode: 'aggregate-summary-only',
          sampleStorage: 'bounded-summary-ref-only',
        },
      })),
    })),
    decisionGate: {
      status: 'blocked',
      selectedAdapterId: null,
      unblocksWhenRefs: [
        'benchmark-result:electron-web-contents-view',
        'benchmark-result:webview2',
        'benchmark-result:wkwebview',
        'benchmark-result:standalone-chromium-surface',
      ],
    },
    verificationCommand: DIRECT_VERIFICATION_COMMAND,
  };
}

function assertPlatformBenchmarkManifest(
  manifest: PlatformBenchmarkManifest,
  comparisonManifest: BrowserNativeAdapterComparisonManifest,
): void {
  assert.equal(manifest.schemaVersion, PLATFORM_BENCHMARK_MANIFEST_SCHEMA);
  assert.equal(manifest.status, 'blocked');
  assert.equal(manifest.platformRunner.status, 'not-run');
  assert.equal(manifest.benchmarkClaim, false);
  assert.equal(manifest.liveSurfaceTransport, 'native-embedded');
  assert.equal(manifest.singleInteractiveTruth, true);
  assert.equal(manifest.secondTruthSource, false);
  assert.equal(manifest.refsFirst, true);
  assert.equal(manifest.payloadPolicy.refsFirst, true);
  assert.equal(manifest.payloadPolicy.maxInlineEvidenceBytes, 0);
  assert.ok(manifest.payloadPolicy.forbiddenInlineEvidenceKinds.includes('raw-dom'));
  assert.ok(manifest.payloadPolicy.forbiddenInlineEvidenceKinds.includes('base64-image'));
  assert.ok(manifest.payloadPolicy.forbiddenInlineEvidenceKinds.includes('screenshot-bytes'));
  assert.ok(manifest.payloadPolicy.forbiddenInlineEvidenceKinds.includes('provider-payload'));
  assert.deepEqual(manifest.requiredMetricSections, REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS);
  assert.deepEqual(manifest.candidateRefs.map((candidate) => candidate.id), [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES]);
  assert.deepEqual(manifest.candidates.map((candidate) => candidate.id), [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES]);
  assert.equal(manifest.platformRunner.optInEnvVar, REAL_RUNNER_OPT_IN_ENV);
  assert.equal(manifest.platformRunner.optInValue, '1');
  assert.equal(manifest.platformRunner.inputManifestRef, platformBenchmarkManifestRef);
  assert.equal(manifest.platformRunner.externalAdapterCommandContract.stdoutSchemaVersion, BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA);
  assert.deepEqual(manifest.platformRunner.externalAdapterCommandContract.injectedEnv, [
    'SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE',
    'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM',
    'SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA',
    'SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON',
  ]);
  assert.deepEqual(manifest.platformRunner.externalAdapterCommandContract.passRequiresAdapterRunProof, {
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
  });
  assert.deepEqual(manifest.platformRunner.externalAdapterCommandContract.passRequiresNestedAdapterCommandProofRefs, {
    candidates: ['wkwebview', 'standalone-chromium-surface'],
    proofKinds: ['policy', 'entrypoint', 'helper-chain', 'live-smoke'],
    boundedRefsOnly: true,
    missingStatus: 'failed',
  });
  assert.deepEqual(manifest.platformRunner.externalAdapterCommandContract.realProofRefusalPolicy, {
    currentProcessPlatform: process.platform,
    unsupportedPlatformStatus: 'blocked',
    missingCommandStatus: 'blocked',
    schemaFixtureStatus: 'blocked',
    failedCommandStatus: 'failed',
    partialPlatformResultsDoNotPass: true,
    passRequiresEveryCandidateRealResult: true,
  });
  assert.deepEqual(
    manifest.platformRunner.externalAdapterCommandContract.perPlatformCommandEnvDocs.map((doc) => doc.candidateId),
    [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES],
  );
  assert.deepEqual(
    manifest.platformRunner.externalAdapterCommandContract.perPlatformCommandEnvDocs.map((doc) => doc.supportedOnCurrentPlatform),
    manifest.platformRunner.externalAdapterCommandContract.perPlatformCommandEnvDocs.map((doc) => platformSupported(doc.platform)),
  );
  assert.equal(manifest.platformRunner.externalAdapterCommandContract.sampleFixture.expectedRunnerStatus, 'blocked');
  assert.equal(manifest.decisionGate.status, 'blocked');
  assert.equal(manifest.decisionGate.selectedAdapterId, null);

  for (const sectionContract of manifest.metricFieldContract) {
    assert.equal(sectionContract.status, 'not-run');
    assert.equal(sectionContract.evidenceMode, 'bounded-summary-ref');
    assert.equal(sectionContract.inlineEvidence, 'forbidden');
    assert.ok(sectionContract.fields.length > 0);
  }

  for (const candidatePlan of manifest.candidates) {
    const comparisonCandidate = comparisonManifest.candidates.find((candidate) => candidate.id === candidatePlan.id);
    assert.ok(comparisonCandidate, `${candidatePlan.id} should come from the comparison manifest`);
    assert.equal(candidatePlan.status, 'blocked');
    assert.equal(candidatePlan.benchmarkClaim, false);
    assert.equal(candidatePlan.liveSurfaceTransport, 'native-embedded');
    assert.equal(candidatePlan.singleInteractiveTruth, true);
    assert.equal(candidatePlan.secondTruthSource, false);
    assert.equal(candidatePlan.candidateRef, candidateRef(candidatePlan.id));
    assert.ok(candidatePlan.comparisonRefs.length > 0);
    assert.deepEqual(candidatePlan.metricRequirements.map((requirement) => requirement.section), REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS);
    const comparisonMetrics = comparisonCandidate.metrics as PlatformBenchmarkComparisonMetrics;
    for (const requirement of candidatePlan.metricRequirements) {
      const comparisonMetric = comparisonMetrics[requirement.section];
      assert.equal(requirement.status, 'not-run');
      assert.equal(requirement.evidenceMode, 'bounded-summary-ref');
      assert.equal(requirement.inlineEvidence, 'forbidden');
      assert.equal(requirement.bounds.maxInlineEvidenceBytes, 0);
      assert.deepEqual(
        requirement.requiredFields.map((field) => field.field),
        comparisonMetric.fields.map((field) => field.field),
      );
      assert.ok(requirement.requiredFields.every((field) => (
        field.required === true
        && field.status === 'not-run'
        && field.resultRef.startsWith(`benchmark-result:${candidatePlan.id}:${requirement.section}:`)
      )));
    }
  }

  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(manifest));
}

async function writePlatformBenchmarkManifest(manifest: PlatformBenchmarkManifest): Promise<void> {
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  assertPlatformBenchmarkArtifactIsBounded(text);
  assert.ok(
    Buffer.byteLength(text, 'utf8') <= MAX_PLATFORM_BENCHMARK_MANIFEST_BYTES,
    'platform benchmark manifest must stay bounded',
  );
  await mkdir(artifactDir, { recursive: true });
  await writeFile(platformBenchmarkManifestPath, text, 'utf8');

  const persistedText = await readFile(platformBenchmarkManifestPath, 'utf8');
  assertPlatformBenchmarkArtifactIsBounded(persistedText);
  const persisted = JSON.parse(persistedText) as PlatformBenchmarkManifest;
  assert.equal(persisted.schemaVersion, PLATFORM_BENCHMARK_MANIFEST_SCHEMA);
  assert.equal(persisted.status, 'blocked');
  assert.equal(persisted.platformRunner.status, 'not-run');
  assert.equal(persisted.candidates.length, REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.length);
  assert.deepEqual(persisted.requiredMetricSections, REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS);
}

function candidateRef(candidateId: BrowserNativeAdapterCandidateId): string {
  return `browser-native-adapter-candidate:${candidateId}`;
}

function adapterEnvName(candidateId: BrowserNativeAdapterCandidateId, suffix: 'COMMAND' | 'ARGS_JSON'): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_${suffix}`;
}

function candidateAvailability(candidate: unknown): {
  helperCommandPresent: boolean;
  realAdapterCommandPresent: boolean;
  availabilityStatus: string;
} | undefined {
  const availability = (candidate as { adapterAvailability?: {
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

function assertCompleteExternalCandidatePass(
  result: BrowserNativeAdapterPlatformBenchmarkExternalResult,
  candidateId: BrowserNativeAdapterCandidateId,
): void {
  assert.equal(result.status, 'passed');
  assert.equal(result.benchmarkClaim, true);
  assert.equal(result.owner, 'BrowserHostSession');
  assert.equal(result.liveSurfaceTransport, 'native-embedded');
  assert.equal(result.singleInteractiveTruth, true);
  assert.equal(result.secondTruthSource, false);
  assert.equal(result.adapterRun?.resultKind, 'real-native-adapter-run');
  assert.equal(result.adapterRun?.realAdapterResult, true);
  assert.equal(result.adapterRun?.rawPayloadsCaptured, false);
  assert.match(result.adapterRun?.browserHostSessionRef ?? '', /^browser-host-session:/);
  assert.equal(
    result.adapterRun?.liveSurfaceRef,
    `${result.adapterRun?.browserHostSessionRef}/live-surface`,
  );
  assert.match(
    result.adapterRun?.nativeAdapterSurfaceRef ?? '',
    new RegExp(`^benchmark-result:${candidateId}:native-adapter-surface:`),
  );
  assert.match(
    result.adapterRun?.actionTraceRef ?? '',
    new RegExp(`^benchmark-result:${candidateId}:action-trace:`),
  );
  assert.match(
    result.adapterRun?.platformResultRef ?? '',
    new RegExp(`^benchmark-result:${candidateId}:platform-summary:`),
  );
  if (candidateId === WKWEBVIEW_FIXTURE_CANDIDATE || candidateId === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE) {
    assertNestedAdapterCommandProofRefs(result.nestedAdapterCommandProofRefs, candidateId);
  }
  for (const section of REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS) {
    const metricSection = result.metricSections?.[section];
    assert.ok(metricSection, `${candidateId} pass result should include metric section ${section}`);
    assert.equal(metricSection.status, 'passed');
    assert.ok(metricSection.resultRefs?.every((ref) => (
      ref.startsWith(`benchmark-result:${candidateId}:${section}:`)
    )));
    assert.ok(metricSection.numericSummary, `${candidateId} ${section} should include bounded numeric summary`);
  }
}

function assertCompleteRunnerCandidatePass(
  candidate: BrowserNativeAdapterPlatformBenchmarkCandidateResult,
  candidateId: BrowserNativeAdapterCandidateId,
): void {
  assert.equal(candidate.status, 'passed');
  assert.equal(candidate.benchmarkClaim, true);
  assert.equal(candidate.realAdapterResult, true);
  assert.equal(candidate.liveSurfaceTransport, 'native-embedded');
  assert.equal(candidate.singleInteractiveTruth, true);
  assert.equal(candidate.secondTruthSource, false);
  assert.equal(candidate.adapterProofRefs.proofMode, 'real-native-adapter-run');
  assert.match(candidate.adapterProofRefs.browserHostSessionRef ?? '', /^browser-host-session:/);
  assert.equal(
    candidate.adapterProofRefs.liveSurfaceRef,
    `${candidate.adapterProofRefs.browserHostSessionRef}/live-surface`,
  );
  assert.match(candidate.adapterRunRef, new RegExp(`^benchmark-result:${candidateId}:platform-summary:`));
  if (candidateId === WKWEBVIEW_FIXTURE_CANDIDATE || candidateId === STANDALONE_CHROMIUM_FIXTURE_CANDIDATE) {
    assertNestedAdapterCommandProofRefs(candidate.adapterProofRefs.nestedAdapterCommandProofRefs, candidateId);
  }
  assert.deepEqual(candidate.metricSections.map((section) => section.section), REQUIRED_REAL_PLATFORM_BENCHMARK_SECTIONS);
  assert.ok(candidate.metricSections.every((section) => section.status === 'passed'));
  assert.ok(candidate.metricSections.every((section) => (
    section.resultRefs.every((ref) => ref.startsWith(`benchmark-result:${candidateId}:${section.section}:`))
  )));
  assert.ok(candidate.metricSections.every((section) => section.numericSummary !== undefined));
  assert.deepEqual(candidate.blockerRefs, []);
}

function assertNestedAdapterCommandProofRefs(
  refs: string[] | undefined,
  candidateId: BrowserNativeAdapterCandidateId,
): void {
  assert.ok(Array.isArray(refs), `${candidateId} pass should include nested adapter command proof refs`);
  for (const proofKind of ['policy', 'entrypoint', 'helper-chain', 'live-smoke']) {
    assert.ok(
      refs.some((ref) => ref.startsWith(`benchmark-result:${candidateId}:nested-real-adapter-command:${proofKind}:`)),
      `${candidateId} nested adapter command proof refs should include ${proofKind}`,
    );
  }
  assert.ok(refs.every((ref) => /^[a-zA-Z0-9_.:/-]{1,240}$/.test(ref)));
}

function platformSupported(platform: BrowserNativeAdapterComparisonManifest['candidates'][number]['platform']): boolean {
  if (platform === 'cross-platform') {
    return true;
  }
  if (platform === 'macos') {
    return process.platform === 'darwin';
  }
  if (platform === 'windows') {
    return process.platform === 'win32';
  }
  return process.platform === 'linux';
}

function buildDesktopNativeLiveAcceptanceFixture(): DesktopBrowserNativeLiveAcceptanceEvidence {
  const sessionId = 'electronExternalRealAdapterRun';
  const targetUrl = 'http://127.0.0.1:34567/native-live';
  const nativeAdapterUrl = 'http://127.0.0.1:45678';
  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
    status: 'passed',
    source: 'desktop-native-browser-pane-smoke',
    observedAt: '2026-06-02T00:00:02.250Z',
    canClaimDesktopNativeLivePass: true,
    claimScope: 'desktop-native-embedded-browser-pane-live',
    desktopLaunch: {
      mode: 'production-electron',
      mainPathRef: 'desktop-launch-main:1111111111111111',
      rendererPathRef: 'desktop-launch-renderer:2222222222222222',
      rendererUrl: { length: 36, hash: '3333333333333333' },
    },
    nativeAdapter: {
      endpoint: { length: nativeAdapterUrl.length, hash: '4444444444444444', loopbackHttp: true },
      healthOk: true,
      service: 'sciforge-desktop-browser-native-adapter',
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      liveSurfaceTransport: 'native-embedded',
      secondTruthSource: false,
      audit: {
        schemaVersion: 'sciforge.desktop.native-browser-surface-audit.v1',
        stateRequests: 2,
        screenshotRequests: 0,
        frameStreamRequests: 0,
        actionRequests: 2,
        recentRequestCount: 4,
      },
    },
    browserHostSession: {
      id: sessionId,
      owner: 'BrowserHostSession',
      providerId: 'desktop-native-browser-host-provider',
      status: 'ready',
      requestedUrl: { length: targetUrl.length, hash: '5555555555555555' },
      url: { length: targetUrl.length, hash: '6666666666666666' },
      liveSurfaceTransport: 'native-embedded',
      nativeAdapterEndpoint: { length: nativeAdapterUrl.length, hash: '4444444444444444', loopbackHttp: true },
      singleInteractiveTruth: true,
      frameStreamRefPresent: false,
      frameRefPresent: false,
      frameUrlPresent: false,
    },
    surface: {
      ok: true,
      owner: 'BrowserHostSession',
      adapterRole: 'display-input-adapter',
      surface: 'electron-web-contents-view',
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      embedded: true,
      secondTruthSource: false,
      visible: true,
      loading: false,
      bounds: {
        x: 240,
        y: 120,
        width: 960,
        height: 640,
      },
    },
    interaction: {
      targetUrl: { length: targetUrl.length, hash: '5555555555555555' },
      typedTokenObserved: true,
      textProbe: 'native-adapter-text-endpoint',
      actionTimingTransport: 'native-embedded',
      paintAckSource: 'native-adapter-action-state',
      actionAck: {
        action: 'click',
        capture: 'none',
        status: 'ok',
        screenshotRequestsDuringAck: 0,
        frameStreamRequestsDuringAck: 0,
        dependsOnScreenshot: false,
        dependsOnFrameStream: false,
        evidenceCaptureStarted: false,
        evidenceCaptureEnded: false,
      },
      stateHeartbeat: {
        source: 'native-adapter-state-endpoint',
        url: { length: targetUrl.length, hash: '6666666666666666' },
        urlMatchesTarget: true,
        title: 'Native Live Fixture',
        loading: false,
        canGoBack: false,
        canGoForward: false,
        browserHostStatus: 'ready',
        stateRequestsAfterAction: 1,
        lightweightStateUpdated: true,
      },
    },
    rejectedDesktopLiveSubstitutes: rejectedDesktopLiveSubstitutes(),
    m0SurfingLoop: buildDesktopNativeM0SurfingLoopFixture(sessionId),
    benchmarkMetrics: {
      schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.benchmark-metrics.v1',
      source: 'desktop-native-browser-pane-smoke',
      evidenceMode: 'bounded-summary-ref',
      inlineEvidence: 'forbidden',
      metricSections: {
        latency: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:latency:realrun',
          numericSummary: {
            openAckMs: 240,
            navigationAckMs: 320,
            inputAckMs: 18,
            paintAckLagMs: 21,
            p95ActionAckMs: 44,
          },
        },
        cpu: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:cpu:realrun',
          numericSummary: {
            processCpuAveragePercent: 3.5,
            processCpuP95Percent: 8,
            sampleCount: 2,
          },
        },
        memory: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:memory:realrun',
          numericSummary: {
            rssMb: 180,
            heapUsedMb: 52,
            nativeSurfaceMb: 2.34,
            peakRssMb: 190,
          },
        },
        inputCompleteness: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:inputCompleteness:realrun',
          numericSummary: {
            keyboard: true,
            textEditing: true,
            pointerClick: true,
            drag: true,
            scroll: true,
            navigationControls: true,
          },
        },
        lifecycle: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:lifecycle:realrun',
          numericSummary: {
            open: true,
            navigationStart: true,
            navigationCommitted: true,
            interactive: true,
            load: true,
            networkQuiet: true,
            blocked: true,
            retry: true,
            close: true,
          },
        },
        reconnect: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:reconnect:realrun',
          numericSummary: {
            disconnectDetected: true,
            sameBrowserHostSessionOwner: true,
            stateHeartbeatRestored: true,
            inputRoutedAfterReconnect: true,
          },
        },
        streamQuality: {
          status: 'passed',
          resultRef: 'benchmark-result:electron-web-contents-view:streamQuality:realrun',
          numericSummary: {
            latencyP50Ms: 21,
            latencyP95Ms: 48,
            framerateAvgFps: 59,
            framerateP5Fps: 52,
            inputToFrameP50Ms: 26,
            inputToFrameP95Ms: 63,
            reconnectP50Ms: 180,
            reconnectP95Ms: 420,
            sampleCount: 32,
            fallbackRequired: false,
          },
        },
      },
    },
    verificationCommand: 'npm run smoke:desktop-browser-native-live-acceptance --silent',
    strictVerificationCommand: 'SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 npm run smoke:desktop-browser-native-live-acceptance --silent',
  };
}

function buildDesktopNativeM0SurfingLoopFixture(
  sessionId: string,
): NonNullable<DesktopBrowserNativeLiveAcceptanceEvidence['m0SurfingLoop']> {
  const actionEvidence = (action: DesktopBrowserNativeM0Action, latencyMs = 12) => ({
    status: 'passed' as const,
    latencyMs,
    resultRef: `browser-host-session:${sessionId}/m0/${action}`,
  });
  return {
    schemaVersion: DESKTOP_BROWSER_NATIVE_M0_SURFING_LOOP_SCHEMA,
    status: 'passed',
    claimScope: 'desktop-native-m0-surfing-loop',
    passClaim: true,
    shell: 'desktop-right-pane',
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    refsFirst: true,
    evidenceMode: 'bounded-refs-and-summaries',
    sessionRef: `browser-host-session:${sessionId}`,
    liveSurfaceRef: `browser-host-session:${sessionId}/live-surface`,
    nativeAdapterRef: 'native-adapter:loopback:0123456789abcdef',
    surfaceRef: 'desktop-native-surface:electron-web-contents-view:fedcba9876543210',
    transport: {
      liveSurfaceTransport: 'native-embedded',
      frameTransport: 'native-embedded',
      surfaceType: 'electron-web-contents-view',
    },
    health: {
      nativeAdapterHealthOk: true,
      nativeAdapterService: 'sciforge-desktop-browser-native-adapter',
      nativeStateHeartbeat: true,
      actionAckSource: 'native-adapter-action-state',
    },
    urlEvidence: {
      requested: { length: 34, hash: 'aaaaaaaaaaaaaaaa' },
      final: { length: 34, hash: 'bbbbbbbbbbbbbbbb' },
      rawUrlCaptured: false,
    },
    actionCoverage: {
      open: actionEvidence('open', 240),
      click: actionEvidence('click', 12),
      type: {
        ...actionEvidence('type', 18),
        textLength: 28,
        textHash: 'cccccccccccccccc',
      },
      scroll: actionEvidence('scroll', 14),
      drag: actionEvidence('drag', 22),
      reload: actionEvidence('reload', 90),
      back: actionEvidence('back', 24),
      forward: actionEvidence('forward', 26),
      stop: actionEvidence('stop', 10),
    },
    inputHotPath: {
      dependsOnScreenshot: false,
      dependsOnFrameStream: false,
      screenshotRequestsDuringAck: 0,
      frameStreamRequestsDuringAck: 0,
    },
    singleInteractiveTruth: true,
    secondTruthSource: false,
    noLegacyFallback: {
      hostStream: false,
      canvas: false,
      webRtc: false,
      httpFrame: false,
      snapshot: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      externalBrowser: false,
    },
    payloadPolicy: {
      rawDom: false,
      rawLogs: false,
      rawScreenshot: false,
      base64: false,
      providerPayload: false,
      secret: false,
    },
    coverageGaps: [],
  };
}

function buildExternalAdapterFixtureArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'blocked',
  resultRefs: [
    'schema-fixture-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
  numericSummary: {
    sampleCount: 1,
    schemaFixtureOnly: true,
  },
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'schema-validation-only',
    realAdapterResult: false,
    liveSurfaceTransport: 'native-embedded',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'blocked',
  benchmarkClaim: false,
  metricSections,
  diagnosticRefs: ['fixture:schema-validation-only-no-real-native-adapter-benchmark'],
}));
`;
  return ['-e', fixtureSource];
}

function buildRealAdapterCommandArgs(): string[] {
  return ['-e', buildRealAdapterCommandScriptSource()];
}

function buildRealAdapterCommandScriptSource(options: {
  includeNestedAdapterCommandProofRefs?: boolean;
} = {}): string {
  const nestedProofRefsSource = options.includeNestedAdapterCommandProofRefs
    ? `[
    'benchmark-result:' + candidateId + ':nested-real-adapter-command:policy:' + proofSuffix,
    'benchmark-result:' + candidateId + ':nested-real-adapter-command:entrypoint:' + proofSuffix,
    'benchmark-result:' + candidateId + ':nested-real-adapter-command:helper-chain:' + proofSuffix,
    'benchmark-result:' + candidateId + ':nested-real-adapter-command:live-smoke:' + proofSuffix,
  ]`
    : 'undefined';
  return `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const proofSuffix = 'measured-run';
const browserHostSessionRef = 'browser-host-session:' + candidateId + '-measured-run';
const nestedAdapterCommandProofRefs = ${nestedProofRefsSource};
const summaryBySection = {
  latency: {
    openAckMs: 11,
    navigationAckMs: 23,
    inputAckMs: 5,
    paintAckLagMs: 13,
    p95ActionAckMs: 27,
  },
  cpu: {
    processCpuAveragePercent: 2,
    processCpuP95Percent: 7,
    sampleCount: 18,
  },
  memory: {
    rssMb: 118,
    heapUsedMb: 41,
    nativeSurfaceMb: 31,
    peakRssMb: 124,
  },
  inputCompleteness: {
    keyboard: true,
    textEditing: true,
    pointerClick: true,
    drag: true,
    scroll: true,
    navigationControls: true,
  },
  lifecycle: {
    open: true,
    navigationStart: true,
    navigationCommitted: true,
    interactive: true,
    load: true,
    networkQuiet: true,
    blocked: true,
    retry: true,
    close: true,
  },
  reconnect: {
    disconnectDetected: true,
    sameBrowserHostSessionOwner: true,
    stateHeartbeatRestored: true,
    inputRoutedAfterReconnect: true,
  },
  streamQuality: {
    latencyP50Ms: 11,
    latencyP95Ms: 28,
    framerateAvgFps: 60,
    framerateP5Fps: 55,
    inputToFrameP50Ms: 14,
    inputToFrameP95Ms: 32,
    reconnectP50Ms: 120,
    reconnectP95Ms: 260,
    sampleCount: 18,
    fallbackRequired: false,
  },
};
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':' + proofSuffix,
  ],
  numericSummary: summaryBySection[section],
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef,
    liveSurfaceRef: browserHostSessionRef + '/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface:' + proofSuffix,
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace:' + proofSuffix,
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary:' + proofSuffix,
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  ...(nestedAdapterCommandProofRefs ? { nestedAdapterCommandProofRefs } : {}),
  metricSections,
  diagnosticRefs: [
    'benchmark-result:' + candidateId + ':real-command-bounded-summary',
  ],
}));
`;
}

function buildFalsePassWithoutRealAdapterProofArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
  numericSummary: {
    sampleCount: 1,
  },
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['fixture:false-pass-missing-real-native-adapter-proof'],
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithFixtureMetricRefsArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'schema-fixture-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
  numericSummary: {
    sampleCount: 1,
  },
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-metric-ref-proof',
    liveSurfaceRef: 'browser-host-session:native-adapter-metric-ref-proof/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-non-real-metric-refs'],
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithPartialAdapterProofRefsArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
  numericSummary: {
    sampleCount: 1,
  },
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-proof-run',
    liveSurfaceRef: 'browser-host-session:native-adapter-proof-run/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface:partial',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace:schema-only',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary:no-real-native-adapter',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-partial-adapter-proof-refs'],
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithLegacyEvidenceArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const summaryBySection = {
  latency: {
    openAckMs: 10,
    navigationAckMs: 20,
    inputAckMs: 4,
    paintAckLagMs: 12,
    p95ActionAckMs: 25,
  },
  cpu: {
    processCpuAveragePercent: 3,
    processCpuP95Percent: 8,
    sampleCount: 30,
  },
  memory: {
    rssMb: 120,
    heapUsedMb: 40,
    nativeSurfaceMb: 35,
    peakRssMb: 130,
  },
  inputCompleteness: {
    keyboard: true,
    textEditing: true,
    pointerClick: true,
    drag: true,
    scroll: true,
    navigationControls: true,
  },
  lifecycle: {
    open: true,
    navigationStart: true,
    navigationCommitted: true,
    interactive: true,
    load: true,
    networkQuiet: true,
    blocked: true,
    retry: true,
    close: true,
  },
  reconnect: {
    disconnectDetected: true,
    sameBrowserHostSessionOwner: true,
    stateHeartbeatRestored: true,
    inputRoutedAfterReconnect: true,
  },
  streamQuality: {
    latencyP50Ms: 12,
    latencyP95Ms: 30,
    framerateAvgFps: 59,
    framerateP5Fps: 54,
    inputToFrameP50Ms: 16,
    inputToFrameP95Ms: 35,
    reconnectP50Ms: 140,
    reconnectP95Ms: 280,
    sampleCount: 30,
    fallbackRequired: false,
  },
};
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':frame-stream',
  ],
  numericSummary: summaryBySection[section],
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-legacy-proof-run',
    liveSurfaceRef: 'browser-host-session:native-adapter-legacy-proof-run/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface:canvas-binary',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace:webrtc',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary:frame-stream',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-pass-with-legacy-frame-stream-canvas-webrtc'],
}));
`;
  return ['-e', fixtureSource];
}

function buildStandaloneProcessSecondTruthPassArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE || 'standalone-chromium-surface';
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM || 'cross-platform';
const summaryBySection = {
  latency: {
    openAckMs: 10,
    navigationAckMs: 20,
    inputAckMs: 4,
    paintAckLagMs: 12,
    p95ActionAckMs: 25,
  },
  cpu: {
    processCpuAveragePercent: 3,
    processCpuP95Percent: 8,
    sampleCount: 30,
  },
  memory: {
    rssMb: 120,
    heapUsedMb: 40,
    nativeSurfaceMb: 35,
    peakRssMb: 130,
  },
  inputCompleteness: {
    keyboard: true,
    textEditing: true,
    pointerClick: true,
    drag: true,
    scroll: true,
    navigationControls: true,
  },
  lifecycle: {
    open: true,
    navigationStart: true,
    navigationCommitted: true,
    interactive: true,
    load: true,
    networkQuiet: true,
    blocked: true,
    retry: true,
    close: true,
  },
  reconnect: {
    disconnectDetected: true,
    sameBrowserHostSessionOwner: true,
    stateHeartbeatRestored: true,
    inputRoutedAfterReconnect: true,
  },
  streamQuality: {
    latencyP50Ms: 10,
    latencyP95Ms: 24,
    framerateAvgFps: 60,
    framerateP5Fps: 56,
    inputToFrameP50Ms: 13,
    inputToFrameP95Ms: 29,
    reconnectP50Ms: 115,
    reconnectP95Ms: 240,
    sampleCount: 24,
    fallbackRequired: false,
  },
};
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':standalone-process-without-native-embedder',
  ],
  numericSummary: summaryBySection[section],
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA || 'sciforge.browser-native-adapter-platform-benchmark-external-result.v1',
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:standalone-second-viewer-proof',
    liveSurfaceRef: 'browser-host-session:standalone-second-viewer-proof/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface:standalone-process-without-native-embedder',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace:external-browser',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary:second-viewer',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-standalone-process-without-native-embedder'],
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithForbiddenRawFieldsArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
  numericSummary: {
    sampleCount: 1,
  },
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-raw-field-proof',
    liveSurfaceRef: 'browser-host-session:native-adapter-raw-field-proof/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface:raw-field',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace:raw-field',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary:raw-field',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-raw-field-pass'],
  screenshot: 'raw-screenshot-pixels-must-not-persist',
  provider: 'raw-provider-payload-must-not-persist',
  payload: 'raw-inline-payload-must-not-persist',
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithRawUrlStringArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const summaryBySection = {
  latency: {
    openAckMs: 10,
    navigationAckMs: 20,
    inputAckMs: 4,
    paintAckLagMs: 12,
    p95ActionAckMs: 25,
  },
  cpu: {
    processCpuAveragePercent: 3,
    processCpuP95Percent: 8,
    sampleCount: 30,
  },
  memory: {
    rssMb: 120,
    heapUsedMb: 40,
    nativeSurfaceMb: 35,
    peakRssMb: 130,
  },
  inputCompleteness: {
    keyboard: true,
    textEditing: true,
    pointerClick: true,
    drag: true,
    scroll: true,
    navigationControls: true,
  },
  lifecycle: {
    open: true,
    navigationStart: true,
    navigationCommitted: true,
    interactive: true,
    load: true,
    networkQuiet: true,
    blocked: true,
    retry: true,
    close: true,
  },
  reconnect: {
    disconnectDetected: true,
    sameBrowserHostSessionOwner: true,
    stateHeartbeatRestored: true,
    inputRoutedAfterReconnect: true,
  },
  streamQuality: {
    latencyP50Ms: 10,
    latencyP95Ms: 24,
    framerateAvgFps: 60,
    framerateP5Fps: 56,
    inputToFrameP50Ms: 13,
    inputToFrameP95Ms: 29,
    reconnectP50Ms: 115,
    reconnectP95Ms: 240,
    sampleCount: 24,
    fallbackRequired: false,
  },
};
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':bounded-run',
  ],
  numericSummary: summaryBySection[section],
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-raw-string-proof',
    liveSurfaceRef: 'browser-host-session:native-adapter-raw-string-proof/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface:bounded-run',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace:bounded-run',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary:bounded-run',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: [
    'benchmark-result:' + candidateId + ':attempted-pass-with-raw-url-string',
    'https://example.invalid/raw-diagnostic-must-not-persist',
  ],
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithoutMetricSummariesArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-summary-proof-run',
    liveSurfaceRef: 'browser-host-session:native-adapter-summary-proof-run/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-pass-without-metric-summary'],
}));
`;
  return ['-e', fixtureSource];
}

function buildFalsePassWithWrongTypeMetricSummariesArgs(): string[] {
  const fixtureSource = `
const sections = JSON.parse(process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON || '[]');
const candidateId = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
const platform = process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
const summaryBySection = {
  latency: {
    openAckMs: true,
    navigationAckMs: true,
    inputAckMs: true,
    paintAckLagMs: true,
    p95ActionAckMs: true,
  },
  cpu: {
    processCpuAveragePercent: true,
    processCpuP95Percent: true,
    sampleCount: true,
  },
  memory: {
    rssMb: true,
    heapUsedMb: true,
    nativeSurfaceMb: true,
    peakRssMb: true,
  },
  inputCompleteness: {
    keyboard: 1,
    textEditing: 1,
    pointerClick: 1,
    drag: 1,
    scroll: 1,
    navigationControls: 1,
  },
  lifecycle: {
    open: 1,
    navigationStart: 1,
    navigationCommitted: 1,
    interactive: 1,
    load: 1,
    networkQuiet: 1,
    blocked: 1,
    retry: 1,
    close: 1,
  },
  reconnect: {
    disconnectDetected: 1,
    sameBrowserHostSessionOwner: 1,
    stateHeartbeatRestored: 1,
    inputRoutedAfterReconnect: 1,
  },
};
const metricSections = Object.fromEntries(sections.map((section) => [section, {
  status: 'passed',
  resultRefs: [
    'benchmark-result:' + candidateId + ':' + section + ':bounded-summary',
  ],
  numericSummary: summaryBySection[section],
}]));
process.stdout.write(JSON.stringify({
  schemaVersion: process.env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA,
  candidateId,
  platform,
  owner: 'BrowserHostSession',
  liveSurfaceTransport: 'native-embedded',
  singleInteractiveTruth: true,
  secondTruthSource: false,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
    liveSurfaceTransport: 'native-embedded',
    browserHostSessionRef: 'browser-host-session:native-adapter-wrong-summary-proof-run',
    liveSurfaceRef: 'browser-host-session:native-adapter-wrong-summary-proof-run/live-surface',
    nativeAdapterSurfaceRef: 'benchmark-result:' + candidateId + ':native-adapter-surface',
    actionTraceRef: 'benchmark-result:' + candidateId + ':action-trace',
    platformResultRef: 'benchmark-result:' + candidateId + ':platform-summary',
    secondTruthSource: false,
    rawPayloadsCaptured: false,
  },
  status: 'passed',
  benchmarkClaim: true,
  metricSections,
  diagnosticRefs: ['benchmark-result:' + candidateId + ':attempted-pass-with-wrong-metric-summary-types'],
}));
`;
  return ['-e', fixtureSource];
}

function assertPlatformBenchmarkArtifactIsBounded(text: string): void {
  assert.doesNotMatch(text, /data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i);
  assert.doesNotMatch(text, /https?:\/\//i);
  assert.doesNotMatch(text, /"(?:rawUrl|url|requestedUrl|currentUrl|finalUrl|rawDom|dom|domSnapshot|screenshot|rawScreenshot|screenshotBase64|screenshotBytes|clipboard|selection|menu|provider|payload|rawPayload|providerPayload|consoleLog|networkLog|secret|token|password|credential|cookie|authorization|apiKey)"\s*:/i);
  assert.doesNotMatch(text, /"payload"\s*:\s*"(?:\{|<|data:)/i);
}

function fakeTsxPassScriptSource() {
  return `#!/usr/bin/env node\n${buildRealAdapterCommandScriptSource()}`;
}
