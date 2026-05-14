import { elementRegistry } from './elementRegistry';
import type { ArtifactSchemaElement, ElementRegistry, SkillElement, UIComponentElement } from './elementTypes';
import type { ScenarioBuilderDraft } from './scenarioDraftCompiler';
import { recommendScenarioElements, type ScenarioElementSelection } from './scenarioElementCompiler';
import type { ScenarioId, ScenarioPackageRef, ScenarioRuntimeOverride } from './contracts';
import type { ScenarioPackage } from './scenarioPackage';
import { SCENARIO_SPECS, type ScenarioArtifactSchema, type SkillDomain } from './scenarioSpecs';
import { scenarioIdBySkillDomain } from './scenarioRoutingPolicy';
import type { ScenarioQualityReport } from './scenarioQualityGate';
import type { ValidationReport } from './validationGate';

export interface ScenarioBuilderComponentDisplay {
  label: string;
  detail: string;
  meta: string;
}

export interface ScenarioBuilderElementSelectorOption {
  id: string;
  label: string;
  detail?: string;
  meta?: string;
}

export interface ScenarioDisplayToken {
  id: string;
  label: string;
  detail?: string;
}

export interface ScenarioDomainFilterOption {
  value: SkillDomain;
  label: string;
  scenarioTitle: string;
}

export interface ScenarioDashboardAction {
  scenarioId: ScenarioId;
  label: string;
}

export interface ScenarioPackagePreviewField {
  label: string;
  value: string;
}

export interface ScenarioPackageManifestPreview {
  hasSensitiveRefs: boolean;
  sensitiveRefs: string[];
  slotCount: number;
  skillCount: number;
  testCount: number;
  versionCount: number;
  qualityLabel: string;
  manifest: {
    schemaVersion: ScenarioPackage['schemaVersion'];
    id: string;
    version: string;
    status: ScenarioPackage['status'];
    scenario: {
      id: string;
      title: string;
      skillDomain: string;
      source: string;
    };
    skillPlan: {
      id: string;
      skills: string[];
    };
    uiPlan: {
      id: string;
      components: string[];
      artifacts: string[];
    };
    tests: Array<{ id: string; expectedArtifactTypes: string[] }>;
    quality: {
      ok: boolean;
      issues: number;
    };
    versions: Array<{
      version: string;
      status: ScenarioPackage['status'];
      createdAt: string;
      summary: string;
    }>;
  };
}

export const scenarioBuilderChromePaneIds = {
  sceneInfo: 'scene-info',
  agentRuntimeUi: 'agent-runtime-ui',
  scenarioPackageUi: 'scenario-package-ui',
  skills: 'skills',
  tools: 'tools',
  artifacts: 'artifacts',
  failurePolicies: 'failure-policies',
  contract: 'contract',
  quality: 'quality',
  publish: 'publish',
} as const;

export type ScenarioBuilderChromePaneId = typeof scenarioBuilderChromePaneIds[keyof typeof scenarioBuilderChromePaneIds];

export interface ScenarioBuilderChromeNavItem {
  id: ScenarioBuilderChromePaneId;
  label: string;
}

export interface ScenarioBuilderDraftPreviewModel {
  title: string;
  summary: string;
  componentTokens: ScenarioDisplayToken[];
  artifactTokens: ScenarioDisplayToken[];
  skillTokens: ScenarioDisplayToken[];
  scenarioMarkdown: string;
}

export interface ScenarioBuilderRecommendationInput {
  selection: Pick<ScenarioElementSelection, 'skillDomain' | 'selectedSkillIds' | 'selectedArtifactTypes'>;
  scenario: {
    skillDomain: SkillDomain;
    fallbackComponent?: string;
  };
  uiSlotCount: number;
  skillStepCount: number;
}

export interface ScenarioPackageRuntimeOverride extends ScenarioRuntimeOverride {
  selectedSkillIds?: string[];
  selectedToolIds?: string[];
}

export interface ScenarioReportViewerEmptyStatePolicy {
  componentId: string;
  artifactType: string;
  detail?: string;
}

