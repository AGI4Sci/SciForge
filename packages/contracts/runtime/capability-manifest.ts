export const CAPABILITY_MANIFEST_CONTRACT_ID = 'sciforge.capability-manifest.v1' as const;

export type CapabilityManifestKind =
  | 'observe'
  | 'skill'
  | 'action'
  | 'verifier'
  | 'view'
  | 'memory'
  | 'importer'
  | 'exporter'
  | 'runtime-adapter'
  | 'composed';

export type CapabilityManifestLifecycle = 'draft' | 'validated' | 'published' | 'deprecated';
export type CapabilityManifestRisk = 'low' | 'medium' | 'high';
export type CapabilityManifestSideEffect = 'none' | 'workspace-read' | 'workspace-write' | 'network' | 'desktop' | 'external-api';

export interface CapabilityProviderManifest {
  id: string;
  label: string;
  kind: 'built-in' | 'package' | 'workspace' | 'external';
  contractRef?: string;
  requiredConfig: string[];
  priority?: number;
}

export interface CapabilityValidatorManifest {
  id: string;
  kind: 'schema' | 'smoke' | 'verifier' | 'human' | 'external';
  contractRef?: string;
  command?: string;
  expectedRefs?: string[];
}

export interface CapabilityRepairHint {
  failureCode: string;
  summary: string;
  recoverActions: string[];
  exampleRef?: string;
}

export interface CapabilityManifest {
  contract: typeof CAPABILITY_MANIFEST_CONTRACT_ID;
  id: string;
  name: string;
  version: string;
  ownerPackage: string;
  kind: CapabilityManifestKind;
  brief: string;
  routingTags: string[];
  domains: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  sideEffects: CapabilityManifestSideEffect[];
  safety: {
    risk: CapabilityManifestRisk;
    dataScopes: string[];
    requiresHumanApproval?: boolean;
  };
  examples: Array<{
    title: string;
    prompt?: string;
    inputRef?: string;
    outputRef?: string;
  }>;
  validators: CapabilityValidatorManifest[];
  repairHints: CapabilityRepairHint[];
  providers: CapabilityProviderManifest[];
  lifecycle: {
    status: CapabilityManifestLifecycle;
    sourceRef: string;
    createdAt?: string;
    updatedAt?: string;
    replaces?: string[];
  };
  metadata?: Record<string, unknown>;
}

export type CapabilityManifestBrief = Pick<
  CapabilityManifest,
  'contract' | 'id' | 'name' | 'version' | 'ownerPackage' | 'kind' | 'brief' | 'routingTags' | 'domains' | 'sideEffects' | 'safety' | 'lifecycle'
> & {
  providerIds: string[];
  validatorIds: string[];
  repairFailureCodes: string[];
};

export interface CapabilityManifestRegistry {
  manifests: CapabilityManifest[];
  briefs: CapabilityManifestBrief[];
  manifestIds: string[];
  providerIds: string[];
}

export const capabilityManifestSchema = {
  $id: 'sciforge.capability-manifest.schema.json',
  type: 'object',
  required: [
    'contract',
    'id',
    'name',
    'version',
    'ownerPackage',
    'kind',
    'brief',
    'routingTags',
    'domains',
    'inputSchema',
    'outputSchema',
    'sideEffects',
    'safety',
    'examples',
    'validators',
    'repairHints',
    'providers',
    'lifecycle',
  ],
  properties: {
    contract: { const: CAPABILITY_MANIFEST_CONTRACT_ID },
    id: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string' },
    ownerPackage: { type: 'string' },
    kind: { enum: ['observe', 'skill', 'action', 'verifier', 'view', 'memory', 'importer', 'exporter', 'runtime-adapter', 'composed'] },
    brief: { type: 'string' },
    routingTags: { type: 'array', items: { type: 'string' } },
    domains: { type: 'array', items: { type: 'string' } },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: { type: 'array', items: { enum: ['none', 'workspace-read', 'workspace-write', 'network', 'desktop', 'external-api'] } },
    safety: {
      type: 'object',
      required: ['risk', 'dataScopes'],
      properties: {
        risk: { enum: ['low', 'medium', 'high'] },
        dataScopes: { type: 'array', items: { type: 'string' } },
        requiresHumanApproval: { type: 'boolean' },
      },
    },
    examples: { type: 'array' },
    validators: { type: 'array' },
    repairHints: { type: 'array' },
    providers: { type: 'array' },
    lifecycle: {
      type: 'object',
      required: ['status', 'sourceRef'],
      properties: {
        status: { enum: ['draft', 'validated', 'published', 'deprecated'] },
        sourceRef: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
        replaces: { type: 'array', items: { type: 'string' } },
      },
    },
    metadata: { type: 'object' },
  },
} as const;

