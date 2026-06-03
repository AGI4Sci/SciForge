export const DESKTOP_NATIVE_READINESS_SCHEMA = 'sciforge.desktop.native-readiness.v1' as const;

export type DesktopNativeReadinessCapabilityKey = 'browser' | 'annotation' | 'image' | 'windowAction';

export type DesktopNativeReadinessCapabilityInput = {
  available?: boolean;
  ready?: boolean;
  reason?: string;
};

export type DesktopNativeReadinessInput = {
  adapterUrl?: string;
  refs?: Partial<Record<DesktopNativeReadinessCapabilityKey, string[]>>;
  capabilities?: Partial<Record<DesktopNativeReadinessCapabilityKey, DesktopNativeReadinessCapabilityInput>>;
};

export type DesktopNativeReadinessCapability = {
  status: 'ready' | 'blocked' | 'unavailable';
  available: boolean;
  ready: boolean;
  loopbackTrusted: boolean;
  adapterOrigin?: string;
  diagnosticRefs: string[];
  reason?: string;
};

export type DesktopNativeReadiness = {
  schemaVersion: typeof DESKTOP_NATIVE_READINESS_SCHEMA;
  generatedAt: string;
  capabilities: Record<DesktopNativeReadinessCapabilityKey, DesktopNativeReadinessCapability>;
};

const CAPABILITY_KEYS: DesktopNativeReadinessCapabilityKey[] = ['browser', 'annotation', 'image', 'windowAction'];

export function buildDesktopNativeReadiness(input: DesktopNativeReadinessInput = {}): DesktopNativeReadiness {
  const adapterOrigin = loopbackAdapterOrigin(input.adapterUrl);
  const loopbackTrusted = Boolean(adapterOrigin);
  return {
    schemaVersion: DESKTOP_NATIVE_READINESS_SCHEMA,
    generatedAt: new Date().toISOString(),
    capabilities: Object.fromEntries(CAPABILITY_KEYS.map((key) => {
      const capability = input.capabilities?.[key] ?? {};
      const available = capability.available === true;
      const ready = available && capability.ready === true;
      const status = ready ? 'ready' : available ? 'blocked' : 'unavailable';
      return [key, {
        status,
        available,
        ready,
        loopbackTrusted,
        ...(adapterOrigin ? { adapterOrigin } : {}),
        diagnosticRefs: boundedDiagnosticRefs(input.refs?.[key] ?? []),
        ...(capability.reason ? { reason: sanitizeDiagnosticText(capability.reason) } : {}),
      }];
    })) as Record<DesktopNativeReadinessCapabilityKey, DesktopNativeReadinessCapability>,
  };
}

function loopbackAdapterOrigin(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    const hostname = url.hostname.toLowerCase();
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1' && hostname !== '[::1]') return undefined;
    const normalizedHost = hostname === 'localhost' ? '127.0.0.1' : hostname === '[::1]' ? '::1' : hostname;
    const port = url.port ? `:${url.port}` : '';
    return `${url.protocol}//${normalizedHost}${port}`;
  } catch {
    return undefined;
  }
}

function boundedDiagnosticRefs(refs: string[]): string[] {
  return refs
    .filter((ref) => /^[a-z][a-z0-9._:-]+\/[a-z0-9._:/-]+$/i.test(ref))
    .filter((ref) => !/^https?:|^file:|^data:|;base64/i.test(ref))
    .map((ref) => ref.slice(0, 240))
    .slice(0, 12);
}

function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\b(?:apiKey|token|key)=\S+/gi, '[redacted]')
    .replace(/data:image\/[A-Za-z0-9.+-]+;base64,\S+/gi, '[redacted-image]')
    .replace(/\bbase64\b/gi, '[redacted]')
    .slice(0, 400);
}
