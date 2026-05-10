import type {
  UIComponentManifest,
  UIComponentRenderer,
  UIComponentRuntimeArtifact,
} from '@sciforge-ui/runtime-contract';
import {
  normalizeUIComponentId,
  renderGraphViewer,
  renderMatrixViewer,
  renderPaperCardList,
  renderPointSetViewer,
  renderRecordTable,
  renderReportViewer,
  renderStructureViewer,
  uiComponentManifests,
} from '../components';
import { renderScientificPlotViewer } from '../components/scientific-plot-viewer/render';

type ResultSlotLike = {
  status?: string;
  slot: { artifactRef?: string };
  module: Pick<UIComponentManifest, 'componentId' | 'title' | 'acceptsArtifactTypes'>;
};

export type InteractiveViewPackageRendererEntry = {
  componentId: string;
  activeComponentId: string;
  label: string;
  render: UIComponentRenderer;
};

export type InteractiveArtifactDownloadItem = {
  key?: string;
  kind?: 'declared' | 'artifact-json';
  name: string;
  path?: string;
  contentType: string;
  rowCount?: number;
  content: string;
};

export type InteractiveArtifactInspectorTablePolicy = {
  rows: Record<string, unknown>[];
  columns: string[];
  rowLimit: number;
  gridTemplateColumns: string;
};

const packageRenderersByComponentId: Record<string, UIComponentRenderer> = {
  'report-viewer': renderReportViewer,
  'paper-card-list': renderPaperCardList,
  'structure-viewer': renderStructureViewer,
  'scientific-plot-viewer': renderScientificPlotViewer,
  'point-set-viewer': renderPointSetViewer,
  'matrix-viewer': renderMatrixViewer,
  'graph-viewer': renderGraphViewer,
  'record-table': renderRecordTable,
};

export function interactiveViewPackageRendererForComponent(componentId: string): InteractiveViewPackageRendererEntry | undefined {
  const activeComponentId = normalizeUIComponentId(componentId);
  const render = packageRenderersByComponentId[activeComponentId];
  if (!render) return undefined;
  return {
    componentId,
    activeComponentId,
    label: interactiveViewComponentLabel(componentId),
    render,
  };
}

export function interactiveViewComponentLabel(componentId: string) {
  const activeComponentId = normalizeUIComponentId(componentId);
  return uiComponentManifests.find((manifest) => manifest.componentId === activeComponentId)?.title
    ?? uiComponentManifests.find((manifest) => manifest.componentId === componentId)?.title
    ?? componentId;
}

export function interactiveUnknownComponentFallbackPolicy({
  componentId,
  artifactRef,
  artifactFound,
  slotTitle,
}: {
  componentId: string;
  artifactRef?: string;
  artifactFound?: boolean;
  slotTitle?: string;
}) {
  const title = slotTitle && slotTitle.trim() ? slotTitle : '未注册组件';
  return {
    title,
    subtitle: componentId,
    detail: 'Scenario 返回了未知 componentId。当前使用通用 inspector 展示 artifact、manifest 和日志引用。',
    missingArtifactDetail: artifactRef && !artifactFound ? `artifactRef 未找到：${artifactRef}` : undefined,
  };
}

export function interactiveResultSlotSubtitle(item: ResultSlotLike, artifact?: UIComponentRuntimeArtifact) {
  if (artifact) return `${artifact.type} · ${artifact.id}`;
  if (item.status === 'missing-fields') return `数据字段不完整 · ${item.slot.artifactRef ?? item.module.componentId}`;
  if (item.status === 'missing-artifact') return `等待 ${item.slot.artifactRef ?? item.module.acceptsArtifactTypes[0] ?? 'artifact'}`;
  return item.module.title;
}

export function interactiveArtifactDownloadItems(artifact?: UIComponentRuntimeArtifact): InteractiveArtifactDownloadItem[] {
  if (!artifact || artifactExportPolicy(artifact) === 'blocked') return [];
  const data = artifact?.data;
  const raw = isRecord(data) && Array.isArray(data.downloads) ? data.downloads : [];
  const declared = raw
    .filter(isRecord)
    .map((item) => ({
      key: asString(item.key),
      kind: 'declared' as const,
      name: asString(item.name) ?? asString(item.filename) ?? 'artifact-download.txt',
      path: asString(item.path),
      contentType: asString(item.contentType) ?? 'text/plain',
      rowCount: asNumber(item.rowCount),
      content: typeof item.content === 'string' ? item.content : '',
    }))
    .filter((item) => item.content.length > 0);
  return [...declared, interactiveArtifactJsonDownloadItem(artifact)].filter((item): item is InteractiveArtifactDownloadItem => Boolean(item));
}

export function interactiveArtifactJsonDownloadItem(artifact?: UIComponentRuntimeArtifact): InteractiveArtifactDownloadItem | undefined {
  if (!artifact || artifactExportPolicy(artifact) === 'blocked') return undefined;
  const payload = {
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    path: artifact.path,
    data: artifact.data,
  };
  return {
    key: `${artifact.id}-artifact-json`,
    kind: 'artifact-json',
    name: `${safeFileStem(artifact.id || artifact.type || 'artifact')}.artifact.json`,
    path: artifact.path ?? artifact.dataRef,
    contentType: 'application/json',
    content: JSON.stringify(payload, null, 2),
  };
}

export function interactiveArtifactInspectorTablePolicy(
  payload: unknown,
  options: { columnLimit?: number; rowLimit?: number } = {},
): InteractiveArtifactInspectorTablePolicy {
  const rows = Array.isArray(payload)
    ? payload.filter(isRecord)
    : isRecord(payload) && Array.isArray(payload.rows)
      ? payload.rows.filter(isRecord)
      : [];
  const columns = rows.length
    ? Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, options.columnLimit ?? 6)
    : [];
  const columnCount = Math.max(1, columns.length);
  return {
    rows,
    columns,
    rowLimit: options.rowLimit ?? 20,
    gridTemplateColumns: `repeat(${columnCount}, minmax(120px, 1fr))`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function artifactExportPolicy(artifact: UIComponentRuntimeArtifact) {
  const record = artifact as unknown as Record<string, unknown>;
  return asString(record.exportPolicy);
}

function safeFileStem(value: string) {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'artifact';
}
