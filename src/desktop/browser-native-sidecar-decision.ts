import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS,
  REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES,
  type BrowserNativeAdapterBenchmarkMetricSection,
  type BrowserNativeAdapterCandidateId,
  type BrowserNativeAdapterPlatform,
} from './browser-native-adapter-comparison.js';
import {
  NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS,
  BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA,
  DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
  type BrowserNativeAdapterPlatformBenchmarkResult,
} from '../../tools/browser-native-adapter-platform-benchmark-runner.js';

export const BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA =
  'sciforge.browser-native-sidecar-decision.v1' as const;
export const DEFAULT_BROWSER_NATIVE_SIDECAR_DECISION_REF =
  'docs/test-artifacts/browser-native-adapter-comparison/sidecar-decision.json' as const;

type DecisionStatus = 'blocked' | 'ready-for-human-decision';
type RequiredCommandStatus = 'present' | 'missing' | 'unsupported-on-current-platform' | 'blocked-or-invalid';
type AdapterAvailabilityStatus =
  | 'real-adapter-command-present'
  | 'missing-real-adapter-command'
  | 'unsupported-on-current-platform'
  | 'blocked-or-invalid';
type BenchmarkCandidateResult = BrowserNativeAdapterPlatformBenchmarkResult['candidates'][number];
type DecisionRequirementId =
  | 'sameSessionOwnership'
  | 'refsCollection'
  | 'inputRouting'
  | 'securityIsolation'
  | 'lifecycle'
  | 'packagingRisk';

export type BrowserNativeSidecarDecisionRequiredCommand = {
  candidateId: BrowserNativeAdapterCandidateId;
  platform: BrowserNativeAdapterPlatform;
  commandEnv: string;
  argsJsonEnv: string;
  supportedOnCurrentPlatform: boolean;
  status: RequiredCommandStatus;
  adapterAvailability: {
    helperCommandPresent: boolean;
    realAdapterCommandPresent: boolean;
    availabilityStatus: AdapterAvailabilityStatus;
    provenanceRefs: string[];
  };
  blockerRefs: string[];
  diagnosticRefs: string[];
};

export type BrowserNativeSidecarDecisionRequirement = {
  status: 'passed' | 'blocked';
  required: true;
  evidenceRefs: string[];
  blockerRefs: string[];
};

export type BrowserNativeSidecarDecisionEvidence = {
  schemaVersion: typeof BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA;
  manifestId: 'browser-native-sidecar-decision';
  observedAt: string;
  status: DecisionStatus;
  benchmarkClaim: false;
  selectedAdapterId: BrowserNativeAdapterCandidateId | null;
  owner: 'BrowserHostSession';
  liveSurfaceTransport: 'native-embedded';
  singleInteractiveTruth: true;
  secondTruthSource: false;
  platformBenchmark: {
    schemaVersion: typeof BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA;
    resultRef: string;
    status: BrowserNativeAdapterPlatformBenchmarkResult['status'];
    benchmarkClaim: boolean;
    decisionGateStatus: BrowserNativeAdapterPlatformBenchmarkResult['decisionGate']['status'];
    selectedAdapterId: BrowserNativeAdapterCandidateId | null;
  };
  sidecarDecision: {
    question: 'whether-platform-specific-native-sidecar-is-required';
    status: DecisionStatus;
    requiresPlatformSpecificNativeSidecar: boolean | null;
    claimsDecision: false;
    refusalPolicyRef: 'browser-native-adapter-platform-benchmark:real-proof-refusal-policy';
    rationaleRefs: string[];
  };
  decisionGate: {
    status: DecisionStatus;
    selectedAdapterId: BrowserNativeAdapterCandidateId | null;
    benchmarkClaim: false;
    unblocksWhen: 'supported-candidates-have-real-bounded-results-and-unsupported-candidates-have-typed-unsupported-results';
  };
  decisionRequirements: Record<DecisionRequirementId, BrowserNativeSidecarDecisionRequirement>;
  requiredCommands: BrowserNativeSidecarDecisionRequiredCommand[];
  referenceRefs: string[];
  payloadPolicy: {
    refsFirst: true;
    maxInlineEvidenceBytes: 0;
    allowedInlineValueKinds: Array<'ids' | 'refs' | 'booleans' | 'status-flags' | 'hashes'>;
    forbiddenInlineEvidenceKinds: Array<
      | 'raw-url'
      | 'raw-dom'
      | 'base64-image'
      | 'screenshot-bytes'
      | 'provider-payload'
      | 'full-console-log'
      | 'full-network-log'
      | 'secret'
    >;
  };
  invariants: Array<{
    id: string;
    status: 'pass' | 'fail';
    ref: string;
  }>;
};

type BuildOptions = {
  observedAt?: string;
};

type RunOptions = {
  inputPath?: string;
  outputPath?: string;
  cwd?: string;
  now?: string;
};