export function compactCapabilityManifestBrief(manifest: CapabilityManifest): CapabilityManifestBrief {
  return {
    contract: manifest.contract,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    ownerPackage: manifest.ownerPackage,
    kind: manifest.kind,
    brief: manifest.brief,
    routingTags: [...manifest.routingTags],
    domains: [...manifest.domains],
    sideEffects: [...manifest.sideEffects],
    safety: { ...manifest.safety, dataScopes: [...manifest.safety.dataScopes] },
    lifecycle: { ...manifest.lifecycle, replaces: manifest.lifecycle.replaces ? [...manifest.lifecycle.replaces] : undefined },
    providerIds: manifest.providers.map((provider) => provider.id),
    validatorIds: manifest.validators.map((validator) => validator.id),
    repairFailureCodes: manifest.repairHints.map((hint) => hint.failureCode),
  };
}

export function validateCapabilityManifestShape(manifest: CapabilityManifest): string[] {
  const failures: string[] = [];
  if (manifest.contract !== CAPABILITY_MANIFEST_CONTRACT_ID) failures.push('contract must be sciforge.capability-manifest.v1');
  for (const field of ['id', 'name', 'version', 'ownerPackage', 'brief'] as const) {
    if (!manifest[field]?.trim()) failures.push(`${field} must be non-empty`);
  }
  if (!manifest.routingTags.length) failures.push('routingTags must include at least one tag');
  if (!manifest.providers.length) failures.push('providers must include at least one provider');
  if (!manifest.validators.length) failures.push('validators must include at least one validator');
  if (!manifest.lifecycle.sourceRef.trim()) failures.push('lifecycle.sourceRef must be non-empty');
  if (manifest.sideEffects.includes('none') && manifest.sideEffects.length > 1) failures.push('sideEffects none cannot be combined with other side effects');
  return failures;
}

export function validateCapabilityManifestRegistry(manifests: CapabilityManifest[]): string[] {
  const failures = manifests.flatMap((manifest) =>
    validateCapabilityManifestShape(manifest).map((failure) => `${manifest.id || '<missing-id>'}: ${failure}`),
  );
  const manifestIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const manifest of manifests) {
    if (manifestIds.has(manifest.id)) failures.push(`${manifest.id}: duplicate manifest id`);
    manifestIds.add(manifest.id);
    for (const provider of manifest.providers) {
      if (providerIds.has(provider.id)) failures.push(`${manifest.id}: duplicate provider id ${provider.id}`);
      providerIds.add(provider.id);
    }
  }
  return failures;
}

