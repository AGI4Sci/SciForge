import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import {
  assertRuntimeReady,
  ensureRuntimeHome,
  resolveRuntimeWorkspace,
  RUNTIME_PROFILE,
} from './runtime-home';

const options = parseArgs(process.argv.slice(2));
const paths = await ensureRuntimeHome({ proxyBaseUrl: options.proxyBaseUrl });
const workspace = resolveRuntimeWorkspace({
  workspace: options.workspace,
  allowWorkspaceOutsideRuntimeRoot: options.allowWorkspaceOutsideRuntimeRoot,
});
await mkdir(workspace, { recursive: true });
await assertRuntimeReady(paths);

const child = spawn('codex', [
  'exec',
  '--json',
  '--profile',
  RUNTIME_PROFILE,
  '--cd',
  workspace,
  '--sandbox',
  options.sandbox,
  '--skip-git-repo-check',
  '--ephemeral',
  '--ignore-rules',
  options.prompt,
], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CODEX_HOME: paths.codexHome,
  },
});

const exitCode = await new Promise<number>((resolve) => {
  child.once('exit', (code, signal) => {
    if (signal) resolve(128);
    else resolve(code ?? 1);
  });
});
process.exit(exitCode);

function parseArgs(args: string[]) {
  const get = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const prompt = get('--prompt') ?? positionalArgs(args, ['--workspace', '--proxy-base-url', '--sandbox', '--prompt'])[0];
  if (!prompt) {
    console.error('Missing prompt. Pass --prompt "..." or a positional prompt.');
    process.exit(2);
  }
  return {
    prompt,
    workspace: get('--workspace'),
    proxyBaseUrl: get('--proxy-base-url') ?? process.env.SCIFORGE_PROXY_BASE_URL,
    allowWorkspaceOutsideRuntimeRoot: args.includes('--allow-workspace-outside-runtime-root'),
    sandbox: get('--sandbox') ?? 'workspace-write',
  };
}

function positionalArgs(args: string[], valueFlags: string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (valueFlags.includes(value)) {
      index += 1;
      continue;
    }
    if (!value.startsWith('--')) result.push(value);
  }
  return result;
}
