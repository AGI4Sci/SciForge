import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

export type StoredSubagentStatus = 'running' | 'completed' | 'failed' | 'blocked' | 'cancelled';

export interface StoredSubagentBackgroundMetadata {
  runInBackground: boolean;
  stateRef?: string;
}

export interface StoredSubagentResumeMetadata {
  resumeRequested: boolean;
  resumeAgentId?: string;
  resumeRef?: string;
  resumeBoundary: 'explicit' | 'none';
}

export interface StoredSubagentRun extends Record<string, unknown> {
  schemaVersion: 'sciforge.runtime-codex.subagent-run.v1';
  agentId: string;
  parentAgentId: string;
  workspaceScope: string;
  agentType: string;
  status: StoredSubagentStatus;
  resultSummary: string;
  resultRef?: string;
  transcriptRef?: string;
  refs: string[];
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  background: StoredSubagentBackgroundMetadata;
  resume: StoredSubagentResumeMetadata;
  inspectedRefs: string[];
  promptDigest: string;
}

export interface SubagentRuntimeStore {
  writeRun(run: StoredSubagentRun): Promise<void>;
  readRunByAgentId(agentId: string): Promise<StoredSubagentRun | undefined>;
  findRunByRef(ref: string): Promise<StoredSubagentRun | undefined>;
}

export function createSubagentRuntimeStore(input: { transcriptRoot: string }): SubagentRuntimeStore {
  const transcriptRoot = resolve(input.transcriptRoot);
  const readRunByAgentId = async (agentId: string): Promise<StoredSubagentRun | undefined> => {
    const safeAgentId = safeSubagentRuntimeIdentifier(agentId);
    if (!safeAgentId) return undefined;
    const path = resolve(transcriptRoot, `${safeAgentId}.json`);
    if (!isPathInside(transcriptRoot, path)) {
      throw new Error('unsafe sub-agent store lookup: invalid agent id path');
    }
    return readStoredSubagentRun(path, { missingOk: true });
  };
  return {
    async writeRun(run) {
      assertSafeStoredSubagentRun(run);
      const path = resolve(transcriptRoot, `${run.agentId}.json`);
      if (!isPathInside(transcriptRoot, path)) {
        throw new Error('unsafe sub-agent store record: invalid agent id path');
      }
      try {
        await mkdir(transcriptRoot, { recursive: true });
        await writeFile(path, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
      } catch {
        throw new Error('transcript store unavailable');
      }
    },
    readRunByAgentId,
    async findRunByRef(ref) {
      const safeRef = safeSubagentRuntimeRef(ref);
      if (!safeRef) return undefined;
      if (safeRef.startsWith('subagent:')) {
        return readRunByAgentId(safeRef.slice('subagent:'.length));
      }
      let names: string[];
      try {
        names = await readdir(transcriptRoot);
      } catch (error) {
        if (isMissingPathError(error)) return undefined;
        throw new Error('transcript store unavailable');
      }
      for (const name of names.filter((entry) => entry.endsWith('.json')).slice(0, 1000)) {
        const agentId = safeSubagentRuntimeIdentifier(name.slice(0, -'.json'.length));
        if (!agentId) continue;
        const run = await readRunByAgentId(agentId);
        if (!run) continue;
        if (run.resultRef === safeRef || run.transcriptRef === safeRef || run.refs.includes(safeRef)) return run;
      }
      return undefined;
    },
  };
}

export function safeSubagentRuntimeIdentifier(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(text)) return undefined;
  if (text.startsWith('/') || text.startsWith('~') || text.includes('://')) return undefined;
  if (text.includes('..')) return undefined;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return undefined;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs|Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return undefined;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

export function safeSubagentRuntimeRef(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/');
  if (!text) return undefined;
  if (text.startsWith('artifact:')) {
    const opaque = text.slice('artifact:'.length);
    return safeOpaqueRefPart(opaque) ? `artifact:${opaque}` : undefined;
  }
  if (text.startsWith('subagent:')) {
    const opaque = text.slice('subagent:'.length);
    return safeOpaqueRefPart(opaque) ? `subagent:${opaque}` : undefined;
  }
  if (text.startsWith('transcript:')) {
    const opaque = text.slice('transcript:'.length);
    return safeOpaqueRefPart(opaque) ? `transcript:${opaque}` : undefined;
  }
  if (text.startsWith('file:')) {
    const path = safeSubagentRelativePath(text.slice('file:'.length));
    return path ? `file:${path}` : undefined;
  }
  if (/\.[A-Za-z0-9][\w.-]*$/.test(text)) {
    const path = safeSubagentRelativePath(text);
    return path ? `file:${path}` : undefined;
  }
  return safeOpaqueRefPart(text) ? text : undefined;
}

export function safeSubagentRelativePath(value: string | undefined): string | undefined {
  const text = value?.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!text) return undefined;
  if (/^(?:\/|[A-Za-z]:\/)/.test(text) || text.includes('://') || text.startsWith('~')) return undefined;
  if (/[\r\n\t<>|?*:]/.test(text)) return undefined;
  if (text.split('/').some((part) => part === '..' || part === '' || part === '.')) return undefined;
  if (/(?:^|\/)(?:node_modules|dist|build|coverage|\.git|\.sciforge|reports)(?:\/|$)/i.test(text)) return undefined;
  if (/(?:^|[\/_.:-])(?:stdout|stderr|raw|logs?)(?:$|[\/_.:-])/i.test(text)) return undefined;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return undefined;
  return text;
}

