const GH_ACCEPT = 'application/vnd.github+json';

export type GithubRepairSyncStatus = 'skipped' | 'synced' | 'failed';

export type RepairGithubConfig = {
  repo?: string;
  token?: string;
};

export type RepairGithubIssue = {
  issueNumber?: number;
  issueUrl?: string;
};

export type RepairResultForGithub = {
  id: string;
  issueId: string;
  repairRunId?: string;
  verdict: string;
  summary: string;
  changedFiles: string[];
  evidenceRefs: string[];
  followUp?: string;
  completedAt: string;
  testResults?: RepairTestResult[];
  humanVerification?: RepairHumanVerification;
  refs?: RepairResultRefs;
  executorInstance?: RepairInstanceRef;
  targetInstance?: RepairInstanceRef;
  metadata?: Record<string, unknown>;
};

export type RepairTestResult = {
  name?: string;
  command?: string;
  status: 'passed' | 'failed' | 'skipped';
  summary?: string;
  outputRef?: string;
};

export type RepairHumanVerification = {
  status?: 'verified' | 'rejected' | 'pending' | 'not-run' | 'required' | 'not-required' | 'passed' | 'failed';
  verifier?: string;
  conclusion?: string;
  evidenceRefs?: string[];
  verifiedAt?: string;
};

export type RepairResultRefs = {
  commitSha?: string;
  commitUrl?: string;
  prUrl?: string;
  patchRef?: string;
};

export type RepairInstanceRef = {
  id?: string;
  name?: string;
  workspacePath?: string;
};

export type GithubRepairSyncOutcome = {
  status: GithubRepairSyncStatus;
  syncedAt?: string;
  commentUrl?: string;
  error?: string;
};

export async function syncRepairResultToGithubIssue(params: {
  issue: RepairGithubIssue;
  result: RepairResultForGithub;
  config: RepairGithubConfig;
  syncedAt?: string;
}): Promise<GithubRepairSyncOutcome> {
  const issueNumber = params.issue.issueNumber;
  if (typeof issueNumber !== 'number' || !Number.isFinite(issueNumber) || issueNumber <= 0) {
    return { status: 'skipped', error: 'Feedback issue is not bound to a GitHub Issue.' };
  }
  const repo = normalizeGithubRepo(params.config.repo) ?? githubRepoFromIssueUrl(params.issue.issueUrl);
  if (!repo) return { status: 'skipped', error: 'GitHub repo is not configured.' };
  const token = typeof params.config.token === 'string' ? params.config.token.trim() : '';
  if (!token) return { status: 'skipped', error: 'GitHub token is not configured.' };
  try {
    const body = formatRepairResultGithubComment(params.result);
    const response = await postGithubIssueComment(repo, token, issueNumber, body);
    return {
      status: 'synced',
      syncedAt: params.syncedAt ?? new Date().toISOString(),
      commentUrl: response.htmlUrl,
    };
  } catch (err) {
    return {
      status: 'failed',
      error: sanitizeGithubCommentText(err instanceof Error ? err.message : String(err)),
    };
  }
}

export function formatRepairResultGithubComment(result: RepairResultForGithub) {
  const metadata = result.metadata ?? {};
  const tests = normalizeTestResults(result.testResults ?? readRecordArray(metadata.testResults));
  const humanVerification = normalizeHumanVerification(result.humanVerification ?? readRecord(metadata.humanVerification));
  const refs = normalizeRefs(result.refs ?? readRecord(metadata.refs) ?? readRecord(metadata.references));
  const executor = normalizeInstanceRef(result.executorInstance ?? readRecord(metadata.executorInstance) ?? {
    id: stringValue(metadata.sourceInstanceId) ?? stringValue(metadata.executorInstanceId),
    name: stringValue(metadata.sourceInstanceName) ?? stringValue(metadata.executorInstanceName),
  });
  const target = normalizeInstanceRef(result.targetInstance ?? readRecord(metadata.targetInstance) ?? {
    id: stringValue(metadata.targetInstanceId),
    name: stringValue(metadata.targetInstanceName),
  });
  const effectiveVerdict = effectiveRepairVerdict(result.verdict, tests, humanVerification);
  const lines: string[] = [];
  lines.push('## SciForge Repair Result');
  lines.push('');
  lines.push(`- **Final verdict**: \`${effectiveVerdict}\``);
  lines.push(`- **Repair result**: \`${safeInline(result.id)}\``);
  if (result.repairRunId) lines.push(`- **Repair run**: \`${safeInline(result.repairRunId)}\``);
  lines.push(`- **完成时间**: ${safeInline(result.completedAt) || 'unknown'}`);
  lines.push('');
  appendSection(lines, 'Repair Summary', [sanitizeGithubCommentText(result.summary) || '未提供摘要。']);
  appendSection(lines, 'Executor / Target Instance', [
    `- Executor: ${formatInstance(executor)}`,
    `- Target: ${formatInstance(target)}`,
  ]);
  appendSection(lines, 'Tests Summary', formatTestResults(tests));
  appendSection(lines, 'Human Verification', formatHumanVerification(humanVerification));
  appendListSection(lines, 'Changed Files', result.changedFiles.map((file) => `\`${safeInline(file)}\``), '未记录文件变更。');
  appendSection(lines, 'Commit / PR / Patch Ref', formatRefs(refs));
  appendSection(lines, '下一步', [sanitizeGithubCommentText(result.followUp ?? nextStepForVerdict(effectiveVerdict, tests, humanVerification))]);
  lines.push('');
  lines.push('> SciForge 仅追加此 comment，不会自动关闭 GitHub Issue。');
  return lines.join('\n');
}

