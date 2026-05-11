import assert from 'node:assert/strict';

import {
  brokerCapabilities,
  brokerCapabilitiesForRequestShape,
  capabilityBrokerInputFromRequestShape,
  CapabilityManifestRegistry,
} from '../../src/runtime/capability-broker.js';
import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import type { CapabilityEvolutionCompactSummary } from '../../packages/contracts/runtime/capability-evolution.js';

const manifests = [
  manifest({
    id: 'runtime.artifact-read',
    kind: 'runtime-adapter',
    brief: 'Read bounded artifact, file, run, and execution-unit refs.',
    routingTags: ['artifact', 'read', 'file', 'workspace'],
    domains: ['workspace'],
    sideEffects: ['workspace-read'],
  }),
  manifest({
    id: 'view.report',
    kind: 'view',
    brief: 'Render report markdown artifacts from manifest-bound refs.',
    routingTags: ['report', 'markdown', 'render'],
    domains: ['presentation'],
    sideEffects: ['none'],
  }),
  manifest({
    id: 'action.desktop-publish',
    kind: 'action',
    brief: 'Publish desktop output through a guarded external action.',
    routingTags: ['desktop', 'publish'],
    domains: ['external'],
    sideEffects: ['desktop', 'external-api'],
    risk: 'high',
    requiresHumanApproval: true,
  }),
  manifest({
    id: 'verifier.schema',
    kind: 'verifier',
    brief: 'Validate payloads and artifacts against JSON schema contracts.',
    routingTags: ['schema', 'validate', 'contract'],
    domains: ['workspace'],
    sideEffects: ['none'],
    repairFailureCode: 'schema-invalid',
  }),
];

const registry = new CapabilityManifestRegistry(manifests);
const brokered = brokerCapabilities({
  prompt: 'Read the prior artifact report, validate its schema, and render markdown.',
  objectRefs: [{
    ref: 'artifact:report-1',
    kind: 'artifact',
    artifactType: 'research-report',
    title: 'Prior report',
  }],
  artifactIndex: [{
    ref: 'file:reports/report.md',
    artifactType: 'markdown',
    tags: ['report', 'workspace'],
  }],
  failureHistory: [{
    capabilityId: 'verifier.schema',
    failureCode: 'schema-invalid',
    recoverActions: ['reload-schema'],
    refs: ['log:schema'],
  }],
  scenarioPolicy: {
    id: 'literature-review',
    preferredCapabilityIds: ['view.report'],
    blockedDomains: ['external'],
    requiredTags: ['report'],
  },
  runtimePolicy: {
    topK: 3,
    riskTolerance: 'medium',
    allowSideEffects: ['none', 'workspace-read'],
  },
  availableProviders: ['runtime.artifact-read.provider', 'view.report.provider', 'verifier.schema.provider'],
}, registry);

assert.equal(brokered.contract, 'sciforge.capability-broker-output.v1');
assert.deepEqual(
  brokered.briefs.map((brief) => brief.id),
  ['view.report', 'runtime.artifact-read', 'verifier.schema'],
);
assert.equal(brokered.inputSummary.objectRefs, 1);
assert.equal(brokered.inputSummary.artifactIndexEntries, 1);
assert.equal(brokered.inputSummary.failureHistoryEntries, 1);
assert.ok(brokered.excluded.some((item) => item.id === 'action.desktop-publish' && /blocked|risk|side effect|provider/.test(item.reason)));

const rawBrokerPayload = JSON.stringify(brokered);
assert.equal(rawBrokerPayload.includes('inputSchema'), false, 'broker output must not expose full input schema');
assert.equal(rawBrokerPayload.includes('outputSchema'), false, 'broker output must not expose full output schema');
assert.equal(rawBrokerPayload.includes('example report input'), false, 'broker output must not expose examples');
assert.equal(rawBrokerPayload.includes('Regenerate with a valid schema payload'), false, 'broker output must not expose repair hints');
assert.deepEqual(brokered.briefs[0]?.providerIds, ['view.report.provider']);
assert.ok(brokered.briefs[0]?.matchedSignals.some((signal) => signal.includes('scenario preferred capability')));

