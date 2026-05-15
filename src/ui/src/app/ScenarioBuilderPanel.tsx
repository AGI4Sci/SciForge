import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { ChevronDown, ChevronUp, Download, FileCode, FilePlus, Play } from 'lucide-react';
import { type ScenarioId } from '../data';
import {
  buildScenarioQualityReport,
  compileScenarioIRFromSelection,
  elementRegistry,
  scenarioBuilderPackageForWorkspaceSave,
  scenarioBuilderChromeFallbackPane,
  scenarioBuilderChromeNavItems,
  scenarioBuilderChromePaneIds,
  scenarioBuilderComponentSelectorCopy,
  scenarioBuilderComponentSelectorOptions,
  scenarioBuilderPrioritizeBySelectionAndDomain,
  scenarioDefaultElementSelectionForRuntimeOverride,
  scenarioBuilderElementSelectorCopy,
  scenarioBuilderElementSelectorRegistryAriaLabel,
  scenarioBuilderElementSelectorSummary,
  scenarioBuilderQualityChecklistText,
  scenarioBuilderRecommendationReasons,
  scenarioPackageExportFileName,
  scenarioPackageToRuntimeOverride,
  scenarioPackageValidationSummary,
  type ScenarioBuilderChromePaneId,
  type ScenarioBuilderElementSelectorOption,
  type ScenarioElementSelection,
} from '@sciforge/scenario-core';
import {
  CORE_CAPABILITY_MANIFESTS,
  type CapabilityManifest,
} from '@sciforge-ui/runtime-contract';
import { webObserveCapabilityManifest } from '@sciforge-observe/web/manifest';
import { saveWorkspaceScenario, publishWorkspaceScenario } from '../api/workspaceClient';
import type { SciForgeConfig, ScenarioRuntimeOverride, ToolProviderRouteOverride, ToolProviderSource } from '../domain';
import type { RuntimeHealthItem } from '../runtimeHealth';
import { exportJsonFile } from './exportUtils';
import { ActionButton, Badge, cx } from './uiPrimitives';

type BuilderLegacyStepId = 'describe' | 'elements' | 'contract' | 'quality' | 'publish';

const toolProviderSourceOptions: ToolProviderSource[] = ['local', 'agentserver', 'mcp', 'http', 'ssh', 'client-worker', 'backend-native', 'package', 'workspace', 'external'];
const coreProviderCapabilityIds = ['web_search', 'web_fetch', 'pdf_extract'];

