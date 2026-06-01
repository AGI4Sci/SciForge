import type { SciForgeConfig } from '../../domain';
import {
  invokeAgentHostModule,
  queryAgentHostModule,
  readAgentHostModule,
} from '../../api/agentHostModuleClient';
import {
  type WorkspaceEntry,
  type WorkspaceFileContent,
} from '../../api/workspaceClient';
import { SciForgeClientError } from '../../api/clientError';
import { normalizeWorkspaceRootPath } from '../../config';
import { toWorkspaceRelativePath } from '../../../../../packages/support/object-references';
import { boundedRightPaneText } from './previewSafety';

export type WorkspaceFilesModuleFunction = 'query' | 'read' | 'invoke';
export type WorkspaceFilesModuleStatus = 'completed' | 'failed';

export interface WorkspaceFilesModuleTraceStep {
  moduleId: 'files';
  functionName: WorkspaceFilesModuleFunction;
  intent?: 'write';
  query?: string;
  ref?: string;
  status: WorkspaceFilesModuleStatus;
  inputSummary: string;
  resultSummary: string;
  refs: string[];
  operationRef?: string;
}

export interface WorkspaceFilesModuleResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  trace: WorkspaceFilesModuleTraceStep;
}

export interface WorkspaceFilesPort {
  queryTree(path: string, config: SciForgeConfig): Promise<WorkspaceFilesModuleResult<WorkspaceEntry[]>>;
  readFile(path: string, config: SciForgeConfig): Promise<WorkspaceFilesModuleResult<WorkspaceFileContent>>;
  invokeSave(path: string, content: string, config: SciForgeConfig): Promise<WorkspaceFilesModuleResult<WorkspaceFileContent>>;
}

export interface AgentHostFilesModuleClient {
  listWorkspace(path: string, config: SciForgeConfig): Promise<WorkspaceEntry[]>;
  readWorkspaceFile(path: string, config: SciForgeConfig): Promise<WorkspaceFileContent>;
  writeWorkspaceFile(path: string, content: string, config: SciForgeConfig): Promise<WorkspaceFileContent>;
}

export type WorkspaceFilesClient = AgentHostFilesModuleClient;

const defaultAgentHostFilesModuleClient: AgentHostFilesModuleClient = {
  async listWorkspace(path, config) {
    const response = await queryAgentHostModule<FilesModuleTreeValue>({
      moduleId: 'files',
      query: 'tree',
      filters: { path },
      limit: 200,
    }, config);
    if (!response.result.ok) throw new Error(response.result.error ?? 'files.query failed');
    return Array.isArray(response.result.value?.items) ? response.result.value.items.map(workspaceEntryFromModuleEntry) : [];
  },
  async readWorkspaceFile(path, config) {
    const ref = workspaceFilesModuleRefForPath(path, config, 'file');
    const response = await readAgentHostModule<FilesModuleFileValue>({ moduleId: 'files', ref }, config);
    if (!response.result.ok || !response.result.value) throw new Error(response.result.error ?? 'files.read failed');
    return workspaceFileContentFromModuleFile(response.result.value);
  },
  async writeWorkspaceFile(path, content, config) {
    const ref = workspaceFilesModuleRefForPath(path, config, 'file');
    const response = await invokeAgentHostModule<FilesModuleFileValue>({
      moduleId: 'files',
      intent: 'write',
      approvalToken: 'right-pane-files-explicit-save',
      idempotencyKey: `right-pane-files-save:${ref}:${content.length}`,
      input: { ref, content, encoding: 'utf8' },
    }, config);
    if (!response.result.ok || !response.result.value) throw new Error(response.result.error ?? 'files.write failed');
    return workspaceFileContentFromModuleFile(response.result.value);
  },
};

export function createAgentHostFilesModulePort(client: AgentHostFilesModuleClient = defaultAgentHostFilesModuleClient): WorkspaceFilesPort {
  return {
    async queryTree(path, config) {
      const ref = workspaceFilesModuleRefForPath(path, config, 'folder');
      try {
        const entries = await client.listWorkspace(path, config);
        return moduleResult({
          functionName: 'query',
          query: 'tree',
          ref,
          refs: [ref],
          inputSummary: `query tree ${ref}`,
          resultSummary: `${entries.length} entries`,
          value: entries,
        });
      } catch (error) {
        return moduleError({
          functionName: 'query',
          query: 'tree',
          ref,
          refs: [ref],
          inputSummary: `query tree ${ref}`,
          error,
        });
      }
    },
    async readFile(path, config) {
      const ref = workspaceFilesModuleRefForPath(path, config, 'file');
      try {
        const file = await client.readWorkspaceFile(path, config);
        return moduleResult({
          functionName: 'read',
          ref,
          refs: [ref],
          inputSummary: `read ${ref}`,
          resultSummary: `${file.encoding ?? 'utf8'} ${file.size} bytes`,
          value: file,
        });
      } catch (error) {
        return moduleError({
          functionName: 'read',
          ref,
          refs: [ref],
          inputSummary: `read ${ref}`,
          error,
        });
      }
    },
    async invokeSave(path, content, config) {
      const ref = workspaceFilesModuleRefForPath(path, config, 'file');
      const operationRef = `files:operation:write:${encodeURIComponent(ref.replace(/^file:/, ''))}`;
      try {
        const file = await client.writeWorkspaceFile(path, content, config);
        return moduleResult({
          functionName: 'invoke',
          intent: 'write',
          ref,
          refs: [ref],
          operationRef,
          inputSummary: `write ${ref}`,
          resultSummary: `${file.encoding ?? 'utf8'} ${file.size} bytes`,
          value: file,
        });
      } catch (error) {
        return moduleError({
          functionName: 'invoke',
          intent: 'write',
          ref,
          refs: [ref],
          operationRef,
          inputSummary: `write ${ref}`,
          error,
        });
      }
    },
  };
}

