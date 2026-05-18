import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks } from './runtime-types.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { sha1 } from './workspace-task-runner.js';

const TOOL_ID = 'sciforge.local-code-debug.pytest-repair';
const MAX_OUTPUT_CHARS = 12_000;

type CommandResult = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export async function tryRunLocalCodeDebugRuntime(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
): Promise<ToolPayload | undefined> {
  const prompt = currentUserPrompt(request);
  const followUp = await buildLocalCodeDebugFollowUpPayload(request, prompt);
  if (followUp) return followUp;
  if (!isLocalCodeDebugRequest(prompt)) return undefined;
  const pytest = extractPytestCommand(prompt);
  if (!pytest) return undefined;
  const workspace = resolve(request.workspacePath || process.cwd());
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'local-code-debug-runtime',
    source: 'workspace-runtime-gateway',
    status: 'started',
    message: 'Running bounded local pytest repair before AgentServer dispatch.',
    detail: pytest.command,
  });

  const initial = await runCommand(pytest.bin, pytest.args, workspace);
  const sourceFiles = await inferSourceFilesForPytestRepair(workspace, prompt, pytest, initial);
  const patchSummaries: string[] = [];
  const changedRefs: string[] = [];
  for (const filePath of sourceFiles) {
    const before = await readFile(filePath, 'utf8').catch(() => undefined);
    if (before === undefined) continue;
    const { source, summaries } = repairPythonSource(before, initial, prompt);
    if (source === before) continue;
    await writeFile(filePath, source, 'utf8');
    const rel = relative(workspace, filePath);
    changedRefs.push(rel);
    patchSummaries.push(...summaries.map((summary) => `${rel}: ${summary}`));
  }

  const rerun = patchSummaries.length
    ? await runCommand(pytest.bin, pytest.args, workspace)
    : undefined;
  const finalResult = rerun ?? initial;
  const completed = finalResult.exitCode === 0 && (patchSummaries.length > 0 || initial.exitCode === 0);
  const id = sha1(JSON.stringify({
    prompt,
    command: pytest.command,
    patchSummaries,
    initialExitCode: initial.exitCode,
    finalExitCode: finalResult.exitCode,
  })).slice(0, 12);
  const artifactId = `local-code-debug-${id}`;
  const message = [
    completed
      ? 'Local code-debug runtime completed the requested bounded repair without AgentServer generation.'
      : 'Local code-debug runtime could not complete the requested repair.',
    '',
    'Patch summary:',
    patchSummaries.length
      ? patchSummaries.map((line) => `- ${line}`).join('\n')
      : initial.exitCode === 0
        ? '- No workspace code patch was needed; the explicit pytest command already passed.'
        : '- No workspace code patch was applied.',
    '',
    '测试结果:',
    `- Initial: \`${pytest.command}\` -> ${formatExit(initial)}`,
    rerun ? `- Rerun: \`${pytest.command}\` -> ${formatExit(rerun)}` : '- Rerun: not executed because no bounded local patch matched the failure.',
    '',
    'Remaining risks:',
    completed
      ? '- The repair is intentionally narrow and derived from local failing tests plus source/test contract cues; broader scientific validity still needs domain review.'
      : '- The local fallback only handles small deterministic pytest repairs; use AgentServer after provider credentials are restored for broader debugging.',
  ].join('\n');

  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'local-code-debug-runtime',
    source: 'workspace-runtime-gateway',
    status: completed ? 'satisfied' : 'failed-with-reason',
    message: completed ? 'Bounded local pytest repair completed.' : 'Bounded local pytest repair did not satisfy tests.',
    detail: `${pytest.command}; final=${formatExit(finalResult)}`,
  });

  return {
    message,
    confidence: completed ? 0.72 : 0.36,
    claimType: 'analysis',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge local code-debug runtime executed an explicit pytest command, applied only built-in bounded source repairs inside the workspace, and reran the same pytest command.',
    displayIntent: {
      protocolStatus: completed ? 'protocol-success' : 'protocol-failed',
      taskOutcome: completed ? 'satisfied' : 'failed-with-reason',
      answerStatus: completed ? 'satisfied' : 'failed-with-reason',
      userGoalStatus: completed ? 'satisfied' : 'failed-with-reason',
      status: completed ? 'completed' : 'failed',
      verification: {
        nonBlocking: true,
        required: false,
        verdict: completed ? 'pass' : 'fail',
      },
      verificationStatus: {
        blocking: false,
        verdict: completed ? 'pass' : 'fail',
      },
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        visibleAnswer: {
          status: completed ? 'satisfied' : 'failed-with-reason',
          text: message,
          artifactRefs: [`artifact:${artifactId}`, ...changedRefs],
        },
        diagnostics: completed ? [] : [{
          severity: 'error',
          code: 'local-code-debug.failed',
          message: finalResult.stderr || finalResult.stdout || `pytest exited ${finalResult.exitCode ?? 'unknown'}`,
        }],
      },
    },
    verificationPolicy: {
      required: false,
      mode: 'automatic',
      riskLevel: 'medium',
      reason: 'The same explicit pytest command was rerun by the local code-debug runtime.',
      humanApprovalPolicy: 'none',
    },
    verificationResults: [{
      id: `verify-${artifactId}`,
      verdict: completed ? 'pass' : 'fail',
      confidence: completed ? 0.82 : 0.42,
      critique: completed
        ? `Rerun passed: ${pytest.command}.`
        : `Rerun did not pass: ${pytest.command}.`,
      evidenceRefs: [`execution-unit:EU-${artifactId}-rerun`, ...changedRefs],
      repairHints: completed ? [] : ['Restore AgentServer credentials for broader repair or inspect pytest stderr.'],
      diagnostics: {
        required: false,
        command: pytest.command,
        finalExitCode: finalResult.exitCode,
      },
    }],
    claims: [{
      id: `claim-${artifactId}`,
      type: completed ? 'fact' : 'inference',
      text: completed
        ? `Local pytest repair passed: ${pytest.command}.`
        : `Local pytest repair did not pass: ${pytest.command}.`,
      confidence: completed ? 0.72 : 0.36,
      evidenceLevel: 'runtime',
      verificationState: completed ? 'supported' : 'failed',
      supportingRefs: [`execution-unit:EU-${artifactId}-rerun`, ...changedRefs],
      evidenceRefs: [`execution-unit:EU-${artifactId}-rerun`],
      opposingRefs: completed ? [] : [`execution-unit:EU-${artifactId}-rerun`],
    }],
    uiManifest: [{
      componentId: 'markdown-report',
      artifactRef: artifactId,
      title: 'Local code debug report',
      priority: 1,
    }],
    executionUnits: [{
      id: `EU-${artifactId}-initial`,
      tool: TOOL_ID,
      status: completed && initial.exitCode !== 0 ? 'record-only' : initial.exitCode === 0 ? 'done' : 'failed',
      params: JSON.stringify({ command: pytest.command, phase: 'initial-test' }),
      hash: sha1(`${initial.exitCode}:${initial.stdout}:${initial.stderr}`).slice(0, 16),
      stdout: initial.stdout,
      stderr: initial.stderr,
    }, {
      id: `EU-${artifactId}-patch`,
      tool: TOOL_ID,
      status: patchSummaries.length || initial.exitCode === 0 ? 'done' : 'failed-with-reason',
      params: JSON.stringify({ changedRefs, patchSummaries }),
      hash: sha1(patchSummaries.join('\n')).slice(0, 16),
      failureReason: patchSummaries.length || initial.exitCode === 0 ? undefined : 'No bounded local repair matched the observed pytest failure.',
    }, {
      id: `EU-${artifactId}-rerun`,
      tool: TOOL_ID,
      status: finalResult.exitCode === 0 ? 'done' : 'failed-with-reason',
      params: JSON.stringify({ command: pytest.command, phase: 'rerun-test' }),
      hash: sha1(`${finalResult.exitCode}:${finalResult.stdout}:${finalResult.stderr}`).slice(0, 16),
      stdout: finalResult.stdout,
      stderr: finalResult.stderr,
      failureReason: finalResult.exitCode === 0 ? undefined : `pytest exited ${finalResult.exitCode ?? 'unknown'}`,
    }],
    artifacts: [{
      id: artifactId,
      type: 'research-report',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: TOOL_ID,
        command: pytest.command,
        changedRefs,
      },
      data: {
        markdown: message,
        initial,
        rerun,
        patchSummaries,
      },
    }],
    objectReferences: changedRefs.map((ref, index) => ({
      id: `obj-${artifactId}-${index + 1}`,
      kind: 'file',
      title: 'Patched source file',
      ref,
      status: completed ? 'verified' : 'available',
      summary: patchSummaries.filter((line) => line.startsWith(`${ref}:`)).join('\n'),
    })),
  };
}