export function effectiveRepairVerdict(
  verdict: string,
  testResults: RepairTestResult[] = [],
  humanVerification?: RepairHumanVerification,
) {
  if (testResults.some((test) => test.status === 'failed')) return 'failed';
  if (humanVerification?.status === 'rejected') return 'needs-follow-up';
  const normalized = sanitizeGithubCommentText(verdict || 'needs-follow-up') || 'needs-follow-up';
  if (normalized === 'fixed' && testResults.length === 0) return 'needs-human-verification';
  return normalized;
}

export function sanitizeGithubCommentText(value: string) {
  return value
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, '[redacted dataUrl]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[a-z0-9_]{20,}\b/gi, '[redacted github token]')
    .replace(/\b(?:sk|pat|token)_[a-z0-9_-]{20,}\b/gi, '[redacted token]')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function normalizeGithubRepo(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/\.git$/i, '');
  if (!trimmed) return undefined;
  const fromUrl = /github\.com[/:]([^/]+)\/([^/?#]+)/i.exec(trimmed);
  if (fromUrl) return `${fromUrl[1]}/${fromUrl[2].replace(/\.git$/i, '')}`;
  const slash = /^([\w.-]+)\/([\w.-]+)$/.exec(trimmed.replace(/^\/+/, ''));
  return slash ? `${slash[1]}/${slash[2]}` : undefined;
}

export function githubRepoFromIssueUrl(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const match = /github\.com\/([^/]+)\/([^/]+)\/issues\/\d+/i.exec(value.trim());
  return match ? `${match[1]}/${match[2].replace(/\.git$/i, '')}` : undefined;
}

async function postGithubIssueComment(repoFull: string, token: string, issueNumber: number, body: string) {
  const [owner, repo] = repoFull.split('/');
  const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: {
      Accept: GH_ACCEPT,
      Authorization: `Bearer ${token.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  if (!response.ok) throw new Error(await readGithubError(response));
  const json = await response.json() as { html_url?: string };
  return { htmlUrl: typeof json.html_url === 'string' ? json.html_url : undefined };
}

async function readGithubError(response: Response) {
  const text = await response.text();
  try {
    const json = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
    const details = json.errors?.map((item) => item.message).filter(Boolean).join('; ');
    return `GitHub API ${response.status}: ${[json.message, details].filter(Boolean).join(' · ') || response.statusText}`;
  } catch {
    return `GitHub API ${response.status}: ${text || response.statusText}`;
  }
}

function appendSection(lines: string[], title: string, body: string[]) {
  lines.push(`### ${title}`);
  lines.push('');
  lines.push(...body.filter(Boolean));
  lines.push('');
}

function appendListSection(lines: string[], title: string, values: string[], fallback: string) {
  appendSection(lines, title, values.length ? values.map((value) => `- ${value}`) : [fallback]);
}

function formatTestResults(tests: RepairTestResult[]) {
  if (!tests.length) return ['- `missing` 未记录测试结果；不能作为 fixed 结论的核心证据。'];
  return tests.map((test) => {
    const label = safeInline(test.name || test.command || 'test');
    const command = test.command ? `, command: \`${safeInline(test.command)}\`` : '';
    const summary = test.summary ? `, ${sanitizeGithubCommentText(test.summary)}` : '';
    const output = test.outputRef ? `, output: \`${safeInline(test.outputRef)}\`` : '';
    return `- \`${test.status}\` ${label}${command}${summary}${output}`;
  });
}

function formatHumanVerification(value?: RepairHumanVerification) {
  if (!value || !value.status) return ['未记录人工核验。'];
  const body = [
    `status: \`${value.status}\``,
    value.verifier ? `verifier: ${safeInline(value.verifier)}` : '',
    value.conclusion ? `conclusion: ${sanitizeGithubCommentText(value.conclusion)}` : '',
    value.evidenceRefs?.length ? `evidenceRefs: ${value.evidenceRefs.map((ref) => `\`${safeInline(ref)}\``).join(', ')}` : '',
    value.verifiedAt ? `at: ${safeInline(value.verifiedAt)}` : '',
  ].filter(Boolean).join('; ');
  return [`- ${body}`];
}

function formatRefs(refs?: RepairResultRefs) {
  const values: string[] = [];
  if (refs?.commitSha) values.push(`- Commit: \`${safeInline(refs.commitSha)}\``);
  if (refs?.commitUrl) values.push(`- Commit URL: ${safeInline(refs.commitUrl)}`);
  if (refs?.prUrl) values.push(`- PR: ${safeInline(refs.prUrl)}`);
  if (refs?.patchRef) values.push(`- Patch: \`${safeInline(refs.patchRef)}\``);
  return values.length ? values : ['未记录 commit / PR / patch ref。'];
}

function nextStepForVerdict(verdict: string, tests: RepairTestResult[], human?: RepairHumanVerification) {
  if (tests.some((test) => test.status === 'failed')) return '测试失败，需要继续修复并重新写回结果。';
  if (verdict === 'needs-human-verification') return '缺少测试证据，等待人工核验或补充测试结果后再认定 fixed。';
  if (human?.status === 'pending' || human?.status === 'not-run') return '等待人工核验。';
  if (human?.status === 'rejected') return '人工核验未通过，需要继续修复。';
  if (verdict === 'fixed') return '请维护者复核后手动关闭 Issue。';
  return '请根据结论安排后续修复或复核。';
}

function formatInstance(value?: RepairInstanceRef) {
  const parts = [value?.name, value?.id].map((item) => safeInline(item ?? '')).filter(Boolean);
  const workspace = value?.workspacePath ? ` (\`${safeInline(value.workspacePath)}\`)` : '';
  return `${parts.join(' / ') || 'unknown'}${workspace}`;
}

function safeInline(value: string) {
  return sanitizeGithubCommentText(value).replace(/[`|]/g, '\\$&').slice(0, 600);
}

function normalizeTestResults(values: unknown): RepairTestResult[] {
  if (!Array.isArray(values)) return [];
  return values.filter(isRecord).map((item) => ({
    name: stringValue(item.name),
    command: stringValue(item.command),
    status: item.status === 'passed' || item.status === 'failed' || item.status === 'skipped' ? item.status : 'skipped',
    summary: stringValue(item.summary),
    outputRef: stringValue(item.outputRef),
  }));
}

function normalizeHumanVerification(value: unknown): RepairHumanVerification | undefined {
  if (!isRecord(value)) return undefined;
  return {
    status: value.status === 'verified' || value.status === 'rejected' || value.status === 'pending' || value.status === 'not-run'
      || value.status === 'required' || value.status === 'not-required' || value.status === 'passed' || value.status === 'failed'
      ? value.status
      : undefined,
    conclusion: stringValue(value.conclusion),
    verifier: stringValue(value.verifier),
    evidenceRefs: Array.isArray(value.evidenceRefs) ? value.evidenceRefs.map(stringValue).filter((item): item is string => Boolean(item)) : undefined,
    verifiedAt: stringValue(value.verifiedAt),
  };
}

function normalizeRefs(value: unknown): RepairResultRefs | undefined {
  if (!isRecord(value)) return undefined;
  return {
    commitSha: stringValue(value.commitSha),
    commitUrl: stringValue(value.commitUrl),
    prUrl: stringValue(value.prUrl),
    patchRef: stringValue(value.patchRef),
  };
}

function normalizeInstanceRef(value: unknown): RepairInstanceRef | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: stringValue(value.id),
    name: stringValue(value.name),
    workspacePath: stringValue(value.workspacePath),
  };
}

function readRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function readRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
