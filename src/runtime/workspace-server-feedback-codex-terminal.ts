import { access } from 'node:fs/promises';
import { isAbsolute, join, sep } from 'node:path';
import { LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS } from '../../packages/backend/src/local-provider-config.js';
import { RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS } from '../../packages/backend/src/runtime-home.js';
import {
  compactString,
  normalizeFeedbackBundleId,
  recordField,
  stringField,
  uniqueStrings,
} from './workspace-server-feedback-records.js';
import { stringValue } from './workspace-server-local-config.js';

export const FEEDBACK_CODEX_TERMINAL_STATUSES = ['starting', 'running', 'idle', 'failed', 'cancelled'] as const;
export const FEEDBACK_CODEX_TERMINAL_TRANSPORTS = ['websocket-pty', 'system-terminal'] as const;
export const SYSTEM_TERMINAL_RUNTIME_ENV_KEYS = [
  'SCIFORGE_CONFIG_PATH',
  'SCIFORGE_RUNTIME_PROVIDER',
  'SCIFORGE_RUNTIME_MODEL',
  'SCIFORGE_RUNTIME_BASE_URL',
  'SCIFORGE_PROXY_UPSTREAM_BASE_URL',
  'SCIFORGE_PROXY_BASE_URL',
  'SCIFORGE_PROXY_PORT',
  'SCIFORGE_PROXY_DEFAULT_MODEL',
  'SCIFORGE_PROXY_FORCE_NON_STREAMING_UPSTREAM',
  'SCIFORGE_RUNTIME_CODEX_SANDBOX',
  'SCIFORGE_RUNTIME_CODEX_COMMAND',
  'SCIFORGE_ALLOW_OPENAI_RUNTIME',
] as const;

export type FeedbackCodexTerminalStatus = typeof FEEDBACK_CODEX_TERMINAL_STATUSES[number];
export type FeedbackCodexTerminalTransport = typeof FEEDBACK_CODEX_TERMINAL_TRANSPORTS[number];
export type FeedbackCodexRepairRunStatus = 'running' | 'blocked' | 'needs-human-verification' | 'fixed';

export interface FeedbackCodexTerminalSession {
  schemaVersion: 1;
  id: string;
  issueId: string;
  repairRunId: string;
  status: FeedbackCodexTerminalStatus;
  workspacePath: string;
  terminalMirrorRef: string;
  promptRef: string;
  promptPreview?: string;
  codexSessionId?: string;
  startedAt: string;
  updatedAt: string;
  message?: string;
  runtimeProfile?: string;
  allowOpenAiRuntime?: boolean;
  transport: FeedbackCodexTerminalTransport;
  webSocketPath?: string;
  systemTerminalLaunchRef?: string;
  systemTerminalCommandPreview?: string;
}

export interface FeedbackCodexPtyArgsInput {
  profile: string;
  workspace: string;
  sandbox: string;
  prompt: string;
}

export interface SystemTerminalCodexCommandInput {
  codexCommand: string;
  args: string[];
  prompt: string;
  promptRef: string;
}

export interface SystemTerminalCodexCommandPreviewInput extends SystemTerminalCodexCommandInput {
  codexHome: string;
  configPath: string;
}

export interface SystemTerminalLaunchScriptInput extends SystemTerminalCodexCommandInput {
  workspace: string;
  codexHome: string;
  configPath: string;
  env: NodeJS.ProcessEnv;
  path: string;
}

export interface BuildFeedbackCodexTerminalPromptInput {
  root: string;
  bundle: Record<string, unknown>;
  issueId: string;
  userGuidance?: string;
}

export interface BuildFeedbackCodexTerminalRepairRunInput {
  session: FeedbackCodexTerminalSession;
  comment?: Record<string, unknown>;
  body?: Record<string, unknown>;
  instanceId?: string;
  instanceRole?: string;
}

export type ResolveCodexPtyCommandOptions = {
  fileExists?: (path: string) => boolean | Promise<boolean>;
};

export function feedbackCodexTerminalStatus(value: unknown): FeedbackCodexTerminalStatus {
  return value === 'starting' || value === 'running' || value === 'idle' || value === 'failed' || value === 'cancelled'
    ? value
    : 'idle';
}

export function feedbackCodexTerminalTransport(value: unknown): FeedbackCodexTerminalTransport {
  return value === 'system-terminal' ? 'system-terminal' : 'websocket-pty';
}