export async function runBrowserNativeSidecarDecision(
  options: RunOptions = {},
): Promise<BrowserNativeSidecarDecisionEvidence> {
  const cwd = options.cwd ?? process.cwd();
  const inputPath = resolve(cwd, options.inputPath ?? DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF);
  const outputPath = resolve(cwd, options.outputPath ?? DEFAULT_BROWSER_NATIVE_SIDECAR_DECISION_REF);
  const text = await readFile(inputPath, 'utf8');
  assertBoundedDecisionArtifact(text);
  const platformBenchmark = JSON.parse(text) as BrowserNativeAdapterPlatformBenchmarkResult;
  const decision = buildBrowserNativeSidecarDecisionEvidence(platformBenchmark, {
    observedAt: options.now,
  });
  const issues = validateBrowserNativeSidecarDecisionEvidence(decision);
  if (issues.length > 0) {
    throw new Error(`browser native sidecar decision evidence failed validation: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  }
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(decision, null, 2)}\n`, 'utf8');
  return decision;
}

export function buildBrowserNativeSidecarDecisionEvidence(
  platformBenchmark: BrowserNativeAdapterPlatformBenchmarkResult,
  options: BuildOptions = {},
): BrowserNativeSidecarDecisionEvidence {
  const requiredCommands = buildRequiredCommands(platformBenchmark);
  const requiredCommandEvidenceReady = requiredCommandsReadyForDecision(requiredCommands);
  const requiredCandidateEvidenceReady = REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.every((candidateId) => {
    const command = requiredCommands.find((item) => item.candidateId === candidateId);
    const candidate = platformBenchmark.candidates.find((item) => item.id === candidateId);
    if (!command || !candidate) {
      return false;
    }
    return command.status === 'unsupported-on-current-platform'
      ? isTypedUnsupportedCandidateResult(candidate, command.platform)
      : command.status === 'present' && hasCompleteRealMetricEvidence(candidate);
  });
  const decisionRequirements = buildDecisionRequirements(platformBenchmark, requiredCommands);
  const decisionRequirementsReady = Object.values(decisionRequirements).every((requirement) => requirement.status === 'passed');
  const status: DecisionStatus = platformBenchmark.status === 'passed'
    && platformBenchmark.benchmarkClaim === true
    && platformBenchmark.decisionGate.status === 'ready-for-human-decision'
    && requiredCandidateEvidenceReady
    && requiredCommandEvidenceReady
    && decisionRequirementsReady
    ? 'ready-for-human-decision'
    : 'blocked';
  const blockerRefs = requiredCommands.flatMap((command) => command.blockerRefs);
  const rationaleRefs = status === 'blocked'
    ? [
      'PROJECT_browser.md:M3 platform Benchmark and Adapter decision',
      'browser-native-adapter-platform-benchmark:real-proof-refusal-policy',
      'browser-native-adapter-platform-benchmark:required-adapter-commands',
      ...boundedRefs(blockerRefs),
    ]
    : [
      'PROJECT_browser.md:M3 platform Benchmark and Adapter decision',
      'browser-native-adapter-platform-benchmark:all-required-candidates-real-bounded-results',
    ];

  const evidence: BrowserNativeSidecarDecisionEvidence = {
    schemaVersion: BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA,
    manifestId: 'browser-native-sidecar-decision',
    observedAt: options.observedAt ?? new Date().toISOString(),
    status,
    benchmarkClaim: false,
    selectedAdapterId: null,
    owner: 'BrowserHostSession',
    liveSurfaceTransport: 'native-embedded',
    singleInteractiveTruth: true,
    secondTruthSource: false,
    platformBenchmark: {
      schemaVersion: platformBenchmark.schemaVersion,
      resultRef: platformBenchmark.resultRef || DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
      status: platformBenchmark.status,
      benchmarkClaim: platformBenchmark.benchmarkClaim,
      decisionGateStatus: platformBenchmark.decisionGate.status,
      selectedAdapterId: platformBenchmark.decisionGate.selectedAdapterId,
    },
    sidecarDecision: {
      question: 'whether-platform-specific-native-sidecar-is-required',
      status,
      requiresPlatformSpecificNativeSidecar: null,
      claimsDecision: false,
      refusalPolicyRef: 'browser-native-adapter-platform-benchmark:real-proof-refusal-policy',
      rationaleRefs,
    },
    decisionGate: {
      status,
      selectedAdapterId: null,
      benchmarkClaim: false,
      unblocksWhen: 'supported-candidates-have-real-bounded-results-and-unsupported-candidates-have-typed-unsupported-results',
    },
    decisionRequirements,
    requiredCommands,
    referenceRefs: [
      'PROJECT_browser.md:M3 platform Benchmark and Adapter decision',
      platformBenchmark.resultRef || DEFAULT_BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_REF,
      'browser-native-adapter-platform-benchmark:real-proof-refusal-policy',
      'browser-native-adapter-platform-benchmark:required-adapter-commands',
    ],
    payloadPolicy: {
      refsFirst: true,
      maxInlineEvidenceBytes: 0,
      allowedInlineValueKinds: ['ids', 'refs', 'booleans', 'status-flags', 'hashes'],
      forbiddenInlineEvidenceKinds: [
        'raw-url',
        'raw-dom',
        'base64-image',
        'screenshot-bytes',
        'provider-payload',
        'full-console-log',
        'full-network-log',
        'secret',
      ],
    },
    invariants: [],
  };
  evidence.invariants = sidecarDecisionInvariants(evidence);
  assertBoundedDecisionArtifact(JSON.stringify(evidence));
  return evidence;
}

export type BrowserNativeSidecarDecisionValidationIssue = {
  path: string;
  message: string;
};

export function validateBrowserNativeSidecarDecisionEvidence(
  evidence: BrowserNativeSidecarDecisionEvidence,
): BrowserNativeSidecarDecisionValidationIssue[] {
  const issues: BrowserNativeSidecarDecisionValidationIssue[] = [];
  const requiredCommandEvidenceReady = requiredCommandsReadyForDecision(evidence.requiredCommands);
  const decisionRequirements = (evidence.decisionRequirements ?? {}) as Partial<Record<DecisionRequirementId, BrowserNativeSidecarDecisionRequirement>>;
  if (evidence.schemaVersion !== BROWSER_NATIVE_SIDECAR_DECISION_SCHEMA) {
    issues.push({ path: 'schemaVersion', message: 'unsupported browser native sidecar decision schema' });
  }
  if (evidence.status !== evidence.decisionGate.status || evidence.status !== evidence.sidecarDecision.status) {
    issues.push({ path: 'status', message: 'sidecar decision status must have a single truth source across status fields' });
  }
  if (
    evidence.status === 'ready-for-human-decision'
    && (
      evidence.platformBenchmark.status !== 'passed'
      || evidence.platformBenchmark.benchmarkClaim !== true
      || evidence.platformBenchmark.decisionGateStatus !== 'ready-for-human-decision'
    )
  ) {
    issues.push({ path: 'status', message: 'ready sidecar decision requires a passed platform benchmark decision gate' });
  }
  if (evidence.status === 'ready-for-human-decision' && !requiredCommandEvidenceReady) {
    issues.push({ path: 'status', message: 'ready sidecar decision requires complete required command evidence' });
  }
  for (const requirementId of DECISION_REQUIREMENT_IDS) {
    const requirement = decisionRequirements[requirementId];
    if (!requirement) {
      issues.push({ path: 'decisionRequirements', message: `missing required decision gate ${requirementId}` });
      continue;
    }
    if (requirement.required !== true) {
      issues.push({ path: `decisionRequirements.${requirementId}.required`, message: 'decision gate must be required' });
    }
    if (requirement.status !== 'passed' && requirement.status !== 'blocked') {
      issues.push({ path: `decisionRequirements.${requirementId}.status`, message: 'decision gate must expose a bounded status' });
    }
    if (!Array.isArray(requirement.evidenceRefs) || requirement.evidenceRefs.length === 0) {
      issues.push({ path: `decisionRequirements.${requirementId}.evidenceRefs`, message: 'decision gate must cite bounded evidence refs' });
    }
    if (!Array.isArray(requirement.blockerRefs)) {
      issues.push({ path: `decisionRequirements.${requirementId}.blockerRefs`, message: 'decision gate blocker refs must be bounded refs' });
    }
  }
  if (
    evidence.status === 'ready-for-human-decision'
    && Object.values(decisionRequirements).some((requirement) => requirement?.status !== 'passed')
  ) {
    issues.push({ path: 'decisionRequirements', message: 'ready sidecar decision requires every decision gate to pass' });
  }
  if (evidence.benchmarkClaim !== false || evidence.decisionGate.benchmarkClaim !== false) {
    issues.push({ path: 'benchmarkClaim', message: 'sidecar decision evidence must not claim a platform benchmark pass' });
  }
  if (evidence.selectedAdapterId !== null || evidence.decisionGate.selectedAdapterId !== null) {
    issues.push({ path: 'selectedAdapterId', message: 'sidecar decision evidence must not select an adapter before required real results exist' });
  }
  if (evidence.owner !== 'BrowserHostSession' || evidence.liveSurfaceTransport !== 'native-embedded' || evidence.singleInteractiveTruth !== true) {
    issues.push({ path: 'owner', message: 'sidecar decision must preserve BrowserHostSession native embedded ownership' });
  }
  if (evidence.secondTruthSource !== false) {
    issues.push({ path: 'secondTruthSource', message: 'sidecar decision must not introduce a second browser truth source' });
  }
  if (evidence.platformBenchmark.schemaVersion !== BROWSER_NATIVE_ADAPTER_PLATFORM_BENCHMARK_RESULT_SCHEMA) {
    issues.push({ path: 'platformBenchmark.schemaVersion', message: 'sidecar decision must cite the platform benchmark result schema' });
  }
  if (evidence.platformBenchmark.benchmarkClaim === false && evidence.status !== 'blocked') {
    issues.push({ path: 'status', message: 'sidecar decision must remain blocked when platform benchmark cannot claim pass' });
  }
  if (evidence.sidecarDecision.claimsDecision !== false || evidence.sidecarDecision.requiresPlatformSpecificNativeSidecar !== null) {
    issues.push({ path: 'sidecarDecision', message: 'sidecar decision evidence must refuse to decide sidecar need without required real adapter results' });
  }
  if (!evidence.referenceRefs.includes('browser-native-adapter-platform-benchmark:real-proof-refusal-policy')) {
    issues.push({ path: 'referenceRefs', message: 'sidecar decision must cite the platform benchmark refusal policy' });
  }
  if (!evidence.referenceRefs.includes('browser-native-adapter-platform-benchmark:required-adapter-commands')) {
    issues.push({ path: 'referenceRefs', message: 'sidecar decision must cite required adapter commands' });
  }
  for (const candidateId of REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES) {
    if (!evidence.requiredCommands.some((command) => command.candidateId === candidateId)) {
      issues.push({ path: 'requiredCommands', message: `missing required command status for ${candidateId}` });
    }
  }
  if (evidence.payloadPolicy.refsFirst !== true || evidence.payloadPolicy.maxInlineEvidenceBytes !== 0) {
    issues.push({ path: 'payloadPolicy', message: 'sidecar decision evidence must be refs-first with zero inline evidence bytes' });
  }
  if (!evidence.payloadPolicy.forbiddenInlineEvidenceKinds.includes('raw-url')) {
    issues.push({ path: 'payloadPolicy.forbiddenInlineEvidenceKinds', message: 'raw URLs must be forbidden in sidecar decision evidence' });
  }
  if (sidecarDecisionInvariants(evidence).some((invariant) => invariant.status === 'fail')) {
    issues.push({ path: 'invariants', message: 'sidecar decision invariants must pass' });
  }
  try {
    assertBoundedDecisionArtifact(JSON.stringify(evidence));
  } catch (error) {
    issues.push({ path: 'payload', message: shortError(error) });
  }
  return issues;
}

const DECISION_REQUIREMENT_IDS: readonly DecisionRequirementId[] = [
  'sameSessionOwnership',
  'refsCollection',
  'inputRouting',
  'securityIsolation',
  'lifecycle',
  'packagingRisk',
] as const;

function buildRequiredCommands(
  platformBenchmark: BrowserNativeAdapterPlatformBenchmarkResult,
): BrowserNativeSidecarDecisionRequiredCommand[] {
  return REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.map((candidateId) => {
    const commandContract = platformBenchmark.externalAdapterCommandContract.perCandidateCommandEnv[candidateId];
    const candidateResult = platformBenchmark.candidates.find((candidate) => candidate.id === candidateId);
    const platform = commandContract?.platform ?? REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATE_PLATFORMS[candidateId];
    const commandEnv = commandContract?.commandEnv ?? commandEnvName(candidateId);
    const argsJsonEnv = commandContract?.argsJsonEnv ?? argsEnvName(candidateId);
    const supportedOnCurrentPlatform = commandContract?.supportedOnCurrentPlatform ?? platformSupported(platform);
    const blockerRefs = boundedRefs(candidateResult?.blockerRefs ?? []);
    const adapterAvailability = candidateResult?.adapterAvailability
      ? {
          helperCommandPresent: candidateResult.adapterAvailability.helperCommandPresent === true,
          realAdapterCommandPresent: candidateResult.adapterAvailability.realAdapterCommandPresent === true,
          availabilityStatus: boundedAvailabilityStatus(candidateResult.adapterAvailability.availabilityStatus),
          provenanceRefs: boundedRefs(candidateResult.adapterAvailability.provenanceRefs ?? []),
        }
      : inferredAdapterAvailability(candidateResult, commandEnv, supportedOnCurrentPlatform);
    let status: RequiredCommandStatus = 'blocked-or-invalid';
    if (!supportedOnCurrentPlatform) {
      status = 'unsupported-on-current-platform';
    } else if (adapterAvailability.availabilityStatus === 'missing-real-adapter-command') {
      status = 'missing';
    } else if (blockerRefs.some((ref) => ref.includes(':missing-real-adapter-command'))) {
      status = 'missing';
    } else if (candidateResult && hasCompleteRealMetricEvidence(candidateResult)) {
      status = 'present';
    }
    return {
      candidateId,
      platform,
      commandEnv,
      argsJsonEnv,
      supportedOnCurrentPlatform,
      status,
      adapterAvailability,
      blockerRefs,
      diagnosticRefs: boundedRefs(candidateResult?.diagnosticRefs ?? []),
    };
  });
}

function inferredAdapterAvailability(
  candidateResult: BenchmarkCandidateResult | undefined,
  commandEnv: string,
  supportedOnCurrentPlatform: boolean,
): BrowserNativeSidecarDecisionRequiredCommand['adapterAvailability'] {
  const hasRealEvidence = Boolean(candidateResult && hasCompleteRealMetricEvidence(candidateResult));
  const missingCommand = candidateResult?.blockerRefs.some((ref) => ref.includes(':missing-real-adapter-command')) === true;
  const availabilityStatus: AdapterAvailabilityStatus = !supportedOnCurrentPlatform
    ? 'unsupported-on-current-platform'
    : hasRealEvidence
      ? 'real-adapter-command-present'
      : missingCommand
        ? 'missing-real-adapter-command'
        : 'blocked-or-invalid';
  return {
    helperCommandPresent: hasRealEvidence || !missingCommand,
    realAdapterCommandPresent: hasRealEvidence,
    availabilityStatus,
    provenanceRefs: boundedRefs([
      `env:${commandEnv}:${missingCommand ? 'missing-real-adapter-command' : 'helper-command-present'}`,
    ]),
  };
}

function boundedAvailabilityStatus(value: unknown): AdapterAvailabilityStatus {
  return value === 'real-adapter-command-present'
    || value === 'missing-real-adapter-command'
    || value === 'unsupported-on-current-platform'
    || value === 'blocked-or-invalid'
    ? value
    : 'blocked-or-invalid';
}

function requiredCommandsReadyForDecision(
  requiredCommands: BrowserNativeSidecarDecisionRequiredCommand[],
): boolean {
  return REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.every((candidateId) => {
    const command = requiredCommands.find((item) => item.candidateId === candidateId);
    if (!command) {
      return false;
    }
    if (command.status === 'present') {
      return command.supportedOnCurrentPlatform === true && command.blockerRefs.length === 0;
    }
    return command.status === 'unsupported-on-current-platform'
      && command.supportedOnCurrentPlatform === false
      && command.blockerRefs.some((ref) => ref.includes(`platform:${command.platform}:unsupported-on-${process.platform}`));
  });
}

function buildDecisionRequirements(
  platformBenchmark: BrowserNativeAdapterPlatformBenchmarkResult,
  requiredCommands: BrowserNativeSidecarDecisionRequiredCommand[],
): Record<DecisionRequirementId, BrowserNativeSidecarDecisionRequirement> {
  const candidates = REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES
    .map((candidateId) => platformBenchmark.candidates.find((candidate) => candidate.id === candidateId))
    .filter((candidate): candidate is BenchmarkCandidateResult => Boolean(candidate));
  const missingCandidateRefs = REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES
    .filter((candidateId) => !candidates.some((candidate) => candidate.id === candidateId))
    .map((candidateId) => `benchmark-result:${candidateId}:missing-candidate-result`);
  const unsupportedCandidateRefs = boundedRefs(candidates.flatMap((candidate) => {
    const command = requiredCommands.find((item) => item.candidateId === candidate.id);
    return command && isTypedUnsupportedCandidateResult(candidate, command.platform)
      ? [`platform:${command.platform}:unsupported-on-${process.platform}`]
      : [];
  }));
  const candidatesRequiringRealEvidence = candidates.filter((candidate) => {
    const command = requiredCommands.find((item) => item.candidateId === candidate.id);
    return !(command && isTypedUnsupportedCandidateResult(candidate, command.platform));
  });
  const incompleteCandidateRefs = boundedRefs([
    ...missingCandidateRefs,
    ...candidatesRequiringRealEvidence.flatMap((candidate) => (
      hasCompleteRealMetricEvidence(candidate) ? [] : incompleteCandidateBlockerRefs(candidate)
    )),
  ]);
  const completeRealCandidates = candidatesRequiringRealEvidence.filter((candidate) => hasCompleteRealMetricEvidence(candidate));
  const allCurrentPlatformCandidatesAccountedFor = completeRealCandidates.length === candidatesRequiringRealEvidence.length
    && incompleteCandidateRefs.length === 0;
  const commandBlockerRefs = boundedRefs(requiredCommands.flatMap((command) => {
    if (command.status === 'present' && command.blockerRefs.length === 0) {
      return [];
    }
    if (command.status === 'unsupported-on-current-platform') {
      return command.blockerRefs.filter((ref) => ref.includes(`platform:${command.platform}:unsupported-on-${process.platform}`));
    }
    return command.blockerRefs.length > 0
      ? command.blockerRefs
      : [`env:${command.commandEnv}:${command.status}`];
  }));
  const nonUnsupportedCommandBlockerRefs = commandBlockerRefs.filter((ref) => !unsupportedCandidateRefs.includes(ref));
  const requirementBlockerRefs = [...incompleteCandidateRefs, ...unsupportedCandidateRefs];

  return {
    sameSessionOwnership: requirement(
      allCurrentPlatformCandidatesAccountedFor
        && completeRealCandidates.every((candidate) => (
          candidate.adapterProofRefs.browserHostSessionRef
          && candidate.adapterProofRefs.liveSurfaceRef
          && candidate.singleInteractiveTruth === true
          && candidate.secondTruthSource === false
        )),
      [
        'BrowserHostSession:single-owner',
        ...completeRealCandidates.flatMap((candidate) => [
          candidate.adapterProofRefs.browserHostSessionRef,
          candidate.adapterProofRefs.liveSurfaceRef,
        ]),
        ...unsupportedCandidateRefs,
      ],
      requirementBlockerRefs,
    ),
    refsCollection: requirement(
      allCurrentPlatformCandidatesAccountedFor
        && completeRealCandidates.every((candidate) => candidate.metricSections.every((section) => section.resultRefs.length > 0)),
      [
        'browser-native-adapter-platform-benchmark:real-proof-refs',
        ...completeRealCandidates.flatMap((candidate) => [
          candidate.adapterProofRefs.nativeAdapterSurfaceRef,
          candidate.adapterProofRefs.actionTraceRef,
          candidate.adapterProofRefs.platformResultRef,
          ...(candidate.adapterProofRefs.nestedAdapterCommandProofRefs ?? []),
          ...candidate.metricSections.flatMap((section) => section.resultRefs),
        ]),
        ...unsupportedCandidateRefs,
      ],
      requirementBlockerRefs,
    ),
    inputRouting: requirement(
      allCurrentPlatformCandidatesAccountedFor
        && completeRealCandidates.every((candidate) => hasCompleteMetricSection(candidate, 'inputCompleteness')),
      [
        'BrowserHostSession:input-routing',
        ...metricRefs(completeRealCandidates, ['inputCompleteness']),
        ...unsupportedCandidateRefs,
      ],
      requirementBlockerRefs,
    ),
    securityIsolation: requirement(
      allCurrentPlatformCandidatesAccountedFor
        && platformBenchmark.owner === 'BrowserHostSession'
        && platformBenchmark.liveSurfaceTransport === 'native-embedded'
        && platformBenchmark.singleInteractiveTruth === true
        && platformBenchmark.secondTruthSource === false
        && platformBenchmark.payloadPolicy.refsFirst === true
        && platformBenchmark.payloadPolicy.maxInlineEvidenceBytes === 0
        && completeRealCandidates.every((candidate) => (
          candidate.liveSurfaceTransport === 'native-embedded'
          && candidate.singleInteractiveTruth === true
          && candidate.secondTruthSource === false
        )),
      [
        'PROJECT_browser.md:bounded evidence policy',
        'browser-native-adapter-platform-benchmark:no-second-truth-source',
        ...completeRealCandidates.map((candidate) => `benchmark-result:${candidate.id}:security-isolation:bounded`),
        ...unsupportedCandidateRefs,
      ],
      requirementBlockerRefs,
    ),
    lifecycle: requirement(
      allCurrentPlatformCandidatesAccountedFor
        && completeRealCandidates.every((candidate) => (
          hasCompleteMetricSection(candidate, 'lifecycle') && hasCompleteMetricSection(candidate, 'reconnect')
        )),
      [
        'BrowserHostSession:lifecycle',
        ...metricRefs(completeRealCandidates, ['lifecycle', 'reconnect']),
        ...unsupportedCandidateRefs,
      ],
      requirementBlockerRefs,
    ),
    packagingRisk: requirement(
      allCurrentPlatformCandidatesAccountedFor && nonUnsupportedCommandBlockerRefs.length === 0,
      [
        'browser-native-adapter-platform-benchmark:required-adapter-commands',
        ...completeRealCandidates.map((candidate) => `benchmark-result:${candidate.id}:packaging-risk:bounded`),
        ...unsupportedCandidateRefs,
      ],
      [...incompleteCandidateRefs, ...nonUnsupportedCommandBlockerRefs, ...unsupportedCandidateRefs],
    ),
  };
}

function hasCompleteRealMetricEvidence(
  candidateResult: BenchmarkCandidateResult,
): boolean {
  if (
    candidateResult.status !== 'passed'
    || candidateResult.benchmarkClaim !== true
    || candidateResult.realAdapterResult !== true
    || candidateResult.liveSurfaceTransport !== 'native-embedded'
    || candidateResult.singleInteractiveTruth !== true
    || candidateResult.secondTruthSource !== false
    || candidateResult.blockerRefs.length > 0
    || candidateResult.adapterProofRefs.proofMode !== 'real-native-adapter-run'
    || !candidateResult.adapterProofRefs.browserHostSessionRef
    || !candidateResult.adapterProofRefs.liveSurfaceRef
    || !candidateResult.adapterProofRefs.nativeAdapterSurfaceRef
    || !candidateResult.adapterProofRefs.actionTraceRef
    || !candidateResult.adapterProofRefs.platformResultRef
    || !hasCompleteNestedAdapterCommandProofRefs(candidateResult)
  ) {
    return false;
  }

  return REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS.every((section) => {
    const metric = candidateResult.metricSections.find((entry) => entry.section === section);
    return Boolean(
      metric
        && metric.status === 'passed'
        && metric.evidenceMode === 'bounded-summary-ref'
        && metric.inlineEvidence === 'forbidden'
        && metric.resultRefs.length > 0
        && metric.resultRefs.every((ref) => (
          ref.startsWith(`benchmark-result:${candidateResult.id}:${section}:`)
          && !/blocked|fixture|schema-validation-only|schema-only|partial/i.test(ref)
        ))
        && hasRequiredMetricSummary(section, metric.numericSummary),
    );
  });
}

function hasCompleteMetricSection(
  candidate: BenchmarkCandidateResult,
  section: BrowserNativeAdapterBenchmarkMetricSection,
): boolean {
  const metric = candidate.metricSections.find((entry) => entry.section === section);
  return Boolean(
    metric
      && metric.status === 'passed'
      && metric.evidenceMode === 'bounded-summary-ref'
      && metric.inlineEvidence === 'forbidden'
      && metric.resultRefs.length > 0
      && metric.resultRefs.every((ref) => (
        ref.startsWith(`benchmark-result:${candidate.id}:${section}:`)
        && !/blocked|fixture|schema-validation-only|schema-only|partial/i.test(ref)
      ))
      && hasRequiredMetricSummary(section, metric.numericSummary),
  );
}

function incompleteCandidateBlockerRefs(candidate: BenchmarkCandidateResult): string[] {
  const refs = [...candidate.blockerRefs];
  if (candidate.status !== 'passed' || candidate.benchmarkClaim !== true || candidate.realAdapterResult !== true) {
    refs.push(`benchmark-result:${candidate.id}:missing-real-native-adapter-result`);
  }
  if (
    candidate.adapterProofRefs.proofMode !== 'real-native-adapter-run'
    || !candidate.adapterProofRefs.browserHostSessionRef
    || !candidate.adapterProofRefs.liveSurfaceRef
    || !candidate.adapterProofRefs.nativeAdapterSurfaceRef
    || !candidate.adapterProofRefs.actionTraceRef
    || !candidate.adapterProofRefs.platformResultRef
  ) {
    refs.push(`benchmark-result:${candidate.id}:missing-real-native-adapter-proof-refs`);
  }
  if (!hasCompleteNestedAdapterCommandProofRefs(candidate)) {
    refs.push(`benchmark-result:${candidate.id}:missing-nested-real-adapter-command-provenance`);
  }
  for (const section of REQUIRED_BROWSER_NATIVE_ADAPTER_BENCHMARK_METRIC_SECTIONS) {
    if (!hasCompleteMetricSection(candidate, section)) {
      refs.push(`benchmark-result:${candidate.id}:missing-${section}-metric-result`);
    }
  }
  return boundedRefs(refs);
}

function metricRefs(
  candidates: BenchmarkCandidateResult[],
  sections: BrowserNativeAdapterBenchmarkMetricSection[],
): string[] {
  return candidates.flatMap((candidate) => (
    candidate.metricSections
      .filter((section) => sections.includes(section.section))
      .flatMap((section) => section.resultRefs)
  ));
}

function hasCompleteNestedAdapterCommandProofRefs(candidate: BenchmarkCandidateResult): boolean {
  if (!expectsNestedRealAdapterCommand(candidate.id)) {
    return true;
  }
  const refs = candidate.adapterProofRefs.nestedAdapterCommandProofRefs;
  return Array.isArray(refs)
    && NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS.every((kind) => (
      refs.some((ref) => isNestedAdapterCommandProofRef(ref, candidate.id, kind))
    ));
}

function expectsNestedRealAdapterCommand(candidateId: BrowserNativeAdapterCandidateId): boolean {
  return candidateId === 'wkwebview' || candidateId === 'standalone-chromium-surface';
}

function isNestedAdapterCommandProofRef(
  value: unknown,
  candidateId: BrowserNativeAdapterCandidateId,
  proofKind: (typeof NESTED_REAL_ADAPTER_COMMAND_PROOF_KINDS)[number],
): value is string {
  return typeof value === 'string'
    && value.startsWith(`benchmark-result:${candidateId}:nested-real-adapter-command:${proofKind}:`)
    && /^[a-zA-Z0-9_.:/-]{1,240}$/.test(value)
    && !/blocked|fixture|schema-validation-only|schema-only|partial|sample|synthetic|mock|fake|test-fixture|dry-run/i.test(value);
}

function requirement(
  passed: boolean,
  evidenceRefs: Array<string | null>,
  blockerRefs: string[],
): BrowserNativeSidecarDecisionRequirement {
  return {
    status: passed ? 'passed' : 'blocked',
    required: true,
    evidenceRefs: boundedRefs(evidenceRefs.filter((ref): ref is string => Boolean(ref))),
    blockerRefs: boundedRefs(blockerRefs),
  };
}

function hasRequiredMetricSummary(
  section: BrowserNativeAdapterBenchmarkMetricSection,
  value: unknown,
): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const summary = value as Record<string, unknown>;
  const numberSections = new Set<BrowserNativeAdapterBenchmarkMetricSection>(['latency', 'cpu', 'memory']);
  const requiredKeys: Record<BrowserNativeAdapterBenchmarkMetricSection, string[]> = {
    latency: ['openAckMs', 'navigationAckMs', 'inputAckMs', 'paintAckLagMs', 'p95ActionAckMs'],
    cpu: ['processCpuAveragePercent', 'processCpuP95Percent', 'sampleCount'],
    memory: ['rssMb', 'heapUsedMb', 'nativeSurfaceMb', 'peakRssMb'],
    inputCompleteness: ['keyboard', 'textEditing', 'pointerClick', 'drag', 'scroll', 'navigationControls'],
    lifecycle: ['open', 'navigationStart', 'navigationCommitted', 'interactive', 'load', 'networkQuiet', 'blocked', 'retry', 'close'],
    reconnect: ['disconnectDetected', 'sameBrowserHostSessionOwner', 'stateHeartbeatRestored', 'inputRoutedAfterReconnect'],
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
  };
  return requiredKeys[section].every((key) => {
    const metricValue = summary[key];
    if (section === 'streamQuality' && key === 'fallbackRequired') {
      return typeof metricValue === 'boolean';
    }
    return numberSections.has(section) || section === 'streamQuality'
      ? typeof metricValue === 'number' && Number.isFinite(metricValue)
      : typeof metricValue === 'boolean';
  });
}

