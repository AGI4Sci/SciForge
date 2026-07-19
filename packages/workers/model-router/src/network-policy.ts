import { isIP } from 'node:net';

/**
 * Model Router is a local sidecar.  Never allow a caller-provided host to
 * widen that boundary to a LAN/public interface.  Host names are rejected on
 * purpose: even `localhost` can resolve differently across environments and
 * would make the binding policy depend on resolver state.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = normalizeHost(host);
  const addressFamily = isIP(normalized);
  if (addressFamily === 4) return normalized.startsWith('127.');
  if (addressFamily !== 6) return false;
  return normalized === '::1';
}

export function assertLoopbackBinding(host: string): void {
  if (!isLoopbackHost(host)) {
    throw new Error(`Model Router can bind only to a loopback IP address: ${host}`);
  }
}

export function normalizeLoopbackHost(host: string): string {
  if (!isLoopbackHost(host)) {
    throw new Error(`Model Router can bind only to a loopback IP address: ${host}`);
  }
  return normalizeHost(host);
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[|\]$/g, '');
}
