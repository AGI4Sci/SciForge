import React from 'react';
import type { UIComponentRendererProps } from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function arrayPayload(slot: UIComponentRendererProps['slot'], artifact?: UIComponentRendererProps['artifact']): Record<string, unknown>[] {
  const payload = artifact?.data ?? slot.props?.rows ?? slot.props;
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (isRecord(payload) && Array.isArray(payload.rows)) return payload.rows.filter(isRecord);
  return [];
}

function compareValue(left: unknown, op: string, right: unknown) {
  const leftNumber = typeof left === 'number' ? left : typeof left === 'string' ? Number(left) : Number.NaN;
  const rightNumber = typeof right === 'number' ? right : typeof right === 'string' ? Number(right) : Number.NaN;
  if (op === '<=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber <= rightNumber;
  if (op === '>=' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber >= rightNumber;
  if (op === '<' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber < rightNumber;
  if (op === '>' && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber > rightNumber;
  if (op === '!=' || op === '!==') return String(left ?? '') !== String(right ?? '');
  return String(left ?? '') === String(right ?? '');
}

export function applyDataTableTransforms(rows: Record<string, unknown>[], slot: UIComponentRendererProps['slot']) {
  return (slot.transform ?? []).reduce((current, transform) => {
    if (transform.type === 'filter' && transform.field) {
      return current.filter((row) => compareValue(row[transform.field ?? ''], transform.op ?? '==', transform.value));
    }
    if (transform.type === 'sort' && transform.field) {
      return [...current].sort((left, right) => String(left[transform.field ?? ''] ?? '').localeCompare(String(right[transform.field ?? ''] ?? '')));
    }
    if (transform.type === 'limit') {
      const limit = typeof transform.value === 'number' ? transform.value : Number(transform.value);
      return Number.isFinite(limit) && limit >= 0 ? current.slice(0, limit) : current;
    }
    return current;
  }, rows);
}

export function dataTableCompositionSummary(slot: UIComponentRendererProps['slot']) {
  const encoding = slot.encoding ?? {};
  return [
    encoding.colorBy ? `colorBy=${encoding.colorBy}` : undefined,
    encoding.splitBy ? `splitBy=${encoding.splitBy}` : undefined,
    encoding.overlayBy ? `overlayBy=${encoding.overlayBy}` : undefined,
    encoding.facetBy ? `facetBy=${encoding.facetBy}` : undefined,
    encoding.syncViewport ? 'syncViewport=true' : undefined,
    slot.layout?.mode ? `layout=${slot.layout.mode}` : undefined,
    slot.compare?.mode ? `compare=${slot.compare.mode}` : undefined,
  ].filter(Boolean).join(' · ');
}

export function renderDataTable(props: UIComponentRendererProps) {
  const { slot, artifact, session, helpers } = props;
  const rows = applyDataTableTransforms(arrayPayload(slot, artifact), slot);
  const ArtifactSourceBar = helpers?.ArtifactSourceBar;
  const ArtifactDownloads = helpers?.ArtifactDownloads;
  const ComponentEmptyState = helpers?.ComponentEmptyState;
  if (!artifact || !rows.length) {
    return (
      <div className="stack">
        {ArtifactDownloads ? <ArtifactDownloads artifact={artifact} /> : null}
        {ComponentEmptyState ? (
          <ComponentEmptyState componentId="data-table" artifactType={artifact?.type ?? 'knowledge-graph'} detail={!artifact ? undefined : `当前 ${artifact.type} 没有可表格化 rows；请打开 Artifact Inspector 检查 payload。`} />
        ) : (
          <p className="empty-state">No table rows available.</p>
        )}
      </div>
    );
  }
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 5);
  const composition = dataTableCompositionSummary(slot);
  return (
    <div className="stack">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={artifact} session={session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={artifact} /> : null}
      {composition ? <div className="composition-strip"><code>{composition}</code></div> : null}
      <div className="artifact-table">
        <div className="artifact-table-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
          {columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {rows.map((row, index) => (
          <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(120px, 1fr))` }}>
            {columns.map((column) => <span key={column}>{String(row[column] ?? '-')}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}
