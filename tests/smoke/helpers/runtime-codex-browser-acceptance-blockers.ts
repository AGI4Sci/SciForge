export function blockedOnForReason(reason: string): string[] {
  if (/selected[- ]artifact|selected ref|artifact follow-up/i.test(reason)) {
    return [
      'selected artifact/report live browser follow-up',
      'visible Runtime Codex answer for the selected-ref task',
      'artifactFollowUp scenario evidence refs',
    ];
  }
  if (/config file debug fallback|service environment/i.test(reason) && /SCIFORGE_RUNTIME_API_KEY|secret/i.test(reason)) {
    return [
      'Runtime Codex service environment secret configuration',
      'config-file debug secret fallback must not satisfy release acceptance',
      'Codex in-app browser execution',
    ];
  }
  if (/API key|upstream base URL|environment/i.test(reason)) {
    return [
      'Runtime Codex environment configuration',
      'Runtime Codex Model Router member model configuration',
      'Codex in-app browser execution',
    ];
  }
  if (/502|Bad Gateway|429|timeout|DNS|provider|upstream|outage/i.test(reason)) {
    return [
      'Model Router member model availability',
      'visible Runtime Codex answer not produced',
      'selected artifact follow-up not reached',
    ];
  }
  return ['Runtime Codex bridge integration', 'UI Runtime Codex integration'];
}