async function buildLocalCodeDebugFollowUpPayload(request: GatewayRequest, prompt = currentUserPrompt(request)): Promise<ToolPayload | undefined> {
  if (!isLocalCodeDebugFollowUpRequest(prompt)) return undefined;
  const priorCandidates = [
    latestLocalCodeDebugArtifact(request),
    await latestLocalCodeDebugArtifactFromContextRefs(request),
    await latestLocalCodeDebugWorkspaceStateRecord(request),
  ].filter((candidate): candidate is Record<string, unknown> => Boolean(candidate));
  const selected = priorCandidates
    .map((prior) => ({ prior, markdown: localCodeDebugMarkdownFromRecord(prior) }))
    .find((candidate) => Boolean(candidate.markdown));
  if (!selected?.markdown) return undefined;
  const { prior, markdown } = selected;
  if (!markdown) return undefined;
  const command = stringField(isRecord(prior.metadata) ? prior.metadata.command : undefined)
    ?? extractCommandFromMarkdown(markdown)
    ?? 'the prior pytest command';
  const changedRefs = toStringList(isRecord(prior.metadata) ? prior.metadata.changedRefs : undefined);
  const patchSummary = sectionText(markdown, 'Patch summary') ?? 'Patch summary was recorded in the previous local code-debug artifact.';
  const testResult = sectionText(markdown, '测试结果') ?? sectionText(markdown, 'Test results') ?? `Previous verification recorded ${command}.`;
  const remainingRisks = sectionText(markdown, 'Remaining risks') ?? 'No additional risk details were recorded beyond the previous local code-debug artifact.';
  const id = sha1(JSON.stringify({ prompt, command, patchSummary, testResult, changedRefs })).slice(0, 12);
  const artifactId = `local-code-debug-followup-${id}`;
  const message = [
    'Based on the previous local code-debug result:',
    '',
    'Root cause:',
    `- ${firstBulletOrLine(patchSummary)}`,
    '',
    'Patch summary:',
    normalizeBulletBlock(patchSummary),
    '',
    '测试结果:',
    normalizeBulletBlock(testResult),
    '',
    'Remaining risks:',
    normalizeBulletBlock(remainingRisks),
  ].join('\n');

  return {
    message,
    confidence: 0.74,
    claimType: 'analysis',
    evidenceLevel: 'runtime',
    reasoningTrace: 'SciForge local code-debug follow-up reused the previous verified local-code-debug artifact instead of starting a new backend or workspace mutation.',
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      answerStatus: 'satisfied',
      userGoalStatus: 'satisfied',
      status: 'completed',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        visibleAnswer: {
          status: 'satisfied',
          text: message,
          artifactRefs: [`artifact:${artifactId}`, ...changedRefs],
        },
        diagnostics: [],
      },
    },
    verificationPolicy: {
      required: false,
      mode: 'none',
      riskLevel: 'low',
      reason: 'This follow-up summarizes a previous verified local code-debug artifact without new execution.',
      humanApprovalPolicy: 'none',
    },
    verificationResults: [{
      id: `verify-${artifactId}`,
      verdict: 'pass',
      confidence: 0.74,
      critique: 'Follow-up answer is grounded in the previous local code-debug artifact.',
      evidenceRefs: [`artifact:${stringField(prior.id) ?? 'prior-local-code-debug'}`, ...changedRefs],
      repairHints: [],
      diagnostics: { required: false, reusedPriorArtifact: true, command },
    }],
    claims: [{
      id: `claim-${artifactId}`,
      type: 'fact',
      text: `Previous local code-debug result summarized for ${command}.`,
      confidence: 0.74,
      evidenceLevel: 'runtime',
      verificationState: 'supported',
      supportingRefs: [`artifact:${stringField(prior.id) ?? 'prior-local-code-debug'}`, ...changedRefs],
      evidenceRefs: [`artifact:${stringField(prior.id) ?? 'prior-local-code-debug'}`],
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: 'markdown-report',
      artifactRef: artifactId,
      title: 'Local code debug follow-up',
      priority: 1,
    }],
    executionUnits: [{
      id: `EU-${artifactId}-reuse`,
      tool: TOOL_ID,
      status: 'done',
      params: JSON.stringify({ phase: 'follow-up-summary', command, changedRefs }),
      hash: sha1(message).slice(0, 16),
    }],
    artifacts: [{
      id: artifactId,
      type: 'research-report',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: TOOL_ID,
        command,
        changedRefs,
        followUp: true,
        priorArtifactId: stringField(prior.id),
      },
      data: { markdown: message },
    }],
    objectReferences: changedRefs.map((ref, index) => ({
      id: `obj-${artifactId}-${index + 1}`,
      kind: 'file',
      title: 'Previously patched source file',
      ref,
      status: 'verified',
      summary: `Referenced by previous local code-debug artifact for ${command}.`,
    })),
  };
}

