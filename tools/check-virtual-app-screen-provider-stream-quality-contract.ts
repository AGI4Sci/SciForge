import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_CONTRACT_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-provider-stream-quality-contract.v1' as const;
export const VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_SAMPLE_MANIFEST_SCHEMA =
  'sciforge.computer-use.virtual-app-screen-provider-stream-quality-sample-manifest.v1' as const;

export const REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS = [
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
] as const;

export type VirtualAppScreenProviderStreamQualityField =
  typeof REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS[number];

export type VirtualAppScreenProviderStreamQualityCheck =
  | 'section-present'
  | 'provider-owned-refs-first'
  | 'bounded-metric-fields'
  | 'virtual-display-telemetry-reuse'
  | 'fallback-required-fail-closed'
  | 'real-run-status-pending'
  | 'optional-sample-manifest'
  | 'sample-manifest-schema'
  | 'sample-manifest-provider-owned-refs'
  | 'sample-manifest-current-run-refs'
  | 'sample-manifest-bounded-metrics'
  | 'sample-manifest-fallback-policy';

export type VirtualAppScreenProviderStreamQualitySampleManifestStatus =
  | 'absent'
  | 'provider-samples-validated';

export type VirtualAppScreenProviderStreamQualityContract = {
  schemaVersion: typeof VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_CONTRACT_SCHEMA;
  owner: 'VirtualDisplayProvider';
  hostSurfaceOwner: 'NativeVirtualAppScreenHost';
  refsFirst: true;
  artifactPayloadMode: 'bounded-summary-refs-only';
  requiredProviderRefs: typeof REQUIRED_PROVIDER_STREAM_QUALITY_REFS[number][];
  reusesVirtualDisplayConcepts: typeof REUSED_VIRTUAL_DISPLAY_CONCEPTS[number][];
  requiredMetricFields: Array<{
    field: VirtualAppScreenProviderStreamQualityField;
    unit: 'ms' | 'fps' | 'count' | 'boolean';
    required: true;
    source: 'provider-owned-bounded-summary-ref';
    inlineEvidence: 'forbidden';
  }>;
  payloadPolicy: {
    maxInlineEvidenceBytes: 0;
    allowedInlineValueKinds: Array<'refs' | 'booleans' | 'numeric-summaries' | 'status-flags' | 'hashes'>;
    forbiddenInlineEvidenceKinds: Array<
      | 'raw-frame-bytes'
      | 'base64-image'
      | 'video-chunk'
      | 'provider-payload'
      | 'input-log'
      | 'full-trace'
    >;
  };
  fallbackPolicy: {
    whenFallbackRequiredTrue: {
      status: 'fail-closed';
      userLevelLivePassAllowed: false;
      allowedPresentationStates: Array<'fallback' | 'blocked' | 'handoff'>;
      requiredRefs: Array<'fallbackDecisionRef' | 'fallbackReasonRef' | 'boundedMetricSummaryRef'>;
    };
  };
  realRunStatus: 'pending-provider-samples';
  realStreamRunClaim: false;
};

export interface VirtualAppScreenProviderStreamQualityContractSummary {
  status: 'passed' | 'failed';
  docPath: string;
  checks: VirtualAppScreenProviderStreamQualityCheck[];
  metricFields: VirtualAppScreenProviderStreamQualityField[];
  realRunStatus: VirtualAppScreenProviderStreamQualityContract['realRunStatus'];
  realStreamRunClaim: false;
  sampleManifestPath?: string;
  sampleManifestStatus: VirtualAppScreenProviderStreamQualitySampleManifestStatus;
  issues: string[];
}

export interface VirtualAppScreenProviderStreamQualitySampleManifestValidation {
  status: 'passed' | 'failed';
  checks: VirtualAppScreenProviderStreamQualityCheck[];
  metricFields: VirtualAppScreenProviderStreamQualityField[];
  sampleManifestStatus: VirtualAppScreenProviderStreamQualitySampleManifestStatus;
  realStreamRunClaim: false;
  issues: string[];
}

