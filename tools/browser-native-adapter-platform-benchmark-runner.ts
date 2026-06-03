import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES,
  type BrowserNativeAdapterCandidateId,
  type BrowserNativeAdapterBenchmarkMetricSection,
  type BrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterPlatform,
  type RejectedBrowserNativeAdapterPassEvidenceSubstitute,
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
export const NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS = [
  'policy',
  'entrypoint',
  'helper-chain',
  'live-smoke',
] as const;

const MAX_RESULT_BYTES = 96_000;
const DEFAULT_ADAPTER_TIMEOUT_MS = 120_000;
const REAL_METRIC_SECTIONS = REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS;
const TRUSTED_HELPER_ENTRYPOINT_FORMS = [
  'tsx <helper>',
  'node --import tsx <helper>',
  'node --import=tsx <helper>',
] as const;
const TRUSTED_TSX_BIN_REF = 'node_modules/.bin/tsx';

type EnvRecord = Record<string, string | undefined>;
type RunnerCandidateStatus = 'passed' | 'blocked' | 'failed';
type RunnerStatus = 'passed' | 'blocked' | 'failed' | 'not-run';
type RealMetricSection = BrowserNativeAdapterBenchmarkMetricSection;
type AdapterAvailabilityStatus =
  | 'real-adapter-command-present'
  | 'missing-real-adapter-command'
  | 'unsupported-on-current-platform'
  | 'blocked-or-invalid';
type AdapterAvailability = {
  helperCommandPresent: boolean;
  realAdapterCommandPresent: boolean;
  availabilityStatus: AdapterAvailabilityStatus;
  provenanceRefs: string[];
};
type TrustedPassGradeHelperContract = {
  helperRef: string;
  helperBasename: string;
  requiredOptInEnv: string;
  forbiddenEnv: string[];
  actualEntrypointForms: readonly (typeof TRUSTED_HELPER_ENTRYPOINT_FORMS)[number][];
  passGradeStatus: 'active' | 'contract-defined-fail-closed';
};

const TRUSTED_PASS_GRADE_HELPERS: Partial<Record<BrowserNativeAdapterCandidateId, TrustedPassGradeHelperContract>> = {
  'electron-web-contents-view': {
    helperRef: 'tools/browser-native-adapter-electron-web-contents-view-external-result.ts',
    helperBasename: 'browser-native-adapter-electron-web-contents-view-external-result.ts',
    requiredOptInEnv: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_RUN_LIVE_SMOKE',
    forbiddenEnv: ['SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_LIVE_EVIDENCE_PATH'],
    actualEntrypointForms: TRUSTED_HELPER_ENTRYPOINT_FORMS,
    passGradeStatus: 'active',
  },
  wkwebview: {
    helperRef: 'tools/browser-native-adapter-wkwebview-external-result.ts',
    helperBasename: 'browser-native-adapter-wkwebview-external-result.ts',
    requiredOptInEnv: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_WKWEBVIEW_RUN_LIVE_SMOKE',
    forbiddenEnv: [],
    actualEntrypointForms: TRUSTED_HELPER_ENTRYPOINT_FORMS,
    passGradeStatus: 'active',
  },
  'standalone-chromium-surface': {
    helperRef: 'tools/browser-native-adapter-standalone-chromium-surface-external-result.ts',
    helperBasename: 'browser-native-adapter-standalone-chromium-surface-external-result.ts',
    requiredOptInEnv: 'SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE',
    forbiddenEnv: [],
    actualEntrypointForms: TRUSTED_HELPER_ENTRYPOINT_FORMS,
    passGradeStatus: 'active',
  },
};

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
  streamQuality: [
    'latencyP50Ms',
    'latencyP95Ms',
    'framerateAvgFps',
    'framerateP5Fps',
    'inputToFrameP50Ms',
    'inputToFrameP95Ms',
    'reconnectP50Ms',
    'reconnectP95Ms',
    'sampleCount',
    'fallbackRequired',
  ],
} as const satisfies Record<RealMetricSection, readonly string[]>;
const REQUIRED_REAL_METRIC_SUMMARY_TYPES = {
  latency: 'number',
  cpu: 'number',
  memory: 'number',
  inputCompleteness: 'boolean',
  lifecycle: 'boolean',
  reconnect: 'boolean',
  streamQuality: {
    latencyP50Ms: 'number',
    latencyP95Ms: 'number',
    framerateAvgFps: 'number',
    framerateP5Fps: 'number',
    inputToFrameP50Ms: 'number',
    inputToFrameP95Ms: 'number',
    reconnectP50Ms: 'number',
    reconnectP95Ms: 'number',
    sampleCount: 'number',
    fallbackRequired: 'boolean',
  },
} as const satisfies Record<RealMetricSection, 'number' | 'boolean' | Record<string, 'number' | 'boolean'>>;

