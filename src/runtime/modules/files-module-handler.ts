import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';
import {
  createModuleDescription,
  moduleResult,
  type ModuleDescription,
  type ModuleInvokeRequest,
  type ModuleQueryRequest,
  type ModuleReadRequest,
  type ModuleResultEnvelope,
} from '../../../packages/contracts/runtime/modules.js';
import { normalizeWorkspaceRootPath, resolveWorkspaceFileRefPath } from '../workspace-paths.js';
import { isBinaryPreviewFile, languageForPath, mimeTypeForPath } from '../server/file-preview.js';

export interface FilesModuleHandlerOptions {
  workspacePath?: string;
  maxTextBytes?: number;
  maxBinaryBytes?: number;
}

export interface FilesModuleEntry {
  name: string;
  path: string;
  kind: 'file' | 'folder';
  size?: number;
  modifiedAt?: string;
  ref: string;
}

export interface FilesModuleFile {
  path: string;
  name: string;
  content: string;
  size: number;
  modifiedAt?: string;
  language: string;
  encoding: 'utf8' | 'base64';
  mimeType?: string;
  ref: string;
}

const FILES_MODULE_ID = 'files';
const DEFAULT_TEXT_LIMIT_BYTES = 1024 * 1024;
const DEFAULT_BINARY_LIMIT_BYTES = 25 * 1024 * 1024;

