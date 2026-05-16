import assert from 'node:assert/strict';

import {
  brokerCapabilities,
  CapabilityManifestRegistry,
} from '../../src/runtime/capability-broker.js';
import { loadCoreCapabilityManifestRegistry } from '../../src/runtime/capability-manifest-registry.js';
import { projectCapabilityManifestsToHarnessCandidates } from '../../src/runtime/capability-harness-candidates.js';
import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import { uiComponentManifests } from '../../packages/presentation/components/manifest-registry.js';

const graph = projectCapabilityManifestsToHarnessCandidates({
  manifests: [
    manifest('skill.literature-retrieval', 'skill', ['literature', 'retrieval']),
    manifest('tool.pubmed-search', 'skill', ['pubmed', 'search'], { harnessKind: 'tool', budget: { maxProviders: 1 } }),
    manifest('observe.vision', 'observe', ['vision']),
    manifest('action.computer-use', 'action', ['computer-use']),
    manifest('verifier.schema', 'verifier', ['schema']),
    manifest('view.report', 'view', ['report']),
  ],
  preferredCapabilityIds: ['skill.literature-retrieval'],
  availableProviders: [
    'provider.skill.literature-retrieval',
    'provider.tool.pubmed-search',
    'provider.observe.vision',
    'provider.action.computer-use',
    'provider.verifier.schema',
    'provider.view.report',
  ],
});

assert.equal(graph.contract, 'sciforge.unified-capability-graph.v1');
assert.deepEqual(new Set(graph.candidates.map((candidate) => candidate.kind)), new Set(['skill', 'tool', 'observe', 'action', 'verifier', 'view']));
assert.equal(graph.candidates[0]?.id, 'skill.literature-retrieval');
assert.equal(graph.candidates.find((candidate) => candidate.id === 'tool.pubmed-search')?.budget?.maxProviders, 1);
assert.ok(graph.candidates.every((candidate) => candidate.manifestRef && candidate.reasons.length > 0));
assert.ok(graph.candidates.every((candidate) => Array.isArray(candidate.providerAvailability)));
assert.ok(graph.candidates.every((candidate) => Array.isArray(candidate.fallbackCandidateIds)));
assert.ok(graph.audit.every((entry) => entry.manifestRef.startsWith('capability:')));

const gatedGraph = projectCapabilityManifestsToHarnessCandidates({
  manifests: [
    manifest('composed.literature-review', 'composed', ['literature'], {
      fallbackCandidateIds: ['skill.literature-retrieval', 'verifier.schema'],
    }),
    manifest('action.external-submit', 'action', ['external-submit']),
  ],
  blockedCapabilityIds: ['action.external-submit'],
  availableProviders: [{ id: 'provider.composed.literature-review', available: false, reason: 'missing API key' }],
});

assert.equal(gatedGraph.candidates.length, 0);
assert.equal(gatedGraph.audit.find((entry) => entry.id === 'composed.literature-review')?.blocked, 'provider unavailable: missing API key');
assert.deepEqual(
  gatedGraph.audit.find((entry) => entry.id === 'composed.literature-review')?.fallbackCandidateIds,
  ['skill.literature-retrieval', 'verifier.schema'],
);
assert.equal(gatedGraph.audit.find((entry) => entry.id === 'action.external-submit')?.blocked, 'blocked by harness/caller');

const registryGraph = loadCoreCapabilityManifestRegistry().projectHarnessCandidates({
  preferredCapabilityIds: ['observe.vision'],
});
assert.ok(registryGraph.candidates.some((candidate) => candidate.id === 'observe.vision' && candidate.kind === 'observe'));

