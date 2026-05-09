import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { ArtifactPreviewAction, PreviewDescriptor } from '@sciforge-ui/runtime-contract/preview';
import { normalizeWorkspaceRootPath, resolveWorkspacePreviewRef } from '../workspace-paths.js';

export function languageForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (ext === '.json') return 'json';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp' || ext === '.svg') return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (ext === '.js' || ext === '.jsx') return 'javascript';
  if (ext === '.py') return 'python';
  if (ext === '.r') return 'r';
  if (ext === '.csv' || ext === '.tsv') return 'table';
  if (ext === '.html') return 'html';
  if (ext === '.css') return 'css';
  if (ext === '.sh') return 'shell';
  if (ext === '.doc' || ext === '.docx') return 'document';
  if (ext === '.xls' || ext === '.xlsx') return 'spreadsheet';
  if (ext === '.ppt' || ext === '.pptx') return 'presentation';
  return 'text';
}

export function isBinaryPreviewFile(path: string) {
  return [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.pdf',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
  ].includes(extname(path).toLowerCase());
}

export function previewRequestBaseUrl(req: IncomingMessage, fallbackPort: number) {
  return `http://${req.headers.host || `127.0.0.1:${fallbackPort}`}`;
}

export async function previewDescriptorForRef(rawRef: string, workspacePath: string, baseUrl: string): Promise<PreviewDescriptor> {
  const filePath = resolveWorkspacePreviewRef(rawRef, workspacePath);
  const info = await stat(filePath);
  const kind = previewKindForPath(filePath, info.isDirectory());
  const mimeType = info.isDirectory() ? 'inode/directory' : mimeTypeForPath(filePath);
  const hash = info.isFile() ? await fileHash(filePath, info.size) : undefined;
  const rawUrl = new URL(`${baseUrl}/api/sciforge/preview/raw`);
  rawUrl.searchParams.set('ref', filePath);
  if (workspacePath.trim()) rawUrl.searchParams.set('workspacePath', workspacePath.trim());
  return {
    kind,
    source: rawRef.startsWith('artifact:') ? 'artifact' : rawRef.startsWith('dataRef:') ? 'dataRef' : 'path',
    ref: filePath,
    mimeType,
    sizeBytes: info.size,
    hash,
    title: basename(filePath),
    rawUrl: info.isFile() ? rawUrl.toString() : undefined,
    inlinePolicy: inlinePolicyForPreview(kind, info.size),
    derivatives: derivativeDescriptorsForPreview(filePath, kind, info.size),
    actions: previewActionsForKind(kind),
    locatorHints: locatorHintsForKind(kind),
    diagnostics: info.isFile() && info.size > 25 * 1024 * 1024 && (kind === 'pdf' || kind === 'image')
      ? ['Large file uses streaming preview; derived text/thumb/page indexes are generated only on demand.']
      : [],
  };
}

export async function previewDerivativeForRef(rawRef: string, workspacePath: string, kind: string) {
  const filePath = resolveWorkspacePreviewRef(rawRef, workspacePath);
  const info = await stat(filePath);
  const previewKind = previewKindForPath(filePath, info.isDirectory());
  const cacheDir = join(workspacePath.trim() ? normalizeWorkspaceRootPath(resolve(workspacePath)) : dirname(filePath), '.sciforge', 'preview-cache');
  await mkdir(cacheDir, { recursive: true });
  const cacheKey = createHash('sha256').update(JSON.stringify({ filePath, mtime: info.mtimeMs, size: info.size, kind })).digest('hex').slice(0, 24);
  const outPath = join(cacheDir, `${cacheKey}.${derivativeExtension(kind, previewKind, filePath)}`);
  const existing = await stat(outPath).catch(() => undefined);
  if (existing?.isFile()) return derivativeRecord(kind, outPath, existing.size, 'available', derivativeMimeType(kind, previewKind, filePath));
  if (kind === 'metadata') {
    await writeFile(outPath, JSON.stringify({ path: filePath, name: basename(filePath), previewKind, mimeType: mimeTypeForPath(filePath), sizeBytes: info.size, modifiedAt: info.mtime.toISOString() }, null, 2), 'utf8');
  } else if (kind === 'schema') {
    await writeFile(outPath, JSON.stringify(await schemaPreviewForFile(filePath, previewKind), null, 2), 'utf8');
  } else if (kind === 'pages') {
    await writeFile(outPath, JSON.stringify({ pageCount: undefined, pages: [], status: 'lazy', note: 'Page index generation requires a PDF parser; raw streaming remains available.' }, null, 2), 'utf8');
  } else if (kind === 'text') {
    await writeFile(outPath, await textPreviewForFile(filePath, previewKind), 'utf8');
  } else if (kind === 'thumb') {
    if (previewKind === 'image') {
      await writeFile(outPath, await readFile(filePath));
    } else {
      await writeFile(outPath, svgThumbnailPlaceholder(filePath, previewKind), 'utf8');
    }
  } else if (kind === 'html') {
    await writeFile(outPath, await htmlPreviewForFile(filePath, previewKind), 'utf8');
  } else if (kind === 'structure-bundle') {
    await writeFile(outPath, JSON.stringify(await structureBundleForFile(filePath, previewKind), null, 2), 'utf8');
  } else {
    throw new Error(`Unsupported derivative kind: ${kind}`);
  }
  const generated = await stat(outPath);
  return derivativeRecord(kind, outPath, generated.size, 'available', derivativeMimeType(kind, previewKind, filePath));
}

