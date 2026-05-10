import { scenarios, type ScenarioId } from '../data';
import type { RuntimeArtifact, SciForgeSession } from '../domain';
import { interactiveArtifactDownloadItems } from '../../../../packages/presentation/interactive-views';
import { Badge } from './uiPrimitives';
import { artifactSource } from './results/resultArtifactHelpers';
import { artifactInspectorModel } from './results-renderer-artifact-normalizer';

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
  const { files, handoffTargets, lineage } = artifactInspectorModel({
    artifact,
    session,
    currentScenarioId: scenarioId,
    downloads: interactiveArtifactDownloadItems(artifact),
  });
  return (
    <div className="artifact-inspector-layer">
      <button className="artifact-inspector-backdrop" type="button" aria-label="关闭 Artifact Inspector" onClick={onClose} />
      <aside className="artifact-inspector-drawer" role="dialog" aria-modal="false" aria-label="Artifact Inspector">
        <div className="artifact-inspector-head">
          <div>
            <Badge variant="info">Artifact Inspector</Badge>
            <h2>{artifact.id}</h2>
            <p>{artifact.type} · schema {artifact.schemaVersion}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭 Artifact Inspector">关闭</button>
        </div>
        <section>
          <h3>Schema</h3>
          <div className="handoff-field-grid">
            <span><em>type</em><code>{artifact.type}</code></span>
            <span><em>schemaVersion</em><code>{artifact.schemaVersion}</code></span>
            <span><em>source</em><code>{artifactSource(artifact)}</code></span>
          </div>
        </section>
        <section>
          <h3>Lineage</h3>
          <div className="inspector-ref-list">
            {lineage.map(([label, value]) => <code key={label}>{label}: {value}</code>)}
          </div>
        </section>
        <section>
          <h3>Files</h3>
          {files.length ? (
            <div className="inspector-ref-list">
              {files.map(([label, value]) => <code key={`${label}-${value}`}>{label}: {value}</code>)}
            </div>
          ) : (
            <p className="empty-state">没有可复现文件引用；请检查 ExecutionUnit 是否写入 code/stdout/stderr/output refs。</p>
          )}
        </section>
        <section>
          <h3>Preview</h3>
          <pre className="inspector-json">{JSON.stringify(artifact.data ?? artifact, null, 2)}</pre>
        </section>
        <section>
          <h3>Handoff targets</h3>
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
            <p className="empty-state">当前 artifact schema 没有声明可 handoff 的目标场景。</p>
          )}
        </section>
      </aside>
    </div>
  );
}
