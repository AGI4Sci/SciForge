import type { PeerInstance, SciForgeConfig, TargetInstanceContext } from '../../domain';
import { nowIso } from '../../domain';
import { listFeedbackIssues, loadFeedbackIssueHandoffBundle } from '../../api/workspaceClient';

export const CURRENT_TARGET_INSTANCE_VALUE = '__current__';

export function enabledPeerInstances(config: SciForgeConfig) {
  return (config.peerInstances ?? [])
    .filter((peer) => peer.enabled && peer.name.trim() && peer.workspaceWriterUrl.trim());
}

export function selectedPeerInstance(config: SciForgeConfig, selectedName: string) {
  if (selectedName === CURRENT_TARGET_INSTANCE_VALUE) return undefined;
  return enabledPeerInstances(config).find((peer) => peer.name === selectedName);
}

export function baseTargetInstanceContext(peer?: PeerInstance): TargetInstanceContext {
  if (!peer) {
    return {
      mode: 'current',
      selectedAt: nowIso(),
      banner: '当前实例：读取并修改当前 workspace。',
    };
  }
  return {
    mode: 'peer',
    selectedAt: nowIso(),
    banner: `当前正在读取并修改目标实例 workspace：${peer.name}`,
    peer: {
      name: peer.name,
      appUrl: peer.appUrl,
      workspaceWriterUrl: peer.workspaceWriterUrl,
      workspacePath: peer.workspacePath,
      role: peer.role,
      trustLevel: peer.trustLevel,
    },
  };
}

export async function buildTargetInstanceContextForPrompt(params: {
  config: SciForgeConfig;
  peer?: PeerInstance;
  prompt: string;
}): Promise<TargetInstanceContext> {
  const base = baseTargetInstanceContext(params.peer);
  if (!params.peer) return base;
  const issueQuery = parseIssueLookupQuery(params.prompt);
  if (!issueQuery) return base;
  const targetConfig = configForPeer(params.config, params.peer);
  try {
    if (issueQuery.trigger === 'feedback-id') {
      const bundle = await loadFeedbackIssueHandoffBundle(targetConfig, issueQuery.value);
      return {
        ...base,
        issueLookup: {
          trigger: issueQuery.trigger,
          query: issueQuery.value,
          workspaceWriterUrl: params.peer.workspaceWriterUrl,
          workspacePath: params.peer.workspacePath,
          bundle,
          matchedIssueId: bundle.id,
          status: 'resolved',
        },
      };
    }

    const summaries = await listFeedbackIssues(targetConfig);
    const matched = issueQuery.trigger === 'github-number'
      ? summaries.find((issue) => issue.github?.issueNumber === issueQuery.number)
      : undefined;
    const bundle = matched ? await loadFeedbackIssueHandoffBundle(targetConfig, matched.id) : undefined;
    return {
      ...base,
      issueLookup: {
        trigger: issueQuery.trigger,
        query: issueQuery.value,
        workspaceWriterUrl: params.peer.workspaceWriterUrl,
        workspacePath: params.peer.workspacePath,
        summaries,
        bundle,
        matchedIssueId: matched?.id,
        githubIssueNumber: issueQuery.trigger === 'github-number' ? issueQuery.number : undefined,
        status: issueQuery.trigger === 'github-number' && !matched ? 'not-found' : 'resolved',
      },
    };
  } catch (error) {
    return {
      ...base,
      issueLookup: {
        trigger: issueQuery.trigger,
        query: issueQuery.value,
        workspaceWriterUrl: params.peer.workspaceWriterUrl,
        workspacePath: params.peer.workspacePath,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function targetIssueLookupFailureMessage(context: TargetInstanceContext) {
  if (context.mode !== 'peer' || !context.issueLookup) return undefined;
  const lookup = context.issueLookup;
  if (lookup.status === 'resolved' && lookup.bundle) return undefined;
  if (lookup.trigger !== 'feedback-id' && lookup.trigger !== 'github-number') return undefined;
  const targetName = context.peer?.name ?? '目标实例';
  const base = lookup.status === 'not-found'
    ? `${targetName} 中没有找到 ${lookup.trigger === 'github-number' ? `GitHub ${lookup.query}` : `feedback #${lookup.query}`} 对应的 issue bundle。`
    : `${targetName} issue bundle 读取失败：${lookup.error || '目标实例不可达或返回了无效响应。'}`;
  return [
    base,
    '未启动修复，避免误改当前实例。',
    '请检查 B 的 workspaceWriterUrl、端口、instance manifest、workspacePath 是否正确，并确认目标 Workspace Writer 正在运行。',
  ].join(' ');
}

function configForPeer(config: SciForgeConfig, peer: PeerInstance): SciForgeConfig {
  return {
    ...config,
    workspaceWriterBaseUrl: peer.workspaceWriterUrl,
    workspacePath: peer.workspacePath,
  };
}

function parseIssueLookupQuery(prompt: string): { trigger: 'feedback-id'; value: string } | { trigger: 'github-number'; value: string; number: number } | { trigger: 'issue-summaries'; value: string } | undefined {
  const normalized = prompt.trim();
  if (!normalized) return undefined;
  const feedbackId = /(?:反馈|feedback)\s*#?\s*([A-Za-z0-9][A-Za-z0-9._:-]{1,80})/i.exec(normalized);
  if (feedbackId) return { trigger: 'feedback-id', value: feedbackId[1] };
  const githubNumber = /(?:github|gh|issue)\s*#\s*(\d{1,8})/i.exec(normalized);
  if (githubNumber) return { trigger: 'github-number', value: `#${githubNumber[1]}`, number: Number(githubNumber[1]) };
  if (/(修复|repair|反馈|feedback|github|issue)/i.test(normalized)) return { trigger: 'issue-summaries', value: normalized.slice(0, 160) };
  return undefined;
}
