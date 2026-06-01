export const WORKSPACE_WRITER_HEALTH_CAPABILITIES = [
  'workspace-snapshot',
  'workspace-files',
  'runtime-module-dispatcher',
  'sciforge-tools',
  'workspace-terminal-websocket-pty',
  'browser-host-session',
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

export interface WorkspaceWriterHealthInput {
  pid: number;
  startedAt: string;
  instanceId: string;
  lifecycleToken?: string;
}

export function buildWorkspaceWriterHealth(input: WorkspaceWriterHealthInput) {
  return {
    ok: true,
    service: 'sciforge-workspace-writer',
    schemaVersion: 1,
    pid: input.pid,
    startedAt: input.startedAt,
    instanceId: input.instanceId,
    lifecycleToken: input.lifecycleToken || undefined,
    capabilities: [...WORKSPACE_WRITER_HEALTH_CAPABILITIES],
    endpoints: {
      runtimeModuleDispatcher: '/api/sciforge/modules/{describe,query,read,invoke}',
      browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions,frame,frame-stream}',
      browserHostSearch: '/api/sciforge/browser-host/search',
    },
  };
}
