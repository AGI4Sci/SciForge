import { Badge } from '../uiPrimitives';

interface FeedbackRepairResolutionComposerProps {
  'aria-label'?: string;
  'remaining-problem-aria-label'?: string;
  browserVerificationLabel?: string;
  busy?: boolean;
  helpText?: string;
  placeholder?: string;
  remainingProblem: string;
  remainingLabel?: string;
  solvedLabel?: string;
  onSolved: () => void;
  onRemaining: () => void;
  onRemainingProblemChange: (value: string) => void;
}

export function FeedbackRepairResolutionComposer(props: FeedbackRepairResolutionComposerProps) {
  const {
    browserVerificationLabel,
    busy = false,
    helpText = '只需要确认这个问题是否已解决；仍有问题时再补充剩余现象。',
    placeholder = '如果仍未解决，写下现在还存在的问题...',
    remainingProblem,
    remainingLabel = '仍有问题',
    solvedLabel = '问题已解决',
    onSolved,
    onRemaining,
    onRemainingProblemChange,
  } = props;

  return (
    <section className="feedback-repair-guidance" aria-label={props['aria-label'] ?? 'repair result user closure'}>
      <div className="feedback-repair-subhead">
        <div>
          <strong>确认修复结果</strong>
          <span>{helpText}</span>
        </div>
        {browserVerificationLabel ? <Badge variant="info">{browserVerificationLabel}</Badge> : null}
      </div>
      <div className="feedback-repair-action-row">
        <button type="button" disabled={busy} onClick={onSolved}>
          {solvedLabel}
        </button>
        <button type="button" disabled={busy || !remainingProblem.trim()} onClick={onRemaining}>
          {remainingLabel}
        </button>
      </div>
      <textarea
        value={remainingProblem}
        onChange={(event) => onRemainingProblemChange(event.target.value)}
        placeholder={placeholder}
        aria-label={props['remaining-problem-aria-label'] ?? '记录修复后仍然存在的问题'}
        disabled={busy}
      />
    </section>
  );
}
