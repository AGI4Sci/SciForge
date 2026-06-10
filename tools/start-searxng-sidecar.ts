import { spawn, spawnSync } from 'node:child_process';
import { openSync } from 'node:fs';
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';

const DEFAULT_SOURCE_DIR = '/tmp/sciforge-searxng-src';
const DEFAULT_VENV_DIR = '/tmp/sciforge-searxng-venv';
const DEFAULT_RUN_DIR = '/tmp/sciforge-searxng-sidecar';
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18890;
const DEFAULT_QUERY = '!mdn Fetch API';

interface CliArgs {
  sourceDir: string;
  venvDir: string;
  runDir: string;
  host: string;
  port: number;
  query: string;
  install: boolean;
  json: boolean;
}

interface SidecarManifest {
  schemaVersion: 'sciforge.searxng-sidecar.source-venv.v1';
  status: 'started' | 'blocked';
  provider: 'searxng';
  dockerUsed: false;
  baseUrl: string;
  sourceDir: string;
  venvDir: string;
  settingsPath: string;
  logPath: string;
  pidPath: string;
  pid?: number;
  health?: {
    ok: boolean;
    resultCount?: number;
    firstUrl?: string;
    error?: string;
  };
  blockers: string[];
}

export async function startSearxngSidecar(args: CliArgs = parseArgs(process.argv.slice(2), process.env)): Promise<SidecarManifest> {
  const baseUrl = `http://${args.host}:${args.port}`;
  const settingsPath = join(args.runDir, 'settings.yml');
  const logPath = join(args.runDir, 'searxng.log');
  const pidPath = join(args.runDir, 'searxng.pid');
  const blockers: string[] = [];

  await mkdir(args.runDir, { recursive: true });
  if (await portIsBusy(args.host, args.port)) {
    blockers.push(`port_in_use:${args.host}:${args.port}`);
    return writeAndPrint(args, {
      schemaVersion: 'sciforge.searxng-sidecar.source-venv.v1',
      status: 'blocked',
      provider: 'searxng',
      dockerUsed: false,
      baseUrl,
      sourceDir: args.sourceDir,
      venvDir: args.venvDir,
      settingsPath,
      logPath,
      pidPath,
      blockers,
    });
  }

  await ensureSearxngSource(args.sourceDir);
  await ensureVenv(args.venvDir);
  if (args.install || !await pathExists(join(args.venvDir, '.sciforge-searxng-installed'))) {
    await installRequirements(args.sourceDir, args.venvDir);
    await writeFile(join(args.venvDir, '.sciforge-searxng-installed'), new Date().toISOString(), 'utf8');
  }
  await writeJsonEnabledSettings(args.sourceDir, settingsPath, args.host, args.port);

  const pythonPath = join(args.venvDir, 'bin', 'granian');
  const logFd = openSync(logPath, 'a');
  const child = spawn(pythonPath, [
    '--interface',
    'wsgi',
    '--host',
    args.host,
    '--port',
    String(args.port),
    'searx.webapp:app',
  ], {
    cwd: args.sourceDir,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: {
      ...process.env,
      PYTHONPATH: args.sourceDir,
      SEARXNG_SETTINGS_PATH: settingsPath,
      SEARXNG_PORT: String(args.port),
      SEARXNG_BIND_ADDRESS: args.host,
      SEARXNG_SECRET: process.env.SEARXNG_SECRET || 'sciforge-dev-source-sidecar',
    },
  });
  child.unref();
  await writeFile(pidPath, `${child.pid ?? ''}\n`, 'utf8');

  const health = await waitForHealth(baseUrl, args.query, 30_000);
  if (!health.ok) blockers.push(`health_failed:${health.error ?? 'unknown'}`);
  return writeAndPrint(args, {
    schemaVersion: 'sciforge.searxng-sidecar.source-venv.v1',
    status: blockers.length ? 'blocked' : 'started',
    provider: 'searxng',
    dockerUsed: false,
    baseUrl,
    sourceDir: args.sourceDir,
    venvDir: args.venvDir,
    settingsPath,
    logPath,
    pidPath,
    pid: child.pid,
    health,
    blockers,
  });
}

