import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  type BrowserNativeAdapterCandidateId,
  type BrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterMetricSection,
  type BrowserNativeAdapterPlatform,
} from '../src/desktop/browser-native-adapter-comparison.js';

const execFileAsync = promisify(execFile);

export const BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA =
  'sciforge.browser-native-adapter-platform-benchmark-results.v1' as const;
export const BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA =
  'sciforge.browser-native-adapter-platform-benchmark-external-result.v1' as const;
export const BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV =
  'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK' as const;
export const DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_MANIFEST_REF =
  'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-manifest.json';
export const DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF =
  'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-results.json';

const MAX_RESULT_BYTES = 96_000;
const DEFAULT_ADAPTER_TIMEOUT_MS = 120_000;
const REAL_METRIC_SECTIONS = [
  'latency',
  'cpu',
  'memory',
  'inputCompleteness',
  'lifecycle',
  'reconnect',
] as const satisfies ReadonlyArray<Exclude<BrowserNativeAdapterMetricSection, 'secondTruthSource'>>;

type EnvRecord = Record<string, string | undefined>;
type RunnerCandidateStatus = 'passed' | 'blocked' | 'failed';
type RunnerStatus = 'passed' | 'blocked' | 'failed' | 'not-run';
type RealMetricSection = typeof REAL_METRIC_SECTIONS[number];

const REQUIRED_REAL_METRIC_SUMMARY_KEYS = {
  latency: [
    'openAckMs',
    'navigationAckMs',
    'inputAckMs',
    'paintAckLagMs',
    'p95ActionAckMs',
  ],
  cpu: [
    'processCpuAveragePercent',
    'processCpuP95Percent',
    'sampleCount',
  ],
  memory: [
    'rssMb',
    'heapUsedMb',
    'nativeSurfaceMb',
    'peakRssMb',
  ],
  inputCompleteness: [
    'keyboard',
    'textEditing',
    'pointerClick',
    'drag',
    'scroll',
    'navigationControls',
  ],
  lifecycle: [
    'open',
    'navigationStart',
    'navigationCommitted',
    'interactive',
    'load',
    'networkQuiet',
    'blocked',
    'retry',
    'close',
  ],
  reconnect: [
    'disconnectDetected',
    'sameBrowserHostSessionOwner',
    'stateHeartbeatRestored',
    'inputRoutedAfterReconnect',
  ],
} as const satisfies Record<RealMetricSection, readonly string[]>;
const REQUIRED_REAL_METRIC_SUMMARY_TYPES = {
  latency: 'number',
  cpu: 'number',
  memory: 'number',
  inputCompleteness: 'boolean',
  lifecycle: 'boolean',
  reconnect: 'boolean',
} as const satisfies Record<RealMetricSection, 'number' | 'boolean'>;

export type BrowserNativeAdapterPlatformBenchmarkExternalSection = {
  status?: RunnerCandidateStatus;
  resultRefs?: string[];
  numericSummary?: Record<string, number | boolean>;
};

export type BrowserNativeAdapterPlatformBenchmarkExternalAdapterRun = {
  resultKind?: 'real-native-adapter-run' | 'schema-validation-only';
  realAdapterResult?: boolean;
  browserHostSessionRef?: string;
  liveSurfaceRef?: string;
  nativeAdapterSurfaceRef?: string;
  actionTraceRef?: string;
  platformResultRef?: string;
  secondTruthSource?: false;
  rawPayloadsCaptured?: false;
};

export type BrowserNativeAdapterPlatformBenchmarkExternalResult = {
  schemaVersion?: typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA;
  candidateId?: BrowserNativeAdapterCandidateId;
  platform?: BrowserNativeAdapterPlatform;
  owner?: 'BrowserHostSession';
  singleInteractiveTruth?: true;
  adapterRun?: BrowserNativeAdapterPlatformBenchmarkExternalAdapterRun;
  status?: RunnerCandidateStatus;
  benchmarkClaim?: boolean;
  metricSections?: Partial<Record<RealMetricSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>>;
  diagnosticRefs?: string[];
};

