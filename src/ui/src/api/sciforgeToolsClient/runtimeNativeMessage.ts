function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function runtimeNativeMessageLiveAcceptanceEligible(message: string, result?: unknown) {
  const text = message.trim();
  if (!text) return false;
  const status = runtimeNativeMessageStatus(result);
  if (status && /(?:fail|error|cancel|cancell|timeout|timed-out|blocked|needs-human|requires-confirmation)/i.test(status)) {
    return false;
  }
  if (looksDiagnosticOnlyNativeMessage(text)) return false;
  return true;
}

export function runtimeNativeMessageSafeForVisibleAnswer(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (looksInternalToolProtocolNativeMessage(text)) return false;
  return true;
}

function runtimeNativeMessageStatus(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return asString(value.status)
    ?? asString(value.resultStatus)
    ?? asString(value.completionStatus)
    ?? (isRecord(value.output) ? asString(value.output.status) : undefined)
    ?? (isRecord(value.displayIntent)
      && isRecord(value.displayIntent.conversationProjection)
      && isRecord(value.displayIntent.conversationProjection.visibleAnswer)
      ? asString(value.displayIntent.conversationProjection.visibleAnswer.status)
      : undefined);
}

function looksDiagnosticOnlyNativeMessage(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return true;
  if (/^(?:traceback \(most recent call last\)|failureReason\s*[:=]|stderrRef\s*[:=]|stdoutRef\s*[:=]|raw_jsonl\b)/i.test(compact)) return true;
  return /(?:Runtime Codex WebSocket error|Assistant connection needs setup|generation request failed)/i.test(compact)
    && /(?:stderr|stdout|trace|recover|retry|connection|setup)/i.test(compact);
}

function looksInternalToolProtocolNativeMessage(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return true;
  return /<\s*[｜|]?\s*DSML\s*[｜|]?\s*tool_calls?\b/i.test(compact)
    || /<\/\s*[｜|]?\s*DSML\s*[｜|]?\s*tool_calls?\s*>/i.test(compact)
    || /<\s*(?:tool_calls?|function_call|assistant_tool_call)\b/i.test(compact)
    || /\btool_calls?\s*[:=]\s*\[\s*\{/i.test(compact)
    || /\b(?:recipient_name|tool_call_id)\s*[:=]\s*["'][\w.-]+["']/i.test(compact);
}
