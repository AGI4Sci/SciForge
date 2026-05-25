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
  approvalRef?: string;
  actionRef?: string;
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
          data-gui-tool="gui.present"
          aria-label="Computer Use gui.present"
        >
          <div className="runtime-gui-card-head">
            <span>gui.present</span>
            <strong>{presentation.title ?? 'Computer Use result'}</strong>
            {presentation.status ? <small>{presentation.status}</small> : null}
          </div>
          {presentation.text ? <p>{compactText(presentation.text, 220)}</p> : null}
          <RuntimeGuiRefList refs={uniqueStrings([presentation.ref, ...presentation.displayedRefs])} />
        </section>
      ) : null}
      {askUser ? (
        <section
          className="runtime-gui-card runtime-gui-ask-user"
          data-testid="runtime-gui-ask-user"
          data-gui-tool="gui.ask_user"
          aria-label="Computer Use gui.ask_user"
        >
          <div className="runtime-gui-card-head">
            <span>gui.ask_user</span>
            <strong>{askUser.title}</strong>
            {askUser.risk ? <small>{askUser.risk}</small> : null}
          </div>
          {askUser.message ? <p>{askUser.message}</p> : null}
          {(askUser.approvalRef || askUser.actionRef) ? (
            <dl className="runtime-gui-facts">
              {askUser.approvalRef ? (
                <>
                  <dt>approval</dt>
                  <dd>{askUser.approvalRef}</dd>
                </>
              ) : null}
              {askUser.actionRef ? (
                <>
                  <dt>action</dt>
                  <dd>{askUser.actionRef}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          <RuntimeGuiRefList refs={askUser.relatedRefs} />
          {askUser.choices.length ? (
            <div className="runtime-gui-choice-row">
              {askUser.choices.map((choice) => (
                <button
                  type="button"
                  key={`${choice.label}-${choice.commandText}`}
                  className={`runtime-gui-choice ${choice.style === 'danger' ? 'danger' : choice.style === 'primary' ? 'primary' : ''}`}
                  onClick={() => onCommand?.(choice.commandText)}
                  title={choice.commandText}
                  data-command-text={choice.commandText}
                >
                  <span>{choice.label}</span>
                  <code>{choice.commandText}</code>
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
  const visibleRefs = uniqueStrings(refs).slice(0, 8);
  if (!visibleRefs.length) return null;
  return (
    <ul className="runtime-gui-ref-list">
      {visibleRefs.map((ref) => (
        <li key={ref}>
          <code>{ref}</code>
        </li>
      ))}
    </ul>
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
  const title = stringField(value.title) ?? stringField(approvalRequest.title) ?? 'Computer Use confirmation required';
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
    approvalRef: stringField(approvalRequest.id) ?? stringField(approvalRequest.approvalRef) ?? stringField(approvalRequest.approval_ref),
    actionRef: stringField(approvalRequest.actionRef) ?? stringField(approvalRequest.action_ref) ?? stringField(approvalRequest.actionKind) ?? stringField(approvalRequest.action_kind),
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

function isTerminalEquivalentCommandText(commandText: string) {
  return commandText.length > 0
    && !/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi)\b/.test(commandText);
}