export interface RunVirtualAppScreenProviderStreamQualityContractOptions {
  docPath?: string;
  sampleManifestPath?: string;
}

const DEFAULT_DOC_PATH = 'docs/VirtualAppScreenArchitecture.md';
const SECTION_HEADING = '## Provider Stream Quality Measurement Contract';
const REQUIRED_PROVIDER_STREAM_QUALITY_REFS = [
  'frameTransportContractRef',
  'frameTelemetryRef',
  'providerStreamQualityRef',
  'inputToFrameCausalityRef',
  'reconnectProbeRef',
  'boundedMetricSummaryRef',
  'fallbackDecisionRef',
] as const;
const REUSED_VIRTUAL_DISPLAY_CONCEPTS = [
  'VirtualDisplayFrameTransportContract',
  'VirtualDisplayFrameTelemetrySummary',
  'VirtualDisplaySurfaceTransportDescriptor',
  'frameTransportReadiness',
] as const;
const FIELD_UNITS: Record<VirtualAppScreenProviderStreamQualityField, 'ms' | 'fps' | 'count' | 'boolean'> = {
  latencyP50Ms: 'ms',
  latencyP95Ms: 'ms',
  framerateAvgFps: 'fps',
  framerateP5Fps: 'fps',
  inputToFrameP50Ms: 'ms',
  inputToFrameP95Ms: 'ms',
  reconnectP50Ms: 'ms',
  reconnectP95Ms: 'ms',
  sampleCount: 'count',
  fallbackRequired: 'boolean',
};
const CURRENT_RUN_REF_FIELDS = ['currentRunPointerRef', 'currentRunLedgerRef'] as const;
const FORBIDDEN_SAMPLE_MANIFEST_INLINE_FIELDS = [
  'rawFrameBytes',
  'base64Image',
  'videoChunk',
  'providerPayload',
  'inputLog',
  'fullTrace',
] as const;

export function buildVirtualAppScreenProviderStreamQualityContract(): VirtualAppScreenProviderStreamQualityContract {
  return {
    schemaVersion: VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_CONTRACT_SCHEMA,
    owner: 'VirtualDisplayProvider',
    hostSurfaceOwner: 'NativeVirtualAppScreenHost',
    refsFirst: true,
    artifactPayloadMode: 'bounded-summary-refs-only',
    requiredProviderRefs: [...REQUIRED_PROVIDER_STREAM_QUALITY_REFS],
    reusesVirtualDisplayConcepts: [...REUSED_VIRTUAL_DISPLAY_CONCEPTS],
    requiredMetricFields: REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS.map((field) => ({
      field,
      unit: FIELD_UNITS[field],
      required: true,
      source: 'provider-owned-bounded-summary-ref',
      inlineEvidence: 'forbidden',
    })),
    payloadPolicy: {
      maxInlineEvidenceBytes: 0,
      allowedInlineValueKinds: ['refs', 'booleans', 'numeric-summaries', 'status-flags', 'hashes'],
      forbiddenInlineEvidenceKinds: [
        'raw-frame-bytes',
        'base64-image',
        'video-chunk',
        'provider-payload',
        'input-log',
        'full-trace',
      ],
    },
    fallbackPolicy: {
      whenFallbackRequiredTrue: {
        status: 'fail-closed',
        userLevelLivePassAllowed: false,
        allowedPresentationStates: ['fallback', 'blocked', 'handoff'],
        requiredRefs: ['fallbackDecisionRef', 'fallbackReasonRef', 'boundedMetricSummaryRef'],
      },
    },
    realRunStatus: 'pending-provider-samples',
    realStreamRunClaim: false,
  };
}

