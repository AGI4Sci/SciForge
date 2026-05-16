import assert from 'node:assert/strict';

import {
  loadCapabilityManifestRegistry,
  loadCoreCapabilityManifestRegistry,
} from '../../src/runtime/capability-manifest-registry.js';
import {
  CORE_CAPABILITY_MANIFESTS,
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
} from '../../packages/contracts/runtime/capability-manifest.js';
import { uiComponentManifests } from '../../packages/presentation/components/manifest-registry.js';
import { skillPackageManifests } from '../../packages/skills/index.js';
import { toolPackageManifests } from '../../packages/skills/tool_skills/index.js';

const coreRegistry = loadCoreCapabilityManifestRegistry();
for (const component of uiComponentManifests) {
  const capabilityId = `view.${component.componentId}`;
  const providerId = `sciforge.presentation.${component.componentId}`;
  const defaultView = coreRegistry.getManifest(capabilityId);
  assert.ok(defaultView, `default core registry should include the ${component.componentId} package view manifest`);
  assert.equal(defaultView.ownerPackage, component.packageName);
  assert.equal(defaultView.kind, 'view');
  assert.equal(coreRegistry.getManifestByProviderId(providerId)?.id, capabilityId);
  const defaultAudit = coreRegistry.compactAudit.entries.find((item) => item.id === capabilityId);
  assert.ok(defaultAudit, `${component.componentId} package view should appear in compact registry audit`);
  assert.equal(defaultAudit.source, 'core');
  assert.deepEqual(defaultAudit.providerAvailability, [{
    providerId,
    providerKind: 'package',
    available: true,
    requiredConfig: [],
  }]);
}
const defaultSequenceAudit = coreRegistry.compactAudit.entries.find((item) => item.id === 'view.sequence-viewer');
assert.equal(defaultSequenceAudit?.risk, 'medium');
const defaultStructureView = coreRegistry.getManifest('view.structure-viewer');
assert.deepEqual(defaultStructureView?.sideEffects, ['workspace-read', 'network']);
const defaultGraphView = coreRegistry.getManifest('view.graph-viewer');
assert.deepEqual(defaultGraphView?.sideEffects, ['none']);

const defaultPdfSkill = coreRegistry.getManifest('skill.pdf-extract');
const defaultWebSearch = coreRegistry.getManifest('web_search');
const defaultWebFetch = coreRegistry.getManifest('web_fetch');
const defaultVisionSkill = coreRegistry.getManifest('skill.vision-gui-task');
const defaultPlaywrightTool = coreRegistry.getManifest('tool.clawhub.playwright-mcp');
const defaultVisionSenseTool = coreRegistry.getManifest('tool.local.vision-sense');
assert.ok(defaultPdfSkill, 'default registry should include compact packages/skills metadata');
assert.equal(defaultWebSearch?.ownerPackage, 'packages/observe/web');
assert.equal(defaultWebSearch?.kind, 'observe');
assert.equal(defaultWebFetch?.ownerPackage, 'packages/observe/web');
assert.ok(defaultVisionSkill, 'default registry should include local compact packages/skills metadata');
assert.ok(defaultPlaywrightTool, 'default registry should include compact packages/skills/tool_skills connector metadata');
assert.ok(defaultVisionSenseTool, 'default registry should include compact packages/skills/tool_skills sense-plugin metadata');
assert.equal(defaultPdfSkill.ownerPackage, '@sciforge-skill/pdf-extract');
assert.equal(defaultPlaywrightTool.metadata?.harnessKind, 'tool');
assert.equal(defaultVisionSenseTool.metadata?.harnessKind, 'tool');
assert.equal(coreRegistry.getManifestByProviderId('sciforge.skill.pdf-extract')?.id, 'skill.pdf-extract');
assert.equal(coreRegistry.getManifestByProviderId('sciforge.tool.clawhub.playwright-mcp')?.id, 'tool.clawhub.playwright-mcp');
assert.equal(coreRegistry.getManifestByProviderId('sciforge.tool.local.vision-sense')?.id, 'tool.local.vision-sense');
assert.ok(
  coreRegistry.manifestIds.length >= CORE_CAPABILITY_MANIFESTS.length + skillPackageManifests.length + toolPackageManifests.length,
  'default registry should project real skill and tool skill package catalogs',
);
for (const id of ['skill.pdf-extract', 'tool.clawhub.playwright-mcp', 'tool.local.vision-sense']) {
  const defaultAudit = coreRegistry.compactAudit.entries.find((item) => item.id === id);
  assert.ok(defaultAudit, `${id} should appear in compact registry audit`);
  assert.equal(defaultAudit.source, 'core');
  assert.equal(defaultAudit.providerAvailability.length, 1);
}

const packageManifest = discoveredPackageManifest();
const registry = loadCapabilityManifestRegistry({
  packageDiscovery: {
    providerAvailability: [{
      id: 'sciforge.pkg.literature.enrich.remote',
      available: false,
      reason: 'missing SCIFORGE_LITERATURE_API_KEY',
    }],
    packages: [{
      packageName: '@sciforge/pkg-literature-enrich',
      packageRoot: 'packages/skills/literature-enrich',
      manifests: [packageManifest],
      providerAvailability: ['sciforge.pkg.literature.enrich.local'],
    }],
  },
});

assert.equal(registry.manifestIds.length, coreRegistry.manifestIds.length + 1);
assert.equal(registry.getManifest('literature.metadata-enrich')?.ownerPackage, '@sciforge/pkg-literature-enrich');
assert.equal(registry.getManifestByProviderId('sciforge.pkg.literature.enrich.remote')?.id, 'literature.metadata-enrich');
assert.ok(registry.listBriefs({ domain: 'literature' }).some((brief) => brief.id === 'literature.metadata-enrich'));

