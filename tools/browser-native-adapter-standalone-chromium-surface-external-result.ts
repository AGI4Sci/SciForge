import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
  assertExternalCandidateResultSchema,
  type BrowserNativeAdapterPlatformBenchmarkExternalResult,
  type BrowserNativeAdapterPlatformBenchmarkExternalSection,
} from './browser-native-adapter-platform-benchmark-runner.js';
import type {
  BrowserNativeAdapterBenchmarkMetricSection,
  BrowserNativeAdapterCandidateId,
  BrowserNativeAdapterPlatform,
} from '../src/desktop/browser-native-adapter-comparison.js';

const STANDALONE_CHROMIUM_SURFACE_CANDIDATE: BrowserNativeAdapterCandidateId = 'standalone-chromium-surface';
const STANDALONE_CHROMIUM_SURFACE_PLATFORM: BrowserNativeAdapterPlatform = 'cross-platform';
export const STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND_ENV =
  'SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND' as const;
export const STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON_ENV =
  'SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON' as const;
export const STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE_ENV =
  'SCIFORGE_BROWSER_NATIVE_ADAPTER_STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE' as const;
const DEFAULT_REQUIRED_SECTIONS: BrowserNativeAdapterBenchmarkMetricSection[] = [
  'latency',
  'cpu',
  'memory',
  'inputCompleteness',
  'lifecycle',
  'reconnect',
  'streamQuality',
];
const TYPED_BLOCKER_REF = 'typed-blocked-native-display-input-adapter-missing' as const;
const MAX_EXTERNAL_RESULT_BYTES = 96_000;
const DEFAULT_REAL_COMMAND_TIMEOUT_MS = 120_000;

const execFileAsync = promisify(execFile);

type EnvRecord = Record<string, string | undefined>;

export async function buildStandaloneChromiumSurfaceExternalBenchmarkResult(
  env: EnvRecord = process.env,
): Promise<BrowserNativeAdapterPlatformBenchmarkExternalResult> {
  const candidateId = candidateFromEnv(env);
  const platform = platformFromEnv(env);
  const requiredSections = requiredSectionsFromEnv(env);
  const realCommand = env[STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND_ENV];
  if (realCommand) {
    return runRealStandaloneChromiumSurfaceAdapterCommand({
      env,
      candidateId,
      platform,
      requiredSections,
      realCommand,
    });
  }
  return {
    schemaVersion: schemaFromEnv(env),
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
    metricSections: blockedMetricSections(candidateId, requiredSections),
    diagnosticRefs: [
      'standalone-chromium-surface:typed-blocked-no-native-display-input-adapter',
      'standalone-chromium-surface:chromium-process-without-native-embedder-is-second-surface',
      'standalone-chromium-surface:missing-browser-host-session-native-surface-attach',
      'standalone-chromium-surface:missing-native-input-routing-proof',
      'standalone-chromium-surface:real-native-adapter-run-refused',
      'standalone-chromium-surface:real-native-adapter-run-required',
      `env:${STANDALONE_CHROMIUM_SURFACE_REAL_COMMAND_ENV}:missing-real-adapter-command`,
      'browser-native-adapter-platform-benchmark:typed-blocked-external-result',
    ],
  };
}

