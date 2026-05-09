import { skillPackageManifests } from '../../skills';
import { toolPackageManifests } from '../../skills/tool_skills';
import type { ScenarioId } from './contracts';
import type { SkillDomain } from './scenarioSpecs';
import { SCENARIO_SPECS } from './scenarioSpecs';
import { uiComponentElements } from './componentElements';
import type {
  ArtifactSchemaElement,
  CapabilityRequirement,
  ElementRegistry,
  FailurePolicyElement,
  RegistryValidationIssue,
  RegistryValidationReport,
  RolePolicyElement,
  SkillElement,
  ToolElement,
  ViewPresetElement,
} from './elementTypes';

export function buildElementRegistry(): ElementRegistry {
  const skills = [
    ...skillPackageManifests.map(skillPackageToElement),
    ...buildGeneratedCapabilitySkills(),
  ];
  const artifacts = buildArtifactElements(skills);
  return {
    skills,
    tools: buildToolElements(),
    artifacts,
    components: uiComponentElements,
    viewPresets: buildViewPresets(),
    rolePolicies: buildRolePolicies(),
    failurePolicies: buildFailurePolicies(),
  };
}

function buildGeneratedCapabilitySkills(): SkillElement[] {
  return (['literature', 'structure', 'omics', 'knowledge'] as SkillDomain[]).map((domain) => {
    const scenarioId = scenarioIdForDomain(domain);
    const baseArtifacts = SCENARIO_SPECS[scenarioId].outputArtifacts.map((artifact) => artifact.type);
    return {
      id: `agentserver.generate.${domain}`,
      kind: 'skill',
      version: '1.0.0',
      label: `Agent backend ${domain} generator`,
      description: `Use the configured AgentServer/native backend to synthesize a task plan, tool calls, artifacts, and report outputs for open-ended ${domain} scenarios.`,
      source: 'generated',
      skillDomains: [domain],
      inputContract: {
        prompt: 'Natural-language scenario or task request compiled into a stable package contract.',
      },
      outputArtifactTypes: unique([...baseArtifacts, 'research-report', 'runtime-artifact']),
      entrypointType: 'agentserver-generation',
      requiredCapabilities: [
        { capability: 'agentserver-generation', level: 'self-healing' },
        { capability: 'code-generation', level: 'self-healing' },
        { capability: 'artifact-emission', level: 'schema-checked' },
      ],
      failureModes: ['backend-unavailable', 'schema-mismatch', 'runtime-error'],
      examplePrompts: [
        'Generate a reusable research scenario from this description',
        '搜索、下载、阅读并总结最新论文为报告',
        'Build a stable workspace package for this analysis workflow',
      ],
      tags: ['agent-backend', 'native-tools', 'generated-capability', domain],
    };
  });
}

export const elementRegistry = buildElementRegistry();

export function validateElementRegistry(registry: ElementRegistry = elementRegistry): RegistryValidationReport {
  const issues: RegistryValidationIssue[] = [];
  const allIds = [
    ...registry.skills.map((item) => item.id),
    ...registry.tools.map((item) => item.id),
    ...registry.artifacts.map((item) => item.id),
    ...registry.components.map((item) => item.id),
    ...registry.viewPresets.map((item) => item.id),
    ...registry.rolePolicies.map((item) => item.id),
    ...registry.failurePolicies.map((item) => item.id),
  ];
  const seen = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) issues.push({ severity: 'error', code: 'duplicate-id', message: `Duplicate element id: ${id}`, elementId: id });
    seen.add(id);
  }

  const componentIds = new Set(registry.components.map((item) => item.componentId));
  const artifactTypes = new Set(registry.artifacts.map((item) => item.artifactType));
  const skillIds = new Set(registry.skills.map((item) => item.id));

  for (const component of registry.components) {
    if (!component.emptyState.title.trim() || !component.emptyState.detail.trim()) {
      issues.push({ severity: 'error', code: 'missing-component-empty-state', message: `${component.componentId} must define emptyState title/detail`, elementId: component.id });
    }
    if (!component.recoverActions.length) {
      issues.push({ severity: 'error', code: 'missing-component-recover-actions', message: `${component.componentId} must define at least one recover action`, elementId: component.id });
    }
    if (component.fallback && !componentIds.has(component.fallback)) {
      issues.push({ severity: 'error', code: 'missing-component-fallback', message: `${component.componentId} fallback is missing: ${component.fallback}`, elementId: component.id });
    }
    for (const artifactType of component.acceptsArtifactTypes) {
      if (artifactType !== '*' && !artifactTypes.has(artifactType)) {
        issues.push({ severity: 'warning', code: 'component-accepts-unregistered-artifact', message: `${component.componentId} accepts unregistered artifact type: ${artifactType}`, elementId: component.id });
      }
    }
  }

  for (const artifact of registry.artifacts) {
    for (const skillId of artifact.producerSkillIds) {
      if (!skillIds.has(skillId)) {
        issues.push({ severity: 'error', code: 'missing-artifact-producer', message: `${artifact.artifactType} producer is missing: ${skillId}`, elementId: artifact.id });
      }
    }
    for (const componentId of artifact.consumerComponentIds) {
      if (!componentIds.has(componentId)) {
        issues.push({ severity: 'error', code: 'missing-artifact-consumer', message: `${artifact.artifactType} consumer is missing: ${componentId}`, elementId: artifact.id });
      }
    }
    if (!artifact.consumerComponentIds.includes('unknown-artifact-inspector')) {
      issues.push({ severity: 'error', code: 'missing-inspector-fallback', message: `${artifact.artifactType} must be consumable by unknown-artifact-inspector`, elementId: artifact.id });
    }
  }

  return {
    ok: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}