async function ensureSearxngSource(sourceDir: string) {
  if (await pathExists(join(sourceDir, 'searx', 'webapp.py'))) return;
  await mkdir(dirname(sourceDir), { recursive: true });
  runChecked('git', ['clone', '--depth', '1', 'https://github.com/searxng/searxng.git', sourceDir], dirname(sourceDir));
}

async function ensureVenv(venvDir: string) {
  if (await pathExists(join(venvDir, 'bin', 'python'))) return;
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' });
  if (uv.status === 0) runChecked('uv', ['venv', '--python', 'python3', venvDir], process.cwd());
  else runChecked('python3', ['-m', 'venv', venvDir], process.cwd());
}

async function installRequirements(sourceDir: string, venvDir: string) {
  const pip = join(venvDir, 'bin', 'pip');
  runChecked(pip, ['install', '--upgrade', 'pip'], sourceDir);
  runChecked(pip, ['install', '-r', 'requirements.txt', '-r', 'requirements-server.txt'], sourceDir);
}

async function writeJsonEnabledSettings(sourceDir: string, settingsPath: string, host: string, port: number) {
  const sourceSettingsPath = join(sourceDir, 'searx', 'settings.yml');
  const tempPath = `${settingsPath}.base`;
  await copyFile(sourceSettingsPath, tempPath);
  let settings = await readFile(tempPath, 'utf8');
  settings = settings
    .replace(/formats:\n    - html(?!\n    - json)/, 'formats:\n    - html\n    - json')
    .replace(/method: "POST"/, 'method: "GET"')
    .replace(/port: 8888/, `port: ${port}`)
    .replace(/bind_address: "127\.0\.0\.1"/, `bind_address: "${host}"`);
  await writeFile(settingsPath, settings, 'utf8');
}

async function waitForHealth(baseUrl: string, query: string, timeoutMs: number): Promise<NonNullable<SidecarManifest['health']>> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const url = new URL('/search', baseUrl);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'json');
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
      if (!response.ok) {
        lastError = `http_${response.status}`;
      } else {
        const payload = await response.json() as { results?: Array<{ url?: string }> };
        return {
          ok: Array.isArray(payload.results),
          resultCount: payload.results?.length ?? 0,
          firstUrl: payload.results?.find((item) => item.url)?.url,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  }
  return { ok: false, error: lastError || 'timeout' };
}

async function portIsBusy(host: string, port: number): Promise<boolean> {
  return await new Promise((resolveBusy) => {
    const server = createServer();
    server.once('error', () => resolveBusy(true));
    server.once('listening', () => {
      server.close(() => resolveBusy(false));
    });
    server.listen(port, host);
  });
}

function runChecked(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
}

async function writeAndPrint(args: CliArgs, manifest: SidecarManifest): Promise<SidecarManifest> {
  const manifestPath = join(args.runDir, 'manifest.json');
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (args.json) console.log(JSON.stringify(manifest, null, 2));
  else console.log(`${manifest.status}: ${manifest.baseUrl} (${manifestPath})`);
  return manifest;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): CliArgs {
  const values = new Map<string, string>();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--json') {
      json = true;
      continue;
    }
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, 'true');
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return {
    sourceDir: resolve(values.get('source-dir') ?? env.SCIFORGE_SEARXNG_SOURCE_DIR ?? DEFAULT_SOURCE_DIR),
    venvDir: resolve(values.get('venv-dir') ?? env.SCIFORGE_SEARXNG_VENV_DIR ?? DEFAULT_VENV_DIR),
    runDir: resolve(values.get('run-dir') ?? env.SCIFORGE_SEARXNG_RUN_DIR ?? DEFAULT_RUN_DIR),
    host: values.get('host') ?? env.SCIFORGE_SEARXNG_HOST ?? DEFAULT_HOST,
    port: positiveInteger(values.get('port') ?? env.SCIFORGE_SEARXNG_PORT) ?? DEFAULT_PORT,
    query: values.get('query') ?? env.SCIFORGE_SEARXNG_HEALTH_QUERY ?? DEFAULT_QUERY,
    install: values.get('install') === 'true' || env.SCIFORGE_SEARXNG_INSTALL === '1',
    json,
  };
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startSearxngSidecar().then((manifest) => {
    if (manifest.status !== 'started') process.exitCode = 2;
  }).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
