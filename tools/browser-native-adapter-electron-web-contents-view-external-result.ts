import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  type DesktopBrowserNativeLiveAcceptanceEvidence,
  validateDesktopBrowserNativeLiveAcceptanceEvidence,
} from '../src/desktop/desktop-browser-native-live-acceptance.js';
import {
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
  type BrowserNativeAdapterPlatformBenchmarkExternalResult,
  type BrowserNativeAdapterPlatformBenchmarkExternalSection,
} from './browser-native-adapter-platform-benchmark-runner.js';
import type {
  BrowserNativeAdapterCandidateId,
  BrowserNativeAdapterPlatform,
} from '../src/desktop/browser-native-adapter-comparison.js';

const execFileAsync = promisify(execFile);

export const ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV =
  'SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_LIVE_EVIDENCE_PATH' as const;
export const ELECTRON_WEB_CONTENTS_VIEW_RUN_LIVE_SMOKE_ENV =
  'SCIFORGE_BROWSER_NATIVE_ADAPTER_ELECTRON_RUN_LIVE_SMOKE' as const;
export const DEFAULT_ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_REF =
  'docs/test-artifacts/desktop-browser-native-live-acceptance/manifest.json' as const;

const ELECTRON_WEB_CONTENTS_VIEW_CANDIDATE: BrowserNativeAdapterCandidateId = 'electron-web-contents-view';
const ELECTRON_WEB_CONTENTS_VIEW_PLATFORM: BrowserNativeAdapterPlatform = 'cross-platform';
const DEFAULT_REQUIRED_SECTIONS = [
  'latency',
  'cpu',
  'memory',
  'inputCompleteness',
  'lifecycle',
  'reconnect',
] as const;

type EnvRecord = Record<string, string | undefined>;
type RequiredSection = typeof DEFAULT_REQUIRED_SECTIONS[number];

type BuildOptions = {
  cwd?: string;
  env?: EnvRecord;
  now?: string;
};

export async function buildElectronWebContentsViewExternalBenchmarkResult(
  options: BuildOptions = {},
): Promise<BrowserNativeAdapterPlatformBenchmarkExternalResult> {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const candidateId = candidateFromEnv(env);
  const platform = platformFromEnv(env);
  const requiredSections = requiredSectionsFromEnv(env);
  const evidencePath = resolve(cwd, env[ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV] ?? DEFAULT_ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_REF);
  const diagnostics: string[] = [];

  if (env[ELECTRON_WEB_CONTENTS_VIEW_RUN_LIVE_SMOKE_ENV] === '1') {
    diagnostics.push('desktop-native-live-acceptance:live-smoke-executed');
    await execFileAsync('npm', ['run', 'smoke:desktop-browser-native-live-acceptance', '--silent'], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      timeout: 120_000,
      maxBuffer: 32_000,
    });
  } else if (!env[ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV]) {
    return blockedExternalResult({
      candidateId,
      platform,
      requiredSections,
      diagnosticRefs: [
        `env:${ELECTRON_WEB_CONTENTS_VIEW_RUN_LIVE_SMOKE_ENV}:not-set`,
        `env:${ELECTRON_WEB_CONTENTS_VIEW_LIVE_EVIDENCE_PATH_ENV}:missing-explicit-live-evidence`,
      ],
    });
  }

  const evidence = await readDesktopNativeLiveEvidence(evidencePath);
  const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(evidence);
  if (!validation.canClaimPass || candidateId !== ELECTRON_WEB_CONTENTS_VIEW_CANDIDATE || platform !== ELECTRON_WEB_CONTENTS_VIEW_PLATFORM) {
    return blockedExternalResult({
      candidateId,
      platform,
      requiredSections,
      diagnosticRefs: [
        ...diagnostics,
        `desktop-native-live-acceptance:${validation.canClaimPass ? 'pass' : 'nonpass'}`,
        `candidate:${candidateId}`,
        `platform:${platform}`,
      ],
    });
  }

  const proofSuffix = hashText([
    options.now ?? new Date().toISOString(),
    evidence.observedAt,
    evidence.browserHostSession?.id ?? '',
    evidence.surface?.surface ?? '',
  ].join('|'));
  const browserHostSessionRef = `browser-host-session:${evidence.browserHostSession?.id}`;
  return {
    schemaVersion: schemaFromEnv(env),
    candidateId,
    platform,
    owner: 'BrowserHostSession',
    singleInteractiveTruth: true,
    adapterRun: {
      resultKind: 'real-native-adapter-run',
      realAdapterResult: true,
      browserHostSessionRef,
      liveSurfaceRef: `${browserHostSessionRef}/live-surface`,
      nativeAdapterSurfaceRef: `benchmark-result:${candidateId}:native-adapter-surface:${proofSuffix}`,
      actionTraceRef: `benchmark-result:${candidateId}:action-trace:${proofSuffix}`,
      platformResultRef: `benchmark-result:${candidateId}:platform-summary:${proofSuffix}`,
      secondTruthSource: false,
      rawPayloadsCaptured: false,
    },
    status: 'blocked',
    benchmarkClaim: false,
    metricSections: metricSectionGaps(candidateId, requiredSections, proofSuffix),
    diagnosticRefs: [
      ...diagnostics,
      'desktop-native-live-acceptance:pass',
      'benchmark-metrics:required-sections-pending',
    ],
  };
}