export type BrowserNativeAdapterPlatformBenchmarkCandidateResult = {
  id: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  status: RunnerCandidateStatus;
  benchmarkClaim: boolean;
  realAdapterResult: boolean;
  supportedOnCurrentPlatform: boolean;
  adapterCommandRef: string;
  adapterRunRef: string;
  adapterProofRefs: {
    proofMode: 'real-native-adapter-run' | 'blocked-or-invalid';
    browserHostSessionRef: string | null;
    liveSurfaceRef: string | null;
    nativeAdapterSurfaceRef: string | null;
    actionTraceRef: string | null;
    platformResultRef: string | null;
  };
  metricSections: Array<{
    section: RealMetricSection;
    status: RunnerCandidateStatus;
    evidenceMode: 'bounded-summary-ref';
    inlineEvidence: 'forbidden';
    resultRefs: string[];
    numericSummary?: Record<string, number | boolean>;
  }>;
  blockerRefs: string[];
  diagnosticRefs: string[];
};

export type BrowserNativeAdapterPlatformBenchmarkResult = {
  schemaVersion: typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA;
  manifestRef: string;
  resultRef: string;
  observedAt: string;
  status: Exclude<RunnerStatus, 'not-run'>;
  benchmarkClaim: boolean;
  owner: 'BrowserHostSession';
  singleInteractiveTruth: true;
  runner: {
    runnerId: 'browser-native-adapter-platform-benchmark-runner';
    status: RunnerStatus;
    optInEnvVar: typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV;
    optIn: boolean;
    adapterCommandEnvSuffix: '_COMMAND';
    adapterArgsEnvSuffix: '_ARGS_JSON';
    defaultTimeoutMs: number;
  };
  externalAdapterCommandContract: {
    stdoutSchemaVersion: typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA;
    stdoutMaxBytes: number;
    requiredStdoutFields: Array<'schemaVersion' | 'candidateId' | 'platform' | 'owner' | 'singleInteractiveTruth' | 'status' | 'benchmarkClaim' | 'metricSections'>;
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
    injectedEnv: Array<
      | 'SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE'
      | 'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM'
      | 'SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA'
      | 'SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON'
    >;
    perCandidateCommandEnv: Record<BrowserNativeAdapterCandidateId, {
      platform: BrowserNativeAdapterPlatform;
      commandEnv: string;
      argsJsonEnv: string;
      supportedOnCurrentPlatform: boolean;
    }>;
  };
  payloadPolicy: {
    refsFirst: true;
    maxInlineEvidenceBytes: 0;
    forbiddenInlineEvidenceKinds: Array<'raw-dom' | 'base64-image' | 'screenshot-bytes' | 'provider-payload' | 'full-console-log' | 'full-network-log'>;
  };
  candidates: BrowserNativeAdapterPlatformBenchmarkCandidateResult[];
  decisionGate: {
    status: 'blocked' | 'ready-for-human-decision';
    selectedAdapterId: BrowserNativeAdapterCandidateId | null;
    unblocksWhen: 'all-required-candidates-have-real-bounded-results';
  };
};

type RunOptions = {
  cwd?: string;
  env?: EnvRecord;
  now?: string;
  inputManifestPath?: string;
  outputPath?: string;
  timeoutMs?: number;
};