export function ScenarioBuilderPanel({
  scenarioId,
  scenario,
  config,
  runtimeHealth,
  expanded,
  onToggle,
  onChange,
  agentRuntimeComponentIds,
  onAgentRuntimeComponentIdsChange,
  chromeEmbedded,
}: {
  scenarioId: ScenarioId;
  scenario: ScenarioRuntimeOverride;
  config: SciForgeConfig;
  runtimeHealth: RuntimeHealthItem[];
  expanded: boolean;
  onToggle: () => void;
  onChange: (override: ScenarioRuntimeOverride) => void;
  /** When set (e.g. workbench), exposes AgentServer `availableComponentIds` as the same selectable component list as the scenario UI allowlist. */
  agentRuntimeComponentIds?: string[];
  onAgentRuntimeComponentIdsChange?: (ids: string[]) => void;
  /** Embedded shell: single toggle expands this panel body directly. */
  chromeEmbedded?: boolean;
}) {
  const initialSelection = useMemo(
    () => defaultElementSelectionForScenario(scenarioId, scenario),
    [
      scenarioId,
      scenario.skillDomain,
      scenario.defaultComponents,
      scenario.allowedComponents,
      scenario.selectedSkillIds,
      scenario.selectedToolIds,
    ],
  );
  const [selection, setSelection] = useState<ScenarioElementSelection>(initialSelection);
  const [legacyStep, setLegacyStep] = useState<BuilderLegacyStepId>('describe');
  const [chromePane, setChromePane] = useState<ScenarioBuilderChromePaneId>(scenarioBuilderChromePaneIds.sceneInfo);
  const describeSectionRef = useRef<HTMLElement>(null);
  const elementsSectionRef = useRef<HTMLElement>(null);
  const contractSectionRef = useRef<HTMLElement>(null);
  const qualitySectionRef = useRef<HTMLElement>(null);
  const publishSectionRef = useRef<HTMLElement>(null);
  const legacySectionRefs: Record<BuilderLegacyStepId, RefObject<HTMLElement | null>> = {
    describe: describeSectionRef,
    elements: elementsSectionRef,
    contract: contractSectionRef,
    quality: qualitySectionRef,
    publish: publishSectionRef,
  };
  const includeAgentRuntimeUi = Boolean(onAgentRuntimeComponentIdsChange);
  const chromeNavItems = useMemo(
    () => scenarioBuilderChromeNavItems({ includeAgentRuntimeUi }),
    [includeAgentRuntimeUi],
  );
  useEffect(() => {
    if (!chromeEmbedded) return;
    const nextPane = scenarioBuilderChromeFallbackPane({ pane: chromePane, includeAgentRuntimeUi });
    if (nextPane !== chromePane) setChromePane(nextPane);
  }, [chromeEmbedded, chromePane, includeAgentRuntimeUi]);
  function navigateLegacyStep(step: BuilderLegacyStepId) {
    setLegacyStep(step);
    requestAnimationFrame(() => {
      legacySectionRefs[step].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  function legacyStepMuted(step: BuilderLegacyStepId) {
    return legacyStep !== step;
  }
  const metadataBuilderStep = chromeEmbedded ? chromePane : legacyStep;
  const [previewTab, setPreviewTab] = useState<'scenario' | 'skill' | 'ui' | 'validation'>('scenario');
  const [advancedPreviewOpen, setAdvancedPreviewOpen] = useState(false);
  const [publishStatus, setPublishStatus] = useState('');
  useEffect(() => {
    setSelection(initialSelection);
  }, [initialSelection]);
  const componentOptions = scenarioBuilderPrioritizeBySelectionAndDomain(
    elementRegistry.components,
    selection.selectedComponentIds ?? [],
    selection.skillDomain ?? scenario.skillDomain,
    (component) => component.componentId,
  );
  const componentSelectorOptions = scenarioBuilderComponentSelectorOptions(componentOptions);
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
  const skillOptions = scenarioBuilderPrioritizeBySelectionAndDomain(
    elementRegistry.skills,
    selection.selectedSkillIds,
    selection.skillDomain ?? scenario.skillDomain,
    (skill) => skill.id,
  );
  const artifactOptions = scenarioBuilderPrioritizeBySelectionAndDomain(
    elementRegistry.artifacts,
    selection.selectedArtifactTypes,
    selection.skillDomain ?? scenario.skillDomain,
    (artifact) => artifact.artifactType,
  );
  const toolOptions = scenarioBuilderPrioritizeBySelectionAndDomain(
    elementRegistry.tools,
    selection.selectedToolIds ?? [],
    selection.skillDomain ?? scenario.skillDomain,
    (tool) => tool.id,
  );
  const recommendationReasons = scenarioBuilderRecommendationReasons({
    selection,
    scenario,
    uiSlotCount: compileResult.uiPlan.slots.length,
    skillStepCount: compileResult.skillPlan.skillIRs.length,
  });
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
  function patchRuntimeSelection(key: 'selectedSkillIds' | 'selectedToolIds', values: string[]) {
    patch(key === 'selectedSkillIds'
      ? { selectedSkillIds: unique(values) }
      : { selectedToolIds: unique(values) });
  }
  function toggleSelectionList(key: 'selectedSkillIds' | 'selectedToolIds' | 'selectedArtifactTypes' | 'selectedFailurePolicyIds', value: string) {
    const next = toggleList((selection[key] ?? []) as string[], value);
    setSelection((current) => ({
      ...current,
      [key]: key === 'selectedSkillIds' || key === 'selectedToolIds'
        ? next
        : toggleList((current[key] ?? []) as string[], value),
    }));
    if (key === 'selectedSkillIds' || key === 'selectedToolIds') patchRuntimeSelection(key, next);
  }
  function setSelectionList(key: 'selectedSkillIds' | 'selectedToolIds' | 'selectedArtifactTypes' | 'selectedFailurePolicyIds', values: string[]) {
    const next = unique(values);
    setSelection((current) => ({ ...current, [key]: next }));
    if (key === 'selectedSkillIds' || key === 'selectedToolIds') patchRuntimeSelection(key, next);
  }
  function toolProviderRouteFor(routeKey: string, fallback: ToolProviderRouteOverride) {
    return { ...fallback, ...(scenario.toolProviderRoutes?.[routeKey] ?? {}) };
  }
  function patchToolProviderRoute(routeKey: string, fallback: ToolProviderRouteOverride, routePatch: Partial<ToolProviderRouteOverride>) {
    const nextRoute = { ...toolProviderRouteFor(routeKey, fallback), ...routePatch };
    const routes = { ...(scenario.toolProviderRoutes ?? {}), [routeKey]: nextRoute };
    patch({ toolProviderRoutes: routes });
  }
  async function saveCompiled(status: 'draft' | 'published') {
    try {
      setPublishStatus(status === 'draft' ? '保存中...' : '发布中...');
      const quality = buildScenarioQualityReport({
        package: compileResult.package,
        validationReport: compileResult.validationReport,
        runtimeHealth,
      });
      const pkg = scenarioBuilderPackageForWorkspaceSave({
        package: compileResult.package,
        status,
        validationReport: compileResult.validationReport,
        qualityReport: quality,
        recommendationReasons,
        builderStep: metadataBuilderStep,
        selection,
        fallbackSkillDomain: scenario.skillDomain,
      });
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

  function DescribeFields() {
    return (
      <>
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
      </>
    );
  }

  function AgentRuntimeUiSelector() {
    if (!onAgentRuntimeComponentIdsChange) return null;
    return (
      <ElementSelector
        title={scenarioBuilderComponentSelectorCopy.agentRuntimeUi.title}
        description={scenarioBuilderComponentSelectorCopy.agentRuntimeUi.description}
        options={componentSelectorOptions}
        selected={agentRuntimeComponentIds ?? []}
        onToggle={(id) => {
          const current = agentRuntimeComponentIds ?? [];
          const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
          onAgentRuntimeComponentIdsChange(unique(next));
        }}
        onSelectMany={(ids) => onAgentRuntimeComponentIdsChange(unique([...(agentRuntimeComponentIds ?? []), ...ids]))}
        onClearMany={(ids) => onAgentRuntimeComponentIdsChange((agentRuntimeComponentIds ?? []).filter((item) => !ids.includes(item)))}
      />
    );
  }

  function ScenarioPackageUiSelector() {
    return (
      <ElementSelector
        title={scenarioBuilderComponentSelectorCopy.scenarioPackageUi.title}
        description={scenarioBuilderComponentSelectorCopy.scenarioPackageUi.description}
        options={componentSelectorOptions}
        selected={scenario.defaultComponents}
        onToggle={toggleComponent}
        onSelectMany={(ids) => setSelectedComponents(unique([...scenario.defaultComponents, ...ids]))}
        onClearMany={(ids) => setSelectedComponents(scenario.defaultComponents.filter((id) => !ids.includes(id)))}
      />
    );
  }

  function SkillsSelector() {
    return (
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
    );
  }

  function ToolsSelector() {
    const selectedToolOptions = toolOptions.filter((tool) => (selection.selectedToolIds ?? []).includes(tool.id));
    return (
      <div className="tools-pane-layout">
        <div className="tools-pane-list">
          <ElementSelector
            title="Tools"
            options={toolOptions.map((tool) => {
              const route = toolProviderRouteFor(tool.id, defaultToolProviderRouteForTool(tool));
              return {
                id: tool.id,
                label: tool.label,
                detail: tool.description,
                meta: [
                  `${tool.toolType} · produces ${(tool.producesArtifactTypes ?? []).join(', ') || 'supporting runtime data'}`,
                  `provider ${route.source ?? 'package'}:${route.primaryProviderId ?? tool.id}`,
                  route.requiredConfig?.length ? `requires ${route.requiredConfig.join(', ')}` : 'no provider config required',
                ].join(' · '),
              };
            })}
            selected={selection.selectedToolIds ?? []}
            onToggle={(id) => toggleSelectionList('selectedToolIds', id)}
            onSelectMany={(ids) => setSelectionList('selectedToolIds', [...(selection.selectedToolIds ?? []), ...ids])}
            onClearMany={(ids) => setSelectionList('selectedToolIds', (selection.selectedToolIds ?? []).filter((id) => !ids.includes(id)))}
          />
        </div>
        <div className="tools-provider-column">
          <ToolProviderRouteEditor
            title="Selected tool providers"
            description="当前选中工具的本场景 provider route。"
            emptyLabel="选中工具后可配置它的 provider route。"
            routes={selectedToolOptions.map((tool) => ({
              key: tool.id,
              label: tool.label,
              detail: tool.description,
              fallback: defaultToolProviderRouteForTool(tool),
            }))}
          />
          <ToolProviderRouteEditor
            title="Core capability providers"
            description="跨机器能力 route，例如 AgentServer 端 web_search/web_fetch。"
            routes={coreProviderCapabilityIds.map((capabilityId) => {
              const manifest = defaultRouteManifestForCapability(capabilityId);
              return {
                key: capabilityId,
                label: manifest?.name ?? capabilityId,
                detail: manifest?.brief ?? capabilityId,
                fallback: defaultToolProviderRouteForCapability(capabilityId),
              };
            })}
          />
        </div>
      </div>
    );
  }

  function ToolProviderRouteEditor({
    title,
    description,
    emptyLabel,
    routes,
  }: {
    title: string;
    description: string;
    emptyLabel?: string;
    routes: Array<{ key: string; label: string; detail: string; fallback: ToolProviderRouteOverride }>;
  }) {
    return (
      <section className="tool-provider-route-editor" aria-label={title}>
        <div className="tool-provider-route-heading">
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
          <small>{routes.length} routes</small>
        </div>
        {routes.length ? (
          <div className="tool-provider-route-list">
            {routes.map((routeInfo) => {
              const route = toolProviderRouteFor(routeInfo.key, routeInfo.fallback);
              return (
                <article key={routeInfo.key} className="tool-provider-route-card">
                  <div className="tool-provider-route-title">
                    <div>
                      <strong>{routeInfo.key}</strong>
                      <span>{routeInfo.label}</span>
                    </div>
                    <label>
                      <input
                        type="checkbox"
                        checked={route.enabled !== false}
                        onChange={(event) => patchToolProviderRoute(routeInfo.key, routeInfo.fallback, { enabled: event.target.checked })}
                      />
                      enabled
                    </label>
                  </div>
                  <p>{routeInfo.detail}</p>
                  <div className="tool-provider-route-grid">
                    <label>
                      <span>source</span>
                      <select
                        value={route.source ?? 'package'}
                        onChange={(event) => patchToolProviderRoute(routeInfo.key, routeInfo.fallback, { source: event.target.value as ToolProviderSource })}
                      >
                        {toolProviderSourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>primary provider</span>
                      <input
                        value={route.primaryProviderId ?? ''}
                        onChange={(event) => patchToolProviderRoute(routeInfo.key, routeInfo.fallback, { primaryProviderId: event.target.value.trim() })}
                        placeholder="sciforge.web-worker.web_search"
                      />
                    </label>
                    <label>
                      <span>fallback providers</span>
                      <input
                        value={(route.fallbackProviderIds ?? []).join(', ')}
                        onChange={(event) => patchToolProviderRoute(routeInfo.key, routeInfo.fallback, { fallbackProviderIds: csvList(event.target.value) })}
                        placeholder="provider.a, provider.b"
                      />
                    </label>
                    <label>
                      <span>health</span>
                      <select
                        value={route.health ?? 'ready'}
                        onChange={(event) => patchToolProviderRoute(routeInfo.key, routeInfo.fallback, { health: event.target.value as ToolProviderRouteOverride['health'] })}
                      >
                        <option value="ready">ready</option>
                        <option value="unknown">unknown</option>
                        <option value="unavailable">unavailable</option>
                        <option value="unauthorized">unauthorized</option>
                        <option value="rate-limited">rate-limited</option>
                      </select>
                    </label>
                  </div>
                  <small>
                    {route.requiredConfig?.length ? `requires ${route.requiredConfig.join(', ')}` : 'no required config'}
                    {route.permissions?.length ? ` · permissions ${route.permissions.join(', ')}` : ''}
                  </small>
                </article>
              );
            })}
          </div>
        ) : <div className="tool-provider-route-empty">{emptyLabel ?? 'No provider routes.'}</div>}
      </section>
    );
  }

  function ArtifactsSelector() {
    return (
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
    );
  }

  function FailurePoliciesSelector() {
    return (
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
    );
  }

  const bodyVisible = chromeEmbedded || expanded;
  return (
    <section className={cx('scenario-settings', bodyVisible && 'expanded', chromeEmbedded && 'scenario-settings-chrome-embedded')}>
      {chromeEmbedded ? (
        <div className="scenario-settings-chrome-heading">
          <FileCode size={16} />
          <span>Scenario Builder</span>
          <strong>{scenario.skillDomain}</strong>
          <em>{scenarioPackageValidationSummary(compileResult)}</em>
        </div>
      ) : (
        <button type="button" className="scenario-settings-summary" onClick={onToggle}>
          <FileCode size={16} />
          <span>Scenario Builder</span>
          <strong>{scenario.skillDomain}</strong>
          <em>{scenarioPackageValidationSummary(compileResult)}</em>
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
      {bodyVisible ? (
        chromeEmbedded ? (
          <div className="scenario-settings-body">
            <nav className="builder-chrome-nav" aria-label="Scenario Builder">
              {chromeNavItems.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className={cx('nav-item', chromePane === id && 'active')}
                  aria-current={chromePane === id ? 'page' : undefined}
                  onClick={() => setChromePane(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="builder-chrome-pane">
              {chromePane === scenarioBuilderChromePaneIds.sceneInfo ? (
                <div className="builder-step-panel">
                  <DescribeFields />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.agentRuntimeUi && onAgentRuntimeComponentIdsChange ? (
                <div className="builder-step-panel">
                  <AgentRuntimeUiSelector />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.scenarioPackageUi ? (
                <div className="builder-step-panel">
                  <ScenarioPackageUiSelector />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.skills ? (
                <div className="builder-step-panel">
                  <SkillsSelector />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.tools ? (
                <div className="builder-step-panel">
                  <ToolsSelector />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.artifacts ? (
                <div className="builder-step-panel">
                  <ArtifactsSelector />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.failurePolicies ? (
                <div className="builder-step-panel">
                  <FailurePoliciesSelector />
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.contract ? (
                <>
                  <div className="builder-step-panel">
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
                    <span>{scenarioBuilderQualityChecklistText}</span>
                    <ul>
                      {recommendationReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                  <div className="scenario-preview-panel">
                    <button type="button" className="advanced-preview-toggle" onClick={() => setAdvancedPreviewOpen((value) => !value)}>
                      {advancedPreviewOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      {advancedPreviewOpen ? '收起高级 JSON contract' : '展开高级 JSON contract'}
                    </button>
                    {advancedPreviewOpen ? (
                      <>
                        <div className="scenario-preview-tabs">
                          {(['scenario', 'skill', 'ui', 'validation'] as const).map((tab) => (
                            <button key={tab} type="button" className={cx(previewTab === tab && 'active')} onClick={() => setPreviewTab(tab)}>{tab}</button>
                          ))}
                        </div>
                        <pre className="inspector-json">{JSON.stringify(previewJson, null, 2)}</pre>
                      </>
                    ) : null}
                  </div>
                </>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.quality ? (
                <div className="manifest-diagnostics">
                  <strong>Quality gate</strong>
                  <span><Badge variant={qualityCounts.blocking ? 'danger' : 'success'}>{qualityCounts.blocking} blocking</Badge></span>
                  <span><Badge variant={qualityCounts.warning ? 'warning' : 'muted'}>{qualityCounts.warning} warning</Badge></span>
                  <span><Badge variant="info">{qualityCounts.note} note</Badge></span>
                  <code>{qualityReport.items.slice(0, 3).map((item) => `${item.severity}:${item.code}`).join(' · ') || 'ready'}</code>
                </div>
              ) : null}
              {chromePane === scenarioBuilderChromePaneIds.publish ? (
                <div className="scenario-publish-row">
                  <div>
                    <Badge variant={compileResult.validationReport.ok ? 'success' : 'warning'}>
                      {compileResult.validationReport.ok ? 'validation ok' : `${compileResult.validationReport.issues.length} issues`}
                    </Badge>
                    {publishStatus ? <span>{publishStatus}</span> : null}
                  </div>
                  <div>
                    <ActionButton icon={FilePlus} variant="secondary" onClick={() => void saveCompiled('draft')}>保存 draft</ActionButton>
                    <ActionButton icon={Play} disabled={!compileResult.validationReport.ok} onClick={() => void saveCompiled('published')}>发布</ActionButton>
                    {publishStatus.includes('已发布') ? <ActionButton icon={Download} variant="secondary" onClick={() => exportJsonFile(scenarioPackageExportFileName(compileResult.package), compileResult.package)}>导出 package</ActionButton> : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="scenario-settings-body">
            <div className="builder-stepper" aria-label="Scenario Builder steps">
              {([
                ['describe', '需求描述'],
                ['elements', '推荐元素'],
                ['contract', '编辑契约'],
                ['quality', '质量检查'],
                ['publish', '发布运行'],
              ] as const satisfies ReadonlyArray<readonly [BuilderLegacyStepId, string]>).map(([id, label], index) => (
                <button
                  key={id}
                  type="button"
                  className={cx(legacyStep === id && 'active')}
                  aria-current={legacyStep === id ? 'step' : undefined}
                  onClick={() => navigateLegacyStep(id)}
                >
                  <span>{index + 1}</span>
                  {label}
                </button>
              ))}
            </div>
            <section ref={describeSectionRef} className="builder-step-section" aria-label="需求描述">
              <div className={cx('builder-step-panel', legacyStepMuted('describe') && 'muted')}>
                <DescribeFields />
              </div>
            </section>
            <section ref={elementsSectionRef} className="builder-step-section" aria-label="推荐元素">
              <div className={cx('builder-step-panel', legacyStepMuted('elements') && 'muted')}>
                <AgentRuntimeUiSelector />
                <ScenarioPackageUiSelector />
                <SkillsSelector />
                <ToolsSelector />
                <ArtifactsSelector />
                <FailurePoliciesSelector />
              </div>
            </section>
            <section ref={contractSectionRef} className="builder-step-section" aria-label="编辑契约">
              <div className={cx('builder-step-panel', legacyStepMuted('contract') && 'muted')}>
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
              <div className={cx('builder-recommendation-summary', legacyStepMuted('contract') && 'muted')}>
                <strong>推荐组合</strong>
                <span>基于 skill domain={selection.skillDomain ?? scenario.skillDomain}，当前会生成 {compileResult.uiPlan.slots.length} 个 UI slot、{compileResult.skillPlan.skillIRs.length} 个 skill step。</span>
                <span>{scenarioBuilderQualityChecklistText}</span>
                <ul>
                  {recommendationReasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
              <div className={cx('scenario-preview-panel', legacyStepMuted('contract') && 'muted')}>
                <button type="button" className="advanced-preview-toggle" onClick={() => setAdvancedPreviewOpen((value) => !value)}>
                  {advancedPreviewOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  {advancedPreviewOpen ? '收起高级 JSON contract' : '展开高级 JSON contract'}
                </button>
                {advancedPreviewOpen ? (
                  <>
                    <div className="scenario-preview-tabs">
                      {(['scenario', 'skill', 'ui', 'validation'] as const).map((tab) => (
                        <button key={tab} type="button" className={cx(previewTab === tab && 'active')} onClick={() => setPreviewTab(tab)}>{tab}</button>
                      ))}
                    </div>
                    <pre className="inspector-json">{JSON.stringify(previewJson, null, 2)}</pre>
                  </>
                ) : null}
              </div>
            </section>
            <section ref={qualitySectionRef} className="builder-step-section" aria-label="质量检查">
              <div className={cx('manifest-diagnostics', legacyStepMuted('quality') && 'muted')}>
                <strong>Quality gate</strong>
                <span><Badge variant={qualityCounts.blocking ? 'danger' : 'success'}>{qualityCounts.blocking} blocking</Badge></span>
                <span><Badge variant={qualityCounts.warning ? 'warning' : 'muted'}>{qualityCounts.warning} warning</Badge></span>
                <span><Badge variant="info">{qualityCounts.note} note</Badge></span>
                <code>{qualityReport.items.slice(0, 3).map((item) => `${item.severity}:${item.code}`).join(' · ') || 'ready'}</code>
              </div>
            </section>
            <section ref={publishSectionRef} className="builder-step-section" aria-label="发布运行">
              <div className={cx('scenario-publish-row', legacyStepMuted('publish') && 'muted')}>
                <div>
                  <Badge variant={compileResult.validationReport.ok ? 'success' : 'warning'}>
                    {compileResult.validationReport.ok ? 'validation ok' : `${compileResult.validationReport.issues.length} issues`}
                  </Badge>
                  {publishStatus ? <span>{publishStatus}</span> : null}
                </div>
                <div>
                  <ActionButton icon={FilePlus} variant="secondary" onClick={() => void saveCompiled('draft')}>保存 draft</ActionButton>
                  <ActionButton icon={Play} disabled={!compileResult.validationReport.ok} onClick={() => void saveCompiled('published')}>发布</ActionButton>
                  {publishStatus.includes('已发布') ? <ActionButton icon={Download} variant="secondary" onClick={() => exportJsonFile(scenarioPackageExportFileName(compileResult.package), compileResult.package)}>导出 package</ActionButton> : null}
                </div>
              </div>
            </section>
          </div>
        )
      ) : null}
    </section>
  );
}

export function defaultElementSelectionForScenario(scenarioId: ScenarioId, scenario: ScenarioRuntimeOverride): ScenarioElementSelection {
  return scenarioDefaultElementSelectionForRuntimeOverride(scenarioId, scenario);
}

export function scenarioPackageToOverride(pkg: Parameters<typeof scenarioPackageToRuntimeOverride>[0]): ScenarioRuntimeOverride {
  return scenarioPackageToRuntimeOverride(pkg);
}

function toggleList(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function unique(values: string[]) {
  return Array.from(new Set(values)).filter(Boolean);
}

function csvList(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function defaultToolProviderRouteForTool(tool: {
  id: string;
  source?: string;
  toolType?: string;
  requiredConfig?: string[];
}): ToolProviderRouteOverride {
  const source = inferToolProviderSource(tool);
  return {
    enabled: true,
    source,
    primaryProviderId: tool.id,
    fallbackProviderIds: [],
    requiredConfig: tool.requiredConfig ?? [],
    permissions: toolProviderPermissions(tool.toolType),
    health: source === 'local' || source === 'package' ? 'ready' : 'unknown',
  };
}

export function defaultToolProviderRouteForCapability(capabilityId: string): ToolProviderRouteOverride {
  const manifest = defaultRouteManifestForCapability(capabilityId);
  const provider = manifest?.providers[0];
  return {
    enabled: true,
    capabilityId,
    source: provider?.source ?? 'agentserver',
    primaryProviderId: provider?.id ?? `sciforge.web-worker.${capabilityId}`,
    fallbackProviderIds: manifest?.providers.slice(1).map((candidate) => candidate.id) ?? [],
    requiredConfig: provider?.requiredConfig ?? [],
    permissions: provider?.permissions ?? [],
    health: provider?.status === 'available' ? 'ready' : 'unknown',
  };
}

function defaultRouteManifestForCapability(capabilityId: string): CapabilityManifest | undefined {
  return (webObserveCapabilityManifest(capabilityId) as CapabilityManifest | undefined)
    ?? CORE_CAPABILITY_MANIFESTS.find((candidate) => candidate.id === capabilityId);
}

function inferToolProviderSource(tool: { id: string; source?: string; toolType?: string }): ToolProviderSource {
  if (/^local\./i.test(tool.id) || tool.source === 'local') return 'local';
  if (/mcp/i.test(tool.id) || tool.toolType === 'connector') return 'mcp';
  if (/agentserver/i.test(tool.id)) return 'agentserver';
  return tool.source === 'package' ? 'package' : 'package';
}

function toolProviderPermissions(toolType?: string) {
  if (toolType === 'connector') return ['network'];
  if (toolType === 'runner') return ['filesystem', 'shell'];
  if (toolType === 'sense-plugin') return ['desktop'];
  return [];
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
  description,
  options,
  selected,
  onToggle,
  onSelectMany,
  onClearMany,
}: {
  title: string;
  description?: string;
  options: ScenarioBuilderElementSelectorOption[];
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
          title={bodyOpen ? scenarioBuilderElementSelectorCopy.collapseOpenTitle : scenarioBuilderElementSelectorCopy.collapseClosedTitle}
          onClick={() => setBodyOpen((value) => !value)}
        >
          {bodyOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>
        <div className="element-selector-title-block">
          <span>{title}</span>
          {description ? <p>{description}</p> : null}
          <small>{scenarioBuilderElementSelectorSummary({
            selectedCount,
            visibleCount: visibleOptions.length,
            totalCount: options.length,
            excludedCount: excludedVisibleCount,
          })}</small>
        </div>
      </div>
      {bodyOpen ? (
        <>
          <div className="element-selector-controls">
            <label className="element-selector-search">
              <span>{scenarioBuilderElementSelectorCopy.searchLabel}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={scenarioBuilderElementSelectorCopy.searchPlaceholder}
              />
            </label>
            <div className="element-selector-actions">
              <button type="button" onClick={() => onSelectMany?.(visibleIds)} disabled={!visibleIds.length}>{scenarioBuilderElementSelectorCopy.selectVisible}</button>
              <button type="button" onClick={() => onClearMany?.(visibleIds)} disabled={!visibleIds.length}>{scenarioBuilderElementSelectorCopy.clearVisible}</button>
              <button type="button" onClick={() => setExcluded((current) => unique([...current, ...visibleIds]))} disabled={!visibleIds.length}>{scenarioBuilderElementSelectorCopy.excludeVisible}</button>
              <button type="button" onClick={() => setExcluded([])} disabled={!excluded.length}>{scenarioBuilderElementSelectorCopy.restoreExcluded}</button>
            </div>
          </div>
          <div id={bodyId} className="element-selector-table" role="list" aria-label={scenarioBuilderElementSelectorRegistryAriaLabel(title)}>
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
                <summary>{scenarioBuilderElementSelectorCopy.detailLabel}</summary>
                <em>{option.meta ?? scenarioBuilderElementSelectorCopy.defaultMeta}</em>
              </details>
              <button type="button" className="element-selector-exclude" onClick={() => setExcluded((current) => unique([...current, option.id]))}>
                {scenarioBuilderElementSelectorCopy.rowExclude}
              </button>
            </article>
          );
        })}
            {!visibleOptions.length ? (
              <div className="element-selector-empty">{scenarioBuilderElementSelectorCopy.emptyState}</div>
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