const summaryOnly = registry.expand(brokered.briefs[0]);
assert.equal(summaryOnly.id, 'view.report');
assert.equal(summaryOnly.summary.id, 'view.report');
assert.equal(summaryOnly.inputSchema, undefined);
assert.equal(summaryOnly.examples, undefined);
assert.deepEqual(summaryOnly.summary.providerIds, ['view.report.provider']);

const schemaExpansion = registry.expand('verifier.schema', {
  includeSchemas: true,
  includeExamples: true,
  includeRepairHints: true,
  includeFailureRefs: true,
  failureHistory: [{
    capabilityId: 'verifier.schema',
    failureCode: 'schema-invalid',
    recoverActions: ['reload-schema'],
    refs: ['log:schema', 'artifact:broken-report', 'log:schema'],
  }],
  includeProviders: true,
});
assert.equal(schemaExpansion.inputSchema?.type, 'object');
assert.equal(schemaExpansion.outputSchema?.type, 'object');
assert.equal(schemaExpansion.examples?.[0]?.title, 'example report input');
assert.equal(schemaExpansion.repairHints?.[0]?.failureCode, 'schema-invalid');
assert.deepEqual(schemaExpansion.failureRefs, ['log:schema', 'artifact:broken-report']);
assert.equal(schemaExpansion.providers?.[0]?.id, 'verifier.schema.provider');

assert.throws(
  () => new CapabilityManifestRegistry([manifests[0]!, { ...manifests[0]! }]),
  /Duplicate capability manifest id/,
);

const requestShapedInput = capabilityBrokerInputFromRequestShape({
  prompt: 'Read an artifact report and validate the schema.',
  goal: 'Render markdown for the current workspace.',
  refs: ['artifact:report-1'],
  scenario: 'literature-review',
  expectedArtifacts: ['markdown'],
  topK: 2,
  riskTolerance: 'medium',
  explicitCapabilityIds: ['view.report'],
  failureHistory: [{
    capabilityId: 'verifier.schema',
    failureCode: 'schema-invalid',
    recoverActions: ['reload-schema'],
    refs: ['artifact:broken-report'],
    stdoutRef: '.sciforge/logs/schema.stdout.log',
    stderrRef: '.sciforge/logs/schema.stderr.log',
    traceRef: '.sciforge/traces/schema.json',
  }],
  availableProviders: ['runtime.artifact-read.provider', 'view.report.provider', 'verifier.schema.provider'],
});
assert.equal(requestShapedInput.objectRefs?.[0]?.ref, 'artifact:report-1');
assert.equal(requestShapedInput.scenarioPolicy?.preferredCapabilityIds?.[0], 'view.report');
assert.equal(requestShapedInput.artifactIndex?.[0]?.artifactType, 'markdown');
assert.deepEqual(
  registry.expand('verifier.schema', {
    includeFailureRefs: true,
    failureHistory: requestShapedInput.failureHistory,
  }).failureRefs,
  [
    'artifact:broken-report',
    '.sciforge/logs/schema.stdout.log',
    '.sciforge/logs/schema.stderr.log',
    '.sciforge/traces/schema.json',
  ],
);

const requestShapedBrokered = brokerCapabilitiesForRequestShape({
  prompt: 'Read an artifact report and validate the schema.',
  goal: 'Render markdown for the current workspace.',
  refs: ['artifact:report-1'],
  scenario: 'literature-review',
  expectedArtifacts: ['markdown'],
  topK: 2,
  riskTolerance: 'medium',
  explicitCapabilityIds: ['view.report'],
  availableProviders: ['runtime.artifact-read.provider', 'view.report.provider', 'verifier.schema.provider'],
}, registry);
assert.deepEqual(
  requestShapedBrokered.briefs.map((brief) => brief.id),
  ['view.report', 'runtime.artifact-read'],
);

