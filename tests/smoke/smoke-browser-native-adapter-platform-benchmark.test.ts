import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

const PLATFORM_BENCHMARK_MANIFEST_SCHEMA = 'sciforge.browser-native-adapter-platform-benchmark-manifest.v1' as const;
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-native-adapter-comparison');
const comparisonManifestRef = 'docs/test-artifacts/browser-native-adapter-comparison/manifest.json';
const platformBenchmarkManifestRef = 'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-manifest.json';
const platformBenchmarkManifestPath = join(artifactDir, 'platform-benchmark-manifest.json');
const DIRECT_VERIFICATION_COMMAND = 'node --import tsx --test tests/smoke/smoke-browser-native-adapter-platform-benchmark.test.ts';
const REAL_RUNNER_OPT_IN_ENV = 'SCIFORGE_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK';
const REAL_RUNNER_COMMAND_REF = 'future:browser-native-adapter-platform-benchmark-runner';
const MAX_PLATFORM_BENCHMARK_MANIFEST_BYTES = 64_000;

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
    expectedResultArtifactRef: 'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-results.json';
    requiredResultStatusValues: Array<'passed' | 'blocked' | 'failed'>;
    handoffContract: {
      inputRefs: string[];
      outputRefs: string[];
      resultPatchRules: string[];
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
      expectedResultArtifactRef: 'docs/test-artifacts/browser-native-adapter-comparison/platform-benchmark-results.json',
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

function assertPlatformBenchmarkArtifactIsBounded(text: string): void {
  assert.doesNotMatch(text, /data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i);
  assert.doesNotMatch(text, /"(?:rawDom|domSnapshot|screenshotBase64|providerPayload|consoleLog|networkLog)"\s*:/i);
  assert.doesNotMatch(text, /"payload"\s*:\s*"(?:\{|<|data:)/i);
}