export async function runBrowserNativeAdapterPlatformBenchmark(
  options: RunOptions = {},
): Promise<BrowserNativeAdapterPlatformBenchmarkResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const inputManifestPath = resolve(cwd, options.inputManifestPath ?? DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_MANIFEST_REF);
  const outputPath = resolve(cwd, options.outputPath ?? DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF);
  const manifest = await readPlatformBenchmarkManifest(inputManifestPath);
  const optIn = env[BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV] === '1';
  const candidates = await Promise.all(REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.map(async (candidateId) => {
    const candidate = manifest.candidates.find((item) => item.id === candidateId);
    assert.ok(candidate, `platform benchmark manifest missing candidate ${candidateId}`);
    return optIn
      ? runCandidateBenchmark(candidate, env, options.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS)
      : blockedCandidate(candidate, [
        `env:${BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV}:not-set`,
        'PROJECT_browser.md:Native Adapter Platform Benchmark opt-in required',
      ]);
  }));
  const allPassed = candidates.every((candidate) => candidate.status === 'passed' && candidate.benchmarkClaim === true);
  const anyFailed = candidates.some((candidate) => candidate.status === 'failed');
  const result: BrowserNativeAdapterPlatformBenchmarkResult = {
    schemaVersion: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA,
    manifestRef: pathRef(inputManifestPath, cwd),
    resultRef: pathRef(outputPath, cwd),
    observedAt: options.now ?? new Date().toISOString(),
    status: allPassed ? 'passed' : anyFailed ? 'failed' : 'blocked',
    benchmarkClaim: allPassed,
    owner: 'BrowserHostSession',
    singleInteractiveTruth: true,
    runner: {
      runnerId: 'browser-native-adapter-platform-benchmark-runner',
      status: optIn ? (allPassed ? 'passed' : anyFailed ? 'failed' : 'blocked') : 'not-run',
      optInEnvVar: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_OPT_IN_ENV,
      optIn,
      adapterCommandEnvSuffix: '_COMMAND',
      adapterArgsEnvSuffix: '_ARGS_JSON',
      defaultTimeoutMs: options.timeoutMs ?? DEFAULT_ADAPTER_TIMEOUT_MS,
    },
    externalAdapterCommandContract: buildExternalAdapterCommandContract(manifest.candidates),
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
    candidates,
    decisionGate: {
      status: allPassed ? 'ready-for-human-decision' : 'blocked',
      selectedAdapterId: null,
      unblocksWhen: 'all-required-candidates-have-real-bounded-results',
    },
  };
  await writeResult(outputPath, result);
  return result;
}

async function readPlatformBenchmarkManifest(path: string): Promise<{
  candidates: Array<{
    id: BrowserNativeAdapterCandidateId;
    platform: BrowserNativeAdapterPlatform;
  }>;
}> {
  const text = await readFile(path, 'utf8');
  assertBoundedArtifact(text);
  const manifest = JSON.parse(text) as BrowserNativeAdapterComparisonManifest & {
    candidates: Array<{ id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform }>;
  };
  assert.ok(Array.isArray(manifest.candidates), 'platform benchmark manifest must list candidates');
  for (const candidateId of REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES) {
    const candidate = manifest.candidates.find((item) => item.id === candidateId);
    assert.ok(candidate, `platform benchmark manifest missing candidate ${candidateId}`);
    assert.equal(
      candidate.platform,
      REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidateId],
      `platform benchmark manifest candidate ${candidateId} must keep canonical platform ${REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidateId]}`,
    );
  }
  return manifest;
}

async function runCandidateBenchmark(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  env: EnvRecord,
  timeoutMs: number,
): Promise<BrowserNativeAdapterPlatformBenchmarkCandidateResult> {
  const supportedOnCurrentPlatform = platformSupported(candidate.platform);
  const commandEnv = adapterEnvName(candidate.id, 'COMMAND');
  const argsEnv = adapterEnvName(candidate.id, 'ARGS_JSON');
  const command = env[commandEnv];
  if (!supportedOnCurrentPlatform || !command) {
    const blockerRefs = [
      ...(!supportedOnCurrentPlatform ? [`platform:${candidate.platform}:unsupported-on-${process.platform}`] : []),
      ...(!command ? [`env:${commandEnv}:missing-real-adapter-command`] : []),
    ];
    return blockedCandidate(candidate, blockerRefs);
  }

  try {
    const args = parseArgs(env[argsEnv]);
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: MAX_RESULT_BYTES,
      env: {
        ...process.env,
        ...env,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE: candidate.id,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM: candidate.platform,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
        SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON: JSON.stringify(REAL_METRIC_SECTIONS),
      },
    });
    assertBoundedArtifact(stdout);
    const external = JSON.parse(stdout) as BrowserNativeAdapterPlatformBenchmarkExternalResult;
    return normalizeExternalCandidateResult(candidate, external, `env:${commandEnv}`);
  } catch (error) {
    return {
      ...blockedCandidate(candidate, [`env:${commandEnv}:execution-failed`]),
      status: 'failed',
      diagnosticRefs: [`error:${shortError(error)}`],
    };
  }
}