const cheapFirstBrokered = brokerCapabilities({
  prompt: 'Summarize cheap first from the workspace report.',
  runtimePolicy: {
    topK: 2,
    riskTolerance: 'high',
  },
  availableProviders: ['runtime.cheap-summary.provider', 'runtime.expensive-project.provider'],
}, new CapabilityManifestRegistry([
  manifest({
    id: 'runtime.cheap-summary',
    kind: 'runtime-adapter',
    brief: 'Summarize report from workspace metadata.',
    routingTags: ['summarize', 'report', 'workspace'],
    domains: ['workspace'],
    sideEffects: ['workspace-read'],
    costClass: 'low',
    latencyClass: 'low',
    sideEffectClass: 'read',
  }),
  manifest({
    id: 'runtime.expensive-project',
    kind: 'composed',
    brief: 'Summarize report through a deep project rerun.',
    routingTags: ['summarize', 'report', 'workspace'],
    domains: ['workspace'],
    sideEffects: ['workspace-write', 'network'],
    risk: 'high',
    costClass: 'high',
    latencyClass: 'high',
    sideEffectClass: 'network',
  }),
]));
assert.deepEqual(cheapFirstBrokered.briefs.map((brief) => brief.id), ['runtime.cheap-summary', 'runtime.expensive-project']);
assert.ok(cheapFirstBrokered.briefs[0]?.matchedSignals.some((signal) => signal.includes('cheap-first preferred')));
assert.ok(cheapFirstBrokered.audit.find((entry) => entry.id === 'runtime.expensive-project')?.penalties.some((penalty) => penalty.includes('cheap-first escalation cost')));

const ledgerSummaryWithPrivateFields = {
  schemaVersion: 'sciforge.capability-evolution-compact-summary.v1',
  generatedAt: '2026-05-09T00:10:00.000Z',
  sourceRef: '.sciforge/capability-evolution-ledger/records.jsonl',
  totalRecords: 2,
  statusCounts: { succeeded: 1, 'repair-failed': 1 },
  fallbackRecordCount: 0,
  repairRecordCount: 1,
  promotionCandidates: [],
  recentRecords: [{
    id: 'cel-broker-success',
    recordedAt: '2026-05-09T00:09:00.000Z',
    goalSummary: 'Read bounded artifact refs.',
    selectedCapabilityIds: ['runtime.artifact-read'],
    providerIds: ['runtime.artifact-read.provider'],
    finalStatus: 'succeeded',
    recoverActions: [],
    repairAttemptCount: 0,
    artifactRefs: ['artifact:report-1'],
    executionUnitRefs: ['.sciforge/logs/ledger-success.stdout.log'],
    recordRef: '.sciforge/capability-evolution-ledger/records.jsonl#L1',
  }, {
    id: 'cel-broker-schema-failure',
    recordedAt: '2026-05-09T00:10:00.000Z',
    goalSummary: 'Validate report payload without exposing generated code.',
    selectedCapabilityIds: ['verifier.schema'],
    providerIds: ['verifier.schema.provider'],
    finalStatus: 'repair-failed',
    failureCode: 'schema-invalid',
    recoverActions: ['reload-schema'],
    repairAttemptCount: 1,
    artifactRefs: ['artifact:broken-report'],
    executionUnitRefs: ['.sciforge/logs/schema-failure.stderr.log'],
    validationSummary: 'Schema validation failed.',
    recordRef: '.sciforge/capability-evolution-ledger/records.jsonl#L2',
    metadata: { glueCode: 'LEDGER_GLUE_CODE_SENTINEL', stdout: 'LEDGER_FULL_LOG_SENTINEL' },
  }],
} as unknown as CapabilityEvolutionCompactSummary;

