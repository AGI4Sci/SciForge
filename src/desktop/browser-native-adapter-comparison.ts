export const BROWSER_NATIVE_ADAPTER_COMPARISON_SCHEMA_VERSION = 'browser-native-adapter-comparison/v0.1';

export const REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES = [
  'electron-web-contents-view',
  'webview2',
  'wkwebview',
  'standalone-chromium-surface',
] as const;

export type BrowserNativeAdapterCandidateId = typeof REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES[number];

export const REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS = {
  'electron-web-contents-view': 'cross-platform',
  webview2: 'windows',
  wkwebview: 'macos',
  'standalone-chromium-surface': 'cross-platform',
} as const satisfies Record<BrowserNativeAdapterCandidateId, BrowserNativeAdapterPlatform>;

export const REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS = [
  'latency',
  'cpu',
  'memory',
  'inputCompleteness',
  'lifecycle',
  'reconnect',
] as const;

export const REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS = [
  ...REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS,
  'secondTruthSource',
] as const;

export type BrowserNativeAdapterMetricSection = typeof REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS[number];
export type BrowserNativeAdapterBenchmarkMetricSection = typeof REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS[number];

export const REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES = [
  'iframe',
  'proxy',
  'snapshot',
  'legacy-frame',
  'host-stream',
  'frame-stream',
  'canvas',
  'canvas-binary',
  'webrtc',
  'websocket-binary',
  'http-frame',
  'webview-tag',
  'system-popup',
  'external-browser',
  'second-viewer',
] as const;

export type RejectedBrowserNativeAdapterPassEvidenceSubstitute =
  typeof REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES[number];

const REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_FIELDS: Record<BrowserNativeAdapterMetricSection, readonly string[]> = {
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
  secondTruthSource: [
    'secondTruthSource',
  ],
};

export type BrowserNativeAdapterPlatform = 'cross-platform' | 'windows' | 'macos' | 'linux';

export type BrowserNativeAdapterMetricUnit = 'ms' | 'percent' | 'mb' | 'count' | 'boolean' | 'event';

export type BrowserNativeAdapterMetricFieldContract = {
  field: string;
  unit: BrowserNativeAdapterMetricUnit;
  required: true;
  source: 'bounded-summary-ref' | 'runtime-state';
};

export type BrowserNativeAdapterMetricContract = {
  section: Exclude<BrowserNativeAdapterMetricSection, 'secondTruthSource'>;
  evidenceMode: 'bounded-summary-ref';
  inlineEvidence: 'forbidden';
  fields: BrowserNativeAdapterMetricFieldContract[];
};

export type BrowserNativeAdapterSecondTruthSourceMetricContract = {
  section: 'secondTruthSource';
  evidenceMode: 'bounded-summary-ref';
  inlineEvidence: 'forbidden';
  value: false;
  fields: BrowserNativeAdapterMetricFieldContract[];
};

export type BrowserNativeAdapterMetricsContract = {
  latency: BrowserNativeAdapterMetricContract;
  cpu: BrowserNativeAdapterMetricContract;
  memory: BrowserNativeAdapterMetricContract;
  inputCompleteness: BrowserNativeAdapterMetricContract;
  lifecycle: BrowserNativeAdapterMetricContract;
  reconnect: BrowserNativeAdapterMetricContract;
  secondTruthSource: BrowserNativeAdapterSecondTruthSourceMetricContract;
};

export type BrowserNativeProductLongSessionContract = {
  durationMinutes: 30;
  workload: 'product-long-session';
  benchmarkClaim: false;
  mode: 'schema-only-no-real-platform-benchmark';
  candidateIds: BrowserNativeAdapterCandidateId[];
  requiredMetricSections: BrowserNativeAdapterMetricSection[];
  evidenceMode: 'bounded-summary-ref';
  refsFirst: true;
  decisionRequiresRealBenchmark: true;
};

