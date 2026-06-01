export interface RuntimeGuiChoice {
  label: string;
  commandText: string;
  style?: string;
}

export function runtimeGuiChoicesFromEventPayload(payload: unknown): RuntimeGuiChoice[] {
  return uniqueChoices(candidateGuiSurfaces(payload).flatMap(choicesFromSurface));
}

export function isTerminalEquivalentRuntimeCommand(commandText: string) {
  return commandText.length > 0
    && !/\b(?:deleteFile|triggerRecover|updateCapabilityPreference|UserActionApi|ProjectionApi)\b/.test(commandText);
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
