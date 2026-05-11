import {
  CAPABILITY_MANIFEST_CONTRACT_ID,
  type CapabilityManifest,
  type CapabilityManifestRisk,
  type CapabilityManifestSideEffect,
} from '../../packages/contracts/runtime/capability-manifest.js';
import {
  compactSkillCapabilityRoutingTags,
  skillPackageRequiredConfig,
  skillPackageRepairActions,
  toolPackageOutputArtifactTypes,
  toolPackageUnavailableRepairHints,
} from '../../packages/skills/capability-projection-policy.js';
import { skillPackageManifests, type SkillPackageManifest } from '../../packages/skills';
import { toolPackageManifests, type ToolPackageManifest } from '../../packages/skills/tool_skills';

export function skillAndToolPackageCapabilityManifests(): CapabilityManifest[] {
  return [
    ...skillPackageManifests.map(projectSkillPackageManifestToCapabilityManifest),
    ...toolPackageManifests.map(projectToolPackageManifestToCapabilityManifest),
  ];
}

function projectSkillPackageManifestToCapabilityManifest(skill: SkillPackageManifest): CapabilityManifest {
  const capabilityId = `skill.${skill.id}`;
  const providerId = `sciforge.skill.${skill.id}`;
  const docsRef = skill.docs.readmePath || `${skill.packageRoot}/SKILL.md`;
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: capabilityId,
    name: skill.label,
    version: skill.version,
    ownerPackage: skill.packageName,
    kind: 'skill',
    brief: skill.docs.agentSummary || skill.description,
    routingTags: uniqueSortedStrings([
      skill.id,
      skill.label,
      skill.entrypointType,
      ...skill.id.split(/[._-]/),
      ...skill.skillDomains,
      ...compactSkillCapabilityRoutingTags(skill.tags),
    ]),
    domains: uniqueSortedStrings([...skill.skillDomains]),
    inputSchema: {
      type: 'object',
      required: ['promptRef'],
      properties: {
        promptRef: { type: 'string' },
        skillMarkdownRef: { const: docsRef },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['artifactRefs'],
      properties: {
        artifactRefs: { type: 'array', items: { type: 'string' } },
        artifactTypes: { type: 'array', items: { enum: skill.outputArtifactTypes } },
      },
    },
    sideEffects: ['none'],
    safety: {
      risk: 'low',
      dataScopes: ['workspace-refs'],
    },
    examples: [{
      title: `${skill.label} package skill`,
      inputRef: `capability:${capabilityId}/input.example`,
      outputRef: `capability:${capabilityId}/output.example`,
    }],
    validators: [{
      id: `${capabilityId}.artifact-contract`,
      kind: 'schema',
      contractRef: `${skill.packageRoot}#SkillPackageManifest`,
      expectedRefs: ['artifactRefs'],
    }],
    repairHints: skill.failureModes.map((failureCode) => ({
      failureCode,
      summary: `Recover from ${failureCode} without expanding the package SKILL.md body.`,
      recoverActions: skillPackageRepairActions(failureCode),
    })),
    providers: [{
      id: providerId,
      label: skill.label,
      kind: skill.source === 'workspace' ? 'workspace' : 'package',
      contractRef: docsRef,
      requiredConfig: skillPackageRequiredConfig(skill),
      priority: skill.source === 'package' ? 1 : 2,
    }],
    lifecycle: {
      status: 'validated',
      sourceRef: docsRef,
    },
    metadata: {
      sourceSchemaVersion: 'sciforge.skill-package-manifest.v1',
      sourceSkillId: skill.id,
      sourceKind: skill.source,
      packageRoot: skill.packageRoot,
      docsRef,
      outputArtifactTypes: [...skill.outputArtifactTypes],
      requiredCapabilities: skill.requiredCapabilities.map((capability) => ({ ...capability })),
      ...(skill.scpToolId ? { scpToolId: skill.scpToolId } : {}),
      ...(skill.scpHubUrl ? { scpHubUrl: skill.scpHubUrl } : {}),
      budget: {
        maxToolCalls: 4,
        maxRetries: 1,
        exhaustedPolicy: 'partial-payload',
      },
    },
  };
}

