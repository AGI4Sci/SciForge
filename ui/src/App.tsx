import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  Download,
  FileCode,
  FileText,
  Lock,
  MessageSquare,
  Play,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Sparkles,
  Target,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  agents,
  componentManifest,
  executionUnits as executionUnitsFallback,
  feasibilityRows,
  messagesByAgent,
  navItems,
  paperCards,
  radarData,
  roleTabs,
  stats,
  timeline,
  type AgentId,
  type ClaimType,
  type EvidenceLevel,
  type PageId,
} from './data';
import { sendAgentMessage } from './api/agentClient';
import {
  makeId,
  nowIso,
  type BioAgentMessage,
  type BioAgentSession,
  type EvidenceClaim,
  type NotebookRecord,
  type RuntimeExecutionUnit,
} from './domain';
import { loadSessions, resetSession, saveSessions } from './sessionStore';
import { HeatmapViewer, MoleculeViewer, NetworkGraph, UmapViewer } from './visualizations';

const chartTheme = {
  bg: '#0A0F1A',
  card: '#0F1623',
  elevated: '#1A2332',
  border: '#243044',
  text: '#E8EDF5',
  muted: '#7B93B0',
  accent: '#00E5A0',
  teal: '#4ECDC4',
  coral: '#FF7043',
  amber: '#FFD54F',
};

function cx(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

function Card({ children, className = '', onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <section className={cx('card', onClick && 'clickable', className)} onClick={onClick}>
      {children}
    </section>
  );
}

function Badge({
  children,
  variant = 'info',
  glow = false,
}: {
  children: ReactNode;
  variant?: 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'coral';
  glow?: boolean;
}) {
  return <span className={cx('badge', `badge-${variant}`, glow && 'badge-glow')}>{children}</span>;
}

function IconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick?: () => void }) {
  return (
    <button className="icon-button" onClick={onClick} title={label} aria-label={label}>
      <Icon size={17} />
    </button>
  );
}

function ActionButton({
  icon: Icon,
  children,
  variant = 'primary',
  onClick,
  disabled = false,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'coral';
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={cx('action-button', `action-${variant}`)} onClick={onClick} disabled={disabled}>
      {Icon ? <Icon size={16} /> : null}
      {children}
    </button>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div className="section-title-wrap">
        {Icon ? (
          <div className="section-icon">
            <Icon size={18} />
          </div>
        ) : null}
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
      </div>
      {action}
    </div>
  );
}