const brokeredFromLedgerSummary = brokerCapabilities({
  prompt: 'Continue from the prior capability ledger and validate the schema.',
  capabilityEvolutionSummary: ledgerSummaryWithPrivateFields,
  runtimePolicy: {
    topK: 3,
    riskTolerance: 'medium',
    allowSideEffects: ['none', 'workspace-read'],
  },
  availableProviders: ['runtime.artifact-read.provider', 'view.report.provider', 'verifier.schema.provider'],
}, registry);
assert.equal(brokeredFromLedgerSummary.inputSummary.capabilityEvolutionRecords, 2);
assert.equal(brokeredFromLedgerSummary.inputSummary.capabilityEvolutionPromotionCandidates, 0);
assert.ok(
  brokeredFromLedgerSummary.briefs
    .find((brief) => brief.id === 'runtime.artifact-read')
    ?.matchedSignals.some((signal) => signal.includes('capability evolution ledger success')),
);
assert.ok(
  brokeredFromLedgerSummary.audit
    .find((entry) => entry.id === 'verifier.schema')
    ?.penalties.some((penalty) => penalty.includes('capability evolution ledger failure')),
);
const ledgerBrokerPayload = JSON.stringify(brokeredFromLedgerSummary);
assert.equal(ledgerBrokerPayload.includes('LEDGER_GLUE_CODE_SENTINEL'), false, 'broker must not expand ledger glue code');
assert.equal(ledgerBrokerPayload.includes('LEDGER_FULL_LOG_SENTINEL'), false, 'broker must not expand ledger logs');
assert.equal(ledgerBrokerPayload.includes('schema-failure.stderr.log'), false, 'broker output should stay on compact signals, not log refs');

console.log('[ok] capability broker returns compact briefs, consumes ledger summaries, and expands selected manifests on demand');

function manifest(options: {
  id: string;
  kind: CapabilityManifest['kind'];
  brief: string;
  routingTags: string[];
  domains: string[];
  sideEffects: CapabilityManifest['sideEffects'];
  risk?: CapabilityManifest['safety']['risk'];
  requiresHumanApproval?: boolean;
  repairFailureCode?: string;
  costClass?: CapabilityManifest['costClass'];
  latencyClass?: CapabilityManifest['latencyClass'];
  sideEffectClass?: CapabilityManifest['sideEffectClass'];
}): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: options.id,
    name: options.id.split('.').slice(1).join(' '),
    version: '0.1.0',
    ownerPackage: options.id.startsWith('view.') ? 'packages/presentation/components' : 'src/runtime',
    kind: options.kind,
    brief: options.brief,
    routingTags: options.routingTags,
    domains: options.domains,
    inputSchema: {
      type: 'object',
      properties: {
        input: { type: 'string' },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        output: { type: 'string' },
      },
    },
    sideEffects: options.sideEffects,
    costClass: options.costClass,
    latencyClass: options.latencyClass,
    sideEffectClass: options.sideEffectClass,
    safety: {
      risk: options.risk ?? 'low',
      dataScopes: options.sideEffects.includes('none') ? [] : ['workspace'],
      requiresHumanApproval: options.requiresHumanApproval,
    },
    examples: [{
      title: 'example report input',
      inputRef: 'contract:example-input',
      outputRef: 'contract:example-output',
    }],
    validators: [{
      id: `${options.id}.schema`,
      kind: 'schema',
      contractRef: `${options.id}#schema`,
    }],
    repairHints: [{
      failureCode: options.repairFailureCode ?? 'contract-invalid',
      summary: 'Regenerate with a valid schema payload.',
      recoverActions: ['reload-schema', 'preserve-related-refs'],
    }],
    providers: [{
      id: `${options.id}.provider`,
      label: `${options.id} provider`,
      kind: options.id.startsWith('view.') ? 'package' : 'built-in',
      contractRef: options.id,
      requiredConfig: [],
    }],
    lifecycle: {
      status: 'draft',
      sourceRef: options.id,
    },
  };
}
