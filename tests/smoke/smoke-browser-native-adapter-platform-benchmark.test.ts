import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS,
  buildBrowserNativeAdapterComparisonManifest,
  validateBrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterCandidateId,
  type BrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterMetricFieldContract,
  type BrowserNativeAdapterMetricSection,
} from '../../src/desktop/browser-native-adapter-comparison.js';
import {
  DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE_SCHEMA,
  rejectedDesktopLiveSubstitutes,
  type DesktopBrowserNativeLiveAcceptanceEvidence,
} from '../../src/desktop/desktop-browser-native-live-acceptance.js';
import {
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA,
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV,
  DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
  runBrowserNativeAdapterPlatformBenchmark,
} from '../../tools/browser-native-adapter-platform-benchmark-runner.js';
import {
  ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV,
} from '../../tools/browser-native-adapter-electron-web-contents-view-external-result.js';

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

type RealPlatformBenchmarkMetricSection = Exclude<BrowserNativeAdapterMetricSection, 'secondTruthSource'>;
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
        requiredRefs: string[];
        forbiddenResultKinds: Array<'schema-validation-only'>;
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
  REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS.filter(isRealPlatformBenchmarkMetricSection);

test('browser native adapter platform benchmark manifest is opt-in, refs-first, and not-run by default', async () => {
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
    outputPath: DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
    now: '2026-06-02T00:00:00.000Z',
  });
  assert.equal(defaultRunnerResult.schemaVersion, BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA);
  assert.equal(defaultRunnerResult.status, 'blocked');
  assert.equal(defaultRunnerResult.benchmarkClaim, false);
  assert.equal(defaultRunnerResult.runner.status, 'not-run');
  assert.equal(defaultRunnerResult.runner.optIn, false);
  assert.equal(defaultRunnerResult.owner, 'BrowserHostSession');
  assert.equal(defaultRunnerResult.singleInteractiveTruth, true);
  assert.ok(defaultRunnerResult.candidates.every((candidate) => candidate.status === 'blocked'));
  assert.ok(defaultRunnerResult.candidates.every((candidate) => candidate.benchmarkClaim === false));
  assert.ok(defaultRunnerResult.candidates.every((candidate) => (
    candidate.blockerRefs.includes(`env:${REAL_RUNNER_OPT_IN_ENV}:not-set`)
  )));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(defaultRunnerResult));
  assert.equal(defaultRunnerResult.resultRef, DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF);

  const optInBlockedRunnerResult = await runBrowserNativeAdapterPlatformBenchmark({
    env: { [REAL_RUNNER_OPT_IN_ENV]: '1' },
    inputManifestPath: platformBenchmarkManifestRef,
    outputPath: DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
    now: '2026-06-02T00:00:01.000Z',
  });
  assert.equal(optInBlockedRunnerResult.status, 'blocked');
  assert.equal(optInBlockedRunnerResult.benchmarkClaim, false);
  assert.equal(optInBlockedRunnerResult.runner.status, 'blocked');
  assert.equal(optInBlockedRunnerResult.runner.optIn, true);
  assert.ok(optInBlockedRunnerResult.candidates.some((candidate) => (
    candidate.blockerRefs.some((ref) => ref.includes(':missing-real-adapter-command'))
  )));
  assert.ok(optInBlockedRunnerResult.decisionGate.status === 'blocked');
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(optInBlockedRunnerResult));

  const persistedResultText = await readFile(platformBenchmarkResultPath, 'utf8');
  assertPlatformBenchmarkArtifactIsBounded(persistedResultText);
  const persistedResult = JSON.parse(persistedResultText) as typeof optInBlockedRunnerResult;
  assert.equal(persistedResult.schemaVersion, BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA);
  assert.equal(persistedResult.status, 'blocked');
  assert.equal(persistedResult.benchmarkClaim, false);
});