export type BrowserNativeAdapterPlatformBenchmarkExternalSection = {
  status?: RunnerCandidateStatus;
  resultRefs?: string[];
  numericSummary?: Record<string, number | boolean>;
};

export type BrowserNativeAdapterPlatformBenchmarkExternalAdapterRun = {
  resultKind?: 'real-native-adapter-run' | 'schema-validation-only';
  realAdapterResult?: boolean;
  liveSurfaceTransport?: 'native-embedded';
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
  liveSurfaceTransport?: 'native-embedded';
  singleInteractiveTruth?: true;
  secondTruthSource?: false;
  adapterRun?: BrowserNativeAdapterPlatformBenchmarkExternalAdapterRun;
  nestedAdapterCommandProofRefs?: string[];
  status?: RunnerCandidateStatus;
  benchmarkClaim?: boolean;
  metricSections?: Partial<Record<RealMetricSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>>;
  diagnosticRefs?: string[];
};

export type BrowserNativeAdapterPlatformBenchmarkCandidateResult = {
  id: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  status: RunnerCandidateStatus;
  benchmarkClaim: boolean;
  realAdapterResult: boolean;
  supportedOnCurrentPlatform: boolean;
  adapterAvailability?: AdapterAvailability;
  adapterCommandRef: string;
  adapterRunRef: string;
  adapterProofRefs: {
    proofMode: 'real-native-adapter-run' | 'blocked-or-invalid';
    browserHostSessionRef: string | null;
    liveSurfaceRef: string | null;
    nativeAdapterSurfaceRef: string | null;
    actionTraceRef: string | null;
    platformResultRef: string | null;
    nestedAdapterCommandProofRefs?: string[];
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
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
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
    requiredStdoutFields: Array<
      | 'schemaVersion'
      | 'candidateId'
      | 'platform'
      | 'owner'
      | 'liveSurfaceTransport'
      | 'singleInteractiveTruth'
      | 'secondTruthSource'
      | 'status'
      | 'benchmarkClaim'
      | 'metricSections'
    >;
    passRequiresAdapterRunProof: {
      resultKind: 'real-native-adapter-run';
      realAdapterResult: true;
      liveSurfaceTransport: 'native-embedded';
      singleInteractiveTruth: true;
      secondTruthSource: false;
      requiredRefs: string[];
      forbiddenResultKinds: Array<'schema-validation-only'>;
      forbiddenPassEvidenceTokens: RejectedBrowserNativeAdapterPassEvidenceSubstitute[];
    };
    passRequiresNestedAdapterCommandProofRefs: {
      candidates: Array<'wkwebview' | 'standalone-chromium-surface'>;
      proofKinds: Array<(typeof NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS)[number]>;
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
    trustedPassGradeHelpers: Partial<Record<BrowserNativeAdapterCandidateId, {
      helperRef: string;
      helperBasename: string;
      requiredOptInEnv: string;
      forbiddenEnv: string[];
      actualEntrypointForms: string[];
      passGradeStatus: 'active' | 'contract-defined-fail-closed';
    }>>;
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
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
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
    liveSurfaceTransport?: string;
    singleInteractiveTruth?: boolean;
    secondTruthSource?: boolean;
  }>;
}> {
  const text = await readFile(path, 'utf8');
  assertBoundedArtifact(text);
  const manifest = JSON.parse(text) as BrowserNativeAdapterComparisonManifest & {
    liveSurfaceTransport?: string;
    secondTruthSource?: boolean;
    candidates: Array<{
      id: BrowserNativeAdapterCandidateId;
      platform: BrowserNativeAdapterPlatform;
      liveSurfaceTransport?: string;
      singleInteractiveTruth?: boolean;
      secondTruthSource?: boolean;
    }>;
  };
  assert.ok(Array.isArray(manifest.candidates), 'platform benchmark manifest must list candidates');
  assert.equal(
    manifest.singleInteractiveTruth,
    true,
    'platform benchmark manifest must declare singleInteractiveTruth=true',
  );
  assert.equal(
    manifest.liveSurfaceTransport,
    'native-embedded',
    'platform benchmark manifest must declare liveSurfaceTransport=native-embedded',
  );
  assert.equal(
    manifest.secondTruthSource,
    false,
    'platform benchmark manifest must declare secondTruthSource=false',
  );
  for (const candidateId of REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES) {
    const candidate = manifest.candidates.find((item) => item.id === candidateId);
    assert.ok(candidate, `platform benchmark manifest missing candidate ${candidateId}`);
    assert.equal(
      candidate.platform,
      REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidateId],
      `platform benchmark manifest candidate ${candidateId} must keep canonical platform ${REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidateId]}`,
    );
    assert.equal(
      candidate.liveSurfaceTransport,
      'native-embedded',
      `platform benchmark manifest candidate ${candidateId} must declare liveSurfaceTransport=native-embedded`,
    );
    assert.equal(
      candidate.singleInteractiveTruth,
      true,
      `platform benchmark manifest candidate ${candidateId} must declare singleInteractiveTruth=true`,
    );
    assert.equal(
      candidate.secondTruthSource,
      false,
      `platform benchmark manifest candidate ${candidateId} must declare secondTruthSource=false`,
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
  const availability = adapterAvailability(candidate, env, Boolean(command));
  if (!supportedOnCurrentPlatform || !command) {
    const blockerRefs = !supportedOnCurrentPlatform
      ? [`platform:${candidate.platform}:unsupported-on-${process.platform}`]
      : [`env:${commandEnv}:missing-real-adapter-command`];
    return blockedCandidate(candidate, blockerRefs, availability);
  }

  try {
    const args = parseArgs(env[argsEnv]);
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: MAX_RESULT_BYTES,
      env: boundedAdapterCommandEnv(env, candidate),
    });
    assertBoundedArtifact(stdout);
    const external = JSON.parse(stdout) as BrowserNativeAdapterPlatformBenchmarkExternalResult;
    if (external.status === 'passed' || external.benchmarkClaim === true) {
      assertExternalCandidateResultSchema(candidate, external);
    }
    assertTrustedPassGradeAdapterCommand(candidate, command, args, env, external);
    return normalizeExternalCandidateResult(candidate, external, `env:${commandEnv}`, availability);
  } catch (error) {
    return {
      ...blockedCandidate(candidate, [`env:${commandEnv}:execution-failed`], availability),
      status: 'failed',
      diagnosticRefs: [`error:${shortError(error)}`],
    };
  }
}