export const createWorkspaceFilesModulePort = createAgentHostFilesModulePort;

export function workspaceFilesModuleRefForPath(path: string, config: SciForgeConfig, kind: 'file' | 'folder') {
  const workspaceRoot = normalizeWorkspaceRootPath(config.workspacePath);
  const normalizedPath = normalizeWorkspaceFileModulePath(path);
  if (workspaceRoot && pathLooksAbsolute(normalizedPath)) {
    const normalizedRoot = normalizeWorkspaceFileModulePath(workspaceRoot);
    if (normalizedPath !== normalizedRoot && !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      return kind === 'folder' ? 'folder:workspace' : 'file:workspace-object';
    }
  }
  const relative = toWorkspaceRelativePath(workspaceRoot, path);
  if (relative === '.') return 'workspace:.';
  const clean = (relative || path).replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!clean || /^(?:[A-Za-z][A-Za-z0-9+.-]*:|~|\.\.)/.test(clean)) {
    return kind === 'folder' ? 'folder:workspace' : 'file:workspace-object';
  }
  return `${kind}:${clean}`;
}

interface FilesModuleEntryValue extends WorkspaceEntry {
  ref?: string;
}

interface FilesModuleTreeValue {
  items?: FilesModuleEntryValue[];
  total?: number;
  ref?: string;
}

interface FilesModuleFileValue extends WorkspaceFileContent {
  ref?: string;
}

function workspaceEntryFromModuleEntry(entry: FilesModuleEntryValue): WorkspaceEntry {
  return {
    name: entry.name,
    path: entry.path,
    kind: entry.kind,
    size: entry.size,
    modifiedAt: entry.modifiedAt,
  };
}

function workspaceFileContentFromModuleFile(file: FilesModuleFileValue): WorkspaceFileContent {
  return {
    path: file.path,
    name: file.name,
    content: file.content,
    size: file.size,
    modifiedAt: file.modifiedAt,
    language: file.language,
    encoding: file.encoding,
    mimeType: file.mimeType,
  };
}

function normalizeWorkspaceFileModulePath(path: string) {
  return path.trim().replace(/\\/g, '/').replace(/\/+$/, '');
}

function pathLooksAbsolute(path: string) {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

function moduleResult<T>(input: {
  functionName: WorkspaceFilesModuleFunction;
  intent?: 'write';
  query?: string;
  ref?: string;
  refs?: string[];
  operationRef?: string;
  inputSummary: string;
  resultSummary: string;
  value: T;
}): WorkspaceFilesModuleResult<T> {
  return {
    ok: true,
    value: input.value,
    trace: {
      moduleId: 'files',
      functionName: input.functionName,
      intent: input.intent,
      query: input.query,
      ref: input.ref,
      status: 'completed',
      inputSummary: scrubFilesModuleTraceText(input.inputSummary),
      resultSummary: scrubFilesModuleTraceText(input.resultSummary),
      refs: input.refs ?? [],
      operationRef: input.operationRef,
    },
  };
}

function moduleError(input: {
  functionName: WorkspaceFilesModuleFunction;
  intent?: 'write';
  query?: string;
  ref?: string;
  refs?: string[];
  operationRef?: string;
  inputSummary: string;
  error: unknown;
}): WorkspaceFilesModuleResult<never> {
  const error = filesModuleErrorMessage(input.error);
  return {
    ok: false,
    error: scrubFilesModuleTraceText(error),
    trace: {
      moduleId: 'files',
      functionName: input.functionName,
      intent: input.intent,
      query: input.query,
      ref: input.ref,
      status: 'failed',
      inputSummary: scrubFilesModuleTraceText(input.inputSummary),
      resultSummary: scrubFilesModuleTraceText(error),
      refs: input.refs ?? [],
      operationRef: input.operationRef,
    },
  };
}

function filesModuleErrorMessage(error: unknown) {
  if (error instanceof SciForgeClientError) {
    const actions = error.recoverActions.length ? ` 下一步：${error.recoverActions.join('；')}` : '';
    return `${error.title}：${error.reason}${actions}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function scrubFilesModuleTraceText(value: string) {
  return boundedRightPaneText(value, 360);
}

export function unwrapWorkspaceFilesModuleResult<T>(result: WorkspaceFilesModuleResult<T>): T {
  if (result.ok && result.value !== undefined) return result.value;
  throw new Error(result.error ?? result.trace.resultSummary);
}
