import type { UIManifestSlot } from '../domain';
import { SCENARIO_SPECS, type ScenarioArtifactSchema, type ScenarioInputField, type ScenarioScopeDeclaration, type SkillDomain } from '../scenarioSpecs';
import { elementRegistry } from './elementRegistry';
import type { ArtifactSchemaElement, ElementRegistry, FailurePolicyElement, SkillElement, UIComponentElement } from './elementTypes';
import type { ScenarioIR, ScenarioPackage, ScenarioPublishStatus } from './scenarioPackage';
import { compileSkillPlan } from './skillPlanCompiler';
import type { UIPlan } from './uiPlanCompiler';
import { validateScenarioPackage, type ValidationReport } from './validationGate';

export type ScenarioCompileIssueCode =
  | 'missing-producer'
  | 'ambiguous-skill'
  | 'unsupported-artifact'
  | 'unsupported-skill'
  | 'unsupported-component'
  | 'unsafe-policy'
  | 'missing-ui-consumer';

export interface ScenarioCompileIssue {
  severity: 'error' | 'warning' | 'question';
  code: ScenarioCompileIssueCode;
  message: string;
  elementId?: string;
  recoverActions: string[];
}

export interface ScenarioElementSelection {
  id: string;
  title: string;
  description: string;
  skillDomain?: SkillDomain;
  scenarioMarkdown?: string;
  selectedSkillIds: string[];
  selectedToolIds?: string[];
  selectedArtifactTypes: string[];
  selectedComponentIds?: string[];
  selectedFailurePolicyIds?: string[];
  fallbackComponentId?: string;
  version?: string;
  status?: ScenarioPublishStatus;
}

export interface ScenarioElementRecommendation {
  source: 'heuristic' | 'agentserver-placeholder';
  selectedSkillIds: string[];
  selectedToolIds: string[];
  selectedArtifactTypes: string[];
  selectedComponentIds: string[];
  selectedFailurePolicyIds: string[];
  reasons: string[];
}

export interface ScenarioCompilationResult {
  scenario: ScenarioIR;
  skillPlan: ReturnType<typeof compileSkillPlan>;
  uiPlan: UIPlan;
  validationReport: ValidationReport;
  issues: ScenarioCompileIssue[];
  package: ScenarioPackage;
}

export interface ScenarioRecommendationOptions {
  agentServerBaseUrl?: string;
  allowAgentServer?: boolean;
}

