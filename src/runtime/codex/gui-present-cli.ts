#!/usr/bin/env node
import { stdin } from 'node:process';
import { createFileBackedGuiProtocolController } from './gui-extension-state.js';
import { GUI_EXTENSION_STATE_ENV } from './gui-extension-manifest.js';

interface ParsedArgs {
  intent: 'show-result' | 'show-artifact' | 'show-diff' | 'show-debug' | 'show-progress-detail' | 'focus-existing';
  ref?: string;
  title?: string;
  hint?: 'markdown' | 'table' | 'diff' | 'image' | 'notebook' | 'auto';
  panel?: string;
  viewId?: string;
  content?: string;
}

const statePath = process.env[GUI_EXTENSION_STATE_ENV];
if (!statePath) {
  console.error(`${GUI_EXTENSION_STATE_ENV} is required.`);
  process.exit(2);
}

const parsed = await parseArgs(process.argv.slice(2));
if (!parsed.content && !parsed.ref) {
  console.error('gui.present requires markdown text, --content, --text, --value, stdin, or --ref.');
  process.exit(2);
}

const { controller, flush } = await createFileBackedGuiProtocolController(statePath);
const result = controller.present({
  intent: parsed.intent,
  ref: parsed.ref,
  title: parsed.title,
  hint: parsed.hint ?? 'markdown',
  target: parsed.panel || parsed.viewId ? { panel: parsed.panel, viewId: parsed.viewId } : undefined,
  content: parsed.content ? { kind: 'markdown', value: parsed.content } : undefined,
});
await flush();

console.log(JSON.stringify({
  ok: result.ok,
  tool: 'gui.present',
  applied: !result.deferred && result.reason === null,
  placement: result.placement,
  currentRevision: result.currentRevision,
}));

async function parseArgs(args: string[]): Promise<ParsedArgs> {
  const parsed: ParsedArgs = { intent: 'show-result' };
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const next = () => args[++index] ?? '';
    if (arg === '--intent') parsed.intent = normalizeIntent(next());
    else if (arg === '--ref') parsed.ref = nonEmpty(next());
    else if (arg === '--title') parsed.title = nonEmpty(next());
    else if (arg === '--hint') parsed.hint = normalizeHint(next());
    else if (arg === '--panel') parsed.panel = nonEmpty(next());
    else if (arg === '--view-id') parsed.viewId = nonEmpty(next());
    else if (['--content', '--text', '--markdown', '--value'].includes(arg)) parsed.content = nonEmpty(next());
    else if (arg === '--help' || arg === '-h') usage();
    else positional.push(arg);
  }
  if (!parsed.content && positional.length) parsed.content = positional.join(' ').trim();
  if (!parsed.content && !stdin.isTTY) parsed.content = (await readStdin()).trim();
  return parsed;
}

function normalizeIntent(value: string): ParsedArgs['intent'] {
  const allowed = ['show-result', 'show-artifact', 'show-diff', 'show-debug', 'show-progress-detail', 'focus-existing'];
  if (allowed.includes(value)) return value as ParsedArgs['intent'];
  throw new Error(`Unsupported gui.present intent: ${value}`);
}

function normalizeHint(value: string): ParsedArgs['hint'] {
  const allowed = ['markdown', 'table', 'diff', 'image', 'notebook', 'auto'];
  if (allowed.includes(value)) return value as ParsedArgs['hint'];
  throw new Error(`Unsupported gui.present hint: ${value}`);
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      text += chunk;
    });
    stdin.once('error', reject);
    stdin.once('end', () => resolve(text));
  });
}

function usage(): never {
  console.log('Usage: gui.present [--intent show-result] [--title title] [--ref ref] [--content markdown] [markdown text...]');
  process.exit(0);
}