export function createFilesModuleHandler(options: FilesModuleHandlerOptions = {}) {
  const workspaceRoot = normalizeWorkspaceRootPath(resolve(options.workspacePath || process.cwd()));
  const maxTextBytes = options.maxTextBytes ?? DEFAULT_TEXT_LIMIT_BYTES;
  const maxBinaryBytes = options.maxBinaryBytes ?? DEFAULT_BINARY_LIMIT_BYTES;

  return {
    describe: filesDescription,
    async query(request: ModuleQueryRequest) {
      const requested = stringField(request.filters?.path) ?? stringField(request.filters?.ref) ?? stringField(request.scope) ?? 'workspace:.';
      try {
        const folderPath = resolveWorkspaceFileRefPath(refForResolver(requested), workspaceRoot);
        const entries = await readdir(folderPath, { withFileTypes: true });
        const mapped = await Promise.all(entries.map(async (entry) => {
          const entryPath = resolve(folderPath, entry.name);
          const info = await stat(entryPath).catch(() => undefined);
          const kind = entry.isDirectory() ? 'folder' : 'file';
          return {
            name: entry.name,
            path: entryPath,
            kind,
            size: info?.size,
            modifiedAt: info?.mtime?.toISOString(),
            ref: refForWorkspacePath(entryPath, workspaceRoot, kind),
          } satisfies FilesModuleEntry;
        }));
        const sorted = mapped.sort((left, right) =>
          Number(right.kind === 'folder') - Number(left.kind === 'folder') || left.name.localeCompare(right.name));
        return ok({
          items: sorted.slice(0, clampLimit(request.limit)),
          total: sorted.length,
          ref: refForWorkspacePath(folderPath, workspaceRoot, 'folder'),
        }, [refForWorkspacePath(folderPath, workspaceRoot, 'folder'), ...sorted.map((entry) => entry.ref)]);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
    async read(request: ModuleReadRequest) {
      try {
        const filePath = resolveWorkspaceFileRefPath(refForResolver(request.ref), workspaceRoot);
        const info = await stat(filePath);
        if (!info.isFile()) return fail('ref_is_not_file');
        const binary = isBinaryPreviewFile(filePath);
        const limit = binary ? maxBinaryBytes : Math.min(request.maxBytes ?? maxTextBytes, maxTextBytes);
        if (info.size > limit) return fail(`file_too_large:${binary ? 'binary' : 'text'}`);
        const content = binary ? (await readFile(filePath)).toString('base64') : await readFile(filePath, 'utf8');
        const ref = refForWorkspacePath(filePath, workspaceRoot, 'file');
        return ok(fileRecord(filePath, info.size, info.mtime.toISOString(), binary ? 'base64' : 'utf8', content, ref), [ref]);
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
    async invoke(request: ModuleInvokeRequest) {
      if (request.intent !== 'write') return fail(`unsupported_intent:${request.intent}`);
      if (!request.approvalToken) return fail('approval_required:write');
      const input = request.input ?? {};
      const ref = stringField(input.ref) ?? stringField(input.path);
      if (!ref) return fail('missing_ref');
      const content = typeof input.content === 'string' ? input.content : undefined;
      if (content === undefined) return fail('missing_content');
      const encoding = input.encoding === 'base64' ? 'base64' : 'utf8';
      try {
        const filePath = resolveWorkspaceFileRefPath(refForResolver(ref), workspaceRoot);
        await mkdir(dirname(filePath), { recursive: true });
        if (encoding === 'base64') await writeFile(filePath, Buffer.from(content, 'base64'));
        else await writeFile(filePath, content, 'utf8');
        const info = await stat(filePath);
        const fileRef = refForWorkspacePath(filePath, workspaceRoot, 'file');
        return ok(
          fileRecord(filePath, info.size, info.mtime.toISOString(), encoding, content, fileRef),
          [fileRef],
          `files:operation:write:${encodeURIComponent(fileRef.replace(/^file:/, ''))}`,
        );
      } catch (error) {
        return fail(errorMessage(error));
      }
    },
  };
}

function filesDescription(): ModuleDescription {
  return createModuleDescription({
    moduleId: FILES_MODULE_ID,
    title: 'Files',
    summary: 'Workspace Files module for query/read/invoke access to workspace-contained files and folders.',
    resources: [
      { kind: 'workspace-root', refPrefix: 'workspace:', queryable: true, readable: false, summary: 'Workspace root and tree entry refs.' },
      { kind: 'folder', refPrefix: 'folder:', queryable: true, readable: false, summary: 'Workspace-contained folder refs.' },
      { kind: 'file', refPrefix: 'file:', queryable: false, readable: true, summary: 'Workspace-contained file refs.' },
    ],
    intents: [{
      name: 'write',
      sideEffect: 'workspace',
      requiresApproval: true,
      returnsOperation: true,
      summary: 'Explicit Save/write intent for workspace-contained files.',
    }],
    facets: { refs: true, approval: true },
    limits: { maxInlineBytes: DEFAULT_TEXT_LIMIT_BYTES, expectedLatencyMs: 100 },
  });
}

function fileRecord(filePath: string, size: number, modifiedAt: string, encoding: 'utf8' | 'base64', content: string, ref: string): FilesModuleFile {
  return {
    path: filePath,
    name: basename(filePath),
    content,
    size,
    modifiedAt,
    language: languageForPath(filePath),
    encoding,
    mimeType: mimeTypeForPath(filePath),
    ref,
  };
}

function refForWorkspacePath(path: string, workspaceRoot: string, kind: 'file' | 'folder') {
  const rel = relative(workspaceRoot, path).replace(/\\/g, '/');
  if (!rel || rel === '.') return 'workspace:.';
  if (rel.startsWith('../') || rel === '..' || /^[A-Za-z]:/.test(rel)) {
    return kind === 'folder' ? 'folder:workspace' : 'file:workspace-object';
  }
  return `${kind}:${rel}`;
}

function refForResolver(ref: string) {
  const trimmed = ref.trim();
  if (trimmed === 'workspace:' || trimmed === 'workspace:.') return '.';
  return trimmed.replace(/^workspace:/i, '');
}

function ok<T>(value: T, refs: string[] = [], operationRef?: string): ModuleResultEnvelope<T> {
  return moduleResult({
    moduleId: FILES_MODULE_ID,
    ok: true,
    value,
    refs: uniqueStrings(refs).filter((ref) => !/workspace-object|folder:workspace$/.test(ref)),
    operationRef,
  });
}

function fail(error: string): ModuleResultEnvelope {
  return moduleResult({
    moduleId: FILES_MODULE_ID,
    ok: false,
    error: scrubFilesModuleText(error),
  });
}

function clampLimit(limit: number | undefined) {
  return Math.max(1, Math.min(Number.isInteger(limit) && limit ? limit : 200, 500));
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function scrubFilesModuleText(value: string) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|secret|password|authorization)=([^&\s]+)/gi, '$1=[redacted-secret]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9._-]{8,}/gi, '[redacted-secret]')
    .replace(/(^|[\s"'([{<])((?:\/(?:Applications|Users|private|var|tmp|etc|opt|home)\/[^\s"'<>),;\]}]+)|(?:[A-Za-z]:\\[^\s"'<>),;\]}]+))/g, '$1[redacted-local-path]')
    .replace(/https?:\/\/[^\s"')]+/gi, '[redacted-url]');
}