function blockedExternalResult(input: {
  candidateId: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  requiredSections: RequiredSection[];
  diagnosticRefs: string[];
}): BrowserNativeAdapterPlatformBenchmarkExternalResult {
  return {
    schemaVersion: BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA,
    candidateId: input.candidateId,
    platform: input.platform,
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
    metricSections: metricSectionGaps(input.candidateId, input.requiredSections, 'notready'),
    diagnosticRefs: input.diagnosticRefs,
  };
}

function metricSectionGaps(
  candidateId: BrowserNativeAdapterCandidateId,
  sections: RequiredSection[],
  suffix: string,
): Record<RequiredSection, BrowserNativeAdapterPlatformBenchmarkExternalSection> {
  return Object.fromEntries(sections.map((section) => [section, {
    status: 'blocked',
    resultRefs: [`benchmark-result:${candidateId}:${section}:${suffix}`],
  }])) as Record<RequiredSection, BrowserNativeAdapterPlatformBenchmarkExternalSection>;
}

async function readDesktopNativeLiveEvidence(path: string): Promise<DesktopBrowserNativeLiveAcceptanceEvidence> {
  const text = await readFile(path, 'utf8');
  assertBoundedExternalInput(text);
  return JSON.parse(text) as DesktopBrowserNativeLiveAcceptanceEvidence;
}

function schemaFromEnv(env: EnvRecord): typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA {
  const requested = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_EXTERNAL_RESULT_SCHEMA;
  return requested === BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA
    ? requested
    : BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_EXTERNAL_RESULT_SCHEMA;
}

function candidateFromEnv(env: EnvRecord): BrowserNativeAdapterCandidateId {
  const candidate = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_CANDIDATE;
  return candidate === ELECTRON_WEB_CONTENTS_VIEW_CANDIDATE ? candidate : ELECTRON_WEB_CONTENTS_VIEW_CANDIDATE;
}

function platformFromEnv(env: EnvRecord): BrowserNativeAdapterPlatform {
  const platform = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM;
  return platform === ELECTRON_WEB_CONTENTS_VIEW_PLATFORM ? platform : ELECTRON_WEB_CONTENTS_VIEW_PLATFORM;
}

function requiredSectionsFromEnv(env: EnvRecord): RequiredSection[] {
  const raw = env.SCIFORGE_BROWSER_NATIVE_ADAPTER_REQUIRED_SECTIONS_JSON;
  if (!raw) return [...DEFAULT_REQUIRED_SECTIONS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_REQUIRED_SECTIONS];
    const allowed = new Set<string>(DEFAULT_REQUIRED_SECTIONS);
    const sections = parsed.filter((section): section is RequiredSection => typeof section === 'string' && allowed.has(section));
    return sections.length > 0 ? sections : [...DEFAULT_REQUIRED_SECTIONS];
  } catch {
    return [...DEFAULT_REQUIRED_SECTIONS];
  }
}

function assertBoundedExternalInput(text: string): void {
  if (Buffer.byteLength(text, 'utf8') > 96_000) {
    throw new Error('Electron WebContentsView live evidence must stay bounded.');
  }
  if (/data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i.test(text)) {
    throw new Error('Electron WebContentsView live evidence must not include raw payloads.');
  }
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

async function main(): Promise<void> {
  const result = await buildElectronWebContentsViewExternalBenchmarkResult();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
