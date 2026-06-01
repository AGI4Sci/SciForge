import type { AgentStreamEvent } from '../../domain';
import type { SupportedLocale } from '../../i18n';
import { liveProgressSentenceFromStream } from './runStatusPresentation';

export function LiveProgressSentence({
  assistantDraft,
  events,
  locale,
}: {
  assistantDraft: string;
  events: AgentStreamEvent[];
  locale?: SupportedLocale;
}) {
  const sentence = liveProgressSentenceFromStream(assistantDraft, events, locale);
  return (
    <div className="live-progress-sentence" role="status" aria-live="polite" data-testid="live-progress-sentence">
      <span>{sentence}</span>
    </div>
  );
}
