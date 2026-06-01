import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  buildBrowserNativeAdapterComparisonManifest,
  validateBrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterDimension,
  type BrowserNativeAdapterComparisonManifest,
  type BrowserNativeAdapterMetricsContract,
} from '../../src/desktop/browser-native-adapter-comparison.js';

const SMOKE_ARTIFACT_SCHEMA = 'sciforge.browser-native-adapter-comparison-smoke.v1' as const;
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-native-adapter-comparison');
const manifestPath = join(artifactDir, 'manifest.json');

type NegativeFixtureReport = {
  fixtureId: string;
  status: 'rejected-as-expected' | 'accepted-unexpectedly';
  rejectionCount: number;
  coverage: string[];
};

test('browser native adapter comparison contract accepts refs-first candidate and decision fixtures', () => {
  const manifest = buildPositiveComparisonManifest();

  assert.deepEqual(validateBrowserNativeAdapterComparisonManifest(manifest), []);
  assert.equal(manifest.purpose, 'contract-only-no-real-benchmark');
  assert.equal(manifest.benchmarkMode, 'contract-fixture');
  assert.equal(manifest.owner, 'BrowserHostSession');
  assert.equal(manifest.singleInteractiveTruth, true);
  assert.equal(manifest.productLongSession.durationMinutes, 30);
  assert.equal(manifest.productLongSession.benchmarkClaim, false);
  assert.equal(manifest.productLongSession.mode, 'schema-only-no-real-platform-benchmark');
  assert.equal(manifest.productLongSession.decisionRequiresRealBenchmark, true);
  assert.deepEqual(manifest.productLongSession.candidateIds, [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES]);
  assert.deepEqual(manifest.productLongSession.requiredMetricSections, [...REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS]);
  assert.deepEqual(manifest.candidates.map((candidate) => candidate.id), [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES]);
  assert.ok(manifest.invariants.every((invariant) => invariant.status === 'pass'));
  assert.ok(manifest.rejectedSubstitutes.includes('second-viewer'));
  for (const candidate of manifest.candidates) {
    assert.equal(candidate.owner, 'BrowserHostSession');
    assert.equal(candidate.adapterRole, 'display-input-adapter');
    assert.equal(candidate.liveSurfaceTransport, 'native-embedded');
    assert.equal(candidate.secondTruthSource, false);
    assert.ok(candidate.comparisonRefs.length > 0);
    assert.deepEqual(Object.keys(candidate.metrics), [...REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS]);
    assert.equal(candidate.metrics.secondTruthSource.value, false);
    for (const section of REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS) {
      assert.equal(candidate.metrics[section].evidenceMode, 'bounded-summary-ref');
      assert.equal(candidate.metrics[section].inlineEvidence, 'forbidden');
      assert.ok(candidate.metrics[section].fields.length > 0);
    }
  }

  const manifestText = JSON.stringify(manifest);
  assert.doesNotMatch(manifestText, /data:image|<\s*(?:!doctype|html|body|iframe)\b/i);
});

test('browser native adapter comparison contract rejects raw payloads and second truth sources', () => {
  const issues = rawPayloadAndSecondTruthFixtureIssues();
  const issueText = issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');

  assert.match(issueText, /candidates\[1\]\.secondTruthSource/);
  assert.match(issueText, /candidates\[1\]\.metrics\.secondTruthSource\.value/);
  assert.match(issueText, /candidates\[1\]\.comparisonRefs/);
  assert.match(issueText, /invariants\.no-second-truth-source/);
  assert.match(issueText, /rawDomSnapshot/);
  assert.match(issueText, /screenshotBase64/);
});

test('browser native adapter comparison contract rejects missing product and platform metrics', () => {
  const issues = missingProductAndPlatformMetricFixtureIssues();
  const issueText = issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n');

  assert.match(issueText, /productLongSession/);
  assert.match(issueText, /candidates\[2\]\.metrics\.latency\.fields\.p95ActionAckMs/);
  assert.match(issueText, /candidates\[2\]\.metrics\.cpu/);
  assert.match(issueText, /invariants\.refs-first-comparison-evidence/);
});

test('browser native adapter comparison contract rejects incomplete candidate matrices', () => {
  const issues = incompleteCandidateMatrixFixtureIssues();
  assert.ok(issues.some((issue) => issue.message.includes('missing required native adapter candidate: wkwebview')));
});

