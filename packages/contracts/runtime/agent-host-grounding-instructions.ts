export interface AgentHostGroundingInstructionSnapshot {
  productCapabilities: {
    browser: string;
    computerUse: string;
  };
  runtimeReadiness: {
    browser: string;
    computerUse: string;
  };
  blockers: string[];
  authorizationProfile?: {
    id: string;
  };
  actionContext: {
    targetBound: boolean;
    freshObservation: boolean;
    permissionRefsPresent: boolean;
    stopCancelPath: boolean;
  };
  refs: string[];
}

export function agentHostGroundingDeveloperInstructionLines(agentHostGrounding: AgentHostGroundingInstructionSnapshot): string[] {
  const evidenceRefs = agentHostGrounding.refs.map(sanitizeAgentHostGroundingInstructionValue).slice(0, 8);
  return [
    '- Agent Host grounded capability facts for this turn are authoritative; use them for Browser/Computer Use capability answers instead of generic model self-knowledge.',
    `- Product capabilities: Browser=${agentHostGrounding.productCapabilities.browser}; Computer Use=${agentHostGrounding.productCapabilities.computerUse}.`,
    `- Runtime readiness: Browser=${agentHostGrounding.runtimeReadiness.browser}; Computer Use=${agentHostGrounding.runtimeReadiness.computerUse}.`,
    `- Computer Use blockers: ${agentHostGrounding.blockers.length ? agentHostGrounding.blockers.map(sanitizeAgentHostGroundingInstructionValue).join(', ') : 'none'}.`,
    `- Action context: targetBound=${agentHostGrounding.actionContext.targetBound}; freshObservation=${agentHostGrounding.actionContext.freshObservation}; permissionRefsPresent=${agentHostGrounding.actionContext.permissionRefsPresent}; stopCancelPath=${agentHostGrounding.actionContext.stopCancelPath}.`,
    `- Authorization scope: ${agentHostGrounding.authorizationProfile?.id ?? 'unknown'} for current-user/current-workspace; hard confirmation and blocked policy remain enforced by Agent Host.`,
    `- Evidence refs: ${evidenceRefs.length ? evidenceRefs.join(', ') : 'none'}.`,
    '- Do not claim SciForge has no direct Browser or Computer Use product capability; state supported capability plus the current readiness/blockers from these facts.',
  ];
}

function sanitizeAgentHostGroundingInstructionValue(value: string): string {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [redacted-secret]')
    .replace(/\b(?:sk|rk|pk|ghp|github_pat)[_-][A-Za-z0-9._-]{8,}\b/gi, '[redacted-secret]')
    .replace(/\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|authorization|credential|client[_-]?secret)\b\s*[:=]?\s*["']?([^"'\s,;)}\]]{4,})?/gi, '$1=[redacted-secret]')
    .replace(/\bhttps?:\/\/[^\s"'<>\\)]+/gi, '[redacted-url]')
    .replace(/(^|[\s([{:=])((?:~\/|\/(?:Applications|Users|workspace|tmp|var|private|Volumes|home|opt|etc|mnt|srv|Library)\b)[^\s"',;)}\]]*)/gi, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/(^|[\s([{:=])((?:[A-Za-z]:[\\/]|\\\\)[^\s"',;)}\]]*)/g, (_match, prefix: string) => `${prefix}[redacted-path]`)
    .replace(/\b(?:stdout|stderr|raw[_ -]?jsonl?|jsonl|raw[_ -]?transcript|raw[_ -]?provider[_ -]?(?:body|payload|output)|provider[_ -]?raw[_ -]?(?:body|payload|output))\b/gi, 'runtime audit')
    .slice(0, 120);
}
