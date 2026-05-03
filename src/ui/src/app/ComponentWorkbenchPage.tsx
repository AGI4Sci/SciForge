import { Check, Copy, Filter, Search, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { acceptedArtifactTypesForComponent, artifactTypesForComponents, uiModuleRegistry, type RuntimeUIModule } from '../uiModuleRegistry';
import { ActionButton, Badge, SectionHeader, cx } from './uiPrimitives';

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

function formatList(values: string[] | undefined, fallback = 'none') {
  if (!values?.length) return <span className="component-muted">{fallback}</span>;
  return values.map((value) => <code key={value}>{value}</code>);
}

export function ComponentWorkbenchPage({
  selectedComponentIds,
  onSelectedComponentIdsChange,
}: {
  selectedComponentIds: string[];
  onSelectedComponentIdsChange: (componentIds: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>('all');
  const [copied, setCopied] = useState(false);
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
            return (
              <article key={`${module.moduleId}@${module.version}`} className={cx('component-module-row', selected && 'selected')}>
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
                <div className="component-row-grid">
                  <div>
                    <span>accepts</span>
                    <div>{formatList(module.acceptsArtifactTypes)}</div>
                  </div>
                  <div>
                    <span>outputs</span>
                    <div>{formatList(module.outputArtifactTypes, 'backend-decides')}</div>
                  </div>
                  <div>
                    <span>required</span>
                    <div>{formatList(module.requiredFields?.length ? module.requiredFields : module.requiredAnyFields?.map((fields) => fields.join(' | ')))}</div>
                  </div>
                  <div>
                    <span>interactions</span>
                    <div>{formatList(module.interactionEvents)}</div>
                  </div>
                  <div>
                    <span>fallback</span>
                    <div>{formatList(module.fallbackModuleIds)}</div>
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
              <strong>运行时组件 Contract</strong>
              <span>{selectedComponentIds.length ? selectedComponentIds.join(', ') : '未选择组件，运行时回到 backend-decides'}</span>
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