function buildArtifactElements(skills: SkillElement[]): ArtifactSchemaElement[] {
  const byType = new Map<string, ArtifactSchemaElement>();
  for (const [scenarioId, spec] of Object.entries(SCENARIO_SPECS) as Array<[ScenarioId, typeof SCENARIO_SPECS[ScenarioId]]>) {
    for (const artifact of spec.outputArtifacts) {
      const consumerComponentIds = uiComponentElements
        .filter((component) => component.acceptsArtifactTypes.includes(artifact.type) || component.acceptsArtifactTypes.includes('*'))
        .map((component) => component.componentId);
      byType.set(artifact.type, {
        id: `artifact.${artifact.type}`,
        kind: 'artifact-schema',
        version: '1.0.0',
        label: artifact.type,
        description: artifact.description,
        source: 'built-in',
        artifactType: artifact.type,
        fields: artifact.fields,
        producerSkillIds: skills.filter((skill) => skill.outputArtifactTypes.includes(artifact.type)).map((skill) => skill.id),
        consumerComponentIds,
        handoffTargets: artifact.consumers,
        tags: [scenarioId, spec.skillDomain],
      });
    }
  }

  for (const skill of skills) {
    for (const artifactType of skill.outputArtifactTypes) {
      const existing = byType.get(artifactType);
      if (existing) {
        if (!existing.producerSkillIds.includes(skill.id)) existing.producerSkillIds.push(skill.id);
        for (const domain of skill.skillDomains) {
          if (!existing.tags?.includes(domain)) existing.tags = [...existing.tags ?? [], domain];
        }
        continue;
      }
      const consumerComponentIds = uiComponentElements
        .filter((component) => component.acceptsArtifactTypes.includes(artifactType) || component.acceptsArtifactTypes.includes('*'))
        .map((component) => component.componentId);
      byType.set(artifactType, {
        id: `artifact.${artifactType}`,
        kind: 'artifact-schema',
        version: '1.0.0',
        label: artifactType,
        description: `Artifact schema inferred from ${skill.id}.`,
        source: skill.source,
        artifactType,
        fields: [],
        producerSkillIds: [skill.id],
        consumerComponentIds,
        handoffTargets: [],
        tags: skill.skillDomains,
      });
    }
  }

  return Array.from(byType.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function buildToolElements(): ToolElement[] {
  return toolPackageManifests.map((manifest) => ({
    id: manifest.id,
    kind: 'tool' as const,
    version: manifest.version,
    label: manifest.label,
    description: manifest.description,
    source: manifest.source,
    toolType: manifest.toolType as ToolElement['toolType'],
    skillDomains: manifest.skillDomains as SkillDomain[],
    producesArtifactTypes: manifest.producesArtifactTypes ?? [],
    requiredConfig: manifest.requiredConfig as string[] | undefined,
    tags: ['package', manifest.packageName],
  })).sort((left, right) => left.id.localeCompare(right.id));
}

function buildViewPresets(): ViewPresetElement[] {
  return (Object.entries(SCENARIO_SPECS) as Array<[ScenarioId, typeof SCENARIO_SPECS[ScenarioId]]>).map(([scenarioId, spec]) => ({
    id: `view-preset.${scenarioId}.default`,
    kind: 'view-preset',
    version: '1.0.0',
    label: `${spec.title} default UI`,
    description: `Default compiled UI slots for ${spec.title}.`,
    source: 'built-in',
    componentIds: spec.defaultSlots.map((slot) => slot.componentId),
    artifactTypes: spec.outputArtifacts.map((artifact) => artifact.type),
    slots: spec.defaultSlots,
    tags: [scenarioId, spec.skillDomain],
  }));
}

function buildRolePolicies(): RolePolicyElement[] {
  return [
    {
      id: 'role.experimental-biologist',
      kind: 'role-policy',
      version: '1.0.0',
      label: 'Experimental biologist',
      description: 'Prioritizes biological meaning, evidence, structures, protocols, and next experiments.',
      source: 'built-in',
      roleId: 'experimental-biologist',
      defaultVisibleComponents: ['paper-card-list', 'molecule-viewer', 'network-graph', 'evidence-matrix', 'notebook-timeline'],
      preferredViewParams: ['highlightSelection', 'colorBy'],
    },
    {
      id: 'role.bioinformatician',
      kind: 'role-policy',
      version: '1.0.0',
      label: 'Bioinformatician',
      description: 'Prioritizes parameters, execution units, tables, and reproducible code refs.',
      source: 'built-in',
      roleId: 'bioinformatician',
      defaultVisibleComponents: ['volcano-plot', 'heatmap-viewer', 'umap-viewer', 'data-table', 'execution-unit-table'],
      preferredViewParams: ['filter', 'sort', 'splitBy'],
    },
    {
      id: 'role.pi',
      kind: 'role-policy',
      version: '1.0.0',
      label: 'PI',
      description: 'Prioritizes confidence, evidence, progress, and decision-ready summaries.',
      source: 'built-in',
      roleId: 'pi',
      defaultVisibleComponents: ['evidence-matrix', 'notebook-timeline', 'execution-unit-table', 'data-table'],
      preferredViewParams: ['limit', 'sort'],
    },
  ];
}

function buildFailurePolicies(): FailurePolicyElement[] {
  return [
    {
      id: 'failure.missing-input',
      kind: 'failure-policy',
      version: '1.0.0',
      label: 'Missing required input',
      description: 'Required input files or parameters are absent.',
      source: 'built-in',
      failureMode: 'missing-input',
      recoverActions: ['upload-file', 'edit-input-contract', 'rerun'],
      fallbackComponentId: 'unknown-artifact-inspector',
    },
    {
      id: 'failure.schema-mismatch',
      kind: 'failure-policy',
      version: '1.0.0',
      label: 'Schema mismatch',
      description: 'Runtime output does not match the published artifact schema.',
      source: 'built-in',
      failureMode: 'schema-mismatch',
      recoverActions: ['inspect-output', 'repair-task', 'edit-ui-plan'],
      fallbackComponentId: 'unknown-artifact-inspector',
    },
    {
      id: 'failure.backend-unavailable',
      kind: 'failure-policy',
      version: '1.0.0',
      label: 'Backend unavailable',
      description: 'The selected runtime, connector, or AgentServer backend is unavailable.',
      source: 'built-in',
      failureMode: 'backend-unavailable',
      recoverActions: ['start-backend', 'select-fallback-runtime', 'save-draft'],
      fallbackComponentId: 'unknown-artifact-inspector',
    },
  ];
}

function skillPackageToElement(manifest: typeof skillPackageManifests[number]): SkillElement {
  return {
    id: manifest.id,
    kind: 'skill',
    version: manifest.version,
    label: manifest.label,
    description: manifest.description,
    source: manifest.source,
    skillDomains: manifest.skillDomains as SkillDomain[],
    inputContract: manifest.inputContract as Record<string, unknown>,
    outputArtifactTypes: manifest.outputArtifactTypes,
    entrypointType: manifest.entrypointType as SkillElement['entrypointType'],
    requiredCapabilities: manifest.requiredCapabilities as CapabilityRequirement[],
    failureModes: manifest.failureModes as string[],
    examplePrompts: manifest.examplePrompts as string[],
    manifestPath: manifest.docs.readmePath,
    tags: ['package', manifest.packageName, ...(manifest.tags as string[] | undefined ?? [])],
  };
}

function safeElementId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

function scenarioIdForDomain(domain: SkillDomain): ScenarioId {
  if (domain === 'structure') return 'structure-exploration';
  if (domain === 'omics') return 'omics-differential-exploration';
  if (domain === 'knowledge') return 'biomedical-knowledge-graph';
  return 'literature-evidence-review';
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