export const scenarioBuilderQualityChecklistText = '发布前会检查 producer/consumer、fallback、runtime profile 和 package quality gate。';
export const scenarioBuilderDefaultPrompt = '我想比较KRAS G12D突变相关文献证据，并在需要时联动蛋白结构和知识图谱。';
export const scenarioBuilderPromptPlaceholder = '例如：帮我构建一个场景，读取单细胞表达矩阵，比较处理组和对照组，并展示火山图、热图和UMAP。';
export const scenarioBuilderComponentSelectorCopy = {
  agentRuntimeUi: {
    title: 'Agent 运行时 UI 白名单',
    description: '发往 AgentServer 的 availableComponentIds；每行包含组件 ID、标题与说明。与左侧「组件工作台」勾选列表一致。',
  },
  scenarioPackageUi: {
    title: '场景 UI allowlist（Scenario package）',
    description: '每行一个可渲染 UI 组件；勾选项写入 Scenario 的 defaultComponents，用于编译 UI plan 与默认视图。',
  },
} as const;
export const scenarioBuilderElementSelectorCopy = {
  collapseOpenTitle: '收起列表',
  collapseClosedTitle: '展开列表',
  searchLabel: '搜索',
  searchPlaceholder: '名称、说明、artifact、capability...',
  selectVisible: '选中当前',
  clearVisible: '取消当前',
  excludeVisible: '排除当前',
  restoreExcluded: '恢复排除',
  detailLabel: '详细',
  rowExclude: '排除',
  defaultMeta: 'no additional profile',
  emptyState: '没有匹配项。可以清空搜索或恢复排除。',
} as const;
export const scenarioDashboardPrimaryImportAction: ScenarioDashboardAction = {
  scenarioId: scenarioIdBySkillDomain.literature,
  label: '导入文献场景',
};

export function scenarioBuilderChromeNavItems(input: { includeAgentRuntimeUi?: boolean } = {}): ScenarioBuilderChromeNavItem[] {
  const items: ScenarioBuilderChromeNavItem[] = [
    { id: scenarioBuilderChromePaneIds.sceneInfo, label: '场景信息' },
  ];
  if (input.includeAgentRuntimeUi) {
    items.push({ id: scenarioBuilderChromePaneIds.agentRuntimeUi, label: 'Agent 运行时 UI' });
  }
  items.push(
    { id: scenarioBuilderChromePaneIds.scenarioPackageUi, label: '场景 UI allowlist' },
    { id: scenarioBuilderChromePaneIds.skills, label: 'Skills' },
    { id: scenarioBuilderChromePaneIds.tools, label: 'Tools' },
    { id: scenarioBuilderChromePaneIds.artifacts, label: 'Artifacts' },
    { id: scenarioBuilderChromePaneIds.failurePolicies, label: '失败策略' },
    { id: scenarioBuilderChromePaneIds.contract, label: '场景契约' },
    { id: scenarioBuilderChromePaneIds.quality, label: '质量检查' },
    { id: scenarioBuilderChromePaneIds.publish, label: '发布运行' },
  );
  return items;
}

export function scenarioBuilderChromeFallbackPane(input: {
  pane: ScenarioBuilderChromePaneId;
  includeAgentRuntimeUi?: boolean;
}): ScenarioBuilderChromePaneId {
  return input.pane === scenarioBuilderChromePaneIds.agentRuntimeUi && !input.includeAgentRuntimeUi
    ? scenarioBuilderChromePaneIds.scenarioPackageUi
    : input.pane;
}

export function scenarioBuilderElementSelectorSummary(input: {
  selectedCount: number;
  visibleCount: number;
  totalCount: number;
  excludedCount: number;
}) {
  const excluded = input.excludedCount ? ` · ${input.excludedCount} excluded` : '';
  return `${input.selectedCount} selected · ${input.visibleCount}/${input.totalCount} shown${excluded}`;
}

export function scenarioBuilderElementSelectorRegistryAriaLabel(title: string) {
  return `${title} registry`;
}

export function scenarioSkillDomainFilterOptions(): ScenarioDomainFilterOption[] {
  return Object.entries(scenarioIdBySkillDomain).map(([value, scenarioId]) => ({
    value: value as SkillDomain,
    label: value,
    scenarioTitle: SCENARIO_SPECS[scenarioId].title,
  }));
}