function projectToolPackageManifestToCapabilityManifest(tool: ToolPackageManifest): CapabilityManifest {
  const capabilityId = `tool.${tool.id}`;
  const providerId = `sciforge.tool.${tool.id}`;
  const docsRef = tool.docs.readmePath || `${tool.packageRoot}/SKILL.md`;
  return {
    contract: CAPABILITY_MANIFEST_CONTRACT_ID,
    id: capabilityId,
    name: tool.label,
    version: tool.version,
    ownerPackage: tool.packageName,
    kind: 'runtime-adapter',
    brief: tool.docs.agentSummary || tool.description,
    routingTags: uniqueSortedStrings([
      tool.id,
      tool.label,
      tool.toolType,
      tool.provider ?? '',
      tool.sensePlugin?.modality ?? '',
      ...tool.id.split(/[._-]/),
      ...tool.skillDomains,
      ...compactSkillCapabilityRoutingTags(tool.tags),
      ...(tool.sensePlugin?.inputContract.acceptedModalities ?? []),
    ]),
    domains: uniqueSortedStrings([...tool.skillDomains, tool.toolType]),
    inputSchema: {
      type: 'object',
      required: ['inputRef'],
      properties: {
        inputRef: { type: 'string' },
        toolSkillMarkdownRef: { const: docsRef },
      },
    },
    outputSchema: {
      type: 'object',
      required: ['outputRef'],
      properties: {
        outputRef: { type: 'string' },
        artifactTypes: { type: 'array', items: { enum: toolPackageOutputArtifactTypes(tool) } },
      },
    },
    sideEffects: toolSideEffects(tool),
    safety: {
      risk: toolRisk(tool),
      dataScopes: toolDataScopes(tool),
    },
    examples: [{
      title: `${tool.label} package tool skill`,
      inputRef: `capability:${capabilityId}/input.example`,
      outputRef: `capability:${capabilityId}/output.example`,
    }],
    validators: [{
      id: `${capabilityId}.tool-contract`,
      kind: 'schema',
      contractRef: `${tool.packageRoot}#ToolPackageManifest`,
      expectedRefs: ['outputRef'],
    }],
    repairHints: toolPackageUnavailableRepairHints(),
    providers: [{
      id: providerId,
      label: tool.label,
      kind: tool.source === 'workspace' ? 'workspace' : 'package',
      contractRef: docsRef,
      requiredConfig: [...(tool.requiredConfig ?? [])],
      priority: tool.provider === 'local' ? 1 : 2,
    }],
    lifecycle: {
      status: 'validated',
      sourceRef: docsRef,
    },
    metadata: {
      sourceSchemaVersion: 'sciforge.tool-package-manifest.v1',
      sourceToolId: tool.id,
      sourceKind: tool.source,
      toolType: tool.toolType,
      provider: tool.provider,
      packageRoot: tool.packageRoot,
      docsRef,
      sourceUrl: tool.sourceUrl,
      mcpCommand: tool.mcpCommand,
      mcpArgs: tool.mcpArgs ? [...tool.mcpArgs] : undefined,
      sensePluginId: tool.sensePlugin?.id,
      harnessKind: 'tool',
      outputArtifactTypes: [...(tool.producesArtifactTypes ?? [])],
      budget: {
        maxToolCalls: tool.toolType === 'sense-plugin' ? 1 : 4,
        maxProviders: 1,
        maxRetries: 1,
        exhaustedPolicy: 'partial-payload',
      },
    },
  };
}

function toolSideEffects(tool: ToolPackageManifest): CapabilityManifestSideEffect[] {
  if (tool.toolType === 'sense-plugin') return ['workspace-read'];
  if (tool.toolType === 'runner' || tool.toolType === 'visual-runtime') return ['workspace-write'];
  if (tool.toolType === 'connector' || tool.toolType === 'database' || tool.toolType === 'llm-backend') return ['network', 'external-api'];
  return ['none'];
}

function toolRisk(tool: ToolPackageManifest): CapabilityManifestRisk {
  if (tool.sensePlugin?.safety.defaultRiskLevel) return tool.sensePlugin.safety.defaultRiskLevel;
  if (tool.toolType === 'runner' || tool.toolType === 'visual-runtime') return 'medium';
  if (tool.requiredConfig?.length || tool.toolType === 'connector' || tool.toolType === 'llm-backend') return 'medium';
  return 'low';
}

function toolDataScopes(tool: ToolPackageManifest): string[] {
  return uniqueSortedStrings([
    'workspace-refs',
    ...(tool.toolType === 'sense-plugin' ? ['screenshots', ...(tool.sensePlugin?.inputContract.acceptedModalities ?? [])] : []),
    ...(tool.toolType === 'connector' || tool.toolType === 'database' || tool.toolType === 'llm-backend' ? ['external-service'] : []),
  ]);
}

function uniqueSortedStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))].sort((left, right) => left.localeCompare(right));
}