export type BrowserNativeAdapterDimension = {
  id: BrowserNativeAdapterCandidateId;
  label: string;
  platform: BrowserNativeAdapterPlatform;
  nativeSurface: 'embedded-view' | 'external-owned-window';
  surfaceApi: string;
  inputApi: string;
  paintAck: 'native-event' | 'state-heartbeat-required' | 'not-yet-defined';
  packaging: 'bundled-with-shell' | 'system-runtime' | 'sidecar-process';
  owner: 'BrowserHostSession';
  adapterRole: 'display-input-adapter';
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  metrics: BrowserNativeAdapterMetricsContract;
  comparisonRefs: string[];
  notes?: string[];
};

export type BrowserNativeAdapterComparisonDecision = {
  status: 'undecided' | 'selected' | 'blocked';
  selectedAdapterId?: BrowserNativeAdapterCandidateId;
  decisionFields: {
    targetPlatforms: BrowserNativeAdapterPlatform[];
    latencySignal: 'bounded-summary-only';
    inputParity: 'unknown' | 'partial' | 'acceptable';
    paintAckConfidence: 'unknown' | 'needs-live-evidence' | 'acceptable';
    packagingRisk: 'unknown' | 'low' | 'medium' | 'high';
    ownershipRisk: 'must-remain-single-owner';
  };
  rationaleRefs: string[];
  followUpRefs: string[];
};

export type BrowserNativeAdapterComparisonInvariant = {
  id: string;
  description: string;
  status: 'pass' | 'fail';
};

export type BrowserNativeAdapterComparisonManifest = {
  schemaVersion: typeof BROWSER_NATIVE_ADAPTER_COMPARISON_SCHEMA_VERSION;
  manifestId: string;
  createdAt: string;
  purpose: 'contract-only-no-real-benchmark';
  benchmarkMode: 'contract-fixture';
  owner: 'BrowserHostSession';
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  candidates: BrowserNativeAdapterDimension[];
  productLongSession: BrowserNativeProductLongSessionContract;
  decision: BrowserNativeAdapterComparisonDecision;
  invariants: BrowserNativeAdapterComparisonInvariant[];
  evidenceRefs: string[];
  rejectedSubstitutes: RejectedBrowserNativeAdapterPassEvidenceSubstitute[];
};

export type BrowserNativeAdapterComparisonValidationIssue = {
  path: string;
  message: string;
};

export function defaultBrowserNativeAdapterCandidates(): BrowserNativeAdapterDimension[] {
  return [{
    id: 'electron-web-contents-view',
    label: 'Electron WebContentsView',
    platform: 'cross-platform',
    nativeSurface: 'embedded-view',
    surfaceApi: 'Electron.WebContentsView',
    inputApi: 'webContents.sendInputEvent/insertText',
    paintAck: 'state-heartbeat-required',
    packaging: 'bundled-with-shell',
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    metrics: defaultBrowserNativeAdapterMetrics(),
    comparisonRefs: ['docs:electron-webcontentsview-contract'],
  }, {
    id: 'webview2',
    label: 'Microsoft WebView2',
    platform: 'windows',
    nativeSurface: 'embedded-view',
    surfaceApi: 'CoreWebView2Controller',
    inputApi: 'platform-window-input-forwarding',
    paintAck: 'not-yet-defined',
    packaging: 'system-runtime',
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    metrics: defaultBrowserNativeAdapterMetrics(),
    comparisonRefs: ['docs:webview2-contract'],
  }, {
    id: 'wkwebview',
    label: 'WKWebView',
    platform: 'macos',
    nativeSurface: 'embedded-view',
    surfaceApi: 'WKWebView',
    inputApi: 'NSResponder-event-routing',
    paintAck: 'not-yet-defined',
    packaging: 'system-runtime',
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    metrics: defaultBrowserNativeAdapterMetrics(),
    comparisonRefs: ['docs:wkwebview-contract'],
  }, {
    id: 'standalone-chromium-surface',
    label: 'Standalone Chromium Surface',
    platform: 'cross-platform',
    nativeSurface: 'external-owned-window',
    surfaceApi: 'Chromium sidecar window embed/attach',
    inputApi: 'CDP input dispatch through BrowserHostSession',
    paintAck: 'native-event',
    packaging: 'sidecar-process',
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    metrics: defaultBrowserNativeAdapterMetrics(),
    comparisonRefs: ['docs:standalone-chromium-surface-contract'],
    notes: ['Must not become a second browser owner when attached to the shell.'],
  }];
}

