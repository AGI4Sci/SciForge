/** Responses items that yield control to the client, rather than an upstream-hosted tool. */
export function isClientToolCall(item: Record<string, unknown>): boolean {
  return item.type === 'function_call' || item.type === 'custom_tool_call'
    || item.type === 'tool_search_call' && item.execution === 'client';
}

export function isClientToolOutput(item: Record<string, unknown>): boolean {
  return item.type === 'function_call_output' || item.type === 'custom_tool_call_output'
    || item.type === 'tool_search_output' && item.execution === 'client';
}
