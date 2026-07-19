import { isIP } from 'node:net';

export function isLoopbackHost(host: string): boolean {
  const normalized = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) return normalized.startsWith('127.');
  if (isIP(normalized) !== 6) return false;
  return new URL(`http://[${normalized}]`).hostname === '[::1]';
}

export function normalizeMountPath(value: string): string {
  if (value === '' || value === '/') return '';
  const normalized = value.replace(/\/+$/, '');
  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+$/.test(normalized)) {
    throw new Error(`Invalid Plan Gateway mount path: ${value}`);
  }
  return normalized;
}