export function defaultBrowserNativeAdapterMetrics(): BrowserNativeAdapterMetricsContract {
  return {
    latency: metricContract('latency', 'ms', 'bounded-summary-ref'),
    cpu: metricContract('cpu', 'percent', 'bounded-summary-ref'),
    memory: metricContract('memory', 'mb', 'bounded-summary-ref'),
    inputCompleteness: metricContract('inputCompleteness', 'boolean', 'runtime-state'),
    lifecycle: metricContract('lifecycle', 'event', 'runtime-state'),
    reconnect: metricContract('reconnect', 'boolean', 'runtime-state'),
    secondTruthSource: {
      section: 'secondTruthSource',
      evidenceMode: 'bounded-summary-ref',
      inlineEvidence: 'forbidden',
      value: false,
      fields: [{
        field: 'secondTruthSource',
        unit: 'boolean',
        required: true,
        source: 'runtime-state',
      }],
    },
  };
}

export function defaultBrowserNativeProductLongSessionContract(): BrowserNativeProductLongSessionContract {
  return {
    durationMinutes: 30,
    workload: 'product-long-session',
    benchmarkClaim: false,
    mode: 'schema-only-no-real-platform-benchmark',
    candidateIds: [...REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES],
    requiredMetricSections: [...REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS],
    evidenceMode: 'bounded-summary-ref',
    refsFirst: true,
    decisionRequiresRealBenchmark: true,
  };
}

export function buildBrowserNativeAdapterComparisonManifest(input: {
  manifestId: string;
  createdAt?: string;
  candidates?: BrowserNativeAdapterDimension[];
  productLongSession?: BrowserNativeProductLongSessionContract;
  decision?: Partial<BrowserNativeAdapterComparisonDecision>;
  evidenceRefs?: string[];
}): BrowserNativeAdapterComparisonManifest {
  const decision = normalizeDecision(input.decision);
  const manifest: BrowserNativeAdapterComparisonManifest = {
    schemaVersion: BROWSER_NATIVE_ADAPTER_COMPARISON_SCHEMA_VERSION,
    manifestId: input.manifestId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    purpose: 'contract-only-no-real-benchmark',
    benchmarkMode: 'contract-fixture',
    owner: 'BrowserHostSession',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    candidates: input.candidates ?? defaultBrowserNativeAdapterCandidates(),
    productLongSession: input.productLongSession ?? defaultBrowserNativeProductLongSessionContract(),
    decision,
    invariants: [],
    evidenceRefs: input.evidenceRefs ?? ['browser-native-adapter-comparison:contract-fixture'],
    rejectedSubstitutes: [...REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES],
  };
  manifest.invariants = browserNativeAdapterComparisonInvariants(manifest);
  return manifest;
}

