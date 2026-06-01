import { useEffect, useMemo, useState } from 'react';
import { Bot, Box, Check, History, Play, Plug, RadioTower, Save, Search, Trash2 } from 'lucide-react';
import { queryAgentHostModule, invokeAgentHostModule } from '../api/agentHostModuleClient';
import type { SciForgeConfig } from '../domain';
import { Badge, cx } from './uiPrimitives';

export type ComponentWorkbenchMode = 'automations' | 'marketplace';

type MarketplaceItem = {
  id: string;
  title: string;
  kind: 'Plugin' | 'App' | 'Channel';
  category: string;
  detail: string;
  featured?: boolean;
  hostManaged?: boolean;
  installedByDefault?: boolean;
};

export type AutomationStatus = 'ready' | 'paused' | 'running' | 'successful' | 'failed';
export type AutomationRunStatus = 'queued' | 'successful' | 'failed';
export type AutomationTriggerType = 'manual' | 'schedule' | 'workspace-event';

export type AutomationRecord = {
  schemaVersion: 1;
  id: string;
  ref: string;
  name: string;
  author: string;
  enabled: boolean;
  status: AutomationStatus;
  repositoryRef: string;
  repositoryLabel: string;
  trigger: {
    type: AutomationTriggerType;
    label: string;
    schedule?: string;
  };
  instructions: string;
  tools: string[];
  created: string;
  createdAt: string;
  updatedAt: string;
  runs: AutomationRunRecord[];
};

export type AutomationRunRecord = {
  id: string;
  status: AutomationRunStatus;
  startedAt: string;
  completedAt?: string;
  operationRef: string;
  summary: string;
};

type AutomationDraft = Omit<AutomationRecord, 'schemaVersion' | 'ref' | 'created' | 'createdAt' | 'updatedAt' | 'runs'> & {
  ref?: string;
  createdAt?: string;
  updatedAt?: string;
  runs?: AutomationRunRecord[];
};

const marketplaceItems: MarketplaceItem[] = [
  {
    id: 'typescript-lsp',
    title: 'typescript-lsp',
    kind: 'Plugin',
    category: 'Infrastructure',
    detail: 'TypeScript/JavaScript language server for workspace code intelligence.',
    featured: true,
  },
  {
    id: 'playwright-browser',
    title: 'playwright',
    kind: 'Plugin',
    category: 'Productivity',
    detail: 'Browser automation, screenshots, forms, and local app verification.',
    featured: true,
  },
  {
    id: 'feishu-cli-channel',
    title: 'Feishu CLI',
    kind: 'Channel',
    category: 'Channels',
    detail: 'Host-managed Feishu intake, refs, resources, drafts, and approval-gated delivery.',
    featured: true,
    hostManaged: true,
    installedByDefault: true,
  },
  {
    id: 'skill-creator',
    title: 'skill-creator',
    kind: 'Plugin',
    category: 'Agent Orchestration',
    detail: 'Create and improve reusable agent skills with local evaluation loops.',
  },
  {
    id: 'workspace-file-viewer',
    title: 'workspace-file-viewer',
    kind: 'App',
    category: 'Canvas',
    detail: 'Open trusted workspace file refs in the right-side editable preview.',
    featured: true,
    installedByDefault: true,
  },
  {
    id: 'terminal-session-viewer',
    title: 'terminal-session-viewer',
    kind: 'App',
    category: 'Productivity',
    detail: 'Render command sessions with bounded output, status, and evidence refs.',
    installedByDefault: true,
  },
  {
    id: 'browser-workbench',
    title: 'browser-workbench',
    kind: 'App',
    category: 'Productivity',
    detail: 'Open localhost pages, inspect same-origin state, and collect annotations.',
    featured: true,
    installedByDefault: true,
  },
];

const defaultInstalledMarketplaceIds = marketplaceItems
  .filter((item) => item.installedByDefault)
  .map((item) => item.id);

const marketplaceCategories = ['Featured', 'Infrastructure', 'Channels', 'Productivity', 'Agent Orchestration', 'Canvas', 'All Plugins'];

