import type { WorkspaceEntry } from '../../api/workspaceClient';
import { localeText, type SupportedLocale } from '../../i18n';
import type { SidebarSearchMatch } from './ShellPanels';

const DEFAULT_LOCALE: SupportedLocale = 'en-US';
export const SIDEBAR_WORKSPACE_SEARCH_MIN_QUERY_LENGTH = 2;
export const SIDEBAR_WORKSPACE_SEARCH_MAX_DEPTH = 6;
export const SIDEBAR_WORKSPACE_SEARCH_MAX_ENTRIES = 400;

function text(locale: SupportedLocale | undefined, copy: Record<SupportedLocale, string>) {
  return localeText(locale ?? DEFAULT_LOCALE, copy);
}

export function sidebarWorkspaceSearchShouldIndex(query: string) {
  return query.trim().length >= SIDEBAR_WORKSPACE_SEARCH_MIN_QUERY_LENGTH;
}

export function sidebarWorkspaceSearchShouldDescend(entry: WorkspaceEntry, rootPath: string) {
  if (entry.kind !== 'folder') return false;
  const relativePath = sidebarWorkspaceRelativePath(rootPath, entry.path);
  if (!relativePath) return true;
  return !isPrivateWorkspaceRelativePath(relativePath);
}

export function buildSidebarWorkspaceFileMatches(
  needle: string,
  entries: WorkspaceEntry[],
  rootPath: string,
  options: { locale?: SupportedLocale } = {},
): SidebarSearchMatch[] {
  if (!needle.trim() || !rootPath.trim() || !entries.length) return [];
  const locale = options.locale;
  const matches: SidebarSearchMatch[] = [];
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const relativePath = sidebarWorkspaceRelativePath(rootPath, entry.path);
    if (!relativePath || isUnsafeWorkspaceRelativePath(relativePath)) continue;
    const label = publicWorkspaceLine(entry.name, 52);
    const detail = sidebarWorkspaceFileDetail(relativePath, locale);
    const haystack = `${label} ${relativePath}`;
    if (!label || !containsNeedle(haystack, needle)) continue;
    matches.push({
      id: `workspace-file:${hashId(relativePath)}`,
      label,
      detail,
      page: 'workbench' as const,
      kind: 'file' as const,
      workspaceRelativePath: relativePath,
      workspaceFileName: label,
    });
  }
  return matches.slice(0, 8);
}

export function resolveSidebarWorkspaceFilePath(rootPath: string, relativePath: string) {
  const root = normalizeSlashPath(rootPath);
  const relative = normalizeRelativePath(relativePath);
  if (!root || !relative || isUnsafeWorkspaceRelativePath(relative)) return '';
  return `${root}/${relative}`;
}

function sidebarWorkspaceRelativePath(rootPath: string, entryPath: string) {
  const root = normalizeSlashPath(rootPath);
  const entry = normalizeSlashPath(entryPath);
  if (!root || !entry) return '';
  if (entry === root) return '';
  if (entry.startsWith(`${root}/`)) return normalizeRelativePath(entry.slice(root.length + 1));
  if (!entry.startsWith('/')) return normalizeRelativePath(entry);
  return '';
}

function sidebarWorkspaceFileDetail(relativePath: string, locale?: SupportedLocale) {
  const parent = relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '';
  const safeParent = publicWorkspaceLine(parent, 44);
  const prefix = text(locale, { 'zh-CN': '工作区文件', 'en-US': 'Workspace file' });
  return safeParent ? `${prefix} · ${safeParent}` : prefix;
}

function publicWorkspaceLine(value: string | undefined, maxLength: number) {
  const compact = compactLine(value, maxLength);
  if (!compact || containsInternalTerm(compact) || isPrivateWorkspaceRelativePath(compact)) return '';
  return compact;
}

function normalizeSlashPath(value: string) {
  return value.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '').trim();
}

function normalizeRelativePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
}

function compactLine(value: string | undefined, maxLength: number) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isPrivateWorkspaceRelativePath(value: string) {
  return /(^|\/)(?:\.git|\.sciforge|\.codex|node_modules|dist-ui|\.env(?:\.|$)|config\.local\.json|config\.computer-use\.local\.json|logs?|tmp)(?:\/|$)/i.test(value)
    || /(^|\/)(?:stdout|stderr|raw|trace)\.(?:jsonl?|log|txt)$/i.test(value);
}

function isUnsafeWorkspaceRelativePath(value: string) {
  const normalized = normalizeRelativePath(value);
  if (!normalized || normalized.includes('\0') || isPrivateWorkspaceRelativePath(normalized)) return true;
  return normalized.split('/').some((segment) => segment === '.' || segment === '..' || !segment.trim());
}

function containsInternalTerm(value: string) {
  return /\b(?:Authorization|api\s*key|secret|token|credential|password|provider|raw\s+JSONL|stdout|stderr|run\s+id)\b/i.test(value)
    || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    || /(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\//i.test(value)
    || /\bsk-[A-Za-z0-9._-]+/i.test(value);
}

function containsNeedle(value: string, needle: string) {
  return value.toLocaleLowerCase().includes(needle);
}

function hashId(raw: string) {
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