function assertTrustedPassGradeAdapterCommand(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  command: string,
  args: string[],
  env: EnvRecord,
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): void {
  if (external.status !== 'passed' && external.benchmarkClaim !== true) return;
  assert.ok(
    isTrustedPassGradeAdapterCommand(candidate, command, args, env),
    'external adapter stdout pass evidence requires trusted live adapter helper provenance',
  );
}

function isTrustedPassGradeAdapterCommand(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  command: string,
  args: string[],
  env: EnvRecord,
): boolean {
  const helperContract = TRUSTED_PASS_GRADE_HELPERS[candidate.id];
  if (!helperContract) return false;
  if (helperContract.passGradeStatus !== 'active') return false;
  if (env[helperContract.requiredOptInEnv] !== '1') return false;
  if (helperContract.forbiddenEnv.some((name) => Boolean(env[name]))) return false;
  if (args.some(isNodeEvalArg)) return false;
  return actualTrustedHelperEntrypoint(command, args, helperContract) === resolve(process.cwd(), helperContract.helperRef);
}

function actualTrustedHelperEntrypoint(
  command: string,
  args: string[],
  helperContract: TrustedPassGradeHelperContract,
): string | undefined {
  const commandName = executableName(command);
  if (commandName === 'tsx') {
    if (resolvedCommandPath(command) !== resolve(process.cwd(), TRUSTED_TSX_BIN_REF)) return undefined;
    const entrypoint = args[0];
    return helperPath(entrypoint, helperContract);
  }
  if (commandName !== 'node' || resolvedCommandPath(command) !== resolve(process.execPath)) return undefined;
  if (args[0] === '--import' && args[1] === 'tsx') {
    return helperPath(args[2], helperContract);
  }
  if (args[0] === '--import=tsx') {
    return helperPath(args[1], helperContract);
  }
  return undefined;
}