export function scenarioSkillDomainDisplayLabel(value: string) {
  const match = scenarioSkillDomainFilterOptions().find((option) => option.value === value);
  return match?.label ?? value;
}

export function scenarioPackagePreviewFields(input: {
  title: string;
  skillDomain: string;
  qualityLabel: string;
  exportFileName: string;
}): ScenarioPackagePreviewField[] {
  return [
    { label: 'scenario', value: input.title },
    { label: 'domain', value: scenarioSkillDomainDisplayLabel(input.skillDomain) },
    { label: 'quality', value: input.qualityLabel },
    { label: 'export file', value: input.exportFileName },
  ];
}

export function scenarioPackageExportFileName(input: { id: string; version: string }) {
  return `${input.id}-${input.version}.scenario-package.json`;
}

export function scenarioReportViewerEmptyStatePolicy(input: { hasArtifact: boolean }): ScenarioReportViewerEmptyStatePolicy {
  return {
    componentId: 'report-viewer',
    artifactType: 'research-report',
    detail: input.hasArtifact ? '当前 research-report 缺少 markdown/report/sections 字段；请检查 AgentServer 生成的 artifact contract。' : undefined,
  };
}

export function scenarioPackageIdentityLabel(input?: { id: string; version: string }, fallback = 'n/a') {
  return input ? `${input.id}@${input.version}` : fallback;
}

export function scenarioPackageRefLabel(
  ref?: Pick<ScenarioPackageRef, 'id' | 'version' | 'source'>,
  options: { includeSource?: boolean; fallback?: string } = {},
) {
  if (!ref) return options.fallback ?? 'n/a';
  const label = scenarioPackageIdentityLabel(ref);
  return options.includeSource ? `${label}:${ref.source}` : label;
}

export function scenarioPackageValidationSummary(input: {
  package: Pick<ScenarioPackage, 'id' | 'version'>;
  validationReport: Pick<ValidationReport, 'ok'>;
}) {
  return `${scenarioPackageIdentityLabel(input.package)} · ${input.validationReport.ok ? 'valid' : 'needs fixes'}`;
}

export function scenarioBuilderPackageForWorkspaceSave(input: {
  package: ScenarioPackage;
  status: ScenarioPackage['status'];
  validationReport: ValidationReport;
  qualityReport: ScenarioQualityReport;
  recommendationReasons: string[];
  builderStep: string;
  selection: Pick<ScenarioElementSelection, 'skillDomain' | 'selectedSkillIds' | 'selectedToolIds' | 'selectedComponentIds' | 'selectedArtifactTypes'>;
  fallbackSkillDomain: SkillDomain;
}): ScenarioPackage {
  return {
    ...input.package,
    status: input.status,
    metadata: {
      ...input.package.metadata,
      recommendationReasons: input.recommendationReasons,
      compiledFrom: {
        builderStep: input.builderStep,
        skillDomain: input.selection.skillDomain ?? input.fallbackSkillDomain,
        selectedSkillIds: input.selection.selectedSkillIds,
        selectedToolIds: input.selection.selectedToolIds,
        selectedComponentIds: input.selection.selectedComponentIds,
        selectedArtifactTypes: input.selection.selectedArtifactTypes,
      },
    },
    validationReport: input.validationReport,
    qualityReport: input.qualityReport,
  };
}

export function scenarioPackageToRuntimeOverride(pkg: Pick<ScenarioPackage, 'id' | 'version' | 'scenario' | 'skillPlan' | 'uiPlan'>): ScenarioPackageRuntimeOverride {
  const base = SCENARIO_SPECS[scenarioIdBySkillDomain[pkg.scenario.skillDomain]];
  const defaultComponents = pkg.scenario.selectedComponentIds.length ? pkg.scenario.selectedComponentIds : base.componentPolicy.defaultComponents;
  return {
    title: pkg.scenario.title,
    description: pkg.scenario.description,
    skillDomain: pkg.scenario.skillDomain,
    scenarioMarkdown: pkg.scenario.scenarioMarkdown,
    defaultComponents,
    allowedComponents: Array.from(new Set([...base.componentPolicy.allowedComponents, ...defaultComponents])),
    fallbackComponent: pkg.scenario.fallbackComponentId || base.componentPolicy.fallbackComponent,
    selectedSkillIds: pkg.scenario.selectedSkillIds,
    selectedToolIds: pkg.scenario.selectedToolIds,
    scenarioPackageRef: { id: pkg.id, version: pkg.version, source: 'workspace' },
    skillPlanRef: pkg.skillPlan.id,
    uiPlanRef: pkg.uiPlan.id,
  };
}

