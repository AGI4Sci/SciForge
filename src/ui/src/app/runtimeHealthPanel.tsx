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

export interface RuntimeHealthProbeOptions {
  fetchImpl?: typeof fetch;
  retryAttempts?: number;
  retryDelayMs?: number;
  allowStaticDefaultProbe?: boolean;
  sleep?: (ms: number) => Promise<void>;
}

const DESKTOP_RUNTIME_HEALTH_REFRESH_LIMIT_MS = 90_000;

export function useRuntimeHealth(config: SciForgeConfig, libraryCount?: number) {
  const [items, setItems] = useState<RuntimeHealthItem[]>(() => buildInitialHealth(config, libraryCount));

  useEffect(() => {
    let cancelled = false;
    setItems(buildInitialHealth(config, libraryCount));
    const startedAt = Date.now();
    const desktopBridge = desktopRuntimeBridgeAvailable();
    const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    async function check() {
      let refreshAttempt = 0;
      while (!cancelled) {
        const nextItems = await buildRuntimeHealthItems(config, libraryCount, {
          retryAttempts: desktopBridge ? 12 : undefined,
          retryDelayMs: desktopBridge ? 500 : undefined,
        });
        if (cancelled) return;
        setItems(nextItems);
        if (!shouldContinueRuntimeHealthRefresh(nextItems, {
          desktopBridgeAvailable: desktopBridge,
          elapsedMs: Date.now() - startedAt,
        })) return;
        refreshAttempt += 1;
        await sleep(runtimeHealthRefreshDelayMs(refreshAttempt));
      }
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

export function shouldContinueRuntimeHealthRefresh(
  items: RuntimeHealthItem[],
  context: { desktopBridgeAvailable: boolean; elapsedMs: number },
) {
  if (!context.desktopBridgeAvailable) return false;
  if (context.elapsedMs >= DESKTOP_RUNTIME_HEALTH_REFRESH_LIMIT_MS) return false;
  const required = items.filter((item) => item.id === 'workspace' || item.id === 'codex-runtime');
  return required.some((item) => item.status === 'checking' || item.status === 'offline');
}

function runtimeHealthRefreshDelayMs(attempt: number) {
  return Math.min(5_000, 500 * Math.max(1, attempt));
}

export async function buildRuntimeHealthItems(
  config: SciForgeConfig,
  libraryCount?: number,
  options: RuntimeHealthProbeOptions = {},
): Promise<RuntimeHealthItem[]> {
  const configuredWriter = config.workspaceWriterBaseUrl.replace(/\/+$/, '');
  const staticDefaultWriter = defaultSciForgeConfig.workspaceWriterBaseUrl.replace(/\/+$/, '');
  const shouldCheckDefaultWriter = (options.allowStaticDefaultProbe ?? !desktopRuntimeBridgeAvailable())
    && configuredWriter !== staticDefaultWriter;
  const desktopBridge = desktopRuntimeBridgeAvailable();
  const workspaceProbe = await probeWorkspaceWriterHealthWithRetry(`${configuredWriter}/health`, {
    ...options,
    retryAttempts: options.retryAttempts ?? (desktopBridge ? 12 : undefined),
    retryDelayMs: options.retryDelayMs ?? (desktopBridge ? 500 : undefined),
  });
  const defaultWorkspaceProbe = shouldCheckDefaultWriter && !workspaceProbe.online
    ? await probeWorkspaceWriterHealthDetailsUrl(`${staticDefaultWriter}/health`, { fetchImpl: options.fetchImpl })
    : { online: false, capabilities: [] };
  const providerPreflightNotice = workspaceProbe.online && workspaceProbe.capabilities.includes('runtime-provider-preflight-manifest')
    ? await loadProviderPreflightNotice(config)
    : undefined;
  return [
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
  ];
}

async function probeWorkspaceWriterHealthWithRetry(url: string, options: RuntimeHealthProbeOptions) {
  const attempts = Math.max(1, Math.min(8, Math.floor(options.retryAttempts ?? 4)));
  const delayMs = Math.max(0, Math.min(2_000, Math.floor(options.retryDelayMs ?? 250)));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms)));
  let latest = await probeWorkspaceWriterHealthDetailsUrl(url, { fetchImpl: options.fetchImpl });
  for (let attempt = 1; attempt < attempts && !latest.online; attempt += 1) {
    if (delayMs > 0) await sleep(delayMs);
    latest = await probeWorkspaceWriterHealthDetailsUrl(url, { fetchImpl: options.fetchImpl });
  }
  return latest;
}

function desktopRuntimeBridgeAvailable() {
  return typeof window !== 'undefined' && typeof window.sciforgeDesktop?.getRuntimeConfig === 'function';
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
