import { scenarios, type ScenarioId } from '../data';
import type { RuntimeArtifact, SciForgeSession } from '../domain';
import { interactiveArtifactDownloadItems } from '../../../../packages/presentation/interactive-views';
import { Badge } from './uiPrimitives';
import { artifactSource } from './results/resultArtifactHelpers';
import { artifactInspectorModel } from './results-renderer-artifact-normalizer';
import { exportTextFile } from './exportUtils';
import { formatRightPaneStructuredPreviewJson, rightPaneInlineLabel, rightPaneSafeRefs } from './results/previewSafety';

export function ArtifactInspectorDrawer({
  scenarioId,
  session,
  artifact,
  onClose,
  onArtifactHandoff,
}: {
  scenarioId: ScenarioId;
  session: SciForgeSession;
  artifact: RuntimeArtifact;
  onClose: () => void;
  onArtifactHandoff: (targetScenario: ScenarioId, artifact: RuntimeArtifact) => void;
}) {
  const downloads = interactiveArtifactDownloadItems(artifact);
  const { files, handoffTargets, lineage } = artifactInspectorModel({
    artifact,
    session,
    currentScenarioId: scenarioId,
    downloads,
  });
  const previewRefs = rightPaneSafeRefs(artifact.data ?? artifact, 8);
  return (
    <div className="artifact-inspector-layer">
      <button className="artifact-inspector-backdrop" type="button" aria-label="Close result details" onClick={onClose} />
      <aside className="artifact-inspector-drawer" role="dialog" aria-modal="false" aria-label="Result details">
        <div className="artifact-inspector-head">
          <div>
            <Badge variant="info">Result details</Badge>
            <h2>{artifact.id}</h2>
            <p>{artifact.type} · v{artifact.schemaVersion}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close result details">Close</button>
        </div>
        <section>
          <h3>Structure</h3>
          <div className="handoff-field-grid">
            <span><em>Type</em><code>{artifact.type}</code></span>
            <span><em>Version</em><code>{artifact.schemaVersion}</code></span>
            <span><em>Source</em><code>{artifactSourceLabel(artifactSource(artifact))}</code></span>
          </div>
        </section>
        <section>
          <h3>Lineage</h3>
          <div className="inspector-ref-list">
            {lineage.map(([label, value]) => <code key={label}>{label}: {rightPaneInlineLabel(value)}</code>)}
          </div>
        </section>
        <section>
          <h3>Files</h3>
          {files.length ? (
            <div className="inspector-ref-list">
              {files.map(([label, value]) => <code key={`${label}-${value}`}>{label}: {rightPaneInlineLabel(value)}</code>)}
            </div>
          ) : (
            <p className="empty-state">No supporting files are ready yet.</p>
          )}
        </section>
        {downloads.length ? (
          <section>
            <h3>Export</h3>
            <div className="artifact-card-actions">
              {downloads.map((item) => (
                <button
                  key={`${item.name}-${item.path ?? item.key ?? ''}`}
                  type="button"
                onClick={() => exportTextFile(item.name, item.content, item.contentType)}
              >
                  {rightPaneInlineLabel(item.name)}{typeof item.rowCount === 'number' ? ` · ${item.rowCount} rows` : ''}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <h3>Preview</h3>
          {previewRefs.length ? (
            <div className="inspector-ref-list">
              {previewRefs.map((ref) => <code key={ref}>{ref}</code>)}
            </div>
          ) : null}
          <pre className="inspector-json">{formatRightPaneStructuredPreviewJson(artifact.data ?? artifact)}</pre>
        </section>
        <section>
          <h3>Next Targets</h3>
          {handoffTargets.length ? (
            <div className="handoff-actions compact">
              {handoffTargets.map((target) => {
                const targetScenario = scenarios.find((item) => item.id === target);
                return (
                  <button key={target} type="button" onClick={() => onArtifactHandoff(target, artifact)}>
                    {targetScenario?.name ?? target}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="empty-state">No handoff target is declared for this result.</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function artifactSourceLabel(source: string) {
  if (source === 'runtime-artifact') return 'Result';
  if (source === 'project-tool') return 'Result';
  if (source === 'user-upload') return 'Uploaded';
  if (source === 'external') return 'External';
  if (source === 'empty') return 'Waiting';
  return source.replace(/runtime|artifact/gi, 'result');
}
