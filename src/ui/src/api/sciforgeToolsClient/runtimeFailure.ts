export interface RuntimeFailureClassification {
  failureKind: string;
  ownerLayer: string;
  retryable: boolean;
  publicFailureReason: string;
}

export function publicRuntimeFailureReason(stderrSummary: string | undefined, exitCode: number | undefined) {
  return classifyRuntimeFailure(stderrSummary, exitCode).publicFailureReason;
}

export function classifyRuntimeFailure(stderrSummary: string | undefined, exitCode: number | undefined): RuntimeFailureClassification {
  const text = stderrSummary ?? '';
  if (/without a safe final assistant answer|final-answer-required/i.test(text)) {
    return runtimeFailureClassification('missing-final-answer', 'runtime-projection', true, 'Runtime Codex completed without a safe final assistant answer; SciForge withheld raw runtime diagnostics from the primary result.');
  }
  if (/401|unauthorized|invalid token/i.test(text)) {
    return runtimeFailureClassification('provider-auth', 'provider-config', false, 'Runtime Codex provider rejected credentials (401 Unauthorized). Check SCIFORGE_RUNTIME_API_KEY and the configured Model Router member model credentials.');
  }
  if (/403|forbidden/i.test(text)) {
    return runtimeFailureClassification('provider-forbidden', 'provider-access', false, 'Runtime Codex provider or plugin access was forbidden (403). Check the configured Model Router member model credentials and account access.');
  }
  if (/429|rate limit|quota|insufficient_quota/i.test(text)) {
    return runtimeFailureClassification('provider-quota', 'provider-budget', false, 'Runtime Codex provider rate limit or quota blocked the run. Check the configured Model Router member model account limits.');
  }
  if (/502|bad gateway/i.test(text)) {
    return runtimeFailureClassification('provider-gateway', 'provider-upstream', true, 'Runtime Codex provider gateway returned 502 Bad Gateway. Treat this as an upstream/transient provider failure and retry with preserved audit refs.');
  }
  if (/ECONNREFUSED|connection refused|failed to connect/i.test(text)) {
    return runtimeFailureClassification('model-router-unreachable', 'model-router', true, 'Runtime Codex could not reach the configured Model Router. Check that the Model Router is running and the base URL is correct.');
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|nodename nor servname|DNS|network|timeout|timed out/i.test(text)) {
    return runtimeFailureClassification('external-network', 'external-network', true, 'Runtime Codex provider network request failed. Check network access and the configured Model Router member model endpoint.');
  }
  if (/ENOENT|spawn .*ENOENT|command not found|executable not found|No such file or directory/i.test(text)) {
    return runtimeFailureClassification('runtime-tool-missing', 'local-runtime', false, 'Runtime Codex could not start a required local tool or executable. Check the Runtime Codex installation and PATH.');
  }
  if (/ENOSPC|no space left|tmpdir|temporary directory|permission denied|EACCES/i.test(text)) {
    return runtimeFailureClassification('local-environment', 'local-environment', false, 'Runtime Codex failed in the local environment. Check disk space, temporary directory access, and workspace permissions.');
  }
  return runtimeFailureClassification('runtime-exit', 'runtime-codex', true, `Runtime Codex exited with code ${exitCode ?? 'unknown'}.`);
}

function runtimeFailureClassification(
  failureKind: string,
  ownerLayer: string,
  retryable: boolean,
  publicFailureReason: string,
): RuntimeFailureClassification {
  return {
    failureKind,
    ownerLayer,
    retryable,
    publicFailureReason,
  };
}

export function actionableRuntimeStderrSummary(compact: string): string | undefined {
  for (const pattern of [
    /unexpected status\s+401[^.]*|401\s+Unauthorized[^.]*|Invalid token[^.]*/i,
    /unexpected status\s+429[^.]*|429\s+Too Many Requests[^.]*|rate limit[^.]*|quota[^.]*/i,
    /unexpected status\s+502[^.]*|502\s+Bad Gateway[^.]*|Bad Gateway[^.]*/i,
    /ECONNREFUSED[^.]*|connection refused[^.]*|failed to connect[^.]*/i,
    /ENOTFOUND[^.]*|timed out[^.]*/i,
    /unexpected status\s+403[^.]*|403\s+Forbidden[^.]*/i,
  ]) {
    const match = pattern.exec(compact);
    if (match?.[0] && !isRemotePluginAuthWarning(compact, match.index)) {
      return match[0].length > 240 ? `${match[0].slice(0, 237)}...` : match[0];
    }
  }
  return undefined;
}

function isRemotePluginAuthWarning(text: string, matchIndex: number) {
  const context = text.slice(Math.max(0, matchIndex - 180), matchIndex + 240);
  return /codex_core_plugins|remote plugin sync|chatgpt\.com\/backend-api\/plugins|featured plugin ids/i.test(context);
}
