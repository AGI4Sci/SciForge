export const UPSTREAM_CODEX_COMMAND = 'codex';
export const CODEX_UPSTREAM_PATCH_LOG = 'docs/CodexUpstreamPatchLog.md';

export type CodexForkGateInput = {
  codexCommand?: string;
  allowFork?: boolean;
  configGateAttempted?: boolean;
  runtimeProfileAttempted?: boolean;
  providerProxyAttempted?: boolean;
  blockerConfirmedInCodexCli?: boolean;
  upstreamPatchLogPath?: string;
  upstreamCommit?: string;
  changedFiles?: string[];
  rebaseSteps?: string[];
  validationCommands?: string[];
  rollbackStrategy?: string;
};

export type CodexForkGateResult = {
  codexCommand: string;
  forkAllowed: boolean;
};

export function assertCodexNoForkGate(input: CodexForkGateInput = {}): CodexForkGateResult {
  const codexCommand = (input.codexCommand ?? UPSTREAM_CODEX_COMMAND).trim() || UPSTREAM_CODEX_COMMAND;
  if (codexCommand === UPSTREAM_CODEX_COMMAND && input.allowFork !== true) {
    return { codexCommand, forkAllowed: false };
  }

  if (input.allowFork !== true) {
    throw new Error(`Runtime Codex must use upstream "${UPSTREAM_CODEX_COMMAND}"; refusing forked Codex command: ${codexCommand}`);
  }

  const missing = forkGateMissingFields(input);
  if (missing.length > 0) {
    throw new Error(`Codex fork is blocked until compatibility gates pass: ${missing.join(', ')}`);
  }
  return { codexCommand, forkAllowed: true };
}

function forkGateMissingFields(input: CodexForkGateInput): string[] {
  const missing: string[] = [];
  if (input.configGateAttempted !== true) missing.push('config gate');
  if (input.runtimeProfileAttempted !== true) missing.push('runtime profile gate');
  if (input.providerProxyAttempted !== true) missing.push('provider proxy gate');
  if (input.blockerConfirmedInCodexCli !== true) missing.push('confirmed Codex CLI internal blocker');
  if (input.upstreamPatchLogPath !== CODEX_UPSTREAM_PATCH_LOG) missing.push(CODEX_UPSTREAM_PATCH_LOG);
  if (!input.upstreamCommit?.trim()) missing.push('upstream commit');
  if (!(input.changedFiles ?? []).some((file) => file.trim())) missing.push('changed files');
  if (!(input.rebaseSteps ?? []).some((step) => step.trim())) missing.push('rebase steps');
  if (!(input.validationCommands ?? []).some((command) => command.trim())) missing.push('validation commands');
  if (!input.rollbackStrategy?.trim()) missing.push('rollback strategy');
  return missing;
}