export function validateBrowserNativeAdapterComparisonManifest(
  manifest: BrowserNativeAdapterComparisonManifest,
): BrowserNativeAdapterComparisonValidationIssue[] {
  const issues: BrowserNativeAdapterComparisonValidationIssue[] = [];
  if (manifest.schemaVersion !== BROWSER_NATIVE_ADAPTER_COMPARISON_SCHEMA_VERSION) {
    issues.push({ path: 'schemaVersion', message: 'unsupported browser native adapter comparison schema version' });
  }
  if (manifest.purpose !== 'contract-only-no-real-benchmark' || manifest.benchmarkMode !== 'contract-fixture') {
    issues.push({ path: 'benchmarkMode', message: 'comparison contract must not claim a real platform benchmark' });
  }
  if (manifest.owner !== 'BrowserHostSession' || manifest.singleInteractiveTruth !== true) {
    issues.push({ path: 'owner', message: 'BrowserHostSession must remain the single interactive truth source' });
  }
  if (manifest.liveSurfaceTransport !== 'native-embedded') {
    issues.push({ path: 'liveSurfaceTransport', message: 'comparison manifest must declare liveSurfaceTransport=native-embedded' });
  }
  if (manifest.secondTruthSource !== false) {
    issues.push({ path: 'secondTruthSource', message: 'comparison manifest must declare secondTruthSource=false' });
  }
  if (manifest.evidenceRefs.length === 0) {
    issues.push({ path: 'evidenceRefs', message: 'manifest evidence must be refs-first' });
  }
  if (manifest.decision.rationaleRefs.length === 0) {
    issues.push({ path: 'decision.rationaleRefs', message: 'decision rationale must be represented by refs' });
  }
  issues.push(...validateProductLongSessionContract(manifest.productLongSession));
  for (const required of REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES) {
    if (!manifest.candidates.some((candidate) => candidate.id === required)) {
      issues.push({ path: 'candidates', message: `missing required native adapter candidate: ${required}` });
    }
  }
  manifest.candidates.forEach((candidate, index) => {
    const path = `candidates[${index}]`;
    if (candidate.owner !== 'BrowserHostSession') {
      issues.push({ path: `${path}.owner`, message: 'candidate must not own browser state outside BrowserHostSession' });
    }
    if (candidate.adapterRole !== 'display-input-adapter') {
      issues.push({ path: `${path}.adapterRole`, message: 'candidate must be a display/input adapter only' });
    }
    if (candidate.liveSurfaceTransport !== 'native-embedded') {
      issues.push({ path: `${path}.liveSurfaceTransport`, message: 'candidate must describe the native embedded live surface path' });
    }
    if (candidate.singleInteractiveTruth !== true) {
      issues.push({ path: `${path}.singleInteractiveTruth`, message: 'candidate must keep singleInteractiveTruth=true' });
    }
    if (candidate.secondTruthSource !== false) {
      issues.push({ path: `${path}.secondTruthSource`, message: 'candidate must explicitly reject a second truth source' });
    }
    if (candidate.comparisonRefs.length === 0) {
      issues.push({ path: `${path}.comparisonRefs`, message: 'candidate comparison evidence must be refs-first' });
    }
    if (candidate.platform !== REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidate.id]) {
      issues.push({
        path: `${path}.platform`,
        message: `candidate ${candidate.id} must keep canonical platform ${REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidate.id]}`,
      });
    }
    issues.push(...validateCandidateMetrics(candidate, path));
  });
  const invariantFailures = browserNativeAdapterComparisonInvariants(manifest)
    .filter((invariant) => invariant.status === 'fail');
  issues.push(...invariantFailures.map((invariant) => ({
    path: `invariants.${invariant.id}`,
    message: invariant.description,
  })));
  issues.push(...findRawPayloadIssues(manifest));
  return issues;
}

export function browserNativeAdapterComparisonInvariants(
  manifest: BrowserNativeAdapterComparisonManifest,
): BrowserNativeAdapterComparisonInvariant[] {
  const allCandidatesAreAdapters = manifest.candidates.every((candidate) => (
    candidate.owner === 'BrowserHostSession'
    && candidate.adapterRole === 'display-input-adapter'
    && candidate.liveSurfaceTransport === 'native-embedded'
    && candidate.singleInteractiveTruth === true
  )) && manifest.liveSurfaceTransport === 'native-embedded';
  const noSecondTruthSource = manifest.owner === 'BrowserHostSession'
    && manifest.singleInteractiveTruth === true
    && manifest.secondTruthSource === false
    && manifest.candidates.every((candidate) => candidate.secondTruthSource === false)
    && REJECTED_BROWSER_NATIVE_ADAPTER_PASS_EVIDENCE_SUBSTITUTES.every((substitute) => (
      manifest.rejectedSubstitutes.includes(substitute)
    ));
  const refsFirst = manifest.evidenceRefs.length > 0
    && manifest.decision.rationaleRefs.length > 0
    && manifest.candidates.every((candidate) => candidate.comparisonRefs.length > 0)
    && validateProductLongSessionContract(manifest.productLongSession).length === 0
    && manifest.candidates.every((candidate, index) => validateCandidateMetrics(candidate, `candidates[${index}]`).length === 0)
    && findRawPayloadIssues(manifest).length === 0;
  return [{
    id: 'single-browser-host-session-owner',
    description: 'All candidates are display/input adapters attached to BrowserHostSession, never browser state owners.',
    status: allCandidatesAreAdapters ? 'pass' : 'fail',
  }, {
    id: 'no-second-truth-source',
    description: 'The comparison rejects iframe/proxy/snapshot/system-popup/second-viewer fallbacks as live browser truth.',
    status: noSecondTruthSource ? 'pass' : 'fail',
  }, {
    id: 'refs-first-comparison-evidence',
    description: 'The manifest stores bounded refs and summary fields, not raw DOM, base64 screenshots, or raw logs.',
    status: refsFirst ? 'pass' : 'fail',
  }];
}

