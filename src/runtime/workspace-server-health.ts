export const WORKSPACE_WRITER_HEALTH_CAPABILITIES = [
  'workspace-snapshot',
  'workspace-files',
  'runtime-module-dispatcher',
  'sciforge-tools',
  'workspace-terminal-websocket-pty',
  'browser-host-session',
  'browser-host-native-surface',
  'browser-host-search',
  'repair-handoff-runner',
  'feedback-direct-codex-terminal-websocket-pty',
  'feedback-direct-codex-terminal-system-terminal',
  'feedback-repair-terminal-mirror-tail',
  'feedback-repair-stop-request',
  'feedback-repair-guidance-input',
  'feedback-scrubbed-screenshot-evidence-assets',
  'feedback-repair-evidence-store',
  'feedback-repair-evidence-upload',
  'runtime-provider-preflight-manifest',
  'runtime-codex-browser-acceptance-manifest',
  'stable-version-registry',
] as const;

export const WORKSPACE_WRITER_BROWSER_HOST_NATIVE_SURFACE_ENDPOINT = '/api/sciforge/browser-host/native-surface/{health,attach,state}' as const;

export interface WorkspaceWriterHealthInput {
  pid: number;
  startedAt: string;
  instanceId: string;
  lifecycleToken?: string;
  browserHostNativeAdapterUrl?: string;
}

export function buildWorkspaceWriterHealth(input: WorkspaceWriterHealthInput) {
  const nativeAdapterUrl = normalizeBrowserHostNativeAdapterUrl(
    input.browserHostNativeAdapterUrl ?? process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL,
  );
  const capabilities = nativeAdapterUrl
    ? [...WORKSPACE_WRITER_HEALTH_CAPABILITIES]
    : WORKSPACE_WRITER_HEALTH_CAPABILITIES.filter((capability) => capability !== 'browser-host-native-surface');
  return {
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: input.pid,
    startedAt: input.startedAt,
    instanceId: input.instanceId,
    lifecycleToken: input.lifecycleToken || undefined,
    capabilities,
    endpoints: {
      runtimeModuleDispatcher: '/api/sciforge/modules/{describe,query,read,invoke}',
      browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
      browserHostNativeSurface: WORKSPACE_WRITER_BROWSER_HOST_NATIVE_SURFACE_ENDPOINT,
      browserHostDiagnostics: '/api/sciforge/browser-host/sessions/{frame,frame-stream}',
      browserHostSearch: '/api/sciforge/browser-host/search',
      runtimeCodex: '/api/sciforge/runtime/codex/{stream,realtime/ws}',
    },
  };
}

export function normalizeBrowserHostNativeAdapterUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim().replace(/\/+$/, '');
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' || !/^(?:127\.0\.0\.1|localhost|::1)$/i.test(url.hostname)) return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
}
