import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../contracts/runtime/capability-manifest.js';

export const providerAvailability = [{
  id: 'verifier.scientific-reproduction.generic',
  available: true,
  reason: 'Pure TypeScript rule verifier for scientific reproduction artifacts.',
}];

export const capabilityManifest: CapabilityManifest = {
  contract: CAPABILITY_MANIFEST_CONTRACT_ID,
  id: 'verifier.scientific-reproduction',
  name: 'Scientific reproduction verifier',
  version: '0.1.0',
  ownerPackage: 'packages/verifiers/scientific-reproduction',
  kind: 'verifier',
  brief: 'Checks generic scientific reproduction artifacts for claim/evidence coverage, figure reproduction provenance, citation/accession verification, raw-data readiness and execution attestation gates, verdict vocabulary, refs-first evidence, and negative result semantics.',
  routingTags: [
    'scientific-reproduction',
    'claim-verdict',
    'figure-reproduction-report',
    'negative-result-report',
    'raw-data-readiness-dossier',
    'citation-verification',
    'accession-verification',
    'raw-data-readiness',
    'raw-execution-attestation',
    'approved-scope-binding',
  ],
  domains: ['research', 'literature', 'omics', 'scientific-reproduction'],
  requiredCapabilities: [],
  inputSchema: {
    type: 'object',
    required: ['artifacts'],
    properties: {
      goal: { type: 'string' },
      artifacts: { type: 'array', items: { type: 'object' } },
      artifactRefs: { type: 'array', items: { type: 'string' } },
      traceRefs: { type: 'array', items: { type: 'string' } },
      providerHints: { type: 'object' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['schemaVersion', 'verdict', 'confidence', 'criterionResults', 'repairHints'],
    properties: {
      schemaVersion: { const: 'sciforge.scientific-reproduction-verifier.v1' },
      verdict: { enum: ['pass', 'fail', 'uncertain', 'needs-human', 'unverified'] },
      confidence: { type: 'number' },
      reward: { type: 'number' },
      criterionResults: { type: 'array', items: { type: 'object' } },
      repairHints: { type: 'array', items: { type: 'string' } },
      evidenceRefs: { type: 'array', items: { type: 'string' } },
    },
  },
  sideEffects: ['none'],
  safety: {
    risk: 'medium',
    dataScopes: ['artifact-metadata', 'evidence-refs', 'trace-refs'],
  },
  examples: [{
    title: 'Validate a figure reproduction report and claim verdict artifact',
    inputRef: 'artifact:figure-reproduction-report + artifact:claim-verdict',
    outputRef: 'verifier-result:scientific-reproduction',
  }],
  validators: [{
    id: 'verifier.scientific-reproduction.smoke',
    kind: 'smoke',
    command: 'tsx tests/smoke/smoke-scientific-reproduction-verifier.ts',
    expectedRefs: ['artifact:claim-verdict', 'artifact:figure-reproduction-report'],
  }],
  repairHints: [
    {
      failureCode: 'scientific-reproduction.claim-evidence-missing',
      summary: 'Claims must have evidence refs or explicit missing-evidence reasons.',
      recoverActions: ['add-evidence-refs', 'add-missing-evidence-report'],
    },
    {
      failureCode: 'scientific-reproduction.figure-provenance-missing',
      summary: 'Figure reproduction records must include code, data, parameters, logs, and statistics.',
      recoverActions: ['attach-code-ref', 'attach-data-ref', 'attach-log-ref', 'record-statistical-method'],
    },
    {
      failureCode: 'scientific-reproduction.negative-result-ambiguous',
      summary: 'Negative scientific conclusions must be separated from operational tool failures.',
      recoverActions: ['write-negative-result-report', 'classify-operational-failure', 'attach-statistical-evidence'],
    },
    {
      failureCode: 'scientific-reproduction.raw-data-readiness-blocked',
      summary: 'Raw-data execution must be blocked until approval, license, budget, environment, checksum, and readiness checks pass.',
      recoverActions: ['write-raw-data-readiness-dossier', 'record-approval-state', 'attach-budget-and-environment-refs', 'keep-raw-execution-gate-blocked'],
    },
    {
      failureCode: 'scientific-reproduction.raw-execution-attestation-missing',
      summary: 'Execute-approved raw-data success claims require completed execution attestations bound to plan, logs, outputs, checksums, environment, and budget refs.',
      recoverActions: ['add-execution-attestation', 'attach-run-logs', 'attach-output-refs', 'record-budget-debits', 'bind-success-evidence-to-attestation'],
    },
  ],
  providers: [{
    id: 'verifier.scientific-reproduction.generic',
    label: 'Generic scientific reproduction rule verifier',
    kind: 'package',
    contractRef: 'sciforge.scientific-reproduction-verifier.v1',
    requiredConfig: [],
  }],
  lifecycle: {
    status: 'validated',
    sourceRef: 'packages/verifiers/scientific-reproduction',
  },
  metadata: {
    verifierType: 'schema-test',
    runtimeIntegration: 'Package-owned runtime adapter can be selected by capability id or provider id and feeds standard runtime verification results.',
  },
};
