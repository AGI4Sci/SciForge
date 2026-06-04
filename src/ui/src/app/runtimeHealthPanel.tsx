import { useEffect, useState } from 'react';
import { defaultSciForgeConfig } from '../config';
import {
  codexRuntimeHealth,
  modelHealth,
  probeWorkspaceWriterHealthDetailsUrl,
  workspaceWriterHealth,
  type RuntimeHealthItem,
  type RuntimeHealthStatus,
} from '../runtimeHealth';
import type { SciForgeConfig } from '../domain';
import { loadRuntimeProviderPreflightManifest, startRuntimeServices } from '../api/workspaceClient';
import { providerReadinessNoticeFromManifest } from '../providerReadiness';
import { sanitizePublicTextRequired } from '../publicProjectionSanitizer';
import { Badge, cx } from './uiPrimitives';

export type { RuntimeHealthItem };

export function useRuntimeHealth(config: SciForgeConfig, libraryCount?: number) {
  const [items, setItems] = useState<RuntimeHealthItem[]>(() => buildInitialHealth(config, libraryCount));

  useEffect(() => {
    let cancelled = false;
    setItems(buildInitialHealth(config, libraryCount));
    async function check() {
      const shouldCheckDefaultWriter = config.workspaceWriterBaseUrl.replace(/\/+$/, '') !== defaultSciForgeConfig.workspaceWriterBaseUrl.replace(/\/+$/, '');
      const [workspaceProbe, defaultWorkspaceProbe] = await Promise.all([
        probeWorkspaceWriterHealthDetailsUrl(`${config.workspaceWriterBaseUrl.replace(/\/+$/, '')}/health`),
        shouldCheckDefaultWriter ? probeWorkspaceWriterHealthDetailsUrl(`${defaultSciForgeConfig.workspaceWriterBaseUrl.replace(/\/+$/, '')}/health`) : Promise.resolve({ online: false, capabilities: [] }),
      ]);
      const providerPreflightNotice = workspaceProbe.online && workspaceProbe.capabilities.includes('runtime-provider-preflight-manifest')
        ? await loadProviderPreflightNotice(config)
        : undefined;
      if (cancelled) return;
      setItems([
        { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
        workspaceWriterHealth(config, workspaceProbe, defaultWorkspaceProbe),
        codexRuntimeHealth(config, workspaceProbe.online),
        modelHealth(config, providerPreflightNotice),
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
    config.workspaceWriterBaseUrl,
    config.runtimeProfile,
    config.modelProvider,
    config.modelBaseUrl,
    config.modelName,
    config.apiKey,
    libraryCount,
  ]);

  return items;
}

async function loadProviderPreflightNotice(config: SciForgeConfig) {
  try {
    return providerReadinessNoticeFromManifest(await loadRuntimeProviderPreflightManifest(config));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return providerReadinessNoticeFromManifest(undefined, message.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]'));
  }
}

export function runtimeStartServicesPublicDetail(result: { ok: boolean; services: Array<Record<string, unknown>>; error?: string }) {
  const summary = result.services
    .map((service, index) => {
      const label = sanitizePublicTextRequired(service.label ?? service.id, `Service ${index + 1}`);
      const status = sanitizePublicTextRequired(service.status ?? 'unknown', 'unknown');
      return `${label}: ${status}`;
    })
    .join('；');
  return summary || (result.ok
    ? '启动请求已发送。'
    : sanitizePublicTextRequired(result.error, '部分服务未启动。'));
}

export function runtimeStartServicesPublicError(error: unknown) {
  return sanitizePublicTextRequired(error instanceof Error ? error.message : String(error), '启动服务失败。');
}

function buildInitialHealth(config: SciForgeConfig, libraryCount?: number): RuntimeHealthItem[] {
  return [
    { id: 'ui', label: 'Web UI', status: 'online', detail: '当前页面已加载' },
    { id: 'workspace', label: 'Workspace Writer', status: 'checking', detail: config.workspaceWriterBaseUrl.trim() ? 'Workspace Writer configured (masked)' : 'Workspace Writer missing' },
    { id: 'codex-runtime', label: 'Codex Runtime', status: 'checking', detail: config.runtimeProfile?.trim() ? 'Runtime profile configured' : 'Runtime Profile missing' },
    modelHealth(config),
    {
      id: 'library',
      label: 'Scenario Library',
      status: libraryCount && libraryCount > 0 ? 'online' : 'optional',
      detail: libraryCount && libraryCount > 0 ? `${libraryCount} packages in workspace` : '可先导入官方 package 或编译新场景',
    },
  ];
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
  const blocking = items.filter((item) => item.status === 'offline' || item.status === 'not-configured' || item.status === 'checking');
  const shouldShowStart = items.some((item) => item.id === 'workspace' || item.id === 'codex-runtime');
  const [startState, setStartState] = useState<'idle' | 'starting' | 'done' | 'error'>('idle');
  const [startDetail, setStartDetail] = useState('');

  async function handleStartRuntime() {
    setStartState('starting');
    setStartDetail('正在启动 Workspace Writer 和 Codex Runtime bridge...');
    try {
      const result = await startRuntimeServices();
      setStartState(result.ok ? 'done' : 'error');
      setStartDetail(runtimeStartServicesPublicDetail(result));
      window.setTimeout(() => window.location.reload(), 1400);
    } catch (error) {
      setStartState('error');
      setStartDetail(runtimeStartServicesPublicError(error));
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
