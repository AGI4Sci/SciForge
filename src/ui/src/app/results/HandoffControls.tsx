import { scenarios, type ScenarioId } from '../../data';
import type { RuntimeArtifact } from '../../domain';
import { handoffAutoRunPrompt } from './autoRunPrompts';

export function HandoffTargetButtons({
  targets,
  onPreview,
}: {
  targets: ScenarioId[];
  onPreview: (target: ScenarioId) => void;
}) {
  if (!targets.length) return null;
  return (
    <div className="handoff-actions">
      <span>发送 artifact 到</span>
      {targets.map((target) => {
        const targetScenario = scenarios.find((item) => item.id === target);
        return (
          <button key={target} onClick={() => onPreview(target)}>
            {targetScenario?.name ?? target}
          </button>
        );
      })}
    </div>
  );
}

export function HandoffPreview({
  sourceScenarioId,
  targetScenarioId,
  artifact,
  onCancel,
  onConfirm,
}: {
  sourceScenarioId: ScenarioId;
  targetScenarioId: ScenarioId;
  artifact: RuntimeArtifact;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const source = scenarios.find((item) => item.id === sourceScenarioId);
  const target = scenarios.find((item) => item.id === targetScenarioId);
  const autoRunPrompt = handoffAutoRunPrompt(targetScenarioId, artifact, source?.name ?? sourceScenarioId, target?.name ?? targetScenarioId);
  const fields = [
    ['artifact id', artifact.id],
    ['artifact type', artifact.type],
    ['schema', artifact.schemaVersion],
    ['source', artifact.producerScenario],
    ['new run', `${target?.name ?? targetScenarioId} auto-run draft`],
  ];
  return (
    <div className="handoff-preview" role="group" aria-label="Handoff 确认预览">
      <div>
        <strong>确认 handoff</strong>
        <p>会把 artifact 放入目标场景上下文，并创建一条可自动运行的用户输入草案。</p>
      </div>
      <div className="handoff-field-grid">
        {fields.map(([label, value]) => (
          <span key={label}>
            <em>{label}</em>
            <code>{value}</code>
          </span>
        ))}
      </div>
      <pre className="handoff-prompt-preview">{autoRunPrompt}</pre>
      <div className="handoff-preview-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" onClick={onConfirm}>确认 handoff</button>
      </div>
    </div>
  );
}
