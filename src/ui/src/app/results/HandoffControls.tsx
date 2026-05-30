import { scenarios, type ScenarioId } from '../../data';
import type { RuntimeArtifact } from '../../domain';
import { handoffAutoRunPrompt } from './autoRunPrompts';
import { resultText, type ResultLocale } from './resultLocale';

export function HandoffTargetButtons({
  targets,
  locale,
  onPreview,
}: {
  targets: ScenarioId[];
  locale?: ResultLocale;
  onPreview: (target: ScenarioId) => void;
}) {
  if (!targets.length) return null;
  return (
    <div className="handoff-actions">
      <span>{resultText(locale, { 'zh-CN': '发送结果到', 'en-US': 'Send result to' })}</span>
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
  locale,
  onCancel,
  onConfirm,
}: {
  sourceScenarioId: ScenarioId;
  targetScenarioId: ScenarioId;
  artifact: RuntimeArtifact;
  locale?: ResultLocale;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const source = scenarios.find((item) => item.id === sourceScenarioId);
  const target = scenarios.find((item) => item.id === targetScenarioId);
  const autoRunPrompt = handoffAutoRunPrompt(targetScenarioId, artifact, source?.name ?? sourceScenarioId, target?.name ?? targetScenarioId);
  const fields = [
    [resultText(locale, { 'zh-CN': '结果 ID', 'en-US': 'result id' }), artifact.id],
    [resultText(locale, { 'zh-CN': '结果类型', 'en-US': 'result type' }), artifact.type],
    [resultText(locale, { 'zh-CN': '版本', 'en-US': 'version' }), artifact.schemaVersion],
    [resultText(locale, { 'zh-CN': '来源', 'en-US': 'source' }), artifact.producerScenario],
    [resultText(locale, { 'zh-CN': '新运行', 'en-US': 'new run' }), `${target?.name ?? targetScenarioId} ${resultText(locale, { 'zh-CN': '自动运行草稿', 'en-US': 'auto-run draft' })}`],
  ];
  return (
    <div className="handoff-preview" role="group" aria-label={resultText(locale, { 'zh-CN': '交接预览', 'en-US': 'Handoff preview' })}>
      <div>
        <strong>{resultText(locale, { 'zh-CN': '确认交接', 'en-US': 'Confirm handoff' })}</strong>
        <p>{resultText(locale, { 'zh-CN': '这会把结果发送到目标聊天上下文，并创建可运行草稿。', 'en-US': 'This sends the result into the target chat context and creates a runnable draft.' })}</p>
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
        <button type="button" onClick={onCancel}>{resultText(locale, { 'zh-CN': '取消', 'en-US': 'Cancel' })}</button>
        <button type="button" onClick={onConfirm}>{resultText(locale, { 'zh-CN': '确认交接', 'en-US': 'Confirm handoff' })}</button>
      </div>
    </div>
  );
}
