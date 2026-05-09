import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function nums(value: unknown): number[] { return Array.isArray(value) ? value.filter((entry): entry is number => typeof entry === 'number' && Number.isFinite(entry)) : []; }
function matrixFrom(value: unknown): { matrix: number[][]; rows: string[]; columns: string[]; label?: string } {
  const source = isRecord(value) && isRecord(value.heatmap) ? value.heatmap : isRecord(value) && isRecord(value.confusionMatrix) ? value.confusionMatrix : value;
  const matrix = isRecord(source) ? ((Array.isArray(source.matrix) ? source.matrix : source.values) as unknown[] | undefined)?.map(nums).filter((row) => row.length) ?? [] : [];
  const rows = isRecord(source) && Array.isArray(source.rows) ? source.rows.map(String) : isRecord(source) && Array.isArray(source.labels) ? source.labels.map(String) : [];
  const columns = isRecord(source) && Array.isArray(source.columns) ? source.columns.map(String) : isRecord(source) && Array.isArray(source.labels) ? source.labels.map(String) : [];
  const label = isRecord(source) && typeof source.label === 'string' ? source.label : undefined;
  return { matrix, rows, columns, label };
}
function color(value: number, min: number, max: number) {
  const t = max === min ? 0.5 : (value - min) / (max - min);
  const red = Math.round(255 * t);
  const blue = Math.round(255 * (1 - t));
  return `rgb(${red}, 88, ${blue})`;
}
export function renderMatrixViewer(props: UIComponentRendererProps) {
  const payload = props.artifact?.data ?? props.slot.props;
  const { matrix, rows, columns, label } = matrixFrom(payload);
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  if (!props.artifact || !matrix.length) return <div className="stack">{ComponentEmptyState ? <ComponentEmptyState componentId="matrix-viewer" artifactType={props.artifact?.type ?? 'matrix'} detail={!props.artifact ? undefined : 'Matrix viewer requires numeric matrix values.'} /> : <p>No matrix values.</p>}</div>;
  const flat = matrix.flat();
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  return (
    <div className="stack matrix-viewer" data-component-id="matrix-viewer">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      <div className="slot-meta"><code>{matrix.length}x{matrix[0]?.length ?? 0}</code>{label ? <code>{label}</code> : null}</div>
      <div className="artifact-table">
        {matrix.slice(0, 24).map((row, rowIndex) => (
          <div className="artifact-table-row" key={rowIndex} style={{ gridTemplateColumns: `120px repeat(${row.length}, minmax(44px, 1fr))` }}>
            <span>{rows[rowIndex] ?? `row ${rowIndex + 1}`}</span>
            {row.map((value, columnIndex) => <span key={columnIndex} title={`${columns[columnIndex] ?? columnIndex}: ${value}`} style={{ background: color(value, min, max), color: '#fff', textAlign: 'center' }}>{value.toFixed(2)}</span>)}
          </div>
        ))}
      </div>
    </div>
  );
}