function isTypedUnsupportedCandidateResult(
  candidate: BenchmarkCandidateResult,
  platform: BrowserNativeAdapterPlatform,
): boolean {
  return !platformSupported(platform)
    && candidate.status === 'blocked'
    && candidate.benchmarkClaim === false
    && candidate.realAdapterResult === false
    && candidate.blockerRefs.some((ref) => ref.includes(`platform:${platform}:unsupported-on-${process.platform}`));
}

function sidecarDecisionInvariants(
  evidence: BrowserNativeSidecarDecisionEvidence,
): BrowserNativeSidecarDecisionEvidence['invariants'] {
  return [{
    id: 'no-automatic-adapter-selection',
    status: evidence.selectedAdapterId === null
      && evidence.decisionGate.selectedAdapterId === null
      && evidence.benchmarkClaim === false
      ? 'pass'
      : 'fail',
    ref: 'PROJECT_browser.md:M3 decision cannot claim pass without required real results',
  }, {
    id: 'refs-first-bounded-payload',
    status: evidence.payloadPolicy.refsFirst === true
      && evidence.payloadPolicy.maxInlineEvidenceBytes === 0
      && evidence.payloadPolicy.forbiddenInlineEvidenceKinds.includes('raw-url')
      ? 'pass'
      : 'fail',
    ref: 'PROJECT_browser.md:bounded evidence policy',
  }, {
    id: 'required-command-coverage',
    status: REQUIRED_BROWSER_NATIVE_ADAPTER_CANDIDATES.every((candidateId) => (
      evidence.requiredCommands.some((command) => command.candidateId === candidateId)
    ))
      ? 'pass'
      : 'fail',
    ref: 'browser-native-adapter-platform-benchmark:required-adapter-commands',
  }, {
    id: 'ready-requires-required-command-evidence',
    status: evidence.status !== 'ready-for-human-decision'
      || requiredCommandsReadyForDecision(evidence.requiredCommands)
      ? 'pass'
      : 'fail',
    ref: 'browser-native-adapter-platform-benchmark:all-required-candidates-real-bounded-results',
  }];
}

