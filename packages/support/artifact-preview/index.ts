export type {
  ArtifactPreviewAction,
  PreviewDerivative,
  PreviewDerivativeKind,
  PreviewDescriptor,
  PreviewDescriptorKind,
  PreviewDescriptorSource,
  PreviewInlinePolicy,
} from '@sciforge-ui/runtime-contract/preview';

import type { PreviewDescriptor } from '@sciforge-ui/runtime-contract/preview';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

export function uniquePreviewStrings<T extends string>(values: T[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function mergePreviewDescriptors(local: PreviewDescriptor, hydrated: PreviewDescriptor): PreviewDescriptor {
  return {
    ...local,
    ...hydrated,
    title: local.title || hydrated.title,
    diagnostics: uniquePreviewStrings([...(local.diagnostics ?? []), ...(hydrated.diagnostics ?? [])]),
    derivatives: mergePreviewDerivatives(local.derivatives, hydrated.derivatives),
    actions: uniquePreviewStrings([...(local.actions ?? []), ...(hydrated.actions ?? [])]) as PreviewDescriptor['actions'],
    locatorHints: uniquePreviewStrings([...(local.locatorHints ?? []), ...(hydrated.locatorHints ?? [])]) as PreviewDescriptor['locatorHints'],
  };
}

export function descriptorWithDiagnostic(descriptor: PreviewDescriptor, error: unknown): PreviewDescriptor {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ...descriptor,
    diagnostics: uniquePreviewStrings([...(descriptor.diagnostics ?? []), `Workspace Writer descriptor hydration failed: ${message}`]),
  };
}

export function normalizePreviewDerivative(value: unknown): NonNullable<PreviewDescriptor['derivatives']>[number] | undefined {
  if (!isRecord(value)) return undefined;
  const kind = asString(value.kind);
  const ref = asString(value.ref);
  if (!kind || !ref) return undefined;
  return {
    kind: kind as NonNullable<PreviewDescriptor['derivatives']>[number]['kind'],
    ref,
    mimeType: asString(value.mimeType),
    sizeBytes: asNumber(value.sizeBytes),
    hash: asString(value.hash),
    generatedAt: asString(value.generatedAt),
    status: value.status === 'available' || value.status === 'lazy' || value.status === 'failed' || value.status === 'unsupported' ? value.status : undefined,
    diagnostics: asStringList(value.diagnostics),
  };
}

function mergePreviewDerivatives(left: PreviewDescriptor['derivatives'], right: PreviewDescriptor['derivatives']) {
  const byKey = new Map<string, NonNullable<PreviewDescriptor['derivatives']>[number]>();
  for (const derivative of [...(left ?? []), ...(right ?? [])]) {
    byKey.set(`${derivative.kind}:${derivative.ref}`, { ...byKey.get(`${derivative.kind}:${derivative.ref}`), ...derivative });
  }
  return byKey.size ? Array.from(byKey.values()) : undefined;
}
