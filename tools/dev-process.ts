import { resolve } from 'node:path';

export interface DevProcessOwnershipInput {
  command: string;
  cwd?: string;
  repoRoot: string;
  port: number;
}

export interface DevProcessOwnershipRecord {
  service: string;
  repoRoot: string;
  port: number;
  instance?: string;
  launcherPid?: number;
  childPid?: number;
  token: string;
  startedAt?: string;
}

export function parseListeningPids(stdout: string) {
  return stdout
    .split(/\s+/)
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

export function isSciForgeViteDevProcess(input: DevProcessOwnershipInput) {
  const repoRoot = normalizePath(resolve(input.repoRoot));
  const cwd = input.cwd ? normalizePath(resolve(input.cwd)) : '';
  if (cwd !== repoRoot) return false;

  const command = normalizePath(input.command);
  const expectedBins = [
    `${repoRoot}/node_modules/.bin/vite`,
    `${repoRoot}/node_modules/vite/bin/vite.js`,
  ];
  if (!expectedBins.some((bin) => command.includes(bin))) return false;
  if (!hasPortArg(command, input.port)) return false;
  return /(?:^|\s)--strictPort(?:\s|$)/.test(command);
}

export function normalizeDevProcessOwnershipRecord(value: unknown): DevProcessOwnershipRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const service = stringField(record.service);
  const repoRoot = stringField(record.repoRoot);
  const token = stringField(record.token);
  const port = typeof record.port === 'number' && Number.isInteger(record.port) ? record.port : undefined;
  if (!service || !repoRoot || !token || token.length < 16 || port === undefined) return undefined;
  return {
    service,
    repoRoot,
    port,
    instance: stringField(record.instance),
    launcherPid: integerField(record.launcherPid),
    childPid: integerField(record.childPid),
    token,
    startedAt: stringField(record.startedAt),
  };
}

export function isOwnedSciForgeViteDevProcess(input: DevProcessOwnershipInput & {
  envText: string;
  record?: unknown;
}) {
  const record = normalizeDevProcessOwnershipRecord(input.record);
  if (!record) return false;
  if (record.service !== 'ui') return false;
  if (record.port !== input.port) return false;
  if (normalizePath(resolve(record.repoRoot)) !== normalizePath(resolve(input.repoRoot))) return false;
  if (!isSciForgeViteDevProcess(input)) return false;
  return input.envText.includes(`SCIFORGE_DEV_LAUNCHER_TOKEN=${record.token}`)
    || input.envText.includes(record.token);
}

function hasPortArg(command: string, port: number) {
  const escapedPort = escapeRegExp(String(port));
  return new RegExp(`(?:^|\\s)--port(?:\\s+|=)${escapedPort}(?:\\s|$)`).test(command);
}

function normalizePath(value: string) {
  return value.replaceAll('\\', '/').replace(/\/+$/, '');
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function integerField(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