export function ComponentWorkbenchPage({
  mode = 'marketplace',
  config,
  initialAutomations,
}: {
  mode?: ComponentWorkbenchMode;
  config?: SciForgeConfig;
  initialAutomations?: AutomationRecord[];
}) {
  return (
    <main className={cx('component-workbench-page apps-page', `mode-${mode}`)}>
      {mode === 'automations' ? <AutomationsView config={config} initialAutomations={initialAutomations} /> : <MarketplaceView />}
    </main>
  );
}

function AutomationsView({
  config,
  initialAutomations = [],
}: {
  config?: SciForgeConfig;
  initialAutomations?: AutomationRecord[];
}) {
  const [records, setRecords] = useState<AutomationRecord[]>(() => initialAutomations.map(normalizeAutomationRecord));
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [showHistory, setShowHistory] = useState(false);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>(config ? 'loading' : 'ready');
  const [loadError, setLoadError] = useState('');
  const [editorDraft, setEditorDraft] = useState<AutomationDraft | null>(null);
  const [operationState, setOperationState] = useState<'idle' | 'saving' | 'running' | 'deleting'>('idle');
  const [operationMessage, setOperationMessage] = useState('');
  const visibleRecords = tab === 'mine' ? records : records.filter((record) => record.enabled);
  const successful = records.filter((record) => record.status === 'successful').length;
  const failed = records.filter((record) => record.status === 'failed').length;
  const runRows = records.flatMap((record) => record.runs.map((run) => ({ record, run })));
  const currentRepository = automationWorkspaceRepository(config);

  useEffect(() => {
    if (!config) return;
    const runtimeConfig = config;
    let cancelled = false;
    async function load() {
      setLoadState('loading');
      setLoadError('');
      try {
        const response = await queryAgentHostModule<{
          items?: AutomationRecord[];
          metrics?: { successful7d?: number; failed7d?: number };
        }>({ moduleId: 'automations', query: 'list', limit: 100 }, runtimeConfig);
        if (cancelled) return;
        if (!response.result.ok) {
          setLoadState('error');
          setLoadError(publicAutomationLine(response.result.error || 'Unable to load automations.', 120));
          return;
        }
        const items = Array.isArray(response.result.value?.items) ? response.result.value.items : [];
        setRecords(items.map(normalizeAutomationRecord));
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        setLoadState('error');
        setLoadError(publicAutomationLine(error instanceof Error ? error.message : String(error), 120) || 'Unable to load automations.');
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [config?.agentServerBaseUrl, config?.workspacePath, config?.workspaceWriterBaseUrl]);

  function refreshAutomations() {
    if (!config) return;
    setEditorDraft(null);
    setOperationMessage('');
    setRecords([]);
    setLoadState('loading');
    void queryAgentHostModule<{ items?: AutomationRecord[] }>({ moduleId: 'automations', query: 'list', limit: 100 }, config)
      .then((response) => {
        if (!response.result.ok) {
          setLoadState('error');
          setLoadError(publicAutomationLine(response.result.error || 'Unable to load automations.', 120));
          return;
        }
        setRecords((response.result.value?.items ?? []).map(normalizeAutomationRecord));
        setLoadState('ready');
        setLoadError('');
      })
      .catch((error) => {
        setLoadState('error');
        setLoadError(publicAutomationLine(error instanceof Error ? error.message : String(error), 120) || 'Unable to load automations.');
      });
  }

  function addAutomation() {
    setEditorDraft(createAutomationDraft(currentRepository));
    setTab('mine');
    setShowHistory(false);
    setOperationMessage('');
  }

  function openAutomation(record: AutomationRecord) {
    setEditorDraft(recordToDraft(record));
    setOperationMessage('');
  }

  async function saveAutomation() {
    if (!editorDraft) return;
    setOperationState('saving');
    setOperationMessage('');
    const input = draftToModuleInput(editorDraft);
    const intent = editorDraft.ref ? 'update' : 'create';
    try {
      const saved = config
        ? await invokeAgentHostModule<AutomationRecord>({
          moduleId: 'automations',
          intent,
          approvalToken: 'ui-automation-edit',
          input,
        }, config)
        : undefined;
      const nextRecord = saved?.result.ok
        ? normalizeAutomationRecord(saved.result.value)
        : normalizeAutomationRecord({
          ...input,
          schemaVersion: 1,
          id: editorDraft.id,
          ref: editorDraft.ref || `automation:${editorDraft.id}`,
          created: editorDraft.createdAt || 'now',
          createdAt: editorDraft.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          runs: editorDraft.runs ?? [],
        });
      if (saved && !saved.result.ok) {
        setOperationMessage(publicAutomationLine(saved.result.error || 'Automation was not saved.', 120));
        return;
      }
      setRecords((current) => upsertAutomationRecord(current, nextRecord));
      setEditorDraft(recordToDraft(nextRecord));
      setOperationMessage('Automation saved.');
      setLoadState('ready');
    } catch (error) {
      setOperationMessage(publicAutomationLine(error instanceof Error ? error.message : String(error), 120) || 'Automation was not saved.');
    } finally {
      setOperationState('idle');
    }
  }

  async function runAutomationNow() {
    if (!editorDraft?.ref || !config) return;
    setOperationState('running');
    setOperationMessage('');
    try {
      const response = await invokeAgentHostModule<AutomationRecord>({
        moduleId: 'automations',
        intent: 'run-now',
        approvalToken: 'ui-automation-run-now',
        input: { ref: editorDraft.ref },
      }, config);
      if (!response.result.ok) {
        setOperationMessage(publicAutomationLine(response.result.error || 'Automation run was not queued.', 120));
        return;
      }
      const nextRecord = normalizeAutomationRecord(response.result.value);
      setRecords((current) => upsertAutomationRecord(current, nextRecord));
      setEditorDraft(recordToDraft(nextRecord));
      setOperationMessage('Automation run queued.');
    } catch (error) {
      setOperationMessage(publicAutomationLine(error instanceof Error ? error.message : String(error), 120) || 'Automation run was not queued.');
    } finally {
      setOperationState('idle');
    }
  }

  async function deleteAutomation() {
    if (!editorDraft) return;
    if (!editorDraft.ref || !config) {
      setEditorDraft(null);
      return;
    }
    setOperationState('deleting');
    setOperationMessage('');
    try {
      const response = await invokeAgentHostModule({
        moduleId: 'automations',
        intent: 'delete',
        approvalToken: 'ui-automation-delete',
        input: { ref: editorDraft.ref },
      }, config);
      if (!response.result.ok) {
        setOperationMessage(publicAutomationLine(response.result.error || 'Automation was not deleted.', 120));
        return;
      }
      setRecords((current) => current.filter((record) => record.ref !== editorDraft.ref));
      setEditorDraft(null);
      setOperationMessage('Automation deleted.');
    } catch (error) {
      setOperationMessage(publicAutomationLine(error instanceof Error ? error.message : String(error), 120) || 'Automation was not deleted.');
    } finally {
      setOperationState('idle');
    }
  }

  if (editorDraft) {
    return (
      <AutomationEditor
        draft={editorDraft}
        currentRepository={currentRepository}
        operationState={operationState}
        operationMessage={operationMessage}
        onDraftChange={setEditorDraft}
        onBack={() => setEditorDraft(null)}
        onSave={() => { void saveAutomation(); }}
        onRunNow={() => { void runAutomationNow(); }}
        onDelete={() => { void deleteAutomation(); }}
      />
    );
  }

  return (
    <>
      <header className="apps-workbench-header">
        <div>
          <h1>Automations</h1>
        </div>
        <button type="button" className="apps-primary-action" onClick={addAutomation}>
          <Bot size={15} aria-hidden />
          <span>New Automation</span>
        </button>
      </header>
      {loadState === 'error' ? (
        <section className="automation-state-panel" aria-label="Automation load state">
          <span>{loadError || 'Unable to load automations.'}</span>
          <button type="button" onClick={refreshAutomations}>Retry</button>
        </section>
      ) : null}
      <section className="automation-metrics" aria-label="Automation metrics">
        <MetricCard label="Total Automations" value={records.length.toString()} />
        <MetricCard label="Successful · 7d" value={successful.toString()} />
        <MetricCard label="Failed · 7d" value={failed.toString()} tone={failed ? 'warning' : 'normal'} />
        <button type="button" className={cx('automation-history-card', showHistory && 'active')} onClick={() => setShowHistory((current) => !current)}>
          <History size={15} aria-hidden />
          <span>Run History</span>
        </button>
      </section>
      <section className="apps-table-panel" aria-label={showHistory ? 'Automation run history' : 'Automations'}>
        <div className="apps-segmented-control" role="tablist" aria-label="Automation scope">
          <button type="button" className={cx(tab === 'mine' && 'active')} onClick={() => setTab('mine')} role="tab" aria-selected={tab === 'mine'}>
            Mine <span>{records.length}</span>
          </button>
          <button type="button" className={cx(tab === 'team' && 'active')} onClick={() => setTab('team')} role="tab" aria-selected={tab === 'team'}>
            Active <span>{records.filter((record) => record.enabled).length}</span>
          </button>
        </div>
        <div className="apps-data-table">
          <div className="apps-data-row header">
            <span>{showHistory ? 'Run' : 'Automations'}</span>
            <span>Author</span>
            <span>Tools</span>
            <span>Created</span>
          </div>
          {showHistory ? runRows.map(({ record, run }) => (
            <button type="button" className="apps-data-row" key={`${record.id}:${run.id}`} onClick={() => openAutomation(record)}>
              <span><StatusDot status={run.status === 'failed' ? 'failed' : run.status === 'successful' ? 'successful' : 'running'} />{record.name}</span>
              <span>{run.status}</span>
              <span>{run.summary}</span>
              <span>{relativeDate(run.completedAt || run.startedAt)}</span>
            </button>
          )) : visibleRecords.map((record) => (
            <button type="button" className="apps-data-row" key={record.id} onClick={() => openAutomation(record)}>
              <span>
                <StatusDot status={record.status} />
                {record.name}
              </span>
              <span>{record.author}</span>
              <span>{record.tools.join(', ')}</span>
              <span>{relativeDate(record.createdAt)}</span>
            </button>
          ))}
          {(showHistory ? runRows.length === 0 : visibleRecords.length === 0) ? (
            <div className="apps-data-row automation-empty-row">
              <span>{loadState === 'loading' ? 'Loading automations' : showHistory ? 'No automation runs yet' : 'No automations yet'}</span>
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function AutomationEditor({
  draft,
  currentRepository,
  operationState,
  operationMessage,
  onDraftChange,
  onBack,
  onSave,
  onRunNow,
  onDelete,
}: {
  draft: AutomationDraft;
  currentRepository: { ref: string; label: string };
  operationState: 'idle' | 'saving' | 'running' | 'deleting';
  operationMessage: string;
  onDraftChange: (draft: AutomationDraft) => void;
  onBack: () => void;
  onSave: () => void;
  onRunNow: () => void;
  onDelete: () => void;
}) {
  const saved = Boolean(draft.ref);
  const busy = operationState !== 'idle';
  const toolOptions = ['Memories', 'Files', 'Browser', 'Feedback', 'MCP'];

  function update(patch: Partial<AutomationDraft>) {
    onDraftChange({ ...draft, ...patch });
  }

  function updateTrigger(patch: Partial<AutomationDraft['trigger']>) {
    const trigger = {
      ...draft.trigger,
      ...patch,
    };
    update({ trigger: { ...trigger, label: triggerLabel(trigger.type, trigger.schedule) } });
  }

  function toggleTool(tool: string) {
    const tools = new Set(draft.tools);
    if (tools.has(tool)) tools.delete(tool);
    else tools.add(tool);
    update({ tools: [...tools] });
  }

  return (
    <>
      <header className="apps-workbench-header automation-editor-header">
        <div className="automation-breadcrumb">
          <button type="button" onClick={onBack}>Automations</button>
          <span>›</span>
          <strong>{draft.name || 'New Automation'}</strong>
        </div>
        <div className="automation-editor-actions">
          <button type="button" className="apps-secondary-action" onClick={onDelete} disabled={busy}>
            <Trash2 size={14} aria-hidden />
            <span>{saved ? 'Delete' : 'Discard'}</span>
          </button>
          <button type="button" className="apps-secondary-action" onClick={onRunNow} disabled={busy || !saved}>
            <Play size={14} aria-hidden />
            <span>Run</span>
          </button>
          <button type="button" className="apps-primary-action" onClick={onSave} disabled={busy || !draft.name.trim()}>
            <Save size={14} aria-hidden />
            <span>{saved ? 'Save' : 'Create'}</span>
          </button>
        </div>
      </header>
      <section className="automation-editor" aria-label="Automation editor">
        {operationMessage ? <div className="automation-operation-note">{operationMessage}</div> : null}
        <label className="automation-field">
          <span>Name</span>
          <input
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="New Automation"
            aria-label="Automation name"
          />
        </label>
        <div className="automation-inline-controls">
          <label className="automation-switch">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => update({
                enabled: event.target.checked,
                status: event.target.checked ? 'ready' : 'paused',
              })}
              aria-label="Toggle automation enabled state"
            />
            <span>{draft.enabled ? 'Active' : 'Paused'}</span>
          </label>
          <label className="automation-field compact">
            <span>Repository</span>
            <select
              value={draft.repositoryRef}
              onChange={(event) => update({
                repositoryRef: event.target.value,
                repositoryLabel: event.target.value === currentRepository.ref ? currentRepository.label : 'No Repository',
              })}
              aria-label="Automation repository"
            >
              <option value="workspace:none">No Repository</option>
              <option value={currentRepository.ref}>{currentRepository.label}</option>
            </select>
          </label>
        </div>
        <section className="automation-editor-section">
          <h2>Triggers</h2>
          <div className="automation-trigger-row">
            <select
              value={draft.trigger.type}
              onChange={(event) => updateTrigger({ type: event.target.value as AutomationTriggerType })}
              aria-label="Trigger type"
            >
              <option value="manual">Manual</option>
              <option value="schedule">Schedule</option>
              <option value="workspace-event">Workspace event</option>
            </select>
            <input
              value={draft.trigger.schedule ?? ''}
              onChange={(event) => updateTrigger({ schedule: event.target.value })}
              placeholder={draft.trigger.type === 'schedule' ? 'Daily at 09:00' : draft.trigger.type === 'workspace-event' ? 'When workspace changes' : 'Manual run'}
              aria-label="Trigger schedule"
            />
          </div>
        </section>
        <section className="automation-editor-section">
          <h2>Agent Instructions</h2>
          <textarea
            value={draft.instructions}
            onChange={(event) => update({ instructions: event.target.value })}
            placeholder="Type @ for tools, / for commands..."
            aria-label="Agent Instructions"
          />
        </section>
        <section className="automation-editor-section">
          <h2>Tools</h2>
          <div className="automation-tool-list">
            {toolOptions.map((tool) => (
              <label key={tool}>
                <input
                  type="checkbox"
                  checked={draft.tools.includes(tool)}
                  onChange={() => toggleTool(tool)}
                />
                <span>{tool}</span>
              </label>
            ))}
          </div>
        </section>
      </section>
    </>
  );
}

function MarketplaceView() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Featured');
  const [installedIds, setInstalledIds] = useState<string[]>(defaultInstalledMarketplaceIds);
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return marketplaceItems.filter((item) => {
      const categoryMatches = category === 'Featured'
        ? item.featured === true
        : category === 'All Plugins' || item.category === category;
      const queryMatches = !normalizedQuery || `${item.title} ${item.kind} ${item.category} ${item.detail}`.toLowerCase().includes(normalizedQuery);
      return categoryMatches && queryMatches;
    });
  }, [category, query]);

  function toggleInstalled(id: string) {
    setInstalledIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  return (
    <>
      <header className="apps-workbench-header">
        <div>
          <h1>Marketplace</h1>
        </div>
        <div className="marketplace-search">
          <Search size={15} aria-hidden />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills, rules, subagents, apps, channels, and tools"
            aria-label="Search marketplace"
          />
        </div>
      </header>
      <section className="marketplace-layout">
        <nav className="marketplace-categories" aria-label="Marketplace categories">
          {marketplaceCategories.map((item) => (
            <button type="button" key={item} className={cx(item === category && 'active')} onClick={() => setCategory(item)}>
              {item}
            </button>
          ))}
        </nav>
        <section className="marketplace-list" aria-label="Marketplace items">
          <div className="marketplace-section-title">
            <span>{category}</span>
            <Badge variant="muted">{installedIds.length} installed</Badge>
          </div>
          <div className="marketplace-grid">
            {filteredItems.map((item) => {
              const installed = installedIds.includes(item.id);
              const Icon = item.kind === 'Channel' ? RadioTower : Box;
              return (
                <article className="marketplace-card" key={item.id}>
                  <div className="marketplace-card-icon"><Icon size={16} aria-hidden /></div>
                  <div className="marketplace-card-copy">
                    <span>{item.kind}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <button
                    type="button"
                    className={cx('marketplace-get-btn', installed && 'installed', item.hostManaged && 'managed')}
                    onClick={() => {
                      if (!item.hostManaged) toggleInstalled(item.id);
                    }}
                    disabled={item.hostManaged}
                    aria-label={item.hostManaged ? `${item.title} is managed by Agent Host` : undefined}
                  >
                    {installed ? <Check size={13} aria-hidden /> : <Plug size={13} aria-hidden />}
                    <span>{item.hostManaged ? 'Managed' : installed ? 'Installed' : 'Get'}</span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </>
  );
}

function MetricCard({ label, value, tone = 'normal' }: { label: string; value: string; tone?: 'normal' | 'warning' }) {
  return (
    <div className={cx('automation-metric-card', tone === 'warning' && 'warning')}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusDot({ status }: { status: AutomationRecord['status'] }) {
  return <span className={cx('automation-status-dot', status)} aria-hidden />;
}

function createAutomationDraft(currentRepository: { ref: string; label: string }): AutomationDraft {
  const id = `automation-${Date.now().toString(36)}`;
  return {
    id,
    name: 'New Automation',
    author: 'You',
    enabled: true,
    status: 'ready',
    repositoryRef: currentRepository.ref,
    repositoryLabel: currentRepository.label,
    trigger: { type: 'manual', label: 'Manual' },
    instructions: '',
    tools: ['Memories'],
  };
}

function recordToDraft(record: AutomationRecord): AutomationDraft {
  return {
    id: record.id,
    ref: record.ref,
    name: record.name,
    author: record.author,
    enabled: record.enabled,
    status: record.status,
    repositoryRef: record.repositoryRef,
    repositoryLabel: record.repositoryLabel,
    trigger: record.trigger,
    instructions: record.instructions,
    tools: record.tools,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    runs: record.runs,
  };
}

function draftToModuleInput(draft: AutomationDraft) {
  return {
    id: draft.id,
    ref: draft.ref,
    name: publicAutomationLine(draft.name, 80),
    author: publicAutomationLine(draft.author, 40),
    enabled: draft.enabled,
    status: draft.status,
    repositoryRef: publicAutomationRef(draft.repositoryRef),
    repositoryLabel: publicAutomationLine(draft.repositoryLabel, 64),
    trigger: {
      type: draft.trigger.type,
      label: publicAutomationLine(triggerLabel(draft.trigger.type, draft.trigger.schedule), 80),
      schedule: publicAutomationLine(draft.trigger.schedule ?? '', 80),
    },
    instructions: publicAutomationMultiline(draft.instructions),
    tools: draft.tools.map((tool) => publicAutomationLine(tool, 40)).filter(Boolean),
  };
}

function normalizeAutomationRecord(value: unknown): AutomationRecord {
  const record = value && typeof value === 'object' ? value as Partial<AutomationRecord> : {};
  const now = new Date().toISOString();
  const id = safeAutomationId(record.id || `automation-${Date.now().toString(36)}`);
  const enabled = record.enabled !== false;
  const triggerType = record.trigger?.type === 'schedule' || record.trigger?.type === 'workspace-event'
    ? record.trigger.type
    : 'manual';
  const triggerSchedule = publicAutomationLine(record.trigger?.schedule ?? '', 80);
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : now;
  return {
    schemaVersion: 1,
    id,
    ref: publicAutomationRef(record.ref || `automation:${id}`),
    name: publicAutomationLine(record.name || 'New Automation', 80),
    author: publicAutomationLine(record.author || 'You', 40),
    enabled,
    status: enabled ? normalizeAutomationStatus(record.status, 'ready') : 'paused',
    repositoryRef: publicAutomationRef(record.repositoryRef || 'workspace:none'),
    repositoryLabel: publicAutomationLine(record.repositoryLabel || 'No Repository', 64),
    trigger: {
      type: triggerType,
      label: publicAutomationLine(record.trigger?.label || triggerLabel(triggerType, triggerSchedule), 80),
      ...(triggerSchedule ? { schedule: triggerSchedule } : {}),
    },
    instructions: publicAutomationMultiline(record.instructions || ''),
    tools: normalizeAutomationTools(record.tools),
    created: relativeDate(createdAt),
    createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : createdAt,
    runs: normalizeAutomationRuns(record.runs),
  };
}

function normalizeAutomationRuns(value: unknown): AutomationRunRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): AutomationRunRecord[] => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Partial<AutomationRunRecord>;
    if (!record.id || !record.startedAt) return [];
    return [{
      id: safeAutomationId(record.id),
      status: record.status === 'successful' || record.status === 'failed' ? record.status : 'queued',
      startedAt: record.startedAt,
      completedAt: typeof record.completedAt === 'string' ? record.completedAt : undefined,
      operationRef: publicAutomationRef(record.operationRef || `automations:operation:run:${record.id}`),
      summary: publicAutomationLine(record.summary || 'Queued', 120),
    }];
  });
}

function normalizeAutomationTools(value: unknown): string[] {
  const tools = Array.isArray(value) ? value : ['Memories'];
  const clean = Array.from(new Set(tools.map((item) => publicAutomationLine(String(item ?? ''), 40)).filter(Boolean)));
  return clean.length ? clean : ['Memories'];
}

function normalizeAutomationStatus(value: unknown, fallback: AutomationStatus): AutomationStatus {
  return value === 'paused'
    || value === 'running'
    || value === 'successful'
    || value === 'failed'
    || value === 'ready'
    ? value
    : fallback;
}

function upsertAutomationRecord(records: AutomationRecord[], record: AutomationRecord) {
  const index = records.findIndex((item) => item.id === record.id);
  if (index < 0) return [record, ...records];
  return records.map((item) => item.id === record.id ? record : item);
}

function automationWorkspaceRepository(config: SciForgeConfig | undefined) {
  const label = workspaceLabelFromPath(config?.workspacePath || '');
  return {
    ref: label === 'No Repository' ? 'workspace:none' : 'workspace:current',
    label,
  };
}

function workspaceLabelFromPath(path: string) {
  const clean = path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
  const leaf = clean.split('/').filter(Boolean).pop();
  return publicAutomationLine(leaf || 'No Repository', 64);
}

function triggerLabel(type: AutomationTriggerType, schedule?: string) {
  if (type === 'schedule') return schedule?.trim() || 'Scheduled';
  if (type === 'workspace-event') return schedule?.trim() || 'Workspace event';
  return 'Manual';
}

function relativeDate(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return publicAutomationLine(value || 'now', 20);
  const delta = Date.now() - time;
  if (delta < 60_000) return 'now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function safeAutomationId(value: string) {
  return value.trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 96) || `automation-${Date.now().toString(36)}`;
}

function publicAutomationRef(value: string) {
  const clean = scrubAutomationText(value).trim();
  if (/^(automation|automations:operation|workspace|project|gui):/i.test(clean)) return clean.slice(0, 160);
  return 'automation:ref';
}

function publicAutomationLine(value: string, maxLength: number) {
  const clean = scrubAutomationText(value).replace(/\s+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, Math.max(0, maxLength - 1))}…` : clean;
}

function publicAutomationMultiline(value: string) {
  return scrubAutomationText(value)
    .split(/\r?\n/)
    .map((line) => publicAutomationLine(line, 180))
    .join('\n')
    .slice(0, 4000);
}

function scrubAutomationText(value: string) {
  return value
    .replace(/\bAuthorization\s*[:=]\s*Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9][A-Za-z0-9_-]{8,}\b/g, '[redacted-token]')
    .replace(
      /\b(api[_-]?key|authorization|credential|password|secret|token)\b(\s*[:=]\s*)(["']?)[^"',}\]\s]+/gi,
      (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}[redacted]`,
    )
    .replace(/\bhttps?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/\bfile:\/\/\/[^\s"'<>\\)]+/gi, '[redacted-local-path]')
    .replace(/(^|[\s"'([{<])((?:\/(?:Applications|Users|home|private|var|tmp|etc|opt)\/[^\s"'<>),;\]}]+)|(?:[A-Za-z]:\\[^\s"'<>),;\]}]+))/g, '$1[redacted-local-path]');
}