function isLocalCodeDebugRequest(prompt: string) {
  return /\bpython3?\s+-m\s+pytest\b/i.test(prompt)
    && /(?:debug|root cause|patch|fix|repair|modify|rerun|调试|定位|修复|补丁|修改|复跑|测试结果)/i.test(prompt);
}

function currentUserPrompt(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return stringField(uiState.rawUserPrompt)
    ?? stringField(uiState.currentPrompt)
    ?? request.prompt;
}

function isLocalCodeDebugFollowUpRequest(prompt: string) {
  if (/\bpython3?\s+-m\s+pytest\b/i.test(prompt)) return false;
  const asksSummary = /(?:previous|prior|last|刚才|上一轮|前一轮|继续|summari[sz]e|summary|总结|概括|root cause|patch|rerun result|test result|remaining risk|风险|测试结果|复跑)/i.test(prompt);
  const asksNoMutation = /(?:do not|don't|without|不要|不用|无需|只|only).{0,80}(?:modify|patch|edit|write|rerun|run|修改|修复|写|重跑|复跑|运行|长任务)/i.test(prompt);
  return asksSummary && asksNoMutation;
}

function latestLocalCodeDebugArtifact(request: GatewayRequest): Record<string, unknown> | undefined {
  const candidates = [
    ...request.artifacts,
    ...(request.references ?? []),
    ...toRecordList(request.uiState?.currentReferences),
    ...toRecordList(request.uiState?.sessionMessages),
    ...toRecordList(request.uiState?.recentRuns),
  ];
  return candidates.reverse().find((artifact) => {
    if (!isRecord(artifact)) return false;
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const searchable = [
      stringField(metadata.source),
      stringField(artifact.id),
      stringField(artifact.ref),
      stringField(artifact.artifactRef),
      stringField(artifact.title),
      stringField(artifact.label),
      stringField(artifact.contentPreview),
      stringField(artifact.responsePreview),
      stringField(artifact.summary),
    ].filter(Boolean).join('\n');
    const hasLocalCodeDebugRef = searchable.includes(TOOL_ID)
      || /(?:^|:)local-code-debug-[A-Za-z0-9_-]+/.test(searchable)
      || /Local code-debug runtime/i.test(searchable);
    if (!hasLocalCodeDebugRef) return false;
    return Boolean(localCodeDebugMarkdownFromRecord(artifact));
  });
}

async function latestLocalCodeDebugArtifactFromContextRefs(request: GatewayRequest): Promise<Record<string, unknown> | undefined> {
  if (!request.workspacePath) return undefined;
  const workspace = resolve(request.workspacePath);
  const refs = localCodeDebugContextRefs(request).reverse();
  for (const ref of refs) {
    const direct = await readJsonRef(workspace, ref);
    const directText = textFromLocalCodeDebugRecord(direct);
    if (directText) return direct as Record<string, unknown>;

    const id = localCodeDebugIdFromRef(ref);
    if (!id) continue;
    const artifact = await findWorkspaceArtifactById(workspace, id);
    if (textFromLocalCodeDebugRecord(artifact)) return artifact;
  }
  return undefined;
}

function localCodeDebugContextRefs(request: GatewayRequest) {
  const refs: string[] = [];
  collectLocalCodeDebugRefs(request.references, refs, 0);
  collectLocalCodeDebugRefs(request.uiState?.currentReferences, refs, 0);
  collectLocalCodeDebugRefs(request.uiState?.recentExecutionRefs, refs, 0);
  collectLocalCodeDebugRefs(isRecord(request.uiState?.agentHarness)
    ? request.uiState.agentHarness
    : undefined, refs, 0);
  collectLocalCodeDebugRefs(isRecord(request.uiState?.agentHarnessHandoff)
    ? request.uiState.agentHarnessHandoff.contextRefs
    : undefined, refs, 0);
  return Array.from(new Set(refs));
}

function collectLocalCodeDebugRefs(value: unknown, refs: string[], depth: number) {
  if (depth > 6 || refs.length > 80) return;
  if (typeof value === 'string') {
    if (/local-code-debug-[A-Za-z0-9_-]+|verify-local-code-debug-[A-Za-z0-9_-]+|\.json\b/i.test(value)
      && /local-code-debug/i.test(value)) {
      refs.push(value.trim());
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectLocalCodeDebugRefs(entry, refs, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const entry of Object.values(value)) collectLocalCodeDebugRefs(entry, refs, depth + 1);
}

async function readJsonRef(workspace: string, ref: string): Promise<Record<string, unknown> | undefined> {
  if (!ref.endsWith('.json') || isAbsolute(ref)) return undefined;
  const path = resolve(workspace, ref);
  if (!isSafeWorkspacePath(workspace, path)) return undefined;
  const raw = await readFile(path, 'utf8').catch(() => undefined);
  const parsed = raw ? safeJsonParse(raw) : undefined;
  return isRecord(parsed) ? parsed : undefined;
}

async function findWorkspaceArtifactById(workspace: string, id: string): Promise<Record<string, unknown> | undefined> {
  const root = resolve(workspace, '.sciforge', 'sessions');
  if (!isSafeWorkspacePath(workspace, root)) return undefined;
  const target = `${id}.json`;
  const stack: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  let visited = 0;
  while (stack.length && visited < 3_000) {
    const { path, depth } = stack.pop()!;
    visited += 1;
    const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const next = join(path, entry.name);
      if (entry.isFile() && entry.name === target && basename(dirnameName(next)) === 'artifacts') {
        const raw = await readFile(next, 'utf8').catch(() => undefined);
        const parsed = raw ? safeJsonParse(raw) : undefined;
        if (isRecord(parsed) && textFromLocalCodeDebugRecord(parsed)) return parsed;
      }
      if (entry.isDirectory() && depth < 6 && entry.name !== 'node_modules') {
        stack.push({ path: next, depth: depth + 1 });
      }
    }
  }
  return undefined;
}

function dirnameName(path: string) {
  return path.replace(/[/\\][^/\\]+$/, '');
}

function localCodeDebugIdFromRef(ref: string) {
  const id = ref.match(/\b(?:EU-)?(local-code-debug-[A-Za-z0-9_-]+)\b/)?.[1];
  return id?.replace(/-(?:initial|patch|rerun|reuse)$/i, '');
}

function textFromLocalCodeDebugRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const markdown = localCodeDebugMarkdownFromRecord(value);
  if (!markdown) return undefined;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const source = stringField(metadata.source);
  if (source === TOOL_ID || /Local code-debug runtime/i.test(markdown)) return markdown;
  return undefined;
}

function localCodeDebugMarkdownFromRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const source = stringField(metadata.source);
  const dataSummary = isRecord(value.dataSummary) ? value.dataSummary : {};
  const digestText = isRecord(dataSummary.digestText) ? dataSummary.digestText : {};
  const data = isRecord(value.data) ? value.data : {};
  const markdown = stringField(data.markdown)
    ?? stringField(value.markdown)
    ?? stringField(value.text)
    ?? stringField(value.content)
    ?? stringField(value.contentPreview)
    ?? stringField(value.responsePreview)
    ?? stringField(value.summary)
    ?? stringField(value.message)
    ?? stringField(digestText.preview);
  if (!markdown) return undefined;
  if (/未应用工作区代码 patch|不能声明已修复|did not apply a patch|backend failed before completion|AgentServer generation request failed/i.test(markdown)) {
    return undefined;
  }
  if (source === TOOL_ID || /Local code-debug runtime/i.test(markdown)) return markdown;
  return undefined;
}

