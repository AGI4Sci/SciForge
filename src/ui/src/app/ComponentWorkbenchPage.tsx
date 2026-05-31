import { useMemo, useState } from 'react';
import { Bot, Box, Check, History, Plug, Search } from 'lucide-react';
import { Badge, cx } from './uiPrimitives';

export type ComponentWorkbenchMode = 'automations' | 'marketplace';

type MarketplaceItem = {
  id: string;
  title: string;
  kind: string;
  category: string;
  detail: string;
};

type AutomationRecord = {
  id: string;
  name: string;
  author: string;
  tools: string;
  created: string;
  status: 'ready' | 'successful' | 'failed';
};

const marketplaceItems: MarketplaceItem[] = [
  {
    id: 'typescript-lsp',
    title: 'typescript-lsp',
    kind: 'Plugin',
    category: 'Infrastructure',
    detail: 'TypeScript/JavaScript language server for workspace code intelligence.',
  },
  {
    id: 'playwright-browser',
    title: 'playwright',
    kind: 'Plugin',
    category: 'Productivity',
    detail: 'Browser automation, screenshots, forms, and local app verification.',
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
  },
  {
    id: 'terminal-session-viewer',
    title: 'terminal-session-viewer',
    kind: 'App',
    category: 'Productivity',
    detail: 'Render command sessions with bounded output, status, and evidence refs.',
  },
  {
    id: 'browser-workbench',
    title: 'browser-workbench',
    kind: 'App',
    category: 'Productivity',
    detail: 'Open localhost pages, inspect same-origin state, and collect annotations.',
  },
];

const initialAutomations: AutomationRecord[] = [
  {
    id: 'nightly-literature-scan',
    name: 'Nightly literature scan',
    author: 'SciForge',
    tools: 'Search, report',
    created: 'May 28',
    status: 'successful',
  },
  {
    id: 'workspace-health',
    name: 'Workspace health check',
    author: 'SciForge',
    tools: 'Files, tests',
    created: 'May 29',
    status: 'ready',
  },
  {
    id: 'feedback-triage',
    name: 'Feedback triage',
    author: 'SciForge',
    tools: 'Inbox, repair',
    created: 'May 30',
    status: 'failed',
  },
];

const marketplaceCategories = ['Featured', 'Infrastructure', 'Productivity', 'Agent Orchestration', 'Canvas', 'All Plugins'];

export function ComponentWorkbenchPage({ mode = 'marketplace' }: { mode?: ComponentWorkbenchMode }) {
  return (
    <main className={cx('component-workbench-page apps-page', `mode-${mode}`)}>
      {mode === 'automations' ? <AutomationsView /> : <MarketplaceView />}
    </main>
  );
}

function AutomationsView() {
  const [records, setRecords] = useState<AutomationRecord[]>(initialAutomations);
  const [tab, setTab] = useState<'mine' | 'team'>('mine');
  const [showHistory, setShowHistory] = useState(false);
  const visibleRecords = tab === 'mine' ? records : records.filter((record) => record.status === 'successful');
  const successful = records.filter((record) => record.status === 'successful').length;
  const failed = records.filter((record) => record.status === 'failed').length;

  function addAutomation() {
    const id = `automation-${records.length + 1}`;
    setRecords((current) => [{
      id,
      name: `New automation ${current.length + 1}`,
      author: 'You',
      tools: 'Agent',
      created: 'now',
      status: 'ready',
    }, ...current]);
    setTab('mine');
    setShowHistory(false);
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
            Team <span>{successful}</span>
          </button>
        </div>
        <div className="apps-data-table">
          <div className="apps-data-row header">
            <span>{showHistory ? 'Run' : 'Automations'}</span>
            <span>Author</span>
            <span>Tools</span>
            <span>Created</span>
          </div>
          {visibleRecords.map((record) => (
            <button type="button" className="apps-data-row" key={record.id}>
              <span>
                <StatusDot status={record.status} />
                {showHistory ? `${record.name} run` : record.name}
              </span>
              <span>{record.author}</span>
              <span>{record.tools}</span>
              <span>{record.created}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

function MarketplaceView() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Featured');
  const [installedIds, setInstalledIds] = useState<string[]>(['workspace-file-viewer', 'terminal-session-viewer', 'browser-workbench']);
  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return marketplaceItems.filter((item) => {
      const categoryMatches = category === 'Featured'
        ? ['typescript-lsp', 'playwright-browser', 'workspace-file-viewer', 'browser-workbench'].includes(item.id)
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
            placeholder="Search skills, rules, subagents, apps, and tools"
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
              return (
                <article className="marketplace-card" key={item.id}>
                  <div className="marketplace-card-icon"><Box size={16} aria-hidden /></div>
                  <div className="marketplace-card-copy">
                    <span>{item.kind}</span>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                  </div>
                  <button type="button" className={cx('marketplace-get-btn', installed && 'installed')} onClick={() => toggleInstalled(item.id)}>
                    {installed ? <Check size={13} aria-hidden /> : <Plug size={13} aria-hidden />}
                    <span>{installed ? 'Installed' : 'Get'}</span>
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
