import React from 'react';
import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function s(value: unknown) { return typeof value === 'string' && value.trim() ? value : undefined; }
function list(value: unknown) { return Array.isArray(value) ? value.map(String).filter(Boolean) : typeof value === 'string' ? value.split(/[\s,;]+/).filter(Boolean) : []; }
function compact(value: string) { return value.length > 120 ? `${value.slice(0, 117)}...` : value; }
export function renderStructureViewer(props: UIComponentRendererProps) {
  const payload = isRecord(props.artifact?.data) ? props.artifact.data : props.slot.props ?? {};
  const metadata = props.artifact?.metadata ?? {};
  const pdbId = s(payload.pdbId) ?? s(payload.pdb_id) ?? s(payload.pdb) ?? s(metadata.pdbId) ?? s(metadata.pdb_id);
  const uniprotId = s(payload.uniprotId) ?? s(metadata.uniprotId);
  const dataRef = s(payload.structureUrl) ?? s(payload.mmcifUrl) ?? s(payload.cifUrl) ?? s(props.artifact?.dataRef) ?? s(payload.dataRef) ?? s(payload.path) ?? s(payload.filePath) ?? s(props.artifact?.path);
  const html = s(payload.html) ?? s(payload.structureHtml) ?? s(payload.iframeHtml);
  const htmlRef = s(payload.htmlRef) ?? s(payload.structureHtmlRef);
  const residues = list(payload.highlightResidues ?? payload.residues ?? (isRecord(props.slot.props) ? props.slot.props.highlightSelection : undefined));
  const ligand = s(payload.ligand) ?? 'none';
  const metrics = isRecord(payload.metrics) ? payload.metrics : {};
  const ComponentEmptyState = props.helpers?.ComponentEmptyState;
  const ArtifactSourceBar = props.helpers?.ArtifactSourceBar;
  if (!props.artifact || (!pdbId && !uniprotId && !dataRef && !html && !htmlRef)) return <div className="stack">{ComponentEmptyState ? <ComponentEmptyState componentId="structure-viewer" artifactType={props.artifact?.type ?? 'structure-3d'} detail={!props.artifact ? undefined : 'Structure viewer requires an identifier, coordinate ref, or declared HTML preview.'} /> : <p>No structure reference available.</p>}</div>;
  return (
    <div className="stack structure-viewer" data-component-id="structure-viewer">
      {ArtifactSourceBar ? <ArtifactSourceBar artifact={props.artifact} session={props.session} /> : null}
      <div className="slot-meta">
        {pdbId ? <code>PDB={pdbId}</code> : null}
        {uniprotId ? <code>UniProt={uniprotId}</code> : null}
        <code>ligand={ligand}</code>
        {dataRef ? <code title={dataRef}>dataRef={compact(dataRef)}</code> : null}
        {residues.length ? <code>residues={residues.join(',')}</code> : null}
      </div>
      {html || htmlRef ? <iframe title="Sandboxed structure preview" sandbox="allow-scripts" src={htmlRef?.startsWith('data:text/html') || /^https?:\/\//i.test(htmlRef ?? '') ? htmlRef : undefined} srcDoc={html} style={{ width: '100%', minHeight: 280 }} /> : <div className="viz-card"><h3>{pdbId ?? uniprotId ?? 'Structure'}</h3><p>Declared coordinate resource preview. Rich 3D rendering can hydrate from the same refs.</p></div>}
      {Object.keys(metrics).length ? <div className="artifact-table">{Object.entries(metrics).slice(0, 8).map(([key, value]) => <div className="artifact-table-row" key={key} style={{ gridTemplateColumns: '160px 1fr' }}><span>{key}</span><span>{String(value)}</span></div>)}</div> : null}
    </div>
  );
}
