import { Check, Copy, Filter, Play, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  availableWorkbenchDemoVariants,
  buildWorkbenchArtifactShapeExample,
  buildWorkbenchDemoRenderProps,
  buildWorkbenchFigureQA,
  buildWorkbenchInteractionEventLog,
  workbenchModuleDisplayLabels,
  moduleHasWorkbenchDemo,
  recommendWorkbenchComponents,
  type WorkbenchDemoVariant,
} from '../componentWorkbenchDemo';
import type { SciForgeConfig } from '../domain';
import { acceptedArtifactTypesForComponent, artifactTypesForComponents, uiModuleRegistry, type RuntimeUIModule } from '../uiModuleRegistry';
import { renderRegisteredWorkbenchSlot } from './ResultsRenderer';
import { ActionButton, Badge, SectionHeader, cx } from './uiPrimitives';
import { defaultWorkbenchRecommendationInput, renderPackageWorkbenchPreview, workbenchListEmptyLabels } from '@sciforge-ui/components';

type LifecycleFilter = 'all' | RuntimeUIModule['lifecycle'];

function uniqueComponentIds() {
  return Array.from(new Set(uiModuleRegistry.map((module) => module.componentId))).sort();
}

function modulesForComponent(componentId: string) {
  return uiModuleRegistry.filter((module) => module.componentId === componentId);
}

function componentContract(componentIds: string[]) {
  const modules = componentIds.flatMap((componentId) => modulesForComponent(componentId));
  return {
    contractVersion: 'ui-component-library.v1',
    mode: 'user-selected-allowlist',
    availableComponentIds: componentIds,
    acceptedArtifactTypes: Object.fromEntries(componentIds.map((componentId) => [componentId, acceptedArtifactTypesForComponent(componentId)])),
    expectedOutputArtifactHints: artifactTypesForComponents(componentIds),
    modules: modules.map((module) => ({
      moduleId: module.moduleId,
      version: module.version,
      componentId: module.componentId,
      lifecycle: module.lifecycle,
      acceptsArtifactTypes: module.acceptsArtifactTypes,
      outputArtifactTypes: module.outputArtifactTypes ?? [],
      requiredFields: module.requiredFields ?? [],
      requiredAnyFields: module.requiredAnyFields ?? [],
      viewParams: module.viewParams ?? [],
      interactionEvents: module.interactionEvents ?? [],
      fallbackModuleIds: module.fallbackModuleIds ?? [],
      safety: module.safety ?? {},
    })),
  };
}

function lifecycleVariant(lifecycle: RuntimeUIModule['lifecycle']) {
  if (lifecycle === 'published') return 'success';
  if (lifecycle === 'validated') return 'info';
  if (lifecycle === 'deprecated') return 'warning';
  return 'muted';
}

function formatList(values: string[] | undefined, emptyLabel: string = workbenchListEmptyLabels.default) {
  if (!values?.length) return <span className="component-muted">{emptyLabel}</span>;
  return values.map((value) => <code key={value}>{value}</code>);
}

function requiredContract(module: RuntimeUIModule) {
  return module.requiredFields?.length ? module.requiredFields : module.requiredAnyFields?.map((fields) => fields.join(' | '));
}

function safetySummary(module: RuntimeUIModule) {
  const safety = module.safety ?? {};
  return [
    safety.sandbox ? 'sandbox' : 'no-sandbox',
    `external:${safety.externalResources ?? 'unspecified'}`,
    safety.executesCode ? 'executes-code' : 'no-code-exec',
  ];
}

function variantLabel(variant: WorkbenchDemoVariant) {
  if (variant === 'basic') return 'basic';
  if (variant === 'empty') return 'empty';
  return 'selection';
}

function parseSchemaInput(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return { properties: Object.fromEntries(trimmed.split(/[,\s]+/).filter(Boolean).map((field) => [field, {}])) };
  }
}

function formatArtifactJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function figureQaRows(qa: ReturnType<typeof buildWorkbenchFigureQA>) {
  if (!qa) return [];
  return [
    ['size', qa.size],
    ['DPI', qa.dpi],
    ['font', qa.font],
    ['palette', qa.palette],
    ['colorblind safety', qa.colorblindSafety],
    ['panel labels', qa.panelLabels],
    ['vector/raster status', qa.vectorRasterStatus],
    ['data source', qa.dataSource],
    ['statistical method', qa.statisticalMethod],
  ];
}

function renderWorkbenchPreview(props: ReturnType<typeof buildWorkbenchDemoRenderProps>) {
  return renderPackageWorkbenchPreview(props, renderRegisteredWorkbenchSlot);
}

export function ComponentWorkbenchPage({
  config,
  selectedComponentIds,
  onSelectedComponentIdsChange,
}: {
  config: SciForgeConfig;
  selectedComponentIds: string[];
  onSelectedComponentIdsChange: (componentIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all');
  const [copied, setCopied] = useState(false);
  const [copiedArtifactId, setCopiedArtifactId] = useState<string | null>(null);
  const [demoModuleKey, setDemoModuleKey] = useState<string | null>(null);
  const [demoVariant, setDemoVariant] = useState<WorkbenchDemoVariant>('basic');
  const [agentArtifactType, setAgentArtifactType] = useState<string>(defaultWorkbenchRecommendationInput.artifactType);
  const [agentArtifactSchema, setAgentArtifactSchema] = useState<string>(defaultWorkbenchRecommendationInput.artifactSchemaText);
  const allComponentIds = useMemo(() => uniqueComponentIds(), []);
  const publishedComponentIds = useMemo(
    () => allComponentIds.filter((componentId) => modulesForComponent(componentId).some((module) => module.lifecycle === 'published')),
    [allComponentIds],
  );
  const visibleModules = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return uiModuleRegistry.filter((module) => {
      if (lifecycle !== 'all' && module.lifecycle !== lifecycle) return false;
      if (!needle) return true;
      return [
        module.moduleId,
        module.componentId,
        module.title,
        module.description,
        ...(module.acceptsArtifactTypes ?? []),
        ...(module.outputArtifactTypes ?? []),
      ].join(' ').toLowerCase().includes(needle);
    });
  }, [lifecycle, query]);
  const contract = useMemo(() => componentContract(selectedComponentIds), [selectedComponentIds]);
  const contractJson = useMemo(() => JSON.stringify(contract, null, 2), [contract]);
  const recommendationInput = useMemo(() => parseSchemaInput(agentArtifactSchema), [agentArtifactSchema]);
  const recommendations = useMemo(
    () => recommendWorkbenchComponents(uiModuleRegistry, { artifactType: agentArtifactType, artifactSchema: recommendationInput }).slice(0, 6),
    [agentArtifactType, recommendationInput],
  );

  function toggleComponent(componentId: string) {
    onSelectedComponentIdsChange(
      selectedComponentIds.includes(componentId)
        ? selectedComponentIds.filter((id) => id !== componentId)
        : [...selectedComponentIds, componentId].sort(),
    );
  }

  async function copyContract() {
    try {
      await navigator.clipboard.writeText(contractJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  async function copyArtifactJson(artifactId: string, value: unknown) {
    try {
      await navigator.clipboard.writeText(formatArtifactJson(value));
      setCopiedArtifactId(artifactId);
      window.setTimeout(() => setCopiedArtifactId(null), 1400);
    } catch {
      setCopiedArtifactId(null);
    }
  }

  return (
    <main className="component-workbench-page">
      <SectionHeader
        icon={SlidersHorizontal}
        title="组件工作台"
        subtitle="先稳定组件 contract，再让对话运行时从用户勾选的组件白名单里查询和配置。"
        action={(
          <div className="component-actions">
            <ActionButton icon={Check} variant="secondary" onClick={() => onSelectedComponentIdsChange(publishedComponentIds)}>选择 published</ActionButton>
            <ActionButton icon={X} variant="ghost" onClick={() => onSelectedComponentIdsChange([])}>清空</ActionButton>
          </div>
        )}
      />
      <section className="component-workbench-summary">
        <div>
          <span>已选组件</span>
          <strong>{selectedComponentIds.length}</strong>
          <small>进入 AgentServer 的 `availableComponentIds` 白名单</small>
        </div>
        <div>
          <span>注册模块</span>
          <strong>{uiModuleRegistry.length}</strong>
          <small>moduleId/version/lifecycle 独立治理</small>
        </div>
        <div>
          <span>输出提示</span>
          <strong>{contract.expectedOutputArtifactHints.length}</strong>
          <small>仅作为 hints，不覆盖当前用户原始意图</small>
        </div>
      </section>
      <section className="component-workbench-toolbar">
        <label className="component-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 componentId、artifact type、描述..." />
        </label>
        <label className="component-filter">
          <Filter size={15} />
          <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as LifecycleFilter)}>
            <option value="all">全部生命周期</option>
            <option value="published">published</option>
            <option value="validated">validated</option>
            <option value="draft">draft</option>
            <option value="deprecated">deprecated</option>
          </select>
        </label>
      </section>
      <section className="component-workbench-layout">
        <div className="component-module-list" aria-label="UI module registry">
          {visibleModules.map((module) => {
            const selected = selectedComponentIds.includes(module.componentId);
            const moduleKey = `${module.moduleId}@${module.version}`;
            const demoVariants = availableWorkbenchDemoVariants(module);
            const activeDemoVariant = demoVariants.includes(demoVariant) ? demoVariant : demoVariants[0] ?? 'basic';
            return (
              <article key={moduleKey} className={cx('component-module-row', selected && 'selected')}>
                <div className="component-row-main">
                  <label className="component-select-toggle">
                    <input type="checkbox" checked={selected} onChange={() => toggleComponent(module.componentId)} />
                    <span>{selected ? '已加入白名单' : '加入白名单'}</span>
                  </label>
                  <div>
                    <h3>{module.title}</h3>
                    <p>{module.description}</p>
                    <div className="component-row-tags">
                      <Badge variant={lifecycleVariant(module.lifecycle)}>{module.lifecycle}</Badge>
                      <code>{module.componentId}</code>
                      <code>{module.moduleId}@{module.version}</code>
                      <Badge variant={module.safety?.executesCode ? 'warning' : 'success'}>
                        <ShieldCheck size={12} /> {module.safety?.executesCode ? 'executes-code' : 'no-code-exec'}
                      </Badge>
                    </div>
                  </div>
                </div>
                <div className="component-row-actions">
                  <button
                    type="button"
                    className="component-demo-trigger"
                    disabled={!moduleHasWorkbenchDemo(module)}
                    onClick={() => {
                      setDemoVariant(activeDemoVariant);
                      setDemoModuleKey((current) => (current === moduleKey ? null : moduleKey));
                    }}
                  >
                    <Play size={14} />
                    {demoModuleKey === moduleKey ? '收起 Demo' : '试用 Demo'}
                  </button>
                </div>
                {demoModuleKey === moduleKey ? (
                  <div className="component-demo-preview">
                    {(() => {
                      const demoProps = buildWorkbenchDemoRenderProps(module, config, activeDemoVariant);
                      const shape = buildWorkbenchArtifactShapeExample(module, activeDemoVariant);
                      const eventLog = buildWorkbenchInteractionEventLog(module, activeDemoVariant);
                      const qaRows = figureQaRows(buildWorkbenchFigureQA(module, activeDemoVariant, demoProps.artifact));
                      const artifactJsonId = `${moduleKey}:${activeDemoVariant}`;
                      return (
                        <>
                    <div className="component-row-actions" aria-label="Demo variants">
                      {(['basic', 'empty', 'selection'] as WorkbenchDemoVariant[]).map((variant) => {
                        const available = demoVariants.includes(variant);
                        return (
                          <button
                            key={variant}
                            type="button"
                            className="component-demo-trigger"
                            disabled={!available}
                            aria-pressed={activeDemoVariant === variant}
                            onClick={() => setDemoVariant(variant)}
                          >
                            {variantLabel(variant)}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="component-demo-trigger"
                        onClick={() => copyArtifactJson(artifactJsonId, demoProps.artifact ?? shape)}
                      >
                        <Copy size={14} />
                        {copiedArtifactId === artifactJsonId ? '已复制 artifact JSON' : '复制 artifact JSON'}
                      </button>
                    </div>
                    {renderWorkbenchPreview(demoProps)}
                    <div className="component-row-grid" aria-label="Agent artifact shape">
                      <div>
                        <span>artifact shape</span>
                        <pre>{formatArtifactJson({
                          type: shape.artifactType,
                          schemaVersion: shape.schemaVersion,
                          requiredFields: shape.requiredFields,
                          requiredAnyFields: shape.requiredAnyFields,
                          data: shape.exampleData,
                        })}</pre>
                      </div>
                      <div>
                        <span>interaction event log</span>
                        <pre>{eventLog.length ? eventLog.join('\n') : workbenchListEmptyLabels.noInteractionEvents}</pre>
                      </div>
                    </div>
                    {qaRows.length ? (
                      <div className="component-row-grid" aria-label="Figure QA">
                        {qaRows.map(([label, value]) => (
                          <div key={label}>
                            <span>{label}</span>
                            <div>{value}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                        </>
                      );
                    })()}
                  </div>
                ) : null}
                <div className="component-row-grid">
                  <div>
                    <span>README summary</span>
                    <div>{module.docs.agentSummary}</div>
                  </div>
                  <div>
                    <span>accepts</span>
                    <div>{formatList(module.acceptsArtifactTypes)}</div>
                  </div>
                  <div>
                    <span>requires</span>
                    <div>{formatList(requiredContract(module))}</div>
                  </div>
                  <div>
                    <span>outputs</span>
                    <div>{formatList(module.outputArtifactTypes, workbenchListEmptyLabels.backendDecides)}</div>
                  </div>
                  <div>
                    <span>events</span>
                    <div>{formatList(module.interactionEvents)}</div>
                  </div>
                  <div>
                    <span>safety</span>
                    <div>{formatList(safetySummary(module))}</div>
                  </div>
                  <div>
                    <span>alternate displays</span>
                    <div>{formatList(workbenchModuleDisplayLabels(uiModuleRegistry, module.fallbackModuleIds))}</div>
                  </div>
                  <div>
                    <span>view params</span>
                    <div>{formatList(module.viewParams)}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <aside className="component-contract-panel">
          <div className="component-contract-header">
            <div>
              <strong>Agent 视角推荐</strong>
              <span>输入 artifact type/schema，查看 package manifest 推荐项和备用显示标签</span>
            </div>
          </div>
          <label className="component-search">
            <span>type</span>
            <input value={agentArtifactType} onChange={(event) => setAgentArtifactType(event.target.value)} placeholder="artifact type" />
          </label>
          <label className="component-search">
            <span>schema</span>
            <textarea
              value={agentArtifactSchema}
              onChange={(event) => setAgentArtifactSchema(event.target.value)}
              placeholder='JSON schema or fields, e.g. {"required":["points"]}'
              rows={4}
            />
          </label>
          <div className="component-row-grid">
            {recommendations.length ? recommendations.map((item) => (
              <div key={`${item.moduleId}:${item.componentId}`}>
                <span>{item.componentId}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.reasons.join('; ')}</p>
                  <small>alternates: {item.alternateModuleLabels.length ? item.alternateModuleLabels.join(', ') : 'none'}</small>
                </div>
              </div>
            )) : (
              <div>
                <span>recommendation</span>
                <div>No matching component; waiting for package manifest recommendation.</div>
              </div>
            )}
          </div>
          <div className="component-contract-header">
            <div>
              <strong>运行时组件 Contract</strong>
              <span>{selectedComponentIds.length ? selectedComponentIds.join(', ') : `未选择组件，运行时回到 ${workbenchListEmptyLabels.backendDecides}`}</span>
            </div>
            <button type="button" onClick={copyContract} title="复制 contract" aria-label="复制 contract">
              <Copy size={15} />
            </button>
          </div>
          {copied ? <div className="component-copy-notice">已复制 contract JSON</div> : null}
          <pre>{contractJson}</pre>
        </aside>
      </section>
    </main>
  );
}
