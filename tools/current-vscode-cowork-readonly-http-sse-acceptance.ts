import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  runCurrentVSCodeCoWorkReadonlyHttpSseAcceptance,
} from '../src/runtime/codex/agent-host-vscode-cowork-current-readonly-http-sse-acceptance.js';

interface CliArgs {
  workspacePath?: string;
  outputDir?: string;
  commandText?: string;
  activateCurrentVSCodeIfNeeded: boolean;
  json: boolean;
  help: boolean;
}

export async function runCurrentVSCodeCoWorkReadonlyHttpSseAcceptanceCli(
  argv = process.argv,
): Promise<void> {
  const args = parseArgs(argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const workspacePath = resolve(args.workspacePath ?? process.cwd());
  const outputDir = resolve(args.outputDir ?? join(workspacePath, 'docs', 'test-artifacts', 'current-vscode-cowork-readonly-http-sse'));
  const manifest = await runCurrentVSCodeCoWorkReadonlyHttpSseAcceptance({
    workspacePath,
    outputDir,
    commandText: args.commandText,
    activateCurrentVSCodeIfNeeded: args.activateCurrentVSCodeIfNeeded,
    env: process.env,
  });
  const manifestPath = join(outputDir, 'manifest.json');
  const summary = {
    status: manifest.status,
    manifestPath,
    maturity: manifest.maturity,
    productReady: manifest.productReady,
    operation: manifest.operation,
    httpSseTransportUsed: manifest.httpSseTransportUsed,
    adapterBoundaryUsed: manifest.adapterBoundaryUsed,
    blockedReasons: manifest.blockedReasons,
    nextActions: manifest.nextActions,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const blocked = manifest.blockedReasons.length
    ? `; blocked=${manifest.blockedReasons.join(',')}`
    : '';
  process.stdout.write(`[${manifest.status}] Current VSCode read-only HTTP/SSE acceptance manifest: ${manifestPath}${blocked}\n`);
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    activateCurrentVSCodeIfNeeded: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workspace') {
      args.workspacePath = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--out') {
      args.outputDir = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--command-text') {
      args.commandText = requiredValue(argv, index, arg);
      index += 1;
    } else if (arg === '--activate-vscode') {
      args.activateCurrentVSCodeIfNeeded = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown current VSCode read-only HTTP/SSE acceptance argument: ${arg}\n${usage()}`);
    }
  }
  return args;
}

function requiredValue(argv: string[], index: number, arg: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}\n${usage()}`);
  return value;
}

function usage(): string {
  return [
    'Usage: tsx tools/current-vscode-cowork-readonly-http-sse-acceptance.ts [--workspace PATH] [--out DIR] [--command-text TEXT] [--activate-vscode] [--json]',
    '',
    'Writes docs/test-artifacts/current-vscode-cowork-readonly-http-sse/manifest.json by default.',
    'Without SCIFORGE_COMPUTER_USE_VSCODE_COWORK_LIVE_DIAGNOSTIC=1 it writes a blocked manifest and does not touch the desktop.',
    'With the live env set, the harness drives the Runtime Codex HTTP/SSE endpoint and expects Host-owned current VSCode refs-first evidence in public events.',
    '--activate-vscode may only be used for live diagnostic runs; it mechanically activates a unique VSCode window and the runner restores focus/mouse on release.',
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await runCurrentVSCodeCoWorkReadonlyHttpSseAcceptanceCli(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