export const CORE_CAPABILITY_MANIFESTS: CapabilityManifest[] = [
  literatureRetrievalCapabilityManifest(),
  coreCapabilityManifest('skill.agentserver-generation', 'Use AgentServer with scenario policy, refs, and artifact contracts to generate or repair workspace tasks.', 'skill', 'src/runtime/generation-gateway.ts', ['workspace-write']),
  coreCapabilityManifest('runtime.artifact-list', 'List session artifacts and project them into stable object references.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  coreCapabilityManifest('runtime.artifact-resolve', 'Resolve object references to workspace-backed facts.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  coreCapabilityManifest('runtime.artifact-read', 'Read bounded artifact, file, run, and execution-unit refs.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  coreCapabilityManifest('runtime.artifact-render', 'Render artifacts into markdown, text, JSON, or preview-safe refs.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  coreCapabilityManifest('runtime.run-resume', 'Resume prior workspace runs from task attempts while preserving object references.', 'runtime-adapter', 'src/runtime/backend-artifact-tools.ts', ['workspace-read']),
  coreCapabilityManifest('runtime.workspace-read', 'Read allowed workspace paths through the runtime path contract.', 'action', 'src/runtime/workspace-paths.ts', ['workspace-read']),
  coreCapabilityManifest('runtime.workspace-write', 'Write managed workspace outputs with stable refs.', 'action', 'src/runtime/workspace-task-runner.ts', ['workspace-write']),
  coreCapabilityManifest('runtime.command-run', 'Run bounded workspace commands and capture stdout, stderr, and output refs.', 'action', 'src/runtime/workspace-task-runner.ts', ['workspace-write']),
  coreCapabilityManifest('runtime.python-task', 'Execute generated Python tasks against inputPath and outputPath contracts.', 'action', 'src/runtime/workspace-task-runner.ts', ['workspace-write']),
  payloadValidationCapabilityManifest(),
  runtimeVerificationGateCapabilityManifest(),
  coreCapabilityManifest('observe.vision', 'Observe screenshots or images and return bounded visual evidence refs.', 'observe', 'packages/observe/vision', ['workspace-read']),
  coreCapabilityManifest('action.computer-use', 'Perform guarded desktop actions with trace evidence.', 'action', 'packages/actions/computer-use', ['desktop']),
  coreCapabilityManifest('view.report', 'Render report artifacts from manifest-bound refs.', 'view', 'packages/presentation/components', ['none']),
  coreCapabilityManifest('verifier.schema', 'Validate payloads, artifacts, refs, and UI manifests before completion.', 'verifier', 'packages/verifiers/schema', ['none']),
];

function literatureRetrievalCapabilityManifest(): CapabilityManifest {
  const providerIds = ['pubmed', 'crossref', 'semantic-scholar', 'openalex', 'arxiv', 'web-search', 'scp-biomedical-search'];
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: 'literature.retrieval',
    name: 'literature retrieval',
    version: '0.1.0',
    ownerPackage: 'packages/skills/literature',
    kind: 'composed',
    brief: 'Retrieve and normalize scholarly literature into auditable paper-list, evidence-matrix, research-report, and citation verification refs.',
    routingTags: ['literature', 'retrieval', 'paper-list', 'evidence', 'citation', 'full-text'],
    domains: ['literature', 'research'],
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 1 },
        databases: {
          type: 'array',
          items: { enum: ['pubmed', 'crossref', 'semantic-scholar', 'openalex', 'arxiv', 'web-search', 'scp-biomedical-search'] },
        },
        dateRange: {
          type: 'object',
          properties: {
            from: { type: 'string' },
            to: { type: 'string' },
          },
        },
        species: { type: 'array', items: { type: 'string' } },
        maxResults: { type: 'integer', minimum: 1, maximum: 200 },
        includeAbstracts: { type: 'boolean' },
        fullTextPolicy: { enum: ['metadata-only', 'abstracts', 'bounded-full-text'] },
        dedupePolicy: { enum: ['doi-pmid-arxiv-title-year', 'provider-native', 'none'] },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['status', 'paperList', 'workEvidence', 'providerAttempts', 'citationVerificationResults'],
      properties: {
        status: { enum: ['success', 'partial', 'failed'] },
        paperList: { type: 'array', items: { type: 'object' } },
        evidenceMatrix: { type: 'array', items: { type: 'object' } },
        researchReport: { type: 'object' },
        workEvidence: { type: 'array', items: { type: 'object' } },
        providerAttempts: { type: 'array', items: { type: 'object' } },
        citationVerificationResults: { type: 'array', items: { type: 'object' } },
        diagnostics: { type: 'array', items: { type: 'object' } },
      },
    },
    sideEffects: ['network', 'external-api'],
    safety: {
      risk: 'medium',
      dataScopes: ['public-web', 'workspace-refs'],
    },
    examples: [{
      title: 'recent CRISPR screen literature',
      prompt: 'Find recent CRISPR screening papers and return a paper-list with verified citations.',
      inputRef: 'capability:literature.retrieval/input.example',
      outputRef: 'capability:literature.retrieval/output.example',
    }],
    validators: [
      {
        id: 'literature.retrieval.schema',
        kind: 'schema',
        contractRef: 'literature.retrieval#outputSchema',
        expectedRefs: ['paper-list', 'workEvidence', 'providerAttempts', 'citationVerificationResults'],
      },
      {
        id: 'literature.retrieval.citation-verification',
        kind: 'verifier',
        contractRef: 'verifier.citation-integrity.v1',
        expectedRefs: ['citationVerificationResults'],
      },
    ],
    repairHints: [
      {
        failureCode: 'empty-results',
        summary: 'Return a structured empty-result failure with provider diagnostics and adjusted query hints.',
        recoverActions: ['record-provider-attempts', 'relax-date-range', 'try-fallback-provider'],
      },
      {
        failureCode: 'provider-timeout',
        summary: 'Return partial payload with timed-out provider attempt diagnostics instead of marking the retrieval successful.',
        recoverActions: ['emit-partial-payload', 'reduce-provider-budget', 'retry-available-provider'],
      },
      {
        failureCode: 'download-failure',
        summary: 'Preserve metadata refs and bounded extraction diagnostics when full text cannot be downloaded.',
        recoverActions: ['keep-metadata-only-ref', 'record-download-diagnostic', 'skip-full-text'],
      },
      {
        failureCode: 'citation-mismatch',
        summary: 'Fail closed or return partial payload when DOI, PMID, arXiv id, title, year, or journal verification disagrees.',
        recoverActions: ['mark-citation-unverified', 'dedupe-by-stable-identifiers', 'request-repair'],
      },
    ],
    providers: providerIds.map((providerId, index) => ({
      id: `literature.retrieval.${providerId}`,
      label: providerId,
      kind: providerId === 'web-search' ? 'external' : 'package',
      contractRef: `packages/skills/literature/providers/${providerId}`,
      requiredConfig: [],
      priority: index + 1,
    })),
    lifecycle: {
      status: 'draft',
      sourceRef: 'packages/skills/literature',
    },
    metadata: {
      producesArtifactTypes: ['paper-list', 'evidence-matrix', 'research-report', 'workEvidence', 'providerAttempts', 'citationVerificationResults'],
      budget: {
        maxProviders: 3,
        maxResultItems: 30,
        perProviderTimeoutMs: 10000,
        maxDownloadBytes: 25000000,
        maxRetries: 1,
        exhaustedPolicy: 'partial-payload',
      },
      fullTextBudget: {
        maxFullTextDownloads: 3,
        promptPolicy: 'refs-first-bounded-summary-only',
      },
      citationFields: ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal'],
    },
  };
}