const audit = registry.compactAudit;
const entry = audit.entries.find((item) => item.id === 'literature.metadata-enrich');
assert.ok(entry, 'package-discovered manifest should be present in compact registry audit');
assert.equal(audit.contract, 'sciforge.capability-manifest-registry-audit.v1');
assert.equal(audit.sourceCounts.core, coreRegistry.compactAudit.sourceCounts.core);
assert.equal(audit.sourceCounts.packageDiscovery, 3);
assert.equal(entry.source, 'package-discovery');
assert.equal(entry.packageName, '@sciforge/pkg-literature-enrich');
assert.equal(entry.packageRoot, 'packages/skills/literature-enrich');
assert.deepEqual(entry.sideEffects, ['network', 'external-api']);
assert.equal(entry.risk, 'high');
assert.equal(entry.requiresHumanApproval, true);
assert.deepEqual(entry.requiredConfig, ['SCIFORGE_LITERATURE_API_KEY']);
assert.deepEqual(entry.validatorIds, ['literature.metadata-enrich.schema', 'literature.metadata-enrich.smoke']);
assert.deepEqual(entry.validatorKinds, ['schema', 'smoke']);
assert.deepEqual(entry.repairFailureCodes, ['provider-auth-missing', 'metadata-mismatch']);
assert.deepEqual(entry.repairRecoverActions, ['fallback-local-enrichment', 'request-api-key', 'rerun-metadata-validator']);

const remoteProvider = entry.providerAvailability.find((provider) => provider.providerId === 'sciforge.pkg.literature.enrich.remote');
const localProvider = entry.providerAvailability.find((provider) => provider.providerId === 'sciforge.pkg.literature.enrich.local');
assert.deepEqual(remoteProvider, {
  providerId: 'sciforge.pkg.literature.enrich.remote',
  providerKind: 'package',
  available: false,
  reason: 'missing SCIFORGE_LITERATURE_API_KEY',
  requiredConfig: ['SCIFORGE_LITERATURE_API_KEY'],
});
assert.deepEqual(localProvider, {
  providerId: 'sciforge.pkg.literature.enrich.local',
  providerKind: 'package',
  available: true,
  requiredConfig: [],
});

const auditText = JSON.stringify(audit);
assert.equal(auditText.includes('inputSchema'), false, 'compact audit must keep schemas lazy');
assert.equal(auditText.includes('outputSchema'), false, 'compact audit must keep schemas lazy');
assert.equal(auditText.includes('"examples"'), false, 'compact audit must keep examples lazy');
assert.equal(auditText.includes('examplePrompts'), false, 'compact audit must not expand package skill generated catalog prompts');
assert.equal(auditText.includes('mcpArgs'), false, 'compact audit must not expand package tool generated catalog details');

assert.throws(
  () =>
    loadCapabilityManifestRegistry({
      packageDiscovery: {
        packages: [{
          packageName: '@sciforge/duplicate-runtime',
          manifests: [{ ...packageManifest, id: 'runtime.artifact-read' }],
        }],
      },
    }),
  /duplicate manifest id/,
);

console.log('[ok] capability manifest registry merges package discovery into compact provider audit');

function discoveredPackageManifest(): CapabilityManifest {
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: 'literature.metadata-enrich',
    name: 'literature metadata enrich',
    version: '0.1.0',
    ownerPackage: '@sciforge/pkg-literature-enrich',
    kind: 'skill',
    brief: 'Enrich literature metadata with package-provided provider diagnostics.',
    routingTags: ['literature', 'metadata', 'enrich'],
    domains: ['literature', 'research'],
    requiredCapabilities: ['web_search'],
    inputSchema: { type: 'object', required: ['paperRefs'] },
    outputSchema: { type: 'object', required: ['enrichedPaperRefs'] },
    sideEffects: ['network', 'external-api'],
    safety: {
      risk: 'high',
      dataScopes: ['public-web', 'workspace-refs'],
      requiresHumanApproval: true,
    },
    examples: [{
      title: 'enrich paper refs',
      inputRef: 'capability:literature.metadata-enrich/input.example',
      outputRef: 'capability:literature.metadata-enrich/output.example',
    }],
    validators: [
      {
        id: 'literature.metadata-enrich.schema',
        kind: 'schema',
        contractRef: 'literature.metadata-enrich#outputSchema',
        expectedRefs: ['enrichedPaperRefs'],
      },
      {
        id: 'literature.metadata-enrich.smoke',
        kind: 'smoke',
        command: 'npm run smoke:literature-metadata-enrich',
      },
    ],
    repairHints: [
      {
        failureCode: 'provider-auth-missing',
        summary: 'Request package provider credentials or route to the local fallback provider.',
        recoverActions: ['request-api-key', 'fallback-local-enrichment'],
      },
      {
        failureCode: 'metadata-mismatch',
        summary: 'Rerun metadata validator before accepting enriched refs.',
        recoverActions: ['rerun-metadata-validator'],
      },
    ],
    providers: [
      {
        id: 'sciforge.pkg.literature.enrich.remote',
        label: 'remote enrich provider',
        kind: 'package',
        contractRef: 'packages/skills/literature-enrich/providers/remote',
        requiredConfig: ['SCIFORGE_LITERATURE_API_KEY'],
        priority: 1,
      },
      {
        id: 'sciforge.pkg.literature.enrich.local',
        label: 'local enrich provider',
        kind: 'package',
        contractRef: 'packages/skills/literature-enrich/providers/local',
        requiredConfig: [],
        priority: 2,
      },
    ],
    lifecycle: {
      status: 'validated',
      sourceRef: 'packages/skills/literature-enrich/capability.manifest.json',
    },
  };
}