const registry = loadCoreCapabilityManifestRegistry();
const packageAction = registry.getManifest('action.sciforge.computer-use');
const packageVerifier = registry.getManifest('verifier.fixture.human-approval');
const packagePdfSkill = registry.getManifest('skill.pdf-extract');
const packageProteinSkill = registry.getManifest('skill.scp.protein-properties-calculation');
const packagePlaywrightTool = registry.getManifest('tool.clawhub.playwright-mcp');
const packageVisionSenseTool = registry.getManifest('tool.local.vision-sense');
const runtimePayloadValidation = registry.getManifest('sciforge.payload-validation');
const runtimeVerificationGate = registry.getManifest('sciforge.runtime-verification-gate');
assert.ok(packageAction, 'packages/actions computer-use provider manifest should project into the core capability registry');
assert.ok(packageVerifier, 'packages/verifiers human approval provider manifest should project into the core capability registry');
assert.ok(packagePdfSkill, 'packages/skills pdf-extract manifest should project into the default capability registry');
assert.ok(packageProteinSkill, 'packages/skills SCP protein properties manifest should project into the default capability registry');
assert.ok(packagePlaywrightTool, 'packages/skills/tool_skills playwright MCP manifest should project into the default capability registry');
assert.ok(packageVisionSenseTool, 'packages/skills/tool_skills vision sense manifest should project into the default capability registry');
assert.ok(runtimePayloadValidation, 'runtime payload validation gate should project into the default capability registry');
assert.ok(runtimeVerificationGate, 'runtime verification gate should project into the default capability registry');
assert.equal(packageAction.kind, 'action');
assert.equal(packageVerifier.kind, 'verifier');
assert.equal(packagePdfSkill.kind, 'skill');
assert.equal(packagePlaywrightTool.metadata?.harnessKind, 'tool');
assert.equal(packageVisionSenseTool.metadata?.harnessKind, 'tool');
assert.equal(runtimePayloadValidation.kind, 'verifier');
assert.equal(runtimeVerificationGate.kind, 'verifier');
assert.equal(registry.getManifestByProviderId('sciforge.computer-use')?.id, 'action.sciforge.computer-use');
assert.equal(registry.getManifestByProviderId('fixture.human-approval')?.id, 'verifier.fixture.human-approval');
assert.equal(registry.getManifestByProviderId('sciforge.skill.pdf-extract')?.id, 'skill.pdf-extract');
assert.equal(registry.getManifestByProviderId('sciforge.tool.clawhub.playwright-mcp')?.id, 'tool.clawhub.playwright-mcp');
assert.equal(registry.getManifestByProviderId('sciforge.tool.local.vision-sense')?.id, 'tool.local.vision-sense');
assert.equal(registry.getManifestByProviderId('sciforge.payload-validation')?.id, 'sciforge.payload-validation');
assert.equal(registry.getManifestByProviderId('sciforge.runtime-verification-gate')?.id, 'sciforge.runtime-verification-gate');

const packageViewCapabilityIds = uiComponentManifests.map((component) => `view.${component.componentId}`);
const packageViewProviderIds = uiComponentManifests.map((component) => `sciforge.presentation.${component.componentId}`);
for (const component of uiComponentManifests) {
  const capabilityId = `view.${component.componentId}`;
  const providerId = `sciforge.presentation.${component.componentId}`;
  const packageView = registry.getManifest(capabilityId);
  assert.ok(packageView, `packages/presentation ${component.componentId} manifest should project into the core capability registry`);
  assert.equal(packageView.kind, 'view');
  assert.equal(packageView.ownerPackage, component.packageName);
  assert.equal(registry.getManifestByProviderId(providerId)?.id, capabilityId);
  assert.equal(packageView.examples[0]?.prompt, undefined, 'presentation package view examples must stay prompt-free');
}

