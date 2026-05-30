export interface RuntimeGuiSurface {
  guiPresentation?: unknown;
  guiAskUser?: unknown;
}

interface NormalizedGuiPresentation {
  title?: string;
  text?: string;
  ref?: string;
  status?: string;
  displayedRefs: string[];
}

interface NormalizedGuiAskUser {
  title: string;
  message?: string;
  risk?: string;
  relatedRefs: string[];
  choices: Array<{
    label: string;
    commandText: string;
    style?: string;
  }>;
}

export function hasRuntimeGuiSurface(surface: RuntimeGuiSurface | undefined) {
  return Boolean(normalizeGuiPresentation(surface?.guiPresentation) || normalizeGuiAskUser(surface?.guiAskUser));
}

export function RuntimeGuiPanel({
  surface,
  onCommand,
}: {
  surface?: RuntimeGuiSurface;
  onCommand?: (commandText: string) => void;
}) {
  const presentation = normalizeGuiPresentation(surface?.guiPresentation);
  const askUser = normalizeGuiAskUser(surface?.guiAskUser);
  if (!presentation && !askUser) return null;
  return (
    <div className="runtime-gui-panel" data-testid="runtime-gui-panel">
      {presentation ? (
        <section
          className="runtime-gui-card runtime-gui-present"
          data-testid="runtime-gui-present"
          data-gui-surface="presentation"
          aria-label="Presented result"
        >
          <div className="runtime-gui-card-head">
            <span>Operation result</span>
            <strong>{humanGuiTitle(presentation.title) ?? 'Result ready'}</strong>
            {presentation.status ? <small>{humanStatusLabel(presentation.status)}</small> : null}
          </div>
          {presentation.text ? <p>{humanGuiMessage(presentation.text)}</p> : null}
          <RuntimeGuiRefList refs={uniqueStrings([presentation.ref, ...presentation.displayedRefs])} />
        </section>
      ) : null}
      {askUser ? (
        <section
          className="runtime-gui-card runtime-gui-ask-user"
          data-testid="runtime-gui-ask-user"
          data-gui-surface="confirmation"
          aria-label="Confirmation request"
        >
          <div className="runtime-gui-card-head">
            <span>Needs confirmation</span>
            <strong>{humanGuiTitle(askUser.title) ?? 'Confirm before continuing'}</strong>
            {askUser.risk ? <small>{humanRiskLabel(askUser.risk)}</small> : null}
          </div>
          {askUser.message ? <p>{humanGuiMessage(askUser.message)}</p> : null}
          <RuntimeGuiRefList refs={askUser.relatedRefs} />
          {askUser.choices.length ? (
            <div className="runtime-gui-choice-row">
              {askUser.choices.map((choice) => (
                <button
                  type="button"
                  key={`${choice.label}-${choice.commandText}`}
                  className={`runtime-gui-choice ${choice.style === 'danger' ? 'danger' : choice.style === 'primary' ? 'primary' : ''}`}
                  onClick={() => onCommand?.(choice.commandText)}
                  title={choice.label}
                >
                  <span>{choice.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function RuntimeGuiRefList({ refs }: { refs: string[] }) {
  const visibleRefs = uniqueStrings(refs).filter(isSafeUserFacingGuiRef).slice(0, 8);
  if (!visibleRefs.length) return null;
  return (
    <p className="runtime-gui-ref-list">{visibleRefs.length} related item{visibleRefs.length === 1 ? '' : 's'} available.</p>
  );
}

function normalizeGuiPresentation(value: unknown): NormalizedGuiPresentation | undefined {
  if (!isRecord(value)) return undefined;
  const displayedRefs = stringList(value.displayedRefs);
  const ref = stringField(value.ref);
  const text = stringField(value.text);
  if (!ref && !displayedRefs.length && !text) return undefined;
  return {
    title: stringField(value.title),
    text,
    ref,
    status: stringField(value.status),
    displayedRefs,
  };
}

function normalizeGuiAskUser(value: unknown): NormalizedGuiAskUser | undefined {
  if (!isRecord(value)) return undefined;
  const approvalRequest = isRecord(value.approvalRequest) ? value.approvalRequest : {};
  const choices = recordList(value.choices).flatMap((choice) => {
    const label = stringField(choice.label);
    const commandText = stringField(choice.commandText);
    if (!label || !commandText || !isTerminalEquivalentCommandText(commandText)) return [];
    return [{ label, commandText, style: stringField(choice.style) }];
  });
  const title = stringField(value.title) ?? stringField(approvalRequest.title) ?? 'Confirm before continuing';
  const message = stringField(value.message)
    ?? stringField(approvalRequest.prompt)
    ?? stringField(approvalRequest.message)
    ?? stringField(approvalRequest.confirmationText)
    ?? stringField(approvalRequest.confirmation_text)
    ?? stringField(approvalRequest.reason);
  const relatedRefs = uniqueStrings([
    ...stringList(value.relatedRefs),
    ...stringList(value.displayedRefs),
    ...stringList(approvalRequest.refs),
  ]);
  if (!message && !relatedRefs.length && !choices.length) return undefined;
  return {
    title,
    message,
    risk: stringField(approvalRequest.riskLevel) ?? stringField(approvalRequest.risk_level) ?? stringField(approvalRequest.risk),
    relatedRefs,
    choices,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function uniqueStrings(values: Array<string | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value?.trim()))));
}

function compactText(value: string, limit: number) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trim()}...` : text;
}

function humanGuiTitle(value: string | undefined) {
  if (!value) return undefined;
  const title = value
    .replace(/\bComputer Use confirmation required\b/gi, 'Confirmation required')
    .replace(/\bComputer Use result\b/gi, 'Operation result')
    .replace(/\bComputer Use\b/gi, 'Operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'Operation')
    .replace(/\bcodex-command[-:\w]*\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return title ? compactText(title, 80) : undefined;
}

function humanGuiMessage(value: string) {
  return compactText(value
    .replace(/\bComputer Use\b/gi, 'the operation')
    .replace(/\bgui\.(?:present|ask_user)\b/gi, 'the operation')
    .replace(/\bcodex-command[-:\w]*\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim(), 220);
}

function humanStatusLabel(value: string) {
  const status = value.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (status === 'needs confirmation') return 'Needs confirmation';
  if (status === 'completed' || status === 'done') return 'Done';
  if (status === 'failed' || status === 'error') return 'Needs attention';
  return compactText(value, 40);
}

function humanRiskLabel(value: string) {
  const risk = value.trim().toLowerCase();
  if (risk === 'high') return 'High risk';
  if (risk === 'medium') return 'Medium risk';
  if (risk === 'low') return 'Low risk';
  return compactText(value, 40);
}

function isTerminalEquivalentCommandText(commandText: string) {
  return commandText.length > 0
    && !/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi)\b/.test(commandText);
}

function isSafeUserFacingGuiRef(ref: string) {
  return /^(?:artifact|file)::?/i.test(ref)
    && !/(?:^|[:/])(?:audit|raw|logs?|trace|stdout|stderr|codex-command|provider)\b/i.test(ref)
    && !/^\s*file:(?:\/|~|[A-Za-z]:|\.{2})/.test(ref)
    && !/^\s*file:\.sciforge\/(?:raw|logs?|audit)\b/i.test(ref);
}