export async function runVirtualAppScreenProviderStreamQualityContract(
  options: string | RunVirtualAppScreenProviderStreamQualityContractOptions = DEFAULT_DOC_PATH,
): Promise<VirtualAppScreenProviderStreamQualityContractSummary> {
  const normalizedOptions = typeof options === 'string' ? { docPath: options } : options;
  const docPath = normalizedOptions.docPath ?? DEFAULT_DOC_PATH;
  const contract = buildVirtualAppScreenProviderStreamQualityContract();
  const checks: VirtualAppScreenProviderStreamQualityCheck[] = [];
  const issues: string[] = [];
  const resolvedDocPath = resolve(docPath);
  const docText = await readFile(resolvedDocPath, 'utf8');
  const sectionText = extractSection(docText, SECTION_HEADING);

  if (!sectionText) {
    issues.push(`Missing ${SECTION_HEADING} section`);
    return buildSummary(resolvedDocPath, checks, issues, contract);
  }
  checks.push('section-present');

  runCheck(
    'provider-owned-refs-first',
    sectionText,
    [
      'owner=VirtualDisplayProvider',
      'hostSurfaceOwner=NativeVirtualAppScreenHost',
      'refs-first',
      'provider-owned-bounded-summary-ref',
      ...REQUIRED_PROVIDER_STREAM_QUALITY_REFS,
    ],
    checks,
    issues,
  );
  runCheck(
    'bounded-metric-fields',
    sectionText,
    [
      'artifactPayloadMode=bounded-summary-refs-only',
      'maxInlineEvidenceBytes=0',
      'inlineEvidence=forbidden',
      ...REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS,
    ],
    checks,
    issues,
  );
  runCheck(
    'virtual-display-telemetry-reuse',
    sectionText,
    [...REUSED_VIRTUAL_DISPLAY_CONCEPTS],
    checks,
    issues,
  );
  runCheck(
    'fallback-required-fail-closed',
    sectionText,
    [
      'fallbackRequired=true',
      'status=fail-closed',
      'userLevelLivePassAllowed=false',
      'allowedPresentationStates=fallback|blocked|handoff',
    ],
    checks,
    issues,
  );
  runCheck(
    'real-run-status-pending',
    sectionText,
    [
      'realRunStatus=pending-provider-samples',
      'realStreamRunClaim=false',
      'actual provider samples',
    ],
    checks,
    issues,
  );
  runCheck(
    'optional-sample-manifest',
    sectionText,
    [
      'sampleManifestPath',
      'sciforge.computer-use.virtual-app-screen-provider-stream-quality-sample-manifest.v1',
      'sampleManifestStatus=provider-samples-validated',
      'providerRootRef',
      'currentRunPointerRef',
      'currentRunLedgerRef',
      'rawFrameBytes',
      'realStreamRunClaim=false',
    ],
    checks,
    issues,
  );

  let sampleManifestPath: string | undefined;
  let sampleManifestStatus: VirtualAppScreenProviderStreamQualitySampleManifestStatus = 'absent';
  if (normalizedOptions.sampleManifestPath) {
    sampleManifestPath = resolve(normalizedOptions.sampleManifestPath);
    const manifest = JSON.parse(await readFile(sampleManifestPath, 'utf8')) as unknown;
    const manifestValidation = validateVirtualAppScreenProviderStreamQualitySampleManifest(manifest);
    checks.push(...manifestValidation.checks);
    issues.push(...manifestValidation.issues);
    sampleManifestStatus = manifestValidation.sampleManifestStatus;
  }

  return buildSummary(resolvedDocPath, checks, issues, contract, {
    sampleManifestPath,
    sampleManifestStatus,
  });
}