const packageGraph = registry.projectHarnessCandidates({
  preferredCapabilityIds: [
    'action.sciforge.computer-use',
    'verifier.fixture.human-approval',
    'sciforge.payload-validation',
    'sciforge.runtime-verification-gate',
    'skill.pdf-extract',
    'tool.clawhub.playwright-mcp',
    'tool.local.vision-sense',
    ...packageViewCapabilityIds,
  ],
  availableProviders: [
    'sciforge.computer-use',
    'fixture.human-approval',
    'sciforge.payload-validation',
    'sciforge.runtime-verification-gate',
    'sciforge.skill.pdf-extract',
    'sciforge.tool.clawhub.playwright-mcp',
    'sciforge.tool.local.vision-sense',
    ...packageViewProviderIds,
  ],
});
const packageActionCandidate = packageGraph.candidates.find((candidate) => candidate.id === 'action.sciforge.computer-use');
const packageVerifierCandidate = packageGraph.candidates.find((candidate) => candidate.id === 'verifier.fixture.human-approval');
const runtimePayloadValidationCandidate = packageGraph.candidates.find((candidate) => candidate.id === 'sciforge.payload-validation');
const runtimeVerificationGateCandidate = packageGraph.candidates.find((candidate) => candidate.id === 'sciforge.runtime-verification-gate');
const packageSkillCandidate = packageGraph.candidates.find((candidate) => candidate.id === 'skill.pdf-extract');
const packageToolCandidate = packageGraph.candidates.find((candidate) => candidate.id === 'tool.clawhub.playwright-mcp');
assert.equal(packageActionCandidate?.kind, 'action');
assert.equal(packageVerifierCandidate?.kind, 'verifier');
assert.equal(runtimePayloadValidationCandidate?.kind, 'verifier');
assert.equal(runtimeVerificationGateCandidate?.kind, 'verifier');
assert.equal(packageSkillCandidate?.kind, 'skill');
assert.equal(packageToolCandidate?.kind, 'tool');
assert.ok(packageActionCandidate?.providerAvailability);
assert.ok(packageVerifierCandidate?.providerAvailability);
assert.ok(runtimePayloadValidationCandidate?.providerAvailability);
assert.ok(runtimeVerificationGateCandidate?.providerAvailability);
assert.ok(packageSkillCandidate?.providerAvailability);
assert.ok(packageToolCandidate?.providerAvailability);
assert.equal(packageActionCandidate?.providerAvailability?.[0]?.providerId, 'sciforge.computer-use');
assert.equal(packageVerifierCandidate?.providerAvailability?.[0]?.providerId, 'fixture.human-approval');
assert.equal(runtimePayloadValidationCandidate?.providerAvailability?.[0]?.providerId, 'sciforge.payload-validation');
assert.equal(runtimeVerificationGateCandidate?.providerAvailability?.[0]?.providerId, 'sciforge.runtime-verification-gate');
assert.equal(packageSkillCandidate?.providerAvailability?.[0]?.providerId, 'sciforge.skill.pdf-extract');
assert.equal(packageToolCandidate?.providerAvailability?.[0]?.providerId, 'sciforge.tool.clawhub.playwright-mcp');
assert.equal(packageActionCandidate?.budget?.maxActionSteps, 12);
assert.equal(packageVerifierCandidate?.budget?.exhaustedPolicy, 'needs-human');
assert.equal(runtimePayloadValidationCandidate?.budget?.exhaustedPolicy, 'fail-with-reason');
assert.equal(runtimeVerificationGateCandidate?.budget?.exhaustedPolicy, 'needs-human');
assert.equal(packageSkillCandidate?.budget?.maxToolCalls, 4);
assert.equal(packageToolCandidate?.budget?.maxProviders, 1);
for (const component of uiComponentManifests) {
  const packageViewCandidate = packageGraph.candidates.find((candidate) => candidate.id === `view.${component.componentId}`);
  assert.equal(packageViewCandidate?.kind, 'view');
  assert.ok(packageViewCandidate?.providerAvailability);
  assert.equal(packageViewCandidate?.providerAvailability?.[0]?.providerId, `sciforge.presentation.${component.componentId}`);
  assert.equal(packageViewCandidate?.budget?.maxResultItems, 1);
}