function normalizeExternalCandidateResult(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
  adapterCommandRef: string,
): BrowserNativeAdapterPlatformBenchmarkCandidateResult {
  assertBoundedArtifact(JSON.stringify(external));
  assertExternalCandidateResultSchema(candidate, external);
  const metricSections = REAL_METRIC_SECTIONS.map((section) => {
    const externalSection = external.metricSections?.[section];
    const resultRefs = Array.isArray(externalSection?.resultRefs)
      ? externalSection.resultRefs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)
      : [];
    const sectionHasRealRefs = resultRefs.length > 0
      && resultRefs.every((ref) => isRealNativeAdapterMetricResultRef(ref, candidate.id, section));
    return {
      section,
      status: externalSection?.status === 'passed' && sectionHasRealRefs ? 'passed' as const : 'blocked' as const,
      evidenceMode: 'bounded-summary-ref' as const,
      inlineEvidence: 'forbidden' as const,
      resultRefs,
      numericSummary: boundedNumericSummary(externalSection?.numericSummary),
    };
  });
  const realAdapterResult = hasRealExternalAdapterRunProof(candidate, external);
  const allSectionsPassed = metricSections.every((section) => section.status === 'passed');
  const status = external.status === 'passed' && external.benchmarkClaim === true && allSectionsPassed && realAdapterResult
    ? 'passed'
    : external.status === 'failed'
      ? 'failed'
      : 'blocked';
  return {
    id: candidate.id,
    platform: candidate.platform,
    status,
    benchmarkClaim: status === 'passed',
    realAdapterResult,
    supportedOnCurrentPlatform: platformSupported(candidate.platform),
    adapterCommandRef,
    adapterRunRef: isRealNativeAdapterProofRef(external.adapterRun?.platformResultRef, candidate.id, 'platform-summary')
      ? external.adapterRun.platformResultRef
      : `benchmark-result:${candidate.id}:blocked`,
    adapterProofRefs: externalAdapterProofRefs(candidate, external, realAdapterResult),
    metricSections,
    blockerRefs: status === 'passed' ? [] : missingRealAdapterResultBlockers(candidate, external, allSectionsPassed, realAdapterResult),
    diagnosticRefs: boundedStringRefs(external.diagnosticRefs),
  };
}

function assertExternalCandidateResultSchema(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): void {
  assert.equal(
    external.schemaVersion,
    BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
    'external adapter stdout must declare the platform benchmark external result schema',
  );
  assert.equal(external.candidateId, candidate.id, 'external adapter stdout candidateId must match the runner candidate');
  assert.equal(external.platform, candidate.platform, 'external adapter stdout platform must match the runner candidate');
  assert.equal(external.owner, 'BrowserHostSession', 'external adapter stdout owner must remain BrowserHostSession');
  assert.equal(external.singleInteractiveTruth, true, 'external adapter stdout must keep a single interactive truth');
  assert.ok(
    external.status === 'passed' || external.status === 'blocked' || external.status === 'failed',
    'external adapter stdout status must be passed, blocked, or failed',
  );
  assert.equal(typeof external.benchmarkClaim, 'boolean', 'external adapter stdout benchmarkClaim must be boolean');
  assert.ok(external.metricSections && typeof external.metricSections === 'object', 'external adapter stdout must include metricSections');
  const metricSections = external.metricSections as Partial<Record<RealMetricSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>>;
  if (external.status === 'passed' || external.benchmarkClaim === true) {
    assert.ok(
      hasRealExternalAdapterRunProof(candidate, external),
      'external adapter stdout must include real native adapter result proof before claiming benchmark pass',
    );
    for (const section of REAL_METRIC_SECTIONS) {
      const sectionResult: BrowserNativeAdapterPlatformBenchmarkExternalSection | undefined = metricSections[section];
      assert.ok(sectionResult, `external adapter stdout missing metric section ${section}`);
      assert.equal(sectionResult.status, 'passed', `external adapter stdout metric section ${section} must pass to claim benchmark`);
      assert.ok(
        Array.isArray(sectionResult.resultRefs) && sectionResult.resultRefs.length > 0,
        `external adapter stdout metric section ${section} needs bounded result refs`,
      );
      assert.ok(
        sectionResult.resultRefs.every((ref) => isRealNativeAdapterMetricResultRef(ref, candidate.id, section)),
        `external adapter stdout metric section ${section} needs real candidate-scoped benchmark result refs`,
      );
      assert.ok(
        hasRequiredMetricSummary(section, sectionResult.numericSummary),
        `external adapter stdout metric section ${section} needs bounded aggregate summary keys`,
      );
    }
  }
}

