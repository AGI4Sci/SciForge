import { defineConfig } from 'vite';
import type { ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

const WORKSPACE_PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || 5174);
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || 5173);
const AGENT_SERVER_PORT = Number(process.env.SCIFORGE_AGENT_SERVER_PORT || 18080);
const AGENT_SERVER_ROOT = resolve(process.env.SCIFORGE_AGENT_SERVER_ROOT || '../AgentServer');
const CONFIG_LOCAL_PATH = resolve(process.env.SCIFORGE_CONFIG_PATH || 'config.local.json');
const RUNTIME_LOG_DIR = resolve(process.env.SCIFORGE_LOG_DIR || 'workspace/.sciforge/logs');
const runtimeChildren = new Map<string, ReturnType<typeof spawn>>();
const STARTUP_TIMEOUT_MS = Number(process.env.SCIFORGE_RUNTIME_START_TIMEOUT_MS || 30_000);

export default defineConfig({
  plugins: [react(), sciForgeRuntimeLauncher()],
  root: 'src/ui',
  build: {
    outDir: '../../dist-ui',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/3dmol')) return 'vendor-3dmol';
          if (id.includes('node_modules/recharts') || id.includes('node_modules/d3')) return 'vendor-charts';
          if (id.includes('src/ui/src/scenarioCompiler')) return 'scenario-compiler';
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react';
          return undefined;
        },
      },
    },
  },
  server: {
    port: UI_PORT,
    strictPort: true,
  },
});

function sciForgeRuntimeLauncher() {
  return {
    name: 'sciforge-runtime-launcher',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/sciforge/runtime/start', async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, corsHeaders());
          res.end();
          return;
        }
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'POST required' });
          return;
        }
        try {
          const [workspace, agentserver] = await Promise.all([
            ensureRuntimeProcess({
              id: 'workspace',
              label: 'Workspace Writer',
              port: WORKSPACE_PORT,
              healthUrl: `http://127.0.0.1:${WORKSPACE_PORT}/health`,
              cwd: process.cwd(),
              args: ['run', 'workspace:server'],
            }),
            ensureRuntimeProcess({
              id: 'agentserver',
              label: 'AgentServer',
              port: AGENT_SERVER_PORT,
              healthUrl: `http://127.0.0.1:${AGENT_SERVER_PORT}/health`,
              cwd: AGENT_SERVER_ROOT,
              args: ['run', 'dev'],
              env: agentServerEnv(),
              enabled: existsSync(AGENT_SERVER_ROOT),
              missingReason: `AgentServer root not found at ${AGENT_SERVER_ROOT}`,
            }),
          ]);
          writeJson(res, 200, { ok: workspace.ok && agentserver.ok, services: [workspace, agentserver] });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      });
    },
  };
}

async function ensureRuntimeProcess(options: {
  id: string;
  label: string;
  port: number;
  healthUrl: string;
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  missingReason?: string;
  requiredCapability?: string;
}) {
  if (options.enabled === false) return { id: options.id, label: options.label, ok: false, status: 'missing', detail: options.missingReason };
  const health = await readHealth(options.healthUrl);
  if (health.ok && (!options.requiredCapability || health.capabilities.includes(options.requiredCapability))) {
    return { id: options.id, label: options.label, ok: true, status: 'online', detail: options.healthUrl };
  }
  const existing = runtimeChildren.get(options.id);
  if (existing && existing.exitCode === null && !existing.killed) {
    await stopRuntimeChild(options.id, existing);
  }
  await mkdir(RUNTIME_LOG_DIR, { recursive: true });
  const logPath = join(RUNTIME_LOG_DIR, `${options.id}-runtime.log`);
  const log = createWriteStream(logPath, { flags: 'a' });
  log.write(`\n\n[${new Date().toISOString()}] starting ${options.label}: npm ${options.args.join(' ')}\n`);
  const child = spawn('npm', options.args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  child.once('exit', (code, signal) => {
    log.write(`[${new Date().toISOString()}] ${options.label} exited: ${signal || `code ${code}`}\n`);
    log.end();
    runtimeChildren.delete(options.id);
  });
  runtimeChildren.set(options.id, child);
  const healthy = await waitForHealthy(options.healthUrl, STARTUP_TIMEOUT_MS, options.requiredCapability);
  if (healthy) {
    return { id: options.id, label: options.label, ok: true, status: 'online', detail: options.healthUrl, logPath };
  }
  const stillRunning = child.exitCode === null && !child.killed;
  return {
    id: options.id,
    label: options.label,
    ok: false,
    status: stillRunning ? 'starting-timeout' : 'failed',
    detail: stillRunning
      ? `${options.healthUrl} 未在 ${STARTUP_TIMEOUT_MS}ms 内通过 health check`
      : `${options.label} 启动后已退出`,
    logPath,
  };
}

async function stopRuntimeChild(id: string, child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.killed) {
    runtimeChildren.delete(id);
    return;
  }
  child.kill('SIGTERM');
  await sleep(1200);
  if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
  runtimeChildren.delete(id);
}

function agentServerEnv() {
  return {
    OPENTEAM_SERVER_PORT: String(AGENT_SERVER_PORT),
    PORT: String(AGENT_SERVER_PORT),
    NODE_OPTIONS: mergeNodeOptions(process.env.NODE_OPTIONS, '--max-old-space-size=8192'),
    ...agentServerModelEnvFromLocalConfig(),
  };
}

function agentServerModelEnvFromLocalConfig() {
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_LOCAL_PATH, 'utf8'));
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

function mergeNodeOptions(existing: string | undefined, required: string) {
  const current = existing?.trim() ?? '';
  return current.includes('--max-old-space-size') ? current : [current, required].filter(Boolean).join(' ');
}

async function readHealth(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1200) });
    const json = await response.json().catch(() => ({})) as { capabilities?: unknown };
    return {
      ok: response.ok,
      capabilities: Array.isArray(json.capabilities) ? json.capabilities.map(String) : [],
    };
  } catch {
    return { ok: false, capabilities: [] };
  }
}

async function waitForHealthy(url: string, timeoutMs: number, requiredCapability?: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const health = await readHealth(url);
    if (health.ok && (!requiredCapability || health.capabilities.includes(requiredCapability))) return true;
    await sleep(350);
  }
  return false;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function writeJson(res: { writeHead: (status: number, headers?: Record<string, string>) => void; end: (body?: string) => void }, status: number, body: unknown) {
  res.writeHead(status, { ...corsHeaders(), 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