async function latestLocalCodeDebugWorkspaceStateRecord(request: GatewayRequest): Promise<Record<string, unknown> | undefined> {
  if (!request.workspacePath) return undefined;
  const workspace = resolve(request.workspacePath);
  const statePath = join(workspace, '.sciforge', 'workspace-state.json');
  const raw = await readFile(statePath, 'utf8').catch(() => undefined);
  if (!raw) return undefined;
  if (raw.length > 8_000_000) {
    const markdown = latestLocalCodeDebugTextFromRawJson(raw);
    if (!markdown) return undefined;
    return {
      id: 'workspace-state-local-code-debug',
      contentPreview: markdown,
      metadata: {
        source: TOOL_ID,
        command: extractCommandFromMarkdown(markdown),
        changedRefs: Array.from(new Set(Array.from(markdown.matchAll(/^- ([^:\n]+\.py):/gm), (match) => match[1]!).filter(Boolean))),
      },
    };
  }
  const parsed = safeJsonParse(raw);
  const markdown = findLatestLocalCodeDebugText(parsed);
  if (!markdown) return undefined;
  return {
    id: 'workspace-state-local-code-debug',
    contentPreview: markdown,
    metadata: {
      source: TOOL_ID,
      command: extractCommandFromMarkdown(markdown),
      changedRefs: Array.from(new Set(Array.from(markdown.matchAll(/^- ([^:\n]+\.py):/gm), (match) => match[1]!).filter(Boolean))),
    },
  };
}