export function scenarioDefaultElementSelectionForRuntimeOverride(
  scenarioId: ScenarioId,
  scenario: ScenarioPackageRuntimeOverride,
): ScenarioElementSelection {
  const spec = SCENARIO_SPECS[scenarioId];
  const compiledHints = scenario as ScenarioPackageRuntimeOverride & Partial<Pick<ScenarioBuilderDraft, 'recommendedSkillIds' | 'recommendedArtifactTypes' | 'recommendedComponentIds'>>;
  const recommendation = recommendScenarioElements([
    scenario.title,
    scenario.description,
  ].join('\n'));
  return {
    id: `${scenarioId}-workspace-draft`,
    title: scenario.title,
    description: scenario.description,
    skillDomain: scenario.skillDomain,
    scenarioMarkdown: scenario.scenarioMarkdown,
    selectedSkillIds: scenario.selectedSkillIds?.length
      ? scenario.selectedSkillIds
      : compiledHints.recommendedSkillIds?.length
      ? compiledHints.recommendedSkillIds
      : recommendation.selectedSkillIds.length
      ? recommendation.selectedSkillIds
      : [`agentserver.generate.${scenario.skillDomain}`],
    selectedToolIds: scenario.selectedToolIds?.length
      ? scenario.selectedToolIds
      : recommendation.selectedToolIds.length
      ? recommendation.selectedToolIds
      : elementRegistry.tools.filter((tool) => tool.skillDomains.includes(scenario.skillDomain)).slice(0, 5).map((tool) => tool.id),
    selectedArtifactTypes: compiledHints.recommendedArtifactTypes?.length
      ? compiledHints.recommendedArtifactTypes
      : recommendation.selectedArtifactTypes.length
      ? recommendation.selectedArtifactTypes
      : spec.outputArtifacts.map((artifact) => artifact.type),
    selectedComponentIds: compiledHints.recommendedComponentIds?.length
      ? compiledHints.recommendedComponentIds
      : recommendation.selectedComponentIds.length
      ? recommendation.selectedComponentIds
      : scenario.defaultComponents,
    selectedFailurePolicyIds: ['failure.missing-input', 'failure.schema-mismatch', 'failure.backend-unavailable'],
    fallbackComponentId: scenario.fallbackComponent,
    status: 'draft',
  };
}

export function scenarioBuilderPrioritizeBySelectionAndDomain<T extends { id: string; tags?: string[]; skillDomains?: string[] }>(
  values: T[],
  selectedIds: string[],
  domain: SkillDomain,
  idForItem: (item: T) => string = (item) => item.id,
) {
  return [...values].sort((left, right) => {
    const leftSelected = selectedIds.includes(idForItem(left)) ? 0 : 1;
    const rightSelected = selectedIds.includes(idForItem(right)) ? 0 : 1;
    if (leftSelected !== rightSelected) return leftSelected - rightSelected;
    const leftDomain = left.skillDomains?.includes(domain) || left.tags?.includes(domain) ? 0 : 1;
    const rightDomain = right.skillDomains?.includes(domain) || right.tags?.includes(domain) ? 0 : 1;
    if (leftDomain !== rightDomain) return leftDomain - rightDomain;
    return idForItem(left).localeCompare(idForItem(right));
  });
}