function boundedRefs(refs: string[]): string[] {
  return [...new Set(refs
    .filter((ref) => typeof ref === 'string' && ref.length > 0)
    .map((ref) => ref.slice(0, 240))
    .filter((ref) => !/https?:\/\//i.test(ref)))];
}

function assertBoundedDecisionArtifact(text: string): void {
  if (text.length > 96_000) {
    throw new Error('browser native sidecar decision evidence must remain bounded');
  }
  if (/https?:\/\//i.test(text) || /data:image\//i.test(text)) {
    throw new Error('browser native sidecar decision evidence must not contain raw URLs or inline image data');
  }
  if (/"(?:rawUrl|url|requestedUrl|currentUrl|finalUrl|rawDom|domSnapshot|screenshotBase64|screenshotBytes|providerPayload|consoleLog|networkLog|secret|token|password|credential)"\s*:/i.test(text)) {
    throw new Error('browser native sidecar decision evidence must not contain raw URL, DOM, screenshot, provider payload, log, or secret keys');
  }
}

function commandEnvName(candidateId: BrowserNativeAdapterCandidateId): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_COMMAND`;
}

function argsEnvName(candidateId: BrowserNativeAdapterCandidateId): string {
  return `SCIFORGE_BROWSER_NATIVE_ADAPTER_${candidateId.toUpperCase().replace(/-/g, '_')}_ARGS_JSON`;
}

function platformSupported(platform: BrowserNativeAdapterPlatform): boolean {
  return platform === 'cross-platform'
    || (platform === 'windows' && process.platform === 'win32')
    || (platform === 'macos' && process.platform === 'darwin')
    || (platform === 'linux' && process.platform === 'linux');
}

function shortError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBrowserNativeSidecarDecision(parseCliOptions(process.argv.slice(2)))
    .then((evidence) => {
      process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${shortError(error)}\n`);
      process.exitCode = 1;
    });
}

function parseCliOptions(args: string[]): RunOptions {
  const options: RunOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--input') {
      options.inputPath = requireCliValue(args, index);
      index += 1;
    } else if (arg === '--output') {
      options.outputPath = requireCliValue(args, index);
      index += 1;
    } else if (arg === '--now') {
      options.now = requireCliValue(args, index);
      index += 1;
    } else {
      throw new Error(`unknown browser native sidecar decision runner argument: ${arg}`);
    }
  }
  return options;
}

function requireCliValue(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`missing value for ${args[index]}`);
  }
  return value;
}