export function assertSafeStoredSubagentRun(run: StoredSubagentRun): void {
  const invalid = [
    safeSubagentRuntimeIdentifier(run.agentId),
    safeSubagentRuntimeIdentifier(run.parentAgentId),
    safeSubagentRuntimeIdentifier(run.workspaceScope),
    safeSubagentRuntimeIdentifier(run.agentType),
  ].some((value) => !value);
  if (invalid) throw new Error('unsafe sub-agent store record: unsafe identifier');
  if (run.resultRef && safeSubagentRuntimeRef(run.resultRef) !== run.resultRef) throw new Error('unsafe sub-agent store record: unsafe result ref');
  if (run.transcriptRef && safeSubagentRuntimeRef(run.transcriptRef) !== run.transcriptRef) throw new Error('unsafe sub-agent store record: unsafe transcript ref');
  for (const ref of [
    ...run.refs,
    ...run.inspectedRefs,
    run.background.stateRef,
    run.resume.resumeRef,
  ]) {
    if (ref && safeSubagentRuntimeRef(ref) !== ref) throw new Error('unsafe sub-agent store record: unsafe ref');
  }
  if (run.resume.resumeAgentId && safeSubagentRuntimeIdentifier(run.resume.resumeAgentId) !== run.resume.resumeAgentId) {
    throw new Error('unsafe sub-agent store record: unsafe resume agent id');
  }
  if (containsPrivateRuntimeText(JSON.stringify(run))) throw new Error('unsafe sub-agent store record: private runtime text');
}

function safeOpaqueRefPart(value: string): boolean {
  const text = value.trim();
  if (!text || text.startsWith('/') || text.startsWith('~') || text.includes('://')) return false;
  if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(text)) return false;
  if (/[\r\n\t<>|?*]/.test(text)) return false;
  if (text.includes('..')) return false;
  if (/^(?:audit|trace|raw|stdout|stderr|provider):/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:stdout|stderr|raw|log|logs)(?:$|[_.:-])/i.test(text)) return false;
  if (/(?:^|[_.:-])(?:Users|Applications|Volumes|private|var|tmp|\.sciforge)(?:$|[_.:-])/i.test(text)) return false;
  if (/\[local-path\]|\[redacted\]|\[url\]/i.test(text)) return false;
  if (/\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b|sk-[A-Za-z0-9._-]+/i.test(text)) return false;
  return true;
}

function containsPrivateRuntimeText(value: string): boolean {
  return /(?:^|[\s("'`])(?:\/(?:Users|Applications|Volumes|private|var|tmp)\/[^\s"'`),;]*)/i.test(value)
    || /(?:^|[\s("'`])~\/[^\s"'`),;]*/.test(value)
    || /(?:^|[\s("'`])[A-Za-z]:[\\/][^\s"'`),;]*/.test(value)
    || /\.sciforge/i.test(value)
    || /\b(?:Authorization|api[-_ ]?key|token|secret|password|credential)\b\s*[:=]/i.test(value)
    || /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/.test(value)
    || /https?:\/\/[^\s"'<>\\)]+/i.test(value);
}

async function readStoredSubagentRun(path: string, options: { missingOk: boolean }): Promise<StoredSubagentRun | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if (options.missingOk && isMissingPathError(error)) return undefined;
    throw new Error('transcript store unavailable');
  }
  try {
    const run = JSON.parse(text) as StoredSubagentRun;
    assertSafeStoredSubagentRun(run);
    return run;
  } catch {
    throw new Error('unsafe sub-agent store record');
  }
}

function isMissingPathError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isPathInside(root: string, candidate: string) {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