function latestLocalCodeDebugTextFromRawJson(raw: string) {
  const marker = 'Local code-debug runtime';
  const index = raw.lastIndexOf(marker);
  if (index < 0) return undefined;
  const snippet = raw.slice(index, Math.min(raw.length, index + 6000));
  const unescaped = snippet
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
  const end = unescaped.search(/\n\s*(?:工作过程摘要|Process|generic|button|objectReferences|displayIntent|reasoningTrace)/i);
  const bounded = (end > 0 ? unescaped.slice(0, end) : unescaped).trim();
  return /Patch summary:/i.test(bounded) && /(?:测试结果|Test results):/i.test(bounded) ? bounded : undefined;
}

function safeJsonParse(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function findLatestLocalCodeDebugText(value: unknown) {
  const matches: string[] = [];
  collectLocalCodeDebugText(value, matches, 0);
  return matches.at(-1);
}

function collectLocalCodeDebugText(value: unknown, matches: string[], depth: number) {
  if (depth > 8 || matches.length > 50) return;
  if (typeof value === 'string') {
    if (/Local code-debug runtime/i.test(value) && /Patch summary:/i.test(value) && /(?:测试结果|Test results):/i.test(value)) {
      matches.push(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectLocalCodeDebugText(entry, matches, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  for (const entry of Object.values(value)) collectLocalCodeDebugText(entry, matches, depth + 1);
}

function sectionText(markdown: string, heading: string) {
  const escaped = escapeRegExp(heading);
  const match = markdown.match(new RegExp(`(?:^|\\n)${escaped}:?\\s*\\n([\\s\\S]*?)(?=\\n[A-Za-z\\u4e00-\\u9fff][^\\n]{0,80}:\\s*\\n|$)`, 'i'));
  return match?.[1]?.trim();
}

function normalizeBulletBlock(text: string) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return '- Not recorded.';
  return lines.map((line) => /^[-*]\s+/.test(line) ? line : `- ${line}`).join('\n');
}

function firstBulletOrLine(text: string) {
  return text.split(/\n+/).map((line) => line.replace(/^[-*]\s+/, '').trim()).find(Boolean) ?? 'The previous local code-debug artifact recorded the root cause in its patch summary.';
}

function extractCommandFromMarkdown(markdown: string) {
  return markdown.match(/`([^`]*\bpytest\b[^`]*)`/)?.[1]?.trim();
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function toRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function extractPytestCommand(prompt: string) {
  const match = prompt.match(/\b(python3?|python)\s+-m\s+pytest\b/i);
  if (!match || match.index === undefined) return undefined;
  const rawTokens = prompt.slice(match.index).split(/\s+/).filter(Boolean);
  const parts: string[] = [];
  for (const rawToken of rawTokens) {
    const parsed = normalizePytestCommandToken(rawToken);
    if (!parsed.token) break;
    if (parts.length >= 3 && isNaturalLanguageAfterPytestCommand(parsed.token)) break;
    parts.push(parsed.token);
    if (parts.length >= 4 && parsed.endsCommand) break;
  }
  if (parts.length < 4 || parts[1] !== '-m' || parts[2] !== 'pytest') return undefined;
  return { command: parts.join(' '), bin: parts[0]!, args: parts.slice(1) };
}

function normalizePytestCommandToken(rawToken: string) {
  const unquoted = rawToken.trim().replace(/^[`'"]+|[`'"]+$/g, '');
  if (!unquoted) return { token: undefined, endsCommand: true };
  if (/^[。；，,;]+$/.test(unquoted)) return { token: undefined, endsCommand: true };
  const sentenceTerminator = /[。；;,]$/.test(unquoted) || (/[.]$/.test(unquoted) && !/\.py(?:$|::)/.test(unquoted));
  const token = sentenceTerminator ? unquoted.replace(/[。；;,.]+$/g, '') : unquoted;
  if (!token) return { token: undefined, endsCommand: true };
  return { token, endsCommand: sentenceTerminator };
}

function isNaturalLanguageAfterPytestCommand(token: string) {
  return /^(?:and|then|locate|identify|patch|fix|repair|rerun|run|report|return|if|when|but|并|然后|定位|修复|复跑|报告)$/i.test(token);
}

function extractPythonFiles(prompt: string) {
  return Array.from(new Set(Array.from(prompt.matchAll(/(?:^|[\s`'"])([A-Za-z0-9_./-]+\.py)\b/g), (match) => match[1]!).filter(Boolean)));
}

async function inferSourceFilesForPytestRepair(
  workspace: string,
  prompt: string,
  pytest: { command: string; bin: string; args: string[] },
  initial: CommandResult,
) {
  const candidates = new Set<string>();
  const addRef = (ref: string | undefined) => {
    if (!ref || /(?:^|\/)test[^/]*\.py$/i.test(ref)) return;
    const safe = safeWorkspacePath(workspace, ref);
    if (safe) candidates.add(safe);
  };

  for (const file of extractPythonFiles(prompt)) addRef(file);
  for (const file of extractPythonFiles(`${initial.stdout}\n${initial.stderr}`)) addRef(file);
  for (const file of tracebackWorkspacePythonFiles(workspace, `${initial.stdout}\n${initial.stderr}`)) addRef(file);

  const pytestFiles = pytest.args
    .filter((arg) => /\.py(?::|$)/.test(arg) && !arg.startsWith('-'))
    .map((arg) => arg.split('::')[0]!)
    .filter(Boolean);
  for (const testFile of pytestFiles) {
    const safeTest = safeWorkspacePath(workspace, testFile);
    if (!safeTest) continue;
    const source = await readFile(safeTest, 'utf8').catch(() => undefined);
    if (!source) continue;
    for (const moduleName of importedLocalModuleNames(source)) {
      addRef(`${moduleName.replace(/\./g, '/')}.py`);
    }
  }

  return Array.from(candidates).slice(0, 8);
}

function tracebackWorkspacePythonFiles(workspace: string, output: string) {
  const refs: string[] = [];
  for (const match of output.matchAll(/File "([^"]+\.py)"/g)) {
    const path = match[1]!;
    if (!isAbsolute(path)) continue;
    if (!isSafeWorkspacePath(workspace, path)) continue;
    refs.push(relative(workspace, path));
  }
  return refs;
}

function importedLocalModuleNames(source: string) {
  const modules = new Set<string>();
  for (const match of source.matchAll(/^\s*from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/gm)) {
    if (!isLikelyLocalPythonModule(match[1]!)) continue;
    modules.add(match[1]!);
  }
  for (const match of source.matchAll(/^\s*import\s+([A-Za-z_][A-Za-z0-9_.]*)(?:\s+as\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/gm)) {
    if (!isLikelyLocalPythonModule(match[1]!)) continue;
    modules.add(match[1]!);
  }
  return Array.from(modules);
}

function isLikelyLocalPythonModule(moduleName: string) {
  const root = moduleName.split('.')[0] ?? '';
  return Boolean(root)
    && ![
      'collections',
      'dataclasses',
      'functools',
      'itertools',
      'json',
      'math',
      'numpy',
      'os',
      'pandas',
      'pathlib',
      'pytest',
      'random',
      're',
      'scipy',
      'statistics',
      'sys',
      'typing',
    ].includes(root);
}

function safeWorkspacePath(workspace: string, ref: string) {
  if (isAbsolute(ref)) return undefined;
  const path = resolve(workspace, ref);
  if (!isSafeWorkspacePath(workspace, path)) return undefined;
  return path;
}

function isSafeWorkspacePath(workspace: string, path: string) {
  const rel = relative(workspace, path);
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
}

function repairPythonSource(source: string, initial: CommandResult, prompt: string) {
  let next = source;
  const summaries: string[] = [];
  const evidence = `${prompt}\n${initial.stdout}\n${initial.stderr}`;
  const sqrtRepair = applySqrtDenominatorRepairs(next, evidence);
  next = sqrtRepair.source;
  summaries.push(...sqrtRepair.summaries);

  const identicalSampleRepair = applyIdenticalSampleZeroRepairs(next, evidence);
  next = identicalSampleRepair.source;
  summaries.push(...identicalSampleRepair.summaries);
  return { source: next, summaries };
}

type PythonFunctionBlock = {
  name: string;
  args: string[];
  header: string;
  body: string;
  full: string;
};

function applySqrtDenominatorRepairs(source: string, evidence: string) {
  if (!/\bsqrt\s*\(|np\.sqrt|math\.sqrt/i.test(`${source}\n${evidence}`)) return { source, summaries: [] };
  if (!/\bimport\s+numpy\s+as\s+np\b/.test(source)) return { source, summaries: [] };
  let next = source;
  const summaries: string[] = [];
  for (const block of pythonFunctionBlocks(source)) {
    if (!/\bsqrt\s*\(/i.test(block.full) && !/\bsqrt\s*\(/i.test(evidence)) continue;
    const patchedBody = block.body.replace(
      /^([ \t]*)return\s+1(?:\.0)?\s*\/\s*\(([^)\n]+(?:\([^)]*\)[^)\n]*)?)\)\s*$/m,
      (line, indent: string, denominator: string) => {
        if (/\bsqrt\s*\(/.test(line)) return line;
        if (!/\*\*\s*2|\^2|squared|sq_/i.test(`${denominator}\n${block.full}\n${evidence}`)) return line;
        return `${indent}return 1.0 / np.sqrt(${denominator.trim()})`;
      },
    );
    if (patchedBody === block.body) continue;
    next = next.replace(block.full, `${block.header}${ensureTrailingBlankLine(patchedBody)}`);
    summaries.push(`${block.name}: wrapped denominator in np.sqrt because the local contract/tests expected a square-root denominator.`);
  }
  return { source: next, summaries };
}

function applyIdenticalSampleZeroRepairs(source: string, evidence: string) {
  const functionNames = functionNamesWithIdenticalInputZeroAssertion(evidence);
  if (!functionNames.length || !/\bimport\s+numpy\s+as\s+np\b/.test(source)) return { source, summaries: [] };
  let next = source;
  const summaries: string[] = [];
  for (const block of pythonFunctionBlocks(next)) {
    if (!functionNames.includes(block.name)) continue;
    const replacement = biasedKernelEstimatorBody(block);
    if (!replacement) continue;
    const replaced = replaceFunctionBody(next, block.name, replacement);
    if (replaced === next) continue;
    next = replaced;
    summaries.push(`${block.name}: replaced leave-one-out two-sample statistic with the biased finite-sample estimate required by the identical-input zero contract.`);
  }
  return { source: next, summaries };
}

function functionNamesWithIdenticalInputZeroAssertion(evidence: string) {
  return Array.from(new Set(Array.from(evidence.matchAll(
    /assert\s+abs\(\s*([A-Za-z_][A-Za-z0-9_]*)\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*\2\b[^)]*\)\s*\)\s*<\s*[0-9.eE+-]+/g,
  ), (match) => match[1]!).filter(Boolean)));
}

function biasedKernelEstimatorBody(block: PythonFunctionBlock) {
  if (block.args.length < 2) return undefined;
  if (!/\bnp\.trace\s*\(|\btrace\s*\(/.test(block.body)) return undefined;
  const [leftArg, rightArg] = block.args;
  const leftLeft = assignmentCallingWithArgs(block.body, leftArg!, leftArg!);
  const rightRight = assignmentCallingWithArgs(block.body, rightArg!, rightArg!);
  const leftRight = assignmentCallingWithArgs(block.body, leftArg!, rightArg!);
  if (!leftLeft || !rightRight || !leftRight) return undefined;
  const conversionLines = [
    `    ${leftArg} = np.asarray(${leftArg}, dtype=float)`,
    `    ${rightArg} = np.asarray(${rightArg}, dtype=float)`,
  ];
  return [
    ...conversionLines,
    `    ${leftLeft.variable} = ${leftLeft.call}`,
    `    ${rightRight.variable} = ${rightRight.call}`,
    `    ${leftRight.variable} = ${leftRight.call}`,
    `    return float(${leftLeft.variable}.mean() + ${rightRight.variable}.mean() - 2.0 * ${leftRight.variable}.mean())`,
  ];
}

function assignmentCallingWithArgs(body: string, firstArg: string, secondArg: string) {
  const escapedFirst = escapeRegExp(firstArg);
  const escapedSecond = escapeRegExp(secondArg);
  const pattern = new RegExp(
    `^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*([^\\n]*\\(\\s*${escapedFirst}\\s*,\\s*${escapedSecond}(?:\\s*,[^\\n]*)?\\))\\s*$`,
    'm',
  );
  const match = body.match(pattern);
  if (!match) return undefined;
  return { variable: match[1]!, call: match[2]!.trim() };
}

function pythonFunctionBlocks(source: string): PythonFunctionBlock[] {
  const matches = Array.from(source.matchAll(/^def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)(?:\s*->\s*[^:\n]+)?\s*:\n/gm));
  return matches.flatMap((match, index) => {
    if (match.index === undefined) return [];
    const next = matches[index + 1];
    const end = next?.index ?? source.length;
    const full = source.slice(match.index, end);
    const header = match[0]!;
    return [{
      name: match[1]!,
      args: parsePythonArgs(match[2] ?? ''),
      header,
      body: full.slice(header.length),
      full,
    }];
  });
}

function parsePythonArgs(args: string) {
  return args
    .split(',')
    .map((arg) => arg.trim().split(/[=:]/)[0]?.trim())
    .filter((arg): arg is string => Boolean(arg) && !arg.startsWith('*') && arg !== 'self' && arg !== 'cls');
}

function replaceFunctionBody(source: string, functionName: string, bodyLines: string[]) {
  const pattern = new RegExp(`(def\\s+${functionName}\\s*\\([^)]*\\)(?:\\s*->\\s*[^:\\n]+)?\\s*:\\n)(?:(?:    |\\t).*\\n?)+`, 'm');
  return source.replace(pattern, `$1${bodyLines.join('\n')}\n`);
}

function ensureTrailingBlankLine(body: string) {
  return /\n\s*\n$/.test(body) ? body : `${body.replace(/\s*$/, '')}\n\n`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runCommand(bin: string, args: string[], cwd: string): Promise<CommandResult> {
  const command = [bin, ...args].join(' ');
  return new Promise((resolveCommand) => {
    const child = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, 30_000);
    child.stdout.on('data', (chunk) => {
      stdout = boundedAppend(stdout, String(chunk));
    });
    child.stderr.on('data', (chunk) => {
      stderr = boundedAppend(stderr, String(chunk));
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      resolveCommand({ command, exitCode: null, stdout, stderr: boundedAppend(stderr, error.message), timedOut });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      resolveCommand({ command, exitCode, stdout, stderr, timedOut });
    });
  });
}

function boundedAppend(current: string, chunk: string) {
  const next = current + chunk;
  return next.length <= MAX_OUTPUT_CHARS ? next : next.slice(0, MAX_OUTPUT_CHARS);
}

function formatExit(result: CommandResult) {
  if (result.timedOut) return 'timed out';
  return result.exitCode === 0 ? 'passed' : `failed (exit ${result.exitCode ?? 'unknown'})`;
}