function coreCapabilityManifest(
  id: string,
  brief: string,
  kind: CapabilityManifest['kind'],
  sourceRef: string,
  sideEffects: CapabilityManifest['sideEffects'],
): CapabilityManifest {
  const providerId = `sciforge.core.${id}`;
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id.split('.').slice(1).join(' '),
    version: '0.1.0',
    ownerPackage: sourceRef.startsWith('packages/') ? sourceRef.split('/').slice(0, 3).join('/') : 'src/runtime',
    kind,
    brief,
    routingTags: id.split(/[.-]/).filter(Boolean),
    domains: ['workspace'],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects,
    safety: {
      risk: sideEffects.includes('desktop') || sideEffects.includes('workspace-write') ? 'medium' : 'low',
      dataScopes: sideEffects.includes('none') ? [] : ['workspace'],
    },
    examples: [{
      title: `${id} smoke`,
      inputRef: 'contract:example-input',
      outputRef: 'contract:example-output',
    }],
    validators: [{
      id: `${providerId}.schema`,
      kind: 'schema',
      contractRef: `${id}#schema`,
    }],
    repairHints: [{
      failureCode: 'contract-invalid',
      summary: 'Regenerate payload according to this capability manifest contract.',
      recoverActions: ['reload-manifest', 'validate-io-schema', 'preserve-related-refs'],
    }],
    providers: [{
      id: providerId,
      label: `${id} provider`,
      kind: sourceRef.startsWith('packages/') ? 'package' : 'built-in',
      contractRef: sourceRef,
      requiredConfig: [],
    }],
    lifecycle: {
      status: 'draft',
      sourceRef,
    },
  };
}

