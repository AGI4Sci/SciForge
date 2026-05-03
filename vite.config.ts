import { defineConfig } from 'vite';
import type { ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';

const WORKSPACE_PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || 5174);
const AGENT_SERVER_PORT = Number(process.env.SCIFORGE_AGENT_SERVER_PORT || 18080);
const AGENT_SERVER_ROOT = resolve(process.env.SCIFORGE_AGENT_SERVER_ROOT || '../AgentServer');
const runtimeChildren = new Map<string, ReturnType<typeof spawn>>();

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
    port: 5173,
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
              cwd: process.cwd(),
              args: ['run', 'workspace:server'],
            }),
            ensureRuntimeProcess({
              id: 'agentserver',
              label: 'AgentServer',
              port: AGENT_SERVER_PORT,
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
  cwd: string;
  args: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  missingReason?: string;
}) {
  if (options.enabled === false) return { id: options.id, label: options.label, ok: false, status: 'missing', detail: options.missingReason };
  if (await isListening(options.port)) return { id: options.id, label: options.label, ok: true, status: 'online', detail: `http://127.0.0.1:${options.port}` };
  const existing = runtimeChildren.get(options.id);
  if (existing && existing.exitCode === null && !existing.killed) {
    return { id: options.id, label: options.label, ok: true, status: 'starting', detail: `http://127.0.0.1:${options.port}` };
  }
  await mkdir(join(process.cwd(), 'workspace/.sciforge/logs'), { recursive: true });
  const logPath = join(process.cwd(), `workspace/.sciforge/logs/${options.id}-runtime.log`);
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
  return { id: options.id, label: options.label, ok: true, status: 'starting', detail: `http://127.0.0.1:${options.port}`, logPath };
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
    const parsed = JSON.parse(readFileSync(resolve('config.local.json'), 'utf8'));
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
