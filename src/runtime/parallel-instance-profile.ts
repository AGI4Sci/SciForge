export type ParallelInstanceProfile = {
  id: string;
  role: string;
  uiPort: string;
  workspacePort: string;
  runtimeCodexPort: string;
  workspacePath: string;
  stateDir: string;
  logDir: string;
  configPath: string;
  agentAutostart?: string;
  counterpart: {
    agentId: string;
    appUrl: string;
    workspaceWriterUrl: string;
  };
};

const PARALLEL_INSTANCE_COUNT = 8;
const UI_PORT_BASE = 5173;
const WORKSPACE_PORT_BASE = 6173;
const RUNTIME_CODEX_PORT_BASE = 18080;

export function parallelProfile(instance: string): ParallelInstanceProfile {
  const normalized = normalizeInstanceName(instance);
  const match = /^p([1-8])$/.exec(normalized);
  const index = match ? Number(match[1]) : 1;
  const id = `p${index}`;
  const peerIndex = index === 1 ? 2 : 1;
  const uiPort = UI_PORT_BASE + index - 1;
  const workspacePort = WORKSPACE_PORT_BASE + index - 1;
  const runtimeCodexPort = RUNTIME_CODEX_PORT_BASE + index - 1;
  const peerUiPort = UI_PORT_BASE + peerIndex - 1;
  const peerWorkspacePort = WORKSPACE_PORT_BASE + peerIndex - 1;
  const workspacePath = `workspace/parallel/${id}`;
  const stateDir = `${workspacePath}/.sciforge`;
  return {
    id,
    role: id,
    uiPort: String(uiPort),
    workspacePort: String(workspacePort),
    runtimeCodexPort: String(runtimeCodexPort),
    workspacePath,
    stateDir,
    logDir: `${stateDir}/logs`,
    configPath: `${stateDir}/config.local.json`,
    agentAutostart: undefined,
    counterpart: {
      agentId: `p${peerIndex}`,
      appUrl: `http://127.0.0.1:${peerUiPort}`,
      workspaceWriterUrl: `http://127.0.0.1:${peerWorkspacePort}`,
    },
  };
}

export function normalizeInstanceName(value: string | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase();
  if (!normalized) return 'p1';
  if (normalized === 'repair' || normalized === 'b' || normalized === 'sciforge-b') return 'p2';
  if (normalized === 'main' || normalized === 'a' || normalized === 'sciforge-a' || normalized === 'default') return 'p1';
  if (new RegExp(`^p[1-${PARALLEL_INSTANCE_COUNT}]$`).test(normalized)) return normalized;
  return normalized;
}