export function compileScenarioIRFromSelection(
  selection: ScenarioElementSelection,
  registry: ElementRegistry = elementRegistry,
): ScenarioCompilationResult {
  const issues: ScenarioCompileIssue[] = [];
  const skills = resolveSkills(selection.selectedSkillIds, registry, issues);
  const skillDomain = selection.skillDomain ?? inferSkillDomain(skills);
  const artifactElements = resolveArtifacts(selection.selectedArtifactTypes, registry, issues);
  const componentIds = selection.selectedComponentIds?.length
    ? unique(selection.selectedComponentIds)
    : defaultComponentIdsForArtifacts(artifactElements, registry);
  const components = resolveComponents(componentIds, registry, issues);
  const fallbackComponentId = selection.fallbackComponentId || 'unknown-artifact-inspector';
  if (!registry.components.some((component) => component.componentId === fallbackComponentId)) {
    issues.push({
      severity: 'error',
      code: 'unsupported-component',
      message: `Fallback UI component is not registered: ${fallbackComponentId}`,
      elementId: fallbackComponentId,
      recoverActions: ['select-registered-fallback-component'],
    });
  }

  checkArtifactProducerCoverage(artifactElements, skills, issues);
  checkArtifactConsumerCoverage(artifactElements, components, fallbackComponentId, registry, issues);
  checkFailurePolicies(selection.selectedFailurePolicyIds ?? ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'], registry, issues);

  const base = baseSpecForDomain(skillDomain);
  const outputArtifacts = artifactElements.map(toScenarioArtifactSchema);
  const selectedSkillIds = skills.map((skill) => skill.id);
  const scenario: ScenarioIR = {
    id: safeScenarioId(selection.id),
    title: selection.title.trim() || 'Untitled scenario',
    description: selection.description.trim(),
    source: 'workspace',
    skillDomain,
    scenarioMarkdown: selection.scenarioMarkdown || buildScenarioMarkdown(selection, outputArtifacts, selectedSkillIds),
    inputContract: deriveInputContract(skills, base.inputContract),
    outputArtifacts,
    scopeDeclaration: buildScopeDeclaration(selection, outputArtifacts),
    defaultSlots: compileSlotsFromSelection(artifactElements, components, fallbackComponentId),
    selectedSkillIds,
    selectedToolIds: unique(selection.selectedToolIds ?? []),
    selectedComponentIds: components.map((component) => component.componentId),
    fallbackComponentId,
  };
  const skillPlan = compileSkillPlan(scenario.selectedSkillIds, registry);
  const uiPlan = compileUIPlanForSelection(scenario, fallbackComponentId);
  const version = selection.version || '1.0.0';
  const status = selection.status || 'draft';
  const pkg: ScenarioPackage = {
    schemaVersion: '1',
    id: scenario.id,
    version,
    status,
    scenario,
    skillPlan,
    uiPlan,
    tests: [{
      id: `smoke.${scenario.id}.${version}`,
      prompt: scenario.inputContract.find((field) => field.required)?.label || scenario.description || scenario.title,
      expectedArtifactTypes: scenario.outputArtifacts.map((artifact) => artifact.type),
    }],
    versions: [{
      version,
      status,
      createdAt: new Date().toISOString(),
      summary: `Compiled from ${scenario.selectedSkillIds.length} skills and ${scenario.selectedComponentIds.length} UI components.`,
      scenarioHash: stableHash(JSON.stringify({
        id: scenario.id,
        skills: scenario.selectedSkillIds,
        artifacts: scenario.outputArtifacts.map((artifact) => artifact.type),
        components: scenario.selectedComponentIds,
      })),
    }],
  };
  const validationReport = mergeCompileIssues(validateScenarioPackage(pkg, registry), issues);
  const packageWithReport = { ...pkg, validationReport };
  return {
    scenario,
    skillPlan,
    uiPlan,
    validationReport,
    issues,
    package: packageWithReport,
  };
}

export function recommendScenarioElements(
  description: string,
  registry: ElementRegistry = elementRegistry,
  options: ScenarioRecommendationOptions = {},
): ScenarioElementRecommendation {
  const text = description.toLowerCase();
  const inferredDomain = inferDomainFromText(text);
  const targetArtifactTypes = inferTargetArtifactTypes(text, inferredDomain);
  const complexOpenEnded = requiresGeneratedCapability(text);
  const matchedSkills = registry.skills
    .filter((skill) => skill.skillDomains.includes(inferredDomain))
    .filter((skill) => skill.source !== 'generated')
    .map((skill) => ({
      skill,
      score: scoreSkillForDescription(skill, text, targetArtifactTypes),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id))
    .map((item) => item.skill)
    .slice(0, 4);
  const generatedSkill = registry.skills.find((skill) => skill.id === `agentserver.generate.${inferredDomain}`);
  const selectedSkills = unique([
    ...(complexOpenEnded && generatedSkill ? [generatedSkill] : []),
    ...matchedSkills,
    ...(!matchedSkills.length && generatedSkill ? [generatedSkill] : []),
  ]).slice(0, 5);
  const selectedArtifactTypes = unique(targetArtifactTypes.length
    ? targetArtifactTypes
    : selectedSkills.flatMap((skill) => skill.outputArtifactTypes).filter((artifactType) => artifactType !== 'runtime-artifact'));
  const selectedComponentIds = enrichRecommendedComponents(defaultComponentIdsForArtifacts(
    registry.artifacts.filter((artifact) => selectedArtifactTypes.includes(artifact.artifactType)),
    registry,
  ), selectedArtifactTypes, complexOpenEnded);
  return {
    source: options.allowAgentServer && options.agentServerBaseUrl ? 'agentserver-placeholder' : 'heuristic',
    selectedSkillIds: selectedSkills.map((skill) => skill.id),
    selectedToolIds: registry.tools
      .filter((tool) => tool.skillDomains.includes(inferredDomain))
      .slice(0, 4)
      .map((tool) => tool.id),
    selectedArtifactTypes,
    selectedComponentIds,
    selectedFailurePolicyIds: ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'],
    reasons: [
      `Inferred domain=${inferredDomain}; target artifacts=${selectedArtifactTypes.join(', ') || 'runtime-artifact'}.`,
      complexOpenEnded
        ? 'Open-ended or multi-step request: compiled with AgentServer/native backend generated capability as the stable runtime producer.'
        : 'Request matches registered deterministic capabilities; backend generation remains available if no local route can satisfy runtime execution.',
      options.allowAgentServer && options.agentServerBaseUrl
        ? 'AgentServer recommendation API is reserved; deterministic heuristic recommendations remain available offline.'
        : 'Matched local element manifests by description, tags, examples, and skill domain.',
    ],
  };
}

function enrichRecommendedComponents(componentIds: string[], artifactTypes: string[], complexOpenEnded: boolean) {
  const primaryComponents = componentIds.filter((componentId) => componentId !== 'unknown-artifact-inspector');
  return unique([
    ...primaryComponents,
    ...(artifactTypes.includes('paper-list') ? ['evidence-matrix'] : []),
    ...(complexOpenEnded ? ['execution-unit-table', 'notebook-timeline'] : []),
    'unknown-artifact-inspector',
  ]);
}

function resolveSkills(skillIds: string[], registry: ElementRegistry, issues: ScenarioCompileIssue[]) {
  return unique(skillIds).flatMap((skillId) => {
    const skill = registry.skills.find((item) => item.id === skillId);
    if (!skill) {
      issues.push({
        severity: 'error',
        code: 'unsupported-skill',
        message: `Selected skill is not registered: ${skillId}`,
        elementId: skillId,
        recoverActions: ['remove-skill', 'install-skill-manifest'],
      });
      return [];
    }
    return [skill];
  });
}

function resolveArtifacts(artifactTypes: string[], registry: ElementRegistry, issues: ScenarioCompileIssue[]) {
  return unique(artifactTypes).flatMap((artifactType) => {
    const artifact = registry.artifacts.find((item) => item.artifactType === artifactType);
    if (!artifact) {
      issues.push({
        severity: 'error',
        code: 'unsupported-artifact',
        message: `Selected artifact schema is not registered: ${artifactType}`,
        elementId: artifactType,
        recoverActions: ['remove-artifact', 'define-artifact-schema'],
      });
      return [];
    }
    return [artifact];
  });
}

function resolveComponents(componentIds: string[], registry: ElementRegistry, issues: ScenarioCompileIssue[]) {
  return unique(componentIds).flatMap((componentId) => {
    const component = registry.components.find((item) => item.componentId === componentId);
    if (!component) {
      issues.push({
        severity: 'error',
        code: 'unsupported-component',
        message: `Selected UI component is not registered: ${componentId}`,
        elementId: componentId,
        recoverActions: ['remove-component', 'select-registered-component'],
      });
      return [];
    }
    return [component];
  });
}

function checkArtifactProducerCoverage(artifacts: ArtifactSchemaElement[], skills: SkillElement[], issues: ScenarioCompileIssue[]) {
  for (const artifact of artifacts) {
    const selectedProducers = skills.filter((skill) => skill.outputArtifactTypes.includes(artifact.artifactType));
    if (selectedProducers.length) continue;
    if (artifact.producerSkillIds.length > 1) {
      issues.push({
        severity: 'question',
        code: 'ambiguous-skill',
        message: `Artifact ${artifact.artifactType} has multiple possible producers but none was selected.`,
        elementId: artifact.artifactType,
        recoverActions: artifact.producerSkillIds.map((skillId) => `select-skill:${skillId}`),
      });
    } else {
      issues.push({
        severity: 'error',
        code: 'missing-producer',
        message: `Artifact ${artifact.artifactType} has no selected producing skill.`,
        elementId: artifact.artifactType,
        recoverActions: artifact.producerSkillIds.length ? [`select-skill:${artifact.producerSkillIds[0]}`] : ['define-producer-skill'],
      });
    }
  }
}

function checkArtifactConsumerCoverage(
  artifacts: ArtifactSchemaElement[],
  components: UIComponentElement[],
  fallbackComponentId: string,
  registry: ElementRegistry,
  issues: ScenarioCompileIssue[],
) {
  const fallback = registry.components.find((component) => component.componentId === fallbackComponentId);
  for (const artifact of artifacts) {
    const hasConsumer = [...components, ...(fallback ? [fallback] : [])]
      .some((component) => component.acceptsArtifactTypes.includes('*') || component.acceptsArtifactTypes.includes(artifact.artifactType));
    if (!hasConsumer) {
      issues.push({
        severity: 'error',
        code: 'missing-ui-consumer',
        message: `Artifact ${artifact.artifactType} has no selected UI consumer or fallback.`,
        elementId: artifact.artifactType,
        recoverActions: ['select-compatible-component', 'select-unknown-artifact-inspector'],
      });
    }
  }
}

function checkFailurePolicies(policyIds: string[], registry: ElementRegistry, issues: ScenarioCompileIssue[]) {
  for (const policyId of unique(policyIds)) {
    const policy = registry.failurePolicies.find((item) => item.id === policyId);
    if (!policy) {
      issues.push({
        severity: 'error',
        code: 'unsafe-policy',
        message: `Failure policy is not registered: ${policyId}`,
        elementId: policyId,
        recoverActions: ['remove-policy', 'select-registered-failure-policy'],
      });
    }
  }
}

function compileUIPlanForSelection(scenario: ScenarioIR, fallbackComponentId: string): UIPlan {
  return {
    id: `ui-plan.${scenario.id}.compiled`,
    version: '1.0.0',
    scenarioId: scenario.id,
    slots: scenario.defaultSlots,
    fallbacks: {
      unknownArtifact: fallbackComponentId,
      missingData: 'empty-state-with-reason',
    },
    compiledFrom: {
      artifactTypes: scenario.outputArtifacts.map((artifact) => artifact.type),
      componentIds: scenario.selectedComponentIds,
    },
    warnings: [],
  };
}

function compileSlotsFromSelection(
  artifacts: ArtifactSchemaElement[],
  components: UIComponentElement[],
  fallbackComponentId: string,
): UIManifestSlot[] {
  const artifactSlots = artifacts.map((artifact, index) => {
    const component = components.find((item) => item.acceptsArtifactTypes.includes(artifact.artifactType))
      ?? components.find((item) => item.acceptsArtifactTypes.includes('*'))
      ?? components.find((item) => item.componentId === fallbackComponentId);
    return {
      componentId: component?.componentId ?? fallbackComponentId,
      title: artifact.label,
      artifactRef: artifact.artifactType,
      priority: index + 1,
    };
  });
  const usedComponentIds = new Set(artifactSlots.map((slot) => slot.componentId));
  const supportSlots = components
    .filter((component) => !usedComponentIds.has(component.componentId))
    .filter((component) => component.requiredFields.length === 0 || component.acceptsArtifactTypes.includes('*'))
    .map((component, index) => ({
      componentId: component.componentId,
      title: component.label,
      priority: artifactSlots.length + index + 1,
    }));
  return [...artifactSlots, ...supportSlots];
}

function defaultComponentIdsForArtifacts(artifacts: ArtifactSchemaElement[], registry: ElementRegistry) {
  const ids = artifacts.map((artifact) => artifact.consumerComponentIds.find((componentId) => componentId !== 'unknown-artifact-inspector') ?? 'unknown-artifact-inspector');
  return unique([...ids, 'unknown-artifact-inspector']);
}

function deriveInputContract(skills: SkillElement[], fallback: ScenarioInputField[]) {
  const keys = new Set<string>();
  const fields: ScenarioInputField[] = [];
  for (const skill of skills) {
    for (const key of Object.keys(skill.inputContract)) {
      if (keys.has(key)) continue;
      keys.add(key);
      fields.push({ key, label: key, type: 'text', required: key === 'prompt' || key === 'query' });
    }
  }
  return fields.length ? fields : fallback;
}

function buildScopeDeclaration(selection: ScenarioElementSelection, outputArtifacts: ScenarioArtifactSchema[]): ScenarioScopeDeclaration {
  return {
    supportedTasks: [
      `Run selected skills for ${selection.title || selection.id}`,
      ...outputArtifacts.map((artifact) => `Produce ${artifact.type}`),
    ],
    requiredInputs: ['published input contract'],
    unsupportedTasks: ['Unselected tools, unsafe dynamic UI code, and artifacts without selected producers'],
    handoffTargets: unique(outputArtifacts.flatMap((artifact) => artifact.consumers)),
    phaseLimitations: ['Compiled workspace scenarios are stable only for the package version that passed validation.'],
  };
}

function buildScenarioMarkdown(selection: ScenarioElementSelection, outputArtifacts: ScenarioArtifactSchema[], selectedSkillIds: string[]) {
  return [
    `# ${selection.title || selection.id}`,
    '',
    `用户目标：${selection.description}`,
    '',
    `Selected skills: ${selectedSkillIds.join(', ') || 'none'}.`,
    '',
    `Output artifacts: ${outputArtifacts.map((artifact) => artifact.type).join(', ') || 'none'}.`,
    '',
    'Runtime boundary: dynamic recommendation is allowed before publish; published execution uses this compiled contract.',
  ].join('\n');
}

function toScenarioArtifactSchema(artifact: ArtifactSchemaElement): ScenarioArtifactSchema {
  return {
    type: artifact.artifactType,
    description: artifact.description,
    fields: artifact.fields,
    consumers: artifact.handoffTargets,
  };
}

function mergeCompileIssues(report: ValidationReport, issues: ScenarioCompileIssue[]): ValidationReport {
  return {
    ...report,
    ok: report.ok && !issues.some((issue) => issue.severity === 'error'),
    issues: [
      ...report.issues,
      ...issues.map((issue) => ({
        severity: issue.severity === 'error' ? 'error' as const : 'warning' as const,
        code: issue.code,
        message: issue.message,
        elementId: issue.elementId,
      })),
    ],
  };
}

function inferSkillDomain(skills: SkillElement[]): SkillDomain {
  const counts = new Map<SkillDomain, number>();
  for (const skill of skills) {
    for (const domain of skill.skillDomains) counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'literature';
}

function inferDomainFromText(text: string): SkillDomain {
  if (/rna|scrna|omics|matrix|deseq|scanpy|umap|表达|差异|组学|单细胞/.test(text)) return 'omics';
  if (/pdb|protein structure|structure|alphafold|ligand|residue|pocket|蛋白结构|结构|口袋|配体|残基/.test(text)) return 'structure';
  if (/chembl|opentargets|drug|compound|disease|pathway|target|knowledge graph|知识图谱|疾病|化合物|药物|靶点/.test(text)) return 'knowledge';
  return 'literature';
}

function inferTargetArtifactTypes(text: string, domain: SkillDomain) {
  const artifacts = new Set<string>();
  if (/report|summary|summari[sz]e|review|markdown|pdf|download|read|阅读|总结|报告|综述|下载/.test(text)) artifacts.add('research-report');
  if (/paper|literature|pubmed|arxiv|semantic scholar|crossref|文献|论文|文章|证据/.test(text)) artifacts.add('paper-list');
  if (/structure|pdb|alphafold|molecule|protein|ligand|residue|结构|蛋白|配体|残基/.test(text)) artifacts.add('structure-summary');
  if (/rna|scrna|omics|matrix|deseq|scanpy|umap|expression|表达|差异|组学|单细胞/.test(text)) artifacts.add('omics-differential-expression');
  if (/chembl|uniprot|opentargets|drug|compound|disease|pathway|knowledge graph|network|知识图谱|疾病|化合物|药物|靶点|网络/.test(text)) artifacts.add('knowledge-graph');
  if (/blast|alignment|sequence|序列|比对|同源/.test(text)) artifacts.add('sequence-alignment');
  if (!artifacts.size) {
    const base = baseSpecForDomain(domain);
    base.outputArtifacts.forEach((artifact) => artifacts.add(artifact.type));
  }
  return Array.from(artifacts);
}

function requiresGeneratedCapability(text: string) {
  return /scenario|workflow|pipeline|package|compile|generate|build|agent|download|read|report|summary|summari[sz]e|systematic|latest|today|arxiv|browser|google|web|场景|流程|编译|生成|下载|阅读|报告|总结|系统性|最新|今天|浏览器|搜索/.test(text);
}

function scoreSkillForDescription(skill: SkillElement, text: string, targetArtifactTypes: string[]) {
  let score = 0;
  for (const artifactType of skill.outputArtifactTypes) {
    if (targetArtifactTypes.includes(artifactType)) score += 8;
  }
  const haystack = [skill.id, skill.label, skill.description, ...skill.tags ?? [], ...skill.examplePrompts].join(' ').toLowerCase();
  for (const token of text.split(/[\s,，。.!?？;；:：/]+/)) {
    if (token.length > 2 && haystack.includes(token)) score += 2;
  }
  if (skill.id === 'literature.web_search' && /\b(arxiv|google|web|browser|latest|today)\b|谷歌|浏览器|网页|最新|今天/.test(text)) score += 20;
  if (skill.id === 'literature.pubmed_search' && /\bpubmed\b|医学文献|生物医学/.test(text)) score += 12;
  if (skill.entrypointType === 'markdown-skill') score -= 2;
  return score;
}

function baseSpecForDomain(skillDomain: SkillDomain) {
  if (skillDomain === 'structure') return SCENARIO_SPECS['structure-exploration'];
  if (skillDomain === 'omics') return SCENARIO_SPECS['omics-differential-exploration'];
  if (skillDomain === 'knowledge') return SCENARIO_SPECS['biomedical-knowledge-graph'];
  return SCENARIO_SPECS['literature-evidence-review'];
}

function safeScenarioId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || `scenario-${Date.now()}`;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
