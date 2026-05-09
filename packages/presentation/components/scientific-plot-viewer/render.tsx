import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

type PlotlyTrace = Record<string, unknown>;
type PlotlyLikeSpec = {
  plotId?: string;
  data?: PlotlyTrace[];
  layout?: Record<string, unknown>;
  config?: Record<string, unknown>;
  frames?: unknown[];
  selection?: Record<string, unknown>;
  annotations?: unknown[];
  exportProfile?: Record<string, unknown>;
  fallbackRenderers?: unknown[];
  editPatch?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asSpec(value: unknown): PlotlyLikeSpec | undefined {
  if (!isRecord(value)) return undefined;
  const nested = value.plotSpec ?? value.plotly ?? value.figure ?? value.figureSpec;
  const source = isRecord(nested) ? nested : value;
  if (Array.isArray(source.data) || isRecord(source.layout) || isRecord(source.config) || Array.isArray(source.frames)) {
    return source as PlotlyLikeSpec;
  }
  return undefined;
}

function asFigureSpec(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const nested = value.figureSpec ?? value.figure;
  const source = isRecord(nested) ? nested : value;
  return Array.isArray(source.panels) ? source : undefined;
}

function payloadFromProps(props: UIComponentRendererProps) {
  return props.artifact?.data ?? props.slot.props;
}

function titleFromLayout(layout?: Record<string, unknown>) {
  const title = layout?.title;
  if (typeof title === 'string') return title;
  if (isRecord(title) && typeof title.text === 'string') return title.text;
  return 'Untitled Plotly figure';
}

function titleFromFigure(figure?: Record<string, unknown>) {
  return typeof figure?.title === 'string' && figure.title.trim() ? figure.title : 'Untitled publication figure';
}

function traceSummary(trace: PlotlyTrace, index: number) {
  const name = typeof trace.name === 'string' && trace.name.trim() ? trace.name : `trace ${index + 1}`;
  const type = typeof trace.type === 'string' ? trace.type : 'scatter';
  const mode = typeof trace.mode === 'string' ? `, ${trace.mode}` : '';
  const xLength = Array.isArray(trace.x) ? trace.x.length : undefined;
  const yLength = Array.isArray(trace.y) ? trace.y.length : undefined;
  const points = xLength ?? yLength;
  return `${name}: ${type}${mode}${typeof points === 'number' ? `, ${points} points` : ''}`;
}

function exportProfileSummary(profile?: Record<string, unknown>) {
  if (!profile) return '';
  const format = typeof profile.format === 'string' ? profile.format : undefined;
  const width = typeof profile.width === 'number' ? profile.width : undefined;
  const height = typeof profile.height === 'number' ? profile.height : undefined;
  const scale = typeof profile.scale === 'number' ? profile.scale : undefined;
  const renderer = typeof profile.renderer === 'string' ? profile.renderer : undefined;
  return [
    renderer ? `renderer=${renderer}` : undefined,
    format ? `format=${format}` : undefined,
    width && height ? `${width}x${height}` : undefined,
    scale ? `scale=${scale}` : undefined,
  ].filter(Boolean).join(' · ');
}

function fallbackRendererSummary(spec: PlotlyLikeSpec) {
  const renderers = Array.isArray(spec.fallbackRenderers)
    ? spec.fallbackRenderers
    : Array.isArray(spec.exportProfile?.derivedExports)
      ? spec.exportProfile.derivedExports
      : [];
  return renderers
    .filter(isRecord)
    .map((renderer) => {
      const name = typeof renderer.renderer === 'string' ? renderer.renderer : 'fallback';
      const purpose = typeof renderer.purpose === 'string' ? renderer.purpose : undefined;
      const status = typeof renderer.status === 'string' ? renderer.status : undefined;
      return [name, purpose, status].filter(Boolean).join(':');
    });
}

export function renderScientificPlotViewer(props: UIComponentRendererProps) {
  const { artifact, helpers, session } = props;
  const payload = payloadFromProps(props);
  const spec = asSpec(payload);
  const figureSpec = asFigureSpec(payload);
  const ArtifactSourceBar = helpers?.ArtifactSourceBar;
  const ArtifactDownloads = helpers?.ArtifactDownloads;
  const ComponentEmptyState = helpers?.ComponentEmptyState;

  if (figureSpec) {
    const panels = Array.isArray(figureSpec.panels) ? figureSpec.panels : [];
    const exportProfile = isRecord(figureSpec.exportProfile) ? figureSpec.exportProfile : undefined;
    const exportSummary = exportProfileSummary(exportProfile);
    return (
      <div className="stack scientific-plot-viewer" data-component-id="scientific-plot-viewer" data-figure-panels={panels.length}>
        {ArtifactSourceBar ? <ArtifactSourceBar artifact={artifact} session={session} /> : null}
        {ArtifactDownloads ? <ArtifactDownloads artifact={artifact} /> : null}
        <section className="plot-contract-preview" aria-label="Plotly-compatible figure preview">
          <header>
            <h3>{titleFromFigure(figureSpec)}</h3>
            <p>{panels.length} publication panel{panels.length === 1 ? '' : 's'}</p>
          </header>
          <ul>
            {panels.map((panel, index) => {
              const item = isRecord(panel) ? panel : {};
              const label = typeof item.label === 'string' ? item.label : String(index + 1);
              const primitive = typeof item.primitive === 'string' ? item.primitive : 'plot-spec';
              return <li key={index}>Panel {label}: {primitive}</li>;
            })}
          </ul>
          {exportSummary ? <p>Export profile: {exportSummary}</p> : null}
        </section>
      </div>
    );
  }

  if (!spec || !Array.isArray(spec.data) || spec.data.length === 0) {
    return (
      <div className="stack">
        {ArtifactDownloads ? <ArtifactDownloads artifact={artifact} /> : null}
        {ComponentEmptyState ? (
          <ComponentEmptyState
            componentId="scientific-plot-viewer"
            artifactType={artifact?.type ?? 'plot-spec'}
            title="No Plotly traces"
            detail="Expected a Plotly-compatible spec with a data trace array. Keep Matplotlib outputs as derived export artifacts."
          />
        ) : (
          <p className="empty-state">No Plotly traces available.</p>
        )}
      </div>
    );
  }

  const title = titleFromLayout(spec.layout);
  const selected = Array.isArray(spec.selection?.pointIndices) ? spec.selection.pointIndices.length : undefined;
  const exportSummary = exportProfileSummary(spec.exportProfile);
  const annotationCount = Array.isArray(spec.annotations) ? spec.annotations.length : 0;
  const fallbackRenderers = fallbackRendererSummary(spec);

  return (
    <div className="stack scientific-plot-viewer" data-component-id="scientific-plot-viewer" data-plotly-traces={spec.data.length}>
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={artifact} session={session} /> : null}
      {ArtifactDownloads ? <ArtifactDownloads artifact={artifact} /> : null}
      <section className="plot-contract-preview" aria-label="Plotly-compatible plot preview">
        <header>
          <h3>{title}</h3>
          <p>{spec.data.length} Plotly trace{spec.data.length === 1 ? '' : 's'}</p>
        </header>
        <ul>
          {spec.data.map((trace, index) => <li key={index}>{traceSummary(trace, index)}</li>)}
        </ul>
        {typeof selected === 'number' ? <p>Selection: {selected} point{selected === 1 ? '' : 's'}</p> : null}
        {annotationCount ? <p>Annotations: {annotationCount}</p> : null}
        {exportSummary ? <p>Export profile: {exportSummary}</p> : null}
        {fallbackRenderers.length ? <p>Fallback renderers: {fallbackRenderers.join(', ')}</p> : null}
      </section>
    </div>
  );
}
