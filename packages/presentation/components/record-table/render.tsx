import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsFromPayload(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ['rows', 'records', 'items', 'papers', 'nodes', 'sequences']) {
    const rows = value[key];
    if (Array.isArray(rows)) return rows.filter(isRecord);
  }
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

function applyTransforms(rows: Record<string, unknown>[], props: UIComponentRendererProps) {
  return (props.slot.transform ?? []).reduce((current, transform) => {
    if (transform.type === 'filter' && transform.field) return current.filter((row) => compareValue(row[transform.field ?? ''], transform.op ?? '==', transform.value));
    if (transform.type === 'sort' && transform.field) return [...current].sort((left, right) => String(left[transform.field ?? ''] ?? '').localeCompare(String(right[transform.field ?? ''] ?? '')));
    if (transform.type === 'limit') {
      const limit = typeof transform.value === 'number' ? transform.value : Number(transform.value);
      return Number.isFinite(limit) && limit >= 0 ? current.slice(0, limit) : current;
    }
    return current;
  }, rows);
}

export function renderRecordTable(props: UIComponentRendererProps) {
  const payload = props.artifact?.data ?? props.slot.props;
  const rows = applyTransforms(recordsFromPayload(payload), props);
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ArtifactDownloads = props.helpers?.ArtifactDownloads;
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  if (!props.artifact || !rows.length) {
    return <div className="stack">{ArtifactDownloads ? <ArtifactDownloads artifact={props.artifact} /> : null}{ComponentEmptyState ? <ComponentEmptyState componentId="record-table" artifactType={props.artifact?.type ?? 'record-set'} detail={!props.artifact ? undefined : `当前 ${props.artifact.type} 没有可表格化 rows。`} /> : <p>No records available.</p>}</div>;
  }
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))).slice(0, 8);
  const gridTemplateColumns = `repeat(${Math.max(1, columns.length)}, minmax(120px, 1fr))`;
  return (
    <div className="stack record-table" data-component-id="record-table">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={props.artifact} /> : null}
      <div className="artifact-table">
        <div className="artifact-table-head" style={{ gridTemplateColumns }}>
          {columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {rows.map((row, index) => (
          <div className="artifact-table-row" key={index} style={{ gridTemplateColumns }}>
            {columns.map((column) => <span key={column}>{String(row[column] ?? '-')}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}
