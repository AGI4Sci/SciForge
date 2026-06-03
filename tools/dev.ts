import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  formatUiDevServerHealth,
  formatWorkspaceWriterHealth,
  readUiDevServerHealth,
  workspaceWriterHealthOk,
} from './dev-health';
import { isOwnedSciForgeViteDevProcess, parseListeningPids, type DevProcessOwnershipRecord } from './dev-process';
import { normalizeInstanceName, parallelProfile } from '../src/runtime/parallel-instance-profile.js';
import {
  agentServerEnvFromLocalSettings,
  computerUseWorkspaceEnvFromLocalSettings,
  readLocalProviderSettings,
  runtimeCodexEnvFromLocalSettings,
} from '../packages/backend/src/local-provider-config.js';

applyInstanceDefaults();

const WORKSPACE_PORT = Number(process.env.SCIFORGE_WORKSPACE_PORT || 5174);
const UI_PORT = Number(process.env.SCIFORGE_UI_PORT || 5173);
const AGENT_SERVER_PORT = Number(process.env.SCIFORGE_AGENT_SERVER_PORT || 18080);
const CODEX_PROXY_PORT = Number(process.env.SCIFORGE_PROXY_PORT || 3891);
const AGENT_SERVER_ROOT = resolve(process.env.SCIFORGE_AGENT_SERVER_ROOT || '../AgentServer');
const CONFIG_LOCAL_PATH = resolve(process.env.SCIFORGE_CONFIG_PATH || 'config.local.json');
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
  return agentServerEnvFromLocalSettings(readLocalProviderSettings(CONFIG_LOCAL_PATH));
}

function runtimeCodexEnvFromLocalConfig() {
  return runtimeCodexEnvFromLocalSettings(readLocalProviderSettings(CONFIG_LOCAL_PATH));
}