function buildExternalAdapterCommandContract(
  candidates: Array<{ id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform }>,
): BrowserNativeAdapterPlatformBenchmarkResult['externalAdapterCommandContract'] {
  return {
    stdoutSchemaVersion: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
    stdoutMaxBytes: MAX_RESULT_BYTES,
    requiredStdoutFields: [
      'schemaVersion',
      'candidateId',
      'platform',
      'owner',
      'singleInteractiveTruth',
      'status',
      'benchmarkClaim',
      'metricSections',
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
    injectedEnv: [
      'SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE',
      'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM',
      'SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA',
      'SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON',
    ],
    perCandidateCommandEnv: Object.fromEntries(REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.map((candidateId) => {
      const candidate = candidates.find((item) => item.id === candidateId);
      assert.ok(candidate, `platform benchmark manifest missing command docs candidate ${candidateId}`);
      return [candidateId, {
        platform: candidate.platform,
        commandEnv: adapterEnvName(candidateId, 'COMMAND'),
        argsJsonEnv: adapterEnvName(candidateId, 'ARGS_JSON'),
        supportedOnCurrentPlatform: platformSupported(candidate.platform),
      }];
    })) as BrowserNativeAdapterPlatformBenchmarkResult['externalAdapterCommandContract']['perCandidateCommandEnv'],
  };
}

function blockedCandidate(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  blockerRefs: string[],
): BrowserNativeAdapterPlatformBenchmarkCandidateResult {
  return {
    id: candidate.id,
    platform: candidate.platform,
    status: 'blocked',
    benchmarkClaim: false,
    realAdapterResult: false,
    supportedOnCurrentPlatform: platformSupported(candidate.platform),
    adapterCommandRef: `env:${adapterEnvName(candidate.id, 'COMMAND')}`,
    adapterRunRef: `benchmark-result:${candidate.id}:blocked`,
    adapterProofRefs: {
      proofMode: 'blocked-or-invalid',
      browserHostSessionRef: null,
      liveSurfaceRef: null,
      nativeAdapterSurfaceRef: null,
      actionTraceRef: null,
      platformResultRef: null,
    },
    metricSections: REAL_METRIC_SECTIONS.map((section) => ({
      section,
      status: 'blocked',
      evidenceMode: 'bounded-summary-ref',
      inlineEvidence: 'forbidden',
      resultRefs: [`benchmark-result:${candidate.id}:${section}:blocked`],
    })),
    blockerRefs,
    diagnosticRefs: ['browser-native-adapter-platform-benchmark:blocked-no-real-native-adapter-result'],
  };
}

function hasRealExternalAdapterRunProof(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): boolean {
  const adapterRun = external.adapterRun;
  if (!adapterRun || adapterRun.resultKind !== 'real-native-adapter-run' || adapterRun.realAdapterResult !== true) {
    return false;
  }
  if (adapterRun.secondTruthSource !== false || adapterRun.rawPayloadsCaptured !== false) {
    return false;
  }
  if (!isSessionRef(adapterRun.browserHostSessionRef)
    || !isSessionScopedRefForSession(adapterRun.liveSurfaceRef, adapterRun.browserHostSessionRef)) {
    return false;
  }
  if (!isRealNativeAdapterProofRef(adapterRun.nativeAdapterSurfaceRef, candidate.id, 'native-adapter-surface')
    || !isRealNativeAdapterProofRef(adapterRun.actionTraceRef, candidate.id, 'action-trace')
    || !isRealNativeAdapterProofRef(adapterRun.platformResultRef, candidate.id, 'platform-summary')) {
    return false;
  }
  const proofRefs = [
    adapterRun.browserHostSessionRef,
    adapterRun.liveSurfaceRef,
    adapterRun.nativeAdapterSurfaceRef,
    adapterRun.actionTraceRef,
    adapterRun.platformResultRef,
  ];
  if (proofRefs.some((ref) => hasNonRealBenchmarkProofToken(ref))) {
    return false;
  }
  const diagnosticRefs = boundedStringRefs(external.diagnosticRefs);
  if (diagnosticRefs.some((ref) => hasNonRealBenchmarkProofToken(ref))) {
    return false;
  }
  return true;
}

function externalAdapterProofRefs(
  candidate: { id: BrowserNativeAdapterCandidateId },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
  realAdapterResult: boolean,
): BrowserNativeAdapterPlatformBenchmarkCandidateResult['adapterProofRefs'] {
  const adapterRun = external.adapterRun;
  return {
    proofMode: realAdapterResult ? 'real-native-adapter-run' : 'blocked-or-invalid',
    browserHostSessionRef: boundedAdapterRunRef(adapterRun?.browserHostSessionRef) ?? null,
    liveSurfaceRef: boundedAdapterRunRef(adapterRun?.liveSurfaceRef) ?? null,
    nativeAdapterSurfaceRef: boundedAdapterRunRef(adapterRun?.nativeAdapterSurfaceRef) ?? null,
    actionTraceRef: boundedAdapterRunRef(adapterRun?.actionTraceRef) ?? null,
    platformResultRef: isRealNativeAdapterProofRef(adapterRun?.platformResultRef, candidate.id, 'platform-summary')
      ? adapterRun.platformResultRef
      : (boundedAdapterRunRef(adapterRun?.platformResultRef) ?? null),
  };
}

function missingRealAdapterResultBlockers(
  candidate: { id: BrowserNativeAdapterCandidateId },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
  allSectionsPassed: boolean,
  realAdapterResult: boolean,
): string[] {
  const blockers: string[] = [];
  if (!realAdapterResult) {
    blockers.push(`benchmark-result:${candidate.id}:missing-real-native-adapter-result`);
  }
  if (!allSectionsPassed) {
    blockers.push(`benchmark-result:${candidate.id}:missing-required-metric-section-results`);
  }
  if (hasNonRealMetricResultRefs(candidate, external)) {
    blockers.push(`benchmark-result:${candidate.id}:non-real-metric-section-result-ref`);
  }
  if (external.adapterRun?.resultKind === 'schema-validation-only') {
    blockers.push(`benchmark-result:${candidate.id}:schema-validation-only-not-a-benchmark`);
  }
  return blockers;
}

function hasNonRealMetricResultRefs(
  candidate: { id: BrowserNativeAdapterCandidateId },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): boolean {
  return REAL_METRIC_SECTIONS.some((section) => {
    const resultRefs = external.metricSections?.[section]?.resultRefs;
    return Array.isArray(resultRefs)
      && resultRefs.some((ref) => typeof ref === 'string' && !isRealNativeAdapterMetricResultRef(ref, candidate.id, section));
  });
}

function boundedAdapterRunRef(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-zA-Z0-9_./:-]{1,240}$/.test(value) ? value : undefined;
}