export function feedbackCodexTerminalPublicSession(session: FeedbackCodexTerminalSession): FeedbackCodexTerminalSession {
  return {
    schemaVersion: 1,
    id: session.id,
    issueId: session.issueId,
    repairRunId: session.repairRunId,
    status: feedbackCodexTerminalStatus(session.status),
    workspacePath: session.workspacePath,
    terminalMirrorRef: session.terminalMirrorRef,
    promptRef: session.promptRef,
    promptPreview: session.promptPreview,
    codexSessionId: session.codexSessionId,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    message: session.message,
    runtimeProfile: session.runtimeProfile,
    allowOpenAiRuntime: session.allowOpenAiRuntime,
    transport: session.transport,
    webSocketPath: session.webSocketPath,
    systemTerminalLaunchRef: session.systemTerminalLaunchRef,
    systemTerminalCommandPreview: session.systemTerminalCommandPreview,
  };
}

export function repairRunStatusForResult(result: Record<string, unknown>): FeedbackCodexRepairRunStatus {
  if (result.verdict === 'fixed') return 'fixed';
  if (result.verdict === 'partially-fixed' || result.verdict === 'needs-follow-up') return 'needs-human-verification';
  return 'blocked';
}

export function repairRunStatusForCodexTerminal(status: FeedbackCodexTerminalStatus): FeedbackCodexRepairRunStatus {
  if (status === 'failed' || status === 'cancelled') return 'blocked';
  if (status === 'idle') return 'needs-human-verification';
  return 'running';
}

export function feedbackCodexTerminalDir(root: string, sessionId: string) {
  const normalized = normalizeFeedbackBundleId(sessionId);
  return join(root, '.sciforge', 'repair-results', normalized);
}

export function feedbackCodexTerminalMirrorRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'terminal-mirror.ndjson');
}

export function feedbackCodexTerminalPromptRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'feedback-codex-prompt.md');
}

export function feedbackCodexSystemTerminalLaunchRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'system-terminal-launch.command');
}

export function feedbackCodexTerminalManifestRef(root: string, sessionId: string) {
  return join(feedbackCodexTerminalDir(root, sessionId), 'direct-codex-terminal.json');
}

export function buildFeedbackCodexTerminalPrompt(input: BuildFeedbackCodexTerminalPromptInput) {
  const comment = recordField(input.bundle.comment) ?? {};
  const target = recordField(input.bundle.target) ?? recordField(comment.target) ?? {};
  const runtime = recordField(input.bundle.runtime) ?? recordField(comment.runtime) ?? {};
  const request = recordField(input.bundle.request);
  const targetRect = recordField(target.rect);
  const evidenceRefs = feedbackPromptEvidenceRefs(comment);
  return [
    'You are Codex CLI running directly inside the SciForge workspace.',
    `Workspace: ${input.root}`,
    `Feedback issue: ${input.issueId}`,
    '',
    'Task',
    '- Repair the feedback below in the current workspace.',
    '- Use the feedback target, runtime, screenshot refs, and existing code to make the smallest correct change.',
    '- Run focused checks when the change is testable.',
    '- End by summarizing changed files, verification, and any remaining user-facing questions.',
    '',
    'Human feedback',
    `- Comment: ${stringField(comment.comment) || stringField(input.bundle.title) || '(missing comment)'}`,
    stringField(comment.expectedBehavior) ? `- Expected: ${stringField(comment.expectedBehavior)}` : '',
    stringField(comment.actualBehavior) ? `- Actual: ${stringField(comment.actualBehavior)}` : '',
    request && stringField(request.title) ? `- Request: ${stringField(request.title)}` : '',
    input.userGuidance ? `- Initial guidance: ${input.userGuidance}` : '',
    '',
    'Target element',
    `- Selector: ${stringField(target.selector) || '(missing selector)'}`,
    `- Path: ${stringField(target.path) || stringField(target.domPath) || '(missing path)'}`,
    `- Tag: ${stringField(target.tagName) || '(missing tag)'}`,
    stringField(target.text) ? `- Visible text: ${compactString(stringField(target.text), 500)}` : '',
    targetRect ? `- Rect: x=${targetRect.x ?? '?'} y=${targetRect.y ?? '?'} w=${targetRect.width ?? '?'} h=${targetRect.height ?? '?'}` : '',
    '',
    'Runtime context',
    `- Page: ${stringField(runtime.page) || '(missing page)'}`,
    `- URL: ${stringField(runtime.url) || '(missing url)'}`,
    `- Scenario: ${stringField(runtime.scenarioId) || '(missing scenario)'}`,
    stringField(runtime.sessionId) ? `- Session: ${stringField(runtime.sessionId)}` : '',
    stringField(runtime.activeRunId) ? `- Active run: ${stringField(runtime.activeRunId)}` : '',
    '',
    'Evidence refs',
    ...(evidenceRefs.length ? evidenceRefs.map((ref) => `- ${ref}`) : ['- No durable screenshot/evidence refs were recorded. Inspect the UI and code directly.']),
    '',
    'Operation boundaries',
    '- This is a direct Codex terminal session, not the old cross-instance repair runner.',
    '- Do not commit, push, create a PR, merge, or rewrite ignored secret config unless the human explicitly asks in this terminal.',
    '- Keep feedback records, screenshots, repair log evidence files, and repair audit files intact.',
    '- If provider/config errors appear, report the exact blocker and stop rather than fabricating a repair.',
  ].filter((line) => line !== '').join('\n');
}

