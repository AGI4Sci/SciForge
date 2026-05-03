import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileCode, FilePlus, Play } from 'lucide-react';
import { type ScenarioId } from '../data';
import { SCENARIO_SPECS, componentManifest } from '../scenarioSpecs';
import {
  buildScenarioQualityReport,
  compileScenarioIRFromSelection,
  elementRegistry,
  recommendScenarioElements,
  runScenarioRuntimeSmoke,
  scenarioIdBySkillDomain,
  type ScenarioBuilderDraft,
  type ScenarioElementSelection,
  type ScenarioPackage,
} from '../../../../packages/scenario-core';
import { saveWorkspaceScenario, publishWorkspaceScenario } from '../api/workspaceClient';
import type { BioAgentConfig, ScenarioRuntimeOverride } from '../domain';
import type { RuntimeHealthItem } from '../runtimeHealth';
import { exportJsonFile } from './exportUtils';
import { ActionButton, Badge, cx } from './uiPrimitives';

export function ScenarioBuilderPanel({
  scenarioId,
  scenario,
  config,
  runtimeHealth,
  expanded,
  onToggle,
  onChange,
}: {
  scenarioId: ScenarioId;
  scenario: ScenarioRuntimeOverride;
  config: BioAgentConfig;
  runtimeHealth: RuntimeHealthItem[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (override: ScenarioRuntimeOverride) => void;
}) {
  const initialSelection = useMemo(() => defaultElementSelectionForScenario(scenarioId, scenario), [scenarioId]);
  const [selection, setSelection] = useState<ScenarioElementSelection>(initialSelection);
  const [builderStep, setBuilderStep] = useState<'describe' | 'elements' | 'contract' | 'quality' | 'publish'>('describe');
  const [previewTab, setPreviewTab] = useState<'scenario' | 'skill' | 'ui' | 'validation'>('scenario');
  const [advancedPreviewOpen, setAdvancedPreviewOpen] = useState(false);
  const [publishStatus, setPublishStatus] = useState('');
  useEffect(() => {
    setSelection(initialSelection);
  }, [initialSelection]);
  const componentOptions = prioritizeBySelectionAndDomain(
    elementRegistry.components,
    selection.selectedComponentIds ?? [],
    selection.skillDomain ?? scenario.skillDomain,
    (component) => component.componentId,
  );
  const compileResult = useMemo(() => compileScenarioIRFromSelection(selection), [selection]);
  const qualityReport = useMemo(() => buildScenarioQualityReport({
    package: compileResult.package,
    validationReport: compileResult.validationReport,
    runtimeHealth,
  }), [compileResult, runtimeHealth]);
  const qualityCounts = useMemo(() => ({
    blocking: qualityReport.items.filter((item) => item.severity === 'blocking').length,
    warning: qualityReport.items.filter((item) => item.severity === 'warning').length,
    note: qualityReport.items.filter((item) => item.severity === 'note').length,
  }), [qualityReport]);
  const skillOptions = prioritizeBySelectionAndDomain(
    elementRegistry.skills,
    selection.selectedSkillIds,
    selection.skillDomain ?? scenario.skillDomain,
    (skill) => skill.id,
  );
  const artifactOptions = prioritizeBySelectionAndDomain(
    elementRegistry.artifacts,
    selection.selectedArtifactTypes,
    selection.skillDomain ?? scenario.skillDomain,
    (artifact) => artifact.artifactType,
  );
  const toolOptions = prioritizeBySelectionAndDomain(
    elementRegistry.tools,
    selection.selectedToolIds ?? [],
    selection.skillDomain ?? scenario.skillDomain,
    (tool) => tool.id,
  );
  const recommendationReasons = builderRecommendationReasons(selection, scenario, compileResult.uiPlan.slots.length, compileResult.skillPlan.skillIRs.length);
  function patch(patchValue: Partial<ScenarioRuntimeOverride>) {
    onChange({ ...scenario, ...patchValue });
  }
  function patchSelection(patchValue: Partial<ScenarioElementSelection>) {
    setSelection((current) => ({ ...current, ...patchValue }));
  }
  function toggleComponent(component: string) {
    const next = scenario.defaultComponents.includes(component)
      ? scenario.defaultComponents.filter((item) => item !== component)
      : [...scenario.defaultComponents, component];
    patchSelection({ selectedComponentIds: toggleList(selection.selectedComponentIds ?? [], component) });
    patch({
      defaultComponents: next.length ? next : [scenario.fallbackComponent],
      allowedComponents: Array.from(new Set([...scenario.allowedComponents, component])),
    });
  }
  function setSelectedComponents(ids: string[]) {
    const next = unique(ids.length ? ids : [scenario.fallbackComponent]);
    patchSelection({ selectedComponentIds: next });
    patch({
      defaultComponents: next,
      allowedComponents: Array.from(new Set([...scenario.allowedComponents, ...next])),
    });
  }
  function toggleSelectionList(key: 'selectedSkillIds' | 'selectedToolIds' | 'selectedArtifactTypes' | 'selectedFailurePolicyIds', value: string) {
    setSelection((current) => ({
      ...current,
      [key]: toggleList((current[key] ?? []) as string[], value),
    }));
  }
  function setSelectionList(key: 'selectedSkillIds' | 'selectedToolIds' | 'selectedArtifactTypes' | 'selectedFailurePolicyIds', values: string[]) {
    setSelection((current) => ({ ...current, [key]: unique(values) }));
  }
  async function saveCompiled(status: 'draft' | 'published') {
    try {
      setPublishStatus(status === 'draft' ? '保存中...' : '发布中...');
      const smoke = await runScenarioRuntimeSmoke({ package: compileResult.package, mode: 'dry-run' });
      const quality = buildScenarioQualityReport({
        package: compileResult.package,
        validationReport: smoke.validationReport,
        runtimeSmoke: smoke,
        runtimeHealth,
      });
      const pkg = {
        ...compileResult.package,
        status,
        metadata: {
          ...(compileResult.package as ScenarioPackage & { metadata?: Record<string, unknown> }).metadata,
          recommendationReasons,
          compiledFrom: {
            builderStep,
            skillDomain: selection.skillDomain ?? scenario.skillDomain,
            selectedSkillIds: selection.selectedSkillIds,
            selectedToolIds: selection.selectedToolIds,
            selectedComponentIds: selection.selectedComponentIds,
            selectedArtifactTypes: selection.selectedArtifactTypes,
          },
        },
        validationReport: smoke.validationReport,
        qualityReport: quality,
      };
      if (status === 'published') {
        if (!quality.ok) {
          setPublishStatus('quality gate blocking errors，已保持为 draft。');
          await saveWorkspaceScenario(config, { ...pkg, status: 'draft' });
          return;
        }
        await publishWorkspaceScenario(config, pkg);
      } else {
        await saveWorkspaceScenario(config, pkg);
      }
      setPublishStatus(status === 'draft' ? '已保存 draft 到 workspace。' : '已发布到 workspace scenario library。');
    } catch (error) {
      setPublishStatus(error instanceof Error ? error.message : String(error));
    }
  }
  const previewJson = previewTab === 'scenario'
    ? compileResult.scenario
    : previewTab === 'skill'
      ? compileResult.skillPlan
      : previewTab === 'ui'
        ? compileResult.uiPlan
        : compileResult.validationReport;
  return (
    <section className={cx('scenario-settings', expanded && 'expanded')}>
      <button className="scenario-settings-summary" onClick={onToggle}>
        <FileCode size={16} />
        <span>Scenario Builder</span>
        <strong>{scenario.skillDomain}</strong>
        <em>{compileResult.package.id}@{compileResult.package.version} · {compileResult.validationReport.ok ? 'valid' : 'needs fixes'}</em>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded ? (
        <div className="scenario-settings-body">
          <div className="builder-stepper" aria-label="Scenario Builder steps">
            {[
              ['describe', '需求描述'],
              ['elements', '推荐元素'],
              ['contract', '编辑契约'],
              ['quality', '质量检查'],
              ['publish', '发布运行'],
            ].map(([id, label], index) => (
              <button key={id} className={cx(builderStep === id && 'active')} onClick={() => setBuilderStep(id as typeof builderStep)}>
                <span>{index + 1}</span>
                {label}
              </button>
            ))}
          </div>
          <div className={cx('builder-step-panel', builderStep !== 'describe' && 'muted')}>
            <label>
              <span>场景名称</span>
              <input
                value={scenario.title}
                onChange={(event) => {
                  patch({ title: event.target.value });
                  patchSelection({ title: event.target.value });
                }}
              />
            </label>
            <label className="wide">
              <span>场景描述</span>
              <input
                value={scenario.description}
                onChange={(event) => {
                  patch({ description: event.target.value });
                  patchSelection({ description: event.target.value });
                }}
              />
            </label>
          </div>
          <div className={cx('builder-step-panel', builderStep !== 'elements' && 'muted')}>
            <ElementSelector
              title="Components"
              options={componentOptions.map((component) => {
                const popover = componentElementPopover(component.componentId);
                return {
                  id: component.componentId,
                  label: component.label,
                  detail: component.description,
                  meta: popover.meta,
                };
              })}
              selected={scenario.defaultComponents}
              onToggle={toggleComponent}
              onSelectMany={(ids) => setSelectedComponents(unique([...scenario.defaultComponents, ...ids]))}
              onClearMany={(ids) => setSelectedComponents(scenario.defaultComponents.filter((id) => !ids.includes(id)))}
            />
            <ElementSelector
              title="Skills"
              options={skillOptions.map((skill) => ({
                id: skill.id,
                label: skill.label,
                detail: skill.description,
                meta: `produces ${skill.outputArtifactTypes.join(', ') || 'runtime artifacts'} · ${skill.requiredCapabilities.map((item) => `${item.capability}:${item.level}`).join(', ') || 'no extra capability profile'}`,
              }))}
              selected={selection.selectedSkillIds}
              onToggle={(id) => toggleSelectionList('selectedSkillIds', id)}
              onSelectMany={(ids) => setSelectionList('selectedSkillIds', [...selection.selectedSkillIds, ...ids])}
              onClearMany={(ids) => setSelectionList('selectedSkillIds', selection.selectedSkillIds.filter((id) => !ids.includes(id)))}
            />
            <ElementSelector
              title="Tools"
              options={toolOptions.map((tool) => ({
                id: tool.id,
                label: tool.label,
                detail: tool.description,
                meta: `${tool.toolType} · produces ${(tool.producesArtifactTypes ?? []).join(', ') || 'supporting runtime data'}`,
              }))}
              selected={selection.selectedToolIds ?? []}
              onToggle={(id) => toggleSelectionList('selectedToolIds', id)}
              onSelectMany={(ids) => setSelectionList('selectedToolIds', [...(selection.selectedToolIds ?? []), ...ids])}
              onClearMany={(ids) => setSelectionList('selectedToolIds', (selection.selectedToolIds ?? []).filter((id) => !ids.includes(id)))}
            />
            <ElementSelector
              title="Artifacts"
              options={artifactOptions.map((artifact) => ({
                id: artifact.artifactType,
                label: artifact.label,
                detail: artifact.description,
                meta: `producer ${artifact.producerSkillIds.join(', ') || 'none'} · consumer ${artifact.consumerComponentIds.join(', ') || 'none'} · handoff ${artifact.handoffTargets.join(', ') || 'none'}`,
              }))}
              selected={selection.selectedArtifactTypes}
              onToggle={(id) => toggleSelectionList('selectedArtifactTypes', id)}
              onSelectMany={(ids) => setSelectionList('selectedArtifactTypes', [...selection.selectedArtifactTypes, ...ids])}
              onClearMany={(ids) => setSelectionList('selectedArtifactTypes', selection.selectedArtifactTypes.filter((id) => !ids.includes(id)))}
            />
            <ElementSelector
              title="Failure policies"
              options={elementRegistry.failurePolicies.map((policy) => ({
                id: policy.id,
                label: policy.label,
                detail: policy.description,
                meta: `fallback ${policy.fallbackComponentId} · ${policy.recoverActions.join(', ')}`,
              }))}
              selected={selection.selectedFailurePolicyIds ?? []}
              onToggle={(id) => toggleSelectionList('selectedFailurePolicyIds', id)}
              onSelectMany={(ids) => setSelectionList('selectedFailurePolicyIds', [...(selection.selectedFailurePolicyIds ?? []), ...ids])}
              onClearMany={(ids) => setSelectionList('selectedFailurePolicyIds', (selection.selectedFailurePolicyIds ?? []).filter((id) => !ids.includes(id)))}
            />
          </div>
          <div className={cx('builder-step-panel', builderStep !== 'contract' && 'muted')}>
            <label className="wide">
              <span>Scenario markdown</span>
              <textarea
                value={scenario.scenarioMarkdown}
                onChange={(event) => {
                  patch({ scenarioMarkdown: event.target.value });
                  patchSelection({ scenarioMarkdown: event.target.value });
                }}
              />
            </label>
          </div>
          <div className="builder-recommendation-summary">
            <strong>推荐组合</strong>
            <span>基于 skill domain={selection.skillDomain ?? scenario.skillDomain}，当前会生成 {compileResult.uiPlan.slots.length} 个 UI slot、{compileResult.skillPlan.skillIRs.length} 个 skill step。</span>
            <span>发布前会检查 producer/consumer、fallback、runtime profile 和 package quality gate。</span>
            <ul>
              {recommendationReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
          <div className={cx('scenario-preview-panel', builderStep !== 'contract' && 'muted')}>
            <button className="advanced-preview-toggle" onClick={() => setAdvancedPreviewOpen((value) => !value)}>
              {advancedPreviewOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              {advancedPreviewOpen ? '收起高级 JSON contract' : '展开高级 JSON contract'}
            </button>
            {advancedPreviewOpen ? (
              <>
                <div className="scenario-preview-tabs">
                  {(['scenario', 'skill', 'ui', 'validation'] as const).map((tab) => (
                    <button key={tab} className={cx(previewTab === tab && 'active')} onClick={() => setPreviewTab(tab)}>{tab}</button>
                  ))}
                </div>
                <pre className="inspector-json">{JSON.stringify(previewJson, null, 2)}</pre>
              </>
            ) : null}
          </div>
          <div className={cx('manifest-diagnostics', builderStep !== 'quality' && 'muted')}>
            <strong>Quality gate</strong>
            <span><Badge variant={qualityCounts.blocking ? 'danger' : 'success'}>{qualityCounts.blocking} blocking</Badge></span>
            <span><Badge variant={qualityCounts.warning ? 'warning' : 'muted'}>{qualityCounts.warning} warning</Badge></span>
            <span><Badge variant="info">{qualityCounts.note} note</Badge></span>
            <code>{qualityReport.items.slice(0, 3).map((item) => `${item.severity}:${item.code}`).join(' · ') || 'ready'}</code>
          </div>
          <div className={cx('scenario-publish-row', builderStep !== 'publish' && 'muted')}>
            <div>
              <Badge variant={compileResult.validationReport.ok ? 'success' : 'warning'}>
                {compileResult.validationReport.ok ? 'validation ok' : `${compileResult.validationReport.issues.length} issues`}
              </Badge>
              {publishStatus ? <span>{publishStatus}</span> : null}
            </div>
            <div>
              <ActionButton icon={FilePlus} variant="secondary" onClick={() => void saveCompiled('draft')}>保存 draft</ActionButton>
              <ActionButton icon={Play} disabled={!compileResult.validationReport.ok} onClick={() => void saveCompiled('published')}>发布</ActionButton>
              {publishStatus.includes('已发布') ? <ActionButton icon={Download} variant="secondary" onClick={() => exportJsonFile(`${compileResult.package.id}-${compileResult.package.version}.scenario-package.json`, compileResult.package)}>导出 package</ActionButton> : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function defaultElementSelectionForScenario(scenarioId: ScenarioId, scenario: ScenarioRuntimeOverride): ScenarioElementSelection {
  const spec = SCENARIO_SPECS[scenarioId];
  const compiledHints = scenario as ScenarioRuntimeOverride & Partial<Pick<ScenarioBuilderDraft, 'recommendedSkillIds' | 'recommendedArtifactTypes' | 'recommendedComponentIds'>>;
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
    selectedSkillIds: compiledHints.recommendedSkillIds?.length
      ? compiledHints.recommendedSkillIds
      : recommendation.selectedSkillIds.length
      ? recommendation.selectedSkillIds
      : [`agentserver.generate.${scenario.skillDomain}`],
    selectedToolIds: recommendation.selectedToolIds.length
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

export function scenarioPackageToOverride(pkg: { scenario: { title: string; description: string; skillDomain: ScenarioRuntimeOverride['skillDomain']; scenarioMarkdown: string; selectedComponentIds: string[]; fallbackComponentId: string } }): ScenarioRuntimeOverride {
  const base = SCENARIO_SPECS[scenarioIdBySkillDomain[pkg.scenario.skillDomain]];
  const defaultComponents = pkg.scenario.selectedComponentIds.length ? pkg.scenario.selectedComponentIds : base.componentPolicy.defaultComponents;
  const packageLike = pkg as { id?: string; version?: string; skillPlan?: { id?: string }; uiPlan?: { id?: string } };
  return {
    title: pkg.scenario.title,
    description: pkg.scenario.description,
    skillDomain: pkg.scenario.skillDomain,
    scenarioMarkdown: pkg.scenario.scenarioMarkdown,
    defaultComponents,
    allowedComponents: Array.from(new Set([...base.componentPolicy.allowedComponents, ...defaultComponents])),
    fallbackComponent: pkg.scenario.fallbackComponentId || base.componentPolicy.fallbackComponent,
    scenarioPackageRef: packageLike.id && packageLike.version ? { id: packageLike.id, version: packageLike.version, source: 'workspace' } : undefined,
    skillPlanRef: packageLike.skillPlan?.id,
    uiPlanRef: packageLike.uiPlan?.id,
  };
}

function toggleList(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function unique(values: string[]) {
  return Array.from(new Set(values)).filter(Boolean);
}

function prioritizeBySelectionAndDomain<T extends { label?: string; id: string; tags?: string[]; skillDomains?: string[] }>(
  values: T[],
  selectedIds: string[],
  domain: ScenarioRuntimeOverride['skillDomain'],
  idForItem: (item: T) => string,
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

function builderRecommendationReasons(
  selection: ScenarioElementSelection,
  scenario: ScenarioRuntimeOverride,
  uiSlotCount: number,
  skillStepCount: number,
) {
  const domain = selection.skillDomain ?? scenario.skillDomain;
  return [
    `skill domain ${domain} 决定默认 skill/tool/profile 搜索空间。`,
    `${selection.selectedSkillIds.length} 个 skill 覆盖 ${selection.selectedArtifactTypes.length} 个 artifact contract。`,
    `${uiSlotCount} 个 UI slot 由已选 artifact consumer 自动编译，fallback=${scenario.fallbackComponent}。`,
    `${skillStepCount} 个 skill step 会进入 package metadata，便于后续 diff 和复现。`,
  ];
}

function componentElementPopover(componentId: string) {
  const component = elementRegistry.components.find((item) => item.componentId === componentId);
  if (!component) {
    return {
      label: componentId,
      detail: '未注册组件会使用 unknown-artifact-inspector fallback。',
      meta: 'producer/consumer unknown · fallback unknown-artifact-inspector',
    };
  }
  return {
    label: component.label,
    detail: component.description,
    meta: `accepts ${component.acceptsArtifactTypes.join(', ') || '*'} · fields ${component.requiredFields.join(', ') || 'none'} · fallback ${component.fallback}`,
  };
}

function ElementPopover({ label, detail, meta }: { label: string; detail: string; meta: string }) {
  return (
    <span className="element-popover" role="tooltip">
      <strong>{label}</strong>
      <small>{detail}</small>
      <em>{meta}</em>
    </span>
  );
}

function ElementSelector({
  title,
  options,
  selected,
  onToggle,
  onSelectMany,
  onClearMany,
}: {
  title: string;
  options: Array<{ id: string; label: string; detail?: string; meta?: string }>;
  selected: string[];
  onToggle: (id: string) => void;
  onSelectMany?: (ids: string[]) => void;
  onClearMany?: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [excluded, setExcluded] = useState<string[]>([]);
  const [bodyOpen, setBodyOpen] = useState(true);
  const bodyId = useId();
  const visibleOptions = useMemo(() => {
    const excludedSet = new Set(excluded);
    return fuzzyFilterOptions(options, query)
      .filter((option) => !excludedSet.has(option.id));
  }, [excluded, options, query]);
  const visibleIds = visibleOptions.map((option) => option.id);
  const selectedCount = selected.length;
  const excludedVisibleCount = excluded.length;
  return (
    <div className={cx('element-selector', !bodyOpen && 'collapsed')}>
      <div className="element-selector-top">
        <button
          type="button"
          className="element-selector-collapse"
          aria-expanded={bodyOpen}
          aria-controls={bodyId}
          title={bodyOpen ? '收起列表' : '展开列表'}
          onClick={() => setBodyOpen((value) => !value)}
        >
          {bodyOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>
        <div className="element-selector-title-block">
          <span>{title}</span>
          <small>{selectedCount} selected · {visibleOptions.length}/{options.length} shown{excludedVisibleCount ? ` · ${excludedVisibleCount} excluded` : ''}</small>
        </div>
      </div>
      {bodyOpen ? (
        <>
          <div className="element-selector-controls">
            <label className="element-selector-search">
              <span>搜索</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="名称、说明、artifact、capability..."
              />
            </label>
            <div className="element-selector-actions">
              <button type="button" onClick={() => onSelectMany?.(visibleIds)} disabled={!visibleIds.length}>选中当前</button>
              <button type="button" onClick={() => onClearMany?.(visibleIds)} disabled={!visibleIds.length}>取消当前</button>
              <button type="button" onClick={() => setExcluded((current) => unique([...current, ...visibleIds]))} disabled={!visibleIds.length}>排除当前</button>
              <button type="button" onClick={() => setExcluded([])} disabled={!excluded.length}>恢复排除</button>
            </div>
          </div>
          <div id={bodyId} className="element-selector-table" role="list" aria-label={`${title} registry`}>
        {visibleOptions.map((option) => {
          const isSelected = selected.includes(option.id);
          return (
            <article key={option.id} className={cx('element-selector-row', isSelected && 'selected')} role="listitem">
              <label>
                <input type="checkbox" checked={isSelected} onChange={() => onToggle(option.id)} />
                <span className="element-selector-name">
                  <strong>{option.id}</strong>
                  <small>{option.label}</small>
                </span>
              </label>
              <p>{option.detail ?? option.id}</p>
              <details>
                <summary>详细</summary>
                <em>{option.meta ?? 'no additional profile'}</em>
              </details>
              <button type="button" className="element-selector-exclude" onClick={() => setExcluded((current) => unique([...current, option.id]))}>
                排除
              </button>
            </article>
          );
        })}
            {!visibleOptions.length ? (
              <div className="element-selector-empty">没有匹配项。可以清空搜索或恢复排除。</div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function fuzzyFilterOptions(options: Array<{ id: string; label: string; detail?: string; meta?: string }>, query: string) {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return options;
  return options
    .map((option) => ({ option, score: fuzzyScore([option.id, option.label, option.detail, option.meta].filter(Boolean).join(' '), tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.option.id.localeCompare(right.option.id))
    .map((item) => item.option);
}

function fuzzyScore(text: string, tokens: string[]) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      score += token.length * 8;
      continue;
    }
    let cursor = 0;
    let matched = 0;
    for (const char of token) {
      const next = lower.indexOf(char, cursor);
      if (next < 0) break;
      matched += 1;
      cursor = next + 1;
    }
    if (matched < Math.ceil(token.length * 0.7)) return 0;
    score += matched;
  }
  return score;
}