export function streamWorkspacePreviewFile(req: IncomingMessage, res: ServerResponse, path: string, size: number) {
  const range = req.headers.range;
  const mimeType = mimeTypeForPath(path);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', mimeType);
  res.setHeader('ETag', `"${createHash('sha256').update(`${path}:${size}`).digest('hex')}"`);
  if (!range) {
    res.writeHead(200, { 'Content-Length': size });
    createReadStream(path).pipe(res);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= size) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
  });
  createReadStream(path, { start, end }).pipe(res);
}

export function mimeTypeForPath(path: string) {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.doc') return 'application/msword';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.ppt') return 'application/vnd.ms-powerpoint';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === '.json') return 'application/json';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.tsv') return 'text/tab-separated-values';
  if (ext === '.html') return 'text/html';
  return 'text/plain';
}

function derivativeRecord(kind: string, path: string, sizeBytes: number, status: string, mimeType?: string) {
  return {
    kind,
    ref: path,
    mimeType: mimeType || (kind === 'schema' || kind === 'pages' || kind === 'metadata' ? 'application/json' : 'text/plain'),
    sizeBytes,
    generatedAt: new Date().toISOString(),
    status,
  };
}

function derivativeExtension(kind: string, previewKind: string, path: string) {
  if (kind === 'thumb' && previewKind === 'image') {
    const ext = extname(path).toLowerCase().replace(/^\./, '');
    return ext || 'bin';
  }
  if (kind === 'thumb') return 'svg';
  if (kind === 'html') return 'html';
  if (kind === 'schema' || kind === 'pages' || kind === 'metadata' || kind === 'structure-bundle') return 'json';
  return 'txt';
}

function derivativeMimeType(kind: string, previewKind: string, path: string) {
  if (kind === 'thumb' && previewKind === 'image') return mimeTypeForPath(path);
  if (kind === 'thumb') return 'image/svg+xml';
  if (kind === 'html') return 'text/html';
  if (kind === 'schema' || kind === 'pages' || kind === 'metadata' || kind === 'structure-bundle') return 'application/json';
  return 'text/plain';
}

async function textPreviewForFile(path: string, previewKind: string) {
  if (previewKind === 'text' || previewKind === 'markdown' || previewKind === 'html' || previewKind === 'json' || previewKind === 'table') {
    return (await readFile(path, 'utf8')).slice(0, 200_000);
  }
  return `Text extraction is not available for ${previewKind} without an optional parser. Use rawUrl/system-open or request a task-specific extractor.`;
}

async function schemaPreviewForFile(path: string, previewKind: string) {
  if (previewKind === 'json') {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
    return summarizeJsonSchema(parsed);
  }
  if (previewKind === 'table') {
    const text = await readFile(path, 'utf8');
    const rows = text.split(/\r?\n/).filter(Boolean).slice(0, 25).map((line) => line.split(extname(path).toLowerCase() === '.tsv' ? '\t' : ','));
    return { rowsPreviewed: rows.length, columns: rows[0]?.map((name, index) => ({ index, name: name || `column_${index + 1}` })) ?? [] };
  }
  return { previewKind, status: 'metadata-only' };
}

async function htmlPreviewForFile(path: string, previewKind: string) {
  if (previewKind === 'html') return (await readFile(path, 'utf8')).slice(0, 200_000);
  const text = escapeHtml(await textPreviewForFile(path, previewKind));
  return `<!doctype html><meta charset="utf-8"><title>${escapeHtml(basename(path))}</title><pre>${text}</pre>`;
}

async function structureBundleForFile(path: string, previewKind: string) {
  const text = previewKind === 'structure' ? (await readFile(path, 'utf8')).slice(0, 200_000) : '';
  const chains = Array.from(new Set(Array.from(text.matchAll(/^(?:ATOM|HETATM).{17}(.).*/gm)).map((match) => match[1].trim()).filter(Boolean)));
  return {
    path,
    name: basename(path),
    previewKind,
    format: extname(path).replace(/^\./, ''),
    chains,
    rawRef: path,
    status: previewKind === 'structure' ? 'metadata-only-bundle' : 'unsupported',
  };
}