function metricContract(
  section: Exclude<BrowserNativeAdapterMetricSection, 'secondTruthSource'>,
  unit: BrowserNativeAdapterMetricUnit,
  source: 'bounded-summary-ref' | 'runtime-state',
): BrowserNativeAdapterMetricContract {
  return {
    section,
    evidenceMode: 'bounded-summary-ref',
    inlineEvidence: 'forbidden',
    fields: REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_FIELDS[section].map((field) => ({
      field,
      unit,
      required: true,
      source,
    })),
  };
}

function validateProductLongSessionContract(
  productLongSession: BrowserNativeProductLongSessionContract | undefined,
): BrowserNativeAdapterComparisonValidationIssue[] {
  const issues: BrowserNativeAdapterComparisonValidationIssue[] = [];
  if (!productLongSession) {
    return [{ path: 'productLongSession', message: '30-minute product long-session contract is required' }];
  }
  if (productLongSession.durationMinutes !== 30) {
    issues.push({ path: 'productLongSession.durationMinutes', message: 'product long-session contract must target 30 minutes' });
  }
  if (
    productLongSession.workload !== 'product-long-session'
    || productLongSession.mode !== 'schema-only-no-real-platform-benchmark'
    || productLongSession.benchmarkClaim !== false
  ) {
    issues.push({ path: 'productLongSession.mode', message: 'product long-session contract must be schema-only and must not claim a real benchmark' });
  }
  if (productLongSession.evidenceMode !== 'bounded-summary-ref' || productLongSession.refsFirst !== true) {
    issues.push({ path: 'productLongSession.evidenceMode', message: 'product long-session contract must be bounded and refs-first' });
  }
  if (productLongSession.decisionRequiresRealBenchmark !== true) {
    issues.push({ path: 'productLongSession.decisionRequiresRealBenchmark', message: 'adapter decisions require a future real platform benchmark' });
  }
  for (const required of REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES) {
    if (!productLongSession.candidateIds.includes(required)) {
      issues.push({ path: 'productLongSession.candidateIds', message: `missing product long-session candidate: ${required}` });
    }
  }
  for (const required of REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS) {
    if (!productLongSession.requiredMetricSections.includes(required)) {
      issues.push({ path: 'productLongSession.requiredMetricSections', message: `missing product long-session metric section: ${required}` });
    }
  }
  return issues;
}