export function feedbackPromptEvidenceRefs(comment: Record<string, unknown>) {
  const assets = Array.isArray(comment.evidenceAssets) ? comment.evidenceAssets.filter(recordField) : [];
  return uniqueStrings([
    stringField(comment.evidenceBundleRef),
    stringField(comment.screenshotRef),
    stringField(comment.rawScreenshotRef),
    stringField(comment.annotatedScreenshotRef),
    ...assets.flatMap((asset) => [
      stringField(asset.ref),
      stringField(asset.localRef),
      stringField(asset.publicUrl),
      stringField(asset.markdownImageUrl),
      stringField(recordField(asset.metadata)?.manifestRef),
    ]),
  ]);
}

export function feedbackCodexPtyArgs(input: FeedbackCodexPtyArgsInput): string[] {
  return [
    ...RUNTIME_WORKSPACE_WRITE_NETWORK_CONFIG_ARGS,
    '--profile',
    input.profile,
    '--cd',
    input.workspace,
    '--sandbox',
    input.sandbox,
    '--ask-for-approval',
    'never',
    '--no-alt-screen',
    input.prompt,
  ];
}

export function systemTerminalCodexCommandPreview(input: SystemTerminalCodexCommandPreviewInput) {
  return [
    `CODEX_HOME=${quoteShellArg(input.codexHome)}`,
    `SCIFORGE_CONFIG_PATH=${quoteShellArg(input.configPath)}`,
    'SCIFORGE_RUNTIME_API_KEY=<from config.local.json>',
    systemTerminalCodexShellCommand(input),
  ].join(' ');
}

export function systemTerminalLaunchScript(input: SystemTerminalLaunchScriptInput) {
  const command = systemTerminalCodexShellCommand(input);
  return [
    '#!/bin/zsh',
    'set -e',
    `cd ${quoteShellArg(input.workspace)}`,
    `export CODEX_HOME=${quoteShellArg(input.codexHome)}`,
    `export PATH=${quoteShellArg(input.path)}`,
    ...systemTerminalRuntimeEnvExports(input),
    `printf '%s\\n' ${quoteShellArg('SciForge Codex repair session')}`,
    `printf '%s\\n' ${quoteShellArg(`Workspace: ${input.workspace}`)}`,
    `printf '%s\\n' ${quoteShellArg(`Prompt: ${input.promptRef}`)}`,
    `printf '%s\\n' ${quoteShellArg('This system Terminal owns the Codex process; the SciForge Web Viewer is optional.')}`,
    'echo ""',
    'set +e',
    command,
    'status=$?',
    'echo ""',
    'echo "Codex exited with status ${status}."',
    'read "?Press Return to close this window..."',
    'exit "${status}"',
    '',
  ].join('\n');
}

export function systemTerminalCodexShellCommand(input: SystemTerminalCodexCommandInput) {
  const renderedArgs = input.args.map((arg) => arg === input.prompt
    ? `"$(cat ${quoteShellArg(input.promptRef)})"`
    : quoteShellArg(arg));
  return [quoteShellArg(input.codexCommand), ...renderedArgs].join(' ');
}

export function systemTerminalRuntimeEnvExports(input: {
  configPath: string;
  env: NodeJS.ProcessEnv;
}) {
  const lines = SYSTEM_TERMINAL_RUNTIME_ENV_KEYS
    .map((key) => {
      const value = key === 'SCIFORGE_CONFIG_PATH' ? input.configPath : stringValue(input.env[key]);
      return value ? `export ${key}=${quoteShellArg(value)}` : '';
    })
    .filter(Boolean);
  lines.push(
    'if [ -z "${SCIFORGE_RUNTIME_API_KEY:-}" ]; then',
    `  export SCIFORGE_RUNTIME_API_KEY="$(node -e ${quoteShellArg(systemTerminalRuntimeKeyReaderScript())} ${quoteShellArg(input.configPath)})"`,
    'fi',
    'if [ -z "${SCIFORGE_RUNTIME_API_KEY:-}" ]; then',
    `  printf '%s\\n' ${quoteShellArg('Missing SCIFORGE_RUNTIME_API_KEY. Check the ignored local provider config before Codex starts.')}`,
    'fi',
  );
  return lines;
}