export function validateVirtualAppScreenProviderStreamQualitySampleManifest(
  manifest: unknown,
): VirtualAppScreenProviderStreamQualitySampleManifestValidation {
  const checks: VirtualAppScreenProviderStreamQualityCheck[] = [];
  const issues: string[] = [];
  const record = isRecord(manifest) ? manifest : {};

  const schemaIssues = [
    requireEqual(record, 'schemaVersion', VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_SAMPLE_MANIFEST_SCHEMA),
    requireEqual(record, 'owner', 'VirtualDisplayProvider'),
    requireEqual(record, 'hostSurfaceOwner', 'NativeVirtualAppScreenHost'),
    requireEqual(record, 'refsFirst', true),
    requireEqual(record, 'artifactPayloadMode', 'bounded-summary-refs-only'),
  ].filter(Boolean);
  if (schemaIssues.length) {
    issues.push(`sample-manifest-schema: ${schemaIssues.join('; ')}`);
  } else {
    checks.push('sample-manifest-schema');
  }

  const providerRootRef = stringField(record, 'providerRootRef');
  const providerRefIssues = providerRootRef && providerRootRef.startsWith('provider:')
    ? []
    : ['providerRootRef must be provider-owned'];
  for (const refField of REQUIRED_PROVIDER_STREAM_QUALITY_REFS) {
    const refValue = stringField(record, refField);
    if (!refValue) {
      providerRefIssues.push(`${refField} is required`);
    } else if (!providerRootRef || !refValue.startsWith(`${providerRootRef}/`)) {
      providerRefIssues.push(`${refField} must be provider-owned under providerRootRef`);
    }
  }
  if (providerRefIssues.length) {
    issues.push(`sample-manifest-provider-owned-refs: ${providerRefIssues.join('; ')}`);
  } else {
    checks.push('sample-manifest-provider-owned-refs');
  }

  const currentRunIssues = CURRENT_RUN_REF_FIELDS.flatMap((field) => validateHostCurrentRunRef(field, stringField(record, field)));
  if (currentRunIssues.length) {
    issues.push(`sample-manifest-current-run-refs: ${currentRunIssues.join('; ')}`);
  } else {
    checks.push('sample-manifest-current-run-refs');
  }

  const boundedMetricIssues = validateBoundedMetrics(record);
  const forbiddenInlineIssues = FORBIDDEN_SAMPLE_MANIFEST_INLINE_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(record, field))
    .map((field) => `${field} is forbidden`);
  const metricIssues = [...boundedMetricIssues, ...forbiddenInlineIssues];
  if (metricIssues.length) {
    issues.push(`sample-manifest-bounded-metrics: ${metricIssues.join('; ')}`);
  } else {
    checks.push('sample-manifest-bounded-metrics');
  }

  const fallbackIssues = validateFallbackPolicy(record);
  if (fallbackIssues.length) {
    issues.push(`sample-manifest-fallback-policy: ${fallbackIssues.join('; ')}`);
  } else {
    checks.push('sample-manifest-fallback-policy');
  }

  return {
    status: issues.length ? 'failed' : 'passed',
    checks,
    metricFields: [...REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS],
    sampleManifestStatus: issues.length ? 'absent' : 'provider-samples-validated',
    realStreamRunClaim: false,
    issues,
  };
}

function buildSummary(
  docPath: string,
  checks: VirtualAppScreenProviderStreamQualityCheck[],
  issues: string[],
  contract: VirtualAppScreenProviderStreamQualityContract,
  sampleManifest?: {
    sampleManifestPath?: string;
    sampleManifestStatus: VirtualAppScreenProviderStreamQualitySampleManifestStatus;
  },
): VirtualAppScreenProviderStreamQualityContractSummary {
  return {
    status: issues.length ? 'failed' : 'passed',
    docPath,
    checks,
    metricFields: [...REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS],
    realRunStatus: contract.realRunStatus,
    realStreamRunClaim: contract.realStreamRunClaim,
    sampleManifestPath: sampleManifest?.sampleManifestPath,
    sampleManifestStatus: sampleManifest?.sampleManifestStatus ?? 'absent',
    issues,
  };
}