function validateCandidateMetrics(
  candidate: BrowserNativeAdapterDimension,
  path: string,
): BrowserNativeAdapterComparisonValidationIssue[] {
  const issues: BrowserNativeAdapterComparisonValidationIssue[] = [];
  const metrics = (candidate as BrowserNativeAdapterDimension & {
    metrics?: Partial<BrowserNativeAdapterMetricsContract>;
  }).metrics;
  if (!metrics) {
    return [{ path: `${path}.metrics`, message: 'candidate metrics contract is required' }];
  }
  for (const section of REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_SECTIONS) {
    const metric = metrics[section];
    if (!metric) {
      issues.push({ path: `${path}.metrics.${section}`, message: `missing required metric section: ${section}` });
      continue;
    }
    if (metric.section !== section) {
      issues.push({ path: `${path}.metrics.${section}.section`, message: `metric section must be ${section}` });
    }
    if (metric.evidenceMode !== 'bounded-summary-ref') {
      issues.push({ path: `${path}.metrics.${section}.evidenceMode`, message: 'metric evidence must be bounded summary refs' });
    }
    if (metric.inlineEvidence !== 'forbidden') {
      issues.push({ path: `${path}.metrics.${section}.inlineEvidence`, message: 'metric contract must forbid inline evidence' });
    }
    if (section === 'secondTruthSource') {
      const secondTruthMetric = metric as Partial<BrowserNativeAdapterSecondTruthSourceMetricContract>;
      if (secondTruthMetric.value !== false) {
        issues.push({ path: `${path}.metrics.secondTruthSource.value`, message: 'metric contract must declare secondTruthSource=false' });
      }
    }
    const fields = Array.isArray(metric.fields) ? metric.fields : [];
    if (fields.length === 0) {
      issues.push({ path: `${path}.metrics.${section}.fields`, message: `metric section ${section} must list required fields` });
      continue;
    }
    for (const requiredField of REQUIRED_BROWSER_NATIVE_ADAPTER_METRIC_FIELDS[section]) {
      if (!fields.some((field) => field.field === requiredField)) {
        issues.push({ path: `${path}.metrics.${section}.fields.${requiredField}`, message: `missing required metric field: ${requiredField}` });
      }
    }
    fields.forEach((field, index) => {
      if (field.required !== true) {
        issues.push({ path: `${path}.metrics.${section}.fields[${index}].required`, message: 'metric fields must be required by the contract' });
      }
      if (field.source !== 'bounded-summary-ref' && field.source !== 'runtime-state') {
        issues.push({ path: `${path}.metrics.${section}.fields[${index}].source`, message: 'metric field source must be bounded-summary-ref or runtime-state' });
      }
    });
  }
  return issues;
}

function normalizeDecision(
  decision: Partial<BrowserNativeAdapterComparisonDecision> | undefined,
): BrowserNativeAdapterComparisonDecision {
  return {
    status: decision?.status ?? 'undecided',
    selectedAdapterId: decision?.selectedAdapterId,
    decisionFields: decision?.decisionFields ?? {
      targetPlatforms: ['cross-platform', 'windows', 'macos'],
      latencySignal: 'bounded-summary-only',
      inputParity: 'unknown',
      paintAckConfidence: 'needs-live-evidence',
      packagingRisk: 'unknown',
      ownershipRisk: 'must-remain-single-owner',
    },
    rationaleRefs: decision?.rationaleRefs ?? ['browser-native-adapter-comparison:rationale'],
    followUpRefs: decision?.followUpRefs ?? ['PROJECT_browser.md:Electron/WebView2/WKWebView performance comparison'],
  };
}

function findRawPayloadIssues(value: unknown): BrowserNativeAdapterComparisonValidationIssue[] {
  const issues: BrowserNativeAdapterComparisonValidationIssue[] = [];
  visitRawPayload(value, '$', issues);
  return issues;
}

function visitRawPayload(value: unknown, path: string, issues: BrowserNativeAdapterComparisonValidationIssue[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitRawPayload(item, `${path}[${index}]`, issues));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      if (/raw|base64|dom|html|screenshot|consoleLog|networkLog/i.test(key)) {
        issues.push({ path: `${path}.${key}`, message: 'raw payload fields are not allowed in the comparison manifest' });
      }
      visitRawPayload(nested, `${path}.${key}`, issues);
    }
    return;
  }
  if (typeof value === 'string' && /data:image|<\s*(?:!doctype|html|body|script|iframe)\b/i.test(value)) {
    issues.push({ path, message: 'raw image/html payloads are not allowed in the comparison manifest' });
  }
}