export function scenarioPackageManifestPreview(pkg: ScenarioPackage, workspacePath: string): ScenarioPackageManifestPreview {
  const json = JSON.stringify(pkg, null, 2);
  const sensitiveRefs = extractSensitiveWorkspaceRefs(json, workspacePath);
  const qualityOk = pkg.qualityReport?.ok ?? pkg.validationReport?.ok ?? true;
  return {
    hasSensitiveRefs: sensitiveRefs.length > 0,
    sensitiveRefs,
    slotCount: pkg.uiPlan.slots.length,
    skillCount: pkg.skillPlan.skillIRs.length,
    testCount: pkg.tests.length,
    versionCount: pkg.versions.length || 1,
    qualityLabel: qualityOk ? 'quality pass' : 'quality warnings',
    manifest: {
      schemaVersion: pkg.schemaVersion,
      id: pkg.id,
      version: pkg.version,
      status: pkg.status,
      scenario: {
        id: pkg.scenario.id,
        title: pkg.scenario.title,
        skillDomain: pkg.scenario.skillDomain,
        source: pkg.scenario.source,
      },
      skillPlan: {
        id: pkg.skillPlan.id,
        skills: pkg.skillPlan.skillIRs.map((skill) => skill.skillId),
      },
      uiPlan: {
        id: pkg.uiPlan.id,
        components: pkg.uiPlan.compiledFrom.componentIds,
        artifacts: pkg.uiPlan.compiledFrom.artifactTypes,
      },
      tests: pkg.tests.map((test) => ({ id: test.id, expectedArtifactTypes: test.expectedArtifactTypes })),
      quality: {
        ok: qualityOk,
        issues: pkg.qualityReport?.items.length ?? pkg.validationReport?.issues.length ?? 0,
      },
      versions: pkg.versions.map((version) => ({
        version: version.version,
        status: version.status,
        createdAt: version.createdAt,
        summary: version.summary,
      })),
    },
  };
}

export function scenarioPackageCopyId(input: { id: string }, nonce = Date.now()) {
  return `${input.id}-copy-${nonce.toString(36)}`;
}

export function copyScenarioPackageForWorkspace(pkg: ScenarioPackage, nextId = scenarioPackageCopyId(pkg)): ScenarioPackage {
  return {
    ...pkg,
    id: nextId,
    version: '1.0.0',
    status: 'draft',
    scenario: {
      ...pkg.scenario,
      id: nextId,
      title: pkg.scenario.title.endsWith(' copy') ? pkg.scenario.title : `${pkg.scenario.title} copy`,
      source: 'workspace',
    },
  };
}

export function renameScenarioPackageForImport(pkg: ScenarioPackage, nextId: string, createdAt = new Date().toISOString()): ScenarioPackage {
  return {
    ...pkg,
    id: nextId,
    status: pkg.status === 'archived' ? 'draft' : pkg.status,
    scenario: {
      ...pkg.scenario,
      id: nextId,
      title: pkg.scenario.title.endsWith(' copy') ? pkg.scenario.title : `${pkg.scenario.title} copy`,
      source: 'workspace',
    },
    versions: [{
      version: pkg.version,
      status: 'draft',
      createdAt,
      summary: `Imported as ${nextId} to avoid package id conflict.`,
      scenarioHash: `import-${nextId}`,
    }, ...pkg.versions],
  };
}

export function scenarioBuilderDraftPreviewModel(
  draft: ScenarioBuilderDraft,
  registry: ElementRegistry = elementRegistry,
): ScenarioBuilderDraftPreviewModel {
  return {
    title: draft.title,
    summary: `${draft.summary} · confidence ${Math.round(draft.confidence * 100)}%`,
    componentTokens: draft.defaultComponents.map((componentId) => componentDisplayToken(componentId, registry)),
    artifactTokens: (draft.recommendedArtifactTypes ?? []).map((artifactType) => artifactDisplayToken(artifactType, registry)),
    skillTokens: (draft.recommendedSkillIds ?? []).slice(0, 4).map((skillId) => skillDisplayToken(skillId, registry)),
    scenarioMarkdown: draft.scenarioMarkdown,
  };
}

export function scenarioBuilderRecommendationReasons(
  input: ScenarioBuilderRecommendationInput,
  registry: ElementRegistry = elementRegistry,
) {
  const domain = input.selection.skillDomain ?? input.scenario.skillDomain;
  const fallbackDisplay = componentPolicyDisplay(input.scenario.fallbackComponent, registry);
  return [
    `skill domain ${domain} 决定默认 skill/tool/profile 搜索空间。`,
    `${input.selection.selectedSkillIds.length} 个 skill 覆盖 ${input.selection.selectedArtifactTypes.length} 个 artifact contract。`,
    `${input.uiSlotCount} 个 UI slot 由已选 artifact consumer 自动编译；未匹配 artifact 交给 ${fallbackDisplay.label} (${fallbackDisplay.componentId})。`,
    `${input.skillStepCount} 个 skill step 会进入 package metadata，便于后续 diff 和复现。`,
  ];
}

