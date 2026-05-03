import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}
function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}
function num(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function renderGraphViewer(props: UIComponentRendererProps) {
  const payload = isRecord(props.artifact?.data) ? props.artifact.data : props.slot.props ?? {};
  const nodes = records(payload.nodes);
  const edges = records(payload.edges);
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  if (!props.artifact || !nodes.length) {
    return <div className="stack">{ComponentEmptyState ? <ComponentEmptyState componentId="graph-viewer" artifactType={props.artifact?.type ?? 'graph'} detail={!props.artifact ? undefined : 'Graph artifact requires nodes and edges.'} /> : <p>No graph nodes available.</p>}</div>;
  }
  const radius = 82;
  const center = 100;
  const positioned = nodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(1, nodes.length);
    return { node, x: center + Math.cos(angle) * radius, y: center + Math.sin(angle) * radius };
  });
  const byId = new Map(positioned.map((item) => [String(item.node.id ?? item.node.label ?? ''), item]));
  return (
    <div className="stack graph-viewer" data-component-id="graph-viewer">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      <div className="slot-meta"><code>{nodes.length} nodes</code><code>{edges.length} edges</code>{props.slot.encoding?.colorBy ? <code>colorBy={props.slot.encoding.colorBy}</code> : null}</div>
      <svg viewBox="0 0 200 200" role="img" aria-label="Graph topology preview" style={{ width: '100%', maxHeight: 320 }}>
        {edges.map((edge, index) => {
          const source = byId.get(String(edge.source ?? edge.from ?? ''));
          const target = byId.get(String(edge.target ?? edge.to ?? ''));
          if (!source || !target) return null;
          return <line key={index} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke="#94a3b8" strokeWidth="1.5" />;
        })}
        {positioned.map(({ node, x, y }, index) => (
          <g key={String(node.id ?? index)}>
            <circle cx={x} cy={y} r="10" fill={node.selected ? '#f97316' : '#2563eb'} />
            <text x={x} y={y + 22} textAnchor="middle" fontSize="8">{text(node.label) ?? text(node.id) ?? `n${index + 1}`}</text>
          </g>
        ))}
      </svg>
      <div className="artifact-table">
        {edges.slice(0, 8).map((edge, index) => <div className="artifact-table-row" key={index} style={{ gridTemplateColumns: 'repeat(4, minmax(100px, 1fr))' }}><span>{String(edge.source ?? edge.from ?? '-')}</span><span>{String(edge.relation ?? '-')}</span><span>{String(edge.target ?? edge.to ?? '-')}</span><span>{String(num(edge.confidence) ?? edge.evidenceLevel ?? '-')}</span></div>)}
      </div>
    </div>
  );
}