const brokerOutput = brokerCapabilities({
  prompt: 'Use desktop GUI computer use, use pdf extract for a PDF, calculate protein properties from a sequence, use playwright MCP browser automation, render a research-report in report-viewer, render a paper-list in paper-card-list, render a FASTA sequence in sequence-viewer, render a PDB structure in structure-viewer, render a knowledge graph in graph-viewer, then run payload validation and the runtime verification gate with human approval verification for the action trace.',
  artifactIndex: [
    { artifactType: 'research-report', ref: 'artifact:research-report:demo' },
    { artifactType: 'paper-list', ref: 'artifact:paper-list:demo' },
    { artifactType: 'sequence', ref: 'artifact:sequence:demo' },
    { artifactType: 'pdb-structure', ref: 'artifact:pdb-structure:demo' },
    { artifactType: 'graph', ref: 'artifact:graph:demo' },
  ],
  scenarioPolicy: {
    preferredCapabilityIds: [
      'action.sciforge.computer-use',
      'verifier.fixture.human-approval',
      'sciforge.payload-validation',
      'sciforge.runtime-verification-gate',
      'skill.pdf-extract',
      'skill.scp.protein-properties-calculation',
      'tool.clawhub.playwright-mcp',
      'view.report-viewer',
      'view.paper-card-list',
      'view.sequence-viewer',
      'view.structure-viewer',
      'view.graph-viewer',
    ],
  },
  runtimePolicy: {
    riskTolerance: 'high',
    topK: 14,
  },
  availableProviders: [
    'sciforge.computer-use',
    'fixture.human-approval',
    'sciforge.payload-validation',
    'sciforge.runtime-verification-gate',
    'sciforge.skill.pdf-extract',
    'sciforge.skill.scp.protein-properties-calculation',
    'sciforge.tool.clawhub.playwright-mcp',
    'sciforge.presentation.report-viewer',
    'sciforge.presentation.paper-card-list',
    'sciforge.presentation.sequence-viewer',
    'sciforge.presentation.structure-viewer',
    'sciforge.presentation.graph-viewer',
  ],
}, new CapabilityManifestRegistry(registry.manifests));
const brokerActionAudit = brokerOutput.audit.find((entry) => entry.id === 'action.sciforge.computer-use');
const brokerVerifierAudit = brokerOutput.audit.find((entry) => entry.id === 'verifier.fixture.human-approval');
const brokerPayloadValidationAudit = brokerOutput.audit.find((entry) => entry.id === 'sciforge.payload-validation');
const brokerRuntimeVerificationAudit = brokerOutput.audit.find((entry) => entry.id === 'sciforge.runtime-verification-gate');
const brokerPdfSkillAudit = brokerOutput.audit.find((entry) => entry.id === 'skill.pdf-extract');
const brokerPlaywrightToolAudit = brokerOutput.audit.find((entry) => entry.id === 'tool.clawhub.playwright-mcp');
assert.ok(brokerActionAudit, 'broker audit should see projected package action capability');
assert.ok(brokerVerifierAudit, 'broker audit should see projected package verifier capability');
assert.ok(brokerPayloadValidationAudit, 'broker audit should see runtime payload validation gate capability');
assert.ok(brokerRuntimeVerificationAudit, 'broker audit should see runtime verification gate capability');
assert.ok(brokerPdfSkillAudit, 'broker audit should see projected packages/skills capability');
assert.ok(brokerPlaywrightToolAudit, 'broker audit should see projected packages/skills/tool_skills capability');
for (const component of uiComponentManifests) {
  assert.ok(
    brokerOutput.audit.find((entry) => entry.id === `view.${component.componentId}`),
    `broker audit should see projected package ${component.componentId} presentation view capability`,
  );
}
const brokerBriefIds = new Set(brokerOutput.briefs.map((brief) => brief.id));
assert.ok(brokerBriefIds.has('action.sciforge.computer-use'));
assert.ok(brokerBriefIds.has('verifier.fixture.human-approval'));
assert.ok(brokerBriefIds.has('sciforge.payload-validation'));
assert.ok(brokerBriefIds.has('sciforge.runtime-verification-gate'));
assert.ok(brokerBriefIds.has('skill.pdf-extract'));
assert.ok(brokerBriefIds.has('skill.scp.protein-properties-calculation'));
assert.ok(brokerBriefIds.has('tool.clawhub.playwright-mcp'));
assert.ok(
  brokerBriefIds.has('view.graph-viewer'),
  'broker compact brief should include graph view when graph artifact and provider are present',
);
assert.ok(
  [...brokerBriefIds].some((id) => id.startsWith('view.')),
  'broker compact brief should include at least one package presentation view while full view breadth remains in audit',
);

const lazyAuditText = JSON.stringify({
  registryAudit: registry.compactAudit,
  packageGraphAudit: packageGraph.audit,
  brokerAudit: brokerOutput.audit,
});
assert.equal(lazyAuditText.includes('inputSchema'), false, 'registry/graph/broker audits must keep schemas lazy');
assert.equal(lazyAuditText.includes('outputSchema'), false, 'registry/graph/broker audits must keep schemas lazy');
assert.equal(lazyAuditText.includes('"examples"'), false, 'registry/graph/broker audits must keep examples lazy');
assert.equal(lazyAuditText.includes('"prompt"'), false, 'registry/graph/broker audits must not expand example prompts');

console.log('[ok] unified capability graph projects skill/tool/observe/action/verifier/view plus package action/verifier/presentation manifests into broker and harness audits');

function manifest(
  id: string,
  kind: CapabilityManifest['kind'],
  routingTags: string[],
  metadata: Record<string, unknown> = {},
): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id,
    name: id,
    version: '0.1.0',
    ownerPackage: 'test/package',
    kind,
    brief: `${id} test manifest`,
    routingTags,
    domains: ['test'],
    requiredCapabilities: [],
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    sideEffects: kind === 'action' ? ['workspace-write'] : ['none'],
    safety: { risk: kind === 'action' ? 'medium' : 'low', dataScopes: ['workspace'] },
    examples: [{ title: `${id} example` }],
    validators: [{ id: `${id}.schema`, kind: 'schema', expectedRefs: [] }],
    repairHints: [{ failureCode: 'contract-invalid', summary: 'repair', recoverActions: ['retry'] }],
    providers: [{
      id: `provider.${id}`,
      label: `${id} provider`,
      kind: 'package',
      requiredConfig: [],
    }],
    lifecycle: { status: 'validated', sourceRef: `test/${id}` },
    metadata,
  };
}