async function runRealStandaloneChromiumSurfaceAdapterCommand(input: {
  env: EnvRecord;
  candidateId: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  requiredSections: BrowserNativeAdapterBenchmarkMetricSection[];
  realCommand: string;
}): Promise<BrowserNativeAdapterPlatformBenchmarkExternalResult> {
  try {
    const args = parseArgs(input.env[STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON_ENV]);
    const { stdout } = await execFileAsync(input.realCommand, args, {
      timeout: DEFAULT_REAL_COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_EXTERNAL_RESULT_BYTES,
      env: boundedRealCommandEnv(input),
    });
    assertBoundedExternalResult(stdout);
    const external = JSON.parse(stdout) as BrowserNativeAdapterPlatformBenchmarkExternalResult;
    assertExternalResultForCandidate(external, input.candidateId, input.platform);
    if (external.status === 'passed' || external.benchmarkClaim === true) {
      if (hasStandaloneSecondTruthToken(external)) {
        throw new Error('standalone Chromium external real command pass evidence requires trusted live adapter helper provenance; standalone process and second-truth refs are not accepted');
      }
      assertTrustedLiveSmokeOptIn(input.env);
      assertExternalCandidateResultSchema({ id: input.candidateId, platform: input.platform }, external);
    }
    return external;
  } catch (error) {
    return failedExternalResult({
      candidateId: input.candidateId,
      platform: input.platform,
      requiredSections: input.requiredSections,
      diagnosticRefs: [
        'standalone-chromium-surface:real-native-adapter-command-failed',
        `error:${shortError(error)}`,
      ],
    });
  }
}

function failedExternalResult(input: {
  candidateId: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  requiredSections: BrowserNativeAdapterBenchmarkMetricSection[];
  diagnosticRefs: string[];
}): BrowserNativeAdapterPlatformBenchmarkExternalResult {
  return {
    schemaVersion: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
    candidateId: input.candidateId,
    platform: input.platform,
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
    status: 'failed',
    benchmarkClaim: false,
    metricSections: blockedMetricSections(input.candidateId, input.requiredSections),
    diagnosticRefs: input.diagnosticRefs,
  };
}

function blockedMetricSections(
  candidateId: BrowserNativeAdapterCandidateId,
  sections: BrowserNativeAdapterBenchmarkMetricSection[],
): Partial<Record<BrowserNativeAdapterBenchmarkMetricSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>> {
  return Object.fromEntries(sections.map((section) => [section, {
    status: 'blocked',
    resultRefs: [`benchmark-result:${candidateId}:${section}:${TYPED_BLOCKER_REF}`],
  }])) as Partial<Record<BrowserNativeAdapterBenchmarkMetricSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>>;
}

function schemaFromEnv(env: EnvRecord): typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA {
  const requested = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA;
  return requested === BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA
    ? requested
    : BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA;
}

function candidateFromEnv(env: EnvRecord): BrowserNativeAdapterCandidateId {
  const candidate = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
  return candidate === STANDALONE_CHROMIUM_SURFACE_CANDIDATE
    ? candidate
    : STANDALONE_CHROMIUM_SURFACE_CANDIDATE;
}

function platformFromEnv(env: EnvRecord): BrowserNativeAdapterPlatform {
  const platform = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
  return platform === STANDALONE_CHROMIUM_SURFACE_PLATFORM
    ? platform
    : STANDALONE_CHROMIUM_SURFACE_PLATFORM;
}

function requiredSectionsFromEnv(env: EnvRecord): BrowserNativeAdapterBenchmarkMetricSection[] {
  const raw = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON;
  if (!raw) return [...DEFAULT_REQUIRED_SECTIONS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_REQUIRED_SECTIONS];
    const allowed = new Set<string>(DEFAULT_REQUIRED_SECTIONS);
    const sections = parsed.filter((section): section is BrowserNativeAdapterBenchmarkMetricSection => (
      typeof section === 'string' && allowed.has(section)
    ));
    return sections.length > 0 ? sections : [...DEFAULT_REQUIRED_SECTIONS];
  } catch {
    return [...DEFAULT_REQUIRED_SECTIONS];
  }
}

function parseArgs(raw: string | undefined): string[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`${STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON_ENV} must be a JSON string array`);
  }
  return parsed.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`${STANDALONE_CHROMIUM_SURFACE_REAL_ARGS_JSON_ENV} must contain only strings`);
    }
    return item;
  });
}