export function systemTerminalRuntimeKeyReaderScript() {
  const keyPaths = JSON.stringify(LOCAL_PROVIDER_API_KEY_CANDIDATE_PATHS);
  return [
    'const fs = require("fs");',
    'const path = process.argv[1];',
    `const keyPaths = ${keyPaths};`,
    'const isRecord = (value) => value && typeof value === "object" && !Array.isArray(value);',
    'const stringValue = (value) => typeof value === "string" && value.trim() ? value.trim() : "";',
    'const valueAtPath = (root, path) => path.reduce((current, key) => isRecord(current) ? current[key] : undefined, root);',
    'try {',
    '  const root = JSON.parse(fs.readFileSync(path, "utf8"));',
    '  for (const keyPath of keyPaths) {',
    '    const key = stringValue(valueAtPath(root, keyPath));',
    '    if (key) { process.stdout.write(key); break; }',
    '  }',
    '} catch {}',
  ].join(' ');
}

export function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function withCodexPtyPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const fallbackDirs = ['/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin', '/usr/bin', '/bin'];
  const existing = (env.PATH || '').split(':').filter(Boolean);
  return {
    ...env,
    PATH: uniqueStrings([...existing, ...fallbackDirs]).join(':'),
  };
}

export async function resolveCodexPtyCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  options: ResolveCodexPtyCommandOptions = {},
) {
  if (isAbsolute(command) || command.includes(sep)) return command;
  const exists = options.fileExists ?? fileExists;
  for (const dir of (env.PATH || '').split(':').filter(Boolean)) {
    const candidate = join(dir, command);
    if (await exists(candidate)) return candidate;
  }
  return command;
}

export async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function buildFeedbackCodexTerminalRepairRun(input: BuildFeedbackCodexTerminalRepairRunInput) {
  const session = input.session;
  const comment = input.comment ?? {};
  const body = input.body ?? {};
  const instanceId = input.instanceId ?? process.env.SCIFORGE_INSTANCE_ID ?? process.env.SCIFORGE_INSTANCE ?? 'default';
  const instanceRole = input.instanceRole ?? process.env.SCIFORGE_INSTANCE_ROLE ?? instanceId;
  return {
    schemaVersion: 1,
    id: session.repairRunId,
    issueId: session.issueId,
    status: 'running',
    externalInstanceId: instanceId,
    externalInstanceName: instanceRole,
    actor: session.transport === 'system-terminal' ? 'system-terminal-codex' : 'direct-codex-web-viewer',
    startedAt: session.startedAt,
    note: session.transport === 'system-terminal'
      ? 'Codex repair started from Feedback Inbox in macOS Terminal. The web surface is an optional viewer, not the process owner.'
      : 'Codex repair started from Feedback Inbox. UI is attached to a WebSocket/xterm PTY running the Codex CLI.',
    terminalMirrorRef: session.terminalMirrorRef,
    planRef: session.promptRef,
    terminalMirror: [
      { timestamp: session.startedAt, stream: 'event' as const, text: `Codex repair session started for ${session.issueId}.` },
      { timestamp: session.startedAt, stream: 'event' as const, text: session.transport === 'system-terminal'
        ? 'Launch surface=system-terminal; macOS Terminal owns the Codex process.'
        : 'Launch surface=web-viewer; xterm is attached to a backend-owned Codex CLI PTY.' },
    ],
    confirmationPolicy: {
      commit: 'requires-user-confirmation',
      push: 'requires-second-confirmation',
      pr: 'requires-second-confirmation',
      merge: 'never',
    },
    metadata: {
      handoffKind: 'direct-codex-terminal',
      executorBackend: 'runtime-codex',
      terminalTransport: session.transport,
      terminalMode: session.transport === 'system-terminal' ? 'system-terminal-codex' : 'interactive-codex-pty',
      directCodexTerminalSessionId: session.id,
      codexSessionId: session.codexSessionId,
      runtimeProfile: session.runtimeProfile,
      allowOpenAiRuntime: session.allowOpenAiRuntime === true,
      targetWorkspacePath: session.workspacePath,
      promptRef: session.promptRef,
      webSocketPath: session.webSocketPath,
      systemTerminalLaunchRef: session.systemTerminalLaunchRef,
      systemTerminalCommandPreview: session.systemTerminalCommandPreview,
      evidenceRefs: feedbackPromptEvidenceRefs(comment),
      initialTerminalGuidance: stringField(body.initialMessage),
      userGitMode: stringField(body.gitMode) || 'manual-git-default',
    },
  };
}