function computerUseWorkspaceEnvFromLocalConfig() {
  return computerUseWorkspaceEnvFromLocalSettings(readLocalProviderSettings(CONFIG_LOCAL_PATH));
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const workspaceHealth = await readHealth(WORKSPACE_PORT);
if (await isListening(CODEX_PROXY_PORT)) {
  console.log(`SciForge Codex proxy already running: http://127.0.0.1:${CODEX_PROXY_PORT}/v1`);
} else {
  children.push(start('codex-proxy', ['run', 'backend:codex-proxy'], process.cwd(), {
    ...runtimeCodexEnvFromLocalConfig(),
    SCIFORGE_CONFIG_PATH: CONFIG_LOCAL_PATH,
    SCIFORGE_PROXY_PORT: String(CODEX_PROXY_PORT),
    SCIFORGE_PROXY_QUIET: '1',
  }));
}

if (workspaceWriterHealthOk(workspaceHealth)) {
  console.log(`SciForge workspace writer already running: http://127.0.0.1:${WORKSPACE_PORT}`);
} else if (workspaceHealth.ok) {
  console.warn(`SciForge workspace writer is running on http://127.0.0.1:${WORKSPACE_PORT}, but it is stale for this dev launcher: ${formatWorkspaceWriterHealth(workspaceHealth)}`);
  console.warn(`Stop the stale workspace writer on port ${WORKSPACE_PORT} and rerun npm run dev.`);
} else if (await isListening(WORKSPACE_PORT)) {
  console.warn(`SciForge workspace writer is running on http://127.0.0.1:${WORKSPACE_PORT}, but its health check failed. Stop the old workspace server and rerun npm run dev.`);
} else {
  children.push(start('workspace', ['run', 'workspace:server'], process.cwd(), computerUseWorkspaceEnvFromLocalConfig()));
}

if (await isListening(UI_PORT)) {
  const uiHealth = await readUiDevServerHealth(UI_PORT);
  if (uiHealth.ok) {
    console.log(`SciForge UI already running: http://127.0.0.1:${UI_PORT}`);
  } else {
    console.warn(`SciForge UI is listening on http://127.0.0.1:${UI_PORT}, but its health check failed: ${formatUiDevServerHealth(uiHealth)}`);
    const allowStaleRestart = process.env.SCIFORGE_DEV_RESTART_STALE_UI === '1' || process.argv.includes('--restart-stale-ui');
    const restarted = allowStaleRestart ? await stopStaleViteDevServer(UI_PORT) : false;
    if (restarted) {
      children.push(startUiDevServer());
    } else {
      if (!allowStaleRestart) console.warn('Automatic stale UI restart is disabled by default; set SCIFORGE_DEV_RESTART_STALE_UI=1 or pass --restart-stale-ui to opt in.');
      console.warn(`Stop the stale UI server on port ${UI_PORT} and rerun npm run dev.`);
    }
  }
} else {
  children.push(startUiDevServer());
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

function startUiDevServer() {
  const token = `sciforge-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const child = start('ui', ['run', 'dev:ui', '--', '--host', '0.0.0.0', '--port', String(UI_PORT), '--strictPort'], process.cwd(), {
    SCIFORGE_DEV_LAUNCHER_TOKEN: token,
    VITE_SCIFORGE_INSTANCE_ID: process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE || '',
    VITE_SCIFORGE_DEFAULT_AGENT_SERVER_URL: process.env.SCIFORGE_AGENT_SERVER_URL || `http://127.0.0.1:${AGENT_SERVER_PORT}`,
    VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH: process.env.SCIFORGE_WORKSPACE_PATH || '',
    VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL: process.env.SCIFORGE_WORKSPACE_WRITER_URL || `http://127.0.0.1:${WORKSPACE_PORT}`,
  });
  writeUiDevPidfile({
    service: 'ui',
    repoRoot: process.cwd(),
    port: UI_PORT,
    instance: process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE,
    launcherPid: process.pid,
    childPid: child.pid,
    token,
    startedAt: new Date().toISOString(),
  });
  child.once('exit', () => removeUiDevPidfile(token));
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

async function stopStaleViteDevServer(port: number) {
  const ownership = readUiDevPidfile(port);
  if (!ownership) {
    console.warn(`No SciForge UI lifecycle pidfile found for port ${port}; refusing to terminate an unowned dev server.`);
    return false;
  }
  const pids = await listeningPids(port);
  const vitePids: number[] = [];
  for (const pid of pids) {
    const command = await processCommand(pid);
    const cwd = await processCwd(pid);
    const envText = await processEnvironment(pid);
    if (isOwnedSciForgeViteDevProcess({ command, cwd, envText, repoRoot: process.cwd(), port, record: ownership })) {
      vitePids.push(pid);
    }
  }
  if (!vitePids.length) {
    console.warn(`Lifecycle pidfile exists for port ${port}, but no listening Vite process carries the matching launcher token; refusing to kill unknown PIDs ${pids.join(', ') || '(none)'}.`);
    return false;
  }
  console.warn(`Restarting stale owned SciForge Vite dev server on port ${port}: ${vitePids.join(', ')}`);
  for (const pid of vitePids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // The process may already have exited between lsof and kill.
    }
  }
  const stopped = await waitForPortOffline(port, 5000);
  if (stopped) return true;
  for (const pid of vitePids) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process may already have exited between SIGTERM and SIGKILL.
    }
  }
  return await waitForPortOffline(port, 2000);
}

async function listeningPids(port: number) {
  const stdout = await execFileText('lsof', ['-n', '-P', `-tiTCP:${port}`, '-sTCP:LISTEN']);
  return parseListeningPids(stdout);
}

async function processCommand(pid: number) {
  return (await execFileText('ps', ['-p', String(pid), '-o', 'command='])).trim();
}

async function processCwd(pid: number) {
  const stdout = await execFileText('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']);
  const line = stdout.split('\n').find((entry) => entry.startsWith('n'));
  return line ? line.slice(1).trim() : '';
}

async function processEnvironment(pid: number) {
  return (await execFileText('ps', ['eww', '-p', String(pid), '-o', 'command='])).trim();
}

