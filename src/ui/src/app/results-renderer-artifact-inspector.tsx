import { scenarios, type ScenarioId } from '../data';
import type { RuntimeArtifact, SciForgeSession } from '../domain';
import { interactiveArtifactDownloadItems } from '../../../../packages/presentation/interactive-views';
import { Badge } from './uiPrimitives';
import { artifactSource } from './results/resultArtifactHelpers';
import { artifactInspectorModel } from './results-renderer-artifact-normalizer';
import { exportTextFile } from './exportUtils';

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
  return (
    <div className="artifact-inspector-layer">
      <button className="artifact-inspector-backdrop" type="button" aria-label="关闭材料详情" onClick={onClose} />
      <aside className="artifact-inspector-drawer" role="dialog" aria-modal="false" aria-label="材料详情">
        <div className="artifact-inspector-head">
          <div>
            <Badge variant="info">材料详情</Badge>
            <h2>{artifact.id}</h2>
            <p>{artifact.type} · 版本 {artifact.schemaVersion}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭材料详情">关闭</button>
        </div>
        <section>
          <h3>结构</h3>
          <div className="handoff-field-grid">
            <span><em>类型</em><code>{artifact.type}</code></span>
            <span><em>版本</em><code>{artifact.schemaVersion}</code></span>
            <span><em>来源</em><code>{artifactSourceLabel(artifactSource(artifact))}</code></span>
          </div>
        </section>
        <section>
          <h3>来源</h3>
          <div className="inspector-ref-list">
            {lineage.map(([label, value]) => <code key={label}>{label}: {value}</code>)}
          </div>
        </section>
        <section>
          <h3>材料</h3>
          {files.length ? (
            <div className="inspector-ref-list">
              {files.map(([label, value]) => <code key={`${label}-${value}`}>{label}: {value}</code>)}
            </div>
          ) : (
            <p className="empty-state">还没有可展示的过程材料。</p>
          )}
        </section>
        {downloads.length ? (
          <section>
            <h3>导出</h3>
            <div className="artifact-card-actions">
              {downloads.map((item) => (
                <button
                  key={`${item.name}-${item.path ?? item.key ?? ''}`}
                  type="button"
                  onClick={() => exportTextFile(item.name, item.content, item.contentType)}
                >
                  {item.name}{typeof item.rowCount === 'number' ? ` · ${item.rowCount} rows` : ''}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <section>
          <h3>预览</h3>
          <pre className="inspector-json">{JSON.stringify(artifact.data ?? artifact, null, 2)}</pre>
        </section>
        <section>
          <h3>后续目标</h3>
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
            <p className="empty-state">当前材料没有声明可衔接的目标场景。</p>
          )}
        </section>
      </aside>
    </div>
  );
}

function artifactSourceLabel(source: string) {
  if (source === 'runtime-artifact') return '运行结果';
  if (source === 'project-tool') return '运行结果';
  if (source === 'user-upload') return '用户上传';
  if (source === 'external') return '外部材料';
  if (source === 'empty') return '等待材料';
  return source.replace(/runtime|artifact/gi, '材料');
}
