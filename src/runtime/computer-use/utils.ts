import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

export function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

export function envOrValue(...values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

export function stringConfig(...values: unknown[]) {
  const value = envOrValue(...values);
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function numberConfig(...values: unknown[]) {
  const value = envOrValue(...values);
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function booleanConfig(env: unknown, requestValue: unknown, fileValue: unknown, fallback: boolean) {
  const value = envOrValue(env, requestValue, fileValue);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^(1|true|yes|on|enabled)$/i.test(value)) return true;
    if (/^(0|false|no|off|disabled)$/i.test(value)) return false;
  }
  return fallback;
}

export function parseDisplayList(value: unknown) {
  if (Array.isArray(value)) return value.map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0);
  if (typeof value !== 'string') return [];
  return value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isInteger(item) && item > 0);
}

export function extractChatCompletionContent(value: unknown) {
  if (!isRecordLike(value) || !Array.isArray(value.choices)) return '';
  const first = value.choices[0];
  if (!isRecordLike(first) || !isRecordLike(first.message)) return '';
  return typeof first.message.content === 'string' ? first.message.content : '';
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const direct = parseJson(trimmed);
  if (direct !== undefined) return direct;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = parseJson(fenced[1].trim());
    if (parsed !== undefined) return parsed;
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = parseJson(trimmed.slice(start, end + 1));
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

export function pngDimensions(bytes: Buffer) {
  if (bytes.length < 24) return undefined;
  if (bytes.readUInt32BE(0) !== 0x89504e47 || bytes.readUInt32BE(4) !== 0x0d0a1a0a) return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

export function platformLabel(platform: string) {
  if (isDarwinPlatform(platform)) return 'macOS';
  if (isWindowsPlatform(platform)) return 'Windows';
  if (/^linux$/i.test(platform)) return 'Linux';
  return platform;
}

export function isDarwinPlatform(platform: string) {
  return /^(darwin|mac|macos|osx)$/i.test(platform.trim());
}

export function isWindowsPlatform(platform: string) {
  return /^(win32|windows|win)$/i.test(platform.trim());
}

export function supportsBuiltinDesktopBridge(platform: string) {
  return isDarwinPlatform(platform);
}

export async function detectCaptureDisplays() {
  if (process.platform !== 'darwin') return [1];
  const probe = await runCommand('screencapture', ['-x', '-D', '999999', '/dev/null'], { timeoutMs: 5000 });
  const range = String(probe.stderr || probe.stdout).match(/number from\s+(\d+)\s*-\s*(\d+)/i);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }
  }
  const primary = await runCommand('screencapture', ['-x', '-D', '1', '/dev/null'], { timeoutMs: 5000 });
  return primary.exitCode === 0 ? [1] : [1];
}

export async function runCommand(command: string, args: string[], options: { timeoutMs: number }) {
  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolvePromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, options.timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: 127, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolvePromise({ exitCode: code ?? (signal ? 143 : 1), stdout, stderr });
    });
  });
}

export function sleep(ms: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}

export function workspaceRel(workspace: string, absPath: string) {
  const resolvedWorkspace = resolve(workspace);
  const resolvedPath = resolve(absPath);
  if (resolvedPath === resolvedWorkspace) return '.';
  if (resolvedPath.startsWith(`${resolvedWorkspace}/`)) return resolvedPath.slice(resolvedWorkspace.length + 1);
  return resolvedPath;
}

export function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'vision-run';
}

export function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function appleScriptString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

export function swiftString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

export function swiftOptionalString(value: string | undefined) {
  return value ? `Optional(${swiftString(value)})` : 'nil';
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
