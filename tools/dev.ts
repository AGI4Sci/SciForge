import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const WORKSPACE_PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || 5174);
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || 5173);
const AGENT_SERVER_PORT = Number(process.env.SCIFORGE_AGENT_SERVER_PORT || 18080);
const AGENT_SERVER_ROOT = resolve(process.env.SCIFORGE_AGENT_SERVER_ROOT || '../AgentServer');
const children: ChildProcess[] = [];
let shuttingDown = false;

if (process.env.SCIFORGE_AGENT_SERVER_AUTOSTART !== '0') {
  if (await isListening(AGENT_SERVER_PORT)) {
    console.log(`AgentServer already running: http://127.0.0.1:${AGENT_SERVER_PORT}`);
  } else if (existsSync(AGENT_SERVER_ROOT)) {
    children.push(start('agentserver', ['run', 'dev'], AGENT_SERVER_ROOT, {
      OPENTEAM_SERVER_PORT: String(AGENT_SERVER_PORT),
      PORT: String(AGENT_SERVER_PORT),
      NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, '--max-old-space-size=8192'),
      ...agentServerModelEnvFromLocalConfig(),
    }, { restartOnFailure: true }));
  } else {
    console.warn(`AgentServer root not found at ${AGENT_SERVER_ROOT}; set SCIFORGE_AGENT_SERVER_ROOT or SCIFORGE_AGENT_SERVER_AUTOSTART=0.`);
  }
}

function agentServerModelEnvFromLocalConfig() {
  const configPath = join(process.cwd(), 'config.local.json');
  if (!existsSync(configPath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'));
    const llm = isRecord(parsed?.llm) ? parsed.llm : {};
    const provider = typeof llm.provider === 'string' ? llm.provider.trim() : '';
    const baseUrl = typeof llm.baseUrl === 'string' ? llm.baseUrl.trim().replace(/\/+$/, '') : '';
    const apiKey = typeof llm.apiKey === 'string' ? llm.apiKey.trim() : '';
    const model = typeof llm.model === 'string' ? llm.model.trim() : typeof llm.modelName === 'string' ? llm.modelName.trim() : '';
    return {
      ...(provider ? { AGENT_SERVER_MODEL_PROVIDER: provider, AGENT_SERVER_ADAPTER_LLM_PROVIDER: provider } : {}),
      ...(baseUrl ? { AGENT_SERVER_MODEL_BASE_URL: baseUrl, AGENT_SERVER_ADAPTER_LLM_BASE_URL: baseUrl } : {}),
      ...(apiKey ? { AGENT_SERVER_MODEL_API_KEY: apiKey, AGENT_SERVER_ADAPTER_LLM_API_KEY: apiKey } : {}),
      ...(model ? { AGENT_SERVER_MODEL: model, AGENT_SERVER_MODEL_NAME: model, AGENT_SERVER_ADAPTER_LLM_MODEL: model } : {}),
    };
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const workspaceHealth = await readHealth(WORKSPACE_PORT);
if (workspaceHealth.ok) {
  console.log(`SciForge workspace writer already running: http://127.0.0.1:${WORKSPACE_PORT}`);
} else if (await isListening(WORKSPACE_PORT)) {
  console.warn(`SciForge workspace writer is running on http://127.0.0.1:${WORKSPACE_PORT}, but its health check failed. Stop the old workspace server and rerun npm run dev.`);
} else {
  children.push(start('workspace', ['run', 'workspace:server']));
}

if (await isListening(UI_PORT)) {
  console.log(`SciForge UI already running: http://127.0.0.1:${UI_PORT}`);
} else {
  children.push(start('ui', ['run', 'dev:ui']));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

function mergeNodeOptions(existing: string | undefined, required: string) {
  const current = existing?.trim() ?? '';
  return current.includes('--max-old-space-size') ? current : [current, required].filter(Boolean).join(' ');
}

function start(
  label: string,
  args: string[],
  cwd = process.cwd(),
  envPatch: Record<string, string> = {},
  options: { restartOnFailure?: boolean } = {},
) {
  const child = spawn('npm', args, {
    stdio: 'inherit',
    cwd,
    env: { ...process.env, ...envPatch },
  });
  child.once('exit', (code, signal) => {
    if (shuttingDown) return;
    if (options.restartOnFailure) {
      console.error(`${label} dev process exited with ${signal || `code ${code}`}; restarting.`);
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      setTimeout(async () => {
        if (shuttingDown) return;
        if (label === 'agentserver' && await isListening(AGENT_SERVER_PORT)) return;
        console.log(`Restarting ${label} dev process...`);
        children.push(start(label, args, cwd, envPatch, options));
      }, 1000);
      return;
    }
    if (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT') return;
    console.error(`${label} dev process exited with ${signal || `code ${code}`}`);
    shutdown();
  });
  return child;
}

function shutdown() {
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
}

function isListening(port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function readHealth(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1200) });
    const json = await response.json().catch(() => ({})) as { capabilities?: unknown };
    return {
      ok: response.ok,
      capabilities: Array.isArray(json.capabilities) ? json.capabilities.map(String) : [],
    };
  } catch {
    return { ok: false, capabilities: [] };
  }
}
