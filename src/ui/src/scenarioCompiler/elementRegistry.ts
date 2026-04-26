import inspectorSkill from '../../../../skills/seed/inspector.generic_file_table_log/skill.json';
import knowledgeSkill from '../../../../skills/seed/knowledge.uniprot_chembl_lookup/skill.json';
import literatureSkill from '../../../../skills/seed/literature.pubmed_search/skill.json';
import literatureWebSearchSkill from '../../../../skills/seed/literature.web_search/skill.json';
import omicsSkill from '../../../../skills/seed/omics.differential_expression/skill.json';
import blastpSkill from '../../../../skills/seed/sequence.ncbi_blastp_search/skill.json';
import structureSkill from '../../../../skills/seed/structure.rcsb_latest_or_entry/skill.json';
import type { ScenarioId } from '../data';
import type { SkillDomain } from '../scenarioSpecs';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { scpMarkdownSkills, type ScpMarkdownSkill } from '../scpSkillCatalog';
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

const seedSkillManifests = [
  inspectorSkill,
  knowledgeSkill,
  literatureSkill,
  literatureWebSearchSkill,
  omicsSkill,
  blastpSkill,
  structureSkill,
] as const;

export function buildElementRegistry(): ElementRegistry {
  const skills = [
    ...seedSkillManifests.map(seedSkillToElement),
    ...buildGeneratedCapabilitySkills(),
    ...scpMarkdownSkills.map(scpSkillToElement),
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
  const toolNames = new Map<string, { domains: Set<SkillDomain>; artifactTypes: Set<string> }>();
  for (const spec of Object.values(SCENARIO_SPECS)) {
    for (const name of [...spec.nativeTools, ...spec.fallbackTools]) {
      const current = toolNames.get(name) ?? { domains: new Set<SkillDomain>(), artifactTypes: new Set<string>() };
      current.domains.add(spec.skillDomain);
      spec.outputArtifacts.forEach((artifact) => current.artifactTypes.add(artifact.type));
      toolNames.set(name, current);
    }
  }
  return Array.from(toolNames.entries()).map(([name, value]) => ({
    id: `tool.${safeElementId(name)}`,
    kind: 'tool' as const,
    version: '1.0.0',
    label: name,
    description: `${name} tool or connector available to BioAgent scenarios.`,
    source: 'built-in' as const,
    toolType: toolTypeForName(name),
    skillDomains: Array.from(value.domains),
    producesArtifactTypes: Array.from(value.artifactTypes),
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

function seedSkillToElement(manifest: typeof seedSkillManifests[number]): SkillElement {
  const outputType = typeof manifest.outputArtifactSchema.type === 'string' ? manifest.outputArtifactSchema.type : 'unknown-artifact';
  const entrypointType = manifest.entrypoint.type as SkillElement['entrypointType'];
  return {
    id: manifest.id,
    kind: 'skill',
    version: '1.0.0',
    label: manifest.id,
    description: manifest.description,
    source: 'seed-skill',
    skillDomains: manifest.skillDomains as SkillDomain[],
    inputContract: manifest.inputContract,
    outputArtifactTypes: [outputType],
    entrypointType,
    requiredCapabilities: capabilitiesForSeedSkill(manifest),
    failureModes: failureModesForSkill(manifest),
    examplePrompts: manifest.examplePrompts,
    manifestPath: `skills/seed/${manifest.id}/skill.json`,
    tags: [manifest.kind, manifest.entrypoint.type, ...manifest.skillDomains],
  };
}

function scpSkillToElement(skill: ScpMarkdownSkill): SkillElement {
  const skillDomains = inferSkillDomains(`${skill.name} ${skill.description}`);
  return {
    id: `scp.${skill.id}`,
    kind: 'skill',
    version: '1.0.0',
    label: skill.name,
    description: skill.description,
    source: 'scp-skill',
    skillDomains,
    inputContract: { prompt: 'Free-text request matched against SCP skill description and SKILL.md.' },
    outputArtifactTypes: inferArtifactTypes(skill.description, skillDomains),
    entrypointType: 'markdown-skill',
    requiredCapabilities: [
      { capability: 'external-tool', level: 'external-tool' },
      { capability: 'agentserver-generation', level: 'self-healing' },
      { capability: 'artifact-emission', level: 'schema-checked' },
    ],
    failureModes: ['backend-unavailable', 'missing-input', 'schema-mismatch'],
    examplePrompts: [skill.name, skill.description.slice(0, 120)].filter(Boolean),
    manifestPath: skill.path,
    tags: ['scp', ...skillDomains],
  };
}

function capabilitiesForSeedSkill(manifest: typeof seedSkillManifests[number]): CapabilityRequirement[] {
  if (manifest.entrypoint.type === 'inspector') {
    return [
      { capability: 'artifact-inspection', level: 'deterministic' },
      { capability: 'ui-fallback', level: 'schema-checked' },
    ];
  }
  const environment = manifest.environment as Record<string, unknown>;
  const network = Array.isArray(environment.network) && environment.network.length > 0;
  return [
    { capability: 'workspace-task', level: 'deterministic' },
    { capability: 'artifact-emission', level: 'schema-checked' },
    ...(network ? [{ capability: 'http-fetch', level: 'basic' } as const] : []),
  ];
}

function failureModesForSkill(manifest: typeof seedSkillManifests[number]) {
  const modes = ['schema-mismatch'];
  if (manifest.entrypoint.type === 'workspace-task') modes.push('runtime-error');
  const environment = manifest.environment as Record<string, unknown>;
  const validationSmoke = manifest.validationSmoke as Record<string, unknown>;
  if (Array.isArray(environment.network) && environment.network.length > 0) modes.push('network-unavailable');
  if (String(validationSmoke.expectedPromptPattern || '').includes('matrixRef')) modes.push('missing-input');
  return modes;
}

function inferSkillDomains(text: string): SkillDomain[] {
  const normalized = text.toLowerCase();
  const domains = new Set<SkillDomain>();
  if (/paper|pubmed|literature|clinical trial|evidence|文献|论文/.test(normalized)) domains.add('literature');
  if (/structure|protein|pdb|alphafold|binding|pocket|ligand|结构|蛋白/.test(normalized)) domains.add('structure');
  if (/omics|rna|gene expression|single-cell|scrna|deseq|scanpy|biomarker|组学|表达/.test(normalized)) domains.add('omics');
  if (/drug|compound|disease|target|uniprot|chembl|pathway|knowledge|variant|gene|疾病|药物|靶点/.test(normalized)) domains.add('knowledge');
  if (!domains.size) domains.add('knowledge');
  return Array.from(domains);
}

function inferArtifactTypes(description: string, domains: SkillDomain[]) {
  const normalized = description.toLowerCase();
  const artifacts = new Set<string>();
  if (domains.includes('literature')) artifacts.add('paper-list');
  if (domains.includes('structure')) artifacts.add('structure-summary');
  if (domains.includes('omics')) artifacts.add('omics-differential-expression');
  if (domains.includes('knowledge')) artifacts.add('knowledge-graph');
  if (/blast|alignment|sequence/.test(normalized)) artifacts.add('sequence-alignment');
  return artifacts.size ? Array.from(artifacts) : ['inspection-summary'];
}

function toolTypeForName(name: string): ToolElement['toolType'] {
  if (/agentserver|web-search|manual/i.test(name)) return 'llm-backend';
  if (/mol\*|3dmol|viewer/i.test(name)) return 'visual-runtime';
  if (/deseq|scanpy|clusterprofiler|workspace/i.test(name)) return 'runner';
  if (/pubmed|pdb|alphafold|uniprot|chembl|opentargets|clinical|semantic|crossref/i.test(name)) return 'database';
  return 'connector';
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
