import { resolve } from 'node:path';

export interface UiDevServerProbe {
  label: string;
  path: string;
  bodyIncludes?: string[];
}

export interface UiDevServerProbeResult extends UiDevServerProbe {
  ok: boolean;
  status?: number;
  detail?: string;
}

export interface UiDevServerHealth {
  ok: boolean;
  probes: UiDevServerProbeResult[];
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'text'>>;

const DEFAULT_UI_HEALTH_TIMEOUT_MS = 2500;
const MAX_DETAIL_LENGTH = 240;

export function uiDevServerProbePaths(repoRoot = process.cwd()): UiDevServerProbe[] {
  return [{
    label: 'sciforge-index',
    path: '/',
    bodyIncludes: ['<title>SciForge</title>', '/src/main.tsx'],
  }, {
    label: 'vite-client',
    path: '/@vite/client',
  }, {
    label: 'ui-entry-module',
    path: '/src/main.tsx',
  }, {
    label: 'scenario-builder-module',
    path: '/src/app/ScenarioBuilderPanel.tsx',
  }, {
    label: 'runtime-contract-barrel',
    path: viteFsPath(resolve(repoRoot, 'packages/contracts/runtime/index.ts')),
  }];
}

export async function readUiDevServerHealth(
  port: number,
  repoRoot = process.cwd(),
  options: {
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {},
): Promise<UiDevServerHealth> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_UI_HEALTH_TIMEOUT_MS;
  const baseUrl = `http://127.0.0.1:${port}`;
  const probes: UiDevServerProbeResult[] = [];

  for (const probe of uiDevServerProbePaths(repoRoot)) {
    const url = new URL(probe.path, baseUrl);
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      const body = await response.text().catch(() => '');
      const missingBodyMarkers = response.ok
        ? (probe.bodyIncludes ?? []).filter((marker) => !body.includes(marker))
        : [];
      probes.push({
        ...probe,
        ok: response.ok && !missingBodyMarkers.length,
        status: response.status,
        detail: response.ok
          ? missingBodyMarkers.length ? `missing marker(s): ${missingBodyMarkers.join(', ')}` : undefined
          : compactProbeDetail(body),
      });
    } catch (error) {
      probes.push({
        ...probe,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    ok: probes.every((probe) => probe.ok),
    probes,
  };
}

export function formatUiDevServerHealth(health: UiDevServerHealth): string {
  const failed = health.probes.find((probe) => !probe.ok);
  if (!failed) return 'UI dev server probes passed.';
  const status = failed.status ? `HTTP ${failed.status}` : 'request failed';
  return `${failed.label} probe failed (${status})${failed.detail ? `: ${failed.detail}` : ''}`;
}

function viteFsPath(absolutePath: string) {
  const normalized = absolutePath.replaceAll('\\', '/');
  return `/@fs${normalized.startsWith('/') ? normalized : `/${normalized}`}`;
}

function compactProbeDetail(body: string) {
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > MAX_DETAIL_LENGTH ? `${text.slice(0, MAX_DETAIL_LENGTH)}...` : text;
}