test('browser native adapter comparison smoke writes bounded refs-first evidence artifact', async () => {
  const manifest = buildPositiveComparisonManifest();
  const validationIssues = validateBrowserNativeAdapterComparisonManifest(manifest);
  assert.deepEqual(validationIssues, []);

  const negativeFixtureRejections = [
    negativeFixtureReport(
      'inline-payload-and-second-owner-fixture',
      rawPayloadAndSecondTruthFixtureIssues(),
      ['bounded-evidence-policy', 'single-interactive-truth', 'candidate-comparison-refs'],
    ),
    negativeFixtureReport(
      'missing-product-and-platform-metrics-fixture',
      missingProductAndPlatformMetricFixtureIssues(),
      ['product-long-session-schema', 'required-platform-metric-sections'],
    ),
    negativeFixtureReport(
      'incomplete-candidate-matrix-fixture',
      incompleteCandidateMatrixFixtureIssues(),
      ['required-candidate-matrix'],
    ),
  ];
  assert.ok(negativeFixtureRejections.every((fixture) => fixture.status === 'rejected-as-expected'));
  assert.ok(negativeFixtureRejections.every((fixture) => fixture.rejectionCount > 0));

  const evidence = {
    schemaVersion: SMOKE_ARTIFACT_SCHEMA,
    status: 'passed',
    observedAt: new Date().toISOString(),
    manifestId: 'browser-native-adapter-comparison-smoke-artifact',
    boundedEvidence: {
      refsFirst: true,
      inlinePayloadStorage: 'forbidden',
      imageByteStorage: 'forbidden',
      documentMarkupStorage: 'forbidden',
      externalProviderResponseStorage: 'forbidden',
    },
    benchmarkScope: {
      mode: manifest.benchmarkMode,
      cpu: 'metric-schema-only',
      memory: 'metric-schema-only',
      thirtyMinuteSession: manifest.productLongSession.mode,
      livePlatformBenchmark: 'not-run-by-this-smoke',
    },
    comparisonContract: {
      schemaVersion: manifest.schemaVersion,
      purpose: manifest.purpose,
      owner: manifest.owner,
      singleInteractiveTruth: manifest.singleInteractiveTruth,
      evidenceRefs: manifest.evidenceRefs,
      invariantStatus: manifest.invariants.map((invariant) => ({
        id: invariant.id,
        status: invariant.status,
      })),
      rejectedSubstitutes: {
        status: 'covered',
        count: manifest.rejectedSubstitutes.length,
        ids: manifest.rejectedSubstitutes,
      },
    },
    candidateMatrix: manifest.candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      platform: candidate.platform,
      nativeSurface: candidate.nativeSurface,
      surfaceApi: candidate.surfaceApi,
      inputApi: candidate.inputApi,
      paintAck: candidate.paintAck,
      packaging: candidate.packaging,
      owner: candidate.owner,
      adapterRole: candidate.adapterRole,
      liveSurfaceTransport: candidate.liveSurfaceTransport,
      secondTruthSource: candidate.secondTruthSource,
      comparisonRefs: candidate.comparisonRefs,
      metricSections: REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS.map((section) => ({
        section,
        evidenceMode: candidate.metrics[section].evidenceMode,
        inlineEvidence: candidate.metrics[section].inlineEvidence,
        requiredFieldCount: candidate.metrics[section].fields.length,
      })),
    })),
    decision: manifest.decision,
    productLongSessionSchemaCoverage: {
      status: 'covered',
      durationMinutes: manifest.productLongSession.durationMinutes,
      workload: manifest.productLongSession.workload,
      benchmarkClaim: manifest.productLongSession.benchmarkClaim,
      mode: manifest.productLongSession.mode,
      evidenceMode: manifest.productLongSession.evidenceMode,
      refsFirst: manifest.productLongSession.refsFirst,
      decisionRequiresRealBenchmark: manifest.productLongSession.decisionRequiresRealBenchmark,
      candidateIds: manifest.productLongSession.candidateIds,
      requiredMetricSections: manifest.productLongSession.requiredMetricSections,
      candidateMatrixCoverage: {
        status: arraysEqual(manifest.productLongSession.candidateIds, REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES)
          ? 'covered'
          : 'missing',
        count: manifest.productLongSession.candidateIds.length,
      },
      metricSchemaCoverage: {
        status: arraysEqual(manifest.productLongSession.requiredMetricSections, REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS)
          ? 'covered'
          : 'missing',
        count: manifest.productLongSession.requiredMetricSections.length,
      },
    },
    negativeFixtureRejections,
    verificationCommand: 'npm run smoke:browser-native-adapter-comparison --silent',
  };

  await writeEvidenceArtifact(evidence);
});

function buildPositiveComparisonManifest(): BrowserNativeAdapterComparisonManifest {
  return buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-comparison-contract-positive',
    createdAt: '2026-06-02T00:00:00.000Z',
    evidenceRefs: [
      'PROJECT_browser.md:Electron/WebView2/WKWebView performance comparison',
      'browser-native-adapter-comparison:bounded-fixture',
    ],
    decision: {
      status: 'undecided',
      rationaleRefs: ['browser-native-adapter-comparison:rationale:refs-first'],
      followUpRefs: ['browser-native-adapter-comparison:future-live-platform-benchmark'],
    },
  });
}