function validateBoundedMetrics(record: Record<string, unknown>): string[] {
  const metrics = isRecord(record.metrics) ? record.metrics : {};
  const issues: string[] = [];
  for (const field of REQUIRED_VIRTUAL_APP_SCREEN_PROVIDER_STREAM_QUALITY_FIELDS) {
    const value = metrics[field];
    if (field === 'fallbackRequired') {
      if (typeof value !== 'boolean') issues.push(`${field} must be boolean`);
      continue;
    }
    if (field === 'sampleCount') {
      if (!Number.isInteger(value) || Number(value) <= 0) {
        issues.push(`${field} must be a positive integer`);
      }
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      issues.push(`${field} must be a non-negative finite number`);
    }
  }
  return issues;
}

function validateFallbackPolicy(record: Record<string, unknown>): string[] {
  const metrics = isRecord(record.metrics) ? record.metrics : {};
  if (metrics.fallbackRequired !== true) return [];
  const issues: string[] = [];
  const providerRootRef = stringField(record, 'providerRootRef');
  for (const field of ['fallbackDecisionRef', 'fallbackReasonRef', 'boundedMetricSummaryRef'] as const) {
    const value = stringField(record, field);
    if (!value) {
      issues.push(`${field} is required when fallbackRequired=true`);
    } else if (!providerRootRef || !value.startsWith(`${providerRootRef}/`)) {
      issues.push(`${field} must be provider-owned when fallbackRequired=true`);
    }
  }
  return issues;
}

function validateHostCurrentRunRef(field: typeof CURRENT_RUN_REF_FIELDS[number], value: string | null): string[] {
  if (!value) return [`${field} is required`];
  if (field === 'currentRunPointerRef') {
    return value.startsWith('computer-use:native-host/runs/')
      ? []
      : [`${field} must be Host current-run owned`];
  }
  return value.startsWith('computer-use:native-host/ledgers/')
    || value.startsWith('computer-use:native-host/runs/')
    ? []
    : [`${field} must be Host ledger owned`];
}

function requireEqual(record: Record<string, unknown>, field: string, expected: unknown): string | null {
  return record[field] === expected ? null : `${field} must be ${String(expected)}`;
}

function stringField(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runCheck(
  checkName: VirtualAppScreenProviderStreamQualityCheck,
  sectionText: string,
  requiredTokens: readonly string[],
  checks: VirtualAppScreenProviderStreamQualityCheck[],
  issues: string[],
): void {
  const missingTokens = requiredTokens.filter((token) => !sectionText.includes(token));
  if (missingTokens.length) {
    issues.push(`${checkName}: missing ${missingTokens.join(', ')}`);
    return;
  }
  checks.push(checkName);
}

function extractSection(docText: string, headingPrefix: string): string | null {
  const headingIndex = docText.indexOf(headingPrefix);
  if (headingIndex < 0) return null;
  const nextHeadingIndex = docText.indexOf('\n## ', headingIndex + headingPrefix.length);
  if (nextHeadingIndex < 0) return docText.slice(headingIndex);
  return docText.slice(headingIndex, nextHeadingIndex);
}

async function main(): Promise<void> {
  const summary = await runVirtualAppScreenProviderStreamQualityContract(parseArgs(process.argv.slice(2)));
  if (summary.status !== 'passed') {
    console.error(
      `[failed] VirtualAppScreen provider stream quality contract doc=${summary.docPath} issues=${summary.issues.join('; ')}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[passed] VirtualAppScreen provider stream quality contract realRunStatus=${summary.realRunStatus} realStreamRunClaim=${String(summary.realStreamRunClaim)} sampleManifestStatus=${summary.sampleManifestStatus} metricFields=${summary.metricFields.join(',')} checks=${summary.checks.join(',')}`,
  );
}

function parseArgs(argv: string[]): RunVirtualAppScreenProviderStreamQualityContractOptions {
  const options: RunVirtualAppScreenProviderStreamQualityContractOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--doc') {
      options.docPath = argv[index + 1];
      index += 1;
    } else if (arg === '--sample-manifest') {
      options.sampleManifestPath = argv[index + 1];
      index += 1;
    }
  }
  return options;
}

const isCli = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isCli) {
  await main();
}