function isSessionRef(value: unknown): boolean {
  return typeof value === 'string' && /^browser-host-session:[a-zA-Z0-9_.:-]{1,120}$/.test(value);
}

function isSessionScopedRefForSession(value: unknown, sessionRef: unknown): boolean {
  return typeof value === 'string'
    && typeof sessionRef === 'string'
    && /^browser-host-session:[a-zA-Z0-9_.:-]{1,120}\/[a-zA-Z0-9_.:-]{1,80}$/.test(value)
    && value.startsWith(`${sessionRef}/`);
}

function isRealNativeAdapterProofRef(
  value: unknown,
  candidateId: BrowserNativeAdapterCandidateId,
  proofKind: 'native-adapter-surface' | 'action-trace' | 'platform-summary',
): value is string {
  return typeof value === 'string'
    && value.startsWith(`benchmark-result:${candidateId}:${proofKind}`)
    && /^[a-zA-Z0-9_./:-]{1,240}$/.test(value)
    && !hasNonRealBenchmarkProofToken(value);
}

function isRealNativeAdapterMetricResultRef(
  value: unknown,
  candidateId: BrowserNativeAdapterCandidateId,
  section: RealMetricSection,
): boolean {
  return typeof value === 'string'
    && value.startsWith(`benchmark-result:${candidateId}:${section}:`)
    && /^[a-zA-Z0-9_./:-]{1,240}$/.test(value)
    && !hasNonRealBenchmarkProofToken(value);
}

