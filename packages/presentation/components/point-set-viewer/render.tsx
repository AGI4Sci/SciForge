import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

type Point = { x: number; y: number; label?: string; group?: string; selected?: boolean };
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function n(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && Number.isFinite(Number(value)) ? Number(value) : undefined; }
function s(value: unknown) { return typeof value === 'string' && value.trim() ? value : undefined; }
function rows(value: unknown) { return Array.isArray(value) ? value.filter(isRecord) : []; }
function pointsFrom(value: unknown): Point[] {
  const source = isRecord(value) ? value : {};
  const trace = Array.isArray(source.data) && isRecord(source.data[0]) ? source.data[0] : undefined;
  if (trace && Array.isArray(trace.x) && Array.isArray(trace.y)) {
    const traceY = trace.y;
    return trace.x.flatMap((xValue, index) => {
      const x = n(xValue); const y = n(traceY[index]);
      return x === undefined || y === undefined ? [] : [{ x, y, label: Array.isArray(trace.text) ? s(trace.text[index]) : undefined }];
    });
  }
  const pointRows = rows(source.umap).length ? rows(source.umap) : rows(source.points);
  return pointRows.flatMap((point) => {
    const x = n(point.x) ?? n(point.umap1) ?? n(point.logFC) ?? n(point.log2FC);
    const y = n(point.y) ?? n(point.umap2) ?? n(point.negLogP) ?? (n(point.pValue) !== undefined ? -Math.log10(Math.max(1e-300, n(point.pValue) ?? 1)) : undefined);
    return x === undefined || y === undefined ? [] : [{ x, y, label: s(point.label) ?? s(point.gene) ?? s(point.id), group: s(point.group) ?? s(point.cluster), selected: point.selected === true }];
  });
}
export function renderPointSetViewer(props: UIComponentRendererProps) {
  const payload = props.artifact?.data ?? props.slot.props;
  const points = pointsFrom(payload);
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  if (!props.artifact || !points.length) return <div className="stack">{ComponentEmptyState ? <ComponentEmptyState componentId="point-set-viewer" artifactType={props.artifact?.type ?? 'point-set'} detail={!props.artifact ? undefined : 'Point-set viewer requires coordinates.'} /> : <p>No points available.</p>}</div>;
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const sx = (x: number) => 20 + ((x - minX) / (maxX - minX || 1)) * 160;
  const sy = (y: number) => 180 - ((y - minY) / (maxY - minY || 1)) * 160;
  return (
    <div className="stack point-set-viewer" data-component-id="point-set-viewer">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      <div className="slot-meta"><code>{points.length} points</code>{isRecord(payload) && s(payload.preset) ? <code>preset={s(payload.preset)}</code> : null}{props.slot.encoding?.colorBy ? <code>colorBy={props.slot.encoding.colorBy}</code> : null}</div>
      <svg viewBox="0 0 200 200" role="img" aria-label="Point set preview" style={{ width: '100%', maxHeight: 320 }}>
        <line x1="20" y1="180" x2="180" y2="180" stroke="#94a3b8" />
        <line x1="20" y1="20" x2="20" y2="180" stroke="#94a3b8" />
        {points.map((point, index) => <circle key={index} cx={sx(point.x)} cy={sy(point.y)} r={point.selected ? 5 : 3.5} fill={point.selected ? '#f97316' : '#2563eb'}><title>{`${point.label ?? `point ${index + 1}`}: ${point.x}, ${point.y}`}</title></circle>)}
      </svg>
    </div>
  );
}