function payloadValidationCapabilityManifest(): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: 'sciforge.payload-validation',
    name: 'payload validation',
    version: '0.1.0',
    ownerPackage: 'src/runtime',
    kind: 'verifier',
    brief: 'Validate ToolPayload schema, completed deliverables, current refs, and attach repair/audit budget debit refs.',
    routingTags: ['payload', 'validation', 'toolpayload', 'schema', 'repair', 'audit', 'current-reference', 'work-evidence'],
    domains: ['workspace', 'runtime', 'validation'],
    inputSchema: {
      type: 'object',
      required: ['payload', 'request', 'skill', 'refs'],
      properties: {
        payload: { type: 'object' },
        request: { type: 'object' },
        skill: { type: 'object' },
        refs: { type: 'object' },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['payload'],
      properties: {
        payload: { type: 'object' },
        validationFailure: { type: 'object' },
        validationRepairAudit: { type: 'object' },
        budgetDebits: { type: 'array', items: { type: 'object' } },
      },
    },
    sideEffects: ['workspace-write'],
    safety: {
      risk: 'medium',
      dataScopes: ['workspace', 'current-refs', 'task-attempts'],
    },
    examples: [{
      title: 'repair-needed schema failure',
      inputRef: 'src/runtime/gateway/payload-validation.ts#validateAndNormalizePayload',
      outputRef: 'audit:payload-validation:*',
    }],
    validators: [
      {
        id: 'sciforge.payload-validation.schema',
        kind: 'schema',
        contractRef: 'packages/contracts/runtime/validation-failure.ts#ContractValidationFailure',
        expectedRefs: ['validationFailure', 'validationRepairAudit', 'budgetDebits'],
      },
      {
        id: 'sciforge.payload-validation.smoke',
        kind: 'smoke',
        command: 'npm run smoke:validation-repair-audit-chain',
        expectedRefs: ['appendTaskAttempt:payload-validation:*'],
      },
    ],
    repairHints: [
      {
        failureCode: 'schema-error',
        summary: 'Regenerate the ToolPayload according to the runtime payload contract and preserve failed refs in audit.',
        recoverActions: ['validate-toolpayload-schema', 'preserve-output-refs', 'emit-repair-needed-payload'],
      },
      {
        failureCode: 'incomplete-payload',
        summary: 'Do not mark future promised work as complete without durable artifacts, final text, or explicit failure status.',
        recoverActions: ['run-promised-work', 'attach-durable-artifact-ref', 'return-failed-with-reason-if-blocked'],
      },
      {
        failureCode: 'current-reference-missing',
        summary: 'Regenerate from the required current-turn refs or report them as unreadable with a repair-needed result.',
        recoverActions: ['read-current-reference', 'include-current-ref-evidence', 'preserve-reference-validation-audit'],
      },
    ],
    providers: [{
      id: 'sciforge.payload-validation',
      label: 'SciForge payload validation gate',
      kind: 'built-in',
      contractRef: 'src/runtime/gateway/payload-validation.ts',
      requiredConfig: [],
      priority: 1,
    }],
    lifecycle: {
      status: 'validated',
      sourceRef: 'src/runtime/gateway/payload-validation.ts',
    },
    metadata: {
      budget: {
        costUnits: 1,
        maxResultItems: 50,
        maxRetries: 1,
        exhaustedPolicy: 'fail-with-reason',
      },
      producesAuditRefs: ['audit:payload-validation:*', 'appendTaskAttempt:payload-validation:*'],
      producesBudgetDebitCapabilityId: 'sciforge.payload-validation',
    },
  };
}

