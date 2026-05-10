import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function workspaceTreeSummary(workspace: string) {
  const root = resolve(workspace);
  const out: Array<{ path: string; kind: 'file' | 'folder'; sizeBytes?: number }> = [];
  async function walk(dir: string, prefix = '') {
    if (out.length >= 80) return;
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= 80) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (shouldSkipWorkspaceTreeEntry(rel, entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push({ path: rel, kind: 'folder' });
        if (shouldDescendWorkspaceTreeEntry(rel)) await walk(path, rel);
      } else if (entry.isFile()) {
        let sizeBytes = 0;
        try {
          sizeBytes = (await stat(path)).size;
        } catch {
          // Size is optional.
        }
        out.push({ path: rel, kind: 'file', sizeBytes });
      }
    }
  }
  await walk(root);
  return out;
}

function shouldSkipWorkspaceTreeEntry(rel: string, name: string) {
  if (name === 'node_modules' || name === '.git') return true;
  if (rel === '.bioagent' || rel.startsWith('.bioagent/')) return true;
  if (rel.startsWith('.sciforge/') && rel.split('/').length > 2) return true;
  if (/^\.sciforge\/(?:artifacts|task-results|logs|sessions|versions)\//.test(rel)) return true;
  return false;
}

function shouldDescendWorkspaceTreeEntry(rel: string) {
  if (rel.startsWith('.sciforge/')) return false;
  if (/^\.sciforge\/(?:artifacts|task-results|logs|sessions|versions)$/.test(rel)) return false;
  return rel.split('/').length < 3;
}
