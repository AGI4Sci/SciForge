import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type ElectronShellBoundary = {
  schemaVersion: 'sciforge.desktop.electron-boundary.v1';
  rendererEntry: string;
  rendererSource: 'vite-build-artifact';
  runtimeTransport: {
    kind: 'ipc-or-loopback';
    controlUrl: string;
  };
  forbiddenMainProcessResponsibilities: string[];
};

export type ElectronShellBoundaryOptions = {
  rendererDistPath: string;
  runtimeControlUrl: string;
  requireExistingBuild?: boolean;
};

export function createElectronShellBoundary(options: ElectronShellBoundaryOptions): ElectronShellBoundary {
  assertLoopbackHttpUrl(options.runtimeControlUrl);
  const rendererDistPath = resolve(options.rendererDistPath);
  const rendererEntry = join(rendererDistPath, 'index.html');
  if (looksLikeViteDevServer(options.rendererDistPath) || looksLikeViteDevServer(options.runtimeControlUrl)) {
    throw new Error('Electron main must load vite build artifacts and must not treat Vite dev server URLs as the production renderer contract.');
  }
  if (options.requireExistingBuild === true && !existsSync(rendererEntry)) {
    throw new Error(`Electron renderer build entry is missing: ${rendererEntry}`);
  }
  return {
    schemaVersion: 'sciforge.desktop.electron-boundary.v1',
    rendererEntry,
    rendererSource: 'vite-build-artifact',
    runtimeTransport: {
      kind: 'ipc-or-loopback',
      controlUrl: options.runtimeControlUrl,
    },
    forbiddenMainProcessResponsibilities: [
      'agent reasoning',
      'provider routing',
      'workspace task execution policy',
      'React presentation business logic',
      'Vite dev server startup',
    ],
  };
}

function looksLikeViteDevServer(value: string): boolean {
  return /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:5173|5174|5175|5176|5177|5178|5179|5180)\b/.test(value);
}

function assertLoopbackHttpUrl(value: string): void {
  const parsed = new URL(value);
  const isLoopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !isLoopback) {
    throw new Error(`Desktop renderer transport must use controlled loopback or IPC, got: ${value}`);
  }
}
