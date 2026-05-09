import { spawn } from 'node:child_process';
import { delimiter, resolve } from 'node:path';
import type { ConversationPolicyRequest, ConversationPolicyResponse } from './contracts.js';
import { normalizeConversationPolicyResponse } from './contracts.js';
import { errorMessage } from '../gateway-utils.js';

export type ConversationPolicyBridgeMode = 'off' | 'active';

export interface ConversationPolicyBridgeConfig {
  mode: ConversationPolicyBridgeMode;
  command: string;
  args: string[];
  timeoutMs: number;
  pythonPath?: string;
}

export type ConversationPolicyBridgeResult =
  | { ok: true; response: ConversationPolicyResponse; stderr?: string }
  | { ok: false; error: string; stderr?: string; exitCode?: number | null; signal?: NodeJS.Signals | null; timedOut?: boolean };

const DEFAULT_POLICY_MODULE = 'sciforge_conversation.service';

export function conversationPolicyBridgeConfig(env: NodeJS.ProcessEnv = process.env): ConversationPolicyBridgeConfig {
  const configuredMode = env.SCIFORGE_CONVERSATION_POLICY_MODE;
  const mode = configuredMode === 'off' || configuredMode === 'active'
    ? configuredMode
    : 'active';
  const command = env.SCIFORGE_CONVERSATION_POLICY_PYTHON || 'python3';
  const moduleName = env.SCIFORGE_CONVERSATION_POLICY_MODULE || DEFAULT_POLICY_MODULE;
  const timeout = Number(env.SCIFORGE_CONVERSATION_POLICY_TIMEOUT_MS || '');
  const pythonPath = env.SCIFORGE_CONVERSATION_POLICY_PYTHONPATH
    || resolve(process.cwd(), 'packages/reasoning/conversation-policy/src');
  return {
    mode,
    command,
    args: ['-m', moduleName],
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 3500,
    pythonPath,
  };
}

export async function callPythonConversationPolicy(
  request: ConversationPolicyRequest,
  config: ConversationPolicyBridgeConfig,
): Promise<ConversationPolicyBridgeResult> {
  if (config.mode === 'off') return { ok: false, error: 'conversation policy bridge is disabled' };
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    const pythonPath = config.pythonPath
      ? [config.pythonPath, process.env.PYTHONPATH].filter(Boolean).join(delimiter)
      : process.env.PYTHONPATH;
    const child = spawn(config.command, config.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(pythonPath ? { PYTHONPATH: pythonPath } : {}) },
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      resolve({ ok: false, error: `conversation policy timed out after ${config.timeoutMs}ms`, stderr, timedOut: true });
    }, config.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdin.on('error', () => {
      // Python may fail before stdin is flushed; callers handle bridge failure explicitly.
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: errorMessage(error), stderr });
    });
    child.on('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (exitCode !== 0) {
        resolve({ ok: false, error: `conversation policy exited with code ${exitCode ?? 'null'}`, stderr, exitCode, signal });
        return;
      }
      try {
        const parsed = JSON.parse(stdout) as unknown;
        const response = normalizeConversationPolicyResponse(parsed);
        if (!response) {
          resolve({ ok: false, error: 'conversation policy returned an unsupported response schema', stderr, exitCode, signal });
          return;
        }
        resolve({ ok: true, response, stderr });
      } catch (error) {
        resolve({ ok: false, error: `conversation policy returned invalid JSON: ${errorMessage(error)}`, stderr, exitCode, signal });
      }
    });
    child.stdin.end(`${JSON.stringify(request)}\n`, 'utf8');
  });
}