function uiDevPidfilePath(port: number) {
  const instance = process.env.SCIFORGE_INSTANCE_ID || process.env.SCIFORGE_INSTANCE || 'main';
  const stateDir = process.env.SCIFORGE_STATE_DIR || 'workspace/parallel/p1/.sciforge';
  return resolve(stateDir, 'dev', `ui-${instance}-${port}.pid.json`);
}

function writeUiDevPidfile(record: DevProcessOwnershipRecord) {
  const file = uiDevPidfilePath(record.port);
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    console.warn(`Could not write SciForge UI lifecycle pidfile: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readUiDevPidfile(port: number): DevProcessOwnershipRecord | undefined {
  const file = uiDevPidfilePath(port);
  try {
    if (!existsSync(file)) return undefined;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as DevProcessOwnershipRecord;
    if (parsed.service !== 'ui' || parsed.port !== port || resolve(parsed.repoRoot) !== process.cwd()) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function removeUiDevPidfile(token: string) {
  const file = uiDevPidfilePath(UI_PORT);
  try {
    if (!existsSync(file)) return;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as DevProcessOwnershipRecord;
    if (parsed.token === token) unlinkSync(file);
  } catch {
    // Leaving an unreadable lifecycle file is safer than deleting the wrong one.
  }
}

function execFileText(command: string, args: string[]) {
  return new Promise<string>((resolveText) => {
    execFile(command, args, { timeout: 1500 }, (error, stdout) => {
      resolveText(error ? '' : stdout.toString());
    });
  });
}

async function waitForPortOffline(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!await isListening(port)) return true;
    await sleep(120);
  }
  return !await isListening(port);
}

function sleep(ms: number) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function applyInstanceDefaults() {
  const instanceArg = readArgValue('--instance') || readArgValue('-i');
  const instance = normalizeInstanceName(instanceArg || process.env.SCIFORGE_INSTANCE || process.env.SCIFORGE_INSTANCE_ID || 'p1');
  const profile = parallelProfile(instance);
  process.env.SCIFORGE_INSTANCE = profile.id;
  process.env.SCIFORGE_INSTANCE_ID ||= profile.id;
  process.env.SCIFORGE_INSTANCE_ROLE ||= profile.role;
  process.env.SCIFORGE_UI_PORT ||= profile.uiPort;
  process.env.SCIFORGE_WORKSPACE_PORT ||= profile.workspacePort;
  process.env.SCIFORGE_AGENT_SERVER_PORT ||= profile.runtimeCodexPort;
  process.env.SCIFORGE_RUNTIME_CODEX_PORT ||= profile.runtimeCodexPort;
  process.env.SCIFORGE_WORKSPACE_PATH ||= resolve(profile.workspacePath);
  process.env.SCIFORGE_STATE_DIR ||= resolve(profile.stateDir);
  process.env.SCIFORGE_LOG_DIR ||= resolve(profile.logDir);
  process.env.SCIFORGE_CONFIG_PATH ||= resolve(profile.configPath);
  process.env.SCIFORGE_WORKSPACE_WRITER_URL ||= `http://127.0.0.1:${process.env.SCIFORGE_WORKSPACE_PORT}`;
  process.env.SCIFORGE_AGENT_SERVER_URL ||= `http://127.0.0.1:${process.env.SCIFORGE_AGENT_SERVER_PORT || 18080}`;
  process.env.SCIFORGE_RUNTIME_CODEX_URL ||= `http://127.0.0.1:${process.env.SCIFORGE_RUNTIME_CODEX_PORT || 18080}`;
  process.env.SCIFORGE_COUNTERPART_JSON ||= JSON.stringify(profile.counterpart);
  if (profile.agentAutostart && process.env.SCIFORGE_AGENT_SERVER_AUTOSTART === undefined) {
    process.env.SCIFORGE_AGENT_SERVER_AUTOSTART = profile.agentAutostart;
  }
}

function readArgValue(name: string) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
