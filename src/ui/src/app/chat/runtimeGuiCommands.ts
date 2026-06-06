export interface RuntimeGuiChoice {
  label: string;
  commandText: string;
  style?: string;
}

export function runtimeGuiChoicesFromEventPayload(payload: unknown): RuntimeGuiChoice[] {
  return uniqueChoices(candidateGuiSurfaces(payload).flatMap(choicesFromSurface));
}

export function isTerminalEquivalentRuntimeCommand(commandText: string) {
  const text = commandText.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  if (/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi)\b/.test(text)) return false;
  return !isExecutableGuiRuntimeCommand(text);
}

const COMPUTER_USE_CONTROL_VERBS = new Set([
  'approve',
  'reject',
  'cancel',
  'stop',
  'takeover',
  'pause',
  'resume',
  'status',
  'debug',
]);

const BROWSER_EXECUTABLE_VERBS = new Set([
  'click',
  'type',
  'press',
  'scroll',
  'drag',
  'move',
  'hover',
  'select',
  'fill',
  'screenshot',
  'execute',
  'eval',
]);

function isExecutableGuiRuntimeCommand(commandText: string) {
  const match = commandText.match(/^\/([a-z0-9-]+)(?:\s+([a-z0-9-]+))?/i);
  if (!match) return false;
  const namespace = match[1]?.toLowerCase();
  const verb = match[2]?.toLowerCase() ?? '';
  if (namespace === 'computer-use') {
    if (verb === 'input-intent') return !isVirtualScreenLeaseControlCommand(commandText);
    return !COMPUTER_USE_CONTROL_VERBS.has(verb);
  }
  if (namespace === 'browser') return BROWSER_EXECUTABLE_VERBS.has(verb);
  return false;
}

function isVirtualScreenLeaseControlCommand(commandText: string) {
  return /(?:^|\s)--source\s+(?:"virtual-app-screen-control"|'virtual-app-screen-control'|virtual-app-screen-control)(?:\s|$)/.test(commandText)
    && /(?:^|\s)--kind\s+(?:"(?:takeover|pause-agent|resume-agent|stop-session)"|'(?:takeover|pause-agent|resume-agent|stop-session)'|(?:takeover|pause-agent|resume-agent|stop-session))(?:\s|$)/.test(commandText);
}

function candidateGuiSurfaces(payload: unknown): unknown[] {
  const records = nestedRecords(payload);
  return records.flatMap((record) => [
    record,
    record.guiAskUser,
    record.gui_ask_user,
    record.askUser,
    record.ask_user,
    record.approvalRequest,
    record.approval_request,
  ]).filter(Boolean);
}

function nestedRecords(value: unknown): Record<string, unknown>[] {
  const record = isRecord(value) ? value : undefined;
  if (!record) return [];
  const native = isRecord(record.native) ? record.native : undefined;
  const nativeRaw = isRecord(native?.raw) ? native.raw : undefined;
  const raw = isRecord(record.raw) ? record.raw : undefined;
  const rawEvent = isRecord(raw?.event) ? raw.event : undefined;
  return [record, native, nativeRaw, raw, rawEvent].filter((entry): entry is Record<string, unknown> => Boolean(entry));
}

function choicesFromSurface(value: unknown): RuntimeGuiChoice[] {
  if (!isRecord(value)) return [];
  return [
    ...choiceRecords(value.choices),
    ...choiceRecords(value.actions),
    ...choiceRecords(isRecord(value.approvalRequest) ? value.approvalRequest.choices : undefined),
    ...choiceRecords(isRecord(value.approval_request) ? value.approval_request.choices : undefined),
  ].flatMap((choice) => {
    const label = stringField(choice.label) ?? stringField(choice.title);
    const commandText = stringField(choice.commandText) ?? stringField(choice.command_text) ?? stringField(choice.command);
    if (!label || !commandText || !isTerminalEquivalentRuntimeCommand(commandText)) return [];
    return [{ label, commandText, style: stringField(choice.style) }];
  });
}

function choiceRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueChoices(choices: RuntimeGuiChoice[]) {
  const seen = new Set<string>();
  return choices.filter((choice) => {
    const key = `${choice.label}\n${choice.commandText}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
