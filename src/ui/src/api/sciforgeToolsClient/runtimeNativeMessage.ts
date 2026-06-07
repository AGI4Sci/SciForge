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
  if (looksInternalToolProtocolNativeMessage(text)) return false;
  if (looksDiagnosticOnlyNativeMessage(text)) return false;
  if (looksToolIntentOnlyNativeMessage(text)) return false;
  return true;
}

export function runtimeNativeMessageSafeForVisibleAnswer(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (looksInternalToolProtocolNativeMessage(text)) return false;
  if (looksDiagnosticOnlyNativeMessage(text)) return false;
  if (looksToolIntentOnlyNativeMessage(text)) return false;
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
  if (/(?:^|\b)(?:stderrRef|stdoutRef|raw_jsonl|rawJsonl|rawOutput|raw_output|rawProviderOutput|rawProviderPayload|providerRawOutput|providerRawPayload|providerRawBody)\s*[:=]/i.test(compact)) return true;
  if (/\braw provider (?:payload|output|body|data)\b/i.test(compact)) return true;
  if (/\b(?:providerUrl|provider_url|upstreamBaseUrl|upstream_base_url|apiKey|api_key|authorization|bearer)\s*[:=]/i.test(compact)) return true;
  if (/(?:^|[\s"'`])\.sciforge\/[^\s"'`]+(?:stdout|stderr|jsonl|raw|audit|runtime-events|normalized-events)/i.test(compact)) return true;
  return /(?:Runtime Codex WebSocket error|Assistant connection needs setup|generation request failed)/i.test(compact)
    && /(?:stderr|stdout|trace|recover|retry|connection|setup)/i.test(compact);
}

function looksToolIntentOnlyNativeMessage(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact || compact.length > 700) return false;
  if (/(?:https?:\/\/|browser-host-session:|source-page-ref|page-text-ref|arxiv\.org|doi\.org|artifact:|file:)/i.test(compact)) return false;
  const mentionsRuntimeTool = /\b(?:Browser|Computer Use|module|tool|bounded operation|executeBoundedOperation)\b|浏览器|内置浏览器|模块|工具/u.test(compact);
  if (!mentionsRuntimeTool) return false;
  const intentVerb = /(?:使用|调用|通过|借助|打开|搜索|检索|查询|查找|浏览|读取|总结|我将|我会|准备|正在|将会|use|using|call|invoke|search|look\s*up|open|browse|read|summari[sz]e)/iu;
  const startsAsAction = /^(?:使用|调用|通过|借助|打开|搜索|检索|查询|查找|浏览|读取|总结|use|using|call|invoke|search|look\s*up|open|browse|read)\b/iu.test(compact);
  const firstPersonPlan = /(?:我(?:将|会|来|准备)|接下来|现在|I(?:'ll| will| am going to)|Let me)\s*(?:use|call|invoke|search|look\s*up|open|browse|使用|调用|搜索|检索|查询|打开|浏览)/iu.test(compact);
  const toolPhrase = /\b(?:module|tool|bounded operation|executeBoundedOperation)\b|模块|工具/u.test(compact);
  return intentVerb.test(compact) && (startsAsAction || firstPersonPlan || toolPhrase);
}

function looksInternalToolProtocolNativeMessage(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return true;
  return /<\s*[｜|]?\s*DSML\s*[｜|]?\s*tool_calls?\b/i.test(compact)
    || /<\/\s*[｜|]?\s*DSML\s*[｜|]?\s*tool_calls?\s*>/i.test(compact)
    || /<\s*(?:tool_calls?|function_call|assistant_tool_call)\b/i.test(compact)
    || /<\s*function_calls?\b/i.test(compact)
    || /\bname\s*=\s*["']module[_.-]?(?:invoke|query|read|describe)["']\s*>/i.test(compact)
    || /<\s*(?:module[_.-]?(?:invoke|query|read|describe)|module_invoke|module_query|module_read|module_describe)\b/i.test(compact)
    || /<\/\s*(?:module[_.-]?(?:invoke|query|read|describe)|module_invoke|module_query|module_read|module_describe)\s*>/i.test(compact)
    || /\btool_calls?\s*[:=]\s*\[\s*\{/i.test(compact)
    || /\b(?:module[_.-]?invoke|module_invoke)\b/i.test(compact) && /\bexecuteBoundedOperation\b/i.test(compact)
    || /\bbrowser\s+executeBoundedOperation\s*\{/i.test(compact)
    || /\bmodule_(?:invoke|query|read|describe)\s*[:=]?\s*\{/i.test(compact)
    || (/\b["']?moduleId["']?\s*:/i.test(compact)
      && /\b(?:["']?intent["']?\s*:|["']?operationKind["']?\s*:|executeBoundedOperation|ownerModuleId|requiredEvidence|maxModelCalls)\b/i.test(compact))
    || /\b(?:recipient_name|tool_call_id)\s*[:=]\s*["'][\w.-]+["']/i.test(compact);
}
