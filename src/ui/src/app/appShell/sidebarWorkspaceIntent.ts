export type SidebarWorkspaceIntentKind = 'new-project' | 'open-workspace' | 'set-current-directory';
export type SidebarWorkspaceIntentSource = 'repositories-header' | 'workspace-connection-panel' | 'manual-path';

export interface SidebarWorkspaceIntent {
  kind: SidebarWorkspaceIntentKind;
  source: SidebarWorkspaceIntentSource;
  workspacePath: string;
  workspaceLabel: string;
  commandText: string;
  approvedNativeIntent: {
    kind: 'pick-directory' | 'manual-directory';
    resultRef: string;
    approved: true;
  };
}

export function buildSidebarWorkspaceIntent({
  kind,
  source,
  workspacePath,
}: {
  kind: SidebarWorkspaceIntentKind;
  source: SidebarWorkspaceIntentSource;
  workspacePath: string;
}): SidebarWorkspaceIntent | undefined {
  const cleanPath = workspacePath.trim();
  if (!cleanPath) return undefined;
  const resultRef = `gui://sidebar/workspace-intent/${kind}/${stableIntentId(cleanPath)}`;
  return {
    kind,
    source,
    workspacePath: cleanPath,
    workspaceLabel: publicWorkspaceLabel(cleanPath),
    commandText: workspaceIntentCommandText(kind, resultRef),
    approvedNativeIntent: {
      kind: source === 'manual-path' ? 'manual-directory' : 'pick-directory',
      resultRef,
      approved: true,
    },
  };
}

export function sidebarWorkspaceIntentEvidence(intent: SidebarWorkspaceIntent) {
  return {
    kind: intent.kind,
    source: intent.source,
    workspaceLabel: intent.workspaceLabel,
    commandText: intent.commandText,
    approvedNativeIntent: intent.approvedNativeIntent,
  };
}

function workspaceIntentCommandText(kind: SidebarWorkspaceIntentKind, resultRef: string) {
  const verb = kind === 'new-project'
    ? 'new'
    : kind === 'set-current-directory'
      ? 'set-current-directory'
      : 'open-workspace';
  return `sciforge project ${verb} --from-sidebar --workspace-ref "${resultRef}"`;
}

function publicWorkspaceLabel(path: string) {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  const label = normalized.split('/').filter(Boolean).pop() || 'Selected workspace';
  if (containsSensitiveTerm(label)) return 'Selected workspace';
  return label.slice(0, 64);
}

function containsSensitiveTerm(value: string) {
  return /\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(value);
}

function stableIntentId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
