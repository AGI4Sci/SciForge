import { isRecord } from './server/http.js';

export const LEGACY_TOOLS_RUN_STREAM_SCHEMA = 'sciforge.computer-use.legacy-workspace-gateway-diagnostic.v1';

const FORBIDDEN_LEGACY_STREAM_KEYS = new Set([
  'agentBackend',
  'agentServerBaseUrl',
  'modelProvider',
  'providerRoute',
  'selectedActionIds',
  'selectedToolIds',
  'selectedProviderIds',
  'toolProviderRoutes',
]);

export interface LegacyToolsRunStreamDecision {
  allowed: boolean;
  reason: string;
}

export function legacyToolsRunStreamDecision(body: unknown): LegacyToolsRunStreamDecision {
  if (!isRecord(body)) return blocked('legacy tools stream requires a structured diagnostic request body');
  const forbidden = forbiddenLegacyStreamKeys(body);
  if (forbidden.length) return blocked(`legacy tools stream diagnostic request contains forbidden route fields: ${forbidden.join(', ')}`);
  const uiState = isRecord(body.uiState) ? body.uiState : {};
  if (body.schemaVersion !== LEGACY_TOOLS_RUN_STREAM_SCHEMA) return blocked('legacy tools stream is sealed; use Runtime Codex stream for product turns');
  if (body.kind !== 'legacy-diagnostic-shim') return blocked('legacy tools stream only accepts the explicit legacy diagnostic shim');
  if (body.diagnosticOnly !== true) return blocked('legacy tools stream requires diagnosticOnly=true');
  if (uiState.legacyWorkspaceGatewayShim !== true || uiState.diagnosticOnly !== true) {
    return blocked('legacy tools stream requires uiState legacy diagnostic markers');
  }
  return { allowed: true, reason: 'legacy-diagnostic-shim' };
}

function blocked(reason: string): LegacyToolsRunStreamDecision {
  return { allowed: false, reason };
}

function forbiddenLegacyStreamKeys(value: Record<string, unknown>, prefix = ''): string[] {
  const found: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (FORBIDDEN_LEGACY_STREAM_KEYS.has(key)) found.push(path);
    if (isRecord(entry) && path !== 'diagnosticBoundary') found.push(...forbiddenLegacyStreamKeys(entry, path));
  }
  return found.slice(0, 12);
}