function assertExternalResultForCandidate(
  external: BrowserNativeAdapterPlatformBenchmarkExternalResult,
  candidateId: BrowserNativeAdapterCandidateId,
  platform: BrowserNativeAdapterPlatform,
): void {
  if (
    external.schemaVersion !== BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA
    || external.candidateId !== candidateId
    || external.platform !== platform
    || external.owner !== 'BrowserHostSession'
    || external.liveSurfaceTransport !== 'native-embedded'
    || external.singleInteractiveTruth !== true
    || external.secondTruthSource !== false
    || typeof external.benchmarkClaim !== 'boolean'
    || !external.metricSections
  ) {
    throw new Error('standalone Chromium real adapter command returned an invalid bounded external result');
  }
  assertBoundedExternalResult(JSON.stringify(external));
}

function assertTrustedLiveSmokeOptIn(env: EnvRecord): void {
  if (env[STANDALONE_CHROMIUM_SURFACE_RUN_LIVE_SMOKE_ENV] !== '1') {
    throw new Error('standalone Chromium external real command pass evidence requires trusted live adapter helper provenance');
  }
}

function assertBoundedExternalResult(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > MAX_EXTERNAL_RESULT_BYTES) {
    throw new Error('standalone Chromium external result must stay bounded.');
  }
  if (/data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i.test(text)) {
    throw new Error('standalone Chromium external result must not include raw payloads.');
  }
  if (/https?:\/\//i.test(text)) {
    throw new Error('standalone Chromium external result must not include raw URL strings.');
  }
  if (/"(?:rawUrl|url|requestedUrl|currentUrl|finalUrl|rawDom|dom|domSnapshot|screenshot|rawScreenshot|screenshotBase64|screenshotBytes|clipboard|selection|menu|provider|payload|rawPayload|providerPayload|consoleLog|networkLog|secret|token|password|credential|cookie|authorization|apiKey)"\s*:/i.test(text)) {
    throw new Error('standalone Chromium external result must not include forbidden raw URL, payload, log, or secret fields.');
  }
}

function hasStandaloneSecondTruthToken(external: BrowserNativeAdapterPlatformBenchmarkExternalResult): boolean {
  const refs = [
    external.adapterRun?.browserHostSessionRef,
    external.adapterRun?.liveSurfaceRef,
    external.adapterRun?.nativeAdapterSurfaceRef,
    external.adapterRun?.actionTraceRef,
    external.adapterRun?.platformResultRef,
    ...DEFAULT_REQUIRED_SECTIONS.flatMap((section) => external.metricSections?.[section]?.resultRefs ?? []),
    ...(external.diagnosticRefs ?? []),
  ];
  return refs.some((ref) => (
    typeof ref === 'string'
    && /(?:^|[/:_-])(?:external-browser|second-viewer|standalone-process-without-native-embedder|webview)(?:$|[/:_-])/i.test(ref)
  ));
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/trusted live adapter helper provenance/i.test(message)) {
    return 'trusted live adapter helper provenance required';
  }
  if (/nested adapter command provenance/i.test(message)) {
    return 'nested adapter command provenance required';
  }
  return `hash-${createHash('sha256').update(message).digest('hex').slice(0, 12)}`;
}

function boundedRealCommandEnv(input: {
  candidateId: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  requiredSections: BrowserNativeAdapterBenchmarkMetricSection[];
  env: EnvRecord;
}): EnvRecord {
  const bounded: EnvRecord = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TMPDIR: process.env.TMPDIR,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE: input.candidateId,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM: input.platform,
    SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA: schemaFromEnv(input.env),
    SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON: JSON.stringify(input.requiredSections),
  };
  for (const [key, value] of Object.entries(input.env)) {
    if (key.startsWith('SCIFORGE_BROWSER_NATIVE_ADAPTER_')) bounded[key] = value;
  }
  return bounded;
}

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await buildStandaloneChromiumSurfaceExternalBenchmarkResult())}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${shortError(error)}\n`);
    process.exitCode = 1;
  });
}