test('browser native adapter platform benchmark runner validates sample external adapter stdout schema', async () => {
  const tempDir = await mkdtemp(join(tmpdir(), 'sciforge-native-adapter-benchmark-'));
  const fixtureOutputPath = join(tempDir, 'schema-fixture-results.json');
  const electronExternalOutputPath = join(tempDir, 'electron-external-results.json');
  const electronLiveEvidencePath = join(tempDir, 'electron-native-live-evidence.json');
  const invalidSchemaOutputPath = join(tempDir, 'invalid-schema-results.json');
  const falsePassOutputPath = join(tempDir, 'false-pass-results.json');
  const partialProofRefsFalsePassOutputPath = join(tempDir, 'partial-proof-refs-false-pass-results.json');
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
  assert.equal(
    fixtureResult.externalAdapterCommandContract.perCandidateCommandEnv[EXTERNAL_FIXTURE_CANDIDATE].commandEnv,
    'SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_WEB_CONTENTS_VIEW_COMMAND',
  );

  const fixtureCandidate = fixtureResult.candidates.find((candidate) => candidate.id === EXTERNAL_FIXTURE_CANDIDATE);
  assert.ok(fixtureCandidate, 'fixture candidate result should be present');
  assert.equal(fixtureCandidate.status, 'blocked');
  assert.equal(fixtureCandidate.benchmarkClaim, false);
  assert.equal(fixtureCandidate.realAdapterResult, false);
  assert.ok(fixtureCandidate.blockerRefs.some((ref) => ref.includes('schema-validation-only-not-a-benchmark')));
  assert.ok(fixtureCandidate.metricSections.every((section) => section.status === 'blocked'));
  assert.ok(fixtureCandidate.metricSections.every((section) => (
    section.resultRefs.every((ref) => ref.startsWith(`schema-fixture-result:${EXTERNAL_FIXTURE_CANDIDATE}:`))
  )));
  assert.ok(fixtureResult.candidates.some((candidate) => candidate.id !== EXTERNAL_FIXTURE_CANDIDATE && candidate.status === 'blocked'));
  assert.equal(fixtureResult.decisionGate.status, 'blocked');
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(fixtureResult));

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
  assert.equal(electronExternalCandidate.realAdapterResult, true);
  assert.equal(electronExternalCandidate.adapterProofRefs.proofMode, 'real-native-adapter-run');
  assert.match(electronExternalCandidate.adapterProofRefs.browserHostSessionRef ?? '', /^browser-host-session:/);
  assert.match(electronExternalCandidate.adapterProofRefs.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  assert.match(electronExternalCandidate.adapterRunRef, /^benchmark-result:electron-web-contents-view:platform-summary:/);
  assert.ok(electronExternalCandidate.metricSections.every((section) => section.status === 'blocked'));
  assert.ok(electronExternalCandidate.metricSections.every((section) => (
    section.resultRefs.every((ref) => ref.startsWith(`benchmark-result:${EXTERNAL_FIXTURE_CANDIDATE}:${section.section}:`))
  )));
  assert.ok(electronExternalCandidate.blockerRefs.includes(`benchmark-result:${EXTERNAL_FIXTURE_CANDIDATE}:missing-required-metric-section-results`));
  assert.ok(!electronExternalCandidate.blockerRefs.includes(`benchmark-result:${EXTERNAL_FIXTURE_CANDIDATE}:missing-real-native-adapter-result`));
  assert.ok(electronExternalResult.candidates.some((candidate) => candidate.id !== EXTERNAL_FIXTURE_CANDIDATE && candidate.status === 'blocked'));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(electronExternalResult));

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
  assert.ok(partialProofRefsCandidate.diagnosticRefs.some((ref) => ref.includes('real native adapter result proof')));
  assertPlatformBenchmarkArtifactIsBounded(JSON.stringify(partialProofRefsFalsePassResult));

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
          requiredRefs: [
            'browser-host-session:<id>',
            'browser-host-session:<id>/live-surface',
            'benchmark-result:<candidate>:native-adapter-surface',
            'benchmark-result:<candidate>:action-trace',
            'benchmark-result:<candidate>:platform-summary',
          ],
          forbiddenResultKinds: ['schema-validation-only'],
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
    requiredRefs: [
      'browser-host-session:<id>',
      'browser-host-session:<id>/live-surface',
      'benchmark-result:<candidate>:native-adapter-surface',
      'benchmark-result:<candidate>:action-trace',
      'benchmark-result:<candidate>:platform-summary',
    ],
    forbiddenResultKinds: ['schema-validation-only'],
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

function isRealPlatformBenchmarkMetricSection(
  section: BrowserNativeAdapterMetricSection,
): section is RealPlatformBenchmarkMetricSection {
  return section !== 'secondTruthSource';
}

function candidateRef(candidateId: BrowserNativeAdapterCandidateId): string {
  return `browser-native-adapter-candidate:${candidateId}`;
}

function adapterEnvName(candidateId: BrowserNativeAdapterCandidateId, suffix: 'COMMAND' | 'ARGS_JSON'): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_${suffix}`;
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
      mainPath: 'dist-desktop/src/desktop/main.js',
      rendererPath: 'dist-ui/index.html',
      rendererUrl: 'file:///bounded/renderer/index.html',
    },
    nativeAdapter: {
      url: nativeAdapterUrl,
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
      requestedUrl: targetUrl,
      url: targetUrl,
      liveSurfaceTransport: 'native-embedded',
      nativeAdapterUrl,
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
      targetUrl,
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
        url: targetUrl,
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
    verificationCommand: 'npm run smoke:desktop-browser-native-live-acceptance --silent',
    strictVerificationCommand: 'SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 npm run smoke:desktop-browser-native-live-acceptance --silent',
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
  singleInteractiveTruth: true,
  adapterRun: {
    resultKind: 'schema-validation-only',
    realAdapterResult: false,
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
  singleInteractiveTruth: true,
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
  singleInteractiveTruth: true,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
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
  singleInteractiveTruth: true,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
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
  singleInteractiveTruth: true,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
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
  singleInteractiveTruth: true,
  adapterRun: {
    resultKind: 'real-native-adapter-run',
    realAdapterResult: true,
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
  assert.doesNotMatch(text, /"(?:rawDom|domSnapshot|screenshotBase64|providerPayload|consoleLog|networkLog)"\s*:/i);
  assert.doesNotMatch(text, /"payload"\s*:\s*"(?:\{|<|data:)/i);
}