function hasRequiredMetricSummary(section: RealMetricSection, value: unknown): boolean {
  const summary = boundedNumericSummary(value);
  if (!summary) {
    return false;
  }
  const expectedType = REQUIRED_REAL_METRIC_SUMMARY_TYPES[section];
  return REQUIRED_REAL_METRIC_SUMMARY_KEYS[section].every((key) => {
    const metricValue = summary[key];
    if (expectedType === 'number') {
      return typeof metricValue === 'number' && Number.isFinite(metricValue);
    }
    return typeof metricValue === 'boolean';
  });
}

function hasNonRealBenchmarkProofToken(value: unknown): boolean {
  return typeof value === 'string'
    && /blocked|fixture|schema-fixture|schema-validation-only|schema-only|no-real-native-adapter|partial/i.test(value);
}

function adapterEnvName(candidateId: BrowserNativeAdapterCandidateId, suffix: 'COMMAND' | 'ARGS_JSON'): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_${suffix}`;
}

function platformSupported(platform: BrowserNativeAdapterPlatform): boolean {
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

function parseArgs(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  assert.ok(Array.isArray(parsed), 'adapter args must be a JSON string array');
  return parsed.map((item) => {
    assert.equal(typeof item, 'string', 'adapter args must be strings');
    return item;
  });
}

function boundedNumericSummary(value: unknown): Record<string, number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .filter((entry): entry is [string, number | boolean] => (
      /^[a-zA-Z0-9_.:-]{1,80}$/.test(entry[0])
      && (typeof entry[1] === 'number' || typeof entry[1] === 'boolean')
    ))
    .slice(0, 24);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function boundedStringRefs(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= 240).slice(0, 24);
}

async function writeResult(path: string, result: BrowserNativeAdapterPlatformBenchmarkResult): Promise<void> {
  const text = `${JSON.stringify(result, null, 2)}\n`;
  assertBoundedArtifact(text);
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_RESULT_BYTES, 'platform benchmark result must stay bounded');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
}

function pathRef(path: string, cwd: string): string {
  const resolvedCwd = resolve(cwd);
  return path.startsWith(`${resolvedCwd}/`) ? path.slice(resolvedCwd.length + 1) : path;
}

function assertBoundedArtifact(text: string): void {
  assert.ok(Buffer.byteLength(text, 'utf8') <= MAX_RESULT_BYTES, 'platform benchmark artifact must stay bounded');
  assert.doesNotMatch(text, /data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i);
  assert.doesNotMatch(text, /"(?:rawDom|domSnapshot|screenshotBase64|providerPayload|consoleLog|networkLog)"\s*:/i);
  assert.doesNotMatch(text, /"payload"\s*:\s*"(?:\{|<|data:)/i);
}

function shortError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180);
}

async function main(): Promise<void> {
  const result = await runBrowserNativeAdapterPlatformBenchmark();
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    benchmarkClaim: result.benchmarkClaim,
    runner: result.runner.status,
    resultRef: result.resultRef,
  })}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${shortError(error)}\n`);
    process.exitCode = 1;
  });
}