function TabBar<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ id: T; label: string; icon?: LucideIcon }>;
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="tabbar">
      {tabs.map((tab) => (
        <button key={tab.id} className={cx('tab', active === tab.id && 'active')} onClick={() => onChange(tab.id)}>
          {tab.icon ? <tab.icon size={14} /> : null}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

function EvidenceTag({ level }: { level: EvidenceLevel }) {
  const labels: Record<EvidenceLevel, string> = {
    meta: 'Meta分析',
    rct: 'RCT/临床',
    cohort: '队列研究',
    case: '案例报告',
    prediction: '计算预测',
  };
  const variant: Record<EvidenceLevel, 'success' | 'info' | 'warning' | 'coral' | 'muted'> = {
    meta: 'success',
    rct: 'info',
    cohort: 'warning',
    case: 'coral',
    prediction: 'muted',
  };
  return <Badge variant={variant[level]}>{labels[level]}</Badge>;
}

function ClaimTag({ type }: { type: ClaimType }) {
  const labels: Record<ClaimType, string> = { fact: '事实', inference: '推断', hypothesis: '假设' };
  const variant: Record<ClaimType, 'success' | 'warning' | 'coral'> = {
    fact: 'success',
    inference: 'warning',
    hypothesis: 'coral',
  };
  return <Badge variant={variant[type]}>{labels[type]}</Badge>;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 90 ? '#00E5A0' : pct >= 75 ? '#FFD54F' : '#FF7043';
  return (
    <div className="confidence">
      <div className="confidence-track">
        <div className="confidence-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ color }}>{pct}%</span>
    </div>
  );
}

function Sidebar({
  page,
  setPage,
  agentId,
  setAgentId,
}: {
  page: PageId;
  setPage: (page: PageId) => void;
  agentId: AgentId;
  setAgentId: (id: AgentId) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={cx('sidebar', collapsed && 'collapsed')}>
      <div className="brand">
        <div className="brand-mark">BA</div>
        {!collapsed ? (
          <div>
            <h1>BioAgent</h1>
            <p>AI4Science Workbench</p>
          </div>
        ) : null}
      </div>

      <nav className="nav-section">
        {navItems.map((item) => (
          <button key={item.id} className={cx('nav-item', page === item.id && 'active')} onClick={() => setPage(item.id)}>
            <item.icon size={18} />
            {!collapsed ? <span>{item.label}</span> : null}
          </button>
        ))}
      </nav>

      {!collapsed ? (
        <div className="agent-list">
          <div className="sidebar-label">Agent Profiles</div>
          {agents.map((agent) => (
            <button
              key={agent.id}
              className={cx('agent-nav', agentId === agent.id && page === 'workbench' && 'active')}
              onClick={() => {
                setAgentId(agent.id);
                setPage('workbench');
              }}
            >
              <agent.icon size={15} style={{ color: agent.color }} />
              <span>{agent.name}</span>
              <i className={cx('status-dot', agent.status === 'active' && 'online')} />
            </button>
          ))}
        </div>
      ) : null}

      <button className="collapse-button" onClick={() => setCollapsed(!collapsed)} title="折叠侧边栏">
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </button>
    </aside>
  );
}

function TopBar() {
  return (
    <header className="topbar">
      <div className="searchbox">
        <Search size={15} />
        <input placeholder="搜索基因、通路、文献、Execution Unit..." />
      </div>
      <div className="topbar-actions">
        <Badge variant="info" glow>
          Phase 1 - 单 Agent 独立运行
        </Badge>
        <IconButton icon={Settings} label="设置" />
      </div>
    </header>
  );
}

function Dashboard({ setPage, setAgentId }: { setPage: (page: PageId) => void; setAgentId: (id: AgentId) => void }) {
  const activityData = [
    { day: 'Mon', papers: 28, eus: 4 },
    { day: 'Tue', papers: 36, eus: 7 },
    { day: 'Wed', papers: 42, eus: 8 },
    { day: 'Thu', papers: 51, eus: 11 },
    { day: 'Fri', papers: 47, eus: 13 },
    { day: 'Sat', papers: 66, eus: 16 },
  ];
  return (
    <main className="page dashboard">
      <div className="page-heading">
        <h1>研究概览</h1>
        <p>固定科学组件 + 运行时 manifest 配置，让单 Agent 像专业研究工具一样工作。</p>
      </div>

      <div className="stats-grid">
        {stats.map((stat) => (
          <Card key={stat.label} className="stat-card">
            <div className="stat-icon" style={{ color: stat.color, background: `${stat.color}18` }}>
              <stat.icon size={18} />
            </div>
            <div>
              <div className="stat-value" style={{ color: stat.color }}>
                {stat.value}
              </div>
              <div className="stat-label">{stat.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="dashboard-grid">
        <Card className="wide">
          <SectionHeader icon={Shield} title="Phase 1 架构状态" subtitle="所有 profile 共享同一套 runtime / evidence / UI shell" />
          <div className="principles">
            {[
              ['单 Agent 自治', '每个 Agent 独立可用，自带工具、组件 slots 和证据策略。'],
              ['配置驱动 UI', 'Agent 差异通过 AgentProfile + UIManifest + registry 表达。'],
              ['可复现执行', 'ExecutionUnit 记录代码、参数、环境、数据指纹和产物。'],
              ['证据优先', 'Claim、Evidence、Confidence 和矛盾证据并排呈现。'],
            ].map(([title, text]) => (
              <div className="principle" key={title}>
                <Check size={16} />
                <div>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionHeader icon={Target} title="最近活跃度" subtitle="mock runtime events" />
          <div className="chart-220">
            <ResponsiveContainer>
              <AreaChart data={activityData}>
                <defs>
                  <linearGradient id="bioArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#00E5A0" stopOpacity={0.42} />
                    <stop offset="100%" stopColor="#00E5A0" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#243044" strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fill: '#7B93B0', fontSize: 11 }} />
                <YAxis tick={{ fill: '#7B93B0', fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#1A2332', border: '1px solid #243044', borderRadius: 8 }} />
                <Area dataKey="papers" stroke="#00E5A0" fill="url(#bioArea)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <section>
        <SectionHeader title="单 Agent Profiles" subtitle="点击进入工作台；UI 由 profile 默认组件和 manifest 驱动" />
        <div className="agent-grid">
          {agents.map((agent) => (
            <Card
              key={agent.id}
              className="agent-card"
              onClick={() => {
                setAgentId(agent.id);
                setPage('workbench');
              }}
            >
              <div className="agent-card-top">
                <div className="agent-card-icon" style={{ color: agent.color, background: `${agent.color}18` }}>
                  <agent.icon size={23} />
                </div>
                <Badge variant={agent.status === 'active' ? 'success' : 'muted'}>{agent.status}</Badge>
              </div>
              <h3 style={{ color: agent.color }}>{agent.name}</h3>
              <p>{agent.desc}</p>
              <div className="tool-chips">
                {agent.tools.map((tool) => (
                  <span key={tool}>{tool}</span>
                ))}
              </div>
              <div className="manifest-strip">
                {componentManifest[agent.id].map((component) => (
                  <i key={component} title={component} />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </section>
    </main>
  );
}

function ChatPanel({
  agentId,
  role,
  session,
  onSessionChange,
}: {
  agentId: AgentId;
  role: string;
  session: BioAgentSession;
  onSessionChange: (session: BioAgentSession) => void;
}) {
  const [input, setInput] = useState('');
  const [expanded, setExpanded] = useState<number | null>(0);
  const [errorText, setErrorText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const messages = session.messages;
  const agent = agents.find((item) => item.id === agentId) ?? agents[0];

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, isSending]);

  useEffect(() => {
    setInput('');
    setErrorText('');
    setExpanded(0);
  }, [agentId]);

  async function handleSend() {
    const prompt = input.trim();
    if (!prompt || isSending) return;
    const userMessage: BioAgentMessage = {
      id: makeId('msg'),
      role: 'user',
      content: prompt,
      createdAt: nowIso(),
      status: 'completed',
    };
    const optimisticSession: BioAgentSession = {
      ...session,
      messages: [...session.messages, userMessage],
      updatedAt: nowIso(),
    };
    onSessionChange(optimisticSession);
    setInput('');
    setErrorText('');
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await sendAgentMessage({
        agentId,
        agentName: agent.name,
        agentDomain: agent.domain,
        prompt,
        roleView: role,
        messages: optimisticSession.messages,
      }, controller.signal);
      onSessionChange({
        ...optimisticSession,
        messages: [...optimisticSession.messages, response.message],
        runs: [...optimisticSession.runs, response.run],
        uiManifest: response.uiManifest.length ? response.uiManifest : optimisticSession.uiManifest,
        claims: [...response.claims, ...optimisticSession.claims].slice(0, 24),
        executionUnits: [...response.executionUnits, ...optimisticSession.executionUnits].slice(0, 24),
        artifacts: [...response.artifacts, ...optimisticSession.artifacts].slice(0, 24),
        notebook: [...response.notebook, ...optimisticSession.notebook].slice(0, 24),
        updatedAt: nowIso(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorText(message);
      onSessionChange({
        ...optimisticSession,
        messages: [
          ...optimisticSession.messages,
          {
            id: makeId('msg'),
            role: 'system',
            content: message,
            createdAt: nowIso(),
            status: 'failed',
          },
        ],
        runs: [
          ...optimisticSession.runs,
          {
            id: makeId('run'),
            agentId,
            status: 'failed',
            prompt,
            response: message,
            createdAt: nowIso(),
            completedAt: nowIso(),
          },
        ],
        updatedAt: nowIso(),
      });
    } finally {
      setIsSending(false);
      abortRef.current = null;
    }
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  function handleClear() {
    if (isSending) abortRef.current?.abort();
    onSessionChange(resetSession(agentId));
  }

  function handleExport() {
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${agentId}-${session.sessionId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="chat-panel">
      <div className="panel-title compact">
        <div className="agent-mini" style={{ background: `${agent.color}18`, color: agent.color }}>
          <agent.icon size={18} />
        </div>
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.tools.join(' / ')}</span>
        </div>
        <Badge variant="success" glow>在线</Badge>
        <div className="panel-actions">
          {isSending ? <IconButton icon={RefreshCw} label="取消请求" onClick={handleAbort} /> : null}
          <IconButton icon={Download} label="导出当前 Agent 会话" onClick={handleExport} />
          <IconButton icon={Trash2} label="清空当前 Agent 会话" onClick={handleClear} />
        </div>
      </div>

      <div className="messages" ref={messagesRef}>
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={cx('message', message.role)}>
            <div className="message-body">
              <div className="message-meta">
                <strong>{message.role === 'user' ? '你' : message.role === 'system' ? '系统' : agent.name}</strong>
                {message.confidence ? <ConfidenceBar value={message.confidence} /> : null}
                {message.evidence ? <EvidenceTag level={message.evidence} /> : null}
                {message.claimType ? <ClaimTag type={message.claimType} /> : null}
                {message.status === 'failed' ? <Badge variant="danger">failed</Badge> : null}
              </div>
              <p>{message.content}</p>
              {message.expandable ? (
                <>
                  <button className="expand-link" onClick={() => setExpanded(expanded === index ? null : index)}>
                    {expanded === index ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    {expanded === index ? '收起推理链' : '展开推理链'}
                  </button>
                  {expanded === index ? <pre className="reasoning">{message.expandable}</pre> : null}
                </>
              ) : null}
            </div>
          </div>
        ))}
        {isSending ? (
          <div className="message agent">
            <div className="message-body">
              <div className="message-meta">
                <strong>{agent.name}</strong>
                <Badge variant="info">running</Badge>
              </div>
              <p>正在调用 AgentServer...</p>
            </div>
          </div>
        ) : null}
      </div>

      {errorText ? <div className="composer-error">{errorText}</div> : null}
      <div className="composer">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleSend();
          }}
          placeholder="输入研究问题..."
          disabled={isSending}
        />
        <ActionButton icon={Sparkles} onClick={handleSend} disabled={!input.trim() || isSending}>
          {isSending ? '发送中' : '发送'}
        </ActionButton>
      </div>
    </div>
  );
}

function VolcanoChart() {
  const data = useMemo(
    () =>
      Array.from({ length: 160 }, (_, i) => {
        const logFC = Math.sin(i * 1.73) * 3.8 + Math.cos(i * 0.29);
        const negLogP = Math.abs(Math.cos(i * 0.41) * 9 + Math.sin(i * 0.13) * 4);
        return { gene: `Gene${i}`, logFC, negLogP, sig: Math.abs(logFC) > 1.4 && negLogP > 3 };
      }).concat([
        { gene: 'BRCA1', logFC: -2.14, negLogP: 11.4, sig: true },
        { gene: 'MYC', logFC: 3.2, negLogP: 7.9, sig: true },
        { gene: 'TP53', logFC: -1.82, negLogP: 5.3, sig: true },
      ]),
    [],
  );
  return (
    <div className="chart-300">
      <ResponsiveContainer>
        <ScatterChart margin={{ top: 10, right: 14, bottom: 24, left: 8 }}>
          <CartesianGrid stroke="#243044" strokeDasharray="3 3" />
          <XAxis dataKey="logFC" type="number" tick={{ fill: '#7B93B0', fontSize: 10 }} label={{ value: 'log2FC', position: 'bottom', fill: '#7B93B0' }} />
          <YAxis dataKey="negLogP" type="number" tick={{ fill: '#7B93B0', fontSize: 10 }} label={{ value: '-log10(p)', angle: -90, position: 'insideLeft', fill: '#7B93B0' }} />
          <Tooltip contentStyle={{ background: '#1A2332', border: '1px solid #243044', borderRadius: 8 }} />
          <Scatter data={data}>
            {data.map((entry) => (
              <Cell key={entry.gene} fill={entry.sig ? (entry.logFC > 0 ? '#FF7043' : '#4ECDC4') : 'rgba(123,147,176,0.35)'} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResultsRenderer({ agentId, session }: { agentId: AgentId; session: BioAgentSession }) {
  const [resultTab, setResultTab] = useState('primary');
  const agent = agents.find((item) => item.id === agentId) ?? agents[0];
  const tabs = [
    { id: 'primary', label: '结果视图' },
    { id: 'evidence', label: '证据矩阵' },
    { id: 'execution', label: 'ExecutionUnit' },
    { id: 'notebook', label: '研究记录' },
  ];

  return (
    <div className="results-panel">
      <div className="result-tabs">
        <TabBar tabs={tabs} active={resultTab} onChange={setResultTab} />
      </div>
      <div className="result-content">
        {resultTab === 'primary' ? (
          <PrimaryResult agentId={agentId} session={session} />
        ) : resultTab === 'evidence' ? (
          <EvidenceMatrix claims={session.claims} />
        ) : resultTab === 'execution' ? (
          <ExecutionPanel executionUnits={session.executionUnits} />
        ) : (
          <NotebookTimeline agentId={agent.id} notebook={session.notebook} />
        )}
      </div>
    </div>
  );
}

function PrimaryResult({ agentId, session }: { agentId: AgentId; session: BioAgentSession }) {
  const latestManifest = session.uiManifest
    .slice()
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .slice(0, 4);
  if (agentId === 'structure') {
    return (
      <div className="stack">
        <SectionHeader icon={Shield} title="分子结构查看器" subtitle="PDB:7BZ5 · Switch-II pocket highlighted" action={<ActionButton icon={Play}>模拟旋转</ActionButton>} />
        {latestManifest.length ? <ManifestDiagnostics slots={latestManifest} /> : null}
        <Card className="viz-card">
          <MoleculeViewer />
        </Card>
        <MetricGrid />
      </div>
    );
  }
  if (agentId === 'omics') {
    return (
      <div className="stack">
        <SectionHeader icon={Target} title="组学差异分析" subtitle="Volcano / Heatmap / UMAP 组件均来自 registry" />
        {latestManifest.length ? <ManifestDiagnostics slots={latestManifest} /> : null}
        <div className="split-grid">
          <Card className="viz-card">
            <VolcanoChart />
          </Card>
          <Card className="viz-card">
            <HeatmapViewer />
          </Card>
        </div>
      </div>
    );
  }
  if (agentId === 'knowledge') {
    return (
      <div className="stack">
        <SectionHeader icon={Target} title="靶点关联网络" subtitle="KRAS druggability knowledge graph" />
        {latestManifest.length ? <ManifestDiagnostics slots={latestManifest} /> : null}
        <Card className="viz-card">
          <NetworkGraph />
        </Card>
      </div>
    );
  }
  return (
    <div className="stack">
      <SectionHeader icon={FileText} title="文献卡片" subtitle="证据等级和 claim type 直接进入 UI" />
      {latestManifest.length ? <ManifestDiagnostics slots={latestManifest} /> : null}
      <div className="paper-list">
        {paperCards.map((paper) => (
          <Card key={paper.title} className="paper-card">
            <div>
              <h3>{paper.title}</h3>
              <p>{paper.source} · {paper.year}</p>
            </div>
            <EvidenceTag level={paper.level} />
          </Card>
        ))}
      </div>
      <Card className="viz-card">
        <NetworkGraph />
      </Card>
    </div>
  );
}

function ManifestDiagnostics({ slots }: { slots: Array<{ componentId: string; title?: string; artifactRef?: string }> }) {
  return (
    <div className="manifest-diagnostics">
      {slots.map((slot) => (
        <code key={`${slot.componentId}-${slot.artifactRef ?? slot.title ?? ''}`}>
          {slot.componentId}{slot.artifactRef ? ` -> ${slot.artifactRef}` : ''}
        </code>
      ))}
    </div>
  );
}

function MetricGrid() {
  return (
    <div className="metric-grid">
      {[
        ['Pocket volume', '628 A3', '#00E5A0'],
        ['pLDDT mean', '94.2', '#4ECDC4'],
        ['DrugScore', '0.73', '#FFD54F'],
        ['Mutation risk', 'Y96D', '#FF7043'],
      ].map(([label, value, color]) => (
        <Card className="metric" key={label}>
          <span>{label}</span>
          <strong style={{ color }}>{value}</strong>
        </Card>
      ))}
    </div>
  );
}

function EvidenceMatrix({ claims }: { claims: EvidenceClaim[] }) {
  const rows = claims.length
    ? claims.map((claim) => [
      claim.text,
      `${claim.supportingRefs.length} 条支持`,
      `${claim.opposingRefs.length} 条反向`,
      claim.evidenceLevel,
      claim.type,
    ])
    : [
      ['EGFR/MET 旁路激活是主要耐药机制', '6 篇支持', '1 篇反向', 'cohort', 'inference'],
      ['Y96D 改变结合口袋构象', '3 篇支持', '0 篇反向', 'case', 'hypothesis'],
      ['Sotorasib 已形成临床验证可成药路径', '2 个上市药物', '0 篇反向', 'rct', 'fact'],
    ];
  return (
    <div className="stack">
      <SectionHeader icon={Shield} title="EvidenceGraph" subtitle="Claim -> supporting / opposing evidence" />
      {rows.map(([claim, support, oppose, level, type]) => (
        <Card className="evidence-row" key={claim}>
          <div>
            <h3>{claim}</h3>
            <p>{support} · {oppose}</p>
          </div>
          <EvidenceTag level={level as EvidenceLevel} />
          <ClaimTag type={type as ClaimType} />
        </Card>
      ))}
    </div>
  );
}

function ExecutionPanel({ executionUnits }: { executionUnits: RuntimeExecutionUnit[] }) {
  const rows = executionUnits.length ? executionUnits : executionUnitsFallback;
  return (
    <div className="stack">
      <SectionHeader icon={Lock} title="可复现执行单元" subtitle="代码 + 参数 + 环境 + 数据指纹" action={<ActionButton icon={Download} variant="secondary">导出 JSON Bundle</ActionButton>} />
      <div className="eu-table">
        <div className="eu-head">
          <span>EU ID</span>
          <span>Tool</span>
          <span>Params</span>
          <span>Status</span>
          <span>Hash</span>
        </div>
        {rows.map((unit) => (
          <div className="eu-row" key={unit.id}>
            <code>{unit.id}</code>
            <span>{unit.tool}</span>
            <code>{unit.params}</code>
            <Badge variant={unit.status === 'done' ? 'success' : unit.status === 'planned' ? 'muted' : 'warning'}>{unit.status}</Badge>
            <code>{unit.hash}</code>
          </div>
        ))}
      </div>
      <Card className="code-card">
        <SectionHeader icon={FileCode} title="环境定义" />
        <pre>{`name: bioagent-phase1
runtime: record-only
dependencies:
  - node=20
  - python=3.11
  - bioconductor-deseq2=1.42
input_sha256: a3f2c9b7d1e4...
database_versions:
  UniProt: 2026.03
  PDB: 2026-04 snapshot`}</pre>
      </Card>
    </div>
  );
}

function NotebookTimeline({ agentId, notebook = [] }: { agentId: AgentId; notebook?: NotebookRecord[] }) {
  const filtered = notebook.length ? notebook : timeline.filter((item) => item.agent === agentId || agentId === 'literature');
  return (
    <div className="stack">
      <SectionHeader icon={Clock} title="研究记录" subtitle="从对话到可审计 notebook timeline" />
      <div className="timeline-list">
        {filtered.map((item) => {
          const agent = agents.find((entry) => entry.id === item.agent) ?? agents[0];
          return (
            <Card className="timeline-card" key={item.title}>
              <div className="timeline-dot" style={{ background: agent.color }} />
              <div>
                <div className="timeline-meta">
                  <span>{item.time}</span>
                  <ClaimTag type={item.claimType} />
                  <ConfidenceBar value={item.confidence} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Workbench({
  agentId,
  session,
  onSessionChange,
}: {
  agentId: AgentId;
  session: BioAgentSession;
  onSessionChange: (session: BioAgentSession) => void;
}) {
  const agent = agents.find((item) => item.id === agentId) ?? agents[0];
  const [role, setRole] = useState('biologist');
  return (
    <main className="workbench">
      <div className="workbench-header">
        <div className="agent-title">
          <div className="agent-large-icon" style={{ color: agent.color, background: `${agent.color}18` }}>
            <agent.icon size={24} />
          </div>
          <div>
            <h1 style={{ color: agent.color }}>{agent.name}</h1>
            <p>{agent.desc}</p>
          </div>
        </div>
        <div className="role-tabs">
          <span>角色视图</span>
          <TabBar tabs={roleTabs} active={role} onChange={setRole} />
        </div>
      </div>
      <div className="manifest-banner">
        <span>UIManifest</span>
        {componentManifest[agentId].map((component) => (
          <code key={component}>{component}</code>
        ))}
      </div>
      <div className="workbench-grid">
        <ChatPanel agentId={agentId} role={role} session={session} onSessionChange={onSessionChange} />
        <ResultsRenderer agentId={agentId} session={session} />
      </div>
    </main>
  );
}

function AlignmentPage() {
  const [step, setStep] = useState(0);
  const steps = ['数据摸底', '可行性评估', '方案共识', '持续校准'];
  return (
    <main className="page">
      <div className="page-heading">
        <h1>跨领域对齐工作台</h1>
        <p>把 AI 专家的可行性判断和生物专家的实验现实放到同一个结构化工作台里。</p>
      </div>
      <div className="stepper">
        {steps.map((name, index) => (
          <button key={name} className={cx(index === step && 'active', index < step && 'done')} onClick={() => setStep(index)}>
            <span>{index < step ? <Check size={13} /> : index + 1}</span>
            {name}
          </button>
        ))}
      </div>
      {step === 0 ? <AlignmentSurvey /> : step === 1 ? <Feasibility /> : step === 2 ? <ProjectContract /> : <Recalibration />}
    </main>
  );
}

function AlignmentSurvey() {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={Sparkles} title="AI 视角" subtitle="数据能力评估" />
        <Progress label="样本量" value={20} color="#FFD54F" detail="200 / 1000 ideal" />
        <Progress label="特征维度" value={100} color="#00E5A0" detail="20K genes" />
        <Progress label="标签平衡度" value={35} color="#FF7043" detail="3 drugs < 5%" />
        <p className="callout warning">特征维度远超样本量，建议降维、正则化或迁移学习。</p>
      </Card>
      <Card>
        <SectionHeader icon={Target} title="生物视角" subtitle="数据来源与实验现实" />
        <Progress label="药物覆盖" value={100} color="#00E5A0" detail="15 / 15" />
        <Progress label="组学模态" value={60} color="#FFD54F" detail="3 / 5" />
        <Progress label="批次一致性" value={60} color="#FFD54F" detail="GDSC vs CCLE" />
        <p className="callout success">窄谱靶向药低响应率是生物学现实，不应简单视为标签缺陷。</p>
      </Card>
    </div>
  );
}

function Progress({ label, value, color, detail }: { label: string; value: number; color: string; detail: string }) {
  return (
    <div className="progress-row">
      <div>
        <span>{label}</span>
        <em>{detail}</em>
      </div>
      <div className="progress-track">
        <i style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function Feasibility() {
  return (
    <div className="alignment-grid">
      <Card>
        <SectionHeader icon={Target} title="可行性矩阵" />
        <div className="feasibility-list">
          {feasibilityRows.map((row) => (
            <div className="feasibility-row" key={row.dim}>
              <div className="feasibility-top">
                <strong>{row.dim}</strong>
                <Badge variant={row.status === 'ok' ? 'success' : 'warning'}>{row.status === 'ok' ? '可行' : '需注意'}</Badge>
              </div>
              <div className="dual-view">
                <span>AI: {row.ai}</span>
                <span>Bio: {row.bio}</span>
              </div>
              <p>{row.action}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <SectionHeader title="双视角能力雷达" subtitle="AI vs Bio assessment" />
        <div className="chart-300">
          <ResponsiveContainer>
            <RadarChart data={radarData}>
              <PolarGrid stroke="#243044" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#7B93B0', fontSize: 10 }} />
              <PolarRadiusAxis tick={{ fill: '#7B93B0', fontSize: 9 }} />
              <Radar dataKey="ai" name="AI" stroke="#4ECDC4" fill="#4ECDC4" fillOpacity={0.2} />
              <Radar dataKey="bio" name="Bio" stroke="#FF7043" fill="#FF7043" fillOpacity={0.18} />
              <Tooltip contentStyle={{ background: '#1A2332', border: '1px solid #243044', borderRadius: 8 }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function ProjectContract() {
  return (
    <Card>
      <SectionHeader icon={FileText} title="项目契约草案" action={<ActionButton icon={Download} variant="secondary">导出 PDF</ActionButton>} />
      <div className="contract-grid">
        {[
          ['研究目标', '聚焦 12 种药物的敏感性预测，排除 3 种极低响应率窄谱靶向药。'],
          ['技术路线', 'GDSC/CCLE 预训练 + 内部数据微调，按机制拆分模型。'],
          ['成功标准', 'AUROC > 0.80，假阳性率 < 20%，至少 3 个命中完成实验验证。'],
          ['已知风险', '批次效应、药物机制差异和验证成本可能影响项目节奏。'],
        ].map(([title, text]) => (
          <div className="contract-item" key={title}>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Recalibration() {
  return (
    <Card>
      <SectionHeader icon={AlertTriangle} title="持续校准记录" subtitle="早期发现认知漂移和模型偏差" />
      <div className="callout warning">
        <strong>自动触发：模型在 2 种 HDAC 抑制剂上 AUROC 仅 0.58</strong>
        <p>AI 诊断：特征空间与激酶抑制剂不同。生物解读：表观遗传调控机制需要独立建模。共识：拆分模型并补充组蛋白修饰数据。</p>
      </div>
    </Card>
  );
}

function TimelinePage() {
  return (
    <main className="page">
      <div className="page-heading">
        <h1>研究时间线</h1>
        <p>聊天、工具、证据和执行单元最终都沉淀为可审计的研究记录。</p>
      </div>
      <div className="timeline-list">
        {timeline.map((item) => {
          const agent = agents.find((entry) => entry.id === item.agent) ?? agents[0];
          return (
            <Card className="timeline-card" key={item.title}>
              <div className="timeline-dot" style={{ background: agent.color }} />
              <div>
                <div className="timeline-meta">
                  <span>{item.time}</span>
                  <Badge variant="info">{agent.name}</Badge>
                  <ClaimTag type={item.claimType} />
                  <ConfidenceBar value={item.confidence} />
                </div>
                <h3>{item.title}</h3>
                <p>{item.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </main>
  );
}

export function BioAgentApp() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [agentId, setAgentId] = useState<AgentId>('literature');
  const [sessions, setSessions] = useState<Record<AgentId, BioAgentSession>>(() => loadSessions());

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  function updateSession(nextSession: BioAgentSession) {
    setSessions((current) => ({
      ...current,
      [nextSession.agentId]: nextSession,
    }));
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />
      <Sidebar page={page} setPage={setPage} agentId={agentId} setAgentId={setAgentId} />
      <div className="main-shell">
        <TopBar />
        <div className="content-shell">
          {page === 'dashboard' ? (
            <Dashboard setPage={setPage} setAgentId={setAgentId} />
          ) : page === 'workbench' ? (
            <Workbench agentId={agentId} session={sessions[agentId]} onSessionChange={updateSession} />
          ) : page === 'alignment' ? (
            <AlignmentPage />
          ) : (
            <TimelinePage />
          )}
        </div>
      </div>
    </div>
  );
}
