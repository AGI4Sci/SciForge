import { useEffect, useState } from 'react';
import { modelHealth, type RuntimeHealthItem, type RuntimeHealthStatus } from '../runtimeHealth';
import type { SciForgeConfig } from '../domain';
import { startRuntimeServices } from '../api/workspaceClient';
import { Badge, cx } from './uiPrimitives';

export type { RuntimeHealthItem };

export function useRuntimeHealth(config: SciForgeConfig, libraryCount?: number) {
  const [items, setItems] = useState<RuntimeHealthItem[]>(() => buildInitialHealth(config, libraryCount));

  useEffect(() => {
    let cancelled = false;
    setItems(buildInitialHealth(config, libraryCount));
    async function check() {
      const [workspaceOnline, agentOnline] = await Promise.all([
        probeUrl(`${config.workspaceWriterBaseUrl.replace(/\/+$/, '')}/health`),
        probeUrl(`${config.agentServerBaseUrl.replace(/\/+$/, '')}/health`),
      ]);
      if (cancelled) return;
      setItems([
        { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
        workspaceOnline
          ? { id: 'workspace', label: 'Workspace Writer', status: 'online', detail: config.workspaceWriterBaseUrl }
          : { id: 'workspace', label: 'Workspace Writer', status: 'offline', detail: config.workspaceWriterBaseUrl, recoverAction: '启动 npm run workspace:server 后刷新' },
        agentOnline
          ? { id: 'agentserver', label: 'AgentServer', status: 'online', detail: config.agentServerBaseUrl }
          : { id: 'agentserver', label: 'AgentServer', status: 'offline', detail: config.agentServerBaseUrl, recoverAction: '启动或修复 AgentServer；正常用户请求必须由 AgentServer/agent backend 判断回答' },
        modelHealth(config),
        {
          id: 'library',
          label: 'Scenario Library',
          status: libraryCount && libraryCount > 0 ? 'online' : 'optional',
          detail: libraryCount && libraryCount > 0 ? `${libraryCount} packages in workspace` : '可先导入官方 package 或编译新场景',
        },
      ]);
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [
    config.agentServerBaseUrl,
    config.workspaceWriterBaseUrl,
    config.modelProvider,
    config.modelBaseUrl,
    config.modelName,
    config.apiKey,
    libraryCount,
  ]);

  return items;
}

function buildInitialHealth(config: SciForgeConfig, libraryCount?: number): RuntimeHealthItem[] {
  return [
    { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
    { id: 'workspace', label: 'Workspace Writer', status: 'checking', detail: config.workspaceWriterBaseUrl },
    { id: 'agentserver', label: 'AgentServer', status: 'checking', detail: config.agentServerBaseUrl },
    modelHealth(config),
    {
      id: 'library',
      label: 'Scenario Library',
      status: libraryCount && libraryCount > 0 ? 'online' : 'optional',
      detail: libraryCount && libraryCount > 0 ? `${libraryCount} packages in workspace` : '可先导入官方 package 或编译新场景',
    },
  ];
}

async function probeUrl(url: string) {
  if (!url || !/^https?:\/\//.test(url)) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 1600);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function healthBadgeVariant(status: RuntimeHealthStatus): 'success' | 'info' | 'warning' | 'danger' | 'muted' {
  if (status === 'online') return 'success';
  if (status === 'checking') return 'info';
  if (status === 'optional') return 'warning';
  if (status === 'not-configured') return 'warning';
  return 'danger';
}

function healthLabel(status: RuntimeHealthStatus) {
  if (status === 'online') return 'online';
  if (status === 'checking') return 'checking';
  if (status === 'optional') return 'optional';
  if (status === 'not-configured') return 'setup';
  return 'offline';
}

export function RuntimeHealthPanel({ items, compact = false }: { items: RuntimeHealthItem[]; compact?: boolean }) {
  const blocking = items.filter((item) => item.status === 'offline' || item.status === 'not-configured');
  const shouldShowStart = items.some((item) => item.id === 'workspace' || item.id === 'agentserver');
  const [startState, setStartState] = useState<'idle' | 'starting' | 'done' | 'error'>('idle');
  const [startDetail, setStartDetail] = useState('');

  async function handleStartRuntime() {
    setStartState('starting');
    setStartDetail('正在启动 Workspace Writer 和 AgentServer...');
    try {
      const result = await startRuntimeServices();
      const summary = result.services
        .map((service) => `${String(service.label ?? service.id)}: ${String(service.status ?? 'unknown')}`)
        .join('；');
      setStartState(result.ok ? 'done' : 'error');
      setStartDetail(summary || (result.ok ? '启动请求已发送。' : result.error || '部分服务未启动。'));
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (error) {
      setStartState('error');
      setStartDetail(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className={cx('runtime-health-panel', compact && 'compact')}>
      <div className="runtime-health-head">
        <strong>Runtime Health</strong>
        <div className="runtime-health-head-actions">
          <Badge variant={blocking.length ? 'warning' : 'success'}>{blocking.length ? `${blocking.length} actions` : 'ready'}</Badge>
          {shouldShowStart ? (
            <button type="button" onClick={() => void handleStartRuntime()} disabled={startState === 'starting'}>
              {startState === 'starting' ? '启动中' : '启动服务'}
            </button>
          ) : null}
        </div>
      </div>
      {startDetail ? <div className={cx('runtime-start-status', startState === 'error' && 'error')}>{startDetail}</div> : null}
      <div className="runtime-health-grid">
        {items.map((item) => (
          <div
            className="runtime-health-item"
            key={item.id}
            role="group"
            aria-label={`${item.label}: ${healthLabel(item.status)}. ${item.detail}${item.recoverAction ? `. ${item.recoverAction}` : ''}`}
          >
            <Badge variant={healthBadgeVariant(item.status)}>{healthLabel(item.status)}</Badge>
            <div>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
              {item.recoverAction ? <em>{item.recoverAction}</em> : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