function helperPath(entrypoint: string | undefined, helperContract: TrustedPassGradeHelperContract): string | undefined {
  if (!entrypoint || !entrypoint.endsWith(helperContract.helperBasename)) return undefined;
  return resolve(process.cwd(), entrypoint);
}

function executableName(command: string): string {
  const normalized = command.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase();
  return name.endsWith('.exe') || name.endsWith('.cmd') ? name.slice(0, name.lastIndexOf('.')) : name;
}

function resolvedCommandPath(command: string): string {
  return resolve(process.cwd(), command);
}

function isNodeEvalArg(arg: string): boolean {
  return arg === '-e' || arg === '--eval' || arg.startsWith('--eval=');
}

function normalizeExternalCandidateResult(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
  adapterCommandRef: string,
  availability: AdapterAvailability,
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
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    status,
    benchmarkClaim: status === 'passed',
    realAdapterResult,
    supportedOnCurrentPlatform: platformSupported(candidate.platform),
    adapterAvailability: availability,
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

export function assertExternalCandidateResultSchema(
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
  assert.equal(external.liveSurfaceTransport, 'native-embedded', 'external adapter stdout must declare liveSurfaceTransport=native-embedded');
  assert.equal(external.singleInteractiveTruth, true, 'external adapter stdout must keep a single interactive truth');
  assert.equal(external.secondTruthSource, false, 'external adapter stdout must declare secondTruthSource=false');
  assert.ok(
    external.status === 'passed' || external.status === 'blocked' || external.status === 'failed',
    'external adapter stdout status must be passed, blocked, or failed',
  );
  assert.equal(typeof external.benchmarkClaim, 'boolean', 'external adapter stdout benchmarkClaim must be boolean');
  assert.ok(external.metricSections && typeof external.metricSections === 'object', 'external adapter stdout must include metricSections');
  const metricSections = external.metricSections as Partial<Record<RealMetricSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>>;
  if (external.status === 'passed' || external.benchmarkClaim === true) {
    assert.ok(
      !hasForbiddenRawEvidenceFields(external),
      'external adapter stdout pass evidence must not include raw URL, DOM, screenshot, provider payload, log, or secret fields',
    );
    assert.ok(
      !hasLegacyPassEvidenceTokens(external),
      'external adapter stdout pass evidence must not use legacy frame-stream/canvas/WebRTC tokens',
    );
    const proofIssue = realExternalAdapterRunProofIssue(candidate, external);
    assert.ok(
      !proofIssue,
      proofIssue ?? 'external adapter stdout must include real native adapter result proof before claiming benchmark pass',
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
    trustedPassGradeHelpers: trustedPassGradeHelperContractDocs(),
  };
}

function trustedPassGradeHelperContractDocs(): BrowserNativeAdapterPlatformBenchmarkResult['externalAdapterCommandContract']['trustedPassGradeHelpers'] {
  return Object.fromEntries(
    Object.entries(TRUSTED_PASS_GRADE_HELPERS).map(([candidateId, helper]) => [
      candidateId,
      {
        helperRef: helper.helperRef,
        helperBasename: helper.helperBasename,
        requiredOptInEnv: helper.requiredOptInEnv,
        forbiddenEnv: [...helper.forbiddenEnv],
        actualEntrypointForms: [...helper.actualEntrypointForms],
        passGradeStatus: helper.passGradeStatus,
      },
    ]),
  ) as BrowserNativeAdapterPlatformBenchmarkResult['externalAdapterCommandContract']['trustedPassGradeHelpers'];
}

function blockedCandidate(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  blockerRefs: string[],
  availability = adapterAvailability(candidate, {}, false),
): BrowserNativeAdapterPlatformBenchmarkCandidateResult {
  return {
    id: candidate.id,
    platform: candidate.platform,
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    status: 'blocked',
    benchmarkClaim: false,
    realAdapterResult: false,
    supportedOnCurrentPlatform: platformSupported(candidate.platform),
    adapterAvailability: availability,
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

function adapterAvailability(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  env: EnvRecord,
  helperCommandPresent: boolean,
): AdapterAvailability {
  const realCommandEnv = adapterRealEnvName(candidate.id, 'COMMAND');
  const realAdapterCommandPresent = Boolean(env[realCommandEnv]);
  const supportedOnCurrentPlatform = platformSupported(candidate.platform);
  const expectsRealAdapterCommand = expectsNestedRealAdapterCommand(candidate.id);
  const availabilityStatus: AdapterAvailabilityStatus = !supportedOnCurrentPlatform
    ? 'unsupported-on-current-platform'
    : expectsRealAdapterCommand && !realAdapterCommandPresent
      ? 'missing-real-adapter-command'
      : helperCommandPresent
        ? 'real-adapter-command-present'
        : 'missing-real-adapter-command';
  const provenanceRefs = [
    `env:${adapterEnvName(candidate.id, 'COMMAND')}:${helperCommandPresent ? 'helper-command-present' : 'missing-helper-command'}`,
  ];
  if (expectsRealAdapterCommand) {
    provenanceRefs.push(`env:${realCommandEnv}:${realAdapterCommandPresent ? 'real-adapter-command-present' : 'missing-real-adapter-command'}`);
  }
  if (!supportedOnCurrentPlatform) {
    provenanceRefs.push(`platform:${candidate.platform}:unsupported-on-${process.platform}`);
  }
  return {
    helperCommandPresent,
    realAdapterCommandPresent: expectsRealAdapterCommand ? realAdapterCommandPresent : helperCommandPresent,
    availabilityStatus,
    provenanceRefs,
  };
}

function expectsNestedRealAdapterCommand(candidateId: BrowserNativeAdapterCandidateId): boolean {
  return candidateId === 'wkwebview' || candidateId === 'standalone-chromium-surface';
}

function hasRealExternalAdapterRunProof(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): boolean {
  return realExternalAdapterRunProofIssue(candidate, external) === undefined;
}

function realExternalAdapterRunProofIssue(
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): string | undefined {
  const adapterRun = external.adapterRun;
  if (
    external.owner !== 'BrowserHostSession'
    || external.liveSurfaceTransport !== 'native-embedded'
    || external.singleInteractiveTruth !== true
    || external.secondTruthSource !== false
  ) {
    return 'external adapter stdout must keep BrowserHostSession/native-embedded/single-truth proof fields';
  }
  if (!adapterRun || adapterRun.resultKind !== 'real-native-adapter-run' || adapterRun.realAdapterResult !== true) {
    return 'external adapter stdout must include real native adapter result proof before claiming benchmark pass';
  }
  if (
    adapterRun.liveSurfaceTransport !== 'native-embedded'
    || adapterRun.secondTruthSource !== false
    || adapterRun.rawPayloadsCaptured !== false
  ) {
    return 'external adapter stdout real proof must be native-embedded, single-source, and rawPayloadsCaptured=false';
  }
  if (!isSessionRef(adapterRun.browserHostSessionRef)
    || !isSessionScopedRefForSession(adapterRun.liveSurfaceRef, adapterRun.browserHostSessionRef)) {
    return 'external adapter stdout real proof must include BrowserHostSession-scoped live surface refs';
  }
  if (!isRealNativeAdapterProofRef(adapterRun.nativeAdapterSurfaceRef, candidate.id, 'native-adapter-surface')
    || !isRealNativeAdapterProofRef(adapterRun.actionTraceRef, candidate.id, 'action-trace')
    || !isRealNativeAdapterProofRef(adapterRun.platformResultRef, candidate.id, 'platform-summary')) {
    return 'external adapter stdout real proof must include candidate-scoped native adapter surface, action trace, and platform summary refs';
  }
  const proofRefs = [
    adapterRun.browserHostSessionRef,
    adapterRun.liveSurfaceRef,
    adapterRun.nativeAdapterSurfaceRef,
    adapterRun.actionTraceRef,
    adapterRun.platformResultRef,
  ];
  if (proofRefs.some((ref) => hasNonRealBenchmarkProofToken(ref))) {
    return 'external adapter stdout real proof refs must not contain blocked, fixture, schema-only, partial, or legacy tokens';
  }
  const diagnosticRefs = boundedStringRefs(external.diagnosticRefs);
  if (diagnosticRefs.some((ref) => hasNonRealBenchmarkProofToken(ref))) {
    return 'external adapter stdout diagnostic refs must not contain blocked, fixture, schema-only, partial, or legacy tokens when claiming pass';
  }
  const nestedProofIssue = nestedAdapterCommandProofIssue(candidate, external);
  if (nestedProofIssue) {
    return nestedProofIssue;
  }
  return undefined;
}

function hasLegacyPassEvidenceTokens(external: BrowserNativeAdapterPlatformBenchmarkExternalResult): boolean {
  const refs = [
    external.adapterRun?.browserHostSessionRef,
    external.adapterRun?.liveSurfaceRef,
    external.adapterRun?.nativeAdapterSurfaceRef,
    external.adapterRun?.actionTraceRef,
    external.adapterRun?.platformResultRef,
    ...(external.nestedAdapterCommandProofRefs ?? []),
    ...REAL_METRIC_SECTIONS.flatMap((section) => external.metricSections?.[section]?.resultRefs ?? []),
    ...(external.diagnosticRefs ?? []),
  ];
  return refs.some((ref) => hasLegacyPassEvidenceToken(ref));
}

function nestedAdapterCommandProofIssue(
  candidate: { id: BrowserNativeAdapterCandidateId },
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
): string | undefined {
  if (!expectsNestedRealAdapterCommand(candidate.id)) {
    return undefined;
  }
  const refs = boundedStringRefs(external.nestedAdapterCommandProofRefs);
  if (!Array.isArray(external.nestedAdapterCommandProofRefs) || refs.length !== external.nestedAdapterCommandProofRefs.length) {
    return 'external adapter stdout nested adapter command provenance refs must be bounded refs';
  }
  if (refs.some((ref) => hasNonRealBenchmarkProofToken(ref))) {
    return 'external adapter stdout nested adapter command provenance refs must not contain blocked, fixture, schema-only, partial, mock, fake, or legacy tokens';
  }
  const missingProofKinds = NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS.filter((kind) => (
    !refs.some((ref) => isNestedAdapterCommandProofRef(ref, candidate.id, kind))
  ));
  if (missingProofKinds.length > 0) {
    return 'external adapter stdout nested adapter command provenance refs required before claiming benchmark pass';
  }
  return undefined;
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
    nestedAdapterCommandProofRefs: expectsNestedRealAdapterCommand(candidate.id)
      ? boundedStringRefs(external.nestedAdapterCommandProofRefs)
        .filter((ref) => NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS.some((kind) => (
          isNestedAdapterCommandProofRef(ref, candidate.id, kind)
        )))
      : undefined,
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
  if (nestedAdapterCommandProofIssue(candidate, external)) {
    blockers.push(`benchmark-result:${candidate.id}:missing-nested-real-adapter-command-provenance`);
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
  return typeof value === 'string' && /^[a-zA-Z0-9_.:/-]{1,240}$/.test(value) ? value : undefined;
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
    && /^[a-zA-Z0-9_.:/-]{1,240}$/.test(value)
    && !hasNonRealBenchmarkProofToken(value);
}

function isRealNativeAdapterMetricResultRef(
  value: unknown,
  candidateId: BrowserNativeAdapterCandidateId,
  section: RealMetricSection,
): boolean {
  return typeof value === 'string'
    && value.startsWith(`benchmark-result:${candidateId}:${section}:`)
    && /^[a-zA-Z0-9_.:/-]{1,240}$/.test(value)
    && !hasNonRealBenchmarkProofToken(value);
}

function isNestedAdapterCommandProofRef(
  value: unknown,
  candidateId: BrowserNativeAdapterCandidateId,
  proofKind: (typeof NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS)[number],
): value is string {
  return typeof value === 'string'
    && value.startsWith(`benchmark-result:${candidateId}:nested-real-adapter-command:${proofKind}:`)
    && /^[a-zA-Z0-9_.:/-]{1,240}$/.test(value)
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
    const expectedKeyType = typeof expectedType === 'string'
      ? expectedType
      : (expectedType as Record<string, 'number' | 'boolean'>)[key];
    if (expectedKeyType === 'number') {
      return typeof metricValue === 'number' && Number.isFinite(metricValue);
    }
    return typeof metricValue === 'boolean';
  });
}

function hasNonRealBenchmarkProofToken(value: unknown): boolean {
  return typeof value === 'string'
    && (
      /blocked|fixture|schema-fixture|schema-validation-only|schema-only|no-real-native-adapter|partial|sample|synthetic|mock|fake|test-fixture|dry-run/i.test(value)
      || hasLegacyPassEvidenceToken(value)
    );
}

function hasLegacyPassEvidenceToken(value: unknown): boolean {
  return typeof value === 'string'
    && /(?:^|[/:_-])(?:host-stream|frame-stream|legacy-frame|canvas|canvas-binary|webrtc|web-rtc|websocket-binary|http-frame|iframe|proxy|snapshot|webview|webview-tag|system-popup|external-browser|second-viewer|standalone-process|standalone-process-without-native-embedder)(?:$|[/:_-])/i.test(value);
}

function hasForbiddenRawEvidenceFields(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => hasForbiddenRawEvidenceFields(item));
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return Object.entries(value).some(([key, nested]) => (
    /^(?:rawUrl|url|requestedUrl|currentUrl|finalUrl|rawDom|dom|domSnapshot|screenshot|rawScreenshot|screenshotBase64|screenshotBytes|clipboard|selection|menu|provider|payload|rawPayload|providerPayload|consoleLog|networkLog|secret|token|password|credential|cookie|authorization|apiKey)$/i.test(key)
    || hasForbiddenRawEvidenceFields(nested)
  ));
}

function adapterEnvName(candidateId: BrowserNativeAdapterCandidateId, suffix: 'COMMAND' | 'ARGS_JSON'): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_${suffix}`;
}

function adapterRealEnvName(candidateId: BrowserNativeAdapterCandidateId, suffix: 'COMMAND' | 'ARGS_JSON'): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_REAL_${suffix}`;
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
  return value.filter((item): item is string => (
    typeof item === 'string'
    && item.length > 0
    && item.length <= 240
    && !/https?:\/\//i.test(item)
  )).slice(0, 24);
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
  assert.doesNotMatch(text, /https?:\/\//i, 'platform benchmark artifact must not include raw URLs; evidence must use bounded refs');
  assert.ok(
    !/"(?:rawUrl|url|requestedUrl|currentUrl|finalUrl|rawDom|dom|domSnapshot|screenshot|rawScreenshot|screenshotBase64|screenshotBytes|clipboard|selection|menu|provider|payload|rawPayload|providerPayload|consoleLog|networkLog|secret|token|password|credential|cookie|authorization|apiKey)"\s*:/i.test(text),
    'platform benchmark artifact must not include raw URL, DOM, screenshot, provider payload, log, or secret fields',
  );
  assert.doesNotMatch(text, /"payload"\s*:\s*"(?:\{|<|data:)/i);
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const safeDiagnostic = safeInternalDiagnosticMessage(message);
  if (safeDiagnostic) return safeDiagnostic;
  return boundedErrorToken(message);
}

function boundedErrorToken(value: string): string {
  return `hash-${createHash('sha256').update(value).digest('hex').slice(0, 12)}`;
}

function safeInternalDiagnosticMessage(message: string): string | undefined {
  const safePhrases = [
    'trusted live adapter helper provenance',
    'external adapter stdout must declare',
    'real native adapter result proof',
    'real proof must include candidate-scoped',
    'real proof refs must not contain',
    'real candidate-scoped benchmark result refs',
    'legacy frame-stream/canvas/WebRTC tokens',
    'raw URL, DOM, screenshot, provider payload, log, or secret fields',
    'raw URLs',
    'refs-first',
    'bounded aggregate summary keys',
    'missing metric section streamQuality',
  ];
  return safePhrases.find((phrase) => message.includes(phrase));
}

function boundedAdapterCommandEnv(
  env: EnvRecord,
  candidate: { id: BrowserNativeAdapterCandidateId; platform: BrowserNativeAdapterPlatform },
): EnvRecord {
  const bounded: EnvRecord = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE: candidate.id,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM: candidate.platform,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON: JSON.stringify(REAL_METRIC_SECTIONS),
  };
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('SCIFORGE_BROWSER_NATIVE_ADAPTER_')) bounded[key] = value;
  }
  return bounded;
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