function svgThumbnailPlaceholder(path: string, previewKind: string) {
  const label = escapeHtml(`${previewKind.toUpperCase()} preview`);
  const name = escapeHtml(basename(path));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f5f7fb"/><rect x="18" y="18" width="284" height="144" rx="8" fill="#fff" stroke="#c9d3e1"/><text x="32" y="82" font-family="system-ui, sans-serif" font-size="18" fill="#25324a">${label}</text><text x="32" y="112" font-family="system-ui, sans-serif" font-size="12" fill="#667085">${name}</text></svg>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

function summarizeJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return { type: 'array', count: value.length, item: summarizeJsonSchema(value[0]) };
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.entries(value as Record<string, unknown>).slice(0, 50).map(([key, item]) => ({
        key,
        schema: Array.isArray(item) ? { type: 'array', count: item.length } : item === null ? { type: 'null' } : { type: typeof item },
      })),
    };
  }
  return { type: value === null ? 'null' : typeof value };
}

function previewKindForPath(path: string, isDirectory = false): PreviewDescriptor['kind'] {
  if (isDirectory) return 'folder';
  const ext = extname(path).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext)) return 'image';
  if (['.md', '.markdown'].includes(ext)) return 'markdown';
  if (['.json', '.jsonl'].includes(ext)) return 'json';
  if (['.csv', '.tsv', '.xlsx', '.xls'].includes(ext)) return 'table';
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (['.pdb', '.cif', '.mmcif'].includes(ext)) return 'structure';
  if (['.doc', '.docx', '.ppt', '.pptx'].includes(ext)) return 'office';
  if (['.txt', '.log', '.ts', '.tsx', '.js', '.jsx', '.py', '.r', '.sh', '.css'].includes(ext)) return 'text';
  return 'binary';
}

function inlinePolicyForPreview(kind: PreviewDescriptor['kind'], size: number): PreviewDescriptor['inlinePolicy'] {
  if (kind === 'pdf' || kind === 'image') return 'stream';
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'table' || kind === 'html') return size <= 1024 * 1024 ? 'inline' : 'extract';
  if (kind === 'folder') return 'extract';
  if (kind === 'office' || kind === 'structure') return 'external';
  return 'unsupported';
}

function derivativeDescriptorsForPreview(path: string, kind: PreviewDescriptor['kind'], size: number): PreviewDescriptor['derivatives'] {
  const lazy = (derivativeKind: NonNullable<PreviewDescriptor['derivatives']>[number]['kind'], mimeType: string) => ({
    kind: derivativeKind,
    ref: `${path}#${derivativeKind}`,
    mimeType,
    status: 'lazy' as const,
  });
  if (kind === 'pdf') return [lazy('text', 'text/plain'), lazy('pages', 'application/json'), lazy('thumb', 'image/png')];
  if (kind === 'image') return [lazy('thumb', mimeTypeForPath(path))];
  if (kind === 'json') return [lazy('schema', 'application/json'), ...(size > 1024 * 1024 ? [lazy('text', 'text/plain')] : [])];
  if (kind === 'table') return [lazy('schema', 'application/json')];
  if (kind === 'markdown' || kind === 'text' || kind === 'html') return size > 1024 * 1024 ? [lazy('text', 'text/plain')] : [];
  if (kind === 'structure') return [lazy('metadata', 'application/json'), lazy('structure-bundle', 'application/json')];
  if (kind === 'office' || kind === 'folder' || kind === 'binary') return [lazy('metadata', 'application/json')];
  return [];
}

function previewActionsForKind(kind: PreviewDescriptor['kind']): ArtifactPreviewAction[] {
  const common: ArtifactPreviewAction[] = ['system-open', 'copy-ref', 'inspect-metadata'];
  if (kind === 'pdf') return ['open-inline', 'extract-text', 'make-thumbnail', 'select-page', 'select-region', ...common];
  if (kind === 'image') return ['open-inline', 'make-thumbnail', 'select-region', ...common];
  if (kind === 'table') return ['open-inline', 'select-rows', ...common];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['open-inline', 'extract-text', ...common];
  return common;
}

function locatorHintsForKind(kind: PreviewDescriptor['kind']): PreviewDescriptor['locatorHints'] {
  if (kind === 'pdf') return ['page', 'region'];
  if (kind === 'image') return ['region'];
  if (kind === 'table') return ['row-range', 'column-range'];
  if (kind === 'structure') return ['structure-selection'];
  if (kind === 'markdown' || kind === 'text' || kind === 'json' || kind === 'html') return ['text-range'];
  return [];
}

async function fileHash(path: string, size: number) {
  const hash = createHash('sha256');
  if (size <= 8 * 1024 * 1024) {
    hash.update(await readFile(path));
  } else {
    hash.update(`${path}:${size}`);
  }
  return `sha256:${hash.digest('hex')}`;
}
