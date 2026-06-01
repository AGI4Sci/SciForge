import type { SciForgeRun, SciForgeSession } from '../../domain';
import type { ComposerAgentHostCatalogItem } from './composerToolMenu';

export function composerAgentHostCatalogForSession(session: SciForgeSession): ComposerAgentHostCatalogItem[] {
  return uniqueCatalogItems(session.runs.slice(-8).flatMap(composerAgentHostCatalogForRun));
}

export function composerAgentHostCatalogForRun(run: SciForgeRun): ComposerAgentHostCatalogItem[] {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  if (!raw) return [];
  return uniqueCatalogItems([
    ...catalogItemsFromToolResults(toolResultRecordsFromRaw(raw)),
    ...catalogItemsFromContainer(raw.moduleCatalog),
    ...catalogItemsFromContainer(raw.agentHostCatalog),
    ...catalogItemsFromContainer(raw.capabilityCatalog),
  ]);
}

function toolResultRecordsFromRaw(raw: Record<string, unknown>): Record<string, unknown>[] {
  return [
    raw.capabilityDiscoveryToolResults,
    raw.moduleToolResults,
    raw.moduleQueryResults,
    raw.moduleReadResults,
    isRecord(raw.contextEnvelope) ? raw.contextEnvelope.capabilityDiscoveryToolResults : undefined,
    isRecord(raw.contextEnvelope) ? raw.contextEnvelope.moduleToolResults : undefined,
    isRecord(raw.contextEnvelope) ? raw.contextEnvelope.moduleQueryResults : undefined,
    isRecord(raw.contextEnvelope) ? raw.contextEnvelope.moduleReadResults : undefined,
    isRecord(raw.metadata) ? raw.metadata.capabilityDiscoveryToolResults : undefined,
    isRecord(raw.metadata) ? raw.metadata.moduleToolResults : undefined,
    isRecord(raw.input) && isRecord(raw.input.metadata) ? raw.input.metadata.capabilityDiscoveryToolResults : undefined,
    isRecord(raw.input) && isRecord(raw.input.metadata) ? raw.input.metadata.moduleToolResults : undefined,
  ].flatMap(toRecordList);
}

function catalogItemsFromToolResults(results: Record<string, unknown>[]) {
  return results.flatMap((result) => {
    const toolName = stringField(result.toolName) ?? stringField(result.name) ?? stringField(result.function);
    if (toolName && !isCatalogToolName(toolName)) return [];
    const payloads = [
      result.result,
      result.output,
      result.payload,
      result.data,
      result,
    ];
    return payloads.flatMap((payload) => catalogItemsFromContainer(payload));
  });
}

function isCatalogToolName(toolName: string) {
  return /^(?:module\.(?:query|read)|capability_discovery\.(?:search|plan|read|query))$/i.test(toolName.trim());
}

function catalogItemsFromContainer(value: unknown, inheritedGroup?: ComposerAgentHostCatalogItem['group']): ComposerAgentHostCatalogItem[] {
  if (Array.isArray(value)) return value.flatMap((item) => catalogItemsFromContainer(item, inheritedGroup));
  if (!isRecord(value)) return [];
  const own = catalogItemFromRecord(value, inheritedGroup);
  const nestedContainers: Array<[string, ComposerAgentHostCatalogItem['group'] | undefined]> = [
    ['candidates', 'skills' as const],
    ['capabilities', 'skills' as const],
    ['skills', 'skills' as const],
    ['tools', 'skills' as const],
    ['modules', 'skills' as const],
    ['apps', 'skills' as const],
    ['mcpServers', 'mcp' as const],
    ['mcp_servers', 'mcp' as const],
    ['servers', 'mcp' as const],
    ['connectors', 'mcp' as const],
    ['items', inheritedGroup],
    ['entries', inheritedGroup],
  ];
  const nested = nestedContainers.flatMap(([key, group]) => catalogItemsFromContainer(value[key], group));
  return own ? [own, ...nested] : nested;
}

function catalogItemFromRecord(record: Record<string, unknown>, inheritedGroup?: ComposerAgentHostCatalogItem['group']): ComposerAgentHostCatalogItem | undefined {
  const label = stringField(record.label) ?? stringField(record.title) ?? stringField(record.name);
  const capabilityId = stringField(record.capabilityId) ?? stringField(record.capability_id) ?? stringField(record.id);
  const moduleId = stringField(record.moduleId) ?? stringField(record.module_id);
  const hasIdentity = Boolean(label || capabilityId || moduleId);
  if (!hasIdentity) return undefined;
  return {
    label,
    title: stringField(record.title),
    name: stringField(record.name),
    capabilityId,
    moduleId,
    detail: stringField(record.detail),
    description: stringField(record.description),
    summary: stringField(record.summary),
    kind: stringField(record.kind),
    type: stringField(record.type),
    source: stringField(record.source),
    toolType: stringField(record.toolType) ?? stringField(record.tool_type),
    group: safeCatalogGroup(stringField(record.group)) ?? inheritedGroup,
  };
}

function safeCatalogGroup(value: string | undefined): ComposerAgentHostCatalogItem['group'] | undefined {
  if (!value) return undefined;
  if (/mcp|connector|server/i.test(value)) return 'mcp';
  if (/skill|tool|module|capability|app/i.test(value)) return 'skills';
  return undefined;
}

function uniqueCatalogItems(items: ComposerAgentHostCatalogItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.group ?? ''}:${item.kind ?? ''}:${item.type ?? ''}:${item.label ?? item.title ?? item.name ?? item.capabilityId ?? item.moduleId ?? ''}`.toLocaleLowerCase();
    if (!key.trim() || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toRecordList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