function rawPayloadAndSecondTruthFixtureIssues() {
  const manifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-comparison-contract-negative',
    createdAt: '2026-06-02T00:00:00.000Z',
  });
  const invalid = manifest as BrowserNativeAdapterComparisonManifest & {
    rawDomSnapshot?: string;
    screenshotBase64?: string;
  };
  invalid.candidates = invalid.candidates.map((candidate) => (
    candidate.id === 'webview2'
      ? {
        ...candidate,
        owner: 'BrowserHostSession' as const,
        adapterRole: 'display-input-adapter' as const,
        liveSurfaceTransport: 'native-embedded' as const,
        secondTruthSource: true as false,
        metrics: {
          ...candidate.metrics,
          secondTruthSource: {
            ...candidate.metrics.secondTruthSource,
            value: true as false,
          },
        },
        comparisonRefs: [],
      }
      : candidate
  ));
  invalid.rawDomSnapshot = '<html><body>not refs-first</body></html>';
  invalid.screenshotBase64 = 'data:image/png;base64,fixture';
  invalid.rejectedSubstitutes = invalid.rejectedSubstitutes.filter((substitute) => substitute !== 'second-viewer');

  return validateBrowserNativeAdapterComparisonManifest(invalid);
}

function missingProductAndPlatformMetricFixtureIssues() {
  type MutableCandidate = Omit<BrowserNativeAdapterDimension, 'metrics'> & {
    metrics?: Partial<BrowserNativeAdapterMetricsContract>;
  };
  type MutableManifest = Omit<BrowserNativeAdapterComparisonManifest, 'productLongSession' | 'candidates'> & {
    productLongSession?: BrowserNativeAdapterComparisonManifest['productLongSession'];
    candidates: MutableCandidate[];
  };

  const manifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-comparison-contract-missing-metrics',
    createdAt: '2026-06-02T00:00:00.000Z',
  }) as unknown as MutableManifest;

  delete manifest.productLongSession;
  const wkwebview = manifest.candidates.find((candidate) => candidate.id === 'wkwebview');
  assert.ok(wkwebview?.metrics?.latency, 'wkwebview fixture should have latency metrics before mutation');
  wkwebview.metrics.latency = {
    ...wkwebview.metrics.latency,
    fields: wkwebview.metrics.latency.fields.filter((field) => field.field !== 'p95ActionAckMs'),
  };
  delete wkwebview.metrics.cpu;

  return validateBrowserNativeAdapterComparisonManifest(manifest as unknown as BrowserNativeAdapterComparisonManifest);
}

function incompleteCandidateMatrixFixtureIssues() {
  const manifest = buildBrowserNativeAdapterComparisonManifest({
    manifestId: 'browser-native-adapter-comparison-contract-missing-candidate',
    createdAt: '2026-06-02T00:00:00.000Z',
  });
  manifest.candidates = manifest.candidates.filter((candidate) => candidate.id !== 'wkwebview');

  return validateBrowserNativeAdapterComparisonManifest(manifest);
}

function negativeFixtureReport(
  fixtureId: string,
  issues: ReturnType<typeof validateBrowserNativeAdapterComparisonManifest>,
  coverage: string[],
): NegativeFixtureReport {
  return {
    fixtureId,
    status: issues.length > 0 ? 'rejected-as-expected' : 'accepted-unexpectedly',
    rejectionCount: issues.length,
    coverage,
  };
}

async function writeEvidenceArtifact(evidence: unknown): Promise<void> {
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoUnboundedPayloads(text);
  await mkdir(artifactDir, { recursive: true });
  await writeFile(manifestPath, text, 'utf8');

  const persistedText = await readFile(manifestPath, 'utf8');
  assertNoUnboundedPayloads(persistedText);
  const persisted = JSON.parse(persistedText) as {
    schemaVersion?: string;
    status?: string;
    candidateMatrix?: unknown[];
    productLongSessionSchemaCoverage?: { status?: string };
    negativeFixtureRejections?: NegativeFixtureReport[];
  };
  assert.equal(persisted.schemaVersion, SMOKE_ARTIFACT_SCHEMA);
  assert.equal(persisted.status, 'passed');
  assert.equal(persisted.candidateMatrix?.length, REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.length);
  assert.equal(persisted.productLongSessionSchemaCoverage?.status, 'covered');
  assert.ok(persisted.negativeFixtureRejections?.every((fixture) => (
    fixture.status === 'rejected-as-expected' && fixture.rejectionCount > 0
  )));
}

function assertNoUnboundedPayloads(text: string): void {
  assert.doesNotMatch(text, /data:image|;base64,|iVBORw0KGgo|<\s*(?:!doctype|html|body|script|iframe|webview)\b/i);
  assert.doesNotMatch(text, /providerPayload|inlineFrameBytes|consoleLog|networkLog/i);
}

function arraysEqual<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}