function runtimeVerificationGateCapabilityManifest(): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: 'sciforge.runtime-verification-gate',
    name: 'runtime verification gate',
    version: '0.1.0',
    ownerPackage: 'src/runtime',
    kind: 'verifier',
    brief: 'Apply runtime verification policy, persist verification artifacts, and fail closed with repair/audit refs when required.',
    routingTags: ['runtime', 'verification', 'gate', 'verifier', 'human-approval', 'audit', 'repair'],
    domains: ['workspace', 'runtime', 'verification'],
    inputSchema: {
      type: 'object',
      required: ['payload', 'request'],
      properties: {
        payload: { type: 'object' },
        request: { type: 'object' },
        verificationPolicy: { type: 'object' },
        verificationResults: { type: 'array', items: { type: 'object' } },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['payload', 'verificationResults'],
      properties: {
        payload: { type: 'object' },
        verificationPolicy: { type: 'object' },
        verificationResults: { type: 'array', items: { type: 'object' } },
        verificationArtifactRef: { type: 'string' },
        budgetDebits: { type: 'array', items: { type: 'object' } },
      },
    },
    sideEffects: ['workspace-write'],
    safety: {
      risk: 'medium',
      dataScopes: ['workspace', 'verification-results', 'current-refs'],
    },
    examples: [{
      title: 'failed runtime verification gate',
      inputRef: 'src/runtime/gateway/verification-policy.ts#applyRuntimeVerificationPolicy',
      outputRef: '.sciforge/verifications/*.json',
    }],
    validators: [
      {
        id: 'sciforge.runtime-verification-gate.schema',
        kind: 'schema',
        contractRef: 'packages/contracts/runtime/verification-result.ts#RuntimeVerificationResult',
        expectedRefs: ['verification-result', 'validationRepairAudit', 'budgetDebits'],
      },
      {
        id: 'sciforge.runtime-verification-gate.smoke',
        kind: 'smoke',
        command: 'npm run smoke:validation-repair-audit-verification-artifact-sink',
        expectedRefs: ['verification-artifact:.sciforge/verifications/*'],
      },
    ],
    repairHints: [
      {
        failureCode: 'missing-verifier-result',
        summary: 'Require a passing verifier result or explicit non-blocking policy before treating the payload as complete.',
        recoverActions: ['run-required-verifier', 'attach-verification-result', 'preserve-verification-artifact'],
      },
      {
        failureCode: 'needs-human',
        summary: 'Stop automatic completion until human approval is attached to the verification result.',
        recoverActions: ['request-human-approval', 'attach-approval-ref', 'rerun-verification-gate'],
      },
      {
        failureCode: 'failed-verdict',
        summary: 'Fail closed with verification and repair refs instead of downgrading a failed verifier to success.',
        recoverActions: ['preserve-failed-verdict', 'emit-repair-needed-payload', 'rerun-after-fix'],
      },
    ],
    providers: [{
      id: 'sciforge.runtime-verification-gate',
      label: 'SciForge runtime verification gate',
      kind: 'built-in',
      contractRef: 'src/runtime/gateway/verification-policy.ts',
      requiredConfig: [],
      priority: 1,
    }],
    lifecycle: {
      status: 'validated',
      sourceRef: 'src/runtime/gateway/verification-policy.ts',
    },
    metadata: {
      budget: {
        costUnits: 1,
        maxResultItems: 1,
        maxRetries: 1,
        exhaustedPolicy: 'needs-human',
      },
      producesArtifactTypes: ['verification-result'],
      producesAuditRefs: ['audit:runtime-verification-gate:*', 'verification-artifact:.sciforge/verifications/*'],
      producesBudgetDebitCapabilityId: 'sciforge.runtime-verification-gate',
    },
  };
}