export function scenarioBuilderComponentDisplay(
  componentId: string,
  registry: ElementRegistry = elementRegistry,
): ScenarioBuilderComponentDisplay {
  const component = registry.components.find((item) => item.componentId === componentId);
  if (!component) {
    const display = componentPolicyDisplay(undefined, registry);
    return {
      label: componentId,
      detail: `未注册组件将按 ${display.label} (${display.componentId}) 的 package manifest policy 处理。`,
      meta: `producer/consumer unknown · package policy ${display.componentId}`,
    };
  }

  return {
    label: component.label,
    detail: component.description,
    meta: componentManifestMeta(component),
  };
}

export function scenarioBuilderComponentSelectorOptions(
  components: UIComponentElement[],
  registry: ElementRegistry = elementRegistry,
): ScenarioBuilderElementSelectorOption[] {
  return components.map((component) => {
    const display = scenarioBuilderComponentDisplay(component.componentId, registry);
    return {
      id: component.componentId,
      label: display.label,
      detail: display.detail,
      meta: display.meta,
    };
  });
}

function componentPolicyDisplay(componentId: string | undefined, registry: ElementRegistry) {
  const component = componentId
    ? registry.components.find((item) => item.componentId === componentId)
    : undefined;
  const fallbackComponent = component
    ?? registry.components.find((item) => item.componentId === 'unknown-artifact-inspector')
    ?? registry.components.find((item) => item.acceptsArtifactTypes.includes('*'))
    ?? registry.components[0];
  return {
    componentId: fallbackComponent?.componentId ?? componentId ?? 'unregistered-component',
    label: fallbackComponent?.label ?? componentId ?? 'Unregistered component',
  };
}

function componentDisplayToken(componentId: string, registry: ElementRegistry): ScenarioDisplayToken {
  const display = scenarioBuilderComponentDisplay(componentId, registry);
  return { id: componentId, label: display.label, detail: display.detail };
}

function artifactDisplayToken(artifactType: string, registry: ElementRegistry): ScenarioDisplayToken {
  const artifact = registry.artifacts.find((item: ArtifactSchemaElement) => item.artifactType === artifactType);
  const scenarioArtifact = scenarioArtifactForType(artifactType);
  return {
    id: artifactType,
    label: artifact?.label !== artifactType ? artifact?.label ?? scenarioArtifact?.description ?? artifactType : scenarioArtifact?.description ?? artifactType,
    detail: (artifact?.fields ?? scenarioArtifact?.fields)?.map((field) => field.key).join(', '),
  };
}

function scenarioArtifactForType(artifactType: string): ScenarioArtifactSchema | undefined {
  for (const spec of Object.values(SCENARIO_SPECS)) {
    const match = (spec.outputArtifacts as readonly ScenarioArtifactSchema[]).find((item) => item.type === artifactType);
    if (match) return match;
  }
  return undefined;
}

function skillDisplayToken(skillId: string, registry: ElementRegistry): ScenarioDisplayToken {
  const skill = registry.skills.find((item: SkillElement) => item.id === skillId);
  return {
    id: skillId,
    label: skill?.label ?? skillId,
    detail: skill?.description,
  };
}

function componentManifestMeta(component: UIComponentElement) {
  const accepted = component.acceptsArtifactTypes.join(', ') || '*';
  const consumes = component.consumes.join(', ') || 'none';
  const fallbackPolicy = component.fallback || 'component manifest default';
  return `accepts ${accepted} · consumes ${consumes} · fallback ${fallbackPolicy}`;
}

function extractSensitiveWorkspaceRefs(json: string, workspacePath: string) {
  const refs = new Set<string>();
  const normalizedWorkspace = workspacePath.trim();
  if (normalizedWorkspace && json.includes(normalizedWorkspace)) refs.add(normalizedWorkspace);
  const pathPattern = /(?:\/Users\/|\/Applications\/workspace\/|[A-Za-z]:\\)[^"',\s)]+/g;
  for (const match of json.matchAll(pathPattern)) {
    refs.add(match[0]);
  }
  return Array.from(refs).slice(0, 12);
}
